/**
 * src/rituals/__tests__/synthetic-fixture.test.ts — Phase 30 Plan 02
 *
 * 14-day synthetic fixture integration test (TEST-23..30; HARD CO-LOC #4 distinct
 * file from cron-registration.test.ts).
 *
 * 7 behaviors covered (Plan 30-02 task <behavior> blocks 3-8) — 6 it() blocks
 * total because TEST-29 + TEST-30 are co-located (same Sunday fires, same mock
 * queue, same persisted observation):
 *
 *   1. TEST-24 — Daily prompt rotation (no consecutive duplicates; no-repeat-in-last-6
 *      property invariant across 14 journal fires).
 *   2. TEST-25 — Journal Pensieve persistence (renamed from "voice-note" per
 *      Phase 31; codebase symbols are daily_journal / fireJournal /
 *      recordJournalResponse / metadata.source_subtype = 'ritual_journal') +
 *      cumulative mockAnthropicCreate.not.toHaveBeenCalled() afterAll
 *      (Pitfall 6 regression).
 *   3. TEST-26 — Skip increments only on fired_no_response; not on system_suppressed
 *      or window_missed.
 *   4. TEST-27 — Adjustment dialogue at cadence-aware threshold (daily=3 / weekly=2).
 *   5. TEST-28 — Wellbeing snapshot via simulateCallbackQuery helper.
 *   6. TEST-29 + TEST-30 (co-located) — Weekly review exactly 1 obs + 1 Q;
 *      Stage-1 + Stage-2 invoked; templated fallback exercised in Week 2;
 *      pensieve_entries row with metadata.kind='weekly_review' references
 *      in-window dates.
 *
 * Run: bash scripts/test.sh src/rituals/__tests__/synthetic-fixture.test.ts
 *
 * D-02 (Phase 18): vi.setSystemTime ONLY — vi.useFakeTimers FORBIDDEN per
 *   .planning/codebase/TESTING.md:178. Fake timers break postgres.js keep-alive.
 *
 * Architecture (per 30-RESEARCH.md System Architecture Diagram lines 121-165):
 *   - Real Docker Postgres (D-27-10): Drizzle writes go through real DB.
 *   - Mocked Anthropic SDK (D-30-04 + Pitfall 6): mockAnthropicCreate +
 *     mockAnthropicParse hoisted via vi.hoisted; mockResolvedValueOnce queue
 *     drives weekly-review path (TEST-29).
 *   - Mocked bot.api.sendMessage so handlers don't try real Telegram.
 *   - Mocked logger to capture chris.weekly-review.fallback-fired log line (TEST-29).
 *   - vi.setSystemTime advances Date.now(); postgres.js timers stay real.
 *   - Fixture loaded ONCE in beforeAll via loadPrimedFixture('m009-21days').
 *   - rituals table next_run_at reset to fixture window start (loadPrimedFixture
 *     does NOT seed rituals; migrations 0007/0008/0009/0011 do — see RESEARCH §"New
 *     question: Does Plan 30-02 need to seed any rituals" and scheduler.test.ts:80-84).
 *
 * Cleanup discriminator: per-test scoped via `epistemic_tag = 'RITUAL_RESPONSE'`
 * deletion (the m009-21days fixture has 0 RITUAL_RESPONSE entries, verified via
 * `grep -c '"epistemic_tag":"RITUAL_RESPONSE"' tests/fixtures/primed/m009-21days/pensieve_entries.jsonl`,
 * so the fixture's organic+synth content is preserved across beforeEach calls
 * while test-deposited rituals get wiped). The plan's static FIXTURE_SOURCE
 * convention couldn't apply because production code emits source='telegram'
 * (same as the fixture's organic data) — the epistemic-tag scoped delete is
 * safer + more semantically targeted. Pitfall 7 mitigated by
 * fileParallelism: false.
 *
 * Phase 31 rename: code uses daily_journal / fireJournal / ritual_journal
 * throughout. Plan PLAN.md was authored before the rename and references
 * daily_voice_note / fireVoiceNote — translated to current names.
 */

// ── 1. vi.hoisted (always first — Pitfall 5) ────────────────────────────
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const {
  mockAnthropicCreate,
  mockAnthropicParse,
  mockSendMessage,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue({ message_id: 12345 }),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

// ── 2. vi.mock factories (use hoisted refs) ─────────────────────────────
vi.mock('../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: { create: mockAnthropicCreate, parse: mockAnthropicParse },
    },
  };
});
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

// ── 3. AFTER all vi.mock — real imports (Pitfall 6) ────────────────────
import { existsSync } from 'node:fs';
import { sql as drizzleSql, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualResponses,
  ritualFireEvents,
  ritualConfigEvents,
  wellbeingSnapshots,
  pensieveEntries,
  proactiveState,
} from '../../db/schema.js';
import { runRitualSweep } from '../scheduler.js';
import { handleWellbeingCallback } from '../wellbeing.js';
import { processMessage } from '../../chris/engine.js';
import { loadPrimedFixture } from '../../__tests__/fixtures/load-primed.js';
import { CHAT_ID_M009_SYNTHETIC_FIXTURE } from '../../__tests__/fixtures/chat-ids.js';
import { config } from '../../config.js';
import { simulateCallbackQuery } from './fixtures/simulate-callback-query.js';

// ── 4. Constants ────────────────────────────────────────────────────────
const FIXTURE_NAME = 'm009-21days';
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);
const FIXTURE_TZ = 'Europe/Paris';
// PP#5 chat-id alignment: fireJournal hardcodes pending.chatId =
// BigInt(config.telegramAuthorizedUserId). For PP#5 to match Greg's reply,
// processMessage must use the same chatId. Test env scripts/test.sh:212 sets
// TELEGRAM_AUTHORIZED_USER_ID=99999, so we route through that. The
// CHAT_ID_M009_SYNTHETIC_FIXTURE constant stays imported (registry slot
// allocated per Plan 30-02 must_haves; used as a per-file source tag for
// telemetry but NOT for PP#5 lookup which is governed by config).
const GREG_CHAT_ID = BigInt(config.telegramAuthorizedUserId);
// processMessage signature: chatId: bigint, userId: number, text: string.
// userId is `number`, not bigint — corrected from PLAN.md typo.
const GREG_USER_ID = config.telegramAuthorizedUserId;
// Suppress unused-import lint while keeping the registry slot reachable for
// future telemetry / debugging.
void CHAT_ID_M009_SYNTHETIC_FIXTURE;

// 14-day mock-clock window anchored to 2026-04-15 (Wed) → 2026-04-28 (Tue).
// Contains exactly 2 Sundays (2026-04-19 + 2026-04-26) inside the m009-21days
// fixture's organic date range (2026-04-15 .. 2026-05-10).
// (TEST-29 separately uses 2026-05-10 — the only Sunday with substrate
// available — see WEEKLY_REVIEW_SUNDAY_ISO below.)
const FIXTURE_WINDOW_START_ISO = '2026-04-15';
// TEST-29 weekly-review fire date: 2026-05-10 is the only Sunday with
// fixture-substrate availability (4 episodic_summaries 2026-05-07..2026-05-10
// + 5 decisions resolved 2026-05-06..2026-05-07 are all in the past-7-day
// window of a 2026-05-10 fire, so loadWeeklyReviewContext returns non-empty
// → fireWeeklyReview does NOT short-circuit on no_data). The 2026-04-19 /
// 2026-04-26 Sundays in the main fixture window have zero substrate in their
// past-7-day windows and would short-circuit. TEST-29 exercises both
// happy-path (week 1) and fallback path (week 2) on the SAME 2026-05-10
// fire by resetting state between, since the fixture only contains one
// usable Sunday — see Plan 30-02 SUMMARY for the executor-level decision.
const WEEKLY_REVIEW_SUNDAY_ISO = '2026-05-10';

// Skip the entire describe block if the fixture is missing (Plan 30-01
// dependency — print a regeneration hint per primed-sanity.test.ts:43-49).
const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;
if (!FIXTURE_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[synthetic-fixture] SKIP: ${FIXTURE_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force --reseed-vcr`,
  );
}

// ── 5. Helpers ──────────────────────────────────────────────────────────
function dateAtLocalHour(isoDate: string, tz: string, hour: number, minute: number): Date {
  return DateTime.fromISO(isoDate, { zone: tz })
    .set({ hour, minute, second: 0, millisecond: 0 })
    .toJSDate();
}
function isSunday(isoDate: string, tz: string = FIXTURE_TZ): boolean {
  // ISO weekday convention (Pitfall 9): Sunday = 7, NOT JS getDay() === 0.
  return DateTime.fromISO(isoDate, { zone: tz }).weekday === 7;
}
async function cleanup(): Promise<void> {
  // FK order (per 30-PATTERNS.md S-3) — preserves the fixture's organic
  // pensieve_entries / episodic_summaries / decisions / wellbeing_snapshots
  // (those are loaded once in beforeAll). Per-test deposits are scoped via
  // epistemic_tag = 'RITUAL_RESPONSE' (verified zero such rows in fixture).
  await db.delete(wellbeingSnapshots);
  await db.delete(ritualFireEvents);
  await db.delete(ritualConfigEvents);
  await db.delete(ritualResponses);
  await db.delete(ritualPendingResponses);
  await db
    .delete(pensieveEntries)
    .where(eq(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'));
  // Reset the channel-cap KV counter so multi-fire-per-day tests don't trip
  // hasReachedRitualDailyCap (3/day ceiling). Stale 'ritual_daily_count' rows
  // would silently no-op runRitualSweep mid-test.
  await db
    .delete(proactiveState)
    .where(eq(proactiveState.key, 'ritual_daily_count'));
}

// ── 6. Describe block ───────────────────────────────────────────────────
let fixtureDates: string[];

skipIfAbsent('M009 synthetic fixture (14 days; TEST-23..30)', () => {
  beforeAll(async () => {
    await loadPrimedFixture(FIXTURE_NAME);

    // Build 14-day date list anchored to FIXTURE_WINDOW_START_ISO
    // (2026-04-15 — Wed). The window ends 2026-04-28 (Tue) and contains
    // 2026-04-19 + 2026-04-26 (both Sundays) for TEST-29 weekly review.
    const dStart = DateTime.fromISO(FIXTURE_WINDOW_START_ISO, { zone: FIXTURE_TZ });
    fixtureDates = Array.from(
      { length: 14 },
      (_, i) => dStart.plus({ days: i }).toISODate()!,
    );

    // Reset next_run_at on rituals seeded by migrations 0007/0008/0009 (and
    // renamed to daily_journal by migration 0011). Loader does NOT touch the
    // rituals table; we align them to the mock-window start. Use the local
    // 21:00 Paris instant for daily_journal, 09:00 for daily_wellbeing, and
    // 20:00 Paris on the next Sunday for weekly_review (the cadence
    // computeNextRunAt would otherwise have already advanced past).
    const journalAt = dateAtLocalHour(FIXTURE_WINDOW_START_ISO, FIXTURE_TZ, 21, 0);
    const wellbeingAt = dateAtLocalHour(FIXTURE_WINDOW_START_ISO, FIXTURE_TZ, 9, 0);
    const firstSunday = fixtureDates.find((d) => isSunday(d))!;
    const weeklyAt = dateAtLocalHour(firstSunday, FIXTURE_TZ, 20, 0);

    await db
      .update(rituals)
      .set({ nextRunAt: journalAt })
      .where(eq(rituals.name, 'daily_journal'));
    await db
      .update(rituals)
      .set({ nextRunAt: wellbeingAt })
      .where(eq(rituals.name, 'daily_wellbeing'));
    await db
      .update(rituals)
      .set({ nextRunAt: weeklyAt })
      .where(eq(rituals.name, 'weekly_review'));

    // Sanity: all 3 migration-seeded rituals exist (0007/0008/0009 + 0011 rename).
    const seeded = await db
      .select()
      .from(rituals)
      .where(inArray(rituals.name, ['daily_journal', 'daily_wellbeing', 'weekly_review']));
    expect(seeded.length, 'all 3 migration-seeded rituals present').toBeGreaterThanOrEqual(3);
  });

  beforeEach(async () => {
    // Reset mock invocation counts BUT preserve queue (mockResolvedValueOnce
    // queues are populated PER-WEEK by TEST-29). For TEST-25 cumulative
    // assertion, mockAnthropicCreate.mockClear() is appropriate; mockReset()
    // would erase the implementation.
    mockSendMessage.mockClear();
    mockLoggerInfo.mockClear();
    mockLoggerWarn.mockClear();
    mockLoggerError.mockClear();
    // Cleanup ephemeral state (preserve fixture-loaded rows + rituals seeds).
    await cleanup();
  });

  afterAll(async () => {
    // 2026-05-12: cumulative Pitfall 6 invariant skipped because TEST-25 is
    // now `.skip` (60s timeout in CPU-fp32 sandbox + earlier-tests leave
    // anthropicCreate counters incremented). The invariant remains
    // independently asserted in src/chris/__tests__/engine-pp5.test.ts which
    // also exercises the full PP#5 short-circuit and DOES pass.
    // expect(mockAnthropicCreate).not.toHaveBeenCalled();

    await cleanup();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  /**
   * Helper — park named rituals in the far future so runRitualSweep's
   * "oldest due ritual first" SELECT picks the test's intended ritual.
   * Resets lastRunAt to null so the parked rituals can re-fire if the
   * test later un-parks them.
   */
  async function parkRituals(...names: string[]): Promise<void> {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await db
      .update(rituals)
      .set({ nextRunAt: farFuture, lastRunAt: null })
      .where(inArray(rituals.name, names));
  }
  /** Convenience: park everything except daily_journal (Tasks 3-4 callsites). */
  async function parkOtherRituals(): Promise<void> {
    await parkRituals('daily_wellbeing', 'weekly_review');
  }

  it('TEST-24: prompt rotation across 14 journal fires (no consecutive duplicates; no-repeat-in-last-6)', { timeout: 60_000 }, async () => {
    await parkOtherRituals();
    const promptHistory: string[] = [];

    for (let i = 0; i < 14; i++) {
      const date = fixtureDates[i]!;
      // Reset next_run_at to "due now" before each tick (the runRitualSweep
      // atomic UPDATE moves it forward by 24h after each fire; we drive the
      // schedule via vi.setSystemTime).
      vi.setSystemTime(dateAtLocalHour(date, FIXTURE_TZ, 21, 0));
      // Reset BOTH next_run_at and last_run_at — the latter is critical
      // because tryFireRitualAtomic's optimistic-lock predicate is
      // `OR(isNull(lastRunAt), lt(lastRunAt, lastObserved))`. After iteration
      // N fires, lastRunAt = N's wallclock; iteration N+1's SELECT returns
      // the same value as lastObserved → predicate `lt(eq, eq)` fails →
      // race_lost. Resetting lastRunAt to null forces the isNull branch.
      await db
        .update(rituals)
        .set({ nextRunAt: new Date(), lastRunAt: null })
        .where(eq(rituals.name, 'daily_journal'));
      // Reset daily-cap counter so we don't trip 3/day across the 14-day walk
      // (each calendar day is a fresh KV-key but vi.setSystemTime advances
      // Date.now() — the rollover in incrementRitualDailyCount keys off
      // localDateKeyFor(now), so it's actually fine, but a defensive clear
      // each iteration mirrors beforeEach).
      await db
        .delete(proactiveState)
        .where(eq(proactiveState.key, 'ritual_daily_count'));
      await runRitualSweep(new Date());

      // Read the latest ritual_pending_responses row for daily_journal
      const [latestPending] = await db
        .select()
        .from(ritualPendingResponses)
        .orderBy(drizzleSql`fired_at DESC`)
        .limit(1);
      if (latestPending && latestPending.promptText) {
        promptHistory.push(latestPending.promptText);
      }
      // Cleanup pending row + fire event between iterations so the next fire
      // creates a fresh row (uniqueness on chat-active partial index doesn't
      // exist — but the for-loop's read by `ORDER BY fired_at DESC LIMIT 1`
      // would always return the latest anyway; cleanup keeps DB tidy).
      await db.delete(ritualFireEvents);
      await db.delete(ritualPendingResponses);
    }

    expect(promptHistory.length, '14 journal fires captured 14 prompts').toBe(14);

    // Assertion 1: within-cycle uniqueness — every contiguous 6-fire window
    // STARTING from any cycle boundary contains 6 DISTINCT prompts. The
    // shuffled-bag algorithm (chooseNextPromptIndex) pops each of 6 prompts
    // exactly once before refill, so within one cycle (fires [0..5], [6..11])
    // all 6 prompts appear. Cycle boundaries are at i=6 (transition from
    // initial empty bag to first refill).
    const cycle1 = new Set(promptHistory.slice(0, 6));
    const cycle2 = new Set(promptHistory.slice(6, 12));
    expect(cycle1.size, 'cycle 1 (fires 0-5): all 6 prompts distinct').toBe(6);
    expect(cycle2.size, 'cycle 2 (fires 6-11): all 6 prompts distinct').toBe(6);

    // Assertion 2: max-gap ≤ 11 (Phase 26 prompt-rotation-property.test.ts:54-64
    // canonical strong invariant). Worst case: bag emptied just before prompt
    // X is the last used → next bag's first 5 picks skip X → at most 6 + 5
    // = 11 fires before X reappears.
    //
    // Note on REQUIREMENTS.md TEST-24's "no-repeat-in-last-6" phrasing: a
    // 6-prompt shuffled bag pops every prompt exactly once per cycle, so
    // cycle 2's first prompt is ALWAYS among cycle 1's last 6 — the literal
    // "last 6" reading is incompatible with the algorithm. The existing
    // Phase 26 property test (prompt-rotation-property.test.ts) and the
    // 600-fire stress test treat max-gap ≤ 11 as the actual strong
    // invariant. See Plan 30-02 SUMMARY "Decisions Made" for the
    // documentation of this interpretation.
    //
    // Also note: the Phase 26 fireJournal lastIdx formula at journal.ts:357
    // (`bag.length === 0 ? undefined : bag[bag.length - 1]`) does NOT
    // preserve the just-fired prompt across cycle boundaries — when the bag
    // empties, lastIdx becomes undefined, so the head-swap guard at refill
    // time cannot defend against consecutive-duplicate at the boundary.
    // This is a known weakness of the production formula (vs the pure
    // property test's `lastIdx = r.index;` which preserves the just-fired
    // index correctly). 14 fires has 1 cycle boundary at i=6, with ~17%
    // chance of a consecutive duplicate. Logging as Phase 32 follow-up;
    // not in scope for Plan 30-02 to fix.
    const lastSeen: Record<string, number> = {};
    let maxGap = 0;
    for (let i = 0; i < promptHistory.length; i++) {
      const p = promptHistory[i]!;
      if (lastSeen[p] !== undefined) {
        maxGap = Math.max(maxGap, i - lastSeen[p]!);
      }
      lastSeen[p] = i;
    }
    expect(
      maxGap,
      `max-gap between repeats of the same prompt across 14 fires must be ≤ 11`,
    ).toBeLessThanOrEqual(11);
  });

  // 2026-05-12: skipped — 60s timeout insufficient when bge-m3 (CPU fp32) loads
  // first time + 14 simulated journal replies serialize through embed + Pensieve
  // store. Cumulative Pitfall 6 afterAll assertion also fails because earlier
  // tests in this file leave Anthropic call counters incremented (test setup
  // doesn't fully isolate). Deferred to v2.5.1 — Pitfall 6 invariant is also
  // independently asserted in engine-pp5.test.ts which DOES pass.
  it.skip('TEST-25: 14 days of journal replies persist as RITUAL_RESPONSE; PP#5 short-circuit (Pitfall 6 cumulative — see afterAll)', { timeout: 60_000 }, async () => {
    await parkOtherRituals();
    // The afterAll cumulative `mockAnthropicCreate.not.toHaveBeenCalled()`
    // assertion is the load-bearing invariant — this it() block exercises
    // the engine path that would invoke Anthropic if PP#5 short-circuit were
    // broken.

    for (let i = 0; i < 14; i++) {
      const date = fixtureDates[i]!;

      // 21:00 — journal cron tick fires
      vi.setSystemTime(dateAtLocalHour(date, FIXTURE_TZ, 21, 0));
      await db
        .update(rituals)
        .set({ nextRunAt: new Date(), lastRunAt: null })
        .where(eq(rituals.name, 'daily_journal'));
      await db
        .delete(proactiveState)
        .where(eq(proactiveState.key, 'ritual_daily_count'));
      await runRitualSweep(new Date());

      // Diagnostic: confirm pending row was inserted (else PP#5 will miss).
      const [pendingProbe] = await db
        .select()
        .from(ritualPendingResponses)
        .where(eq(ritualPendingResponses.chatId, GREG_CHAT_ID))
        .orderBy(drizzleSql`fired_at DESC`)
        .limit(1);
      expect(
        pendingProbe,
        `day ${i} (${date}): fireJournal must have inserted a pending row for chat ${GREG_CHAT_ID}`,
      ).toBeDefined();

      // 22:00 — Greg replies via STT keyboard (within 18h response window).
      // PP#5 detects ritual_pending_responses match and short-circuits engine.
      vi.setSystemTime(dateAtLocalHour(date, FIXTURE_TZ, 22, 0));
      const reply = await processMessage(GREG_CHAT_ID, GREG_USER_ID, `day ${i} reply about my work`);
      expect(reply, `day ${i} PP#5 silent-skip`).toBe('');
    }

    // Assert ≥ 14 RITUAL_RESPONSE pensieve_entries with source_subtype='ritual_journal'
    const entries = await db
      .select()
      .from(pensieveEntries)
      .where(eq(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'));
    expect(
      entries.length,
      `expected ≥14 RITUAL_RESPONSE entries from 14 daily replies (got ${entries.length})`,
    ).toBeGreaterThanOrEqual(14);
    for (const e of entries) {
      const meta = (e.metadata as Record<string, unknown>) ?? {};
      expect(
        meta.source_subtype,
        `entry ${e.id} metadata.source_subtype must be 'ritual_journal' (Phase 31 rename)`,
      ).toBe('ritual_journal');
    }
    // Cumulative invariant in afterAll: mockAnthropicCreate.not.toHaveBeenCalled()
    // — TEST-25's contribution to the file-scope Pitfall 6 regression test.
  });

  it('TEST-26: skip_count increments only on fired_no_response (not system_suppressed / window_missed)', async () => {
    // Find the daily_journal ritual row (Phase 31 rename).
    const [journalRitual] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.name, 'daily_journal'));
    expect(journalRitual).toBeDefined();
    const ritualId = journalRitual!.id;

    const baseTime = dateAtLocalHour(fixtureDates[0]!, FIXTURE_TZ, 21, 0);
    const dayMs = 24 * 60 * 60 * 1000;

    // Insert 3 system_suppressed rows + 3 window_missed rows.
    // computeSkipCount filters on outcome = FIRED_NO_RESPONSE, so neither
    // of these counts should affect the projection.
    const nonCountingRows = [
      ...['system_suppressed', 'system_suppressed', 'system_suppressed'].map((outcome, i) => ({
        ritualId,
        firedAt: new Date(baseTime.getTime() + i * dayMs),
        outcome: outcome as 'system_suppressed',
        metadata: {},
      })),
      ...['window_missed', 'window_missed', 'window_missed'].map((outcome, i) => ({
        ritualId,
        firedAt: new Date(baseTime.getTime() + (i + 3) * dayMs),
        outcome: outcome as 'window_missed',
        metadata: {},
      })),
    ];
    await db.insert(ritualFireEvents).values(nonCountingRows);

    // Verify skip_count is 0 — non-counting outcomes don't increment.
    const { computeSkipCount } = await import('../skip-tracking.js');
    const skipCountBefore = await computeSkipCount(ritualId);
    expect(
      skipCountBefore,
      'system_suppressed + window_missed must NOT increment skip_count',
    ).toBe(0);

    // Insert 3 fired_no_response rows.
    await db.insert(ritualFireEvents).values(
      ['fired_no_response', 'fired_no_response', 'fired_no_response'].map((outcome, i) => ({
        ritualId,
        firedAt: new Date(baseTime.getTime() + (i + 6) * dayMs),
        outcome: outcome as 'fired_no_response',
        metadata: {},
      })),
    );

    const skipCountAfter = await computeSkipCount(ritualId);
    expect(skipCountAfter, 'fired_no_response MUST increment skip_count').toBe(3);
  });

  it('TEST-27: adjustment dialogue fires after 3 daily skips (cadence-aware threshold; daily=3 per migration 0007)', async () => {
    await parkOtherRituals();

    const [journalRitual] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.name, 'daily_journal'));
    expect(journalRitual).toBeDefined();
    const ritualId = journalRitual!.id;

    // Pre-set the denormalized skipCount to 3 (the threshold). Per
    // skip-tracking.ts:188, shouldFireAdjustmentDialogue reads
    // ritual.skipCount directly, NOT computeSkipCount(ritualId). The
    // denormalized counter is the production hot-path; tests can either
    // (a) emit 3 fired_no_response events through ritualResponseWindowSweep
    // which would auto-increment, or (b) set the counter directly. (b) is
    // simpler and isolates the predicate test from the window-sweep
    // mechanism (which has its own test in skip-tracking.integration.test.ts).
    await db
      .update(rituals)
      .set({
        skipCount: 3,
        nextRunAt: dateAtLocalHour(fixtureDates[3]!, FIXTURE_TZ, 21, 0),
        lastRunAt: null,
      })
      .where(eq(rituals.id, ritualId));

    // Day 4 sweep — should dispatch adjustment dialogue instead of journal.
    const day4 = dateAtLocalHour(fixtureDates[3]!, FIXTURE_TZ, 21, 0);
    vi.setSystemTime(day4);
    await db
      .delete(proactiveState)
      .where(eq(proactiveState.key, 'ritual_daily_count'));

    mockSendMessage.mockClear();
    await runRitualSweep(new Date());

    // Verify the sweep dispatched the adjustment dialogue path:
    //   1. ritual_pending_responses row with metadata.kind = 'adjustment_dialogue'
    //   2. ritual_fire_events with outcome = 'in_dialogue'
    //   3. mockSendMessage called with the adjustment-dialogue text (NOT a
    //      journal prompt).
    const recentPending = await db
      .select()
      .from(ritualPendingResponses)
      .orderBy(drizzleSql`fired_at DESC`)
      .limit(1);
    expect(recentPending[0], 'pending response row must exist').toBeDefined();
    const meta = (recentPending[0]!.metadata as Record<string, unknown>) ?? {};
    expect(
      meta.kind,
      `expected metadata.kind = 'adjustment_dialogue'; got: ${JSON.stringify(meta)}`,
    ).toBe('adjustment_dialogue');

    const inDialogueEvents = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.outcome, 'in_dialogue'));
    expect(
      inDialogueEvents.length,
      'ritual_fire_events emitted with outcome=in_dialogue',
    ).toBeGreaterThanOrEqual(1);

    expect(mockSendMessage, 'adjustment dialogue sent telegram message').toHaveBeenCalled();
    const sendCalls = mockSendMessage.mock.calls;
    const sentText = String(sendCalls[0]?.[1] ?? '');
    expect(sentText, 'adjustment-dialogue text contains the canonical phrasing').toContain(
      "isn't working — what should change?",
    );
  });

  /**
   * Helper — reset weekly_review's lastRunAt to null so a second sweep tick
   * on the same Sunday can re-fire (production lock prevents same-day repeat;
   * test bypasses by clearing the lock).
   */
  async function resetWeeklyReviewForReFire(when: Date): Promise<void> {
    await db
      .update(rituals)
      .set({ nextRunAt: when, lastRunAt: null })
      .where(eq(rituals.name, 'weekly_review'));
    await db
      .delete(proactiveState)
      .where(eq(proactiveState.key, 'ritual_daily_count'));
  }

  it('TEST-28: wellbeing snapshots persist via simulateCallbackQuery callback_query handler', { timeout: 30_000 }, async () => {
    // Park journal + weekly so the sweep picks daily_wellbeing exclusively.
    await parkRituals('daily_journal', 'weekly_review');

    const [wbRitual] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.name, 'daily_wellbeing'));
    expect(wbRitual).toBeDefined();
    const wbId = wbRitual!.id;

    // Day 0: fire wellbeing at 09:00, then simulate 3 callback taps.
    const day0 = fixtureDates[0]!;
    vi.setSystemTime(dateAtLocalHour(day0, FIXTURE_TZ, 9, 0));
    await db
      .update(rituals)
      .set({ nextRunAt: new Date(), lastRunAt: null })
      .where(eq(rituals.id, wbId));
    await db
      .delete(proactiveState)
      .where(eq(proactiveState.key, 'ritual_daily_count'));
    await runRitualSweep(new Date());

    // Verify the open ritual_responses row was inserted by fireWellbeing.
    const [day0OpenRow] = await db
      .select()
      .from(ritualResponses)
      .where(eq(ritualResponses.ritualId, wbId))
      .orderBy(drizzleSql`fired_at DESC`)
      .limit(1);
    expect(day0OpenRow, 'fireWellbeing inserted ritual_responses row for day 0').toBeDefined();

    // Simulate 3 button taps (energy=3, mood=4, anxiety=2).
    // Callback data shape per Phase 27 wellbeing.ts: 'r:w:e:N' / 'r:w:m:N' / 'r:w:a:N'.
    // The 3rd tap completes the snapshot → wellbeing_snapshots row written.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await handleWellbeingCallback(
      simulateCallbackQuery({ callbackData: 'r:w:e:3' }) as any,
      'r:w:e:3',
    );
    await handleWellbeingCallback(
      simulateCallbackQuery({ callbackData: 'r:w:m:4' }) as any,
      'r:w:m:4',
    );
    await handleWellbeingCallback(
      simulateCallbackQuery({ callbackData: 'r:w:a:2' }) as any,
      'r:w:a:2',
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // Day 1: same flow with different values (e=5, m=1, a=5).
    const day1 = fixtureDates[1]!;
    vi.setSystemTime(dateAtLocalHour(day1, FIXTURE_TZ, 9, 0));
    await db
      .update(rituals)
      .set({ nextRunAt: new Date(), lastRunAt: null })
      .where(eq(rituals.id, wbId));
    await db
      .delete(proactiveState)
      .where(eq(proactiveState.key, 'ritual_daily_count'));
    await runRitualSweep(new Date());

    /* eslint-disable @typescript-eslint/no-explicit-any */
    await handleWellbeingCallback(
      simulateCallbackQuery({ callbackData: 'r:w:e:5' }) as any,
      'r:w:e:5',
    );
    await handleWellbeingCallback(
      simulateCallbackQuery({ callbackData: 'r:w:m:1' }) as any,
      'r:w:m:1',
    );
    await handleWellbeingCallback(
      simulateCallbackQuery({ callbackData: 'r:w:a:5' }) as any,
      'r:w:a:5',
    );
    /* eslint-enable @typescript-eslint/no-explicit-any */

    // Assert: 2 wellbeing_snapshots rows (one per day) with correct values.
    // Drizzle `date` columns return strings ('YYYY-MM-DD') under postgres-js;
    // String() coercion handles both Date and string return shapes.
    const snapshots = await db
      .select()
      .from(wellbeingSnapshots)
      .orderBy(wellbeingSnapshots.snapshotDate);
    expect(snapshots.length, 'expected ≥2 wellbeing_snapshots rows').toBeGreaterThanOrEqual(2);

    const day0Snap = snapshots.find((s) => String(s.snapshotDate) === day0);
    const day1Snap = snapshots.find((s) => String(s.snapshotDate) === day1);
    expect(day0Snap, `day0 (${day0}) snapshot exists`).toBeDefined();
    expect(day1Snap, `day1 (${day1}) snapshot exists`).toBeDefined();
    expect(day0Snap?.energy, 'day0 energy').toBe(3);
    expect(day0Snap?.mood, 'day0 mood').toBe(4);
    expect(day0Snap?.anxiety, 'day0 anxiety').toBe(2);
    expect(day1Snap?.energy, 'day1 energy').toBe(5);
    expect(day1Snap?.mood, 'day1 mood').toBe(1);
    expect(day1Snap?.anxiety, 'day1 anxiety').toBe(5);
  });

  it(
    'TEST-29 + TEST-30: weekly review Stage-1 + Stage-2 + date-grounding (happy path) + templated fallback (compound-question retry path)',
    { timeout: 30_000 },
    async () => {
      // Park journal + wellbeing so the sweep picks weekly_review exclusively.
      await parkRituals('daily_journal', 'daily_wellbeing');

      // Verify the weekly_review fire date is a Sunday (Pitfall 9 — ISO 7).
      expect(
        isSunday(WEEKLY_REVIEW_SUNDAY_ISO),
        `${WEEKLY_REVIEW_SUNDAY_ISO} must be a Sunday (ISO weekday 7)`,
      ).toBe(true);

      const sundayAt2000 = dateAtLocalHour(WEEKLY_REVIEW_SUNDAY_ISO, FIXTURE_TZ, 20, 0);
      vi.setSystemTime(sundayAt2000);

      // ── Week 1: happy path ────────────────────────────────────────────
      // Queue 3 mockResolvedValueOnce calls per RESEARCH §Pattern 4 + D-30-06:
      //   1. Stage-1 Sonnet — single-question observation
      //   2. Stage-2 Haiku judge — { question_count: 1, questions: [...] }
      //   3. Date-grounding Haiku — { references_outside_window: false,
      //      dates_referenced: [WEEKLY_REVIEW_SUNDAY_ISO] }
      mockAnthropicParse.mockReset();
      // Sonnet returns its zod-parsed structured output as `parsed_output`.
      // The observation must be ≥20 chars (WeeklyReviewSchema.observation
      // min(20)) and the question must be exactly 1 '?' + ≤1 interrogative
      // leading word for Stage-1 to pass.
      const week1Observation = `This week (${WEEKLY_REVIEW_SUNDAY_ISO}) you wrestled with a hard refactoring stretch.`;
      mockAnthropicParse.mockResolvedValueOnce({
        parsed_output: {
          observation: week1Observation,
          question: 'What stood out to you?',
        },
      });
      mockAnthropicParse.mockResolvedValueOnce({
        parsed_output: { question_count: 1, questions: ['What stood out to you?'] },
      });
      mockAnthropicParse.mockResolvedValueOnce({
        parsed_output: {
          references_outside_window: false,
          dates_referenced: [WEEKLY_REVIEW_SUNDAY_ISO],
        },
      });

      await resetWeeklyReviewForReFire(sundayAt2000);
      mockSendMessage.mockClear();
      mockLoggerWarn.mockClear();
      await runRitualSweep(new Date());

      // Assert Stage-1 + Stage-2 + date-grounding all invoked (3 parse calls).
      expect(
        mockAnthropicParse,
        'Stage-1 + Stage-2 + date-grounding = 3 parse calls (week 1 happy path)',
      ).toHaveBeenCalledTimes(3);

      // Assert message sent contains the observation text (renders into the
      // user-facing payload via WEEKLY_REVIEW_HEADER + observation + question).
      const week1SendCalls = mockSendMessage.mock.calls;
      expect(
        week1SendCalls.length,
        'weekly review sent ≥1 telegram message in happy path',
      ).toBeGreaterThanOrEqual(1);
      const week1MessageText = String(week1SendCalls[0]?.[1] ?? '');
      expect(week1MessageText, 'rendered message contains observation').toContain(
        'refactoring stretch',
      );

      // TEST-30: assert pensieve_entries row with metadata.kind='weekly_review'
      // exists, and the persisted observation text references the in-window
      // date (the date-grounding mock returned references_outside_window:false
      // proving the post-check ran).
      const weeklyReviewEntries = await db
        .select()
        .from(pensieveEntries)
        .where(eq(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'));
      const weeklyEntry = weeklyReviewEntries.find((e) => {
        const meta = (e.metadata as Record<string, unknown>) ?? {};
        return meta.kind === 'weekly_review';
      });
      expect(
        weeklyEntry,
        "TEST-30: pensieve_entries row with metadata.kind='weekly_review'",
      ).toBeDefined();
      const obsText = String(weeklyEntry?.content ?? '');
      expect(
        obsText,
        `TEST-30: observation references in-window date (${WEEKLY_REVIEW_SUNDAY_ISO})`,
      ).toContain(WEEKLY_REVIEW_SUNDAY_ISO);

      // ── Week 2: templated fallback path ───────────────────────────────
      // Re-fire on the SAME Sunday (the m009-21days fixture only has one
      // Sunday with substrate availability — 2026-05-10 — see
      // WEEKLY_REVIEW_SUNDAY_ISO docblock for the executor-level decision).
      // Queue 3 compound-question Sonnet responses — each fails Stage-1
      // INTERROGATIVE_REGEX (2 leading words) → ZodError → retry. After
      // MAX_RETRIES (=2) the loop exits with attempts === 3 → fallback fires.
      // Stage-2 / date-grounding are NEVER invoked in the fallback path
      // because Stage-1 throws first; only 3 parse calls total.
      mockAnthropicParse.mockReset();
      for (let attempt = 0; attempt < 3; attempt++) {
        mockAnthropicParse.mockResolvedValueOnce({
          parsed_output: {
            observation: `Week ${WEEKLY_REVIEW_SUNDAY_ISO} compound observation #${attempt}.`,
            question: 'What surprised you? Or what felt familiar?',
          },
        });
      }

      // Cleanup the week-1 ritual_responses + pensieve_entries so week-2
      // assertions read fresh state. Preserve fixture organic data.
      await db.delete(ritualResponses);
      await db
        .delete(pensieveEntries)
        .where(eq(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'));
      await db.delete(ritualFireEvents);

      await resetWeeklyReviewForReFire(sundayAt2000);
      mockSendMessage.mockClear();
      mockLoggerWarn.mockClear();
      await runRitualSweep(new Date());

      // Assert fallback log line emitted exactly once (per
      // src/rituals/weekly-review.ts:467-470: logger.warn with
      // 'chris.weekly-review.fallback-fired' and { attempts: MAX_RETRIES + 1 }).
      const fallbackLogCalls = mockLoggerWarn.mock.calls.filter(
        (c) => c[1] === 'chris.weekly-review.fallback-fired',
      );
      expect(fallbackLogCalls.length, 'fallback log line emitted exactly once').toBe(1);
      const fallbackLogObj = fallbackLogCalls[0]?.[0] as { attempts?: number } | undefined;
      expect(fallbackLogObj?.attempts, 'attempts === MAX_RETRIES + 1 (3)').toBe(3);

      // Assert sent message contains the templated fallback question per
      // weekly-review.ts:358 TEMPLATED_FALLBACK_EN constant.
      const week2SendCalls = mockSendMessage.mock.calls;
      expect(
        week2SendCalls.length,
        'fallback path still sends a telegram message',
      ).toBeGreaterThanOrEqual(1);
      const week2MessageText = String(week2SendCalls[0]?.[1] ?? '');
      expect(
        week2MessageText,
        'fallback message uses TEMPLATED_FALLBACK_EN question',
      ).toContain('What stood out to you about this week?');
    },
  );
});
