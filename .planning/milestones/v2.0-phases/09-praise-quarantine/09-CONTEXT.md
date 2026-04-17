# Phase 9: Praise Quarantine - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a deterministic Haiku post-processor that rewrites reflexive flattery out of JOURNAL, REFLECT, and PRODUCE mode responses before they reach the user. COACH and PSYCHOLOGY modes bypass the post-processor entirely (they already forbid flattery at the prompt level). No new prompt rules — this is engine post-processing per D025.

</domain>

<decisions>
## Implementation Decisions

### Detection vs Rewriting
- **D-01:** Haiku receives the response and rewrites it if it detects reflexive flattery in the opening. This is detect-and-rewrite, not detect-and-strip — removing sentences can leave choppy responses. Haiku rephrases the opening to remove flattery while preserving meaning and tone.
- **D-02:** The post-processor returns the rewritten response (or the original if no flattery detected). This is a single Haiku call per applicable response.

### Flattery Patterns Targeted
- **D-03:** Target reflexive opening praise only — phrases like "Great question!", "That's a really insightful observation", "What a thoughtful point", "I love that you're thinking about this", "That's so important that you're exploring this."
- **D-04:** Mid-response genuine engagement is NOT flattery. Phrases like "that's worth exploring further" or "interesting angle" used substantively in context are fine. The quarantine targets vacuous openers, not all positive language.

### Pipeline Placement
- **D-05:** Post-processor runs after the mode handler returns and before contradiction detection. Pipeline order: mode handler → praise quarantine (JOURNAL/REFLECT/PRODUCE only) → contradiction detection → save response → relational memory.
- **D-06:** COACH and PSYCHOLOGY modes skip the praise quarantine step entirely — checked by mode before calling Haiku.

### Failure Behavior
- **D-07:** If Haiku post-processing fails (API timeout, error, malformed response), pass through the original response unchanged. Log the error. A response with mild flattery is better than no response or a broken one.
- **D-08:** Use a timeout consistent with the existing pattern (contradiction detection uses 3s). The praise quarantine Haiku call should have a similar timeout guard.

### Claude's Discretion
- Exact Haiku prompt text for the rewrite instruction
- Whether to add a confidence/change indicator in logs (e.g., "rewrite applied" vs "no change needed")
- Exact timeout value (2-4s range)
- Whether the Haiku prompt should receive the user's original message for context or just the response text

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Spec
- `M006_Trustworthy_Chris.md` — Full M006 spec describing praise quarantine as "lightweight Haiku post-processing pass"
- `.planning/REQUIREMENTS.md` §SYCO-04 — Praise quarantine post-processor strips reflexive flattery from JOURNAL/REFLECT/PRODUCE
- `.planning/REQUIREMENTS.md` §SYCO-05 — COACH and PSYCHOLOGY bypass praise quarantine

### Key Decisions
- `PLAN.md` §Key Decisions D025 — Praise quarantine runs as engine post-processing, not a prompt rule
- `PLAN.md` §Key Decisions D005 — Fire-and-forget for side effects, never block response
- `PLAN.md` §Key Decisions D022 — Constitutional preamble is a floor, not a ceiling

### Code (modify these)
- `src/chris/engine.ts` — `processMessage()` pipeline: add praise quarantine step after mode handler, before contradiction detection
- `src/llm/client.ts` — HAIKU_MODEL constant already exists for Haiku calls

### Code (reference patterns)
- `src/chris/engine.ts` lines 207-228 — Contradiction detection post-processing pattern (timeout, try/catch, fire-and-forget)
- `src/chris/personality.ts` — Constitutional preamble (Phase 7) shows the anti-sycophancy foundation this builds on
- `src/chris/refusal.ts` — Pattern for a self-contained detection module with clear interface

### Prior Phase Context
- `.planning/phases/07-foundational-behavioral-fixes/07-CONTEXT.md` — Constitutional preamble and anti-sycophancy decisions
- `.planning/phases/08-retrieval-grounding/08-CONTEXT.md` — Retrieval integration decisions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `HAIKU_MODEL` in `src/llm/client.ts` — Haiku model constant already configured
- `anthropic` client in `src/llm/client.ts` — Anthropic API client ready for Haiku calls
- Contradiction detection in `engine.ts` lines 207-228 — Exact pattern to follow (timeout race, try/catch, log-and-swallow)

### Established Patterns
- Engine post-processing: contradiction detection already runs after mode handler with timeout guard — praise quarantine follows same pattern
- Fire-and-forget error handling: side effects log errors and swallow, never block response
- Mode-conditional logic: `if (mode === 'JOURNAL' || mode === 'PRODUCE')` pattern already used for contradiction detection — extend to include REFLECT for praise quarantine

### Integration Points
- `processMessage()` in `engine.ts` — new praise quarantine step slots between mode handler return and contradiction detection block
- New module `src/chris/praise-quarantine.ts` — self-contained module following refusal.ts pattern
- COACH/PSYCHOLOGY bypass: mode check before calling the quarantine function

</code_context>

<specifics>
## Specific Ideas

- D025 explicitly chose post-processing over prompt rules because "prompt rules against flattery drift over long sessions and across mode handlers. Post-processing audit is deterministic and catches reflexive praise regardless of which mode generated it."
- The constitutional preamble (Phase 7) already tells Chris to prioritize usefulness over pleasantness — the praise quarantine is the enforcement mechanism for when the LLM still produces flattery despite the preamble.
- COACH mode already says "Don't sugarcoat" and PSYCHOLOGY has an analytical style — neither mode produces reflexive flattery in practice, so bypassing them avoids unnecessary Haiku calls and latency.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-praise-quarantine*
*Context gathered: 2026-04-13*
