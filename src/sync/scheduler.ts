import cron, { type ScheduledTask } from 'node-cron';
import { syncGmail } from '../gmail/sync.js';
import { syncDrive } from '../drive/sync.js';
import { syncImmich } from '../immich/sync.js';
import { getAuthenticatedClient } from '../gmail/oauth.js';
import { bot } from '../bot/bot.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { OAuthError } from '../utils/errors.js';

let scheduledTask: ScheduledTask | null = null;

/** No-op sendMessage for cron syncs — progress messages go nowhere */
const noopSendMessage = async () => {};

/**
 * Notify John of a cron sync failure via Telegram.
 * Wrapped in try/catch so notification failure never crashes the scheduler.
 */
async function notifyError(source: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await bot.api.sendMessage(
      config.telegramAuthorizedUserId,
      `⚠️ Cron sync failed: ${source}\n${message}`,
    );
  } catch (notifyErr) {
    logger.error(
      { err: notifyErr, source },
      'sync.cron.notify_error: Failed to send error notification',
    );
  }
}

/**
 * Run all sync sources sequentially with independent error boundaries.
 * Sequential to avoid resource contention on CPU-intensive embedding work.
 */
export async function runAllSyncs(): Promise<void> {
  // --- Gmail ---
  logger.info({ source: 'gmail' }, 'sync.cron.start');
  try {
    const authClient = await getAuthenticatedClient();
    await syncGmail(authClient, noopSendMessage);
    logger.info({ source: 'gmail' }, 'sync.cron.complete');
  } catch (err) {
    if (err instanceof OAuthError) {
      logger.info({ source: 'gmail', reason: (err as Error).message }, 'sync.cron.skip');
    } else {
      logger.error({ source: 'gmail', err }, 'sync.cron.error');
      await notifyError('gmail', err);
    }
  }

  // --- Drive ---
  logger.info({ source: 'drive' }, 'sync.cron.start');
  try {
    const authClient = await getAuthenticatedClient();
    await syncDrive(authClient, noopSendMessage);
    logger.info({ source: 'drive' }, 'sync.cron.complete');
  } catch (err) {
    if (err instanceof OAuthError) {
      logger.info({ source: 'drive', reason: (err as Error).message }, 'sync.cron.skip');
    } else {
      logger.error({ source: 'drive', err }, 'sync.cron.error');
      await notifyError('drive', err);
    }
  }

  // --- Immich ---
  if (!config.immichApiUrl || !config.immichApiKey) {
    logger.info({ source: 'immich', reason: 'Missing immichApiUrl or immichApiKey' }, 'sync.cron.skip');
  } else {
    logger.info({ source: 'immich' }, 'sync.cron.start');
    try {
      await syncImmich(noopSendMessage);
      logger.info({ source: 'immich' }, 'sync.cron.complete');
    } catch (err) {
      logger.error({ source: 'immich', err }, 'sync.cron.error');
      await notifyError('immich', err);
    }
  }
}

/**
 * Start the background cron scheduler.
 * Schedules runAllSyncs at the configured interval (default: every 6 hours).
 */
export function startScheduler(): void {
  logger.info(
    { cronExpression: config.syncIntervalCron },
    'Starting background sync scheduler',
  );
  scheduledTask = cron.schedule(config.syncIntervalCron, () => {
    runAllSyncs().catch((err) => {
      logger.error({ err }, 'sync.cron.error: Unexpected error in runAllSyncs');
    });
  });
}

/**
 * Stop the background cron scheduler.
 */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info('Background sync scheduler stopped');
  }
}
