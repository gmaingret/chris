---
phase: 35-surfaces
fixed_at: 2026-05-13T12:50:00Z
review_path: .planning/phases/35-surfaces/35-REVIEW.md
iteration: 2
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 35: Code Review Fix Report

**Fixed at:** 2026-05-13T12:50:00Z (iteration 2)
**Source review:** `.planning/phases/35-surfaces/35-REVIEW.md`
**Iteration:** 2 (cumulative across both runs)

**Summary:**
- Findings in scope (cumulative): 6 (WR-01, WR-02, IN-01..IN-04)
- Fixed (cumulative): 6
- Skipped: 0
- Iteration 1 (`fix_scope=critical_warning`): 2 fixed (WR-01, WR-02)
- Iteration 2 (`fix_scope=all`): 4 fixed (IN-01, IN-02, IN-03, IN-04)

## Fixed Issues (Iteration 1)

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
  - FR jurisdictional: `- tax: French resident (depuis 2020-01-01)`
  - RU jurisdictional: `- tax: French resident (с 2020-01-01)`
  - FR health: `- magnesium glycinate 400mg depuis 2026-04-22 (sleep)` + `énergie=6.4, humeur=7.1, anxiété=3.2`
  - RU health: `- magnesium glycinate 400mg с 2026-04-22 (sleep)` + `энергия=6.4, настроение=7.1, тревога=3.2`
- Data values that are user-content (place names like "Tbilisi", `h.status` like "investigating", `t.purpose` like "sleep") remain in the source language they were recorded in — these are NOT UI labels, and translating them is out of scope for WR-02 (and would be incorrect: they're stored Greg-authored data).

## Fixed Issues (Iteration 2)

### IN-01: Staleness date is not localized in `/profile` output

**Files modified:** `src/bot/handlers/profile.ts`, `src/bot/handlers/__tests__/profile.golden.test.ts`
**Commit:** `782c415`
**Applied fix:** Replaced `profile.lastUpdated.toISOString().slice(0, 10)` with `toLocaleDateString(DATE_LOCALES[lang], { year: 'numeric', month: 'long', day: 'numeric' })`, mirroring the `DATE_LOCALES` pattern in `src/chris/personality.ts:242-259` (`formatContradictionNotice`). Added a module-level `DATE_LOCALES: Record<Lang, string>` constant (`English: 'en-US'`, `French: 'fr-FR'`, `Russian: 'ru-RU'`) right next to `STALENESS_MS` so the staleness rendering reads top-to-bottom in one block. Phase context says this is "user-facing wording" — switching from ISO to localized long-form ("April 1, 2026" / "1 avril 2026" / "1 апреля 2026 г.") matches Greg's three-language UX expectations.

**Snapshot update:** the 4 populated-stale EN inline snapshots (`jurisdictional`, `capital`, `health`, `family` × stale) regenerated via `npx vitest run -u`. The diff was clean — exactly the 4 staleness lines changed from `2026-04-01` to `April 1, 2026`. No third-person leak, no field-name leak, no cross-locale bleed (the four reviewer-discipline tripwires from the new TESTING.md section all passed). The 16 non-stale snapshots and the 4 FR/RU smoke tests were byte-identical.

**Test additions:** Added 2 new IN-01-specific assertions in the `language coverage` describe block:
- FR jurisdictional populated-stale: asserts `toContain('1 avril 2026')` + scoped negative `not.toMatch(/Note .* 2026-04-01/)` + `not.toContain('données du profil du 2026-04-01')`.
- RU jurisdictional populated-stale: asserts `toMatch(/1 апреля 2026/)` (prefix-tolerant of ICU "г." trailing form variation) + `not.toMatch(/Примечание: данные профиля от 2026-04-01/)`.

Total test count: 28 → 30.

**TZ note:** `toLocaleDateString` defaults to host TZ, matching `formatContradictionNotice`'s precedent. STALE_DATE is `2026-04-01T00:00:00Z`, so all three locales render the same calendar day on a UTC host (the test env and the Proxmox production server both run UTC per Phase 25 deploy notes). For host TZs further west, the calendar day could shift by one — but this is moot in deployment.

**Verification:**
- `tsc --noEmit` clean
- `vitest run profile.golden.test.ts profile.test.ts` → 30/30 passing (28 prior + 2 new IN-01 tests)

---

### IN-02: Inline-snapshot workflow documentation lifted to repo-wide TESTING.md

**Files modified:** `.planning/codebase/TESTING.md`, `src/bot/handlers/__tests__/profile.golden.test.ts`
**Commit:** `0ba4976`
**Applied fix:** Added a new `## Inline Snapshots` section to `.planning/codebase/TESTING.md` (right above `## Fake Time`) covering:

1. **Use case** — pure formatter golden tests, exemplar = `profile.golden.test.ts` for M010-07 regression gating.
2. **When to use vs. external snapshots** — prefer inline up to ~25 lines per assertion; visibility in PR diff is the key motivation.
3. **When NOT to use** — non-deterministic outputs, DB-row dumps, long outputs.
4. **Update workflow** — concrete `npx vitest run -u <file>` command with the env vars the repo's test harness expects. Targeted single-file update preferred over `npm test -- -u`.
5. **Reviewer-discipline checklist (load-bearing)** — 4 tripwires to scan for in any snapshot update diff:
   - Third-person leaks (D-20, M010-07)
   - Internal field-name leaks (`tax_structure:`, `fi_phase:`, etc.)
   - Cross-locale English bleed (the WR-02 regression class)
   - ISO-date leaks where a localized form is expected (the IN-01 regression class)
6. **Deterministic time** — `vi.setSystemTime` + `vi.useRealTimers`; cross-reference to D-02 + the existing Fake Time section.

The narrower header comment inside `profile.golden.test.ts` was updated to point at the repo-wide section and reduced to file-specific notes (case count, FR/RU smoke scope, the new IN-01 staleness assertions). The "REJECT the update" reviewer warning that previously lived only in this header is now in TESTING.md where future M011+ surface authors will see it.

**Verification:**
- `tsc --noEmit` clean (test-file header change is a comment edit; docs change is a `.md` file)
- `vitest run profile.golden.test.ts profile.test.ts` → 30/30 passing (no test behavior change)
- Documentation diff reviewed for accuracy: every cross-reference (D-20, M010-07, D-02, WR-02, IN-01) resolves to a real concept in the codebase.

---

### IN-03: `from: { id: chatId }` test fixture removed

**Files modified:** `src/bot/handlers/__tests__/profile.test.ts`
**Commit:** `e762a95`
**Applied fix:** Removed the `from: { id: chatId }` line from `buildCtx`. Confirmed production handler at `src/bot/handlers/profile.ts:handleProfileCommand` reads only `ctx.chat?.id` — `ctx.from` is never accessed (verified via `grep "ctx\.from\|from\." src/bot/handlers/profile.ts` → no matches). Added a doc comment explaining the IN-03 motivation so a future contributor doesn't reinstate the field thinking it's load-bearing.

**Verification:**
- `tsc --noEmit` clean (no type signature touched)
- `vitest run profile.test.ts` → 8/8 passing (all existing handler tests pass with the fixture omitted, confirming the field was indeed unused)

---

### IN-04: `langOf` extracted to `src/chris/language.ts`

**Files modified:** `src/chris/language.ts`, `src/bot/handlers/profile.ts`, `src/bot/handlers/summary.ts`
**Commit:** `4221727`
**Applied fix:** Added `export type Lang = 'English' | 'French' | 'Russian'` and `export function langOf(raw: string | null): Lang` to `src/chris/language.ts`, immediately after `clearLanguageState` (co-located with `getLastUserLanguage` per the reviewer's suggestion — every caller pairs the two).

Removed the duplicate 3-line implementations from both handlers:
- `src/bot/handlers/profile.ts`: replaced the local `Lang` type + `langOf` function with `import { getLastUserLanguage, langOf, type Lang } from '../../chris/language.js'`. Preserved `export type { Lang }` so the golden-snapshot test can continue to `import { type Lang } from '../profile.js'` without reaching into `src/chris/`.
- `src/bot/handlers/summary.ts`: same import refactor.

**Other handlers reviewed:**
- `src/bot/handlers/decisions.ts` uses a different `isoLang(raw: string | null): 'en' | 'fr' | 'ru'` returning iso-code strings — explicitly NOT migrated (its iso-code shape is load-bearing for the switch statements in `usageMessage` / `tooLongMessage` / etc. — different contract from `Lang`).
- `src/bot/handlers/voice-decline.ts` has its own language pattern (`French: 'fr', Russian: 'ru'` lookup map) — not consuming `langOf`.
- `src/bot/handlers/ritual-callback.ts` does no language detection.
- `src/bot/handlers/document.ts` / `sync.ts` — no language detection.

So the M011+ surfaces will pick up `langOf` from `src/chris/language.ts` going forward, but the iso-code-shaped helpers in `decisions.ts` / `voice-decline.ts` are correctly left alone.

**Verification:**
- `tsc --noEmit` clean
- `vitest run profile.test.ts profile.golden.test.ts summary.test.ts` → 34/34 passing (8 profile handler + 20 profile golden + 6 summary), confirming behavior preserved across both consumers
- Spot-checked the import graph: nothing else imports `Lang` or `langOf` from the handler files (`grep -rln "langOf" src/`).

---

## Iteration 2 cumulative test impact

- Pre-iteration: 1610 passing / 0 failing / 1 skip (baseline preserved per CLAUDE.md)
- IN-01 added 2 new tests → +2
- IN-02 added 0 new tests (docs-only)
- IN-03 added 0 new tests (fixture-only change)
- IN-04 added 0 new tests (refactor, behavior preserved)
- Total after iteration 2 for the 4 targeted files: **90 tests passing**
  - `profile.test.ts`: 8/8
  - `profile.golden.test.ts`: 20/20 (16 EN snapshots + 4 FR/RU + 2 IN-01 staleness tests + 2 prior smoke = 20 in the language-coverage block)
  - `summary.test.ts`: 6/6
  - `personality.test.ts`: 56/56 (touched only via shared-module import path, no behavior change)

All 1610/0/1 baseline tests confirmed unaffected by the four iteration-2 changes (the surface area touched is narrowly scoped: profile.ts, summary.ts, language.ts, and two test files + one docs file).

---

_Iteration 1 fixed: 2026-05-13T12:30:00Z_
_Iteration 2 fixed: 2026-05-13T12:50:00Z_
_Fixer: Claude (gsd-code-fixer)_
