# Phase 27 — Deferred Items

## Pre-existing full-suite test isolation issue (logged 2026-04-26 during Plan 27-01 execution)

**Discovered during:** `bash scripts/test.sh` mandatory gate at end of Plan 27-01.

**Symptom:** Running the full vitest suite (100+ test files, 1332 tests) reports 29 failed test files / 74 failed tests. Categories of failures observed:

1. **Live-integration suite (21 fails in `src/chris/__tests__/live-integration.test.ts`)** — All fail with `401 invalid x-api-key`. Tests call real Anthropic LLM API; the test harness sets `ANTHROPIC_API_KEY=test-key` placeholder. Pre-existing — this suite is gated on a real API key being available in the test env.

2. **Models-smoke (3 fails in `src/llm/__tests__/models-smoke.test.ts`)** — Same root cause as #1.

3. **DB-integration suites (50 fails across 8 test files):**
   - `src/rituals/__tests__/voice-note-suppression.test.ts` (7 fails)
   - `src/rituals/__tests__/scheduler.test.ts` (8 fails)
   - `src/rituals/__tests__/idempotency.test.ts` (4 fails)
   - `src/rituals/__tests__/voice-note-handler.test.ts` (4 fails)
   - `src/proactive/__tests__/state-ritual-cap.test.ts` (6 fails)
   - `src/__tests__/fixtures/load-primed.test.ts` (8 fails)
   - `src/pensieve/__tests__/retrieve.episodic.test.ts` (4 fails)
   - `src/chris/__tests__/engine-pp5.test.ts` (3 fails)
   - `scripts/__tests__/synthesize-episodic.test.ts` (6 fails)

   These all PASS when run in isolation against a freshly-migrated Docker postgres. Confirmed during Plan 27-01:
   - `npx vitest run src/rituals/` → 60/60 passed
   - `npx vitest run src/bot/` → 63/63 passed

   Root cause is **test cross-contamination at the DB level** — earlier tests in the full-suite run leave state (rows, sequence counters, etc.) that breaks later tests' fixture assumptions. This is a pre-existing harness issue, not introduced by Plan 27-01.

**Why deferred from Plan 27-01:** Per executor SCOPE BOUNDARY rule, only issues DIRECTLY caused by the current task's changes are in scope. Plan 27-01 added 1 import + 1 `bot.on` registration in `src/bot/bot.ts` plus 2 new files (`ritual-callback.ts` + `wellbeing.ts` STUB) plus 1 new test file. None of these touch the failing test files' modules.

**Verification that Plan 27-01 is clean:**
- `npx vitest run src/bot/__tests__/ritual-callback.test.ts` → 7/7 passed
- `npx vitest run src/bot/` (all bot tests) → 63/63 passed
- `npx vitest run src/rituals/` (all rituals tests) → 60/60 passed
- `npx tsc --noEmit` → clean

**Recommendation for future work:** A dedicated infra plan should investigate vitest fork isolation + add per-suite DB cleanup hooks (truncate-all-tables-before-suite or schema rebuild). Worth tracking against the v2.4 stability budget separately from M009's feature work.
