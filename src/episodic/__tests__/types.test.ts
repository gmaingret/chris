/**
 * Phase 20 Plan 03 — EPI-03 Zod unit tests for src/episodic/types.ts.
 *
 * Verifies the three-layer Zod schema chain (CONTEXT.md D-11) and its bounds
 * (D-12):
 *   - Valid Sonnet output parses (layer 1 happy path)
 *   - Invalid importance (0 / 11 / "high") throws (D-07 + D-12 bounds)
 *   - Empty topics array throws (.min(1) per D-12)
 *   - Missing required field throws ZodError
 *   - parseEpisodicSummary returns a typed EpisodicSummaryInsert (layer 2)
 *   - ROADMAP Phase 20 Success Criterion #3: EpisodicSummaryInsertSchema.parse({}) throws
 *
 * Pure schema-parse — no Docker DB. Integration tests live in schema.test.ts.
 *
 * Run: npx vitest run src/episodic/__tests__/types.test.ts
 */

import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import {
  EpisodicSummaryInsertSchema,
  EpisodicSummarySonnetOutputSchema,
  parseEpisodicSummary,
  type EpisodicSummaryInsert,
} from '../types.js';

// ── Shared constants ────────────────────────────────────────────────────────

/** Meets EpisodicSummarySonnetOutputSchema summary min(50). */
const LONG_SUMMARY =
  'A reflective day of focused work on the project, balanced with rest and time spent with family in the evening.';

/** Valid uuid literal for source_entry_ids tests. */
const UUID_A = '550e8400-e29b-41d4-a716-446655440000';

/** Factory for a valid SonnetOutput-shape input; override fields to probe bounds. */
function makeSonnetOutput(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    summary: LONG_SUMMARY,
    importance: 5,
    topics: ['work', 'family'],
    emotional_arc: 'focused but tired',
    key_quotes: ['I felt more settled today than I have in weeks.'],
    ...overrides,
  };
}

/** Factory for a valid Insert-shape input (SonnetOutput + engine-supplied fields). */
function makeInsert(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    ...makeSonnetOutput(),
    summary_date: new Date('2026-04-15'),
    source_entry_ids: [UUID_A],
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// Layer 1: EpisodicSummarySonnetOutputSchema
// ════════════════════════════════════════════════════════════════════════════

describe('EpisodicSummarySonnetOutputSchema', () => {
  it('parses a valid Sonnet output into a typed object', () => {
    const parsed = EpisodicSummarySonnetOutputSchema.parse(makeSonnetOutput());

    expect(parsed.summary).toBe(LONG_SUMMARY);
    expect(parsed.importance).toBe(5);
    expect(parsed.topics).toEqual(['work', 'family']);
    expect(parsed.emotional_arc).toBe('focused but tired');
    expect(parsed.key_quotes).toHaveLength(1);
  });

  it('throws on invalid importance values (0, 11, "high")', () => {
    // D-12: importance integer in [1, 10]; D-07: mirrors DB CHECK.
    expect(() =>
      EpisodicSummarySonnetOutputSchema.parse(makeSonnetOutput({ importance: 0 })),
    ).toThrow(ZodError);
    expect(() =>
      EpisodicSummarySonnetOutputSchema.parse(makeSonnetOutput({ importance: 11 })),
    ).toThrow(ZodError);
    expect(() =>
      EpisodicSummarySonnetOutputSchema.parse(makeSonnetOutput({ importance: 'high' })),
    ).toThrow(ZodError);
  });

  it('throws when topics: [] (must have at least 1)', () => {
    // D-12: topics .min(1) — catches topic-less hallucinations.
    expect(() =>
      EpisodicSummarySonnetOutputSchema.parse(makeSonnetOutput({ topics: [] })),
    ).toThrow(ZodError);
  });

  it('throws when required `summary` is missing', () => {
    const input = makeSonnetOutput();
    delete (input as { summary?: unknown }).summary;
    expect(() => EpisodicSummarySonnetOutputSchema.parse(input)).toThrow(ZodError);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Layer 2: EpisodicSummaryInsertSchema + parseEpisodicSummary helper
// ════════════════════════════════════════════════════════════════════════════

describe('EpisodicSummaryInsertSchema + parseEpisodicSummary', () => {
  it('parseEpisodicSummary returns a typed EpisodicSummaryInsert for a valid input', () => {
    const parsed: EpisodicSummaryInsert = parseEpisodicSummary(makeInsert());

    expect(parsed.summary_date).toBeInstanceOf(Date);
    expect(parsed.source_entry_ids[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // Sanity: inherited fields from layer 1 also round-trip.
    expect(parsed.summary).toBe(LONG_SUMMARY);
    expect(parsed.importance).toBe(5);
  });

  it('ROADMAP Phase 20 Success Criterion #3: EpisodicSummaryInsertSchema.parse({}) throws', () => {
    // This is the exact bar from ROADMAP.md Phase 20 §Success Criteria #3 —
    // the empty-object parse must throw to confirm the Zod schema is live.
    expect(() => EpisodicSummaryInsertSchema.parse({})).toThrow(ZodError);
  });
});
