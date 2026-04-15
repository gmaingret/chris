/**
 * Phase 14 Wave 0 RED test — CAP-02/03/04 + LIFE-05 conversational capture.
 *
 * Covers:
 *   - Greedy multi-slot extraction in one Haiku pass (D-09).
 *   - 3-turn follow-up cap auto-commits as `open-draft` with placeholder strings
 *     for required NOT-NULL fields (D-11, CONTEXT A4).
 *   - open-draft commit routes through transitionDecision chokepoint (LIFE-02).
 *   - language_at_capture is locked at capture-open time (D-22).
 *   - Abort phrase clears capture state and falls through (D-25).
 *   - LIFE-05 contradiction scan fires exactly once on null→open, never on
 *     null→open-draft, never re-fires on subsequent turns.
 *
 * Will fail until Wave 1 "capture" plan lands src/decisions/capture.ts.
 *
 * Run: npx vitest run src/decisions/__tests__/capture.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  decisionTriggerSuppressions,
  pensieveEntries,
} from '../../db/schema.js';
// @ts-expect-error — Wave 1 creates this module
import { handleCapture } from '../capture.js';
// @ts-expect-error — Phase 13 shipped, but type shape not re-exported here yet
import { getActiveDecisionCapture } from '../capture-state.js';
import * as lifecycleMod from '../lifecycle.js';
import * as contradictionMod from '../../chris/contradiction.js';

describe('CAP-02/03/04 + LIFE-05: capture conversation', () => {
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

  it('handleCapture greedy extraction fills multiple slots from one user reply', async () => {
    // Seed an active capture state.
    await db.insert(decisionCaptureState).values({
      chatId: 1n,
      stage: 'DECISION' as never,
      draft: { language_at_capture: 'en' },
    });
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return {
        ...mod,
        callLLM: () =>
          Promise.resolve(
            JSON.stringify({
              decision_text: 'quit my job',
              alternatives: ['quit', 'stay another year'],
              reasoning: 'consulting pays more',
              prediction: "I'll be happier within 3 months",
            }),
          ),
      };
    });
    await handleCapture(1n, 'I want to quit and go consulting, I think I\'ll be happier');
    const state = await getActiveDecisionCapture(1n);
    expect(state).not.toBeNull();
    expect(state!.draft).toMatchObject({
      decision_text: 'quit my job',
      alternatives: expect.any(Array),
      reasoning: expect.any(String),
      prediction: expect.any(String),
    });
  });

  it('3-turn cap auto-commits status=open-draft with placeholder NOT-NULL strings', async () => {
    await db.insert(decisionCaptureState).values({
      chatId: 2n,
      stage: 'DECISION' as never,
      draft: { language_at_capture: 'en', decision_text: 'quit job', turn_count: 0 },
    });
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return { ...mod, callLLM: () => Promise.resolve('{}') };
    });
    await handleCapture(2n, 'uhh');
    await handleCapture(2n, 'idk');
    await handleCapture(2n, 'dunno');
    const rows = await db.select().from(decisions);
    expect(rows.length).toBe(1);
    const d = rows[0]!;
    expect(d.status).toBe('open-draft');
    expect(d.reasoning).toContain('(not specified in capture)');
    expect(d.prediction).toContain('(not specified in capture)');
    expect(d.falsificationCriterion).toContain('(not specified in capture)');
    const state = await getActiveDecisionCapture(2n);
    expect(state).toBeNull();
  });

  it('open-draft commit goes through transitionDecision() chokepoint', async () => {
    const spy = vi.spyOn(lifecycleMod, 'transitionDecision');
    await db.insert(decisionCaptureState).values({
      chatId: 3n,
      stage: 'DECISION' as never,
      draft: { language_at_capture: 'en', decision_text: 'quit', turn_count: 2 },
    });
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return { ...mod, callLLM: () => Promise.resolve('{}') };
    });
    // Third turn triggers the cap.
    await handleCapture(3n, 'still dunno');
    const transitionCalls = spy.mock.calls.filter(
      ([, toStatus]) => toStatus === 'open-draft',
    );
    expect(transitionCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('language_at_capture is locked to triggering-message language across turns', async () => {
    // Open capture with a French triggering message.
    await db.insert(decisionCaptureState).values({
      chatId: 4n,
      stage: 'DECISION' as never,
      draft: { language_at_capture: 'fr' },
    });
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return { ...mod, callLLM: () => Promise.resolve('{}') };
    });
    // Turn 2 reply in English.
    await handleCapture(4n, 'I want to stay in Paris');
    const state = await getActiveDecisionCapture(4n);
    expect(state!.draft).toMatchObject({ language_at_capture: 'fr' });
  });

  it('abort phrase mid-capture clears state and falls through', async () => {
    await db.insert(decisionCaptureState).values({
      chatId: 5n,
      stage: 'DECISION' as never,
      draft: { language_at_capture: 'en' },
    });
    await handleCapture(5n, 'never mind');
    const state = await getActiveDecisionCapture(5n);
    expect(state).toBeNull();
    // No decision row written on abort.
    const rows = await db.select().from(decisions);
    expect(rows.length).toBe(0);
  });

  it('LIFE-05 contradiction scan fires exactly once on null→open, never on null→open-draft', async () => {
    const contradictionSpy = vi
      .spyOn(contradictionMod, 'detectContradictions')
      .mockResolvedValue([]);

    // Scenario 1: cap→open-draft path.
    await db.insert(decisionCaptureState).values({
      chatId: 6n,
      stage: 'DECISION' as never,
      draft: { language_at_capture: 'en', decision_text: 'quit', turn_count: 2 },
    });
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return { ...mod, callLLM: () => Promise.resolve('{}') };
    });
    await handleCapture(6n, 'dunno');
    const draftCalls = contradictionSpy.mock.calls.length;
    expect(draftCalls).toBe(0);

    // Scenario 2: happy path to `open` — seed a fully-filled draft about to commit.
    contradictionSpy.mockClear();
    await db.insert(decisionCaptureState).values({
      chatId: 7n,
      stage: 'FALSIFICATION' as never,
      draft: {
        language_at_capture: 'en',
        decision_text: 'quit',
        alternatives: ['quit', 'stay'],
        reasoning: 'r',
        prediction: 'p',
        falsification_criterion: 'f',
        resolve_by_iso: new Date(Date.now() + 7 * 86400_000).toISOString(),
      },
    });
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return { ...mod, callLLM: () => Promise.resolve('{}') };
    });
    await handleCapture(7n, 'that\'s everything');
    // Fire-and-forget — allow microtask queue to drain.
    await new Promise((r) => setImmediate(r));
    expect(contradictionSpy).toHaveBeenCalledTimes(1);
  });

  it('open-draft → open promotion path does not re-fire contradiction scan', async () => {
    const contradictionSpy = vi
      .spyOn(contradictionMod, 'detectContradictions')
      .mockResolvedValue([]);
    // Seed a happy-path capture → open.
    await db.insert(decisionCaptureState).values({
      chatId: 8n,
      stage: 'FALSIFICATION' as never,
      draft: {
        language_at_capture: 'en',
        decision_text: 'quit',
        alternatives: ['quit', 'stay'],
        reasoning: 'r',
        prediction: 'p',
        falsification_criterion: 'f',
        resolve_by_iso: new Date(Date.now() + 7 * 86400_000).toISOString(),
      },
    });
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return { ...mod, callLLM: () => Promise.resolve('{}') };
    });
    await handleCapture(8n, 'done');
    await new Promise((r) => setImmediate(r));
    const initial = contradictionSpy.mock.calls.length;
    expect(initial).toBe(1);
    // Subsequent unrelated turn does not re-fire.
    await handleCapture(8n, 'hello');
    await new Promise((r) => setImmediate(r));
    expect(contradictionSpy.mock.calls.length).toBe(initial);
  });
});
