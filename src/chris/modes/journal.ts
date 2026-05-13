import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import { storePensieveEntry } from '../../pensieve/store.js';
import { tagEntry } from '../../pensieve/tagger.js';
import { embedAndStore } from '../../pensieve/embeddings.js';
import { buildPensieveContext, buildMessageHistory } from '../../memory/context-builder.js';
import { JOURNAL_SEARCH_OPTIONS } from '../../pensieve/retrieve.js';
import { retrieveContext, summaryToSearchResult } from '../../pensieve/routing.js';
import { extractQueryDate } from './date-extraction.js';
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
  opts?: { pensieveSource?: string },
): Promise<string> {
  const start = Date.now();

  // Store verbatim entry
  const entry = await storePensieveEntry(text, opts?.pensieveSource ?? 'telegram', {
    telegramChatId: Number(chatId),
  });

  // Fire-and-forget: tag and embed (both have never-throw contracts)
  void tagEntry(entry.id, text);
  void embedAndStore(entry.id, text);

  // Retrieve relevant Pensieve entries for grounding (RETR-01, D-01, D-10).
  // Phase 22.1 RETR-02/03: route through retrieveContext so a >7d-old query
  // escalates to the episodic-summary tier; high-importance summaries surface
  // their source raw entries via descent. Mode-specific JOURNAL_SEARCH_OPTIONS
  // (tags filter + recencyBias + limit) round-trip through hybridOptions.
  const queryDate = await extractQueryDate(text, language);
  const routing = await retrieveContext({
    query: text,
    queryDate,
    rawLimit: JOURNAL_SEARCH_OPTIONS.limit,
    hybridOptions: JOURNAL_SEARCH_OPTIONS,
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
    'chris.journal.routing',
  );
  // Phase 11 / RETR-04: suppress per-entry date prefix in JOURNAL so today's seed-stamp does not leak into "back on April 14th..." fabrications. INTERROGATE keeps dates (citation contract).
  // NOTE (22.1 IN-04): the { includeDate: false } flag only suppresses the
  // builder's (YYYY-MM-DD | tag | score) citation prefix on RAW entries.
  // Synthetic episodic-summary entries (via summaryToSearchResult) carry a
  // date marker INSIDE their content string — that date is the semantically
  // meaningful episode date (the date the user is asking about), not a
  // storage timestamp, and is MEANT to be visible.
  const pensieveContext = buildPensieveContext(searchResults, { includeDate: false });

  // Build conversation context
  const history = await buildMessageHistory(chatId);

  // Call Sonnet with full conversation context + current message
  try {
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: buildSystemPrompt('JOURNAL', pensieveContext, undefined, { language, declinedTopics }),
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
