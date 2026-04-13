# M008 — Episodic Consolidation

**Slash command:** `/gsd:new-milestone "M008 Episodic Consolidation"`

## Goal

Add a second memory tier above the Pensieve raw store — end-of-day episodic summaries that compress the day's entries into a structured narrative with importance scoring. Foundation for M009 (which needs daily summaries to feed weekly observations) and M010+ (which need episodic summaries to feed profile inference).

## Why this matters

The Pensieve grows linearly forever and retrieval over years of raw entries becomes noisy. Episodic summaries serve as a higher-resolution index — "what happened this week" should not require reading every individual entry. Mirrors how human memory consolidates raw experience into general events overnight.

## Target features

- **New `episodic_summaries` table**: id, summary_date (date, timezone-aware), summary (text), importance (integer 1–10), topics (text array), emotional_arc (text), key_quotes (text array), source_entry_ids (uuid array), created_at.
- **Daily consolidation cron** runs at the end of John's day in his configured timezone (`config.proactiveTimezone`). Pulls all Pensieve entries from that day, generates a structured summary via Sonnet, inserts a row into `episodic_summaries`.
- **Importance scoring rubric** documented and enforced via prompt: 1–3 mundane (routine days), 4–6 notable (some emotional intensity or new information), 7–9 significant (major decisions, strong emotions, contradictions surfaced), 10 life-event-level (rare). Based on emotional intensity, novelty, decision presence, and contradiction presence.
- **Retrieval routing by recency** in `src/pensieve/retrieve.ts`: queries about the last 7 days read raw Pensieve entries (full fidelity); older periods read episodic summaries first and only descend to raw entries when explicitly needed.
- **Synthetic fixture test**: generate 14 simulated days of Pensieve entries spanning the full importance range (mundane to life-event), run consolidation against each simulated day boundary using a mock clock, verify summary correctness, importance score calibration (correlation r > 0.7 vs labels), recency routing, timezone boundary handling, and idempotency on retry.

## Acceptance

A week of real conversations produces 7 episodic summaries. Asking Chris about something from 5 days ago retrieves from the summary, not the raw transcript. Storage size grows linearly, not exponentially. Synthetic 14-day fixture passes all assertions.

## Pause before M009

Several days minimum, ideally a week. You need at least a few real days of summaries before M009 starts using them as substrate for the weekly review.
