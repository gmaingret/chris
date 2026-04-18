# Phase 16: Resolution, Post-Mortem & ACCOUNTABILITY Mode - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 16-resolution-post-mortem-accountability-mode
**Areas discussed:** ACCOUNTABILITY mode shape, Resolution handler flow, Post-mortem follow-up, Auto-escalation & stale

---

## ACCOUNTABILITY mode shape

| Option | Description | Selected |
|--------|-------------|----------|
| New engine mode | Add ACCOUNTABILITY to ChrisMode union. Own system prompt, own handler. Praise quarantine bypasses it like COACH/PSYCHOLOGY. | ✓ |
| COACH extension | Reuse COACH handler with 'accountability' flag that swaps the system prompt. | |
| Not a detectMode() mode | Only entered via PP#0 — a handler, not a mode. | |

**User's choice:** New engine mode
**Notes:** Clean separation — resolution conversation has different needs than coaching.

| Option | Description | Selected |
|--------|-------------|----------|
| Sonnet | Factual comparison, not deep analysis. Keeps cost down. | ✓ |
| Opus | Post-mortem quality matters — deeper reasoning. | |

**User's choice:** Sonnet
**Notes:** Resolution is factual comparison (prediction vs outcome), not deep psychological analysis.

| Option | Description | Selected |
|--------|-------------|----------|
| Constitutional preamble + explicit | Same CONSTITUTIONAL_PREAMBLE as all modes, PLUS explicit Hard Rule reminder. | ✓ |
| Explicit only, no preamble | Self-contained prompt with own anti-sycophancy rules. | |

**User's choice:** Constitutional preamble + explicit
**Notes:** Belts and suspenders.

| Option | Description | Selected |
|--------|-------------|----------|
| Bypass quarantine | Add ACCOUNTABILITY to COACH/PSYCHOLOGY bypass check. Matches D025 pattern. | ✓ |
| Run quarantine | Belt and suspenders — run Haiku quarantine as safety net. | |

**User's choice:** Bypass quarantine
**Notes:** The post-processor could strip legitimate neutral language in accountability context.

| Option | Description | Selected |
|--------|-------------|----------|
| ±48h Pensieve only | Temporal query around resolve_by. Decision row provides core context. | ✓ |
| Hybrid search + ±48h | Also run hybridSearch on prediction text. Richer but noisier. | |

**User's choice:** ±48h Pensieve only
**Notes:** No hybrid search needed — decision row has prediction, criterion, reasoning.

| Option | Description | Selected |
|--------|-------------|----------|
| DECISION tag | Reuse Phase 13 tag. All decision lifecycle entries under one tag. | ✓ |
| New RESOLUTION tag | More granular but another enum migration. | |
| REFLECTION tag | Post-mortems are reflective but mixes with general reflections. | |

**User's choice:** DECISION tag
**Notes:** Keeps all decision-related entries under one tag for retrieval.

---

## Resolution handler flow

| Option | Description | Selected |
|--------|-------------|----------|
| Single-pass Sonnet | One Sonnet call with ACCOUNTABILITY prompt + decision context. | ✓ |
| Haiku extract + Sonnet respond | Two LLM calls — Haiku extracts, Sonnet responds. Cleaner data. | |
| You decide | Claude's discretion. | |

**User's choice:** Single-pass Sonnet
**Notes:** None.

| Option | Description | Selected |
|--------|-------------|----------|
| Greg's reply language | Use getLastUserLanguage()/franc. Prediction/criterion quoted verbatim in original language. | ✓ |
| language_at_capture | Force resolution into capture-time language. | |

**User's choice:** Greg's reply language
**Notes:** Matches existing engine behavior. Natural if Greg switched languages since capture.

| Option | Description | Selected |
|--------|-------------|----------|
| Two entries, fire-and-forget | Greg's reply + Chris's acknowledgment as separate Pensieve entries. | ✓ |
| Single merged entry | Combined entry. Simpler but loses distinction. | |

**User's choice:** Two entries, fire-and-forget
**Notes:** Both DECISION-tagged with source_ref_id=decision.id.

| Option | Description | Selected |
|--------|-------------|----------|
| Immediate same-turn | Acknowledgment + classify + post-mortem question in one response. | ✓ |
| Split across turns | Post-mortem on Greg's next message. Adds friction. | |
| Sweep-triggered | Post-mortem sent proactively. Adds latency. | |

**User's choice:** Immediate same-turn
**Notes:** Greg sees two-part reply. Minimizes friction.

---

## Post-mortem follow-up

| Option | Description | Selected |
|--------|-------------|----------|
| Class-specific questions | Different question per outcome class (hit/miss/ambiguous/unverifiable). | ✓ |
| Single universal question | Same question regardless: "Looking back, what do you take from this?" | |
| You decide | Claude's discretion on wording. | |

**User's choice:** Class-specific questions
**Notes:** Each targets a different epistemic failure mode.

| Option | Description | Selected |
|--------|-------------|----------|
| Reply + prediction + criterion | Haiku sees all three for classification. Comparison judgment. | ✓ |
| Reply only | Haiku classifies just what Greg said happened. | |

**User's choice:** Reply + prediction + criterion
**Notes:** Classification is a comparison judgment — needs both sides.

| Option | Description | Selected |
|--------|-------------|----------|
| Silent store + short ack | Store in resolution_notes, transition, clear state, one-line ack. | ✓ |
| Reflective response | Sonnet generates brief reflective response. Risks flattery/condemnation. | |
| No reply at all | Store silently. Might feel like talking into a void. | |

**User's choice:** Silent store + short ack
**Notes:** "Noted." / "Noté." / "Принято." — no further conversation.

| Option | Description | Selected |
|--------|-------------|----------|
| In system prompt context | Sonnet naturally weaves criterion into acknowledgment. | ✓ |
| Explicit quote to Greg | "Your test was: [criterion]. What actually happened?" | |

**User's choice:** In system prompt context
**Notes:** Not shown as separate UI element — just prompt context.

---

## Auto-escalation & stale

| Option | Description | Selected |
|--------|-------------|----------|
| Sweep tick checks timestamp | Record send time in proactive_state. Sweep checks 48h elapsed. | ✓ |
| Capture state timestamp | Store timestamp in decision_capture_state draft jsonb. | |
| You decide | Claude's discretion. | |

**User's choice:** Sweep tick checks timestamp
**Notes:** Reuses existing sweep cadence, no new cron.

| Option | Description | Selected |
|--------|-------------|----------|
| Prompt count in proactive_state | Track count per decision. First=1, second=2, third miss=stale. | ✓ |
| Event-based counting | Count decision_events. More auditable but heavier query. | |

**User's choice:** Prompt count in proactive_state
**Notes:** Simple counter, sweep checks it each tick.

| Option | Description | Selected |
|--------|-------------|----------|
| Silent transition | No message to Greg. Two ignored = enough. | ✓ |
| One-line notice | Brief stale notification. Risks nagging. | |

**User's choice:** Silent transition
**Notes:** /decisions (Phase 17) will still show stale decisions.

| Option | Description | Selected |
|--------|-------------|----------|
| Acknowledge follow-up | "A couple days ago I asked about..." Different from first. | ✓ |
| Identical repeat | Same prompt fires again. Feels robotic. | |
| You decide | Claude's discretion. | |

**User's choice:** Acknowledge follow-up
**Notes:** Feels natural, not like a system notification.

---

## Claude's Discretion

- File organization for resolution/post-mortem handler code
- ±48h Pensieve retrieval implementation details
- Exact EN/FR/RU wording of class-specific post-mortem questions
- Whether same-turn reply is concatenated or sequential Telegram messages
- proactive_state key naming for per-decision escalation tracking

## Deferred Ideas

- Multi-question post-mortems (rejected: OOS-M007-04)
- Opus for post-mortem depth (deferred: revisit if shallow)
- Hybrid search for resolution context (deferred: add if lacking)
- Per-channel /mute decisions (Phase 17)
- Resolution edit/retry (rejected: OOS-M007-03)
- Stale → open revival (rejected: terminal states)
