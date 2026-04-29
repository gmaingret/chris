-- 0009_weekly_review_seed.sql — Phase 29 Plan 03 (M009 v2.4) — seed weekly_review ritual.
--
-- Single idempotent INSERT on the rituals table seeded by Phase 25 migration 0006.
-- ON CONFLICT (name) DO NOTHING uses the rituals_name_unique constraint from
-- migration 0006. Re-applying this migration against an already-seeded DB is a no-op
-- (e.g., the raw-psql apply path in scripts/test.sh, manual re-applies, or recovery
-- from a botched partial deploy).
--
-- Phase 29 (M009 v2.4) — Weekly Review seed row. Hand-authored per CONTEXT.md D-09
-- (per-phase seed migration; Phase 26 owns 0007 voice_note, Phase 27 owns 0008
-- wellbeing). The drizzle-kit-generated meta/0009_snapshot.json + _journal.json
-- entry match this file's net schema effect (no schema change — pure DML INSERT).
-- Per Phase 27 SUMMARY pattern: pure-DML migration → drizzle-kit reports
-- "No schema changes, nothing to migrate" → meta/0009_snapshot.json hand-cloned
-- from 0008 with re-chained id/prevId.
--
-- Config jsonb conforms to RitualConfigSchema (src/rituals/types.ts:42-55) — 7 of 8
-- named fields populated (prompt_bag is .optional() and omitted because the weekly
-- review uses no rotating prompt bag; the prompt is fully assembled at runtime by
-- assembleWeeklyReviewPrompt with substrate from M008 episodic_summaries + M007
-- decisions + wellbeing_snapshots).
--
-- IMPORTANT — fire_dow=7 (Sunday) convention. RitualConfigSchema.fire_dow at
-- src/rituals/types.ts:47 declares `z.number().int().min(1).max(7).optional()`,
-- so the 1=Mon..7=Sun convention is the locked schema contract. Sunday MUST be
-- represented as 7, NOT 0. (CONTEXT.md D-09 noted both conventions as candidates;
-- src/rituals/types.ts:47 is the source-of-truth and resolves to 1..7. Using
-- fire_dow=0 would fail RitualConfigSchema.parse() at every read boundary.)
--
-- next_run_at computation: next Sunday 20:00 Europe/Paris from migration apply time.
-- Postgres date_trunc('week', ...) returns Monday → +6 days = Sunday → +20 hours
-- = 20:00 the same week. The CASE handles the "migration applied on Sunday after
-- 20:00 Paris" edge case → schedule for the FOLLOWING Sunday (NEXT week, +13 days
-- 20 hours from current week's Monday) so we never set a next_run_at in the past.
-- Mirrors Phase 27 0008's same-day-after-fire CASE pattern (deterministic SQL,
-- no application-time JS computation per D-09 + Phase 25 D-08 substrate discipline).
INSERT INTO "rituals" ("name", "type", "next_run_at", "enabled", "config")
VALUES (
  'weekly_review',
  'weekly',
  CASE
    WHEN extract(dow FROM (now() AT TIME ZONE 'Europe/Paris')) = 0
         AND (now() AT TIME ZONE 'Europe/Paris')::time > '20:00'::time
    THEN ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '13 days 20 hours') AT TIME ZONE 'Europe/Paris')
    ELSE ((date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '6 days 20 hours') AT TIME ZONE 'Europe/Paris')
  END,
  true,
  '{
    "fire_at": "20:00",
    "fire_dow": 7,
    "skip_threshold": 2,
    "mute_until": null,
    "time_zone": "Europe/Paris",
    "prompt_set_version": "v1",
    "schema_version": 1
  }'::jsonb
)
ON CONFLICT ("name") DO NOTHING;
