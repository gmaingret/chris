---
phase: 18-synthetic-fixture-live-accountability-integration-suite
reviewed: 2026-04-16T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/decisions/__tests__/live-accountability.test.ts
  - src/decisions/__tests__/synthetic-fixture.test.ts
  - src/decisions/__tests__/vague-validator-live.test.ts
  - src/decisions/vague-validator.ts
  - src/llm/client.ts
  - src/llm/prompts.ts
  - src/pensieve/retrieve.ts
findings:
  critical: 0
  warning: 7
  info: 5
  total: 12
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-04-16T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Seven source files reviewed: three integration test files for the Phase 18 synthetic-fixture and live-accountability suite (TEST-10/11/12/13/14), plus the vague-validator implementation, the LLM client wrapper, the prompt templates, and the Pensieve retrieval module.

The production source files (`vague-validator.ts`, `client.ts`, `retrieve.ts`) are defensively coded and well-structured. The `prompts.ts` file has one notable stale-copy issue. The primary findings are concentrated in the test files, where unscoped `db.delete()` calls without WHERE clauses create data integrity risks in shared Postgres environments, a bare `JSON.parse` is unguarded in the Haiku judge, and `sql.end()` placement risks non-deterministic failures in TEST-12.

No security vulnerabilities were found. No critical bugs in production code.

---

## Warnings

### WR-01: Unscoped `db.delete(decisionEvents)` deletes all rows across all chatIds

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:255`
**Issue:** The `cleanup()` helper issues `await db.delete(decisionEvents)` with no WHERE clause, deleting every row in the table regardless of chatId. If another test file runs concurrently or leaves rows from a prior run, this blanket delete silently removes data outside `TEST_CHAT_ID = 99918`. The `decisionEvents` table has no direct `chatId` column but does have a `decisionId` FK that enables scoping.
**Fix:**
```typescript
// Scope via a subquery on this test's decisions:
await db.delete(decisionEvents).where(
  inArray(
    decisionEvents.decisionId,
    db.select({ id: decisions.id }).from(decisions).where(eq(decisions.chatId, TEST_CHAT_ID)),
  ),
);
```

---

### WR-02: Unscoped `db.delete(pensieveEntries)` deletes all entries across all chatIds

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:264`
**Issue:** `cleanup()` deletes from `pensieveEntries` with no WHERE clause. This purges Pensieve data seeded by any other concurrently running test suite sharing the same database.
**Fix:**
```typescript
// Filter by a column that scopes to this test's data, e.g. source:
await db.delete(pensieveEntries).where(eq(pensieveEntries.source, 'telegram'));
// Or, if pensieveEntries has a chatId equivalent column, use that.
```
If no scoping column is available, document that cleanup is intentionally global and ensure test suites never run in parallel.

---

### WR-03: `sql.end()` in TEST-11 `afterAll` risks non-deterministic failures in TEST-12

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:437-440`
**Issue:** `sql.end()` closes the shared postgres.js connection pool after TEST-11 finishes. TEST-12 executes after TEST-11 in the same file and calls `runSweep()`. The comment on line 438 asserts TEST-12 "does not need the pool open," but that is a claim about mock coverage — not a runtime guarantee. Any transitive code path in the sweep that touches the real `sql` tagged-template instance will throw "connection ended." This produces non-deterministic failures depending on mock completeness.
**Fix:**
```typescript
// Remove sql.end() from TEST-11's afterAll.
// Add a single file-level afterAll at the bottom of the file:
afterAll(async () => {
  await sql.end();
});
```

---

### WR-04: Bare `JSON.parse` in `classifyAccountabilityTone` — unhandled parse error

**File:** `src/decisions/__tests__/live-accountability.test.ts:65`
**Issue:** `JSON.parse(cleaned)` throws a `SyntaxError` if Haiku returns non-JSON (rate limit error, partial API response, or markdown-wrapped JSON that the regex strip misses). The thrown error surfaces as an opaque parse failure rather than a useful assertion message. Because this runs inside a `for (let i = 0; i < 3; i++)` loop, an unhandled throw also bypasses `cleanupIteration`, leaving orphaned DB rows.
**Fix:**
```typescript
let parsed: AccountabilityClassification;
try {
  parsed = JSON.parse(cleaned) as AccountabilityClassification;
} catch {
  throw new Error(
    `Haiku judge returned non-JSON. Raw text: ${text.slice(0, 300)}`
  );
}
return parsed;
```
Additionally, wrap `cleanupIteration` in a `finally` block to ensure cleanup runs even if classification fails:
```typescript
try {
  const response = await handleResolution(...);
  const classification = await classifyAccountabilityTone(response);
  expect(classification.flattery).toBe('none');
  expect(classification.condemnation).toBe('none');
} finally {
  await cleanupIteration(decisionId);
}
```

---

### WR-05: Unscoped `db.delete(decisionEvents)` and `db.delete(decisions)` in `vague-validator-live.test.ts`

**File:** `src/decisions/__tests__/vague-validator-live.test.ts:104-105`
**Issue:** Both deletes have no WHERE clause, identical to WR-01. These run in `afterEach`, firing after every test. In a shared database, this will remove decisions and events that do not belong to `TEST_CHAT_ID = 99920`.
**Fix:**
```typescript
// Scope decisionEvents via subquery:
await db.delete(decisionEvents).where(
  inArray(
    decisionEvents.decisionId,
    db.select({ id: decisions.id }).from(decisions).where(eq(decisions.chatId, TEST_CHAT_ID)),
  ),
);
// Scope decisions:
await db.delete(decisions).where(eq(decisions.chatId, TEST_CHAT_ID));
```

---

### WR-06: Unscoped decision `rows` assertion in vague-validator Test 2 — false-positive risk

**File:** `src/decisions/__tests__/vague-validator-live.test.ts:162-165`
**Issue:** `db.select().from(decisions)` fetches all decision rows across all chatIds. In a shared database, rows seeded by a concurrent test suite can satisfy `rows.length >= 1` even if Test 2 failed to commit the decision for `TEST_CHAT_ID`, producing a false-positive pass.
**Fix:**
```typescript
const rows = await db
  .select()
  .from(decisions)
  .where(eq(decisions.chatId, TEST_CHAT_ID));
expect(rows.length).toBeGreaterThanOrEqual(1);
```

---

### WR-07: `CONTRADICTION_DETECTION_PROMPT` and `RELATIONAL_MEMORY_PROMPT` use "John" instead of "Greg"

**File:** `src/llm/prompts.ts:228-258`, `261-298`
**Issue:** `CONTRADICTION_DETECTION_PROMPT` addresses the user as "John" throughout ("What John just said", "John has decided", etc.) and `RELATIONAL_MEMORY_PROMPT` similarly refers to "John and Chris". All other prompts in the file are personalized to "Greg". These prompts are sent verbatim to Haiku/Opus, so the model may produce responses that reference a user named "John" when the actual user is Greg.
**Fix:** Replace every instance of "John" with "Greg" in both prompts, consistent with the rest of the file.

---

## Info

### IN-01: `callLLM` JSDoc documents "empty string on failure" but only handles missing text blocks — API errors propagate

**File:** `src/llm/client.ts:16-30`
**Issue:** The JSDoc comment says "Returns the first text block content as a string, or empty string on failure." The empty-string path only executes when `block?.type !== 'text'`; actual API errors (rate limits, network failures) throw unhandled exceptions. `vague-validator.ts` wraps calls in its own try/catch, which compensates, but other callers may rely on the documented empty-string contract.
**Fix:** Update the JSDoc to clarify that network/API exceptions are not caught, or add a try/catch to match the documented behavior:
```typescript
export async function callLLM(system: string, user: string, maxTokens = 100): Promise<string> {
  try {
    const response = await anthropic.messages.create({ ... });
    const block = response.content[0];
    return block?.type === 'text' ? block.text : '';
  } catch {
    return ''; // matches documented "empty string on failure"
  }
}
```

---

### IN-02: Unused import `upsertAwaitingResolution` in `synthetic-fixture.test.ts`

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:205`
**Issue:** `upsertAwaitingResolution` is imported from `../capture-state.js` but TEST-10 performs the equivalent work via a raw `db.insert` (lines 325-338) and TEST-12 uses the hoisted mock `mockUpsertAwaitingResolution`. The imported symbol is never called directly in the test file.
**Fix:** Remove the import, or replace the raw `db.insert` block in TEST-10 with a call to `upsertAwaitingResolution` so the import is used and the test exercises the real helper.

---

### IN-03: Loop variable `i` unused in live-accountability scenarios — iteration number lost on failure

**File:** `src/decisions/__tests__/live-accountability.test.ts:154, 189, 224`
**Issue:** All three scenario loops use `let i = 0; i < 3; i++` but `i` is never used inside the loop body. When an iteration fails, the error gives no indication of which iteration produced the failure.
**Fix:**
```typescript
for (let i = 0; i < 3; i++) {
  // ... existing code ...
  // Use i in the error message if assertion fails:
  expect(classification.flattery, `flattery on iteration ${i + 1}`).toBe('none');
  expect(classification.condemnation, `condemnation on iteration ${i + 1}`).toBe('none');
}
```

---

### IN-04: Test 1 vague-flag assertion gives no per-prediction failure detail

**File:** `src/decisions/__tests__/vague-validator-live.test.ts:113-119`
**Issue:** When `flaggedCount < 9`, the failing assertion only reports the count, giving no indication of which specific predictions the model missed. Debugging a prompt regression requires re-running manually.
**Fix:**
```typescript
const unflagged: string[] = [];
for (const { prediction, falsification_criterion, lang } of ADVERSARIAL_PREDICTIONS) {
  const result = await validateVagueness({ prediction, falsification_criterion });
  if (result.verdict !== 'vague') {
    unflagged.push(`[${lang}] "${prediction}"`);
  }
}
expect(
  ADVERSARIAL_PREDICTIONS.length - unflagged.length,
  `Unflagged:\n${unflagged.join('\n')}`
).toBeGreaterThanOrEqual(9);
```

---

### IN-05: Magic number `172800000` in deadline mock lacks comment

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:166`
**Issue:** `STALE_CONTEXT_THRESHOLD_MS: 172800000` is hardcoded without explanation. If the real module's threshold changes, the mock silently diverges.
**Fix:**
```typescript
STALE_CONTEXT_THRESHOLD_MS: 172_800_000, // 48 hours — must match deadline.ts
```

---

_Reviewed: 2026-04-16T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
