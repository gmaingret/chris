---
phase: 11-identity-grounding
reviewed: 2026-04-18T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/chris/modes/journal.ts
  - src/chris/personality.ts
  - src/llm/prompts.ts
  - src/proactive/prompts.ts
  - src/memory/context-builder.ts
  - src/memory/__tests__/context-builder.test.ts
  - src/chris/__tests__/engine.test.ts
  - src/chris/__tests__/personality.test.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-04-18
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 11 (Identity Grounding — John to Greg unification) successfully renames the identity across all six user-facing system prompts (`JOURNAL`, `INTERROGATE`, `REFLECT`, `COACH`, `PSYCHOLOGY`, `PRODUCE`), the constitutional preamble, the Known Facts block ("Facts about you (Greg)"), the proactive prompts, and the context-builder's `includeDate` gating is implemented correctly with solid test coverage.

However, two non-conversational but model-visible classifier prompts in `src/llm/prompts.ts` — `CONTRADICTION_DETECTION_PROMPT` and `RELATIONAL_MEMORY_PROMPT` — still refer to the user as "John" in both structural instructions and worked examples. These prompts are fed user content at runtime (via `{newText}` and `{exchange}` placeholders), so the Haiku model sees a prompt that instructs it to analyze something "John" said about a message whose content refers to "Greg". This is an identity-consistency regression against the stated Phase 11 goal and — more importantly for `RELATIONAL_MEMORY_PROMPT` — risks the model storing observations that literally reference "John" (e.g., "John consistently deflects when asked about his father"), because the system prompt's example observations are all "John ..." style strings. Any such text would then be persisted into `relational_memory` and surface back in REFLECT/COACH/PSYCHOLOGY as Chris's own observations, quietly re-introducing the old placeholder name downstream.

The Phase 11 test at `personality.test.ts:186` explicitly asserts absence of `\bJohn\b` in `buildSystemPrompt(mode)` output for all seven user-facing modes — that test passes because neither `CONTRADICTION_DETECTION_PROMPT` nor `RELATIONAL_MEMORY_PROMPT` flows through `buildSystemPrompt`. The assertion is correct for what it covers, but the unification goal is not fully met.

Separately, Phase 12 notes (per the prompt) already caught `src/proactive/mute.ts` and `src/proactive/triggers/opus-analysis.ts` residuals. The two classifier prompts flagged here are not among Phase 12's known residuals list, so this finding is additive.

## Warnings

### WR-01: Residual "John" references in internal classifier prompts

**File:** `src/llm/prompts.ts:218, 228, 248, 261-292`
**Issue:** Two internal Haiku classifier prompts still refer to the user as "John":

1. **`CONTRADICTION_DETECTION_PROMPT`** (line 228, header comment line 218, body line 248):
   - `"You will be given something John just said..."` (line 228)
   - `"places where John's current statement directly conflicts..."` (line 228)
   - `"### What John just said: {newText}"` (line 248-249)
   - Doc comment at line 218: `"...decide whether to store an observation about John in relational memory."` (stale header comment — the comment is actually on `CONTRADICTION_DETECTION_PROMPT`, not `RELATIONAL_MEMORY_PROMPT`; the comment block at 217–220 refers to the wrong prompt).

2. **`RELATIONAL_MEMORY_PROMPT`** (lines 261, 264–276, 280, 282–283, 292) — 15+ occurrences including:
   - System framing: `"a journal exchange between John and Chris"` (line 261)
   - Positive examples: `"John consistently deflects when asked about his father"` (line 264), `"John has decided to leave his job..."` (line 265), etc.
   - Negative examples: `"John is feeling reflective today"` (line 271), `"John seems stressed about work"` (line 272), etc.
   - Observation-type scaffolding: `"A specific, concrete fact or detail about John's life"` (line 280), `"struggle John may not fully see"` (line 282), `"shift in John's thinking..."` (line 283)
   - Closing instruction: `"useful in understanding John weeks or months from now"` (line 292)

Why this matters for Phase 11's goal ("unify John/Greg references across all user-facing prompts to consistently say Greg"):

- `CONTRADICTION_DETECTION_PROMPT` is called from `src/chris/contradiction.ts:114` with `{newText}` substituted. The Haiku model sees a prompt instructing it to reason about "John" said X, while X itself is Greg's actual message. Identity confusion risk is low-probability but non-zero — the model could label entries inconsistently.
- `RELATIONAL_MEMORY_PROMPT` is called from `src/memory/relational.ts:59` and its Haiku response becomes the stored `content` field of `relational_memory` rows. The system prompt's positive examples are all phrased as `"John <verb>..."` — Haiku's imitation of the example template will literally write `"John consistently deflects..."` into persistent storage. Those rows are then surfaced back into REFLECT/COACH/PSYCHOLOGY prompts via `buildRelationalContext` (context-builder.ts:56), meaning "John" can quietly re-enter the user-facing conversational surface through stored observations even though the surface prompts are clean.

**Fix:**
```typescript
// src/llm/prompts.ts
// Lines 217-220 — fix the stale doc comment (currently describes RELATIONAL_MEMORY_PROMPT
// but sits above CONTRADICTION_DETECTION_PROMPT). Either move it next to RELATIONAL_MEMORY_PROMPT
// or rewrite to match the prompt it annotates.

export const CONTRADICTION_DETECTION_PROMPT = `You are a contradiction analyst. You will be given something Greg just said and a numbered list of past journal entries. Your job is to identify GENUINE contradictions — places where Greg's current statement directly conflicts with a previous stated belief, intention, or value.

## What IS a contradiction (flag these)
A direct conflict in stated belief, intention, or value where both cannot be simultaneously true:
- "I'll never go back to corporate work" → later: "I'm excited about this corporate offer" (direct reversal of stated intention)
// ...remaining examples unchanged (they use first-person "I'll..." which is already correct)...

## Input

### What Greg just said:
{newText}

// ...rest unchanged...`;

export const RELATIONAL_MEMORY_PROMPT = `You are an observation analyst. You will be given a journal exchange between Greg and Chris, plus recent conversation context. Your job is to decide whether this exchange reveals something genuinely NEW and SPECIFIC about Greg that is worth remembering long-term.

## What to look for
- Recurring behavioral patterns that span multiple exchanges (e.g., "Greg consistently deflects when asked about his father")
- Concrete life changes, transitions, or inflection points (e.g., "Greg has decided to leave his job after months of deliberation")
- Deep emotional revelations that go beyond surface-level sharing (e.g., "Greg admits he uses humor to avoid vulnerability")
- Contradictions between what Greg says and what he does (e.g., "Greg says he values health but has skipped exercise for 3 weeks straight")
- Evolving perspectives — when Greg's stance on something has clearly shifted over time

## What NOT to write — these are too generic, obvious, or ephemeral:
- "Greg is feeling reflective today" — this is a mood, not an insight
- "Greg seems stressed about work" — too surface-level, obvious from the conversation itself
- "Greg talked about his weekend" — a topic summary, not an observation
- "Greg is thinking about making changes" — too vague to be useful
- "Greg values his relationships" — generic platitude, not a specific insight
- "Greg had a good day" — ephemeral mood, not worth storing

// ...replace all remaining "John" with "Greg" through line 292...

Set a HIGH bar. Most exchanges should result in observe=false. Only write when you'd bet money that this observation will be useful in understanding Greg weeks or months from now.`;
```

Additionally, extend the Phase 11 identity test to cover these prompts directly (they don't flow through `buildSystemPrompt`, so the existing loop at `personality.test.ts:183-190` misses them):

```typescript
// src/chris/__tests__/personality.test.ts — add a new describe block
describe('Identity grounding in internal classifier prompts (Phase 11 extended)', () => {
  it('CONTRADICTION_DETECTION_PROMPT does not contain "John"', async () => {
    const { CONTRADICTION_DETECTION_PROMPT } = await import('../../llm/prompts.js');
    expect(CONTRADICTION_DETECTION_PROMPT).not.toMatch(/\bJohn\b/);
  });

  it('RELATIONAL_MEMORY_PROMPT does not contain "John"', async () => {
    const { RELATIONAL_MEMORY_PROMPT } = await import('../../llm/prompts.js');
    expect(RELATIONAL_MEMORY_PROMPT).not.toMatch(/\bJohn\b/);
  });
});
```

Severity rationale: classified as Warning (not Critical) because (a) these are Haiku classifier surfaces, not direct user-facing responses — the user does not read them, and (b) no user-visible crash or data-loss path. However, the `RELATIONAL_MEMORY_PROMPT` case does risk "John" being persisted into `relational_memory.content` via example-imitation, then surfaced back into user-visible REFLECT/COACH/PSYCHOLOGY turns — a quiet trust regression against the Phase 11 stated goal.

## Info

### IN-01: ACCOUNTABILITY mode omitted from Phase 11 identity test coverage

**File:** `src/chris/__tests__/personality.test.ts:5, 183`
**Issue:** The `ALL_MODES` arrays at line 5 (constitutional preamble test) and line 183 (identity grounding test) list seven modes: `JOURNAL`, `INTERROGATE`, `REFLECT`, `COACH`, `PSYCHOLOGY`, `PRODUCE`, `PHOTOS`. `ACCOUNTABILITY` (defined in `personality.ts:13` as part of the `ChrisMode` union) is not covered. This is scoped correctly for Phase 11 (ACCOUNTABILITY was added in v2.1 Phase 16, post-Phase 11), so this is not a regression against the Phase 11 deliverable — but the identity assertion now has partial coverage against the current `ChrisMode` union. Worth backfilling in the next touch of this test file.

**Fix:** Add `'ACCOUNTABILITY'` to the `ALL_MODES` tuple in both describe blocks. Note that ACCOUNTABILITY's call signature is parameter-overloaded (see `personality.ts:78-87`), so the test should call `buildSystemPrompt('ACCOUNTABILITY', 'decision-ctx', 'temporal-ctx')` and assert absence of `\bJohn\b` in the resulting prompt.

### IN-02: `includeDate: false` silently drops null-createdAt fact

**File:** `src/memory/context-builder.ts:100-106`
**Issue:** When `opts.includeDate === false` and `r.entry.createdAt` is null, the function correctly omits the date prefix (test coverage at `context-builder.test.ts:273` confirms "no `unknown-date` leakage"). This is the intended Phase 11 / RETR-04 behavior. Noted purely for awareness: in the `includeDate: true` path, null `createdAt` becomes the literal string `'unknown-date'` (line 105); in the `includeDate: false` path, it's simply not present. Both behaviors are correct for their contracts; asymmetry is intentional. No fix needed.

**Fix:** None required — documenting the intentional asymmetry.

### IN-03: Stale doc comment on CONTRADICTION_DETECTION_PROMPT

**File:** `src/llm/prompts.ts:216-220`
**Issue:** The JSDoc block immediately above `CONTRADICTION_DETECTION_PROMPT` (lines 216-220) describes the *relational memory observation prompt* (`"Relational memory observation prompt — used with Haiku to analyze journal exchanges and decide whether to store an observation about John in relational memory. Must set a HIGH bar..."`), but sits above the contradiction detection export. It appears to be an orphaned comment from a prior file layout where `RELATIONAL_MEMORY_PROMPT` came first. This is a code-quality issue independent of the John/Greg rename (the comment is on the wrong prompt regardless of naming).

**Fix:** Delete lines 216-220 (they duplicate the correct JSDoc block at lines 221-227 which describes `CONTRADICTION_DETECTION_PROMPT`), or move lines 216-220 above `RELATIONAL_MEMORY_PROMPT` at line 261. Combining with WR-01's "Greg" rename would also fix the residual "John" in this comment.

---

_Reviewed: 2026-04-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
