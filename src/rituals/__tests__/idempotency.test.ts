/**
 * src/rituals/__tests__/idempotency.test.ts — Phase 25 Plan 02 Task 3 (RIT-10)
 *
 * Concurrency tests for `tryFireRitualAtomic`. Real Postgres + Drizzle (NOT
 * mocked — the SQL row-level lock is the contract under test, and a mock
 * cannot prove serialization). Runs under the Docker harness on port 5433
 * (the test postgres container started by `bash scripts/test.sh`).
 *
 * Asserts:
 *   1. First call against a row with `last_run_at = null` returns
 *      `{ fired: true, row }` and the row's `last_run_at` is now-ish.
 *   2. THE assertion (RIT-10 success criterion 3): `Promise.all` of two
 *      parallel `tryFireRitualAtomic` calls against the SAME row produces
 *      EXACTLY ONE `fired: true` and ONE `fired: false`. Mock-based
 *      concurrency tests are insufficient for the SQL-level race — Postgres
 *      row-level locking is the actual lock, and only a real DB can prove it.
 *   3. Subsequent call with `lastObserved = previousLastRunAt` returns
 *      `{ fired: false }` (the predicate `last_run_at < lastObserved` fails
 *      when they're equal — race lost).
 *   4. Call with `lastObserved` older than the current last_run_at returns
 *      `{ fired: false }` (race lost — peer already advanced past our
 *      observation).
 *
 * Run via the canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/idempotency.test.ts
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import { rituals } from '../../db/schema.js';
import { tryFireRitualAtomic } from '../idempotency.js';

const FIXTURE_NAME = 'idempotency-test-ritual';

const validConfigJson = {
  fire_at: '21:00',
  skip_threshold: 3,
  mute_until: null,
  time_zone: 'Europe/Paris',
  prompt_set_version: 'v1',
  schema_version: 1,
};

describe('tryFireRitualAtomic — idempotency under concurrency (RIT-10)', () => {
  let ritualId: string;

  beforeEach(async () => {
    // Per-test fixture: one ritual row owned by this test, identified by a
    // dedicated FIXTURE_NAME so cleanup is scoped to this suite and does
    // not race other tests' rows. Mirrors the FIXTURE_SOURCE convention
    // documented in TESTING.md.
    await db.delete(rituals).where(eq(rituals.name, FIXTURE_NAME));
    const inserted = await db
      .insert(rituals)
      .values({
        name: FIXTURE_NAME,
        type: 'daily',
        // Due now (1 second ago) so the ritual is sweep-eligible. Phase 25
        // sweep eligibility itself is not under test here — we test the
        // atomic UPDATE primitive, which the sweep will call.
        nextRunAt: new Date(Date.now() - 1000),
        enabled: true,
        config: validConfigJson,
      })
      .returning();
    ritualId = inserted[0]!.id;
  });

  afterAll(async () => {
    // Final cleanup + close the postgres.js pool so subsequent serial files
    // do not block on a held connection (TESTING.md afterAll convention).
    await db.delete(rituals).where(eq(rituals.name, FIXTURE_NAME));
    await sql.end();
  });

  it('first call against null last_run_at returns fired=true with the updated row', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const result = await tryFireRitualAtomic(ritualId, null, future);
    expect(result.fired).toBe(true);
    expect(result.row).toBeDefined();
    expect(result.row?.lastRunAt).toBeInstanceOf(Date);
    expect(result.row?.nextRunAt.toISOString()).toBe(future.toISOString());
  });

  it('two concurrent invocations produce exactly 1 fired-row return (RIT-10 success criterion 3)', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const [a, b] = await Promise.all([
      tryFireRitualAtomic(ritualId, null, future),
      tryFireRitualAtomic(ritualId, null, future),
    ]);
    const firedCount = [a.fired, b.fired].filter(Boolean).length;
    expect(firedCount).toBe(1); // ← THE assertion
    // The race-loser must return fired=false with no row.
    const loser = a.fired ? b : a;
    expect(loser.fired).toBe(false);
    expect(loser.row).toBeUndefined();
  });

  it('subsequent call with the freshly-observed lastObserved returns fired=true (regression test for 2026-05-09 stuck-ritual bug)', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const first = await tryFireRitualAtomic(ritualId, null, future);
    expect(first.fired).toBe(true);

    // Production scenario: a sweep selects the row, sees lastRunAt = T1
    // (from `first`), then calls tryFire(id, T1, futureN+1). The WHERE
    // predicate `lastRunAt <= T1` evaluates against the current row where
    // lastRunAt = T1, so `T1 <= T1` is TRUE and the second fire succeeds.
    // Before the 2026-05-09 fix this used strict `<` and returned fired=false,
    // permanently sticking every ritual after its first fire. See
    // src/rituals/idempotency.ts docstring contract item 2.
    const observedLastRunAt = first.row!.lastRunAt!;
    const futureN1 = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const second = await tryFireRitualAtomic(
      ritualId,
      observedLastRunAt,
      futureN1,
    );
    expect(second.fired).toBe(true);
    expect(second.row!.lastRunAt!.getTime()).toBeGreaterThan(
      observedLastRunAt.getTime(),
    );
    expect(second.row!.nextRunAt.getTime()).toBe(futureN1.getTime());
  });

  it('successive fires at production cadence all succeed (10 sequential fires, each observing the previous lastRunAt)', async () => {
    // Production-shaped regression test: simulates 10 successive sweep ticks
    // firing the same ritual, with each tick observing the lastRunAt set by
    // the previous tick. This is exactly the daily-ritual production loop
    // (sweep → fire → wait → sweep → fire → ...). Before the 2026-05-09
    // fix, this loop would succeed exactly ONCE then stick at
    // `fired: false` for all subsequent iterations.
    let observed: Date | null = null;
    for (let i = 0; i < 10; i++) {
      const future = new Date(Date.now() + (24 + i) * 60 * 60 * 1000);
      const result = await tryFireRitualAtomic(ritualId, observed, future);
      expect(result.fired, `iteration ${i + 1} of 10`).toBe(true);
      observed = result.row!.lastRunAt!;
    }
  });

  it('call with lastObserved older than current last_run_at returns fired=false (race lost — peer already advanced)', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Fire once to set last_run_at to "now-ish".
    const first = await tryFireRitualAtomic(ritualId, null, future);
    expect(first.fired).toBe(true);

    // Now caller observed an older instant — peer (the first call) has
    // already advanced last_run_at past it, so the WHERE-guard fails.
    const stale = new Date(first.row!.lastRunAt!.getTime() - 60_000);
    const second = await tryFireRitualAtomic(ritualId, stale, future);
    expect(second.fired).toBe(false);
  });
});
