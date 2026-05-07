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
import { loadPrimedFixture } from '../../__tests__/fixtures/load-primed.js';
import { CHAT_ID_M009_SYNTHETIC_FIXTURE } from '../../__tests__/fixtures/chat-ids.js';

// ── 4. Constants ────────────────────────────────────────────────────────
const FIXTURE_NAME = 'm009-21days';
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);
const FIXTURE_TZ = 'Europe/Paris';
const GREG_CHAT_ID = CHAT_ID_M009_SYNTHETIC_FIXTURE;
// processMessage signature: chatId: bigint, userId: number, text: string.
// userId is `number`, not bigint — corrected from PLAN.md typo.
const GREG_USER_ID = 99921;

// 14-day mock-clock window anchored to 2026-04-15 (Wed) → 2026-04-28 (Tue).
// Contains exactly 2 Sundays (2026-04-19 + 2026-04-26) inside the m009-21days
// fixture's organic date range (2026-04-15 .. 2026-05-10), so substrate +
// fixture data align for TEST-29 weekly-review fires.
const FIXTURE_WINDOW_START_ISO = '2026-04-15';

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
    // ── PITFALL 6 CUMULATIVE INVARIANT (TEST-25 — load-bearing) ─────
    // mockAnthropicCreate was NEVER called across the entire 14-day fixture
    // walk. Every journal STT reply MUST short-circuit at PP#5
    // (engine.ts:177-234). If a future change re-routes ritual replies through
    // the LLM (PP#5 broken), this assertion fails with the call count.
    // Pattern verbatim from src/chris/__tests__/engine-pp5.test.ts:83-92.
    // mockAnthropicParse is intentionally NOT in this assertion — TEST-29
    // weekly review uses anthropic.messages.parse, not .create.
    expect(mockAnthropicCreate).not.toHaveBeenCalled();

    await cleanup();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  // ── it() blocks for TEST-24..30 added by Plan 30-02 tasks 3-6 ───────
  // Task 2 ships an empty describe so the skeleton + cumulative invariant
  // can be verified independently. Tasks 3-6 fill in the it() blocks.
  it('TEST-23: skeleton fixture loaded with substrate available (placeholder for Tasks 3-6)', async () => {
    // Skeleton smoke-test: fixture loaded, ritual rows seeded, dates expanded.
    expect(fixtureDates.length).toBe(14);
    expect(fixtureDates[0]).toBe('2026-04-15');
    expect(fixtureDates[13]).toBe('2026-04-28');
    // Window contains exactly 2 Sundays (TEST-29 substrate requirement).
    const sundays = fixtureDates.filter((d) => isSunday(d));
    expect(sundays.length).toBeGreaterThanOrEqual(2);
    expect(sundays).toContain('2026-04-19');
    expect(sundays).toContain('2026-04-26');
    // Fixture loaded → episodic_summaries should be present (m009-21days has
    // 4 organic+synth rows per Plan 30-01 SUMMARY).
    const summaryCount = await db.execute<{ count: number }>(
      drizzleSql`SELECT COUNT(*)::int AS count FROM episodic_summaries`,
    );
    expect(Number(summaryCount[0]?.count ?? 0)).toBeGreaterThanOrEqual(1);
  });
});
