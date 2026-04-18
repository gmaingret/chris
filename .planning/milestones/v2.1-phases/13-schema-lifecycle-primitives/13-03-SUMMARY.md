---
phase: 13
plan: 03
subsystem: db/migrations + test-harness
tags: [database, migrations, blocking, docker-postgres]
requirements-completed: [LIFE-01, LIFE-04, LIFE-06]
dependency-graph:
  requires:
    - src/db/migrations/0000_curved_colonel_america.sql
    - src/db/migrations/0001_add_photos_psychology_mode.sql
    - src/db/migrations/0002_decision_archive.sql
    - src/db/migrations/0003_add_decision_epistemic_tag.sql
    - scripts/test.sh (Plan 02 added 0002 + 0003 apply lines)
  provides:
    - Live Docker Postgres schema with all 4 migrations applied
    - GREEN schema.test.ts (9/9) proving LIFE-01, LIFE-04, LIFE-06
  affects:
    - Plan 04 (lifecycle/transitionDecision) can now run against a real schema
    - Plan 05 (regenerate + capture-state helpers) can exercise live tables
tech-stack:
  added: []
  patterns: [docker-pg-migration-push, live-information-schema-assertions]
key-files:
  created: []
  modified:
    - src/decisions/__tests__/schema.test.ts
decisions:
  - Test fix (Rule 1 auto-fix) — NOT NULL INSERTs must include every other NOT NULL column to isolate the intended constraint. decision_text was also NOT NULL so the original INSERT tripped its constraint first and produced a misleading regex-mismatch failure. Fix is a test-only change; schema itself was already correct.
metrics:
  duration: ~4m
  completed: 2026-04-15
  tasks: 1
  files-created: 0
  files-modified: 1
---

# Phase 13 Plan 03: [BLOCKING] Push Migrations to Docker PG Summary

All four migrations (0000, 0001, 0002, 0003) are applied to the live `pgvector/pgvector:pg16` Docker Postgres test database; `schema.test.ts` is GREEN (9/9); the pre-existing `contradiction-integration.test.ts` is GREEN (8/8) — no regression. Docker PG is left running with schema present for Plans 04 and 05.

## What Was Done

1. **Clean-slate Docker boot.** `docker compose -f docker-compose.local.yml down -v` → `up -d postgres` → waited for `pg_isready` (ready in 1s).
2. **Applied migrations in order** via `cat <sql> | docker compose exec -T postgres psql -U chris -d chris -v ON_ERROR_STOP=1`:
   - 0000_curved_colonel_america.sql — base schema
   - 0001_add_photos_psychology_mode.sql — PHOTOS/PSYCHOLOGY enum additions
   - 0002_decision_archive.sql — decision_status / decision_capture_stage / decision_event_type enums + 3 tables + indexes
   - 0003_add_decision_epistemic_tag.sql — ALTER TYPE epistemic_tag ADD VALUE 'DECISION'
   All four exited 0.
3. **Ran the 5 live-DB smoke queries** (outputs below) — all pass expectations.
4. **Ran `npm test -- src/decisions/__tests__/schema.test.ts`** — 2 initial failures identified a test bug (decision_text is also NOT NULL so the NULL-check INSERT hit its constraint first), fixed inline, re-ran → 9/9 green.
5. **Ran regression smoke** `npm test -- src/chris/__tests__/contradiction-integration.test.ts` → 8/8 green.
6. **Restarted Docker PG and re-applied migrations** after test.sh's EXIT-trap teardown, so Plans 04/05 start against a populated DB.

## Live-DB Smoke Query Results

**Tables (LIFE-01):**
```
       table_name
------------------------
 decision_capture_state
 decision_events
 decisions
(3 rows)
```

**decision_status enum (LIFE-01, D-04):**
```
   unnest
------------
 abandoned
 due
 open
 open-draft
 resolved
 reviewed
 stale
 withdrawn
(8 rows)
```

**decision_capture_stage enum (LIFE-01, D-16):**
```
       unnest
---------------------
 ALTERNATIVES
 AWAITING_POSTMORTEM
 AWAITING_RESOLUTION
 DECISION
 DONE
 FALSIFICATION
 PREDICTION
 REASONING
(8 rows)
```

**epistemic_tag contains DECISION (LIFE-06):**
```
 has_decision_tag
------------------
 t
(1 row)
```

**NOT NULL constraints (LIFE-04):**
```
       column_name       | is_nullable
-------------------------+-------------
 falsification_criterion | NO
 resolve_by              | NO
(2 rows)
```

## Test Results

- `npm test -- src/decisions/__tests__/schema.test.ts` → **9 passed / 9 total**, exit 0, ~540ms.
- `npm test -- src/chris/__tests__/contradiction-integration.test.ts` → **8 passed / 8 total**, exit 0, ~720ms.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Fixed misleading NOT NULL assertion in schema.test.ts**
- **Found during:** Task 1 step 5 (schema.test.ts run)
- **Issue:** Both LIFE-04 tests expected `/null value in column "falsification_criterion"/i` and `/null value in column "resolve_by"/i`, but the INSERTs omitted `decision_text` — which is ALSO NOT NULL — so Postgres hit that constraint first and returned `null value in column "decision_text" …`. The schema is correct; the test's INSERT column list was incomplete.
- **Fix:** Added `decision_text` to the column list and `'d'` to the VALUES in both tests, so the only remaining NULL is the one being asserted.
- **Files modified:** `src/decisions/__tests__/schema.test.ts` (2 lines changed).
- **Commit:** `339f7c5`

No other deviations. Plan 02's migration artifacts applied cleanly first try — no `sequence_no` type mismatch, no drizzle-wrapper issues with ALTER TYPE ADD VALUE (0003 ran as an autocommit statement per the plan's guidance).

## Commits

- `339f7c5` — fix(13-03): include decision_text in NOT-NULL test INSERTs

(All schema.ts + migration file artifacts were committed in Plan 02 — `6448753`, `aaee21f`, `6f1dd82`. Plan 03 is a database-state change; the only file artifact is the test fix.)

## Known Stubs

None.

## Threat Flags

None. This plan pushes pre-approved schema migrations to a local test DB; no new network surface, auth path, or trust boundary.

## Self-Check: PASSED

**Files:**
- FOUND: src/decisions/__tests__/schema.test.ts (modified — NOT NULL test fix)
- FOUND: .planning/phases/13-schema-lifecycle-primitives/13-03-SUMMARY.md (this file)

**Commits:**
- FOUND: 339f7c5

**Live DB state (verified post-re-migrate):**
- FOUND: 3 decision tables in public schema
- FOUND: 8 values in decision_status enum
- FOUND: 8 values in decision_capture_stage enum
- FOUND: DECISION in epistemic_tag enum
- FOUND: falsification_criterion IS NOT NULL
- FOUND: resolve_by IS NOT NULL

**Tests:**
- FOUND: schema.test.ts 9/9 GREEN
- FOUND: contradiction-integration.test.ts 8/8 GREEN (no regression)
