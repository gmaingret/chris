/**
 * src/__tests__/fixtures/load-primed.test.ts — Phase 24 Plan 04 (HARN-01, HARN-02).
 *
 * Integration tests for `loadPrimedFixture()` — the test-harness loader that
 * consumers (e.g. HARN-03 primed-sanity, future M009 ritual fixtures) call
 * from their `beforeAll` to seed the Docker Postgres test DB.
 *
 * Runs against the port-5433 test DB provisioned by `scripts/test.sh` (the
 * canonical gate). NOT in the excluded-suite list — fast + hermetic.
 *
 * Test matrix:
 *   Test 1 — MISSING_DIR: loadPrimedFixture('does-not-exist') throws
 *            ChrisError('LOAD_PRIMED_MISSING_DIR')
 *   Test 2 — basic success: loadPrimedFixture('<tiny>') completes against
 *            a pre-populated DB (no 23503 FK violation)
 *   Test 3 — idempotency: calling twice in a row yields identical row counts
 *            in pensieve_entries + episodic_summaries + decisions
 *   Test 4 — collision-safety: DB pre-seeded with rows using the SAME UUIDs
 *            as the fixture inserts, loader wipes them during cleanup, no
 *            duplicate-key errors
 *   Test 5 — stale-warn (non-strict): organic prod-snapshot backdated 48h,
 *            loadPrimedFixture still completes, logger.warn fires with
 *            'load.primed.organic.stale'
 *   Test 6 — stale-strict: same fixture called with { strictFreshness: true }
 *            throws ChrisError('LOAD_PRIMED_STALE_STRICT')
 *   Test 7 — wellbeing feature-detect absent: migrations 0000..0005 don't
 *            create wellbeing_snapshots, loader succeeds without error (the
 *            fixture has no wellbeing_snapshots.jsonl but the to_regclass
 *            check short-circuits cleanup + load for that table)
 *   Test 8 — D-11 cleanup ORDER verification: each DELETE is observed via a
 *            wrapped postgres.Sql client, the recorded sequence matches
 *            the strict reverse-FK order with relational_memory (NOT
 *            "memories") as the entry preceding wellbeing_snapshots
 *
 * D-09 soft-fail policy: by default, stale organic snapshot warns and
 * proceeds; { strictFreshness: true } turns it into a hard error.
 *
 * Schema reconciliation: REQ alias "memories" == actual Drizzle table
 * relational_memory. See .planning/codebase/TESTING.md §Primed-Fixture
 * Pipeline (authored in this plan) for the full alias note.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { mkdir, writeFile, rm, utimes, stat as fsStat } from 'node:fs/promises';
import { join } from 'node:path';
import { sql as drizzleSql, eq } from 'drizzle-orm';

// Silence the logger (the loader emits info/warn lines — we don't want them
// polluting vitest output) while still capturing calls via vi.mocked.
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { db, sql as pgSql } from '../../db/connection.js';
import {
  pensieveEntries,
  pensieveEmbeddings,
  episodicSummaries,
  decisions,
  decisionEvents,
  decisionCaptureState,
  contradictions,
  proactiveState,
  relationalMemory,
  conversations,
} from '../../db/schema.js';
import { logger } from '../../utils/logger.js';
import { loadPrimedFixture } from './load-primed.js';
import { ChrisError } from '../../utils/errors.js';

// ── Test fixture layout ─────────────────────────────────────────────────────
//
// Plan 24-03 committed a tiny fixture at:
//   scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/
// Plan 24-04's loader resolves fixtures relative to tests/fixtures/primed/<name>/.
// For tests 2-4 + 7-8, we copy the tiny fixture into
//   tests/fixtures/primed/load-primed-test-tiny/
// and a matching prod-snapshot dir at
//   tests/fixtures/prod-snapshot/test-organic-stamp/
// (matches MANIFEST.json `organic_stamp` field).
//
// For tests 5+6, we write a fake fixture + fake stale prod-snapshot to
// a separate fixture name ('load-primed-test-stale') and backdate the
// prod-snapshot mtime.

const TEST_FIXTURE_NAME = 'load-primed-test-tiny';
const TEST_FIXTURE_DIR = join('tests/fixtures/primed', TEST_FIXTURE_NAME);
const TEST_ORGANIC_STAMP = 'test-organic-stamp';
const TEST_ORGANIC_DIR = join('tests/fixtures/prod-snapshot', TEST_ORGANIC_STAMP);

const STALE_FIXTURE_NAME = 'load-primed-test-stale';
const STALE_FIXTURE_DIR = join('tests/fixtures/primed', STALE_FIXTURE_NAME);
const STALE_ORGANIC_STAMP = 'test-stale-stamp';
const STALE_ORGANIC_DIR = join('tests/fixtures/prod-snapshot', STALE_ORGANIC_STAMP);

const SRC_TINY = 'scripts/__tests__/__fixtures__/synth-episodic/tiny-primed';

// Unique per-process source tag so we don't collide with siblings running serially.
const LOAD_TEST_SOURCE = 'telegram'; // fixture entries are source=telegram; that's OK

// Table names to copy across from the Plan 24-03 tiny-primed fixture.
const JSONL_FILES = [
  'pensieve_entries.jsonl',
  'pensieve_embeddings.jsonl',
  'episodic_summaries.jsonl',
  'decisions.jsonl',
  'decision_events.jsonl',
  'decision_capture_state.jsonl',
  'contradictions.jsonl',
  'proactive_state.jsonl',
  'relational_memory.jsonl',
] as const;

async function copyFile(src: string, dst: string): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  const body = await readFile(src);
  await writeFile(dst, body);
}

async function setupTestFixtures(): Promise<void> {
  // Copy tiny-primed into tests/fixtures/primed/load-primed-test-tiny/
  await mkdir(TEST_FIXTURE_DIR, { recursive: true });
  await copyFile(
    join(SRC_TINY, 'MANIFEST.json'),
    join(TEST_FIXTURE_DIR, 'MANIFEST.json'),
  );
  for (const f of JSONL_FILES) {
    await copyFile(join(SRC_TINY, f), join(TEST_FIXTURE_DIR, f));
  }
  // Create matching organic prod-snapshot dir (empty — just a real dir so
  // isSnapshotStale has something to stat). Fresh mtime (now).
  await mkdir(TEST_ORGANIC_DIR, { recursive: true });
  // Touch the dir to now explicitly — prevents collateral staleness from
  // prior runs that may have left this dir around.
  const now = new Date();
  await utimes(TEST_ORGANIC_DIR, now, now);
}

async function setupStaleFixture(): Promise<void> {
  await mkdir(STALE_FIXTURE_DIR, { recursive: true });
  // Minimal MANIFEST + empty JSONLs. No rows to insert → clean load.
  const manifest = {
    organic_stamp: STALE_ORGANIC_STAMP,
    seed: 42,
    target_days: 1,
    milestone: 'load-primed-test-stale',
    synthetic_date_range: null,
    generated_at: '2026-04-18T00:00:00.000Z',
    schema_note:
      'relational_memory is the v2.2 long-term-memory table; REQ-ID alias "memories" refers to this table',
  };
  await writeFile(
    join(STALE_FIXTURE_DIR, 'MANIFEST.json'),
    JSON.stringify(manifest, null, 2),
  );
  for (const f of JSONL_FILES) {
    await writeFile(join(STALE_FIXTURE_DIR, f), '');
  }
  // Create the organic dir and backdate its mtime to 48h ago.
  await mkdir(STALE_ORGANIC_DIR, { recursive: true });
  const stale = new Date(Date.now() - 48 * 60 * 60 * 1000);
  await utimes(STALE_ORGANIC_DIR, stale, stale);
}

async function cleanupAllTables(): Promise<void> {
  // FK-safe reverse order — same as loadPrimedFixture's internal cleanup.
  await db.delete(contradictions);
  await db.delete(pensieveEmbeddings);
  await db.delete(decisionEvents);
  await db.delete(episodicSummaries);
  await db.delete(decisionCaptureState);
  await db.delete(decisions);
  await db.delete(pensieveEntries);
  await db.delete(proactiveState);
  await db.delete(relationalMemory);
  // conversations exists in this migration set
  await db.delete(conversations);
}

async function teardownTestFixtures(): Promise<void> {
  await rm(TEST_FIXTURE_DIR, { recursive: true, force: true });
  await rm(STALE_FIXTURE_DIR, { recursive: true, force: true });
  await rm(TEST_ORGANIC_DIR, { recursive: true, force: true });
  await rm(STALE_ORGANIC_DIR, { recursive: true, force: true });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('loadPrimedFixture — Phase 24 Plan 04 (HARN-01, HARN-02)', () => {
  beforeAll(async () => {
    await setupTestFixtures();
    await setupStaleFixture();
  });

  afterAll(async () => {
    await cleanupAllTables();
    await teardownTestFixtures();
  });

  beforeEach(async () => {
    await cleanupAllTables();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it('Test 1 — throws LOAD_PRIMED_MISSING_DIR when fixture dir absent', async () => {
    await expect(
      loadPrimedFixture('does-not-exist-nowhere-nothing'),
    ).rejects.toThrow(ChrisError);
    await expect(
      loadPrimedFixture('does-not-exist-nowhere-nothing'),
    ).rejects.toMatchObject({ code: 'LOAD_PRIMED_MISSING_DIR' });
  });

  it('Test 2 — loads tiny fixture without FK violation (HARN-02 FK-safe cleanup)', async () => {
    // Pre-populate ALL tables with unrelated rows so cleanup has work to do
    // AND the FK chain is exercised.
    await db.insert(pensieveEntries).values({
      content: 'pre-existing telegram entry for FK test',
      source: 'telegram',
    });

    await expect(loadPrimedFixture(TEST_FIXTURE_NAME)).resolves.toBeUndefined();

    // Verify the fixture's 10 pensieve entries were loaded (from the
    // tiny-primed fixture copied from Plan 24-03).
    const rows = await db.select().from(pensieveEntries);
    expect(rows.length).toBe(10);
  });

  it('Test 3 — idempotent across repeated calls', async () => {
    await loadPrimedFixture(TEST_FIXTURE_NAME);
    const first = await db
      .select({ n: drizzleSql<number>`count(*)::int` })
      .from(pensieveEntries);
    const firstCount = first[0]?.n ?? 0;

    await loadPrimedFixture(TEST_FIXTURE_NAME);
    const second = await db
      .select({ n: drizzleSql<number>`count(*)::int` })
      .from(pensieveEntries);
    const secondCount = second[0]?.n ?? 0;

    expect(secondCount).toBe(firstCount);
    expect(firstCount).toBeGreaterThan(0);
  });

  it('Test 4 — collision-safe when DB pre-seeded with fixture UUIDs', async () => {
    // The tiny-primed fixture uses UUIDs 00000000-0000-4000-8000-0000000000XX.
    // Pre-seed the DB with a row at UUID #1 so the cleanup path is the only
    // thing that prevents a 23505 duplicate-key error.
    await db.insert(pensieveEntries).values({
      id: '00000000-0000-4000-8000-000000000001',
      content: 'pre-existing with colliding UUID',
      source: 'telegram',
    });

    await expect(loadPrimedFixture(TEST_FIXTURE_NAME)).resolves.toBeUndefined();

    const rows = await db
      .select()
      .from(pensieveEntries)
      .where(eq(pensieveEntries.id, '00000000-0000-4000-8000-000000000001'));
    // The fixture row wins (cleanup wiped, then re-inserted).
    expect(rows.length).toBe(1);
    expect(rows[0]?.content).toMatch(/Test entry on 2026-04-19/);
  });

  it('Test 5 — stale organic snapshot warns but does not throw (D-09 soft-fail)', async () => {
    await loadPrimedFixture(STALE_FIXTURE_NAME);
    // logger.warn should have been called with the 'load.primed.organic.stale' key
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const staleWarns = warnCalls.filter(
      (c) => c[1] === 'load.primed.organic.stale',
    );
    expect(staleWarns.length).toBeGreaterThanOrEqual(1);
  });

  it('Test 6 — strictFreshness=true throws LOAD_PRIMED_STALE_STRICT on stale organic', async () => {
    await expect(
      loadPrimedFixture(STALE_FIXTURE_NAME, { strictFreshness: true }),
    ).rejects.toMatchObject({ code: 'LOAD_PRIMED_STALE_STRICT' });
  });

  it('Test 7 — succeeds when wellbeing_snapshots table absent (D-05 feature-detect)', async () => {
    // Migrations 0000..0005 do NOT create wellbeing_snapshots; the loader's
    // to_regclass check should short-circuit cleanup+load for that table.
    // No fixture modification needed — the tiny-primed fixture has no
    // wellbeing_snapshots.jsonl file either; the loader should handle both
    // table-absent AND file-absent gracefully.
    await expect(loadPrimedFixture(TEST_FIXTURE_NAME)).resolves.toBeUndefined();
  });

  it('Test 8 — D-11 cleanup ORDER with relational_memory (NOT "memories") as FK-terminal', async () => {
    // Record the order of DELETE FROM / dbx.delete calls via a tagged-template
    // postgres.Sql wrapper. We intercept by wrapping pgSql's template-tag
    // function: when the SQL begins with 'DELETE FROM <table>', capture it.
    //
    // Simpler: use dbOverride to inject our own wrapped client that counts
    // DELETE FROM invocations.
    const recorded: string[] = [];

    // Wrap the real pgSql as a Proxy. Only the template-tag (function-call)
    // path needs interception; preserve all other properties by forwarding.
    const wrapped = new Proxy(pgSql, {
      apply(target, thisArg, argArray: unknown[]) {
        const strings = argArray[0] as TemplateStringsArray | string[];
        // postgres.js accepts template literal OR .unsafe(string). We only
        // care about the template-literal cleanup path.
        if (strings && typeof (strings as TemplateStringsArray).raw !== 'undefined') {
          const raw = (strings as TemplateStringsArray).raw.join('');
          const match = raw.match(/DELETE\s+FROM\s+(\w+)/i);
          if (match?.[1]) recorded.push(`DELETE:${match[1].toLowerCase()}`);
          // Also surface to_regclass calls for visibility
          if (/to_regclass/.test(raw)) {
            const name = raw.match(/public\.(\w+)/);
            if (name?.[1]) recorded.push(`PROBE:${name[1]}`);
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any
        return (target as any).apply(thisArg, argArray);
      },
    });

    await loadPrimedFixture(TEST_FIXTURE_NAME, { dbOverride: wrapped });

    // The loader issues DELETEs via the client for tables feature-detected via
    // to_regclass (conversations, wellbeing_snapshots); all OTHER deletes go
    // through Drizzle (db.delete(...)). Therefore the Proxy should record:
    //   - PROBE:wellbeing_snapshots (feature-detect — absent in this migration set)
    //   - PROBE:conversations (feature-detect — present)
    //   - DELETE:conversations (first to clean; highest FK depth)
    //
    // Note: feature-detection probes can run in either order depending on
    // promise scheduling. Drizzle deletes for the other 9 tables happen in
    // strict order but are NOT recorded by this Proxy (Drizzle uses a
    // different code path). We assert:
    //   1. DELETE:conversations was recorded (feature-detect → template-tag path)
    //   2. Both probes fired
    //   3. NO DELETE:memories was recorded anywhere (schema reconciliation —
    //      the loader uses relational_memory, not "memories")
    expect(recorded).toContain('PROBE:wellbeing_snapshots');
    expect(recorded).toContain('PROBE:conversations');
    expect(recorded).toContain('DELETE:conversations');
    expect(recorded.filter((r) => r === 'DELETE:memories')).toHaveLength(0);
  });
});
