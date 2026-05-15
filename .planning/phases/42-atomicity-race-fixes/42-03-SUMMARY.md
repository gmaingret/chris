---
phase: 42-atomicity-race-fixes
plan: 03
subsystem: rituals
tags: [atomicity, race, transaction, telegram-send-failure]
dependency_graph:
  requires: ["42-01"]
  provides: ["fireWeeklyReview transactional send-then-bookkeep"]
  affects: ["src/rituals/weekly-review.ts", "src/rituals/__tests__/weekly-review.test.ts"]
tech_stack:
  added: []
  patterns: ["send-then-bookkeep with try/catch", "db.transaction paired bookkeep on success", "metadata.telegram_failed audit-row discriminator", "next_run_at revert on send failure"]
key_files:
  created: []
  modified:
    - src/rituals/weekly-review.ts
    - src/rituals/__tests__/weekly-review.test.ts
decisions: ["D-42-11", "D-42-12", "D-42-13"]
metrics:
  duration_min: 20
  completed: "2026-05-15"
requirements: [RACE-06]
---

# Phase 42 Plan 03: Wave 2 — Weekly-Review Transactional Fire Summary

Reordered `fireWeeklyReview` so Telegram send success gates the bookkeep atomically and Telegram send failure produces a single auditable failure row plus a `next_run_at` revert for retry on the next Sunday's sweep.

## Task Outcomes

### Task 1 — fireWeeklyReview transactional pipeline
- **Commit:** `b1034f8` fix(42-03): RACE-06 — transactional weekly-review fire pipeline (D-42-11)
- **Pre-RACE-06 ordering (buggy — silent weekly miss on transient send failure):**
  ```
  INSERT ritual_responses → Pensieve → UPDATE respondedAt → SEND → INSERT fire_event
  ```
- **New ordering (D-42-11):**
  1. Capture `previousNextRunAt = ritual.nextRunAt` BEFORE any work (D-42-13)
  2. INSERT ritual_responses (NO respondedAt yet)
  3. Persist Pensieve entry
  4. `bot.api.sendMessage(...)` wrapped in try/catch
  5a. **On success:** `db.transaction(async (tx) => { tx.update(respondedAt + pensieveEntryId) + tx.insert fire_event outcome='fired' })` — paired commit-or-rollback
  5b. **On failure:** INSERT fire_event 'fired' with `metadata.telegram_failed: true` + `db.update(rituals).set({nextRunAt: previousNextRunAt})` to revert + ERROR log `rituals.weekly.send_failed` + rethrow err (outer runRitualSweep per-row try/catch catches it). respondedAt stays NULL; Pensieve entry stays (acceptable orphan per D-42-11).

### Task 2 — RACE-06 regression test
- **Commit:** `2017212` test(42-03): RACE-06 regression — send-failure rollback contract
- **Test:** New test in the `fireWeeklyReview integration` describe block.
  - Seeds substrate to pass the sparse-data short-circuit.
  - Seeds a fixture ritual with known `originalNextRunAt = '2026-05-17T18:00:00Z'`.
  - Primes Sonnet + Stage-2-Haiku + date-grounding-Haiku for full success at LLM layer.
  - `mockSendMessage.mockRejectedValueOnce(new Error('429 Too Many Requests'))` — forces the only failure at the Telegram-send boundary.
  - Asserts `fireWeeklyReview` rethrows.
  - Asserts (a) `ritual_responses.respondedAt IS NULL` (b) exactly ONE `ritual_fire_events` row with `metadata.telegram_failed === true` (c) `rituals.nextRunAt` reverted to `originalNextRunAt` (d) Pensieve entry exists (orphan) (e) ERROR log `rituals.weekly.send_failed` payload includes `previousNextRunAt`.

## Verification

```
$ bash scripts/test.sh src/rituals/__tests__/weekly-review.test.ts
 Test Files  1 passed (1)
      Tests  32 passed (32)
```

## Deviations from Plan

- None — plan executed exactly as written.

## Self-Check: PASSED

- `previousNextRunAt` appears in `src/rituals/weekly-review.ts` (5 matches — capture + revert + log payload + comments) ✓
- `telegram_failed` appears in `src/rituals/weekly-review.ts` (3 matches — catch branch + comments) ✓
- `rituals.weekly.send_failed` log key present (1 match — ERROR log) ✓
- `db.transaction(async (tx)` present in fireWeeklyReview success branch (1 match) ✓
- `RACE-06` marker in weekly-review.test.ts (2 matches) ✓
- `mockRejectedValue` in weekly-review.test.ts (1 match — send-failure simulation) ✓
- All 32 weekly-review tests green under Docker harness ✓
- Commits (`b1034f8`, `2017212`) present in `git log` ✓
