/**
 * src/__tests__/fixtures/seed.test.ts — Phase 24 Plan 01
 *
 * Unit tests for the seeded-shuffle helper (Mulberry32 + Fisher-Yates).
 *
 * Critical invariants enforced by SYNTH-07 ("same seed + same organic base
 * produces byte-identical non-LLM output"): determinism across invocations,
 * seed-sensitivity (different seed → different output), and non-mutation of
 * input arrays.
 */
import { describe, it, expect } from 'vitest';
import { mulberry32, seededShuffle, seededSample } from './seed.js';

describe('mulberry32', () => {
  it('returns an RNG function', () => {
    const rng = mulberry32(42);
    expect(typeof rng).toBe('function');
  });

  it('produces identical output sequences across fresh invocations with the same seed', () => {
    const rngA = mulberry32(42);
    const rngB = mulberry32(42);
    const seqA = [rngA(), rngA(), rngA(), rngA(), rngA()];
    const seqB = [rngB(), rngB(), rngB(), rngB(), rngB()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different output for different seeds', () => {
    const rngA = mulberry32(42);
    const rngB = mulberry32(43);
    expect(rngA()).not.toBe(rngB());
  });

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(12345);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('seededShuffle', () => {
  it('returns the SAME permutation across invocations with the same seed (byte-identical per SYNTH-07)', () => {
    const input = [1, 2, 3, 4, 5];
    const a = seededShuffle(input, 42);
    const b = seededShuffle(input, 42);
    expect(a).toEqual(b);
  });

  it('returns a different permutation when seed differs', () => {
    const input = [1, 2, 3, 4, 5];
    const a = seededShuffle(input, 42);
    const b = seededShuffle(input, 43);
    // With only 120 permutations of 5 elements and two different seeds, it is
    // theoretically possible but astronomically unlikely they collide. A hash
    // of the two arrays would be stronger, but for the scope of this test a
    // direct inequality is sufficient — if this ever flakes, tighten the seed.
    expect(a).not.toEqual(b);
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];
    seededShuffle(input, 42);
    expect(input).toEqual(snapshot);
  });

  it('returns a new array (reference-distinct from input)', () => {
    const input = [1, 2, 3, 4, 5];
    const out = seededShuffle(input, 42);
    expect(out).not.toBe(input);
  });

  it('preserves every element of the input (permutation invariant)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const out = seededShuffle(input, 42);
    expect(out.slice().sort((x, y) => x - y)).toEqual(input);
  });

  it('handles empty arrays', () => {
    expect(seededShuffle([], 42)).toEqual([]);
  });

  it('handles single-element arrays', () => {
    expect(seededShuffle([7], 42)).toEqual([7]);
  });

  it('works with string arrays', () => {
    const input = ['a', 'b', 'c', 'd', 'e'];
    const a = seededShuffle(input, 42);
    const b = seededShuffle(input, 42);
    expect(a).toEqual(b);
    expect(a.slice().sort()).toEqual(input.slice().sort());
  });
});

describe('seededSample', () => {
  it('returns the first n elements of seededShuffle(arr, seed)', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = seededShuffle(input, 42);
    const sample = seededSample(input, 3, 42);
    expect(sample).toEqual(shuffled.slice(0, 3));
  });

  it('is deterministic given the same seed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(seededSample(input, 3, 42)).toEqual(seededSample(input, 3, 42));
  });

  it('returns n elements when n <= length', () => {
    const input = [1, 2, 3, 4, 5];
    expect(seededSample(input, 3, 42)).toHaveLength(3);
  });

  it('returns all elements when n >= length (no padding, no error)', () => {
    const input = [1, 2, 3];
    const sample = seededSample(input, 10, 42);
    expect(sample).toHaveLength(3);
    expect(sample.slice().sort()).toEqual(input);
  });
});
