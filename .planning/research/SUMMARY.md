# Project Research Summary — v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review

**Project:** Chris (personal AI Pensieve, single user, Telegram bot)
**Milestone:** v2.4 M009 — Ritual Infrastructure + Daily Voice Note + Daily Wellbeing + Weekly Review *(MVP shipping point)*
**Domain:** Cadence-driven proactive ritual layer on top of an existing append-only Pensieve + dual-channel proactive sweep + episodic consolidation
**Researched:** 2026-04-26
**Confidence:** HIGH for stack/architecture/pitfalls (every recommendation anchored to existing v2.0–v2.3 code or to a documented failure pattern); HIGH/MEDIUM for features (industry retention/abandonment data is robust; specific time-of-day defaults are practitioner-consensus, not controlled-trial)

---

## Executive Summary

M009 is the **MVP shipping point** of the Chris soul-system roadmap. After it lands, Greg has the full reflection loop: M006 trust + M007 decision archive + M008 episodic consolidation + M009 daily voice note + daily wellbeing + weekly review. Everything from M010 onward (operational profiles, psychological profiles, mental-model inventory, monthly/quarterly rituals, narrative identity) feeds on the real cadence-driven data this milestone produces. The substrate is already built: `getEpisodicSummariesRange` (M008) is exported with zero current callers — M009 is its first consumer; the M007 `decisions` projection is queryable; the v2.3 primed-fixture pipeline removes the "1 month real calendar wait" gate that the M009 spec naively assumes (D041 supersedes it).

The recommended approach is **infrastructure-first, then handlers-in-parallel, then integration**. Migration 0006 (`rituals` + `wellbeing_snapshots` + supporting event/pending-response tables), the Luxon-based cadence helper, and the safe-default cron registration land first as substrate. The three rituals (voice note, wellbeing, weekly review) can then ship in parallel because they share the substrate but have orthogonal handler surfaces. Skip-tracking + adjustment dialogue is the synthesis layer that depends on all three. **Zero new dependencies; zero version bumps.** Every M009 capability composes from existing packages at installed versions (Drizzle 0.45.2, Grammy 1.31, Luxon 3.7.2, Anthropic SDK 0.90, Zod 3.24).

The critical risks are **trust-breaking regressions** rather than build complexity. The single most likely M009 regression is *Chris responding to a daily voice-note response* (Pitfall 6, CRITICAL) — the M009 spec's "deposit-only" contract dies on day 1 if the engine pre-processor for ritual responses isn't co-located with the voice-note handler. The second most likely regression is *sycophantic weekly observations* (Pitfall 17, HIGH) — the M006 constitutional preamble doesn't auto-inject in cron contexts; Phase 23's TEST-22 (M008 D038) pattern must be inherited explicitly. The third is *cadence drift / DST drift* (Pitfalls 2 + 3, both CRITICAL) — same trap M008 hit in Phase 21/22; the canonical fix is the Luxon `dayBoundaryUtc` pattern. All three risks are preventable by hard co-location constraints, which the roadmap MUST honor.

---

## Key Findings

### Recommended Stack

**Headline: no new dependencies, no version bumps.** Every M009 capability composes from packages already installed at versions ≥ what's needed (full inventory in `STACK.md` §Version-bump assessment).

**Core technologies (already installed, all used as-is):**

- **Drizzle ORM 0.45.2 + drizzle-kit 0.31.10** — schema additions (`rituals`, `wellbeing_snapshots`, supporting tables) via migration `0006_rituals_wellbeing.sql`. Uses existing `pgEnum`, `jsonb`, `smallint`, `.check()`, `timestamp({ withTimezone: true })` patterns from `src/db/schema.ts`.
- **Grammy 1.31** — `InlineKeyboard` class + `bot.callbackQuery(/regex/, handler)` for the wellbeing 3-row × 5-button keyboard. **First use of inline keyboards in this codebase** — pattern is well-established in Grammy ecosystem but adds a new bot-router surface. **Anti-recommendations: do NOT add `@grammyjs/menu` or `@grammyjs/conversations`** (single-turn structured Haiku parse + stateless keyboard does not need them).
- **Luxon 3.7.2** — cadence advancement (`DateTime.plus({ days/weeks/months })` + `setZone(tz)`) for all 4 enum cadences (daily/weekly/monthly/quarterly) with DST safety. Same canonical `dayBoundaryUtc` pattern as M008 `src/episodic/sources.ts`.
- **node-cron 4.2.1** — existing two-cron pattern (proactive sweep at 10:00 + episodic at 23:00) extended with a second proactive tick at 21:00 Europe/Paris for ritual firing (see Disagreement #1 resolution below).
- **Anthropic SDK 0.90.0** — `messages.parse()` + `helpers/zod`'s `zodOutputFormat` for (a) weekly-review observation generation with single-question Zod refinement, (b) skip-adjustment Haiku parsing into a strict `RitualConfig` Zod patch, (c) optional Haiku judge for the second stage of single-question enforcement.
- **Zod (`zod` v3 + `zod/v4` sub-path import at SDK boundary)** — same v3/v4 dual-schema pattern from `src/episodic/consolidate.ts:33-81`. Strict `RitualConfigSchema` (8 fields + `schema_version`) at every read boundary.
- **bge-m3 + pgvector + PostgreSQL 16 + Telegram Bot API + ESM TS Node 22** — unchanged from M001–M008 baseline.

### Expected Features

#### TABLE STAKES — must include

**Daily Voice Note ritual:**
- TS-1 Deposit-only contract — Chris does NOT generate a chat response to the voice note. PP#5 ritual-response detector at top of `processMessage` returns empty string; bot's existing IN-02 silent-skip is the escape hatch.
- TS-2 Six rotating prompts in spec order; shuffled-bag rotation (no consecutive duplicates floor + naturally produces no-repeat-in-last-6 — see Disagreement #5).
- TS-3 Default fire time 21:00 Europe/Paris, configurable via `rituals.config.fire_at`.
- TS-3a Voice input via Android keyboard STT — Telegram message arrives as `message:text`. Polite-decline `bot.on('message:voice')` handler (~10 LOC, EN/FR/RU per `franc`). No Whisper.
- TS-3b Pre-fire suppression: if ≥5 telegram JOURNAL-mode entries already today, skip fire and advance `next_run_at` to tomorrow without incrementing skip_count.
- TS-3c STT filler tagging: `pensieve_entries.metadata.source_subtype = 'ritual_voice_note'` set at ingest.

**Daily Wellbeing Snapshot:**
- TS-4 1–5 Likert scale × 3 dimensions (energy / mood / anxiety). Keep 3 dimensions per spec (Disagreement #3).
- TS-5 Single Telegram message with 3-row × 5-button `InlineKeyboard` + `callback_query` handler. Partial-state in `ritual_responses.metadata` jsonb. Optimistic-concurrency upsert per dimension prevents rapid-tap race.
- TS-5a Skip button — optional skip allowed without triggering adjustment dialogue (`adjustment_eligible: false`).
- TS-5b Hide previous values to defeat anchor bias.
- TS-5c Variance check at week-end: if any dimension's stddev < 0.4 over 7 days, weekly review observation does NOT cite wellbeing.

**Weekly Review:**
- TS-6 Sunday 20:00 Europe/Paris default (one hour earlier than voice note); configurable.
- TS-7 Exactly one observation + one Socratic question generated by Sonnet from `getEpisodicSummariesRange(weekStart, weekEnd)` + `decisions WHERE resolved_at BETWEEN weekStart AND weekEnd`.
- TS-7a Strict 7-day window in retrieval; date-grounding post-check; system prompt explicitly states the date window.
- TS-7b D031 boundary marker on user-facing message header ("Observation (interpretation, not fact):") — mirrors INTERROGATE pattern.
- TS-7c Two-stage single-question enforcement: regex `?` count + interrogative-leading-word heuristic per language (Stage 1) + Haiku judge (Stage 2). Retry cap = 2; templated fallback after cap.
- TS-7d **CONSTITUTIONAL_PREAMBLE explicit injection** in `assembleWeeklyReviewPrompt()` (CONS-04 / D038 pattern). Mandatory live integration test against real Sonnet, 3-of-3 atomic, scans for 17 forbidden flattery markers.
- TS-7e Pattern-only observations (no individual decision re-surfacing — M007 ACCOUNTABILITY handles individual surfacing).
- TS-7f Weekly review observation persists to Pensieve as `epistemic_tag = 'RITUAL_RESPONSE'` with `metadata.kind = 'weekly_review'`.

**Skip-Tracking & Adjustment Dialogue:**
- TS-8 Cadence-aware skip thresholds: daily=3, weekly=2 (Disagreement #7).
- TS-8a Discriminated `RitualFireOutcome` union (`responded` / `window_missed` / `fired_no_response` / `system_suppressed`); only `fired_no_response` increments skip_count.
- TS-8b Append-only `ritual_fire_events` table — `rituals.skip_count` is denormalized projection.
- TS-8c Adjustment dialogue: single message; strict Zod parse on Haiku output; 3-class response classification (`change_requested` / `no_change` / `evasive`).
- TS-8d Confirmation flow (60s window before commit) for `change_requested` route.
- TS-8e Self-protective 30-day pause after 2 evasive responses within 14 days.
- TS-8f Append-only `ritual_config_events` audit trail.
- TS-8g M006 refusal handling honored inside dialogue.

**Ritual Infrastructure:**
- TS-9 New tables in migration 0006: `rituals` + `wellbeing_snapshots` + `ritual_responses` + `ritual_fire_events` + `ritual_config_events` + `ritual_pending_responses`.
- TS-9a `RITUAL_RESPONSE` added to `epistemicTagEnum` (14th value).
- TS-9b Indexes shipped in 0006 (D034 precedent): partial `btree(next_run_at) WHERE enabled = true`; `btree(snapshot_date)`; `(ritual_id, fired_at DESC)` on `ritual_responses`.
- TS-9c Migration meta-snapshot lineage cleaned via `scripts/regen-snapshots.sh`; new psql line in `scripts/test.sh`.
- TS-10 Cadence enum supports all 4 cadences from day one (forward-compat for M013).
- TS-11 Ritual firing as a third **channel** (not a 6th trigger) inside `runSweep` between accountability and reflective. Per-tick max-1-ritual cap + catch-up ceiling + window-bound firing.
- TS-12 Atomic `UPDATE ... RETURNING` idempotency (write-before-send, mirrors M007 D-28).
- TS-13 Wall-clock cadence: `next_run_at = computeNextRunAt(now(), config)` via Luxon, NEVER `last_run_at + 24h`. DST-safe across 2026-03-29 + 2026-10-25.
- TS-14 PP#5 ritual-response detector at position 0 of `processMessage` (BEFORE PP#0).
- TS-15 Bounded Zod-validated `RitualConfig` schema (8 fields + `schema_version`); rejects unknown fields.
- TS-16 Safe cron defaults in `src/config.ts` + `cron.validate` at config load; `/health` reports `ritual_cron_registered`.

**Carry-Ins:**
- TS-17 Wire `gsd-verifier` into `/gsd-execute-phase`.
- TS-18 SUMMARY.md frontmatter template emits `requirements-completed` field.
- TS-19 HARN-03 fixture refresh: `scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force` against fresh prod data; document VCR cost model.

#### DIFFERENTIATORS

- DIFF-1 Cooldown rule (subsumed by shuffled-bag rotation — ship in M009 as part of TS-2).
- DIFF-2 Wellbeing trajectory as 3rd weekly-observation source — defer to v2.5.
- DIFF-3 Question-style taxonomy — defer to v2.5.
- DIFF-4 Cadence-scaled skip thresholds for monthly/quarterly — M009 only ships daily + weekly thresholds.
- DIFF-5 Forecast-resolved-this-week observation style — defer to v2.5.
- DIFF-6 Generic `nextRunAt` scheduler primitive — ship in M009 (unblocks M013 to be content-only).

#### ANTI-FEATURES / Out-of-Scope (deduped)

| # | Anti-feature | Why excluded |
|---|---|---|
| OOS-1 | AI follow-up question after voice deposit | Kills the habit; D026 explicitly forbids |
| OOS-2 | Gratitude as 7th prompt | Off-brand for anti-flattery constitution |
| OOS-3 | Server-side Whisper transcription (any provider) | PLAN.md `## Out of Scope and Deferred` gates this on review/confirm-before-storage flow first |
| OOS-4 | Last-message-time fire-at heuristic | Brittle, non-deterministic |
| OOS-5 | Real-time wellbeing interpretation back to Greg at deposit | Pollutes data; D026 separation |
| OOS-6 | Slider UX for wellbeing | PROMIS 1–5 already clinically validated |
| OOS-7 | Streak-loss UX for skip tracking | Punitive; accelerates abandonment |
| OOS-8 | Mention pending/open M007 forecasts in weekly review | Double-mentions with M007 accountability channel |
| OOS-9 | Cron-expression-based ritual config | Opaque to Greg; overkill |
| OOS-10 | Free-text custom prompts via Haiku | Major test surface; conflicts with curated design |
| OOS-11 | `@grammyjs/menu` or `@grammyjs/conversations` plugins | Single-turn Haiku + stateless keyboard does not need them |
| OOS-12 | `tiktoken` / `gpt-tokenizer` / `@anthropic-ai/tokenizer` | Token count poor proxy for "exactly one question" |
| OOS-13 | `rrule` / `cron-parser` / `bullmq` / `agenda` / `langchain` / `date-fns` / `dayjs` / HTTP clients | None needed |
| OOS-14 | Bumping `@anthropic-ai/sdk` / `grammy` / `zod` as part of M009 | Pre-1.0 SDK minor bumps may shift surface; v3/v4 dual-schema is intentional |

### Architecture Approach

M009 concentrates work in two new modules (`src/rituals/` subsystem + `src/bot/handlers/ritual-callback.ts`) plus focused edits to four existing modules (`src/db/schema.ts`, `src/proactive/sweep.ts`, `src/chris/engine.ts`, `src/index.ts`). Integration surface is small.

**Major components:**
1. `src/rituals/` subsystem — `cadence.ts`, `scheduler.ts`, `voice-note.ts`, `wellbeing.ts`, `weekly-review.ts`, `skip-tracking.ts`, `types.ts`, `__tests__/` (mirrors `src/episodic/` shape).
2. `src/proactive/sweep.ts` edit — add ritual channel between accountability and reflective; share global mute (`isMuted()`); independent daily counter.
3. `src/chris/engine.ts` edit — PP#5 ritual-response detector at position 0 (BEFORE PP#0); state-table lookup against `ritual_pending_responses`; route to deposit-only handler if hit.
4. `src/bot/bot.ts` edit — register `bot.on('callback_query:data', handleRitualCallback)` for wellbeing keyboard; register `bot.on('message:voice', handlePoliteDecline)`.
5. `src/db/schema.ts` + `src/db/migrations/0006_rituals_wellbeing.sql` — new tables + enum extension; all indexes shipped in 0006 (D034 precedent).
6. `src/index.ts` edit — second cron registration for evening ritual sweep at 21:00 Europe/Paris.
7. `src/config.ts` edit — `ritualSweepCron` and `weeklyReviewCron` env vars with safe defaults + `cron.validate` at config load.

### Critical Pitfalls (top 5 from PITFALLS.md taxonomy of 29)

1. **Engine responds to ritual voice note (Pitfall 6, CRITICAL)** — THE single most likely M009 regression. **Mitigation:** PP#5 co-located with voice note handler (HARD CO-LOCATION #1); cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` regression test.
2. **Ritual storms after cron catch-up (Pitfall 1, CRITICAL)** — server offline → all rituals fire on restart. **Mitigation:** per-tick max-1-ritual cap; catch-up ceiling.
3. **DST drift + cadence drift (Pitfalls 2 + 3, CRITICAL)** — same trap M008 hit. **Mitigation:** Luxon helper; `next_run_at = computeNextRunAt(now, config)`, never `last_run_at + 24h`.
4. **Sycophantic weekly observations (Pitfall 17, HIGH)** — M006 sycophancy failure mode in cron context. **Mitigation:** explicit `CONSTITUTIONAL_PREAMBLE` injection; mandatory live integration test (HARD CO-LOCATION #3).
5. **Single-question `?`-count check brittle (Pitfall 14, HIGH)** — French/Russian period-questions slip through; compound questions slip through. **Mitigation:** two-stage check (regex+heuristic + Haiku judge); retry cap = 2 + templated fallback.

### HARD CO-LOCATION CONSTRAINTS (verbatim from PITFALLS.md)

1. **Pitfall 6 (PP#5 ritual-response detector) MUST land in the same plan as the voice note ritual handler.** Splitting them = guaranteed Chris-responds-to-rituals regression for the gap window.
2. **Pitfall 14 (single-question enforcement) MUST land in the same plan as the weekly review observation generator.** Splitting them = Sonnet ships unconstrained, Greg sees compound questions on the very first weekly review.
3. **Pitfall 17 (CONSTITUTIONAL_PREAMBLE injection) MUST land in the same plan as the weekly review observation generator.** Same reasoning as #2.
4. **Pitfall 23 (fixture vs cron-registration tests) MUST be two distinct plans, not bundled.** Bundling lets one test type pass and hide the other type's gap.
5. **Pitfall 24 (mock-chain coverage for PP#5) MUST land in the same plan as PP#5 introduction.** Splitting them = v2.0/v2.1 Phase 14 mock-chain regression repeats.
6. **Pitfall 26 (live weekly-review test) MUST be its own plan.** Bundling it with weekly review implementation either delays the implementation OR ships without the test (M008 nearly hit this).
7. **Pitfall 28 (migration + meta snapshot + scripts/test.sh) MUST be one atomic plan.** Splitting any of the three creates lineage breakage.

---

## Resolved Disagreements

### Disagreement #1 — Ritual firing mechanism

**RECOMMENDATION:** Adopt ARCHITECTURE.md framing — ritual firing is a **CHANNEL inside `runSweep`**, with a second cron tick at 21:00 Europe/Paris.

**Why:** "6th trigger" framing is wrong because triggers compete via priority sort; rituals do NOT compete (they are user-promised cadence). Hourly cron (STACK option) is heavier than needed. "Dedicated 30-min cron" (PITFALLS option) is over-engineered for M009. Two ticks (10:00 + 21:00) reuse proven plumbing with idempotent SQL gate.

**Tradeoff accepted:** Non-default `fire_at` settings (e.g., 14:30) would be up to 6h late. M009's three rituals all align with 10:00 or 21:00 ticks. Future rituals needing different timing → add third tick or move to dedicated 30-min model then.

### Disagreement #2 — Phase count and structure

**RECOMMENDATION:** **6 phases (Phase 25–30)**, with carry-ins folded into Phases 25 (process gate) and 30 (HARN-03 fixture refresh).

**Why:** Recent project history sets cadence (v2.2 = 5 phases / 17 plans; v2.3 = 1 phase / 4 plans). M009 is broad but well-bounded — 6 phases × ~3–5 plans is the sweet spot. The 7 hard co-location constraints map cleanly to phase boundaries. 8 phases over-splits; 7 phases hides carry-ins as separate phases.

**Phase numbering:** Continues from v2.3 last (Phase 24). First v2.4 phase = Phase 25.

### Disagreement #3 — Wellbeing dimensions: 3 vs 1

**RECOMMENDATION:** **Keep 3 dimensions per spec**, but ship the keyboard as a SINGLE message with 3 rows (3 taps total, not 3 separate messages).

**Why:** Spec is authoritative; PROMIS clinical validation is 1–5 × multi-dimension; single composite collapses dimensionality and breaks downstream profile inference. Tap fatigue (Pitfall 10) is solved by UX (single message, inline edit on each tap), not by collapsing dimensions.

**Tradeoff accepted:** If 3-tap commitment proves too high after 30 days of real use, v2.5 can ship single-composite mode as config option.

### Disagreement #4 — Wellbeing fire time: alongside vs separate

**RECOMMENDATION:** **DEPART FROM SPEC LITERALISM — ship two separate fire times (09:00 wellbeing, 21:00 voice note). FLAG FOR GREG'S APPROVAL.**

**Why:** D026 rationale ("combining them would either bloat the voice note ritual with structured questions or pollute the numeric series with interpretation") + Pitfall 13 mechanism (wellbeing-after-voice-note becomes mood-of-the-moment-after-narrative-reflection rather than felt-state). "Alongside" in spec is genuinely ambiguous; the spirit of D026 is morning/evening separation.

**Tradeoff accepted:** Two fire times means two cron-tick interactions (handled by morning 10:00 sweep + evening 21:00 sweep from Disagreement #1).

### Disagreement #5 — Daily voice note prompt rotation rule

**RECOMMENDATION:** Ship **shuffled-bag rotation** with `rituals.config.prompt_bag: number[]` storing unused indices in current cycle.

**Why:** Shuffled-bag implements spec floor ("no consecutive duplicates") AND naturally produces "no repeat in last 6 fires" (stronger than FEATURES.md's "last 3"). Index-based with `prompt_set_version: 'v1'` defends against future prompt rewording. Property-test verifiable (600 fires = 100 each, no consecutive dupes, max gap ≤ 11).

**Tradeoff accepted:** ~10 LOC instead of 2 (fixed-order rotation), but it's the only robust option.

### Disagreement #6 — Single-question enforcement

**RECOMMENDATION:** Ship **two-stage approach** (PITFALLS.md). Stage 1: Zod refinement (regex `?` count + interrogative-leading-word heuristic per EN/FR/RU). Stage 2: Haiku judge with structured-output `{ question_count, questions[] }`.

**Why:** `?` count alone is brittle — French/Russian period-terminated questions slip through; compound "and" questions slip through; embedded quoted questions miscount. STACK.md's Zod `.refine()` is right *first* stage but insufficient alone. Haiku judge is *second* stage (only if Stage 1 passes) — handles compound questions semantically.

**Tradeoff accepted:** Haiku judge adds ~$0.001/weekly review; ~50 LOC vs spec's "token-count check" implication of ~3 LOC. Regression cost (compound question on first weekly review) is much higher than implementation cost. Retry cap = 2 + templated fallback.

### Disagreement #7 — Skip-tracking threshold

**RECOMMENDATION:** **Cadence-aware thresholds: daily=3, weekly=2**. Monthly=2 / quarterly=1 defaults forward-compatible for M013.

**Why:** "3 consecutive" is right for daily but wrong for weekly: 3 weekly skips = 21 days. Per-cadence default in row creation; configurable per-ritual via `rituals.config.skip_threshold`. Spec spirit ("if a ritual is consistently skipped, the ritual is wrong, not John") preserved; constant scaled.

### Disagreement #8 — Voice message handling

**RECOMMENDATION:** **Confirm STACK.md interpretation** — "responds by voice (via Telegram)" describes Greg's *input modality* (Android STT keyboard), NOT Telegram `message:voice` type. M009 ships zero Whisper transcription. Add ~10 LOC `bot.on('message:voice')` polite-decline handler (EN/FR/RU per `franc`) to prevent silent drops. Flag in REQUIREMENTS.md as a clarification.

**Why:** Strict win — preserves PLAN.md `## Out of Scope and Deferred` boundary; avoids silent drops which would feel like Chris ignoring Greg.

---

## Spec Interpretations Worth Flagging for Requirements Review

1. **Spec departure (REQUIRES Greg's approval): wellbeing fire-time** — recommend two separate fire times per D026 spirit + Pitfall 13. See Disagreement #4.
2. **Spec supersession (already locked): "1 month real daily use before M010" pause** — superseded by D041; M010 validates via primed fixture.
3. **Spec interpretation (clarification): "responds by voice (via Telegram)"** — Greg's input modality, not Telegram `message:voice` type.
4. **Spec interpretation (clarification): "alongside" wellbeing/voice-note delivery** — D026 already locked separation of *purpose*; we extend to separation of *fire time*.
5. **Spec extension: skip threshold scales by cadence** — daily=3, weekly=2; spec spirit preserved.
6. **Spec implementation choice: "token-count check" → two-stage Zod refinement + Haiku judge** — more robust than literal `?` count.

---

## Open Questions Requiring Greg's Call

**OPEN-1: Wellbeing fire-time confirmation (09:00 vs alongside).** Synthesis recommends 09:00 morning per D026 + Pitfall 13. Greg confirms or overrides during requirements review. If 09:00 is rejected, Pitfall 13's narrative-conflation risk is accepted and documented.

All other items in the original 8-disagreement list have a clear synthesis answer.

---

## Implications for Roadmap

### Phase 25 — Ritual Scheduling Foundation
**Rationale:** Substrate for everything else. Migration 0006 must land first; cadence helper before any handler; cron registration with safe defaults before any cron-fired test. Carry-in #1 (gsd-verifier + SUMMARY.md frontmatter) is tiny and unblocks every subsequent phase's audit trail.
**Delivers:** Migration 0006 + `RITUAL_RESPONSE` enum + `src/rituals/cadence.ts` + `runRitualSweep` skeleton + cron registration in `src/index.ts` + `src/proactive/sweep.ts` ritual-channel slot + Phase 25's process gate.
**Addresses:** TS-9, TS-9a, TS-9b, TS-9c, TS-10, TS-11, TS-12, TS-13, TS-15, TS-16, TS-17, TS-18.
**Avoids:** Pitfalls 1, 2, 3, 4, 27, 28.
**Estimated size:** 4 plans, ~500 LOC.

### Phase 26 — Daily Voice Note Ritual
**Rationale:** First real ritual; exercises highest-risk integration point (PP#5). HARD CO-LOCATION #1 + #5.
**Delivers:** PP#5 + `handleRitualResponse` deposit-only + 6-prompt shuffled-bag rotation + STT filler tagging + pre-fire suppression + cumulative regression test + mock-chain coverage update.
**Addresses:** TS-1, TS-2, TS-3, TS-3a, TS-3b, TS-3c, TS-14, DIFF-1.
**Avoids:** Pitfalls 6, 7, 8, 9, 24.
**Estimated size:** 4 plans, ~450 LOC.

### Phase 27 — Daily Wellbeing Snapshot
**Rationale:** Independent of Phase 26 (orthogonal `callback_query` surface); first use of inline keyboards in this codebase.
**Delivers:** `InlineKeyboard` + callback_query handler + partial-state persistence + UNIQUE(snapshot_date) idempotency + hide-previous-values + variance-check helper + `simulateCallbackQuery` test fixture + 09:00 Paris fire (separate from voice note).
**Addresses:** TS-4, TS-5, TS-5a, TS-5b, TS-5c, OPEN-1 resolution.
**Avoids:** Pitfalls 10, 11, 13, 25.
**Estimated size:** 3 plans, ~400 LOC.

### Phase 28 — Skip-Tracking + Adjustment Dialogue
**Rationale:** Synthesis layer depending on Phases 25/26/27.
**Delivers:** `ritual_fire_events` log + discriminated outcome union + per-cadence skip thresholds + adjustment dialogue + 3-class classification + 60s confirmation + 30-day pause + `ritual_config_events` audit + window-missed vs user-skipped distinction.
**Addresses:** TS-8 through TS-8g.
**Avoids:** Pitfalls 4, 5, 19, 20, 21, 22.
**Estimated size:** 4 plans, ~500 LOC.

### Phase 29 — Weekly Review
**Rationale:** Independent of Phases 26/27/28 (depends only on M008 + M007). HARD CO-LOCATION #2 + #3 + #6.
**Delivers:** `assembleWeeklyReviewPrompt()` with `CONSTITUTIONAL_PREAMBLE` + Sonnet observation generator + two-stage single-question enforcement + retry cap + templated fallback + 60s timeout + strict 7-day window + date-grounding post-check + pattern-only observations + cross-reference wellbeing + Sunday 20:00 cron + Pensieve persistence as `RITUAL_RESPONSE`. **Separate plan: live integration test** (3-of-3 atomic, forbidden-marker scan, date-window scan).
**Addresses:** TS-6, TS-7, TS-7a, TS-7b, TS-7c, TS-7d, TS-7e, TS-7f.
**Avoids:** Pitfalls 14, 15, 16, 17, 18, 26.
**Estimated size:** 4 plans, ~600 LOC.

### Phase 30 — Test Infrastructure + Carry-Ins
**Rationale:** Integration phase requiring all prior phases. HARD CO-LOCATION #4. Carry-in #2 (HARN-03) fits naturally.
**Delivers:** `m009-21days` fixture variant + 7-assertion fixture test through full `processMessage` + separate `cron.test.ts` for cron wiring + HARN-03 fixture refresh + cost-model documentation + HARN-03 5th invariant.
**Addresses:** TS-19; spec's 7 acceptance assertions.
**Avoids:** Pitfalls 23, 24, 25, 29.
**Estimated size:** 3 plans, ~600 LOC.

### Phase Ordering Rationale

- Substrate before handlers (Phase 25 first, non-negotiable).
- Voice note + wellbeing + weekly review parallel-eligible after Phase 25.
- Skip-tracking after the 3 daily rituals (depends on outcomes).
- Test infrastructure last (cannot run until 25–29 produce code).
- Carry-in #1 lives inside Phase 25 as first plan (NOT a separate phase) — tiny, unblocks everything.

### Research Flags

**Phases likely needing deeper research during planning:**
- **Phase 27:** Grammy `callback_query` lifecycle + multi-tap concurrency — first use of inline keyboards in codebase.
- **Phase 29:** Live integration test design — adversarial-week fixture content seeding (M006 TEST-22 / D038 reference); forbidden-marker list curation.

**Phases with standard patterns (skip research-phase):**
- **Phase 25:** Migration + Drizzle schema + Luxon DST + cron — direct M001–M008 precedent.
- **Phase 26:** PP#5 design novel but PP#0/PP#1 + `decision_capture_state` is direct precedent.
- **Phase 28:** M007 D-06/D-14/D-22 are direct precedents.
- **Phase 30:** v2.3 primed-fixture pipeline + M008 14-day fixture both shipped.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | No new deps, no version bumps; verified against `node_modules/` and npm registry |
| Features | HIGH on retention/abandonment, MEDIUM on ritual scheduling specifics, LOW on time-of-day defaults | |
| Architecture | HIGH | Direct codebase inspection of every named module |
| Pitfalls | HIGH | Every pitfall anchored to observed M001–M008/v2.3 failure pattern, existing invariant, or spec text |

**Overall confidence:** HIGH

### Gaps to Address

- **Wellbeing fire-time confirmation (OPEN-1):** Greg's call needed during requirements review.
- **18-hour `RESPONSE_WINDOW_HOURS` default:** tunable constant in `src/rituals/voice-note.ts`; defensible 12h/18h/24h/36h range.
- **Concurrent voice-note + wellbeing race:** sidestepped by callback_query architecture (only voice note sets `awaitingResponse`); decimal phase per D040 if Phase 30 surfaces interaction.
- **Adversarial week fixture design for Phase 29 live test:** content seeding strategy needed during Phase 29 research-phase pass.

---

## Sources

### Primary (HIGH confidence)
- `/home/claude/chris/PLAN.md` (D026, D029, D030, D034, D035, D036, D038, D039, D041)
- `/home/claude/chris/M009_Ritual_Infrastructure.md` (spec)
- `/home/claude/chris/M013_Monthly_Quarterly_Rituals.md`, `M010_*`, `M011_*`
- `/home/claude/chris/PRD_Project_Chris.md`
- `/home/claude/chris/.planning/codebase/{STACK,CONVENTIONS,TESTING,ARCHITECTURE}.md`
- `/home/claude/chris/src/proactive/{sweep,state}.ts`, `triggers/*.ts`
- `/home/claude/chris/src/chris/engine.ts`
- `/home/claude/chris/src/episodic/{cron,consolidate,sources}.ts`
- `/home/claude/chris/src/decisions/{capture,capture-state,resolve-by}.ts`
- `/home/claude/chris/src/db/schema.ts` + `migrations/0005_episodic_summaries.sql`
- `/home/claude/chris/src/index.ts`
- `/home/claude/chris/src/pensieve/retrieve.ts:390` (`getEpisodicSummariesRange`)
- `/home/claude/chris/src/__tests__/fixtures/{vcr,load-primed}.ts`
- `/home/claude/chris/.planning/research/{STACK,FEATURES,ARCHITECTURE,PITFALLS}.md`
- `/home/claude/chris/.planning/MILESTONES.md` + `RETROSPECTIVE.md`

### Secondary (MEDIUM confidence)
- Journaling app retention/abandonment data (mylifenote.ai, Lume, Practical PKM, thatjournalingguy)
- Comparable systems (Stoic, Five Minute Journal, Reflect.app, Day One)
- EMA/scale granularity (Frontiers, Springer 2025, PROMIS, Daylio, How We Feel/Yale)
- Habit/streak literature (James Clear, Habi.app, Habitica)
- Weekly review timing (Todoist, Steven Michels, Lazy Slowdown)
- Socratic questioning (Mind The Nerd, Reason Refine)
- Cron/scheduler patterns (Google Cloud Scheduler, SRE Book)
- Grammy framework docs (InlineKeyboard, callback_query)

### Tertiary (LOW confidence)
- Time-of-day defaults (21:00 / 09:00 / Sunday 20:00) — practitioner consensus
- Anchor bias on numeric self-report — well-documented generally; specific Telegram-keyboard application inferred
- 18-hour `RESPONSE_WINDOW_HOURS` — guess based on "end of day" framing

---
*Research completed: 2026-04-26*
*Ready for roadmap: yes*
