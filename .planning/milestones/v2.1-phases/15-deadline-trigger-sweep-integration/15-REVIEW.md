---
phase: 15-deadline-trigger-sweep-integration
reviewed: 2026-04-17T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/proactive/triggers/deadline.ts
  - src/proactive/triggers/types.ts
  - src/proactive/triggers/commitment.ts
  - src/proactive/triggers/pattern.ts
  - src/proactive/triggers/thread.ts
  - src/proactive/state.ts
  - src/proactive/prompts.ts
  - src/proactive/sweep.ts
  - src/decisions/capture-state.ts
findings:
  critical: 1
  warning: 3
  info: 4
  total: 8
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-04-17T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Reviewed Phase 15's dual-channel proactive sweep: accountability (deadline trigger) and reflective (silence/commitment/pattern/thread). The architecture is sound — global mute gating both channels, independent daily caps, write-before-send ordering for `upsertAwaitingResolution`, SQL-first oldest-due selection with optimistic-concurrency-aware retry, and stale-context dated framing past 48h are all correctly implemented.

The critical issue: the priority renumbering that the phase goal declared (silence=1, deadline=2, commitment=3, pattern=4, thread=5) is absent from the code. Current priorities are silence=1, deadline=2, commitment=2, pattern=3, thread=4. Deadline and commitment collide at priority=2. The earlier 15-VERIFICATION.md (line 68) and 15-REVIEW-FIX.md (WR-03) both reference the renumbered values, so this is a regression introduced by Phase 19's byte-exact restoration from the canonical 4c156c3 commit — the canonical snapshot predates the renumbering work.

Secondary concerns: deadline trigger uses wall-clock `new Date()` inside its SQL query and re-query, so the retry path may return a candidate that only just became due between the two reads; sweep.ts reads `decisionCaptureState` rows on every tick without any ordering/limit, so the escalation scan is unbounded; and `getEscalationCount` treats any non-number value as 0, which silently hides a corrupt KV state.

## Critical Issues

### CR-01: Priority collision — deadline and commitment both fire at priority=2

**File:** `src/proactive/triggers/commitment.ts:33,78` (also `src/proactive/sweep.ts:11` comment is stale)
**Issue:** The phase goal explicitly states the priority ordering is silence=1, deadline=2, commitment=3, pattern=4, thread=5. Current code:

- `silence.ts`: priority=1 (correct)
- `deadline.ts`: `DEADLINE_PRIORITY = 2` (correct)
- `commitment.ts`: hardcoded `priority: 2` on lines 33 and 78 (**should be 3**)
- `pattern.ts`: `PATTERN_PRIORITY = 3` (**should be 4**)
- `thread.ts`: `THREAD_PRIORITY = 4` (**should be 5**)

The reflective-channel tie-breaker in `sweep.ts:351` is `a.priority - b.priority` (stable sort not guaranteed in V8 across all paths, but practically stable). When both silence and commitment fire in Phase 1 with priorities 1 and 2, the existing winner-selection works. But any future trigger tuning that assumes deadline (2) and commitment (3) are distinct priorities is broken by this collision. More importantly, the `sweep.ts:11-12` JSDoc explicitly says "commitment (priority 3)" and "pattern (priority 4) + thread (priority 5)" — so the documented architecture and the code disagree.

The stale state was introduced when Phase 19 re-restored these files byte-exact from canonical `4c156c3`, which predates the priority renumbering work. Both `15-VERIFICATION.md` (line 68) and `15-REVIEW-FIX.md` (WR-03) claim the renumbering was applied, so there is a real regression here relative to the phase's recorded verification state.

**Fix:** Apply the renumbering across all three files:

```typescript
// commitment.ts — lines 33 and 78 (and JSDoc at line 9 if it exists)
priority: 3,

// pattern.ts — line 11
const PATTERN_PRIORITY = 4;
// and update JSDoc line 3: "a TriggerDetector with priority 4."

// thread.ts — line 11
const THREAD_PRIORITY = 5;
// and update JSDoc line 3: "a TriggerDetector with priority 5."
```

Add a regression test in `deadline.test.ts` (or a new `priority-map.test.ts`) that asserts the five triggers return the expected priorities, so a byte-restore from an older snapshot surfaces this immediately.

## Warnings

### WR-01: Deadline trigger re-query uses a fresh `new Date()` that may widen the candidate set

**File:** `src/proactive/triggers/deadline.ts:85`
**Issue:** The retry path calls `queryDueDecisions()` a second time, which is a closure that reads the outer `now` variable defined on line 56. Good — the re-query is bounded by the original `now`. However, `transitionDecision` (lifecycle.ts) internally uses `new Date()` for `updatedAt`, and the retry uses the same `{ actor: 'sweep' }` actor. If many decisions become due in the sub-second between first query and retry, the retry will still correctly pick the same oldest-first candidate, so this is not a correctness bug.

The real issue is subtler: the retry re-selects **the current oldest open+due row**, which on retry is the same row we just failed on only if no other process transitioned it. After an OptimisticConcurrencyError the row is no longer `status='open'`, so the retry will correctly skip it and pick the next oldest. That's the intended behavior. No fix required for correctness, but add a comment clarifying this so future readers don't think the retry could infinite-loop on the same candidate:

```typescript
// Re-query uses the same `now`; the previously-failed candidate is no longer
// status='open', so LIMIT 1 ORDER BY resolve_by ASC returns the next oldest.
const retryRows = await queryDueDecisions();
```

### WR-02: Escalation scan in sweep.ts is unbounded

**File:** `src/proactive/sweep.ts:178-186`
**Issue:** The `AWAITING_RESOLUTION` escalation scan selects all rows from `decisionCaptureState` where `stage = 'AWAITING_RESOLUTION'` with no `LIMIT`, no `ORDER BY`, and no batching. In practice the table is keyed by `chatId` so there is at most one row per chat, but the loop body executes multiple DB round-trips per row (getEscalationSentAt, getEscalationCount, setEscalationCount, setEscalationSentAt, transitionDecision, clearCapture, clearEscalationKeys) plus a Sonnet call on the follow-up path. If the authorized-user table grows to multiple chats or if rows accumulate, the sweep tick latency becomes unbounded and a single slow LLM call blocks all subsequent escalations.
**Fix:** Add `.limit(N)` with N chosen per expected scale (e.g., 10) and `.orderBy(asc(decisionCaptureState.updatedAt))` so the oldest awaiting-resolution rows escalate first:

```typescript
const awaitingRows = await db
  .select({ chatId: decisionCaptureState.chatId, decisionId: decisionCaptureState.decisionId })
  .from(decisionCaptureState)
  .where(eq(decisionCaptureState.stage, 'AWAITING_RESOLUTION'))
  .orderBy(asc(decisionCaptureState.updatedAt))
  .limit(10);
```

### WR-03: `getEscalationCount` silently returns 0 on non-numeric JSONB values

**File:** `src/proactive/state.ts:157-160`
**Issue:** `getEscalationCount` returns `typeof val === 'number' ? val : 0`. If the KV store ever contains a string or a truncated write (for example, `"1"` vs `1`), the count silently resets to 0, which re-arms the 48h follow-up cycle. This hides corruption rather than failing loudly. The count controls escalation-to-stale transitions (count >= 2 → `transitionDecision('due', 'stale')`), so a silent reset means a decision can receive >2 follow-ups and never escalate to stale.
**Fix:** Log and fail loudly on type mismatch; treat only `null`/`undefined` as "not yet set":

```typescript
export async function getEscalationCount(decisionId: string): Promise<number> {
  const val = await getValue(escalationCountKey(decisionId));
  if (val == null) return 0;
  if (typeof val !== 'number') {
    logger.warn({ decisionId, val }, 'proactive.state.escalation_count.non_numeric');
    return 0;
  }
  return val;
}
```

## Info

### IN-01: `sweep.ts:11-12` JSDoc references the (now-missing) renumbered priorities

**File:** `src/proactive/sweep.ts:11-12`
**Issue:** Comment says "silence (priority 1) + commitment (priority 3)" and "pattern (priority 4) + thread (priority 5)". Once CR-01 is applied, this comment will be correct. Until then it is misleading. Flagged as Info because the fix is the same edit as CR-01 and the block comment does not itself cause a runtime behavior.
**Fix:** Resolved by applying CR-01.

### IN-02: Pattern and thread trigger JSDoc lines will need matching priority updates

**File:** `src/proactive/triggers/pattern.ts:3` and `src/proactive/triggers/thread.ts:3`
**Issue:** JSDoc already matches the (wrong) constants (3 and 4). When CR-01 renumbers the constants to 4 and 5, the JSDoc must also be updated to match.
**Fix:** Update both JSDoc lines as part of CR-01.

### IN-03: `commitment.ts:49` uses `inArray` for a single-value filter

**File:** `src/proactive/triggers/commitment.ts:49`
**Issue:** `inArray(pensieveEntries.epistemicTag, ['INTENTION'])` emits `IN (...)` for a one-element array. `eq(pensieveEntries.epistemicTag, 'INTENTION')` is clearer and is what the rest of the codebase uses.
**Fix:** Replace with `eq(pensieveEntries.epistemicTag, 'INTENTION')`.

### IN-04: `runReflectiveChannel` parameter type is a duplicated inline shape instead of `TriggerResult`

**File:** `src/proactive/sweep.ts:347`
**Issue:** The `fired` parameter's type is hand-written as `Array<{ triggered: boolean; triggerType: string; priority: number; context: string; evidence?: string[] }>` instead of `Array<TriggerResult>`. This works (the shape is compatible by structural typing) but means future changes to `TriggerResult` (e.g., adding a `decisionId` field per the prior review's CR-01 long-term fix) will not flow through. The reviewer who added the evidence-parsing guard was already considering structured fields on `TriggerResult` — this is the same coupling opportunity.
**Fix:** Import `TriggerResult` and use it directly:

```typescript
import type { TriggerResult } from './triggers/types.js';

async function runReflectiveChannel(
  fired: TriggerResult[],
  startMs: number,
): Promise<ChannelResult> { ... }
```

---

_Reviewed: 2026-04-17T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
