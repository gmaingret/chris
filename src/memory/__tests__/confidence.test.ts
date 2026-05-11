/**
 * src/memory/__tests__/confidence.test.ts — Phase 33 Plan 33-02 Task 1
 *                                            (PROF substrate; D-19)
 *
 * Pure-function unit tests for src/memory/confidence.ts. Algorithm of
 * record: STACK.md §5 (33-RESEARCH.md "Pure-function confidence helpers"
 * lines 633-675).
 *
 * No DB, no LLM, no mocks. Runs in microseconds.
 *
 * Run in isolation:
 *   npx vitest run src/memory/__tests__/confidence.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
  computeProfileConfidence,
  isAboveThreshold,
  MIN_ENTRIES_THRESHOLD,
  SATURATION,
} from '../confidence.js';

describe('confidence constants', () => {
  it('MIN_ENTRIES_THRESHOLD is 10', () => {
    expect(MIN_ENTRIES_THRESHOLD).toBe(10);
  });

  it('SATURATION is 50', () => {
    expect(SATURATION).toBe(50);
  });
});

describe('computeProfileConfidence — boundary table', () => {
  it('(0, 0) returns 0 (below threshold + no consistency)', () => {
    expect(computeProfileConfidence(0, 0)).toBe(0);
  });

  it('(9, 1.0) returns 0 (still below threshold even with perfect consistency)', () => {
    expect(computeProfileConfidence(9, 1.0)).toBe(0);
  });

  it('(10, 1.0) returns 0.3 (just-at-threshold; volumeScore=0; base 0.3 + 0.7*0*1.0)', () => {
    // (entryCount - 10) / (50 - 10) = 0/40 = 0 → volumeScore = 0
    // return round((0.3 + 0.7 * 0 * 1.0) * 100) / 100 = 0.3
    expect(computeProfileConfidence(10, 1.0)).toBe(0.3);
  });

  it('(50, 1.0) returns 1.0 (saturation)', () => {
    // (50 - 10) / 40 = 1.0 → volumeScore = 1.0
    // return round((0.3 + 0.7 * 1.0 * 1.0) * 100) / 100 = 1.0
    expect(computeProfileConfidence(50, 1.0)).toBe(1.0);
  });

  it('(50, 0.5) returns 0.65 (saturation × half-consistency)', () => {
    // (50 - 10) / 40 = 1.0; 0.3 + 0.7 * 1.0 * 0.5 = 0.65
    expect(computeProfileConfidence(50, 0.5)).toBe(0.65);
  });

  it('(100, 1.0) returns 1.0 (capped above saturation via Math.min)', () => {
    // (100 - 10) / 40 = 2.25 → Math.min(1.0, 2.25) = 1.0 → return 1.0
    expect(computeProfileConfidence(100, 1.0)).toBe(1.0);
  });

  it('(30, 1.0) returns ~0.65 (halfway through saturation curve)', () => {
    // (30 - 10) / 40 = 0.5 → volumeScore = 0.5
    // 0.3 + 0.7 * 0.5 * 1.0 = 0.65
    expect(computeProfileConfidence(30, 1.0)).toBe(0.65);
  });

  it('(50, 0) returns 0.3 (saturation but no consistency — D-10 seed reproduction)', () => {
    // 0.3 + 0.7 * 1.0 * 0 = 0.3 — this is why seed rows store data_consistency=0
    expect(computeProfileConfidence(50, 0)).toBe(0.3);
  });
});

describe('isAboveThreshold — edge cases', () => {
  it('(9) returns false (one below threshold)', () => {
    expect(isAboveThreshold(9)).toBe(false);
  });

  it('(10) returns true (at threshold — gte not lt; M009 lt→lte lesson)', () => {
    expect(isAboveThreshold(10)).toBe(true);
  });

  it('(0) returns false', () => {
    expect(isAboveThreshold(0)).toBe(false);
  });

  it('(MIN_ENTRIES_THRESHOLD - 1) returns false', () => {
    expect(isAboveThreshold(MIN_ENTRIES_THRESHOLD - 1)).toBe(false);
  });

  it('(MIN_ENTRIES_THRESHOLD) returns true', () => {
    expect(isAboveThreshold(MIN_ENTRIES_THRESHOLD)).toBe(true);
  });
});
