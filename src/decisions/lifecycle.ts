import { db } from '../db/connection.js';
import { decisions, decisionEvents } from '../db/schema.js';
import { and, eq } from 'drizzle-orm';
import {
  InvalidTransitionError,
  OptimisticConcurrencyError,
  DecisionNotFoundError,
  type DecisionStatusLiteral,
} from './errors.js';

/**
 * Legal transitions for `decisions.status` — locked per D-04.
 * Terminal states (reviewed/withdrawn/stale/abandoned) have NO outgoing edges.
 * Any (from, to) pair NOT listed here throws InvalidTransitionError.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<DecisionStatusLiteral, readonly DecisionStatusLiteral[]>> = {
  'open-draft': ['open', 'withdrawn', 'abandoned'],
  'open':       ['due', 'withdrawn'],
  'due':        ['resolved', 'stale', 'withdrawn'],
  'resolved':   ['reviewed'],
  'reviewed':   [],
  'withdrawn':  [],
  'stale':      [],
  'abandoned':  [],
} as const;

export type ActorKind = 'capture' | 'transition' | 'sweep' | 'user' | 'system';

export interface TransitionPayload {
  actor?: ActorKind;  // default 'system'
}

/**
 * Coerce non-JSON-serializable values on a decisions row into forms that can
 * round-trip through jsonb. In particular, `chat_id` is a bigint in JS (column
 * declared `bigint({ mode: 'bigint' })` in schema.ts), and `JSON.stringify`
 * throws `TypeError: Do not know how to serialize a BigInt`. Postgres jsonb
 * cannot natively store bigints either, so we stringify it on the write side
 * and `regenerate.ts` rehydrates it with `BigInt(...)` on the read side.
 */
function snapshotForEvent(row: typeof decisions.$inferSelect): object {
  return {
    ...row,
    chatId: row.chatId === null ? null : row.chatId.toString(),
  };
}

/**
 * THE chokepoint. The ONLY code path that SETs decisions.status.
 *
 * Signature: caller passes expected `fromStatus` explicitly. This gives us:
 *   (a) the optimistic-UPDATE WHERE-clause guard without a pre-read round-trip
 *   (b) clean distinction between missing-row (DecisionNotFoundError)
 *       and stale-status (OptimisticConcurrencyError) without inventing
 *       a fake fromStatus.
 *
 * Transaction ordering (UPDATE-first-then-INSERT):
 *   BEGIN (implicit)
 *   UPDATE decisions SET status=$toStatus, updatedAt=now(), ...terminalTimestamps
 *     WHERE id=$id AND status=$fromStatus
 *     RETURNING *
 *   IF updated.length === 0:
 *     SELECT id FROM decisions WHERE id=$id LIMIT 1
 *     IF exists.length === 0: throw DecisionNotFoundError(id)
 *     ELSE:                    throw OptimisticConcurrencyError(id, fromStatus)
 *   INSERT decision_events (event_type='status_changed', from_status, to_status,
 *                           snapshot=<the real returned row>, actor)
 *   COMMIT (implicit)
 *
 * Append-first SPIRIT is preserved: the event and the projection change land in
 * the SAME atomic transaction — if the INSERT fails for any reason, the UPDATE
 * rolls back with it. No placeholder snapshot, no overwrite, no .update() on
 * decision_events anywhere.
 */
export async function transitionDecision(
  id: string,
  fromStatus: DecisionStatusLiteral,
  toStatus: DecisionStatusLiteral,
  payload: TransitionPayload = {},
) {
  // 1. Fast-fail illegal transitions BEFORE opening a transaction.
  const legal = LEGAL_TRANSITIONS[fromStatus] ?? [];
  if (!legal.includes(toStatus) || fromStatus === toStatus) {
    throw new InvalidTransitionError(fromStatus, toStatus);
  }

  const actor: ActorKind = payload.actor ?? 'system';

  // 2. Atomic UPDATE-first-then-INSERT transaction.
  return await db.transaction(async (tx) => {
    const terminalTimestamp =
      toStatus === 'withdrawn' ? { withdrawnAt: new Date() } :
      toStatus === 'stale'     ? { staleAt: new Date() } :
      toStatus === 'abandoned' ? { abandonedAt: new Date() } :
      toStatus === 'resolved'  ? { resolvedAt: new Date() } :
      toStatus === 'reviewed'  ? { reviewedAt: new Date() } :
      {};

    // 2a. Optimistic UPDATE with WHERE-clause guard on expected fromStatus.
    const updated = await tx.update(decisions)
      .set({ status: toStatus, updatedAt: new Date(), ...terminalTimestamp })
      .where(and(eq(decisions.id, id), eq(decisions.status, fromStatus)))
      .returning();

    // 2b. If 0 rows affected: distinguish missing-row from stale-status.
    if (updated.length === 0) {
      const exists = await tx.select({ id: decisions.id }).from(decisions)
        .where(eq(decisions.id, id))
        .limit(1);
      if (exists.length === 0) {
        throw new DecisionNotFoundError(id);
      }
      throw new OptimisticConcurrencyError(id, fromStatus);
    }

    // 2c. INSERT event with the real post-update row as snapshot (D-01 full-snapshot).
    // No placeholder, no overwrite — the event lands with the actual projection state
    // in the same atomic transaction.
    await tx.insert(decisionEvents).values({
      decisionId: id,
      eventType: 'status_changed',
      fromStatus,
      toStatus,
      snapshot: snapshotForEvent(updated[0]!),
      actor,
    });

    return updated[0]!;
  });
}
