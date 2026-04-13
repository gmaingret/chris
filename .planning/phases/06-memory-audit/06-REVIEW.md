---
phase: 06-memory-audit
reviewed: 2026-04-13T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/pensieve/ground-truth.ts
  - src/pensieve/__tests__/ground-truth.test.ts
  - src/scripts/audit-pensieve.ts
  - src/scripts/__tests__/audit-pensieve.test.ts
  - src/scripts/seed-audit-data.ts
  - src/scripts/__tests__/seed-audit-data.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-04-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the ground-truth data module, the pensieve audit script, the seed data script, and their corresponding test files. The overall design is sound — the matching logic is well-structured and the soft-delete safety constraint is respected throughout. Three logic bugs were found in `audit-pensieve.ts` (two of which cause incorrect match results at runtime) plus three code quality issues across the two scripts.

---

## Warnings

### WR-01: "Moving to Batumi" entries always match `next_move`, never `permanent_relocation`

**File:** `src/scripts/audit-pensieve.ts:121-155`

**Issue:** The `next_move` block (lines 121-134) matches any content containing `batumi` combined with `move`, `moving`, `heading`, `going to`, or `relocate`. The `permanent_relocation` block (lines 146-155) is evaluated only if the `next_move` block did not match first. Because `permanent_relocation` content ("moving to Batumi permanently", "relocating to Batumi September 2026") will also contain `batumi` + `moving`/`relocate`, those entries are consumed by the `next_move` block and tagged with `key: 'next_move'` instead of `key: 'permanent_relocation'`. The permanent_relocation block is unreachable for any content that uses those common motion verbs.

**Fix:** Add a negative guard to the `next_move` block to exclude permanent-relocation indicators. Move the permanent_relocation check before the next_move check, or add an exclusion condition:

```typescript
// ── Permanent relocation to Batumi (check BEFORE next_move) ──────────────
if (
  lower.includes('batumi') &&
  (lower.includes('permanent') || lower.includes('september 2026') || lower.includes('permanently'))
) {
  return { matched: true, key: 'permanent_relocation', isCorrect: true };
}

// ── Next move to Batumi (non-permanent only) ──────────────────────────────
if (
  lower.includes('batumi') &&
  !lower.includes('permanent') &&
  (lower.includes('move') ||
    lower.includes('moving') ||
    lower.includes('heading') ||
    lower.includes('going to') ||
    lower.includes('relocate'))
) {
  return { matched: true, key: 'next_move', isCorrect: true };
}
```

---

### WR-02: Non-null assertion on `match.key` without structural guarantee

**File:** `src/scripts/audit-pensieve.ts:341`

**Issue:** At line 341, `match.key!` uses a non-null assertion. The `MatchResult` type declares `key` as optional (`key?: string`). At this point in the code the conditions are `match.matched === true` and `match.isCorrect === false`, but the type system does not narrow `key` to `string` based on those flags. If `matchEntryToGroundTruth` is ever updated to return `{ matched: true, isCorrect: false }` without setting `key` (possible given the loose type), the non-null assertion will silently pass and `generateCorrectedContent` will receive `undefined` cast as `string`, producing a malformed correction.

**Fix:** Add a runtime guard to fail loudly rather than silently:

```typescript
if (!match.key) {
  console.error(`BUG: matched entry ${entry.id} has no ground-truth key — skipping`);
  continue;
}
const correctedContent = generateCorrectedContent(match.key, entry.content);
```

Alternatively, restructure `MatchResult` into a discriminated union so the type narrows correctly.

---

### WR-03: Seed data has no entry for the `next_move` ground-truth key

**File:** `src/scripts/seed-audit-data.ts:32-130`

**Issue:** `SEED_ENTRIES` covers 12 of the 13 ground-truth keys but does not include a correct-scenario entry with `groundTruthKey: 'next_move'`. The entry at line 49 ("I'm currently living in Saint Petersburg...") covers `current_location`. The entry at line 56 ("After a month in Batumi, I'll head to Antibes...") covers `after_batumi`. There is no entry that exercises the "moving to Batumi from Saint Petersburg" step. This means the audit script's `next_move` match branch is never exercised in a seed-then-audit end-to-end run, and audit reports produced against seed data will always show zero `correct` results for `next_move`.

**Fix:** Add a seed entry:

```typescript
{
  content: "I'm moving to Batumi, Georgia around April 28 for about a month.",
  epistemicTag: 'FACT',
  source: 'telegram',
  metadata: { seedScenario: 'correct', groundTruthKey: 'next_move' },
},
```

---

## Info

### IN-01: Duplicate condition in `isRentalContext` OR expression

**File:** `src/scripts/audit-pensieve.ts:59`

**Issue:** The string `'managed by citya'` is listed twice consecutively in the `isRentalContext` boolean (lines 57-60). The second occurrence is dead code — it can never change the result.

**Fix:** Remove the duplicate condition:

```typescript
const isRentalContext =
  lower.includes('rented') ||
  lower.includes('rental') ||
  lower.includes('apartment') ||
  (lower.includes('citya') && (lower.includes('managed') || lower.includes('rented') || lower.includes('apartment')));
```

---

### IN-02: Log line unconditionally appends ellipsis regardless of content length

**File:** `src/scripts/seed-audit-data.ts:179`

**Issue:** `entry.content.slice(0, 60) + '...'` always appends `...`, even when the content is shorter than 60 characters. For short seed entries this produces misleading output like `"I have Panama permanent residency...."`

**Fix:**

```typescript
const preview = entry.content.length > 60
  ? entry.content.slice(0, 60) + '...'
  : entry.content;
console.log(`  [${entry.metadata.seedScenario.toUpperCase()}] Inserted: ${preview}`);
```

---

### IN-03: `matchEntryToGroundTruth` birth section silently ignores entries with wrong year

**File:** `src/scripts/audit-pensieve.ts:158-183`

**Issue:** The `hasWrongDate` detection at line 166 requires `lower.includes('1979')` in addition to a date-shaped pattern. An entry like "Greg was born on 05/06/1980" (wrong year) will not trigger `hasWrongDate` because `1979` is absent. The entry falls through the entire `born`/`birth` block and exits as `{ matched: false }`, so a birth-date entry with a wrong year is silently treated as unrelated rather than flagged as incorrect.

This is likely an acceptable intentional scope constraint (only catching the specific known error pattern), but it is worth a comment documenting the limitation rather than leaving it as implicit behavior.

**Fix:** Add a comment clarifying the intended scope:

```typescript
// NOTE: hasWrongDate only fires if '1979' is present but the date format differs.
// Birth entries with a completely wrong year (e.g., 1980) are not detected as
// incorrect — they fall through as unmatched. Widen this check if broader
// birth-date auditing is required.
const hasWrongDate = lower.includes('1979') && !hasCorrectDate && /\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/.test(lower);
```

---

_Reviewed: 2026-04-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
