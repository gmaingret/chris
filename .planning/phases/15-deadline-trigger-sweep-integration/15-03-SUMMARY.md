---
phase: 15-deadline-trigger-sweep-integration
plan: "03"
subsystem: proactive-sweep
tags: [dual-channel, sweep, accountability, deadline-trigger, tdd]
requirements-completed: [SWEEP-01, SWEEP-02, SWEEP-04]

dependency-graph:
  requires:
    - 15-01  # deadline trigger (createDeadlineTrigger, TriggerResult with evidence[0] = 'Decision ID: <uuid>')
    - 15-02  # channel-aware state helpers + ACCOUNTABILITY_SYSTEM_PROMPT
  provides:
    - dual-channel runSweep with independent accountability + reflective caps
    - upsertAwaitingResolution helper for Phase 16 PP#0 routing
  affects:
    - src/proactive/sweep.ts (full refactor)
    - src/decisions/capture-state.ts (new upsertAwaitingResolution export)
    - src/proactive/__tests__/sweep.test.ts (29 tests, vi.resetAllMocks migration)

tech-stack:
  added: []
  patterns:
    - dual-channel sweep with independent daily caps per channel
    - error isolation: accountability channel errors never block reflective channel
    - vi.resetAllMocks() over vi.clearAllMocks() to prevent mockResolvedValueOnce queue leakage

key-files:
  created: []
  modified:
    - src/proactive/sweep.ts
    - src/proactive/__tests__/sweep.test.ts
    - src/decisions/capture-state.ts
    - src/decisions/__tests__/capture-state.test.ts

decisions:
  - "Propagate reflectiveSkippedReason from reflective channel inner logic to outer result assembly — the old single-channel code returned early with skippedReason; dual-channel code must store and propagate it"
  - "vi.resetAllMocks() required in beforeEach (not clearAllMocks) — vi.clearAllMocks() clears call history but NOT mockResolvedValueOnce queues; unconsumed Once entries from one test leak into the next"
  - "runReflectiveChannel extracted as a private helper function — removes duplication between SQL-trigger and Opus-trigger paths, both of which need the same winner-selection → LLM → send → setLastSentReflective flow"

metrics:
  duration: "~35 minutes"
  completed: "2026-04-16"
  tasks-completed: 2
  files-modified: 4
---

# Phase 15 Plan 03: Dual-Channel Sweep Integration Summary

Dual-channel `runSweep()` wired: accountability fires first with its own daily cap, writes `AWAITING_RESOLUTION` before sending, uses `ACCOUNTABILITY_SYSTEM_PROMPT`; reflective pipeline is unchanged and runs independently.

## What Was Built

### Task 1: upsertAwaitingResolution helper

Added `upsertAwaitingResolution(chatId: bigint, decisionId: string): Promise<void>` to `src/decisions/capture-state.ts`. Uses `onConflictDoUpdate` on the `chatId` PK so the sweep can safely call it even if a prior capture flow exists for the chat. The row written here (`stage: 'AWAITING_RESOLUTION'`, `decisionId`) is the routing signal that Phase 16's PP#0 will read to route Greg's next reply to the resolution handler.

TDD: 2 new integration tests (insert + upsert) against real Docker Postgres, alongside 3 pre-existing tests — all 5 pass.

### Task 2: Dual-channel sweep refactor

`runSweep()` in `src/proactive/sweep.ts` refactored into dual-channel architecture:

**Accountability channel (fires first):**
- Gate: `hasSentTodayAccountability(timezone)` — independent daily cap
- Trigger: `createDeadlineTrigger().detect()`
- On fire: generates message via `ACCOUNTABILITY_SYSTEM_PROMPT`, calls `upsertAwaitingResolution` before `sendMessage`, calls `setLastSentAccountability` after successful send
- Error isolation: wrapped in try/catch — LLM failures or DB failures do NOT block the reflective channel

**Reflective channel (independent):**
- Gate: `hasSentTodayReflective(timezone)` — independent daily cap
- Trigger: existing Phase 1 SQL (silence priority 1, commitment priority 3) + Phase 2 Opus (pattern priority 4, thread priority 5) pipeline — UNCHANGED
- Uses `PROACTIVE_SYSTEM_PROMPT` — UNCHANGED
- `setLastSentReflective` called on success — replaces old unified `setLastSent`

**SweepResult extended:**
```typescript
export interface ChannelResult { triggered: boolean; triggerType?: string; message?: string; }
export interface SweepResult {
  triggered: boolean;
  triggerType?: string;   // backward compat
  message?: string;       // backward compat
  skippedReason?: 'muted' | 'already_sent_today' | 'no_trigger' | 'insufficient_data';
  accountabilityResult?: ChannelResult;
  reflectiveResult?: ChannelResult;
}
```

**Global mute** gates both channels (checked once at the top).

TDD: 29 tests covering mute gate, no-trigger, accountability channel, reflective channel, channel independence (both fire, execution order, error isolation, independent caps).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] reflectiveSkippedReason not propagated to result assembly**
- **Found during:** Task 2 GREEN phase — `insufficient_data` test failed
- **Issue:** The old single-channel code returned early with a computed skippedReason. The new dual-channel code computed it in a nested block but the outer result assembly always returned `'no_trigger'` for untriggered sweeps
- **Fix:** Added `let reflectiveSkippedReason` variable, captured it in the no-trigger branch, and used it in result assembly: `reflectiveSkippedReason ?? 'no_trigger'`
- **Files modified:** `src/proactive/sweep.ts`
- **Commit:** b95f2f4

**2. [Rule 1 - Bug] Faulty control flow — runReflectiveChannel called twice in Opus path**
- **Found during:** Task 2 initial implementation
- **Issue:** Original code had both an Opus-path branch AND a `if (fired.length > 0 && !reflectiveResult)` fallthrough that double-called `runReflectiveChannel`
- **Fix:** Rewrote reflective channel as a clean if/else (SQL fired → opus_skipped → runReflectiveChannel; SQL empty → Opus phase → runReflectiveChannel or skipped)
- **Files modified:** `src/proactive/sweep.ts`
- **Commit:** b95f2f4

**3. [Rule 1 - Bug] Test ordering failures due to vi.clearAllMocks() not clearing mockResolvedValueOnce queues**
- **Found during:** Task 2 — 5 tests failed when run together but passed individually
- **Issue:** `vi.clearAllMocks()` clears call history but NOT queued `mockResolvedValueOnce` values. Unconsumed entries from one test leaked into the next, causing wrong mocks to be consumed
- **Fix:** Changed `vi.clearAllMocks()` to `vi.resetAllMocks()` in `beforeEach` — `resetAllMocks` clears both call history and all queued implementations
- **Files modified:** `src/proactive/__tests__/sweep.test.ts`
- **Commit:** b95f2f4

## Known Stubs

None. All data flows are wired end-to-end within this plan's scope.

## Threat Flags

None. The threat model items T-15-05 and T-15-06 are mitigated:
- T-15-05 (Tampering on upsertAwaitingResolution): `onConflictDoUpdate` with PK constraint enforced
- T-15-06 (DoS via unbounded messages): each channel has independent daily cap; global mute gates both

## Test Results

| Test File | Tests | Status |
|-----------|-------|--------|
| `src/decisions/__tests__/capture-state.test.ts` | 5 | PASS |
| `src/proactive/__tests__/sweep.test.ts` | 29 | PASS |

Pre-existing failures in unmodified files (language.test.ts, opus-analysis.test.ts, commitment.test.ts, models-smoke.test.ts, contradiction-false-positive.test.ts) are NOT caused by this plan's changes — all require either real API keys or Docker DB fixtures not set up in CI.

## Self-Check: PASSED

Files exist:
- `src/proactive/sweep.ts` — FOUND
- `src/proactive/__tests__/sweep.test.ts` — FOUND
- `src/decisions/capture-state.ts` — FOUND (upsertAwaitingResolution exported)

Commits exist:
- `5b5d41a` — feat(15-03): add upsertAwaitingResolution helper — FOUND
- `b95f2f4` — feat(15-03): refactor runSweep into dual-channel architecture — FOUND
