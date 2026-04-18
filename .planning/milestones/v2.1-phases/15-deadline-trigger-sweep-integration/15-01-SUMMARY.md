---
phase: 15-deadline-trigger-sweep-integration
plan: 01
subsystem: proactive
tags: [drizzle, vitest, triggers, decisions, sweep, proactive]

# Dependency graph
requires:
  - phase: 13-schema-lifecycle-primitives
    provides: transitionDecision chokepoint, OptimisticConcurrencyError, InvalidTransitionError in src/decisions/
  - phase: 14-decision-capture-integration
    provides: decisions table with status/resolveBy/prediction/falsificationCriterion columns + index

provides:
  - createDeadlineTrigger() factory in src/proactive/triggers/deadline.ts
  - STALE_CONTEXT_THRESHOLD_MS constant (48h = 172800000ms)
  - decision-deadline added to TriggerResult.triggerType union
  - Priority map: silence=1, deadline=2, commitment=3, pattern=4, thread=5

affects:
  - 15-02 (sweep integration that wires deadline trigger into orchestrator)
  - 15-03 (end-to-end integration tests for the full sweep)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQL-first trigger detection: cheap DB query gates expensive action"
    - "Optimistic concurrency retry: single re-query on OCE before giving up"
    - "Stale-context framing: absolute date when >48h past due, implicit when <=48h"
    - "K001 mock pattern: vi.hoisted for chained DB mock + lifecycle mock"

key-files:
  created:
    - src/proactive/triggers/deadline.ts
    - src/proactive/__tests__/deadline.test.ts
  modified:
    - src/proactive/triggers/types.ts
    - src/proactive/triggers/commitment.ts
    - src/proactive/triggers/pattern.ts
    - src/proactive/triggers/thread.ts

key-decisions:
  - "Priority renumbering is a breaking change for sweep orchestrator — plan 15-02 must update orchestrator to pass all 5 triggers including deadline at priority 2"
  - "On InvalidTransitionError: trigger returns not-triggered (silent skip) — already-transitioned decisions don't re-fire"
  - "On OptimisticConcurrencyError: single retry with fresh re-query — no recursive retry loop"

patterns-established:
  - "Deadline trigger context uses 'On YYYY-MM-DD you predicted' for staleness >48h"
  - "Deadline trigger context uses 'Your deadline just passed' for staleness <=48h"
  - "Evidence array always has 3 entries: Decision ID, Resolve by, Staleness in hours"

requirements-completed:
  - SWEEP-01
  - SWEEP-04

# Metrics
duration: 4min
completed: 2026-04-16
---

# Phase 15 Plan 01: Deadline Trigger + Priority Renumber Summary

**decision-deadline trigger factory with SQL-first detection, OCE retry, stale-context framing, and full priority renumber (silence=1, deadline=2, commitment=3, pattern=4, thread=5)**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-16T07:10:00Z
- **Completed:** 2026-04-16T07:14:10Z
- **Tasks:** 1
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- Created `createDeadlineTrigger()` with SQL-first overdue-decision detection
- Implemented stale-context framing: absolute date (>48h) vs implicit (<=48h)
- Handled OptimisticConcurrencyError with single re-query retry
- Handled InvalidTransitionError with silent skip (not re-throw)
- Renumbered all trigger priorities: silence=1, deadline=2, commitment=3, pattern=4, thread=5
- 12 unit tests covering all behaviors, all passing

## Task Commits

1. **Task 1: Create deadline trigger with tests and renumber priorities** - `2e31af0` (feat)

## Files Created/Modified

- `src/proactive/triggers/deadline.ts` - createDeadlineTrigger() factory, STALE_CONTEXT_THRESHOLD_MS export
- `src/proactive/__tests__/deadline.test.ts` - 12 unit tests with vi.hoisted mocks
- `src/proactive/triggers/types.ts` - Added 'decision-deadline' to triggerType union
- `src/proactive/triggers/commitment.ts` - Priority renumbered 2→3 (both occurrences)
- `src/proactive/triggers/pattern.ts` - PATTERN_PRIORITY renumbered 3→4
- `src/proactive/triggers/thread.ts` - THREAD_PRIORITY renumbered 4→5

## Decisions Made

- Priority renumbering done in single commit with new trigger — atomic change across all 4 affected files
- Silent skip on InvalidTransitionError per plan spec (decision already processed by another path)
- Single retry on OCE (no recursive loop) — if second candidate also fails, it throws to caller

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Port 5433 already allocated by another parallel agent — ran vitest directly (bypassing Docker postgres) since all deadline tests use mocked DB. Unit tests are fully isolated from real DB.

## Known Stubs

None — no stub values flow from this plan to UI or LLM prompts.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. Decision text (prediction/falsificationCriterion) flows from Greg's own DB into the context string for the sweep LLM call — single-user system, accepted per T-15-01 in plan threat model.

## Next Phase Readiness

- `createDeadlineTrigger()` ready for wiring into sweep orchestrator (plan 15-02)
- Priority map is now 1/2/3/4/5 — sweep orchestrator must pass all 5 triggers including deadline
- `transitionDecision` is called with `{ actor: 'sweep' }` — events table will capture sweep actor for auditability

## Self-Check

- [x] `src/proactive/triggers/deadline.ts` exists and exports `createDeadlineTrigger` and `STALE_CONTEXT_THRESHOLD_MS`
- [x] Commit `2e31af0` exists in git log
- [x] All 12 tests pass (verified via direct vitest run)

## Self-Check: PASSED

---
*Phase: 15-deadline-trigger-sweep-integration*
*Completed: 2026-04-16*
