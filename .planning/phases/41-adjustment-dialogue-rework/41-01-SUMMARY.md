---
phase: 41-adjustment-dialogue-rework
plan: 01
subsystem: rituals
tags:
  - rituals
  - adjustment-dialogue
  - p0-live-bug
  - skip-tracking
requirements: [ADJ-01, ADJ-02, ADJ-04]
files_created:
  - src/rituals/display-names.ts
files_modified:
  - src/rituals/adjustment-dialogue.ts
  - src/rituals/skip-tracking.ts
  - src/rituals/__tests__/adjustment-dialogue.integration.test.ts
  - src/rituals/__tests__/self-protective-pause.test.ts
key-decisions:
  - "Use TS constant map (not DB column) for ritual + config-field display names (D-41-03)"
  - "BL-01 EN observational copy variant ('I noticed we've missed...') over REQUIREMENTS.md exemplar (D-41-02)"
  - "Four db.transaction-wrapped completion sites: handleConfirmationReply yes/no, routeRefusal hard-disable/not-now (D-41-05)"
  - "skipCount=0 merged into existing SET clause in autoReEnableExpiredMutes (single UPDATE)"
  - "RESPONDED fire-event paired with each skipCount reset so computeSkipCount replay stays consistent"
metrics:
  duration: 13_minutes
  completed_date: "2026-05-15"
  task_count: 3
  file_count: 4
---

# Phase 41 Plan 01: Live-UX + skip_count Reset Summary

**One-liner:** Ship the observational copy + display-name substitution + 4-site skip_count reset to stop the every-tick re-fire bug on Greg's account at 2026-05-14 17:00 Paris.

## What was built

Three tasks, three files modified, one file created, two test files updated to match new copy.

### Task 1 — display-names.ts (NEW)
`src/rituals/display-names.ts` with `RITUAL_DISPLAY_NAMES` (3 ritual slugs × 3 locales) + `CONFIG_FIELD_LABELS` (3 fields × 3 locales) + `displayName` / `configFieldLabel` helpers with `?? slug` fallback. EN slot per CLAUDE.md `feedback_evening_journal_naming` (daily_journal → "evening journal"). Plan 41-01 consumes only the English slot; Plan 41-02 wires FR/RU consumption.

### Task 2 — adjustment-dialogue.ts (MODIFIED)
Five edit clusters in 1 file:
- **Cluster A** (imports): added `displayName` + `configFieldLabel` from `./display-names.js`.
- **Cluster B** (fireAdjustmentDialogue): dropped cadence ternary; replaced "isn't working" with BL-01 observational copy. Metadata `cadence: ritual.type` (forward-compat), `ritualName: dispName` (display string).
- **Cluster C** (handleConfirmationReply yes-branch): `db.transaction` wraps `confirmConfigPatch` + skipCount reset + RESPONDED `user_yes` fire-event. Applied ack uses `configFieldLabel`.
- **Cluster D** (handleConfirmationReply no-branch): `db.transaction` wraps abort insert + skipCount reset + RESPONDED `user_no` fire-event. Keeping-as-is ack uses `configFieldLabel`.
- **Cluster E** (routeRefusal both branches): `db.transaction` wraps single UPDATE with `skipCount=0` merged into existing SET + RESPONDED `user_drop_it_or_disable` / `user_not_now` fire-event.
- L733 confirmation echo uses `configFieldLabel`.

L471 auto_pause sendMessage left unchanged in Plan 41-01 (no slug leak in EN copy); Plan 41-02 adds the displayName substitution for FR/RU naturalness.

### Task 3 — skip-tracking.ts (MODIFIED)
`autoReEnableExpiredMutes` now resets `skipCount=0` in the same SET clause as `enabled=true` + `config.mute_until=null` (single UPDATE), and emits a paired `RESPONDED` fire-event with `metadata.source='auto_re_enable'`. The 4-row per-iteration batch (UPDATE → fire-event INSERT → config-event INSERT → log) is processed independently per row (existing JSDoc invariant preserved).

## Canonical EN copy (Plan 41-02 mirrors these across FR/RU)

| Site | EN copy |
|------|---------|
| Fire-side prompt | `I noticed we've missed the ${displayName} a few times. Want to adjust something, or keep it as is?` |
| Hard-disable ack | `OK, disabling this ritual. You can re-enable it manually anytime.` |
| Not-now ack | `OK, I'll skip the adjustment dialogue for 7 days. Skip-tracking continues.` |
| Auto-pause msg | `Pausing this ritual for 30 days — feels like the timing isn't right. It will auto-re-enable on ${date}.` |
| Yes-applied ack | `Applied: ${configFieldLabel} = ${new_value}` |
| No-keeping ack | `OK, keeping ${configFieldLabel} as is` |
| Confirmation echo | `Change ${configFieldLabel} to ${new_value} — OK? (auto-applies in 60s if no reply)` |

## ADJ-04 completion sites + metadata.source discriminators

| Site | Location | metadata.source |
|------|----------|-----------------|
| 1 | handleConfirmationReply yes-branch | `user_yes` |
| 2 | handleConfirmationReply no-branch | `user_no` |
| 3 | routeRefusal hard_disable | `user_drop_it_or_disable` |
| 4 | routeRefusal not_now | `user_not_now` |
| 5 (Task 3) | autoReEnableExpiredMutes | `auto_re_enable` |

Existing pre-Phase-41 sites preserved:
- `no_change` Haiku branch (line ~402): RESPONDED with `classification: 'no_change'`
- `ritualConfirmationSweep` (line ~700): RESPONDED with `source: 'auto_apply_on_timeout'`

Total `skipCount: 0` occurrences in `adjustment-dialogue.ts` after Plan 41-01: **6** (4 new + 2 pre-existing, per PLAN-CHECK WARNING-1).

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 - Blocking] self-protective-pause.test.ts cleanup FK violation**
- Found during: Task 3 verification
- Issue: `cleanFixtures()` didn't delete from `ritualFireEvents` — the new RESPONDED emission from `autoReEnableExpiredMutes` creates a fire-event row that FK-references the ritual being deleted, blocking cleanup.
- Fix: add `await db.delete(ritualFireEvents).where(inArray(ritualFireEvents.ritualId, seededRitualIds))` to `cleanFixtures()` before the rituals delete. Imported `ritualFireEvents` from `../../db/schema.js`.
- Files modified: `src/rituals/__tests__/self-protective-pause.test.ts`
- Commit: `6ade27b`

**2. [PLAN-CHECK WARNING-2 inline] adjustment-dialogue.integration.test.ts assertion updates**
- Found during: Task 2 implementation (anticipated by plan-checker)
- Issue: line 113 (`toContain('daily')`) and line 178 (`toContain('fire_at')`) would deterministically fail after the cadence prefix removal + configFieldLabel substitution.
- Fix: line 113 → `toContain("I noticed we've missed")`; line 178 → `toContain('fire time')`. Kept FIXTURE_RITUAL_NAME assertion (the slug falls back through displayName's `?? slug` path).
- Files modified: `src/rituals/__tests__/adjustment-dialogue.integration.test.ts`
- Commit: `a032353` (Task 2 commit)

### PLAN-CHECK warnings addressed

- **WARNING-1** (count miscount): confirmed 6 total `skipCount: 0` occurrences (2 pre-existing + 4 new), not the plan's stated 5. Test suite passes; no action needed beyond noting the correct number in this summary.
- **WARNING-2** (test update wording): treated as required, not conditional. Fixed inline (see Deviation 2 above).

## Test-suite delta

| Test file | Change |
|-----------|--------|
| `adjustment-dialogue.integration.test.ts` | 2 assertion updates (copy literals) — 6/6 still pass |
| `self-protective-pause.test.ts` | Cleanup helper extended for new ritual_fire_events FK — 8/8 still pass |
| `synthetic-fixture.test.ts` | TEST-27 copy assertion updated (commit `f3bb8ad`, separate from Plan 41-01) — 6/6 still pass |

## Per-task commits

| Task | Commit | Files |
|------|--------|-------|
| 1 | `066224d` | `src/rituals/display-names.ts` |
| 2 | `a032353` | `src/rituals/adjustment-dialogue.ts`, `.../adjustment-dialogue.integration.test.ts` |
| 3 | `6ade27b` | `src/rituals/skip-tracking.ts`, `.../self-protective-pause.test.ts` |

## Self-Check: PASSED

- `src/rituals/display-names.ts` exists.
- Commit `066224d` exists.
- Commit `a032353` exists.
- Commit `6ade27b` exists.

## DEPLOYED

- [ ] Container rebuilt + redeployed to Proxmox
- [ ] Smoke test: force a threshold-hit on a test ritual, observe fire-side message renders observational copy with `evening journal` (not `daily daily_journal`)
- [ ] Smoke test: reply yes/no/drop-it/not-now through Telegram; verify `skip_count=0` after each via psql
- [ ] Smoke test: query `ritual_fire_events` for new `metadata.source` rows
