/**
 * src/memory/profiles/__tests__/refine.test.ts — Phase 34 Plan 02 Task 4
 *
 * Closure-capture regression detector for the volume-weight ceiling Zod
 * `.refine()` overlay (D-32; M010-01 mitigation). The refine MUST be
 * constructed INSIDE the generator function body — RESEARCH.md lines 938-941
 * documents that a module-scope refined-schema constant would silently
 * capture an undefined or stale `entryCount` and never trigger.
 *
 * This is a PURE unit test. No DB, no LLM, no mocks. Runs in microseconds.
 * The test reconstructs the closure-captured refine in-test (same shape as
 * `runProfileGenerator` in src/memory/profiles/shared.ts) and verifies the
 * 4-quadrant truth table for the rejection rule:
 *
 *     entryCount < 20 && data_consistency > 0.5 → REJECT
 *     entryCount < 20 && data_consistency <= 0.5 → ACCEPT
 *     entryCount >= 20 && data_consistency > 0.5 → ACCEPT
 *     entryCount >= 20 && data_consistency <= 0.5 → ACCEPT
 *
 * Future Zod v4 .refine() semantics drift will surface as RED in this test
 * BEFORE shipping to prod.
 */
import { describe, it, expect } from 'vitest';
import { z as z4 } from 'zod/v4';
import { JurisdictionalProfileSchemaV4 } from '../schemas.js';

// ── Closure-captured refine builder (mirrors shared.ts runProfileGenerator) ──

/**
 * Build the closure-captured refined v4 schema. This is the EXACT shape
 * `runProfileGenerator` constructs at runtime — keep the closure shape
 * synchronized so this test catches drift in the production refine.
 */
function buildRefinedSchema(entryCount: number): z4.ZodType {
  return JurisdictionalProfileSchemaV4.refine(
    (out: { data_consistency: number }) =>
      !(out.data_consistency > 0.5 && entryCount < 20),
    {
      message:
        'M010-01 volume-weight ceiling: data_consistency > 0.5 requires entryCount >= 20',
    },
  );
}

// ── Test fixture: all-other-fields-valid jurisdictional output ──────────────

/**
 * A jurisdictional profile output that satisfies every field of
 * JurisdictionalProfileSchemaV4 EXCEPT `data_consistency` (varied per test).
 * Use this so refine — and only the refine — is what causes parse failure.
 */
function validJurisdictionalFields(dataConsistency: number) {
  return {
    current_country: 'Russia',
    physical_location: 'Saint Petersburg',
    residency_status: [
      { type: 'permanent_residency', value: 'Panama' },
    ],
    tax_residency: null,
    active_legal_entities: [
      { name: 'MAINGRET LLC', jurisdiction: 'New Mexico, USA' },
    ],
    next_planned_move: { destination: 'Batumi, Georgia', from_date: '2026-04-28' },
    planned_move_date: '2026-04-28',
    passport_citizenships: ['French'],
    data_consistency: dataConsistency,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Volume-weight ceiling closure-captured refine (D-32 / M010-01)', () => {
  it('REJECT: data_consistency=0.7 with entryCount=15 (inflation case)', () => {
    const schema = buildRefinedSchema(15);
    const result = schema.safeParse(validJurisdictionalFields(0.7));
    expect(result.success).toBe(false);
  });

  it('ACCEPT: data_consistency=0.7 with entryCount=25 (band 2 — no ceiling)', () => {
    const schema = buildRefinedSchema(25);
    const result = schema.safeParse(validJurisdictionalFields(0.7));
    expect(result.success).toBe(true);
  });

  it('ACCEPT: data_consistency=0.5 with entryCount=15 (at-ceiling — NOT > 0.5)', () => {
    const schema = buildRefinedSchema(15);
    const result = schema.safeParse(validJurisdictionalFields(0.5));
    expect(result.success).toBe(true);
  });

  it('ACCEPT: data_consistency=0.3 with entryCount=15 (well below ceiling)', () => {
    const schema = buildRefinedSchema(15);
    const result = schema.safeParse(validJurisdictionalFields(0.3));
    expect(result.success).toBe(true);
  });

  it('REJECT: verbatim M010-01 message present in error', () => {
    const schema = buildRefinedSchema(15);
    const result = schema.safeParse(validJurisdictionalFields(0.7));
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' | ');
      expect(messages).toContain('M010-01 volume-weight ceiling');
    }
  });

  it('Closure-capture sanity: different entryCount values yield independent schemas', () => {
    // Build two refined schemas with different captured entryCount values.
    // The same input parses ACCEPT against entryCount=30 and REJECT against
    // entryCount=10 — proves the closure captures entryCount correctly.
    const refinedLow = buildRefinedSchema(10);
    const refinedHigh = buildRefinedSchema(30);
    const input = validJurisdictionalFields(0.7);
    expect(refinedLow.safeParse(input).success).toBe(false);
    expect(refinedHigh.safeParse(input).success).toBe(true);
  });

  it('Boundary: data_consistency=0.5 exactly (NOT > 0.5) with entryCount=15 → ACCEPT', () => {
    // !(0.5 > 0.5) is true → accept regardless of entryCount
    const schema = buildRefinedSchema(15);
    expect(schema.safeParse(validJurisdictionalFields(0.5)).success).toBe(true);
  });

  it('Boundary: entryCount=20 exactly (NOT < 20) with data_consistency=0.7 → ACCEPT', () => {
    // !(20 < 20) is true → accept regardless of data_consistency
    const schema = buildRefinedSchema(20);
    expect(schema.safeParse(validJurisdictionalFields(0.7)).success).toBe(true);
  });
});
