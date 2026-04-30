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
import { detectContradictions, type DetectedContradiction } from './contradiction.js';
import { formatContradictionNotice } from './personality.js';
import {
  getActiveDecisionCapture,
  clearCapture,
  isAbortPhrase,
  coerceValidDraft,
} from '../decisions/capture-state.js';
import { handleCapture, openCapture } from '../decisions/capture.js';
import { handleResolution, handlePostmortem } from '../decisions/resolution.js';
import { detectTriggerPhrase, classifyStakes } from '../decisions/triggers.js';
import { isSuppressed } from '../decisions/suppressions.js';

// ── Contradiction surface-suppression ──────────────────────────────────────
// The detector doesn't know what's already been shown to the user, so without
// suppression it re-fires on the same past entry every turn while the topic
// stays live. Keyed by (chatId, past-entryId) with a TTL so the notice can
// legitimately reappear if the user returns to the topic much later.

const SURFACED_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const surfacedContradictions = new Map<string, Map<string, number>>();

function pruneSurfaced(chatId: string): Map<string, number> {
  const now = Date.now();
  let perChat = surfacedContradictions.get(chatId);
  if (!perChat) {
    perChat = new Map();
    surfacedContradictions.set(chatId, perChat);
    return perChat;
  }
  for (const [entryId, ts] of perChat) {
    if (now - ts > SURFACED_TTL_MS) perChat.delete(entryId);
  }
  return perChat;
}

function filterAlreadySurfaced(
  chatId: string,
  detected: DetectedContradiction[],
): DetectedContradiction[] {
  const perChat = pruneSurfaced(chatId);
  return detected.filter((c) => !perChat.has(c.entryId));
}

function markSurfaced(chatId: string, surfaced: DetectedContradiction[]): void {
  const perChat = pruneSurfaced(chatId);
  const now = Date.now();
  for (const c of surfaced) perChat.set(c.entryId, now);
}

/** Test-only: reset the in-memory surfaced-contradiction map. */
export function __resetSurfacedContradictionsForTests(): void {
  surfacedContradictions.clear();
}
import type { ChrisMode } from './personality.js';
import { quarantinePraise } from './praise-quarantine.js';
import { detectMuteIntent, generateMuteAcknowledgment } from '../proactive/mute.js';
import { setMuteUntil } from '../proactive/state.js';
import { detectRefusal, addDeclinedTopic, getDeclinedTopics, generateRefusalAcknowledgment } from './refusal.js';
import { detectLanguage, getLastUserLanguage, setLastUserLanguage } from './language.js';
import { config } from '../config.js';
import { LLMError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { stripFences } from '../utils/text.js';
import { findActivePendingResponse, recordRitualVoiceResponse } from '../rituals/voice-note.js';
import { handleAdjustmentReply, handleConfirmationReply } from '../rituals/adjustment-dialogue.js';

// ── Abort acknowledgment (PP#0) ──────────────────────────────────────────

function abortAcknowledgment(lang: 'en' | 'fr' | 'ru'): string {
  switch (lang) {
    case 'en': return 'Okay — dropping that.';
    case 'fr': return 'Okay — on laisse tomber.';
    case 'ru': return 'Хорошо — отменяю.';
  }
}

export type { ChrisMode } from './personality.js';

export const VALID_MODES = new Set<ChrisMode>([
  'JOURNAL', 'INTERROGATE', 'REFLECT', 'COACH', 'PSYCHOLOGY', 'PRODUCE', 'PHOTOS',
  // ACCOUNTABILITY is NOT auto-detected — routed by pre-processor based on capture state
]);

/**
 * Classify a message into one of 7 Chris modes using Haiku.
 * Defaults to JOURNAL on any failure (parse error, API error, invalid mode).
 */
export async function detectMode(text: string): Promise<ChrisMode> {
  const start = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 50,
      system: [
        {
          type: 'text',
          text: MODE_DETECTION_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
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
  opts?: { pensieveSource?: string },
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
    // ── PP#5: Ritual-response detection (M009 Phase 26 VOICE-01; per D-26-02) ─
    // Runs FIRST. State-table lookup against ritual_pending_responses;
    // on hit, write Pensieve as RITUAL_RESPONSE + return empty string
    // (IN-02 silent-skip via src/bot/bot.ts:54).
    // HARD CO-LOC #1 (Pitfall 6 mitigation): co-located with voice-note
    // handler in Plan 26-02. Splitting them = guaranteed Chris-responds-
    // to-rituals regression for the gap window.
    const chatIdStrPP5 = chatId.toString();
    const pending = await findActivePendingResponse(chatIdStrPP5, new Date());
    if (pending) {
      // Phase 28 Plan 03 SKIP-04 + SKIP-05 — metadata.kind dispatch (RESEARCH Landmine 6).
      // Voice-note pending rows had no metadata pre-Phase-28 (column did not exist).
      // After migration 0010, rows default to '{}'::jsonb so metadata->>'kind'
      // returns undefined, falling through to the voice-note path (Pitfall 6 invariant).
      // NULL metadata (defensive) also falls through.
      const kind = (pending.metadata as { kind?: string } | null)?.kind;
      try {
        if (kind === 'adjustment_dialogue') {
          await handleAdjustmentReply(pending, Number(chatId), text);
          logger.info({ pendingId: pending.id, kind }, 'chris.engine.pp5.adjustment_dialogue');
          return ''; // IN-02 silent-skip — Pitfall 6 invariant preserved
        }
        if (kind === 'adjustment_confirmation') {
          await handleConfirmationReply(pending, Number(chatId), text);
          logger.info({ pendingId: pending.id, kind }, 'chris.engine.pp5.adjustment_confirmation');
          return '';
        }
        // Default branch (kind === undefined / null) — existing voice-note path.
        // Preserves Phase 26 VOICE-01 / VOICE-06 contract (RESEARCH Landmine 6).
        const result = await recordRitualVoiceResponse(pending, chatId, text);
        logger.info(
          {
            pendingId: pending.id,
            ritualId: pending.ritualId,
            pensieveEntryId: result.pensieveEntryId,
          },
          'chris.engine.pp5.hit',
        );
        return ''; // IN-02 silent-skip
      } catch (depositErr) {
        // Race-loss is expected under concurrent PP#5 (rare but possible) — the
        // winner already deposited; loser stays silent so cumulative Anthropic
        // not-called invariant in engine-pp5.test.ts holds.
        if (
          depositErr instanceof Error &&
          depositErr.message === 'ritual.pp5.race_lost'
        ) {
          logger.info({ pendingId: pending.id }, 'chris.engine.pp5.race_lost');
          return ''; // Silent — winner's response covered it
        }
        if (
          depositErr instanceof Error &&
          depositErr.message === 'ritual.adjustment.race_lost'
        ) {
          logger.info({ pendingId: pending.id }, 'chris.engine.pp5.adjustment_race_lost');
          return '';
        }
        // Other errors: fall through (better to deposit-as-JOURNAL than lose).
        logger.warn(
          {
            err: depositErr instanceof Error ? depositErr.message : String(depositErr),
            pendingId: pending.id,
          },
          'chris.engine.pp5.deposit_error',
        );
      }
    }

    // ── PP#0: active decision-capture check (SWEEP-03) ─────────────────
    // Runs BEFORE mute/refusal/language/mode detection (D-24).
    const activeCapture = await getActiveDecisionCapture(chatId);
    if (activeCapture) {
      // Route AWAITING_RESOLUTION / AWAITING_POSTMORTEM before abort-phrase check:
      // these stages have draft={} with no language_at_capture, and abort semantics
      // don't apply to resolution flows (CR-01, WR-01).
      if (activeCapture.stage === 'AWAITING_RESOLUTION') {
        const reply = await handleResolution(chatId, text, activeCapture.decisionId!);
        await saveMessage(chatId, 'USER', text, 'JOURNAL');
        await saveMessage(chatId, 'ASSISTANT', reply, 'JOURNAL');
        return reply;
      }
      if (activeCapture.stage === 'AWAITING_POSTMORTEM') {
        const reply = await handlePostmortem(chatId, text, activeCapture.decisionId!);
        await saveMessage(chatId, 'USER', text, 'JOURNAL');
        await saveMessage(chatId, 'ASSISTANT', reply, 'JOURNAL');
        return reply;
      }

      // IN-04: coerce at the JSONB boundary so `language_at_capture` (and other
      // required fields) are guaranteed-valid downstream. Replaces the earlier
      // `draft.language_at_capture ?? 'en'` which was unreachable under the
      // TypeScript contract but hid a real JSONB-drift risk — coerceValidDraft
      // logs and fills defaults, matching the defensive intent without masking.
      const draft = coerceValidDraft(activeCapture.draft);
      const lang: 'en' | 'fr' | 'ru' = draft.language_at_capture;

      // D-25: abort-phrase check INSIDE PP#0 (handler entry).
      if (isAbortPhrase(text, lang)) {
        await clearCapture(chatId);
        const ack = abortAcknowledgment(lang);
        await saveMessage(chatId, 'USER', text, 'JOURNAL');
        await saveMessage(chatId, 'ASSISTANT', ack, 'JOURNAL');
        return ack;
      }

      // Phase 14: handle CAPTURING stages.
      if (
        activeCapture.stage === 'DECISION' ||
        activeCapture.stage === 'ALTERNATIVES' ||
        activeCapture.stage === 'REASONING' ||
        activeCapture.stage === 'PREDICTION' ||
        activeCapture.stage === 'FALSIFICATION'
      ) {
        const reply = await handleCapture(chatId, text);
        await saveMessage(chatId, 'USER', text, 'JOURNAL');
        await saveMessage(chatId, 'ASSISTANT', reply, 'JOURNAL');
        return reply;
      }
      // DONE → fall through to normal engine.
    }

    // ── PP#1: decision-trigger detection ───────────────────────────────
    // Suppression check precedes regex (D-17).
    if (!(await isSuppressed(text, chatId))) {
      const triggerMatch = detectTriggerPhrase(text);
      if (triggerMatch) {
        const tier = await classifyStakes(text);  // D-06 fail-closed to 'trivial'
        if (tier === 'structural') {
          // D-22: franc on the exact triggering message; lock into draft.
          const chatIdStr = chatId.toString();
          const prevLang = getLastUserLanguage(chatIdStr);
          const detected = detectLanguage(text, prevLang);
          const lang: 'en' | 'fr' | 'ru' = detected === 'French' ? 'fr' : detected === 'Russian' ? 'ru' : 'en';
          const q1 = await openCapture(chatId, text, lang);
          await saveMessage(chatId, 'USER', text, 'JOURNAL');
          await saveMessage(chatId, 'ASSISTANT', q1, 'JOURNAL');
          return q1;
        }
        // trivial / moderate / fail-closed → fall through to normal engine.
      }
    }

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

    // Pre-process: detect refusal before mode detection (TRUST-03)
    const chatIdStr = chatId.toString();
    const refusalResult = detectRefusal(text);
    if (refusalResult.isRefusal) {
      addDeclinedTopic(chatIdStr, refusalResult.topic, refusalResult.originalSentence);
      const previousLanguage = getLastUserLanguage(chatIdStr);
      const language = detectLanguage(text, previousLanguage);
      if (language) setLastUserLanguage(chatIdStr, language);
      const ack = generateRefusalAcknowledgment(language ?? 'English');
      await saveMessage(chatId, 'USER', text, 'JOURNAL');
      await saveMessage(chatId, 'ASSISTANT', ack, 'JOURNAL');
      return ack;
    }

    // Pre-process: detect language (LANG-01, LANG-02)
    const previousLanguage = getLastUserLanguage(chatIdStr);
    const detectedLanguage = detectLanguage(text, previousLanguage);
    if (detectedLanguage) setLastUserLanguage(chatIdStr, detectedLanguage);
    const language = detectedLanguage ?? undefined;
    const declinedTopics = getDeclinedTopics(chatIdStr);

    // Detect mode first so we can tag the user message correctly
    const mode = await detectMode(text);

    // Save user message to conversation history (PHOTOS mode overrides this
    // below with an enriched version that includes photo context; ACCOUNTABILITY
    // is routed by PP#0 before reaching this switch and never falls through).
    if (mode !== 'PHOTOS' && mode !== 'ACCOUNTABILITY') {
      await saveMessage(chatId, 'USER', text, mode);
    }

    // Route to handler based on detected mode
    let response: string;
    switch (mode) {
      case 'JOURNAL':
        response = await handleJournal(chatId, text, language, declinedTopics, opts);
        break;
      case 'INTERROGATE':
        response = await handleInterrogate(chatId, text, language, declinedTopics);
        break;
      case 'REFLECT':
        response = await handleReflect(chatId, text, language, declinedTopics);
        break;
      case 'COACH':
        response = await handleCoach(chatId, text, language, declinedTopics);
        break;
      case 'PSYCHOLOGY':
        response = await handlePsychology(chatId, text, language, declinedTopics);
        break;
      case 'PRODUCE':
        response = await handleProduce(chatId, text, language, declinedTopics);
        break;
      case 'PHOTOS': {
        const photoResult = await handlePhotos(chatId, text, language, declinedTopics);
        if (photoResult) {
          response = photoResult.response;
          // Enrich the saved user message with photo context so subsequent turns
          // know what Chris saw (images aren't persisted in conversation history)
          await saveMessage(chatId, 'USER', `${text}\n\n${photoResult.photoContext}`, mode as Exclude<ChrisMode, 'ACCOUNTABILITY'>);
        } else {
          // No photos found — tell the user naturally instead of falling back to journal
          // which wouldn't know photos were attempted
          await saveMessage(chatId, 'USER', text, 'JOURNAL');
          const noPhotosContext = `${text}\n\n[Note: Chris searched the photo library but found no matching photos for this request.]`;
          response = await handleJournal(chatId, noPhotosContext, language, declinedTopics, opts);
        }
        break;
      }
      default:
        // ACCOUNTABILITY is routed by the pre-processor before reaching this switch.
        // If it somehow arrives here, fall back to JOURNAL.
        response = await handleJournal(chatId, text, language, declinedTopics, opts);
        break;
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
        // Suppress re-surfacing a contradiction against the same past entry
        // within a short window — the detector has no memory of what's already
        // been shown to the user, so without this it repeats every turn while
        // the topic stays live.
        const filtered = filterAlreadySurfaced(chatIdStr, detected);
        const notice = formatContradictionNotice(filtered, language);
        if (notice) {
          response += notice;
          markSurfaced(chatIdStr, filtered);
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
    // ACCOUNTABILITY is not a DB-stored conversation mode — skip saving (pre-processor handles it)
    if (mode !== 'ACCOUNTABILITY') {
      await saveMessage(chatId, 'ASSISTANT', response, mode);
    }

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
