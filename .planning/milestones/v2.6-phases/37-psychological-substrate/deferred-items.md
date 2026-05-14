# Phase 37 deferred items

## Out-of-scope discoveries (logged per SCOPE BOUNDARY rule)

### live-API test failures during Plan 37-01 execution (2026-05-13)

When running `bash scripts/test.sh` to verify Plan 37-01 Task 6 (migration
0013 smoke gates), 29 vitest tests failed across 5 test files. All failures
trace to a missing real `ANTHROPIC_API_KEY` in the sandbox environment —
the fallback `"test-key"` produces `401 invalid x-api-key` from real
Anthropic SDK calls. NONE of the failing tests touch Phase 37 artifacts
(no references to psychological-schemas, profile_hexaco/schwartz/attachment,
or migration 0013).

| Test file | Reason for failure |
|-----------|--------------------|
| `src/chris/__tests__/live-integration.test.ts` | 401 from real Sonnet calls |
| `src/decisions/__tests__/live-accountability.test.ts` | 401 from real Sonnet/Haiku |
| `src/decisions/__tests__/vague-validator-live.test.ts` | 401 from real Haiku |
| `src/episodic/__tests__/live-anti-flattery.test.ts` | 401 from real Sonnet |
| `src/llm/__tests__/models-smoke.test.ts` | 401 on Haiku/Sonnet/Opus probes |

These are pre-existing live-API-gated tests that require `RUN_LIVE_TESTS=1`
+ a real `ANTHROPIC_API_KEY` to pass. In CI/sandbox without those env vars,
they exercise real Anthropic SDK paths and 401. **Not a Plan 37-01
regression** — these tests fail identically on the parent commit
(`e919e41 docs(37): create phase plan`) before any Plan 37-01 changes.

All three Phase 37 migration 0013 smoke gates ARE green:
- `✓ Migration 0013 substrate verified (3 tables + 3 seed rows + cold-start values)`
- `✓ Migration 0013 non-retrofittable columns verified (18 Never-Retrofit cols)`
- `✓ Migration 0013 profile_attachment D-07 columns verified (relational_word_count + activated)`

The other 11 pre-Phase-37 substrate gates also pass cleanly (Migration 0006,
0007, 0008, 0010, 0012 + anchor-bias guard + journal monotonicity).

**Resolution:** Run `bash scripts/test.sh` with `RUN_LIVE_TESTS=1
ANTHROPIC_API_KEY=…` in an environment where real API keys are available
(e.g., the operator's local machine or CI with secret). Sandbox-side
verification stops at the substrate gates, which are the explicit
acceptance criteria for Plan 37-01 Task 6.

This pattern is consistent with M010 Plan 33-01 (which also could not run
the full live-test suite from inside a worktree agent — same root cause).

### live-API test failures persist during Plan 37-02 execution (2026-05-13)

Re-confirmed during Plan 37-02 full `bash scripts/test.sh` run: same 29
failures across the same 5 `live-*` test files. Zero overlap with Plan 37-02
artifacts (`src/memory/confidence.ts`, `src/memory/profiles.ts`,
`src/memory/profiles/psychological-shared.ts`, 4 new test files). All 4 new
Plan 37-02 test files (psych-boundary-audit, psychological-schemas,
psychological-shared, psychological-profiles) pass 65/65 against real Docker
postgres.

Summary of Plan 37-02 full-suite run:
- Test Files: 5 failed | 124 passed | 7 skipped (136)
- Tests: 29 failed | 1652 passed | 23 skipped (1704)
- Failures: all in `live-*` files requiring real `ANTHROPIC_API_KEY`.

