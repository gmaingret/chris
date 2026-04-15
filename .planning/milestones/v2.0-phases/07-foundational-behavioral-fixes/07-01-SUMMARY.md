---
phase: 07-foundational-behavioral-fixes
plan: "01"
subsystem: testing
tags: [tdd, scaffolding, franc, refusal, language, personality]
dependency_graph:
  requires: []
  provides:
    - src/chris/__tests__/refusal.test.ts
    - src/chris/__tests__/language.test.ts
    - src/chris/__tests__/personality.test.ts
    - src/chris/__tests__/engine-refusal.test.ts
  affects:
    - Phase 07 Plans 02-04 (all need these test files to run TDD red-green)
tech_stack:
  added:
    - "franc@6.2.0 — ESM-compatible language detection library (npm)"
  patterns:
    - "TDD RED phase — 4 test files with failing stubs covering all 11 Phase 7 requirements"
key_files:
  created:
    - src/chris/__tests__/refusal.test.ts
    - src/chris/__tests__/language.test.ts
    - src/chris/__tests__/personality.test.ts
    - src/chris/__tests__/engine-refusal.test.ts
  modified:
    - package.json (franc added to dependencies)
    - package-lock.json
decisions:
  - "franc@6.2.0 chosen as ESM-compatible language detection; D021 specified this library"
  - "engine-refusal.test.ts uses minimal placeholder stubs because full integration requires refusal.ts and language.ts which don't exist yet; Plan 03 will flesh them out"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-13"
  tasks_completed: 2
  files_created: 4
  files_modified: 2
requirements-completed: [TRUST-01, TRUST-02, TRUST-03, TRUST-04, SYCO-01, SYCO-02, SYCO-03, LANG-01, LANG-02, LANG-03, LANG-04]
---

# Phase 07 Plan 01: TDD Scaffolding and franc Install Summary

**One-liner:** Wave 0 test scaffolding — 4 failing test files covering all 11 Phase 7 requirements (TRUST-01 through TRUST-04, SYCO-01 through SYCO-03, LANG-01 through LANG-04) plus franc@6.2.0 installed for language detection.

## What Was Built

This plan is the Wave 0 setup for Phase 7's TDD execution. All subsequent plans (07-02 through 07-04) need test files to exist so they can run green-check assertions after implementing the corresponding source modules.

### Task 1: Install franc + refusal/language test scaffolds

- **franc@6.2.0** added to `package.json` dependencies; verified importable via ESM
- **`src/chris/__tests__/refusal.test.ts`** — 16 failing test stubs covering:
  - TRUST-01: detectRefusal with English, French, Russian patterns (15+ patterns each expected)
  - TRUST-01: False positive guard — normal conversation and meta-sentences do not trigger
  - TRUST-01: Topic extraction from refusal sentences
  - TRUST-02: Session declined topics isolation (getDeclinedTopics, addDeclinedTopic, clearDeclinedTopics)
- **`src/chris/__tests__/language.test.ts`** — 10 failing test stubs covering:
  - LANG-01: detectLanguage for English, French, Russian long messages
  - LANG-02: Short message inheritance (< 4 words OR < 15 chars inherits previous language)
  - LANG-02: Default to English when no prior language and message is short
  - LANG-02: Long messages are not inherited (franc detection wins)
  - Session language state (getLastUserLanguage, setLastUserLanguage, clearLanguageState)

### Task 2: Personality and engine-refusal test scaffolds

- **`src/chris/__tests__/personality.test.ts`** — 22 test cases (16 failing, 6 passing):
  - SYCO-01: Constitutional preamble present on all 7 modes
  - SYCO-02: The Hard Rule — prohibition on track record appeals
  - SYCO-03: Three forbidden behaviors (never resolve contradictions, never extrapolate, never optimize for emotional satisfaction)
  - TRUST-04: Declined topics injection in all 6 modes, omitted when empty
  - LANG-03: Language directive injection in all modes when language is provided
  - LANG-04: JOURNAL prompt does not contain "enriching follow-up questions"; uses occasional language instead
  - D-02 preservation: COACH "direct"/"sugarcoat", INTERROGATE "Memory Entries", PSYCHOLOGY "attachment theory" — these 6 tests PASS immediately (existing content untouched)
- **`src/chris/__tests__/engine-refusal.test.ts`** — 2 placeholder stubs with full mock setup matching engine.test.ts patterns; will be fleshed out in Plan 03

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking Issue] Planning files accidentally deleted in Task 1 commit**
- **Found during:** Task 1 commit
- **Issue:** `git reset --soft e66e7c06` left the phase 07 planning files as staged, so the `git add package.json package-lock.json` command captured their deletion in the commit
- **Fix:** Used `git checkout e66e7c06 -- .planning/phases/07-foundational-behavioral-fixes/` to restore all 8 planning files, then committed them in a separate chore commit
- **Files modified:** `.planning/phases/07-foundational-behavioral-fixes/` (all 8 files restored)
- **Commit:** e0916e2

## Known Stubs

All 4 test files are intentionally stubs — this is the RED phase of TDD. The stubs will become green when the following source modules are implemented in subsequent plans:

| Stub file | Waiting for | Plan |
|-----------|-------------|------|
| `refusal.test.ts` | `src/chris/refusal.ts` | Plan 03 |
| `language.test.ts` | `src/chris/language.ts` | Plan 03 |
| `personality.test.ts` | Updated `buildSystemPrompt` signature | Plan 02 |
| `engine-refusal.test.ts` | Engine changes + refusal.ts + language.ts | Plan 03 |

These stubs are intentional and necessary — they are the TDD RED phase.

## Threat Flags

None — this plan installs one well-known npm package (franc, 4k+ GitHub stars, wooorm) and creates test files only. No runtime code changes, no new network surface.

## Self-Check

### Files created:
- [x] src/chris/__tests__/refusal.test.ts — FOUND
- [x] src/chris/__tests__/language.test.ts — FOUND
- [x] src/chris/__tests__/personality.test.ts — FOUND
- [x] src/chris/__tests__/engine-refusal.test.ts — FOUND

### Commits:
- [x] 946387b — feat(07-01): install franc and create refusal + language test scaffolds
- [x] e0916e2 — chore(07-01): restore phase 07 planning files after accidental soft-reset deletion
- [x] c4cfaa1 — feat(07-01): create personality and engine-refusal test scaffolds

### franc importable:
- [x] `node -e "import('franc').then(m => console.log(typeof m.franc))"` outputs "function"

## Self-Check: PASSED
