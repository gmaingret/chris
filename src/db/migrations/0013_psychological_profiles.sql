-- MD-02: Idempotency guards added so re-running this migration against a database
-- that already has these objects does not fail mid-stream. Drizzle's migrator tracks
-- applied migrations via __drizzle_migrations, so normal forward migration flows are
-- unaffected. These guards only matter for cold-starts, manual re-applies (e.g. the
-- raw-psql path in scripts/test.sh), or recovery from a botched partial deploy.
--
-- Phase 37 (M011 v2.6) — Psychological profile substrate.
-- HARD CO-LOCATION #M11-1: this SQL + src/db/schema.ts table defs +
-- migrations/meta/0013_snapshot.json + _journal.json entry +
-- scripts/test.sh psql apply line + scripts/regen-snapshots.sh
-- cleanup-flag bump + src/memory/profiles/psychological-schemas.ts
-- Zod type exports ALL ship in Plan 37-01 atomically. Splitting any of
-- these reproduces the M010 PITFALL M010-11 lineage break (D-03).
--
-- Never-Retrofit columns (D-06 + PROJECT.md D042 — cannot be added later):
--   - schema_version int NOT NULL DEFAULT 1   (Zod evolution)
--   - substrate_hash text NOT NULL DEFAULT '' (Phase 38 idempotency audit seed; D-13)
--   - name text NOT NULL UNIQUE DEFAULT 'primary' (Phase 38 upsert target; D-05)
--   - overall_confidence real NOT NULL DEFAULT 0 CHECK (>= 0 AND <= 1)
--   - word_count integer NOT NULL DEFAULT 0       (M011 word-count gate)
--   - word_count_at_last_run integer NOT NULL DEFAULT 0 (PSURF-04 "need N more" display)
--   - last_updated timestamptz                   (NULLABLE — null = "never run"; D-06)
-- profile_attachment additionally (D-07 — D028 activation gate):
--   - relational_word_count int NOT NULL DEFAULT 0
--   - activated boolean NOT NULL DEFAULT false
--
-- Field names locked against REQUIREMENTS PSCH-02 / PSCH-03 / PSCH-04.
-- All dim columns default to literal JSON `null` (`'null'::jsonb`) per D-08:
-- distinct from M010's `'[]'` / `'{}'` defaults — psychological dimensions
-- have a meaningful "never inferred" state that round-trips through the
-- Zod v3 reader as a literal null value (factories use .nullable()).
--
-- Seed rows: cold-start only. Unlike M010 (which seeded jurisdictional /
-- capital from ground-truth.ts), psychological profiles are inferred-only;
-- no ground-truth seed values exist or can be derived. All seed rows have
-- overall_confidence=0, word_count=0, word_count_at_last_run=0,
-- substrate_hash='' (D-12 / D-13). profile_attachment seed additionally
-- has activated=false and relational_word_count=0 (D-14).

CREATE TABLE IF NOT EXISTS "profile_hexaco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'primary' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"substrate_hash" text DEFAULT '' NOT NULL,
	"overall_confidence" real DEFAULT 0 NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"word_count_at_last_run" integer DEFAULT 0 NOT NULL,
	"honesty_humility" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"emotionality" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"extraversion" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"agreeableness" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"conscientiousness" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"openness" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"last_updated" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_hexaco_name_unique" UNIQUE("name"),
	CONSTRAINT "profile_hexaco_overall_confidence_bounds" CHECK ("profile_hexaco"."overall_confidence" >= 0 AND "profile_hexaco"."overall_confidence" <= 1)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "profile_schwartz" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'primary' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"substrate_hash" text DEFAULT '' NOT NULL,
	"overall_confidence" real DEFAULT 0 NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"word_count_at_last_run" integer DEFAULT 0 NOT NULL,
	"self_direction" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"stimulation" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"hedonism" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"achievement" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"power" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"security" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"conformity" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"tradition" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"benevolence" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"universalism" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"last_updated" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_schwartz_name_unique" UNIQUE("name"),
	CONSTRAINT "profile_schwartz_overall_confidence_bounds" CHECK ("profile_schwartz"."overall_confidence" >= 0 AND "profile_schwartz"."overall_confidence" <= 1)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "profile_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'primary' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"substrate_hash" text DEFAULT '' NOT NULL,
	"overall_confidence" real DEFAULT 0 NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"word_count_at_last_run" integer DEFAULT 0 NOT NULL,
	"relational_word_count" integer DEFAULT 0 NOT NULL,
	"activated" boolean DEFAULT false NOT NULL,
	"anxious" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"avoidant" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"secure" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"last_updated" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_attachment_name_unique" UNIQUE("name"),
	CONSTRAINT "profile_attachment_overall_confidence_bounds" CHECK ("profile_attachment"."overall_confidence" >= 0 AND "profile_attachment"."overall_confidence" <= 1)
);
--> statement-breakpoint

-- Sentinel-row INSERTs — idempotent via ON CONFLICT (name) DO NOTHING (D-12).
-- Three separate statements per CONTEXT.md Claude's Discretion recommendation
-- (easier to grep in a migration audit). Dim columns are omitted: the
-- `jsonb DEFAULT 'null'::jsonb` table default applies. `last_updated` is
-- omitted: nullable with no default, so the row has SQL NULL (= "never run").
INSERT INTO "profile_hexaco"
    ("name", "schema_version", "substrate_hash", "overall_confidence",
     "word_count", "word_count_at_last_run")
VALUES
    ('primary', 1, '', 0, 0, 0)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

INSERT INTO "profile_schwartz"
    ("name", "schema_version", "substrate_hash", "overall_confidence",
     "word_count", "word_count_at_last_run")
VALUES
    ('primary', 1, '', 0, 0, 0)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

INSERT INTO "profile_attachment"
    ("name", "schema_version", "substrate_hash", "overall_confidence",
     "word_count", "word_count_at_last_run",
     "relational_word_count", "activated")
VALUES
    ('primary', 1, '', 0, 0, 0, 0, false)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
