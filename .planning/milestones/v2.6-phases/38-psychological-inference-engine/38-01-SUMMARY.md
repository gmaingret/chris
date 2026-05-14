---
phase: 38
plan: 01
subsystem: memory/psychological-inference
tags: [psychological-profile, prompt-builder, m011, hexaco, schwartz, hard-rule-d027, pgen-01]
requirements: [PGEN-01]
dependency_graph:
  requires:
    - "src/chris/personality.ts (CONSTITUTIONAL_PREAMBLE)"
    - "src/memory/profile-prompt.ts (DO_NOT_INFER_DIRECTIVE — named import)"
    - "src/memory/profiles/psychological-shared.ts (Phase 37 — PsychologicalProfileType union; substrate shape reference)"
  provides:
    - "assemblePsychologicalProfilePrompt(profileType, substrate, prevState, wordCount): { system, user }"
    - "PSYCHOLOGICAL_HARD_RULE_EXTENSION (verbatim D-07 — re-exportable for Phase 39 PSURF-02)"
    - "PsychologicalProfilePromptType = 'hexaco' | 'schwartz' (narrower than Phase 37 union per D-23)"
    - "AssembledPsychologicalProfilePrompt = { system: string; user: string }"
    - "PsychologicalProfileSubstrateView (readonly structural view for above-threshold branch)"
  affects:
    - "Plan 38-02 (HEXACO + Schwartz generators import assemblePsychologicalProfilePrompt — HARD CO-LOC #M11-2 satisfied)"
    - "Phase 39 PSURF-02 (will re-export PSYCHOLOGICAL_HARD_RULE_EXTENSION at surface injection layer — mitigation point #2)"
tech-stack:
  added: []
  patterns:
    - "Named-import-only from M010 profile-prompt.ts (Pitfall 3 mitigation — keeps module graph minimal)"
    - "Per-profileType Record dispatcher (HEXACO/Schwartz directives locked at module level, not in per-generator config — prevents drift)"
    - "9-section ordered assembler mirroring M010 with 8 locked divergences"
    - "Conditional prevState section (D-09 — null → omitted; non-null → JSON.stringify verbatim)"
    - "describe.each parametrization across both profile types (28 tests = 14 per type for shared assertions)"
key-files:
  created:
    - path: "src/memory/psychological-profile-prompt.ts"
      lines: 456
      purpose: "Shared prompt builder for HEXACO + Schwartz generators; exports assemblePsychologicalProfilePrompt + PSYCHOLOGICAL_HARD_RULE_EXTENSION + PsychologicalProfilePromptType + AssembledPsychologicalProfilePrompt + PsychologicalProfileSubstrateView"
    - path: "src/memory/__tests__/psychological-profile-prompt.test.ts"
      lines: 381
      purpose: "Structural unit tests parametrized over both profile types; asserts D-05/D-06/D-07/D-08/D-09/D-10 invariants verbatim; sentinel checks for CONSTITUTIONAL_PREAMBLE/DO_NOT_INFER_DIRECTIVE/PSYCHOLOGICAL_HARD_RULE_EXTENSION; D-23 narrowing via @ts-expect-error"
  modified: []
decisions:
  - "Per-profileType directives include verbatim r ≈ .31–.41 empirical-limits framing (D-10) — speech-based personality inference accuracy ceiling communicated to Sonnet at prompt level since D-33 explicitly excludes a Zod .refine() ceiling at SDK boundary"
  - "Word-count framing (D-08) replaces M010's volume-weight ceiling — Sonnet is told to emit BOTH data_consistency AND overall_confidence at top level; explicitly forbids top-level confidence field. M011 word-count gating is upstream (loadPsychologicalSubstrate per PSCH-08), so this section communicates volume rather than enforcing a ceiling"
  - "Substrate block omits decisions array — Phase 37 psychological substrate is corpus-only per D-20 (direct divergence from M010's assembleProfilePrompt which threads resolved decisions)"
  - "@ts-expect-error D-23 narrowing test uses runtime call to keep linter from stripping the test — directive flips if anyone widens PsychologicalProfilePromptType to include 'attachment' without v2.6.1 / ATT-POP-01"
  - "Pitfall 3 runtime negative check in test asserts no operational tokens (jurisdictional/capital) leak into assembled system — complements the static psych-boundary-audit.test.ts at the assembled-output layer"
metrics:
  duration_seconds: ~270
  tasks_completed: 2
  files_created: 2
  files_modified: 0
  commits: 2
  tests_added: 28
  vitest_total_passing: 38  # 28 new + 10 boundary audit regression
completed: 2026-05-14
---

# Phase 38 Plan 01: Shared Prompt Builder Summary

Forked M010's `assembleProfilePrompt` into a new psychological-inference sibling at `src/memory/psychological-profile-prompt.ts` — produces `{system, user}` for both HEXACO and Schwartz generators, locks the D027 trait-authority Hard Rule inline as `PSYCHOLOGICAL_HARD_RULE_EXTENSION`, and imports (not redeclares) `DO_NOT_INFER_DIRECTIVE` from M010 for one-source-of-truth across operational + psychological inference. Plan 38-02's generators can now compile against this contract (HARD CO-LOC #M11-2 satisfied).

## Tasks Completed

| # | Task | Commit | Files | Verification |
|---|------|--------|-------|--------------|
| 1 | Author psychological-profile-prompt.ts with 9-section assembler | `1ade114` | `src/memory/psychological-profile-prompt.ts` (456 lines) | `npx tsc --noEmit` exits 0; boundary audit 10/10 green |
| 2 | Author psychological-profile-prompt.test.ts structural test | `f91e13c` | `src/memory/__tests__/psychological-profile-prompt.test.ts` (381 lines) | `npx vitest run psychological-profile-prompt.test.ts` 28/28 green; boundary audit still 10/10 green |

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | exits 0 (zero new TS errors) |
| `npx vitest run src/memory/__tests__/psychological-profile-prompt.test.ts` | 28 passed |
| `npx vitest run src/memory/profiles/__tests__/psych-boundary-audit.test.ts` | 10 passed (no regression) |
| `grep -c "^export function assemblePsychologicalProfilePrompt"` | 1 |
| `grep -c "^export const PSYCHOLOGICAL_HARD_RULE_EXTENSION"` | 1 |
| `grep -c "^export type PsychologicalProfilePromptType"` | 1 |
| `grep -c "import { DO_NOT_INFER_DIRECTIVE } from"` | 1 (named import only — Pitfall 3 mitigation) |
| `grep -c "CONSTITUTIONAL_PREAMBLE"` | 7 (import + first-section use + JSDoc references) |
| Operational vocab in source (excl comments) | 0 (Pitfall 3) |
| Operational vocab in test (excl comments) | 0 (Pitfall 3) |
| `grep -c "## Profile Focus — HEXACO"` | 1 |
| `grep -c "## Profile Focus — Schwartz"` | 1 |
| `grep -cE "r ≈ \.31.\.41"` in source | 5 (both directives + structured-output reminder) |
| `grep -c "data_consistency"` in source | 11 |
| `grep -c "overall_confidence"` in source | 14 |
| `grep -c "describe.each"` in test | 2 |
| `grep -c "@ts-expect-error"` in test | 3 (1 directive + 2 explanatory comments) |

## Key Invariants Verified

1. **`PSYCHOLOGICAL_HARD_RULE_EXTENSION`** — verbatim 8-line D-07 phrasing including "Hard Rule (D027) applies here with additional force" and "Evaluate every claim on its merits regardless of what the profile says." Sentinel test asserts each line as a substring of the constant.
2. **`DO_NOT_INFER_DIRECTIVE`** — IMPORTED via named import from `src/memory/profile-prompt.ts`, NOT redeclared. Sentinel test verifies it contains "do not infer" (case-insensitive).
3. **`CONSTITUTIONAL_PREAMBLE`** — IMPORTED from `src/chris/personality.ts`. Test asserts `result.system.startsWith('## Core Principles (Always Active)')` for both profile types AND that the trimmed preamble is the prefix of the assembled system.
4. **Per-profileType directives** — HEXACO emphasizes cross-dimension coherence ("the 6 dimensions are ONE theoretical framework"); Schwartz emphasizes circumplex structure with opposing-value tradeoffs ("Self-Direction sits opposite Conformity"). Both include `r ≈ .31–.41` empirical-limits framing.
5. **`PsychologicalProfileType` narrowing (D-23)** — `PsychologicalProfilePromptType = 'hexaco' | 'schwartz'` is narrower than Phase 37's `'hexaco' | 'schwartz' | 'attachment'` union. `@ts-expect-error` directive on a call with `'attachment'` asserts the narrowing at compile time; flips into an error if the union is silently widened.
6. **No operational-token contamination** — `psych-boundary-audit.test.ts` (Phase 37 PSCH-10) stays green (10/10) after this plan ships. Plus a runtime negative check inside `psychological-profile-prompt.test.ts` asserts the assembled `system` contains no `jurisdictional`/`capital` standalone words.
7. **Function signature exact** — `assemblePsychologicalProfilePrompt(profileType, substrate, prevState, wordCount): { system: string; user: string }`. Pure function — same inputs → same outputs verified by determinism test.
8. **Test parametrized over `['hexaco', 'schwartz']` via `describe.each`** — 11 shared assertions × 2 profile types = 22 parametrized tests + 4 sentinel tests + 1 one-off D-23 narrowing test + 1 section-order assertion (parametrized) = 28 total tests.

## Section Order in Assembled System (D-05 / D-06 / D-07 / D-08 / D-09 / D-10)

1. `## Core Principles (Always Active)` — `CONSTITUTIONAL_PREAMBLE` (D-05)
2. `## Your Role` — role preamble (psychological-trait-inference framing — pattern aggregation, not quotation extraction)
3. `## Hallucination Floor (MANDATORY)` — `DO_NOT_INFER_DIRECTIVE` (D-06 — imported from M010)
4. `## Psychological Profile Framing (D027 extension — REQUIRED)` — `PSYCHOLOGICAL_HARD_RULE_EXTENSION` (D-07 — Pitfall 1 mitigation #1)
5. `## Volume & Confidence Reporting` — word-count framing (D-08 — Sonnet emits `data_consistency` + `overall_confidence`; forbids top-level `confidence`)
6. `## CURRENT PROFILE STATE` — prevState injection, conditional (D-09 — only when prevState !== null)
7. `## Profile Focus — HEXACO` / `## Profile Focus — Schwartz` — per-profileType directive (D-10)
8. `## Substrate` — corpus + episodic summaries (NO decisions per Phase 37 substrate shape)
9. `## Structured Output Contract` — names `HexacoProfileSchemaV4Sdk` / `SchwartzProfileSchemaV4Sdk` (Plan 38-02 Task 1 will define these by extending Phase 37's v4 schemas with top-level data_consistency + overall_confidence per RESEARCH Finding 1)

## Deviations from Plan

None — plan executed exactly as written. All decisions D-03..D-10 + D-23 honored verbatim. The plan instructed JSDoc above the constant referencing "Pitfall 1 mitigation point #1" — implemented exactly. The plan's `<action>` block included the optional flexibility to keep `PROFILE_TYPE_DIRECTIVES` as a Record dispatcher OR an inline switch — chose the Record dispatcher to mirror M010's `DIMENSION_DIRECTIVES` (consistency with the analog).

Minor note: in the test file, the runtime Pitfall 3 negative check (test 12) deliberately asserts only against `\bjurisdictional\b/i` and `\bcapital\b/i` and NOT against `\bhealth\b/i` or `\bfamily\b/i`. Rationale documented inline in the test: those two English nouns can legitimately appear in role-framing language ("health" in describing wellbeing patterns, "family" in describing relationships discussed by Greg). The static `psych-boundary-audit.test.ts` audit covers all four at the file-identifier level; this runtime check is the defense against the two profile-dimension names that would never appear coincidentally. Not a deviation from the plan's intent (Pitfall 3 coverage); a refinement of the assertion specificity.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or trust-boundary schemas introduced. Pure function with zero side effects; consumes M010 + Phase 37 contracts read-only.

## Known Stubs

None — both files are complete deliverables. `assemblePsychologicalProfilePrompt` ships with all 9 sections; `PSYCHOLOGICAL_HARD_RULE_EXTENSION` ships with verbatim D-07 phrasing; test ships with 28 passing assertions.

## Self-Check: PASSED

**Created files exist:**
- `src/memory/psychological-profile-prompt.ts` — FOUND (456 lines)
- `src/memory/__tests__/psychological-profile-prompt.test.ts` — FOUND (381 lines)

**Commits exist on branch `worktree-agent-a690e5acb2b3166c1`:**
- `1ade114` — `feat(38-01): add psychological-profile-prompt.ts shared builder` — FOUND
- `f91e13c` — `test(38-01): add structural test for assemblePsychologicalProfilePrompt` — FOUND

**Verification commands re-run at SUMMARY time:**
- `npx tsc --noEmit` exits 0 — VERIFIED
- `npx vitest run src/memory/__tests__/psychological-profile-prompt.test.ts` 28/28 pass — VERIFIED
- `npx vitest run src/memory/profiles/__tests__/psych-boundary-audit.test.ts` 10/10 pass (no regression) — VERIFIED

## Hand-off to Plan 38-02

Plan 38-02 imports from this plan's deliverables:
```typescript
import {
  assemblePsychologicalProfilePrompt,
  PSYCHOLOGICAL_HARD_RULE_EXTENSION,
  type PsychologicalProfilePromptType,
  type AssembledPsychologicalProfilePrompt,
  type PsychologicalProfileSubstrateView,
} from '../psychological-profile-prompt.js';
```

The generators in `src/memory/profiles/hexaco.ts` and `src/memory/profiles/schwartz.ts` will:
1. Narrow `loadPsychologicalSubstrate`'s discriminated union on `belowThreshold: false`
2. Project the above-threshold branch into a `PsychologicalProfileSubstrateView` (corpus + episodicSummaries + wordCount)
3. Pass it to `assemblePsychologicalProfilePrompt(profileType, view, substrate.prevHistorySnapshot, wordCount)` to get `{system, user}`
4. Forward `system` + `user` to `anthropic.messages.parse({ model: SONNET_MODEL, system, messages: [{role:'user', content: user}], output_format: zodOutputFormat(HexacoProfileSchemaV4Boundary, 'profile') })` per RESEARCH Finding 1's V4Boundary extension

Phase 39 PSURF-02 will re-export `PSYCHOLOGICAL_HARD_RULE_EXTENSION` at the surface-level prompt-injection block (mitigation point #2 for D027 sycophancy).

HARD CO-LOC #M11-2: SATISFIED. Plan 38-02 is unblocked.
