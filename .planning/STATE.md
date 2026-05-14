---
gsd_state_version: 1.0
milestone: v2.6
milestone_name: M011 Psychological Profiles
status: completed
stopped_at: Phase 40 context gathered
last_updated: "2026-05-14T09:58:07.083Z"
last_activity: 2026-05-14 -- Phase 39 marked complete
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 7
  completed_plans: 7
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (symlink to /home/claude/chris/PLAN.md, updated 2026-05-13 at v2.6 milestone kickoff).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** Phase 39 — Psychological Surfaces

## Current Position

```
v2.6 M011 Psychological Profiles
Phase 37 / 40 — Not started
Plan: 1 of 2
Status: Phase 39 complete

Progress: [░░░░░░░░░░] 0% (0/4 phases)
```

Phase: 39 — COMPLETE
Plan: —
Status: Roadmap written; awaiting `/gsd-plan-phase 37`
Last activity: 2026-05-14 -- Phase 39 marked complete

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)
- **v2.2 M008 Episodic Consolidation** — 2026-04-19 (5 phases, 17 plans, 35/35 requirements — archived at `.planning/milestones/v2.2-phases/`) + M008.1 inline fix 2026-04-19
- **v2.3 Test Data Infrastructure** — 2026-04-20 / archived 2026-04-25 (Phase 24, 4 plans, 20/20 requirements). Primed-fixture pipeline shipped; D041 convention codified.
- **v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review** — 2026-05-11 (8 phases: 25-32, 23 plans + Phase 32 inline, 52/52 requirements). First weekly_review fire 2026-05-10 20:00 Paris. Phase 31 terminology cleanup (voice_note → journal). Phase 32 substrate hardening (6 items).
- **v2.5 M010 Operational Profiles** — 2026-05-13 (4 phases: 33-36, 10 plans, 22/22 requirements, 54 tasks). PTEST-05 milestone-gate confirmed 2026-05-13T11:30Z: 3-of-3 atomic GREEN, zero hallucinated facts. Container deployed to Proxmox 2026-05-13; first Sunday cron fire ETA 2026-05-17 22:00 Paris.

## Active Milestone Plan (v2.6 M011)

| Phase | Name | Plans (est) | Requirements | Status |
|-------|------|-------------|--------------|--------|
| 37 | Psychological Substrate | TBD | PSCH-01..10 (10) | Not started |
| 38 | Psychological Inference Engine | TBD | PGEN-01..07 (7) | Awaits Phase 37 |
| 39 | Psychological Surfaces | TBD | PSURF-01..05 (5) | Awaits Phase 38 |
| 40 | Psychological Milestone Tests | TBD | PMT-01..06 (6) | Awaits Phases 37+38+39 |
| **Total** | | **TBD** | **28 (0 done)** | |

**Phase ordering rationale:**

- Phase 37 first: Drizzle ORM type inference requires table definitions before generator or reader code can compile. The word-count gate and source-filter substrate loader must exist before the engine calls them. Seven critical pitfall mitigations require schema-phase artifacts. The psych-boundary-audit test ships here to enforce D047 from the first plan.
- Phase 38 after Phase 37: Generators need the schema to compile; `assemblePsychologicalProfilePrompt` ships first within Phase 38 (HARD CO-LOC #M11-2). Monthly cron registration requires the orchestrator to exist.
- Phase 39 after Phase 38: Injection circuit is four pieces forming one logical unit; they cannot be progressively wired. Display formatters need generated rows to exercise non-trivial code paths.
- Phase 40 last: Full test pyramid requires the complete stack from Phases 37–39; synthetic fixture, three-cycle unconditional-fire test, and live 3-of-3 gate all require this.

**Cron timing:** 1st of month 09:00 Paris (`0 9 1 * *`). Resolved from research: ARCHITECTURE.md + FEATURES.md 2-source majority over STACK.md midnight. Collision-avoidance with Sunday 22:00 operational cron verified at registration.

## Accumulated Context

### Architecture decisions locked for v2.6

Full log in PROJECT.md Key Decisions table. Most relevant for M011:

- **D005 fire-and-forget** — `updateAllPsychologicalProfiles()` called from cron; never blocks primary response.
- **D027 Hard Rule** — Trait scores are inferred behavior patterns, NOT evidence. Never tell Greg he is right because his trait scores match his position. Explicit inline extension required in both `assemblePsychologicalProfilePrompt` AND `formatPsychologicalProfilesForPrompt` injection block.
- **D028 Attachment deferred** — `profile_attachment` table ships schema-only in M011. Population gated on 2,000-word relational speech over 60 days; weekly-sweep trigger is post-M011.
- **D041 primed-fixture pipeline** — M011 validates via `m011-30days` fixture; no real-calendar-time wait.
- **D042 Never-Retrofit Checklist** — All non-retrofittable columns ship in migration 0013 with table creation. Applied to all three tables.
- **D043 PROFILE_INJECTION_MAP per-mode subset** — `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` is a SEPARATE constant from `PROFILE_INJECTION_MAP`. REFLECT + PSYCHOLOGY only; COACH explicitly absent.
- **D044 three-cycle substrate-hash pattern (inverted for M011)** — M010 uses three-cycle test to assert idempotency (Cycle 2 same substrate = STILL same call count). M011 uses three-cycle test to assert unconditional fire (Cycle 2 same substrate = MORE calls). The M010 pattern does NOT apply here.
- **D045 three-way `describe.skipIf`** — `!RUN_LIVE_TESTS || !ANTHROPIC_API_KEY || !FIXTURE_PRESENT` for PMT-06 live test.
- **D046 live milestone-gate cost discipline** — PMT-06 ~$0.20–0.30 per run; budget callout required in test file docblock.
- **D047 (locked)** — Psychological-vs-operational boundary: operational = facts-of-record; psychological = inferred trait-level dispositions. Cross-reading permitted; cross-writing forbidden. Enforced by `psych-boundary-audit.test.ts`.

### HARD CO-LOCATION CONSTRAINTS (must be honored across phase plans)

1. **Phase 37 (#M11-1)**: Migration 0013 SQL + `schema.ts` Drizzle exports + `meta/0013_snapshot.json` + `_journal.json` entry + `scripts/test.sh` psql line + `psychological-schemas.ts` Zod type exports ship in ONE atomic plan. No partial deployment of the schema.
2. **Phase 38 (#M11-2)**: `assemblePsychologicalProfilePrompt` shared builder ships BEFORE either HEXACO or Schwartz generator. PGEN-01 is atomic with PGEN-02 and PGEN-03 generator skeletons.
3. **Phase 39 (#M11-3)**: `formatPsychologicalProfileForDisplay` pure function + golden-output inline snapshot test land in the SAME plan. Framing regression prevention.

### Never-Retrofit Checklist (to be enforced in Phase 37 — all OPEN)

- [ ] Migration 0013 creates `profile_hexaco`, `profile_schwartz`, `profile_attachment` tables
- [ ] `schema_version INT NOT NULL DEFAULT 1` in all 3 tables
- [ ] `substrate_hash TEXT NOT NULL DEFAULT ''` in all 3 tables
- [ ] `name TEXT NOT NULL UNIQUE DEFAULT 'primary'` sentinel in all 3 tables
- [ ] `overall_confidence REAL CHECK (>= 0 AND <= 1) NOT NULL DEFAULT 0` in all 3 tables
- [ ] `word_count INTEGER NOT NULL DEFAULT 0` in all 3 tables
- [ ] `word_count_at_last_run INTEGER NOT NULL DEFAULT 0` in all 3 tables
- [ ] `profile_attachment` additionally: `relational_word_count INT NOT NULL DEFAULT 0`, `activated BOOLEAN NOT NULL DEFAULT false`
- [ ] Cold-start seed rows in migration 0013 for all 3 tables (all dims null, `overall_confidence=0`, `name='primary'`)
- [ ] Migration 0013 in `scripts/test.sh` psql apply chain
- [ ] Drizzle meta snapshot regenerated for migration 0013

### Open Questions (resolve during phase planning)

| ID | Question | Phase | Starting Point |
|----|----------|-------|----------------|
| OQ-M11-1 | Same-month second-fire prevention mechanism — monthly cron fires unconditionally, but what prevents a second fire in the same calendar month if the cron somehow fires twice? | Phase 38 | Calendar-month boundary check in substrate loader or orchestrator; document the guard explicitly |
| OQ-M11-2 | `wordSaturation` constant for psychological profiles | Phase 37 | First estimate: 20,000 words. Flag with comment: `// SATURATION: first estimate 20,000 — calibrate after 4-8 monthly fires` |
| OQ-M11-3 | Confidence display textual qualifier thresholds | Phase 39 | Proposed: 0-30% = "weak evidence", 31-59% = "moderate evidence", 60-79% = "good evidence", 80-100% = "strong evidence". Tune post-3-fires. |
| OQ-M11-4 | `synthesize-delta.ts --psych-profile-bias` signal-phrase injection — exact implementation | Phase 40 | Novel (no M010 equivalent). Consider `/gsd-research-phase 40` for fixture design. |

### v2.5 Carry-Forward Items (NOT in M011 scope — v2.5.1 backlog)

- v2.5.1 backlog from M010 deferred items (DIFF-2..7): auto-detection of profile-change moments (DIFF-2), per-profile narrative summaries (DIFF-4), profile consistency checker (DIFF-5), wellbeing-anchored health updates (DIFF-6).
- SATURATION constant requires 4-8 weeks of real M010 operation to calibrate.
- WR-01 dead-code branch + WR-02 EN-tokens leak in FR/RU `/profile` output (Phase 35 code review). Non-blocking polish items.
- v2.4 carry-forward unresolved: synth-pipeline organic+synth fusion, FR/RU localization of templated weekly_review fallback, Phase 28 60s confirmation window real-clock UAT.
- Env-level vitest-4 fork-IPC hang under HuggingFace EACCES — pre-existing; 5-file excluded-suite mitigation in `scripts/test.sh` keeps Docker gate green.
- 12 human-UAT items carried from v2.1.
- 2026-05-17 22:00 Paris: first M010 operational profile cron fire observation pending (Phase 34 cron registered; `ssh chris@192.168.1.50 'docker logs chris-chris-1 | grep chris.profile'` after that time).

## Deferred Items

Items acknowledged and deferred at v2.5 milestone close on 2026-05-13:

| Category | Item | Status | Note |
|----------|------|--------|------|
| uat_gaps | phase 34 HUMAN-UAT.md | partial (1 open scenario) | "First Sunday 22:00 Paris cron fire" observation scheduled 2026-05-17 — naturally future-dated |
| verification_gaps | phase 34 VERIFICATION.md | open | Same 2026-05-17 cron-fire observation reference |
| verification_gap | Phase 28 (28-VERIFICATION.md) | human_needed | 60s confirmation window real-clock UAT + 7d+7d evasive trigger spacing test |
| verification_gap | Phase 29 (29-VERIFICATION.md) | human_needed | UX-level retry awaiting 2026-05-17 20:00 Paris weekly review fire |
| verification_gap | Phase 30 (30-VERIFICATION.md) | human_needed | HARN-04/HARN-06 floor restoration blocked on synth-pipeline fusion |

## Session Continuity

Last session: 2026-05-14T09:58:07.071Z
Stopped at: Phase 40 context gathered
Next: `/gsd-plan-phase 37` to scope Phase 37 (Psychological Substrate — migration 0013 + Zod schemas + substrate loader + word-count gate + boundary audit; 10 requirements PSCH-01..10)

**Research flags for upcoming phases:**

- Phase 37: Standard patterns (mirrors migration 0012). Skip `/gsd-research-phase`.
- Phase 38: Consider `/gsd-research-phase 38` for unconditional-fire + substrate-hash interaction — how second-fire-same-month is prevented without hash-skip.
- Phase 39: Standard patterns (mirrors M010 surfaces phase). Skip `/gsd-research-phase`.
- Phase 40: Consider `/gsd-research-phase 40` for `--psych-profile-bias` fixture design — novel, no M010 equivalent.

**Prod state at session start (inherited from v2.5 close):**

- Container HEAD: `22793b4` (profile inference live, first Sunday cron ETA 2026-05-17 22:00 Paris)
- Migrations applied: 13 entries (0012_operational_profiles latest)
- Profile tables: 5/5 present on prod DB (jurisdictional=0.3, capital=0.2, health=0, family=0)
- PP#5 hotfix live; Chris replies to all fresh freeform messages
- Ground-truth: dynamic location facts (current=Batumi until 2026-05-16, next=Antibes May 16→Sep 1, permanent=Batumi from Sep 1)

## Operator Next Steps

1. Run `/gsd-plan-phase 37` to create Phase 37 plan (Psychological Substrate)
2. After Phase 37: `/gsd-plan-phase 38` (Psychological Inference Engine) — consider `/gsd-research-phase 38` first for unconditional-fire mechanism
3. After Phase 38: `/gsd-plan-phase 39` (Psychological Surfaces)
4. After Phase 39: `/gsd-plan-phase 40` (Psychological Milestone Tests) — consider `/gsd-research-phase 40` first for fixture design
