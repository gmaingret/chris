---
gsd_state_version: 1.0
milestone: v2.6.1
milestone_name: Code Review Cleanup
status: "All 6 v2.6.1 Phase 46 requirements green (L10N-01..06). 4 plans shipped: 46-01 locale-strings infra (canonical qualifierFor + normalizeForInterrogativeCheck); 46-02 /profile 21 EN-only sites localized (HEXACO/Schwartz dim labels + scoreLine template + qualifier import) — FR/RU golden snapshots added, EN snapshots byte-identical; 46-03 weekly-review cluster (WEEKLY_REVIEW_HEADER per-Lang + INTERROGATIVE_REGEX gibberish fix + curly-apostrophe normalize + TEMPLATED_FALLBACK per-Lang); 46-04 daily journal PROMPTS per-Lang with cron-context getLastUserLanguageFromDb (CAP-01 cardinality lock, PROMPT_SET_VERSION stays v1). Sunday 2026-05-17 20:00 Paris first fire will ship FR header + FR observation + FR question end-to-end. 4 plan-check warnings addressed inline (decimal format consistency, depends_on note, translation review table in 46-02 summary, T2/T4 invariant via L10N-03c direct regex assertion). 772 tests pass across 43 files (live-integration.test.ts unreachable here — requires Anthropic key)."
stopped_at: Phase 46 complete (10 commits 6185b0f..685678b); awaiting orchestrator dispatch of Phase 47 (Display Polish — depends on Phase 46 qualifierFor)
last_updated: "2026-05-15T12:25:00.000Z"
last_activity: 2026-05-15 — Phase 46 ships 6/6 L10N requirements; 10 atomic commits across 4 plans; 11 production files + tests modified.
progress:
  total_phases: 7
  completed_phases: 6
  total_plans: 22
  completed_plans: 16
  percent: 86
---

# Project State

## Project Reference

See: .planning/PROJECT.md (symlink to /home/claude/chris/PLAN.md).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** v2.6.1 Code Review Cleanup — 39 requirements across 9 categories surfaced by 14-phase parallel code-review sweep (45 BLOCKERs + 97 WARNINGs). Roadmap drafted 2026-05-14 with 7 phases (41-47). Phase 41 (Adjustment-Dialogue Rework) is the top-priority ship — live UX bug actively re-firing every sweep tick on Greg's account.

## Current Position

Phase: Phase 46 (FR/RU Localization Comprehensive) — COMPLETE (Wave 6 of 7)
Plans shipped: 46-01 (4 tasks) + 46-02 (4 tasks) + 46-03 (4 tasks) + 46-04 (4 tasks) = 16 tasks, 10 atomic commits
Status: All 6 v2.6.1 Phase 46 requirements green (L10N-01..06). 4 plans shipped end-to-end. Sunday 2026-05-17 20:00 Paris first fire will ship FR header + FR observation + FR question via `getLastUserLanguageFromDb` cron-context detection; daily 21:00 Paris journal fires now route to French prompts by default. Plan-check 4 warnings addressed inline:
- W#1 decimal format consistency: EN keeps toFixed(1) byte-identical; FR/RU use toFixed(1).replace('.', ',') for consistent comma decimals
- W#2 46-04 depends_on note: acknowledged in 46-04 SUMMARY (over-conservative in plan frontmatter; no practical impact under sequential execution)
- W#3 D-06 translation review table: included in 46-02 SUMMARY as a 20-row table for Greg's /gsd-verify-work red-pen pass
- W#4 T2/T4 invariant asymmetry: resolved via L10N-03c direct INTERROGATIVE_REGEX match-count assertion + L10N-03c2 stage1Check end-to-end behavior change test (parent addendum from commit 9da2c42)
Last activity: 2026-05-15 — Phase 46 ships 6/6 L10N requirements via 10 atomic commits; 11 files modified.

### Phase 46 commits

- `6185b0f` feat(46-01): T1+T2 — locale strings module with qualifierFor + normalizeForInterrogativeCheck (L10N-05 + L10N-03 infra)
- `8baa3f8` refactor(46-01): T3 — remove duplicate qualifierFor from memory/profiles.ts (L10N-05)
- `a79f81d` test(46-01): T4 — unit tests for qualifierFor + normalizeForInterrogativeCheck
- `b092029` docs(46-01): plan 01 summary — locale-strings module + qualifierFor canonical (L10N-05)
- `2ccdad1` feat(46-02): L10N-01 — /profile psychological section fully localized (21 sites)
- `688d612` docs(46-02): plan 02 summary — /profile 21-site localization (L10N-01)
- `90ac212` feat(46-03): weekly-review localization cluster — L10N-02 + L10N-03 + L10N-06
- `284c831` docs(46-03): plan 03 summary — weekly-review localization cluster (L10N-02/03/06)
- `fb3fe65` feat(46-04): L10N-04 — daily journal PROMPTS locale-aware (FR/RU fire-time selection)
- `685678b` docs(46-04): plan 04 summary — daily journal PROMPTS localization (L10N-04)


### Phase 44 commits

- `463bac6` feat(44-01): T01 CI-03 — REQUIRE_FIXTURES gate-test on primed-sanity.test.ts
- `3027099` feat(44-01): T02 CI-03 — REQUIRE_FIXTURES gate-test on synthetic-fixture.test.ts
- `13e09fb` feat(44-01): T03 CI-01 — REQUIRE_FIXTURES dual gate-tests on primed-sanity-m010.test.ts
- `a380417` feat(44-01): T04 CI-01 — REQUIRE_FIXTURES gate-test on integration-m010-30days.test.ts
- `d6d6587` feat(44-01): T05 CI-01 — REQUIRE_FIXTURES gate-test on integration-m010-5days.test.ts
- `50a07e5` feat(44-01): T06 CI-01 — REQUIRE_FIXTURES gate-test on live-anti-hallucination.test.ts (orthogonal)
- `4cc86f0` feat(44-01): T07 CI-02 — REQUIRE_FIXTURES dual gate-tests on primed-sanity-m011.test.ts
- `8e1eba7` feat(44-01): T08 CI-02 — REQUIRE_FIXTURES gate-test on integration-m011-30days.test.ts
- `a1495ca` feat(44-01): T09 CI-02 — REQUIRE_FIXTURES gate-test on integration-m011-1000words.test.ts
- `c4438a6` feat(44-01): T10 CI-02 — REQUIRE_FIXTURES gate-test on live-psych-anti-hallucination.test.ts (sync, no beforeAll)
- `64f7ee0` docs(44-01): T11 — scripts/test.sh REQUIRE_FIXTURES contract documentation
- `fd13d6f` docs(44-01): T12 — REQUIREMENTS.md CI-section cross-link to Phase 44 mechanism

### Phase 43 commits

- `b3b20da` test(43-01): add canonical injection-attack fixtures (D-07)
- `54979c4` feat(43-01): add sanitizeSubstrateText helper + contract tests (D-01..D-04)
- `1e00beb` fix(43-01): INJ-01 — escape user-controlled substrate strings in operational prompt
- `a7cd006` fix(43-01): INJ-02 — escape user-controlled substrate in psychological prompt
- `7991dba` docs(43-01): plan 01 summary + deferred-items (INJ-01 + INJ-02 shipped)
- `e74e795` fix(43-02): CONTRACT-01 — strip dataConsistency from prevState (D-09)
- `bee4bae` fix(43-02): CONTRACT-02 — extract<X>PrevState null on seed-row sentinel (D-10)
- `99e80df` feat(43-02): CONTRACT-03 — migration 0014_psychological_data_consistency_column (D-15)
- `34b3b46` fix(43-02): CONTRACT-03 — persist data_consistency in psychological upsert (D-14)
- `1924813` fix(43-02): cascade fixes from CONTRACT-01 + CONTRACT-02 + CONTRACT-03 (Rule 1/2)

### Phase 42 commits

- `4eee98f` feat(42-01): shared concurrent-invocation test harness (D-42-01)
- `7a45bcd` fix(42-01): RACE-01 — tryFireRitualAtomic uses postgres-clock (D-42-02)
- `e34075b` fix(42-01): RACE-02 — wrap ritualResponseWindowSweep in db.transaction (D-42-04)
- `8caca66` fix(42-02): RACE-03 + RACE-04 — wellbeing completion-claim + jsonb_set merge
- `e9d4073` fix(42-02): RACE-05 — findOpenWellbeingRow 24h window guard + RACE-03/04/05 tests
- `a6ec6f9` test(42-02): TEST-28 fixture alignment for RACE-05 24h window
- `b1034f8` fix(42-03): RACE-06 — transactional weekly-review fire pipeline (D-42-11)
- `2017212` test(42-03): RACE-06 regression — send-failure rollback contract

### Phase 41 commits (shipped)

- `066224d` feat(41-01): display-names.ts (ADJ-02)
- `a032353` fix(41-01): observational copy + 3 completion-site skip_count resets (ADJ-01/02/04)
- `6ade27b` fix(41-01): autoReEnableExpiredMutes skip_count reset (ADJ-04 site #4)
- `60fcbdd` fix(41-02): tighten Haiku whitelist + candidate-parse gate (ADJ-05/06)
- `76d0f98` fix(41-02): FR/RU localization across 8 sites + Haiku prompt (ADJ-03)
- `ff0e59b` test(41-02): no-refire integration test, 5 cases (ADJ-07)
- `f3bb8ad` test(41): synthetic-fixture TEST-27 copy assertion update (cascade fix)

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

Last session: 2026-05-15T11:42:17.667Z
Stopped at: v2.6.1 ROADMAP.md drafted — 7 phases (41-47), 39/39 requirements mapped, STATE.md updated, REQUIREMENTS.md traceability populated
Next: `/gsd-plan-phase 41` (Adjustment-Dialogue Rework — top-priority live bug)

## Operator Next Steps

1. **Top priority — Phase 41:** `/gsd-plan-phase 41` to scope the ADJ cluster. The live UX bug Greg saw at 17:00 Paris on 2026-05-14 is currently primed to re-fire every sweep tick after threshold (skip_count never resets). ADJ-04 is the load-bearing fix — minimize ship lag.
2. **Passive monitoring (parallel):** Watch for first M010 cron fire 2026-05-17 22:00 Paris; first M011 cron fire 2026-06-01 09:00 Paris.
3. **Phase 44 sequencing note:** Phase 44 depends on Phase 45 fixture-path bug fix (FIX-02 / `synthesize-delta.ts:937`); sequence accordingly when planning.
