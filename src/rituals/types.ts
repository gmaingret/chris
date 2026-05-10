/**
 * src/rituals/types.ts — Phase 25 Plan 02 Task 1 (RIT-07)
 *                         Phase 28 Plan 01 Task 1 (SKIP-01 / SKIP-02)
 *
 * Bounded, validated config blob for the `rituals` table's `config` jsonb
 * column, plus the discriminated outcome union the ritual scheduler emits per
 * fire attempt. Pure types + Zod — no DB, no Luxon, no Anthropic SDK.
 *
 * Schema discipline:
 *   - 9 named fields + `schema_version` (9th = adjustment_mute_until, Phase 28).
 *   - `.strict()` rejects unknown fields with `Unrecognized key …` so a future
 *     typo in operator-supplied config fails loudly at parse time instead of
 *     silently being persisted (Pitfall 5 prevention).
 *   - `schema_version: z.literal(1)` lets us evolve the schema later without
 *     overloading a free-form integer; bumping to 2 forces explicit migration.
 *   - DELIBERATELY OMITS a `cadence` field — cadence lives on `rituals.type`
 *     (the enum column). Per CONTEXT.md D-09 (locked 2026-04-26), the
 *     canonical signature is `computeNextRunAt(now, cadence, config)` so the
 *     enum-column source-of-truth is preserved and not denormalized into the
 *     jsonb blob.
 *   - `adjustment_mute_until` (9th field, Phase 28 D-28-08): distinct from
 *     `mute_until` (which suppresses ALL fires). `adjustment_mute_until` only
 *     suppresses the adjustment dialogue itself — the ritual continues to fire
 *     normally. Written by the "not now" refusal path; expires after 7 days.
 *     No schema_version bump needed (strict-mode invariant unchanged —
 *     adjustment_mute_until is a NEW recognized field, not unknown).
 *     See RESEARCH.md Open Question 2.
 *
 * Mirrors `src/episodic/types.ts` v3 single-schema pattern (NOT the v3/v4
 * dual pattern from `src/episodic/consolidate.ts:33-81`, which exists only at
 * the @anthropic-ai/sdk boundary — Phase 25 does not touch the SDK).
 *
 * Forward-compat: all four cadences (`daily`, `weekly`, `monthly`,
 * `quarterly`) are supported in `RitualFireResult.type` even though Phase 25
 * itself ships no monthly/quarterly rituals. This is the TS-10 forward-compat
 * carry-in so M013 can add monthly/quarterly rituals without re-touching this
 * type.
 */
import { z } from 'zod';

// ── RitualConfig schema (RIT-07, Phase 28 9th field) ────────────────────────

/**
 * RitualConfigSchema — strict Zod schema for `rituals.config` jsonb.
 *
 * 9 named fields + `schema_version`. Strict mode rejects unknown fields
 * (proves RIT-07's "rejects unknown fields" contract). Cadence is NOT a field
 * here — it lives on `rituals.type` (the enum column) per CONTEXT.md D-09.
 *
 * Phase 28 adds `adjustment_mute_until` as the 9th optional field (after
 * `mute_until`, before `time_zone`). It suppresses ONLY the adjustment
 * dialogue — not the ritual fires themselves. Existing seed jsonb blobs lack
 * this field (undefined = not muted). No schema_version bump.
 */
export const RitualConfigSchema = z
  .object({
    fire_at: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'fire_at must be HH:mm'),
    fire_dow: z.number().int().min(1).max(7).optional(),
    prompt_bag: z.array(z.number().int().min(0).max(5)).max(6).optional(),
    /**
     * last_fired_prompt_idx — Phase 32 #8. The PROMPT index that was used in
     * the immediately prior fire. Read on cycle-boundary refill (bag empty)
     * to power the no-consecutive-duplicate guard in chooseNextPromptIndex.
     * Without it, the guard had no signal when the previous bag emptied and
     * a refill produced bag[0] === lastFiredIdx ~17% of the time (1/6 prompts).
     * Optional for back-compat with seed rows that predate this field; first
     * fire after migration will populate it.
     */
    last_fired_prompt_idx: z.number().int().min(0).max(5).optional(),
    skip_threshold: z.number().int().min(1).max(10),
    mute_until: z.string().datetime().nullable(),
    /**
     * adjustment_mute_until — Phase 28 D-28-08 "not now" 7-day deferral.
     * Distinct from mute_until: mute_until suppresses ALL fires; this field
     * only suppresses the adjustment dialogue. When null/absent, the dialogue
     * fires normally once skip_count >= skip_threshold.
     */
    adjustment_mute_until: z.string().datetime().nullable().optional(),
    time_zone: z.string().min(1),
    prompt_set_version: z.string().min(1),
    schema_version: z.literal(1),
  })
  .strict();

export type RitualConfig = z.infer<typeof RitualConfigSchema>;

/**
 * parseRitualConfig — thin helper that surfaces ZodError on parse failure.
 *
 * Caller (Plan 25-03's `runRitualSweep`) catches ZodError and routes to the
 * `'config_invalid'` RitualFireOutcome rather than crashing the sweep tick.
 */
export function parseRitualConfig(input: unknown): RitualConfig {
  return RitualConfigSchema.parse(input);
}

// ── Fire-outcome scaffolding (Phases 26-29 extend) ─────────────────────────

/**
 * RitualFireOutcome — discriminated outcomes the scheduler can emit for a
 * single ritual on a single sweep tick. Phase 25 ships the union scaffold;
 * Phase 28 extends to the full 12-variant discriminated union (SKIP-01).
 *
 * **Original Phase 25-26 variants (7):**
 *   - 'fired'             — atomic UPDATE...RETURNING claimed the row, prompt sent.
 *   - 'caught_up'         — next_run_at is in the future (no work to do).
 *   - 'muted'             — config.mute_until is in the future, ritual suppressed.
 *   - 'race_lost'         — concurrent sweep already fired this ritual (RIT-10).
 *   - 'in_dialogue'       — Phase 28: user is mid-conversation, defer to next tick.
 *   - 'config_invalid'    — RitualConfigSchema.parse threw ZodError; sweep skips.
 *   - 'system_suppressed' — Phase 26 VOICE-04 (D-26-06): pre-fire check skipped
 *                           firing (e.g., heavy-deposit-day suppression for daily
 *                           journal). Distinct from 'fired_no_response' (Phase
 *                           28 skip-tracking) — does NOT increment skip_count.
 *
 * **Phase 27 variants homogenized in Phase 28 (2):**
 *   - 'wellbeing_completed' — Phase 27 (homogenized in Phase 28 — was a free-form
 *                             string only in wellbeing.ts, not a TS union member).
 *                             Wellbeing snapshot completed via 3-tap. Resets
 *                             skip_count via D-28-03. Does NOT emit 'responded' as
 *                             a separate event — wellbeing_completed IS the
 *                             response signal.
 *   - 'wellbeing_skipped'   — Phase 27 (homogenized in Phase 28). Greg tapped the
 *                             Skip button. Does NOT increment skip_count per
 *                             SKIP-01; does NOT reset skip_count. Represents an
 *                             explicit user choice, not a missed window.
 *
 * **Phase 28 SKIP-01 new variants (3):**
 *   - 'responded'           — Phase 28 SKIP-01. Greg replied to a ritual prompt
 *                             within the response window (PP#5 journal deposit,
 *                             or future reply-capable rituals). Resets skip_count.
 *   - 'window_missed'       — Phase 28 SKIP-01. ritual_pending_responses.expires_at
 *                             passed with consumed_at IS NULL. Emitted by
 *                             ritualResponseWindowSweep as the "fact" companion to
 *                             'fired_no_response'. Does NOT increment skip_count
 *                             alone — only the accompanying fired_no_response does.
 *   - 'fired_no_response'   — Phase 28 SKIP-01. THE skip-counting outcome.
 *                             Increments rituals.skip_count by 1. Emitted by
 *                             ritualResponseWindowSweep alongside 'window_missed'
 *                             when a pending response row expires unconsumed.
 *                             Rationale for separation: 'window_missed' is the
 *                             underlying fact; 'fired_no_response' is the policy
 *                             classification. Downstream projections can filter
 *                             on either independently.
 *
 * **Skip-counting rules (SKIP-01):**
 *   INCREMENTS skip_count: 'fired_no_response' ONLY
 *   RESETS skip_count: 'responded', 'wellbeing_completed'
 *   DOES NOT AFFECT skip_count: all other variants
 */
export type RitualFireOutcome =
  | 'fired'
  | 'caught_up'
  | 'muted'
  | 'race_lost'
  | 'in_dialogue'
  | 'config_invalid'
  | 'system_suppressed'     // Phase 26 VOICE-04 (D-26-06)
  | 'wellbeing_completed'   // Phase 27 (homogenized in Phase 28 — was free-form string)
  | 'wellbeing_skipped'     // Phase 27 (homogenized in Phase 28)
  | 'responded'             // Phase 28 SKIP-01 — resets skip_count
  | 'window_missed'         // Phase 28 SKIP-01 — emitted by ritualResponseWindowSweep
  | 'fired_no_response';    // Phase 28 SKIP-01 — THE skip-counting outcome

/**
 * RITUAL_OUTCOME — single source of truth for ritual_fire_events.outcome
 * string write sites (Pitfall 4 mitigation from RESEARCH.md).
 *
 * Pitfall 4: ritual_fire_events.outcome is `text NOT NULL` (free-form, NOT
 * a Postgres enum). Without a const map, write sites use string literals that
 * can silently diverge from the TS union (e.g., 'firedNoResponse' vs
 * 'fired_no_response'). This map ensures every write site uses the exact
 * union-member string via the typed reference (e.g., RITUAL_OUTCOME.FIRED_NO_RESPONSE).
 *
 * The closing `satisfies Record<string, RitualFireOutcome>` assertion
 * proves at compile time that:
 *   (a) every value is a RitualFireOutcome union member (no string drift), and
 *   (b) the map is frozen (no runtime mutation).
 */
export const RITUAL_OUTCOME = {
  FIRED: 'fired',
  CAUGHT_UP: 'caught_up',
  MUTED: 'muted',
  RACE_LOST: 'race_lost',
  IN_DIALOGUE: 'in_dialogue',
  CONFIG_INVALID: 'config_invalid',
  SYSTEM_SUPPRESSED: 'system_suppressed',
  WELLBEING_COMPLETED: 'wellbeing_completed',
  WELLBEING_SKIPPED: 'wellbeing_skipped',
  RESPONDED: 'responded',
  WINDOW_MISSED: 'window_missed',
  FIRED_NO_RESPONSE: 'fired_no_response',
} as const satisfies Record<string, RitualFireOutcome>;

export interface RitualFireResult {
  ritualId: string;
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  fired: boolean;
  outcome: RitualFireOutcome;
  error?: unknown;
}
