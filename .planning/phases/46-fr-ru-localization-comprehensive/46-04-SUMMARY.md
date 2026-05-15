---
phase: 46
plan: 46-04
subsystem: journal-locale
tags: [L10N-04, 26-REVIEW-WR-03, cron-context-locale]
provides:
  - PROMPTS as Record<Lang, readonly string[]> with CAP-01 cardinality lock
  - PROMPTS_COUNT exported for locale-agnostic length consumers
  - fireJournal cron-context locale detection via getLastUserLanguageFromDb
requires:
  - src/chris/language.ts getLastUserLanguageFromDb + langOf (already shipped)
affects:
  - Daily 21:00 Paris journal fires now ship locale-matched prompts
  - PROMPT_SET_VERSION unchanged (v1) — bag indices stay valid; no migration needed
tech_stack:
  added: []
  patterns: [CAP-01 module-load cardinality assertion, cron-context DB-backed locale detection]
key_files:
  modified:
    - src/rituals/journal.ts
    - src/rituals/__tests__/journal.test.ts
    - src/rituals/__tests__/journal-handler.test.ts
decisions:
  - 46-PLAN-CHECK W#2 dependency note acknowledged: plan-frontmatter depends_on [46-01] is over-conservative (this plan does not import from src/chris/locale/strings.ts); kept for documentation alignment but executed sequentially with the rest of the phase
  - CAP-01 cardinality lock asserted at module load (throws Error if FR/RU prompt count diverges from EN)
  - PROMPT_SET_VERSION stays 'v1' — indices preserved by CAP-01, no migration needed
  - Default-French fallback when getLastUserLanguageFromDb returns null (Greg's primary locale per project memory + ROADMAP Phase 41 success criterion)
metrics:
  duration: ~25min
  completed: 2026-05-15
  tasks: 4 (single commit)
  files_modified: 3
---

# Phase 46 Plan 46-04: Daily journal PROMPTS locale-aware (L10N-04) Summary

**One-liner:** Daily 21:00 Paris journal fire now reads Greg's last USER message locale via `getLastUserLanguageFromDb` and sends a French/Russian/English prompt accordingly; CAP-01 cardinality lock keeps bag indices valid across locales (PROMPT_SET_VERSION stays at v1, no migration needed).

## Tasks Executed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| T1+T2+T3+T4 | PROMPTS shape + fireJournal wiring + unit tests + handler integration tests | `fb3fe65` | journal.ts, journal.test.ts, journal-handler.test.ts |

Single commit captures the four tasks because T1 (shape change) compile-breaks T2 (fireJournal callsite) and T3+T4 (tests reading PROMPTS); intermediate states don't pass `npx tsc --noEmit`.

## Test Results

- `src/rituals/__tests__/journal.test.ts` — 18/18 passing (was 12; +6 L10N-04 invariants)
- `src/rituals/__tests__/journal-handler.test.ts` — 8/8 passing (was 4; +4 L10N-04 locale-routing tests covering FR/RU/EN detected + null-fallback)
- `src/rituals/__tests__/journal-suppression.test.ts` — 7/7 passing (unchanged)
- `src/rituals/__tests__/prompt-rotation-property.test.ts` — 2/2 passing (rotation invariants preserved across shape change)
- `npx tsc --noEmit` — clean

## Deviations from Plan

**Plan-check warning W#2 — depends_on [46-01] is over-conservative.** Acknowledged in the SUMMARY metadata. This plan does NOT import from `src/chris/locale/strings.ts`; it imports only from `chris/language.ts` which was already shipped pre-Phase-46. In a parallel-wave execution this plan could have run alongside 46-01; in sequential execution per the orchestrator constraint there is no practical impact.

**PROMPTS_COUNT new export (Rule 3 — auto-fix blocking issue).** The original plan implicitly assumed `chooseNextPromptIndex` would continue using `PROMPTS.length`, but after T1's shape change `PROMPTS.length` no longer compiles (`PROMPTS` is now `Record<Lang, ...>`). Added the `PROMPTS_COUNT` export (derived from `PROMPTS.English.length`, asserted equal across locales by the CAP-01 module-load guard) so the rotation primitive has a single locale-agnostic source for cardinality. Documented inline.

## Verification

- `grep "Readonly<Record<Lang, readonly string\[\]>>" src/rituals/journal.ts | wc -l` → 1 ✓
- `grep "Qu'est-ce qui a compté aujourd'hui" src/rituals/journal.ts` → present ✓
- `grep "Что было важным сегодня" src/rituals/journal.ts` → present ✓
- `grep "cardinality mismatch" src/rituals/journal.ts` → present (module-load assertion) ✓
- `grep -c "getLastUserLanguageFromDb(chatId)" src/rituals/journal.ts` → 1 ✓
- `grep "PROMPTS\[lang\]\[promptIdx\]" src/rituals/journal.ts | wc -l` → 1 ✓
- `grep "PROMPT_SET_VERSION = 'v1'" src/rituals/journal.ts` → present (NOT bumped) ✓

## Self-Check: PASSED

- Commit `fb3fe65` exists in `git log` ✓
- All 3 modified files staged ✓
- 18 journal + 8 journal-handler + 7 journal-suppression + 2 prompt-rotation tests pass ✓
- Daily journal cron at 21:00 Paris will now route to French prompts by default (Greg's primary locale) and switch to RU/EN as `getLastUserLanguageFromDb` detects new conversation locale ✓
