---
phase: 14-capture-flow
plan: 05
subsystem: engine, bot
tags: [capture, trigger-detection, suppression, engine-wiring, grammy]

# Dependency graph
requires:
  - phase: 14-02
    provides: detectTriggerPhrase + classifyStakes from triggers.ts
  - phase: 14-03
    provides: addSuppression + isSuppressed from suppressions.ts
  - phase: 14-04
    provides: openCapture + handleCapture from capture.ts; getActiveDecisionCapture + clearCapture + isAbortPhrase from capture-state.ts
provides:
  - PP#0 active-capture pre-processor in engine.ts (SWEEP-03)
  - PP#1 trigger-detection pre-processor in engine.ts
  - /decisions suppress <phrase> bot command
  - abortAcknowledgment EN/FR/RU helper
affects: [phase-15-deadline-trigger, phase-16-resolution, phase-17-decisions-command]

# Tech tracking
tech-stack:
  added: []
  patterns: [engine-pre-processor-ordering, module-level-vi-mock-for-llm-tests]

key-files:
  created:
    - src/bot/handlers/decisions.ts
  modified:
    - src/chris/engine.ts
    - src/bot/bot.ts
    - src/decisions/__tests__/engine-capture.test.ts
    - src/chris/__tests__/engine.test.ts

key-decisions:
  - "PP#0 + PP#1 inserted at top of processMessage try-block, before mute/refusal/language/mode (D-24)"
  - "detectLanguage returns 'English'/'French'/'Russian' not 'en'/'fr'/'ru' -- mapped in PP#1 before openCapture"
  - "engine.test.ts needed module-level mocks for all four decisions/* imports to prevent DB calls in unit tests"
  - "engine-capture.test.ts restructured to use vi.mock at module level for LLM-calling modules to avoid ESM spy limitations"

patterns-established:
  - "Engine pre-processor chain: PP#0 (capture-state) -> PP#1 (trigger) -> mute -> refusal -> language -> mode"
  - "Module-level vi.mock for LLM modules in integration tests that exercise fall-through paths"

requirements-completed: [SWEEP-03, CAP-06]

# Metrics
duration: 43min
completed: 2026-04-16
---

# Phase 14 Plan 05: Engine + Bot Wiring Summary

**PP#0/PP#1 capture pre-processors wired into engine.ts before mute/refusal/language/mode; /decisions suppress command registered in bot.ts**

## What Was Done

### Task 1: PP#0 + PP#1 in engine.ts

Inserted two pre-processor blocks at the top of `processMessage()`'s try body, immediately before the existing `detectMuteIntent()` call:

- **PP#0 (active-capture check):** Queries `getActiveDecisionCapture(chatId)`. If active capture exists in a CAPTURING stage (DECISION/ALTERNATIVES/REASONING/PREDICTION/FALSIFICATION), routes to `handleCapture()` and returns. Abort phrases checked inside PP#0 per D-25 -- clears state and returns localized acknowledgment. AWAITING_RESOLUTION/AWAITING_POSTMORTEM stages fall through (Phase 16 will handle).

- **PP#1 (trigger detection):** Checks `isSuppressed()` before regex (D-17). If not suppressed, runs `detectTriggerPhrase()` then `classifyStakes()`. Only `structural` tier opens capture via `openCapture()`. Language detection via `franc` on the triggering message maps to `'en'|'fr'|'ru'` before locking into the draft.

- **abortAcknowledgment()** helper added with EN/FR/RU localization.

### Task 2: /decisions suppress command

- Created `src/bot/handlers/decisions.ts` with `handleDecisionsCommand`.
- Registered `bot.command('decisions', handleDecisionsCommand)` in `bot.ts` after `/sync` and before `message:text`.
- Phase 14 supports only `suppress <phrase>` sub-command. Other known sub-commands (open, recent, stats, reclassify) return localized "Coming in Phase 17." message.
- Input validation: empty phrase shows usage; >200 chars shows length error. Phrase scoped to `BigInt(ctx.chat.id)` (T-14-05-02).
- Language mapping: `getLastUserLanguage` returns 'English'/'French'/'Russian', handler maps to ISO codes.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed engine-capture.test.ts call signatures**
- **Found during:** Task 1
- **Issue:** Test called `processMessage(bigint, string, string)` but actual signature is `(bigint, number, string)`. Tests also used `{ mute: false }` instead of `{ muted: false }` for detectMuteIntent mock.
- **Fix:** Updated all test calls to `processMessage(chatId, 1, text)`. Fixed mock return shapes.
- **Files modified:** src/decisions/__tests__/engine-capture.test.ts
- **Commit:** ce21f7d

**2. [Rule 3 - Blocking] Restructured engine-capture.test.ts to use vi.mock**
- **Found during:** Task 1
- **Issue:** `vi.spyOn` on ESM module exports did not intercept internal calls for same-module functions (detectMode) or cross-module imports already bound at import time (handleJournal, detectMuteIntent). Tests 4 and 5 timed out making real LLM calls.
- **Fix:** Replaced `vi.spyOn` pattern with top-level `vi.mock()` for all LLM-calling modules (mute, journal, interrogate, reflect, coach, psychology, produce, photos, praise-quarantine, contradiction, llm/client).
- **Files modified:** src/decisions/__tests__/engine-capture.test.ts
- **Commit:** ce21f7d

**3. [Rule 3 - Blocking] Added capture/trigger module mocks to engine.test.ts**
- **Found during:** Task 2
- **Issue:** Existing engine.test.ts mock DB chain lacked `.limit()` method on the `where()` return, causing `getActiveDecisionCapture` to throw. Also needed mocks for suppressions.ts and triggers.ts.
- **Fix:** Added `vi.mock` for capture-state, capture, triggers, suppressions modules. Added `.limit` to mock select chain. Set defaults in both `beforeEach` blocks.
- **Files modified:** src/chris/__tests__/engine.test.ts
- **Commit:** 037f314

**4. [Rule 1 - Bug] Language detection return value mapping**
- **Found during:** Task 1
- **Issue:** `detectLanguage()` returns `'English'|'French'|'Russian'` (full names), not `'en'|'fr'|'ru'` ISO codes. Plan's PP#1 code compared against `'fr'`/`'ru'` ISO codes.
- **Fix:** Changed PP#1 comparison to `detected === 'French'` and `detected === 'Russian'` to match actual `detectLanguage` return values.
- **Files modified:** src/chris/engine.ts
- **Commit:** ce21f7d

## Test Results

- engine-capture.test.ts: 5/5 GREEN
- All decision tests (12 files): 120/120 GREEN
- engine.test.ts: 72/72 GREEN
- Combined decision + engine suite: 192/192 GREEN
- TypeScript: `npx tsc --noEmit` exits 0

## Known Stubs

None -- all wiring is live and functional.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | ce21f7d | PP#0 + PP#1 capture pre-processors in engine.ts |
| 2 | 037f314 | /decisions suppress command + engine test mock fixes |

## Self-Check: PASSED

All created files exist, all commit hashes verified in git log.
