---
phase: 35-surfaces
fixed_at: 2026-05-13T12:30:00Z
review_path: .planning/phases/35-surfaces/35-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 35: Code Review Fix Report

**Fixed at:** 2026-05-13T12:30:00Z
**Source review:** `.planning/phases/35-surfaces/35-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (Critical + Warning; Info excluded — `fix_scope=critical_warning`)
- Fixed: 2
- Skipped: 0
- Out of scope (Info — not addressed this run): 4 (IN-01..IN-04)

## Fixed Issues

### WR-01: Dead-code branch in `formatProfileForDisplay` jurisdictional fallback

**Files modified:** `src/bot/handlers/profile.ts`
**Commit:** `785df71`
**Applied fix:** Replaced the unreachable third branch with the reordered fix from the review. The new sequence is:
1. `destination && from_date` → emit with `from_date`
2. `destination && planned_move_date` → emit with `planned_move_date` (the "edge" case where the date sits in the outer field instead of inside the object)
3. `destination` only → emit destination-only line

The earlier dead branch had its outer guard order reversed (`planned_move_date` first), so by the time it was reachable, `destination` was guaranteed null — the inner `if (d.next_planned_move.destination)` could never fire. Reordering puts the edge branch BEFORE the destination-only fallback so the latter doesn't eat it. Per Zod v3 schema (`schemas.ts:37-40`), `next_planned_move` is a non-optional `.strict()` object with nullable scalar fields, so `d.next_planned_move?.destination` covers the only meaningful guard.

**Verification:** `tsc --noEmit` clean. `vitest run profile.golden.test.ts profile.test.ts` → 26/26 passing. The existing snapshot for the jurisdictional populated-fresh case (which has both `destination` AND `from_date` set) still hits the first branch, so output is byte-identical for the existing test fixture.

---

### WR-02: English field-name leakage in FR/RU `formatProfileForDisplay` output

**Files modified:** `src/bot/handlers/profile.ts`, `src/bot/handlers/__tests__/profile.golden.test.ts`
**Commit:** `1117418`
**Applied fix:** Localized the four English connective glue words / labels:

1. **`residencySince(date)` per language** (jurisdictional) → ` (since YYYY-MM-DD)` / ` (depuis YYYY-MM-DD)` / ` (с YYYY-MM-DD)`. Consumed at line 400 (residency_status loop).
2. **`since(date)` per language** (health) → `since YYYY-MM-DD` / `depuis YYYY-MM-DD` / `с YYYY-MM-DD`. Consumed at line 456 (open_hypotheses) AND line 481 (active_treatments). The reviewer's example called out 481 explicitly but 456 had the same leak — both fixed for consistency. (456 was implied by the review's "etc.")
3. **`wellbeingLabels: { energy, mood, anxiety }` per language** (health) → English unchanged (`energy`/`mood`/`anxiety`); French → `énergie`/`humeur`/`anxiété`; Russian → `энергия`/`настроение`/`тревога`. Consumed at lines 493-495.

Followed the existing `summary.ts:78-80` localization shape (per-language nested record under a labels key inside MSG). No new external translations module — kept the change self-contained inside the existing `MSG.fields.{dim}.{lang}` map per the in-file precedent.

**Test additions:**
- Strengthened the existing FR/RU jurisdictional smoke tests with positive assertions (`toContain('(depuis 2020-01-01)')` / `toContain('(с 2020-01-01)')`) and scoped negative invariants (`not.toMatch(/\(since \d{4}-\d{2}-\d{2}\)/)`).
- Added two new FR/RU **health** smoke tests asserting the localized `since` + wellbeing axis labels appear and the English equivalents do not. Total test count: 26 → 28.

**Data-vs-UI distinction:** Negative invariants are scoped to UI patterns (`/\(since YYYY-MM-DD\)/`, `/\[STATUS since YYYY-MM-DD\]/`, `/ since YYYY-MM-DD/`) — NOT a blanket `/\bsince\b/`. The first iteration of the test caught a legitimate case: `case_file_narrative` contains user-content text ("Energy trending up since magnesium started…") that legitimately uses the English word "since" because it's stored data, not a UI label. The scoped regex distinguishes the two.

**English behavior preserved byte-identical:** The 16 EN inline snapshots all pass without regeneration — the new EN helpers (`residencySince`, `since`, `wellbeingLabels` with English values) reproduce the exact same output strings the inline implementations were producing.

**Verification:**
- `tsc --noEmit` clean
- `vitest run profile.golden.test.ts profile.test.ts` → 28/28 passing (26 original + 2 new health FR/RU smoke tests)
- Hand-rendered FR + RU output reviewed for naturalness:
  - FR jurisdictional: `- tax: French resident (depuis 2020-01-01)` ✓
  - RU jurisdictional: `- tax: French resident (с 2020-01-01)` ✓
  - FR health: `- magnesium glycinate 400mg depuis 2026-04-22 (sleep)` + `énergie=6.4, humeur=7.1, anxiété=3.2` ✓
  - RU health: `- magnesium glycinate 400mg с 2026-04-22 (sleep)` + `энергия=6.4, настроение=7.1, тревога=3.2` ✓
- Data values that are user-content (place names like "Tbilisi", `h.status` like "investigating", `t.purpose` like "sleep") remain in the source language they were recorded in — these are NOT UI labels, and translating them is out of scope for WR-02 (and would be incorrect: they're stored Greg-authored data).

## Out-of-Scope Findings

Info findings (IN-01..IN-04) were not addressed this run because `fix_scope=critical_warning`. They are valid quality improvements:

### IN-01: Staleness date is not localized in `/profile` output (out_of_scope)
ISO date format used regardless of language. Would need `Intl.DateTimeFormat` wrap (`DATE_LOCALES` pattern from `personality.ts`). Inline snapshots would need regeneration.

### IN-02: First-occurrence inline-snapshot workflow documentation lives only in test file (out_of_scope)
Documentation-only — would benefit from a CLAUDE.md / CONTRIBUTING.md note about `npx vitest run -u …` and reviewer discipline.

### IN-03: `from: { id: chatId }` test fixture is not load-bearing (out_of_scope)
Drop unused field from test buildCtx helper. Cosmetic.

### IN-04: `langOf` is duplicated between `profile.ts` and `summary.ts` (out_of_scope)
Refactor opportunity — extract `langOf` + `Lang` type to a shared module before M011 surface lands.

To address these, re-run with `fix_scope=all`.

---

_Fixed: 2026-05-13T12:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
