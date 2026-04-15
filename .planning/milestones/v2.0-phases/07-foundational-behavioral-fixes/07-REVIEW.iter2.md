---
phase: 07-foundational-behavioral-fixes
reviewed: 2026-04-13T00:00:00Z
depth: standard
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
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 7: Code Review Report

**Reviewed:** 2026-04-13
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 7 introduces the constitutional preamble (anti-sycophancy), language detection, refusal detection, and wires up all six conversation modes through a unified engine. The architecture is clean and the error handling is consistent across handlers. Seven issues were found: one critical (name persona collision inside the same system prompt), three warnings (a high-false-positive refusal pattern, an unreliable result count metric, and a misleading stale comment), and three info items (misleading test import pattern, unused mock variable, a photo query regex that only strips the first fence).

---

## Critical Issues

### CR-01: "Greg" vs "John" persona collision in the same system prompt

**File:** `src/chris/personality.ts:28-35` and `src/llm/prompts.ts:10-28`

**Issue:** The constitutional preamble in `personality.ts` addresses the user exclusively as "Greg" (`"be useful to Greg"`, `"Never tell Greg he is right"`, `"Never optimize for Greg's emotional satisfaction"`), while every mode-specific system prompt in `prompts.ts` addresses the user exclusively as "John" (`"You are Chris, John's thoughtful and perceptive friend"`, `"what John has told you"`, etc.). Both halves are concatenated into a single system prompt via `buildSystemPrompt`. The LLM receives a system prompt that simultaneously calls the user "Greg" and "John", creating a contradictory persona that may cause the model to use the wrong name in responses.

**Fix:** Align all name references to a single name. The preamble in `personality.ts` should be updated to match the name used in `prompts.ts`:

```typescript
// personality.ts — change every "Greg" in CONSTITUTIONAL_PREAMBLE to "John"
const CONSTITUTIONAL_PREAMBLE = `## Core Principles (Always Active)
Your job is to be useful to John, not pleasant. Agreement is something you arrive at after examination — never your starting point. When John presents an argument, evaluate it on its merits. When you disagree, say so directly.

**The Hard Rule:** Never tell John he is right because of who he is. His track record, past wins, and reputation are not evidence for current claims. Evaluate arguments on their merits alone.

**Three Forbidden Behaviors:**
1. Never resolve contradictions on your own — surface them explicitly so John can address them.
2. Never extrapolate from past patterns to novel situations — what worked before is not evidence it will work again.
3. Never optimize for John's emotional satisfaction — optimize for accuracy and usefulness.

`;
```

Also update line 93 and 95 (`"Greg said:"` and `"Greg has explicitly declined"`).

---

## Warnings

### WR-01: Refusal pattern "not now" has high false-positive rate

**File:** `src/chris/refusal.ts:48`

**Issue:** The regex `/^(?!.*\b(?:told|said)\b).*\bnot\s+(?:now|today|right\s+now)\b/i` matches any message containing the phrase "not now", "not today", or "not right now" anywhere in the sentence. This fires on completely normal conversational messages:
- "That's not what I wanted today"
- "I'm not ready now but I will be"
- "Not today, but maybe tomorrow I'll try this recipe"
- "It's not that hot right now"

The meta-reference guard (`(?!.*\b(?:told|said)\b)`) does not protect against these cases because they don't involve meta-references. The pattern violates the design principle stated in the comment at line 129 ("errs toward fewer false positives").

**Fix:** Require the phrase to appear at the start of the message, or as a standalone statement, rather than embedded anywhere. A tighter pattern:

```typescript
// "not now / not today" — only at sentence boundaries or as standalone reply
[/^(?!.*\b(?:told|said)\b)(?:not\s+(?:now|today|right\s+now)|(?:not\s+now|not\s+today|not\s+right\s+now)\s*[.!?]?$)/i, null],
```

Alternatively, require it to be a short standalone message (similar to the `move on` pattern that works because it's inherently a command).

---

### WR-02: `resultCount` is computed from newline count, not actual result count

**File:** `src/chris/modes/interrogate.ts:31`, `src/chris/modes/reflect.ts:38`, `src/chris/modes/coach.ts:38`, `src/chris/modes/psychology.ts:38`, `src/chris/modes/produce.ts:38`

**Issue:** All five handlers compute `resultCount` identically:

```typescript
const resultCount = pensieveContext === '' ? 0 : pensieveContext.split('\n').length;
```

This counts newlines in the formatted string, not the number of search results. If any entry content contains embedded newlines (e.g., multi-line notes), this value will be higher than the actual result count. The variable name `resultCount` is misleading — it appears in success log messages where it is used for observability, so inflated numbers could obscure real search behavior in production logs.

**Fix:** Use the actual search results array length, which is available before context formatting:

```typescript
const resultCount = searchResults.length; // for interrogate
// or for modes using hybridSearch:
const resultCount = searchResults.length;
```

The empty-check logic can be simplified to `if (searchResults.length === 0)`.

---

### WR-03: Stale comment says "6-mode classification" but 7 modes exist

**File:** `src/chris/engine.ts:38`

**Issue:** The JSDoc comment reads `"Classify a message into one of 6 Chris modes"` but the `VALID_MODES` set (line 24-26) contains 7 modes (JOURNAL, INTERROGATE, REFLECT, COACH, PSYCHOLOGY, PRODUCE, PHOTOS), and `MODE_DETECTION_PROMPT` in `prompts.ts` lines 58-95 explicitly describes all 7 modes and labels mode 7 as PHOTOS. This stale comment creates confusion about the system's actual behavior.

**Fix:**
```typescript
/**
 * Classify a message into one of 7 Chris modes using Haiku.
 * Defaults to JOURNAL on any failure (parse error, API error, invalid mode).
 */
```

---

## Info

### IN-01: `realBuildSystemPrompt` in mode tests resolves to the mock, not the real function

**File:** `src/chris/__tests__/coach.test.ts:96`, `src/chris/__tests__/psychology.test.ts:96`

**Issue:** Both test files import:

```typescript
const { buildSystemPrompt: realBuildSystemPrompt } = await import('../personality.js');
```

However, `personality.js` is mocked earlier in the file (`vi.mock('../personality.js', ...)`). The name `realBuildSystemPrompt` implies it is the un-mocked implementation, but it resolves to the mock function. This import is also unused in both files — the tests that were intended to use it actually test string manipulation on raw prompt constants instead. The misleading name could cause confusion for future maintainers.

**Fix:** Remove the unused import from both files:
```typescript
// Remove this line from coach.test.ts and psychology.test.ts:
const { buildSystemPrompt: realBuildSystemPrompt } = await import('../personality.js');
```

---

### IN-02: `mockBuildRelationalContext` declared but never asserted in `produce.test.ts`

**File:** `src/chris/__tests__/produce.test.ts:60`

**Issue:** `mockBuildRelationalContext` is declared and the mock is set up, but `handleProduce` intentionally does not call `buildRelationalContext` (produce mode has no relational memory). The test file correctly asserts `mockGetRelationalMemories` is not called, but never asserts `mockBuildRelationalContext` is not called — despite having the mock set up. This is a minor gap in test coverage for the "no relational context" contract.

**Fix:** Add an assertion parallel to the existing `getRelationalMemories` check:

```typescript
it('does NOT call buildRelationalContext', async () => {
  await handleProduce(CHAT_ID, TEST_QUERY);
  expect(mockBuildRelationalContext).not.toHaveBeenCalled();
});
```

---

### IN-03: Photo query fence-strip regex only removes the first code fence occurrence

**File:** `src/chris/modes/photos.ts:67`

**Issue:** The fence-stripping in `parsePhotoQuery` uses:

```typescript
const cleaned = raw.replace(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/, '$1').trim();
```

This uses `.replace()` (not `.replaceAll()`) without the global flag, so it only removes the first fence pair. If the LLM response contained multiple code fences (unlikely but possible), only the first would be stripped. The `stripFences` function in `engine.ts` (line 33) uses `.match()` with a capturing group which is correct and consistent. The photos handler uses a different, slightly weaker approach.

**Fix:** Use the same helper pattern as `engine.ts`:

```typescript
const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
const cleaned = (fenceMatch ? fenceMatch[1]! : raw).trim();
```

---

_Reviewed: 2026-04-13_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
