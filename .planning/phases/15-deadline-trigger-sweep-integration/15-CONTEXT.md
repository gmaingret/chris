# Phase 15: Deadline Trigger & Sweep Integration — Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

When a decision's `resolve_by` passes, Chris surfaces the resolution prompt within 24 hours without starving or being starved by the four existing reflective-outreach triggers. Delivers:

- A new `decision-deadline` trigger implementing `TriggerDetector` at priority=2 (between silence=1 and commitment=3), querying `decisions WHERE status='open' AND resolve_by <= now()` and transitioning exactly one oldest-due decision `open → due` via `transitionDecision()`.
- Channel separation: the sweep gains two independent channels — `reflective_outreach` (silence/commitment/pattern/thread, existing behavior) and `accountability_outreach` (decision-deadline) — with separate daily caps and independent `last_sent` keys in `proactive_state`.
- Same-day collision: accountability fires first (hard 24h window), reflective fires independently after — both can land on the same day since caps are independent.
- Global mute suppresses both channels; accountability never bypasses mute.
- Stale-context detection: when a prompt fires >48h past `resolve_by`, the trigger context is explicitly dated ("On 2026-04-01 you predicted…") rather than implicitly recent-framed.
- A distinct `ACCOUNTABILITY_SYSTEM_PROMPT` for the accountability channel — cite prediction + criterion, no flattery, no condemnation, ask "what happened?"

**Out of scope for Phase 15 (named explicitly to prevent creep):**
- Resolution handler, post-mortem, ACCOUNTABILITY engine mode → Phase 16.
- `/decisions` list/stats/accuracy/unsuppress, `/mute decisions` per-channel mute → Phase 17.
- Synthetic-fixture end-to-end + live Sonnet suite → Phase 18.

</domain>

<decisions>
## Implementation Decisions

### Trigger implementation (SWEEP-01)

- **D-01:** Query `decisions WHERE status='open' AND resolve_by <= now() ORDER BY resolve_by ASC LIMIT 1`. Transition exactly one oldest-due decision `open → due` per sweep tick via `transitionDecision(id, 'open', 'due', { actor: 'sweep' })`. Matches success criterion 1.
- **D-02:** The deadline trigger runs in SQL Phase 1, parallel with silence and commitment triggers in the existing `Promise.all`. It's SQL-first (no Opus), cheap, and priority=2 slots naturally between silence=1 and commitment=3. The existing winner-by-priority logic handles ties.
- **D-03:** On `OptimisticConcurrencyError` (race with user reply), the sweep retries once. On `InvalidTransitionError` (decision already moved — e.g., user withdrew), the sweep skips silently and tries the next oldest-due. Follows Phase 13 D-14 error contract.

### Channel separation (SWEEP-02, guards C5)

- **D-04:** Two independent `last_sent` keys in `proactive_state`: `last_sent_reflective` and `last_sent_accountability`. Each channel checks its own key via channel-aware helpers in `state.ts`. Same JSONB KV pattern as the existing `last_sent` / `mute_until`.
- **D-05:** On same-day collision (both channels want to fire), accountability fires first (hard 24h window per SWEEP-01), then reflective fires independently — no waiting for Greg's reply to the accountability prompt. Both can land same day since they have independent caps. Neither blocks the other.
- **D-06:** Global mute (`mute_until`) suppresses **both** channels. No separate `/mute decisions` in Phase 15. Per-channel mute deferred to Phase 17 alongside the full `/decisions` command surface.
- **D-07:** Migration of existing `last_sent` key: the existing `last_sent` key becomes `last_sent_reflective`. A one-time migration renames it (or the code falls back to reading `last_sent` if `last_sent_reflective` doesn't exist yet).

### Stale-context prompts (SWEEP-04)

- **D-08:** When `now() - resolve_by > 48 hours`, the trigger context injected into the LLM prompt includes the absolute date: "On {resolve_by formatted as YYYY-MM-DD} you predicted: '{prediction}'. It's now {days} past your deadline." When ≤48h, the context says: "Your deadline just passed for a prediction you made: '{prediction}'." The LLM naturally frames its output based on this context.
- **D-09:** The 48h threshold is hardcoded as a constant (`STALE_CONTEXT_THRESHOLD_MS = 48 * 60 * 60 * 1000`) in the trigger file. One-line change if it ever needs tuning.

### Prompt generation

- **D-10:** The accountability channel uses **Sonnet** (same model tier as reflective outreach). The prompt is a nudge, not deep analysis. Phase 16's ACCOUNTABILITY mode may use a different tier for the actual resolution conversation, but the sweep prompt stays Sonnet.
- **D-11:** Language threading uses **Greg's most recent language** (from `getLastUserLanguage()`), consistent with existing `PROACTIVE_SYSTEM_PROMPT` behavior. The decision details (prediction text, falsification criterion) stay in their original `language_at_capture` regardless — they're quoted verbatim in the trigger context.
- **D-12:** A **distinct `ACCOUNTABILITY_SYSTEM_PROMPT`** is created in `src/proactive/prompts.ts` (or a new file — planner's call). Tone rules: cite original prediction and falsification criterion verbatim, no flattery, no condemnation, ask "what actually happened?" This is NOT the casual "friend checking in" frame of `PROACTIVE_SYSTEM_PROMPT` — it's neutral-factual accountability. The Hard Rule (D027) applies: never tie outcome to Greg-as-a-person.

### Claude's Discretion

- Whether the sweep's `runSweep()` function is refactored into channel-aware sub-functions or stays as one function with branching logic — planner's call on code organization.
- Exact wording of `ACCOUNTABILITY_SYSTEM_PROMPT` in EN — planner drafts, executor can tune. Must cite prediction + criterion verbatim, stay neutral, and ask a single open question.
- Whether the `last_sent` key migration is a one-time DB migration or handled by fallback logic in `state.ts` — planner's call.
- Index strategy on `decisions(status, resolve_by)` for the deadline query — planner can add if needed for performance at Greg-scale.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §Scheduler/Sweep — SWEEP-01, SWEEP-02, SWEEP-04 are in-scope for this phase.
- `.planning/ROADMAP.md` §"Phase 15: Deadline Trigger & Sweep Integration" — success criteria 1–4.

### Research
- `.planning/research/PITFALLS.md` §C5 (Scheduler Collision with Proactive Sweep) — the core architectural risk this phase addresses.
- `.planning/research/PITFALLS.md` §M3 (if present) — moderate pitfalls related to sweep.
- `.planning/research/ARCHITECTURE.md` — sweep integration points, trigger detector interface.
- `.planning/research/SUMMARY.md` §"Phase 3: Deadline Trigger & Sweep Integration" (if present).

### Prior-phase context (inherits decisions)
- `.planning/phases/13-schema-lifecycle-primitives/13-CONTEXT.md` — locks `transitionDecision()` chokepoint (D-04 legal transitions, D-14 error classes), `decision_capture_state` shape, `DECISION` epistemic tag.
- `.planning/phases/14-capture-flow/14-CONTEXT.md` — locks engine PP#0/PP#1 ordering (D-24), `language_at_capture` semantics (D-22), trigger detection architecture.

### PRD / Spec
- `M007_Decision_Archive.md` (project root) — the original M007 spec.
- `PRD_Project_Chris.md` (project root) — overall product context.

### Existing code patterns (reuse, do not reinvent)
- `src/proactive/triggers/types.ts` — `TriggerDetector` interface and `TriggerResult` type. New trigger must implement this exactly.
- `src/proactive/triggers/silence.ts` — template for SQL-first trigger implementation. Follow the same factory-function pattern (`createDeadlineTrigger()`).
- `src/proactive/sweep.ts` — the sweep orchestrator. Phase 1 SQL triggers run in `Promise.all`; winner selected by priority. This is where channel separation lands.
- `src/proactive/state.ts` — `hasSentToday()`, `setLastSent()`, `isMuted()` — extend with channel-aware variants.
- `src/proactive/prompts.ts` — `PROACTIVE_SYSTEM_PROMPT` with `{triggerContext}` placeholder. New `ACCOUNTABILITY_SYSTEM_PROMPT` follows the same pattern.
- `src/decisions/lifecycle.ts` — `transitionDecision()` chokepoint for `open → due` transition.
- `src/decisions/errors.ts` — `OptimisticConcurrencyError`, `InvalidTransitionError` — retry/skip logic in the trigger.

### Decisions log (PROJECT.md)
- D010 two-phase trigger execution — deadline trigger is SQL-first (Phase 1), no Opus.
- D015 proactive state in KV `proactive_state` table — channel-aware keys follow this pattern.
- D025 praise quarantine bypass pattern — accountability prompt follows COACH/PSYCHOLOGY precedent (forbid flattery at the prompt level).
- D027 The Hard Rule — explicitly applies to accountability prompt text.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`TriggerDetector` interface** (`src/proactive/triggers/types.ts`): exact contract for the new deadline trigger. Returns `TriggerResult` with `triggered`, `triggerType`, `priority`, `context`, `evidence`.
- **`createSilenceTrigger()` factory** (`src/proactive/triggers/silence.ts`): template for SQL-first trigger implementation — returns `TriggerDetector` with a `detect()` method, structured context string, evidence array.
- **`hasSentToday()` / `setLastSent()` / `isMuted()`** (`src/proactive/state.ts`): extend with channel-aware variants (`hasSentTodayReflective()`, `hasSentTodayAccountability()`, etc.).
- **`transitionDecision()`** (`src/decisions/lifecycle.ts`): the only legal way to move `open → due`. Handles optimistic concurrency.
- **`PROACTIVE_SYSTEM_PROMPT`** (`src/proactive/prompts.ts`): template for the new `ACCOUNTABILITY_SYSTEM_PROMPT`. Same `{triggerContext}` placeholder pattern but different tone rules.

### Established Patterns
- Sweep Phase 1 runs SQL triggers in `Promise.all` — new trigger slots in alongside silence and commitment.
- Winner selection by `priority` (lowest = highest). Existing: silence=1, commitment=2(?), pattern=3, thread=4. New: deadline=2 (between silence=1 and commitment=3 per success criterion 1).
- All proactive state lives in `proactive_state` KV table with JSONB values.
- Structured Pino logs at every sweep phase (`proactive.sweep.*`).

### Integration Points
- `src/proactive/sweep.ts::runSweep()` — main refactor target. Add channel separation logic, accountability cap check, trigger routing.
- `src/proactive/triggers/types.ts` — add `'decision-deadline'` to `triggerType` union.
- `src/proactive/state.ts` — add channel-aware helpers.
- `src/proactive/prompts.ts` — add `ACCOUNTABILITY_SYSTEM_PROMPT`.
- New file: `src/proactive/triggers/deadline.ts` — the `createDeadlineTrigger()` factory.

</code_context>

<specifics>
## Specific Ideas

- **Accountability fires first on collision.** The 24h hard window for decision-deadline (SWEEP-01) takes priority over reflective outreach which has no hard timing requirement. Both channels fire independently same day — no waiting for Greg's reply to one before sending the other.
- **Distinct prompt, not shared.** The "casual friend texting" frame of `PROACTIVE_SYSTEM_PROMPT` is wrong for accountability. The accountability prompt must be neutral-factual: cite prediction + criterion verbatim, ask "what happened?" No flattery, no condemnation.
- **Oldest-due-first, one per tick.** Multiple due decisions queue up across sweep ticks, not barrage Greg in one day. The accountability channel's daily cap naturally throttles this.
- **Key migration for last_sent.** Existing `last_sent` key becomes `last_sent_reflective`. Code should handle the migration gracefully (fallback to old key if new one doesn't exist yet).

</specifics>

<deferred>
## Deferred Ideas

- **`/mute decisions` per-channel mute** — deferred to Phase 17 alongside the full `/decisions` command surface. Phase 15 only has global mute.
- **Configurable stale-context threshold** — 48h is hardcoded per SWEEP-04. Can be made configurable later if needed.
- **Accountability channel daily cap > 1** — currently one per day matching reflective. Could allow 2/day for decision-heavy periods, but premature before real usage data.

</deferred>

---

*Phase: 15-deadline-trigger-sweep-integration*
*Context gathered: 2026-04-16*
