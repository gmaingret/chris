-- MD-02: Idempotency guards added so re-running this migration against a database
-- that already has these objects does not fail mid-stream. Drizzle's migrator tracks
-- applied migrations via __drizzle_migrations, so normal forward migration flows are
-- unaffected. These guards only matter for cold-starts, manual re-applies (e.g. the
-- raw-psql path in scripts/test.sh), or recovery from a botched partial deploy.

-- Phase 45 (v2.6.1) — Psychological profile defense-in-depth CHECK constraints.
-- HARD CO-LOCATION #M11-45a: this SQL + src/db/schema.ts (no edits — schema.ts only declares
-- top-level overall_confidence CHECK; per-dim CHECKs intentionally migration-only per CONTEXT D-04) +
-- migrations/meta/0015_snapshot.json + _journal.json entry (idx 15) +
-- scripts/test.sh psql apply line + 0015 smoke gate +
-- scripts/regen-snapshots.sh cleanup-flag bump ALL ship in Plan 45-01 atomically.

-- Migration slot 0014 is owned by Phase 43 (CONTRACT-03 column addition); Phase 45's two
-- migrations occupy slots 0015 + 0016 per CONTEXT.md D-18.

-- Constraint scope (per CONTEXT D-04 + 37-REVIEW.md §WR-01 lines 45-50):
--   HEXACO dims (6): score in [1.0, 5.0], confidence in [0.0, 1.0]
--   Schwartz dims (10): score in [0.0, 7.0], confidence in [0.0, 1.0]
--   Attachment dims (3): score in [1.0, 5.0], confidence in [0.0, 1.0]
-- Each constraint tolerates value = 'null'::jsonb (uninitialized seed state per
-- 0013_psychological_profiles.sql:48 default) via OR-branch.

-- Defense-in-depth: psychological-schemas.ts Zod v3 validates these ranges at
-- the READ boundary, but a non-Zod-validated UPDATE could slip out-of-range scores
-- past the DB. These constraints close that gap per 37-REVIEW.md WR-01 Fix-(b).

-- Idempotency pattern: PostgreSQL 16 does NOT support `ADD CONSTRAINT IF NOT EXISTS`
-- (that clause is reserved for ADD COLUMN). Each ALTER TABLE is wrapped in a
-- DO-block that swallows duplicate_object on re-apply, mirroring the standard
-- PL/pgSQL idempotency pattern. The ALTER TABLE statement itself begins in
-- column 0 so the grep-based acceptance gate matches as expected.

-- ────────────────────────────────────────────────────────────────────────────
-- profile_hexaco — 6 dims, score in [1.0, 5.0], confidence in [0.0, 1.0]
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
ALTER TABLE "profile_hexaco" ADD CONSTRAINT "profile_hexaco_honesty_humility_bounds"
  CHECK (
    "honesty_humility" = 'null'::jsonb
    OR (
      ("honesty_humility"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("honesty_humility"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_hexaco" ADD CONSTRAINT "profile_hexaco_emotionality_bounds"
  CHECK (
    "emotionality" = 'null'::jsonb
    OR (
      ("emotionality"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("emotionality"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_hexaco" ADD CONSTRAINT "profile_hexaco_extraversion_bounds"
  CHECK (
    "extraversion" = 'null'::jsonb
    OR (
      ("extraversion"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("extraversion"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_hexaco" ADD CONSTRAINT "profile_hexaco_agreeableness_bounds"
  CHECK (
    "agreeableness" = 'null'::jsonb
    OR (
      ("agreeableness"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("agreeableness"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_hexaco" ADD CONSTRAINT "profile_hexaco_conscientiousness_bounds"
  CHECK (
    "conscientiousness" = 'null'::jsonb
    OR (
      ("conscientiousness"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("conscientiousness"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_hexaco" ADD CONSTRAINT "profile_hexaco_openness_bounds"
  CHECK (
    "openness" = 'null'::jsonb
    OR (
      ("openness"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("openness"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- profile_schwartz — 10 dims, score in [0.0, 7.0], confidence in [0.0, 1.0]
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_self_direction_bounds"
  CHECK (
    "self_direction" = 'null'::jsonb
    OR (
      ("self_direction"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("self_direction"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_stimulation_bounds"
  CHECK (
    "stimulation" = 'null'::jsonb
    OR (
      ("stimulation"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("stimulation"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_hedonism_bounds"
  CHECK (
    "hedonism" = 'null'::jsonb
    OR (
      ("hedonism"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("hedonism"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_achievement_bounds"
  CHECK (
    "achievement" = 'null'::jsonb
    OR (
      ("achievement"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("achievement"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_power_bounds"
  CHECK (
    "power" = 'null'::jsonb
    OR (
      ("power"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("power"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_security_bounds"
  CHECK (
    "security" = 'null'::jsonb
    OR (
      ("security"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("security"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_conformity_bounds"
  CHECK (
    "conformity" = 'null'::jsonb
    OR (
      ("conformity"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("conformity"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_tradition_bounds"
  CHECK (
    "tradition" = 'null'::jsonb
    OR (
      ("tradition"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("tradition"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_benevolence_bounds"
  CHECK (
    "benevolence" = 'null'::jsonb
    OR (
      ("benevolence"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("benevolence"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_schwartz" ADD CONSTRAINT "profile_schwartz_universalism_bounds"
  CHECK (
    "universalism" = 'null'::jsonb
    OR (
      ("universalism"->>'score')::numeric BETWEEN 0.0 AND 7.0
      AND ("universalism"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

-- ────────────────────────────────────────────────────────────────────────────
-- profile_attachment — 3 dims, score in [1.0, 5.0], confidence in [0.0, 1.0]
-- (defense-in-depth even though attachment is below D028 activation today)
-- ────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
ALTER TABLE "profile_attachment" ADD CONSTRAINT "profile_attachment_anxious_bounds"
  CHECK (
    "anxious" = 'null'::jsonb
    OR (
      ("anxious"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("anxious"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_attachment" ADD CONSTRAINT "profile_attachment_avoidant_bounds"
  CHECK (
    "avoidant" = 'null'::jsonb
    OR (
      ("avoidant"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("avoidant"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint

DO $$ BEGIN
ALTER TABLE "profile_attachment" ADD CONSTRAINT "profile_attachment_secure_bounds"
  CHECK (
    "secure" = 'null'::jsonb
    OR (
      ("secure"->>'score')::numeric BETWEEN 1.0 AND 5.0
      AND ("secure"->>'confidence')::numeric BETWEEN 0.0 AND 1.0
    )
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
