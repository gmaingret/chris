# Phase 7: Foundational Behavioral Fixes - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Add refusal handling, language detection via `franc`, constitutional anti-sycophancy preamble with The Hard Rule and three forbidden behaviors, and reduce question-pressure in JOURNAL mode — across all 6 Chris modes. No retrieval changes (Phase 8), no praise quarantine post-processor (Phase 9), no live test suite (Phase 10).

</domain>

<decisions>
## Implementation Decisions

### Constitutional Preamble
- **D-01:** Claude writes the final preamble text using the M006 spec as intent (not verbatim copy). The preamble must encode: (1) usefulness over pleasantness, (2) agreement as conclusion not default, (3) The Hard Rule (no appeals to track record), (4) three forbidden behaviors (never resolve contradictions alone, never extrapolate to novel situations, never optimize for emotional satisfaction).
- **D-02:** Preamble is layered additively — prepended via `buildSystemPrompt()` in `src/chris/personality.ts`. Existing mode-specific guidance (e.g., COACH's directness) stays exactly as-is. The preamble is a floor, not a replacement (confirms D022).

### Refusal Detection
- **D-03:** Refusals are lightweight session-scoped "not right now" deflections, not permanent topic bans. They reset naturally (on process restart or session boundary). Nothing eternal.
- **D-04:** Claude decides pipeline placement (before or after mode detection), persistence mechanism (in-memory vs DB), and exact regex patterns. The 15-20 patterns per language target from TRUST-01 stands but calibration is Claude's discretion.
- **D-05:** Pattern breadth is Claude's discretion — can include soft deflections ("let's move on") or stay strict ("I don't want to talk about X"). Err toward fewer false positives since the stakes are low.

### Question Pressure (JOURNAL mode)
- **D-06:** Questions become rare — roughly 1 in 5 JOURNAL responses should end with a question, down from the current "always ask enriching follow-ups" pattern.
- **D-07:** When Chris does ask, questions can be clarifying (to understand) or deepening (to help Greg think further). The interview-every-message pattern must stop.
- **D-08:** The JOURNAL_SYSTEM_PROMPT wording should shift from encouraging questions to permitting them occasionally. Exact phrasing is Claude's discretion.

### Language Detection
- **D-09:** `franc` runs as engine pre-processing. Short messages (<4 words or <15 chars) inherit the language of the previous user message; default to English if no prior context (confirms D021).
- **D-10:** Claude decides how detected language is injected into system prompts — system prompt injection, replacing per-mode rules, or hybrid approach. The goal is a hard override that the LLM cannot ignore.
- **D-11:** Mode detection (Haiku) stays English-only. No changes to MODE_DETECTION_PROMPT for language handling.

### Claude's Discretion
- Final preamble prose (using M006 spec as intent)
- Refusal detection pipeline placement and persistence mechanism
- Refusal pattern breadth and exact regex patterns per language
- Language injection method into system prompts
- Whether to remove existing per-prompt "ALWAYS respond in same language" lines or keep them as backup
- `buildSystemPrompt()` signature changes needed to accept language and declined-topics parameters

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Spec
- `M006_Trustworthy_Chris.md` — Full M006 spec with target features, acceptance criteria, and preamble draft text
- `.planning/REQUIREMENTS.md` §TRUST-01 through §TRUST-04 — Refusal handling requirements
- `.planning/REQUIREMENTS.md` §SYCO-01 through §SYCO-03 — Anti-sycophancy preamble requirements
- `.planning/REQUIREMENTS.md` §LANG-01 through §LANG-04 — Language detection and question-pressure requirements

### Key Decisions
- `PLAN.md` §Key Decisions D020 — Refusal detection is pattern-based (regex), not Haiku-classified
- `PLAN.md` §Key Decisions D021 — Language detection uses franc with minimum-length threshold
- `PLAN.md` §Key Decisions D022 — Constitutional preamble is a floor, not a ceiling (additive)
- `PLAN.md` §Key Decisions D027 — The Hard Rule: never tell Greg he is right because of who he is

### Code (modify these)
- `src/chris/personality.ts` — `buildSystemPrompt()` function to prepend preamble and inject language/declined-topics
- `src/llm/prompts.ts` — All 6 mode system prompts (JOURNAL, INTERROGATE, REFLECT, COACH, PSYCHOLOGY, PRODUCE)
- `src/chris/engine.ts` — `processMessage()` pipeline where refusal detection and language detection will be added

### Code (reference patterns)
- `src/proactive/mute.ts` — Pattern for pre-processing step in engine (mute detection runs before mode detection)
- `src/chris/modes/journal.ts` — Current JOURNAL handler showing where system prompt is passed to Sonnet
- `src/pensieve/ground-truth.ts` — Ground truth module from Phase 6 (for future test integration)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `detectMuteIntent()` in `src/proactive/mute.ts` — Pattern for engine pre-processing (regex-based detection → early return or state injection)
- `buildSystemPrompt()` in `src/chris/personality.ts` — Single point to prepend preamble and inject parameters
- `saveMessage()` in `src/memory/conversation.ts` — Conversation history persistence that could track language context
- Existing mode prompts all have "ALWAYS respond in same language" lines that could be replaced/augmented

### Established Patterns
- Engine pre-processing: mute detection already runs before mode detection — refusal/language detection follows same pattern
- Fire-and-forget for side effects but synchronous for pipeline decisions (refusal/language must be sync)
- System prompts use template replacement (`{pensieveContext}`, `{relationalContext}`) — language/topics could follow same pattern
- `buildSystemPrompt(mode, pensieveContext?, relationalContext?)` signature — needs extension for new parameters

### Integration Points
- `processMessage()` in engine.ts — new detection steps slot between mute check and mode detection
- `buildSystemPrompt()` — signature extends to accept language and declined topics
- `JOURNAL_SYSTEM_PROMPT` — question-pressure wording change
- All 6 mode prompts — preamble prepended via buildSystemPrompt

</code_context>

<specifics>
## Specific Ideas

- Refusals are casual and ephemeral — more like "ok, different topic" than a formal blocking mechanism. Greg emphasized "nothing eternal."
- Question reduction should feel natural, not robotic. Chris isn't forbidden from questions, just stops defaulting to them.
- The M006 spec gives specific preamble draft text that captures the right intent even if exact wording is refined.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-foundational-behavioral-fixes*
*Context gathered: 2026-04-13*
