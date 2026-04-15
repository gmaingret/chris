---
phase: 07-foundational-behavioral-fixes
fixed_at: 2026-04-14T00:00:00Z
review_path: .planning/phases/07-foundational-behavioral-fixes/07-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report

**Fixed at:** 2026-04-14
**Source review:** .planning/phases/07-foundational-behavioral-fixes/07-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: "Greg" vs "John" persona collision in the same system prompt

**Files modified:** `src/chris/personality.ts`, `src/chris/__tests__/personality.test.ts`, `src/chris/__tests__/engine.test.ts`, `src/chris/__tests__/journal.test.ts`
**Commit:** e3afdec
**Applied fix:** Renamed every user-facing "Greg" reference inside `personality.ts` (constitutional preamble, `DeclinedTopic` JSDoc, `buildKnownFactsBlock` header, declined-topics injection) to "John" so the assembled system prompt uses a single consistent persona name, aligning with `prompts.ts`. Updated three test files that assert on the "Known Facts About Greg" header string so they now assert against "Known Facts About John".

### WR-01: Refusal pattern "not now" has high false-positive rate

**Files modified:** `src/chris/refusal.ts`
**Commit:** 356d598
**Applied fix:** Replaced the loose `.*\bnot\s+(?:now|today|right\s+now)\b` pattern (which matched the phrase anywhere in the message) with a tight standalone form `^\s*not\s+(?:now|today|right\s+now)\s*[.!?]?\s*$` that only fires when the entire message is the phrase (optionally with terminal punctuation). Verified via a script-level regex test against the reviewer's listed false-positive examples ("That's not what I wanted today", "Not today, but maybe tomorrow", "I'm not ready now but I will be", "It's not that hot right now") — all now return false while legitimate standalone replies ("not now", "Not today.", "not right now") still match.

### WR-02: `resultCount` computed from newline count, not actual result count

**Files modified:** `src/chris/modes/interrogate.ts`, `src/chris/modes/reflect.ts`, `src/chris/modes/coach.ts`, `src/chris/modes/psychology.ts`, `src/chris/modes/produce.ts`
**Commit:** 216f4d2
**Applied fix:** Changed `resultCount` in all five mode handlers from `pensieveContext === '' ? 0 : pensieveContext.split('\n').length` to `searchResults.length`. This now reports the true count of search results regardless of whether entries contain embedded newlines in their content. The downstream `if (resultCount === 0)` empty-log branch continues to work correctly because an empty results array produces length 0.

### WR-03: Stale comment says "6-mode classification" but 7 modes exist

**Files modified:** `src/chris/engine.ts`
**Commit:** 97ffc28
**Applied fix:** Updated the JSDoc on `detectMode` from "Classify a message into one of 6 Chris modes using Haiku." to "Classify a message into one of 7 Chris modes using Haiku." to match the `VALID_MODES` set (7 entries) and the `MODE_DETECTION_PROMPT` (7 modes including PHOTOS).

---

_Fixed: 2026-04-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
