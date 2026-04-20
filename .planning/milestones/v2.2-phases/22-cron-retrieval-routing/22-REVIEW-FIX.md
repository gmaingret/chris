---
phase: 22-cron-retrieval-routing
fixed_at: 2026-04-18T00:00:00Z
review_path: .planning/phases/22-cron-retrieval-routing/22-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 4
status: all_fixed
---

# Phase 22: Code Review Fix Report

**Fixed at:** 2026-04-18
**Source review:** `.planning/phases/22-cron-retrieval-routing/22-REVIEW.md`
**Iteration:** 1

**Summary:**
- In-scope findings (warnings): 5
- Fixed: 5 (all warnings)
- Skipped: 4 info items (non-trivial refactors or doc-only drift)

## Fixed Issues

### WR-01: Never-throw contract leaks on invalid IANA tz

**Files modified:** `src/pensieve/retrieve.ts`, `src/episodic/cron.ts`
**Commit:** `9eb4ea2`
**Applied fix:** Moved `formatLocalDate` (retrieve.ts) and `computeYesterday` (cron.ts) computations INSIDE each function's try/catch. Also moved the `episodic.cron.invoked` info log inside the try in `runConsolidateYesterday` so operators get the "cron did fire" signal even if the tz is misconfigured. The catch block logs the partial computation state (empty strings pre-assignment) so tz-config errors are distinguishable from DB errors.

### WR-02: Timezone alignment mismatch for negative-offset zones

**Files modified:** `src/chris/modes/date-extraction.ts`
**Commit:** `869d8c6`
**Applied fix:** Anchor all extracted dates at `T12:00:00Z` (noon UTC) instead of `T00:00:00Z` (midnight UTC) across `matchIsoDate`, `matchRelativeAgo`, `matchMonthDay`, and the Haiku fallback. Noon UTC buys ±12h of tz slack so downstream consumers formatting back to `config.proactiveTimezone` via `Intl.DateTimeFormat` resolve the same calendar day in every IANA tz. Existing 16 date-extraction tests still pass (`isoDay(result).slice(0,10)` is stable at 12:00 UTC).

### WR-03: FR/RU month-day regex lacks leading word boundary

**Files modified:** `src/chris/modes/date-extraction.ts`, `src/chris/__tests__/date-extraction.test.ts`
**Commit:** `3fb33af`
**Applied fix:** Prepend `\b` to both the FR and RU day-digit capture groups so embedded digit clusters like `121 décembre` no longer silently match `21 décembre`. Added 2 regression tests (FR + RU) with the reviewer's exact fixture text.

### WR-04: `matchMonthDay` silently accepts invalid day-of-month via overflow

**Files modified:** `src/chris/modes/date-extraction.ts`, `src/chris/__tests__/date-extraction.test.ts`
**Commit:** `869d8c6` (source) + `3fb33af` (tests)
**Applied fix:** After `new Date(Date.UTC(year, monthIdx, day, 12))`, assert `d.getUTCMonth() === monthIdx && d.getUTCDate() === day`. Feb 30 / April 31 are now rejected instead of silently normalizing to March 2 / May 1. Added 2 regression tests.

### WR-05: `vi.useFakeTimers` in beforeEach with no afterEach restore

**Files modified:** `src/pensieve/__tests__/routing.test.ts`
**Commit:** `b70c617`
**Applied fix:** Added `afterEach(() => vi.useRealTimers())` alongside the existing beforeEach. Imported `afterEach` from vitest. 22 routing tests still pass.

## Skipped Issues

### IN-01: `DAYS_PER_UNIT` uses 30-day months / 365-day years (approximation drift)

**File:** `src/chris/modes/date-extraction.ts:69-71`
**Reason:** Refactor to use Luxon for calendar-month subtraction is non-trivial behavior change. Reviewer flagged "probably tolerable... Non-blocking". Out of scope.

### IN-02: `matchMonthDay` accepts arbitrarily-far-future years

**File:** `src/chris/modes/date-extraction.ts:181, 185`
**Reason:** Reviewer: "downstream... ageDays negative → no injection (benign)... mainly a robustness concern if the extractor ever feeds a non-defensive consumer." Non-blocking. Out of scope.

### IN-03: Phase 22-02 SUMMARY claims 15 VERBATIM_KEYWORDS; file has 14

**File:** Planning SUMMARY
**Reason:** Documentation drift in planning artifact, not a source bug. Out of scope for code-review-fix.

### IN-04: `ageDays` computation duplicated in interrogate.ts + routing.ts

**File:** `src/chris/modes/interrogate.ts:72-74` vs `src/pensieve/routing.ts:85-89`
**Reason:** Refactor (export + consume across modules). Non-trivial; affects public API of routing.ts. Reviewer: "Low priority; flagged for consistency". Out of scope.

---

_Fixed: 2026-04-18_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
