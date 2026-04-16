/**
 * Phase 14 CAP-02/03/04 + LIFE-05 — Conversational capture engine.
 *
 * Two exports:
 *   - openCapture(chatId, triggeringMessage, language) — called from PP#1 (Plan 05)
 *   - handleCapture(chatId, text) — processes one capture turn
 *
 * All decisions.status mutations go through transitionDecision() or direct INSERT
 * for initial row creation (chokepoint audit allows INSERT, only guards UPDATE).
 *
 * Security: user text goes ONLY into callLLM messages[].content (T-14-04-02).
 * Logging: only structural fields — never draft content or user text (T-14-04-03).
 */

import { randomUUID } from 'node:crypto';
import { db } from '../db/connection.js';
import { decisions, decisionEvents, pensieveEntries } from '../db/schema.js';
import { callLLM } from '../llm/client.js';
import {
  CAPTURE_EXTRACTION_PROMPT,
} from '../llm/prompts.js';
import { logger } from '../utils/logger.js';
import {
  getActiveDecisionCapture,
  updateCaptureDraft,
  clearCapture,
  isAbortPhrase,
  createCaptureDraft,
} from './capture-state.js';
import type { CaptureDraft, DecisionCaptureStage } from './capture-state.js';
import { transitionDecision } from './lifecycle.js';
import {
  parseResolveBy,
  daysFromNow,
  matchClarifierReply,
  buildResolveByClarifierQuestion,
  buildResolveByDefaultAnnouncement,
  CLARIFIER_LADDER_DAYS,
} from './resolve-by.js';
import { validateVagueness, buildVaguePushback } from './vague-validator.js';
import { detectContradictions } from '../chris/contradiction.js';

// ── Constants ──────────────────────────────────────────────────────────────

const EXTRACTOR_TIMEOUT_MS = 3000;
const MAX_TURNS = 3;

const CANONICAL_STAGES: DecisionCaptureStage[] = [
  'DECISION', 'ALTERNATIVES', 'REASONING', 'PREDICTION', 'FALSIFICATION',
];

const STAGE_TO_DRAFT_KEY: Record<string, keyof CaptureDraft> = {
  DECISION: 'decision_text',
  ALTERNATIVES: 'alternatives',
  REASONING: 'reasoning',
  PREDICTION: 'prediction',
  FALSIFICATION: 'falsification_criterion',
};

// ── Localized stage questions ─────────────────────────────────────────────

function questionForStage(stage: DecisionCaptureStage, lang: 'en' | 'fr' | 'ru'): string {
  const questions: Record<string, Record<string, string>> = {
    DECISION: {
      en: 'What are you thinking about deciding?',
      fr: 'A quoi est-ce que tu penses ?',
      ru: 'О чем ты думаешь?',
    },
    ALTERNATIVES: {
      en: 'What are the alternatives you\'re considering?',
      fr: 'Quelles sont les alternatives que tu envisages ?',
      ru: 'Какие альтернативы ты рассматриваешь?',
    },
    REASONING: {
      en: 'What\'s pushing you toward one over the others?',
      fr: 'Qu\'est-ce qui te pousse vers l\'une plutôt que les autres ?',
      ru: 'Что склоняет тебя к одному варианту больше, чем к другим?',
    },
    PREDICTION: {
      en: 'What do you think will happen if you go with that?',
      fr: 'Qu\'est-ce que tu penses qu\'il va se passer si tu choisis ça ?',
      ru: 'Что, по-твоему, произойдет, если ты это выберешь?',
    },
    FALSIFICATION: {
      en: 'What would make you say you were wrong?',
      fr: 'Qu\'est-ce qui te ferait dire que tu avais tort ?',
      ru: 'Что заставит тебя сказать, что ты был неправ?',
    },
  };
  return questions[stage]?.[lang] ?? questions[stage]?.en ?? '';
}

function commitConfirmation(resolveByIso: string, lang: 'en' | 'fr' | 'ru'): string {
  const d = new Date(resolveByIso);
  const pretty = d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : lang === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  switch (lang) {
    case 'en': return `Got it — I've archived that. I'll check back ${pretty}.`;
    case 'fr': return `Compris — j'ai archivé ça. Je reviens vers toi le ${pretty}.`;
    case 'ru': return `Понял — я это сохранил. Вернусь к этому ${pretty}.`;
  }
}

function draftCommitAck(lang: 'en' | 'fr' | 'ru'): string {
  switch (lang) {
    case 'en': return "I've saved what we have so far.";
    case 'fr': return 'J\'ai sauvegardé ce qu\'on a pour l\'instant.';
    case 'ru': return 'Я сохранил то, что у нас есть.';
  }
}

// ── Next unfilled stage helper ────────────────────────────────────────────

function nextUnfilledStage(draft: CaptureDraft): DecisionCaptureStage | 'DONE' {
  for (const stage of CANONICAL_STAGES) {
    const key = STAGE_TO_DRAFT_KEY[stage];
    if (key && !draft[key]) return stage;
  }
  return 'DONE';
}

function allRequiredFilled(draft: CaptureDraft): boolean {
  return !!(
    draft.decision_text &&
    draft.reasoning &&
    draft.prediction &&
    draft.falsification_criterion &&
    draft.resolve_by_iso
  );
}

// ── Greedy extractor ──────────────────────────────────────────────────────

async function extractSlots(draft: CaptureDraft, userReply: string): Promise<Partial<CaptureDraft>> {
  const start = Date.now();
  try {
    const userContent = JSON.stringify({
      current_draft: {
        decision_text: draft.decision_text,
        alternatives: draft.alternatives,
        reasoning: draft.reasoning,
        prediction: draft.prediction,
        falsification_criterion: draft.falsification_criterion,
        resolve_by: draft.resolve_by,
        domain_tag: draft.domain_tag,
      },
      user_reply: userReply,
      canonical_slots: ['decision_text', 'alternatives', 'reasoning', 'prediction', 'falsification_criterion', 'resolve_by', 'domain_tag'],
    });
    const raw = await Promise.race([
      callLLM(CAPTURE_EXTRACTION_PROMPT, userContent, 300),
      new Promise<null>((r) => setTimeout(() => r(null), EXTRACTOR_TIMEOUT_MS)),
    ]);
    if (!raw) {
      logger.warn({ latencyMs: Date.now() - start }, 'capture.extractor.timeout');
      return {};
    }
    const cleaned = stripFences(raw);
    const parsed = JSON.parse(cleaned);
    // Build patch — only include newly filled slots that aren't already in draft.
    const patch: Partial<CaptureDraft> = {};
    if (parsed.decision_text && !draft.decision_text) patch.decision_text = parsed.decision_text;
    if (parsed.alternatives && !draft.alternatives) patch.alternatives = parsed.alternatives;
    if (parsed.reasoning && !draft.reasoning) patch.reasoning = parsed.reasoning;
    if (parsed.prediction && !draft.prediction) patch.prediction = parsed.prediction;
    if (parsed.falsification_criterion && !draft.falsification_criterion) patch.falsification_criterion = parsed.falsification_criterion;
    if (parsed.resolve_by && !draft.resolve_by && !draft.resolve_by_iso) patch.resolve_by = parsed.resolve_by;
    if (parsed.domain_tag && !draft.domain_tag) patch.domain_tag = parsed.domain_tag;
    logger.info({ slotsFilled: Object.keys(patch).length, latencyMs: Date.now() - start }, 'capture.extractor');
    return patch;
  } catch (error) {
    logger.warn({ error: errMsg(error), latencyMs: Date.now() - start }, 'capture.extractor.error');
    return {};  // fail-soft
  }
}

// ── Commit helpers ────────────────────────────────────────────────────────

/**
 * INSERT a new decision row + created event atomically.
 * The chokepoint audit only guards UPDATE mutations on decisions; INSERT is allowed.
 */
async function insertDecision(
  id: string,
  status: 'open' | 'open-draft',
  draft: CaptureDraft,
  chatId: bigint,
): Promise<void> {
  const resolveByDate = draft.resolve_by_iso
    ? new Date(draft.resolve_by_iso)
    : daysFromNow(30);

  const payload = {
    id,
    status,
    decisionText: draft.decision_text ?? draft.triggering_message.slice(0, 500),
    alternatives: draft.alternatives ?? null,
    reasoning: draft.reasoning ?? '(not specified in capture)',
    prediction: draft.prediction ?? '(not specified in capture)',
    falsificationCriterion: draft.falsification_criterion ?? '(not specified in capture)',
    resolveBy: resolveByDate,
    domainTag: draft.domain_tag ?? null,
    languageAtCapture: draft.language_at_capture,
    chatId,
  };

  await db.transaction(async (tx) => {
    const inserted = await tx.insert(decisions).values(payload).returning();
    await tx.insert(decisionEvents).values({
      decisionId: id,
      eventType: 'created',
      fromStatus: null,
      toStatus: status,
      snapshot: snapshotForEvent(inserted[0]!),
      actor: 'capture',
    });
  });
}

/**
 * Write Pensieve entry tagged DECISION with source_ref_id pointing back to the decision.
 */
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

function snapshotForEvent(row: typeof decisions.$inferSelect): object {
  return {
    ...row,
    chatId: row.chatId === null ? null : row.chatId.toString(),
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Open a new capture session. Called from PP#1 (Plan 05) when trigger fires.
 * Creates capture_state row and returns the first question.
 */
export async function openCapture(
  chatId: bigint,
  triggeringMessage: string,
  language: 'en' | 'fr' | 'ru',
): Promise<string> {
  const initial: CaptureDraft = {
    language_at_capture: language,
    turn_count: 0,
    triggering_message: triggeringMessage,
  };
  await createCaptureDraft(chatId, initial);
  return questionForStage('DECISION', language);
}

/**
 * Process one capture turn. Reads state from DB, runs extraction, decides next action.
 * Returns Chris's reply string.
 */
export async function handleCapture(chatId: bigint, text: string): Promise<string> {
  const state = await getActiveDecisionCapture(chatId);
  if (!state) {
    // No active capture — should not happen in normal flow.
    return '';
  }

  const draft = { ...(state.draft as CaptureDraft) };
  const lang = draft.language_at_capture;  // D-22: NEVER re-detect

  // ── Abort check ─────────────────────────────────────────────────────
  if (isAbortPhrase(text, lang)) {
    await clearCapture(chatId);
    logger.info({ chatId: chatId.toString() }, 'capture.abort');
    return '';  // fall through — caller handles normal mode
  }

  // ── Increment turn ──────────────────────────────────────────────────
  draft.turn_count = (draft.turn_count ?? 0) + 1;

  // ── Resolve-by clarifier pending? ───────────────────────────────────
  // If we asked a clarifier question last turn, handle the reply before extraction.
  if (draft.resolve_by_clarifier_pending && !draft.resolve_by_iso) {
    const choice = matchClarifierReply(text, lang);
    if (choice) {
      draft.resolve_by_iso = daysFromNow(CLARIFIER_LADDER_DAYS[choice]).toISOString();
      draft.resolve_by_clarifier_pending = false;
    } else if (draft.resolve_by_clarifier_fired) {
      // Double-fail: unparseable after clarifier -> +30d announced
      draft.resolve_by_iso = daysFromNow(30).toISOString();
      draft.resolve_by_clarifier_pending = false;
      const announcement = buildResolveByDefaultAnnouncement(lang);
      // Save draft and try to commit
      await updateCaptureDraft(chatId, draft);
      const commitReply = await tryCommit(chatId, draft, lang);
      if (commitReply !== null) return `${announcement} ${commitReply}`;
      // If not ready to commit, continue with the announcement prefix
      const nextStage = nextUnfilledStage(draft);
      if (nextStage === 'DONE') {
        const reply = await commitOpen(chatId, draft, lang);
        return `${announcement} ${reply}`;
      }
      await updateCaptureDraft(chatId, draft, nextStage);
      return `${announcement}\n\n${questionForStage(nextStage, lang)}`;
    } else {
      // First clarifier fail — ask again and mark as fired
      draft.resolve_by_clarifier_fired = true;
      await updateCaptureDraft(chatId, draft);
      return buildResolveByClarifierQuestion(lang);
    }
  }

  // ── Greedy extraction ───────────────────────────────────────────────
  const patch = await extractSlots(draft, text);
  Object.assign(draft, patch);

  // ── resolve_by parsing ──────────────────────────────────────────────
  if (draft.resolve_by && !draft.resolve_by_iso) {
    const parsed = await parseResolveBy(draft.resolve_by);
    if (parsed) {
      draft.resolve_by_iso = parsed.toISOString();
    } else if (!draft.resolve_by_clarifier_pending) {
      // First parse fail: ask clarifier
      draft.resolve_by_clarifier_pending = true;
      await updateCaptureDraft(chatId, draft);
      return buildResolveByClarifierQuestion(lang);
    }
  }

  // ── Vague validator gate ────────────────────────────────────────────
  let secondVague = false;
  if (draft.prediction && draft.falsification_criterion && !draft.vague_validator_run) {
    const result = await validateVagueness({
      prediction: draft.prediction,
      falsification_criterion: draft.falsification_criterion,
      language: lang,
    });
    draft.vague_validator_run = true;
    if (result.verdict === 'vague') {
      if (!draft.vague_pushback_fired) {
        // First vague: pushback once
        draft.vague_pushback_fired = true;
        await updateCaptureDraft(chatId, draft);
        return buildVaguePushback(lang);
      } else {
        // Second vague: pushback was already fired, validator still says vague -> open-draft (D-15)
        secondVague = true;
      }
    }
  }

  // ── Second-vague landing (D-15) ─────────────────────────────────────
  // If pushback was already fired and this turn the validator (or prior turn)
  // flagged vague, commit as open-draft regardless of slot fill state.
  if (draft.vague_pushback_fired && secondVague) {
    return await commitOpenDraft(chatId, draft, lang);
  }

  // ── 3-turn cap ──────────────────────────────────────────────────────
  if (draft.turn_count >= MAX_TURNS && !allRequiredFilled(draft)) {
    return await commitOpenDraft(chatId, draft, lang);
  }

  // ── All required slots filled -> commit open ────────────────────────
  if (allRequiredFilled(draft)) {
    return await commitOpen(chatId, draft, lang);
  }

  // ── Normal: ask next question ───────────────────────────────────────
  const nextStage = nextUnfilledStage(draft);
  if (nextStage === 'DONE') {
    // Everything filled — commit
    return await commitOpen(chatId, draft, lang);
  }
  await updateCaptureDraft(chatId, draft, nextStage);
  return questionForStage(nextStage, lang);
}

// ── Commit paths ──────────────────────────────────────────────────────────

async function commitOpen(chatId: bigint, draft: CaptureDraft, lang: 'en' | 'fr' | 'ru'): Promise<string> {
  const id = randomUUID();
  const resolveByIso = draft.resolve_by_iso ?? daysFromNow(30).toISOString();
  draft.resolve_by_iso = resolveByIso;

  await insertDecision(id, 'open', draft, chatId);

  // Write Pensieve entry
  const pensieveText = `Decision: ${draft.decision_text}\nReasoning: ${draft.reasoning}\nPrediction: ${draft.prediction}`;
  const pensieveId = await writePensieveEntry(chatId, pensieveText, id);

  // LIFE-05: fire-and-forget contradiction scan — ONLY on null->open (D-20)
  void (async () => {
    try {
      await Promise.race([
        detectContradictions(draft.reasoning!, pensieveId),
        new Promise<never[]>((r) => setTimeout(() => r([]), 3000)),
      ]);
    } catch (e) { logger.warn({ error: errMsg(e) }, 'capture.contradiction.error'); }
  })();

  await clearCapture(chatId);
  logger.info({ chatId: chatId.toString(), status: 'open' }, 'capture.commit');
  return commitConfirmation(resolveByIso, lang);
}

async function commitOpenDraft(chatId: bigint, draft: CaptureDraft, lang: 'en' | 'fr' | 'ru'): Promise<string> {
  const id = randomUUID();
  // Fill NOT NULL slots with placeholders (RESEARCH A4)
  draft.decision_text = draft.decision_text ?? draft.triggering_message.slice(0, 500);
  draft.reasoning = draft.reasoning ?? '(not specified in capture)';
  draft.prediction = draft.prediction ?? '(not specified in capture)';
  draft.falsification_criterion = draft.falsification_criterion ?? '(not specified in capture)';
  draft.resolve_by_iso = draft.resolve_by_iso ?? daysFromNow(30).toISOString();

  await insertDecision(id, 'open-draft', draft, chatId);

  // Write Pensieve entry
  const pensieveText = `Decision (draft): ${draft.decision_text}`;
  await writePensieveEntry(chatId, pensieveText, id);

  // D-20: NO contradiction scan on null->open-draft
  await clearCapture(chatId);
  logger.info({ chatId: chatId.toString(), status: 'open-draft' }, 'capture.commit');
  return draftCommitAck(lang);
}

/**
 * Try to commit if all required slots are filled.
 * Returns commit reply or null if not ready.
 */
async function tryCommit(chatId: bigint, draft: CaptureDraft, lang: 'en' | 'fr' | 'ru'): Promise<string | null> {
  if (allRequiredFilled(draft)) {
    return await commitOpen(chatId, draft, lang);
  }
  if (draft.turn_count >= MAX_TURNS) {
    return await commitOpenDraft(chatId, draft, lang);
  }
  return null;
}

// ── Utilities ─────────────────────────────────────────────────────────────

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
