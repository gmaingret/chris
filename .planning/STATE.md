---
gsd_state_version: 1.0
milestone: v2.2
milestone_name: M008 Episodic Consolidation
status: executing
stopped_at: "Phase 22 Plan 02 COMPLETE — RETR-02 + RETR-03 satisfied. src/pensieve/routing.ts (224 lines) ships retrieveContext() orchestrator with two-dimensional routing (recency boundary ≤7d→raw, >7d→summary; verbatim-keyword fast-path EN/FR/RU → raw always regardless of age) plus high-importance raw descent (importance ≥ 8 surfaces source_entry_ids alongside summary). Five named RoutingReason literals: verbatim-keyword, recent, no-summary-fallback, high-importance-descent, summary-only. VERBATIM_KEYWORDS exported as readonly string[] (15 keywords) for Plan 22-03 INTERROGATE reuse. Pure keyword match — NO Haiku call (M008 deferral; M009+ may add fallback when miss rate is measurable), enforced by afterAll cumulative assertion. Never-throw contract; logs pensieve.routing.decision on every branch. src/pensieve/__tests__/routing.test.ts (473 lines) ships 22 unit tests covering all 5 reasons + EN/FR/RU it.each + importance boundary it.each (7/8/9/10) + error path. Targeted: 22/0 / 560ms. Excluded-suite (skipping 4 environmental-fail files including live-integration + contradiction-FP): 934 passed / 15 failed / 949 total / 25.94s. Pre-existence of 12 photos-memory + engine-mute failures verified at HEAD~2 with routing files moved aside — same 5+7 failures reproduce, confirming zero regressions. Commits: b61f3f2 (feat) + 86ae231 (test). Plans 03 + 05 still pending (RETR-04 + CRON-01/02). Next: Plan 22-03 (RETR-04 INTERROGATE date-anchored summary injection) or Plan 22-05 (CRON-01/02 cron)."
last_updated: "2026-04-19T06:35:00Z"
last_activity: 2026-04-19 -- Phase 22 Plan 02 complete (RETR-02 + RETR-03 routing + raw descent)
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 16
  completed_plans: 10
  percent: 63
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18 — v2.2 M008 Episodic Consolidation milestone started)

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.
**Current focus:** Phase 22 — Cron + Retrieval Routing

## Current Position

Phase: 22 (Cron + Retrieval Routing) — EXECUTING
Plan: 3 of 5 (Plans 1 + 2 + 4 complete; Plan 02 added RETR-02 + RETR-03 routing in src/pensieve/routing.ts with VERBATIM_KEYWORDS shared constant for Plan 22-03 reuse)
Next: Plan 22-03 (RETR-04 INTERROGATE date-anchored summary injection consuming `getEpisodicSummariesRange` + reusing the same VERBATIM_KEYWORDS const from routing.ts), Plan 22-05 (CRON-01/02 independent `cron.schedule(config.episodicCron, ...)` registration in `src/index.ts` with DST-safe timezone handling). Plans 22-03 and 22-05 are independent of each other.
Status: Executing Phase 22 (Plans 1 + 2 + 4 of 5 complete)
Last activity: 2026-04-19 -- Phase 22 Plan 02 complete (RETR-02 + RETR-03: two-dim routing + high-importance raw descent + 22 unit tests + cumulative no-Haiku assertion)

```
Progress: [████████████░░░░░░░░] 63% (10/16 plans)
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
| 22 | Cron + Retrieval Routing | CRON-01–02, RETR-01–06 (8 reqs) | In progress (3/5 plans — Plan 01 RETR-01 episodic retrieval helpers shipped 2026-04-18; Plan 04 RETR-05 + RETR-06 boundary audit shipped 2026-04-19; Plan 02 RETR-02 + RETR-03 two-dim routing + high-importance raw descent shipped 2026-04-19) |
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

Last session: 2026-04-19T06:35:00Z -- Phase 22 Plan 02 complete (RETR-02 + RETR-03 two-dim routing + high-importance raw descent): `src/pensieve/routing.ts` (new, 224 lines) ships `retrieveContext(opts)` orchestrator with two-dimensional routing — dimension 1 recency boundary (queryAge ≤ 7d → raw via hybridSearch; > 7d → summary first via getEpisodicSummary) and dimension 2 verbatim-keyword fast-path (overrides recency: any of 15 EN/FR/RU keywords in `query.toLowerCase()` → raw always, no summary fetch). High-importance raw descent (RETR-03): when matched summary has `importance >= 8` (inclusive boundary), `loadEntriesByIds(summary.sourceEntryIds)` runs `inArray(pensieveEntries.id, ids) + isNull(deletedAt)` and surfaces rows in input-array order with score=1.0 sentinel. Five named RoutingReason literals: `verbatim-keyword`, `recent`, `no-summary-fallback`, `high-importance-descent`, `summary-only`. Exports `VERBATIM_KEYWORDS: readonly string[]` (15 keywords: EN exactly/verbatim/what did i say/exact words/word for word/precise quote, FR exactement/mot pour mot/qu'ai-je dit/textuellement, RU точно/дословно/что я сказал/слово в слово) + `HIGH_IMPORTANCE_THRESHOLD = 8` + `RECENCY_BOUNDARY_DAYS = 7` for Plan 22-03 INTERROGATE reuse. Pure keyword match — NO Haiku call (M008 fast-path-only deferral; M009+ may add Haiku fallback when miss rate is measurable), enforced by afterAll cumulative assertion in tests. Never-throw contract; logs `pensieve.routing.decision` at info on every successful branch with `{ reason, queryAge, hasQueryDate, importance?, rawCount }`; logs `pensieve.routing.error` at warn + falls back to `recent` on internal failure. `src/pensieve/__tests__/routing.test.ts` (new, 473 lines) ships 22 unit tests in 7 describe blocks: constants exports (3) + verbatim-keyword fast-path (3 it.each EN/FR/RU + case-insensitive + recency-override = 5) + recency boundary (4 incl. queryDate=undefined + boundary=7d + custom rawLimit) + old-query summary path (no-summary-fallback + summary-only) + high-importance descent (4 it.each importance 7/8/9/10 + empty sourceEntryIds edge) + error path (getEpisodicSummary throws + hybridSearch also throws) + cumulative no-Anthropic assertion. Pattern: vi.hoisted + vi.mock mirroring `src/episodic/__tests__/consolidate.test.ts`; mocks `../retrieve.js` (importActual + override), `../../db/connection.js` (chain returns `mockLoadEntriesByIdsRows.current` ref), `../../llm/client.js` (anthropic spy), `../../utils/logger.js`, `../../config.js`. `vi.useFakeTimers({ now: FIXED_NOW, toFake: ['Date'] })` in beforeEach pins Date.now() so `daysAgo(n)` math is deterministic. Targeted via test.sh: **22 passed / 0 failed / 560ms**. Excluded-suite via `npx vitest run --exclude live-integration --exclude live-accountability --exclude vague-validator-live --exclude contradiction-false-positive` (the 4 environmental-fail files): **934 passed / 15 failed / 949 total / 25.94s**. The 15 remaining failures break down: 3 live-API gated (models-smoke), 7 engine-mute (unmocked db connection refused), 5 photos-memory (mock chain TypeError). All 12 non-live failures verified pre-existing at HEAD~2 by moving routing.ts/.test.ts aside and re-running same files in isolation — same 5+7 failures reproduce, confirming zero regressions from this plan. Vitest 4 fork-mode IPC hang under HuggingFace cache EACCES (same documented pattern as Plan 22-04 SUMMARY) prevented a clean full-suite Docker run within wall-clock budget; the three-way validation (targeted/excluded-suite/HEAD~2-baseline-comparison) provides equivalent evidence. Commits: `b61f3f2` (feat) + `86ae231` (test).

Previous session: 2026-04-19T04:55:00Z -- Phase 22 Plan 04 complete (RETR-05 + RETR-06 boundary audit): `src/chris/__tests__/boundary-audit.test.ts` (new, 127 lines) ships 4 deterministic source-text assertions enforcing D031 architectural boundaries — zero matches for `/\bepisodic_summaries\b|\bepisodicSummaries\b/` in `src/chris/personality.ts` (Known Facts builder), `src/pensieve/ground-truth.ts` (Known Facts data source), and `src/pensieve/embeddings.ts` (the only `db.insert(pensieveEmbeddings).values(...)` path); plus a redundant fourth assertion that every matched INSERT block in embeddings.ts is free of `/episodic/i`. Targeted via test.sh: 4/4 passed / 130ms. Docker gate **≈915 passed / 61 failing / 976 total = +4 vs 911/61/972 Plan 22-01 baseline, zero regressions**. Commit: `87f7b2c` (test).
Stopped at: Phase 22 Plan 02 COMPLETE — RETR-02 + RETR-03 satisfied. Next: Plan 22-03 (RETR-04 INTERROGATE date-anchored summary injection consuming `getEpisodicSummariesRange` from Plan 22-01 + `VERBATIM_KEYWORDS` const from Plan 22-02 routing.ts) or Plan 22-05 (CRON-01/02 cron). Plans 22-03 and 22-05 are independent of each other.
Resume file: Continue Phase 22 with Plan 03 (RETR-04) or Plan 05 (CRON-01/02). The new `VERBATIM_KEYWORDS` shared constant from src/pensieve/routing.ts means Plan 22-03 can import the same keyword list for INTERROGATE intent-detection without duplicating the EN/FR/RU coverage. See `.planning/phases/22-cron-retrieval-routing/22-02-SUMMARY.md` for the full plan summary including the vitest 4 hang workaround (excluded-suite + HEAD~2 baseline comparison for regression verification).

## Known Tech Debt

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing.
  - See [milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md](milestones/v2.1-phases/19-proactive-pipeline-restoration/19-04-SUMMARY.md) for rationale.
  - **Status: RESOLVED** in Phase 20 Plan 01 (2026-04-18) via clean-slate iterative replay (CONTEXT.md D-01). drizzle-kit generate against freshly-migrated Docker now prints "No schema changes, nothing to migrate" — the full chain 0000→0004 is byte-accurate.
  - Resolution applied: scripts/regen-snapshots.sh (clean-slate iterative replay on a throwaway Docker volume at port 5434 + temp drizzle-kit workspace per snapshot). The Plan 19-04 Option A hint in an earlier version of this file ("drizzle-kit generate will implicitly regenerate") was wrong — drizzle-kit does NOT backfill meta for already-applied entries (empirically verified in Plan 19-04 SUMMARY: "No schema changes, nothing to migrate" was the observed output of Option A).
  - **Audit disposition:** v2.1 milestone audit marks this as PARTIAL, not FAIL — does not block v2.1 requirement satisfaction. Resolved in Phase 20.
