# Domain Pitfalls — M007 Decision Archive

**Domain:** Decision capture + forecast accountability layered onto an existing personal AI (Chris) with append-only Pensieve, anti-sycophancy guardrails (M006), and a proactive-sweep scheduler (M004).
**Researched:** 2026-04-15
**Confidence:** MEDIUM-HIGH. Ecosystem evidence (Tetlock, decision journals) is well-established; Chris-specific integration pitfalls are derived from reading PROJECT.md + M007 spec + M006 decisions D024–D033. Prevention mappings cite specific phases/requirements the downstream roadmapper should create.

Scope note: This file catalogues pitfalls **specific to adding M007 to THIS codebase**. Generic CRUD / SQL / TypeScript pitfalls are excluded — they're covered by existing patterns from M001–M006.

---

## Critical Pitfalls

Mistakes that cause rewrites, trust collapse, or make the feature actively worse than no feature at all.

### C1: The Interrogation Failure Mode (Capture UX)

**What goes wrong:** 5-question capture protocol is implemented as a rigid script: Chris blocks until Greg answers each question in sequence, numbered "Q1/5", "Q2/5", etc. Greg mentioned a decision once, got put through a scripted drill, and never triggered capture again. Decisions go back underground.

**Why it happens:** Natural language of decision-making is associative and doubles back ("actually the real alternative is..."). A rigid question flow refuses to honour the way decisions are actually reasoned. The "5 questions" framing from the M007 spec is a **schema to fill**, not a dialogue script to execute.

**Consequences:** Trigger-phrase detection still fires, but Greg either aborts the flow ("never mind") or the data is coerced into incorrect slots just to escape. The decisions table fills with low-fidelity records that poison accuracy scoring forever (the table is not append-only; but we cannot easily purge partials without losing provenance).

**Prevention:**
- Implement capture as **conversational extraction**, not Q1→Q2→Q3. Chris asks for whichever slot is missing in a tone that matches the detected mode (JOURNAL voice, not INTERROGATE voice). The engine extracts from free-form replies via a Haiku structured-output call with the 5 fields as a schema.
- Allow Greg to dump everything in one message ("I'm thinking about taking the contract; alternatives are staying freelance or the FT offer; reasoning is liquidity, I predict I'll regret it in 3 months if I say no, I'd know I was wrong if I'm still at it happily in 6 months"). Haiku parses all five slots in one shot.
- Allow partial capture with explicit `status='open-draft'` if Greg disengages. Do NOT silently insert nulls into required columns.
- Cap capture at 3 follow-up turns. If slots are still missing after 3 turns, commit whatever is present with explicit null markers and move on. Nagging for completeness is worse than incomplete records.

**Detection:** Telemetry on capture-abandonment rate (triggered vs. completed). If >30% of triggered captures abandon, the flow is too rigid.

**Phase mapping:** The phase that implements the capture protocol MUST deliver (a) Haiku structured extraction from free-form replies, (b) a completion cap, (c) a partial-commit path with explicit nulls.

---

### C2: Vague-Prediction Escape Hatch (Forecast Accountability Collapse)

**What goes wrong:** Greg writes predictions like "I think this will probably work out" or "it should be fine". When `resolve_by` arrives, any outcome resolves as "correct" because the prediction was unfalsifiable. Accuracy score drifts to ~95% and becomes meaningless flattery — the exact failure mode M006 exists to prevent.

**Why it happens:** Falsifiability is the hardest of the 5 questions. In conversational flow, vague predictions feel natural; precise ones feel stilted. The Popper question ("what would tell you you were wrong?") is the only defence, and if that field is weakly enforced it collapses.

**Consequences:** M007 becomes structurally sycophantic. Because M007 is the **only layer that can empirically challenge** Greg (D024, PRD), its collapse re-opens the exact trust-failure mode M006 closed. This is the single highest-leverage risk in the milestone.

**Prevention:**
- Falsification criterion is a **required non-null field** at the DB level (NOT NULL). If Greg won't produce one, the decision doesn't get `status='open'` — it goes into `status='open-draft'` and Chris says so plainly: "I don't have a falsification criterion, so I can't hold you accountable for this one. That's fine, but know I'm logging it as a draft."
- Haiku-side validator on the prediction text: flag `{"probably", "should", "likely", "might"}` across EN/FR/RU and ask Chris to push back once with "That's vague. Can you give me something a disinterested reader could check?" — exactly once, then accept whatever Greg says (pushing further becomes interrogation).
- Accuracy scoring explicitly excludes `open-draft` decisions from the denominator. Greg sees two numbers: "resolved with verifiable forecasts: 14/20" and "drafts without verifiable forecasts: 6". Two denominators, no hiding.
- The Haiku classifier that scores prediction-vs-resolution must return a third bucket — `unverifiable` — not forced binary correct/incorrect. `unverifiable` counts toward a visible "unverifiable forecasts" statistic that itself is a calibration signal.

**Detection:** If rolling 30-day accuracy > 85% with N ≥ 10 resolved decisions, Chris should explicitly flag this to Greg as a possible calibration warning (see C6 below), not celebrate it.

**Phase mapping:** The capture phase owns falsifiability enforcement. The `/decisions` + accuracy scoring phase owns the three-bucket classifier and dual denominators.

---

### C3: Over-Triggering Hijack

**What goes wrong:** Trigger phrases fire on "I'm thinking about dinner", "I need to decide what to wear", "j'hésite entre le thé et le café". Every trivial utterance drops Greg into decision-capture mode. Within a week Greg stops using the offending phrases entirely, including in genuinely structural moments. The trigger becomes self-extinguishing.

**Why it happens:** Trigger phrase matching on naive regex treats "I'm thinking about" as atomic. It ignores the **subject** of the deliberation (dinner vs. a job change) and the **stakes** (reversible vs. structural). The ecosystem evidence on pattern-based detection (AI detectors: 15-45% false positive rates) applies directly here — pattern detectors flag structure, not intent.

**Consequences:** Table stakes feature becomes anti-feature. Greg trains around the bot.

**Prevention:**
- Two-phase detection mirroring D010 (cheap gate → expensive confirm):
  - **Phase A:** Regex trigger-phrase match (fast, per-message). Does NOT activate capture; only marks the message as a *candidate*.
  - **Phase B:** Haiku classification with explicit schema: `{is_structural_decision: bool, stakes: 'trivial'|'moderate'|'structural', reason: string}`. Only `structural` activates capture. `moderate` logs a silent hint to relational memory ("Greg mentioned weighing X, didn't capture"). `trivial` is dropped.
- Haiku prompt must include concrete negative examples: dinner, clothing, which route home, which movie, recreational purchases under a configurable threshold.
- Maintain a **per-user trigger-phrase suppression list** that learns from explicit Greg feedback ("not a decision, stop asking"). Store in `proactive_state` JSONB (D015 precedent).
- Config-driven minimum stakes threshold. Default = `structural` only. If false-negative rate becomes a complaint, raise to `moderate`.

**Detection:** Ratio of Phase-A candidates to Phase-B activations. If <10% of candidates activate, trigger vocabulary is too broad. If >60% activate, Haiku classifier is too permissive.

**Phase mapping:** Trigger-phrase detection phase MUST implement both phases. Do not ship Phase A alone.

---

### C4: The Mutable-Status Trap (Data Integrity)

**What goes wrong:** `decisions` table has a mutable `status` column. This violates the Pensieve's D004 append-only invariant. Over time: (a) race condition between scheduler marking `open→due` and Greg replying with resolution in the same sweep tick, leaving the decision permanently stuck in `due` with resolution text lost to the floor; (b) a failed Haiku call during post-mortem transition rolls back the status but the Pensieve entries for the resolution text were already written, creating an audit mismatch; (c) Greg "withdraws" a decision ("I'm not doing this anymore, cancel it") and a naive hard-delete nukes the record that the `/decisions` denominator depended on — retrospective accuracy stats silently change.

**Why it happens:** The rest of Chris treats memory as immutable. M007 introduces mutation. Developers familiar with Pensieve patterns will not instinctively reach for event-sourcing-style discipline on the new table.

**Consequences:** Stats become non-reproducible (reports from last week don't match reports today). Trust in the accountability feature collapses exactly when it matters — at the post-mortem, which is the whole point of the feature.

**Prevention:**
- Treat `decisions` as **the projection**, not the source of truth. Every state transition writes an append-only row to a new `decision_events` table: `(decision_id, from_status, to_status, event_type, payload_jsonb, occurred_at)`. The `decisions` row is regenerable from the event log. This mirrors how `contradictions` relates to `pensieve_entries`.
- All transitions wrapped in a DB transaction: `UPDATE decisions SET status=$new WHERE id=$id AND status=$expected`. The `AND status=$expected` clause is the **optimistic concurrency guard**. Zero-row result = retry or abort, never blindly overwrite.
- Withdrawal is a soft state (`status='withdrawn'`), never a delete. Accuracy denominators explicitly include/exclude by status filter — so historical reports are reproducible from the event log even if current view changes.
- Resolution text and post-mortem text are written to Pensieve FIRST (append-only, the source of truth), THEN the `decisions.resolution_notes` pointer is updated. If the status update fails, the Pensieve entry still exists and a reconciliation job can heal.

**Detection:** Assertion test: after every scheduler tick, for every decision in `due` status, there must be a matching `decision_events` row with `event_type='due_transition'`. Drift = alarm.

**Phase mapping:** Schema phase MUST include `decision_events`. Scheduler phase MUST use optimistic concurrency. Resolution phase MUST write Pensieve before projection.

---

### C5: Scheduler Collision with Proactive Sweep

**What goes wrong:** The daily proactive sweep already has four triggers in priority order (silence → commitment → pattern → thread, per D010). M007 adds a fifth: forecast-resolution prompt. On a day when silence trigger AND forecast-resolution both fire, one suppresses the other. If silence wins, the decision slides past its 24h surfacing window and Greg sees the resolution prompt 3 days late ("you predicted X on the 8th, what happened?" on the 11th), by which time he's already moved on — post-mortem quality craters. If forecast-resolution wins, days of silence compound without outreach — undoing M004.

**Why it happens:** Daily-cap logic (D015) treats "one proactive message per day" as a scarce resource. Adding a fifth trigger without revisiting the arbitration logic means the first trigger to fire wins and the rest are queued / dropped.

**Consequences:** Either decisions rot silently past their resolution windows, or silence / commitment triggers get starved by decision traffic. Both undermine features that already shipped.

**Prevention:**
- Forecast-resolution becomes its **own outreach slot**, not a competitor to the existing four. Architectural change: proactive sweep has two independent channels — `reflective_outreach` (silence/commitment/pattern/thread, one/day) and `accountability_outreach` (forecast resolution, capped separately). They can both fire on the same day.
- If both channels would fire simultaneously, serialize: send the forecast-resolution prompt first (it has a hard 24h window), then wait for Greg's reply to the resolution before sending reflective outreach. If no reply within 6 hours, release the reflective outreach anyway.
- Mute respect: the existing "quiet for a week" mute (M004) must suppress **both** channels. A separate `/mute decisions` command can mute only accountability outreach without killing reflective outreach. Do NOT let the accountability channel bypass the global mute — that would turn M007 into a nag system and break the trust M006 just rebuilt.
- Decisions pending > 48h past `resolve_by` (i.e. missed the 24h surfacing window) escalate to a **dated** prompt: "9 days ago on the 6th you predicted X. What actually happened?" — explicitly acknowledge the delay rather than pretending the context is fresh. The stale-context acknowledgement is itself an anti-sycophancy signal.

**Phase mapping:** Scheduler integration phase MUST document channel separation explicitly and MUST extend mute semantics.

---

### C6: Small-N Calibration Theatre

**What goes wrong:** `/decisions` accuracy stats shipping with N=3 resolved decisions say "67% accuracy, 30-day window". This is statistical noise presented as a metric. Greg either over-trusts it (feels like a scoreboard that knows things) or dismisses it entirely. Over 90-day and 365-day windows, same problem with slightly more decisions but still tiny N. Tetlock's work shows calibration requires hundreds of forecasts over years; Greg will have ~20 resolved decisions per year at the PRD's expected cadence.

**Why it happens:** It's trivial to compute `correct/total` and present as a percentage. The statistical work of honest confidence intervals, or of refusing to display a number at all below a threshold, is harder.

**Consequences:** M007 becomes a sycophancy vector by accident. High-number-on-a-dashboard is a flattery surface regardless of M006's prompt-level defences — it's structural, not linguistic.

**Prevention:**
- `/decisions` accuracy display has a **minimum-N floor**. Below N=10 resolved-with-verifiable-forecasts in the window, show counts only: "Resolved with verifiable forecasts: 3. Correct: 2. Too few to compute a meaningful rate." No percentage, no running accuracy score.
- Above N=10, show the rate with a visible Wilson score interval (not a raw percentage): "accuracy 65% (95% CI: 45-80%)". Small N = wide interval = visual honesty. This mirrors D031's "structured facts over prose" philosophy — make the uncertainty structurally visible.
- Break down by **domain tag** (career, relationships, health, money, technical) — Greg is probably well-calibrated in some domains and badly in others; a pooled average masks both.
- The `/decisions` command text explicitly states which decisions were classified `unverifiable` and invites Greg to review them. Surface the failure mode, don't bury it.
- Per C2: explicit second denominator for `unverifiable` forecasts. An accuracy rate sitting next to a large unverifiable count is self-correcting — Greg will see that tightening predictions is the leverage point.

**Phase mapping:** `/decisions` command phase MUST implement the N-floor and the CI. Do NOT ship a bare percentage.

---

### C7: Anti-Sycophancy Integration Failure (M006 ↔ M007 Collision)

**What goes wrong:** The praise quarantine (D025, TRUST-09) post-processes Chris's replies for flattery. When Chris delivers a resolution prompt after a correct forecast ("you predicted you'd regret the contract; you did; what did you learn?"), the quarantine post-processor sees words like "predicted correctly" and quarantines them as flattery. Chris's accountability voice gets muzzled by his anti-flattery layer.

Symmetrically: if the praise quarantine is bypassed for M007 outputs, Chris will eventually drift into "wow, you called it" language — exactly The Hard Rule (D027) forbids.

**Why it happens:** M006's quarantine is mode-scoped (JOURNAL/REFLECT/PRODUCE); M007 will add a new conversational surface that the quarantine hasn't been tuned for. The two features were designed separately and now need to compose.

**Consequences:** Either accountability voice is silenced (feature dies), or accountability voice smuggles in flattery (feature inverts). Both are worse than not shipping M007.

**Prevention:**
- Treat decision-resolution replies as a **distinct mode** (call it `ACCOUNTABILITY` or extend COACH to cover it). COACH and PSYCHOLOGY already bypass the praise quarantine per D025 because their prompts forbid flattery at the source. Decision-resolution follows the same pattern: forbidden-by-prompt, no post-processor.
- The ACCOUNTABILITY mode prompt must explicitly forbid: "you were right", "good call", "impressive forecast", and any variant tying the outcome to Greg-as-a-person (this IS The Hard Rule, D027, restated in the M007 context). Correct forecasts get reported as data: "your prediction matched. The reasoning you cited was X. What's the question?"
- Incorrect forecasts get the symmetric treatment: no "you were wrong, here's why you're bad at this" — just "your prediction didn't match; you predicted X, outcome was Y; what surprised you?" The post-mortem question is the anti-sycophancy mechanism; it demands reflection, not judgement.
- Live integration test suite (D023 precedent) for ACCOUNTABILITY mode: 10+ scenarios of correct/incorrect/unverifiable forecasts, 3-of-3 against real Sonnet, verify absence of flattery AND absence of condemnation. Neutral-factual tone is the target.
- The `/decisions` command output itself must obey The Hard Rule. No "impressive track record" framing even if N is high. State the numbers; let Greg interpret.

**Phase mapping:** The resolution / post-mortem phase MUST create ACCOUNTABILITY mode (or extend an existing bypass-mode) with its own prompt and its own live integration suite.

---

## Moderate Pitfalls

### M1: Open-Forever Decisions

**What goes wrong:** Decision captured with `resolve_by` left NULL (Greg wasn't sure when he'd know). It sits `open` forever. Accuracy statistics quietly exclude it but Greg forgets it exists.

**Prevention:**
- `resolve_by` NOT NULL at DB level. If Greg refuses to name a date, the capture flow offers a default ladder (7 days / 30 days / 90 days / 1 year) and picks the shortest one Greg agrees is plausible.
- Monthly sweep surfaces the N oldest `open` decisions in `/decisions open` output with their age. Visibility is the forcing function.
- After 2×`resolve_by` elapsed with no resolution, auto-escalate to `due` and send a resolution prompt regardless.

**Phase mapping:** Schema phase (NOT NULL), capture phase (ladder), `/decisions` phase (age visibility).

---

### M2: Resolved-But-Never-Reviewed

**What goes wrong:** Greg responds to the resolution prompt ("contract went badly, I should have stayed freelance"), status transitions to `resolved`, Chris asks the post-mortem follow-up, Greg doesn't reply. Decision sits in `resolved` forever, never reaches `reviewed`. The post-mortem is the learning moment; losing it means M007 captures events but extracts no insight from them.

**Prevention:**
- Post-mortem follow-up has its own scheduler entry: if Greg doesn't reply within 48h, Chris re-asks once, differently ("still curious what surprised you about {decision}"). After a second non-reply within 72h, auto-transition to `reviewed` with `resolution_notes='[no post-mortem provided]'` and move on — don't nag a third time.
- The `/decisions` command surfaces count of `resolved but un-reviewed` as its own statistic. Visibility creates agency.

**Phase mapping:** Resolution phase.

---

### M3: Resolution Arrives Mid-Unrelated-Conversation

**What goes wrong:** Chris surfaces a resolution prompt on the 14th. Greg is mid-thread about something else ("can you pull up the Gmail thread from Sarah?"). Either (a) Chris injects the resolution prompt anyway and derails the conversation, or (b) Chris swallows the prompt and forgets to re-surface it.

**Prevention:**
- Resolution prompts are **queued, not immediate**. Surfacing checks engine state: if the current conversation has received a user message in the last 10 minutes, defer until Greg idles or until the next sweep tick.
- Surfacing wraps in a clear pivot ("pausing — before we continue, you made a call 7 days ago about {decision_summary}; quick check-in?"). Greg can reply "later" to defer once. More than one "later" escalates the age on subsequent surfacings (see C5 stale-context prevention).
- Never stack multiple resolution prompts in one message. One at a time, oldest first.

**Phase mapping:** Scheduler integration phase.

---

### M4: Classification Drift on Haiku Accuracy Scorer

**What goes wrong:** The Haiku classifier that compares prediction to resolution is a prompt. Prompts drift across model versions. A `correct/incorrect/unverifiable` classification made in March produces a different answer in December when re-run, and anyone recomputing historical stats gets different numbers.

**Prevention:**
- Store the Haiku classification as a **materialized** value on `decision_events` at the time of resolution. Never recompute live. The stored classification is the source of truth for all time-windowed reports.
- Store the model version string alongside the classification. If a future audit wants to re-classify, it's an explicit, logged re-classification event, not a silent drift.
- Provide a `/decisions reclassify` admin command (gated) that re-runs Haiku over all resolved decisions with the current model and stores the deltas side-by-side. Never overwrite the originals.

**Phase mapping:** `/decisions` + accuracy phase.

---

### M5: Language Drift Across EN/FR/RU Triggers

**What goes wrong:** English trigger phrases get tuned during real usage; French and Russian phrase lists drift out of sync because Greg uses them less. After 6 months: EN works, FR/RU have false-negative rates of 40%.

**Prevention:**
- Single fixture file `decisions/fixtures/triggers.{en,fr,ru}.ts` with paired positive/negative examples per language. Every trigger-list change requires updating all three fixtures. CI guard: fixture cardinality must match across languages.
- M006 `franc`-based language detection (D021) already in the engine — reuse it to select trigger list, don't re-implement.
- When Haiku Phase-B classification (see C3) runs, it gets the detected language as context and applies language-appropriate triviality examples.

**Phase mapping:** Trigger detection phase.

---

### M6: Rationalisation Rewrite at Capture Time

**What goes wrong:** The "reasoning" field captures Greg's *post-hoc* justification, not his actual decision process. By the time he's talking through the decision, the reasoning has been cleaned up. This is a well-documented decision-journal failure mode. The captured reasoning looks coherent and the post-mortem can't surface that the real driver was something Greg hasn't admitted (fear, ego, fatigue).

**Prevention:**
- The capture prompt explicitly asks for two reasoning slots: `reasoning_stated` (what Greg articulates) and optionally `reasoning_suspected` (what might actually be driving this, honest guess). Both optional; second encouraged but not forced.
- The post-mortem follow-up is where rationalization gets tested: "did the reasoning you wrote down turn out to match what actually drove you?" This question is the feature's main defence against rationalization — make sure it's in the post-mortem prompt explicitly.
- Cross-reference: if relational memory (M002) has observations about Greg's state at the decision timestamp ("Greg expressed exhaustion that week"), surface them at post-mortem time as neutral context, not as gotcha. "Relational memory flagged low energy around that date" — Greg can confirm or dismiss.

**Phase mapping:** Capture phase (two reasoning slots), resolution phase (post-mortem question text).

---

## Minor Pitfalls

### m1: Mock Clock Test-Only Bugs
**What goes wrong:** Scheduler uses mock clock in fixture test. Works. Deployed. Real clock diverges (DST, timezone handling, Date.now() vs Postgres `now()`).
**Prevention:** Single source of time in the scheduler — inject a `Clock` interface; fixture uses `MockClock`, production uses `SystemClock`. Never call `new Date()` or `Date.now()` inside scheduler logic. Use Postgres `TIMESTAMPTZ` consistently; never `TIMESTAMP` without zone.

### m2: `alternatives` JSONB Schema Sprawl
**What goes wrong:** JSONB accepts anything; each captured decision stores alternatives in a slightly different shape; `/decisions` rendering code accumulates special cases.
**Prevention:** Zod schema for alternatives `Array<{label: string, rejected_because?: string}>` — validated at insert time, stored as JSONB for flexibility but consistent at write.

### m3: Post-Mortem Entry Duplication in Pensieve
**What goes wrong:** Resolution text and post-mortem text are stored as Pensieve entries AND referenced from `decisions.resolution_notes`. Retrieval returns the same content twice when both tables are queried.
**Prevention:** Pensieve entries for decision artefacts get a `source='decision'` and `source_ref_id=<decision_id>` provenance marker (D011 precedent). Retrieval dedups by `source_ref_id` when both tables are in play.

### m4: `/decisions` Command Output Overflow
**What goes wrong:** After 6 months, `/decisions` returns a 40-item list that doesn't fit in a Telegram message.
**Prevention:** Default to top 5 open + top 5 recent-resolved; require `/decisions all` or `/decisions open N` for longer lists. Tersely formatted rows, not verbose.

### m5: Embedding Load on Decision Text
**What goes wrong:** Every decision's reasoning/prediction/resolution gets embedded for semantic retrieval (M001 pattern), but decision reasoning is often long and bge-m3 ONNX cost compounds.
**Prevention:** Embed at Pensieve-entry level only (already the pattern). Do NOT create a separate decision-embedding pipeline. Retrieval across decisions = retrieval across their Pensieve entries.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfalls | Required Mitigation |
|---|---|---|
| **Schema + migration** | C4, M1 | `decision_events` append-only table, `resolve_by NOT NULL`, `falsification_criterion NOT NULL`, status enum with explicit `open-draft` + `withdrawn` values |
| **Trigger-phrase detection** | C3, M5 | Two-phase detection (regex candidate → Haiku confirm with stakes enum), shared fixtures across EN/FR/RU, per-user suppression list |
| **5-question capture** | C1, C2, M6 | Conversational extraction via Haiku structured output, partial-commit path, 3-turn follow-up cap, vague-prediction validator |
| **Lifecycle state machine** | C4, M1, M2 | Optimistic concurrency UPDATE with `AND status=$expected`, event log, auto-escalation of stale `open`/`resolved` |
| **Scheduler integration** | C5, M3, m1 | Separate `accountability_outreach` channel, queueing/pivot logic for mid-conversation surfacing, Clock interface, extended mute semantics |
| **Resolution + post-mortem** | C7, M2, M6, m3 | ACCOUNTABILITY mode with praise-quarantine bypass, prompt forbids The Hard Rule language, post-mortem auto-escalation after 2 non-replies, source_ref_id provenance |
| **`/decisions` command + accuracy** | C2, C6, M4 | Three-bucket classifier (correct/incorrect/unverifiable), N-floor on percentages, Wilson CI display, materialized classifications with model version, domain-tag breakdown |
| **Synthetic fixture test** | m1, C5 | MockClock injection, cover silence+resolution same-day collision, cover stale-context delayed surfacing, cover optimistic concurrency race |
| **Live integration suite** (new) | C7 | ACCOUNTABILITY mode scenarios (correct/incorrect/unverifiable × 3-of-3 real Sonnet), absence-of-flattery AND absence-of-condemnation assertions |

---

## Sources

- [Superforecasting (Tetlock & Gardner) — calibration requires large N; Ten Commandments](https://goodjudgment.com/philip-tetlocks-10-commandments-of-superforecasting/) — HIGH confidence, foundational research
- [Superforecasting reality check — small-pool concerns (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7333631/) — MEDIUM, corroborates small-N limitations
- Chris `.planning/PROJECT.md` decisions D004 (append-only), D010 (two-phase triggers), D015 (proactive_state KV), D021 (`franc`), D023 (3-of-3 live test), D024-D027 (four-layer anti-sycophancy + The Hard Rule), D031 (structured facts) — HIGH confidence, project-internal
- Chris `M007_Decision_Archive.md` spec — HIGH confidence, authoritative for this milestone
- Pattern-detection false-positive rates (ecosystem ~15-45%) — LOW-MEDIUM, referenced for C3 prevention rationale only
