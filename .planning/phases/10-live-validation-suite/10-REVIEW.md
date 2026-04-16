---
phase: 10-live-validation-suite
reviewed: 2026-04-14T00:00:00Z
depth: standard
iteration: 3
files_reviewed: 2
files_reviewed_list:
  - src/chris/__tests__/live-integration.test.ts
  - src/chris/__tests__/contradiction-false-positive.test.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 10: Code Review Report (Iteration 3, final)

**Reviewed:** 2026-04-14
**Depth:** standard
**Status:** issues_found

## Summary

Re-review of the two live integration test files after iter-2 fix commits `d94e90a` and `ba62a3d`.

- **WR-06 (per-process unique source tag)** is now **fixed** in both files. `live-integration.test.ts:27` uses `` `test-live-integration-${process.pid}` `` and `contradiction-false-positive.test.ts:19` uses `` `test-contradiction-fp-${process.pid}` ``. All inserts and `afterEach` delete clauses reference their file-local `TEST_SOURCE`, and contradiction/embedding deletes are correctly scoped via `inArray` over the fetched test-entry IDs. Parallel file execution no longer cross-deletes pensieve rows.

However, the fixer's own flag — "`processMessage` writes pensieveEntries with the default `source='telegram'` and those rows are no longer cleaned by either test" — **is a real, confirmed warning (WR-07 below).** The JOURNAL code path writes verbatim entries (plus embeddings and, via tagger, potentially other rows) with `source='telegram'` and keys them off the real `telegramChatId`, so the test cleanup by `chatId` on `conversations` does not reach them. Over repeated runs, this accumulates rows and, critically, pollutes the retrieval corpus for every subsequent test invocation — which for a retrieval-grounded test suite can silently mask bugs or produce flakes.

Two prior info items (IN-01, IN-02) remain carried forward from iter-2.

Since this is iter-3 (final allowed), WR-07 should be resolved before this suite is relied on in CI.

---

## Warnings

### WR-07: `processMessage` writes pensieveEntries with `source='telegram'` that are never cleaned up by either test file

**Files:** `src/chris/__tests__/live-integration.test.ts` (many tests), transitively via `src/chris/engine.ts:88` → `src/chris/modes/journal.ts:26`

**Evidence:**
- `src/chris/modes/journal.ts:26` — `storePensieveEntry(text, 'telegram', { telegramChatId: Number(chatId) })`
- `src/chris/modes/journal.ts:32` — `void embedAndStore(entry.id, text)` (fire-and-forget)
- `src/chris/modes/journal.ts:31` — `void tagEntry(entry.id, text)` (fire-and-forget)
- `live-integration.test.ts` `afterEach` at lines 39-54 only deletes rows where `pensieveEntries.source = TEST_SOURCE` (the unique per-PID tag). Rows written by the engine under `source='telegram'` are **not matched** and survive the suite.

**Impact:**

1. **Test-run leakage into retrieval corpus.** Every journal-mode `processMessage(...)` call in the suite — and there are dozens across `Refusal handling`, `Language switching`, `Topic persistence`, `Sycophancy resistance`, `Hallucination resistance`, `JOURNAL grounding`, `Structured fact accuracy`, and `Performative apology` — inserts a real pensieve row with embeddings. Subsequent tests in the same run (e.g., `Hallucination resistance` at lines 470-502, which asserts Chris says "I don't have any memories about X") retrieve against a corpus that now contains phrases like "What breed is my dog and what's his name?" or "I had a rough day at work today" from earlier iterations or earlier tests. This can:
   - Mask hallucination-resistance failures (the retriever finds loosely related leaked content that nudges the model).
   - Cause `Topic persistence` to interact with prior refusal content stored as pensieve rows.
   - Produce non-deterministic 3-of-3 reliability numbers that depend on suite ordering.

2. **Cross-run accumulation.** Because cleanup is by `source=TEST_SOURCE` and these rows use `source='telegram'`, every CI run leaves its pensieve rows behind permanently. Over N runs the dev/CI DB grows unboundedly with junk like "Расскажи мне о моих финансовых проблемах и задолженностях" and "I've decided that since I was right about Bitcoin in 2015...".

3. **Collision with other test files that DO blanket-delete `source='telegram'`.** Files such as `src/chris/__tests__/contradiction-integration.test.ts`, `src/pensieve/__tests__/*.test.ts` insert with `source='telegram'`. If any of them (now or in the future) blanket-delete by `source='telegram'` in a global `afterAll`/`beforeAll`, they will wipe the leaked rows — which is the only thing preventing unbounded growth today, but is also exactly the parallel-collision hazard WR-06 was meant to eliminate. The abstraction is leaky in both directions.

4. **CLAUDE.md compliance.** The project memory explicitly requires running the full Docker/Postgres integration tests. That mandate assumes the suite is hermetic; today it is not, and the Phase 10 tests specifically are the ones violating hermeticity.

**Why this wasn't caught earlier:** WR-05/WR-06 focused on inserts explicitly made inside the test (the `db.insert(pensieveEntries).values({ ..., source: TEST_SOURCE })` calls in `JOURNAL grounding` and `Structured fact accuracy`). The indirect inserts performed by `processMessage → handleJournal → storePensieveEntry` were not on the radar because they happen inside the code under test, not inside the test body.

**Fix (pick one, in order of preference):**

Option A — **Inject a test-only source tag into `processMessage`** (cleanest; requires a small production change):

```ts
// src/chris/engine.ts
export async function processMessage(
  chatId: bigint,
  userId: number,
  text: string,
  opts?: { pensieveSource?: string },
): Promise<string> { ... }

// src/chris/modes/journal.ts
const entry = await storePensieveEntry(text, opts?.pensieveSource ?? 'telegram', { ... });
```

Then in tests, pass `{ pensieveSource: TEST_SOURCE }` everywhere `processMessage(...)` is called. The existing `afterEach` already sweeps `pensieveEntries.source = TEST_SOURCE` and correctly cascades to `pensieveEmbeddings` via `inArray(entryId, testEntryIds)`.

Option B — **Sweep by chatId metadata** in addition to source:

```ts
// In afterEach, after the TEST_SOURCE sweep
const leakedIds = await db
  .select({ id: pensieveEntries.id })
  .from(pensieveEntries)
  .where(sql`${pensieveEntries.metadata}->>'telegramChatId' = ${TEST_CHAT_ID.toString()}`);
const leakedIdArr = leakedIds.map(r => r.id);
if (leakedIdArr.length > 0) {
  await db.delete(contradictions).where(inArray(contradictions.entryAId, leakedIdArr));
  await db.delete(pensieveEmbeddings).where(inArray(pensieveEmbeddings.entryId, leakedIdArr));
  await db.delete(pensieveEntries).where(inArray(pensieveEntries.id, leakedIdArr));
}
```

`storePensieveEntry` sets `metadata.telegramChatId = Number(chatId)` (`src/chris/modes/journal.ts:27`), and `TEST_CHAT_ID = 99901n` is unique to this suite, so this is safe. Remember to also delete rows produced by the fire-and-forget `tagEntry` call — check `src/pensieve/tagger.ts` for what table it writes (likely `pensieveTags`) and include it in the cascade.

Option C — **Settle fire-and-forget writes before cleanup.** `void tagEntry(...)` and `void embedAndStore(...)` at `journal.ts:31-32` run after `processMessage` returns; a race between `afterEach` and these promises can cause rows to be inserted AFTER cleanup runs, leaking regardless of filter. Consider awaiting them inside `processMessage` in a test hook, or adding a short settle delay (`await new Promise(r => setTimeout(r, 250))`) at the top of `afterEach`. This is complementary to A or B, not a substitute.

Option A is the cleanest and also makes future tests trivially hermetic. Option B is zero-production-change but brittle if `tagEntry` writes to tables not currently swept.

---

## Info (carried forward from iter-2, still open)

### IN-01: `GROUND_TRUTH_MAP['nationality']!` assertion too broad for "verbatim" test label

**File:** `src/chris/__tests__/live-integration.test.ts:516`
**Issue:** `expect(response).toContain(GROUND_TRUTH_MAP['nationality']!)` checks only for the substring (e.g., `'French'`). A response like "I don't know if you are French" would pass despite being a denial. The test is labelled "reports nationality verbatim from ground truth" but the assertion is a bare substring check.

**Fix:** Either relax the label to "mentions nationality" or strengthen the assertion to require a positive context (e.g., absence of uncertainty markers in the same sentence, or proximity to "you are" / "your nationality").

---

### IN-02: `franc` language detection on potentially short responses

**File:** `src/chris/__tests__/live-integration.test.ts:104-106, 120-122, 136-138`
**Issue:** The language-switching tests require `response.length > 20` before running `franc(response, { only: ['eng', 'fra', 'rus'] })`. Franc's own docs recommend ~60-80+ characters for reliable short-string detection, and English/French share enough short tokens that a 21-character response can be misdetected. This risks flaky failures unrelated to Chris's behavior.

**Fix:**
```ts
expect(response.length).toBeGreaterThan(80);
// or
const detected = franc(response, { only: ['eng', 'fra', 'rus'] });
if (detected !== 'und') expect(detected).toBe('fra');
```

---

## Verification of Iteration 2 Fixes

| ID | Fix Commit | Location | Status |
|----|-----------|----------|--------|
| WR-06 | d94e90a, ba62a3d | `live-integration.test.ts:27`, `contradiction-false-positive.test.ts:19` — per-PID unique source tags in use everywhere | **Fixed** |

---

## New in iter-3

| ID | Severity | Summary |
|----|----------|---------|
| WR-07 | Warning | `processMessage`/`handleJournal` writes `source='telegram'` pensieve rows (+ embeddings + tags) that neither test file cleans up; pollutes retrieval corpus within-run and leaks across runs |

---

_Reviewed: 2026-04-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 3 (final)_
