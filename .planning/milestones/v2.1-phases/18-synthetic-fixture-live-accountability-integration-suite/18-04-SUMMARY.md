---
phase: 18-synthetic-fixture-live-accountability-integration-suite
plan: 04
subsystem: decisions/testing
tags: [test-fix, single-pipeline, vague-validator, live-haiku]
requires: [18-03]
provides: [TEST-10, TEST-11, TEST-12, TEST-14]
affects: [src/decisions/__tests__/synthetic-fixture.test.ts, src/decisions/vague-validator.ts]
tech_stack:
  added: []
  patterns: [single-pipeline-sweep, live-haiku-validation, fail-soft-timeout]
key_files:
  modified:
    - src/decisions/__tests__/synthetic-fixture.test.ts
    - src/decisions/vague-validator.ts
decisions:
  - "Rewrite TEST-12 assertions for single-pipeline sweep (no dual-channel): one winner, one sendMessage"
  - "Increase vague-validator max_tokens from 60 to 200 to prevent JSON truncation from Haiku"
  - "Increase VAGUE_TIMEOUT_MS from 3s to 15s to handle real Haiku API latency"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-16"
  tasks: 2
  files: 2
---

# Phase 18 Plan 04: Test Fix — Single-Pipeline Sweep + Vague Validator Summary

Fix test assertion mismatches and max_tokens truncation so all Phase 18 tests pass against the actual source code architecture.

## What Was Built

Two targeted fixes to make Phase 18 tests pass against the actual implementation:

**Task 1 — TEST-12 dual-channel → single-pipeline rewrite (`synthetic-fixture.test.ts`)**

The test was written against a planned dual-channel sweep architecture (`accountabilityResult`/`reflectiveResult`) that was never implemented. The actual `sweep.ts` is a single-pipeline: `isMuted() → hasSentToday() → triggers → winner → LLM → send`. Fixed by:
- Removing 6 non-existent state mock exports (`hasSentTodayAccountability`, `hasSentTodayReflective`, `setLastSentAccountability`, `setLastSentReflective`, `setEscalationSentAt`, `setEscalationCount`)
- Adding correct single-pipeline state mocks (`hasSentToday`, `setLastSent`)
- Rewriting `vi.mock('../../proactive/state.js')` to match actual `state.ts` exports
- Rewriting TEST-12 assertions: `result.triggered === true`, `result.triggerType === 'silence'`, `mockSendMessage` called exactly 1 time
- TEST-10 and TEST-11 were unaffected and continued to pass

**Task 2 — Vague-validator max_tokens and timeout fix (`vague-validator.ts`)**

Root cause of 0/10 flagged (not a timeout issue): `callLLM(VAGUE_VALIDATOR_PROMPT, userContent, 60)` passed `max_tokens: 60`. The Haiku response `{"verdict": "vague", "reason": "...explanation..."}` exceeded 60 tokens, producing truncated JSON. `JSON.parse` threw `"Unterminated string"`, the `catch` block returned `{verdict: 'acceptable'}` (fail-soft). Fixed:
- `max_tokens`: 60 → 200 (sufficient for verdict + reason)
- `VAGUE_TIMEOUT_MS`: 3000 → 15000 (real Haiku latency headroom; not the actual root cause but correct defensively)

## Test Results

All 5 Phase 18 tests pass:

| Test | Description | Result |
|------|-------------|--------|
| TEST-10 | 14-day decision lifecycle: seed → due → resolved → reviewed → stats | PASS |
| TEST-11 | Sweep-vs-user concurrency race: one winner, one OptimisticConcurrencyError | PASS |
| TEST-12 | Same-day collision: single-pipeline selects silence (priority 1) over deadline (priority 2) | PASS |
| TEST-14 Test 1 | 10/10 adversarial vague predictions flagged by real Haiku | PASS |
| TEST-14 Test 2 | One pushback then commit confirmation (two-turn enforced by handleCapture) | PASS |

## Deviations from Plan

**[Rule 1 - Bug] Vague-validator max_tokens too small — JSON truncation root cause**
- **Found during:** Task 2 execution (first test run)
- **Issue:** The plan identified timeout (3s VAGUE_TIMEOUT_MS) as root cause for 0/10 flagged. Actual root cause was `max_tokens: 60` — Haiku responses for `{verdict, reason}` JSON exceeded 60 tokens, causing truncation and parse failures
- **Fix:** Increased `max_tokens` from 60 to 200. Also kept the timeout increase (3s → 15s) as it's correct defensively
- **Files modified:** `src/decisions/vague-validator.ts`
- **Commit:** 43e5ab5

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | a7abb23 | fix(18-04): rewrite TEST-12 for single-pipeline sweep architecture |
| Task 2 | 43e5ab5 | fix(18-04): fix vague-validator timeout and max_tokens for live Haiku |

## Known Stubs

None. All test assertions verify real behavior against real Postgres and real Haiku API.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- `src/decisions/__tests__/synthetic-fixture.test.ts` — modified, exists ✓
- `src/decisions/vague-validator.ts` — modified, exists ✓
- Commit a7abb23 — exists ✓
- Commit 43e5ab5 — exists ✓
- All 5 tests pass (verified by test run output) ✓
