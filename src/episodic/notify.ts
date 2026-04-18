/**
 * src/episodic/notify.ts — Phase 21 Plan 04 Task 1
 *
 * Telegram error notifier for the daily episodic consolidation cron.
 *
 * Mirrors the `notifyError` pattern from `src/sync/scheduler.ts`:
 *   - Logs at ERROR level FIRST, so the failure persists even if the Telegram
 *     send itself fails.
 *   - Wraps `bot.api.sendMessage` in a try/catch so a Telegram-side failure
 *     never escapes back to the caller (`runConsolidate`).
 *
 * Per CONS-12 (no silent failures): every consolidation error MUST surface as
 * a Telegram notification to Greg AND as an ERROR-level log line. The
 * notification is best-effort; the ERROR log is the durable record.
 *
 * NOTE: this is a copy of the pattern, NOT a wrapper around
 * `sync/scheduler.ts::notifyError`. That function is module-private, takes a
 * `source: string` parameter (vs our `date: Date`), and uses a different
 * message template. Reusing it would require exporting + parameterising
 * scheduler internals — a bigger refactor than is in scope here.
 */
import { DateTime } from 'luxon';
import { bot } from '../bot/bot.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Send a Telegram notification when `runConsolidate` fails.
 *
 * @param date  The calendar date for which consolidation was attempted. The
 *              date is rendered in `config.proactiveTimezone` so Greg sees the
 *              local YYYY-MM-DD that matches the cron schedule.
 * @param error The thrown value caught by `runConsolidate`'s top-level
 *              try/catch. Renders as `${ErrorClass}: ${message}` for Error
 *              instances, or `Unknown: ${String(error)}` for non-Error throws.
 *
 * Returns once the Telegram send has been attempted (success or failure).
 * Never throws.
 */
export async function notifyConsolidationError(
  date: Date,
  error: unknown,
): Promise<void> {
  const dateStr =
    DateTime.fromJSDate(date, { zone: config.proactiveTimezone }).toISODate() ??
    date.toISOString().slice(0, 10);
  const errClass = error instanceof Error ? error.constructor.name : 'Unknown';
  const message = error instanceof Error ? error.message : String(error);

  // Persist the failure first — this log line is the durable record even if
  // the Telegram send fails.
  logger.error(
    { date: dateStr, errClass, err: error },
    'episodic.consolidate.notify_error',
  );

  try {
    await bot.api.sendMessage(
      config.telegramAuthorizedUserId,
      `⚠️ Episodic consolidation failed for ${dateStr}\n${errClass}: ${message}`,
    );
  } catch (notifyErr) {
    // Notification failure is best-effort — log but never re-throw, so the
    // caller (`runConsolidate`) sees a clean `{ failed: true, error }` return.
    logger.error(
      { err: notifyErr, date: dateStr },
      'episodic.consolidate.notify_error.send_failed',
    );
  }
}
