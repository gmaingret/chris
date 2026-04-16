/**
 * Phase 14 Wave 0 RED test — CAP-02 vague-prediction validator (D-13/D-14/D-15).
 *
 * Covers:
 *   - Acceptable pair passes through.
 *   - Vague pair (Haiku verdict = vague) triggers one pushback.
 *   - Validator runs only once per capture (second turn accepts regardless).
 *   - Second-vague landing status is `open-draft`, not `open` (D-15).
 *
 * Run: npx vitest run src/decisions/__tests__/vague-validator.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  decisionTriggerSuppressions,
  pensieveEntries,
} from '../../db/schema.js';

// Controllable mock for callLLM — each test sets the return value.
let callLLMReturn = '{}';
vi.mock('../../llm/client.js', async (importOriginal) => {
  const mod: Record<string, unknown> = await importOriginal();
  return {
    ...mod,
    callLLM: (...args: unknown[]) => Promise.resolve(callLLMReturn),
  };
});

// Dynamic import after mock is registered.
const { validateVagueness } = await import('../vague-validator.js');
const { handleCapture } = await import('../capture.js');

describe('CAP-02: vague-prediction validator', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  beforeEach(() => {
    callLLMReturn = '{}';
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

  it('validateVagueness returns acceptable for concrete observable pair', async () => {
    callLLMReturn = '{"verdict":"acceptable","reason":"concrete observable: sales number"}';
    const result = await validateVagueness({
      prediction: 'sales will double in 3 months',
      falsification_criterion: 'sales have not doubled by June 15',
    });
    expect(result.verdict).toBe('acceptable');
  });

  it('validateVagueness returns vague when hedge words present and Haiku agrees', async () => {
    callLLMReturn = '{"verdict":"vague","reason":"no observable event"}';
    const result = await validateVagueness({
      prediction: 'things will probably go well',
      falsification_criterion: "it doesn't feel right",
    });
    expect(result.verdict).toBe('vague');
  });

  it('validator fires only once per capture — second pass accepts regardless', async () => {
    // This test requires capture.ts to wire the vague validator gate.
    // We mock validateVagueness at the capture module's import level.
    const vagueMod = await import('../vague-validator.js');
    const validatorSpy = vi.spyOn(vagueMod, 'validateVagueness')
      .mockResolvedValue({ verdict: 'vague', reason: 'test' });

    callLLMReturn = '{}';  // extractor returns nothing
    await db.insert(decisionCaptureState).values({
      chatId: 10n,
      stage: 'FALSIFICATION' as never,
      draft: {
        language_at_capture: 'en',
        decision_text: 'quit',
        prediction: 'it\'ll go well',
        falsification_criterion: 'it won\'t feel right',
        turn_count: 0,
        triggering_message: 'quit',
      },
    });
    await handleCapture(10n, 'that\'s my prediction'); // first-pass vague -> pushback
    await handleCapture(10n, 'still feels fine'); // second-pass: NOT re-validated
    expect(validatorSpy).toHaveBeenCalledTimes(1);
  });

  it('second-vague landing status is open-draft not open', async () => {
    const vagueMod = await import('../vague-validator.js');
    vi.spyOn(vagueMod, 'validateVagueness')
      .mockResolvedValue({ verdict: 'vague', reason: 'test' });

    callLLMReturn = '{}';
    await db.insert(decisionCaptureState).values({
      chatId: 11n,
      stage: 'FALSIFICATION' as never,
      draft: {
        language_at_capture: 'en',
        decision_text: 'quit',
        alternatives: ['a', 'b'],
        reasoning: 'r',
        prediction: 'it\'ll go well',
        falsification_criterion: 'it won\'t feel right',
        resolve_by_iso: new Date(Date.now() + 7 * 86400_000).toISOString(),
        vague_pushback_fired: true,
        turn_count: 0,
        triggering_message: 'quit',
      },
    });
    await handleCapture(11n, 'still vague');
    const rows = await db.select().from(decisions);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('open-draft');
  });
});
