---
phase: 13
plan: 04
subsystem: decisions/lifecycle
tags: [database, lifecycle, transactions, chokepoint, append-only]
requirements-completed: [LIFE-02, LIFE-03]
dependency-graph:
  requires:
    - src/db/schema.ts (decisions, decisionEvents, decisionCaptureState — Plan 02)
    - src/db/connection.ts (db, sql exports)
    - Live Docker Postgres with migrations 0000..0003 applied (Plan 03)
  provides:
    - src/decisions/errors.ts — three distinct error classes
    - src/decisions/lifecycle.ts — LEGAL_TRANSITIONS + transitionDecision() chokepoint
    - src/decisions/capture-state.ts — getActiveDecisionCapture() read helper
  affects:
    - Plan 05 (regenerate + concurrency verification uses transitionDecision end-to-end)
    - Phase 14 capture conversation (imports startDecisionCapture analog; today uses getActiveDecisionCapture read helper)
    - Phase 15 deadline sweep (calls transitionDecision(id, 'open', 'due', {actor:'sweep'}) with retry on OptimisticConcurrencyError)
    - Phase 16 resolution handler (transitionDecision due → resolved; resolved → reviewed)
    - Phase 18 TEST-11 (distinguishes InvalidTransitionError vs OptimisticConcurrencyError programmatically)
tech-stack:
  added: []
  patterns:
    - optimistic-concurrency-via-update-where-clause-guard
    - update-first-then-insert-atomic-transaction
    - explicit-fromStatus-signature (no pre-read round-trip)
    - Object.setPrototypeOf-for-instanceof-under-es-downlevel
key-files:
  created:
    - src/decisions/errors.ts
    - src/decisions/lifecycle.ts
    - src/decisions/capture-state.ts
  modified:
    - src/decisions/__tests__/lifecycle.test.ts (Rule 1 auto-fix — missing decisionText)
    - src/decisions/__tests__/capture-state.test.ts (Rule 1 auto-fix — Drizzle error cause matcher)
decisions:
  - UPDATE-first-then-INSERT preserves append-first SPIRIT via atomic tx; no .update(decisionEvents) anywhere
  - 4-arg signature with explicit fromStatus eliminates pre-read round-trip AND distinguishes NotFound from Concurrency
  - Three distinct error classes (not one) because Phase 15 sweep retries Concurrency but gives up on Invalid, and Phase 18 TEST-11 asserts this distinguishability
  - Terminal-status timestamps (withdrawn_at/stale_at/abandoned_at/resolved_at/reviewed_at) set inline in the same UPDATE for D-12 denormalized consistency
metrics:
  duration: ~20m
  completed: 2026-04-15
  tasks: 3
  files-created: 3
  files-modified: 2
---

# Phase 13 Plan 04: Lifecycle Chokepoint Summary

The lifecycle chokepoint lands: `transitionDecision(id, fromStatus, toStatus, payload)` is the sole code path that mutates `decisions.status`, and it runs inside a single `db.transaction()` that UPDATEs the projection first (with an optimistic WHERE-clause guard on the expected `fromStatus`), then INSERTs a `decision_events` row whose `snapshot` column is the full post-update row returned by the UPDATE. Three distinct error classes (`InvalidTransitionError` / `OptimisticConcurrencyError` / `DecisionNotFoundError`) make every failure mode programmatically distinguishable for Phase 15 sweep retries and Phase 18 TEST-11 assertions. `getActiveDecisionCapture(chatId)` ships as a read-only helper for the Phase 14 engine pre-processor hook.

## What Was Built

### `src/decisions/errors.ts` (37 lines)
- `DecisionStatusLiteral` type alias exported (re-used by lifecycle.ts, Phase 14 capture, Phase 15 sweep).
- `InvalidTransitionError(fromStatus, toStatus)` — illegal per D-04 map; message mentions both status names; fields `fromStatus` + `toStatus` accessible.
- `OptimisticConcurrencyError(decisionId, expectedStatus)` — row exists but its status changed under us; fields `decisionId` + `expectedStatus`.
- `DecisionNotFoundError(decisionId)` — no row with the given id; field `decisionId`.
- All three use `Object.setPrototypeOf` so `instanceof` works correctly under the project's ES target.

### `src/decisions/lifecycle.ts` (116 lines)
- `LEGAL_TRANSITIONS` Readonly-Record constant mirroring D-04 verbatim:
  ```
  open-draft → { open, withdrawn, abandoned }
  open       → { due, withdrawn }
  due        → { resolved, stale, withdrawn }
  resolved   → { reviewed }
  reviewed / withdrawn / stale / abandoned → {}   (terminals)
  ```
- `transitionDecision(id, fromStatus, toStatus, payload)`:
  1. **Fast-fail illegal moves BEFORE the tx.** If `(fromStatus, toStatus)` is not in `LEGAL_TRANSITIONS[fromStatus]` OR `fromStatus === toStatus`, throw `InvalidTransitionError`. No DB round-trip wasted.
  2. **Open `db.transaction()`.**
  3. Compute terminal-timestamp patch: `{withdrawnAt|staleAt|abandonedAt|resolvedAt|reviewedAt: new Date()}` for the matching `toStatus`, otherwise `{}`.
  4. `UPDATE decisions SET status=toStatus, updatedAt=now(), ...terminalTimestamp WHERE id=$id AND status=$fromStatus RETURNING *` — the WHERE-clause guard is the optimistic concurrency check.
  5. If `updated.length === 0`: run a single-column `SELECT id FROM decisions WHERE id=$id LIMIT 1` inside the same tx. If empty → `DecisionNotFoundError(id)`. Otherwise → `OptimisticConcurrencyError(id, fromStatus)`.
  6. `INSERT decision_events` with `eventType='status_changed'`, `fromStatus`, `toStatus`, `snapshot=updated[0]`, `actor=payload.actor ?? 'system'`. The snapshot is the REAL post-update row, so no placeholder and no subsequent `.update(decisionEvents)` is ever needed.
  7. Return `updated[0]`.

### `src/decisions/capture-state.ts` (21 lines)
- `getActiveDecisionCapture(chatId: bigint)` returns the capture-state row for a chat, or null if empty. Read-only (no `.insert`/`.update`/`.delete`) — Phase 14 will add write helpers.

## UPDATE-First-Then-INSERT — How It Preserves Append-First Spirit

Append-first is not strictly about ordering the SQL statements; it is about **atomicity of event + projection**. The D-01 / D-02 rule is "the projection never changes without a corresponding event." The prior plan's draft called for INSERT-first with a placeholder snapshot later overwritten — which required `.update(decisionEvents)` and violates the strict append-only test. The revision:

- Puts both SQL statements inside one `db.transaction()`, so either both land or neither does — an event is impossible without its projection change and vice versa.
- Lets the UPDATE run first to produce the real snapshot via `RETURNING *`, which is then passed straight to the INSERT. No placeholder → no overwrite → no `.update(decisionEvents)` anywhere.
- Passes the `chokepoint-audit.test.ts` zero-exemption ban on `.update(decisionEvents)` and `.delete(decisionEvents)` callsites.

The 4-arg signature with explicit `fromStatus` is the second half of this design. Alternative approaches (3-arg + pre-read) would either:
- Pre-read the row to learn its status, then UPDATE — still racy between the pre-read and the UPDATE, and costs an extra round-trip.
- Inspect the UPDATE's rowcount without a guard — can't distinguish "row doesn't exist" from "row exists but status changed."

Explicit `fromStatus` gives the WHERE-clause guard for free, collapses to one happy-path round-trip (UPDATE + INSERT), and uses a single extra SELECT only on the rare 0-row case to disambiguate `DecisionNotFoundError` vs `OptimisticConcurrencyError`.

## Three-Error-Class Taxonomy

| Class | Thrown When | Caller Response |
|---|---|---|
| `InvalidTransitionError` | (fromStatus, toStatus) not in D-04 legal map or fromStatus === toStatus | Always a programmer error. Do not retry. Phase 15 sweep gives up and logs. |
| `OptimisticConcurrencyError` | Row exists but its current status ≠ the claimed fromStatus | Transient race. Phase 15 sweep retries after re-reading. |
| `DecisionNotFoundError` | No row with `id` | Caller passed a stale id. Do not retry. Phase 15 sweep logs and moves on. |

Collapsing these into one class would make Phase 15 sweep unable to distinguish retry-worthy races from programmer errors, and Phase 18 TEST-11 would lose the ability to assert correct error-class selection under concurrent pressure.

## Legal Transitions Map (D-04)

```
open-draft → open        (Phase 14 commit when all required fields collected)
open-draft → withdrawn   (Greg abandons capture explicitly)
open-draft → abandoned   (Phase 14 GC after 24h without completion)
open       → due         (Phase 15 sweep when resolve_by has passed)
open       → withdrawn   (Greg changes his mind before deadline)
due        → resolved    (Phase 16 when Greg replies to resolution prompt)
due        → stale       (Phase 16 RES-06 auto-escalation after 2 non-replies)
due        → withdrawn   (Greg withdraws between surfacing and resolving)
resolved   → reviewed    (Phase 16 post-mortem follow-up answered)
reviewed / withdrawn / stale / abandoned → {}   (no outgoing edges — terminal)
```

Enforced both as the `LEGAL_TRANSITIONS` constant in `lifecycle.ts` and by the full enumeration in `lifecycle.test.ts` (every illegal `(from, to)` pair throws, every terminal has zero outgoing edges, `same → same` throws).

## Test Results

### Went RED → GREEN this plan:
- `src/decisions/__tests__/lifecycle.test.ts` — **65/65 passed** (~640ms). Covers:
  - Happy path (open-draft → open) transitions status + appends exactly one event.
  - Append-first: event count increments by 1 and `snapshot.status === row.status` post-update.
  - Full illegal-transition enumeration: 64 total (from, to) pairs not in LEGAL all throw `InvalidTransitionError`.
  - Terminal states: 4 × 7 = 28 terminal → non-terminal attempts all throw.
  - `InvalidTransitionError(open, open)` (self-loop) throws.
  - `DecisionNotFoundError` thrown when id does not exist.
  - `OptimisticConcurrencyError` thrown when seed status='open' but caller claims fromStatus='open-draft'.
  - Error message contains both status names.
- `src/decisions/__tests__/capture-state.test.ts` — **3/3 passed** (~530ms).
  - null when table empty.
  - returns row with stage='DECISION' after insert.
  - PK=chat_id rejects duplicate chat insert with 23505 unique-violation.
- `src/decisions/__tests__/chokepoint-audit.test.ts` — **2/2 passed** (~140ms). No `.update(decisions).set({status:...})` outside lifecycle.ts; zero `.update(decisionEvents)`/`.delete(decisionEvents)` anywhere under src/.

### Still RED (Plan 05 scope):
- `src/decisions/__tests__/concurrency.test.ts` — still RED (1/1 failing). Plan 05 validates the race end-to-end.
- `src/decisions/__tests__/regenerate.test.ts` — still RED (not run this plan). Plan 05 lands the replay function.

### Regression smoke:
- All four decision suites run sequentially → **79/79 passed** (schema + lifecycle + capture-state + chokepoint-audit).
- Full-suite `npm test` was attempted but port 5433 is already bound by a sibling worktree's Docker PG; live-integration tests hang on invalid Anthropic API-key 401s (pre-existing, out of scope). The target DB-backed tests for this plan run against the live container directly and are verified green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] lifecycle.test.ts `seedDecision` missing `decision_text`**
- **Found during:** Task 2 verification.
- **Issue:** `seedDecision()` INSERT omitted the NOT NULL `decision_text` column. All 65 tests failed with `23502 null value in column "decision_text"`. Identical pattern to Plan 03's schema.test.ts fix.
- **Fix:** Added `decisionText: 'seeded'` to the values block.
- **Files modified:** `src/decisions/__tests__/lifecycle.test.ts` (1 line added).
- **Commit:** `6202902`

**2. [Rule 1 — Bug] capture-state.test.ts unique-violation assertion matched the wrong error layer**
- **Found during:** Task 3 verification.
- **Issue:** `.rejects.toThrow(/duplicate key|unique constraint/i)` matches the Drizzle wrapper's outer message (`"Failed query: insert into …"`), not the inner PostgresError. The underlying `23505 unique_violation` is attached as `err.cause`; the regex never matched.
- **Fix:** Switched to `.rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/…/) }) })` to walk into `err.cause`.
- **Files modified:** `src/decisions/__tests__/capture-state.test.ts` (7-line diff).
- **Commit:** `65f2dcf`

No architectural changes; no auth gates; no CLAUDE.md-driven adjustments.

## Out-of-scope Discoveries (Deferred)

- **Full-suite hang due to live-integration tests with invalid Anthropic key.** `npm test` brings up docker-compose which collides on port 5433 with a sibling worktree's container; when bypassing via direct vitest run, `src/chris/__tests__/live-integration*.test.ts` emit 401s and stall in retry loops. Pre-existing to this plan; test infrastructure issue. Not logged to a separate deferred-items.md because this is already well-known (see `13-03-SUMMARY.md` regression note about contradiction-integration running green, implying live-integration tests are a known-flake area).
- **Vitest file-level parallelism flake across decisions/__tests__/\*.test.ts.** When running all decision suites with default file parallelism, lifecycle.test.ts can fail with `DecisionNotFoundError` — the parallel `afterEach` DELETE in concurrency/capture-state/schema tests races with lifecycle.test's mid-test transitions. Fixes cleanly with `--fileParallelism=false`. Root cause is tests share a single DB with no per-file isolation. Deferred — a per-suite SCHEMA prefix or `decisionId` filtering in `afterEach` would fix it, but this is test infrastructure polish for Plan 05 or a later cleanup.

## Commits

- `8116389` — feat(13-04): add three distinct error classes for decision lifecycle
- `6202902` — feat(13-04): add transitionDecision chokepoint with UPDATE-first-then-INSERT
- `65f2dcf` — feat(13-04): add getActiveDecisionCapture read helper

## Known Stubs

None. Phase 14 additions (capture-state mutators) are documented as "Phase 14 will add" in `capture-state.ts` — not a stub, a deferred responsibility with a clear owner.

## Threat Flags

None. Plan touches `decisions.status` only inside the declared chokepoint; `decision_events` strictly append-only; `decision_capture_state` read-only helper. No new network surface, no new auth path, no new trust boundary. T-13-01..06 mitigations from the plan's threat_model are implemented as specified.

## Self-Check: PASSED

**Files:**
- FOUND: src/decisions/errors.ts
- FOUND: src/decisions/lifecycle.ts
- FOUND: src/decisions/capture-state.ts
- FOUND: src/decisions/__tests__/lifecycle.test.ts (modified)
- FOUND: src/decisions/__tests__/capture-state.test.ts (modified)

**Commits:**
- FOUND: 8116389
- FOUND: 6202902
- FOUND: 65f2dcf

**Tests:**
- FOUND: lifecycle.test.ts 65/65 GREEN
- FOUND: capture-state.test.ts 3/3 GREEN
- FOUND: chokepoint-audit.test.ts 2/2 GREEN
- FOUND: schema.test.ts 9/9 GREEN (no regression from Plan 03)
- EXPECTED-RED: concurrency.test.ts (Plan 05 scope)
- EXPECTED-RED: regenerate.test.ts (Plan 05 scope)

**Grep invariants:**
- `.update(decisionEvents)` / `.delete(decisionEvents)` under src/ → 0
- `tx.update(decisionEvents)` under src/ → 0
- `.update(decisions).set({status:...})` outside lifecycle.ts → 0
