/**
 * src/memory/__tests__/profile-prompt.test.ts — Phase 34 Plan 01 (M010-04)
 *
 * Pure-function structural tests for `assembleProfilePrompt` (the shared
 * prompt builder consumed by all 4 per-dimension generators in Plan 34-02).
 *
 * HARD CO-LOC #M10-2: this test ships in the SAME plan as the source it
 * tests (`src/memory/profile-prompt.ts`) — Plan 34-02 MUST NOT begin until
 * this test is GREEN. The structural assertions below are the contract
 * surface that prevents per-dimension prompt drift (M010-06 mitigation).
 *
 * Test discipline (per D-35 in 34-CONTEXT.md):
 *   - Parametrized over all 4 dimensions: jurisdictional / capital / health / family
 *   - Pure-function — no DB, no LLM, no mocks, no async
 *   - Asserts verbatim anchor substrings (M010-01, M010-02, M010-03, M010-06)
 *   - Mirrors `src/rituals/__tests__/weekly-review-prompt.test.ts` shape
 *
 * Run: bash scripts/test.sh src/memory/__tests__/profile-prompt.test.ts
 */

import { describe, it, expect } from 'vitest';
import { CONSTITUTIONAL_PREAMBLE } from '../../chris/personality.js';
import {
  assembleProfilePrompt,
  DO_NOT_INFER_DIRECTIVE,
  type ProfilePromptDimension,
  type ProfileSubstrateView,
  type AssembledProfilePrompt,
} from '../profile-prompt.js';

// ── Constants ───────────────────────────────────────────────────────────────

const DIMENSIONS: readonly ProfilePromptDimension[] = [
  'jurisdictional',
  'capital',
  'health',
  'family',
] as const;

// ── Fixture helper ──────────────────────────────────────────────────────────

/**
 * Default fixture: a substrate slice with 3 Pensieve entries, 1 episodic
 * summary, and 1 resolved decision. Tests override fields via spread.
 * `entryCount` defaults to 15 so the volume-weight ceiling phrasing is the
 * "fewer than 20 entries" branch (the tightest assertion path — exercises
 * the OQ-2 phrasing locked in 34-RESEARCH.md lines 854-882).
 */
function buildFixture(
  overrides?: Partial<ProfileSubstrateView>,
): ProfileSubstrateView {
  return {
    pensieveEntries: [
      {
        id: 'p1',
        epistemicTag: 'FACT',
        content: 'Moved to Tbilisi 2026-03-15; current address recorded.',
        createdAt: new Date('2026-03-15T10:00:00Z'),
      },
      {
        id: 'p2',
        epistemicTag: 'RELATIONSHIP',
        content: 'Long talk with Anna about runway; she is in Tbilisi too.',
        createdAt: new Date('2026-04-02T14:00:00Z'),
      },
      {
        id: 'p3',
        epistemicTag: 'INTENTION',
        content: 'Plan to apply for Georgian tax residency this quarter.',
        createdAt: new Date('2026-04-10T09:00:00Z'),
      },
    ],
    episodicSummaries: [
      {
        summaryDate: '2026-04-15',
        summary:
          'Quiet week in Tbilisi. Walked to the tax office; got the residency form.',
      },
    ],
    decisions: [
      {
        id: 'd1',
        resolvedAt: new Date('2026-04-20T12:00:00Z'),
        question: 'Cancel the French rental?',
        resolution: 'Yes — signed termination 2026-04-20.',
      },
    ],
    entryCount: 15,
    ...overrides,
  };
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('assembleProfilePrompt — pure prompt assembler (Phase 34 Plan 01)', () => {
  // Defense-in-depth: assert the imported CONSTITUTIONAL_PREAMBLE sentinel
  // before any dimension-parametrized assertion. Protects against accidental
  // refactor of personality.ts that would silently drop the first-section
  // anchor for all 4 dimensions (M010-06 drift detector — companion to the
  // boundary-audit grep guard in 34-VALIDATION.md row 34-01-02).
  it('sentinel — CONSTITUTIONAL_PREAMBLE imported from personality starts with the M010-06 anchor', () => {
    expect(CONSTITUTIONAL_PREAMBLE.startsWith('## Core Principles (Always Active)')).toBe(true);
  });

  // Sanity: DO_NOT_INFER_DIRECTIVE constant is non-empty and contains the
  // case-insensitive substring 'do not infer' (M010-02 mitigation anchor).
  it('sentinel — DO_NOT_INFER_DIRECTIVE constant is exported and contains "do not infer" (M010-02)', () => {
    expect(typeof DO_NOT_INFER_DIRECTIVE).toBe('string');
    expect(DO_NOT_INFER_DIRECTIVE.length).toBeGreaterThan(50);
    expect(DO_NOT_INFER_DIRECTIVE.toLowerCase()).toContain('do not infer');
  });

  // Parametrized over all 4 dimensions — every assertion below runs 4 times.
  describe.each(DIMENSIONS)('dimension=%s', (dimension) => {
    it('CONSTITUTIONAL_PREAMBLE first — system starts with "## Core Principles (Always Active)" (D-04, M010-06)', () => {
      const result: AssembledProfilePrompt = assembleProfilePrompt(
        dimension,
        buildFixture(),
        null,
        15,
      );
      expect(result.system.startsWith('## Core Principles (Always Active)')).toBe(true);
    });

    it('DO_NOT_INFER_DIRECTIVE present in assembled system for every dimension (D-05, M010-02)', () => {
      const result = assembleProfilePrompt(dimension, buildFixture(), null, 15);
      expect(result.system.includes(DO_NOT_INFER_DIRECTIVE)).toBe(true);
    });

    it('volume-weight ceiling references "data_consistency" (not "confidence") (D-06, M010-01)', () => {
      const result = assembleProfilePrompt(dimension, buildFixture(), null, 15);
      expect(result.system).toContain('data_consistency');
    });

    it('host-computes-confidence rule explicit — forbids `confidence` field in Sonnet output (D-06)', () => {
      const result = assembleProfilePrompt(dimension, buildFixture(), null, 15);
      expect(result.system).toContain('DO NOT emit a `confidence` field');
    });

    it('volume-weight band phrasing — "fewer than 20 entries" verbatim (OQ-2, M010-01)', () => {
      const result = assembleProfilePrompt(dimension, buildFixture(), null, 15);
      expect(result.system).toContain('fewer than 20 entries');
    });

    it('volume-weight ceiling value — "MUST NOT exceed 0.5" verbatim (OQ-2, M010-01)', () => {
      const result = assembleProfilePrompt(dimension, buildFixture(), null, 15);
      expect(result.system).toContain('MUST NOT exceed 0.5');
    });

    it('user prompt — exact template "Generate the operational profile for ${dimension}." (D-03)', () => {
      const result = assembleProfilePrompt(dimension, buildFixture(), null, 15);
      expect(result.user).toBe(`Generate the operational profile for ${dimension}.`);
    });

    it('prevState=null → system does NOT contain "## CURRENT PROFILE STATE" (D-07, M010-03)', () => {
      const result = assembleProfilePrompt(dimension, buildFixture(), null, 15);
      expect(result.system).not.toContain('## CURRENT PROFILE STATE');
    });

    it('prevState non-null → system DOES contain "## CURRENT PROFILE STATE" + rendered jsonb field value (D-07, M010-03)', () => {
      const prevState = { current_country: 'GE', tax_residency: 'GE' };
      const result = assembleProfilePrompt(dimension, buildFixture(), prevState, 15);
      expect(result.system).toContain('## CURRENT PROFILE STATE');
      // Rendered jsonb field value appears verbatim (JSON.stringify with 2-space indent)
      expect(result.system).toContain('"current_country": "GE"');
    });
  });

  // Refine-survives-zod-cast smoke assertion (RESEARCH.md residual risk lines
  // 938-941): the volume-weight ceiling phrasing must include both the field
  // name AND the explicit "MUST NOT exceed 0.5" string on a low-entryCount
  // substrate. This catches Sonnet-side text-prompt drift even if the v4
  // .refine() is silently dropped by the SDK cast. The harder host-side
  // assertion against .refine() behavior lives in Plan 34-02's refine.test.ts.
  it('refine-survives-zod-cast smoke — entryCount=15 fixture renders the locked OQ-2 volume-weight ceiling text', () => {
    const result = assembleProfilePrompt('jurisdictional', buildFixture(), null, 15);
    expect(result.system).toContain('data_consistency');
    expect(result.system).toContain('MUST NOT exceed 0.5');
    expect(result.system).toContain('fewer than 20 entries');
  });

  // Determinism check — pure function: same inputs → same outputs across
  // repeated calls. Belt-and-suspenders against accidental closure capture
  // of module-level mutable state.
  it('pure function — repeated calls with identical inputs produce identical outputs (D-03)', () => {
    const fixture = buildFixture();
    const a = assembleProfilePrompt('capital', fixture, null, 15);
    const b = assembleProfilePrompt('capital', fixture, null, 15);
    expect(a.system).toBe(b.system);
    expect(a.user).toBe(b.user);
  });
});
