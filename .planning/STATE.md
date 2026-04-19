---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: M008 Episodic Consolidation
status: executing
stopped_at: "Phase 23 Plan 01 COMPLETE — TEST-15..TEST-21 satisfied (7/7 reqs). src/episodic/__tests__/synthetic-fixture.test.ts (1136 lines) — 9 it() blocks across 6 describe blocks. TEST-15 satisfied by fixture existence; TEST-16 14-day Pearson r > 0.7 with diagnostic per-day breakdown on failure (GROUND_TRUTH_LABELS=[1,2,3,4,4,5,5,6,6,7,7,8,9,10] covers all four CONS-05 bands + both tails per D-05); TEST-17 a/b/c/d covers all four Phase 22 routing branches against retrieveContext (recent / summary-only / verbatim-keyword / high-importance-descent — TEST-17d uses real Pensieve entries via loadEntriesByIds round-trip); TEST-18 simulates 2026-03-08 PST→PDT spring-forward in America/Los_Angeles via UTC instants bucketing identically in Paris+LA, asserts 2 distinct rows; TEST-19 reconciles plan's `{ skipped: true }` example with Phase 21's actual `{ skipped: 'existing' }` discriminated contract via toEqual exact match + asserts mockAnthropicParse.toHaveBeenCalledTimes(1) after second invocation; TEST-20 seeds real decisions row in 'open' state, runtime CONS-06 clamp lifts importance 3→6; TEST-21 seeds real contradictions row with status='DETECTED' (structural proxy for plan's 'confidence>=0.75' — the table has no confidence column; M002 enforces threshold at INSERT), runtime CONS-07 clamp lifts importance 4→7 + asserts both verbatim positions appear via .includes() in summary OR key_quotes (CONS-10). Mocks: anthropic.messages.parse, bot.api.sendMessage, pensieve/retrieve.js (hybridSearch + getEpisodicSummary, importOriginal-preserving — same precedent as routing.test.ts). Targeted vitest: 9/9 passed / 940ms. Excluded-suite Docker run: 973 passed / 15 failed / 988 total / 27.13s = +9 vs 964 Plan 22-05 baseline, zero regressions; the 15 environmental failures match the documented Phase 22 baseline exactly. Full Docker run hit the documented vitest 4 fork-mode IPC hang under HuggingFace cache EACCES; applied the documented excluded-suite mitigation. tsc --noEmit exits 0. Commits: cabae9c (Task 1 scaffold) + 6cbf125 (Task 2 TEST-15+16) + cf83069 (Task 3 TEST-17 4 sub-cases) + 2d401f2 (Task 4 TEST-18 DST) + b592919 (Task 5 TEST-19 idempotency) + 4560632 (Task 6 TEST-20 decision floor) + fd1b63e (Task 7 TEST-21 contradiction floor + verbatim). Two Rule-1 deviations documented: TEST-19 ConsolidateResult shape and TEST-21 contradictions schema reconciliation — both are runtime-contract adaptations the plan explicitly anticipated. Ready for Plan 23-02 (OPS-01 backfill script)."
last_updated: "2026-04-19T08:56:23.623Z"
last_activity: 2026-04-19
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 16
  completed_plans: 13
  percent: 81
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — v2.2 M008 Episodic Consolidation milestone started)

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.
**Current focus:** Phase 23 — Test Suite + Backfill + /summary

## Current Position

Phase: 23 (Test Suite + Backfill + /summary) — EXECUTING
Plan: 2 of 4
Next: Plan 23-02 (OPS-01 backfill script — `scripts/backfill-episodic.ts` with --from/--to ranges, 2s rate-limit, idempotent via CONS-03)
Status: Plan 01 COMPLETE; ready for Plan 02
Last activity: 2026-04-19 — Plan 23-01 complete (TEST-15..TEST-21, +9 tests, zero regressions)

```
Progress: [████████████████░░░░] 81% (13/16 plans)
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
| 23 | Test Suite + Backfill + /summary | TEST-15–22, OPS-01, CMD-01 (10 reqs) | **IN PROGRESS** (1/4 plans — Plan 01 TEST-15..TEST-21 satisfied via 14-day synthetic fixture; Docker gate 973 passing, +9 vs Plan 22-05 baseline 964) |

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

### Plan 23-01 decisions (logged 2026-04-19)

- **TEST-19 ConsolidateResult shape contract** — assert `{ skipped: 'existing' }` exactly (toEqual), NOT `{ skipped: true }` as the plan example suggested. Phase 21's discriminated contract (consolidate.ts L94-98) is `{ inserted | skipped:'existing'|'no-entries' | failed }`. The plan's Task 5 narrative explicitly anticipated this divergence.
- **TEST-21 contradictions schema reconciliation** — status='DETECTED' is the structural proxy for the plan's `confidence >= 0.75` claim. The contradictions table (src/db/schema.ts L195-204) has NO `confidence` column; M002 enforces the threshold at INSERT time and the 'DETECTED' status surfaces only flagged contradictions to the consolidation prompt.
- **TEST-17 retrieve.js mocking** — mocks hybridSearch + getEpisodicSummary at module scope (importOriginal-preserving) to keep routing tests deterministic without the @huggingface/transformers (bge-m3) dependency. Phase 21's runConsolidate does NOT import from retrieve.js so TEST-15/16/18/19/20/21 still exercise the real engine path through real Postgres.
- **TEST-18 DST simulation strategy** — uses Europe/Paris config (file-wide FIXTURE_TZ) and chooses UTC instants that bucket identically to the calendar date in BOTH Paris and America/Los_Angeles. The structural assertion (one row per calendar date across DST boundary) holds without per-test config mocks; the LA-specific cron tz handling is already tested in cron.test.ts (CRON-02 from Phase 22 Plan 05).
- **FIXTURE_CHAT_ID = BigInt(99923)** — distinct from the 9991X family in chat-ids.ts. The fixtures registry intentionally NOT modified by this plan; future episodic test files should pick from the same 9992X band.

### Critical Implementation Notes

- **TECH-DEBT-19-01 is Phase 20's first task** — drizzle-kit meta snapshot regeneration for migrations 0001/0003 must happen before migration 0005 is generated. Without this, `drizzle-kit generate` produces a corrupt chain.
- **Consolidation prompt is the highest-risk surface** — Phase 21 is isolated so it can be iterated against real Sonnet before downstream phases depend on it. The M006 constitutional preamble must be explicitly present in the prompt string (assert by unit test — CONS-04).
- **Two-dimensional retrieval routing** — both dimensions must ship in Phase 22: (1) recency boundary (≤7 days raw, >7 days summary) AND (2) verbatim-fidelity escape (raw always regardless of age when keywords present). High-importance raw descent (importance >= 8) is a third rule, not optional.
- **Importance rubric calibration** — full-range ground-truth labels for the TEST-16 fixture (r > 0.7 Pearson) must include scores from the tails (1–2 and 9–10 must each appear at least once). Labels are set before the fixture is written.
- **Docker test gate** — **973 tests currently passing in the excluded-suite mitigation** (Plan 23-01 lifted from 964 via +9 synthetic-fixture.test.ts assertions: TEST-15/16 fixture+Pearson correlation, TEST-17 a/b/c/d routing, TEST-18 DST, TEST-19 idempotency, TEST-20 decision floor, TEST-21 contradiction floor + verbatim; Plan 22-05 lifted from 958 via +6 cron.test.ts assertions for CRON-01/02; Plan 22-03 lifted from 934 via +24: 16 date-extraction + 8 INTERROGATE-injection assertions; Plan 22-02 baseline 934; Plan 22-04 lifted from 911 via +4 boundary-audit.test.ts assertions for RETR-05/06; Plan 22-01 lifted from 901 via +10 retrieve episodic-helper assertions across retrieve.episodic.test.ts integration + retrieve.test.ts mocked error paths; Plan 21-04 lifted from 889 via +12 consolidate.test.ts assertions; Plan 21-03 lifted from 877 via +12 sources.test.ts assertions; Plan 21-02 lifted from 857 via +20 prompts.test.ts assertions; Plan 21-01 lifted from 853 via +4 CONSTITUTIONAL_PREAMBLE export assertions; prior Plan 20-03 lifted from 843). Phase 23 onward must not regress this floor. No regressions at any phase boundary. Note: vitest 4 suppresses the aggregate `Test Files X passed | Tests Y passed` summary line under unhandled rejections (HuggingFace cache EACCES); the `Failed Tests N` header value is the source of truth for the failure count, and the passing count is computed by subtraction from the previous baseline + per-plan delta. The excluded-suite mitigation skips 4 environmental-fail files (`live-integration.test.ts`, `live-accountability.test.ts`, `vague-validator-live.test.ts`, `contradiction-false-positive.test.ts`) and reaches exit 0 in ~27s; the 15 remaining failures (3 models-smoke API-gated + 7 engine-mute + 5 photos-memory) match the documented Phase 22 baseline exactly across plans 22-02 / 22-03 / 22-05 / 23-01.

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

Last session: 2026-04-19T08:53:00Z

Previous session: 2026-04-19T08:02Z -- Phase 22 Plan 05 complete (CRON-01/02). 964 passed in excluded-suite gate.
Stopped at: Phase 23 Plan 01 COMPLETE — TEST-15..TEST-21 satisfied (7/7 reqs). src/episodic/__tests__/synthetic-fixture.test.ts (1136 lines) — 9 it() blocks across 6 describe blocks. TEST-15 satisfied by fixture existence; TEST-16 14-day Pearson r > 0.7 with diagnostic per-day breakdown on failure (GROUND_TRUTH_LABELS=[1,2,3,4,4,5,5,6,6,7,7,8,9,10] covers all four CONS-05 bands + both tails per D-05); TEST-17 a/b/c/d covers all four Phase 22 routing branches against retrieveContext (recent / summary-only / verbatim-keyword / high-importance-descent — TEST-17d uses real Pensieve entries via loadEntriesByIds round-trip); TEST-18 simulates 2026-03-08 PST→PDT spring-forward in America/Los_Angeles via UTC instants bucketing identically in Paris+LA, asserts 2 distinct rows; TEST-19 reconciles plan's `{ skipped: true }` example with Phase 21's actual `{ skipped: 'existing' }` discriminated contract via toEqual exact match + asserts mockAnthropicParse.toHaveBeenCalledTimes(1) after second invocation; TEST-20 seeds real decisions row in 'open' state, runtime CONS-06 clamp lifts importance 3→6; TEST-21 seeds real contradictions row with status='DETECTED' (structural proxy for plan's 'confidence>=0.75' — the table has no confidence column; M002 enforces threshold at INSERT), runtime CONS-07 clamp lifts importance 4→7 + asserts both verbatim positions appear via .includes() in summary OR key_quotes (CONS-10). Mocks: anthropic.messages.parse, bot.api.sendMessage, pensieve/retrieve.js (hybridSearch + getEpisodicSummary, importOriginal-preserving — same precedent as routing.test.ts). Targeted vitest: 9/9 passed / 940ms. Excluded-suite Docker run: 973 passed / 15 failed / 988 total / 27.13s = +9 vs 964 Plan 22-05 baseline, zero regressions; the 15 environmental failures match the documented Phase 22 baseline exactly. Full Docker run hit the documented vitest 4 fork-mode IPC hang under HuggingFace cache EACCES; applied the documented excluded-suite mitigation. tsc --noEmit exits 0. Commits: cabae9c (Task 1 scaffold) + 6cbf125 (Task 2 TEST-15+16) + cf83069 (Task 3 TEST-17 4 sub-cases) + 2d401f2 (Task 4 TEST-18 DST) + b592919 (Task 5 TEST-19 idempotency) + 4560632 (Task 6 TEST-20 decision floor) + fd1b63e (Task 7 TEST-21 contradiction floor + verbatim). Two Rule-1 deviations: TEST-19 ConsolidateResult shape and TEST-21 contradictions schema reconciliation — both runtime-contract adaptations the plan explicitly anticipated.
Resume file: Phase 23 Plan 01 COMPLETE. 7 of 10 Phase 23 requirements closed (TEST-15..TEST-21). Begin Plan 23-02 (OPS-01 backfill script — `scripts/backfill-episodic.ts` with --from/--to ranges, 2s rate-limit per day, idempotent via CONS-03; per CONTEXT.md D-25 expect +1-2 integration tests). Then Plan 23-03 (CMD-01 /summary handler, expect +5 tests covering D-34 cases a-e). Then Plan 23-04 (TEST-22 live anti-flattery, gated by ANTHROPIC_API_KEY).

## Known Tech Debt

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing.
  - See [milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md](milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md) for rationale.
  - **Status: RESOLVED** in Phase 20 Plan 01 (2026-04-18) via clean-slate iterative replay (CONTEXT.md D-01). drizzle-kit generate against freshly-migrated Docker now prints "No schema changes, nothing to migrate" — the full chain 0000→0004 is byte-accurate.
  - Resolution applied: scripts/regen-snapshots.sh (clean-slate iterative replay on a throwaway Docker volume at port 5434 + temp drizzle-kit workspace per snapshot). The Plan 19-04 Option A hint in an earlier version of this file ("drizzle-kit generate will implicitly regenerate") was wrong — drizzle-kit does NOT backfill meta for already-applied entries (empirically verified in Plan 19-04 SUMMARY: "No schema changes, nothing to migrate" was the observed output of Option A).
  - **Audit disposition:** v2.1 milestone audit marks this as PARTIAL, not FAIL — does not block v2.1 requirement satisfaction. Resolved in Phase 20.
