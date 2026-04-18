---
phase: 07-foundational-behavioral-fixes
fix_applied: 2026-04-18T09:15:00Z
iteration: 1
fix_scope: critical_warning
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
files_reviewed_list:
  - src/chris/engine.ts
  - src/chris/language.ts
  - src/chris/personality.ts
  - src/chris/__tests__/engine.test.ts
  - src/chris/__tests__/engine-refusal.test.ts
---

# Phase 7: Code Review Fix Report

**Applied:** 2026-04-18T09:15:00Z
**Iteration:** 1 (fresh REVIEW.md dated 2026-04-18; prior iteration-2 report superseded)
**Scope:** critical_warning (4 findings — 2 Critical + 2 Warning; 5 Info items skipped by scope)
**Status:** all_fixed

## Summary

All 4 Critical + Warning findings from the 2026-04-18 `07-REVIEW.md` resolved
in 4 atomic commits. The v2.1 audit's "Cat A pre-existing" engine.test.ts
regression is reframed and fixed: it was a real regression introduced by
Phase 14's `getActiveDecisionCapture` using a `.where().limit()` chain the
unit-test mock didn't cover.

**Test evidence:** 126/126 pass on Docker Postgres gate across engine.test.ts
(72), engine-refusal.test.ts (3), personality.test.ts (41), language.test.ts
(10). Typecheck clean.

## Execution context note

The GSD `gsd-code-fixer` subagent was spawned per the workflow, but it hit an
Anthropic API rate limit after ~17 seconds / 9 tool uses before applying any
fixes or commits. The fixes below were therefore applied directly by the
orchestrator using the same tools and conventions the fixer agent would have
used (atomic commit per finding, test gate between commits, no `--no-verify`).

## Fixes Applied

### CR-02: Engine test mock chain + decision-capture mocks

**Commit:** `7791241` — `fix(07): CR-02 add missing .limit branch + decision-capture mocks to engine tests`

**Files:**
- `src/chris/__tests__/engine.test.ts` (+33 / -4)
- `src/chris/__tests__/engine-refusal.test.ts` (+28 / -1)

**What changed:**

1. **Mock select chain** — extended `mockSelectWhere` in both test files to return
   both `orderBy` and `limit` branches. The `select→from→where→orderBy→limit`
   chain (used by `conversation.ts`) and the `select→from→where→limit` chain
   (used by `decisions/capture-state.ts::getActiveDecisionCapture` per v2.1
   Phase 14) now both resolve through the mock.

2. **Decision-capture module mocks** — added `vi.mock()` blocks for the five
   decision modules `engine.ts` imports: `capture-state`, `capture`, `resolution`,
   `triggers`, `suppressions`. Default mocks return benign values (no active
   capture, no trigger match, not suppressed, `trivial` stakes) so PP#0/PP#1
   short-circuit to the original Phase 7 orchestration path.

3. **Contradiction TTL reset** — added `__resetSurfacedContradictionsForTests()`
   call to `processMessage (engine)` `beforeEach`. Two tests in that block
   reuse `entryId: 'old-entry-1'` and would otherwise see the second firing
   filtered out as already-surfaced. This latent test-isolation bug was
   previously masked by the mock-chain error causing the first test to fail
   before reaching `markSurfaced()`.

**Before:** 32 failures (29 in engine.test.ts, 3 in engine-refusal.test.ts).
**After:** 75/75 pass.

**Why this is a v2.1 regression, not pre-existing:** The v2.1 milestone audit
(`milestones/v2.1-MILESTONE-AUDIT.md`) categorizes 45 engine.test.ts failures
as "Cat A pre-existing baseline" and attributes them to a partial PP#0 restore
in commit `e4cb9da`. This code review shows the underlying cause was
different: v2.1 Phase 14 introduced a new DB call shape (`where → limit`) that
the pre-existing mocks didn't support. The v2.1 ship-gate's scoped 152-test
subset (`src/proactive/__tests__/` + `src/decisions/__tests__/synthetic-fixture.test.ts`)
masked the regression by excluding `src/chris/__tests__/engine*.test.ts`. Same
root cause would affect `engine-mute.test.ts` and `photos-memory.test.ts` —
out of scope for this Phase 7 fix, flagged for follow-up.

---

### CR-01: Align `detectLanguage` short-msg fallback to PLAN.md D021

**Commit:** `a1b75a5` — `fix(07): CR-01 restore English default for short-msg language fallback (D021)`

**File:** `src/chris/language.ts` (+8 / -9)

**What changed:**

Restored PLAN.md D021's "Default to English only if no prior user message
exists" behavior. Short-message fallback now returns `previousLanguage ??
'English'` instead of just `previousLanguage` (which could be `null`).
Return type tightened from `string | null` to `string` — all existing
callers (`engine.ts`, `decisions/resolution.ts`) already had `?? 'English'`
safety nets that are now redundant but harmless.

**Source-of-truth choice:** Option A from the review (align code to spec)
was selected over Option B (update spec + test). Rationale documented in the
commit message: the D021 default is deliberate protection against the
first-message mode handlers receiving `language=undefined` and never firing
the Language Directive. The multilingual-session concern raised by the removed
comment ("Salut" with no prior) is handled by franc on any message ≥4 words
or 15 chars — short-message fallback is specifically the no-signal case.

**Before:** `language.test.ts:32` "defaults to English when no previous
language and short msg" was red on HEAD.
**After:** 10/10 language tests pass. IN-04 (PLAN.md D021 doc drift) closes
automatically since code now matches spec.

---

### WR-01: Remove dead `userMessageSaved` flag

**Commit:** `02b3842` — `fix(07): WR-01 remove dead userMessageSaved flag`

**File:** `src/chris/engine.ts` (+3 / -5)

**What changed:**

Deleted `let userMessageSaved = false` and its three assignments (lines 288,
291, 322, 327). The variable was never read — pure scaffolding from an earlier
draft where the PHOTOS fallback was likely meant to guard a final
"save if not yet saved" step that was never implemented. Replaced with a
comment explaining the actual invariant (`mode !== 'PHOTOS'` guard prevents
double-saves in the PHOTOS fallback path).

**Before:** 4 assignments, 0 reads (dead code that hid intent).
**After:** clean; no-double-save invariant stated as a comment.

---

### WR-02: Localize `formatContradictionNotice` for EN/FR/RU

**Commit:** `41f047f` — `fix(07): WR-02 localize formatContradictionNotice for EN/FR/RU`

**File:** `src/chris/personality.ts` (+25 / -3)

**What changed:**

Added `NOTICE_TEMPLATES` object with English/French/Russian template functions
and `DATE_LOCALES` mapping for `toLocaleDateString`. The `_language` parameter
(underscore was signaling received-but-unused) is now `language` and actively
selects the template + date locale. Non-matching languages fall back to
English.

The per-contradiction `c.description` text still flows through verbatim
from the Haiku detector in whatever language the detection prompt emitted —
making the detector itself produce per-language descriptions is a deeper
change and flagged as potential follow-up rather than rolled in here.

**Before:** Russian session saw `"💡 I noticed something — back on March 15,
2025, you said..."` — English prose in a Russian conversation. Contradiction
detection (D006) is expected to fire often per PLAN.md, so this was not an
edge-case.
**After:** French → `"💡 Je remarque quelque chose — le 15 mars 2025..."`;
Russian → `"💡 Я кое-что заметил — 15 марта 2025 г. ты сказал..."`; English
template byte-identical to prior text so existing test assertions
(`engine.test.ts:196-202`) still pass.

---

## Skipped (out of scope — Info findings)

5 Info items not in scope per `fix_scope: critical_warning`:

- **IN-01** — `buildSystemPrompt` ACCOUNTABILITY parameter-slot overload is
  type-unsafe. Review notes "not urgent; comment is explicit." Fix would be
  discriminated-union overload; flagged for v2.2+.
- **IN-02** — Language directive stated twice when active. Review notes
  "none required — intentional redundancy per LANG-03."
- **IN-03** — `DETECTION_TIMEOUT_MS` / `QUARANTINE_TIMEOUT_MS` function-scoped.
  Readability nit; review did not mark actionable.
- **IN-04** — PLAN.md D021 doc drift. **Closed automatically by CR-01 fix**
  (code now matches spec wording).
- **IN-05** — `generateRefusalAcknowledgment` uses `Math.random()`. Review
  notes "none required."

## Recurring threads for follow-up (out of scope but flagged)

From the broader 7-phase code review (commit `16eca6b`), these findings are
connected to Phase 7's scope but sit in sibling files and were not addressed
here:

- **Identity-rename drift in internal Haiku prompts** —
  `src/llm/prompts.ts:228,261` (`CONTRADICTION_DETECTION_PROMPT`,
  `RELATIONAL_MEMORY_PROMPT`) still say "John" (Phase 11 WR-01).
  `src/chris/praise-quarantine.ts:16` still says "John" (Phase 09 WR-02).
  `RELATIONAL_MEMORY_PROMPT` output is persisted into `relational_memory.content`,
  giving "John" a quiet re-entry path into REFLECT/COACH/PSYCHOLOGY context.
- **Mock-chain drift affecting sibling files** — `engine-mute.test.ts` and
  `photos-memory.test.ts` have the same `.where().limit()` mock gap this fix
  addressed in `engine.test.ts` and `engine-refusal.test.ts`.

These are scoped for M008 or a dedicated cleanup phase, not this REVIEW-FIX.

---

_Fix applied: 2026-04-18T09:15:00Z_
_Applied by: Claude Opus 4.7 (1M context) via direct orchestrator edits after gsd-code-fixer subagent rate-limited_
_Scope: critical_warning (4 of 9 findings)_
_Status: all_fixed_
