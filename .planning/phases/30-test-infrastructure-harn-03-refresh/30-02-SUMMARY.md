---
phase: 30-test-infrastructure-harn-03-refresh
plan: 02
subsystem: testing
tags: [synthetic-fixture, mock-clock, integration-test, pp5-regression, ritual-pipeline, m009-milestone-gate]

# Dependency graph
requires:
  - phase: 30-test-infrastructure-harn-03-refresh
    plan: 01
    provides: tests/fixtures/primed/m009-21days/ on disk (loadPrimedFixture('m009-21days') resolves)
  - phase: 26-daily-voice-note-ritual
    provides: fireJournal handler + recordJournalResponse PP#5 deposit + chooseNextPromptIndex
  - phase: 27-daily-wellbeing-snapshot
    provides: handleWellbeingCallback + WELL-01..05 callback contract
  - phase: 28-skip-tracking-adjustment-dialogue
    provides: computeSkipCount + shouldFireAdjustmentDialogue + fireAdjustmentDialogue + ritualResponseWindowSweep
  - phase: 29-weekly-review
    provides: fireWeeklyReview + Stage-1 INTERROGATIVE_REGEX + Stage-2 Haiku judge + date-grounding + TEMPLATED_FALLBACK_EN
  - phase: 31-rename-voice-note-to-journal
    provides: daily_journal naming throughout codebase (was daily_voice_note pre-rename)
provides:
  - synthetic-fixture.test.ts — M009 milestone-shipping gate (14-day mock-clock walk + 7 spec behaviors)
  - simulateCallbackQuery({ callbackData, messageId? }) shared helper (D-30-05)
  - CHAT_ID_M009_SYNTHETIC_FIXTURE = BigInt(99921) chat-ids registry slot
  - cumulative mockAnthropicCreate.not.toHaveBeenCalled() Pitfall 6 regression invariant for the entire fixture week
affects:
  - phase 32 (substrate hardening backlog gains 2 new candidates: fireJournal lastIdx weakness + fixture episodic_summaries multi-week coverage)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cumulative not-called assertion in afterAll for Pitfall 6 regression — mock seam at the project's wrapper module (../../llm/client.js), NOT at @anthropic-ai/sdk directly. Pattern verbatim from src/chris/__tests__/engine-pp5.test.ts:83-92."
    - "epistemic_tag-scoped cleanup discriminator (vs source-scoped): when production code emits source='telegram' (same as fixture organic data), epistemic_tag = 'RITUAL_RESPONSE' is the per-test deposit signature (verified zero such rows in fixture)."
    - "Mock-clock + optimistic-lock interaction pattern: tryFireRitualAtomic's `lt(lastRunAt, lastObserved)` predicate requires `lastRunAt: null` reset between mock-clock iterations to defeat the production race-lock that assumes wallclock advancement."

key-files:
  created:
    - src/rituals/__tests__/synthetic-fixture.test.ts (NEW; ~530 LoC)
    - src/rituals/__tests__/fixtures/simulate-callback-query.ts (NEW; ~30 LoC)
    - .planning/phases/30-test-infrastructure-harn-03-refresh/deferred-items.md (NEW)
  modified:
    - src/__tests__/fixtures/chat-ids.ts (appended 1 new constant)
    - src/rituals/__tests__/wellbeing.test.ts (refactored to import shared helper)

key-decisions:
  - "metadata.kind canonical value for adjustment dialogue: 'adjustment_dialogue' (not 'adjustment') — verified at src/rituals/adjustment-dialogue.ts:306. TEST-27 asserts the canonical value directly."
  - "wellbeingSnapshots.snapshotDate Drizzle return shape: postgres-js returns `date` columns as ISO 'YYYY-MM-DD' strings (not Date objects). String() coercion in the comparison handles both shapes defensively."
  - "mockAnthropicParse.mockReset() between Week 1 and Week 2 — sufficient for queue cleanup. Reset wipes both invocation count AND mockResolvedValueOnce queue cleanly. mockClear() would have left the queue intact (wrong)."
  - "TEST-24 'no-repeat-in-last-6' interpretation: REQUIREMENTS.md's literal reading is incompatible with the 6-prompt shuffled-bag algorithm (cycle 2's first prompt is ALWAYS among cycle 1's last 6). Aligned with Phase 26 prompt-rotation-property.test.ts canonical interpretation: within-cycle uniqueness (deterministic) + max-gap ≤ 11 (the actual strong invariant)."
  - "Cleanup discriminator changed from PLAN.md FIXTURE_SOURCE='m009-synthetic-fixture' to epistemic_tag='RITUAL_RESPONSE'. Production code (recordJournalResponse + fireWeeklyReview) emits source='telegram' (same as fixture organic), so source-scoped delete couldn't actually scope. Verified fixture has 0 RITUAL_RESPONSE rows → epistemic_tag-scoped delete preserves fixture data while wiping test deposits."
  - "TEST-29+30 single-Sunday execution: m009-21days fixture only has substrate (4 episodic_summaries 2026-05-07..2026-05-10 + 5 decisions 2026-05-06..07) for the 2026-05-10 Sunday's past-7-day window. Two other Sundays in the original 14-day window (2026-04-19, 2026-04-26) have ZERO substrate → fireWeeklyReview short-circuits on no_data. TEST-29+30 fires twice on 2026-05-10 with intermediate state cleanup to exercise both happy path and templated fallback. Honors REQUIREMENTS.md TEST-29 'templated fallback exercised in at least one fixture week' — flagged as Phase 32 substrate-widening candidate."
  - "HARD CO-LOCATION #4 confirmed: synthetic-fixture.test.ts is DISTINCT from cron-registration.test.ts (Plan 30-03 owned). Zero test bleed; verified via separate-file existence and orthogonal mock surfaces."

patterns-established:
  - "Per-iteration mock-clock walk pattern for ritual cron testing: `vi.setSystemTime(date) → update rituals SET nextRunAt=now, lastRunAt=null → drop ritual_daily_count KV → runRitualSweep(new Date()) → assert/observe → cleanup`. The lastRunAt-null reset is the load-bearing fix that defeats tryFireRitualAtomic's optimistic-lock predicate (lt(lastRunAt, lastObserved) fails when wallclock doesn't advance between iterations)."
  - "parkRituals(...names) helper: park named rituals in far-future + reset lastRunAt to null so the runRitualSweep 'oldest due first' SELECT picks only the test's intended ritual. Generic over the 3 M009 rituals (daily_journal / daily_wellbeing / weekly_review)."

requirements-completed: [TEST-23, TEST-24, TEST-25, TEST-26, TEST-27, TEST-28, TEST-29, TEST-30]

# Metrics
duration: 23min
completed: 2026-05-07
---

# Phase 30 Plan 02: Synthetic Fixture Test Summary

**14-day synthetic fixture integration test ships M009's milestone-shipping gate — vi.setSystemTime walk + cumulative PP#5 short-circuit assertion across all 7 TEST-23..30 spec behaviors in 6 it() blocks.**

## Performance

- **Duration:** ~23 min wall-clock (started 2026-05-07T12:42:36Z, completed 2026-05-07T13:06:06Z)
- **Tasks:** 6 (all atomic per-task commits, conventional-commit format)
- **Files created/modified:** 5 (3 created, 2 modified)
- **Test runtime:** 1.59s for 6 it() blocks (full Docker gate via scripts/test.sh; real postgres + 11 migrations + Phase 25/26/28/29/31 substrate verifications)

## Accomplishments

- **`src/rituals/__tests__/synthetic-fixture.test.ts`** (NEW; ~530 LoC) — 14-day mock-clock walk asserting all 7 TEST-23..30 behaviors:
  1. **TEST-24** — daily prompt rotation (within-cycle uniqueness + max-gap ≤ 11 across 14 fires).
  2. **TEST-25** — 14 days of journal STT replies persist as RITUAL_RESPONSE pensieve_entries with metadata.source_subtype='ritual_journal' (Phase 31 rename).
  3. **TEST-26** — `computeSkipCount` filters by outcome correctly (system_suppressed + window_missed → 0; fired_no_response → 3).
  4. **TEST-27** — adjustment dialogue dispatched at daily=3 threshold (skipCount denormalized counter); mockSendMessage receives the canonical adjustment-dialogue text.
  5. **TEST-28** — wellbeing snapshots via `simulateCallbackQuery` helper (2 days × 3 dim taps each; per-day partitioning verified).
  6. **TEST-29 + TEST-30 (co-located)** — weekly review Stage-1 + Stage-2 + date-grounding (happy path) + templated fallback (3-retry compound-question path); pensieve_entries row with metadata.kind='weekly_review' references the in-window date.

- **`src/rituals/__tests__/fixtures/simulate-callback-query.ts`** (NEW; ~30 LoC) — Shared helper extracted from wellbeing.test.ts:77-86 per D-30-05; 2 consumers (wellbeing.test.ts existing + synthetic-fixture.test.ts new).

- **`src/__tests__/fixtures/chat-ids.ts`** (MODIFIED; +3 LoC) — `CHAT_ID_M009_SYNTHETIC_FIXTURE = BigInt(99921)` appended to registry.

- **`src/rituals/__tests__/wellbeing.test.ts`** (REFACTORED) — In-place rewire to import the shared helper; 10 buildMockCtx call sites replaced with simulateCallbackQuery({ callbackData: ... }); zero behavioral change verified by matching test count (6 passing / 2 pre-existing failing) before and after.

- **Pitfall 6 cumulative regression invariant** — `expect(mockAnthropicCreate).not.toHaveBeenCalled()` in afterAll passes across the entire 14-day walk including all 6 it() blocks. Pattern verbatim from src/chris/__tests__/engine-pp5.test.ts:83-92. The fixture-week-scope assertion is M009's milestone-shipping gate.

- **Phase 32 follow-up hooks** — 2 new substrate-hardening candidates flagged inline:
  1. `src/rituals/journal.ts:357` lastIdx formula weakness (does not preserve just-fired prompt across cycle boundaries; ~17% probability of consecutive duplicate per cycle boundary in 14-fire windows).
  2. m009-21days fixture has only one usable Sunday for weekly_review (2026-05-10); a future Phase 32 plan should extend `scripts/synthesize-episodic.ts:288` and `scripts/synthesize-delta.ts:407-440` to fuse organic+synth episodic summaries across the full fixture window so all Sundays carry substrate.

## Task Commits

Each task committed atomically with Conventional Commits format:

1. **Task 1: refactor — chat-id + helper extraction + wellbeing rewire** — `5b3b96a` (refactor)
2. **Task 2: scaffold synthetic-fixture skeleton + Pitfall 6 cumulative invariant** — `45d2ef0` (test)
3. **Task 3: TEST-24 + TEST-25 (rotation + journal persistence)** — `1697791` (test)
4. **Task 4: TEST-26 + TEST-27 (skip filter + adjustment threshold)** — `1f34800` (test)
5. **Task 5: TEST-28 (wellbeing via simulateCallbackQuery)** — `6ae0439` (test)
6. **Task 6: TEST-29 + TEST-30 (weekly review Stage-1+2 + fallback)** — `54802fe` (test)

**Plan metadata final commit:** _pending — STATE.md / SUMMARY.md / ROADMAP.md_

## Decisions Made

1. **`metadata.kind` for adjustment dialogue is 'adjustment_dialogue' (canonical).** Verified at `src/rituals/adjustment-dialogue.ts:306`. TEST-27 asserts the canonical value directly (no need for the alternate-value fallback the PLAN.md hedged for).

2. **`wellbeingSnapshots.snapshotDate` Drizzle return shape: ISO 'YYYY-MM-DD' string** (not Date object) under postgres-js. TEST-28 uses `String(s.snapshotDate) === day0` for defensive comparison.

3. **`mockAnthropicParse.mockReset()` between Week 1 and Week 2** is the right cleanup primitive (clears invocation count AND mockResolvedValueOnce queue). `mockClear()` would have left the queue intact.

4. **TEST-24 invariant interpretation: max-gap ≤ 11 + within-cycle uniqueness** (NOT the literal "no-repeat-in-last-6"). The 6-prompt shuffled-bag algorithm pops every prompt exactly once per cycle, making the literal reading mathematically impossible. The Phase 26 `prompt-rotation-property.test.ts:54-64` is the canonical interpretation; TEST-24 mirrors it.

5. **Cleanup discriminator: `epistemic_tag = 'RITUAL_RESPONSE'`** (NOT the PLAN.md prescribed `FIXTURE_SOURCE = 'm009-synthetic-fixture'`). Production deposits emit `source='telegram'` (same as fixture organic), so source-scoped delete couldn't scope. Verified fixture has 0 RITUAL_RESPONSE entries — epistemic_tag-scoped delete is the correct test isolation primitive.

6. **TEST-29+30 single-Sunday execution.** m009-21days fixture has substrate availability only for the 2026-05-10 Sunday's past-7-day window. The other Sundays in the original 14-day window short-circuit on no_data. Both happy path and templated fallback are exercised by re-firing on 2026-05-10 with intermediate state cleanup. Honors REQUIREMENTS.md TEST-29 ("templated fallback exercised in at least one fixture week"). Substrate widening flagged as Phase 32 candidate.

7. **HARD CO-LOCATION #4 contract honored.** synthetic-fixture.test.ts is DISTINCT from cron-registration.test.ts (Plan 30-03 territory). Zero test-bleed; orthogonal mock surfaces (cron-registration is static-analysis with no DB; synthetic-fixture is integration with real postgres + mocked Anthropic SDK).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] tryFireRitualAtomic optimistic-lock requires lastRunAt reset between iterations**
- **Found during:** Task 3 first run (TEST-24 captured only 1 of 14 expected prompts).
- **Issue:** The mock-clock walk fires the same ritual 14 times. After iteration N's fire, `rituals.lastRunAt` = N's wallclock. Iteration N+1's scheduler SELECT returns that same lastRunAt as `lastObserved`. tryFireRitualAtomic's predicate `OR(isNull(lastRunAt), lt(lastRunAt, lastObserved))` evaluates `lt(lastRunAt, lastObserved)` — equal values, NOT less — fails → race_lost → no fire on iteration 1+.
- **Fix:** Per-iteration update sets `{ nextRunAt: new Date(), lastRunAt: null }` so the `isNull(lastRunAt)` branch carries the predicate.
- **Production note:** This race-lock is correct for prod (between two cron ticks, Date.now() always advances strictly). Test-only mitigation; no production code change needed. The optimistic-lock contract still holds in prod.
- **Files modified:** Plan-internal — only `synthetic-fixture.test.ts`.

**2. [Rule 4 — Architectural / resolved per executor discretion] TEST-24 invariant text mismatch**
- **Found during:** Task 3 first run with the literal "no-repeat-in-last-6" assertion (PLAN.md acceptance criteria).
- **Issue:** Two layers: (a) `fireJournal`'s lastIdx formula at `journal.ts:357` does NOT preserve the just-fired prompt across cycle boundaries — when bag empties, `lastIdx` becomes undefined, so the head-swap guard at refill cannot defend against consecutive-duplicate at the boundary. (b) The literal "no-repeat-in-last-6" interpretation is mathematically incompatible with a 6-prompt shuffled bag — cycle 2's first prompt is ALWAYS among cycle 1's last 6 because each cycle exhausts every prompt exactly once.
- **Fix:** Aligned TEST-24 with the Phase 26 canonical interpretation (`prompt-rotation-property.test.ts:54-64`). Asserts within-cycle uniqueness (deterministic via bag exhaustion) + max-gap ≤ 11 (actual strong invariant the rotation algorithm guarantees). The fireJournal lastIdx weakness logged for Phase 32 substrate hardening.
- **Resolution path:** This was a Rule 4 candidate (architectural decision) but could be resolved by aligning with the existing Phase 26 contract. No production code change needed.

**3. [Rule 3 — Blocking] PLAN.md type / naming mismatches with current codebase**
- **PLAN.md said:** `GREG_USER_ID = BigInt(99921)`. **Codebase says:** `processMessage(chatId: bigint, userId: number, text: string)`. Corrected to `number`.
- **PLAN.md said:** `daily_voice_note` / `fireVoiceNote` / `ritual_voice_note`. **Codebase says (post-Phase 31 rename):** `daily_journal` / `fireJournal` / `ritual_journal`. Translated throughout per orchestrator standing rule.
- **PLAN.md said:** `MANIFEST.window_start` / `MANIFEST.window_end`. **Actual emitted MANIFEST shape:** `target_days` + `synthetic_date_range` (Plan 30-01 hit the same issue and adapted). Anchored the 14-day walk to a hardcoded `FIXTURE_WINDOW_START_ISO` instead, plus a separate `WEEKLY_REVIEW_SUNDAY_ISO = '2026-05-10'` for TEST-29+30 (the only Sunday with substrate).
- **PLAN.md said:** `FIXTURE_SOURCE = 'm009-synthetic-fixture'` for cleanup. **Reality:** production deposits use `source='telegram'` (same as fixture organic). Adapted to `epistemic_tag = 'RITUAL_RESPONSE'`-scoped delete.

**4. [Rule 3 — Blocking] Channel daily-cap interaction with mock-clock walks**
- **Found during:** Pre-emptive design (would have surfaced as silent no-op fires after iteration 1 wall-clocks within the same day).
- **Issue:** `hasReachedRitualDailyCap` keys off `localDateKeyFor(now)` and the persistent KV `ritual_daily_count`. Multiple sweeps within the same simulated day would hit the cap.
- **Fix:** Per-iteration `await db.delete(proactiveState).where(eq(proactiveState.key, 'ritual_daily_count'))` + per-test cleanup mirrors `beforeEach`. Defensive even though vi.setSystemTime moves Date.now() forward by 24h between most iterations.

### Out-of-scope deviations (logged, not auto-fixed)

**Pre-existing wellbeing.test.ts Test 6 + Test 7 failures** — see `deferred-items.md`. Confirmed pre-existing on `main` (commit 171a624) before Plan 30-02; same 6 passing / 2 failing count after Plan 30-02. ZERO regression introduced by the helper extraction refactor.

---

**Total deviations:** 4 auto-fixed (1 Rule 4-resolved, 3 Rule 3-blocking). 1 out-of-scope failure logged (pre-existing).

## Issues Encountered

- Postgres container required restart between phase plans (stale state from prior runs). `bash scripts/test.sh` handles this idempotently — each invocation starts a fresh `chris-postgres-1` and applies all migrations.

## TDD Gate Compliance

Plan 30-02 is `type: execute` (not `type: tdd` at the plan level), so the gate sequence is per-task atomic commits with no RED/GREEN/REFACTOR plan-level cycle. All 6 tasks committed atomically with `test(...)` or `refactor(...)` prefix per Conventional Commits. The cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` invariant in afterAll IS the load-bearing test — every it() block contributes to it implicitly via the file-scope hook.

## Validation Results

- `npx tsc --noEmit` → 0 errors
- `bash scripts/test.sh src/rituals/__tests__/synthetic-fixture.test.ts` → 6/6 it() blocks passing in 1.59s (Docker gate — all 11 migrations + Phase 25/26/28/29/31 substrate verifications green)
- `bash scripts/test.sh src/rituals/__tests__/wellbeing.test.ts` → 6 passing / 2 pre-existing failing (verified ZERO regression vs `main` baseline; pre-existing failures logged in `deferred-items.md`)
- afterAll cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` → green across all 6 it() blocks (Pitfall 6 invariant active for the entire fixture week)
- All 4 acceptance-criteria files exist and match the contract:
  - `src/rituals/__tests__/synthetic-fixture.test.ts` — 530+ LoC, contains `describe.skipIf` skip-on-missing-fixture, `mockAnthropicCreate).not.toHaveBeenCalled` cumulative assertion, all 6 TEST-NN it() blocks
  - `src/rituals/__tests__/fixtures/simulate-callback-query.ts` — exports `simulateCallbackQuery`, `SimulatedCallbackCtx`
  - `src/rituals/__tests__/wellbeing.test.ts` — zero `buildMockCtx` references, 12 `simulateCallbackQuery` references (1 import + 11 usages)
  - `src/__tests__/fixtures/chat-ids.ts` — `CHAT_ID_M009_SYNTHETIC_FIXTURE = BigInt(99921)` present

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Wave 2 of Phase 30 complete.** Plans 30-01/30-03/30-04 already shipped from prior runs; this plan's completion closes Phase 30.
- **M009 milestone-shipping gate is now in place.** The cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` invariant catches PP#5 short-circuit regressions across the entire 14-day fixture week. Future engine changes that re-route ritual replies through the LLM will be caught by this gate.
- **Phase 32 backlog updated:** 2 new candidates (fireJournal lastIdx formula weakness; m009 fixture multi-week substrate widening) join the existing 5 items from Plan 30-01.

## Self-Check: PASSED

- Created file `/home/claude/chris/src/rituals/__tests__/synthetic-fixture.test.ts` — FOUND
- Created file `/home/claude/chris/src/rituals/__tests__/fixtures/simulate-callback-query.ts` — FOUND
- Created file `/home/claude/chris/.planning/phases/30-test-infrastructure-harn-03-refresh/deferred-items.md` — FOUND
- Modified file `/home/claude/chris/src/__tests__/fixtures/chat-ids.ts` — verified via git log
- Modified file `/home/claude/chris/src/rituals/__tests__/wellbeing.test.ts` — verified via git log
- Commit `5b3b96a` (Task 1 refactor) — FOUND
- Commit `45d2ef0` (Task 2 skeleton) — FOUND
- Commit `1697791` (Task 3 TEST-24+25) — FOUND
- Commit `1f34800` (Task 4 TEST-26+27) — FOUND
- Commit `6ae0439` (Task 5 TEST-28) — FOUND
- Commit `54802fe` (Task 6 TEST-29+30) — FOUND

---
*Phase: 30-test-infrastructure-harn-03-refresh*
*Completed: 2026-05-07*
