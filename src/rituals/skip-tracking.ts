/**
 * src/rituals/skip-tracking.ts — Phase 28 Plan 02 (SKIP-03)
 *
 * Cadence-aware skip-threshold predicate + replay projection helpers.
 *
 * Built ON TOP OF Plan 28-01 substrate:
 *   - ritual_fire_events writes from all 3 ritual handlers (voice-note,
 *     wellbeing, weekly-review) — provides the event log this module reads.
 *   - ritualResponseWindowSweep in scheduler.ts — emits 'fired_no_response'
 *     events + increments rituals.skip_count denormalized counter.
 *   - RITUAL_OUTCOME const map in types.ts — all outcome references go through
 *     this map, never string literals (Pitfall 4 mitigation).
 *
 * Per CONTEXT.md D-28-03: skip_count is a denormalized projection, rebuildable
 * by replay from ritual_fire_events. This module owns the rebuild logic
 * (computeSkipCount) for audit / disaster recovery.
 *
 * Per RESEARCH Landmine 4 — NO migration writes from Plan 28-02. Seed
 * migrations 0007/0008/0009 already have correct skip_threshold values:
 *   - 0007_daily_voice_note_seed.sql: skip_threshold=3 ✓ (daily default = 3)
 *   - 0008_wellbeing_seed.sql: skip_threshold=3 ✓ (daily default = 3)
 *   - 0009_weekly_review_seed.sql: skip_threshold=2 ✓ (weekly default = 2)
 * The regression detector is in __tests__/skip-tracking.test.ts Task 1 audit.
 *
 * Per RESEARCH Open Question 5: computeSkipCount handles the "no events ever"
 * baseline by returning 0 (epoch fallback — new Date(0)).
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { ritualFireEvents, rituals } from '../db/schema.js';
import { RITUAL_OUTCOME, parseRitualConfig, type RitualConfig } from './types.js';

// ── cadenceDefaultThreshold ─────────────────────────────────────────────────

/**
 * cadenceDefaultThreshold — returns the default skip threshold for a cadence.
 *
 * Per CONTEXT.md D-28-04:
 *   daily=3, weekly=2
 *
 * // D-28-04: monthly=2 / quarterly=1 are forward-compat for M013
 * // (no monthly/quarterly rituals exist in M009)
 *
 * This function is a fallback reference — the authoritative threshold for a
 * given ritual is always rituals.config.skip_threshold (set at row creation
 * from this default, then overridable per-ritual). Task 1 seed audit confirms
 * the seed migrations set skip_threshold to the cadence default.
 */
export function cadenceDefaultThreshold(
  cadence: 'daily' | 'weekly' | 'monthly' | 'quarterly',
): number {
  switch (cadence) {
    case 'daily':
      return 3;
    case 'weekly':
      return 2;
    case 'monthly':
      // D-28-04: monthly=2 / quarterly=1 are forward-compat for M013
      // (no monthly/quarterly rituals exist in M009)
      return 2;
    case 'quarterly':
      return 1;
  }
}

// ── computeSkipCount ────────────────────────────────────────────────────────

/**
 * computeSkipCount — rebuild skip_count from ritual_fire_events by replay.
 *
 * This is the audit / disaster-recovery path for the denormalized
 * rituals.skip_count column. In production, skip_count is incremented
 * by ritualResponseWindowSweep (Plan 28-01) and reset by responded /
 * wellbeing_completed events. This function reproduces the count from
 * the event log without consulting the denormalized column.
 *
 * Algorithm (per CONTEXT.md D-28-03 + RESEARCH OQ#5):
 *   1. Find the most recent reset event (responded OR wellbeing_completed).
 *      If no reset event exists, baseline = epoch (new Date(0)).
 *   2. Count fired_no_response events since that baseline.
 *
 * "No events ever" case (RESEARCH OQ#5): baseline = epoch → count = 0.
 *
 * Per D-28-03: Plan 28-02 ships with two known reset outcomes:
 *   RESPONDED + WELLBEING_COMPLETED.
 * Plan 28-03 will add ADJUSTMENT_COMPLETED as a third reset outcome
 * when the adjustment-dialogue handler lands.
 *
 * @param ritualId - UUID of the ritual to project skip count for.
 * @returns The number of fired_no_response events since the most recent reset.
 */
export async function computeSkipCount(ritualId: string): Promise<number> {
  // Step 1: Find the most recent reset-event timestamp.
  // Reset outcomes: responded, wellbeing_completed.
  // (Plan 28-03 adds adjustment_completed — not yet in union.)
  const [lastReset] = await db
    .select({ firedAt: ritualFireEvents.firedAt })
    .from(ritualFireEvents)
    .where(
      and(
        eq(ritualFireEvents.ritualId, ritualId),
        // Use sql template with RITUAL_OUTCOME refs for type safety.
        // drizzle parameterizes string values — no injection risk.
        sql`${ritualFireEvents.outcome} IN (${RITUAL_OUTCOME.RESPONDED}, ${RITUAL_OUTCOME.WELLBEING_COMPLETED})`,
      ),
    )
    .orderBy(desc(ritualFireEvents.firedAt))
    .limit(1);

  // Step 2: Count fired_no_response events since the anchor (or since epoch).
  // RESEARCH OQ#5: new Date(0) = epoch = counts ALL events when no reset exists.
  const baseline = lastReset?.firedAt ?? new Date(0);

  const [result] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(ritualFireEvents)
    .where(
      and(
        eq(ritualFireEvents.ritualId, ritualId),
        eq(ritualFireEvents.outcome, RITUAL_OUTCOME.FIRED_NO_RESPONSE),
        gte(ritualFireEvents.firedAt, baseline),
      ),
    );

  return result?.count ?? 0;
}

// ── shouldFireAdjustmentDialogue ────────────────────────────────────────────

/**
 * shouldFireAdjustmentDialogue — cadence-aware skip-threshold predicate.
 *
 * Per CONTEXT.md D-28-04 + Plan 28-01 D-28-03: predicate consults the
 * denormalized rituals.skip_count column (incremented by Plan 28-01's
 * ritualResponseWindowSweep). The denormalization tradeoff is documented
 * in D-28-03; computeSkipCount is the rebuild fallback for audit / disaster
 * recovery.
 *
 * Logic:
 *   1. Parse config (strict Zod — rejects unknown fields, defense-in-depth).
 *   2. Honor adjustment_mute_until (D-28-08 "not now" 7-day deferral):
 *      if set AND in future → return false.
 *   3. threshold = config.skip_threshold (per-ritual override; seed audit in
 *      Task 1 confirms seeds match cadence defaults).
 *   4. return ritual.skipCount >= threshold.
 *
 * Called by runRitualSweep in scheduler.ts (Plan 28-02 wiring) AFTER the
 * atomic-fire claim (STEP 5) and BEFORE dispatchRitualHandler (STEP 6).
 * When true → emit 'in_dialogue' outcome; Plan 28-03 replaces the stub
 * with the actual fireAdjustmentDialogue handler.
 *
 * @param ritual - Full ritual row (rituals.$inferSelect shape).
 * @returns true when skip_count has reached the effective threshold and no
 *          adjustment_mute_until deferral is active.
 */
export async function shouldFireAdjustmentDialogue(
  ritual: typeof rituals.$inferSelect,
): Promise<boolean> {
  let cfg: RitualConfig;
  try {
    cfg = parseRitualConfig(ritual.config);
  } catch {
    // Defense-in-depth: caller (scheduler.ts runRitualSweep) already catches
    // config_invalid upstream (STEP 2). Return false on parse error rather
    // than throwing — predicate must not crash the sweep tick.
    return false;
  }

  // Step 2: Honor D-28-08 adjustment_mute_until "not now" 7-day deferral.
  // The ritual continues to fire normally; ONLY the adjustment dialogue is
  // suppressed while this field is set and its date is in the future.
  if (cfg.adjustment_mute_until != null) {
    const muteUntil = new Date(cfg.adjustment_mute_until);
    if (muteUntil > new Date()) {
      return false;
    }
  }

  // Step 3: Effective threshold = per-ritual config.skip_threshold.
  // Seeds already have the correct cadence default per Landmine 4 audit.
  const threshold = cfg.skip_threshold;

  // Step 4: Compare denormalized skip_count against threshold.
  return ritual.skipCount >= threshold;
}
