import { Bot } from 'grammy';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { auth } from './middleware/auth.js';
import { processMessage } from '../chris/engine.js';
import { getLastUserLanguage } from '../chris/language.js';
import { handleDocument } from './handlers/document.js';
import { handleSyncCommand, isAwaitingOAuthCode, handleOAuthCode } from './handlers/sync.js';
import { handleDecisionsCommand } from './handlers/decisions.js';

const ERROR_FALLBACK: Record<string, string> = {
  English: 'I got tangled up in my thoughts. Try again?',
  French: "Je me suis un peu emmêlé dans mes pensées. Tu peux réessayer ?",
  Russian: 'Я запутался в своих мыслях. Попробуй ещё раз?',
};

export const bot = new Bot(config.telegramBotToken);

bot.use(auth);

// /sync command — must be registered before generic text handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.command('sync', handleSyncCommand as any);

// /decisions command — must be registered before generic text handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.command('decisions', handleDecisionsCommand as any);

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
    // IN-02: guard empty-string reply from processMessage. Reachable only on a
    // narrow race inside Phase 14 capture flow (e.g. capture cleared between
    // engine's PP#0 check and handleCapture's own state read). Telegram
    // rejects empty text with "Bad Request: message text is empty"; silently
    // skipping is the correct behavior — the user has already seen whatever
    // reply the ack/abort path produced.
    if (response) await ctx.reply(response);
  } catch (error) {
    logger.error(
      {
        chatId: chatId.toString(),
        error: error instanceof Error ? error.message : String(error),
      },
      'chris.bot.error',
    );
    const lang = getLastUserLanguage(chatId.toString());
    await ctx.reply(ERROR_FALLBACK[lang ?? 'English'] ?? ERROR_FALLBACK.English!);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.on('message:text', handleTextMessage as any);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.on('message:document', handleDocument as any);

bot.catch((err) => {
  logger.error({ err: err.error, ctx: err.ctx?.update }, 'Bot error');
});
