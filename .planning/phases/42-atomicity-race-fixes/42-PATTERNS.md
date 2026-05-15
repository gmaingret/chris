# Phase 42: Atomicity & Race Fixes — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 7 source + 4 test + 1 new helper = 12 files total
**Analogs found:** 11 / 12 (the harness is the only file with no direct analog — it formalizes a pattern that already exists inline in `idempotency.test.ts`)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/__tests__/helpers/concurrent-harness.ts` (NEW) | test-helper | utility | `src/rituals/__tests__/idempotency.test.ts:85-97` (Promise.all pattern) + `vi.useFakeTimers()` calls scattered across test suite | role-extracted (no existing helper, but the patterns exist inline) |
| `src/rituals/idempotency.ts` (MODIFY) | service | atomic-update | self — `tryFireRitualAtomic` already exists; modification swaps `new Date()` and `lte(…, lastObserved)` for `sql\`now()\`` | exact |
| `src/rituals/scheduler.ts` (MODIFY, lines 374-425) | service | sweep + paired-insert | `src/proactive/state.ts:276-300` (`setEscalationState` — `db.transaction(async (tx) => {...})` precedent) | exact |
| `src/rituals/wellbeing.ts` (MODIFY, lines 227-258, 263-324, 328-346, 422-450) | service | callback-handler + jsonb merge | self — `handleTap` lines 234-239 (`jsonb_set` pattern); `tryFireRitualAtomic` (idempotency claim) | exact |
| `src/rituals/weekly-review.ts` (MODIFY, lines 627-691) | service | send-then-persist | `src/rituals/journal.ts` (PP#5 pre-allocate-then-update); `src/proactive/state.ts:284` (`db.transaction` precedent) | role-match |
| `src/rituals/__tests__/idempotency.test.ts` (EXTEND Test 2) | test | concurrent-update | self — Test 2 lines 85-97 already implements the pattern | exact |
| `src/rituals/__tests__/scheduler.test.ts` (ADD test) | test | concurrent-sweep | `idempotency.test.ts:85-97` (Promise.all pattern) | role-match |
| `src/rituals/__tests__/wellbeing.test.ts` (EXTEND/TIGHTEN Test 5) | test | concurrent-callback | self — Test 5 lines 281-312 already implements the pattern; tighten assertions to count fire_events exactly | exact |
| `src/rituals/__tests__/weekly-review.test.ts` (ADD test) | test | send-failure-rollback | `journal-handler.test.ts` (grammy mock pattern) + `idempotency.test.ts` (DB-state assertions) | role-match |

## Pattern Assignments

### `src/__tests__/helpers/concurrent-harness.ts` (NEW)

**Analog (pattern source):** `src/rituals/__tests__/idempotency.test.ts:85-97`

**Promise.all pattern to extract** (lines 85-97):
```typescript
const [a, b] = await Promise.all([
  tryFireRitualAtomic(ritualId, null, future),
  tryFireRitualAtomic(ritualId, null, future),
]);
const firedCount = [a.fired, b.fired].filter(Boolean).length;
expect(firedCount).toBe(1);
```

**`vi.useFakeTimers()` clock-freeze precedent** (already imported in `idempotency.test.ts:27` via `vitest`):
```typescript
// vi.useFakeTimers() + vi.setSystemTime(at) pin Date.now() across racers;
// vi.useRealTimers() restores. The CONTEXT.md D-42-01 specifies the shape:
export async function runConcurrently<T>(n: number, fn: (idx: number) => Promise<T>): Promise<T[]> {
  return Promise.all(Array.from({length: n}, (_, i) => fn(i)));
}
export function freezeClock(at: Date | number): () => void {
  vi.useFakeTimers();
  vi.setSystemTime(at);
  return () => vi.useRealTimers();
}
```

**Import conventions** (from any test file in the suite — `idempotency.test.ts:27-31`):
```typescript
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { db, sql } from '../../db/connection.js';
// .js suffix on internal imports (CONVENTIONS.md §Module System)
```

**Why no existing helper:** Phase 25 RIT-10 inlined the pattern. Phase 42 D-42-01 extracts it because 4 of 6 RACE fixes will reuse it (RACE-01, 02, 03, 06).

---

### `src/rituals/idempotency.ts` (MODIFY — RACE-01)

**Analog:** Self. The function shape and predicate scaffolding stays; only the timestamp source changes.

**Current SET clause (line 117) — what to change FROM:**
```typescript
.set({ lastRunAt: new Date(), nextRunAt: newNextRunAt })
```

**Current predicate (lines 111-113) — what to change FROM:**
```typescript
const lastRunAtPredicate = lastObserved
  ? or(isNull(rituals.lastRunAt), lte(rituals.lastRunAt, lastObserved))
  : isNull(rituals.lastRunAt);
```

**Target shape per D-42-02 (postgres-clock, strict `<`):**
- SET `lastRunAt: sql\`now()\``
- Predicate: `or(isNull(rituals.lastRunAt), lt(rituals.lastRunAt, sql\`now()\`))` — strict `<` is safe against `sql\`now()\`` because postgres `now()` advances strictly monotonically per-transaction
- Imports: add `lt` from drizzle-orm (already imports `and, eq, isNull, lte, or`); `sql` is already imported via the project's `connection.js`? — **check**: `idempotency.ts:47` currently imports `and, eq, isNull, lte, or` only. The task must add `lt` + `sql` from `drizzle-orm`.

**Comment-block updates required:**
- The Phase 25 docstring (lines 14-46) and inline comments (lines 80-110) describe the JS-clock `new Date()` reasoning and the `lte` (not `<`) load-bearing comment. Both must be rewritten to describe the postgres-clock semantics + why `lt` is now safe.
- Update the comment block at `idempotency.ts:96-110` to codify D-42-15 (postgres `now()` is canonical race-time; `new Date()` reserved for logs/jsonb/Telegram).

---

### `src/rituals/scheduler.ts` (MODIFY — RACE-02, lines 374-425)

**Analog:** `src/proactive/state.ts:276-300` — canonical `db.transaction(async (tx) => {...})` precedent.

**Excerpt to mirror (`state.ts:283-300`):**
```typescript
await db.transaction(async (tx) => {
  await tx
    .insert(proactiveState)
    .values({ key: sentKey, value: sentAt.toISOString(), updatedAt: now })
    .onConflictDoUpdate({ ... });
  await tx
    .insert(proactiveState)
    .values({ key: countKey, value: count, updatedAt: now })
    .onConflictDoUpdate({ ... });
});
```

**Current sweep body to refactor (scheduler.ts:374-425):**
- STEP 2: atomic-consume UPDATE
- STEP 3: two `ritualFireEvents` inserts (WINDOW_MISSED + FIRED_NO_RESPONSE)
- STEP 4: `rituals.skipCount++` UPDATE

**Target per D-42-04 + D-42-05:**
- Wrap STEP 2 + STEP 3 (both INSERTs) + STEP 4 in a single `db.transaction(async (tx) => {...})` per row.
- The outer `for (const row of expired)` loop and its per-row try/catch stay OUTSIDE the transaction — single bad row does not roll back the whole sweep.
- Update the `'PAIRED EMIT'` comment block at scheduler.ts:396-398 to claim transactional atomicity (the current `D-28-03 unique-PK retry idempotency` comment is wrong — there is no retry loop).

---

### `src/rituals/wellbeing.ts` (MODIFY — RACE-03, RACE-04, RACE-05)

**Analogs:**
- **RACE-03 (completion-claim):** `src/rituals/idempotency.ts:111-128` `tryFireRitualAtomic` predicate pattern — atomic UPDATE with `IS NULL` guard returning the claimed row.
- **RACE-04 (jsonb_set):** `wellbeing.ts:234-239` (tap path) — exact verbatim shape.
- **RACE-05 (24h window):** existing WHERE clause at `wellbeing.ts:438-444` — add an additional AND-clause.

**RACE-03 — Excerpt of the new claim pattern per D-42-06 (apply at start of `completeSnapshot` and `handleSkip`):**
```typescript
const [claimed] = await db
  .update(ritualResponses)
  .set({ respondedAt: new Date() })
  .where(and(
    eq(ritualResponses.id, openRow.id),
    isNull(ritualResponses.respondedAt),
  ))
  .returning({ id: ritualResponses.id });
if (!claimed) return; // race lost — peer is completing
```

The current `completeSnapshot:290-296` UPDATE-respondedAt-after-the-fact is replaced by the claim-first pattern. The `metadata` write happens AFTER the claim succeeds (separated UPDATE).

**RACE-04 — Excerpt of the nested jsonb_set per D-42-08:**
```typescript
metadata: sql`jsonb_set(jsonb_set(
  coalesce(${ritualResponses.metadata}, '{}'::jsonb),
  '{skipped}', 'true'::jsonb, true),
  '{adjustment_eligible}', 'false'::jsonb, true)`
```
Replaces the full-object overwrite at `wellbeing.ts:335-339` (`...meta, skipped: true, adjustment_eligible: false`).

**RACE-05 — Excerpt of the 24h belt-and-suspenders per D-42-10:**
Add to the `findOpenWellbeingRow` WHERE clause at `wellbeing.ts:438-444`:
```typescript
AND ${ritualResponses.firedAt} >= now() - interval '24 hours'
```

---

### `src/rituals/weekly-review.ts` (MODIFY — RACE-06, lines 627-691)

**Analog:** `src/rituals/journal.ts` (PP#5 pre-allocate-then-update pattern) + `src/proactive/state.ts:284-299` (`db.transaction` precedent).

**Current order (lines 627-691) — what's broken:**
1. INSERT `ritual_responses` (no `respondedAt`)
2. `storePensieveEntry`
3. UPDATE `ritual_responses` SET `pensieveEntryId`, `respondedAt` ← **bug: sets respondedAt BEFORE the send**
4. `bot.api.sendMessage` ← **bug: if this throws, respondedAt is already set; weekly miss is silently logged as success**
5. INSERT `ritualFireEvents` outcome=FIRED

**Target order per D-42-11 + D-42-12 + D-42-13:**
1. Capture `previousNextRunAt` from `tryFireRitualAtomic` returned row BEFORE the send.
2. INSERT `ritual_responses` (NO `respondedAt`).
3. `storePensieveEntry`.
4. `try { await bot.api.sendMessage(...) }` wrapped.
5. **On send success:** `db.transaction(async (tx) => { tx.update(ritualResponses).set({respondedAt, pensieveEntryId}); tx.insert(ritualFireEvents).values({outcome:'fired', ...}); })`.
6. **On send failure (catch):** INSERT `ritualFireEvents` with `outcome='fired'` + `metadata.telegram_failed: true`; `db.update(rituals).set({nextRunAt: previousNextRunAt})` to revert. Log `'rituals.weekly.send_failed'` at ERROR level. `ritual_responses.respondedAt` stays NULL. Pensieve entry stays (acceptable orphan per D-42-11).

---

## Shared Patterns

### Test Harness (Concurrent Invocations)
**Source:** `src/__tests__/helpers/concurrent-harness.ts` (new, Plan 01)
**Apply to:** All four RACE concurrent tests — RACE-01 (idempotency.test.ts), RACE-02 (scheduler.test.ts new test), RACE-03 (wellbeing.test.ts tightened Test 5), RACE-06 (weekly-review.test.ts new send-failure test).

```typescript
import { runConcurrently, freezeClock } from '../../__tests__/helpers/concurrent-harness.js';

// In each test:
const restoreClock = freezeClock(new Date('2026-05-14T20:00:00Z'));
const results = await runConcurrently(2, () => tryFireRitualAtomic(...));
restoreClock();
```

### Postgres `now()` as canonical race-time (D-42-15)
**Source:** D-42-15 in CONTEXT.md.
**Apply to:** All `last_run_at`-style atomic UPDATE SET clauses and concurrent-comparison predicates from this phase forward. `new Date()` is reserved for: log lines, jsonb metadata payloads, Telegram message timestamps.

**Code shape (drizzle-orm):**
```typescript
import { sql } from 'drizzle-orm';
// SET clause:
.set({ lastRunAt: sql`now()` })
// Predicate:
.where(and(eq(...), lt(rituals.lastRunAt, sql`now()`)))
```

### `db.transaction` for paired writes (D-42-16)
**Source:** `src/proactive/state.ts:284-299` (`setEscalationState`).
**Apply to:** scheduler.ts paired-insert sweep (RACE-02), weekly-review.ts respondedAt+fire_event on send success (RACE-06).

```typescript
await db.transaction(async (tx) => {
  await tx.update(...).set(...).where(...);
  await tx.insert(...).values(...);
});
```

### Project ESM convention
**Source:** `.planning/codebase/CONVENTIONS.md` §Module System.
**Apply to:** All new test helper file + every modified file's imports.

- All internal imports use `.js` suffix (e.g., `'../../db/connection.js'`, `'../idempotency.js'`).
- External imports (`drizzle-orm`, `vitest`, `grammy`) keep bare specifier.
- Explicit `import { ... } from 'vitest'` (globals: false).

### Real Postgres concurrency tests (no mocks)
**Source:** `src/rituals/__tests__/idempotency.test.ts:5-26` (test-suite header docstring).
**Apply to:** All four RACE concurrent tests.

- Tests run under `bash scripts/test.sh` (Docker postgres on port 5433).
- Mock-based concurrency tests are insufficient — Postgres row-level locking is the actual lock; only a real DB can prove the contract.
- Per-test fixtures use a dedicated `FIXTURE_NAME` for scoped cleanup (`idempotency.test.ts:33`).
- `afterAll(async () => { await sql.end() })` is mandatory — closes the postgres.js pool so serial files don't block.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/__tests__/helpers/concurrent-harness.ts` | test-helper | utility | No existing helper module under `src/__tests__/helpers/`. The directory itself may not exist yet — Plan 01 Task 1 must create it. The patterns being extracted exist inline in `idempotency.test.ts:85-97` (Promise.all) and across the test suite (`vi.useFakeTimers()`), so this is "role-extracted" rather than "no analog at all". |

## Metadata

**Analog search scope:** `src/rituals/`, `src/proactive/`, `src/__tests__/`, `src/rituals/__tests__/`
**Files scanned:** ~25 (rituals subsystem + proactive + tests + fixtures)
**Pattern extraction date:** 2026-05-14

## PATTERN MAPPING COMPLETE

**Phase:** 42 - atomicity-race-fixes
**Files classified:** 9 (5 prod + 4 test) + 1 new helper = 10 distinct files touched
**Analogs found:** 9 / 10 (harness is role-extracted)

### Coverage
- Files with exact analog: 7
- Files with role-match analog: 2
- Files with no analog: 1 (concurrent-harness — but extracted from inline patterns)

### Key Patterns Identified
- All concurrent regression tests use `Promise.all` against REAL Docker Postgres (port 5433) — mocks are insufficient
- `db.transaction(async (tx) => {...})` is the canonical paired-write pattern (precedent: `proactive/state.ts:setEscalationState`)
- `sql\`now()\`` (postgres-clock) is the canonical race-time, replacing `new Date()` (JS-clock) at race-sensitive SET clauses; strict `lt(…, sql\`now()\`)` is safe because postgres `now()` advances strictly monotonically per-tx
- `jsonb_set` (nested or single) with `coalesce(${col}, '{}'::jsonb)` is the canonical metadata-merge pattern — never write the full object back

### File Created
`.planning/phases/42-atomicity-race-fixes/42-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns in PLAN.md files.
