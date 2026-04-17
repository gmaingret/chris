---
phase: 17-decisions-command-accuracy-stats
plan: "01"
subsystem: decisions
tags: [accuracy-classification, haiku, tdd, stat-02]
dependency_graph:
  requires:
    - src/decisions/resolution.ts (Phase 16 handleResolution)
    - src/llm/client.ts (HAIKU_MODEL, anthropic)
    - src/db/schema.ts (decisions.accuracyClass, decisionEvents)
  provides:
    - src/decisions/classify-accuracy.ts (classifyAccuracy exported function)
    - src/decisions/resolution.ts updated with accuracy wiring
  affects:
    - Every decision resolution now writes accuracy_class, accuracy_classified_at, accuracy_model_version
    - Every resolution appends a 'classified' event to decision_events
tech_stack:
  added: []
  patterns:
    - Promise.race timeout pattern (replicates classifyOutcome from resolution.ts)
    - Fail-closed classification (unknown on any failure)
    - Try/catch around classify block so resolution flow never breaks
key_files:
  created:
    - src/decisions/classify-accuracy.ts
    - src/decisions/__tests__/classify-accuracy.test.ts
  modified:
    - src/decisions/resolution.ts
    - src/decisions/__tests__/resolution.test.ts
decisions:
  - "classifyAccuracy replicates classifyOutcome pattern exactly (same timeout, same fail-closed, same JSON parse guard)"
  - "accuracy classification block wrapped in try/catch so classifyAccuracy throw never breaks resolution flow (D-04)"
  - "classified event inserted directly via db.insert(decisionEvents), NOT through transitionDecision (Pitfall 3)"
  - "eq from drizzle-orm added to resolution.test.ts imports (previously missing)"
  - "sql.end() moved from getTemporalPensieve afterAll to the new last describe block to prevent premature connection close"
metrics:
  duration_minutes: 20
  tasks_completed: 2
  files_created: 2
  files_modified: 2
  completed_at: "2026-04-16T14:32:09Z"
requirements: [STAT-02]
---

# Phase 17 Plan 01: Accuracy Classification Haiku Classifier Summary

2-axis Haiku reasoning classifier wired into handleResolution, caching `accuracy_class` (e.g. `"hit/sound"`) on every resolved decision at resolution time with a `classified` event in `decision_events`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for classifyAccuracy() | 2f1b229 | classify-accuracy.test.ts |
| 1 (GREEN) | Implement classifyAccuracy() | f6855bd | classify-accuracy.ts |
| 2 (RED) | Failing tests for handleResolution accuracy wiring | 99cc7f7 | resolution.test.ts |
| 2 (GREEN) | Wire classifyAccuracy into handleResolution | ae18421 | resolution.ts |

## What Was Built

### Task 1: `src/decisions/classify-accuracy.ts`

Standalone Haiku classifier that takes a known `outcome`, Greg's `resolutionText`, and the original `prediction`, then returns `ReasoningClass = 'sound' | 'lucky' | 'flawed' | 'unknown'`.

- Replicates the exact `classifyOutcome()` pattern (5000ms `Promise.race` timeout, JSON parse, value set validation)
- System prompt: classifies reasoning quality independently of outcome correctness
- Fail-closed to `'unknown'` on: timeout, no text block, parse error, invalid value, any exception (D-04, T-17-01-01, T-17-01-02)
- User text in `messages[].content` only — never in system prompt (T-17-01-03)
- Logs `accuracy.classify` on success, `accuracy.classify.*` warnings on failure

### Task 2: `src/decisions/resolution.ts` — accuracy wiring

After the existing `classifyOutcome()` call in `handleResolution()`, a new block:

1. Initializes `accuracyClass = '<outcome>/unknown'`
2. Calls `classifyAccuracy(outcome, text, decision.prediction)` in try/catch
3. On success: `accuracyClass = '<outcome>/<reasoning>'` (e.g. `"hit/sound"`)
4. On failure: keeps `'<outcome>/unknown'`, logs warn — resolution flow continues
5. Writes `accuracyClass`, `accuracyClassifiedAt`, `accuracyModelVersion` to `decisions` row
6. Inserts `classified` event to `decision_events` with `{ accuracyClass, accuracyModelVersion }` snapshot
7. Event inserted directly via `db.insert(decisionEvents)` — NOT through `transitionDecision` (Pitfall 3)

## Verification Results

```
npx vitest run src/decisions/__tests__/classify-accuracy.test.ts
  Tests  6 passed (6)

npx vitest run src/decisions/__tests__/resolution.test.ts
  Tests  21 passed (21)  [16 existing + 5 new Phase 17 tests]

npx vitest run src/decisions/__tests__/classify-accuracy.test.ts src/decisions/__tests__/resolution.test.ts
  Tests  27 passed (27)
```

Note: When running all decisions test files simultaneously (e.g. `vitest run src/decisions/`), 7 tests fail due to pre-existing test isolation issues (shared postgres state across concurrent test files). This is not caused by this plan — confirmed by verifying the same 7 failures exist on the base commit before any changes. Each test file passes cleanly in isolation, which is how `scripts/test.sh` runs them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Import] Added `eq` import to resolution.test.ts**
- **Found during:** Task 2 RED phase
- **Issue:** New tests needed `eq` from drizzle-orm but it wasn't imported in resolution.test.ts
- **Fix:** Added `import { eq } from 'drizzle-orm'` to the test file imports
- **Files modified:** src/decisions/__tests__/resolution.test.ts
- **Commit:** 99cc7f7

**2. [Rule 1 - Bug] Moved `sql.end()` to last describe block**
- **Found during:** Task 2 RED phase execution
- **Issue:** `getTemporalPensieve` describe block had `afterAll(sql.end())` which closed the DB connection before the new Phase 17 describe block ran, causing CONNECTION_ENDED errors
- **Fix:** Removed `afterAll(sql.end())` from `getTemporalPensieve` block, added it to the new last describe block `handleResolution — Phase 17 accuracy classification`
- **Files modified:** src/decisions/__tests__/resolution.test.ts
- **Commit:** 99cc7f7

## Known Stubs

None. All accuracy fields are written with real values from the Haiku classifier.

## Threat Surface Scan

All threats in the plan's `<threat_model>` are mitigated:

| Threat ID | Status | Evidence |
|-----------|--------|---------|
| T-17-01-01 | Mitigated | `VALID_REASONING.has(reasoning)` validates parsed value; returns 'unknown' on invalid value |
| T-17-01-02 | Mitigated | `Promise.race([..., timeout(5000)])` + outer try/catch; returns 'unknown' on timeout or throw |
| T-17-01-03 | Accepted | User text in `messages[].content` only; system prompt contains no user data |

No new threat surface introduced beyond what the plan covers.

## Self-Check

### Files exist:
- src/decisions/classify-accuracy.ts — FOUND
- src/decisions/__tests__/classify-accuracy.test.ts — FOUND
- src/decisions/resolution.ts (modified) — FOUND
- src/decisions/__tests__/resolution.test.ts (modified) — FOUND
- .planning/phases/17-decisions-command-accuracy-stats/17-01-SUMMARY.md — FOUND

### Commits exist:
- 2f1b229 — test(17-01): add failing tests for classifyAccuracy() RED
- f6855bd — feat(17-01): implement classifyAccuracy() reasoning-axis Haiku classifier
- 99cc7f7 — test(17-01): add failing tests for handleResolution accuracy wiring RED
- ae18421 — feat(17-01): wire classifyAccuracy into handleResolution + classified event

## Self-Check: PASSED
