# Project Research Summary — M007 Decision Archive

**Project:** Chris v2.1 — M007 Decision Archive
**Domain:** Decision capture + forecast accountability extension on top of existing Chris Pensieve/engine/proactive-sweep stack
**Researched:** 2026-04-15
**Confidence:** HIGH on stack & architecture; MEDIUM-HIGH on features and pitfalls

## Executive Summary

M007 is the keystone feature of Chris's soul system — the only layer that can **empirically challenge** Greg rather than describe him. The domain skeleton (capture-with-reasoning, falsifiable prediction, scheduled resolution, post-mortem separating decision quality from outcome quality) is well-established across Parrish, Duke, Tetlock, and Metaculus and maps cleanly onto the M007 spec. The five-question protocol is a faithful Parrish+Tetlock composition, not an invention.

Implementation is a **pure integration milestone with zero new runtime dependencies.** Everything M007 needs already ships in v2.0: Drizzle `pgEnum` for lifecycle states, `node-cron` + proactive sweep for deadline scheduling, `franc` for EN/FR/RU language detection, three-tier Anthropic SDK (Haiku for classification), Vitest 4.1 built-in fake timers for the synthetic-clock fixture, and SQL `interval` for rolling 30/90/365-day windows.

The dominant risks are all about **trust and integrity collapse**, not technical failure. The feature is actively worse than absent if it ships with: vague unfalsifiable predictions (accuracy drifts to ~95% flattery — inverts M006), a rigid interrogation-style capture (Greg trains around triggers), mutable status columns that violate the Pensieve's append-only invariant (historical stats silently change), a praise-quarantine collision that muzzles accountability voice OR smuggles flattery into it, or small-N percentages presented as scoreboards. Mitigation is structural: falsifiability as `NOT NULL` with an `open-draft` escape, conversational-extraction capture, an append-only `decision_events` projection, a new ACCOUNTABILITY mode that bypasses the quarantine at the prompt level (with The Hard Rule forbidden by design), and an N≥10 floor with Wilson intervals on accuracy display.

## Key Findings

### Recommended Stack

**Zero new runtime dependencies. Zero new dev dependencies.** Every primitive M007 needs is already present in the v2.0 lockfile. Research explicitly recommends against `@sinonjs/fake-timers` standalone (Vitest bundles it), against `date-fns`/`dayjs`/`luxon` (SQL `interval` handles rolling windows), against `node-schedule`/`bullmq`/`agenda` (fragments scheduling), and against `xstate`/`robot3` (a 10-line `assertTransition` beats a DSL for 4 states/3 transitions).

**Core technologies (all already installed, all reused):**
- **Drizzle ORM 0.45.2 `pgEnum`** — value-set enforcement for `decision_status` and `decision_capture_stage`; transitions enforced in a TS chokepoint.
- **node-cron 4.2.1 (existing proactive sweep)** — deadline scheduler becomes a **fifth SQL-first trigger** inside the existing sweep, not a parallel cron.
- **Anthropic SDK three-tier (D001)** — Haiku for accuracy classification + two-phase stakes-disambiguation; Sonnet for capture conversation and resolution prompts.
- **franc 6.2.0 (D021)** — EN/FR/RU detection already in engine pre-processing; reused for trigger-phrase routing.
- **PostgreSQL 16 `interval`** — rolling 30/90/365-day windows via `FILTER (WHERE resolved_at >= now() - interval 'N days')` in a single query.
- **Vitest 4.1 `vi.useFakeTimers` / `vi.setSystemTime`** — synthetic-clock fixture test with zero install.

### Expected Features (by category)

**Must have (table stakes, P1):**
- **Capture:** trigger-phrase detection EN/FR/RU; 5-question guided capture as **conversational extraction** (not scripted Q1→Q5); one-message multi-answer via Haiku structured output; abort/escape phrase; `resolve_by` natural-language parsing with fallback ladder (7/30/90/365d).
- **Lifecycle:** explicit 4-state FSM `open → due → resolved → reviewed`; single `transitionDecision()` chokepoint with optimistic concurrency; side-paths `withdrawn`/`stale`/`open-draft`/`abandoned`; all transitions appended to `decision_events`.
- **Resolution:** deadline-driven prompt within 24h of `resolve_by`; free-text outcome capture; **one** post-mortem follow-up (question chosen by outcome class); resolution + post-mortem written as Pensieve entries with `source_ref_id` provenance.
- **Stats:** `/decisions` pull-only; open list; recently resolved; rolling 30/90/365d accuracy; Haiku 2-axis classification (outcome × reasoning) + `ambiguous` + `unverifiable` buckets; **N≥10 floor** before any percentage; **Wilson 95% CI** above the floor.
- **UX:** resolution prompts embedded in natural conversation (never form-style); one prompt per decision per lifecycle; mute respect; **Pensieve retrieval at resolution time surfacing ±48h of surrounding entries** — the chief Chris-specific differentiator.

**Should have (differentiators):**
- Contradiction detection extended to `decisions.reasoning` (cheap M002 reuse).
- Popper criterion passively re-displayed at resolution.
- Two-axis Haiku classification (outcome × reasoning) separating Duke's "lucky hit" from "skilled hit" — beyond M007 spec.

**Defer (v2.2 / M013):**
- Inferred `captured_context` from surrounding Pensieve + time-of-day.
- Partial-capture recovery prompts.
- Opus pattern detection across misses (needs 20+ resolved decisions).
- Auto-fire Popper probe on disconfirming evidence.
- Domain-specific calibration curves.

**Explicit anti-features:**
- Forced numeric probability; full Brier pipeline.
- Auto-resolving by scanning Pensieve for outcome.
- Editing original reasoning post-outcome.
- Multi-question structured post-mortems.
- "You haven't captured a decision in N days" nag.
- Unprompted accuracy-stat pushes.
- Charts/graphs in Telegram; capture-time category tags; betting/stakes mechanics.

### Architecture Approach

M007 is an **integration milestone** plugging into existing structures via documented extension points. Central insight: decision capture is **not a mode** (Haiku classifier fragility + per-message cost), **not post-processing** (user intent is in user's message), and **not a new cron** (fragments timed-things surface). It is a **pre-processor + sub-flow handler** intercepting before `detectMode()`, with durable state in a dedicated `decision_capture_state` table (PK=chat_id).

**Major new components:**
1. **`decisions` + `decision_events` + `decision_capture_state` tables** — projection over append-only event log (mirrors `contradictions` ↔ `pensieve_entries`). Mutable status on `decisions` is legal only because regenerable from `decision_events`.
2. **`src/decisions/lifecycle.ts`** — single `transitionDecision(id, to, payload)` with validated transition map, optimistic concurrency (`AND status=$expected`), Pensieve-first ordering on resolution/post-mortem.
3. **`src/decisions/triggers.ts`** — two-phase: Phase A regex candidate (EN/FR/RU shared fixtures with cardinality CI guard); Phase B Haiku stakes classifier (`trivial`/`moderate`/`structural`) — only `structural` activates.
4. **`src/decisions/capture.ts`** — conversational extraction (Haiku structured output), 3-turn follow-up cap, partial-commit path (`open-draft`).
5. **`src/decisions/resolution.ts`** — routed via pre-processor on stage `AWAITING_RESOLUTION` / `AWAITING_POSTMORTEM`.
6. **`src/proactive/triggers/decision-deadline.ts`** — fifth trigger, priority=2 (between silence=1 and commitment=3).
7. **`src/bot/handlers/decisions.ts`** — `/decisions` + sub-commands; mirrors `sync.ts`.
8. **ACCOUNTABILITY mode (or COACH extension)** — resolution/post-mortem responses route here; praise quarantine bypassed at prompt level; The Hard Rule forbidden explicitly.

**Modified:** `engine.ts` (two new pre-processors, sub-flow check first), `sweep.ts` (new trigger in SQL-gate array), `triggers/types.ts` (union extension), `bot.ts` (`/decisions` registered before generic text handler), `schema.ts` (new enums + tables + `DECISION` epistemic tag).

### Critical Pitfalls (C1–C7 — all must be addressed in requirements)

1. **C1 — Interrogation failure mode.** Rigid Q1→Q5 → Greg aborts, decisions go underground. *Mitigation:* conversational Haiku extraction; one-message multi-answer; 3-turn cap; `open-draft` over null-stuffing.
2. **C2 — Vague-prediction escape hatch.** "Probably fine" resolves as correct → accuracy drifts to flattery → inverts M006. *Mitigation:* `falsification_criterion NOT NULL`; Haiku validator on hedge words (one pushback, then accept); three-bucket classifier (`correct`/`incorrect`/`unverifiable`) with dual denominators exposed.
3. **C3 — Over-triggering hijack.** Naive regex fires on "I'm thinking about dinner"; Greg trains around triggers. *Mitigation:* two-phase detection (regex → Haiku stakes classifier with negative examples); per-user suppression list; default activation = `structural` only.
4. **C4 — Mutable-status trap.** Sweep↔reply races strand decisions in `due` with lost resolution; historical stats silently change. *Mitigation:* `decisions` is projection over append-only `decision_events`; optimistic concurrency; Pensieve write BEFORE status update; withdrawal = `status='withdrawn'`, never delete.
5. **C5 — Scheduler collision with proactive sweep.** Daily cap starves silence/commitment OR decision-deadline. *Mitigation:* two independent channels (`reflective_outreach` vs `accountability_outreach`) with separate caps; serialize when both fire same day; extended mute semantics.
6. **C6 — Small-N calibration theatre.** "67% accuracy" at N=3 = noise as metric → sycophancy by dashboard. *Mitigation:* N≥10 floor; Wilson 95% CI above floor; domain-tag breakdown; surface `unverifiable` count.
7. **C7 — Anti-sycophancy collision with M006.** Praise quarantine muzzles accountability voice OR bypass drifts into flattery. *Mitigation:* new ACCOUNTABILITY mode (or COACH extension) bypassing quarantine at prompt level like COACH/PSYCHOLOGY (D025); The Hard Rule (D027) forbidden explicitly; live integration suite (D023) for hit/miss/unverifiable × 3-of-3 real Sonnet, asserting absence-of-flattery AND absence-of-condemnation.

## Implications for Roadmap

### Phase 1: Schema + Lifecycle Primitives
**Rationale:** Nothing builds without tables and transition chokepoint. Include append-only `decision_events` from day one — retrofitting event-sourcing later is much harder.
**Delivers:** pgEnums; `DECISION` epistemic tag; `decisions`/`decision_events`/`decision_capture_state` tables; `lifecycle.ts` with `transitionDecision()` + optimistic concurrency; CHECK constraints (`resolve_by NOT NULL`, `falsification_criterion NOT NULL`); unit tests for illegal transitions.
**Avoids:** C4, M1.

### Phase 2: Capture Flow (trigger detection + 5-question extraction)
**Rationale:** Depends on lifecycle. Phase A regex alone triggers C3; ship Phase A+B together.
**Delivers:** `triggers.ts` (regex + Haiku stakes); `capture.ts` (conversational extraction, multi-answer, abort phrase, 3-turn cap, `open-draft`); engine pre-processors #0 and #1 wired before mute/refusal/language/mode; vague-prediction validator.
**Avoids:** C1, C2, C3, M5, M6.

### Phase 3: Deadline Trigger + Proactive Sweep Integration
**Rationale:** Capture produces `open`; they must transition to `due` and surface prompts.
**Delivers:** `decision-deadline.ts` (priority=2); `TriggerResult.triggerType` extension; sweep writes `decision_capture_state(AWAITING_RESOLUTION)` before sendMessage; **channel separation** `reflective_outreach` vs `accountability_outreach` with separate caps; extended mute semantics; dated prompts for >48h past window.
**Avoids:** C5, M3.

### Phase 4: Resolution + Post-Mortem + ACCOUNTABILITY mode
**Rationale:** Must land with new mode and live suite or it inverts M006.
**Delivers:** `resolution.ts` for `AWAITING_RESOLUTION`/`AWAITING_POSTMORTEM`; ACCOUNTABILITY mode bypassing praise quarantine at prompt level; The-Hard-Rule forbidden explicitly; Pensieve-first write ordering; ±48h Pensieve retrieval as post-mortem context; auto-escalation after 2 non-replies; `source_ref_id` provenance.
**Avoids:** C7, M2, M6.

### Phase 5: `/decisions` Command + Accuracy Stats
**Rationale:** Requires reviewed data from Phase 4; N-floor + CI prevent sycophancy-by-dashboard (C6).
**Delivers:** `handlers/decisions.ts` (open / stats / stats <window>); `accuracy.ts` with 2-axis Haiku classification cached on `decision_events` with model version; rolling SQL windows; N≥10 floor; Wilson 95% CI; domain-tag breakdown; `unverifiable` count surfaced; `/decisions reclassify` admin preserving originals side-by-side.
**Avoids:** C2, C6, M4.

### Phase 6: Synthetic Fixture Test + Live ACCOUNTABILITY Suite
**Rationale:** Final gate. Single fixture exercises end-to-end under `vi.setSystemTime`; covers concurrency race, same-day collision, stale-context. Separate live suite validates ACCOUNTABILITY mode absence-of-flattery + absence-of-condemnation against real Sonnet.
**Avoids:** C7 (definitive flatline check).

### Phase Ordering Rationale

- **Topological:** lifecycle → capture → deadline → resolution → stats. Each stage's output feeds the next's input.
- **Schema front-loaded:** event-log and NOT NULL invariants cannot be cleanly retrofitted.
- **Two-phase trigger detection is atomic** (Phase A alone = C3).
- **ACCOUNTABILITY mode lands with resolution** — shipping resolution without the mode is C7.
- **Live integration suite for ACCOUNTABILITY is non-negotiable** (D023/D032 precedent).

### Research Flags

**Needs deeper research during planning:**
- **Phase 4** — ACCOUNTABILITY prompt design; extend COACH vs new mode; The-Hard-Rule forbidden-phrase enumeration in resolution context; live-suite scenario design. Highest M006-density phase.
- **Phase 5** — 2-axis classifier prompt + confidence threshold; Wilson CI rendering in plain-text Telegram; surfacing `unverifiable` without reading as excuse-making.

**Standard patterns (skip research-phase):**
- **Phase 1** — Drizzle pgEnum + transition map; already proven in Chris.
- **Phase 2 regex** — direct copy of `refusal.ts` shape with franc threading.
- **Phase 3 skeleton** — mirrors existing commitment/silence triggers.
- **Phase 6 fake-timers** — standard Vitest API.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against existing `package.json`, Vitest/Drizzle official docs, npm spot-checks. Zero new deps. |
| Features | MEDIUM-HIGH | Domain literature convergent (HIGH); resolution-scoring recommendations (2-axis classifier, N≥10, Wilson CI) LOW-MEDIUM, flagged for post-pause validation. |
| Architecture | HIGH | Grounded in direct reads of engine.ts / sweep.ts / schema.ts / bot.ts / refusal.ts / triggers/types.ts. |
| Pitfalls | MEDIUM-HIGH | Ecosystem evidence (C1/C2/C6) established; Chris-specific pitfalls (C4/C5/C7) derived from D004/D010/D015/D024–D027/D031. |

**Overall confidence:** HIGH for proceeding to requirements. Remaining ambiguity is design-internal (exact ACCOUNTABILITY prompt wording, exact 2-axis classifier schema), not research-external.

### Gaps to Address

- **Scoring approach validation** — 2-axis classification + N≥10 floor + Wilson CI is MEDIUM confidence; revisit in post-pause retrospective.
- **ACCOUNTABILITY mode vs COACH extension** — research surfaces both; Phase 4 planning must choose.
- **Channel separation (C5)** — material architectural change to M004 sweep; must be documented in requirements, not left as Phase 3 detail.
- **Epistemic tag** — new `DECISION` tag vs reuse `INTENTION`; confirm in Phase 1.
- **Two-reasoning-slot capture** — `reasoning_stated` + optional `reasoning_suspected`; not in original M007 spec; requirements must decide include vs defer.

## Sources

**Primary (HIGH):** Chris codebase (engine.ts, sweep.ts, schema.ts, bot.ts, refusal.ts, triggers/types.ts, commitment.ts, memory/conversation.ts, package.json @ 2026-04-15); `.planning/PROJECT.md` decisions D001/D004/D010/D015/D016/D018/D020–D033; `M007_Decision_Archive.md`; `PRD_Project_Chris.md`; Vitest docs (vi.useFakeTimers); Drizzle docs (pgEnum); npm registry spot-checks (vitest@4.1.4, drizzle-orm@0.45.2, node-cron@4.2.1, postgres@3.4.5, franc@6.2.0, @sinonjs/fake-timers@15.3.2); Parrish/Duke/Tetlock decision-journaling domain; Metaculus/GJO resolution vocabulary.

**Secondary (MEDIUM):** Commoncog personal calibration pragmatics; Forecasting Research Institute ForecastBench; LessWrong ambiguity-in-resolution; Manifold community norms; ecosystem pattern-detection false-positive rates (15–45%, referenced for C3).

**Tertiary (LOW):** Specific numerical thresholds (3-turn cap, 48h window, N≥10 floor, 30% abandonment alarm, Wilson 95%) — principled defaults, expect tuning against real data post-pause.
