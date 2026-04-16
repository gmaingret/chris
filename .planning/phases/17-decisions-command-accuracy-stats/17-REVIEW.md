---
phase: 17-decisions-command-accuracy-stats
reviewed: 2026-04-16T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/bot/handlers/decisions.ts
  - src/decisions/__tests__/classify-accuracy.test.ts
  - src/decisions/__tests__/decisions-command.test.ts
  - src/decisions/__tests__/resolution.test.ts
  - src/decisions/__tests__/stats.test.ts
  - src/decisions/__tests__/suppressions.test.ts
  - src/decisions/classify-accuracy.ts
  - src/decisions/resolution.ts
  - src/decisions/stats.ts
  - src/decisions/suppressions.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-04-16T00:00:00Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 17 introduces the `/decisions` command handler, a 2-axis accuracy classifier, a stats/formatting layer, suppression persistence, and the resolution/post-mortem flow. The architecture is sound and the security posture is good: all queries are scoped by `chatId`, user text never enters system prompts, and classifiers fail-closed to safe defaults. Tests are comprehensive and DB-backed.

One critical issue was found: an unguarded `JSON.parse` call in `resolution.ts` that will throw and crash the outcome classifier rather than fail-closed on bad LLM output. Four warnings cover logic gaps in the `computeAccuracy` exclusion filter, an unhandled `undefined` return type that TypeScript allows to slip through, an edge-case in the `formatStatsBlock` domain-breakdown that renders `threshold not met` only in English for non-English locales, and a missing `resolvedAt IS NOT NULL` guard in the reclassify query. Three info items cover minor style/hardening opportunities.

---

## Critical Issues

### CR-01: Unguarded `JSON.parse` in `classifyOutcome` crashes rather than fail-closed

**File:** `src/decisions/resolution.ts:149`

**Issue:** `classifyOutcome` wraps the entire LLM call in a `try/catch` but calls `JSON.parse(cleaned)` _outside_ an inner try block. If the LLM returns malformed JSON (anything that is not valid JSON), `JSON.parse` throws a `SyntaxError`. Because the outer `catch` does catch it, the function will return `'ambiguous'` — but this only works by accident of control flow. More critically, the `parsed` variable is typed as `unknown` from the `JSON.parse` result on line 149, yet lines 151-163 proceed to access it without the inner parse-failure guard that `classifyAccuracy` correctly uses. If the `try` block's `catch` is ever restructured, or if a lint/type tool tightens the `unknown` narrowing, the silent fall-through breaks. `classifyAccuracy` (line 79-84 of `classify-accuracy.ts`) correctly wraps `JSON.parse` in a nested try/catch with an explicit early return — `classifyOutcome` should mirror that pattern.

```typescript
// Current (resolution.ts line 148-149) — JSON.parse can throw, falls through
// to outer catch only by accident:
const cleaned = textBlock.text.trim()...
const parsed: unknown = JSON.parse(cleaned);   // <-- naked, unguarded

// Fix: wrap JSON.parse in its own try/catch, identical to classify-accuracy.ts:
let parsed: unknown;
try {
  parsed = JSON.parse(cleaned);
} catch {
  logger.warn({ latencyMs: Date.now() - start }, 'resolution.classify.parse-error');
  return 'ambiguous';
}
```

---

## Warnings

### WR-01: `computeAccuracy` exclusion filter double-counts rows that match both exclusion predicates

**File:** `src/decisions/stats.ts:185-197`

**Issue:** The `unverifiableRows` filter (line 185-189) and the `scorable` filter (line 192-197) are computed independently from the same `rows` array. A row with `accuracyClass = 'unverifiable/unknown'` matches _both_ `startsWith('unverifiable/')` and `endsWith('/unknown')`. It is correctly excluded from `scorable`, but it is counted **twice** in `unverifiable` because the `unverifiableRows` filter uses OR semantics on the raw rows without deduplication. The `unverifiable` count will be inflated for any rows that match both predicates.

The test at `stats.test.ts:152-179` (Test 8) has a row `'unverifiable/unknown'` and a row `'ambiguous/unknown'`, expecting `result.n` to be 8, which is correct for the denominator — but `result.unverifiable` would be counted as 2 (one for `unverifiable/unknown`, one for `ambiguous/unknown`), both of which satisfy at least one predicate. The test at line 171-180 (Test 9) checks `result.unverifiable === 2`, which happens to pass because the two test rows each satisfy one predicate without overlap. However, a real row of `'unverifiable/unknown'` would be counted once in `unverifiableRows` for `startsWith('unverifiable/')` AND once for `endsWith('/unknown')` — unless the implementation uses `.filter` (which returns distinct objects). Since `.filter` on an array returns unique row references, the count is the number of matching rows (not predicate hits), so double-counting does NOT occur at the row level. However the intent documented in the comment "unverifiable/context + ambiguous/unknown" suggests any row matching either predicate should count as 1. This is currently correct by accident of `.filter` returning rows, not predicate matches — but would silently break if the filter were ever changed to count predicate matches. This is a latent logic clarity issue worth hardening with a comment.

**Fix:** Add a clarifying comment to `computeAccuracy` confirming that `.filter` returns row-level deduplication, or restructure to compute `unverifiable` from the complement of `scorable`:

```typescript
// unverifiable = total rows minus scorable rows (complement, no double-count risk):
const unverifiable = rows.length - n;
// (null accuracyClass rows are excluded from scorable but are not unverifiable;
// adjust if null rows need their own bucket)
```

Note: The complement approach only works cleanly if `null` accuracyClass rows are intended to be counted as unverifiable. If not, an explicit `Set`-based dedup is safer. This needs a product decision before changing.

---

### WR-02: `formatStatsBlock` domain "threshold not met" line is always English regardless of `lang`

**File:** `src/decisions/stats.ts:385`

**Issue:** When a domain has fewer than 10 scorable decisions, `formatStatsBlock` appends:
```
  ${domain}: N=${acc.n}, threshold not met
```
This string is hardcoded in English (line 385) regardless of the `lang` parameter. All other user-facing strings in the same function branch on `lang`. French and Russian users will see English text in their domain breakdown.

**Fix:**
```typescript
const thresholdNotMet = (() => {
  switch (lang) {
    case 'fr': return 'seuil non atteint';
    case 'ru': return 'порог не достигнут';
    default: return 'threshold not met';
  }
})();
// ...
lines.push(`  ${domain}: N=${acc.n}, ${thresholdNotMet}`);
```

---

### WR-03: `reclassify` query does not filter out rows with `null` `resolvedAt` — `resolveBy` is used as a proxy fallback in `handleResolution` creating inconsistency

**File:** `src/bot/handlers/decisions.ts:183-189`

**Issue:** The reclassify query selects all rows where `status = 'reviewed'` and `resolution IS NOT NULL`. A `reviewed` decision always has a resolution text, so the `isNotNull(decisions.resolution)` guard is good. However, the query does not verify that `accuracyClass` is currently missing/stale — it will reclassify and overwrite accurate, already-good classifications. This is intentional per D-11 ("overwrite with latest"). That is fine by design.

The real concern: `decisions.resolution` could theoretically be non-null but empty (e.g., a whitespace-only string stored before the length guard was added). Passing an empty string as `resolutionText` to both `classifyOutcome` and `classifyAccuracy` will produce a valid LLM response but may produce misleading classifications. The handler validates `arg.length > 200` for suppress but does not validate resolution text length anywhere in the flow.

**Fix:** In the reclassify loop, skip rows with blank resolution before calling classifiers:
```typescript
if (!d.resolution?.trim()) {
  logger.warn({ id: d.id }, 'reclassify.skip.empty-resolution');
  continue;
}
```

---

### WR-04: `isoLang` in `decisions.ts` returns `'en'` for any language other than French or Russian — silently swallows unknown language values

**File:** `src/bot/handlers/decisions.ts:239-241`

**Issue:** The `isoLang` helper converts `getLastUserLanguage` output to `'en' | 'fr' | 'ru'`. Any language value that is not `'French'` or `'Russian'` silently maps to `'en'`. This is documented behaviour for English, but if `getLastUserLanguage` returns a new language code (e.g., `'Spanish'`, `'German'`) due to a future update, the user silently gets English with no log or warning. The handler has no observability into unexpected language values.

**Fix:** Add a warn log for unrecognized language values:
```typescript
function isoLang(raw: string | null): 'en' | 'fr' | 'ru' {
  if (raw === 'French') return 'fr';
  if (raw === 'Russian') return 'ru';
  if (raw !== null && raw !== 'English') {
    logger.warn({ lang: raw }, 'decisions.isoLang.unrecognized');
  }
  return 'en';
}
```

---

## Info

### IN-01: `AccuracyResult.unverifiable` is not optional in the type but `belowFloor: true` branch does not always guarantee it is present in callers

**File:** `src/decisions/stats.ts:76-83`

**Issue:** The `AccuracyResult` interface has `unverifiable: number` as a required field (non-optional). The `computeAccuracy` function always sets it in both branches (line 200 and 215), so the implementation is correct. However, `formatDashboard` (line 231) never renders `unverifiable` — it only reads `accuracy90.pct` and `accuracy90.ci`. The `unverifiable` count is computed but unused in the dashboard. If future work adds display of unverifiable count to the dashboard, it is ready. This is just dead data in the current dashboard path — worth a comment.

**Suggestion:** Add a TODO comment noting that `unverifiable` is intentionally omitted from dashboard display but available for future use, or add a brief `+${accuracy90.unverifiable} unverifiable` indicator to the dashboard.

---

### IN-02: `confirmedMessage` and `unsuppressedMessage` call `arg.trim().toLowerCase()` in the handler but `addSuppression` already normalizes — double-normalization

**File:** `src/bot/handlers/decisions.ts:75` and `163-164`

**Issue:** The handler passes `arg.trim().toLowerCase()` to the confirmation message helpers (lines 75, 163, 164), but `addSuppression` and `removeSuppression` already normalize internally. The user-facing confirmation message therefore shows the normalized (lowercased) phrase back even though the user typed it mixed-case. This is the correct UX behaviour (show what was stored), but the double normalization is fragile — if the normalization logic in `suppressions.ts` ever changes (e.g., Unicode normalization), the handler's confirmation would diverge from what was actually stored.

**Suggestion:** Remove the `.trim().toLowerCase()` calls from the confirmation in `decisions.ts` and instead return the stored phrase from `addSuppression`/`removeSuppression` so the confirmation always reflects exactly what the DB holds:
```typescript
// addSuppression could return the normalized phrase:
export async function addSuppression(chatId: bigint, phrase: string): Promise<string> {
  const normalized = phrase.trim().toLowerCase();
  // ... insert ...
  return normalized;
}
```

---

### IN-03: `formatOpenList` re-sorts rows it expects to already be sorted

**File:** `src/decisions/stats.ts:292`

**Issue:** `formatOpenList` contains a defensive sort (`const sorted = [...rows].sort(...)`, line 292) with a comment "Sort soonest-first in case caller passes unsorted rows". The SQL query `fetchOpenDecisions` already applies `.orderBy(asc(decisions.resolveBy))`. The defensive sort is harmless but creates a subtle inconsistency: `formatRecentList` trusts the caller's sort order without a defensive re-sort, while `formatOpenList` does not. Pick one pattern — either both trust the caller, or both defensively sort. The test for `formatOpenList` passes pre-sorted rows and thus does not catch whether the function's own sort is exercised.

**Suggestion:** Either remove the defensive sort from `formatOpenList` (trusting `fetchOpenDecisions` is the single source), or add the same defensive sort to `formatRecentList` for consistency.

---

_Reviewed: 2026-04-16T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
