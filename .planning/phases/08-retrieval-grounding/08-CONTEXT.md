# Phase 8: Retrieval & Grounding - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Upgrade JOURNAL mode to use hybrid retrieval (FACT/RELATIONSHIP/PREFERENCE/VALUE tags) before each Sonnet call, inject a static "Known Facts About Greg" block from the ground-truth module into the system prompt, and add prompt-level hallucination resistance so Chris declines to answer factual questions when no supporting entries exist in the Pensieve. No praise quarantine (Phase 9), no live integration test suite (Phase 10).

</domain>

<decisions>
## Implementation Decisions

### JOURNAL Retrieval Strategy
- **D-01:** JOURNAL mode calls `hybridSearch()` before each Sonnet call, using tags `['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE']` — matching RETR-01's requirements exactly.
- **D-02:** Search preset uses moderate recency bias (0.3), limit 10, no minimum score threshold. Recent facts matter but old stable facts should still surface.
- **D-03:** Retrieved context is formatted via `buildPensieveContext()` (existing utility) and passed to `buildSystemPrompt('JOURNAL', pensieveContext, ...)` — the same pattern used by INTERROGATE, REFLECT, COACH, PSYCHOLOGY, and PRODUCE modes.

### Structured Facts Format
- **D-04:** The `GROUND_TRUTH` array from `src/pensieve/ground-truth.ts` is rendered as a "Known Facts About Greg" key-value block and injected into the system prompt for JOURNAL and INTERROGATE modes. This is a static block — always present, not dynamically retrieved.
- **D-05:** The block is injected by `buildSystemPrompt()` as a separate section after the mode body and before language/declined-topics directives. Format: `## Known Facts About Greg\n- key: value` for each ground-truth entry, grouped by category.
- **D-06:** Per D031, this block is separate from the narrative retrieval context (`{pensieveContext}`). The LLM sees two distinct sections: structured facts (stable, authoritative) and retrieved memories (contextual, scored).

### Hallucination Resistance
- **D-07:** JOURNAL mode system prompt gets an explicit instruction: when asked about factual details not present in the Known Facts block or retrieved Pensieve context, Chris must say it doesn't have that information rather than inventing an answer.
- **D-08:** This is a prompt-level instruction, not code logic. The presence/absence of retrieval results serves as the implicit signal — if no relevant facts are retrieved and the Known Facts block doesn't cover it, the prompt instructs Chris to be honest about the gap.
- **D-09:** INTERROGATE mode already has grounding instructions — verify they're sufficient and align them with the same "I don't have that information" language for consistency.

### Retrieval Trigger
- **D-10:** Retrieval runs on every JOURNAL message — no selective triggering. This is consistent with all other modes and avoids the complexity/fragility of classifying which messages "need" retrieval.

### Claude's Discretion
- Exact wording of the hallucination resistance prompt instruction
- Whether to also inject Known Facts into REFLECT/COACH/PSYCHOLOGY/PRODUCE modes (they already have retrieval, but not the static facts block)
- JOURNAL search preset fine-tuning (exact recency bias value, limit count) based on what works during testing
- Whether `buildPensieveContext()` needs any modification for JOURNAL-specific formatting

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Spec
- `M006_Trustworthy_Chris.md` — Full M006 spec with structured fact injection details and acceptance criteria
- `.planning/REQUIREMENTS.md` §RETR-01 — JOURNAL hybrid retrieval requirement
- `.planning/REQUIREMENTS.md` §RETR-02 — Structured fact injection requirement
- `.planning/REQUIREMENTS.md` §RETR-04 — Hallucination resistance requirement

### Key Decisions
- `PLAN.md` §Key Decisions D007 — Hybrid retrieval across modes
- `PLAN.md` §Key Decisions D031 — Memory retrieval injects structured facts, not prose dump

### Code (modify these)
- `src/chris/modes/journal.ts` — Add `hybridSearch()` call before Sonnet, pass `pensieveContext` to `buildSystemPrompt()`
- `src/chris/personality.ts` — Extend `buildSystemPrompt()` to inject Known Facts block
- `src/llm/prompts.ts` — Update `JOURNAL_SYSTEM_PROMPT` with hallucination resistance instruction and `{pensieveContext}` placeholder

### Code (reference patterns)
- `src/chris/modes/interrogate.ts` — Existing retrieval pattern: `searchPensieve()` → `buildPensieveContext()` → `buildSystemPrompt()`
- `src/pensieve/retrieve.ts` — `hybridSearch()` with `SearchOptions` type, existing mode-specific presets
- `src/pensieve/ground-truth.ts` — `GROUND_TRUTH` array and `GROUND_TRUTH_MAP` for structured facts
- `src/memory/context-builder.ts` — `buildPensieveContext()` for formatting search results as citations

### Prior Phase Context
- `.planning/phases/06-memory-audit/06-CONTEXT.md` — Ground-truth module design decisions
- `.planning/phases/07-foundational-behavioral-fixes/07-CONTEXT.md` — `buildSystemPrompt()` signature and constitutional preamble decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hybridSearch()` in `src/pensieve/retrieve.ts` — Tag-filtered semantic search with recency bias, ready for JOURNAL preset
- `buildPensieveContext()` in `src/memory/context-builder.ts` — Formats search results as numbered citation blocks
- `GROUND_TRUTH` array in `src/pensieve/ground-truth.ts` — 13 typed entries with categories, ready for injection
- `GROUND_TRUTH_MAP` in `src/pensieve/ground-truth.ts` — Flat key-value map for quick lookups
- `buildSystemPrompt()` in `src/chris/personality.ts` — Already accepts `pensieveContext` parameter, JOURNAL just passes `undefined`
- Mode-specific search presets (REFLECT, COACH, PSYCHOLOGY, PRODUCE, CONTRADICTION) — Pattern for defining JOURNAL preset

### Established Patterns
- Every non-JOURNAL mode already does retrieval before Sonnet calls — JOURNAL is the outlier being fixed
- `buildSystemPrompt(mode, pensieveContext, relationalContext, language, declinedTopics)` — Signature already supports pensieveContext
- Search results formatted as `[N] (date | TAG | score) "content"` — consistent citation format across modes
- Fire-and-forget for side effects but retrieval is synchronous (must complete before Sonnet call)

### Integration Points
- `handleJournal()` needs `hybridSearch()` import and call before Sonnet
- `buildSystemPrompt()` needs Known Facts injection logic (reads `GROUND_TRUTH`)
- `JOURNAL_SYSTEM_PROMPT` in `src/llm/prompts.ts` needs `{pensieveContext}` placeholder and hallucination resistance instruction
- New `JOURNAL_SEARCH_OPTIONS` preset in `src/pensieve/retrieve.ts`

</code_context>

<specifics>
## Specific Ideas

- D031 from PROJECT.md is the key driver: "Real Telegram testing showed Chris confabulating facts (Cagnes-sur-Mer vs Golfe-Juan, wrong move direction) because memory was dumped as prose text into the context window." The fix is a structured "Known Facts About Greg" block.
- The GROUND_TRUTH module already has 13 entries from Phase 6 — these become the Known Facts block content.
- INTERROGATE mode's pattern (search → format → inject into system prompt) is the exact template to follow for JOURNAL.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-retrieval-grounding*
*Context gathered: 2026-04-13*
