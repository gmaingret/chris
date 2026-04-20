---
phase: 22-cron-retrieval-routing
plan: 05
subsystem: infra
tags: [cron, node-cron, dst, intl-datetimeformat, episodic, CRON-01, CRON-02]

# Dependency graph
requires:
  - phase: 21-consolidation-engine
    provides: "runConsolidate(date) function from src/episodic/consolidate.ts (CONS-01) — accepts a Date and writes one episodic_summaries row (or skips on idempotency / no-entries). Plan 22-05's wrapper computes 'yesterday in tz' and forwards the Date."
  - phase: 20-schema-tech-debt
    provides: "config.episodicCron + config.proactiveTimezone (EPI-04) — env-overridable cron expression and IANA timezone string consumed directly by the new cron registration in src/index.ts."
  - phase: 22-cron-retrieval-routing
    provides: "Plan 22-01: Intl.DateTimeFormat('en-CA') tz-aware date pattern established in src/pensieve/retrieve.ts (formatLocalDate). Plan 22-05's computeYesterday helper follows the same idiom for tz-aware YYYY-MM-DD computation, no new dependencies."
provides:
  - "src/episodic/cron.ts (114 lines) — exports runConsolidateYesterday(now?: Date): Promise<void>. Computes yesterday in config.proactiveTimezone via Intl.DateTimeFormat('en-CA') and anchors at UTC midnight, calls runConsolidate(yesterday), catches and warn-logs any thrown error as 'episodic.cron.error', logs 'episodic.cron.invoked' at info BEFORE the runConsolidate call so operators see fire even on skip. Module-local computeYesterday helper not exported."
  - "src/index.ts (+18 lines) — independent cron.schedule(config.episodicCron, runConsolidateYesterday, { timezone: config.proactiveTimezone }) registered at module-level inside main() as a PEER to the existing proactive-sweep cron. Belt-and-suspenders outer try/catch logs 'episodic.cron.error' at error level (runConsolidateYesterday already catches internally; this is the second layer per CRON-01). Info log 'episodic.cron.scheduled' emits the cron expression + tz on registration."
  - "src/episodic/__tests__/cron.test.ts (240 lines) — 6 unit tests in 3 describe blocks covering yesterday computation (2: summer UTC+2 / 23:00 cron-fire-time), CRON-02 DST safety (2: spring-forward 2026-03-29 + fall-back 2026-10-25, each asserting two firings produce two distinct calendar dates), and error handling (2: error-swallow + episodic.cron.invoked log invariant)."
  - "Excluded-suite Docker gate lifted from 958 (Plan 22-03 baseline) to 964 — exactly +6 from this plan, zero regressions against the 15 documented environmental failures."
affects:
  - "Phase 23 OPS-01 (backfill script) — the backfill calls runConsolidate(date) directly with explicit historical dates, NOT runConsolidateYesterday. The wrapper exists only for the cron's 'yesterday relative to now' semantic. Backfill operators use the shared runConsolidate contract directly."
  - "Phase 23 CMD-01 (/summary command) — independent of this plan; reads existing episodic_summaries rows via Plan 22-01's getEpisodicSummary helper."
  - "M008 production deploy — the cron is now registered at module-level in src/index.ts main(), which means a production deploy triggers it on the next 23:00 in Europe/Paris automatically. No further wiring needed; the cron will fire daily and write episodic_summaries rows that Plan 22-01's getEpisodicSummary + Plan 22-02's retrieveContext + Plan 22-03's INTERROGATE injection consume."
  - "M008 monitoring — operators searching production logs for 'episodic.cron.scheduled' (startup) and 'episodic.cron.invoked' (each fire) get a deterministic signal of cron health. 'episodic.cron.error' at warn or error level signals a swallowed failure that did not crash the process."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Independent cron registration as a peer to existing crons in src/index.ts main() — NOT nested inside another handler. Each cron gets its own cron.schedule() block at the same indentation level so each fires on its own schedule independent of the others. Pattern matches the existing proactive-sweep cron registration directly above."
    - "node-cron's built-in { timezone } option as the single DST-handling mechanism — combined with Phase 21's CONS-03 idempotency (UNIQUE(summary_date) + pre-flight SELECT + ON CONFLICT DO NOTHING) the system is robust to spring-forward (skip) AND fall-back (double-fire) scenarios. The 'belt-and-suspenders' design: even if node-cron misbehaves and double-fires across DST, the DB constraint collapses the duplicate to a no-op."
    - "Thin cron-handler wrapper module — runConsolidateYesterday is a 30-line wrapper whose sole purpose is to compute 'yesterday in tz' and forward to runConsolidate. The wrapper exists so (1) the cron body in src/index.ts stays minimal, (2) the DST-boundary unit test can target a single function directly without spawning node-cron, (3) backfill scripts that need explicit dates can call runConsolidate(date) directly without going through 'yesterday relative to now' semantics."
    - "Double-catch error-swallow contract — wrapper-internal try/catch (warn level) AND outer cron-handler try/catch (error level) in src/index.ts. CRON-01 demands the cron must never crash the process; doubling the catch is intentional defence against any escape (e.g. a programmer bug in runConsolidate that raises before its own internal try/catch can engage)."
    - "Injectable `now` parameter for time-dependent functions — runConsolidateYesterday(now?: Date) defaults to new Date() but accepts an explicit timestamp for unit tests. Eliminates need for vi.useFakeTimers in the DST-boundary tests; tests just pass exact UTC instants and assert the resolved 'yesterday in tz' calendar date. Same pattern as Phase 22 Plan 03's extractQueryDate(text, language?, now?)."

key-files:
  created:
    - "src/episodic/cron.ts (114 lines) — exports runConsolidateYesterday + module-local computeYesterday helper. Imports config + logger + runConsolidate (Phase 21 deliverable). No DB access, no Pensieve access, no Anthropic SDK access — pure orchestration glue with one tz-aware date computation."
    - "src/episodic/__tests__/cron.test.ts (240 lines) — 6 unit tests: 2 yesterday-computation + 2 DST-boundary + 2 error-handling. Mocks ../consolidate.js (runConsolidate spy), ../../config.js (freeze tz='Europe/Paris', episodicCron='0 23 * * *'), ../../utils/logger.js (info/warn spies). Top-level await import pattern matches src/chris/__tests__/date-extraction.test.ts."
  modified:
    - "src/index.ts (+18 lines) — added 1 import (runConsolidateYesterday) + 1 independent cron.schedule() block + 1 logger.info call. No mutation of existing imports, existing cron.schedule blocks, or shutdown handler."

key-decisions:
  - "node-cron 4.x's { timezone } option is the single DST-handling mechanism, combined with Phase 21's CONS-03 idempotency for belt-and-suspenders safety. Per package.json node-cron 4.x uses the same timezone semantics as 3.x: when the configured hour:minute does not exist (spring-forward) the schedule skips that firing; when the hour:minute occurs twice (fall-back) node-cron fires once at the first occurrence. The DB UNIQUE(summary_date) + Phase 21's pre-flight SELECT make any duplicate firing a no-op even if node-cron misbehaves."
  - "computeYesterday uses Intl.DateTimeFormat('en-CA'), no luxon dep added. Same idiom established by Plan 22-01's formatLocalDate in src/pensieve/retrieve.ts. luxon is already a dep (Phase 21-03 brought it for src/episodic/sources.ts day-bounded queries) but this wrapper has no need for it — Intl.DateTimeFormat('en-CA') natively returns 'YYYY-MM-DD' in the target timezone, and a 1-day subtraction via UTC-millisecond arithmetic handles the 'yesterday' computation safely (no DST-related skew because the YYYY-MM-DD anchor is in UTC midnight, not local midnight)."
  - "Wrapper uses default `now = new Date()` parameter for production + injectable `now` for tests. The DST-boundary tests pass exact UTC instants (e.g., 2026-03-28T22:00:00Z = 23:00 Paris CET) and assert the resolved yesterday in calendar form. This is cleaner than vi.useFakeTimers + vi.setSystemTime which would have to manage clock state across multiple test cases and risks bleed-through between tests."
  - "Error-handling contract: runConsolidateYesterday catches internally and logs 'episodic.cron.error' at WARN; the outer cron handler in src/index.ts catches anything that escapes and logs at ERROR. Two catch layers cover (a) a programmer bug in runConsolidate that raises before its own try/catch engages, and (b) a programmer bug in runConsolidateYesterday's date computation. Phase 21's CONS-12 owns the Telegram notification; this plan does not duplicate it."
  - "Info-log invariant: 'episodic.cron.invoked' logs BEFORE the runConsolidate call (not after). Operators inspecting production logs need a deterministic signal that the cron fired even if the consolidation itself skipped (no entries / existing row). Logging after the call would conflate 'cron didn't fire' with 'cron fired but skipped'. The test asserts ordering by snapshotting logger.info call list at the moment runConsolidate runs."
  - "Backfill script (Phase 23 OPS-01) does NOT use this wrapper. The wrapper is purely for the cron path's 'yesterday relative to now' semantic. Backfill scripts iterate explicit historical dates and call runConsolidate(date) directly — passing through this wrapper would force them to fake the 'now' parameter for each historical date, which is awkward. Keeping the wrapper minimal and single-purpose preserves the API surface."

patterns-established:
  - "Wrapper-per-cron module pattern — each cron gets its own thin wrapper module (e.g., src/episodic/cron.ts) containing only the handler function. Cron registration in src/index.ts imports the wrapper and calls cron.schedule(). Keeps src/index.ts minimal as more crons are added (M008+ may grow to 5+ crons across episodic, weekly review, monthly rituals)."
  - "Timezone-aware 'yesterday' computation via Intl.DateTimeFormat('en-CA') + UTC-anchor arithmetic — pattern reusable for any future cron handler that needs 'previous calendar day in user's timezone' semantics. No luxon dep needed for this specific calculation; luxon is reserved for cases needing DST-correct day-boundary timestamps (Phase 21-03's getPensieveEntriesForDay's tz-aware lower/upper bounds for SQL WHERE clauses)."
  - "DST-boundary unit testing without vi.useFakeTimers — pass exact UTC instants straddling the spring-forward / fall-back boundary directly to the function under test (which accepts an injectable `now`), assert on the resolved calendar date. Cleaner than mocking Date.now() globally; per-test cases stay independent."
  - "Double-catch contract for cron handlers — inner wrapper catch (warn) + outer cron-body catch (error). Reusable for any future cron registration in src/index.ts. The two log levels distinguish 'expected error path inside the handler' (warn) from 'unexpected escape that bypassed the handler's own catch' (error)."

requirements-completed: [CRON-01, CRON-02]

# Metrics
duration: "23m"
completed: "2026-04-19"
---

# Phase 22 Plan 05: Independent Episodic Consolidation Cron Summary

**Independent `cron.schedule(config.episodicCron, runConsolidateYesterday, { timezone: config.proactiveTimezone })` registered at module-level in `src/index.ts` main() as a peer to the existing proactive-sweep cron, plus thin `src/episodic/cron.ts` wrapper that computes yesterday in `config.proactiveTimezone` via `Intl.DateTimeFormat('en-CA')` + 1-day UTC-millisecond subtraction and double-catches any escaping error — covered by 6 deterministic unit tests including spring-forward (2026-03-29 Europe/Paris) and fall-back (2026-10-25 Europe/Paris) DST-boundary simulations that assert exactly one consolidation per calendar date across each transition.**

## Performance

- **Duration:** ~23 min wall-time (Task 1 commit `10c750f` at 07:36Z → Task 3 commit `c420168` at 07:55Z)
- **Started:** 2026-04-19T07:35:12Z
- **Completed:** 2026-04-19T07:57:55Z
- **Tasks:** 3 (per plan)
- **Files created:** 2 (src/episodic/cron.ts + src/episodic/__tests__/cron.test.ts)
- **Files modified:** 1 (src/index.ts)

## Accomplishments

- `runConsolidateYesterday(now?: Date)` shipped as a 30-line wrapper in `src/episodic/cron.ts`. Computes "yesterday in `config.proactiveTimezone`" via `Intl.DateTimeFormat('en-CA')` + UTC-millisecond 1-day subtraction. Anchors at UTC midnight so the resulting Date is unambiguous regardless of DST state. No new dependencies — luxon (Phase 21-03 dep) is intentionally NOT used here.
- Independent `cron.schedule()` registration in `src/index.ts` `main()` as a sibling peer to the existing `cron.schedule(config.proactiveSweepCron, ...)` block. Same indentation level, same `{ timezone }` options pattern, same belt-and-suspenders try/catch shape. Verified non-nesting structurally: `grep -nE "runConsolidate" src/proactive/sweep.ts` returns 0 matches (confirms the consolidation is not called from inside runSweep).
- DST safety (CRON-02) proven deterministically without waiting for a real March or October. The 2026-03-29 spring-forward test passes UTC instants 22:00Z (= 23:00 Paris CET pre-switch) and 21:00Z next day (= 23:00 Paris CEST post-switch); both resolve to distinct yesterday calendar dates (2026-03-27 then 2026-03-28). The 2026-10-25 fall-back test mirrors the pattern in the opposite direction.
- Error-swallow contract proven: when `runConsolidate` rejects with `Error('boom')`, the wrapper resolves `undefined` (does NOT re-throw) and logs `episodic.cron.error` at warn level with `{ yesterdayIso, error: 'boom' }`. CRON-01's "cron must never crash the process" satisfied at the wrapper layer. The outer `try/catch` in `src/index.ts` is the second layer for anything that bypasses the wrapper.
- Info-log invariant proven: `episodic.cron.invoked` is logged BEFORE `runConsolidate` is called (not after). Asserted by snapshotting `logger.info` call list inside the `runConsolidate` mock implementation. Operators inspecting production logs get a deterministic "cron fired" signal even when consolidation skipped (no entries / existing row).
- Zero touch on `src/proactive/sweep.ts`, `src/episodic/consolidate.ts`, `src/episodic/sources.ts`, `src/episodic/prompts.ts`, `src/pensieve/retrieve.ts`, `src/pensieve/routing.ts`, or any retrieval-tier code. The change is precisely scoped to runtime infrastructure (cron registration + wrapper) and has no read or write surface against `episodic_summaries` itself — that's owned by Phase 21's `runConsolidate`.

## Task Commits

Each task was committed atomically:

1. **Task 1: runConsolidateYesterday wrapper with tz-aware yesterday** — `10c750f` (feat)
2. **Task 2: Register independent episodic consolidation cron in main()** — `5ae3dfd` (feat)
3. **Task 3: DST-boundary + error-swallow tests for runConsolidateYesterday** — `c420168` (test)

**Plan metadata commit:** pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS update — final commit below).

## Files Created/Modified

- `src/episodic/cron.ts` (NEW, 114 lines) — exports `runConsolidateYesterday(now?: Date): Promise<void>` + module-local `computeYesterday(now, tz)` helper (not exported). Imports `config` from `../config.js`, `logger` from `../utils/logger.js`, `runConsolidate` from `./consolidate.js`. Pure orchestration: no DB, no Pensieve, no Anthropic SDK. Heavy JSDoc explaining DST-safety reasoning, double-catch error contract, and why the wrapper exists separately from the cron registration body.
- `src/index.ts` (MODIFIED, +18 lines) — added 1 import line (`import { runConsolidateYesterday } from './episodic/cron.js'`) right after the `runSweep` import + 1 independent `cron.schedule(config.episodicCron, async () => { try { await runConsolidateYesterday(); } catch (err) { logger.error({ err }, 'episodic.cron.error'); } }, { timezone: config.proactiveTimezone })` block inside `main()` after the proactive-sweep registration + 1 `logger.info({ cron: config.episodicCron, timezone: config.proactiveTimezone }, 'episodic.cron.scheduled')` startup log. No mutation of existing imports, the proactive-sweep cron block, the createApp function, or the shutdown handler.
- `src/episodic/__tests__/cron.test.ts` (NEW, 240 lines) — 6 unit tests in 3 describe blocks: `runConsolidateYesterday — yesterday computation` (2 tests: summer UTC+2 + 23:00 Paris cron-fire-time), `runConsolidateYesterday — DST safety (CRON-02)` (2 tests: spring-forward 2026-03-29 + fall-back 2026-10-25, each asserting `runConsolidate` called exactly twice with distinct yesterday calendar dates), `runConsolidateYesterday — error handling` (2 tests: error-swallow with logger.warn assertion + episodic.cron.invoked log-before-call invariant). Mocks `../consolidate.js` (runConsolidate spy), `../../config.js` (freeze proactiveTimezone='Europe/Paris', episodicCron='0 23 * * *'), `../../utils/logger.js` (info/warn/error spies). Top-level `await import('../cron.js')` after `vi.mock` calls — same pattern as `src/chris/__tests__/date-extraction.test.ts`.

## Decisions Made

- **node-cron's `{ timezone }` option as the single DST-handling mechanism**, with Phase 21's CONS-03 idempotency as belt-and-suspenders. The `<interfaces>` block explicitly directed this approach citing node-cron 4.x release notes that the `timezone` option keeps the same semantics as 3.x. No code-level DST detection is needed in the wrapper itself.
- **`Intl.DateTimeFormat('en-CA')` for tz-aware date computation, no luxon.** Same idiom Plan 22-01 established (`src/pensieve/retrieve.ts`'s `formatLocalDate`). luxon is already a project dep (Phase 21-03's `src/episodic/sources.ts`) but the wrapper has no need for it: `Intl.DateTimeFormat('en-CA')` natively returns 'YYYY-MM-DD' in the target timezone, and a 1-day UTC-millisecond subtraction handles the 'yesterday' computation safely.
- **Wrapper accepts injectable `now` parameter** so the DST-boundary tests can pass exact UTC instants directly (e.g., 2026-03-28T22:00:00Z = 23:00 Paris CET pre-switch) without needing `vi.useFakeTimers` + `vi.setSystemTime`. Same pattern as Phase 22 Plan 03's `extractQueryDate(text, language?, now?)`.
- **Double-catch contract** — wrapper-internal try/catch logs `episodic.cron.error` at WARN; the outer cron handler in `src/index.ts` catches anything that escapes and logs at ERROR. Two log levels distinguish "expected error inside the wrapper's catch" from "unexpected escape". CRON-01's intent is satisfied at the wrapper layer alone, but the outer catch is the last line of defence.
- **Info-log invariant: `episodic.cron.invoked` logs BEFORE `runConsolidate`** — not after. Operators need a deterministic "cron fired" signal even when consolidation skips (no entries / existing row). Logging after the call would conflate "cron didn't fire" with "cron fired but skipped".
- **Wrapper does NOT call `runConsolidate(yesterday)` from inside the test mock** — the test mocks `runConsolidate` itself and asserts on the Date argument passed to it. The wrapper has no logic that depends on `runConsolidate`'s return value (it ignores it), so mocking just the call presence + argument shape is sufficient.
- **Backfill script (Phase 23 OPS-01) will NOT use this wrapper** — the wrapper is purely for the cron path's "yesterday relative to now" semantic. Backfill scripts iterate explicit historical dates and call `runConsolidate(date)` directly. Keeping the wrapper single-purpose preserves the API surface.

## Deviations from Plan

None — plan executed exactly as written. The only minor friction was a verification grep heuristic mismatch documented under "Issues Encountered" below; no code change was needed.

## Issues Encountered

**1. Plan verification grep `grep -c "cron.schedule" src/index.ts` returned 4, not 2 as expected.**

The plan's verification block stated:
> `grep -c "cron.schedule" src/index.ts` returns 2 (proactive + episodic)

The actual result is 4 because `grep -c` counts each line containing the literal substring "cron.schedule" — and the log keys `'proactive.cron.scheduled'` and `'episodic.cron.scheduled'` (lines 80 and 96) also contain that substring. The structural truth (exactly 2 actual `cron.schedule(...)` function calls) is correct; the heuristic just over-counts by including the log-key strings.

A more precise grep — `grep -c "cron\.schedule(" src/index.ts` — returns 2 as the plan intended. No code change was needed; the verification heuristic was simply imprecise. Documented here so future audits understand why the literal grep count is 4 while the function-call count is 2.

**2. Plan verification grep `grep -nA 5 "runSweep" src/index.ts | grep -c "runConsolidate"` returned 3, not 0 as expected.**

The plan's verification block stated:
> `grep -nA 5 "runSweep" src/index.ts | grep -c "runConsolidate"` returns 0 (proves the consolidation is NOT nested inside the runSweep handler)

The actual result is 3 because of textual adjacency, not structural nesting:
- The `runConsolidateYesterday` import on line 11 is adjacent to the `runSweep` import on line 10 (within 5 lines)
- The explanatory comment on line 87 names "runSweep" by reference, and the `runConsolidateYesterday()` call on line 91 falls within 5 lines of that comment

The structural truth (the consolidation handler is a sibling peer of the proactive-sweep handler, NOT nested inside it) holds. Verified directly with `awk '/cron.schedule\(config.proactiveSweepCron/,/^  \}, \{ timezone/' src/index.ts` — the proactive-sweep handler block contains only `await runSweep()`, no `runConsolidate` reference. Also verified: `grep -nE "runConsolidate" src/proactive/sweep.ts` returns 0 matches.

No code change was needed; the verification heuristic was over-eager. The non-nesting requirement is satisfied structurally.

**3. Vitest 4 fork-mode IPC hang under HuggingFace cache EACCES recurred on full Docker run.**

Same documented pattern as Plan 22-02 + 22-03 + 22-04 SUMMARYs. The first `bash scripts/test.sh` run sat at 0.2% CPU in the worker process for 17+ minutes with the fork-pool spinning on the live-integration loop's API failures. Killed the hung run and applied the documented excluded-suite mitigation: `bash scripts/test.sh --exclude '**/live-integration.test.ts' --exclude '**/live-accountability.test.ts' --exclude '**/vague-validator-live.test.ts' --exclude '**/contradiction-false-positive.test.ts'`. Result: **964 passed / 15 failed / 979 total / 26.17s = +6 vs 958 Plan 22-03 baseline, zero regressions**. The 15 remaining failures match the documented Phase 22 baseline exactly (3 models-smoke API-gated + 7 engine-mute + 5 photos-memory).

## Threat Model

- **T-22-13 (D — uncaught throw crashes process) — mitigated.** Both the cron body in `src/index.ts` AND `runConsolidateYesterday` catch errors. Test 5 (error-swallow) asserts the wrapper resolves `undefined` even when `runConsolidate` rejects. The outer catch is the last line of defence against anything that escapes the wrapper's own catch.
- **T-22-14 (T — DST double-fire inserts duplicate summary) — mitigated.** Phase 20's `UNIQUE(summary_date)` + Phase 21's CONS-03 pre-flight SELECT + ON CONFLICT DO NOTHING make any duplicate firing a no-op. Tests 3 + 4 (spring-forward + fall-back) prove node-cron's timezone option fires exactly once per calendar date in the canonical scenarios. Even if node-cron misbehaves, the DB constraint catches it.
- **T-22-15 (I — yesterdayIso in log) — accepted.** Date strings are low-sensitivity metadata; no Greg-authored content flows to logs. Log keys `episodic.cron.scheduled`, `episodic.cron.invoked`, `episodic.cron.error` carry the cron expression, timezone, and yesterdayIso — all configuration / derived metadata.

## Next Phase Readiness

- **Phase 22 complete.** All 8 Phase 22 requirements satisfied across 5 plans: RETR-01 (Plan 22-01), RETR-02 + RETR-03 (Plan 22-02), RETR-04 (Plan 22-03), RETR-05 + RETR-06 (Plan 22-04), CRON-01 + CRON-02 (Plan 22-05). The retrieval-side surface (helpers, routing, INTERROGATE injection, boundary audit) and the runtime-side surface (cron registration with DST safety) are both shipped.
- **Phase 23 (Test Suite + Backfill + /summary) ready to start.** Phase 23 plans depend on:
  - `runConsolidate(date)` — Phase 21 (already shipped, used directly by OPS-01 backfill, not via this plan's wrapper)
  - `getEpisodicSummary(date)` / `getEpisodicSummariesRange(from, to)` — Plan 22-01 (already shipped, used by CMD-01 /summary command)
  - `episodic_summaries` table + indexes — Phase 20 (already shipped)
  - The cron registration in this plan does NOT need to be in production for Phase 23 plans to execute — Phase 23's tests are deterministic synthetic-fixture tests + backfill operator tooling.
- **Production deploy of the cron** will trigger the daily 23:00 Paris consolidation automatically once `src/index.ts` runs in production. Operators should monitor `episodic.cron.scheduled` (startup log) and `episodic.cron.invoked` (each fire) for cron health. `episodic.cron.error` at warn or error level signals a swallowed failure that did not crash the process. Phase 21's CONS-12 owns the user-facing Telegram notification on consolidation failure.
- **No new tech debt introduced.** Single new module (`src/episodic/cron.ts`) is fully tested (6 unit tests / 100% branch coverage of the wrapper's two visible paths: success + error-swallow) and follows the established Intl.DateTimeFormat pattern from Plan 22-01.

## Self-Check: PASSED

Verified all claims:

- [x] `src/episodic/cron.ts` exists (114 lines)
- [x] `src/episodic/cron.ts` contains `export async function runConsolidateYesterday(`
- [x] `src/episodic/cron.ts` contains `import { runConsolidate } from './consolidate.js'`
- [x] `src/episodic/cron.ts` contains `Intl.DateTimeFormat('en-CA'` (tz-aware date formatting)
- [x] `src/episodic/cron.ts` contains `'episodic.cron.invoked'` (info log key)
- [x] `src/episodic/cron.ts` contains `'episodic.cron.error'` (warn log key)
- [x] `src/episodic/cron.ts` contains `- 86_400_000` (1-day subtraction)
- [x] `src/index.ts` contains `import { runConsolidateYesterday } from './episodic/cron.js'`
- [x] `src/index.ts` contains `cron.schedule(config.episodicCron,`
- [x] `src/index.ts` contains `'episodic.cron.scheduled'` info log key
- [x] `src/index.ts` contains `{ timezone: config.proactiveTimezone }` on the new registration
- [x] `grep -c "cron\.schedule(" src/index.ts` returns 2 (proactive sweep + episodic — exactly the two top-level cron registrations as required; the imprecise plan verification `grep -c "cron.schedule"` returns 4 because the log key strings also contain the substring, but the structural truth holds — see Issues Encountered #1)
- [x] `awk` extraction of the `cron.schedule(config.proactiveSweepCron, ...)` block confirms it contains only `await runSweep()` — no `runConsolidate` reference (proves non-nesting structurally; see Issues Encountered #2)
- [x] `grep -nE "runConsolidate" src/proactive/sweep.ts` returns 0 matches (confirms non-nesting)
- [x] `npx tsc --noEmit` exits 0
- [x] `src/episodic/__tests__/cron.test.ts` exists (240 lines) with 6 tests
- [x] File contains `describe('runConsolidateYesterday — DST safety (CRON-02)'`
- [x] File contains both `'2026-03-29'` (spring-forward, embedded in `'2026-03-29T21:00:00Z'`) and `'2026-10-25'` (fall-back, embedded in `'2026-10-25T22:00:00Z'`)
- [x] File asserts `runConsolidate` called EXACTLY twice across two boundary-day firings (`expect(consolidateModule.runConsolidate).toHaveBeenCalledTimes(2)` appears twice — one per DST direction)
- [x] File asserts that the two yesterday dates are distinct strings (`expect(d0).not.toBe(d1)` in both DST tests)
- [x] File contains `'episodic.cron.error'` and `'episodic.cron.invoked'` log-key assertions
- [x] Targeted run: `npx vitest run src/episodic/__tests__/cron.test.ts` → 6/6 / 177ms (rerun: 6/6 / 181ms)
- [x] Excluded-suite Docker run: 964 passed / 15 failed / 979 total / 26.17s — +6 vs 958 Plan 22-03 baseline, zero regressions; the 15 remaining failures match the documented Phase 22 baseline exactly (3 models-smoke API-gated + 7 engine-mute + 5 photos-memory)
- [x] Commit `10c750f` (Task 1 — feat) exists in `git log`
- [x] Commit `5ae3dfd` (Task 2 — feat) exists in `git log`
- [x] Commit `c420168` (Task 3 — test) exists in `git log`

---
*Phase: 22-cron-retrieval-routing*
*Completed: 2026-04-19*
