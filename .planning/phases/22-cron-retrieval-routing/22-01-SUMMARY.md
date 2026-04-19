---
phase: 22-cron-retrieval-routing
plan: 01
subsystem: retrieval
tags: [episodic, retrieval, timezone, intl-datetimeformat, drizzle, RETR-01]

# Dependency graph
requires:
  - phase: 20-schema-tech-debt
    provides: "episodic_summaries table (UNIQUE(summary_date) + indexes) plus the episodicSummaries Drizzle export from src/db/schema.ts."
  - phase: 21-consolidation-engine
    provides: "Rows that runConsolidate(date) writes into episodic_summaries — the data source the new helpers query."
provides:
  - "src/pensieve/retrieve.ts — getEpisodicSummary(date) and getEpisodicSummariesRange(from, to) exports. Both timezone-aware in config.proactiveTimezone via Intl.DateTimeFormat (Node 22 native, no luxon dep added). Both never throw — return null / [] on DB error and log pensieve.episodic.error at warn."
  - "src/pensieve/__tests__/retrieve.episodic.test.ts — 7 Docker-Postgres integration tests covering happy path, null on missing row, timezone boundary regression (22:30Z → next day in Europe/Paris), inclusive ASC range, empty range, both-boundary inclusion, and out-of-range exclusion."
  - "src/pensieve/__tests__/retrieve.test.ts — extended with 3 mocked-db error-path tests covering null/[] return + pensieve.episodic.error log on DB throw, plus an observable-log assertion that formatLocalDate routes through config.proactiveTimezone."
  - "Internal-only formatLocalDate(date, tz) helper in retrieve.ts (not exported) — single source of truth for the YYYY-MM-DD calendar-date conversion both helpers depend on."
  - "Docker gate lifted from 901 passing (Plan 21-04 baseline) to 911 passing — exactly +10 from this plan, zero regressions against the 61 pre-existing environmental failures."
affects:
  - "22-02 (RETR-02 routing) — routeRetrieval() will call getEpisodicSummary / getEpisodicSummariesRange when the recency boundary or query-intent rules select the summary path. The never-throw contract means the router can fall back to raw entries if a summary lookup fails without try/catch noise."
  - "22-03 (RETR-04 INTERROGATE injection) — interrogate.ts will call getEpisodicSummariesRange(from, to) when the user references a period >7 days ago. Date extraction (regex/Haiku fallback) feeds the from/to bounds; the range helper returns sorted rows ready to render into the context block."
  - "22-05 (CRON-01 cron handler) — the cron callback can call getEpisodicSummary(yesterdayDate) for a previous-day-summary log line at INFO level without risking a thrown exception escaping the cron runtime."
  - "23 OPS-01 backfill — backfill operator can use getEpisodicSummary(d) as the read side that mirrors runConsolidate(d)'s write side, reusing the same tz-conversion semantics for status checks."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Intl.DateTimeFormat('en-CA', { timeZone }) for YYYY-MM-DD calendar-date conversion at the DB-string boundary — Node 22 native, zero deps. Replaces the temptation to add luxon or write custom UTC arithmetic. The 'en-CA' locale is the standard idiom for ISO-style date output."
    - "Module-local formatLocalDate(date, tz) helper sits between the public API and the Drizzle WHERE clause — both helpers funnel through one tz-conversion path, so a future change to date semantics edits one function. Helper is intentionally NOT exported (single-source-of-truth for the file)."
    - "Never-throw read helpers that log structured success/failure events — getEpisodicSummary / getEpisodicSummariesRange return null / [] on DB error and emit pensieve.episodic.error at warn (mirrors getTemporalPensieve / hybridSearch contract). Callers compose without try/catch."
    - "Mixed test pattern in one module: mocked-db unit tests in retrieve.test.ts (existing) coexist with real-db integration tests in a sibling retrieve.episodic.test.ts file. The split is forced by vi.mock hoisting — a single file cannot both mock db/connection.js AND insert rows through the real connection."

key-files:
  created:
    - "src/pensieve/__tests__/retrieve.episodic.test.ts (228 lines) — 7 Docker-Postgres integration tests, 2 describe blocks (getEpisodicSummary, getEpisodicSummariesRange), beforeEach truncate. Real-DB pattern mirrors src/episodic/__tests__/sources.test.ts."
  modified:
    - "src/pensieve/retrieve.ts (+119 lines) — added episodicSummaries import + config import + module-local formatLocalDate(date, tz) helper + getEpisodicSummary export + getEpisodicSummariesRange export. No mutation of existing exports."
    - "src/pensieve/__tests__/retrieve.test.ts (+76 lines) — added proactiveTimezone: 'Europe/Paris' to mocked config, added getEpisodicSummary + getEpisodicSummariesRange to the dynamic import, appended describe('episodic helpers — error paths') with 3 mocked-throw assertions."

key-decisions:
  - "Use Intl.DateTimeFormat('en-CA', { timeZone, year, month, day }) instead of adding luxon as a dependency. Phase 21 Plan 03 already added luxon for src/episodic/sources.ts, but this plan's tz needs are limited to 'YYYY-MM-DD in tz' formatting — well within the Node 22 standard library. The plan's <interfaces> block explicitly directed this approach: 'no luxon dep is added'."
  - "Split integration tests into a new file (retrieve.episodic.test.ts) rather than appending to retrieve.test.ts. The plan's <action> block instructed appending to the existing file, but vi.mock('../../db/connection.js', ...) at the top of retrieve.test.ts is hoisted to the start of the module — making real DB inserts inside the same file impossible. The mocked db.select chain shape (innerJoin → where → orderBy → limit) also doesn't match the new helpers' query path (where → limit, where → orderBy). Splitting preserves both test patterns cleanly without forcing a refactor of all 35 pre-existing tests in retrieve.test.ts. Logged as Rule 3 deviation below."
  - "Keep the error-path test in the mocked file (retrieve.test.ts), not the integration file. Forcing db.select to throw is a one-line vi.mock override; reproducing the same scenario with a real DB connection requires either a closed connection pool or a SQL-level abort signal — both of which would add complexity for no additional coverage. The mocked test exercises the exact try/catch branch that the never-throw contract requires."
  - "Mock retrieve.test.ts config now includes proactiveTimezone: 'Europe/Paris'. Without this, calling either helper from the mocked-config tests would throw inside formatLocalDate(undefined, undefined). Default value matches scripts/test.sh (PROACTIVE_TIMEZONE unset → src/config.ts:40 falls back to 'Europe/Paris')."
  - "Inclusive range semantics on getEpisodicSummariesRange — both from and to are included via gte + lte. Asserted by Test 6 (boundary inclusivity: rows on the from-day and to-day are both returned)."

patterns-established:
  - "Pure-function tz-conversion helper at the DB-string boundary — formatLocalDate(date, tz) returns 'YYYY-MM-DD' without dependencies on global state. Reusable by future episodic-tier read helpers (e.g., getEpisodicSummariesByImportance might also need a date param)."
  - "Two-file test split for modules with mixed mocked-unit and real-DB integration coverage — the mocked file (retrieve.test.ts) covers branch behavior (error paths, log shape, dedup logic); the integration file (retrieve.episodic.test.ts) covers DB contract (insert+select round-trip, tz-correct WHERE, inclusive bounds). Both files share the same module under test."
  - "Reuse Phase 20's source marker pattern: integration test file uses beforeEach { db.delete(episodicSummaries) } to isolate fixtures since vitest.config.ts has fileParallelism: false. Same idiom as src/episodic/__tests__/schema.test.ts."

requirements-completed: [RETR-01]

# Metrics
duration: "44m"
completed: "2026-04-18"
---

# Phase 22 Plan 01: Episodic Summary Retrieval Helpers Summary

**`getEpisodicSummary(date)` + `getEpisodicSummariesRange(from, to)` exports in `src/pensieve/retrieve.ts` with timezone-aware day-boundary conversion via `Intl.DateTimeFormat('en-CA', { timeZone })` — never-throw read API for the episodic_summaries table, covered by 7 Docker integration tests + 3 mocked error-path tests (Docker gate 911/61/972, +10 vs 901 baseline, zero regressions).**

## Performance

- **Duration:** 44 min wall-time (commits 67760a4 at 21:41:24Z → 4763e4c at 22:25:07Z)
- **Started:** 2026-04-18T21:38:57Z (per STATE.md last_updated stamp)
- **Completed:** 2026-04-18T22:25:27Z
- **Tasks:** 2 (per plan)
- **Files created:** 1 (retrieve.episodic.test.ts)
- **Files modified:** 2 (retrieve.ts + retrieve.test.ts)

## Accomplishments

- Two timezone-aware read helpers exported from `src/pensieve/retrieve.ts`, both following the existing never-throw contract used by `getTemporalPensieve` and `hybridSearch`. Both convert Date inputs to 'YYYY-MM-DD' calendar dates in `config.proactiveTimezone` before querying — so a UTC instant late on day N may resolve to day N+1 (or vice versa) in the local zone.
- Range helper returns rows in inclusive `[from, to]` ordered by `summary_date` ascending — verified by Test 6 (boundary inclusivity) and Test 4 (ordering despite out-of-order insertion).
- Timezone boundary regression test (T-22-03 mitigation) asserts `2026-04-15T22:30:00Z → 2026-04-16` in Europe/Paris CEST. Same assertion appears in both the integration file (real DB lookup) and the mocked file (observable in log payload).
- Zero new dependencies — `Intl.DateTimeFormat('en-CA')` covers the tz formatting need entirely with the Node 22 standard library, per the plan's `<interfaces>` block ("no luxon dep is added").
- Zero touch on `pensieve_embeddings` — semantic search path unchanged. Verified by `git diff HEAD~2 HEAD -- src/pensieve/retrieve.ts | grep pensieveEmbeddings`: only the existing import line (where `episodicSummaries` was added alongside the existing entries).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add `getEpisodicSummary` and `getEpisodicSummariesRange`** — `67760a4` (feat)
2. **Task 2: Docker-Postgres integration tests + mocked error-path tests** — `4763e4c` (test)

**Plan metadata commit:** pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS update — final commit below).

## Files Created/Modified

- `src/pensieve/retrieve.ts` — Added `episodicSummaries` to schema import line, added `config` import from `../config.js`, added module-local `formatLocalDate(date, tz)` helper between Types and Public API sections, appended Episodic Summary Retrieval section with two exported async functions. No mutation of existing exports (`searchPensieve`, `hybridSearch`, `getTemporalPensieve`, mode-specific search options).
- `src/pensieve/__tests__/retrieve.episodic.test.ts` — New file. 7 Docker-Postgres integration tests in 2 describe blocks. Mirrors the pattern from `src/episodic/__tests__/sources.test.ts` (real `db` from connection.js, `beforeEach` truncate, fileParallelism: false makes per-test cleanup safe).
- `src/pensieve/__tests__/retrieve.test.ts` — Added `proactiveTimezone: 'Europe/Paris'` to the mocked config (without it, `formatLocalDate(undefined, undefined)` would throw); added `getEpisodicSummary` + `getEpisodicSummariesRange` to the dynamic import; appended `describe('episodic helpers — error paths')` block with 3 tests using `mockSelect.mockImplementationOnce(() => { throw ... })` to cover the never-throw branch.

## Decisions Made

- **No luxon for this plan.** The plan's `<interfaces>` block explicitly directed `Intl.DateTimeFormat`. Phase 21 Plan 03 already brought luxon into `src/episodic/sources.ts` for DST-correct day-boundary timestamps; this plan only needs 'YYYY-MM-DD in tz' formatting, which is a Node 22 standard library capability. Avoiding luxon here keeps the import surface in `src/pensieve/retrieve.ts` minimal.
- **Two-file test split** (see Deviations section below for the deviation log). Cleanest way to mix mocked-unit and real-db patterns without breaking 35 existing tests.
- **Inclusive range bounds** on `getEpisodicSummariesRange` — both `from` and `to` are included via `gte + lte`. Asserted by Test 6.
- **Internal-only `formatLocalDate`** — not exported. Both episodic helpers are the only callers; future episodic-tier helpers needing the same conversion can either import via a private re-export or duplicate the 8-line function. Keeping it internal prevents accidental coupling from downstream modules.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Split integration tests into a new file rather than appending to `retrieve.test.ts`**

- **Found during:** Task 2 setup (reading the existing `retrieve.test.ts` to plan the append)
- **Issue:** The plan's `<action>` block in Task 2 directed: "Create `src/pensieve/__tests__/retrieve.test.ts` (append to existing file; it already has unit tests for `searchPensieve`)." However, the existing file mocks `db/connection.js` at the top via `vi.mock`, which is hoisted to the start of the module — making real DB inserts impossible from the same file. Worse, the mocked `db.select` chain shape (`select → from → innerJoin → where → orderBy → limit`) does not match the new helpers' query path (`select → from → where → limit` for the singleton, `select → from → where → orderBy` for the range). Calling either helper through the existing mock chain would throw `where is not a function` because `mockFrom` only returns `{ innerJoin: mockInnerJoin }`. Forcing the integration tests into the file would have required either:
  (a) Removing `vi.mock('../../db/connection.js', ...)` and rewriting all 35 existing tests to not depend on `mockSelect / mockLimit` etc. — out of scope.
  (b) Extending the mock chain to also support the new query paths — fragile (the mocks would silently shadow the real DB call for any integration assertion).
- **Fix:** Created a new file `src/pensieve/__tests__/retrieve.episodic.test.ts` for the 7 Docker-Postgres integration tests, mirroring the pattern from `src/episodic/__tests__/sources.test.ts` (real DB, no mocks, `beforeEach` truncate). Kept the 3 error-path tests in the existing `retrieve.test.ts` because forcing `db.select` to throw is a one-line `mockSelect.mockImplementationOnce` — the simplest way to drive the never-throw branch. Added `proactiveTimezone: 'Europe/Paris'` to the mocked config in `retrieve.test.ts` so `formatLocalDate` resolves correctly under the mock.
- **Files modified:** `src/pensieve/__tests__/retrieve.episodic.test.ts` (new), `src/pensieve/__tests__/retrieve.test.ts` (modified — config, import, error-path tests appended)
- **Verification:** Targeted run `bash scripts/test.sh src/pensieve/__tests__/retrieve.episodic.test.ts src/pensieve/__tests__/retrieve.test.ts` reports `Test Files  2 passed (2) | Tests  47 passed (47)`. Full Docker suite confirms +10 passing (911 vs 901), 0 regressions.
- **Committed in:** `4763e4c` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 3 blocking)
**Impact on plan:** Necessary for correctness — the plan's "append to existing file" instruction was internally inconsistent with the file's existing mock structure. The split delivers the same coverage with cleaner separation between mocked branch tests and real-DB contract tests, matching the pattern already established by Phase 21 Plan 03 (`episodic/__tests__/sources.test.ts` real-DB sibling to `episodic/__tests__/types.test.ts` mocked).

## Issues Encountered

- **Vitest output capture under background tasks:** The first `bash scripts/test.sh | tail -80` run was captured to a file by the bash background runner, but `tail -80` only flushes after the upstream pipe closes. The runner's task-status file showed 0 lines until vitest completed (~40 minutes total: many environmental Anthropic-API and HuggingFace-cache-permission failures slow the run substantially). Resolved by polling for the vitest pid to disappear with `until ! ps -p <pid>; do sleep 10; done`. Test result: **911 passed / 61 failed (vs 901/61 Phase 21 baseline = +10 passing, 0 regressions).** A targeted re-run on just the two changed files confirmed `47 passed / 0 failed / 1.13s`.

## Threat Model

- **T-22-03 (Tampering on tz boundary) — mitigated.** The plan's `<threat_model>` flagged the day-boundary conversion as the highest-risk surface. Mitigation: `Intl.DateTimeFormat` is the Node 22 standard library (no third-party parsing). Regression test: `2026-04-15T22:30:00Z` resolves to `2026-04-16` in Europe/Paris CEST — present in both `retrieve.episodic.test.ts` (real DB lookup) and `retrieve.test.ts` (observable in error log payload). T-22-01 and T-22-02 dispositions remain `accept` per the plan.

## Next Phase Readiness

- **22-02 (RETR-02 routing)** ready to consume `getEpisodicSummary` / `getEpisodicSummariesRange`. Both helpers are typed with `episodicSummaries.$inferSelect`, so the router gets full row shape including `summary`, `importance`, `topics`, `source_entry_ids`, `key_quotes` — sufficient for the high-importance-raw-descent rule (RETR-03) and the date-anchored INTERROGATE injection (RETR-04). No additional read helpers needed before 22-02 starts.
- **22-05 (CRON-01)** can call `getEpisodicSummary(yesterdayDate)` from the cron callback for the previous-day log line; never-throw guarantee means the cron runtime won't see exceptions escape from the read.

## Self-Check: PASSED

Verified all claims:

- [x] `src/pensieve/retrieve.ts` exists and contains both new exports + `formatLocalDate` + `Intl.DateTimeFormat('en-CA'` + `'pensieve.episodic.retrieve'` + `'pensieve.episodic.error'` + `episodicSummaries` import (verified via grep above)
- [x] `src/pensieve/__tests__/retrieve.episodic.test.ts` exists (228 lines) — `ls` confirms presence
- [x] `src/pensieve/__tests__/retrieve.test.ts` modified with `proactiveTimezone` in mocked config and 3 new error-path tests (verified by `git log -p`)
- [x] Commit `67760a4` (Task 1) exists in `git log` — verified
- [x] Commit `4763e4c` (Task 2) exists in `git log` — verified
- [x] `npx tsc --noEmit` exits 0
- [x] Targeted test run: 47 passed / 0 failed across the two retrieve files
- [x] Full Docker suite: 911 passed / 61 failed (vs 901/61 Phase 21 baseline → +10 passing, 0 regressions)

---
*Phase: 22-cron-retrieval-routing*
*Completed: 2026-04-18*
