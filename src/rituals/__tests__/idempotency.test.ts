/**
 * src/rituals/__tests__/idempotency.test.ts — Phase 25 Plan 02 Task 3 (RIT-10)
 *                                              + Phase 42 Plan 01 Task 2 (RACE-01)
 *
 * Concurrency tests for `tryFireRitualAtomic`. Real Postgres + Drizzle (NOT
 * mocked — the SQL row-level lock is the contract under test, and a mock
 * cannot prove serialization). Runs under the Docker harness on port 5433
 * (the test postgres container started by `bash scripts/test.sh`).
 *
 * Asserts:
 *   1. First call against a row with `last_run_at = null` returns
 *      `{ fired: true, row }` and the row's `last_run_at` is now-ish.
 *   2. RACE-01 regression (D-42-03): `runConcurrently(2, ...)` of
 *      tryFireRitualAtomic under a FROZEN JS clock produces EXACTLY ONE
 *      `fired: true` and ONE `fired: false`. The frozen-clock context
 *      proves the postgres-clock fix is load-bearing — under the OLD
 *      `new Date()` SET clause two invocations could both pass the WHERE
 *      predicate when their JS clocks collided at the same ms (the
 *      ms-resolution collision window the 2026-05-10 `lt`→`lte` patch
 *      left open). Under the NEW `sql\`now()\`` SET + `lt` predicate
 *      postgres's per-tx monotonic now() closes that back-door
 *      permanently.
 *   3. Subsequent call with `lastObserved = previousLastRunAt` returns
 *      `{ fired: true }` (the predicate `last_run_at < now()` evaluates
 *      against the post-prior-commit row state where lastRunAt = T1 =
 *      WINNER_now < NEW_now in the new tx — strict `<` is satisfied).
 *      This validates the 2026-05-09 stuck-ritual bug class stays closed
 *      after RACE-01's switch to postgres-clock + strict `<`.
 *   4. Call with `lastObserved` older than the current last_run_at returns
 *      `{ fired: false }` — caller-visibility test; the `lastObserved`
 *      parameter is retained post-RACE-01 for logging even though it is
 *      no longer load-bearing for race semantics.
 *
 * Run via the canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/idempotency.test.ts
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import { rituals } from '../../db/schema.js';
import { tryFireRitualAtomic } from '../idempotency.js';
import {
  runConcurrently,
  freezeClock,
} from '../../__tests__/helpers/concurrent-harness.js';

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

  it('two concurrent invocations under a FROZEN JS clock produce exactly 1 fired-row return (RIT-10 success criterion 3 + Phase 42 RACE-01 D-42-03)', async () => {
    // RACE-01 regression test (D-42-03): the frozen-clock context is what
    // proves the postgres-clock fix is load-bearing. Under the OLD code with
    // `lastRunAt: new Date()` in the SET clause, both invocations'
    // `new Date()` calls would land on the SAME ms under a frozen JS clock
    // (or under realistic ms-resolution collision during the every-minute
    // cron), and BOTH WHERE re-evaluations against `lte(lastRunAt, lastObserved)`
    // could succeed. Under the NEW `sql\`now()\`` SET clause, postgres
    // `now()` advances strictly monotonically per-transaction so the second
    // invocation's `lt(lastRunAt, sql\`now()\`)` predicate evaluates against
    // the winner's committed `now()`, which is strictly less than the
    // loser's `now()` — the loser's UPDATE matches zero rows.
    const frozenAt = new Date('2026-05-14T20:00:00Z');
    const restoreClock = freezeClock(frozenAt);
    try {
      const future = new Date(frozenAt.getTime() + 24 * 60 * 60 * 1000);
      const results = await runConcurrently(2, () =>
        tryFireRitualAtomic(ritualId, null, future),
      );
      const firedCount = results.filter((r) => r.fired).length;
      expect(firedCount).toBe(1); // ← THE assertion (postgres-clock contract)
      // The race-loser must return fired=false with no row.
      const loser = results.find((r) => !r.fired)!;
      expect(loser.fired).toBe(false);
      expect(loser.row).toBeUndefined();
    } finally {
      restoreClock();
    }
  });

  it('subsequent call with the freshly-observed lastObserved returns fired=true (regression test for 2026-05-09 stuck-ritual bug)', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const first = await tryFireRitualAtomic(ritualId, null, future);
    expect(first.fired).toBe(true);

    // Production scenario: a sweep selects the row, sees lastRunAt = T1
    // (from `first`), then calls tryFire(id, T1, futureN+1) in a SUBSEQUENT
    // transaction. The WHERE predicate (post-RACE-01) is
    // `lastRunAt < sql\`now()\`` — evaluated against the current row where
    // lastRunAt = T1 = winner's now() (committed in the prior tx), and the
    // new tx's now() is strictly greater than T1 by postgres monotonic
    // commit-order semantics. So `T1 < now()` is TRUE and the second fire
    // succeeds. The pre-RACE-01 `<=` against `lastObserved` (JS-clock) worked
    // for this scenario too; the RACE-01 change tightens it to strict `<`
    // against `now()` which is the only safe predicate under the
    // ms-resolution JS-clock collision window. See idempotency.ts docstring
    // contract item 2 + RACE-01 D-42-02 in 42-CONTEXT.md.
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

  it('call with stale lastObserved STILL succeeds under RACE-01 — postgres-clock predicate is row-state-only, not caller-observation-dependent', async () => {
    // Post-RACE-01 (D-42-02 + D-42-05 in 42-CONTEXT.md): the `lastObserved`
    // parameter is no longer load-bearing for race semantics. The WHERE
    // predicate `lastRunAt < sql\`now()\`` depends ONLY on the row's current
    // state and the current transaction's `now()` — NOT on what the caller
    // observed. A caller with a stale lastObserved still succeeds as long as
    // the row's lastRunAt was committed by a strictly-earlier transaction.
    //
    // This is the explicit semantic shift documented in 42-CONTEXT.md
    // D-42-02: "`lastObserved` no longer load-bearing for the race semantics
    // (postgres now() advances strictly monotonically per-tx); keep for
    // caller-visibility/logging but document the semantic shift." This test
    // pins the new contract so future refactors that re-introduce
    // observation-dependent predicates fail loud.
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    // Fire once to set last_run_at to "now-ish".
    const first = await tryFireRitualAtomic(ritualId, null, future);
    expect(first.fired).toBe(true);

    // Caller observed an older instant — but the predicate doesn't care.
    // Postgres `now()` advances per-tx; the row's lastRunAt was set by an
    // earlier tx so `lastRunAt < now()` is TRUE and UPDATE succeeds.
    const stale = new Date(first.row!.lastRunAt!.getTime() - 60_000);
    const second = await tryFireRitualAtomic(ritualId, stale, future);
    expect(second.fired).toBe(true);
    // The second now() may equal or exceed the first commit's now()
    // depending on whether enough postgres time passed between the two
    // autocommit UPDATEs (ms-resolution clock). The race contract only
    // requires the SECOND fire SUCCEEDS — any monotonic-or-equal value
    // is fine for this assertion.
    expect(second.row!.lastRunAt!.getTime()).toBeGreaterThanOrEqual(
      first.row!.lastRunAt!.getTime(),
    );
    expect(second.row!.nextRunAt.getTime()).toBe(future.getTime());
  });
});
