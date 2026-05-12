# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15)
- ✅ **v2.1 M007 Decision Archive** — Phases 13-19 (shipped 2026-04-18)
- ✅ **v2.2 M008 Episodic Consolidation** — Phases 20-23 + 22.1 (shipped 2026-04-19)
- ✅ **v2.3 Test Data Infrastructure** — Phase 24 (shipped 2026-04-20, archived 2026-04-25, 20/20 requirements)
- ✅ **v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review** — Phases 25-32 (shipped 2026-05-11, 23 plans, 52/52 requirements + Phase 31 terminology cleanup + Phase 32 substrate hardening)
- 📋 **v2.5 M010 Operational Profiles** — Phases 33-36 (in planning 2026-05-11)

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

### 📋 v2.5 M010 Operational Profiles (Phases 33-36)

- [x] **Phase 33: Profile Substrate** — Migration 0012 + 4 profile tables + history table + reader API + Zod schemas (completed 2026-05-11)
- [x] **Phase 34: Inference Engine** — Shared prompt builder + 4 generators + orchestrator + Sunday 22:00 cron + idempotency (completed 2026-05-12)
- [ ] **Phase 35: Surfaces** — buildSystemPrompt refactor + REFLECT/COACH/PSYCHOLOGY injection + /profile command + formatter
- [ ] **Phase 36: Tests** — m010-30days primed fixture + real-DB integration + two-cycle idempotency + sparse + live 3-of-3

## Phase Details

### Phase 33: Profile Substrate
**Goal**: The four operational profile tables exist in the database with all non-retrofittable columns, and a type-safe reader API returns structured data (never narrative text) from those tables.
**Depends on**: Phase 32 (v2.4 M009 shipped — migration 0011 is the prior migration)
**Requirements**: PROF-01, PROF-02, PROF-03, PROF-04, PROF-05
**Success Criteria** (what must be TRUE):
  1. Migration 0012 applies cleanly to a fresh Docker Postgres instance and creates `profile_jurisdictional`, `profile_capital`, `profile_health`, `profile_family`, and `profile_history` — each with `schema_version`, `substrate_hash`, and `name='primary'` sentinel columns present from day one (never retrofitted)
  2. `getOperationalProfiles()` returns all-null per-profile when the DB contains no rows, and returns `null` per profile (not throw) when the DB connection errors — never-throw contract observed
  3. Initial profile rows exist in all four tables after migration (seeded from `ground-truth.ts`): jurisdictional + capital at confidence 0.2–0.3 from known facts; health + family row-present at confidence=0 with "insufficient data" markers
  4. Zod v3 + v4 dual schemas for all four profile shapes parse valid shapes and reject invalid ones (wrong confidence range, missing required fields, schema_version=999 returns null without throwing)
  5. `computeProfileConfidence(entryCount, dataConsistency)` pure-function unit tests confirm: below-threshold (< 10 entries) returns 0.0; at-saturation (50+ entries) caps correctly; `isAboveThreshold(9)` is false, `isAboveThreshold(10)` is true
**Plans**: 2 plans
- [x] 33-01-PLAN.md — Atomic substrate migration (PROF-01/02/03 + Never-Retrofit Checklist)
- [x] 33-02-PLAN.md — Reader API + Zod schemas + confidence helpers (PROF-04/05 + GEN-05 substrate)

**HARD CO-LOCATION #M10-1**: Migration SQL + drizzle meta snapshot + `scripts/test.sh` psql apply line ship in ONE atomic plan. `schema_version` + `substrate_hash` columns ship in the SAME migration as table creation — never retrofitted.

---

### Phase 34: Inference Engine
**Goal**: A Sunday 22:00 Paris cron fires four profile generators via `Promise.allSettled`, each generator produces a Sonnet-inferred structured profile upserted to the DB, and substrate-hash idempotency prevents redundant LLM calls on unchanged input.
**Depends on**: Phase 33
**Requirements**: GEN-01, GEN-02, GEN-03, GEN-04, GEN-05, GEN-06, GEN-07
**Success Criteria** (what must be TRUE):
  1. `assembleProfilePrompt(dimension, substrate, prevState, entryCount)` shared builder is the first artifact written in this phase; all four generators consume it; a structural test verifies CONSTITUTIONAL_PREAMBLE + DO_NOT_INFER_DIRECTIVE appear in every generator's assembled prompt
  2. `updateAllOperationalProfiles()` runs all four generators via `Promise.allSettled` — if one generator throws (simulated), the other three still complete and their outcomes are logged discriminately
  3. When `entryCount < 10`, no Sonnet call is made; the generator logs `'chris.profile.threshold.below_minimum'` and the profile row stays at confidence=0 with "insufficient data" field values
  4. When the computed SHA-256 of input substrate matches `profile.substrate_hash` from the prior fire, the generator skips the Sonnet call and emits `'profile_skipped_no_change'`
  5. The Sunday 22:00 Paris cron is registered in `src/cron-registration.ts`, `profileUpdaterCron` env var is validated at config load with `cron.validate` fail-fast, and `/health` reports `profile_cron_registered`
**Plans**: TBD

**HARD CO-LOCATION #M10-2**: `assembleProfilePrompt` shared builder ships BEFORE any of the 4 dimension generators (per-dimension prompt drift mitigation).
**HARD CO-LOCATION #M10-3**: Substrate-hash idempotency test (two-cycle / second-fire) ships in the SAME plan as the generator that introduces the hash — second-fire behavior must be testable atomically with first-fire behavior (M009 lt→lte lesson).

---

### Phase 35: Surfaces
**Goal**: REFLECT, COACH, and PSYCHOLOGY mode handlers inject operational profile context into their system prompts, and Greg can read all four profiles via a `/profile` Telegram command with a golden-output-tested formatter.
**Depends on**: Phase 33 (reader API), Phase 34 (populated rows needed for non-null rendering test)
**Requirements**: SURF-01, SURF-02, SURF-03, SURF-04, SURF-05
**Success Criteria** (what must be TRUE):
  1. `buildSystemPrompt` is refactored to accept `(mode, pensieveContext, relationalContext, extras: ChrisContextExtras)` across ALL call sites in one atomic change — existing mode-handler and engine tests still pass with the refactored signature
  2. REFLECT, COACH, and PSYCHOLOGY handlers inject the profile block (`## Operational Profile (grounded context — not interpretation)`) above `{pensieveContext}`; JOURNAL, INTERROGATE, PRODUCE, and ACCOUNTABILITY modes do NOT receive profile injection
  3. `/profile` command returns a plain-text, second-person formatted summary of all four operational profiles with confidence percentages; psychological section reads "not yet available — see M011"
  4. `formatProfileForDisplay(profile)` golden-output snapshot test passes on a fixed `MOCK_PROFILES` fixture — no internal field name leakage, no third-person framing, no `parse_mode` set
  5. When all four profiles are null (e.g., fresh DB or all below threshold), `formatProfilesForPrompt()` returns empty string and mode handlers omit the injection block entirely
**Plans**: TBD

**HARD CO-LOCATION #M10-4**: `buildSystemPrompt` signature refactor lands atomically across ALL call sites in ONE plan. Pre-work: full `buildSystemPrompt` call-site grep (OQ-3) before any code change.
**HARD CO-LOCATION #M10-5**: `/profile` handler + `formatProfileForDisplay` + golden-output snapshot test land in the SAME plan.
**UI hint**: yes

---

### Phase 36: Tests
**Goal**: The m010-30days primed fixture produces all four populated profiles above threshold, the sparse fixture confirms threshold enforcement, two-cycle idempotency is verified, and a live 3-of-3 Sonnet test confirms the REFLECT mode system prompt contains the operational profile block without hallucinated facts.
**Depends on**: Phase 33, Phase 34, Phase 35
**Requirements**: PTEST-01, PTEST-02, PTEST-03, PTEST-04, PTEST-05
**Success Criteria** (what must be TRUE):
  1. `synthesize-delta.ts --profile-bias <dimension>` flag exists and produces >= 12 domain-relevant tagged Pensieve entries per dimension in a 30-day window; HARN sanity gate confirms this before any profile update test runs
  2. Real-DB integration test loading m010-30days runs `updateAllOperationalProfiles()` and asserts all four profiles populate with confidence > 0, every `last_updated` advances, and `substrate_hash` is non-null
  3. Two-cycle integration test: Week 1 populates from empty substrate; Week 2 with identical substrate verifies no second Sonnet call (`mockAnthropicParse.toHaveBeenCalledTimes(4)` not 8) and `profile_history` has 2 rows per dimension; Week 2 with new substrate verifies `profile_updated` outcome and the updated row reflects changed fields
  4. Sparse-fixture test (5 entries per dimension): all four profiles return "insufficient data" markers + confidence=0 + logged skip line — threshold-enforcement contract observed end-to-end
  5. Live 3-of-3 anti-hallucination test (dual-gated `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=...`) fires a REFLECT-mode message with m010-30days fixture and asserts (a) system prompt contains `## Operational Profile` block, (b) Sonnet response does not assert facts outside the fixture's profile data
**Plans**: TBD

**HARD CO-LOCATION #M10-6**: `synthesize-delta.ts --profile-bias` flag + m010-30days fixture generation + populated-case test + sparse-case test land in the SAME plan. Splitting them creates synth-pipeline/test mismatch.

---

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 25-32 | v2.4 | 23/23 + Phase 32 inline | Complete | 2026-05-11 |
| 33 — Profile Substrate | v2.5 | 2/2 | Complete   | 2026-05-11 |
| 34 — Inference Engine | v2.5 | 3/3 | Complete   | 2026-05-12 |
| 35 — Surfaces | v2.5 | 0/3 | Not started | — |
| 36 — Tests | v2.5 | 0/2 | Not started | — |

## Archived Milestones

- `.planning/milestones/v2.0-ROADMAP.md`
- `.planning/milestones/v2.1-ROADMAP.md`
- `.planning/milestones/v2.2-ROADMAP.md`
- `.planning/milestones/v2.3-ROADMAP.md`
- `.planning/milestones/v2.4-ROADMAP.md`
