---
phase: 14-capture-flow
plan: 02
subsystem: decisions
tags: [regex, haiku, triggers, stakes-classifier, bilingual, en-fr-ru]

requires:
  - phase: 14-capture-flow/01
    provides: "decision tables, lifecycle chokepoint, trigger fixtures, STAKES_CLASSIFICATION_PROMPT"
provides:
  - "detectTriggerPhrase(text) -> string|null for EN/FR/RU trigger regex"
  - "detectTriggerPhraseDetailed(text) -> TriggerMatch|null with language + topic"
  - "classifyStakes(text) -> Promise<StakesTier> via Haiku with fail-closed default"
  - "callLLM(systemPrompt, userText, maxTokens) wrapper in src/llm/client.ts"
affects: [14-capture-flow/03, 14-capture-flow/04, 14-capture-flow/05]

tech-stack:
  added: []
  patterns:
    - "callLLM wrapper for Haiku structured-output calls with cache_control ephemeral"
    - "Top-level vi.mock with mutable vi.fn for per-test mock behavior"
    - "Non-ASCII regex guards: drop \\b for FR/RU, use \\S* for suffix-flexible Cyrillic matching"

key-files:
  created:
    - src/decisions/triggers.ts
  modified:
    - src/decisions/index.ts
    - src/llm/client.ts
    - src/decisions/__tests__/triggers.test.ts

key-decisions:
  - "callLLM wrapper added to src/llm/client.ts to enable clean test mocking of Haiku calls"
  - "detectTriggerPhrase returns string|null (canonical phrase) matching test contract; detectTriggerPhraseDetailed returns full TriggerMatch for downstream use"
  - "\\b word boundaries removed from FR/RU regex lookaheads because JS regex \\b only works with ASCII"
  - "'not' guard removed from EN 'I'm not sure whether' pattern since 'not' is integral to the trigger phrase"

patterns-established:
  - "callLLM: lightweight Haiku wrapper extracting text block, callers handle JSON parsing and timeout"
  - "TriggerPatternEntry: [RegExp, groupIdx|null, canonicalPhrase] triple for trigger patterns"
  - "Mutable vi.fn mock pattern for per-test callLLM behavior in vitest"

requirements-completed: [CAP-01]

duration: 21min
completed: 2026-04-16
---

# Phase 14 Plan 02: CAP-01 Trigger Detection + Stakes Classifier Summary

**Bilingual EN/FR/RU trigger regex with negative-lookahead meta-guards + Haiku stakes classifier fail-closed to trivial on timeout/error**

## Performance

- **Duration:** 21 min
- **Started:** 2026-04-16T04:19:18Z
- **Completed:** 2026-04-16T04:40:29Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Phase A regex: 4 EN + 4 FR + 4 RU trigger patterns with D-03 parity assertion at import time
- Negative lookahead guards reject meta-references, negations, past-tense reports (D-02)
- Phase B Haiku stakes classifier with 3s hard timeout and fail-closed to trivial (D-06/D-08)
- callLLM wrapper in src/llm/client.ts enables clean test mocking across all decision test suites
- All 10 triggers.test.ts cases GREEN

## Task Commits

Each task was committed atomically:

1. **Task 1+2: detectTriggerPhrase + classifyStakes** - `430d05e` (feat)

**Plan metadata:** pending (docs: complete plan)

_Note: Both tasks share a single test file and implementation module; committed together after both turned GREEN._

## Files Created/Modified

- `src/decisions/triggers.ts` - Phase A regex patterns (EN/FR/RU) + Phase B Haiku stakes classifier + D-03 parity guard
- `src/decisions/index.ts` - Barrel exports for detectTriggerPhrase, classifyStakes, TriggerMatch, StakesTier
- `src/llm/client.ts` - callLLM wrapper for Haiku structured-output calls with cache_control ephemeral
- `src/decisions/__tests__/triggers.test.ts` - Fixed vi.mock hoisting: top-level mock with mutable mockCallLLM.mockImplementation per test

## Decisions Made

- **callLLM wrapper:** Tests mock `callLLM` from `../../llm/client.js`, so added a callLLM function that wraps `anthropic.messages.create` with text extraction. This is reused by capture.test.ts, resolve-by.test.ts, and vague-validator.test.ts.
- **Return type:** `detectTriggerPhrase` returns `string|null` (canonical phrase) per test contract. Added `detectTriggerPhraseDetailed` returning full `TriggerMatch` with language + topic for downstream capture flow.
- **Non-ASCII word boundaries:** Dropped `\b` from FR/RU lookaheads because JS regex `\b` only handles ASCII. Used `\S*` for Cyrillic suffix-flexible matching (e.g., `сказал\S*` matches both `сказал` and `сказала`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added callLLM wrapper to src/llm/client.ts**
- **Found during:** Task 1 (analyzing test expectations)
- **Issue:** Tests mock `callLLM` from `../../llm/client.js` but no such export existed
- **Fix:** Added callLLM function that wraps anthropic.messages.create with text block extraction
- **Files modified:** src/llm/client.ts
- **Verification:** All classifyStakes tests pass with mocked callLLM
- **Committed in:** 430d05e

**2. [Rule 1 - Bug] Fixed vi.mock hoisting in triggers.test.ts**
- **Found during:** Task 2 (classifyStakes tests failing)
- **Issue:** Three nested `vi.mock('../../llm/client.js', ...)` calls inside `it()` blocks were hoisted and the last factory won for all tests
- **Fix:** Restructured to single top-level `vi.mock` with mutable `mockCallLLM = vi.fn()`, using `mockCallLLM.mockImplementation()` per test
- **Files modified:** src/decisions/__tests__/triggers.test.ts
- **Verification:** All 3 classifyStakes tests now run independently and pass
- **Committed in:** 430d05e

**3. [Rule 1 - Bug] Fixed non-ASCII word boundary in FR/RU regex patterns**
- **Found during:** Task 1 (FR/RU negative tests failing)
- **Issue:** `\b` in JS regex only works with ASCII characters; FR accented chars and Cyrillic chars are `\W`, so `\b` boundaries didn't match correctly. `сказала` didn't match `\bсказал\b`, `мне` triggered false positive on `\bне\b`.
- **Fix:** Dropped `\b` from FR/RU lookaheads; used `\S*` for Cyrillic suffix matching; used `(?:^|\s)не\s` for standalone Russian negation
- **Files modified:** src/decisions/triggers.ts
- **Verification:** All EN/FR/RU positive and negative fixture tests pass
- **Committed in:** 430d05e

**4. [Rule 1 - Bug] Removed 'not' from EN 4th pattern lookahead**
- **Found during:** Task 1 (EN positive test failing for "I'm not sure whether")
- **Issue:** Negative lookahead `(?!.*\bnot\b)` rejected "I'm not sure whether I should propose" because `not` appears in the trigger phrase itself
- **Fix:** Removed `not` and `don't` from the 4th EN pattern's lookahead; kept `told/said/mentioned/explained` guards
- **Files modified:** src/decisions/triggers.ts
- **Verification:** EN positive "I'm not sure whether" matches; EN negative "I'm not thinking about dinner" still rejected by first pattern
- **Committed in:** 430d05e

---

**Total deviations:** 4 auto-fixed (3 bug fixes, 1 blocking)
**Impact on plan:** All fixes necessary for correctness. No scope creep.

## Issues Encountered

None beyond the deviations documented above.

## Known Stubs

None -- all functions are fully implemented with real logic.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `detectTriggerPhrase` and `classifyStakes` are exported from `src/decisions/index.ts` and ready for engine pre-processor wiring (Plan 04/05)
- `callLLM` wrapper available for capture extractor and vague validator (Plans 03+)
- `detectTriggerPhraseDetailed` provides language + topic for `language_at_capture` (D-22) in capture flow

## Self-Check: PASSED

---
*Phase: 14-capture-flow*
*Completed: 2026-04-16*
