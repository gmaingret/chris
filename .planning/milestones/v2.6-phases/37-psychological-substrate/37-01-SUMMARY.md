---
phase: 37-psychological-substrate
plan: 01
subsystem: database

tags: [drizzle, postgres, zod, migrations, psychological-profiles, hexaco, schwartz, attachment, m011]

# Dependency graph
requires:
  - phase: 33-profile-substrate
    provides: M010 operational profile substrate pattern (schemas.ts, schema.ts, migration 0012, regen-snapshots.sh, test.sh smoke gate) — analog-mirrored exactly for HARD CO-LOC #M11-1
provides:
  - 3 new psychological profile pgTables (profile_hexaco, profile_schwartz, profile_attachment) with full Never-Retrofit Checklist
  - Migration 0013 with 3 CREATE TABLE blocks + 3 sentinel-row INSERTs
  - Zod v3+v4 dual schemas for HEXACO (6 dims), Schwartz (10 values), Attachment (3 dims) — public exports for Phase 38 generators + Phase 39 reader
  - Inferred TypeScript types HexacoProfileData / SchwartzProfileData / AttachmentProfileData
  - Drizzle meta snapshot 0013_snapshot.json + idx-13 journal entry (monotonic)
  - test.sh smoke gates (substrate + Never-Retrofit + D-07 column-count)
  - regen-snapshots.sh extended with 0013 apply + 0013→0014 cleanup sentinels
affects: [37-02-loader-reader, Phase 38 psychological inference engine, Phase 39 surfaces, Phase 40 milestone tests]

# Tech tracking
tech-stack:
  added: []  # zero new npm dependencies per CONTEXT.md "zero new deps"
  patterns:
    - "HARD CO-LOC #M11-1 — single atomic plan ships 7 artifacts (SQL + schema.ts + Zod + snapshot + journal + test.sh + regen-snapshots.sh)"
    - "Never-Retrofit Checklist for psychological profiles (D-06 + D-07): schemaVersion + substrateHash + name UNIQUE 'primary' + overall_confidence + word_count + word_count_at_last_run + nullable last_updated + attachment-only relational_word_count + activated"
    - "Per-dim jsonb factory shape {score 1-5, confidence 0-1, last_updated ISO} wrapped in .nullable() at the FACTORY level — cold-start 'null'::jsonb defaults parse"
    - "Nominal Zod factory separation (D-27): hexacoSchwartzDimensionSchemaV3 + attachmentDimensionSchemaV3 share identical shape but separate names — preserves nominal typing and allows future divergence"

key-files:
  created:
    - "src/memory/profiles/psychological-schemas.ts — Zod v3+v4 dual schemas + inferred types (150 lines)"
    - "src/db/migrations/0013_psychological_profiles.sql — 3 CREATE TABLE + 3 INSERT, hand-authored DDL (134 lines)"
    - "src/db/migrations/meta/0013_snapshot.json — drizzle-kit-emitted lock-step snapshot (2869 lines)"
    - ".planning/phases/37-psychological-substrate/deferred-items.md — out-of-scope discoveries"
  modified:
    - "src/db/schema.ts — appended HexacoProfileData/SchwartzProfileData/AttachmentProfileData type imports + 3 new pgTable exports (profileHexaco/profileSchwartz/profileAttachment) between profileFamily and profileHistory (102 inserted lines)"
    - "src/db/migrations/meta/_journal.json — appended idx-13 entry with tag '0013_psychological_profiles' and monotonic when=1778699398922"
    - "src/db/migrations/meta/0001_snapshot.json + 0002 + 0003 + 0004 — UUID re-chain only (content unchanged; standard regen-snapshots.sh behavior per Plan 33-01 precedent at commit 5f47fd2)"
    - "scripts/test.sh — MIGRATION_13_SQL var + psql apply line + 3 new smoke gate blocks (67 inserted lines)"
    - "scripts/regen-snapshots.sh — MIGRATION_13 var + apply_sql chain + 5-site 0013→0014 sentinel bumps + Phase 37 comment paragraph (32 changed lines)"

key-decisions:
  - "Bool cast in smoke gate uses 'true'/'false' text not 't'/'f' — psql ::text behavior (Rule 1 auto-fix; deviation #1 below)"
  - "Restored 0001-0004 snapshot diffs to commit state initially then accepted regen's UUID re-chain only — content-byte-identical, IDs differ; matches M010 Plan 33-01 precedent (commit 5f47fd2 in same file)"
  - "Plan's `requirements: [PSCH-01..06]` field mapped 1:1 to executed tasks (Tasks 1-6 each address one PSCH-N)"

patterns-established:
  - "M011 substrate ships in ONE atomic plan (#M11-1 HARD CO-LOC) — splitting reproduces the M010 PITFALL M010-11 lineage break (D-03)"
  - "Psychological profile dim jsonb cols use 'null'::jsonb default (D-08), distinct from M010 which used '[]' or '{}' — cold-start 'never inferred' is a meaningful state, not an empty container"
  - "Substrate smoke gate uses 8-field pipe-delimited psql query + grep-fail with diagnostic cat — mirrors Phase 33 M010 gate structure exactly, with M011-specific assertions (3 tables instead of 5, attachment-specific bool/int values)"

requirements-completed: [PSCH-01, PSCH-02, PSCH-03, PSCH-04, PSCH-05, PSCH-06]

# Metrics
duration: 17min
completed: 2026-05-13
---

# Phase 37 Plan 01: Psychological Profile Substrate Summary

**Migration 0013 + 3 pgTables (HEXACO/Schwartz/Attachment) + Zod v3+v4 dual schemas + drizzle meta + test.sh smoke gates shipped atomically as HARD CO-LOC #M11-1.**

## Performance

- **Duration:** ~17 min
- **Started:** ~2026-05-13T18:59Z (worktree agent spawn)
- **Completed:** 2026-05-13T19:15Z
- **Tasks:** 6 (all `type="auto"`, no checkpoints)
- **Files modified:** 12 (4 created + 8 modified)

## Accomplishments

- **3 new psychological pgTable exports** in `src/db/schema.ts` (`profileHexaco` 15 cols, `profileSchwartz` 19 cols, `profileAttachment` 14 cols) — all with the full Never-Retrofit Checklist on day one (D-06 + D-07).
- **Migration 0013 SQL** hand-authored — 3 `CREATE TABLE IF NOT EXISTS` blocks + 3 sentinel-row INSERTs with `ON CONFLICT ("name") DO NOTHING`. All dim jsonb columns default to `'null'::jsonb` (D-08 — meaningful "never inferred" state); `last_updated` nullable with no default (null = "never run"); `profile_attachment` carries day-one `relational_word_count int DEFAULT 0` + `activated boolean DEFAULT false` (D-07 — closes D028 activation gate retrofit risk).
- **Zod v3+v4 dual schemas** in `src/memory/profiles/psychological-schemas.ts` exporting 6 schemas + 3 inferred TypeScript types. v3 uses `.strict()` at top level; v4 mirrors omit it (M009 D-29-02). Two nominally separate factory pairs per D-27.
- **Drizzle meta lock-step**: `0013_snapshot.json` (drizzle-kit-emitted, byte-accurate against schema.ts) + idx-13 `_journal.json` entry with monotonic `when=1778699398922`. `bash scripts/regen-snapshots.sh` prints "No schema changes" at the acceptance gate.
- **test.sh smoke gates** assert (a) 3 tables + 3 seed rows + cold-start values, (b) 18 Never-Retrofit columns (3 tables × 6), (c) 2 D-07 attachment columns — all green on fresh Docker postgres.
- **regen-snapshots.sh** extended in lock-step: MIGRATION_13 var + apply_sql chain + 5-site 0013→0014 sentinel bumps + Phase 37 comment paragraph. Mitigates T-37-02 (committed 0013_snapshot.json must survive a future regen run).

## Task Commits

Each task was committed atomically:

1. **Task 1: psychological-schemas.ts Zod dual schemas** — `c58c439` (feat)
2. **Task 2: profileHexaco/Schwartz/Attachment pgTable exports** — `e482648` (feat)
3. **Task 3: migration 0013 psychological_profiles.sql** — `ffe7946` (feat)
4. **Task 4: regen-snapshots.sh 0013→0014 sentinel bumps** — `5294237` (chore)
5. **Task 5: 0013_snapshot.json + idx-13 _journal.json** — `9c7f23a` (feat)
6. **Task 6: test.sh apply + 3 substrate smoke gates** — `540e1e2` (chore)

## Files Created/Modified

### Created (4 files)

- `src/memory/profiles/psychological-schemas.ts` — Zod v3+v4 dual schemas for HEXACO/Schwartz/Attachment + 3 inferred TypeScript types. Two private factory pairs per D-27 nominal separation.
- `src/db/migrations/0013_psychological_profiles.sql` — hand-authored DDL: 3 CREATE TABLE + 3 sentinel INSERT, all with `--> statement-breakpoint` markers. Idempotent re-apply guards (CREATE TABLE IF NOT EXISTS + ON CONFLICT (name) DO NOTHING).
- `src/db/migrations/meta/0013_snapshot.json` — drizzle-kit-emitted meta snapshot chaining from 0012 (prevId match verified).
- `.planning/phases/37-psychological-substrate/deferred-items.md` — log of 29 pre-existing live-API test failures (401 — sandbox missing real ANTHROPIC_API_KEY); none touch Phase 37 artifacts.

### Modified (8 files)

- `src/db/schema.ts` (+102 lines) — appended type imports from `psychological-schemas.js` and inserted 3 new pgTable exports between `profileFamily` and `profileHistory`. jsonb dim columns typed via `.$type<HexacoProfileData['<field>']>()` etc. for Pitfall 4 (Drizzle nullable jsonb) mitigation.
- `src/db/migrations/meta/_journal.json` (+7 lines) — appended idx=13 entry, tag=`0013_psychological_profiles`, version="7", breakpoints=true, when=1778699398922 (monotonic — strictly > 0012's 1778482284254).
- `src/db/migrations/meta/0001_snapshot.json` + `0002_snapshot.json` + `0003_snapshot.json` + `0004_snapshot.json` (1 line each — UUID re-chain only; standard regen-snapshots.sh behavior; matches Plan 33-01 precedent at commit 5f47fd2).
- `scripts/test.sh` (+67 lines) — `MIGRATION_13_SQL` var + psql apply line after MIGRATION_12 + 3 new smoke gate blocks (substrate / Never-Retrofit / D-07).
- `scripts/regen-snapshots.sh` (+32/-12 lines) — `MIGRATION_13` var + apply_sql chain extension + Phase 37 comment paragraph + 5-site 0013→0014 sentinel bumps (`0013_snapshot.json` → `0014_snapshot.json` in trap delete; `0014_acceptance_check*.sql` added to pre-script cleanup; post-apply comment + success-path cleanup bumped). All 0012 references preserved (incremental cleanup discipline per D-36).

## Decisions Made

- **Smoke gate boolean cast (Rule 1 auto-fix):** Plan template suggested asserting on `^...|f$` for the `activated` field. Live psql returned `false` (not `f`) because `boolean::text` casts to full `"true"`/`"false"`. Changed assertion to `^3|1|1|1|0|0|0|false$` to match. Documented inline in the test.sh comment and in commit message.
- **Accept 0001-0004 UUID re-chain:** regen-snapshots.sh's regen logic intentionally re-introspects 0001 + 0003 and re-chains 0002.prevId + 0004.prevId on every run (script docstring states "this is NOT optional — drizzle-kit rejects duplicate prevIds across the chain"). Content bytes are unchanged, only `id`/`prevId` UUIDs differ. Same pattern committed in Plan 33-01 (commit 5f47fd2). Accepted as part of the regen contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Smoke gate boolean assertion expected `f` but psql casts boolean to `false`**

- **Found during:** Task 6 (first `bash scripts/test.sh` run after writing the smoke gate)
- **Issue:** The plan's Task 6 action block specified `grep -q "^3|1|1|1|0|0|0|f$"` but Postgres' `activated::text` cast on a `false` boolean returns the literal string `false`, not `f`. Initial run failed with `❌ Migration 0013 substrate incomplete or seed values wrong` and dumped `3|1|1|1|0|0|0|false`.
- **Fix:** Changed assertion regex from `^...|f$` to `^...|false$`. Added inline comment: `psql casts boolean to "true"/"false" text, not "t"/"f"`. Re-ran test.sh — all 3 Phase 37 smoke gates now print success echoes.
- **Files modified:** `scripts/test.sh` (1 line in assertion + 1 comment line)
- **Verification:** `bash scripts/test.sh` on fresh Docker postgres: all three echoes present in /tmp/test-sh2.log (`✓ Migration 0013 substrate verified`, `✓ Migration 0013 non-retrofittable columns verified`, `✓ Migration 0013 profile_attachment D-07 columns verified`).
- **Committed in:** `540e1e2` (Task 6 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Single 1-line assertion fix; no scope creep. The bug was in the plan's verification template, not in shipped artifacts.

## Issues Encountered

### regen-snapshots.sh first-pass produced acceptance-gate diff

On the first `bash scripts/regen-snapshots.sh` run, the acceptance gate emitted `0013_acceptance_check.sql` instead of "No schema changes" — even though schema.ts ↔ migration 0013 ↔ snapshot were correctly aligned. Root cause: drizzle-kit `generate --name acceptance_check` writes a NEW journal entry (`idx:13 tag:0013_acceptance_check`) before comparing against meta snapshots; since the pre-run state had no `idx:13 tag:0013_psychological_profiles` entry yet, drizzle-kit treated all 3 new tables as a delta. The script's trap then preserved `0013_snapshot.json` (Task 4 bumped trap target to `0014_snapshot.json`) so the drizzle-emitted snapshot was correctly retained.

**Resolution:** Restored `_journal.json` to pre-regen state (`git checkout`), appended the correct `idx:13 tag:0013_psychological_profiles when:<monotonic>` entry by hand, then re-ran `bash scripts/regen-snapshots.sh`. Second pass printed "No schema changes" — confirming schema.ts ↔ 0013_snapshot.json are byte-accurate lock-step. This is a one-time bootstrap pattern; future plans landing migration 0014+ will not face this because their pre-state will already include `idx:13`.

### Pre-existing live-API test failures (29 failures, all 401)

`bash scripts/test.sh` reports 29 vitest failures, all in 5 live-API test files (`live-integration.test.ts`, `live-accountability.test.ts`, `vague-validator-live.test.ts`, `live-anti-flattery.test.ts`, `models-smoke.test.ts`). Root cause: sandbox has no real `ANTHROPIC_API_KEY`; fallback `"test-key"` returns 401 from real SDK. **NONE of the failing tests touch Phase 37 artifacts** — they exercise pre-existing functionality. Logged in `.planning/phases/37-psychological-substrate/deferred-items.md`. Resolution: operator runs `bash scripts/test.sh` with real API key in CI/local environment for full validation; sandbox-side validation stops at the 3 Phase 37 substrate gates (all green).

## User Setup Required

None — this is a database-substrate plan with no external service config. Migration 0013 auto-applies via drizzle migrator on container restart per CLAUDE.md production discipline. Operator must explicitly confirm prod push; this plan did NOT autonomously touch production Postgres at 192.168.1.50.

## Pitfall Status

- **Pitfall 1 (Never-Retrofit incompleteness):** ✅ MITIGATED — all 7 base + 2 attachment-only non-retrofittable columns ship in migration 0013. test.sh column-count smoke assertion catches a future retrofit attempt (18 + 2 hard-coded counts).
- **Pitfall 4 (Drizzle nullable jsonb confusion):** ✅ MITIGATED — each jsonb dim column typed `.$type<HexacoProfileData['<field>']>()` where Zod factory uses `.nullable()`. TypeScript infers `Dimension | null` at the column level; consumers must narrow before `.score` access.
- **Pitfall 5 (stale _journal.json `when` timestamp):** ✅ MITIGATED — journal entry uses current `Date.now()` (1778699398922); `validate-journal-monotonic.ts` exits 0 with 14 entries verified. Phase 32 #3 guardrail runs before migrations apply in test.sh.
- **Pitfalls 2, 3, 6, 7:** Out of scope per plan (Phase 37 Plan 37-02 + Phase 38 responsibility).

## Next Phase Readiness

**Ready for Plan 37-02 (loader + reader API + boundary audit):**
- `psychological-schemas.ts` is now importable; Zod v3 schemas (`HexacoProfileSchemaV3` etc.) drive the 3-layer parse defense in the upcoming `getPsychologicalProfiles()` reader.
- 3 pgTables (`profileHexaco`, `profileSchwartz`, `profileAttachment`) exported from `schema.ts` — Plan 37-02's loader and reader can import directly.
- Cold-start seed rows present: each table has exactly 1 row with `name='primary'`, all dims `'null'::jsonb`, `overall_confidence=0`, `word_count=0`, `word_count_at_last_run=0`, `substrate_hash=''`, `last_updated IS NULL`. profile_attachment additionally has `activated=false`, `relational_word_count=0`.

**Handoff note:** `PsychologicalProfileType` discriminated-union type is NOT yet exported. Plan 37-02 ships it in `src/memory/profiles/psychological-shared.ts` (per CONTEXT.md D-16 + REQUIREMENTS PSCH-07). Plan 37-02 also extends `src/memory/confidence.ts` with `MIN_SPEECH_WORDS = 5000` + `RELATIONAL_WORD_COUNT_THRESHOLD = 2000` + `isAboveWordThreshold()` per D-29.

**No blockers** for downstream work. Phase 38 generator builders can begin as soon as Plan 37-02's loader lands.

## Self-Check

### Created files verified

- `src/memory/profiles/psychological-schemas.ts`: FOUND
- `src/db/migrations/0013_psychological_profiles.sql`: FOUND
- `src/db/migrations/meta/0013_snapshot.json`: FOUND
- `.planning/phases/37-psychological-substrate/deferred-items.md`: FOUND

### Commits verified

- `c58c439` (Task 1): FOUND
- `e482648` (Task 2): FOUND
- `ffe7946` (Task 3): FOUND
- `5294237` (Task 4): FOUND
- `9c7f23a` (Task 5): FOUND
- `540e1e2` (Task 6): FOUND

### Overall verification

- `npx tsc --noEmit` exits 0 (verified at end of plan): ✅
- `npx tsx scripts/validate-journal-monotonic.ts` exits 0 (14 entries verified): ✅
- `bash scripts/regen-snapshots.sh` prints "No schema changes": ✅ (run 2)
- `bash scripts/test.sh` Phase 37 substrate gates all print success echoes: ✅
- `bash scripts/test.sh` full vitest suite: 29 pre-existing live-API failures (logged in deferred-items.md, none touch Phase 37 artifacts)

## Self-Check: PASSED

---
*Phase: 37-psychological-substrate*
*Completed: 2026-05-13*
