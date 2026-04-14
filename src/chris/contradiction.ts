import { eq, and, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { contradictions, pensieveEntries } from '../db/schema.js';
import { hybridSearch, CONTRADICTION_SEARCH_OPTIONS } from '../pensieve/retrieve.js';
import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { CONTRADICTION_DETECTION_PROMPT } from '../llm/prompts.js';
import { logger } from '../utils/logger.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Minimum confidence to treat a Haiku result as a genuine contradiction. */
export const CONFIDENCE_THRESHOLD = 0.75;

/** Minimum text length to bother running contradiction detection. */
const MIN_TEXT_LENGTH = 10;

/** Maximum candidate entries to send to Haiku (top N by search score). */
const MAX_CANDIDATES = 8;

// ── Types ──────────────────────────────────────────────────────────────────

export type DetectedContradiction = {
  entryId: string;
  entryDate: Date;
  entryContent: string;
  description: string;
  confidence: number;
};

type HaikuContradictionResult = {
  contradictions: Array<{
    entryIndex: number;
    description: string;
    confidence: number;
  }>;
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Strip markdown code fences from LLM output before parsing.
 * Handles ```json ... ``` and ``` ... ``` patterns (K003).
 */
function stripFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return match ? match[1]!.trim() : text.trim();
}

// ── Core Detection ─────────────────────────────────────────────────────────

/**
 * Detect contradictions between a new text and existing Pensieve entries.
 *
 * Pipeline: gate → hybridSearch → format → Haiku → parse → threshold → dedup → store → return.
 *
 * Never-throw contract: all errors are logged at warn level and swallowed.
 * Returns an empty array on any failure.
 */
export async function detectContradictions(
  text: string,
  entryId?: string,
): Promise<DetectedContradiction[]> {
  const start = Date.now();

  try {
    // Gate: skip trivial messages
    if (text.length < MIN_TEXT_LENGTH) {
      logger.debug(
        { reason: 'message_too_short', length: text.length },
        'contradiction.detect.skip',
      );
      return [];
    }

    // ── Search phase ───────────────────────────────────────────────────
    const searchResults = await hybridSearch(text, CONTRADICTION_SEARCH_OPTIONS);

    if (searchResults.length === 0) {
      logger.debug(
        { reason: 'no_candidates' },
        'contradiction.detect.skip',
      );
      return [];
    }

    // Take top N candidates by score, exclude the current entry if provided
    const candidates = searchResults
      .filter((r) => !entryId || r.entry.id !== entryId)
      .slice(0, MAX_CANDIDATES);

    if (candidates.length === 0) {
      logger.debug(
        { reason: 'no_candidates_after_filter' },
        'contradiction.detect.skip',
      );
      return [];
    }

    // Format numbered list for the prompt
    const candidateEntries = candidates
      .map((r, i) => {
        const date = r.entry.createdAt
          ? new Date(r.entry.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })
          : 'Unknown date';
        return `${i + 1}. [${date}] ${r.entry.content}`;
      })
      .join('\n');

    // ── LLM phase ──────────────────────────────────────────────────────
    const prompt = CONTRADICTION_DETECTION_PROMPT
      .replace('{newText}', text)
      .replace('{candidateEntries}', candidateEntries);

    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 500,
      system: [
        {
          type: 'text',
          text: prompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content: 'Analyze the new statement against the past entries and identify any genuine contradictions.',
        },
      ],
    });

    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn(
        { phase: 'llm', error: 'No text block in Haiku response' },
        'contradiction.detect.error',
      );
      return [];
    }

    // ── Parse phase ────────────────────────────────────────────────────
    const raw = (textBlock as { type: 'text'; text: string }).text;
    const cleaned = stripFences(raw);

    let parsed: HaikuContradictionResult;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logger.warn(
        { phase: 'parse', error: 'Unparseable Haiku response', raw: raw.slice(0, 200) },
        'contradiction.detect.error',
      );
      return [];
    }

    if (!parsed.contradictions || !Array.isArray(parsed.contradictions)) {
      logger.warn(
        { phase: 'parse', error: 'Invalid response structure' },
        'contradiction.detect.error',
      );
      return [];
    }

    // ── Threshold filter ───────────────────────────────────────────────
    const aboveThreshold = parsed.contradictions.filter(
      (c) => typeof c.confidence === 'number' && c.confidence >= CONFIDENCE_THRESHOLD,
    );

    if (aboveThreshold.length === 0) {
      const latencyMs = Date.now() - start;
      logger.info(
        { detectedCount: 0, latencyMs },
        'contradiction.detect',
      );
      return [];
    }

    // ── Dedup + store phase ────────────────────────────────────────────
    const results: DetectedContradiction[] = [];

    for (const item of aboveThreshold) {
      const candidateIndex = item.entryIndex - 1; // 1-indexed → 0-indexed
      if (candidateIndex < 0 || candidateIndex >= candidates.length) {
        continue; // invalid index from Haiku
      }

      const matchedEntry = candidates[candidateIndex]!.entry;

      // Dedup: check if this contradiction pair already exists
      if (entryId) {
        const existing = await db
          .select({ id: contradictions.id })
          .from(contradictions)
          .where(
            or(
              and(
                eq(contradictions.entryAId, entryId),
                eq(contradictions.entryBId, matchedEntry.id),
              ),
              and(
                eq(contradictions.entryAId, matchedEntry.id),
                eq(contradictions.entryBId, entryId),
              ),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          logger.debug(
            { entryAId: entryId, entryBId: matchedEntry.id, reason: 'already_stored' },
            'contradiction.detect.skip',
          );
          continue;
        }
      }

      // Store new contradiction
      if (entryId) {
        await db.insert(contradictions).values({
          entryAId: entryId,
          entryBId: matchedEntry.id,
          description: item.description,
          status: 'DETECTED',
        });
      }

      results.push({
        entryId: matchedEntry.id,
        entryDate: matchedEntry.createdAt ? new Date(matchedEntry.createdAt) : new Date(),
        entryContent: matchedEntry.content,
        description: item.description,
        confidence: item.confidence,
      });
    }

    const latencyMs = Date.now() - start;
    logger.info(
      { detectedCount: results.length, latencyMs },
      'contradiction.detect',
    );

    return results;
  } catch (error) {
    const latencyMs = Date.now() - start;
    logger.warn(
      {
        phase: 'unknown',
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
      },
      'contradiction.detect.error',
    );
    return [];
  }
}

// ── Reader / Resolver ──────────────────────────────────────────────────────

export type UnresolvedContradiction = {
  id: string;
  entryAId: string | null;
  entryBId: string | null;
  entryAContent: string | null;
  entryADate: Date | null;
  entryBContent: string | null;
  entryBDate: Date | null;
  description: string;
  detectedAt: Date | null;
};

/**
 * Get all unresolved contradictions (status = DETECTED) with entry content.
 */
export async function getUnresolvedContradictions(): Promise<UnresolvedContradiction[]> {
  const entryA = db.$with('entry_a').as(
    db.select({
      id: pensieveEntries.id,
      content: pensieveEntries.content,
      createdAt: pensieveEntries.createdAt,
    }).from(pensieveEntries),
  );

  // Use a raw join approach since Drizzle self-joins with CTEs are complex
  const rows = await db
    .select({
      id: contradictions.id,
      entryAId: contradictions.entryAId,
      entryBId: contradictions.entryBId,
      description: contradictions.description,
      detectedAt: contradictions.detectedAt,
    })
    .from(contradictions)
    .where(eq(contradictions.status, 'DETECTED'));

  // Batch-fetch entry content for all referenced entries
  const entryIds = new Set<string>();
  for (const row of rows) {
    if (row.entryAId) entryIds.add(row.entryAId);
    if (row.entryBId) entryIds.add(row.entryBId);
  }

  const entryMap = new Map<string, { content: string; createdAt: Date | null }>();
  if (entryIds.size > 0) {
    const { inArray } = await import('drizzle-orm');
    const entries = await db
      .select({
        id: pensieveEntries.id,
        content: pensieveEntries.content,
        createdAt: pensieveEntries.createdAt,
      })
      .from(pensieveEntries)
      .where(inArray(pensieveEntries.id, [...entryIds]));

    for (const e of entries) {
      entryMap.set(e.id, { content: e.content, createdAt: e.createdAt });
    }
  }

  return rows.map((row) => {
    const a = row.entryAId ? entryMap.get(row.entryAId) : undefined;
    const b = row.entryBId ? entryMap.get(row.entryBId) : undefined;
    return {
      id: row.id,
      entryAId: row.entryAId,
      entryBId: row.entryBId,
      entryAContent: a?.content ?? null,
      entryADate: a?.createdAt ?? null,
      entryBContent: b?.content ?? null,
      entryBDate: b?.createdAt ?? null,
      description: row.description,
      detectedAt: row.detectedAt,
    };
  });
}

/**
 * Resolve or accept a contradiction by updating its status, resolution text, and timestamp.
 */
export async function resolveContradiction(
  id: string,
  resolution: string,
  status: 'RESOLVED' | 'ACCEPTED' = 'RESOLVED',
): Promise<void> {
  await db
    .update(contradictions)
    .set({
      status,
      resolution,
      resolvedAt: new Date(),
    })
    .where(eq(contradictions.id, id));
}
