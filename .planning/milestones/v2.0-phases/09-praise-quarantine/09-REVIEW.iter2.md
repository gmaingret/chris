---
phase: 09-praise-quarantine
reviewed: 2026-04-13T12:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/chris/praise-quarantine.ts
  - src/chris/__tests__/praise-quarantine.test.ts
  - src/chris/engine.ts
  - src/chris/__tests__/engine.test.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 09: Code Review Report

**Reviewed:** 2026-04-13T12:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

The praise quarantine feature is well-implemented with a strong never-throw contract in `quarantinePraise()`, proper mode bypassing for COACH and PSYCHOLOGY, and a defensive timeout in the engine integration. Test coverage is thorough, covering happy paths, error paths, mode bypasses, and timeout behavior.

One warning-level issue was found: the nullish coalescing fallback on `parsed.rewritten` does not guard against an empty string from the LLM, which could result in returning an empty response to the user. Two info-level items note code duplication and a redundant type cast.

## Warnings

### WR-01: Empty string from LLM bypasses fallback, returning blank response

**File:** `src/chris/praise-quarantine.ts:77`
**Issue:** The line `return parsed.rewritten ?? response;` uses nullish coalescing (`??`), which only falls back when the value is `null` or `undefined`. If the LLM returns `{"flattery_detected": true, "rewritten": ""}`, the empty string passes through and the user receives an empty response. This violates the never-throw/never-degrade contract described in the docstring.
**Fix:**
```typescript
return parsed.rewritten || response;
```
Or for more explicit intent:
```typescript
return parsed.rewritten && parsed.rewritten.trim().length > 0 ? parsed.rewritten : response;
```

## Info

### IN-01: Duplicated `stripFences` helper across modules

**File:** `src/chris/praise-quarantine.ts:7-10` and `src/chris/engine.ts:31-34`
**Issue:** The `stripFences` function is duplicated identically in both files. If the regex needs updating (e.g., to handle additional fence formats), both copies must be changed.
**Fix:** Extract `stripFences` to a shared utility module (e.g., `src/utils/text.ts`) and import it in both files.

### IN-02: Redundant type assertion after type guard

**File:** `src/chris/praise-quarantine.ts:63`
**Issue:** The cast `(textBlock as { type: 'text'; text: string }).text` is unnecessary because line 58 already checks `textBlock.type !== 'text'` and returns early. After that guard, TypeScript should narrow the type. The explicit cast suggests the type definitions from the Anthropic SDK may not support discriminated union narrowing, making this a pragmatic workaround rather than an error.
**Fix:** No action required if SDK types do not support narrowing. If they do, the cast can be removed to rely on the type guard.

---

_Reviewed: 2026-04-13T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
