---
phase: 28-skip-tracking-adjustment-dialogue
plan: "04"
subsystem: rituals
requirements-completed: [SKIP-06, SKIP-07]
tags: [rituals, skip-tracking, refusal, self-protective-pause, audit-trail, m006-refusal, m009]

dependency-graph:
  requires:
    - 28-01 (ritual_fire_events substrate + ritualResponseWindowSweep)
    - 28-02 (computeSkipCount + shouldFireAdjustmentDialogue predicate)
    - 28-03 (handleAdjustmentReply + Haiku 3-class + 60s confirmation window)
  provides:
    - M006 refusal pre-check (STEP 1.5 before Haiku in handleAdjustmentReply)
    - self-protective 30-day auto-pause on 2 evasive responses in 14d
    - auto-re-enable when mute_until expires (autoReEnableExpiredMutes in runRitualSweep)
    - ritual_config_events audit trail for all config mutations (envelope-in-patch shape)
  affects:
    - scheduler.ts (autoReEnableExpiredMutes at top of runRitualSweep)
    - adjustment-dialogue.ts (refusal pre-check + evasive trigger)
    - skip-tracking.ts (hasReachedEvasiveTrigger + autoReEnableExpiredMutes)

tech-stack:
  added: []
  patterns:
    - M006 refusal pre-check using detectRefusal (refusal.ts) + adjustment-specific extension
    - hasReachedEvasiveTrigger rolling-14d window query on ritual_responses.firedAt
    - autoReEnableExpiredMutes SQL cast (config->>'mute_until')::timestamptz for null-exclusion
    - envelope-in-patch ritual_config_events shape (RESEARCH Landmine 1 compliance)
    - Broader "not now" pattern (ADJUSTMENT_NOT_NOW_PATTERN) for adjustment dialogue context

key-files:
  created:
    - src/rituals/__tests__/self-protective-pause.test.ts (8 tests — SKIP-06 boundary cases)
    - src/rituals/__tests__/refusal-pre-check.integration.test.ts (6 tests — SKIP-07 + positive control)
  modified:
    - src/rituals/skip-tracking.ts (+ hasReachedEvasiveTrigger + autoReEnableExpiredMutes)
    - src/rituals/adjustment-dialogue.ts (+ isAdjustmentRefusal + routeRefusal + STEP 1.5 + evasive trigger)
    - src/rituals/scheduler.ts (+ autoReEnableExpiredMutes invocation at top of runRitualSweep)

decisions:
  - "Use ritual_responses.firedAt (not createdAt) for the 14-day rolling window in hasReachedEvasiveTrigger — firedAt is semantically correct ('when did this dialogue exchange happen') and testable (set explicitly at INSERT, unlike createdAt which is always DB now())"
  - "Add ADJUSTMENT_NOT_NOW_PATTERN (broader regex) for 'not now please' etc. — refusal.ts uses standalone-only regex (/not now$/) but the adjustment dialogue context must handle trailing words like 'please'"
  - "ritualConfigEvents writes use envelope-in-patch shape throughout — actor varchar(32) + patch jsonb with discriminated kind field — per RESEARCH Landmine 1 (no change_kind/old_value/new_value top-level columns)"
  - "Manual_disable (refusal route) sets enabled=false WITHOUT mute_until — autoReEnableExpiredMutes SQL NULL exclusion ensures these are NEVER auto-re-enabled (permanent until operator action)"

metrics:
  duration: "53 minutes (1777540885 → 1777544085)"
  completed: "2026-04-30"
  tasks: 3
  files: 5
---

# Phase 28 Plan 04: Refusal Pre-Check + Self-Protective Pause + Audit Trail Summary

**One-liner:** M006 refusal pre-check (STEP 1.5 before Haiku) + self-protective 30-day auto-pause (2 evasive in 14d) + auto-re-enable at sweep top + ritual_config_events audit trail using envelope-in-patch shape.

## What Was Built

### Task 1: hasReachedEvasiveTrigger + autoReEnableExpiredMutes (skip-tracking.ts)

Extended `src/rituals/skip-tracking.ts` with two new exports:

**`hasReachedEvasiveTrigger(ritualId)`** — queries `ritual_responses` for `metadata.kind='adjustment_dialogue_response'` AND `metadata.classification='evasive'` within a rolling 14-day window (using `firedAt` as the anchor). Returns `true` when count >= 2. Refusals NEVER write to `ritual_responses`, so they cannot accidentally trigger this counter (separation invariant for SKIP-06).

**`autoReEnableExpiredMutes(now)`** — scans `rituals WHERE enabled=false AND (config->>'mute_until')::timestamptz <= now`. The SQL `::timestamptz` cast returns NULL for absent/null `mute_until` values; `NULL <= now` is falsy, so manual_disable rituals (no `mute_until`) are correctly excluded. For each expired mute: sets `enabled=true`, clears `mute_until` via `jsonb_set`, writes `ritual_config_events` with `actor='system'` + `patch.kind='auto_re_enable'`. Returns count of re-enabled rituals.

Test file: 8 tests covering all boundary cases including the critical Test 7 (manual_disable does NOT auto-re-enable).

### Task 2: Refusal Pre-Check + Evasive Trigger (adjustment-dialogue.ts)

Extended `src/rituals/adjustment-dialogue.ts` with:

**`isAdjustmentRefusal(text)`** — combines `detectRefusal()` (15 EN + 14 FR + 14 RU patterns) with adjustment-specific extensions:
- `ADJUSTMENT_DISABLE_PATTERN`: `/\b(disable|deactivate|turn\s+off)\b/i` (not in general refusal.ts since 'disable' could mean other things outside adjustment dialogue)
- `ADJUSTMENT_NOT_NOW_PATTERN`: `/\bnot\s+(?:now|today|right\s+now)\b/i` (broader than refusal.ts standalone-only regex to handle "not now please" etc.)

Distinguishes hard-disable ("drop it" / "disable") from deferral ("not now").

**`routeRefusal(ritualId, refusal, text)`** — routes based on `refusal.isHardDisable` vs `refusal.isNotNow`:
- Hard disable: `UPDATE rituals SET enabled=false` + `ritual_config_events` with `actor='adjustment_dialogue_refusal'` + `patch.kind='manual_disable'`
- Not now: `jsonb_set(config, '{adjustment_mute_until}', +7d)` + `ritual_config_events` with `patch.kind='apply'` + `patch.field='adjustment_mute_until'`

**STEP 1.5 (Pitfall 2 invariant)** — inserted in `handleAdjustmentReply` BETWEEN atomic-consume STEP 1 and Haiku classification STEP 2. Refusals short-circuit via `routeRefusal()` and return early — never reaching `classifyAdjustmentReply()`.

**Evasive branch extension** — after writing the `metadata.classification='evasive'` row to `ritual_responses`, calls `hasReachedEvasiveTrigger(pending.ritualId)`. On `true`: sets `enabled=false` + `config.mute_until=+30d` + writes `ritual_config_events` with `actor='system'` + `patch.kind='auto_pause'`.

Test file: 6 tests in 2 describe blocks. Describe 1 (Tests 1-4) has cumulative `afterAll: mockAnthropicParse.not.toHaveBeenCalled()` — the LOAD-BEARING Pitfall 2 invariant proof.

### Task 3: Wire autoReEnableExpiredMutes into runRitualSweep (scheduler.ts)

Inserted `autoReEnableExpiredMutes(now)` call at the very top of `runRitualSweep`, BEFORE `ritualResponseWindowSweep`. The new invocation order:

1. `logger.info('rituals.sweep.start')`
2. `autoReEnableExpiredMutes(now)` ← NEW Plan 28-04
3. `ritualResponseWindowSweep(now)` ← Plan 28-01
4. STEP 0: channel-cap check
5. ... existing flow

Wrapped in `try/catch` with `logger.error('rituals.auto_re_enable.error')` (CRON-01 belt-and-suspenders — failure does not block dispatch path).

## Test Results

| Test File | Tests | Result |
|-----------|-------|--------|
| self-protective-pause.test.ts | 8 | All pass |
| refusal-pre-check.integration.test.ts | 6 | All pass |
| adjustment-dialogue.integration.test.ts | 6 | All pass (Plan 28-03 regression) |
| scheduler.test.ts | 10 | All pass (regression) |
| should-fire-adjustment.test.ts | 4 | All pass (regression) |
| **Total** | **34** | **34/34** |

## ritual_config_events Audit Trail

5 write sites across Plans 28-03 + 28-04:

| actor | patch.kind | Trigger | File |
|-------|------------|---------|------|
| `user` | `apply` | Greg says "yes" to confirmation | adjustment-dialogue.ts (confirmConfigPatch) |
| `auto_apply_on_timeout` | `apply` | 60s window expires, patch auto-applied | adjustment-dialogue.ts (ritualConfirmationSweep) |
| `user` | `abort` | Greg says "no" to confirmation | adjustment-dialogue.ts (handleConfirmationReply) |
| `adjustment_dialogue_refusal` | `manual_disable` | Greg says "drop it"/"disable" | adjustment-dialogue.ts (routeRefusal) |
| `adjustment_dialogue_refusal` | `apply` | Greg says "not now" | adjustment-dialogue.ts (routeRefusal) |
| `system` | `auto_pause` | 2 evasive responses in 14d | adjustment-dialogue.ts (handleAdjustmentReply evasive branch) |
| `system` | `auto_re_enable` | mute_until expired | skip-tracking.ts (autoReEnableExpiredMutes) |

Total: >= 7 actor/patch.kind write sites covering full SKIP-07 audit trail requirement.

## Commits

| Hash | Description |
|------|-------------|
| `eb6469f` | test(28-04): add failing tests for self-protective pause (RED phase) |
| `d33d312` | feat(28-04): extend skip-tracking.ts with hasReachedEvasiveTrigger + autoReEnableExpiredMutes (SKIP-06) |
| `060902e` | test(28-04): add failing tests for refusal pre-check integration (RED phase) |
| `858c3a7` | feat(28-04): extend adjustment-dialogue.ts with refusal pre-check + evasive-trigger handling (SKIP-06 + SKIP-07) |
| `473cce3` | feat(28-04): wire autoReEnableExpiredMutes at top of runRitualSweep (SKIP-06) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Rolling window uses firedAt instead of createdAt for hasReachedEvasiveTrigger**
- **Found during:** Task 1 (Test 4 failed on first run)
- **Issue:** Plan specified `gte(ritualResponses.createdAt, fourteenDaysAgo)`. But `createdAt` is set by `defaultNow()` — the DB inserts the current timestamp regardless of the row's semantic date. Test 4 seeded an "evasive" row with `firedAt = 20 days ago` but `createdAt = now`, so the 14-day window incorrectly counted it.
- **Fix:** Changed to `gte(ritualResponses.firedAt, fourteenDaysAgo)`. This is semantically correct: `firedAt` is "when the ritual dialogue fired and this evasive response was recorded" — the right anchor for "did this happen within 14 days?"
- **Files modified:** src/rituals/skip-tracking.ts
- **Commit:** d33d312

**2. [Rule 2 - Missing critical functionality] ADJUSTMENT_NOT_NOW_PATTERN for broader "not now" handling**
- **Found during:** Task 2 (Test 3 failed — "not now please" didn't match refusal.ts's standalone regex)
- **Issue:** Plan's test input was "not now please". The `detectRefusal()` function uses `/^(?!...)\s*not\s+(?:now|today|right\s+now)\s*[.!?]?\s*$/i` (standalone-only — requires end-of-string anchor). "not now please" has trailing "please" that violates the `$` anchor.
- **Fix:** Added `ADJUSTMENT_NOT_NOW_PATTERN = /\bnot\s+(?:now|today|right\s+now)\b/i` as an adjustment-specific extension. In the adjustment dialogue context, "not now please" clearly means deferral — the broader pattern is correct and appropriate (per PATTERNS.md §C principle).
- **Files modified:** src/rituals/adjustment-dialogue.ts
- **Commit:** 858c3a7

**3. [Rule 1 - Bug] Missing ritualFireEvents deletion in refusal-pre-check test cleanup**
- **Found during:** Task 2 (FK constraint violation during cleanup)
- **Issue:** The cleanup function in `refusal-pre-check.integration.test.ts` deleted `ritualConfigEvents`, `ritualResponses`, `ritualPendingResponses`, `rituals` but forgot `ritualFireEvents`. The no_change evasive path in `handleAdjustmentReply` writes `ritual_fire_events` rows, violating the FK constraint when deleting `rituals`.
- **Fix:** Added `await db.delete(ritualFireEvents).where(inArray(ritualFireEvents.ritualId, seededRitualIds))` to the cleanup function.
- **Files modified:** src/rituals/__tests__/refusal-pre-check.integration.test.ts
- **Commit:** 858c3a7

## Known Stubs

None — all data paths are wired to real DB operations.

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced beyond those documented in the plan's `<threat_model>`.

## Self-Check: PASSED

**Files exist:**
- src/rituals/__tests__/self-protective-pause.test.ts: FOUND
- src/rituals/__tests__/refusal-pre-check.integration.test.ts: FOUND
- src/rituals/skip-tracking.ts: FOUND
- src/rituals/adjustment-dialogue.ts: FOUND
- src/rituals/scheduler.ts: FOUND

**Commits exist:**
- eb6469f: FOUND
- d33d312: FOUND
- 060902e: FOUND
- 858c3a7: FOUND
- 473cce3: FOUND

**Key invariants verified:**
- `grep -E "^export (async )?function" src/rituals/skip-tracking.ts | wc -l` → 5 (Plan 28-02's 3 + 2 new)
- `grep -c "detectRefusal" src/rituals/adjustment-dialogue.ts` → 5 (>= 2 required)
- `grep -c "hasReachedEvasiveTrigger" src/rituals/adjustment-dialogue.ts` → 6 (>= 2 required)
- `grep -c "autoReEnableExpiredMutes" src/rituals/scheduler.ts` → 2 (1 import + 1 invocation)
- Zero `change_kind:` column-style writes (RESEARCH Landmine 1 compliance confirmed)
