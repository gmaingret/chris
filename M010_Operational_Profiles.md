# M010 — Operational Profiles

**Slash command:** `/gsd:new-milestone "M010 Operational Profiles"`

## Goal

Build the four operational profile dimensions that capture John's situational state: jurisdictional (where he is and what statuses he holds), capital (FI phase and trajectory), health (clinical case file with open hypotheses), and family formation arc. These are the profiles whose values change at human-perceptible cadence and whose accuracy depends on having real episodic data.

## Why these come first in the profile layer

Operational profiles update from observable facts (locations, dates, decisions, health events) rather than inferred traits. Stronger ground truth and faster validation cycles than HEXACO or Schwartz. Building them first lets John see the profile layer working before the slower, fuzzier psychological profiles land in M011.

## Target features

- **Four new profile tables** in the Drizzle schema, each with id, last_updated, confidence (0.0–1.0):
  - `profile_jurisdictional` — current location, residency statuses (jsonb), tax structures (jsonb), next planned move, planned move date
  - `profile_capital` — FI phase, target amount, current estimated net worth (nullable), next sequencing decision
  - `profile_health` — open hypotheses (jsonb), pending tests (jsonb), recent decisions (jsonb), case file narrative
  - `profile_family` — milestones (jsonb), constraints (jsonb), evolving criteria
- **Weekly cron updates all four operational profiles.** Pulls the previous week's episodic summaries plus FACT/RELATIONSHIP/INTENTION/EXPERIENCE-tagged Pensieve entries, calls Sonnet with focused per-profile prompts (one prompt per profile, never a mega-prompt) to update each table.
- **Confidence scores** reflect data volume and consistency. Minimum threshold of 10 distinct Pensieve entries enforced before any profile is generated. Below threshold, the row exists but fields contain "insufficient data" markers and confidence is 0.
- **New module `src/memory/profiles.ts`** exposes `getOperationalProfiles()` returning all four profiles as structured data (not narrative summaries). Reflect, Coach, and Psychology mode handlers call this and format the result into their system prompts as grounded context.
- **`/profile` Telegram command** returns a read-only summary of the four operational profiles with confidence ranges. Psychological profiles section shows "not yet available — see M011" until M011 lands.
- **Synthetic fixture test**: 30+ days of synthetic episodic summaries covering all four operational profile dimensions (jurisdictional changes, capital state, health events, family milestones), run weekly update job, verify all four profiles populate with calibrated confidence scores. Sparse 5-entry fixture must produce no populated profile (threshold enforcement).

## Acceptance

After running on at least 30 days of real M009 data, all four operational profiles populate with non-zero confidence. The `/profile` command returns coherent values that John recognizes as accurate. Synthetic fixture passes both the populated-profile and threshold-enforcement assertions.
