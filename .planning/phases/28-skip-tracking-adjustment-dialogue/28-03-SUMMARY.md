---
phase: 28-skip-tracking-adjustment-dialogue
plan: "03"
subsystem: rituals
requirements-completed: [SKIP-04, SKIP-05]
tags: [rituals, skip-tracking, adjustment-dialogue, llm-haiku, confirmation-window, migration-0010, m009]
dependency-graph:
  requires: [28-01, 28-02]
  provides: [adjustment-dialogue-handler, haiku-3-class, confirmation-window-60s, migration-0010]
  affects: [engine-pp5, scheduler, cron-registration]
tech-stack:
  added: []
  patterns:
    - Haiku 3-class structured output via messages.parse + zodOutputFormat (v3+v4 dual schema)
    - Atomic-consume UPDATE...WHERE consumed_at IS NULL RETURNING for race-safe confirmation
    - DB-row + 1-minute cron sweep for 60s confirmation window (NOT setTimeout)
    - ritual_config_events discriminated envelope inside patch jsonb (Landmine 1 resolution)
    - PP#5 metadata.kind dispatch with NULL/undefined kind fallthrough to voice-note
key-files:
  created:
    - src/db/migrations/0010_adjustment_dialogue.sql
    - src/db/migrations/meta/0010_snapshot.json
    - src/rituals/adjustment-dialogue.ts
    - src/rituals/__tests__/adjustment-dialogue.integration.test.ts
    - src/rituals/__tests__/confirmation-window.test.ts
    - src/chris/__tests__/engine-pp5-adjustment.test.ts
  modified:
    - src/db/migrations/meta/_journal.json
    - src/db/schema.ts
    - scripts/test.sh
    - src/chris/engine.ts
    - src/rituals/scheduler.ts
    - src/cron-registration.ts
    - src/index.ts
    - src/rituals/__tests__/cron-registration.test.ts
    - src/rituals/__tests__/should-fire-adjustment.test.ts
    - src/chris/__tests__/engine-pp5.test.ts
decisions:
  - "ritual_config_events writes use discriminated envelope inside patch jsonb (not top-level change_kind/old_value columns per CONTEXT.md D-28-09 which was incorrect — RESEARCH Landmine 1)"
  - "ritualConfirmationSweep interface type is () => Promise<number | void> to accommodate real function return type"
  - "confirmation-window.test.ts Test 9 uses pre-expired timestamp (not vi.useFakeTimers) because fake timers break async DB operations"
  - "should-fire-adjustment.test.ts and engine-pp5.test.ts cleanup extended to delete ritualPendingResponses/ritualFireEvents after Plan 28-01/03 wrote to those tables"
metrics:
  duration: "~33 minutes"
  completed: "2026-04-29"
  tasks-completed: 5
  files-created: 6
  files-modified: 10
---

# Phase 28 Plan 03: Adjustment Dialogue + Haiku 3-class + 60s Confirmation Window Summary

## One-liner

JWT-style adjustment-dialogue handler: Haiku 3-class classifier with v3+v4 dual Zod schema, retry-cap-2 templated fallback, 60s DB-row confirmation window with atomic-consume race-safety, PP#5 metadata.kind dispatch preserving voice-note default path.

## What was built

### Task 1: Migration 0010 (metadata jsonb on ritual_pending_responses)

- `0010_adjustment_dialogue.sql`: `ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb` + partial index `ritual_pending_responses_adjustment_confirmation_idx`
- `0010_snapshot.json`: drizzle-kit meta snapshot re-chained from 0009 (id re-generated, prevId = 0009's id), reconciled with drizzle-kit's exact `where` clause format
- `_journal.json`: idx=10 entry added
- `schema.ts`: `metadata: jsonb('metadata').default(sql\`'{}'::jsonb\`)` + index on ritualPendingResponses

HARD CO-LOC #7: SQL migration + drizzle meta snapshot + journal + schema.ts mirror all shipped in same task.

### Task 2 [BLOCKING]: scripts/test.sh extension + Docker gate

- `MIGRATION_10_SQL` constant + psql apply line added
- Phase 28 substrate gate: checks both metadata column AND adjustment_confirmation partial index
- Verified: `✓ Phase 28 migration 0010 substrate verified (metadata column + adjustment_confirmation partial index)` on fresh Docker postgres

### Task 3: adjustment-dialogue.ts (SKIP-04 + SKIP-05)

5 exported functions:
- `fireAdjustmentDialogue(ritual)`: Telegram message → ritualPendingResponses insert with `metadata.kind='adjustment_dialogue'` → ritualFireEvents IN_DIALOGUE
- `handleAdjustmentReply(pending, chatId, text)`: atomic-consume → Haiku 3-class → branch on classification (change_requested/no_change/evasive)
- `handleConfirmationReply(pending, chatId, text)`: atomic-consume → yes/no parse → apply/abort with ritualConfigEvents write
- `confirmConfigPatch(ritualId, proposedChange, actor)`: jsonb_set config + ritualConfigEvents discriminated envelope write
- `ritualConfirmationSweep(now)`: narrow helper scanning expired adjustment_confirmation rows with LIMIT 10 DoS cap

Key patterns:
- Haiku classification: v3+v4 dual schema (AdjustmentClassificationSchema + AdjustmentClassificationSchemaV4), retry-cap-2, templated fallback to 'no_change' on exhaustion
- Confidence-default-evasive: `confidence < 0.7` overrides to 'evasive' (CONTEXT.md spec)
- Field whitelist: `z.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until'])` — T-28-02 mitigation
- Zero setTimeout (D-28-06): all confirmation tracking via DB row + cron sweep

Tests: 6/6 adjustment-dialogue.integration + 4/4 confirmation-window pass.

### Task 4: PP#5 metadata.kind dispatch in engine.ts (Pitfall 6 preserved)

Extended the `if (pending)` block with metadata.kind switch:
- `kind === 'adjustment_dialogue'` → `handleAdjustmentReply`
- `kind === 'adjustment_confirmation'` → `handleConfirmationReply`
- Default (kind undefined/null) → existing `recordRitualVoiceResponse` (voice-note path preserved)

Cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` across all 4 PP#5 HIT-path tests proves Sonnet never reached through any branch.

Also fixed `engine-pp5.test.ts` cleanup to include `ritualFireEvents` deletion (pre-existing regression from Plan 28-01 that now manifested in the test context).

### Task 5: Wire scheduler + 1-minute cron + index.ts call site

- `scheduler.ts`: replaced Plan 28-02 stub `outcome: 'in_dialogue'` with real `fireAdjustmentDialogue` call + error-catch fallback
- `cron-registration.ts`: `ritualConfirmationSweep` field in interface + status field `ritualConfirmation` + `'* * * * *'` cron registration
- `index.ts`: import `ritualConfirmationSweep` + pass to registerCrons deps
- `cron-registration.test.ts`: all registerCrons calls updated with `ritualConfirmationSweep` mock
- `should-fire-adjustment.test.ts`: cleanup extended to delete ritualPendingResponses (FK constraint fix after real fireAdjustmentDialogue inserts into it)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] drizzle-kit snapshot where clause format mismatch**
- **Found during:** Task 1, running `npx drizzle-kit generate`
- **Issue:** Hand-cloned 0010_snapshot.json had `where: '"consumed_at" IS NULL AND...'` but drizzle-kit generates `'"ritual_pending_responses"."consumed_at" IS NULL AND...'` (table-qualified). Caused drizzle-kit to detect a diff and generate 0011_aberrant_leopardon.sql.
- **Fix:** Read 0011_snapshot.json to extract the correct format, update 0010_snapshot.json where clause, delete 0011 files, remove 0011 journal entry. `npx drizzle-kit generate` then reports "No schema changes, nothing to migrate".
- **Files modified:** `src/db/migrations/meta/0010_snapshot.json`, `src/db/migrations/meta/_journal.json`

**2. [Rule 1 - Bug] vi.useFakeTimers() breaks async DB operations in Test 9**
- **Found during:** Task 3, confirmation-window.test.ts Test 9
- **Issue:** `vi.useFakeTimers()` intercepts Promise/setTimeout resolution, causing async DB queries to hang (5s timeout). Fake timer advancement doesn't propagate to real postgres.
- **Fix:** Seeded the confirmation row with already-expired `expiresAt` (1 minute ago), called `ritualConfirmationSweep(new Date())` where `new Date()` is naturally after expiry. No fake timers needed.

**3. [Rule 1 - Bug] engine-pp5.test.ts cleanup missing ritualFireEvents delete**
- **Found during:** Task 4, running engine-pp5.test.ts
- **Issue:** Plan 28-01 extended `recordRitualVoiceResponse` to write `ritualFireEvents`. The existing cleanup didn't delete from that table before deleting rituals, causing FK violations.
- **Fix:** Added `await db.delete(ritualFireEvents)` to cleanup in engine-pp5.test.ts.

**4. [Rule 1 - Bug] should-fire-adjustment.test.ts cleanup missing ritualPendingResponses delete**
- **Found during:** Task 5, running should-fire-adjustment tests after scheduler.ts change
- **Issue:** Plan 28-02's scheduler stub didn't insert into ritualPendingResponses. Plan 28-03's replacement calls real `fireAdjustmentDialogue` which does insert there. Cleanup lacked the delete.
- **Fix:** Added `ritualPendingResponses` import + `await db.delete(ritualPendingResponses).where(inArray(...))` to cleanFixtures.

**5. [Rule 1 - Bug] ritualConfirmationSweep interface type mismatch**
- **Found during:** Task 5, TypeScript check
- **Issue:** Interface declared `() => Promise<void>` but `ritualConfirmationSweep` returns `Promise<number>`.
- **Fix:** Updated interface to `() => Promise<number | void>`.

## Threat Model Mitigations

| Threat ID | Mitigation Delivered |
|-----------|---------------------|
| T-28-01 | ritual_fire_events server-side only; no direct user mutation |
| T-28-02 | field whitelist `z.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until'])` in AdjustmentClassificationSchema + AdjustmentClassificationSchemaV4 |
| T-28-03 | Atomic-consume on confirmationPending row in both handleConfirmationReply AND ritualConfirmationSweep |
| T-28-D3 | LIMIT 10 in ritualConfirmationSweep + partial index for sub-ms hot path |
| T-28-E3 | `enabled` excluded from field whitelist; only fire_at/fire_dow/skip_threshold/mute_until patchable |

## Known Stubs

None — all functions are fully implemented. `fireAdjustmentDialogue` sends real Telegram messages (mocked in tests). `handleAdjustmentReply` calls real Haiku (mocked in tests with `mockAnthropicParse`).

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes beyond those specified in the plan's threat model.

## Self-Check: PASSED

### Files verified

- FOUND: src/db/migrations/0010_adjustment_dialogue.sql
- FOUND: src/db/migrations/meta/0010_snapshot.json
- FOUND: src/rituals/adjustment-dialogue.ts
- FOUND: src/chris/__tests__/engine-pp5-adjustment.test.ts
- FOUND: src/rituals/__tests__/adjustment-dialogue.integration.test.ts
- FOUND: src/rituals/__tests__/confirmation-window.test.ts

### Commits verified

- FOUND: 4b1a4c2 (Task 1 — migration 0010)
- FOUND: 4883841 (Task 2 — scripts/test.sh gate)
- FOUND: d8956ce (Task 3 RED — failing tests)
- FOUND: 2c10d0e (Task 3 GREEN — adjustment-dialogue.ts)
- FOUND: f808281 (Task 4 — PP#5 engine.ts dispatch)
- FOUND: 4fcf857 (Task 5 — scheduler + cron + index.ts)

### Tests verified

- 6 test files, 25 tests — ALL PASSED (run: bash scripts/test.sh [6 files])
- adjustment-dialogue.integration.test.ts: 6/6 (fire-side, Haiku 3-class, retry-cap, fallback, evasive, low-confidence)
- confirmation-window.test.ts: 4/4 (yes/no/timeout/race)
- engine-pp5-adjustment.test.ts: 4/4 (default/null/adjustment_dialogue/confirmation)
- engine-pp5.test.ts: 3/3 (Phase 26 regression — voice-note path preserved)
- should-fire-adjustment.test.ts: 4/4 (Plan 28-02 test updated for real handler)
- cron-registration.test.ts: 4/4 (1-minute sweep registered)

### Acceptance criteria checks

- Zero setTimeout in adjustment-dialogue.ts: PASS
- 5 exported functions from adjustment-dialogue.ts: PASS
- No modifications to STATE.md or ROADMAP.md: PASS
