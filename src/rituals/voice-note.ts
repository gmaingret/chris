/**
 * src/rituals/voice-note.ts — Phase 26 Plans 26-01..26-03
 *
 * Voice note ritual handler + PP#5 deposit-only mechanism + shuffled-bag
 * prompt rotation primitive. Owns:
 *   - PROMPTS array + PROMPT_SET_VERSION (VOICE-02 — Plan 26-01)
 *   - chooseNextPromptIndex shuffled-bag rotation (VOICE-03 — Plan 26-01)
 *   - fireVoiceNote handler dispatched from scheduler.ts (VOICE-02..04 — Plan 26-02)
 *   - findActivePendingResponse PP#5 query helper (VOICE-01 — Plan 26-02)
 *   - recordRitualVoiceResponse PP#5 deposit helper (VOICE-01, VOICE-06 — Plan 26-02)
 *   - shouldSuppressVoiceNoteFire pre-fire suppression check (VOICE-04 — Plan 26-03)
 *
 * HARD CO-LOC #1 (Pitfall 6): PP#5 detector + handler MUST land in same plan
 * (26-02). Splitting them = guaranteed Chris-responds-to-rituals regression.
 * HARD CO-LOC #5 (Pitfall 24): Mock-chain coverage update for engine.test.ts
 * family MUST land with PP#5 introduction (Plan 26-02).
 *
 * Tag override: PP#5 deposits use the new `epistemicTag` parameter on
 * storePensieveEntry (D-26-03) so the Haiku auto-tagger does NOT misclassify
 * ritual responses into one of the 12 organic tags. The auto-tagger
 * (src/pensieve/tagger.ts) only touches entries with epistemic_tag IS NULL.
 *
 * Plan 26-01 ships substrate only: constants + chooseNextPromptIndex pure
 * function. Plans 26-02..04 fill in the rest.
 */

// ── Constants (M009 Phase 26 — VOICE-02 + VOICE-03 + VOICE-04 tunables) ────

/**
 * PROMPT-SET v1 — exactly 6 prompts, spec order, frozen at module load.
 * Bumping a prompt's wording requires a new PROMPT_SET_VERSION + reset of
 * any persisted prompt_bag entries (which index into this array).
 */
export const PROMPTS = [
  'What mattered today?',
  "What's still on your mind?",
  'What did today change?',
  'What surprised you today?',
  'What did you decide today, even if it was small?',
  'What did you avoid today?',
] as const;

/** Bumping to 'v2' invalidates all stored prompt_bag indices. */
export const PROMPT_SET_VERSION = 'v1' as const;

/**
 * Window after fire during which a free-text message is interpreted as a
 * ritual response (PP#5 — Plan 26-02). Tunable per OPEN-1 in research
 * SUMMARY (defensible 12h/18h/24h/36h range; revisit after 30 days of real
 * use with skip-tracking telemetry).
 */
export const RESPONSE_WINDOW_HOURS = 18;

/**
 * Pre-fire suppression threshold (Pitfall 9 — Plan 26-03). If today already
 * has at least N telegram JOURNAL Pensieve entries by 21:00 Paris, skip the
 * fire and advance to tomorrow without incrementing skip_count. Tunable per
 * Phase 28 adjustment dialogue (config.suppress_if_deposits_above promotion
 * deferred to v2.5).
 */
export const RITUAL_SUPPRESS_DEPOSIT_THRESHOLD = 5;

// ── Shuffled-bag rotation primitive (VOICE-03 — Plan 26-01) ────────────────

/**
 * chooseNextPromptIndex — shuffled-bag rotation.
 *
 * State stored in `rituals.config.prompt_bag: number[]` — an array of
 * indices not yet used in the current cycle. Each fire pops the first
 * element; when the bag empties, refill via Fisher-Yates shuffle of
 * [0..PROMPTS.length-1] and remove the just-used index from the head if it
 * lands there (no-consecutive-duplicate invariant across cycle boundaries).
 *
 * Pure function — `rng` parameter (defaulting to Math.random) makes the
 * function deterministic when seeded, supporting both the property test
 * (Math.random for organic invariant verification) and unit tests of
 * specific rotation sequences (seeded RNG for determinism).
 *
 * @param currentBag - Array of unused prompt indices in the current cycle.
 *   Empty array triggers a refill.
 * @param rng - Random source returning [0, 1). Defaults to Math.random.
 * @param lastIndex - The index used in the immediately prior fire (for
 *   no-consecutive-duplicate guard at cycle-boundary refill). Optional —
 *   pass undefined for the very first fire.
 * @returns `{ index, newBag }` — index to fire + remaining unused bag.
 */
export function chooseNextPromptIndex(
  currentBag: number[],
  rng: () => number = Math.random,
  lastIndex?: number,
): { index: number; newBag: number[] } {
  if (currentBag.length === 0) {
    // Refill: Fisher-Yates shuffle of [0..PROMPTS.length-1].
    const fresh: number[] = [];
    for (let i = 0; i < PROMPTS.length; i++) fresh.push(i);
    for (let i = fresh.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [fresh[i], fresh[j]] = [fresh[j]!, fresh[i]!];
    }
    // No-consecutive-duplicate guard at cycle boundary: if the new bag's
    // head equals the just-used index, swap with position 1 (uniform
    // distribution preserved because the swap is unconditional on that
    // head-position, not on subsequent positions).
    if (lastIndex !== undefined && fresh[0] === lastIndex && fresh.length > 1) {
      [fresh[0], fresh[1]] = [fresh[1]!, fresh[0]!];
    }
    const idx = fresh.shift()!;
    return { index: idx, newBag: fresh };
  }
  const idx = currentBag[0]!;
  return { index: idx, newBag: currentBag.slice(1) };
}
