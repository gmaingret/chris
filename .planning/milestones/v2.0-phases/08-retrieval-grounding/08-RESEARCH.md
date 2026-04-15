# Phase 8: Retrieval & Grounding - Research

**Researched:** 2026-04-13
**Domain:** Hybrid retrieval injection, structured fact blocks, hallucination resistance prompt design
**Confidence:** HIGH

## Summary

Phase 8 upgrades JOURNAL mode from zero retrieval to the same hybrid retrieval pattern already used by INTERROGATE, REFLECT, COACH, PSYCHOLOGY, and PRODUCE. Every asset needed already exists — `hybridSearch()`, `buildPensieveContext()`, `GROUND_TRUTH`, and `buildSystemPrompt()` all support this change with zero structural additions. The work is three targeted surgical edits: (1) `journal.ts` calls `hybridSearch()` before Sonnet; (2) `buildSystemPrompt()` injects the Known Facts block for JOURNAL and INTERROGATE; (3) `JOURNAL_SYSTEM_PROMPT` gets a `{pensieveContext}` placeholder and hallucination resistance instruction.

The CONTEXT.md decisions lock the entire implementation strategy. No design decisions remain open — all discretionary items are wording choices made at implementation time.

**Primary recommendation:** Implement JOURNAL retrieval by mirroring interrogate.ts exactly, then extend `buildSystemPrompt()` to render `GROUND_TRUTH` as a structured block before the language/declined-topics directives.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** JOURNAL mode calls `hybridSearch()` before each Sonnet call, using tags `['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE']`
- **D-02:** Search preset uses moderate recency bias (0.3), limit 10, no minimum score threshold
- **D-03:** Retrieved context is formatted via `buildPensieveContext()` and passed to `buildSystemPrompt('JOURNAL', pensieveContext, ...)`
- **D-04:** `GROUND_TRUTH` array from `src/pensieve/ground-truth.ts` is rendered as "Known Facts About Greg" key-value block; injected for JOURNAL and INTERROGATE modes; always present, not dynamically retrieved
- **D-05:** Known Facts block injected by `buildSystemPrompt()` as separate section after mode body and before language/declined-topics directives; format: `## Known Facts About Greg\n- key: value` grouped by category
- **D-06:** Known Facts block (structured, authoritative) is separate from `{pensieveContext}` (contextual, scored). LLM sees two distinct sections.
- **D-07:** JOURNAL mode system prompt gets explicit instruction: when asked about factual details not present in Known Facts block or retrieved context, Chris must say it doesn't have that information
- **D-08:** Hallucination resistance is prompt-level instruction only — no code logic for presence/absence detection
- **D-09:** INTERROGATE mode grounding instructions — verify they're sufficient and align "I don't have that information" language for consistency
- **D-10:** Retrieval runs on every JOURNAL message — no selective triggering

### Claude's Discretion

- Exact wording of the hallucination resistance prompt instruction
- Whether to also inject Known Facts into REFLECT/COACH/PSYCHOLOGY/PRODUCE modes (they already have retrieval, but not the static facts block)
- JOURNAL search preset fine-tuning (exact recency bias value, limit count) based on what works during testing
- Whether `buildPensieveContext()` needs any modification for JOURNAL-specific formatting

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RETR-01 | JOURNAL mode uses hybrid retrieval (FACT/RELATIONSHIP/PREFERENCE/VALUE tags) before each Sonnet call | `hybridSearch()` with tag filter exists in `retrieve.ts`; JOURNAL preset mirrors PRODUCE_SEARCH_OPTIONS pattern |
| RETR-02 | Structured fact injection — stable facts injected as "Known Facts" key-value block | `GROUND_TRUTH` array (13 entries, 5 categories) exists in `ground-truth.ts`; `buildSystemPrompt()` already accepts pensieveContext parameter pattern |
| RETR-04 | Chris says "I don't have any memories about that" for facts not in the Pensieve | INTERROGATE prompt has this wording already; JOURNAL prompt needs equivalent instruction with `{pensieveContext}` placeholder |
</phase_requirements>

## Standard Stack

No new dependencies are introduced in this phase. All work is internal to the existing codebase.

### Core (already present)

| Asset | Location | Purpose | Status |
|-------|----------|---------|--------|
| `hybridSearch()` | `src/pensieve/retrieve.ts` | Tag-filtered semantic search with recency bias | Ready — JOURNAL preset to be added |
| `buildPensieveContext()` | `src/memory/context-builder.ts` | Formats SearchResult[] as numbered citation blocks | Ready — no changes needed |
| `GROUND_TRUTH` | `src/pensieve/ground-truth.ts` | 13 typed ground-truth entries, 5 categories | Ready — Phase 6 deliverable |
| `buildSystemPrompt()` | `src/chris/personality.ts` | Constructs mode system prompts; already accepts `pensieveContext` | Needs Known Facts injection logic |
| `JOURNAL_SYSTEM_PROMPT` | `src/llm/prompts.ts` | JOURNAL mode persona template | Needs `{pensieveContext}` placeholder and hallucination resistance instruction |

**Installation:** None required. [VERIFIED: codebase grep]

## Architecture Patterns

### Established Retrieval Pattern (from interrogate.ts)

Every non-JOURNAL mode follows this sequence. JOURNAL adopts it exactly:

```typescript
// Source: src/chris/modes/interrogate.ts (verified)
const searchResults = await hybridSearch(text, JOURNAL_SEARCH_OPTIONS);
const pensieveContext = buildPensieveContext(searchResults);
const systemPrompt = buildSystemPrompt('JOURNAL', pensieveContext, undefined, language, declinedTopics);
```

The difference from INTERROGATE: JOURNAL uses `hybridSearch()` (with tag filter) instead of `searchPensieve()`, and uses a mode-specific preset.

### JOURNAL_SEARCH_OPTIONS Preset

Pattern follows existing presets in `retrieve.ts` (PRODUCE is the closest analog — moderate recency, no tag restriction, limit 10):

```typescript
// Source: src/pensieve/retrieve.ts — PRODUCE_SEARCH_OPTIONS pattern (verified)
// Locked by D-02:
export const JOURNAL_SEARCH_OPTIONS: SearchOptions = {
  tags: ['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE'],
  recencyBias: 0.3,
  limit: 10,
};
```

### Known Facts Block Injection in buildSystemPrompt()

The block is injected after mode body substitution and before language/declined-topics directives. Grouped by category per D-05:

```typescript
// Source: pattern inferred from src/chris/personality.ts (verified structure)
// Pseudo-code for the injection logic:
function buildKnownFactsBlock(): string {
  const categories: FactCategory[] = ['identity', 'location_history', 'property', 'business', 'financial'];
  const lines: string[] = ['## Known Facts About Greg'];
  for (const cat of categories) {
    const entries = GROUND_TRUTH.filter((e) => e.category === cat);
    for (const entry of entries) {
      lines.push(`- ${entry.key}: ${entry.value}`);
    }
  }
  return lines.join('\n');
}
```

The Known Facts block is injected for JOURNAL and INTERROGATE modes (D-04). The `buildSystemPrompt()` switch statement already branches by mode — the injection is added inside the JOURNAL and INTERROGATE cases after their `modeBody` is set.

### JOURNAL_SYSTEM_PROMPT Template Changes

Current: No `{pensieveContext}` placeholder. No hallucination resistance instruction.

Required additions (locked by D-07, D-08):
1. Add `## Memory Entries\n{pensieveContext}` section (matches INTERROGATE pattern)
2. Add hallucination resistance rule to Hard Rules section

The exact wording is Claude's discretion, but must align with INTERROGATE's existing: "If the Memory Entries section is empty or says 'No relevant memories found', say honestly: 'I don't have any memories about that.'"

### Recommended Project Structure

No new directories or files required. Changes are in-place edits to three existing files:

```
src/
├── chris/
│   ├── modes/
│   │   └── journal.ts          # Add hybridSearch() call + pass pensieveContext
│   └── personality.ts          # Add Known Facts block injection
├── llm/
│   └── prompts.ts              # Add {pensieveContext} + hallucination resistance to JOURNAL_SYSTEM_PROMPT
└── pensieve/
    └── retrieve.ts             # Add JOURNAL_SEARCH_OPTIONS preset
```

### Anti-Patterns to Avoid

- **Selective retrieval triggering:** D-10 locks unconditional retrieval on every JOURNAL message. Do not add message classification to decide "does this need facts?".
- **Prose dump instead of structured block:** D-06 / D031 project decision. The Known Facts block must be a distinct `## Known Facts About Greg` section, not merged into the narrative pensieveContext.
- **Modifying buildPensieveContext():** The existing formatting (`[N] (date | TAG | score) "content"`) is correct for JOURNAL. No JOURNAL-specific formatting needed (Claude's discretion item — default is no changes).
- **Adding minScore to JOURNAL preset:** D-02 explicitly omits minimum score threshold. Do not add one.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tag-filtered retrieval | Custom DB query | `hybridSearch()` with `tags` option | Already handles recency bias, dedup, error handling, logging |
| Context formatting | Custom citation formatter | `buildPensieveContext()` | Consistent `[N] (date | TAG | score) "content"` format already established |
| Ground truth lookup | Hardcoded prompt strings | `GROUND_TRUTH` array + category loop | Typed, tested, single source of truth |
| System prompt assembly | Inline string building | `buildSystemPrompt()` | Handles constitutional preamble, language directive, declined topics |

**Key insight:** This phase has no novel algorithmic problem. Every needed function exists. The risk is in wiring, not invention.

## Common Pitfalls

### Pitfall 1: JOURNAL stores entry before retrieval runs

**What goes wrong:** `storePensieveEntry()` runs first in `handleJournal()`. If `hybridSearch()` runs after storage, the new entry could theoretically surface in its own retrieval results (because `embedAndStore()` is fire-and-forget and usually hasn't finished yet, but the timing is not guaranteed).

**Why it happens:** The storage sequence was established before retrieval was added to JOURNAL.

**How to avoid:** Run `hybridSearch()` before or simultaneously with `storePensieveEntry()` is fine since `embedAndStore()` is fire-and-forget — the new entry won't be embedded yet when `hybridSearch()` runs. No reordering needed; just add the `hybridSearch()` call after storage but before the Sonnet call (consistent with current code layout).

**Warning signs:** Retrieved context contains the message Greg just sent. [ASSUMED]

### Pitfall 2: buildSystemPrompt() passes undefined for pensieveContext to JOURNAL

**What goes wrong:** The current JOURNAL case in `buildSystemPrompt()` is `modeBody = JOURNAL_SYSTEM_PROMPT` with no `.replace()` call. After adding `{pensieveContext}` to the prompt template, if the replace is forgotten, the literal string `{pensieveContext}` appears in the system prompt.

**Why it happens:** The switch case for JOURNAL is simpler than other modes — easy to forget adding the `.replace()`.

**How to avoid:** After adding `{pensieveContext}` to `JOURNAL_SYSTEM_PROMPT`, add the corresponding `.replace('{pensieveContext}', contextValue)` in the JOURNAL case of `buildSystemPrompt()`. The `contextValue` variable is already defined at the top of the function.

**Warning signs:** System prompt contains the literal text `{pensieveContext}`. [VERIFIED: src/chris/personality.ts line 52 — `contextValue` already computed, just not used for JOURNAL]

### Pitfall 3: Known Facts block ordering inconsistency

**What goes wrong:** The Known Facts block appears after language/declined-topics directives instead of before them.

**Why it happens:** The prompt is assembled by appending sections. If Known Facts is added at the end, it appears after the mandatory directives.

**How to avoid:** Insert Known Facts block immediately after `modeBody` construction (`let prompt = CONSTITUTIONAL_PREAMBLE + modeBody + knownFactsBlock`) and before the `if (language)` block. [VERIFIED: src/chris/personality.ts — injection point is clearly after switch and before language/declined-topics guards]

### Pitfall 4: INTERROGATE mode double-injection

**What goes wrong:** INTERROGATE already has hallucination resistance instructions ("If the Memory Entries section is empty... say honestly: 'I don't have any memories about that.'"). Adding the same instruction again creates redundancy and potentially contradictory wording.

**Why it happens:** D-09 asks to "verify and align" INTERROGATE's language — easy to over-apply and add a second block.

**How to avoid:** Read `INTERROGATE_SYSTEM_PROMPT` carefully before editing. The instruction is already present at line 44 of `src/llm/prompts.ts`. D-09 requires only aligning the wording of any new JOURNAL instruction to match — not adding a duplicate to INTERROGATE.

**Warning signs:** INTERROGATE_SYSTEM_PROMPT contains "I don't have any memories" twice. [VERIFIED: prompts.ts reviewed — one occurrence currently]

### Pitfall 5: buildSystemPrompt() test regressions from Known Facts injection

**What goes wrong:** `src/chris/__tests__/personality.test.ts` tests that `buildSystemPrompt('INTERROGATE', 'test context')` still contains "Memory Entries". If Known Facts injection is placed before the `{pensieveContext}` replace, and the ordering interacts with the INTERROGATE case, existing tests may fail.

**Why it happens:** The personality test suite is comprehensive and checks mode content preservation.

**How to avoid:** Known Facts injection must be additive (append a new block), not modify the existing `{pensieveContext}` replacement logic. Run `npm run test:unit` after changes to `personality.ts` before moving on.

## Code Examples

### Verified Pattern: hybridSearch() in a mode handler

```typescript
// Source: src/chris/modes/interrogate.ts + src/pensieve/retrieve.ts (verified)
// JOURNAL equivalent — replace searchPensieve with hybridSearch + JOURNAL_SEARCH_OPTIONS
import { hybridSearch, JOURNAL_SEARCH_OPTIONS } from '../../pensieve/retrieve.js';
import { buildPensieveContext, buildMessageHistory } from '../../memory/context-builder.js';

// Inside handleJournal(), after storePensieveEntry and fire-and-forget, before Sonnet:
const searchResults = await hybridSearch(text, JOURNAL_SEARCH_OPTIONS);
const pensieveContext = buildPensieveContext(searchResults);
// ...
const systemPrompt = buildSystemPrompt('JOURNAL', pensieveContext, undefined, language, declinedTopics);
```

### Verified Pattern: SearchOptions preset structure

```typescript
// Source: src/pensieve/retrieve.ts lines 196-228 (verified)
export const JOURNAL_SEARCH_OPTIONS: SearchOptions = {
  tags: ['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE'],
  recencyBias: 0.3,
  limit: 10,
  // No minScore — D-02 explicitly omits threshold
};
```

### Verified Pattern: GROUND_TRUTH iteration for Known Facts block

```typescript
// Source: src/pensieve/ground-truth.ts (verified — GROUND_TRUTH, FactCategory types)
import { GROUND_TRUTH, type FactCategory } from '../pensieve/ground-truth.js';

function buildKnownFactsBlock(): string {
  const categoryOrder: FactCategory[] = ['identity', 'location_history', 'property', 'business', 'financial'];
  const lines = ['## Known Facts About Greg'];
  for (const cat of categoryOrder) {
    const entries = GROUND_TRUTH.filter((e) => e.category === cat);
    for (const e of entries) {
      lines.push(`- ${e.key}: ${e.value}`);
    }
  }
  return lines.join('\n');
}
```

### Verified Pattern: buildSystemPrompt() injection point

```typescript
// Source: src/chris/personality.ts lines 84-98 (verified)
// Current assembly:
let prompt = CONSTITUTIONAL_PREAMBLE + modeBody;

// After this phase, for JOURNAL and INTERROGATE:
// let prompt = CONSTITUTIONAL_PREAMBLE + modeBody + '\n\n' + buildKnownFactsBlock();

// Then existing guards follow (no change needed):
if (language) { /* Language Directive */ }
if (declinedTopics && declinedTopics.length > 0) { /* Declined Topics */ }
```

### Verified Pattern: INTERROGATE hallucination resistance wording (to align JOURNAL)

```
// Source: src/llm/prompts.ts line 44 (verified)
// Current INTERROGATE wording:
"If the Memory Entries section is empty or says 'No relevant memories found', say honestly:
 'I don't have any memories about that.' Do NOT guess or fabricate."

// JOURNAL must use equivalent language — exact wording is Claude's discretion per CONTEXT.md
```

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npm run test:unit -- --reporter=verbose src/chris/__tests__/journal.test.ts src/chris/__tests__/personality.test.ts src/pensieve/__tests__/retrieve.test.ts` |
| Full suite command | `npm run test:unit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RETR-01 | `handleJournal()` calls `hybridSearch()` with JOURNAL preset before Sonnet | unit | `npm run test:unit -- src/chris/__tests__/journal.test.ts` | ❌ Wave 0 |
| RETR-01 | `JOURNAL_SEARCH_OPTIONS` has correct tags/recencyBias/limit | unit | `npm run test:unit -- src/pensieve/__tests__/retrieve.test.ts` | ❌ Wave 0 (new preset test) |
| RETR-02 | `buildSystemPrompt('JOURNAL', ...)` includes Known Facts block | unit | `npm run test:unit -- src/chris/__tests__/personality.test.ts` | ❌ Wave 0 (new test case) |
| RETR-02 | `buildSystemPrompt('INTERROGATE', ...)` includes Known Facts block | unit | `npm run test:unit -- src/chris/__tests__/personality.test.ts` | ❌ Wave 0 (new test case) |
| RETR-04 | `JOURNAL_SYSTEM_PROMPT` contains hallucination resistance instruction | unit | `npm run test:unit -- src/chris/__tests__/journal.test.ts` | ❌ Wave 0 |
| RETR-04 | `buildSystemPrompt('JOURNAL', '')` passes empty context → prompt contains "No relevant memories" | unit | `npm run test:unit -- src/chris/__tests__/personality.test.ts` | ❌ Wave 0 (new test case) |

### Sampling Rate

- **Per task commit:** `npm run test:unit -- src/chris/__tests__/journal.test.ts src/chris/__tests__/personality.test.ts src/pensieve/__tests__/retrieve.test.ts`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/chris/__tests__/journal.test.ts` — covers RETR-01, RETR-04 (new file, mirrors interrogate.test.ts structure)
- [ ] New test cases in `src/chris/__tests__/personality.test.ts` — Known Facts block injection for JOURNAL and INTERROGATE (RETR-02)
- [ ] New test case in `src/pensieve/__tests__/retrieve.test.ts` — `JOURNAL_SEARCH_OPTIONS` preset shape (RETR-01)

**Existing tests that must stay green (regression check):**

- `src/chris/__tests__/personality.test.ts` — all existing cases (constitutional preamble, declined topics, language directive, mode content preservation)
- `src/chris/__tests__/interrogate.test.ts` — all existing cases
- `src/pensieve/__tests__/retrieve.test.ts` — all existing preset cases

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JOURNAL had no retrieval | JOURNAL uses `hybridSearch()` with fact-type tags | Phase 8 | Ends fact confabulation |
| System prompt had no structured facts | Known Facts block from `GROUND_TRUTH` | Phase 8 | LLM sees authoritative key-value reference separate from narrative context |
| Hallucination resistance was INTERROGATE-only | JOURNAL also instructs explicit uncertainty | Phase 8 | Greg can trust factual answers in journal conversations |

**Deprecated/outdated after this phase:**
- `JOURNAL_SYSTEM_PROMPT` without `{pensieveContext}`: replaced by version with placeholder
- `buildSystemPrompt('JOURNAL', undefined, ...)`: calling with undefined pensieveContext for JOURNAL is semantically wrong post-phase (still functionally safe — `contextValue` falls back to "No relevant memories found.")

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | New entry's embedding won't be available when `hybridSearch()` runs (fire-and-forget embedAndStore timing) | Common Pitfalls §1 | Low risk: retrieval before embedding means new entry absent from results — no self-referential loop, desirable behavior |

**All other claims in this research were verified by reading actual source files.** The single assumed claim (A1) has acceptable risk regardless of which direction it resolves.

## Open Questions

1. **Whether Known Facts block should be injected into REFLECT/COACH/PSYCHOLOGY/PRODUCE**
   - What we know: CONTEXT.md marks this as Claude's discretion; those modes already have `{pensieveContext}` retrieval but no static facts block
   - What's unclear: User didn't lock a direction; it's a judgment call for implementation
   - Recommendation: Inject into JOURNAL and INTERROGATE only for this phase (minimum footprint). Other modes can be expanded in a follow-up if testing reveals confabulation there too.

2. **Exact wording of JOURNAL hallucination resistance instruction**
   - What we know: Must align with INTERROGATE's existing "I don't have any memories about that" language; exact phrasing is discretionary
   - What's unclear: Should JOURNAL use identical wording or a friendlier journaling-mode variant?
   - Recommendation: Use identical wording to INTERROGATE for consistency; adjust if it sounds unnatural in journal context during testing.

## Environment Availability

Step 2.6: SKIPPED — this phase is code/config-only changes with no external dependencies. All runtime dependencies (PostgreSQL, Anthropic API) are pre-existing and validated by prior phases.

## Security Domain

> No new attack surface is introduced. Known Facts block is read from a static compile-time constant (`GROUND_TRUTH`), not user input. No new API calls, no new storage paths, no new parsing.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | no | Known Facts is static; no user input reaches fact injection |
| V6 Cryptography | no | — |

### Known Threat Patterns

None new. The phase is additive prompt engineering over existing verified infrastructure.

## Sources

### Primary (HIGH confidence)

All findings are VERIFIED by direct source file reads during this research session:

- `src/chris/modes/journal.ts` — current JOURNAL handler, no retrieval
- `src/chris/modes/interrogate.ts` — retrieval pattern template
- `src/pensieve/retrieve.ts` — `hybridSearch()`, `SearchOptions`, all mode presets
- `src/pensieve/ground-truth.ts` — `GROUND_TRUTH` array (13 entries), `GROUND_TRUTH_MAP`
- `src/chris/personality.ts` — `buildSystemPrompt()` full implementation
- `src/llm/prompts.ts` — all mode prompt templates including current `JOURNAL_SYSTEM_PROMPT` and `INTERROGATE_SYSTEM_PROMPT`
- `src/memory/context-builder.ts` — `buildPensieveContext()` implementation and `SIMILARITY_THRESHOLD`
- `src/chris/__tests__/personality.test.ts` — existing test coverage (regression boundary)
- `src/chris/__tests__/interrogate.test.ts` — unit test pattern for mode handlers
- `src/pensieve/__tests__/retrieve.test.ts` — preset test pattern
- `.planning/phases/08-retrieval-grounding/08-CONTEXT.md` — all locked decisions

### Secondary (MEDIUM confidence)

- None required — all relevant facts sourced from codebase directly.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all assets verified by direct file read
- Architecture: HIGH — implementation pattern is a direct copy of interrogate.ts with one substitution
- Pitfalls: HIGH (verified) / LOW (A1 timing assumption — acceptable risk)
- Test patterns: HIGH — mirrors existing test file structure

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable codebase, no fast-moving dependencies)
