---
phase: 15-deadline-trigger-sweep-integration
fixed_at: 2026-04-17T05:48:00Z
review_path: .planning/phases/15-deadline-trigger-sweep-integration/15-REVIEW.md
iteration: 2
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 15: Code Review Fix Report

**Fixed at:** 2026-04-17T05:48:00Z
**Source review:** `.planning/phases/15-deadline-trigger-sweep-integration/15-REVIEW.md`
**Iteration:** 2

> Note: Iteration 2 is the post-Phase 19 restoration review. Phase 19's byte-exact restore
> from canonical commit `4c156c3` reintroduced the pre-renumbering priority constants;
> iteration 2 first re-applied the phase-15 priority renumbering and the three Warning
> fixes, then cleared the remaining four Info findings (IN-01…IN-04). IN-01 and IN-02
> are already resolved by the CR-01 fix commits; IN-03 and IN-04 were applied as new
> discrete commits under the `fix(15): IN-NN` convention.

**Summary:**
- Findings in scope: 8 (1 Critical + 3 Warning + 4 Info)
- Fixed: 8
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

### IN-01: `sweep.ts:11-12` JSDoc references the renumbered priorities

**Files modified:** none (already correct after CR-01)
**Commit:** resolved by `da2f9c6` (CR-01)
**Applied fix:** The `sweep.ts` dual-channel JSDoc at lines 11-12 already reads "silence (priority 1) + commitment (priority 3)" and "pattern (priority 4) + thread (priority 5)" — this matches the post-renumbering source constants as of CR-01. The Info finding explicitly notes "Once CR-01 is applied, this comment will be correct" — no separate commit required. Verified by reading lines 1-22 of the current `sweep.ts`.

### IN-02: Pattern and thread trigger JSDoc lines matching priority updates

**Files modified:** none (already correct after CR-01)
**Commits:** resolved by `da2f9c6` (CR-01) and `b6fa824` (pattern.ts JSDoc follow-up)
**Applied fix:**
- `pattern.ts` JSDoc line 3 reads "a TriggerDetector with priority 4." and JSDoc line 5 reads "Priority: 4 (silence=1, deadline=2, commitment=3, pattern=4, thread=5)" — matches `PATTERN_PRIORITY = 4`.
- `thread.ts` JSDoc line 3 reads "a TriggerDetector with priority 5." and JSDoc line 5 reads "Priority: 5 (silence=1, deadline=2, commitment=3, pattern=4, thread=5)" — matches `THREAD_PRIORITY = 5`.
- Both updates were applied in the same CR-01 commit (`da2f9c6`) as the constant renumbering; `b6fa824` is an earlier in-phase correction of the pattern-trigger JSDoc (pre-Phase-19 restoration). No new commit required for iteration 2.

### IN-03: `commitment.ts` uses `inArray` for a single-value filter

**Files modified:** `src/proactive/triggers/commitment.ts`
**Commit:** `8b8ad77`
**Applied fix:**
- Replaced `inArray(pensieveEntries.epistemicTag, ['INTENTION'])` with `eq(pensieveEntries.epistemicTag, 'INTENTION')` on the `.where()` clause of the stale-commitment query.
- Updated the `drizzle-orm` named import: swapped `inArray` out for `eq`. Final import: `import { and, eq, lt, isNull, asc } from 'drizzle-orm';`.
- Matches the rest of the codebase's idiom for single-value equality predicates (e.g., the `runEscalation` scan in `sweep.ts` already uses `eq`).
- Emits `= 'INTENTION'` rather than `IN ('INTENTION')`; semantically identical, clearer at read time, and one fewer SQL implementation edge-case to reason about (postgres optimizer treats them the same, but `eq` is more grep-able as a single-tag predicate).

### IN-04: `runReflectiveChannel` parameter type is a duplicated inline shape

**Files modified:** `src/proactive/sweep.ts`
**Commit:** `3fee630`
**Applied fix:**
- Added `import type { TriggerResult } from './triggers/types.js';` to `sweep.ts` (placed adjacent to the other `./triggers/*` imports).
- Replaced the inline parameter type `Array<{ triggered: boolean; triggerType: string; priority: number; context: string; evidence?: string[] }>` with `TriggerResult[]` on `runReflectiveChannel`.
- Benefit: future changes to `TriggerResult` (e.g., the prospective `decisionId` field from the prior review's long-term fix) now flow through automatically instead of silently diverging at the inline shape.
- Type-check pass: `npx tsc --noEmit` reports zero errors scoped to `sweep.ts`. The full required test gate (5 files, 79 tests) and `opus-analysis.test.ts` (20 tests) both stayed green after the change — `TriggerResult` is structurally compatible with the old inline shape.

## Testing gate

**Command (as specified in workflow):**
```
bash scripts/test.sh --no-coverage \
  src/proactive/__tests__/sweep.test.ts \
  src/proactive/__tests__/sweep-escalation.test.ts \
  src/proactive/__tests__/deadline.test.ts \
  src/proactive/__tests__/state.test.ts \
  src/proactive/__tests__/priority-map.test.ts
```

**Result (final, after all Info fixes):** **5 test files, 79 tests, all pass.** Real postgres via `docker-compose.local.yml`, migrations applied, zero mocks substituting for integration DB. Duration ~2.0s post-Docker-startup.

**Extended verification (files I touched in Info pass):**
- `commitment.test.ts`: **8/8 pass** after IN-03's `eq` substitution.
- `opus-analysis.test.ts`: **20/20 pass** after IN-04's `TriggerResult[]` retype.
- `npx tsc --noEmit`: zero errors on `commitment.ts` and `sweep.ts`.

No regressions detected. The user's durable preference (always run real postgres, never mock as substitute) was honoured — every test run used `scripts/test.sh` with real Docker postgres + full migrations. Docker integration tests were never skipped.

## Commits (in order, all eight findings)

| Hash | Finding | Summary |
|------|---------|---------|
| `da2f9c6` | CR-01 | Renumber trigger priorities to silence=1/deadline=2/commitment=3/pattern=4/thread=5 + add regression test |
| `c6ebc08` | WR-01 | Clarify deadline retry does not infinite-loop on same candidate |
| `8518000` | WR-02 | Bound escalation scan with ORDER BY updatedAt ASC + LIMIT 10 |
| `1a24d3e` | WR-03 | Log warn when getEscalationCount reads non-numeric JSONB |
| `7605e40` | CR-01 | Repair priority-map test DB mock to handle silence's no-.limit chain |
| (no new) | IN-01 | Resolved by CR-01 — `sweep.ts:11-12` JSDoc already matches post-renumbering |
| (no new) | IN-02 | Resolved by CR-01 + `b6fa824` — pattern/thread JSDoc priority lines already match |
| `8b8ad77` | IN-03 | Use `eq` instead of `inArray` for single-value INTENTION filter in commitment.ts |
| `3fee630` | IN-04 | Type `runReflectiveChannel` fired param as `TriggerResult[]` |

---

_Fixed: 2026-04-17T05:48:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
