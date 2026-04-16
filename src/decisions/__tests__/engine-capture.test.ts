/**
 * Phase 14 Wave 2 — SWEEP-03 engine pre-processor wiring
 * (PP#0 active-capture check, PP#1 trigger detection).
 *
 * Covers:
 *   - PP#0 precedes mute/refusal/language/mode when capture is active (D-24).
 *   - PP#1 opens capture when structural stakes + trigger regex hit.
 *   - Re-trigger mid-capture is ignored; stays on current capture (D-12).
 *   - Suppressed phrase skips regex evaluation entirely.
 *   - stakes=trivial falls through (D-06 fail-closed design intent).
 *
 * Run: npx vitest run src/decisions/__tests__/engine-capture.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  decisionTriggerSuppressions,
  pensieveEntries,
} from '../../db/schema.js';

// ── Module-level mocks for LLM-calling modules ──────────────────────────
// These prevent real Haiku/Sonnet calls in tests that exercise the fall-through
// path past PP#0/PP#1 into the normal engine flow.

vi.mock('../../proactive/mute.js', () => ({
  detectMuteIntent: vi.fn().mockResolvedValue({ muted: false }),
  generateMuteAcknowledgment: vi.fn().mockResolvedValue('muted'),
}));

vi.mock('../../chris/modes/journal.js', () => ({
  handleJournal: vi.fn().mockResolvedValue('journal response'),
}));

vi.mock('../../chris/modes/interrogate.js', () => ({
  handleInterrogate: vi.fn().mockResolvedValue('interrogate response'),
}));

vi.mock('../../chris/modes/reflect.js', () => ({
  handleReflect: vi.fn().mockResolvedValue('reflect response'),
}));

vi.mock('../../chris/modes/coach.js', () => ({
  handleCoach: vi.fn().mockResolvedValue('coach response'),
}));

vi.mock('../../chris/modes/psychology.js', () => ({
  handlePsychology: vi.fn().mockResolvedValue('psychology response'),
}));

vi.mock('../../chris/modes/produce.js', () => ({
  handleProduce: vi.fn().mockResolvedValue('produce response'),
}));

vi.mock('../../chris/modes/photos.js', () => ({
  handlePhotos: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../chris/praise-quarantine.js', () => ({
  quarantinePraise: vi.fn().mockImplementation((text: string) => Promise.resolve(text)),
}));

vi.mock('../../chris/contradiction.js', () => ({
  detectContradictions: vi.fn().mockResolvedValue([]),
  type: true,
}));

vi.mock('../../llm/client.js', async () => {
  return {
    anthropic: {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: '{"mode":"JOURNAL"}' }],
        }),
      },
    },
    HAIKU_MODEL: 'test-haiku',
    SONNET_MODEL: 'test-sonnet',
    OPUS_MODEL: 'test-opus',
    callLLM: vi.fn().mockResolvedValue('{}'),
  };
});

import * as engineMod from '../../chris/engine.js';
import * as muteMod from '../../proactive/mute.js';
import * as captureMod from '../capture.js';
import * as triggersMod from '../triggers.js';
import { addSuppression } from '../suppressions.js';

describe('SWEEP-03: engine pre-processor chain (PP#0 -> PP#1)', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    await sql.end();
  });

  afterEach(async () => {
    await db.delete(decisionEvents);
    await db.delete(decisions);
    await db.delete(decisionCaptureState);
    await db.delete(decisionTriggerSuppressions);
    await db.delete(pensieveEntries);
    vi.restoreAllMocks();
  });

  it('PP#0 precedes mute/refusal/language/mode when capture is active', async () => {
    await db.insert(decisionCaptureState).values({
      chatId: 200n,
      stage: 'DECISION' as never,
      draft: { language_at_capture: 'en', turn_count: 0, triggering_message: 'test' },
    });
    const captureSpy = vi
      .spyOn(captureMod, 'handleCapture')
      .mockResolvedValue('captured');
    const muteSpy = vi.mocked(muteMod.detectMuteIntent);
    muteSpy.mockClear();
    // processMessage is the engine entrypoint; Phase-14 PP#0 intercepts this.
    await engineMod.processMessage(200n, 1, 'mute for 1 hour please');
    expect(captureSpy).toHaveBeenCalledOnce();
    expect(muteSpy).not.toHaveBeenCalled();
  });

  it('PP#1 opens capture when structural stakes + trigger regex hit', async () => {
    vi.spyOn(triggersMod, 'classifyStakes').mockResolvedValue('structural');
    await engineMod.processMessage(201n, 1, "I'm thinking about quitting my job");
    const state = await db
      .select()
      .from(decisionCaptureState);
    expect(state.length).toBe(1);
    expect(state[0]!.chatId).toBe(201n);
    expect(state[0]!.stage).toBe('DECISION');
  });

  it('re-trigger mid-capture is ignored (stays on current)', async () => {
    await db.insert(decisionCaptureState).values({
      chatId: 202n,
      stage: 'ALTERNATIVES' as never,
      draft: { language_at_capture: 'en', decision_text: 'quit', turn_count: 1, triggering_message: 'quit' },
    });
    const captureSpy = vi
      .spyOn(captureMod, 'handleCapture')
      .mockResolvedValue('ok');
    await engineMod.processMessage(
      202n,
      1,
      "I'm weighing between Paris and Lyon",
    );
    // Still exactly one row, still on ALTERNATIVES stage; input went to capture.
    const state = await db.select().from(decisionCaptureState);
    expect(state.length).toBe(1);
    expect(state[0]!.stage).toBe('ALTERNATIVES');
    expect(captureSpy).toHaveBeenCalledOnce();
  });

  it('suppressed phrase skips regex evaluation', async () => {
    await addSuppression(203n, "i'm thinking about");
    const stakesSpy = vi
      .spyOn(triggersMod, 'classifyStakes')
      .mockResolvedValue('structural');
    await engineMod.processMessage(
      203n,
      1,
      "I'm thinking about dinner tonight",
    );
    expect(stakesSpy).not.toHaveBeenCalled();
    const state = await db.select().from(decisionCaptureState);
    expect(state.length).toBe(0);
  });

  it('stakes=trivial falls through without opening capture', async () => {
    vi.spyOn(triggersMod, 'classifyStakes').mockResolvedValue('trivial');
    await engineMod.processMessage(
      204n,
      1,
      "I'm thinking about what to eat",
    );
    const state = await db.select().from(decisionCaptureState);
    expect(state.length).toBe(0);
    // Falls through to normal engine (mode detection + handler).
    // Mode detection runs because no capture/suppression intercepted.
  });
});
