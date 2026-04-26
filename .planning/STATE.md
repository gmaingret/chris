---
gsd_state_version: 1.0
milestone: between
milestone_name: between v2.3 and v2.4
status: v2.3 Test Data Infrastructure ARCHIVED 2026-04-25 — ready to plan v2.4 M009 Ritual Infrastructure
stopped_at: Completed /gsd-complete-milestone for v2.3
last_updated: "2026-04-25T05:30:00Z"
last_activity: "2026-04-25 — v2.3 milestone closed: archives written to milestones/v2.3-{ROADMAP,REQUIREMENTS,MILESTONE-AUDIT}.md, ROADMAP.md collapsed, PROJECT.md evolved (D041 added, v2.3 moved to historical), MILESTONES.md entry appended, RETROSPECTIVE.md milestone section + cross-milestone trends updated, REQUIREMENTS.md removed via git rm, tagged v2.3."
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: null
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-25 at v2.3 milestone close).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** Between milestones. v2.4 M009 (Ritual Infrastructure + Daily Note + Weekly Review) is the next planned milestone — primed-fixture pipeline (v2.3) supplies ≥7 episodic summaries on demand via `loadPrimedFixture('m008-14days')`, removing the prior 7-real-calendar-day data-accumulation gate.

## Current Position

**Between milestones.** v2.3 archived 2026-04-25. v2.4 M009 not yet started.

**Kickoff command:** `/gsd-new-milestone "M009 Ritual Infrastructure + Daily Note + Weekly Review"`.

Prior deploy state unchanged: v2.2 + M008.1 fix live on Proxmox (192.168.1.50, HEAD = 2cfcecd). Daily 23:00 Europe/Paris episodic cron + 6h sync cron + 10:00 proactive sweep cron all healthy. v2.3 was test-infrastructure only — no prod deploy expected.

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)
- **v2.2 M008 Episodic Consolidation** — 2026-04-19 (5 phases, 17 plans, 35/35 requirements — archived at `.planning/milestones/v2.2-phases/`) + M008.1 inline fix 2026-04-19
- **v2.3 Test Data Infrastructure** — 2026-04-20 / archived 2026-04-25 (Phase 24, 4 plans, 20/20 requirements). Primed-fixture pipeline shipped; D041 convention codified. Phase 24 directory archived to `.planning/milestones/v2.3-phases/24-primed-fixture-pipeline/` at close.

## Accumulated Context

### Decisions in force going into v2.4

Full log in PROJECT.md Key Decisions table. Most relevant for M009:

- **D004 append-only Pensieve** — episodic_summaries is a projection, not authoritative.
- **D018 no skipped tests** — primed-fixture pipeline (D041) is the replacement for waiting real calendar days.
- **D029 execution order** — M009 (rituals + daily note + weekly review) ships before profile layer.
- **D030 weekly review ships in M009 not M013** — only depends on M008 episodic summaries + M007 decisions.
- **D034 episodic_summaries 8 columns + 3 indexes locked** — no schema changes expected for M009 weekly review.
- **D035 Pensieve authoritative** — boundary preservation enforced by `boundary-audit.test.ts`.
- **D036 retrieveContext two-dim routing** — recency + query intent, M009 read-paths must use it.
- **D041 (shipped 2026-04-20) — primed-fixture pipeline** — *no milestone may gate on real calendar time for data accumulation; use the primed-fixture pipeline instead.* Codified in PLAN.md §Key Decisions D041 + CONVENTIONS.md §Test Data + TESTING.md §Primed-Fixture Pipeline.

### Open Items (carried into v2.4)

- **Process gap: `gsd-verifier` not wired into `/gsd-execute-phase`.** Phase 24 shipped without a live VERIFICATION.md. Investigate before v2.4 starts; add a regression test or hard workflow gate.
- **Process gap: SUMMARY.md frontmatter missing `requirements-completed`.** All 4 v2.3 plans omit the field. Update template/planner-agent prompt before v2.4.
- **Upstream bug: `gsd-sdk milestone.complete` calls `phasesArchive([], projectDir)` without forwarding the version arg** — always throws. v2.3 close was performed manually. File upstream issue against `get-shit-done-cc`.
- **Pre-M009 readiness check COMPLETED 2026-04-26T04:46Z — GO verdict.** Cron `5bccdc4e` was scheduled to fire at 06:06 UTC; Greg asked to run it inline ~80 min early. Three bug fixes verified end-to-end:
  - **v2.3 BUG-01 docker-compose port-array merge (FIXED commit eedce33).** Override now uses `!override` modifier; throwaway container binds 5435 only. Verified 2026-04-25 + re-verified 2026-04-26 (no port collisions across two clean runs).
  - **v2.3 BUG-02 VCR property-swap recursion (FIXED commit eedce33).** `ORIGINAL_PARSE/CREATE` snapshotted at vcr.ts module-load. 17 vcr unit tests + 2 explicit recursion-guard tests pass. Two end-to-end pipeline runs hit cache cleanly (12 vcr.hit, 0 vcr.miss, $0 Anthropic spend on re-runs).
  - **v2.3 BUG-03 process.exit() inside try/finally (FIXED 2026-04-26).** `synthesize-episodic.ts:543` and `fetch-prod-data.ts:314/321` called `process.exit()` directly inside try/catch — Node terminates synchronously, `finally` block never runs, leaks throwaway docker container + SSH tunnel respectively. Surfaced in this morning's pre-M009 check (port 5435 collision from 20h-old `chris-synth-91879-postgres-1`). Fixed by replacing `process.exit(N)` with `process.exitCode = N` so the event loop drains and `finally` fires before exit. Verified: post-run `docker ps -a | grep chris-synth-` is EMPTY; post-fetch `ps -ef | grep ssh.*15432` is EMPTY. Same `process.exit()` pattern present in `backfill-episodic.ts:264/269/272`, `synthesize-delta.ts:639/642`, `adversarial-test.ts`, `test-photo-memory.ts` — none have try/finally cleanup so safe as-is, but worth a future audit.
  - **Date-extraction Haiku JSON-fences soak (PASS).** 24h prod `haiku-error` count = 0 (vs prior baseline >0 / day). Container uptime 3h (clean exit code 0 host-event restart at 02:01:56Z; postgres uptime 19h confirms only chris-chris-1 was bounced; not a crash). One date-anchored telegram query in last 24h was sent ~2h pre-deploy so doesn't validate fix in production directly, but unit-test coverage + property-swap regression tests are conclusive.
  - **Yesterday's episodic summary (2026-04-24) materialized correctly** (importance=1, length=209 — thin day, but cron fired). Tonight's 23:00 Paris cron will consolidate today (2026-04-25).
  - **HARN-03 still 2/4 pass / 2/4 fail on data sufficiency** (same numbers as yesterday: 176 entries, 6 summaries — known fixture-spec gap, not a regression). Carry to v2.4: bump `--target-days 21` or relax HARN-03 thresholds.
- **M008 recency-window UX gap (DESIGN — defer to v2.4 M009 discussion).** Per D036 routing, queries within 7-day window route to raw Pensieve hybrid search and skip episodic summaries. In high-volume conversation days, yesterday falls out of the 20-message buffer AND isn't surfaced via the (skipped) summary. Result: Chris can lose continuity within the 7-day window. Symptom: "feels like we didn't talk since yesterday." Not a v2.3 regression — emergent property of M008 design. M009's daily-note + weekly-review work needs to address this; may want to inject yesterday's summary even in <7d window when conversation buffer doesn't span it.
- **12 human-UAT items carried from v2.1/v2.2** (live Telegram feel, ACCOUNTABILITY tone, `/decisions` dashboard format, FR/RU localization).
- **Env-level vitest-4 fork-IPC hang under HuggingFace EACCES.** 5-file excluded-suite mitigation in `scripts/test.sh` keeps Docker gate green. Worth a future fix-up phase; may intersect with v2.4 if M009 adds new test suites.

### Blockers/Concerns

None. Ready to plan v2.4 M009.

## Session Continuity

Last session: 2026-04-25T05:30:00Z
Stopped at: v2.3 milestone fully archived; tag `v2.3` created; ready to kick off v2.4 M009.

## Known Tech Debt

- **TECH-DEBT-19-01** — RESOLVED in v2.2 Plan 20-01 (2026-04-18, archived).
- **Vitest-4 fork-IPC hang under HuggingFace EACCES** — pre-existing env issue, operational mitigation 5-file excluded-suite in `scripts/test.sh`. Non-blocking; worth addressing in a future fix-up phase.
- **v2.2 Plan 21 WR-02 retry-on-all-errors policy** — documented design choice; M009+ may revisit if error patterns emerge.
- **v2.3 process gaps** — gsd-verifier not wired into execute-phase + SUMMARY frontmatter `requirements-completed` field omitted + upstream `gsd-sdk milestone.complete` broken (see Open Items).
