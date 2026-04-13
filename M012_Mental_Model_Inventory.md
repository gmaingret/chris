# M012 — Mental Model Inventory

**Slash command:** `/gsd:new-milestone "M012 Mental Model Inventory"`

## Goal

Track which analytical frameworks John uses, where they have worked, and where they have failed. High-value for John specifically because it captures how his thinking actually evolves — McAdams' narrative identity touches this but does not capture the active toolkit.

## Why this is in the profile layer

Mental models are detected from John's own speech (especially in PRODUCE mode), so they need real conversation data to inventory. Can run in parallel with M011 once M010 is shipped, since neither depends on the other.

## Target features

- **New `profile_mental_models` table**: id, name, description, first_observed_at, last_applied_at, application_count, source_entry_ids (uuid array), confidence.
- **Background analyzer** runs after every PRODUCE-mode exchange and on a daily sweep over recent JOURNAL entries. Uses Haiku to detect named frameworks (e.g., "demand-first SaaS validation", "Taiwan kill-switch") or recurring analytical patterns, either creates new mental model entries or updates application counts on existing ones.
- **Similar mental models merged** via semantic similarity using bge-m3 embeddings. Before insertion, analyzer checks existing models and merges into the closest match if similarity exceeds 0.85, otherwise creates a new entry.
- **`/models` Telegram command** lists mental models in active use, sorted by recency or application count, with the source entries that grounded each detection.
- **Reflect mode pattern synthesis** can reference which mental models John has been using during a given period via `getMentalModelsForPeriod(start, end)`, with the result included in the Reflect mode handler's system prompt context.
- **Synthetic fixture test**: PRODUCE-mode transcripts containing explicit named frameworks ("let me think about this with the demand-first SaaS validation framework") and implicit recurring analytical patterns, run detection pipeline, verify correct creation, deduplication via embedding similarity, and application count tracking.

## Acceptance

Synthetic fixture produces the expected mental models with correct deduplication. Real PRODUCE conversations during M012 use detect at least John's known frameworks (helium/SMH analysis, Taiwan kill-switch, demand-first SaaS validation, GSD framework) without duplicates.
