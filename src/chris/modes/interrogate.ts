import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import { searchPensieve, getEpisodicSummary } from '../../pensieve/retrieve.js';
import { buildPensieveContext, buildMessageHistory } from '../../memory/context-builder.js';
import { buildSystemPrompt, type DeclinedTopic } from '../personality.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { extractQueryDate } from './date-extraction.js';
import type { episodicSummaries } from '../../db/schema.js';

/**
 * Format an episodic_summaries row as a labeled context block for the
 * INTERROGATE system prompt. The header phrase "interpretation, not fact"
 * is the D031 boundary marker — episodic summaries are interpretation
 * (Sonnet-generated narrative compression) and must be visually distinct
 * from the Known Facts block (which is verbatim ground truth) so the
 * downstream Sonnet call can weight them differently.
 *
 * Block layout intentionally puts the header on line 1 so a future
 * regex audit (or RETR-05/06 boundary scanner) can grep for the literal
 * marker '## Recent Episode Context (interpretation, not fact)' in any
 * assembled prompt without parsing the body.
 */
function formatEpisodicBlock(
  summary: typeof episodicSummaries.$inferSelect,
): string {
  const topics = summary.topics.length > 0 ? summary.topics.join(', ') : 'none';
  return [
    '## Recent Episode Context (interpretation, not fact)',
    `Date: ${summary.summaryDate}`,
    `Importance: ${summary.importance}/10`,
    `Emotional arc: ${summary.emotionalArc}`,
    `Topics: ${topics}`,
    '',
    'Summary:',
    summary.summary,
  ].join('\n');
}

/** RETR-04: queries about dates within this many days use the raw search
 *  path; older queries route through the episodic summary tier first. */
const SUMMARY_INJECTION_AGE_DAYS = 7;

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

  // RETR-04: date-anchored episodic summary injection (Phase 22-03).
  // Extract a date from the query via the regex/keyword fast-path
  // (Haiku fallback only when a date heuristic is present). If the
  // resolved date is older than 7 days AND a summary row exists for
  // that date, prepend a labeled summary block to the pensieveContext
  // string passed to buildSystemPrompt. Recent dates (≤7 days) and
  // missing summary rows fall through silently to the standard
  // semantic-search path.
  const queryDate = await extractQueryDate(text, language);
  let episodicBlock = '';
  if (queryDate) {
    const ageDays = Math.floor(
      (Date.now() - queryDate.getTime()) / 86_400_000,
    );
    // RETR-04 boundary: strict `ageDays > 7` — exactly 7 days remains in
    // the raw-search path; older queries route through the summary tier.
    if (ageDays > SUMMARY_INJECTION_AGE_DAYS /* === 7 */) {
      const summary = await getEpisodicSummary(queryDate);
      if (summary) {
        episodicBlock = formatEpisodicBlock(summary);
        logger.info(
          {
            chatId: chatId.toString(),
            date: summary.summaryDate,
            importance: summary.importance,
          },
          'chris.interrogate.summary.injected',
        );
      }
    }
  }

  // Search Pensieve for relevant entries (never throws — returns [] on error)
  const searchResults = await searchPensieve(text, 10);

  // Build formatted context with citations, filtering low-similarity results.
  // The episodic block is PREPENDED so the date-anchored interpretation
  // appears before the per-entry citations in the final prompt — keeping
  // the D031 boundary visually obvious between interpretation and verbatim
  // citations.
  const pensieveContext = episodicBlock
    ? `${episodicBlock}\n\n${buildPensieveContext(searchResults)}`
    : buildPensieveContext(searchResults);
  const resultCount = searchResults.length;

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
      model: SONNET_MODEL,
      max_tokens: 1024,
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
