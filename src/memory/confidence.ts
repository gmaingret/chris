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
