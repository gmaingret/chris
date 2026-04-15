---
phase: 10-live-validation-suite
fixed_at: 2026-04-13T00:00:00Z
review_path: .planning/phases/10-live-validation-suite/10-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 4
skipped: 1
status: partial
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-04-13
**Source review:** .planning/phases/10-live-validation-suite/10-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 4
- Skipped: 1

## Fixed Issues

### WR-02: Topic persistence assertion is over-broad -- word list can miss refusal responses

**Files modified:** `src/chris/__tests__/live-integration.test.ts`
**Commit:** b6ffdff
**Applied fix:** Added `expect(response.length).toBeGreaterThan(10)` positive assertion before the negative keyword checks in all three topic persistence test variants (EN, FR, RU). This ensures that empty strings or bare errors do not pass the test vacuously.

### WR-03: haikuJudge parses JSON without guarding against non-JSON API responses

**Files modified:** `src/chris/__tests__/live-integration.test.ts`
**Commit:** 3d0d674
**Applied fix:** Wrapped `JSON.parse(text)` in haikuJudge with a try/catch that throws a descriptive `Error` including the raw text, replacing the opaque `SyntaxError` that would occur on non-JSON API responses.

### WR-04: Performative apology (TEST-08) question-count assertion is logically vacuous when turn1Questions === 0

**Files modified:** `src/chris/__tests__/live-integration.test.ts`
**Commit:** cc1ea82
**Applied fix:** Added a guard so the question-count comparison (`turn3Questions < turn1Questions`) only runs when `turn1Questions > 0`. Added a universal `expect(turn3Questions).toBeLessThanOrEqual(2)` assertion that always runs to ensure turn 3 is never heavily interrogative regardless of turn 1 behavior.

### WR-05: afterEach deletes all entries globally -- could collide if test runner parallelizes

**Files modified:** `src/chris/__tests__/live-integration.test.ts`, `src/chris/__tests__/contradiction-false-positive.test.ts`
**Commit:** bf84231
**Applied fix:** Scoped afterEach cleanup in both test files. For pensieve tables: queries test-inserted entry IDs by `source = 'telegram'`, then deletes contradictions and embeddings scoped to those IDs, then deletes entries by source. For conversations in live-integration: scoped delete by `chatId = TEST_CHAT_ID`. Added `eq` and `inArray` imports from drizzle-orm.

## Skipped Issues

### WR-01: saveMessage called with string chatId but signature requires bigint

**File:** `src/chris/__tests__/live-integration.test.ts:144`
**Reason:** False positive -- processMessage userId param is typed as `number`, not `bigint`. `TEST_USER_ID = 99901` (plain number) is correct for the `processMessage(chatId: bigint, userId: number, text: string)` signature.
**Original issue:** Reviewer suggested verifying whether `processMessage` expects `bigint` for userId and changing to `BigInt(99901)` if so. Confirmed the parameter type is `number`.

---

_Fixed: 2026-04-13_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
