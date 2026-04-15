---
phase: 13
slug: schema-lifecycle-primitives
status: draft
nyquist_compliant: false
wave_0_complete: true
created: 2026-04-15
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Detailed requirements→test map lives in `13-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/decisions/__tests__/` |
| **Full suite command** | `npm test` (invokes `scripts/test.sh` — brings up Docker Postgres, applies migrations, runs vitest) |
| **Integration DB** | `pgvector/pgvector:pg16` on port 5433 via `docker-compose.local.yml` |
| **Estimated runtime** | ~15s quick / ~90s full |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/decisions/__tests__/<touched-test>.test.ts` (<15s warm)
- **After every plan wave:** `npm test` — full Docker PG suite
- **Before `/gsd-verify-work`:** `npm test` green end-to-end; zero skipped; auto-migration runs cleanly on cold start
- **Max feedback latency:** 15 seconds per-task, 90 seconds per-wave

---

## Per-Task Verification Map

See `13-RESEARCH.md` §"Validation Architecture" → "Phase Requirements → Test Map" for the authoritative requirements→test mapping (LIFE-01..06). Per-task IDs below are populated by the planner once PLAN.md files exist.

| Req ID | Behavior | Test File | Status |
|--------|----------|-----------|--------|
| LIFE-01 | 3 new tables + 2 pgEnums exist post-migration | `src/decisions/__tests__/schema.test.ts` | ❌ W0 |
| LIFE-02 | Event-log append per transition/field change | `src/decisions/__tests__/lifecycle.test.ts` | ❌ W0 |
| LIFE-02 | `regenerateDecisionFromEvents()` roundtrip deep-equals projection | `src/decisions/__tests__/regenerate.test.ts` | ❌ W0 |
| LIFE-03 | Chokepoint: only `transitionDecision()` mutates status | `src/decisions/__tests__/chokepoint-audit.test.ts` | ❌ W0 |
| LIFE-03 | All illegal transitions throw `InvalidTransitionError` | `src/decisions/__tests__/lifecycle.test.ts` | ❌ W0 |
| LIFE-03 | Optimistic-concurrency race → `OptimisticConcurrencyError` | `src/decisions/__tests__/concurrency.test.ts` | ❌ W0 |
| LIFE-04 | `falsification_criterion NOT NULL` enforced by DB | `src/decisions/__tests__/schema.test.ts` | ❌ W0 |
| LIFE-04 | `resolve_by NOT NULL` enforced by DB | `src/decisions/__tests__/schema.test.ts` | ❌ W0 |
| LIFE-06 | `DECISION` present in `epistemic_tag` enum | `src/decisions/__tests__/schema.test.ts` | ❌ W0 |
| LIFE-06 | Regression: existing `contradictions`/`pensieve_entries` work | existing suite via `npm test` | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · W0 = Wave 0 stub required*

---

## Wave 0 Requirements

- [x] `src/decisions/__tests__/schema.test.ts` — LIFE-01, LIFE-04, LIFE-06 (asserts against `information_schema` / `pg_enum`)
- [x] `src/decisions/__tests__/lifecycle.test.ts` — LIFE-02, LIFE-03 (happy path + illegal-transition enumeration)
- [x] `src/decisions/__tests__/regenerate.test.ts` — LIFE-02 (replay roundtrip: happy + withdrawn side-path)
- [x] `src/decisions/__tests__/concurrency.test.ts` — LIFE-03 (shared-pool Promise.allSettled race)
- [x] `src/decisions/__tests__/capture-state.test.ts` — helpers around `decision_capture_state`
- [x] `src/decisions/__tests__/chokepoint-audit.test.ts` — grep-based audit ensuring `decisions.status` is not mutated outside `lifecycle.ts`
- [x] Framework install: none — Vitest 4.1.2 already present
- [x] Docker PG harness: already proven by `src/chris/__tests__/contradiction-integration.test.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Auto-migration cold-start idempotency on real env | LIFE-01 (D016) | Full cold-start requires wiping DB + rebooting app; not in CI. | `docker compose -f docker-compose.local.yml down -v && docker compose -f docker-compose.local.yml up -d && npm start` — observe clean boot, no migration errors, enum + tables present. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s per task, < 90s per wave
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
