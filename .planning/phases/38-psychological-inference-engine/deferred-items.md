# Phase 38 — Deferred Items

## Pre-existing live-API test failures (out of scope for Plan 38-02)

While running `bash scripts/test.sh` after Plan 38-02 Task 3 completed
successfully, the full Docker suite reports `5 failed | 128 passed` test
files. **All 5 failing files are pre-existing environment failures unrelated
to Plan 38-02 changes** — they call the real Anthropic API with
`invalid x-api-key` 401 errors:

  - `src/chris/__tests__/live-integration.test.ts`
  - `src/decisions/__tests__/live-accountability.test.ts`
  - `src/decisions/__tests__/vague-validator-live.test.ts`
  - `src/episodic/__tests__/live-anti-flattery.test.ts`
  - `src/llm/__tests__/models-smoke.test.ts`

These tests require a live Anthropic API key (the sandbox does not have one
configured). They are not exercised by Plan 38-02's code (the M011 generators
mock the Anthropic SDK via `vi.mock('../../../llm/client.js', ...)`).

**Scope-boundary justification:** per executor deviation rules, only fixes
directly caused by the current task's changes are in scope. These failures
exist on the base commit (`0fb4710 docs(phase-38): update tracking after
wave 1`) prior to Plan 38-02 execution; no Plan 38-02 commit touches the
files that fail.

**Plan 38-02 test surface that DOES pass:**
  - `src/memory/profiles/__tests__/hexaco.test.ts` — 8/8
  - `src/memory/profiles/__tests__/schwartz.test.ts` — 8/8
  - `src/memory/__tests__/psychological-profile-updater.integration.test.ts` — 2/2
  - `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` — 10/10
  - `src/memory/__tests__/psychological-profile-prompt.test.ts` — 28/28
  - `src/memory/profiles/__tests__/psychological-schemas.test.ts` — full pass
  - `src/memory/profiles/__tests__/psychological-shared.test.ts` — full pass
  - Plus 1696 other passing tests across the codebase

**Remediation owner:** environment (CI / sandbox API-key provisioning); not
Plan 38-02. Add `ANTHROPIC_API_KEY` to the test environment to re-enable the
live-API smoke and integration tests.
