import { eq, asc, desc } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { conversations } from '../db/schema.js';
import { logger } from '../utils/logger.js';

type ConversationRole = 'USER' | 'ASSISTANT';
type ConversationMode = 'JOURNAL' | 'INTERROGATE' | 'REFLECT' | 'COACH' | 'PSYCHOLOGY' | 'PRODUCE';

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
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.chatId, chatId))
    .orderBy(asc(conversations.createdAt))
    .limit(limit);

  logger.info({ chatId: chatId.toString(), count: rows.length }, 'memory.conversation.load');

  return rows;
}
