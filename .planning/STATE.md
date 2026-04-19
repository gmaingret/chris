---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: M008 Episodic Consolidation
status: executing
stopped_at: "Phase 23 Plan 02 COMPLETE — OPS-01 satisfied (1/1 req). scripts/backfill-episodic.ts (272 lines) — operator script with --from YYYY-MM-DD --to YYYY-MM-DD CLI via node:util parseArgs (strict, both required, regex+luxon-validated, from <= to, not future, span <= 365 days, exit 1 with usage on any failure), sequential ascending UTC iteration, 2s INTER_DAY_DELAY_MS sleep between days (OPS-01 verbatim), runConsolidate(date) per-day with full discriminated ConsolidateResult handling ('inserted'/'skipped'/'failed' branches counted into BackfillTotals), continue-on-error (D-22 — single-day exception logged + counted, loop proceeds, exit 0 on completed sweep), structured logger.info/error per day with { date, result, ... }, ESM main() guard so import by tests does not auto-run main(), exports runBackfill(from, to, opts?) with delayMs option for tests. src/episodic/__tests__/backfill.test.ts (359 lines) — 3 it() blocks under describe('OPS-01: scripts/backfill-episodic.ts integration'): (1) first-run happy path with 3 fixture dates seeded with 2 entries each → result.inserted=3, mockAnthropicParse called 3x, importances 3/4/5 flow unclamped; (2) Phase 23 Success Criterion #2 idempotency — second run returns inserted=0, skipped=3, errored=0 AND mockAnthropicParse.toHaveBeenCalledTimes(0) (CONS-03 pre-flight SELECT short-circuits); (3) zero-entry day (CONS-02) — middle day skipped without errored, surrounding days insert, exactly 2 Sonnet calls, exactly 2 rows with dates ['2026-04-01','2026-04-03']. Mocks: anthropic.messages.parse, bot.api.sendMessage. FIXTURE_CHAT_ID=BigInt(99924). Targeted vitest: 3/3 passed / 732ms. Excluded-suite Docker run: 976 passed / 15 failed / 991 total / 27.79s = +3 vs 973 Plan 23-01 baseline, zero regressions; the 15 environmental failures match the documented Phase 22/23-01 baseline exactly. Full Docker run hit the documented vitest 4 fork-mode IPC hang (terminated at 540s timeout, FINAL_EXIT=143); applied the documented excluded-suite mitigation. tsc --noEmit exits 0. Commits: 9d0771f (Task 1 backfill script) + a5f3a2c (Task 2 backfill integration test). Zero deviations — the ConsolidateResult shape reconciliation Plan 23-01 introduced as a Rule-1 deviation is now a key-decision carried forward; the plan's Task 1 narrative explicitly anticipated it. Ready for Plan 23-03 (CMD-01 /summary handler)."
last_updated: "2026-04-19T09:20:42Z"
last_activity: 2026-04-19
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 16
  completed_plans: 14
  percent: 88
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — v2.2 M008 Episodic Consolidation milestone started)

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.
**Current focus:** Phase 23 — Test Suite + Backfill + /summary

## Current Position

Phase: 23 (Test Suite + Backfill + /summary) — EXECUTING
Plan: 3 of 4
Next: Plan 23-03 (CMD-01 /summary Telegram handler — `src/bot/handlers/summary.ts`, no-args → yesterday in `config.proactiveTimezone`, `/summary YYYY-MM-DD` → that date, no-row case → clear "no summary" message; +5 integration tests per D-34 cases a-e)
Status: Plan 02 COMPLETE; ready for Plan 03
Last activity: 2026-04-19 — Plan 23-02 complete (OPS-01, +3 tests, zero regressions)

```
Progress: [█████████████████░░░] 88% (14/16 plans)
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
| 23 | Test Suite + Backfill + /summary | TEST-15–22, OPS-01, CMD-01 (10 reqs) | **IN PROGRESS** (2/4 plans — Plan 01 TEST-15..TEST-21 via 14-day synthetic fixture; Plan 02 OPS-01 backfill script + 3-block integration test; Docker gate 976 passing, +3 vs Plan 23-01 baseline 973) |

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

### Plan 23-02 decisions (logged 2026-04-19)

- **ConsolidateResult discriminated handling carried into the backfill** — script branches on `'inserted' in result` / `'skipped' in result` / `'failed' in result` and counts each into BackfillTotals. The 'failed' branch logs and counts as errored WITHOUT re-throwing (D-22 continue-on-error). Same shape reconciliation Plan 23-01 introduced; zero new deviations.
- **Future-date boundary uses UTC, not config.proactiveTimezone** — conservative on purpose. A date that is "past" in Paris might still be "today" in UTC; rejecting ambiguous boundary cases is preferable to a half-complete summary for a still-in-progress day.
- **365-day span safety valve (D-19) included as a pragma** — historical backfills with no bound are a footgun; the error message names the limit so the operator knows the next step.
- **ESM main() guard pattern** — first use of `import.meta.url === \`file://${process.argv[1]}\`` in this codebase. Enables the dual-purpose script (CLI when run via `npx tsx`; library when imported by the integration test) without two source files.
- **runBackfill `delayMs: 0` test option** — bypasses the 2s INTER_DAY_DELAY_MS sleep in tests. CLI keeps the OPS-01 2000ms default; the contract is enforced via the `INTER_DAY_DELAY_MS` const + the verify-step grep that requires the literal "2000" in the script source.
- **Cross-directory test→scripts/ ESM import works under vitest+esbuild** — the test imports `runBackfill` from `'../../../scripts/backfill-episodic.js'`. tsconfig excludes src/__tests__/** from compilation, so the cross-rootDir import is never type-checked at the tsc layer; vitest's runtime transformer resolves the .ts source. Targeted run 3/3 passed in 732ms confirms.
- **FIXTURE_CHAT_ID = BigInt(99924)** — Plan 23-01 used 99923; Plan 23-02 picks the next free 9992X. The chat-ids.ts registry intentionally NOT modified (same rationale as Plan 23-01).

### Critical Implementation Notes

- **TECH-DEBT-19-01 is Phase 20's first task** — drizzle-kit meta snapshot regeneration for migrations 0001/0003 must happen before migration 0005 is generated. Without this, `drizzle-kit generate` produces a corrupt chain.
- **Consolidation prompt is the highest-risk surface** — Phase 21 is isolated so it can be iterated against real Sonnet before downstream phases depend on it. The M006 constitutional preamble must be explicitly present in the prompt string (assert by unit test — CONS-04).
- **Two-dimensional retrieval routing** — both dimensions must ship in Phase 22: (1) recency boundary (≤7 days raw, >7 days summary) AND (2) verbatim-fidelity escape (raw always regardless of age when keywords present). High-importance raw descent (importance >= 8) is a third rule, not optional.
- **Importance rubric calibration** — full-range ground-truth labels for the TEST-16 fixture (r > 0.7 Pearson) must include scores from the tails (1–2 and 9–10 must each appear at least once). Labels are set before the fixture is written.
- **Docker test gate** — **976 tests currently passing in the excluded-suite mitigation** (Plan 23-02 lifted from 973 via +3 backfill.test.ts assertions: first-run insert, second-run idempotency with toHaveBeenCalledTimes(0), zero-entry day; Plan 23-01 lifted from 964 via +9 synthetic-fixture.test.ts assertions: TEST-15/16 fixture+Pearson correlation, TEST-17 a/b/c/d routing, TEST-18 DST, TEST-19 idempotency, TEST-20 decision floor, TEST-21 contradiction floor + verbatim; Plan 22-05 lifted from 958 via +6 cron.test.ts assertions for CRON-01/02; Plan 22-03 lifted from 934 via +24: 16 date-extraction + 8 INTERROGATE-injection assertions; Plan 22-02 baseline 934; Plan 22-04 lifted from 911 via +4 boundary-audit.test.ts assertions for RETR-05/06; Plan 22-01 lifted from 901 via +10 retrieve episodic-helper assertions across retrieve.episodic.test.ts integration + retrieve.test.ts mocked error paths; Plan 21-04 lifted from 889 via +12 consolidate.test.ts assertions; Plan 21-03 lifted from 877 via +12 sources.test.ts assertions; Plan 21-02 lifted from 857 via +20 prompts.test.ts assertions; Plan 21-01 lifted from 853 via +4 CONSTITUTIONAL_PREAMBLE export assertions; prior Plan 20-03 lifted from 843). Phase 23 onward must not regress this floor. No regressions at any phase boundary. Note: vitest 4 suppresses the aggregate `Test Files X passed | Tests Y passed` summary line under unhandled rejections (HuggingFace cache EACCES); the `Failed Tests N` header value is the source of truth for the failure count, and the passing count is computed by subtraction from the previous baseline + per-plan delta. The excluded-suite mitigation skips 4 environmental-fail files (`live-integration.test.ts`, `live-accountability.test.ts`, `vague-validator-live.test.ts`, `contradiction-false-positive.test.ts`) and reaches exit 0 in ~27s; the 15 remaining failures (3 models-smoke API-gated + 7 engine-mute + 5 photos-memory) match the documented Phase 22 baseline exactly across plans 22-02 / 22-03 / 22-05 / 23-01 / 23-02.

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

Last session: 2026-04-19T09:20:42Z

Previous session: 2026-04-19T08:53:00Z -- Phase 23 Plan 01 complete (TEST-15..TEST-21). 973 passed in excluded-suite gate.
Stopped at: Phase 23 Plan 02 COMPLETE — OPS-01 satisfied (1/1 req). scripts/backfill-episodic.ts (272 lines) ships with --from YYYY-MM-DD --to YYYY-MM-DD CLI via node:util parseArgs (strict, both required, regex+luxon-validated, from <= to, not future, span <= 365 days, exit 1 with usage on any failure), sequential ascending UTC iteration, 2s INTER_DAY_DELAY_MS sleep between days (OPS-01 verbatim), runConsolidate(date) per-day with full discriminated ConsolidateResult handling ('inserted'/'skipped'/'failed' branches counted into BackfillTotals), continue-on-error (D-22 — single-day exception logged + counted, loop proceeds, exit 0 on completed sweep), structured logger.info/error per day with { date, result, ... }, ESM main() guard, exports runBackfill(from, to, opts?) with delayMs option for tests. src/episodic/__tests__/backfill.test.ts (359 lines) — 3 it() blocks under describe('OPS-01: scripts/backfill-episodic.ts integration'): (1) first-run happy path with 3 fixture dates seeded with 2 entries each → result.inserted=3, mockAnthropicParse called 3x, importances 3/4/5 flow unclamped; (2) Phase 23 Success Criterion #2 idempotency — second run returns inserted=0, skipped=3, errored=0 AND mockAnthropicParse.toHaveBeenCalledTimes(0) (CONS-03 pre-flight SELECT short-circuits); (3) zero-entry day (CONS-02) — middle day skipped without errored, surrounding days insert, exactly 2 Sonnet calls, exactly 2 rows with dates ['2026-04-01','2026-04-03']. Mocks: anthropic.messages.parse, bot.api.sendMessage. FIXTURE_CHAT_ID=BigInt(99924). Targeted vitest: 3/3 passed / 732ms. Excluded-suite Docker run: 976 passed / 15 failed / 991 total / 27.79s = +3 vs 973 Plan 23-01 baseline, zero regressions; the 15 environmental failures match the documented Phase 22/23-01 baseline exactly. Full Docker run hit the documented vitest 4 fork-mode IPC hang (terminated at 540s timeout, FINAL_EXIT=143); applied the documented excluded-suite mitigation. tsc --noEmit exits 0. Commits: 9d0771f (Task 1 backfill script) + a5f3a2c (Task 2 backfill integration test). Zero deviations.
Resume file: Phase 23 Plan 02 COMPLETE. 8 of 10 Phase 23 requirements closed (TEST-15..TEST-21 + OPS-01). Begin Plan 23-03 (CMD-01 /summary handler — `src/bot/handlers/summary.ts`; no-args → yesterday in `config.proactiveTimezone`, `/summary YYYY-MM-DD` → that date, no-row case → clear "no summary" message; per CONTEXT.md D-34 expect +5 integration tests covering cases a-e). Then Plan 23-04 (TEST-22 live anti-flattery, gated by ANTHROPIC_API_KEY).

## Known Tech Debt

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing.
  - See [milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md](milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md) for rationale.
  - **Status: RESOLVED** in Phase 20 Plan 01 (2026-04-18) via clean-slate iterative replay (CONTEXT.md D-01). drizzle-kit generate against freshly-migrated Docker now prints "No schema changes, nothing to migrate" — the full chain 0000→0004 is byte-accurate.
  - Resolution applied: scripts/regen-snapshots.sh (clean-slate iterative replay on a throwaway Docker volume at port 5434 + temp drizzle-kit workspace per snapshot). The Plan 19-04 Option A hint in an earlier version of this file ("drizzle-kit generate will implicitly regenerate") was wrong — drizzle-kit does NOT backfill meta for already-applied entries (empirically verified in Plan 19-04 SUMMARY: "No schema changes, nothing to migrate" was the observed output of Option A).
  - **Audit disposition:** v2.1 milestone audit marks this as PARTIAL, not FAIL — does not block v2.1 requirement satisfaction. Resolved in Phase 20.
