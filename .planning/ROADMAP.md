# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15)
- ✅ **v2.1 M007 Decision Archive** — Phases 13-19 (shipped 2026-04-18)
- ✅ **v2.2 M008 Episodic Consolidation** — Phases 20-23 + 22.1 (shipped 2026-04-19)
- ✅ **v2.3 Test Data Infrastructure** — Phase 24 (shipped 2026-04-20, archived 2026-04-25, 20/20 requirements)
- ✅ **v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review** — Phases 25-32 (shipped 2026-05-11, 23 plans, 52/52 requirements + Phase 31 terminology cleanup + Phase 32 substrate hardening)
- ✅ **v2.5 M010 Operational Profiles** — Phases 33-36 (shipped 2026-05-13, 10 plans, 22/22 requirements, 54 tasks)
- ✅ **v2.6 M011 Psychological Profiles** — Phases 37-40 (shipped 2026-05-14, 9 plans, 28/28 requirements; PMT-06 live milestone gate 3/3 atomic green vs real Sonnet 4.6)
- 🚧 **v2.6.1 Code Review Cleanup** — Phases 41-47 (started 2026-05-14, 39 requirements across 9 categories)

## Phases

### v2.6.1 — Code Review Cleanup (in progress)

- [x] **Phase 41: Adjustment-Dialogue Rework** — Live UX defect fix + skip_count reset + Haiku-whitelist privilege escalation closure
- [x] **Phase 42: Atomicity & Race Fixes** — Six independent production-correctness fixes sharing a concurrent-invocation test harness
- [x] **Phase 43: Inference Security & Contract Enforcement** — Prompt-injection escaping + "host computes, you don't emit" contract restoration across operational + psychological inference (shipped 2026-05-15)
- [x] **Phase 44: CI Milestone-Gate Hardening** — REQUIRE_FIXTURES env-gated hard-fail replaces silent skip across M009/M010/M011 gates (shipped 2026-05-15; 12 atomic commits, 10 test files + scripts/test.sh + REQUIREMENTS.md)
- [ ] **Phase 45: Schema Hygiene & Fixture-Pipeline Cleanup** — Phase 33 seed defaults backfill (root cause) + DB CHECK constraints (defense-in-depth) + operator-script + fixture-pipeline cleanup
- [x] **Phase 46: FR/RU Localization Comprehensive** — Locale detection layer + 30+ EN-only sites localized across adjustment-dialogue, weekly-review, journal, /profile
- [ ] **Phase 47: Display Polish** — Schwartz circumplex ordering + HEXACO × Schwartz cross-validation observations on /profile

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

<details>
<summary>✅ v2.5 M010 Operational Profiles (Phases 33-36) — SHIPPED 2026-05-13</summary>

- [x] Phase 33: Profile Substrate (2 plans) — completed 2026-05-11 — PROF-01..05
- [x] Phase 34: Inference Engine (3 plans) — completed 2026-05-12 — GEN-01..07
- [x] Phase 35: Surfaces (3 plans) — completed 2026-05-13 — SURF-01..05
- [x] Phase 36: Tests (2 plans) — completed 2026-05-13 — PTEST-01..05; PTEST-05 live 3-of-3 atomic confirmed against real Sonnet 4.6 (11:30 UTC, $0.10-0.15)

See `.planning/milestones/v2.5-ROADMAP.md` for full phase details + `.planning/milestones/v2.5-REQUIREMENTS.md` for the 22/22 requirement traceability.

</details>

<details>
<summary>✅ v2.6 M011 Psychological Profiles (Phases 37-40) — SHIPPED 2026-05-14</summary>

- [x] Phase 37: Psychological Substrate (2 plans) — completed 2026-05-13 — PSCH-01..10
- [x] Phase 38: Psychological Inference Engine (3 plans) — completed 2026-05-14 — PGEN-01..07
- [x] Phase 39: Psychological Surfaces (2 plans) — completed 2026-05-14 — PSURF-01..05
- [x] Phase 40: Psychological Milestone Tests (2 plans) — completed 2026-05-14 — PMT-01..06; PMT-06 live 3-of-3 atomic confirmed against real Sonnet 4.6 (2026-05-14T13:09Z, ~$0.25)

See `.planning/milestones/v2.6-ROADMAP.md` for full phase details + `.planning/milestones/v2.6-REQUIREMENTS.md` for the 28/28 requirement traceability + `.planning/milestones/v2.6-MILESTONE-AUDIT.md` for the close audit.

</details>

## Phase Details

### Phase 41: Adjustment-Dialogue Rework
**Goal**: Stop the every-tick re-fire after threshold, eliminate the wrongful "isn't working" assertion + slug-leak copy from the live UX defect, and close the Haiku-whitelist privilege escalation around `mute_until`
**Depends on**: Nothing (top priority — live bug actively re-firing on Greg's account)
**Requirements**: ADJ-01, ADJ-02, ADJ-03, ADJ-04, ADJ-05, ADJ-06, ADJ-07
**Success Criteria** (what must be TRUE):
  1. After Greg replies yes/no/refusal to an adjustment-dialogue prompt, the next sweep tick does NOT re-fire `shouldFireAdjustmentDialogue` for the same ritual — verified by integration test ADJ-07 (regression class around `skip_count` reset)
  2. Greg never sees the string "isn't working" in an adjustment-dialogue prompt; the user-facing copy is observational ("I notice you've skipped the last N — does this ritual still serve you?")
  3. Greg never sees ritual slugs (`daily_journal`, `fire_at`, `skip_threshold`) in user-facing copy — display-name mapping covers all four affected sites (lines 285, 308, 471, 733)
  4. A Haiku-parsed user reply with `{field: 'mute_until', new_value: <future>}` is rejected at the whitelist boundary — adjustment-dialogue cannot silently disable the ritual channel
  5. A Haiku-parsed user reply with type-mismatched `new_value` (e.g., `{field: 'fire_at', new_value: 42}`) is rejected at `confirmConfigPatch` boundary instead of bricking the ritual on the next sweep
  6. The 8 `sendMessage` sites + Haiku judge prompt render in Greg's detected locale (FR/RU) matching the existing `ACKNOWLEDGMENTS` pattern from `src/chris/refusal.ts`
**Plans**: TBD
**UI hint**: yes

### Phase 42: Atomicity & Race Fixes
**Goal**: Eliminate six independent atomicity/race defects in the ritual-scheduling, wellbeing, and weekly-review code paths so concurrent fires, mid-transaction throws, and DST edges cannot silently drop audit log entries, skip-counter increments, or weekly-review fires
**Depends on**: Nothing (independent of Phase 41 — same files in some cases but different lines)
**Requirements**: RACE-01, RACE-02, RACE-03, RACE-04, RACE-05, RACE-06
**Success Criteria** (what must be TRUE):
  1. `tryFireRitualAtomic` SET clause uses `sql\`now()\`` and the predicate uses `lt(lastRunAt, sql\`now()\`)` — M009 second-fire bug class permanently closed against ms-resolution JS-clock collisions under the every-minute cron (verified by concurrent-invocation harness test)
  2. `ritualResponseWindowSweep` paired-insert (window_missed + fired_no_response + skip_count increment) runs inside a single DB transaction — mid-row throw rolls back the consume; silent audit-log + skip-counter data loss eliminated
  3. Concurrent third-tap on wellbeing rapid-tap path cannot fire `wellbeing_completed` event N times, edit the Telegram message N times, or redundantly set `skip_count=0` — idempotent completion verified
  4. Wellbeing skip path uses `jsonb_set` merge — concurrent partial taps preserved when a skip arrives; data-fidelity-mandate violation closed
  5. `findOpenWellbeingRow` filter rejects stale prior-day NULL rows even across DST edges — no cross-day match possible
  6. Weekly-review fire is transactional: Telegram send success gates `fire_event` INSERT + `respondedAt` update + `next_run_at` advance atomically; Telegram failure rolls all three back — no silent weekly miss, no Pensieve orphan
**Plans**: TBD

### Phase 43: Inference Security & Contract Enforcement
**Goal**: Close prompt-injection surface on both operational + psychological inference prompts, restore the "host computes, Sonnet doesn't emit" contract by stripping `dataConsistency` from prevState, and persist Sonnet's data_consistency field to unblock future CONS-01 host-side consistency math
**Depends on**: Nothing
**Requirements**: INJ-01, INJ-02, CONTRACT-01, CONTRACT-02, CONTRACT-03
**Success Criteria** (what must be TRUE):
  1. A Pensieve entry containing `\n\n## CURRENT PROFILE STATE\n{...forged...}` (or any other reserved anchor) cannot hijack the structured-output contract on operational inference — escaping verified against canonical injection fixtures
  2. The same defense-in-depth escaping is present in the psychological-profile prompt assembler
  3. `stripMetadataColumns` removes `dataConsistency` from prevState before injection — every non-first fire no longer shows Sonnet its prior `data_consistency` value
  4. `extract<X>PrevState` returns `null` (omits the prevState section entirely) when `substrateHash === ''` — first-fire-after-deploy no longer shows Sonnet empty fields + anti-drift directive across all 4 operational dimensions (jurisdictional/capital/health/family)
  5. Sonnet's `data_consistency` field from psychological inference persists in a dedicated column (`psychological_profile_history.data_consistency` jsonb) — currently logged then discarded; future CONS-01 host-side math has a historical signal to consume
**Plans**: TBD

### Phase 44: CI Milestone-Gate Hardening
**Goal**: Replace silent-skip pattern across M009/M010/M011 milestone-gate tests with environment-gated hard-fail so CI cannot report green when fixtures are absent — the milestone gates currently provide zero regression detection in CI
**Depends on**: Phase 45 (fixture path bug FIX-02 / `synthesize-delta.ts:937` must be fixed before regen produces fixtures at the correct path that CI can find)
**Requirements**: CI-01, CI-02, CI-03
**Success Criteria** (what must be TRUE):
  1. When `REQUIRE_FIXTURES=1` and the manifest is absent, M010 milestone-gate test files (`integration-m010-30days.test.ts`, `integration-m010-5days.test.ts`, `primed-sanity-m010.test.ts`, `live-anti-hallucination.test.ts`) produce non-zero failures — local dev without the env var still skips
  2. The same env-gated hard-fail behavior is present on M011 milestone-gate tests; the `m011-1000words-5days` vs `m011-1000words` output-dir path bug at `synthesize-delta.ts:937` is fixed so operator regen lands at the path the tests read from
  3. M009 milestone-gate tests (`primed-sanity.test.ts` + `synthetic-fixture.test.ts`) participate in the same hard-fail discipline — D045 silent-skip pattern no longer hides regressions
**Plans**: TBD

### Phase 45: Schema Hygiene & Fixture-Pipeline Cleanup
**Goal**: Root-cause the M010 schema_mismatch warns via Phase 33 seed-defaults backfill, add defense-in-depth DB CHECK constraints on psychological-profile jsonb score ranges, and clean up the heterogeneous fixture-pipeline + operator-script defects surfaced in Phase 24/40 reviews
**Depends on**: Nothing (SCHEMA-02 backfill is internally a prerequisite for FIX-06 fixture refresh — sequenced within the phase, not across phases)
**Requirements**: SCHEMA-01, SCHEMA-02, FIX-01, FIX-02, FIX-03, FIX-04, FIX-05, FIX-06, FIX-07, FIX-08
**Success Criteria** (what must be TRUE):
  1. Migration `0016_phase33_seed_defaults_backfill` populates `energy_30d_mean`, `wellbeing_trend`, `parent_care_responsibilities`, and the other required nullable fields — after refresh, M010 `schema_mismatch` warns for `family.parent_care_responsibilities` + `health.wellbeing_trend` no longer appear in operator-visible logs
  2. Migration `0015_psychological_check_constraints` rejects out-of-range scores at the DB layer (HEXACO 1.0-5.0, Schwartz 0.0-7.0, confidence 0.0-1.0) — a non-Zod-validated UPDATE can no longer slip bad data past the DB. (Slot `0014` is taken by Phase 43's `0014_psychological_data_consistency_column`.)
  3. `synthesize-delta.ts` pre-filters `fusedContradictions` against `Set(fusedPensieve.map(p => p.id))` and the bias-prompt `phrasesClause` injects independently of `dimensionHint` truthiness — m011-1000words regen no longer hits the contradictions FK violation; PMT-01 contract restored
  4. `synthesize-episodic.ts` migration list is derived from the migrations directory (not hardcoded `0000..0005`) — operator regen lands a fully-migrated DB; `wellbeing_snapshots.jsonl` is no longer silently dropped
  5. `scripts/fetch-prod-data.ts` SSH tunnel enforces `StrictHostKeyChecking=yes` + a vetted `UserKnownHostsFile` — MITM cannot capture `PROD_PG_PASSWORD` on a fresh runner
  6. `load-primed.ts` `pensieve_embeddings vector(1024)` coercion works via explicit cast — first non-empty embeddings JSONL regen succeeds
  7. M010 operational primed fixtures refreshed against the backfilled schema — PMT-06 schema_mismatch warns absent on the next milestone-gate run
  8. HARN word-count assertion in `primed-sanity-m011.test.ts` uses a calendar-month-window-filtered count matching substrate population — no more false-positive "wordCount > 5000" pass when substrate sees 4,115
  9. Operator scripts (`fetch-prod-data`, `synthesize-episodic`, `regenerate-primed`) `finally`-block cleanup runs on SIGINT — SSH tunnels, postgres clients, and child docker compose projects no longer leak on Ctrl-C
**Plans**: TBD

### Phase 46: FR/RU Localization Comprehensive
**Goal**: Build the locale detection layer once and apply it across all 30+ EN-only sites surfaced by the Phase 26/28/29/39 reviews — adjustment-dialogue, weekly-review header + FR regex + templated fallback, daily-journal prompts, `/profile` qualifier + dim labels + score tokens
**Depends on**: Phase 41 (ADJ-03 lives in the adjustment-dialogue cluster; the shared locale infrastructure built in this phase is consumed by Phase 41's localization criterion as well — sequence Phase 46 to land the infra, but if Phase 41 ships urgently first, ADJ-03 may be split out and merged into this phase's surface)
**Requirements**: L10N-01, L10N-02, L10N-03, L10N-04, L10N-05, L10N-06
**Success Criteria** (what must be TRUE):
  1. `/profile` Telegram output renders in Greg's detected locale across all 21 catalogued sites: qualifier strings, HEXACO dim labels, Schwartz dim labels, and the `/ 5.0` + `confidence` score-line tokens — no EN tokens leak in FR/RU output (folds in v2.5 WR-02)
  2. Subsequent weekly-review fires render `WEEKLY_REVIEW_HEADER` in the same locale as the body — no more EN header above FR/RU body
  3. Weekly-review FR regex correctly matches `qu'est-ce que` (canonical apostrophe-normalize step) and rejects gibberish like `queest-ce que`
  4. Daily-journal PROMPTS in `src/rituals/journal.ts` render in Greg's detected locale — no longer EN-only
  5. `qualifierFor` exists as a single locale-aware function (consolidated from the two duplicated copies in `src/memory/profiles.ts` and `src/bot/handlers/profile.ts`) — drift risk for the D027 mitigation surface eliminated
  6. `TEMPLATED_FALLBACK_EN` at `weekly-review.ts:357-360` has per-locale variants — v2.4 EN-only carry-forward closed
**Plans**: TBD
**UI hint**: yes

### Phase 47: Display Polish
**Goal**: Add the two user-visible v2.6.1 surface improvements — Schwartz values displayed in circumplex order (opposing values adjacent) and HEXACO × Schwartz cross-validation observations rendered on `/profile`
**Depends on**: Phase 46 (display strings must respect locale; cross-validation observations need the locale-aware qualifier from L10N-05)
**Requirements**: DISP-01, DISP-02
**Success Criteria** (what must be TRUE):
  1. When Greg runs `/profile`, the Schwartz section displays values ordered by circumplex with opposing values adjacent (e.g., `self_direction ↔ conformity`) — reader gains intuitive visual structure for tradeoff comparison
  2. When Greg runs `/profile`, HEXACO × Schwartz cross-validation observations appear (e.g., "high openness + high self-direction → consistent"; "low conscientiousness + high tradition → uncommon, low confidence") — reader sees inferred coherence with confidence qualifiers
**Plans**: TBD
**UI hint**: yes

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 41. Adjustment-Dialogue Rework | 2/2 | Shipped 2026-05-15 | ADJ-01..07 (7/7) |
| 42. Atomicity & Race Fixes | 3/3 | Shipped 2026-05-15 | RACE-01..06 (6/6) |
| 43. Inference Security & Contract Enforcement | 0/TBD | Not started | - |
| 44. CI Milestone-Gate Hardening | 0/TBD | Not started | - |
| 45. Schema Hygiene & Fixture-Pipeline Cleanup | 4/4 | Complete   | 2026-05-15 |
| 46. FR/RU Localization Comprehensive | 4/4 | Complete | 10 commits |
| 47. Display Polish | 0/TBD | Not started | - |

## Archived Milestones

- `.planning/milestones/v2.0-ROADMAP.md`
- `.planning/milestones/v2.1-ROADMAP.md`
- `.planning/milestones/v2.2-ROADMAP.md`
- `.planning/milestones/v2.3-ROADMAP.md`
- `.planning/milestones/v2.4-ROADMAP.md`
- `.planning/milestones/v2.5-ROADMAP.md`
- `.planning/milestones/v2.6-ROADMAP.md`
