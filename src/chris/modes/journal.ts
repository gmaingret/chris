import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import { storePensieveEntry } from '../../pensieve/store.js';
import { tagEntry } from '../../pensieve/tagger.js';
import { embedAndStore } from '../../pensieve/embeddings.js';
import { buildMessageHistory } from '../../memory/context-builder.js';
import { buildSystemPrompt, type DeclinedTopic } from '../personality.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

/**
 * Handle a journal-mode message: store the entry, fire async tag+embed,
 * call Sonnet with conversation history, and return the response.
 *
 * Throws LLMError on Sonnet failure — the engine layer handles it.
 */
export async function handleJournal(
  chatId: bigint,
  text: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): Promise<string> {
  const start = Date.now();

  // Store verbatim entry
  const entry = await storePensieveEntry(text, 'telegram', {
    telegramChatId: Number(chatId),
  });

  // Fire-and-forget: tag and embed (both have never-throw contracts)
  void tagEntry(entry.id, text);
  void embedAndStore(entry.id, text);

  // Build conversation context
  const history = await buildMessageHistory(chatId);

  // Call Sonnet with full conversation context + current message
  try {
    const response = await anthropic.messages.create({
      cache_control: { type: 'ephemeral' },
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: buildSystemPrompt('JOURNAL', undefined, undefined, language, declinedTopics),
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
      { entryId: entry.id, chatId: chatId.toString(), latencyMs },
      'chris.journal.response',
    );

    return responseText;
  } catch (error) {
    if (error instanceof LLMError) throw error;

    logger.warn(
      {
        chatId: chatId.toString(),
        error: error instanceof Error ? error.message : String(error),
      },
      'chris.journal.error',
    );

    throw new LLMError(
      'Failed to generate journal response',
      error,
    );
  }
}
