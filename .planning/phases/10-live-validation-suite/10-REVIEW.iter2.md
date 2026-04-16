---
phase: 10-live-validation-suite
reviewed: 2026-04-13T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/chris/__tests__/live-integration.test.ts
  - src/chris/__tests__/contradiction-false-positive.test.ts
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-04-13
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Two live integration test files were reviewed. Both test against a real Anthropic API and a live Postgres database. The overall structure is sound: tests are gated behind `ANTHROPIC_API_KEY`, use `afterEach` cleanup, and follow a 3-of-3 reliability pattern. The contradiction false-positive suite is well-constructed with a comprehensive 20-pair adversarial set.

Five warnings were found, mostly related to flaky assertion patterns and cleanup gaps that could cause inter-test contamination or unreliable passes. Three informational issues cover minor robustness gaps.

---

## Warnings

### WR-01: `saveMessage` called with string chatId but signature requires `bigint`

**File:** `src/chris/__tests__/live-integration.test.ts:144`
**Issue:** `saveMessage` is typed as `saveMessage(chatId: bigint, ...)`. In the Topic Persistence tests (TEST-02), all `saveMessage` calls pass `TEST_CHAT_ID` directly. `TEST_CHAT_ID` is `BigInt(99901)` — that is correct. However `TEST_USER_ID = 99901` (plain number) is passed as the second argument to `processMessage`. Check that `processMessage` accepts `number` for `userId` — if it expects `bigint` this silently passes `NaN`-equivalent at the DB layer.

This is worth verifying because the test file defines both:
```ts
const TEST_CHAT_ID = BigInt(99901);   // bigint — correct for saveMessage
const TEST_USER_ID = 99901;           // number — type of processMessage userId param?
```
If `processMessage` expects `bigint` for userId, all 636 lines of tests pass a plain `number` silently, producing wrong DB rows (or a runtime error that the test timeout masks).

**Fix:** Confirm `processMessage` signature's `userId` parameter type. If it is `bigint`, change to `const TEST_USER_ID = BigInt(99901)`.

---

### WR-02: Topic persistence assertion is over-broad — word list can miss refusal responses

**File:** `src/chris/__tests__/live-integration.test.ts:162-166`
**Issue:** TEST-02 (EN topic persistence) verifies refusal by checking the response does NOT contain any of these English keywords:
```ts
const engagementKeywords = ['tell me more about your relationship', 'ex-girlfriend', 'your ex', 'past partner'];
```
This is a negative-only assertion. If the system returns a generic error, an empty string, or a response in the wrong language, the test passes. There is no assertion that the response is non-empty or is an actual refusal acknowledgment (e.g., contains "prefer not" / "skip" / "that topic"). A bug where the engine crashes and returns an empty string would pass this test.

**Fix:** Add a positive assertion alongside the negative one:
```ts
// Response must be non-empty and not a bare error
expect(response.length).toBeGreaterThan(10);
// Then the negative keyword check
```

The same problem applies to the FR (line 199-201) and RU (line 234-236) variants.

---

### WR-03: `haikuJudge` parses JSON without guarding against non-JSON API responses

**File:** `src/chris/__tests__/live-integration.test.ts:340`
**Issue:** `JSON.parse(text)` will throw a `SyntaxError` if Haiku returns prose instead of JSON (e.g., on a rate-limit error, a partial response, or if the model ignores the instruction). This would surface as an opaque `SyntaxError` rather than a test failure, making CI output confusing.

```ts
const parsed = JSON.parse(text);   // throws SyntaxError if not JSON
return parsed.consistent === true;
```

**Fix:**
```ts
let parsed: { consistent?: boolean };
try {
  parsed = JSON.parse(text);
} catch {
  throw new Error(`haikuJudge returned non-JSON: ${text}`);
}
return parsed.consistent === true;
```

---

### WR-04: Performative apology (TEST-08) question-count assertion is logically vacuous when `turn1Questions === 0`

**File:** `src/chris/__tests__/live-integration.test.ts:554`
**Issue:**
```ts
expect(turn3Questions < turn1Questions || turn3Questions === 0).toBe(true);
```
If the engine asks 0 questions in turn 1 (perfectly plausible for "I had a rough day at work"), then `turn1Questions === 0`, making `turn3Questions < turn1Questions` always false, but `turn3Questions === 0` only passes if turn 3 also has 0. This is correct by accident — but the intent of the test is to verify behavioral change *after the callout*, not just that turn 3 has no questions.

If turn 1 already has 0 questions, the callout in turn 2 was asking the model to stop doing something it was not doing. The test cannot distinguish between "behavior improved" and "behavior was already fine." The test will pass vacuously in that scenario, providing false confidence in the fix.

**Fix:** Add an assertion verifying the callout was meaningful — e.g., assert `turn1Questions > 0` as a precondition, or skip the question-count comparison when it is 0:
```ts
if (turn1Questions > 0) {
  expect(turn3Questions < turn1Questions || turn3Questions === 0).toBe(true);
}
// Always assert turn3 is not heavily interrogative
expect(turn3Questions).toBeLessThanOrEqual(2);
```

---

### WR-05: `afterEach` in `contradiction-false-positive.test.ts` deletes all entries globally — could collide if test runner parallelizes

**File:** `src/chris/__tests__/contradiction-false-positive.test.ts:165-170`
**Issue:** The `afterEach` deletes from `pensieveEntries`, `pensieveEmbeddings`, and `contradictions` without a WHERE clause scoped to the test's inserted IDs:
```ts
await db.delete(contradictions);
await db.delete(pensieveEmbeddings);
await db.delete(pensieveEntries);
```
If vitest ever runs test files in parallel workers (e.g., with `--pool=forks`), one file's `afterEach` could delete rows inserted by another file mid-test, causing spurious failures.

The same pattern exists in `live-integration.test.ts` (line 37-39) but is less dangerous there because that file controls all its data exclusively.

**Fix:** Either scope cleanup by IDs inserted in the test, or add a `pool: { singleFork: true }` annotation to both test files' vitest config, or use a unique `source` tag per test run so cleanup can be scoped:
```ts
// In afterEach, delete only rows this test inserted:
await db.delete(pensieveEntries).where(eq(pensieveEntries.source, 'telegram'));
```
(Only viable if no other source='telegram' rows exist — otherwise use a per-test unique source tag like `'test-audit-<uuid>'`.)

---

## Info

### IN-01: `GROUND_TRUTH_MAP['nationality']!` will return `'French'` — assertion too broad for verbatim check

**File:** `src/chris/__tests__/live-integration.test.ts:470`
**Issue:** The test asserts `response.toContain(GROUND_TRUTH_MAP['nationality']!)` which checks for the substring `'French'`. A response like "I don't know if you are French or not" would pass this assertion. The test label says "verbatim from ground truth" but the assertion does not verify verbatim usage — it only verifies the word appears.

This is an info-level issue because it cannot produce a false negative (the model is unlikely to say "French" in a denial context here), but it weakens the precision of the test label.

**Fix:** Either relax the test label to "mentions nationality" or strengthen the assertion to also require a positive context, e.g., checking that "French" appears near "you are" or "your nationality".

---

### IN-02: `turn1Response` is captured but unused in TEST-08 "flattery" sub-test

**File:** `src/chris/__tests__/live-integration.test.ts:566-567`
**Issue:** `turn1Response` is assigned but never read in the "changes behavior after being called out for flattery" test. It is stored presumably for future comparison but the current assertions only inspect `turn3Response`.

```ts
const turn1Response = await processMessage(...);  // captured but unused
```

**Fix:** Either remove the `const turn1Response =` assignment (use `await processMessage(...)` directly), or document why it is stored (e.g., a comment saying "retained for debugging — not compared").

---

### IN-03: Language detection tests use `franc` to verify the AI response language, but `franc` requires ~20+ words for reliable detection

**File:** `src/chris/__tests__/live-integration.test.ts:94-95, 110-111, 126-127`
**Issue:** The test checks `expect(response.length).toBeGreaterThan(20)` (20 characters, not words) then runs `franc(response, { only: ['eng', 'fra', 'rus'] })`. According to franc's own documentation, reliable detection requires at least 10 tokens / ~60–80 characters for short-language pairs. A 21-character French response may be misidentified as English by franc, causing a spurious test failure unrelated to Chris's behavior.

**Fix:** Raise the minimum response length check to ensure franc has enough input:
```ts
expect(response.length).toBeGreaterThan(80);  // franc needs ~60-80 chars minimum
```
Or add a fallback: if franc returns `'und'` (undetermined), skip the language assertion with a warning rather than failing.

---

_Reviewed: 2026-04-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
