# M011 — Psychological Profiles

**Slash command:** `/gsd:new-milestone "M011 Psychological Profiles"`

## Goal

Build the two empirically-grounded psychological profile dimensions from the PRD audit: HEXACO traits (six dimensions) and Schwartz universal values (ten dimensions). Slow-moving inferred profiles that require substantial speech data and explicit confidence reporting.

## Why these come second in the profile layer

Speech-based personality extraction has empirical limits (r ≈ .31–.41) and requires significant data volume (5,000+ words from John's own speech, not Chris's responses) to produce defensible inferences. M010 must populate first so Reflect/Coach/Psychology modes have at least the operational context grounded before psychological inference is layered on. M011 can run in parallel with M012 once M010 is shipped.

## Target features

- **Two new profile tables**:
  - `profile_hexaco` with six dimensions (honesty_humility, emotionality, extraversion, agreeableness, conscientiousness, openness), each as jsonb `{score: 1.0–5.0, confidence: 0.0–1.0, last_updated}`
  - `profile_schwartz` with ten universal values (self_direction, stimulation, hedonism, achievement, power, security, conformity, tradition, benevolence, universalism) in the same per-dimension structure
  - Both tables: id, last_updated, overall_confidence
- **Monthly cron updates HEXACO and Schwartz profiles.** Pulls the previous month's episodic summaries and Pensieve entries, calls Sonnet with focused per-profile prompts. Confidence reflects both data volume and inter-period consistency — a dimension that scored consistently across months has higher confidence than one that fluctuates.
- **Strict 5,000-word minimum threshold** from John's own speech (not Chris, not external sources) before HEXACO or Schwartz profile is generated. Below threshold, the row exists but all dimensions show "insufficient data — need X more words" and overall_confidence is 0.
- **Per-dimension confidence ranges** always shown alongside scores in any output exposing psychological profiles. Mode handlers format these into system prompts with explicit confidence framing: "John's openness score is 4.2 (confidence 0.6) — moderate evidence."
- **`getPsychologicalProfiles()`** in `src/memory/profiles.ts` called by Reflect, Coach, and Psychology mode handlers when generating responses. Profile data formatted into system prompts as grounded context.
- **`/profile` command extended** to display HEXACO and Schwartz sections. If data threshold not met, section shows "insufficient data — need X more words".
- **Synthetic fixture test**: 30+ days of synthetic episodic summaries plus 6,000+ words of simulated dialogue reflecting a specific personality signature (e.g., high Openness, low Conformity), run monthly update job, verify:
  1. 1,000-word fixture produces no profile
  2. 6,000-word fixture produces a populated profile with confidence > 0
  3. Detected signature roughly matches the designed signature within expected accuracy bounds

## Deferred: Attachment dimensions

Adult attachment style profile (anxious / avoidant / secure dimensions) is intentionally deferred. Activates automatically when the Pensieve contains at least 2,000 words of John's relational speech over at least 60 days. Below that threshold returns "insufficient relational data — defer". Weekly sweep monitors the threshold; when crossed, profile activates without manual intervention. Schema can be defined alongside HEXACO/Schwartz in M011 but population logic is gated on the activation trigger.

## Acceptance

Synthetic fixture passes all three assertions. Real-data run after several weeks of M009 use produces a populated HEXACO + Schwartz profile that John can review via `/profile` and roughly recognize.
