---
phase: 19-proactive-pipeline-restoration
fixed_at: 2026-04-18T05:51:00Z
review_path: .planning/phases/19-proactive-pipeline-restoration/19-REVIEW.md
iteration: 2
findings_in_scope: 7
fixed: 6
skipped: 1
status: partial
---

# Phase 19: Code Review Fix Report

**Fixed at:** 2026-04-18T05:51:00Z
**Source review:** .planning/phases/19-proactive-pipeline-restoration/19-REVIEW.md
**Iteration:** 2 (cumulative across iterations 1 and 2)

**Summary:**
- Findings in scope: 7 (CR: 0, WR: 2, IN: 5 — all-scope mode for iteration 2)
- Fixed: 6 (WR-01, WR-02 in iteration 1; IN-01, IN-02, IN-03, IN-05 in iteration 2)
- Skipped: 1 (IN-04, already-fixed upstream in Phase 15)

**Iteration 1** cleared the two Warning findings (WR-01 atomic escalation writes,
WR-02 per-row try/catch). **Iteration 2** cleared the five Info findings with a
mix of direct fixes and documented already-applied status for one item. Per the
coordination note in the task brief, Phase 18 was concurrently editing the same
`synthetic-fixture.test.ts` file; IN-02 was landed into a Phase 18 commit due to
unstaged diffs being swept up (see Coordination Notes below), and IN-03 was
already covered by Phase 18's concurrent IN-06 commit (`crypto.randomUUID()`).

All 152 tests in the Phase 19 gate pass after iteration 2
(`bash scripts/test.sh --no-coverage src/proactive/__tests__/ src/decisions/__tests__/synthetic-fixture.test.ts`
→ **152 passed (11 files)**) against a fresh Docker Postgres. TypeScript
compiles clean in modified files.

## Fixed Issues

### WR-01: Non-atomic escalation state writes can desync on partial failure
**(Iteration 1)**

**Files modified:**
- `src/proactive/state.ts` — added `setEscalationState(decisionId, count, sentAt)` helper that performs both upserts inside a single `db.transaction()`. The helper uses `tx.insert(...).onConflictDoUpdate(...)` against `proactiveState` for both the `accountability_sent_<id>` and `accountability_prompt_count_<id>` keys, committing or rolling back together.
- `src/proactive/sweep.ts` — replaced the two-write pair at the accountability-bootstrap branch (`setEscalationSentAt(decisionId, new Date())` + `setEscalationCount(decisionId, 1)`) and the two-write pair at the 48h follow-up branch (`setEscalationCount(row.decisionId, 2)` + `setEscalationSentAt(row.decisionId, new Date())`) with the atomic `setEscalationState(...)` call.
- `src/proactive/__tests__/sweep-escalation.test.ts` — added an in-memory-stateStore-backed `setEscalationState` mock inside the `vi.mock('../state.js', …)` block so all 8 escalation contract tests continue to exercise the pre/post-state contract via the new helper.
- `src/proactive/__tests__/sweep.test.ts` — added passthrough `mockSetEscalationState` to the hoisted mocks and the `vi.mock('../state.js', …)` registration. No specific assertion depends on it; this just prevents the import from resolving to `undefined`.
- `src/decisions/__tests__/synthetic-fixture.test.ts` — added passthrough `mockSetEscalationState` to the hoisted mocks, the `vi.mock('../../proactive/state.js', …)` registration, and the TEST-12 `beforeEach` reset. Replaced the TEST-12 assertions at the state-write boundary: the two legacy checks were consolidated into a single `expect(mockSetEscalationState).toHaveBeenCalledWith(FAKE_DECISION_ID, 1, expect.any(Date))`.

**Commit:** `e6a073b` (`fix(19): WR-01 write escalation (count, sentAt) atomically via setEscalationState`)

**Applied fix:** Collapsed every call site that must advance the (sentAt, count) pair together onto a single transactional helper. A partial failure mid-pair now rolls back cleanly instead of leaving count=2 without the matching sentAt bump, or count=1 without sentAt stamped.

**Scope note (intentionally not changed):** the legacy bootstrap branch in the escalation loop (sweep.ts `if (sentAt === null)` block) still calls `setEscalationSentAt` + conditional `setEscalationCount` as two separate writes, because its count write is conditional on `count === 0` to preserve existing progress from partially-migrated rows. Using `setEscalationState` there would overwrite existing counts unconditionally and change the migration semantics — not a WR-01 fix, a behavior change. Documented inline in a comment.

### WR-02: One failing LLM call aborts the entire escalation pass for remaining decisions
**(Iteration 1)**

**Files modified:**
- `src/proactive/sweep.ts` — split the single loop-spanning try/catch into two scopes. The outer try now wraps only the `db.select({…}).from(decisionCaptureState).where(…).orderBy(…).limit(10)` call that fetches the batch; on failure it logs `proactive.sweep.escalation.error` and falls through with an empty `awaitingRows` array. The inner try/catch wraps each iteration's per-row body (KV reads, staleness math, transition, follow-up LLM call, atomic state write); on per-row failure it logs `proactive.sweep.escalation.row.error` with the offending `decisionId` and continues to the next row.

**Commit:** `ed41b95` (`fix(19): WR-02 isolate per-row escalation failures with inner try/catch`)

**Applied fix:** Moved the try/catch boundary inside `for (const row of awaitingRows)` so an Anthropic 5xx, rate limit, network blip, or KV write failure on a single decision no longer aborts the whole sweep tick. Remaining rows in the same batch are still processed. A new log channel (`proactive.sweep.escalation.row.error`) disambiguates per-row failures from the top-level query failure, improving observability for the intermittent-failure case this guard is designed for.

**Test contract preservation:** All 8 tests in `src/proactive/__tests__/sweep-escalation.test.ts` still pass. The WR-01 race-guard test continues to work because the inner `transitionDecision` try/catch remains in place inside the `count >= 2` branch — only the loop-level scope changed.

### IN-01: TEST-12 does not assert channel invocation ORDER at the state-helper boundary
**(Iteration 2)**

**Files modified:**
- `src/decisions/__tests__/synthetic-fixture.test.ts` — Added an `invocationCallOrder` assertion inside the TEST-12 `it(...)` block immediately after the content-based `firstMsg`/`secondMsg` checks. Compares the first call's `invocationCallOrder[0]` on `mockSetLastSentAccountability` against the same on `mockSetLastSentReflective`; defines-check on both before the `<` comparison to guard against the mocks never being called. Leaves the pre-existing content assertions in place because they still document the prompt contract at the send boundary; the new assertion adds a parallel, text-independent proof at the state-write boundary.

**Commit:** `82ec4f9` (`fix(19): IN-01 assert TEST-12 channel order via invocationCallOrder`)

**Applied fix:** D-05 (accountability fires first) is now enforced at the state-helper layer independent of prompt text. A future refactor that changes prompt wording but preserves ordering will still pass; a refactor that flips channel order without noticing will fail this assertion. The IN-01 commit also swept up a concurrent Phase 18 edit (DAY_MS import migration) that happened to be unstaged at commit time — a benign coordination artifact, not a behavior change in Phase 19 scope.

### IN-02: TEST-12 does not assert `result.skippedReason` on the happy path
**(Iteration 2)**

**Files modified:**
- `src/decisions/__tests__/synthetic-fixture.test.ts` — Added `expect(result.skippedReason).toBeUndefined();` immediately after the `expect(result.triggered).toBe(true);` assertion, with an inline comment referencing IN-02 and the sweep.ts happy-path contract at lines 326-328.

**Commit:** `4aa0ae4` (landed inside Phase 18's `fix(18): IN-05 extract DAY_MS to shared test fixture` commit — see Coordination Notes).

**Applied fix:** The happy-path (both-channels-fire) contract now pins `skippedReason === undefined` at the test boundary. A regression that mistakenly populates `skippedReason = 'no_trigger'` alongside a successful send is now caught.

**Commit-hash caveat:** The IN-02 source change was briefly unstaged when Phase 18's IN-05 fix commit ran. `gsd-tools commit --files <path>` with `<path>` being the same file swept up the IN-02 edit into Phase 18's commit. The code change is present in git history at `4aa0ae4` under a Phase 18 commit message; the intent and attribution are recorded here in the Phase 19 fix report for traceability. Behaviorally indistinguishable from a clean Phase 19 commit.

### IN-03: TEST-12 `FAKE_DECISION_ID` is not a valid UUID string
**(Iteration 2 — already-applied by concurrent Phase 18 work)**

**Files modified:** None by this fixer. The change already exists in the codebase.

**Commit:** `cd039ba` (`fix(18): IN-06 use crypto.randomUUID for FAKE_DECISION_ID in TEST-12`)

**Applied fix:** Phase 18's iteration 2 independently identified the same issue (tagged IN-06 in the Phase 18 review) and replaced `'test-decision-uuid-for-test-12'` with `crypto.randomUUID()`. The fix is stronger than the review suggestion (random UUID per test run rather than a static literal UUID), and covers the same failure mode: if `upsertAwaitingResolution` is ever un-mocked, the value passed to the `uuid` pg column is a valid UUID string rather than a descriptive label that would throw a pg type error.

This fixer verified the current file state uses `crypto.randomUUID()` and chose not to re-land an identical change. The Phase 18 commit message does not reference Phase 19's IN-03, but the fix is canonical — Phase 19 IN-03 is effectively closed.

### IN-05: `getEscalationSentAt` uses truthy check instead of null check
**(Iteration 2)**

**Files modified:**
- `src/proactive/state.ts` — Changed `return val ? new Date(val as string) : null;` to the two-line null-check pattern used everywhere else in the file: `if (val == null) return null; return new Date(val as string);`. Expanded the docstring to explain the IN-05 rationale (consistency with `getLastSent`, `getMuteUntil`, `hasSentTodayReflective`, `hasSentTodayAccountability`).

**Commit:** `109ffd7` (`fix(19): IN-05 align getEscalationSentAt with null-check pattern`)

**Applied fix:** `getEscalationSentAt` no longer treats empty string `""` as "not present". In practice `setEscalationSentAt` always writes an ISO string, so the behavior change is a style/robustness improvement rather than a bug fix — but the file now reads uniformly and a future JSONB-corruption scenario where `""` lands in storage will correctly surface as `new Date("") → Invalid Date` rather than silently collapse to `null` and re-seed the escalation clock.

## Skipped Issues

### IN-04: `getEscalationCount` silently returns 0 on unexpected stored type

**File:** `src/proactive/state.ts:157-160` (review cite)
**Reason:** Already fixed upstream by Phase 15 commit `1a24d3e` (`fix(15): WR-03 log warn when getEscalationCount reads non-numeric JSONB`).

The current `getEscalationCount` implementation at `src/proactive/state.ts:166-177` already logs `proactive.state.escalation_count.non_numeric` on type mismatch and returns 0 — structurally equivalent to the review's suggested fix. The Phase 19 review re-surfaced this finding only because it re-verified restored canonical code as though fresh (Bucket (b) in the review summary). No further change needed; re-applying would produce an empty diff.

## Verification Performed

- **Syntax (Tier 2):** `npx tsc --noEmit` after each edit — zero errors in `src/proactive/state.ts` or `src/decisions/__tests__/synthetic-fixture.test.ts`. Pre-existing `node_modules` type errors (drizzle gel-core, @huggingface/transformers, anthropic SDK private identifiers) are ignored per `<verification_strategy>`.
- **Re-read (Tier 1):** Both modified files re-read after each edit; fix text present and surrounding code intact.
- **Targeted tests (Phase 19 gate):** `bash scripts/test.sh --no-coverage src/proactive/__tests__/ src/decisions/__tests__/synthetic-fixture.test.ts` → **152 passed (11 files)** against a fresh Docker Postgres per the memory instruction "NEVER skip Docker integration tests." Canonical docker-compose.local.yml flow (port 5433) used for the verification run.
- **Per-commit check:** after IN-01 and IN-05 landed independently, the target suite was re-verified green.

## Coordination Notes

- **Phase 18 cross-editing `synthetic-fixture.test.ts`:** Phase 18 iteration 2 was concurrently applying IN-05 (DAY_MS extraction), IN-03 (chat-ids registry), and IN-06 (FAKE_DECISION_ID randomUUID) to the same file. Commit interleaving during the Phase 19 iteration 2 run:
  1. Phase 19 IN-01 edit → committed as `82ec4f9` (picked up a small unstaged Phase 18 DAY_MS-import hunk because both touched the same top-of-file import block).
  2. Phase 18 IN-05 commit `4aa0ae4` → swept up the Phase 19 IN-02 edit (unstaged at the time).
  3. Phase 18 IN-03 commit `51fea91` → chat-ids fixture registry.
  4. Phase 18 IN-06 commit `cd039ba` → FAKE_DECISION_ID → crypto.randomUUID. This effectively resolved Phase 19 IN-03.
  5. Phase 19 IN-05 edit → committed cleanly as `109ffd7` (state.ts has no overlap with Phase 18 work).
  The code changes intended by Phase 19 are all present in git history; some landed under adjacent Phase 18 commit messages due to unstaged-diff sweeping. Each Phase 19 fix is still independently revertable by grepping for the `IN-0N` tag in the diff content.

- **`src/proactive/state.ts` sole-ownership:** Only Phase 19 touched state.ts in iteration 2. IN-05's commit is clean and independent of Phase 15/16 work.

- **Two iterations, seven findings:** Iteration 1 cleared 2 Warnings; iteration 2 cleared 4 Infos plus 1 already-applied. Combined all-scope status: `partial` because IN-04 is `skipped: already fixed upstream` rather than `fixed` in this run — but the underlying intent is fully realized in the codebase.

## Fix Commit Map

| Finding | Commit | Files | Iteration |
|---------|--------|-------|-----------|
| WR-01 | `e6a073b` | state.ts, sweep.ts, 3 tests | 1 |
| WR-02 | `ed41b95` | sweep.ts | 1 |
| IN-01 | `82ec4f9` | synthetic-fixture.test.ts | 2 |
| IN-02 | `4aa0ae4` (Phase 18 sweep) | synthetic-fixture.test.ts | 2 |
| IN-03 | `cd039ba` (Phase 18 IN-06) | synthetic-fixture.test.ts | 2 (already-applied) |
| IN-04 | `1a24d3e` (Phase 15 WR-03) | state.ts | — (already-applied upstream) |
| IN-05 | `109ffd7` | state.ts | 2 |

---

_Fixed: 2026-04-18T05:51:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
