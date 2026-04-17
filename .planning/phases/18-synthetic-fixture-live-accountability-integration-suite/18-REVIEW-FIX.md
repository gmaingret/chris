---
phase: 18-synthetic-fixture-live-accountability-integration-suite
applied: 2026-04-17T21:00:00Z
fix_scope: critical_warning
findings_in_scope: 5
fixed: 5
skipped: 0
iteration: 2
status: all_fixed
---

# Phase 18: Code Review Fix Report (Iteration 2)

**Phase:** 18-synthetic-fixture-live-accountability-integration-suite
**Applied:** 2026-04-17T21:00:00Z
**Fix scope:** critical_warning (5 Warning findings; 6 Info findings out of scope)
**Result:** All 5 in-scope findings fixed. 6 atomic fix commits.

_Note: This is iteration 2. Iteration 1 (2026-04-17T00:00Z) addressed a different set of findings from an earlier review of Phase 18 — those fixes (unscoped db.delete, sql.end refactor, etc.) have already landed on main at commits 693d40d, 134daa6, 1b064a2, 9c8048e, c9856f5, 1b45f59. Iteration 2 addresses the findings surfaced by the post-milestone re-review on 2026-04-17T15:02Z._

## Fixes Applied (Iteration 2)

| Finding | Commit | Files |
|---------|--------|-------|
| WR-01 | `6f8addb` | `vitest.config.ts` — set `pool: 'forks' + singleFork: true` to serialize test file execution (Vitest 3 syntax) |
| WR-01 follow-up | `5b77039` | `vitest.config.ts` — migrate to Vitest 4 top-level `fileParallelism: false` (silences DEPRECATED warning) |
| WR-02 | `e459b17` | `src/decisions/__tests__/vague-validator-live.test.ts` — enforce D-14 one-pushback invariant in TEST-14 Turn 2 |
| WR-03 | `1f414dd` | `src/llm/client.ts` — correct `callLLM` docstring to document throw-propagation (remove "empty string on failure" lie) |
| WR-04 | `7cabd0f` | `src/decisions/vague-validator.ts` — add brace-extract fallback for fence-less Haiku JSON via `parseJsonLoose` helper |
| WR-05 | `b8510fd` | `src/decisions/__tests__/synthetic-fixture.test.ts` — change TEST-10 `afterEach` to `vi.resetAllMocks()` to drain `.mockResolvedValueOnce` queues |

## Fix Details

### WR-01 — Parallel test cleanup race
**Root cause:** Three test files all delete `pensieve_entries WHERE source='telegram'` in setup/teardown. Vitest's default pool runs test files in parallel forks → cleanup from one file wipes rows from another mid-test.

**Decision:** Chose `fileParallelism: false` over per-suite source prefixes. Production code (`resolution.ts`, `capture.ts`) hardcodes `source='telegram'` — re-plumbing per-test source strings through production just for test isolation was out of proportion to the problem.

**Vitest 4 follow-up:** Initial commit used `pool: 'forks' + poolOptions.forks.singleFork` which surfaced a DEPRECATED warning on Vitest 4. Follow-up migrates to the top-level `fileParallelism: false` equivalent.

### WR-02 — TEST-14 Turn-2 tautology
**Root cause:** Turn-2 assertions (`response.length > 0` + `status in {'open', 'open-draft'}`) cover every reachable outcome — the test passes even if the D-14 "exactly one pushback" invariant is violated.

**Fix:** Imported `buildVaguePushback` and added 5 sharper assertions:
1. Turn 1 response == `buildVaguePushback('en')` (pushback fires exactly once)
2. Pre-Turn-2 row count == 0 (no premature commit)
3. Turn 2 response != `buildVaguePushback('en')` (no second pushback)
4. Post-Turn-2 row count == 1 (exactly one commit)
5. Status ∈ {open, open-draft}

### WR-03 — callLLM docstring lie
**Root cause:** Docstring claimed "empty string on failure" but `callLLM` has no try/catch — SDK errors propagate.

**Decision:** Updated docstring to document throw-propagation rather than wrapping in try/catch. All existing callers already implement timeout + try/catch fail-soft correctly; silently swallowing SDK errors would hide rate-limit pressure from operator logs.

### WR-04 — Fragile fence stripper
**Root cause:** Haiku occasionally produces JSON without fences. The original `stripFences` + `JSON.parse` fails on those outputs, silently fail-softing to acceptable.

**Fix:** Added `parseJsonLoose` helper that falls back to first-`{...}`-span extraction when `JSON.parse(stripFences(raw))` throws. Handles the "prose without fences" edge case. Added WR-04 comment on the warn log to flag the fail-soft path.

**Note:** The shared `stripFences` util was already consolidated in Phase 14 WR-07 (the review text referring to "three local copies" was stale).

### WR-05 — TEST-10 mockResolvedValueOnce queue leak
**Root cause:** `vi.clearAllMocks()` does NOT drain `.mockResolvedValueOnce()` queues. TEST-10 queues 4 LLM responses in beforeEach but teardown only resets call counts — queued responses leak to the next test.

**Fix:** One-line change: `vi.clearAllMocks()` → `vi.resetAllMocks()` in TEST-10's `afterEach`. Matches the pattern TEST-12's `beforeEach` already uses at line 519.

## Test Gate

**Command:** `bash scripts/test.sh --no-coverage src/decisions/__tests__/synthetic-fixture.test.ts`

**Result:** All 7 tests pass against real Docker Postgres (TEST-10, TEST-11, TEST-12, plus 4 CR-01 regression subtests from Phase 16 fix). No DEPRECATED warnings.

**TEST-13 / TEST-14 (live-accountability.test.ts / vague-validator-live.test.ts):** SKIPPED — `ANTHROPIC_API_KEY` not set in env. Both describe blocks use `describe.skipIf` and were not exercised. The WR-02 and WR-04 changes affect paths only exercised by the live tests — static verification (tsc, file re-read) passed.

**User preference honored:** NEVER skip Docker integration tests — real postgres via `scripts/test.sh` was always started, no mocks substituted.

## Skipped (out of scope)

6 Info findings (IN-01 through IN-06) — scope is `critical_warning`, Info findings not in scope. See `18-REVIEW.md` for details.

## Cross-phase coordination

Phase 19 agent ran in parallel in a separate worktree. Its fixes (escalation-state atomicity in `sweep.ts`, `state.ts`, and related tests) did not overlap with Phase 18's changes. The one shared file — `src/decisions/__tests__/synthetic-fixture.test.ts` — was edited in non-overlapping regions (Phase 18 touched TEST-10's `afterEach`; Phase 19 touched TEST-12's hoisted mocks). Cherry-picking onto main produced no conflicts.

---

_Applied: 2026-04-17T21:00:00Z_
_Fixer: Claude (gsd-code-fixer agent, worktree-isolated)_
