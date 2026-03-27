import { db } from '../db/connection.js';
import { pensieveEntries } from '../db/schema.js';
import { StorageError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export interface PensieveEntryMetadata {
  telegramMessageId?: number;
  telegramChatId?: number;
  originalTimestamp?: string;
}

/**
 * Insert a pensieve entry with verbatim content — no trimming, no modification.
 * Throws StorageError on empty content or database failures.
 */
export async function storePensieveEntry(
  content: string,
  source: string = 'telegram',
  metadata?: PensieveEntryMetadata,
): Promise<typeof pensieveEntries.$inferSelect> {
  if (!content) {
    throw new StorageError('Content must not be empty');
  }

  try {
    const [entry] = await db
      .insert(pensieveEntries)
      .values({
        content,
        source,
        metadata: metadata ?? null,
      })
      .returning();

    logger.info({ entryId: entry.id, source }, 'pensieve.store');

    return entry;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('Failed to store pensieve entry', error);
  }
}
