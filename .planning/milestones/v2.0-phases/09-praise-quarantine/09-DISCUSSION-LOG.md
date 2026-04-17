# Phase 9: Praise Quarantine - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 09-praise-quarantine
**Areas discussed:** Detection vs Rewriting, Flattery Patterns, Pipeline Placement, Failure Behavior
**Mode:** --auto (all decisions auto-selected)

---

## Detection vs Rewriting

| Option | Description | Selected |
|--------|-------------|----------|
| Detect and strip | Remove flattering sentences entirely | |
| Detect and rewrite | Haiku rephrases opening without flattery, preserving meaning | :white_check_mark: |

**User's choice:** [auto] Detect and rewrite (recommended default)
**Notes:** Stripping sentences can leave choppy responses. Rewriting achieves the same goal more gracefully while preserving response flow and context.

---

## Flattery Patterns Targeted

| Option | Description | Selected |
|--------|-------------|----------|
| Opening reflexive praise only | Target vacuous openers like "Great question!" | :white_check_mark: |
| All positive language | Target any complimentary or validating language | |
| Excessive agreement patterns | Target "you're absolutely right" type responses | |

**User's choice:** [auto] Opening reflexive praise only (recommended default)
**Notes:** Mid-response genuine engagement is fine. The roadmap specifically says "never opens with reflexive praise" — the target is vacuous openers that add no substance, not all positive language.

---

## Pipeline Placement

| Option | Description | Selected |
|--------|-------------|----------|
| After mode handler, before contradiction | Clean response before other post-processing appends | :white_check_mark: |
| After all post-processing | Run last, after contradiction notices appended | |

**User's choice:** [auto] After mode handler, before contradiction detection (recommended default)
**Notes:** Praise quarantine should clean the core response before contradiction detection appends notices. Keeps pipeline order clean: handler → quarantine → contradiction → save.

---

## Failure Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Pass through original | On Haiku failure, return response unchanged | :white_check_mark: |
| Block and retry | Retry Haiku call once before passing through | |
| Always pass through (skip Haiku) | Make quarantine optional/configurable | |

**User's choice:** [auto] Pass through original (recommended default)
**Notes:** Consistent with D005 (never block response) and existing contradiction detection pattern (timeout → empty result).

---

## Claude's Discretion

- Exact Haiku prompt text for the rewrite instruction
- Timeout value within 2-4s range
- Log format for rewrite/no-change tracking
- Whether Haiku receives user's original message for context

## Deferred Ideas

None — discussion stayed within phase scope
