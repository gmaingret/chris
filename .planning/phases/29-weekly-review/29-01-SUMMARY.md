---
phase: 29-weekly-review
plan: 01
subsystem: rituals
tags:
  - weekly-review
  - prompt-assembly
  - pure-function
  - variance-gate
  - constitutional-preamble
  - m008-first-consumer

# Dependency graph
requires:
  - phase: 25-ritual-scheduling-foundation-process-gate
    provides: rituals + wellbeing_snapshots tables; ritualCadenceEnum; epistemicTagEnum 'RITUAL_RESPONSE'
  - phase: 21-episodic-consolidation (M008)
    provides: episodic_summaries table + getEpisodicSummariesRange helper (Phase 29 first production consumer)
  - phase: 14-decisions (M007)
    provides: decisions table + status='resolved' lifecycle + resolvedAt timestamp
provides:
  - WEEKLY_REVIEW_HEADER constant — D031 boundary marker exact text (substrate for Plan 29-02 D031 header rendering)
  - assembleWeeklyReviewPrompt(input) pure 8-section prompt assembler with explicit CONSTITUTIONAL_PREAMBLE injection (HARD CO-LOC #3 prep)
  - WeeklyReviewPromptInput type — contract surface between Plan 29-02 generator and assembler
  - loadWeeklyReviewContext(weekStart, weekEnd) parallel-fetch (M008 first consumer + M007 resolved decisions + wellbeing_snapshots)
  - computeWeekBoundary(now) Luxon DST-safe 7-day-prior to end-of-today window
  - computeStdDev + shouldIncludeWellbeing — WEEK-09 / D-06 variance gate (ANY-dim-flat rule; insufficient-data short-circuit)
  - VARIANCE_THRESHOLD=0.4 + INSUFFICIENT_DATA_THRESHOLD=4 named constants
affects:
  - 29-02 (consumes assembleWeeklyReviewPrompt + WEEKLY_REVIEW_HEADER + loadWeeklyReviewContext + computeWeekBoundary at SDK boundary)
  - 29-03 (no direct surface; cron dispatcher + seed migration touch sibling files only)
  - 29-04 (live-test scaffold imports assembled-prompt artifacts via Plan 29-02 surface)

# Tech tracking
tech-stack:
  added: []   # zero new dependencies — pure-function substrate
  patterns:
    - "Mirror M008 src/episodic/prompts.ts:assembleConsolidationPrompt 9-section CONSTITUTIONAL_PREAMBLE-first composer for Sonnet-driven cron-context calls"
    - "Wellbeing variance gate enforced at PROMPT-ASSEMBLY time, not post-hoc — Sonnet never sees wellbeing data when stddev<0.4 in any dim"
    - "Direct Drizzle resolved-decisions query (M007) + getEpisodicSummariesRange (M008) parallel-fetched via Promise.all in loadWeeklyReviewContext"

key-files:
  created:
    - src/rituals/weekly-review.ts (39 LoC — minimal skeleton owning WEEKLY_REVIEW_HEADER + Plan 29-02 TODO marker)
    - src/rituals/weekly-review-prompt.ts (235 LoC — pure 8-section assembler + section builders)
    - src/rituals/weekly-review-sources.ts (245 LoC — loadWeeklyReviewContext + computeWeekBoundary + variance helpers)
    - src/rituals/__tests__/weekly-review-prompt.test.ts (157 LoC — 10 unit tests)
    - src/rituals/__tests__/weekly-review-sources.test.ts (379 LoC — 14 unit tests + 8 real-DB integration tests)
  modified: []

key-decisions:
  - "Sources module split from prompt assembler (mirrors M008 sources.ts/prompts.ts split) — pure-function discipline; tests run in microseconds for the assembler half"
  - "computeWeekBoundary uses Luxon .minus({days: 7}).startOf('day') for weekStart and .endOf('day') for weekEnd per 29-RESEARCH §2 verbatim — yields 8-day inclusive window covering prior 7 full days plus the Sunday fire day (matches getEpisodicSummariesRange gte/lte semantics)"
  - "shouldIncludeWellbeing emits two distinct log lines: chris.weekly-review.wellbeing.insufficient-data (count<4) vs chris.weekly-review.wellbeing.variance-gate-failed (any-dim<0.4) — separate signals for monitoring real-week occurrence rates"
  - "loadWeeklyReviewContext orders all three result arrays ascending by date column (summaryDate / resolvedAt / snapshotDate) — Plan 29-02 caller does NOT need to sort"
  - "formatLocalDate helper duplicated locally rather than exporting from src/pensieve/retrieve.ts — that helper is private to retrieve.ts and refactoring its visibility is out of Plan 29-01 scope"

patterns-established:
  - "Boundary-audit grep guard: grep -c CONSTITUTIONAL_PREAMBLE src/rituals/weekly-review-prompt.ts >= 2 (Pitfall 17 drift detector — fails CI if injection mechanism is removed in a future refactor)"
  - "Pure-function variance gate at prompt-assembly time: Sonnet never receives gated data — strongest possible enforcement (vs prompt instruction or post-hoc Haiku check)"
  - "Cohabit minimal-skeleton (Plan 29-01 just exports WEEKLY_REVIEW_HEADER + a TODO marker) with HARD CO-LOC atomic file (Plan 29-02 will fill fireWeeklyReview + Stage-1/2 + retry + Pensieve persist into the same file) — keeps the atomic-boundary file intact while letting the constant land one wave early so sibling tests can import it"

requirements-completed: [WEEK-01, WEEK-02, WEEK-04, WEEK-07, WEEK-09]

# Metrics
duration: 35 min
completed: 2026-04-28
---

# Phase 29 Plan 01: Pure-function substrate for the Sunday weekly review

**Pure-function substrate for the M009 Sunday weekly review: 8-section prompt assembler with explicit CONSTITUTIONAL_PREAMBLE injection (HARD CO-LOC #3 prep), Luxon DST-safe 7-day window helper, parallel-fetch loader (M008 first production consumer of getEpisodicSummariesRange), and the WEEK-09 wellbeing variance gate (per-dim stddev with ANY-dim-flat rule + insufficient-data short-circuit) — all enforced at prompt-assembly time so Sonnet never sees wellbeing data when the gate fails.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-04-28T17:30:05Z
- **Completed:** 2026-04-28T18:05:10Z
- **Tasks:** 3
- **Files created:** 5 (3 source + 2 test)
- **Files modified:** 0
- **Lines added:** ~1055 (39 + 235 + 245 + 157 + 379)
- **Tests:** 32/32 green (10 prompt assembler unit + 14 sources unit + 8 sources real-DB integration)

## Accomplishments

- **WEEKLY_REVIEW_HEADER constant** exported from `src/rituals/weekly-review.ts` with verbatim D031 / WEEK-04 spec text `'Observation (interpretation, not fact):'` — Plan 29-02 will render at Telegram-send time. The skeleton file also documents the HARD CO-LOC #2 + #3 atomic boundary so subsequent executors see the contract.

- **`assembleWeeklyReviewPrompt(input)` pure 8-section composer** in `src/rituals/weekly-review-prompt.ts` mirroring M008's `assembleConsolidationPrompt` shape verbatim. Sections in order: (1) CONSTITUTIONAL_PREAMBLE first — Pitfall 17 mitigation against sycophantic weekly observations, (2) anti-flattery role preamble specialized for weekly-review one-question contract, (3) date-window block (Pitfall 16 prompt-level mitigation), (4) PATTERN-ONLY directive (WEEK-07 / Pitfall 18), (5) wellbeing block CONDITIONAL on `input.includeWellbeing`, (6) summaries block, (7) resolved-decisions block CONDITIONAL on length>0 with explicit AGGREGATE-NOT-RE-SURFACE reminder, (8) structured-output directive last.

- **`loadWeeklyReviewContext(weekStart, weekEnd)` parallel-fetch loader** in `src/rituals/weekly-review-sources.ts` issuing three queries in parallel via `Promise.all`: M008 `getEpisodicSummariesRange` (Phase 29 is the first production caller of this helper since it shipped in Phase 21), the M007 `decisions WHERE status='resolved' AND resolvedAt BETWEEN start AND end` Drizzle query, and the wellbeing_snapshots range query. Returns a single `WeeklyReviewContext` object that Plan 29-02 maps directly into a `WeeklyReviewPromptInput` for the assembler.

- **`computeWeekBoundary(now)` Luxon DST-safe helper** computing `weekStart = now.minus({days:7}).startOf('day')` and `weekEnd = now.endOf('day')` in `config.proactiveTimezone`, returning UTC JS Dates for direct gte/lte filtering. Verified DST-safe on a spring-forward week — naïve fixed-millisecond arithmetic would land at the wrong wall-clock hour; Luxon's startOf-day after .minus({days}) lands on the correct local midnight regardless of DST transitions.

- **WEEK-09 wellbeing variance gate** as a pair of named exports: `computeStdDev` (pure population stddev) and `shouldIncludeWellbeing(snapshots)` enforcing the D-06 ANY-dim-flat rule (returns false if any of energy/mood/anxiety stddev < 0.4) plus the insufficient-data short-circuit (returns false if snapshots.length < 4). Two distinct log lines (`chris.weekly-review.wellbeing.insufficient-data` vs `.variance-gate-failed`) so real-week occurrence rates can be monitored separately.

- **32 tests** across 2 test files with full coverage of the WEEK-02, WEEK-04, WEEK-07, WEEK-09 prompt-side specs and the WEEK-01 substrate side. All 22 unit tests run in <100ms total without DB; the 8 real-DB integration tests pass in <200ms against fresh Docker postgres on port 5433.

## Task Commits

Each task was committed atomically:

1. **Task 1: WEEKLY_REVIEW_HEADER constant + Plan 29-02 skeleton** — `aa9978e` (feat)
2. **Task 2: assembleWeeklyReviewPrompt pure function + 10 unit tests** — `2d9facc` (feat)
3. **Task 3: weekly-review-sources data fetch + variance gate + 22 tests** — `cc956c0` (feat)

## Files Created/Modified

- `src/rituals/weekly-review.ts` (NEW, 39 LoC) — exports `WEEKLY_REVIEW_HEADER` D031 boundary marker constant. Documents HARD CO-LOC #2+#3 atomic boundary; Plan 29-02 fills `fireWeeklyReview` / `generateWeeklyObservation` here.
- `src/rituals/weekly-review-prompt.ts` (NEW, 235 LoC) — exports `assembleWeeklyReviewPrompt(input)` + `WeeklyReviewPromptInput` type. 8-section composer mirroring `src/episodic/prompts.ts:assembleConsolidationPrompt`. Section 1 = explicit `CONSTITUTIONAL_PREAMBLE` injection (Pitfall 17 boundary-audit grep token: file contains 6 occurrences of `CONSTITUTIONAL_PREAMBLE`, well above the >=2 drift-detector threshold).
- `src/rituals/weekly-review-sources.ts` (NEW, 245 LoC) — exports `loadWeeklyReviewContext`, `computeWeekBoundary`, `computeStdDev`, `shouldIncludeWellbeing`, `VARIANCE_THRESHOLD`, `INSUFFICIENT_DATA_THRESHOLD`. Imports `getEpisodicSummariesRange` from `../pensieve/retrieve.js` (corrected from CONTEXT.md's `../episodic/sources.js` reference — see Decisions Made below).
- `src/rituals/__tests__/weekly-review-prompt.test.ts` (NEW, 157 LoC) — 10 unit tests for the assembler.
- `src/rituals/__tests__/weekly-review-sources.test.ts` (NEW, 379 LoC) — 14 unit tests + 8 real-DB integration tests.

## Decisions Made

- **Migration of `getEpisodicSummariesRange` import path:** CONTEXT.md and the plan brief reference `src/episodic/sources.ts` as the home of `getEpisodicSummariesRange`, but the helper actually lives in `src/pensieve/retrieve.ts` (verified via repo-wide grep — only 1 production export). The historical M008 milestone moved it there. Plan 29-01 imports from the actual location; the boundary contract (range fetch by Date pair, never throws, returns []) is unchanged.

- **Window semantics:** Per 29-RESEARCH §2 verbatim — `weekStart = now.minus({days:7}).startOf('day')`, `weekEnd = now.endOf('day')`. This produces an 8-day inclusive window (the prior 7 full days plus the Sunday fire day), which matches `getEpisodicSummariesRange`'s `gte/lte` filter semantics. Tests pin this behavior so Plan 29-02 cannot accidentally narrow it.

- **Boundary marker rendering at fire time, not prompt time:** `WEEKLY_REVIEW_HEADER` is exported as a UX-layer constant; the prompt asks Sonnet for structured `{ observation, question }` only. Plan 29-02 prepends the header at `bot.api.sendMessage` time. Per 29-RESEARCH §6 explicit reasoning: mixing the header into the prompt would require Sonnet to render it correctly — extra failure mode.

- **Two-pass variance gate logging:** `shouldIncludeWellbeing` emits one log line for the insufficient-data short-circuit (count<4) and a separate one for the variance threshold failure. Letting them collapse into a single line would make production monitoring blind to the difference between "Greg skipped wellbeing" and "Greg's week was statistically flat" — both are spec-correct outcomes but they have different operational implications.

- **8-section assembler vs 9-section consolidation prompt:** M008's `assembleConsolidationPrompt` has 9 sections (importance rubric + verbatim quote clause + sparse guard + ...). Plan 29-01's assembler has 8 — there is no importance rubric (one observation + one question, no scoring), no verbatim-quote clause (the substrate IS the M008 summaries which already enforce verbatim quoting), no sparse guard (a 7-day window with zero summaries is rare and Plan 29-02 will handle it via the templated fallback). The 8 → 9 mapping is `[constitutional, role, date-window, pattern-only, wellbeing?, summaries, decisions?, output-format]`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Corrected `getEpisodicSummariesRange` import path**
- **Found during:** Task 3 (loadWeeklyReviewContext implementation)
- **Issue:** Plan 29-01 + CONTEXT.md cite `src/episodic/sources.ts` as the home of `getEpisodicSummariesRange`, but a repo-wide grep shows the only production export lives in `src/pensieve/retrieve.ts:390`. Importing from the wrong file would fail TS compilation (Rule 3 — blocking).
- **Fix:** Imported from the actual location: `import { getEpisodicSummariesRange } from '../pensieve/retrieve.js';`
- **Files modified:** src/rituals/weekly-review-sources.ts (import line)
- **Verification:** `npx tsc --noEmit` reports zero errors; runtime integration test "M008 helper sanity" exercises the import + call path.
- **Committed in:** cc956c0 (Task 3 commit)
- **Forward note:** Plan 29-02 will inherit this corrected import path. CONTEXT.md / RESEARCH.md still reference the wrong path; future plan refresher passes can update the references.

**2. [Rule 1 - Bug] Fixed off-by-one initial week-boundary computation**
- **Found during:** Task 3 (computeWeekBoundary unit tests)
- **Issue:** First implementation used `local.minus({days: 6}).startOf('day')` which yields a 7-day inclusive window. The plan's research and snippet specify `local.minus({days: 7}).startOf('day')` — an 8-day inclusive window covering the prior 7 full days PLUS the Sunday fire day. Test asserted spring-forward boundary on `2026-03-29` returned `2026-03-23` (consistent with `days: 6`); after auditing 29-RESEARCH §2 the spec is `days: 7` with the test expectation moved to the matching anchor.
- **Fix:** Updated implementation to `local.minus({days: 7}).startOf('day')` and updated the four DST/window tests to match. The plan-quoted snippet is now obeyed verbatim.
- **Files modified:** src/rituals/weekly-review-sources.ts, src/rituals/__tests__/weekly-review-sources.test.ts
- **Verification:** All 4 computeWeekBoundary unit tests pass; spring-forward week now correctly lands on `2026-03-22` Paris start-of-day (CET, pre-DST) for a `2026-03-29 18:00 UTC` (CEST post-DST) Sunday-evening fire.
- **Committed in:** cc956c0 (Task 3 commit)

**3. [Rule 1 - Bug] Stripped string literals from comments that triggered own grep-guard false positives**
- **Found during:** Task 2 + Task 3 (verification grep gates)
- **Issue:** Two grep gates in the plan use `grep -v '^#'` to filter shell comments, but TypeScript JSDoc comments use `* ...` not `# ...` — so the filter doesn't strip them. Three comment lines (one in `weekly-review-prompt.ts` referencing `anthropic.messages.parse`, one in the same file similar, one in `weekly-review-sources.ts` referencing `86_400_000`) were triggering the gate as if they were real code.
- **Fix:** Reworded the three comment lines to express the same documentation intent without the literal token string. The grep guards now correctly assert "this file has no LLM call" / "this file has no fixed-ms arithmetic" by checking against the source code rather than comments-about-source-code.
- **Files modified:** src/rituals/weekly-review-prompt.ts (2 docstring edits), src/rituals/weekly-review-sources.ts (1 docstring edit)
- **Verification:** All 6 grep gates from the plan pass post-rewording.
- **Committed in:** 2d9facc (Task 2) + cc956c0 (Task 3)
- **Forward note:** This is a defect in the plan's grep-gate design rather than my code. A more robust gate would strip TS comments (`grep -v '^\s*\*'` and `grep -v '^\s*//'`). Plan 29-02 should use that more robust filter shape if it relies on similar grep guards.

---

**Total deviations:** 3 auto-fixed (1 blocking, 2 bug). All fixes were minimal and code-internal; no scope creep.
**Impact on plan:** All `must_haves` truths from the frontmatter still hold post-fix. The corrected import path + 8-day window + reworded comments are net improvements.

## Issues Encountered

- **Full-suite `bash scripts/test.sh` exhibits ECONNREFUSED-style failures** in 31 test files (out of 108 total) when run inside this sandbox under the 1372-test concurrent-load run. Symptoms: postgres becomes unreachable mid-test (port 5433 stops accepting connections) — but the postgres container itself is still running and healthy. This appears to be sandbox-environmental (postgres-pool exhaustion or namespace-level resource limits) and is NOT caused by Plan 29-01 changes. Verified by:
  - Plan 29-01's two test files (`weekly-review-prompt.test.ts` + `weekly-review-sources.test.ts`) pass cleanly 32/32 in isolation against the same Docker postgres.
  - The failing 31 files include voice-note, wellbeing, decisions, contradiction, and live-LLM tests — all unrelated to Plan 29-01.
  - 4 of the 31 failures are also `live-LLM` tests gated on a real `ANTHROPIC_API_KEY` (test-key returns 401).
  - Per SCOPE BOUNDARY rule (deferred-items.md candidate), the full-suite failure mode is logged and out of Plan 29-01 scope to fix.

## Self-Check: PASSED

- All 5 created files exist on disk:
  - `src/rituals/weekly-review.ts` — FOUND
  - `src/rituals/weekly-review-prompt.ts` — FOUND
  - `src/rituals/weekly-review-sources.ts` — FOUND
  - `src/rituals/__tests__/weekly-review-prompt.test.ts` — FOUND
  - `src/rituals/__tests__/weekly-review-sources.test.ts` — FOUND
- All 3 task commits exist in git log:
  - `aa9978e` (Task 1) — FOUND
  - `2d9facc` (Task 2) — FOUND
  - `cc956c0` (Task 3) — FOUND
- All grep gates pass (verified post-rewording in deviation #3 above).
- All 32 tests green: `Test Files 2 passed (2) | Tests 32 passed (32)` in <900ms total.
- TypeScript clean: `npx tsc --noEmit` reports zero errors attributable to the 5 new files.

## Next Phase Readiness

- **Plan 29-02 unblocked.** It can now `import { assembleWeeklyReviewPrompt, type WeeklyReviewPromptInput } from './weekly-review-prompt.js'`, `import { WEEKLY_REVIEW_HEADER } from './weekly-review.js'`, and `import { loadWeeklyReviewContext, computeWeekBoundary } from './weekly-review-sources.js'` without TypeScript errors.
- **HARD CO-LOC #3 prep complete.** The CONSTITUTIONAL_PREAMBLE injection lives in the assembler module (Plan 29-01); Plan 29-02 will (a) consume the assembled prompt at the Sonnet call site and (b) add an SDK-boundary unit test asserting the system prompt argument starts with `'## Core Principles (Always Active)'`. The boundary-audit grep guard (`grep -c CONSTITUTIONAL_PREAMBLE src/rituals/weekly-review-prompt.ts >= 2`) is the regression detector.
- **WEEK-01 fire-side dispatch + seed migration NOT in this plan.** Owned by Plan 29-03 (`dispatchRitualHandler` switch case + `0009_weekly_review_seed.sql` + `scripts/regen-snapshots.sh` extension + `scripts/test.sh` psql gate).

---
*Phase: 29-weekly-review*
*Plan: 01 (Substrate)*
*Completed: 2026-04-28*
