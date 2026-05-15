/**
 * src/rituals/idempotency.ts — Phase 25 Plan 02 Task 3 (RIT-10) +
 *                              Phase 42 Plan 01 Task 2 (RACE-01)
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
 *   2. WHERE-clause guard predicate (post-RACE-01):
 *      `(last_run_at IS NULL OR last_run_at < now())`. The SET clause writes
 *      `last_run_at = now()` (postgres `now()`), not `new Date()` (JS clock).
 *      Postgres `now()` returns the transaction-start timestamp and advances
 *      strictly monotonically per transaction. Row-level locking serializes
 *      the two updates; the second one's WHERE-guard fails after the first
 *      commits because the first already advanced `last_run_at` to its
 *      transaction's `now()`, which is strictly less than the second
 *      transaction's `now()`. Strict `<` is safe (and load-bearing) because
 *      `now()` is monotonic per-tx — `now() < now()` is FALSE for the same
 *      tx, TRUE for an earlier committed tx.
 *
 *      ⚠ History: Phase 25 originally shipped strict `<` against `new Date()`
 *      (JS clock). Production effect: every ritual fired EXACTLY ONCE then
 *      got permanently stuck — the second-fire predicate could never be
 *      satisfied (`T1 < T1` is FALSE). Surfaced 2026-05-09 (daily_journal +
 *      daily_wellbeing stopped firing after their May 5 + May 6 first-fires).
 *      Patched 2026-05-10 (commit c76cb86) by flipping `<` → `<=` — but that
 *      flip left a ms-resolution JS-clock collision back-door open under the
 *      every-minute cron: two concurrent UPDATEs both passing the lte
 *      predicate against the same `lastObserved` could BOTH succeed if the
 *      `new Date()` SET clause produced the same ms across both transactions.
 *      Phase 42 RACE-01 closes this permanently: postgres `now()` for both
 *      SET and predicate, strict `<` semantics restored (monotonic per-tx).
 *   3. Race semantics: two concurrent invocations against the same row
 *      produce EXACTLY ONE returned row (the winner) and ONE empty result
 *      (the loser). The loser receives `{ fired: false }` and the sweep
 *      handler routes it to the `'race_lost'` outcome.
 *
 *   4. D-42-15 (Phase 42 cross-cutting convention): postgres `now()` in SQL
 *      fragments is the canonical "current time" for race semantics across
 *      the codebase. Application `new Date()` is reserved for log lines,
 *      jsonb metadata payloads, and Telegram message timestamps — never for
 *      race-defining columns like `last_run_at`, `responded_at`, or any
 *      future field whose ordering vs. a sibling row matters.
 *
 *   5. `lastObserved` parameter post-RACE-01: no longer load-bearing for the
 *      race semantics (postgres `now()` advances strictly monotonically
 *      per-tx; the second invocation's WHERE always fails regardless of what
 *      the caller observed). Retained for caller visibility/logging — a
 *      sweep that observed `lastRunAt = T1` may still log it for forensic
 *      reasons. Future cleanup could drop the parameter entirely; kept for
 *      v2.6.1 to avoid touching every caller.
 *
 * Phase 25 ships the atomicity primitive only. Phase 28 layers
 * `ritual_fire_events` append-only audit on top in a `db.transaction()` that
 * couples the UPDATE with an event INSERT. Phase 25 itself does NOT need a
 * transaction because there is no event-INSERT to atomically pair with — the
 * single UPDATE is its own atomic unit.
 */
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
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
 *   observed for this row. Retained for caller visibility/logging; NOT
 *   load-bearing for the race semantics post-RACE-01 (the postgres `now()`
 *   predicate alone is sufficient — see file docstring contract item 5).
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
  // Guard predicate construction (RACE-01 — D-42-02):
  //
  //   lastObserved === null   →  isNull(rituals.lastRunAt)
  //   lastObserved !== null   →  or(isNull(lastRunAt), lt(lastRunAt, sql`now()`))
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
  // The non-null case uses strict `lt(lastRunAt, sql\`now()\`)` against the
  // SET clause's `lastRunAt: sql\`now()\``. Postgres `now()` is the
  // transaction-start timestamp; it is constant within a transaction and
  // advances strictly monotonically across transactions. After the winning
  // tx commits, the row's lastRunAt equals the WINNER's `now()`. The losing
  // tx then re-evaluates its WHERE: `lastRunAt < now()` where
  // `lastRunAt = WINNER_now` and `now()` is the LOSER's start timestamp.
  // Postgres guarantees `WINNER_now < LOSER_now` (commit order) AND that the
  // loser's `now()` is its own tx's start, so the loser's row.lastRunAt
  // (which IS WINNER_now) is strictly less than its `now()` — UPDATE matches
  // zero rows. Strict `<` works precisely because `now()` is monotonic
  // per-tx, unlike `new Date()` (JS clock) which could collide at ms
  // resolution under the every-minute cron and let both txs pass the
  // predicate.
  //
  // The non-null case retains the OR(isNull, ...) shape so a peer that
  // somehow reset lastRunAt back to null (operator intervention) still
  // permits a sweep tick to claim the row.
  const lastRunAtPredicate = lastObserved
    ? or(isNull(rituals.lastRunAt), lt(rituals.lastRunAt, sql`now()`))
    : isNull(rituals.lastRunAt);

  const updated = await db
    .update(rituals)
    .set({ lastRunAt: sql`now()`, nextRunAt: newNextRunAt })
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
