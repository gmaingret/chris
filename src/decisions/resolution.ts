/**
 * Phase 16 — Resolution handler, post-mortem handler, outcome classifier.
 *
 * handleResolution: processes Greg's reply to an accountability prompt.
 *   Generates a neutral acknowledgment via Sonnet, classifies the outcome
 *   via Haiku, generates a class-specific post-mortem question.
 *
 * handlePostmortem: stores Greg's follow-up answer and completes the lifecycle.
 *
 * classifyOutcome: Haiku-based classification of prediction outcome.
 *   Fail-closed to 'ambiguous' on any parse failure (T-16-03).
 */

import { db } from '../db/connection.js';
import { decisions, pensieveEntries, decisionEvents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { anthropic, HAIKU_MODEL, SONNET_MODEL } from '../llm/client.js';
import { transitionDecision } from './lifecycle.js';
import { OptimisticConcurrencyError } from './errors.js';
import {
  updateToAwaitingPostmortem,
  clearCapture,
} from './capture-state.js';
import { getTemporalPensieve } from '../pensieve/retrieve.js';
import { getLastUserLanguage, detectLanguage } from '../chris/language.js';
import { buildSystemPrompt } from '../chris/personality.js';
import { logger } from '../utils/logger.js';
import { classifyAccuracy } from './classify-accuracy.js';
import { clearEscalationKeys } from '../proactive/state.js';

// ── Types ──────────────────────────────────────────────────────────────────

type OutcomeClass = 'hit' | 'miss' | 'ambiguous' | 'unverifiable';
const VALID_OUTCOMES = new Set<OutcomeClass>(['hit', 'miss', 'ambiguous', 'unverifiable']);

// ── Local helpers ──────────────────────────────────────────────────────────

async function writePensieveEntry(
  chatId: bigint,
  text: string,
  sourceRefId: string,
): Promise<string> {
  const result = await db.insert(pensieveEntries).values({
    content: text,
    epistemicTag: 'DECISION',
    source: 'telegram',
    metadata: { chatId: chatId.toString(), sourceRefId },
  }).returning({ id: pensieveEntries.id });
  return result[0]!.id;
}

// ── Post-mortem questions by outcome and language ──────────────────────────

function postMortemQuestion(
  outcome: OutcomeClass,
  lang: string,
): string {
  const questions: Record<OutcomeClass, Record<string, string>> = {
    hit: {
      en: "What did you see that others missed?",
      fr: "Qu'avez-vous vu que les autres n'ont pas vu ?",
      ru: "Что вы увидели, чего не заметили другие?",
    },
    miss: {
      en: "What would you do differently knowing what you know now?",
      fr: "Que feriez-vous differemment sachant ce que vous savez maintenant ?",
      ru: "Что бы вы сделали иначе, зная то, что знаете сейчас?",
    },
    ambiguous: {
      en: "What would settle this conclusively?",
      fr: "Qu'est-ce qui trancherait la question definitivement ?",
      ru: "Что бы окончательно решило этот вопрос?",
    },
    unverifiable: {
      en: "Is there any way to know, or was this inherently untestable?",
      fr: "Y a-t-il un moyen de le savoir, ou etait-ce fondamentalement inverifiable ?",
      ru: "Есть ли способ это узнать, или это было принципиально непроверяемо?",
    },
  };

  const byLang = questions[outcome];
  return byLang[lang] ?? byLang['en']!;
}

function alreadyResolvedMessage(lang: string): string {
  switch (lang) {
    case 'fr': return "Cette prédiction a déjà été résolue.";
    case 'ru': return "Этот прогноз уже был рассмотрен.";
    default: return "This prediction has already been resolved.";
  }
}

function notedAck(lang: string): string {
  switch (lang) {
    case 'fr': return "Noté.";
    case 'ru': return "Принято.";
    default: return "Noted.";
  }
}

// ── classifyOutcome ────────────────────────────────────────────────────────

const OUTCOME_CLASSIFY_TIMEOUT_MS = 5000;

/**
 * Classify a resolution outcome via Haiku.
 *
 * Returns one of: 'hit' | 'miss' | 'ambiguous' | 'unverifiable'.
 * Fail-closed to 'ambiguous' on any parse error or unexpected value (T-16-03).
 *
 * User text goes only into messages[].content — never into system prompt.
 */
export async function classifyOutcome(
  resolutionText: string,
  prediction: string,
  criterion: string,
): Promise<OutcomeClass> {
  const start = Date.now();
  const systemPrompt =
    'Given Greg\'s account of what happened, the original prediction, and the ' +
    'falsification criterion, classify the outcome. ' +
    'Respond with ONLY valid JSON: {"outcome": "hit" | "miss" | "ambiguous" | "unverifiable"}';

  const userMessage =
    `Prediction: ${prediction}\nFalsification criterion: ${criterion}\nGreg\'s account: ${resolutionText}`;

  try {
    const raw = await Promise.race([
      anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 30,
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage }],
      }),
      new Promise<null>((r) => setTimeout(() => r(null), OUTCOME_CLASSIFY_TIMEOUT_MS)),
    ]);

    if (raw === null) {
      logger.warn({ latencyMs: Date.now() - start }, 'resolution.classify.timeout');
      return 'ambiguous';
    }

    const textBlock = raw.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn({ latencyMs: Date.now() - start }, 'resolution.classify.no-text-block');
      return 'ambiguous';
    }

    const cleaned = textBlock.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    // WR-06: explicit inner try/catch mirrors the classify-accuracy.ts:79-84
    // pattern so malformed JSON surfaces a dedicated `parse-error` log label
    // instead of getting absorbed by the outer catch as `classify.error`.
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      logger.warn({ latencyMs: Date.now() - start }, 'resolution.classify.parse-error');
      return 'ambiguous';
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('outcome' in parsed)
    ) {
      logger.warn({ latencyMs: Date.now() - start }, 'resolution.classify.missing-field');
      return 'ambiguous';
    }

    const outcome = (parsed as Record<string, unknown>)['outcome'];
    if (typeof outcome !== 'string' || !VALID_OUTCOMES.has(outcome as OutcomeClass)) {
      logger.warn({ outcome, latencyMs: Date.now() - start }, 'resolution.classify.invalid-value');
      return 'ambiguous';
    }

    logger.info({ outcome, latencyMs: Date.now() - start }, 'resolution.classify');
    return outcome as OutcomeClass;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - start },
      'resolution.classify.error',
    );
    return 'ambiguous';  // T-16-03 fail-closed
  }
}

// ── handleResolution ───────────────────────────────────────────────────────

/**
 * Process Greg's reply to an accountability prompt.
 *
 * Full sequence per RESEARCH.md Pattern 7:
 * 1. Load decision row
 * 2. Detect reply language
 * 3. Get +/-48h Pensieve context
 * 4. Build Sonnet prompt and get acknowledgment
 * 5. Transition due -> resolved (catch OptimisticConcurrencyError)
 * 6. Store resolution text via plain UPDATE
 * 7. updateToAwaitingPostmortem
 * 8. classifyOutcome
 * 9. Generate class-specific post-mortem question
 * 10. Fire-and-forget Pensieve writes (D-09)
 * 11. clearEscalationKeys (fire-and-forget, guarded)
 * 12. Return acknowledgment + post-mortem question
 */
export async function handleResolution(
  chatId: bigint,
  text: string,
  decisionId: string,
): Promise<string> {
  // 1. Load decision row
  const rows = await db
    .select()
    .from(decisions)
    .where(eq(decisions.id, decisionId))
    .limit(1);

  // 2. Detect Greg's reply language (Pitfall 1: do NOT read from activeCapture.draft)
  // Hoisted above the !decision check so the decision-not-found fallback also uses
  // the normalized short code (CR-01 — prior CR-02 fix was missed on this branch).
  const rawLang = getLastUserLanguage(chatId.toString()) ?? detectLanguage(text, null) ?? 'English';
  // Normalize: detectLanguage/getLastUserLanguage return full names ('French', 'Russian', 'English')
  // but postMortemQuestion/notedAck/alreadyResolvedMessage use short codes ('fr', 'ru', 'en').
  // Use rawLang for buildSystemPrompt (expects full names), langCode for helper functions.
  const detectedLanguage = rawLang === 'French' ? 'fr' : rawLang === 'Russian' ? 'ru' : 'en';

  const decision = rows[0];
  if (!decision) {
    logger.warn({ decisionId }, 'resolution.decision-not-found');
    return notedAck(detectedLanguage);
  }

  // 3. Get +/-48h Pensieve context (pass windowMs = 48h in milliseconds)
  const centerDate = decision.resolveBy ?? new Date();
  const temporalEntries = await getTemporalPensieve(centerDate, 48 * 3_600_000);
  const temporalContext = temporalEntries.length > 0
    ? temporalEntries
        .map((e) => `(${e.createdAt?.toISOString().slice(0, 10) ?? 'unknown'}) ${e.content}`)
        .join('\n')
    : 'No surrounding Pensieve entries found.';

  // 4. Build decision context for the system prompt
  const decisionContext = [
    `Original prediction: ${decision.prediction}`,
    `Falsification criterion: ${decision.falsificationCriterion}`,
    `Resolve-by date: ${decision.resolveBy?.toISOString().slice(0, 10) ?? 'unknown'}`,
    `Greg's resolution: ${text}`,
  ].join('\n');

  // 5. Build system prompt and call Sonnet for acknowledgment
  const systemPrompt = buildSystemPrompt(
    'ACCOUNTABILITY',
    decisionContext,
    temporalContext,
    rawLang,
  );

  let acknowledgment: string;
  try {
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 300,
      system: [{ type: 'text', text: systemPrompt }],
      messages: [{ role: 'user', content: text }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    acknowledgment = (textBlock && textBlock.type === 'text')
      ? textBlock.text
      : notedAck(detectedLanguage);
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'resolution.sonnet.error',
    );
    acknowledgment = notedAck(detectedLanguage);
  }

  // 6. Transition due -> resolved (Pitfall 3: catch OptimisticConcurrencyError)
  try {
    await transitionDecision(decisionId, 'due', 'resolved', { actor: 'system' });
  } catch (err) {
    if (err instanceof OptimisticConcurrencyError) {
      // Re-read decision to check if already resolved
      const reread = await db.select().from(decisions).where(eq(decisions.id, decisionId)).limit(1);
      if (reread[0]?.status === 'resolved' || reread[0]?.status === 'reviewed') {
        logger.info({ decisionId }, 'resolution.already-resolved');
        return alreadyResolvedMessage(detectedLanguage);
      }
    }
    // Other errors: log and continue (don't break the user experience)
    logger.warn(
      { error: err instanceof Error ? err.message : String(err), decisionId },
      'resolution.transition.error',
    );
  }

  // 7. Store resolution text via plain UPDATE (Pitfall 6: NOT through transitionDecision)
  await db
    .update(decisions)
    .set({ resolution: text, updatedAt: new Date() })
    .where(eq(decisions.id, decisionId));

  // 8. updateToAwaitingPostmortem
  await updateToAwaitingPostmortem(chatId);

  // 9. classifyOutcome
  const outcome = await classifyOutcome(text, decision.prediction, decision.falsificationCriterion);

  // Phase 17 STAT-02: 2-axis accuracy classification (D-01, D-02, D-03)
  let accuracyClass = `${outcome}/unknown`;
  try {
    const reasoning = await classifyAccuracy(outcome, text, decision.prediction);
    accuracyClass = `${outcome}/${reasoning}`;
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'resolution.classifyAccuracy.error',
    );
  }
  // WR-05: wrap projection-update + classified-event-insert in a single
  // transaction so the D-11 invariant ("originals preserved via append-only
  // event log") cannot be broken by a partial write (e.g. network blip or
  // constraint error between the two statements).
  await db.transaction(async (tx) => {
    // Write to decisions projection row (D-03)
    await tx.update(decisions).set({
      accuracyClass,
      accuracyClassifiedAt: new Date(),
      accuracyModelVersion: HAIKU_MODEL,
      updatedAt: new Date(),
    }).where(eq(decisions.id, decisionId));
    // Append classified event to decision_events (D-11, NOT through transitionDecision — Pitfall 3)
    await tx.insert(decisionEvents).values({
      decisionId,
      eventType: 'classified',
      snapshot: { accuracyClass, accuracyModelVersion: HAIKU_MODEL },
      actor: 'system',
    });
  });

  // 10. Generate class-specific post-mortem question
  const question = postMortemQuestion(outcome, detectedLanguage);

  // 11. Pensieve writes — awaited so callers (including tests) see the written entries.
  // Errors are caught and logged; they never fail the resolution flow (D-09 never-throw spirit).
  await writePensieveEntry(chatId, text, decisionId)
    .catch((err) => logger.warn({ err }, 'resolution.pensieve.write.failed'));
  await writePensieveEntry(chatId, acknowledgment, decisionId)
    .catch((err) => logger.warn({ err }, 'resolution.pensieve.write.failed'));

  // 12. clearEscalationKeys — fire-and-forget, best-effort cleanup.
  // IN-01: Previously used a dynamic import + `typeof === 'function'` guard as
  // a defensive safety net when `proactive/state.ts` was temporarily missing
  // post-merge. Phase 19's restoration (f8ea66f) brought the module back with
  // `clearEscalationKeys` exported statically, so the guard is now dead code.
  // Switched to a static top-level import — the `.catch()` still swallows any
  // runtime failure so this cleanup cannot break the resolution flow.
  void clearEscalationKeys(decisionId).catch((_e) => {
    // Escalation cleanup is best-effort — never fail the resolution handler
  });

  return acknowledgment + '\n\n' + question;
}

// ── handlePostmortem ───────────────────────────────────────────────────────

/**
 * Store Greg's post-mortem answer and complete the decision lifecycle.
 *
 * Full sequence per RESEARCH.md Pattern 9:
 * 1. Detect language
 * 2. Store resolution_notes via UPDATE
 * 3. Transition resolved -> reviewed
 * 4. clearCapture
 * 5. clearEscalationKeys (fire-and-forget, guarded)
 * 6. Fire-and-forget Pensieve write
 * 7. Return one-line ack
 */
export async function handlePostmortem(
  chatId: bigint,
  text: string,
  decisionId: string,
): Promise<string> {
  // 1. Detect language — normalize full names to short codes for helper functions
  const rawPostLang = getLastUserLanguage(chatId.toString()) ?? detectLanguage(text, null) ?? 'English';
  const detectedLanguage = rawPostLang === 'French' ? 'fr' : rawPostLang === 'Russian' ? 'ru' : 'en';

  // 2. Store resolution_notes
  await db
    .update(decisions)
    .set({ resolutionNotes: text, updatedAt: new Date() })
    .where(eq(decisions.id, decisionId));

  // 3. Transition resolved -> reviewed
  try {
    await transitionDecision(decisionId, 'resolved', 'reviewed', { actor: 'system' });
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err), decisionId },
      'postmortem.transition.error',
    );
  }

  // 4. clearCapture
  await clearCapture(chatId);

  // 5. clearEscalationKeys — fire-and-forget, best-effort cleanup.
  // IN-01: See handleResolution above for context. Static import replaces the
  // defensive dynamic import + typeof guard (dead code post-Phase-19).
  void clearEscalationKeys(decisionId).catch((_e) => {
    // Best-effort cleanup
  });

  // 6. Pensieve write — awaited for testability; errors caught and logged
  await writePensieveEntry(chatId, text, decisionId)
    .catch((err) => logger.warn({ err }, 'postmortem.pensieve.write.failed'));

  // 7. Return one-line ack
  return notedAck(detectedLanguage);
}
