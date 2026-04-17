# Phase 19 Deferred Items

Out-of-scope items surfaced during Phase 19 execution. Tracked here per GSD scope-boundary rule (executor auto-fixes only task-caused issues; pre-existing breakage is logged, not fixed).

## Source: Plan 19-01 Wave 1 Gate (2026-04-17)

The full Docker Postgres test suite (`bash scripts/test.sh`) surfaced 9 failing test files / 74 failing tests. All were proven pre-existing (not Phase 19-01 regressions) by checking out the 4 restored files at pre-Phase-19 HEAD (commit `95c484f`) and re-running `engine.test.ts` → identical 29 failures with identical error signature.

### Category A: engine.test.ts mock-chain gap

**Root cause:** `e4cb9da` restored `src/chris/engine.ts` with a new PP#0 active-decision-capture block at `engine.ts:168` calling `getActiveDecisionCapture(chatId)`. That helper (in `src/decisions/capture-state.ts:42`) uses `db.select().from().where().limit()`. The unit tests mock `db.select` with a chain that supports `select→from→where→orderBy→limit` but NOT `select→from→where→limit` (missing the direct `.where().limit()` path). Tests then fall through to the real Postgres driver, which rejects `localhost:5432` (default port) because DATABASE_URL points to `localhost:5433`.

**Affected tests (45 unit-test failures):**

| File | Failures | Typical error |
|---|---|---|
| `src/chris/__tests__/engine.test.ts` | 29 | `db.select(...).from(...).where(...).limit is not a function` |
| `src/chris/__tests__/engine-mute.test.ts` | 7 | `connect ECONNREFUSED ::1:5432` via `getActiveDecisionCapture` |
| `src/chris/__tests__/engine-refusal.test.ts` | 3 | same |
| `src/chris/__tests__/photos-memory.test.ts` | 5 | same |
| `src/chris/__tests__/language.test.ts` | 1 | related mock gap |

**Fix candidate (for a future plan):**
1. Update each failing test's `db.select` mock to return a chain that supports both direct `.limit()` AND `.orderBy().limit()`, e.g.:
   ```ts
   const mockLimit = vi.fn();
   const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
   const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy, limit: mockLimit })); // ← add direct limit
   ```
2. OR introduce a shared `vi.mock('../../decisions/capture-state.js')` stub that bypasses DB queries entirely for tests that don't exercise the capture-flow.
3. Preferred: option 1 (minimal surface change; preserves capture-flow code path visibility).

**Scope:** Not Phase 19. Slot into a post-Phase-19 test-infra cleanup plan, or attach to Plan 19-03 if its sweep.test.ts restoration surfaces the same mock-chain gap.

### Category B: Live integration tests require real ANTHROPIC_API_KEY

**Root cause:** `scripts/test.sh` uses `ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}"` — when the operator runs the script without exporting a real key, live integration tests reach the Anthropic API and get 401 `authentication_error`. Separately, `@huggingface/transformers` tries to write `node_modules/@huggingface/transformers/.cache` and hits `EACCES` in sandboxed environments where `node_modules` is read-only.

**Affected tests (29 failures):**

| File | Failures | Cause |
|---|---|---|
| `src/chris/__tests__/live-integration.test.ts` | 21 | 401 + huggingface EACCES |
| `src/llm/__tests__/models-smoke.test.ts` | 3 | 401 (Haiku/Sonnet/Opus smokes) |
| `src/decisions/__tests__/live-accountability.test.ts` | 3 | 401 |
| `src/decisions/__tests__/vague-validator-live.test.ts` | 2 | 401 |

**Fix candidate:** Operator exports a real `ANTHROPIC_API_KEY` before running `bash scripts/test.sh`, AND ensures the huggingface cache directory is writable (e.g., set `HF_HOME=/tmp/hf-cache`). These are environmental concerns, not code fixes.

**Scope:** Operator runbook update, not a code plan. Phase 19 plans run against Docker Postgres integration — they don't need a real API key for their own tests (state.test.ts and sweep.test.ts don't call Anthropic).

---

*Created: 2026-04-17 during Plan 19-01 Task 4 wave-end gate analysis*
