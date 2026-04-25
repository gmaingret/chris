---
phase: 24-primed-fixture-pipeline
plan: 04
subsystem: test-infrastructure
tags:
  [
    test-infrastructure,
    loader,
    regenerate,
    docs,
    convention,
    harness,
    fk-safe,
  ]
dependency_graph:
  requires:
    - phase: 24-primed-fixture-pipeline
      plan: 01
      provides: isSnapshotStale helper (D-09 diagnostic); prod-snapshot LATEST symlink
    - phase: 24-primed-fixture-pipeline
      plan: 02
      provides: MANIFEST.json shape; tests/fixtures/primed/ directory layout; organic-tiny
    - phase: 24-primed-fixture-pipeline
      plan: 03
      provides: tiny-primed fixture (reused as load-primed-test-tiny source); jsonb_populate_recordset bulk-load pattern; dbOverride param convention
  provides:
    - src/__tests__/fixtures/load-primed.ts (loadPrimedFixture + LoadPrimedOptions)
    - src/__tests__/fixtures/primed-sanity.test.ts (HARN-03 4-assertion gate)
    - scripts/regenerate-primed.ts (FRESH-03 composer)
    - .planning/codebase/TESTING.md §Primed-Fixture Pipeline (DOC-01)
    - .planning/codebase/CONVENTIONS.md §Test Data (DOC-02)
    - PLAN.md D041 (DOC-02 cross-reference)
  affects:
    - M009+ (loadPrimedFixture is the primary consumer surface for every
      future milestone that needs fused organic+synthetic test data)
tech_stack:
  added: []
  patterns:
    - to_regclass feature-detect for optional tables (D-05 wellbeing_snapshots,
      D-11 conversations) — `SELECT to_regclass('public.<tbl>') AS reg` via
      postgres.js template-tag; silent no-op on absent
    - Strict reverse-FK cleanup then forward-FK bulk-insert via
      jsonb_populate_recordset (no ON CONFLICT — cleanup precedes insert,
      so any duplicate is a genuine fixture bug)
    - Drizzle db.delete() for tables with schema import; raw postgres.Sql
      template-tag for feature-detected tables (no Drizzle schema bindings
      available for wellbeing_snapshots — it doesn't exist pre-M009)
    - child_process.spawn with stdio:'inherit' for operator composer scripts;
      SIGINT/SIGTERM forwarded to the currently-running child (mirrors
      synthesize-episodic.ts lifecycle)
    - Lazy-import logger + freshness inside main() for env-var-free --help
      (third instance of the Rule-1 pattern across Plans 24-01/02/04)
    - Proxy-based dbOverride for test-only observability of feature-detect
      probes + cleanup order (load-primed.test.ts Test 8)
key_files:
  created:
    - src/__tests__/fixtures/load-primed.ts
    - src/__tests__/fixtures/load-primed.test.ts
    - src/__tests__/fixtures/primed-sanity.test.ts
    - scripts/regenerate-primed.ts
    - .planning/phases/24-primed-fixture-pipeline/24-04-SUMMARY.md
  modified:
    - .planning/codebase/TESTING.md (+96 lines — new §Primed-Fixture Pipeline)
    - .planning/codebase/CONVENTIONS.md (+9 lines — new §Test Data with D041 cross-ref)
    - PLAN.md (+1 line — D041 in §Key Decisions table)
decisions:
  - "D-11 FK-cleanup order CORRECTED for schema drift: uses `relational_memory`
    (the actual Drizzle table, schema.ts:134), NOT the REQ-alias `memories`.
    Alias rationale codified in TESTING.md §Primed-Fixture Pipeline for
    future readers."
  - "D-05 wellbeing_snapshots feature-detect extended to D-11 conversations:
    both use the same to_regclass short-circuit; conversations is present in
    the current migration set (0000), wellbeing_snapshots is absent (pre-M009).
    Pattern generalizes for any future optional tables."
  - "D-09 soft-fail is the default: stale organic snapshot warns and proceeds.
    `{ strictFreshness: true }` option is shipped but unused today; first
    consumer will be a future milestone that hard-requires fresh organic."
  - "Test 8 (cleanup ORDER) uses a Proxy-wrapped postgres.Sql client via
    dbOverride. Drizzle deletes do NOT route through this Proxy (different
    code path), so Test 8 verifies the FEATURE-DETECT probes + conversations
    DELETE, plus asserts `DELETE:memories` never fires. Drizzle ORDER is
    guaranteed structurally by the sequential await statements in
    loadPrimedFixture's source — code review catches regressions."
  - "regenerate-primed.ts is a pure child-process composer — zero in-process
    synthesis logic. Each step delegates fully to the producer script, which
    keeps the composer thin (256 LOC) and the producer scripts
    authoritative for their own contracts. Easier to extend in M009+."
  - "primed-sanity test uses `describe.skip` when fixture is absent (instead
    of throwing / never-running). Result: `bash scripts/test.sh` is green in
    sandbox environments without prod access, while producing a clear
    regeneration hint. Operator runs `scripts/regenerate-primed.ts` once
    to flip the test from 4 skipped → 4 running."
  - "D041 (new) takes over from D040 (decimal-phases gap-closure, 2026-04-19).
    Cross-references both TESTING.md and CONVENTIONS.md. Placed in PLAN.md
    §Key Decisions table at row 135 (immediately after D040)."
requirements_completed: [HARN-01, HARN-02, HARN-03, FRESH-03, DOC-01, DOC-02]
metrics:
  duration: ~15m
  started: 2026-04-20T15:41:00Z
  completed: 2026-04-20T15:53:00Z
  tasks_completed: 2
  tests_added: 12
  files_created: 4
  files_modified: 3
---

# Phase 24 Plan 04: Primed-Fixture Pipeline — Test Harness + Regenerate Composer + Convention Codification

**v2.3 closes out.** Plan 24-04 delivers the consumer-facing half of the primed-fixture pipeline: `loadPrimedFixture(name)` seeds the Docker Postgres test DB in FK-safe order; `primed-sanity.test.ts` is the HARN-03 gate that asserts the fixture's four invariants; `scripts/regenerate-primed.ts` chains fetch → synth-delta → synth-episodic for operator rebuilds; and a new project convention (D041, DOC-02) institutionalizes "no milestone may gate on real calendar time for data accumulation."

## Performance

- **Duration:** ~15 minutes (2026-04-20T15:41 → T15:53)
- **Tasks:** 2 (Task 1 TDD — RED/GREEN split commits; Task 2 multi-artifact single-purpose commits)
- **Files created:** 4 (load-primed.ts, load-primed.test.ts, primed-sanity.test.ts, regenerate-primed.ts)
- **Files modified:** 3 (TESTING.md, CONVENTIONS.md, PLAN.md)

## Task Commits

1. **Task 1 RED** — `cbb3cd8` (test) — Failing tests for loadPrimedFixture (8 tests covering MISSING_DIR, FK-safe cleanup, idempotency, collision-safety, stale-warn soft-fail, stale-strict hard-error, wellbeing feature-detect, cleanup ORDER)
2. **Task 1 GREEN** — `6b1a3f1` (feat) — loadPrimedFixture implementation + Test 8 refinement for postgres.js tagged-template interpolation semantics
3. **Task 2: HARN-03 sanity test** — `67fc1bd` (test) — 4 assertions with describe.skip when fixture absent
4. **Task 2: regenerate-primed composer** — `e54144a` (feat) — child-process composer for FRESH-03
5. **Task 2: DOC-01 + DOC-02** — `7258ca0` (docs) — TESTING.md §Primed-Fixture Pipeline + CONVENTIONS.md §Test Data + PLAN.md D041

## Accomplishments

### `loadPrimedFixture(name, opts?)` (HARN-01, HARN-02)

Consumer-facing loader at `src/__tests__/fixtures/load-primed.ts`. Exports:

```typescript
export interface LoadPrimedOptions {
  dbOverride?: postgres.Sql;
  strictFreshness?: boolean; // D-09; default false (warn + proceed)
  ttlHours?: number; // default 24
}

export async function loadPrimedFixture(
  name: string,
  opts?: LoadPrimedOptions,
): Promise<void>;
```

Flow:

1. Resolve `tests/fixtures/primed/<name>/MANIFEST.json` → throw `ChrisError('LOAD_PRIMED_MISSING_DIR')` if absent.
2. Parse MANIFEST; stat the organic snapshot at `tests/fixtures/prod-snapshot/<organic_stamp>/`. If missing, info-log `load.primed.organic.absent`; if stale per `isSnapshotStale(path, ttlHours)`, warn-log `load.primed.organic.stale` or throw `ChrisError('LOAD_PRIMED_STALE_STRICT')` when `strictFreshness: true`.
3. Feature-detect `conversations` + `wellbeing_snapshots` via `to_regclass('public.<tbl>')`.
4. Clear tables in STRICT REVERSE-FK order (`DELETE FROM conversations` if exists → Drizzle deletes for 9 tables → `DELETE FROM wellbeing_snapshots` if exists).
5. Bulk-insert in FORWARD-FK order via `jsonb_populate_recordset` — no `ON CONFLICT DO NOTHING` (cleanup just emptied every table; any conflict surfaces a genuine fixture bug).
6. Info-log `load.primed.done` with per-table counts.

**8 integration tests pass** under `bash scripts/test.sh` (real Docker Postgres, port 5433). Tests exercise: error paths, FK-safety against pre-populated DB, idempotency across repeated calls, collision-safety with pre-seeded fixture UUIDs, D-09 soft-fail, D-09 hard-error, D-05 feature-detect, and (via a Proxy-wrapped dbOverride) cleanup-ORDER verification that `DELETE:memories` never fires.

### HARN-03 sanity gate (`primed-sanity.test.ts`)

At `src/__tests__/fixtures/primed-sanity.test.ts`. Loads `m008-14days` via `loadPrimedFixture('m008-14days')` in `beforeAll` and asserts:

1. ≥ 7 episodic summaries
2. ≥ 200 pensieve entries
3. `UNIQUE(summary_date)` holds (SELECT summary_date, COUNT(*) GROUP BY HAVING > 1 → 0 rows)
4. No rows with `source IN ('immich', 'gmail', 'drive')` in `pensieve_entries`

**`describe.skip` when the fixture is absent** — keeps `bash scripts/test.sh` green in sandbox / CI / pre-regeneration environments while logging a clear hint to run `scripts/regenerate-primed.ts`. The 4 tests appear as "skipped" in vitest output when the fixture is missing, "passing" when it's present.

**NOT in the excluded-suite list** per plan contract: fast, hermetic, graceful-skip.

### `scripts/regenerate-primed.ts` (FRESH-03)

Operator CLI composer at 256 LOC. Chains:

```
scripts/fetch-prod-data.ts
  → scripts/synthesize-delta.ts --organic LATEST --target-days N --seed S --milestone M [--no-refresh]
  → scripts/synthesize-episodic.ts --primed <M>-<N>days --seed S
```

Via `child_process.spawn('npx', ['tsx', <script>, ...args], { stdio: 'inherit' })`. Each step awaits child exit 0; non-zero exits wrap as typed `ChrisError`:

- `REGEN_PRIMED_USAGE`
- `REGEN_PRIMED_FETCH_PROD_DATA_FAILED`
- `REGEN_PRIMED_SYNTHESIZE_DELTA_FAILED`
- `REGEN_PRIMED_SYNTHESIZE_EPISODIC_FAILED`
- `REGEN_PRIMED_SPAWN_FAILED`

`--force` skips the 24h freshness check and always fetches. `--no-refresh` passes through to `synthesize-delta.ts` only (per ROADMAP success criterion 4: FRESH-02 applies to synth, not to the composer's fetch step which is gated by `--force`).

Verified:

```
$ npx tsx scripts/regenerate-primed.ts --help
Usage: npx tsx scripts/regenerate-primed.ts --milestone <name> [--target-days 14] [--seed 42] [--force] [--no-refresh]
  Composer: fetch-prod-data.ts → synthesize-delta.ts → synthesize-episodic.ts.
  --force skips the 24h freshness check and always fetches first.
  --no-refresh passes through to synthesize-delta.ts only (FRESH-02).
exit=0

$ npx tsx scripts/regenerate-primed.ts
regenerate-primed: --milestone is required
exit=1
```

### DOC-01 — `.planning/codebase/TESTING.md` §Primed-Fixture Pipeline

Appended a new section (~96 lines) covering:

- Pipeline overview (organic base via SSH tunnel + synthetic delta via Haiku + real runConsolidate; VCR cache)
- `loadPrimedFixture` usage example
- `regenerate-primed.ts` operator UX (full rebuild vs synth-only)
- 24h freshness policy (producer-side auto-refresh; D-09 load-time soft-fail)
- VCR cache behavior (`tests/fixtures/.vcr/<sha256>.json`, auto-invalidating on any prompt change, `rm -rf` to clear)
- **`memories` vs `relational_memory` alias note** — schema reconciliation: the REQ-ID alias `memories` refers to the actual Drizzle table `relational_memory` (M006 long-term-memory). Grep audits documented.
- `source='telegram'` filter rationale (M008.1 contract; 200× bloat without)
- Sanity gate description with the 4 invariants

### DOC-02 — `.planning/codebase/CONVENTIONS.md` §Test Data + PLAN.md D041

**Exact phrasing** from ROADMAP success criterion 5: *"no milestone may gate on real calendar time for data accumulation — use the primed-fixture pipeline instead."* Added as a new `## Test Data` section in CONVENTIONS.md with cross-references to TESTING.md and PLAN.md.

**PLAN.md D041** (`.planning/PROJECT.md` is a symlink to PLAN.md, so both paths are updated in one edit):

> **D041 — Test data via primed-fixture pipeline (v2.3) — no calendar-time data-accumulation gates.** No milestone may gate on real wall-clock time for data accumulation (e.g. "wait 7 days to accumulate real episodic summaries before M009 can be tested"). The primed-fixture pipeline (Phase 24) produces fused organic+synthetic test fixtures on demand — organic base from live prod via SSH-tunneled postgres.js dump, synthetic delta via per-day Haiku style-transfer + real `runConsolidate()` episodic synthesis, all VCR-cached. Tests consume via `loadPrimedFixture('m008-14days')`. See `.planning/codebase/TESTING.md §Primed-Fixture Pipeline` and `.planning/codebase/CONVENTIONS.md §Test Data`. Replaces the v2.2 pain point where M008 testing implicitly gated M009 planning on 7 real calendar days of Greg's active use.

(D040 was already allocated to decimal-phases-gap-closure pattern on 2026-04-19; D041 is the next free number.)

## Files Created/Modified

### Created

| Path                                                 | LOC | Purpose                                                                                                                              |
| ---------------------------------------------------- | --: | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/__tests__/fixtures/load-primed.ts`              | 282 | `loadPrimedFixture(name, opts?)` — FK-safe cleanup + forward-FK bulk insert + D-05/D-11 feature detection + D-09 stale diagnostic    |
| `src/__tests__/fixtures/load-primed.test.ts`         | 375 | 8 integration tests (Docker Postgres) covering MISSING_DIR, FK-safety, idempotency, collision-safety, stale behaviors, cleanup ORDER |
| `src/__tests__/fixtures/primed-sanity.test.ts`       |  93 | HARN-03 4-assertion gate with describe.skip when fixture absent                                                                      |
| `scripts/regenerate-primed.ts`                       | 256 | Operator CLI composer: fetch-prod-data → synthesize-delta → synthesize-episodic                                                      |

### Modified

| Path                                                 | Δ lines | What changed                                                                |
| ---------------------------------------------------- | ------: | --------------------------------------------------------------------------- |
| `.planning/codebase/TESTING.md`                      |     +96 | New `## Primed-Fixture Pipeline` section                                    |
| `.planning/codebase/CONVENTIONS.md`                  |      +9 | New `## Test Data` section with the exact DOC-02 convention phrasing        |
| `PLAN.md`                                            |      +1 | New D041 row in §Key Decisions table                                        |

Plan-level `git diff --stat src/ 6b1a3f1..main` shows **only** additions under `src/__tests__/fixtures/` (3 files, +750 lines). Zero production code modifications.

## Decisions Made

### D-11 FK-cleanup order uses `relational_memory`, NOT `memories`

The original CONTEXT.md D-11 listed `memories` as the second-to-last table in the reverse-FK cleanup chain. The actual Drizzle schema defines `relational_memory` (schema.ts:134) — no `memories` table exists in any migration. The loader uses the real table name; the REQ-ID alias `memories` (REQUIREMENTS.md FETCH-02, CONTEXT §D-11) is a documentation leftover from pre-M006 naming.

Plan 24-01 already shipped this reconciliation in `scripts/fetch-prod-data.ts` with an in-file comment. Plan 24-04 codifies it further in TESTING.md as the single locus for future readers. Acceptance criterion `grep -c "from '.*schema\.js'.*memories\b" src/__tests__/fixtures/load-primed.ts` returns 0.

### D-05 extended to D-11 conversations via the same feature-detect shape

Both `wellbeing_snapshots` (absent pre-M009, D-05) and `conversations` (present from migration 0000, D-11 feature-detect edge case) use the same `SELECT to_regclass('public.<tbl>') AS reg` probe. If absent → skip cleanup + load silently. This generalizes the pattern for any future optional tables M009+ might add (e.g. `wellbeing_snapshots`, `rituals`, `daily_notes`).

### D-09 stale-warn default is soft-fail; `strictFreshness: true` option shipped for future use

`loadPrimedFixture` does NOT auto-invoke `autoRefreshIfStale` at test runtime — tests should be hermetic. Instead:

- Default behavior: stale organic snapshot → `logger.warn({...}, 'load.primed.organic.stale')` and proceed.
- `{ strictFreshness: true }`: throws `ChrisError('LOAD_PRIMED_STALE_STRICT')` with an operator-facing hint to run `scripts/regenerate-primed.ts --milestone <m> --force`.

The strict option is shipped today but has no in-tree consumer — it's a future hook for any M009+ milestone that hard-requires fresh organic (e.g. a time-critical wellbeing-reconciliation test).

### Test 8 cleanup-ORDER verification uses Proxy-wrapped `dbOverride`

Drizzle's `db.delete()` path does NOT route through the caller's postgres.Sql override — it's bound to the module-singleton `sql`. Only the feature-detected table operations (`DELETE FROM conversations`, `DELETE FROM wellbeing_snapshots`) and the `to_regclass` probes route through the `client` variable that accepts `dbOverride`. Therefore Test 8's Proxy observes:

- `PROBE:conversations` + `PROBE:wellbeing_snapshots` (both feature-detects)
- `DELETE:conversations` (template-tag path)
- NOT any of the 9 Drizzle deletes
- NOT `DELETE:memories` (plan-level structural guarantee)

The 9 Drizzle delete-statement ORDER is guaranteed structurally by sequential `await` statements in `loadPrimedFixture` source code. Code review catches regressions; plan-level acceptance criterion `grep -n "db\.delete\|DELETE FROM" src/__tests__/fixtures/load-primed.ts` inspects the ORDER at review time. Documented in Test 8's comment.

### regenerate-primed.ts is a pure composer — no in-process synthesis

Each step is a child-process spawn with inherited stdio. Zero synthesis logic in the composer itself. This keeps the composer thin (256 LOC, most of which is argparse + error-code taxonomy) and the producer scripts (fetch-prod-data.ts / synthesize-delta.ts / synthesize-episodic.ts) authoritative for their own contracts. Adding a new synthesis step in M009+ is a one-line spawn-insertion away.

### primed-sanity test gracefully skips on missing fixture

`describe.skip` when `tests/fixtures/primed/m008-14days/MANIFEST.json` is absent. Keeps `bash scripts/test.sh` green in sandboxes / CI / pre-regeneration environments while logging a visible hint. Operator runs `scripts/regenerate-primed.ts --milestone m008 --target-days 14 --seed 42 --force` once → the 4 tests flip from "skipped" to "running" → HARN-03 invariants asserted on real Docker Postgres. Plan-level manual-verification handshake (not gated by this sandbox).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test 8 Proxy missed to_regclass probes (RED → GREEN iteration)**

- **Found during:** Task 1 GREEN — first run of `bash scripts/test.sh src/__tests__/fixtures/load-primed.test.ts` showed 7 pass + 1 fail.
- **Issue:** The Test 8 Proxy apply trap joined `TemplateStringsArray.raw` into a single string and regex-searched for `public.(\w+)`. But postgres.js's tagged-template call shape is `sql\`SELECT to_regclass(${qualified}) AS reg\`` → `TemplateStringsArray.raw = ['SELECT to_regclass(', ') AS reg']` and `qualified = 'public.wellbeing_snapshots'` is the INTERPOLATION (argArray[1]), not the raw literal. The regex found nothing.
- **Fix:** Inspect both `raw` and the interpolation arguments. The Proxy apply trap now finds `public.<tbl>` in `argArray.slice(1)` string interpolations. After fix, 8/8 pass.
- **Files modified:** `src/__tests__/fixtures/load-primed.test.ts` (Test 8 apply handler)
- **Commit:** `6b1a3f1` (Task 1 GREEN — same commit as implementation)

**2. [Rule 3 - Blocking] `dbOverride` in LoadPrimedOptions can't inject through Drizzle**

- **Found during:** Task 1 GREEN planning phase, before writing the implementation.
- **Issue:** The plan's action block prescribed `const dbx = opts.dbOverride ? db : db;` with the comment "Drizzle routes through connection.ts." Drizzle's `db` is bound to the module-level singleton `sql` (from `db/connection.ts`), so `dbOverride` cannot actually redirect Drizzle queries. The plan's code block was contradictory in its own comment.
- **Fix:** `loadPrimedFixture` accepts `dbOverride?: postgres.Sql` which only routes the feature-detect probes and feature-gated DELETEs (`conversations`, `wellbeing_snapshots`) — the 9 Drizzle deletes + 11 bulk inserts go through the module singleton. Documented explicitly in the `LoadPrimedOptions.dbOverride` TSDoc. In practice, test suites use the singleton via `scripts/test.sh`'s DATABASE_URL, so the limitation is invisible. Test 8 adapts to observe only the template-tag path, asserting ORDER structurally via source inspection for Drizzle calls.
- **Files modified:** `src/__tests__/fixtures/load-primed.ts` (dbOverride type + TSDoc), `src/__tests__/fixtures/load-primed.test.ts` (Test 8 assertions)
- **Commit:** `6b1a3f1`

### No Rule-2 / Rule-4 issues

No missing critical functionality (Rule 2) or architectural-scope escalation (Rule 4) was required. All deviations were scoped-down implementation corrections against plan pseudocode that was slightly ahead of the actual Drizzle API surface.

## Verification Results

### Plan-level checks (all pass)

1. **Plan-scoped suite:** `bash scripts/test.sh src/__tests__/fixtures/load-primed.test.ts src/__tests__/fixtures/primed-sanity.test.ts --reporter=verbose` → **8 passed + 4 skipped (12 total), 1.06s**. The 4 skipped are primed-sanity's HARN-03 assertions (fixture absent in sandbox; skip path is correct).
2. **`npx tsc --noEmit`** → 0 errors.
3. **Schema reconciliation:** `grep -n "from '.*schema\.js'.*memories\b" src/__tests__/fixtures/load-primed.ts` → **0 matches** (uses `relationalMemory`).
4. **D-11 FK-cleanup order (source inspection):**
   ```
   228:    await client`DELETE FROM conversations`;    (conversations — FK-depth 0)
   230:  await db.delete(contradictions);
   231:  await db.delete(pensieveEmbeddings);
   232:  await db.delete(decisionEvents);
   233:  await db.delete(episodicSummaries);
   234:  await db.delete(decisionCaptureState);
   235:  await db.delete(decisions);
   236:  await db.delete(pensieveEntries);
   237:  await db.delete(proactiveState);
   238:  await db.delete(relationalMemory);              (relational_memory — NOT memories)
   240:    await client`DELETE FROM wellbeing_snapshots`; (wellbeing — feature-gated)
   ```
   Matches D-11 exactly (with the corrected alias).
5. **regenerate-primed composer sequence:**
   ```
   204:      await runScript('scripts/fetch-prod-data.ts', []);
   225:    await runScript('scripts/synthesize-delta.ts', synthDeltaArgs);
   233:    await runScript('scripts/synthesize-episodic.ts', [...]);
   ```
   3 calls in order: fetch → synth-delta → synth-episodic.
6. **DOC-02 convention phrasing (exact):**
   ```
   grep -c "no milestone may gate on real calendar time" .planning/codebase/CONVENTIONS.md → 1
   grep -c "primed-fixture pipeline" PLAN.md                                              → 5
   ```
7. **Full excluded-suite Docker gate:** **76 passed / 1 skipped / 3 failed (80 files) — 1092 passed / 4 skipped / 15 failed (1111 tests) in 33.67s.** The 15 failures are pre-existing (documented in Plans 24-02/03 SUMMARYs):
   - 7 × `src/chris/__tests__/engine-mute.test.ts` (drizzle-mock regression from Phase 22)
   - 5 × `src/chris/__tests__/photos-memory.test.ts` (same drizzle-mock regression)
   - 3 × `src/llm/__tests__/models-smoke.test.ts` (401 with test-key — pre-existing)
   Net regression: **0**. Plan 24-04 adds +2 test files (load-primed.test.ts 8 pass, primed-sanity.test.ts 4 skip).

### Acceptance-criteria grep verification

| Grep target                                                         | Count | Expected |
| ------------------------------------------------------------------- | ----: | -------- |
| `relationalMemory` in load-primed.ts                                |     2 | ≥1 ✓     |
| `from '.*schema\.js'.*memories\b` in load-primed.ts                 |     0 | 0 ✓      |
| `to_regclass` in load-primed.ts                                     |     3 | ≥1 ✓     |
| `isSnapshotStale` in load-primed.ts                                 |     3 | ≥1 ✓     |
| `LOAD_PRIMED_STALE_STRICT` in load-primed.ts                        |     3 | ≥1 ✓     |
| `^export` declarations in load-primed.ts                            |     2 | ≥2 ✓ (LoadPrimedOptions + loadPrimedFixture) |
| `load-primed.test.ts` in scripts/test.sh (must NOT be present)      |     0 | 0 ✓      |
| `loadPrimedFixture('m008-14days')` in primed-sanity.test.ts         |  match| ≥1 ✓ (via FIXTURE_NAME constant) |
| `describe.skip` / `skipIfAbsent` in primed-sanity.test.ts           |     3 | ≥1 ✓     |
| `primed-sanity` in scripts/test.sh (must NOT be present)            |     0 | 0 ✓      |
| 3 spawn targets in regenerate-primed.ts                             |     3 | 3 ✓      |
| `isSnapshotStale(latestPath, 24)` in regenerate-primed.ts           |     1 | ≥1 ✓     |
| `--no-refresh` pass-through in regenerate-primed.ts                 | match | ≥1 ✓ (synthDeltaArgs.push) |
| ESM main-guard in regenerate-primed.ts                              |     1 | ≥1 ✓     |
| `## Primed-Fixture Pipeline` header in TESTING.md                   |     1 | ≥1 ✓     |
| `relational_memory` alias note in TESTING.md                        |     3 | ≥1 ✓     |
| `loadPrimedFixture` in TESTING.md                                   |     4 | ≥1 ✓     |
| `no milestone may gate on real calendar time` in CONVENTIONS.md     |     1 | ≥1 ✓     |
| `primed-fixture pipeline` in PLAN.md                                |     5 | ≥1 ✓     |

### CLI direct smoke tests (regenerate-primed.ts)

```
$ npx tsx scripts/regenerate-primed.ts --help
Usage: npx tsx scripts/regenerate-primed.ts --milestone <name> [--target-days 14] [--seed 42] [--force] [--no-refresh]
  Composer: fetch-prod-data.ts → synthesize-delta.ts → synthesize-episodic.ts.
  --force skips the 24h freshness check and always fetches first.
  --no-refresh passes through to synthesize-delta.ts only (FRESH-02).
exit=0

$ npx tsx scripts/regenerate-primed.ts
regenerate-primed: --milestone is required
exit=1
```

## Requirements Covered

| REQ-ID  | Status   | Delivery path                                                                                               |
| ------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| HARN-01 | complete | `src/__tests__/fixtures/load-primed.ts` exports `loadPrimedFixture(name, opts?)`                            |
| HARN-02 | complete | FK-safe cleanup (D-11, corrected) + idempotency + collision-safety, 8/8 tests pass                          |
| HARN-03 | complete | `src/__tests__/fixtures/primed-sanity.test.ts` with 4 invariants; `describe.skip` when fixture absent       |
| FRESH-03| complete | `scripts/regenerate-primed.ts` chains 3 producer scripts; --force + --no-refresh contracts verified         |
| DOC-01  | complete | `.planning/codebase/TESTING.md §Primed-Fixture Pipeline` with alias note + VCR cache + sanity-gate sections |
| DOC-02  | complete | `.planning/codebase/CONVENTIONS.md §Test Data` (exact phrasing) + `PLAN.md` D041 cross-reference            |

All 6 requirements complete. **Phase 24 v2.3 SHIPS (4/4 plans).**

## Artifacts Handed to Downstream Consumers

- **M009+ milestone tests** import `loadPrimedFixture` from `src/__tests__/fixtures/load-primed.js` in their `beforeAll` for pre-populated DB state. The `strictFreshness: true` option is available for any test that hard-requires fresh organic.
- **Operators** run `npx tsx scripts/regenerate-primed.ts --milestone <name> --target-days <N> --seed <S> [--force] [--no-refresh]` to rebuild a fixture on demand. The `m008-14days` fixture name is the HARN-03 sanity-gate target.
- **Future phases** (M010+ profile inference, M011+ psychology layer, M013+ ritual tests) inherit the convention codified in D041 + CONVENTIONS.md §Test Data: no milestone may gate on real calendar time; use the pipeline.

## Known Stubs

None. Plan 24-04 is the consumer-facing closure of v2.3; there is no intentional placeholder left behind. The primed-sanity test `describe.skip` when the fixture is absent is NOT a stub — it's an intentional skip-guard so the test gate stays green across environments while the real assertions run the moment an operator generates the fixture.

## Self-Check

Files verified to exist:

- `src/__tests__/fixtures/load-primed.ts` → FOUND
- `src/__tests__/fixtures/load-primed.test.ts` → FOUND
- `src/__tests__/fixtures/primed-sanity.test.ts` → FOUND
- `scripts/regenerate-primed.ts` → FOUND
- `.planning/codebase/TESTING.md` → FOUND (new section appended)
- `.planning/codebase/CONVENTIONS.md` → FOUND (new §Test Data section)
- `PLAN.md` → FOUND (new D041 row)

Commits verified in `git log --oneline main`:

- `cbb3cd8` (test RED load-primed) → FOUND
- `6b1a3f1` (feat GREEN load-primed) → FOUND
- `67fc1bd` (test HARN-03 sanity) → FOUND
- `e54144a` (feat regenerate-primed) → FOUND
- `7258ca0` (docs DOC-01 + DOC-02) → FOUND

Production code modifications verified zero:

- `git diff --stat 6b1a3f1~1..main -- src/` → 3 files, all under `src/__tests__/fixtures/`

## Self-Check: PASSED

---

*Phase: 24-primed-fixture-pipeline*
*Completed: 2026-04-20*
*v2.3 Test Data Infrastructure: SHIPPED (4/4 plans, 20/20 requirements, 2026-04-20)*
