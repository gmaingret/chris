/**
 * Phase 23 Plan 03 — /summary command handler integration test (CMD-01).
 *
 * Covers the 5 D-34 input cases against real Docker Postgres + a duck-typed
 * Grammy Context object. The handler is deliberately thin — it parses input,
 * computes "yesterday in tz", calls Phase 22's getEpisodicSummary, and formats
 * the row for Telegram. The integration test exercises the full path so the
 * handler and the retrieval contract are both validated end-to-end.
 *
 *   a. /summary (no args)         → yesterday's summary (row seeded)
 *   b. /summary 2026-04-15        → that date's summary (row seeded)
 *   c. /summary 2026-04-16        → past date with no row → "no summary" (NOT an error)
 *   d. /summary 2099-01-01        → future date → "hasn't happened yet"
 *   e. /summary not-a-date        → usage help
 *
 * D-02 (inherited from Phase 18 / Plans 23-01..23-02): vi.setSystemTime ONLY.
 * vi.useFakeTimers is forbidden — it replaces setTimeout/setInterval and breaks
 * postgres.js connection keep-alive timers. This file does not need time-travel
 * (it computes "yesterday" relative to wall-clock now), so neither is used here.
 *
 * Cleanup scope: scoped DELETE on the four fixture dates the test touches —
 * yesterdayIso, '2026-04-15', '2026-04-16', '2099-01-01'. We do NOT TRUNCATE
 * episodic_summaries because Plan 23-01's synthetic-fixture and Plan 23-02's
 * backfill test may have rows in flight under vitest's fileParallelism: false
 * (serial) execution; scoping by date is sufficient and collision-safe.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
} from 'vitest';
import { inArray } from 'drizzle-orm';
import { db, sql as pgSql } from '../../../db/connection.js';
import { episodicSummaries } from '../../../db/schema.js';
import { handleSummaryCommand } from '../summary.js';
import { config } from '../../../config.js';
import { clearLanguageState } from '../../../chris/language.js';

// ── Constants ───────────────────────────────────────────────────────────────

/** Distinct from the 9992X synthetic-fixture / backfill bands per Plan 23-01/02. */
const FIXTURE_CHAT_ID = 99_925;
/** Past date with a seeded row (case b). */
const PAST_DATE_WITH_ROW = '2026-04-15';
/** Past date with NO row (case c) — guaranteed empty by cleanup scope. */
const PAST_DATE_NO_ROW = '2026-04-16';
/** Future date (case d) — far enough out it cannot be "today" anywhere on Earth. */
const FUTURE_DATE = '2099-01-01';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the same "yesterday in proactiveTimezone" string the handler produces.
 * We don't import the handler's private helper — duplicating the Intl idiom here
 * keeps the test independent of the handler's internal helper exposure (and
 * the handler's helper is correctly identical to pensieve/retrieve.ts'
 * formatLocalDate).
 */
function yesterdayIsoForTest(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.proactiveTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayIso = fmt.format(new Date());
  const todayMidnightUtc = Date.parse(`${todayIso}T00:00:00Z`);
  const yesterdayUtc = todayMidnightUtc - 24 * 60 * 60 * 1000;
  return fmt.format(new Date(yesterdayUtc));
}

/** Build a duck-typed Grammy Context that captures all ctx.reply calls. */
function buildCtx(
  text: string,
  chatId: number = FIXTURE_CHAT_ID,
): { captured: string[]; ctx: any } {
  const captured: string[] = [];
  const ctx = {
    chat: { id: chatId },
    from: { id: chatId },
    message: { text },
    reply: async (t: string) => {
      captured.push(t);
    },
  };
  return { captured, ctx };
}

/**
 * Insert one episodic_summaries row for the given date with controllable
 * importance. Topics, emotional_arc, and key_quotes are set to predictable
 * fixture values so case-(a) and case-(b) assertions can be exact.
 */
async function seedSummary(date: string, importance: number): Promise<void> {
  await db.insert(episodicSummaries).values({
    // Drizzle's `date` column accepts an ISO date string at the type-system
    // boundary; the cast suppresses the Date-vs-string noise without changing
    // the runtime serialization (date columns store YYYY-MM-DD).
    summaryDate: date as unknown as Date,
    summary:
      `Fixture summary for ${date}. ` +
      'Padded to satisfy the 50-char minimum the schema would otherwise enforce in production.',
    importance,
    topics: ['test', 'fixture'],
    emotionalArc: 'flat',
    keyQuotes: [`verbatim quote from ${date}`],
    sourceEntryIds: [],
  });
}

/** Scoped cleanup — only touches our fixture dates so we cannot collide
 *  with synthetic-fixture or backfill rows on serial test runs. */
async function cleanup(): Promise<void> {
  await db
    .delete(episodicSummaries)
    .where(
      inArray(episodicSummaries.summaryDate, [
        yesterdayIsoForTest(),
        PAST_DATE_WITH_ROW,
        PAST_DATE_NO_ROW,
        FUTURE_DATE,
      ] as unknown as Date[]),
    );
}

// ── File-level lifecycle ────────────────────────────────────────────────────

beforeAll(async () => {
  // Smoke: DB must be reachable before any cleanup runs.
  const probe = await pgSql`SELECT 1 as ok`;
  expect(probe[0]!.ok).toBe(1);
});

afterAll(async () => {
  await cleanup();
  // Reset language state so we don't leak into other test files under serial
  // execution. The handler reads getLastUserLanguage(chatId) which is an
  // in-process Map; clearing FIXTURE_CHAT_ID's entry keeps the harness clean.
  clearLanguageState(FIXTURE_CHAT_ID.toString());
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CMD-01: /summary handler', () => {
  beforeEach(async () => {
    await cleanup();
    // Reset language state so each test starts with the English fallback
    // (langOf(null) → English). Tests can opt into FR/RU by calling
    // setLastUserLanguage in-test; the 5 cases here all assert English.
    clearLanguageState(FIXTURE_CHAT_ID.toString());
  });

  afterEach(async () => {
    await cleanup();
  });

  it('a) /summary (no args) returns yesterday summary when row exists', async () => {
    const yesterdayIso = yesterdayIsoForTest();
    await seedSummary(yesterdayIso, 5);

    const { captured, ctx } = buildCtx('/summary');
    await handleSummaryCommand(ctx);

    expect(captured).toHaveLength(1);
    // Date is in the header line ("Summary for YYYY-MM-DD (importance N/10)").
    expect(captured[0]).toContain(yesterdayIso);
    expect(captured[0]).toContain('5/10');
    // Topics line follows the summary body.
    expect(captured[0]).toContain('Topics: test, fixture');
    // Emotional arc line is present.
    expect(captured[0]).toContain('Emotional arc: flat');
    // Key moments section appears because keyQuotes is non-empty.
    expect(captured[0]).toContain('Key moments');
    expect(captured[0]).toContain(`verbatim quote from ${yesterdayIso}`);
  });

  it('b) /summary 2026-04-15 returns that date summary when row exists', async () => {
    await seedSummary(PAST_DATE_WITH_ROW, 8);

    const { captured, ctx } = buildCtx(`/summary ${PAST_DATE_WITH_ROW}`);
    await handleSummaryCommand(ctx);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain(PAST_DATE_WITH_ROW);
    // Importance flows through to the header verbatim.
    expect(captured[0]).toContain('8/10');
    expect(captured[0]).toContain('Topics: test, fixture');
  });

  it(
    'c) /summary YYYY-MM-DD for past date with no row replies with a clear no-summary message (NOT an error)',
    async () => {
      // beforeEach cleanup guarantees no row exists for PAST_DATE_NO_ROW.
      const { captured, ctx } = buildCtx(`/summary ${PAST_DATE_NO_ROW}`);
      await handleSummaryCommand(ctx);

      expect(captured).toHaveLength(1);
      // Permissive across the three localizations — any of EN/FR/RU phrasings
      // satisfies the "clear no-summary message" CMD-01 contract.
      expect(captured[0].toLowerCase()).toMatch(/no summary|pas de résumé|нет сводки/);
      // The requested date appears in the message so the user knows what was queried.
      expect(captured[0]).toContain(PAST_DATE_NO_ROW);
      // Critically: the reply is NOT an error (CMD-01 verbatim — "not an error").
      expect(captured[0].toLowerCase()).not.toMatch(/error|échec|ошибка/);
    },
  );

  it('d) /summary for a future date replies with a "hasn\'t happened yet" message', async () => {
    const { captured, ctx } = buildCtx(`/summary ${FUTURE_DATE}`);
    await handleSummaryCommand(ctx);

    expect(captured).toHaveLength(1);
    // Permissive across EN/FR/RU phrasings.
    expect(captured[0].toLowerCase()).toMatch(
      /hasn't happened|n'est pas encore|ещё не наступило/,
    );
    // The requested date appears so the user knows what was queried.
    expect(captured[0]).toContain(FUTURE_DATE);
  });

  it('e) /summary with garbage input replies with usage help', async () => {
    const { captured, ctx } = buildCtx('/summary not-a-date');
    await handleSummaryCommand(ctx);

    expect(captured).toHaveLength(1);
    // Usage messages all reference the YYYY-MM-DD format hint or the
    // localized "use/utilisation/использование" verb.
    expect(captured[0].toLowerCase()).toMatch(
      /yyyy-mm-dd|utilisation|использование|use:/,
    );
  });
});
