# Project Chris — Requirements (v2.5 M010 Operational Profiles)

Milestone scope locked 2026-05-11 after `/gsd-new-milestone` research pass (STACK + FEATURES + ARCHITECTURE + PITFALLS + SUMMARY committed at `.planning/research/`).

**Goal:** Build the four operational profile dimensions (jurisdictional, capital, health, family) that capture Greg's situational state from observable facts. Profiles update from M008 episodic summaries + M007 resolved decisions + FACT/RELATIONSHIP/INTENTION/EXPERIENCE-tagged Pensieve entries on a weekly Sonnet cron. They inject as grounded context into REFLECT/COACH/PSYCHOLOGY mode handlers and are read-only-surfaced via a new `/profile` Telegram command.

## v2.5 M010 Requirements

### PROF — Profile substrate (Phase 33)

- [ ] **PROF-01**: Migration 0012 creates four profile tables — `profile_jurisdictional`, `profile_capital`, `profile_health`, `profile_family` — each with `id` (uuid pk), `last_updated` (timestamptz), `confidence` (numeric 0.0–1.0), `schema_version` (int NOT NULL DEFAULT 1, HARD-CO-LOC per PITFALLS M010-11 — cannot be retrofitted), `substrate_hash` (text), plus profile-specific jsonb columns per the M010 spec
- [ ] **PROF-02**: Migration 0012 also creates `profile_history` table (id, profile_table_name, profile_id, snapshot jsonb, recorded_at) for write-before-upsert pattern — internal idempotency primitive, distinct from the user-facing time-series-history feature (DIFF-3, deferred to M013)
- [ ] **PROF-03**: Initial profile rows seeded from `src/pensieve/ground-truth.ts` at migration time (jurisdictional + capital partial-populate at confidence 0.2–0.3 from existing ground-truth facts; health + family remain row-present at confidence=0 with "insufficient data" markers)
- [ ] **PROF-04**: `src/memory/profiles.ts` exports `getOperationalProfiles()` returning typed `{ jurisdictional, capital, health, family }` structured object (NOT narrative summary); never-throw contract — returns `null` per profile on DB error and logs at warn (D005 consistency)
- [ ] **PROF-05**: Zod v3 + v4 dual schemas for all four profile shapes in `src/memory/profiles/schemas.ts` (dual pattern required by `zodOutputFormat` per M009 precedent)

### GEN — Inference engine (Phase 34)

- [ ] **GEN-01**: New (fourth) cron registered in `src/cron-registration.ts` firing Sunday 22:00 Paris (4h after weekly_review's 20:00 fire — buffer for adversarial-week duration per ARCHITECTURE recommendation); env var `profileUpdaterCron` + `cron.validate` fail-fast at config load + `/health` reports `profile_cron_registered`
- [ ] **GEN-02**: `src/memory/profile-updater.ts` exports `updateAllOperationalProfiles()` orchestrator invoking all four generators via `Promise.allSettled` (error isolation — one profile failing must not abort the other three)
- [ ] **GEN-03**: Four per-dimension generators in `src/memory/profiles/{jurisdictional,capital,health,family}.ts`; each loads tag-filtered Pensieve (`FACT`/`RELATIONSHIP`/`INTENTION`/`EXPERIENCE`) + episodic summaries via `getEpisodicSummariesRange`, calls Sonnet with structured output, upserts the profile row
- [ ] **GEN-04**: `src/memory/profile-prompt.ts` exports `assembleProfilePrompt(dimension, substrate, prevState)` shared builder consumed by all four generators (HARD CO-LOC #M10-1 — prevents per-dimension prompt drift; analogue of M009 `assembleWeeklyReviewPrompt`)
- [ ] **GEN-05**: `src/memory/confidence.ts` exports `computeProfileConfidence(entryCount, dataConsistency)` + `isAboveThreshold(entryCount)` + `MIN_ENTRIES_THRESHOLD = 10` + `SATURATION = 50` constants (first-estimate saturation; tunable in v2.5.1 once empirical data exists)
- [ ] **GEN-06**: 10-entry minimum threshold enforced before populating any profile — below threshold → row stays at confidence=0 with `"insufficient data"` markers in all fields; generator logs `'chris.profile.threshold.below_minimum'` and skips Sonnet call
- [ ] **GEN-07**: `substrate_hash` idempotency — generator computes SHA-256 of input substrate; if hash equals `profile.substrate_hash` from prior fire, skip Sonnet call and emit `'profile_skipped_no_change'` outcome (second-fire-blindness mitigation per M009 `lt→lte` lesson + PITFALLS M010-10)

### SURF — User-facing surfaces (Phase 35)

- [ ] **SURF-01**: `buildSystemPrompt` signature in `src/chris/personality.ts` refactored to `(mode, pensieveContext, relationalContext, extras: ChrisContextExtras)` where `ChrisContextExtras = { language, declinedTopics, operationalProfiles? }` — atomic across all call sites (HARD CO-LOC #M10-2 — partial refactor breaks mode dispatch). Pre-work: full call-site inventory (OQ-3) before any code change
- [ ] **SURF-02**: REFLECT, COACH, PSYCHOLOGY mode handlers in `src/chris/modes/{reflect,coach,psychology}.ts` call `getOperationalProfiles()` and inject the result into `extras.operationalProfiles` as a structured `## Operational Profile (grounded context — not interpretation)` block placed ABOVE `{pensieveContext}` per D031 Known Facts pattern. JOURNAL/INTERROGATE/PRODUCE/PHOTOS modes do NOT receive the injection
- [ ] **SURF-03**: `/profile` Telegram command in `src/bot/handlers/profile.ts` returns a formatted plain-text summary of all four operational profiles with confidence percentages; psychological section reads `"not yet available — see M011"` until M011 lands
- [ ] **SURF-04**: `formatProfileForDisplay(profile)` function with golden-output snapshot test in `src/bot/handlers/__tests__/profile.golden.test.ts` — prevents the M009 first-fire UX regression class (third-person framing / leaked internal field names / format drift)
- [ ] **SURF-05**: `/profile` output uses plain text — no Telegram `parse_mode` — per codebase D-31 convention; multi-section layout (one section per profile dimension) with ASCII section dividers mirroring `src/bot/handlers/summary.ts` formatting

### PTEST — Profile tests (Phase 36)

- [ ] **PTEST-01**: `tests/fixtures/primed/m010-30days/` primed fixture covering all four profile dimensions with ≥12 distinct tagged Pensieve entries per dimension; `scripts/synthesize-delta.ts` extended with `--profile-bias` flag for per-dimension content biasing (PITFALLS M010-05 — synth pipeline has no topic-bias mechanism today)
- [ ] **PTEST-02**: Real-DB integration test loading m010-30days, running `updateAllOperationalProfiles()`, asserting all four profiles populate with confidence > 0 AND every profile-row's `last_updated` advances AND `substrate_hash` is non-null
- [ ] **PTEST-03**: Two-cycle integration test — Week 1 populates with substrate A; Week 2 with identical substrate A verifies `substrate_hash` idempotency (no second Sonnet call — `mockAnthropicParse.toHaveBeenCalledTimes(4)` not 8); Week 2 with substrate B (new entries) verifies the update applies and emits `'profile_updated'`. Second-fire-blindness regression detector
- [ ] **PTEST-04**: Sparse-fixture test — 5-entry-per-dimension fixture → all four profiles return `"insufficient data"` markers + `confidence=0` + skipped log line; asserts threshold-enforcement contract (TS-8 from FEATURES)
- [ ] **PTEST-05**: Live 3-of-3 atomic anti-hallucination test against real Sonnet on a fresh fixture week — dual-gated (`RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=…`) per D-30-03 cost discipline; ~$0.20/run; mirrors M009 TEST-31 structure

## Future Requirements (deferred to v2.5.1 or M013)

These items are explicitly out of M010 scope per the FEATURES research recommendations. They require empirical M010 operation before scoping:

- **DIFF-2** — Auto-detection of profile-change moments (real-time inline updates beyond weekly batch). v2.5.1 candidate.
- **DIFF-3** — Time-series user-facing profile history with periodic snapshots over time. M013/M014. Note: `profile_history` table from PROF-02 is the internal idempotency primitive, NOT this user-facing feature.
- **DIFF-4** — Per-profile Sonnet-generated narrative summaries (plain-text paragraph per dimension beyond the structured fields). v2.5.1.
- **DIFF-5** — Profile consistency checker (detect when new Pensieve entries contradict the stored profile, surface for correction). v2.5.1.
- **DIFF-6** — Wellbeing-anchored health profile updates (sustained energy/mood/anxiety trends drive health-profile updates independent of explicit mentions). v2.5.1.
- **DIFF-7** — Per-field confidence (rather than aggregate per-profile confidence). M013.
- **Multi-profile cross-reference reasoning** (DIFF-1) — e.g., "your jurisdictional + capital interact this week". Needs all four operational + M011 psychological profiles to be mature; M013.
- **SATURATION constant tuning** — first-estimate is 50; requires 4-8 weeks of real M010 operation to calibrate the entry-count → confidence ceiling curve. v2.5.1 follow-up, not blocking.

## Out of Scope (explicit exclusions)

- **ANTI-1** — Predictive future-state forecasting from profiles ("based on your profile you'll likely..."). Out of scope per M010 spec; Chris does not predict Greg's future. Alternative: Socratic questioning via COACH mode.
- **ANTI-2** — Multi-user profile sharing or federation. Single-user app (D009); multi-tenancy explicitly excluded in PLAN.md.
- **ANTI-3** — Profile visualization (charts, dashboards, timeline views). Telegram-text-only surface (D009 single-user); no frontend.
- **ANTI-4** — Real-time profile update on every message (inline vs weekly batch). Adds inference cost per message; profile stability matters (a single sentence should not flip a profile field). Weekly batch is the right cadence; DIFF-2 is the escape valve for high-salience events.
- **ANTI-5** — Psychological trait inference from operational profile fields. Mixes operational and psychological tiers — M011 handles trait inference.
- **ANTI-6** — Profile editing by Greg via Telegram commands (`/profile edit jurisdictional current_country=Georgia`). Opens a command-parsing surface; profiles must be inference-derived, not manually maintained. Alternative: Greg corrects profiles by depositing a new Pensieve entry, and the weekly update picks it up.
- **ANTI-7** — Separate "profile mode" in the 6-mode engine. Profiles are context, not conversation; exposing them as a mode confuses the interaction model. `/profile` command for read; weekly cron for write.

## v2.4 carryforward (NOT in M010 scope — backlog for v2.5.1 or M013)

These items closed v2.4 as deferred (see `.planning/milestones/v2.4-MILESTONE-AUDIT.md`):

- Synth-pipeline organic+synth fusion (`synthesize-episodic.ts:288` + `synthesize-delta.ts` wellbeing-per-fused-day) — would restore HARN-04 floor ≥21 + HARN-06 floor ≥14
- FR/RU localization of templated `weekly_review` fallback (currently EN-only per D-29-02-D)
- Phase 28 UAT: 60s confirmation window real-clock observation + 7d+7d evasive trigger spacing test
- `wellbeing.test.ts` Tests 6+7 ORDER BY bug fix (pre-existing test-only false negative; production behavior correct)
- Stale callback prefix comments in `src/bot/handlers/ritual-callback.ts:31-32` (doc noise)
- Forensic investigation of `__drizzle_migrations` row loss (cold trail — may stay deferred indefinitely)

## Traceability

| REQ-ID | Phase | Plan(s) | Status | Verified |
|--------|-------|---------|--------|----------|
| PROF-01 | 33 | — | Not Started | — |
| PROF-02 | 33 | — | Not Started | — |
| PROF-03 | 33 | — | Not Started | — |
| PROF-04 | 33 | — | Not Started | — |
| PROF-05 | 33 | — | Not Started | — |
| GEN-01 | 34 | — | Not Started | — |
| GEN-02 | 34 | — | Not Started | — |
| GEN-03 | 34 | — | Not Started | — |
| GEN-04 | 34 | — | Not Started | — |
| GEN-05 | 34 | — | Not Started | — |
| GEN-06 | 34 | — | Not Started | — |
| GEN-07 | 34 | — | Not Started | — |
| SURF-01 | 35 | — | Not Started | — |
| SURF-02 | 35 | — | Not Started | — |
| SURF-03 | 35 | — | Not Started | — |
| SURF-04 | 35 | — | Not Started | — |
| SURF-05 | 35 | — | Not Started | — |
| PTEST-01 | 36 | — | Not Started | — |
| PTEST-02 | 36 | — | Not Started | — |
| PTEST-03 | 36 | — | Not Started | — |
| PTEST-04 | 36 | — | Not Started | — |
| PTEST-05 | 36 | — | Not Started | — |

**Total: 22 requirements across 4 phases (Phase 33–36).**

Phase prefix convention: PROF (substrate) / GEN (inference) / SURF (user-facing surfaces) / PTEST (profile-specific tests — distinct from v2.4's TEST prefix which lives in the v2.4 archive).
