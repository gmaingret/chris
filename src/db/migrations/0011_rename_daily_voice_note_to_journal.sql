-- Migration 0011: Rename daily_voice_note ritual to daily_journal (Phase 31)
-- The Phase 26 ritual was historically named `daily_voice_note` but the
-- feature is purely text-based (Chris sends a prompt, Greg replies in text;
-- audio voice messages get a polite decline per VOICE-05). Naming was
-- misleading; this rename matches the name to reality.
--
-- Idempotent: WHERE clause makes re-run a no-op.
-- UUID-preserving: only `name` field changes; all FK references in
-- ritual_fire_events / ritual_responses / ritual_pending_responses /
-- ritual_config_events point to the UUID and remain valid.

UPDATE rituals SET name = 'daily_journal'
WHERE name = 'daily_voice_note';
