import { db } from '../db/connection.js';
import { decisionCaptureState } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import {
  ABORT_PHRASES_EN,
  ABORT_PHRASES_FR,
  ABORT_PHRASES_RU,
} from './triggers-fixtures.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type DecisionCaptureStage =
  | 'DECISION' | 'ALTERNATIVES' | 'REASONING'
  | 'PREDICTION' | 'FALSIFICATION'
  | 'AWAITING_RESOLUTION' | 'AWAITING_POSTMORTEM' | 'DONE';

export interface CaptureDraft {
  decision_text?: string;
  alternatives?: string[];
  reasoning?: string;
  prediction?: string;
  falsification_criterion?: string;
  resolve_by?: string;               // natural-lang string before parsing
  resolve_by_iso?: string;           // ISO string once parsed
  resolve_by_clarifier_pending?: boolean;
  resolve_by_clarifier_fired?: boolean;
  language_at_capture: 'en' | 'fr' | 'ru';
  turn_count: number;
  vague_validator_run?: boolean;
  vague_pushback_fired?: boolean;
  domain_tag?: string;
  triggering_message: string;        // verbatim triggering text
}

// ── Phase 13 READ helper (D-15) ───────────────────────────────────────────

/**
 * Returns the active capture-flow row for a given chat, or null if none exists.
 * PK=chat_id enforces ≤1 active capture/resolution flow per chat.
 */
export async function getActiveDecisionCapture(chatId: bigint) {
  const rows = await db
    .select()
    .from(decisionCaptureState)
    .where(eq(decisionCaptureState.chatId, chatId))
    .limit(1);
  return rows[0] ?? null;
}

// ── Phase 14 WRITE helpers ─────────────────────────────────────────────────

export async function createCaptureDraft(chatId: bigint, initial: CaptureDraft): Promise<void> {
  await db.insert(decisionCaptureState).values({
    chatId,
    stage: 'DECISION',
    draft: initial,
    decisionId: null,
  });
}

export async function updateCaptureDraft(
  chatId: bigint,
  patch: Partial<CaptureDraft>,
  nextStage?: DecisionCaptureStage,
): Promise<void> {
  const current = await getActiveDecisionCapture(chatId);
  if (!current) throw new Error('capture-state.updateCaptureDraft: no active capture for chatId');
  const merged = { ...(current.draft as CaptureDraft), ...patch };
  await db.update(decisionCaptureState)
    .set({
      draft: merged,
      stage: nextStage ?? current.stage,
      updatedAt: new Date(),
    })
    .where(eq(decisionCaptureState.chatId, chatId));
}

export async function clearCapture(chatId: bigint): Promise<void> {
  await db.delete(decisionCaptureState).where(eq(decisionCaptureState.chatId, chatId));
}

// ── Phase 15 WRITE helper ──────────────────────────────────────────────────

/**
 * Phase 15: sweep writes AWAITING_RESOLUTION before sending the accountability prompt.
 * Phase 16's engine PP#0 reads this row to route Greg's reply to the resolution handler.
 */
export async function upsertAwaitingResolution(chatId: bigint, decisionId: string): Promise<void> {
  await db.insert(decisionCaptureState).values({
    chatId,
    stage: 'AWAITING_RESOLUTION',
    draft: {},
    decisionId,
  }).onConflictDoUpdate({
    target: decisionCaptureState.chatId,
    set: {
      stage: 'AWAITING_RESOLUTION',
      draft: {},
      decisionId,
      updatedAt: new Date(),
    },
  });
}

// ── Abort-phrase detector (D-04) ───────────────────────────────────────────

/**
 * Pure string-match abort detector. NOT async — no LLM call.
 * Word-or-prefix match against trimmed message (per D-04).
 */
export function isAbortPhrase(text: string, language: 'en' | 'fr' | 'ru'): boolean {
  const normalized = text.trim().toLowerCase();
  const phrases =
    language === 'en' ? ABORT_PHRASES_EN :
    language === 'fr' ? ABORT_PHRASES_FR :
    ABORT_PHRASES_RU;
  for (const p of phrases) {
    if (normalized === p) return true;
    if (normalized.startsWith(p + ' ')) return true;
    // whole-word boundary inside message
    const re = new RegExp(`(^|\\s)${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i');
    if (re.test(normalized)) return true;
  }
  return false;
}
