# M009 — Ritual Infrastructure + Daily Note + Weekly Review *(MVP shipping point)*

**Slash command:** `/gsd:new-milestone "M009 Ritual Infrastructure Daily Note Weekly Review"`

## Goal

Build the scheduling and tracking infrastructure for rituals plus the three lightest rituals: daily voice note, daily wellbeing snapshot, and weekly review. **This is the MVP shipping point for the soul system.** At M009 ship, John has the full frictionless reflection loop: refusal-respecting Chris (M006), decision capture with forecasts (M007), episodic summaries rolling daily entries into tier 2 (M008), and now daily prompts + weekly observations (M009). Everything from M010 onward builds on the real data M009 produces.

## Why this is the MVP

Per the PRD's *"start with decision archive + daily voice note"* principle, the daily voice note and weekly review only need M008 episodic summaries and M007 decisions — neither requires HEXACO/Schwartz/mental-model inference. Shipping M009 early delivers real user value and unblocks the data feedback loop: *"you can't design the consolidation logic for a memory tier you don't have data in yet."*

## Target features

- **New `rituals` table**: id, type (enum: daily/weekly/monthly/quarterly), last_run_at (nullable), next_run_at (not null), enabled (default true), config (jsonb), skip_count (default 0), created_at.
- **New `wellbeing_snapshots` table**: id, snapshot_date, energy (1–5), mood (1–5), anxiety (1–5), notes (nullable), created_at.
- **Proactive sweep extended** to check the `rituals` table for any ritual whose `next_run_at` has passed. On fire, `last_run_at` and `next_run_at` updated based on cadence. Reactive triggers (silence, commitment, pattern, thread) remain unchanged; both coexist.
- **Skip-tracking adjustment dialogue**: if a ritual is skipped 3 or more times in a row, Chris surfaces "this ritual isn't working — what should change?" instead of firing the standard prompt. John's natural-language response parsed by Haiku, used to update `rituals.config`. Per the PRD: *if a ritual is consistently skipped, the ritual is wrong, not John.*
- **Daily voice note ritual** fires at end of John's day with one of 6 rotating prompts:
  1. "What mattered today?"
  2. "What's still on your mind?"
  3. "What did today change?"
  4. "What surprised you today?"
  5. "What did you decide today, even if it was small?"
  6. "What did you avoid today?"
  
  Rotation logic prevents two consecutive duplicates. John responds, response stored as a Pensieve entry. **Chris does NOT respond** — deposit-only, not conversation. Adding a response makes it feel like work and kills the habit.
- **Daily wellbeing snapshot** delivered alongside the daily voice note as Telegram inline keyboard buttons (3 rows: energy, mood, anxiety on a 1–5 scale). Stored in `wellbeing_snapshots`. No LLM analysis on deposit. Becomes substrate for weekly observations and monthly reconciliation. Optional skip allowed without triggering adjustment dialogue.
- **Weekly review ritual** fires Sunday evening (configurable). Chris generates **one** observation from the week's data (M008 episodic summaries + M007 resolved decisions), asks **one** Socratic question tied to it, leaves one open slot for John to add anything missed. **Maximum one question per turn — enforced at runtime by token-count check; multi-question responses are rejected and regenerated.** Single most-important constraint of the ritual system: multi-question check-ins become surveys, surveys become chores, chores get skipped.
- **Synthetic fixture test**: simulate 14 consecutive days via mock clock, verify:
  1. Daily prompts fire on schedule with correct rotation (no consecutive duplicates)
  2. Responses store correctly as Pensieve entries
  3. Skip tracking increments on missed days
  4. Adjustment dialogue triggers after 3 consecutive skips
  5. Wellbeing snapshots store correctly when John responds
  6. Weekly review fires at week boundary with exactly one observation and one Socratic question
  7. Weekly review references specific episodic summaries and decisions from the simulated week

## Acceptance

The 14-day synthetic fixture test passes all 7 assertions. John receives a daily prompt every evening on his real phone, responds by voice (via Telegram), the transcript appears in the Pensieve and gets summarized at end of day. After 2 weeks of real use, the weekly review fires on Sunday and produces one specific observation (referencing the actual week's content) and one Socratic question.

## Pause before M010

**At least one month of real daily use.** This is non-negotiable. The profile layer in M010+ needs real data to infer from. Skipping this pause produces empty profiles with no inference to make.
