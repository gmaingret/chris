---
phase: 17-decisions-command-accuracy-stats
plan: "02"
subsystem: decisions
tags: [stats, wilson-ci, sql, formatters, suppressions]
dependency_graph:
  requires: []
  provides: [wilsonCI, fetchStatsData, computeAccuracy, fetchStatusCounts, fetchOpenDecisions, fetchRecentDecisions, formatDashboard, formatOpenList, formatRecentList, formatStatsBlock, removeSuppression]
  affects: [src/decisions/stats.ts, src/decisions/suppressions.ts]
tech_stack:
  added: []
  patterns: [Wilson score CI formula, Drizzle rolling window SQL, language-switched formatter pattern]
key_files:
  created:
    - src/decisions/stats.ts
    - src/decisions/__tests__/stats.test.ts
  modified:
    - src/decisions/suppressions.ts
    - src/decisions/__tests__/suppressions.test.ts
decisions:
  - "formatOpenList sorts rows in formatter (not just relying on DB order) for defensive correctness"
  - "sql.end() moved to last describe block's afterAll to avoid connection teardown between suites"
metrics:
  duration: "~30 minutes"
  completed: "2026-04-16T14:49:13Z"
  tasks_completed: 2
  files_modified: 4
requirements: [STAT-03, STAT-04]
---

# Phase 17 Plan 02: Stats Computation Layer Summary

Stats computation layer (Wilson CI + SQL queries + output formatters) and suppression CRUD cycle completed. Plan 03 can now wire these into the command handler without implementing any business logic.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add removeSuppression to suppressions.ts | 0bbb9fd | suppressions.ts, suppressions.test.ts |
| 2 | Create stats.ts with Wilson CI, SQL queries, formatters | 832ecb0 | stats.ts, stats.test.ts |

## What Was Built

**Task 1 — removeSuppression** (`src/decisions/suppressions.ts`):
- `removeSuppression(chatId, phrase): Promise<boolean>` — deletes by exact normalized match, returns true if row was deleted
- Normalizes input (trim + toLowerCase) before DELETE query
- Scoped per chatId — only affects target chat
- 4 new integration tests; all 9 suppression tests pass

**Task 2 — stats.ts** (`src/decisions/stats.ts`):
- `wilsonCI(hits, n)`: Wilson 95% CI with correct formula — both center and margin divided by denom. z=1.96.
- `computeAccuracy(rows)`: N<10 returns `{ belowFloor: true, n, unverifiable }`; N>=10 returns point estimate + CI bounds as integer percentages
- `fetchStatsData(chatId, windowDays)`: reviewed decisions within rolling SQL window
- `fetchStatusCounts(chatId)`: open/due/reviewed/stale/openDraft/withdrawn/abandoned counts
- `fetchOpenDecisions(chatId)`: open decisions sorted soonest-first
- `fetchRecentDecisions(chatId, limit=5)`: recently resolved/reviewed, newest-first
- `formatDashboard(counts, accuracy90, lang)`: counts + 90d accuracy/threshold-not-met + sub-command list
- `formatOpenList(rows, lang)`: compact one-liner per decision with domain prefix + resolveBy date
- `formatRecentList(rows, lang)`: compact one-liner per decision with accuracyClass + resolvedAt date
- `formatStatsBlock(rows, windowDays, lang)`: overall accuracy + unverifiable count + domain breakdown
- EN/FR/RU localization throughout via `switch(lang)` pattern
- 15 tests — all pass

## Success Criteria Verification

- [x] `wilsonCI(6, 10)` produces bounds ~[0.30, 0.85] — verified by Test 1
- [x] `computeAccuracy` with N<10 returns `belowFloor: true` with no pct/ci — Test 6
- [x] `computeAccuracy` with N>=10 returns point estimate + Wilson CI — Test 7
- [x] `unverifiable/*` and `*/unknown` excluded from denominator, counted separately — Tests 8 & 9
- [x] `fetchStatsData` returns only reviewed decisions within window — Tests 4 & 5
- [x] `removeSuppression` deletes by exact match, returns boolean — Tests 1-4 (suppression suite)
- [x] All formatters produce plain text with no emoji
- [x] All 24 tests pass (9 suppressions + 15 stats)

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|-----------|
| T-17-02-01: SQL injection via windowDays | `sql.raw(String(windowDays))` only receives numeric values; caller must validate to [30, 90, 365] |
| T-17-02-02: Cross-chat stats leakage | `eq(decisions.chatId, chatId)` on all four query functions |
| T-17-02-03: removeSuppression phrase injection | Parameterized `eq()` with normalized phrase — no raw SQL |

## Deviations from Plan

**1. [Rule 1 - Bug] formatOpenList sorts rows defensively**
- Found during: Task 2 RED/GREEN cycle (Test 12 failed)
- Issue: Test passed rows in wrong order and expected formatter to sort. Plan says "rows should already be sorted by caller" but the formatter was trusting caller order. The test asserted formatter output order, so the formatter must sort.
- Fix: Added `[...rows].sort((a, b) => a.resolveBy.getTime() - b.resolveBy.getTime())` in formatOpenList.
- Files modified: `src/decisions/stats.ts`
- Commit: 832ecb0

**2. [Rule 1 - Bug] sql.end() moved to last describe block in suppressions.test.ts**
- Found during: Task 1 RED phase
- Issue: Original test had `sql.end()` in first describe's `afterAll`, closing connection before second describe could run.
- Fix: Moved `sql.end()` to second describe's `afterAll`; extracted shared cleanup to `cleanupTables()` helper.
- Files modified: `src/decisions/__tests__/suppressions.test.ts`
- Commit: 0bbb9fd

## Known Stubs

None — all exported functions are fully implemented.

## Self-Check: PASSED

- FOUND: src/decisions/stats.ts
- FOUND: src/decisions/__tests__/stats.test.ts
- FOUND: src/decisions/suppressions.ts (with removeSuppression)
- FOUND: commit 0bbb9fd (feat(17-02): add removeSuppression to suppressions.ts)
- FOUND: commit 832ecb0 (feat(17-02): add stats.ts with Wilson CI, SQL queries, formatters)
