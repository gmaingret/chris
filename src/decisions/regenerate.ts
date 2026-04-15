import { db } from '../db/connection.js';
import { decisionEvents, decisions } from '../db/schema.js';
import { and, asc, eq } from 'drizzle-orm';

type DecisionRow = typeof decisions.$inferSelect;

/**
 * Timestamptz columns on `decisions`. When the live .select() returns them as
 * Date objects but the jsonb snapshot round-trips them as ISO 8601 strings,
 * we must rehydrate back to Date for deep-equal parity with the live projection.
 *
 * If a future phase adds a new timestamptz column to `decisions`, extend this
 * list. (Scan: grep "timestamp(.*withTimezone" src/db/schema.ts between the
 * `decisions` table declaration boundaries.)
 */
const TIMESTAMPTZ_COLUMNS = [
  'createdAt',
  'updatedAt',
  'resolveBy',
  'resolvedAt',
  'reviewedAt',
  'withdrawnAt',
  'staleAt',
  'abandonedAt',
  'accuracyClassifiedAt',
] as const;

function rehydrateDates(snapshot: Record<string, unknown>): DecisionRow {
  const out: Record<string, unknown> = { ...snapshot };
  for (const col of TIMESTAMPTZ_COLUMNS) {
    const v = out[col];
    if (v === null || v === undefined) continue;
    if (v instanceof Date) continue; // already a Date (defensive)
    if (typeof v === 'string') out[col] = new Date(v);
    else if (typeof v === 'number') out[col] = new Date(v);
  }
  // bigint chat_id round-trip: jsonb cannot store bigint natively; if the snapshot
  // carries it as a string, coerce back for deep-equal parity with Drizzle's
  // bigint-mode read.
  if (typeof out['chatId'] === 'string') out['chatId'] = BigInt(out['chatId']);
  return out as DecisionRow;
}

/**
 * Replays `status_changed` events for `id` in (created_at ASC, sequence_no ASC)
 * order and returns the snapshot of the last one, rehydrated to match the live
 * projection's types (Date for timestamptz; bigint for chat_id).
 *
 * WR-03: We FILTER to `event_type = 'status_changed'` because only status
 * events carry a full-row snapshot (D-01). Phase 14+ will append `field_updated`
 * events whose snapshot is a partial payload; taking the last event
 * unconditionally would return a malformed "DecisionRow" missing required
 * fields. The full-row snapshot invariant holds only for `status_changed`.
 *
 * Proves the append-only invariant (D-01, D-13): if this function deep-equals
 * the live `decisions` row after any sequence of transitions, then every
 * mutation of the projection row was preceded by a faithful event append.
 *
 * Returns null if no `status_changed` events exist for `id` (decision doesn't
 * exist or has no status events recorded).
 */
export async function regenerateDecisionFromEvents(
  id: string,
): Promise<DecisionRow | null> {
  const events = await db
    .select()
    .from(decisionEvents)
    .where(
      and(
        eq(decisionEvents.decisionId, id),
        eq(decisionEvents.eventType, 'status_changed'),
      ),
    )
    .orderBy(asc(decisionEvents.createdAt), asc(decisionEvents.sequenceNo));
  if (events.length === 0) return null;
  const last = events[events.length - 1]!;
  return rehydrateDates(last.snapshot as Record<string, unknown>);
}
