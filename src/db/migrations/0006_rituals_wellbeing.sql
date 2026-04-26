-- MD-02: Idempotency guards added so re-running this migration against a database
-- that already has these objects does not fail mid-stream. Drizzle's migrator tracks
-- applied migrations via __drizzle_migrations, so normal forward migration flows are
-- unaffected. These guards only matter for cold-starts, manual re-applies (e.g. the
-- raw-psql path in scripts/test.sh), or recovery from a botched partial deploy.
--
-- Postgres 16 does NOT support `CREATE TYPE ... IF NOT EXISTS` for enums, so the
-- new enum is wrapped in a `DO $$ ... EXCEPTION WHEN duplicate_object ... $$` block.
-- The `epistemic_tag` extension uses `ADD VALUE IF NOT EXISTS` (Postgres 9.6+).
-- Tables and indexes use the standard `IF NOT EXISTS` clause. FK constraints have
-- no `IF NOT EXISTS` form, so each is wrapped in a DO block.
--
-- Phase 25 (M009 v2.4) — Ritual scheduling foundation. Hand-authored per
-- CONTEXT.md D-08 (drizzle-kit cannot auto-gen ALTER TYPE ... IF NOT EXISTS).
-- The drizzle-kit-generated meta/0006_snapshot.json + _journal.json entry
-- match this file's net schema effect; idempotency guards are SQL-only and
-- do not change the resulting DB shape (so the snapshot remains byte-stable).
DO $$ BEGIN
	CREATE TYPE "public"."ritual_cadence" AS ENUM('daily', 'weekly', 'monthly', 'quarterly');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TYPE "public"."epistemic_tag" ADD VALUE IF NOT EXISTS 'RITUAL_RESPONSE';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rituals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "ritual_cadence" NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skip_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rituals_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wellbeing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" date NOT NULL,
	"energy" smallint NOT NULL,
	"mood" smallint NOT NULL,
	"anxiety" smallint NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wellbeing_snapshots_snapshot_date_unique" UNIQUE("snapshot_date"),
	CONSTRAINT "wellbeing_snapshots_energy_bounds" CHECK ("wellbeing_snapshots"."energy" BETWEEN 1 AND 5),
	CONSTRAINT "wellbeing_snapshots_mood_bounds" CHECK ("wellbeing_snapshots"."mood" BETWEEN 1 AND 5),
	CONSTRAINT "wellbeing_snapshots_anxiety_bounds" CHECK ("wellbeing_snapshots"."anxiety" BETWEEN 1 AND 5)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ritual_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ritual_id" uuid NOT NULL,
	"fired_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"prompt_text" text NOT NULL,
	"pensieve_entry_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ritual_fire_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ritual_id" uuid NOT NULL,
	"fired_at" timestamp with time zone NOT NULL,
	"outcome" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ritual_config_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ritual_id" uuid NOT NULL,
	"actor" varchar(32) NOT NULL,
	"patch" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ritual_pending_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ritual_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"fired_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ritual_responses" ADD CONSTRAINT "ritual_responses_ritual_id_rituals_id_fk" FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ritual_fire_events" ADD CONSTRAINT "ritual_fire_events_ritual_id_rituals_id_fk" FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ritual_config_events" ADD CONSTRAINT "ritual_config_events_ritual_id_rituals_id_fk" FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ritual_pending_responses" ADD CONSTRAINT "ritual_pending_responses_ritual_id_rituals_id_fk" FOREIGN KEY ("ritual_id") REFERENCES "public"."rituals"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "ritual_responses" ADD CONSTRAINT "ritual_responses_pensieve_entry_id_pensieve_entries_id_fk" FOREIGN KEY ("pensieve_entry_id") REFERENCES "public"."pensieve_entries"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rituals_next_run_at_enabled_idx" ON "rituals" USING btree ("next_run_at") WHERE "rituals"."enabled" = true;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wellbeing_snapshots_snapshot_date_idx" ON "wellbeing_snapshots" USING btree ("snapshot_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ritual_responses_ritual_id_fired_at_idx" ON "ritual_responses" USING btree ("ritual_id","fired_at" DESC NULLS LAST);
