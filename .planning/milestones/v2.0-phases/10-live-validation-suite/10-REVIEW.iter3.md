---
phase: 10-live-validation-suite
reviewed: 2026-04-14T00:00:00Z
depth: standard
iteration: 2
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

# Phase 10: Code Review Report (Iteration 2)

**Reviewed:** 2026-04-14
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Re-review of the two live integration test files after iteration 1 fix commits. All five prior warnings have been addressed and the fixes are correct:

- **WR-01 (userId type)** — Confirmed false positive. `processMessage` signature in `src/chris/engine.ts:88-92` is `(chatId: bigint, userId: number, text: string)`. `TEST_USER_ID = 99901` (plain number) matches the parameter type. No change needed.
- **WR-02 (topic persistence positive assertion)** — Fixed at `live-integration.test.ts:171, 209, 247`. All three Topic Persistence (EN/FR/RU) tests now include `expect(response.length).toBeGreaterThan(10)` before the negative keyword check, preventing empty-response false passes.
- **WR-03 (haikuJudge JSON parse)** — Fixed at `live-integration.test.ts:355-360`. `JSON.parse(text)` is now wrapped in try/catch with a descriptive error message including the offending text.
- **WR-04 (vacuous question-count assertion)** — Fixed at `live-integration.test.ts:572-577`. The `turn3Questions < turn1Questions` comparison is now guarded by `if (turn1Questions > 0)`, and an unconditional `expect(turn3Questions).toBeLessThanOrEqual(2)` ensures turn 3 is never heavily interrogative.
- **WR-05 (global afterEach deletes)** — Fixed in both files. `live-integration.test.ts:36-51` and `contradiction-false-positive.test.ts:166-178` now query `pensieveEntries` by `source = 'telegram'`, then scope `contradictions` and `pensieveEmbeddings` deletes to those IDs using `inArray`. The `pensieveEntries` delete is still scoped by `source = 'telegram'`.

One residual warning remains from the WR-05 fix (see WR-06 below), and two prior info items (IN-01 and IN-03) are still present and carried forward.

---

## Warnings

### WR-06: WR-05 fix still deletes by shared `source = 'telegram'` tag — parallel runs of these two files will collide

**File:** `src/chris/__tests__/live-integration.test.ts:36-51`, `src/chris/__tests__/contradiction-false-positive.test.ts:166-178`
**Issue:** The iteration 1 fix (commit bf84231) scopes cleanup to rows with `source = 'telegram'`, which is better than a global delete but still not per-test-file isolated. Both test files insert rows with `source: 'telegram'` and both `afterEach` hooks delete all `source = 'telegram'` rows. If vitest runs these two files in parallel workers (the default pool is `threads`/`forks` which supports cross-file parallelism), file A's `afterEach` will delete rows that file B just inserted mid-test, producing spurious test failures or missed assertions.

Additionally, if any production or seed data in the dev DB uses `source = 'telegram'`, these tests will silently delete it. This is the same risk the original WR-05 flagged — just narrowed, not eliminated.

Concrete failure mode:
1. File A inserts `pensieveEntries` with `source='telegram'` at t=0
2. File B's `afterEach` runs at t=1 (parallel worker), reads IDs matching `source='telegram'` — includes file A's row
3. File B deletes file A's row
4. File A's assertion at t=2 fails because its seeded entry is gone

**Fix (pick one):**

Option A — Per-test-file unique source tag:
```ts
const TEST_SOURCE = `test-live-integration-${process.pid}`;
// Use TEST_SOURCE in all inserts and cleanup WHERE clauses
```

Option B — Serialize these two files in vitest config:
```ts
// vitest.config.ts
export default {
  test: {
    poolOptions: { forks: { singleFork: true } },
    // or use fileParallelism: false for the integration suite
  },
};
```

Option C — Use a transaction per test and roll back (cleanest for DB tests if schema/drivers support it).

Option A is lowest-risk and requires no infra change. The prior fix went halfway; a unique per-run or per-file tag closes the gap.

---

## Info

### IN-01: `GROUND_TRUTH_MAP['nationality']!` assertion too broad for "verbatim" test label (carried forward)

**File:** `src/chris/__tests__/live-integration.test.ts:489`
**Issue:** `expect(response).toContain(GROUND_TRUTH_MAP['nationality']!)` checks only for the substring (e.g., `'French'`). A response like "I don't know if you are French" would pass despite being a denial. The test is labelled "reports nationality verbatim from ground truth" but the assertion is a bare substring check.

**Fix:** Either relax the label to "mentions nationality" or strengthen the assertion to require a positive context (e.g., absence of uncertainty markers in the same sentence, or proximity to "you are" / "your nationality").

---

### IN-02: `franc` language detection on potentially short responses (carried forward)

**File:** `src/chris/__tests__/live-integration.test.ts:101-103, 117-119, 133-135`
**Issue:** The language-switching tests require `response.length > 20` (20 characters) before running `franc(response, { only: ['eng', 'fra', 'rus'] })`. Franc's documentation recommends ~60–80+ characters / 10+ tokens for reliable short-string detection, especially to disambiguate English/French which share many common short words. A 21-character French response could be misdetected as English, producing a flaky failure unrelated to Chris's behavior.

**Fix:**
```ts
expect(response.length).toBeGreaterThan(80);
```
Or handle `franc` returning `'und'`:
```ts
const detected = franc(response, { only: ['eng', 'fra', 'rus'] });
if (detected !== 'und') expect(detected).toBe('fra');
```

---

## Verification of Iteration 1 Fixes

| ID | Fix Commit | Location | Status |
|----|-----------|----------|--------|
| WR-01 | (skipped — false positive) | `processMessage(chatId: bigint, userId: number, text: string)` confirmed at `src/chris/engine.ts:88-92` | Verified correct |
| WR-02 | b6ffdff | `live-integration.test.ts:171, 209, 247` — `expect(response.length).toBeGreaterThan(10)` added in all three Topic Persistence tests | Fixed |
| WR-03 | 3d0d674 | `live-integration.test.ts:355-360` — try/catch around `JSON.parse(text)` with descriptive error | Fixed |
| WR-04 | cc1ea82 | `live-integration.test.ts:572-577` — `if (turn1Questions > 0)` guard + unconditional `toBeLessThanOrEqual(2)` | Fixed |
| WR-05 | bf84231 | Both files — cleanup scoped by `source = 'telegram'` with `inArray` for FK tables | Partially fixed — see WR-06 |

---

_Reviewed: 2026-04-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 2_
