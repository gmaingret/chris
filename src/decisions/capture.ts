/**
 * Phase 14 CAP-02/03/04 + LIFE-05 — conversational capture engine.
 *
 * Stub created for Task 2 (resolve-by) — full implementation in Task 4.
 */

import { getActiveDecisionCapture, clearCapture, isAbortPhrase } from './capture-state.js';
import type { CaptureDraft } from './capture-state.js';

export async function handleCapture(chatId: bigint, text: string): Promise<string> {
  throw new Error('capture.handleCapture: not yet implemented (Task 4)');
}

export async function openCapture(
  chatId: bigint,
  triggeringMessage: string,
  language: 'en' | 'fr' | 'ru',
): Promise<string> {
  throw new Error('capture.openCapture: not yet implemented (Task 4)');
}
