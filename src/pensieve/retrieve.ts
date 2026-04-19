import { cosineDistance, asc, isNull, eq, and, inArray, gte, lte } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { pensieveEmbeddings, pensieveEntries, epistemicTagEnum, episodicSummaries } from '../db/schema.js';
import { embedText } from './embeddings.js';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type SearchResult = {
  entry: typeof pensieveEntries.$inferSelect;
  score: number;
};

export type SearchOptions = {
  tags?: (typeof epistemicTagEnum.enumValues)[number][];
  recencyBias?: number;  // 0.0 (pure cosine) to 1.0 (strong recency)
  limit?: number;        // default 5
  minScore?: number;     // filter results below this blended score
};

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Format a JS Date as a 'YYYY-MM-DD' calendar-date string in the given IANA
 * timezone. Uses Intl.DateTimeFormat (Node 22 native — no third-party tz dep).
 *
 * Used by `getEpisodicSummary` and `getEpisodicSummariesRange` to convert
 * Date inputs to the local-day key used by the `episodic_summaries.summary_date`
 * column. The 'en-CA' locale yields ISO-style 'YYYY-MM-DD' format.
 */
function formatLocalDate(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

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
 * Retrieve Pensieve entries within a time window around a center date.
 * Used by resolution.ts to get +/-48h context around a decision's resolve_by date.
 *
 * Returns entries ordered by createdAt ascending (chronological).
 * Capped at {@link TEMPORAL_PENSIEVE_LIMIT} rows — on a high-volume boundary
 * day the earliest entries (asc order) are returned and later entries silently
 * dropped. When the cap is hit, a `pensieve.temporal.truncated` debug log is
 * emitted so the truncation is observable at the resolution-prompt call site.
 * Never throws -- returns empty array on any error.
 */
const TEMPORAL_PENSIEVE_LIMIT = 50;

export async function getTemporalPensieve(
  centerDate: Date,
  windowMs: number,
): Promise<(typeof pensieveEntries.$inferSelect)[]> {
  try {
    const from = new Date(centerDate.getTime() - windowMs);
    const to = new Date(centerDate.getTime() + windowMs);

    const rows = await db
      .select()
      .from(pensieveEntries)
      .where(
        and(
          isNull(pensieveEntries.deletedAt),
          gte(pensieveEntries.createdAt, from),
          lte(pensieveEntries.createdAt, to),
        ),
      )
      .orderBy(asc(pensieveEntries.createdAt))
      .limit(TEMPORAL_PENSIEVE_LIMIT);

    // IN-03: surface truncation — a boundary day with >50 entries silently
    // drops later ones, which can bias the resolution prompt toward earliest
    // context. Emit a debug-level log so operators can spot when the cap is
    // hit without cluttering info logs on normal days.
    if (rows.length === TEMPORAL_PENSIEVE_LIMIT) {
      logger.debug(
        {
          centerDate: centerDate.toISOString(),
          windowMs,
          limit: TEMPORAL_PENSIEVE_LIMIT,
        },
        'pensieve.temporal.truncated',
      );
    }

    return rows;
  } catch (error) {
    logger.warn(
      {
        centerDate: centerDate.toISOString(),
        windowMs,
        error: error instanceof Error ? error.message : String(error),
      },
      'pensieve.temporal.error',
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
        inArray(pensieveEntries.epistemicTag, options.tags),
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

    // Deduplicate by entry_id — keep best-scoring chunk per entry
    const bestByEntry = new Map<string, (typeof scored)[number]>();
    for (const item of scored) {
      const id = item.entry.id;
      const existing = bestByEntry.get(id);
      if (!existing || item.score > existing.score) {
        bestByEntry.set(id, item);
      }
    }
    const deduped = Array.from(bestByEntry.values());

    // Filter by minScore if provided
    const filtered = options.minScore != null
      ? deduped.filter((r) => r.score >= options.minScore!)
      : deduped;

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
        ...(options.tags ? { tags: options.tags } : {}),
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

/** JOURNAL grounds responses in stable facts — moderate recency, fact-type tags */
export const JOURNAL_SEARCH_OPTIONS: SearchOptions = {
  tags: ['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE'],
  recencyBias: 0.3,
  limit: 10,
};

// ── Episodic Summary Retrieval ──────────────────────────────────────────────

/**
 * Retrieve the episodic summary for a specific calendar date in
 * config.proactiveTimezone. Returns null if no row exists for that date.
 *
 * The input Date is converted to the local 'YYYY-MM-DD' calendar date in
 * `config.proactiveTimezone` via `Intl.DateTimeFormat` before querying — so
 * a UTC instant late on day N may resolve to day N+1 (or vice versa) when
 * the local timezone offset places it in a different calendar day.
 *
 * Used by Phase 22 retrieval routing and INTERROGATE date-anchored context
 * injection. Never throws — returns null on any error (logged at warn).
 */
export async function getEpisodicSummary(
  date: Date,
): Promise<typeof episodicSummaries.$inferSelect | null> {
  const start = Date.now();
  // WR-01: formatLocalDate calls Intl.DateTimeFormat, which throws
  // RangeError on a misconfigured IANA tz (e.g., a typo in
  // PROACTIVE_TIMEZONE). Compute inside the try/catch so the documented
  // never-throw contract holds even if the tz is invalid.
  let localDate = '';
  try {
    localDate = formatLocalDate(date, config.proactiveTimezone);
    const rows = await db
      .select()
      .from(episodicSummaries)
      .where(eq(episodicSummaries.summaryDate, localDate))
      .limit(1);
    const row = rows[0] ?? null;
    logger.info(
      { date: localDate, found: row !== null, latencyMs: Date.now() - start },
      'pensieve.episodic.retrieve',
    );
    return row;
  } catch (error) {
    logger.warn(
      {
        date: localDate,
        error: error instanceof Error ? error.message : String(error),
      },
      'pensieve.episodic.error',
    );
    return null;
  }
}

/**
 * Retrieve all episodic summaries in an inclusive calendar-date range
 * [from, to] computed in config.proactiveTimezone. Ordered by summary_date
 * ascending. Returns an empty array if no rows match or on any DB error.
 *
 * Both `from` and `to` Date inputs are converted to local 'YYYY-MM-DD'
 * calendar dates in `config.proactiveTimezone` before the WHERE clause is
 * built. The range is inclusive on both bounds.
 *
 * Used by M009 weekly review, M010+ profile inference, and INTERROGATE
 * date-anchored context when the user references a period of days.
 * Never throws.
 */
export async function getEpisodicSummariesRange(
  from: Date,
  to: Date,
): Promise<(typeof episodicSummaries.$inferSelect)[]> {
  const start = Date.now();
  // WR-01: tz format can throw on invalid IANA tz — keep computation inside
  // the try/catch so the never-throw contract holds.
  let fromLocal = '';
  let toLocal = '';
  try {
    fromLocal = formatLocalDate(from, config.proactiveTimezone);
    toLocal = formatLocalDate(to, config.proactiveTimezone);
    const rows = await db
      .select()
      .from(episodicSummaries)
      .where(
        and(
          gte(episodicSummaries.summaryDate, fromLocal),
          lte(episodicSummaries.summaryDate, toLocal),
        ),
      )
      .orderBy(asc(episodicSummaries.summaryDate));
    logger.info(
      {
        from: fromLocal,
        to: toLocal,
        resultCount: rows.length,
        latencyMs: Date.now() - start,
      },
      'pensieve.episodic.retrieve',
    );
    return rows;
  } catch (error) {
    logger.warn(
      {
        from: fromLocal,
        to: toLocal,
        error: error instanceof Error ? error.message : String(error),
      },
      'pensieve.episodic.error',
    );
    return [];
  }
}
