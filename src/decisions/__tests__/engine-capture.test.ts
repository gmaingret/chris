/**
 * Phase 14 Wave 0 RED test — SWEEP-03 engine pre-processor wiring
 * (PP#0 active-capture check, PP#1 trigger detection).
 *
 * Covers:
 *   - PP#0 precedes mute/refusal/language/mode when capture is active (D-24).
 *   - PP#1 opens capture when structural stakes + trigger regex hit.
 *   - Re-trigger mid-capture is ignored; stays on current capture (D-12).
 *   - Suppressed phrase skips regex evaluation entirely.
 *   - stakes=trivial falls through (D-06 fail-closed design intent).
 *
 * Will fail until Wave 2 "engine-capture" plan wires PP#0 and PP#1 into
 * src/chris/engine.ts.
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
import * as engineMod from '../../chris/engine.js';
import * as muteMod from '../../proactive/mute.js';
// @ts-expect-error — Wave 1 creates this module
import * as captureMod from '../capture.js';
// @ts-expect-error — Wave 1 creates this module
import * as triggersMod from '../triggers.js';
// @ts-expect-error — Wave 1 creates this module
import { addSuppression } from '../suppressions.js';

describe('SWEEP-03: engine pre-processor chain (PP#0 → PP#1)', () => {
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
      draft: { language_at_capture: 'en' },
    });
    const captureSpy = vi
      .spyOn(captureMod, 'handleCapture')
      .mockResolvedValue('captured');
    const muteSpy = vi
      .spyOn(muteMod, 'detectMuteIntent')
      .mockResolvedValue({ mute: false });
    // processMessage is the engine entrypoint; Phase-14 plans wire this.
    await engineMod.processMessage(200n, 'mute for 1 hour please', 'user');
    expect(captureSpy).toHaveBeenCalledOnce();
    expect(muteSpy).not.toHaveBeenCalled();
  });

  it('PP#1 opens capture when structural stakes + trigger regex hit', async () => {
    vi.spyOn(triggersMod, 'classifyStakes').mockResolvedValue('structural');
    await engineMod.processMessage(201n, "I'm thinking about quitting my job", 'user');
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
      draft: { language_at_capture: 'en', decision_text: 'quit' },
    });
    const captureSpy = vi
      .spyOn(captureMod, 'handleCapture')
      .mockResolvedValue('ok');
    await engineMod.processMessage(
      202n,
      "I'm weighing between Paris and Lyon",
      'user',
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
      "I'm thinking about dinner tonight",
      'user',
    );
    expect(stakesSpy).not.toHaveBeenCalled();
    const state = await db.select().from(decisionCaptureState);
    expect(state.length).toBe(0);
  });

  it('stakes=trivial falls through without opening capture', async () => {
    vi.spyOn(triggersMod, 'classifyStakes').mockResolvedValue('trivial');
    const detectModeSpy = vi.spyOn(engineMod, 'detectMode').mockResolvedValue('JOURNAL' as never);
    await engineMod.processMessage(
      204n,
      "I'm thinking about what to eat",
      'user',
    );
    const state = await db.select().from(decisionCaptureState);
    expect(state.length).toBe(0);
    expect(detectModeSpy).toHaveBeenCalled();
  });
});
