# Phase 28: Skip-Tracking + Adjustment Dialogue - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md.

**Date:** 2026-04-29
**Phase:** 28-Skip-Tracking + Adjustment Dialogue
**Mode:** `--auto` (Claude auto-selected recommended defaults; no interactive AskUserQuestion calls)
**Areas auto-decided:** Plan split, RitualFireOutcome union extension, skip_count denormalization, cadence-aware thresholds, adjustment dialogue mechanism, 60s confirmation window, self-protective pause, M006 refusal handling, ritual_config_events writes

---

## Plan split structure (D-28-01)

| Option | Description | Selected |
|--------|-------------|----------|
| 4 plans (substrate / projection / dialogue / closing) | Mirrors Phase 26 5-plan and Phase 29 4-plan precedents | ✓ |
| 3 plans (collapse projection into substrate) | Loses clear cleavage between event writes and skip-count logic | |
| 5 plans (split dialogue from confirmation window) | Confirmation is 60s deferred-fire; tightly coupled to dialogue trigger | |

**Auto-selected:** 4 plans.
**Rationale:** Surface cleavage matches risk profile. Plan 28-03 (dialogue + Haiku call) is the highest-LLM-surface plan; isolating it lets the executor focus and provides a clean revision boundary if checker finds Pitfall 17 issues.

---

## RitualFireOutcome union expansion (D-28-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Add 3 variants (`responded`, `window_missed`, `fired_no_response`) | Per SKIP-01 spec verbatim | ✓ |
| Collapse window_missed into fired_no_response | Loses the "we noticed the window passed" diagnostic distinction | |
| Add only `fired_no_response` | Doesn't capture the `responded` reset trigger semantics | |

**Auto-selected:** All 3 variants.
**Rationale:** Spec requires the discriminated union for SKIP-01; the diagnostic distinction between `window_missed` (the fact) and `fired_no_response` (the policy classification) preserves replayability of `ritual_fire_events`.

---

## Skip-count denormalization (D-28-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Denormalized projection from ritual_fire_events; rebuilable | M007 decision_events precedent + D004 spirit | ✓ |
| Authoritative skip_count column with no event rebuild | Loses replay-from-events guarantee per SKIP-02 spec | |

**Auto-selected:** Denormalized + rebuilable.
**Rationale:** SKIP-02 spec requires "rebuildable projection". Mirrors M007's `decisions.status` pattern (events are authoritative, projection is convenience).

---

## Cadence-aware thresholds (D-28-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Daily=3, Weekly=2 (per spec interpretation #3) | Locked at v2.4 kickoff per STATE.md | ✓ |
| Uniform threshold=3 (per original spec text) | Already overridden by spec interpretation #3 | |

**Auto-selected:** Cadence-aware (3/2).
**Rationale:** Locked at milestone kickoff; Plan 28-02 includes a verification task to audit existing seed migrations 0007/0008/0009 for skip_threshold values matching cadence defaults (probably need correction migration 0010).

---

## Adjustment dialogue mechanism (D-28-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Single-turn Haiku 3-class structured Zod parse | Per OOS-11 (no @grammyjs/conversations); simplest | ✓ |
| Multi-turn dialogue via @grammyjs/conversations | Anti-feature; rejected at milestone level | |

**Auto-selected:** Single-turn Haiku.
**Rationale:** OOS-11 explicit anti-feature. Single-turn structured output is sufficient for the 3-class classification.

---

## 60-second confirmation window (D-28-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Deferred-fire via 1-minute cron + ritual_pending_responses row | Survives container restart; deterministic | ✓ |
| JS setTimeout in-process | Doesn't survive restart; loses confirmation if container cycles | |
| Wait until next 10:00/21:00 sweep tick | Too coarse — 60s window violated | |

**Auto-selected:** 1-minute cron + DB row.
**Rationale:** Container restart resilience is non-negotiable for an audit-trail-relevant decision. Cron handler is cheap (single SQL select on partial index when nothing's pending).

---

## Self-protective 30-day pause (D-28-07)

| Option | Description | Selected |
|--------|-------------|----------|
| 2 evasive in 14d → enabled=false + mute_until=+30d; auto-re-enable | Per SKIP-06 spec verbatim | ✓ |
| Permanent disable on 2 evasive | Too aggressive; spec says auto-re-enable | |
| 1 evasive triggers (more conservative) | Spec says 2 — matches "give Greg a chance to disambiguate" intent | |

**Auto-selected:** 2-in-14d → 30-day pause with auto-re-enable.
**Rationale:** Spec verbatim. "Self-protective" framing means the system steps back; auto-re-enable means it doesn't disappear forever.

---

## M006 refusal handling inside dialogue (D-28-08)

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-check refusal patterns BEFORE Haiku call | Refusals never count as evasive; clean separation | ✓ |
| Let Haiku classify; map "refusal-like" to evasive | Loses M006 invariants; Haiku confidence-classifying refusal as evasive triggers spurious 30d pause | |
| Post-check after Haiku | Wastes Haiku call on refusals + adds latency | |

**Auto-selected:** Pre-check before Haiku.
**Rationale:** M006 invariants are load-bearing for trust. Refusals MUST short-circuit the classification entirely. Reuses existing `src/chris/refusal.ts` detector.

---

## ritual_config_events audit writes (D-28-09)

| Option | Description | Selected |
|--------|-------------|----------|
| Write event row on every config mutation; reuse Phase 25 schema | SKIP-07 spec verbatim; table already shipped | ✓ |
| Don't audit auto-pause / auto-unpause (only manual changes) | Loses replay capability for auto-policy decisions | |

**Auto-selected:** Audit every mutation.
**Rationale:** SKIP-07 spec verbatim. Append-only audit is M007 decision_events precedent. Future debugging / Phase 30 fixture rebuild depends on it.

---

## Claude's Discretion

- Exact file names within `src/rituals/` (`adjustment-dialogue.ts` is the obvious choice)
- Exact log-event names (`chris.adjustment.fired`, `chris.adjustment.classified`, `chris.adjustment.applied`, etc.)
- PP#5 extension shape (single chokepoint with `kind` switch vs peer PP#6) — recommend single chokepoint
- `adjustment_mute_until` storage location (RitualConfigSchema 9th field with schema_version bump vs separate column) — recommend RitualConfigSchema extension
- Confirmation sweep cron env-gating (whether to allow disabling in tests)

## Deferred Ideas

- Multi-turn adjustment dialogue (OOS-11 anti-feature — defer indefinitely)
- Live anti-flattery test for adjustment dialogue (defer unless real-use surfaces gaps; could fold into Phase 30 TEST-31 adversarial extension)
- Per-classification confidence thresholds (default-evasive on low conf is locked; tune later if needed)
- Monthly / quarterly cadence skip thresholds (M013+)
- Manual `/skip-tracking-stats` command (defer)
- skip_count reset on manual config change (Plan 28-04 task if planner agrees)
