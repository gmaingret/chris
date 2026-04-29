import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { logger } from '../utils/logger.js';
import { stripFences } from '../utils/text.js';
import type { ChrisMode } from './engine.js';

// ── Prompt ─────────────────────────────────────────────────────────────────

const PRAISE_QUARANTINE_PROMPT = `You are a response editor. Your only job is to detect and remove reflexive flattery, soft acknowledgment openers, and reactive warmth from the opening of a response.

Reflexive flattery / soft openers include any response that BEGINS with:
- "Great question!" / "Great point" / "Great…"
- "That's a really insightful observation" / "That's interesting" / "That's a big one" / "That's…" / "That sounds…" / "That…"
- "What a thoughtful point" / "What a…"
- "I love that you're thinking about this" / "I love…"
- "Wow…" / "Amazing…" / "Wonderful…" / "Brilliant…"
- Any opening sentence whose primary function is to react warmly to or characterize what John said, rather than substantively engage with the content.

Rules:
- Look at the FIRST sentence of the response.
- If the first sentence begins with any of the patterns above ("That's...", "That sounds...", "Great...", "Wow...", "Amazing...", "Wonderful...", "What a...", "I love...", "Brilliant..."), set flattery_detected=true and REMOVE that opening sentence entirely. Keep everything after it verbatim.
- If removing the opener leaves the response starting with a continuation word, lightly fix the very first word's capitalization but change nothing else.
- Mid-response positive language ("that's worth exploring further") is NOT flattery — leave it alone.
- If no flattery opener is found, return the original response unchanged.

Respond with JSON only:
{ "flattery_detected": boolean, "rewritten": string }`;

// Reflexive opener tokens — first whitespace-separated word of a response that
// signals soft acknowledgment / vacuous warmth rather than substantive engagement.
// Stripped deterministically as a backstop after the Haiku rewrite.
//
// Exported in Phase 29 Plan 04 (HARD CO-LOC #6) so the live weekly-review
// anti-flattery test can import this set verbatim per D-10 refined (no
// redeclaration; three imports + spread is the locked convention). See
// `src/rituals/__tests__/live-weekly-review.test.ts`.
export const REFLEXIVE_OPENER_FIRST_WORDS = new Set([
  'That', "That's", 'Great', 'Wow', 'Amazing', 'Wonderful', 'Brilliant', 'Beautiful',
  'Oh', 'Aw', 'Aww', 'Lovely', 'Fantastic', 'Awesome', 'Incredible',
]);

// First-two-word reflexive openers ("What a", "I love", "How wonderful").
const REFLEXIVE_OPENER_TWO_WORDS = new Set([
  'What a', 'What an', 'I love', 'I admire', 'How wonderful', 'How great', 'How interesting',
]);

/**
 * Deterministic backstop: if the response opens with a reflexive opener token,
 * drop the first sentence so the substantive reply leads. Catches stochastic
 * misses by the Haiku rewrite. Only touches the leading sentence.
 */
function stripReflexiveOpener(response: string): string {
  const trimmed = response.trimStart();
  if (trimmed.length === 0) return response;
  const tokens = trimmed.split(/\s+/);
  // Strip trailing punctuation so "Wow," still matches "Wow".
  const firstWord = (tokens[0] ?? '').replace(/[,.!?;:]+$/, '');
  const secondWord = (tokens[1] ?? '').replace(/[,.!?;:]+$/, '');
  const firstTwo = secondWord ? `${firstWord} ${secondWord}` : '';
  const opensWithReflexive =
    REFLEXIVE_OPENER_FIRST_WORDS.has(firstWord) ||
    REFLEXIVE_OPENER_TWO_WORDS.has(firstTwo);
  if (!opensWithReflexive) return response;

  // Find end of first sentence — terminator, newline, or end-of-string.
  const sentenceMatch = trimmed.match(/^[^.!?\n]*(?:[.!?\n]+\s*|$)/);
  if (!sentenceMatch || sentenceMatch[0].length === 0) return response;
  const remainder = trimmed.slice(sentenceMatch[0].length).trimStart();
  // If stripping leaves nothing, keep original to avoid empty response.
  if (remainder.length === 0) return response;
  return remainder;
}

// ── Core ───────────────────────────────────────────────────────────────────

/**
 * Post-process a Chris response to strip reflexive opening flattery via Haiku.
 *
 * COACH and PSYCHOLOGY modes are bypassed entirely (D-06, SYCO-05) — those
 * mode prompts already forbid flattery at the prompt level.
 *
 * Never-throw contract: any Haiku failure returns the original response.
 */
export async function quarantinePraise(response: string, mode: ChrisMode): Promise<string> {
  // Mode bypass — COACH and PSYCHOLOGY handle flattery in their own prompts (SYCO-05).
  // Pure pass-through: neutral tokens like "Beautiful" or "Oh" can legitimately open
  // substantive responses in these modes and must not be truncated.
  if (mode === 'COACH' || mode === 'PSYCHOLOGY' || mode === 'ACCOUNTABILITY') {
    return response;
  }

  try {
    const result = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 1500,
      system: PRAISE_QUARANTINE_PROMPT,
      messages: [{ role: 'user', content: response }],
    });

    const textBlock = result.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn({}, 'chris.praise_quarantine.no_text_block');
      return response;
    }

    const cleaned = stripFences((textBlock as { type: 'text'; text: string }).text);

    let parsed: { flattery_detected: boolean; rewritten: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logger.warn(
        { error: 'Unparseable Haiku response' },
        'chris.praise_quarantine.error',
      );
      return response;
    }

    logger.info({ flattery_detected: parsed.flattery_detected, mode }, 'chris.praise_quarantine');
    const afterHaiku = parsed.rewritten && parsed.rewritten.trim().length > 0 ? parsed.rewritten : response;
    return stripReflexiveOpener(afterHaiku);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'chris.praise_quarantine.error',
    );
    return stripReflexiveOpener(response);
  }
}
