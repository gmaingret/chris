# Phase 34 — Deferred Items

Out-of-scope discoveries logged during execution. Per executor protocol (`agents/gsd-executor.md` scope-boundary): only auto-fix issues DIRECTLY caused by the current task's changes; log out-of-scope discoveries here.

---

## During Plan 34-01 execution (2026-05-12)

### Pre-existing live-API test failures in worktree sandbox

**Discovered:** Task 3 full-Docker-suite gate (`bash scripts/test.sh`).

**Scope:** 29 test failures, ALL in live-API test files that require a real `ANTHROPIC_API_KEY` env var (the worktree sandbox has `ANTHROPIC_API_KEY=test-key` fallback, which fails the live calls with `401 invalid x-api-key`).

**Affected files (none reference profile-prompt.ts — independent of Plan 34-01 changes):**
- `src/chris/__tests__/live-integration.test.ts` — 20 failures (TEST-02 / TEST-03 / TEST-04 / TEST-05 / TEST-06 / TEST-07 / TEST-08)
- `src/decisions/__tests__/live-accountability.test.ts` — 3 failures (TEST-13 scenarios 1/2/3)
- `src/decisions/__tests__/vague-validator-live.test.ts` — 2 failures (TEST-14)
- `src/episodic/__tests__/live-anti-flattery.test.ts` — 1 failure (TEST-22)
- `src/llm/__tests__/models-smoke.test.ts` — 3 failures (Sonnet / Haiku / Opus model ID smoke)

**Why deferred (not fixed):**
1. Sandbox-environment-specific (worktree spawned without `ANTHROPIC_API_KEY` injected). On Greg's local box / Proxmox where the env var IS set, these tests pass per CLAUDE.md memory `feedback_always_run_docker_tests.md`.
2. NOT caused by Plan 34-01 changes — `src/memory/profile-prompt.ts` has zero LLM imports (verified). The src/memory/ test gate passed cleanly (7 files / 124 tests GREEN including all Phase 33 tests).
3. Live API tests are gated by env not by `RUN_LIVE_TESTS=1` — they need a real key to validate Sonnet/Haiku behavior. Recent commit `eecc1bd` explicitly reverted `.skip` shortcuts and re-instated real failures as the desired signal when env is missing.

**Recommended follow-up (NOT a Plan 34-01 deviation):**
- Either gate live API tests by `process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'test-key'` at the suite level (skip when sandbox key is detected), OR document that worktree-sandbox executions cannot run the full Docker suite end-to-end. The latter is the current de-facto contract.
- Phase 34 Plan 34-01 acceptance criteria (per 34-01-PLAN.md Task 3) require `bash scripts/test.sh src/memory/` to exit 0. That gate passed (7 files / 124 tests GREEN). The optional full-suite run per CLAUDE.md memory is documented here for transparency.
