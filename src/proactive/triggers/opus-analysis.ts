/**
 * Opus-powered analysis for pattern recurrence and unresolved thread detection.
 *
 * A single Opus call evaluates both concerns, halving API cost compared to
 * separate calls. Returns structured JSON with confidence scores for each.
 *
 * Observability: Logs token usage on success (`proactive.sweep.opus_usage`),
 * logs errors on failure with latency. Returns safe defaults on any error
 * so no trigger fires accidentally.
 */

import { anthropic, OPUS_MODEL } from '../../llm/client.js';
import { logger } from '../../utils/logger.js';

// ── Types ───────────────────────────────────────────────────────────────────

interface AnalysisSection {
  detected: boolean;
  description: string;
  evidence: string[];
  confidence: number;
}

export interface OpusAnalysisResult {
  pattern: AnalysisSection;
  thread: AnalysisSection;
}

// ── Constants ───────────────────────────────────────────────────────────────

const SAFE_DEFAULT: OpusAnalysisResult = {
  pattern: { detected: false, description: '', evidence: [], confidence: 0 },
  thread: { detected: false, description: '', evidence: [], confidence: 0 },
};

const OPUS_SYSTEM_PROMPT = `You are an analytical assistant reviewing relational context about a friendship between Chris and John.

Your task: analyze the provided relational memory, pensieve entries, and conversation data for two things:
1. **Recurring patterns** — themes, behaviors, or dynamics that appear multiple times across the evidence.
2. **Unresolved threads** — topics, questions, or commitments that were raised but never followed up on or closed.

CRITICAL RULES:
- ONLY report findings that are directly grounded in the provided evidence. Do NOT infer, speculate, or hallucinate patterns that aren't clearly supported by multiple data points.
- Every finding MUST cite specific evidence from the context. If you cannot point to concrete evidence, mark detected as false.
- Confidence scores must reflect the strength of evidence: 0.0 = no evidence, 0.5 = some evidence but uncertain, 1.0 = strong repeated evidence.
- When in doubt, mark detected as false. False negatives are safe; false positives erode trust.

Respond with ONLY a JSON object (no markdown, no explanation) in this exact shape:
{
  "pattern": {
    "detected": boolean,
    "description": "one-sentence summary of the pattern, or empty string if not detected",
    "evidence": ["quote or reference from context", ...],
    "confidence": number between 0 and 1
  },
  "thread": {
    "detected": boolean,
    "description": "one-sentence summary of the unresolved thread, or empty string if not detected",
    "evidence": ["quote or reference from context", ...],
    "confidence": number between 0 and 1
  }
}`;

// ── Analysis function ───────────────────────────────────────────────────────

/**
 * Run a single Opus analysis call that evaluates both pattern recurrence
 * and unresolved threads from the provided sweep context.
 *
 * Returns safe defaults (nothing detected) on any API or parse error.
 */
export async function runOpusAnalysis(
  context: string,
): Promise<OpusAnalysisResult> {
  const start = Date.now();

  try {
    const response = await anthropic.messages.create({
      cache_control: { type: 'ephemeral' },
      model: OPUS_MODEL,
      max_tokens: 512,
      system: OPUS_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: context }],
    });

    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn('proactive.sweep.opus_no_text_block');
      return SAFE_DEFAULT;
    }

    // K003: Strip markdown fences before parsing
    let jsonText = (textBlock as { type: 'text'; text: string }).text.trim();
    const fenceMatch = jsonText.match(
      /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/,
    );
    if (fenceMatch) jsonText = fenceMatch[1]!.trim();

    const parsed: OpusAnalysisResult = JSON.parse(jsonText);

    const latencyMs = Date.now() - start;
    logger.info(
      {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        model: OPUS_MODEL,
        latencyMs,
      },
      'proactive.sweep.opus_usage',
    );

    return parsed;
  } catch (error) {
    const latencyMs = Date.now() - start;
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
      },
      'proactive.sweep.opus_error',
    );
    return SAFE_DEFAULT;
  }
}
