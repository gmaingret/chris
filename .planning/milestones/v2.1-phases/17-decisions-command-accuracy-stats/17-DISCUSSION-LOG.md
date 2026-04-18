# Phase 17: `/decisions` Command & Accuracy Stats - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 17-decisions-command-accuracy-stats
**Areas discussed:** 2-axis classification, Output formatting, Reclassify mechanics, Suppression mgmt

---

## 2-axis Classification

| Option | Description | Selected |
|--------|-------------|----------|
| Extend resolution handler | Add second Haiku call in handleResolution() after classifyOutcome(). One extra Haiku call per resolution. | ✓ |
| Single combined call | Replace classifyOutcome() with 2-axis call returning both axes. Saves one call but modifies Phase 16 code. | |
| Post-mortem hook | Run 2-axis classification in handlePostmortem(). More context but delays classification; stale decisions never classified. | |

**User's choice:** Extend resolution handler
**Notes:** None

### Follow-up: Outcome reuse

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse outcome, add reasoning | Pass already-classified outcome to reasoning classifier. One Haiku call for reasoning only. | ✓ |
| Independent 2-axis call | Fresh Haiku call classifies both axes independently. Could disagree with classifyOutcome(). | |

**User's choice:** Reuse outcome, add reasoning
**Notes:** None

---

## Output Formatting

### `/decisions` (no args) summary

| Option | Description | Selected |
|--------|-------------|----------|
| Counts-only dashboard | One-line counts + accuracy if N>=10 + sub-command list. Fits one Telegram bubble. | ✓ |
| Counts + latest | Counts plus 3 most recent decisions with title/status/date. Longer message. | |
| Just route to help | No-args shows sub-commands only. All data requires explicit sub-command. | |

**User's choice:** Counts-only dashboard
**Notes:** None

### `/decisions open` format

| Option | Description | Selected |
|--------|-------------|----------|
| Compact one-liner | Each decision = one line: title + resolve_by + domain tag. Sorted soonest first. | ✓ |
| Detailed cards | Multi-line blocks per decision with prediction, criterion, status. | |

**User's choice:** Compact one-liner per decision
**Notes:** None

### `/decisions stats` format

| Option | Description | Selected |
|--------|-------------|----------|
| Flat text block | Overall accuracy + CI, unverifiable count, domain breakdown table. Below N=10: counts only. | ✓ |
| Minimal single-line | Just overall stat + unverifiable count. No domain breakdown unless --detail flag. | |

**User's choice:** Flat text block
**Notes:** None

---

## Reclassify Mechanics

### Storage of original vs new classifications

| Option | Description | Selected |
|--------|-------------|----------|
| Event log preserves originals | New `classified` event in decision_events. Projection row overwritten. Originals in event history. | ✓ |
| Dual columns on decisions | Add `original_accuracy_class` + `original_accuracy_model_version` columns. Simpler reads, adds migration. | |

**User's choice:** Event log preserves originals
**Notes:** None

### Batch scope

| Option | Description | Selected |
|--------|-------------|----------|
| Batch all reviewed | Reclassify every reviewed decision with a resolution. Sequential Haiku calls. | ✓ |
| Only stale-model versions | Only reclassify where accuracy_model_version differs from current HAIKU_MODEL. | |
| Interactive per-decision | Show old vs new per decision, ask Greg to confirm each. | |

**User's choice:** Batch all reviewed
**Notes:** None

---

## Suppression Management

| Option | Description | Selected |
|--------|-------------|----------|
| Add list + unsuppress | `/decisions suppressions` + `/decisions unsuppress <phrase>`. Completes CRUD cycle. | ✓ |
| Keep deferred | Phase 14's suppress-only is enough for now. | |
| Add full CRUD + id-based | List, unsuppress, AND id-based suppress. More powerful, adds schema changes. | |

**User's choice:** Add list + unsuppress
**Notes:** None

---

## Claude's Discretion

- Exact localized output strings (EN/FR/RU)
- File organization for classify-accuracy and stats code
- `/decisions recent` default page size (5 or 10)
- Wilson CI display precision
- `decision_text` truncation for compact one-liners

## Deferred Ideas

- Id-based suppression — future, when phrase-based proves insufficient
- Per-channel `/mute decisions` — not Phase 17 scope
- Charts/sparklines — permanently rejected (OOS-M007-06)
- Unprompted stat pushes — permanently rejected (OOS-M007-05)
