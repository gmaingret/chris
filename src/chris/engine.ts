import { anthropic, HAIKU_MODEL } from '../llm/client.js';
import { MODE_DETECTION_PROMPT } from '../llm/prompts.js';
import { saveMessage } from '../memory/conversation.js';
import { handleJournal } from './modes/journal.js';
import { handleInterrogate } from './modes/interrogate.js';
import { handlePhotos } from './modes/photos.js';
import { handleReflect } from './modes/reflect.js';
import { handleCoach } from './modes/coach.js';
import { handlePsychology } from './modes/psychology.js';
import { handleProduce } from './modes/produce.js';
import { writeRelationalMemory } from '../memory/relational.js';
import { detectContradictions } from './contradiction.js';
import { formatContradictionNotice } from './personality.js';
import { quarantinePraise } from './praise-quarantine.js';
import { detectMuteIntent, generateMuteAcknowledgment } from '../proactive/mute.js';
import { setMuteUntil } from '../proactive/state.js';
import { config } from '../config.js';
import { LLMError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export type ChrisMode = 'JOURNAL' | 'INTERROGATE' | 'REFLECT' | 'COACH' | 'PSYCHOLOGY' | 'PRODUCE' | 'PHOTOS';

export const VALID_MODES = new Set<ChrisMode>([
  'JOURNAL', 'INTERROGATE', 'REFLECT', 'COACH', 'PSYCHOLOGY', 'PRODUCE', 'PHOTOS',
]);

/**
 * Strip markdown code fences from LLM output before parsing.
 * Handles ```json ... ``` and ``` ... ``` patterns (K003).
 */
function stripFences(text: string): string {
  const match = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return match ? match[1]!.trim() : text.trim();
}

/**
 * Classify a message into one of 6 Chris modes using Haiku.
 * Defaults to JOURNAL on any failure (parse error, API error, invalid mode).
 */
export async function detectMode(text: string): Promise<ChrisMode> {
  const start = Date.now();
  try {
    const response = await anthropic.messages.create({
      cache_control: { type: 'ephemeral' },
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

    const raw = (textBlock as { type: 'text'; text: string }).text;
    const cleaned = stripFences(raw);
    const parsed = JSON.parse(cleaned);
    const mode: ChrisMode = VALID_MODES.has(parsed.mode) ? parsed.mode : 'JOURNAL';

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
  // Input validation
  if (!text || text.trim().length === 0) {
    throw new LLMError('Empty message text');
  }
  if (text.length > 100_000) {
    throw new LLMError('Message too long (max 100,000 characters)');
  }

  const start = Date.now();

  try {
    // Pre-process: check for mute intent before mode detection (K012)
    const muteResult = await detectMuteIntent(text);
    if (muteResult.muted) {
      await setMuteUntil(muteResult.muteUntil);
      const ack = await generateMuteAcknowledgment(
        muteResult.muteUntil,
        config.proactiveTimezone,
      );
      await saveMessage(chatId, 'USER', text, 'JOURNAL');
      await saveMessage(chatId, 'ASSISTANT', ack, 'JOURNAL');

      logger.info(
        {
          muteUntil: muteResult.muteUntil.toISOString(),
          durationDescription: muteResult.durationDescription,
          chatId: chatId.toString(),
        },
        'chris.mute.set',
      );

      return ack;
    }

    // Detect mode first so we can tag the user message correctly
    const mode = await detectMode(text);

    // Save user message to conversation history (PHOTOS mode may override this below)
    let userMessageSaved = false;
    if (mode !== 'PHOTOS') {
      await saveMessage(chatId, 'USER', text, mode);
      userMessageSaved = true;
    }

    // Route to handler based on detected mode
    let response: string;
    switch (mode) {
      case 'JOURNAL':
        response = await handleJournal(chatId, text);
        break;
      case 'INTERROGATE':
        response = await handleInterrogate(chatId, text);
        break;
      case 'REFLECT':
        response = await handleReflect(chatId, text);
        break;
      case 'COACH':
        response = await handleCoach(chatId, text);
        break;
      case 'PSYCHOLOGY':
        response = await handlePsychology(chatId, text);
        break;
      case 'PRODUCE':
        response = await handleProduce(chatId, text);
        break;
      case 'PHOTOS': {
        const photoResult = await handlePhotos(chatId, text);
        if (photoResult) {
          response = photoResult.response;
          // Enrich the saved user message with photo context so subsequent turns
          // know what Chris saw (images aren't persisted in conversation history)
          await saveMessage(chatId, 'USER', `${text}\n\n${photoResult.photoContext}`, mode);
          userMessageSaved = true;
        } else {
          // No photos found — tell the user naturally instead of falling back to journal
          // which wouldn't know photos were attempted
          await saveMessage(chatId, 'USER', text, 'JOURNAL');
          userMessageSaved = true;
          const noPhotosContext = `${text}\n\n[Note: Chris searched the photo library but found no matching photos for this request.]`;
          response = await handleJournal(chatId, noPhotosContext);
        }
        break;
      }
    }

    // ── Praise quarantine (JOURNAL, REFLECT, PRODUCE only) — SYCO-04 ──
    if (mode === 'JOURNAL' || mode === 'REFLECT' || mode === 'PRODUCE') {
      try {
        const QUARANTINE_TIMEOUT_MS = 3000;
        response = await Promise.race([
          quarantinePraise(response, mode),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve(response), QUARANTINE_TIMEOUT_MS)
          ),
        ]);
      } catch (quarantineError) {
        logger.warn(
          {
            error: quarantineError instanceof Error
              ? quarantineError.message
              : String(quarantineError),
          },
          'chris.engine.praise_quarantine.error',
        );
      }
    }

    // ── Contradiction detection (JOURNAL and PRODUCE only) ─────────────
    if (mode === 'JOURNAL' || mode === 'PRODUCE') {
      try {
        const DETECTION_TIMEOUT_MS = 3000;
        const detected = await Promise.race([
          detectContradictions(text),
          new Promise<never[]>((resolve) => setTimeout(() => resolve([]), DETECTION_TIMEOUT_MS)),
        ]);
        const notice = formatContradictionNotice(detected);
        if (notice) {
          response += notice;
        }
      } catch (detectionError) {
        // Never break the response flow — swallow and log
        logger.warn(
          {
            error: detectionError instanceof Error ? detectionError.message : String(detectionError),
          },
          'chris.engine.contradiction.error',
        );
      }
    }

    // Save assistant response to conversation history
    await saveMessage(chatId, 'ASSISTANT', response, mode);

    // Fire-and-forget: analyze journal exchanges for relational observations
    if (mode === 'JOURNAL') {
      void writeRelationalMemory(chatId, text, response);
    }

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
