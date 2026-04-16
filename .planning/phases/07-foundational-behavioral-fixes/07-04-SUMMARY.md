---
phase: 07-foundational-behavioral-fixes
plan: "04"
subsystem: engine
tags: [refusal, language-detection, engine-pipeline, trust, TRUST-03, TRUST-04, LANG-01, LANG-02, LANG-03]
dependency_graph:
  requires: [07-02, 07-03]
  provides: [complete-refusal-language-pipeline]
  affects: [engine.ts, all-mode-handlers]
tech_stack:
  added: []
  patterns: [pre-processing-pipeline, early-return, session-state-injection]
key_files:
  created: []
  modified:
    - src/chris/engine.ts
    - src/chris/__tests__/engine-refusal.test.ts
    - src/chris/__tests__/engine.test.ts
decisions:
  - "Updated engine.test.ts handler assertions to use expect.any(String) and expect.any(Array) for the new language/declinedTopics params — preserves intent while accommodating signature change"
  - "Used vi.hoisted() for all mock variables referenced inside vi.mock() factories in engine-refusal.test.ts to satisfy vitest hoisting constraints"
metrics:
  duration: "~25 minutes"
  completed: "2026-04-13"
  tasks_completed: 2
  tasks_total: 2
requirements-completed: [TRUST-02, TRUST-03, LANG-01]
---

# Phase 07 Plan 04: Engine Pipeline Wiring Summary

Engine pipeline wired: refusal detection (early-return, no mode detection) + language detection (franc pre-processing) + session state (declinedTopics, language) flowing to all 7 mode handlers.

## What Was Built

### Task 1: Wire refusal + language into engine.ts + engine-refusal tests

**engine.ts changes:**
- Added imports for `detectRefusal`, `addDeclinedTopic`, `getDeclinedTopics`, `generateRefusalAcknowledgment` from `./refusal.js`
- Added imports for `detectLanguage`, `getLastUserLanguage`, `setLastUserLanguage` from `./language.js`
- After mute check: inserted refusal detection block — on match, detect language, add to session, save messages, return ack without calling `detectMode()`
- After refusal check: inserted language detection block — detect language, update session state, retrieve accumulated declined topics
- Updated all 7 handler calls in switch statement to pass `detectedLanguage` and `declinedTopics` as 3rd/4th args
- PHOTOS fallback path (no photos found) also passes `detectedLanguage` and `declinedTopics`

**engine-refusal.test.ts:** Replaced 2 placeholder `expect(true).toBe(true)` tests with 3 real integration tests:
1. `returns acknowledgment on refusal without calling detectMode` — verifies early-return path, no LLM call
2. `passes declinedTopics to handler after prior refusal` — verifies session state flows to Sonnet system prompt
3. `detects language and passes to handler` — verifies French detected and appears in Sonnet system prompt

Used `vi.hoisted()` for all mock variables referenced inside `vi.mock()` factories to satisfy vitest 4.x hoisting constraints.

**engine.test.ts:** Updated 5 handler call assertions (INTERROGATE, REFLECT, COACH, PSYCHOLOGY, PRODUCE) to accept `expect.any(String)` and `expect.any(Array)` for the new params — preserves test intent while accommodating the updated calling convention.

### Task 2: Full test suite validation

- `npx tsc --noEmit` — clean, zero errors
- `npm run test:unit` — 704 tests pass across 49 test files
  - 5 pre-existing failures require real env vars (ANTHROPIC_API_KEY, DB connection) — not caused by this plan
  - All 4 new test files green: refusal.test.ts, language.test.ts, personality.test.ts, engine-refusal.test.ts
- `npm test` (Docker integration) — Docker socket unavailable in parallel worktree environment; full Docker suite runs at orchestrator level after all wave-3 agents complete

## Pipeline Flow

Before this plan:
```
mute check → mode detection → route to handler → contradiction detection → save response
```

After this plan:
```
mute check → REFUSAL check (early return) → LANGUAGE detection → mode detection → route to handler(lang, declinedTopics) → contradiction detection → save response
```

## Commits

| Hash | Description |
|------|-------------|
| b877ce7 | feat(07-04): wire refusal + language detection into engine pipeline |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Vitest hoisting issue in engine-refusal.test.ts**
- **Found during:** Task 1 (test execution)
- **Issue:** `vi.mock()` factories are hoisted before `const` declarations, causing `ReferenceError: Cannot access 'mockCreate' before initialization` and similar for `mockInsert`/`mockSelect`
- **Fix:** Moved all mock variables referenced inside `vi.mock()` factories into a single `vi.hoisted(() => {...})` block, which runs before hoisted `vi.mock()` calls
- **Files modified:** `src/chris/__tests__/engine-refusal.test.ts`

**2. [Rule 1 - Bug] Missing logLevel in config mock**
- **Found during:** Task 1 (test execution)
- **Issue:** Config mock in engine-refusal.test.ts didn't include `logLevel`, causing pino logger to throw `Error: default level:undefined must be included in custom levels`
- **Fix:** Added `logLevel: 'silent'` to the config mock
- **Files modified:** `src/chris/__tests__/engine-refusal.test.ts`

**3. [Rule 1 - Bug] engine.test.ts handler assertions used 2-arg calling convention**
- **Found during:** Task 1 (running engine.test.ts after engine.ts changes)
- **Issue:** 5 existing tests asserted `mockHandleX.toHaveBeenCalledWith(CHAT_ID, text)` but handlers now receive 4 args
- **Fix:** Updated assertions to `toHaveBeenCalledWith(CHAT_ID, text, expect.any(String), expect.any(Array))`
- **Files modified:** `src/chris/__tests__/engine.test.ts`

## Known Stubs

None — all code paths are wired and tested.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. Declined topic injection into system prompts uses string concatenation (not template interpolation) as designed in T-07-06.

## Self-Check: PASSED

- `src/chris/engine.ts` exists with detectRefusal and detectLanguage imports: confirmed
- `src/chris/__tests__/engine-refusal.test.ts` exists with 3 real tests: confirmed
- Commit b877ce7 exists: confirmed
- 704 unit tests pass: confirmed
