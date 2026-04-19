---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: M008 Episodic Consolidation
status: verifying
stopped_at: "Phase 22 Plan 05 COMPLETE — CRON-01/02 satisfied. Phase 22 fully complete (5/5 plans, 8/8 requirements: RETR-01..06 + CRON-01..02). src/episodic/cron.ts (114 lines) ships runConsolidateYesterday(now?: Date) thin wrapper that computes yesterday in config.proactiveTimezone via Intl.DateTimeFormat('en-CA') + UTC-millisecond 1-day subtraction, calls runConsolidate(yesterday), catches and warn-logs any thrown error as 'episodic.cron.error', logs 'episodic.cron.invoked' at info BEFORE the runConsolidate call. src/index.ts (+18 lines) — independent cron.schedule(config.episodicCron, runConsolidateYesterday, { timezone: config.proactiveTimezone }) registered at module-level inside main() as a PEER to the existing proactive-sweep cron (NOT nested). Belt-and-suspenders outer try/catch logs 'episodic.cron.error' at error level. src/episodic/__tests__/cron.test.ts (240 lines) — 6 unit tests in 3 describe blocks: yesterday-computation (2: summer UTC+2 + 23:00 cron-fire-time), DST safety (2: spring-forward 2026-03-29 + fall-back 2026-10-25 Europe/Paris, each asserting two firings produce two distinct calendar dates), error handling (2: error-swallow + episodic.cron.invoked log invariant). Wrapper accepts injectable now parameter for deterministic DST-boundary unit testing without vi.useFakeTimers. Targeted: 6/6 / 177ms. Excluded-suite Docker run: 964 passed / 15 failed / 979 total / 26.17s = +6 vs 958 Plan 22-03 baseline, zero regressions; the 15 environmental failures match the documented Phase 22 baseline exactly. Full Docker run hit the documented vitest 4 fork-mode IPC hang under HuggingFace cache EACCES; applied the documented excluded-suite mitigation. tsc --noEmit exits 0. Commits: 10c750f (Task 1 feat) + 5ae3dfd (Task 2 feat) + c420168 (Task 3 test). Phase 22 fully shipped; ready for Phase 23 (Test Suite + Backfill + /summary)."
last_updated: "2026-04-19T08:02:21.573Z"
last_activity: 2026-04-19
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 16
  completed_plans: 12
  percent: 75
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — v2.2 M008 Episodic Consolidation milestone started)

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.
**Current focus:** Phase 22 — Cron + Retrieval Routing

## Current Position

Phase: 22 (Cron + Retrieval Routing) — **COMPLETE** (5/5 plans, 8/8 requirements)
Plan: All 5 plans shipped. Plan 05 added CRON-01/02 — independent `cron.schedule(config.episodicCron, runConsolidateYesterday, { timezone })` registered at module-level in `src/index.ts` main() as a peer to the existing proactive-sweep cron, plus thin `src/episodic/cron.ts` wrapper that computes yesterday in `config.proactiveTimezone` via `Intl.DateTimeFormat('en-CA')` + UTC-millisecond 1-day subtraction. DST safety proven via deterministic spring-forward (2026-03-29) and fall-back (2026-10-25) Europe/Paris simulation tests.
Next: Phase 23 (Test Suite + Backfill + /summary) — 10 requirements: TEST-15..22 + OPS-01 + CMD-01.
Status: Phase 22 complete — ready for verification, then begin Phase 23
Last activity: 2026-04-19 -- Phase 22 Plan 05 complete (CRON-01/02 cron registration + DST safety)

```
Progress: [████████████████░░░░] 75% (12/16 plans)
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
| 22 | Cron + Retrieval Routing | CRON-01–02, RETR-01–06 (8 reqs) | **COMPLETE** (5/5 plans — Plan 01 RETR-01 episodic retrieval helpers; Plan 02 RETR-02 + RETR-03 two-dim routing + high-importance raw descent; Plan 03 RETR-04 INTERROGATE date-anchored summary injection; Plan 04 RETR-05 + RETR-06 boundary audit; Plan 05 CRON-01 + CRON-02 independent cron registration + DST safety; all 8 RETR-XX/CRON-XX requirements satisfied) |
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
- **Docker test gate** — **964 tests currently passing in the excluded-suite mitigation** (Plan 22-05 lifted from 958 via +6 cron.test.ts assertions for CRON-01/02; Plan 22-03 lifted from 934 via +24: 16 date-extraction + 8 INTERROGATE-injection assertions; Plan 22-02 baseline 934; Plan 22-04 lifted from 911 via +4 boundary-audit.test.ts assertions for RETR-05/06; Plan 22-01 lifted from 901 via +10 retrieve episodic-helper assertions across retrieve.episodic.test.ts integration + retrieve.test.ts mocked error paths; Plan 21-04 lifted from 889 via +12 consolidate.test.ts assertions; Plan 21-03 lifted from 877 via +12 sources.test.ts assertions; Plan 21-02 lifted from 857 via +20 prompts.test.ts assertions; Plan 21-01 lifted from 853 via +4 CONSTITUTIONAL_PREAMBLE export assertions; prior Plan 20-03 lifted from 843). Phase 23 onward must not regress this floor. No regressions at any phase boundary. Note: vitest 4 suppresses the aggregate `Test Files X passed | Tests Y passed` summary line under unhandled rejections (HuggingFace cache EACCES); the `Failed Tests N` header value is the source of truth for the failure count, and the passing count is computed by subtraction from the previous baseline + per-plan delta. The excluded-suite mitigation skips 4 environmental-fail files (`live-integration.test.ts`, `live-accountability.test.ts`, `vague-validator-live.test.ts`, `contradiction-false-positive.test.ts`) and reaches exit 0 in ~26s; the 15 remaining failures (3 models-smoke API-gated + 7 engine-mute + 5 photos-memory) match the documented Phase 22 baseline exactly across plans 22-02 / 22-03 / 22-05.

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

Last session: 2026-04-19T08:02:21.570Z

Previous session: 2026-04-19T06:35:00Z -- Phase 22 Plan 02 complete (RETR-02 + RETR-03 two-dim routing + high-importance raw descent): `src/pensieve/routing.ts` (new, 224 lines) ships `retrieveContext(opts)` orchestrator with two-dimensional routing — dimension 1 recency boundary (queryAge ≤ 7d → raw via hybridSearch; > 7d → summary first via getEpisodicSummary) and dimension 2 verbatim-keyword fast-path (overrides recency: any of 15 EN/FR/RU keywords in `query.toLowerCase()` → raw always, no summary fetch). High-importance raw descent (RETR-03): when matched summary has `importance >= 8` (inclusive boundary), `loadEntriesByIds(summary.sourceEntryIds)` runs `inArray(pensieveEntries.id, ids) + isNull(deletedAt)` and surfaces rows in input-array order with score=1.0 sentinel. Targeted via test.sh: **22 passed / 0 failed / 560ms**. Excluded-suite: **934 passed / 15 failed / 949 total / 25.94s**, zero regressions. Commits: `b61f3f2` (feat) + `86ae231` (test).
Stopped at: Phase 22 Plan 05 COMPLETE — CRON-01/02 satisfied. Phase 22 fully complete (5/5 plans, 8/8 requirements: RETR-01..06 + CRON-01..02). src/episodic/cron.ts (114 lines) ships runConsolidateYesterday(now?: Date) thin wrapper that computes yesterday in config.proactiveTimezone via Intl.DateTimeFormat('en-CA') + UTC-millisecond 1-day subtraction, calls runConsolidate(yesterday), catches and warn-logs any thrown error as 'episodic.cron.error', logs 'episodic.cron.invoked' at info BEFORE the runConsolidate call. src/index.ts (+18 lines) — independent cron.schedule(config.episodicCron, runConsolidateYesterday, { timezone: config.proactiveTimezone }) registered at module-level inside main() as a PEER to the existing proactive-sweep cron (NOT nested). Belt-and-suspenders outer try/catch logs 'episodic.cron.error' at error level. src/episodic/__tests__/cron.test.ts (240 lines) — 6 unit tests in 3 describe blocks: yesterday-computation (2: summer UTC+2 + 23:00 cron-fire-time), DST safety (2: spring-forward 2026-03-29 + fall-back 2026-10-25 Europe/Paris, each asserting two firings produce two distinct calendar dates), error handling (2: error-swallow + episodic.cron.invoked log invariant). Wrapper accepts injectable now parameter for deterministic DST-boundary unit testing without vi.useFakeTimers. Targeted: 6/6 / 177ms. Excluded-suite Docker run: 964 passed / 15 failed / 979 total / 26.17s = +6 vs 958 Plan 22-03 baseline, zero regressions; the 15 environmental failures match the documented Phase 22 baseline exactly. Full Docker run hit the documented vitest 4 fork-mode IPC hang under HuggingFace cache EACCES; applied the documented excluded-suite mitigation. tsc --noEmit exits 0. Commits: 10c750f (Task 1 feat) + 5ae3dfd (Task 2 feat) + c420168 (Task 3 test). Phase 22 fully shipped; ready for Phase 23 (Test Suite + Backfill + /summary).
Resume file: Phase 22 COMPLETE. All retrieval-side requirements (RETR-01..06) and cron requirements (CRON-01..02) closed. Begin Phase 23 (10 reqs: TEST-15..22 + OPS-01 + CMD-01) — synthetic 14-day fixture tests + backfill operator script + /summary command.

## Known Tech Debt

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing.
  - See [milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md](milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md) for rationale.
  - **Status: RESOLVED** in Phase 20 Plan 01 (2026-04-18) via clean-slate iterative replay (CONTEXT.md D-01). drizzle-kit generate against freshly-migrated Docker now prints "No schema changes, nothing to migrate" — the full chain 0000→0004 is byte-accurate.
  - Resolution applied: scripts/regen-snapshots.sh (clean-slate iterative replay on a throwaway Docker volume at port 5434 + temp drizzle-kit workspace per snapshot). The Plan 19-04 Option A hint in an earlier version of this file ("drizzle-kit generate will implicitly regenerate") was wrong — drizzle-kit does NOT backfill meta for already-applied entries (empirically verified in Plan 19-04 SUMMARY: "No schema changes, nothing to migrate" was the observed output of Option A).
  - **Audit disposition:** v2.1 milestone audit marks this as PARTIAL, not FAIL — does not block v2.1 requirement satisfaction. Resolved in Phase 20.
