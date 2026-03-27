import express from 'express';
import { webhookCallback } from 'grammy';
import { bot } from './bot/bot.js';
import { sql } from './db/connection.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('Chris starting...');

  if (config.webhookUrl) {
    const app = express();
    app.use(express.json());

    app.use(`/${bot.token}`, webhookCallback(bot, 'express'));

    const port = parseInt(process.env.PORT || '3000', 10);
    await bot.api.setWebhook(`${config.webhookUrl}/${bot.token}`);

    app.listen(port, () => {
      logger.info({ mode: 'webhook', port }, 'Chris is listening');
    });
  } else {
    await bot.start({
      onStart: () => logger.info({ mode: 'polling' }, 'Chris is listening'),
    });
  }
}

const shutdown = async () => {
  logger.info('Shutting down...');
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
