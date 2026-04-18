---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: M008 Episodic Consolidation
status: executing
stopped_at: "Phase 21 COMPLETE — all 4 plans shipped, all 12 CONS-XX requirements satisfied. Plan 21-04 delivered runConsolidate(date) end-to-end orchestrator in src/episodic/consolidate.ts (10-step flow: idempotency SELECT → entry-count gate → parallel sources fetch → assembleConsolidationPrompt → anthropic.messages.parse → runtime importance floors → Zod re-validation → ON CONFLICT insert → notifyConsolidationError on catch) + notifyConsolidationError Telegram error notifier + 12 integration tests (CONS-01/02/03/06/07/12). Docker gate 901/61/962 (+12 vs 889 baseline, zero regressions). Next: Phase 22 (CRON-01 cron registration in src/index.ts + RETR-01..06 retrieval routing)."
last_updated: "2026-04-18T21:23:06Z"
last_activity: 2026-04-18 -- Phase 21 Plan 04 complete; Phase 21 COMPLETE
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 16
  completed_plans: 7
  percent: 44
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — v2.2 M008 Episodic Consolidation milestone started)

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.
**Current focus:** Phase 21 — Consolidation Engine

## Current Position

Phase: 21 (Consolidation Engine) — COMPLETE
Plan: 4 of 4 — all complete
Next: Phase 22 (Cron + Retrieval Routing) — CRON-01 registers `cron.schedule(config.episodicCron, () => runConsolidate(yesterdayDate), { timezone: config.proactiveTimezone })` in `src/index.ts` alongside the existing proactive sweep + sync crons. CRON-02 asserts DST safety. RETR-01..06 wires recency-based + intent-based retrieval routing in `src/pensieve/retrieve.ts` and INTERROGATE-mode date-anchored summary injection. RETR-05/06 audits ensure summary text is provably absent from Known Facts and pensieve_embeddings.
Status: Phase 21 COMPLETE; ready to execute Phase 22 (5 plans pending)
Last activity: 2026-04-18 -- Phase 21 Plan 04 complete (consolidate.ts runConsolidate + notify.ts + 12 integration tests; CONS-01/02/03/06/07/12 fully closed; Phase 21 COMPLETE)

```
Progress: [████████░░░░░░░░░░░░] 44% (7/16 plans)
```

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)

## Phase Summary

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 20 | Schema + Tech Debt | TD-01, EPI-01–04 (5 reqs) | **COMPLETE** (3/3 plans — TD-01 resolved, EPI-01..04 shipped, test coverage live) |
| 21 | Consolidation Engine | CONS-01–12 (12 reqs) | **COMPLETE** (4/4 plans — Plan 01 SDK + preamble; Plan 02 prompt assembler + 20 tests; Plan 03 day-bounded sources + 12 tests; Plan 04 runConsolidate + notify + 12 tests; all 12 CONS-XX requirements satisfied) |
| 22 | Cron + Retrieval Routing | CRON-01–02, RETR-01–06 (8 reqs) | Planned (5 plans) |
| 23 | Test Suite + Backfill + /summary | TEST-15–22, OPS-01, CMD-01 (10 reqs) | Not started |

**Total:** 35/35 requirements mapped. Coverage: 100%.

## Accumulated Context

### Decisions in force for M008

Full log in PROJECT.md Key Decisions table. Most load-bearing going into episodic consolidation:

- D004 append-only Pensieve — M008 must consume Pensieve without mutating it; consolidation only writes to `episodic_summaries`
- D018/D019 no skipped tests, explicit production deploy
- D022 M006 constitutional preamble is a floor — must be explicitly injected into consolidation prompt (cron runs outside the engine, preamble does NOT auto-apply)
- D023/D032 live integration tests for any prompt-level behavior — TEST-22 is the live anti-flattery gate against real Sonnet
- D024 four-layer anti-sycophancy — consolidation prompts must not produce flattering summaries that compound over weeks
- D027 The Hard Rule — forbidden in consolidation prompts
- D031 structured facts vs interpretation — summary text must never enter Known Facts block (RETR-05) or pensieve_embeddings (RETR-06)
- M007 decisions archive is a read-only source stream for episodic summaries (CONS-08); no decisions module API calls, direct DB query only
- M002 contradictions are a read-only source stream (CONS-09); contradiction pairs must be preserved verbatim, not smoothed

### Critical Implementation Notes

- **TECH-DEBT-19-01 is Phase 20's first task** — drizzle-kit meta snapshot regeneration for migrations 0001/0003 must happen before migration 0005 is generated. Without this, `drizzle-kit generate` produces a corrupt chain.
- **Consolidation prompt is the highest-risk surface** — Phase 21 is isolated so it can be iterated against real Sonnet before downstream phases depend on it. The M006 constitutional preamble must be explicitly present in the prompt string (assert by unit test — CONS-04).
- **Two-dimensional retrieval routing** — both dimensions must ship in Phase 22: (1) recency boundary (≤7 days raw, >7 days summary) AND (2) verbatim-fidelity escape (raw always regardless of age when keywords present). High-importance raw descent (importance >= 8) is a third rule, not optional.
- **Importance rubric calibration** — full-range ground-truth labels for the TEST-16 fixture (r > 0.7 Pearson) must include scores from the tails (1–2 and 9–10 must each appear at least once). Labels are set before the fixture is written.
- **Docker test gate** — **901 tests currently passing** (Plan 21-04 lifted from 889 via +12 consolidate.test.ts assertions; Plan 21-03 lifted from 877 via +12 sources.test.ts assertions; Plan 21-02 lifted from 857 via +20 prompts.test.ts assertions; Plan 21-01 lifted from 853 via +4 CONSTITUTIONAL_PREAMBLE export assertions; prior Plan 20-03 lifted from 843). Phase 22+ must not regress this floor. No regressions at any phase boundary.

### Resolved Scoping Decisions (from research open questions)

- Cron timing: **23:00 same-day** in `config.proactiveTimezone` (EPI-04 default `"0 23 * * *"`)
- `/summary [date]` command: **ships in M008** (CMD-01 in Phase 23)
- `/resummary` command: **deferred** to EPI-FUTURE-01
- Backfill script: **ships in M008** (OPS-01 in Phase 23)

### Pending Todos (carried from v2.1)

- Human UAT pass on 12 deferred items from v2.1 (live Telegram feel, ACCOUNTABILITY tone quality, `/decisions` dashboard format, FR/RU localization).
- Run TEST-13 + TEST-14 locally with `ANTHROPIC_API_KEY` set to verify live Sonnet ACCOUNTABILITY + Haiku vague-prediction resistance.

### Blockers/Concerns

None. Research confidence: HIGH across all areas (stack, features, architecture, pitfalls).

## Session Continuity

Last session: 2026-04-18T21:23:06Z -- Phase 21 Plan 04 complete; **Phase 21 COMPLETE** (`src/episodic/consolidate.ts` runConsolidate(date) end-to-end orchestrator + `src/episodic/notify.ts` notifyConsolidationError + 12 deterministic integration tests in `src/episodic/__tests__/consolidate.test.ts`; CONS-01/02/03/06/07/12 fully closed; idempotency two-layer pre-flight SELECT + ON CONFLICT DO NOTHING; runtime importance floors with REAL_DECISION_STATES filter excluding withdrawn/stale/abandoned/open-draft; localized zod/v4 mirror schema for SDK helper compatibility; Telegram error notification mirroring sync/scheduler.ts pattern; Docker gate 901/61/962 = +12 passing vs 889 Plan 21-03 baseline, zero regressions, zero new failures)
Stopped at: Phase 21 COMPLETE — all 4 plans shipped, all 12 CONS-XX requirements satisfied. runConsolidate is callable; cron registration is Phase 22 CRON-01 scope. Docker gate 901/61/962. Next: Phase 22 (CRON-01 cron registration in src/index.ts + RETR-01..06 retrieval routing + RETR-05/06 audits for Known Facts and pensieve_embeddings boundary).
Resume file: Start Phase 22. Phase 21 delivered the full consolidation engine: runConsolidate(date) is the callable entrypoint, idempotent under any concurrency model, returns discriminated `{ inserted, id } | { skipped: 'existing' | 'no-entries' } | { failed, error }`. Phase 22 wires it into the cron + adds retrieval routing. Phase 23 (TEST-15..22 + OPS-01 + CMD-01) covers the synthetic 14-day fixture, live anti-flattery test against real Sonnet, backfill operator script, and `/summary [YYYY-MM-DD]` Telegram command. See .planning/phases/21-consolidation-engine/21-04-SUMMARY.md for the full Plan 04 summary.

## Known Tech Debt

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing.
  - See [milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md](milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md) for rationale.
  - **Status: RESOLVED** in Phase 20 Plan 01 (2026-04-18) via clean-slate iterative replay (CONTEXT.md D-01). drizzle-kit generate against freshly-migrated Docker now prints "No schema changes, nothing to migrate" — the full chain 0000→0004 is byte-accurate.
  - Resolution applied: scripts/regen-snapshots.sh (clean-slate iterative replay on a throwaway Docker volume at port 5434 + temp drizzle-kit workspace per snapshot). The Plan 19-04 Option A hint in an earlier version of this file ("drizzle-kit generate will implicitly regenerate") was wrong — drizzle-kit does NOT backfill meta for already-applied entries (empirically verified in Plan 19-04 SUMMARY: "No schema changes, nothing to migrate" was the observed output of Option A).
  - **Audit disposition:** v2.1 milestone audit marks this as PARTIAL, not FAIL — does not block v2.1 requirement satisfaction. Resolved in Phase 20.
