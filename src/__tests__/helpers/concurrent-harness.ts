/**
 * src/__tests__/helpers/concurrent-harness.ts — Phase 42 Plan 01 Task 1 (D-42-01)
 *
 * Shared concurrent-invocation test helper. Extracts the canonical Promise.all +
 * vi.useFakeTimers pattern first proven by Phase 25 RIT-10 in
 * src/rituals/__tests__/idempotency.test.ts so that the four Phase 42 race-fix
 * tests can reuse it without copy-paste drift:
 *
 *   - src/rituals/__tests__/idempotency.test.ts  (RACE-01 — Plan 42-01)
 *   - src/rituals/__tests__/scheduler.test.ts    (RACE-02 — Plan 42-01)
 *   - src/rituals/__tests__/wellbeing.test.ts    (RACE-03 — Plan 42-02)
 *   - src/rituals/__tests__/weekly-review.test.ts (RACE-06 — Plan 42-03)
 *
 * The two helpers below are intentionally minimal:
 *
 *   1. `runConcurrently(n, fn)` — fans out `n` parallel invocations of `fn`
 *      via Promise.all. Each invocation receives its 0-based index so callers
 *      can vary per-racer inputs when desired.
 *
 *   2. `freezeClock(at)` — pins `Date.now()` to a single millisecond across all
 *      racers using vitest's fake timers. The frozen clock is the exact failure
 *      surface RACE-01 closes: under the OLD `new Date()` SET clause two
 *      concurrent `tryFireRitualAtomic` invocations could both pass the WHERE
 *      predicate when their JS clocks collided at the same ms. Under the NEW
 *      `sql\`now()\`` SET clause, postgres `now()` advances strictly
 *      monotonically per-transaction so the frozen-clock test PROVES the fix.
 *      Returns a `restoreClock` callback the caller invokes (typically in an
 *      `afterEach`) to revert to real timers.
 *
 * No internal repo imports — helper is self-contained (vitest is a dev dep
 * available wherever this module is loaded).
 */
import { vi } from 'vitest';

export async function runConcurrently<T>(
  n: number,
  fn: (idx: number) => Promise<T>,
): Promise<T[]> {
  return Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

export function freezeClock(at: Date | number): () => void {
  vi.useFakeTimers();
  vi.setSystemTime(at);
  return () => {
    vi.useRealTimers();
  };
}
