import { and, eq, gte, sql, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { conversations } from '../db/schema.js';
import { logger } from '../utils/logger.js';

type ConversationRole = 'USER' | 'ASSISTANT';
type ConversationMode = 'JOURNAL' | 'INTERROGATE' | 'REFLECT' | 'COACH' | 'PSYCHOLOGY' | 'PRODUCE' | 'PHOTOS';

/**
 * Persist a single conversation message to the `conversations` table.
 * Returns the inserted row.
 */
export async function saveMessage(
  chatId: bigint,
  role: ConversationRole,
  content: string,
  mode: ConversationMode,
): Promise<typeof conversations.$inferSelect> {
  const [row] = await db
    .insert(conversations)
    .values({ chatId, role, content, mode })
    .returning();

  if (!row) {
    throw new Error('Failed to insert conversation message — no row returned');
  }

  logger.info({ chatId: chatId.toString(), role, mode }, 'memory.conversation.save');

  return row;
}

/**
 * Retrieve recent conversation history for a chat, ordered oldest-first.
 * Default limit is 20 messages.
 */
export async function getRecentHistory(
  chatId: bigint,
  limit: number = 20,
): Promise<(typeof conversations.$inferSelect)[]> {
  // Fetch the most recent N messages (DESC), then reverse to chronological order
  // for the LLM. Without the subquery pattern, ordering ASC + LIMIT gives the
  // OLDEST N messages — not the most recent.
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.chatId, chatId))
    .orderBy(desc(conversations.createdAt))
    .limit(limit);

  // Reverse to chronological (oldest-first) for the conversation context
  rows.reverse();

  logger.info({ chatId: chatId.toString(), count: rows.length }, 'memory.conversation.load');

  return rows;
}

/**
 * Count messages of a given role for a chat that were created after `since`.
 * Used by Phase 32 #2: skip-when-no-USER-in-window guard in the proactive
 * sweep. With `role = 'USER'` and `since = now - 48h` it answers the question
 * "has Greg been active recently enough that an outreach has substrate to
 * ground in?" — when the answer is 0, runReflectiveChannel skips the Sonnet
 * call rather than risk hollow / meta-commentary output.
 */
export async function countMessagesSince(
  chatId: bigint,
  role: ConversationRole,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .where(
      and(
        eq(conversations.chatId, chatId),
        eq(conversations.role, role),
        gte(conversations.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}
