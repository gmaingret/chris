import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import { hybridSearch, PRODUCE_SEARCH_OPTIONS } from '../../pensieve/retrieve.js';
import {
  buildPensieveContext,
  buildMessageHistory,
} from '../../memory/context-builder.js';
import { buildSystemPrompt, type DeclinedTopic } from '../personality.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Handle a produce-mode message: search the Pensieve using hybrid search
 * (PRODUCE_SEARCH_OPTIONS weighting), build grounded context, and call Sonnet
 * to collaborate on decisions, brainstorms, and concrete planning.
 *
 * Key differences from coach handler:
 * - Uses SONNET_MODEL (not Opus) with max_tokens 1500 (not 2000)
 * - No relational memory — only Pensieve context
 * - Uses PRODUCE_SEARCH_OPTIONS for search weighting
 *
 * Does NOT store the question as a Pensieve entry — questions are queries,
 * not memories. Conversation history saving is handled by the engine layer.
 *
 * Throws LLMError on Sonnet failure — the engine layer handles it.
 */
export async function handleProduce(
  chatId: bigint,
  text: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): Promise<string> {
  const start = Date.now();

  // Hybrid search with produce-mode weighting for collaborative context
  const searchResults = await hybridSearch(text, PRODUCE_SEARCH_OPTIONS);

  // Build formatted Pensieve context with citations
  const pensieveContext = buildPensieveContext(searchResults);
  const resultCount = searchResults.length;

  if (resultCount === 0) {
    logger.info(
      { chatId: chatId.toString(), query: text.slice(0, 50) },
      'chris.produce.empty',
    );
  }

  // Build conversation history and system prompt with Pensieve context only (no relational)
  const history = await buildMessageHistory(chatId);
  const systemPrompt = buildSystemPrompt('PRODUCE', pensieveContext, undefined, language, declinedTopics);

  try {
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1500,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
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
      'chris.produce.response',
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
      'chris.produce.error',
    );

    throw new LLMError('Failed to generate produce response', error);
  }
}
