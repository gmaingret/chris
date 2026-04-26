/**
 * src/rituals/scheduler.ts — Phase 25 Plan 03 Task 1 (RIT-09)
 *
 * Cron-tier orchestrator for the ritual channel. Wires the Wave 2 helpers
 * (computeNextRunAt + tryFireRitualAtomic + parseRitualConfig) into a
 * sweep-tick callable that:
 *   - selects at most ONE due ritual per tick (Pitfall 1: per-tick max-1 cap),
 *   - short-circuits if the channel-level 3/day ceiling has been reached
 *     (D-04 refinement: hasReachedRitualDailyCap),
 *   - advances stale rituals (more than 1 cadence period in the past) WITHOUT
 *     firing them (catch-up ceiling),
 *   - claims the fire slot atomically via tryFireRitualAtomic (RIT-10),
 *   - dispatches to a SKELETON handler that throws — Phases 26-29 fill in
 *     real handlers (voice note, wellbeing, weekly review).
 *
 * Phase 25 substrate contract: against a clean DB (no enabled ritual rows),
 * runRitualSweep returns [] without throwing (ROADMAP success criterion 3).
 *
 * Pitfall 2/3 grep guard scoping: this file uses ms arithmetic in
 * cadencePeriodMs() — that is for an APPROXIMATE catch-up ceiling sanity
 * bound, NOT for cadence advancement. Real cadence advancement goes through
 * computeNextRunAt (Luxon-based, DST-safe). The Pitfall 2/3 grep guard is
 * scoped to cadence.ts (Plan 25-02), not the whole src/rituals/ tree.
 */
import { and, asc, eq, lte } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { rituals } from '../db/schema.js';
import {
  hasReachedRitualDailyCap,
  incrementRitualDailyCount,
} from '../proactive/state.js';
import { logger } from '../utils/logger.js';
import { computeNextRunAt } from './cadence.js';
import { tryFireRitualAtomic } from './idempotency.js';
import { parseRitualConfig, type RitualFireResult } from './types.js';

// ── Ritual sweep orchestrator (M009 Phase 25 RIT-09) ──────────────────────

/**
 * runRitualSweep — cron-tier orchestrator for the ritual channel.
 *
 * Per-tick max-1 cap (Pitfall 1 mitigation) — SQL query is `LIMIT 1`. Even if
 * N rituals are due, only the highest-priority (oldest next_run_at) fires
 * this tick. Subsequent ticks pick up the next due ritual.
 *
 * Catch-up ceiling: a ritual whose next_run_at is more than 1 cadence-period
 * in the past is ADVANCED to the next future slot WITHOUT firing — log-only.
 * Prevents the "server offline 6h, all 3 rituals fire on restart" failure
 * mode.
 *
 * Phase 25 ships SKELETON dispatch — handlers throw 'not implemented for ' +
 * ritual.type. Phases 26-29 fill in the per-cadence handlers (voice note,
 * wellbeing, weekly review). The atomic UPDATE...RETURNING (RIT-10) still
 * runs to mark next_run_at advanced, ensuring the skeleton dispatch doesn't
 * loop.
 *
 * Shares the global mute gate at the parent runSweep entry
 * (src/proactive/sweep.ts:85) — does NOT re-check isMuted() here. Phase 28's
 * per-ritual self-protective mute (config.mute_until) is checked inside this
 * function.
 *
 * Per CONTEXT.md D-04 (REFINED 2026-04-26) + RESEARCH §7 Open Question 3
 * (RESOLVED 2026-04-26): channel ceiling = 3/day enforced via
 * hasReachedRitualDailyCap() helper in src/proactive/state.ts. Defense in
 * depth: (1) per-tick max-1 cap, (2) per-ritual cadence advancement
 * (next_run_at advanced after fire), (3) 3/day channel ceiling.
 *
 * The 3/day ceiling cleanly accommodates the worst case (Sunday: wellbeing
 * 09:00 + voice note 21:00 + weekly review 20:00 — all three on the same
 * calendar day). Counter resets at local Europe/Paris midnight via the
 * proactive_state KV table key 'ritual_daily_count'.
 */
export async function runRitualSweep(now: Date = new Date()): Promise<RitualFireResult[]> {
  const startMs = Date.now();
  logger.info({ timestamp: now.toISOString() }, 'rituals.sweep.start');

  // STEP 0: channel-cap short-circuit (D-04 refinement) — if 3 rituals already
  // fired today (local Europe/Paris date), bail before doing any DB work.
  // Mirrors hasSentTodayReflective/hasSentTodayAccountability shape from
  // src/proactive/state.ts:102-148. Persistence via proactive_state KV table.
  if (await hasReachedRitualDailyCap(config.proactiveTimezone)) {
    logger.info({ durationMs: Date.now() - startMs }, 'rituals.sweep.cap_reached');
    return [];
  }

  // STEP 1: per-tick max-1 SQL fetch — order by next_run_at ASC (oldest first)
  // and LIMIT 1 (Pitfall 1 mitigation). The partial index
  // `rituals_next_run_at_enabled_idx WHERE enabled = true` makes this an
  // index-only scan.
  const due = await db
    .select()
    .from(rituals)
    .where(and(eq(rituals.enabled, true), lte(rituals.nextRunAt, now)))
    .orderBy(asc(rituals.nextRunAt))
    .limit(1);

  if (due.length === 0) {
    logger.info({ durationMs: Date.now() - startMs }, 'rituals.sweep.empty');
    return [];
  }

  const ritual = due[0]!;
  const results: RitualFireResult[] = [];

  try {
    // STEP 2: parse + validate config (RIT-07 strict-mode at every read boundary)
    const ritualConfig = parseRitualConfig(ritual.config);

    // STEP 3: per-ritual self-protective mute (Phase 28 fills mute_until on
    // 2-evasive responses; Phase 25 just respects it if present)
    if (ritualConfig.mute_until) {
      const muteUntil = new Date(ritualConfig.mute_until);
      if (now < muteUntil) {
        logger.info(
          { ritualId: ritual.id, muteUntil: muteUntil.toISOString() },
          'rituals.fire.muted',
        );
        results.push({
          ritualId: ritual.id,
          type: ritual.type,
          fired: false,
          outcome: 'muted',
        });
        return results;
      }
    }

    // STEP 4: catch-up ceiling — if next_run_at is more than 1 cadence period
    // in the past, advance without firing.
    const cadenceMs = cadencePeriodMs(ritual.type);
    const ageMs = now.getTime() - new Date(ritual.nextRunAt).getTime();
    const newNextRunAt = computeNextRunAt(now, ritual.type, ritualConfig);

    if (ageMs > cadenceMs) {
      logger.info(
        { ritualId: ritual.id, ageMs, cadenceMs },
        'rituals.skipped.catchup',
      );
      await tryFireRitualAtomic(ritual.id, ritual.lastRunAt, newNextRunAt);
      results.push({
        ritualId: ritual.id,
        type: ritual.type,
        fired: false,
        outcome: 'caught_up',
      });
      return results;
    }

    // STEP 5: atomic fire — UPDATE...RETURNING marks next_run_at advanced
    // (RIT-10). If race lost (peer sweep already fired), bail.
    logger.info({ ritualId: ritual.id, type: ritual.type }, 'rituals.fire.atomic');
    const fireResult = await tryFireRitualAtomic(
      ritual.id,
      ritual.lastRunAt,
      newNextRunAt,
    );

    if (!fireResult.fired) {
      logger.info({ ritualId: ritual.id }, 'rituals.fire.race_lost');
      results.push({
        ritualId: ritual.id,
        type: ritual.type,
        fired: false,
        outcome: 'race_lost',
      });
      return results;
    }

    // STEP 6: handler dispatch (SKELETON for Phase 25 — Phases 26-29 fill in)
    // Per RESEARCH Assumption A2: Phase 25 throws 'not implemented' here;
    // ROADMAP success criterion 3 only requires runRitualSweep returns []
    // on a clean DB without throwing. With seeded rituals, this code path
    // is exercised but no real send happens.
    try {
      await dispatchRitualHandler(ritual);
      // Atomic UPDATE succeeded — increment the channel-level daily counter
      // (D-04 refinement: ritualCount peer counter, ceiling=3, resets at
      // local Europe/Paris midnight via proactive_state KV table).
      await incrementRitualDailyCount(config.proactiveTimezone);
      logger.info(
        { ritualId: ritual.id, type: ritual.type },
        'rituals.fire.success',
      );
      results.push({
        ritualId: ritual.id,
        type: ritual.type,
        fired: true,
        outcome: 'fired',
      });
    } catch (handlerErr) {
      logger.error(
        { err: handlerErr, ritualId: ritual.id },
        'rituals.fire.handler_error',
      );
      // Even though handler threw, atomic UPDATE already advanced
      // next_run_at — count this as a fire for channel-cap accounting (the
      // daily counter tracks "ritual fire attempts that consumed the
      // channel slot", not "Telegram messages successfully delivered").
      await incrementRitualDailyCount(config.proactiveTimezone);
      results.push({
        ritualId: ritual.id,
        type: ritual.type,
        // atomic UPDATE succeeded — next_run_at advanced even if handler
        // failed, so 'fired' is the correct outcome from the substrate's
        // perspective. Phases 26-29 will replace the throwing skeleton.
        fired: true,
        outcome: 'fired',
        error: handlerErr,
      });
    }
  } catch (err) {
    logger.error({ err, ritualId: ritual.id }, 'rituals.fire.error');
    results.push({
      ritualId: ritual.id,
      type: ritual.type,
      fired: false,
      outcome: 'config_invalid',
      error: err,
    });
  }

  logger.info(
    { durationMs: Date.now() - startMs, fired: results.length },
    'rituals.sweep.done',
  );
  return results;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Approximate cadence period in milliseconds for the catch-up ceiling check.
 * Used for "more than 1 cadence-period in the past" — exact precision not
 * required (the ceiling is a sanity bound, not an interval calculation).
 */
function cadencePeriodMs(type: 'daily' | 'weekly' | 'monthly' | 'quarterly'): number {
  switch (type) {
    case 'daily':
      return 24 * 60 * 60 * 1000;
    case 'weekly':
      return 7 * 24 * 60 * 60 * 1000;
    case 'monthly':
      return 30 * 24 * 60 * 60 * 1000;
    case 'quarterly':
      return 91 * 24 * 60 * 60 * 1000;
  }
}

/**
 * dispatchRitualHandler — SKELETON for Phase 25.
 *
 * Phases 26-29 will type-dispatch on ritual.name (or a ritual.kind field
 * added via Phase 26 seed migration) to the actual handlers (voice note,
 * wellbeing, weekly review). Phase 25 throws 'not implemented' so the code
 * path runs but produces no Telegram side-effect when fired against a clean
 * DB (per RESEARCH Assumption A2 + ROADMAP success criterion 3 "returns []
 * against clean DB without throwing").
 */
async function dispatchRitualHandler(
  ritual: typeof rituals.$inferSelect,
): Promise<void> {
  throw new Error(
    `rituals.dispatch: handler not implemented for ${ritual.type} (Phase 25 ships skeleton; Phases 26-29 fill)`,
  );
}
