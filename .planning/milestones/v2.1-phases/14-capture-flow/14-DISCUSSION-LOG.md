# Phase 14: Capture Flow — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-15
**Phase:** 14-capture-flow
**Areas discussed:** Trigger regex & abort set, Haiku stakes classifier, Conversational capture shape, Vague validator + suppress, resolve_by parsing, LIFE-05 wiring, language_at_capture source, open-draft → open promotion

---

## Trigger regex & abort set

### Q1: Starting trigger phrase set for Phase A regex?

| Option | Description | Selected |
|---|---|---|
| PRD set only (Recommended) | Exact PRD EN/FR/RU phrases; tune after real usage | ✓ |
| PRD + common extensions | Add "should I", "devrais-je", "стоит ли", etc. | |
| You decide | Planner/executor picks | |

### Q2: Meta-reference guards?

| Option | Description | Selected |
|---|---|---|
| Hard negative-lookbehind regex (Recommended) | Regex excludes negations deterministically | ✓ |
| Defer to Phase B Haiku | Let regex fire broadly; Haiku sorts | |
| Both | Lookbehind + Haiku safety net | |

### Q3: Cardinality CI guard?

| Option | Description | Selected |
|---|---|---|
| Shared fixture count parity (Recommended) | \|EN\| = \|FR\| = \|RU\| in shared fixture | ✓ |
| Per-language minimum only | Each language >= K triggers | |
| Full semantic parity | Per-phrase semantic-id mapping | |

### Q4: Abort-phrase set?

| Option | Description | Selected |
|---|---|---|
| Research default (Recommended) | EN/FR/RU phrase list; case-insensitive match | ✓ |
| Default + Haiku abort-intent fallback | Phrase set + 2s Haiku catch-all | |
| You decide | Planner picks | |

---

## Haiku stakes classifier

### Q1: Prompt calibration?

| Option | Description | Selected |
|---|---|---|
| Definitions + 3 examples/tier (Recommended) | Tier defs + 3 positive examples each | ✓ |
| Definitions + positive + negative | Add 2-3 negatives per tier | |
| Minimal prompt + structured output | One-line defs; trust Haiku | |

### Q2: Failure mode?

| Option | Description | Selected |
|---|---|---|
| Fail-closed: skip capture (Recommended) | Treat as trivial on error; fall through | ✓ |
| Fail-open: activate capture | Treat as structural on error | |
| Fail-open with confirmation | Ask Greg before opening | |

### Q3: Cache stakes classifications?

| Option | Description | Selected |
|---|---|---|
| No cache (Recommended) | Fresh Haiku each time; cost negligible | ✓ |
| Cache by hash (24h TTL) | Save repeat-phrase cost | |
| Cache trivial verdicts only | Speed up negative suppression | |

### Q4: Timeout?

| Option | Description | Selected |
|---|---|---|
| 3s hard timeout (Recommended) | Matches contradiction-detection convention | ✓ |
| 2s hard timeout | Tighter; more timeouts on slow days | |
| 5s hard timeout | Noticeable reply delay | |

---

## Conversational capture shape

### Q1: 5-slot extraction implementation?

| Option | Description | Selected |
|---|---|---|
| Single greedy Haiku pass/turn (Recommended) | One Haiku call fills any slots from user reply | ✓ |
| Per-slot focused prompt | Haiku asked per stage | |
| Single pass + per-slot follow-up | Greedy first, fall back to focused | |

### Q2: Stage ordering?

| Option | Description | Selected |
|---|---|---|
| Suggested order, any-slot accepted (Recommended) | Canonical question order; extractor flexible | ✓ |
| Strict sequential | Finish stage before advancing | |
| Fully user-led | Chris picks most natural next Q | |

### Q3: 3-turn cap behavior?

| Option | Description | Selected |
|---|---|---|
| Auto-commit as open-draft (Recommended) | Silent commit at turn 3 | ✓ |
| Confirm before open-draft | Ask "save as draft?" | |
| Soft-prompt last missing slot then commit | One targeted final ask | |

### Q4: Re-trigger mid-capture?

| Option | Description | Selected |
|---|---|---|
| Ignore re-trigger, stay on current (Recommended) | PP#0 routes to handleCapture regardless | ✓ |
| Abandon current, open new | New trigger overrides; current → abandoned | |
| Ask Greg to choose | Explicit but intrusive | |

---

## Vague validator + suppress

### Q1: Vagueness detection?

| Option | Description | Selected |
|---|---|---|
| Haiku judgment with hedge-word prior (Recommended) | Hedge words seed; Haiku evaluates falsifiability | ✓ |
| Hedge-word regex only | Deterministic; misses semantic vagueness | |
| Haiku only, no prior | Simpler prompt | |

### Q2: Pushback UX?

| Option | Description | Selected |
|---|---|---|
| Once, at falsification_criterion slot (Recommended) | One clarifier; accept next reply | ✓ |
| Once, at prediction slot | Earlier check | |
| Up to two rounds | Higher quality, more interrogation | |

### Q3: Second-vague landing status?

| Option | Description | Selected |
|---|---|---|
| open-draft (Recommended) | Preserve signal; don't inflate stats | ✓ |
| open (forced accept) | Counts toward stats; risks C2 | |
| Abandon (no row written) | Loses signal entirely | |

### Q4: /decisions suppress surface for Phase 14?

| Option | Description | Selected |
|---|---|---|
| Phrase-only, case-insensitive substring (Recommended) | Minimum CAP-06; no list/unsuppress yet | ✓ |
| Phrase OR decision_id | Id form suppresses exact phrase that spawned id | |
| Full CRUD in Phase 14 | Ship suppress + list + unsuppress | |

---

## resolve_by parsing

### Q: Fallback ladder trigger?

| Option | Description | Selected |
|---|---|---|
| Haiku parse, ladder on fail (Recommended) | 7/30/90/365 surfaced as clarifier menu; no silent fallback | ✓ |
| Haiku parse, silent ladder | Hidden heuristic | |
| Regex-first, Haiku fallback | Cheaper; catches common cases | |

---

## LIFE-05 wiring

### Q: When does contradiction detection on decisions.reasoning fire?

| Option | Description | Selected |
|---|---|---|
| On first open commit, fire-and-forget (Recommended) | Not on open-draft; no re-scan on promotion | ✓ |
| On both open-draft and open | Scan from first commit regardless | |
| On every reasoning field update | Most thorough, most spam | |

---

## language_at_capture

### Q: Source?

| Option | Description | Selected |
|---|---|---|
| franc on triggering message (Recommended) | Locked at capture-open; never updated | ✓ |
| getLastUserLanguage() at commit | Recent-message vote helper | |
| franc at open-commit time | Final reasoning/decision text | |

---

## open-draft → open promotion

### Q: When does auto-promotion happen?

| Option | Description | Selected |
|---|---|---|
| On next-turn completion only (Recommended) | Within active capture; no background sweep | ✓ |
| Sweep-based auto-promote | Scan drafts periodically | |
| Manual only via /decisions | Explicit command | |

---

## Claude's Discretion

- Exact Drizzle schema for `decision_trigger_suppressions` table (planner's call)
- Colocation of `resolve_by` Haiku parser in `capture.ts` vs dedicated file
- EN/FR/RU prompt wording for vague-pushback and resolve-by clarifier
- Inline vs parallel stakes-classifier call in the engine pipeline
- File split within `src/decisions/` for capture code

## Deferred Ideas

- Extended trigger phrases (EN "should I", FR "devrais-je", RU "стоит ли")
- Haiku abort-intent fallback for off-phrase aborts
- Negative examples in stakes-classifier prompt
- `/decisions suppress id:<uuid>` form
- Full CRUD for suppression (list/unsuppress) — Phase 17
- Sweep-based open-draft promotion (rejected permanently)
- `/decisions promote <id>` manual command
- Stakes-verdict caching by phrase hash
- Per-phrase semantic-id parity guard across EN/FR/RU
- Two rounds of vague-prediction pushback (rejected)
