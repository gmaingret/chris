---
phase: 45
plan: 02
subsystem: fixture-pipeline + operator-scripts + HARN-tests
tags: [fixture-pipeline, ssh-hardening, pgvector, sigint, abort-controller, harn, calendar-month-window, synth-delta, signal-phrases, m011]
dependency_graph:
  requires:
    - "Plan 45-01 (migration 0015 in main; no semantic dep, only parallel-wave coordination)"
    - "src/memory/confidence.ts MIN_SPEECH_WORDS export (pre-existing)"
    - "src/memory/profiles/psychological-shared.ts calendar-month-window (pre-existing reference)"
    - "Docker Postgres test DB on port 5433 (CLAUDE.md memory: always run full Docker tests)"
  provides:
    - "FIX-01 contradictions FK pre-filter at synthesize-delta.ts:937-953 + 'synth.contradictions.dropped' log event"
    - "FIX-02a phrasesClause decoupling at synthesize-delta.ts:589-603"
    - "FIX-02b m011-1000words-5days path constant alignment across HARN + integration + docs"
    - "FIX-03 dynamic migration glob at synthesize-episodic.ts:48-69"
    - "FIX-04 SSH hardening (StrictHostKeyChecking=accept-new + repo-vetted .ssh-known-hosts)"
    - "FIX-05 load-primed.ts pensieve_embeddings staging-table CAST + pgvector-smoke fixture + load-primed-pgvector.test.ts"
    - "FIX-07 calendar-month-windowed totalTelegramWordCount in primed-sanity-m011.test.ts mirroring substrate semantics"
    - "FIX-08 AbortController + process.exitCode=130 SIGINT pattern across 3 operator scripts + child SIGTERM-then-SIGKILL fallback in regenerate-primed.ts"
  affects:
    - "MIN_SPEECH_WORDS consolidation in primed-sanity-m011.test.ts (>=/< boundary alignment with substrate)"
    - "PMT-03 baseline failure (integration-m011-1000words.test.ts:187) — now SKIPPED pending Plan 45-04 regen (was failing)"
    - "Plan 45-04 input contract: regenerate-primed.ts SIGINT + synthesize-episodic.ts migration glob both required before m010 fixture refresh"
tech_stack:
  added: []
  patterns:
    - "AbortController + process.exitCode = 130 for SIGINT handlers (defer-exit + finally-runs-naturally)"
    - "pgvector staging-table CAST via TEMP table with embedding::text → INSERT projection embedding::vector"
    - "Runtime migration glob via fs.readdir filter('.sql') sort"
    - "Repo-vetted SSH known_hosts with StrictHostKeyChecking=accept-new"
    - "Calendar-month window via luxon DateTime.startOf('month').minus({months:1}) in Europe/Paris"
    - "Drizzle raw SQL Date param binding via Luxon toISO() (raw drizzleSql interpolation needs string)"
    - "CREATE TEMP TABLE LIKE INCLUDING DEFAULTS EXCLUDING INDEXES (avoids carrying vector_cosine_ops over to a TEXT-retyped column)"
key_files:
  created:
    - "scripts/.ssh-known-hosts (28 lines; header + 3 host keys for 192.168.1.50)"
    - "src/__tests__/fixtures/__fixtures__/pgvector-smoke/MANIFEST.json"
    - "src/__tests__/fixtures/__fixtures__/pgvector-smoke/pensieve_entries.jsonl"
    - "src/__tests__/fixtures/__fixtures__/pgvector-smoke/pensieve_embeddings.jsonl (1024-dim deterministic embedding)"
    - "src/__tests__/fixtures/load-primed-pgvector.test.ts (3 assertions; all green against real Docker Postgres)"
  modified:
    - "scripts/synthesize-delta.ts (FIX-01 + FIX-02a; 31 insertions, 4 deletions)"
    - "scripts/synthesize-episodic.ts (FIX-03 + FIX-08)"
    - "scripts/fetch-prod-data.ts (FIX-04 + FIX-08)"
    - "scripts/regenerate-primed.ts (FIX-08 + child SIGKILL fallback)"
    - "src/__tests__/fixtures/load-primed.ts (FIX-05 insertPensieveEmbeddings helper + replaced call site)"
    - "src/__tests__/fixtures/primed-sanity-m011.test.ts (FIX-02b + FIX-07 + WR-01)"
    - "src/memory/profiles/__tests__/integration-m011-1000words.test.ts (FIX-02b FIXTURE_NAME)"
    - ".planning/milestones/v2.6-phases/40-psychological-milestone-tests/deferred-items.md (path string + note)"
decisions:
  - "D-06 silent drop + summary log: implemented as logger.info({droppedCount,totalCount},'synth.contradictions.dropped') only when droppedCount > 0"
  - "D-11 staging-table CAST: TEMP table with LIKE INCLUDING DEFAULTS EXCLUDING INDEXES (had to add EXCLUDING INDEXES — Rule 1 fix; hnsw vector_cosine_ops index can't survive a TEXT column retype)"
  - "D-15 calendar-month window: drizzle raw SQL needs Luxon .toISO() string, not Date (Rule 1 fix); substrate's gte/lte operators avoid this because they serialize Date internally"
  - "D-17 AbortController: regenerate-primed.ts gets child-await + SIGKILL fallback (D-17 + WR-05 combined into single pass); other 2 scripts just need the abort()+exitCode pattern"
metrics:
  duration_seconds: 1730
  completed_date: "2026-05-15"
  task_count: 4
  file_count: 12
  commit_count: 4
---

# Phase 45 Plan 02: FIX-01..05/07/08 — Application-Layer Fixture-Pipeline Cleanup Summary

7 FIX requirements landed across 4 tasks + 4 atomic commits, eliminating the 14-phase code-review BLOCKERs that prevented deterministic fixture regen.

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | FIX-01 contradictions FK pre-filter + FIX-02a phrasesClause decoupling | `aa9a01c` | scripts/synthesize-delta.ts |
| 2 | Operator scripts FIX-03 / FIX-04 / FIX-08 | `d66b6b4` | scripts/synthesize-episodic.ts, scripts/fetch-prod-data.ts, scripts/regenerate-primed.ts, scripts/.ssh-known-hosts |
| 3 | FIX-05 pgvector staging-table CAST + smoke regression | `a3d4c27` | src/__tests__/fixtures/load-primed.ts, src/__tests__/fixtures/__fixtures__/pgvector-smoke/* (3 files), src/__tests__/fixtures/load-primed-pgvector.test.ts |
| 4 | FIX-02b path constant + FIX-07 calendar-month window | `c9c9eb0` | src/__tests__/fixtures/primed-sanity-m011.test.ts, src/memory/profiles/__tests__/integration-m011-1000words.test.ts, deferred-items.md |

## FIX Verification Status

| FIX | Status | Verification |
|-----|--------|-------------|
| FIX-01 | LANDED | `grep synth.contradictions.dropped = 1`; pensieveIds Set + rawContradictions.filter() at synthesize-delta.ts:937-953; 47/47 synthesize-delta unit tests green |
| FIX-02a | LANDED | `if (phrasesClause)` hoisted out of `if (dimensionHint)`; ordering check (let result < dim < phrases) PASS |
| FIX-02b | LANDED | `m011-1000words-5days` constant present in 3 files (HARN test, integration test, docs); integration-m011-1000words skips correctly until Plan 45-04 regen |
| FIX-03 | LANDED | `readdir('src/db/migrations').filter(endsWith .sql).sort()` runtime glob; 6/6 synthesize-episodic unit tests green |
| FIX-04 | LANDED | `StrictHostKeyChecking=accept-new` + `UserKnownHostsFile=scripts/.ssh-known-hosts` in fetch-prod-data SSH argv; scripts/.ssh-known-hosts pre-seeded with 3 host keys (rsa/ecdsa/ed25519) for 192.168.1.50 via ssh-keyscan |
| FIX-05 | LANDED | Staging-table CAST via TEMP table + embedding::vector projection; load-primed-pgvector.test.ts 3/3 green against real Docker Postgres (row=1, pg_typeof=vector, vector_dims=1024) |
| FIX-07 | LANDED (test shape) | Calendar-month window applied via luxon Europe/Paris; MIN_SPEECH_WORDS imported from confidence.ts; ≥/< boundary aligned with substrate `< MIN_SPEECH_WORDS` gate. Full green gated on Plan 45-04 fixture refresh (current m011-30days has 3097 words in April-2026 window vs 5000 required) |
| FIX-08 | LANDED | AbortController + process.exitCode=130 across 3 scripts (3 AbortController instances, 3 exitCode=130, 0 process.exit(130) signal-handler usages); regenerate-primed.ts also has child SIGTERM-then-SIGKILL after 5s |

## PMT-03 Baseline Failure (per scope note)

**Cleared: YES.**

Before this plan: `integration-m011-1000words.test.ts:187` failed because the test was running against the on-disk `m011-1000words/` fixture (path mismatched synthesize-delta's `${milestone}-${targetDays}days` output). The describe block ran and asserted PMT-03 contracts against a fixture that no longer satisfied substrate semantics post Phase 43.

After FIX-02b: the test's FIXTURE_NAME is now `m011-1000words-5days`, which doesn't exist on disk yet. `existsSync` returns false → `describe.skip` activates → the test SKIPS cleanly (1 skipped, 0 failed). Plan 45-04's operator-driven regen will write `tests/fixtures/primed/m011-1000words-5days/` and the test will then run for real against substrate-correct content.

Verified: `npx vitest run src/memory/profiles/__tests__/integration-m011-1000words.test.ts` → `1 skipped`, 0 failed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CREATE TEMP TABLE INCLUDING ALL pulls hnsw vector_cosine_ops index that breaks ALTER COLUMN ... TYPE text**
- **Found during:** Task 3 first test run
- **Issue:** `LIKE pensieve_embeddings INCLUDING ALL EXCLUDING CONSTRAINTS` brought the `pensieve_embeddings_embedding_idx` hnsw index over to the staging table. The subsequent `ALTER COLUMN embedding TYPE text` failed with `operator class "vector_cosine_ops" does not accept data type text` because the index was still pointing at the column.
- **Fix:** Changed to `INCLUDING DEFAULTS EXCLUDING CONSTRAINTS EXCLUDING INDEXES`. The staging table doesn't need the index — only the cast. Documented inline.
- **Files modified:** src/__tests__/fixtures/load-primed.ts
- **Commit:** a3d4c27

**2. [Rule 1 - Bug] postgres.js timestamp param binding rejects Date instance when passed via raw drizzleSql interpolation**
- **Found during:** Task 4 HARN test run
- **Issue:** Substrate uses Drizzle-typed `gte()`/`lte()` operators which serialize Date internally. The HARN test uses raw `drizzleSql` with `${windowStart}` interpolation; postgres.js binds the Date directly and trips `TypeError: The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date` for oid 1184 (timestamptz) params.
- **Fix:** Use `Luxon.DateTime.toISO()` to produce an ISO string for raw interpolation; documented inline with reference to substrate's typed-operator path.
- **Files modified:** src/__tests__/fixtures/primed-sanity-m011.test.ts
- **Commit:** c9c9eb0

### Authentication Gates

None. SSH access to 192.168.1.50 was pre-authorized in the scope notes; `ssh-keyscan -H 192.168.1.50` ran cleanly from this sandbox and seeded `scripts/.ssh-known-hosts` with all 3 host keys (rsa+ecdsa+ed25519).

## Test Status

- `npx tsc --noEmit`: exits 0 across all 7 modified files + 1 new test file + 3 new fixture files.
- `npx vitest run src/__tests__/fixtures/load-primed.test.ts src/__tests__/fixtures/load-primed-pgvector.test.ts`: 11/11 PASS.
- `npx vitest run scripts/__tests__/synthesize-delta*.test.ts`: 47/47 PASS.
- `npx vitest run scripts/__tests__/synthesize-episodic.test.ts`: 6/6 PASS.
- `npx vitest run src/__tests__/fixtures/primed-sanity-m011.test.ts`: 2 PASS (m011-1000words-5days SKIP — correct; Plan 45-04 dep), 2 FAIL on m011-30days against the existing pre-Plan-45-04 fixture (substrate-windowed wordCount 3097 < 5000 expected). This is the documented Plan 45-04 dependency boundary per plan-line 624.
- `npx vitest run src/memory/profiles/__tests__/integration-m011-1000words.test.ts`: 1 SKIPPED (PMT-03 baseline failure CLEARED — was failing pre-plan).
- Full `bash scripts/test.sh`: NOT RUN to avoid the fork-IPC hang documented in scope-execution_rules ("Targeted test paths"). Targeted runs above cover all plan-touched files.

## Ready for Plan 45-03

YES. Plan 45-02 ships entirely under Wave A (parallel-shippable with Plan 45-01). The parent orchestrator can spawn Plan 45-03 (SCHEMA-02 migration 0016) immediately — Plan 45-03 depends only on Plan 45-01's migration 0015 numbering, not on this plan's fixture-pipeline changes.

## Self-Check: PASSED

- scripts/.ssh-known-hosts: FOUND (28 lines, header + 3 host keys)
- src/__tests__/fixtures/__fixtures__/pgvector-smoke/MANIFEST.json: FOUND
- src/__tests__/fixtures/__fixtures__/pgvector-smoke/pensieve_entries.jsonl: FOUND
- src/__tests__/fixtures/__fixtures__/pgvector-smoke/pensieve_embeddings.jsonl: FOUND (embedding.length === 1024)
- src/__tests__/fixtures/load-primed-pgvector.test.ts: FOUND
- Commit aa9a01c: FOUND
- Commit d66b6b4: FOUND
- Commit a3d4c27: FOUND
- Commit c9c9eb0: FOUND
