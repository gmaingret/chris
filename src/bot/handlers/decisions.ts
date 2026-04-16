/**
 * Phase 14 CAP-06 — /decisions command handler.
 *
 * Phase 14 supports ONLY `suppress <phrase>`. Other sub-commands
 * (open, recent, stats, reclassify) reply with "Coming in Phase 17."
 *
 * Security: handler logs only {chatId, error.message} on failure;
 * never logs the phrase itself (T-14-05-05).
 */
import type { Context } from 'grammy';
import { addSuppression } from '../../decisions/suppressions.js';
import { getLastUserLanguage } from '../../chris/language.js';
import { logger } from '../../utils/logger.js';

export async function handleDecisionsCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const chatIdBig = BigInt(chatId);
  const lang = isoLang(getLastUserLanguage(chatId.toString()));

  const raw = ctx.message?.text ?? '';
  // format: "/decisions suppress <phrase>" (Grammy sends full text incl. slash)
  const after = raw.replace(/^\/decisions(?:@\w+)?\s*/i, '').trim();
  if (!after) {
    await ctx.reply(usageMessage(lang));
    return;
  }

  const [sub, ...rest] = after.split(/\s+/);
  const arg = rest.join(' ').trim();

  if (sub!.toLowerCase() === 'suppress') {
    if (!arg) { await ctx.reply(usageMessage(lang)); return; }
    if (arg.length > 200) { await ctx.reply(tooLongMessage(lang)); return; }
    try {
      await addSuppression(chatIdBig, arg);
      await ctx.reply(confirmedMessage(lang, arg.trim().toLowerCase()));
    } catch (err) {
      logger.warn({
        error: err instanceof Error ? err.message : String(err),
        chatId,
      }, 'decisions.suppress.error');
      await ctx.reply(genericErrorMessage(lang));
    }
    return;
  }

  if (['open', 'recent', 'stats', 'reclassify'].includes(sub!.toLowerCase())) {
    await ctx.reply(phase17Message(lang));
    return;
  }

  await ctx.reply(usageMessage(lang));
}

function isoLang(raw: string | null): 'en' | 'fr' | 'ru' {
  return raw === 'French' ? 'fr' : raw === 'Russian' ? 'ru' : 'en';
}

function usageMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'Usage: /decisions suppress <phrase>';
    case 'fr': return 'Usage : /decisions suppress <phrase>';
    case 'ru': return 'Использование: /decisions suppress <phrase>';
  }
}

function tooLongMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'That phrase is too long (200 char max).';
    case 'fr': return 'Cette phrase est trop longue (200 caractères max).';
    case 'ru': return 'Слишком длинная фраза (максимум 200 символов).';
  }
}

function confirmedMessage(l: 'en' | 'fr' | 'ru', phrase: string): string {
  switch (l) {
    case 'en': return `Suppressed "${phrase}". I won't trigger on messages containing it.`;
    case 'fr': return `Supprimée : "${phrase}". Je ne déclencherai plus sur les messages la contenant.`;
    case 'ru': return `Подавил «${phrase}». Больше не буду срабатывать на сообщения с этой фразой.`;
  }
}

function phase17Message(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'Coming in Phase 17.';
    case 'fr': return 'Arrive en Phase 17.';
    case 'ru': return 'Будет в фазе 17.';
  }
}

function genericErrorMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'Something went wrong saving that suppression.';
    case 'fr': return 'Erreur en sauvegardant cette suppression.';
    case 'ru': return 'Ошибка при сохранении подавления.';
  }
}
