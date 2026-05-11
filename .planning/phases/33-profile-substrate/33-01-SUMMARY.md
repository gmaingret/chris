---
phase: 33-profile-substrate
plan: "01"
subsystem: database
tags: [postgres, drizzle-orm, zod, migrations, jsonb, pgTable, operational-profiles]

# Dependency graph
requires:
  - phase: 31-journal-rename
    provides: migration 0011 (journal rename), 0011_snapshot.json in meta chain
  - phase: 32-cicd-guardrails
    provides: validate-journal-monotonic.ts, regen-snapshots.sh acceptance gate pattern
provides:
  - 4 operational profile tables (profile_jurisdictional, profile_capital, profile_health, profile_family)
  - profile_history discriminator table
  - migration 0012_operational_profiles.sql with sentinel seed rows
  - 0012_snapshot.json in drizzle meta chain
  - Zod v3+v4 dual schemas for all 4 profile dimensions
  - scripts/test.sh Phase 33 substrate smoke gate
  - scripts/regen-snapshots.sh extended for migration 0012
affects:
  - 33-02 (profile reader — consumes schema.ts pgTable types and Zod schemas)
  - 33-03 (profile updater — writes to profile tables via Drizzle)
  - 33-04 (profile substrate hash — populates substrate_hash column)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ".$type<T>() Drizzle jsonb annotation — first use in codebase; compile-time type inference for jsonb columns"
    - "Zod v3+v4 dual schema discipline — v3 with .strict() at read boundary, v4 without for SDK JSON Schema"
    - "Sentinel row pattern — single 'primary' row per profile table, ON CONFLICT DO NOTHING"
    - "Named UNIQUE constraint convention — drizzle-kit expects {table}_{column}_unique naming"
    - "Table-qualified CHECK constraint syntax — drizzle-kit requires \"table\".\"col\" in CHECK bodies"

key-files:
  created:
    - src/memory/profiles/schemas.ts
    - src/db/migrations/0012_operational_profiles.sql
    - src/db/migrations/meta/0012_snapshot.json
  modified:
    - src/db/schema.ts
    - src/db/migrations/meta/_journal.json
    - scripts/regen-snapshots.sh
    - scripts/test.sh

key-decisions:
  - "HARD CO-LOCATION #M10-1 honored: all 7 Never-Retrofit Checklist items shipped atomically in Plan 33-01"
  - "data_consistency as top-level column (not nested in jsonb) — simpler for Phase 34 substrate-hash computation"
  - "profile_history table present from Day 1 per D-18 (never retrofit discriminator tables)"
  - "Ground-truth seeding at migration time: jurisdictional conf=0.3, capital conf=0.2, health/family conf=0"
  - "Drizzle-kit SQL format requires named UNIQUE constraints and table-qualified CHECK bodies (discovered via regen acceptance gate failure)"
  - "0012_snapshot.json filename is convention; id/prevId chain is authoritative for drizzle-kit"

patterns-established:
  - "Profile table pgTable definition: id UUID PK, name TEXT UNIQUE DEFAULT 'primary', schema_version INT, substrate_hash TEXT, confidence REAL CHECK bounds, data_consistency REAL CHECK bounds, jsonb columns.$type<T>(), last_updated, created_at"
  - "Cleanup-flag discipline in regen-snapshots.sh: REGEN_PRODUCED_ACCEPTANCE=1 prevents deleting committed future snapshots"

requirements-completed: [PROF-01, PROF-02, PROF-03]

# Metrics
duration: 97min
completed: 2026-05-11
---

# Phase 33 Plan 01: Profile Substrate Summary

**Drizzle ORM pgTable definitions + migration 0012 SQL + drizzle meta snapshot for 4 operational profile tables (jurisdictional, capital, health, family) plus profile_history, with Zod v3+v4 dual schemas and Phase 33 Docker smoke gate**

## Performance

- **Duration:** ~97 min (includes 71-minute Docker test suite run with HuggingFace ML model tests)
- **Started:** 2026-05-11T06:45:00Z
- **Completed:** 2026-05-11T08:24:35Z
- **Tasks:** 8 (7 implementation + 1 blocking Docker gate)
- **Files modified:** 7

## Accomplishments

- Created Zod v3+v4 dual schemas for all 4 M010 profile dimensions with full field coverage from FEATURES.md §2.1-2.4
- Added 5 pgTable definitions to schema.ts using `.$type<T>()` jsonb annotations (first use of this Drizzle pattern in codebase)
- Hand-authored migration 0012 with named UNIQUE constraints, table-qualified CHECK bodies, and ground-truth sentinel seed rows
- Extended regen-snapshots.sh with cleanup-flag discipline for migration 0012
- Regenerated 0012_snapshot.json via drizzle-kit acceptance gate (confirmed "No schema changes" idempotency)
- Extended test.sh with Phase 33 substrate smoke gate asserting 5 tables + 4 seed rows + correct confidence values
- Docker gate passed: smoke gate lines confirmed, 20/20 non-retrofittable columns verified

## Task Commits

Each task was committed atomically:

1. **Task 1: Forward-scaffold profile schema types** - `03ee65c` (feat)
2. **Task 2: Add 5 pgTable definitions to schema.ts** - `9832d5a` (feat)
3. **Task 3: Hand-author migration 0012** - `96b2acf` (feat — superseded by Task 6 fix)
4. **Task 4: Append journal entry idx=12** - `ce51544` (feat)
5. **Task 5: Extend regen-snapshots.sh** - `f7a1776` (feat)
6. **Task 6: Fix migration 0012 constraint format + generate 0012_snapshot.json** - `5f47fd2` (feat)
7. **Task 7: Extend test.sh smoke gate** - `b6b9e0f` (feat)
8. **Task 8 [BLOCKING]: Docker gate** - no file changes (verification only; smoke gates printed confirmation lines)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/memory/profiles/schemas.ts` — Zod v3+v4 dual schemas for JurisdictionalProfileData, CapitalProfileData, HealthProfileData, FamilyProfileData, ProfileSnapshot
- `src/db/schema.ts` — 5 new pgTable exports (profileJurisdictional, profileCapital, profileHealth, profileFamily, profileHistory) with `.$type<T>()` jsonb annotations and CHECK constraints
- `src/db/migrations/0012_operational_profiles.sql` — 5 CREATE TABLE IF NOT EXISTS, 1 CREATE INDEX IF NOT EXISTS (profile_history_table_recorded_at_idx), 4 INSERT sentinel seed rows with ON CONFLICT DO NOTHING
- `src/db/migrations/meta/_journal.json` — appended idx=12 entry for 0012_operational_profiles
- `src/db/migrations/meta/0012_snapshot.json` — drizzle-kit generated snapshot containing all 5 new table definitions
- `scripts/regen-snapshots.sh` — MIGRATION_12 variable, apply_sql in acceptance gate sequence, Phase 33 cleanup-flag discipline
- `scripts/test.sh` — MIGRATION_12_SQL variable, psql apply line, Phase 33 substrate smoke gate + non-retrofittable columns gate

## Decisions Made

- **HARD CO-LOCATION #M10-1 honored**: All 7 Never-Retrofit Checklist items shipped in this single plan to avoid TECH-DEBT-19-01 lineage breaks (schema_version, substrate_hash, name UNIQUE DEFAULT 'primary', confidence CHECK, data_consistency, profile_history table, drizzle meta snapshot)
- **data_consistency as top-level column**: Not nested inside the jsonb payload — easier for Phase 34 substrate-hash computation to read it directly
- **Ground-truth seeding at migration time**: jurisdictional=0.3, capital=0.2, health=0, family=0 per D-10 confidence mapping from ground-truth.ts
- **Named UNIQUE constraints required**: drizzle-kit generates `CONSTRAINT "profile_*_name_unique" UNIQUE("name")` not inline `UNIQUE`; must match for regen acceptance gate to pass
- **0012_snapshot.json produced as 0014 and renamed**: Journal had 13 entries (0-12) so drizzle-kit auto-incremented to 0014; renamed to 0012_snapshot.json (filename is convention, id/prevId chain is authoritative)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed migration 0012 SQL format to match drizzle-kit expectations**
- **Found during:** Task 6 (regen-snapshots.sh acceptance gate failure)
- **Issue:** Original migration used inline `UNIQUE DEFAULT 'primary'` syntax which creates unnamed constraint `profile_*_name_key` in Postgres, but drizzle-kit (via schema.ts `.unique()`) expects named constraint `profile_*_name_unique`. Also: CHECK constraints needed table-qualified syntax (`"table"."col"` not just `"col"`), and DEFAULT must come before NOT NULL.
- **Fix:** Rewrote migration 0012 to use `CONSTRAINT "profile_*_name_unique" UNIQUE("name")`, table-qualified CHECK bodies, and correct DEFAULT/NOT NULL ordering
- **Files modified:** `src/db/migrations/0012_operational_profiles.sql`
- **Verification:** `bash scripts/regen-snapshots.sh` printed "No schema changes" after fix
- **Committed in:** `5f47fd2` (supersedes `96b2acf` from Task 3)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug — SQL format mismatch between hand-authored DDL and drizzle-kit-expected DDL)
**Impact on plan:** Required — without correct constraint naming and CHECK syntax, drizzle-kit would detect divergence and reject the snapshot. No scope creep.

## Issues Encountered

- **Journal contamination from regen run**: After the regen-snapshots.sh run, `_journal.json` had two extra entries (idx=13 for `0013_acceptance_check`, idx=14 for `0014_debug_check`) that the cleanup trap did not remove from the journal (it only deletes the SQL file and snapshot, not the journal entries). Restored via `git checkout -- src/db/migrations/meta/_journal.json`.
- **0012_snapshot.json produced as 0014_snapshot.json**: The cleanup trap in regen-snapshots.sh is configured to delete `0013_snapshot.json`, but drizzle-kit produced `0014_snapshot.json` (because journal had 13 entries). Renamed to `0012_snapshot.json` and confirmed idempotency with `--check-only`.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None — all profile seed rows are populated with real ground-truth values from D-10 confidence mapping. The `substrate_hash` column is seeded as `''` (empty string default) — this is intentional and not a stub; Phase 34 (Plan 33-04) will populate it.

## Threat Flags

None - no new network endpoints, auth paths, file access patterns, or schema changes at external trust boundaries. All new tables are internal read/write only (no public API surface in this plan).

## Next Phase Readiness

- Phase 33 Plan 02 (profile reader): schema.ts pgTable types and Zod schemas are ready; all 4 profile tables exist with seed rows
- Phase 33 Plan 03 (profile updater): write path requires profile tables to exist — they do
- Phase 33 Plan 04 (substrate hash): `substrate_hash TEXT` column exists on all 4 tables, ready for hash population
- No blockers

---
*Phase: 33-profile-substrate*
*Completed: 2026-05-11*
