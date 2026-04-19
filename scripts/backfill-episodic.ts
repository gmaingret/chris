#!/usr/bin/env node
/**
 * scripts/backfill-episodic.ts — Phase 23 Plan 02 (OPS-01).
 *
 * Operator script for day-by-day episodic consolidation backfill.
 *
 * Usage:
 *   npx tsx scripts/backfill-episodic.ts --from 2026-04-13 --to 2026-04-17
 *
 * Behavior:
 *   - Sequentially calls runConsolidate(date) for each calendar date in
 *     [from, to] (inclusive, ascending).
 *   - 2-second delay between invocations (OPS-01 rate-limit spec, D-20/D-22).
 *   - Idempotent via Phase 21 CONS-03 (pre-flight SELECT + ON CONFLICT DO
 *     NOTHING). Re-running is a no-op for already-summarized days — no
 *     duplicate check or checkpoint file in this script (D-21/D-23).
 *   - Continue-on-error: a failed day logs the error and proceeds to the
 *     next day (D-22).
 *   - Exits 0 on full completion (including if every day was skipped or
 *     errored — a completed run that surfaced per-day errors is still a
 *     successful backfill invocation that visited the whole range).
 *   - Exits 1 only on argument validation failure.
 *
 * Phase 21 ConsolidateResult contract (src/episodic/consolidate.ts L94-98):
 *   - { inserted: true; id: string }
 *   - { skipped: 'existing' | 'no-entries' }  ← discriminated string, NOT boolean
 *   - { failed: true; error: unknown }
 *
 * Phase 23 Plan 01 reconciled this same shape in TEST-19; this script mirrors
 * the reconciliation so the backfill's per-day log matches the actual engine
 * contract. A per-day `failed` outcome is logged and counted as 'errored'
 * without re-throwing — the backfill continues.
 */

import { parseArgs } from 'node:util';
import { DateTime } from 'luxon';
import { runConsolidate } from '../src/episodic/consolidate.js';
import { logger } from '../src/utils/logger.js';

/** OPS-01 verbatim: 2 seconds between days. Do NOT tune to 1s/3s. */
const INTER_DAY_DELAY_MS = 2000;

/** D-19 safety valve: reject ranges > 365 days to prevent accidental historical-Internet runs. */
const MAX_SPAN_DAYS = 365;

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

interface ParsedArgs {
  from: string;
  to: string;
}

/**
 * Validate and normalize CLI args.
 *
 * Contract:
 *   - Both --from and --to are required.
 *   - Both must match YYYY-MM-DD literally.
 *   - Both must parse as valid calendar dates.
 *   - from <= to.
 *   - Both in the past (yesterday or earlier, relative to "today" in UTC).
 *     A future date is rejected because runConsolidate would either skip it
 *     (no entries yet) or produce a half-complete summary; that is not the
 *     backfill's purpose.
 *   - Span <= MAX_SPAN_DAYS.
 */
export function parseCliArgs(argv: string[]): ParsedArgs {
  let values: { from?: string; to?: string };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        from: { type: 'string' },
        to: { type: 'string' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UsageError(`Argument parse failed: ${msg}`);
  }

  if (!values.from || !values.to) {
    throw new UsageError('Both --from and --to are required.');
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(values.from) || !dateRegex.test(values.to)) {
    throw new UsageError('--from and --to must be YYYY-MM-DD.');
  }

  const fromDT = DateTime.fromISO(values.from, { zone: 'utc' });
  const toDT = DateTime.fromISO(values.to, { zone: 'utc' });
  if (!fromDT.isValid || !toDT.isValid) {
    throw new UsageError('--from and --to must parse as valid calendar dates.');
  }

  if (fromDT.toMillis() > toDT.toMillis()) {
    throw new UsageError('--from must be <= --to.');
  }

  // Future check: today-in-UTC as the boundary. Both from/to must be today or
  // earlier. We use UTC (not config.proactiveTimezone) for the boundary check
  // because it is conservative — a date that is "in the past" in Paris might
  // still be "today" in UTC, and we prefer to reject ambiguous boundary cases
  // rather than risk a half-complete summary for a day that is still ongoing
  // somewhere.
  const todayUtc = DateTime.utc().startOf('day');
  if (fromDT.toMillis() > todayUtc.toMillis() || toDT.toMillis() > todayUtc.toMillis()) {
    throw new UsageError('Backfill range must not be in the future (--from and --to <= today in UTC).');
  }

  const spanDays = toDT.diff(fromDT, 'days').days;
  if (spanDays > MAX_SPAN_DAYS) {
    throw new UsageError(
      `Backfill range > ${MAX_SPAN_DAYS} days is not supported; split into multiple invocations.`,
    );
  }

  return { from: values.from, to: values.to };
}

/** Yield YYYY-MM-DD strings in [from, to] inclusive, ascending, in UTC. */
export function* iterateDates(from: string, to: string): Generator<string> {
  let current = DateTime.fromISO(from, { zone: 'utc' });
  const end = DateTime.fromISO(to, { zone: 'utc' });
  while (current.toMillis() <= end.toMillis()) {
    const iso = current.toISODate();
    if (iso) yield iso;
    current = current.plus({ days: 1 });
  }
}

export interface BackfillTotals {
  total: number;
  inserted: number;
  skipped: number;
  errored: number;
}

/**
 * Programmatic entrypoint — exported so the integration test can call it
 * directly without spawning a subprocess. The `delayMs` option lets tests
 * bypass the 2-second inter-day sleep; the CLI always uses the default
 * INTER_DAY_DELAY_MS (2000ms per OPS-01).
 *
 * Returns a summary count of outcomes for operator UX and test assertions.
 * Does NOT throw on per-day errors — each day's error is caught, logged via
 * `logger.error`, counted in `totals.errored`, and the loop continues. This
 * resumability-first semantics is the point of the script (CONTEXT.md D-22).
 */
export async function runBackfill(
  from: string,
  to: string,
  opts?: { delayMs?: number },
): Promise<BackfillTotals> {
  const delayMs = opts?.delayMs ?? INTER_DAY_DELAY_MS;
  const totals: BackfillTotals = { total: 0, inserted: 0, skipped: 0, errored: 0 };

  let first = true;
  for (const dateStr of iterateDates(from, to)) {
    totals.total += 1;

    // 2-second inter-day delay BETWEEN invocations (not before the first
    // one and not after the last one). OPS-01 verbatim.
    if (!first && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    first = false;

    try {
      // Construct a Date representing midnight-of-the-day in UTC. Phase 21's
      // runConsolidate normalizes to config.proactiveTimezone internally
      // (consolidate.ts L204-205: `DateTime.fromJSDate(date, { zone: tz }).toISODate()`),
      // so any instant within the target calendar day in the engine's tz is
      // valid. Midnight UTC is unambiguous and well-defined for every date
      // string; the engine's tz-aware normalization does the rest.
      const dateObj = new Date(`${dateStr}T00:00:00Z`);
      const result = await runConsolidate(dateObj);

      if ('inserted' in result && result.inserted === true) {
        totals.inserted += 1;
        logger.info(
          { date: dateStr, result: 'inserted', id: result.id },
          'backfill.day',
        );
      } else if ('skipped' in result) {
        totals.skipped += 1;
        // result.skipped is the discriminated string 'existing' | 'no-entries'.
        logger.info(
          { date: dateStr, result: 'skipped', reason: result.skipped },
          'backfill.day',
        );
      } else if ('failed' in result && result.failed === true) {
        // Phase 21's internal try/catch already surfaced the error through
        // notifyConsolidationError; count it as errored at this layer and
        // continue. We intentionally do NOT re-throw (D-22).
        totals.errored += 1;
        const errMsg =
          result.error instanceof Error ? result.error.message : String(result.error);
        logger.error(
          { date: dateStr, result: 'error', error: errMsg },
          'backfill.day',
        );
      }
    } catch (err) {
      // Defensive: runConsolidate's top-level try/catch should normally
      // convert any throw into `{ failed: true, error }`. This catch is a
      // belt-and-suspenders safety net in case a future refactor lets an
      // exception escape. Continue-on-error semantics (D-22) are preserved.
      totals.errored += 1;
      logger.error(
        {
          date: dateStr,
          result: 'error',
          error: err instanceof Error ? err.message : String(err),
        },
        'backfill.day',
      );
    }
  }

  logger.info(totals, 'backfill.complete');
  return totals;
}

/**
 * CLI entrypoint — invoked when the script is run directly via
 * `npx tsx scripts/backfill-episodic.ts --from YYYY-MM-DD --to YYYY-MM-DD`.
 *
 * Exit codes:
 *   0 — the backfill completed its sweep (even if every day was errored or
 *       skipped; a completed sweep is a successful invocation).
 *   1 — argument-validation failure or an unexpected top-level error.
 */
async function main(): Promise<void> {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    const result = await runBackfill(args.from, args.to);
    // Final operator summary line (plain console.log is fine here — this is
    // UX, not structured logging). The per-day lines are pino JSON.
    console.log(
      `backfill complete: ${result.inserted} inserted, ${result.skipped} skipped, ${result.errored} errored (total ${result.total} days)`,
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`backfill-episodic: ${err.message}`);
      console.error('Usage: backfill-episodic --from YYYY-MM-DD --to YYYY-MM-DD');
      process.exit(1);
    }
    console.error('backfill-episodic: unexpected error:', err);
    process.exit(1);
  }
}

// Only invoke main() when run as a script. When this file is imported by the
// integration test (src/episodic/__tests__/backfill.test.ts → runBackfill),
// the guard is false and main() does not run.
//
// ESM guard: import.meta.url is a file:// URL; process.argv[1] is a plain
// filesystem path. Comparing the file:// URL of the script entry point
// against the current module URL tells us whether we are the entry point.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
