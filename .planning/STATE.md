---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Test Data Infrastructure
status: active-roadmap
stopped_at: "v2.3 Test Data Infrastructure roadmap written 2026-04-20. Single-phase milestone (Phase 24 — Primed-Fixture Pipeline) with 4 plans: 24-01 fetch-prod-data + snapshot schema + gitignore + FRESH-01 hook, 24-02 synthesize-delta (Haiku style-transfer + deterministic generators + VCR), 24-03 real-engine episodic synthesis via runConsolidate, 24-04 loadPrimedFixture harness + regenerate-primed + TESTING.md + convention. All 20 REQ-IDs (FETCH-01..05, SYNTH-01..07, HARN-01..03, FRESH-01..03, DOC-01..02) mapped to exactly one plan. 5 observable success criteria for Phase 24 locked. Ready for /gsd-plan-phase 24."
last_updated: "2026-04-20T00:00:00.000Z"
last_activity: 2026-04-20
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 4
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20 for v2.3 kickoff).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** v2.3 Test Data Infrastructure — build the organic+synthetic primed-fixture pipeline so M009 and every downstream milestone can be validated on demand, without calendar-time waits.

## Current Position

Phase: Phase 24 (Primed-Fixture Pipeline) — **roadmap written, plans pending**
Plan: —
Status: Awaiting plan decomposition (`/gsd-plan-phase 24`)
Last activity: 2026-04-20 — roadmapper wrote ROADMAP.md, REQUIREMENTS.md traceability, STATE.md update; 5 success criteria locked; 4 plans scoped

Prior deploy state unchanged: v2.2 + M008.1 fix live on Proxmox (192.168.1.50, HEAD = 2cfcecd). Daily 23:00 Europe/Paris episodic cron + 6h sync cron + 10:00 proactive sweep cron all healthy. 2 substantive summaries on prod (2026-04-15 imp=8, 2026-04-18 imp=7).

```
Progress: [                    ] 0% (0/4 plans — roadmap approved, awaiting plan decomposition)
```

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)
- **v2.2 M008 Episodic Consolidation** — 2026-04-19 (Phases 20-23 + 22.1, 17 plans, 35/35 requirements) + M008.1 inline fix 2026-04-19

## Phase Summary

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 24 | Primed-Fixture Pipeline | 20 (FETCH-01..05, SYNTH-01..07, HARN-01..03, FRESH-01..03, DOC-01..02) | **NOT STARTED** — roadmap written, 4 plans scoped (24-01 fetch; 24-02 synth-delta; 24-03 episodic pass; 24-04 harness + docs); awaiting `/gsd-plan-phase 24` |

## Accumulated Context

### v2.3 design decisions (locked 2026-04-20)

- **v2.3 is standalone, not folded into M009** — reusable infrastructure across M009–M014 avoids per-milestone re-derivation of synthesis code.
- **Organic data scope = `source='telegram'` only** — matches M008.1 consolidation contract; synced sources (immich/gmail/gdrive) bloat fixtures without adding test signal. Revisit if a milestone specifically exercises ambient retrieval.
- **Freshness policy = 24h auto-refresh** — snapshot older than one day triggers silent `fetch-prod-data.ts` invocation before proceeding. `--no-refresh` flag for sandbox/air-gap. No warnings, no half-stale runs.
- **Anthropic spend acceptable** — ~$0.02/day × 14 days = ~$0.28 per fixture refresh. Paid once per fixture-design-change via VCR cache, not per test run.

### v2.3 roadmap decisions (locked 2026-04-20)

- **Single phase, four plans.** Phase 24 "Primed-Fixture Pipeline" covers all 20 v2.3 requirements. Plan shape follows the spec: (1) fetch-prod-data script + FRESH-01 hook, (2) synthesize-delta for non-episodic content + VCR cache, (3) real-engine episodic synthesis pass (split from 24-02 per spec guidance — runConsolidate integration has distinct complexity), (4) test-harness loader + regenerate-primed + documentation + convention codification.
- **FRESH requirements are split across plans by locality.** FRESH-01 (24h auto-refresh hook) lives in 24-01 since the fetch script owns the snapshot lifecycle; FRESH-02 (`--no-refresh` flag) lives in 24-02 where the flag is consumed; FRESH-03 (regenerate-primed script) lives in 24-04 where the wrapper script is built.

### Decisions in force for v2.3

Full log in PROJECT.md Key Decisions table. Most relevant going into test-data infrastructure:

- **D004 append-only Pensieve** — fetch scripts must dump pensieve_entries read-only; synthetic layer writes to a separate fixture directory, never back to prod.
- **D016 build+test locally then deploy** — primed fixtures enable the "test locally" side of this at M009+ scale.
- **D018 no skipped tests** — primed fixtures are the replacement for waiting real calendar days to gate tests.
- **D019 explicit prod approval** — `fetch-prod-data.ts` is read-only pg_dump; no write path to prod.
- **M008.1 filter** — `source='telegram'` is the consolidation contract; fixtures must match.
- **Convention (new, pending Plan 24-04 codification)** — *no milestone may gate on real calendar time for data accumulation; use the primed-fixture pipeline instead.*

### Pending Todos (carried from v2.1/v2.2)

- Human UAT pass on 12 deferred items from v2.1 (live Telegram feel, ACCOUNTABILITY tone quality, `/decisions` dashboard format, FR/RU localization).
- Run TEST-13 + TEST-14 locally with `ANTHROPIC_API_KEY` set to verify live Sonnet ACCOUNTABILITY + Haiku vague-prediction resistance.
- Env-level vitest-4 fork-IPC hang under HuggingFace EACCES — 5-file excluded-suite mitigation in place; worth a future fix-up phase (may intersect with v2.3 test-harness work in 24-04).

### Blockers/Concerns

None. Spec is complete, requirements locked, roadmap written with 5 observable success criteria. Ready for plan decomposition.

## Session Continuity

Last session: 2026-04-20 — v2.3 milestone kickoff + roadmap.
Stopped at: ROADMAP.md written (single phase, 4 plans), REQUIREMENTS.md traceability filled (20/20 mapped). Next: `/gsd-plan-phase 24` to decompose Phase 24 into 4 plans with tasks + verification per plan.

## Known Tech Debt

- **TECH-DEBT-19-01** — RESOLVED in Phase 20 Plan 01 (2026-04-18). drizzle-kit meta snapshots for 0001/0003 backfilled via `scripts/regen-snapshots.sh` clean-slate iterative replay.
- **Vitest-4 fork-IPC hang under HuggingFace EACCES** — pre-existing env issue, operational mitigation is 5-file excluded-suite in `scripts/test.sh`. Non-blocking for v2.3; worth addressing in a future fix-up phase.
- **Phase 21 WR-02 retry-on-all-errors policy** — documented design choice; M009+ may revisit if error patterns emerge.
