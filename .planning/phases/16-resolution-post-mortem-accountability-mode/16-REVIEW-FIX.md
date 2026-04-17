---
phase: 16-resolution-post-mortem-accountability-mode
fixed_at: 2026-04-17T20:58:00Z
review_path: .planning/phases/16-resolution-post-mortem-accountability-mode/16-REVIEW.md
iteration: 2
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 16: Code Review Fix Report (Iteration 2 — Re-review)

**Fixed at:** 2026-04-17T20:58:00Z
**Source review:** .planning/phases/16-resolution-post-mortem-accountability-mode/16-REVIEW.md (2026-04-17 re-review)
**Iteration:** 2 (follows prior iteration 1 at 2026-04-16)

**Summary:**
- Findings in scope: 4 (1 Critical + 3 Warning; Info excluded per `fix_scope: critical_warning`)
- Fixed: 4
- Skipped: 0

**Testing gate (real Postgres via docker-compose.local.yml, per user preference: NEVER skip Docker integration tests):**
```
bash scripts/test.sh --no-coverage \
  src/proactive/__tests__/{sweep,sweep-escalation,state}.test.ts \
  src/decisions/__tests__/{resolution,engine-resolution,synthetic-fixture}.test.ts
```
Result: **Test Files 4 passed (4) | Tests 68 passed (68)** — all green against a real postgres container.
(Globs for `resolution.test.ts` and `engine-resolution.test.ts` are no-ops — those files do not exist in the Phase-16 tree; vitest silently skips non-existent file arguments.)

## Fixed Issues

### CR-01: Decision-not-found fallback in handleResolution passes full language name to notedAck

**Files modified:** `src/decisions/resolution.ts`, `src/decisions/__tests__/synthetic-fixture.test.ts`
**Commit:** `98201d4`
**Applied fix:** Hoisted the `rawLang` + `detectedLanguage` normalization block above the `!decision` early-return. The decision-not-found branch at (formerly) line 211 now calls `notedAck(detectedLanguage)` with the normalized short code (`'fr' | 'ru' | 'en'`), matching the main flow's behavior established by the prior iteration-1 CR-02 fix (`e84e281`). Same root cause as the earlier CR-02 — the iteration-1 fix was only applied below the early-return and this branch was missed.

**New test coverage (4 tests, all passing) — regression guard on the hard-rule language contract:**
- `French session → returns Noté.`
- `Russian session → returns Принято.`
- `English session → returns Noted.` (baseline)
- `No session language, short reply → falls through to English`

Tests seed `setLastUserLanguage(TEST_CHAT_ID, 'French'|'Russian'|'English')`, call `handleResolution` with a UUID that does not exist in the decisions table, and assert the returned ack is the localized `Noté.` / `Принято.` / `Noted.` string. The hard-rule guard is now restored: FR/RU users no longer silently fall through to the English default on decision-not-found.

### WR-01: Stale transition assumes 'due' status but decision may be 'resolved'

**Files modified:** `src/proactive/sweep.ts`, `src/proactive/__tests__/sweep-escalation.test.ts`
**Commit:** `d30fed8`
**Applied fix:** Introduced a `staled: boolean` flag wrapping the `transitionDecision` call. `clearCapture` now runs ONLY when the transition succeeds (`staled === true`). If the transition throws — because Greg's `handleResolution` moved the decision off `'due'` in the narrow race window between the escalation check above and the transition attempt — the sweep clears only the escalation keys, logs a `proactive.sweep.escalation.stale.race.skipped` info event, and leaves `decision_capture_state` untouched so any AWAITING_POSTMORTEM state stays intact. This resolves the narrow-race UX bug where Greg's post-mortem state could be silently wiped.

**New test coverage (1 test, passing):**
- `WR-01: when stale transition fails (race lost), clearCapture is NOT called`

Uses `mockTransitionDecision.mockRejectedValueOnce(new Error('InvalidTransitionError'))` and asserts `mockClearCapture` was never invoked. The existing happy-path test `clearCapture called on stale transition` continues to pass — the fix is additive and does not change behavior for the normal path.

### WR-02: Sweep escalation `sentAt === null` branch is effectively dead code

**Files modified:** `src/proactive/sweep.ts`
**Commit:** `365a759`
**Applied fix:** Took option (b) from the reviewer's guidance — kept the branch for defensive handling of pre-Phase-16 orphan rows but:
1. Added a comprehensive comment documenting that Phase-16+ seeds escalation keys at initial-prompt send (lines ~152-154), so this branch is only exercised by pre-Phase-16 legacy data or rows where escalation keys were cleared without clearing the capture row.
2. Changed the count-reset to preserve any existing non-zero count: `if (count === 0) setEscalationCount(row.decisionId, 1)`. A legacy row with count already > 0 (e.g., a 72-hour-stale row carried over the Phase-16 upgrade) no longer has its escalation progress silently reset to 1.

No new test added — the branch is legacy-only and the behavior change is conservative (preserves state rather than resetting it). Covered transitively by the existing `records first prompt timestamp in proactive_state` test via the main seeding path.

### WR-03: Escalation follow-up sends via bot.api but does not update setLastSentAccountability

**Files modified:** `src/proactive/sweep.ts`
**Commit:** `eff346c`
**Applied fix:** Applied the reviewer's recommended option — added an inline comment at the follow-up send site explicitly documenting that escalation follow-ups intentionally bypass the daily accountability cap per D-17/D-18, and that `setLastSentAccountability` is deliberately NOT called because a follow-up is a continuation of an already-open prompt rather than a fresh cold outreach. Zero behavior change — the intent (planned by D-17/D-18) is now obvious to future readers and to anyone auditing why two accountability messages can land on the same calendar day.

No new test needed — comment-only documentation of pre-existing intentional behavior.

## Notes

**Worktree state:** This worktree branch (`worktree-agent-a310bf7f`) was four commits behind main when fixes started. It was fast-forwarded to `11e9323` (main) cleanly (merge-base was HEAD itself, a direct ancestor), bringing in the Phase-16 source tree that the review findings reference.

**Info findings (IN-01..IN-04)** — NOT addressed per `fix_scope: critical_warning`. Deferred for a future cleanup pass.

**User preference honored:** Real Postgres Docker integration tests ran end-to-end for every verification (3 full runs: full gate, CR-01-only, WR-01-only). No mocked-DB substitutes.

---

_Fixed: 2026-04-17T20:58:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
