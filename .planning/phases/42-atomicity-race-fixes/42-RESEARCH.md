# Phase 42: Atomicity & Race Fixes — Research

**Researched:** 2026-05-14
**Status:** Complete
**Scope:** 6 application-layer atomicity fixes (RACE-01..06) — no schema migration, no new libraries.

This research is intentionally compact: CONTEXT.md already encodes 16 locked decisions with snippets, and the three source REVIEW.md files (25-, 27-, 29-) contain the diagnoses. The role of RESEARCH.md here is to (a) certify that no new external dependencies are needed, (b) capture the validation architecture for the Nyquist gate, (c) record open questions as RESOLVED, and (d) confirm the architectural responsibility tier for each fix.

## Standard Stack (No New Dependencies)

Every RACE fix uses libraries already in `package.json`:

| Library | Version | Usage |
|---------|---------|-------|
| `drizzle-orm` | 0.45.2 | `sql\`now()\`` template, `db.transaction(async (tx) => {...})`, `jsonb_set` template, `lt`/`lte`/`isNull`/`or`/`eq`/`and` predicates |
| `postgres` | (drizzle peer) | postgres-js driver, real-DB concurrency tests |
| `vitest` | 4.1.x | `Promise.all`, `vi.useFakeTimers()`, `vi.setSystemTime()` — used by the concurrent-harness helper |
| `grammy` | 1.31 | `bot.api.sendMessage`, `GrammyError` (for RACE-06 send-failure simulation) |
| `pino` (via logger.ts) | n/a | `'rituals.weekly.send_failed'` ERROR log for RACE-06 |

**`dont_hand_roll`:** Don't write a custom transaction wrapper. `db.transaction(async (tx) => {...})` is the drizzle idiom and the project already uses it at `src/proactive/state.ts:284`.

## Architecture Patterns (Established, Reused)

1. **Single-round-trip atomic UPDATE-with-predicate.** Established by `tryFireRitualAtomic` (Phase 25 RIT-10). RACE-01 modernizes it (clock source); RACE-03 reuses the pattern on a different table column (`ritual_responses.respondedAt IS NULL` as the winner predicate).

2. **`db.transaction(async (tx) => {...})` for paired writes.** Established by `setEscalationState` at `src/proactive/state.ts:276-300`. RACE-02 and RACE-06 reuse the precedent.

3. **`jsonb_set` with `coalesce(${col}, '{}'::jsonb)`.** Established by `handleTap` at `src/rituals/wellbeing.ts:237`. RACE-04 reuses verbatim, nested for two flags.

4. **Pre-allocate-then-update for send-then-bookkeep.** Established by `src/rituals/journal.ts` PP#5. RACE-06 reuses the pattern; the current weekly-review.ts inverts it (sets `respondedAt` BEFORE the send) — that inversion IS the bug.

5. **Real Postgres concurrency tests.** Established by `src/rituals/__tests__/idempotency.test.ts:5-26` docstring contract. All four RACE concurrent regression tests (RACE-01, 02, 03, 06) follow the same harness pattern.

## Architectural Responsibility Map

| Capability | Tier | Owner File |
|------------|------|------------|
| Atomic ritual-fire claim (RACE-01) | DB transaction layer (UPDATE-WHERE-RETURNING) | `src/rituals/idempotency.ts` |
| Sweep-time paired-insert (RACE-02) | DB transaction layer (`db.transaction`) | `src/rituals/scheduler.ts` |
| Wellbeing completion idempotency (RACE-03) | DB transaction layer (atomic UPDATE-WHERE-RETURNING on `ritual_responses.respondedAt`) | `src/rituals/wellbeing.ts` |
| Wellbeing skip metadata merge (RACE-04) | DB SQL-fragment layer (`jsonb_set` nested) | `src/rituals/wellbeing.ts` |
| Open-row DST-safe filter (RACE-05) | DB query layer (WHERE-clause tightening) | `src/rituals/wellbeing.ts` |
| Weekly-review send-then-bookkeep (RACE-06) | Application orchestration layer (try/catch with two DB branches) | `src/rituals/weekly-review.ts` |
| Concurrent-invocation test harness | Test utility (no production dependency) | `src/__tests__/helpers/concurrent-harness.ts` |

All capabilities sit in their correct tier. No cross-tier displacement (no auth/access control fixes — these are pure DB-correctness changes).

## Code Examples (Cross-Reference to CONTEXT.md)

CONTEXT.md `<decisions>` D-42-01..D-42-16 contain the exact snippets. PATTERNS.md extracts them with file:line anchors. This RESEARCH.md does not duplicate them.

## Validation Architecture

Every Phase 42 fix must be regression-tested against the **failure mode the fix closes**, not just the success path. The validation strategy is:

| Requirement | Test Type | Test File | Validation Mechanism |
|-------------|-----------|-----------|----------------------|
| RACE-01 | Concurrent (real Postgres) | `idempotency.test.ts` (extend Test 2) | `freezeClock(T1)` + `runConcurrently(2, () => tryFireRitualAtomic(id, T1_minus_1, newNext))` — assert exactly one `{fired: true}` |
| RACE-02 | Mid-transaction throw | `scheduler.test.ts` (new test) | Mock `db.insert(ritualFireEvents)` to throw on the second insert; assert (a) zero `ritual_fire_events` rows, (b) `consumedAt` rolled back to NULL, (c) `skip_count` unchanged |
| RACE-03 | Three-way concurrent completion | `wellbeing.test.ts` (tighten Test 5 / add Test 7) | `runConcurrently(3, () => completeSnapshot(...))` against a tap-completing row — assert exactly one `wellbeing_completed` `ritual_fire_event` row, exactly one `editMessageText` call |
| RACE-04 | jsonb merge fidelity | `wellbeing.test.ts` (new test) | Pre-populate `metadata.partial.e=3`, call `handleSkip`, assert `metadata.partial.e` still equals 3 AND `metadata.skipped === true` |
| RACE-05 | DST edge | `wellbeing.test.ts` (new test) | Insert a prior-day open row with `fired_at = today - 23h59m`, call `findOpenWellbeingRow`, assert returns NULL — the 24-hour absolute window must reject the stale row |
| RACE-06 | Send failure rollback | `weekly-review.test.ts` (new test) | Mock `bot.api.sendMessage` to throw `GrammyError('429')`; assert (a) `respondedAt IS NULL`, (b) one `ritual_fire_events` row with `metadata.telegram_failed === true`, (c) `rituals.nextRunAt` reverted, (d) Pensieve entry exists |

**Nyquist sampling:** Each plan has ≥2 tasks with `<automated>` per wave (Wave 0 is not needed because tests for the existing files already exist and the new tests are added inline).

**Feedback latency:** All tests run under `bash scripts/test.sh` (Docker Postgres on port 5433). Single-file run takes ~10-30 seconds. No e2e/playwright/cypress.

## Open Questions (RESOLVED)

1. **Q:** Should the harness `freezeClock` use `vi.useFakeTimers({ shouldAdvanceTime: false })` or default? — **RESOLVED:** Default. The harness's contract is "pin Date.now() to a single ms"; advancing time defeats the contract. Confirmed by D-42-01 + D-42-03 (RACE-01 test must observe equal `Date.now()` across racers).

2. **Q:** Does adding `sql\`now()\`` to the `tryFireRitualAtomic` SET clause break the `lastObserved` parameter's semantics? — **RESOLVED:** No. `lastObserved` becomes non-load-bearing for race semantics (postgres `now()` advances strictly monotonically per-tx — the second invocation's WHERE predicate `lt(lastRunAt, sql\`now()\`)` is false because lastRunAt is already AT now() after the first commit). Keep `lastObserved` for caller visibility/logging and document the semantic shift in the docstring. Confirmed by D-42-02.

3. **Q:** Could a partial DB unique index on `(ritual_id, outcome, date_trunc('day', fired_at))` replace the RACE-03 completion-claim UPDATE? — **RESOLVED:** No. Timestamp-truncation indexes are fragile (DST shifts the day boundary), and the completion-claim UPDATE doubles as the side-effect gate for `editMessageText` and `skip_count = 0` (which a DB-unique index can't dedupe). Confirmed by D-42-14.

4. **Q:** Should RACE-06 use a "deferred constraint trigger" pattern instead of pre-allocate-then-update? — **RESOLVED:** No. Drizzle does not expose deferred constraints portably; pre-allocate-then-update is already established at `journal.ts` (Phase 26 PP#5) and `wellbeing.ts` `fireWellbeing`. Codebase consistency wins. Confirmed by D-42-12.

5. **Q:** Should RACE-06 introduce a new `fire_event` outcome (e.g., `'send_failed'`) instead of `outcome='fired' + metadata.telegram_failed`? — **RESOLVED:** No. Phase 28 D-28 established the convention "discriminator via metadata, not via outcome union extension". Keep the existing `'fired'` outcome; signal failure via `metadata.telegram_failed: true`. Confirmed by specifics block in CONTEXT.md.

6. **Q:** Should the per-row outer try/catch in `ritualResponseWindowSweep` be removed in favor of the transaction's roll-back-on-throw? — **RESOLVED:** No. Per-row error isolation is by design: a single bad row's transaction failure must NOT abort the whole sweep. The outer try/catch stays OUTSIDE the new `db.transaction(...)`. Confirmed by D-42-05.

## RESEARCH COMPLETE

**Phase:** 42 - atomicity-race-fixes
**Standard stack:** Drizzle ORM, postgres-js, Vitest, Grammy — all already in `package.json`
**New dependencies required:** None
**Open questions resolved:** 6 / 6
**Architectural map verified:** All 6 fixes sit in the correct tier (DB transaction / SQL fragment / orchestration)
**Validation strategy:** 6 regression tests under Docker Postgres (port 5433), each closes a documented failure mode
