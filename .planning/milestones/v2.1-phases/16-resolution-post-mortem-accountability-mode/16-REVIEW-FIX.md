---
phase: 16-resolution-post-mortem-accountability-mode
fixed_at: 2026-04-17T05:50:00Z
review_path: .planning/phases/16-resolution-post-mortem-accountability-mode/16-REVIEW.md
iteration: 2
findings_in_scope: 8
fixed: 8
skipped: 0
status: all_fixed
---

# Phase 16: Code Review Fix Report (Iteration 2)

**Fixed at:** 2026-04-17T05:50:00Z
**Source review:** .planning/phases/16-resolution-post-mortem-accountability-mode/16-REVIEW.md (2026-04-17 re-review)
**Iteration:** 2 (follows prior iteration 1 at 2026-04-16)

**Summary:**
- Findings in scope: 8 (1 Critical + 3 Warning + 4 Info — `fix_scope: all`)
- Fixed: 8
- Skipped: 0

**Testing gate (real Postgres via docker-compose.local.yml, per user preference: NEVER skip Docker integration tests):**
```
bash scripts/test.sh --no-coverage \
  src/proactive/__tests__/sweep.test.ts \
  src/proactive/__tests__/sweep-escalation.test.ts \
  src/chris/__tests__/personality.test.ts \
  src/chris/__tests__/praise-quarantine.test.ts \
  src/decisions/__tests__/synthetic-fixture.test.ts
```
Result: **Test Files 5 passed (5) | Tests 98 passed (98)** — all green against a real postgres container.
`npx tsc --noEmit` also clean across the full project after all three Info commits.

## Fixed Issues

### CR-01: Decision-not-found fallback in handleResolution passes full language name to notedAck

**Files modified:** `src/decisions/resolution.ts`, `src/decisions/__tests__/synthetic-fixture.test.ts`
**Commit:** `98201d4` (iteration 2 — CR/WR pass)
**Applied fix:** Hoisted the `rawLang` + `detectedLanguage` normalization block above the `!decision` early-return. The decision-not-found branch at (formerly) line 211 now calls `notedAck(detectedLanguage)` with the normalized short code (`'fr' | 'ru' | 'en'`), matching the main flow's behavior established by the prior iteration-1 CR-02 fix (`e84e281`). Same root cause as the earlier CR-02 — the iteration-1 fix was only applied below the early-return and this branch was missed.

**New test coverage (4 tests, all passing) — regression guard on the hard-rule language contract:**
- `French session → returns Noté.`
- `Russian session → returns Принято.`
- `English session → returns Noted.` (baseline)
- `No session language, short reply → falls through to English`

Tests seed `setLastUserLanguage(TEST_CHAT_ID, 'French'|'Russian'|'English')`, call `handleResolution` with a UUID that does not exist in the decisions table, and assert the returned ack is the localized `Noté.` / `Принято.` / `Noted.` string. The hard-rule guard is now restored: FR/RU users no longer silently fall through to the English default on decision-not-found.

### WR-01: Stale transition assumes 'due' status but decision may be 'resolved'

**Files modified:** `src/proactive/sweep.ts`, `src/proactive/__tests__/sweep-escalation.test.ts`
**Commit:** `d30fed8` (iteration 2 — CR/WR pass)
**Applied fix:** Introduced a `staled: boolean` flag wrapping the `transitionDecision` call. `clearCapture` now runs ONLY when the transition succeeds (`staled === true`). If the transition throws — because Greg's `handleResolution` moved the decision off `'due'` in the narrow race window between the escalation check above and the transition attempt — the sweep clears only the escalation keys, logs a `proactive.sweep.escalation.stale.race.skipped` info event, and leaves `decision_capture_state` untouched so any AWAITING_POSTMORTEM state stays intact. This resolves the narrow-race UX bug where Greg's post-mortem state could be silently wiped.

**New test coverage (1 test, passing):**
- `WR-01: when stale transition fails (race lost), clearCapture is NOT called`

Uses `mockTransitionDecision.mockRejectedValueOnce(new Error('InvalidTransitionError'))` and asserts `mockClearCapture` was never invoked. The existing happy-path test `clearCapture called on stale transition` continues to pass — the fix is additive and does not change behavior for the normal path.

### WR-02: Sweep escalation `sentAt === null` branch is effectively dead code

**Files modified:** `src/proactive/sweep.ts`
**Commit:** `365a759` (iteration 2 — CR/WR pass)
**Applied fix:** Took option (b) from the reviewer's guidance — kept the branch for defensive handling of pre-Phase-16 orphan rows but:
1. Added a comprehensive comment documenting that Phase-16+ seeds escalation keys at initial-prompt send (lines ~152-154), so this branch is only exercised by pre-Phase-16 legacy data or rows where escalation keys were cleared without clearing the capture row.
2. Changed the count-reset to preserve any existing non-zero count: `if (count === 0) setEscalationCount(row.decisionId, 1)`. A legacy row with count already > 0 (e.g., a 72-hour-stale row carried over the Phase-16 upgrade) no longer has its escalation progress silently reset to 1.

No new test added — the branch is legacy-only and the behavior change is conservative (preserves state rather than resetting it). Covered transitively by the existing `records first prompt timestamp in proactive_state` test via the main seeding path.

### WR-03: Escalation follow-up sends via bot.api but does not update setLastSentAccountability

**Files modified:** `src/proactive/sweep.ts`
**Commit:** `eff346c` (iteration 2 — CR/WR pass)
**Applied fix:** Applied the reviewer's recommended option — added an inline comment at the follow-up send site explicitly documenting that escalation follow-ups intentionally bypass the daily accountability cap per D-17/D-18, and that `setLastSentAccountability` is deliberately NOT called because a follow-up is a continuation of an already-open prompt rather than a fresh cold outreach. Zero behavior change — the intent (planned by D-17/D-18) is now obvious to future readers and to anyone auditing why two accountability messages can land on the same calendar day.

No new test needed — comment-only documentation of pre-existing intentional behavior.

### IN-01: Dynamic `clearEscalationKeys` import with typeof guard is now dead-code safety

**Files modified:** `src/decisions/resolution.ts`
**Commit:** `3804778` (iteration 2 — Info pass)
**Applied fix:** Replaced the two `await import('../proactive/state.js')` IIFEs (one each in `handleResolution` and `handlePostmortem`) with a single static top-level import at module scope. Phase 19's restoration (commit f8ea66f) brought `clearEscalationKeys` back as a static named export from `src/proactive/state.ts:228`, so the `typeof === 'function'` guard is unreachable and the dynamic-import indirection is pure cruft. The new call sites are a single-line `void clearEscalationKeys(decisionId).catch(_e => { /* best-effort */ })` — the `.catch` preserves the prior fail-silent guarantee (cleanup errors never break the resolution or post-mortem flow).

Both call sites annotated with an IN-01 comment explaining why the dynamic import was originally there and why the static form is now safe. Test mocks are unaffected — `synthetic-fixture.test.ts:188-201` uses `vi.mock('../../proactive/state.js', ...)` which intercepts static and dynamic imports identically.

No new test required — behavior is unchanged, only the module-loader indirection is removed. The existing `synthetic-fixture.test.ts` still passes (98 tests green in the test gate above).

### IN-02: JSON.parse(cleaned) not wrapped in inner try/catch

**Files modified:** _(none — already fixed in iteration 1)_
**Commit:** n/a (pre-existing fix)
**Applied fix:** No action required. The inner `try/catch` around `JSON.parse(cleaned)` was already added during iteration 1's WR-06 work — see `src/decisions/resolution.ts:153-159`:

```typescript
let parsed: unknown;
try {
  parsed = JSON.parse(cleaned);
} catch {
  logger.warn({ latencyMs: Date.now() - start }, 'resolution.classify.parse-error');
  return 'ambiguous';
}
```

The reviewer's IN-02 finding referenced line 149 (pre-WR-06 code). The current tree already emits a dedicated `resolution.classify.parse-error` log label distinct from the outer catch's `resolution.classify.error`, which is exactly what IN-02 recommended. Closed as stale-on-arrival relative to iteration-1 commits; no new commit.

### IN-03: getTemporalPensieve has no log indicator when 50-row cap is hit

**Files modified:** `src/pensieve/retrieve.ts`
**Commit:** `91c1e15` (iteration 2 — Info pass)
**Applied fix:** Extracted the hardcoded `50` into a named `TEMPORAL_PENSIEVE_LIMIT` constant and added a `logger.debug(...)` call emitting `pensieve.temporal.truncated` when `rows.length === TEMPORAL_PENSIEVE_LIMIT`. The log payload includes `centerDate` (ISO), `windowMs`, and the limit itself so operators can reproduce the query on a truncation event. Debug-level keeps normal-day logs quiet while making the truncation observable at info-level if an operator turns the logger up when debugging a specific resolution prompt.

JSDoc updated to document the cap explicitly and reference the truncation log event. No behavior change for the common case (<50 rows in window).

No new test added — this is pure observability (adds a log line under a specific condition); the happy-path behavior is unchanged and covered transitively by existing resolution tests that exercise `getTemporalPensieve` indirectly.

### IN-04: ACCOUNTABILITY case in buildSystemPrompt repurposes pensieveContext/relationalContext

**Files modified:** `src/chris/personality.ts`
**Commit:** `65db29a` (iteration 2 — Info pass)
**Applied fix:** Applied both reviewer recommendations as documentation-only changes:
1. Extended the function-level JSDoc on `buildSystemPrompt` with a dedicated IN-04 paragraph explaining that ACCOUNTABILITY mode overloads `pensieveContext` → `{decisionContext}` and `relationalContext` → `{pensieveContext}`. References the `resolution.ts` call site (~line 251) for grounding.
2. Added an in-situ comment inside the `case 'ACCOUNTABILITY':` block explaining the same overload and suggesting future readers promote to a typed overload rather than adding a fourth parameter if a third distinct context channel is ever needed.

Zero behavior change — the case body is byte-for-byte the same; only surrounding comments/JSDoc are added.

No new test required — documentation-only fix. No type signature changed so no mode-specific overload types needed to be introduced (reviewer flagged that as optional).

## Notes

**Iteration 2 two-pass structure:**
- **CR/WR pass** (earlier in iteration 2, commits `98201d4`, `d30fed8`, `365a759`, `eff346c`): fixed CR-01 + WR-01/02/03 and added 5 new regression tests.
- **Info pass** (this run, commits `3804778`, `91c1e15`, `65db29a`): cleared IN-01/03/04. IN-02 was already fixed pre-iteration by iteration-1 WR-06 work and required no new commit.

**Worktree state:** This worktree (`agent-a207f933`) sits on main after prior iteration-2 commits. Concurrent agents are touching other phase files — see the coordination warning in the fixer prompt — but the 4 files this Info pass modified (`resolution.ts`, `retrieve.ts`, `personality.ts`) were not touched by other agents during the run.

**Test gate:** All 5 test files exist in the worktree — none were lost to merge 5582442. 98 tests pass end-to-end against a real docker-compose postgres container. `npx tsc --noEmit` also clean across the full project.

**User preference honored:** Real Postgres Docker integration tests ran end-to-end for the verification. No mocked-DB substitutes.

**Coordination:** Info fixes were kept surgical — `resolution.ts` edit is import-only + two call-site replacements (fire-and-forget lambdas), `retrieve.ts` edit adds one constant + one debug log, `personality.ts` edit is pure comments. Merge-back conflict risk against Phases 13/14/15/17/18/19 is minimal.

---

_Fixed: 2026-04-17T05:50:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
