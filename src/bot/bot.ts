import { Bot } from 'grammy';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { auth } from './middleware/auth.js';

export const bot = new Bot(config.telegramBotToken);

bot.use(auth);

bot.on('message:text', async (ctx) => {
  await ctx.reply('I hear you. Chris is waking up...');
});

bot.catch((err) => {
  logger.error({ err: err.error, ctx: err.ctx?.update }, 'Bot error');
});
