import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

export const HAIKU_MODEL = config.haikuModel;
export const SONNET_MODEL = config.sonnetModel;
export const OPUS_MODEL = config.opusModel;

export const anthropic = new Anthropic({
  apiKey: config.anthropicApiKey,
});

/**
 * Lightweight Haiku wrapper for structured-output classifiers.
 *
 * Sends `systemPrompt` as a cached ephemeral system block and `userText` in
 * the user message slot.  Returns the raw text content from Haiku's response.
 *
 * Callers are responsible for JSON parsing, timeout racing, and error handling.
 */
export async function callLLM(
  systemPrompt: string,
  userText: string,
  maxTokens = 30,
): Promise<string> {
  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: maxTokens,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userText }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text block in Haiku response');
  }
  return (textBlock as { type: 'text'; text: string }).text;
}
