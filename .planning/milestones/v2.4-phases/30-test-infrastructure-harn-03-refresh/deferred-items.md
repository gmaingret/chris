# Phase 30 Deferred Items

Out-of-scope discoveries during plan execution. Logged per executor scope boundary
(deviation_rules: only auto-fix issues directly caused by current task's changes).

## Pre-existing wellbeing.test.ts Test 6 + Test 7 failures (Plan 30-02)

**Discovered during:** Plan 30-02 Task 1 verification run (helper extraction
refactor on wellbeing.test.ts).

**Symptom:** `bash scripts/test.sh src/rituals/__tests__/wellbeing.test.ts`
reports 2 failures:
- Test 6 ("third-dim tap completes snapshot — writes wellbeing_snapshots + clears
  keyboard + emits wellbeing_completed") — `expect(event!.outcome).toBe('wellbeing_completed')`
  receives `'fired'`.
- Test 7 ("skip button writes adjustment_eligible: false + emits wellbeing_skipped
  + does NOT increment skip_count") — `expect(event!.outcome).toBe('wellbeing_skipped')`
  receives `'fired'`.

**Root cause hypothesis:** Tests query the FIRST `ritual_fire_events` row for the
test ritual, but `fireWellbeing` emits a `'fired'` event before the callback
handler emits `'wellbeing_completed'` / `'wellbeing_skipped'`. The single-row
SELECT returns the earlier `'fired'` event. Likely needs `.orderBy(desc(firedAt))`
+ `.limit(1)` or filtering by outcome to assert the LATER event.

**Confirmed pre-existing on main:** Verified via `git stash && bash scripts/test.sh ...`
on commit `171a624` (HEAD before Plan 30-02 work) — same 2 failures, same line
numbers, same assertion shape. NOT introduced by Plan 30-02 Task 1's helper
extraction refactor.

**Why deferred:** Per deviation_rules SCOPE BOUNDARY: "Only auto-fix issues
DIRECTLY caused by the current task's changes. Pre-existing warnings, linting
errors, or failures in unrelated files are out of scope." Plan 30-02's owned
file is `synthetic-fixture.test.ts`; `wellbeing.test.ts` is touched only for the
mechanical helper-extraction refactor (no behavioral change). The test 6/7
failures are about the wellbeing handler's emit-ordering contract, which is
Phase 27 substrate — orthogonal to Plan 30-02.

**Recommended owner:** Future Phase 32 substrate-hardening plan (alongside the
already-flagged backlog items for fixture quality), OR a Phase 27 follow-up if
Greg sees wellbeing event emissions misbehaving in prod.
