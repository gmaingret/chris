# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15)
- ✅ **v2.1 M007 Decision Archive** — Phases 13-19 (shipped 2026-04-18)
- ✅ **v2.2 M008 Episodic Consolidation** — Phases 20-23 + 22.1 (shipped 2026-04-19)
- ✅ **v2.3 Test Data Infrastructure** — Phase 24 (shipped 2026-04-20, archived 2026-04-25, 20/20 requirements)
- 🚧 **v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review** *(MVP shipping point)* — Phases 25-30, **active**

## Phases (active milestone)

- [x] **Phase 25: Ritual Scheduling Foundation** — Migration 0006 (rituals + wellbeing_snapshots + 4 event tables + RITUAL_RESPONSE enum), Luxon cadence helper, ritual channel slot in proactive sweep, second 21:00 cron tick, RitualConfig Zod schema, atomic UPDATE...RETURNING idempotency *(process-gate carry-in PROC-01/02 verified REDUNDANT post-GSD 1.38.4/1.38.5 on 2026-04-26 and dropped from scope)* — completed 2026-04-26 (3 plans, RIT-01..12 all shipped)
- [x] **Phase 26: Daily Voice Note Ritual** — PP#5 ritual-response detector (deposit-only contract), 6-prompt shuffled-bag rotation, 21:00 Paris fire with pre-fire suppression, STT filler tagging, polite-decline voice handler, operator UAT script — completed 2026-04-28 (5 plans, VOICE-01..06 all shipped)
- [ ] **Phase 27: Daily Wellbeing Snapshot** — Inline keyboard 3-row × 5-button (first use in codebase) + callback_query handler with per-dim upsert, partial-state persistence with hide-previous-values, optional skip without adjustment dialogue, 09:00 Paris fire (separate from voice note per D026)
- [ ] **Phase 28: Skip-Tracking + Adjustment Dialogue** — Discriminated RitualFireOutcome union, append-only ritual_fire_events, cadence-aware thresholds (daily=3, weekly=2), Haiku 3-class adjustment parser, 60s confirmation window, self-protective 30-day pause on 2 evasive, ritual_config_events audit
- [ ] **Phase 29: Weekly Review** — Sunday 20:00 Paris fire reading getEpisodicSummariesRange (M008) + resolved decisions (M007), explicit CONSTITUTIONAL_PREAMBLE injection (cron context), Sonnet structured output (1 obs + 1 Socratic Q), two-stage single-question enforcement (Zod refine + Haiku judge), pattern-only observations, wellbeing variance gate, Pensieve persist as RITUAL_RESPONSE
- [ ] **Phase 30: Test Infrastructure + HARN-03 Refresh** — 14-day synthetic fixture via vi.setSystemTime + loadPrimedFixture('m009-21days') asserting all 7 spec behaviors through full processMessage, separate cron-registration regression file, live anti-flattery 3-of-3 against real Sonnet, HARN-03 fixture refresh against fresh prod data with --target-days 21 + 5th invariant for wellbeing_snapshots (carry-in)

## Phase Details (active milestone)

### Phase 25: Ritual Scheduling Foundation
**Goal**: Substrate for everything else — migration 0006 lands first, cadence helper before any handler, cron registration with safe defaults before any cron-fired test.

> **Scope reduction (2026-04-26):** PROC-01 + PROC-02 carry-in (gsd-verifier wiring + SUMMARY.md `requirements-completed` frontmatter) verified REDUNDANT post-GSD 1.38.4/1.38.5 and dropped from active scope. Verdict block in `STATE.md` Open Items; evidence in `~/.claude/get-shit-done/workflows/execute-phase.md:1338-1376` and `~/.claude/get-shit-done/templates/summary.md:41`. Phase 25 active scope: 12 requirements / ~3 plans.

**Depends on**: v2.3 Phase 24 (primed-fixture pipeline shipped) + v2.2 Phase 22 (episodic_summaries + retrieveContext)
**Requirements**: RIT-01, RIT-02, RIT-03, RIT-04, RIT-05, RIT-06, RIT-07, RIT-08, RIT-09, RIT-10, RIT-11, RIT-12
**HARD CO-LOCATION CONSTRAINT #7**: Migration 0006 + drizzle meta-snapshot + scripts/test.sh psql line ship as ONE atomic plan. Splitting any of the three creates lineage breakage (TECH-DEBT-19-01 precedent).
**Success Criteria** (what must be TRUE):
  1. `npx drizzle-kit generate` against fresh schema produces a clean diff (zero rows); `bash scripts/test.sh` runs migration 0006 from clean Docker Postgres and reports `rituals`, `wellbeing_snapshots`, `ritual_responses`, `ritual_fire_events`, `ritual_config_events`, `ritual_pending_responses` tables present + `RITUAL_RESPONSE` epistemic_tag enum value present + 3 indexes (partial `next_run_at WHERE enabled`, `snapshot_date`, `(ritual_id, fired_at DESC)`) present.
  2. `/health` endpoint reports `ritual_cron_registered: true`; container logs at startup show `cron.schedule` registered for both 10:00 morning sweep and 21:00 evening tick (Europe/Paris); `cron.validate` rejects `RITUAL_SWEEP_CRON=garbage` at config load with a fail-fast error.
  3. `runRitualSweep()` invocable via `npx tsx scripts/manual-sweep.ts` (or REPL) returns `[]` against a clean DB without throwing; atomic `UPDATE rituals ... RETURNING *` idempotency proven by 2 concurrent invocations producing exactly 1 fired-row return.
**Plans:** 3 plans
- [x] 25-01-PLAN.md — Migration substrate (HARD CO-LOC #7 atomic): migration 0006 SQL + drizzle meta-snapshot + scripts/test.sh psql smoke gate (RIT-01..06)
- [x] 25-02-PLAN.md — Pure-function helpers: RitualConfig Zod schema, Luxon DST-safe computeNextRunAt, atomic UPDATE...RETURNING idempotency helper (RIT-07, 08, 10)
- [x] 25-03-PLAN.md — Process boundaries: runRitualSweep orchestrator, ritual channel slot in runSweep, registerCrons(deps) helper, 21:00 cron tick, cron.validate fail-fast in config, /health field, scripts/manual-sweep.ts (RIT-09, 11, 12)

### Phase 26: Daily Voice Note Ritual
**Goal**: First real ritual; exercises the highest-risk integration point in M009 (PP#5 ritual-response detector at engine position 0). After this phase, Greg gets a 21:00 Paris evening prompt with one of 6 rotating prompts, dictates an answer via Android STT keyboard, his text reply lands as a Pensieve entry tagged `RITUAL_RESPONSE`, and Chris generates ZERO chat response.
**Depends on**: Phase 25 (substrate)
**Requirements**: VOICE-01, VOICE-02, VOICE-03, VOICE-04, VOICE-05, VOICE-06
**HARD CO-LOCATION CONSTRAINT #1**: PP#5 ritual-response detector MUST land in the same plan as the voice-note handler. Splitting them = guaranteed Chris-responds-to-rituals regression for the gap window (Pitfall 6, CRITICAL).
**HARD CO-LOCATION CONSTRAINT #5**: Mock-chain coverage update for PP#5 MUST land in the same plan as PP#5 introduction. Splitting them = v2.0/v2.1 Phase 14 mock-chain regression repeats (Pitfall 24).
**Success Criteria** (what must be TRUE):
  1. Operator can `npx tsx scripts/fire-ritual.ts daily_voice_note` against a Docker test DB and observe a Telegram message arriving with one of the 6 spec prompts; sending a free-text reply within 18h causes the reply to land in `pensieve_entries` with `epistemic_tag = 'RITUAL_RESPONSE'` AND `metadata.source_subtype = 'ritual_voice_note'`, AND Chris produces NO chat response (engine returns empty string, IN-02 silent-skip).
  2. Across 600 simulated fires (property-test in `prompt-rotation.test.ts`), the 6-prompt distribution is approximately uniform (~100 each ±20), zero consecutive duplicates fire, and the maximum gap between any prompt's fires never exceeds 11.
  3. On a day with ≥5 telegram JOURNAL-mode entries already deposited, the 21:00 fire is suppressed with `system_suppressed` outcome (does NOT increment skip_count) and `next_run_at` advances to tomorrow.
  4. Greg sending an actual Telegram voice message (not text) gets a polite EN/FR/RU decline (per `franc` detection on his last text message) suggesting the Android STT keyboard mic icon — NOT silently dropped.
**Plans:** 5 plans (Wave 1 parallel: 26-01, 26-04 | Wave 2: 26-02 | Wave 3 parallel: 26-03, 26-05)
- [x] 26-01-PLAN.md — Migration 0007 + voice-note.ts substrate (PROMPTS, PROMPT_SET_VERSION, RESPONSE_WINDOW_HOURS, chooseNextPromptIndex shuffled-bag rotation primitive + 600-fire property test, prompt_text column added to ritual_pending_responses) [VOICE-02, VOICE-03]
- [x] 26-02-PLAN.md — HARD CO-LOC #1 + #5 ATOMIC: PP#5 ritual-response detector at engine position 0 + voice-note handler + recordRitualVoiceResponse atomic consume + storePensieveEntry epistemicTag extension + mock-chain coverage update across engine.test.ts + engine-mute.test.ts + engine-refusal.test.ts + cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` regression test [VOICE-01, VOICE-02, VOICE-03, VOICE-06]
- [x] 26-03-PLAN.md — Pre-fire suppression on ≥5 telegram JOURNAL entries today; advances next_run_at without incrementing skip_count; emits 'system_suppressed' outcome [VOICE-04]
- [x] 26-04-PLAN.md — Voice message polite-decline handler (`bot.on('message:voice')` ~10 LOC, EN/FR/RU per franc detection on last text language) [VOICE-05]
- [x] 26-05-PLAN.md — `scripts/fire-ritual.ts` operator wrapper for manual UAT [no new requirements; supports operator UAT]

### Phase 27: Daily Wellbeing Snapshot
**Goal**: Independent of Phase 26 (orthogonal callback_query surface). After this phase, Greg gets a 09:00 Paris morning Telegram message with a 3-row × 5-button inline keyboard (energy / mood / anxiety), taps three numbers OR taps "skip", and the snapshot is durably persisted in `wellbeing_snapshots` with one row per local day. This is the first use of inline keyboards anywhere in the Chris codebase.
**Depends on**: Phase 25 (substrate). Independent of Phases 26 + 28 + 29 — can ship in parallel after Phase 25.
**Requirements**: WELL-01, WELL-02, WELL-03, WELL-04, WELL-05
**Success Criteria** (what must be TRUE):
  1. Operator fires `daily_wellbeing` against Docker test DB, sees one Telegram message with three rows of 1–5 buttons + a skip button; tapping individual buttons in any order updates `wellbeing_snapshots` per-dimension via `INSERT ... ON CONFLICT (snapshot_date) DO UPDATE SET <dim> = EXCLUDED.<dim>` (no last-write-wins race when taps arrive within the same second).
  2. Keyboard redraws on each tap with currently-tapped values HIGHLIGHTED but PREVIOUS DAYS' values HIDDEN (anchor-bias defeat); after all 3 dimensions tapped, message edits to a confirmation summary; snapshot row in DB matches the user's tap sequence.
  3. Tapping "skip" closes the snapshot with `adjustment_eligible: false` (does NOT increment skip_count and does NOT trigger Phase 28 adjustment dialogue), distinct from the `fired_no_response` outcome a no-op produces.
  4. The 09:00 fire time is honored separately from the 21:00 voice note (D026 spirit + Pitfall 13) — both rituals can fire on the same day; neither blocks the other; morning 10:00 sweep cron picks up the 09:00 wellbeing fire.
**Plans:** 3 plans (Wave 1: 27-01 | Wave 2: 27-02 ATOMIC per D-27-06 | Wave 3: 27-03)
- [x] 27-01-PLAN.md — Callback router infrastructure (`bot.on('callback_query:data', handleRitualCallback)` first inline keyboard wiring + dispatcher + STUB wellbeing.ts for forward-import resolution) [WELL-01, WELL-02]
- [x] 27-02-PLAN.md — Wellbeing handler + seed migration 0008 ATOMIC: REPLACES STUB with `fireWellbeing` + `handleWellbeingCallback` keyboard render/edit-in-place + per-dimension upsert via `INSERT ... ON CONFLICT (snapshot_date) DO UPDATE SET <dim> = EXCLUDED.<dim>` + skip outcome `'wellbeing_skipped'` + anchor-bias defeat (no historical query, hidden previous-day values); wires `case 'daily_wellbeing'` in dispatchRitualHandler [WELL-03, WELL-04, WELL-05]
- [x] 27-03-PLAN.md — Operator UAT (`scripts/fire-wellbeing.ts`) + real-DB integration tests (8 cases) + anchor-bias regression guard in scripts/test.sh [supports WELL-01..05 via end-to-end testing]
**UI hint**: yes (Telegram inline keyboard — first use in codebase)

### Phase 28: Skip-Tracking + Adjustment Dialogue
**Goal**: Synthesis layer depending on Phases 25/26/27. After this phase, when Greg consistently misses a ritual (3 consecutive daily skips, 2 consecutive weekly skips), Chris fires a single message asking "what should change?" — Haiku parses the reply into one of 3 classes (change_requested / no_change / evasive), proposes a config patch, waits 60 seconds for confirmation, then applies. Self-protects against becoming the new nag.
**Depends on**: Phase 25 (rituals table + ritual_fire_events) + Phases 26/27 (the rituals being skipped)
**Requirements**: SKIP-01, SKIP-02, SKIP-03, SKIP-04, SKIP-05, SKIP-06, SKIP-07
**Success Criteria** (what must be TRUE):
  1. After 3 consecutive `fired_no_response` outcomes on a daily ritual (or 2 on weekly), the next sweep tick fires the adjustment dialogue message INSTEAD of the standard prompt; `system_suppressed` and `window_missed` outcomes do NOT count toward the threshold; `rituals.skip_count` is rebuildable from `ritual_fire_events` by replay.
  2. Haiku parses Greg's free-text reply into exactly one of `change_requested` / `no_change` / `evasive`; on `change_requested`, Chris echoes the proposed patch ("change voice note fire to 19:30 — OK?"); on "yes" or no response within 60 seconds, the patch lands in `rituals.config` and is recorded in `ritual_config_events`; on explicit "no", the patch is aborted and logged.
  3. After 2 `evasive` responses within 14 days on the same ritual, the ritual auto-disables for 30 days then auto-re-enables — verifiable by inserting two synthetic evasive responses 7 days apart and confirming `enabled = false` + `mute_until = +30d` after the 2nd.
  4. Inside the adjustment dialogue, M006 refusal handling is honored — Greg replying "drop it / disable / not now" routes to the refusal path (ritual paused / disabled per choice), NOT counted as `evasive`; conversation does not loop.
**Plans:** 4 plans (Wave 1: 28-01 | Wave 2: 28-02 | Wave 3: 28-03 ATOMIC migration 0010 + HIGH-LLM | Wave 4: 28-04 closing)
- [x] 28-01-PLAN.md — Outcome union + ritual_fire_events writes substrate (12-variant union + RITUAL_OUTCOME const map + adjustment_mute_until 9th field; voice-note + wellbeing + weekly-review fire+response emits; ritualResponseWindowSweep helper) [SKIP-01, SKIP-02]
- [x] 28-02-PLAN.md — Cadence-aware threshold + skip_count projection (computeSkipCount replay + shouldFireAdjustmentDialogue predicate daily=3 weekly=2 + scheduler.ts predicate dispatch with in_dialogue stub + verify-only seed audit; NO migration writes per RESEARCH Landmine 4) [SKIP-03]
- [x] 28-03-PLAN.md — Adjustment dialogue + 60s confirmation window (HIGH-LLM ATOMIC: migration 0010 metadata jsonb on ritual_pending_responses [BLOCKING schema push via scripts/test.sh gate per RESEARCH Landmine 2] + drizzle meta + scripts/test.sh gate + Haiku 3-class messages.parse v3+v4 dual + retry-cap-2 + templated fallback + confidence-default-evasive + 60s DB-row + 1-minute narrow ritualConfirmationSweep cron per RESEARCH Landmine 5 + PP#5 metadata.kind dispatch preserving voice-note default per RESEARCH Landmine 6 + scheduler real handler dispatch replacing 28-02 stub + cron-registration + index.ts wiring; Threats T-28-01/02/03 mitigated) [SKIP-04, SKIP-05]
- [x] 28-04-PLAN.md — Self-protective pause + audit trail + M006 refusal (closing: hasReachedEvasiveTrigger 2-in-14d predicate + 30-day auto-pause + autoReEnableExpiredMutes invoked at top of runRitualSweep + handleAdjustmentReply STEP 1.5 detectRefusal pre-check BEFORE Haiku per RESEARCH Pitfall 2 + routeRefusal manual_disable vs not_now 7-day adjustment_mute_until + ritual_config_events envelope-in-patch shape per RESEARCH Landmine 1; Threat T-28-04 mitigated; cumulative mockAnthropicParse.not.toHaveBeenCalled() afterAll asserts SKIP-06 invariant) [SKIP-06, SKIP-07]

### Phase 29: Weekly Review
**Goal**: Independent of Phases 26/27/28 (depends only on M007 + M008). After this phase, Greg gets a Sunday 20:00 Paris message containing exactly ONE observation drawn from the past week's episodic summaries + resolved decisions, framed with the D031 boundary marker "Observation (interpretation, not fact):", followed by exactly ONE Socratic question demanding a verdict. Multi-question Sonnet outputs are runtime-rejected and regenerated.
**Depends on**: Phase 25 (substrate + cron). Independent of Phases 26 + 27 + 28 — can ship in parallel after Phase 25.
**Requirements**: WEEK-01, WEEK-02, WEEK-03, WEEK-04, WEEK-05, WEEK-06, WEEK-07, WEEK-08, WEEK-09
**HARD CO-LOCATION CONSTRAINT #2**: Two-stage single-question enforcement (Zod refine + Haiku judge) MUST land in the same plan as the weekly-review observation generator. Splitting them = Sonnet ships unconstrained, Greg sees compound questions on the very first weekly review (Pitfall 14, HIGH).
**HARD CO-LOCATION CONSTRAINT #3**: Explicit CONSTITUTIONAL_PREAMBLE injection in `assembleWeeklyReviewPrompt()` MUST land in the same plan as the observation generator. The preamble does NOT auto-apply in cron context (CONS-04 / D038 precedent); without explicit injection, Greg sees flattery on the first weekly review (Pitfall 17, HIGH).
**Success Criteria** (what must be TRUE):
  1. On the first Sunday after deploy, Chris sends ONE Telegram message to Greg containing: header "Observation (interpretation, not fact):" + one observation citing specific dates/topics from the prior 7-day window + exactly one Socratic question phrased to force a verdict (NOT "how do you feel?"). The observation persists to `pensieve_entries` with `epistemic_tag = 'RITUAL_RESPONSE'` and `metadata.kind = 'weekly_review'`, queryable later via INTERROGATE for "show me past weekly observations".
  2. Sonnet generation goes through `messages.parse` + `zodOutputFormat`; Stage-1 Zod `.refine()` rejects multi-`?` outputs OR multiple interrogative-leading words across EN/FR/RU (`est-ce que`, `comment`, `pourquoi`, `почему`, `что`, `когда`, `what`, `why`, `how`); Stage-2 Haiku judge invoked only if Stage-1 passes, catching semantic compound questions; runtime regenerate triggered up to 2 times before falling back to a templated single-question ("What stood out to you about this week?") with `chris.weekly-review.fallback-fired` log line.
  3. Observations are pattern-only — they do NOT re-surface individual M007 decisions (those are handled by the M007 ACCOUNTABILITY channel); date-grounding post-check rejects observations citing dates outside the 7-day window. When wellbeing variance for any dimension < 0.4 over the week, the observation does NOT cite wellbeing (no signal — prevents "your mood was 3 all week" non-observations).
  4. The cron-context CONSTITUTIONAL_PREAMBLE injection holds end-to-end against real Sonnet under adversarial input — verified empirically by Phase 30 TEST-31 live test (3-of-3, zero of ~29-49 forbidden flattery markers from M006+M008 conventions per refined D-10 algorithm — exact count varies as upstream sets evolve).
**Plans:** 4 plans (Wave 1: 29-01 | Wave 2: 29-02 ATOMIC HARD CO-LOC #2+#3 | Wave 3 parallel: 29-03, 29-04)
- [x] 29-01-PLAN.md — Pure-function substrate: assembleWeeklyReviewPrompt + loadWeeklyReviewContext (getEpisodicSummariesRange + decisions WHERE resolved_at + wellbeing variance gate stddev<0.4 + insufficient-data threshold <4 snapshots) + WEEKLY_REVIEW_HEADER constant [WEEK-01 substrate]
- [x] 29-02-PLAN.md — HARD CO-LOC #2 + #3 ATOMIC: Sonnet messages.parse + zodOutputFormat generator + Stage-1 Zod refine (`?` count + interrogative-leading-word EN/FR/RU) + Stage-2 Haiku judge (`{question_count, questions[]}`) + date-grounding post-check + retry cap=2 + templated EN-only fallback `"What stood out to you about this week?"` + CONSTITUTIONAL_PREAMBLE explicit injection + storePensieveEntry epistemicTag extension + RITUAL_RESPONSE persist with metadata.kind='weekly_review' [WEEK-02..08]
- [x] 29-03-PLAN.md — Wire-up: migration 0009_weekly_review_seed.sql + `dispatchRitualHandler` switch case `'weekly_review'` + drizzle meta-snapshot regen + scripts/test.sh psql line; includes checkpoint:human-verify gated UAT task [WEEK-01 fire-side]
- [ ] 29-04-PLAN.md — HARD CO-LOC #6 prep: live anti-flattery test scaffolding (skipIf-gated until Phase 30) + adversarial fixture week + ~29-49 forbidden marker scan via 3-import deterministic algorithm (per refined D-10) + 3-of-3 atomic loop with `fallbacks === 0` strict assertion; includes 3 export-keyword visibility wirings on M006/M008 source constants [supports Phase 30 TEST-31; WEEK-09 wellbeing variance gate]

### Phase 30: Test Infrastructure + HARN-03 Refresh
**Goal**: Integration phase that proves M009 works end-to-end. Loads `m009-21days` primed fixture, mocks 14 days via `vi.setSystemTime`, runs the full `processMessage` engine pipeline (NOT bypassing PP#5), asserts all 7 spec behaviors, plus a separate cron-registration regression file (forces the wiring not to silently de-register), plus the live anti-flattery test against real Sonnet (3-of-3 atomic). HARN-03 carry-in flips the v2.3 sanity gate from 2/4 fail to 4/4 pass and adds a 5th invariant for wellbeing_snapshots.
**Depends on**: Phases 25, 26, 27, 28, 29 (cannot run until all M009 code exists)
**Requirements**: TEST-23, TEST-24, TEST-25, TEST-26, TEST-27, TEST-28, TEST-29, TEST-30, TEST-31, TEST-32, HARN-04, HARN-05, HARN-06
**HARD CO-LOCATION CONSTRAINT #4**: Cron-registration regression test in separate file `cron-registration.test.ts` (NOT bundled with synthetic-fixture.test.ts). Bundling lets one test type pass and hide the other type's gap (Pitfall 23).
**HARD CO-LOCATION CONSTRAINT #6**: Live weekly-review test (TEST-31) MUST be its own plan. Bundling it with weekly-review implementation either delays the implementation OR ships without the test (Pitfall 26 — M008 nearly hit this).
**Success Criteria** (what must be TRUE):
  1. `bash scripts/test.sh` runs `src/rituals/__tests__/synthetic-fixture.test.ts` to green; the test loads `loadPrimedFixture('m009-21days')`, advances `vi.setSystemTime` day-by-day for 14 simulated days, exercises the full `processMessage` engine pipeline (PP#5 included), and asserts all 7 spec behaviors: prompt rotation, voice-note Pensieve persistence with cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` proving PP#5 short-circuit, skip-tracking on `fired_no_response` only, adjustment dialogue at cadence-aware threshold, wellbeing snapshot via `simulateCallbackQuery` helper, weekly review with both Stage-1 + Stage-2 single-question enforcement (templated fallback exercised in ≥1 fixture week), date-grounding pass on observation references.
  2. Separate `src/rituals/__tests__/cron-registration.test.ts` asserts `registerRitualCron()` is called in `src/index.ts:main()` with the correct cron expression + timezone — regression-tests the wiring independently of fixture behavior.
  3. With `ANTHROPIC_API_KEY` present, `live-weekly-review.test.ts` runs 3 atomic iterations against real Sonnet on an adversarial fixture week (designed to bait flattery: "Greg crushed it this week, demonstrating his characteristic discipline"); generated observation contains ZERO of the 17 forbidden flattery markers from M006 conventions across all 3 runs.
  4. Operator runs `scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force` against fresh prod data; resulting `tests/fixtures/primed/m009-21days/MANIFEST.json` materializes; HARN-03 4 sanity assertions flip from current 2/4 fail to 4/4 pass; new 5th invariant asserts `wellbeing_snapshots` populated with ≥14 days of synthetic data; `--reseed-vcr` flag documented in TESTING.md with VCR cost-model warning (runaway Anthropic spend if `--target-days` bumped without reseed).
**Plans:** 3 plans
- [ ] 25-01-PLAN.md — Migration substrate (HARD CO-LOC #7 atomic): migration 0006 SQL + drizzle meta-snapshot + scripts/test.sh psql smoke gate (RIT-01..06)
- [ ] 25-02-PLAN.md — Pure-function helpers: RitualConfig Zod schema, Luxon DST-safe computeNextRunAt, atomic UPDATE...RETURNING idempotency helper (RIT-07, 08, 10)
- [ ] 25-03-PLAN.md — Process boundaries: runRitualSweep orchestrator, ritual channel slot in runSweep, registerCrons(deps) helper, 21:00 cron tick, cron.validate fail-fast in config, /health field, scripts/manual-sweep.ts (RIT-09, 11, 12)

## Phases (historical)

<details>
<summary>✅ v1.0 Phases 1-5 — SHIPPED 2026-04-13</summary>

- [x] **Phase 1: Foundation** — M001 Living Memory — Pensieve, 6-mode engine, Telegram bot
- [x] **Phase 2: Depth** — M002 Deep Counsel — 6-mode auto-detection, contradiction detection, hybrid retrieval
- [x] **Phase 3: External Sources** — M003 Digital Life — Gmail, Immich, Drive, file upload, cron sync
- [x] **Phase 4: Proactive Chris** — M004 — Proactive sweep with silence/commitment/pattern/thread triggers
- [x] **Phase 5: Requirement Validation** — M005 — All 28 v1.0 requirements resolved

</details>

<details>
<summary>✅ v2.0 Phases 6-12 — SHIPPED 2026-04-15 — M006 Trustworthy Chris (26/26 requirements, 19 plans)</summary>

- [x] **Phase 6: Memory Audit** — Ground truth module + production Pensieve reconciled (5/5 plans)
- [x] **Phase 7: Foundational Behavioral Fixes** — Constitutional preamble, refusal handling, franc language detection (4/4 plans)
- [x] **Phase 8: Retrieval & Grounding** — JOURNAL hybrid retrieval, structured Known Facts injection (2/2 plans)
- [x] **Phase 9: Praise Quarantine** — Haiku post-processor for JOURNAL/REFLECT/PRODUCE (2/2 plans)
- [x] **Phase 10: Live Validation Suite** — 24-case live suite + 20-pair FP audit against real Sonnet (2/2 plans)
- [x] **Phase 11: Identity Grounding** — John→Greg unification, includeDate gating (3/3 plans)
- [x] **Phase 12: Identity rename residuals + frontmatter hygiene** — Tech-debt closure (1/1 plan)

See [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md) for full phase detail.

</details>

<details>
<summary>✅ v2.1 Phases 13-19 — SHIPPED 2026-04-18 — M007 Decision Archive (31/31 requirements, 27 plans)</summary>

- [x] **Phase 13: Schema & Lifecycle Primitives** — Append-only `decision_events`, `decisions` projection, capture-state table, `transitionDecision()` chokepoint with optimistic concurrency (5/5 plans) — completed 2026-04-15
- [x] **Phase 14: Capture Flow** — Two-phase trigger detection (regex + Haiku stakes), conversational 5-slot extraction, vague-prediction validator, engine PP#0/PP#1 (5/5 plans) — completed 2026-04-16
- [x] **Phase 15: Deadline Trigger & Sweep Integration** — Fifth SQL-first trigger at priority=2, channel separation, dated stale-context prompts (3/3 plans) — completed 2026-04-16
- [x] **Phase 16: Resolution, Post-Mortem & ACCOUNTABILITY Mode** — New ACCOUNTABILITY mode bypassing praise quarantine, Pensieve-first write ordering, ±48h temporal context, auto-escalation after 2 non-replies (5/5 plans) — completed 2026-04-16
- [x] **Phase 17: `/decisions` Command & Accuracy Stats** — Haiku 2-axis classification cached with model version, N≥10 floor, Wilson 95% CI, domain-tag breakdown (3/3 plans) — completed 2026-04-16
- [x] **Phase 18: Synthetic Fixture + Live Suite** — Single `vi.setSystemTime` fixture covering concurrency + collision + stale-context; live Sonnet ACCOUNTABILITY suite (4/2 plans — 2 gap-closure plans) — completed 2026-04-16
- [x] **Phase 19: Proactive Pipeline Restoration** — Gap closure for v2.1 audit: byte-exact restore of `sweep.ts`, channel-aware/escalation helpers, ACCOUNTABILITY prompts from canonical `4c156c3` (lost in worktree merge `5582442`); TEST-12 realignment (4/4 plans) — completed 2026-04-17

See [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md) for full phase detail.

</details>

<details>
<summary>✅ v2.2 Phases 20-23 + 22.1 — SHIPPED 2026-04-19 — M008 Episodic Consolidation (35/35 requirements, 17 plans)</summary>

- [x] **Phase 20: Schema + Tech Debt** — TECH-DEBT-19-01 drizzle snapshot regeneration + `episodic_summaries` migration 0005 with all three indexes + Zod 3-layer type chain + `config.episodicCron` + test coverage (3/3 plans) — completed 2026-04-18
- [x] **Phase 21: Consolidation Engine** — `runConsolidate` end-to-end: CONSTITUTIONAL_PREAMBLE injection (CONS-04), 4-band rubric + frequency + chain-of-thought (CONS-05), runtime importance floors for real decisions (CONS-06) and contradictions (CONS-07), day-bounded Drizzle sources via Luxon (CONS-08/09), verbatim-quote enforcement (CONS-10), sparse-entry guard (CONS-11), Telegram error notify (CONS-12), pre-flight SELECT + ON CONFLICT idempotency (CONS-03) (4/4 plans, all 12 CONS requirements) — completed 2026-04-18
- [x] **Phase 22: Cron + Retrieval Routing** — Independent DST-safe cron at 23:00 local as peer to proactive sweep (CRON-01/02); `retrieveContext` orchestrator with 5 named RoutingReason literals — recency boundary ≤7d / >7d + verbatim-keyword EN/FR/RU fast-path + high-importance raw descent at importance≥8 (RETR-01/02/03); INTERROGATE date-anchored summary injection via three-tier regex + Haiku fallback gated on 49-keyword heuristic (RETR-04); boundary audit enforces Known Facts + `pensieve_embeddings` never reference `episodic_summaries` (RETR-05/06) (5/5 plans, all 8 RETR/CRON requirements) — completed 2026-04-19
- [x] **Phase 22.1: Wire `retrieveContext` into chat-mode handlers (INSERTED — gap closure)** — Wires JOURNAL/REFLECT/COACH/PSYCHOLOGY/PRODUCE to `retrieveContext` via new `hybridOptions` passthrough + `summaryToSearchResult` adapter export; 15 regression tests (3 per mode × 5 modes) prove routing decision fires; INTERROGATE + `/summary` byte-identical bypass preserved (1/1 plan, 0 new requirements — closes audit tech_debt for RETR-02/03 wiring) — completed 2026-04-19
- [x] **Phase 23: Test Suite + Backfill + `/summary`** — 14-day synthetic fixture with Pearson r > 0.7 (TEST-15/16), routing branches a/b/c/d (TEST-17), DST spring-forward (TEST-18), idempotency (TEST-19), decision-day floor (TEST-20), contradiction dual-position (TEST-21); `scripts/backfill-episodic.ts` operator script with --from/--to + continue-on-error (OPS-01); `/summary [YYYY-MM-DD]` Telegram command with yesterday default + EN/FR/RU localization + Luxon ISO validity gate (CMD-01); TEST-22 live anti-flattery 3-of-3 atomic against real Sonnet on adversarial 2026-02-14 fixture — zero flattery markers across 3 iterations, empirical proof M006 preamble end-to-end functional in consolidation (4/4 plans, all 10 requirements) — completed 2026-04-19

See [milestones/v2.2-ROADMAP.md](milestones/v2.2-ROADMAP.md) for full phase detail.

</details>

<details>
<summary>✅ v2.3 Phase 24 — SHIPPED 2026-04-20, archived 2026-04-25 — Test Data Infrastructure (20/20 requirements, 4 plans)</summary>

- [x] **Phase 24: Primed-Fixture Pipeline** — SHIPPED 2026-04-20 (4/4 plans, 20/20 requirements). Organic+synthetic test-data pipeline (fetch from prod → synthesize delta → real-engine episodic synthesis → load into Docker Postgres via `loadPrimedFixture`) unblocks every downstream milestone (M009–M014). D041 convention codified in PLAN.md + CONVENTIONS.md + TESTING.md.

See [milestones/v2.3-ROADMAP.md](milestones/v2.3-ROADMAP.md) for full phase detail.

</details>

---

## Progress

| Phase                              | Milestone | Plans | Status      | Completed |
|------------------------------------|-----------|-------|-------------|-----------|
| 1. Foundation                      | v1.0      | -     | Complete    | 2026-04-13 |
| 2. Depth                           | v1.0      | -     | Complete    | 2026-04-13 |
| 3. External Sources                | v1.0      | -     | Complete    | 2026-04-13 |
| 4. Proactive Chris                 | v1.0      | -     | Complete    | 2026-04-13 |
| 5. Requirement Validation          | v1.0      | -     | Complete    | 2026-04-13 |
| 6. Memory Audit                    | v2.0      | 5/5   | Complete    | 2026-04-13 |
| 7. Foundational Behavioral Fixes   | v2.0      | 4/4   | Complete    | 2026-04-13 |
| 8. Retrieval & Grounding           | v2.0      | 2/2   | Complete    | 2026-04-13 |
| 9. Praise Quarantine               | v2.0      | 2/2   | Complete    | 2026-04-13 |
| 10. Live Validation Suite          | v2.0      | 2/2   | Complete    | 2026-04-14 |
| 11. Identity Grounding             | v2.0      | 3/3   | Complete    | 2026-04-15 |
| 12. Identity rename residuals      | v2.0      | 1/1   | Complete    | 2026-04-15 |
| 13. Schema & Lifecycle Primitives  | v2.1      | 5/5   | Complete    | 2026-04-15 |
| 14. Capture Flow                   | v2.1      | 5/5   | Complete    | 2026-04-16 |
| 15. Deadline Trigger & Sweep       | v2.1      | 3/3   | Complete    | 2026-04-16 |
| 16. Resolution + ACCOUNTABILITY    | v2.1      | 5/5   | Complete    | 2026-04-16 |
| 17. `/decisions` & Accuracy Stats  | v2.1      | 3/3   | Complete    | 2026-04-16 |
| 18. Synthetic + Live Suite         | v2.1      | 4/2   | Complete    | 2026-04-16 |
| 19. Proactive Pipeline Restoration | v2.1      | 4/4   | Complete    | 2026-04-17 |
| 20. Schema + Tech Debt             | v2.2      | 3/3   | Complete    | 2026-04-18 |
| 21. Consolidation Engine           | v2.2      | 4/4   | Complete    | 2026-04-18 |
| 22. Cron + Retrieval Routing       | v2.2      | 5/5   | Complete    | 2026-04-19 |
| 22.1. Wire retrieveContext (INSERTED) | v2.2   | 1/1   | Complete    | 2026-04-19 |
| 23. Test Suite + Backfill + /summary | v2.2    | 4/4   | Complete    | 2026-04-19 |
| 24. Primed-Fixture Pipeline        | v2.3      | 4/4   | Complete    | 2026-04-20 |
| 25. Ritual Scheduling Foundation   | v2.4      | 3/3   | Complete    | 2026-04-26 |
| 26. Daily Voice Note Ritual        | v2.4      | 5/5   | Complete    | 2026-04-28 |
| 27. Daily Wellbeing Snapshot       | v2.4      | 3/3 | Complete   | 2026-04-28 |
| 28. Skip-Tracking + Adjustment Dialogue | v2.4 | 4/4 | Complete   | 2026-04-30 |
| 29. Weekly Review                  | v2.4      | 3/4 | In Progress|  |
| 30. Test Infrastructure + HARN-03 Refresh | v2.4 | 0/3 | Not started | -          |
