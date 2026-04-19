---
phase: 23-test-suite-backfill-summary
reviewed: 2026-04-18T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - scripts/backfill-episodic.ts
  - src/bot/bot.ts
  - src/bot/handlers/summary.ts
  - src/bot/handlers/__tests__/summary.test.ts
  - src/episodic/__tests__/backfill.test.ts
  - src/episodic/__tests__/live-anti-flattery.test.ts
  - src/episodic/__tests__/synthetic-fixture.test.ts
findings:
  critical: 0
  warning: 3
  info: 5
  total: 8
status: findings
---

# Phase 23: Code Review Report

**Reviewed:** 2026-04-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** findings

## Summary

Phase 23 ships four coordinated artifacts: a 14-day synthetic episodic fixture
(TEST-15..TEST-21), a live anti-flattery test (TEST-22) against real Sonnet, the
OPS-01 backfill operator script, and the CMD-01 `/summary` Telegram handler.

The implementation is disciplined. Mocks are scoped, cleanup is scoped and
FK-safe, the ConsolidateResult shape is correctly reconciled against the
discriminated runtime contract (not the plan's looser pseudocode), D-29
(RETR-01 enforcement, no Drizzle bypass in summary.ts) holds, D-26 (command
registration before `bot.on('message:text')`) holds, and the CONS-03
short-circuit trap in the live anti-flattery test is correctly mitigated by
inter-run cleanup. The Pearson correlation math is textbook-correct. The
ISO_DATE anchor regex (`^\d{4}-\d{2}-\d{2}$`) is sound against smuggled tokens.

No security-critical issues found. Three warnings concern (1) a semantic-validation
gap where syntactically-valid-but-calendar-invalid dates (e.g. `2026-02-30`) silently
coerce to a neighboring day via `new Date()`, (2) an incomplete fall-through branch
in the backfill's ConsolidateResult handling, and (3) an unvalidated timezone
assumption in the live anti-flattery fixture. Info items cover test realism,
cleanup belt-and-suspenders, and minor ergonomics.

## Warnings

### WR-01: `/summary` accepts syntactically-valid-but-calendar-invalid dates and silently queries a different day

**File:** `src/bot/handlers/summary.ts:169, 188`
**Issue:** `ISO_DATE = /^\d{4}-\d{2}-\d{2}$/` only validates format, not calendar
validity. A user input like `/summary 2026-02-30` passes the regex, then
`new Date('2026-02-30T00:00:00Z')` silently coerces to `2026-03-02T00:00:00Z`.
The handler then calls `getEpisodicSummary` with March 2, and replies
`No summary for 2026-02-30` (the string the user typed) even though the DB
query actually ran for March 2. Similar: `2026-13-01`, `2026-04-31`,
`2026-02-29` in a non-leap year. Same issue on the future-date branch:
`isFutureDate('2026-02-30', 'Europe/Paris')` does a lexicographic compare
that says "past" (it is > some recent `todayInTz`), so the user gets the
"no summary" reply rather than usage help.

Not a security issue (no injection — the regex is anchored, and Drizzle uses
parameterized queries), but a correctness bug: the user is misled about what
was queried, and the message displays their nonexistent date as if it were
legitimate.

The backfill script (`scripts/backfill-episodic.ts:98-102`) does NOT have this
problem — it explicitly validates via `DateTime.fromISO(...).isValid` after
the regex, which catches `2026-02-30` correctly. The same second-step check
is missing here.

**Fix:**
```ts
// After the regex test, also verify calendar validity via Luxon (already a dep)
// or by round-tripping through Date and checking the reformatted string matches.
} else if (ISO_DATE.test(after)) {
  // Calendar-validity check — reject 2026-02-30 et al.
  const probe = new Date(`${after}T00:00:00Z`);
  const reformatted = probe.toISOString().slice(0, 10);
  if (Number.isNaN(probe.getTime()) || reformatted !== after) {
    await ctx.reply(MSG.usage[lang]);
    return;
  }
  targetDate = after;
}
```

Add a 6th test case to `summary.test.ts` covering `'2026-02-30'` → usage help.

### WR-02: `runBackfill` ConsolidateResult discriminated-union handling has a silent fall-through

**File:** `scripts/backfill-episodic.ts:186-211`
**Issue:** The three `else if` branches cover `'inserted'`, `'skipped'`, and
`'failed'`. If runConsolidate ever returns a shape that matches none of them
(future schema variation, partial object, engine refactor), the loop:

1. Increments `totals.total` (L168).
2. Enters the try block.
3. Matches NO branch → logs nothing, increments no counter.
4. Continues.

The aggregate then has `total > inserted + skipped + errored`, which is a
silent drift the operator cannot detect. This is especially problematic
because the script's threat model (T-23-02-06 in the SUMMARY) relies on the
integration test catching Phase 21 contract drift — but the integration test
only exercises the three known shapes, not the "unknown shape" path.

**Fix:**
```ts
} else if ('failed' in result && result.failed === true) {
  totals.errored += 1;
  // ... existing code
} else {
  // Defensive: unknown ConsolidateResult shape. Count as errored and log
  // loudly so future Phase 21 contract drift surfaces immediately.
  totals.errored += 1;
  logger.error(
    { date: dateStr, result: 'unknown-shape', payload: result },
    'backfill.day',
  );
}
```

### WR-03: live-anti-flattery fixture silently miscomputes entry timestamps if `config.proactiveTimezone` is not Europe/Paris

**File:** `src/episodic/__tests__/live-anti-flattery.test.ts:172-178, 264`
**Issue:** `adversarialInstant(hourLocal)` hard-codes `utcHour = hourLocal - 1`
based on the CET+1 February offset for Europe/Paris. `beforeAll` only asserts
`expect(config.proactiveTimezone).toBeTruthy()` — it does NOT assert the tz
is actually Europe/Paris (or another +1 zone in February). If an operator
runs with `PROACTIVE_TIMEZONE=America/New_York` (UTC-5 in February) or
`Asia/Tokyo` (UTC+9), the fixture entries still insert successfully with
createdAt=`2026-02-14T08:00:00Z`..`20:00:00Z`, but those UTC instants now
map to entirely different calendar days in the engine's bucketing tz:
- NY: `08:00 UTC` = `03:00 EST` same day; `20:00 UTC` = `15:00 EST` same
  day — OK by luck, because the full UTC 08-20 window fits within one EST
  day.
- Tokyo: `08:00 UTC` = `17:00 JST` Feb 14; `20:00 UTC` = `05:00 JST` Feb 15
  — some entries land on 2026-02-15 in the engine's tz, and `runConsolidate`
  for 2026-02-14 misses them.

In Tokyo-config CI, `getPensieveEntriesForDay` returns only a subset of the
5 entries, the summary is built from fewer entries than expected, and the
flattery assertion passes trivially because Sonnet has less material to
flatter. A test that passes when it should fail is a worse outcome than
the `skipIf` bypass it is guarding against.

The comment at L260-263 acknowledges "Paris wall-clock 9-21h straddles ~08:00-20:00
UTC, all within 2026-02-14 in any reasonable Europe/* tz" — but the assertion
only checks `.toBeTruthy()`, not Europe/*.

**Fix:**
```ts
// In beforeAll — make the tz assumption explicit:
expect(config.proactiveTimezone).toMatch(/^Europe\//);
// Or better — use Luxon (already a dep via the synthetic-fixture sibling)
// to compute the instant correctly in whatever tz is configured:
function adversarialInstant(hourLocal: number): Date {
  return DateTime.fromObject(
    { year: 2026, month: 2, day: 14, hour: hourLocal },
    { zone: config.proactiveTimezone },
  ).toJSDate();
}
```

## Info

### IN-01: Empty `key_quotes` in backfill fixture makes TEST-21-style CONS-10 regressions invisible

**File:** `src/episodic/__tests__/backfill.test.ts:141`
**Issue:** `buildSonnetOutputForDay` returns `key_quotes: []` for all three
fixture days. The backfill test only asserts importance and row count — it
does not exercise the key_quotes round-trip through the Zod validator +
Drizzle insert. A regression where `key_quotes` stops persisting correctly
would not surface here. Deliberately out of this plan's scope (TEST-21
covers the CONS-10 contract in the synthetic fixture), but worth a non-empty
sample in at least one day for defense in depth.

**Fix:** Seed `key_quotes: ['morning note', 'afternoon reflection']` for at
least day 0 and assert `rows[0].keyQuotes` after the backfill completes.

### IN-02: live-anti-flattery missing `mockAnthropicParse` guard — mocks could leak from another test file

**File:** `src/episodic/__tests__/live-anti-flattery.test.ts:42, 283-331`
**Issue:** The file imports `runConsolidate` and calls it against real
Sonnet, but there's no `vi.unmock('../../llm/client.js')` at the top and no
assertion that `anthropic.messages.parse` is the real function, not a mock
leaked from a prior file. Under vitest `fileParallelism: false` serial
execution, if the synthetic-fixture or backfill test file leaves a mock
installed (they use `vi.mock` module-scope, not per-file — and vitest in
principle isolates these, but the isolation contract is not asserted here),
a stale mock would cause this test to insert a hard-coded synthetic output
and falsely "pass" without actually exercising real Sonnet.

Mitigated in practice because vitest's per-file module graph resets `vi.mock`
calls, but a defensive assertion would catch any future vitest config change
(e.g., `isolate: false`).

**Fix:** Add `vi.unmock('../../llm/client.js')` at the top of the file (safe
no-op if no mock is installed), or add a sanity-check in `beforeAll` that
reads the module and asserts the parse function is not a vi mock:
```ts
import { anthropic } from '../../llm/client.js';
// ... in beforeAll
expect((anthropic.messages.parse as any)._isMockFunction).toBeFalsy();
```

### IN-03: `afterEach(vi.useRealTimers)` in synthetic-fixture but `vi.useFakeTimers` never called

**File:** `src/episodic/__tests__/synthetic-fixture.test.ts:480-482`
**Issue:** The file only uses `vi.setSystemTime(...)` (per D-02). It never
calls `vi.useFakeTimers()`, so `vi.useRealTimers()` in `afterEach` is a
no-op. The file-level comment at L15-16 explicitly forbids useFakeTimers.
Either remove the afterEach (it's misleading) or replace it with
`vi.setSystemTime(new Date())` to restore the real clock, since `setSystemTime`
mocks affect subsequent real-timer behavior via Date.now() in some vitest
versions.

**Fix:** Replace with
```ts
afterEach(() => {
  vi.setSystemTime(new Date()); // restore real wall-clock reads
});
```
Or remove entirely if a subsequent test never observes Date.now()
(the next test's beforeEach reseats the system time anyway, so this is
likely a dead hook).

### IN-04: Backfill test buildSonnetOutputForDay produces `importance: 3 + dayIndex` — will hit floor at dayIndex=7

**File:** `src/episodic/__tests__/backfill.test.ts:138`
**Issue:** `importance: 3 + dayIndex` is fine for the 3-day range tested
(values 3/4/5), but if a future test extends `FIXTURE_DATES` to 8+ days
without updating this helper, importance=10 on day 7 would be clamped to
`MAX_IMPORTANCE=10` quietly, and day 8+ would exceed the Zod max and
throw at validation time. Not a bug today; worth a clamp or a comment.

**Fix:** Replace with
```ts
importance: Math.min(3 + dayIndex, 10),  // clamp to Zod max
```

### IN-05: `ERROR_FALLBACK[lang ?? 'English']` in `bot.ts:69` has unreachable-else duplication (pre-existing, not Phase 23 scope)

**File:** `src/bot/bot.ts:69`
**Issue:** Noted for completeness — `ERROR_FALLBACK[lang ?? 'English']` always
returns a defined string because `lang ?? 'English'` returns `'English'` when
`lang` is null, and `ERROR_FALLBACK.English` is guaranteed defined at L12-16.
The `?? ERROR_FALLBACK.English!` fallback is dead code. This is pre-existing
code, not modified by Phase 23 (only the +5 lines at L10/L32 are new), so
out-of-scope for this review; mentioning as an opportunity for future
cleanup.

**Fix:** Out of Phase 23 scope. Clean up in a dedicated refactor if desired.

---

_Reviewed: 2026-04-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
