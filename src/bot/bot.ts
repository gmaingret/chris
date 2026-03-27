import { Bot } from 'grammy';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { auth } from './middleware/auth.js';
import { processMessage } from '../chris/engine.js';

export const bot = new Bot(config.telegramBotToken);

bot.use(auth);

/** Exported for testability — called by bot.on('message:text') */
export async function handleTextMessage(ctx: {
  chat: { id: number };
  from: { id: number };
  message: { text: string };
  reply: (text: string) => Promise<unknown>;
}): Promise<void> {
  const chatId = BigInt(ctx.chat.id);
  const userId = ctx.from.id;
  const text = ctx.message.text;

  try {
    const response = await processMessage(chatId, userId, text);
    await ctx.reply(response);
  } catch (error) {
    logger.error(
      {
        chatId: chatId.toString(),
        error: error instanceof Error ? error.message : String(error),
      },
      'chris.bot.error',
    );
    await ctx.reply("I got tangled up in my thoughts. Try again?");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.on('message:text', handleTextMessage as any);

bot.catch((err) => {
  logger.error({ err: err.error, ctx: err.ctx?.update }, 'Bot error');
});
