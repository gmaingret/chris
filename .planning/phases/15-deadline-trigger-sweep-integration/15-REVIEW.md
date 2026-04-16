---
phase: 15-deadline-trigger-sweep-integration
reviewed: 2026-04-16T14:30:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/decisions/capture-state.ts
  - src/decisions/__tests__/capture-state.test.ts
  - src/proactive/__tests__/deadline.test.ts
  - src/proactive/__tests__/state.test.ts
  - src/proactive/__tests__/sweep.test.ts
  - src/proactive/prompts.ts
  - src/proactive/state.ts
  - src/proactive/sweep.ts
  - src/proactive/triggers/commitment.ts
  - src/proactive/triggers/deadline.ts
  - src/proactive/triggers/pattern.ts
  - src/proactive/triggers/thread.ts
  - src/proactive/triggers/types.ts
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2026-04-16T14:30:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the dual-channel proactive sweep system: accountability channel (deadline trigger) and reflective channel (silence, commitment, pattern, thread triggers). The architecture is well-structured with clear separation of concerns, independent daily caps per channel, and good error isolation between channels.

Key concerns: one fragile evidence-parsing pattern in sweep.ts that could cause a runtime crash, stale `@ts-expect-error` directives in a test file, and a retry path in the deadline trigger that lacks error handling for the second transitionDecision call.

## Critical Issues

### CR-01: Fragile evidence string parsing for decision ID extraction

**File:** `src/proactive/sweep.ts:119`
**Issue:** The decision ID is extracted from the evidence array via string replacement: `deadlineResult.evidence![0]!.replace('Decision ID: ', '')`. This uses two non-null assertions (`!`) on data whose format is only guaranteed by convention in `deadline.ts:107`. If the evidence array is empty, missing, or if the format changes (e.g., the prefix is renamed), this line will either throw a runtime TypeError (on `undefined.replace`) or silently pass a corrupted decision ID to `upsertAwaitingResolution`, writing a bad row to the database.
**Fix:** Extract the decision ID as a structured field on the trigger result rather than parsing it out of a human-readable string. As a minimal fix, add a guard:
```typescript
const evidenceEntry = deadlineResult.evidence?.[0];
if (!evidenceEntry || !evidenceEntry.startsWith('Decision ID: ')) {
  logger.error({ evidence: deadlineResult.evidence }, 'proactive.sweep.accountability.error');
  // skip accountability send for this tick
} else {
  const decisionId = evidenceEntry.replace('Decision ID: ', '');
  // ... proceed with upsertAwaitingResolution
}
```
A better long-term fix is to add a `decisionId` field to `TriggerResult` (or a deadline-specific subtype) so the sweep does not need to parse evidence strings.

## Warnings

### WR-01: Unhandled error on retry path in deadline trigger

**File:** `src/proactive/triggers/deadline.ts:90`
**Issue:** After catching `OptimisticConcurrencyError` and re-querying, the second `transitionDecision` call (line 90) has no error handling. If this second call also throws `OptimisticConcurrencyError` or `InvalidTransitionError`, the error propagates unhandled to the caller instead of returning a clean `notTriggered` result.
**Fix:** Wrap the retry's `transitionDecision` in its own try/catch:
```typescript
candidate = retryRows[0]!;
try {
  await transitionDecision(candidate.id, 'open', 'due', { actor: 'sweep' });
} catch (retryErr) {
  if (retryErr instanceof OptimisticConcurrencyError || retryErr instanceof InvalidTransitionError) {
    return notTriggered('No due decisions after retry');
  }
  throw retryErr;
}
```

### WR-02: Stale @ts-expect-error directives in capture-state test

**File:** `src/decisions/__tests__/capture-state.test.ts:11-13`
**Issue:** Two `@ts-expect-error` comments suppress type errors for imports from `../../db/schema.js` and `../capture-state.js`. Both modules now exist and export the referenced symbols (`decisions`, `decisionEvents`, `decisionCaptureState`, `getActiveDecisionCapture`, `upsertAwaitingResolution`). When the suppressed error no longer exists, TypeScript treats `@ts-expect-error` as unused and may warn (with `--strict`), creating noise. More importantly, it silences real type errors that might surface later on these imports.
**Fix:** Remove both `@ts-expect-error` comments (lines 11 and 13).

### WR-03: Pattern trigger JSDoc says priority 3 but code uses priority 4

**File:** `src/proactive/triggers/pattern.ts:3`
**Issue:** The module-level JSDoc comment states "a TriggerDetector with priority 3" but the constant `PATTERN_PRIORITY` on line 13 is set to 4. This documentation mismatch could confuse future maintainers reasoning about trigger ordering.
**Fix:** Update the JSDoc to say "priority 4":
```typescript
 * a TriggerDetector with priority 4.
```

## Info

### IN-01: Thread trigger JSDoc says priority 4 but code uses priority 5

**File:** `src/proactive/triggers/thread.ts:3`
**Issue:** Same class of documentation mismatch as WR-03. The JSDoc says "priority 4" but the constant `THREAD_PRIORITY` is 5.
**Fix:** Update JSDoc to "priority 5".

### IN-02: Commitment trigger uses `inArray` for single-value filter

**File:** `src/proactive/triggers/commitment.ts:49`
**Issue:** `inArray(pensieveEntries.epistemicTag, ['INTENTION'])` uses `IN (...)` for a single-element array. This works correctly but `eq(pensieveEntries.epistemicTag, 'INTENTION')` would be clearer and marginally simpler SQL.
**Fix:** Replace with `eq(pensieveEntries.epistemicTag, 'INTENTION')`.

---

_Reviewed: 2026-04-16T14:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
