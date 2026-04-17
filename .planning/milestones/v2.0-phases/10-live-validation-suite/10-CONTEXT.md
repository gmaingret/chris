# Phase 10: Live Validation Suite - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify every behavioral fix in M006 (Phases 7-9) with live integration tests against real Sonnet and audit contradiction detection for false positives. This phase writes tests only — no production code changes. 24 live test cases (8 categories x 3 each, 3-of-3 passes) plus a 20-pair contradiction false-positive audit.

</domain>

<decisions>
## Implementation Decisions

### Test Infrastructure
- **D-01:** Single test file `src/chris/__tests__/live-integration.test.ts` for all 24 live integration cases. All cases share the same setup pattern (real Sonnet calls + seeded DB), so one file keeps them organized.
- **D-02:** Guard tests with `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` so `npm test` skips gracefully without an API key. Matches existing `models-smoke.test.ts` pattern.
- **D-03:** 3-of-3 reliability: each test case runs 3 times in a loop within the test function. All 3 must pass for the test to pass. This matches D023's intent and is the simplest implementation.

### Test Data & Seeding
- **D-04:** In-test seeding via direct DB inserts in `beforeAll`/`beforeEach`, cleaned up in `afterEach`. Matches the existing `contradiction-integration.test.ts` pattern. Self-contained, no external seed scripts needed.
- **D-05:** Import and use `GROUND_TRUTH` array from `src/pensieve/ground-truth.ts` directly for structured fact accuracy tests (TEST-07). This was explicitly designed for Phase 10 reuse per Phase 6 D-03.
- **D-06:** Multi-turn conversation context (topic persistence, language switching) simulated via `saveMessage()` + direct DB inserts to build conversation history.

### Contradiction False-Positive Audit
- **D-07:** Hardcoded fixture array of 20 adversarial non-contradictory pairs covering the 5 categories from the M006 spec: evolving circumstances, different aspects of same concept, time-bounded statements over different periods, conditional statements with different conditions, emotional vs factual statements. 4 pairs per category.
- **D-08:** Audit tests against real Haiku (the actual contradiction detection pipeline end-to-end). Consistent with the 'live' test philosophy of this phase.
- **D-09:** Separate test file `src/chris/__tests__/contradiction-false-positive.test.ts` since the audit has its own fixture structure and is conceptually distinct from the 24 behavioral tests.

### Test Execution Strategy
- **D-10:** JOURNAL grounding verification (TEST-03): After getting Chris's response, a separate Haiku call asks whether the response accurately reflects the seeded facts. Assert Haiku confirms accuracy.
- **D-11:** Sycophancy resistance (TEST-05): Present a weak argument and verify Chris pushes back rather than validating. Use keyword markers to distinguish engagement language from pure validation (per D023).
- **D-12:** Performative apology detection (TEST-08): Multi-turn test — call out Chris for a behavior, then verify the follow-up response shows actually-different behavior rather than rephrasing the same output.

### Claude's Discretion
- Exact test prompts/messages for each of the 24 test cases
- Which specific languages to use for EN/FR/RU refusal tests (the refusal phrases themselves)
- Haiku follow-up prompt wording for grounding verification
- Keyword markers for sycophancy detection
- Exact adversarial non-contradictory pair content (within the 5 specified categories)
- Timeout values for live API calls in tests
- Whether to use `processMessage()` (full engine pipeline) or individual mode handlers for each test

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Spec
- `M006_Trustworthy_Chris.md` — Full M006 spec with all 24 test case categories, contradiction audit description, and acceptance criteria
- `.planning/REQUIREMENTS.md` §TEST-01 through §TEST-09 — Individual test requirements with pass criteria

### Key Decisions
- `.planning/PROJECT.md` §Key Decisions D006 — 3-second timeout on contradiction detection, confidence >= 0.75
- `.planning/PROJECT.md` §Key Decisions D020 — Refusal detection is pattern-based (regex)
- `.planning/PROJECT.md` §Key Decisions D021 — Language detection uses franc with minimum-length threshold
- `.planning/PROJECT.md` §Key Decisions D023 — Live integration tests assert absence of bad behavior, 3-of-3 passes, Haiku follow-up for grounding
- `.planning/PROJECT.md` §Key Decisions D025 — Praise quarantine runs as engine post-processing
- `.planning/PROJECT.md` §Key Decisions D031 — Structured fact injection as key-value block
- `.planning/PROJECT.md` §Key Decisions D033 — Contradiction false-positive audit with 20 adversarial pairs

### Prior Phase Context
- `.planning/phases/07-foundational-behavioral-fixes/07-CONTEXT.md` — Refusal, preamble, language, question-pressure decisions
- `.planning/phases/08-retrieval-grounding/08-CONTEXT.md` — JOURNAL retrieval, structured facts, hallucination resistance decisions
- `.planning/phases/09-praise-quarantine/09-CONTEXT.md` — Praise quarantine pipeline placement and failure behavior

### Code (test infrastructure — reference patterns)
- `src/chris/__tests__/contradiction-integration.test.ts` — Existing DB integration test pattern (seed, test, cleanup)
- `src/llm/__tests__/models-smoke.test.ts` — Existing pattern for API-key-gated tests
- `src/pensieve/ground-truth.ts` — Ground truth data array (designed for Phase 10 reuse)

### Code (features being tested)
- `src/chris/engine.ts` — `processMessage()` — full engine pipeline
- `src/chris/refusal.ts` — Refusal detection and declined topics
- `src/chris/language.ts` — Language detection via franc
- `src/chris/personality.ts` — Constitutional preamble, buildSystemPrompt()
- `src/chris/modes/journal.ts` — JOURNAL mode with hybrid retrieval
- `src/chris/praise-quarantine.ts` — Praise quarantine post-processor
- `src/chris/contradiction.ts` — Contradiction detection pipeline

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `GROUND_TRUTH` array in `src/pensieve/ground-truth.ts` — 13 categorized facts, directly importable for test seeding and verification
- `contradiction-integration.test.ts` — Pattern for real-DB integration tests with seed/cleanup lifecycle
- `models-smoke.test.ts` — Pattern for API-key-gated test suites
- `processMessage()` in `src/chris/engine.ts` — Full engine pipeline entry point (mode detection -> handler -> praise quarantine -> contradiction detection)
- `saveMessage()` in `src/memory/conversation.ts` — Conversation history persistence for multi-turn tests
- `detectContradictions()` in `src/chris/contradiction.ts` — The contradiction pipeline being audited
- `detectRefusal()` in `src/chris/refusal.ts` — Refusal detection being tested
- `detectLanguage()` in `src/chris/language.ts` — Language detection being tested

### Established Patterns
- Vitest as test runner with `describe`/`it`/`expect`
- Real Postgres via Docker for integration tests (DATABASE_URL env var)
- Drizzle ORM for direct DB inserts/deletes in test setup/teardown
- `vi.hoisted()` + `vi.mock()` for mocking in unit tests (but these are live tests — minimal mocking)

### Integration Points
- Tests need real Anthropic API key (ANTHROPIC_API_KEY env var)
- Tests need real Postgres (DATABASE_URL env var, Docker Compose)
- Tests import from production source modules (engine, refusal, language, contradiction, etc.)

</code_context>

<specifics>
## Specific Ideas

- The M006 spec explicitly names 8 test categories with 3 cases each = 24 total, plus a separate 20-pair contradiction audit
- Tests must be "reproducible and can be re-run to catch regressions in future milestones" (success criteria 3)
- Contradiction audit specifically tests 5 adversarial categories: evolving circumstances, different aspects, time-bounded, conditional, emotional vs factual
- Haiku follow-up for grounding tests is explicitly called out in D023

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 10-live-validation-suite*
*Context gathered: 2026-04-13*
