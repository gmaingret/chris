---
phase: 46
plan: 46-01
subsystem: locale-infrastructure
tags: [L10N-05, L10N-03-infra, qualifierFor, normalizeForInterrogativeCheck]
provides:
  - src/chris/locale/strings.ts module (canonical home for cross-file locale registers)
  - qualifierFor(c, lang) — single source of truth replacing 2 byte-identical duplicates
  - normalizeForInterrogativeCheck(s) — NFC + curly→straight apostrophe (FR regex precondition)
  - LANG_QUALIFIER_BANDS registry (3 locales × 3 bands)
requires:
  - src/chris/language.ts Lang union (already shipped)
affects:
  - src/memory/profiles.ts (duplicate qualifierFor removed; canonical import added)
tech_stack:
  added: []
  patterns: [Record<Lang, T> as-const register, MSG-shape co-location]
key_files:
  created:
    - src/chris/locale/strings.ts
    - src/chris/locale/__tests__/strings.test.ts
  modified:
    - src/memory/profiles.ts
decisions:
  - L10N-05 consolidation: canonical qualifierFor lives in src/chris/locale/strings.ts (CONTEXT.md D-11)
  - Thresholds 0.6/0.3/else locked verbatim from Phase 35 D-07 + Phase 39 CONTEXT.md D-07
  - FR/RU seed translations per CONTEXT.md D-06 — Greg reviews at /gsd-verify-work
  - normalizeForInterrogativeCheck normalizes NFC + 4 curly-apostrophe code points (U+2018/2019/02BC/2032)
metrics:
  duration: ~25min
  completed: 2026-05-15
  tasks: 4
  files_modified: 3
---

# Phase 46 Plan 46-01: Locale-strings infrastructure + qualifierFor canonical (L10N-05) Summary

**One-liner:** New `src/chris/locale/strings.ts` module hosts canonical locale-aware `qualifierFor` + the `normalizeForInterrogativeCheck` NFC/apostrophe helper — closing L10N-05's drift surface and laying the foundation for Plans 46-02/03/04.

## Tasks Executed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| T1+T2 | Create strings.ts module with qualifierFor + LANG_QUALIFIER_BANDS + normalizeForInterrogativeCheck | `6185b0f` | src/chris/locale/strings.ts (new) |
| T3 | Remove duplicate qualifierFor from memory/profiles.ts | `8baa3f8` | src/memory/profiles.ts |
| T4 | Unit tests for both helpers | `a79f81d` | src/chris/locale/__tests__/strings.test.ts (new) |

## Test Results

- `src/chris/locale/__tests__/strings.test.ts` — 20/20 passing (12 qualifierFor + 8 normalize)
- `src/memory/__tests__/profiles.test.ts` — 43/43 passing (byte-identical EN output preserved)
- `src/memory/__tests__/psychological-profile-prompt.test.ts` — 39/39 passing
- `npx tsc --noEmit` — clean

## Deviations from Plan

**Plan partition merge:** T1 (qualifierFor) and T2 (normalizeForInterrogativeCheck) executed as a single commit because they additively populate the same new file in the same boundary — committing T1 alone would have shipped an incomplete module, and the file was created in one Write call. Tests for both functions land in T4 together. No semantic deviation from plan; just commit-shape.

## Verification

- `grep -c "export function qualifierFor" src/chris/locale/strings.ts` → 1 ✓
- `grep -c "export const LANG_QUALIFIER_BANDS" src/chris/locale/strings.ts` → 1 ✓
- `grep -c "export function normalizeForInterrogativeCheck" src/chris/locale/strings.ts` → 1 ✓
- `grep -c "function qualifierFor" src/memory/profiles.ts` → 0 ✓ (duplicate removed)
- `grep "qualifierFor(dim.confidence, 'English')" src/memory/profiles.ts | wc -l` → 2 ✓
- FR/RU seed translations present (`preuves substantielles`, `существенные данные`) ✓

## Self-Check: PASSED

- File `src/chris/locale/strings.ts` exists ✓
- File `src/chris/locale/__tests__/strings.test.ts` exists ✓
- Commits `6185b0f`, `8baa3f8`, `a79f81d` exist in `git log` ✓
- `qualifierFor(0.6, 'English')` returns `'substantial evidence'` (Phase 35 byte-identical band) ✓
