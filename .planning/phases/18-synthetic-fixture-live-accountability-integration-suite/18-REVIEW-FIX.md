---
phase: 18-synthetic-fixture-live-accountability-integration-suite
applied: 2026-04-17T05:51:00Z
fix_scope: all
findings_in_scope: 6
fixed: 6
skipped: 0
iteration: 3
status: all_fixed
---

# Phase 18: Code Review Fix Report (Iteration 3)

**Phase:** 18-synthetic-fixture-live-accountability-integration-suite
**Applied:** 2026-04-17T05:51:00Z
**Fix scope:** all (6 Info findings — all 5 Warnings already resolved in iteration 2)
**Result:** All 6 in-scope findings fixed. 6 atomic fix commits.

_Note: This is iteration 3. Earlier iterations addressed the Warning-tier findings
and an older review pass — see the iteration history section below for the full
timeline and commit list._

## Fixes Applied (Iteration 3)

| Finding | Commit | Files |
|---------|--------|-------|
| IN-05 | `4aa0ae4` | `src/__tests__/fixtures/time.ts` (new), `src/decisions/__tests__/synthetic-fixture.test.ts`, `src/decisions/__tests__/vague-validator-live.test.ts` — extract `DAY_MS` to shared fixture module |
| IN-03 | `51fea91` | `src/__tests__/fixtures/chat-ids.ts` (new), `src/decisions/__tests__/synthetic-fixture.test.ts`, `src/decisions/__tests__/live-accountability.test.ts`, `src/decisions/__tests__/vague-validator-live.test.ts` — centralize test chat IDs in registry |
| IN-06 | `cd039ba` | `src/decisions/__tests__/synthetic-fixture.test.ts` — replace `'test-decision-uuid-for-test-12'` with `crypto.randomUUID()` for TEST-12 FAKE_DECISION_ID |
| IN-01 | `9e141a0` | `src/decisions/__tests__/synthetic-fixture.test.ts` — comment `inArray(col, selectBuilder)` subquery semantics in `cleanup()` |
| IN-02 | `d624ddc` | `src/decisions/__tests__/synthetic-fixture.test.ts` — document that `Date.now()` in `seedDecision` default is clock-mocked and intentionally retained for TEST-11 |
| IN-04 | `f46d977` | `src/decisions/__tests__/live-accountability.test.ts` — file-level comment explaining intent of `temperature: 0` + 3-iteration loop (pinned behavior, not statistical sampling) |

## Fix Details

### IN-01 — `inArray` subquery semantics unclear to readers
**Finding:** `cleanup()` uses `inArray(decisionEvents.decisionId, db.select(...))`. A reader unfamiliar with drizzle might assume the subquery materializes IDs in Node memory.

**Fix:** Added a 4-line comment clarifying that drizzle's `inArray(col, selectBuilder)` emits a correlated SQL subquery (single round-trip, equivalent to a DELETE with JOIN). Fresh readers no longer need to dig into drizzle internals to understand the cost model.

### IN-02 — `seedDecision` default `resolveBy` mixes `Date.now()` with `vi.setSystemTime`
**Finding:** The default `resolveBy = new Date(Date.now() + DAY_MS)` works under the mock clock but the reviewer flagged it as "effectively dead code" and suggested either removing the default or documenting the mock-clock dependency.

**Correction to review:** The default IS reached — TEST-11 (sweep-vs-user concurrency) at line 483 calls `seedDecision('due')` without an explicit `resolveBy`. TEST-11 runs without `vi.setSystemTime`, so the default evaluates against real wall-clock time. Removing the default would force a TEST-11 refactor that exceeds the Info-finding scope.

**Fix:** Kept the default and added a comment documenting (a) that `vi.setSystemTime` hooks both `new Date()` and `Date.now()`, (b) TEST-11 uses the default at real wall-clock time, and (c) a warning to not tighten this API without updating TEST-11 first.

### IN-03 — `TEST_CHAT_ID = 9991X` convention unenforced
**Finding:** Per-file unique chat IDs were using an informal `9991X` numeric convention. A new test file could silently pick a colliding ID.

**Fix:** Created `src/__tests__/fixtures/chat-ids.ts` as the central registry. All 3 Phase 18 test files now import their ID instead of hardcoding `BigInt(9991X)`:
- `CHAT_ID_SYNTHETIC_FIXTURE = BigInt(99918)` — Phase 18 TEST-10/11/12
- `CHAT_ID_LIVE_ACCOUNTABILITY = BigInt(99919)` — Phase 18 TEST-13
- `CHAT_ID_VAGUE_VALIDATOR_LIVE = BigInt(99920)` — Phase 18 TEST-14
- `CHAT_ID_CHRIS_LIVE = BigInt(99901)` — registered but `src/chris/__tests__/live-integration.test.ts` not rewired (out of Phase 18 scope; next reviewer can migrate it opportunistically).

File-level comment in `chat-ids.ts` documents the "never hardcode; always import" rule for future test files.

### IN-04 — `temperature: 0` + 3x loop ambiguity
**Finding:** Reviewer asked whether the 3-iteration loop on each scenario was intended as statistical sampling (which would want `temperature: 0.3-0.7`) or pinned behavior (which one run would satisfy), and noted the current setup "does both imperfectly".

**Fix:** Added a dedicated "Intent" paragraph to the file-level docstring: the goal is PINNED BEHAVIOR, not sampling. `temperature=0` keeps Sonnet/Haiku near-deterministic; the 3x loop is cheap belt-and-suspenders for rare tokenization variance or API-version drift. Future maintainers reading the file now understand why the setup looks the way it does.

### IN-05 — `DAY_MS` / `86_400_000` duplicated
**Finding:** The `86_400_000` literal appeared in 3 places across 2 test files (plus 2 production files, out of scope per the reviewer's guidance to extract for tests).

**Fix:** Created `src/__tests__/fixtures/time.ts` exporting `DAY_MS = 86_400_000`. Both `synthetic-fixture.test.ts` and `vague-validator-live.test.ts` now import from it. Production files (`resolve-by.ts`, `deadline.ts`) still use inline literals — intentionally not importing from a test-only module; the fixture file's docstring calls this out.

### IN-06 — `FAKE_DECISION_ID` non-UUID string
**Finding:** TEST-12 uses `FAKE_DECISION_ID = 'test-decision-uuid-for-test-12'`, a human-readable placeholder. It's fine today because `upsertAwaitingResolution` is mocked — but if the mock is tightened or removed, it would fail cryptically against the `uuid`-type column.

**Fix:** Changed to `crypto.randomUUID()` (global in Node 24+, no import needed). Added a comment explaining the future-proofing motivation.

## Test Gate

**Command:** `bash scripts/test.sh --no-coverage src/decisions/__tests__/synthetic-fixture.test.ts`

**Result:** All 7 tests pass against real Docker Postgres.
- TEST-10 (14-day lifecycle): pass
- TEST-11 (sweep-vs-user concurrency): pass
- TEST-12 (same-day collision): pass
- 4 CR-01 regression subtests (from Phase 16 fix): pass

Duration: 777ms. No DEPRECATED warnings. No type errors from `npx tsc --noEmit`.

**TEST-13 / TEST-14 (live-accountability.test.ts / vague-validator-live.test.ts):** NOT RUN — both use `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` and no API key is set in the fix worktree. The iteration-3 changes to these files are comment-only (IN-04) and two mechanical constant swaps (IN-03 `TEST_CHAT_ID`, IN-05 `DAY_MS`). Static verification (`tsc --noEmit -p tsconfig.json`) passed with zero errors in the touched files.

**User preference honored (durable):** NEVER skip Docker integration tests — real postgres via `scripts/test.sh` was started, no mocks substituted.

## Skipped

None. All 6 Info findings fixed cleanly.

## Iteration History

### Iteration 1 (earlier review pass, 2026-04-17T00:00Z)

Addressed a different set of findings from an earlier Phase 18 review. Fixes already landed on main at commits: `693d40d`, `134daa6`, `1b064a2`, `9c8048e`, `c9856f5`, `1b45f59`. Scope: unscoped `db.delete`, `sql.end` refactor, etc.

### Iteration 2 (post-milestone re-review, 2026-04-17T15:02Z → applied 2026-04-17T21:00Z)

5 Warning findings, all fixed:

| Finding | Commit | Summary |
|---------|--------|---------|
| WR-01 | `6f8addb`, `5b77039` | `vitest.config.ts` — `fileParallelism: false` (Vitest 4) to serialize test file execution |
| WR-02 | `e459b17` | TEST-14 Turn-2 — enforce D-14 one-pushback invariant with 5 sharper assertions |
| WR-03 | `1f414dd` | `callLLM` docstring — correct throw-propagation semantics (remove "empty string on failure" lie) |
| WR-04 | `7cabd0f` | `vague-validator.ts` — add brace-extract fallback (`parseJsonLoose`) for fence-less Haiku JSON |
| WR-05 | `b8510fd` | TEST-10 `afterEach` — `vi.resetAllMocks()` to drain `.mockResolvedValueOnce` queues |

6 Info findings deferred to iteration 3 (scope was `critical_warning` only).

### Iteration 3 (this run, 2026-04-17T05:51Z)

6 Info findings, all fixed. See "Fixes Applied (Iteration 3)" table above.

## Cross-phase coordination

The coordination note from the prompt mentioned:
- **Phase 19:** may edit `src/decisions/__tests__/synthetic-fixture.test.ts` (TEST-12 area). Iteration 3 touched lines 225-230 (imports), 242-272 (seedDecision + cleanup comments), 569-576 (TEST-12 FAKE_DECISION_ID). No overlap with Phase 19's TEST-12 hoisted-mock territory (lines 60-150).
- **Phase 14:** may edit `src/decisions/vague-validator.ts`. Iteration 3 did not touch this file.
- **Phase 16:** may edit `src/llm/prompts.ts` and `src/pensieve/retrieve.ts`. Iteration 3 did not touch either.

Edits were intentionally surgical — only the exact lines called out by each Info finding. New files (`src/__tests__/fixtures/time.ts`, `src/__tests__/fixtures/chat-ids.ts`) are net-new and cannot conflict.

---

_Applied: 2026-04-17T05:51:00Z_
_Fixer: Claude (gsd-code-fixer agent, iteration 3)_
