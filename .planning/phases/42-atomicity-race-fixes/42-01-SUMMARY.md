---
phase: 42-atomicity-race-fixes
plan: 01
subsystem: rituals
tags: [atomicity, race, idempotency, transaction]
dependency_graph:
  requires: []
  provides: ["src/__tests__/helpers/concurrent-harness.ts", "tryFireRitualAtomic postgres-clock", "ritualResponseWindowSweep transactional"]
  affects: ["src/rituals/idempotency.ts", "src/rituals/scheduler.ts", "src/rituals/__tests__/idempotency.test.ts", "src/rituals/__tests__/scheduler.test.ts"]
tech_stack:
  added: []
  patterns: ["postgres now() for race semantics", "db.transaction per-row paired-insert", "concurrent-harness with vi.useFakeTimers toFake:['Date']"]
key_files:
  created: ["src/__tests__/helpers/concurrent-harness.ts"]
  modified:
    - src/rituals/idempotency.ts
    - src/rituals/scheduler.ts
    - src/rituals/__tests__/idempotency.test.ts
    - src/rituals/__tests__/scheduler.test.ts
decisions: ["D-42-01", "D-42-02", "D-42-03", "D-42-04", "D-42-05", "D-42-15", "D-42-16"]
metrics:
  duration_min: 35
  completed: "2026-05-15"
requirements: [RACE-01, RACE-02]
---

# Phase 42 Plan 01: Wave 1 — Shared Harness + RACE-01 + RACE-02 Summary

Wave 1 shipped the shared concurrent-invocation test harness consumed by Plans 02 + 03, closed the M009 ms-resolution JS-clock collision back-door on `tryFireRitualAtomic` via postgres-clock (RACE-01), and wrapped `ritualResponseWindowSweep`'s paired-insert + skip_count increment in a per-row `db.transaction` (RACE-02).

## Task Outcomes

### Task 1 — Shared concurrent-invocation harness
- **Commit:** `4eee98f` feat(42-01): shared concurrent-invocation test harness (D-42-01)
- **File created:** `src/__tests__/helpers/concurrent-harness.ts`
- **API:** `runConcurrently<T>(n, fn)` + `freezeClock(at)`
- **Critical fix during execution:** `freezeClock` uses `vi.useFakeTimers({ toFake: ['Date'] })` instead of the default `useFakeTimers()`. The default fakes setTimeout/setInterval which breaks postgres.js's connection-pool bookkeeping (idle-timeout reaper, retry backoff) — every subsequent DB call hangs forever. Only the Date constructor needs faking for RACE-01 semantics.

### Task 2 — RACE-01: tryFireRitualAtomic postgres-clock
- **Commit:** `7a45bcd` fix(42-01): RACE-01 — tryFireRitualAtomic uses postgres-clock (D-42-02)
- **idempotency.ts diff narrative:**
  - SET clause: `lastRunAt: new Date()` → `lastRunAt: sql\`now()\``
  - Predicate: `lte(rituals.lastRunAt, lastObserved)` → `lt(rituals.lastRunAt, sql\`now()\`)`
  - Imports: added `lt` and `sql` to drizzle-orm import
  - Docstring contract items 2 + 4 + 5 rewritten — explains why postgres `now()` is monotonic per-tx (closing the ms-collision window), why strict `<` is now safe, and that `lastObserved` is no longer load-bearing for race semantics (D-42-15)
- **Test diff:** Test 2 extended with `freezeClock` + `runConcurrently(2, ...)` proving the postgres-clock fix closes the JS-clock collision back-door (D-42-03). Test 4 flipped to assert stale-lastObserved STILL succeeds (semantic shift documented in 42-CONTEXT.md).

### Task 3 — RACE-02: ritualResponseWindowSweep transactional
- **Commit:** `e34075b` fix(42-01): RACE-02 — wrap ritualResponseWindowSweep in db.transaction (D-42-04)
- **scheduler.ts diff narrative:**
  - Per-row body (atomic-consume UPDATE + 2 fire_event INSERTs + skipCount UPDATE) wrapped in `db.transaction(async (tx) => {...})`
  - All inner ops use `tx` not `db` — paired commit-or-rollback
  - Outer `try/catch` per row STAYS OUTSIDE the tx (D-42-05) — single bad row logs WARN `rituals.window_sweep.row_failed` and continues to next row
  - Replaced the misleading "Two sequential inserts, NOT a transaction — both idempotent under retry because each has a unique uuid PK" comment (there is no retry loop in the sweep)
- **Test:** New describe block `ritualResponseWindowSweep — RACE-02 transactional paired-insert (D-42-04)`. Uses a postgres trigger to RAISE EXCEPTION on FIRED_NO_RESPONSE INSERT — forces a mid-tx throw inside drizzle's transaction. Asserts: emitted=0, zero fire_events, consumedAt rolled back to NULL, skip_count unchanged, WARN log fired with row_failed event. Sanity happy-path test confirms the post-RACE-02 standard path still commits.
- File-level `afterAll(sql.end)` moved out of the inner describe so the sibling RACE-02 describe block can share the pool.

## Verification

```
$ bash scripts/test.sh src/rituals/__tests__/idempotency.test.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ bash scripts/test.sh src/rituals/__tests__/scheduler.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

## Deviations from Plan

- **Plan Task 2 acceptance criterion stale:** Plan called for `bash scripts/test.sh src/rituals/__tests__/idempotency.test.ts` to pass with the OLD Test 4 (stale-lastObserved → fired=false). Under RACE-01 that test must invert because the predicate no longer depends on `lastObserved`. Updated Test 4 to assert the new contract (stale lastObserved still succeeds — semantic shift documented at D-42-02 in 42-CONTEXT.md was already explicit about this). Tracked as **Rule 1 — Bug** auto-fix (plan acceptance criterion was internally inconsistent with the spec).

- **freezeClock helper API tightening:** Plan's API shape said `vi.useFakeTimers()` (default — fakes everything). Production-test reality: that breaks postgres.js. Adopted `{ toFake: ['Date'] }`. Documented inline in the helper. **Rule 1 — Bug** auto-fix.

## Self-Check: PASSED

- src/__tests__/helpers/concurrent-harness.ts exists ✓
- All 4 commits (`4eee98f`, `7a45bcd`, `e34075b`) present in `git log` ✓
- `sql\`now()\`` appears in `src/rituals/idempotency.ts` (3 matches; SET + predicate + docstring) ✓
- `db.transaction(async (tx)` appears in `src/rituals/scheduler.ts` (1 match) ✓
- 5 idempotency tests + 12 scheduler tests green under Docker harness ✓
