---
phase: 10-live-validation-suite
fixed_at: 2026-04-14T00:00:00Z
review_path: .planning/phases/10-live-validation-suite/10-REVIEW.md
iteration: 2
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-04-14
**Source review:** .planning/phases/10-live-validation-suite/10-REVIEW.md
**Iteration:** 2

**Summary (iteration 2):**
- Findings in scope: 1
- Fixed: 1
- Skipped: 0

---

## Iteration 2 — 2026-04-14

### Fixed Issues

#### WR-06: WR-05 fix still deletes by shared `source = 'telegram'` tag -- parallel runs of these two files will collide

**Files modified:** `src/chris/__tests__/live-integration.test.ts`, `src/chris/__tests__/contradiction-false-positive.test.ts`
**Commits:** d94e90a (live-integration), ba62a3d (contradiction-false-positive)
**Applied fix:** Option A from review -- per-test-file unique source tag.

In each test file, introduced a module-scoped constant:
```ts
const TEST_SOURCE = `test-live-integration-${process.pid}`;   // live-integration.test.ts
const TEST_SOURCE = `test-contradiction-fp-${process.pid}`;   // contradiction-false-positive.test.ts
```

All `pensieveEntries` inserts in each file now use `source: TEST_SOURCE` instead of the shared `'telegram'` literal. The `afterEach` cleanup queries/deletes are scoped to `eq(pensieveEntries.source, TEST_SOURCE)`, so each file only touches rows it created. This eliminates the parallel-worker collision described in WR-06 (file A's afterEach can no longer delete file B's mid-test rows) and also prevents silent deletion of any production/seed rows that use `source = 'telegram'`.

Additional hardening applied in `live-integration.test.ts` while touching the cleanup paths:
- The six in-iteration `db.delete(pensieveEntries)` / `db.delete(pensieveEmbeddings)` calls (inside TEST-05 and TEST-07 loops) were previously fully unscoped. They are now scoped by `TEST_SOURCE` using the same select-ids-then-delete pattern as `afterEach`, so they cannot clobber parallel files either.
- The twelve in-iteration `db.delete(conversations)` calls are now scoped by `eq(conversations.chatId, TEST_CHAT_ID)` so parallel work on other chat IDs is unaffected.

The `contradiction-false-positive.test.ts` file does not touch `conversations` and only needed the source-tag swap plus the afterEach update.

### Skipped Issues

None this iteration.

---

## Iteration 1 — 2026-04-13

**Summary (iteration 1):**
- Findings in scope: 5
- Fixed: 4
- Skipped: 1

### Fixed Issues

#### WR-02: Topic persistence assertion is over-broad -- word list can miss refusal responses

**Files modified:** `src/chris/__tests__/live-integration.test.ts`
**Commit:** b6ffdff
**Applied fix:** Added `expect(response.length).toBeGreaterThan(10)` positive assertion before the negative keyword checks in all three topic persistence test variants (EN, FR, RU). This ensures that empty strings or bare errors do not pass the test vacuously.

#### WR-03: haikuJudge parses JSON without guarding against non-JSON API responses

**Files modified:** `src/chris/__tests__/live-integration.test.ts`
**Commit:** 3d0d674
**Applied fix:** Wrapped `JSON.parse(text)` in haikuJudge with a try/catch that throws a descriptive `Error` including the raw text, replacing the opaque `SyntaxError` that would occur on non-JSON API responses.

#### WR-04: Performative apology (TEST-08) question-count assertion is logically vacuous when turn1Questions === 0

**Files modified:** `src/chris/__tests__/live-integration.test.ts`
**Commit:** cc1ea82
**Applied fix:** Added a guard so the question-count comparison (`turn3Questions < turn1Questions`) only runs when `turn1Questions > 0`. Added a universal `expect(turn3Questions).toBeLessThanOrEqual(2)` assertion that always runs to ensure turn 3 is never heavily interrogative regardless of turn 1 behavior.

#### WR-05: afterEach deletes all entries globally -- could collide if test runner parallelizes

**Files modified:** `src/chris/__tests__/live-integration.test.ts`, `src/chris/__tests__/contradiction-false-positive.test.ts`
**Commit:** bf84231
**Applied fix:** Scoped afterEach cleanup in both test files. For pensieve tables: queries test-inserted entry IDs by `source = 'telegram'`, then deletes contradictions and embeddings scoped to those IDs, then deletes entries by source. For conversations in live-integration: scoped delete by `chatId = TEST_CHAT_ID`. Added `eq` and `inArray` imports from drizzle-orm.

_Note: iteration 2 WR-06 follow-up replaced the shared `'telegram'` scope with a per-process `TEST_SOURCE` tag in both files, closing the parallel-collision gap that remained after this fix._

### Skipped Issues

#### WR-01: saveMessage called with string chatId but signature requires bigint

**File:** `src/chris/__tests__/live-integration.test.ts:144`
**Reason:** False positive -- processMessage userId param is typed as `number`, not `bigint`. `TEST_USER_ID = 99901` (plain number) is correct for the `processMessage(chatId: bigint, userId: number, text: string)` signature.
**Original issue:** Reviewer suggested verifying whether `processMessage` expects `bigint` for userId and changing to `BigInt(99901)` if so. Confirmed the parameter type is `number`.

---

_Fixed: 2026-04-14 (iteration 2); 2026-04-13 (iteration 1)_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
