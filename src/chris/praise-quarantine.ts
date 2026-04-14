import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { logger } from '../utils/logger.js';
import type { ChrisMode } from './engine.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function stripFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return match ? match[1]!.trim() : text.trim();
}

// ── Prompt ─────────────────────────────────────────────────────────────────

const PRAISE_QUARANTINE_PROMPT = `You are a response editor. Your only job is to detect and remove reflexive flattery from the opening of a response.

Reflexive flattery means vacuous openers like:
- "Great question!"
- "That's a really insightful observation"
- "What a thoughtful point"
- "I love that you're thinking about this"
- "That's so important that you're exploring this"

Rules:
- Look only at the FIRST 1-2 sentences.
- If the response opens with reflexive flattery, rewrite that opening to remove it while preserving the rest of the response exactly.
- Do NOT change anything after the opening.
- If no reflexive flattery is found, return the original response unchanged.
- Mid-response positive language ("that's worth exploring further") is NOT flattery — leave it alone.

Respond with JSON only:
{ "flattery_detected": boolean, "rewritten": string }`;

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
  // Mode bypass — COACH and PSYCHOLOGY handle flattery in their own prompts
  if (mode === 'COACH' || mode === 'PSYCHOLOGY') {
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
    return parsed.rewritten && parsed.rewritten.trim().length > 0 ? parsed.rewritten : response;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'chris.praise_quarantine.error',
    );
    return response;
  }
}
