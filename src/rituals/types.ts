/**
 * src/rituals/types.ts — Phase 25 Plan 02 Task 1 (RIT-07)
 *
 * Bounded, validated config blob for the `rituals` table's `config` jsonb
 * column, plus the discriminated outcome union the ritual scheduler emits per
 * fire attempt. Pure types + Zod — no DB, no Luxon, no Anthropic SDK.
 *
 * Schema discipline:
 *   - 8 named fields + `schema_version` (RIT-07 contract).
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

// ── RitualConfig schema (RIT-07) ────────────────────────────────────────────

/**
 * RitualConfigSchema — strict Zod schema for `rituals.config` jsonb.
 *
 * 8 named fields + `schema_version`. Strict mode rejects unknown fields
 * (proves RIT-07's "rejects unknown fields" contract). Cadence is NOT a field
 * here — it lives on `rituals.type` (the enum column) per CONTEXT.md D-09.
 */
export const RitualConfigSchema = z
  .object({
    fire_at: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'fire_at must be HH:mm'),
    fire_dow: z.number().int().min(1).max(7).optional(),
    prompt_bag: z.array(z.number().int().min(0).max(5)).max(6).optional(),
    skip_threshold: z.number().int().min(1).max(10),
    mute_until: z.string().datetime().nullable(),
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
 * per-outcome semantic enforcement and the SKIP-01 richer discriminated
 * union ship in Phase 28.
 *
 *   - 'fired'             — atomic UPDATE...RETURNING claimed the row, prompt sent.
 *   - 'caught_up'         — next_run_at is in the future (no work to do).
 *   - 'muted'             — config.mute_until is in the future, ritual suppressed.
 *   - 'race_lost'         — concurrent sweep already fired this ritual (RIT-10).
 *   - 'in_dialogue'       — Phase 28: user is mid-conversation, defer to next tick.
 *   - 'config_invalid'    — RitualConfigSchema.parse threw ZodError; sweep skips.
 *   - 'system_suppressed' — Phase 26 VOICE-04 (D-26-06): pre-fire check skipped
 *                           firing (e.g., heavy-deposit-day suppression for daily
 *                           voice note). Distinct from 'fired_no_response' (Phase
 *                           28 skip-tracking) — does NOT increment skip_count.
 */
export type RitualFireOutcome =
  | 'fired'
  | 'caught_up'
  | 'muted'
  | 'race_lost'
  | 'in_dialogue'
  | 'config_invalid'
  | 'system_suppressed'; // ← Phase 26 VOICE-04 (Plan 26-03; D-26-06)

export interface RitualFireResult {
  ritualId: string;
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  fired: boolean;
  outcome: RitualFireOutcome;
  error?: unknown;
}
