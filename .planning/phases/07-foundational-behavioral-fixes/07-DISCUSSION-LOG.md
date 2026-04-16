# Phase 7: Foundational Behavioral Fixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 07-foundational-behavioral-fixes
**Areas discussed:** Preamble wording, Refusal detection, Question pressure, Language detection

---

## Preamble Wording

| Option | Description | Selected |
|--------|-------------|----------|
| Use spec wording verbatim | Copy the exact text from M006 spec into buildSystemPrompt(). Treat it as final. | |
| Refine the tone | Start from the spec but soften/sharpen specific phrasing before locking it in | |
| Claude decides | Use the spec as intent, let Claude write the final preamble text during implementation | ✓ |

**User's choice:** Claude decides
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Layer (additive) | Preamble prepends, existing mode prompts stay as-is. COACH keeps its own directness guidance on top of the preamble. (Matches D022) | ✓ |
| Consolidate | Preamble replaces any overlapping guidance in individual mode prompts to avoid duplication | |

**User's choice:** Layer (additive)
**Notes:** Confirms D022

---

## Refusal Detection

| Option | Description | Selected |
|--------|-------------|----------|
| Before mode detection | Check for refusal patterns first, inject declined topics into all subsequent prompts. Similar to how mute detection already runs pre-mode. | |
| After mode detection | Detect mode first, then check for refusals. Allows mode-specific refusal handling. | |
| Claude decides | Let implementation choose the best placement based on engine architecture | ✓ |

**User's choice:** Claude decides

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory Map | Simple Map<chatId, Set<topic>> in the Node process. Resets on restart. Cheap, ephemeral, matches 'per-session' intent. | |
| Database table | New declined_topics table with chatId + topic + timestamp. Survives restarts. Heavier but durable. | |
| Claude decides | Let implementation choose based on trade-offs | ✓ |

**User's choice:** Claude decides

| Option | Description | Selected |
|--------|-------------|----------|
| Strict only | Only explicit refusals: 'I don't want to talk about X', 'stop asking about X'. Fewer false positives. | |
| Include soft deflections | Also catch 'let's move on', 'not now', 'drop it', 'change the subject'. More coverage, more false positive risk. | |
| Claude decides | Let implementation calibrate based on the 15-20 patterns per language target | |

**User's choice:** (freeform) "refusal is not so important. just keep it as like it's not the topic right now. Nothing eternal."
**Notes:** Refusals are lightweight, ephemeral, session-scoped. More "not right now" than hard ban.

---

## Question Pressure

| Option | Description | Selected |
|--------|-------------|----------|
| Questions are rare | Chris mostly responds without questions. Questions only when genuinely useful, maybe 1 in 5 responses. | ✓ |
| Never end with a question | Chris can ask mid-response but never ends on a question. Avoids the interview pattern entirely. | |
| Questions only when invited | Chris only asks questions if Greg explicitly asks for input. Otherwise just responds. | |

**User's choice:** Questions are rare

| Option | Description | Selected |
|--------|-------------|----------|
| Only clarifying | Questions only to understand what Greg said, never to push deeper or redirect | |
| Clarifying + deepening | Can ask to understand AND to help Greg think deeper, but sparingly | ✓ |
| Claude decides | Let the prompt wording calibrate naturally | |

**User's choice:** Clarifying + deepening

---

## Language Detection

| Option | Description | Selected |
|--------|-------------|----------|
| System prompt injection | Add 'RESPOND IN {language}' as a hard system parameter at the top of every system prompt. Strongest override. | |
| Replace existing rules | Remove the per-prompt 'ALWAYS respond in same language' lines and centralize into a single injected parameter | |
| Claude decides | Let implementation choose the most effective injection point | ✓ |

**User's choice:** Claude decides

| Option | Description | Selected |
|--------|-------------|----------|
| Mode detection stays English | Haiku mode detection prompt stays in English. It works fine on multilingual input already. | ✓ |
| Adapt mode detection | Pass detected language context to Haiku so it can better classify non-English messages | |
| Claude decides | Let implementation test and choose | |

**User's choice:** Mode detection stays English

---

## Claude's Discretion

- Final preamble prose wording
- Refusal detection pipeline placement, persistence, and pattern breadth
- Language injection method
- Whether to keep or remove per-prompt language rules

## Deferred Ideas

None
