---
phase: 39
plan: 01
subsystem: psychological-surfaces
tags:
  - phase-39
  - surfaces
  - psychological
  - profile-injection
  - profile-injection-map
  - mode-handler-wiring
  - d027-hard-rule
  - negative-invariant
dependency-graph:
  requires:
    - "PSYCHOLOGICAL_HARD_RULE_EXTENSION (Phase 38 PGEN-04) — imported verbatim, never redeclared"
    - "getPsychologicalProfiles + PsychologicalProfiles (Phase 37 PSCH-09) — never-throw reader"
    - "ChrisContextExtras + buildSystemPrompt (Phase 35 SURF-01) — existing extras envelope + per-mode substitution body"
    - "PROFILE_INJECTION_MAP + formatProfilesForPrompt (Phase 35 SURF-02) — operational sibling pattern"
    - "psych-boundary-audit.test.ts (Phase 37 PSCH-10) — structural mirror for the new COACH-isolation test"
  provides:
    - "PSYCHOLOGICAL_PROFILE_INJECTION_MAP (REFLECT, PSYCHOLOGY → [hexaco, schwartz]; COACH structurally absent from key union)"
    - "formatPsychologicalProfilesForPrompt(profiles, mode) — pure function, 4 empty-string gates, imported PSYCHOLOGICAL_HARD_RULE_EXTENSION footer"
    - "ProfileRow<T> extended with optional wordCount + wordCountAtLastRun fields (RESEARCH Open Q1 Option A)"
    - "ChrisContextExtras.psychologicalProfiles?: string sibling to operationalProfiles"
    - "REFLECT + PSYCHOLOGY mode handlers wired to inject psychological profiles via sequential awaits after operational reader/formatter"
    - "coach-psychological-isolation.test.ts — regex-sweep negative invariant guarding D027 Hard Rule at the COACH boundary"
  affects:
    - "Plan 39-02 — consumes ProfileRow<T>.wordCountAtLastRun for the /profile display 'need N more words' branch"
    - "Phase 40 PMT-06 — live anti-hallucination gate verifies the rendered Hard Rule footer empirically"
tech-stack:
  added: []
  patterns:
    - "Sibling-but-distinct constant pattern (DISTINCT typed maps for operational vs psychological injection — D-03)"
    - "Imported (not redeclared) footer constant — single source of truth across inference + consumer layers"
    - "Destructure-only silent drop (COACH destructures the field into scope but never references it in the case body)"
    - "Filter-Boolean substitution chain ([psychologicalProfiles, operationalProfiles, contextValue].filter(Boolean).join('\\n\\n')) — no orphan separators when any block is empty"
    - "Regex-sweep negative invariant via readFile + per-line scan — structural mirror of Phase 37 PSCH-10"
key-files:
  created:
    - "src/chris/modes/__tests__/coach-psychological-isolation.test.ts"
  modified:
    - "src/memory/profiles.ts"
    - "src/memory/__tests__/profiles.test.ts"
    - "src/chris/personality.ts"
    - "src/chris/__tests__/personality.test.ts"
    - "src/chris/modes/reflect.ts"
    - "src/chris/modes/psychology.ts"
    - "src/chris/__tests__/reflect.test.ts"
    - "src/chris/__tests__/psychology.test.ts"
decisions:
  - "Imported PSYCHOLOGICAL_HARD_RULE_EXTENSION verbatim from psychological-profile-prompt.ts (NOT redeclared) — single source of truth across Phase 38 + Phase 39 per PITFALLS.md §1 D027 mitigation; test #11 asserts out.includes(constant) so any drift breaks the test."
  - "PSYCHOLOGICAL_PROFILE_INJECTION_MAP is Readonly<Record<'REFLECT' | 'PSYCHOLOGY', readonly PsychologicalProfileType[]>> — key union structurally excludes COACH; accessing MAP['COACH'] is a compile-time error (defense layer #1 in the D027 mitigation chain)."
  - "COACH case body in personality.ts is NOT modified — psychologicalProfiles is destructured into scope but never referenced. Combined with the COACH-isolation regex test, this is two independent defense layers against trait → coaching-conclusion circular reasoning (defense layers #2 + #4 in the D027 chain)."
  - "Sequential awaits (D-16) — getOperationalProfiles → formatProfilesForPrompt → getPsychologicalProfiles → formatPsychologicalProfilesForPrompt → buildSystemPrompt. Parallelism (Promise.all) deferred to v2.6.1; readers are sub-50ms single-row queries so the latency cost is negligible at single-user scale."
  - "Existing reflect.test.ts + psychology.test.ts vi.mock('../../memory/profiles.js') returns extended (deviation Rule 3) to expose the new psych exports. Both files default the new mocks to all-null + empty-string returns so existing operational-only test cases need no per-case psych setup."
metrics:
  start: "2026-05-14T07:11:00Z"
  end:   "2026-05-14T07:28:39Z"
  duration_minutes: 18
  tasks_completed: 4
  tests_added:
    - "5 PSYCHOLOGICAL_PROFILE_INJECTION_MAP shape tests (profiles.test.ts)"
    - "13 formatPsychologicalProfilesForPrompt tests (profiles.test.ts)"
    - "11 substitution-order tests (personality.test.ts)"
    - "1 COACH-psychological-isolation regex-sweep test (NEW file)"
    - "Total: 30 new tests; full test sweep covering plan = 165/165 green across 6 critical files"
  files_created: 1
  files_modified: 8
---

# Phase 39 Plan 01: Psychological Surfaces (Prompt-Side) Summary

Wired the psychological-profile injection circuit for REFLECT + PSYCHOLOGY system prompts (header + per-dim score lines + imported Hard Rule footer), structurally locked COACH out of the rendering surface (compile-time map-key absence + regex-sweep negative invariant + destructure-only silent drop), and extended `ProfileRow<T>` so Plan 39-02 can render the "need N more words" insufficient-data branch without a second DB read.

## Plan Goal

Ship the prompt-side surface that turns Phase 37's `getPsychologicalProfiles()` reader and Phase 38's `PSYCHOLOGICAL_HARD_RULE_EXTENSION` constant into a wired injection circuit for REFLECT + PSYCHOLOGY mode system prompts, with COACH explicitly absent — closing PSURF-01, PSURF-02, PSURF-03, and the COACH-isolation half of PSURF-05.

## Tasks Completed

| Task | Name                                                                      | Commit  | Files Changed                                                                                                                                    |
|------|---------------------------------------------------------------------------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| 1    | Add PSYCHOLOGICAL_PROFILE_INJECTION_MAP + ProfileRow word-count fields    | 1926ff4 | src/memory/profiles.ts                                                                                                                           |
| 2    | Implement formatPsychologicalProfilesForPrompt + 18 unit tests            | 18c7019 | src/memory/profiles.ts, src/memory/__tests__/profiles.test.ts                                                                                    |
| 3    | Wire psychologicalProfiles into buildSystemPrompt REFLECT+PSYCHOLOGY      | 2be61bf | src/chris/personality.ts, src/chris/__tests__/personality.test.ts                                                                                |
| 4    | Wire REFLECT+PSYCHOLOGY handlers + COACH negative-invariant test          | 59b3f9d | src/chris/modes/reflect.ts, src/chris/modes/psychology.ts, src/chris/modes/__tests__/coach-psychological-isolation.test.ts, src/chris/__tests__/reflect.test.ts, src/chris/__tests__/psychology.test.ts |

## New Export Surface (src/memory/profiles.ts)

- **`PSYCHOLOGICAL_PROFILE_INJECTION_MAP`** — `Readonly<Record<'REFLECT' | 'PSYCHOLOGY', readonly PsychologicalProfileType[]>>`. REFLECT and PSYCHOLOGY each map to `['hexaco', 'schwartz']` verbatim per D-04. `'attachment'` absent from both arrays (Phase 38 D-23 deferred generator). COACH structurally absent from the key union — accessing `MAP['COACH']` is a compile-time error (D027 defense layer #1).
- **`formatPsychologicalProfilesForPrompt(profiles, mode)`** — pure function. Honors the four D-05 empty-string gates (a: mode not in map; b: all in-scope profiles null; c: all overall_confidence === 0; d: all lastUpdated epoch === 0). Populated output: `## Psychological Profile (inferred — low precision, never use as authority)` header at top, per-dim lines of the form `<DIM> <Trait>: X.X / 5.0 (confidence Y.Y — <qualifier>)` per D-08, footer = `PSYCHOLOGICAL_HARD_RULE_EXTENSION` imported VERBATIM from `psychological-profile-prompt.ts:144` at the bottom (D-11 recency-bias).
- **`ProfileRow<T>` extension** — `wordCount?: number` + `wordCountAtLastRun?: number` (RESEARCH Open Q1 Option A). Threaded through `readOnePsychologicalProfile` only; operational rows leave the fields undefined. Plan 39-02 consumes `wordCountAtLastRun` for the `/profile` display "need N more words" branch.

## Imported-Footer Invariant (Single Source of Truth)

The Hard Rule footer is **imported** from `psychological-profile-prompt.ts:144`, NEVER redeclared inside `profiles.ts`. PITFALLS.md §1 names this discipline as the load-bearing mitigation surface for the D027 sycophancy-injection risk in M011 — small wording changes there dramatically change Sonnet's sycophancy resistance.

Two enforcement points:

1. **Grep invariant:** `grep -cE "PSYCHOLOGICAL_HARD_RULE_EXTENSION\s*=" src/memory/profiles.ts` returns 0 (no assignment / redeclaration). Confirmed.
2. **Runtime invariant:** Test #11 in `profiles.test.ts` imports the constant from the prompt module and asserts `out.includes(PSYCHOLOGICAL_HARD_RULE_EXTENSION)`. Drift between the inference layer (Phase 38) and the consumer layer (Phase 39) breaks the test loudly.

## New Test Coverage

- **5 map-shape tests** (`profiles.test.ts` — `describe('PSYCHOLOGICAL_PROFILE_INJECTION_MAP — shape (Phase 39 D-04)')`): REFLECT equals `['hexaco', 'schwartz']`; PSYCHOLOGY equals `['hexaco', 'schwartz']`; COACH absent from key union; 5-mode silent-drop sweep (JOURNAL / INTERROGATE / PRODUCE / PHOTOS / ACCOUNTABILITY absent); `'attachment'` absent from both mode arrays.
- **13 formatter tests** (`profiles.test.ts` — `describe('formatPsychologicalProfilesForPrompt — gates and rendering')`): four D-05 empty-string gates (D-05.a..d) + populated REFLECT renders header + populated PSYCHOLOGY identical to REFLECT + per-dim format match + qualifier bands (limited/moderate/substantial) + partial-population skip null-or-zero-conf dims + footer-at-bottom + footer-import invariant + Schwartz hyphenation preserved (`Self-Direction`) + attachment-never-rendered.
- **11 substitution-order tests** (`personality.test.ts` — `describe('extras.psychologicalProfiles injection (Phase 39 D-11)')`): REFLECT three-way ordering + PSYCHOLOGY three-way ordering + COACH silent drop (operational still renders) + 5-mode silent-drop sweep + empty-string equivalence (empty == undefined) + no-orphan invariant.
- **1 negative-invariant test** (`src/chris/modes/__tests__/coach-psychological-isolation.test.ts` — NEW FILE): per-line regex sweep over `coach.ts` against `PSYCH_VOCAB = /\b(psychological|getPsychologicalProfiles|formatPsychologicalProfilesForPrompt|hexaco|schwartz|attachment|HEXACO|SCHWARTZ|ATTACHMENT|PSYCHOLOGICAL_PROFILE_INJECTION_MAP|PSYCHOLOGICAL_HARD_RULE_EXTENSION)\b/`. Asserts zero hits with a LOUD multi-line failure message referencing PITFALLS.md §1 + D027 + the remediation path (route through REFLECT/PSYCHOLOGY).

**Total new tests: 30.** Total tests in critical-file sweep: **165 / 165 green** across `profiles.test.ts` (39), `personality.test.ts` (64), `coach-psychological-isolation.test.ts` (1), `psych-boundary-audit.test.ts` (10), `reflect.test.ts` (30), `psychology.test.ts` (21).

## Four D-05 Empty-String Gates

| Gate    | Trigger                                                              | Test reference                                                        |
|---------|----------------------------------------------------------------------|-----------------------------------------------------------------------|
| D-05.a  | `mode` not in `PSYCHOLOGICAL_PROFILE_INJECTION_MAP`                  | profiles.test.ts gate test #1 — loops over 7 modes incl. COACH        |
| D-05.b  | all in-scope profiles null                                           | profiles.test.ts gate test #2 — `ALL_NULL` fixture                    |
| D-05.c  | all in-scope profiles `overall_confidence === 0`                     | profiles.test.ts gate test #3 — `ALL_ZERO_CONF` fixture               |
| D-05.d  | all in-scope profiles never-fired (`lastUpdated.getTime() === 0`)    | profiles.test.ts gate test #4 — `NEVER_FIRED` fixture (epoch sentinel)|

## D027 Hard Rule — Five Independent Defense Layers

| Layer | Surface                                                                                | Implementation                                                                                                              |
|-------|----------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|
| 1     | Compile-time: COACH absent from `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` key union        | `Readonly<Record<'REFLECT' \| 'PSYCHOLOGY', ...>>` — `MAP['COACH']` is a TS error                                            |
| 2     | Substitution body: COACH case in personality.ts does NOT reference psychologicalProfiles | Destructure-only silent drop; verified by `awk` over the COACH case body returning 0                                        |
| 3     | Rendered prompt: header frames trait data as low-precision                             | `## Psychological Profile (inferred — low precision, never use as authority)`                                                |
| 4     | Rendered prompt: imported Hard Rule footer at the bottom (D-11 recency-bias)           | `PSYCHOLOGICAL_HARD_RULE_EXTENSION` appended verbatim; single source of truth across Phase 38 + Phase 39                    |
| 5     | Runtime regex-sweep negative invariant                                                 | `coach-psychological-isolation.test.ts` — per-line `PSYCH_VOCAB` scan over `coach.ts` with LOUD failure message              |

## Confirmation: coach.ts Unmodified

```
$ git diff --name-only HEAD~4..HEAD -- src/chris/modes/coach.ts
(empty)
```

Plan 39-01 added 4 commits (Tasks 1-4); `coach.ts` is not in any of them. The negative-invariant test runs in <200ms and asserts the absence structurally.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] Extended existing reflect.test.ts + psychology.test.ts profile mocks**

- **Found during:** Task 4
- **Issue:** Existing `vi.mock('../../memory/profiles.js', () => ({ getOperationalProfiles, formatProfilesForPrompt }))` mocks omitted the two new psych exports. After Task 4's reflect/psychology handler edits added `await getPsychologicalProfiles()` calls, 44 tests across the two files failed with `getPsychologicalProfiles is not a function`.
- **Fix:** Extended both mock declarations to expose `getPsychologicalProfiles` + `formatPsychologicalProfilesForPrompt`. Defaulted to all-null reader output + empty-string formatter output so existing operational-only test cases work without per-case psych setup. The plan's Task 4 final paragraph anticipated this ("if existing mode-handler tests assert on the buildSystemPrompt extras shape, they may need ... widening to tolerate the new psychologicalProfiles field — extend those assertions if needed; same pattern as Plan 35-02 Task 4 used.").
- **Files modified:** `src/chris/__tests__/reflect.test.ts`, `src/chris/__tests__/psychology.test.ts`.
- **Commit:** 59b3f9d (folded into Task 4 commit).
- **Result:** All 51 reflect+psychology handler tests green post-fix.

### Acceptance-Criteria Wording Note (no code change)

The Task 1 grep acceptance criterion `grep -v '^[[:space:]]*\(//\|\*\)' src/memory/profiles.ts | grep -cE "^[[:space:]]*COACH:" | awk '$1==0 {print "OK"}'` is documented in the plan as asserting "COACH is NOT a key in EITHER map's literal definition". This is **expected to fail** because the pre-existing operational `PROFILE_INJECTION_MAP` (Phase 35) has had `COACH: ['capital', 'family'],` since v2.5 and is correctly kept. The plan author's intent (COACH structurally absent from `PSYCHOLOGICAL_PROFILE_INJECTION_MAP`'s key union) is satisfied via the type signature `Readonly<Record<'REFLECT' | 'PSYCHOLOGY', ...>>` and verified by `npx tsc --noEmit` passing — accessing `PSYCHOLOGICAL_PROFILE_INJECTION_MAP['COACH']` is a compile-time error. No code change needed; flagging this as a plan-spec wording inconsistency for future plans.

## Verification

- `npx tsc --noEmit`: exit 0 (clean).
- `npx vitest run` on the 6 critical test files: **165 / 165 passing.**
- `psych-boundary-audit.test.ts` (Phase 37 PSCH-10): **10 / 10 still green** — D047 boundary preserved; the new `formatPsychologicalProfilesForPrompt` resides in the shared `profiles.ts` module which is intentionally outside the audit scope per D-21.
- `coach-psychological-isolation.test.ts`: **1 / 1 green** — coach.ts contains zero `PSYCH_VOCAB` hits.
- `git diff --name-only HEAD~4..HEAD -- src/chris/modes/coach.ts`: empty (coach.ts unmodified across all 4 commits).
- Full Docker suite (`bash scripts/test.sh`): **1732 / 1785 passing.** The 30 failures are all pre-existing in test files NOT touched by Plan 39-01 (`live-integration`, `live-accountability`, `vague-validator-live`, `live-anti-flattery`, `models-smoke` — all live-API tests blocked by 401 in sandbox; `rituals/idempotency` — pre-existing concurrency timing edge case in M009 territory). Zero new failures introduced by Plan 39-01 changes.

## Requirements Closed

- **PSURF-01** (PSYCHOLOGICAL_PROFILE_INJECTION_MAP) — closed.
- **PSURF-02** (formatPsychologicalProfilesForPrompt with imported Hard Rule footer) — closed.
- **PSURF-03** (ChrisContextExtras + REFLECT/PSYCHOLOGY handler wiring + 5-mode silent drop) — closed.
- **PSURF-05** (COACH-isolation negative invariant via regex sweep) — half closed (COACH-isolation regex test ships here; the display-formatter + golden inline-snapshot half ships in Plan 39-02 atomically with PSURF-04 per HARD CO-LOC #M11-3).

## Note for Plan 39-02 Executor

`ProfileRow<T>.wordCountAtLastRun` is now populated by `readOnePsychologicalProfile` (threaded straight out of the Drizzle row via the new return-literal field). Consume it in `formatPsychologicalProfileForDisplay`'s "insufficient data — need N more words" branch via `N = max(0, 5000 - (profile.wordCountAtLastRun ?? 0))` per RESEARCH Open Q1 Option A. No second DB read required.

## Self-Check: PASSED

- File created: `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` — FOUND.
- Commit 1926ff4 — FOUND in `git log --all --oneline`.
- Commit 18c7019 — FOUND.
- Commit 2be61bf — FOUND.
- Commit 59b3f9d — FOUND.
- All 8 modified files exist on disk.
