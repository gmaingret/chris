-- MD-02: Idempotency guards added so re-running this migration against a database
-- that already has these objects does not fail mid-stream. Drizzle's migrator tracks
-- applied migrations via __drizzle_migrations, so normal forward migration flows are
-- unaffected. These guards only matter for cold-starts, manual re-applies (e.g. the
-- raw-psql path in scripts/test.sh), or recovery from a botched partial deploy.
--
-- Phase 33 (M010 v2.5) — Operational profile substrate.
-- HARD CO-LOCATION #M10-1: this SQL + src/db/schema.ts table defs +
-- migrations/meta/0012_snapshot.json + _journal.json entry +
-- scripts/test.sh psql apply line + scripts/regen-snapshots.sh
-- cleanup-flag bump ALL ship in Plan 33-01 atomically.
--
-- Non-retrofittable columns (PITFALLS M010-09/10/11 — cannot be added later):
--   - schema_version int NOT NULL DEFAULT 1   (M010-11 — Zod evolution)
--   - substrate_hash text NOT NULL DEFAULT '' (M010-09 — Phase 34 idempotency seed)
--   - name text NOT NULL UNIQUE DEFAULT 'primary' (M010-03 — Phase 34 upsert target)
--
-- Field names locked against FEATURES.md §2.1-2.4 per Open Question 1.
--
-- Seed-row values copied from src/pensieve/ground-truth.ts:24-63 as of 2026-05-11.
-- Future ground-truth.ts edits do NOT propagate to these seeded rows — the
-- Phase 34 weekly cron is responsible for updating them from live Pensieve.
-- (Pitfall 8 in 33-RESEARCH.md.)

CREATE TABLE IF NOT EXISTS "profile_jurisdictional" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'primary' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"substrate_hash" text DEFAULT '' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"data_consistency" real DEFAULT 0 NOT NULL,
	"current_country" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"physical_location" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"residency_status" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tax_residency" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"active_legal_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"next_planned_move" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"planned_move_date" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"passport_citizenships" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_jurisdictional_name_unique" UNIQUE("name"),
	CONSTRAINT "profile_jurisdictional_confidence_bounds" CHECK ("profile_jurisdictional"."confidence" >= 0 AND "profile_jurisdictional"."confidence" <= 1),
	CONSTRAINT "profile_jurisdictional_data_consistency_bounds" CHECK ("profile_jurisdictional"."data_consistency" >= 0 AND "profile_jurisdictional"."data_consistency" <= 1)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "profile_capital" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'primary' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"substrate_hash" text DEFAULT '' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"data_consistency" real DEFAULT 0 NOT NULL,
	"fi_phase" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"fi_target_amount" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"estimated_net_worth" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"runway_months" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"next_sequencing_decision" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"income_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"major_allocation_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tax_optimization_status" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"active_legal_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_capital_name_unique" UNIQUE("name"),
	CONSTRAINT "profile_capital_confidence_bounds" CHECK ("profile_capital"."confidence" >= 0 AND "profile_capital"."confidence" <= 1),
	CONSTRAINT "profile_capital_data_consistency_bounds" CHECK ("profile_capital"."data_consistency" >= 0 AND "profile_capital"."data_consistency" <= 1)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "profile_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'primary' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"substrate_hash" text DEFAULT '' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"data_consistency" real DEFAULT 0 NOT NULL,
	"open_hypotheses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_tests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active_treatments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recent_resolved" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"case_file_narrative" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"wellbeing_trend" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_health_name_unique" UNIQUE("name"),
	CONSTRAINT "profile_health_confidence_bounds" CHECK ("profile_health"."confidence" >= 0 AND "profile_health"."confidence" <= 1),
	CONSTRAINT "profile_health_data_consistency_bounds" CHECK ("profile_health"."data_consistency" >= 0 AND "profile_health"."data_consistency" <= 1)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "profile_family" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text DEFAULT 'primary' NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"substrate_hash" text DEFAULT '' NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"data_consistency" real DEFAULT 0 NOT NULL,
	"relationship_status" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"partnership_criteria_evolution" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"children_plans" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"parent_care_responsibilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_dating_context" jsonb DEFAULT 'null'::jsonb NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"constraints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_updated" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_family_name_unique" UNIQUE("name"),
	CONSTRAINT "profile_family_confidence_bounds" CHECK ("profile_family"."confidence" >= 0 AND "profile_family"."confidence" <= 1),
	CONSTRAINT "profile_family_data_consistency_bounds" CHECK ("profile_family"."data_consistency" >= 0 AND "profile_family"."data_consistency" <= 1)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "profile_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_table_name" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- Index ships now (OQ-3): zero-row marginal cost; simplifies Phase 34
CREATE INDEX IF NOT EXISTS "profile_history_table_recorded_idx"
	ON "profile_history" USING btree ("profile_table_name","recorded_at" DESC NULLS LAST);
--> statement-breakpoint

-- Seed-row INSERTs — idempotent via ON CONFLICT (name) DO NOTHING (Pitfall 3).
-- Values from src/pensieve/ground-truth.ts:24-63 as of 2026-05-11.
-- confidence ~0.3 for jurisdictional (4 of ~8 typical fields seeded from ground-truth)
INSERT INTO "profile_jurisdictional"
    ("name", "schema_version", "substrate_hash", "confidence", "data_consistency",
     "current_country", "physical_location", "residency_status", "tax_residency",
     "active_legal_entities", "next_planned_move", "planned_move_date",
     "passport_citizenships")
VALUES
    ('primary', 1, '', 0.3, 0,
     '"Russia"'::jsonb,
     '"Saint Petersburg"'::jsonb,
     '[{"type": "permanent_residency", "value": "Panama"},
        {"type": "business_residency", "value": "Georgian Individual Entrepreneur"}]'::jsonb,
     'null'::jsonb,
     '[{"name": "MAINGRET LLC", "jurisdiction": "New Mexico, USA"},
        {"name": "Georgian Individual Entrepreneur", "jurisdiction": "Georgia"}]'::jsonb,
     '{"destination": "Batumi, Georgia", "from_date": "2026-04-28"}'::jsonb,
     '"2026-04-28"'::jsonb,
     '["French"]'::jsonb)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

-- confidence ~0.2 for capital (1 explicit financial fact: fi_target $1,500,000)
INSERT INTO "profile_capital"
    ("name", "schema_version", "substrate_hash", "confidence", "data_consistency",
     "fi_phase", "fi_target_amount", "estimated_net_worth", "runway_months",
     "next_sequencing_decision", "income_sources", "major_allocation_decisions",
     "tax_optimization_status", "active_legal_entities")
VALUES
    ('primary', 1, '', 0.2, 0,
     'null'::jsonb,
     '"$1,500,000"'::jsonb,
     'null'::jsonb,
     'null'::jsonb,
     'null'::jsonb,
     '[{"source": "Golfe-Juan rental property (Citya)", "kind": "rental_income"}]'::jsonb,
     '[]'::jsonb,
     'null'::jsonb,
     '[{"name": "MAINGRET LLC", "jurisdiction": "New Mexico, USA"},
        {"name": "Georgian Individual Entrepreneur", "jurisdiction": "Georgia"}]'::jsonb)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

-- confidence = 0 for health (no ground-truth health facts; "insufficient data" markers)
INSERT INTO "profile_health"
    ("name", "schema_version", "substrate_hash", "confidence", "data_consistency",
     "open_hypotheses", "pending_tests", "active_treatments", "recent_resolved",
     "case_file_narrative", "wellbeing_trend")
VALUES
    ('primary', 1, '', 0, 0,
     '[]'::jsonb,
     '[]'::jsonb,
     '[]'::jsonb,
     '[]'::jsonb,
     '"insufficient data"'::jsonb,
     '{}'::jsonb)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint

-- confidence = 0 for family (no ground-truth family facts; "insufficient data" markers)
INSERT INTO "profile_family"
    ("name", "schema_version", "substrate_hash", "confidence", "data_consistency",
     "relationship_status", "partnership_criteria_evolution", "children_plans",
     "parent_care_responsibilities", "active_dating_context", "milestones",
     "constraints")
VALUES
    ('primary', 1, '', 0, 0,
     '"insufficient data"'::jsonb,
     '[]'::jsonb,
     '"insufficient data"'::jsonb,
     '{}'::jsonb,
     '"insufficient data"'::jsonb,
     '[]'::jsonb,
     '[]'::jsonb)
ON CONFLICT ("name") DO NOTHING;
