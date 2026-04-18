---
phase: 13-schema-lifecycle-primitives
verified: 2026-04-15T17:15:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
requirements_covered: [LIFE-01, LIFE-02, LIFE-03, LIFE-04, LIFE-06]
verifier_run:
  phase_13_suite: "83/83 GREEN against live Docker PG (pgvector/pgvector:pg16 on :5433)"
  full_suite: "Plan 05 documented 883/887; 4 pre-existing orthogonal failures (live-LLM 401s + language test baseline) reproduce without Phase 13"
  chokepoint_audit_grep:
    - ".update(decisionEvents) in src/ excluding __tests__/: 0"
    - ".delete(decisionEvents) in src/ excluding __tests__/: 0"
    - "tx.update(decisionEvents) anywhere: 0"
    - ".update(decisions).set(...) outside lifecycle.ts: 0 (only match is the audit pattern literal)"
---

# Phase 13 — Schema & Lifecycle Primitives: Verification Report

**Phase Goal (ROADMAP.md L49):** "The database encodes decision lifecycle invariants correctly and any illegal transition is structurally impossible — nothing else in M007 can be built safely without this layer."
**Verified:** 2026-04-15T17:15:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement — Success Criteria (ROADMAP.md L52-57)

| # | Success Criterion (roadmap contract) | Status | Evidence |
|---|--------------------------------------|--------|----------|
| 1 | `decisions`, `decision_events`, `decision_capture_state` tables exist in Drizzle schema with `pgEnum` for `decision_status` (incl. open-draft/withdrawn/stale/abandoned) and `decision_capture_stage`, auto-migrated cleanly against Docker Postgres. | ✓ VERIFIED | schema.ts L65-87 (3 enums), L210, L251, L276 (3 tables). Migrations 0002/0003 on disk. Live DB query confirms 3 tables + 8 decision_status values + 8 decision_capture_stage values. `schema.test.ts` 9/9 GREEN against live DB. |
| 2 | `decision_events` is append-only: every status transition and field change is a new row, and the current `decisions` row is regenerable by replaying events. | ✓ VERIFIED | `regenerate.ts` L56-67 (replay via last snapshot per D-01); `regenerate.test.ts` 3/3 GREEN (happy path + side-path + tied-timestamp determinism); `chokepoint-audit.test.ts` 2/2 GREEN (zero `.update(decisionEvents)`/`.delete(decisionEvents)` in production src/). `lifecycle.ts` INSERTs an event on every transition; no UPDATE/DELETE path on decisionEvents exists anywhere. |
| 3 | `transitionDecision(id, toStatus, payload)` is the only code path that mutates `decisions.status`; uses `UPDATE … WHERE id=$id AND status=$expected` and throws `InvalidTransitionError` on illegal moves. | ✓ VERIFIED (with scope note) | `lifecycle.ts` L60 (the chokepoint), L85-88 (optimistic WHERE-clause guard on expected fromStatus), L67-70 (InvalidTransitionError fast-fail). `chokepoint-audit.test.ts` 2/2 GREEN — only `lifecycle.ts` calls `.update(decisions).set(...)`. Grep confirms: production `.update(decisions)` call site = 1 (lifecycle.ts L85). `lifecycle.test.ts` 65/65 GREEN covers full illegal-transition enumeration + terminals + self-loop + error-class distinction. **Signature note:** ROADMAP spec was 3-arg `(id, toStatus, payload)`; implementation is 4-arg `(id, fromStatus, toStatus, payload)` — this is a deliberate improvement documented in 13-02-PLAN chokepoint revision and 13-04-SUMMARY: explicit fromStatus enables the WHERE-clause guard without a pre-read round-trip and cleanly distinguishes `DecisionNotFoundError` from `OptimisticConcurrencyError`. Satisfies the spec's intent (optimistic-concurrency UPDATE with WHERE guard) more rigorously than the original signature. |
| 4 | `decisions.falsification_criterion` NOT NULL and `resolve_by` NOT NULL; unit tests cover every illegal transition and the optimistic-concurrency race. | ✓ VERIFIED | schema.ts L220 (`falsificationCriterion ... notNull()`), L222 (`resolveBy ... notNull()`). Migration 0002 L32-33 declares both NOT NULL. Live DB `information_schema.columns` confirms `is_nullable=NO` for both (Plan 03 smoke-query output). `schema.test.ts` 2 NOT-NULL INSERT-throws cases GREEN. `lifecycle.test.ts` full (fromStatus × toStatus) cartesian enumeration GREEN. `concurrency.test.ts` 1/1 GREEN — Promise.allSettled race on shared pool yields exactly one fulfilled + one `OptimisticConcurrencyError` + one event row. |
| 5 | A new `DECISION` value is added to the epistemic-tag enum so decision summaries cannot be picked up by the commitment trigger. | ✓ VERIFIED | schema.ts L33 (`'DECISION'` appended to `epistemicTagEnum`). Migration 0003 `ALTER TYPE ... ADD VALUE IF NOT EXISTS 'DECISION'`. Live DB: `'DECISION' = ANY(enum_range(NULL::epistemic_tag)::text[])` → `t`. `schema.test.ts` LIFE-06 case GREEN. `contradiction-integration.test.ts` 8/8 GREEN (no regression on existing epistemic_tag consumers). |

**Score:** 5/5 roadmap success criteria verified.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/decisions/errors.ts` | 3 distinct error classes with Object.setPrototypeOf | ✓ VERIFIED | 37 lines; InvalidTransitionError, OptimisticConcurrencyError, DecisionNotFoundError. All 3 imported by lifecycle.ts + re-exported via index.ts. |
| `src/decisions/lifecycle.ts` | LEGAL_TRANSITIONS + transitionDecision chokepoint | ✓ VERIFIED | 115 lines; LEGAL_TRANSITIONS matches D-04 verbatim; transitionDecision uses UPDATE-first-then-INSERT atomic tx with WHERE-clause guard. Imported by `__tests__/lifecycle.test.ts` + re-exported via index.ts. |
| `src/decisions/regenerate.ts` | regenerateDecisionFromEvents replay function | ✓ VERIFIED | 67 lines; replays `(created_at ASC, sequence_no ASC)`, returns last snapshot with 9-column timestamptz rehydration + defensive bigint coercion. Imported by `regenerate.test.ts` + re-exported. |
| `src/decisions/capture-state.ts` | getActiveDecisionCapture read helper | ✓ VERIFIED | 22 lines; read-only (no insert/update/delete). Imported by `capture-state.test.ts` + re-exported. |
| `src/decisions/index.ts` | Barrel re-export surface for Phases 14-18 | ✓ VERIFIED | 22 lines; re-exports all Phase 13 public API. |
| `src/db/schema.ts` additions | 3 pgEnums + 3 tables + DECISION on epistemicTag | ✓ VERIFIED | decisionStatusEnum (L65), decisionCaptureStageEnum (L76), decisionEventTypeEnum (L87), decisions (L210), decisionEvents (L251), decisionCaptureState (L276), 'DECISION' appended (L33). |
| `src/db/migrations/0002_decision_archive.sql` | CREATE TYPEs + 3 tables + FK + 3 indexes | ✓ VERIFIED | 54 lines; 3 CREATE TYPE, 3 CREATE TABLE, FK on decision_events.decision_id, 3 indexes including sweep index `decisions_status_resolve_by_idx` and replay-tiebreaker index. Handwritten `sequence_no bigserial NOT NULL`. |
| `src/db/migrations/0003_add_decision_epistemic_tag.sql` | ALTER TYPE ADD VALUE 'DECISION' | ✓ VERIFIED | 1 line; mirrors 0001 precedent for ADD VALUE isolation. |
| Test suite (6 files) | RED → GREEN coverage for all 5 LIFE reqs | ✓ VERIFIED | schema.test.ts (9), lifecycle.test.ts (65), regenerate.test.ts (3), concurrency.test.ts (1), capture-state.test.ts (3), chokepoint-audit.test.ts (2). Total 83/83 GREEN against live Docker PG. |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `lifecycle.ts` | `errors.ts` | import {InvalidTransitionError, OptimisticConcurrencyError, DecisionNotFoundError, DecisionStatusLiteral} | ✓ WIRED | L4-9. All 3 error classes thrown in lifecycle.ts (L69, L96, L98). |
| `lifecycle.ts` | `schema.ts decisions/decisionEvents` | import {decisions, decisionEvents} | ✓ WIRED | L2. UPDATE on decisions (L85), INSERT on decisionEvents (L104). |
| `lifecycle.ts` | `db/connection.ts` | import {db} | ✓ WIRED | L1. `db.transaction(...)` at L75 wraps the two-statement chokepoint. |
| `regenerate.ts` | `schema.ts decisionEvents` | import {decisionEvents, decisions} | ✓ WIRED | L2. SELECT on decisionEvents with decision_id WHERE (L61-63). |
| `capture-state.ts` | `schema.ts decisionCaptureState` | import {decisionCaptureState} | ✓ WIRED | L2. SELECT with chatId WHERE (L18-19). |
| `index.ts` | All 4 module files | Re-exports | ✓ WIRED | L10-22. Barrel exposes transitionDecision, LEGAL_TRANSITIONS, 3 error classes, regenerateDecisionFromEvents, getActiveDecisionCapture. |
| `lifecycle.ts` chokepoint | DB append-only guarantee | atomic `db.transaction` wrapping UPDATE + INSERT | ✓ WIRED | L75-114. If INSERT fails, UPDATE rolls back. No placeholder → no `.update(decisionEvents)` anywhere. |
| Migration 0002/0003 | Live Docker PG | `scripts/test.sh` applies 0002 + 0003 after 0000 + 0001 | ✓ WIRED | Plan 03 SUMMARY confirms clean-slate apply in order; verified live at this verification run. |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `transitionDecision()` | `updated[0]` (snapshot for event) | UPDATE … RETURNING * on live `decisions` row | ✓ Real post-update row (no placeholder) | ✓ FLOWING |
| `regenerateDecisionFromEvents()` | `events[last].snapshot` | SELECT on `decision_events` ordered by created_at/sequence_no | ✓ Real jsonb snapshot from DB | ✓ FLOWING |
| `getActiveDecisionCapture()` | rows[0] | SELECT on `decision_capture_state` WHERE chat_id | ✓ Real row or null | ✓ FLOWING |

No hollow props, no hardcoded empties. Tests exercise real DB round-trips end-to-end.

---

## Behavioral Spot-Checks (Live Docker PG)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 3 decision tables exist in live DB | `psql -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'decision%'"` | 3 rows: decision_capture_state, decision_events, decisions | ✓ PASS |
| decision_status enum has 8 values | `psql -c "SELECT unnest(enum_range(NULL::decision_status))"` | 8 rows incl. open-draft/withdrawn/stale/abandoned | ✓ PASS |
| epistemic_tag contains DECISION | `psql -c "SELECT 'DECISION' = ANY(enum_range(NULL::epistemic_tag)::text[])"` | t | ✓ PASS |
| Phase 13 test suite | `DATABASE_URL=... npx vitest run --no-file-parallelism src/decisions/__tests__/` | 6 files, 83 tests, all GREEN in 2.64s | ✓ PASS |
| Chokepoint: no production `.update(decisionEvents)` | `grep -rE "\.update\(\s*decisionEvents\s*\)" src/ --include="*.ts" \| grep -v __tests__` | 0 matches | ✓ PASS |
| Chokepoint: no production `.delete(decisionEvents)` | `grep -rE "\.delete\(\s*decisionEvents\s*\)" src/ --include="*.ts" \| grep -v __tests__` | 0 matches | ✓ PASS |
| Chokepoint: sole `.update(decisions)` is lifecycle.ts | `grep -rnE "\.update\(decisions\)" src/ --include="*.ts"` | 1 match (lifecycle.ts L85) + 1 string literal in audit test | ✓ PASS |
| Full suite (per Plan 05 evidence) | `npm test` via Plan 05 documented run | 883/887 — 4 pre-existing orthogonal failures (3 live-LLM 401s, 1 language-baseline); all Phase 13 work GREEN | ✓ PASS |

---

## Requirements Coverage Matrix

| Req ID  | Description (REQUIREMENTS.md) | Source Plan(s) | Implementation Evidence | Status |
|---------|-------------------------------|----------------|-------------------------|--------|
| LIFE-01 | 3 tables + 2 pgEnums + auto-migrated against Docker PG | 13-01, 13-02, 13-03 | schema.ts + migrations 0002/0003 applied live; `schema.test.ts` 9/9 GREEN | ✓ SATISFIED |
| LIFE-02 | Append-only event log with replayable projection | 13-01, 13-04, 13-05 | `lifecycle.ts` INSERT-per-transition in atomic tx; `regenerate.ts` last-snapshot replay; `regenerate.test.ts` 3/3 + `lifecycle.test.ts` event-append assertions GREEN | ✓ SATISFIED |
| LIFE-03 | Chokepoint `transitionDecision` is sole status mutator; illegal transitions + concurrency race throw distinguishably | 13-01, 13-04, 13-05 | `lifecycle.ts` (only production `.update(decisions)` call); `chokepoint-audit.test.ts` 2/2 GREEN; `lifecycle.test.ts` 65/65 (illegal enum); `concurrency.test.ts` 1/1 (OptimisticConcurrencyError race) | ✓ SATISFIED |
| LIFE-04 | `falsification_criterion` and `resolve_by` NOT NULL enforced at DB | 13-01, 13-02, 13-03 | schema.ts L220 + L222 `.notNull()`; migration 0002 declares NOT NULL; live DB `is_nullable=NO` confirmed; `schema.test.ts` 2 NOT-NULL INSERT-throws GREEN | ✓ SATISFIED |
| LIFE-06 | `DECISION` in epistemic_tag enum (protect decision summaries from commitment trigger) | 13-01, 13-02, 13-03 | schema.ts L33 + migration 0003 ADD VALUE; live DB confirms; schema.test.ts LIFE-06 case GREEN; `contradiction-integration.test.ts` 8/8 GREEN (no regression) | ✓ SATISFIED |

**Orphaned requirements:** None. Phase 13's declared set `{LIFE-01, LIFE-02, LIFE-03, LIFE-04, LIFE-06}` exactly matches ROADMAP.md L51 and the coverage matrix at L155 (`LIFE (6) | 01,02,03,04,06 | 05 ...`). LIFE-05 is intentionally deferred to Phase 14 per the roadmap's coverage matrix.

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No production-code anti-patterns detected. |

**Scans run:**
- TODO/FIXME/XXX/HACK/PLACEHOLDER in src/decisions/*.ts + src/db/migrations/0002_decision_archive.sql + 0003 — 0 matches.
- "placeholder|coming soon|not yet implemented|not available" (i) — 0 matches in production code.
- `return null|return \{\}|return \[\]|=> \{\}` — 1 match in `capture-state.ts` L21 (`rows[0] ?? null`), which is the correct null-return contract for an absent-row read helper (not a stub).
- `console\.log` stub implementations — 0 matches.
- Hardcoded empty state rendering empties — N/A (no UI in this phase).

**Note:** `capture-state.ts` docstring explicitly defers write helpers to Phase 14 ("Phase 14 capture conversation will add mutation helpers"). This is a documented deferred responsibility with a named owner, not a stub. The capture-state write path is intentionally out of Phase 13 scope.

---

## Threat-Model Coverage (from 13-PLAN threat_model spec)

| Threat ID | Mitigation | Evidence |
|-----------|------------|----------|
| T-13-06 (tamper: retroactive event edits) | `decision_events` structurally append-only — no UPDATE/DELETE path exists | `chokepoint-audit.test.ts` 2/2 GREEN; grep confirms 0 production `.update(decisionEvents)`/`.delete(decisionEvents)` |
| T-13-07 (clock-skew non-determinism) | `(created_at ASC, sequence_no ASC)` ordering with bigserial tiebreaker | `regenerate.test.ts` tied-timestamp case GREEN — deterministic ordering on `created_at` collision |
| T-13-08 (concurrent-race DoS / split-brain) | Atomic UPDATE-first-then-INSERT tx + optimistic WHERE-clause guard | `concurrency.test.ts` GREEN — shared-pool Promise.allSettled yields exactly one winner + one `OptimisticConcurrencyError` + one event row |

---

## Deviations from Plan Spec — Reviewed

Three deviations documented across 13-02/03/04/05 SUMMARYs. All reviewed:

1. **`transitionDecision` 4-arg signature (explicit `fromStatus`)** vs roadmap's stated 3-arg. Rationale (13-02/04 SUMMARYs): enables the WHERE-clause optimistic-concurrency guard without a pre-read round-trip AND lets the chokepoint distinguish `DecisionNotFoundError` from `OptimisticConcurrencyError` cleanly. The roadmap's success-criterion INTENT (UPDATE with WHERE-clause guard on expected status; throw on illegal) is fully satisfied — the signature is stricter, not looser. Downstream phases (14-18) are on notice via the barrel index.ts. **Accepted as intentional architectural improvement.**

2. **`sequence_no bigserial` handwritten override** in 0002 vs drizzle-generated `bigint`. Rationale (13-02 SUMMARY): auto-populates on insert so `lifecycle.ts` never needs to supply it. Paired with `.default(sql\`nextval(...)\`)` fix in schema.ts (13-05 Rule-2 auto-fix) to make TS aware. Matches live DB schema. **Accepted.**

3. **Removal of stray `ALTER TYPE ... conversation_mode ADD VALUE 'PHOTOS'`** that drizzle-kit re-emitted into 0002 (already in 0001). Rationale: idempotent re-apply would fail cold-start. Correct per D016 (auto-migration idempotency). **Accepted.**

No architectural deviations that compromise the phase goal.

---

## Human Verification Required

None. Every success criterion was verified programmatically via grep + live DB queries + Docker-PG-backed integration tests (83/83 GREEN).

The one manual-only item from 13-VALIDATION.md §"Manual-Only Verifications" (full cold-start auto-migration idempotency via `docker compose down -v && up && npm start`) is a defense-in-depth check for D016 — the programmatic evidence (Plan 03 clean-slate apply of all 4 migrations in order; live DB schema intact at verification time; scripts/test.sh re-applies 0002/0003 on every CI run) is sufficient to mark Phase 13 passed. Cold-boot rehearsal can be picked up as a pre-release smoke gate later in the milestone without blocking Phase 14 start.

---

## Summary

Phase 13 achieves its goal in full. Every ROADMAP success criterion has direct DB-level or code-level evidence. The chokepoint invariant (sole path for `decisions.status` mutation) is enforced by both code (`lifecycle.ts` is the only `.update(decisions).set(...)` call site in production `src/`) and an automated static audit (`chokepoint-audit.test.ts`) that runs on every CI build. The append-only invariant for `decision_events` is enforced structurally — no UPDATE or DELETE path exists anywhere in production code. The full 83-test Phase 13 suite is GREEN against a live `pgvector/pgvector:pg16` Docker Postgres with all four migrations applied. Phase 14 can build on this foundation without structural risk.

---

_Verified: 2026-04-15T17:15:00Z_
_Verifier: Claude (gsd-verifier)_
