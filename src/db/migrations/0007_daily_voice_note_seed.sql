-- MD-02: Idempotency guards. ON CONFLICT DO NOTHING on the seed insert + IF NOT
-- EXISTS on the partial index + ALTER TABLE ... ADD COLUMN IF NOT EXISTS make
-- this re-runnable under the raw-psql apply path in scripts/test.sh and
-- operator re-runs.
--
-- Phase 26 (M009 v2.4) — Daily voice note ritual seed + PP#5 hot-path partial
-- index + prompt_text column on ritual_pending_responses (per amended
-- CONTEXT.md D-26-02 2026-04-27). Hand-authored: drizzle-kit cannot
-- auto-generate INSERT INTO ... SELECT row inserts; partial-index .where()
-- and ALTER TABLE ADD COLUMN both work via either drizzle-kit-generated or
-- hand-authored DDL. The drizzle-kit-generated meta/0007_snapshot.json +
-- _journal.json entry match this file's net schema effect; idempotency
-- guards + DEFAULT-then-DROP-DEFAULT pattern + seed insert are SQL-only and
-- do not change the resulting DB shape (so the snapshot remains byte-stable).
--
-- The DEFAULT-then-DROP-DEFAULT pattern on prompt_text handles the (currently
-- zero-row) ritual_pending_responses table at deploy time without backfill
-- ambiguity.
ALTER TABLE "ritual_pending_responses"
  ADD COLUMN IF NOT EXISTS "prompt_text" text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE "ritual_pending_responses"
  ALTER COLUMN "prompt_text" DROP DEFAULT;
--> statement-breakpoint
INSERT INTO "rituals" ("name", "type", "next_run_at", "enabled", "config")
VALUES (
  'daily_voice_note',
  'daily',
  ((date_trunc('day', now() AT TIME ZONE 'Europe/Paris')
    + interval '1 day'
    + interval '21 hours') AT TIME ZONE 'Europe/Paris'),
  true,
  '{"fire_at":"21:00","prompt_bag":[],"skip_threshold":3,"mute_until":null,"time_zone":"Europe/Paris","prompt_set_version":"v1","schema_version":1}'::jsonb
)
ON CONFLICT ("name") DO NOTHING;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ritual_pending_responses_chat_id_active_idx"
  ON "ritual_pending_responses" USING btree ("chat_id", "expires_at")
  WHERE "consumed_at" IS NULL;
