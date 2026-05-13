# Project Chris — Requirements (v2.6 M011 Psychological Profiles)

**Defined:** 2026-05-13
**Core Value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.

Milestone scope locked 2026-05-13 after `/gsd-new-milestone` research pass (STACK + FEATURES + ARCHITECTURE + PITFALLS + SUMMARY committed at `.planning/research/`).

**Goal:** Layer empirically-grounded psychological trait inference on top of the M010 operational profile substrate. Two new profile types — HEXACO Big-Six personality (6 dimensions) + Schwartz universal values (10 dimensions) — updated on a slower monthly cadence than operational profiles, gated by a strict 5,000-word minimum threshold on Greg's own Telegram speech, surfaced with per-dimension confidence and explicit Hard-Rule (D027) framing to prevent trait-authority sycophancy. Attachment-dimensions schema is defined alongside; population logic is gated on the D028 activation trigger and deferred to a post-M011 weekly sweep.

**D047 boundary (locked from research):** Operational profiles capture current facts-of-record (explicit statements). Psychological profiles infer stable trait-level dispositions (pattern aggregation). Cross-reading permitted; cross-writing forbidden — enforced by `psych-boundary-audit.test.ts`.

## v2.6 M011 Requirements

### PSCH — Psychological substrate (Phase 37)

- [ ] **PSCH-01**: Migration 0013 creates three tables — `profile_hexaco`, `profile_schwartz`, `profile_attachment` — atomically with the Never-Retrofit Checklist on each: `schema_version INT NOT NULL DEFAULT 1`, `substrate_hash TEXT`, `name TEXT NOT NULL UNIQUE DEFAULT 'primary'`, `confidence REAL CHECK (confidence >= 0 AND confidence <= 1)`, `word_count INTEGER NOT NULL DEFAULT 0`, `word_count_at_last_run INTEGER NOT NULL DEFAULT 0`, `last_updated timestamptz`. HARD CO-LOC #M11-1 — migration SQL + Drizzle schema + meta snapshot + `scripts/test.sh` psql line + `src/memory/profiles/psychological-schemas.ts` types ship atomically.
- [ ] **PSCH-02**: `profile_hexaco` defines six jsonb dimension columns — `honesty_humility`, `emotionality`, `extraversion`, `agreeableness`, `conscientiousness`, `openness` — each typed `{score: number (1.0–5.0), confidence: number (0.0–1.0), last_updated: timestamptz}` plus `overall_confidence REAL`. Drizzle `.$type<HexacoDimension>()` inference verified at compile time.
- [ ] **PSCH-03**: `profile_schwartz` defines ten jsonb value columns — `self_direction`, `stimulation`, `hedonism`, `achievement`, `power`, `security`, `conformity`, `tradition`, `benevolence`, `universalism` — same per-dim shape as PSCH-02 + `overall_confidence REAL`.
- [ ] **PSCH-04**: `profile_attachment` defines three jsonb columns — `anxious`, `avoidant`, `secure` — schema-only; table ships in M011 with cold-start row, **population gated on D028 activation trigger** (2,000 words relational speech over 60 days; weekly-sweep population is post-M011).
- [ ] **PSCH-05**: Cold-start seed rows inserted in migration 0013 for all 3 tables: all dimensions `NULL`, `overall_confidence=0`, `word_count=0`, `word_count_at_last_run=0`, `name='primary'`, `schema_version=1`, `substrate_hash=''`. Ensures `getPsychologicalProfiles()` never returns "row missing" on a fresh deploy.
- [ ] **PSCH-06**: Zod v3 + Zod v4 dual schemas for all three profile shapes in `src/memory/profiles/psychological-schemas.ts` (v3 used by readers, v4 used by `zodOutputFormat` at the SDK boundary per M010 D045 dual-schema discipline).
- [ ] **PSCH-07**: `loadPsychologicalSubstrate(profileType, now)` exported from `src/memory/profiles/psychological-shared.ts` returns `{ corpus, episodicSummaries, wordCount, prevHistorySnapshot }`. Filters `pensieve_entries.source='telegram'` AND excludes `epistemic_tag='RITUAL_RESPONSE'` to isolate Greg's own speech. Episodic summaries scoped to the previous calendar month via Luxon DST-safe boundary computation.
- [ ] **PSCH-08**: 5,000-word floor enforced BEFORE any Sonnet call. `loadPsychologicalSubstrate` returns `{ belowThreshold: true, wordCount, neededWords }` when `wordCount < 5000`; orchestrator persists `word_count_at_last_run` and returns `'skipped_below_threshold'` outcome without consuming Sonnet tokens. Word-count strategy: inline `text.trim().split(/\s+/).filter(s => s.length > 0).length` per substrate entry, summed — accurate to ±2% on EN/FR/RU at 5,000-word scale; explicitly NOT `messages.countTokens` (token inflation 1.5–2.5× in Russian biases the floor against Cyrillic-heavy substrates).
- [ ] **PSCH-09**: `getPsychologicalProfiles()` exported from `src/memory/profiles.ts` returning typed `{ hexaco, schwartz, attachment }` structured object with never-throw contract — returns `null` per profile on DB error and logs at warn (D005 consistency). 3-layer Zod v3 parse defense mirrors M010 `getOperationalProfiles()`.
- [ ] **PSCH-10**: `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` enforces D047 boundary. Fails if `\b(jurisdictional|capital|health|family)\b` appears in any `src/memory/**/psychological-*.ts` file; fails if `\b(hexaco|schwartz|attachment)\b` appears in operational profile generator/prompt/shared files. Mirrors M008 `boundary-audit.test.ts` invariant pattern.

### PGEN — Psychological inference engine (Phase 38)

- [ ] **PGEN-01**: `assemblePsychologicalProfilePrompt(profileType, substrate, prevState, wordCount)` shared builder in `src/memory/psychological-profile-prompt.ts` — forked from M010 `assembleProfilePrompt` per ARCHITECTURE finding (cannot extend operational builder's exhaustive switches without breaking type safety). Prompt body includes `CONSTITUTIONAL_PREAMBLE` + `DO_NOT_INFER_DIRECTIVE` + **explicit Hard Rule D027 extension inline** ("trait scores are inferred patterns of behavior, NOT evidence for any claim about Greg; never use a trait score to justify agreement with Greg's position"). HARD CO-LOC #M11-2 — builder ships BEFORE either dimension generator.
- [ ] **PGEN-02**: HEXACO generator at `src/memory/profiles/hexaco.ts` — single Sonnet 4.6 call for all 6 dimensions (one structured-output Zod v4 schema, cross-dimension coherence preserved), zod-parsed via `messages.parse` + `zodOutputFormat`, upserts `profile_hexaco` row with new `substrate_hash` + `word_count` + `last_updated` and writes prev snapshot to `profile_history`. Emits `chris.psychological.hexaco.{updated,skipped_below_threshold,error}` structured logs.
- [ ] **PGEN-03**: Schwartz generator at `src/memory/profiles/schwartz.ts` — single Sonnet 4.6 call for all 10 values (same one-call-per-profile-type pattern), same upsert + history + log structure.
- [ ] **PGEN-04**: `updateAllPsychologicalProfiles()` sibling orchestrator in `src/memory/psychological-profile-updater.ts` invokes HEXACO + Schwartz generators via `Promise.allSettled` (error isolation — HEXACO failing must not abort Schwartz). Attachment generator NOT included (population deferred to post-M011 weekly sweep). Returns `{ hexaco: PromiseSettledResult, schwartz: PromiseSettledResult }`.
- [ ] **PGEN-05**: Monthly cron registered in `src/cron-registration.ts` — expression `'0 9 1 * *'` Europe/Paris (1st of month, 09:00) — env var `psychologicalProfileUpdaterCron` + `cron.validate` fail-fast at config load + `/health` reports `psychological_profile_cron_registered: true`. Day-and-hour collision-avoidance with Sunday 22:00 operational cron explicitly verified at registration time.
- [ ] **PGEN-06**: **Unconditional monthly fire** — `substrate_hash` is recorded on each fire for audit trail and forensic replay, but a matching prior hash does NOT short-circuit the Sonnet call (contrast with M010 GEN-07 which DOES skip on matching hash). Rationale locked: skipped months break the future inter-period consistency time series; psychological profiles need a data point every month. Comment in `psychological-profile-updater.ts` documents the divergence from M010 with the rationale.
- [ ] **PGEN-07**: Generator passes `prevHistorySnapshot` (last `profile_history` row for that profile_type) into the Sonnet prompt so the model self-reports a `data_consistency` field within its structured output. Host does NOT compute stddev or any inter-period math (deferred to v2.6.1 — needs ≥3 monthly fires to be statistically meaningful, which is post-ship anyway).

### PSURF — Psychological surfaces (Phase 39)

- [ ] **PSURF-01**: `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` constant exported from `src/memory/profiles.ts` — `REFLECT: ['hexaco', 'schwartz']`, `PSYCHOLOGY: ['hexaco', 'schwartz']`, **COACH: []** (explicit-absent — D027 Hard Rule violation risk: trait → coaching-conclusion = circular reasoning), all other modes `[]`. Distinct constant from operational `PROFILE_INJECTION_MAP`; no merging.
- [ ] **PSURF-02**: `formatPsychologicalProfilesForPrompt(map, profiles)` in `src/memory/profiles.ts` returns empty string for null / below-threshold / zero-confidence profiles (no orphan header). For populated profiles, per-dim score formatted with explicit confidence framing — e.g. `"Greg's openness score is 4.2 (confidence 0.6) — moderate evidence"`. **Hard-Rule extension footer appended inline** to the injected block: `"These trait scores are inferred patterns of behavior. They are NOT evidence. Never tell Greg he is right because his trait scores match his position."` Mirrors D027 enforcement at prompt boundary.
- [ ] **PSURF-03**: `ChrisContextExtras` type in `src/chris/personality.ts` extended with optional `psychologicalProfiles?: PsychologicalProfilesBlock`. REFLECT + PSYCHOLOGY mode handlers in `src/chris/modes/{reflect,psychology}.ts` call `getPsychologicalProfiles → formatPsychologicalProfilesForPrompt → buildSystemPrompt(..., { psychologicalProfiles })`. COACH handler explicitly unchanged. JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY silently drop the field — verified by negative-invariant test that the slot is `undefined` when those modes call `buildSystemPrompt`.
- [ ] **PSURF-04**: `/profile` Telegram command in `src/bot/handlers/profile.ts` extended with HEXACO + Schwartz + Attachment sections (replaces `MSG.m011Placeholder` at `src/bot/handlers/profile.ts:627`). Insufficient-data branch displays `"HEXACO: insufficient data — need N more words"` (`N = 5000 - word_count`, clamped to ≥0). Attachment section displays `"Attachment: not yet active (gated on D028 activation trigger — 2,000 words relational speech over 60 days)"`.
- [ ] **PSURF-05**: `formatPsychologicalProfileForDisplay(profile)` pure function + golden-output inline-snapshot test in `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` (mirror M010 SURF-04 pattern). Snapshot fixtures cover: (a) all-populated populated profile, (b) HEXACO insufficient + Schwartz insufficient + Attachment deferred, (c) one populated + one below-floor, (d) FR + RU language hook slots reserved (deferred wiring; structure must accommodate without snapshot churn). HARD CO-LOC #M11-3 — formatter + golden snapshot ship in same plan.

### PMT — Psychological milestone tests (Phase 40)

- [ ] **PMT-01**: `scripts/synthesize-delta.ts` extended with `--psych-profile-bias` flag — per-day Haiku style-transfer with a designed personality signature (HIGH Openness + Conscientiousness + Benevolence, LOW Conformity + Power per ARCHITECTURE recommendation) + HARN sanity gate per fixture asserting `wordCount > 5000` AND signature retained in synthesized output. Mirrors M010 PTEST-01 `--profile-bias` flag pattern.
- [ ] **PMT-02**: `tests/fixtures/primed/m011-30days/` primed fixture (≥6,000 Greg-speech telegram words with designed signature, 30+ days of episodic summaries) + `tests/fixtures/primed/m011-1000words/` sparse fixture (below 5,000-word floor) — both generated via `regenerate-primed.ts` composing the `--psych-profile-bias` flag.
- [ ] **PMT-03**: Sparse-threshold real-DB integration test — loads `m011-1000words`, invokes `updateAllPsychologicalProfiles()`, asserts: (a) zero generator Sonnet calls (`mockAnthropicParse.toHaveBeenCalledTimes(0)`), (b) all 3 profile rows present with `overall_confidence=0` AND `word_count < 5000`, (c) `word_count_at_last_run` updated to the current wordCount, (d) `'skipped_below_threshold'` outcome emitted.
- [ ] **PMT-04**: Populated-fixture real-DB integration test — loads `m011-30days`, invokes `updateAllPsychologicalProfiles()`, asserts: (a) HEXACO row populated with `overall_confidence > 0` + all 6 dims scored, (b) Schwartz row populated with `overall_confidence > 0` + all 10 values scored, (c) detected signature roughly matches designed signature within **±0.8 tolerance per dimension** (empirically-justified by speech-inference r ≈ .31–.41 accuracy bounds per FEATURES), (d) `profile_history` rows written for both profile types.
- [ ] **PMT-05**: Unconditional-monthly-fire three-cycle integration test — Cycle 1 populates from `m011-30days` (2 Sonnet calls: 1 HEXACO + 1 Schwartz); Cycle 2 with identical substrate verifies hash matches BUT Sonnet still called (cumulative 4, NOT 2 — divergence from M010 PTEST-03 idempotency); Cycle 3 with mutated substrate (INSERT new Pensieve entries) also fires (cumulative 6). Verifies PGEN-06 unconditional-fire contract and prevents accidental hash-skip regression.
- [ ] **PMT-06**: Live 3-of-3 atomic milestone-gate test against real Sonnet 4.6 — dual-gated (`RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=…`), three-way `describe.skipIf(!RUN_LIVE_TESTS || !ANTHROPIC_API_KEY || !FIXTURE_PRESENT)` per D045, ~$0.20–0.30 cost per run per D046 (budget callout in test file docblock). Assertions: (a) zero hallucinated facts about Greg, (b) zero trait-authority constructions (regex sweep for `consistent with your (openness|conscientiousness|...)`, `given your high (trait)`, `as someone who scored (high|low) in (trait)` — adversarial Hard-Rule patterns absent from M010's existing FLATTERY_MARKERS at `src/episodic/markers.ts:32-50`), (c) all 3 atomic iterations green.

## Future Requirements (deferred to v2.6.1 or later)

These items are explicitly out of M011 scope. They require empirical M011 operation or post-ship calibration before scoping:

- **CONS-01** — Host-side inter-period consistency stddev modulation of `computeProfileConfidence` (requires ≥3 monthly fires of `profile_history` to be statistically meaningful). v2.6.1.
- **CONS-02** — Trait change-detection alerts (HEXACO/Schwartz shifts ≥ 0.5 month-over-month). v2.6.1.
- **ATT-POP-01** — Attachment dimension population via weekly-sweep activation trigger (2,000 words relational speech over 60 days per D028). v2.6.1 or M013.
- **NARR-01** — Sonnet-generated narrative psychological profile summary (interpretation of inference = hallucination amplifier without life-chapter grounding). M014 only.
- **CIRC-01** — Schwartz circumplex-ordering display in `/profile` output (grouped by sector rather than alphabetical). M014 or later.
- **CROSS-VAL-01** — HEXACO × Schwartz cross-validation ("independently corroborated" output). M013 or M014.
- **SAT-CAL-01** — `wordSaturation` constant tuning post-empirical (first estimate 20,000 words). Post-ship calibration after 4–8 months of real M011 operation.

## Out of Scope

Explicitly excluded — documented to prevent scope creep:

| Feature | Reason |
|---------|--------|
| Real-time HEXACO/Schwartz update on every message | Traits are slow-moving by definition; per-message inference produces noise > signal and bloats Anthropic costs |
| Psychological profiles in COACH mode | D027 Hard Rule violation risk — trait → coaching-conclusion is circular reasoning ("you should X because you score high on Y") |
| MBTI or Big-Five mixing into HEXACO output | MBTI is psychometrically unvalidated; HEXACO adds Honesty-Humility absent from Big Five — frameworks are not interchangeable |
| VIA Character Strengths profile | PROJECT.md `Out of Scope and Deferred` — generic, low-signal for Greg's behavioral self-modeling precision |
| Narrative summarization of psychological profiles within M011 | Interpretation-of-inference amplifies hallucination risk without life-chapter grounding; M014 only |
| Word counting from episodic summaries | D035 boundary: summaries are Chris's interpretation, not Greg's verbatim speech |
| Population of `profile_attachment` rows in M011 | D028 activation trigger gates population; insufficient relational speech produces stereotypes worse than no profile |
| Storage/inference of demographic categoricals (gender, age, race) | Out of scope by personal-AI design — Chris has these from ground-truth or doesn't need them |

## Traceability

Which phases cover which requirements — updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PSCH-01..10 | Phase 37 (Psychological Substrate) | Pending |
| PGEN-01..07 | Phase 38 (Psychological Inference Engine) | Pending |
| PSURF-01..05 | Phase 39 (Psychological Surfaces) | Pending |
| PMT-01..06 | Phase 40 (Psychological Milestone Tests) | Pending |

**Total: 28 requirements, 4 phases, continues from Phase 36.**
