/**
 * src/rituals/weekly-review.ts — Phase 29 Plan 01 (skeleton) → Plan 02 (impl)
 *
 * HARD CO-LOC #2 + #3 atomic boundary owner:
 *   - HARD CO-LOC #2 (Pitfall 14): single-question enforcement (Stage-1 Zod
 *     refine + Stage-2 Haiku judge) MUST live in this same file as the
 *     observation generator. Plan 29-02 fills in fireWeeklyReview +
 *     generateWeeklyObservation here.
 *   - HARD CO-LOC #3 (Pitfall 17): CONSTITUTIONAL_PREAMBLE injection at the
 *     SDK boundary is asserted via the assembleWeeklyReviewPrompt consumer
 *     (sibling module weekly-review-prompt.ts) being called from this file.
 *
 * Plan 29-01 (THIS commit) ships ONLY the WEEKLY_REVIEW_HEADER constant —
 * the D031 boundary marker text — so Plan 29-02 can import + render it at
 * Telegram-send time. This file is intentionally minimal at this wave: the
 * full fireWeeklyReview / generateWeeklyObservation impl lands in Plan 29-02
 * alongside Stage-1 + Stage-2 + retry loop + Pensieve persist. Splitting any
 * of that across plans is the documented Pitfall 14/17 regression.
 *
 * Tests at this wave: src/rituals/__tests__/weekly-review-prompt.test.ts
 * (Plan 29-01) imports + asserts WEEKLY_REVIEW_HEADER === the exact D031 text.
 */

// PHASE-29 Plan 02: fireWeeklyReview, generateWeeklyObservation, Stage-1 Zod
// refine, Stage-2 Haiku judge, retry cap = 2 + templated fallback, date-
// grounding post-check, D031 header rendering at Telegram-send time, Pensieve
// persist as RITUAL_RESPONSE with metadata.kind = 'weekly_review'.

/**
 * D031 boundary marker — verbatim user-facing header prepended to the weekly
 * review observation message at Telegram-send time (Plan 29-02 consumes).
 *
 * Spec: REQUIREMENTS.md WEEK-04 + PROJECT.md D031 — exact text, no trailing
 * punctuation, no whitespace tweaks. Greg sees this prefix on every Sunday
 * 20:00 Paris weekly review message; it explicitly frames the prose as
 * Chris's interpretation, not authoritative narrative — protecting against
 * Pitfall 17 (sycophantic / authoritative-tone weekly observations).
 */
export const WEEKLY_REVIEW_HEADER = 'Observation (interpretation, not fact):';
