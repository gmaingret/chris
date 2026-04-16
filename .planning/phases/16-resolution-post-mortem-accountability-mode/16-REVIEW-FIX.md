---
phase: 16-resolution-post-mortem-accountability-mode
fixed_at: 2026-04-16T14:45:00Z
review_path: .planning/phases/16-resolution-post-mortem-accountability-mode/16-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 16: Code Review Fix Report

**Fixed at:** 2026-04-16T14:45:00Z
**Source review:** .planning/phases/16-resolution-post-mortem-accountability-mode/16-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### CR-01: Engine PP#0 does not route AWAITING_RESOLUTION / AWAITING_POSTMORTEM to handlers

**Files modified:** `src/chris/engine.ts`
**Commit:** 265ac20
**Applied fix:** Added import of `handleResolution` and `handlePostmortem` from `../decisions/resolution.js`. Added routing branches for AWAITING_RESOLUTION and AWAITING_POSTMORTEM stages in the PP#0 block, placed BEFORE the abort-phrase check so that resolution flows are dispatched immediately without hitting the abort logic (which also fixes WR-01).

### WR-01: isAbortPhrase called with undefined language for AWAITING_RESOLUTION/AWAITING_POSTMORTEM

**Files modified:** `src/chris/engine.ts`
**Commit:** 265ac20
**Applied fix:** Combined with CR-01. Resolution/postmortem stages now return before reaching the abort-phrase check. Additionally, the `lang` variable for capture stages now uses a default of `'en'` when `language_at_capture` is undefined: `const lang: 'en' | 'fr' | 'ru' = draft.language_at_capture ?? 'en';`.

### CR-02: Language code mismatch in resolution.ts -- French/Russian users get English responses

**Files modified:** `src/decisions/resolution.ts`
**Commit:** e84e281
**Applied fix:** In both `handleResolution` and `handlePostmortem`, normalized language from full names (`'French'`, `'Russian'`, `'English'`) to short codes (`'fr'`, `'ru'`, `'en'`) for use with `postMortemQuestion`, `notedAck`, and `alreadyResolvedMessage`. Preserved full language name (`rawLang`) for `buildSystemPrompt` which expects full names.

### WR-02: classifyOutcome test calls function with wrong arity

**Files modified:** `src/decisions/__tests__/resolution.test.ts`
**Commit:** 1a382ed
**Applied fix:** Updated all three `classifyOutcome` test calls to pass 3 arguments (resolutionText, prediction, criterion) in the correct order, matching the function signature `classifyOutcome(resolutionText, prediction, criterion)`.

### WR-03: Duplicate ChrisMode type definition

**Files modified:** `src/chris/engine.ts`
**Commit:** a1ae5d4
**Applied fix:** Removed the duplicate `ChrisMode` type definition from `engine.ts`. Added `import type { ChrisMode } from './personality.js'` for local usage and `export type { ChrisMode } from './personality.js'` as re-export so downstream consumers (e.g., `praise-quarantine.ts`) continue to work unchanged. Canonical definition remains in `personality.ts`.

---

_Fixed: 2026-04-16T14:45:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
