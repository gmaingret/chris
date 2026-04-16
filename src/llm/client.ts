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
 * Returns the first text block content as a string, or empty string on failure.
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
