---
phase: 13
plan: 05
subsystem: decisions/regenerate + barrel
tags: [database, lifecycle, event-sourcing, replay, append-only, concurrency]
requirements-completed: [LIFE-02, LIFE-03]
dependency-graph:
  requires:
    - src/decisions/lifecycle.ts (Plan 04 chokepoint — UPDATE-first-then-INSERT tx)
    - src/decisions/errors.ts (Plan 04 — OptimisticConcurrencyError)
    - src/decisions/capture-state.ts (Plan 04 — getActiveDecisionCapture)
    - src/db/schema.ts decisionEvents (Plan 02 — sequence_no bigserial tiebreaker)
  provides:
    - src/decisions/regenerate.ts — regenerateDecisionFromEvents(id) replay function
    - src/decisions/index.ts — single import surface for Phases 14-18
  affects:
    - Phase 14 capture (imports everything from '../decisions/index.js')
    - Phase 15 deadline sweep (OptimisticConcurrencyError retry contract now live)
    - Phase 16 resolution handler (same barrel consumer)
    - Phase 18 TEST-11 (regenerate drift-audit pattern available)
tech-stack:
  added: []
  patterns:
    - replay-via-last-snapshot (D-01 full-snapshot → no merge logic)
    - timestamptz-jsonb-rehydration (ISO string → Date)
    - bigint-chatid-jsonb-coercion (defensive string → BigInt)
    - barrel-re-export-single-import-surface
key-files:
  created:
    - src/decisions/regenerate.ts
    - src/decisions/index.ts
  modified:
    - src/decisions/__tests__/regenerate.test.ts (Rule 1 auto-fix — missing decisionText + Date→ISO for tagged-template binding)
    - src/decisions/__tests__/concurrency.test.ts (Rule 1 auto-fix — missing decisionText)
    - src/db/schema.ts (Rule 1 auto-fix — sequenceNo .default(nextval) so TS knows DB supplies it)
decisions:
  - Replay = "read the last event's snapshot and rehydrate" — no event merging, per D-01 full-snapshot mandate
  - Nine timestamptz columns explicitly listed for Date rehydration; comment instructs future phases to extend the list
  - bigint chat_id coercion is defensive — if postgres.js/Drizzle ever round-trips bigint-as-string through jsonb, deep-equal still passes
  - Full npm test suite run against real Docker PG; 4 pre-existing baseline failures (3 live-LLM smoke + 1 LANG-02 default) documented as out-of-scope; all 883 non-live-LLM tests GREEN
metrics:
  duration: ~49m (includes branch rewind + full-suite triage)
  completed: 2026-04-15
  tasks: 2
  files-created: 2
  files-modified: 3
---

# Phase 13 Plan 05: Regenerate + Concurrency Verification Summary

Phase 13 closes. `regenerateDecisionFromEvents(id)` replays `decision_events` in `(created_at ASC, sequence_no ASC)` order, returns the last event's snapshot rehydrated to match the live projection (9 timestamptz columns coerced back to `Date`, defensive `bigint` coercion for `chatId`). All three replay test cases are GREEN (happy-path `open-draft → open → due → resolved → reviewed`, side-path `open → withdrawn`, deterministic tiebreaker under tied `created_at`). The concurrency race test is GREEN against Plan-04's UPDATE-first-then-INSERT chokepoint: two `transitionDecision(id,'open','due',...)` calls through the shared pool resolve as exactly one fulfilled + one `OptimisticConcurrencyError`, with exactly one event row in `decision_events` (loser's INSERT rolled back with its UPDATE). The `src/decisions/index.ts` barrel gives Phases 14-18 a single import surface. Final chokepoint audit passes zero-exemption: no `.update(decisionEvents)` / `.delete(decisionEvents)` / `tx.update(decisionEvents)` anywhere in production `src/`.

## What Was Built

### `src/decisions/regenerate.ts` (~70 lines)

```typescript
export async function regenerateDecisionFromEvents(id: string): Promise<DecisionRow | null>
```

1. `SELECT * FROM decision_events WHERE decision_id=$id ORDER BY created_at ASC, sequence_no ASC`
2. If zero rows → `null`.
3. Take the **last** row's `snapshot` jsonb (D-01: full snapshots, so the last one IS the current projection).
4. Rehydrate 9 timestamptz columns (createdAt, updatedAt, resolveBy, resolvedAt, reviewedAt, withdrawnAt, staleAt, abandonedAt, accuracyClassifiedAt) from ISO 8601 strings to `Date` objects.
5. Coerce `chatId` from string back to `bigint` if jsonb stringified it.
6. Return the rehydrated row.

**Why "last snapshot" rather than "merge events":** D-01 mandates every event carries a full snapshot (no diffs, no hybrid). The append-only invariant plus full-snapshot semantics means the last event's `snapshot` column IS the post-transition state of the `decisions` row. No merge logic needed — just pick the most recent one.

**Why explicit timestamptz list:** Drizzle's `.select()` returns `Date` objects for `timestamp with time zone` columns, but Postgres's `row_to_json`-equivalent serialization puts them into jsonb as ISO 8601 strings. For `expect(regenerated).toEqual(projection)` to succeed, we must rehydrate to `Date`. The 9 columns come directly from `src/db/schema.ts`'s `decisions` table. Future phases that add timestamptz columns must extend `TIMESTAMPTZ_COLUMNS`.

### `src/decisions/index.ts` (~22 lines)

Barrel re-exports for Phases 14-18 consumers:

```typescript
export { transitionDecision, LEGAL_TRANSITIONS } from './lifecycle.js';
export type { ActorKind, TransitionPayload } from './lifecycle.js';
export { InvalidTransitionError, OptimisticConcurrencyError, DecisionNotFoundError } from './errors.js';
export type { DecisionStatusLiteral } from './errors.js';
export { regenerateDecisionFromEvents } from './regenerate.js';
export { getActiveDecisionCapture } from './capture-state.js';
```

Phase 14+ imports become `import { transitionDecision, OptimisticConcurrencyError } from '../decisions/index.js';` — one surface, stable regardless of internal module layout.

## Concurrency Race Outcome

`concurrency.test.ts` runs two `transitionDecision(id, 'open', 'due', ...)` calls through `Promise.allSettled` against the shared default `postgres.js` pool (`max=10`, so the two awaited queries land on distinct connections):

- **Fulfilled:** 1 (first tx's UPDATE affects 1 row, commits the status change + INSERT of the event).
- **Rejected:** 1 × `OptimisticConcurrencyError` (second tx's UPDATE's WHERE-clause guard finds `status != 'open'` → 0 rows; the existence SELECT sees the row → throws `OptimisticConcurrencyError`).
- **Event count:** exactly 1 `decision_events` row for this (decision, to_status=due) pair — the loser's transaction rolled back the INSERT along with its 0-row UPDATE.
- **Projection:** `status='due'` — winner's value.

No `sqlOverride`, no two-client architecture, no API injection. The shared pool is sufficient because postgres.js routes concurrent awaited queries to distinct connections, and the atomic UPDATE-first-then-INSERT transaction (Plan 04) is what makes the race deterministic.

## Full Test Suite Results

**Docker PG:** sibling-worktree-owned `agent-a4cfa2a6-postgres-1` on `localhost:5433`, `pgvector/pgvector:pg16`, all 4 migrations (0000, 0001, 0002, 0003) live. Verified before the run: 3 decision tables present, 8 values each in `decision_status` and `decision_capture_stage`, `DECISION` in `epistemic_tag`.

**Run:** `DATABASE_URL=... npx vitest run --no-file-parallelism --exclude live-integration --exclude contradiction-false-positive`

**Result: 883 passed / 4 failed / 62 files (60 passed, 2 failed).**

### Phase 13 tests — all GREEN

| Test file                                | Tests | Status |
|------------------------------------------|-------|--------|
| schema.test.ts                           | 9     | ✅     |
| lifecycle.test.ts                        | 65    | ✅     |
| capture-state.test.ts                    | 3     | ✅     |
| chokepoint-audit.test.ts                 | 2     | ✅     |
| regenerate.test.ts                       | 3     | ✅     |
| concurrency.test.ts                      | 1     | ✅     |
| **Total Phase 13**                       | **83**| **✅** |

### Pre-existing baseline failures (4 tests, 2 files) — NOT caused by Phase 13

| File                                          | Failures | Cause |
|-----------------------------------------------|----------|-------|
| `src/llm/__tests__/models-smoke.test.ts`      | 3        | Live-LLM smoke test (Haiku/Sonnet/Opus). `describe.skipIf` only triggers when `ANTHROPIC_API_KEY` is unset; the fake `test-key` we pass for env-validation makes the smoke tests actually attempt real API calls and 401. Already documented as pre-existing by Plan 13-04's deferred section. |
| `src/chris/__tests__/language.test.ts`        | 1        | `detectLanguage('ok', null)` test expects `'English'` but the impl returns `null`. Recent branch commits `043aedc` and `a14cd35` ("drop default-English fallback in detectLanguage" and "coerce null→undefined for handler signatures") changed behavior; the test wasn't updated. Pre-existing in the reset base `2f38105`. |

Both failure classes are orthogonal to decision-archive work — they would reproduce on a clean reset to `2f38105` without any Phase 13 code at all.

### Live-LLM tests excluded (require real Anthropic API key)

| File                                              | Why excluded |
|---------------------------------------------------|--------------|
| `src/chris/__tests__/live-integration.test.ts`    | Hangs indefinitely on 401 retry loops when given a fake key. Documented pre-existing by Plan 13-04. |
| `src/chris/__tests__/contradiction-false-positive.test.ts` | Same pattern: live Anthropic call, hangs on 401. |

These are live-LLM integration tests (not DB integration tests). Per user memory, the rule is "never skip **Docker PG** integration tests" — and we didn't. All Docker-PG-backed integration tests ran against the real container: `contradiction-integration.test.ts` (8/8 GREEN), `pensieve/integration.test.ts` (GREEN), the entire Phase 13 decisions suite (83/83 GREEN).

### Chokepoint audit — final

```
grep -rnE "\.update\(\s*decisionEvents\s*\)" src/   → matches only in __tests__/ (audit pattern string literals + test-fixture cleanup .delete calls)
grep -rnE "\.delete\(\s*decisionEvents\s*\)" src/   → matches only in __tests__/
grep -rnE "tx\.update\(\s*decisionEvents\s*\)" src/ → zero matches
```

`chokepoint-audit.test.ts` (2/2 GREEN) excludes `__tests__/` directories from its scan, so it enforces the invariant on production code only. **Zero production-code violations.** `decision_events` is structurally append-only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `regenerate.test.ts` `seedDecision` missing `decisionText`**
- **Found during:** Task 1 first GREEN attempt.
- **Issue:** Same pattern as Plans 03 and 04 — `seedDecision` INSERT omitted `decision_text` (NOT NULL per LIFE-04 sibling column). All 3 tests failed with `23502 null value in column "decision_text"`.
- **Fix:** Added `decisionText: 'seeded'` to the values block.
- **Files modified:** `src/decisions/__tests__/regenerate.test.ts`.
- **Commit:** `214fc2b`

**2. [Rule 1 — Bug] `regenerate.test.ts` tied-timestamp test binding a `Date`**
- **Found during:** Task 1 after fix #1.
- **Issue:** `const tied = new Date(...)` passed to a postgres.js tagged template caused `TypeError: The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date`. postgres.js's raw template path requires string/Buffer bindings.
- **Fix:** Changed to `const tied = '2026-04-15T10:00:00.000Z'` and added `::timestamptz` casts on both INSERTs. Semantics identical — Postgres parses the ISO string as timestamptz on the server side.
- **Files modified:** `src/decisions/__tests__/regenerate.test.ts`.
- **Commit:** `214fc2b`

**3. [Rule 1 — Bug] `concurrency.test.ts` `seedDecision` missing `decisionText`**
- **Found during:** Task 2 verification.
- **Issue:** Identical pattern to #1 — same missing NOT NULL column.
- **Fix:** Added `decisionText: 'seeded'`.
- **Files modified:** `src/decisions/__tests__/concurrency.test.ts`.
- **Commit:** `3bf6f28`

**4. [Rule 1 — Bug / Rule 2 — Critical functionality] `schema.ts` `sequenceNo` TS error blocks build**
- **Found during:** Task 2 `npx tsc --noEmit` after adding `index.ts` barrel.
- **Issue:** Plan 02's handwritten `bigserial` fallback on `sequence_no` declared the Drizzle column as `bigint('sequence_no').notNull()` with no `.default()`, so every `insert` on `decisionEvents` required TS to see a `sequenceNo` value supplied at the call site — even though the DB has a `nextval(...)` default filling it. `lifecycle.ts` (Plan 04) never passes `sequenceNo` → build fails. Pre-existing (Plan 04 summary flagged it implicitly by noting TS config excludes test files from `tsc build`). Build (`npm run build`) was failing on `main` at Plan 05 start.
- **Fix:** Added `.default(sql\`nextval('decision_events_sequence_no_seq'::regclass)\`)` to `sequenceNo` in `schema.ts`. This tells Drizzle/TS that the column is insert-optional (DB supplies it), which matches the live schema (`\d decision_events` shows `default: nextval('decision_events_sequence_no_seq'::regclass)`). Applied tests still GREEN; build now clean.
- **Files modified:** `src/db/schema.ts`.
- **Commit:** `3bf6f28`
- **Scope note:** Strictly speaking this was caused by Plan 02's migration + schema decision, not Plan 05. Fixed here because it blocked Plan 05's typecheck, and leaving the build broken would cascade to every downstream phase. Falls under Rule 2 (critical correctness — build must succeed).

### No Rule-4 deviations

No architectural changes. The chokepoint shape, error taxonomy, and replay semantics are all exactly as Plan 05 specified. No auth gates. No CLAUDE.md conflicts (repository has no CLAUDE.md).

## Out-of-scope Discoveries (Deferred, logged for later)

1. **`models-smoke.test.ts` fake-key 401 failures (3 tests).** Live-LLM smoke tests have a `SKIP = !process.env.ANTHROPIC_API_KEY` guard that misfires when callers pass a placeholder key for env-validation. Could be tightened to `!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'test-key'`, or the tests could live behind a separate env flag. Pre-existing.
2. **`language.test.ts` LANG-02 default expectation.** Recent commits dropped the English default but did not update the test. `detectLanguage('ok', null)` now returns `null`; test expects `'English'`. Pre-existing baseline issue (in the reset base `2f38105`).
3. **Vitest file-level parallelism flake on decisions/__tests__/.** Plan 04 flagged this. Confirmed still present — without `--no-file-parallelism`, `afterEach` DELETEs across files race with in-flight transitions in other files and trip the FK constraint. Workaround is the `--no-file-parallelism` flag. Proper fix would be per-file decisionId prefixing so `afterEach` scopes its cleanup. Logged for a future test-infrastructure cleanup plan.
4. **`live-integration.test.ts` and `contradiction-false-positive.test.ts` hang on fake key.** Excluded from the full run (`--exclude`). Same root cause as #1 — the `skipIf` guard is `!process.env.ANTHROPIC_API_KEY`, triggered only when completely unset.

None of these were auto-fixed because none are caused by Phase 13 changes and all would require test-infrastructure or baseline-code work outside the phase boundary.

## Phase 13 Requirement Coverage

| Req ID  | Behavior                                                        | Proof                                    | Status |
|---------|-----------------------------------------------------------------|------------------------------------------|--------|
| LIFE-01 | 3 new tables + 2 pgEnums + DECISION epistemic tag post-migration | schema.test.ts 9/9 GREEN (Plan 03)      | ✅     |
| LIFE-02 | Event-log append per transition + full-snapshot replay roundtrip | lifecycle.test.ts + regenerate.test.ts GREEN | ✅     |
| LIFE-03 | Chokepoint: only `transitionDecision()` mutates status; illegal transitions + concurrency race distinguishably throw | lifecycle.test.ts 65/65 + chokepoint-audit.test.ts 2/2 + concurrency.test.ts 1/1 | ✅     |
| LIFE-04 | `falsification_criterion NOT NULL` + `resolve_by NOT NULL` enforced by DB | schema.test.ts 2/2 NOT-NULL cases GREEN | ✅     |
| LIFE-06 | `DECISION` in `epistemic_tag` enum; pensieve/contradictions still work | schema.test.ts + contradiction-integration.test.ts GREEN | ✅     |

All five LIFE requirements structurally satisfied. Phase 14 can build capture on this foundation.

## Downstream Import Pattern (for Phases 14-18)

Consumers should import from the barrel:

```typescript
import {
  transitionDecision,
  LEGAL_TRANSITIONS,
  type TransitionPayload,
  type ActorKind,
  InvalidTransitionError,
  OptimisticConcurrencyError,
  DecisionNotFoundError,
  type DecisionStatusLiteral,
  regenerateDecisionFromEvents,
  getActiveDecisionCapture,
} from '../decisions/index.js';
```

Avoid importing the individual modules (`./lifecycle.js` etc.) — the barrel is the stable public surface.

## Commits

- `214fc2b` — feat(13-05): add regenerateDecisionFromEvents with timestamptz rehydration
- `3bf6f28` — feat(13-05): add decisions barrel index.ts + concurrency test GREEN

## Known Stubs

None. Everything Plan 05 set out to ship is present and tested. The optional `bigint` chat_id coercion in `rehydrateDates` is defensive (no current test exercises it because regenerate.test.ts doesn't seed chatId), but it's not a stub — it's an explicit guard for a known postgres.js/Drizzle jsonb round-trip edge case that future phases may hit.

## Threat Flags

None. Plan 05 adds read-only replay + a re-export barrel. No new network surface, no new auth path, no new trust boundary. The three threat-model entries (T-13-06 tamper, T-13-07 clock-skew determinism, T-13-08 concurrent race DoS) are mitigated as specified:

- **T-13-06 (tamper):** `decision_events` append-only confirmed by chokepoint-audit.test.ts passing on production `src/`.
- **T-13-07 (clock-skew):** regenerate.test.ts tiebreaker case proves `(created_at ASC, sequence_no ASC)` ordering is deterministic under tied `created_at`.
- **T-13-08 (concurrent race):** concurrency.test.ts GREEN — one winner + one `OptimisticConcurrencyError`, exactly one event row.

## Self-Check: PASSED

**Files:**
- FOUND: src/decisions/regenerate.ts
- FOUND: src/decisions/index.ts
- FOUND: src/decisions/__tests__/regenerate.test.ts (modified)
- FOUND: src/decisions/__tests__/concurrency.test.ts (modified)
- FOUND: src/db/schema.ts (modified — sequenceNo default)
- FOUND: .planning/phases/13-schema-lifecycle-primitives/13-05-SUMMARY.md (this file)

**Commits:**
- FOUND: 214fc2b (regenerate.ts + test fixes)
- FOUND: 3bf6f28 (index.ts + concurrency test fix + schema sequenceNo default)

**Tests:**
- FOUND: regenerate.test.ts 3/3 GREEN
- FOUND: concurrency.test.ts 1/1 GREEN
- FOUND: Phase 13 suite 83/83 GREEN (all 6 files)
- FOUND: Full suite 883/887 — 4 failures are pre-existing baseline (documented above)

**Grep invariants:**
- `.update(decisionEvents)` in production src/ → 0 (all matches are in __tests__/)
- `.delete(decisionEvents)` in production src/ → 0 (all matches are in __tests__/)
- `tx.update(decisionEvents)` anywhere under src/ → 0
- chokepoint-audit.test.ts GREEN (enforces the above programmatically, excluding __tests__/)
