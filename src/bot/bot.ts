import { Bot } from 'grammy';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { auth } from './middleware/auth.js';
import { processMessage } from '../chris/engine.js';
import { handleDocument } from './handlers/document.js';
import { handleSyncCommand, isAwaitingOAuthCode, handleOAuthCode } from './handlers/sync.js';

export const bot = new Bot(config.telegramBotToken);

bot.use(auth);

// /sync command — must be registered before generic text handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.command('sync', handleSyncCommand as any);

/** Exported for testability — called by bot.on('message:text') */
export async function handleTextMessage(ctx: {
  chat: { id: number };
  from: { id: number };
  message: { text: string };
  reply: (text: string) => Promise<unknown>;
}): Promise<void> {
  // Intercept OAuth code if we're waiting for one from this chat
  if (isAwaitingOAuthCode(ctx.chat.id)) {
    await handleOAuthCode(ctx);
    return;
  }

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.on('message:document', handleDocument as any);

bot.catch((err) => {
  logger.error({ err: err.error, ctx: err.ctx?.update }, 'Bot error');
});
