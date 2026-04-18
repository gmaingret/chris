# Phase 15: Deadline Trigger & Sweep Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 15-deadline-trigger-sweep-integration
**Areas discussed:** Trigger implementation, Channel separation, Stale-context prompts, Prompt generation

---

## Trigger Implementation

| Option | Description | Selected |
|--------|-------------|----------|
| Oldest-due first | Query decisions WHERE status='open' AND resolve_by <= now(), ORDER BY resolve_by ASC, LIMIT 1. Transitions exactly one to 'due' per sweep tick. | ✓ |
| All due at once | Transition ALL decisions past resolve_by to 'due' in one sweep. Risk: multiple prompts in one day. | |
| You decide | Claude picks. | |

**User's choice:** Oldest-due first
**Notes:** Matches success criterion 1 ("exactly one oldest-due decision").

| Option | Description | Selected |
|--------|-------------|----------|
| SQL Phase 1, parallel | Add decision-deadline alongside silence+commitment in existing Promise.all. Priority=2. | ✓ |
| Separate phase between SQL and Opus | Run after SQL triggers but before Opus. More complex sweep flow. | |
| You decide | Claude picks. | |

**User's choice:** SQL Phase 1, parallel
**Notes:** SQL-first, cheap, natural priority slot.

---

## Channel Separation

| Option | Description | Selected |
|--------|-------------|----------|
| Two keys in proactive_state | Split into last_sent_reflective and last_sent_accountability. Same KV pattern. | ✓ |
| Separate state table | New channel_state table. More normalized but heavier. | |
| You decide | Claude picks. | |

**User's choice:** Two keys in proactive_state
**Notes:** Minimal change to state.ts.

| Option | Description | Selected |
|--------|-------------|----------|
| Accountability first, then reflective | Fire accountability first (hard 24h window), reflective fires independently. Both can land same day. | ✓ |
| Accountability first, reflective waits 6h | Wait 6h for reply before releasing reflective. Risks missing active hours. | |
| You decide | Claude picks. | |

**User's choice:** Accountability first, then reflective — no waiting
**Notes:** Independent caps mean both can fire same day without blocking.

| Option | Description | Selected |
|--------|-------------|----------|
| Global mute suppresses both | Per success criterion 4. No separate /mute decisions in Phase 15. | ✓ |
| Global + per-channel mute now | Ship /mute decisions alongside global. More surface area. | |
| You decide | Claude picks. | |

**User's choice:** Global mute suppresses both
**Notes:** Per-channel mute deferred to Phase 17.

---

## Stale-context Prompts

| Option | Description | Selected |
|--------|-------------|----------|
| Template with absolute date | Inject resolve_by date into trigger context. LLM naturally frames as dated. | ✓ |
| Two distinct prompt templates | Separate templates for fresh (<48h) and stale (>48h). | |
| You decide | Claude picks. | |

**User's choice:** Template with absolute date
**Notes:** Uses existing {triggerContext} pattern.

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded 48h | SWEEP-04 specifies 48h. Constant in trigger file. | ✓ |
| Config-driven | Add config value. More flexible but unnecessary complexity. | |
| You decide | Claude picks. | |

**User's choice:** Hardcoded 48h
**Notes:** One-line change if ever needed.

---

## Prompt Generation

| Option | Description | Selected |
|--------|-------------|----------|
| Sonnet | Same tier as reflective. Prompt is a nudge, not deep analysis. | ✓ |
| Haiku | Cheaper but may produce less natural text. | |
| You decide | Claude picks. | |

**User's choice:** Sonnet
**Notes:** Phase 16 ACCOUNTABILITY mode can use different tier for resolution conversation.

| Option | Description | Selected |
|--------|-------------|----------|
| Last user language | Match Greg's current language. Consistent with PROACTIVE_SYSTEM_PROMPT. | ✓ |
| language_at_capture | Use capture-time language. | |
| You decide | Claude picks. | |

**User's choice:** Last user language
**Notes:** Decision details (prediction, criterion) stay in original language regardless.

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct ACCOUNTABILITY_SYSTEM_PROMPT | Decision-specific tone: cite prediction+criterion, no flattery/condemnation, ask "what happened?" | ✓ |
| Shared prompt, different context | Reuse PROACTIVE_SYSTEM_PROMPT with decision details in {triggerContext}. | |
| You decide | Claude picks. | |

**User's choice:** Distinct prompt
**Notes:** "Casual friend texting" frame is wrong for accountability.

---

## Claude's Discretion

- Sweep code organization (refactor into channel sub-functions vs branching)
- Exact ACCOUNTABILITY_SYSTEM_PROMPT wording
- last_sent key migration strategy (DB migration vs code fallback)
- Index on decisions(status, resolve_by)

## Deferred Ideas

- /mute decisions per-channel mute — Phase 17
- Configurable stale-context threshold — hardcoded 48h is sufficient
- Accountability daily cap > 1 — premature before real usage data
