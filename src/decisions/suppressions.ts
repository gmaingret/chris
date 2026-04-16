/**
 * CAP-06 persistence primitive: per-chat trigger-phrase suppression list.
 *
 * Phrases are trimmed + lowercased on write (addSuppression).
 * Matching is case-insensitive substring on read (isSuppressed).
 * Per-chat scoping via chatId filter on every query.
 *
 * Phase 14 Plan 03 — DB helpers only; slash-command handler in Plan 05.
 */
import { db } from '../db/connection.js';
import { decisionTriggerSuppressions } from '../db/schema.js';
import { eq, desc, and } from 'drizzle-orm';

/**
 * Persist a suppression phrase for a chat.
 * Trims and lowercases before insert; duplicate inserts are a no-op
 * (absorbed by the (chatId, phrase) unique constraint).
 *
 * @throws Error if phrase is empty after trimming or exceeds 200 chars.
 */
export async function addSuppression(chatId: bigint, phrase: string): Promise<void> {
  const normalized = phrase.trim().toLowerCase();
  if (normalized.length === 0) {
    throw new Error('suppression phrase must be non-empty after trimming');
  }
  if (normalized.length > 200) {
    throw new Error('suppression phrase exceeds 200 character limit');
  }
  await db
    .insert(decisionTriggerSuppressions)
    .values({ chatId, phrase: normalized })
    .onConflictDoNothing({
      target: [decisionTriggerSuppressions.chatId, decisionTriggerSuppressions.phrase],
    });
}

/**
 * Check whether any of a chat's suppressed phrases is a case-insensitive
 * substring of `text`.
 *
 * Returns true on first match (short-circuit).
 */
export async function isSuppressed(text: string, chatId: bigint): Promise<boolean> {
  const haystack = text.toLowerCase();
  const rows = await db
    .select({ phrase: decisionTriggerSuppressions.phrase })
    .from(decisionTriggerSuppressions)
    .where(eq(decisionTriggerSuppressions.chatId, chatId));
  for (const row of rows) {
    if (haystack.includes(row.phrase)) return true;
  }
  return false;
}

/**
 * Remove a suppression phrase for a chat by exact (normalized) match.
 * No-op if the phrase does not exist. Normalizes: trim + toLowerCase.
 *
 * Returns true if a row was actually deleted, false if no match existed.
 */
export async function removeSuppression(chatId: bigint, phrase: string): Promise<boolean> {
  const normalized = phrase.trim().toLowerCase();
  if (normalized.length === 0) return false;
  const result = await db
    .delete(decisionTriggerSuppressions)
    .where(
      and(
        eq(decisionTriggerSuppressions.chatId, chatId),
        eq(decisionTriggerSuppressions.phrase, normalized),
      )
    )
    .returning({ phrase: decisionTriggerSuppressions.phrase });
  return result.length > 0;
}

/**
 * List all suppressed phrases for a chat, newest first.
 * Returns stored (lowercased) phrases.
 */
export async function listSuppressions(chatId: bigint): Promise<string[]> {
  const rows = await db
    .select({ phrase: decisionTriggerSuppressions.phrase })
    .from(decisionTriggerSuppressions)
    .where(eq(decisionTriggerSuppressions.chatId, chatId))
    .orderBy(desc(decisionTriggerSuppressions.createdAt));
  return rows.map((r) => r.phrase);
}
