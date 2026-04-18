/**
 * src/episodic/__tests__/sources.test.ts — Phase 21 Plan 03 Task 2
 *
 * Docker-Postgres integration tests for `src/episodic/sources.ts` — the three
 * day-bounded read helpers backing the consolidation prompt input.
 *
 * Coverage (12 tests):
 *  Tests 1–4   getPensieveEntriesForDay (happy path, deletedAt filter, day
 *              boundary at midnight Paris, timezone switching)
 *  Tests 5–6   getContradictionsForDay (happy path + JOIN, status filter)
 *  Tests 7–11  getDecisionsForDay (captured today, resolved today but created
 *              earlier, both same day, open-draft filter, neither in window)
 *  Test 12     dayBoundaryUtc DST correctness — spring-forward 23h,
 *              fall-back 25h
 *
 * Real Postgres (D018 — no skipped tests). Run via:
 *   bash scripts/test.sh
 *   # or, for this file in isolation against a running Docker DB:
 *   DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris \
 *     ANTHROPIC_API_KEY=test-key TELEGRAM_BOT_TOKEN=test-token \
 *     TELEGRAM_AUTHORIZED_USER_ID=99999 \
 *     npx vitest run src/episodic/__tests__/sources.test.ts
 *
 * vitest.config.ts disables file parallelism (fileParallelism: false), so
 * `TRUNCATE TABLE … CASCADE` in `beforeEach` is safe — no sibling test file
 * runs concurrently.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, sql as pgSql } from '../../db/connection.js';
import {
  pensieveEntries,
  contradictions,
  decisions,
} from '../../db/schema.js';
import {
  getPensieveEntriesForDay,
  getContradictionsForDay,
  getDecisionsForDay,
  dayBoundaryUtc,
} from '../sources.js';

// ── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Construct a JS Date for a wall-clock instant in a specific IANA timezone.
 * Avoids host-timezone dependence in fixture data.
 */
function tzDate(iso: string, tz: string): Date {
  return DateTime.fromISO(iso, { zone: tz }).toJSDate();
}

/**
 * Insert a pensieve entry with explicit createdAt. Source defaults to a
 * unique marker so accidental cleanup in other test files (which scope by
 * `source = 'telegram'`) does not interfere.
 */
async function insertEntry(opts: {
  content: string;
  createdAt: Date;
  source?: string;
  deletedAt?: Date | null;
  epistemicTag?:
    | 'FACT'
    | 'EMOTION'
    | 'BELIEF'
    | 'INTENTION'
    | 'EXPERIENCE'
    | 'PREFERENCE'
    | 'RELATIONSHIP'
    | 'DREAM'
    | 'FEAR'
    | 'VALUE'
    | 'CONTRADICTION'
    | 'OTHER'
    | 'DECISION'
    | null;
}): Promise<string> {
  const [row] = await db
    .insert(pensieveEntries)
    .values({
      content: opts.content,
      createdAt: opts.createdAt,
      source: opts.source ?? 'episodic-sources-test',
      deletedAt: opts.deletedAt ?? null,
      epistemicTag: opts.epistemicTag ?? null,
    })
    .returning({ id: pensieveEntries.id });
  return row!.id;
}

async function insertContradiction(opts: {
  entryAId: string;
  entryBId: string;
  description: string;
  detectedAt: Date;
  status: 'DETECTED' | 'RESOLVED' | 'ACCEPTED';
}): Promise<string> {
  const [row] = await db
    .insert(contradictions)
    .values({
      entryAId: opts.entryAId,
      entryBId: opts.entryBId,
      description: opts.description,
      detectedAt: opts.detectedAt,
      status: opts.status,
    })
    .returning({ id: contradictions.id });
  return row!.id;
}

async function insertDecision(opts: {
  decisionText: string;
  status:
    | 'open-draft'
    | 'open'
    | 'due'
    | 'resolved'
    | 'reviewed'
    | 'withdrawn'
    | 'stale'
    | 'abandoned';
  reasoning?: string;
  prediction?: string;
  falsificationCriterion?: string;
  resolveBy: Date;
  createdAt?: Date;
  resolvedAt?: Date | null;
  resolution?: string | null;
  resolutionNotes?: string | null;
}): Promise<string> {
  const [row] = await db
    .insert(decisions)
    .values({
      decisionText: opts.decisionText,
      status: opts.status,
      reasoning: opts.reasoning ?? 'test reasoning',
      prediction: opts.prediction ?? 'test prediction',
      falsificationCriterion: opts.falsificationCriterion ?? 'test falsifier',
      resolveBy: opts.resolveBy,
      createdAt: opts.createdAt,
      resolvedAt: opts.resolvedAt ?? null,
      resolution: opts.resolution ?? null,
      resolutionNotes: opts.resolutionNotes ?? null,
    })
    .returning({ id: decisions.id });
  return row!.id;
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe('episodic/sources — day-bounded read helpers (CONS-08, CONS-09)', () => {
  beforeAll(async () => {
    // Smoke test that DB is reachable before doing anything destructive.
    await pgSql`SELECT 1 as ok`;
  });

  beforeEach(async () => {
    // FK-safe order: contradictions and decision_events reference other tables.
    // CASCADE handles transitive FKs (e.g. pensieve_embeddings -> pensieve_entries,
    // decision_events -> decisions, contradictions -> pensieve_entries).
    await db.execute(sql`TRUNCATE TABLE contradictions CASCADE`);
    await db.execute(sql`TRUNCATE TABLE decision_events CASCADE`);
    await db.execute(sql`TRUNCATE TABLE decisions CASCADE`);
    await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  });

  afterAll(async () => {
    // Final cleanup so the next test file sees an empty state for these tables.
    await db.execute(sql`TRUNCATE TABLE contradictions CASCADE`);
    await db.execute(sql`TRUNCATE TABLE decision_events CASCADE`);
    await db.execute(sql`TRUNCATE TABLE decisions CASCADE`);
    await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1 — getPensieveEntriesForDay happy path: 3 entries on the day in tz
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 1: getPensieveEntriesForDay returns the day\'s entries in createdAt ASC order', async () => {
    const tz = 'Europe/Paris';
    await insertEntry({
      content: 'morning thought',
      createdAt: tzDate('2026-04-15T08:00:00', tz),
    });
    await insertEntry({
      content: 'noon thought',
      createdAt: tzDate('2026-04-15T12:00:00', tz),
    });
    await insertEntry({
      content: 'evening thought',
      createdAt: tzDate('2026-04-15T20:00:00', tz),
    });

    const rows = await getPensieveEntriesForDay(tzDate('2026-04-15T10:00:00', tz), tz);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.content)).toEqual([
      'morning thought',
      'noon thought',
      'evening thought',
    ]);
    // ASC order assertion via timestamp progression
    expect(rows[0]!.createdAt.getTime()).toBeLessThan(rows[1]!.createdAt.getTime());
    expect(rows[1]!.createdAt.getTime()).toBeLessThan(rows[2]!.createdAt.getTime());
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2 — getPensieveEntriesForDay deletedAt filter
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 2: getPensieveEntriesForDay excludes soft-deleted (deletedAt IS NOT NULL) entries', async () => {
    const tz = 'Europe/Paris';
    const day = tzDate('2026-04-15T10:00:00', tz);
    await insertEntry({
      content: 'kept',
      createdAt: tzDate('2026-04-15T09:00:00', tz),
    });
    await insertEntry({
      content: 'soft-deleted',
      createdAt: tzDate('2026-04-15T11:00:00', tz),
      deletedAt: tzDate('2026-04-15T15:00:00', tz),
    });

    const rows = await getPensieveEntriesForDay(day, tz);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.content).toBe('kept');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3 — Day boundary at midnight Paris
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 3: getPensieveEntriesForDay buckets midnight-adjacent entries by Paris calendar day', async () => {
    const tz = 'Europe/Paris';
    await insertEntry({
      content: 'late on the 15th',
      createdAt: tzDate('2026-04-15T23:59:00', tz),
    });
    await insertEntry({
      content: 'early on the 16th',
      createdAt: tzDate('2026-04-16T00:01:00', tz),
    });

    const day15 = await getPensieveEntriesForDay(
      tzDate('2026-04-15T12:00:00', tz),
      tz,
    );
    expect(day15).toHaveLength(1);
    expect(day15[0]!.content).toBe('late on the 15th');

    const day16 = await getPensieveEntriesForDay(
      tzDate('2026-04-16T12:00:00', tz),
      tz,
    );
    expect(day16).toHaveLength(1);
    expect(day16[0]!.content).toBe('early on the 16th');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4 — Timezone parameter actually matters: same entries, LA day
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 4: getPensieveEntriesForDay groups by the requested IANA timezone, not Paris', async () => {
    const paris = 'Europe/Paris';
    const la = 'America/Los_Angeles';
    // Both entries are on 2026-04-15 / 2026-04-16 in Paris (Test 3 baseline).
    // 2026-04-15T23:59:00 Paris = 2026-04-15T21:59:00Z = 2026-04-15T14:59:00 LA
    // 2026-04-16T00:01:00 Paris = 2026-04-15T22:01:00Z = 2026-04-15T15:01:00 LA
    // → BOTH fall on 2026-04-15 in Los_Angeles.
    await insertEntry({
      content: 'paris-night',
      createdAt: tzDate('2026-04-15T23:59:00', paris),
    });
    await insertEntry({
      content: 'paris-just-past-midnight',
      createdAt: tzDate('2026-04-16T00:01:00', paris),
    });

    const laDay15 = await getPensieveEntriesForDay(
      tzDate('2026-04-15T10:00:00', la),
      la,
    );
    expect(laDay15).toHaveLength(2);
    expect(laDay15.map((r) => r.content).sort()).toEqual([
      'paris-just-past-midnight',
      'paris-night',
    ]);

    // And LA's 2026-04-16 calendar day must contain neither.
    const laDay16 = await getPensieveEntriesForDay(
      tzDate('2026-04-16T10:00:00', la),
      la,
    );
    expect(laDay16).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5 — getContradictionsForDay happy path + JOIN content fidelity
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 5: getContradictionsForDay joins pensieveEntries twice and returns verbatim entry contents', async () => {
    const tz = 'Europe/Paris';
    const aId = await insertEntry({
      content: 'I will quit my job and travel for a year.',
      createdAt: tzDate('2026-04-15T09:00:00', tz),
    });
    const bId = await insertEntry({
      content: 'I am committed to this job for the next 18 months.',
      createdAt: tzDate('2026-04-15T18:00:00', tz),
    });
    await insertContradiction({
      entryAId: aId,
      entryBId: bId,
      description: 'Greg expressed both quitting and committing on the same day.',
      detectedAt: tzDate('2026-04-15T19:30:00', tz),
      status: 'DETECTED',
    });

    const rows = await getContradictionsForDay(
      tzDate('2026-04-15T12:00:00', tz),
      tz,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entryAContent).toBe('I will quit my job and travel for a year.');
    expect(rows[0]!.entryBContent).toBe(
      'I am committed to this job for the next 18 months.',
    );
    expect(rows[0]!.description).toBe(
      'Greg expressed both quitting and committing on the same day.',
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6 — Status filter: only DETECTED rows returned (CONS-09 "flagged")
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 6: getContradictionsForDay filters out RESOLVED/ACCEPTED rows', async () => {
    const tz = 'Europe/Paris';
    const aId = await insertEntry({
      content: 'A',
      createdAt: tzDate('2026-04-15T09:00:00', tz),
    });
    const bId = await insertEntry({
      content: 'B',
      createdAt: tzDate('2026-04-15T10:00:00', tz),
    });
    const cId = await insertEntry({
      content: 'C',
      createdAt: tzDate('2026-04-15T11:00:00', tz),
    });
    const dId = await insertEntry({
      content: 'D',
      createdAt: tzDate('2026-04-15T12:00:00', tz),
    });

    await insertContradiction({
      entryAId: aId,
      entryBId: bId,
      description: 'detected one',
      detectedAt: tzDate('2026-04-15T19:00:00', tz),
      status: 'DETECTED',
    });
    await insertContradiction({
      entryAId: cId,
      entryBId: dId,
      description: 'resolved one',
      detectedAt: tzDate('2026-04-15T20:00:00', tz),
      status: 'RESOLVED',
    });

    const rows = await getContradictionsForDay(
      tzDate('2026-04-15T12:00:00', tz),
      tz,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe('detected one');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7 — getDecisionsForDay captured today (createdToday=true)
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 7: getDecisionsForDay returns decision created today with createdToday=true and resolvedToday=false', async () => {
    const tz = 'Europe/Paris';
    await insertDecision({
      decisionText: 'Schedule housewarming for May 1',
      status: 'open',
      resolveBy: tzDate('2026-05-01T18:00:00', tz),
      createdAt: tzDate('2026-04-15T10:00:00', tz),
    });

    const rows = await getDecisionsForDay(
      tzDate('2026-04-15T12:00:00', tz),
      tz,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.decisionText).toBe('Schedule housewarming for May 1');
    expect(rows[0]!.lifecycleState).toBe('open');
    expect(rows[0]!.createdToday).toBe(true);
    expect(rows[0]!.resolvedToday).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 8 — Decision created earlier, resolved today
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 8: getDecisionsForDay returns decision resolved today but created earlier with createdToday=false, resolvedToday=true', async () => {
    const tz = 'Europe/Paris';
    await insertDecision({
      decisionText: 'Sign the lease this month',
      status: 'resolved',
      resolveBy: tzDate('2026-04-15T12:00:00', tz),
      createdAt: tzDate('2026-04-10T09:00:00', tz),
      resolvedAt: tzDate('2026-04-15T11:30:00', tz),
      resolution: 'signed',
      resolutionNotes: 'lease executed at noon notary',
    });

    const rows = await getDecisionsForDay(
      tzDate('2026-04-15T12:00:00', tz),
      tz,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lifecycleState).toBe('resolved');
    expect(rows[0]!.createdToday).toBe(false);
    expect(rows[0]!.resolvedToday).toBe(true);
    expect(rows[0]!.resolution).toBe('signed');
    expect(rows[0]!.resolutionNotes).toBe('lease executed at noon notary');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 9 — Decision created and resolved on the same day
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 9: getDecisionsForDay sets both flags true when decision is created and resolved same day', async () => {
    const tz = 'Europe/Paris';
    await insertDecision({
      decisionText: 'Buy the new monitor right now',
      status: 'resolved',
      resolveBy: tzDate('2026-04-15T18:00:00', tz),
      createdAt: tzDate('2026-04-15T09:00:00', tz),
      resolvedAt: tzDate('2026-04-15T17:00:00', tz),
      resolution: 'bought',
    });

    const rows = await getDecisionsForDay(
      tzDate('2026-04-15T12:00:00', tz),
      tz,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdToday).toBe(true);
    expect(rows[0]!.resolvedToday).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 10 — open-draft decisions are filtered out (Phase 14 D-15)
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 10: getDecisionsForDay excludes status="open-draft" rows (mid-capture, not committed)', async () => {
    const tz = 'Europe/Paris';
    await insertDecision({
      decisionText: 'Draft only — not yet committed',
      status: 'open-draft',
      resolveBy: tzDate('2026-05-01T18:00:00', tz),
      createdAt: tzDate('2026-04-15T10:00:00', tz),
    });

    const rows = await getDecisionsForDay(
      tzDate('2026-04-15T12:00:00', tz),
      tz,
    );
    expect(rows).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 11 — Decision created and resolved outside the day window
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 11: getDecisionsForDay excludes decision whose createdAt and resolvedAt are both outside the day window', async () => {
    const tz = 'Europe/Paris';
    // Created 2026-04-10, resolved 2026-04-20 — neither falls on 2026-04-15
    await insertDecision({
      decisionText: 'Long-running deliberation',
      status: 'resolved',
      resolveBy: tzDate('2026-04-20T18:00:00', tz),
      createdAt: tzDate('2026-04-10T09:00:00', tz),
      resolvedAt: tzDate('2026-04-20T11:00:00', tz),
      resolution: 'done',
    });

    const rows = await getDecisionsForDay(
      tzDate('2026-04-15T12:00:00', tz),
      tz,
    );
    expect(rows).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 12 — DST correctness: spring-forward 23h, fall-back 25h
  // ──────────────────────────────────────────────────────────────────────────
  it('Test 12: dayBoundaryUtc handles DST — spring-forward day spans 23 hours, fall-back day spans 25 hours', async () => {
    const la = 'America/Los_Angeles';

    // Spring-forward 2026: clocks jump from 02:00 → 03:00 PST → PDT on Sun 2026-03-08.
    // The local day 2026-03-08 spans only 23 hours of UTC.
    const sfInstant = DateTime.fromISO('2026-03-08T12:00:00', { zone: la }).toJSDate();
    const sf = dayBoundaryUtc(sfInstant, la);
    const sfHours = (sf.end.getTime() - sf.start.getTime()) / (60 * 60 * 1000);
    expect(sfHours).toBe(23);

    // Fall-back 2026: clocks fall back from 02:00 → 01:00 PDT → PST on Sun 2026-11-01.
    // The local day 2026-11-01 spans 25 hours of UTC.
    const fbInstant = DateTime.fromISO('2026-11-01T12:00:00', { zone: la }).toJSDate();
    const fb = dayBoundaryUtc(fbInstant, la);
    const fbHours = (fb.end.getTime() - fb.start.getTime()) / (60 * 60 * 1000);
    expect(fbHours).toBe(25);

    // Sanity check: a regular non-DST day in the same zone is exactly 24h.
    const regularInstant = DateTime.fromISO('2026-04-15T12:00:00', { zone: la }).toJSDate();
    const regular = dayBoundaryUtc(regularInstant, la);
    const regularHours =
      (regular.end.getTime() - regular.start.getTime()) / (60 * 60 * 1000);
    expect(regularHours).toBe(24);
  });
});
