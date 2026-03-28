import { eq, sql, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { pensieveEntries, pensieveEmbeddings } from '../db/schema.js';
import { StorageError } from '../utils/errors.js';
import { computeContentHash } from '../utils/content-hash.js';
import { logger } from '../utils/logger.js';

export interface PensieveEntryMetadata {
  telegramMessageId?: number;
  telegramChatId?: number;
  originalTimestamp?: string;
  [key: string]: unknown;
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

    if (!entry) {
      throw new StorageError('Insert returned no rows');
    }

    logger.info({ entryId: entry.id, source }, 'pensieve.store');

    return entry;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('Failed to store pensieve entry', error);
  }
}

/**
 * Store a pensieve entry with content-hash deduplication.
 *
 * Computes SHA-256 of content. If an entry with the same hash already exists,
 * returns the existing entry and logs `pensieve.store.dedup`. Otherwise inserts
 * a new entry with the contentHash field set.
 *
 * Throws StorageError on empty content or database failures.
 */
export async function storePensieveEntryDedup(
  content: string,
  source: string = 'telegram',
  metadata?: PensieveEntryMetadata,
): Promise<typeof pensieveEntries.$inferSelect> {
  if (!content) {
    throw new StorageError('Content must not be empty');
  }

  const contentHash = computeContentHash(content);

  try {
    // Check for existing entry with same content hash
    const [existing] = await db
      .select()
      .from(pensieveEntries)
      .where(eq(pensieveEntries.contentHash, contentHash))
      .limit(1);

    if (existing) {
      logger.info(
        { contentHash, existingEntryId: existing.id },
        'pensieve.store.dedup',
      );
      return existing;
    }

    // Insert new entry with content hash
    const [entry] = await db
      .insert(pensieveEntries)
      .values({
        content,
        source,
        contentHash,
        metadata: metadata ?? null,
      })
      .returning();

    if (!entry) {
      throw new StorageError('Insert returned no rows');
    }

    logger.info({ entryId: entry.id, source, contentHash }, 'pensieve.store');

    return entry;
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('Failed to store pensieve entry', error);
  }
}

export type UpsertAction = 'created' | 'updated' | 'skipped';

export interface UpsertResult {
  entry: typeof pensieveEntries.$inferSelect;
  action: UpsertAction;
}

/**
 * Upsert a pensieve entry by an external ID stored in the metadata JSONB field.
 *
 * Lookup: SELECT WHERE source = X AND metadata->>externalIdField = value.
 * - If not found: INSERT new entry → action 'created'.
 * - If found + same content hash: no-op → action 'skipped'.
 * - If found + different hash: UPDATE content, content_hash, updated_at,
 *   DELETE old embeddings → action 'updated'.
 *
 * Throws StorageError on empty content or DB failures.
 */
export async function storePensieveEntryUpsert(
  content: string,
  source: string,
  metadata: PensieveEntryMetadata,
  externalIdField: string,
): Promise<UpsertResult> {
  if (!content) {
    throw new StorageError('Content must not be empty');
  }

  const externalId = metadata[externalIdField];
  if (!externalId) {
    throw new StorageError(`Metadata field '${externalIdField}' is required for upsert`);
  }

  const contentHash = computeContentHash(content);

  try {
    // Look up existing entry by source + metadata external ID via JSONB query
    const existing = await db
      .select()
      .from(pensieveEntries)
      .where(
        and(
          eq(pensieveEntries.source, source),
          sql`${pensieveEntries.metadata}->>${externalIdField} = ${String(externalId)}`,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const entry = existing[0]!;

      // Same hash → skip
      if (entry.contentHash === contentHash) {
        logger.info(
          { entryId: entry.id, action: 'skipped', externalId: String(externalId) },
          'pensieve.store.upsert',
        );
        return { entry, action: 'skipped' };
      }

      // Different hash → update content and delete old embeddings
      const [updated] = await db
        .update(pensieveEntries)
        .set({
          content,
          contentHash,
          updatedAt: new Date(),
        })
        .where(eq(pensieveEntries.id, entry.id))
        .returning();

      if (!updated) {
        throw new StorageError('Update returned no rows');
      }

      await db
        .delete(pensieveEmbeddings)
        .where(eq(pensieveEmbeddings.entryId, entry.id));

      logger.info(
        { entryId: entry.id, action: 'updated', externalId: String(externalId) },
        'pensieve.store.upsert',
      );

      return { entry: updated, action: 'updated' };
    }

    // Not found → create new entry
    const [entry] = await db
      .insert(pensieveEntries)
      .values({
        content,
        source,
        contentHash,
        metadata: metadata ?? null,
      })
      .returning();

    if (!entry) {
      throw new StorageError('Insert returned no rows');
    }

    logger.info(
      { entryId: entry.id, action: 'created', externalId: String(externalId) },
      'pensieve.store.upsert',
    );

    return { entry, action: 'created' };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('Failed to upsert pensieve entry', error);
  }
}
