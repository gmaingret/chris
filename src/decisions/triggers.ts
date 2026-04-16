/**
 * Phase 14 CAP-01 — Two-phase decision trigger detection.
 *
 * Phase A: Bilingual regex (EN/FR/RU) with negative-lookahead meta-guards.
 * Phase B: Haiku stakes classifier with 3s timeout, fail-closed to 'trivial'.
 *
 * Only `structural` tier activates downstream capture (D-06).
 */

import { callLLM } from '../llm/client.js';
import { STAKES_CLASSIFICATION_PROMPT } from '../llm/prompts.js';
import { stripFences } from '../utils/text.js';
import { logger } from '../utils/logger.js';
import {
  EN_POSITIVES,
  FR_POSITIVES,
  RU_POSITIVES,
} from './triggers-fixtures.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type StakesTier = 'trivial' | 'moderate' | 'structural';

export interface TriggerMatch {
  trigger_phrase: string;
  language: 'en' | 'fr' | 'ru';
  topic: string | null;
}

// ── Pattern entries ────────────────────────────────────────────────────────
// Each entry: [regex, topic_capture_group_index, canonical_phrase]
// Negative lookahead guards reject meta-references, negations, past-tense reports.
// Mirrors refusal.ts PatternEntry convention (D-02, D-20).

type TriggerPatternEntry = [RegExp, number | null, string];

const EN_TRIGGER_PATTERNS: TriggerPatternEntry[] = [
  [/^(?!.*\b(?:told|said|mentioned|explained|not|don'?t)\b).*\bi'?m\s+thinking\s+about\s+(.+)/i, 1, "i'm thinking about"],
  [/^(?!.*\b(?:told|said|mentioned|explained|not|don'?t)\b).*\bi\s+need\s+to\s+decide\s+(.+)/i, 1, 'i need to decide'],
  [/^(?!.*\b(?:told|said|mentioned|explained|not|don'?t)\b).*\bi'?m\s+weighing\s+(.+)/i, 1, "i'm weighing"],
  [/^(?!.*\b(?:told|said|mentioned|explained)\b).*\bi'?m\s+not\s+sure\s+whether\s+(.+)/i, 1, "i'm not sure whether"],
];

const FR_TRIGGER_PATTERNS: TriggerPatternEntry[] = [
  [/^(?!.*(?:ai\s+dit|n'?ai\s+pas|m'a\s+dit)).*je\s+r[eé]fl[eé]chis\s+[àa]\s+(.+)/i, 1, 'je réfléchis à'],
  [/^(?!.*(?:ai\s+dit|n'?ai\s+pas|m'a\s+dit)).*je\s+dois\s+d[eé]cider\s+(.+)/i, 1, 'je dois décider'],
  [/^(?!.*(?:ai\s+dit|n'?ai\s+pas|m'a\s+dit|d[eé]j[àa]|plus$)).*j'?h[eé]site\s+(.+)/i, 1, "j'hésite"],
  [/^(?!.*(?:ai\s+dit|n'?ai\s+pas|m'a\s+dit)).*je\s+dois\s+choisir\s+(.+)/i, 1, 'je dois choisir'],
];

const RU_TRIGGER_PATTERNS: TriggerPatternEntry[] = [
  [/^(?!.*(?:сказал\S*|говорил\S*|(?:^|\s)не\s)).*я\s+думаю\s+о\s+(.+)/i, 1, 'я думаю о'],
  [/^(?!.*(?:сказал\S*|говорил\S*|(?:^|\s)не\s)).*мне\s+нужно\s+решить\s+(.+)/i, 1, 'мне нужно решить'],
  [/^(?!.*(?:сказал\S*|говорил\S*|(?:^|\s)не\s|уже)).*я\s+колеблюсь\s+(.+)/i, 1, 'я колеблюсь'],
  [/^(?!.*(?:сказал\S*|говорил\S*|(?:^|\s)не\s)).*мне\s+нужно\s+выбрать\s+(.+)/i, 1, 'мне нужно выбрать'],
];

// ── D-03 parity assertion (throws at import time) ──────────────────────────

if (
  EN_TRIGGER_PATTERNS.length !== FR_TRIGGER_PATTERNS.length ||
  FR_TRIGGER_PATTERNS.length !== RU_TRIGGER_PATTERNS.length
) {
  throw new Error(
    `triggers.ts: EN/FR/RU trigger pattern arrays must have equal length (D-03)`,
  );
}

// ── Phase A: detectTriggerPhrase ───────────────────────────────────────────

/**
 * Detect whether a user message contains a decision trigger phrase.
 *
 * Checks EN, FR, RU patterns in order; first match wins.
 * Returns the canonical trigger phrase string on match, or null.
 * Negated / meta-reference / past-tense phrasings are rejected by
 * negative lookahead guards (D-02).
 */
export function detectTriggerPhrase(text: string): string | null {
  const languageSets: [TriggerPatternEntry[], 'en' | 'fr' | 'ru'][] = [
    [EN_TRIGGER_PATTERNS, 'en'],
    [FR_TRIGGER_PATTERNS, 'fr'],
    [RU_TRIGGER_PATTERNS, 'ru'],
  ];

  for (const [patterns] of languageSets) {
    for (const [regex, , canonical] of patterns) {
      if (regex.test(text)) {
        return canonical;
      }
    }
  }

  return null;
}

/**
 * Richer version that returns full TriggerMatch with language + topic.
 * Used by downstream capture flow; not exercised by current test suite.
 */
export function detectTriggerPhraseDetailed(text: string): TriggerMatch | null {
  const languageSets: [TriggerPatternEntry[], 'en' | 'fr' | 'ru'][] = [
    [EN_TRIGGER_PATTERNS, 'en'],
    [FR_TRIGGER_PATTERNS, 'fr'],
    [RU_TRIGGER_PATTERNS, 'ru'],
  ];

  for (const [patterns, language] of languageSets) {
    for (const [regex, groupIdx, canonical] of patterns) {
      const match = regex.exec(text);
      if (match) {
        const topic = groupIdx !== null ? match[groupIdx]?.trim() ?? null : null;
        return { trigger_phrase: canonical, language, topic };
      }
    }
  }

  return null;
}

// ── Phase B: classifyStakes ────────────────────────────────────────────────

const STAKES_TIMEOUT_MS = 3000; // D-08
const VALID_TIERS: ReadonlySet<StakesTier> = new Set([
  'trivial',
  'moderate',
  'structural',
]);

/**
 * Classify a triggered message into a stakes tier via Haiku.
 *
 * - 3s hard timeout (D-08).
 * - Fail-closed to 'trivial' on timeout, bad JSON, missing field, or any
 *   exception (D-06).
 * - No caching (D-07): every call hits Haiku (or mock, in tests).
 * - User text goes in messages[0].content, never in system prompt (T-14-02-01).
 * - Logs {tier, latencyMs} on success; {error, latencyMs} on failure.
 *   Never logs raw input text (T-14-02-04).
 */
export async function classifyStakes(text: string): Promise<StakesTier> {
  const start = Date.now();
  try {
    const raw = await Promise.race([
      callLLM(STAKES_CLASSIFICATION_PROMPT, text, 30),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), STAKES_TIMEOUT_MS),
      ),
    ]);

    if (raw === null) {
      logger.warn(
        { latencyMs: Date.now() - start },
        'decisions.stakes.timeout',
      );
      return 'trivial'; // D-06 fail-closed on timeout
    }

    const parsed = JSON.parse(stripFences(raw));
    const tier: StakesTier = VALID_TIERS.has(parsed.tier)
      ? (parsed.tier as StakesTier)
      : 'trivial';

    logger.info(
      { tier, latencyMs: Date.now() - start },
      'decisions.stakes.classify',
    );
    return tier;
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - start,
      },
      'decisions.stakes.error',
    );
    return 'trivial'; // D-06 fail-closed on exception
  }
}
