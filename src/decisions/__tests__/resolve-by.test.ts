/**
 * Phase 14 Wave 0 RED test — CAP-05 resolve_by natural-language parsing ladder.
 *
 * Covers:
 *   - parseResolveBy returns ISO for parseable phrases (Haiku happy path).
 *   - parseResolveBy returns null on Haiku-null (unparseable) -> clarifier.
 *   - Clarifier fallback: user picks "a month" -> +30d commit.
 *   - Silent +30d default after double-fail is announced in reply text.
 *
 * Run: npx vitest run src/decisions/__tests__/resolve-by.test.ts
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

const { parseResolveBy } = await import('../resolve-by.js');
const { handleCapture } = await import('../capture.js');

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function daysFromNow(days: number) {
  return new Date(Date.now() + days * DAY_MS);
}

describe('CAP-05: resolve_by parser + clarifier ladder (D-18/D-19)', () => {
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

  it('parseResolveBy returns ISO for "next week"', async () => {
    const iso = daysFromNow(7).toISOString();
    callLLMReturn = JSON.stringify({ iso });
    const parsed = await parseResolveBy('next week');
    expect(parsed).toBeInstanceOf(Date);
    const delta = Math.abs(parsed!.getTime() - daysFromNow(7).getTime());
    expect(delta).toBeLessThan(HOUR_MS);
  });

  it('parseResolveBy returns null on Haiku null', async () => {
    callLLMReturn = '{"iso":null}';
    const parsed = await parseResolveBy('whenever man');
    expect(parsed).toBeNull();
  });

  it('clarifier fallback: user picks "a month" -> +30d', async () => {
    callLLMReturn = '{}';
    await db.insert(decisionCaptureState).values({
      chatId: 20n,
      stage: 'FALSIFICATION' as never,
      draft: {
        language_at_capture: 'en',
        decision_text: 'quit',
        alternatives: ['quit', 'stay'],
        reasoning: 'r',
        prediction: 'p',
        falsification_criterion: 'f',
        resolve_by_clarifier_pending: true,
        turn_count: 0,
        triggering_message: 'quit',
      },
    });
    await handleCapture(20n, 'a month');
    const rows = await db.select().from(decisions);
    expect(rows.length).toBe(1);
    const actual = rows[0]!.resolveBy.getTime();
    const expected = daysFromNow(30).getTime();
    expect(Math.abs(actual - expected)).toBeLessThan(HOUR_MS);
  });

  it('silent +30d default announced in reply after double-fail', async () => {
    callLLMReturn = '{"iso":null}';
    await db.insert(decisionCaptureState).values({
      chatId: 21n,
      stage: 'FALSIFICATION' as never,
      draft: {
        language_at_capture: 'en',
        decision_text: 'quit',
        alternatives: ['quit', 'stay'],
        reasoning: 'r',
        prediction: 'p',
        falsification_criterion: 'f',
        resolve_by_clarifier_pending: true,
        resolve_by_clarifier_fired: true,
        turn_count: 0,
        triggering_message: 'quit',
      },
    });
    const reply = await handleCapture(21n, 'dunno man, not sure');
    expect(String(reply)).toMatch(/check back in a month/i);
    const rows = await db.select().from(decisions);
    expect(rows.length).toBe(1);
    const actual = rows[0]!.resolveBy.getTime();
    const expected = daysFromNow(30).getTime();
    expect(Math.abs(actual - expected)).toBeLessThan(HOUR_MS);
  });
});
