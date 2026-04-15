# Feature Research — M007 Decision Archive

**Domain:** Personal decision journal + forecast accountability (single-user Telegram bot, embedded in existing Pensieve)
**Researched:** 2026-04-15
**Confidence:** MEDIUM-HIGH (domain literature is mature and convergent — Parrish/Duke/Tetlock agree on the skeleton; resolution scoring for *free-text personal* decisions is less established and my recommendations there are LOW-MEDIUM confidence)

---

## Orientation — what this milestone is, in the language of the domain

Every established decision-journaling practice (Parrish's Farnam Street template, Annie Duke's "bets" frame, Tetlock's IARPA/GJP forecasting protocol, Welch's 10-10-10) converges on the same four-part skeleton:

1. **Capture the decision with reasoning, at the moment of decision** (not retrospectively).
2. **Capture a falsifiable prediction with a resolution date** (the "bet" — without it, you can't distinguish skill from luck).
3. **Surface the prediction at resolution time** and compare to what actually happened.
4. **Post-mortem that separates decision quality from outcome quality** (the Annie Duke "resulting" problem — good decisions can have bad outcomes and vice versa).

M007's 5-question protocol (decision → alternatives → reasoning → falsifiable prediction → Popper question) is a near-exact implementation of the Parrish template with one Tetlockian addition (the Popper falsification question). This is **well-grounded in the literature, not invented.** The spec is sound. The open questions are in the *lifecycle edges* and *how to score accuracy on free-text resolutions* — covered below.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Grouped by category per the quality gate: **capture / lifecycle / resolution / stats / UX**.

#### Capture

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Trigger-phrase detection in 3 languages | Without this, Greg has to remember to `/decide` — defeats the Pensieve's "friction-free capture" principle | MEDIUM | Already in M007 spec. Depends on existing engine mode-detection pipeline (Haiku pre-classification). Pattern list should match the EN/FR/RU equivalents in the spec. Consider adding negative patterns ("I decided last week…" → retrospective, not in-flight). |
| 5-question guided capture (decision / alternatives / reasoning / prediction / Popper) | This is literally the Parrish + Tetlock consensus template. Anything less and the archive is a journal, not an epistemic tool. | HIGH | Already spec'd. The hardest sub-problem is **state management during the multi-turn capture sub-conversation** — Greg can abandon mid-capture, switch topics, answer all 5 in one message, or give a non-answer to Q4 ("I don't know what would make me wrong" is itself a data point). Depends on existing conversation-history mechanism but needs a new short-lived FSM. |
| Timestamp + physiological/emotional state at capture | Parrish template explicitly calls for "time of day and how you feel physically and mentally" — fatigue, HALT-state matter for decision quality | LOW | `captured_at` is in the schema. Emotional state can be *inferred* from the surrounding Pensieve entries (journal entries around that timestamp) rather than asked explicitly — asking would add friction. Recommend: store `captured_at` only; let retrieval surface mood context at review time. |
| Alternatives including rejected ones | Parrish: "the work required to have an opinion." Without alternatives, there's no decision — just a rationalization. | LOW | In spec as `alternatives jsonb`. Prompt should explicitly ask "what did you reject and why?" not just "what else did you consider?" — the rejection reasoning is the valuable signal. |
| Resolve-by date in any natural-language form | "in two weeks", "by end of Q2", "когда найду квартиру" — Greg types in 3 languages and won't reach for a date picker on Telegram | MEDIUM | Haiku call to parse to ISO timestamp. Edge case: "when I find an apartment" is a *conditional* resolve-by, not a date — see ambiguous resolve_by below. Fallback: if Haiku can't parse, ask "by when?" as a 6th question rather than storing null. |
| Prediction written in Greg's own words (free text), not forced probability | Tetlock-style Superforecasters use probabilities, but that's for public markets. Personal decisions benefit from natural-language predictions ("I'll feel relieved"; "revenue will be flat for 60 days") that are richer than a scalar. | LOW | Already in spec as `prediction text`. **Anti-feature:** do NOT force a probability slider (see anti-features). |

#### Lifecycle

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Explicit 4-state FSM: `open` → `due` → `resolved` → `reviewed` | Parrish's canonical cadence is "set a date, return on that date, post-mortem." M007's FSM is the minimum viable encoding. | LOW | In spec. Enforce transitions in a single code path (never via raw UPDATE). Add a `status_changed_at` column — needed for "time to review" stats and to detect stuck-in-`due` decisions. |
| `resolve_by` deadline triggers resolution prompt via proactive sweep | Without surfacing, the archive is write-only. Duke's "tracking unrealized futures" explicitly requires this closing loop. | MEDIUM | In spec. Piggyback on the M004 proactive sweep (new cheap SQL gate: `WHERE status='open' AND resolve_by < now()`). This is an ideal two-phase-trigger pattern — no Opus needed for the SQL gate, Sonnet for the prompt. |
| Append-only — no hard delete, no edit of original capture | Chris's D004 append-only invariant. Also: letting Greg edit his original reasoning after outcome = defeating the whole point (hindsight bias — one of the three biases Duke names explicitly). | LOW | Enforce at code layer. Corrections go in `resolution_notes`, not on top of `reasoning`. |

#### Resolution

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Resolution prompt within 24h of `resolve_by` | In spec. 24h is a reasonable jitter window — matches the existing proactive sweep cadence and avoids midnight pings. | LOW | Piggyback on sweep schedule. If Greg is muted, defer but don't skip — decisions must not silently rot. |
| Free-text resolution capture ("what actually happened?") | This is the primary data. Forcing a structured resolution (Y/N, hit/miss) loses information. | LOW | Store verbatim in `resolution_notes`. Also write a Pensieve entry (already in spec). |
| One-question post-mortem follow-up, not structured | Literature split: Parrish uses a single "what did you learn?" review; post-mortem meeting templates (software/PM domain) use 5–7 structured questions. **For a personal daily-cadence tool, one question is correct.** Structured multi-question post-mortems produce fatigue and skipped reviews within 2–3 cycles. | LOW | In spec. The spec allows Chris to pick "what would you do differently?" OR "what surprised you?" — recommend **Chris picks based on resolution content**: if the prediction matched (hit), ask "what surprised you?" (surfaces luck-vs-skill); if it missed, ask "what would you do differently?" (surfaces correction). This mirrors Duke's "resulting" distinction. |
| Haiku classification of outcome (hit / miss / partial / ambiguous / N/A) | Aggregate stats require a structured signal. Free-text alone can't produce "67% accuracy over 90 days." | MEDIUM | Haiku prompt compares `prediction` field + `resolution_notes`. **Four-class output is the sweet spot** — see edge cases below. Confidence threshold for auto-classification; fall back to "unclassified" if Haiku low-confidence. |
| Resolution creates new Pensieve entries | Preserves narrative voice alongside structured fields. Standard M001 pattern. | LOW | In spec. Tag them with new `DECISION_RESOLUTION` epistemic tag or reuse `DECISION`. |

#### Stats

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `/decisions` command: open list | Without visibility, Greg can't navigate his own archive | LOW | In spec. |
| `/decisions` recently-resolved list | Review surface. | LOW | In spec. |
| Rolling accuracy windows (30/90/365 days) | Tetlock's entire thesis rests on *rolling calibration over time*. A single accuracy number is meaningless — trends are everything. | MEDIUM | In spec. Compute from Haiku-classified `resolution_class`. Present as "hit-rate" not "Brier score" — see stats anti-features. |

#### UX

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Abort-capture escape hatch | Greg will start a decision capture, then need to change topic. Without escape, the FSM soft-locks. | LOW | Detect "nevermind / later / let me come back to this" as abort phrase. Save partial capture as `draft` status and optionally re-prompt 24h later. |
| One-message multi-answer handling | Greg types fast on mobile; he'll often answer Q1+Q2+Q3 in one Telegram message. The bot should not force 5 round-trips if 1 suffices. | MEDIUM | Haiku call to extract structured fields from a blob. If all 5 present → store directly; if 3 of 5 → confirm extracted + ask missing. |
| Review interrupts "normal" conversation | Duke's "decision interrupts" concept — resolution prompts should feel like a conversation, not a form. | LOW | Phrase as: "On March 3 you thought moving to Nice would make you feel settled within 30 days. Did it?" Uses natural past-tense paraphrase of the `prediction`, not the raw verbatim field. |

---

### Differentiators (Chris-specific competitive advantage)

These are where Chris beats Notion templates, spreadsheet trackers, and Manifold-for-yourself. Differentiators exploit what Chris already has that standalone decision journals don't.

| Feature | Value Proposition | Complexity | Dependency on existing Chris |
|---------|-------------------|------------|------------------------------|
| **Pensieve-grounded reasoning retrieval at resolution time** | When surfacing a resolution prompt, Chris retrieves *what else Greg was saying at the time of capture* (surrounding Pensieve entries from ± 48h). This transforms the post-mortem from "what do you remember about March 3?" into "here's what you were feeling that week, here's the decision you captured, here's what happened — what do you notice?" No standalone tool has this. | MEDIUM | **Hard dependency on M001 hybrid retrieval + M008 episodic summaries (not yet built).** For M007, implement the ±48h raw-entry fetch; M008 will later layer summaries on top. |
| **Contradiction detection fires on `reasoning` field** | Greg captures a decision with reasoning R. Six weeks later he captures another decision whose reasoning contradicts R. M002 contradiction detector (already built, confidence ≥ 0.75) surfaces this at the second capture — not six months later in a review. | LOW | Hard dependency on M002. Just extend the existing contradiction scan to include `decisions.reasoning`. |
| **Pattern detection across misses** (Opus) | Over many resolved decisions, Opus can identify *where reasoning systematically fails* — "you consistently underestimate time-to-feel-settled after moves" or "your revenue predictions are calibrated when collaborators are involved, poorly calibrated when solo." This is the single highest-value output of a mature decision archive and the PRD calls this out as "scoreboard, not mirror." | HIGH | Depends on M004 proactive sweep (for the Opus gate) and on having ≥ 20–30 resolved decisions (6–12 months of real data). **Defer to a later milestone** — in M007 just capture the data; in M013+ synthesize patterns. |
| **Forecast accountability as anti-sycophancy layer** | Per D024 / M006: the decision archive is structural anti-sycophancy. If Chris flattered Greg's reasoning on decision D, and D resolved wrong, the resolution prompt automatically surfaces that gap. Chris becomes *auditable* against reality. | LOW | Emerges from correct resolution UX — no new feature, but worth naming. |
| **Popper question as ongoing probe, not just capture-time** | The "what would change your mind?" answer from Q5 becomes a signal Chris can use if he later sees *exactly that evidence* in the Pensieve. ("Six weeks ago you said you'd know this was wrong if revenue stayed flat for 60 days. Revenue has been flat for 62 days.") | MEDIUM | Requires M004 proactive sweep + semantic search over falsification criteria. Implementable in M007 as a scheduled weekly check; full "detect the disconfirming evidence automatically" version is M013-grade. Recommend **M007 ships the storage + the passive display at resolution time; Opus probe lives in M013**. |
| **Multi-language capture in Greg's authentic voice** | Welch, Parrish, Duke all assume English. EN/FR/RU-native capture (with trigger phrases) preserves the code-switching that carries emotional weight in Greg's reasoning. | LOW | M006 already wired `franc` language detection into the engine pre-processor. Reuse. |
| **Silent partial-capture recovery** | If Greg abandons Q3, the next day Chris can gently re-surface: "You were weighing whether to hire X last Tuesday — do you want to finish that capture or set it aside?" | MEDIUM | Uses M004 proactive sweep. Keep behind a confidence gate — if Greg already implicitly resolved it in a later journal entry, skip. |
| **Time-of-day / mode context at capture** | Parrish asks for physical/mental state. Chris can *infer* from recent journal entries + time-of-day rather than asking — the data is already in the Pensieve. Store an inferred `captured_context` snapshot (tired / energized / anxious / calm) alongside the decision. | MEDIUM | Hybrid retrieval + existing epistemic tags. Valuable for post-mortem ("you captured this at 11pm after 3 journal entries about anxiety — that context is now visible"). Low-urgency — consider deferring until M009 wellbeing snapshot ships (richer signal). |

---

### Anti-Features (Commonly Requested, Often Problematic)

These are what the literature or Chris's constraints argue *against*. Explicit non-goals.

| Feature | Why Tempting | Why Problematic | Alternative |
|---------|--------------|-----------------|-------------|
| **Forcing a numeric probability (0–100%) on every prediction** | It's what Superforecasters / Metaculus / Manifold do. Enables Brier scoring. | Greg is one person making life decisions, not 1000 forecasters on Metaculus. Brier needs *many* forecasts at the same probability level to yield meaningful calibration. With ~2–5 decisions/month, a personal Brier score is statistical noise for ≥ 3 years. Also: forcing probabilities *strips the natural-language texture* ("I think I'll feel relieved") that makes personal decisions rich. Tetlock's methodology presupposes a public question bank, not a life. | Use Haiku **binary/4-class classification** (hit/miss/partial/ambiguous) on free-text resolutions. Report as "hit rate," not Brier. Optionally offer — not require — a confidence word ("pretty sure", "coin flip", "long shot") parsed to a coarse 3-bucket scale. |
| **Full Brier-score scoring pipeline** | "Rigor." | See above — statistically meaningless at personal-journal scale, AND implementation-heavy (requires probabilistic predictions, which requires the forced-probability UX, which is already an anti-feature). Sebastian Raschka's 2026 forecasting literature frames Brier for 100s-of-questions benchmarks, not personal journals. | Hit-rate % over rolling windows + qualitative pattern detection (Opus, in M013). **This is the explicit D-decision the quality gate flags: Brier scoring is OUT of M007.** |
| **Auto-resolving decisions by scanning Pensieve for the outcome** | "Chris can notice when the decision resolved itself." | (a) Wrong-resolution risk is very high — false resolution is trust-breaking (see M006 contradiction FP lesson). (b) Greg might resolve it in his head without writing about it — auto-detect misses. (c) The *conversation* of resolution is half the value (Duke's "decision interrupts"); auto-resolving skips the reflection. | Always require Greg to state the outcome. Chris can *suggest* "this looks resolved — want to walk through it?" but never auto-mark `resolved`. |
| **Editing original reasoning after outcome is known** | "But I see now what I missed" | Defeats the purpose. The whole archive exists *because* humans rewrite their past reasoning to match outcomes (Duke + hindsight bias is one of the three biases). | Corrections live in `resolution_notes` ("I realize now the real reason was X"). Original `reasoning` is immutable. |
| **Structured multi-question post-mortem (5–7 questions)** | Project-management post-mortem templates use this. Feels thorough. | At personal-journal cadence, produces fatigue → skipped reviews within 2–3 cycles. Parrish, Welch, Duke all use **one** review question. The M007 spec's one-question follow-up is correct. | Keep the one-question follow-up. Chris picks the question based on hit/miss classification. |
| **Reminding about decision capture via general nag** ("You haven't captured a decision in 2 weeks") | Feels like accountability. | Decisions are not a metric to maximize — some weeks are legitimately decision-free. Nagging erodes trust (M006 constitution). | Only surface when a trigger-phrase is detected in the active conversation. If the detector misses a decision, that's tolerable; false surfacing is not. |
| **Surfacing accuracy stats unprompted** | "Your 90-day hit rate just dropped — want to look at why?" | Two problems: (a) with small n, stat swings are noise; (b) pushing stats reads as performance-review energy, violating the M006 relational contract. | `/decisions` is pull-only. Chris can *reference* calibration in conversation ("your track record on timing predictions has been weak — worth weighting that here") — and this is actually a high-value in-mode behavior — but doesn't push unprompted reports. |
| **Graph / chart visualizations in Telegram** | Pretty. | Telegram is a text-first surface. Charts as images require rendering pipeline + add no insight a 3-line text summary doesn't give. | Text summary: "Last 30 days: 4 resolved / 3 hit / 1 miss. Last 90: 12 / 8 / 3 / 1 ambiguous." |
| **Tags or categories on decisions** (work / relationships / money / health) | "Filter my archive by type." | Adds friction at capture, and Chris's epistemic tags + semantic retrieval already enable filtering without an explicit taxonomy. Greg isn't building a database; he's thinking. | Let retrieval + semantic search do categorization implicitly. If `/decisions` filtering ever becomes needed, infer categories from `decision` text with Haiku at query time. |
| **Prediction market / betting mechanics (stakes, odds)** | Duke's framing is literally poker. | Chris is not a game. The "bet" metaphor is pedagogic, not literal. | Keep the word "prediction," not "bet," in user-facing copy. |

---

## Feature Dependencies

```
Decision trigger detection (capture)
    └──requires──> M001 engine mode pipeline + Haiku classifier
    └──requires──> M006 franc language detection

5-question capture FSM
    └──requires──> Decision trigger detection
    └──requires──> New short-lived conversation-state mechanism (decision_captures.status = 'draft')
    └──enhances──> Existing conversation-history persistence (20-message window)

Lifecycle state machine (open → due → resolved → reviewed)
    └──requires──> 5-question capture FSM (to reach 'open')
    └──requires──> M004 proactive sweep (to transition 'open' → 'due')

Resolution prompt surfacing
    └──requires──> Lifecycle state machine at 'due'
    └──requires──> M004 proactive sweep scheduler
    └──requires──> M006 mute state (respect "quiet for a week" during resolution)

Pensieve-grounded retrieval at resolution
    └──requires──> Resolution prompt surfacing
    └──requires──> M001 hybrid retrieval (± 48h entry window)
    └──enhances──> Post-mortem quality (the "differentiator" that makes Chris's decision archive better than Notion)

Haiku outcome classification
    └──requires──> Resolution captured
    └──requires──> 4-class prompt (hit / miss / partial / ambiguous)

/decisions stats
    └──requires──> Haiku outcome classification (for rolling accuracy)
    └──requires──> Lifecycle state machine (for open-vs-resolved counts)

Contradiction detection on decisions.reasoning
    └──requires──> M002 contradiction detector (already built)
    └──enhances──> Capture flow (fires at capture time if new reasoning contradicts prior decision)

Pattern detection across misses [DEFER to M013]
    └──requires──> ≥ 20 resolved decisions (6+ months real data)
    └──requires──> M004 Opus-gated trigger
    └──requires──> M008 episodic summaries

Popper probe auto-fire [DEFER to M013]
    └──requires──> M004 proactive sweep
    └──requires──> Semantic search over falsification_criterion field
```

### Dependency notes

- **5-question capture FSM requires a new short-lived state beyond the 20-message conversation window.** If Greg abandons mid-capture and returns 3 days later, the 20-message window has rolled over. Recommend: `decisions.status = 'draft'` with partial fields, surfaceable by `resolve_by IS NULL AND status='draft' AND created_at > now() - 7 days`. After 7 days, silently archive as `abandoned`.
- **Resolution prompting conflicts with mute state.** If Greg has muted Chris, due-decisions queue up rather than fire. On unmute, surface the *oldest* first, one per day maximum — don't flood.
- **Contradiction detection on decisions enhances capture but must not block capture.** Same fire-and-forget pattern as M002 — log and display, never throw.
- **Pattern detection and Popper probe are deliberately deferred.** M007 ships capture + resolution loop. The meta-layer that makes the archive transformative (pattern detection across many resolved decisions) requires data volume that doesn't exist yet — building it now means testing against synthetic data only and shipping prompts that will need rewrites once real miss-patterns emerge.

---

## Edge Cases (direct answer to question d)

These are the lifecycle fractures the literature and prediction-market post-mortems have surfaced. All of them *will* happen in real Telegram usage; each needs a defined handler.

| Edge Case | What Happens in the Wild | Recommended Handling |
|-----------|--------------------------|----------------------|
| **Decision withdrawn before resolution** | Greg decides not to decide — the choice is deferred, or the situation resolved itself (e.g., "I'm thinking about whether to take the job" → they rescinded the offer before Greg chose). | New status: `withdrawn`. Ask "still deciding, withdrawn, or resolved?" if `resolve_by` passes and Greg mentions the topic. Don't count in accuracy stats. |
| **Prediction was correct but reasoning was wrong** ("lucky") | Classic Duke "resulting" inverse. Greg predicted X would happen, X happened, but not for the reasons he gave. This is a HIT on outcome but a MISS on reasoning calibration — and the latter matters more long-term. | Haiku classification should be **two-dimensional**: `outcome_class` (hit/miss/partial/ambiguous) AND `reasoning_class` (confirmed / partially-confirmed / contradicted / inconclusive). Post-mortem question branches on the combination: lucky-hit ("what surprised you about why?") is different from skilled-hit ("what else did you get right?"). **This is a meaningful extension beyond the M007 spec — recommend adding it.** |
| **Partial resolution** | "I moved to Nice but I'm not sure yet if I feel settled" — outcome happened, prediction partially validated, but evaluation needs more time. | `partial` class; store resolution text; set `resolve_by` to +30 days and re-surface. Track `resolution_iterations` count — if > 3, force final resolution (avoid infinite loop). |
| **Ambiguous `resolve_by`** ("when I find an apartment") | Conditional resolution. Can't schedule a date. | Two options: (a) **hard rule**: require a date at capture — if Haiku can't parse, ask "if nothing happens, when should I check in? 30 days? 90?" (b) **conditional**: store condition as text, scan Pensieve weekly for condition-met signal, confirm with Greg. Option (a) is MVP; option (b) is M013. |
| **Ambiguous resolution** (outcome itself unclear) | Metaculus's explicit category. Reality was messy — e.g., "did the collaboration work?" when the answer is "kind of, for 3 months, then fizzled". | `ambiguous` class; preserve Greg's text; **do not count in accuracy stats** (Metaculus convention). Opus pattern detection can still learn from it. |
| **Resolution prompt arrives and Greg doesn't respond** | Happens. The `due` state persists. | After 3 days un-responded, one gentle reminder. After 14 days un-responded, auto-transition to `stale` (not `resolved` — never fabricate an outcome) and exclude from active stats. |
| **Greg resolves in the wrong direction — corrects himself** ("Wait, I said hit but actually it was more miss than I wrote") | Greg re-reading an old resolution and wanting to update. | Append to `resolution_notes` with new timestamp; do not overwrite. Re-run Haiku classification. Track revisions. |
| **Nested decisions** ("I'm thinking about whether to decide about X now or wait") | Meta-decisions. Real and annoying. | Capture as one decision. The alternatives field naturally holds "decide now vs. defer." Don't try to model as a tree. |
| **The decision is actually a value / identity question, not a decision** ("Should I be the kind of person who does X?") | Capture protocol will force an answer that misrepresents the structure. | Trigger detector should skip identity-frame language ("should I be") and route to PSYCHOLOGY mode instead. Cheap Haiku call at trigger detection: "is this a decision with a falsifiable outcome, or a values question?" |
| **Capture sub-conversation gets interrupted by an emergency topic** | Greg starts a capture, then pastes a work crisis unrelated to the decision. | Detect topic shift (embedding distance > threshold between Q2 answer and Q3 answer). Offer: "Want to park this decision and come back? I'll hold onto what we have." — save as `draft`. |

---

## How forecast accuracy should be scored (direct answer to question c)

**Recommendation: Haiku 4-class classification over binary Brier, with reasoning-separation extension.**

### Rationale

| Approach | Pros | Cons | Verdict |
|----------|------|------|---------|
| **Brier score** (probabilistic) | Strictly proper scoring rule; gold standard in forecasting research; enables calibration curves | Requires forced-probability UX (anti-feature); requires ≥ 100 forecasts at each probability level for meaningful calibration (years of data); hides the texture of natural-language predictions | **Rejected for M007.** The 2026 ForecastBench line of research (LLM-superforecaster parity June 2026) operates on public question banks, not personal archives. Personal n is too small. |
| **Haiku binary classification** (hit/miss) | Simple; works on free text; interpretable | Loses the partial/ambiguous/lucky distinctions that are the most informative failure modes | **Insufficient.** Real outcomes are rarely clean hits or misses. |
| **Haiku 4-class classification** (hit / miss / partial / ambiguous) | Captures Metaculus's actual resolution vocabulary; works on free text; interpretable; matches the edge cases that actually occur | Loses fine-grained calibration info | **Recommended.** Use for `/decisions` stats. Ambiguous excluded from hit-rate denominator per Metaculus convention. |
| **Haiku 2-axis classification** (outcome × reasoning) | Captures Duke's "resulting" — distinguishes lucky hits from skilled hits, and wrong-for-right-reasons from wrong-for-wrong-reasons | More complex prompt; two LLM judgments rather than one (still one Haiku call with a 2-field JSON output) | **Recommended as an M007 extension** — separates the two signals that matter most for pattern detection later. |
| **Manual classification** (Greg types hit/miss/partial) | Zero LLM cost; Greg's own frame | Greg will be systematically wrong (hindsight bias; motivated reasoning) — exactly the failure mode the archive exists to counter | **Rejected.** The whole point is that reality, not Greg, is the validator. |

### Proposed scoring approach for M007

1. On resolution, Haiku reads `(prediction, resolution_notes)` and outputs:
   ```
   { outcome_class: "hit"|"miss"|"partial"|"ambiguous",
     reasoning_class: "confirmed"|"partially_confirmed"|"contradicted"|"inconclusive",
     confidence: 0.0–1.0 }
   ```
2. If `confidence < 0.6`, store as `unclassified` and don't count in stats — show Greg the raw fields and let him annotate.
3. `/decisions` stats over rolling 30/90/365-day windows show:
   - Hit rate: `hit / (hit + miss + partial*0.5)` (ambiguous and unclassified excluded from denominator)
   - Reasoning accuracy: `confirmed / (confirmed + contradicted + partial*0.5)`
   - Sample size (always — small-n warning below 5)
   - "Not enough data" if n < 3 in the window

### Deferred to M013 (explicit)

- Opus synthesis of *where* Greg's reasoning systematically fails (domain-specific calibration)
- Calibration curves (require far more data than M007 will have)
- Comparison to a baseline "what if Greg had flipped a coin" — interesting but premature

---

## Resolution prompts without feeling naggy (direct answer to question b)

Drawn from Duke's "decision interrupts" principle and Parrish's review cadence:

1. **One prompt per decision per lifecycle — not recurring.** Miss a resolution? 1 gentle reminder at 72h, then silent `stale`. No second, third, fourth.
2. **Embedded in natural conversation, not as a notification.** Chris in JOURNAL/REFLECT mode references the due decision in context. Example: Greg writes about his week → Chris responds naturally, then appends *"also — on March 3 you thought X would happen by today. Did it?"*
3. **Respect mute state.** Due prompts queue during mute, surface one-at-a-time on unmute with 24h spacing.
4. **Natural-language paraphrase, not raw field echo.** *"Six weeks ago you were weighing the Nice move — you predicted you'd feel settled within 30 days. Did that happen?"* beats *"Decision #47 is due: 'I predict I will feel settled within 30 days.'"*
5. **Never batch multiple resolutions in one prompt.** One decision per resolution conversation. Batching turns it into a form.
6. **Opt-in pull anytime** via `/decisions` — if Greg wants to review proactively, he can.
7. **Decision-Swear-Jar style interrupt at capture (not resolution) when pattern known**: "You've missed on 3 of your last 4 'I'll be settled by X' predictions — still want to set 30 days?" (This is M013; flagging here because it's the inverse of naggy — it's Chris earning the right to push back because he has data. Do NOT do this in M007 — too little data.)

---

## MVP Definition

### Launch M007 With (v2.1)

- [x] `decisions` table with the full schema in spec (id, captured_at, decision, alternatives, reasoning, prediction, falsification_criterion, resolve_by, status, resolution_notes, reviewed_at, plus recommended additions: `status_changed_at`, `outcome_class`, `reasoning_class`)
- [x] Trigger-phrase detection EN/FR/RU (spec'd)
- [x] 5-question capture with abort + multi-answer-in-one-message handling
- [x] Lifecycle FSM: `draft` → `open` → `due` → `resolved` → `reviewed`; side-paths to `withdrawn` / `stale` / `abandoned`
- [x] Resolution prompt via proactive sweep (24h window post `resolve_by`)
- [x] Free-text resolution capture + one follow-up question (picked by outcome class)
- [x] Haiku 2-axis classification (outcome × reasoning)
- [x] `/decisions` command — open / recently-resolved / rolling accuracy stats (30/90/365)
- [x] Both resolution and follow-up written as Pensieve entries with DECISION epistemic tag
- [x] Contradiction detection extended to `decisions.reasoning`
- [x] Pensieve retrieval at resolution time: surface ± 48h surrounding entries as context for the post-mortem
- [x] Synthetic fixture test with mock clock (spec'd)

### Add after validation (v2.2, post 2-week pause)

- [ ] Inferred `captured_context` snapshot (tired / anxious / calm) from surrounding Pensieve + time-of-day
- [ ] Partial-capture recovery prompts ("want to finish that decision from Tuesday?")
- [ ] Popper probe passive reference — at resolution time, surface Greg's original falsification criterion alongside the outcome

### Defer to M013+ (future milestones)

- [ ] Opus pattern detection across misses (needs 20+ resolved decisions)
- [ ] Auto-surface disconfirming evidence when it matches a falsification criterion (needs proactive sweep extension + enough data to calibrate the semantic match threshold)
- [ ] Domain-specific calibration (Greg is well-calibrated on finance, poorly on timing, etc.)
- [ ] Calibration curves
- [ ] Decision-swear-jar interrupt at capture when prior pattern known

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority | Rationale |
|---------|------------|---------------------|----------|-----------|
| `decisions` table + 5-question capture | HIGH | MEDIUM | P1 | The feature. Without capture there's nothing. |
| Trigger-phrase detection EN/FR/RU | HIGH | LOW | P1 | Low cost, halves the friction. |
| Resolution prompt via proactive sweep | HIGH | MEDIUM | P1 | Write-only archive is valueless. This closes the loop. |
| Haiku 2-axis outcome classification | HIGH | MEDIUM | P1 | Required for meaningful stats; separates Duke's "lucky hit" from "skilled hit." |
| Abort + multi-answer-in-one handling | MEDIUM | MEDIUM | P1 | Without it, mobile UX breaks and captures fail. |
| `/decisions` command + rolling stats | MEDIUM | MEDIUM | P1 | Visibility. |
| Pensieve retrieval at resolution (± 48h context) | HIGH | LOW | P1 | The differentiator. Cheap to implement given M001 infra. |
| Contradiction detection on `reasoning` field | MEDIUM | LOW | P1 | Cheap extension of M002; catches reasoning drift early. |
| Edge cases: withdrawn, stale, partial, ambiguous | HIGH | MEDIUM | P1 | Without these the FSM breaks in week 2 of real use. |
| Inferred `captured_context` | MEDIUM | MEDIUM | P2 | Nice signal but M009 wellbeing snapshot will give better data. |
| Partial-capture recovery prompts | MEDIUM | MEDIUM | P2 | Only matters when enough abandoned drafts accumulate. |
| Passive Popper criterion display at resolution | MEDIUM | LOW | P2 | Easy add, but not needed for MVP loop. |
| Opus pattern detection across misses | HIGH | HIGH | P3 | Needs data volume that doesn't exist yet. |
| Auto-fire Popper probe on disconfirming evidence | HIGH | HIGH | P3 | Requires semantic-search tuning against real data. |

---

## Competitor Feature Analysis

| Feature | Farnam Street template (Parrish) | Annie Duke / Decideo | Metaculus/Manifold | Chris M007 approach |
|---------|-----------------------------------|----------------------|---------------------|---------------------|
| Capture format | Printable PDF with 5 fields | Pocket-sized journal | Web form with probability slider | Telegram conversation, 5-question FSM, free-text |
| Prediction format | Free text + subjective probability | Free text + bet framing | 0–100% slider, sometimes numeric ranges | Free text, no forced probability |
| Resolution date | Manual calendar reminder | Manual review cadence | Hard deadline enforced by platform | `resolve_by` timestamp, surfaced via proactive sweep |
| Accuracy scoring | Self-scored at review | Self-scored + group discussion | Brier score (platform-computed) | Haiku 2-axis classification |
| Post-mortem | Single review question | Group discussion (decision group) | Comment thread on resolution | One follow-up question picked by outcome class |
| Ambiguous outcomes | Ignored / self-classified | Discussed | Formal `ambiguous` resolution; excluded from scoring | `ambiguous` class; excluded from hit-rate |
| Long-term pattern detection | Manual journal re-read | "Decision group" review | Personal calibration curve, leaderboard | Deferred to M013 Opus synthesis |
| Withdrawal of decision | Line through the entry | "Scratched" bet | `N/A` resolution | `withdrawn` status |
| Language | English only | English only | English only | EN/FR/RU native |

---

## Sources

### Primary domain references

- [How a Decision Journal Changed the Way I Make Decisions — Farnam Street (Shane Parrish)](https://fs.blog/decision-journal/) — 5-element template (decision / alternatives / expectations + probabilities / time + physical state / review cadence)
- [Farnam Street Decision Journal PDF template](https://fs.blog/wp-content/uploads/2017/02/decision-journal_draft3.pdf) — canonical field list
- [Thinking in Bets — Annie Duke, notes](https://calvinrosser.com/notes/thinking-in-bets-annie-duke/) — "decision interrupts," premortem/backcast, resulting bias, decision groups
- [Suzy Welch — 10-10-10 decision-making guide](https://www.oprah.com/spirit/suzy-welchs-rule-of-10-10-10-decision-making-guide) — multi-time-frame consequences
- [Superforecasting notes — Life Itself Collective (Tetlock/Gardner)](https://lifeitself.org/blog/notes-on-tetlock-and-gardners-superforecasting) — Brier scoring, calibration, ambiguity of resolution language
- [How Do You Evaluate Your Own Predictions? — Commoncog](https://commoncog.com/how-do-you-evaluate-your-own-predictions/) — personal-scale calibration pragmatics
- [Good Judgment Open FAQ](https://www.gjopen.com/faq) — Brier scoring mechanics

### Resolution / edge cases

- [Metaculus FAQ](https://www.metaculus.com/faq/) — formal definitions of Ambiguous, Annulled, N/A
- [Metaculus Question Writing Guidelines](https://www.metaculus.com/question-writing/) — edge-case enumeration discipline
- [Ambiguity in Prediction Market Resolution is Harmful — LessWrong](https://www.lesswrong.com/posts/DpDnXHcPejd9tn8R5/ambiguity-in-prediction-market-resolution-is-harmful) — why resolution criteria precision matters
- [How bad is it to resolve a market as N/A? — Manifold](https://manifold.markets/dreev/how-bad-is-it-to-resolve-a-market-a) — community norms on withdrawn/annulled

### LLM-based forecast scoring

- [How well can large language models predict the future? — Forecasting Research Institute](https://forecastingresearch.substack.com/p/ai-llm-forecasting-model-forecastbench-benchmark) — ForecastBench, LLM-superforecaster parity trajectory
- [Wisdom of the Silicon Crowd — Science Advances](https://www.science.org/doi/10.1126/sciadv.adp1528) — LLM ensemble forecasting approaches

### Post-mortem practice

- [50+ Post-Mortem Questions — Parabol](https://www.parabol.co/resources/post-mortem-questions/) — structured review templates (example of the anti-feature we're *not* copying)
- [Project Post-Mortem Review Questions](https://worthsharingessays1.pressbooks.com/chapter/project-post-mortem-review-questions/) — compared against one-question review cadence

### Internal Chris context

- `/home/claude/chris/.planning/PROJECT.md` — milestone roadmap, decisions D001–D033
- `/home/claude/chris/M007_Decision_Archive.md` — milestone spec
- `/home/claude/chris/PRD_Project_Chris.md` — soul-system framing; "if you only get one layer right, make it the decision archive"

---

*Feature research for: M007 Decision Archive*
*Researched: 2026-04-15*
*Confidence: MEDIUM-HIGH (domain literature convergent; scoring recommendations LOW-MEDIUM — flag for validation against real resolved decisions after 2-week pause)*
