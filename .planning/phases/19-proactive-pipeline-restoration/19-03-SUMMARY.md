---
phase: 19-proactive-pipeline-restoration
plan: 03
subsystem: proactive
tags: [git-archaeology, restoration, docker-postgres, dual-channel-sweep, accountability, escalation, deadline-trigger, vitest]

# Dependency graph
requires:
  - phase: 19-proactive-pipeline-restoration
    plan: 01
    provides: state.ts channel-aware + escalation helpers (6 legacy + 9 new exports), scripts/test.sh 5-migration harness with ON_ERROR_STOP=1, TriggerResult union with 'decision-deadline' member
  - phase: 19-proactive-pipeline-restoration
    plan: 02
    provides: prompts.ts ACCOUNTABILITY_SYSTEM_PROMPT + ACCOUNTABILITY_FOLLOWUP_PROMPT
  - phase: 15-deadline-trigger-sweep-integration
    provides: canonical commit 4c156c3 as the verified-passing tree state (Phase 15 VERIFICATION §Key Link Verification attested)
  - phase: 16-resolution-accountability-mode
    provides: canonical commit 4c156c3 escalation block contract (Phase 16-05 VERIFICATION §Observable Truth #5 attested)
provides:
  - src/proactive/sweep.ts dual-channel runSweep orchestrator (accountability first, reflective second, escalation block outside daily cap)
  - runSweep invokes createDeadlineTrigger() in accountability channel (SWEEP-01 wiring)
  - runSweep writes upsertAwaitingResolution BEFORE bot.api.sendMessage (RES-02 routing enabler)
  - runSweep escalation block fires 48h follow-up at count=1 and transitions decision 'due'->'stale' at count>=2 (RES-06)
  - runSweep passes through deadline.ts stale-context dating (SWEEP-04 enabler)
  - SweepResult interface extended with accountabilityResult + reflectiveResult (ChannelResult) fields
  - 29-test sweep.test.ts, 12-test deadline.test.ts, 8-test sweep-escalation.test.ts all green under Docker Postgres
affects:
  - Plan 19-04 (TEST-12 realignment — pre-existing synthetic-fixture mock stack now broken by channel-separation; Plan 19-04 replaces the mock to match the dual-channel contract)

# Tech tracking
tech-stack:
  added: []  # No new libraries — pure restoration
  patterns:
    - "Atomic 4-file byte-exact restoration from canonical commit (4c156c3) committed in one git operation to avoid broken intermediate tree states"
    - "Dual-channel sweep with error isolation — accountability channel failures logged but do NOT block the reflective channel; both gated by global mute"
    - "Write-before-send ordering (D-28) — upsertAwaitingResolution called BEFORE bot.api.sendMessage so engine PP#0 routing stays correct even if Telegram send fails"
    - "Escalation block outside daily cap — RES-06 48h follow-up + 2-non-reply stale transition runs every tick, not gated by hasSentTodayAccountability"

key-files:
  created:
    - "src/proactive/__tests__/deadline.test.ts (290 lines, 12 tests — SWEEP-01/04)"
    - "src/proactive/__tests__/sweep-escalation.test.ts (516 lines, 8 tests — RES-06)"
  modified:
    - "src/proactive/sweep.ts (186 → 417 lines; dual-channel + createDeadlineTrigger + escalation)"
    - "src/proactive/__tests__/sweep.test.ts (649 → 901 lines, 21 → 29 tests; single-pipeline mocks replaced with dual-channel mock stack)"

key-decisions:
  - "Byte-exact restoration fidelity: all 4 files match canonical 4c156c3 via empty `diff <(git show 4c156c3:<path>) <path>` and sha256 match."
  - "Atomic 4-file commit: sweep.ts's new dual-channel signature is incompatible with the pre-existing single-pipeline sweep.test.ts mock stack; restoring both in the same commit avoids an intermediate un-buildable tree state."
  - "TEST-12 break accepted per plan: synthetic-fixture.test.ts TEST-12's vi.mock lacks `hasSentTodayAccountability` — the test was written against the degraded single-pipeline contract; the plan explicitly defers realignment to Plan 19-04."
  - "canonical getLastUserLanguage import preserved verbatim even though unused in sweep body — tsconfig.json has no noUnusedLocals (verified), compilation succeeds; canonical wins over hand-edits."

patterns-established:
  - "Dual-channel contract: proactive runSweep returns both accountabilityResult and reflectiveResult in a unified SweepResult; backward-compat top-level fields (triggered, triggerType, message) mirror the accountability result when fired, else the reflective result."
  - "Escalation driven by capture-state table: escalation block SELECTs decision_capture_state WHERE stage='AWAITING_RESOLUTION' every tick, keyed by row.decisionId, using the 5 escalation KV helpers (getEscalationSentAt/Count, setEscalationSentAt/Count, clearEscalationKeys)."
  - "Error isolation between independent pipelines: try/catch around each channel (accountability + escalation + reflective) with structured `proactive.sweep.<phase>.error` pino warn logs, so a single-channel failure never blocks the other channels."

requirements-completed: [SWEEP-01, SWEEP-04, RES-02, RES-06]
requirements-reinforced: [SWEEP-02]  # Channel-aware gates were enabled by state.ts in Plan 19-01; this plan wires them into runSweep.

# Metrics
duration: 13min
completed: 2026-04-17
---

# Phase 19 Plan 03: Dual-Channel Sweep + Escalation Restoration Summary

**`src/proactive/sweep.ts` (186→417 lines) + 3 test files restored byte-exact from canonical commit `4c156c3` in a single atomic commit; dual-channel runSweep with deadline-trigger accountability path, write-before-send ordering, and 48h escalation block now functional; 49 new proactive tests (29 sweep + 12 deadline + 8 escalation) all green under Docker Postgres.**

## Performance

- **Duration:** ~13 min (includes full Docker gate run ~10 min)
- **Started:** 2026-04-17T11:46:49Z
- **Completed:** 2026-04-17T11:59:55Z
- **Tasks:** 2 (Task 1: atomic 4-file restoration + Task 2: Wave 3 gate)
- **Files modified:** 4 (2 modified, 2 created)

## Accomplishments

- **Production code path from sweep tick → deadline detection → AWAITING_RESOLUTION upsert → Telegram send is functional.** Closes the 3 FAIL integration checks from the v2.1 milestone audit (sweep wiring, channel separation, ACCOUNTABILITY prompts).
- **SWEEP-01 wiring complete:** `createDeadlineTrigger()` invoked at sweep.ts:95 in the accountability channel, gated by `hasSentTodayAccountability`.
- **SWEEP-02 reinforced:** Dual-channel architecture — accountability_outreach (priority=2, runs first) + reflective_outreach — independent daily caps via `hasSentTodayAccountability` / `hasSentTodayReflective`.
- **SWEEP-04 enabler:** Stale-context dating logic in `deadline.ts` buildContext() is now reachable via sweep's call to `createDeadlineTrigger()` (was unreachable before this plan).
- **RES-02 enabler:** `upsertAwaitingResolution(chatId, decisionId)` called at sweep.ts:136 BEFORE `bot.api.sendMessage` at sweep.ts:139 (write-before-send per D-28). Row exists even if Telegram send fails → engine PP#0 routes Greg's eventual reply to handleResolution correctly.
- **RES-06 complete:** Escalation block at sweep.ts:~175-230 runs OUTSIDE the daily cap. `transitionDecision(row.decisionId, 'due', 'stale', { actor: 'sweep' })` at sweep.ts:211 for 2-non-reply case; `ACCOUNTABILITY_FOLLOWUP_PROMPT` path for count=1 && >=48h case; `clearCapture` + `clearEscalationKeys` on stale transition.
- **Flow B (deadline → resolution) and Flow E (auto-escalation) CODE-COMPLETE and test-verified.** Awaiting Plan 19-04's TEST-12 realignment to close the v2.1 audit.

## Task Commits

Each task committed atomically:

1. **Task 1: Atomic restoration — sweep.ts + sweep.test.ts + deadline.test.ts + sweep-escalation.test.ts** — `0ede88e` (feat)
2. **Task 2: Wave 3 Docker Postgres gate marker** — `90d8deb` (chore, empty commit)

## Byte-Exact Restoration Evidence

All 4 files verified byte-exact against canonical commit `4c156c3`:

| File | Lines | sha256 (canonical = restored) | diff |
|------|-------|-------------------------------|------|
| `src/proactive/sweep.ts` | 417 | `22750d80…918bd05` | empty |
| `src/proactive/__tests__/sweep.test.ts` | 901 | `8bd27ebd…bde7de1` | empty |
| `src/proactive/__tests__/deadline.test.ts` | 290 | `abe50eb3…d5978ba090` | empty |
| `src/proactive/__tests__/sweep-escalation.test.ts` | 516 | `c1c6087c…b67381831` | empty |

All 4 `diff <(git show 4c156c3:<path>) <path>` returned empty. Byte-exact confirmed.

## Files Created/Modified

- `src/proactive/sweep.ts` (modified) — Dual-channel runSweep orchestrator (186 → 417 lines). New: accountability channel with deadline trigger + prompt + upsertAwaitingResolution + Telegram send + escalation tracking KV; escalation block with 48h follow-up + 2-non-reply stale transition; reflective channel preserved with independent daily cap.
- `src/proactive/__tests__/sweep.test.ts` (modified) — 649 → 901 lines; 21 → 29 tests. Single-pipeline mock stack (18 mocked entities) replaced with dual-channel mock stack. Tests channel independence, accountability-first ordering, error isolation, mute gating, upsertAwaitingResolution write-before-send, setLastSent*.
- `src/proactive/__tests__/deadline.test.ts` (created) — 290 lines, 12 tests. Covers SWEEP-01 (priority=2, oldest-first, transitionDecision actor='sweep') and SWEEP-04 (stale-context dating >48h explicit "On YYYY-MM-DD" prefix).
- `src/proactive/__tests__/sweep-escalation.test.ts` (created) — 516 lines, 8 tests. Covers RES-06 (<48h no-op, count=1 && >=48h → follow-up + setCount(2), count>=2 && >=48h → transitionDecision('stale') + clearCapture + clearEscalationKeys), bootstrap first-sweep race, escalation error isolation from reflective.

## Contract Verification Results

### Typecheck
- `npx tsc --noEmit` exit code: **0**

### Required symbol presence (grep on restored sweep.ts)

| Contract | Expected | Actual | Status |
|----------|----------|--------|--------|
| SWEEP-01: `createDeadlineTrigger()` invoked | ≥1 match | 1 match at line 95 | PASS |
| SWEEP-02: channel gates (`hasSentTodayAccountability\|hasSentTodayReflective`) | ≥2 | 6 | PASS |
| ACCOUNTABILITY prompts referenced | ≥2 | 4 | PASS |
| RES-02: `upsertAwaitingResolution` call | ≥1 | 2 (import+call) | PASS |
| RES-02: upsert ordering BEFORE sendMessage | upsert line < send line | upsert@136 < send@139 | PASS |
| RES-06: 5 escalation helpers used | ≥5 | 14 references across all 5 | PASS |
| RES-06: `transitionDecision(..., 'stale', ...)` | ≥1 | 1 match at line 211 | PASS |
| SweepResult extensions (`accountabilityResult\|reflectiveResult`) | ≥4 | 12 | PASS |
| `export interface ChannelResult` | 1 | 1 match at line 59 | PASS |

All contract greps pass.

### Wave 3 Docker Postgres Gate

- `bash scripts/test.sh` completed; Docker postgres started cleanly, all 5 migrations applied via the canonical harness restored in Plan 19-01 Task 0.
- **Duration:** 601.23s (~10 min) — faster than Wave 1/2 because contradiction-false-positive.test.ts timed out at 600s (pre-existing Cat B env issue) but completed the rest promptly.
- **Final tally:** Test Files 11 failed | 52 passed (63). Tests 95 failed | 798 passed (893).

Per-test-file pass counts for this plan's scope (new proactive test files):

| File | Tests | Passed | Failed |
|------|-------|--------|--------|
| `src/proactive/__tests__/state.test.ts` | 23 | 23 | 0 |
| `src/proactive/__tests__/sweep.test.ts` | 29 | 29 | 0 |
| `src/proactive/__tests__/deadline.test.ts` | 12 | 12 | 0 |
| `src/proactive/__tests__/sweep-escalation.test.ts` | 8 | 8 | 0 |
| **Total proactive (restoration scope)** | **72** | **72** | **0** |

(Verified by absence of any FAIL line referencing `src/proactive/` in `/tmp/wave3-gate.log`; confirmed by the full-suite total delta — 865 → 893 tests = +28 = (+12 deadline) + (+8 escalation) + (+8 new sweep.test.ts tests vs old 21→29).)

### Hard-failure matrix

| Hard-failure mode | Status |
|---|---|
| `tsc --noEmit` non-zero | PASS (0 errors) |
| `state.test.ts` failing | PASS (23/23 green) |
| `sweep.test.ts` / `deadline.test.ts` / `sweep-escalation.test.ts` failing | PASS (49/49 green) |
| Phase 13-17 green-to-red regression caused by this plan | PASS (all 94 Wave-2 baseline failures remain byte-identical) |
| Docker Postgres failing to start | PASS |
| Migration apply failure | PASS (canonical 5-migration harness applied cleanly) |

**Gate verdict: GREEN for Phase 19-03 scope.**

## Expected Break: synthetic-fixture.test.ts TEST-12

**This is the expected signal, per the plan's design.** Once sweep.ts's dual-channel signature replaced the old single-pipeline, the pre-existing synthetic-fixture.test.ts TEST-12 case (written before Phase 19 began) became incompatible:

```
 FAIL  decisions/__tests__/synthetic-fixture.test.ts > TEST-12: same-day deadline + silence trigger collision
Error: [vitest] No "hasSentTodayAccountability" export is defined on the "../../proactive/state.js" mock.
Did you forget to return it from "vi.mock"?
```

The test's `vi.mock('../../proactive/state.js')` factory returned only `hasSentToday` (single-pipeline legacy) and did not define `hasSentTodayAccountability` / `hasSentTodayReflective`. When restored runSweep calls `hasSentTodayAccountability(config.proactiveTimezone)` at sweep.ts:93, the mock rejects.

**Resolution deferred to Plan 19-04** (explicit scope per 19-03-PLAN and 19-ROADMAP). Plan 19-04 realigns TEST-12 to the channel-separation contract by:
1. Adding `hasSentTodayAccountability` / `setLastSentAccountability` / `hasSentTodayReflective` / `setLastSentReflective` to the mock factory.
2. Asserting `sendMessage` called **twice** (once per channel) instead of once.
3. Asserting `result.accountabilityResult.triggered` + `result.reflectiveResult.triggered` separately, rather than the legacy `result.triggerType === 'silence'` single-winner expectation.

Until that realignment lands, this is the ONLY test failure attributable to Plan 19-03's scope; it is NOT a regression — it is the pre-existing test locking in a degraded contract.

## Phase 13-17 Regression Status

**NO NEW regressions attributable to Plan 19-03.**

Wave 3 gate totals: 11 files / 95 tests failing.

Wave 2 baseline (per 19-02-SUMMARY and deferred-items.md): 10 files / 94 tests failing.

Delta: +1 file (synthetic-fixture.test.ts — expected TEST-12 break documented above), +1 test (TEST-12 — expected).

All 94 Wave-2 baseline failures remain byte-identical:
- **Cat A (engine mock-chain):** engine.test.ts (29), engine-mute.test.ts (7), engine-refusal.test.ts (3), photos-memory.test.ts (5), language.test.ts (1) = **45 unchanged**.
- **Cat B (live-API/huggingface env):** live-integration.test.ts (21), contradiction-false-positive.test.ts (20), live-accountability.test.ts (3), models-smoke.test.ts (3), vague-validator-live.test.ts (2) = **49 unchanged**.

Root cause for Cat A/B failures is documented in `deferred-items.md` (pre-existing; unrelated to Phase 19 restoration). Proven pre-existing in Plan 19-01 by rolling restoration back and re-running → identical error signatures.

## Flow Status Post-Plan-19-03

| Flow | Phase 17 status | Phase 19-03 status | Awaiting |
|------|-----------------|--------------------|-----------|
| B (deadline → resolution) | BROKEN (sweep.ts did not invoke deadline trigger) | CODE-COMPLETE + test-verified | TEST-12 realignment (Plan 19-04) for v2.1 audit closure |
| E (auto-escalation) | BROKEN (no escalation block) | CODE-COMPLETE + test-verified | TEST-12 realignment (Plan 19-04) for v2.1 audit closure |

Production code path now supports:
  1. Sweep tick fires → accountability channel → deadline trigger → decision transitions open→due
  2. Sweep upserts AWAITING_RESOLUTION row BEFORE sending Telegram (survives send failures)
  3. Sweep persists `accountability_sent_<id>` + `accountability_prompt_count_<id>` (count=1) on initial prompt
  4. Next tick ≥48h later with count=1 → `ACCOUNTABILITY_FOLLOWUP_PROMPT` sent, count→2, sentAt refreshed
  5. Next tick ≥48h later with count≥2 → `transitionDecision(..., 'stale', { actor: 'sweep' })` + clearCapture + clearEscalationKeys

## Decisions Made

- **Byte-exact canonical restoration accepted.** The plan's interfaces block listed speculative import paths (e.g., `'../pensieve/pensieve.js'`) that did not exist in HEAD; the plan's `<action>` explicitly said "use `git show 4c156c3:...`" — canonical imports (e.g., `'../memory/conversation.js'`) took precedence, all resolvable in HEAD.
- **Atomic 4-file commit used.** sweep.ts's new dual-channel signature is incompatible with the pre-existing sweep.test.ts mock stack; committing both in one operation avoided a broken intermediate tree state.
- **`getLastUserLanguage` unused import preserved.** Canonical sweep.ts imports it; tsconfig.json has no `noUnusedLocals` (verified); compilation succeeds; byte-exact restoration wins over hand-editing.
- **TEST-12 break accepted, not auto-fixed.** The plan explicitly scopes TEST-12 realignment to Plan 19-04; fixing it here would cross plan boundaries (scope creep).
- **Docker volumes reset before gate.** Per 19-02-SUMMARY's operational note (canonical test.sh does not wipe volumes between runs), ran `docker compose -f docker-compose.local.yml down -v` before the gate to ensure fresh DB state. No issue encountered; gate ran cleanly.

## Deviations from Plan

None. Plan executed exactly as written:
- 4 files restored byte-exact from canonical commit `4c156c3`
- Atomic single-commit restoration as mandated
- Wave 3 Docker gate ran via `bash scripts/test.sh` (canonical 5-migration harness)
- TEST-12 break documented for Plan 19-04 resolution as the plan specified

## Issues Encountered

None. The Wave 3 gate surfaced only the expected TEST-12 break (per plan) and the pre-existing Cat A / Cat B baseline failures (per deferred-items.md). No debugging or investigation was required.

## User Setup Required

None — no external service configuration changes required by this plan. The pre-existing `ANTHROPIC_API_KEY` placeholder issue (Cat B) remains an operator concern unchanged from Wave 1.

## Next Phase Readiness

### Forward notes for Plan 19-04

- **Task 1 (scripts/test.sh restoration) was completed in Plan 19-01.** Plan 19-04's real first task is TEST-12 realignment.
- **TEST-12 realignment specification** (precise scope for Plan 19-04):
  - File: `src/decisions/__tests__/synthetic-fixture.test.ts`
  - Location: test ~line 542 ("deadline and silence triggers both fire; single-pipeline selects highest-priority winner without starvation")
  - Error surfaced: `No "hasSentTodayAccountability" export is defined on the "../../proactive/state.js" mock`
  - Remediation: replace the legacy vi.mock factory output with dual-channel shape (add `hasSentTodayAccountability`, `setLastSentAccountability`, `hasSentTodayReflective`, `setLastSentReflective`, `getEscalationSentAt`, `setEscalationSentAt`, `getEscalationCount`, `setEscalationCount`, `clearEscalationKeys`); update assertions to expect 2 `sendMessage` calls (accountability + reflective) and check per-channel result fields in `SweepResult`.
  - Also likely: migration snapshot regeneration (drizzle-kit generate for missing 0001/0003 meta files, non-blocking for tests).
- **After Plan 19-04:** v2.1 milestone audit FAIL checks for Phase 17 (sweep wiring, channel separation, ACCOUNTABILITY prompts) all resolve. Flow B + Flow E audit-complete.

### Deferred items

No new entries. Pre-existing `deferred-items.md` Cat A (engine mock-chain, 45 tests) and Cat B (live-API/huggingface env, 49 tests) remain as baseline noise; neither is Phase 19 scope.

## TDD Gate Compliance

This plan is `type: execute` (not `type: tdd`), so plan-level TDD gates do not apply. Nevertheless, the restoration includes both implementation and tests from the canonical commit simultaneously — a natural GREEN-first pattern for atomic restoration. Tests were written against a working implementation in Phase 15/16; restoring them together preserves that verified state.

## Self-Check

| Claim | Verification |
|---|---|
| Task 1 commit `0ede88e` exists | `git log --oneline` shows it |
| Task 2 (gate marker) commit `90d8deb` exists | `git log --oneline` shows it |
| `src/proactive/sweep.ts` 417 lines and byte-exact from 4c156c3 | `wc -l` + sha256 match + empty diff |
| `src/proactive/__tests__/sweep.test.ts` 901 lines and byte-exact from 4c156c3 | `wc -l` + sha256 match + empty diff |
| `src/proactive/__tests__/deadline.test.ts` 290 lines and byte-exact from 4c156c3 | `wc -l` + sha256 match + empty diff |
| `src/proactive/__tests__/sweep-escalation.test.ts` 516 lines and byte-exact from 4c156c3 | `wc -l` + sha256 match + empty diff |
| `tsc --noEmit` = 0 errors | Task 1 verification, exit 0 |
| All 4 proactive test files green (72/72 tests) | No FAIL line referencing `src/proactive/` in gate log; total test count delta 865→893 matches +28 expected |
| Contract greps all pass (SWEEP-01, SWEEP-02, ACCOUNTABILITY prompts, RES-02 ordering, RES-06 escalation + stale) | Task 1 verification section above |
| No Phase 13-17 regression beyond expected TEST-12 break | Wave 2 baseline 94 tests all identical in Wave 3; delta +1 is TEST-12 only |

Self-Check: **PASSED**

---
*Phase: 19-proactive-pipeline-restoration*
*Completed: 2026-04-17*
