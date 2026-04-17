import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { proactiveState } from '../db/schema.js';
import { logger } from '../utils/logger.js';

// ── Key constants ──────────────────────────────────────────────────────────

const LAST_SENT_KEY = 'last_sent';
const LAST_SENT_REFLECTIVE_KEY = 'last_sent_reflective';
const LAST_SENT_ACCOUNTABILITY_KEY = 'last_sent_accountability';
const MUTE_UNTIL_KEY = 'mute_until';

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

// ── Per-decision escalation tracking (RES-06) ────────────────────────────

const escalationSentKey = (decisionId: string) => `accountability_sent_${decisionId}`;
const escalationCountKey = (decisionId: string) => `accountability_prompt_count_${decisionId}`;

/** Get when the last accountability prompt was sent for a specific decision. */
export async function getEscalationSentAt(decisionId: string): Promise<Date | null> {
  const val = await getValue(escalationSentKey(decisionId));
  return val ? new Date(val as string) : null;
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
