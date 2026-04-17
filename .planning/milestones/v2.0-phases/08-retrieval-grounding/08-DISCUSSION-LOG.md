# Phase 8: Retrieval & Grounding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 08-retrieval-grounding
**Areas discussed:** JOURNAL retrieval strategy, Structured facts format, Hallucination resistance, Retrieval trigger
**Mode:** --auto (all choices auto-selected)

---

## JOURNAL Retrieval Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| hybridSearch with FACT/RELATIONSHIP/PREFERENCE/VALUE tags | Use existing hybridSearch() with tag filtering matching RETR-01, moderate recency bias | ✓ |
| searchPensieve (unfiltered) | Simple cosine search without tag filtering — broader but noisier | |
| New retrieval function | Build JOURNAL-specific retrieval — more control but more code | |

**User's choice:** [auto] hybridSearch with FACT/RELATIONSHIP/PREFERENCE/VALUE tags (recommended default)
**Notes:** Follows the established pattern from other modes. Tag filtering ensures JOURNAL gets grounding facts, not just similar narrative content.

---

## Structured Facts Format

| Option | Description | Selected |
|--------|-------------|----------|
| Static GROUND_TRUTH block always injected | Render all 13 ground-truth entries as key-value pairs in system prompt, always present | ✓ |
| Dynamic retrieval of facts | Query Pensieve for FACT-tagged entries matching the message | |
| Hybrid (static + dynamic) | Static ground truth plus dynamically retrieved facts | |

**User's choice:** [auto] Static GROUND_TRUTH block always injected (recommended default)
**Notes:** D031 explicitly calls for structured key-value facts separate from narrative. 13 entries is small enough to always include without context waste.

---

## Hallucination Resistance

| Option | Description | Selected |
|--------|-------------|----------|
| Prompt instruction + retrieval context signal | Add explicit instruction to JOURNAL prompt: if facts not in Known Facts or retrieved context, say so | ✓ |
| Code-level empty-result detection | Detect when retrieval returns no results and inject special "no data" prompt | |
| Haiku post-processor fact-check | Run Haiku after Sonnet to verify claims against Pensieve | |

**User's choice:** [auto] Prompt instruction + retrieval context signal (recommended default)
**Notes:** Simplest effective approach. The prompt instruction combined with structured facts gives Sonnet clear boundaries on what it knows vs doesn't know. Code-level detection adds complexity; Haiku post-processing adds latency and cost.

---

## Retrieval Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Every message | Run retrieval on every JOURNAL message, consistent with all other modes | ✓ |
| Selective (classify first) | Use Haiku to classify whether message needs retrieval, skip for pure venting | |
| Keyword-triggered | Only retrieve when message contains fact-like keywords | |

**User's choice:** [auto] Every message (recommended default)
**Notes:** Retrieval is fast (one embedding + one DB query). All other modes already retrieve on every message. Adding classification logic would be fragile and add latency that exceeds the retrieval cost itself.

---

## Claude's Discretion

- Exact hallucination resistance prompt wording
- Whether to extend Known Facts injection to other modes beyond JOURNAL/INTERROGATE
- Fine-tuning of JOURNAL search preset parameters

## Deferred Ideas

None — discussion stayed within phase scope
