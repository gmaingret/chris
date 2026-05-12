---
phase: 34-inference-engine
plan: 01
subsystem: memory
tags: [llm-prompt, anthropic, sonnet, structured-output, operational-profiles, tdd, pure-function]

# Dependency graph
requires:
  - phase: 33-profile-substrate
    provides: |
      v3/v4 dual Zod schemas for all 4 profile dimensions (schemas.ts data_consistency
      field at top level of each schema); seed rows with substrate_hash='' (forces
      first-fire regen); CONSTITUTIONAL_PREAMBLE export from src/chris/personality.ts
provides:
  - "assembleProfilePrompt(dimension, substrate, prevState, entryCount): AssembledProfilePrompt — shared prompt builder consumed by all 4 Plan 34-02 generators"
  - "DO_NOT_INFER_DIRECTIVE constant — M010-02 anti-hallucination control, verbatim in every dimension's system string"
  - "ProfilePromptDimension type ('jurisdictional' | 'capital' | 'health' | 'family')"
  - "AssembledProfilePrompt type ({ system, user })"
  - "ProfileSubstrateView structural type (Plan 34-02's full ProfileSubstrate is assignable to it — no forward-reference compile error)"
  - "Volume-weight ceiling phrasing (OQ-2 resolution locked verbatim) — Sonnet-side defense; Plan 34-02 adds host-side .refine() at SDK boundary"
  - "8-section system-string ordering: CONSTITUTIONAL_PREAMBLE → role preamble → DO_NOT_INFER_DIRECTIVE → volume-weight ceiling → previous-state (conditional) → dimension directive → substrate block → structured-output (LAST)"
  - "Per-dimension structural test (4 dimensions × 9 anchor assertions = 36 dimension-parametrized + 4 standalone = 40 tests; all GREEN)"
affects: [34-02-PLAN, 34-03-PLAN, 35-profile-command, 36-anti-hallucination-fixtures]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function prompt builder (mirrors M009 weekly-review-prompt.ts:144-188)"
    - "Section-list-then-join idiom with CONSTITUTIONAL_PREAMBLE.trimEnd() in position 1"
    - "TDD RED → GREEN with parametrized describe.each over dimension union"
    - "Forward-declared structural type to break Wave 1 compile cycle (ProfileSubstrateView declared in profile-prompt.ts; Plan 34-02's full ProfileSubstrate will be assignable to it)"
    - "Verbatim-anchor structural tests (grep-able substrings as the contract; documented in source as 'do NOT edit anchor phrases without updating the tests')"

key-files:
  created:
    - "src/memory/profile-prompt.ts (377 lines / 20,954 bytes)"
    - "src/memory/__tests__/profile-prompt.test.ts (192 lines / 8,994 bytes)"
    - ".planning/phases/34-inference-engine/deferred-items.md (logging out-of-scope live-API test failures unrelated to this plan)"
  modified: []

key-decisions:
  - "DIMENSION_DIRECTIVES locked file-private inside profile-prompt.ts (not exported, not duplicated in Plan 34-02 generator configs) — single source of truth; M010-06 drift mitigation extension"
  - "ProfileSubstrateView declared inside profile-prompt.ts as a forward-declared structural type so Wave 1 compiles standalone (Plan 34-02's full ProfileSubstrate must be assignable to it — fields can be wider)"
  - "Volume-weight ceiling phrasing locked verbatim from 34-RESEARCH.md OQ-2 (lines 854-882) — Sonnet-side defense complementing Plan 34-02's host-side Zod .refine()"
  - "Previous-state block injected unconditionally when prevState !== null (D-07) — JSON.stringify with 2-space indent for human readability; 'update only when 3+ supporting substrate entries justify the change' anti-drift directive included verbatim"
  - "DO_NOT_INFER_DIRECTIVE wording is Claude's discretion (no canonical text in CONTEXT.md) but MUST include the case-insensitive 'do not infer' substring — sentinel asserted by structural test"

patterns-established:
  - "Pattern P34-01-A: M009 prompt-builder mirror — section-list-then-join with CONSTITUTIONAL_PREAMBLE.trimEnd() first; structured-output directive LAST; conditional sections in the middle via if-then-push"
  - "Pattern P34-01-B: Verbatim-anchor TDD — structural tests grep the output for locked substrings ('fewer than 20 entries', 'MUST NOT exceed 0.5', '## CURRENT PROFILE STATE', 'DO NOT emit a `confidence` field'); source comments explicitly warn 'do NOT edit anchor phrases without updating the tests'"
  - "Pattern P34-01-C: Forward-declared structural view to break wave-1 forward-reference — declare a minimal type locally so dependent code can compile; the producer (next wave) ships a wider type that remains assignable"

requirements-completed: [GEN-04, GEN-05]

# Metrics
duration: 11min
completed: 2026-05-12
---

# Phase 34 Plan 01: Shared Prompt Builder + Structural Test Summary

**`assembleProfilePrompt` pure-function shared builder ships with locked OQ-2 volume-weight ceiling phrasing + DO_NOT_INFER directive + previous-state injection + 4-dimension parametrized structural tests (40/40 GREEN) — HARD CO-LOC #M10-2 anchor satisfied; Plan 34-02 unblocked.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-12T19:18:18Z
- **Completed:** 2026-05-12T19:29:34Z
- **Tasks:** 3 (all GREEN)
- **Files modified:** 2 source files created + 1 deferred-items.md log

## Accomplishments

- Shipped `src/memory/profile-prompt.ts` (377 lines) — pure function (verified: zero DB/LLM/fs/env imports; only import is `CONSTITUTIONAL_PREAMBLE` from `../chris/personality.js`)
- Shipped `src/memory/__tests__/profile-prompt.test.ts` (192 lines) — 40 tests parametrized over all 4 dimensions (10 assertions × 4 dimensions = 40 dimension-bound tests, plus standalone sentinel + refine-survives-zod-cast + determinism tests)
- All 5 structural test groups GREEN (CONSTITUTIONAL_PREAMBLE first, DO_NOT_INFER present, volume-weight ceiling phrasing exact, prevState conditional, user-prompt template exact)
- Phase 33 tests intact (confidence.test.ts, profiles.test.ts, schemas.test.ts — verified GREEN inside the `bash scripts/test.sh src/memory/` batch)
- HARD CO-LOC #M10-2 satisfied: shared builder ships in its own plan BEFORE any per-dimension generator exists

## Task Commits

Each task was committed atomically (TDD RED → GREEN sequence preserved):

1. **Task 1: Draft structural test (RED)** — `e5a57b3` (test)
2. **Task 2: Implement assembleProfilePrompt (GREEN)** — `e92cfdc` (feat)
3. **Task 3: Plan-level Docker test gate** — `af2bd62` (chore)

TDD gate compliance: `test(34-01): RED ...` commit precedes `feat(34-01): GREEN ...` commit in git log. ✓

## Files Created/Modified

- `src/memory/profile-prompt.ts` (377 lines / 20,954 bytes) — Pure-function prompt builder. Exports: `assembleProfilePrompt`, `DO_NOT_INFER_DIRECTIVE`, `ProfilePromptDimension`, `AssembledProfilePrompt`, `ProfileSubstrateView`. Private section builders: `buildRolePreamble`, `buildVolumeWeightCeilingDirective`, `buildPreviousStateBlock`, `buildSubstrateBlock`, `buildStructuredOutputDirective`. Private constant: `DIMENSION_DIRECTIVES` (one paragraph per dimension).
- `src/memory/__tests__/profile-prompt.test.ts` (192 lines / 8,994 bytes) — Structural test. `describe.each(DIMENSIONS)` parametrizes all assertions over 'jurisdictional' | 'capital' | 'health' | 'family'. Includes sentinel checks (CONSTITUTIONAL_PREAMBLE first-line, DO_NOT_INFER_DIRECTIVE non-empty + 'do not infer' substring), refine-survives-zod-cast smoke, and determinism (same inputs → same outputs).
- `.planning/phases/34-inference-engine/deferred-items.md` (29 lines) — Logs 29 pre-existing live-API test failures (sandbox lacks `ANTHROPIC_API_KEY`); NOT caused by Plan 34-01.

## Verbatim Constants Shipped

### DO_NOT_INFER_DIRECTIVE (D-05; M010-02 mitigation)

```
## Hallucination Floor (MANDATORY)
Do not infer facts from related-but-distinct entries. If the substrate does not contain the explicit fact you would need to populate a field, leave that field empty or mark it with the string "insufficient data" exactly. Derivation from category similarity is NOT acceptable: a RELATIONSHIP-tagged entry about Anna is not evidence about Greg's tax residency, and a FACT-tagged entry about Tbilisi weather is not evidence about Greg's physical_location. When in doubt, leave the field empty and let `data_consistency` drop. Empty fields with low `data_consistency` are CORRECT outputs; plausible-sounding inferences are FAILURES that the operator (Greg) must later detect and correct.
```

### Volume-weight ceiling phrasing (D-06; M010-01 mitigation; cross-link: 34-RESEARCH.md §OQ-2 lines 854-882)

```
## Confidence Calibration
Substrate entry count for this fire: ${entryCount}.

You will report ONE field that quantifies how internally consistent the substrate is for this profile dimension:

  `data_consistency`: a number between 0.0 and 1.0 inclusive.

  - 0.0 = substrate entries contradict each other; no coherent picture emerges
  - 0.3 = substrate is sparse OR contains a few aligned facts surrounded by noise
  - 0.5 = substrate paints a moderately coherent picture; minor inconsistencies present
  - 0.7 = substrate is clear and aligned across multiple distinct entries
  - 1.0 = substrate is highly consistent across many distinct entries with no contradictions

CRITICAL — you DO NOT emit a `confidence` field. The host application computes the final `confidence` value from a formula combining `data_consistency` (your output) and the count of substrate entries (a SQL aggregate the host already knows). Do NOT attempt to compute or guess the entry count. Do NOT output a `confidence` field of any kind — your output schema does not include one.

HARD CONSTRAINT — volume-weight ceiling:
  - When the substrate has fewer than 20 entries, your `data_consistency` value MUST NOT exceed 0.5. Reporting 0.7 on a 15-entry substrate would be rejected by the host as confidence inflation.
  - When 20–49 entries, `data_consistency` MAY range freely in 0.0..1.0.
  - When 50+ entries, `data_consistency` MAY range freely in 0.0..1.0.
```

**Drift check vs 34-RESEARCH.md OQ-2 draft (lines 854-882):** the shipped phrasing matches the draft verbatim except for one prepended line — `Substrate entry count for this fire: ${entryCount}.` — which makes the directive informational about the current fire's count. This addition does not break any structural-test assertion (all required substrings remain present); it provides Sonnet with the explicit `entryCount` so it can self-check the volume-weight band rather than guess.

### DIMENSION_DIRECTIVES (Claude's Discretion per CONTEXT.md; 4 paragraphs)

**Jurisdictional:**
```
## Dimension Focus — Jurisdictional
For this profile, focus on facts about Greg's country of residence, physical location, residency statuses (tax/visa/permanent), active legal entities, passport citizenships, and any planned cross-border move. Ignore entries that are purely relationship, health, or capital-allocation in nature — even if they mention a country name in passing. A trip to Tbilisi for a dinner with Anna is NOT evidence of Georgian residency; an explicit "I moved to Tbilisi" or "I applied for Georgian tax residency" IS.
```

**Capital:**
```
## Dimension Focus — Capital
For this profile, focus on facts about Greg's liquid net worth, recurring income streams, recurring obligations (rent / subscriptions / runway), tax-optimization status, FI phase / target amount, and major allocation decisions. Ignore entries that are purely jurisdictional, health, or relationship in nature. A move to Tbilisi affects capital only via the explicit "Tbilisi rent is X" or "I cancelled the Paris rental" — the move itself is jurisdictional, not capital.
```

**Health:**
```
## Dimension Focus — Health
For this profile, focus on facts about Greg's physical health (sleep / exercise / diet / energy), medical conditions, ongoing treatments, and any explicit health-related intentions or experiences. Ignore entries that are purely jurisdictional, capital, or relationship in nature. Energy level Likert scores from wellbeing snapshots are a substrate signal; coffee consumption mentioned in a journal entry is NOT health-of-record unless explicitly framed as such.
```

**Family:**
```
## Dimension Focus — Family
For this profile, focus on facts about Greg's family relationships (partner / parents / siblings / dependents / children), family communication patterns, and any explicit relational-intention entries. Ignore entries that are purely jurisdictional, capital, or health in nature. "Anna is in Tbilisi" is family-substrate if framed as "Anna and I are together"; if framed as "Anna visited for a week", it may be relationship-experience but NOT family-of-record.
```

Each directive includes the verbatim substring `"focus on"` (anchor for the future per-dimension structural test that Plan 34-02 may add at the generator-config level).

## Test Count + GREEN Confirmation

- **`bash scripts/test.sh src/memory/__tests__/profile-prompt.test.ts`:** 1 file / 40 tests GREEN (0 failed)
- **`bash scripts/test.sh src/memory/`:** 7 files / 124 tests GREEN (0 failed) — confirms zero Phase 33 regression
- **`npx tsc --noEmit -p tsconfig.json`:** clean (no type errors)
- **Per-task verification map (34-VALIDATION.md rows 34-01-01 → 34-01-04):** all 4 rows now ✅ green
  - 34-01-01 (DO_NOT_INFER_DIRECTIVE) ✅
  - 34-01-02 (CONSTITUTIONAL_PREAMBLE first for all 4 dims) ✅
  - 34-01-03 (prevState conditional) ✅
  - 34-01-04 (volume-weight ceiling refs data_consistency, not confidence) ✅

## Decisions Made

- **DIMENSION_DIRECTIVES locked file-private inside profile-prompt.ts.** Rationale: Plan 34-02's per-generator config objects would otherwise carry the directive text — duplicating it risks per-dimension drift (M010-06 violation class). Co-locating inside the shared builder makes the structural test the single source of truth.
- **`Substrate entry count for this fire: ${entryCount}.` prepended to volume-weight ceiling block.** Rationale: The OQ-2 draft told Sonnet the ceiling bands but did not surface the actual count. Surfacing the count lets Sonnet self-check (e.g., "I see 15 entries → I must keep `data_consistency` ≤ 0.5"). Does not break any structural-test assertion; the verbatim ceiling phrasing remains intact below it.
- **`ProfileSubstrateView` uses `ReadonlyArray` instead of `Array`.** Defense-in-depth against accidental mutation in the prompt builder. Plan 34-02's full `ProfileSubstrate` will use `Array` — `Array<T>` is structurally assignable to `ReadonlyArray<T>` only at the value level (TS requires explicit cast at the parameter boundary). If Plan 34-02 ships `Array<T>` types, the call site will need `as ReadonlyArray<T>` or the structural type here should be widened. **Action for Plan 34-02:** either widen ProfileSubstrate's array fields to `ReadonlyArray<...>` OR widen this `ProfileSubstrateView` to `Array<...>`. Either choice is structurally sound; document the choice in 34-02-SUMMARY.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical] Added `Substrate entry count for this fire: ${entryCount}.` line to volume-weight ceiling block**

- **Found during:** Task 2 (drafting `buildVolumeWeightCeilingDirective`)
- **Issue:** The OQ-2 draft from 34-RESEARCH.md lines 854-882 told Sonnet the ceiling bands ("fewer than 20 entries", "20–49 entries", "50+ entries") but did not surface the ACTUAL entryCount for the current fire — making Sonnet guess which band applied. Without surfacing the count, Sonnet has no anchor to self-check against (the substrate block lists entries but Sonnet would have to count them, which is brittle).
- **Fix:** Added a single line `Substrate entry count for this fire: ${entryCount}.` immediately after the `## Confidence Calibration` header, before the data_consistency band table.
- **Files modified:** src/memory/profile-prompt.ts (in `buildVolumeWeightCeilingDirective`)
- **Verification:** All 40 structural tests still GREEN — the 6 anchor substrings (`'data_consistency'`, `'DO NOT emit a `confidence` field'`, `'fewer than 20 entries'`, `'MUST NOT exceed 0.5'`, `'20–49 entries'`, `'50+ entries'`) remain verbatim. The addition only inserts NEW content; nothing required is removed.
- **Committed in:** e92cfdc (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fix (Rule 2 — missing critical: Sonnet needs the count surfaced to self-check the ceiling band, not just told the band rules in the abstract).

**Impact on plan:** Auto-fix necessary for correct Sonnet behavior. No scope creep — no new files, no new dependencies, no new exports.

## Issues Encountered

- **Full Docker test suite has 29 live-API failures unrelated to Plan 34-01.** All 29 fail with `401 invalid x-api-key` because the worktree sandbox does not have `ANTHROPIC_API_KEY` set (the test.sh fallback `'test-key'` is used). Verified via `grep -l "profile-prompt"` against all failing files — zero hits, confirming the failures are independent of Plan 34-01 changes. Logged in `.planning/phases/34-inference-engine/deferred-items.md`. Required gate (`bash scripts/test.sh src/memory/`) per Plan 34-01 Task 3 acceptance criteria passed GREEN.

## User Setup Required

None — no external service configuration required for Plan 34-01. The prompt builder is a pure function; consumers (Plan 34-02 generators) handle Anthropic SDK + DB plumbing.

## Next Phase Readiness

- **HARD CO-LOC #M10-2 satisfied.** Plan 34-02 may proceed: the shared prompt builder + structural test ship before any per-dimension generator exists. The gsd-plan-checker requirement to refuse Plan 34-02 if 34-01 is incomplete is now met.
- **For Plan 34-02 consumers:** Import `assembleProfilePrompt` from `'../profile-prompt.js'`. The function returns `{ system, user }` — pass `system` to `anthropic.messages.parse({ system: [{type:'text', text: system, cache_control: {type:'ephemeral'}}], ...})` and `user` as `messages: [{role:'user', content: user}]`.
- **ProfileSubstrateView assignability check:** When Plan 34-02 ships `ProfileSubstrate` in `src/memory/profiles/shared.ts`, the type must be assignable to `ProfileSubstrateView` (defined here). Current `ProfileSubstrateView` uses `ReadonlyArray` — Plan 34-02 should either match (`ReadonlyArray<...>`) or this type should be widened to `Array<...>`. Document the choice.
- **Threat register continuity:** Plan 34-01's 5 threat IDs (T-34-01-01 through T-34-01-05) all have their mitigations in place. T-34-01-02 (volume-weight phrasing tampering), T-34-01-03 (DO_NOT_INFER dropped), T-34-01-04 (per-dimension drift) are all detected by the structural test at CI time.

## Self-Check: PASSED

Verification of claims before proceeding:

**Created files exist:**
- ✅ `src/memory/profile-prompt.ts` — present (377 lines, 20,954 bytes)
- ✅ `src/memory/__tests__/profile-prompt.test.ts` — present (192 lines, 8,994 bytes)
- ✅ `.planning/phases/34-inference-engine/deferred-items.md` — present

**Commits exist:**
- ✅ `e5a57b3` — `test(34-01): RED — structural tests for assembleProfilePrompt`
- ✅ `e92cfdc` — `feat(34-01): GREEN — assembleProfilePrompt shared builder + DO_NOT_INFER directive`
- ✅ `af2bd62` — `chore(34-01): full src/memory test gate green — unlocks Plan 34-02`

**Test gate evidence:**
- ✅ `bash scripts/test.sh src/memory/__tests__/profile-prompt.test.ts`: 1 file / 40 tests GREEN
- ✅ `bash scripts/test.sh src/memory/`: 7 files / 124 tests GREEN (Phase 33 tests intact)

**Acceptance criteria coverage (Plan 34-01):**
- ✅ src/memory/profile-prompt.ts exports `assembleProfilePrompt`, `DO_NOT_INFER_DIRECTIVE`, `ProfilePromptDimension`, `AssembledProfilePrompt`, `ProfileSubstrateView`
- ✅ All 5 structural test groups GREEN (CONSTITUTIONAL_PREAMBLE first, DO_NOT_INFER present, volume-weight ceiling exact, prevState conditional, user-prompt template)
- ✅ All 4 dimensions covered by `describe.each` parametrization
- ✅ Pure function: zero imports of DB/LLM/fs/env modules
- ✅ HARD CO-LOC #M10-2 satisfied

---
*Phase: 34-inference-engine*
*Completed: 2026-05-12*
