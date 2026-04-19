---
phase: 22-cron-retrieval-routing
status: findings
files_reviewed: 12
depth: standard
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
files_reviewed_list:
  - src/pensieve/retrieve.ts
  - src/pensieve/routing.ts
  - src/chris/modes/interrogate.ts
  - src/chris/modes/date-extraction.ts
  - src/chris/__tests__/boundary-audit.test.ts
  - src/episodic/cron.ts
  - src/index.ts
  - src/pensieve/__tests__/retrieve.episodic.test.ts
  - src/pensieve/__tests__/retrieve.test.ts
  - src/pensieve/__tests__/routing.test.ts
  - src/chris/__tests__/date-extraction.test.ts
  - src/chris/__tests__/interrogate.test.ts
  - src/episodic/__tests__/cron.test.ts
---

# Phase 22: Code Review Report

**Reviewed:** 2026-04-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 12 (7 source + 6 tests; `src/pensieve/routing.ts` contains Phase 22.1 wiring out of scope)
**Status:** issues_found

## Summary

Phase 22 ships a coherent retrieval+cron feature set: tz-aware episodic-summary read helpers, two-dim retrieval routing, INTERROGATE date-anchored summary injection, a source-text boundary audit, and an independent DST-safe cron registration. The never-throw contract is honored inside the hot paths, the verbatim-keyword fast-path correctly bypasses the Anthropic SDK, and the DST boundary is defended by three layers (Intl.DateTimeFormat tz-aware formatting + node-cron `{ timezone }` + Phase 21 UNIQUE(summary_date) idempotency).

The review surfaced **five warnings**, none critical. The most load-bearing issues are (1) a tz-alignment mismatch between `extractQueryDate` (returns midnight UTC) and `getEpisodicSummary` (converts via IANA tz) that silently miscomputes the lookup date in negative-offset zones — deployment-latent; (2) two never-throw-contract leaks where `formatLocalDate`/`computeYesterday` run outside the inner try/catch and an invalid IANA tz crashes past the first catch layer; (3) FR/RU month-day regexes lack a leading `\b` on the day digits so "item 121 décembre" false-matches "21 décembre"; (4) `matchMonthDay` never validates that its `(monthIdx, day)` tuple is a real date — `Date.UTC` silently rolls February 30 to March 2 and April 31 to May 1. These are correctness issues — not style nits — but all have benign runtime blast radius under the current Europe/Paris deployment.

The boundary audit is well-constructed (ESM `__dirname`, fresh non-global regex per line, word-boundary strictness) and explicitly sanity-checked via negative-case injection. The cron's DST tests are deterministic (injectable `now` across spring-forward and fall-back), and the zero-Anthropic-call cumulative `afterAll` assertion is a correct, efficient way to enforce the M008 pure-keyword contract.

## Warnings

### WR-01: Never-throw contract leaks when `config.proactiveTimezone` is an invalid IANA string

**Files:**
- `src/pensieve/retrieve.ts:347` (`getEpisodicSummary`)
- `src/pensieve/retrieve.ts:390-391` (`getEpisodicSummariesRange`)
- `src/episodic/cron.ts:93` (`runConsolidateYesterday`)

**Issue:** `formatLocalDate(date, config.proactiveTimezone)` and `computeYesterday(now, config.proactiveTimezone)` are invoked BEFORE the function-body `try` block. `new Intl.DateTimeFormat('en-CA', { timeZone: tz })` throws `RangeError: Invalid time zone specified: <tz>` when `tz` is misconfigured (e.g., typo `Europe/ParisWrong` in `PROACTIVE_TIMEZONE`). The thrown error escapes the inner catch and violates the documented never-throw contract on all three functions. For `runConsolidateYesterday`, the comment at `src/episodic/cron.ts:29-31` explicitly claims double-catch defence-in-depth, but the FIRST catch layer is bypassed — only the outer catch in `src/index.ts:92-94` saves the process. The `episodic.cron.invoked` info log (which runs after `computeYesterday`) also never fires, so operators lose the "cron fired" signal.

**Fix:** Move the tz-conversion inside the try/catch, or defensively validate `config.proactiveTimezone` at startup. Example for `retrieve.ts`:
```ts
export async function getEpisodicSummary(date: Date) {
  const start = Date.now();
  let localDate = '';
  try {
    localDate = formatLocalDate(date, config.proactiveTimezone);
    const rows = await db.select()...
    // ...
  } catch (error) {
    logger.warn(
      { date: localDate, error: error instanceof Error ? error.message : String(error) },
      'pensieve.episodic.error',
    );
    return null;
  }
}
```
Same treatment for `getEpisodicSummariesRange` and the cron wrapper.

---

### WR-02: Timezone alignment mismatch between `extractQueryDate` and `getEpisodicSummary` breaks ISO lookups in negative-offset zones

**Files:**
- `src/chris/modes/date-extraction.ts:57` (`matchIsoDate`: `new Date(iso + 'T00:00:00Z')`)
- `src/chris/modes/date-extraction.ts:134` (`matchRelativeAgo`: `shifted.setUTCHours(0,0,0,0)`)
- `src/chris/modes/date-extraction.ts:202` (`matchMonthDay`: `Date.UTC(year, monthIdx, day)`)
- `src/pensieve/retrieve.ts:347` (consumer: `formatLocalDate(date, config.proactiveTimezone)`)

**Issue:** `extractQueryDate` anchors every resolved date at **midnight UTC**. `getEpisodicSummary` then converts that Date to a calendar-day string in `config.proactiveTimezone`. For positive-offset zones (Europe/Paris is UTC+1/+2), midnight UTC maps to 01:00–02:00 local time on the SAME calendar day — no problem. But for negative-offset zones (any US/Americas tz), midnight UTC maps to the PREVIOUS calendar day in local time. Empirical verification:
```
new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
  .format(new Date('2026-04-01T00:00:00Z'))  // → '2026-03-31'
```
If a future operator sets `PROACTIVE_TIMEZONE=America/New_York`, every ISO-date INTERROGATE query ("what happened on 2026-04-01") would silently look up the WRONG day's summary. The same issue applies to relative-ago (`setUTCHours(0,0,0,0)` anchors at UTC midnight) and month-day matches. Phase 22-03 SUMMARY claims "no luxon dep needed" — this is true for the Europe/Paris deployment only. The tests live under Europe/Paris so this bug is invisible today.

**Fix:** Either (a) extractor returns a Date anchored at local noon in `config.proactiveTimezone` (use `Intl.DateTimeFormat` to construct, or accept luxon here), or (b) document the positive-offset constraint in `config.ts` / add a startup-time validator that rejects negative-offset zones. Lowest-churn option: anchor at 12:00 UTC instead of 00:00 UTC in all three extractors — buys ±12h of tz slack:
```ts
const d = new Date(iso + 'T12:00:00Z');  // was T00:00:00Z
// same in matchRelativeAgo: shifted.setUTCHours(12, 0, 0, 0)
// same in matchMonthDay: Date.UTC(year, monthIdx, day, 12)
```
The noon-UTC anchor is the canonical fix for this class of tz/date-bag mismatch and requires no new deps.

---

### WR-03: FR/RU month-day regexes lack leading word boundary, allowing digit false-positives

**Files:**
- `src/chris/modes/date-extraction.ts:167` (FR regex)
- `src/chris/modes/date-extraction.ts:171` (RU regex)

**Issue:** The EN month-day regex starts with `\b(january|...|december)` — correctly anchored. The FR regex `(\d{1,2})(?:er)?\s+(janvier|...|décembre)(?:\s+(\d{4}))?` and RU regex `(\d{1,2})\s+(январ|...|декабр)` start with `(\d{1,2})` with no leading `\b`. Empirical demonstration:
```
'item 121 décembre something'.match(fr)
// → ['21 décembre', '21', 'décembre', undefined]
```
`21 décembre` is extracted from what was originally `121` (the `1` is dropped). In production this would mis-resolve dates embedded inside unrelated digit strings (order numbers, phone numbers, amounts). Low likelihood (the `what happened on…` framing typically precedes a clean day number) but the fix is one character per regex.

**Fix:**
```ts
const fr = q.match(
  /\b(\d{1,2})(?:er)?\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?:\s+(\d{4}))?/,
);
const ru = q.match(
  /\b(\d{1,2})\s+(январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр|ноябр|декабр)/,
);
```
Add one regression test per language with a leading-digit-noise fixture.

---

### WR-04: `matchMonthDay` silently accepts invalid day-of-month via `Date.UTC` rollover

**File:** `src/chris/modes/date-extraction.ts:202`

**Issue:** `new Date(Date.UTC(year, monthIdx, day))` does NOT validate that `(monthIdx, day)` is a real calendar date — it silently normalizes overflow. Empirical:
```
new Date(Date.UTC(2026, 1, 30)).toISOString().slice(0,10)  // Feb 30 → '2026-03-02'
new Date(Date.UTC(2026, 3, 31)).toISOString().slice(0,10)  // April 31 → '2026-05-01'
```
A user query "what happened on February 30" extracts to March 2, and the INTERROGATE summary-injection path looks up a summary for the wrong day. The existing `isNaN(d.getTime())` guard doesn't help — overflow produces a valid Date object. Consistent with WR-02, this is another silent date-miscalibration class bug.

**Fix:**
```ts
const d = new Date(Date.UTC(year, monthIdx, day));
if (isNaN(d.getTime())) return null;
// Reject calendar-overflow: Date.UTC normalizes Feb 30 → March 2
if (d.getUTCMonth() !== monthIdx || d.getUTCDate() !== day) return null;
return d;
```

---

### WR-05: `vi.useFakeTimers` in `routing.test.ts` beforeEach has no matching afterEach restore

**File:** `src/pensieve/__tests__/routing.test.ts:207`

**Issue:** `beforeEach` installs fake timers via `vi.useFakeTimers({ now: FIXED_NOW, toFake: ['Date'] })` but there is no matching `afterEach(() => vi.useRealTimers())`. Vitest's fork pool usually isolates test files, so cross-file bleed is unlikely — but inside the same file, if a new describe block is appended later and forgets to re-install fake timers (or depends on real timers for a latency assertion), `Date.now()` will be stuck at `2026-04-19T12:00:00Z`. This is the flaky-boundary class of test bug the Phase 22-02 SUMMARY explicitly called out.

**Fix:**
```ts
afterEach(() => {
  vi.useRealTimers();
});
```
Add next to the existing beforeEach.

---

## Info

### IN-01: `DAYS_PER_UNIT` uses 30-day months and 365-day years — approximation drift beyond a few months

**File:** `src/chris/modes/date-extraction.ts:69-71`

**Issue:** `{ day: 1, week: 7, month: 30, year: 365 }`. "Three months ago" on 2026-04-22 resolves to 2026-01-22 (90 days), but a user intending a calendar-month sense would mean 2026-01-22 also in most cases, with drift of ±1 day across each month boundary. "One year ago" drops a leap day. For M008 single-day summary retrieval, the miss rate is probably tolerable; the comment block in Phase 22-03 SUMMARY already acknowledges that word-form French/Russian relative-ago falls through to Haiku. Worth surfacing as a known limit.

**Fix:** Consider using `luxon` (already a dep from Phase 21-03) for calendar-month subtraction when unit is 'month' or 'year', or at least add a JSDoc note on the constant. Non-blocking.

---

### IN-02: `matchMonthDay` accepts arbitrarily-far-future explicit years without bounds check

**File:** `src/chris/modes/date-extraction.ts:181, 185`

**Issue:** `year = en[3] ? parseInt(en[3], 10) : null` — if the user writes "April 1, 9999" the extractor happily returns a Date 8000 years in the future. Downstream the `ageDays > 7` check in interrogate.ts makes ageDays negative → no injection (benign). Routing treats queryAge ≤ 7 as recent (also benign). But the extractor promises "a query-about-date from the user's text" — accepting arbitrary futures silently is a surprising contract. Minor; mainly a robustness concern if the extractor ever feeds a non-defensive consumer.

**Fix:** Clamp the parsed year to `[thisYear - 50, thisYear + 5]` range, or treat future-year explicit dates as null. Non-blocking.

---

### IN-03: Phase 22-02 SUMMARY claims 15 VERBATIM_KEYWORDS; file has 14

**File:** `src/pensieve/routing.ts:26-44`

**Issue:** Count of entries: 6 EN + 4 FR + 4 RU = 14, not 15 as the Phase 22-02 SUMMARY states (twice). Documentation drift, not a code bug. Worth noting because Phase 22-03 SUMMARY also claims "15 keywords total".

**Fix:** Either add a fifteenth keyword (e.g., EN `literal quote`, FR `citation exacte`, RU `дословный`) or amend the SUMMARY files. Non-blocking.

---

### IN-04: INTERROGATE's `ageDays` computation duplicates `computeQueryAgeDays` logic in routing.ts

**File:** `src/chris/modes/interrogate.ts:72-74` vs `src/pensieve/routing.ts:85-89`

**Issue:** Both modules compute `Math.floor((Date.now() - queryDate.getTime()) / 86_400_000)`. As Phase 22 lands INTERROGATE injection (22-03) and routing (22-02) in overlapping commits, the two ageDays computations drift independently. They are not called from each other — INTERROGATE talks directly to `getEpisodicSummary`, not through `retrieveContext`. The `SUMMARY_INJECTION_AGE_DAYS = 7` constant and `RECENCY_BOUNDARY_DAYS = 7` constant are also independent copies of the same 7.

**Fix:** Export `computeQueryAgeDays` (and `RECENCY_BOUNDARY_DAYS`) from `routing.ts` and consume in interrogate.ts. Low priority; flagged for consistency as Phase 22.1 already exists to wire routing into the other modes — same refactor would benefit interrogate.

---

_Reviewed: 2026-04-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
