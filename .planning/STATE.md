---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: M008 Episodic Consolidation
status: executing
stopped_at: Phase 20 Plan 02 complete — episodic_summaries migration 0005 + Zod types + episodicCron config live; Docker gate green (843/904, zero regressions)
last_updated: "2026-04-18T15:50:00.000Z"
last_activity: 2026-04-18 -- Phase 20 Plan 02 (EPI-01..04) complete; migration 0005 applied; drizzle no-op confirmed
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 16
  completed_plans: 2
  percent: 13
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — v2.2 M008 Episodic Consolidation milestone started)

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.
**Current focus:** Phase 20 — Schema + Tech Debt

## Current Position

Phase: 20 (Schema + Tech Debt) — EXECUTING
Plan: 3 of 3 (Plans 01 + 02 complete — TD-01 resolved; episodic schema + Zod + config live)
Next: `/gsd-execute-phase 20` (continue with Plan 03: Zod + schema integration tests + Docker gate)
Status: Executing Phase 20
Last activity: 2026-04-18 -- Phase 20 Plan 02 (EPI-01..04) complete; migration 0005 + Zod three-layer schema + config.episodicCron shipped; D-03 gate + \d episodic_summaries + tsc + full Docker suite all green

```
Progress: [██░░░░░░░░░░░░░░░░░░] 13% (2/16 plans)
```

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)

## Phase Summary

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 20 | Schema + Tech Debt | TD-01, EPI-01–04 (5 reqs) | Executing (2/3 plans — TD-01 + EPI-01..04 complete; tests pending) |
| 21 | Consolidation Engine | CONS-01–12 (12 reqs) | Planned (4 plans) |
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
- **Docker test gate** — 152 tests currently passing. Phase 23 must deliver a higher count. No regressions at any phase boundary.

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

Last session: 2026-04-18 — Phase 20 Plan 02 complete (episodic_summaries migration 0005 + three-layer Zod schema in src/episodic/types.ts + config.episodicCron; drizzle no-op against fully-migrated Docker; \d episodic_summaries shows 9 cols + PK + 3 spec indexes + CHECK; 843/904 Docker tests passing — parity with Plan 20-01 baseline, zero regressions)
Stopped at: Phase 20 Plan 02 complete — next is Plan 03 (Zod + schema integration tests + Docker gate raise)
Resume file: .planning/phases/20-schema-tech-debt/20-03-PLAN.md

## Known Tech Debt

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing.
  - See [milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md](milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md) for rationale.
  - **Status: RESOLVED** in Phase 20 Plan 01 (2026-04-18) via clean-slate iterative replay (CONTEXT.md D-01). drizzle-kit generate against freshly-migrated Docker now prints "No schema changes, nothing to migrate" — the full chain 0000→0004 is byte-accurate.
  - Resolution applied: scripts/regen-snapshots.sh (clean-slate iterative replay on a throwaway Docker volume at port 5434 + temp drizzle-kit workspace per snapshot). The Plan 19-04 Option A hint in an earlier version of this file ("drizzle-kit generate will implicitly regenerate") was wrong — drizzle-kit does NOT backfill meta for already-applied entries (empirically verified in Plan 19-04 SUMMARY: "No schema changes, nothing to migrate" was the observed output of Option A).
  - **Audit disposition:** v2.1 milestone audit marks this as PARTIAL, not FAIL — does not block v2.1 requirement satisfaction. Resolved in Phase 20.
