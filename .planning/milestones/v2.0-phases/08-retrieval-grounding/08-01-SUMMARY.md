---
phase: 08-retrieval-grounding
plan: 01
subsystem: llm
tags: [retrieval, grounding, pensieve, prompts, ground-truth, tdd]

# Dependency graph
requires:
  - phase: 07-foundational-behavioral-fixes
    provides: constitutional preamble, buildSystemPrompt with language/declined-topics injection
  - phase: 06-memory-audit
    provides: GROUND_TRUTH array with 13 verified entries in ground-truth.ts

provides:
  - JOURNAL_SEARCH_OPTIONS preset (FACT/RELATIONSHIP/PREFERENCE/VALUE tags, recencyBias 0.3, limit 10)
  - JOURNAL_SYSTEM_PROMPT with {pensieveContext} placeholder and hallucination resistance instruction
  - buildKnownFactsBlock() rendering all 13 GROUND_TRUTH entries as structured key-value block
  - buildSystemPrompt JOURNAL case replaces {pensieveContext} (matches INTERROGATE pattern)
  - Known Facts block injected into JOURNAL and INTERROGATE system prompts, before language directive

affects:
  - 08-02 (JOURNAL handler wiring — uses JOURNAL_SEARCH_OPTIONS and the updated buildSystemPrompt)
  - live integration tests (TRUST-07 — structured fact retrieval accuracy)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Structured fact injection: GROUND_TRUTH rendered as key-value block separate from narrative pensieveContext"
    - "TDD red-green cycle: failing tests committed before implementation"
    - "Mode-selective injection: Known Facts only for JOURNAL and INTERROGATE, not REFLECT/COACH/PSYCHOLOGY/PRODUCE"

key-files:
  created: []
  modified:
    - src/pensieve/retrieve.ts
    - src/llm/prompts.ts
    - src/chris/personality.ts
    - src/pensieve/__tests__/retrieve.test.ts
    - src/chris/__tests__/personality.test.ts

key-decisions:
  - "JOURNAL_SEARCH_OPTIONS tags: FACT/RELATIONSHIP/PREFERENCE/VALUE per D-01/RETR-01"
  - "Known Facts block injected after modeBody but before language/declined-topics directives (D-05)"
  - "JOURNAL {pensieveContext} replacement matches INTERROGATE pattern exactly (D-03)"
  - "Hallucination resistance wording aligns with INTERROGATE existing line 44 language (D-09)"

patterns-established:
  - "Structured facts block: ## Known Facts About Greg with key: value lines, category-ordered"
  - "buildKnownFactsBlock is a private helper — not exported, consumed only by buildSystemPrompt"

requirements-completed: [RETR-01, RETR-02, RETR-04]

# Metrics
duration: 12min
completed: 2026-04-13
---

# Phase 08 Plan 01: Retrieval Grounding Foundations Summary

**JOURNAL_SEARCH_OPTIONS preset, {pensieveContext} placeholder in JOURNAL prompt, and Known Facts block injection into JOURNAL/INTERROGATE system prompts — all with TDD coverage**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-13T12:21:00Z
- **Completed:** 2026-04-13T12:23:30Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `JOURNAL_SEARCH_OPTIONS` preset with tags `['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE']`, `recencyBias: 0.3`, `limit: 10` — no `minScore`
- Updated `JOURNAL_SYSTEM_PROMPT` to include `## Memory Entries\n{pensieveContext}` section and hallucination resistance instruction matching INTERROGATE's wording
- Added `buildKnownFactsBlock()` to `personality.ts` rendering all 13 `GROUND_TRUTH` entries in structured key-value form, category-ordered
- `buildSystemPrompt('JOURNAL', ...)` now replaces `{pensieveContext}` with context value (or fallback), matching INTERROGATE
- Known Facts block injected after modeBody for JOURNAL and INTERROGATE only — before language directive and declined-topics sections
- 6 new tests in `retrieve.test.ts` + 9 new tests in `personality.test.ts` — all green, no regressions

## Task Commits

1. **Task 1: JOURNAL_SEARCH_OPTIONS preset + JOURNAL_SYSTEM_PROMPT update** - `1e84c49` (feat)
2. **Task 2: buildKnownFactsBlock + JOURNAL/INTERROGATE Known Facts injection** - `a96c30b` (feat)

## Files Created/Modified
- `src/pensieve/retrieve.ts` — Added `JOURNAL_SEARCH_OPTIONS` preset after `CONTRADICTION_SEARCH_OPTIONS`
- `src/llm/prompts.ts` — Added `## Memory Entries\n{pensieveContext}` section and hallucination resistance rule to `JOURNAL_SYSTEM_PROMPT`
- `src/chris/personality.ts` — Added `GROUND_TRUTH` import, `buildKnownFactsBlock()` helper, JOURNAL `.replace('{pensieveContext}', contextValue)`, Known Facts injection block
- `src/pensieve/__tests__/retrieve.test.ts` — Added `JOURNAL_SEARCH_OPTIONS` to import, added 6 new tests for preset and JOURNAL_SYSTEM_PROMPT
- `src/chris/__tests__/personality.test.ts` — Added 9 new tests covering RETR-01, RETR-02, RETR-04

## Decisions Made
- Known Facts placed after mode body but before language/declined-topics directives so grounding facts are always visible to the model before any formatting overrides
- Hallucination resistance instruction wording exactly mirrors INTERROGATE prompt line 44 for consistency (D-09)
- `buildKnownFactsBlock` is not exported — it is a private implementation detail of `buildSystemPrompt`

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None. The 5 pre-existing infrastructure test file failures (missing env vars / DB connection) are unrelated to this plan and were present before execution.

## Known Stubs
None — all data flows are wired. `buildKnownFactsBlock` reads live `GROUND_TRUTH` array. `{pensieveContext}` is replaced at call time in both JOURNAL and INTERROGATE cases.

## Next Phase Readiness
- Plan 02 can now wire `JOURNAL_SEARCH_OPTIONS` into the JOURNAL handler and call `buildSystemPrompt('JOURNAL', pensieveContext)` to get the full grounded prompt
- `buildSystemPrompt` contract is unchanged — callers pass `pensieveContext` as second argument; JOURNAL now uses it exactly as INTERROGATE already did

---
*Phase: 08-retrieval-grounding*
*Completed: 2026-04-13*
