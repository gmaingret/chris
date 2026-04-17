import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export const HAIKU_MODEL = config.haikuModel;
export const SONNET_MODEL = config.sonnetModel;
export const OPUS_MODEL = config.opusModel;

export const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey,
});

/**
 * Convenience wrapper: Haiku call with system prompt + user content.
 *
 * Returns the first text block from the response, or `''` if the response has
 * no text block (e.g., tool-use-only response).
 *
 * **Throws** on SDK errors (rate limit, network, 4xx/5xx). Callers that need
 * fail-soft behavior must wrap this call in try/catch — see `validateVagueness`,
 * `classifyStakes`, `parseResolveBy`, and the capture extractor for the
 * established pattern (Promise.race with timeout + try/catch → fail-soft default).
 */
export async function callLLM(
  systemPrompt: string,
  userContent: string,
  maxTokens: number = 100,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: maxTokens,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
  const block = response.content[0];
  return block?.type === 'text' ? block.text : '';
}
