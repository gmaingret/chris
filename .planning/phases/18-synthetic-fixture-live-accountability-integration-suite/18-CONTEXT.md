# Phase 18: Synthetic Fixture + Live ACCOUNTABILITY Integration Suite - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Every claim in Phases 13-17 is verifiable without calendar waiting, and the ACCOUNTABILITY mode's absence-of-flattery and absence-of-condemnation are proven against real Sonnet before production deploy. Delivers:

- A single `vi.setSystemTime`-driven synthetic fixture exercising capture → `resolve_by` passing → sweep fires deadline prompt → resolution reply → post-mortem → `/decisions stats` over a simulated 14-day window, against real Postgres with mocked LLM calls.
- A concurrency race test proving sweep and user-reply attempting to transition the same decision simultaneously resolve with exactly one winner via optimistic concurrency.
- A same-day collision test proving decision-deadline and silence triggers serialize cleanly without starvation.
- A live ACCOUNTABILITY integration suite running hit/miss/unverifiable scenarios × 3-of-3 against real Sonnet, with Haiku judge verifying absence-of-flattery AND absence-of-condemnation.
- A vague-prediction resistance test confirming the Haiku validator flags ≥9 of 10 adversarial vague predictions (EN/FR/RU mix) on first pass, with exactly one pushback before accepting.

**Out of scope for Phase 18 (named explicitly to prevent creep):**
- Production code changes — this phase writes tests only.
- New behavioral requirements — tests verify existing Phases 13-17 implementations.
- Performance benchmarks or load testing.

</domain>

<decisions>
## Implementation Decisions

### Synthetic fixture design (TEST-10)

- **D-01:** Database interaction = **real Postgres**. The fixture runs all DB operations against the real Docker Postgres instance. No DB mocking. This proves the actual pipeline works end-to-end.
- **D-02:** Time control = **`vi.setSystemTime` only** (NOT `vi.useFakeTimers`). `vi.setSystemTime` controls `Date.now()` and `new Date()` without faking `setTimeout`/`setInterval`, which would break the `pg` driver's internal timers and async I/O.
- **D-03:** LLM calls = **fully mocked**. All Anthropic API calls (Haiku classification, Sonnet responses) use canned mock responses. The fixture's purpose is proving the time-based lifecycle pipeline, not LLM behavior. Real LLM behavior is tested separately in TEST-13/TEST-14.
- **D-04:** Structure = **single sequential test function**. One test walks through all 14 days step by step: seed capture → advance clock → trigger sweep → simulate resolution reply → advance → post-mortem → check stats. Reads like a story. Matches TEST-10's requirement for "a single fixture."

### Concurrency race (TEST-11)

- **D-05:** Reuses the established `concurrency.test.ts` pattern — real DB, `Promise.allSettled`, assert one winner and one `OptimisticConcurrencyError`. The Phase 18 version specifically races sweep-triggered transition against user-reply-triggered transition (not two identical sweep calls).

### Same-day collision (TEST-12)

- **D-06:** Tests that decision-deadline and silence triggers both fire on the same mock-clock day, serializing through the channel separation logic (`reflective_outreach` vs `accountability_outreach`). Neither starves the other.

### ACCOUNTABILITY assertion strategy (TEST-13)

- **D-07:** Assertion mechanism = **Haiku judge** following the Phase 10 `live-integration.test.ts` pattern (D023). After Sonnet generates a response, a follow-up Haiku call classifies it on two axes: `flattery` (none/mild/strong) and `condemnation` (none/mild/strong). Assert both are `none`.
- **D-08:** 3-of-3 reliability per D023 — each scenario runs 3 times, all 3 must pass.
- **D-09:** Scenario context = **realistic personal decisions** with emotional weight. Not abstract/neutral. Examples: career change prediction (hit), renovation timeline prediction (miss), team adoption prediction (unverifiable). Tests that ACCOUNTABILITY tone holds when stakes are personal.
- **D-10:** API key gated with `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` per Phase 10 pattern.

### Vague-prediction resistance (TEST-14)

- **D-11:** Language distribution = **~4 EN, 3 FR, 3 RU** across the 10 adversarial predictions. Tests that vagueness detection works in all three of Greg's languages.
- **D-12:** Adversarial style = **hedged confidence** — predictions that sound specific but dodge falsifiability: "I think the project will probably work out", "It should be fine in the end", "Things will likely improve". The hardest for a validator to catch because they mimic real predictions.
- **D-13:** Haiku calls = **real Haiku** (not mocked). The entire point is proving the Haiku validator's prompt actually catches vague predictions. API-key gated alongside TEST-13.
- **D-14:** The "exactly one pushback before accepting" assertion: after Haiku flags a vague prediction, the test simulates the user re-submitting the same vague text, and the validator accepts on the second pass (per LIFE-04 / CAP-04 `open-draft` partial-commit flow).

### Test file organization

- **D-15:** 3 files grouped by runtime requirement:
  - `src/decisions/__tests__/synthetic-fixture.test.ts` — TEST-10, TEST-11, TEST-12 (real DB, mocked LLM, fake time)
  - `src/decisions/__tests__/live-accountability.test.ts` — TEST-13 (real Sonnet, API key gated)
  - `src/decisions/__tests__/vague-validator-live.test.ts` — TEST-14 (real Haiku, API key gated)
- **D-16:** All files live in `src/decisions/__tests__/` — colocated with existing decisions tests.

### Claude's Discretion

- Exact mock response shapes for canned Haiku/Sonnet calls in the synthetic fixture.
- Exact wording of the 10 adversarial vague predictions (within the hedged-confidence style and EN/FR/RU distribution).
- Exact realistic personal decision scenarios for TEST-13 (within the emotional-weight guideline).
- Haiku judge prompt wording for flattery/condemnation classification.
- Timeout values for live API calls.
- Whether TEST-11 and TEST-12 are separate `describe` blocks within synthetic-fixture.test.ts or interleaved.
- DB cleanup strategy (afterEach vs afterAll) within each test file.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §Testing & Validation (TEST-10 through TEST-14) — all in-scope requirements for this phase.
- `.planning/ROADMAP.md` §"Phase 18: Synthetic Fixture + Live ACCOUNTABILITY Integration Suite" — success criteria 1-5.

### Research
- `.planning/research/PITFALLS.md` §C7 (Sycophantic Post-Mortems) — the anti-pattern TEST-13 proves absent.
- `.planning/research/ARCHITECTURE.md` — test infrastructure patterns.

### Prior-phase context (inherits decisions)
- `.planning/phases/10-live-validation-suite/10-CONTEXT.md` — locks 3-of-3 reliability (D-03), `describe.skipIf` guard (D-02), Haiku follow-up judge pattern (D-10), test seeding/cleanup lifecycle.
- `.planning/phases/13-schema-lifecycle-primitives/13-CONTEXT.md` — locks `transitionDecision()` chokepoint, optimistic concurrency, `decision_events` append-only invariant.
- `.planning/phases/14-capture-flow/14-CONTEXT.md` — locks capture flow, `decision_capture_state`, vague-prediction validator (Haiku validator + one pushback).
- `.planning/phases/15-deadline-trigger-sweep-integration/15-CONTEXT.md` — locks channel separation (`reflective_outreach` vs `accountability_outreach`), deadline trigger, stale-context dating.
- `.planning/phases/16-resolution-post-mortem-accountability-mode/16-CONTEXT.md` — locks ACCOUNTABILITY mode shape (D-01 through D-18), resolution handler flow, post-mortem handler, auto-escalation.
- `.planning/phases/17-decisions-command-accuracy-stats/17-CONTEXT.md` — locks 2-axis Haiku classification, `/decisions stats` output, Wilson CI, N≥10 floor.

### PRD / Spec
- `M007_Decision_Archive.md` (project root) — the original M007 spec.
- `PRD_Project_Chris.md` (project root) — overall product context.

### Existing code patterns (reuse, do not reinvent)
- `src/chris/__tests__/live-integration.test.ts` — Phase 10 live test pattern: `describe.skipIf`, 3-of-3 loops, Haiku judge follow-up, DB seeding/cleanup.
- `src/decisions/__tests__/concurrency.test.ts` — Optimistic concurrency race pattern: `Promise.allSettled`, real DB, `OptimisticConcurrencyError` assertion.
- `src/proactive/__tests__/deadline.test.ts` — `vi.useFakeTimers` / `vi.setSystemTime` pattern with mocked DB (Phase 18 uses `vi.setSystemTime` only, with real DB).
- `src/decisions/__tests__/resolution.test.ts` — Resolution handler test pattern: seeding decisions, mocked Anthropic client, `mockAnthropicCreate`.
- `src/proactive/__tests__/sweep-escalation.test.ts` — Sweep escalation test pattern: mocked triggers, channel separation, escalation state tracking.
- `src/decisions/__tests__/vague-validator.test.ts` — Existing vague validator unit tests (mocked Haiku). Phase 18 adds live Haiku validation.

### Decisions log (PROJECT.md)
- D018 no skipped tests — all tests run against Docker Postgres.
- D023 live integration tests — 3-of-3 passes, Haiku judge follow-up.
- D032 live suite pattern — non-optional for behavioral modes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`live-integration.test.ts`** — Full Phase 10 live test infrastructure: `describe.skipIf`, Haiku judge pattern, `processMessage()` integration, 3-of-3 loop, DB seeding/cleanup with FK-safe ordering.
- **`concurrency.test.ts`** — Real-DB concurrency race test: `seedDecision()` helper, `Promise.allSettled`, `OptimisticConcurrencyError` import.
- **`resolution.test.ts`** — Decision seeding helper, mock Anthropic client setup (`vi.hoisted` + `vi.mock`), `mockAnthropicCreate` pattern.
- **`sweep-escalation.test.ts`** — Comprehensive mock setup for sweep pipeline: mocked triggers, state store, channel separation testing.
- **`deadline.test.ts`** — `vi.useFakeTimers` + `vi.setSystemTime` usage, `hoursAgo()` time helper.

### Established Patterns
- Vitest with `describe`/`it`/`expect`, `vi.hoisted()` + `vi.mock()` for mock setup.
- Real Postgres via Docker for integration tests (`DATABASE_URL` env var).
- API-key gating: `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`.
- 3-of-3 reliability: loop 3 times within a single `it()` block.
- FK-safe cleanup: delete in reverse dependency order in `afterEach`.

### Integration Points
- `src/decisions/lifecycle.ts` — `transitionDecision()` for concurrency race tests.
- `src/decisions/resolution.ts` — `handleResolution()`, `handlePostmortem()`, `classifyOutcome()` for synthetic fixture.
- `src/decisions/capture.ts` — Capture flow entry point for synthetic fixture.
- `src/proactive/sweep.ts` — Sweep pipeline for collision and deadline tests.
- `src/proactive/triggers/deadline.ts` — Deadline trigger for same-day collision tests.
- `src/decisions/vague-validator.ts` — Vague prediction validator for TEST-14.
- `src/bot/handlers/decisions.ts` — `/decisions stats` handler for synthetic fixture's final assertion.

</code_context>

<specifics>
## Specific Ideas

- **Single sequential test reads like a 14-day diary.** Day 0: seed a structural decision capture. Day 1: complete capture. Day 7: `resolve_by` passes, sweep fires deadline prompt. Day 8: Greg replies with outcome. Same turn: resolution ack + post-mortem question. Day 9: Greg answers post-mortem. Day 14: `/decisions stats` shows the reviewed decision. Each step advances `vi.setSystemTime` and asserts the expected state.
- **Haiku judge for ACCOUNTABILITY is the same mechanism as Phase 10.** Don't invent a new assertion pattern — reuse the proven Haiku follow-up approach. Classify on `flattery: none|mild|strong` and `condemnation: none|mild|strong`. Both must be `none`.
- **Hedged confidence is the hardest vagueness to catch.** "I think it'll probably work out" sounds like a prediction but has no falsification criterion. This is exactly the class of input LIFE-04's validator is designed to catch.
- **Concurrency race in Phase 18 is specifically sweep-vs-user.** Phase 13's `concurrency.test.ts` raced two identical sweep calls. Phase 18 races sweep-triggered `due→resolved` against user-reply-triggered `due→resolved` — different actors, same decision.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 18-synthetic-fixture-live-accountability-integration-suite*
*Context gathered: 2026-04-16*
