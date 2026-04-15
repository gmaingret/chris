---
phase: 06-memory-audit
plan: "03"
subsystem: scripts
tags: [audit, bug-fix, gap-closure, memory, pensieve]
dependency_graph:
  requires: []
  provides: [correct-audit-match-logic, complete-seed-coverage]
  affects: [src/scripts/audit-pensieve.ts, src/scripts/seed-audit-data.ts]
tech_stack:
  added: []
  patterns: [runtime-null-guard, match-ordering-guard]
key_files:
  created: []
  modified:
    - src/scripts/audit-pensieve.ts
    - src/scripts/__tests__/audit-pensieve.test.ts
    - src/scripts/seed-audit-data.ts
    - src/scripts/__tests__/seed-audit-data.test.ts
decisions:
  - "WR-02: Used simple continue (no result push) for missing-key guard to avoid adding non-standard status values to AuditStatus union"
  - "Test coverage for 13-key assertion limited to 11 correct keys present in seed (birth_place and rental_manager not seeded — out of scope for this plan)"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-13"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
requirements-completed: [RETR-03]
---

# Phase 6 Plan 03: Code Review Bug Fixes Summary

Fixed three code-review warnings (WR-01, WR-02, WR-03) and two info items (IN-01, IN-02) — permanent_relocation match ordering, non-null assertion guard, missing next_move seed entry, duplicate condition removal, and conditional ellipsis fix.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Fix WR-01, WR-02, IN-01, IN-03 in audit-pensieve.ts | 77f695a | audit-pensieve.ts, audit-pensieve.test.ts |
| 2 | Fix WR-03 and IN-02 in seed-audit-data.ts | d3abe05 | seed-audit-data.ts, seed-audit-data.test.ts |

## What Was Fixed

**WR-01 (match ordering):** The `next_move` block was matching entries like "permanently relocate to Batumi September 2026" before the `permanent_relocation` block could fire. Fixed by moving `permanent_relocation` check first and adding negative guards (`!lower.includes('permanent')`, etc.) to the `next_move` block.

**WR-02 (non-null assertion):** Replaced `match.key!` at line 341 with a runtime guard: logs `BUG: matched entry ... has no ground-truth key` and `continue`s, avoiding silent `undefined` propagation into `generateCorrectedContent`.

**WR-03 (missing seed entry):** Added `next_move` seed entry `"I'm moving to Batumi, Georgia around April 28 for about a month."` — brings total from 12 to 13 entries (11 correct + 2 error).

**IN-01 (duplicate condition):** Removed duplicate `lower.includes('managed by citya')` from `isRentalContext` expression (was listed twice consecutively).

**IN-02 (unconditional ellipsis):** Fixed `entry.content.slice(0, 60) + '...'` to only append `...` when content length exceeds 60 characters.

**IN-03 (scope comment):** Added comment above `hasWrongDate` explaining it only fires when '1979' is present — entries with a completely wrong year fall through as unmatched by design.

## Test Results

- `audit-pensieve.test.ts`: 15 tests pass (3 new tests added for WR-01 fix)
- `seed-audit-data.test.ts`: 7 tests pass (2 new tests added for WR-03 fix)
- Combined: 22 tests pass, 0 failures

## Deviations from Plan

**1. [Rule 1 - Bug] WR-02 guard uses `continue` only (no result push)**
- **Found during:** Task 1
- **Issue:** Plan spec showed `status: 'skipped' as AuditStatus` and `action: 'error' as AuditAction`, but `AuditStatus` only allows `'correct' | 'incorrect' | 'unrelated'` and `AuditAction` only allows `'kept' | 'soft_deleted' | 'would_correct'`. Adding invalid cast values would be misleading.
- **Fix:** Simplified to `console.error(...)` + `continue` without pushing to results. Same safety effect, no type pollution.
- **Files modified:** src/scripts/audit-pensieve.ts

**2. [Rule 2 - Scope] 13-key test covers 11 keys (not all 13)**
- **Found during:** Task 2
- **Issue:** Plan spec said "covers all 13 ground-truth keys" but seed data only has entries for 11 keys (birth_place and rental_manager not seeded — those keys exist in ground-truth.ts but have no seed coverage).
- **Fix:** Test asserts the 11 keys that are actually present. The count test (13 total = 11 correct + 2 error) is correct. The missing 2 keys are a pre-existing gap, not introduced by this plan.

## Known Stubs

None.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries introduced.

## Self-Check: PASSED

- src/scripts/audit-pensieve.ts: FOUND
- src/scripts/seed-audit-data.ts: FOUND
- Commit 77f695a (Task 1): FOUND
- Commit d3abe05 (Task 2): FOUND
