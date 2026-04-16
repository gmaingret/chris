/**
 * Phase 17 STAT-02 — 2-axis reasoning classifier.
 *
 * classifyAccuracy: Haiku-based classification of prediction reasoning quality.
 *
 * Given a known outcome and Greg's resolution account, classifies whether the
 * original reasoning was sound, lucky, or flawed.
 *
 * Fail-closed to 'unknown' on any parse failure, timeout, or exception (D-04, T-17-01-01, T-17-01-02).
 * User text goes only into messages[].content — never into system prompt (T-17-01-03).
 */

import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type ReasoningClass = 'sound' | 'lucky' | 'flawed' | 'unknown';

const VALID_REASONING = new Set<ReasoningClass>(['sound', 'lucky', 'flawed']);

// ── Constants ──────────────────────────────────────────────────────────────

const ACCURACY_CLASSIFY_TIMEOUT_MS = 5000;

const SYSTEM_PROMPT =
  'Given the outcome of a prediction and Greg\'s resolution account, classify the quality of the original reasoning. ' +
  'Respond with ONLY valid JSON: {"reasoning": "sound" | "lucky" | "flawed"}. ' +
  'sound = the reasoning process was sound regardless of outcome. ' +
  'lucky = the outcome was correct but for wrong reasons. ' +
  'flawed = the reasoning process was demonstrably poor.';

// ── classifyAccuracy ───────────────────────────────────────────────────────

/**
 * Classify the reasoning quality of a resolved prediction via Haiku.
 *
 * Returns one of: 'sound' | 'lucky' | 'flawed' | 'unknown'.
 * Fail-closed to 'unknown' on any timeout, parse error, invalid value, or exception (D-04).
 *
 * @param outcome - The known outcome of the prediction (e.g. 'hit', 'miss', 'ambiguous')
 * @param resolutionText - Greg's account of what happened (goes only into messages[].content)
 * @param prediction - The original prediction text
 */
export async function classifyAccuracy(
  outcome: string,
  resolutionText: string,
  prediction: string,
): Promise<ReasoningClass> {
  const start = Date.now();

  const userMessage =
    `Outcome: ${outcome}\nOriginal prediction: ${prediction}\nGreg's account: ${resolutionText}`;

  try {
    const raw = await Promise.race([
      anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 30,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
      }),
      new Promise<null>((r) => setTimeout(() => r(null), ACCURACY_CLASSIFY_TIMEOUT_MS)),
    ]);

    if (raw === null) {
      logger.warn({ latencyMs: Date.now() - start }, 'accuracy.classify.timeout');
      return 'unknown';
    }

    const textBlock = raw.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn({ latencyMs: Date.now() - start }, 'accuracy.classify.no-text-block');
      return 'unknown';
    }

    const cleaned = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logger.warn({ latencyMs: Date.now() - start }, 'accuracy.classify.parse-error');
      return 'unknown';
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('reasoning' in parsed)
    ) {
      logger.warn({ latencyMs: Date.now() - start }, 'accuracy.classify.missing-field');
      return 'unknown';
    }

    const reasoning = (parsed as Record<string, unknown>)['reasoning'];
    if (typeof reasoning !== 'string' || !VALID_REASONING.has(reasoning as ReasoningClass)) {
      logger.warn({ reasoning, latencyMs: Date.now() - start }, 'accuracy.classify.invalid-value');
      return 'unknown';
    }

    logger.info({ reasoning, latencyMs: Date.now() - start }, 'accuracy.classify');
    return reasoning as ReasoningClass;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - start },
      'accuracy.classify.error',
    );
    return 'unknown';  // D-04 fail-closed
  }
}
