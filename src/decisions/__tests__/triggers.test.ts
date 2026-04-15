/**
 * Phase 14 Wave 0 RED test — CAP-01 trigger detection + stakes classifier.
 *
 * Covers:
 *   - EN/FR/RU fixture parity (|EN|==|FR|==|RU|==4).
 *   - detectTriggerPhrase: positives hit, negatives miss (meta-guards).
 *   - classifyStakes: fail-closed-to-trivial on timeout/invalid JSON (D-06, D-08).
 *
 * Will fail until Wave 1 "triggers" plan lands src/decisions/triggers.ts and
 * wires Haiku via src/llm/client.ts.
 *
 * Run: npx vitest run src/decisions/__tests__/triggers.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  decisionTriggerSuppressions,
} from '../../db/schema.js';
import {
  EN_POSITIVES,
  FR_POSITIVES,
  RU_POSITIVES,
  EN_NEGATIVES,
  FR_NEGATIVES,
  RU_NEGATIVES,
} from '../triggers-fixtures.js';
// @ts-expect-error — Wave 1 creates this module
import { detectTriggerPhrase, classifyStakes } from '../triggers.js';

describe('CAP-01: trigger detection + stakes classifier', () => {
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
    vi.restoreAllMocks();
  });

  describe('fixture parity (D-03)', () => {
    it('|EN| == |FR| == |RU| == 4 in fixtures', () => {
      expect(EN_POSITIVES.length).toBe(4);
      expect(FR_POSITIVES.length).toBe(4);
      expect(RU_POSITIVES.length).toBe(4);
    });
  });

  describe('detectTriggerPhrase: positives hit per language', () => {
    it('detectTriggerPhrase matches each EN positive', () => {
      for (const p of EN_POSITIVES) {
        const hit = detectTriggerPhrase(p.positive);
        expect(hit).not.toBeNull();
        expect(hit!.toLowerCase()).toContain(p.trigger_phrase.toLowerCase());
      }
    });

    it('detectTriggerPhrase matches each FR positive', () => {
      for (const p of FR_POSITIVES) {
        const hit = detectTriggerPhrase(p.positive);
        expect(hit).not.toBeNull();
        expect(hit!.toLowerCase()).toContain(p.trigger_phrase.toLowerCase());
      }
    });

    it('detectTriggerPhrase matches each RU positive', () => {
      for (const p of RU_POSITIVES) {
        const hit = detectTriggerPhrase(p.positive);
        expect(hit).not.toBeNull();
        expect(hit!.toLowerCase()).toContain(p.trigger_phrase.toLowerCase());
      }
    });
  });

  describe('detectTriggerPhrase: negatives rejected (meta-guards D-02)', () => {
    it('detectTriggerPhrase returns null for EN negatives', () => {
      for (const n of EN_NEGATIVES) {
        expect(detectTriggerPhrase(n.text)).toBeNull();
      }
    });

    it('detectTriggerPhrase returns null for FR negatives', () => {
      for (const n of FR_NEGATIVES) {
        expect(detectTriggerPhrase(n.text)).toBeNull();
      }
    });

    it('detectTriggerPhrase returns null for RU negatives', () => {
      for (const n of RU_NEGATIVES) {
        expect(detectTriggerPhrase(n.text)).toBeNull();
      }
    });
  });

  describe('classifyStakes: Haiku-wired with fail-closed default (D-05, D-06, D-08)', () => {
    it('classifyStakes returns trivial on timeout', async () => {
      vi.mock('../../llm/client.js', async (importOriginal) => {
        const mod: Record<string, unknown> = await importOriginal();
        return {
          ...mod,
          callLLM: () => new Promise((resolve) => setTimeout(resolve, 5000)),
        };
      });
      const start = Date.now();
      const tier = await classifyStakes('I need to decide whether to move');
      const elapsed = Date.now() - start;
      expect(tier).toBe('trivial');
      expect(elapsed).toBeLessThan(3500);
    });

    it('classifyStakes returns parsed tier for valid JSON response', async () => {
      vi.mock('../../llm/client.js', async (importOriginal) => {
        const mod: Record<string, unknown> = await importOriginal();
        return {
          ...mod,
          callLLM: () => Promise.resolve('{"tier":"structural"}'),
        };
      });
      const tier = await classifyStakes("I'm thinking about quitting");
      expect(tier).toBe('structural');
    });

    it('classifyStakes fail-closes to trivial on invalid JSON', async () => {
      vi.mock('../../llm/client.js', async (importOriginal) => {
        const mod: Record<string, unknown> = await importOriginal();
        return {
          ...mod,
          callLLM: () => Promise.resolve('not valid json at all'),
        };
      });
      const tier = await classifyStakes("I'm thinking about quitting");
      expect(tier).toBe('trivial');
    });
  });
});
