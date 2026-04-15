---
phase: 07-foundational-behavioral-fixes
fixed_at: 2026-04-14T00:00:00Z
review_path: .planning/phases/07-foundational-behavioral-fixes/07-REVIEW.md
iteration: 2
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 7: Code Review Fix Report (Iteration 2)

**Fixed at:** 2026-04-14
**Source review:** .planning/phases/07-foundational-behavioral-fixes/07-REVIEW.md
**Iteration:** 2

**Summary (iteration 2):**
- Findings in scope: 2 (CR-01, WR-01)
- Fixed: 2
- Skipped: 0

## Fixed Issues (Iteration 2)

### CR-01: Engine drops `language` and `declinedTopics` for 6 of 7 modes

**Files modified:** `src/chris/engine.ts`, `src/chris/__tests__/engine.test.ts`
**Commit:** c72ef58
**Applied fix:** Updated `processMessage` in `engine.ts` to forward the computed `language` and `declinedTopics` values as the 3rd and 4th arguments to every non-JOURNAL handler (`handleInterrogate`, `handleReflect`, `handleCoach`, `handlePsychology`, `handleProduce`, `handlePhotos`) and to the `handleJournal` fallback inside the `PHOTOS` no-photos-found branch. All handler signatures already declared the optional parameters (`language?: string`, `declinedTopics?: DeclinedTopic[]`), so this is a pure call-site change — no handler signatures needed modification. Updated the five routing tests in `engine.test.ts` (INTERROGATE, REFLECT, COACH, PSYCHOLOGY, PRODUCE) so each `toHaveBeenCalledWith` assertion now expects four args (`CHAT_ID`, `<text>`, `expect.any(String)`, `expect.any(Array)`) matching the fixed engine contract. Flagged as `fixed: requires human verification` because the primary behavioral payoff (language directive + declined-topics injection appearing in the system prompt of non-JOURNAL modes) is semantic and was not asserted end-to-end in this commit; reviewer recommended adding integration tests that verify declined topics set during JOURNAL reappear in subsequent INTERROGATE/COACH/etc. system prompts — those should be added in a follow-up once live validation confirms the behavior.

**Status note:** fixed — requires human verification (logic/behavioral change, only syntactically verified).

### WR-01: `MODE_DETECTION_PROMPT` header still says "6 modes" but lists 7

**Files modified:** `src/llm/prompts.ts`
**Commit:** e38625d
**Applied fix:** Updated both the JSDoc comment (`6-mode classification` → `7-mode classification`) and the first line of the `MODE_DETECTION_PROMPT` template string (`these 6 modes` → `these 7 modes`) in `src/llm/prompts.ts`. The prompt then continues to enumerate seven modes (JOURNAL, INTERROGATE, REFLECT, COACH, PSYCHOLOGY, PRODUCE, PHOTOS), so the header count now agrees with the enumerated list and decision tree. This removes the contradictory "count 6, options 7" signal that could bias Haiku away from the seventh mode (PHOTOS).

---

## Prior Iteration

Iteration 1 fixed CR-01 (Greg/John persona collision), WR-01 (loose "not now" pattern), WR-02 (resultCount from newline count), and WR-03 (stale "6-mode" JSDoc in engine.ts) across commits e3afdec, 356d598, 216f4d2, 97ffc28. See git log for details; the iteration-1 summary was previously captured in this file before being overwritten by iteration 2.

---

_Fixed: 2026-04-14_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
