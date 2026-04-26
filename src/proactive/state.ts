import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { proactiveState } from '../db/schema.js';
import { logger } from '../utils/logger.js';

// ── Key constants ──────────────────────────────────────────────────────────

const LAST_SENT_KEY = 'last_sent';
const LAST_SENT_REFLECTIVE_KEY = 'last_sent_reflective';
const LAST_SENT_ACCOUNTABILITY_KEY = 'last_sent_accountability';
const MUTE_UNTIL_KEY = 'mute_until';
const RITUAL_DAILY_COUNT_KEY = 'ritual_daily_count';
const RITUAL_DAILY_CAP = 3; // Per CONTEXT.md D-04 (REFINED 2026-04-26): 3/day channel ceiling

// ── Helpers ────────────────────────────────────────────────────────────────

async function getValue(key: string): Promise<unknown | null> {
  const rows = await db
    .select({ value: proactiveState.value })
    .from(proactiveState)
    .where(eq(proactiveState.key, key))
    .limit(1);
  return rows.length > 0 ? rows[0]!.value : null;
}

async function setValue(key: string, value: unknown): Promise<void> {
  await db
    .insert(proactiveState)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: proactiveState.key,
      set: { value, updatedAt: new Date() },
    });
}

async function deleteKey(key: string): Promise<void> {
  await db.delete(proactiveState).where(eq(proactiveState.key, key));
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Get the last time a proactive message was sent. */
export async function getLastSent(): Promise<Date | null> {
  const val = await getValue(LAST_SENT_KEY);
  if (val == null) return null;
  return new Date(val as string);
}

/** Record that a proactive message was sent now (or at a specific time). */
export async function setLastSent(timestamp: Date): Promise<void> {
  await setValue(LAST_SENT_KEY, timestamp.toISOString());
}

/**
 * Check whether a proactive message has already been sent today
 * in the given timezone. Uses Intl.DateTimeFormat for timezone conversion.
 */
export async function hasSentToday(timezone: string): Promise<boolean> {
  const lastSent = await getLastSent();
  if (!lastSent) return false;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const lastSentDate = formatter.format(lastSent);
  const todayDate = formatter.format(new Date());

  return lastSentDate === todayDate;
}

/** Get the mute-until timestamp (null if not muted). */
export async function getMuteUntil(): Promise<Date | null> {
  const val = await getValue(MUTE_UNTIL_KEY);
  if (val == null) return null;
  return new Date(val as string);
}

/** Set or clear the mute-until timestamp. Pass null to unmute. */
export async function setMuteUntil(until: Date | null): Promise<void> {
  if (until === null) {
    await deleteKey(MUTE_UNTIL_KEY);
  } else {
    await setValue(MUTE_UNTIL_KEY, until.toISOString());
  }
}

/** Check whether proactive messaging is currently muted. */
export async function isMuted(): Promise<boolean> {
  const muteUntil = await getMuteUntil();
  if (!muteUntil) return false;
  return muteUntil.getTime() > Date.now();
}

// ── Channel-aware state helpers ────────────────────────────────────────────

/**
 * Check whether a reflective outreach was sent today.
 * Falls back to legacy 'last_sent' key per D-07 migration.
 */
export async function hasSentTodayReflective(timezone: string): Promise<boolean> {
  const reflectiveVal = await getValue(LAST_SENT_REFLECTIVE_KEY);
  const val = reflectiveVal ?? (await getValue(LAST_SENT_KEY));
  if (val == null) return false;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(val as string)) === formatter.format(new Date());
}

/** Record that a reflective outreach was sent. */
export async function setLastSentReflective(timestamp: Date): Promise<void> {
  await setValue(LAST_SENT_REFLECTIVE_KEY, timestamp.toISOString());
}

/**
 * Check whether an accountability outreach was sent today.
 * No legacy fallback — accountability channel is new, no migration needed.
 */
export async function hasSentTodayAccountability(timezone: string): Promise<boolean> {
  const val = await getValue(LAST_SENT_ACCOUNTABILITY_KEY);
  if (val == null) return false;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(val as string)) === formatter.format(new Date());
}

/** Record that an accountability outreach was sent. */
export async function setLastSentAccountability(timestamp: Date): Promise<void> {
  await setValue(LAST_SENT_ACCOUNTABILITY_KEY, timestamp.toISOString());
}

// ── Ritual channel daily counter (D-04 refinement) ────────────────────────

/**
 * Local-date key formatter — matches hasSentTodayReflective shape exactly.
 * Returns YYYY-MM-DD in the given timezone for the given date (default: now).
 */
function localDateKeyFor(timezone: string, date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Check whether the ritual channel has reached its daily ceiling (D-04
 * refinement: 3/day). Mirrors hasSentTodayReflective/hasSentTodayAccountability
 * shape (lines 102-148 of this file) — same KV table, same date-keying.
 *
 * Returns true if a counter exists keyed to TODAY (local timezone) AND the
 * count is >= RITUAL_DAILY_CAP. Stale yesterday-keyed counters are treated
 * as 0/3 (counter resets at local midnight by the date-key strategy, no
 * explicit cron-based reset needed).
 */
export async function hasReachedRitualDailyCap(timezone: string): Promise<boolean> {
  const val = await getValue(RITUAL_DAILY_COUNT_KEY);
  if (val == null) return false;
  const { date, count } = val as { date: string; count: number };
  const todayKey = localDateKeyFor(timezone);
  if (date !== todayKey) return false; // stale yesterday counter — today is fresh
  return count >= RITUAL_DAILY_CAP;
}

/**
 * Increment the ritual channel daily counter (D-04 refinement). Called by
 * runRitualSweep AFTER a successful tryFireRitualAtomic returns fired=true.
 *
 * Rolls over at local midnight: if the persisted counter is keyed to a
 * different local date (yesterday or older), this call resets it to
 * { date: today, count: 1 } rather than incrementing the stale value.
 *
 * Race window note: TOCTOU between getValue and setValue. Acceptable for
 * Phase 25 — the ritual cron fires once per day at 21:00 Paris and per-tick
 * max-1 ensures only 1 ritual processes per tick, so realistic concurrency
 * is bounded. If a future phase adds higher-frequency sweeps, replace with
 * an atomic JSONB INCR via ON CONFLICT UPDATE SET value = jsonb_set(...).
 */
export async function incrementRitualDailyCount(timezone: string): Promise<void> {
  const val = await getValue(RITUAL_DAILY_COUNT_KEY);
  const todayKey = localDateKeyFor(timezone);
  let nextCount = 1;
  if (val != null) {
    const { date, count } = val as { date: string; count: number };
    if (date === todayKey) {
      nextCount = count + 1;
    }
    // else: stale yesterday counter — discard and start fresh at 1
  }
  await setValue(RITUAL_DAILY_COUNT_KEY, { date: todayKey, count: nextCount });
}

// ── Per-decision escalation tracking (RES-06) ────────────────────────────

const escalationSentKey = (decisionId: string) => `accountability_sent_${decisionId}`;
const escalationCountKey = (decisionId: string) => `accountability_prompt_count_${decisionId}`;

/**
 * Get when the last accountability prompt was sent for a specific decision.
 *
 * IN-05: Uses `val == null` to match the null-check pattern used by the rest
 * of this file (see `getLastSent`, `getMuteUntil`, `hasSentTodayReflective`,
 * `hasSentTodayAccountability`). The previous `val ? ...` truthy check also
 * treated empty string `""` as "not present" — safe in practice because
 * `setEscalationSentAt` always writes an ISO timestamp, but stylistically
 * inconsistent and brittle against JSONB corruption scenarios.
 */
export async function getEscalationSentAt(decisionId: string): Promise<Date | null> {
  const val = await getValue(escalationSentKey(decisionId));
  if (val == null) return null;
  return new Date(val as string);
}

/** Record when an accountability prompt was sent for a specific decision. */
export async function setEscalationSentAt(decisionId: string, timestamp: Date): Promise<void> {
  await setValue(escalationSentKey(decisionId), timestamp.toISOString());
}

/**
 * Get the number of accountability prompts sent for a specific decision.
 *
 * Treats only `null`/`undefined` as "not yet set" → returns 0.
 * On type mismatch (JSONB corruption: string, bool, object, etc.) logs a
 * warning and still returns 0 so the sweep tick does not hard-fail. The warn
 * log makes the corruption visible so it can be investigated instead of
 * silently re-arming the 48h follow-up cycle.
 */
export async function getEscalationCount(decisionId: string): Promise<number> {
  const val = await getValue(escalationCountKey(decisionId));
  if (val == null) return 0;
  if (typeof val !== 'number') {
    logger.warn(
      { decisionId, val, valType: typeof val },
      'proactive.state.escalation_count.non_numeric',
    );
    return 0;
  }
  return val;
}

/** Set the accountability prompt count for a specific decision. */
export async function setEscalationCount(decisionId: string, count: number): Promise<void> {
  await setValue(escalationCountKey(decisionId), count);
}

/**
 * Atomically persist both the escalation prompt count and the prompt sent-at
 * timestamp for a specific decision inside a single drizzle transaction.
 *
 * WR-01: Without a transaction, `setEscalationCount` followed by
 * `setEscalationSentAt` (or the reverse) are two independent KV writes. If the
 * second call fails (connection drop, constraint error), only one of the pair
 * lands in `proactive_state`. On the next sweep tick the stale reader sees a
 * desynced (count, sentAt) pair — e.g. count=2 without the matching sentAt
 * bump — and may transition the decision to `stale` prematurely or re-send a
 * follow-up against an outdated timestamp.
 *
 * Call this helper whenever the count AND sentAt must advance together (the
 * bootstrap and 48h follow-up branches in `sweep.ts`). The legacy single-key
 * setters are kept for cases that only need to stamp one value (e.g. the
 * legacy-row bootstrap branch that may preserve an existing count).
 */
export async function setEscalationState(
  decisionId: string,
  count: number,
  sentAt: Date,
): Promise<void> {
  const sentKey = escalationSentKey(decisionId);
  const countKey = escalationCountKey(decisionId);
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(proactiveState)
      .values({ key: sentKey, value: sentAt.toISOString(), updatedAt: now })
      .onConflictDoUpdate({
        target: proactiveState.key,
        set: { value: sentAt.toISOString(), updatedAt: now },
      });
    await tx
      .insert(proactiveState)
      .values({ key: countKey, value: count, updatedAt: now })
      .onConflictDoUpdate({
        target: proactiveState.key,
        set: { value: count, updatedAt: now },
      });
  });
}

/** Clean up all escalation keys for a decision (on reviewed or stale). */
export async function clearEscalationKeys(decisionId: string): Promise<void> {
  await deleteKey(escalationSentKey(decisionId));
  await deleteKey(escalationCountKey(decisionId));
}
