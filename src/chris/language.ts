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
 * LANG-02 / PLAN.md D021: Messages below 4 words or 15 characters inherit
 * the language of the previous user message in the conversation. Default
 * to English only if no prior user message exists.
 *
 * LANG-01: Uses franc with restricted language set (eng/fra/rus only).
 * Returns 'English' | 'French' | 'Russian'.
 */
export function detectLanguage(text: string, previousLanguage: string | null): string {
  // LANG-02 / D021: short message threshold — inherit previous if any, default
  // to English when no prior exists.
  const words = text.trim().split(/\s+/);
  if (words.length < 4 || text.trim().length < 15) {
    return previousLanguage ?? 'English';
  }

  // LANG-01: franc with restricted language set
  const detected = franc(text, { only: ['eng', 'fra', 'rus'] });
  const languageName = LANGUAGE_NAMES[detected];

  if (!languageName) {
    // 'und' on longer text: inherit previous if any, otherwise default to English
    return previousLanguage ?? 'English';
  }

  return languageName;
}

// ── Session state accessors ────────────────────────────────────────────────

export function getLastUserLanguage(chatId: string): string | null {
  return sessionLanguage.get(chatId) ?? null;
}

/**
 * DB-backed language detection for cron-context handlers (Phase 32 weekly_review
 * follow-up 2026-05-11). The in-memory `sessionLanguage` map resets on process
 * restart; cron handlers that fire infrequently (e.g., weekly_review once/week)
 * usually find it empty even when the user has a clear language signal in the
 * conversation history. This helper queries the conversations table for the
 * most recent USER message and runs franc on it.
 *
 * Returns 'English' | 'French' | 'Russian' or null when no USER message exists
 * (fresh chat). Callers should fall back to a sensible default — for Greg, French.
 */
export async function getLastUserLanguageFromDb(
  chatId: bigint,
): Promise<string | null> {
  const { db } = await import('../db/connection.js');
  const { conversations } = await import('../db/schema.js');
  const { and, eq, desc } = await import('drizzle-orm');

  const rows = await db
    .select({ content: conversations.content })
    .from(conversations)
    .where(
      and(eq(conversations.chatId, chatId), eq(conversations.role, 'USER')),
    )
    .orderBy(desc(conversations.createdAt))
    .limit(1);

  if (rows.length === 0 || !rows[0]!.content) return null;
  return detectLanguage(rows[0]!.content, null);
}

export function setLastUserLanguage(chatId: string, language: string): void {
  sessionLanguage.set(chatId, language);
}

export function clearLanguageState(chatId: string): void {
  sessionLanguage.delete(chatId);
}
