# Milestones

## v2.6.1 Code Review Cleanup (Shipped: 2026-05-15)

**Phases completed:** 7 phases, 17 plans, 39/39 requirements, 79 commits

**Genesis:** Triggered 2026-05-14 by a live UX defect — adjustment-dialogue prompt asserted "This daily daily_journal ritual isn't working" to Greg (FR locale). A 14-phase parallel `gsd-code-reviewer` sweep across v2.3 → v2.6 surfaced 45 BLOCKERs + 97 WARNINGs. 39 of those organized into 9 thematic categories (T1–T8 + display polish) shipped via wave-based execution.

**Key accomplishments:**

- **Phase 41 (P0 live-fix):** Adjustment-dialogue rework — observational copy replaces "isn't working"; `src/rituals/display-names.ts` constant map eliminates slug exposure ("daily journal" not "daily daily_journal"); skip_count resets on yes/no/refusal completion paths (5 sites); `mute_until` removed from Haiku-controllable whitelist (privilege escalation closed); per-field type validation on `confirmConfigPatch`.
- **Phase 42:** Six atomicity/race fixes via shared `src/__tests__/helpers/concurrent-harness.ts`. M009 second-fire bug class permanently closed via `sql\`now()\``-driven postgres-clock predicates; `ritualResponseWindowSweep` paired-insert transactional; wellbeing rapid-tap idempotent via completion-claim UPDATE + nested jsonb_set merge on skip; DST-edge 24h cutoff on findOpenWellbeingRow; weekly-review transactional fire (Telegram failure rolls back state).
- **Phase 43:** `sanitizeSubstrateText` helper escapes `## ` line-start anchors in both operational and psychological inference prompts; `data_consistency real NOT NULL DEFAULT 0` (CHECK 0..1) column on psych tables via migration `0014_psychological_data_consistency_column`; `stripMetadataColumns` removes dataConsistency from prevState; `extract<X>PrevState` returns null on first-fire across 4 operational dimensions.
- **Phase 44:** `REQUIRE_FIXTURES=1` env-gated inline single-failing-test pattern across 10 milestone-gate test files (M009 ×3, M010 ×4, M011 ×3); 12 `[CI-GATE] fixture present` describe blocks; Family C (live-anti-hallucination) orthogonal to RUN_LIVE_TESTS (no paid Anthropic call from CI gate); byte-identical local-dev UX preserved.
- **Phase 45:** Migration `0015_psychological_check_constraints` (19 jsonb-path CHECKs); migration `0016_phase33_seed_defaults_backfill` (UPDATE seed rows + ALTER COLUMN SET DEFAULT for wellbeing_trend + parent_care_responsibilities) — root-cause of M010 schema_mismatch warns; contradictions FK pre-filter at synthesize-delta:934; bias-prompt phrasesClause decoupled from dimensionHint; SSH `StrictHostKeyChecking=accept-new` + repo-vetted `scripts/.ssh-known-hosts`; pgvector(1024) staging-table CAST; AbortController + `process.exitCode=130` SIGINT pattern across 3 operator scripts; M010 fixture refresh (FIX-06) via `regenerate-primed.ts --milestone m010 --force` (~75s end-to-end).
- **Phase 46:** New `src/chris/locale/strings.ts` exports `qualifierFor(c, lang)` + `LANG_QUALIFIER_BANDS` + `normalizeForInterrogativeCheck` — `qualifierFor` consolidated from 2 duplicates to 1 canonical home. 21 EN-only sites in `bot/handlers/profile.ts` localized for FR/RU (qualifier + HEXACO 6 dims + Schwartz 10 dims + score template); `WEEKLY_REVIEW_HEADER` + `TEMPLATED_FALLBACK` per-locale; FR regex curly-apostrophe + NFC normalize fix; daily-journal PROMPTS locale-aware. Golden snapshots per locale (EN/FR/RU) lock the output.
- **Phase 47:** `SCHWARTZ_CIRCUMPLEX_ORDER` canonical clockwise 10-element array (opposing pairs at ring distance ≥4); `CROSS_VALIDATION_RULES` hardcoded 16-rule table for HEXACO × Schwartz cross-validation observations (preserves Phase 39 D-22 reader-never-throw — no Sonnet at /profile read path); 0.3 confidence floor; locale-aware observation strings (EN/FR/RU); observational tone on negative observations.

**Key decisions locked:** Migration sequencing 0014 → 0015 → 0016; no new locale-detection layer (both Phase 41 and Phase 46 reuse existing `src/chris/language.ts`); `MSG`-shape pattern for slug-keyed `Record<Lang, T>` co-located with consumer; hardcoded rule table over Sonnet-at-call-time for cross-validation observations.

**Notable inline recoveries:**
- Plan 45-03 sibling agent rate-limited mid-plan → parent orchestrator completed Tasks 2-4 inline (snapshot + journal + test.sh + integration test, 4/4 green)
- Migration-number conflict between Phase 43 and Phase 45 discuss-phase agents → reconciled to 0014/0015/0016
- Phase 46 plan-checker BLOCKER (L10N-03c regression false-positive) → fixed inline (direct INTERROGATIVE_REGEX assertion + new L10N-03c2 multi-interrogative test)
- Phase 47 distance-5 invariant relaxed to ≥4 when geometry didn't match CONTEXT narrative

**Live trigger evidence:** the buggy adjustment-dialogue fired AGAIN on prod at 17:00 Paris 2026-05-15 (`8adeb85` still deployed); deploy of v2.6.1 closes the user-visible regression.

**Known deferred items at close** (v2.6.2 candidates):
- PTEST-03 three-cycle date-window fragility (test pins NOW assumption)
- psychological-profiles.test.ts:171 — test-injection now rejected by migration 0015 CHECK (test needs different invalid value)
- M011 HARN gates regen (Plan 45-04 only ran m010; m011 needs separate `--milestone m011` regen)
- FR/RU translation review pass (20-row table in 46-02 SUMMARY for `/gsd-verify-work`)

---

## v2.6 M011 Psychological Profiles (Shipped: 2026-05-14)

**Phases completed:** 4 phases, 9 plans, 28/28 requirements

**Key accomplishments:**

- Migration 0013 ships 3 psychological-profile tables (HEXACO/Schwartz/Attachment) atomically with full Never-Retrofit Checklist; `loadPsychologicalSubstrate` discriminated-union loader with SQL-level `source='telegram'` filter + 5000-word floor at substrate level; `getPsychologicalProfiles` never-throw reader + 3-layer Zod v3 parse defense; `psych-boundary-audit.test.ts` two-directional D047 enforcement.
- `assemblePsychologicalProfilePrompt` shared builder + `PSYCHOLOGICAL_HARD_RULE_EXTENSION` constant (Phase 38 PGEN-01) — single source of truth for D027 trait-authority mitigation, reused verbatim by Phase 39's surface formatter. HARD CO-LOC #M11-2 — builder ships BEFORE either dimension generator.
- HEXACO + Schwartz generators with **UNCONDITIONAL FIRE contract** (PGEN-06) — direct inverse of M010 GEN-07 idempotency. `substrate_hash` recorded for audit-trail but never short-circuits the Sonnet call. Verified by belt-and-suspenders: Phase 38 contract-level + Phase 40 fixture-driven three-cycle tests, both with D-24 verbatim docblock locking the contract.
- 5th cron `'0 9 1 * *'` Europe/Paris registered alongside M010's Sunday 22:00 cron with `validatedCron` fail-fast + 12-month Luxon-based collision-check unit test confirming no same-hour overlap.
- `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` distinct constant (REFLECT/PSYCHOLOGY → `['hexaco', 'schwartz']`); COACH explicitly absent at the type-union level (compile-time defense) + grep-sweep negative-invariant test asserting zero psych vocabulary leaks into `coach.ts` (CI-time defense against future "let's also inject in COACH" PRs).
- `/profile` Telegram command extended with HEXACO/Schwartz/Attachment sections via `formatPsychologicalProfileForDisplay` 4-branch state model (populated / insufficient-data / never-fired / attachment-deferred); EN/FR/RU localization slots with machine-translate-quality placeholders; golden inline-snapshot test (15 snapshots × 4 scenarios × FR/RU variants) — HARD CO-LOC #M11-3.
- `--psych-profile-bias` boolean flag in `synthesize-delta.ts` with designed personality signature (HIGH O/C/H-H + S-D/B/U; LOW Conf/Pow). HARN sanity gate asserts `wordCount > 5000` + `OPENNESS_SIGNAL_PHRASES` retention (Pitfall §7 mitigation against Haiku style-transfer signature erasure). Post-ship fix `93b0432` strengthened the Haiku prompt with exemplar phrases — 5/6 phrases retained on 60-day fixture.
- **Live PMT-06 milestone gate green** (2026-05-14T13:09Z, ~$0.25 spend, 57.5s) — 3-of-3 atomic against real Sonnet 4.6: zero hallucinated facts, zero trait-authority constructions matching 5 FORBIDDEN_TRAIT_AUTHORITY_PATTERNS × 16 HEXACO+Schwartz traits, both PSYCH_INJECTION_HEADER + PSYCHOLOGICAL_HARD_RULE_EXTENSION footer asserted present in real REFLECT-mode system prompts.

**Key decisions locked:** D027 Hard Rule defended at 6 independent surfaces (constant + inference framing + surface footer + map key-union + COACH negative test + live regex sweep); UNCONDITIONAL FIRE inverse of M010 GEN-07; D047 operational/psychological boundary fence; substitution order psychological → operational → pensieve.

**Known deferred items at close** (v2.6.1 candidates):
- Loader word-count gap (m011-30days raw 12k→PG 4k; worked around with 60-day fixture)
- m011-1000words contradictions FK violation (worked around inline)
- M010 operational fixture schema_mismatch warns (unrelated to M011 assertions)
- Attachment population orchestration (D028 / ATT-POP-01)
- Host-side inter-period consistency math (CONS-01)
- Real FR/RU translation polish (Phase 39 D-20)
- Trait change-detection alerts (CONS-02)

---

## v2.5 v2.5 (Shipped: 2026-05-13)

**Phases completed:** 4 phases, 10 plans, 54 tasks

**Key accomplishments:**

- Drizzle ORM pgTable definitions + migration 0012 SQL + drizzle meta snapshot for 4 operational profile tables (jurisdictional, capital, health, family) plus profile_history, with Zod v3+v4 dual schemas and Phase 33 Docker smoke gate
- Never-throw getOperationalProfiles() reader with 3-layer Zod v3 parse defense (Pitfall 4/5/6), plus pure-function confidence helpers (computeProfileConfidence/isAboveThreshold), shipped TDD with 35 new tests (15 confidence + 14 schema + 6 reader)
- `assembleProfilePrompt` pure-function shared builder ships with locked OQ-2 volume-weight ceiling phrasing + DO_NOT_INFER directive + previous-state injection + 4-dimension parametrized structural tests (40/40 GREEN) — HARD CO-LOC #M10-2 anchor satisfied; Plan 34-02 unblocked.
- Per-dimension generator helper extracted into `runProfileGenerator` (Claude's Discretion default); shared SHA-256 substrate-hash idempotency closes the M009 `lt→lte` second-fire-blindness regression class via the HARD CO-LOC #M10-3 atomic 3-cycle test (Cycle 1 → 4 calls, Cycle 2 identical → STILL 4 calls, Cycle 3 INSERTs a new Pensieve entry → 8 calls). Closure-captured volume-weight ceiling .refine() constructed INSIDE the generator function body per RESEARCH.md residual risk 938-941. 40/40 plan-owned tests GREEN; full src/memory suite 150/150 GREEN; full Docker suite 1490 passed / 12 skipped / 29 pre-existing deferred-items failures (live-API tests requiring real ANTHROPIC_API_KEY — sandbox uses fallback 'test-key' which yields 401, documented in deferred-items.md prior to Plan 34-02 start).
- Plan 34-03 ships the production wiring that turns Plan 34-02's 4 per-dimension generators into a Sunday 22:00 Paris cron-driven inference engine.
- `buildSystemPrompt` now accepts `(mode, pensieve?, relational?, extras?: ChrisContextExtras)` — atomic 8-site production refactor + 7-test-file migration in a single plan, ACCOUNTABILITY overload preserved verbatim, `extras.operationalProfiles` slot reserved for Plan 35-02 wiring.
- `PROFILE_INJECTION_MAP` named constant + `formatProfilesForPrompt` pure function ship in `src/memory/profiles.ts`; REFLECT/COACH/PSYCHOLOGY handlers now wire `getOperationalProfiles → formatProfilesForPrompt → buildSystemPrompt(..., { operationalProfiles })` per D-14 call order; JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY silently drop the field per D-28 negative invariant; full Docker suite delta = +38 new passing tests / 0 new failures.
- `/profile` Telegram command shipped with handleProfileCommand + formatProfileForDisplay pure function + 16-case inline-snapshot golden test + bot registration — all atomically per HARD CO-LOC #M10-5. M010-07 regression gate (third-person framing detector) now active. Phase 35 SURF block 5/5 complete. Full Docker suite delta: +26 new passing tests / 0 new failures.
- `--profile-bias` repeatable flag with PROFILE_BIAS_KEYWORDS/ROTATION + dimensionHintFor helper extends synthesize-delta.ts; seedProfileRows() helper mitigates Pitfall P-36-02; 4 new fixture-driven test files (HARN sanity + PTEST-02 populated + PTEST-03 three-cycle idempotency + PTEST-04 sparse threshold) ship green covering all M010 PTEST-01..04 requirements atomically per HARD CO-LOC #M10-6
- 1. [Rule 3 — Blocking] Promoted `PROFILE_INJECTION_HEADER` to a named export

---

## v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review (Shipped: 2026-05-11)

**Phases completed:** 6 phases, 23 plans, 85 tasks

**Key accomplishments:**

- 6 ritual/wellbeing tables + RITUAL_RESPONSE epistemic_tag value + drizzle meta lineage 0..6 + 6|1|3 substrate smoke gate — landed as ONE atomic plan per HARD CO-LOCATION CONSTRAINT #7.
- Three pure-function modules under `src/rituals/` (types, cadence, idempotency) with 24 TDD-built tests proving Zod strict-mode rejection (RIT-07), DST-safe wall-clock cadence advancement across both 2026 Europe/Paris transitions (RIT-08), and SQL-level exactly-once ritual fire under concurrency (RIT-10).
- Wires Phase 25's substrate (Wave 1 schema + Wave 2 helpers) into the running container: the 21:00 Paris ritual cron, the runRitualSweep orchestrator with all three Pitfall 1 defenses (per-tick max-1 + per-ritual cadence advancement + 3/day channel ceiling), the cron.validate fail-fast at config load, /health reports ritual_cron_registered, and `npx tsx scripts/manual-sweep.ts` returns [] against a clean DB.
- Hand-authored migration 0007 seeds the `daily_voice_note` ritual + adds NOT NULL `prompt_text` column to `ritual_pending_responses` (DEFAULT-then-DROP-DEFAULT pattern) + creates PP#5 hot-path partial index; new `src/rituals/voice-note.ts` exports the frozen 6-prompt array + 4 SCREAMING_SNAKE_CASE tunables + `chooseNextPromptIndex` pure shuffled-bag rotation with deterministic no-consecutive-duplicate invariant proven empirically across 5600 simulated fires.
- Highest-risk plan in M009 lands atomically: PP#5 detector at top of `processMessage`, `fireVoiceNote` handler dispatched via name-keyed switch, `storePensieveEntry` extended with `epistemicTag` parameter, and mock-chain coverage update across 3 engine test files. Cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` afterAll invariant in `engine-pp5.test.ts` empirically proves Pitfall 6 mitigation; `Promise.allSettled` race test in `voice-note-handler.test.ts` empirically proves atomic-consume mutual exclusion via `UPDATE ... WHERE consumed_at IS NULL RETURNING`.
- VOICE-04 lands as a 4-commit lineage: `'system_suppressed'` literal appended to `RitualFireOutcome` union (D-26-06), `shouldSuppressVoiceNoteFire` Pensieve-direct query helper added (D-26-05), `fireVoiceNote` STEP 0 suppression branch with `dayBoundaryUtc(now, tz).end`-anchored cadence advancement (D-26-04 + Rule 1 fix), and 7-test real-DB integration coverage (helper-direct + scheduler-integration). Pitfall 9 (heavy-deposit-day redundancy) mitigated; the suppression branch advances `next_run_at` to tomorrow's 21:00 Paris with NO Telegram send, NO pending row insert, NO `prompt_bag` update, NO `skip_count` touch (Phase 28 boundary preserved).
- Telegram message:voice handler replying in EN/FR/RU per M006 stickiness suggesting Android STT keyboard mic icon — no Whisper transcription, no Pensieve write, no engine-pipeline invocation, peer to existing message:text + message:document handlers via bot.on() registration.
- Thin operator CLI script (~80 LoC including header docstring) that backdates a named ritual's `next_run_at` to one minute in the past, then invokes `runRitualSweep` once, prints JSON-formatted results, and exits cleanly — satisfies ROADMAP §Phase 26 success criterion 1 manual UAT shape against staging.
- Plan 27-02 unblocked.
- ATOMIC plan per D-27-06: migration 0008 + REPLACED wellbeing.ts (fireWellbeing + handleWellbeingCallback) + dispatchRitualHandler switch wiring all ship together. Closes the runtime gap where seed-without-handler would dispatch to Phase 25's throwing skeleton. All 5 WELL requirements (WELL-01..05) terminate in this plan; Plan 27-03 lands operator UAT + integration tests.
- Operator UAT script (`scripts/fire-wellbeing.ts`) + 8 real-DB integration tests covering all 5 WELL requirements + scripts/test.sh anchor-bias regression guard. Closes Phase 27 with triple-layer D-27-04 prong-1 regression defense + Rule 1 fix to a latent postgres-js jsonb-binding bug exposed by the new tests.
- 12-variant RitualFireOutcome union + RITUAL_OUTCOME const map + fire-side ritual_fire_events writes across all 3 ritual handlers + ritualResponseWindowSweep atomic-consume helper with paired window_missed/fired_no_response emits
- Cadence-aware skip-threshold predicate (daily=3, weekly=2) wired into runRitualSweep as gate before standard handler dispatch, with replay-projection computeSkipCount and adjustment_mute_until 7-day deferral honored
- 1. [Rule 1 - Bug] drizzle-kit snapshot where clause format mismatch
- One-liner:
- Pure-function substrate for the M009 Sunday weekly review: 8-section prompt assembler with explicit CONSTITUTIONAL_PREAMBLE injection (HARD CO-LOC #3 prep), Luxon DST-safe 7-day window helper, parallel-fetch loader (M008 first production consumer of getEpisodicSummariesRange), and the WEEK-09 wellbeing variance gate (per-dim stddev with ANY-dim-flat rule + insufficient-data short-circuit) — all enforced at prompt-assembly time so Sonnet never sees wellbeing data when the gate fails.
- The load-bearing M009 quality plan: Sonnet observation generator wired through Stage-1 Zod refine (regex `?` + EN/FR/RU interrogative-leading-word ≤1) + Stage-2 Haiku judge ({question_count, questions[]}) + date-grounding Haiku post-check + retry cap=2 + English-only templated fallback + Pensieve persist as RITUAL_RESPONSE — all atomic in a single plan to prevent Pitfall 14 (compound questions) and Pitfall 17 (sycophantic flattery) from regressing on the first weekly review.
- WEEK-01 fire-side substrate ships: migration 0009_weekly_review_seed.sql is idempotent + applies cleanly to fresh Docker postgres (Sunday 20:00 Europe/Paris next_run_at via deterministic SQL CASE), drizzle-kit acceptance gate green, dispatchRitualHandler routes 'weekly_review' → fireWeeklyReview from Plan 29-02, scripts/test.sh exits with the seed-row gate green, and 2 new scheduler.test.ts tests prove the dispatch path end-to-end. The full pipeline (cron tick → runRitualSweep → tryFireRitualAtomic → dispatchRitualHandler → fireWeeklyReview) is now invocable for the first time at the next Sunday 20:00 Paris cron tick.
- One-liner:
- Refreshed m009-21days primed fixture + adapted sanity invariants to actual synth pipeline output (D-07 gap-filler semantics) + added --reseed-vcr flag + filed Phase 32 substrate-hardening TODOs.
- 14-day synthetic fixture integration test ships M009's milestone-shipping gate — vi.setSystemTime walk + cumulative PP#5 short-circuit assertion across all 7 TEST-23..30 spec behaviors in 6 it() blocks.

---

## v2.3 Test Data Infrastructure (Shipped: 2026-04-20)

**Phases completed:** 1 phase (24), 4 plans
**Timeline:** 2026-04-20 (active engineering landed in a single ~15-hour burst); milestone closed 2026-04-25 after retroactive audit-trail remediation
**Requirements:** 20 / 20 satisfied
**Git range:** 30 commits since v2.2 (`cdf952e` → `ff2ba4e`) — +11,078 / -137 LOC across 113 files
**Audit:** initially `gaps_found` (2026-04-24) — 4 audit-trail artifacts missing (no `24-VERIFICATION.md`, VALIDATION.md frozen in draft, SUMMARY frontmatter missing `requirements-completed`, FETCH-01..05 inline checkboxes still `[ ]`). Engineering work was demonstrably complete throughout — only bookkeeping was missing. Remediation 2026-04-24 produced `24-VERIFICATION.md` via `gsd-verifier` (11/11 must-haves, 20/20 REQs, 63 tests re-run live), flipped `24-VALIDATION.md` to `nyquist_compliant: true`, corrected REQUIREMENTS.md checkboxes. Re-audit flipped to `passed`.
**Test evidence:** 44 unit tests (freshness 13 + seed 16 + vcr 15) green in 432ms; 19 synthesize-delta tests green in 1.27s; 8 load-primed integration tests green under Docker. HARN-03 sanity gate `describe.skip` when fixture absent (sandbox/CI safe). Excluded-suite Docker gate baseline preserved.

**Goal:** Pre-M009 enabler. Build the organic+synthetic primed-fixture pipeline so every downstream milestone (M009–M014) can be validated immediately, without waiting real calendar time for episodic summaries to accumulate. Codify a project convention banning calendar-time data-accumulation gates in subsequent milestones.

**Key accomplishments:**

- **Organic prod-data pipeline (`scripts/fetch-prod-data.ts`).** SSH-tunneled `postgres.js .unsafe(sql).cursor(1000)` JSONL streaming dump of 9 tables — `pensieve_entries` filtered to `source='telegram'` only, `pensieve_embeddings` scoped via INNER JOIN, plus `episodic_summaries`, `decisions`, `decision_events`, `decision_capture_state`, `contradictions`, `proactive_state`, `relational_memory`. Read-only belt-and-suspenders (`default_transaction_read_only: true`). Atomic `LATEST` symlink update (tmp + rename, relative target). 24h auto-refresh helper (`autoRefreshIfStale(path, { ttlHours })`) silent-fetches via `child_process.spawn` when LATEST goes stale; 13 unit tests cover 23h/25h boundaries, ENOENT-as-stale, `noRefresh: true` short-circuit, ChrisError wrapping. Verified live 2026-04-20 against Proxmox (192.168.1.50) — 338 rows in ~600ms.

- **Synthetic delta generator (`scripts/synthesize-delta.ts` + VCR cache).** 700-LOC CLI fuses organic base with per-day Haiku style-transfer (temperature=0, 8-example seeded few-shot from `seededSample(organic, 8, seed+d)`). Content-addressable SHA-256 VCR wrapper (`src/__tests__/fixtures/vcr.ts`) layers on top of the existing Anthropic SDK singleton — keys sorted at every nesting level (load-bearing — Anthropic SDK's nested `output_config.format` JSON-schema emitter doesn't preserve order). Atomic `tmp + rename` writes. Deterministic UUID generator (4 × Mulberry32 → UUIDv4 layout) replaces `crypto.randomUUID()` at every synthesis site to close SYNTH-07 byte-identical-rerun gap. Wellbeing `to_regclass` feature-detect with `synth.wellbeing.skip` info-log when table is absent (M009 may add the schema). `--no-refresh` flag plumbed through to `autoRefreshIfStale({ noRefresh })`. Vitest config widened: `root='.'` with explicit includes for both `src/**/__tests__/` and `scripts/**/__tests__/`.

- **Real-engine episodic synthesis (`scripts/synthesize-episodic.ts`).** 536-LOC sibling-module composition (Pattern 2 Option 3) — the entire no-production-code-mod contract. Dynamic-import order in `main()` is load-bearing: env-vars → `import '../src/llm/client.js'` → `import vcr.js` → property-swap `anthropic.messages.parse = cachedMessagesParse` → `import '../src/episodic/consolidate.js'`. Spins up throwaway Docker Postgres on **port 5435** (distinct from `regen-snapshots.sh`'s port 5434 per RESEARCH §Pitfall 5; `grep 5434` returns 0, `grep 5435` returns 6). Applies all 6 migrations 0000..0005, bulk-loads via `jsonb_populate_recordset` in FK-safe forward order, invokes the real `runConsolidate(new Date('<D>T12:00:00Z'))` to populate authentic Sonnet-generated `episodic_summaries.jsonl`. `git diff src/` returns empty after commit. `dbOverride` param convention on exported helpers reuses scripts/test.sh's port-5433 container in vitest.

- **Consumer-side test harness (`loadPrimedFixture` + HARN-03 sanity gate + `regenerate-primed.ts`).** `src/__tests__/fixtures/load-primed.ts` exports `loadPrimedFixture(name)`: FK-safe bulk-load into Docker Postgres test DB in correct reverse-FK cleanup order; idempotent + collision-safe across repeated calls in one suite; wellbeing `to_regclass` feature-detect; D-09 stale-warn soft-fail default with `{ strictFreshness: true }` opt-in (no in-tree consumer of strict today — future hook). FK-cleanup uses `relational_memory` (actual Drizzle table at schema.ts:134), NOT the REQ-alias "memories"; `grep -c "from '.*schema\.js'.*memories\b" src/__tests__/fixtures/load-primed.ts` = 0. 8 integration tests covering MISSING_DIR, FK-safe cleanup, idempotency, collision-safety, stale-warn, stale-strict, wellbeing feature-detect, cleanup ORDER. `primed-sanity.test.ts` is the HARN-03 4-invariant gate (≥7 summaries, ≥200 telegram entries, UNIQUE(summary_date), no non-telegram source leakage) with `describe.skip` when MANIFEST.json absent — keeps `bash scripts/test.sh` green in sandbox/CI; flips to running once operator runs `regenerate-primed`. `scripts/regenerate-primed.ts` is a 256-LOC pure composer — zero in-process synthesis logic, each step `child_process.spawn` with `stdio:'inherit'`. Extensible to M009+.

- **Project convention codification (D041).** *"No milestone may gate on real calendar time for data accumulation — use the primed-fixture pipeline instead."* Codified in three places: PLAN.md §Key Decisions D041, `.planning/codebase/CONVENTIONS.md` §Test Data, `.planning/codebase/TESTING.md` §Primed-Fixture Pipeline. Removes the M009 7-real-calendar-day prerequisite and prevents future milestones from re-introducing equivalent waits.

- **Retroactive audit-trail remediation (post-ship).** Phase 24 shipped 2026-04-20 without a live `24-VERIFICATION.md`, with `24-VALIDATION.md` frozen in `draft` (`nyquist_compliant: false`, `wave_0_complete: false`), with SUMMARY.md frontmatter missing `requirements-completed`, and with FETCH-01..05 inline checkboxes still `[ ]` despite the traceability table marking them complete. The 2026-04-24 audit (this milestone's `/gsd-audit-milestone` invocation) flagged all four. Remediation that day: `gsd-verifier` agent generated `24-VERIFICATION.md` (status: passed, 11/11 must-haves, 20/20 REQ-IDs, with live re-run of 63 tests confirming deliverables); `24-VALIDATION.md` flipped to `nyquist_compliant: true` + `wave_0_complete: true` + all 5 task rows green with test-count evidence + 6 Wave 0 + 6 Sign-Off checkboxes marked complete; REQUIREMENTS.md FETCH-01..05 corrected to `[x]`. Re-audit flipped from `gaps_found` to `passed`. The audit-trail gap was a process regression — see "Deferred / tech debt" for the action items going into v2.4.

**Deferred / tech debt:**

- **Process regression: `gsd-verifier` not wired into `/gsd-execute-phase`.** Phase 24 is the first phase in this project to ship without a live VERIFICATION.md. v2.0/v2.1/v2.2 phases all had one (archived under `.planning/milestones/v2.X-phases/`). Action item before v2.4 kicks off: investigate why and add a regression test or workflow gate so future phases can't ship without it.
- **Process regression: SUMMARY.md frontmatter missing `requirements-completed`.** All 4 Phase 24 plans omit this field. Inline REQ-ID mentions in summary bodies provided coverage evidence, but the structured frontmatter would let `gsd-sdk query summary-extract --pick requirements_completed` automate cross-reference. Action item: update SUMMARY.md template / planner-agent prompt before next milestone.
- **Upstream `gsd-sdk` bug.** `gsd-sdk query milestone.complete <version>` calls `phasesArchive([], projectDir)` without forwarding the version arg, so it always throws "version required for phases archive". This v2.3 milestone close was performed manually as a workaround. Action item: file an upstream issue against `get-shit-done-cc` package.
- **Manual operator UAT pending** for the live prod path. `PROD_PG_PASSWORD=<…> npx tsx scripts/regenerate-primed.ts --milestone m008 --target-days 14 --seed 42 --force` against real Proxmox needs to be run once to materialize `tests/fixtures/primed/m008-14days/MANIFEST.json` — at which point HARN-03's 4 sanity assertions flip from skipped to running.
- **12 human-UAT items carried from v2.1 + v2.2** (live Telegram feel, ACCOUNTABILITY tone, `/decisions` dashboard format, FR/RU localization) — still pending human runs.
- **Env-level vitest-4 fork-IPC hang under HuggingFace EACCES** — pre-existing issue continues. 5-file excluded-suite mitigation in `scripts/test.sh` keeps Docker gate green. Worth a future fix-up phase; may intersect with v2.3 test-harness work in 24-04.

---

*Archived: `milestones/v2.3-ROADMAP.md`, `milestones/v2.3-REQUIREMENTS.md`, `milestones/v2.3-MILESTONE-AUDIT.md`*

---

## v2.2 M008 Episodic Consolidation (Shipped: 2026-04-19)

**Phases completed:** 5 phases (20, 21, 22, 22.1, 23), 17 plans
**Timeline:** 2026-04-18 → 2026-04-19 (2 days active work)
**Requirements:** 35 / 35 satisfied
**Git range:** 94 commits since v2.1 (`e0b54f7` → `660091e`) — +15,815 / -145 LOC across 82 files
**Audit:** passed (2026-04-19) — 14 / 14 Warning code-review findings resolved across 5 phases in 20 commits; 1 Warning deferred with documented design rationale (Phase 21 WR-02 retry-on-all-errors policy); integration re-check flipped `status: tech_debt → passed` after Phase 22.1 Plan 01 closed the `retrieveContext` orphan-orchestrator wiring gap
**Test evidence:** 1014 passed / 15 environmental failed (excluded-suite Docker gate; full `bash scripts/test.sh` hits the documented vitest-4 fork-IPC hang under HuggingFace `@huggingface/transformers` EACCES — pre-existing env issue)

**Goal:** Episodic consolidation — end-of-day summaries that compress each day's Pensieve entries into structured narrative with importance scoring, tier-aware retrieval routing, and date-anchored INTERROGATE injection. Foundation for M009 weekly review (needs daily summaries as substrate) and M010+ profile inference (needs consolidated episodes, not raw entries).

**Key accomplishments:**

- **Schema foundation (Phase 20)** — Migration 0005 ships `episodic_summaries` (8 cols + `UNIQUE(summary_date)` + `GIN(topics)` + `btree(importance)`, all in initial migration not retrofitted). TECH-DEBT-19-01 drizzle-kit snapshot lineage cleaned via `scripts/regen-snapshots.sh` clean-slate iterative replay. Three-layer Zod chain (`SonnetOutput → Insert → DB-read`) exported from `src/episodic/types.ts`. `config.episodicCron` default `"0 23 * * *"`. Phase 20 WR-02 hardened EXIT-trap in `regen-snapshots.sh` so re-run no longer destroys committed 0005 snapshot.
- **Consolidation engine (Phase 21) — M006 preamble continuity.** `runConsolidate(date: Date)` end-to-end in `src/episodic/consolidate.ts`: pre-flight SELECT + ON CONFLICT belt-and-suspenders idempotency (CONS-03); entry-count gate before any Sonnet call (CONS-02); `assembleConsolidationPrompt()` pure module injects the M006 `CONSTITUTIONAL_PREAMBLE` explicitly (cron runs outside the engine; preamble does not auto-apply — CONS-04); 4-band importance rubric + frequency-distribution guidance + chain-of-thought instruction (CONS-05); runtime importance floors for real decisions (≥6) and contradictions (≥7) clamped post-parse (CONS-06/07); `getDecisionsForDay` / `getContradictionsForDay` / `getPensieveEntriesForDay` day-bounded Drizzle helpers via Luxon (DST 23h/25h safe); `buildVerbatimQuoteClause` + `buildSparseEntryGuard` forbid paraphrase and hallucinated specifics (CONS-10/11); `notifyConsolidationError` surfaces Telegram on failure, no silent failures (CONS-12). Phase 21 WR-01 fix threaded `tz` through `ConsolidationPromptInput → assembleConsolidationPrompt → buildEntriesBlock` so HH:MM renders in `config.proactiveTimezone` via Luxon, eliminating the UTC leak.
- **Cron + retrieval routing (Phase 22)** — Independent `cron.schedule(config.episodicCron, runConsolidateYesterday, { timezone: config.proactiveTimezone })` in `src/index.ts` as peer to proactive sweep (not nested); DST-safe via `node-cron`'s UTC-internal arithmetic plus CONS-03 belt-and-suspenders (`UNIQUE(summary_date)` + pre-flight SELECT collapses any double-firing to no-op). `retrieveContext()` orchestrator with five named `RoutingReason` literals — two-dimensional routing on recency boundary (≤7d raw / >7d summary first) AND verbatim-fidelity escape (15-keyword EN/FR/RU `VERBATIM_KEYWORDS` fast-path, pure keyword match, NO Haiku call). `HIGH_IMPORTANCE_THRESHOLD = 8` triggers raw descent via `loadEntriesByIds(summary.sourceEntryIds)`. INTERROGATE gets its own ad-hoc date routing in `src/chris/modes/interrogate.ts` (three-tier regex fast-path EN/FR/RU + Haiku fallback gated on 49-keyword heuristic); labeled `## Recent Episode Context (interpretation, not fact)` D031 boundary marker prepended before Known Facts. Phase 22 WR-02/03/04 hardened `extractQueryDate` to noon-UTC anchor (eliminates negative-offset tz drift), leading `\b` on FR/RU regexes, and post-check calendar-validity to reject Feb 30 / April 31 / Feb 29 non-leap. Boundary audit at `src/chris/__tests__/boundary-audit.test.ts` enforces: summary text NEVER enters Known Facts or `pensieve_embeddings` (RETR-05/06).
- **Decimal Phase 22.1 — wire `retrieveContext` into 5 chat-mode handlers.** Gap closure inserted after initial v2.2 audit identified `retrieveContext` as orphaned (implementation shipped in Phase 22 Plan 02 but chat modes still called `hybridSearch` directly). `src/pensieve/routing.ts` extended with `hybridOptions?: SearchOptions` passthrough + `summaryToSearchResult(summary)` adapter export synthesizing a `SearchResult` with `score=1.0` sentinel and labeled inline `[Episode Summary YYYY-MM-DD | importance=N/10 | topics=...]` content. JOURNAL/REFLECT/COACH/PSYCHOLOGY/PRODUCE handlers now follow a uniform 5-line wire. 15 new regression tests (3 per mode × 5 modes) prove the routing decision fires. INTERROGATE + `/summary` bypass byte-identical (`git diff --stat` returns empty for those handlers). Audit flipped `status: tech_debt → passed`.
- **INTERROGATE + `/summary` user-facing commands.** `handleInterrogate` (Phase 22 Plan 03) wires date-anchored summary injection when `ageDays > 7` strict AND `getEpisodicSummary` returns a row. `handleSummaryCommand` at `src/bot/handlers/summary.ts` (Phase 23 Plan 03) — no-args → yesterday; explicit YYYY-MM-DD → that date; future-date short-circuit (D-32) before any DB call; past-empty → localized "no summary" message (D-30, NOT an error per CMD-01 verbatim); plain text reply (D-31); EN/FR/RU localization. Registered at `bot.command('summary', handler)` preserving D-26 ordering invariant (all `bot.command(...)` precede `bot.on('message:text', ...)`). Phase 23 WR-01 added Luxon ISO-validity gate so `/summary 2026-02-30` hits usage reply not DB.
- **Test suite + operator backfill.** Phase 23 shipped `src/episodic/__tests__/synthetic-fixture.test.ts` (1136 lines): 14-day `vi.setSystemTime` fixture with pre-committed `GROUND_TRUTH_LABELS=[1,2,3,4,4,5,5,6,6,7,7,8,9,10]` covering all four CONS-05 bands + both tails. TEST-16 14-day Pearson r > 0.7; TEST-17 a/b/c/d four routing branches; TEST-18 DST 2026-03-08 PST→PDT in America/Los_Angeles; TEST-19 idempotency `{ skipped: 'existing' }`; TEST-20 decision-day floor 3→6; TEST-21 contradiction-day floor 4→7 + verbatim dual-position. `scripts/backfill-episodic.ts` (272 lines) operator script: `--from YYYY-MM-DD --to YYYY-MM-DD`, sequential 2s-delay UTC iteration, `runConsolidate` per-day with full discriminated `ConsolidateResult` handling, continue-on-error (D-22), ESM `main()` guard, exports `runBackfill` programmatic entry. TEST-22 live anti-flattery 3-of-3 atomic against real Sonnet on adversarial 2026-02-14 fixture — 17 flattery markers surveyed from M006 conventions (NOT invented); passed with zero markers across all 3 iterations — empirical proof M006 constitutional preamble is end-to-end functional in consolidation pipeline.

**Deferred / tech debt:**

- **`getEpisodicSummariesRange` exported-only forward substrate for M009.** Zero production callers in v2.2. Acceptable as-is — explicitly forward-looking for M009 weekly review (which will fan out across a 7-day window).
- **Env-level vitest-4 fork-IPC hang under HuggingFace EACCES.** Pre-existing M006/M007 issue surfacing again in Plans 22-02/03/05 and 23-01..04 `bash scripts/test.sh` runs. Root cause: root-owned `node_modules/@huggingface/transformers` cache dir + `live-integration.test.ts` 401-retry loop triggers unhandled rejections under vitest-4 fork mode. Documented operational mitigation: 5-file excluded-suite reaches exit 0 in ~28s; 15 remaining failures are the documented environmental baseline (3 models-smoke API-gated + 7 engine-mute + 5 photos-memory). Not a v2.2 regression. Worth a future fix-up phase.
- **Phase 21 WR-02 retry-on-all-errors policy (1 Warning deferred).** `runConsolidate` retries once on any Sonnet/Zod error rather than classifying by error type. Documented design choice — over-selective retry complicates happy path without measurable benefit. M009+ may revisit if error patterns emerge.
- **12 human-UAT items carried from v2.1** (live Telegram feel, ACCOUNTABILITY tone, `/decisions` dashboard format, FR/RU localization) — still pending human runs.

---

*Archived: `milestones/v2.2-ROADMAP.md`, `milestones/v2.2-REQUIREMENTS.md`, `milestones/v2.2-MILESTONE-AUDIT.md`, `milestones/v2.2-INTEGRATION-CHECK.md`*

---

## v2.1 M007 Decision Archive (Shipped: 2026-04-18)

**Phases completed:** 7 phases (13–19), 27 plans, 36 tasks
**Timeline:** 2026-04-15 → 2026-04-18 (3 days active work)
**Requirements:** 31 / 31 satisfied
**Git range:** 252 commits since v2.0 (`c20d66e` → `2abc2c9`) — +9,322 / -379 LOC across 49 files
**Audit:** passed (2026-04-18T06:16Z) — 4 / 4 Critical + 30 / 30 Warning code-review findings resolved; 3 Phase 13 Info items documented as intentional deferrals
**Test evidence:** 152 / 152 Docker Postgres proactive + synthetic-fixture tests pass (4.19s)

**Goal:** Capture every structural decision Greg makes with reasoning and a falsifiable forecast, surface the forecast at its resolution date, and run a post-mortem — converting Chris from reflective journal into epistemic accountability tool.

**Key accomplishments:**

- **Phase 13 — Schema & Lifecycle Primitives** — Append-only `decision_events` log, `decisions` projection, and `decision_capture_state` capture session. `transitionDecision(id, fromStatus, toStatus, payload)` is the sole chokepoint for `decisions.status` mutation, using optimistic concurrency (`UPDATE … WHERE id=$id AND status=$expected`) and three distinguishable error classes (`InvalidTransitionError`, `OptimisticConcurrencyError`, `DecisionNotFoundError`). `regenerateDecisionFromEvents(id)` proves the projection is replayable from the event log.
- **Phase 14 — Capture Flow** — Two-phase trigger detection (EN/FR/RU regex + Haiku `trivial`/`moderate`/`structural` stakes classifier) with fail-closed behavior. Conversational 5-slot Haiku extraction (greedy multi-answer consolidation, 3-turn cap, EN/FR/RU abort phrases). `parseResolveBy` natural-language timeframe parser with 7/30/90/365-day fallback ladder. `/decisions suppress <phrase>` persistence with case-insensitive substring match. Engine pre-processors PP#0 and PP#1 wired before mute/refusal/language/mode detection.
- **Phase 15 / 19 — Dual-Channel Sweep** — Fifth SQL-first trigger (`decision-deadline`, priority 2) added to the existing `silence`/`commitment`/`pattern`/`thread` pipeline. Sweep split into independent `reflective_outreach` and `accountability_outreach` channels with per-channel daily caps and serial collision handling. Dated stale-context prompt when fired ≥48h past `resolve_by`. Write-before-send ordering via `upsertAwaitingResolution`. (Phase 19 restored Phase 15/16 artifacts lost in worktree merge `5582442`.)
- **Phase 16 — Resolution, Post-Mortem & ACCOUNTABILITY Mode** — New `ACCOUNTABILITY` mode bypasses the praise quarantine at the prompt level (D025 pattern) and forbids The Hard Rule (D027). `handleResolution` → `classifyOutcome` (Haiku 4-class fail-closed to `ambiguous`) → `handlePostmortem` → `resolved → reviewed` transition, with both replies stored as Pensieve entries linked via `source_ref_id`. ±48h `getTemporalPensieve` context and Popper criterion redisplay.
- **Phase 16 / 19 — Auto-Escalation** — Per-decision escalation tracking via `setEscalationSentAt` / `setEscalationCount` / `clearEscalationKeys`. Single 48h follow-up, silent `due → stale` transition after 2 non-replies, escalation block bypasses daily cap. (Phase 19 restored the escalation helpers and sweep block.)
- **Phase 17 — `/decisions` Command & Accuracy Stats** — 8 sub-commands wired (`open`, `recent`, `stats [30|90|365]`, `suppress`, `suppressions`, `unsuppress`, `reclassify`, dashboard), registered before the generic text handler, pull-only. 2-axis Haiku reasoning classifier (`outcome` × `reasoning`) cached at resolution time with model version string. N≥10 floor with Wilson 95% CI (`z = 1.96`) — no percentage below floor. SQL `FILTER (WHERE …)` rolling 30/90/365-day windows; `unverifiable` surfaced as a separate denominator. Domain-tag breakdown and `/decisions reclassify` preserving originals.
- **Phase 18 — Synthetic Fixture + Live Suite** — Single `vi.setSystemTime` fixture drives capture → deadline → resolution → post-mortem → stats over a simulated 14-day window with zero calendar time (TEST-10). Concurrency race test proves exactly one winner via optimistic concurrency (TEST-11). Channel-separation collision test (TEST-12, realigned in Phase 19-04 to the dual-channel contract). Live Sonnet ACCOUNTABILITY suite asserting absence-of-flattery and absence-of-condemnation (TEST-13, D023/D032 precedent) and Haiku vague-prediction resistance (TEST-14) — both gated on `ANTHROPIC_API_KEY` and deferred to human UAT.

**Deferred / tech debt:**

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing. drizzle-kit does not backfill snapshots for already-applied entries. Runtime migrator (`scripts/test.sh`) applies `.sql` directly and does not consult the snapshots. Reactivation trigger: next phase that modifies `src/db/schema.ts`.
- **Phase 13 Info deferrals** — 3 items documented `Fix: None required` in `13-REVIEW.md`: hardcoded `localtest123` password in test harness, raw `psql` vs Drizzle migrator in `scripts/test.sh`, hyphenated enum value `open-draft` (locked by D-04).
- **Live-API UAT pending** — TEST-13 (live ACCOUNTABILITY hit/miss/unverifiable × 3-of-3) and TEST-14 (vague-validator adversarial) tests are written and Docker-verified for non-API paths, but 3-of-3 Sonnet / live Haiku execution requires a human run with `ANTHROPIC_API_KEY`. 12 human-UAT items across Phases 14/16/17/18 similarly deferred (Telegram UX feel, tone quality, localization, live API runs).
- **Pre-existing baseline failures out of v2.1 scope** — 45 `engine.test.ts` mock-chain failures introduced by an earlier partial restore of `engine.ts` PP#0 block (proven pre-existing via rollback+rerun in Plan 19-01 evidence); 49 live-LLM env failures requiring `ANTHROPIC_API_KEY` + HuggingFace cache permissions.

**Summary-frontmatter hygiene:** Several plan-level SUMMARY.md files omit the `one_liner:` / `requirements-completed:` frontmatter fields (14-04, 15-01, 15-02, 16-01/02/04, 17-01/02/03, 18-01/03/04). Requirements are nevertheless corroborated as SATISFIED in each phase's VERIFICATION.md with direct code/test evidence. Non-blocking; noted for future audit ergonomics.

---

*Archived: `milestones/v2.1-ROADMAP.md`, `milestones/v2.1-REQUIREMENTS.md`, `milestones/v2.1-MILESTONE-AUDIT.md`, `milestones/v2.1-INTEGRATION-CHECK.md`, `milestones/v2.1-phases/` (phase directories).*

---
