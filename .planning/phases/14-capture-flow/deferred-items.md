# Phase 14 Deferred Items

Out-of-scope discoveries logged during execution. Do NOT auto-fix in this phase.

## Discovered during Plan 01

### Pre-existing live-integration test failures under `scripts/test.sh`

**Discovered during:** `npm test` run to verify migration 0004 applies cleanly (Plan 01 Task 1 verification).

**Root cause:** `scripts/test.sh` sets `ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}"` — defaulting to the literal string `"test-key"` when no real key is exported. Several test files use `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` to gate themselves off when no key is present, but because the harness sets a non-empty bogus key, the `skipIf` evaluates false → tests fire real Anthropic API calls → `401 invalid-key` → 30s timeouts → cascading failures.

**Affected files (all pre-existing on main):**
- `src/chris/__tests__/contradiction-false-positive.test.ts` — 20 tests × 30s timeout
- `src/llm/__tests__/models-smoke.test.ts` — 3 tests (Haiku/Sonnet/Opus live probes)
- `src/chris/__tests__/language.test.ts` — 1 test (`defaults to English when no previous language and short msg`)

**Why deferred:** These are NOT caused by Phase 14 Plan 01 changes. They pre-existed on `main` (confirmed by reading the test file guards). Fixing either requires:
- Having a real `ANTHROPIC_API_KEY` available in the execution environment (user-owned), OR
- Changing `scripts/test.sh` to leave `ANTHROPIC_API_KEY` unset when not provided (likely the right fix, but out of Plan-01 scope — touches the test harness for unrelated suites).

**Recommendation:** Surface in a future hygiene plan (Phase 14 Plan 05 engine-capture already touches `scripts/test.sh` conceptually if it needs to, or carve a dedicated `test-harness-hygiene` micro-plan). Fix shape: `ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"` so `skipIf` works as the test authors intended.

**Evidence that Plan-01-touched migrations still work:** `bash scripts/test.sh src/decisions/__tests__/schema.test.ts` runs 9/9 GREEN against migration chain 0000→0004.
