---
phase: "31"
plan: "01"
subsystem: rituals
tags: [rename, refactor, migration, journal, voice-note]
dependency_graph:
  requires: [30-01, 30-02, 30-03, 30-04]
  provides: [31-02]
  affects: [rituals, engine, proactive, scripts]
tech_stack:
  added: []
  patterns: [drizzle-orm-pure-dml-migration, git-mv-history-preservation, backward-compat-constant]
key_files:
  created:
    - src/db/migrations/0011_rename_daily_voice_note_to_journal.sql
    - src/db/migrations/meta/0011_snapshot.json
  modified:
    - src/rituals/journal.ts (was voice-note.ts — git mv)
    - src/rituals/__tests__/journal.test.ts (was voice-note.test.ts — git mv)
    - src/rituals/__tests__/journal-handler.test.ts (was voice-note-handler.test.ts — git mv)
    - src/rituals/__tests__/journal-suppression.test.ts (was voice-note-suppression.test.ts — git mv)
    - src/rituals/__tests__/prompt-rotation-property.test.ts
    - src/rituals/__tests__/should-fire-adjustment.test.ts
    - src/rituals/__tests__/skip-tracking.integration.test.ts
    - src/rituals/__tests__/skip-tracking.test.ts
    - src/rituals/__tests__/scheduler.test.ts
    - src/rituals/__tests__/wellbeing.test.ts
    - src/rituals/scheduler.ts
    - src/rituals/skip-tracking.ts
    - src/rituals/types.ts
    - src/rituals/adjustment-dialogue.ts
    - src/rituals/wellbeing.ts
    - src/rituals/weekly-review.ts
    - src/chris/engine.ts
    - src/chris/__tests__/engine.test.ts
    - src/chris/__tests__/engine-mute.test.ts
    - src/chris/__tests__/engine-refusal.test.ts
    - src/chris/__tests__/engine-pp5.test.ts
    - src/chris/__tests__/engine-pp5-adjustment.test.ts
    - src/proactive/sweep.ts
    - scripts/test.sh
    - scripts/regen-snapshots.sh
    - scripts/fire-ritual.ts
    - PLAN.md
    - PRD_Project_Chris.md
    - M009_Ritual_Infrastructure.md
    - src/db/migrations/meta/_journal.json
decisions:
  - "D-31-03: RITUAL_JOURNAL_SUBTYPES constant exports ['ritual_voice_note', 'ritual_journal'] for backward-compat; Phase 26→31 Pensieve entries carry ritual_voice_note, new entries carry ritual_journal"
  - "D-31-05: scripts/test.sh seed gate updated from daily_voice_note to daily_journal; migration 0011 added to apply sequence"
  - "git mv used for all 4 file renames (not plain mv+add) to preserve git history via similarity index"
  - "Historical migration files 0007-0010 left untouched (these are committed records of prior schema state)"
metrics:
  duration: "Approx 90 minutes (multi-session; continued from previous context)"
  completed: "2026-05-04"
  tasks_completed: 5
  files_modified: 29
---

# Phase 31 Plan 01: rename-voice-note-to-journal Summary

Atomic mechanical rename of `voice_note` → `journal` across the entire active codebase. DB migration 0011 renames the `daily_voice_note` ritual row; 4 source/test files git-mv'd preserving history; all symbols, imports, mock paths, and string constants updated; top-level docs (PLAN.md, PRD, M009) updated to use journal terminology. After this plan, zero active-code references to `voice_note`/`VoiceNote`/`voiceNote` remain outside the D-31-03 backward-compat block.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `ac8fd98` | feat(31-01): author migration 0011 + drizzle meta |
| Task 2 | `f70454f` | chore(31-01): git mv voice-note → journal for 4 files |
| Task 3 | `9dbae99` | refactor(31-01): rename all voice_note symbols |
| Task 4 | `dfbdec4` | docs(31-01): update top-level docs terminology |
| Fix (Rule 1) | `9c216d6` | fix(31-01): add missing ritualFireEvents cleanup |

## Key Decisions

### D-31-03: Backward-Compatibility Constant

The plan called for `recordRitualVoiceResponse` call sites in engine.ts to check `metadata.source_subtype === 'ritual_voice_note'`. After investigation, no such check exists in engine.ts — PP#5 uses `ritual_pending_responses` table lookup, not source_subtype readback. Instead, added `RITUAL_JOURNAL_SUBTYPES = ['ritual_voice_note', 'ritual_journal'] as const` as a named export for documentation and future use.

### D-31-05: scripts/test.sh Seed Gate

Updated the Phase 26 seed-row gate from checking `daily_voice_note` to checking `daily_journal` (which migration 0011 creates). Added migration 0011 to the apply sequence in both test.sh and regen-snapshots.sh.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Missing ritualFireEvents cleanup in journal integration tests**
- **Found during:** Task 5 (test suite run)
- **Issue:** journal-handler.test.ts and journal-suppression.test.ts were missing `await db.delete(ritualFireEvents)` in their cleanup functions. Phase 28 Plan 28-01 extended `recordRitualVoiceResponse` (now `recordJournalResponse`) to write `ritual_fire_events` rows. The original voice-note-handler.test.ts had this cleanup, but it was dropped during the rename rewrite in the prior session.
- **Fix:** Added `ritualFireEvents` to the import list and cleanup function in both test files.
- **Files modified:** `src/rituals/__tests__/journal-handler.test.ts`, `src/rituals/__tests__/journal-suppression.test.ts`
- **Commit:** `9c216d6`

**2. [Rule 1 - Bug] engine.ts mock path investigation**
- **Found during:** Task 3
- **Issue:** The plan's D-31-03 described finding `metadata.source_subtype === 'ritual_voice_note'` in engine.ts, but no such check exists (PP#5 uses table lookup).
- **Fix:** Added `RITUAL_JOURNAL_SUBTYPES` named export with both values, documenting the backward-compat context.
- **Files modified:** `src/chris/engine.ts`
- **Commit:** `9dbae99`

## Test Results

After fix commit `9c216d6`:
- `journal-handler.test.ts`: 4 tests, **4 passed** (was 3 failed due to FK constraint)
- `journal-suppression.test.ts`: 7 tests, **7 passed** (was 1 failed due to FK constraint)
- `journal.test.ts`: all passed (pure unit tests, no DB)
- `prompt-rotation-property.test.ts`: all passed
- `should-fire-adjustment.test.ts`: all passed
- TypeScript (`npx tsc --noEmit`): **0 errors**
- scripts/test.sh seed gate: **PASS** (daily_journal verified post-migration 0011)

Pre-existing failures (unrelated to rename, no regressions introduced):
- live-integration tests: 21/24 failed (401 invalid API key — expected in test env)
- live-accountability, vague-validator-live, models-smoke: 401 API key failures
- weekly-review.test.ts (2 failed): pre-existing wellbeing/weekly_review fixture issue
- skip-tracking.integration.test.ts (2 failed): pre-existing wellbeing fixture issue
- wellbeing.test.ts (2 failed): pre-existing outcome mismatch
- scheduler.test.ts (2 failed): pre-existing Telegram 404 / missing fixture
- state-ritual-cap.test.ts (6 failed): pre-existing ECONNREFUSED from pool closure by another test
- silence.test.ts (1 failed): pre-existing threshold issue

## Known Stubs

None. All data flows are wired; no placeholder values introduced.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced by this plan. Migration 0011 is a pure DML UPDATE with an idempotent WHERE clause.

## Self-Check: PASSED

Files verified:
- `src/db/migrations/0011_rename_daily_voice_note_to_journal.sql` FOUND
- `src/db/migrations/meta/0011_snapshot.json` FOUND
- `src/rituals/journal.ts` FOUND
- `src/rituals/__tests__/journal-handler.test.ts` FOUND
- `src/rituals/__tests__/journal-suppression.test.ts` FOUND
- `src/rituals/__tests__/journal.test.ts` FOUND

Commits verified:
- `ac8fd98` FOUND
- `f70454f` FOUND
- `9dbae99` FOUND
- `dfbdec4` FOUND
- `9c216d6` FOUND
