import { anthropic, OPUS_MODEL } from '../../llm/client.js';
import { hybridSearch, PSYCHOLOGY_SEARCH_OPTIONS } from '../../pensieve/retrieve.js';
import {
  buildPensieveContext,
  buildRelationalContext,
  buildMessageHistory,
} from '../../memory/context-builder.js';
import { getRelationalMemories } from '../../memory/relational.js';
import { buildSystemPrompt } from '../personality.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Handle a psychology-mode message: search the Pensieve using hybrid search
 * (emotion/fear/belief/dream weighting via PSYCHOLOGY_SEARCH_OPTIONS), fetch
 * relational memory observations, build combined context, and call Opus
 * to deliver depth-psychology-grounded analysis citing real data.
 *
 * Key contract: does NOT store the question as a Pensieve entry — questions
 * are queries, not memories. Conversation history saving is handled by the
 * engine layer.
 *
 * Throws LLMError on Opus failure — the engine layer handles it.
 */
export async function handlePsychology(
  chatId: bigint,
  text: string,
): Promise<string> {
  const start = Date.now();

  // Hybrid search with emotion/fear/belief/dream weighting for psychology context
  const searchResults = await hybridSearch(text, PSYCHOLOGY_SEARCH_OPTIONS);

  // Build formatted Pensieve context with citations
  const pensieveContext = buildPensieveContext(searchResults);
  const resultCount = pensieveContext === '' ? 0 : pensieveContext.split('\n').length;

  if (resultCount === 0) {
    logger.info(
      { chatId: chatId.toString(), query: text.slice(0, 50) },
      'chris.psychology.empty',
    );
  }

  // Fetch relational memory observations for grounded analysis
  const relationalMemories = await getRelationalMemories({ limit: 20 });
  const relationalContext = buildRelationalContext(relationalMemories);
  const relationalCount = relationalMemories.length;

  // Build conversation history and system prompt with both contexts
  const history = await buildMessageHistory(chatId);
  const systemPrompt = buildSystemPrompt('PSYCHOLOGY', pensieveContext, relationalContext);

  try {
    const response = await anthropic.messages.create({
      model: OPUS_MODEL,
      max_tokens: 2500,
      system: systemPrompt,
      messages: [...history, { role: 'user', content: text }],
    });

    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') {
      throw new LLMError('No text block in Opus response');
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
      'chris.psychology.response',
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
      'chris.psychology.error',
    );

    throw new LLMError('Failed to generate psychology response', error);
  }
}
