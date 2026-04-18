---
phase: 08-retrieval-grounding
reviewed: 2026-04-18T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/chris/modes/journal.ts
  - src/chris/personality.ts
  - src/llm/prompts.ts
  - src/pensieve/retrieve.ts
  - src/pensieve/__tests__/retrieve.test.ts
  - src/chris/__tests__/journal.test.ts
  - src/chris/__tests__/engine.test.ts
  - src/chris/__tests__/engine-mute.test.ts
  - src/chris/__tests__/personality.test.ts
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
status: issues_found
---

# Phase 08: Code Review Report

**Reviewed:** 2026-04-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Fresh standard-depth review of Phase 8 (Retrieval & Grounding) artifacts — JOURNAL hybrid retrieval, the structured "Known Facts About Greg" block, and their integration through `handleJournal` / `buildSystemPrompt`. The phase shipped 2026-04-13 and v2.1 landed on top without touching these files (`retrieve.ts`, `personality.ts`, `journal.ts` are all unchanged since before v2.1 began — only `retrieve.ts` grew `getTemporalPensieve` during v2.1 Phase 16, which is orthogonal to Phase 8 contracts).

**What's solid:**
- Injection order in `buildSystemPrompt` matches D-05 exactly: `CONSTITUTIONAL_PREAMBLE → modeBody → Known Facts (JOURNAL/INTERROGATE only) → Language Directive → Declined Topics`. Verified at `personality.ts:145–165` and exercised by `personality.test.ts:143–150`.
- `JOURNAL_SEARCH_OPTIONS` at `retrieve.ts:302–306` uses exactly the four fact-type tags required by D031 (`FACT`, `RELATIONSHIP`, `PREFERENCE`, `VALUE`), `recencyBias: 0.3`, `limit: 10` — matches spec.
- `hybridSearch` SQL is correct: `isNull(deletedAt)` + `inArray(epistemicTag, tags)` combined via `and(...conditions)`, `cosineDistance` join through `pensieveEmbeddings → pensieveEntries`, post-fetch temporal weighting, dedup keeps best chunk per entry, post-filter by `minScore`. Behaviour matches the test contract.
- `handleJournal` invokes retrieval on every message (D-10 verified by `journal.test.ts:106–110`), passes `includeDate: false` to `buildPensieveContext` per RETR-04, and correctly forwards `language` and `declinedTopics` to `buildSystemPrompt`.
- Known Facts block is gated on `mode === 'JOURNAL' || mode === 'INTERROGATE'` at `personality.ts:148` — other modes are correctly excluded, as asserted by `personality.test.ts:133–141`.

**What needs attention:**
- Two correctness warnings — one silent-failure bug where a new `FactCategory` would be dropped from the Known Facts block without any diagnostic, and one latent NaN risk in hybrid scoring when `createdAt` is null.
- Five info-level items around coverage gaps, style, and minor duplication.

## Warnings

### WR-01: `buildKnownFactsBlock` silently drops entries whose category is not listed in `categoryOrder`

**File:** `src/chris/personality.ts:46-59`
**Issue:** `buildKnownFactsBlock` iterates only over a hard-coded `categoryOrder: FactCategory[]` array of five categories (`identity`, `location_history`, `property`, `business`, `financial`). If a future contributor adds a sixth category to the `FactCategory` union in `ground-truth.ts` and adds entries under it, those entries will be silently excluded from the system prompt — no TypeScript error, no runtime warning, no test failure (the tests at `personality.test.ts:118–131` only assert presence of currently-known keys). This is exactly the class of drift that TRUST-11 was trying to prevent: structured facts disappearing from the retrieval context without anyone noticing. Given that the whole point of D031 is "structured facts not prose dump," quietly omitting a category is a direct regression of that invariant.

**Fix:** Iterate all entries and group by category, preserving the defined ordering while emitting unknown categories at the end (or failing fast in dev). Also add a `satisfies` / exhaustiveness check so the array is tied to the union type:

```typescript
function buildKnownFactsBlock(): string {
  const categoryOrder: readonly FactCategory[] = [
    'identity', 'location_history', 'property', 'business', 'financial',
  ] as const;

  // Exhaustiveness guard — compile error if a FactCategory is added and
  // not included above.
  const _exhaustive: Record<FactCategory, true> = {
    identity: true,
    location_history: true,
    property: true,
    business: true,
    financial: true,
  };
  void _exhaustive;

  const lines: string[] = [
    '## Facts about you (Greg)',
    'These are authoritative facts about you, the person Chris is talking to. Treat any reference to "Greg" in these facts as referring to you — not a third party.',
  ];
  const seen = new Set<string>();
  for (const cat of categoryOrder) {
    for (const entry of GROUND_TRUTH.filter((e) => e.category === cat)) {
      lines.push(`- ${entry.key}: ${entry.value}`);
      seen.add(entry.key);
    }
  }
  // Safety net — any entry whose category wasn't in categoryOrder still ships.
  for (const entry of GROUND_TRUTH) {
    if (!seen.has(entry.key)) lines.push(`- ${entry.key}: ${entry.value}`);
  }
  return lines.join('\n');
}
```

### WR-02: `hybridSearch` blended score becomes `NaN` when `entry.createdAt` is null

**File:** `src/pensieve/retrieve.ts:210-217`
**Issue:** Line 213 reads `new Date(row.entry.createdAt!).getTime()`. The non-null assertion defers to the schema's default (`defaultNow()` on `pensieve_entries.created_at`), but nothing in the runtime path enforces that the column is actually non-null — the Drizzle inferred type likely marks it as `Date | null`. If a row somehow has `createdAt === null` (a corrupt row, a backfill migration, or a synthetic fixture), then:
- `new Date(null).getTime()` → `0` (January 1, 1970), producing a massive `daysSince`, which drives `exp(-recencyBias * daysSince / 365)` to ~0, effectively deleting the row from ranking.
- Worse, if the non-null assertion is ever dropped and the value becomes `NaN` via `new Date(undefined).getTime()`, every row in the result set gets `blendedScore = NaN`, and `filtered.sort((a, b) => b.score - a.score)` becomes a no-op (NaN comparisons are always false), yielding an arbitrary order. The `minScore` filter would then drop every row (`NaN >= 0.4` is false) — silently returning an empty array on an otherwise successful query.

The `searchPensieve` code path does not read `createdAt` at all, so this is a `hybridSearch`-only risk. Not tested — `retrieve.test.ts` never constructs an entry with `createdAt: null`.

**Fix:** Default missing timestamps to the current instant (no temporal penalty) and drop the non-null assertion:

```typescript
const createdAtMs = row.entry.createdAt
  ? new Date(row.entry.createdAt).getTime()
  : Date.now();
const daysSince = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
const blendedScore = cosineSim * Math.exp(-recencyBias * daysSince / 365);
```

Add one regression test that constructs a row with `createdAt: null` and asserts it is still returned (not silently dropped, not NaN-ranked).

## Info

### IN-01: `hybridSearch` over-fetch factor (2×) is smaller than `searchPensieve` (3×) — potential recall loss after per-entry dedup

**File:** `src/pensieve/retrieve.ts:196`
**Issue:** `sqlLimit = Math.max(limit * 2, 20)`. Since `pensieveEmbeddings` stores chunked rows (multiple chunks per entry), post-fetch dedup via `bestByEntry` can collapse many rows into few entries. For a long document with N chunks, all N may land in the top 20, then deduplicate to 1 entry — leaving `hybridSearch` with far fewer than `limit` results despite more matches existing just past the SQL limit. `searchPensieve` handles this with `limit * 3`; `hybridSearch` uses `limit * 2`. In the worst case (JOURNAL with `limit: 10`, `sqlLimit = 20`), a single Gmail thread split into 20 chunks could monopolize the fetch and dedup to one result.
**Fix:** Mirror `searchPensieve`'s 3× factor for consistency and safety: `const sqlLimit = Math.max(limit * 3, 20);`. Add a unit test that feeds 20 chunks of the same entry plus one other entry and asserts both entries are returned.

### IN-02: `.replace('{pensieveContext}', contextValue)` replaces only the first occurrence

**File:** `src/chris/personality.ts:100, 103, 107, 112, 117, 121, 125, 141`
**Issue:** `String.prototype.replace` with a literal string replaces only the first match. No current template in `prompts.ts` contains `{pensieveContext}` twice, so this is latent. If a future template ever duplicates the placeholder (e.g., "context: {pensieveContext} ... repeat: {pensieveContext}"), the second occurrence will leak into the rendered system prompt as a literal placeholder — visible to the model.
**Fix:** Use `replaceAll` for defence in depth: `JOURNAL_SYSTEM_PROMPT.replaceAll('{pensieveContext}', contextValue)`. Applies equally to `{relationalContext}` and `{decisionContext}` substitutions on lines 108, 113, 118, 140-141.

### IN-03: No test coverage for `deletedAt IS NULL` filter in `hybridSearch`

**File:** `src/pensieve/__tests__/retrieve.test.ts` (gap)
**Issue:** `searchPensieve` has a structural test at lines 174–187 asserting the `where()` clause is invoked. `hybridSearch` has the same filter (`retrieve.ts:188`) but no analogous test — only an indirect check that `mockWhere` was called in the tag-filter test at line 294. A future refactor could remove `isNull(deletedAt)` from the `conditions` array and every `hybridSearch` test would still pass.
**Fix:** Add a test mirroring the `searchPensieve` structural assertion, and (better) a behavioural test where the mock returns a row with `deletedAt != null` and asserts it is filtered out. The latter requires pushing the filter into the mock layer, which the current Drizzle builder mocks can't easily do — so a structural assertion is acceptable.

### IN-04: `TEMPORAL_PENSIEVE_LIMIT` constant declared mid-file between function JSDoc and definition

**File:** `src/pensieve/retrieve.ts:106`
**Issue:** `const TEMPORAL_PENSIEVE_LIMIT = 50;` is placed between `getTemporalPensieve`'s JSDoc block and its signature. Readers reasonably expect module-level constants either at the top or co-located as a `const` right before the function. The current placement splits the JSDoc from the function in a way ESLint's `@typescript-eslint/member-ordering` would flag in many configs.
**Fix:** Move the constant above the JSDoc block (so the JSDoc immediately precedes the `export async function` declaration), or group it with the `// ── Public API ──` section at line 21. Pure readability fix.

### IN-05: Redundant type assertion in `handleJournal` after type guard

**File:** `src/chris/modes/journal.ts:65`
**Issue:** `const responseText = (textBlock as { type: 'text'; text: string }).text;` — the preceding check at line 61 (`if (!textBlock || textBlock.type !== 'text')`) already narrows `textBlock` to the `'text'` variant for TypeScript, so the `as` assertion is unnecessary unless the Anthropic SDK's content-block union is typed looser than expected.
**Fix:** Drop the assertion: `const responseText = textBlock.text;`. If this fails to compile, the underlying type problem is on the SDK side (content-block union too broad) and should be handled with a properly scoped type guard function, not an inline assertion.

---

_Reviewed: 2026-04-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
