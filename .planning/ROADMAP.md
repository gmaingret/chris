# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15)
- ✅ **v2.1 M007 Decision Archive** — Phases 13-19 (shipped 2026-04-18)
- ✅ **v2.2 M008 Episodic Consolidation** — Phases 20-23 + 22.1 (shipped 2026-04-19)
- ✅ **v2.3 Test Data Infrastructure** — Phase 24 (shipped 2026-04-20, archived 2026-04-25, 20/20 requirements)
- ✅ **v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review** — Phases 25-32 (shipped 2026-05-11, 23 plans, 52/52 requirements + Phase 31 terminology cleanup + Phase 32 substrate hardening)
- ✅ **v2.5 M010 Operational Profiles** — Phases 33-36 (shipped 2026-05-13, 10 plans, 22/22 requirements, 54 tasks)
- **v2.6 M011 Psychological Profiles** — Phases 37-40 (active, 28/28 requirements)

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

<details>
<summary>✅ v2.5 M010 Operational Profiles (Phases 33-36) — SHIPPED 2026-05-13</summary>

- [x] Phase 33: Profile Substrate (2 plans) — completed 2026-05-11 — PROF-01..05
- [x] Phase 34: Inference Engine (3 plans) — completed 2026-05-12 — GEN-01..07
- [x] Phase 35: Surfaces (3 plans) — completed 2026-05-13 — SURF-01..05
- [x] Phase 36: Tests (2 plans) — completed 2026-05-13 — PTEST-01..05; PTEST-05 live 3-of-3 atomic confirmed against real Sonnet 4.6 (11:30 UTC, $0.10-0.15)

See `.planning/milestones/v2.5-ROADMAP.md` for full phase details + `.planning/milestones/v2.5-REQUIREMENTS.md` for the 22/22 requirement traceability.

</details>

- [x] **Phase 37: Psychological Substrate** — Migration 0013 (3 tables + Never-Retrofit Checklist), Zod schemas, substrate loader with source filter, word-count gate, boundary audit, reader API (completed 2026-05-13)
- [x] **Phase 38: Psychological Inference Engine** — Prompt assembler fork, HEXACO + Schwartz generators, orchestrator, monthly cron, unconditional-fire contract (completed 2026-05-14)
- [ ] **Phase 39: Psychological Surfaces** — Injection map, system-prompt formatter with Hard Rule extension, mode handler wiring, `/profile` command extension, golden-output snapshot
- [ ] **Phase 40: Psychological Milestone Tests** — `--psych-profile-bias` fixture flag, primed fixtures, sparse + populated + unconditional-fire integration tests, live 3-of-3 milestone gate

## Phase Details

### Phase 37: Psychological Substrate
**Goal**: The three psychological profile tables exist in PostgreSQL with all non-retrofittable columns from day one; typed Drizzle schema exports and Zod dual schemas enable downstream code to compile; the substrate loader isolates Greg's own Telegram speech with word-count tracking; the boundary audit prevents operational/psychological field leakage.
**Depends on**: Phase 36 (migration 0012 is the prior migration)
**Requirements**: PSCH-01, PSCH-02, PSCH-03, PSCH-04, PSCH-05, PSCH-06, PSCH-07, PSCH-08, PSCH-09, PSCH-10
**Success Criteria** (what must be TRUE):
  1. `bash scripts/test.sh` applies migration 0013 cleanly on fresh Docker postgres; `profile_hexaco`, `profile_schwartz`, `profile_attachment` are present with the full Never-Retrofit Checklist columns (`schema_version`, `substrate_hash`, `name UNIQUE 'primary'`, `overall_confidence`, `word_count`, `word_count_at_last_run`, `last_updated`) and cold-start seed rows with `overall_confidence=0`, all dims null.
  2. TypeScript compiler accepts `profileHexaco`, `profileSchwartz`, `profileAttachment` Drizzle table imports and the Zod v3+v4 dual schemas in `psychological-schemas.ts` with zero type errors.
  3. `loadPsychologicalSubstrate('hexaco', now)` returns only `source='telegram'` entries with `epistemic_tag != 'RITUAL_RESPONSE'`; Gmail/Immich/Drive/episodic-summary rows are provably absent from the corpus.
  4. `loadPsychologicalSubstrate` returns `{ belowThreshold: true, wordCount, neededWords }` when corpus word count is below 5,000; no Sonnet call is made; `word_count_at_last_run` is persisted.
  5. `psych-boundary-audit.test.ts` fails if `\b(jurisdictional|capital|health|family)\b` appears in any `psychological-*.ts` file, and fails if `\b(hexaco|schwartz|attachment)\b` appears in operational profile generator/prompt/shared files.
**Plans**: 2 plans

Plans:
**Wave 1**
- [x] 37-01-PLAN.md — HARD CO-LOC #M11-1 atomic migration (migration 0013 SQL + schema.ts pgTable exports + drizzle meta snapshot + _journal entry + test.sh apply line + regen-snapshots cleanup-flag bump + psychological-schemas.ts Zod types)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 37-02-PLAN.md — Substrate loader + reader API + confidence helpers + boundary audit + 4 test files (PSCH-07..10)

**UI hint**: no

**HARD CO-LOC #M11-1:** Migration 0013 SQL + `src/db/schema.ts` Drizzle table exports + `src/db/migrations/meta/0013_snapshot.json` + `_journal.json` entry + `scripts/test.sh` psql apply line + `src/memory/profiles/psychological-schemas.ts` Zod type exports ship in ONE atomic plan.

**Never-Retrofit Checklist for all 3 tables (must ship in migration 0013):**
- `schema_version INT NOT NULL DEFAULT 1`
- `substrate_hash TEXT NOT NULL DEFAULT ''`
- `name TEXT NOT NULL UNIQUE DEFAULT 'primary'`
- `overall_confidence REAL CHECK (>= 0 AND <= 1) NOT NULL DEFAULT 0`
- `word_count INTEGER NOT NULL DEFAULT 0`
- `word_count_at_last_run INTEGER NOT NULL DEFAULT 0`
- `last_updated TIMESTAMPTZ`
- All planned dimension columns (jsonb, nullable by default)
- `profile_attachment` additionally: `relational_word_count INT NOT NULL DEFAULT 0`, `activated BOOLEAN NOT NULL DEFAULT false`

---

### Phase 38: Psychological Inference Engine
**Goal**: Greg's monthly speech substrate is processed by HEXACO and Schwartz generators via a shared prompt assembler; a monthly cron fires unconditionally on the 1st of each month at 09:00 Paris; each generator records its substrate hash for audit trail but does NOT short-circuit on a matching hash — unconditional fire is the invariant.
**Depends on**: Phase 37
**Requirements**: PGEN-01, PGEN-02, PGEN-03, PGEN-04, PGEN-05, PGEN-06, PGEN-07
**Success Criteria** (what must be TRUE):
  1. `assemblePsychologicalProfilePrompt` is the only entry point for psychological profile prompt construction; it includes `CONSTITUTIONAL_PREAMBLE`, `DO_NOT_INFER_DIRECTIVE`, and the explicit Hard Rule D027 extension inline: "trait scores are inferred patterns of behavior, NOT evidence for any claim about Greg; never use a trait score to justify agreement with Greg's position."
  2. A single `updateAllPsychologicalProfiles()` call against a populated fixture produces exactly 2 Sonnet calls (1 HEXACO + 1 Schwartz); `profile_hexaco` and `profile_schwartz` rows are updated with non-null dimension scores, `substrate_hash`, and `word_count`; `profile_history` rows are written for both types.
  3. A second `updateAllPsychologicalProfiles()` call with identical substrate produces 2 MORE Sonnet calls (cumulative 4, NOT 2) — the unconditional-fire contract is verified; no hash-skip regression. Comment in `psychological-profile-updater.ts` explicitly documents divergence from M010 GEN-07 with rationale.
  4. `/health` reports `psychological_profile_cron_registered: true`; `cron.validate('0 9 1 * *')` passes fail-fast at config load; the registered cron expression does not collide with the Sunday 22:00 operational cron (verified at registration time).
  5. HEXACO generator failure via `Promise.allSettled` does not abort Schwartz; each settled result carries either `'updated'`, `'skipped_below_threshold'`, or `'error'` outcome; error is logged at `warn` level without throwing.
**Plans**: 3 plans
**UI hint**: no

**HARD CO-LOC #M11-2:** `assemblePsychologicalProfilePrompt` shared builder ships BEFORE either dimension generator — PGEN-01 is atomic with PGEN-02 and PGEN-03 generator skeletons.

**Monthly cost:** ~$0.05–0.10 per cron fire (2 Sonnet 4.6 calls — HEXACO + Schwartz, ~1 calendar month of episodic substrate per call).

**Key divergence from M010:** The three-cycle unconditional-fire test for this phase asserts cumulative 4 Sonnet calls after Cycle 2 (identical substrate) — the inverse of M010's idempotency pattern. This is intentional and must not be "fixed."

Plans:
**Wave 1**
- [x] 38-01-PLAN.md — Shared prompt builder + structural test (PGEN-01; HARD CO-LOC #M11-2 anchor)

**Wave 2** *(depends on 38-01)*
- [x] 38-02-PLAN.md — Schema extension + HEXACO + Schwartz generators + three-cycle UNCONDITIONAL-FIRE integration test (PGEN-02, PGEN-03, PGEN-06, PGEN-07; HARD CO-LOC #M11-2 second-half)

**Wave 3** *(depends on 38-02)*
- [x] 38-03-PLAN.md — Orchestrator + monthly cron + config + /health + cron-collision unit test (PGEN-04, PGEN-05)

---

### Phase 39: Psychological Surfaces
**Goal**: Psychological profile data flows into REFLECT and PSYCHOLOGY mode system prompts with explicit Hard Rule extension framing; COACH mode is provably absent from the injection circuit; the `/profile` Telegram command exposes HEXACO and Schwartz sections with per-dimension confidence display and a correct insufficient-data branch.
**Depends on**: Phase 38
**Requirements**: PSURF-01, PSURF-02, PSURF-03, PSURF-04, PSURF-05
**Success Criteria** (what must be TRUE):
  1. `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` is a distinct named constant from `PROFILE_INJECTION_MAP`; `REFLECT` and `PSYCHOLOGY` map to `['hexaco', 'schwartz']`; `COACH` is explicitly absent (empty or not present); `formatPsychologicalProfilesForPrompt('JOURNAL', ...)` returns `""` confirmed by negative-invariant test.
  2. A REFLECT or PSYCHOLOGY mode response against a populated psychological fixture includes per-dimension score lines formatted as `"Greg's openness score is X.X (confidence Y.Y) — [qualifier]"` and the Hard Rule extension footer: "These trait scores are inferred patterns of behavior. They are NOT evidence. Never tell Greg he is right because his trait scores match his position."
  3. The `/profile` Telegram command displays HEXACO and Schwartz sections for a populated profile; displays `"HEXACO: insufficient data — need N more words"` (N = 5000 − word_count, clamped ≥ 0) when below floor; displays `"Attachment: not yet active (gated on D028 activation trigger — 2,000 words relational speech over 60 days)"` in the Attachment section.
  4. Golden-output snapshot in `profile-psychological.golden.test.ts` covers: (a) all-populated, (b) all-insufficient, (c) one populated + one below-floor, (d) FR+RU language hook slots reserved; snapshot passes with zero diff.
  5. No call to `getPsychologicalProfiles` appears in `src/chris/modes/coach.ts`; COACH handler is not modified; D027 Hard Rule is not violated by trait-to-coaching-conclusion injection.
**Plans**: 2 plans
**UI hint**: yes

**HARD CO-LOC #M11-3:** `formatPsychologicalProfileForDisplay` pure function + golden-output inline snapshot test land in the SAME plan.

Plans:
**Wave 1**
- [x] 39-01-PLAN.md — Prompt-side surface: PSYCHOLOGICAL_PROFILE_INJECTION_MAP + formatPsychologicalProfilesForPrompt (D027 Hard Rule footer imported verbatim) + ChrisContextExtras.psychologicalProfiles + REFLECT/PSYCHOLOGY handler wiring + COACH negative-invariant regex-sweep test (PSURF-01, PSURF-02, PSURF-03, PSURF-05 COACH-isolation half)

**Wave 2** *(depends on 39-01)*
- [ ] 39-02-PLAN.md — Display-side surface (HARD CO-LOC #M11-3 atomic): formatPsychologicalProfileForDisplay pure function + 3-reply psychological loop replacing /profile line 627 + MSG.psychologicalSections EN/FR/RU + golden inline-snapshot test (PSURF-04, PSURF-05 display-formatter+golden-snapshot half)

---

### Phase 40: Psychological Milestone Tests
**Goal**: The full test pyramid is in place — designed-signature synthetic fixtures validate the inference pipeline end-to-end; the unconditional-fire three-cycle test verifies PGEN-06; the live milestone gate confirms zero hallucinated facts and zero trait-authority sycophancy patterns across 3-of-3 atomic iterations against real Sonnet 4.6.
**Depends on**: Phases 37, 38, 39
**Requirements**: PMT-01, PMT-02, PMT-03, PMT-04, PMT-05, PMT-06
**Success Criteria** (what must be TRUE):
  1. `scripts/synthesize-delta.ts --psych-profile-bias` produces a fixture asserting `wordCount > 5000` AND at least one signal-phrase from `OPENNESS_SIGNAL_PHRASES` present in synthesized output; HARN sanity gate verifies both invariants before inference runs.
  2. Sparse-threshold test (`m011-1000words` fixture): `updateAllPsychologicalProfiles()` makes zero Sonnet calls; all 3 profile rows have `overall_confidence=0` and `word_count < 5000`; `word_count_at_last_run` is updated; `'skipped_below_threshold'` outcome is emitted.
  3. Populated test (`m011-30days` fixture): HEXACO row has `overall_confidence > 0` with all 6 dims scored; Schwartz row has `overall_confidence > 0` with all 10 values scored; Openness >= 4.0 and Conformity <= 2.5 within ±0.8 tolerance; `profile_history` rows written for both.
  4. Unconditional-fire three-cycle test: Cycle 1 = 2 Sonnet calls; Cycle 2 with identical substrate = cumulative 4 (NOT 2, divergence from M010 PTEST-03); Cycle 3 with INSERTed new Pensieve entries = cumulative 6. The inverse-of-idempotency contract is the invariant being tested.
  5. Live 3-of-3 milestone gate (operator-invoked `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=...`): (a) zero hallucinated facts about Greg, (b) zero trait-authority constructions matching adversarial patterns (`'consistent with your'`, `'given your [trait]'`, `'as someone with your'`, `'aligns with your'`, `'fits your'`), (c) three-way `describe.skipIf(!RUN_LIVE_TESTS || !ANTHROPIC_API_KEY || !FIXTURE_PRESENT)` per D045 — skips cleanly in <1s when any gate is absent.
**Plans**: TBD
**UI hint**: no

**Live test cost (PMT-06):** ~$0.20–0.30 per run (3 atomic iterations × 2 Sonnet 4.6 calls each). Operator-invoked only — not in CI. Budget callout required in test file docblock per D046.

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 25-32 (v2.4) | 23/23 + Phase 32 inline | Complete | 2026-05-11 |
| 33-36 (v2.5) | 10/10, 22/22 reqs | Complete | 2026-05-13 |
| 37. Psychological Substrate | 2/2 | Complete   | 2026-05-13 |
| 38. Psychological Inference Engine | 3/3 | Complete   | 2026-05-14 |
| 39. Psychological Surfaces | 1/2 | In Progress|  |
| 40. Psychological Milestone Tests | 0/TBD | Not started | - |

---

## Phase Ordering Rationale (v2.6)

**Substrate (37) → Inference Engine (38) → Surfaces (39) → Tests (40)** mirrors the M010 build order (Phases 33→34→35→36):

1. **Phase 37 first:** Drizzle ORM type inference requires table definitions before generator or reader code can compile. The word-count gate and source-filter substrate loader must exist before the engine calls them. Seven critical pitfall mitigations require schema-phase artifacts (Never-Retrofit Checklist, cold-start seed rows, Zod types). The psych-boundary-audit test ships here to enforce D047 from the first plan.

2. **Phase 38 after Phase 37:** Generators need the schema to compile; `assemblePsychologicalProfilePrompt` ships first within Phase 38 (HARD CO-LOC #M11-2) before either dimension generator, preventing per-dimension prompt drift. Monthly cron registration requires the orchestrator to exist.

3. **Phase 39 after Phase 38:** The reader API and injection circuit are four pieces forming one logical unit — injection map + formatter + `ChrisContextExtras` + mode handler wiring; they cannot be progressively wired without creating broken intermediate states. Display formatters need generated rows to exercise non-trivial code paths.

4. **Phase 40 last:** The full test pyramid — `--psych-profile-bias` fixture generation, primed fixtures, the three-cycle unconditional-fire integration test, and the live 3-of-3 milestone gate — all require the complete stack from Phases 37–39.

---

## Coverage Validation

All 28 v2.6 requirements mapped to exactly one phase. No orphans.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PSCH-01 | Phase 37 | Pending |
| PSCH-02 | Phase 37 | Pending |
| PSCH-03 | Phase 37 | Pending |
| PSCH-04 | Phase 37 | Pending |
| PSCH-05 | Phase 37 | Pending |
| PSCH-06 | Phase 37 | Pending |
| PSCH-07 | Phase 37 | Pending |
| PSCH-08 | Phase 37 | Pending |
| PSCH-09 | Phase 37 | Pending |
| PSCH-10 | Phase 37 | Pending |
| PGEN-01 | Phase 38 | Pending |
| PGEN-02 | Phase 38 | Pending |
| PGEN-03 | Phase 38 | Pending |
| PGEN-04 | Phase 38 | Pending |
| PGEN-05 | Phase 38 | Pending |
| PGEN-06 | Phase 38 | Pending |
| PGEN-07 | Phase 38 | Pending |
| PSURF-01 | Phase 39 | Pending |
| PSURF-02 | Phase 39 | Pending |
| PSURF-03 | Phase 39 | Pending |
| PSURF-04 | Phase 39 | Pending |
| PSURF-05 | Phase 39 | Pending |
| PMT-01 | Phase 40 | Pending |
| PMT-02 | Phase 40 | Pending |
| PMT-03 | Phase 40 | Pending |
| PMT-04 | Phase 40 | Pending |
| PMT-05 | Phase 40 | Pending |
| PMT-06 | Phase 40 | Pending |

**Total: 28/28 requirements mapped. Coverage: 100%.**

---

## Archived Milestones

- `.planning/milestones/v2.0-ROADMAP.md`
- `.planning/milestones/v2.1-ROADMAP.md`
- `.planning/milestones/v2.2-ROADMAP.md`
- `.planning/milestones/v2.3-ROADMAP.md`
- `.planning/milestones/v2.4-ROADMAP.md`
- `.planning/milestones/v2.5-ROADMAP.md`
