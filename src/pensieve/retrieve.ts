import { cosineDistance, asc, isNull, eq, and, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { pensieveEmbeddings, pensieveEntries, epistemicTagEnum } from '../db/schema.js';
import { embedText } from './embeddings.js';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type SearchResult = {
  entry: typeof pensieveEntries.$inferSelect;
  score: number;
};

export type SearchOptions = {
  tags?: string[];
  recencyBias?: number;  // 0.0 (pure cosine) to 1.0 (strong recency)
  limit?: number;        // default 5
  minScore?: number;     // filter results below this blended score
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
      .limit(limit * 3); // Over-fetch to allow dedup across chunks

    // Deduplicate by entry_id — keep best-scoring (lowest distance) chunk per entry
    const bestByEntry = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const entryId = row.entry.id;
      const existing = bestByEntry.get(entryId);
      if (!existing || Number(row.distance) < Number(existing.distance)) {
        bestByEntry.set(entryId, row);
      }
    }

    const dedupedRows = Array.from(bestByEntry.values())
      .sort((a, b) => Number(a.distance) - Number(b.distance))
      .slice(0, limit);

    const results: SearchResult[] = dedupedRows.map((row) => ({
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

/**
 * Hybrid search with temporal weighting, epistemic tag filtering,
 * configurable limits, and minimum score thresholds.
 *
 * Computes a blended score: `cosineSimilarity * exp(-recencyBias * daysSince / 365)`
 * When recencyBias is 0 (default), results match pure cosine ranking.
 *
 * Never throws — returns an empty array on any error.
 */
export async function hybridSearch(
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const start = Date.now();
  const limit = options.limit ?? 5;
  const recencyBias = options.recencyBias ?? 0;

  try {
    const queryEmbedding = await embedText(query);
    if (!queryEmbedding) {
      logger.warn(
        { query: query.slice(0, 50) },
        'pensieve.hybrid-retrieve.error',
      );
      return [];
    }

    const distance = cosineDistance(pensieveEmbeddings.embedding, queryEmbedding);

    // Build WHERE conditions
    const conditions = [isNull(pensieveEntries.deletedAt)];
    if (options.tags && options.tags.length > 0) {
      conditions.push(
        inArray(
          pensieveEntries.epistemicTag,
          options.tags as (typeof epistemicTagEnum.enumValues)[number][],
        ),
      );
    }

    // Fetch more than requested to allow post-processing filtering
    const sqlLimit = Math.max(limit * 2, 20);

    const rows = await db
      .select({
        entry: pensieveEntries,
        distance,
      })
      .from(pensieveEmbeddings)
      .innerJoin(pensieveEntries, eq(pensieveEmbeddings.entryId, pensieveEntries.id))
      .where(and(...conditions))
      .orderBy(asc(distance))
      .limit(sqlLimit);

    // Compute blended scores with temporal weighting
    const scored = rows.map((row) => {
      const cosineSim = 1 - Number(row.distance);
      const daysSince =
        (Date.now() - new Date(row.entry.createdAt!).getTime()) /
        (1000 * 60 * 60 * 24);
      const blendedScore = cosineSim * Math.exp(-recencyBias * daysSince / 365);
      return { entry: row.entry, score: blendedScore };
    });

    // Filter by minScore if provided
    const filtered = options.minScore != null
      ? scored.filter((r) => r.score >= options.minScore!)
      : scored;

    // Re-sort by blended score descending and apply limit
    const results = filtered
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const latencyMs = Date.now() - start;
    logger.info(
      {
        query: query.slice(0, 50),
        resultCount: results.length,
        latencyMs,
        tags: options.tags ?? null,
        recencyBias,
      },
      'pensieve.hybrid-retrieve',
    );

    return results;
  } catch (error) {
    logger.warn(
      {
        query: query.slice(0, 50),
        error: error instanceof Error ? error.message : String(error),
      },
      'pensieve.hybrid-retrieve.error',
    );
    return [];
  }
}

// ── Mode-Specific Search Presets ───────────────────────────────────────────

/** Reflect needs broad temporal range — old patterns matter */
export const REFLECT_SEARCH_OPTIONS: SearchOptions = {
  recencyBias: 0.1,
  limit: 15,
};

/** Coach focuses on recent beliefs, intentions, values */
export const COACH_SEARCH_OPTIONS: SearchOptions = {
  recencyBias: 0.5,
  limit: 10,
  tags: ['BELIEF', 'INTENTION', 'VALUE'],
};

/** Psychology needs emotional/depth data across time */
export const PSYCHOLOGY_SEARCH_OPTIONS: SearchOptions = {
  recencyBias: 0.2,
  limit: 15,
  tags: ['EMOTION', 'FEAR', 'BELIEF', 'DREAM'],
};

/** Produce uses moderate recency for decision grounding */
export const PRODUCE_SEARCH_OPTIONS: SearchOptions = {
  recencyBias: 0.3,
  limit: 10,
};

/** Contradiction detection needs broad cosine match on belief-like entries */
export const CONTRADICTION_SEARCH_OPTIONS: SearchOptions = {
  recencyBias: 0,
  limit: 20,
  tags: ['BELIEF', 'INTENTION', 'VALUE'],
  minScore: 0.4,
};
