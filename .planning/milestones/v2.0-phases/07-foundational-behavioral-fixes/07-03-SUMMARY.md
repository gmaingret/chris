---
phase: 07-foundational-behavioral-fixes
plan: "03"
subsystem: chris-engine
tags: [refusal-detection, language-detection, session-state, regex, franc]
dependency_graph:
  requires: ["07-01"]
  provides: ["refusal.ts", "language.ts"]
  affects: ["07-04"]
tech_stack:
  added: ["franc@6.2.0 (installed in node_modules)"]
  patterns: ["module-level Map for ephemeral session state", "regex pattern arrays with capture-group indexes", "ISO 639-3 to display name mapping"]
key_files:
  created:
    - src/chris/refusal.ts
    - src/chris/language.ts
  modified: []
decisions:
  - "15+ EN/FR/RU regex patterns per language with meta-reference guard via negative lookahead (D-05: fewer false positives)"
  - "In-memory Map keyed by chatId for session state — ephemeral per D-03, no DB dependency"
  - "franc called with only: ['eng', 'fra', 'rus'] restriction; short-message threshold < 4 words or < 15 chars (D021)"
metrics:
  duration: "~6 minutes"
  completed_date: "2026-04-13"
  tasks_completed: 2
  tasks_total: 2
  files_created: 2
  files_modified: 0
requirements-completed: [TRUST-01, TRUST-02, LANG-01, LANG-02]
---

# Phase 07 Plan 03: Refusal Detection and Language Detection Modules

Implemented refusal detection (src/chris/refusal.ts) and language detection (src/chris/language.ts) as standalone synchronous modules with ephemeral session state — 28 unit tests green.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Implement refusal detection module | 16cee48 | src/chris/refusal.ts |
| 2 | Implement language detection module | 3496a57 | src/chris/language.ts |

## What Was Built

### src/chris/refusal.ts

Refusal detection with:
- 15 English patterns (with meta-reference guard via negative lookahead `(?!.*\b(?:told|said|mentioned|explained)\b)` — correctly avoids flagging "I told my therapist I don't want to talk about my childhood")
- 15 French patterns covering common deflection phrases
- 15 Russian patterns for Cyrillic refusal expressions
- Topic extraction via regex capture groups, falls back to full sentence when no group available
- Session state: `addDeclinedTopic`, `getDeclinedTopics`, `clearDeclinedTopics` — module-level Map keyed by chatId (ephemeral per D-03)
- `generateRefusalAcknowledgment(language)` — returns a random language-matched response from three options per language

Exports: `detectRefusal`, `addDeclinedTopic`, `getDeclinedTopics`, `clearDeclinedTopics`, `generateRefusalAcknowledgment`, `RefusalResult`, `DeclinedTopicEntry`

### src/chris/language.ts

Language detection with:
- `detectLanguage(text, previousLanguage)` — calls `franc(text, { only: ['eng', 'fra', 'rus'] })` for messages ≥ 4 words and ≥ 15 chars
- Short-message inheritance: messages below either threshold inherit `previousLanguage` or default to 'English'
- ISO 639-3 to display name mapping: `{ eng: 'English', fra: 'French', rus: 'Russian' }`
- `und` (undetermined) results fall back to `previousLanguage ?? 'English'`
- Session state: `getLastUserLanguage`, `setLastUserLanguage`, `clearLanguageState` — module-level Map keyed by chatId

Exports: `detectLanguage`, `getLastUserLanguage`, `setLastUserLanguage`, `clearLanguageState`

## Test Results

```
Test Files  2 passed (2)
Tests  28 passed (28)
  - refusal.test.ts: 18 passed
  - language.test.ts: 10 passed
```

TypeScript: `npx tsc --noEmit` — no errors

## Deviations from Plan

**1. [Rule 3 - Blocking Issue] franc not installed in node_modules**
- **Found during:** Task 2 — tests failed with `ERR_MODULE_NOT_FOUND`
- **Issue:** franc was in package.json dependencies but not in node_modules (worktree had fresh node_modules state)
- **Fix:** `npm install franc` to install the package
- **Files modified:** package-lock.json (updated)
- **Commit:** Included in Task 2 commit (3496a57)

## Known Stubs

None — both modules are fully implemented with real logic.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes introduced. Both modules are pure synchronous functions operating on in-process state only.

T-07-01 (Denial of Service — regex patterns): All patterns use simple alternation and optional groups. No nested quantifiers or catastrophic backtracking patterns like `(a+)+`. Patterns are anchored with `^` or bounded. The negative lookahead `(?!.*\b(?:told|said|mentioned|explained)\b)` is bounded by `\b` word boundaries and operates linearly.

## Self-Check

- [x] src/chris/refusal.ts exists: FOUND
- [x] src/chris/language.ts exists: FOUND
- [x] Commit 16cee48 exists: FOUND
- [x] Commit 3496a57 exists: FOUND
- [x] 28 tests passing: CONFIRMED
- [x] TypeScript: no errors

## Self-Check: PASSED
