import { eq, asc, desc } from 'drizzle-orm';
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
