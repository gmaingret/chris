---
phase: 19-proactive-pipeline-restoration
fixed_at: 2026-04-17T21:32:29Z
review_path: .planning/phases/19-proactive-pipeline-restoration/19-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 19: Code Review Fix Report

**Fixed at:** 2026-04-17T21:32:29Z
**Source review:** .planning/phases/19-proactive-pipeline-restoration/19-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (critical_warning scope — CR: 0, WR: 2; IN: 5 deferred)
- Fixed: 2
- Skipped: 0

Both Phase 19 warnings inherent to the canonical escalation block in
`src/proactive/sweep.ts` were addressed. All five target tests in the Phase 19
testing gate still pass (80/80) under the canonical Docker Postgres flow
(`bash scripts/test.sh --no-coverage …`). TypeScript compiles clean
(`npx tsc --noEmit` — no errors in modified files).

The five Info findings (IN-01 through IN-05) are out of scope for the
`critical_warning` fix scope and were not addressed. They remain open for a
follow-up pass if desired: the three TEST-12 Info items (IN-01/02/03) belong to
Phase 18's ongoing work on the same file, and the two `state.ts` Info items
(IN-04/05) were already validated in Phase 15/16 and are canonical-code
observations re-surfaced only because the reviewer re-verified restored code.

## Fixed Issues

### WR-01: Non-atomic escalation state writes can desync on partial failure

**Files modified:**
- `src/proactive/state.ts` — added `setEscalationState(decisionId, count, sentAt)` helper that performs both upserts inside a single `db.transaction()`. The helper uses `tx.insert(...).onConflictDoUpdate(...)` against `proactiveState` for both the `accountability_sent_<id>` and `accountability_prompt_count_<id>` keys, committing or rolling back together.
- `src/proactive/sweep.ts` — replaced the two-write pair at the accountability-bootstrap branch (`setEscalationSentAt(decisionId, new Date())` + `setEscalationCount(decisionId, 1)`) and the two-write pair at the 48h follow-up branch (`setEscalationCount(row.decisionId, 2)` + `setEscalationSentAt(row.decisionId, new Date())`) with the atomic `setEscalationState(...)` call.
- `src/proactive/__tests__/sweep-escalation.test.ts` — added an in-memory-stateStore-backed `setEscalationState` mock inside the `vi.mock('../state.js', …)` block so all 8 escalation contract tests continue to exercise the pre/post-state contract via the new helper.
- `src/proactive/__tests__/sweep.test.ts` — added passthrough `mockSetEscalationState` to the hoisted mocks and the `vi.mock('../state.js', …)` registration. No specific assertion depends on it; this just prevents the import from resolving to `undefined`.
- `src/decisions/__tests__/synthetic-fixture.test.ts` — added passthrough `mockSetEscalationState` to the hoisted mocks, the `vi.mock('../../proactive/state.js', …)` registration, and the TEST-12 `beforeEach` reset. Replaced the TEST-12 assertions at the state-write boundary: the two legacy checks (`mockSetEscalationSentAt` called with a Date, `mockSetEscalationCount` called with 1) were consolidated into a single `expect(mockSetEscalationState).toHaveBeenCalledWith(FAKE_DECISION_ID, 1, expect.any(Date))`. This keeps the RES-02 bootstrap contract visible at the test boundary and aligns with the new atomicity guarantee. The edit is strictly scoped to the TEST-12 `describe` block (lines 516–633); Phase 18's WR-05 work lives in TEST-10's `beforeEach` at line 297 and does not overlap.

**Commit:** `e6a073b` (`fix(19): WR-01 write escalation (count, sentAt) atomically via setEscalationState`)

**Applied fix:** Collapsed every call site that must advance the (sentAt, count) pair together onto a single transactional helper. A partial failure mid-pair now rolls back cleanly instead of leaving count=2 without the matching sentAt bump, or count=1 without sentAt stamped.

**Scope note (intentionally not changed):** the legacy bootstrap branch in the escalation loop (sweep.ts `if (sentAt === null)` block) still calls `setEscalationSentAt` + conditional `setEscalationCount` as two separate writes, because its count write is conditional on `count === 0` to preserve existing progress from partially-migrated rows. Using `setEscalationState` there would overwrite existing counts unconditionally and change the migration semantics — not a WR-01 fix, a behavior change. Documented inline in a comment.

### WR-02: One failing LLM call aborts the entire escalation pass for remaining decisions

**Files modified:**
- `src/proactive/sweep.ts` — split the single loop-spanning try/catch into two scopes. The outer try now wraps only the `db.select({…}).from(decisionCaptureState).where(…).orderBy(…).limit(10)` call that fetches the batch; on failure it logs `proactive.sweep.escalation.error` and falls through with an empty `awaitingRows` array. The inner try/catch wraps each iteration's per-row body (KV reads, staleness math, transition, follow-up LLM call, atomic state write); on per-row failure it logs `proactive.sweep.escalation.row.error` with the offending `decisionId` and continues to the next row.

**Commit:** `ed41b95` (`fix(19): WR-02 isolate per-row escalation failures with inner try/catch`)

**Applied fix:** Moved the try/catch boundary inside `for (const row of awaitingRows)` so an Anthropic 5xx, rate limit, network blip, or KV write failure on a single decision no longer aborts the whole sweep tick. Remaining rows in the same batch are still processed. A new log channel (`proactive.sweep.escalation.row.error`) disambiguates per-row failures from the top-level query failure, improving observability for the intermittent-failure case this guard is designed for.

**Test contract preservation:** All 8 tests in `src/proactive/__tests__/sweep-escalation.test.ts` still pass. The WR-01 race-guard test ("WR-01: when stale transition fails (race lost), clearCapture is NOT called") continues to work because the inner `transitionDecision` try/catch remains in place inside the `count >= 2` branch — only the loop-level scope changed.

## Skipped Issues

None.

## Verification Performed

- **Syntax (Tier 2):** `npx tsc --noEmit` — zero errors in `src/proactive/sweep.ts` or `src/proactive/state.ts`. Pre-existing `node_modules` type errors (drizzle gel-core, @huggingface/transformers, anthropic SDK private identifiers) are ignored per `<verification_strategy>`.
- **Re-read (Tier 1):** Both modified source files re-read after each edit; fix text present and surrounding code intact.
- **Targeted tests (Phase 19 gate):** `bash scripts/test.sh --no-coverage src/proactive/__tests__/sweep.test.ts src/proactive/__tests__/sweep-escalation.test.ts src/proactive/__tests__/state.test.ts src/proactive/__tests__/deadline.test.ts src/decisions/__tests__/synthetic-fixture.test.ts` → **80 passed (5 files)** against a fresh Docker Postgres per the memory instruction "NEVER skip Docker integration tests." Canonical docker-compose.local.yml flow (port 5433) used for the final verification run.
- **Per-commit re-verification:** Target-suite pass confirmed after WR-01 alone (pre-WR-02) and again after WR-02 — each commit is independently green.

## Coordination Notes

- `src/decisions/__tests__/synthetic-fixture.test.ts` was touched inside the TEST-12 `describe` block only (additions at lines 50, 86–87, 197; `beforeEach` reset at line 555; assertion consolidation at lines 628–635). Phase 18's WR-05 work (vi.resetAllMocks in TEST-10 `beforeEach` at line 297) lives in a distinct `describe` block with a distinct `beforeEach` and does not overlap.
- Two separate atomic commits, one per finding, as required by the per-finding commit convention. sweep.ts changes were split by staging only the atomic-writes hunks into the WR-01 commit and the try/catch-restructure hunks into the WR-02 commit, so each commit is independently revertable.

---

_Fixed: 2026-04-17T21:32:29Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
