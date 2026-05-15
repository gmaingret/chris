---
phase: 42-atomicity-race-fixes
plan: 02
subsystem: rituals
tags: [atomicity, race, idempotency, jsonb, dst]
dependency_graph:
  requires: ["42-01"]
  provides: ["completeSnapshot completion-claim", "handleSkip jsonb_set + completion-claim", "findOpenWellbeingRow 24h window"]
  affects: ["src/rituals/wellbeing.ts", "src/rituals/__tests__/wellbeing.test.ts", "src/rituals/__tests__/synthetic-fixture.test.ts"]
tech_stack:
  added: []
  patterns: ["atomic completion-claim UPDATE on respondedAt IS NULL", "nested jsonb_set merge for skip path", "24h absolute-window WHERE clause for DST-edge defense"]
key_files:
  created: []
  modified:
    - src/rituals/wellbeing.ts
    - src/rituals/__tests__/wellbeing.test.ts
    - src/rituals/__tests__/synthetic-fixture.test.ts
decisions: ["D-42-06", "D-42-07", "D-42-08", "D-42-09", "D-42-10"]
metrics:
  duration_min: 25
  completed: "2026-05-15"
requirements: [RACE-03, RACE-04, RACE-05]
---

# Phase 42 Plan 02: Wave 2 — Wellbeing Race Fixes Summary

Closed the three wellbeing-path race surfaces in a single plan (they all live in `src/rituals/wellbeing.ts`):
- **RACE-03** rapid-tap duplicate-completion → atomic completion-claim UPDATE
- **RACE-04** skip-path full-object metadata overwrite → nested jsonb_set merge + completion-claim guard
- **RACE-05** findOpenWellbeingRow cross-DST match → 24h absolute-window AND-clause

## Task Outcomes

### Task 1 — RACE-03 + RACE-04 (wellbeing.ts)
- **Commit:** `8caca66` fix(42-02): RACE-03 + RACE-04 — wellbeing completion-claim + jsonb_set merge
- **RACE-03 (completeSnapshot):** Restructured to begin with atomic claim `UPDATE ritual_responses SET respondedAt = new Date() WHERE id = $1 AND respondedAt IS NULL RETURNING`. Three concurrent third-tap callbacks can no longer all reach the side-effect path — only the winner runs wellbeing_snapshots upsert + WELLBEING_COMPLETED fire_event + skip_count=0 UPDATE + editMessageText + answerCallbackQuery. Losers log DEBUG `rituals.wellbeing.completion_race_lost` and return silently.
- **RACE-04 (handleSkip):** (a) Same completion-claim guard as RACE-03 (two-way safety with a concurrent third-tap completion). (b) Full-object metadata overwrite replaced with nested `jsonb_set(jsonb_set(coalesce(metadata,'{}'::jsonb), '{skipped}', 'true'::jsonb, true), '{adjustment_eligible}', 'false'::jsonb, true)` — preserves any concurrent `metadata.partial.{e|m|a}` writes.
- **Imports:** `and` + `isNull` added to drizzle-orm import line in wellbeing.ts.

### Task 2 — RACE-05 + regression tests
- **Commit:** `e9d4073` fix(42-02): RACE-05 — findOpenWellbeingRow 24h window guard + RACE-03/04/05 tests
- **RACE-05 (findOpenWellbeingRow):** Added `AND ${ritualResponses.firedAt} >= now() - interval '24 hours'` AND-clause to the existing `date_trunc('day', fired_at AT TIME ZONE tz) = today::date` filter. Belt-and-suspenders defense — DST arithmetic cannot shift the absolute UTC clock cutoff, and wellbeing fires at 10:00 Paris (next fire always ≥22h away even under worst DST transition).
- **Test 5 tightened (RACE-03):** Three-way `runConcurrently(3, ...)` of dim taps; assertions added for EXACTLY ONE `wellbeing_completed` fire_event row AND EXACTLY ONE `editMessageText` call across all three contexts (proves the completion-claim UPDATE is the canonical idempotency key).
- **New Test 9 (RACE-04):** Tap `e=3` → skip; re-read row; assert `metadata.partial.e === 3` AND `metadata.skipped === true` AND `metadata.adjustment_eligible === false`. Proves nested jsonb_set merge does not full-object overwrite.
- **New Test 10 (RACE-05):** 25h-old open row (via `firedAt = now() - interval '25 hours'`) rejected by handler → `no_open_row` branch; 1h-old fresh open row accepted and tap lands. Proves the 24h cutoff is exercised.

## Verification

```
$ bash scripts/test.sh src/rituals/__tests__/wellbeing.test.ts
 Test Files  1 passed (1)
      Tests  10 passed (10)

$ bash scripts/test.sh src/rituals/__tests__/   # full rituals dir
 Test Files  22 passed | 1 skipped (23)
      Tests  220 passed | 1 skipped (221)
```

## Deviations from Plan

- **TEST-28 (synthetic-fixture.test.ts) fixture-alignment fix:** The RACE-05 24h filter rejected the fixture-window rows the test inserted via `vi.setSystemTime(fixture-date-30d-ago)`. The pre-RACE-05 test relied on the (only-JS-faked) `todayLocalDate()` matching the (only-JS-faked) `fired_at` via date_trunc. With the new 24h filter using postgres-real `now()`, those rows fail. Fixed by:
  - `vi.useRealTimers()` once at test start (prior tests' setSystemTime persists across tests in this describe block)
  - day0 = realTodayIso, day1 = realYesterdayIso
  - day0 row's fired_at bumped to `now()` (within 24h, date_trunc=today)
  - day1 row's fired_at bumped to `now() - interval '18 hours'` (within 24h, date_trunc=yesterday in Europe/Paris)
  Tracked as **Rule 1 — Bug** auto-fix (production code is correct; the test fixture pre-dated RACE-05's tighter contract). Commit `a6ec6f9`.

## Self-Check: PASSED

- `jsonb_set(jsonb_set` appears in `src/rituals/wellbeing.ts` (1 match — RACE-04 nested merge) ✓
- `isNull(ritualResponses.respondedAt)` appears in `src/rituals/wellbeing.ts` (2 matches — RACE-03 + RACE-04 claims) ✓
- `now() - interval '24 hours'` appears in `src/rituals/wellbeing.ts` (1 match in WHERE clause) ✓
- `RACE-0[345]` markers in wellbeing.test.ts: 12 occurrences ✓
- All commits (`8caca66`, `e9d4073`, `a6ec6f9`) present in `git log` ✓
- 10 wellbeing tests + 6 synthetic-fixture tests green under Docker harness ✓
