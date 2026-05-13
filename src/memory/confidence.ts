/**
 * src/memory/confidence.ts — Phase 33 Plan 33-02 Task 2
 *                            (PROF substrate dependency; D-19)
 *
 * Pure-function confidence math for M010 operational profiles. Zero deps.
 *
 * Why Phase 33 (not Phase 34): D-19 in 33-CONTEXT.md locks this as a
 * substrate-not-inference deliverable. The helpers are consumed by
 * Phase 34's generators (GEN-05) AND by Phase 33's reader null-handling
 * (D-12/D-13 may reference the threshold). Shipping them in Phase 33
 * lets unit tests run without any Phase 34 dependencies.
 *
 * Algorithm of record: 33-RESEARCH.md §"Pure-function confidence helpers"
 * (lines 633-675), which itself cites STACK.md §5.
 *
 *   if entryCount < MIN_ENTRIES_THRESHOLD                → 0.0
 *   else volumeScore = min(1.0, (entryCount - 10) / (SATURATION - 10))
 *        return round((0.3 + 0.7 * volumeScore * dataConsistency) * 100) / 100
 *
 * SATURATION = 50 is a first-estimate; tune in v2.5.1 after 4–8 weeks of
 * real M010 cron operation (post-ship OQ-5 in 33-CONTEXT.md). Tuning is
 * a one-line edit + downstream tests; no caller change.
 */

/** Below this entry count, profile stays at confidence=0. M009 lt→lte lesson:
 *  isAboveThreshold uses `>=` so entryCount=10 is "above". */
export const MIN_ENTRIES_THRESHOLD = 10;

/** Volume score caps at 1.0 when entryCount reaches this. First-estimate;
 *  tunable in v2.5.1. */
export const SATURATION = 50;

/**
 * Compute the storable confidence value [0.0, 1.0] for a profile based on
 * the count of relevant Pensieve+episodic entries and Sonnet's
 * self-reported data consistency [0.0, 1.0] for the substrate.
 *
 * @param entryCount         number of relevant tagged entries in the substrate
 * @param dataConsistency    Sonnet-reported substrate consistency [0, 1]
 * @returns                  rounded confidence to 2 decimal places, [0, 1]
 */
export function computeProfileConfidence(
  entryCount: number,
  dataConsistency: number,
): number {
  if (entryCount < MIN_ENTRIES_THRESHOLD) return 0;
  const volumeScore = Math.min(
    1.0,
    (entryCount - MIN_ENTRIES_THRESHOLD) / (SATURATION - MIN_ENTRIES_THRESHOLD),
  );
  return Math.round((0.3 + 0.7 * volumeScore * dataConsistency) * 100) / 100;
}

/**
 * True if the substrate has enough entries to justify a Sonnet-inferred
 * profile update. Below threshold → Phase 34 generator skips the Sonnet
 * call entirely (GEN-06 contract).
 *
 * Note `>=`: a count of exactly MIN_ENTRIES_THRESHOLD is "above". The lt→lte
 * lesson from M009 second-fire bug — using `<` here would create an
 * off-by-one boundary blindness for entryCount===10.
 */
export function isAboveThreshold(entryCount: number): boolean {
  return entryCount >= MIN_ENTRIES_THRESHOLD;
}

// ── Phase 37 Plan 37-02 Task 1 (PSCH-08 substrate) ─────────────────────
//
// Append-only extension per 37-CONTEXT.md D-29: word-count gate constants
// for the M011 psychological profile substrate. These are SUBSTRATE (not
// inference) deliverables; Phase 38 generators will depend on them.
//
// Locked in 37-CONTEXT.md:
//   - D-19: 5000-word floor of first-party telegram speech in the previous
//           calendar month (Europe/Paris) gates psychological-profile
//           generators before the Sonnet call.
//   - D-29: append-only discipline — M010 helpers (MIN_ENTRIES_THRESHOLD,
//           SATURATION, computeProfileConfidence, isAboveThreshold) stay
//           untouched.
//   - D-30: WORD_SATURATION is explicitly DEFERRED to Phase 38. Phase 37
//           only ships the floor; word-count-based confidence math is part
//           of the inference layer, not the substrate.
//
// Pitfall 2 mitigation (PITFALLS.md): the word-count gate and the
// entry-count gate (isAboveThreshold above) are INDEPENDENT. The
// psychological substrate loader (src/memory/profiles/psychological-shared.ts)
// imports `MIN_SPEECH_WORDS` ONLY and DOES NOT import `isAboveThreshold` —
// composing both gates would reject a valid 5,200-word + 8-entry substrate.

/**
 * PSCH-08 floor: psychological profile substrate requires this many words
 * of first-party telegram speech in the previous calendar month (Europe/Paris
 * boundary) before any psychological-profile generator is allowed to fire.
 *
 * Locked in 37-CONTEXT.md D-19. The 5,000-word threshold is calibrated
 * against typical Greg substrate volumes and is independent of the M010
 * entry-count threshold above (D-29 + Pitfall 2 in PITFALLS.md).
 */
export const MIN_SPEECH_WORDS = 5000;

/**
 * D028 attachment-activation gate: `profile_attachment.activated` flips to
 * `true` when `relational_word_count` (a 60-day rolling sum) crosses this
 * threshold. The population sweep that maintains `relational_word_count` is
 * scheduled post-M011 per 37-CONTEXT.md (deferred); the constant lives here
 * now so the activation-gate column has a single source-of-truth threshold
 * by the time the sweep ships.
 */
export const RELATIONAL_WORD_COUNT_THRESHOLD = 2000;

/**
 * True if the psychological substrate has enough first-party speech to
 * justify a Sonnet-inferred psychological-profile generation. Below
 * threshold → Phase 38 generator returns a discriminated-union
 * below-threshold branch BEFORE the Sonnet call (substrate loader is
 * the gate).
 *
 * Note `>=` per M009 lt→lte lesson (second-fire bug, commit c76cb86):
 * a wordCount of exactly MIN_SPEECH_WORDS is "above threshold" — using
 * `<` would silently lock out the boundary case wordCount === 5000.
 * Parallels `isAboveThreshold(entryCount)` above for the entry-count gate.
 */
export function isAboveWordThreshold(wordCount: number): boolean {
  return wordCount >= MIN_SPEECH_WORDS;
}
