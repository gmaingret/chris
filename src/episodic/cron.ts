/**
 * src/episodic/cron.ts — Phase 22 Plan 05 Task 1
 *
 * `runConsolidateYesterday(now?)` — thin wrapper around `runConsolidate(date)`
 * (Phase 21 deliverable) that owns the "yesterday in `config.proactiveTimezone`"
 * computation. Registered as the cron handler for the daily episodic
 * consolidation job in `src/index.ts` (CRON-01) at `config.episodicCron`
 * (default `"0 23 * * *"`, EPI-04).
 *
 * Why this wrapper exists (and why it isn't inlined into the cron registration):
 *   1. Single source of truth for the "yesterday in tz" computation. The
 *      backfill operator (Phase 23 OPS-01) calls `runConsolidate(d)` directly
 *      with explicit dates — only the cron path needs "yesterday relative to
 *      now", and that logic belongs in one place that the DST-boundary unit
 *      test can target without spawning node-cron.
 *   2. Keeps the cron body in `src/index.ts` minimal — the handler is one
 *      function call wrapped in a try/catch belt-and-suspenders.
 *   3. Provides an injectable `now` parameter so the DST-boundary test can
 *      simulate spring-forward (2026-03-29) and fall-back (2026-10-25)
 *      without `vi.useFakeTimers` system-clock manipulation polluting the
 *      whole test file.
 *
 * Error handling (CRON-01 + CONS-12):
 *   - `runConsolidate` already catches its own internal errors and notifies
 *     Greg via Telegram (Phase 21 CONS-12). Any error that escapes here is
 *     either (a) a programmer bug in `runConsolidate` itself, or (b) an error
 *     in the wrapper's date computation. Both are caught and logged at warn
 *     level to satisfy CRON-01's "cron must never crash the process".
 *   - The double-catch (here + in `src/index.ts`) is intentional: the outer
 *     try/catch in the cron registration is the last line of defence against
 *     anything that escapes this wrapper.
 *
 * DST safety (CRON-02):
 *   `Intl.DateTimeFormat` computes the LOCAL date in `tz` regardless of UTC
 *   offset shifts. On the 2026-10-25 fall-back in Paris, the cron fires at
 *   23:00 local time — the local date is 2026-10-25 whether the wall clock
 *   shifted or not, and yesterday is 2026-10-24. Combined with node-cron's
 *   built-in `timezone` option (which fires once per local hour:minute even
 *   across DST transitions) and Phase 21's CONS-03 idempotency guarantees
 *   (UNIQUE(summary_date) + pre-flight SELECT + ON CONFLICT DO NOTHING),
 *   any duplicate firing collapses to a no-op.
 */
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { runConsolidate } from './consolidate.js';

/**
 * Compute the "yesterday" calendar date in `tz`.
 * Returns a Date anchored at UTC midnight for the prior calendar day in `tz`.
 *
 * Safe across DST because `Intl.DateTimeFormat('en-CA', { timeZone })` computes
 * the LOCAL date regardless of the wall-clock shift: on 2026-10-25 (fall-back
 * in Paris) the cron fires at 23:00 Paris time — the local date is 2026-10-25,
 * and yesterday is 2026-10-24 regardless of which of the two 23:00 instants
 * the timer uses.
 *
 * The 'en-CA' locale produces 'YYYY-MM-DD' output natively (the standard idiom
 * for ISO-style date formatting via Intl). Same pattern used by Plan 22-01's
 * `formatLocalDate` in `src/pensieve/retrieve.ts`.
 */
function computeYesterday(now: Date, tz: string): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const todayLocal = fmt.format(now); // 'YYYY-MM-DD' in tz
  const todayUtcMidnight = new Date(`${todayLocal}T00:00:00Z`);
  return new Date(todayUtcMidnight.getTime() - 86_400_000);
}

/**
 * Cron-registered wrapper around `runConsolidate`. Computes yesterday's
 * calendar date in `config.proactiveTimezone`, invokes the consolidation
 * engine, and swallows any thrown error.
 *
 * Exported for direct invocation by:
 *   - The cron registration in `src/index.ts` (CRON-01)
 *   - The DST-boundary unit test in `src/episodic/__tests__/cron.test.ts`
 *
 * The Phase 23 OPS-01 backfill script does NOT call this wrapper — it calls
 * `runConsolidate(date)` directly with explicit historical dates, since
 * "yesterday relative to now" is irrelevant for a backfill of the past 14
 * days.
 *
 * @param now Wall-clock timestamp used to compute "yesterday". Defaults to
 *   `new Date()`. Injected by tests to simulate DST boundary firings.
 */
export async function runConsolidateYesterday(
  now: Date = new Date(),
): Promise<void> {
  // WR-01: computeYesterday calls Intl.DateTimeFormat, which throws
  // RangeError on a misconfigured IANA tz (e.g. typo in
  // PROACTIVE_TIMEZONE). Previously this ran OUTSIDE the try/catch, so
  // the tz-misconfig error bypassed the documented double-catch defence
  // (CRON-01 / CONS-12) and the 'episodic.cron.invoked' info log never
  // fired. Move both the computation and the info log inside the try so
  // the first catch layer now handles all failure modes.
  let yesterdayIso = '';
  try {
    const yesterday = computeYesterday(now, config.proactiveTimezone);
    yesterdayIso = yesterday.toISOString().slice(0, 10);

    // Info log BEFORE the runConsolidate call so operators can see the cron
    // fired correctly even if runConsolidate skipped (no entries / existing row).
    logger.info(
      { yesterdayIso, timezone: config.proactiveTimezone },
      'episodic.cron.invoked',
    );

    await runConsolidate(yesterday);
  } catch (error) {
    logger.warn(
      {
        yesterdayIso,
        error: error instanceof Error ? error.message : String(error),
      },
      'episodic.cron.error',
    );
  }
}
