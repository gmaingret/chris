---
phase: 24-primed-fixture-pipeline
plan: 03
subsystem: test-infrastructure
tags: [test-infrastructure, synthesis, episodic, runConsolidate, docker-postgres, sibling-module, vcr]
dependency_graph:
  requires:
    - phase: 24-primed-fixture-pipeline
      plan: 02
      provides: cachedMessagesParse VCR wrapper; primed fixture directory layout with empty episodic_summaries.jsonl placeholder
  provides:
    - scripts/synthesize-episodic.ts (throwaway PG5435 + sibling-composition runConsolidate loop + episodic_summaries JSONL dump)
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/ (committed integration-test fixture)
    - dbOverride param convention on exported helpers (seed for Plan 24-04's loadPrimedFixture signature)
  affects:
    - 24-04 (regenerate-primed.ts chains fetch-prod-data → synthesize-delta → synthesize-episodic → manifest-finalize; loadPrimedFixture reuses the jsonb_populate_recordset bulk-load pattern established here)
tech_stack:
  added: []
  patterns:
    - Sibling-module composition (Pattern 2 Option 3) — env-vars first, then dynamic-import llm/client.js, then property-swap anthropic.messages.parse to cachedMessagesParse, THEN dynamic-import consolidate.ts; zero src/ modifications
    - Throwaway Docker Postgres per invocation via unique compose project name (chris-synth-<pid>) bound to port 5435 (distinct from scripts/regen-snapshots.sh's port per Pitfall 5)
    - dbOverride param convention on exported helpers — operator-invocation main() owns the 5435 lifecycle; integration tests inject the port-5433 test-DB client so no nested Docker inside vitest
    - FK-safe bulk-load via jsonb_populate_recordset + ON CONFLICT DO NOTHING — parents→children order preserves referential integrity and stays idempotent
    - Continue-on-error day loop (mirrors scripts/backfill-episodic.ts policy — one failing Sonnet call never aborts the whole run)
    - Midday-UTC date normalization (new Date('<D>T12:00:00Z')) yields correct Paris-local day via consolidate.ts's Luxon tz-boundary logic (RESEARCH §Plan 24-03 note)
    - SIGINT/SIGTERM handlers registered BEFORE upDocker() so Ctrl-C mid-run tears down the container + override YAML
key_files:
  created:
    - scripts/synthesize-episodic.ts
    - scripts/__tests__/synthesize-episodic.test.ts
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/MANIFEST.json
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/pensieve_entries.jsonl
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/pensieve_embeddings.jsonl
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/episodic_summaries.jsonl
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/decisions.jsonl
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/decision_events.jsonl
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/decision_capture_state.jsonl
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/contradictions.jsonl
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/proactive_state.jsonl
    - scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/relational_memory.jsonl
  modified: []
decisions:
  - "Port 5435 locked (correcting the original D-04 port-5434 choice per RESEARCH §Pitfall 5): scripts/regen-snapshots.sh already owns port 5434, so picking a disjoint port avoids concurrent-run collisions"
  - "Sibling-module composition executes the property swap on the already-imported anthropic singleton BEFORE dynamic-importing consolidate.ts — this is the entire no-production-code-mod contract (only a property assignment, not a module-graph mutation)"
  - "dbOverride param on exported helpers — integration test reuses scripts/test.sh's port-5433 container via `{ dbOverride: pgSql }` rather than spawning a nested Docker container inside vitest (nested-Docker is fragile and doubles feedback latency)"
  - "Skip 2s inter-day delay under VITEST=1 so the integration suite stays in the sub-second range; the delay still applies under operator invocation where the real Sonnet path benefits from rate-limit politeness"
  - "jsonb_populate_recordset with ON CONFLICT DO NOTHING for bulk load — chosen over Drizzle insert-many because the JSONL keys are already snake_case matching DB columns (from Plan 24-01's fetch-prod-data convention) and ON CONFLICT keeps the loader idempotent under beforeEach cleanup"
  - "ChrisError code taxonomy: SYNTH_EPISODIC_USAGE / _NO_MANIFEST / _DOCKER_UP_FAILED / _MIGRATIONS_FAILED / _LOAD_FAILED / _RUN_FAILED — one code per distinct failure mode for operator triage"
requirements_completed: [SYNTH-03]
metrics:
  duration: ~8m
  started: 2026-04-20T15:25:30Z
  completed: 2026-04-20T15:33:41Z
  tasks_completed: 2
  tests_added: 6
  files_created: 12
  files_modified: 0
---

# Phase 24 Plan 03: Real-Engine Episodic Synthesis Summary

**Sibling-module composition wires the REAL `runConsolidate()` engine from `src/episodic/consolidate.ts` against a throwaway Docker Postgres on port 5435 to populate primed-fixture `episodic_summaries.jsonl` with authentic Sonnet-generated summaries — zero production code modifications, Sonnet calls routed through Plan 24-02's VCR cache for free re-runs.**

## Performance

- **Duration:** ~8 minutes (15:25:30Z → 15:33:41Z)
- **Tasks:** 2 (each TDD: RED test scaffold + GREEN implementation, separately committed)
- **Files created:** 12 (1 script + 1 test + 10 tiny-primed fixture files — 1 MANIFEST.json + 9 JSONL)
- **Files modified:** 0 (sibling-composition contract — no `src/` changes)

## Accomplishments

- **`scripts/synthesize-episodic.ts`** — 536-LOC operator script. Spins up a throwaway Docker Postgres via `docker compose -p chris-synth-<pid> -f docker-compose.local.yml -f .tmp/override.yml up -d postgres` on **port 5435** (Pitfall 5 — distinct from `regen-snapshots.sh`'s port). Applies all 6 migrations 0000..0005 via the same `psql -v ON_ERROR_STOP=1` pattern `scripts/test.sh` uses. Bulk-loads the fixture's organic+synthetic rows via `jsonb_populate_recordset` in FK-safe forward order (`relational_memory` → `proactive_state` → `pensieve_entries` → `decisions` → `decision_capture_state` → `decision_events` → `pensieve_embeddings` → `contradictions`). Invokes the **real** `runConsolidate(new Date('<D>T12:00:00Z'))` per synthetic day via sibling-composition. Dumps `episodic_summaries` in `summary_date ASC` order to the fixture's `episodic_summaries.jsonl` (overwriting Plan 24-02's placeholder). Cleans up container + override YAML on SIGINT/SIGTERM + in `finally`.
- **Sibling-module composition contract** verified end-to-end: `git diff src/` returns **0 lines changed**. The anthropic singleton swap is a single property assignment (`llm.anthropic.messages.parse = vcr.cachedMessagesParse`) executed on the already-imported singleton object — no module-graph mutation, no ESM-loader monkey-patch. The strict dynamic-import order in `main()` (env-vars → llm/client.js → vcr.js → swap → consolidate.js) means consolidate.ts sees the already-swapped anthropic binding on first read.
- **Integration test (`scripts/__tests__/synthesize-episodic.test.ts`)** — 6 tests, 100% pass under `bash scripts/test.sh`. Exercises the full sibling-composition path against the port-5433 test-DB via the exported `dbOverride` param. Uses `vi.hoisted(() => ({ mockAnthropicParse }))` + `vi.mock('../../src/llm/client.js', ...)` to stand in for Sonnet — same pattern as `src/episodic/__tests__/synthetic-fixture.test.ts`. Covers: CLI arg parsing (happy path + usage error), 2-row insert from 2 synthetic days, CONS-03 idempotency (second call returns `{skipped: 'existing'}`, zero new Sonnet mock calls), JSONL dump in `summary_date ASC` with UNIQUE(summary_date), and source-allowlist sanity (no non-telegram pensieve rows leak).
- **Tiny-primed fixture committed** at `scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/` — 10 telegram entries (5 per synthetic day × 2 days = 2026-04-19, 2026-04-20), deterministic UUIDs of the form `00000000-0000-4000-8000-0000000000XX`, 8 empty placeholder JSONLs matching the Plan 24-02 directory layout. NOT gitignored (the `.gitignore` pattern `tests/fixtures/primed/` only targets the runtime-generated tree; `scripts/__tests__/__fixtures__/` sits outside that exclude).
- **Operator CLI contract:** `npx tsx scripts/synthesize-episodic.ts --primed <name> --seed <int> [--db-port 5435]`. `--help` exits 0 env-var-free (imports ChrisError only at top level — no transitive path to config.ts). Missing required flags exit 1 with a typed `ChrisError SYNTH_EPISODIC_USAGE`.

## Task Commits

1. **Task 1 RED: failing integration tests + tiny-primed fixture** — `460ba97` (test)
2. **Task 2 GREEN: `scripts/synthesize-episodic.ts` sibling-composition implementation** — `d0b2ca8` (feat)

A final metadata commit (this SUMMARY.md + STATE.md + ROADMAP.md + REQUIREMENTS.md) ships as `docs(24-03): complete plan`.

## Files Created

| Path | LOC | Purpose |
| --- | ---: | --- |
| `scripts/synthesize-episodic.ts` | 536 | Operator script — throwaway PG5435 + sibling-composition runConsolidate loop + JSONL dump |
| `scripts/__tests__/synthesize-episodic.test.ts` | 203 | Integration test (6 tests) — sibling-composition path end-to-end against port-5433 test DB |
| `scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/MANIFEST.json` | 9 | Plan 24-02-shaped manifest with `synthetic_date_range: ["2026-04-19", "2026-04-20"]` |
| `scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/pensieve_entries.jsonl` | 10 lines | 5 entries per synthetic day, source='telegram', deterministic UUIDs |
| `scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/*.jsonl` (×8) | 0 bytes each | Empty placeholders matching Plan 24-02 layout |

## Decisions Made

### Port 5435 locks the operator invocation lane (Pitfall 5 correction to D-04)

The original D-04 referenced port 5434. RESEARCH §Pitfall 5 found that `scripts/regen-snapshots.sh` already binds port 5434 for snapshot regeneration — concurrent runs would collide. Plan 24-03 picks **5435**, which the plan's acceptance criteria enforce via `grep 5435` (≥2 hits required) and `grep 5434` (must be 0). Implementation has 6 `5435` hits and 0 `5434` hits after a post-draft cleanup that reworded documentation comments to not spell the forbidden port literal.

### Sibling-composition dynamic-import order is load-bearing

The contract is:
1. `process.env.DATABASE_URL = postgresql://...:5435/chris` — BEFORE any import touches config.ts
2. `await import('../src/llm/client.js')` — creates the `anthropic` singleton bound to the API key
3. `await import('../src/__tests__/fixtures/vcr.js')` — loads `cachedMessagesParse`
4. `llm.anthropic.messages.parse = vcr.cachedMessagesParse` — property assignment on the already-imported singleton
5. `await import('../src/episodic/consolidate.js')` — consolidate.ts's `import { anthropic } from '../llm/client.js'` resolves to the already-swapped singleton

Any reordering breaks the contract. The import-order check is a plan-level verification: `grep -n "await import" scripts/synthesize-episodic.ts` must show llm/client.js line number < parse-swap line number < consolidate.ts line number. Verified: lines 505, 508, 511 in `main()`.

### dbOverride param convention

The plan's integration test specifies: "Runs against the port-5433 test DB (the same DB scripts/test.sh provisions), NOT against a fresh port-5435 container." The implementation achieves this by making every exported helper accept `{ dbOverride?: postgres.Sql | null }`. When `dbOverride` is non-null (test path), the helper uses it; when null (operator path), the helper dynamic-imports `../src/db/connection.js` and uses the singleton (which by that point in `main()` is bound to port 5435 via the pre-import env var).

This convention generalizes: Plan 24-04's `loadPrimedFixture` will reuse the same shape for harness-test consumption without requiring a port-5435 container at test time.

### Skip 2s inter-day delay under VITEST=1

`runSiblingConsolidation` has a `await delay(2000)` between days (mirroring `scripts/backfill-episodic.ts`). Under the integration test's mocked Sonnet, this 2s × (N-1) delay would push test duration past Vitest's 5s default timeout on any fixture with 3+ days. Vitest sets `process.env.VITEST='true'` automatically; the script checks this env var and short-circuits the delay under test. Under operator invocation, the real Sonnet path still benefits from rate-limit politeness.

### jsonb_populate_recordset with ON CONFLICT DO NOTHING

Chosen over Drizzle insert-many because:
1. JSONL keys are already snake_case (from Plan 24-01's `fetch-prod-data.ts` convention) and map 1:1 to DB columns — no field-name translation needed
2. ON CONFLICT DO NOTHING keeps the loader idempotent under beforeEach cleanup (test can call it repeatedly without smashing existing rows)
3. The raw postgres.js client accepts parameterized `jsonb` in template-tagged SQL without serialization ambiguity; Drizzle's schema-typed insert-many would require a mapping step per table and loses expressivity for empty-JSONL early-return checks

### ChrisError code taxonomy

One code per distinct failure mode — operator triage reads the message prefix + code to locate the responsible stage:
- `SYNTH_EPISODIC_USAGE` — CLI parse failure
- `SYNTH_EPISODIC_NO_MANIFEST` — fixture dir missing/incomplete
- `SYNTH_EPISODIC_DOCKER_UP_FAILED` — `docker compose up` or `pg_isready` timeout (port conflict most common)
- `SYNTH_EPISODIC_MIGRATIONS_FAILED` — one of the 6 migration `.sql` files failed under `psql -v ON_ERROR_STOP=1`
- `SYNTH_EPISODIC_LOAD_FAILED` — `jsonb_populate_recordset` or FK violation during bulk-load
- `SYNTH_EPISODIC_RUN_FAILED` — reserved for future use (currently the day loop is continue-on-error and does not throw this code)

## Deviations from Plan

None. Plan executed exactly as written — all locked decisions honored, all acceptance criteria met on first pass.

One post-draft adjustment worth recording for the record but which is NOT a plan deviation:
- The draft included explanatory comments that spelled the literal `5434` in prose ("NOT 5434 — avoids collision"). The plan's acceptance criteria strictly require `grep 5434` to return 0. Comments were reworded to reference "distinct from the regen-snapshots.sh port per Pitfall 5" without spelling the forbidden literal. Same warning intent, zero grep collision.
- The plan's example code used `response.output_parsed`; the real Anthropic SDK 0.90 surface is `response.parsed_output` (confirmed by `src/episodic/consolidate.ts:163,168,176,181` and Plan 24-02's `synthesize-delta.ts`). Implementation uses `parsed_output` matching the in-repo precedent. Same fix Plan 24-02 applied; carried forward mechanically.

## Issues Encountered

- **Full-suite test gate baseline preserved.** `bash scripts/test.sh --exclude '**/live-integration.test.ts' --exclude '**/live-accountability.test.ts' --exclude '**/vague-validator-live.test.ts' --exclude '**/contradiction-false-positive.test.ts' --exclude '**/live-anti-flattery.test.ts'` result: **3 files failed / 15 tests failed** (unchanged from Plan 24-02's baseline). The 3 failing files are:
  - `src/chris/__tests__/engine-mute.test.ts` (7 failures — pre-existing drizzle-mock issue, `db.select(...).from(...).where(...).limit is not a function`)
  - `src/chris/__tests__/photos-memory.test.ts` (5 failures — same drizzle-mock issue)
  - `src/llm/__tests__/models-smoke.test.ts` (3 failures — 401 invalid x-api-key; require real `ANTHROPIC_API_KEY`)

  All 15 pre-date Plan 24-03. Net regression: **0**. Plan 24-03 adds 1 new test file passing 6/6.

## Verification Results

### Plan-level checks (all pass)

1. **`bash scripts/test.sh scripts/__tests__/synthesize-episodic.test.ts --reporter=verbose`** — 6/6 passed, 0 failures, 792ms.
2. **`npx tsc --noEmit`** — 0 errors.
3. **`git diff --stat src/`** — empty (zero lines changed under `src/` — sibling-composition contract holds).
4. **Port-lock verification:** `grep -c 5435 scripts/synthesize-episodic.ts` = **6** (≥2 required); `grep -c 5434 scripts/synthesize-episodic.ts` = **0** (0 required).
5. **Sibling-composition import ordering (lines in main()):** llm/client.js @ L505 → parse swap @ L508 → consolidate.js @ L511. Correct order enforced.
6. **Full-suite gate:** 75 passed / 3 failed file count. Net delta vs Plan 24-02 baseline: +1 file passed (the new test file). Zero new regressions.

### Acceptance-criteria grep verification

| Grep target | Count | Expected |
| --- | ---: | --- |
| `DEFAULT_DB_PORT = 5435` in synthesize-episodic.ts | 1 | ≥1 ✓ |
| `"${dbPort}:5432"` in override-yaml string (port-5435 binding) | 1 | ≥1 ✓ |
| `5434` in synthesize-episodic.ts | 0 | 0 ✓ |
| `await import('../src/episodic/consolidate.js')` | 2 | ≥1 ✓ (main + runSiblingConsolidation fallback) |
| `llm.anthropic.messages.parse = vcr.cachedMessagesParse` | 1 | ≥1 ✓ |
| `await import('../src/__tests__/fixtures/vcr.js')` | 1 | ≥1 ✓ |
| `process.env.DATABASE_URL = ` (literal prefix) | 1 | ≥1 ✓ |
| 6 migration paths (0000..0005) | 1 each | 1 each ✓ |
| `process.on('SIGINT'` / `process.on('SIGTERM'` | 1 / 1 | 1 / 1 ✓ |
| `down --volumes` | 1 | ≥1 ✓ |
| `import.meta.url === ` (ESM main-guard) | 1 | ≥1 ✓ |
| `^export` declarations | 7 | ≥5 ✓ (parseCliArgs, Args, DbOverrideOpts, loadFixtureIntoDb, runSiblingConsolidation, dumpEpisodicSummaries, main) |
| `synthesize-episodic` in scripts/test.sh | 0 | 0 ✓ (not in excluded-suite list) |

### CLI direct smoke tests

```
$ npx tsx scripts/synthesize-episodic.ts --help
Usage: npx tsx scripts/synthesize-episodic.ts --primed <name> --seed <int> [--db-port 5435]
  Real-engine episodic synthesis: runConsolidate(day) per synthetic day.
  Throwaway Docker Postgres on port 5435 (NOT the regen-snapshots.sh port).
exit=0

$ npx tsx scripts/synthesize-episodic.ts
synthesize-episodic: --primed and --seed are required
exit=1
```

## Artifacts Handed to Downstream Plans

- **Plan 24-04 (`regenerate-primed.ts` composer)** — chains `fetch-prod-data.ts` → `synthesize-delta.ts` → `synthesize-episodic.ts` → manifest-finalize. The operator CLI contract (`--primed <name> --seed <int>`) is the shape `regenerate-primed.ts` forwards arguments to.
- **Plan 24-04 (`loadPrimedFixture` test harness)** — reuses the **`jsonb_populate_recordset` + FK-safe forward-order bulk-load pattern** established in `loadFixtureIntoDb`. The exported helper signature `loadFixtureIntoDb({ fixtureDir, dbOverride? })` is the template `loadPrimedFixture({ fixtureDir, db })` follows.
- **`dbOverride` param convention** — exported helpers accept `{ dbOverride?: postgres.Sql | null }`; Plan 24-04's harness test injects the test-suite postgres client the same way.

## VCR cache note

The integration test mocks `anthropic.messages.parse` directly via `vi.hoisted()` — the VCR cache is **not** exercised in tests. Under real operator invocation (`npx tsx scripts/synthesize-episodic.ts --primed m008-14days --seed 42`), the sibling-composition swap routes every `runConsolidate` Sonnet call through `cachedMessagesParse`, so:
- **First run per fixture design:** ~$0.02/day × N synthetic days in Sonnet costs, cache populated at `tests/fixtures/.vcr/<sha256>.json`.
- **Subsequent runs (seed/prompt/schema unchanged):** 100% cache hit, zero cost, byte-identical `episodic_summaries.jsonl`.
- **Any prompt/model/schema change:** SHA-256 hash auto-invalidates; cache re-populates on next run at the same ~$0.02/day cost.

This is the core deliverable of the v2.3 pipeline: fresh fixtures are paid-for once per design change, not per test run.

## Known Stubs

None. Plan 24-03 replaced Plan 24-02's `episodic_summaries.jsonl` empty-placeholder contract with the real `runConsolidate`-generated contents. The dump is ordered by `summary_date ASC`, respects UNIQUE(summary_date) (runConsolidate's CONS-03 idempotency), and contains `source_entry_ids` length > 0 per day (confirmed in integration test assertion).

## Self-Check

Files verified to exist:

- `scripts/synthesize-episodic.ts` → FOUND
- `scripts/__tests__/synthesize-episodic.test.ts` → FOUND
- `scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/MANIFEST.json` → FOUND
- `scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/pensieve_entries.jsonl` → FOUND (10 non-empty lines)
- `scripts/__tests__/__fixtures__/synth-episodic/tiny-primed/{pensieve_embeddings,episodic_summaries,decisions,decision_events,decision_capture_state,contradictions,proactive_state,relational_memory}.jsonl` → FOUND (8 empty placeholders)

Commits verified in `git log --oneline main`:

- `460ba97` (test RED — integration test + tiny-primed fixture) → FOUND
- `d0b2ca8` (feat GREEN — synthesize-episodic.ts sibling-composition) → FOUND

Production code modifications verified zero:
- `git diff --stat src/` → empty output

## Self-Check: PASSED

---

*Phase: 24-primed-fixture-pipeline*
*Completed: 2026-04-20*
