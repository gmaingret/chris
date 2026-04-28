/**
 * src/bot/handlers/voice-decline.ts — Phase 26 Plan 04 (VOICE-05; D-26-09)
 *
 * Polite-decline handler for Telegram message:voice updates. Greg's input
 * modality is the Android STT keyboard (which produces text messages); a
 * literal voice message means he tapped the wrong icon. Reply in EN/FR/RU
 * per his last text-message language (M006 stickiness contract via
 * src/chris/language.ts getLastUserLanguage).
 *
 * Constraints (per CONTEXT.md D-26-09 + OOS-3):
 *   - NO transcription via any provider (OOS-3 anti-feature).
 *   - NO Pensieve write (the voice message is intentionally lost; Greg
 *     should re-send via STT keyboard if he wants it preserved).
 *   - NO engine-pipeline invocation (the engine path is for text messages
 *     only; PP#5 + PP#0..4 don't apply to voice).
 *   - NO franc invocation on the empty-text voice message (the message has
 *     no text to detect language from); use stored last-language instead.
 */
import { getLastUserLanguage } from '../../chris/language.js';
import { logger } from '../../utils/logger.js';

const DECLINE_MESSAGES = {
  en: "I can only read text messages — try the microphone icon on your Android keyboard to dictate.",
  fr: "Je ne lis que les messages texte — essaie l'icône micro de ton clavier Android pour dicter.",
  ru: "Я понимаю только текстовые сообщения — попробуй значок микрофона на клавиатуре Android для диктовки.",
} as const;

const LANG_TO_KEY: Record<string, keyof typeof DECLINE_MESSAGES> = {
  English: 'en',
  French: 'fr',
  Russian: 'ru',
};

/**
 * handleVoiceMessageDecline — registered via bot.on('message:voice', ...) in
 * src/bot/bot.ts. Reads the chat's last-language and replies with the
 * matching templated decline message (D-26-09).
 */
export async function handleVoiceMessageDecline(ctx: {
  chat: { id: number };
  reply: (text: string) => Promise<unknown>;
}): Promise<void> {
  const chatIdStr = String(ctx.chat.id);
  const lastLang = getLastUserLanguage(chatIdStr);
  const mapped = lastLang ? LANG_TO_KEY[lastLang] : undefined;
  const langKey: keyof typeof DECLINE_MESSAGES = mapped ?? 'en';
  await ctx.reply(DECLINE_MESSAGES[langKey]);
  logger.info({ chatId: chatIdStr, langKey }, 'bot.voice.declined');
}
