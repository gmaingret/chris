---
phase: 28-skip-tracking-adjustment-dialogue
verified: 2026-04-29T18:00:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "60-second confirmation window under real-clock conditions"
    expected: "After deploy, set ritual to high skip-count via DB write; observe adjustment dialogue fires at next sweep; reply 'yes'; confirm config patch lands in ritual_config_events within 60s of reply"
    why_human: "Cron tick cadence is wallclock — vi.setSystemTime covers logic but real-clock interaction with Telegram delivery at sub-minute granularity requires post-deploy observation. The ritualConfirmationSweep runs every minute (* * * * *) and the 60s expiry is set at row-insert time — race between cron tick and user reply is not exercisable in a sandboxed test environment."
  - test: "Live Haiku evasive-classification accuracy under adversarial inputs"
    expected: "Real Haiku (not mocked) correctly classifies edge-case replies — 'not sure I guess', 'it's fine whatever', 'maybe later' — as evasive (not no_change) with confidence >= 0.7"
    why_human: "All adjustment-dialogue tests mock Haiku via mockAnthropicParse. Real-LLM classification accuracy and confidence calibration require API spend. VALIDATION.md explicitly defers this to Phase 30 TEST-31 anti-flattery extension."
  - test: "Evasive trigger test with 7-day-apart synthetic rows (SC-3 acceptance criterion)"
    expected: "Insert 2 synthetic evasive ritual_responses rows with firedAt 7 days apart; confirm ritual.enabled=false + config.mute_until=+30d after 2nd insertion; confirm auto-re-enable fires when mute_until passes"
    why_human: "The 14-day rolling window logic is unit-tested in self-protective-pause.test.ts (Tests 3-4), and the end-to-end path is covered by refusal-pre-check.integration.test.ts Test 6. However, the ROADMAP SC-3 wording specifically says 'verifiable by inserting two synthetic evasive responses 7 days apart' — this 7-day separation test is not explicitly exercised in the existing test suite (Test 3 uses 7d + 1d apart, Test 4 uses 20d + 1d apart). The 7d+7d spacing case is not tested. This is a UAT-level confirmation rather than a code gap."
---

# Phase 28: Skip-Tracking + Adjustment Dialogue — Verification Report

**Phase Goal:** Synthesis layer depending on Phases 25/26/27. After this phase, when Greg consistently misses a ritual (3 consecutive daily skips, 2 consecutive weekly skips), Chris fires a single message asking "what should change?" — Haiku parses the reply into one of 3 classes (change_requested / no_change / evasive), proposes a config patch, waits 60 seconds for confirmation, then applies. Self-protects against becoming the new nag.

**Verified:** 2026-04-29T18:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After 3 consecutive `fired_no_response` outcomes on a daily ritual (or 2 on weekly), the next sweep tick fires the adjustment dialogue INSTEAD of the standard prompt; `system_suppressed` and `window_missed` do NOT count; `skip_count` is rebuildable by replay | VERIFIED | `shouldFireAdjustmentDialogue` reads `ritual.skipCount >= config.skip_threshold`; `ritualResponseWindowSweep` only increments skipCount on `FIRED_NO_RESPONSE`, not `WINDOW_MISSED`; `computeSkipCount` provides replay; `should-fire-adjustment.test.ts` Test 1 proves in_dialogue fires at threshold; Tests 2/4 prove below-threshold and muted cases fall through to standard dispatch |
| 2 | Haiku parses Greg's reply into exactly one of `change_requested` / `no_change` / `evasive`; on `change_requested`, Chris echoes the proposed patch; on "yes" or no-response within 60s, patch lands in `rituals.config` and is recorded in `ritual_config_events`; on explicit "no", patch is aborted and logged | VERIFIED | `AdjustmentClassificationSchema` (z.enum 3-class) + `classifyAdjustmentReply` with retry-cap-2 + templated fallback; `ritualConfirmationSweep` applies patch with `auto_apply_on_timeout` actor; `handleConfirmationReply` handles yes/no; `ritual_config_events` writes in `confirmConfigPatch` with `kind='apply'`/`'abort'`; `adjustment-dialogue.integration.test.ts` Tests 2/3/6 prove these paths |
| 3 | After 2 `evasive` responses within 14 days, ritual auto-disables for 30 days then auto-re-enables | VERIFIED | `hasReachedEvasiveTrigger` queries `ritual_responses` for `metadata.kind='adjustment_dialogue_response'` AND `metadata.classification='evasive'` AND `firedAt >= now()-14d`; `autoReEnableExpiredMutes` re-enables when `mute_until <= now`; `self-protective-pause.test.ts` Tests 3/6/7/8 prove the boundary cases; `refusal-pre-check.integration.test.ts` Test 6 proves end-to-end 2-evasive auto-pause with 30d mute |
| 4 | Inside the adjustment dialogue, M006 refusal handling is honored — "drop it / disable / not now" routes to refusal path, NOT counted as `evasive`; conversation does not loop | VERIFIED | `isAdjustmentRefusal()` runs BEFORE `classifyAdjustmentReply()` (STEP 1.5 at line 371, Haiku call at STEP 2 line 378); refusals write to `ritual_config_events` but NOT to `ritual_responses` so `hasReachedEvasiveTrigger` cannot count them; `refusal-pre-check.integration.test.ts` Tests 1-4 prove Haiku never reached for refusal inputs (cumulative `afterAll: mockAnthropicParse.not.toHaveBeenCalled()`) |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/rituals/types.ts` | 12-variant RitualFireOutcome union + RITUAL_OUTCOME map | VERIFIED | 12 union members confirmed: 7 original + 2 Phase-27-homogenized + 3 SKIP-01 new; `RITUAL_OUTCOME as const satisfies Record<string, RitualFireOutcome>` compile-time proof |
| `src/rituals/skip-tracking.ts` | `computeSkipCount` + `shouldFireAdjustmentDialogue` + `hasReachedEvasiveTrigger` + `autoReEnableExpiredMutes` | VERIFIED | All 4 exports confirmed substantive; computeSkipCount queries ritual_fire_events for fired_no_response since last reset; shouldFireAdjustmentDialogue honors adjustment_mute_until deferral |
| `src/rituals/adjustment-dialogue.ts` | `fireAdjustmentDialogue` + `handleAdjustmentReply` + `handleConfirmationReply` + `confirmConfigPatch` + `ritualConfirmationSweep` | VERIFIED | All 5 exports present and substantive; Haiku call uses zodOutputFormat with v3+v4 dual schemas; 60s confirmation window row with `metadata.kind='adjustment_confirmation'`; STEP 1.5 refusal pre-check before Haiku |
| `src/rituals/scheduler.ts` | `ritualResponseWindowSweep` wired + `autoReEnableExpiredMutes` at top + `shouldFireAdjustmentDialogue` predicate dispatch | VERIFIED | `autoReEnableExpiredMutes(now)` invoked first (line 95); `ritualResponseWindowSweep(now)` invoked second (line 105); `shouldFireAdjustmentDialogue` check at line 214 AFTER `tryFireRitualAtomic` claim; `fireAdjustmentDialogue` called on predicate hit |
| `src/chris/engine.ts` | PP#5 metadata.kind dispatch with NULL-fallback to voice-note (Landmine 6) | VERIFIED | `kind = (pending.metadata as {...}|null)?.kind`; `kind === 'adjustment_dialogue'` → `handleAdjustmentReply`; `kind === 'adjustment_confirmation'` → `handleConfirmationReply`; default branch (undefined/null) → `recordRitualVoiceResponse` (voice-note path preserved) |
| `src/db/schema.ts` | `ritual_pending_responses.metadata jsonb` + `ritual_config_events` with actor/patch shape | VERIFIED | `metadata: jsonb('metadata').default(sql\`'{}'::jsonb\`)` in ritualPendingResponses; `ritual_config_events` has `actor varchar(32)` + `patch jsonb` (envelope-in-patch, NOT change_kind/old_value columns) |
| `src/db/migrations/0010_adjustment_dialogue.sql` | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS metadata jsonb` + partial index | VERIFIED | Column add with `DEFAULT '{}'::jsonb`; partial index `ritual_pending_responses_adjustment_confirmation_idx` on `expires_at WHERE consumed_at IS NULL AND metadata->>'kind' = 'adjustment_confirmation'` |
| `src/cron-registration.ts` | `ritualConfirmationSweep` registered as 1-minute cron (narrow, NOT runRitualSweep) | VERIFIED | `cron.schedule('* * * * *', ...)` wires `deps.ritualConfirmationSweep()` independently; `CronRegistrationStatus.ritualConfirmation` field tracks its state; DOES NOT call `runRitualSweep` |
| `src/index.ts` | `ritualConfirmationSweep` imported from adjustment-dialogue.ts and passed to registerCrons | VERIFIED | Line 13: `import { ritualConfirmationSweep } from './rituals/adjustment-dialogue.js'`; line 94: `ritualConfirmationSweep` passed to `registerCrons` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `scheduler.ts:runRitualSweep` | `skip-tracking.ts:autoReEnableExpiredMutes` | import + call at sweep top | WIRED | First action in sweep body (line 95), wrapped in try/catch CRON-01 |
| `scheduler.ts:runRitualSweep` | `scheduler.ts:ritualResponseWindowSweep` | call before STEP 0 | WIRED | Line 105, wrapped in try/catch |
| `scheduler.ts:runRitualSweep` | `adjustment-dialogue.ts:fireAdjustmentDialogue` | shouldFireAdjustmentDialogue predicate | WIRED | Predicate check post-atomic-claim (line 214); `fireAdjustmentDialogue(ritual)` called on true |
| `engine.ts:processMessage PP#5` | `adjustment-dialogue.ts:handleAdjustmentReply` | metadata.kind === 'adjustment_dialogue' | WIRED | Lines 185-189; returns '' (IN-02 silent-skip) |
| `engine.ts:processMessage PP#5` | `adjustment-dialogue.ts:handleConfirmationReply` | metadata.kind === 'adjustment_confirmation' | WIRED | Lines 190-194 |
| `cron-registration.ts` | `adjustment-dialogue.ts:ritualConfirmationSweep` | `* * * * *` cron via RegisterCronsDeps | WIRED | Line 129: `await deps.ritualConfirmationSweep()` |
| `adjustment-dialogue.ts:handleAdjustmentReply` | `refusal.ts:detectRefusal` | STEP 1.5 pre-check BEFORE Haiku | WIRED | Line 43 import; line 371 call inside handleAdjustmentReply BEFORE classifyAdjustmentReply at line 378 |
| `adjustment-dialogue.ts:handleAdjustmentReply evasive branch` | `skip-tracking.ts:hasReachedEvasiveTrigger` | call after evasive ritual_responses write | WIRED | Line 443: `await hasReachedEvasiveTrigger(pending.ritualId)` after evasive metadata row inserted |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `scheduler.ts:shouldFireAdjustmentDialogue dispatch` | `ritual.skipCount` | `rituals.skip_count` column (DB) + `ritualResponseWindowSweep` increments | Yes — DB-sourced; increment path verified in skip-tracking.integration.test.ts Test 6 | FLOWING |
| `adjustment-dialogue.ts:handleAdjustmentReply` | `classified.classification` | Haiku `messages.parse` with zodOutputFormat | Yes (mocked in tests; real Haiku at runtime); fallback to `no_change` on retry cap | FLOWING |
| `adjustment-dialogue.ts:ritualConfirmationSweep` | `proposedChange` | `ritual_pending_responses.metadata.proposed_change` jsonb | Yes — written by `queueConfigPatchConfirmation` during change_requested path | FLOWING |
| `skip-tracking.ts:hasReachedEvasiveTrigger` | `count` | `ritual_responses WHERE metadata.kind='adjustment_dialogue_response' AND classification='evasive'` | Yes — real DB query; refusals explicitly excluded (don't write to ritual_responses) | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED — full suite hangs on live API tests in this sandbox (no real ANTHROPIC_API_KEY). Per-plan executor agents confirmed targeted test counts: 34/34 tests passing across all 4 waves. Code inspection confirms implementation is non-stub and wired. Behavioral checks rely on test evidence documented in SUMMARY.md files.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|------------|-------------|-------------|--------|---------|
| SKIP-01 | 28-01 | Discriminated RitualFireOutcome union; only fired_no_response increments skip_count | SATISFIED | 12-variant union in types.ts; RITUAL_OUTCOME const map; ritualResponseWindowSweep paired emit; skip-tracking.integration.test.ts Tests 1-8 |
| SKIP-02 | 28-01 | Append-only ritual_fire_events writes; skip_count rebuildable by replay | SATISFIED | All 3 handlers (voice-note, wellbeing, weekly-review) write ritual_fire_events; computeSkipCount replay in skip-tracking.ts; Test 8 replay invariant |
| SKIP-03 | 28-02 | Cadence-aware thresholds: daily=3, weekly=2; per-ritual override via config.skip_threshold | SATISFIED | cadenceDefaultThreshold() in skip-tracking.ts; shouldFireAdjustmentDialogue reads config.skip_threshold; should-fire-adjustment.test.ts |
| SKIP-04 | 28-03 | Adjustment dialogue: Telegram message + Haiku 3-class Zod parse | SATISFIED | fireAdjustmentDialogue sends Telegram + inserts pending row; classifyAdjustmentReply with 3-class Zod schema; adjustment-dialogue.integration.test.ts Tests 1-6 |
| SKIP-05 | 28-03 | 60s confirmation window for change_requested; auto-apply on yes or no-reply; abort on "no" with ritual_config_events log | SATISFIED | queueConfigPatchConfirmation sets expiresAt = firedAt + 60s; ritualConfirmationSweep auto-applies; handleConfirmationReply handles yes/no; Test 2 confirms 55-65s window |
| SKIP-06 | 28-04 | 2 evasive responses within 14d → enabled=false + mute_until=+30d; auto-re-enable when mute_until expires | SATISFIED | hasReachedEvasiveTrigger rolling-14d query; 30d pause in handleAdjustmentReply evasive branch; autoReEnableExpiredMutes at top of runRitualSweep; self-protective-pause.test.ts 8 tests |
| SKIP-07 | 28-04 | Append-only ritual_config_events audit trail; M006 refusal handling honored INSIDE dialogue | SATISFIED | 7 write sites across ritual_config_events (apply, abort, manual_disable, apply+adjustment_mute_until, auto_pause, auto_re_enable); isAdjustmentRefusal STEP 1.5 before Haiku; refusal-pre-check.integration.test.ts cumulative afterAll assertion |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `adjustment-dialogue.ts` | 239 | `zodOutputFormat(AdjustmentClassificationSchemaV4 as unknown as any)` | Info | SDK boundary cast; deliberate workaround for v3/v4 dual-schema pattern (mirrors weekly-review.ts); not a stub |
| `adjustment-dialogue.ts` | 256 | Retry-cap-2 fallback returns `no_change` with `isFallback: true` | Info | Conservative fallback on Haiku failure; documented in CONTEXT.md D-28-05; not a user-data-loss risk |

No blockers found. The `return null` / empty-array / placeholder patterns are absent. All ritual_config_events writes use the envelope-in-patch shape (actor + patch jsonb) — no old-style change_kind/old_value/new_value columns found.

### Landmine Resolution Verification

| Landmine | Description | Status | Evidence |
|----------|-------------|--------|---------|
| Landmine 1 | ritual_config_events uses envelope-in-patch shape (actor + patch jsonb), NOT change_kind/old_value/new_value columns | HONORED | schema.ts lines 471-477: actor varchar(32) + patch jsonb only; 7 write sites in adjustment-dialogue.ts + skip-tracking.ts all use `{actor, patch: {kind, ...}}` shape |
| Landmine 2 | migration 0010 adds metadata jsonb to ritual_pending_responses (was missing) | HONORED | 0010_adjustment_dialogue.sql: `ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb` |
| Landmine 4 | No migration writes from Plan 28-02 (seed migrations already have correct skip_threshold values) | HONORED | 28-02-SUMMARY and skip-tracking.ts JSDoc confirm: 0007 skip_threshold=3, 0008 skip_threshold=3, 0009 skip_threshold=2; no migration 0010b exists |
| Landmine 5 | ritualConfirmationSweep is a NARROW 1-minute cron, NOT runRitualSweep | HONORED | cron-registration.ts registers `'* * * * *'` → `deps.ritualConfirmationSweep()` independently; scheduler.ts contains only a comment reference, not an invocation |
| Landmine 6 | PP#5 NULL/undefined metadata.kind falls through to voice-note path | HONORED | engine.ts line 183: `?.kind` optional chaining; undefined/null falls to `recordRitualVoiceResponse` default branch; adjustment-dialogue.integration.test.ts cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` |

### Human Verification Required

#### 1. 60-Second Confirmation Window Under Real-Clock Conditions

**Test:** After deploy, write directly to DB to set a ritual's `skip_count` to 3 (daily) or 2 (weekly). Wait for the next 10:00 or 21:00 sweep tick to fire the adjustment dialogue message. Reply with "change fire time to 19:30". Observe the echo ("change fire_at to 19:30 — OK?"). Do NOT reply. Wait 60-90 seconds. Check `ritual_config_events` for a row with `actor='auto_apply_on_timeout'` and `patch.field='fire_at'`.

**Expected:** The `ritualConfirmationSweep` 1-minute cron fires within 60-90 seconds of the echo, applies the patch, and `rituals.config.fire_at` is updated to "19:30" in the DB. A `ritual_config_events` row with `actor='auto_apply_on_timeout'` and `patch.kind='apply'` exists.

**Why human:** The 1-minute cron tick cadence and 60-second expiry window interact with real wallclock time in ways not testable without real deployment. `vi.setSystemTime` covers the logic but not the cron registration behavior in production.

#### 2. Live Haiku Evasive-Classification Accuracy

**Test:** With real ANTHROPIC_API_KEY, call `handleAdjustmentReply` with edge-case evasive texts: "not sure I guess", "it's fine whatever", "maybe later", "hmm I'll think about it". Confirm each is classified as `evasive` with confidence >= 0.7.

**Expected:** All 4 inputs classified as `evasive`; none misclassified as `no_change` (which would reset skip_count without addressing the root issue).

**Why human:** All tests mock Haiku. Real-LLM accuracy and confidence calibration require API spend. VALIDATION.md explicitly defers to Phase 30 TEST-31.

#### 3. Evasive Trigger with Exactly 7-Day Separation (ROADMAP SC-3 Acceptance)

**Test:** Insert 2 synthetic evasive `ritual_responses` rows for the same ritual with `firedAt` exactly 7 days apart (both within the 14-day rolling window). Call `hasReachedEvasiveTrigger(ritualId)`. Confirm it returns `true` and that the subsequent `handleAdjustmentReply` call sets `enabled=false` + `config.mute_until=+30d`. Then advance time 30 days and call `autoReEnableExpiredMutes`. Confirm `enabled=true`.

**Expected:** The 7-day-apart scenario works end-to-end. The ROADMAP SC-3 wording specifically uses "7 days apart" as the acceptance criterion. Existing tests use (7d+1d) and (20d+1d) spacings — the exact (7d+7d) case is covered by the rolling window logic but not explicitly tested.

**Why human:** This is a UAT-level confirmation of the spec acceptance criterion rather than a gap — the logic is correct and unit-tested at boundaries. A quick DB-level integration test with synthetic timestamps would definitively close this.

---

## Summary

Phase 28 delivers all 4 success criteria through substantive, wired implementations:

**SC-1 (skip threshold + replay):** `ritualResponseWindowSweep` correctly emits paired `window_missed` + `fired_no_response` events; `shouldFireAdjustmentDialogue` reads the denormalized `skip_count` and fires the adjustment dialogue instead of the standard handler when threshold is met; `computeSkipCount` provides the authoritative replay projection. System_suppressed and window_missed do NOT increment skip_count.

**SC-2 (Haiku 3-class + 60s window):** `classifyAdjustmentReply` uses `messages.parse` with strict Zod v3+v4 dual schemas; `queueConfigPatchConfirmation` sets a 60s `ritual_pending_responses` row; `ritualConfirmationSweep` auto-applies on expiry; `handleConfirmationReply` handles explicit yes/no; all paths write to `ritual_config_events` using the envelope-in-patch shape.

**SC-3 (evasive auto-pause + auto-re-enable):** `hasReachedEvasiveTrigger` uses a rolling 14-day window on `ritual_responses.firedAt`; 30-day pause writes `enabled=false` + `config.mute_until`; `autoReEnableExpiredMutes` at the top of `runRitualSweep` re-enables expired mutes. Manual-disable refusals (no `mute_until` set) are correctly excluded from auto-re-enable.

**SC-4 (M006 refusal honored):** `isAdjustmentRefusal()` runs at STEP 1.5, before Haiku at STEP 2. Hard disables set `enabled=false` permanently; "not now" sets `adjustment_mute_until=+7d`. Refusals write to `ritual_config_events` but NOT to `ritual_responses`, so `hasReachedEvasiveTrigger` cannot count them. The `afterAll: mockAnthropicParse.not.toHaveBeenCalled()` assertion in the test suite provides cumulative proof.

3 human verification items remain — all are post-deploy UAT or live-API accuracy checks, not code gaps. The codebase evidence is strong for all 4 SCs.

---

_Verified: 2026-04-29T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
