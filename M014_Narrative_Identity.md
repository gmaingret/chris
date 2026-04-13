# M014 — Narrative Identity

**Slash command:** `/gsd:new-milestone "M014 Narrative Identity"`

## Goal

Build the fourth memory tier — McAdams-style narrative identity layer that produces life chapters, theme extraction, and the "what's the next chapter" output. Slowest-cadence, highest-abstraction layer and the final piece of the soul system architecture.

## Why this is last

The narrative identity layer needs at least one full quarter of data from the lower tiers to have anything to work with. Theme detection (redemption sequences, contamination sequences, agency, communion) requires substantial episodic summaries, profile transitions, and resolved decisions. Building it earlier produces empty ceremony.

## Target features

- **New `life_chapters` table**: id, start_date, end_date (nullable for current chapter), title, narrative_summary, themes (jsonb with redemption_count, contamination_count, agency_score, communion_score, top_themes array), created_at, updated_at.
- **Theme-extraction job** runs at the end of each quarter (or manual trigger). Opus analyzes episodic summaries and significant Pensieve entries within a chapter window, scoring:
  - Redemption sequences (bad-to-good)
  - Contamination sequences (good-to-bad)
  - Agency themes (mastery, control, achievement, autonomy)
  - Communion themes (love, belonging, intimacy, connection)
  
  Top themes extracted as a separate top_themes array.
- **Chapter boundaries detected heuristically** from signals: jurisdictional changes (`profile_jurisdictional` from M010), capital phase transitions (`profile_capital` from M010), family arc milestones (`profile_family` from M010), major decisions resolved (`decisions` from M007). The system **proposes** boundaries to John for confirmation rather than auto-committing — chapters are collaborative, not algorithmic.
- **Quarterly Butler ritual from M013 enhanced** with M014 capabilities: "what happened" step uses the chapter narrative summary, "what did you learn" step uses theme extraction, "next chapter" step creates an actual `life_chapters` row with the user-provided title and theme.
- **Collaborative naming**: during the quarterly ritual's "next chapter" step, Chris proposes 2–3 candidate names based on extracted themes. John picks one, modifies one, or provides his own. Chosen name stored in `life_chapters.title`.
- **Reflect mode supports chapter-scoped pattern synthesis**. Queries can be scoped to "this chapter", "the previous chapter", or "across chapters", and retrieval pulls episodic summaries and Pensieve entries within the relevant chapter window.
- **Migration job** runs once during M014 deployment: any quarterly review outputs created during M013 (stored as tagged Pensieve entries) are migrated into proper `life_chapters` rows.
- **Synthetic fixture test**: one synthetic quarter of episodic summaries and profile state with a clear life transition embedded (e.g., simulated relocation mid-quarter), run theme extraction and boundary detection, verify:
  1. Chapter boundary proposed at the transition point
  2. Themes populate correctly with all 4 McAdams score categories
  3. Collaborative naming flow produces multiple diverse candidate names

## Acceptance

Synthetic fixture passes all three assertions. After John's first real quarter using M009–M013, the quarterly ritual produces a narrative summary he recognizes as his quarter and chapter naming feels right.
