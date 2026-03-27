import { cosineDistance, asc, isNull, eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { pensieveEmbeddings, pensieveEntries } from '../db/schema.js';
import { embedText } from './embeddings.js';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type SearchResult = {
  entry: typeof pensieveEntries.$inferSelect;
  score: number;
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Search pensieve entries by semantic similarity to a query string.
 *
 * Returns entries ranked by cosine similarity (highest first), with deleted
 * entries filtered out. Never throws — returns an empty array on any error.
 */
export async function searchPensieve(
  query: string,
  limit: number = 5,
): Promise<SearchResult[]> {
  const start = Date.now();
  try {
    const queryEmbedding = await embedText(query);
    if (!queryEmbedding) {
      logger.warn(
        { query: query.slice(0, 50) },
        'pensieve.retrieve.error',
      );
      return [];
    }

    const distance = cosineDistance(pensieveEmbeddings.embedding, queryEmbedding);

    const rows = await db
      .select({
        entry: pensieveEntries,
        distance,
      })
      .from(pensieveEmbeddings)
      .innerJoin(pensieveEntries, eq(pensieveEmbeddings.entryId, pensieveEntries.id))
      .where(isNull(pensieveEntries.deletedAt))
      .orderBy(asc(distance))
      .limit(limit);

    const results: SearchResult[] = rows.map((row) => ({
      entry: row.entry,
      score: 1 - Number(row.distance),
    }));

    const latencyMs = Date.now() - start;
    logger.info(
      { query: query.slice(0, 50), resultCount: results.length, latencyMs },
      'pensieve.retrieve',
    );

    return results;
  } catch (error) {
    logger.warn(
      {
        query: query.slice(0, 50),
        error: error instanceof Error ? error.message : String(error),
      },
      'pensieve.retrieve.error',
    );
    return [];
  }
}
