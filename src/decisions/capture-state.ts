import { db } from '../db/connection.js';
import { decisionCaptureState } from '../db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * Phase 13 READ helper for decision_capture_state (D-15).
 *
 * Returns the active capture-flow row for a given chat, or null if none exists.
 * PK=chat_id enforces ≤1 active capture/resolution flow per chat.
 *
 * Phase 14 capture conversation will add mutation helpers
 * (startDecisionCapture / advanceCaptureStage / finishCapture). Phase 13 ships
 * the read helper only so Phase 14's engine pre-processor has a clean hook.
 */
export async function getActiveDecisionCapture(chatId: bigint) {
  const rows = await db
    .select()
    .from(decisionCaptureState)
    .where(eq(decisionCaptureState.chatId, chatId))
    .limit(1);
  return rows[0] ?? null;
}
