---
phase: 45
plan: 01
subsystem: db-migration
tags: [migration, drizzle, check-constraint, defense-in-depth, psychological-profile, hexaco, schwartz, attachment, schema-01]
requires: [phase-43 (0014 column slot), phase-37 (0013 psychological tables)]
provides: [SCHEMA-01]
affects: [psychological-profile-updater.ts (no edits — defense-in-depth at DB layer behind existing Zod read-parse)]
tech_stack_added: []
patterns:
  - "DO $$ BEGIN ALTER TABLE ... EXCEPTION WHEN duplicate_object THEN NULL END $$ — idempotent ADD CONSTRAINT (PG16 lacks ADD CONSTRAINT IF NOT EXISTS)"
  - "jsonb path-expression CHECK constraint with `value = 'null'::jsonb OR (...)` OR-branch — tolerates the uninitialized seed-default state"
key_files_created:
  - src/db/migrations/0015_psychological_check_constraints.sql
  - src/db/migrations/meta/0015_snapshot.json
  - src/__tests__/migrations/0015-check-constraints.test.ts
key_files_modified:
  - src/db/migrations/meta/_journal.json
  - scripts/test.sh
  - scripts/regen-snapshots.sh
decisions:
  - "PG16 does not support `ADD CONSTRAINT IF NOT EXISTS`; used DO-block wrapper with EXCEPTION WHEN duplicate_object for idempotency. ALTER TABLE remains at column 0 so the grep-based acceptance gate matches."
  - "Generated 0015_snapshot.json manually from 0014's baseline + injection of 19 new checkConstraints entries; drizzle-kit `generate` returned 'No schema changes' because the per-dim CHECKs are intentionally migration-only per CONTEXT D-04 (schema.ts only declares top-level overall_confidence + data_consistency CHECKs)."
metrics:
  duration: "~25 min"
  completed: "2026-05-15"
  task_count: 5
  files_touched: 6
---

# Phase 45 Plan 01: SCHEMA-01 — Migration 0015 Psychological CHECK Constraints Summary

19 defense-in-depth CHECK constraints on the per-dim jsonb columns of `profile_hexaco`, `profile_schwartz`, `profile_attachment` — closes the non-Zod-validated UPDATE bypass at the DB layer (37-REVIEW WR-01 Fix-b). Migration 0015 slot per CONTEXT D-04/D-18 (Phase 43 owns 0014).

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Author 0015 SQL migration | `7b7118c` | `src/db/migrations/0015_psychological_check_constraints.sql` |
| 2 | Drizzle snapshot + journal entry | `4804d8b` | `meta/0015_snapshot.json`, `meta/_journal.json` |
| 3 | Wire into test.sh + 19-constraint smoke gate | `c05d40f` | `scripts/test.sh` |
| 4 | Bump regen-snapshots.sh sentinels | `2ad54ba` | `scripts/regen-snapshots.sh` |
| 5 | Integration test (7 cases) | `f04a87f` | `src/__tests__/migrations/0015-check-constraints.test.ts` |

## Verification Outcomes

- **Migration apply (fresh DB):** Migrations 0000-0015 applied cleanly via `psql -v ON_ERROR_STOP=1`. Exit 0.
- **Migration re-apply (idempotency):** Second apply of 0015 against the same DB returns exit 0; DO-block + EXCEPTION WHEN duplicate_object swallows duplicates.
- **Smoke gate (introspection):** `information_schema.check_constraints` returns 6 (HEXACO) + 10 (Schwartz) + 3 (attachment) = 19 new per-dim bounds constraints. Confirmed live.
- **Monotonic journal:** `npx tsx scripts/validate-journal-monotonic.ts` → ✓ 16 entries; idx 15 `when=1778830973182` is strictly greater than idx 14's `1778829766609`.
- **Integration tests:** `npx vitest run src/__tests__/migrations/0015-check-constraints.test.ts` → 7/7 passing in ~600 ms.
- **TypeScript:** `npx tsc --noEmit` clean (0 errors).
- **Direct bypass (the bug we are closing):** `psql -c "UPDATE profile_hexaco SET honesty_humility='{\"score\":5.5,\"confidence\":0.8}'::jsonb WHERE name='primary'"` → SQLSTATE 23514 (check_violation), constraint `profile_hexaco_honesty_humility_bounds`.

## Constraint Inventory (the 19 new bounds)

**`profile_hexaco`** — score ∈ [1.0, 5.0], confidence ∈ [0.0, 1.0]
- honesty_humility, emotionality, extraversion, agreeableness, conscientiousness, openness

**`profile_schwartz`** — score ∈ [0.0, 7.0], confidence ∈ [0.0, 1.0]
- self_direction, stimulation, hedonism, achievement, power, security, conformity, tradition, benevolence, universalism

**`profile_attachment`** — score ∈ [1.0, 5.0], confidence ∈ [0.0, 1.0] (defense-in-depth ahead of D028 activation)
- anxious, avoidant, secure

Each constraint shape: `"<col>" = 'null'::jsonb OR (("<col>"->>'score')::numeric BETWEEN <lo> AND <hi> AND ("<col>"->>'confidence')::numeric BETWEEN 0.0 AND 1.0)`. The null-literal OR-branch preserves the 0013 seed default (`'null'::jsonb` for uninitialized rows).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's claim that PG16 supports `ADD CONSTRAINT IF NOT EXISTS` is incorrect**
- **Found during:** Task 1 first-apply verification.
- **Issue:** Plan instructed using `ADD CONSTRAINT IF NOT EXISTS` "since pg16 supports it". PostgreSQL 16 only supports `ADD COLUMN IF NOT EXISTS`; the `ADD CONSTRAINT IF NOT EXISTS` form was added in PG18. First-apply succeeded but re-apply failed with `ERROR: constraint "..." already exists`, violating the must_haves idempotency invariant.
- **Fix:** Used the plan's own documented fallback — `DO $$ BEGIN ... ALTER TABLE ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` wrapper. The ALTER TABLE statement still begins in column 0 so the acceptance-gate grep (`^ALTER TABLE "profile_<table>" ADD CONSTRAINT`) continues to match 6/10/3 as required.
- **Files modified:** `src/db/migrations/0015_psychological_check_constraints.sql` (initial authoring iteration before commit).
- **Commit:** Folded into `7b7118c` (task-1 commit).

### Architectural choices flagged in plan, resolved without escalation

**2. [Plan permitted divergence] Snapshot generation method**
- **Found during:** Task 2.
- **Context:** Plan instructed `npx drizzle-kit generate` to produce the snapshot. drizzle-kit `generate` returned "No schema changes, nothing to migrate" — schema.ts does not declare the per-dim CHECKs (intentionally migration-only per CONTEXT D-04), so drizzle-kit sees no schema delta.
- **Resolution:** Generated `0015_snapshot.json` by deep-cloning `0014_snapshot.json`, swapping `id`/`prevId`, and injecting 19 new `checkConstraints` entries into the three psychological-profile table objects. Snapshot format (id, prevId, version, dialect, 2-space indent, no trailing newline) byte-matches drizzle-kit's native output. This matches the pattern that `regen-snapshots.sh` uses for its `patch_snapshot_chain` helper (manual `id`/`prevId` writes via Node). Future plans that run `regen-snapshots.sh` against the migration set will produce a byte-identical snapshot on the acceptance gate.

## Known Stubs

None. The migration is a leaf artefact — no downstream code wires data through.

## Threat Flags

None. The change strictly tightens a DB-layer invariant (out-of-range jsonb values now rejected at the storage boundary). No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries.

## Self-Check: PASSED

- Files exist (verified via `[ -f ... ]`):
  - `src/db/migrations/0015_psychological_check_constraints.sql` ✓
  - `src/db/migrations/meta/0015_snapshot.json` ✓
  - `src/__tests__/migrations/0015-check-constraints.test.ts` ✓
- Commits exist (verified via `git log --grep "45-01"`):
  - `7b7118c` ✓ — migration SQL
  - `4804d8b` ✓ — snapshot + journal
  - `c05d40f` ✓ — test.sh wiring + smoke gate
  - `2ad54ba` ✓ — regen-snapshots.sh sentinels
  - `f04a87f` ✓ — integration test
- Journal idx-15 entry: `{idx: 15, when: 1778830973182, tag: '0015_psychological_check_constraints', breakpoints: true}` — strictly monotonic over idx 14's `when=1778829766609`. ✓

## Ready-for-45-02 Status

✅ Plan 45-02 (Wave A — fixture-pipeline scripts + HARN test) can begin in parallel — it depends ONLY on the 0015 migration slot being taken (which it now is) and otherwise touches an orthogonal surface (scripts/synthesize-delta.ts, scripts/fetch-prod-data.ts, etc.). 45-03 (Wave B — migration 0016 SCHEMA-02 backfill) cannot start until 45-02 lands per the wave DAG in 45-PATTERNS.md.
