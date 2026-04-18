---
phase: 19-proactive-pipeline-restoration
reviewed: 2026-04-17T13:30:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - scripts/test.sh
  - src/proactive/triggers/types.ts
  - src/proactive/state.ts
  - src/proactive/prompts.ts
  - src/proactive/sweep.ts
  - src/decisions/__tests__/synthetic-fixture.test.ts
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 19: Code Review Report

**Reviewed:** 2026-04-17T13:30:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found (no Critical; 2 Warning, 5 Info)

## Summary

Phase 19 is a restoration phase: 5 of 6 files in scope are byte-exact reproductions of canonical commit `4c156c3` (verified via `diff <(git show 4c156c3:<path>) <path>` returning empty for all 5). The one substantive code change is `src/decisions/__tests__/synthetic-fixture.test.ts` TEST-12, realigned to the channel-separation contract.

Review findings split into two buckets per request:

- **(a) New/realigned code (TEST-12 + STATE.md tech debt note):** no Critical or Warning issues; 3 Info items on assertion completeness in the realigned test.
- **(b) Inherent canonical code (would be Phase 15/16 findings):** 2 Warning items on the escalation block in `sweep.ts`, plus 2 Info items on `state.ts` KV helper permissiveness. These were already validated in Phase 15/16; flagging here only because the review brief asked to re-verify design quality of restored code as though fresh.

Accepted tech debt (TECH-DEBT-19-01, migration meta snapshots 0001/0003) and pre-existing Cat A/B test failures are not re-flagged per scope guidance.

TypeScript compiles clean (verified by `19-VERIFICATION.md` behavioral check `npx tsc --noEmit` → exit 0). All 75 Phase 19 tests pass under Docker Postgres. Restoration fidelity is sound; the design is the same design Phase 15/16 shipped.

## Warnings

### WR-01: Non-atomic escalation state writes can desync on partial failure

**File:** `src/proactive/sweep.ts:252-253`
**Bucket:** (b) inherent canonical

**Issue:** The 48h follow-up branch writes `setEscalationCount(row.decisionId, 2)` (line 252) followed by `setEscalationSentAt(row.decisionId, new Date())` (line 253) as two separate KV calls against `proactive_state`. There is no transaction wrapping the pair. If the second call throws (connection drop, constraint error, etc.), `count=2` is persisted without the matching `sentAt` timestamp update — on the next sweep tick, the `count >= 2` branch at line 208 will fire and transition the decision to `stale` using an outdated `sentAt`, potentially prematurely (the second follow-up was sent but its timestamp didn't land, so the stale logic cannot prove the 48h-after-second-prompt window was honored).

Lines 196-197 (bootstrap branch) have the inverse order (`setEscalationSentAt` first, then `setEscalationCount`) — same atomicity gap, but with count=1 it's less damaging.

**Fix:** Wrap both helpers in a single drizzle transaction, or extend `state.ts` with a combined helper:

```typescript
// In state.ts — new helper:
export async function setEscalationState(
  decisionId: string,
  count: number,
  sentAt: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Use tx for both upserts so they commit/roll-back together
    // (adapt getValue/setValue to accept an optional tx param, or inline here)
    ...
  });
}

// In sweep.ts line 252-253 (and 196-197):
await setEscalationState(row.decisionId, 2, new Date());
```

### WR-02: One failing LLM call aborts the entire escalation pass for remaining decisions

**File:** `src/proactive/sweep.ts:187-257`
**Bucket:** (b) inherent canonical

**Issue:** The escalation loop iterates `awaitingRows` sequentially inside a single `try` block spanning lines 178-260. If the per-row LLM call at line 239-244 throws (Anthropic API 5xx, network blip, rate limit), the outer `catch` at line 258 logs `proactive.sweep.escalation.error` and the loop exits. Subsequent rows in the same tick are not processed, and there is no retry queue — those decisions simply skip this tick. With a daily sweep cadence, a single transient LLM failure can delay multiple decisions' 48h follow-ups by 24h each.

**Fix:** Move the try/catch inside the `for (const row of awaitingRows)` loop so a single row's failure only skips that row:

```typescript
for (const row of awaitingRows) {
  if (!row.decisionId) continue;
  try {
    // existing per-row logic (sentAt check, count branches, LLM call, writes)
  } catch (err) {
    logger.error(
      { err, decisionId: row.decisionId },
      'proactive.sweep.escalation.row.error',
    );
    // Continue to next row
  }
}
```

Keep an outer catch for errors from the top-level `db.select()` on line 179-185.

## Info

### IN-01: TEST-12 does not assert channel invocation ORDER at the state-helper boundary

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:616-617`
**Bucket:** (a) new/realigned code

**Issue:** The test asserts `mockSetLastSentAccountability` and `mockSetLastSentReflective` were each called exactly once (correct per SWEEP-02 channel-separation), but does not prove D-05's "accountability fires first" at the state-write boundary. Order is currently inferred from `firstMsg.toContain('predicted')` / `secondMsg.toContain('quiet')` at lines 605-606, which works only because the two prompts happen to contain distinguishable tokens — a fragile content-based signal.

**Fix:** Add an invocation-order assertion using vitest's `invocationCallOrder`:

```typescript
expect(mockSetLastSentAccountability.mock.invocationCallOrder[0])
  .toBeLessThan(mockSetLastSentReflective.mock.invocationCallOrder[0]);
```

This makes the D-05 ordering contract explicit at the state layer, independent of prompt text.

### IN-02: TEST-12 does not assert `result.skippedReason` on the happy path

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:593-597`
**Bucket:** (a) new/realigned code

**Issue:** When both channels fire, `sweep.ts:326-328` sets `skippedReason = undefined`. TEST-12 never asserts this, so a future regression that incorrectly sets `skippedReason = 'no_trigger'` when `triggered === true` would not be caught by this test.

**Fix:** Add `expect(result.skippedReason).toBeUndefined();` alongside the `result.triggered === true` assertion at line 593.

### IN-03: TEST-12 `FAKE_DECISION_ID` is not a valid UUID string

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:559`
**Bucket:** (a) new/realigned code

**Issue:** `const FAKE_DECISION_ID = 'test-decision-uuid-for-test-12';` is a descriptive label, not a valid UUID. Because `upsertAwaitingResolution` is mocked (line 208-210), this never reaches the real drizzle `uuid` column, so the test passes. However, if someone later un-mocks that helper to integration-test the write path, the non-UUID string would throw a pg type error that may mask the real bug under test.

**Fix:** Use `crypto.randomUUID()` or a static valid UUID like `'00000000-0000-4000-8000-000000000012'`:

```typescript
const FAKE_DECISION_ID = '00000000-0000-4000-8000-000000000012';
```

### IN-04: `getEscalationCount` silently returns 0 on unexpected stored type

**File:** `src/proactive/state.ts:157-160`
**Bucket:** (b) inherent canonical

**Issue:** `return typeof val === 'number' ? val : 0;` swallows non-number values (e.g., if a prior bug stored `"1"` as a string). A future escalation count of 1 persisted as a string would be read as 0, silently re-sending the first prompt and resetting the escalation timeline. Probability low (JSONB + `setEscalationCount` always passes `number`), but the silent-coerce-to-0 is defensive in the wrong direction — it hides corruption instead of surfacing it.

**Fix:** Log a warning when the stored value exists but is not a number:

```typescript
export async function getEscalationCount(decisionId: string): Promise<number> {
  const val = await getValue(escalationCountKey(decisionId));
  if (val == null) return 0;
  if (typeof val !== 'number') {
    logger.warn(
      { decisionId, storedType: typeof val, storedValue: val },
      'state.escalation_count.unexpected_type',
    );
    return 0;
  }
  return val;
}
```

### IN-05: `getEscalationSentAt` uses truthy check instead of null check

**File:** `src/proactive/state.ts:147-149`
**Bucket:** (b) inherent canonical

**Issue:** `return val ? new Date(val as string) : null;` — the truthy check treats empty string `""` the same as `null`. Since `setEscalationSentAt` always writes an ISO string (never `""`), this is safe in practice, but inconsistent with the null-check pattern used elsewhere in the same file (lines 42, 76, 104, 125 all use `if (val == null)` explicitly).

**Fix:** Align with the rest of the file:

```typescript
export async function getEscalationSentAt(decisionId: string): Promise<Date | null> {
  const val = await getValue(escalationSentKey(decisionId));
  if (val == null) return null;
  return new Date(val as string);
}
```

---

_Reviewed: 2026-04-17T13:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
