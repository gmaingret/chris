import express from 'express';
import cron from 'node-cron';
import { webhookCallback } from 'grammy';
import { bot } from './bot/bot.js';
import { sql } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { startScheduler, stopScheduler } from './sync/scheduler.js';
import { runSweep } from './proactive/sweep.js';
import { runConsolidateYesterday } from './episodic/cron.js';

function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    const checks: Record<string, 'ok' | 'error' | 'unconfigured'> = {};
    let overallStatus: 'ok' | 'degraded' | 'error' = 'ok';

    // Database check
    try {
      await sql`SELECT 1`;
      checks.database = 'ok';
    } catch (err) {
      checks.database = 'error';
      overallStatus = 'error';
      logger.warn({ err }, 'Health check: database failed');
    }

    // Immich check (optional — only if configured)
    if (config.immichApiUrl && config.immichApiKey) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const immichResp = await fetch(
          `${config.immichApiUrl.replace(/\/+$/, '')}/api/server/ping`,
          { headers: { 'x-api-key': config.immichApiKey }, signal: controller.signal },
        );
        clearTimeout(timer);
        checks.immich = immichResp.ok ? 'ok' : 'error';
        if (!immichResp.ok) overallStatus = overallStatus === 'error' ? 'error' : 'degraded';
      } catch {
        checks.immich = 'error';
        if (overallStatus !== 'error') overallStatus = 'degraded';
      }
    } else {
      checks.immich = 'unconfigured';
    }

    const statusCode = overallStatus === 'error' ? 503 : 200;
    res.status(statusCode).json({
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}

async function main() {
  logger.info('Chris starting...');

  await runMigrations();

  // Start background sync scheduler (Gmail, Immich, Drive)
  if (config.syncEnabled) {
    startScheduler();
  }

  // Schedule proactive sweep
  cron.schedule(config.proactiveSweepCron, async () => {
    try {
      await runSweep();
    } catch (err) {
      logger.error({ err }, 'proactive.cron.error');
    }
  }, { timezone: config.proactiveTimezone });
  logger.info({ cron: config.proactiveSweepCron, timezone: config.proactiveTimezone }, 'proactive.cron.scheduled');

  // CRON-01/CRON-02: Daily episodic consolidation — independent cron, DST-safe
  // via node-cron's timezone option combined with Phase 21's CONS-03 idempotency
  // (UNIQUE(summary_date) + pre-flight SELECT + ON CONFLICT DO NOTHING). Fires
  // at config.episodicCron in config.proactiveTimezone; consolidates the PRIOR
  // calendar day so the day's entries are complete. PEER to the proactive
  // sweep registration above — NOT nested inside runSweep, runConsolidate, or
  // any other handler.
  cron.schedule(config.episodicCron, async () => {
    try {
      await runConsolidateYesterday();
    } catch (err) {
      logger.error({ err }, 'episodic.cron.error');
    }
  }, { timezone: config.proactiveTimezone });
  logger.info({ cron: config.episodicCron, timezone: config.proactiveTimezone }, 'episodic.cron.scheduled');

  const port = parseInt(process.env.PORT || '3000', 10);

  if (config.webhookUrl) {
    const app = createApp();
    app.use(`/${bot.token}`, webhookCallback(bot, 'express'));

    await bot.api.setWebhook(`${config.webhookUrl}/${bot.token}`);

    app.listen(port, () => {
      logger.info({ mode: 'webhook', port }, 'Chris is listening');
    });
  } else {
    // In polling mode, start a minimal Express server for health checks
    const app = createApp();
    app.listen(port, () => {
      logger.info({ mode: 'polling', port }, 'Health server listening');
    });

    await bot.start({
      onStart: () => logger.info({ mode: 'polling' }, 'Chris bot is listening'),
    });
  }
}

const shutdown = async () => {
  logger.info('Shutting down...');
  stopScheduler();
  bot.stop();
  await sql.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  logger.fatal(err, 'Startup failed');
  process.exit(1);
});
