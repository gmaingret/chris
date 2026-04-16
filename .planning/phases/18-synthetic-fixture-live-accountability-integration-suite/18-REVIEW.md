---
phase: 18-synthetic-fixture-live-accountability-integration-suite
reviewed: 2026-04-16T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/decisions/__tests__/synthetic-fixture.test.ts
  - src/decisions/__tests__/live-accountability.test.ts
  - src/decisions/__tests__/vague-validator-live.test.ts
findings:
  critical: 0
  warning: 6
  info: 4
  total: 10
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-04-16T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Three integration test files for the Phase 18 synthetic-fixture and live-accountability suite were reviewed. The tests are well-structured with clear commentary, proper use of `vi.hoisted`, and appropriate `describe.skipIf` guards for live API tests.

Six warnings were found, all concerning data integrity in test setup/teardown. The dominant pattern is unscoped `db.delete()` calls without `WHERE` clauses that silently delete rows across all chatIds — this will cause data corruption if any two test files from this suite run concurrently or sequentially in a shared Postgres database. There is also a bare `JSON.parse` without error handling in the Haiku judge used by `live-accountability.test.ts`, and a `sql.end()` ordering concern that could cause non-deterministic failures.

---

## Warnings

### WR-01: Unscoped `db.delete(decisionEvents)` deletes all rows across all chatIds

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:255`
**Issue:** The `cleanup()` helper deletes `decisionEvents` with no `WHERE` clause. `decisionEvents` has no `chatId` column, but it has a `decisionId` FK. If another test file is running concurrently (or left rows from a previous run), this blanket delete will silently remove data that does not belong to `TEST_CHAT_ID = 99918`. The same issue appears in `vague-validator-live.test.ts` (see WR-05).
**Fix:**
```typescript
// Instead of blanket delete, scope via a subquery on the test chat's decisions:
await db.delete(decisionEvents).where(
  inArray(
    decisionEvents.decisionId,
    db.select({ id: decisions.id }).from(decisions).where(eq(decisions.chatId, TEST_CHAT_ID)),
  ),
);
```
Or, insert a `TEST_RUN_ID` tag into each seeded decision and filter on it.

---

### WR-02: Unscoped `db.delete(pensieveEntries)` deletes all entries across all chatIds

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:264`
**Issue:** `cleanup()` deletes from `pensieveEntries` with no `WHERE` clause. This will silently purge Pensieve data seeded by any other concurrently running test suite.
**Fix:**
```typescript
// Filter by source or sourceRefId if those carry chatId context, e.g.:
await db.delete(pensieveEntries).where(eq(pensieveEntries.source, 'telegram'));
// Or more precisely, scope to entries written during this test run only.
```
If `pensieveEntries` has a `chatId`-equivalent column, use that. If not, consider adding a `testRunId` metadata field or using a transaction that is rolled back.

---

### WR-03: `sql.end()` in TEST-11 `afterAll` may cause TEST-12 non-deterministic failures

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:437-440`
**Issue:** `sql.end()` closes the shared postgres.js connection pool at the end of TEST-11. TEST-12 executes after TEST-11 in the same file and calls `runSweep()`. Even though TEST-12 mocks most DB paths, `runSweep` and its transitive imports are loaded in the same process and share the same `sql` tagged-template instance from `../../db/connection.js`. If any non-mocked code path touches `sql` during TEST-12, it will throw a "connection ended" error.

The comment on line 438 says TEST-12 "does not need the pool open" but that is an assertion about the mock coverage, not a guarantee. The safest pattern is to close the pool in the top-level `afterAll` of the file or in a global teardown.
**Fix:**
```typescript
// Move sql.end() to a file-level afterAll at the bottom of the file,
// after all describe blocks have run:
afterAll(async () => {
  await sql.end();
});

// Remove the sql.end() call from TEST-11's afterAll.
```

---

### WR-04: Bare `JSON.parse` in `classifyAccountabilityTone` — unhandled parse error

**File:** `src/decisions/__tests__/live-accountability.test.ts:65`
**Issue:** `JSON.parse(cleaned)` throws a `SyntaxError` if Haiku returns non-JSON (rate limit message, API error, or markdown-wrapped JSON that the regex strip missed). The thrown error will surface as an opaque parse failure rather than a useful assertion failure, making live-test debugging harder.
**Fix:**
```typescript
let parsed: AccountabilityClassification;
try {
  parsed = JSON.parse(cleaned) as AccountabilityClassification;
} catch {
  throw new Error(
    `Haiku judge returned non-JSON response. Raw text: ${text.slice(0, 200)}`
  );
}
return parsed;
```

---

### WR-05: Unscoped `db.delete(decisionEvents)` and `db.delete(decisions)` in `vague-validator-live.test.ts`

**File:** `src/decisions/__tests__/vague-validator-live.test.ts:104-105`
**Issue:** Both deletes have no `WHERE` clause, identical to WR-01. These run in `afterEach`, which fires after each test. Test 1 (flag-rate test) seeds no decisions, so the blank delete is harmless there, but Test 2 (pushback test) creates a decision row. The blank deletes will remove any decision and event rows in the entire table regardless of chatId.

Additionally, `pensieveEntries` on line 107 is filtered by `source='telegram'` but not by `chatId`, which can affect other test data.
**Fix:**
```typescript
// Scope decisionEvents via subquery as shown in WR-01.
// Scope decisions:
await db.delete(decisions).where(eq(decisions.chatId, TEST_CHAT_ID));
// Scope pensieve entries by chatId if a column exists, or accept the source filter as best-effort.
```

---

### WR-06: `rows` query in vague-validator Test 2 not scoped to TEST_CHAT_ID

**File:** `src/decisions/__tests__/vague-validator-live.test.ts:162-165`
**Issue:** `db.select().from(decisions)` fetches all decision rows across all chatIds. In a shared database, rows seeded by a concurrent test suite could satisfy the `rows.length >= 1` assertion, producing a false-positive pass even if Test 2 failed to commit the decision for `TEST_CHAT_ID`.
**Fix:**
```typescript
const rows = await db
  .select()
  .from(decisions)
  .where(eq(decisions.chatId, TEST_CHAT_ID));
expect(rows.length).toBeGreaterThanOrEqual(1);
```

---

## Info

### IN-01: Unused import `upsertAwaitingResolution` in synthetic-fixture.test.ts

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:205`
**Issue:** `upsertAwaitingResolution` is imported from `../capture-state.js` but TEST-10 uses a raw `db.insert` (line 325-338) rather than the imported function. TEST-12 uses the mock version via `mockUpsertAwaitingResolution`. The imported symbol is never called directly.
**Fix:** Remove the import, or replace the raw `db.insert` block in TEST-10 with a call to `upsertAwaitingResolution` so the import is used and the test exercises the real helper.

---

### IN-02: Loop variable `i` unused in live-accountability scenarios

**File:** `src/decisions/__tests__/live-accountability.test.ts:154, 189, 224`
**Issue:** The 3-iteration loops use `let i = 0; i < 3; i++` but `i` is never referenced inside the loop body. When an iteration fails, Vitest reports the assertion error but gives no indication of which iteration (1, 2, or 3) produced the failure.
**Fix:**
```typescript
for (let i = 0; i < 3; i++) {
  // ... existing code ...
  expect(classification.flattery).withContext(`iteration ${i + 1}`).toBe('none');
  // or simply log iteration on failure:
  if (classification.flattery !== 'none' || classification.condemnation !== 'none') {
    throw new Error(`Iteration ${i + 1} failed: ${JSON.stringify(classification)}`);
  }
}
```

---

### IN-03: Test 1 vague-flag rate gives no per-prediction failure detail

**File:** `src/decisions/__tests__/vague-validator-live.test.ts:113-119`
**Issue:** When `flaggedCount < 9`, the failing assertion only says the count was wrong. There is no output showing which specific predictions were not flagged, making it hard to debug prompt regressions.
**Fix:**
```typescript
const failures: string[] = [];
for (const { prediction, falsification_criterion, lang } of ADVERSARIAL_PREDICTIONS) {
  const result = await validateVagueness({ prediction, falsification_criterion });
  if (result.verdict !== 'vague') {
    failures.push(`[${lang}] "${prediction}"`);
  }
}
expect(failures, `Unflagged predictions:\n${failures.join('\n')}`).toHaveLength(0 /* or <= 1 */);
```

---

### IN-04: Magic number `172800000` in `STALE_CONTEXT_THRESHOLD_MS` mock

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:166`
**Issue:** The constant `172800000` (48 hours in milliseconds) is hardcoded in the mock without a named constant or comment. If the real module's threshold changes, the test will silently diverge.
**Fix:** Either import the real constant from `../../proactive/triggers/deadline.js` in a separate non-mocked import, or annotate the value:
```typescript
STALE_CONTEXT_THRESHOLD_MS: 172_800_000, // 48 hours — must match deadline.ts
```

---

_Reviewed: 2026-04-16T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
