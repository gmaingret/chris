---
phase: 16-resolution-post-mortem-accountability-mode
plan: "01"
subsystem: decisions/resolution
tags:
  - tdd
  - red-scaffolds
  - wave-0
  - resolution
  - post-mortem
  - sweep-escalation
dependency_graph:
  requires:
    - 13-schema-lifecycle-primitives
    - 14-capture-flow
    - 15-deadline-trigger-sweep-integration
  provides:
    - red-test-scaffolds-for-resolution-postmortem-sweep-escalation
  affects:
    - src/decisions/__tests__/resolution.test.ts
    - src/decisions/__tests__/engine-resolution.test.ts
    - src/proactive/__tests__/sweep-escalation.test.ts
tech_stack:
  added: []
  patterns:
    - vi.hoisted mocks for LLM client and bot API
    - real Docker Postgres via db/connection.js for DB-backed tests
    - @ts-expect-error on imports from non-existent modules (RED intent signal)
key_files:
  created:
    - src/decisions/__tests__/resolution.test.ts
    - src/decisions/__tests__/engine-resolution.test.ts
    - src/proactive/__tests__/sweep-escalation.test.ts
  modified: []
decisions:
  - "Wave 0 RED strategy: import non-existent module rather than it.fails() — entire suite fails at import boundary which is valid RED"
  - "sweep-escalation.test.ts imports escalation helpers from state.ts (to be added in Plan 04) rather than a new file"
metrics:
  duration_minutes: 10
  completed_date: "2026-04-16"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 16 Plan 01: RED Test Scaffolds — Resolution, Post-mortem, Sweep Escalation

Wave 0 RED scaffolds establishing the Nyquist validation floor for RES-02 through RES-06: 28 failing test stubs across 3 files covering `handleResolution`, `handlePostmortem`, `classifyOutcome`, `getTemporalPensieve`, PP#0 engine routing, and 48h sweep escalation.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Create resolution.test.ts RED scaffold | 1a2bf6d | src/decisions/__tests__/resolution.test.ts |
| 2 | Create engine-resolution.test.ts + sweep-escalation.test.ts RED scaffolds | da5051a | src/decisions/__tests__/engine-resolution.test.ts, src/proactive/__tests__/sweep-escalation.test.ts |

## Test Coverage (RED)

### resolution.test.ts — 16 failing stubs

**describe('handleResolution')** — 6 tests:
1. transitions decision from due to resolved
2. stores resolution text on the decision row
3. sets capture state to AWAITING_POSTMORTEM
4. writes two Pensieve entries with DECISION tag and sourceRefId
5. returns acknowledgment concatenated with post-mortem question
6. catches OptimisticConcurrencyError gracefully on concurrent transition

**describe('handlePostmortem')** — 5 tests:
7. stores resolution_notes on the decision row
8. transitions decision from resolved to reviewed
9. clears capture state
10. returns one-line acknowledgment in user language
11. writes Pensieve entry for post-mortem answer

**describe('classifyOutcome')** — 3 tests:
12. returns hit for confirmed prediction
13. returns miss for falsified prediction
14. falls back to ambiguous on parse failure

**describe('getTemporalPensieve')** — 2 tests:
15. returns entries within +/-48h window only
16. excludes soft-deleted entries

### engine-resolution.test.ts — 4 failing stubs

**describe('PP#0 resolution routing')** — 4 tests:
1. routes AWAITING_RESOLUTION message to handleResolution
2. routes AWAITING_POSTMORTEM message to handlePostmortem
3. skips abort-phrase check for AWAITING_RESOLUTION stage (draft={}, no language_at_capture)
4. falls through to normal mode when no active capture exists

### sweep-escalation.test.ts — 8 failing stubs

**describe('sweep escalation')** — 8 tests:
1. records first prompt timestamp in proactive_state
2. fires second prompt after 48h of no reply
3. transitions to stale after 2 non-replies
4. does not fire escalation within 48h window
5. second prompt text acknowledges follow-up context
6. stale transition is silent — no message sent to Telegram
7. escalation bypasses daily accountability cap
8. clearCapture called on stale transition

## Deviations from Plan

None — plan executed exactly as written.

All tests fail RED as required. Failure modes:
- `resolution.test.ts`: Cannot find module `../resolution.js` (Plan 03 will create it)
- `engine-resolution.test.ts`: Cannot find module `../resolution.js` (same)
- `sweep-escalation.test.ts`: Named exports `getEscalationSentAt`, `getEscalationCount`, etc. not found in `../state.js` (Plan 04 will add them)

## Known Stubs

None — this is a test-only plan. No production code was created or modified.

## Threat Flags

None — Wave 0 creates test files only; no production code, no attack surface introduced (T-16-00).

## Self-Check: PASSED

Files created:
- FOUND: src/decisions/__tests__/resolution.test.ts
- FOUND: src/decisions/__tests__/engine-resolution.test.ts
- FOUND: src/proactive/__tests__/sweep-escalation.test.ts

Commits verified:
- 1a2bf6d: test(16-01): add RED scaffold for resolution, postmortem, classifyOutcome, getTemporalPensieve
- da5051a: test(16-01): add RED scaffolds for engine routing and sweep escalation
