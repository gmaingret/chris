/**
 * src/memory/__tests__/psychological-profile-prompt.test.ts — Phase 38 Plan 38-01 (M011 / PGEN-01)
 *
 * Pure-function structural tests for `assemblePsychologicalProfilePrompt`
 * (the shared prompt builder consumed by both HEXACO + Schwartz generators
 * in Plan 38-02).
 *
 * HARD CO-LOC #M11-2: this test ships in the SAME plan as the source it
 * tests (`src/memory/psychological-profile-prompt.ts`) — Plan 38-02 MUST NOT
 * begin until this test is GREEN. The structural assertions below are the
 * contract surface that prevents per-profileType prompt drift (M010-06 lesson
 * applied to M011).
 *
 * Test discipline (mirrors src/memory/__tests__/profile-prompt.test.ts):
 *   - Parametrized over both profile types: hexaco / schwartz
 *   - Pure-function — no DB, no LLM, no mocks, no async
 *   - Asserts verbatim anchor substrings (D-05, D-06, D-07, D-08, D-09, D-10)
 *   - Pitfall 3 — runtime negative check that no operational tokens leak
 *     into the assembled `system` string
 *
 * Run: npx vitest run src/memory/__tests__/psychological-profile-prompt.test.ts
 */

import { describe, it, expect } from 'vitest';
import { CONSTITUTIONAL_PREAMBLE } from '../../chris/personality.js';
import { DO_NOT_INFER_DIRECTIVE } from '../profile-prompt.js';
import {
  assemblePsychologicalProfilePrompt,
  PSYCHOLOGICAL_HARD_RULE_EXTENSION,
  type PsychologicalProfilePromptType,
  type PsychologicalProfileSubstrateView,
  type AssembledPsychologicalProfilePrompt,
} from '../psychological-profile-prompt.js';

// ── Constants ───────────────────────────────────────────────────────────────

const PROFILE_TYPES: readonly PsychologicalProfilePromptType[] = [
  'hexaco',
  'schwartz',
] as const;

// ── Fixture helpers ─────────────────────────────────────────────────────────

/**
 * Default fixture: a substrate slice with 4 corpus rows (mixed tagged +
 * untagged — exercises PSCH-07 tag-nullable contract), 2 episodic summaries,
 * and a configurable wordCount that defaults to 6000 (above MIN_SPEECH_WORDS
 * = 5000 floor; the gate is upstream in loadPsychologicalSubstrate so this
 * builder always sees an above-threshold substrate).
 *
 * No operational tokens (`jurisdictional`/`capital`/`health`/`family`) appear
 * in the fixture data — Pitfall 3 compliance.
 */
function makeSubstrate(
  wordCount: number = 6000,
): PsychologicalProfileSubstrateView {
  return {
    corpus: [
      {
        id: 'c1',
        epistemicTag: null,
        content:
          'Spent the morning thinking about the work I want to do next month and what feels meaningful.',
        createdAt: new Date('2026-04-02T08:00:00Z'),
      },
      {
        id: 'c2',
        epistemicTag: 'REFLECTION',
        content:
          'Long walk along the river — solitude is what I need most days, more than people.',
        createdAt: new Date('2026-04-05T18:00:00Z'),
      },
      {
        id: 'c3',
        epistemicTag: 'REFLECTION',
        content:
          'I keep returning to the same questions about purpose. Maybe that is the answer itself.',
        createdAt: new Date('2026-04-12T21:00:00Z'),
      },
      {
        id: 'c4',
        epistemicTag: null,
        content: 'Read an essay on tradition versus self-direction. Both pull on me.',
        createdAt: new Date('2026-04-20T11:00:00Z'),
      },
    ],
    episodicSummaries: [
      {
        summaryDate: '2026-04-15',
        summary:
          'Quiet inward week. Themes: reflection on direction, ambivalence about social engagement.',
      },
      {
        summaryDate: '2026-04-22',
        summary:
          'Wrote 3000 words on the new project. Mood steady. Sleep regular.',
      },
    ],
    wordCount,
  };
}

/**
 * Synthetic prior-snapshot fixture for D-09 testing. Shape is intentionally
 * minimal (one dimension key) — the structural test only asserts that the
 * stringified JSON appears verbatim, not that the shape matches the v4
 * schema (that is Plan 38-02's job).
 */
function makePrevState(): { openness: { score: number; confidence: number; last_updated: string } } {
  return {
    openness: {
      score: 4.0,
      confidence: 0.6,
      last_updated: '2026-04-01T09:00:00Z',
    },
  };
}

// ── Test suite ──────────────────────────────────────────────────────────────

describe('assemblePsychologicalProfilePrompt — pure prompt assembler (Phase 38 Plan 01)', () => {
  // Defense-in-depth sentinel: assert the imported CONSTITUTIONAL_PREAMBLE
  // starts with the M010-06 anchor before any profileType-parametrized check.
  // Protects against accidental refactor of personality.ts that would
  // silently drop the first-section anchor (D-05 drift detector).
  it('sentinel — CONSTITUTIONAL_PREAMBLE imported from personality starts with the M010-06 anchor', () => {
    expect(
      CONSTITUTIONAL_PREAMBLE.startsWith('## Core Principles (Always Active)'),
    ).toBe(true);
  });

  // Sentinel: DO_NOT_INFER_DIRECTIVE imported from M010 profile-prompt.ts
  // is non-empty and contains the M010-02 anchor substring. This proves the
  // D-06 import contract is wired correctly — NOT redeclared, one source of
  // truth across M010 + M011.
  it('sentinel — DO_NOT_INFER_DIRECTIVE imported from M010 contains "do not infer" (D-06)', () => {
    expect(typeof DO_NOT_INFER_DIRECTIVE).toBe('string');
    expect(DO_NOT_INFER_DIRECTIVE.length).toBeGreaterThan(50);
    expect(DO_NOT_INFER_DIRECTIVE.toLowerCase()).toContain('do not infer');
  });

  // Sentinel: PSYCHOLOGICAL_HARD_RULE_EXTENSION constant carries the exact
  // 8-line D-07 phrasing. Asserted before any parametrized check so the
  // diff is unambiguous on failure (a phrasing drift fails this sentinel
  // first, not the per-profileType inclusion test).
  it('sentinel — PSYCHOLOGICAL_HARD_RULE_EXTENSION contains D-07 verbatim phrasing (Pitfall 1 mitigation #1)', () => {
    const c = PSYCHOLOGICAL_HARD_RULE_EXTENSION;
    expect(c).toContain('## Psychological Profile Framing (D027 extension — REQUIRED)');
    expect(c).toContain(
      'These trait scores describe statistical tendencies inferred from speech patterns',
    );
    expect(c).toContain('NOT facts about who Greg is');
    expect(c).toContain('tell Greg he is "the kind of person who..."');
    expect(c).toContain(
      'his trait scores as evidence that his current reasoning is correct',
    );
    expect(c).toContain(
      'validates his existing position by citing his personality',
    );
    expect(c).toContain('The Hard Rule (D027) applies here with additional force');
    expect(c).toContain(
      'Evaluate every claim on its merits regardless of what the profile says.',
    );
  });

  // Parametrized over both profile types — every assertion below runs twice.
  describe.each([['hexaco'] as const, ['schwartz'] as const])(
    'profileType=%s',
    (profileType) => {
      it('CONSTITUTIONAL_PREAMBLE first — system starts with "## Core Principles (Always Active)" (D-05)', () => {
        const result: AssembledPsychologicalProfilePrompt =
          assemblePsychologicalProfilePrompt(
            profileType,
            makeSubstrate(),
            null,
            6000,
          );
        expect(result.system.startsWith('## Core Principles (Always Active)')).toBe(
          true,
        );
        expect(result.system.startsWith(CONSTITUTIONAL_PREAMBLE.trimEnd())).toBe(
          true,
        );
      });

      it('DO_NOT_INFER_DIRECTIVE present in assembled system (D-06 — imported from M010)', () => {
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(),
          null,
          6000,
        );
        expect(result.system.includes(DO_NOT_INFER_DIRECTIVE)).toBe(true);
      });

      it('PSYCHOLOGICAL_HARD_RULE_EXTENSION present (D-07 — D027 trait-authority sycophancy mitigation #1)', () => {
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(),
          null,
          6000,
        );
        expect(result.system.includes(PSYCHOLOGICAL_HARD_RULE_EXTENSION)).toBe(
          true,
        );
        expect(result.system).toContain(
          '## Psychological Profile Framing (D027 extension — REQUIRED)',
        );
      });

      it('word-count framing tells Sonnet to emit data_consistency + overall_confidence (D-08)', () => {
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(),
          null,
          6000,
        );
        expect(result.system).toContain('data_consistency');
        expect(result.system).toContain('overall_confidence');
        // The exact "forbid top-level confidence field" phrasing from the
        // builder — verbatim substring assertion (D-08).
        expect(result.system).toContain('do NOT emit a `confidence` field');
      });

      it('substrate wordCount renders into the assembled system (D-08 — explicit volume signal)', () => {
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(6247),
          null,
          6247,
        );
        expect(result.system).toContain('6247');
      });

      it('per-profileType directive present with empirical-limits framing (D-10)', () => {
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(),
          null,
          6000,
        );
        if (profileType === 'hexaco') {
          expect(result.system).toContain('## Profile Focus — HEXACO');
        } else {
          expect(result.system).toContain('## Profile Focus — Schwartz');
        }
        // Both directives include the r ≈ .31–.41 ceiling framing.
        expect(result.system).toMatch(/r ≈ \.31.\.41/);
      });

      it('prevState=null → system does NOT contain "## CURRENT PROFILE STATE" (D-09)', () => {
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(),
          null,
          6000,
        );
        expect(result.system).not.toContain('## CURRENT PROFILE STATE');
      });

      it('prevState non-null → system DOES contain "## CURRENT PROFILE STATE" + rendered JSON.stringify(prevState, null, 2) (D-09)', () => {
        const prev = makePrevState();
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(),
          prev,
          6000,
        );
        expect(result.system).toContain('## CURRENT PROFILE STATE');
        expect(result.system).toContain(JSON.stringify(prev, null, 2));
      });

      it('user prompt — exact template "Generate the <TYPE> psychological profile for Greg." (D-03)', () => {
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(),
          null,
          6000,
        );
        const expected =
          profileType === 'hexaco'
            ? 'Generate the HEXACO psychological profile for Greg.'
            : 'Generate the SCHWARTZ psychological profile for Greg.';
        expect(result.user).toBe(expected);
      });

      it('pure function — repeated calls with identical inputs produce identical outputs (D-03)', () => {
        const fixture = makeSubstrate();
        const a = assemblePsychologicalProfilePrompt(
          profileType,
          fixture,
          null,
          6000,
        );
        const b = assemblePsychologicalProfilePrompt(
          profileType,
          fixture,
          null,
          6000,
        );
        expect(a.system).toBe(b.system);
        expect(a.user).toBe(b.user);
      });

      // Pitfall 3 — runtime negative check that no operational-vocab token
      // leaks into the assembled system string. The static boundary audit
      // (psych-boundary-audit.test.ts) is the file-level guard; this is the
      // assembled-output guard (catches a future regression where a directive
      // is "translated" with operational terms).
      it('no operational-vocab tokens appear in the assembled system (Pitfall 3 runtime check)', () => {
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(),
          null,
          6000,
        );
        // Use named groups via a non-trivial pattern: trip on the standalone
        // word forms only (case-insensitive). Note: CONSTITUTIONAL_PREAMBLE
        // contains no operational vocab — the assertion is global to the
        // assembled system.
        expect(result.system).not.toMatch(/\bjurisdictional\b/i);
        expect(result.system).not.toMatch(/\bcapital\b/i);
        // Note: the role preamble mentions "purpose" / "patterns" / "trait"
        // domain vocab only — no operational-vocab false positives.
        // We do NOT assert against /\bhealth\b/i or /\bfamily\b/i because
        // those English nouns can legitimately appear in role-framing
        // discussion. The static audit covers identifier-level violations;
        // this runtime check covers the two profile-dimension names that
        // would never appear coincidentally.
      });

      // Section-order assertion (D-05 + D-06 + D-07 sequence): the section
      // ordering is the contract that makes the M010-06 mitigation work —
      // CONSTITUTIONAL_PREAMBLE binds the anti-sycophancy floor first; then
      // the M010-shared anti-hallucination floor; then the M011-specific
      // Hard Rule extension. Re-ordering any of these silently fails the
      // contract; the structural test catches it.
      it('section order — CONSTITUTIONAL_PREAMBLE → DO_NOT_INFER (Hallucination Floor) → PSYCHOLOGICAL_HARD_RULE_EXTENSION (D-05/D-06/D-07)', () => {
        const result = assemblePsychologicalProfilePrompt(
          profileType,
          makeSubstrate(),
          null,
          6000,
        );
        const idxPreamble = result.system.indexOf('## Core Principles (Always Active)');
        const idxHallucinationFloor = result.system.indexOf('## Hallucination Floor');
        const idxHardRule = result.system.indexOf(
          '## Psychological Profile Framing (D027 extension — REQUIRED)',
        );
        expect(idxPreamble).toBeGreaterThanOrEqual(0);
        expect(idxHallucinationFloor).toBeGreaterThan(idxPreamble);
        expect(idxHardRule).toBeGreaterThan(idxHallucinationFloor);
      });
    },
  );

  // ── One-off tests (outside describe.each) ────────────────────────────────

  // D-23 narrowing check: the PsychologicalProfilePromptType union must NOT
  // include 'attachment'. Attempting to call the assembler with 'attachment'
  // is a TypeScript error — caught at typecheck, not at runtime. The
  // `@ts-expect-error` directive flips into an error itself if the line
  // becomes type-correct (i.e., if someone widens the union to include
  // 'attachment' without going through v2.6.1 / ATT-POP-01).
  it('PsychologicalProfilePromptType is narrower than Phase 37 union — "attachment" rejected at typecheck (D-23)', () => {
    // @ts-expect-error attachment deferred per D-23 to v2.6.1 / ATT-POP-01
    const result = assemblePsychologicalProfilePrompt(
      'attachment',
      makeSubstrate(),
      null,
      6000,
    );
    // Runtime side-effect: the call still produces SOMETHING (PROFILE_TYPE_DIRECTIVES
    // dictionary access on an out-of-union key returns undefined which would surface
    // as 'undefined' in the assembled system) — we do not assert on the runtime
    // shape here, only that the @ts-expect-error directive flips correctly.
    // The presence of `result` keeps it referenced so the linter does not
    // strip the call.
    expect(typeof result).toBe('object');
  });
});
