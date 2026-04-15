# Phase 14: Capture Flow — Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

A structural decision mentioned in any of Greg's three languages becomes a durable, falsifiable `decisions` row without the capture conversation ever feeling like an interrogation. Delivers:

- Two-phase detection: `src/decisions/triggers.ts` — Phase A bilingual regex (EN/FR/RU, PRD phrases + negative-lookbehind meta-guards); Phase B Haiku stakes classifier (`trivial`/`moderate`/`structural`) — only `structural` activates capture (guards C3).
- Conversational 5-slot capture: `src/decisions/capture.ts` — single greedy Haiku structured-output pass per user turn fills any of `{DECISION, ALTERNATIVES, REASONING, PREDICTION, FALSIFICATION}` slots from the draft jsonb; canonical stage-order drives question emission but any slot is acceptable any turn.
- Engine wiring: pre-processor #0 (active `decision_capture_state` check) and #1 (trigger detection) in `src/chris/engine.ts`, both running BEFORE mute/refusal/language/mode (SWEEP-03).
- `resolve_by` natural-language parsing (Haiku + 7/30/90/365d fallback ladder surfaced as clarifier, not silent fallback).
- Vague-prediction validator: one pushback at the FALSIFICATION slot, Haiku judgment seeded by hedge-word prior; second-vague → `open-draft`.
- `open-draft` partial-commit path (CAP-04) for 3-turn-cap exits and second-vague exits.
- `/decisions suppress <phrase>` sub-command (CAP-06 minimum — phrase-only, case-insensitive substring).
- Contradiction detection (LIFE-05) extended to new `decisions.reasoning` entries at first `open` commit, fire-and-forget, 0.75/3s per existing detector.
- `language_at_capture` populated from `franc` run on the triggering message.
- Abort set (EN/FR/RU) dismisses mid-capture cleanly.

**Out of scope for Phase 14 (named explicitly to prevent creep):**
- Deadline trigger / sweep channel separation → Phase 15.
- Resolution handler, post-mortem, ACCOUNTABILITY mode → Phase 16.
- `/decisions` list/stats/accuracy/unsuppress → Phase 17.
- Synthetic-fixture end-to-end + live Sonnet suite → Phase 18.

</domain>

<decisions>
## Implementation Decisions

### Trigger regex & meta-guards (CAP-01 Phase A)

- **D-01:** Phase A regex trigger set = **PRD phrases only** (initial ship), in one shared fixture file. Tune after real usage.
  - EN: `I'm thinking about`, `I need to decide`, `I'm weighing`, `I'm not sure whether`.
  - FR: `je réfléchis à`, `je dois décider`, `j'hésite`.
  - RU: `я думаю о`, `мне нужно решить`, `я колеблюсь`.
  - Extensions (e.g. "should I", "devrais-je", "стоит ли") explicitly deferred.
- **D-02:** Meta-reference guards implemented as **hard negative-lookbehind regex** — e.g. `/(?<!\bnot |n'ai pas |\bне )I'm thinking about/i`. No Haiku call needed to reject obvious negations. Mirrors `refusal.ts` pattern discipline.
- **D-03:** Cardinality CI guard = **shared fixture count parity** — one fixture file with N positive + M negative phrases per language; test asserts `|EN| == |FR| == |RU|` so translations stay in lockstep. No per-phrase semantic-id parity (deferred).
- **D-04:** Abort-phrase set (final for Phase 14):
  - EN: `never mind`, `nevermind`, `stop`, `skip`.
  - FR: `annule`, `laisse tomber`, `oublie`.
  - RU: `отмена`, `забудь`, `пропусти`.
  - Matching = case-insensitive word/prefix match against the full user message (after trim). No Haiku abort-intent fallback — that's future work if the phrase set proves too narrow.

### Haiku stakes classifier (CAP-01 Phase B)

- **D-05:** Prompt shape = **tier definitions + 3 positive examples per tier** drawn from Greg's likely domains (work, relationships, finances). Negative examples deferred (rely on negative-lookbehind regex in Phase A to filter obvious non-decisions before Phase B ever runs).
  - Tier definitions:
    - `structural` — reversible only at high cost; affects months+ (job change, relationship direction, major purchase/move, health commitment).
    - `moderate` — consequential but reversible in weeks (project selection, learning investment, short-term schedule change).
    - `trivial` — daily/reversible (what to eat, which show to watch, minor task choices).
  - Only `structural` activates capture.
- **D-06:** Failure mode = **fail-closed**. On Haiku timeout, parse error, or any exception → treat as `trivial` → do not activate capture → fall through to normal engine flow. Mirrors `detectMode()` default-to-JOURNAL discipline; protects C3 (over-triggering hijack). Greg can retry by rephrasing if genuinely structural.
- **D-07:** **No caching.** Each regex match runs Haiku fresh. Cost negligible at Greg-scale (~5–20 structural candidates/week × Haiku-tier pricing); avoids stale-classification bugs as the prompt evolves.
- **D-08:** Timeout = **3 s hard cap**, matching the existing contradiction-detection convention (`detectContradictions` 3s). Fail-closed on expiry per D-06.

### Conversational capture shape (CAP-02)

- **D-09:** Extraction = **single greedy Haiku structured-output pass per user turn.** Input = current draft jsonb + user's reply + canonical slot schema. Output = updated draft jsonb with any newly filled slots. Handles one-message multi-answer natively (core C1 mitigation). One Haiku call per capture turn, not one per slot.
- **D-10:** Stage ordering = **suggested canonical order (`DECISION → ALTERNATIVES → REASONING → PREDICTION → FALSIFICATION`), any-slot accepted.** Chris asks for the next-unfilled-slot-in-canonical-order; extractor accepts ANY slot filled from ANY reply. Greg can volunteer ahead ("my reasoning is X and my prediction is Y") without being told to wait.
- **D-11:** 3-turn follow-up cap behavior = **auto-commit as `open-draft` silently.** After 3 unsuccessful follow-up turns (extractor still has unfilled required slots), write `decisions` row with `status='open-draft'`, append a `decision_events` row via `transitionDecision()`, write Pensieve entry tagged `DECISION`, clear `decision_capture_state`. No confirmation prompt. Greg's 3rd reply is the last capture turn.
- **D-12:** Re-trigger mid-capture = **ignored. Stay on current capture.** Pre-processor #0 sees active `decision_capture_state` row and routes to `handleCapture(chatId, text, state)` regardless of whether this turn's text matches a trigger phrase. Greg's words become input to the current slot. If it was genuinely a new decision, the current capture will age out via 3-turn cap → open-draft, and next turn's trigger can re-fire cleanly.

### Vague-prediction validator (CAP-02, guards C2)

- **D-13:** Vagueness detection = **Haiku judgment with hedge-word prior.** Hedge words (`probably`, `fine`, `better`, `somehow`, `likely`, `peut-être`, `sans doute`, `наверное`, `возможно`, ...) seed the check — their presence nudges Haiku toward "vague" — but Haiku evaluates `prediction + falsification_criterion` together with the question "is this falsifiable by a concrete observable event?" Catches semantic vagueness ("it'll go well") that has no hedge word.
- **D-14:** Pushback UX = **one round, at the FALSIFICATION slot.** Validator runs once, AFTER both PREDICTION and FALSIFICATION slots are filled by the extractor. If verdict = vague, Chris asks exactly one clarifying question: *"What would make you say this turned out right or wrong?"* (localized). The next user reply is accepted regardless of vagueness verdict — no second pushback. Honors CAP-03 cap / anti-interrogation ethos.
- **D-15:** Second-vague landing status = **`open-draft`.** If the validator still reads vague after the one pushback, the row is committed with `status='open-draft'` rather than `open`. Its `falsification_criterion` still holds whatever text Greg gave (NOT NULL invariant preserved). Greg can refine later or the draft ages out. Never force-accept to `open` (would let vague predictions inflate future accuracy stats, inverting C2).

### `/decisions suppress` (CAP-06)

- **D-16:** Phase-14 surface = **`/decisions suppress <phrase>` only.** Stores trimmed lowercase string in a new `decision_trigger_suppressions` table (or equivalent — planner's call on schema location; simplest = single-column text list keyed by chat_id). Trigger regex Phase A skips any match where the containing message's text contains a suppressed substring (case-insensitive). No id-based suppression. No `/decisions list-suppressions`. No `/decisions unsuppress`. These land in Phase 17 alongside the full `/decisions` command surface.
- **D-17:** Persistence = DB-backed (not in-memory). Substring match is case-insensitive and applied to the full user message before regex evaluation.

### `resolve_by` natural-language parsing (CAP-05)

- **D-18:** Parser = **Haiku structured-output, ladder on fail.** Haiku (2 s timeout, structured output) parses Greg's timeframe reply to an absolute `timestamptz`. Examples: "next week" → +7 d, "in 3 months" → +90 d, "by June" → next June-01, "end of year" → Dec-31 current year.
- **D-19:** Fallback on Haiku error/unparseable reply = **one clarifier turn**, NOT a silent ladder. Chris asks: *"When should I check back — a week, a month, three months, or a year?"* (the 7/30/90/365 d ladder surfaced as an explicit menu). If Greg answers with any of those, map to `+Nd`. If still unparseable after clarifier → default to `+30 d` explicitly, with Chris saying "I'll check back in a month — you can change this later." No silent defaults.

### LIFE-05 contradiction detection on `decisions.reasoning`

- **D-20:** Fires **exactly once**, on the **first commit that lands the row at `status='open'`** (NOT on `open-draft` commits — partial reasoning is too noisy). Fire-and-forget (no await); reuses `detectContradictions()` from `src/chris/engine.ts`; 0.75 confidence threshold; 3 s timeout — all existing conventions (D-LIFE-05 locked those values). No re-scan when a draft later promotes to `open` (see D-23).
- **D-21:** If contradictions detected, they surface via the existing `formatContradictionNotice` path in Chris's next normal turn with Greg — not during the capture conversation itself.

### `language_at_capture`

- **D-22:** Populated at capture-open time (first successful trigger + stakes activation) by running `franc` on **the exact triggering message** (the one containing the decision phrase). Stored on the draft, copied into `decisions.language_at_capture` at first commit. Never updated afterwards. Drives Phase-16 resolution prompt language (RES-02) even if Greg's chat language drifts over the weeks between capture and deadline.

### `open-draft → open` promotion path

- **D-23:** Promotion happens **only during an active capture conversation** when all required slots get filled. No background sweep, no "oh Greg later mentioned the falsification criterion" magic, no manual `/decisions promote` command in Phase 14. Drafts either finish within the same capture flow (3-turn cap) or age out to `abandoned` (via Phase-13's 24 h GC). Mirrors D-05 / D-06 of Phase 13's "no implicit transitions" ethos.

### Engine pre-processor ordering (SWEEP-03)

- **D-24:** Two new pre-processors added to `src/chris/engine.ts` in this exact order, BEFORE existing mute/refusal/language/mode detection:
  1. **PP#0 — capture-state check.** `getActiveDecisionCapture(chatId)` → if row exists in `CAPTURING` / `AWAITING_RESOLUTION` / `AWAITING_POSTMORTEM`, route to the appropriate handler. (Phase 14 implements the `CAPTURING` handler; Phase 16 fills resolution/post-mortem handlers but the branch structure ships here.)
  2. **PP#1 — decision-trigger detection.** Phase A regex → Phase B Haiku stakes. On `structural`: open capture state, send Q1, save, return. On anything else: fall through.
- **D-25:** Abort phrase check is evaluated **inside** PP#0 (handler entry) — it clears the active capture state and falls through to normal engine flow rather than being a separate top-level pre-processor.

### Claude's Discretion

- Exact Drizzle schema for `decision_trigger_suppressions` (single-column text list vs structured per-chat table with timestamps) — planner's call.
- Whether `resolve_by` Haiku parser is colocated in `capture.ts` or a dedicated `src/decisions/resolve-by.ts` — colocate unless tests argue otherwise.
- Prompt wording for the one vague-pushback question and the resolve-by clarifier question in each of EN/FR/RU — planner drafts, executor can tune; must preserve neutrality (no leading language).
- Whether stakes-classifier Haiku call runs in parallel with the next Chris response pipeline or inline (latency vs simplicity) — default inline unless profiling shows noticeable lag.
- File split within `src/decisions/` for capture-layer code (one `capture.ts` vs multiple) — planner's call.

### Folded Todos

None folded — no pending todos matched Phase 14 scope.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §Capture (CAP-01 through CAP-06), §Lifecycle (LIFE-05), §Sweep (SWEEP-03) — all in-scope requirements for this phase.
- `.planning/ROADMAP.md` §"Phase 14: Capture Flow" — success criteria 1–5.

### Research (all directly applicable)
- `.planning/research/ARCHITECTURE.md` §2a (trigger-phrase pre-processor placement), §2b (capture-state table — locked in Phase 13), §4 (new vs modified components — especially `src/decisions/triggers.ts` + `capture.ts`), §5 Phase 2 build order.
- `.planning/research/SUMMARY.md` §"Critical Pitfalls" C1/C2/C3 and §"Phase 2: Capture Flow".
- `.planning/research/PITFALLS.md` — C1 (interrogation), C2 (vague-prediction), C3 (over-triggering hijack) mitigations.
- `.planning/research/FEATURES.md` — capture-feature expectation table.
- `.planning/research/STACK.md` — Haiku structured-output, franc 6.2.0 EN/FR/RU detection, Drizzle 0.45.2.

### Prior-phase context (inherits decisions)
- `.planning/phases/13-schema-lifecycle-primitives/13-CONTEXT.md` — locks `decision_capture_state` shape (D-15), stage enum (D-16), `open-draft` status, `transitionDecision()` chokepoint, `language_at_capture` column definition (D-12), `DECISION` epistemic tag (D-17), error classes (D-14), two-error-class invariant, regeneration function.

### PRD / Spec
- `M007_Decision_Archive.md` (project root) — the original M007 spec; trigger phrase seed list + 5-question protocol.
- `PRD_Project_Chris.md` (project root) — overall product context.

### Existing code patterns (reuse, do not reinvent)
- `src/chris/refusal.ts` — template for bilingual regex + franc threading; shape for Phase A trigger detection.
- `src/chris/language.ts` — `detectLanguage`, `getLastUserLanguage`, `setLastUserLanguage`; `franc` wrapper reused by D-22.
- `src/chris/engine.ts` (pre-processor chain lines ~60–200) — exact shape to extend for PP#0 and PP#1.
- `src/chris/contradiction.ts` / `detectContradictions()` — reused verbatim for LIFE-05 on `decisions.reasoning` (D-20).
- `src/decisions/lifecycle.ts` + `src/decisions/errors.ts` — Phase-13 chokepoint; every `decisions` mutation MUST go through `transitionDecision()`.
- `src/decisions/capture-state.ts` — Phase-13 `getActiveDecisionCapture(chatId)` helper; Phase 14 extends with write helpers.
- `src/proactive/triggers/types.ts` — `TriggerResult.triggerType` union (Phase 15 adds `'decision-deadline'`; Phase 14 does NOT touch this).
- `src/llm/client.ts` + `HAIKU_MODEL` — Haiku structured-output invocation pattern (see `detectMode()` for structured-output + timeout + fail-default convention).

### Decisions log (PROJECT.md)
- D001 three-tier LLM — Haiku for stakes classification, capture extraction, vague-validator, resolve-by parser.
- D010 two-phase trigger execution — directly instantiated here (regex → Haiku stakes).
- D020 deterministic pre-processors over Haiku where possible — Phase A regex + negative lookbehind before Phase B Haiku.
- D021 `franc` language detection — D-22 language_at_capture uses it.
- D017/D018/D019 per-phase commits, no skipped tests, explicit production deploy — applied as usual.
- D027 The Hard Rule — NOT applicable to capture conversation (applies to ACCOUNTABILITY mode / Phase 16).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`refusal.ts` bilingual-regex template** (`src/chris/refusal.ts` — 193 lines): exact shape for Phase A trigger regex + meta-guards. Follow the same franc-thread + per-language pattern constant style.
- **`detectContradictions()` + `formatContradictionNotice()`** (`src/chris/contradiction.ts`, used in `engine.ts`): reused verbatim for LIFE-05 scan on `decisions.reasoning` (fire-and-forget, 0.75/3 s already hardcoded).
- **`detectMode()` pattern** (`src/chris/engine.ts`): template for Haiku structured-output call with timeout + fail-default — reused for stakes classifier (fail-closed to `trivial`), capture extractor, vague-validator, resolve-by parser.
- **`getActiveDecisionCapture(chatId)` helper** (`src/decisions/capture-state.ts` — Phase 13): PP#0 entry point. Phase 14 adds matching write helpers (create/update/clear).
- **`transitionDecision()` chokepoint** (`src/decisions/lifecycle.ts` — Phase 13): only legal write path for `decisions.status`. Capture commits go through this (`null → open-draft` or `null → open`).
- **`gen_random_uuid()` default + `pgEnum` pattern** (`src/db/schema.ts` lines 20–178): for the new `decision_trigger_suppressions` table.
- **`franc` wrapper** (`src/chris/language.ts`): drives `language_at_capture` per D-22.

### Established Patterns
- Pre-processor chain order in `engine.ts` is linear and explicit — new pre-processors are inserted at the top of the file's `processMessage()` function body. PP#0 goes FIRST (before `isAwaitingOAuthCode` check or at least adjacent to it).
- Haiku calls use `HAIKU_MODEL` constant from `src/llm/client.ts` with `max_tokens` tight (< 200 for classifiers), structured output via JSON schema in system prompt, 2–3 s timeouts, fail-soft defaults.
- Pensieve writes happen via `writeRelationalMemory()` for conversation-derived entries; capture-commit writes a Pensieve entry tagged `DECISION` to prevent the INTENTION-only commitment trigger from double-firing (LIFE-06, already shipped in Phase 13).
- All new timestamps use `timestamp('...', { withTimezone: true })` — no naive timestamps anywhere.
- Tests: live Postgres via Docker (user feedback memory "Always run full Docker tests"); Vitest 4.1; fake timers for deadline-adjacent tests only (Phase 15 territory, not 14).

### Integration Points
- `src/chris/engine.ts::processMessage()` — two new pre-processors inserted at top (PP#0: active-capture check; PP#1: trigger detection). Ordering matters: PP#0 MUST precede mute/refusal/language/mode.
- `src/decisions/capture-state.ts` — extend with `createCaptureDraft()`, `updateCaptureDraft()`, `clearCapture()` helpers. Schema already shipped Phase 13.
- `src/decisions/lifecycle.ts` — no changes; just called by `handleCapture()` to commit.
- `src/db/schema.ts` — one new table (`decision_trigger_suppressions` or equivalent), one migration. No changes to `decisions`/`decision_events`/`decision_capture_state` shapes.
- `src/bot/` — new slash-command handler for `/decisions suppress <phrase>`. Mirrors existing slash-command handler pattern; planner confirms exact file location.
- NO changes to `src/proactive/` in this phase (that's Phase 15).

</code_context>

<specifics>
## Specific Ideas

- **Regex + Haiku, not Haiku alone.** Greg explicitly wants the deterministic regex gate ahead of Haiku — cost control + C3 mitigation + debuggability. The Phase B stakes classifier never runs if Phase A doesn't hit.
- **Fail-closed everywhere on Haiku.** Stakes classifier, vague validator, resolve-by parser — all default in the "don't interrupt Greg" direction on timeout/error. Over-triggering is a worse failure mode than under-triggering here (C3).
- **Anti-interrogation discipline is load-bearing.** Single greedy-extract, 3-turn hard cap, one-round vague pushback, silent open-draft on cap/vague — every design choice favors "let Greg talk like a human" over "capture all five slots perfectly". If forced to choose, we ship incomplete data (`open-draft`) over pressuring him.
- **Stages suggested, not enforced.** Chris asks the next-unfilled canonical slot but the extractor accepts any slot from any reply. Greg's one-shot "I'm weighing quitting vs. pivoting; probably pivot; know in a month if sales catch" should extract DECISION + ALTERNATIVES + PREDICTION + resolve_by all from one message.
- **Meta-guards are regex-level, not Haiku-level.** "I'm not thinking about dinner" never reaches Phase B — negative lookbehind kills it. Keeps the Haiku call count low and makes debugging trivial (fixture tests on the regex).
- **`open-draft → open` has no magic path.** Drafts either finish in-session or die to `abandoned` via the Phase-13 24 h GC. Greg's not expected to "remember to come back"; Phase 17 can add a "draft lineage" UI later if it proves useful.
- **Resolve-by fallback ladder is a CLARIFIER, not a silent default.** When Haiku fails, Greg sees the 7/30/90/365 d menu — he picks consciously. The only silent default (+30 d after clarifier also fails) is loudly announced in the reply text.

</specifics>

<deferred>
## Deferred Ideas

- **Extended trigger phrase set** ("should I", "devrais-je", "стоит ли", etc.) — ship PRD-only first; tune once we see the real Greg hit-rate.
- **Haiku abort-intent fallback** ("ugh forget it" not in phrase set) — future work if abort phrase set proves too narrow.
- **Negative examples in stakes classifier prompt** — deferred; rely on negative-lookbehind regex in Phase A to filter obvious non-decisions first.
- **Id-based `/decisions suppress id:<uuid>`** — Phase 17 alongside `/decisions list-suppressions` + `/decisions unsuppress`.
- **Full CRUD for suppression (`list` / `unsuppress`)** — Phase 17.
- **Sweep-based open-draft → open auto-promotion** — rejected; no implicit transitions.
- **Manual `/decisions promote <id>` command** — rejected for Phase 14; re-evaluate in Phase 17 if drafts accumulate in practice.
- **Cache stakes classifications by phrase hash** — rejected; cost is negligible and cache risks stale verdicts as prompts evolve.
- **Per-phrase semantic-id parity across EN/FR/RU** — weaker count-parity guard chosen; semantic-id mapping can come later if fixtures drift.
- **Two rounds of vague-prediction pushback** — rejected; fights interrogation ethos.

</deferred>

---

*Phase: 14-capture-flow*
*Context gathered: 2026-04-15*
