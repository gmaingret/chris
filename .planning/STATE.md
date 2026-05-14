---
gsd_state_version: 1.0
milestone: v2.6.1
milestone_name: Code Review Cleanup
status: planning
last_updated: "2026-05-14T16:00:00.000Z"
last_activity: 2026-05-14
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (symlink to /home/claude/chris/PLAN.md).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** v2.6.1 Code Review Cleanup — 39 requirements across 9 categories surfaced by 14-phase parallel code-review sweep (45 BLOCKERs + 97 WARNINGs). Roadmap drafted 2026-05-14 with 7 phases (41-47). Phase 41 (Adjustment-Dialogue Rework) is the top-priority ship — live UX bug actively re-firing every sweep tick on Greg's account.

## Current Position

Phase: Phase 41 (Adjustment-Dialogue Rework) — not yet planned
Plan: —
Status: Roadmap drafted; awaiting `/gsd-plan-phase 41`
Last activity: 2026-05-14 — v2.6.1 ROADMAP.md created with 7 phases (41-47), 39/39 requirements mapped

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)
- **v2.2 M008 Episodic Consolidation** — 2026-04-19 (5 phases, 17 plans, 35/35 requirements — archived at `.planning/milestones/v2.2-phases/`) + M008.1 inline fix 2026-04-19
- **v2.3 Test Data Infrastructure** — 2026-04-20 / archived 2026-04-25 (Phase 24, 4 plans, 20/20 requirements). Primed-fixture pipeline shipped; D041 convention codified.
- **v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review** — 2026-05-11 (8 phases: 25-32, 23 plans + Phase 32 inline, 52/52 requirements). First weekly_review fire 2026-05-10 20:00 Paris. Phase 31 terminology cleanup (voice_note → journal). Phase 32 substrate hardening (6 items).
- **v2.5 M010 Operational Profiles** — 2026-05-13 (4 phases: 33-36, 10 plans, 22/22 requirements, 54 tasks). PTEST-05 milestone-gate confirmed 2026-05-13T11:30Z: 3-of-3 atomic GREEN. Container deployed to Proxmox 2026-05-13.
- **v2.6 M011 Psychological Profiles** — 2026-05-14 (4 phases: 37-40, 9 plans, 28/28 requirements). PMT-06 milestone-gate confirmed 2026-05-14T13:09Z: 3-of-3 atomic GREEN; zero hallucinated facts; zero trait-authority constructions. HEXACO + Schwartz inference; monthly cron `'0 9 1 * *'` Europe/Paris. UNCONDITIONAL FIRE contract (inverse of M010 GEN-07 idempotency). D027 Hard Rule defended at 6 independent surfaces. Container deployed to Proxmox 2026-05-14T13:59Z; first M011 cron fire ETA 2026-06-01 09:00 Paris.

## v2.6.1 Phase Structure (planned)

| Phase | Name | Requirements | Priority |
|---|---|---|---|
| 41 | Adjustment-Dialogue Rework | ADJ-01..07 (7) | **P0 — live bug** |
| 42 | Atomicity & Race Fixes | RACE-01..06 (6) | P0 — production correctness |
| 43 | Inference Security & Contract Enforcement | INJ-01..02 + CONTRACT-01..03 (5) | P0 — exploitable + contract |
| 44 | CI Milestone-Gate Hardening | CI-01..03 (3) | P0 — gates currently silent |
| 45 | Schema Hygiene & Fixture-Pipeline Cleanup | SCHEMA-01..02 + FIX-01..08 (10) | P1 — schema_mismatch root cause |
| 46 | FR/RU Localization Comprehensive | L10N-01..06 (6) | P1 — locale-coverage |
| 47 | Display Polish | DISP-01..02 (2) | P2 — user-visible additions |

**Coverage:** 39/39 v2.6.1 requirements mapped ✓ — no orphans.

## v2.6.1 Backlog (deferred from M011 close)

Captured in `.planning/milestones/v2.6-REQUIREMENTS.md` + `.planning/milestones/v2.6-MILESTONE-AUDIT.md` tech-debt section. Items below are explicitly deferred from v2.6.1 scope to v2.7+:

| Item | Origin | Trigger |
|---|---|---|
| **ATT-POP-01** — Attachment population (D028 activation trigger) | New phase | When ≥2,000 words relational speech accumulated over 60 days |
| **CONS-01** — Host-side inter-period consistency math | New phase | After ≥3 monthly M011 fires (Aug-Sep 2026) — unblocked by v2.6.1 CONTRACT-03 |
| **CONS-02** — Trait change-detection alerts (≥0.5 month-over-month shifts) | New phase | After ≥3 monthly M011 fires |
| **SAT-CAL-01** — `wordSaturation` constant tuning | Inference engine confidence math | Post-empirical, 4–8 months of real M011 operation |
| **NARR-01** — Narrative profile summary | New phase | M014 only (high hallucination risk) |
| T9 — Test quality (calendar bombs, tautological assertions) | v2.6.1 stretch | v2.7 |
| T10 — Operational hygiene (cron-validate, advisory lock, poison-pill, TOCTOU, dead code) | v2.6.1 stretch | v2.7 |

## v2.5 Carry-Forward Items (folded into v2.6.1 where applicable)

- v2.5.1 backlog from M010 deferred items (DIFF-2..7): auto-detection of profile-change moments (DIFF-2), per-profile narrative summaries (DIFF-4), profile consistency checker (DIFF-5), wellbeing-anchored health updates (DIFF-6) — DEFERRED past v2.6.1.
- WR-01 dead-code branch — DEFERRED past v2.6.1.
- WR-02 EN-tokens leak in FR/RU `/profile` output — **FOLDED INTO L10N-01 (Phase 46)**.
- Env-level vitest-4 fork-IPC hang under HuggingFace EACCES — pre-existing; 5-file excluded-suite mitigation in `scripts/test.sh` keeps Docker gate green.
- 12 human-UAT items carried from v2.1.

## Production State

- **Container HEAD:** `8adeb85` (commit) / `v2.6` (tag)
- **Migrations applied:** 14 entries (0013_psychological_profiles latest)
- **Crons registered:** ritual_cron + profile_cron (M010 Sunday 22:00 Paris) + psychological_profile_cron (M011 1st of month 09:00 Paris) — `/health` confirms all three
- **Profile tables:** 8/8 present on prod DB (jurisdictional/capital/health/family operational + hexaco/schwartz/attachment psychological cold-start seeds)
- **PP#5 hotfix live;** Chris replies to all fresh freeform messages
- **Ground-truth:** dynamic location facts (current=Batumi until 2026-05-16, next=Antibes May 16→Sep 1, permanent=Batumi from Sep 1)
- **Live UX defect outstanding:** Adjustment-dialogue mis-fire at 17:00 Paris on 2026-05-14 ("This daily daily_journal ritual isn't working") — Phase 41 directly addresses, primed to re-fire every sweep tick until shipped

## Pending Observation Windows

| Date | Event | Verification |
|---|---|---|
| 2026-05-17 22:00 Paris | First M010 operational profile cron fire (Sunday) | `ssh root@192.168.1.50 'docker logs chris-chris-1 \| grep chris.profile'` |
| 2026-05-18 (morning after) | M010 first-fire profile populate | `ssh root@192.168.1.50 'docker compose exec postgres psql -U chris -d chris -c "SELECT name, overall_confidence, last_updated FROM profile_jurisdictional"'` |
| 2026-06-01 09:00 Paris | First M011 psychological profile cron fire | `ssh root@192.168.1.50 'docker logs chris-chris-1 \| grep chris.psychological'` — expect 2 events: `chris.psychological.hexaco.updated` + `chris.psychological.schwartz.updated` |

## Session Continuity

Last session: 2026-05-14T16:00:00Z
Stopped at: v2.6.1 ROADMAP.md drafted — 7 phases (41-47), 39/39 requirements mapped, STATE.md updated, REQUIREMENTS.md traceability populated
Next: `/gsd-plan-phase 41` (Adjustment-Dialogue Rework — top-priority live bug)

## Operator Next Steps

1. **Top priority — Phase 41:** `/gsd-plan-phase 41` to scope the ADJ cluster. The live UX bug Greg saw at 17:00 Paris on 2026-05-14 is currently primed to re-fire every sweep tick after threshold (skip_count never resets). ADJ-04 is the load-bearing fix — minimize ship lag.
2. **Passive monitoring (parallel):** Watch for first M010 cron fire 2026-05-17 22:00 Paris; first M011 cron fire 2026-06-01 09:00 Paris.
3. **Phase 44 sequencing note:** Phase 44 depends on Phase 45 fixture-path bug fix (FIX-02 / `synthesize-delta.ts:937`); sequence accordingly when planning.
