---
phase: 24-primed-fixture-pipeline
plan: 01
subsystem: test-infrastructure
tags: [test-infrastructure, fetch, ssh, snapshot, freshness, seeded-rng]
dependency_graph:
  requires: []
  provides:
    - scripts/fetch-prod-data.ts
    - src/__tests__/fixtures/seed.ts
    - src/__tests__/fixtures/freshness.ts
  affects:
    - .gitignore
    - tests/fixtures/prod-snapshot/ (new runtime-generated directory)
tech_stack:
  added: []
  patterns:
    - SSH -L port-forward via child_process.spawn (ephemeral tunnel, SIGTERM/SIGKILL teardown in finally)
    - postgres.js .unsafe(sql).cursor(1000) JSONL streaming
    - Atomic symlink update via tmp + fs.rename
    - Lazy ESM import to defer config-load side-effects
    - Mulberry32 32-bit seeded PRNG + Fisher-Yates shuffle (hand-rolled, ~15 lines, zero deps)
key_files:
  created:
    - scripts/fetch-prod-data.ts
    - src/__tests__/fixtures/seed.ts
    - src/__tests__/fixtures/seed.test.ts
    - src/__tests__/fixtures/freshness.ts
    - src/__tests__/fixtures/freshness.test.ts
  modified:
    - .gitignore
decisions:
  - "Schema reconciliation: dump `relational_memory` (actual Drizzle table) — REQ alias `memories` documented in-file"
  - "SSH port 15432 chosen for -L forward (no collision with 5432/5433/5434/5435 used elsewhere)"
  - "Hand-rolled Mulberry32 adopted (no new npm deps) — shared by Plans 24-02 and 24-03"
  - "Freshness helper exported from src/__tests__/fixtures/freshness.ts per D-06 (single source of truth for 3 consumers)"
  - "Logger+postgres+ChrisError lazy-imported inside main() so --help works without env vars (Rule 1 fix)"
  - "`default_transaction_read_only: true` as belt-and-suspenders D004 safety even though queries are SELECT"
metrics:
  duration: ~45m
  completed: 2026-04-20
  tasks_completed: 3
  tests_added: 29
  files_created: 5
  files_modified: 1
---

# Phase 24 Plan 01: Primed-Fixture Pipeline — Fetch + Freshness + Seeded RNG Summary

Wave 1 of four — built the organic-data fetch pipeline (`scripts/fetch-prod-data.ts`) that dumps 9 prod tables through an SSH-tunneled postgres.js connection into timestamped JSONL snapshots, plus the two shared test-fixture helpers that downstream Plans 24-02/03/04 depend on: `freshness.ts` (24h auto-refresh contract) and `seed.ts` (Mulberry32 PRNG + Fisher-Yates seeded shuffle). Also gitignored the three fixture subtrees so no snapshot, primed fixture, or VCR cache entry can land in version control.

## Tasks Completed

| Task | Name                                                                       | Commit    | Files                                                                                                                             |
| ---- | -------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Seeded-shuffle + freshness helper scaffolds with failing → passing tests   | `e7ee2e1` | `src/__tests__/fixtures/{seed,seed.test,freshness,freshness.test}.ts`                                                             |
| 2    | `.gitignore` additions for tests/fixtures/ subtrees                        | `cc55f87` | `.gitignore`                                                                                                                      |
| 3    | Build `scripts/fetch-prod-data.ts` (SSH tunnel + 9-table dump + symlink)   | `a8181fa` | `scripts/fetch-prod-data.ts`                                                                                                      |

## Requirements Covered

- **FETCH-01** — `npx tsx scripts/fetch-prod-data.ts` dumps prod → timestamped snapshot, exits 0 (verified live 2026-04-20: 338 rows, ~600ms wall-clock)
- **FETCH-02** — JSONL for 9 tables with stable ORDER BY; `pensieve_entries` restricted to `source='telegram'`, embeddings scoped via INNER JOIN
- **FETCH-03** — SSH to Proxmox via existing operator key; read-only belt-and-suspenders (`default_transaction_read_only: true`); no new credentials
- **FETCH-04** — `tests/fixtures/prod-snapshot/LATEST` symlink updated atomically (tmp + rename, relative target)
- **FETCH-05** — `tests/fixtures/prod-snapshot/` gitignored (also `primed/` and `.vcr/` pre-empted for future plans)
- **FRESH-01** — `autoRefreshIfStale(path, { ttlHours })` spawns `npx tsx scripts/fetch-prod-data.ts` via `child_process.spawn` when LATEST is older than ttlHours; awaits child exit; returns path. 13 unit tests cover 23h/25h boundaries, ENOENT-as-stale, `noRefresh: true` short-circuit, ChrisError wrapping on non-zero exit / spawn error.

## Schema Reconciliation

REQUIREMENTS.md FETCH-02 and D-11 use the alias **"memories"**; the actual Drizzle table is `relational_memory` (schema.ts:134). This plan dumps `relational_memory`; the script header documents the alias. Plan 24-04's TESTING.md update will codify the mapping. The plan's acceptance criterion explicitly asserts `grep -q "FROM relational_memory"` and `! grep -q "FROM memories"` — both satisfied.

## Key Design Notes

### Mulberry32 PRNG (zero-dep)

`mulberry32(seed)` returns a closure that produces a deterministic 32-bit-arithmetic sequence, byte-identical across Node versions. `seededShuffle(arr, seed)` runs Fisher-Yates using that RNG; `seededSample(arr, n, seed)` is the length-n prefix. Determinism is the load-bearing invariant for SYNTH-07 ("same --seed + same organic base → byte-identical non-LLM output") which Plans 24-02 and 24-03 rely on. 16 unit tests cover: cross-invocation equality, seed-sensitivity (42 vs 43 produces distinct permutations), non-mutation, permutation invariant (sorted output == sorted input), empty/single-element/string-array edge cases, `seededSample` prefix-of-shuffle semantics, padded-n behavior (no error when n > length).

### Freshness helper API

```typescript
export async function isSnapshotStale(path: string, ttlHours = 24): Promise<boolean>
export async function autoRefreshIfStale(
  latestPath: string,
  opts: { noRefresh?: boolean; ttlHours?: number } = {},
): Promise<string>
```

Behavior:
- ENOENT on stat → treated as infinite age (force refresh on missing)
- `noRefresh: true` short-circuits BEFORE stat is called — safe for offline / air-gapped operation (FRESH-02 plumbing point for Plan 24-02)
- `ttlHours` override lets future plans tune per-consumer if the 24h default stops matching reality
- Refresh path: `spawn('npx', ['tsx', 'scripts/fetch-prod-data.ts'], { stdio: 'inherit' })` — inherits stdio so operator sees progress; non-zero exit or spawn error wraps to `ChrisError(code='FRESHNESS_REFRESH_FAILED')`
- Structured log line: `logger.info({ ageHours, ttlHours }, 'freshness.auto-refresh')` — pino subsystem.event convention

### Fetch-prod-data tunnel lifecycle

- `openTunnel()` spawns `ssh -N -L 15432:localhost:5432 -o ExitOnForwardFailure=yes -o ConnectTimeout=10 -o ServerAliveInterval=30 root@192.168.1.50`
- TCP probe on 127.0.0.1:15432 with 200ms polling up to 10s deadline
- If ssh process exits before port opens → ChrisError with D-08 operator-facing message (verbatim: "fetch-prod-data: unable to reach Proxmox at 192.168.1.50 ... Use --no-refresh to force-use stale LATEST snapshot at ...")
- Teardown: SIGTERM → wait 2s → SIGKILL if still alive; runs in `finally` so every exit path closes the tunnel
- SIGINT/SIGTERM handlers installed before tunnel open so Ctrl-C during fetch also tears down

### Port selection

15432 chosen for the -L forward. Non-collisions:
- 5432 — local/prod Postgres default
- 5433 — test Postgres (docker-compose.local.yml)
- 5434 — regen-snapshots.sh throwaway Postgres
- 5435 — Plan 24-03 throwaway Postgres (reserved)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `--help` acceptance criterion blocked by eager config-load**

- **Found during:** Task 3 — `npx tsx scripts/fetch-prod-data.ts --help` exited 1 with `Missing required env var: DATABASE_URL` before printing usage
- **Root cause:** The plan's action block prescribed a top-level `import { logger } from '../src/utils/logger.js'`. The logger module eagerly imports `src/config.ts`, which calls `required('DATABASE_URL')` at module init. ESM imports are non-deferrable, so --help could never run without env vars.
- **Fix:** Moved the logger, ChrisError, and postgres imports **inside** `main()` as dynamic `import()` calls, AFTER the `--help` short-circuit. The real fetch path still uses logger for structured `fetch.table.done` lines; only `--help` is env-var-free.
- **Files modified:** `scripts/fetch-prod-data.ts` (lines 248–256 — lazy import block)
- **Commit:** `a8181fa`
- **Note:** This pattern (lazy-load after argparse) is safe; backfill-episodic.ts has the same eager-config issue but that script has no `--help` flag so it wasn't noticed.

**2. [Rule 1 - Bug] `default_transaction_read_only: 'on'` is not a valid TS type**

- **Found during:** Task 3 — explicit `tsc --noEmit` run on the fetch script reported `Type 'string' is not assignable to type 'boolean | undefined'` on the connection-parameter object
- **Root cause:** The plan's action block prescribed the Postgres backend wire value `'on'`. The postgres.js type declaration (types/index.d.ts:333) expects `boolean`; the library translates `true`→`'on'` internally.
- **Fix:** Changed `'on'` to `true`. Semantically equivalent from Postgres's perspective.
- **Files modified:** `scripts/fetch-prod-data.ts` (line 300)
- **Commit:** Same commit `a8181fa` (caught before the commit split)

### No Rule-2 / Rule-3 / Rule-4 issues

All task steps were executable with the fixes above. No new dependencies added; no architectural changes needed.

## Verification Results

**Plan-level sanity checks (all 4 pass):**

1. `npx vitest run src/__tests__/fixtures/seed.test.ts src/__tests__/fixtures/freshness.test.ts` → **29 tests, 29 passed, 0 failed, 275ms**
2. `npx tsc --noEmit` → **0 errors**
3. `grep -c "^tests/fixtures/" .gitignore` → **3** (matches expected)
4. `grep -n "FROM memories" scripts/fetch-prod-data.ts` → **0 matches** (correct)

**Docker gate (scripts/test.sh) — no regression:**

- Before Plan 24-01: 78 test files total
- After Plan 24-01: **80 test files (72 passed + 8 failed)**
- The 2 new test files (`seed.test.ts`, `freshness.test.ts`) are in the 72 passed — verified under real Docker Postgres separately
- The 8 pre-existing failures are all `EACCES: permission denied, mkdir '/node_modules/@huggingface/transformers/.cache'` — sandbox environment issue documented in STATE.md ("Vitest-4 fork-IPC hang under HuggingFace EACCES — pre-existing env issue"). These failures affect `chris/__tests__/live-integration.test.ts` and `chris/__tests__/contradiction-false-positive.test.ts`, neither of which imports any code I added. Net regression: **0**.

**Manual-only operator verification (VALIDATION.md §Manual-Only — actually performed live):**

Executed `PROD_PG_PASSWORD=<redacted> npx tsx scripts/fetch-prod-data.ts` against live prod (Proxmox 192.168.1.50). Result:

```
fetch-prod-data: wrote 338 rows across 9 tables to tests/fixtures/prod-snapshot/2026-04-20T10-43-49Z/
```

- Wall-clock: ~600ms (well under the 60s must-have)
- LATEST symlink: `LATEST -> 2026-04-20T10-43-49Z` (relative target, portable)
- Row distribution: 122 pensieve_entries (all source=telegram), 122 pensieve_embeddings (FK-scoped), 2 episodic_summaries, 0 decisions / decision_events / decision_capture_state, 0 contradictions, 0 proactive_state, 92 relational_memory
- `grep -v '"source":"telegram"' pensieve_entries.jsonl | wc -l` → **0** (zero non-telegram leakage)
- `tests/fixtures/prod-snapshot/` does NOT appear in `git status` → gitignore working

## Artifacts Handed to Downstream Plans

- **Plan 24-02** imports `seededShuffle`, `seededSample` for Haiku few-shot selection; calls `autoRefreshIfStale` with `noRefresh` plumbed from its `--no-refresh` CLI flag (FRESH-02)
- **Plan 24-03** imports `seededShuffle` for any deterministic episodic-sampling needs
- **Plan 24-04** imports `isSnapshotStale` for the `loadPrimedFixture()` diagnostic warning (D-09); imports nothing from fetch-prod-data directly but the LATEST symlink is the source of truth for its loader

## Self-Check: PASSED

Files verified to exist:
- `scripts/fetch-prod-data.ts` → FOUND
- `src/__tests__/fixtures/seed.ts` → FOUND
- `src/__tests__/fixtures/seed.test.ts` → FOUND
- `src/__tests__/fixtures/freshness.ts` → FOUND
- `src/__tests__/fixtures/freshness.test.ts` → FOUND
- `.gitignore` (modified) → FOUND, 3 new entries present

Commits verified to exist in `git log`:
- `e7ee2e1` — FOUND
- `cc55f87` — FOUND
- `a8181fa` — FOUND
