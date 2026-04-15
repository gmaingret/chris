/**
 * Phase 14 Wave 0 RED test — CAP-02 vague-prediction validator (D-13/D-14/D-15).
 *
 * Covers:
 *   - Acceptable pair passes through.
 *   - Vague pair (Haiku verdict = vague) triggers one pushback.
 *   - Validator runs only once per capture (second turn accepts regardless).
 *   - Second-vague landing status is `open-draft`, not `open` (D-15).
 *
 * Will fail until Wave 1 "vague-validator" plan lands src/decisions/vague-validator.ts
 * and capture.ts wires it.
 *
 * Run: npx vitest run src/decisions/__tests__/vague-validator.test.ts
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
// @ts-expect-error — Wave 1 creates this module
import { validateVagueness } from '../vague-validator.js';
// @ts-expect-error — Wave 1 creates this module (capture.ts integration tests)
import { handleCapture } from '../capture.js';

describe('CAP-02: vague-prediction validator', () => {
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

  it('validateVagueness returns acceptable for concrete observable pair', async () => {
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return {
        ...mod,
        callLLM: () =>
          Promise.resolve(
            '{"verdict":"acceptable","reason":"concrete observable: sales number"}',
          ),
      };
    });
    const result = await validateVagueness({
      prediction: 'sales will double in 3 months',
      falsification_criterion: 'sales have not doubled by June 15',
    });
    expect(result.verdict).toBe('acceptable');
  });

  it('validateVagueness returns vague when hedge words present and Haiku agrees', async () => {
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return {
        ...mod,
        callLLM: () =>
          Promise.resolve('{"verdict":"vague","reason":"no observable event"}'),
      };
    });
    const result = await validateVagueness({
      prediction: 'things will probably go well',
      falsification_criterion: "it doesn't feel right",
    });
    expect(result.verdict).toBe('vague');
  });

  it('validator fires only once per capture — second pass accepts regardless', async () => {
    // Spy on validateVagueness: drive two full turns past FALSIFICATION.
    // The second turn should NOT call validateVagueness again.
    const validatorSpy = vi.fn(() =>
      Promise.resolve({ verdict: 'vague', reason: 'test' }),
    );
    vi.doMock('../vague-validator.js', () => ({ validateVagueness: validatorSpy }));
    await db.insert(decisionCaptureState).values({
      chatId: 10n,
      stage: 'FALSIFICATION' as never,
      draft: {
        language_at_capture: 'en',
        decision_text: 'quit',
        prediction: 'it\'ll go well',
        falsification_criterion: 'it won\'t feel right',
      },
    });
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return { ...mod, callLLM: () => Promise.resolve('{}') };
    });
    await handleCapture(10n, 'that\'s my prediction'); // first-pass vague → pushback
    await handleCapture(10n, 'still feels fine'); // second-pass: NOT re-validated
    expect(validatorSpy).toHaveBeenCalledTimes(1);
  });

  it('second-vague landing status is open-draft not open', async () => {
    vi.doMock('../vague-validator.js', () => ({
      validateVagueness: () => Promise.resolve({ verdict: 'vague', reason: 'test' }),
    }));
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
      },
    });
    vi.mock('../../llm/client.js', async (importOriginal) => {
      const mod: Record<string, unknown> = await importOriginal();
      return { ...mod, callLLM: () => Promise.resolve('{}') };
    });
    await handleCapture(11n, 'still vague');
    const rows = await db.select().from(decisions);
    expect(rows.length).toBe(1);
    expect(rows[0]!.status).toBe('open-draft');
  });
});
