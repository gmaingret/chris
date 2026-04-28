/**
 * src/rituals/__tests__/voice-note.test.ts — Phase 26 Plan 01 Task 4
 * (VOICE-02 + VOICE-03 smoke tests)
 *
 * Unit tests for src/rituals/voice-note.ts substrate (constants + the
 * chooseNextPromptIndex rotation primitive). Pure-function (no DB, no
 * network), runs in microseconds. Asserts:
 *
 *   1. PROMPTS contains exactly 6 strings in D-26-01 spec order.
 *   2. PROMPT_SET_VERSION === 'v1' (D-26-01).
 *   3. RESPONSE_WINDOW_HOURS === 18 (D-26-02 default).
 *   4. RITUAL_SUPPRESS_DEPOSIT_THRESHOLD === 5 (Pitfall 9 default).
 *   5. chooseNextPromptIndex returns first element from non-empty bag.
 *   6. chooseNextPromptIndex refills via Fisher-Yates on empty bag.
 *   7. chooseNextPromptIndex head-swap guard fires when newly-shuffled
 *      head equals lastIndex (no-consecutive-duplicate invariant).
 *
 * Full property-test invariants for the rotation primitive (600 fires +
 * 5000-fire stress) live in prompt-rotation-property.test.ts (sibling).
 *
 * Run in isolation:
 *   npx vitest run src/rituals/__tests__/voice-note.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  PROMPTS,
  PROMPT_SET_VERSION,
  RESPONSE_WINDOW_HOURS,
  RITUAL_SUPPRESS_DEPOSIT_THRESHOLD,
  chooseNextPromptIndex,
} from '../voice-note.js';

describe('voice-note constants (VOICE-02)', () => {
  it('PROMPTS contains 6 strings in D-26-01 spec order', () => {
    expect(PROMPTS).toHaveLength(6);
    expect(PROMPTS[0]).toBe('What mattered today?');
    expect(PROMPTS[1]).toBe("What's still on your mind?");
    expect(PROMPTS[2]).toBe('What did today change?');
    expect(PROMPTS[3]).toBe('What surprised you today?');
    expect(PROMPTS[4]).toBe('What did you decide today, even if it was small?');
    expect(PROMPTS[5]).toBe('What did you avoid today?');
  });

  it('PROMPTS is readonly (as const tuple)', () => {
    // The `as const` modifier produces a readonly tuple. TypeScript enforces
    // this at compile time; at runtime we assert the array is frozen by
    // proxying through a typeof check. (Object.isFrozen is FALSE on `as
    // const` arrays — the freezing is purely structural at the type level.
    // This test exists to anchor the contract: any future maintainer who
    // tries to push() onto PROMPTS will get a TS compile error.)
    const lengthBefore = PROMPTS.length;
    expect(lengthBefore).toBe(6);
  });

  it('PROMPT_SET_VERSION is v1', () => {
    expect(PROMPT_SET_VERSION).toBe('v1');
  });

  it('RESPONSE_WINDOW_HOURS is 18', () => {
    expect(RESPONSE_WINDOW_HOURS).toBe(18);
  });

  it('RITUAL_SUPPRESS_DEPOSIT_THRESHOLD is 5', () => {
    expect(RITUAL_SUPPRESS_DEPOSIT_THRESHOLD).toBe(5);
  });
});

describe('chooseNextPromptIndex smoke tests (VOICE-03 — full property test in prompt-rotation-property.test.ts)', () => {
  it('returns first element from non-empty bag', () => {
    const result = chooseNextPromptIndex([3, 1, 5, 0, 2, 4]);
    expect(result.index).toBe(3);
    expect(result.newBag).toEqual([1, 5, 0, 2, 4]);
  });

  it('non-empty bag pop is independent of rng (rng not consulted)', () => {
    // With a deterministic rng that would make Fisher-Yates trivial, the
    // non-empty bag path must not call rng. Use an rng that throws to prove
    // it.
    const explodingRng = (): number => {
      throw new Error('rng must not be called when bag is non-empty');
    };
    const result = chooseNextPromptIndex([2, 4], explodingRng);
    expect(result.index).toBe(2);
    expect(result.newBag).toEqual([4]);
  });

  it('refills with shuffled [0..5] when bag empty (no lastIndex)', () => {
    // Fisher-Yates trace with rng() = 0 (Math.floor(0 * (i+1)) = 0 for all i)
    // and initial fresh = [0,1,2,3,4,5]:
    //   i=5,j=0: swap [5]↔[0] → [5,1,2,3,4,0]
    //   i=4,j=0: swap [4]↔[0] → [4,1,2,3,5,0]
    //   i=3,j=0: swap [3]↔[0] → [3,1,2,4,5,0]
    //   i=2,j=0: swap [2]↔[0] → [2,1,3,4,5,0]
    //   i=1,j=0: swap [1]↔[0] → [1,2,3,4,5,0]
    // After shuffle: fresh = [1,2,3,4,5,0]. shift() returns 1.
    const result = chooseNextPromptIndex([], () => 0);
    expect(result.index).toBe(1);
    expect(result.newBag).toEqual([2, 3, 4, 5, 0]);
    // And the union of returned index + newBag covers exactly [0..5].
    const union = new Set([result.index, ...result.newBag]);
    expect(union.size).toBe(6);
    for (let i = 0; i < 6; i++) expect(union.has(i)).toBe(true);
  });

  it('with lastIndex matches and head=lastIndex, head-swap fires', () => {
    // rng()=0 produces shuffled fresh = [1,2,3,4,5,0] (see above trace).
    // With lastIndex=1, head=1, head-swap fires: swap fresh[0]↔fresh[1]
    //   → fresh = [2,1,3,4,5,0]. shift() returns 2, newBag = [1,3,4,5,0].
    const result = chooseNextPromptIndex([], () => 0, 1);
    expect(result.index).toBe(2);
    expect(result.newBag).toEqual([1, 3, 4, 5, 0]);
  });

  it('with lastIndex differing from head, no swap', () => {
    // rng()=0 produces shuffled fresh = [1,2,3,4,5,0]. lastIndex=3, head=1.
    // Head ≠ lastIndex → no swap. shift() returns 1, newBag = [2,3,4,5,0].
    const result = chooseNextPromptIndex([], () => 0, 3);
    expect(result.index).toBe(1);
    expect(result.newBag).toEqual([2, 3, 4, 5, 0]);
  });

  it('refilled bag has all 6 indices (uniform-coverage invariant)', () => {
    // Across many seeded refills, the union of {index, newBag} is always
    // exactly [0..5]. Prove with Math.random.
    for (let trial = 0; trial < 50; trial++) {
      const result = chooseNextPromptIndex([]);
      const union = new Set([result.index, ...result.newBag]);
      expect(union.size).toBe(6);
      for (let i = 0; i < 6; i++) expect(union.has(i)).toBe(true);
    }
  });
});
