# Requirements — v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review

**Milestone:** v2.4 M009 — Ritual Infrastructure + Daily Voice Note + Daily Wellbeing + Weekly Review *(MVP shipping point)*
**Generated:** 2026-04-26
**Source:** `M009_Ritual_Infrastructure.md` + research synthesis at `.planning/research/SUMMARY.md` + 6 spec interpretations confirmed during kickoff

After M009 ships, Greg has the full reflection loop: M006 trust + M007 decision archive + M008 episodic consolidation + M009 daily voice note + daily wellbeing + weekly review. Everything from M010 onward feeds on the real cadence-driven data this milestone produces.

**Spec interpretations locked during kickoff (override M009_Ritual_Infrastructure.md text):**
1. Wellbeing fires at 09:00 Europe/Paris, **separate** from voice note (21:00) — D026 spirit + Pitfall 13 mechanism. (Spec said "alongside".)
2. Single-question enforcement uses **two-stage Zod refine + Haiku judge**, not literal token-count. (Spec said "token-count check".)
3. Skip threshold is **cadence-aware** (daily=3, weekly=2), not uniform 3. (Spec said "3 or more times in a row" uniformly.)
4. Voice message handling: Greg's input modality is **Android STT keyboard**; `bot.on('message:voice')` polite-decline (~10 LOC). No Whisper. (PLAN.md Out-of-Scope preserved.)
5. Prompt rotation uses **shuffled-bag** (stronger than spec's "no consecutive duplicates" floor).
6. **No 1-month real-use pause before M010** — superseded by D041; M010 validates via primed-fixture pipeline.

---

## v1 Requirements

### Ritual Infrastructure

- [x] **RIT-01**: Migration 0006 ships `rituals` table — id (uuid pk), name (text NOT NULL UNIQUE), type (enum daily/weekly/monthly/quarterly NOT NULL), last_run_at (timestamptz nullable), next_run_at (timestamptz NOT NULL), enabled (boolean NOT NULL default true), config (jsonb NOT NULL default `{}`), skip_count (integer NOT NULL default 0), created_at (timestamptz default now()).
- [x] **RIT-02**: Migration 0006 ships `wellbeing_snapshots` table — id (uuid pk), snapshot_date (date NOT NULL UNIQUE), energy (smallint CHECK 1–5), mood (smallint CHECK 1–5), anxiety (smallint CHECK 1–5), notes (text nullable), created_at (timestamptz default now()).
- [x] **RIT-03**: Migration 0006 ships supporting tables — `ritual_responses`, `ritual_fire_events`, `ritual_config_events`, `ritual_pending_responses` (Append-only event tables for skip-tracking + adjustment audit per D004).
- [x] **RIT-04**: Migration 0006 adds `RITUAL_RESPONSE` to `epistemic_tag` enum (14th value).
- [x] **RIT-05**: Migration 0006 ships all indexes from day one (D034 precedent) — partial `btree(next_run_at) WHERE enabled = true`; `btree(snapshot_date)`; `(ritual_id, fired_at DESC)` on `ritual_responses`.
- [x] **RIT-06**: Migration 0006 lineage cleaned via `scripts/regen-snapshots.sh` clean-slate iterative replay (TECH-DEBT-19-01 pattern); `scripts/test.sh` extended with the new psql line.
- [x] **RIT-07**: `RitualConfig` Zod schema (8 named fields + `schema_version`) at every read boundary; rejects unknown fields. Fields: `fire_at`, `fire_dow` (weekly only), `prompt_bag` (voice note only), `skip_threshold`, `mute_until`, `time_zone`, `prompt_set_version`, `schema_version`.
- [x] **RIT-08**: `src/rituals/cadence.ts` exports `computeNextRunAt(now, config)` using Luxon (`DateTime.plus({ days/weeks/months })` + `setZone(tz)`). Wall-clock advancement, NEVER `last_run_at + 24h`. DST-safe across 2026-03-29 + 2026-10-25.
- [x] **RIT-09**: Ritual firing as a **third channel** (not 6th trigger) inside `runSweep` between accountability and reflective. Per-tick max-1-ritual cap; catch-up ceiling; window-bound firing; shares global mute (`isMuted()`); independent daily counter from reflective/accountability. *(shipped Plan 25-03; D-04 refined the daily counter to 3/day ceiling to accommodate the worst case of voice note + wellbeing + weekly review on the same Sunday)*
- [x] **RIT-10**: Atomic `UPDATE rituals SET last_run_at=now(), next_run_at=$NEW WHERE id=$ID AND last_run_at IS NULL OR last_run_at < $LAST_OBSERVED RETURNING *` idempotency (write-before-send, mirrors M007 D-28). Prevents double-fire under cron-tick race.
- [x] **RIT-11**: Second cron tick at 21:00 Europe/Paris registered in `src/index.ts` (peer to existing 10:00 sweep + 23:00 episodic). Morning 10:00 catches accountability + reflective + 09:00 wellbeing; evening 21:00 catches voice note + Sunday weekly review. *(shipped Plan 25-03 via registerCrons(deps) helper per D-06)*
- [x] **RIT-12**: `src/config.ts` exports `ritualSweepCron` env var with safe default `0 21 * * *`; `cron.validate` at config load short-circuits on invalid expression. `/health` endpoint reports `ritual_cron_registered`. *(shipped Plan 25-03 via validatedCron helper + createApp(deps?) DI)*

### Daily Voice Note Ritual

- [ ] **VOICE-01**: PP#5 ritual-response detector at position 0 of `processMessage` (BEFORE PP#0 mute and PP#1 decision capture). Looks up `ritual_pending_responses` by user-id + within `RESPONSE_WINDOW_HOURS` (default 18). On hit: write to Pensieve as `epistemic_tag = RITUAL_RESPONSE` with `metadata.source_subtype = 'ritual_voice_note'`, return empty string, IN-02 silent-skip.
- [ ] **VOICE-02**: Six rotating prompts in spec order — "What mattered today?", "What's still on your mind?", "What did today change?", "What surprised you today?", "What did you decide today, even if it was small?", "What did you avoid today?" — stored as ordered constant in `src/rituals/voice-note.ts` with `PROMPT_SET_VERSION = 'v1'`.
- [ ] **VOICE-03**: Shuffled-bag rotation via `rituals.config.prompt_bag: number[]` storing unused indices in current cycle. Spec floor "no consecutive duplicates" satisfied + naturally produces no-repeat-in-last-6. Property-test verifiable: 600 fires = ~100 each, no consecutive dupes, max gap ≤ 11.
- [ ] **VOICE-04**: Default fire time 21:00 Europe/Paris, configurable via `rituals.config.fire_at`. Pre-fire suppression: if `>=5` telegram JOURNAL-mode entries already today, skip fire and advance `next_run_at` to tomorrow without incrementing skip_count (avoids redundancy on a day Greg already deposited heavily).
- [ ] **VOICE-05**: `bot.on('message:voice')` polite-decline handler (~10 LOC) — replies in EN/FR/RU per `franc` detection on the user's last text message language, suggests Android STT keyboard mic icon, does NOT transcribe via Whisper. Prevents silent drops.
- [ ] **VOICE-06**: STT filler tagging — Pensieve entries from voice note ritual carry `metadata.source_subtype = 'ritual_voice_note'`. Future retrieval consumers can filter or weight differently if STT noise proves problematic.

### Daily Wellbeing Snapshot

- [ ] **WELL-01**: Single Telegram message with 3-row × 5-button `InlineKeyboard` (energy / mood / anxiety, 1–5 each) + a 4th-row "skip" button. First use of inline keyboards in this codebase.
- [ ] **WELL-02**: `bot.on('callback_query:data', handleRitualCallback)` registered in `src/bot/bot.ts`. Each tap upserts the corresponding column in `wellbeing_snapshots` per-dimension via `INSERT ... ON CONFLICT (snapshot_date) DO UPDATE SET <dim> = EXCLUDED.<dim>` to avoid last-write-wins race under rapid taps.
- [ ] **WELL-03**: Partial-state in `ritual_responses.metadata` jsonb — survives across taps. UI redraws keyboard with current selections HIGHLIGHTED (so Greg sees what he's tapped) but PREVIOUS DAYS' values HIDDEN (defeats anchor bias). Snapshot considered "complete" once all 3 dimensions tapped or "skip" pressed.
- [ ] **WELL-04**: Skip button (`adjustment_eligible: false`) — optional skip allowed without triggering adjustment dialogue. Distinct from a `fired_no_response` outcome (which DOES trigger skip-tracking).
- [ ] **WELL-05**: Default fire time 09:00 Europe/Paris, configurable via `rituals.config.fire_at`. **Separate from voice note (21:00)** per D026 spirit + Pitfall 13 — captures felt-state in the morning before the day's narrative reflection pollutes the numeric series.

### Weekly Review

- [ ] **WEEK-01**: Sunday 20:00 Europe/Paris default fire time (one hour earlier than voice note); configurable via `rituals.config.fire_at` + `rituals.config.fire_dow`. Reads via `getEpisodicSummariesRange(weekStart, weekEnd)` (M008 substrate, first consumer) + `decisions WHERE resolved_at BETWEEN weekStart AND weekEnd`.
- [ ] **WEEK-02**: `assembleWeeklyReviewPrompt()` in `src/rituals/weekly-review.ts` injects `CONSTITUTIONAL_PREAMBLE` explicitly (CONS-04 / D038 pattern — preamble does NOT auto-apply in cron context). System prompt explicitly states the date window.
- [ ] **WEEK-03**: Sonnet generates exactly **one observation** + **one Socratic question** with structured output `{ observation: string, question: string }` via `messages.parse` + `zodOutputFormat`. Strict 7-day window; date-grounding post-check rejects observations citing dates outside the window.
- [ ] **WEEK-04**: D031 boundary marker on user-facing message header — "Observation (interpretation, not fact):" — mirrors M008 INTERROGATE pattern. Greg sees clearly that this is interpretation, not raw recall.
- [ ] **WEEK-05**: **Two-stage single-question enforcement.** Stage 1: Zod `.refine()` on `question` field — regex `?` count = 1 AND no interrogative-leading-word per language (FR `est-ce que`, `comment`, `pourquoi`; RU `почему`, `что`, `когда`; EN `what`, `why`, `how` — only one allowed). Stage 2: Haiku judge with structured output `{ question_count: number, questions: string[] }` — only invoked if Stage 1 passes (catches semantic compound questions Stage 1 missed).
- [ ] **WEEK-06**: Retry cap = 2 on Stage-1 OR Stage-2 rejection. After cap: templated single-question fallback (e.g., "What stood out to you about this week?"). Mirrors M008 CONS error policy. Logged as `chris.weekly-review.fallback-fired` for diagnostic visibility.
- [ ] **WEEK-07**: Pattern-only observations — explicit prompt instruction NOT to re-surface individual decisions (M007 ACCOUNTABILITY channel handles individual surfacing). Forecast-resolved-this-week observation style **deferred** to v2.5 (DIFF-5).
- [ ] **WEEK-08**: Weekly review observation persists to Pensieve as `epistemic_tag = RITUAL_RESPONSE` with `metadata.kind = 'weekly_review'` for longitudinal recall ("show me past weekly observations" via INTERROGATE).
- [ ] **WEEK-09**: Wellbeing variance check at week-end — if any dimension's stddev < 0.4 over the 7-day window, weekly review observation does NOT cite wellbeing (no signal). Prevents "your mood was 3 all week" non-observations.

### Skip-Tracking + Adjustment Dialogue

- [ ] **SKIP-01**: Discriminated `RitualFireOutcome` union — `responded` / `window_missed` / `fired_no_response` / `system_suppressed`. Only `fired_no_response` increments `rituals.skip_count`. `system_suppressed` (e.g., VOICE-04 pre-fire suppression) does NOT count.
- [ ] **SKIP-02**: Append-only `ritual_fire_events` table — `rituals.skip_count` is denormalized projection rebuildable from events (D004 spirit; M007 `decision_events` precedent).
- [ ] **SKIP-03**: **Cadence-aware skip thresholds** — daily=3, weekly=2. Per-cadence default in row creation; configurable per-ritual via `rituals.config.skip_threshold`. Monthly=2 / quarterly=1 defaults forward-compatible for M013.
- [ ] **SKIP-04**: Adjustment dialogue fires on threshold crossing — single Telegram message: "This [daily/weekly] [name] ritual isn't working — what should change?" Strict Zod parse on Haiku output with 3-class classification: `change_requested` / `no_change` / `evasive`.
- [ ] **SKIP-05**: 60-second confirmation window for `change_requested` route — Chris echoes proposed config patch and asks "OK to apply?" (yes/no). On "yes" or no response within 60s, applies. On explicit "no", aborts and logs to `ritual_config_events`.
- [ ] **SKIP-06**: Self-protective 30-day pause — after 2 evasive responses within 14 days, ritual disabled for 30 days then auto-re-enables. Prevents adjustment dialogue itself becoming nagging.
- [ ] **SKIP-07**: Append-only `ritual_config_events` audit trail — every config mutation captured (who changed what, when, in response to which dialogue). M006 refusal handling honored INSIDE the dialogue (Greg can refuse the adjustment conversation without it counting as evasive).

### Process Gate (Carry-In #1) — RESOLVED UPSTREAM (2026-04-26)

> **Both items shipped upstream in GSD 1.38.4 / 1.38.5; verified REDUNDANT during v2.4 kickoff (verdict block in `STATE.md` Open Items, evidence in `~/.claude/get-shit-done/workflows/execute-phase.md:1338-1376` and `~/.claude/get-shit-done/templates/summary.md:41`). Removed from Phase 25 active scope. Kept here as historical context for the v2.4 carry-in record.**

- [x] **PROC-01** (upstream: GSD 1.38.4): Wire `gsd-verifier` agent into `/gsd-execute-phase` workflow. Hard gate prevents phase completion without `<phase>-VERIFICATION.md` existing + non-empty + status `passed`. Regression test in `gsd-sdk` test suite asserts the gate fires.
- [x] **PROC-02** (upstream: GSD 1.38.5): Update SUMMARY.md template (used by gsd-planner agent) to emit `requirements-completed` frontmatter field. `gsd-sdk query summary-extract --pick requirements_completed` automates cross-reference. Validated against all M009 plan SUMMARY.md outputs.

### HARN-03 Fixture Refresh (Carry-In #2)

- [ ] **HARN-04**: Run `scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force` against fresh prod data. Resulting `tests/fixtures/primed/m009-21days/MANIFEST.json` materialized. HARN-03 4 sanity assertions flip from 2/4 fail to 4/4 pass (≥7 summaries → easily ≥21; ≥200 entries → easily met by 21-day window).
- [ ] **HARN-05**: Document VCR cost model — bumping `--target-days` without reseeding VCR cache → runaway Anthropic spend. Add explicit `--reseed-vcr` flag to `regenerate-primed.ts` that clears VCR cache before re-run; default behavior preserves cache + warns on missing entries. Add note to `.planning/codebase/TESTING.md`.
- [ ] **HARN-06**: HARN-03 5th sanity invariant — assert `wellbeing_snapshots` table populated with ≥14 days of synthetic data (will become "≥14 actual days" once M009 ships and cron fires). Codifies the new M009 substrate as a fixture invariant.

### Synthetic Fixture Test (M009 acceptance)

- [ ] **TEST-23**: 14-day synthetic fixture in `src/rituals/__tests__/synthetic-fixture.test.ts` using `vi.setSystemTime` mock-clock + `loadPrimedFixture('m009-21days')`. Tests run through full `processMessage` engine pipeline (NOT bypassing PP#5 — Pitfall 24).
- [ ] **TEST-24**: Assertion 1 — daily prompts fire on schedule with correct rotation (no consecutive duplicates floor; no-repeat-in-last-6 strong invariant). Property-test pattern.
- [ ] **TEST-25**: Assertion 2 — voice note responses store correctly as Pensieve entries with `epistemic_tag = RITUAL_RESPONSE` + `metadata.source_subtype = 'ritual_voice_note'`. **Cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` assertion** — proves PP#5 short-circuited engine response (Pitfall 6 regression test).
- [ ] **TEST-26**: Assertion 3 — skip tracking increments on missed days (`fired_no_response` outcome) but NOT on `system_suppressed` or `window_missed` outcomes.
- [ ] **TEST-27**: Assertion 4 — adjustment dialogue triggers after 3 consecutive daily skips OR 2 consecutive weekly skips. Cadence-aware threshold honored.
- [ ] **TEST-28**: Assertion 5 — wellbeing snapshots store correctly when Greg responds via simulated `callback_query` (via `simulateCallbackQuery` test helper — first use of inline keyboards in test fixtures).
- [ ] **TEST-29**: Assertion 6 — weekly review fires at week boundary with exactly **one observation** + **one Socratic question**. Both Stage-1 Zod refine AND Stage-2 Haiku judge invoked; templated fallback exercised in at least one fixture week.
- [ ] **TEST-30**: Assertion 7 — weekly review references specific episodic summaries AND decisions from the simulated week. Date-grounding post-check passes; no out-of-window references in the observation text.
- [ ] **TEST-31**: Live integration — anti-flattery resistance against real Sonnet for weekly review observation (3-of-3 atomic, gated on `ANTHROPIC_API_KEY`, mirrors M008 TEST-22 / D038). Adversarial week fixture designed to bait flattery ("Greg crushed it this week, demonstrating his characteristic discipline"); assert generated observation contains NONE of the 17 forbidden flattery markers from M006 conventions.
- [ ] **TEST-32**: Cron registration regression test in separate file `src/rituals/__tests__/cron-registration.test.ts` (HARD CO-LOCATION #4 — distinct from fixture test). Asserts `registerRitualCron()` called in `src/index.ts:main()` with the correct cron expression + timezone.

---

## Future Requirements (deferred to v2.5+)

- **DIFF-2 Wellbeing trajectory in weekly observation** — third source for weekly review observation alongside summaries + decisions. Defer to v2.5 once wellbeing variance signal is real-data-validated.
- **DIFF-3 Question-style taxonomy** — track which Socratic question styles drive engagement. Defer to v2.5 once enough weekly reviews have been generated.
- **DIFF-4 Cadence-scaled skip thresholds for monthly/quarterly** — M009 only ships daily + weekly. Monthly/quarterly defaults already in `RitualConfig` schema for M013 forward-compat, but threshold tuning happens in M013.
- **DIFF-5 Forecast-resolved-this-week observation style** — M007 ACCOUNTABILITY channel surfaces individual forecasts at resolution; consider weekly aggregation in v2.5.
- **18h `RESPONSE_WINDOW_HOURS` retuning** — defensible 12h/18h/24h/36h range; revisit after 30 days of real use with skip-tracking telemetry.
- **Single-composite wellbeing alternative** — if 3-tap commitment proves too high after 30 real days, ship as config option in v2.5.

---

## Out of Scope (explicit exclusions with reasoning)

| # | Excluded | Reasoning |
|---|---|---|
| OOS-1 | AI follow-up question after voice deposit | Kills the habit; D026 explicitly forbids; deposit-only is the load-bearing UX contract |
| OOS-2 | Gratitude as 7th prompt | Off-brand for anti-flattery constitution (D027); the 6 spec prompts cover salience/loops/belief-revision/surprise/decision/avoidance |
| OOS-3 | Server-side Whisper transcription (any provider) | PLAN.md `## Out of Scope and Deferred` gates this on a review/confirm-before-storage flow first; Greg uses Android STT keyboard |
| OOS-4 | Last-message-time fire-at heuristic | Brittle, non-deterministic; explicit `fire_at` config is simpler |
| OOS-5 | Real-time wellbeing interpretation back to Greg at deposit | Pollutes data; D026 separates wellbeing capture from Chris commentary |
| OOS-6 | Slider UX for wellbeing | PROMIS 1–5 already clinically validated; sliders add interaction cost without precision gain |
| OOS-7 | Streak-loss UX for skip tracking | Punitive; accelerates abandonment per habit-tracker retention literature; spec spirit "the ritual is wrong, not John" forbids |
| OOS-8 | Mention pending/open M007 forecasts in weekly review | Double-mentions with M007 accountability channel; pattern-only observations only |
| OOS-9 | Cron-expression-based ritual config exposed to Greg | Opaque to Greg; structured `fire_at` + `fire_dow` + cadence enum is the user-facing surface |
| OOS-10 | Free-text custom prompts via Haiku | Major test surface; conflicts with curated 6-prompt design; revisit if Greg requests |
| OOS-11 | `@grammyjs/menu` or `@grammyjs/conversations` plugins | Single-turn Haiku + stateless keyboard does not need them; existing surface sufficient |
| OOS-12 | `tiktoken` / `gpt-tokenizer` / `@anthropic-ai/tokenizer` | Token count poor proxy for "exactly one question"; two-stage Zod + Haiku judge replaces |
| OOS-13 | New direct dependencies — `rrule`, `cron-parser`, `bullmq`, `agenda`, `langchain`, `date-fns`, `dayjs`, HTTP clients | None needed; Luxon + node-cron + Anthropic SDK + Drizzle + Grammy cover everything |
| OOS-14 | Bumping `@anthropic-ai/sdk` / `grammy` / `zod` as part of M009 | Pre-1.0 SDK minor bumps may shift surface; v3/v4 dual-schema is intentional; bump only when M010+ needs surfaces not present |
| OOS-15 | "1 month real daily use before M010" pause | Superseded by D041 (no calendar-time data accumulation gates anywhere in v2.4+) |
| OOS-16 | Voice note delivered at literal "end of John's day" via last-message heuristic | Replaced by explicit 21:00 Europe/Paris default + per-ritual `fire_at` config |
| OOS-17 | M008 7-day recency-window UX gap as a v2.4 phase | RESOLVED 2026-04-25 by date-extraction Haiku JSON-fences fix (eedce33, deployed 42a7eed); 24h prod soak shows haiku-error count = 0 |

---

## Traceability

| REQ-ID | Phase | Notes |
|--------|-------|-------|
| RIT-01 | 25 | `rituals` table in migration 0006 |
| RIT-02 | 25 | `wellbeing_snapshots` table in migration 0006 |
| RIT-03 | 25 | 4 supporting event tables in migration 0006 (D004 append-only) |
| RIT-04 | 25 | `RITUAL_RESPONSE` 14th enum value via `ALTER TYPE epistemic_tag ADD VALUE` |
| RIT-05 | 25 | All 3 indexes shipped in migration 0006 (D034 precedent — no retrofitting) |
| RIT-06 | 25 | `regen-snapshots.sh` lineage clean + scripts/test.sh psql line (HARD CO-LOCATION #7) |
| RIT-07 | 25 | `RitualConfig` Zod schema (8 named fields + schema_version) at every read boundary |
| RIT-08 | 25 | `src/rituals/cadence.ts` Luxon-based `computeNextRunAt`; DST-safe |
| RIT-09 | 25 | Ritual channel slot in `runSweep` between accountability and reflective |
| RIT-10 | 25 | Atomic `UPDATE rituals ... RETURNING *` idempotency (mirrors M007 D-28) |
| RIT-11 | 25 | Second cron tick at 21:00 Europe/Paris in `src/index.ts` |
| RIT-12 | 25 | `ritualSweepCron` env var + `cron.validate` + `/health` reports `ritual_cron_registered` |
| ~~PROC-01~~ | — | RESOLVED UPSTREAM in GSD 1.38.4 (2026-04-26 verdict; not in Phase 25 active scope) |
| ~~PROC-02~~ | — | RESOLVED UPSTREAM in GSD 1.38.5 (2026-04-26 verdict; not in Phase 25 active scope) |
| VOICE-01 | 26 | PP#5 ritual-response detector at engine position 0 (HARD CO-LOCATION #1 + #5) |
| VOICE-02 | 26 | 6 rotating prompts in spec order; `PROMPT_SET_VERSION = 'v1'` |
| VOICE-03 | 26 | Shuffled-bag rotation via `rituals.config.prompt_bag` |
| VOICE-04 | 26 | 21:00 Europe/Paris default + pre-fire suppression on ≥5 telegram entries already today |
| VOICE-05 | 26 | `bot.on('message:voice')` polite-decline EN/FR/RU per `franc` |
| VOICE-06 | 26 | STT filler tagging: `metadata.source_subtype = 'ritual_voice_note'` |
| WELL-01 | 27 | 3-row × 5-button InlineKeyboard + skip button (first use of inline keyboards) |
| WELL-02 | 27 | `bot.on('callback_query:data')` + per-dim `INSERT ... ON CONFLICT ... DO UPDATE SET` |
| WELL-03 | 27 | Partial state in `ritual_responses.metadata` jsonb; hide-previous anchor-bias defeat |
| WELL-04 | 27 | Skip button (`adjustment_eligible: false`) — distinct from `fired_no_response` |
| WELL-05 | 27 | 09:00 Europe/Paris fire — separate from voice note (D026 + Pitfall 13) |
| SKIP-01 | 28 | Discriminated `RitualFireOutcome` union; only `fired_no_response` increments skip_count |
| SKIP-02 | 28 | Append-only `ritual_fire_events`; `skip_count` is rebuildable projection |
| SKIP-03 | 28 | Cadence-aware thresholds: daily=3, weekly=2; per-cadence default at row creation |
| SKIP-04 | 28 | Adjustment dialogue + Haiku 3-class parse (`change_requested`/`no_change`/`evasive`) |
| SKIP-05 | 28 | 60s confirmation window for `change_requested`; auto-apply on yes / no-reply |
| SKIP-06 | 28 | Self-protective 30-day pause after 2 evasive responses in 14 days |
| SKIP-07 | 28 | `ritual_config_events` audit trail + M006 refusal honored inside dialogue |
| WEEK-01 | 29 | Sunday 20:00 Europe/Paris; reads `getEpisodicSummariesRange` (M008 first consumer) + `decisions` |
| WEEK-02 | 29 | `assembleWeeklyReviewPrompt()` explicit CONSTITUTIONAL_PREAMBLE injection (HARD CO-LOCATION #3) |
| WEEK-03 | 29 | Sonnet structured output `{observation, question}` via `messages.parse` + `zodOutputFormat` |
| WEEK-04 | 29 | D031 boundary marker on user-facing header — "Observation (interpretation, not fact):" |
| WEEK-05 | 29 | Two-stage single-question enforcement: Zod refine + Haiku judge (HARD CO-LOCATION #2) |
| WEEK-06 | 29 | Retry cap = 2; templated single-question fallback on cap; `chris.weekly-review.fallback-fired` log |
| WEEK-07 | 29 | Pattern-only observations; DIFF-5 forecast-resolved style deferred to v2.5 |
| WEEK-08 | 29 | Pensieve persist as `RITUAL_RESPONSE` with `metadata.kind = 'weekly_review'` |
| WEEK-09 | 29 | Wellbeing variance gate: stddev < 0.4 → don't cite wellbeing in observation |
| TEST-23 | 30 | 14-day fixture in `src/rituals/__tests__/synthetic-fixture.test.ts` via `vi.setSystemTime` + `loadPrimedFixture('m009-21days')`; full `processMessage` pipeline |
| TEST-24 | 30 | Assertion 1 — daily prompt rotation (no consecutive dupes; no-repeat-in-last-6 property test) |
| TEST-25 | 30 | Assertion 2 — voice note Pensieve persistence + cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` (Pitfall 6 regression test) |
| TEST-26 | 30 | Assertion 3 — skip increments only on `fired_no_response`; not on `system_suppressed` / `window_missed` |
| TEST-27 | 30 | Assertion 4 — adjustment dialogue at cadence-aware threshold (daily=3, weekly=2) |
| TEST-28 | 30 | Assertion 5 — wellbeing via `simulateCallbackQuery` test helper (first use of inline keyboards in tests) |
| TEST-29 | 30 | Assertion 6 — weekly review exactly 1 obs + 1 Q; Stage-1 + Stage-2 invoked; templated fallback exercised |
| TEST-30 | 30 | Assertion 7 — weekly review references specific summaries + decisions; date-grounding post-check |
| TEST-31 | 30 | Live anti-flattery 3-of-3 atomic against real Sonnet (HARD CO-LOCATION #6 — own plan) |
| TEST-32 | 30 | Cron registration regression in separate file (HARD CO-LOCATION #4 — distinct from TEST-23) |
| HARN-04 | 30 | Carry-in #2 — `regenerate-primed.ts --milestone m009 --target-days 21 --force` against fresh prod |
| HARN-05 | 30 | Carry-in #2 — VCR cost model docs + `--reseed-vcr` flag |
| HARN-06 | 30 | Carry-in #2 — HARN-03 5th invariant (≥14 days `wellbeing_snapshots`) |

**Coverage:** 52 / 52 active v1 requirements mapped to exactly one phase. No orphans, no duplicates. *(Originally 54; PROC-01 + PROC-02 resolved upstream in GSD 1.38.4/1.38.5 on 2026-04-26 and removed from active scope — see Process Gate section above.)*

---
*Document created: 2026-04-26 by /gsd-new-milestone "M009 Ritual Infrastructure + Daily Note + Weekly Review"*
*Traceability filled: 2026-04-26 by gsd-roadmapper (6 phases, 54 REQ-IDs, all 7 hard co-location constraints honored)*
*Scope reduced: 2026-04-26 — PROC-01/02 verified REDUNDANT post-GSD 1.38.4/1.38.5; 54 → 52 active requirements.*
