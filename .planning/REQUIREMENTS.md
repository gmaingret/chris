# Requirements: v2.1 M007 Decision Archive

**Defined:** 2026-04-15
**Milestone:** v2.1 M007 Decision Archive
**Core Value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.
**Milestone Goal:** Capture every structural decision Greg makes with reasoning and a falsifiable forecast, surface the forecast at its resolution date, and run a post-mortem — converting Chris from reflective journal into epistemic accountability tool.

## v2.1 Requirements — M007 Decision Archive

### Capture

- [ ] **CAP-01**: Two-phase decision trigger detection — Phase A regex matches decision phrases in EN/FR/RU ("I'm thinking about", "je réfléchis à", "я думаю о", plus full PRD set); Phase B Haiku stakes classifier (`trivial`/`moderate`/`structural`) gates capture — only `structural` activates the flow.
- [ ] **CAP-02**: 5-question guided capture is implemented as conversational extraction via Haiku structured output, not a rigid Q1→Q5 script — one-message multi-answer is consolidated without re-prompting.
- [ ] **CAP-03**: Capture has a 3-turn follow-up cap and accepts an abort/escape phrase ("never mind", EN/FR/RU) that cleanly dismisses the in-progress capture.
- [ ] **CAP-04**: `open-draft` partial-commit status exists — capture can land decisions with missing optional fields rather than null-stuffing or discarding.
- [ ] **CAP-05**: `resolve_by` accepts natural-language timeframes ("next week", "in 3 months", "by June") with a documented fallback ladder (7 / 30 / 90 / 365 days) when Haiku cannot parse.
- [ ] **CAP-06**: Per-user trigger-suppression list — Greg can mark phrases or specific captured-decision ids as "don't trigger on this pattern again" via a `/decisions suppress <phrase>` sub-command.

### Lifecycle

- [ ] **LIFE-01**: `decisions` + `decision_events` + `decision_capture_state` tables added to Drizzle schema with `pgEnum` types for `decision_status` (`open-draft`/`open`/`due`/`resolved`/`reviewed`/`withdrawn`/`stale`/`abandoned`) and `decision_capture_stage`.
- [ ] **LIFE-02**: `decision_events` is append-only — every status transition and field change is inserted as a new event row; `decisions` table is a projection over this log. Mutable status column is legal only because regenerable from events.
- [ ] **LIFE-03**: Single `transitionDecision(id, toStatus, payload)` chokepoint enforces the legal transition map and uses optimistic concurrency (`UPDATE … WHERE id=$id AND status=$expected`). Illegal transitions throw and are covered by unit tests.
- [ ] **LIFE-04**: `decisions.falsification_criterion` is `NOT NULL`; Haiku validator flags hedge-only predictions ("probably fine", "it should work out") at capture time and issues one pushback before accepting.
- [ ] **LIFE-05**: Contradiction detection (M002) is extended to scan new `decisions.reasoning` entries against existing Pensieve entries; confidence ≥ 0.75; 3-second timeout; fire-and-forget.
- [ ] **LIFE-06**: New `DECISION` value added to the epistemic-tag enum; decision summary is tagged `DECISION` (not reused `INTENTION`) to prevent the commitment trigger from double-firing on captured decisions.

### Resolution

- [ ] **RES-01**: New `ACCOUNTABILITY` mode (or explicit COACH extension chosen at plan-phase) bypasses the praise quarantine at the prompt level — follows the COACH/PSYCHOLOGY bypass pattern (D025). The Hard Rule (D027) is forbidden explicitly in the mode's system prompt.
- [ ] **RES-02**: Resolution prompts surface within 24 hours of `resolve_by` passing; prompt text cites the original prediction and asks "what actually happened?" in Greg's language of the last user message.
- [ ] **RES-03**: When Greg responds to a resolution prompt, the engine pre-processor intercepts (based on `decision_capture_state = AWAITING_RESOLUTION`) and routes to the resolution handler instead of normal mode detection — response is stored in `resolution` and `decisions` transitions `due → resolved`.
- [ ] **RES-04**: After resolution, exactly one post-mortem follow-up question is asked (chosen by Haiku-classified outcome class: hit/miss/ambiguous/unverifiable). Response stored in `resolution_notes`; `decisions` transitions `resolved → reviewed`. Both responses become Pensieve entries with `source_ref_id` pointing to the decision row.
- [ ] **RES-05**: Resolution includes ±48h Pensieve retrieval surfacing surrounding entries as context for the post-mortem prompt (cheap M001 reuse). Popper falsification criterion is re-displayed passively in the prompt.
- [ ] **RES-06**: Auto-escalation — if Greg does not respond to a resolution prompt within 48 hours, a second prompt is sent once. After 2 non-replies the decision transitions to `stale` and no further prompts fire (but `/decisions` still surfaces it).

### Stats

- [ ] **STAT-01**: `/decisions` Telegram command with sub-commands: no args (summary), `open`, `recent`, `stats [30|90|365]`, `suppress <phrase>`, `reclassify`. Pull-only — Chris never unprompted-pushes stats.
- [ ] **STAT-02**: Accuracy computed via 2-axis Haiku classification (`outcome` ∈ hit/miss/partial/ambiguous/unverifiable × `reasoning` ∈ sound/lucky/flawed) cached on the `decision_events` row with model version string; never recomputed on read.
- [ ] **STAT-03**: N≥10 floor — no accuracy percentage is displayed below 10 resolved decisions in the chosen window; instead shows "N=<count>, threshold not met". Above floor, Wilson 95% confidence intervals are rendered alongside the point estimate.
- [ ] **STAT-04**: Rolling 30 / 90 / 365-day windows computed in SQL via `FILTER (WHERE resolved_at >= now() - interval 'N days')` — single round-trip, timezone-correct. `unverifiable` count surfaced explicitly as a separate denominator.
- [ ] **STAT-05**: Domain-tag breakdown — accuracy computed per domain tag inferred by Haiku at capture time; `/decisions reclassify` admin sub-command re-runs classification when model version changes, preserving originals alongside new values.

### Scheduler / Sweep

- [ ] **SWEEP-01**: New `decision-deadline` trigger added to the proactive sweep as a fifth SQL-first trigger at priority=2 (between silence=1 and commitment=3). Extends existing `TriggerDetector` interface per D010 two-phase execution.
- [ ] **SWEEP-02**: Channel separation — sweep daily cap is split into `reflective_outreach` (silence/commitment/pattern/thread, existing behavior) and `accountability_outreach` (decision-deadline) with independent caps; on same-day collision the channels fire serially, not one blocking the other.
- [ ] **SWEEP-03**: Engine pre-processor #0 checks `decision_capture_state` BEFORE mute/refusal/language/mode detection — rows in `AWAITING_RESOLUTION` / `AWAITING_POSTMORTEM` / `CAPTURING` bypass normal routing and go directly to the capture/resolution handler.
- [ ] **SWEEP-04**: Stale-context prompt text — when a resolution prompt fires more than 48 hours past `resolve_by`, the prompt is explicitly dated ("On 2026-04-01 you predicted…") rather than implicitly recent-framed.

### Testing & Validation

- [ ] **TEST-10**: End-to-end synthetic fixture test using `vi.useFakeTimers` / `vi.setSystemTime` — exercises capture → deadline transition → resolution prompt → post-mortem → stats under a simulated 14-day window. No real calendar time.
- [ ] **TEST-11**: Concurrency race test — sweep and user-reply attempting to transition the same decision simultaneously; optimistic concurrency resolves cleanly with exactly one winner, `decision_events` reflects attempted-and-rejected transition.
- [ ] **TEST-12**: Same-day trigger collision test — decision-deadline and silence triggers both fire on the same mock-clock day; validates channel separation fires both serially without either starving the other.
- [ ] **TEST-13**: Live ACCOUNTABILITY integration suite against real Sonnet — 3 scenarios (hit / miss / unverifiable) × 3-of-3 passes — asserts absence-of-flattery AND absence-of-condemnation; follows the D023/D032 live-suite pattern.
- [ ] **TEST-14**: Vague-prediction resistance test — 10 adversarial vague predictions ("probably fine", "it'll work out", "I think so") — Haiku validator flags ≥ 9 on first pass and issues exactly one pushback before accepting.

## Future Requirements (deferred to v2.2 / M013)

- **FUTURE-M007-01**: Opus pattern detection across misses — requires ≥ 20 resolved decisions with outcome data before inference is meaningful.
- **FUTURE-M007-02**: Auto-fire Popper probe on disconfirming evidence discovered in Pensieve during proactive sweep.
- **FUTURE-M007-03**: Domain-specific calibration curves rendered as plain-text ASCII sparklines in `/decisions stats`.
- **FUTURE-M007-04**: Inferred `captured_context` — time-of-day + surrounding Pensieve auto-attached to capture row.
- **FUTURE-M007-05**: Partial-capture recovery prompts — "you started capturing a decision 3 days ago but didn't finish; want to resume?"

## Out of Scope (explicit exclusions)

- **OOS-M007-01**: Forced numeric probability on predictions — full Brier scoring pipeline. *Reason:* Brier requires ≥ 100 forecasts per probability bucket for meaningful calibration; Greg's expected ~20/year is orders of magnitude below. Free-text predictions + Haiku classification give more signal per entry.
- **OOS-M007-02**: Auto-resolving decisions by scanning Pensieve for outcome. *Reason:* Resolution is an epistemic event (Greg naming the outcome in his words); automating it converts accountability into box-ticking and collapses the post-mortem cadence.
- **OOS-M007-03**: Editing captured reasoning after outcome is known. *Reason:* Defeats the entire purpose — the archive must preserve what Greg actually thought at decision time.
- **OOS-M007-04**: Multi-question structured post-mortems. *Reason:* Duke/Parrish agree one open question outperforms structured forms (fatigue + script-completion gaming).
- **OOS-M007-05**: Unprompted accuracy-stat pushes ("your 30-day accuracy dropped to 45%"). *Reason:* Stat pushes fail on both edges — flattery when high, punishment when low. Accountability is an answer to a question, not a notification.
- **OOS-M007-06**: Charts, graphs, or visualizations in Telegram output. *Reason:* Plain-text-only UX discipline; a number with a CI beats a sparkline in chat.
- **OOS-M007-07**: Betting / stakes / prediction-market mechanics. *Reason:* Category error — Chris is an archive, not a prediction market.

## Traceability

(filled by roadmapper after phase structure is approved)

| Requirement | Phase | Status  | Notes |
|-------------|-------|---------|-------|
| CAP-01 … TEST-14 | TBD | Pending | — |

---

*Defined: 2026-04-15*
