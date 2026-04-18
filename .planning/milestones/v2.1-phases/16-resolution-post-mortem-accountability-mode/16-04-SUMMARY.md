---
phase: 16-resolution-post-mortem-accountability-mode
plan: "04"
subsystem: decisions/engine
tags: [engine, pp0, resolution, postmortem, routing, rres-02, rres-03]
dependency_graph:
  requires: [16-02, 16-03]
  provides: [pp0-resolution-routing, engine-resolution-tests-green]
  affects: [src/chris/engine.ts, src/decisions/__tests__/engine-resolution.test.ts]
tech_stack:
  patterns: [pp0-pre-processor, capture-state-routing, abort-phrase-guard]
key_files:
  modified:
    - src/chris/engine.ts
    - src/decisions/__tests__/engine-resolution.test.ts
decisions:
  - "PP#0 routes AWAITING_RESOLUTION and AWAITING_POSTMORTEM before abort-phrase check to prevent crash on draft={} rows"
  - "Abort-phrase semantics do not apply to resolution/postmortem stages — Greg is answering a question, not dismissing a capture"
requirements_completed: [RES-02, RES-03]
metrics:
  duration_minutes: 15
  tasks_completed: 2
  files_modified: 1
  completed_date: "2026-04-16"
---

# Phase 16 Plan 04: Engine PP#0 Resolution Routing Summary

Wire AWAITING_RESOLUTION and AWAITING_POSTMORTEM engine PP#0 branches that intercept Greg's reply before mute/refusal/mode detection runs, routing to handleResolution() and handlePostmortem() respectively.

## What Was Built

### Task 1: Engine PP#0 AWAITING_RESOLUTION and AWAITING_POSTMORTEM branches (src/chris/engine.ts)

The implementation was already in place at the base commit `0a947f0` as part of the Phase 16 code review fixes (commits `265ac20` and `e84e281`). Verified all acceptance criteria are satisfied:

- `src/chris/engine.ts` line 21: imports `handleResolution` and `handlePostmortem` from `../decisions/resolution.js`
- PP#0 block (lines 173-184): AWAITING_RESOLUTION check runs BEFORE abort-phrase check
- PP#0 block (lines 179-183): AWAITING_POSTMORTEM check runs BEFORE abort-phrase check
- Both branches call `saveMessage` for USER and ASSISTANT before returning
- Both branches use `activeCapture.decisionId!` as the third argument
- No "Phase 16 will handle" fallthrough comment (removed in prior code review fix)
- `npx tsc --noEmit` exits 0

The critical ordering fix: resolution/postmortem stages have `draft: {}` (written by `upsertAwaitingResolution`) with no `language_at_capture`. Routing these stages before the abort-phrase check prevents a crash from `isAbortPhrase(text, undefined)` (Pitfall 1 from the plan).

### Task 2: engine-resolution.test.ts turned GREEN (src/decisions/__tests__/engine-resolution.test.ts)

Removed the RED scaffold header and `@ts-expect-error` directive that were placed in Plan 01 when `resolution.ts` did not yet exist. Updated the module docstring to reflect GREEN integration test status.

All 4 tests pass:

1. **routes AWAITING_RESOLUTION message to handleResolution** — inserts AWAITING_RESOLUTION state, verifies `detectMuteIntent` was NOT called (PP#0 intercepted before mute detection)
2. **routes AWAITING_POSTMORTEM message to handlePostmortem** — inserts AWAITING_POSTMORTEM state, verifies `detectMuteIntent` was NOT called
3. **skips abort-phrase check for AWAITING_RESOLUTION stage** — uses empty draft `{}`, verifies `processMessage` resolves without TypeError
4. **falls through to normal mode when no active capture exists** — verifies `detectMuteIntent` WAS called (PP#0 did not intercept)

## Deviations from Plan

None. Plan executed exactly as written. The Task 1 implementation was already present at the base commit from the code review fix wave (commits `265ac20` / `e84e281`). Task 2 was completed by removing the RED scaffold annotations and confirming all 4 tests pass.

## Verification Results

1. `npx tsc --noEmit` — exits 0 (no TypeScript errors)
2. `npx vitest run src/decisions/__tests__/engine-resolution.test.ts` — 4/4 tests GREEN
3. `npx vitest run src/decisions/__tests__/engine-capture.test.ts` — 5/5 tests GREEN (run in isolation; pre-existing DB state interaction between test files when run together is out of scope)

## Self-Check: PASSED

- `src/chris/engine.ts` — exists and contains AWAITING_RESOLUTION/AWAITING_POSTMORTEM branches
- `src/decisions/__tests__/engine-resolution.test.ts` — exists, no @ts-expect-error, 4 tests pass
- Commit `90f5149` — exists (feat(16-04): turn engine-resolution tests GREEN)
- `npx tsc --noEmit` — clean
