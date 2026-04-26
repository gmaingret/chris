import express from 'express';
import { webhookCallback } from 'grammy';
import { bot } from './bot/bot.js';
import { sql } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { startScheduler, stopScheduler } from './sync/scheduler.js';
import { runSweep } from './proactive/sweep.js';
import { runConsolidateYesterday } from './episodic/cron.js';
import { registerCrons, type CronRegistrationStatus } from './cron-registration.js';
import { runRitualSweep } from './rituals/scheduler.js';

// Module-scoped registration status — populated by main() via registerCrons().
// /health route reads this for the ritual_cron_registered field (RIT-12 part b).
// Test-injectable: createApp(deps) accepts an override so tests do not need to
// invoke main() (with its bot.start + Express listen side effects).
let cronStatus: CronRegistrationStatus | undefined;

export function createApp(deps?: { cronStatus?: CronRegistrationStatus }): express.Express {
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

    // Resolved cron status: deps override (test injection) takes precedence
    // over the module-scoped value populated by main()'s registerCrons call.
    const effectiveCronStatus = deps?.cronStatus ?? cronStatus;

    const statusCode = overallStatus === 'error' ? 503 : 200;
    res.status(statusCode).json({
      status: overallStatus,
      checks,
      ritual_cron_registered: effectiveCronStatus?.ritual === 'registered',
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

  // D-06 + RIT-11: register all crons (proactive 10:00, ritual 21:00,
  // episodic 23:00) via the extracted helper. The returned status map is
  // captured into the module-scoped cronStatus so the /health route can
  // report ritual_cron_registered (RIT-12 part b).
  cronStatus = registerCrons({
    config,
    runSweep,
    runRitualSweep,
    runConsolidateYesterday,
  });

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

// ESM entry-point guard: only invoke main() + register signal handlers when
// this file is the process entry point. Tests that `import { createApp }`
// from this module must NOT trigger main() (with its bot.start, Express
// listen, and process.on side effects). Mirrors the same guard idiom in
// scripts/backfill-episodic.ts (line 283).
if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  main().catch((err) => {
    logger.fatal(err, 'Startup failed');
    process.exit(1);
  });
}
