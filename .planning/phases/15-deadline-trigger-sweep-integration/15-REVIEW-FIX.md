---
phase: 15-deadline-trigger-sweep-integration
fixed_at: 2026-04-17T21:00:00Z
review_path: .planning/phases/15-deadline-trigger-sweep-integration/15-REVIEW.md
iteration: 2
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-04-17T21:00:00Z
**Source review:** `.planning/phases/15-deadline-trigger-sweep-integration/15-REVIEW.md`
**Iteration:** 2

> Note: Iteration 2 is the post-Phase 19 restoration review. Phase 19's byte-exact restore
> from canonical commit `4c156c3` reintroduced the pre-renumbering priority constants;
> this iteration re-applies the phase-15 priority renumbering and adds a regression test
> to prevent future byte-restores from silently reintroducing the collision.

**Summary:**
- Findings in scope: 4 (1 Critical + 3 Warning; Info deferred)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: Priority collision — deadline and commitment both fire at priority=2

**Files modified:**
- `src/proactive/triggers/commitment.ts`
- `src/proactive/triggers/pattern.ts`
- `src/proactive/triggers/thread.ts`
- `src/proactive/__tests__/commitment.test.ts`
- `src/proactive/__tests__/opus-analysis.test.ts`
- `src/proactive/__tests__/priority-map.test.ts` (new)

**Commits:** `da2f9c6` (source + tests + regression), `7605e40` (mock repair for silence's no-.limit chain)
**Applied fix:**
- Renumbered `commitment.ts` hardcoded `priority: 2` (two sites) to a `COMMITMENT_PRIORITY = 3` constant, and updated the JSDoc header to record the priority.
- `pattern.ts`: `PATTERN_PRIORITY` 3 → 4; JSDoc updated.
- `thread.ts`: `THREAD_PRIORITY` 4 → 5; JSDoc updated.
- Updated `commitment.test.ts` priority assertions 2 → 3 (three call sites, including the `always returns priority N` test name).
- Updated `opus-analysis.test.ts`: pattern trigger test renamed + asserts 4 (was 3); thread trigger test renamed + asserts 5 (was 4).
- Added `src/proactive/__tests__/priority-map.test.ts` — 6 regression tests that:
  1. Assert each of the five triggers returns its canonical priority (1/2/3/4/5).
  2. Assert `deadline.priority !== commitment.priority` (the specific collision this regression reintroduced).
  3. Assert the full priority array is strictly ascending `[1,2,3,4,5]` with no collisions and a `Set` size of 5.

The existing `sweep.test.ts` already expected the post-renumbering values (commitment=3, pattern=4, thread=5) — no edit needed. The drift was purely in the source-code constants, confirming the test harness was correct all along and the regression was a restore-from-old-snapshot event.

The priority-map regression test is the load-bearing defense: any future byte-restore from a pre-renumbering snapshot will fail 5 + 1 assertions immediately, in a dedicated test file that makes the regression unambiguous at review time.

### WR-01: Deadline trigger re-query clarification

**Files modified:** `src/proactive/triggers/deadline.ts`
**Commit:** `c6ebc08`
**Applied fix:** Added a 5-line comment block above the retry `queryDueDecisions()` call in the `OptimisticConcurrencyError` path explaining why the retry cannot infinite-loop on the same candidate: the previously-failed row is no longer `status='open'` (another actor transitioned it), and `ORDER BY resolve_by ASC LIMIT 1` naturally picks the next-oldest open+due row on retry. No behavior change — pure documentation for future readers.

### WR-02: Bound the escalation scan in sweep.ts

**Files modified:** `src/proactive/sweep.ts`, `src/proactive/__tests__/sweep-escalation.test.ts`
**Commit:** `8518000`
**Applied fix:**
- Added `asc` to the `drizzle-orm` named import line in `sweep.ts`.
- Added `.orderBy(asc(decisionCaptureState.updatedAt)).limit(10)` to the `AWAITING_RESOLUTION` scan query. This caps sweep-tick latency as the `decision_capture_state` table grows, and ensures the least-recently-touched rows escalate first across ticks (oldest waiters processed first, per REVIEW.md guidance).
- REVIEW.md's example code used `updatedAt` (the column that exists in `src/db/schema.ts:282`). The user fix note mentioned `createdAt` which is not on this schema — I matched the schema and the reviewer's own code block by using `updatedAt`. Documented this disambiguation inline in the commit comment above the query.
- Updated the DB mock in `sweep-escalation.test.ts` to expose `chain.orderBy` (returns chain) and to handle the `decision_capture_state` table at the `.limit()` terminator (returns `awaitingRows`). All 8 sweep-escalation tests still pass after the mock change.

### WR-03: `getEscalationCount` non-numeric JSONB handling

**Files modified:** `src/proactive/state.ts`
**Commit:** `1a24d3e`
**Applied fix:**
- Added `logger` import from `../utils/logger.js`.
- Rewrote `getEscalationCount` to distinguish three cases:
  - `val == null` → return 0 (key not set yet; normal path).
  - `typeof val !== 'number'` → log `proactive.state.escalation_count.non_numeric` warn with `{ decisionId, val, valType }` and still return 0.
  - Otherwise return the number as-is.
- Chose "log + return 0" over "throw on corruption" per REVIEW.md's offered alternative. Throwing would hard-fail every sweep tick on a single corrupted row — worse operational behavior than logging + fallback. The warn log makes the corruption observable (the core ask), which is strictly better than the silent reset the pre-fix code did.

## Testing gate

**Command (as specified in workflow):**
```
bash scripts/test.sh --no-coverage \
  src/proactive/__tests__/sweep.test.ts \
  src/proactive/__tests__/sweep-escalation.test.ts \
  src/proactive/__tests__/deadline.test.ts \
  src/proactive/__tests__/state.test.ts \
  src/decisions/__tests__/synthetic-fixture.test.ts
```

**Result:** **5 test files, 75 tests, all pass.** Real postgres via `docker-compose.local.yml`, migrations applied, zero mocks substituting for integration DB. Duration ~1.1s after Docker startup.

**Extended verification (outside the required gate, to cover the files I touched):**
- `priority-map.test.ts` (new): **6/6 pass** — regression test for CR-01, the load-bearing defense.
- `commitment.test.ts` (modified): **9/9 pass**.
- `opus-analysis.test.ts` (modified): **19/19 pass**.
- Full `src/proactive/__tests__/` directory: **10 test files, 144 tests, all pass.**

No regressions detected. The user's durable preference (always run real postgres, never mock as substitute) was honoured throughout — every test run used `scripts/test.sh` with real Docker postgres + full migrations.

## Info findings (deferred — not in scope)

Scope was `critical_warning` only per workflow config. Info findings remain open for a follow-up pass:
- **IN-01:** `sweep.ts:11-12` JSDoc — was already correct before CR-01 (the JSDoc actually matched the renumbered priorities; the source constants were the regression, not the comment). Effectively resolved at zero cost.
- **IN-02:** Pattern/thread JSDoc priority lines — addressed as part of CR-01 (pattern JSDoc line 2 → "priority 4", thread JSDoc line 2 → "priority 5", plus added canonical priority-map line in both headers).
- **IN-03:** `commitment.ts:49` `inArray` → `eq` style change — cosmetic, deferred.
- **IN-04:** `runReflectiveChannel` parameter type → `TriggerResult[]` — small refactor, deferred.

IN-01 and IN-02 are already resolved by CR-01's fix commits. IN-03 and IN-04 are stylistic and can be picked up independently.

## Commits (in order)

| Hash | Finding | Summary |
|------|---------|---------|
| `da2f9c6` | CR-01 | Renumber trigger priorities to silence=1/deadline=2/commitment=3/pattern=4/thread=5 + add regression test |
| `c6ebc08` | WR-01 | Clarify deadline retry does not infinite-loop on same candidate |
| `8518000` | WR-02 | Bound escalation scan with ORDER BY updatedAt ASC + LIMIT 10 |
| `1a24d3e` | WR-03 | Log warn when getEscalationCount reads non-numeric JSONB |
| `7605e40` | CR-01 | Repair priority-map test DB mock to handle silence's no-.limit chain |

---

_Fixed: 2026-04-17T21:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
