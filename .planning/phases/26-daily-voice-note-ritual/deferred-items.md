# Phase 26 — Deferred Items (out-of-scope discoveries)

Items discovered during Phase 26 plan execution that are NOT caused by Phase 26 changes
and are deferred per the SCOPE BOUNDARY rule.

## From Plan 26-04 execution (2026-04-28)

### Pre-existing live-LLM test failures (environmental, NOT a Plan 26-04 regression)

`bash scripts/test.sh` reported `Test Files  6 failed | 91 passed | 1 skipped (98)` and
`Tests  50 failed | 1191 passed | 4 skipped (1245)`. All 6 failing test files were verified
to have ZERO references to Plan 26-04 surfaces (`voice-decline`, `handleVoiceMessageDecline`,
`message:voice`). They fail for two pre-existing environmental reasons:

| File | Failure mode | Root cause |
|------|--------------|------------|
| `src/chris/__tests__/live-integration.test.ts` | 21/24 tests fail | 401 invalid Anthropic API key in test env |
| `src/decisions/__tests__/live-accountability.test.ts` | 3 scenarios fail | 401 invalid Anthropic API key |
| `src/decisions/__tests__/vague-validator-live.test.ts` | 2 tests fail | 401 invalid Anthropic API key |
| `src/episodic/__tests__/live-anti-flattery.test.ts` | TEST-22 fails | live LLM dependency |
| `src/llm/__tests__/models-smoke.test.ts` | smoke test fails | live LLM dependency |
| `src/chris/__tests__/contradiction-false-positive.test.ts` | unhandled rejection | `EACCES: permission denied, mkdir node_modules/@huggingface/transformers/.cache` (host filesystem permission) |

**Why deferred:** Plan 26-04 modified only 3 files (`src/bot/handlers/voice-decline.ts` NEW,
`src/bot/bot.ts` MODIFIED with 1 import + 1 registration line, `src/bot/handlers/__tests__/voice-decline.test.ts`
NEW). None of the 6 failing files import from those surfaces. Voice-decline.test.ts itself
is green (7/7) when run in isolation.

**Owner:** infra / next operator with valid Anthropic key + `chmod` on
`node_modules/@huggingface/transformers/.cache`. Out of scope for milestone v2.4 M009.

### Plan 26-03 not yet shipped — affects Task 4 cross-phase grep gates

Per user instruction at `/gsd-execute-phase` invocation: "Plan 26-01 + 26-02 already complete.
26-04 next, then 26-03, then 26-05." Plan 26-04's Task 4 verification block expects
`grep system_suppressed src/rituals/types.ts == 1` because the original plan order assumed
26-03 would land before 26-04. With reversed order, this gate returns 0 until Plan 26-03
ships. This is expected and not a regression. After Plan 26-03 lands, the gate will pass
naturally without revisiting Plan 26-04.

**Owner:** Plan 26-03 executor.
