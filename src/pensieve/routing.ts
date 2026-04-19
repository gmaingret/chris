import { inArray, isNull, and } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { episodicSummaries, pensieveEntries } from '../db/schema.js';
import { getEpisodicSummary, hybridSearch, type SearchResult } from './retrieve.js';
import { logger } from '../utils/logger.js';

// ── Constants ────────────────────────────────────────────────────────────

/** Recency boundary for raw vs summary routing (RETR-02). */
export const RECENCY_BOUNDARY_DAYS = 7;

/** Importance >= this value forces raw-entry descent alongside summary (RETR-03). */
export const HIGH_IMPORTANCE_THRESHOLD = 8;

/**
 * Verbatim-fidelity keyword fast-path (RETR-02). EN + FR + RU coverage per D020-D021
 * and research PITFALLS #6. Lowercased for case-insensitive match. When any keyword
 * appears as a substring of the lowercased query, routing returns raw entries regardless
 * of queryAge. Keep this list conservative — false positives are cheap (extra raw
 * retrieval) but false negatives silently drop fidelity.
 *
 * Pure keyword matching — NO Haiku/Anthropic call is made on the fast-path. Future
 * Haiku fallback (when miss rate is measurable) is deferred to M009 or later per
 * REQUIREMENTS RETR-02.
 */
export const VERBATIM_KEYWORDS: readonly string[] = [
  // English
  'exactly',
  'verbatim',
  'what did i say',
  'exact words',
  'word for word',
  'precise quote',
  // French
  'exactement',
  'mot pour mot',
  "qu'ai-je dit",
  'textuellement',
  // Russian
  'точно',
  'дословно',
  'что я сказал',
  'слово в слово',
] as const;

// ── Types ────────────────────────────────────────────────────────────────

export type RoutingReason =
  | 'verbatim-keyword'
  | 'recent'
  | 'no-summary-fallback'
  | 'high-importance-descent'
  | 'summary-only';

export interface RetrieveContextOptions {
  /** The user's query text, used for keyword fast-path and semantic search. */
  query: string;
  /** The date the query is ABOUT (not now). If null, routing treats as recent. */
  queryDate?: Date | null;
  /** Cap on raw result count. Default 10. */
  rawLimit?: number;
}

export interface RoutingResult {
  raw: SearchResult[];
  summary: typeof episodicSummaries.$inferSelect | null;
  reason: RoutingReason;
}

// ── Internal helpers ─────────────────────────────────────────────────────

function hasVerbatimKeyword(query: string): boolean {
  const q = query.toLowerCase();
  return VERBATIM_KEYWORDS.some((kw) => q.includes(kw));
}

function computeQueryAgeDays(queryDate: Date | null | undefined): number | null {
  if (queryDate == null) return null;
  const ms = Date.now() - queryDate.getTime();
  return Math.floor(ms / 86_400_000);
}

/**
 * Load raw Pensieve entries by ID, preserving the input order and filtering
 * out soft-deleted entries. Returns an array of SearchResult with score=1.0
 * (these are explicit ID lookups, not similarity matches — the score slot
 * carries a sentinel value so downstream consumers can format the same way).
 */
async function loadEntriesByIds(
  ids: readonly string[],
): Promise<SearchResult[]> {
  if (ids.length === 0) return [];
  try {
    const rows = await db
      .select()
      .from(pensieveEntries)
      .where(and(inArray(pensieveEntries.id, ids as string[]), isNull(pensieveEntries.deletedAt)));
    // Preserve input order — ids array is the source of truth (the summary's source_entry_ids)
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map((entry) => ({ entry, score: 1.0 }));
  } catch (error) {
    logger.warn(
      {
        idCount: ids.length,
        error: error instanceof Error ? error.message : String(error),
      },
      'pensieve.routing.load-error',
    );
    return [];
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Route a retrieval request between raw Pensieve entries and episodic
 * summaries based on two dimensions: recency (≤7d → raw always) and query
 * intent (verbatim-fidelity keywords → raw always regardless of age).
 *
 * High-importance raw descent: when the selected summary has
 * `importance >= 8`, the source raw entries are also surfaced (RETR-03).
 *
 * Every call logs the routing decision for diagnostic visibility (RETR-02).
 * Never throws — defaults to the 'recent' (raw fallback) branch on error.
 */
export async function retrieveContext(
  opts: RetrieveContextOptions,
): Promise<RoutingResult> {
  const rawLimit = opts.rawLimit ?? 10;

  try {
    // Dimension 2: verbatim-fidelity keyword fast-path (overrides recency)
    if (hasVerbatimKeyword(opts.query)) {
      const raw = await hybridSearch(opts.query, { limit: rawLimit });
      logger.info(
        {
          reason: 'verbatim-keyword',
          rawCount: raw.length,
          hasQueryDate: opts.queryDate != null,
        },
        'pensieve.routing.decision',
      );
      return { raw, summary: null, reason: 'verbatim-keyword' };
    }

    // Dimension 1: recency boundary
    const queryAge = computeQueryAgeDays(opts.queryDate);
    if (queryAge == null || queryAge <= RECENCY_BOUNDARY_DAYS) {
      const raw = await hybridSearch(opts.query, { limit: rawLimit });
      logger.info(
        {
          reason: 'recent',
          queryAge,
          rawCount: raw.length,
          hasQueryDate: opts.queryDate != null,
        },
        'pensieve.routing.decision',
      );
      return { raw, summary: null, reason: 'recent' };
    }

    // Old + non-verbatim: try summary first
    const summary = await getEpisodicSummary(opts.queryDate!);

    if (summary == null) {
      // No summary exists for that date — fall back to raw
      const raw = await hybridSearch(opts.query, { limit: rawLimit });
      logger.info(
        {
          reason: 'no-summary-fallback',
          queryAge,
          rawCount: raw.length,
        },
        'pensieve.routing.decision',
      );
      return { raw, summary: null, reason: 'no-summary-fallback' };
    }

    // RETR-03: high-importance raw descent
    if (summary.importance >= HIGH_IMPORTANCE_THRESHOLD) {
      const raw = await loadEntriesByIds(summary.sourceEntryIds);
      logger.info(
        {
          reason: 'high-importance-descent',
          queryAge,
          importance: summary.importance,
          rawCount: raw.length,
        },
        'pensieve.routing.decision',
      );
      return { raw, summary, reason: 'high-importance-descent' };
    }

    // Default old-query path: summary only, no raw
    logger.info(
      {
        reason: 'summary-only',
        queryAge,
        importance: summary.importance,
        rawCount: 0,
      },
      'pensieve.routing.decision',
    );
    return { raw: [], summary, reason: 'summary-only' };
  } catch (error) {
    logger.warn(
      {
        query: opts.query.slice(0, 50),
        error: error instanceof Error ? error.message : String(error),
      },
      'pensieve.routing.error',
    );
    // Fallback: return raw via hybridSearch, mark as 'recent'
    try {
      const raw = await hybridSearch(opts.query, { limit: rawLimit });
      return { raw, summary: null, reason: 'recent' };
    } catch {
      return { raw: [], summary: null, reason: 'recent' };
    }
  }
}
