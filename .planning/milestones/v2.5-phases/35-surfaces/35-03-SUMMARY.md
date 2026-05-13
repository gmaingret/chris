---
phase: 35-surfaces
plan: "03"
subsystem: profile-command
tags:
  - phase-35
  - surfaces
  - profile-command
  - format-profile-for-display
  - golden-snapshot
  - hard-co-loc-m10-5
  - typescript
  - vitest
  - first-snapshot-test

# Dependency graph
requires:
  - phase: 33-profile-substrate
    provides: getOperationalProfiles reader + ProfileRow<T> + Dimension type + 4 ProfileData types
  - plan: 35-01
    provides: buildSystemPrompt extras envelope (not directly used by /profile but co-shipped to M010 substrate)
  - plan: 35-02
    provides: Dimension type re-export from src/memory/profiles.ts
provides:
  - handleProfileCommand exported from src/bot/handlers/profile.ts
  - formatProfileForDisplay(dimension, profile, lang) pure function — user-facing 2nd-person Telegram renderer
  - Lang type ('English' | 'French' | 'Russian') exported
  - /profile Telegram command registered in src/bot/bot.ts between /summary and generic text handler
  - 16 inline-snapshot golden tests (4 dim × 4 states EN) + 2 FR/RU smoke tests
  - 8 handler integration tests (5-reply assertion, reply order, all-null fallback, plain-text invariant, error path with logger.warn assertion, EN fallback, FR localization, defensive early-return)
  - M010-07 regression gate (golden snapshot prevents third-person leak / internal field-name leak / JSON-dump aesthetic)
  - First toMatchInlineSnapshot usage in codebase with TSDoc workflow note for future maintainers
affects:
  - phase-36 (PTEST live anti-hallucination test reads the same OperationalProfiles substrate)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern: toMatchInlineSnapshot golden-output regression gate (first occurrence in codebase; TSDoc workflow note for future maintainers documents the vitest -u + manual-review pattern)"
    - "Pattern: per-dimension switch-case in pure formatter (CONTEXT.md Claude's Discretion — v1 inline switch; config-object refactor deferred until M011/M012 add more dimensions)"
    - "Pattern: 2nd-person localized field-label sub-map per dimension (MSG.fields.<dim>.<lang>.<field>) with arrow-function templates for variable interpolation"
    - "Pattern: capturedAllArgs Grammy spy variant — captures FULL ctx.reply arg list (not just args[0]) so plain-text SURF-05 invariant is load-bearing in tests"
    - "Pattern: deterministic Date.now() in pure-function tests via vi.setSystemTime(FIXED_DATE) in beforeAll + vi.useRealTimers() in afterAll (D-02 — vi.useFakeTimers forbidden because postgres.js timers)"

key-files:
  created:
    - .planning/phases/35-surfaces/35-03-SUMMARY.md
    - src/bot/handlers/profile.ts
    - src/bot/handlers/__tests__/profile.test.ts
    - src/bot/handlers/__tests__/profile.golden.test.ts
  modified:
    - src/bot/bot.ts

key-decisions:
  - "Inline switch-case formatter (v1, per CONTEXT.md Claude's Discretion default). Per-dimension config object deferred until M011/M012 add more dimensions — current 4-dimension switch is readable and explicit."
  - "Inline MSG localization map (consistent with summary.ts / decisions.ts existing pattern) rather than shared src/bot/handlers/_strings.ts extraction. Shared module would add indirection without clear payoff at single-handler scale."
  - "buildCtx Grammy spy captures FULL ctx.reply arg array (args: unknown[][]) rather than just args[0]: string. This makes the SURF-05 plain-text invariant directly assertable via args.length === 1 — a future regression that adds { parse_mode: 'Markdown' } as a second argument fails the test immediately."
  - "STALENESS_MS constant duplicated in src/bot/handlers/profile.ts (rather than imported from src/memory/profiles.ts) to keep profile.ts dependency-light. Both use the same 21-day threshold per D-10 / D-22; if the threshold ever changes, both sites need update — a comment notes the linkage."
  - "M011 placeholder verbatim text per D-18: 'Psychological profile: not yet available — see M011.' EN, with localized FR/RU equivalents. The 'M011' marker is verbatim across all 3 languages so future grep-based tooling can match the milestone identifier."
  - "Pending-tests rendering uses status-disambiguation: when status='scheduled' AND scheduled_date is set, emit '(scheduled YYYY-MM-DD)' rather than '(scheduled, scheduled YYYY-MM-DD)'. Fix applied during Task 2 review when the first -u populated the redundant string. Snapshots re-populated after fix."
  - "Defensive early-return when ctx.chat is undefined (8th integration test). Grammy permits Context without chat for callback_query / inline_query / etc.; the handler must not throw on those updates even though command-handlers don't typically fire there. Asserts via expect(getOperationalProfiles).not.toHaveBeenCalled()."

patterns-established:
  - "First inline-snapshot test in codebase. Workflow documented inline in test file's TSDoc header so future maintainers know to run `npx vitest run -u src/bot/handlers/__tests__/profile.golden.test.ts` on rendering changes, then REVIEW the diff for M010-07 regressions (third-person leak / internal field-name leak)."
  - "Golden-snapshot review checklist applied: no 'Greg's'/'His'/'He has' (third-person); no 'tax_structure:' / 'fi_phase:' raw field-name leaks; no parse_mode-flavored chars (**bold**, _italic_, `code`, ===, ---); populated-stale cases contain the localized staleness note; null/zero-confidence cases contain the actionable progress indicator. All 16 snapshots pass."
  - "HARD CO-LOCATION #M10-5 enforced: handler (handleProfileCommand) + pure formatter (formatProfileForDisplay) + golden test (profile.golden.test.ts) all land in this single plan. Shipping the handler without the regression net is now impossible because the M10-5 gate failed-fast in plan-checker if any of the three were split."
  - "5-reply contract (D-18): handler integration test asserts captured.length === 5 (4 dimensions + M011 placeholder) for the populated path AND the all-null path. Per-dimension failure isolation is structural: each ctx.reply awaits sequentially, so an early dimension's reply ships even if a later dimension's formatProfileForDisplay throws (though the formatter is exception-free over the typed OperationalProfiles shape — any throw bubbles to the catch and emits genericError)."

requirements-completed:
  - SURF-03
  - SURF-04
  - SURF-05

# Metrics
duration: ~50 min
completed: 2026-05-13
---

# Phase 35 Plan 03: /profile Command + formatProfileForDisplay + Golden Snapshot Summary

**`/profile` Telegram command shipped with handleProfileCommand + formatProfileForDisplay pure function + 16-case inline-snapshot golden test + bot registration — all atomically per HARD CO-LOC #M10-5. M010-07 regression gate (third-person framing detector) now active. Phase 35 SURF block 5/5 complete. Full Docker suite delta: +26 new passing tests / 0 new failures.**

## Performance

- **Duration:** ~50 min (03:14 → 03:30 UTC, includes 1 snapshot-review iteration + full Docker suite run + handler integration suite write)
- **Tasks:** 5 (1 skeleton + 1 TDD formatter+golden + 1 handler+integration + 1 bot registration + 1 full Docker gate)
- **Files created:** 4 (this SUMMARY.md + 3 production/test files)
- **Files modified:** 1 (src/bot/bot.ts — 5 new lines: 1 import + 4 registration)
- **Total new lines of code:** 1452 (profile.ts 605 + profile.test.ts 316 + profile.golden.test.ts 531 + bot.ts +5)

## Accomplishments

- **`handleProfileCommand(ctx)`** shipped in `src/bot/handlers/profile.ts`:
  - Reads `getOperationalProfiles()` (Phase 33 never-throw reader)
  - Iterates 4 dimensions in declaration order: `jurisdictional → capital → health → family`
  - Sends 1 `ctx.reply(formatProfileForDisplay(dim, profiles[dim], lang))` per dimension
  - Sends 5th `ctx.reply(MSG.m011Placeholder[lang])` (D-18)
  - All replies plain text — no `parse_mode` argument anywhere (D-17 + SURF-05)
  - Localized to EN/FR/RU via `getLastUserLanguage(chatId.toString())` (D-19, in-memory cache; NOT `getLastUserLanguageFromDb`)
  - try/catch wraps the whole body: any throw → `logger.warn({ chatId, error }, 'profile.command.error')` + single `ctx.reply(MSG.genericError[lang])`
  - Defensive early-return when `ctx.chat?.id` is undefined (Grammy non-message-update tolerance)
- **`formatProfileForDisplay(dimension, profile, lang)`** shipped as a pure function in the same file:
  - `profile === null OR profile.confidence === 0` → returns localized actionable progress indicator (D-21): `"Chris needs more entries about your {dimensionHint} before populating this profile."` (EN form; FR/RU equivalents in MSG map)
  - Populated → `${sectionTitle[dim][lang]} (${confidence[lang]} NN%)` + blank line + per-field 2nd-person lines from `profile.data` via per-dimension switch-case
  - `lastUpdated > 21 days ago` → appends blank line + localized staleness note (D-22): `"Note: profile data from YYYY-MM-DD — may not reflect current situation."` (matches D-10 prompt-side threshold, different wording per Plan 35-02 SUMMARY)
  - Pure function: no I/O, no DB, no logger calls, no ctx — deterministic given (dimension, profile, lang, Date.now())
  - All field labels 2nd-person: `"You're currently in..."`, `"Your tax residency:"`, `"Ta résidence fiscale :"`, `"Твоё налоговое резидентство:"` — never `"Greg's..."`, `"His..."`, `"He has..."` (D-20 + M010-07 mitigation)
- **MSG localization map** with full EN + FR + RU coverage:
  - 4 dimensions × `sectionTitle` (12 strings)
  - 4 dimensions × `dimensionHint` (12 strings)
  - `confidence` / `insufficientData` / `staleNote` / `m011Placeholder` / `genericError` (15 strings/template-fns)
  - Per-dimension `fields` sub-map: jurisdictional (~8 labels × 3 langs = 24), capital (~9 × 3 = 27), health (~6 × 3 = 18), family (~7 × 3 = 21) — total ~145 localized strings/templates
- **`/profile` command registered** in `src/bot/bot.ts:35-37`:
  - `import { handleProfileCommand } from './handlers/profile.js';` (line 12)
  - `bot.command('profile', handleProfileCommand as any);` (line 37 — sits between `/summary` line 34 and generic `bot.on('message:text')` line 82)
  - Ordering invariant verified: summary < profile < text via awk script in Task 4 acceptance check
- **16-case inline-snapshot golden test suite** in `src/bot/handlers/__tests__/profile.golden.test.ts`:
  - 4 dimensions × 4 states (null / zero-confidence / populated-fresh / populated-stale) in English
  - 2 FR/RU language-coverage smoke tests assert localized section labels + 2nd-person framing markers (Tu/Ta/Ton/Tes for FR, Ты/Твой/Твоя/Твоё for RU) + negative invariant (no English label leak, no Greg/His third-person leak)
  - **Project's FIRST `toMatchInlineSnapshot` usage** — test file's TSDoc header documents the `vitest -u` review workflow for future maintainers
  - All 16 EN snapshots manually reviewed: NO third-person leak, NO internal field-name leak (`tax_structure`, `fi_phase` raw), NO parse_mode-flavored markdown chars (`**bold**`, `_italic_`, `` `code` ``, `===`, `---`)
  - 4 populated-stale snapshots contain the localized staleness note (`"Note: profile data from 2026-04-01 — may not reflect current situation."`)
  - 8 null/zero-confidence snapshots contain the localized actionable progress indicator (`"Chris needs more entries about your ..."`)
  - Deterministic: `vi.setSystemTime(FRESH_DATE)` in `beforeAll` + `vi.useRealTimers()` in `afterAll` (D-02 — `vi.useFakeTimers` forbidden because postgres.js keep-alive)
- **8-test handler integration suite** in `src/bot/handlers/__tests__/profile.test.ts`:
  1. `emits exactly 5 ctx.reply calls when all 4 profiles are populated (D-18)` — populated fixture; assert `captured.length === 5`
  2. `reply order is jurisdictional → capital → health → family → M011 placeholder` — per-reply `.toContain('Jurisdictional Profile')` / `Capital Profile` / `Health Profile` / `Family Profile` / `M011|Psychological profile`
  3. `gracefully handles all-null profiles → 5 replies with progress indicators (D-21)` — `getOperationalProfiles` returns all-null; assert 5 replies + each dim's hint phrase
  4. `uses plain text — no parse_mode arg on any ctx.reply (SURF-05)` — assertion uses extended buildCtx spy that captures FULL args array; asserts `args.length === 1` AND `typeof args[0] === 'string'` for all 5 calls
  5. `logs profile.command.error and replies with genericError when getOperationalProfiles throws` — `mockRejectedValueOnce`; assert 1 reply (genericError) + `mockLoggerWarn` called once with payload `{ chatId, error }` + logKey `'profile.command.error'`
  6. `falls back to English when getLastUserLanguage returns null (D-19 fallback)` — default state; assert M011 placeholder is in English form
  7. `localizes to French when getLastUserLanguage returns French` — `setLastUserLanguage(FIXTURE_CHAT_ID, 'French')`; assert `'Profil juridictionnel'` + FR M011 placeholder
  8. `returns silently when ctx.chat is undefined (defensive early-return)` — ctx without chat field; assert 0 replies + `getOperationalProfiles.not.toHaveBeenCalled`
- **Full Docker suite green:** `29 failed | 1568 passed | 12 skipped (1609)` — **delta from Plan 35-02 baseline (1542/29/12) = +26 new tests passing, 0 new failures**
- **`npx tsc --noEmit` exits 0**

## Task Commits

| # | Description | Hash |
|---|-------------|------|
| 1 | profile.ts skeleton — MSG map + Lang + langOf + stubs | `8f06dbf` |
| 2 | formatProfileForDisplay + 16 inline-snapshot golden test + FR/RU smoke | `0b0f1ab` |
| 3 | handleProfileCommand + 8-test integration suite (5-reply, error path, FR locale) | `a62136d` |
| 4 | register /profile in bot.ts between /summary and generic text handler | `7417c84` |
| 5 | full Docker suite green — Phase 35 close (verification commit) | `8e62fd7` |

**Plan metadata commit:** added by execute-plan.md harness with this SUMMARY.md.

## Files Created/Modified

**Created (4):**
- `.planning/phases/35-surfaces/35-03-SUMMARY.md` — this file
- `src/bot/handlers/profile.ts` — 605 lines (handler + formatter + MSG localization map)
- `src/bot/handlers/__tests__/profile.test.ts` — 316 lines (8 integration tests)
- `src/bot/handlers/__tests__/profile.golden.test.ts` — 531 lines (18 tests: 16 EN snapshots + 2 FR/RU smoke)

**Modified — production code (1 file):**
- `src/bot/bot.ts` — +5 lines (1 import + 4-line `bot.command('profile', ...)` block)

## Decisions Made

- **Inline switch-case formatter (v1) per CONTEXT.md Claude's Discretion default.** Each dimension renders different fields; a per-dimension config object would enable future locale additions but adds indirection. At 4 dimensions, the switch-case body is ~80 lines per dimension and remains directly readable. Refactor to config-object only if M011/M012 add more dimensions.
- **Inline MSG localization map (not a shared `src/bot/handlers/_strings.ts`).** Consistent with `summary.ts:56-82` + `decisions.ts` existing pattern. Shared module would save ~50 lines across handlers but adds an import edge — DRY win is below the abstraction-pays-off threshold at single-handler scale.
- **Per-dimension labels live in MSG.fields.<dim>.<lang>** rather than top-level `MSG.labels`. The summary.ts pattern uses flat `MSG.labels[lang]` because /summary renders a single shape; /profile renders 4 dimensions with different field sets, so the nested structure scales better and keeps each dimension's labels co-located. Trade-off: deeper key access (`MSG.fields.jurisdictional.English.yourTaxResidency(...)`) but no per-dimension label collisions.
- **buildCtx Grammy spy captures FULL args[][]** (not just `args[0]: string`). The plan's acceptance criterion for SURF-05 says "verify via the captured array length per reply (each reply call site passes 1 arg only)" — the stronger assertion (`args.length === 1` per call) is more load-bearing because a future regression that adds `{ parse_mode: 'Markdown' }` as the second arg fails the test immediately. Trade-off: buildCtx signature now exposes `capturedAllArgs: unknown[][]` alongside the simpler `captured: string[]`.
- **STALENESS_MS constant duplicated** in `src/bot/handlers/profile.ts` rather than imported from `src/memory/profiles.ts`. Both use the same 21-day threshold (D-10 / D-22 alignment); duplication is intentional to keep profile.ts dependency-light. If the threshold changes, both sites need synchronized update — a comment notes the linkage.
- **Pending-tests rendering disambiguates "scheduled" status word**. The first `vitest -u` populated `(scheduled, scheduled 2026-05-25)` — redundant because the status word duplicates the noun in "scheduled YYYY-MM-DD". Fixed during Task 2 review to emit `(scheduled 2026-05-25)` when status === 'scheduled' AND scheduled_date is set; for any other status, the format remains `(status, scheduled YYYY-MM-DD)`. Snapshots re-populated after fix.
- **8th defensive test** (`returns silently when ctx.chat is undefined`) — not in the plan's minimum 5+ tests but valuable: Grammy's Context type permits chat=undefined for non-message updates (callback_query, inline_query, etc.). Command-handlers wouldn't normally fire there, but a defensive handler costs one if-check and prevents the future class of `Cannot read property 'id' of undefined` regressions. Test asserts `getOperationalProfiles.not.toHaveBeenCalled` to verify the short-circuit fired before the read.
- **Plan-checker warning #2 closure (Task 5 acceptance #4).** The plan flagged that "All 5 ROADMAP success criteria #1-5 verifiable" is prose, not a runnable command. Closed via: (1) the Docker test gate output (1568 passed / 29 pre-existing failures) is itself the verification artifact; (2) the per-task acceptance commands above each verify a specific success-criterion clause. No DEVIATION-LOG.md entry needed because the substitution was minimal — replaced an unrunnable prose check with a runnable test-count delta.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Pending-tests rendering redundancy when status='scheduled'**
- **Found during:** Task 2 (after first `vitest -u` populated the health populated-fresh snapshot)
- **Issue:** The pending-tests bullet emitted `- thyroid panel (scheduled, scheduled 2026-05-25)` when `status='scheduled'` AND `scheduled_date='2026-05-25'`. Reads as a typo to the user; the duplicated "scheduled" word is the noun and the status word colliding.
- **Fix:** Added a status-disambiguation branch: when `status.toLowerCase() === 'scheduled'` AND `scheduled_date` is set, emit `scheduled YYYY-MM-DD` (status word dropped because the noun already conveys it). For any other status (e.g., `'awaiting referral'`), keep the original `(status, scheduled YYYY-MM-DD)` shape.
- **Files modified:** `src/bot/handlers/profile.ts`
- **Commit:** `0b0f1ab` (Task 2 — snapshots re-populated after fix)

### Plan-Checker Warning Closures

**Warning #1: HARD CO-LOC #M10-5 verification** — closed by shipping handler + formatter + golden test in this plan as the plan-checker required. Verified via `git log --oneline | grep 35-03` → 5 commits, all in this plan.

**Warning #2: Task 5 acceptance criterion #4 "All 5 ROADMAP success criteria #1-5 verifiable" is prose, not a runnable command** — closed by substituting the prose claim with the runnable test-count delta (1568 passed, +26 new, 0 new failures). Documented inline above.

## Issues Encountered

- **Vitest `--reporter=basic` flag rejected** by the project's vitest v4.1.2 setup ("Failed to load url basic"). Worked around by running without the reporter flag (default reporter is fine). Not a blocker.
- **DB-needing tests fail outside the Docker harness** (e.g., summary.test.ts ECONNREFUSED 127.0.0.1:5433). Expected — those tests are designed to run inside `bash scripts/test.sh` which spins up a local postgres container first. The full Docker suite gate (Task 5) covers them.
- **No other issues.** The Wave 1 (Plan 35-01) + Wave 2 (Plan 35-02) substrate landed clean — all imported types and reader APIs work as documented in their SUMMARYs.

## Verification Results

### TypeScript compile
```
npx tsc --noEmit   → exit 0
```

### Plan 35-03 unit tests (in-scope)

**profile.golden.test.ts (formatProfileForDisplay golden snapshots):**
```
DATABASE_URL=... npx vitest run profile.golden
→ 1 file passed, 18/18 tests (16 EN inline snapshots + 2 FR/RU smoke)
```

**profile.test.ts (handleProfileCommand integration):**
```
DATABASE_URL=... npx vitest run profile.test
→ 1 file passed, 8/8 tests
```

### Full Docker suite (regression gate)
```
bash scripts/test.sh
→ 29 failed | 1568 passed | 12 skipped (1609)
```

**Delta from Plan 35-02 baseline (1542 passed / 29 failed / 12 skipped / 1583 total):**
- **+26 new tests** (1568 - 1542), all passing
- **+0 new failures** (29 = 29)
- **+0 new skips** (12 = 12)
- **Total +26 breakdown:** 16 inline EN snapshots + 2 FR/RU smoke = 18 (profile.golden.test.ts) + 8 (profile.test.ts) = 26 ✓

The 29 failures are the unchanged pre-existing live-API authentication errors in the same 5 documented test files (live-integration.test.ts / live-accountability.test.ts / vague-validator-live.test.ts / live-anti-flattery.test.ts / models-smoke.test.ts) — all 401 invalid x-api-key, same set Plan 35-02 SUMMARY documented and deferred-items.md tracks.

### Acceptance criteria verification

**Task 1 (skeleton):**
```
test -f src/bot/handlers/profile.ts                              → OK
grep -c "export type Lang" src/bot/handlers/profile.ts           → 1
grep -c "export function formatProfileForDisplay" ...            → 1
grep -c "export async function handleProfileCommand" ...         → 1
grep -cE "Jurisdictional Profile|Capital Profile|..." ...        → 4 (EN)
grep -cE "Profil juridictionnel|Profil patrimonial|..." ...      → 4 (FR)
grep -cE "Юрисдикционный профиль|Финансовый профиль|..." ...     → 4 (RU)
grep -c "M011" src/bot/handlers/profile.ts                       → 5
grep -cE "21 \* 86_?400_?000|STALENESS_MS|21 days" ...           → 5
```

**Task 2 (formatter + golden):**
```
test -f src/bot/handlers/__tests__/profile.golden.test.ts        → OK
grep -c "toMatchInlineSnapshot" profile.golden.test.ts           → 16
it(...) count                                                     → 18 (16 EN + 2 FR/RU)
M010-07 leaks in actual snapshot content                          → 0
"Note: profile data from" in snapshots                            → 4 (4 dim × 1 stale case)
"Chris needs more entries" in snapshots                           → 8 (4 dim × 2 cases: null + zero-conf)
```

**Task 3 (handler + integration test):**
```
test -f src/bot/handlers/__tests__/profile.test.ts               → OK
"buildCtx" usage                                                  → 9
toHaveLength(5) usage                                             → 5 (across 3 tests)
"profile.command.error" log key                                   → 3
it(...) count                                                     → 8
"for (const dim of" in handler                                    → 1
parse_mode/parseMode in production code (excluding doc comments) → 0
getLastUserLanguageFromDb in production code                      → 0 (only in 2 doc comments)
```

**Task 4 (bot registration):**
```
grep -c "import { handleProfileCommand }" src/bot/bot.ts         → 1
grep -cE "bot\.command\('profile'" src/bot/bot.ts                → 1
grep -cE "bot\.command\('profile'.*handleProfileCommand as any" → 1
order check (summary < profile < text)                            → OK
npx tsc --noEmit error count                                      → 0
```

**Task 5 (full Docker gate):**
```
bash scripts/test.sh → 1568 passed / 29 failed / 12 skipped → DELTA +26/0/0
git log --oneline | grep -c "35-03"                              → 5 (Tasks 1-5 all committed)
```

## Threat Model Disposition

Per `<threat_model>` in 35-03-PLAN.md:

| Threat ID | Status |
|-----------|--------|
| T-35-03-V7-01 (Info Disclosure via internal field-name leak) | **mitigated** — 16 inline snapshots manually reviewed; no `tax_structure:` / `fi_phase:` raw field names appear. Any future rendering change forces `vitest -u` and reviewer-visible diff. The TSDoc header in `profile.golden.test.ts` documents the M010-07 review checklist for future maintainers. |
| T-35-03-V7-02 (Info Disclosure via Markdown injection from profile content) | **mitigated** — `parse_mode` never passed to `ctx.reply` (verified by `grep -E "parse_mode" src/bot/handlers/profile.ts | grep -vE "(\\*|//)"` → 0 code matches; all 5 mentions are doc comments). Plain text invariant asserted in integration test #4 via `capturedAllArgs[i].length === 1`. |
| T-35-03-V8-01 (Speculative health data shown to user — accepted) | **accept** — `/profile` shows all 4 dimensions regardless of confidence (unlike Plan 35-02's prompt-side 0.5 health gate). Intentional per D-21: low-confidence health renders as the actionable progress indicator ("Chris needs more entries about your wellbeing..."), which IS the UX signal Greg needs to know the profile is sparse. Hiding low-conf would hide the feedback loop. |
| T-35-03-V11-01 (Elevation via /profile sub-command parsing) | **mitigated** — `ctx.message.text` is read NOWHERE in `handleProfileCommand`. No regex, no split, no `ctx.match` access. `/profile edit jurisdictional ...` routes to the same handler and emits the same 5 replies (no edit pathway). Verified by `grep -E "message\.text\.split|ctx\.match" src/bot/handlers/profile.ts` → 0 matches. |
| T-35-03-V7-03 (Repudiation via silent failure) | **mitigated** — try/catch wraps the full handler body; on throw, `logger.warn({ chatId, error }, 'profile.command.error')` + single localized `genericError` reply. Integration test #5 asserts the log payload shape (chatId + error message) + the exact log key. Operator sees one reply, never silence. |
| T-35-03-V8-02 (PII in logger.warn) | **mitigated** — only `chatId` (Greg's own ID, single-user app) + `err.message` (which comes from `getOperationalProfiles` → never user-content) reach the structured log. No profile field values logged. Same Pino pattern summary.ts:209-216 uses. |

**Security gate disposition:** All 5 high-severity threats mitigated. The one accept (low-confidence health in /profile output) is explicit UX trade-off per D-21 — different surface (user-facing introspection) than prompt-side (Sonnet reasoning).

## Threat Flags

No new security-relevant surface introduced beyond the threat model. `/profile` is read-only (no edit), no `parse_mode` (no Markdown injection), no sub-argument parsing (no elevation), no new network endpoints (Telegram outbound only via existing `ctx.reply` boundary), no schema changes. All injection surfaces flow through `formatProfileForDisplay` → `ctx.reply(string)` — the same trust boundary every existing `/summary`-style handler uses.

## Known Stubs

**None.** All exported symbols (`Lang`, `formatProfileForDisplay`, `handleProfileCommand`) are fully implemented and tested. The `M011 psychological profile placeholder` is INTENTIONALLY a fixed placeholder string (D-18) — the M011 milestone (psychology dimension) is the future plan that will replace this with real content. The placeholder is not a stub; it's the spec-compliant 5th reply per D-18 and per the M010 → M011 staged shipping plan.

## Phase 35 Close-out — 5 ROADMAP Success Criteria

| # | Criterion | Closed by |
|---|-----------|-----------|
| 1 | `buildSystemPrompt` refactored atomically | Plan 35-01 (extras envelope, mechanical signature migration, 230+47 regression lines pass) |
| 2 | REFLECT/COACH/PSYCHOLOGY inject operational profiles; JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY do NOT | Plan 35-02 (PROFILE_INJECTION_MAP + formatProfilesForPrompt + 3 positive + 5 negative invariant tests) |
| 3 | `/profile` returns plain-text 2nd-person Telegram summary with M011 placeholder | **Plan 35-03** (handleProfileCommand + 5-reply contract integration test) |
| 4 | Golden-output snapshot passes for `/profile` rendering | **Plan 35-03** (16 inline snapshots + 2 FR/RU smoke + M010-07 review checklist) |
| 5 | All-null profiles return empty prompt-side injection AND localized progress indicator user-side | Plan 35-02 (formatProfilesForPrompt returns `""` per D-12.b) + **Plan 35-03** (formatProfileForDisplay returns localized actionable indicator per D-21) |

**Phase 35 (Surfaces) ships.** M010 milestone block: 5/5 PROF (Phase 33) + 7/7 GEN (Phase 34) + 5/5 SURF (Phase 35) = **17/22 M010 requirements complete**. Remaining: 5 PTEST-* (live anti-hallucination + primed fixtures + integration tests) belong to Phase 36.

## Next Plan Readiness — Phase 36 PTEST

Phase 36 can now:
- Consume `OperationalProfiles` shape from `src/memory/profiles.ts` (Phase 33 substrate; Plan 35-02 also extended it with `Dimension` + `PROFILE_INJECTION_MAP` + `formatProfilesForPrompt`)
- Reference `formatProfileForDisplay` from `src/bot/handlers/profile.ts` if PTEST tests need user-facing rendering assertions (the prompt-side `formatProfilesForPrompt` is more likely the live-test target — see PTEST-05 charter)
- Build the `m010-30days` primed fixture knowing the 4 profile tables' SELECT contract is exercised by tests in `src/memory/__tests__/profiles.test.ts` + the Drizzle schema in `src/db/schema.ts` is stable post-Plan-33
- Trust the M010-07 regression gate: live anti-hallucination test in PTEST-05 can assert against the populated `formatProfilesForPrompt` output for REFLECT mode, knowing that any third-person leak in the prompt injection would have failed the snapshot test before reaching Phase 36 (Plan 35-02 + 35-03 collectively prevent the M009 first-Sunday class)

## User Setup Required (Greg-only operator steps post-merge)

1. **Merge Plan 35-03 deliverables to main branch** (orchestrator owns; this executor runs in worktree)
2. **Deploy to Proxmox** per existing protocol (the M010 inference engine cron + bot already run there from Phase 34 deploy 2026-05-13)
3. **Manual Telegram smoke test of `/profile`** post-deploy:
   - Send `/profile` to Chris in EN — expect 5 plain-text messages (jurisdictional, capital, health, family, "Psychological profile: not yet available — see M011")
   - Switch session language by sending a French message first, then `/profile` — expect 5 messages with `Profil juridictionnel`, `Profil patrimonial`, etc.
   - Same for Russian via a Russian opener
4. **Observe 2026-05-17 Sunday 22:00 Paris cron fire** (first scheduled M010 inference engine fire post-Phase-34 deploy):
   - After the fire, the 4 profile tables should hold populated rows
   - Send `/profile` AFTER the fire — expect populated 2nd-person summaries with realistic confidence percentages (not zero-confidence progress indicators)
   - Send a REFLECT-mode message (a journal-style entry) after the fire — verify Chris's reply references concrete facts from the operational profile block (e.g., "given your current accumulation phase..." or "given you're in Tbilisi until September...")

## Self-Check

Verifying claims before signoff:

```
# Created files
[ -f .planning/phases/35-surfaces/35-03-SUMMARY.md ]            → FOUND (this file, after write)
[ -f src/bot/handlers/profile.ts ]                              → FOUND
[ -f src/bot/handlers/__tests__/profile.test.ts ]               → FOUND
[ -f src/bot/handlers/__tests__/profile.golden.test.ts ]        → FOUND

# Modified files
git diff main -- src/bot/bot.ts | grep -c "^+"                   → 6 (5 net new lines + 1 diff context)

# Task commits
git log --all --oneline | grep -c 8f06dbf                       → 1 (Task 1 — skeleton)
git log --all --oneline | grep -c 0b0f1ab                       → 1 (Task 2 — formatter + golden)
git log --all --oneline | grep -c a62136d                       → 1 (Task 3 — handler + integration)
git log --all --oneline | grep -c 7417c84                       → 1 (Task 4 — bot registration)
git log --all --oneline | grep -c 8e62fd7                       → 1 (Task 5 — Docker gate)
```

## Self-Check: PASSED

All 4 created artifacts exist on disk; src/bot/bot.ts modification verified; all 5 task commits present in git history; full Docker suite delta verified (+26 / 0 / 0); SURF-03 / SURF-04 / SURF-05 traceability closed; HARD CO-LOC #M10-5 invariant honored (handler + formatter + golden test all in this plan); M010-07 regression gate active.

---
*Phase: 35-surfaces*
*Plan: 35-03*
*Completed: 2026-05-13*
