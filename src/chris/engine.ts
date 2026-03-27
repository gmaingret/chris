import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { MODE_DETECTION_PROMPT } from '../llm/prompts.js';
import { saveMessage } from '../memory/conversation.js';
import { handleJournal } from './modes/journal.js';
import { LLMError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

type ChrisMode = 'JOURNAL' | 'INTERROGATE';

/**
 * Classify a message as JOURNAL or INTERROGATE using Haiku.
 * Defaults to JOURNAL on any failure (parse error, API error, etc.).
 */
export async function detectMode(text: string): Promise<ChrisMode> {
  const start = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 50,
      system: MODE_DETECTION_PROMPT,
      messages: [{ role: 'user', content: text }],
    });

    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn({ error: 'No text block in Haiku response' }, 'chris.mode.detect');
      return 'JOURNAL';
    }

    const parsed = JSON.parse((textBlock as { type: 'text'; text: string }).text.trim());
    const mode: ChrisMode = parsed.mode === 'INTERROGATE' ? 'INTERROGATE' : 'JOURNAL';

    const latencyMs = Date.now() - start;
    logger.info({ mode, latencyMs }, 'chris.mode.detect');

    return mode;
  } catch (error) {
    const latencyMs = Date.now() - start;
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
      },
      'chris.mode.detect',
    );
    return 'JOURNAL';
  }
}

/**
 * Process an incoming message through the Chris engine.
 *
 * Flow: save user message → detect mode → route to handler → save assistant response → return.
 */
export async function processMessage(
  chatId: bigint,
  userId: number,
  text: string,
): Promise<string> {
  const start = Date.now();

  try {
    // Detect mode first so we can tag the user message correctly
    const mode = await detectMode(text);

    // Save user message to conversation history
    await saveMessage(chatId, 'USER', text, mode);

    // Route to handler (INTERROGATE falls through to JOURNAL until S05)
    const response = await handleJournal(chatId, text);

    // Save assistant response to conversation history
    await saveMessage(chatId, 'ASSISTANT', response, mode);

    const latencyMs = Date.now() - start;
    logger.info(
      { mode, chatId: chatId.toString(), latencyMs },
      'chris.engine.process',
    );

    return response;
  } catch (error) {
    const latencyMs = Date.now() - start;
    logger.warn(
      {
        chatId: chatId.toString(),
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
      },
      'chris.engine.error',
    );

    throw error instanceof LLMError
      ? error
      : new LLMError('Engine processing failed', error);
  }
}
