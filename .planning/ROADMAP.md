# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15) — see [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)
- 🚧 **v2.1 M007 Decision Archive** — Phases 13-18 (started 2026-04-15)

## Phases

<details>
<summary>✅ v1.0 Phases 1-5 — SHIPPED 2026-04-13</summary>

- [x] **Phase 1: Foundation** — M001 Living Memory — Pensieve, 6-mode engine, Telegram bot
- [x] **Phase 2: Depth** — M002 Deep Counsel — 6-mode auto-detection, contradiction detection, hybrid retrieval
- [x] **Phase 3: External Sources** — M003 Digital Life — Gmail, Immich, Drive, file upload, cron sync
- [x] **Phase 4: Proactive Chris** — M004 — Proactive sweep with silence/commitment/pattern/thread triggers
- [x] **Phase 5: Requirement Validation** — M005 — All 28 v1.0 requirements resolved

</details>

<details>
<summary>✅ v2.0 Phases 6-12 — SHIPPED 2026-04-15</summary>

- [x] **Phase 6: Memory Audit** — Ground truth module + production Pensieve reconciled (5/5 plans)
- [x] **Phase 7: Foundational Behavioral Fixes** — Constitutional preamble, refusal handling, franc language detection (4/4 plans)
- [x] **Phase 8: Retrieval & Grounding** — JOURNAL hybrid retrieval, structured Known Facts injection (2/2 plans)
- [x] **Phase 9: Praise Quarantine** — Haiku post-processor for JOURNAL/REFLECT/PRODUCE (2/2 plans)
- [x] **Phase 10: Live Validation Suite** — 24-case live suite + 20-pair FP audit against real Sonnet (2/2 plans)
- [x] **Phase 11: Identity Grounding** — John→Greg unification, includeDate gating (3/3 plans)
- [x] **Phase 12: Identity rename residuals + frontmatter hygiene** — Tech-debt closure (1/1 plan)

See [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md) for full phase detail.

</details>

### 🚧 v2.1 M007 Decision Archive (Phases 13-18)

- [x] **Phase 13: Schema & Lifecycle Primitives** — Append-only `decision_events`, projection `decisions`, capture-state table, transition chokepoint with optimistic concurrency (completed 2026-04-15)
- [x] **Phase 14: Capture Flow** — Two-phase trigger detection (regex + Haiku stakes), conversational 5-slot extraction, vague-prediction validator, pre-processors wired into engine (completed 2026-04-16)
- [x] **Phase 15: Deadline Trigger & Sweep Integration** — Fifth SQL-first trigger at priority=2, channel separation (`reflective_outreach` vs `accountability_outreach`), dated stale-context prompts (completed 2026-04-16)
- [x] **Phase 16: Resolution, Post-Mortem & ACCOUNTABILITY Mode** — New ACCOUNTABILITY mode bypassing praise quarantine, Pensieve-first write ordering, ±48h context retrieval, auto-escalation after 2 non-replies (completed 2026-04-16)
- [x] **Phase 17: `/decisions` Command & Accuracy Stats** — Haiku 2-axis classification cached with model version, N≥10 floor, Wilson 95% CI, domain-tag breakdown (completed 2026-04-16)
- [ ] **Phase 18: Synthetic Fixture + Live ACCOUNTABILITY Integration Suite** — End-to-end `vi.setSystemTime` fixture covering concurrency races + same-day collision + stale-context; live 3-of-3 Sonnet suite for hit/miss/unverifiable

## Phase Details

### Phase 13: Schema & Lifecycle Primitives
**Goal**: The database encodes decision lifecycle invariants correctly and any illegal transition is structurally impossible — nothing else in M007 can be built safely without this layer.
**Depends on**: v2.0 Phase 12 (milestone complete)
**Requirements**: LIFE-01, LIFE-02, LIFE-03, LIFE-04, LIFE-06
**Success Criteria** (what must be TRUE):
  1. `decisions`, `decision_events`, `decision_capture_state` tables exist in Drizzle schema with `pgEnum` for `decision_status` (including `open-draft`/`withdrawn`/`stale`/`abandoned`) and `decision_capture_stage`, auto-migrated cleanly against Docker Postgres.
  2. `decision_events` is append-only: every status transition and field change is a new row, and the current `decisions` row is regenerable by replaying events.
  3. `transitionDecision(id, toStatus, payload)` is the only code path that mutates `decisions.status`; it uses `UPDATE … WHERE id=$id AND status=$expected` and throws `InvalidTransitionError` on any move outside the legal map.
  4. `decisions.falsification_criterion` is `NOT NULL` at the DB layer and `resolve_by` is `NOT NULL`; unit tests cover every illegal transition and the optimistic-concurrency race.
  5. A new `DECISION` value is added to the epistemic-tag enum so decision summaries cannot be picked up by the commitment trigger.
**Plans**: 5 plans
Plans:
- [x] 13-01-PLAN.md — Wave 0: failing test scaffolds for schema/lifecycle/regenerate/concurrency/capture-state/chokepoint-audit
- [x] 13-02-PLAN.md — Schema additions (pgEnums + 3 tables + DECISION epistemic tag) and migrations 0002/0003
- [x] 13-03-PLAN.md — [BLOCKING] Push migrations to Docker Postgres; schema.test.ts GREEN
- [x] 13-04-PLAN.md — Lifecycle chokepoint: errors.ts + lifecycle.ts + capture-state.ts; lifecycle/capture-state/chokepoint tests GREEN
- [x] 13-05-PLAN.md — regenerate.ts + concurrency pass + full npm test GREEN

### Phase 14: Capture Flow
**Goal**: A structural decision mentioned in any of Greg's three languages becomes a durable, falsifiable `decisions` row without the capture conversation ever feeling like an interrogation.
**Depends on**: Phase 13
**Requirements**: CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, LIFE-05, SWEEP-03
**Success Criteria** (what must be TRUE):
  1. Two-phase detection ships atomically: Phase A regex matches EN/FR/RU decision phrases, Phase B Haiku stakes classifier returns `trivial`/`moderate`/`structural`, and only `structural` activates capture (guards C3).
  2. 5-slot capture runs as conversational Haiku extraction — one-message multi-answer is consolidated without re-prompting; a 3-turn follow-up cap plus EN/FR/RU abort phrase cleanly dismisses the flow.
  3. Engine pre-processor #0 checks `decision_capture_state` before mute/refusal/language/mode detection, so a capture or resolution sub-flow never reaches `detectMode()`.
  4. `resolve_by` parses natural-language timeframes with a documented 7/30/90/365-day fallback ladder; vague predictions are flagged by a Haiku validator that pushes back exactly once before accepting or routing to `open-draft`.
  5. Greg can suppress a trigger phrase or captured decision via `/decisions suppress <phrase>` and the suppression persists across restarts; contradiction detection scans new `decisions.reasoning` entries fire-and-forget with the existing 0.75/3s thresholds.
**Plans**: 5 plans
Plans:
- [x] 14-01-PLAN.md — Wave 0: schema 0004, prompt constants, trigger fixtures, six RED test scaffolds
- [x] 14-02-PLAN.md — Wave 1: CAP-01 — Phase A regex (EN/FR/RU with parity) + Phase B Haiku stakes classifier (fail-closed)
- [x] 14-03-PLAN.md — Wave 1: CAP-06 primitive — DB-backed suppressions with per-chat substring match
- [x] 14-04-PLAN.md — Wave 1: CAP-02/03/04/05 + LIFE-05 — capture.ts, resolve-by.ts, vague-validator.ts, capture-state write helpers
- [x] 14-05-PLAN.md — Wave 2: SWEEP-03 + CAP-06 surface — engine PP#0/PP#1 wiring + /decisions suppress bot command

### Phase 15: Deadline Trigger & Sweep Integration
**Goal**: When a decision's `resolve_by` passes, Chris surfaces the resolution prompt within 24 hours without starving or being starved by the four existing reflective-outreach triggers.
**Depends on**: Phase 14
**Requirements**: SWEEP-01, SWEEP-02, SWEEP-04
**Success Criteria** (what must be TRUE):
  1. A new `decision-deadline` trigger implements the existing `TriggerDetector` interface at priority=2 (between silence=1 and commitment=3) and transitions exactly one oldest-due decision `open → due` before `sendMessage`.
  2. The sweep has two independent channels — `reflective_outreach` and `accountability_outreach` — with separate daily caps; same-day collisions fire serially, neither blocking the other (guards C5).
  3. When a prompt fires more than 48 hours past `resolve_by`, the text is explicitly dated ("On 2026-04-01 you predicted…") rather than implicitly recent-framed.
  4. Global mute suppresses both channels; the accountability channel never bypasses mute.
**Plans**: 3 plans
Plans:
- [x] 15-01-PLAN.md — Wave 1: deadline trigger factory + priority renumbering + tests (SWEEP-01, SWEEP-04)
- [x] 15-02-PLAN.md — Wave 1: channel-aware state helpers + ACCOUNTABILITY_SYSTEM_PROMPT (SWEEP-02)
- [x] 15-03-PLAN.md — Wave 2: dual-channel sweep refactor + upsertAwaitingResolution + sweep tests (SWEEP-01, SWEEP-02, SWEEP-04)

### Phase 16: Resolution, Post-Mortem & ACCOUNTABILITY Mode
**Goal**: A resolution reply produces a neutral, Pensieve-grounded post-mortem that neither flatters a hit nor condemns a miss — or M007 inverts M006.
**Depends on**: Phase 15
**Requirements**: RES-01, RES-02, RES-03, RES-04, RES-05, RES-06
**Success Criteria** (what must be TRUE):
  1. ACCOUNTABILITY mode exists (or COACH is explicitly extended) with a system prompt that bypasses the praise quarantine at the prompt level and forbids The Hard Rule (D027) language explicitly (guards C7).
  2. Resolution prompts surface within 24h of `resolve_by`, cite the original prediction and falsification criterion in the language of Greg's last user message, and route through the pre-processor on `decision_capture_state = AWAITING_RESOLUTION`.
  3. After resolution, exactly one Haiku-classified post-mortem follow-up fires (hit/miss/ambiguous/unverifiable); response stored in `resolution_notes`, decision transitions `resolved → reviewed`, and both replies become Pensieve entries with `source_ref_id` pointing at the decision row.
  4. Post-mortem context includes ±48h of surrounding Pensieve entries (cheap M001 reuse) and passively re-displays the Popper criterion.
  5. Auto-escalation sends a single second prompt after 48h of silence; two non-replies transitions the decision to `stale` and no further prompts fire.
**Plans**: 5 plans
Plans:
- [x] 16-01-PLAN.md — Wave 0: RED test scaffolds for resolution, engine-routing, sweep-escalation
- [x] 16-02-PLAN.md — Wave 1: RES-01 — ACCOUNTABILITY mode registration (ChrisMode, buildSystemPrompt, praise quarantine bypass)
- [x] 16-03-PLAN.md — Wave 1: RES-02/03/04/05 — resolution.ts (handleResolution, handlePostmortem, classifyOutcome) + getTemporalPensieve + updateToAwaitingPostmortem
- [x] 16-04-PLAN.md — Wave 2: RES-02/03 — engine PP#0 wiring (AWAITING_RESOLUTION/AWAITING_POSTMORTEM routing) + engine-resolution tests GREEN
- [x] 16-05-PLAN.md — Wave 2: RES-06 — sweep escalation (proactive_state keys, 48h follow-up, stale transition) + sweep-escalation tests GREEN

### Phase 17: `/decisions` Command & Accuracy Stats
**Goal**: Greg can pull an honest snapshot of his forecasting performance that is structurally incapable of becoming dashboard sycophancy — small N never produces a percentage, and uncertainty is visually present.
**Depends on**: Phase 16
**Requirements**: STAT-01, STAT-02, STAT-03, STAT-04, STAT-05
**Success Criteria** (what must be TRUE):
  1. `/decisions` command (and sub-commands `open`, `recent`, `stats [30|90|365]`, `suppress <phrase>`, `reclassify`) is registered before the generic text handler and is pull-only — Chris never unprompted-pushes stats.
  2. Accuracy is computed once at resolution time via 2-axis Haiku classification (`outcome` × `reasoning`), cached on the `decision_events` row alongside the model version string, and never recomputed on read (guards M4).
  3. Below N=10 resolved-with-verifiable-forecasts in the chosen window, the output shows counts only ("N=<count>, threshold not met") with no percentage; at or above N=10, accuracy displays with a Wilson 95% CI alongside the point estimate (guards C6).
  4. Rolling 30/90/365-day windows are a single SQL round-trip via `FILTER (WHERE resolved_at >= now() - interval 'N days')`; `unverifiable` count is surfaced as an explicit separate denominator.
  5. Accuracy is broken down by domain tag inferred at capture time; `/decisions reclassify` re-runs classification and preserves originals alongside new values.
**Plans**: 3 plans
Plans:
- [x] 17-01-PLAN.md — classifyAccuracy reasoning-axis Haiku classifier + resolution hook (STAT-02)
- [x] 17-02-PLAN.md — Stats SQL queries, Wilson CI, output formatters, removeSuppression (STAT-03, STAT-04)
- [x] 17-03-PLAN.md — /decisions command sub-commands wiring + reclassify (STAT-01, STAT-05)

### Phase 18: Synthetic Fixture + Live ACCOUNTABILITY Integration Suite
**Goal**: Every claim in Phases 13-17 is verifiable without calendar waiting, and the ACCOUNTABILITY mode's absence-of-flattery and absence-of-condemnation are proven against real Sonnet before production deploy.
**Depends on**: Phase 17
**Requirements**: TEST-10, TEST-11, TEST-12, TEST-13, TEST-14
**Success Criteria** (what must be TRUE):
  1. A single `vi.useFakeTimers` / `vi.setSystemTime` fixture exercises capture -> `resolve_by` passing -> sweep fires deadline prompt -> resolution reply -> post-mortem -> `/decisions stats` over a simulated 14-day window, with no real calendar time elapsed and no skipped tests (honours D018).
  2. A concurrency race test proves sweep and user-reply attempting to transition the same decision simultaneously resolve with exactly one winner, and `decision_events` reflects the rejected attempt.
  3. A same-day collision test proves decision-deadline and silence triggers firing on the same mock-clock day serialize cleanly without either starving the other.
  4. Live ACCOUNTABILITY integration suite runs hit/miss/unverifiable scenarios x 3-of-3 against real Sonnet and asserts both absence-of-flattery and absence-of-condemnation (follows D023/D032 precedent -- non-optional).
  5. Vague-prediction resistance test confirms the Haiku validator flags >=9 of 10 adversarial vague predictions on first pass and issues exactly one pushback before accepting.
**Plans**: 2 plans
Plans:
- [ ] 18-01-PLAN.md — Wave 1: synthetic-fixture.test.ts (TEST-10 14-day lifecycle, TEST-11 concurrency race, TEST-12 same-day collision)
- [ ] 18-02-PLAN.md — Wave 1: live-accountability.test.ts (TEST-13 hit/miss/unverifiable x 3-of-3) + vague-validator-live.test.ts (TEST-14 adversarial vagueness)

## Progress

| Phase                             | Milestone | Plans | Status       | Completed  |
| --------------------------------- | --------- | ----- | ------------ | ---------- |
| 1. Foundation                     | v1.0      | -     | Complete     | 2026-04-13 |
| 2. Depth                          | v1.0      | -     | Complete     | 2026-04-13 |
| 3. External Sources               | v1.0      | -     | Complete     | 2026-04-13 |
| 4. Proactive Chris                | v1.0      | -     | Complete     | 2026-04-13 |
| 5. Requirement Validation         | v1.0      | -     | Complete     | 2026-04-13 |
| 6. Memory Audit                   | v2.0      | 5/5   | Complete     | 2026-04-13 |
| 7. Foundational Behavioral Fixes  | v2.0      | 4/4   | Complete     | 2026-04-13 |
| 8. Retrieval & Grounding          | v2.0      | 2/2   | Complete     | 2026-04-13 |
| 9. Praise Quarantine              | v2.0      | 2/2   | Complete     | 2026-04-13 |
| 10. Live Validation Suite         | v2.0      | 2/2   | Complete     | 2026-04-14 |
| 11. Identity Grounding            | v2.0      | 3/3   | Complete     | 2026-04-15 |
| 12. Identity rename residuals     | v2.0      | 1/1   | Complete     | 2026-04-15 |
| 13. Schema & Lifecycle Primitives | v2.1      | 5/5 | Complete   | 2026-04-15 |
| 14. Capture Flow                  | v2.1      | 5/5 | Complete    | 2026-04-16 |
| 15. Deadline Trigger & Sweep      | v2.1      | 3/3 | Complete    | 2026-04-16 |
| 16. Resolution + ACCOUNTABILITY   | v2.1      | 5/5 | Complete   | 2026-04-16 |
| 17. `/decisions` & Accuracy Stats | v2.1      | 3/3 | Complete    | 2026-04-16 |
| 18. Synthetic + Live Suite        | v2.1      | 0/2   | Not started  | -          |

## v2.1 Coverage

**31/31 v2.1 requirements mapped ✓**

| Category  | Phase 13   | Phase 14    | Phase 15    | Phase 16 | Phase 17 | Phase 18 |
| --------- | ---------- | ----------- | ----------- | -------- | -------- | -------- |
| CAP (6)   |            | 01-06       |             |          |          |          |
| LIFE (6)  | 01,02,03,04,06 | 05      |             |          |          |          |
| RES (6)   |            |             |             | 01-06    |          |          |
| STAT (5)  |            |             |             |          | 01-05    |          |
| SWEEP (4) |            | 03          | 01,02,04    |          |          |          |
| TEST (5)  |            |             |             |          |          | 10-14    |

## Phase-to-Pitfall Guard Map (PITFALLS.md C1-C7)

| Phase | Guards          | Mechanism |
| ----- | --------------- | --------- |
| 13    | C4, M1          | Append-only `decision_events`; `falsification_criterion NOT NULL`; `resolve_by NOT NULL`; optimistic concurrency |
| 14    | C1, C2, C3, M5, M6 | Two-phase detection atomic (regex+Haiku stakes); conversational extraction; vague-prediction validator; EN/FR/RU fixture parity |
| 15    | C5, M3          | Channel separation (`reflective_outreach` vs `accountability_outreach`); serial collision; dated stale-context prompts |
| 16    | C7, M2, M6, m3  | ACCOUNTABILITY mode bypasses praise quarantine at prompt level; The Hard Rule forbidden; Pensieve-first writes; auto-escalation |
| 17    | C2, C6, M4      | N>=10 floor; Wilson 95% CI; unverifiable second denominator; materialized classifications with model version |
| 18    | C7 (flatline)   | Live Sonnet suite asserts absence-of-flattery AND absence-of-condemnation (D023/D032) |
