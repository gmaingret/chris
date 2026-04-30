-- 0010_adjustment_dialogue.sql — Phase 28 (M009 v2.4) — adjustment dialogue substrate.
-- Adds metadata jsonb to ritual_pending_responses so PP#5 can dispatch by
-- metadata.kind ∈ {'adjustment_dialogue', 'adjustment_confirmation'}.
-- Per RESEARCH Landmine 2: column does NOT exist today (verified by
-- grep -n metadata src/db/schema.ts against ritualPendingResponses block
-- at lines 485-505).
--
-- DEFAULT '{}'::jsonb avoids backfill ambiguity for existing voice-note
-- rows (zero on prod today; zero in dev fixtures). Mirrors Phase 26
-- prompt_text DEFAULT-then-DROP-DEFAULT pattern (0007:19-23) BUT we keep
-- the DEFAULT in place because metadata is NULLABLE — voice-note rows
-- legitimately have no metadata; PP#5 fallback (RESEARCH Landmine 6)
-- treats NULL/missing kind as the voice-note default path.
--
-- IF NOT EXISTS guard makes this idempotent under raw-psql apply path
-- (scripts/test.sh) and operator re-runs.

ALTER TABLE "ritual_pending_responses"
  ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb;
--> statement-breakpoint

-- Partial index for the 1-minute confirmation sweep (D-28-06 + RESEARCH Landmine 5).
-- Scoped to rows where consumed_at IS NULL AND metadata->>'kind' = 'adjustment_confirmation'.
-- ritualConfirmationSweep helper does an indexed range scan on expires_at;
-- sub-millisecond when zero rows pending.
CREATE INDEX IF NOT EXISTS "ritual_pending_responses_adjustment_confirmation_idx"
  ON "ritual_pending_responses" USING btree ("expires_at")
  WHERE "consumed_at" IS NULL AND "metadata"->>'kind' = 'adjustment_confirmation';
