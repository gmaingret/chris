/**
 * src/proactive/__tests__/state-ritual-cap.test.ts — Phase 25 Plan 03 Task 7
 *
 * Real-DB tests for hasReachedRitualDailyCap + incrementRitualDailyCount
 * (D-04 refinement: 3/day channel ceiling, counter resets at local midnight).
 *
 * NOTE on file location: the plan originally listed
 * src/proactive/__tests__/state.test.ts as the modification target, but that
 * file uses a fully mocked DB connection (vi.mock at module top hoists for the
 * whole file). The new helpers' contract is "value persists across reads via
 * proactive_state KV table", which is fundamentally a real-DB assertion. To
 * preserve the existing mocked tests AND prove the persistence contract, the
 * new tests live in this peer file. Mirrors how src/rituals/__tests__/
 * idempotency.test.ts uses real DB (Wave 2 Plan 25-02 Task 3) — same harness,
 * same Docker postgres on port 5433 via bash scripts/test.sh.
 *
 * Coverage (6 tests per plan acceptance criteria):
 *   1. Fresh DB (no key) → false
 *   2. After 2 increments → false (counter at 2/3)
 *   3. After 3 increments → true (counter at 3/3 — D-04 ceiling)
 *   4. Counter persists across reads (DB-backed, not in-memory)
 *   5. Stale yesterday-keyed counter → false (resets at local midnight)
 *   6. First increment after stale yesterday-counter resets to today=1
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import { proactiveState } from '../../db/schema.js';
import { hasReachedRitualDailyCap, incrementRitualDailyCount } from '../state.js';

const COUNTER_KEY = 'ritual_daily_count';

function localDateKey(timezone: string, date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

describe('hasReachedRitualDailyCap + incrementRitualDailyCount (D-04 refinement)', () => {
  beforeEach(async () => {
    await db.delete(proactiveState).where(eq(proactiveState.key, COUNTER_KEY));
  });

  afterAll(async () => {
    await db.delete(proactiveState).where(eq(proactiveState.key, COUNTER_KEY));
    await sql.end();
  });

  it('returns false on fresh DB (no key written)', async () => {
    expect(await hasReachedRitualDailyCap('Europe/Paris')).toBe(false);
  });

  it('returns false after 2 increments (counter at 2/3)', async () => {
    await incrementRitualDailyCount('Europe/Paris');
    await incrementRitualDailyCount('Europe/Paris');
    expect(await hasReachedRitualDailyCap('Europe/Paris')).toBe(false);
  });

  it('returns true after 3 increments (counter at 3/3 — D-04 ceiling)', async () => {
    await incrementRitualDailyCount('Europe/Paris');
    await incrementRitualDailyCount('Europe/Paris');
    await incrementRitualDailyCount('Europe/Paris');
    expect(await hasReachedRitualDailyCap('Europe/Paris')).toBe(true);
  });

  it('counter value persists across reads (DB-backed, not in-memory)', async () => {
    await incrementRitualDailyCount('Europe/Paris');
    const rows = await db
      .select()
      .from(proactiveState)
      .where(eq(proactiveState.key, COUNTER_KEY));
    expect(rows.length).toBe(1);
    const value = rows[0]!.value as { date: string; count: number };
    expect(value.count).toBe(1);
    expect(value.date).toBe(localDateKey('Europe/Paris'));
  });

  it('stale yesterday-keyed counter does NOT block today (resets at local midnight)', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = localDateKey('Europe/Paris', yesterday);

    await db.insert(proactiveState).values({
      key: COUNTER_KEY,
      value: { date: yesterdayKey, count: 5 },
      updatedAt: new Date(),
    });

    expect(await hasReachedRitualDailyCap('Europe/Paris')).toBe(false);
  });

  it('first increment after stale yesterday-counter resets to today=1', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = localDateKey('Europe/Paris', yesterday);

    await db.insert(proactiveState).values({
      key: COUNTER_KEY,
      value: { date: yesterdayKey, count: 5 },
      updatedAt: new Date(),
    });

    await incrementRitualDailyCount('Europe/Paris');

    const rows = await db
      .select()
      .from(proactiveState)
      .where(eq(proactiveState.key, COUNTER_KEY));
    const value = rows[0]!.value as { date: string; count: number };
    expect(value.date).toBe(localDateKey('Europe/Paris'));
    expect(value.count).toBe(1); // not 6 — yesterday's count discarded
  });
});
