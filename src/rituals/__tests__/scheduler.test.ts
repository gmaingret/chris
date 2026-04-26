/**
 * src/rituals/__tests__/scheduler.test.ts — Phase 25 Plan 03 Task 1 (RIT-09)
 *
 * Real-DB tests for runRitualSweep. Mirrors src/rituals/__tests__/idempotency.
 * test.ts shape (Wave 2 Plan 25-02 Task 3) — same Docker postgres on port 5433
 * via bash scripts/test.sh. Each test owns a FIXTURE_PREFIX-scoped set of
 * ritual rows; cleanup is name-prefix-scoped.
 *
 * Coverage (8 tests):
 *   1. Empty DB → returns [] without throwing (RIT-09 success criterion 3)
 *   2. Per-tick max-1: 3 due rituals → exactly 1 processed per tick (Pitfall 1)
 *   3. Skeleton dispatch outcome: fired=true with outcome=fired (handler
 *      throws, but atomic UPDATE succeeded so the substrate marks it fired)
 *   4. Catch-up ceiling: ritual >1 cadence period stale → outcome=caught_up
 *   5. mute_until in future → outcome=muted (no fire)
 *   6. Disabled rituals are not selected
 *   7. 3/day channel ceiling: 4 due rituals → ticks 1-3 fire, tick 4 returns []
 *   8. Counter reset at next local-day boundary (yesterday-keyed counter is
 *      stale; today's hasReachedRitualDailyCap is false)
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import { rituals, proactiveState } from '../../db/schema.js';
import { hasReachedRitualDailyCap } from '../../proactive/state.js';
import { runRitualSweep } from '../scheduler.js';

const FIXTURE_PREFIX = 'sched-test-';
const COUNTER_KEY = 'ritual_daily_count';

const validConfigJson = {
  fire_at: '21:00',
  skip_threshold: 3,
  mute_until: null,
  time_zone: 'Europe/Paris',
  prompt_set_version: 'v1',
  schema_version: 1,
};

async function cleanFixtures(): Promise<void> {
  // Delete any rows whose name starts with the fixture prefix
  const allRituals = await db.select().from(rituals);
  const ids = allRituals.filter((r) => r.name.startsWith(FIXTURE_PREFIX)).map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(rituals).where(inArray(rituals.id, ids));
  }
  // Also reset the channel counter so tests start from a clean slate
  await db.delete(proactiveState).where(eq(proactiveState.key, COUNTER_KEY));
}

describe('runRitualSweep', () => {
  beforeEach(async () => {
    await cleanFixtures();
  });

  afterAll(async () => {
    await cleanFixtures();
    await sql.end();
  });

  it('returns empty array against clean DB without throwing (RIT-09 success criterion 3)', async () => {
    const results = await runRitualSweep(new Date());
    expect(results).toEqual([]);
  });

  it('per-tick max-1 cap: with 3 due rituals, exactly 1 is processed per tick (Pitfall 1)', async () => {
    const dueAgo = new Date(Date.now() - 1000);
    await db.insert(rituals).values([
      {
        name: `${FIXTURE_PREFIX}a`,
        type: 'daily',
        nextRunAt: dueAgo,
        enabled: true,
        config: validConfigJson,
      },
      {
        name: `${FIXTURE_PREFIX}b`,
        type: 'daily',
        nextRunAt: dueAgo,
        enabled: true,
        config: validConfigJson,
      },
      {
        name: `${FIXTURE_PREFIX}c`,
        type: 'daily',
        nextRunAt: dueAgo,
        enabled: true,
        config: validConfigJson,
      },
    ]);

    const results = await runRitualSweep(new Date());
    expect(results.length).toBe(1); // ← per-tick max-1 cap
  });

  it('skeleton dispatch outcome: fired=true with outcome=fired (handler throws but atomic succeeds)', async () => {
    // Fresh-fire path: ritual is due NOW (not catch-up territory)
    const dueNow = new Date(Date.now() - 100);
    await db.insert(rituals).values({
      name: `${FIXTURE_PREFIX}fresh`,
      type: 'daily',
      nextRunAt: dueNow,
      enabled: true,
      config: validConfigJson,
    });

    const results = await runRitualSweep(new Date());
    expect(results.length).toBe(1);
    expect(results[0]!.fired).toBe(true);
    expect(results[0]!.outcome).toBe('fired');
    // Phase 25's skeleton handler throws — but atomic UPDATE already advanced
    // next_run_at, so 'fired' is correct (the side-effect is the DB state, not
    // the handler completion). Phases 26-29 supply the real handler.
    expect(results[0]!.error).toBeDefined();
  });

  it('catch-up ceiling: ritual >1 cadence period in the past advances without firing (outcome=caught_up)', async () => {
    const dailyTwoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await db.insert(rituals).values({
      name: `${FIXTURE_PREFIX}stale`,
      type: 'daily',
      nextRunAt: dailyTwoDaysAgo,
      enabled: true,
      config: validConfigJson,
    });

    const results = await runRitualSweep(new Date());
    expect(results.length).toBe(1);
    expect(results[0]!.outcome).toBe('caught_up');
    expect(results[0]!.fired).toBe(false);
  });

  it('respects per-ritual mute_until (config.mute_until in future returns outcome=muted)', async () => {
    const dueNow = new Date(Date.now() - 100);
    const muteFuture = new Date(Date.now() + 60_000).toISOString();
    await db.insert(rituals).values({
      name: `${FIXTURE_PREFIX}muted`,
      type: 'daily',
      nextRunAt: dueNow,
      enabled: true,
      config: { ...validConfigJson, mute_until: muteFuture },
    });

    const results = await runRitualSweep(new Date());
    expect(results.length).toBe(1);
    expect(results[0]!.outcome).toBe('muted');
    expect(results[0]!.fired).toBe(false);
  });

  it('skips disabled rituals', async () => {
    const dueNow = new Date(Date.now() - 100);
    await db.insert(rituals).values({
      name: `${FIXTURE_PREFIX}disabled`,
      type: 'daily',
      nextRunAt: dueNow,
      enabled: false,
      config: validConfigJson,
    });

    const results = await runRitualSweep(new Date());
    expect(results).toEqual([]); // disabled rituals not in `WHERE enabled = true`
  });

  it('3/day channel ceiling: 3rd enabled ritual fires, 4th does NOT (D-04 refinement, RIT-09 + Pitfall 1)', async () => {
    // Counter reset is part of cleanFixtures() so each test starts clean.
    const dueNow = new Date(Date.now() - 100);
    // Seed 4 enabled rituals all due now. Each runRitualSweep tick processes 1
    // (per-tick max-1 cap). The 4th tick must short-circuit with [] because
    // hasReachedRitualDailyCap returns true.
    await db.insert(rituals).values([
      {
        name: `${FIXTURE_PREFIX}cap1`,
        type: 'daily',
        nextRunAt: dueNow,
        enabled: true,
        config: validConfigJson,
      },
      {
        name: `${FIXTURE_PREFIX}cap2`,
        type: 'daily',
        nextRunAt: dueNow,
        enabled: true,
        config: validConfigJson,
      },
      {
        name: `${FIXTURE_PREFIX}cap3`,
        type: 'daily',
        nextRunAt: dueNow,
        enabled: true,
        config: validConfigJson,
      },
      {
        name: `${FIXTURE_PREFIX}cap4`,
        type: 'daily',
        nextRunAt: dueNow,
        enabled: true,
        config: validConfigJson,
      },
    ]);

    const r1 = await runRitualSweep(new Date());
    const r2 = await runRitualSweep(new Date());
    const r3 = await runRitualSweep(new Date());
    const r4 = await runRitualSweep(new Date());

    // First 3 ticks each fire one ritual (per-tick max-1 + atomic UPDATE
    // advances next_run_at, but other 3 are still due — the loop processes
    // them across 3 sequential sweeps). Each fire increments the counter.
    expect(r1.length).toBe(1);
    expect(r1[0]!.fired).toBe(true);
    expect(r2.length).toBe(1);
    expect(r2[0]!.fired).toBe(true);
    expect(r3.length).toBe(1);
    expect(r3[0]!.fired).toBe(true);

    // 4th tick: hasReachedRitualDailyCap returns true → short-circuit return []
    expect(r4).toEqual([]);
  });

  it('counter resets at next local-day boundary (D-04 refinement)', async () => {
    // Direct probe: write a counter value keyed to YESTERDAY's local date,
    // then call hasReachedRitualDailyCap and assert it returns false (because
    // today's key has no value yet).
    const yesterdayLocal = new Date();
    yesterdayLocal.setDate(yesterdayLocal.getDate() - 1);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const yesterdayKey = formatter.format(yesterdayLocal);

    // Force the counter into a "yesterday=3" state
    await db.delete(proactiveState).where(eq(proactiveState.key, COUNTER_KEY));
    await db.insert(proactiveState).values({
      key: COUNTER_KEY,
      value: { date: yesterdayKey, count: 3 },
      updatedAt: new Date(),
    });

    // Today's check should return false (yesterday's count is stale; today's
    // implicit count is 0).
    const reached = await hasReachedRitualDailyCap('Europe/Paris');
    expect(reached).toBe(false);
  });
});
