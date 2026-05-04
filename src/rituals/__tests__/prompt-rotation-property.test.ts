/**
 * src/rituals/__tests__/prompt-rotation-property.test.ts — Phase 26 Plan 01
 * Task 4 (VOICE-03 property test — Pitfall 7 mitigation)
 *
 * Empirical proof that chooseNextPromptIndex satisfies the three VOICE-03
 * invariants under Math.random across many simulated fires:
 *
 *   (a) DISTRIBUTION — uniform within ±20% of the expected count for each
 *       prompt (so the rotation cannot get stuck on a subset of prompts).
 *   (b) NO CONSECUTIVE DUPLICATES — every fire's index differs from the
 *       previous fire's index. The head-swap guard at cycle-boundary refill
 *       makes this deterministic, not probabilistic.
 *   (c) MAX GAP — between any two appearances of the same prompt index, no
 *       more than 11 fires elapse (worst-case = bag emptied just before
 *       prompt X is the last one used → next bag's first 5 picks could
 *       skip X → at most 6 + 5 = 11 fires before X reappears).
 *
 * The 600-fire simulation is the canonical Pitfall 7 contract; the
 * 5000-fire variant is a stress check that confirms uniform distribution
 * holds at scale (within ±15% — tighter bound because larger sample).
 *
 * Run in isolation:
 *   npx vitest run src/rituals/__tests__/prompt-rotation-property.test.ts
 */
import { describe, it, expect } from 'vitest';
import { chooseNextPromptIndex, PROMPTS } from '../journal.js';

describe('chooseNextPromptIndex shuffled-bag invariants (VOICE-03)', () => {
  it('600 fires produce uniform distribution + no consecutive dupes + max-gap <= 11', () => {
    let bag: number[] = [];
    let lastIdx: number | undefined = undefined;
    const fires: number[] = [];

    for (let i = 0; i < 600; i++) {
      const r = chooseNextPromptIndex(bag, Math.random, lastIdx);
      fires.push(r.index);
      bag = r.newBag;
      lastIdx = r.index;
    }

    // (a) Distribution within ±20% of expected 100 fires/prompt (so 80..120).
    const counts = [0, 0, 0, 0, 0, 0];
    for (const i of fires) counts[i]!++;
    for (let p = 0; p < PROMPTS.length; p++) {
      expect(counts[p]).toBeGreaterThanOrEqual(80);
      expect(counts[p]).toBeLessThanOrEqual(120);
    }

    // (b) No consecutive duplicates (deterministic with head-swap guard).
    for (let i = 1; i < fires.length; i++) {
      expect(fires[i]).not.toEqual(fires[i - 1]);
    }

    // (c) Max gap between two appearances of any prompt <= 11 fires.
    const lastSeen: Record<number, number> = {};
    let maxGap = 0;
    for (let i = 0; i < fires.length; i++) {
      const idx = fires[i]!;
      if (lastSeen[idx] !== undefined) {
        maxGap = Math.max(maxGap, i - lastSeen[idx]!);
      }
      lastSeen[idx] = i;
    }
    expect(maxGap).toBeLessThanOrEqual(11);
  });

  it('5000 fires for stress check — distribution stays uniform (±15%)', () => {
    let bag: number[] = [];
    let lastIdx: number | undefined = undefined;
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 5000; i++) {
      const r = chooseNextPromptIndex(bag, Math.random, lastIdx);
      counts[r.index]!++;
      bag = r.newBag;
      lastIdx = r.index;
    }
    // Expected ≈ 833 fires per prompt; ±15% is 708..958.
    for (let p = 0; p < PROMPTS.length; p++) {
      expect(counts[p]).toBeGreaterThanOrEqual(708);
      expect(counts[p]).toBeLessThanOrEqual(958);
    }
  });
});
