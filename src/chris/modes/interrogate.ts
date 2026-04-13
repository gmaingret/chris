import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import { searchPensieve } from '../../pensieve/retrieve.js';
import { buildPensieveContext, buildMessageHistory } from '../../memory/context-builder.js';
import { buildSystemPrompt, type DeclinedTopic } from '../personality.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Handle an interrogate-mode message: search the Pensieve for relevant entries,
 * build a citation context, and call Sonnet to answer using only those entries.
 *
 * Key contract: does NOT store the question as a Pensieve entry — questions
 * are queries, not memories. Conversation history saving is handled by the
 * engine layer.
 *
 * Throws LLMError on Sonnet failure — the engine layer handles it.
 */
export async function handleInterrogate(
  chatId: bigint,
  text: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): Promise<string> {
  const start = Date.now();

  // Search Pensieve for relevant entries (never throws — returns [] on error)
  const searchResults = await searchPensieve(text, 10);

  // Build formatted context with citations, filtering low-similarity results
  const pensieveContext = buildPensieveContext(searchResults);
  const resultCount = pensieveContext === '' ? 0 : pensieveContext.split('\n').length;

  if (resultCount === 0) {
    logger.info(
      { chatId: chatId.toString(), query: text.slice(0, 50) },
      'chris.interrogate.empty',
    );
  }

  // Build conversation history and system prompt
  const history = await buildMessageHistory(chatId);
  const systemPrompt = buildSystemPrompt('INTERROGATE', pensieveContext, undefined, language, declinedTopics);

  try {
    const response = await anthropic.messages.create({
      cache_control: { type: 'ephemeral' },
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [...history, { role: 'user', content: text }],
    });

    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') {
      throw new LLMError('No text block in Sonnet response');
    }

    const responseText = (textBlock as { type: 'text'; text: string }).text;
    const latencyMs = Date.now() - start;

    logger.info(
      {
        chatId: chatId.toString(),
        resultCount,
        latencyMs,
      },
      'chris.interrogate.response',
    );

    return responseText;
  } catch (error) {
    if (error instanceof LLMError) throw error;

    const latencyMs = Date.now() - start;
    logger.warn(
      {
        chatId: chatId.toString(),
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
      },
      'chris.interrogate.error',
    );

    throw new LLMError('Failed to generate interrogate response', error);
  }
}
