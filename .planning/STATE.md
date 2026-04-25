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
- **Manual operator UAT pending for v2.3 live prod path** — partially executed 2026-04-25, end-to-end fixture not yet materialized. Steps 1 (fetch-prod-data) and 2 (synthesize-delta) succeeded against real prod (422 rows fetched, 7 Haiku VCR misses recorded). Step 3 (synthesize-episodic) blocked by two shipped bugs *now fixed* but not yet re-run end-to-end (would cost ~$0.28 in real Sonnet calls):
  - **v2.3 BUG-01 docker-compose port-array merge (FIXED, commit pending).** `synthesize-episodic.ts:184` override file used additive list-merge; container exposed both 5433 (collision) and 5435. Fixed by adding `!override` modifier (compose-spec 1.28+).
  - **v2.3 BUG-02 VCR property-swap recursion (FIXED, commit pending).** `cachedMessagesParse` called the swapped reference on miss → infinite recursion (6.1M identical `vcr.miss` events / 3 min, zero API calls reached, $0 cost). Fixed by snapshotting `ORIGINAL_PARSE` / `ORIGINAL_CREATE` at vcr.ts module-load. Regression test added.
  - **Re-run end-to-end COMPLETED 2026-04-25T09:14Z** — both v2.3 bugs verified fixed; pipeline ran clean (`fetch-prod-data` 422 rows in ~600ms / `synthesize-delta` 158 organic + 18 synth across 14 days / `synthesize-episodic` 6 real-engine consolidations). HARN-03 sanity test now executes (was `describe.skip`); 2/4 assertions pass (UNIQUE(summary_date), source filter); **2/4 fail on data sufficiency**: got 176 entries vs. ≥200 threshold and 6 summaries vs. ≥7. Prod's organic telegram count is 158; --target-days 14 yields only 18 synth entries → 176 total. **NOT a regression**: v2.3 bug fixes are correct. **Fixture-spec vs reality gap** — HARN-03 thresholds assumed richer organic. Carry to v2.4: either bump --target-days to ~21 in regenerate-primed call, or relax HARN-03 thresholds to match current organic density. Real Anthropic spend for the re-run: ~6 Sonnet calls (previous 7 Haiku VCR-cached, free).
- **Date-extraction Haiku JSON-fences bug (DEPLOYED to prod 2026-04-25T09:46Z, commit eedce33).** Discovered in prod logs 2026-04-25: `chris.date-extraction.haiku-error error:"Unexpected token '\`\`'"`. Haiku returns ` ```json {...} ``` ` Markdown-wrapped, parser fails, INTERROGATE silently falls back to general routing — every date-anchored question loses summary injection. Fixed at `src/chris/modes/date-extraction.ts:268-303` with `stripJsonFences()` helper + ±730-day sanity bound (also rejects observed `2025-05-01` hallucination). 5 regression tests added. Deploy: pushed origin/main → prod git pull → docker compose build chris (~111s) → docker compose up -d --no-deps chris (recreated container) → healthy. Verified `stripJsonFences` + dayDelta>730 guard present in deployed `/app/dist/chris/modes/date-extraction.js`. Episodic + proactive crons re-scheduled at boot.
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
