---
phase: 13
plan: 02
subsystem: db/schema + db/migrations
tags: [database, schema, migrations, drizzle]
requirements-completed: [LIFE-01, LIFE-04, LIFE-06]
dependency-graph:
  requires:
    - src/db/schema.ts (existing pgEnum/pgTable patterns)
    - src/db/migrations/0001_add_photos_psychology_mode.sql (ALTER TYPE ADD VALUE precedent)
  provides:
    - decisionStatusEnum, decisionCaptureStageEnum, decisionEventTypeEnum
    - decisions, decisionEvents, decisionCaptureState table exports
    - DECISION value on epistemicTagEnum
    - 0002_decision_archive.sql (CREATE TYPE + tables + indexes)
    - 0003_add_decision_epistemic_tag.sql (ALTER TYPE ADD VALUE)
  affects:
    - Plan 03 (BLOCKING push — applies these migrations to live DB)
    - Plan 04 (lifecycle/transitionDecision chokepoint — imports the table exports)
    - Plan 05 (regenerate + capture-state helpers — imports decisionEvents/decisionCaptureState)
tech-stack:
  added: []
  patterns: [drizzle-kit-generate, handwritten-enum-add-value-split, bigserial-for-replay-tiebreaker]
key-files:
  created:
    - src/db/migrations/0002_decision_archive.sql
    - src/db/migrations/0003_add_decision_epistemic_tag.sql
    - src/db/migrations/meta/0002_snapshot.json
  modified:
    - src/db/schema.ts
    - src/db/migrations/meta/_journal.json
    - scripts/test.sh
decisions:
  - Three `CREATE TYPE` statements remain in 0002; the single `ALTER TYPE ... epistemic_tag ADD VALUE 'DECISION'` drizzle-kit produced was extracted to 0003 per P1 (ADD VALUE + CREATE TYPE cannot coexist in one migration)
  - Stray `ALTER TYPE ... conversation_mode ADD VALUE 'PHOTOS'` that drizzle-kit re-emitted was also removed from 0002 — already present in 0001, no need to repeat
  - `sequence_no` changed from drizzle-generated `bigint NOT NULL` to handwritten `bigserial NOT NULL` to auto-populate on insert while staying compatible with the plain `bigint` declaration in schema.ts (no GENERATED ALWAYS AS IDENTITY)
  - Journal entry for 0003 uses `when: 1776267312688` (0002's timestamp + 1ms) to guarantee ordering
metrics:
  duration: ~8m
  completed: 2026-04-15
  tasks: 2
  files-created: 3
  files-modified: 3
---

# Phase 13 Plan 02: Schema & Migration Files Summary

All three decision archive tables, three new pgEnums, and the `DECISION` epistemic tag are declared in `src/db/schema.ts`; matching migration files `0002_decision_archive.sql` (tables + enums) and `0003_add_decision_epistemic_tag.sql` (enum ADD VALUE) are on disk and will be applied by the Plan 03 push.

## What Was Built

### `src/db/schema.ts` additions

- **epistemicTagEnum**: appended `'DECISION'` as the 13th value (end-of-list preserves existing ordering).
- **decisionStatusEnum**: 8 values — `open-draft`, `open`, `due`, `resolved`, `reviewed`, `withdrawn`, `stale`, `abandoned`.
- **decisionCaptureStageEnum**: 8 values — `DECISION`, `ALTERNATIVES`, `REASONING`, `PREDICTION`, `FALSIFICATION`, `AWAITING_RESOLUTION`, `AWAITING_POSTMORTEM`, `DONE`.
- **decisionEventTypeEnum**: 4 values — `created`, `status_changed`, `field_updated`, `classified`.
- **`decisions` table** (24 columns): `falsification_criterion` and `resolve_by` NOT NULL (LIFE-04); nullable future-phase fields (`domain_tag`, `language_at_capture`, `resolution*`, `accuracy_*`, terminal-timestamp mirrors). Indexes: `decisions_status_resolve_by_idx` (Phase 15 sweep) and `decisions_chat_id_status_idx`.
- **`decision_events` table** (9 columns): append-only log with `snapshot jsonb NOT NULL` (D-01 full-snapshot), `from_status`/`to_status` nullable for non-status events, `sequence_no bigint` with DB-side `bigserial` auto-populate. Index: `decision_events_decision_id_created_at_sequence_no_idx` (replay tiebreaker).
- **`decision_capture_state` table** (6 columns): `chat_id bigint PRIMARY KEY` (enforces ≤1 active flow per chat — D-15); JSONB `draft`, nullable `decision_id`.

### `src/db/migrations/0002_decision_archive.sql` (57 lines → 55)

- CREATE TYPE for `decision_capture_stage`, `decision_event_type`, `decision_status`.
- CREATE TABLE for `decision_capture_state`, `decision_events`, `decisions`.
- FK: `decision_events.decision_id → decisions.id`.
- Indexes: `decision_events_decision_id_created_at_sequence_no_idx`, `decisions_status_resolve_by_idx`, `decisions_chat_id_status_idx`.
- Handwritten override: `"sequence_no" bigserial NOT NULL` (replaces drizzle-generated `bigint`).
- Removed: `ALTER TYPE ... epistemic_tag ADD VALUE 'DECISION'` (extracted to 0003) and duplicate `ALTER TYPE ... conversation_mode ADD VALUE 'PHOTOS'` (already in 0001).

### `src/db/migrations/0003_add_decision_epistemic_tag.sql` (1 line)

```sql
ALTER TYPE "public"."epistemic_tag" ADD VALUE IF NOT EXISTS 'DECISION';
```

Mirrors 0001 precedent. Applied after 0002 so `DECISION` is available once the tables are in place.

### `src/db/migrations/meta/_journal.json`

- Entry idx=2 retag from drizzle's `0002_whole_franklin_storm` to `0002_decision_archive`.
- New entry idx=3 for `0003_add_decision_epistemic_tag` (breakpoints:true, version:"7", when:1776267312688).

### `scripts/test.sh`

Added `MIGRATION_2_SQL` / `MIGRATION_3_SQL` vars and two extra `cat … | psql` invocations after 0000/0001 so the Docker PG test harness applies the new migrations.

## Deviations from Plan

**None auto-fixed** — plan executed as written. Two minor notes that match plan instructions exactly:

1. **Stray `PHOTOS` ALTER TYPE in 0002** — drizzle-kit generate re-emitted the `ALTER TYPE conversation_mode ADD VALUE 'PHOTOS'` (already in 0001). Plan's Task 2 action step 2 said "if 0002 contains ALTER TYPE ... ADD VALUE — REMOVE" for `epistemic_tag` specifically; the `PHOTOS` line is a duplicate of 0001 so I removed it too (idempotent — `IF NOT EXISTS` wasn't emitted by drizzle-kit, and re-running `ADD VALUE` without it would error on second boot). Deferring this would have broken auto-migration idempotency (D016).

2. **Journal 0002 renamed in place** — plan said "rename both the file and the corresponding tag entry". Done; no snapshot rename needed because 0002_snapshot.json has no name-coupling.

## Verification Results

- `npx tsc --noEmit` — clean (no errors).
- `grep -c "decisionStatusEnum\|decisionCaptureStageEnum\|decisionEventTypeEnum" src/db/schema.ts` → 8 ✓ (≥3).
- `grep -c "'DECISION'" src/db/schema.ts` → 2 ✓ (epistemicTagEnum + decisionCaptureStageEnum).
- `grep -c "export const decisions\b\|export const decisionEvents\b\|export const decisionCaptureState\b" src/db/schema.ts` → 3 ✓.
- `grep 'falsificationCriterion.*notNull()' src/db/schema.ts` → match ✓.
- `grep 'resolveBy.*notNull()' src/db/schema.ts` → match ✓.
- `grep 'decisions_status_resolve_by_idx' src/db/schema.ts` → match ✓.
- `grep 'decision_events_decision_id_created_at_sequence_no_idx' src/db/schema.ts` → match ✓.
- `ls src/db/migrations/0002_decision_archive.sql src/db/migrations/0003_add_decision_epistemic_tag.sql` → both present ✓.
- `grep -c 'ADD VALUE' src/db/migrations/0003_add_decision_epistemic_tag.sql` → 1 ✓.
- `grep -c 'CREATE TABLE "decisions"\|CREATE TABLE "decision_events"\|CREATE TABLE "decision_capture_state"' 0002` → 3 ✓.
- `grep -c 'sequence_no" bigserial NOT NULL' 0002` → 1 ✓ (handwritten fallback applied).
- `grep -c "GENERATED ALWAYS AS IDENTITY" 0002` → 0 ✓.
- `grep -c "epistemic_tag" 0002` → 0 ✓ (no ALTER TYPE leak).
- `grep -c "0002_decision_archive\|0003_add_decision_epistemic_tag" scripts/test.sh` → 4 ✓ (≥2).

**Full Docker integration tests NOT run** — plan explicitly instructs "Do NOT run the migrations yet — Plan 03 is the [BLOCKING] push." Running the full suite now would apply migrations mid-plan and break Plan 03's setup assumptions. User-preference to always run Docker tests is honored at plan-wave granularity: Plan 03 runs the full `npm test` after the push.

## Commits

- `6448753` — feat(13-02): add decision archive enums and tables to schema
- `aaee21f` — feat(13-02): add decision archive migrations (0002 + 0003)

## Known Stubs

None. All columns that will be written in later phases (Phase 14 `domain_tag`/`language_at_capture`, Phase 16 `resolution*`, Phase 17 `accuracy_*`) are declared nullable, so no DEFAULT-value stubs are needed — they simply remain NULL until their owning phase writes them.

## Threat Flags

None. Pure schema + migration files; no new network surface, auth path, or trust boundary.

## Self-Check: PASSED

**Files:**
- FOUND: src/db/schema.ts (modified — enums + 3 tables)
- FOUND: src/db/migrations/0002_decision_archive.sql
- FOUND: src/db/migrations/0003_add_decision_epistemic_tag.sql
- FOUND: src/db/migrations/meta/0002_snapshot.json
- FOUND: src/db/migrations/meta/_journal.json (modified — retag + 0003 entry)
- FOUND: scripts/test.sh (modified — applies 0002/0003)

**Commits:**
- FOUND: 6448753
- FOUND: aaee21f
