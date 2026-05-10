/**
 * src/rituals/idempotency.ts — Phase 25 Plan 02 Task 3 (RIT-10)
 *
 * Atomic check-and-set primitive for ritual fire. The single source of
 * concurrency safety for the ritual sweep — without this, two parallel sweep
 * ticks targeting the same ritual row could both fire the prompt, double-
 * messaging the user (Pitfall 1).
 *
 * Mirrors the M007 D-28 optimistic-concurrency pattern from
 * `src/decisions/lifecycle.ts:107-110` (`transitionDecision`). The contract:
 *
 *   1. Single round-trip: `UPDATE rituals SET … WHERE … RETURNING *`. No
 *      SELECT-then-UPDATE race window.
 *   2. WHERE-clause guard predicate: `(last_run_at IS NULL OR last_run_at <=
 *      $observed)`. Postgres row-level locking serializes the two updates;
 *      the second one's WHERE-guard fails after the first commits because
 *      the first already advanced `last_run_at` PAST `$observed` (strictly
 *      greater than). The `<=` (not `<`) is load-bearing: when a sweep
 *      observes `last_run_at = T1` and attempts to fire, the row's current
 *      `last_run_at` IS `T1` — strict `<` would fail the predicate and the
 *      ritual could never fire a second time. With `<=`, the first sweep's
 *      UPDATE succeeds (T1 ≤ T1), advancing `last_run_at` to a NEW value
 *      strictly greater than T1; any concurrent sweep that also observed T1
 *      then sees `last_run_at = NEW > T1` so its `last_run_at <= T1`
 *      predicate is FALSE, correctly losing the race.
 *
 *      ⚠ Phase 25 originally shipped strict `<` here. Production effect:
 *      every ritual fired EXACTLY ONCE then got permanently stuck because
 *      the second-fire predicate could never be satisfied. The catch-up
 *      ceiling in scheduler.ts STEP 4 used the same function and inherited
 *      the same stuck behavior. Surfaced 2026-05-09 when daily_journal +
 *      daily_wellbeing both stopped firing after their May 5 + May 6
 *      first-fires. Fixed by flipping `<` → `<=`.
 *   3. Race semantics: two concurrent invocations against the same row under
 *      the same `lastObserved` produce EXACTLY ONE returned row (the
 *      winner) and ONE empty result (the loser). The loser receives
 *      `{ fired: false }` and the sweep handler routes it to the
 *      `'race_lost'` outcome (Phase 25 ships the union scaffold; Phase 28
 *      wires the outcome to the `ritual_fire_events` audit log).
 *
 * Phase 25 ships the atomicity primitive only. Phase 28 layers
 * `ritual_fire_events` append-only audit on top in a `db.transaction()` that
 * couples the UPDATE with an event INSERT. Phase 25 itself does NOT need a
 * transaction because there is no event-INSERT to atomically pair with — the
 * single UPDATE is its own atomic unit.
 */
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { rituals } from '../db/schema.js';

// ── Atomic ritual-fire concurrency primitive (M009 Phase 25 RIT-10) ────────

export interface TryFireResult {
  fired: boolean;
  /** Defined only when `fired === true`. */
  row?: typeof rituals.$inferSelect;
}

/**
 * tryFireRitualAtomic — claim the ritual fire slot atomically.
 *
 * @param ritualId - The UUID of the ritual row to attempt to fire.
 * @param lastObserved - The `last_run_at` value the caller most recently
 *   observed for this row, or `null` if the caller observed `last_run_at IS
 *   NULL`. Used as the optimistic-concurrency guard: if the row's current
 *   `last_run_at` is greater than (or equal to) `lastObserved`, the WHERE
 *   predicate fails and the caller is the race-loser.
 * @param newNextRunAt - The new value to write into `next_run_at` (typically
 *   the result of `computeNextRunAt(now, cadence, config)`).
 *
 * @returns `{ fired: true, row }` on success, `{ fired: false }` if the
 *   row no longer exists OR a peer already advanced `last_run_at` past our
 *   observation.
 */
export async function tryFireRitualAtomic(
  ritualId: string,
  lastObserved: Date | null,
  newNextRunAt: Date,
): Promise<TryFireResult> {
  // Guard predicate construction:
  //
  //   lastObserved === null   →  isNull(rituals.lastRunAt)
  //   lastObserved !== null   →  or(isNull(lastRunAt), lte(lastRunAt, lastObserved))
  //
  // The null-observation case is the load-bearing branch for the FIRST
  // fire's concurrency contract. If we used a row-state-INDEPENDENT
  // predicate (e.g. `sql\`true\``) for the null case, two concurrent UPDATEs
  // would both pass the predicate even after the first commits — postgres
  // row-level locking would serialize them, but the second's WHERE
  // re-evaluation would still succeed because the predicate doesn't depend
  // on the row's current last_run_at. By restricting the null case to
  // `isNull(lastRunAt)`, the second invocation's WHERE re-evaluation FAILS
  // (the row's lastRunAt is now non-null after the first commit), so the
  // second invocation gets zero rows back.
  //
  // The non-null case uses `<=` (NOT strict `<`). Strict `<` would prevent
  // the second fire of any ritual: a sweep observes lastRunAt=T1, calls
  // tryFire(id, T1, ...), and the WHERE predicate `lastRunAt < T1`
  // evaluates against the current row state where lastRunAt IS T1 — so
  // `T1 < T1` is FALSE and UPDATE matches zero rows. With `<=`, the first
  // sweep's UPDATE succeeds and advances lastRunAt to a NEW value strictly
  // greater than T1 (since `new Date()` is monotonic per call). A concurrent
  // sweep that also observed T1 then re-evaluates against the post-UPDATE
  // row where lastRunAt = NEW > T1, so `NEW <= T1` is FALSE — race lost
  // correctly. Same SQL-level proof of exactly-once-per-observation, with
  // the second-fire path actually working.
  //
  // The non-null case retains the OR(isNull, ...) shape so a peer that
  // somehow reset lastRunAt back to null (operator intervention) still
  // permits a sweep tick to claim the row.
  const lastRunAtPredicate = lastObserved
    ? or(isNull(rituals.lastRunAt), lte(rituals.lastRunAt, lastObserved))
    : isNull(rituals.lastRunAt);

  const updated = await db
    .update(rituals)
    .set({ lastRunAt: new Date(), nextRunAt: newNextRunAt })
    .where(and(eq(rituals.id, ritualId), lastRunAtPredicate))
    .returning();

  if (updated.length === 0) {
    // Race lost — peer sweep already fired this ritual since our SELECT,
    // OR the row was deleted, OR our lastObserved is stale. Caller routes
    // this to the 'race_lost' RitualFireOutcome.
    return { fired: false };
  }
  return { fired: true, row: updated[0] };
}
