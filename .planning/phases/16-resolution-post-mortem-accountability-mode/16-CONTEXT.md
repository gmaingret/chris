# Phase 16: Resolution, Post-Mortem & ACCOUNTABILITY Mode - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

A resolution reply produces a neutral, Pensieve-grounded post-mortem that neither flatters a hit nor condemns a miss — or M007 inverts M006. Delivers:

- New `ACCOUNTABILITY` engine mode added to `ChrisMode` union, with own system prompt (`buildSystemPrompt('ACCOUNTABILITY', ...)`), own handler (`handleAccountability()`), praise quarantine bypass (D025 pattern), and constitutional preamble + explicit Hard Rule (D027).
- Resolution handler wired into engine PP#0: when `decision_capture_state.stage = AWAITING_RESOLUTION`, Greg's reply routes to the resolution handler instead of normal mode detection. Single-pass Sonnet generates acknowledgment, Haiku classifies outcome, Sonnet generates class-specific post-mortem question — all in one response turn.
- Post-mortem handler: when `stage = AWAITING_POSTMORTEM`, Greg's answer is stored in `resolution_notes`, transition `resolved → reviewed`, capture_state cleared, one-line acknowledgment sent.
- ±48h temporal Pensieve retrieval around `resolve_by` for resolution context (RES-05). Popper criterion included in system prompt context.
- Two Pensieve entries per resolution: Greg's reply + Chris's acknowledgment, both `DECISION`-tagged with `source_ref_id` pointing to the decision row.
- Auto-escalation: sweep checks AWAITING_RESOLUTION rows; 48h no reply → second prompt (acknowledges follow-up); another 48h no reply → silent `due → stale` transition. Prompt count tracked in `proactive_state`.

**Out of scope for Phase 16 (named explicitly to prevent creep):**
- `/decisions` list/stats/accuracy/reclassify → Phase 17.
- Synthetic-fixture end-to-end + live ACCOUNTABILITY Sonnet suite → Phase 18.
- Per-channel `/mute decisions` → Phase 17.

</domain>

<decisions>
## Implementation Decisions

### ACCOUNTABILITY mode shape

- **D-01:** ACCOUNTABILITY is a **new engine mode** — added to the `ChrisMode` union type in `engine.ts` and `personality.ts`. Own system prompt, own handler function (`handleAccountability()`). NOT a COACH extension.
- **D-02:** LLM tier = **Sonnet** for the resolution + post-mortem conversation. Resolution is factual comparison (prediction vs outcome), not deep psychological analysis. Haiku for outcome classification (hit/miss/ambiguous/unverifiable).
- **D-03:** ACCOUNTABILITY system prompt uses the **constitutional preamble + explicit Hard Rule reminder**. `buildSystemPrompt('ACCOUNTABILITY', ...)` prepends `CONSTITUTIONAL_PREAMBLE` (like all modes) AND adds an explicit line: "Never attribute the outcome to Greg's character or track record." Belts and suspenders.
- **D-04:** Praise quarantine **bypassed** for ACCOUNTABILITY — add to the `mode === 'COACH' || mode === 'PSYCHOLOGY'` check in `praise-quarantine.ts`. Matches D025 pattern. The prompt-level rules handle flattery prevention; the post-processor risks stripping legitimate neutral language.
- **D-05:** Pensieve retrieval for resolution = **±48h temporal query only**. No hybrid search, no relational memory. The decision row (prediction, criterion, reasoning) provides the core context. Temporal entries give surrounding life context cheaply.
- **D-06:** Epistemic tag for all resolution/post-mortem Pensieve entries = **DECISION**. Reuses the Phase 13 tag. Keeps all decision lifecycle entries under one tag for retrieval.

### Resolution handler flow

- **D-07:** Resolution handler = **single-pass Sonnet**. Greg's reply goes to Sonnet with the ACCOUNTABILITY system prompt + decision context (prediction, criterion, ±48h Pensieve, Popper criterion). One Sonnet call generates the acknowledgment. Then Haiku classifies, then Sonnet generates the post-mortem question. All in one response turn.
- **D-08:** Language = **Greg's reply language** via `getLastUserLanguage()` / `franc` on the resolution reply. Prediction and falsification criterion are **quoted verbatim in their original `language_at_capture`** regardless. Matches existing engine language-threading behavior.
- **D-09:** Pensieve writes = **two separate entries**, fire-and-forget. Greg's resolution reply = one entry (tag `DECISION`, `source_ref_id = decision.id`). Chris's acknowledgment = second entry (tag `DECISION`, `source_ref_id = decision.id`). Embedding happens async. Matches existing fire-and-forget contract (D005).
- **D-10:** Resolution → post-mortem = **immediate same-turn**. The resolution handler does all steps in one message turn: (1) Sonnet acknowledgment, (2) `transitionDecision(id, 'due', 'resolved')`, (3) write `resolution` text to `decisions` row, (4) update `decision_capture_state` to `AWAITING_POSTMORTEM`, (5) Haiku outcome classification, (6) Sonnet generates class-specific post-mortem question. Greg sees a two-part reply: acknowledgment + follow-up question.

### Post-mortem follow-up

- **D-11:** Post-mortem follow-up questions are **class-specific**:
  - `hit`: "What did you see that others missed?"
  - `miss`: "What would you do differently knowing what you know now?"
  - `ambiguous`: "What would settle this conclusively?"
  - `unverifiable`: "Is there any way to know, or was this inherently untestable?"
  - Each localized to Greg's reply language (EN/FR/RU).
- **D-12:** Haiku outcome classification input = **Greg's reply + original prediction + falsification criterion** together. Classification is a comparison judgment — needs both sides to determine hit/miss/ambiguous/unverifiable.
- **D-13:** Post-mortem answer handling = **silent store + short ack**. Greg's post-mortem answer is stored in `resolution_notes`, `transitionDecision(id, 'resolved', 'reviewed')`, `clearCapture(chatId)`, then a one-line acknowledgment ("Noted." / "Noté." / "Принято." in Greg's language). No reflective response, no further conversation. The decision is now fully reviewed.
- **D-14:** Popper criterion display = **in system prompt context**. The falsification criterion is included in the ACCOUNTABILITY system prompt's context block alongside the prediction. Sonnet naturally weaves it into the acknowledgment. Not shown as a separate explicit quote — just prompt context that Sonnet uses.

### Auto-escalation & stale (RES-06)

- **D-15:** 48h timer = **sweep tick checks proactive_state timestamp**. When the sweep fires the accountability prompt, record send time in `proactive_state` (keyed per decision, e.g. `accountability_sent_<decisionId>`). Each sweep tick checks: if `AWAITING_RESOLUTION` row exists AND 48h have passed AND no Greg reply → fire second prompt. Reuses existing sweep cadence, no new cron.
- **D-16:** Non-reply counting = **prompt count in proactive_state**. Track `accountability_prompt_count_<decisionId>` in proactive_state. First prompt = 1. After 48h no reply, second prompt = 2. After another 48h no reply, `transitionDecision(id, 'due', 'stale')`. Simple counter, sweep checks it each tick.
- **D-17:** Stale transition = **silent**. No message to Greg. Two ignored prompts = Greg didn't engage; a third message is noise. `/decisions` (Phase 17) will still show the stale decision.
- **D-18:** Second prompt = **acknowledges follow-up**. Different from the first: includes context like "A couple days ago I asked about your prediction on X. Still curious what happened." Feels natural, not robotic. Uses a distinct prompt template or trigger context string.

### Claude's Discretion

- Exact file organization for the resolution/post-mortem handler code (`src/decisions/resolution.ts` vs `src/chris/modes/accountability.ts` vs combined).
- ±48h Pensieve retrieval implementation (direct SQL query vs extending `searchPensieve` with a time-window option).
- Exact EN/FR/RU wording of class-specific post-mortem questions and the one-line acknowledgments — planner drafts, executor can tune.
- Whether the same-turn two-part reply is a single concatenated string or two sequential messages to the Telegram API.
- How `proactive_state` keys for per-decision escalation tracking are named and cleaned up after stale/reviewed transitions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §Resolution (RES-01 through RES-06) — all in-scope requirements for this phase.
- `.planning/ROADMAP.md` §"Phase 16: Resolution, Post-Mortem & ACCOUNTABILITY Mode" — success criteria 1–5.

### Research
- `.planning/research/PITFALLS.md` §C7 (Sycophantic Post-Mortems) — the core anti-pattern this phase prevents.
- `.planning/research/PITFALLS.md` §M2 (if present) — moderate pitfalls related to resolution.
- `.planning/research/ARCHITECTURE.md` — resolution handler placement, mode extension patterns.
- `.planning/research/SUMMARY.md` §"Phase 4: Resolution + ACCOUNTABILITY" (if present).

### Prior-phase context (inherits decisions)
- `.planning/phases/13-schema-lifecycle-primitives/13-CONTEXT.md` — locks `transitionDecision()` chokepoint (D-04 legal transitions including `due→resolved`, `resolved→reviewed`, `due→stale`), `decision_events` append-only invariant, error classes (D-14), nullable `resolution`/`resolution_notes` columns (D-12).
- `.planning/phases/14-capture-flow/14-CONTEXT.md` — locks engine PP#0/PP#1 ordering (D-24), `decision_capture_state` shape, `AWAITING_RESOLUTION`/`AWAITING_POSTMORTEM` stages (D-16), `language_at_capture` semantics (D-22).
- `.planning/phases/15-deadline-trigger-sweep-integration/15-CONTEXT.md` — locks `ACCOUNTABILITY_SYSTEM_PROMPT` (sweep version), channel separation, `upsertAwaitingResolution()` helper, stale-context dating (D-08/D-09).

### PRD / Spec
- `M007_Decision_Archive.md` (project root) — the original M007 spec.
- `PRD_Project_Chris.md` (project root) — overall product context.

### Existing code patterns (reuse, do not reinvent)
- `src/chris/engine.ts` (PP#0 lines 163–192) — existing AWAITING_RESOLUTION/AWAITING_POSTMORTEM branch with TODO comment for Phase 16.
- `src/chris/praise-quarantine.ts` (line 82) — COACH/PSYCHOLOGY bypass pattern; add ACCOUNTABILITY here.
- `src/chris/personality.ts` — `buildSystemPrompt()` with CONSTITUTIONAL_PREAMBLE; extend for ACCOUNTABILITY mode.
- `src/chris/modes/coach.ts` — template for a new mode handler (Opus tier; ACCOUNTABILITY uses Sonnet but same structure).
- `src/decisions/lifecycle.ts` — `transitionDecision()` chokepoint for `due→resolved`, `resolved→reviewed`, `due→stale`.
- `src/decisions/capture-state.ts` — `getActiveDecisionCapture()`, `upsertAwaitingResolution()`, `clearCapture()`.
- `src/proactive/state.ts` — `proactive_state` KV helpers; extend for per-decision escalation tracking.
- `src/proactive/prompts.ts` — existing `ACCOUNTABILITY_SYSTEM_PROMPT` (sweep version); Phase 16 adds a resolution-conversation version.
- `src/pensieve/retrieve.ts` — `searchPensieve()` / `hybridSearch()` for ±48h temporal retrieval.

### Decisions log (PROJECT.md)
- D001 three-tier LLM — Sonnet for ACCOUNTABILITY resolution conversation, Haiku for outcome classification.
- D004 append-only Pensieve — resolution/post-mortem entries extend the invariant.
- D005 fire-and-forget side effects — Pensieve writes for resolution are fire-and-forget.
- D025 praise quarantine bypass pattern — ACCOUNTABILITY follows COACH/PSYCHOLOGY precedent.
- D027 The Hard Rule — explicitly forbidden in ACCOUNTABILITY system prompt.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **PP#0 branch structure** (`engine.ts:179-192`): already checks for AWAITING_RESOLUTION/AWAITING_POSTMORTEM with a "Phase 16 will handle" comment. Phase 16 fills in the handler calls.
- **`upsertAwaitingResolution()`** (`capture-state.ts:88`): Phase 15 already writes the AWAITING_RESOLUTION row before the sweep sends the prompt. Phase 16 reads this row in PP#0.
- **`transitionDecision()` chokepoint** (`lifecycle.ts:75`): `due→resolved` and `resolved→reviewed` transitions already in the legal map. Phase 16 calls these.
- **`quarantinePraise()` bypass** (`praise-quarantine.ts:82`): `mode === 'COACH' || mode === 'PSYCHOLOGY'` check. Phase 16 adds `|| mode === 'ACCOUNTABILITY'`.
- **`CONSTITUTIONAL_PREAMBLE`** (`personality.ts:28`): shared anti-sycophancy preamble. ACCOUNTABILITY mode gets this + explicit Hard Rule reminder.
- **`buildSystemPrompt(mode, ...)`** (`personality.ts:77`): extend the mode-to-prompt map for ACCOUNTABILITY.
- **`ACCOUNTABILITY_SYSTEM_PROMPT`** (`proactive/prompts.ts:39`): sweep version already exists. Phase 16 adds a resolution-conversation version (different — this is the Sonnet conversation prompt, not the sweep nudge prompt).
- **`proactive_state` KV pattern** (`state.ts`): `hasSentToday()`, `setLastSent()` — extend with per-decision escalation keys.

### Established Patterns
- Mode handlers follow a consistent structure: hybrid search → context build → Sonnet/Opus call → return response. ACCOUNTABILITY's handler is simpler (temporal query, not hybrid search).
- Praise quarantine bypass is mode-level, not per-call. Adding ACCOUNTABILITY to the bypass set is a one-line change.
- Pensieve writes use `source_ref_id` for provenance linking (existing pattern from source sync).
- Engine PP#0 runs before mute/refusal/language/mode — resolution routing is already in the right position.

### Integration Points
- `src/chris/engine.ts::processMessage()` — fill in the AWAITING_RESOLUTION and AWAITING_POSTMORTEM branches in PP#0.
- `src/chris/personality.ts` — add ACCOUNTABILITY to `ChrisMode` type and `buildSystemPrompt()` map.
- `src/chris/praise-quarantine.ts` — add ACCOUNTABILITY to bypass check.
- `src/decisions/capture-state.ts` — may need `updateToAwaitingPostmortem()` helper.
- `src/proactive/sweep.ts` — add escalation logic: check AWAITING_RESOLUTION age, fire second prompt, transition to stale.
- `src/proactive/state.ts` — add per-decision escalation tracking helpers.
- New file(s): resolution handler (`src/decisions/resolution.ts` or `src/chris/modes/accountability.ts`).

</code_context>

<specifics>
## Specific Ideas

- **Same-turn resolution + post-mortem.** Greg replies to the accountability prompt → sees acknowledgment + post-mortem question in one response. No waiting for a sweep tick or a second message from Greg. The entire resolution conversation is two turns: (1) Greg says what happened, (2) Greg reflects on why. Minimizes friction.
- **Class-specific post-mortem questions are load-bearing.** "What did you see that others missed?" (hit) vs "What would you do differently?" (miss) vs "What would settle this?" (ambiguous) vs "Is there any way to know?" (unverifiable) — each targets a different epistemic failure mode. A universal question loses this signal.
- **Silent stale transition after 2 non-replies.** The worst possible UX is three ignored messages. Two is the limit. After that, Chris stops trying and the decision ages to stale. `/decisions` (Phase 17) will still surface it if Greg wants to revisit.
- **Second prompt acknowledges the follow-up.** "A couple days ago I asked about your prediction on X" — not a robotic repeat. Feels like a friend checking in again, not a system notification.
- **±48h Pensieve, not hybrid search.** The decision row itself has the prediction, criterion, reasoning. The temporal window adds surrounding life context (what else was going on). No need for semantic search — the query is the decision, not a topic.
- **Popper criterion in prompt context, not explicit quote.** Sonnet naturally weaves it in. Explicit "Your test was: ..." feels mechanical and breaks the conversational frame.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-question post-mortems** — explicitly rejected by OOS-M007-04 (Duke/Parrish: one open question outperforms structured forms).
- **Opus for post-mortem depth** — deferred; Sonnet handles factual comparison fine. Revisit if post-mortem quality proves shallow in real use.
- **Hybrid search for resolution context** — deferred; ±48h temporal is sufficient. Add if post-mortems lack context in practice.
- **Per-channel `/mute decisions`** — deferred to Phase 17 alongside full `/decisions` surface.
- **Resolution edit/retry** — rejected (OOS-M007-03 spirit; resolution is what Greg said at the time).
- **Stale → open revival** — rejected; terminal states have no outgoing edges (Phase 13 D-04).

</deferred>

---

*Phase: 16-resolution-post-mortem-accountability-mode*
*Context gathered: 2026-04-16*
