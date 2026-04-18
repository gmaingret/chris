---
phase: 15-deadline-trigger-sweep-integration
plan: "02"
subsystem: proactive
tags: [state, prompts, channel-aware, accountability, tdd]
dependency_graph:
  requires: []
  provides:
    - hasSentTodayReflective (with D-07 legacy fallback)
    - setLastSentReflective
    - hasSentTodayAccountability (no legacy fallback)
    - setLastSentAccountability
    - ACCOUNTABILITY_SYSTEM_PROMPT
  affects:
    - src/proactive/sweep.ts (Plan 03 consumes these helpers)
tech_stack:
  added: []
  patterns:
    - Channel-keyed KV state helpers — same proactiveState table, distinct keys per channel
    - Legacy fallback pattern — new key checked first, falls through to legacy key (D-07)
    - Neutral-factual accountability prompt — cites prediction verbatim, forbids both flattery and condemnation
key_files:
  created: []
  modified:
    - src/proactive/state.ts
    - src/proactive/prompts.ts
    - src/proactive/__tests__/state.test.ts
decisions:
  - "D-07 migration pattern: hasSentTodayReflective checks last_sent_reflective first, falls back to last_sent for zero-downtime migration from the legacy single-channel design"
  - "hasSentTodayAccountability has no legacy fallback — the accountability channel is new, no prior state to migrate"
  - "ACCOUNTABILITY_SYSTEM_PROMPT uses neutral-factual tone per D-12/D-25/D-27: outcome reported as data, never as praise or judgment of Greg as a person"
metrics:
  duration: "~10 minutes"
  completed: "2026-04-16T07:11:34Z"
  tasks_completed: 2
  files_modified: 3
---

# Phase 15 Plan 02: Channel-Aware State Helpers and Accountability Prompt Summary

Channel-aware `hasSentToday`/`setLastSent` helpers for reflective and accountability channels added to `state.ts`, with D-07 legacy fallback for the reflective channel; `ACCOUNTABILITY_SYSTEM_PROMPT` with neutral-factual tone (no flattery, no condemnation, prediction cited verbatim) added to `prompts.ts`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add channel-aware state helpers with legacy key fallback | 861c44e | src/proactive/state.ts, src/proactive/__tests__/state.test.ts |
| 2 | Add ACCOUNTABILITY_SYSTEM_PROMPT to prompts.ts | a5bc8e4 | src/proactive/prompts.ts |

## What Was Built

### Task 1: Channel-Aware State Helpers

Added two key constants and four exported functions to `src/proactive/state.ts`:

- `LAST_SENT_REFLECTIVE_KEY = 'last_sent_reflective'`
- `LAST_SENT_ACCOUNTABILITY_KEY = 'last_sent_accountability'`
- `hasSentTodayReflective(timezone)` — checks `last_sent_reflective`, falls back to `last_sent` (D-07 migration)
- `setLastSentReflective(timestamp)` — writes to `last_sent_reflective` key only
- `hasSentTodayAccountability(timezone)` — checks `last_sent_accountability` only (no fallback)
- `setLastSentAccountability(timestamp)` — writes to `last_sent_accountability` key only

All existing exports (`getLastSent`, `setLastSent`, `hasSentToday`, `getMuteUntil`, `setMuteUntil`, `isMuted`) are preserved and unchanged.

Tests follow TDD: 9 new test cases added to the `channel-aware state helpers` describe block in `state.test.ts`. All 23 tests pass (14 pre-existing + 9 new).

### Task 2: ACCOUNTABILITY_SYSTEM_PROMPT

Added `ACCOUNTABILITY_SYSTEM_PROMPT` export to `src/proactive/prompts.ts` with:
- `{triggerContext}` placeholder replaced at runtime with deadline trigger context
- Neutral-factual tone: reports outcome as data, no valence on Greg's judgment or identity
- Flattery guard: forbids "impressive", "good job", "well done", "you called it", "I knew you could"
- Condemnation guard: forbids "I'm disappointed", "you failed", "you were wrong about yourself"
- Disclosure guard: forbids mention of being automated, scheduled, or triggered
- Language rule: always matches Greg's most recent language
- 2-3 sentence maximum

## Verification

- `npx vitest run src/proactive/__tests__/state.test.ts`: 23/23 tests pass
- `grep "ACCOUNTABILITY_SYSTEM_PROMPT" src/proactive/prompts.ts`: export confirmed
- All 4 new state helper exports confirmed in state.ts

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The helpers are fully implemented with correct key routing. The prompt is complete with all required constraints. Neither file will be consumed until Plan 03 refactors sweep.ts, but the exports are complete.

## Threat Flags

None. Both changes use the existing proactiveState KV table (no new privilege surface). The accountability prompt is a server-side constant, not user-modifiable.

## Self-Check: PASSED

- `src/proactive/state.ts` contains all 4 new exports: confirmed
- `src/proactive/prompts.ts` exports `ACCOUNTABILITY_SYSTEM_PROMPT`: confirmed
- `src/proactive/__tests__/state.test.ts` contains 9 new channel-aware test cases: confirmed
- Commit 861c44e exists: confirmed
- Commit a5bc8e4 exists: confirmed
