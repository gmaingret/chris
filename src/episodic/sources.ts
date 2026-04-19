/**
 * src/episodic/sources.ts — Phase 21 Plan 03
 *
 * Day-bounded read-only queries against `pensieve_entries`, `contradictions`,
 * and `decisions`. Direct Drizzle access — NO `src/decisions/*` API calls and
 * NO `src/relational/*` imports beyond schema types. This module is the M002 +
 * M007 read-only integration boundary called out by CONS-08 and CONS-09.
 *
 * Consumed by: Plan 21-04's `runConsolidate(date)`, which composes a
 * `ConsolidationPromptInput` (defined in `./prompts.ts`) by calling these
 * three helpers in parallel and mapping the rows.
 *
 * Timezone correctness: all three helpers compute the day boundary in the
 * given IANA timezone (e.g. `'Europe/Paris'`), NOT in UTC and NOT in the host
 * machine's local time. The single source of truth for this computation is
 * `dayBoundaryUtc(date, tz)` (exported for testing). DST transitions are
 * handled correctly by Luxon's `DateTime.fromJSDate(date, { zone }).startOf('day')`
 * + `.plus({ days: 1 })` — a spring-forward day spans 23 hours of UTC, a
 * fall-back day spans 25 hours of UTC. See Test 12 in `__tests__/sources.test.ts`.
 *
 * Error handling: NONE. These helpers throw on connection errors and on any
 * Drizzle query error. The caller (Plan 21-04 `runConsolidate`) catches and
 * routes to `notifyError` per CONS-12.
 */
import { and, asc, eq, gte, isNull, lt, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DateTime } from 'luxon';
import { db } from '../db/connection.js';
import { contradictions, decisions, pensieveEntries } from '../db/schema.js';

// ── Public types ────────────────────────────────────────────────────────────

export type DayPensieveEntry = {
  id: string;
  content: string;
  epistemicTag: string | null;
  createdAt: Date;
  source: string;
};

export type DayContradiction = {
  id: string;
  entryAContent: string;
  entryBContent: string;
  description: string;
};

export type DayDecision = {
  id: string;
  decisionText: string;
  lifecycleState: string; // mapped from decisions.status
  reasoning: string;
  prediction: string;
  falsificationCriterion: string;
  resolution: string | null;
  resolutionNotes: string | null;
  createdToday: boolean; // true if captured this day
  resolvedToday: boolean; // true if resolved this day (resolvedAt in window)
};

// ── Day-boundary computation (exported for testing) ─────────────────────────

/**
 * Compute the UTC bounds of the calendar day containing `date` in IANA
 * timezone `tz`. Returns `[start, end)` — `start` inclusive, `end` exclusive
 * — exactly 24h apart on non-DST days; 23h on spring-forward days; 25h on
 * fall-back days.
 *
 * The input `date` may be any instant within the target day (the function
 * snaps to the local-day start regardless of the wall-clock hour). Use
 * `DateTime.fromISO('YYYY-MM-DD', { zone })` from Luxon, or any
 * `new Date(...)` whose instant falls inside the desired local day.
 */
export function dayBoundaryUtc(
  date: Date,
  tz: string,
): { start: Date; end: Date } {
  const local = DateTime.fromJSDate(date, { zone: tz }).startOf('day');
  return {
    start: local.toUTC().toJSDate(),
    end: local.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

// ── Pensieve entries query ──────────────────────────────────────────────────

/**
 * Returns all pensieve_entries with `createdAt` within the day window in `tz`,
 * ordered by `createdAt` ascending, with `deletedAt IS NULL`.
 */
export async function getPensieveEntriesForDay(
  date: Date,
  tz: string,
): Promise<DayPensieveEntry[]> {
  const { start, end } = dayBoundaryUtc(date, tz);
  const rows = await db
    .select({
      id: pensieveEntries.id,
      content: pensieveEntries.content,
      epistemicTag: pensieveEntries.epistemicTag,
      createdAt: pensieveEntries.createdAt,
      source: pensieveEntries.source,
    })
    .from(pensieveEntries)
    .where(
      and(
        gte(pensieveEntries.createdAt, start),
        lt(pensieveEntries.createdAt, end),
        isNull(pensieveEntries.deletedAt),
      ),
    )
    .orderBy(asc(pensieveEntries.createdAt));
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    epistemicTag: r.epistemicTag,
    // `createdAt` is `defaultNow()` — non-null after insert; the column type
    // is nullable in the schema for insert-time convenience but read-side
    // rows always have it set. Coerce here so consumers see a non-null Date.
    createdAt: r.createdAt as Date,
    source: r.source ?? 'telegram',
  }));
}

// ── Contradictions query ────────────────────────────────────────────────────

/**
 * Returns contradictions with `detectedAt` in the day window AND
 * `status = 'DETECTED'` (CONS-09: only "flagged" contradictions go into the
 * episodic prompt; resolved/accepted ones are excluded). Joins
 * `pensieveEntries` twice (aliased as `entry_a` and `entry_b`) to fetch
 * `entryAContent` and `entryBContent` verbatim — the prompt assembler
 * preserves both positions verbatim per D031 and PRD §12.
 *
 * NOTE (review IN-01): the contradictions table has no `confidence` column
 * (confidence lives on `relational_memory`, a different table). The M002
 * confidence ≥ 0.75 threshold referenced in the episodic prompt header is
 * enforced at INSERT time by `src/pensieve/contradiction-detector.ts`: only
 * rows meeting the threshold ever reach `status='DETECTED'`. Filtering by
 * `status='DETECTED'` here is therefore the correct proxy for the confidence
 * threshold — no explicit WHERE on confidence is required or possible.
 */
export async function getContradictionsForDay(
  date: Date,
  tz: string,
): Promise<DayContradiction[]> {
  const { start, end } = dayBoundaryUtc(date, tz);
  const entryA = alias(pensieveEntries, 'entry_a');
  const entryB = alias(pensieveEntries, 'entry_b');
  const rows = await db
    .select({
      id: contradictions.id,
      description: contradictions.description,
      entryAContent: entryA.content,
      entryBContent: entryB.content,
    })
    .from(contradictions)
    .innerJoin(entryA, eq(contradictions.entryAId, entryA.id))
    .innerJoin(entryB, eq(contradictions.entryBId, entryB.id))
    .where(
      and(
        gte(contradictions.detectedAt, start),
        lt(contradictions.detectedAt, end),
        eq(contradictions.status, 'DETECTED'),
      ),
    );
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    entryAContent: r.entryAContent,
    entryBContent: r.entryBContent,
  }));
}

// ── Decisions query ─────────────────────────────────────────────────────────

/**
 * Returns decisions where EITHER `createdAt` OR `resolvedAt` falls within the
 * day window (a decision created on day X and resolved on day Y appears in
 * BOTH days' summaries). `createdToday` and `resolvedToday` flags are set
 * independently per row.
 *
 * Filters out `'open-draft'` status: per Phase 14 D-15, draft decisions are
 * mid-capture conversational state, not committed decisions. Including them
 * in the consolidation prompt would leak in-progress slot-filling drafts
 * into Sonnet's view of the day.
 */
export async function getDecisionsForDay(
  date: Date,
  tz: string,
): Promise<DayDecision[]> {
  const { start, end } = dayBoundaryUtc(date, tz);
  const rows = await db
    .select()
    .from(decisions)
    .where(
      or(
        and(gte(decisions.createdAt, start), lt(decisions.createdAt, end)),
        and(gte(decisions.resolvedAt, start), lt(decisions.resolvedAt, end)),
      ),
    );
  return rows
    .filter((r) => r.status !== 'open-draft')
    .map((r) => ({
      id: r.id,
      decisionText: r.decisionText,
      lifecycleState: r.status,
      reasoning: r.reasoning,
      prediction: r.prediction,
      falsificationCriterion: r.falsificationCriterion,
      resolution: r.resolution,
      resolutionNotes: r.resolutionNotes,
      createdToday:
        r.createdAt !== null && r.createdAt >= start && r.createdAt < end,
      resolvedToday:
        r.resolvedAt !== null && r.resolvedAt >= start && r.resolvedAt < end,
    }));
}
