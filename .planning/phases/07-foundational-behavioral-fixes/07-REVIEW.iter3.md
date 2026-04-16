---
phase: 07-foundational-behavioral-fixes
reviewed: 2026-04-14T00:00:00Z
depth: standard
iteration: 2
files_reviewed: 21
files_reviewed_list:
  - src/chris/engine.ts
  - src/chris/personality.ts
  - src/chris/refusal.ts
  - src/chris/language.ts
  - src/llm/prompts.ts
  - src/chris/modes/journal.ts
  - src/chris/modes/interrogate.ts
  - src/chris/modes/reflect.ts
  - src/chris/modes/coach.ts
  - src/chris/modes/psychology.ts
  - src/chris/modes/produce.ts
  - src/chris/modes/photos.ts
  - src/chris/__tests__/refusal.test.ts
  - src/chris/__tests__/language.test.ts
  - src/chris/__tests__/personality.test.ts
  - src/chris/__tests__/engine-refusal.test.ts
  - src/chris/__tests__/engine.test.ts
  - src/chris/__tests__/coach.test.ts
  - src/chris/__tests__/interrogate.test.ts
  - src/chris/__tests__/produce.test.ts
  - src/chris/__tests__/psychology.test.ts
  - src/chris/__tests__/reflect.test.ts
findings:
  critical: 1
  warning: 1
  info: 4
  total: 6
status: issues_found
---

# Phase 7: Code Review Report (Iteration 2)

**Reviewed:** 2026-04-14
**Depth:** standard
**Iteration:** 2 (re-review after fix commits e3afdec, 356d598, 216f4d2, 97ffc28)
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Iteration-1 fixes were verified and all applied correctly:

- CR-01 (Greg/John persona collision): `personality.ts` now uses "John" consistently in the constitutional preamble, the `DeclinedTopic` JSDoc, the `buildKnownFactsBlock` header ("## Known Facts About John"), and the declined-topics injection. Confirmed.
- WR-01 (loose "not now" pattern): `refusal.ts:48` now uses the tight anchored form `^(?!.*\b(?:told|said)\b)\s*not\s+(?:now|today|right\s+now)\s*[.!?]?\s*$` which only fires on standalone replies. Confirmed.
- WR-02 (resultCount from newline count): All five handlers (`interrogate.ts:31`, `reflect.ts:38`, `coach.ts:38`, `psychology.ts:38`, `produce.ts:38`) now use `searchResults.length`. Confirmed.
- WR-03 (stale "6-mode" JSDoc): `engine.ts:39` now reads "Classify a message into one of 7 Chris modes". Confirmed.

The three Info items from iteration 1 (IN-01 stale `realBuildSystemPrompt` import, IN-02 missing `mockBuildRelationalContext` assertion, IN-03 `.replace()` vs `.replaceAll()` photo fence) were not in scope for iteration 1 and remain. They are carried forward below (renumbered).

A new Critical issue was discovered during iteration-2 cross-reading: the engine does **not** forward the newly-computed `language` and `declinedTopics` values into six of the seven mode handlers. This silently disables the phase's two headline behaviors (language directive, declined-topics injection) outside of JOURNAL mode. The existing engine routing tests codify the bug as the expected contract, so a simple unit-test run will not surface it. This is the defining behavioral fix that phase 7 exists to deliver, so it is flagged as Critical.

One new Info item was also spotted (stale "6 modes" comment in `prompts.ts:63` — same class of issue as the already-fixed WR-03, in a different file).

---

## Critical Issues

### CR-01: Engine drops `language` and `declinedTopics` for 6 of 7 modes

**File:** `src/chris/engine.ts:161-196`

**Issue:** `processMessage` carefully computes `language` (line 143) and `declinedTopics` (line 145), then only forwards them to `handleJournal` (line 161). Every other handler is called with only `(chatId, text)`:

```typescript
// engine.ts (abridged, lines 159–196)
switch (mode) {
  case 'JOURNAL':
    response = await handleJournal(chatId, text, language, declinedTopics); // ← forwarded
    break;
  case 'INTERROGATE':
    response = await handleInterrogate(chatId, text);                        // ← dropped
    break;
  case 'REFLECT':
    response = await handleReflect(chatId, text);                            // ← dropped
    break;
  case 'COACH':
    response = await handleCoach(chatId, text);                              // ← dropped
    break;
  case 'PSYCHOLOGY':
    response = await handlePsychology(chatId, text);                         // ← dropped
    break;
  case 'PRODUCE':
    response = await handleProduce(chatId, text);                            // ← dropped
    break;
  case 'PHOTOS': {
    const photoResult = await handlePhotos(chatId, text);                    // ← dropped
    …
    response = await handleJournal(chatId, noPhotosContext);                 // ← dropped
  }
}
```

Every downstream handler (`handleInterrogate`, `handleReflect`, `handleCoach`, `handlePsychology`, `handleProduce`, `handlePhotos`, and the photos→journal fallback in `engine.ts:192`) already declares optional `language?: string` and `declinedTopics?: DeclinedTopic[]` parameters and passes them through to `buildSystemPrompt`. They are ready to receive the data — the engine just isn't passing it.

Consequences:

1. **Language directive bypassed.** LANG-01/LANG-02 only take effect in JOURNAL. If John asks a question in French (INTERROGATE), requests coaching in Russian (COACH), or brainstorms in French (PRODUCE), `buildSystemPrompt` is called with `language = undefined` and the mandatory language directive block (`personality.ts:110-112`) is omitted. The model may still match the user's language from the message itself, but the whole point of the explicit directive — overriding misleading history signals — is lost.
2. **Declined-topics bypassed.** TRUST-03 only takes effect in JOURNAL. If John declines a topic while in JOURNAL, then switches to INTERROGATE/REFLECT/COACH/PSYCHOLOGY/PRODUCE/PHOTOS, the "## Declined Topics (Do Not Return To)" section (`personality.ts:114-119`) is omitted from the system prompt, and Chris can freely resurface the topic. This directly contradicts the session-scoped design ("Stored per-session and injected into all subsequent system prompts", `personality.ts:17-19`).

The existing routing tests (`engine.test.ts:700-703, 750-753, 786-789, 822-825, 858-861`) explicitly assert the broken signature:

```typescript
expect(mockHandleInterrogate).toHaveBeenCalledWith(
  CHAT_ID,
  'Have I ever talked about my childhood?',
);
```

So the unit suite passes while the phase's primary behavior is disabled. There is no test anywhere that verifies declined-topics or language propagate into non-JOURNAL modes.

**Fix:** Forward `language` and `declinedTopics` to every handler, and update the routing assertions:

```typescript
// engine.ts
case 'INTERROGATE':
  response = await handleInterrogate(chatId, text, language, declinedTopics);
  break;
case 'REFLECT':
  response = await handleReflect(chatId, text, language, declinedTopics);
  break;
case 'COACH':
  response = await handleCoach(chatId, text, language, declinedTopics);
  break;
case 'PSYCHOLOGY':
  response = await handlePsychology(chatId, text, language, declinedTopics);
  break;
case 'PRODUCE':
  response = await handleProduce(chatId, text, language, declinedTopics);
  break;
case 'PHOTOS': {
  const photoResult = await handlePhotos(chatId, text, language, declinedTopics);
  if (photoResult) {
    …
  } else {
    …
    response = await handleJournal(chatId, noPhotosContext, language, declinedTopics);
  }
  break;
}
```

And update the five routing tests in `engine.test.ts` so they assert the four-argument shape, plus add at least one integration-style test per mode verifying that declined topics set during a JOURNAL turn actually appear in the system prompt of a subsequent INTERROGATE/COACH/etc. turn.

---

## Warnings

### WR-01: `MODE_DETECTION_PROMPT` header still says "6 modes" but lists 7

**File:** `src/llm/prompts.ts:63`

**Issue:** The opening line of the mode-detection system prompt reads:

```
You are a message classifier. Given a user message, determine which of these 6 modes it belongs to:
```

…and then immediately enumerates seven modes (1 JOURNAL, 2 INTERROGATE, 3 REFLECT, 4 COACH, 5 PSYCHOLOGY, 6 PRODUCE, 7 PHOTOS) and lists eight decision-tree bullets that cover all seven. The preceding JSDoc at line 61-62 also says `"6-mode classification with decision tree and discriminators."`

This is the same bug class as iteration-1's WR-03 (engine.ts JSDoc) but in the LLM-facing prompt itself, so it is user-visible to the classifier model. Haiku will see a contradictory "count 6, options 7" header, which may bias it away from whichever mode it considers "seventh" (most likely PHOTOS, which is listed last). Given Phase 7's PHOTOS is a new feature, this is a live behavioral risk, not just a doc hygiene issue — hence Warning rather than Info.

**Fix:**
```typescript
// prompts.ts:61-63
/**
 * Mode detection system prompt — used with Haiku to classify incoming messages.
 * 7-mode classification with decision tree and discriminators.
 */
export const MODE_DETECTION_PROMPT = `You are a message classifier. Given a user message, determine which of these 7 modes it belongs to:
```

---

## Info

### IN-01: `realBuildSystemPrompt` in mode tests resolves to the mock, not the real function

**File:** `src/chris/__tests__/coach.test.ts:96`, `src/chris/__tests__/psychology.test.ts:96`

**Issue:** (carried forward from iteration-1 IN-01, not addressed) Both files do `const { buildSystemPrompt: realBuildSystemPrompt } = await import('../personality.js');` after the module has already been mocked at the top of the file. The binding resolves to the mock, not the real implementation, and it is never referenced afterward. Misleading name, dead import.

**Fix:** Delete the unused import from both files.

---

### IN-02: `mockBuildRelationalContext` declared but never asserted in `produce.test.ts`

**File:** `src/chris/__tests__/produce.test.ts:60`

**Issue:** (carried forward from iteration-1 IN-02) The mock is set up but never negatively asserted, leaving a small gap in the "produce has no relational context" contract.

**Fix:** Add `expect(mockBuildRelationalContext).not.toHaveBeenCalled();` to the existing "does NOT call getRelationalMemories" test, or add a parallel test.

---

### IN-03: Photo query fence-strip regex only removes the first code fence occurrence

**File:** `src/chris/modes/photos.ts:67`

**Issue:** (carried forward from iteration-1 IN-03) `raw.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/, '$1').trim()` uses `.replace()` without the `/g` flag, so only the first fence pair is stripped. `engine.ts:33-36` already solved the same problem with a cleaner `match()` idiom that would be worth reusing.

**Fix:**
```typescript
const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
const cleaned = (fenceMatch ? fenceMatch[1]! : raw).trim();
```

---

### IN-04: Engine routing tests hard-code the broken two-arg handler signature

**File:** `src/chris/__tests__/engine.test.ts:700-703, 750-753, 786-789, 822-825, 858-861`

**Issue:** Each of the five "routes MODE to handleMODE" tests asserts `expect(mockHandleX).toHaveBeenCalledWith(CHAT_ID, <text>)`. When CR-01 is fixed, these will all fail with an arity mismatch. This is strictly downstream of CR-01 and will be addressed as part of that fix, but it is worth flagging explicitly so the fixer updates both the production call sites and the test expectations in the same commit.

**Fix:** Update each assertion to:
```typescript
expect(mockHandleInterrogate).toHaveBeenCalledWith(
  CHAT_ID,
  'Have I ever talked about my childhood?',
  expect.any(String),   // language
  expect.any(Array),    // declinedTopics
);
```
or use concrete values and add at least one positive test where `declinedTopics` is non-empty after a prior JOURNAL refusal turn.

---

_Reviewed: 2026-04-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 2_
