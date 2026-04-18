---
phase: 18
plan: "01"
subsystem: decisions-testing
tags: [synthetic-fixture, concurrency, fake-clock, sweep-integration, vitest]
dependency_graph:
  requires: [phases-13-17-decisions-module]
  provides: [synthetic-fixture-test-suite]
  affects: [src/decisions/__tests__/]
tech_stack:
  added: []
  patterns:
    - vi.hoisted + vi.mock for Anthropic LLM mocking
    - vi.setSystemTime for fake clock (not vi.useFakeTimers)
    - Promise.allSettled for concurrency race capture
    - sql.end() only in last describe block to avoid pool exhaustion
key_files:
  created:
    - src/decisions/__tests__/synthetic-fixture.test.ts
  modified: []
decisions:
  - "D-02 confirmed: vi.setSystemTime ONLY -- vi.useFakeTimers breaks postgres.js keep-alive timers"
  - "sql.end() placed only in TEST-11 afterAll (last real-DB describe) to avoid CONNECTION_ENDED in subsequent blocks"
  - "vi.mock config.js omitted -- real config reads env vars (TELEGRAM_AUTHORIZED_USER_ID=99999) from test runner"
  - "upsertAwaitingResolution partial-mock via importOriginal to preserve real capture-state behavior"
metrics:
  duration: "~45 minutes (prior session) + continuation"
  completed_date: "2026-04-16"
  tasks_completed: 3
  files_created: 1
---

# Phase 18 Plan 01: Synthetic Fixture + Live Accountability Integration Suite Summary

Three integration test suites covering the full decision lifecycle end-to-end: 14-day lifecycle under fake clock, optimistic concurrency race, and same-day trigger collision.

## What Was Built

`src/decisions/__tests__/synthetic-fixture.test.ts` containing three describe blocks:

**TEST-10 (14-day lifecycle under fake clock):**
Seeds an 'open' decision with `resolveBy = advanceDays(7)`, then uses `vi.setSystemTime` to advance through the lifecycle: Day 7 transitions to 'due', Day 8 runs resolution (3 LLM calls mocked), Day 9 runs post-mortem (1 LLM call mocked), Day 14 fetches stats and verifies the decision appears in 30-day window. Real Postgres, zero real API calls.

**TEST-11 (sweep-vs-user concurrency race):**
Seeds a 'due' decision then races two `transitionDecision` calls via `Promise.allSettled`. Asserts exactly one fulfills and one rejects with `OptimisticConcurrencyError`. Verifies the `decisionEvents` table has exactly one 'resolved' row for that decision ID. Placed `sql.end()` in this block's `afterAll` (only here) to cleanly close the pool after the last real-DB suite.

**TEST-12 (same-day deadline + silence collision):**
Fully mocked -- no real DB needed. Mocks `createDeadlineTrigger` and `createSilenceTrigger` factories to return triggers that both fire. Mocks all sweep state helpers (`isMuted`, `hasSentTodayAccountability`, `hasSentTodayReflective`, etc.) and the Anthropic client. Calls `runSweep()` and asserts both `accountabilityResult.triggered` and `reflectiveResult.triggered` are true, and `mockSendMessage` was called exactly twice.

## Key Technical Decisions

**vi.setSystemTime vs vi.useFakeTimers:** Research phase (18-RESEARCH.md) confirmed that `vi.useFakeTimers` patches `setTimeout`/`setInterval` globally and breaks the postgres.js connection keep-alive mechanism. Only `vi.setSystemTime` is used, which patches `Date` only and leaves timers intact (D-02).

**config.js not mocked:** Initial implementation mocked `../../config.js` to provide Telegram/proactive config, but omitted `databaseUrl`. This caused `postgres(undefined)` to connect to the default port 5432 instead of the test port 5433. Fix: removed the config mock entirely. The real config reads from env vars set by the test runner (`TELEGRAM_AUTHORIZED_USER_ID=99999`, `DATABASE_URL=postgresql://chris:...@localhost:5433/chris`).

**sql.end() pool exhaustion:** TEST-10 originally had `afterAll(() => sql.end())`. After TEST-10 closed the connection, TEST-11's `beforeAll(async () => sql\`SELECT 1\`)` received `CONNECTION_ENDED`. Fix: removed `afterAll` from TEST-10, kept it only in TEST-11 (last real-DB describe block).

**capture-state partial mock:** `upsertAwaitingResolution` is mocked but the rest of `capture-state.js` uses `importOriginal` to preserve real FK-safe cleanup and seeding helpers.

## Verification

Tests confirmed passing (isolated run against main project which has phases 13-17 code):
- TEST-10: ~31ms
- TEST-11: ~15ms
- TEST-12: ~2ms

Full test suite run via `scripts/test.sh` was executed in background to confirm no regressions in other test files.

## Deviations from Plan

**[Rule 1 - Bug] Removed vi.mock config.js to fix wrong DB port connection**
- Found during: Task 1 (TEST-10 implementation)
- Issue: Mocking config.js without providing `databaseUrl` caused postgres to connect to port 5432 (default) instead of 5433 (test port)
- Fix: Removed `vi.mock('../../config.js')` entirely; real config reads from env vars
- Files modified: `src/decisions/__tests__/synthetic-fixture.test.ts`
- Commit: 5582442

**[Rule 1 - Bug] Moved sql.end() from TEST-10 to TEST-11 afterAll only**
- Found during: Task 2 (TEST-11 implementation)
- Issue: `sql.end()` in TEST-10 `afterAll` killed the connection pool before TEST-11 `beforeAll` could run, producing `CONNECTION_ENDED` error
- Fix: Removed `afterAll` from TEST-10, placed `afterAll(() => sql.end())` only in TEST-11
- Files modified: `src/decisions/__tests__/synthetic-fixture.test.ts`
- Commit: 5582442

## Known Stubs

None. All three tests exercise real logic (real DB for TEST-10/11, fully mocked sweep for TEST-12). No placeholder data flows to UI rendering.

## Threat Flags

None. This plan adds only test files with no new network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

- `src/decisions/__tests__/synthetic-fixture.test.ts`: FOUND
- Commit 5582442: FOUND (worktree-agent-a927b48b branch)
