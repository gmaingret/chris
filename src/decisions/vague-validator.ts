/**
 * Phase 14 CAP-02 — Vague-prediction validator (D-13/D-14/D-15).
 *
 * Hedge-word-primed Haiku judgment on (prediction, falsification_criterion).
 * Fail-soft default: 'acceptable' (anti-interrogation ethos — don't pushback on error).
 * 15s hard timeout.
 */

import { callLLM } from '../llm/client.js';
import { VAGUE_VALIDATOR_PROMPT } from '../llm/prompts.js';
import { logger } from '../utils/logger.js';
import { stripFences } from '../utils/text.js';

const VAGUE_TIMEOUT_MS = 3000;

export type VaguenessVerdict = 'acceptable' | 'vague';

export interface VaguenessResult {
  verdict: VaguenessVerdict;
  reason?: string;
}

export const HEDGE_WORDS = [
  'probably', 'fine', 'better', 'somehow', 'likely', 'maybe',
  'peut-être', 'peut etre', 'sans doute', 'probablement',
  'наверное', 'возможно', 'скорее всего',
] as const;

export interface VaguenessInput {
  prediction: string;
  falsification_criterion: string;
  language?: 'en' | 'fr' | 'ru';
}

/**
 * Validate whether a (prediction, falsification_criterion) pair is concretely
 * falsifiable. Calls Haiku with hedge-word seeding (D-13).
 *
 * Fail-soft: returns { verdict: 'acceptable' } on timeout, parse error, or exception.
 */
export async function validateVagueness(input: VaguenessInput): Promise<VaguenessResult> {
  const start = Date.now();
  const combined = `${input.prediction}\n${input.falsification_criterion}`.toLowerCase();
  const detectedHedges = HEDGE_WORDS.filter((w) => combined.includes(w));
  const userContent = JSON.stringify({
    prediction: input.prediction,
    falsification_criterion: input.falsification_criterion,
    language: input.language ?? 'en',
    hedge_words_present: detectedHedges,
  });
  try {
    const raw = await Promise.race([
      callLLM(VAGUE_VALIDATOR_PROMPT, userContent, 200),
      new Promise<null>((r) => setTimeout(() => r(null), VAGUE_TIMEOUT_MS)),
    ]);
    if (!raw) return { verdict: 'acceptable' };  // fail-soft: timeout
    const parsed = parseJsonLoose(raw);
    const verdict: VaguenessVerdict = parsed.verdict === 'vague' ? 'vague' : 'acceptable';
    const reason: string | undefined = typeof parsed.reason === 'string' ? parsed.reason : undefined;
    logger.info({ verdict, hedges: detectedHedges.length, latencyMs: Date.now() - start }, 'decisions.vague.validate');
    return { verdict, reason };
  } catch (error) {
    // Phase 18 WR-04: parse failure is the fail-soft path — log at warn (not info)
    // so dashboards and grep can surface silent 'acceptable' defaults caused by
    // malformed Haiku output (missing fences, stray prose around JSON, etc.).
    logger.warn({ error: errMsg(error), latencyMs: Date.now() - start }, 'decisions.vague.error');
    return { verdict: 'acceptable' };  // fail-soft: exception
  }
}

export function buildVaguePushback(language: 'en' | 'fr' | 'ru'): string {
  switch (language) {
    case 'en': return 'What would make you say this turned out right or wrong?';
    case 'fr': return 'Qu\'est-ce qui te ferait dire que ça s\'est bien ou mal passé ?';
    case 'ru': return 'Что заставит тебя сказать, что это получилось или не получилось?';
  }
}

function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

/**
 * Parse JSON from a Haiku response tolerantly.
 *
 * Strategy (Phase 18 WR-04 hardening):
 *   1. Strip markdown code fences via the shared `stripFences` util (handles
 *      ```json ... ``` and ``` ... ``` patterns — consolidated in Phase 14 WR-07).
 *   2. If parse still fails, fall back to extracting the first `{...}` span.
 *      Guards against Haiku prepending/appending stray prose without fences
 *      (e.g., "Sure, here it is: {...} Hope that helps.").
 *
 * Throws if neither strategy yields valid JSON — caller's try/catch is the
 * fail-soft boundary (returns verdict:'acceptable' with a warn log).
 */
function parseJsonLoose(raw: string): { verdict?: unknown; reason?: unknown } {
  const cleaned = stripFences(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const braceMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!braceMatch) throw new Error('no JSON object found in Haiku response');
    return JSON.parse(braceMatch[0]);
  }
}
