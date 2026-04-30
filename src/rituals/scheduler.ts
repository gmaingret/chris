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
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { ritualFireEvents, ritualPendingResponses, rituals } from '../db/schema.js';
import {
  hasReachedRitualDailyCap,
  incrementRitualDailyCount,
} from '../proactive/state.js';
import { logger } from '../utils/logger.js';
import { computeNextRunAt } from './cadence.js';
import { tryFireRitualAtomic } from './idempotency.js';
import {
  RITUAL_OUTCOME,
  parseRitualConfig,
  type RitualFireResult,
  type RitualFireOutcome,
  type RitualConfig,
} from './types.js';
import { shouldFireAdjustmentDialogue } from './skip-tracking.js';
import { fireAdjustmentDialogue } from './adjustment-dialogue.js';
import { fireVoiceNote } from './voice-note.js';
import { fireWeeklyReview } from './weekly-review.js';
import { fireWellbeing } from './wellbeing.js';

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

  // Phase 28 SKIP-01 — Response window sweep (runs BEFORE STEP 0 channel-cap).
  // Detects expired ritual_pending_responses rows and emits window_missed +
  // fired_no_response events. Best-effort: a failure here does NOT block the
  // standard dispatch path below (try/catch isolates the helper).
  try {
    await ritualResponseWindowSweep(now);
  } catch (sweepErr) {
    logger.error({ err: sweepErr }, 'rituals.window_sweep.error');
  }

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

    // Phase 28 Plan 03 SKIP-04 — adjustment-dialogue predicate dispatch.
    // After atomic-fire claim succeeds (next_run_at advanced — RIT-10), check
    // whether skip_count has reached the cadence-aware threshold. If yes,
    // dispatch fireAdjustmentDialogue instead of standard handler.
    // Plan 28-02 shipped the predicate gate; Plan 28-03 wires the real handler.
    //
    // Note: skipCount is NOT reset on this branch — the threshold-met state
    // persists until Greg replies (reset in handleAdjustmentReply no_change path)
    // or the 60s confirmation window auto-applies a patch (ritualConfirmationSweep).
    //
    // Note: incrementRitualDailyCount IS called on this branch — the channel-cap
    // accounting tracks "ritual fire attempts that consumed the channel slot".
    if (await shouldFireAdjustmentDialogue(ritual)) {
      logger.info(
        { ritualId: ritual.id, skipCount: ritual.skipCount, type: ritual.type },
        'rituals.adjustment_dialogue.predicate_hit',
      );
      try {
        const outcome = await fireAdjustmentDialogue(ritual);
        await incrementRitualDailyCount(config.proactiveTimezone);
        results.push({
          ritualId: ritual.id,
          type: ritual.type,
          fired: outcome === 'in_dialogue',
          outcome,
        });
      } catch (err) {
        logger.error({ err, ritualId: ritual.id }, 'rituals.adjustment_dialogue.error');
        await incrementRitualDailyCount(config.proactiveTimezone);
        results.push({
          ritualId: ritual.id,
          type: ritual.type,
          fired: false,
          outcome: 'in_dialogue',
          error: err,
        });
      }
      return results;
    }

    // STEP 6: handler dispatch (SKELETON for Phase 25 — Phases 26-29 fill in)
    // Per RESEARCH Assumption A2: Phase 25 throws 'not implemented' here;
    // ROADMAP success criterion 3 only requires runRitualSweep returns []
    // on a clean DB without throwing. With seeded rituals, this code path
    // is exercised but no real send happens.
    try {
      const outcome = await dispatchRitualHandler(ritual, ritualConfig);
      // Atomic UPDATE succeeded — increment the channel-level daily counter
      // (D-04 refinement: ritualCount peer counter, ceiling=3, resets at
      // local Europe/Paris midnight via proactive_state KV table).
      await incrementRitualDailyCount(config.proactiveTimezone);
      logger.info(
        { ritualId: ritual.id, type: ritual.type, outcome },
        'rituals.fire.success',
      );
      results.push({
        ritualId: ritual.id,
        type: ritual.type,
        fired: outcome === 'fired',
        outcome,
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
 * ritualResponseWindowSweep — Phase 28 Plan 01 SKIP-01 substrate helper.
 *
 * Scans ritual_pending_responses for rows whose expires_at has passed with
 * consumed_at IS NULL and emits PAIRED ritual_fire_events per row:
 *   1. WINDOW_MISSED  — the fact: response window passed without consumption.
 *   2. FIRED_NO_RESPONSE — the policy classification: THE skip-counting outcome.
 *
 * Separation rationale (RESEARCH Landmine 8): window_missed is the underlying
 * fact; fired_no_response is the policy classification. Downstream projections
 * (Plan 28-02's computeSkipCount) can filter on either independently.
 *
 * Atomic-consume race-safety: mirrors voice-note.ts:184-204 (RIT-10
 * idempotency precedent). UPDATE...WHERE consumedAt IS NULL RETURNING ensures
 * at most ONE sweep tick wins per pending row. A concurrent PP#5 deposit that
 * already consumed the row causes this sweep to silently skip that iteration.
 *
 * Idempotent skip_count increment: each fired_no_response has its own unique
 * event row (uuid PK on ritualFireEvents), so the increment count matches the
 * event count on replay. Re-running the sweep never double-counts.
 *
 * Per-call LIMIT 50 protects against backlog of expired rows triggering
 * unbounded work in a single tick (T-28-D1 DoS mitigant). Backlog drains
 * over subsequent sweep ticks.
 *
 * Wrapped in try/catch at the runRitualSweep call site — a sweep-helper
 * failure does NOT block the standard handler dispatch path.
 *
 * @param now - Current timestamp (explicit parameter for testability; defaults
 *   to new Date() in production).
 * @returns Number of fired_no_response events emitted in this call.
 */
export async function ritualResponseWindowSweep(now: Date = new Date()): Promise<number> {
  // STEP 1: SELECT expired, unconsumed pending rows. LIMIT 50 per-call cap.
  const expired = await db
    .select()
    .from(ritualPendingResponses)
    .where(
      and(
        isNull(ritualPendingResponses.consumedAt),
        // expiresAt <= now: the response window has closed
        sql`${ritualPendingResponses.expiresAt} <= ${now.toISOString()}`,
      ),
    )
    .limit(50);

  if (expired.length === 0) {
    return 0; // hot path — sub-millisecond when nothing pending
  }

  let emittedCount = 0;

  for (const row of expired) {
    // STEP 2: Atomic-consume via UPDATE...RETURNING (mirrors voice-note.ts:184-204).
    // If no row returned, a concurrent sweep or PP#5 deposit consumed it first.
    // Race is handled silently — continue to next iteration.
    const [consumed] = await db
      .update(ritualPendingResponses)
      .set({ consumedAt: now })
      .where(
        and(
          eq(ritualPendingResponses.id, row.id),
          isNull(ritualPendingResponses.consumedAt),
        ),
      )
      .returning({
        id: ritualPendingResponses.id,
      });

    if (!consumed) {
      // Race lost — peer (PP#5 or concurrent sweep) consumed first. Silently skip.
      continue;
    }

    // STEP 3: PAIRED EMIT — window_missed (fact) + fired_no_response (policy).
    // Two sequential inserts, NOT a transaction — both are idempotent under
    // retry because each has a unique uuid PK. D-28-03 accepts this tradeoff.
    const pendingResponseId = row.id;
    const expiresAtIso = row.expiresAt.toISOString();

    await db.insert(ritualFireEvents).values({
      ritualId: row.ritualId,
      firedAt: now,
      outcome: RITUAL_OUTCOME.WINDOW_MISSED,
      metadata: { pendingResponseId, expiresAt: expiresAtIso },
    });

    await db.insert(ritualFireEvents).values({
      ritualId: row.ritualId,
      firedAt: now,
      outcome: RITUAL_OUTCOME.FIRED_NO_RESPONSE,
      metadata: { pendingResponseId, expiresAt: expiresAtIso },
    });

    // STEP 4: Increment denormalized skip_count by 1 (D-28-03).
    // Idempotent: each fired_no_response event is unique, so increment count
    // matches event count after replay from ritual_fire_events.
    await db
      .update(rituals)
      .set({ skipCount: sql`${rituals.skipCount} + 1` })
      .where(eq(rituals.id, row.ritualId));

    emittedCount++;
  }

  logger.info(
    { scanned: expired.length, emitted: emittedCount },
    'rituals.window_sweep.done',
  );

  return emittedCount;
}

/**
 * dispatchRitualHandler — name-keyed dispatch (D-26-08 / D-29-08).
 *
 * Phase 26 filled in daily_voice_note. Phase 27 filled in daily_wellbeing.
 * Phase 29 (this commit) fills in weekly_review — the Sunday 20:00 Paris
 * Sonnet-driven observation ritual.
 *
 * Keying by ritual.name (not ritual.type / cadence) is intentional —
 * multiple rituals can share a cadence (e.g. daily_voice_note and
 * daily_wellbeing are both 'daily'), so cadence is not unique enough.
 *
 * Default branch preserved as a safety belt for unimplemented handlers
 * (e.g., future M013 monthly/quarterly rituals seeded before their handler
 * lands). The atomic UPDATE...RETURNING in runRitualSweep already advanced
 * next_run_at by the time control reaches here, so a throw here surfaces
 * via 'rituals.fire.handler_error' in the sweep's logs without looping.
 */
async function dispatchRitualHandler(
  ritual: typeof rituals.$inferSelect,
  cfg: RitualConfig,
): Promise<RitualFireOutcome> {
  switch (ritual.name) {
    case 'daily_voice_note':
      return fireVoiceNote(ritual, cfg);
    case 'daily_wellbeing':
      return fireWellbeing(ritual, cfg);
    case 'weekly_review':
      return fireWeeklyReview(ritual, cfg);
    default:
      throw new Error(
        `rituals.dispatch: handler not implemented for ${ritual.name}`,
      );
  }
}
