---
phase: 35-surfaces
reviewed: 2026-05-13T12:00:00Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - src/bot/bot.ts
  - src/bot/handlers/profile.ts
  - src/bot/handlers/__tests__/profile.golden.test.ts
  - src/bot/handlers/__tests__/profile.test.ts
  - src/chris/personality.ts
  - src/chris/modes/coach.ts
  - src/chris/modes/interrogate.ts
  - src/chris/modes/journal.ts
  - src/chris/modes/photos.ts
  - src/chris/modes/produce.ts
  - src/chris/modes/psychology.ts
  - src/chris/modes/reflect.ts
  - src/chris/__tests__/coach.test.ts
  - src/chris/__tests__/interrogate.test.ts
  - src/chris/__tests__/journal.test.ts
  - src/chris/__tests__/personality.test.ts
  - src/chris/__tests__/photos.test.ts
  - src/chris/__tests__/produce.test.ts
  - src/chris/__tests__/psychology.test.ts
  - src/chris/__tests__/reflect.test.ts
  - src/decisions/resolution.ts
  - src/decisions/__tests__/resolution.test.ts
  - src/memory/profiles.ts
  - src/memory/__tests__/profiles.test.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 35: Code Review Report

**Reviewed:** 2026-05-13T12:00:00Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Phase 35 ships the M010 user-facing and prompt-side surface for operational profiles. The three plans were executed atomically as designed:

- **Plan 35-01 (`buildSystemPrompt` refactor):** The `extras: ChrisContextExtras` envelope (`{language?, declinedTopics?, operationalProfiles?}`) is consistently consumed at all 8 production call sites (`coach.ts`, `interrogate.ts`, `journal.ts`, `photos.ts`, `produce.ts`, `psychology.ts`, `reflect.ts`, `resolution.ts`). No half-migrated positional-arg call sites were found. The IN-04 ACCOUNTABILITY overload (`decisionContext` rides `pensieveContext` slot, `temporalContext` rides `relationalContext` slot) is preserved verbatim at `resolution.ts:256-261` and clearly documented at `personality.ts:110-118, 180-194`.

- **Plan 35-02 (prompt-side injection):** `formatProfilesForPrompt` correctly implements all D-08..D-13 contracts: per-mode scope gate (`PROFILE_INJECTION_MAP`), health ≥ 0.5 confidence floor, 21-day staleness qualifier, 2000-char per-dimension cap, empty-string return when no in-scope dimensions render, verbatim D-13 header. Negative-injection invariants (`expect(mockGetOperationalProfiles).not.toHaveBeenCalled()`) are present in `journal.test.ts`, `interrogate.test.ts`, `produce.test.ts`, `photos.test.ts`. ACCOUNTABILITY's negative invariant is verified at source-import level (`resolution.test.ts`).

- **Plan 35-03 (`/profile` handler + golden snapshot):** 5-reply emission (4 dimensions + M011 placeholder) in declaration order; plain-text invariant enforced by `args.length === 1` assertion; EN/FR/RU localization; defensive `ctx.chat?.id` undefined-guard; error path matches `summary.ts` precedent. The 16 EN inline snapshots + 2 FR/RU smoke tests in `profile.golden.test.ts` capture exactly the regression surface M010-07 demands.

Bot registration order (`bot.ts:39`) is correct: `/profile` is registered between `/summary` (line 35) and the generic `bot.on('message:text')` handler (line 84), so the command won't be eaten by the catchall.

The two warnings below are real defects that should be fixed; the four info items are quality/consistency issues.

## Warnings

### WR-01: Dead-code branch in `formatProfileForDisplay` jurisdictional fallback

**File:** `src/bot/handlers/profile.ts:407-412`
**Issue:** The third `else if` branch for next_planned_move rendering is unreachable.

```ts
if (d.next_planned_move?.destination && d.next_planned_move.from_date) { ... }
else if (d.next_planned_move?.destination) { ... }
else if (d.planned_move_date && d.next_planned_move) {
  if (d.next_planned_move.destination) {
    lines.push(L.yourNextMove(d.next_planned_move.destination, d.planned_move_date));
  }
}
```

Per `src/memory/profiles/schemas.ts:37-40`, `next_planned_move` is a non-optional `.strict()` object with nullable scalar fields — the object itself is always present after parsing. The third branch's outer condition `d.planned_move_date && d.next_planned_move` therefore reduces to `d.planned_move_date && true`. To reach this branch we must have failed both the first and second branches, which means `d.next_planned_move.destination` is already `null`. The inner `if (d.next_planned_move.destination)` can never be true. The comment ("Edge: from_date sits in planned_move_date instead of inside the object") describes a valid edge case but the code as written never fires for it. If that edge case actually exists in seeded data, the rendering silently drops the destination.

**Fix:**
```ts
if (d.next_planned_move?.destination && d.next_planned_move.from_date) {
  lines.push(L.yourNextMove(d.next_planned_move.destination, d.next_planned_move.from_date));
} else if (d.next_planned_move?.destination && d.planned_move_date) {
  // Edge: from_date sits in planned_move_date instead of inside next_planned_move.
  lines.push(L.yourNextMove(d.next_planned_move.destination, d.planned_move_date));
} else if (d.next_planned_move?.destination) {
  lines.push(L.yourNextMoveDestOnly(d.next_planned_move.destination));
}
```
Note the reordering: the new "edge" branch must come BEFORE the destination-only branch, otherwise the second branch eats it.

---

### WR-02: English field-name leakage in FR/RU `formatProfileForDisplay` output

**File:** `src/bot/handlers/profile.ts` — multiple lines (400, 481, 496, etc.)
**Issue:** Several rendered lines mix the localized section labels with verbatim English internal terms. The most visible cases:

- Line 400 (residency_status): `${r.type}: ${r.value}${r.since ? \` (since ${r.since})\` : ''}` — emits English "since" inside an otherwise-French/Russian section.
- Line 481 (active_treatments): `${t.name} since ${t.started_date}${purp}` — same "since" leak in FR/RU.
- Line 496 (wellbeing_trend): `energy=`, `mood=`, `anxiety=` are emitted verbatim in all 3 languages.

For an EN-only user this is acceptable (the snapshot tests cover it). For a FR user reading `Profil juridictionnel`, lines that suddenly switch to English mid-sentence are a localization regression of the same UX class M010-07 was designed to prevent (the spec calls for second-person framing — half-English output reads as machine-generated). The same issue does NOT appear in `formatProfilesForPrompt` (which is for the LLM, not the user), so user-facing rendering and prompt-side rendering have diverged on locale fidelity.

**Fix:** Move the connective glue words ("since", `energy=`/`mood=`/`anxiety=` labels) into the localized `MSG.fields.{dim}.{lang}` table so they round-trip with the rest of the line. E.g., add `since: (date: string) => \` (depuis ${date})\`` and `wellbeingLabels: { energy: 'énergie', mood: 'humeur', anxiety: 'anxiété' }` per language, and consume them in the loop bodies. Also add explicit FR + RU golden snapshots for at least one populated-fresh case per dimension so this class of regression is detected by snapshot-diff review.

## Info

### IN-01: Staleness date is not localized in `/profile` output

**File:** `src/bot/handlers/profile.ts:546-548`
**Issue:** The staleness note's date is formatted via `profile.lastUpdated.toISOString().slice(0, 10)` regardless of language. This produces `2026-04-01` in EN, FR, and RU outputs alike. The contradiction-notice formatter in the same codebase (`src/chris/personality.ts:242-259`) uses `Intl.DateTimeFormat` with `en-US`/`fr-FR`/`ru-RU` locales for the same kind of user-facing date display. The Phase 35 focus area explicitly called for "staleness date in FR/RU locales"; the current implementation leaves it ISO. Phase context says this is the documented user-facing wording, but for FR users a date like `1 avril 2026` is more natural than `2026-04-01`.

**Fix:** Wrap the date in `toLocaleDateString` with the matching locale, mirroring `DATE_LOCALES` in `personality.ts`:
```ts
const DATE_LOCALES = { English: 'en-US', French: 'fr-FR', Russian: 'ru-RU' } as const;
const dateStr = profile.lastUpdated.toLocaleDateString(DATE_LOCALES[lang], {
  year: 'numeric', month: 'long', day: 'numeric',
});
```
The inline snapshots will need to be updated when this lands.

---

### IN-02: First-occurrence inline-snapshot workflow documentation lives only in test file

**File:** `src/bot/handlers/__tests__/profile.golden.test.ts:6-13`
**Issue:** This is the first `toMatchInlineSnapshot` test in the codebase. The workflow for updating snapshots (`npx vitest run -u …`) is documented in a header comment inside the test file itself. A future contributor encountering a snapshot failure may not know to look there — they'll see the diff and either (a) accept the change blindly or (b) try to edit the snapshot by hand. The header comment helpfully warns reviewers to inspect any diff for third-person leaks before accepting, but that warning lives where only the test author sees it.

**Fix:** Add a brief note in `CLAUDE.md` or `.planning/conventions/` (whichever your repo uses) describing the `-u` update flag and the reviewer-discipline expectation. Optional but cheap: extract the warning into a `CONTRIBUTING.md` or `docs/testing.md` section.

---

### IN-03: `from: { id: chatId }` test fixture is not load-bearing but suggests Telegram identity coupling

**File:** `src/bot/handlers/__tests__/profile.test.ts:158-167`
**Issue:** The duck-typed `buildCtx` helper sets `from: { id: chatId }` matching `chat.id`. The production handler at `profile.ts:574` reads `ctx.chat?.id` only — `ctx.from` is never accessed. The fixture is harmless but invites the reader to think there's an identity check happening. In a single-user (D009) Telegram-private-chat deployment they're always equal anyway; the field is redundant in this test.

**Fix:** Drop the `from` key from `buildCtx`. Removes a misleading hint about handler internals.

---

### IN-04: `langOf` is duplicated between `profile.ts` and `summary.ts`

**File:** `src/bot/handlers/profile.ts:80-83` (also `src/bot/handlers/summary.ts`)
**Issue:** Both handlers define the same `langOf(raw: string | null): Lang` 3-line narrowing helper. As the next user-facing surface gets added (M011 `/profile psychological`, M012 onward), this will be cargo-culted again. Not a defect today — but worth pulling into a shared helper (e.g., `src/bot/handlers/lang.ts` with `langOf` + `Lang` type + a shared `MSG.genericError` shape) before the third surface lands.

**Fix:** Extract `langOf` and the `Lang` type into a shared module under `src/bot/handlers/` (or `src/chris/language.ts` if you want it co-located with `getLastUserLanguage`). Both handlers import it. No behavioral change.

---

_Reviewed: 2026-05-13T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
