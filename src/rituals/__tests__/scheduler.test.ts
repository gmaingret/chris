/**
 * src/rituals/__tests__/scheduler.test.ts — Phase 25 Plan 03 Task 1 (RIT-09)
 *
 * Real-DB tests for runRitualSweep. Mirrors src/rituals/__tests__/idempotency.
 * test.ts shape (Wave 2 Plan 25-02 Task 3) — same Docker postgres on port 5433
 * via bash scripts/test.sh. Each test owns a FIXTURE_PREFIX-scoped set of
 * ritual rows; cleanup is name-prefix-scoped.
 *
 * Coverage (10 tests):
 *   1. Empty DB → returns [] without throwing (RIT-09 success criterion 3)
 *   2. Per-tick max-1: 3 due rituals → exactly 1 processed per tick (Pitfall 1)
 *   3. Skeleton dispatch outcome: fired=true with outcome=fired (handler
 *      throws via default branch for unknown ritual.name, but atomic UPDATE
 *      succeeded so the substrate marks it fired) — also exercises Phase 29
 *      D-29-08 "default branch still throws for unimplemented handlers"
 *   4. Catch-up ceiling: ritual >1 cadence period stale → outcome=caught_up
 *   5. mute_until in future → outcome=muted (no fire)
 *   6. Disabled rituals are not selected
 *   7. 3/day channel ceiling: 4 due rituals → ticks 1-3 fire, tick 4 returns []
 *   8. Counter reset at next local-day boundary (yesterday-keyed counter is
 *      stale; today's hasReachedRitualDailyCap is false)
 *   9. Phase 29 D-29-08: dispatchRitualHandler routes weekly_review to
 *      fireWeeklyReview (verifies switch case + import wiring via vi.mock)
 *  10. Phase 29 D-29-08: default branch throws for unmapped ritual.name
 *      (verifies the safety belt for future M013 monthly/quarterly rituals
 *      seeded before their handler lands)
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualFireEvents,
  proactiveState,
} from '../../db/schema.js';
import { hasReachedRitualDailyCap } from '../../proactive/state.js';
import { logger } from '../../utils/logger.js';

// Phase 29 D-29-08: mock fireWeeklyReview at module level so the dispatch
// case in scheduler.ts is exercised without invoking the real Sonnet pipeline.
// Hoisted by Vitest so the mock is in place before scheduler.js loads.
vi.mock('../weekly-review.js', () => ({
  fireWeeklyReview: vi.fn().mockResolvedValue('fired'),
}));

import { runRitualSweep, ritualResponseWindowSweep } from '../scheduler.js';
import { fireWeeklyReview } from '../weekly-review.js';

// File-level cleanup: close the postgres pool after BOTH describe blocks
// (runRitualSweep + ritualResponseWindowSweep) have run. Closing inside
// either describe's afterAll would race the sibling describe's tests.
afterAll(async () => {
  await sql.end();
});

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
    // Phase 29 D-29-08: restore the weekly_review seed's nextRunAt to a
    // far-future value so subsequent test files don't see a forever-due
    // weekly_review row. The Phase 29 routing test below mutates this row's
    // nextRunAt to make it due now; without restoration the row would remain
    // perpetually due. 1 year out is well beyond any reasonable test window.
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    await db
      .update(rituals)
      .set({ nextRunAt: farFuture })
      .where(eq(rituals.name, 'weekly_review'));
    // NOTE: sql.end() lives in the FILE-LEVEL afterAll below — closing the
    // pool here would break sibling describe blocks (RACE-02 transactional
    // tests) that share this file.
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

  // ── Phase 29 D-29-08 — dispatchRitualHandler weekly_review wiring ──────
  //
  // The dispatcher is name-keyed (D-26-08); the switch case shipped in this
  // plan routes ritual.name === 'weekly_review' to fireWeeklyReview.
  // fireWeeklyReview is module-level mocked above; these tests exercise the
  // routing path without invoking the real Sonnet pipeline.
  //
  // The migration 0009 weekly_review seed row already exists in the test DB
  // (applied by scripts/test.sh before vitest fires). To exercise the dispatch
  // for this test, we update the existing seed's nextRunAt to the past and
  // assert the mock fires. afterAll restores nextRunAt to a far-future value
  // so subsequent test files don't pick up a forever-due weekly_review.
  it('Phase 29 D-29-08: dispatchRitualHandler routes weekly_review to fireWeeklyReview', async () => {
    const mock = fireWeeklyReview as unknown as ReturnType<typeof vi.fn>;
    mock.mockClear();

    // Cross-file self-heal: journal-suppression.test.ts runs an unscoped
    // `db.delete(rituals)` that wipes the migration-seeded weekly_review row.
    // Idempotent re-insert (ON CONFLICT DO NOTHING by unique name) puts it
    // back if absent — mirrors the pattern in skip-tracking.test.ts's
    // beforeAll. Without this the D-29-08 SELECT finds no due ritual and
    // runRitualSweep returns [] instead of dispatching weekly_review.
    await db
      .insert(rituals)
      .values({
        name: 'weekly_review',
        type: 'weekly',
        nextRunAt: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        enabled: true,
        config: {
          fire_at: '20:00',
          prompt_bag: [],
          skip_threshold: 2,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .onConflictDoNothing({ target: rituals.name });

    // Cross-file isolation: other test files (e.g. weekly-review.test.ts,
    // wellbeing.test.ts) may have left ritual rows with past nextRunAt that
    // would win the runRitualSweep ASC ordering and starve the weekly_review
    // dispatch we want to verify here. Snapshot all OTHER rituals' state and
    // push their nextRunAt out of the due window for this test, then restore
    // them in finally so other tests still see their original state.
    const otherRituals = await db
      .select()
      .from(rituals)
      .where(eq(rituals.enabled, true));
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const snapshots = otherRituals
      .filter((r) => r.name !== 'weekly_review')
      .map((r) => ({ id: r.id, nextRunAt: r.nextRunAt }));
    for (const snap of snapshots) {
      await db
        .update(rituals)
        .set({ nextRunAt: farFuture })
        .where(eq(rituals.id, snap.id));
    }

    try {
      // Make the existing weekly_review seed due now. The seed was inserted by
      // migration 0009 with name='weekly_review', type='weekly', enabled=true.
      const dueNow = new Date(Date.now() - 100);
      await db
        .update(rituals)
        .set({ nextRunAt: dueNow })
        .where(eq(rituals.name, 'weekly_review'));

      // Reset the channel counter just before sweep so other test files that
      // may have left counter state don't trip the cap-reached short-circuit.
      await db.delete(proactiveState).where(eq(proactiveState.key, COUNTER_KEY));

      const results = await runRitualSweep(new Date());

      expect(results.length).toBe(1);
      expect(results[0]!.outcome).toBe('fired');
      expect(results[0]!.fired).toBe(true);
      // The dispatcher MUST have called fireWeeklyReview exactly once with the
      // weekly_review ritual row + parsed config.
      expect(mock).toHaveBeenCalledTimes(1);
      const callArgs = mock.mock.calls[0]!;
      expect(callArgs[0].name).toBe('weekly_review');
      expect(callArgs[0].type).toBe('weekly');
      // cfg (second arg) is the parsed RitualConfig; verify shape
      expect(callArgs[1].fire_at).toBe('20:00');
    } finally {
      // Restore every other ritual's nextRunAt so subsequent tests/files
      // observe their original state.
      for (const snap of snapshots) {
        await db
          .update(rituals)
          .set({ nextRunAt: snap.nextRunAt })
          .where(eq(rituals.id, snap.id));
      }
    }
  });

  it('Phase 29 D-29-08: default branch throws for unmapped ritual.name (safety belt)', async () => {
    // Insert a ritual whose name is NOT in the dispatcher switch (no
    // 'monthly_retro' handler exists yet — Phase 25/26/27/29 only wire
    // weekly_review + daily_journal + daily_wellbeing). The atomic
    // UPDATE in runRitualSweep advances nextRunAt regardless, so 'fired'
    // is the correct outcome from the substrate's perspective; the handler
    // error is captured in results[0].error.
    const dueNow = new Date(Date.now() - 100);
    await db.insert(rituals).values({
      name: `${FIXTURE_PREFIX}unmapped`,
      type: 'monthly',
      nextRunAt: dueNow,
      enabled: true,
      config: validConfigJson,
    });

    const results = await runRitualSweep(new Date());
    expect(results.length).toBe(1);
    // atomic UPDATE succeeded → fired=true, outcome='fired' (Phase 25
    // semantic: the slot was claimed). The handler error is captured for
    // visibility but does not reverse the substrate state.
    expect(results[0]!.fired).toBe(true);
    expect(results[0]!.outcome).toBe('fired');
    expect(results[0]!.error).toBeDefined();
    const errMsg = results[0]!.error instanceof Error
      ? results[0]!.error.message
      : String(results[0]!.error);
    expect(errMsg).toContain('handler not implemented');
    expect(errMsg).toContain(`${FIXTURE_PREFIX}unmapped`);
  });

});

// ── Phase 42 RACE-02 — ritualResponseWindowSweep transactional rollback ─────

describe('ritualResponseWindowSweep — RACE-02 transactional paired-insert (D-42-04)', () => {
  // Trigger that throws when a FIRED_NO_RESPONSE INSERT happens against
  // ritual_fire_events. Used to force a mid-tx throw inside the per-row
  // transaction of ritualResponseWindowSweep so we can verify the rollback
  // contract: consumedAt stays NULL, neither audit row is written, and
  // skip_count is unchanged.
  // Use the raw postgres-js `sql` tagged template directly (not via
  // db.execute(...) which goes through drizzle's SQL builder and chokes on
  // dollar-quoted PL/pgSQL bodies). `sql.unsafe` accepts arbitrary SQL text
  // including $$ blocks.
  async function installFiredNoResponseBlocker(): Promise<void> {
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION race_02_block_fnr_fn()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.outcome = 'fired_no_response' THEN
          RAISE EXCEPTION 'RACE-02 test forced throw on fired_no_response INSERT';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await sql.unsafe(
      `DROP TRIGGER IF EXISTS race_02_block_fnr ON ritual_fire_events;`,
    );
    await sql.unsafe(`
      CREATE TRIGGER race_02_block_fnr
      BEFORE INSERT ON ritual_fire_events
      FOR EACH ROW EXECUTE FUNCTION race_02_block_fnr_fn();
    `);
  }

  async function removeFiredNoResponseBlocker(): Promise<void> {
    await sql.unsafe(
      `DROP TRIGGER IF EXISTS race_02_block_fnr ON ritual_fire_events;`,
    );
    await sql.unsafe(`DROP FUNCTION IF EXISTS race_02_block_fnr_fn() CASCADE;`);
  }

  beforeEach(async () => {
    // FK order: ritual_pending_responses + ritual_fire_events reference
    // rituals — must delete children FIRST before cleanFixtures wipes
    // rituals rows.
    const allRituals = await db.select().from(rituals);
    const ids = allRituals
      .filter((r) => r.name.startsWith(FIXTURE_PREFIX))
      .map((r) => r.id);
    if (ids.length > 0) {
      await db
        .delete(ritualFireEvents)
        .where(inArray(ritualFireEvents.ritualId, ids));
      await db
        .delete(ritualPendingResponses)
        .where(inArray(ritualPendingResponses.ritualId, ids));
    }
    await cleanFixtures();
  });

  afterAll(async () => {
    await removeFiredNoResponseBlocker();
  });

  it('RACE-02: mid-row INSERT throw rolls back consumedAt + skip_count + emits ZERO ritual_fire_events (D-42-04)', async () => {
    // Seed a fixture ritual + pending response with expires_at in the past
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: `${FIXTURE_PREFIX}race02`,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: validConfigJson,
        skipCount: 7, // arbitrary non-zero starting value to detect mutation
      })
      .returning();
    expect(ritual).toBeDefined();
    const ritualId = ritual!.id;
    const skipCountBefore = ritual!.skipCount;

    const expired = new Date(Date.now() - 60_000);
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId,
        chatId: 99999n,
        firedAt: expired,
        expiresAt: expired,
        consumedAt: null,
        promptText: 'RACE-02 fixture',
      })
      .returning();
    expect(pending).toBeDefined();
    const pendingId = pending!.id;

    // Install the trigger that forces the second INSERT (fired_no_response)
    // to throw mid-transaction
    await installFiredNoResponseBlocker();

    // Spy on logger.warn to verify the per-row error-isolation log fires
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      // The sweep should NOT throw — outer try/catch isolates per-row failures
      const emitted = await ritualResponseWindowSweep(new Date());

      // (d) sweep returns 0 emitted (no successful transaction committed)
      expect(emitted).toBe(0);

      // (a) zero ritual_fire_events for this ritual (rollback)
      const events = await db
        .select()
        .from(ritualFireEvents)
        .where(eq(ritualFireEvents.ritualId, ritualId));
      expect(events).toHaveLength(0);

      // (b) consumedAt rolled back to NULL
      const [pendingAfter] = await db
        .select()
        .from(ritualPendingResponses)
        .where(eq(ritualPendingResponses.id, pendingId));
      expect(pendingAfter!.consumedAt).toBeNull();

      // (c) rituals.skip_count unchanged
      const [ritualAfter] = await db
        .select()
        .from(rituals)
        .where(eq(rituals.id, ritualId));
      expect(ritualAfter!.skipCount).toBe(skipCountBefore);

      // (e) per-row warn log emitted with row_failed event
      const rowFailedCalls = warnSpy.mock.calls.filter(
        (c) => c[1] === 'rituals.window_sweep.row_failed',
      );
      expect(rowFailedCalls.length).toBeGreaterThanOrEqual(1);
    } finally {
      warnSpy.mockRestore();
      await removeFiredNoResponseBlocker();
    }
  });

  it('RACE-02 happy path: without the trigger, paired-insert commits + skip_count increments', async () => {
    // Sanity test — confirm the standard path still works after the
    // transactional wrap. Insert a pending row, sweep, expect:
    //   - 2 fire_events (window_missed + fired_no_response)
    //   - consumedAt set
    //   - skip_count +1
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: `${FIXTURE_PREFIX}race02ok`,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: validConfigJson,
        skipCount: 2,
      })
      .returning();
    const ritualId = ritual!.id;

    const expired = new Date(Date.now() - 60_000);
    await db.insert(ritualPendingResponses).values({
      ritualId,
      chatId: 99999n,
      firedAt: expired,
      expiresAt: expired,
      consumedAt: null,
      promptText: 'RACE-02 happy fixture',
    });

    const emitted = await ritualResponseWindowSweep(new Date());
    expect(emitted).toBe(1);

    const events = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, ritualId));
    expect(events.map((e) => e.outcome).sort()).toEqual(
      ['fired_no_response', 'window_missed'].sort(),
    );

    const [ritualAfter] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.id, ritualId));
    expect(ritualAfter!.skipCount).toBe(3);
  });
});
