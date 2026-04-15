---
phase: 08-retrieval-grounding
reviewed: 2026-04-14T00:00:00Z
depth: standard
iteration: 2
files_reviewed: 9
files_reviewed_list:
  - src/chris/__tests__/engine-mute.test.ts
  - src/chris/__tests__/engine.test.ts
  - src/chris/__tests__/journal.test.ts
  - src/chris/__tests__/personality.test.ts
  - src/chris/modes/journal.ts
  - src/chris/personality.ts
  - src/llm/prompts.ts
  - src/pensieve/__tests__/retrieve.test.ts
  - src/pensieve/retrieve.ts
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
status: issues_found
---

# Phase 08: Code Review Report (Iteration 2)

**Reviewed:** 2026-04-14T00:00:00Z
**Depth:** standard
**Iteration:** 2 (auto-fix loop re-review)
**Files Reviewed:** 9
**Status:** issues_found (info-only)

## Summary

Re-review after fix commits `ed1684b` (WR-01), `71248b1` (WR-03), `523e497` (WR-02). All three prior warnings are resolved cleanly. No new critical or warning issues were introduced by the fixes. No new issues surfaced in the surrounding test files or mode handlers.

Four info-level items from iteration 1 remain unaddressed. They are non-blocking and were not part of the auto-fix scope. They are re-listed below unchanged for tracking.

## Fix Verification

### WR-01 — PHOTOS `{pensieveContext}` placeholder — FIXED
`src/chris/personality.ts:100` now reads:
```typescript
case 'PHOTOS':
  // Photos mode uses Journal persona with vision
  modeBody = JOURNAL_SYSTEM_PROMPT.replace('{pensieveContext}', contextValue);
  break;
```
Placeholder substitution is performed for PHOTOS mode on the same path as JOURNAL. Verified.

### WR-02 — `hybridSearch` multi-chunk deduplication — FIXED
`src/pensieve/retrieve.ts:156-165` adds a per-entry best-score reduction before `minScore` filtering and final sort:
```typescript
const bestByEntry = new Map<string, (typeof scored)[number]>();
for (const item of scored) {
  const id = item.entry.id;
  const existing = bestByEntry.get(id);
  if (!existing || item.score > existing.score) {
    bestByEntry.set(id, item);
  }
}
const deduped = Array.from(bestByEntry.values());
```
Parity with `searchPensieve` dedup behavior is restored. Ordering is correct: dedup -> minScore filter -> re-sort -> limit. Verified.

### WR-03 — `SearchOptions.tags` enum tightening — FIXED
`src/pensieve/retrieve.ts:15` narrows the type at the source:
```typescript
tags?: (typeof epistemicTagEnum.enumValues)[number][];
```
The unchecked cast at the `inArray` call site is gone (line 128 passes `options.tags` directly). Invalid tag values now fail at compile time rather than silently zero-filtering queries. All preset literals (`'FACT'`, `'EMOTION'`, etc.) remain valid against the enum. Verified.

## Info (Carried Forward, Unchanged)

### IN-01: `relationalContext` parameter is accepted but never used in JOURNAL/INTERROGATE/PHOTOS

**File:** `src/chris/personality.ts:63-68`
**Issue:** `buildSystemPrompt` accepts a `relationalContext` parameter. For JOURNAL, INTERROGATE, and PHOTOS modes this parameter is silently ignored — neither prompt template contains a `{relationalContext}` placeholder. Callers passing relational context for these modes will get no error and no effect.
**Fix:** Document the intentional no-op in JSDoc, or add a `// TODO` if future use is planned.

---

### IN-02: Inconsistent persona name in prompt templates — "John" vs. "Greg"

**File:** `src/llm/prompts.ts` (all mode templates), `src/chris/personality.ts:47`
**Issue:** All mode system prompts address the user as "John". The `buildKnownFactsBlock` header is "## Known Facts About John" but the `GROUND_TRUTH` facts (`nationality: French`, `birth_place: Cagnes-sur-Mer`) and preamble narrative clearly refer to "Greg" (git user is `Greg`). The LLM receives contradictory identity signals in a single prompt.
**Fix:** Align all prompt templates to a single name. Update "John" to "Greg" (or vice versa) consistently in `src/llm/prompts.ts` and the `buildKnownFactsBlock` header.

---

### IN-03: `tags: options.tags ?? null` in log payload — `null` is inconsistent with type

**File:** `src/pensieve/retrieve.ts:183`
**Issue:** Success log emits `tags: options.tags ?? null`. `options.tags` is typed `enum[] | undefined`. Logging `null` when absent is inconsistent — the field toggles between `enum[]` and `null`. Log consumers must handle both "no filter" representations.
**Fix:** Conditionally include the field:
```typescript
...(options.tags ? { tags: options.tags } : {}),
```

---

### IN-04: `cache_control` passed as a top-level Anthropic API parameter

**File:** `src/chris/modes/journal.ts:44`
**Issue:** `cache_control: { type: 'ephemeral' }` is passed as a top-level field in `messages.create`. The Anthropic prompt-caching API applies `cache_control` at the content-block level (inside `system` as an array element), not root-level. The SDK silently ignores the root-level field, so caching is not actually enabled for JOURNAL calls despite intent. (This pattern recurs across other mode handlers — not unique to this phase.)
**Fix:**
```typescript
system: [
  {
    type: 'text',
    text: buildSystemPrompt('JOURNAL', pensieveContext, undefined, language, declinedTopics),
    cache_control: { type: 'ephemeral' },
  },
],
```
Coordinate across all handlers if adopted.

---

_Reviewed: 2026-04-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 2_
