/**
 * src/episodic/__tests__/backfill.test.ts — Phase 23 Plan 02 Task 2 (OPS-01).
 *
 * Integration test for scripts/backfill-episodic.ts. Proves:
 *   - First-run happy path: a 3-day range with Pensieve entries seeded for each
 *     day inserts exactly 3 episodic_summaries rows.
 *   - Second-run idempotency (Phase 23 Success Criterion #2): re-running the
 *     same range results in 0 new inserts, all 3 days skipped, and Sonnet is
 *     NOT re-invoked (Phase 21 CONS-03 pre-flight SELECT short-circuits
 *     before mockAnthropicParse is even called).
 *   - Zero-entry day (CONS-02): a day with no Pensieve entries is skipped via
 *     the entry-count gate, not errored.
 *
 * Architecture mirrors src/episodic/__tests__/synthetic-fixture.test.ts (Plan
 * 23-01): real Docker Postgres + mocked Anthropic SDK + mocked bot.api.sendMessage.
 *
 * Run: DATABASE_URL=... npx vitest run src/episodic/__tests__/backfill.test.ts
 *
 * D-02 (inherited from Phase 18): vi.setSystemTime ONLY — vi.useFakeTimers is
 * FORBIDDEN (replaces setTimeout/setInterval, breaks postgres.js keep-alive).
 *
 * ConsolidateResult contract reconciliation (same as Plan 23-01 TEST-19):
 *   - { inserted: true; id: string }
 *   - { skipped: 'existing' | 'no-entries' }
 *   - { failed: true; error: unknown }
 * The backfill counts { skipped: 'existing' } and { skipped: 'no-entries' }
 * both as `skipped` in its aggregate totals (both are normal no-op outcomes
 * from the engine's point of view).
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from 'vitest';
import { sql, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, sql as pgSql } from '../../db/connection.js';
import { pensieveEntries, episodicSummaries } from '../../db/schema.js';
import type { EpisodicSummarySonnetOutput } from '../types.js';

// ── Hoisted mocks ───────────────────────────────────────────────────────────
//
// Same pattern as synthetic-fixture.test.ts (Plan 23-01) and consolidate.test.ts
// (Plan 21-04). The Anthropic SDK's messages.parse(...) is the surface
// runConsolidate calls via zodOutputFormat; mocking it here keeps the backfill
// deterministic without needing a real API key.

const { mockAnthropicParse, mockSendMessage } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined as unknown as void),
}));

vi.mock('../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: {
        parse: mockAnthropicParse,
        create: vi.fn(),
      },
    },
  };
});

vi.mock('../../bot/bot.js', () => ({
  bot: {
    api: { sendMessage: mockSendMessage },
  },
}));

// ── Module imports (AFTER mocks) ────────────────────────────────────────────
//
// Import from the script at `scripts/backfill-episodic.ts`. The `.js`
// extension matches the rest of the test suite's ESM convention; vitest +
// esbuild resolve the .ts source at runtime. tsconfig excludes __tests__/**
// so the cross-directory import is a runtime concern, not a tsc-compile one.
import { runBackfill } from '../../../scripts/backfill-episodic.js';

// ── Shared constants ─────────────────────────────────────────────────────────

/** Three consecutive historical dates in the past (backfill requires past). */
const FIXTURE_DATES = ['2026-04-01', '2026-04-02', '2026-04-03'] as const;
const FIXTURE_TZ = 'Europe/Paris';
/** Distinct from the 9992X synthetic-fixture band. */
const FIXTURE_CHAT_ID = BigInt(99924);

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build a JS Date for an ISO wall-clock instant in a specific IANA timezone. */
function tzDate(iso: string, tz: string): Date {
  return DateTime.fromISO(iso, { zone: tz }).toJSDate();
}

/**
 * Insert N pensieve entries for a calendar date in `tz`. createdAt spreads
 * across the day's wall-clock window starting at 09:00 local, +1h per entry.
 * Same shape as synthetic-fixture.test.ts's seedPensieveEntries helper.
 */
async function seedPensieveEntries(opts: {
  date: string;
  tz: string;
  entries: Array<{ content: string; epistemicTag: 'FACT' | 'EMOTION' | 'EXPERIENCE' }>;
}): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < opts.entries.length; i++) {
    const e = opts.entries[i]!;
    const hh = String(9 + i).padStart(2, '0');
    const createdAt = tzDate(`${opts.date}T${hh}:00:00`, opts.tz);
    const [row] = await db
      .insert(pensieveEntries)
      .values({
        content: e.content,
        epistemicTag: e.epistemicTag,
        createdAt,
        source: 'backfill-test',
      })
      .returning({ id: pensieveEntries.id });
    ids.push(row!.id);
  }
  return ids;
}

/**
 * Build a valid Sonnet output payload for each fixture day. The `summary`
 * field is >= 50 chars to satisfy the Zod EpisodicSummarySonnetOutputSchema
 * minimum. `importance` is 3 (no decision / no contradiction, so neither
 * CONS-06 nor CONS-07 floor applies; the raw 3 flows through).
 */
function buildSonnetOutputForDay(dayIndex: number): EpisodicSummarySonnetOutput {
  return {
    summary: `Backfill fixture summary for day ${dayIndex}, a routine day with steady but unremarkable activity across the afternoon.`,
    // IN-04: clamp to the Zod max(10) so a future extension of FIXTURE_DATES
    // beyond 7 days doesn't silently crash validation. Current FIXTURE_DATES
    // is 3 days (values 3/4/5 within rubric), so the clamp is a no-op today.
    importance: Math.min(3 + dayIndex, 10),
    topics: ['routine', 'backfill-test'],
    emotional_arc: 'flat and productive',
    key_quotes: [],
  };
}

function mockParseResponseFor(
  output: EpisodicSummarySonnetOutput,
): { parsed_output: EpisodicSummarySonnetOutput } {
  return { parsed_output: output };
}

/**
 * Cleanup for the backfill fixture. FK-safe order — contradictions reference
 * pensieve_entries, but we seed no contradictions here; a TRUNCATE of
 * episodic_summaries with CASCADE and a scoped DELETE of our pensieve entries
 * (by source='backfill-test') is sufficient. We do NOT TRUNCATE pensieve_entries
 * because other test files may have rows in flight under vitest's
 * fileParallelism: false (serial) execution; we scope to our source.
 */
async function cleanupBackfillFixture(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  await db.delete(pensieveEntries).where(eq(pensieveEntries.source, 'backfill-test'));
}

// ════════════════════════════════════════════════════════════════════════════
// File-level lifecycle
// ════════════════════════════════════════════════════════════════════════════

beforeAll(async () => {
  // Smoke: DB must be reachable before any cleanup runs.
  const probe = await pgSql`SELECT 1 as ok`;
  expect(probe[0]!.ok).toBe(1);
});

afterAll(async () => {
  await cleanupBackfillFixture();
});

// ════════════════════════════════════════════════════════════════════════════
// OPS-01 backfill integration tests
// ════════════════════════════════════════════════════════════════════════════

describe('OPS-01: scripts/backfill-episodic.ts integration', () => {
  beforeEach(async () => {
    mockAnthropicParse.mockReset();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue(undefined as unknown as void);
    await cleanupBackfillFixture();
  });

  it(
    'first run: inserts one episodic_summaries row per fixture date (3-day range)',
    async () => {
      // Seed 2 Pensieve entries per fixture day so CONS-02 entry-count gate
      // is satisfied for each day.
      for (const date of FIXTURE_DATES) {
        await seedPensieveEntries({
          date,
          tz: FIXTURE_TZ,
          entries: [
            { content: `Morning entry for ${date}: steady inbox triage.`, epistemicTag: 'FACT' },
            {
              content: `Afternoon entry for ${date}: felt calm, productive afternoon.`,
              epistemicTag: 'EMOTION',
            },
          ],
        });
      }

      // Queue 3 distinct Sonnet outputs — one per day. runConsolidate calls
      // messages.parse once per day (no retry path triggered for valid output).
      for (let i = 0; i < 3; i++) {
        mockAnthropicParse.mockResolvedValueOnce(
          mockParseResponseFor(buildSonnetOutputForDay(i)),
        );
      }

      // delayMs: 0 short-circuits the 2s inter-day sleep in tests. The CLI
      // default stays 2000 (enforced in Task 1 / scripts/backfill-episodic.ts).
      const result = await runBackfill('2026-04-01', '2026-04-03', { delayMs: 0 });

      expect(result.total).toBe(3);
      expect(result.inserted).toBe(3);
      expect(result.skipped).toBe(0);
      expect(result.errored).toBe(0);

      // Sonnet called exactly 3 times — once per day, no retries.
      expect(mockAnthropicParse).toHaveBeenCalledTimes(3);

      // Three episodic_summaries rows exist, one per date.
      const rows = await db
        .select()
        .from(episodicSummaries)
        .where(inArray(episodicSummaries.summaryDate, [...FIXTURE_DATES]));
      expect(rows).toHaveLength(3);

      // Importance flows through unclamped (no decision, no contradiction
      // for these days — neither CONS-06 nor CONS-07 applies; the mocked
      // importances 3/4/5 land exactly).
      const byDate = new Map(rows.map((r) => [r.summaryDate, r.importance]));
      expect(byDate.get('2026-04-01')).toBe(3);
      expect(byDate.get('2026-04-02')).toBe(4);
      expect(byDate.get('2026-04-03')).toBe(5);
    },
    30_000,
  );

  it(
    'second run is idempotent: 0 new inserts, all 3 skipped, Sonnet NOT re-invoked (Phase 23 SC#2)',
    async () => {
      // Set up the SAME state as the first test: 3 days of entries + 3 rows.
      // We inline the setup because beforeEach just cleaned everything.
      for (const date of FIXTURE_DATES) {
        await seedPensieveEntries({
          date,
          tz: FIXTURE_TZ,
          entries: [
            { content: `Morning entry for ${date}: steady inbox triage.`, epistemicTag: 'FACT' },
            {
              content: `Afternoon entry for ${date}: felt calm, productive afternoon.`,
              epistemicTag: 'EMOTION',
            },
          ],
        });
      }

      // First run — queue 3 outputs and insert.
      for (let i = 0; i < 3; i++) {
        mockAnthropicParse.mockResolvedValueOnce(
          mockParseResponseFor(buildSonnetOutputForDay(i)),
        );
      }
      const first = await runBackfill('2026-04-01', '2026-04-03', { delayMs: 0 });
      expect(first.inserted).toBe(3);
      expect(mockAnthropicParse).toHaveBeenCalledTimes(3);

      // Reset the Sonnet mock so we can prove the second run makes ZERO calls.
      // Do NOT queue any new responses — CONS-03's pre-flight SELECT should
      // short-circuit before runConsolidate reaches callSonnetWithRetry.
      mockAnthropicParse.mockClear();

      const result = await runBackfill('2026-04-01', '2026-04-03', { delayMs: 0 });

      expect(result.total).toBe(3);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(3);
      expect(result.errored).toBe(0);

      // The core idempotency assertion: zero Sonnet calls on the second run.
      // Phase 21 CONS-03's pre-flight SELECT at consolidate.ts L216-227
      // returns { skipped: 'existing' } BEFORE hitting messages.parse.
      expect(mockAnthropicParse).toHaveBeenCalledTimes(0);

      // Row count unchanged — the three first-run rows are still the only
      // rows in episodic_summaries for these dates.
      const rows = await db
        .select()
        .from(episodicSummaries)
        .where(inArray(episodicSummaries.summaryDate, [...FIXTURE_DATES]));
      expect(rows).toHaveLength(3);
    },
    30_000,
  );

  it(
    'zero-entry day is skipped via CONS-02, not errored; surrounding days still insert',
    async () => {
      // Seed entries for day 1 and day 3 only; day 2 has NO entries. The
      // backfill walks all three days; day 2 goes through CONS-02's entry-count
      // gate at consolidate.ts L229-237 and returns { skipped: 'no-entries' }.
      await seedPensieveEntries({
        date: FIXTURE_DATES[0],
        tz: FIXTURE_TZ,
        entries: [
          { content: 'Day 1 morning entry.', epistemicTag: 'FACT' },
          { content: 'Day 1 afternoon entry.', epistemicTag: 'EXPERIENCE' },
        ],
      });
      await seedPensieveEntries({
        date: FIXTURE_DATES[2],
        tz: FIXTURE_TZ,
        entries: [
          { content: 'Day 3 morning entry.', epistemicTag: 'FACT' },
          { content: 'Day 3 afternoon entry.', epistemicTag: 'EXPERIENCE' },
        ],
      });

      // Queue exactly 2 Sonnet outputs — one each for day 1 and day 3. Day 2
      // must NOT call Sonnet (the mock would throw on unexpected invocation
      // anyway since nothing is queued; expected Sonnet call count is 2).
      mockAnthropicParse.mockResolvedValueOnce(
        mockParseResponseFor(buildSonnetOutputForDay(0)),
      );
      mockAnthropicParse.mockResolvedValueOnce(
        mockParseResponseFor(buildSonnetOutputForDay(2)),
      );

      const result = await runBackfill('2026-04-01', '2026-04-03', { delayMs: 0 });

      expect(result.total).toBe(3);
      // Two days inserted, one day skipped (CONS-02), zero errors.
      expect(result.inserted).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.errored).toBe(0);

      // Sonnet called exactly twice (days 1 and 3 only).
      expect(mockAnthropicParse).toHaveBeenCalledTimes(2);

      // Exactly 2 rows in episodic_summaries — day 2 never materialized.
      const rows = await db
        .select()
        .from(episodicSummaries)
        .where(inArray(episodicSummaries.summaryDate, [...FIXTURE_DATES]));
      expect(rows).toHaveLength(2);

      const dates = rows.map((r) => r.summaryDate).sort();
      expect(dates).toEqual(['2026-04-01', '2026-04-03']);
    },
    30_000,
  );
});
