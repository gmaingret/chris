---
phase: 16-resolution-post-mortem-accountability-mode
reviewed: 2026-04-16T14:30:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/chris/__tests__/personality.test.ts
  - src/chris/__tests__/praise-quarantine.test.ts
  - src/chris/engine.ts
  - src/chris/personality.ts
  - src/chris/praise-quarantine.ts
  - src/decisions/__tests__/engine-resolution.test.ts
  - src/decisions/__tests__/resolution.test.ts
  - src/decisions/capture-state.ts
  - src/decisions/index.ts
  - src/decisions/resolution.ts
  - src/llm/prompts.ts
  - src/pensieve/retrieve.ts
  - src/proactive/__tests__/sweep-escalation.test.ts
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-04-16T14:30:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 16 introduces resolution handling, post-mortem flows, ACCOUNTABILITY mode, temporal Pensieve retrieval, and sweep escalation scaffolding. The core resolution logic in `resolution.ts` is well-structured with proper error handling and fail-closed defaults. However, there are two critical bugs: the engine does not actually route AWAITING_RESOLUTION/AWAITING_POSTMORTEM stages to the new handlers, and `resolution.ts` uses short language codes (`'en'`, `'fr'`, `'ru'`) while the language detection module returns full names (`'English'`, `'French'`, `'Russian'`), causing French and Russian users to receive English-only acknowledgments and post-mortem questions.

## Critical Issues

### CR-01: Engine PP#0 does not route AWAITING_RESOLUTION / AWAITING_POSTMORTEM to handlers

**File:** `src/chris/engine.ts:181-193`
**Issue:** The PP#0 block only dispatches capture stages (DECISION, ALTERNATIVES, REASONING, PREDICTION, FALSIFICATION) to `handleCapture`. The AWAITING_RESOLUTION and AWAITING_POSTMORTEM stages fall through to normal mode detection with a comment "Phase 16 will handle; for now fall through." However, `resolution.ts` is already implemented and exported from `decisions/index.ts` (line 55). The `engine-resolution.test.ts` tests expect routing to work, but it will not -- messages from Greg during resolution/postmortem will be misrouted to JOURNAL mode instead of the resolution handler.

**Fix:** Add routing branches in the PP#0 block:
```typescript
if (activeCapture.stage === 'AWAITING_RESOLUTION') {
  const reply = await handleResolution(chatId, text, activeCapture.decisionId!);
  await saveMessage(chatId, 'USER', text, 'JOURNAL');
  await saveMessage(chatId, 'ASSISTANT', reply, 'JOURNAL');
  return reply;
}
if (activeCapture.stage === 'AWAITING_POSTMORTEM') {
  const reply = await handlePostmortem(chatId, text, activeCapture.decisionId!);
  await saveMessage(chatId, 'USER', text, 'JOURNAL');
  await saveMessage(chatId, 'ASSISTANT', reply, 'JOURNAL');
  return reply;
}
```
Import `handleResolution` and `handlePostmortem` from `../decisions/resolution.js`. Also ensure the abort-phrase check is skipped for these stages (draft has no `language_at_capture`).

### CR-02: Language code mismatch in resolution.ts -- French/Russian users get English responses

**File:** `src/decisions/resolution.ts:214,290,339`
**Issue:** `getLastUserLanguage()` and `detectLanguage()` return full language names (`'English'`, `'French'`, `'Russian'`). But `postMortemQuestion()` (line 52-81) and `notedAck()` (line 91-97) switch on short codes (`'en'`, `'fr'`, `'ru'`). The `detectedLanguage` variable will be `'French'` or `'Russian'`, which never matches the `case 'fr':` or `case 'ru':` branches, so French and Russian users always receive the English default.

The same mismatch affects `alreadyResolvedMessage()` (line 83-89) and the `buildSystemPrompt` call at line 234 (which expects `'French'` not `'fr'`, so that one works by accident).

**Fix:** Either normalize the language at the call site or change the helper functions:
```typescript
// Option A: normalize at call site (resolution.ts:214)
const rawLang = getLastUserLanguage(chatId.toString()) ?? detectLanguage(text, null) ?? 'English';
const langCode = rawLang === 'French' ? 'fr' : rawLang === 'Russian' ? 'ru' : 'en';
// Use rawLang for buildSystemPrompt, langCode for postMortemQuestion/notedAck/alreadyResolvedMessage
```

## Warnings

### WR-01: isAbortPhrase called with undefined language for AWAITING_RESOLUTION/AWAITING_POSTMORTEM

**File:** `src/chris/engine.ts:168-173`
**Issue:** When `activeCapture.stage` is AWAITING_RESOLUTION or AWAITING_POSTMORTEM, the draft is `{}` (set by `upsertAwaitingResolution`). Line 169 casts `draft as CaptureDraft` and reads `language_at_capture`, which is `undefined`. Line 173 calls `isAbortPhrase(text, lang)` where `lang` is `undefined`. In `capture-state.ts:128`, `isAbortPhrase` expects `'en' | 'fr' | 'ru'`. The `undefined` value falls to the else branch, using Russian abort phrases -- so an English user typing "never mind" would not trigger an abort, and a Russian abort phrase could incorrectly trigger one.

The engine-resolution test at line 171-199 explicitly tests this pitfall case and expects it not to throw, but the behavior is still wrong.

**Fix:** Skip the abort-phrase check for non-capture stages, or default `lang` to `'en'`:
```typescript
const lang: 'en' | 'fr' | 'ru' = draft.language_at_capture ?? 'en';
```
Better: skip abort-phrase check entirely for AWAITING_RESOLUTION/AWAITING_POSTMORTEM since abort semantics don't apply to resolution flows.

### WR-02: classifyOutcome test calls function with wrong arity

**File:** `src/decisions/__tests__/resolution.test.ts:317-320`
**Issue:** `classifyOutcome` in `resolution.ts:111` takes 3 parameters: `(resolutionText, prediction, criterion)`. But the test at line 317-320 calls it with only 2 arguments: `classifyOutcome(prediction, resolutionText)`. The `criterion` parameter will be `undefined`, and the arguments are swapped (prediction is passed as resolutionText and vice versa). The test will pass only because the mock returns a canned response, but the test does not validate correct parameter forwarding.

**Fix:**
```typescript
const result = await classifyOutcome(
  'I was happier within 3 months',        // resolutionText
  'I will be happier within 3 months',     // prediction
  'I am not happier after 3 months',       // criterion
);
```

### WR-03: Duplicate ChrisMode type definition

**File:** `src/chris/personality.ts:13` and `src/chris/engine.ts:85`
**Issue:** `ChrisMode` is defined in both `personality.ts` (line 13) and `engine.ts` (line 85) as identical union types. When a new mode is added, both must be updated in lockstep. The `praise-quarantine.ts` imports from `engine.ts` (line 4), while `personality.ts` defines its own. This creates a maintenance risk where the types diverge silently.

**Fix:** Define `ChrisMode` in one canonical location (e.g., `personality.ts` or a shared `types.ts`) and re-export from the other.

## Info

### IN-01: Stale "John" references in prompt templates

**File:** `src/llm/prompts.ts:228,261-292`
**Issue:** `CONTRADICTION_DETECTION_PROMPT` (line 228) and `RELATIONAL_MEMORY_PROMPT` (line 261) still reference "John" instead of "Greg". The personality test at line 209-214 verifies that mode prompts do not contain "John", but these prompt constants are not covered by those tests since they are used in different code paths (contradiction detection and relational memory, not in `buildSystemPrompt`).

**Fix:** Replace all occurrences of "John" with "Greg" in both prompts.

### IN-02: @ts-expect-error comments in RED scaffold tests will become stale

**File:** `src/decisions/__tests__/engine-resolution.test.ts:11`, `src/decisions/__tests__/resolution.test.ts:11-13`
**Issue:** These `@ts-expect-error` comments suppress errors for imports from `resolution.ts` and `retrieve.ts` that were previously missing. Now that both modules exist and export these functions, the `@ts-expect-error` directives are no longer needed and TypeScript will warn that "unused '@ts-expect-error' directive".

**Fix:** Remove the `@ts-expect-error` comments from both test files.

---

_Reviewed: 2026-04-16T14:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
