-- 0008_wellbeing_seed.sql — Phase 27 Plan 02 (M009 v2.4) — seed daily_wellbeing ritual.
--
-- Single idempotent INSERT on the rituals table seeded by Phase 25 migration 0006.
-- ON CONFLICT (name) DO NOTHING uses the rituals_name_unique constraint from
-- migration 0006. Re-applying this migration against an already-seeded DB is a no-op.
--
-- Config jsonb conforms to RitualConfigSchema (src/rituals/types.ts) — 6 of 8
-- named fields populated (fire_dow + prompt_bag are .optional() and omitted
-- because daily_wellbeing is daily-cadence and uses no rotating prompt bag).
--
-- next_run_at computed at migration apply time as the next 09:00 Europe/Paris
-- instant after now(). This avoids the catch-up ceiling triggering on first
-- sweep tick (per Phase 25 D-04 mitigation: stale rituals more than 1 cadence
-- period in the past advance without firing).
--
-- WELL-05: 09:00 Europe/Paris fire is intentionally separate from voice note
-- (21:00) per D026 + Pitfall 13 — captures felt-state in the morning before
-- day's narrative reflection pollutes the numeric series.
INSERT INTO "rituals" ("name", "type", "next_run_at", "enabled", "config")
VALUES (
  'daily_wellbeing',
  'daily',
  (date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '9 hours' +
   CASE WHEN now() AT TIME ZONE 'Europe/Paris' >= date_trunc('day', now() AT TIME ZONE 'Europe/Paris') + interval '9 hours'
        THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Europe/Paris',
  true,
  '{
    "fire_at": "09:00",
    "skip_threshold": 3,
    "mute_until": null,
    "time_zone": "Europe/Paris",
    "prompt_set_version": "v1",
    "schema_version": 1
  }'::jsonb
)
ON CONFLICT ("name") DO NOTHING;
