---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Test Data Infrastructure
status: active-requirements
stopped_at: "v2.3 Test Data Infrastructure milestone kicked off 2026-04-20. Spec in M008.5_Test_Data_Infrastructure.md. Single phase (Phase 24) enabling primed-fixture pipeline (organic from Proxmox prod + synthetic delta via Haiku style-transfer + real runConsolidate for episodic summaries) so every downstream milestone (M009–M014) can be validated immediately without waiting real calendar time for data to accumulate. Four locked design decisions: (1) standalone milestone, not folded into M009; (2) Anthropic spend ~$0.28 per fixture refresh acceptable; (3) 24h freshness with silent auto-refresh; (4) source='telegram' pensieve only (no Immich/Gmail/Gdrive). Currently defining REQUIREMENTS.md."
last_updated: "2026-04-20T00:00:00.000Z"
last_activity: 2026-04-20
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20 for v2.3 kickoff).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** v2.3 Test Data Infrastructure — build the organic+synthetic primed-fixture pipeline so M009 and every downstream milestone can be validated on demand, without calendar-time waits.

## Current Position

Phase: Phase 24 (Test Data Infrastructure) — **not yet planned**
Plan: —
Status: Defining requirements
Last activity: 2026-04-20 — v2.3 milestone started, spec approved, kickoff via `/gsd-new-milestone`

Prior deploy state unchanged: v2.2 + M008.1 fix live on Proxmox (192.168.1.50, HEAD = 2cfcecd). Daily 23:00 Europe/Paris episodic cron + 6h sync cron + 10:00 proactive sweep cron all healthy. 2 substantive summaries on prod (2026-04-15 imp=8, 2026-04-18 imp=7).

```
Progress: [                    ] 0% (0/0 plans — roadmap pending)
```

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)
- **v2.2 M008 Episodic Consolidation** — 2026-04-19 (Phases 20-23 + 22.1, 17 plans, 35/35 requirements) + M008.1 inline fix 2026-04-19

## Phase Summary

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 24 | Test Data Infrastructure | (TBD — defining) | **PENDING** — awaiting REQUIREMENTS.md + ROADMAP.md |

## Accumulated Context

### v2.3 design decisions (locked 2026-04-20)

- **v2.3 is standalone, not folded into M009** — reusable infrastructure across M009–M014 avoids per-milestone re-derivation of synthesis code.
- **Organic data scope = `source='telegram'` only** — matches M008.1 consolidation contract; synced sources (immich/gmail/gdrive) bloat fixtures without adding test signal. Revisit if a milestone specifically exercises ambient retrieval.
- **Freshness policy = 24h auto-refresh** — snapshot older than one day triggers silent `fetch-prod-data.ts` invocation before proceeding. `--no-refresh` flag for sandbox/air-gap. No warnings, no half-stale runs.
- **Anthropic spend acceptable** — ~$0.02/day × 14 days = ~$0.28 per fixture refresh. Paid once per fixture-design-change via VCR cache, not per test run.

### Decisions in force for v2.3

Full log in PROJECT.md Key Decisions table. Most relevant going into test-data infrastructure:

- **D004 append-only Pensieve** — fetch scripts must dump pensieve_entries read-only; synthetic layer writes to a separate fixture directory, never back to prod.
- **D016 build+test locally then deploy** — primed fixtures enable the "test locally" side of this at M009+ scale.
- **D018 no skipped tests** — primed fixtures are the replacement for waiting real calendar days to gate tests.
- **D019 explicit prod approval** — `fetch-prod-data.ts` is read-only pg_dump; no write path to prod.
- **M008.1 filter** — `source='telegram'` is the consolidation contract; fixtures must match.
- **Convention (new, pending requirement-definition)** — *no milestone may gate on real calendar time for data accumulation; use the primed-fixture pipeline instead.*

### Pending Todos (carried from v2.1/v2.2)

- Human UAT pass on 12 deferred items from v2.1 (live Telegram feel, ACCOUNTABILITY tone quality, `/decisions` dashboard format, FR/RU localization).
- Run TEST-13 + TEST-14 locally with `ANTHROPIC_API_KEY` set to verify live Sonnet ACCOUNTABILITY + Haiku vague-prediction resistance.
- Env-level vitest-4 fork-IPC hang under HuggingFace EACCES — 5-file excluded-suite mitigation in place; worth a future fix-up phase (may intersect with v2.3 test-harness work).

### Blockers/Concerns

None. Spec is complete and approved.

## Session Continuity

Last session: 2026-04-20 — v2.3 milestone kickoff.
Stopped at: spec written (M008.5_Test_Data_Infrastructure.md), 4 design decisions locked, PROJECT.md updated. Next: write REQUIREMENTS.md with FETCH/SYNTH/HARN/FRESH/DOC categories, then spawn roadmapper for Phase 24 single-phase ~4-plan decomposition.

## Known Tech Debt

- **TECH-DEBT-19-01** — RESOLVED in Phase 20 Plan 01 (2026-04-18). drizzle-kit meta snapshots for 0001/0003 backfilled via `scripts/regen-snapshots.sh` clean-slate iterative replay.
- **Vitest-4 fork-IPC hang under HuggingFace EACCES** — pre-existing env issue, operational mitigation is 5-file excluded-suite in `scripts/test.sh`. Non-blocking for v2.3; worth addressing in a future fix-up phase.
- **Phase 21 WR-02 retry-on-all-errors policy** — documented design choice; M009+ may revisit if error patterns emerge.
