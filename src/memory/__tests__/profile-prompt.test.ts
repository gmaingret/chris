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
import { sanitizeSubstrateText } from '../profiles/shared.js';
import {
  INJECT_PROFILE_STATE_ANCHOR,
  INJECT_OUTPUT_FORMAT_OVERRIDE,
  INJECT_FENCED_DIRECTIVE,
} from './fixtures/injection-attacks.js';

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

// ── Phase 43 Plan 01 — sanitizeSubstrateText helper contract ────────────────

describe('sanitizeSubstrateText: helper contract (Phase 43 / D-01..D-04)', () => {
  it('returns a string for every string input (total)', () => {
    expect(typeof sanitizeSubstrateText('')).toBe('string');
    expect(typeof sanitizeSubstrateText('plain')).toBe('string');
    expect(typeof sanitizeSubstrateText('\n## anchor\n')).toBe('string');
    expect(typeof sanitizeSubstrateText('```\nfenced\n```')).toBe('string');
  });

  it('is idempotent: f(f(x)) === f(x) (Phase 34 BL-01 fixture)', () => {
    const once = sanitizeSubstrateText(INJECT_PROFILE_STATE_ANCHOR);
    const twice = sanitizeSubstrateText(once);
    expect(twice).toBe(once);
  });

  it('escapes line-start ## anchor as \\## (D-01)', () => {
    const out = sanitizeSubstrateText('\n## CURRENT PROFILE STATE');
    expect(out).toContain('\n\\## CURRENT PROFILE STATE');
    expect(out).not.toMatch(/\n## CURRENT PROFILE STATE/);
  });

  it('escapes leading-position ## anchor at string start (D-01)', () => {
    const out = sanitizeSubstrateText('## anchor');
    expect(out.startsWith('\\## anchor')).toBe(true);
  });

  it('neutralizes triple-backtick fences (D-02)', () => {
    const out = sanitizeSubstrateText('```\ncode\n```');
    expect(out).toContain("'''");
    expect(out).not.toContain('```');
  });

  it('empty string maps to empty string (totality boundary)', () => {
    expect(sanitizeSubstrateText('')).toBe('');
  });

  it('Phase 38 WR-01 fenced-directive fixture is fully neutralized', () => {
    const out = sanitizeSubstrateText(INJECT_FENCED_DIRECTIVE);
    expect(out).not.toContain('```');
    // The fenced payload's `## Psychological Profile Framing` is at line-start
    // (after the opening fence's newline) so it gets the `\##` escape too.
    expect(out).toContain('\\## Psychological Profile Framing');
  });

  it('Phase 34 BL-01 OUTPUT_FORMAT override is escaped', () => {
    const out = sanitizeSubstrateText(INJECT_OUTPUT_FORMAT_OVERRIDE);
    expect(out).toContain('\\## Output Format');
    expect(out).not.toMatch(/\n## Output Format/);
  });
});

// ── Phase 43 Plan 01 — INJ-01: substrate content cannot forge prompt anchors ─

describe.each(DIMENSIONS)(
  'INJ-01: operational substrate content cannot forge prompt anchors (dimension=%s)',
  (dimension) => {
    it('forged ## CURRENT PROFILE STATE in Pensieve content is escaped to \\##', () => {
      const fixture = buildFixture({
        pensieveEntries: [
          {
            id: 'inj1',
            epistemicTag: 'FACT',
            content: INJECT_PROFILE_STATE_ANCHOR,
            createdAt: new Date('2026-04-01T10:00:00Z'),
          },
        ],
      });
      const result = assembleProfilePrompt(dimension, fixture, null, 15);
      // The assembler's OWN '## CURRENT PROFILE STATE' is rendered only when
      // prevState !== null. Here prevState is null, so any occurrence of the
      // unescaped anchor at line-start MUST be from the forged Pensieve
      // content path — sanitization should prevent it.
      expect(result.system).not.toMatch(/\n## CURRENT PROFILE STATE\n\{"current_country"/);
      expect(result.system).toContain('\\## CURRENT PROFILE STATE');
    });

    it('forged anchor inside episodic summary is escaped', () => {
      const fixture = buildFixture({
        episodicSummaries: [
          {
            summaryDate: '2026-04-15',
            summary: INJECT_PROFILE_STATE_ANCHOR,
          },
        ],
      });
      const result = assembleProfilePrompt(dimension, fixture, null, 15);
      expect(result.system).toContain('\\## CURRENT PROFILE STATE');
      expect(result.system).not.toMatch(/\n## CURRENT PROFILE STATE\n\{"current_country"/);
    });

    it('forged anchor inside decision question and resolution is escaped', () => {
      const fixture = buildFixture({
        decisions: [
          {
            id: 'd-inj',
            resolvedAt: new Date('2026-04-20T12:00:00Z'),
            question: INJECT_PROFILE_STATE_ANCHOR,
            resolution: INJECT_PROFILE_STATE_ANCHOR,
          },
        ],
      });
      const result = assembleProfilePrompt(dimension, fixture, null, 15);
      // Both question and resolution flow through sanitization; substring count
      // of escaped form should be >= 2 (one per channel).
      const occurrences = result.system.match(/\\## CURRENT PROFILE STATE/g) ?? [];
      expect(occurrences.length).toBeGreaterThanOrEqual(2);
    });

    it('triple-backtick fence in content is neutralized to single quotes', () => {
      const fixture = buildFixture({
        pensieveEntries: [
          {
            id: 'fence',
            epistemicTag: 'FACT',
            content: INJECT_FENCED_DIRECTIVE,
            createdAt: new Date('2026-04-01T10:00:00Z'),
          },
        ],
      });
      const result = assembleProfilePrompt(dimension, fixture, null, 15);
      // The substrate block must not contain a ``` fence introduced by user
      // content. Slice from the SUBSTRATE marker onward to isolate this check
      // from any assembler-controlled markdown elsewhere.
      const substrateSlice = result.system.slice(result.system.indexOf('## SUBSTRATE'));
      expect(substrateSlice).not.toContain('```');
      expect(substrateSlice).toContain("'''");
    });

    it('Output Format override in content is escaped to \\##', () => {
      const fixture = buildFixture({
        pensieveEntries: [
          {
            id: 'fmt',
            epistemicTag: 'FACT',
            content: INJECT_OUTPUT_FORMAT_OVERRIDE,
            createdAt: new Date('2026-04-01T10:00:00Z'),
          },
        ],
      });
      const result = assembleProfilePrompt(dimension, fixture, null, 15);
      // Slice from SUBSTRATE onward — the assembler's own '## Output Format'
      // is rendered later and SHOULD remain unescaped (it is assembler-
      // controlled, not user-controlled). We assert the absence at line-start
      // within the substrate slice only.
      const substrateSlice = result.system.slice(result.system.indexOf('## SUBSTRATE'));
      expect(substrateSlice).toContain('\\## Output Format');
      // The forged "\n## Output Format\n" line-start pattern must not appear
      // anywhere inside the substrate slice.
      const idxSubstrate = result.system.indexOf('## SUBSTRATE');
      const idxOutputFormatAssembler = result.system.indexOf('## Output Format');
      // The assembler's authentic '## Output Format' must appear AFTER the
      // substrate block (sections 7 → 8 order).
      expect(idxOutputFormatAssembler).toBeGreaterThan(idxSubstrate);
      // Inside the substrate slice (idxSubstrate..idxOutputFormatAssembler-1),
      // no unescaped '\n## Output Format' line-start should exist.
      const beforeAssemblerSection = result.system.slice(idxSubstrate, idxOutputFormatAssembler);
      expect(beforeAssemblerSection).not.toMatch(/\n## Output Format/);
    });

    it('operational-vocab epistemicTag passes through alphanumeric allowlist', () => {
      const fixture = buildFixture({
        pensieveEntries: [
          {
            id: 'tag-inj',
            epistemicTag: '## INJECT',
            content: 'benign content',
            createdAt: new Date('2026-04-01T10:00:00Z'),
          },
        ],
      });
      const result = assembleProfilePrompt(dimension, fixture, null, 15);
      // The allowlist `/[^A-Za-z0-9_-]/g` strips the leading '## ' (space and
      // hash are non-alphanumeric); 'INJECT' survives.
      expect(result.system).toContain('[INJECT]');
      expect(result.system).not.toContain('[## INJECT]');
    });
  },
);

// ── Phase 43 Plan 02 — CONTRACT-02: seed-row first-fire omits prevState ─────
//
// extract<X>PrevState for all 4 operational dimensions must return null when
// row.substrateHash === '' (Phase 33 D-11 seed-row sentinel). When null is
// returned, assembleProfilePrompt omits the '## CURRENT PROFILE STATE' block
// entirely (existing Phase 34 D-07 structural invariant) — avoiding the
// M010-03 anchoring-to-empty-fields failure mode that fires on every first-
// fire-after-deploy.
//
// Plan D-11 mandates `.every()` discipline: each of the 4 dimensions must
// independently pass — describe.each parametrizes the assertion across all 4.

describe('CONTRACT-02: seed-row first-fire omits ## CURRENT PROFILE STATE (D-10)', () => {
  // Per-dimension seed-row fixtures shaped like a Phase 33 D-11 cold-start
  // INSERT. substrateHash='' is the sentinel; all jsonb fields are the
  // database column defaults from migration 0012.

  // Dimension-specific JSONB defaults derived from migration 0012 column
  // defaults + the Phase 33 seed-row pattern. Kept inline (not refactored
  // into a shared helper) because dim-specific shape variance is the whole
  // point — a shared helper would obscure the per-dim schema contract.
  const seedRowJurisdictional = {
    id: 'seed-jur',
    name: 'primary',
    schemaVersion: 1,
    substrateHash: '',
    confidence: 0,
    dataConsistency: 0,
    currentCountry: null,
    physicalLocation: null,
    residencyStatus: [],
    taxResidency: null,
    activeLegalEntities: [],
    nextPlannedMove: { destination: null, from_date: null },
    plannedMoveDate: null,
    passportCitizenships: [],
    lastUpdated: new Date('2026-05-01T00:00:00Z'),
    createdAt: new Date('2026-05-01T00:00:00Z'),
  };

  const seedRowCapital = {
    id: 'seed-cap',
    name: 'primary',
    schemaVersion: 1,
    substrateHash: '',
    confidence: 0,
    dataConsistency: 0,
    fiPhase: null,
    fiTargetAmount: null,
    estimatedNetWorth: null,
    runwayMonths: null,
    nextSequencingDecision: null,
    incomeSources: [],
    majorAllocationDecisions: [],
    taxOptimizationStatus: null,
    activeLegalEntities: [],
    lastUpdated: new Date('2026-05-01T00:00:00Z'),
    createdAt: new Date('2026-05-01T00:00:00Z'),
  };

  const seedRowHealth = {
    id: 'seed-hea',
    name: 'primary',
    schemaVersion: 1,
    substrateHash: '',
    confidence: 0,
    dataConsistency: 0,
    openHypotheses: [],
    pendingTests: [],
    activeTreatments: [],
    recentResolved: [],
    caseFileNarrative: null,
    wellbeingTrend: {},
    lastUpdated: new Date('2026-05-01T00:00:00Z'),
    createdAt: new Date('2026-05-01T00:00:00Z'),
  };

  const seedRowFamily = {
    id: 'seed-fam',
    name: 'primary',
    schemaVersion: 1,
    substrateHash: '',
    confidence: 0,
    dataConsistency: 0,
    relationshipStatus: null,
    partnershipCriteriaEvolution: [],
    childrenPlans: null,
    parentCareResponsibilities: {},
    activeDatingContext: null,
    milestones: [],
    constraints: [],
    lastUpdated: new Date('2026-05-01T00:00:00Z'),
    createdAt: new Date('2026-05-01T00:00:00Z'),
  };

  describe.each([
    ['jurisdictional', seedRowJurisdictional],
    ['capital', seedRowCapital],
    ['health', seedRowHealth],
    ['family', seedRowFamily],
  ] as const)('dimension=%s', (dim, seedRow) => {
    it('extract<X>PrevState returns null when substrateHash === "" (seed-row sentinel)', async () => {
      const { JURISDICTIONAL_PROFILE_CONFIG } = await import('../profiles/jurisdictional.js');
      const { CAPITAL_PROFILE_CONFIG } = await import('../profiles/capital.js');
      const { HEALTH_PROFILE_CONFIG } = await import('../profiles/health.js');
      const { FAMILY_PROFILE_CONFIG } = await import('../profiles/family.js');
      const config = {
        jurisdictional: JURISDICTIONAL_PROFILE_CONFIG,
        capital: CAPITAL_PROFILE_CONFIG,
        health: HEALTH_PROFILE_CONFIG,
        family: FAMILY_PROFILE_CONFIG,
      }[dim];
      const result = config.extractPrevState(seedRow);
      expect(result).toBeNull();
    });

    it('assembled prompt omits ## CURRENT PROFILE STATE on seed-row first fire', async () => {
      const { JURISDICTIONAL_PROFILE_CONFIG } = await import('../profiles/jurisdictional.js');
      const { CAPITAL_PROFILE_CONFIG } = await import('../profiles/capital.js');
      const { HEALTH_PROFILE_CONFIG } = await import('../profiles/health.js');
      const { FAMILY_PROFILE_CONFIG } = await import('../profiles/family.js');
      const config = {
        jurisdictional: JURISDICTIONAL_PROFILE_CONFIG,
        capital: CAPITAL_PROFILE_CONFIG,
        health: HEALTH_PROFILE_CONFIG,
        family: FAMILY_PROFILE_CONFIG,
      }[dim];
      const fixture = buildFixture();
      const prevState = config.extractPrevState(seedRow); // null
      const result = assembleProfilePrompt(dim, fixture, prevState, fixture.pensieveEntries.length);
      expect(result.system).not.toContain('## CURRENT PROFILE STATE');
    });

    it('extract<X>PrevState returns null when row is null entirely (table-empty)', async () => {
      const { JURISDICTIONAL_PROFILE_CONFIG } = await import('../profiles/jurisdictional.js');
      const { CAPITAL_PROFILE_CONFIG } = await import('../profiles/capital.js');
      const { HEALTH_PROFILE_CONFIG } = await import('../profiles/health.js');
      const { FAMILY_PROFILE_CONFIG } = await import('../profiles/family.js');
      const config = {
        jurisdictional: JURISDICTIONAL_PROFILE_CONFIG,
        capital: CAPITAL_PROFILE_CONFIG,
        health: HEALTH_PROFILE_CONFIG,
        family: FAMILY_PROFILE_CONFIG,
      }[dim];
      expect(config.extractPrevState(null)).toBeNull();
    });

    it('extract<X>PrevState returns non-null when substrateHash is populated (post-first-fire row)', async () => {
      const { JURISDICTIONAL_PROFILE_CONFIG } = await import('../profiles/jurisdictional.js');
      const { CAPITAL_PROFILE_CONFIG } = await import('../profiles/capital.js');
      const { HEALTH_PROFILE_CONFIG } = await import('../profiles/health.js');
      const { FAMILY_PROFILE_CONFIG } = await import('../profiles/family.js');
      const config = {
        jurisdictional: JURISDICTIONAL_PROFILE_CONFIG,
        capital: CAPITAL_PROFILE_CONFIG,
        health: HEALTH_PROFILE_CONFIG,
        family: FAMILY_PROFILE_CONFIG,
      }[dim];
      // 64-char hex hash mimics a real SHA-256 substrate_hash from a prior
      // successful fire — extract<X>PrevState should NOT return null.
      const populatedRow = {
        ...seedRow,
        substrateHash: 'a'.repeat(64),
        confidence: 0.4,
      };
      expect(config.extractPrevState(populatedRow)).not.toBeNull();
    });
  });
});
