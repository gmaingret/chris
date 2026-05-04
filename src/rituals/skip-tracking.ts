/**
 * src/rituals/skip-tracking.ts — Phase 28 Plan 02 (SKIP-03) + Plan 04 (SKIP-06 + SKIP-07)
 *
 * Cadence-aware skip-threshold predicate + replay projection helpers.
 *
 * Phase 28 Plan 04 (SKIP-06 + SKIP-07) — extends Plan 28-02's predicate module
 * with self-protective-pause + audit-trail helpers.
 *
 * Built ON TOP OF Plan 28-01 substrate:
 *   - ritual_fire_events writes from all 3 ritual handlers (journal,
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
 *   - 0007_daily_voice_note_seed.sql: skip_threshold=3 ✓ (daily default = 3; ritual renamed to daily_journal by migration 0011)
 *   - 0008_wellbeing_seed.sql: skip_threshold=3 ✓ (daily default = 3)
 *   - 0009_weekly_review_seed.sql: skip_threshold=2 ✓ (weekly default = 2)
 * The regression detector is in __tests__/skip-tracking.test.ts Task 1 audit.
 *
 * Per RESEARCH Open Question 5: computeSkipCount handles the "no events ever"
 * baseline by returning 0 (epoch fallback — new Date(0)).
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { ritualFireEvents, ritualResponses, ritualConfigEvents, rituals } from '../db/schema.js';
import { logger } from '../utils/logger.js';
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

// ── hasReachedEvasiveTrigger ────────────────────────────────────────────────

/**
 * hasReachedEvasiveTrigger — rolling-14d evasive response counter.
 *
 * Per CONTEXT.md D-28-07: returns true if the ritual has accumulated >= 2
 * evasive responses within a rolling 14-day window.
 *
 * Caller (handleAdjustmentReply evasive branch in adjustment-dialogue.ts)
 * applies the 30-day pause on true return.
 *
 * Refusals are NOT in this query — Plan 28-04 routes refusals to
 * ritual_config_events.manual_disable WITHOUT writing to ritual_responses,
 * so they cannot accidentally trigger the evasive count. This separation is
 * the load-bearing invariant for SKIP-06: refusals never count as evasive.
 *
 * Query scoped by metadata.kind='adjustment_dialogue_response' to avoid
 * false positives from journal ritual_responses rows (T-28-T4 mitigation).
 *
 * @param ritualId - UUID of the ritual to check.
 * @returns true if >= 2 evasive responses exist within the last 14 days.
 */
export async function hasReachedEvasiveTrigger(ritualId: string): Promise<boolean> {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000);

  const result = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(ritualResponses)
    .where(
      and(
        eq(ritualResponses.ritualId, ritualId),
        sql`${ritualResponses.metadata}->>'kind' = 'adjustment_dialogue_response'`,
        sql`${ritualResponses.metadata}->>'classification' = 'evasive'`,
        // Use firedAt (when the ritual dialogue fired) as the rolling-window anchor.
        // This is the semantically correct timestamp for "when did this evasive
        // exchange happen" and is testable (set explicitly at INSERT time, unlike
        // createdAt which is always now() from the DB default).
        gte(ritualResponses.firedAt, fourteenDaysAgo),
      ),
    );

  const count = result[0]?.count ?? 0;
  return count >= 2;
}

// ── autoReEnableExpiredMutes ────────────────────────────────────────────────

/**
 * autoReEnableExpiredMutes — re-enable rituals whose self-protective pause has expired.
 *
 * Per CONTEXT.md D-28-07: scans rituals where enabled=false AND
 * config.mute_until is set AND mute_until <= now. For each:
 *   1. Set enabled=true
 *   2. Clear config.mute_until (jsonb_set to null)
 *   3. Write ritual_config_events with actor='system' and patch.kind='auto_re_enable'
 *   4. Log the re-enable event
 *
 * Returns the count of re-enabled rituals.
 *
 * Critical: only operates on rituals with config.mute_until SET (not null).
 * Manual_disable refusals (D-28-08 'drop it'/'disable' branch) set
 * enabled=false WITHOUT setting mute_until, so they are NOT auto-re-enabled —
 * they require manual operator intervention. This separation is the
 * load-bearing invariant for SKIP-06's "manual override always allowed but
 * no auto-re-enable for refusals".
 *
 * The SQL cast `(config->>'mute_until')::timestamptz` returns NULL for
 * absent/null mute_until values; NULL <= now is NULL (falsy), so manual_disable
 * rituals are correctly excluded by the WHERE clause.
 *
 * @param now - Current timestamp (defaults to new Date() for testability).
 * @returns Count of rituals re-enabled in this call.
 */
export async function autoReEnableExpiredMutes(now: Date = new Date()): Promise<number> {
  // SELECT rituals where enabled=false AND mute_until is set AND mute_until <= now
  // The ::timestamptz cast returns NULL for absent/null mute_until → excluded by <=
  const expired = await db
    .select({ id: rituals.id, config: rituals.config })
    .from(rituals)
    .where(
      and(
        eq(rituals.enabled, false),
        sql`(${rituals.config}->>'mute_until')::timestamptz <= ${now.toISOString()}`,
      ),
    );

  if (expired.length === 0) {
    return 0;
  }

  let processedCount = 0;

  for (const row of expired) {
    // Each ritual is processed independently (not a transaction) — if one
    // fails, others still process. Each update is idempotent.
    const cfg = row.config as Record<string, unknown>;

    // Update: enable=true + clear mute_until via jsonb_set (RESEARCH Landmine 1 pattern)
    await db
      .update(rituals)
      .set({
        enabled: true,
        config: sql`jsonb_set(${rituals.config}, '{mute_until}', 'null'::jsonb)`,
      })
      .where(eq(rituals.id, row.id));

    // Insert ritual_config_events — discriminated envelope per RESEARCH Landmine 1
    await db.insert(ritualConfigEvents).values({
      ritualId: row.id,
      actor: 'system',
      patch: {
        kind: 'auto_re_enable',
        source: 'mute_until_expired',
        mute_until_was: cfg.mute_until,
      },
    });

    logger.info({ ritualId: row.id }, 'rituals.auto_re_enable.applied');

    processedCount++;
  }

  return processedCount;
}
