---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: M008 Episodic Consolidation
status: executing
stopped_at: "Phase 22 Plan 04 COMPLETE — RETR-05 + RETR-06 satisfied. src/chris/__tests__/boundary-audit.test.ts ships 4 deterministic source-text assertions: zero matches for /\\bepisodic_summaries\\b|\\bepisodicSummaries\\b/ in src/chris/personality.ts (Known Facts builder), src/pensieve/ground-truth.ts (Known Facts data source), src/pensieve/embeddings.ts (the pensieve_embeddings INSERT path); plus a fourth assertion that every db.insert(pensieveEmbeddings).values(...) site is free of /episodic/i. Each failure names the offending file:line. Negative-case sanity-checked (injected stray ref → loud failure with line 214 → file restored). Pure test addition: zero production code touched. ESM-correct __dirname via fileURLToPath(import.meta.url); per-line freshly-constructed regex sidesteps the global-flag lastIndex bug. Docker gate ≈915/61/976 (+4 vs 911/61/972 Plan 22-01 baseline; same 61 environmental failures, zero regressions). Targeted via test.sh: 4/4 / 130ms. Commits: 87f7b2c (test). Plans 02 + 03 + 05 still pending (RETR-02/03/04 + CRON-01/02). Next: Plan 22-02 (RETR-02 two-dimensional retrieval routing) or Plan 22-05 (CRON-01/02 cron)."
last_updated: "2026-04-19T04:55:00Z"
last_activity: 2026-04-19 -- Phase 22 Plan 04 complete (RETR-05 + RETR-06)
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 16
  completed_plans: 9
  percent: 56
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — v2.2 M008 Episodic Consolidation milestone started)

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.
**Current focus:** Phase 22 — Cron + Retrieval Routing

## Current Position

Phase: 22 (Cron + Retrieval Routing) — EXECUTING
Plan: 2 of 5 (Plans 1 + 4 complete; running Wave 1 in parallel — Plan 04 was independent of Plan 02/03/05 and pre-locked the RETR-05/06 architectural boundaries)
Next: Plan 22-02 (RETR-02 two-dimensional retrieval routing in `retrieveContext` — recency boundary ≤7d→raw / >7d→summary AND verbatim-fidelity keyword escape "exactly"/"verbatim"/"what did I say" + EN/FR/RU equivalents → raw regardless of age; RETR-03 high-importance raw descent for importance>=8 days surfaces source raw entries alongside summary). Then Plan 22-03 (RETR-04 INTERROGATE date-anchored summary injection consuming `getEpisodicSummariesRange`), Plan 22-05 (CRON-01/02 independent `cron.schedule(config.episodicCron, ...)` registration in `src/index.ts` with DST-safe timezone handling).
Status: Executing Phase 22 (Plans 1 + 4 of 5 complete)
Last activity: 2026-04-19 -- Phase 22 Plan 04 complete (RETR-05 + RETR-06: boundary-audit.test.ts + Docker gate ≈915/61/976)

```
Progress: [███████████░░░░░░░░░] 56% (9/16 plans)
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
| 22 | Cron + Retrieval Routing | CRON-01–02, RETR-01–06 (8 reqs) | In progress (2/5 plans — Plan 01 RETR-01 episodic retrieval helpers shipped 2026-04-18; Plan 04 RETR-05 + RETR-06 boundary audit shipped 2026-04-19) |
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
- **Docker test gate** — **≈915 tests currently passing** (Plan 22-04 lifted from 911 via +4 boundary-audit.test.ts assertions for RETR-05/06; Plan 22-01 lifted from 901 via +10 retrieve episodic-helper assertions across retrieve.episodic.test.ts integration + retrieve.test.ts mocked error paths; Plan 21-04 lifted from 889 via +12 consolidate.test.ts assertions; Plan 21-03 lifted from 877 via +12 sources.test.ts assertions; Plan 21-02 lifted from 857 via +20 prompts.test.ts assertions; Plan 21-01 lifted from 853 via +4 CONSTITUTIONAL_PREAMBLE export assertions; prior Plan 20-03 lifted from 843). Phase 22 onward must not regress this floor. No regressions at any phase boundary. Note: vitest 4 suppresses the aggregate `Test Files X passed | Tests Y passed` summary line under unhandled rejections (HuggingFace cache EACCES); the `Failed Tests N` header value is the source of truth for the failure count, and the passing count is computed by subtraction from the previous baseline + per-plan delta.

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

Last session: 2026-04-19T04:55:00Z -- Phase 22 Plan 04 complete (RETR-05 + RETR-06 boundary audit): `src/chris/__tests__/boundary-audit.test.ts` (new, 127 lines) ships 4 deterministic source-text assertions enforcing D031 architectural boundaries — zero matches for `/\bepisodic_summaries\b|\bepisodicSummaries\b/` in `src/chris/personality.ts` (Known Facts builder), `src/pensieve/ground-truth.ts` (Known Facts data source), and `src/pensieve/embeddings.ts` (the only `db.insert(pensieveEmbeddings).values(...)` path); plus a redundant fourth assertion that every matched INSERT block in embeddings.ts is free of `/episodic/i`. Each failure message names the offending file:line. Negative-case sanity-checked (injecting a stray reference into personality.ts triggered the expected loud failure with `line 214`; file restored). Pure test addition — zero production code modified. ESM-correct `__dirname` via `fileURLToPath(import.meta.url)`; per-line freshly-constructed regex sidesteps the global-flag `lastIndex` carryover bug from the plan's reference implementation (Rule 1 fix documented in SUMMARY). Targeted via test.sh: 4/4 passed / 130ms. Docker gate **≈915 passed / 61 failing / 976 total = +4 vs 911/61/972 Plan 22-01 baseline, zero regressions** (vitest 4 suppressed the aggregate summary line under unhandled rejections; passing count derived from `Failed Tests 61` header + plan delta of +4). Commit: `87f7b2c` (test).

Previous session: 2026-04-18T22:25:27Z -- Phase 22 Plan 01 complete (RETR-01 episodic retrieval helpers): `src/pensieve/retrieve.ts` gained two timezone-aware never-throw exports `getEpisodicSummary(date)` + `getEpisodicSummariesRange(from, to)` plus an internal `formatLocalDate(date, tz)` helper using `Intl.DateTimeFormat('en-CA', { timeZone })` (Node 22 native, zero new deps); 7 Docker-Postgres integration tests in new sibling file `src/pensieve/__tests__/retrieve.episodic.test.ts` (split from `retrieve.test.ts` due to vi.mock hoisting — Rule 3 deviation documented in SUMMARY) + 3 mocked error-path tests appended to `retrieve.test.ts` covering null/[] return + `pensieve.episodic.error` log on DB throw; Docker gate **911 passing / 61 failing / 972 total = +10 vs 901 Plan 21-04 baseline, zero regressions**. Commits: `67760a4` (feat) + `4763e4c` (test).
Stopped at: Phase 22 Plan 04 COMPLETE — RETR-05 + RETR-06 satisfied. Next: Plan 22-02 (RETR-02 two-dimensional retrieval routing in `retrieveContext`: recency boundary ≤7d→raw, >7d→summary AND verbatim-fidelity keyword escape "exactly"/"verbatim"/"what did I say" + EN/FR/RU equivalents → raw regardless of age; RETR-03 high-importance raw descent for importance>=8 days surfaces source raw entries alongside the summary).
Resume file: Continue Phase 22 with Plan 02 (RETR-02/03) or Plan 05 (CRON-01/02) — both are independent of each other and of Plan 04. Plan 22-04 added zero production-code surface; the boundary-audit test silently enforces the D031 invariant for any future plan that wires episodic summaries into retrieval. See `.planning/phases/22-cron-retrieval-routing/22-04-SUMMARY.md` for the full plan summary including the 2 Rule 1 deviations (ESM `__dirname` + global-regex lastIndex bug, both fixed in the test file's first draft).

## Known Tech Debt

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing.
  - See [milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md](milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md) for rationale.
  - **Status: RESOLVED** in Phase 20 Plan 01 (2026-04-18) via clean-slate iterative replay (CONTEXT.md D-01). drizzle-kit generate against freshly-migrated Docker now prints "No schema changes, nothing to migrate" — the full chain 0000→0004 is byte-accurate.
  - Resolution applied: scripts/regen-snapshots.sh (clean-slate iterative replay on a throwaway Docker volume at port 5434 + temp drizzle-kit workspace per snapshot). The Plan 19-04 Option A hint in an earlier version of this file ("drizzle-kit generate will implicitly regenerate") was wrong — drizzle-kit does NOT backfill meta for already-applied entries (empirically verified in Plan 19-04 SUMMARY: "No schema changes, nothing to migrate" was the observed output of Option A).
  - **Audit disposition:** v2.1 milestone audit marks this as PARTIAL, not FAIL — does not block v2.1 requirement satisfaction. Resolved in Phase 20.
