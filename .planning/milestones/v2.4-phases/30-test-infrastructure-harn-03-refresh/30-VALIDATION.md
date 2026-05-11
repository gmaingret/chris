---
phase: 30
slug: test-infrastructure-harn-03-refresh
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-30
---

# Phase 30 — Validation Strategy

> Phase 30 IS the validation phase for M009. Its own Nyquist contract is meta: how do we prove the synthetic-fixture test would actually catch a regression? Answered via per-test falsifiable plans below.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.x (Node, ESM) — `vitest.config.ts` at repo root with `fileParallelism: false` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run <file-pattern>` (no Docker) — only valid for pure-function tests |
| **Full suite command** | `bash scripts/test.sh` (Docker postgres + migrations + vitest) — canonical |
| **Estimated runtime** | quick: ~5s, full: ~90s (excluding live anti-flattery which is default-skip) |

---

## Sampling Rate

- **After every task commit:** Run targeted `bash scripts/test.sh src/rituals/__tests__/<touched-file>` for the modified test
- **After every plan wave:** Run `bash scripts/test.sh` (real-postgres integration gate)
- **Before `/gsd-verify-work`:** Full suite must be green; `m009-21days` fixture must exist; live-weekly-review.test.ts default-skipped (zero API spend)
- **Max feedback latency:** 90 seconds (full suite); 5 seconds (per-task quick run on pure-function tests)

---

## Per-Task Verification Map (filled by planner)

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| TBD | TBD | TBD | TBD | TBD | TBD | ⬜ pending |

> Planner authors per-plan task verification rows once tasks are written.

---

## Wave 0 Requirements

- [ ] **m009-21days primed fixture** — `tests/fixtures/primed/m009-21days/MANIFEST.json` materialized via `scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force` (Plan 30-01 Task 1). Wave 2 is BLOCKED until this exists.
- [ ] **simulate-callback-query helper** — `src/rituals/__tests__/fixtures/simulate-callback-query.ts` extracted from existing inline pattern at `src/rituals/__tests__/wellbeing.test.ts:77-86` (Plan 30-02 first task)
- [ ] **CHAT_ID_M009_SYNTHETIC_FIXTURE constant** — Add `BigInt(99921)` to `src/__tests__/fixtures/chat-ids.ts` (RESEARCH new question)
- [ ] **`registerCrons` mock seam** — Confirm Plan 30-03 has the patterns to assert `src/index.ts:main()` invokes `registerCrons()` with all M009 cron handlers including `ritualConfirmationSweep`

---

## Per-Test Falsifiable Verification (the meta-Nyquist)

| TEST-NN | What "true" means | How to PROVE the test would catch a regression |
|---------|-------------------|------------------------------------------------|
| **TEST-24** (rotation) | No-repeat-in-last-6 invariant holds across 14 days | Inject a deliberate regression: hardcode `prompt_bag` to fire same prompt twice in last 6 fires → assert TEST-24 FAILS. Then revert and assert PASSES. Document the meta-test pattern in plan acceptance criteria but DO NOT ship it (Phase 30's regression is enough proof). |
| **TEST-25** (PP#5 short-circuit) | `mockAnthropicCreate.not.toHaveBeenCalled()` accumulates across all voice-note response days | Inject a deliberate Pitfall-6 regression: comment out PP#5's early-return short-circuit → assert TEST-25 FAILS with `mockAnthropicCreate.toHaveBeenCalledTimes(>0)`. Cumulative `afterAll` assertion is load-bearing — exact pattern from `engine-pp5.test.ts:83`. |
| **TEST-26** (skip outcome filtering) | `system_suppressed` and `window_missed` events do NOT increment skip_count | Insert `ritual_fire_events` rows with the 2 non-counting outcomes → assert `computeSkipCount()` returns 0 → insert `fired_no_response` → assert returns 1. Mirrors Phase 28-01 substrate test pattern. |
| **TEST-27** (adjustment threshold) | Daily=3, weekly=2 thresholds honored | Walk mock-clock 4 days emitting `fired_no_response` → assert adjustment-dialogue fires on day 4 (not day 3, because 3rd skip triggers, but the FIRE happens on the NEXT sweep — day 4). Mirror Phase 28-02 predicate test. |
| **TEST-28** (wellbeing callback_query) | Inline keyboard tap stored as `wellbeing_snapshots` row | Use `simulateCallbackQuery({ callbackData: 'wellbeing:energy:3' })` → assert `wellbeing_snapshots` row exists with `energy=3` for the simulated date. First use of inline keyboards in test fixtures (D-30-05). |
| **TEST-29** (single observation + single question) | Stage-1 + Stage-2 invoked; templated fallback exercised in at least 1 fixture week | Mock Sonnet response: Week 1 = happy-path single question; Week 2 = compound question on all 3 attempts → retry cap=2 → fallback fires. Assert: (a) Week 1 message contains `?` count=1; (b) Week 2 message contains the templated fallback string `"What stood out to you about this week?"`; (c) `mockLoggerWarn` called with `'chris.weekly-review.fallback-fired'`. |
| **TEST-30** (date-grounding + summary references) | Observation text references at least 1 episodic_summary AND 1 decision from the simulated week | Parse the observation text via the date-grounding post-check (already exists in Phase 29-02). Assert no out-of-window references. Mirror Phase 29-02's date-grounding test. |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live anti-flattery 3-of-3 against real Sonnet | TEST-31 | Real API spend (~$0.45/run); default-skipped per D-30-03 | `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... bash scripts/test.sh src/rituals/__tests__/live-weekly-review.test.ts` — assert 3-of-3 runs return observations containing zero of the 40 markers |
| Real-clock 60s confirmation window in production | (carry-over from Phase 28) | Cron tick cadence + Telegram delivery requires post-deploy observation | Already covered by 28-POSTDEPLOY-UAT.md scheduled remote agent (2026-05-07) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (m009-21days fixture, simulate-callback-query helper, CHAT_ID constant)
- [ ] No watch-mode flags (vitest run, NOT vitest watch)
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter
- [ ] Each TEST-24..30 has at least one falsifiable automated test (per-test mapping in Per-Test Falsifiable Verification table above)
- [ ] TEST-31 manual gate documented in TESTING.md (Plan 30-04)

**Approval:** pending
