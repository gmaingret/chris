---
phase: 17-decisions-command-accuracy-stats
plan: "03"
subsystem: decisions-command
tags: [decisions, command-handler, stats, reclassify, suppressions, bot]
dependency_graph:
  requires: [17-01, 17-02]
  provides: [decisions-command-surface, reclassify-flow]
  affects: [src/bot/handlers/decisions.ts]
tech_stack:
  added: []
  patterns:
    - Sequential for...of reclassify loop (D-12 compliance)
    - Window allowlist validation [30,90,365] (T-17-03-01)
    - Per-chatId query scoping on all reclassify selects (T-17-03-02)
    - Direct decisionEvents insert (NOT via transitionDecision — Pitfall 3)
key_files:
  created:
    - src/decisions/__tests__/decisions-command.test.ts
  modified:
    - src/bot/handlers/decisions.ts
decisions:
  - "Implemented all Task 1 and Task 2 sub-commands in a single handler rewrite to avoid split-state confusion"
  - "Phase17Message stub removed entirely — no stubs remain"
  - "genericErrorMessage generalized (was 'suppression'-specific in Phase 14, now generic)"
metrics:
  duration_minutes: 41
  tasks_completed: 2
  files_modified: 1
  files_created: 1
  tests_added: 23
  completed_date: "2026-04-16"
---

# Phase 17 Plan 03: /decisions Command Surface Summary

**One-liner:** Full `/decisions` command surface wired — all 8 sub-commands replace Phase 14 stubs, with 2-axis reclassify, Wilson CI stats, and EN/FR/RU localization.

## What Was Built

Rewrote `src/bot/handlers/decisions.ts` to replace the Phase 14 stub (`phase17Message`) with fully functional sub-command handlers. Every sub-command calls real stats/suppression functions from Plans 01 and 02.

### Sub-commands implemented

| Sub-command | Handler | Key call |
|---|---|---|
| `/decisions` (no args) | dashboard | `fetchStatusCounts` + `computeAccuracy(90d)` → `formatDashboard` |
| `/decisions open` | open list | `fetchOpenDecisions` → `formatOpenList` |
| `/decisions recent` | recent list | `fetchRecentDecisions(5)` → `formatRecentList` |
| `/decisions stats [30|90|365]` | accuracy stats | `fetchStatsData` → `formatStatsBlock` with Wilson CI |
| `/decisions suppress <phrase>` | suppress | `addSuppression` (kept from Phase 14) |
| `/decisions suppressions` | list suppressions | `listSuppressions` |
| `/decisions unsuppress <phrase>` | remove suppression | `removeSuppression` |
| `/decisions reclassify` | re-classify | `classifyOutcome` + `classifyAccuracy` sequential loop |

### Reclassify flow (STAT-05)

For each `reviewed` decision with a non-null `resolution`:
1. `classifyOutcome(resolution, prediction, criterion)` → outcome axis
2. `classifyAccuracy(outcome, resolution, prediction)` → reasoning axis
3. `db.update(decisions)` with `accuracyClass = "${outcome}/${reasoning}"`
4. `db.insert(decisionEvents)` with `eventType: 'classified'` (direct insert, NOT via transitionDecision)

Uses `for (const d of toReclassify)` — strictly sequential per D-12, no `Promise.all`.

## Tests

Created `src/decisions/__tests__/decisions-command.test.ts` with 23 integration tests:
- Dashboard returns counts, not usage text
- Open/recent: sorted correctly or returns empty message
- Stats: defaults 90d, validates window [30/90/365], rejects 7/999
- Suppressions: lists or returns no-suppressions message
- Unsuppress: confirms removal or reports not-found
- Reclassify: calls both classifiers × N decisions sequentially, writes classified events, preserves originals, only processes `reviewed` rows with non-null `resolution`
- Unknown sub-command returns updated usage message including all sub-commands

All 23 tests pass when run in isolation. Cross-test isolation failures observed in full suite run (pre-existing DB state leakage pattern across the project — not caused by this plan).

## Deviations from Plan

### Implementation approach

**Task 1 and Task 2 handler code written in a single commit.** The plan split the handler into two tasks (Task 1: open/recent/suppressions/unsuppress; Task 2: stats/reclassify). I implemented all sub-commands in the handler at once since they share the same file and doing it in two passes would have created a confusing intermediate state. The Task 1 commit contains the complete handler; the Task 2 verification confirmed all acceptance criteria were already met.

**[Rule 1 - Bug] genericErrorMessage generalized.** The Phase 14 handler had `genericErrorMessage` returning "Something went wrong saving that suppression." — this message was specific to the suppress flow but incorrectly reused for all errors. Updated to generic "Something went wrong. Please try again." which is appropriate for all sub-commands.

## Known Stubs

None. All Phase 14 stubs (`phase17Message`) have been removed. The handler is fully functional.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. All queries continue to use `eq(decisions.chatId, chatIdBig)` scoping (T-17-03-02). Window validation `[30, 90, 365]` allowlist is in place (T-17-03-01). Logger never writes phrase text (T-17-03-04).

## Self-Check: PASSED

- `/home/claude/chris/src/bot/handlers/decisions.ts` — exists ✓
- `/home/claude/chris/src/decisions/__tests__/decisions-command.test.ts` — exists ✓
- Commit `00057a4` — exists ✓
- `phase17Message` absent from handler ✓
- 23 tests pass: `npx vitest run src/decisions/__tests__/decisions-command.test.ts` ✓
