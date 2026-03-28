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

function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get('/health', async (_req, res) => {
    try {
      await sql`SELECT 1`;
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown database error';
      logger.warn({ err }, 'Health check failed');
      res.status(503).json({ status: 'error', error: message });
    }
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
