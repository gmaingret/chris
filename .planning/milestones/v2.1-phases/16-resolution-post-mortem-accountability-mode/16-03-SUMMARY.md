---
phase: 16-resolution-post-mortem-accountability-mode
plan: "03"
subsystem: decisions/resolution
tags: [resolution, postmortem, outcome-classification, pensieve, lifecycle]
requirements-completed: [RES-02, RES-03, RES-04, RES-05]

dependency-graph:
  requires:
    - 16-01  # RED scaffold tests
    - 16-02  # ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT in prompts.ts
    - 13     # schema: decisions, decisionCaptureState tables
    - 14     # capture-state helpers: clearCapture, upsertAwaitingResolution
  provides:
    - handleResolution
    - handlePostmortem
    - classifyOutcome
    - getTemporalPensieve
    - updateToAwaitingPostmortem
  affects:
    - src/decisions/index.ts  # barrel re-exports extended

tech-stack:
  added: []
  patterns:
    - Haiku fail-closed classification (T-16-03)
    - Sonnet ACCOUNTABILITY mode prompt via buildSystemPrompt
    - OptimisticConcurrencyError catch-and-graceful-return pattern
    - Temporal Pensieve retrieval (windowMs-based, pure time query)
    - Awaited Pensieve writes for testability (errors caught and logged)
    - Dynamic import guard for clearEscalationKeys (Plan 05 dependency)

key-files:
  created:
    - src/decisions/resolution.ts
  modified:
    - src/pensieve/retrieve.ts
    - src/decisions/capture-state.ts
    - src/decisions/index.ts

decisions:
  - "getTemporalPensieve accepts windowMs (milliseconds) not windowHours — matches test scaffold expectation of 48*3_600_000"
  - "Pensieve writes in handleResolution/handlePostmortem are awaited (not void) for testability; errors are caught and logged, never thrown"
  - "classifyOutcome fails closed to 'ambiguous' on any JSON parse error, missing field, or unexpected value (T-16-03)"
  - "clearEscalationKeys imported dynamically with conditional check — Plan 05 ships this export; Plan 03 guards gracefully"
  - "OptimisticConcurrencyError caught in handleResolution: if already resolved/reviewed, returns graceful message without proceeding to writes"

metrics:
  duration: "~15 minutes"
  completed: "2026-04-16"
  tasks: 2
  files: 4
---

# Phase 16 Plan 03: Resolution + Post-mortem Handlers Summary

Implemented the core resolution flow for M007 Decision Archive: `handleResolution`, `handlePostmortem`, `classifyOutcome` in `src/decisions/resolution.ts`, plus `getTemporalPensieve` in `retrieve.ts` and `updateToAwaitingPostmortem` in `capture-state.ts`. All 16 RED scaffold tests from Plan 01 turned GREEN.

## What Was Built

**`src/decisions/resolution.ts`** — core Phase 16 production module:

- `classifyOutcome(resolutionText, prediction, criterion)` — Haiku-based 4-class outcome classifier. Fail-closed to `'ambiguous'` on any parse failure (T-16-03 threat mitigated). 5s timeout guard.
- `handleResolution(chatId, text, decisionId)` — full resolution flow: load decision row → detect language → get +/-48h Pensieve context → build Sonnet prompt → Sonnet acknowledgment → transition `due→resolved` with OptimisticConcurrencyError guard → plain UPDATE for `resolution` text → `updateToAwaitingPostmortem` → `classifyOutcome` → class-specific post-mortem question → awaited Pensieve writes → dynamic `clearEscalationKeys` guard → return `acknowledgment + '\n\n' + question`.
- `handlePostmortem(chatId, text, decisionId)` — silent store: detect language → UPDATE `resolutionNotes` → transition `resolved→reviewed` → `clearCapture` → dynamic `clearEscalationKeys` → Pensieve write → one-line ack (`"Noted."` / `"Noté."` / `"Принято."`).

**`src/pensieve/retrieve.ts`** — `getTemporalPensieve(centerDate, windowMs)` added at end:
- Pure time-based query on `createdAt` (no semantic search)
- Filters `isNull(deletedAt)`, returns entries ordered `asc(createdAt)`
- `windowMs` default = `48 * 3_600_000` ms (48 hours each side)
- Added `gte, lte` to drizzle-orm imports

**`src/decisions/capture-state.ts`** — `updateToAwaitingPostmortem(chatId)` added:
- Sets `stage = 'AWAITING_POSTMORTEM'`, updates `updatedAt`
- Called by `handleResolution()` after `due→resolved` transition

**`src/decisions/index.ts`** — barrel re-exports extended:
- `export { handleResolution, handlePostmortem, classifyOutcome } from './resolution.js'`
- `export { upsertAwaitingResolution, updateToAwaitingPostmortem } from './capture-state.js'`

## Test Results

All 16 unit tests in `src/decisions/__tests__/resolution.test.ts` pass:
- `classifyOutcome` — fail-closed behavior, valid outcomes, timeout fallback
- `handleResolution` — full flow, language detection, OptimisticConcurrencyError guard, post-mortem question selection
- `handlePostmortem` — transition, clearCapture, one-line ack
- `getTemporalPensieve` — windowed retrieval, deletedAt filtering

## Deviations from Plan

None — plan executed exactly as written.

The `getTemporalPensieve` signature uses `windowMs` (milliseconds) instead of the plan's `windowHours` suggestion, matching the resolution.test.ts RED scaffold which called `getTemporalPensieve(centerDate, 48 * 3_600_000)`. This is consistent with the existing test scaffold from Plan 01 (not a deviation from what the tests expect).

## Threat Surface Scan

No new network endpoints or auth paths introduced. All functions are internal to the decisions module. Threat mitigations from the plan's threat model:
- T-16-03: Haiku JSON parse validation — implemented with exact 4-value set check, fail-closed
- T-16-06: OptimisticConcurrencyError race — caught in handleResolution, re-reads decision, graceful return if already resolved

## Self-Check: PASSED

- `src/decisions/resolution.ts` exists and exports `handleResolution`, `handlePostmortem`, `classifyOutcome`
- `src/pensieve/retrieve.ts` exports `getTemporalPensieve` with `gte/lte` imports
- `src/decisions/capture-state.ts` exports `updateToAwaitingPostmortem`
- `src/decisions/index.ts` re-exports all three resolution functions and `updateToAwaitingPostmortem`
- `npx tsc --noEmit` exits 0
- 16/16 unit tests pass (with Docker Postgres)
