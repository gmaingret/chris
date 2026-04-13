import { franc } from 'franc';

// ── Language name mapping ──────────────────────────────────────────────────
// franc returns ISO 639-3 codes; system prompts need display names

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English',
  fra: 'French',
  rus: 'Russian',
};

// ── Session state ──────────────────────────────────────────────────────────
// Ephemeral per D-03: resets on process restart, not DB-backed

const sessionLanguage = new Map<string, string>();

// ── Language detection ─────────────────────────────────────────────────────

/**
 * Detect the language of a user message.
 *
 * LANG-02: Messages below 4 words or 15 characters inherit the language
 * of the previous user message in the conversation. Default to English
 * if no prior user message exists.
 *
 * LANG-01: Uses franc with restricted language set (eng/fra/rus only).
 * Returns 'English' | 'French' | 'Russian'.
 */
export function detectLanguage(text: string, previousLanguage: string | null): string {
  // LANG-02: short message threshold
  const words = text.trim().split(/\s+/);
  if (words.length < 4 || text.trim().length < 15) {
    return previousLanguage ?? 'English';
  }

  // LANG-01: franc with restricted language set
  const detected = franc(text, { only: ['eng', 'fra', 'rus'] });
  const languageName = LANGUAGE_NAMES[detected];

  if (!languageName) {
    // 'und' or unrecognized — fall back to previous or English
    return previousLanguage ?? 'English';
  }

  return languageName;
}

// ── Session state accessors ────────────────────────────────────────────────

export function getLastUserLanguage(chatId: string): string | null {
  return sessionLanguage.get(chatId) ?? null;
}

export function setLastUserLanguage(chatId: string, language: string): void {
  sessionLanguage.set(chatId, language);
}

export function clearLanguageState(chatId: string): void {
  sessionLanguage.delete(chatId);
}
