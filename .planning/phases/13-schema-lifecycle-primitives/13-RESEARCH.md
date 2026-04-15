# Phase 13: Schema & Lifecycle Primitives — Research

**Researched:** 2026-04-15
**Domain:** Drizzle + Postgres 16 event-sourced projection for decision lifecycle; optimistic-concurrency transition chokepoint
**Confidence:** HIGH (grounded in direct reads of schema.ts / migrate.ts / existing integration tests / existing ADD VALUE migration pattern)

## Summary

Phase 13 is a pure schema + service-module phase with **zero new runtime dependencies**. Every primitive is already installed: Drizzle 0.45.2 `pgEnum`, `postgres` 3.4.5 driver, Vitest 4.1.2, Docker Postgres 16 harness via `scripts/test.sh`. The entire phase is reuse of patterns already established in `src/db/schema.ts` (line 20–178) and `src/chris/__tests__/contradiction-integration.test.ts` (the reference integration-test shape).

The three load-bearing code artefacts are (1) new tables/enums in `src/db/schema.ts` following the exact `pgTable` / `pgEnum` / `withTimezone:true` / `gen_random_uuid()` conventions already in place, (2) a handwritten `ALTER TYPE ... ADD VALUE` migration to add `DECISION` to the existing `epistemic_tag` enum (Drizzle-kit does not reliably emit these — evidenced by the existing `0001_add_photos_psychology_mode.sql` precedent), and (3) a `transitionDecision()` chokepoint in `src/decisions/lifecycle.ts` that uses `db.transaction()` with an `INSERT INTO decision_events` followed by `UPDATE decisions ... WHERE id=$id AND status=$expected RETURNING *`; zero rows returned throws `OptimisticConcurrencyError`, illegal transitions throw `InvalidTransitionError` before the transaction opens.

**Primary recommendation:** Split the work into five atomic commits: (1) schema additions + `npm run db:generate` snapshot, (2) handwritten `0003_add_decision_epistemic_tag.sql` ALTER TYPE migration, (3) `src/decisions/errors.ts` + `lifecycle.ts` with transitionDecision + transition map, (4) `src/decisions/regenerate.ts` + `capture-state.ts` helpers, (5) integration test suite against Docker Postgres covering illegal-transition enumeration, happy-path replay roundtrip, side-path replay roundtrip, and optimistic-concurrency race.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Event log shape**
- **D-01:** `decision_events` stores a full snapshot of decision state per event (no diffs, no hybrid). Regeneration = replay events in order; latest event's snapshot = current projection. Rationale: Greg-scale (~100 events/year) makes storage cost irrelevant; removes diff-merge logic from the critical path.
- **D-02:** An event row is written for every status transition AND every field change on `decisions` (literal reading of LIFE-02). Any mutation of the projection row goes through an append first. Projection is never touched without a corresponding event.
- **D-03:** Event columns (at minimum): `id`, `decision_id`, `event_type` (enum: `created` / `status_changed` / `field_updated` / `classified`), `from_status`, `to_status`, `snapshot` (jsonb — full `decisions` row state at this point), `actor` (`capture`/`transition`/`sweep`/`user`/`system`), `created_at`. Final column list: planner's call.

**Legal transition map**
- **D-04:** Complete legal transition map:
  ```
  open-draft → open        (when missing required fields get filled)
  open-draft → withdrawn   (Greg withdraws before completing capture)
  open-draft → abandoned   (capture state GC'd after 24h without completion)
  open       → due         (sweep: resolve_by passed, oldest-due row)
  open       → withdrawn   (Greg withdraws before deadline)
  due        → resolved    (Greg replies to resolution prompt)
  due        → stale       (RES-06: 2 non-replies to resolution prompt)
  due        → withdrawn   (Greg withdraws after deadline surfaced but before resolving)
  resolved   → reviewed    (Greg answers post-mortem follow-up)
  ```
  All other transitions throw `InvalidTransitionError`. Terminal states (`reviewed`/`withdrawn`/`stale`/`abandoned`) have no outgoing edges.
- **D-05:** `stale` reached only via RES-06 auto-escalation (`due → stale`). No implicit `open → stale`.
- **D-06:** `withdrawn` only reachable from `open-draft`, `open`, or `due`.
- **D-07:** `abandoned` and `withdrawn` are distinct terminal values with different semantics.

**Decisions column set**
- **D-08:** Single `reasoning` text column (not dual). `reasoning_stated` / `reasoning_suspected` deferred.
- **D-09:** `domain_tag` nullable text column added in Phase 13 (filled by Phase 14 Haiku inference).
- **D-10:** `resolve_by` is `timestamp with time zone NOT NULL`.
- **D-11:** `falsification_criterion` is `text NOT NULL`.
- **D-12:** Add as nullable columns in Phase 13: `resolution` (text), `resolution_notes` (text), `accuracy_class` (text), `accuracy_classified_at` (timestamptz), `accuracy_model_version` (varchar), `withdrawn_at` / `stale_at` / `abandoned_at` (timestamptz), `language_at_capture` (varchar 3).

**Replay & errors**
- **D-13:** Ship `regenerateDecisionFromEvents(id)` + roundtrip unit test in Phase 13.
- **D-14:** Two distinct error types: `InvalidTransitionError` and `OptimisticConcurrencyError`.

**Capture state**
- **D-15:** `decision_capture_state` table included now. Schema: `chat_id bigint PK`, `stage decision_capture_stage NOT NULL`, `draft jsonb NOT NULL`, `decision_id uuid NULL`, `started_at timestamptz DEFAULT now()`, `updated_at timestamptz DEFAULT now()`.
- **D-16:** `decision_capture_stage` enum: `DECISION`, `ALTERNATIVES`, `REASONING`, `PREDICTION`, `FALSIFICATION`, `AWAITING_RESOLUTION`, `AWAITING_POSTMORTEM`, `DONE`.

**Epistemic tag**
- **D-17:** Add `DECISION` to `epistemic_tag` enum in this phase.

### Claude's Discretion
- Exact Drizzle column ordering and indexing strategy.
- Whether CHECK constraints are added now or deferred (prefer defer per-status CHECKs until the phase that writes them).
- Error class file location (`src/decisions/errors.ts` vs inline).
- Migration file naming and whether to split schema additions.

### Deferred Ideas (OUT OF SCOPE)
- `reasoning_stated` + `reasoning_suspected` dual slots.
- Implicit `open → stale` sweep for long-abandoned decisions.
- Retroactive withdrawal of resolved decisions.
- Drift-check utility walking all decisions asserting `regenerate(id) == projection`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIFE-01 | `decisions` + `decision_events` + `decision_capture_state` tables; `decision_status` + `decision_capture_stage` pgEnums | §Standard Stack (pgEnum pattern, schema.ts:20–56 template); §Code Examples: Schema Block |
| LIFE-02 | `decision_events` append-only; `decisions` is regenerable projection | §Architecture Patterns: "Append-first transaction"; §Code Examples: transitionDecision + regenerate |
| LIFE-03 | `transitionDecision(id, toStatus, payload)` chokepoint; `UPDATE … WHERE id=$id AND status=$expected`; `InvalidTransitionError` on illegal moves | §Code Examples: chokepoint; §Common Pitfalls P1, P2 (rowCount detection) |
| LIFE-04 | `decisions.falsification_criterion NOT NULL`; `resolve_by NOT NULL`; illegal-transition + concurrency race tests | §Code Examples: Schema Block (`.notNull()`); §Validation Architecture |
| LIFE-06 | `DECISION` added to `epistemic_tag` enum | §Common Pitfalls P3 (ALTER TYPE ADD VALUE via handwritten migration — precedent 0001_add_photos_psychology_mode.sql) |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.2 (installed) | Schema DSL + typed query builder | [VERIFIED: package.json:23] Already project standard. `pgEnum`, `pgTable`, `jsonb`, `timestamp({withTimezone:true})`, `bigint({mode:'bigint'})` all in active use (schema.ts:20–178). |
| `drizzle-kit` | 0.31.10 (installed) | Migration generation via `npm run db:generate` | [VERIFIED: package.json:44] `drizzle.config.ts` already points schema→`src/db/schema.ts`, out→`src/db/migrations`. |
| `postgres` | 3.4.5 (installed) | postgres.js driver; supports `db.transaction()` + tagged-SQL `sql` template | [VERIFIED: package.json:32] Used by `src/db/connection.ts`. Required for optimistic-concurrency UPDATE …RETURNING. |
| PostgreSQL | 16 (pgvector/pgvector:pg16) | Transactions + enum types + jsonb | [VERIFIED: docker-compose.test.yml:7] |
| `vitest` | 4.1.2 (installed) | Test runner — includes `vi.useFakeTimers()` | [VERIFIED: package.json:49] — not needed for Phase 13 proper but test harness already exists. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `uuid` | 11.0.0 (installed) | Node-side UUID generation (only if event IDs are generated in JS) | [VERIFIED: package.json:33] Prefer DB-side `gen_random_uuid()` via `.default(sql\`gen_random_uuid()\`)` — matches schema.ts:69 convention. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Handwritten `ALTER TYPE … ADD VALUE` migration for `DECISION` | Drizzle-kit auto-emit | [VERIFIED via existing `0001_add_photos_psychology_mode.sql`] Drizzle-kit's behaviour around adding values to an existing `pgEnum` is unreliable and the project has already accepted handwritten migrations for this exact case. Follow that precedent. |
| `xstate` / `robot3` FSM library | Plain `Record<DecisionStatus, DecisionStatus[]>` map | [CITED: STACK.md §Alternatives] 9 legal edges across 8 states is not worth a DSL; plain Record + `assertTransition()` is more auditable. |
| CHECK constraints at DB layer now | Defer per-status CHECKs to writing phase | [From CONTEXT.md Claude's Discretion] Prefer defer — Phase 13 does not write `resolved` rows so `CHECK (status='resolved' → resolution IS NOT NULL)` is write-free noise here. |

**Installation:**
```bash
# Nothing to install. Phase 13 ships on the existing lockfile.
```

**Version verification (2026-04-15):** All versions confirmed against `/home/claude/chris/package.json` committed state. No npm view probe performed for this phase because no new packages are added.

## Architecture Patterns

### Recommended File Layout

```
src/decisions/                       # NEW directory (does not exist today)
├── errors.ts                        # InvalidTransitionError, OptimisticConcurrencyError
├── lifecycle.ts                     # transitionDecision() + LEGAL_TRANSITIONS map
├── regenerate.ts                    # regenerateDecisionFromEvents(id)
├── capture-state.ts                 # getActiveDecisionCapture(chatId) + upsert helpers
└── __tests__/                       # Integration tests against Docker Postgres
    ├── lifecycle.test.ts            # illegal-transition enumeration + happy-path transitions
    ├── regenerate.test.ts           # roundtrip: replay(events) deepEqual projection
    ├── concurrency.test.ts          # optimistic-concurrency race
    └── capture-state.test.ts        # getActive returns null / returns row shape

src/db/schema.ts                     # MODIFIED (add enums + 3 tables + DECISION to epistemic_tag)
src/db/migrations/
├── 0002_<drizzle-generated>.sql     # auto-generated by `npm run db:generate`
└── 0003_add_decision_epistemic_tag.sql    # HANDWRITTEN ALTER TYPE (follow 0001 precedent)
```

**Rationale:** Mirrors `src/proactive/` (sweep.ts + triggers/ + __tests__/) — the closest existing structural analog. `src/chris/engine.ts` currently has no decision-awareness; integration with the engine pre-processor is Phase 14, not 13. Phase 13's surface is exactly the four modules above plus schema additions.

### Pattern 1: Append-First Transaction (the chokepoint shape)

**What:** Every transition writes an event first, then conditionally updates the projection in the same transaction. The `WHERE status=$expected` clause is the only concurrency guard.

**When to use:** Always inside `transitionDecision()`. Nothing else touches `decisions.status`.

**Example** (reference pattern — planner/executor will refine):
```typescript
// Source: synthesized from drizzle-orm docs (postgres-js transaction API)
//         + schema.ts existing patterns + postgres.js driver docs

async function transitionDecision(
  id: string,
  toStatus: DecisionStatus,
  payload: TransitionPayload,
): Promise<Decision> {
  // 1. Validate transition synchronously BEFORE opening a transaction.
  //    We need the current status for the concurrency WHERE clause.
  const current = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1);
  if (!current[0]) throw new InvalidTransitionError(`decision ${id} not found`);

  const fromStatus = current[0].status;
  if (!LEGAL_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new InvalidTransitionError(`${fromStatus} → ${toStatus}`);
  }

  return await db.transaction(async (tx) => {
    // 2. Append event FIRST. Uses the current (pre-update) snapshot + target status.
    const nextSnapshot = { ...current[0], ...payload.fieldUpdates, status: toStatus };
    await tx.insert(decisionEvents).values({
      decisionId: id,
      eventType: 'status_changed',
      fromStatus,
      toStatus,
      snapshot: nextSnapshot,
      actor: payload.actor,
    });

    // 3. Update projection with optimistic concurrency guard.
    //    RETURNING * lets us distinguish 0-row (concurrent loss) from 1-row (win).
    const updated = await tx.update(decisions)
      .set({ ...payload.fieldUpdates, status: toStatus })
      .where(and(eq(decisions.id, id), eq(decisions.status, fromStatus)))
      .returning();

    if (updated.length === 0) {
      throw new OptimisticConcurrencyError(`decision ${id} changed under us (expected ${fromStatus})`);
    }
    return updated[0]!;
  });
}
```

**Why this order matters:** If the UPDATE runs first and succeeds, but the event INSERT fails (unlikely but possible), the projection is mutated without a matching event — violates D-02. Doing INSERT first: if UPDATE fails (0-row), the transaction ROLLBACK discards the event too. Net: projection and event log stay in lockstep.

**Transaction isolation:** postgres.js / Drizzle `db.transaction()` uses Postgres default `READ COMMITTED`. This is **sufficient** — our concurrency guard is at the row level (`AND status=$expected`), not at the snapshot level. `SERIALIZABLE` / advisory locks are not required and would add serialization-failure retry complexity without benefit. [CITED: PostgreSQL 16 docs — default isolation is READ COMMITTED; https://www.postgresql.org/docs/16/transaction-iso.html]

### Pattern 2: Full-Snapshot Replay (regenerate)

**What:** Replay is trivial under D-01 full-snapshot events — the latest event's `snapshot` column IS the projection. No merging required.

**When to use:** `regenerateDecisionFromEvents(id)` body. Roundtrip test asserts `replay(id) deepEqual projection`.

**Example:**
```typescript
export async function regenerateDecisionFromEvents(id: string): Promise<Decision | null> {
  const events = await db.select()
    .from(decisionEvents)
    .where(eq(decisionEvents.decisionId, id))
    .orderBy(asc(decisionEvents.createdAt));  // critical: ordered by time

  if (events.length === 0) return null;
  const latest = events[events.length - 1]!;
  return latest.snapshot as Decision;
}
```

**Ordering gotcha:** `createdAt` ties are possible under clock quantization. Add a monotonic tiebreaker: either a `bigserial` `sequence_no` column on `decision_events`, or `ORDER BY created_at ASC, id ASC` (uuid-v4 ordering is NOT time-sortable — prefer the sequence column). Recommend sequence column. [ASSUMED] The sequence is overkill at Greg-scale (~100 events/year) but cheap insurance against the flake that would otherwise take hours to diagnose.

### Pattern 3: pgEnum with Additive Migration

**What:** `pgEnum` declaration mirrors schema.ts:20–62 exactly; adding a value to an existing enum uses a handwritten `ALTER TYPE ... ADD VALUE IF NOT EXISTS` following the `0001_add_photos_psychology_mode.sql` precedent.

**Example** (new value on existing enum — not drizzle-kit-reliable):
```sql
-- src/db/migrations/0003_add_decision_epistemic_tag.sql (HANDWRITTEN)
ALTER TYPE "public"."epistemic_tag" ADD VALUE IF NOT EXISTS 'DECISION';
```

This file is picked up by `src/db/migrate.ts` on startup (`migrate(db, { migrationsFolder: 'src/db/migrations' })` — migrate.ts:22). Drizzle's migrator runs SQL files lexicographically and tracks applied migrations in `drizzle.__drizzle_migrations`. **Idempotent:** `ADD VALUE IF NOT EXISTS` is safe on every boot [VERIFIED: 0001 precedent is running in production per STATE.md].

### Pattern 4: Test Harness — Docker Postgres + Schema Wipe Between Tests

**What:** Integration tests hit real Postgres via `docker-compose.local.yml`. `scripts/test.sh` is the wrapper: starts container, runs migrations manually via `psql`, runs vitest. Individual tests import `{ db, sql }` from `../../db/connection.js` and wipe rows in `afterEach`.

**Reference:** `src/chris/__tests__/contradiction-integration.test.ts:7–25` — exact template.

```typescript
// Source: src/chris/__tests__/contradiction-integration.test.ts lines 7–25 (exact pattern)
import { db, sql } from '../../db/connection.js';
import { decisions, decisionEvents, decisionCaptureState } from '../../db/schema.js';

describe('decision lifecycle: real DB', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => { await sql.end(); });

  afterEach(async () => {
    // order matters: child tables first
    await db.delete(decisionEvents);
    await db.delete(decisionCaptureState);
    await db.delete(decisions);
  });
  // ... tests
});
```

**Run:** `npm test` (invokes `scripts/test.sh`) — brings up postgres on port 5433, applies migrations via `psql`, runs vitest. User memory mandates: **never skip Docker tests, always start real postgres.**

### Anti-Patterns to Avoid

- **Hand-rolled UUID in JS when DB can do it.** Use `.default(sql\`gen_random_uuid()\`)` to match schema.ts:69. Don't import `uuid` package for IDs that Postgres generates.
- **Transaction-less multi-step writes.** An INSERT-INTO-decision_events followed by a separately-awaited UPDATE is a correctness bug. Must be `db.transaction(async tx => {…})`.
- **Casting `status` to a bare string literal.** Use the generated Drizzle enum type (`typeof decisionStatus.enumValues[number]`) so adding a status later is a compile error, not a runtime fallthrough.
- **Relying on JS `Date.now()` for event ordering.** Fast successive transitions can produce identical `created_at`. Use a `bigserial` sequence_no (or equivalent) as the tiebreaker.
- **Exporting `LEGAL_TRANSITIONS` only.** Also export `isLegalTransition(from, to)` so callers don't re-index the map inline (and so tests enumerate illegal moves against a single source of truth).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Optimistic concurrency | Advisory locks / SELECT FOR UPDATE / SERIALIZABLE retry loop | Plain `UPDATE … WHERE id=$id AND status=$expected RETURNING *` + check `result.length` | Postgres row-level semantics under default READ COMMITTED are exactly what we want; 0-row RETURNING is the concurrency signal. Simpler, testable, no deadlock risk. |
| Enum value addition | Drop-and-recreate the enum | `ALTER TYPE … ADD VALUE IF NOT EXISTS` in a handwritten migration | Precedent: `0001_add_photos_psychology_mode.sql`. Drop-and-recreate would cascade-break every column referencing the type. |
| Event replay merge logic | Diff-merge over sparse events | Full-snapshot events (D-01) — latest event's snapshot IS the projection | User explicitly rejected diffs. Greg-scale (~100 events/year) makes storage irrelevant. |
| Transition map enforcement | XState / robot3 DSL | `Record<DecisionStatus, DecisionStatus[]>` + `assertTransition()` | 9 edges over 8 states; DSL hides simple logic. |
| UUID generation | `uuid` package inside the query layer | `gen_random_uuid()` as Drizzle column default | Matches schema.ts:69, 87, 103, 115 convention; one fewer thing to mock in unit tests. |
| Idempotent startup migrations | Custom "already applied?" check | Drizzle's own `__drizzle_migrations` tracking table + `ADD VALUE IF NOT EXISTS` | D016 auto-migrate discipline already solved this. |

**Key insight:** The hardest part of this phase is resisting invention. Every primitive is already in the codebase or the installed libraries; Phase 13 is composition, not construction.

## Common Pitfalls

### P1: Drizzle enum ALTER is not reliably auto-generated
**What goes wrong:** Running `npm run db:generate` after adding `DECISION` to the `epistemicTagEnum` array in schema.ts either emits nothing, emits a CREATE TYPE (which conflicts), or emits a drop-and-recreate that cascades.
**Why it happens:** Drizzle-kit's introspection for `ALTER TYPE ADD VALUE` is incomplete; the value-addition path requires raw SQL in Postgres and drizzle-kit does not always emit it correctly.
**How to avoid:** Handwrite the migration as `0003_add_decision_epistemic_tag.sql` following the `0001_add_photos_psychology_mode.sql` precedent. Update `schema.ts` so TypeScript sees the new value, but treat the SQL migration as authoritative. Run tests — if the generated migration also tried to touch the enum, delete those statements.
**Warning signs:** After `db:generate`, look for `DROP TYPE "epistemic_tag"` or `CREATE TYPE "epistemic_tag"_new` in the output diff — both are wrong. The correct handwritten statement is one line: `ALTER TYPE "public"."epistemic_tag" ADD VALUE IF NOT EXISTS 'DECISION';`

### P2: postgres.js `.returning()` semantics vs node-postgres `rowCount`
**What goes wrong:** Code written expecting `result.rowCount === 0` fails because postgres.js returns an array (not a Result object) for Drizzle operations.
**Why it happens:** Drizzle over postgres.js: `await db.update(...).returning()` returns `T[]`. `await db.update(...)` without `.returning()` returns `undefined` under postgres.js driver. There is no `rowCount` property on the returned array.
**How to avoid:** Always use `.returning()` for updates where you need to detect 0-row-affected: `const updated = await tx.update(decisions)... .returning(); if (updated.length === 0) throw new OptimisticConcurrencyError(...)`.
**Warning signs:** TypeScript will catch `.rowCount` misuse if strict mode is on. A unit test that mocks `db.update` and returns `undefined` without `.returning()` chain is also a red flag.

### P3: `bigint` chat_id JSON serialization
**What goes wrong:** `decision_capture_state.chat_id` is `bigint({mode: 'bigint'})` — serializes to `BigInt` in JS, which `JSON.stringify` throws on. When the `draft` jsonb column stores an object that references `chat_id`, the serialization fails at write time.
**Why it happens:** Precedent from `conversations.chat_id` (schema.ts:116). Telegram chat IDs can exceed `Number.MAX_SAFE_INTEGER`.
**How to avoid:** Never embed `chat_id` in the `draft` jsonb. `chat_id` is the PK — use it as a query key, never as a nested field. If needed in the snapshot, convert to string: `chatId.toString()`.
**Warning signs:** `TypeError: Do not know how to serialize a BigInt` from `JSON.stringify` during an INSERT.

### P4: jsonb roundtrip — Date vs string in snapshot
**What goes wrong:** The `snapshot` column is jsonb. Postgres stores dates as ISO strings inside jsonb. When you replay events and compare to the projection, the projection's `resolveBy` is a JS `Date` but the replayed snapshot's `resolveBy` is a string. `deepEqual` fails.
**Why it happens:** Drizzle's `jsonb` column type does not run the same Date-hydration logic that `timestamp` columns do. Anything inside jsonb stays as the JSON-serialized form when read back.
**How to avoid:** In the replay function, rehydrate date-valued fields: `return { ...snapshot, resolveBy: new Date(snapshot.resolveBy), capturedAt: new Date(snapshot.capturedAt), /* ... */ }`. Or: write an explicit zod/manual `DecisionSchema.parse(snapshot)` that coerces. Document the list of timestamptz fields in one place.
**Warning signs:** Roundtrip test fails with "Date object vs string 2026-04-15T00:00:00.000Z".

### P5: jsonb key ordering in deep-equal comparisons
**What goes wrong:** Postgres jsonb normalizes key order; whatever order you wrote might not be the order you read. Naive `JSON.stringify(a) === JSON.stringify(b)` fails.
**How to avoid:** Use Vitest's `expect(...).toEqual(...)` (deep, order-independent) not `toBe` / not string-equals. Already the project norm.

### P6: Migration idempotency on every boot (D016)
**What goes wrong:** A migration that isn't idempotent breaks the second startup, which in Chris means the production bot fails to start.
**How to avoid:** `ADD VALUE IF NOT EXISTS` is idempotent by construction. For handwritten migrations, always use `IF NOT EXISTS` / `IF EXISTS`. Drizzle's `__drizzle_migrations` table tracks which migrations have run and won't re-apply them — but don't rely on this alone; write idempotent SQL anyway.
**Warning signs:** The second `npm test` run fails where the first succeeded. `scripts/test.sh` mitigates by using `tmpfs` data (docker-compose.test.yml:20) but production does not.

### P7: Append-event-but-projection-no-op silent bug
**What goes wrong:** The transaction inserts a `status_changed` event, then the UPDATE's WHERE clause doesn't match (row changed), but the event is still in the log because the exception is caught and swallowed.
**How to avoid:** Throw `OptimisticConcurrencyError` **inside** the transaction callback. Drizzle's `db.transaction(async tx => { throw ... })` rolls back automatically. Do NOT wrap the transaction in a try/catch that swallows. Test: after a concurrency race, the loser's `decision_events` should have exactly 0 rows added (not 1 rolled back — must be 0 visible).
**Verification test shape:** After a forced race where attempt B loses, count events for the decision: `SELECT COUNT(*) FROM decision_events WHERE decision_id = $id` should equal the number of successful transitions, not include B's attempt.

### P8: Testing optimistic-concurrency race deterministically
**What goes wrong:** A naive `Promise.all([transitionDecision(id, X), transitionDecision(id, Y)])` is not deterministic — sometimes both succeed (both saw same initial status) or both fail depending on driver scheduling.
**How to avoid:** Use two separate connections with manual BEGIN/COMMIT, or use postgres.js's `sql.begin()` on two distinct clients. The deterministic shape:
```typescript
// Two independent postgres.js clients acting as concurrent "actors".
const client1 = postgres(DATABASE_URL);
const client2 = postgres(DATABASE_URL);
const db1 = drizzle(client1, { schema });
const db2 = drizzle(client2, { schema });

// Both see status='open' when they read.
// client1 commits first. client2's UPDATE ... WHERE status='open' affects 0 rows.
await db1.transaction(async tx1 => {
  // ... insert event, UPDATE, commit
});
// After client1's commit:
await expect(
  db2.transaction(async tx2 => { /* same transition, should lose */ })
).rejects.toThrow(OptimisticConcurrencyError);
```
This is serial, not truly concurrent, but it's the deterministic equivalent — the point is that client2's pre-read status (`open`) no longer matches the committed state (`due`), so its UPDATE WHERE clause fails. That is **exactly** what the optimistic-concurrency guard protects against in real-world sweep-vs-user-reply races. [CITED: postgres.js README — `postgres(url)` creates an isolated connection pool; https://github.com/porsager/postgres]

**Alternative shape:** hold a transaction open (`tx1` started but not committed), read status from a second client (which sees pre-commit value in READ COMMITTED), then commit tx1, then attempt tx2 — asserts the race deterministically. Planner picks whichever reads cleaner.

## Code Examples

### Schema Block (the additive diff to `src/db/schema.ts`)

```typescript
// Source: extends src/db/schema.ts following existing conventions.
// Ref lines: 20–62 (pgEnum style), 66–82 (pgTable+index style), 102–110 (bigint pk)

// ── New enums ──────────────────────────────────────────────────────────────

export const decisionStatusEnum = pgEnum('decision_status', [
  'open-draft', 'open', 'due', 'resolved', 'reviewed',
  'withdrawn', 'stale', 'abandoned',
]);

export const decisionCaptureStageEnum = pgEnum('decision_capture_stage', [
  'DECISION', 'ALTERNATIVES', 'REASONING', 'PREDICTION', 'FALSIFICATION',
  'AWAITING_RESOLUTION', 'AWAITING_POSTMORTEM', 'DONE',
]);

export const decisionEventTypeEnum = pgEnum('decision_event_type', [
  'created', 'status_changed', 'field_updated', 'classified',
]);

// ── New tables ─────────────────────────────────────────────────────────────

export const decisions = pgTable(
  'decisions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    status: decisionStatusEnum('status').notNull().default('open-draft'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    // Core fields
    decisionText: text('decision_text').notNull(),
    alternatives: jsonb('alternatives').$type<Array<{label: string; rejectedBecause?: string}>>(),
    reasoning: text('reasoning'),                                   // D-08 single slot
    prediction: text('prediction'),
    falsificationCriterion: text('falsification_criterion').notNull(),  // D-11
    resolveBy: timestamp('resolve_by', { withTimezone: true }).notNull(),  // D-10
    // Downstream-phase columns (added now to avoid later migration) — D-09, D-12
    domainTag: text('domain_tag'),
    resolution: text('resolution'),
    resolutionNotes: text('resolution_notes'),
    accuracyClass: text('accuracy_class'),
    accuracyClassifiedAt: timestamp('accuracy_classified_at', { withTimezone: true }),
    accuracyModelVersion: varchar('accuracy_model_version', { length: 50 }),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    staleAt: timestamp('stale_at', { withTimezone: true }),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
    languageAtCapture: varchar('language_at_capture', { length: 3 }),  // 'en' / 'fr' / 'ru'
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),       // needed for STAT-04 FILTER window
  },
  (table) => [
    index('decisions_status_resolve_by_idx').on(table.status, table.resolveBy),  // Phase 15 sweep gate
    index('decisions_resolved_at_idx').on(table.resolvedAt),                     // Phase 17 STAT-04
  ],
);

export const decisionEvents = pgTable(
  'decision_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    sequenceNo: bigint('sequence_no', { mode: 'bigint' })
      .notNull()
      .generatedAlwaysAsIdentity(),   // tiebreaker for same-timestamp events
    decisionId: uuid('decision_id').notNull().references(() => decisions.id),
    eventType: decisionEventTypeEnum('event_type').notNull(),
    fromStatus: decisionStatusEnum('from_status'),   // null for 'created'
    toStatus: decisionStatusEnum('to_status'),       // null for 'field_updated' only
    snapshot: jsonb('snapshot').notNull(),           // full decisions-row state at this point
    actor: varchar('actor', { length: 20 }).notNull(), // capture|transition|sweep|user|system
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('decision_events_decision_id_seq_idx').on(table.decisionId, table.sequenceNo),  // replay order
  ],
);

export const decisionCaptureState = pgTable(
  'decision_capture_state',
  {
    chatId: bigint('chat_id', { mode: 'bigint' }).primaryKey(),  // precedent: conversations.chat_id (schema.ts:116)
    stage: decisionCaptureStageEnum('stage').notNull(),
    draft: jsonb('draft').notNull(),
    decisionId: uuid('decision_id').references(() => decisions.id),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
);
```

**Note on `.generatedAlwaysAsIdentity()`:** Drizzle 0.45.2 supports this. If planner hits a compatibility issue, fall back to `bigserial` via raw `sql\`BIGSERIAL\`` — but the column API is cleaner. [ASSUMED on compatibility; verify during executor's first run of `npm run db:generate`.]

### Errors module

```typescript
// src/decisions/errors.ts
export class InvalidTransitionError extends Error {
  constructor(public readonly from: string, public readonly to: string) {
    super(`Illegal decision transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class OptimisticConcurrencyError extends Error {
  constructor(public readonly decisionId: string, public readonly expectedStatus: string) {
    super(`Decision ${decisionId} was modified concurrently (expected status=${expectedStatus})`);
    this.name = 'OptimisticConcurrencyError';
  }
}
```

Two distinct classes enable Phase 15 sweep retry logic (`catch (err) { if (err instanceof OptimisticConcurrencyError) retry(); else throw; }`) and Phase 18 TEST-11 assertion (`rejects.toBeInstanceOf(OptimisticConcurrencyError)` vs `InvalidTransitionError`).

### Transition map

```typescript
// src/decisions/lifecycle.ts (excerpt)
export const LEGAL_TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  'open-draft': ['open', 'withdrawn', 'abandoned'],
  'open':       ['due', 'withdrawn'],
  'due':        ['resolved', 'stale', 'withdrawn'],
  'resolved':   ['reviewed'],
  'reviewed':   [],    // terminal
  'withdrawn':  [],    // terminal
  'stale':      [],    // terminal
  'abandoned':  [],    // terminal
};
```

9 edges, 4 terminals — enumerable for illegal-transition tests: 8 statuses × 8 targets = 64 pairs, minus 9 legal + 8 self-loops = 47 illegal moves, each should throw `InvalidTransitionError`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `rowCount`-based 0-row detection (node-postgres) | `.returning()` array length check (postgres.js + Drizzle) | Driver choice, pre-Phase-1 | Planner must match the `.returning()` idiom, not `rowCount`. |
| Drop-and-recreate enum for value addition | `ALTER TYPE ... ADD VALUE IF NOT EXISTS` | Postgres 9.1+ | Non-blocking; no cascade. Drizzle-kit doesn't always emit — handwrite. |
| `timestamp without time zone` | `timestamp with time zone` (timestamptz) | Project convention from day 1 | Every new timestamp column uses `{withTimezone: true}`. |

**Deprecated/outdated:**
- Do NOT install `@sinonjs/fake-timers` directly (it's bundled by Vitest). Not needed for Phase 13 but a common mistake downstream.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `.generatedAlwaysAsIdentity()` is supported by Drizzle 0.45.2 for the `sequence_no` column | §Code Examples: Schema Block | LOW — planner falls back to raw `sql\`BIGSERIAL\`` or a handwritten migration column. Verify at first `npm run db:generate`. |
| A2 | Appending the event first then running the UPDATE inside one `db.transaction()` under READ COMMITTED is correct concurrency semantics | §Architecture Patterns: Pattern 1 | LOW — standard optimistic-concurrency pattern; extensively used across the industry. The only failure mode (phantom-read style issues) is ruled out by the row-level `WHERE status=$expected` clause, which is unaffected by isolation level. |
| A3 | Drizzle-kit 0.31.10 will NOT reliably emit `ALTER TYPE ADD VALUE` for `epistemic_tag += 'DECISION'` | §Common Pitfalls P1 | LOW — evidenced by existing 0001 handwritten migration precedent. If drizzle-kit DOES emit it correctly, planner can drop the handwritten file; no harm. |
| A4 | `gen_random_uuid()` is available in the current Postgres 16 image without an extension beyond pgcreator defaults | §Code Examples: Schema Block | VERY LOW — `gen_random_uuid()` is built-in to Postgres 13+ (no extension needed); `uuid-ossp` is the old name. Project already uses it (schema.ts:69, 87, etc.). |

**None blocks planning.** Each resolvable by the executor inside the first iteration of `npm run db:generate` + `npm test`.

## Open Questions

1. **Does `decision_events.snapshot` include the `decisions.id`?**
   - What we know: the snapshot is a full row state (D-01).
   - What's unclear: whether the decision's PK is included in the jsonb or implicit via `decision_id` FK.
   - Recommendation: include it in the snapshot (redundant but makes replay self-contained; no cost).

2. **Where does the `decision_events.snapshot` for a `created` event come from?**
   - What we know: the event is written inside the transaction that also INSERTs the row.
   - What's unclear: whether the snapshot is constructed from the pre-INSERT values object or read back via RETURNING.
   - Recommendation: use the values object (avoids a second round-trip). Include `id` generated client-side via `crypto.randomUUID()` so both INSERT and event see the same ID — OR do the INSERT with RETURNING first, then write the event referencing the returned ID. The second is simpler; one extra round-trip per creation is not a cost concern at Greg-scale.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Integration test harness | ✓ [assumed — project docker-compose files present] | — | None; user memory mandates real Docker Postgres |
| `pgvector/pgvector:pg16` image | Postgres test container | ✓ [docker-compose.test.yml:7] | pg16 | None |
| Node 22 ESM | Runtime | ✓ [package.json:3 `"type": "module"`] | 22 | — |
| `drizzle-orm@0.45.2` | ORM | ✓ [package.json:23] | 0.45.2 | — |
| `postgres@3.4.5` | Driver | ✓ [package.json:32] | 3.4.5 | — |
| `drizzle-kit@0.31.10` | Migration generator | ✓ [package.json:44] | 0.31.10 | Handwrite SQL if generator misbehaves |
| `vitest@4.1.2` | Test runner | ✓ [package.json:49] | 4.1.2 | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (root: `src`, pattern: `**/__tests__/**/*.test.ts`) |
| Quick run command | `npx vitest run src/decisions/__tests__/` |
| Full suite command | `npm test` (invokes `scripts/test.sh` — brings up Docker Postgres, applies migrations, runs vitest) |
| Integration DB | `pgvector/pgvector:pg16` on port 5433 via `docker-compose.local.yml` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIFE-01 | 3 new tables + 2 new pgEnums exist after migration | integration (Docker PG) | `npx vitest run src/decisions/__tests__/schema.test.ts` | ❌ Wave 0 |
| LIFE-01 | `decision_status` enum has all 8 values including `open-draft`/`withdrawn`/`stale`/`abandoned` | integration | same file — query `pg_enum` | ❌ Wave 0 |
| LIFE-02 | `transitionDecision()` writes exactly one `decision_events` row per status change | integration | `npx vitest run src/decisions/__tests__/lifecycle.test.ts` | ❌ Wave 0 |
| LIFE-02 | `regenerateDecisionFromEvents(id)` deep-equals live projection after representative transition sequence | integration | `npx vitest run src/decisions/__tests__/regenerate.test.ts` | ❌ Wave 0 |
| LIFE-02 | Happy-path replay: open-draft → open → due → resolved → reviewed roundtrips | integration | same file | ❌ Wave 0 |
| LIFE-02 | Side-path replay: open → withdrawn roundtrips | integration | same file | ❌ Wave 0 |
| LIFE-03 | `transitionDecision()` is the ONLY callable that sets `status` — enforced by code review + lint rule (recommend grep test) | static / unit | `npx vitest run src/decisions/__tests__/chokepoint-audit.test.ts` (greps src/ for `decisions.status` SET outside lifecycle.ts) | ❌ Wave 0 |
| LIFE-03 | All 47 illegal transitions throw `InvalidTransitionError` | unit + integration | `npx vitest run src/decisions/__tests__/lifecycle.test.ts -t "illegal"` | ❌ Wave 0 |
| LIFE-03 | Optimistic-concurrency race: two concurrent transitions → exactly one wins; loser throws `OptimisticConcurrencyError`; loser's event is NOT in `decision_events` | integration (two-client) | `npx vitest run src/decisions/__tests__/concurrency.test.ts` | ❌ Wave 0 |
| LIFE-04 | `falsification_criterion NOT NULL` enforced by DB | integration | INSERT without it → Postgres error; assert thrown | ❌ Wave 0 |
| LIFE-04 | `resolve_by NOT NULL` enforced by DB | integration | same shape | ❌ Wave 0 |
| LIFE-06 | `DECISION` value present in `epistemic_tag` enum after migration | integration | `npx vitest run src/decisions/__tests__/schema.test.ts -t "epistemic_tag"` | ❌ Wave 0 |
| LIFE-06 | Existing `contradictions` / `pensieve_entries` still work (regression) | integration | full existing test suite via `npm test` | ✅ (existing tests) |

### Sampling Rate

- **Per task commit:** `npx vitest run src/decisions/__tests__/<touched-test>.test.ts` — fast feedback, one file, < 15s against warm Docker PG.
- **Per wave merge:** `npm test` — full suite against Docker PG (brings up container, runs migrations, all tests). Non-negotiable per user memory.
- **Phase gate:** `npm test` green end-to-end; zero skipped tests; auto-migration runs cleanly on cold start.

### Wave 0 Gaps

- [ ] `src/decisions/__tests__/schema.test.ts` — covers LIFE-01, LIFE-06 (schema shape asserted against `information_schema` / `pg_enum`)
- [ ] `src/decisions/__tests__/lifecycle.test.ts` — covers LIFE-02, LIFE-03 (happy path + 47 illegal transitions)
- [ ] `src/decisions/__tests__/regenerate.test.ts` — covers LIFE-02 (replay roundtrip: happy + withdrawn side-path)
- [ ] `src/decisions/__tests__/concurrency.test.ts` — covers LIFE-03 (two-client race)
- [ ] `src/decisions/__tests__/capture-state.test.ts` — covers helpers around `decision_capture_state`
- [ ] `src/decisions/__tests__/chokepoint-audit.test.ts` — grep-based audit that `decisions.status` is not mutated outside `lifecycle.ts`
- [ ] Framework install: none — Vitest 4.1.2 already present. Docker Postgres harness already proven by `src/chris/__tests__/contradiction-integration.test.ts`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 13 has no auth surface; inherits existing Telegram-user-ID gating (unchanged) |
| V3 Session Management | no | — |
| V4 Access Control | no | Single-user self-hosted bot; chokepoint is function-level not auth-level |
| V5 Input Validation | partial | jsonb `draft` and `alternatives` columns should be schema-validated (zod) at write time — pitfall m2 in PITFALLS.md. Planner may defer zod to Phase 14 where the actual writes happen. |
| V6 Cryptography | no | No secrets handled; `gen_random_uuid()` is CSPRNG-backed at DB level |
| V13 API | no | No network-facing API introduced |

### Known Threat Patterns for {Drizzle + Postgres.js + Node 22 ESM}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via raw template strings | Tampering | Drizzle query builder + `sql\`...\`` tagged template; never string-concatenate user input. All Phase 13 queries use builder; no raw composition planned. |
| Jsonb schema sprawl (m2 in PITFALLS.md) | Tampering | Zod schema for `alternatives` at write time (Phase 14 ownership) |
| Silent projection drift (C4 in PITFALLS.md) | Tampering | Append-first transaction + optimistic concurrency + replay roundtrip test |
| Event tampering (modifying past events) | Repudiation | `decision_events` is write-only by policy; no UPDATE/DELETE code path. Planner should NOT add a `.update()` or `.delete()` helper for `decisionEvents` — make it a lint rule or code-review checkpoint. |

## Sources

### Primary (HIGH confidence)
- `/home/claude/chris/src/db/schema.ts` — canonical pgEnum/pgTable conventions (lines 20–178)
- `/home/claude/chris/src/db/migrate.ts` — auto-migrate entrypoint
- `/home/claude/chris/src/db/migrations/0001_add_photos_psychology_mode.sql` — handwritten ALTER TYPE ADD VALUE precedent
- `/home/claude/chris/src/db/connection.ts` — db/sql export pattern
- `/home/claude/chris/src/chris/__tests__/contradiction-integration.test.ts` — integration-test harness template
- `/home/claude/chris/docker-compose.test.yml`, `docker-compose.local.yml`, `scripts/test.sh` — test harness
- `/home/claude/chris/package.json` — lockfile versions
- `.planning/research/STACK.md` — M007 stack decisions (zero new deps)
- `.planning/research/PITFALLS.md` — C4, M1, m2 mitigations
- `.planning/research/ARCHITECTURE.md` — §2b, §2d, §4, §5 Phase 1, §6 AP-3
- `.planning/phases/13-schema-lifecycle-primitives/13-CONTEXT.md` — locked decisions D-01..D-17

### Secondary (MEDIUM confidence)
- PostgreSQL 16 docs — default READ COMMITTED isolation; ALTER TYPE ADD VALUE semantics
- postgres.js README — transaction API and connection isolation

### Tertiary (LOW confidence)
- [ASSUMED] Drizzle 0.45.2 `.generatedAlwaysAsIdentity()` works out-of-box on pg16 — verify during first `db:generate`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package already installed and proven in production
- Architecture: HIGH — append-first + optimistic concurrency is textbook; file layout mirrors existing `src/proactive/`
- Pitfalls: HIGH-MEDIUM — P1 (enum ADD VALUE) is evidenced by project precedent; P4/P5 (jsonb roundtrip) is ecosystem-standard; P8 (deterministic race test) has two valid shapes, planner picks
- Test harness: HIGH — exact template exists in `src/chris/__tests__/contradiction-integration.test.ts`

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable stack; Drizzle minor versions could shift enum-gen behaviour)
