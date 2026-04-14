---
phase: 08-retrieval-grounding
fixed_at: 2026-04-14T00:00:00Z
review_path: .planning/phases/08-retrieval-grounding/08-REVIEW.md
iteration: 3
findings_in_scope: 4
fixed: 3
skipped: 1
status: partial
iteration_history:
  - iteration: 1
    findings_in_scope: 3
    fixed: 3
    skipped: 0
    status: all_fixed
  - iteration: 3
    findings_in_scope: 4
    fixed: 3
    skipped: 1
    status: partial
---

# Phase 08: Code Review Fix Report

**Fixed at:** 2026-04-14T00:00:00Z
**Source review:** .planning/phases/08-retrieval-grounding/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (critical + warning)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: PHOTOS mode does not replace `{pensieveContext}` placeholder

**Files modified:** `src/chris/personality.ts`
**Commit:** ed1684b
**Applied fix:** Changed the `PHOTOS` case in `buildSystemPrompt` to call `JOURNAL_SYSTEM_PROMPT.replace('{pensieveContext}', contextValue)` so the placeholder is substituted with the pensieve context (or the fallback string) instead of being sent raw to the LLM.

### WR-03: `tags` cast to enum values without runtime validation

**Files modified:** `src/pensieve/retrieve.ts`
**Commit:** 71248b1
**Applied fix:** Tightened `SearchOptions.tags` from `string[]` to `(typeof epistemicTagEnum.enumValues)[number][]` and removed the unchecked `as` cast at the `inArray` call site. TypeScript now enforces valid enum values at all call sites (presets and other callers). `npx tsc --noEmit` passes with no new errors.

### WR-02: `hybridSearch` does not deduplicate multi-chunk entries

**Files modified:** `src/pensieve/retrieve.ts`
**Commit:** 523e497
**Applied fix:** Added per-entry deduplication after blended-score computation in `hybridSearch`. A `Map<entryId, scored>` keeps only the best-scoring chunk per entry, matching the existing pattern in `searchPensieve`. `minScore` filtering and limit slicing now operate on the deduped array.

## Skipped Issues

None — all in-scope findings were fixed.

---

_Fixed: 2026-04-14T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

---

## Iteration 3 — Info Findings

**Fixed at:** 2026-04-14T00:00:00Z
**Source review:** .planning/phases/08-retrieval-grounding/08-REVIEW.md (iteration 2)
**Iteration:** 3

**Summary:**
- Findings in scope: 4 (info)
- Fixed: 3
- Skipped: 1 (already resolved upstream)

### Fixed Issues

#### IN-01: `relationalContext` parameter accepted but unused in some modes

**Files modified:** `src/chris/personality.ts`
**Commit:** 10a0132
**Applied fix:** Added JSDoc on `buildSystemPrompt` documenting parameter usage per mode. Clarified that `pensieveContext` is substituted into all modes, while `relationalContext` is substituted ONLY into REFLECT/COACH/PSYCHOLOGY (the modes whose templates contain a `{relationalContext}` placeholder). JOURNAL, INTERROGATE, PRODUCE, and PHOTOS accept the argument but intentionally ignore it — the doc explicitly notes callers may safely pass a value and it will be silently dropped.

Note: the review's IN-01 listed JOURNAL/INTERROGATE/PHOTOS as the ignoring modes. PRODUCE also falls into that bucket based on actual code inspection (`PRODUCE_SYSTEM_PROMPT` has no `{relationalContext}` placeholder and the `PRODUCE` case in `buildSystemPrompt` does not call `.replace('{relationalContext}', ...)`). Documentation reflects the accurate set.

#### IN-03: `tags: options.tags ?? null` inconsistent type in log payload

**Files modified:** `src/pensieve/retrieve.ts`
**Commit:** d4d5911
**Applied fix:** Replaced `tags: options.tags ?? null` with conditional spread `...(options.tags ? { tags: options.tags } : {})` in the `pensieve.hybrid-retrieve` success log. The `tags` field is now either an `enum[]` or absent entirely — no more `null`/array toggle for consumers to handle.

#### IN-04: `cache_control` misplaced — prompt caching was a no-op

**Files modified:** `src/chris/modes/journal.ts`, `src/chris/modes/interrogate.ts`, `src/chris/modes/reflect.ts`, `src/chris/modes/coach.ts`, `src/chris/modes/psychology.ts`, `src/chris/modes/produce.ts`, `src/chris/modes/photos.ts`
**Commit:** a05dd6c
**Applied fix:** Moved `cache_control: { type: 'ephemeral' }` out of the top-level `messages.create` param (where the Anthropic SDK silently ignores it) into a content-block array element inside the `system` field. System prompts are now passed as `[{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]`. Applied uniformly across all 7 mode handlers that had the pattern. Ephemeral caching will now actually engage for the large constitutional preamble + mode prompt + known-facts block.

**Status:** Requires human verification — behavioral change; caching was previously a no-op, so the first call after this change will populate the cache (expected). Subsequent calls should see `cache_read_input_tokens > 0` on the usage payload. No test-suite impact expected since tests mock `anthropic.messages.create`, but runtime verification against the real API is the only way to confirm caching engages as intended.

**Note on broader scope:** Similar `cache_control` placement exists in `src/pensieve/tagger.ts:40`, `src/memory/relational.ts:65`, `src/proactive/mute.ts:94,164`, `src/proactive/triggers/opus-analysis.ts:79`, `src/proactive/sweep.ts:133`, `src/chris/engine.ts:46`, and `src/chris/contradiction.ts:119`. Those were out of the phase-08 review scope for this fix pass — they carry the same latent no-op behavior and should be addressed in a follow-up if prompt caching is desired across the entire LLM surface.

### Skipped Issues

#### IN-02: Persona name inconsistency ("John" vs. "Greg")

**Files examined:** `src/llm/prompts.ts`, `src/chris/personality.ts`, `src/proactive/prompts.ts`, `src/pensieve/ground-truth.ts`
**Reason:** Already resolved upstream. Phase 7 commit `e3afdec` (`fix(07): CR-01 align persona name to John across constitutional preamble`) standardized the address-form on "John" across all prompt templates. Audit of `src/llm/prompts.ts`, `src/chris/personality.ts`, and `src/proactive/prompts.ts` shows every user-facing prompt template already addresses the user as "John" and the `buildKnownFactsBlock` header is "## Known Facts About John".

Remaining "Greg" references fall into two categories, both intentionally preserved per the fix task's guidance:
1. **Ground-truth factual data** describing the real user (`src/pensieve/ground-truth.ts` comments, `src/scripts/audit-pensieve.ts` comments) — these describe the actual user identity and are kept intact.
2. **Test fixtures** asserting identity facts (`src/chris/__tests__/live-integration.test.ts`, `src/chris/__tests__/photos-memory.test.ts`, `src/chris/__tests__/journal.test.ts`, `src/chris/__tests__/photos.test.ts`) — these validate real-user identity handling and are not address-form usages.

No code change required; the iteration-2 review's concern was the `buildKnownFactsBlock` header referencing "John" alongside Greg-identifying GROUND_TRUTH facts, but per task guidance the address-form is the canonical "John" and the factual content describes the real user. The contradiction-looking prompt is by design.

---

_Fixed: 2026-04-14T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
