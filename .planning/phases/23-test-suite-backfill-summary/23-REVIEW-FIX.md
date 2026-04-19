---
phase: 23-test-suite-backfill-summary
fixed_at: 2026-04-18T00:00:00Z
review_path: .planning/phases/23-test-suite-backfill-summary/23-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 5
skipped: 3
status: all_fixed
---

# Phase 23: Code Review Fix Report

**Fixed at:** 2026-04-18
**Source review:** `.planning/phases/23-test-suite-backfill-summary/23-REVIEW.md`
**Iteration:** 1

**Summary:**
- In-scope findings (warnings): 3
- Fixed: 5 (all 3 warnings + IN-03 + IN-04)
- Skipped: 3 info (IN-01 key_quotes fixture — non-trivial; IN-02 mock-isolation guard — non-trivial; IN-05 pre-existing out of Phase 23 scope)

## Fixed Issues

### WR-01: `/summary` accepts calendar-invalid ISO dates

**Files modified:** `src/bot/handlers/summary.ts`, `src/bot/handlers/__tests__/summary.test.ts`
**Commit:** `2f6de7d`
**Applied fix:** After the `ISO_DATE.test(after)` regex passes, round-trip through `DateTime.fromISO(after, { zone: 'utc' }).isValid` (mirroring `scripts/backfill-episodic.ts:98-102`). On invalid calendar date, reply with the same usage help as the non-ISO garbage branch (operator UX consistency — the user gets the format hint the reviewer asked for, not a generic error). Added test case (f) asserting `/summary 2026-02-30` → usage help and verifies reply does NOT contain "no summary" / "hasn't happened". 6 summary tests pass (5 existing + 1 new).

### WR-02: `runBackfill` ConsolidateResult discriminated-union fall-through

**Files modified:** `scripts/backfill-episodic.ts`
**Commit:** `2ab4e64`
**Applied fix:** Added an `else` branch after the three `else if` shape checks. Unknown shapes are now counted as errored and logged at error level with the full payload, so Phase 21 contract drift surfaces immediately. Maintains the `total === inserted + skipped + errored` invariant. 3 backfill tests pass unchanged.

### WR-03: live-anti-flattery hard-coded Paris UTC offset

**Files modified:** `src/episodic/__tests__/live-anti-flattery.test.ts`
**Commit:** `7fe9324`
**Applied fix:** Replaced the hard-coded `utcHour = hourLocal - 1` with Luxon's `DateTime.fromObject({ year, month, day, hour }, { zone: config.proactiveTimezone }).toJSDate()`. Now correct for any IANA tz Luxon recognizes (Tokyo / NY / etc.), not just Europe/*. Also strengthened the beforeAll probe: construct a Luxon DateTime for the fixture date and assert `isValid` (catches tz typos early).

File is in the 5-file excluded-suite mitigation list (`skipIf(!ANTHROPIC_API_KEY)`; TEST-22 runs only with a real key). TS compile verifies no regression.

### IN-03: Dead `afterEach(vi.useRealTimers)` hook in synthetic-fixture

**Files modified:** `src/episodic/__tests__/synthetic-fixture.test.ts`
**Commit:** `2274117`
**Applied fix:** Replaced the no-op `vi.useRealTimers()` (D-02 forbids `vi.useFakeTimers` here) with `vi.setSystemTime(new Date())` to defensively restore real wall-clock reads between tests. Trivial cleanup.

### IN-04: Backfill fixture `importance: 3 + dayIndex` at risk of exceeding Zod max(10)

**Files modified:** `src/episodic/__tests__/backfill.test.ts`
**Commit:** `2274117`
**Applied fix:** Clamped to `Math.min(3 + dayIndex, 10)`. No-op today (3-day fixture produces 3/4/5), but prevents silent breakage if future work extends FIXTURE_DATES to 8+ days.

## Skipped Issues

### IN-01: Empty `key_quotes` in backfill fixture makes CONS-10 regressions invisible

**Reason:** Requires seeding real key_quotes strings for at least day 0 and adding an assertion on `rows[0].keyQuotes` — not trivial. Reviewer: "deliberately out of this plan's scope (TEST-21 covers the CONS-10 contract in the synthetic fixture)." Out of scope for warning-focused pass.

### IN-02: live-anti-flattery missing `mockAnthropicParse` guard

**Reason:** Reviewer: "Mitigated in practice because vitest's per-file module graph resets vi.mock calls, but a defensive assertion would catch any future vitest config change." Pure defensive hardening; not an active bug. Out of scope.

### IN-05: `ERROR_FALLBACK[lang ?? 'English']` unreachable-else in bot.ts (pre-existing)

**Reason:** Reviewer explicitly scoped this OUT: "This is pre-existing code, not modified by Phase 23 (only the +5 lines at L10/L32 are new), so out-of-scope for this review." Out of scope by the reviewer's own framing.

---

_Fixed: 2026-04-18_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
