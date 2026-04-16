---
phase: 14-capture-flow
plan: 03
subsystem: decisions
tags: [drizzle, postgres, suppression, substring-match, cap-06]

# Dependency graph
requires:
  - phase: 14-01
    provides: decisionTriggerSuppressions table + migration 0004
provides:
  - addSuppression, isSuppressed, listSuppressions DB helpers
affects: [14-05-bot-wiring, 17-decisions-command]

# Tech tracking
tech-stack:
  added: []
  patterns: [onConflictDoNothing for idempotent upsert, JS-side case-insensitive substring match]

key-files:
  created: [src/decisions/suppressions.ts]
  modified: [src/decisions/index.ts]

key-decisions:
  - "JS-side substring match (String.includes) instead of SQL ILIKE for isSuppressed -- matches D-17 spec exactly and keeps query simple"
  - "200-char length limit on phrases mitigates T-14-03-01 DoS via bloated suppression table"

patterns-established:
  - "Suppression helpers follow same Drizzle query shape as capture-state.ts (db import, eq filter, bigint chatId)"

requirements-completed: [CAP-06]

# Metrics
duration: 2min
completed: 2026-04-16
---

# Phase 14 Plan 03: Suppressions Persistence Summary

**DB-backed per-chat trigger-phrase suppression with trim+lowercase normalization, case-insensitive substring match, and idempotent upsert via onConflictDoNothing**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-16T04:45:01Z
- **Completed:** 2026-04-16T04:46:23Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Implemented addSuppression with trim+lowercase normalization, 200-char limit, and duplicate-absorbing upsert
- Implemented isSuppressed with case-insensitive substring match scoped per chatId
- Implemented listSuppressions with newest-first ordering for Plan 05 slash-command echo
- All 5 suppressions.test.ts cases GREEN (persistence, substring match, per-chat scoping, dedup, restart survival)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement suppressions.ts DB helpers** - `9a014bb` (feat)

## Files Created/Modified
- `src/decisions/suppressions.ts` - addSuppression, isSuppressed, listSuppressions helpers
- `src/decisions/index.ts` - Added barrel re-export for suppressions module

## Decisions Made
- JS-side substring match (String.includes after lowercasing both sides) instead of SQL ILIKE -- matches D-17 "case-insensitive substring" spec exactly and avoids SQL pattern escaping complexity
- 200-char length limit on phrases mitigates T-14-03-01 (unbounded input DoS); non-empty check prevents degenerate empty-string matches

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Test database needed manual migration (drizzle-kit push failed due to sequence reference; ran migration SQL files directly via docker exec). Not a code issue -- test infrastructure setup only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Suppression helpers ready for Plan 05 bot wiring (`/decisions suppress <phrase>` slash command)
- Phase 17 will add list/unsuppress CRUD surface per D-16

## Self-Check: PASSED

---
*Phase: 14-capture-flow*
*Completed: 2026-04-16*
