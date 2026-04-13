---
phase: 08-retrieval-grounding
reviewed: 2026-04-13T00:00:00Z
depth: standard
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
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-04-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This phase wires retrieval-grounded responses into the JOURNAL mode handler and adds `hybridSearch` with temporal weighting, epistemic tag filtering, and mode-specific search presets. The implementation is solid and well-tested. No security vulnerabilities or data-loss risks were found.

Three warnings relate to correctness risks: a `PHOTOS` mode silently skips the `{pensieveContext}` replacement step (inheriting the raw placeholder from the template), `hybridSearch` does not deduplicate multi-chunk entries the way `searchPensieve` does (meaning the same entry can appear multiple times in JOURNAL grounding results), and `hybridSearch` accepts `tags` typed as `string[]` but casts them to enum values at the call site without runtime validation. Four info items cover dead parameters, inconsistency in prompt persona names, a redundant `null` default in a log field, and a comment that names a retired requirement code.

---

## Warnings

### WR-01: PHOTOS mode does not replace `{pensieveContext}` placeholder

**File:** `src/chris/personality.ts:99`
**Issue:** The `PHOTOS` case falls through to `JOURNAL_SYSTEM_PROMPT` without calling `.replace('{pensieveContext}', contextValue)`. Because the raw `JOURNAL_SYSTEM_PROMPT` constant contains the literal `{pensieveContext}` placeholder, the system prompt sent to the LLM for photo messages will contain the unreplaced string. Any pensieve context passed in will be silently dropped, and the hallucination-resistance fallback phrase will not be present either.

```typescript
case 'PHOTOS':
  modeBody = JOURNAL_SYSTEM_PROMPT; // BUG: placeholder not replaced
  break;
```

**Fix:**
```typescript
case 'PHOTOS':
  modeBody = JOURNAL_SYSTEM_PROMPT.replace('{pensieveContext}', contextValue);
  break;
```

---

### WR-02: `hybridSearch` does not deduplicate multi-chunk entries

**File:** `src/pensieve/retrieve.ts:150-167`
**Issue:** `searchPensieve` (lines 58-69) deduplicates rows by `entry.id`, keeping only the best-scoring chunk per entry before applying the result limit. `hybridSearch` does not perform this deduplication step — it maps every raw DB row directly to a scored result. Because entries are chunked into multiple embedding rows, a single entry can appear multiple times in the returned array, inflating the apparent coverage of JOURNAL grounding context and crowding out genuinely distinct entries.

**Fix:** Apply the same per-entry deduplication before the blended score sort:
```typescript
// After computing `scored`, before filtering by minScore:
const bestByEntry = new Map<string, typeof scored[number]>();
for (const item of scored) {
  const id = item.entry.id;
  const existing = bestByEntry.get(id);
  if (!existing || item.score > existing.score) {
    bestByEntry.set(id, item);
  }
}
const deduped = Array.from(bestByEntry.values());

const filtered = options.minScore != null
  ? deduped.filter((r) => r.score >= options.minScore!)
  : deduped;
```

---

### WR-03: `tags` cast to enum values without runtime validation

**File:** `src/pensieve/retrieve.ts:129-133`
**Issue:** `SearchOptions.tags` is typed as `string[]`. Inside `hybridSearch`, those strings are cast directly to `(typeof epistemicTagEnum.enumValues)[number][]` without checking whether the values actually exist in the enum. If an invalid tag is passed in (e.g., from a misconfigured preset or a future code change), the cast will succeed at compile time but the resulting SQL `IN (...)` clause will silently return no rows matching the tag filter, making retrieval appear to work while actually filtering everything out.

```typescript
inArray(
  pensieveEntries.epistemicTag,
  options.tags as (typeof epistemicTagEnum.enumValues)[number][],  // unchecked cast
),
```

**Fix:** Either tighten `SearchOptions.tags` to the enum union type so the compiler enforces correctness at call sites, or add a runtime guard:
```typescript
export type SearchOptions = {
  tags?: (typeof epistemicTagEnum.enumValues)[number][];
  // ...
};
```
This eliminates the cast entirely. The presets already use string literals that match the enum — the type change would surface any mismatch at compile time.

---

## Info

### IN-01: `relationalContext` parameter is accepted but never used in JOURNAL/INTERROGATE/PHOTOS

**File:** `src/chris/personality.ts:63-68`
**Issue:** `buildSystemPrompt` accepts a `relationalContext` parameter. For JOURNAL, INTERROGATE, and PHOTOS modes, this parameter is silently ignored — neither prompt template contains a `{relationalContext}` placeholder. Callers passing relational context for these modes will get no error and no effect. This is either dead parameter surface or an unfinished integration.

**Fix:** If relational context is intentionally unused for JOURNAL/INTERROGATE/PHOTOS, document it explicitly in the JSDoc. If it is intended for future use, add a `// TODO` noting the intent so it is not confused for a bug.

---

### IN-02: Inconsistent persona name in prompt templates — "John" vs. "Greg"

**File:** `src/llm/prompts.ts` (multiple lines), `src/chris/personality.ts:47`
**Issue:** All six mode system prompts address the user as "John" (e.g., "You are Chris, John's thoughtful and perceptive friend"). The `buildKnownFactsBlock` function and all `Known Facts` section headers use "Greg". The `CONSTITUTIONAL_PREAMBLE` also uses "Greg". This inconsistency means the LLM receives contradictory identity signals in a single prompt — the mode body says the user is "John" while the injected preamble and facts block say "Greg". At minimum this is confusing; at worst it could cause the model to address the user by the wrong name.

**Fix:** Align all prompt templates to a single name. Based on the Known Facts data (`nationality: French`, `birth_place: Cagnes-sur-Mer`) and the preamble, "Greg" appears to be the production user. Update all occurrences of "John" in the prompt templates to "Greg", or vice-versa if "John" is intentional.

---

### IN-03: `tags: options.tags ?? null` in log payload — `null` is inconsistent with type

**File:** `src/pensieve/retrieve.ts:175`
**Issue:** The success log emits `tags: options.tags ?? null`. `options.tags` is typed `string[] | undefined`. Logging `null` when no tags are provided is inconsistent — the field toggles between `string[]` and `null`. Log consumers filtering or parsing on `tags` presence will need to handle both `undefined` and `null` as "no filter". Using `undefined` omits the field from the structured log object entirely, which is cleaner for log aggregation.

**Fix:**
```typescript
// Remove the field when undefined to keep the log object clean:
...(options.tags ? { tags: options.tags } : {}),
```

---

### IN-04: `cache_control` passed as a top-level Anthropic API parameter

**File:** `src/chris/modes/journal.ts:44`
**Issue:** `cache_control: { type: 'ephemeral' }` is passed as a top-level field in the `messages.create` call body. The Anthropic prompt-caching API applies `cache_control` at the content-block level (inside `system` as an array element), not as a root-level parameter. This pattern is consistent across many files in the codebase (it is not unique to this phase), but as written the field is likely silently ignored by the SDK for JOURNAL calls. This is a functional no-op rather than a correctness risk — it does not break anything — but it means prompt caching is not actually being enabled for journal responses despite the intent.

**Fix:** If prompt caching is desired, pass `system` as an array with a `cache_control` block:
```typescript
system: [
  {
    type: 'text',
    text: buildSystemPrompt('JOURNAL', pensieveContext, undefined, language, declinedTopics),
    cache_control: { type: 'ephemeral' },
  },
],
```
Note: this finding applies to all mode handlers, not only journal. The change is low-risk but affects caching billing. Coordinate the fix across all handlers.

---

_Reviewed: 2026-04-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
