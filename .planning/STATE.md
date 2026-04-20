---
gsd_state_version: 1.0
milestone: v2.3
milestone_name: Test Data Infrastructure
status: In progress — Plan 24-02 complete (2/4)
stopped_at: "Plan 24-02 shipped (2026-04-20, 80m): VCR cache wrapper + scripts/synthesize-delta.ts with per-day Haiku style-transfer + deterministic decisions/contradictions/wellbeing generators. 7 new requirements complete (SYNTH-01/02/04/05/06/07, FRESH-02). Next plan: 24-03 (real-engine episodic synthesis via runConsolidate sibling-module composition, SYNTH-03)."
last_updated: "2026-04-20T12:52:48Z"
last_activity: "2026-04-20 — Plan 24-02 shipped: VCR cache (vcr.ts) + synthesize-delta CLI; 34/34 unit tests + Docker gate green; 5 atomic commits (f9c2def test / c3c36d9 feat / 305a211 chore / fdd2d5f test / 13cd846 feat)"
current_plan: 3
total_plans: 4
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 4
  completed_plans: 2
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-20 for v2.3 kickoff).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** v2.3 Test Data Infrastructure — build the organic+synthetic primed-fixture pipeline so M009 and every downstream milestone can be validated on demand, without calendar-time waits.

## Current Position

Phase: Phase 24 (Primed-Fixture Pipeline) — **in progress, 2/4 plans complete**
Plan: 24-03 (next; depends on 24-01 + 24-02)
Status: Plan 24-02 shipped. Plan 24-03 unblocked.
Last activity: 2026-04-20 — Plan 24-02 shipped (~80m): vcr.ts wrapper + synthesize-delta.ts CLI + 34/34 unit tests pass + Docker gate green.

Prior deploy state unchanged: v2.2 + M008.1 fix live on Proxmox (192.168.1.50, HEAD = 2cfcecd). Daily 23:00 Europe/Paris episodic cron + 6h sync cron + 10:00 proactive sweep cron all healthy. 2 substantive summaries on prod (2026-04-15 imp=8, 2026-04-18 imp=7).

```
Progress: [##########          ] 50% (2/4 plans — 24-01 fetch + 24-02 synth-delta shipped; 24-03 episodic pass + 24-04 harness/docs pending)
```

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)
- **v2.2 M008 Episodic Consolidation** — 2026-04-19 (Phases 20-23 + 22.1, 17 plans, 35/35 requirements) + M008.1 inline fix 2026-04-19

## Phase Summary

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 24 | Primed-Fixture Pipeline | 20 (FETCH-01..05, SYNTH-01..07, HARN-01..03, FRESH-01..03, DOC-01..02) | **IN PROGRESS (2/4 plans)** — 24-01 fetch shipped 2026-04-20 (a8181fa, 6 REQs); 24-02 synth-delta shipped 2026-04-20 (13cd846, 7 REQs); 24-03 episodic pass + 24-04 harness/docs pending. 13/20 REQs complete. |

## Accumulated Context

### v2.3 design decisions (locked 2026-04-20)

- **v2.3 is standalone, not folded into M009** — reusable infrastructure across M009–M014 avoids per-milestone re-derivation of synthesis code.
- **Organic data scope = `source='telegram'` only** — matches M008.1 consolidation contract; synced sources (immich/gmail/gdrive) bloat fixtures without adding test signal. Revisit if a milestone specifically exercises ambient retrieval.
- **Freshness policy = 24h auto-refresh** — snapshot older than one day triggers silent `fetch-prod-data.ts` invocation before proceeding. `--no-refresh` flag for sandbox/air-gap. No warnings, no half-stale runs.
- **Anthropic spend acceptable** — ~$0.02/day × 14 days = ~$0.28 per fixture refresh. Paid once per fixture-design-change via VCR cache, not per test run.

### v2.3 roadmap decisions (locked 2026-04-20)

- **Single phase, four plans.** Phase 24 "Primed-Fixture Pipeline" covers all 20 v2.3 requirements. Plan shape follows the spec: (1) fetch-prod-data script + FRESH-01 hook, (2) synthesize-delta for non-episodic content + VCR cache, (3) real-engine episodic synthesis pass (split from 24-02 per spec guidance — runConsolidate integration has distinct complexity), (4) test-harness loader + regenerate-primed + documentation + convention codification.
- **FRESH requirements are split across plans by locality.** FRESH-01 (24h auto-refresh hook) lives in 24-01 since the fetch script owns the snapshot lifecycle; FRESH-02 (`--no-refresh` flag) lives in 24-02 where the flag is consumed; FRESH-03 (regenerate-primed script) lives in 24-04 where the wrapper script is built.

### Plan 24-02 decisions (locked 2026-04-20)

- **VCR hash key = SHA-256 over canonical-stringified request (keys sorted at every nesting level).** Any prompt/model/schema change auto-invalidates without manual bookkeeping. Sort-at-every-level is load-bearing — the Anthropic SDK's nested `output_config.format` JSON-schema emitter does not preserve key order, so a top-level-only sort would false-miss on every run.
- **Lazy-import pattern reused from Plan 24-01.** `scripts/synthesize-delta.ts` lazy-imports logger/freshness/vcr/llm-client inside `synthesize()` (not at top level) so `--help` exits without DATABASE_URL. The seeded-RNG module (no config deps) stays top-level. Vitest `vi.mock()` hoisting means this is invisible to unit tests.
- **Deterministic UUID generator.** 4 × Mulberry32 draws → 16 bytes → UUIDv4 layout. Replaces `crypto.randomUUID()` at every synthesis site to close the SYNTH-07 determinism gap.
- **Test fixture committed to repo.** `scripts/__tests__/__fixtures__/synth-delta/organic-tiny/` (5 telegram entries across 2 days) is NOT gitignored — keeps the unit-test gate hermetic and independent of the gitignored `tests/fixtures/prod-snapshot/` tree.
- **vitest config widened.** `root='src'` → `root='.'` with explicit includes for both `src/**/__tests__/` and `scripts/**/__tests__/`. Plan 24-02's frontmatter prescribes `scripts/__tests__/synthesize-delta.test.ts` as the test path; prior config scoped discovery to `src/**` only.
- **Empty `episodic_summaries.jsonl` placeholder.** synthesize-delta writes an empty file; Plan 24-03 overwrites with real `runConsolidate` output. Documented in MANIFEST.json `schema_note` and in the plan summary's Known Stubs section.

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

None. Phase 24 is on schedule: 2 plans shipped, 2 plans pending. Plan 24-03 unblocked (depends on 24-01 + 24-02 both shipped). Plan 24-04 depends on 24-03 via the primed-fixture directory consumer contract.

## Session Continuity

Last session: 2026-04-20 — Plan 24-02 shipped.
Stopped at: 5 commits landed on main (f9c2def test vcr / c3c36d9 feat vcr / 305a211 chore vitest / fdd2d5f test synth-delta / 13cd846 feat synth-delta). 34 new unit tests all green. Docker gate re-run with 5-file exclude mitigation: 74 files passed / 3 failed (models-smoke, API-key-gated, pre-existing). 13/20 v2.3 requirements complete. Next: `/gsd-execute-phase 24 24-03-PLAN.md` to run Wave 3 (real-engine episodic synthesis via runConsolidate sibling-module composition for SYNTH-03).

## Known Tech Debt

- **TECH-DEBT-19-01** — RESOLVED in Phase 20 Plan 01 (2026-04-18). drizzle-kit meta snapshots for 0001/0003 backfilled via `scripts/regen-snapshots.sh` clean-slate iterative replay.
- **Vitest-4 fork-IPC hang under HuggingFace EACCES** — pre-existing env issue, operational mitigation is 5-file excluded-suite in `scripts/test.sh`. Non-blocking for v2.3; worth addressing in a future fix-up phase.
- **Phase 21 WR-02 retry-on-all-errors policy** — documented design choice; M009+ may revisit if error patterns emerge.
