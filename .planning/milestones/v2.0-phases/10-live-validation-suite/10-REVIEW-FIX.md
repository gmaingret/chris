---
phase: 10-live-validation-suite
fixed_at: 2026-04-14T00:00:00Z
review_path: .planning/phases/10-live-validation-suite/10-REVIEW.md
iteration: 5
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-04-14
**Source review:** .planning/phases/10-live-validation-suite/10-REVIEW.md
**Iteration:** 4

**Summary (iteration 4):**
- Findings in scope: 1
- Fixed: 1
- Skipped: 0

---

## Iteration 5 — 2026-04-14

**Summary (iteration 5):**
- Findings in scope: 2
- Fixed: 2
- Skipped: 0

### Fixed Issues

#### IN-01: `GROUND_TRUTH_MAP['nationality']!` assertion too broad for "verbatim" test label

**Files modified:** `src/chris/__tests__/live-integration.test.ts`
**Commit:** 2567aaa
**Applied fix:** Strengthened the assertion in "reports nationality verbatim from ground truth" (TEST-07) to require positive-assertion context rather than a bare substring check.

The test now (a) retains the `toContain(nationality)` substring check and additionally (b) splits the response into sentences and requires at least one sentence to contain the nationality token, contain a positive-assertion phrase (`"you are"`, `"you're"`, `"your nationality"`, `"you hold"`, `"nationality is"`, `"nationality:"`), and have NO uncertainty marker in the same sentence (`"don't know"`, `"do not know"`, `"not sure"`, `"unsure"`, `"can't tell"`, `"cannot tell"`, `"i don't have"`, `"no memories"`, `"haven't told me"`, `"you haven't"`, `"not certain"`, `"uncertain"`, `"unclear"`, `"no idea"`).

The review's counterexample "I don't know if you are French" is correctly rejected: the sentence contains `"don't know"` (uncertainty) so is disqualified despite also containing `"you are"` and `"French"`. A valid positive response like "You are French." or "Your nationality is French." passes.

#### IN-02: `franc` language detection on potentially short responses

**Files modified:** `src/chris/__tests__/live-integration.test.ts`
**Commit:** 26d2012
**Applied fix:** Raised the franc-detection length threshold from `> 20` to `> 80` in all three Language switching tests (French at line 105, Russian at line 122, English at line 139), matching franc's own documented recommendation of ~60-80+ characters for reliable short-string detection. Eliminates flake risk where a 21-character response is misdetected between English/French.

### Skipped Issues

None this iteration.

### Verification

- Tier 1: Re-read all modified sections; edits present and surrounding code intact.
- Tier 2: `npx tsc --noEmit` produces only the three pre-existing `journal.test.ts` errors unrelated to this change. No new errors introduced.
- Logic-bug note (IN-01): The strengthened assertion is predicate-based; it changes test semantics (now flags denial-style responses). Flagged as "fixed" given the review explicitly preferred strengthening over relaxing, but human confirmation that Chris's actual French-nationality responses satisfy the positive-assertion predicate is recommended the first time the live suite runs end-to-end.

---

## Iteration 4 — 2026-04-14

### Fixed Issues

#### WR-07: `processMessage` writes pensieveEntries with `source='telegram'` that are never cleaned up by either test file

**Files modified:** `src/chris/engine.ts`, `src/chris/modes/journal.ts`, `src/chris/__tests__/live-integration.test.ts`
**Commit:** 32c8748
**Applied fix:** Option A from the review — inject a test-only source tag into `processMessage`.

Production changes:
- `src/chris/engine.ts` — `processMessage(chatId, userId, text, opts?)` now accepts an optional `{ pensieveSource?: string }` and forwards it to `handleJournal` for both the `JOURNAL` case and the PHOTOS "no photos found" fallback that routes through `handleJournal`.
- `src/chris/modes/journal.ts` — `handleJournal(...)` accepts the same optional `opts` parameter and passes `opts?.pensieveSource ?? 'telegram'` into `storePensieveEntry(...)`. The production default (`'telegram'`) is unchanged, so the Telegram bot path (`src/bot/bot.ts:35`) continues to write `source='telegram'` as before.

Test change:
- `src/chris/__tests__/live-integration.test.ts` — every `processMessage(...)` call site (34 invocations across Refusal handling, Language switching, Topic persistence, Sycophancy resistance, JOURNAL grounding, Hallucination resistance, Structured fact accuracy, and Performative apology) now passes `{ pensieveSource: TEST_SOURCE }`. The existing `afterEach` sweep (`eq(pensieveEntries.source, TEST_SOURCE)` plus the id-scoped cascade to `contradictions` and `pensieveEmbeddings`) now correctly reaches the rows that `handleJournal` writes on behalf of the engine under test.

Verification:
- `npx tsc --noEmit` — no new errors introduced. The three pre-existing `journal.test.ts` errors (lines 100, 132, 149, "Object is possibly 'undefined'") are present on HEAD without this change and are unrelated.
- Signature remains backwards-compatible: `opts` is optional, the bot call site `processMessage(chatId, userId, text)` is unaffected, and all other test files (`engine-refusal.test.ts`, `engine-mute.test.ts`, `engine.test.ts`, `photos-memory.test.ts`) continue to type-check without modification because they do not rely on inspecting pensieve rows by source.

Photos path note (step 5 of task): `src/chris/modes/photos.ts` does not call `handleJournal` directly — the fallback happens in `engine.ts:192` inside the PHOTOS case when `handlePhotos` returns `null`. That fallback now forwards `opts` to `handleJournal`, so if a future test exercises the no-photos path it will also get the tagged source. The code in `photos.ts` itself writes no pensieve rows, so no change is required there.

### Skipped Issues

None this iteration.

IN-01 and IN-02 remain out of scope (info items only; task says not to touch them).

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
