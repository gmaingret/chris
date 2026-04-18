---
phase: 18-synthetic-fixture-live-accountability-integration-suite
plan: 02
subsystem: decisions/live-tests
tags: [live-integration, accountability, vague-validator, TEST-13, TEST-14]
requirements-completed: [TEST-13, TEST-14]

dependency-graph:
  requires:
    - src/decisions/resolution.ts (handleResolution)
    - src/decisions/vague-validator.ts (validateVagueness)
    - src/decisions/capture.ts (handleCapture)
    - src/decisions/capture-state.ts (upsertAwaitingResolution)
    - src/llm/client.ts (anthropic, HAIKU_MODEL)
    - src/chris/language.ts (setLastUserLanguage, clearLanguageState)
    - src/db/schema.ts (decisions, decisionEvents, decisionCaptureState)
  provides:
    - src/decisions/__tests__/live-accountability.test.ts
    - src/decisions/__tests__/vague-validator-live.test.ts
  affects:
    - TEST-13: ACCOUNTABILITY mode behavioral contract (flattery/condemnation axes)
    - TEST-14: vague-prediction Haiku prompt effectiveness across EN/FR/RU

tech-stack:
  added: []
  patterns:
    - describe.skipIf API-key guard (Phase 10 pattern)
    - 3-of-3 reliability loops inside single it() blocks
    - Haiku judge follow-up call for tone classification
    - FK-safe DB cleanup per iteration

key-files:
  created:
    - src/decisions/__tests__/live-accountability.test.ts
    - src/decisions/__tests__/vague-validator-live.test.ts
  modified: []

decisions:
  - validateVagueness is stateless; one-pushback contract enforced by handleCapture via capture_state (vague_validator_run + vague_pushback_fired flags)
  - cleanupIteration helper deletes telegram-source pensieve entries written by handleResolution fire-and-forget writes
  - ADVERSARIAL_PREDICTIONS covers 4 EN + 3 FR + 3 RU per D-11 requirement

metrics:
  duration: "~4 minutes"
  completed: "2026-04-16"
  tasks: 2
  files: 2
---

# Phase 18 Plan 02: Live ACCOUNTABILITY + Vague-Validator Integration Suite Summary

**One-liner:** Two API-key-gated live test files prove ACCOUNTABILITY mode tone is neutral (no flattery or condemnation) and the Haiku vague-prediction prompt catches hedged-confidence predictions across EN/FR/RU.

## What Was Built

### Task 1: `src/decisions/__tests__/live-accountability.test.ts` (TEST-13)

Live integration test suite proving ACCOUNTABILITY mode produces neither flattery nor condemnation on emotionally-weighted personal decisions. Guards against C7 sycophantic post-mortems.

**Structure:**
- `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` outer guard — API-key gated
- No `vi.mock` — real Anthropic API calls (Sonnet for ACCOUNTABILITY response, Haiku for tone judge)
- `classifyAccountabilityTone` Haiku judge: two-axis classification (flattery / condemnation, each `'none' | 'mild' | 'strong'`)
- 3 scenarios x 3-of-3 reliability loops:
  - **Scenario 1 (HIT):** Career-change prediction correctly called — 4 clients vs 3 predicted
  - **Scenario 2 (MISS):** Renovation timeline missed due to supply chain issues
  - **Scenario 3 (UNVERIFIABLE):** Team wiki adoption became untestable after team change
- Each iteration: seed `due` decision, `upsertAwaitingResolution`, call `handleResolution` (real Sonnet), run Haiku judge, assert `flattery === 'none'` AND `condemnation === 'none'`, cleanup
- FK-safe `cleanupIteration` helper handles: `decisionEvents`, `decisionCaptureState`, `decisions`, `pensieveEntries` (telegram source), `conversations`
- Timeout: 120,000ms per `it()` block (3 iterations x real API calls)
- 255 lines (> 120 required)

### Task 2: `src/decisions/__tests__/vague-validator-live.test.ts` (TEST-14)

Live test proving the Haiku vague-prediction validator prompt actually catches hedged-confidence predictions across Greg's three languages.

**Structure:**
- `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` outer guard
- No `vi.mock` for `llm/client` — real Haiku calls (per D-13)
- `vi.restoreAllMocks()` in `afterEach` (defensive per Research pitfall 5)
- `ADVERSARIAL_PREDICTIONS`: 10 entries (4 EN, 3 FR, 3 RU) using hedged-confidence style ("probably", "should", "likely", "sans doute", "скорее всего")
- **Test 1:** `flags >= 9 of 10 adversarial vague predictions on first pass` — calls `validateVagueness` on all 10 adversarial pairs, asserts `flaggedCount >= 9`; timeout: 120,000ms
- **Test 2:** One-pushback-then-accept via `handleCapture` — seeds capture state at FALSIFICATION stage, calls `handleCapture` twice with the same vague prediction, verifies `decisions` row created with `open` or `open-draft` status; timeout: 60,000ms
- Key insight: `validateVagueness` is stateless; the one-pushback contract is enforced by `handleCapture` via `vague_validator_run` + `vague_pushback_fired` in `capture_state`
- 172 lines (> 80 required)

## Verification

- `src/decisions/__tests__/live-accountability.test.ts` exists, 255 lines > 120 minimum
- `src/decisions/__tests__/vague-validator-live.test.ts` exists, 172 lines > 80 minimum
- Both files contain `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` — API-key gated
- Neither file contains `vi.mock('../../llm/client` — real API calls only
- `live-accountability.test.ts` has `classifyAccountabilityTone` with `flattery` and `condemnation` JSON fields in Haiku judge system prompt
- `live-accountability.test.ts` has 3 `it()` blocks with `for (let i = 0; i < 3; i++)` and assertions on both axes
- `vague-validator-live.test.ts` has `ADVERSARIAL_PREDICTIONS` with 10 entries (4 EN, 3 FR, 3 RU)
- `vague-validator-live.test.ts` has `expect(flaggedCount).toBeGreaterThanOrEqual(9)`
- `vague-validator-live.test.ts` has `vi.restoreAllMocks()` in `afterEach`
- Both files commit cleanly with no side effects on existing test files

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `1a52b74` | feat(18-02): live ACCOUNTABILITY integration suite (TEST-13) |
| Task 2 | `ab5e0a3` | feat(18-02): vague-prediction resistance live suite (TEST-14) |

## Deviations from Plan

**1. [Rule 1 - Bug] Removed invalid `decisionEvents` insert in seedDueDecision**
- **Found during:** Task 1 first test run
- **Issue:** `eventType: 'opened'` is not a valid value for the `decision_event_type` enum (valid: `created`, `status_changed`, `field_updated`, `classified`)
- **Fix:** Changed `eventType` to `'created'` in the seed helper
- **Files modified:** `src/decisions/__tests__/live-accountability.test.ts`
- **Commit:** 1a52b74

**2. [Rule 1 - Bug] Removed `source` field from decisions INSERT**
- **Found during:** Task 1 implementation
- **Issue:** The `decisions` table schema does not have a `source` column (it has `chatId` and `sourceRefId` but no `source`)
- **Fix:** Removed `source: TEST_SOURCE` from the `seedDueDecision` helper; cleanup uses `chatId`-scoped deletes instead
- **Files modified:** `src/decisions/__tests__/live-accountability.test.ts`
- **Commit:** 1a52b74

**3. [Rule 3 - Blocking] Git reset --soft left planning file deletions staged**
- **Found during:** Task 1 commit
- **Issue:** The worktree was based on main branch (`a14cd35`) not `4c156c3`. After `git reset --soft 4c156c3`, staged deletions of 192 planning files were accidentally included in the first commit attempt
- **Fix:** Hard reset to `4c156c3`, restored test files from backup, committed only the new test files
- **Commit:** Clean commits 1a52b74, ab5e0a3 (1 file each)

## Known Stubs

None — the test files are complete, behavioral contracts are fully specified, and the live tests are wired to real API calls.

## Threat Flags

None — the two new files are test-only and do not introduce new network endpoints, auth paths, or schema changes. API key handling follows the existing `describe.skipIf` pattern. No personal data in test fixtures.

## Self-Check: PASSED

- `src/decisions/__tests__/live-accountability.test.ts`: EXISTS (255 lines)
- `src/decisions/__tests__/vague-validator-live.test.ts`: EXISTS (172 lines)
- Commit `1a52b74`: EXISTS in git log
- Commit `ab5e0a3`: EXISTS in git log
- No `vi.mock` in either file: CONFIRMED
- `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` in both files: CONFIRMED
