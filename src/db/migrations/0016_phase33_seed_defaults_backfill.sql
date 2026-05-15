-- MD-02: Idempotency guards added so re-running this migration against a database
-- that already has these objects does not fail mid-stream. Drizzle's migrator tracks
-- applied migrations via __drizzle_migrations, so normal forward migration flows are
-- unaffected. These guards only matter for cold-starts, manual re-applies (e.g. the
-- raw-psql path in scripts/test.sh), or recovery from a botched partial deploy.
--
-- The UPDATE is idempotent under the `WHERE substrate_hash = '' AND <col> = '{}'::jsonb`
-- clause; re-running on already-updated rows is a no-op (the WHERE predicate fails
-- once the column has been backfilled to a populated shape). The ALTER COLUMN SET
-- DEFAULT is naturally idempotent (re-setting the same default value is a no-op in
-- PostgreSQL).

-- Phase 45 (v2.6.1) — Phase 33 seed defaults backfill (SCHEMA-02).
-- HARD CO-LOCATION #M11-45b: this SQL + meta/0016_snapshot.json + _journal.json idx-N entry +
-- scripts/test.sh apply line + smoke gate + scripts/regen-snapshots.sh sentinel bump ALL ship in Plan 45-03 atomically.

-- Migration slot 0014 is owned by Phase 43 (CONTRACT-03); Plan 45-01 owns slot 0015
-- (psychological CHECK constraints); this Plan owns slot 0016. Lexicographic apply order
-- means 0015 lands before 0016 — see CONTEXT D-18.

-- Root cause per Phase 34 REVIEW §Schema-Drift Origins Confirmed lines 361-390:
-- - profile_health.wellbeing_trend default is '{}'::jsonb, missing v3-Zod-required
--   nullable fields energy_30d_mean / mood_30d_mean / anxiety_30d_mean.
--   Read-time .strict() parse rejects → schema_mismatch warn.
-- - profile_family.parent_care_responsibilities default is '{}'::jsonb, missing
--   required-nullable fields notes / dependents. Same failure mode.
--
-- Two operations in this migration:
--   (1) UPDATE existing cold-start seed rows (substrate_hash = '' AND col = '{}'::jsonb)
--       so the v3 Zod parse passes on next read.
--   (2) ALTER COLUMN SET DEFAULT so future fresh DBs ship the correct shape.
--
-- Downstream: Plan 45-04 (FIX-06) regenerates M010 operational primed fixtures
-- against the backfilled schema; PMT-06 anti-hallucination gate stops emitting
-- family.parent_care_responsibilities + health.wellbeing_trend schema_mismatch warns.

-- Operation 1a: Backfill wellbeing_trend on cold-start seed rows.
UPDATE "profile_health"
SET "wellbeing_trend" = '{"energy_30d_mean":null,"mood_30d_mean":null,"anxiety_30d_mean":null}'::jsonb
WHERE "substrate_hash" = '' AND "wellbeing_trend" = '{}'::jsonb;
--> statement-breakpoint

-- Operation 1b: Backfill parent_care_responsibilities on cold-start seed rows.
UPDATE "profile_family"
SET "parent_care_responsibilities" = '{"notes":null,"dependents":[]}'::jsonb
WHERE "substrate_hash" = '' AND "parent_care_responsibilities" = '{}'::jsonb;
--> statement-breakpoint

-- Operation 2a: Update wellbeing_trend column DEFAULT for future fresh DBs.
ALTER TABLE "profile_health"
  ALTER COLUMN "wellbeing_trend"
  SET DEFAULT '{"energy_30d_mean":null,"mood_30d_mean":null,"anxiety_30d_mean":null}'::jsonb;
--> statement-breakpoint

-- Operation 2b: Update parent_care_responsibilities column DEFAULT for future fresh DBs.
ALTER TABLE "profile_family"
  ALTER COLUMN "parent_care_responsibilities"
  SET DEFAULT '{"notes":null,"dependents":[]}'::jsonb;
--> statement-breakpoint
