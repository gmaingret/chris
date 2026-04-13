---
phase: 10-live-validation-suite
plan: "01"
subsystem: testing
tags: [live-integration, refusal, language-switching, topic-persistence, sycophancy, performative-apology]
dependency_graph:
  requires: [phase-07, phase-08, phase-09]
  provides: [TEST-01, TEST-02, TEST-04, TEST-05, TEST-08]
  affects: [src/chris/__tests__/live-integration.test.ts]
tech_stack:
  added: []
  patterns: [describe.skipIf API-key guard, 3-of-3 reliability loops, FK-safe DB cleanup, multi-turn saveMessage seeding]
key_files:
  created:
    - src/chris/__tests__/live-integration.test.ts
  modified: []
decisions:
  - "D-23: 3-of-3 reliability loops for all live tests — handles Sonnet non-determinism"
  - "Refusal tests assert exact acknowledgment strings from ACKNOWLEDGMENTS const"
  - "Language tests use franc() with only: ['eng','fra','rus'] restriction"
  - "Sycophancy tests use || logic: no validation OR has pushback (handles edge-case responses)"
  - "Performative apology turn 3 assertions verify structural behavior change, not exact text"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-13T15:07:17Z"
  tasks_completed: 2
  files_changed: 1
---

# Phase 10 Plan 01: Live Integration Test Suite (15 Cases) Summary

**One-liner:** 15 live integration tests across 5 behavioral categories (refusal/language/persistence/sycophancy/apology) with 3-of-3 reliability loops and describe.skipIf API-key guard.

## What Was Built

Created `src/chris/__tests__/live-integration.test.ts` with 15 test cases across 5 describe blocks, all gated by `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`.

### Test Categories

| Describe block | Requirement | Tests | Approach |
|---|---|---|---|
| Refusal handling | TEST-01 | 3 (EN/FR/RU) | Exact acknowledgment string from ACKNOWLEDGMENTS const |
| Language switching | TEST-04 | 3 (FR/RU/EN) | franc() language detection on response |
| Topic persistence | TEST-02 | 3 (EN/FR/RU) | 5 intervening turns via saveMessage, then assert no engagement keywords |
| Sycophancy resistance | TEST-05 | 3 (logical/sunk-cost/authority) | VALIDATION_MARKERS vs PUSHBACK_MARKERS ||  logic |
| Performative apology | TEST-08 | 3 (questions/flattery/dismissiveness) | Structural behavior change across 3-turn exchange |

### Infrastructure

- **DB lifecycle:** `beforeAll` verifies DB connection, `afterEach` deletes in FK-safe order (contradictions → pensieveEmbeddings → pensieveEntries → conversations) plus clears session state, `afterAll` calls `sql.end()`
- **3-of-3 loops:** Every test runs `for (let i = 0; i < 3; i++)` with per-iteration cleanup
- **Timeouts:** Refusal/language 60s, topic persistence 90s, performative apology 120s

## Commits

| Task | Commit | Description |
|---|---|---|
| Task 1 + 2 (combined) | 918b6ab | feat(10-01): add 15 live integration tests across 5 behavioral categories |

## Deviations from Plan

None — plan executed exactly as written. Tasks 1 and 2 were written in a single pass as both tasks write to the same file. Both sets of acceptance criteria satisfied.

## Known Stubs

None. Tests contain no placeholder data — all assertions are behavioral contracts against the real Sonnet API.

## Threat Flags

None. Phase 10 writes tests only per the plan's threat model declaration. No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- FOUND: `/home/claude/chris/src/chris/__tests__/live-integration.test.ts`
- FOUND: commit `918b6ab` — feat(10-01): add 15 live integration tests
- File contains 5 describe blocks (matches plan requirement)
- File contains 15 behavioral `it()` blocks (17 total including the outer describe.skipIf wrapper — 15 behavioral test cases)
- TypeScript compiles without errors in the new file (pre-existing node_modules errors are unrelated)
