# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15)
- ✅ **v2.1 M007 Decision Archive** — Phases 13-19 (shipped 2026-04-18)
- ✅ **v2.2 M008 Episodic Consolidation** — Phases 20-23 + 22.1 (shipped 2026-04-19)
- ✅ **v2.3 Test Data Infrastructure** — Phase 24 (shipped 2026-04-20, archived 2026-04-25, 20/20 requirements)
- ✅ **v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review** — Phases 25-32 (shipped 2026-05-11, 23 plans, 52/52 requirements + Phase 31 terminology cleanup + Phase 32 substrate hardening)
- 📋 **v2.5 M010** *(planning)* — see `/gsd-new-milestone` to define

## Phases

<details>
<summary>✅ v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review (Phases 25-32) — SHIPPED 2026-05-11</summary>

- [x] Phase 25: Ritual Scheduling Foundation (3 plans) — completed 2026-04-26 — RIT-01..12
- [x] Phase 26: Daily Voice Note Ritual (5 plans) — completed 2026-04-28 — VOICE-01..06
- [x] Phase 27: Daily Wellbeing Snapshot (3 plans) — completed 2026-04-28 — WELL-01..05
- [x] Phase 28: Skip-Tracking + Adjustment Dialogue (4 plans) — completed 2026-04-29 — SKIP-01..07
- [x] Phase 29: Weekly Review (4 plans) — completed 2026-04-29 — WEEK-01..09
- [x] Phase 30: Test Infrastructure + HARN-03 Refresh (4 plans) — completed 2026-05-07 — TEST-23..32, HARN-04..06
- [x] Phase 31: Rename voice_note → journal (2 plans, terminology cleanup) — completed 2026-05-09
- [x] Phase 32: Substrate Hardening (inline execution, 6 items + 2 follow-ups) — completed 2026-05-11

See `.planning/milestones/v2.4-ROADMAP.md` for full phase details + `.planning/milestones/v2.4-MILESTONE-AUDIT.md` for the close audit.

</details>

### 📋 v2.5 M010 (planning)

To be defined via `/gsd-new-milestone`. Carry-ins from v2.4 close:

- Synth-pipeline organic+synth fusion (`synthesize-episodic.ts:288` + `synthesize-delta.ts` wellbeing-per-fused-day) — unblocks HARN-04 floor restoration ≥21 + HARN-06 floor restoration ≥14
- FR/RU localization of the templated weekly_review fallback (currently EN-only per D-29-02-D)
- Phase 28 UAT items: 60s confirmation window real-clock observation + 7d+7d evasive trigger spacing test
- `wellbeing.test.ts` Tests 6+7 ORDER BY bug fix (pre-existing test-only false negatives)
- Stale callback prefix comments in `src/bot/handlers/ritual-callback.ts:31-32` (doc noise)
- Forensic investigation of `__drizzle_migrations` row loss (cold trail; may stay deferred indefinitely)
- 2026-05-17 20:00 Paris first French/second-person weekly_review fire observation (substrate fix shipped commit 0626713)

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 25-32 | v2.4 | 23/23 + Phase 32 inline | Complete | 2026-05-11 |

## Archived Milestones

- `.planning/milestones/v2.0-ROADMAP.md`
- `.planning/milestones/v2.1-ROADMAP.md`
- `.planning/milestones/v2.2-ROADMAP.md`
- `.planning/milestones/v2.3-ROADMAP.md`
- `.planning/milestones/v2.4-ROADMAP.md`
