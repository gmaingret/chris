import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import { REFLECT_SEARCH_OPTIONS } from '../../pensieve/retrieve.js';
import { retrieveContext, summaryToSearchResult } from '../../pensieve/routing.js';
import { extractQueryDate } from './date-extraction.js';
import {
  buildPensieveContext,
  buildRelationalContext,
  buildMessageHistory,
} from '../../memory/context-builder.js';
import { getRelationalMemories } from '../../memory/relational.js';
import { buildSystemPrompt, type DeclinedTopic } from '../personality.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Handle a reflect-mode message: search the Pensieve using hybrid search
 * (temporal weighting via REFLECT_SEARCH_OPTIONS), fetch relational memory
 * observations, build combined context, and call Sonnet to synthesize
 * patterns and themes.
 *
 * Key contract: does NOT store the question as a Pensieve entry — questions
 * are queries, not memories. Conversation history saving is handled by the
 * engine layer.
 *
 * Throws LLMError on Sonnet failure — the engine layer handles it.
 */
export async function handleReflect(
  chatId: bigint,
  text: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): Promise<string> {
  const start = Date.now();

  // Phase 22.1 RETR-02/03: route through retrieveContext so old-dated queries
  // escalate to the episodic-summary tier; REFLECT_SEARCH_OPTIONS round-trip
  // through hybridOptions to preserve temporal weighting on raw branches.
  const queryDate = await extractQueryDate(text, language);
  const routing = await retrieveContext({
    query: text,
    queryDate,
    rawLimit: REFLECT_SEARCH_OPTIONS.limit,
    hybridOptions: REFLECT_SEARCH_OPTIONS,
  });
  const searchResults = routing.summary != null
    ? [summaryToSearchResult(routing.summary), ...routing.raw]
    : routing.raw;
  logger.info(
    {
      chatId: chatId.toString(),
      reason: routing.reason,
      hasSummary: routing.summary != null,
      rawCount: routing.raw.length,
    },
    'chris.reflect.routing',
  );

  // Build formatted Pensieve context with citations
  const pensieveContext = buildPensieveContext(searchResults);
  const resultCount = searchResults.length;

  if (resultCount === 0) {
    logger.info(
      { chatId: chatId.toString(), query: text.slice(0, 50) },
      'chris.reflect.empty',
    );
  }

  // Fetch relational memory observations for deeper synthesis
  const relationalMemories = await getRelationalMemories({ limit: 20 });
  const relationalContext = buildRelationalContext(relationalMemories);
  const relationalCount = relationalMemories.length;

  // Build conversation history and system prompt with both contexts
  const history = await buildMessageHistory(chatId);
  const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, { language, declinedTopics });

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
        relationalCount,
        latencyMs,
      },
      'chris.reflect.response',
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
      'chris.reflect.error',
    );

    throw new LLMError('Failed to generate reflect response', error);
  }
}
