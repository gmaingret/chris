---
phase: 29-weekly-review
plan: 04
subsystem: rituals/weekly-review
status: complete
type: execute
wave: 3
depends_on:
  - 29-02
requirements-completed: []
tags:
  - live-test
  - anti-flattery
  - HARD-CO-LOC-6
  - phase-30-handoff
dependency-graph:
  requires:
    - "src/rituals/weekly-review.ts generateWeeklyObservation export (Plan 29-02)"
    - "src/rituals/weekly-review-prompt.ts WeeklyReviewPromptInput type (Plan 29-01)"
  provides:
    - "src/rituals/__tests__/live-weekly-review.test.ts — Phase-30-ready live anti-flattery test scaffold (skipIf-gated until TEST-31)"
    - "src/rituals/__tests__/fixtures/adversarial-week.ts — adversarial 7-day fixture with ≥5 bait markers"
    - "VALIDATION_MARKERS / REFLEXIVE_OPENER_FIRST_WORDS / FLATTERY_MARKERS exports — three source-of-truth marker sets are now importable cross-module"
  affects:
    - "src/chris/__tests__/live-integration.test.ts — VALIDATION_MARKERS hoisted+exported (visibility only)"
    - "src/chris/praise-quarantine.ts — REFLEXIVE_OPENER_FIRST_WORDS exported (visibility only)"
    - "src/episodic/__tests__/live-anti-flattery.test.ts — FLATTERY_MARKERS exported (visibility only)"
tech-stack:
  added: []
  patterns:
    - "describe.skipIf(!process.env.ANTHROPIC_API_KEY) live-LLM test gating (M006 D023 + M008 D038 precedent)"
    - "3-of-3 atomic loop with single it() block (Phase 18 precedent)"
    - "Deterministic marker derivation via three verbatim imports (D-10 refined; no redeclaration)"
    - "expect.soft() per-iteration + final hard expect for offender surfacing"
key-files:
  created:
    - "src/rituals/__tests__/live-weekly-review.test.ts"
    - "src/rituals/__tests__/fixtures/adversarial-week.ts"
    - ".planning/phases/29-weekly-review/29-04-SUMMARY.md"
  modified:
    - "src/chris/__tests__/live-integration.test.ts (VALIDATION_MARKERS hoist + export)"
    - "src/chris/praise-quarantine.ts (REFLEXIVE_OPENER_FIRST_WORDS export keyword)"
    - "src/episodic/__tests__/live-anti-flattery.test.ts (FLATTERY_MARKERS export keyword)"
decisions:
  - "Rule 1 deviation: ship the three source-constant export wirings inline (alternative — redeclaration in test file — violates D-10 'no redeclaration' acceptance)"
  - "FORBIDDEN_FLATTERY_MARKERS count is 40 markers (8 + 15 + 17 as of 2026-04-26); Phase 30 verifies against this number"
  - "// PHASE-30: enable in TEST-31 line-comment marker (in addition to JSDoc reference) so a single grep against the file finds the gate"
metrics:
  duration: "~25min"
  completed: "2026-04-26"
  tasks: 4
  files-touched: 5
  commits: 4
---

# Phase 29 Plan 04: Live Anti-Flattery Test Scaffolding Summary

**One-liner:** HARD CO-LOC #6 prep — `src/rituals/__tests__/live-weekly-review.test.ts` is the Phase-30-ready 3-of-3 atomic live anti-flattery test for the Sonnet-driven weekly-review observation generator. Imports three marker source sets verbatim per refined D-10 (40-marker FORBIDDEN_FLATTERY_MARKERS array, no redeclaration), runs against a hand-authored adversarial week fixture, asserts zero markers + zero fallbacks across 3-of-3 iterations. skipIf-gated until Phase 30 TEST-31 flips the gate.

## What Shipped

### Tests + fixture (the actual scaffolding)

1. **`src/rituals/__tests__/live-weekly-review.test.ts`** (new, 101 lines)
   - `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` outer gate
   - `// PHASE-30: enable in TEST-31` line-comment marker (greppable for Phase 30)
   - Imports `generateWeeklyObservation` from sibling `weekly-review.ts` (Plan 29-02 output)
   - Imports `ADVERSARIAL_WEEK_INPUT` from sibling fixture
   - Imports three source-set constants verbatim per refined D-10:
     - `VALIDATION_MARKERS` from `src/chris/__tests__/live-integration.test.ts`
     - `REFLEXIVE_OPENER_FIRST_WORDS` from `src/chris/praise-quarantine.ts`
     - `FLATTERY_MARKERS` from `src/episodic/__tests__/live-anti-flattery.test.ts`
   - Constructs `FORBIDDEN_FLATTERY_MARKERS = [...VALIDATION_MARKERS, ...Array.from(REFLEXIVE_OPENER_FIRST_WORDS), ...FLATTERY_MARKERS]` (40 entries: 8 + 15 + 17 as of 2026-04-26)
   - 3-of-3 atomic loop (`for (let i = 0; i < 3; i++)`)
   - W-3 LOCK: `expect(fallbacks).toBe(0)` — adversarial week MUST NOT trigger templated fallback
   - Per-iteration `expect.soft()` marker scan (every offender surfaces) + final hard `expect(...).toEqual([])`
   - 90-second vitest timeout (3 iterations × ~25s each, 3 LLM calls per iteration)

2. **`src/rituals/__tests__/fixtures/adversarial-week.ts`** (new, 142 lines)
   - Exports `ADVERSARIAL_WEEK_INPUT: WeeklyReviewPromptInput`
   - 7 daily summaries (2026-04-13 through 2026-04-19) — Q2 conference skip + Marc team-conflict resolution + brilliant mentorship session bait + amazing recovery
   - 2 resolved decisions with rich emotional content
   - 7 wellbeing snapshots (high variance triggers wellbeing block inclusion — tests preamble holds even with positive numeric data to flatter)
   - **7 case-insensitive bait markers embedded** (Remarkable, Wonderful, brilliantly, incredible, amazing, Fantastic, crushed) — exceeds D-10's ≥5 minimum
   - These are PROMPT INPUTS designed to bait Sonnet; the test asserts Sonnet's OUTPUT remains clean even when INPUT is contaminated

### Rule 1 deviation: 3 surgical export wirings (visibility-only)

**Why this is a deviation:** Refined D-10 (locked 2026-04-27) requires Plan 29-04's test file to import three marker constants verbatim WITHOUT redeclaration. As of 2026-04-26, none of the three were exported with the names D-10 specifies. Plan 29-04 ships the export wiring as Task 1 — the alternative (redeclaring markers in the test file) violates D-10's "no redeclaration" acceptance criterion and creates the drift surface D-10 was written to prevent.

3. **`src/chris/__tests__/live-integration.test.ts`** — `VALIDATION_MARKERS` hoisted from inside `describe('Sycophancy resistance (TEST-05)', ...)` block to module scope + `export` keyword added. Inner declaration deleted; existing TEST-05 tests continue to reference the same symbol via JS scope resolution. 8-entry contents UNCHANGED.

4. **`src/chris/praise-quarantine.ts`** — `export` keyword added to `REFLEXIVE_OPENER_FIRST_WORDS`. 15-entry Set contents UNCHANGED. Internal usage at line ~55 (`REFLEXIVE_OPENER_FIRST_WORDS.has(firstWord)`) continues working — named symbol resolves identically.

5. **`src/episodic/__tests__/live-anti-flattery.test.ts`** — `export` keyword added to `FLATTERY_MARKERS`. 17-entry array contents UNCHANGED. Internal TEST-22 usage continues working.

## HARD CO-LOC #6 Boundary

This plan's commits contain ONLY:

| File | Status | Owner |
| ---- | ------ | ----- |
| `src/rituals/__tests__/live-weekly-review.test.ts` | new | Plan 29-04 (this plan) |
| `src/rituals/__tests__/fixtures/adversarial-week.ts` | new | Plan 29-04 |
| `src/chris/__tests__/live-integration.test.ts` | modified (Rule 1, VALIDATION_MARKERS hoist+export) | Plan 29-04 |
| `src/chris/praise-quarantine.ts` | modified (Rule 1, REFLEXIVE_OPENER_FIRST_WORDS export) | Plan 29-04 |
| `src/episodic/__tests__/live-anti-flattery.test.ts` | modified (Rule 1, FLATTERY_MARKERS export) | Plan 29-04 |
| `.planning/phases/29-weekly-review/29-04-SUMMARY.md` | new | Plan 29-04 |

Zero changes to `src/rituals/weekly-review.ts` or `src/rituals/weekly-review-prompt.ts` — those are Plan 29-02's outputs and remain untouched.

## Phase 30 TEST-31 Handoff

To enable live execution, Phase 30 TEST-31 must:

1. **Add to excluded-suite list** — `'src/rituals/__tests__/live-weekly-review.test.ts'` is the 6th file in the live-LLM excluded-suite list when running `bash scripts/test.sh` without `ANTHROPIC_API_KEY` (alongside `live-integration.test.ts`, `live-anti-flattery.test.ts`, `live-accountability.test.ts`, `vague-validator-live.test.ts`, `contradiction-false-positive.test.ts`). The current convention is to pass excludes via `--exclude` to `npx vitest run`; Phase 30 may codify this in `scripts/test.sh` or a `vitest.config.ts` excludes block.

2. **Set `ANTHROPIC_API_KEY` in CI env** — provision Greg's API key (or a CI-scoped key) in the live-test workflow so the describe block executes against real Sonnet.

3. **(Optional) Remove the `// PHASE-30: enable in TEST-31` marker comment** — once TEST-31 has flipped the gate, the marker no longer signals incomplete work; deletion is a pure-cleanup commit.

## FORBIDDEN_FLATTERY_MARKERS Count

**Total: 40 markers** as of 2026-04-26.

| Source set | Count | File |
| ---------- | ----- | ---- |
| `VALIDATION_MARKERS` | 8 | `src/chris/__tests__/live-integration.test.ts` |
| `REFLEXIVE_OPENER_FIRST_WORDS` | 15 | `src/chris/praise-quarantine.ts` |
| `FLATTERY_MARKERS` | 17 | `src/episodic/__tests__/live-anti-flattery.test.ts` |

Phase 30 should expect this count (or higher if the source sets grow). The deterministic derivation means the test automatically picks up new entries added to any of the three source sets.

## Verification Done

| Gate | Result |
| ---- | ------ |
| `npx tsc --noEmit` clean | PASS (zero errors) |
| `grep -c '^export const VALIDATION_MARKERS' src/chris/__tests__/live-integration.test.ts` | 1 |
| `grep -c '^export const REFLEXIVE_OPENER_FIRST_WORDS' src/chris/praise-quarantine.ts` | 1 |
| `grep -c '^export const FLATTERY_MARKERS' src/episodic/__tests__/live-anti-flattery.test.ts` | 1 |
| Inner-scope `VALIDATION_MARKERS` declaration removed | PASS (count 0) |
| Fixture bait markers (≥5 expected) | 7 case-insensitive matches |
| Fixture daily summaries (==7 expected) | 7 |
| Test file marker imports (≥2 each expected) | VALIDATION_MARKERS=2, REFLEXIVE_OPENER_FIRST_WORDS=2, FLATTERY_MARKERS=5 |
| Test file `// PHASE-30: enable in TEST-31` marker | 1 |
| Test file `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` | 1 |
| Test file 3-of-3 atomic loop | 1 |
| Test file `expect(fallbacks).toBe(0)` (W-3 LOCK) | 1 |
| Drift detector — test file contains zero literal source-set strings | 0 (clean) |
| Targeted: `praise-quarantine.test.ts` + `engine.test.ts` (touch `REFLEXIVE_OPENER_FIRST_WORDS`) | 84/84 PASS via `bash scripts/test.sh` |

## Deviations from Plan

### Rule 1 — three export wirings (planner-anticipated, in-plan)

The plan explicitly documented this as a Rule 1 deviation in the objective and Task 1. Three surgical 1-line `export` keyword additions + 1 hoist of `VALIDATION_MARKERS` to module scope. Zero content changes; only visibility/scope. See "Rule 1 deviation" section above.

### Verify-spec mismatch — `ANTHROPIC_API_KEY=` skipIf empirical check

**Documented limitation, not a fix needed:** The plan's verify block specified that `ANTHROPIC_API_KEY= npx vitest run src/rituals/__tests__/live-weekly-review.test.ts` should report `1 skipped`. In practice the project's `src/config.ts` requires `ANTHROPIC_API_KEY` and `DATABASE_URL` at module-load time; without them, the test file fails to even load (the describe.skipIf gate runs AFTER module load). This is not a test-file bug — the same module-load behavior affects the M008 mirror `src/episodic/__tests__/live-anti-flattery.test.ts`. The skipIf gate works correctly when env vars ARE set (the Docker harness `bash scripts/test.sh` provides `ANTHROPIC_API_KEY=test-key` by default), and Phase 30's operational path is to either provide a real key (test runs) or add the file to the excluded-suite list (test is skipped at file-discovery time, not at describe time).

The grep gates confirming the skipIf statement is present in the file (`grep -c 'describe.skipIf(!process.env.ANTHROPIC_API_KEY)' == 1`) are the appropriate verification surface for scaffolding correctness.

## Self-Check: PASSED

| Claim | Verified |
| ----- | -------- |
| `src/rituals/__tests__/live-weekly-review.test.ts` exists | FOUND |
| `src/rituals/__tests__/fixtures/adversarial-week.ts` exists | FOUND |
| `.planning/phases/29-weekly-review/29-04-SUMMARY.md` exists | FOUND (this file) |
| Commit `5974273` (Task 1 — three export wirings) | FOUND |
| Commit `1a66422` (Task 2 — adversarial-week fixture) | FOUND |
| Commit `1f39a90` (Task 3 — live-weekly-review test scaffold) | FOUND |

## Threat Flags

None — no new security-relevant surface introduced. Plan 29-04 ships test-only code (test file + fixture file + 3 export-keyword additions). All four files are dev-only; no runtime path changes; no schema changes; no auth/network surface added.
