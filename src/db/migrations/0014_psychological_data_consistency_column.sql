-- Phase 43 Plan 02 (v2.6.1 CONTRACT-03) — Psychological data_consistency column
--
-- Adds `data_consistency real NOT NULL DEFAULT 0` + CHECK 0..1 to the 3 M011
-- psychological profile tables (profile_hexaco, profile_schwartz,
-- profile_attachment). Mirrors the operational profile pattern shipped in
-- migration 0012 (profile_jurisdictional / capital / health / family already
-- have this column from Phase 33).
--
-- Locked by .planning/phases/43-inference-security-contract/43-CONTEXT.md:
--   - D-12: persist data_consistency as a real column on each psychological
--     profile table (NOT a jsonb field on profile_history). Symmetric with
--     M010 operational design; queryable directly per profile row.
--   - D-13: rationale for rejecting the profile_history.snapshot path (one-fire
--     lag asymmetry) and the dedicated table path (redundant).
--   - D-14: upsert in src/memory/profiles/psychological-shared.ts writes
--     Sonnet's emission to this column on every fire (alongside
--     overallConfidence). profile_history auto-captures via polymorphic
--     full-row snapshot at shared.ts:495-501 — no separate history wiring.
--   - D-15: this migration takes the 0014 slot. Phase 45 takes 0015
--     (psychological_check_constraints) and 0016 (phase33_seed_defaults_backfill).
--   - D-16: numbering coordinated with Phase 45's CONTEXT (lines 12, 84, 145,
--     169, 180, 205 of 45-CONTEXT.md confirm the slot assignment).
--
-- HARD CO-LOCATION #M11-1: this SQL + src/db/schema.ts column adds +
-- migrations/meta/0014_snapshot.json + _journal.json entry +
-- scripts/test.sh MIGRATION_14_SQL line ALL ship in Plan 43-02 Task 3
-- atomically. Splitting any of these reproduces the M010 PITFALL M010-11
-- lineage break (TECH-DEBT-19-01 precedent).
--
-- DDL semantics:
--   - ADD COLUMN IF NOT EXISTS: idempotent re-apply against a DB that already
--     has the column (cold-start manual replays, test.sh raw-psql path).
--   - DEFAULT 0 applies to existing rows at ALTER time. ALTER TABLE ADD
--     COLUMN with a constant default rewrites the column in place; on the
--     3 psych tables we expect 1 seed row each (per Phase 37 migration 0013
--     seed inserts), so the rewrite is sub-millisecond.
--   - CHECK constraint is NOT idempotent in PostgreSQL — accepted per Phase 25
--     MD-02 pattern. If the constraint already exists (re-apply edge case),
--     the migration will fail; recovery is to manually DROP CONSTRAINT before
--     re-running. This is the same pattern as 0006/0012/0013.
--
-- Live-fire verification path: M011 cron fire Sun 2026-05-17 22:00 Paris is
-- the first opportunity for Sonnet to emit data_consistency into the new
-- column. Per project memory `project_m010_phase34_deployed.md`, the
-- inference engine is already deployed on Proxmox 2026-05-13 — this column
-- needs to be migrated before the next deploy that includes Phase 43.

ALTER TABLE "profile_hexaco"
    ADD COLUMN IF NOT EXISTS "data_consistency" real NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "profile_hexaco"
    ADD CONSTRAINT "profile_hexaco_data_consistency_bounds"
    CHECK ("profile_hexaco"."data_consistency" >= 0
       AND "profile_hexaco"."data_consistency" <= 1);
--> statement-breakpoint

ALTER TABLE "profile_schwartz"
    ADD COLUMN IF NOT EXISTS "data_consistency" real NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "profile_schwartz"
    ADD CONSTRAINT "profile_schwartz_data_consistency_bounds"
    CHECK ("profile_schwartz"."data_consistency" >= 0
       AND "profile_schwartz"."data_consistency" <= 1);
--> statement-breakpoint

ALTER TABLE "profile_attachment"
    ADD COLUMN IF NOT EXISTS "data_consistency" real NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "profile_attachment"
    ADD CONSTRAINT "profile_attachment_data_consistency_bounds"
    CHECK ("profile_attachment"."data_consistency" >= 0
       AND "profile_attachment"."data_consistency" <= 1);
--> statement-breakpoint
