# Phase 36: Tests — Context

**Gathered:** 2026-05-13 (via `/gsd-discuss-phase 36 --auto`)
**Status:** Ready for planning
**Prior phases:** Phase 33 ✓ (2026-05-11), Phase 34 ✓ (2026-05-12), Phase 35 ✓ (2026-05-13). M010 substrate + inference + surfaces all shipped + Docker-suite-green at 1612/0/1. Phase 36 closes the milestone.

<domain>
## Phase Boundary

Phase 36 ships the **M010-closing test phase** — the fixture generator extension + 4 fixture-driven integration tests + 1 live anti-hallucination gate that validate everything Phases 33-35 built. After this phase:

- `scripts/synthesize-delta.ts` gains a `--profile-bias <dimension>` flag that appends a per-dimension domain-keyword hint to the daily Haiku style-transfer prompt — produces ≥12 tagged Pensieve entries per profile dimension in a 30-day fixture (M010-05 mitigation; per-dimension threshold-crossing determinism is OQ-4 from research)
- `tests/fixtures/primed/m010-30days/` exists as a VCR-cached primed fixture covering all 4 profile dimensions; HARN sanity gate asserts ≥12 entries per dimension before any profile-update test runs
- `tests/fixtures/primed/m010-5days/` exists as a sparse fixture (5 entries per dimension) that exercises the below-threshold path
- Real-DB integration test loads `m010-30days`, runs `updateAllOperationalProfiles()`, asserts all 4 profiles populate with `confidence > 0`, every `last_updated` advances, `substrate_hash` is non-null (PTEST-02)
- Two-cycle integration test (HARD CO-LOC #M10-3 from Phase 34 honored at the fixture level): Cycle 1 populates from `m010-30days`; Cycle 2 with identical substrate → `mockAnthropicParse.toHaveBeenCalledTimes(4)` not 8, `profile_history` rows stay at 4; Cycle 2-with-substrate-B → `'profile_updated'` outcome (PTEST-03 — second-fire-blindness regression detector, direct M009 `lt→lte` lesson applied)
- Sparse-fixture test on `m010-5days` → all 4 profiles return `"insufficient data"` markers + `confidence=0` + `'chris.profile.threshold.below_minimum'` skip log; threshold-enforcement contract verified end-to-end (PTEST-04)
- Live 3-of-3 atomic anti-hallucination test against real Sonnet (PTEST-05): REFLECT-mode message with `m010-30days` substrate; assert system prompt contains the `## Operational Profile (grounded context — not interpretation)` block; assert Sonnet response does NOT assert facts outside the fixture's profile data — dual-gated by `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=...` per D-30-03 cost discipline; ~$0.20/run

**Explicitly NOT in this phase:** new profile generators, new mode handlers, new Sonnet prompts, schema changes, deployment to Proxmox, milestone close (`/gsd-complete-milestone` is a separate operator action).

**Inter-phase coupling:**
- **Upstream (consumes Phase 33):** Reader API, schemas, confidence module, profile_history table (Phase 33 D-04, D-15, D-17, D-19)
- **Upstream (consumes Phase 34):** `updateAllOperationalProfiles` orchestrator, `loadProfileSubstrate`, `computeSubstrateHash`, 4 per-dimension generators, two-cycle test scaffold from `generators.test.ts` (Phase 34 D-21, D-29, D-36)
- **Upstream (consumes Phase 35):** `getOperationalProfiles` reader (already shipped Phase 33), `PROFILE_INJECTION_MAP`, `formatProfilesForPrompt`, REFLECT mode wiring (Phase 35 D-08, D-12, D-14) — PTEST-05's live test asserts injection into the REFLECT system prompt
- **Upstream (consumes v2.3 substrate):** `scripts/synthesize-delta.ts`, `scripts/synthesize-episodic.ts`, `scripts/regenerate-primed.ts`, `loadPrimedFixture`, VCR cache, primed-sanity.test.ts scaffold (M008 Phase 24 D041 / TEST-15..21)
- **Downstream (consumed by):** `/gsd-complete-milestone` close (PTEST-01..05 all green is a milestone-gate); M011 / M012 / M013 (which will spawn new psychological/mental-model/character profiles using the same primed-fixture discipline established here)

</domain>

<decisions>
## Implementation Decisions

All decisions below are pre-recommended by the M010 research pass (`SUMMARY.md` Phase 36 entry lines 191-210, `PITFALLS.md` M010-05 lines 105-110, M010-10 lines 303-333). The `--auto` flag locked each at the recommended option. The planner should treat them as the contract surface and validate via the success criteria in ROADMAP.md Phase 36 entry (lines 93-105).

`[auto]` annotations record the gray area, the recommended option chosen, and the source.

### Plan split structure

- **D-01: 2 plans matching REQUIREMENTS traceability table.** `[auto]` Plan structure — Q: "How to split Phase 36?" → Selected: "2 plans (matches REQUIREMENTS PTEST-01..05 mapping at REQUIREMENTS.md:98-102, where PTEST-01..04 → Plan 36-01 and PTEST-05 → Plan 36-02)" (recommended default; mirrors Phase 33's 2-plan substrate split rhythm). Rationale: PTEST-01..04 share the same fixture-pipeline + Docker Postgres + mocked-SDK testbed and ship atomically as the synthetic-fixture validation surface; PTEST-05 is the dual-gated live-API gate with a different runner shape (API key required, ~$0.20/run, no Docker Postgres dependency) and is naturally isolated.
  - **Plan 36-01: `--profile-bias` flag + m010-30days + m010-5days primed fixtures + 4 integration tests (PTEST-01..04)** — `scripts/synthesize-delta.ts` extension; HARN sanity gate per dimension; VCR-cached fixture generation; populated-case integration test; two-cycle idempotency test; sparse-fixture threshold-enforcement test. **~7-8 tasks.** Largest plan in the phase.
  - **Plan 36-02: Live 3-of-3 atomic anti-hallucination test against real Sonnet (PTEST-05)** — `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` new file; mirrors M009 TEST-31 / M008 TEST-22 structure; consumes m010-30days fixture from Plan 36-01. **~2-3 tasks.**

- **D-02: Plan ordering is strict, not parallelizable.** 36-01 ships before 36-02 (PTEST-05 imports the `m010-30days` fixture that Plan 36-01 generates and commits as a VCR-cached artifact). Same hard-sequencing discipline as Phases 33-35.

### `--profile-bias` flag mechanism (Plan 36-01 / PTEST-01)

- **D-03: Flag shape: `--profile-bias <dimension>` (single-value, repeatable).** Per-day Haiku style-transfer prompt receives an appended domain-keyword hint specific to the named dimension. `dimension ∈ { 'jurisdictional', 'capital', 'health', 'family' }`. The flag MAY be repeated to bias toward multiple dimensions in the same fixture (e.g., `--profile-bias jurisdictional --profile-bias capital`); when omitted, no biasing (legacy behavior preserved). `[auto]` Flag API — Q: "Single `--profile-bias <list>` or repeatable `--profile-bias <dim>`?" → Selected: "Repeatable flag (idiomatic for `parseArgs` + matches `--no-refresh` shape in same script)" (recommended; parseArgs already used in the script, makes per-dimension biasing additive).
- **D-04: Bias mechanism: keyword hint, not template injection.** The bias hint is a single sentence appended to the existing Haiku style-transfer system prompt: e.g., "Focus today's entries on jurisdictional facts (current location, residency status, tax situation, planned moves)." Keywords per dimension locked in a `PROFILE_BIAS_KEYWORDS` constant. The Haiku CHOOSES whether to incorporate the hint — not a hard template substitution. `[auto]` Bias method — Q: "Hard template substitution or soft keyword hint?" → Selected: "Soft keyword hint with per-dimension keyword list" (recommended per OQ-4 research note; preserves Haiku's stylistic variability while nudging topic distribution).
- **D-05: Per-dimension keyword lists locked in `PROFILE_BIAS_KEYWORDS`.** Sourced from FEATURES.md §2.1-2.4 canonical fields + M010 spec language:
  - **jurisdictional:** current location, country, residency status, tax residency, legal entity, planned move, visa, passport
  - **capital:** FI target, net worth, business income, savings rate, financial decision, capital allocation, money goal
  - **health:** clinical hypothesis, pending test, health decision, symptom, medication, doctor visit, lab result
  - **family:** relationship milestone, family criteria, partner formation, family planning, child consideration, relationship constraint

  These keyword lists are NOT exhaustive ground truth — they're nudges. The Haiku model interprets them. The planner may refine word choice; lock the dimension→keyword-set mapping as a `PROFILE_BIAS_KEYWORDS: Record<Dimension, readonly string[]>` constant in `scripts/synthesize-delta.ts`.

- **D-06: VCR cache invalidation is automatic.** The bias keywords change the Haiku prompt hash → existing VCR cache misses → fresh Anthropic call on first regenerate run. Subsequent runs use the new cached transcripts. Operator regenerates via `npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 --profile-bias jurisdictional --profile-bias capital --profile-bias health --profile-bias family --force` (per Phase 24 `regenerate-primed.ts` shape; --force skips the freshness gate since this is a deliberate regen).

### m010-30days fixture (Plan 36-01 / PTEST-01)

- **D-07: Fixture name: `m010-30days`. Target days: 30.** Output dir: `tests/fixtures/primed/m010-30days/`. Generation command: `npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 --profile-bias jurisdictional --profile-bias capital --profile-bias health --profile-bias family --force --seed 42`. Same RNG seed as M009 (`42`) for deterministic Mulberry32 sampling.
- **D-08: All 4 dimensions biased in a single fixture, not 4 separate fixtures.** Per ROADMAP success #1 — "all four profile dimensions with ≥12 distinct tagged Pensieve entries per dimension". A single 30-day fixture with all 4 biases distributed across days. The Haiku prompt sees a different bias-keyword-hint per day on a rotation (jurisdictional → capital → health → family → repeat). The 30-day budget gives roughly 7-8 days per dimension × ~3 entries/day = ~21-24 candidate entries per dimension; ≥12 threshold gives sufficient margin. `[auto]` Fixture count — Q: "Single combined fixture or one fixture per dimension?" → Selected: "Single combined fixture with 4-way rotation" (recommended; minimizes VCR cache size, single HARN run validates all 4 dimensions, mirrors prod-data shape where Greg covers all 4 domains across the same week).
- **D-09: Day-to-dimension rotation: round-robin starting jurisdictional → capital → health → family → repeat.** Locked in `PROFILE_BIAS_ROTATION` constant. Day 0 = jurisdictional; Day 1 = capital; Day 2 = health; Day 3 = family; Day 4 = jurisdictional; ... Synthetic-day index modulo 4 maps to dimension. Operator can audit fixture coverage by counting tag-filtered entries.
- **D-10: HARN sanity gate threshold: ≥12 tag-filtered entries per profile dimension.** Per ROADMAP success #1 verbatim. Tag filter: FACT / RELATIONSHIP / INTENTION / EXPERIENCE per Phase 34 D-13. Gate runs INSIDE the fixture-sanity test in `src/__tests__/fixtures/primed-sanity-m010.test.ts` (new file mirroring `primed-sanity.test.ts`'s scaffold for `m009-21days`); fails the suite if any dimension is below threshold. Plan 36-01 extends the existing primed-sanity test runner OR creates a new sibling file — planner's choice; recommend new file to avoid coupling M009 + M010 sanity into one suite.
- **D-11: Dimension classification for HARN gate: keyword grep over Pensieve content, NOT tag inspection.** The fixture writes generic FACT/RELATIONSHIP/INTENTION/EXPERIENCE tags; the per-dimension bucketing happens at HARN sanity time via keyword grep against `pensieveEntries.content` using the same `PROFILE_BIAS_KEYWORDS` lists from D-05. This is a deliberate v1 simplification — Phase 34's substrate loader (`loadProfileSubstrate`) does NOT filter by dimension (D-14 from Phase 34 keeps a single shared substrate object). The dimension counting is an OPERATOR audit, not a production query. `[auto]` Dimension classification — Q: "Add a `dimension` column to pensieve_entries or keyword-grep at audit time?" → Selected: "Keyword-grep at audit time (no schema change)" (recommended; v1 simplification per Phase 34 D-14; production code doesn't need per-dimension routing yet).

### m010-5days sparse fixture (Plan 36-01 / PTEST-04)

- **D-12: Fixture name: `m010-5days`. Target days: 5.** Output dir: `tests/fixtures/primed/m010-5days/`. Generation command identical to D-07 but `--target-days 5`. Same seed (42) for determinism. With 4-way rotation × 5 days × ~3 entries/day = ~3-4 entries per dimension — below 10-entry MIN_ENTRIES_THRESHOLD on all 4 dimensions.
- **D-13: Sparse-fixture HARN expectation: per-dimension counts ALL below 10.** Plan 36-01 adds a complementary HARN assertion that explicitly verifies m010-5days has `< 10` entries per dimension after the same keyword-grep classification — this protects against accidental fixture inflation. Trip-wire if synth determinism drifts.
- **D-14: m010-5days expected outcome:** `updateAllOperationalProfiles()` invokes 4 generators; each logs `'chris.profile.threshold.below_minimum'`; each returns `{ outcome: 'profile_below_threshold' }`; profile rows stay at confidence=0 with seed-row "insufficient data" markers from Phase 33; NO Sonnet calls are made — `expect(mockAnthropicParse).not.toHaveBeenCalled()`.

### PTEST-02 populated-case integration test (Plan 36-01)

- **D-15: Test file location: `src/memory/profiles/__tests__/integration-m010-30days.test.ts`** (new file). Mirrors Phase 34's `generators.test.ts` two-cycle scaffold but consumes the primed fixture via `loadPrimedFixture('m010-30days')` instead of synthetic in-test inserts. `[auto]` Test file location — Q: "Extend Phase 34's `generators.test.ts` or new file?" → Selected: "New file: `integration-m010-30days.test.ts`" (recommended; fixture-driven tests are a different runner shape than Phase 34's mock-data unit tests; per-fixture file naming follows the M008 `*-integration.test.ts` convention).
- **D-16: Mock SDK boundary, real Postgres.** Same pattern as Phase 34 two-cycle test. `vi.mock('@anthropic-ai/sdk', ...)` returns canned Zod-validated profile shapes per dimension. Real Docker Postgres via `loadPrimedFixture('m010-30days')` seeds pensieve_entries / episodic_summaries / decisions / profile_history rows.
- **D-17: Assertion shape** (PTEST-02 verbatim): all 4 profile rows have `confidence > 0` after the fire; every `last_updated > seedRow.last_updated`; every `substrate_hash !== ''` (seed-row default per Phase 33 D-11); `profile_history` has exactly 4 new rows (1 per dimension) per the write-before-upsert pattern from Phase 34 D-29. Specifically NOT asserted: exact confidence value (that's a calibration concern, not a contract concern).

### PTEST-03 two-cycle idempotency test (Plan 36-01)

- **D-18: Test file: same `integration-m010-30days.test.ts` as PTEST-02.** PTEST-02 + PTEST-03 share fixture loading and `mockAnthropicParse` setup; splitting them across files duplicates the heaviest setup cost (loadPrimedFixture is ~2-3s per call). `[auto]` Test file scope — Q: "Two-cycle test in same file as populated test or separate?" → Selected: "Same file" (recommended; fixture-loading cost amortization).
- **D-19: Three-cycle assertion structure** (mirrors Phase 34 D-36):
  - **Cycle 1:** seeded DB post-fixture-load; `entryCount >= 10` per dimension (guaranteed by HARN gate); run `updateAllOperationalProfiles()`; assert `mockAnthropicParse.toHaveBeenCalledTimes(4)`; assert `profile_history` has 4 new rows; assert all 4 profiles updated.
  - **Cycle 2:** `vi.setSystemTime(+7 days)`; re-run `updateAllOperationalProfiles()` with IDENTICAL substrate (no new Pensieve inserts); assert `mockAnthropicParse.toHaveBeenCalledTimes(4)` (NOT 8); assert `profile_history` still has 4 rows (no new snapshots written per Phase 34 D-29); assert all `outcome === 'profile_skipped_no_change'`.
  - **Cycle 3:** mutate the fixture's pensieve_entries (e.g., insert one new FACT-tagged entry in the jurisdictional domain via `db.insert(pensieveEntries).values({...})`); re-run; assert `mockAnthropicParse.toHaveBeenCalledTimes(5)` (one new call); assert THAT dimension's `outcome === 'profile_updated'`; assert the other 3 dimensions' outcomes are `'profile_skipped_no_change'` (other-dimension hashes unchanged); assert `profile_history` has 5 rows now.

- **D-20: Cycle 2 also asserts previous-state injection (M010-10 mitigation).** Per PITFALLS M010-10 lines 313-323 verbatim: "previous-state injection was non-null (verified via mock SDK boundary test: `expect(mockAnthropicCreate.mock.calls[N][0].system[0].text).toContain('CURRENT PROFILE STATE')`)". Plan 36-01's Cycle 2 inspects the mock's call args from Cycle 1 (since Cycle 2 doesn't call) — verifying that Cycle 1's prompt READ the seed row's prev-state correctly. For full M010-10 coverage, Cycle 3's new call also asserts CURRENT PROFILE STATE block contains Cycle 1's stored profile, not the original seed.

### PTEST-04 sparse-fixture test (Plan 36-01)

- **D-21: Test file: `src/memory/profiles/__tests__/integration-m010-5days.test.ts`** (new file, separate from m010-30days file). Different fixture name + opposite expected outcome makes separate files clearer. `[auto]` File split — Q: "Same file as m010-30days or separate?" → Selected: "Separate file: `integration-m010-5days.test.ts`" (recommended; opposite expected outcome makes splitting more readable; fixture-loading cost is small for the 5-day fixture).
- **D-22: PTEST-04 assertion shape** (verbatim per ROADMAP success #4): load `m010-5days` → `updateAllOperationalProfiles()` → all 4 profile rows still have `confidence === 0` AND `data.<field> === "insufficient data"` (seed markers preserved); `mockAnthropicParse` NEVER called; logger spy captures 4× `'chris.profile.threshold.below_minimum'` log entries (one per dimension); orchestrator returns 4× `{ outcome: 'profile_below_threshold' }` outcomes.

### PTEST-05 live 3-of-3 anti-hallucination test (Plan 36-02)

- **D-23: Test file: `src/memory/profiles/__tests__/live-anti-hallucination.test.ts`** (new file). Direct sibling of Phase 34's `generators.test.ts` directory. Dual-gated via `describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)(...)` per the M009 TEST-31 / M008 TEST-22 precedent (`src/rituals/__tests__/live-weekly-review.test.ts:62-65`, `src/episodic/__tests__/live-anti-flattery.test.ts:257`).
- **D-24: Test scope: REFLECT mode, NOT all 3 inject-eligible modes.** Per ROADMAP success #5 verbatim ("Live 3-of-3 anti-hallucination test ... fires a REFLECT-mode message"). Single mode keeps the spend at ~$0.20/run; if M013 wants to extend to COACH + PSYCHOLOGY, that's a v2.5.1 follow-up. `[auto]` Mode coverage — Q: "REFLECT only or all 3 inject-eligible modes?" → Selected: "REFLECT only" (recommended per ROADMAP success #5; cost discipline per D-30-03; COACH/PSYCHOLOGY mode-handler injection is unit-tested in Phase 35 — live-LLM assertion adds little marginal signal at 3× the cost).
- **D-25: 3-of-3 atomic loop structure mirrors M009 `live-weekly-review.test.ts:69-89`.** Single `it()` block with internal `for (let i = 1; i <= 3; i++)` loop; each iteration runs a full REFLECT exchange against real Sonnet; assertions evaluated inside the loop; failure on any iteration fails the whole test. `[auto]` Atomicity — Q: "Vitest retry mechanism or internal loop?" → Selected: "Internal loop (atomic; matches M009 D038 precedent)" (recommended verbatim).
- **D-26: Fixture: `m010-30days` (loaded once before the loop).** Loading happens in `beforeAll` to amortize across the 3 iterations. The REFLECT call is what runs 3 times, not the fixture load. `[auto]` Fixture amortization — Q: "Load fixture per-iteration or beforeAll?" → Selected: "beforeAll (single load)" (recommended; m010-30days is large; fresh-DB-per-iteration would inflate runtime ~6x with no marginal correctness benefit).
- **D-27: First assertion: system prompt contains the operational profile block.** Mock the Anthropic SDK's `messages.create` ONLY to capture the call args (let the real call go through). Inspect `system[0].text` to confirm it contains the exact header `## Operational Profile (grounded context — not interpretation)` AND at least one rendered dimension field (e.g., `current_country` or `fi_target`). This is the "REFLECT prompt assembly is wired correctly" gate.

   **Implementation detail:** Anthropic SDK doesn't natively offer a "spy + pass-through" pattern. The cleanest approach is to wrap `anthropic.messages.create` with a `vi.spyOn(...)` that records args without mocking the return; alternatively, use a wrapper helper. Planner picks the cleaner pattern during plan task expansion.

- **D-28: Second assertion: Sonnet response does NOT assert facts outside profile context.** Two sub-strategies; --auto locks the simpler one for v1:
  - **Strategy A (locked v1):** Forbidden-fact keyword list. Define ~10-15 keywords representing facts NOT in the m010-30days fixture (e.g., if the fixture says jurisdictional `current_country: France`, forbidden keywords include "Portugal", "Spain", "moving back to Russia"; if fi_target is `$1.5M`, forbidden include "$5M", "$10M target"). Assert NONE appear in the Sonnet response across all 3 iterations.
  - **Strategy B (deferred to v2.5.1):** Haiku post-judge — second Anthropic call asking "Does this response assert any fact not listed in <profile_data>?" → boolean. More semantic but doubles cost-per-iteration and adds a second non-deterministic dependency.

  `[auto]` Anti-hallucination assertion — Q: "Keyword list (deterministic) or Haiku judge (semantic)?" → Selected: "Keyword list for v1, Haiku judge deferred to v2.5.1 if FP rate measurable" (recommended; mirrors M008 TEST-22's "17 forbidden flattery markers" pattern; cost discipline).

- **D-29: Forbidden-fact keyword list locked in `FORBIDDEN_FACTS` constant.** Lives in the live-test file. Sourced from facts NOT in the m010-30days fixture, NOT from arbitrary keywords. Examples (planner finalizes during plan expansion against the actual generated fixture):
  - **Jurisdictional negatives:** "moving to Portugal", "Spain residency", "considering Russia", "Israeli passport", "British citizenship"
  - **Capital negatives:** "$5,000,000", "$10M target", "early retirement", "selling the business"
  - **Health negatives:** "diabetes", "cancer", "depression diagnosis", "ADHD medication"
  - **Family negatives:** "children", "divorced", "engaged", "married"

  Planner refines this list against the actual fixture content after Plan 36-01 generates it. **Lock the count at ≥12 forbidden keywords** (mirrors M008 TEST-22's 17 forbidden markers — sufficient density for adversarial coverage).

- **D-30: Cost budget: ~$0.20 per `RUN_LIVE_TESTS=1` invocation.** 3 Sonnet 4.6 calls × ~$0.067 = $0.20. Documented in the test file header for operator awareness (matches M009 TEST-31 cost callout pattern).
- **D-31: REFLECT prompt content for the live test: deliberately tangential.** Don't ask Sonnet directly about profile facts (that defeats the test — the goal is to catch UNSOLICITED hallucination, not solicited recall). The user-message prompt should be open-ended like "Help me think about my next quarter's priorities" — Sonnet may or may not reference profile facts, but it must not INVENT facts not in the profile. `[auto]` Prompt content — Q: "Direct recall prompt or tangential prompt?" → Selected: "Tangential ('Help me think about ...')" (recommended; tangential prompts surface hallucination more aggressively than direct recall — hallucination is most dangerous when Sonnet volunteers a fact).

### Test scaffolding patterns to mirror

- **D-32: Use M009 / M008 live-test scaffold verbatim.** `src/rituals/__tests__/live-weekly-review.test.ts:1-100` and `src/episodic/__tests__/live-anti-flattery.test.ts:1-300` are the templates. Specifically: `describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)(...)` gate, `it()` with internal 3-iteration loop, per-iteration assertions, cost-callout comment block at top of file.
- **D-33: Use Phase 34 `generators.test.ts` two-cycle scaffold verbatim for PTEST-03.** `src/memory/profiles/__tests__/generators.test.ts` is the in-codebase template — `vi.setSystemTime` + `mockAnthropicParse.toHaveBeenCalledTimes(N)` assertions are already there. Plan 36-01's `integration-m010-30days.test.ts` lifts this pattern; the only differences are (a) `loadPrimedFixture` replaces in-test inserts, (b) fixture has 4 dimensions covered, not just one.
- **D-34: Use Phase 24 `primed-sanity.test.ts` scaffold for m010 HARN gates.** `src/__tests__/fixtures/primed-sanity.test.ts` (currently asserts the m009-21days fixture) is the template. Plan 36-01 creates a parallel `primed-sanity-m010.test.ts` with per-dimension assertions for both `m010-30days` and `m010-5days`.

### M010 milestone closeout signal

- **D-35: All 5 PTEST tests passing is the M010 milestone-gate.** Plan 36-02's PTEST-05 (dual-gated) is THE final gate for the milestone — once it passes 3-of-3 atomically against real Sonnet with `RUN_LIVE_TESTS=1`, M010 is ready for `/gsd-complete-milestone`. Plan 36-02 explicitly notes this in its acceptance criteria.

### Claude's Discretion (for planner / executor)

- **Test runner shape for live test:** `describe.skipIf(...)` vs `it.skipIf(...)` — research SUMMARY references both. M009's `live-weekly-review.test.ts` uses `describe.skipIf`; M006's `live-integration.test.ts` uses `describe.skipIf`. **Recommended:** `describe.skipIf(...)` for consistency.
- **VCR cache pinning:** The fixture generation is deterministic given the same seed + same Anthropic VCR cache. If the planner wants per-day cache snapshot pinning (e.g., commit individual cache files separately), that's fine; if it accepts the current "all under `tests/fixtures/.vcr/`" lump pattern, that's also fine. Tradeoff: granular commits make cache-diff-on-bias-change clearer; lump commits are simpler.
- **Logger spy mechanism:** PTEST-04 needs to assert 4× `'chris.profile.threshold.below_minimum'` log entries. Existing pattern is `vi.spyOn(logger, 'info')` — planner picks the exact mock setup.
- **Fixture-load timing:** PTEST-02 + PTEST-03 share fixture load. Whether to use `beforeAll` or `beforeEach` is the planner's call; `beforeAll` is faster, `beforeEach` resets DB state between cycles (which is what the two-cycle test wants anyway). Recommended: `beforeAll` for fixture load + per-cycle `db.update(...)` for state mutations.
- **HARN sanity file location:** Plan 36-01 either (a) extends `src/__tests__/fixtures/primed-sanity.test.ts` with m010 assertions inline OR (b) creates `src/__tests__/fixtures/primed-sanity-m010.test.ts` as a sibling file. Default: (b) sibling file to avoid M009/M010 coupling.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked phase-level context (read FIRST)
- `.planning/phases/33-profile-substrate/33-CONTEXT.md` — Phase 33's locked decisions (sentinel row, seed-row substrate_hash='', confidence helpers, never-throw reader); especially D-04, D-11, D-19, D-17 (profile_history)
- `.planning/phases/33-profile-substrate/33-SUMMARY.md` — what Phase 33 actually shipped (reader API surface, types Plan 36-01 imports)
- `.planning/phases/34-inference-engine/34-CONTEXT.md` — Phase 34's locked decisions (Promise.allSettled, substrate-hash idempotency, write-before-upsert, two-cycle test design); especially D-15..D-18 (substrate hash), D-19..D-20 (threshold gate), D-29 (history snapshot), D-34 (log keys), D-36 (two-cycle test scaffold)
- `.planning/phases/34-inference-engine/34-SUMMARY.md` (per-plan SUMMARYs) — what Phase 34 actually shipped (`updateAllOperationalProfiles`, generators, cron registration)
- `.planning/phases/34-inference-engine/34-02-SUMMARY.md` specifically — `loadProfileSubstrate`, `computeSubstrateHash`, the 4 generator files Plan 36-01 indirectly invokes
- `.planning/phases/35-surfaces/35-CONTEXT.md` — Phase 35's locked decisions; especially D-08 (PROFILE_INJECTION_MAP), D-12 (formatProfilesForPrompt empty-string contract), D-14 (mode-handler call order), D-25..D-27 (golden snapshot test scaffolding)
- `.planning/phases/35-surfaces/35-02-SUMMARY.md` — Plan 35-02 specifically: PROFILE_INJECTION_MAP exports + formatProfilesForPrompt + REFLECT/COACH/PSYCHOLOGY wiring (Plan 36-02 PTEST-05 asserts against this)
- `.planning/phases/35-surfaces/35-03-SUMMARY.md` — Plan 35-03 specifically: `/profile` handler + golden snapshot test (NOT directly invoked by Phase 36 but provides the second-person-framing precedent for the live test's response-quality bar)

### M010 milestone research (locked decisions for Phase 36)
- `.planning/research/SUMMARY.md` §Phase 36 (lines 191-210) — Phase 36 deliverables list; addresses TS-9, TS-10, TS-11; avoids M010-05, M010-10; OQ-4 (`--profile-bias` threshold determinism) flagged for planning
- `.planning/research/SUMMARY.md` line 50-51 — TS-9 (m010-30days primed fixture, ≥12 entries per dimension HARN gate) + TS-10 (m010-5days sparse, all 4 at confidence=0)
- `.planning/research/PITFALLS.md` M010-05 (lines 105-110) — Synthetic fixture dimension coverage gap; `--profile-bias` flag + HARN gate mitigation
- `.planning/research/PITFALLS.md` M010-10 (lines 303-333) — First-fire celebration blindness (profile edition); two-cycle test with previous-state injection assertion via mock SDK boundary
- `.planning/research/PITFALLS.md` Looks-Done-But-Isn't checklist (lines 419-433) — Two-cycle test verification + substrate_hash column + schema_version column + golden snapshot test + DB-backed lang in profile cron all covered by Phase 33-35; PTEST is the integrated test pass
- `.planning/research/FEATURES.md` §2.1-2.4 — canonical per-dimension fields; `PROFILE_BIAS_KEYWORDS` per dimension (D-05) is sourced from these

### Project specs
- `M010_Operational_Profiles.md` (project root) — original milestone spec
- `.planning/PROJECT.md` — Key Decisions D004 (append-only Pensieve), D005 (never-throw), D008 (first-person Chris), D041 (primed-fixture pipeline supersedes calendar wait — THIS phase is the proof point)
- `.planning/REQUIREMENTS.md` PTEST-01..05 — Phase 36 contract surface (lines 35-41); traceability at lines 98-102 maps each REQ to plan (36-01 / 36-02)
- `.planning/ROADMAP.md` Phase 36 entry (lines 93-105) — success criteria 1-5 verbatim; HARD CO-LOC #M10-6 (`--profile-bias` + fixture generation + populated test + sparse test atomic in same plan)
- `.planning/codebase/TESTING.md` — primed-fixture pipeline conventions (just updated in Phase 35 IN-02 with inline-snapshot workflow section)

### Codebase substrate (existing patterns to mirror)

**Primed-fixture pipeline (consumed verbatim):**
- `scripts/synthesize-delta.ts` — current 670-line script; Plan 36-01 adds `--profile-bias` repeatable flag + `PROFILE_BIAS_KEYWORDS` + `PROFILE_BIAS_ROTATION` constants + per-day keyword-hint appending in the Haiku style-transfer call
- `scripts/synthesize-episodic.ts` — sibling-module composition against `runConsolidate()`; no changes needed for Phase 36 (episodic generation unaffected by `--profile-bias`)
- `scripts/regenerate-primed.ts` — composer chains fetch → synth-delta → synth-episodic; Plan 36-01 invokes via `--milestone m010 --target-days 30 --profile-bias jurisdictional ... --force --seed 42`
- `scripts/fetch-prod-data.ts` — SSH-tunneled prod dump; consumed by regenerate-primed; no changes for Phase 36
- `src/__tests__/fixtures/load-primed.ts` — `loadPrimedFixture(name)` helper that PTEST-02/03/04 invoke
- `src/__tests__/fixtures/load-primed.test.ts` — integration tests for the loader itself; reference for the test scaffold shape
- `src/__tests__/fixtures/primed-sanity.test.ts` — HARN sanity scaffold for m009-21days (`MIN_PENSIEVE_ENTRIES = 195` precedent at line 76); Plan 36-01 mirrors this for m010-30days and m010-5days
- `src/__tests__/fixtures/vcr.ts` — content-addressable Anthropic SDK wrapper; bias-keyword changes invalidate cache automatically (D-06)
- `tests/fixtures/primed/m009-21days/MANIFEST.json` — manifest shape Plan 36-01 mirrors for m010-30days / m010-5days
- `tests/fixtures/primed/m009-21days/*.jsonl` — JSONL row dumps (pensieve_entries, episodic_summaries, decisions, etc.); Plan 36-01's m010 fixtures have the same shape

**Two-cycle test scaffold (consumed verbatim for PTEST-03):**
- `src/memory/profiles/__tests__/generators.test.ts` — Phase 34's two-cycle test; `vi.setSystemTime` + `mockAnthropicParse.toHaveBeenCalledTimes` pattern; substrate-hash skip assertions
- `src/rituals/__tests__/weekly-review.test.ts` — M009's two-cycle pattern; secondary reference
- `src/episodic/__tests__/consolidate.test.ts` — M008's idempotency pattern; tertiary reference

**Live-test scaffold (consumed verbatim for PTEST-05):**
- `src/rituals/__tests__/live-weekly-review.test.ts` — M009 TEST-31 — direct shape template for PTEST-05; specifically lines 59-90 (3-of-3 atomic loop + dual-gate + cost callout)
- `src/episodic/__tests__/live-anti-flattery.test.ts` — M008 TEST-22 (D038) — alternate shape; especially lines 257-346 (3-of-3 internal loop + forbidden-marker assertion pattern)
- `src/chris/__tests__/live-integration.test.ts` — M006 live integration; for the `describe.skipIf(!ANTHROPIC_API_KEY)` precedent
- `src/decisions/__tests__/vague-validator-live.test.ts` — alternative live-Haiku gate; secondary reference

**Phase 33 substrate (consumed by all 5 PTEST tests):**
- `src/memory/profiles.ts:172-180` — `getOperationalProfiles()` reader
- `src/memory/profiles/schemas.ts` — Zod v3 schemas for shape validation in test assertions
- `src/memory/confidence.ts` — `MIN_ENTRIES_THRESHOLD = 10` (PTEST-04 sparse boundary), `SATURATION = 50`, `computeProfileConfidence`

**Phase 34 substrate (consumed by PTEST-02/03/04):**
- `src/memory/profile-updater.ts` — `updateAllOperationalProfiles()` orchestrator
- `src/memory/profiles/shared.ts` — `loadProfileSubstrate`, `computeSubstrateHash` (PTEST-03 asserts against this hash directly)
- `src/memory/profiles/{jurisdictional,capital,health,family}.ts` — 4 generators (each invoked by orchestrator; PTEST-02/03 mock the SDK boundary inside each)

**Phase 35 substrate (consumed by PTEST-05):**
- `src/memory/profiles.ts:226+` — `formatProfilesForPrompt(profiles, mode)` (PTEST-05 asserts the rendered block appears in REFLECT system prompt)
- `src/memory/profiles.ts:70` — `PROFILE_INJECTION_MAP` (REFLECT entry confirms expected block appears)
- `src/chris/modes/reflect.ts:76-80` — call order `getOperationalProfiles → formatProfilesForPrompt → buildSystemPrompt` (PTEST-05's mock spy intercepts at the SDK boundary; the order is implicit)
- `src/chris/personality.ts:124+` — `buildSystemPrompt(...extras?: ChrisContextExtras)` with `operationalProfiles` field consumed for REFLECT/COACH/PSYCHOLOGY

### Tests to mirror
- `src/__tests__/fixtures/primed-sanity.test.ts` — HARN-style invariant test runner template
- `src/memory/profiles/__tests__/generators.test.ts` — two-cycle scaffold + mocked-SDK setup template
- `src/rituals/__tests__/live-weekly-review.test.ts` — live 3-of-3 atomic dual-gate scaffold

</canonical_refs>

<deferred>
## Deferred Ideas (out of Phase 36 scope)

- **Haiku post-judge for live anti-hallucination (D-28 Strategy B).** Deferred to v2.5.1 if Phase 36 PTEST-05's forbidden-keyword approach surfaces false negatives in real-world operation. Adds ~$0.05/run and a second non-deterministic dependency.
- **Per-dimension live tests for COACH + PSYCHOLOGY.** D-24 locks REFLECT-only for cost discipline. v2.5.1 if behavioral drift surfaces in the other 2 inject-eligible modes.
- **Per-field source citations in profile output schema (DIFF-2 / M010-02 strict mitigation).** Per Phase 34 D-33: deferred to v2.5.1 if Phase 36's anti-hallucination test reveals residual hallucination. PTEST-05 is the data-gathering gate for this deferral decision.
- **Tag-by-dimension column on pensieve_entries.** D-11 keeps the dimension classification as a HARN-time keyword grep. Schema-level `dimension` column is a v2.5.1 candidate if production profile fidelity needs it (e.g., per-dimension substrate views per Phase 34 deferred ideas).
- **Snapshot pinning per VCR cache file.** Claude's Discretion item — operator preference for commit granularity.
- **`m010-90days` long-horizon fixture for saturation-curve calibration.** SATURATION constant is currently first-estimate at 50 (per Phase 33 D-19). After 4-8 weeks of real M010 operation, v2.5.1 may add a long-horizon fixture for empirical calibration.
- **Multi-profile cross-reference fixtures (DIFF-1).** M013 candidate per Phase 34 deferred ideas — needs M011 + M012 to be mature first.

</deferred>

<code_context>
## Codebase Context (from scout pass)

### Reusable assets
- **`scripts/synthesize-delta.ts`** (670 lines, Phase 24): `parseArgs` already used for CLI; constants at top (FEW_SHOT_N, ENTRIES_PER_DAY, etc.); Haiku style-transfer call site is the injection point for the bias-keyword hint. Adding `--profile-bias` is additive (no breaking change to existing m009 fixture generation).
- **`scripts/regenerate-primed.ts`** (275 lines, Phase 24): Composer; passes through flags to synthesize-delta. Plan 36-01 adds `--profile-bias` to the pass-through list. `--force` skips freshness check (used during initial Phase 36 fixture gen).
- **`src/__tests__/fixtures/load-primed.ts`** + sibling helpers: FK-safe + idempotent loader; PTEST-02/03/04 consume.
- **`src/__tests__/fixtures/primed-sanity.test.ts`**: HARN gate scaffold with `MIN_PENSIEVE_ENTRIES` constant + per-fixture invariants. Plan 36-01 creates a parallel `primed-sanity-m010.test.ts` (per D-34).
- **`src/memory/profiles/__tests__/generators.test.ts`**: Phase 34 two-cycle scaffold; `vi.setSystemTime` + `mockAnthropicParse` mock setup; Plan 36-01 lifts the structure.
- **`src/rituals/__tests__/live-weekly-review.test.ts`**: M009 TEST-31 3-of-3 atomic dual-gate; Plan 36-02 lifts the structure verbatim.
- **`src/__tests__/fixtures/vcr.ts`**: Content-addressable cache; automatic invalidation on prompt change (D-06).

### Integration points
- **`scripts/synthesize-delta.ts`**:
  - Add `parseArgs` option: `'profile-bias': { type: 'string', multiple: true, default: [] }`
  - Add `PROFILE_BIAS_KEYWORDS: Record<Dimension, readonly string[]>` constant near `ENTRIES_PER_DAY`
  - Add `PROFILE_BIAS_ROTATION: readonly Dimension[]` constant (round-robin order per D-09)
  - Modify the per-day Haiku style-transfer prompt to append `dimensionHintFor(dayIndex)` when biases were provided
  - Expose `dimensionHintFor(dayIndex: number, biases: Dimension[]): string` helper
- **`tests/fixtures/primed/m010-30days/`**: new directory created by `regenerate-primed.ts` run; committed as VCR-cached artifact along with `tests/fixtures/.vcr/<new-hash>.json` entries
- **`tests/fixtures/primed/m010-5days/`**: same shape, sparse content
- **`src/__tests__/fixtures/primed-sanity-m010.test.ts`**: new file; assertions for both m010-30days and m010-5days
- **`src/memory/profiles/__tests__/integration-m010-30days.test.ts`**: new file; PTEST-02 + PTEST-03 (3-cycle structure)
- **`src/memory/profiles/__tests__/integration-m010-5days.test.ts`**: new file; PTEST-04
- **`src/memory/profiles/__tests__/live-anti-hallucination.test.ts`**: new file; PTEST-05 (3-of-3 atomic against real Sonnet)

### Patterns to follow
- **Conventional commits:**
  - `feat(36-01): --profile-bias flag + PROFILE_BIAS_KEYWORDS in synthesize-delta.ts (PTEST-01)`
  - `feat(36-01): generate m010-30days + m010-5days primed fixtures with --profile-bias`
  - `test(36-01): primed-sanity-m010 HARN gate (≥12 per dimension for m010-30days; <10 per dimension for m010-5days)`
  - `test(36-01): integration-m010-30days populated + two-cycle idempotency (PTEST-02 + PTEST-03)`
  - `test(36-01): integration-m010-5days sparse threshold-enforcement (PTEST-04)`
  - `test(36-02): live 3-of-3 anti-hallucination REFLECT against real Sonnet (PTEST-05, RUN_LIVE_TESTS=1)`
- **HARD CO-LOC enforcement (#M10-6):** gsd-plan-checker MUST refuse splitting `--profile-bias` flag, fixture generation, HARN gate, and integration tests across multiple plans. Plan 36-01 ships all of PTEST-01..04 atomically.
- **No live LLM calls in Plan 36-01 tests.** Mock Anthropic SDK boundary; real Postgres via loadPrimedFixture. Only Plan 36-02's PTEST-05 calls real Sonnet — and only when `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=...`.
- **Logger spy for PTEST-04 + PTEST-03 outcome assertions:** `vi.spyOn(logger, 'info')` to capture `'chris.profile.threshold.below_minimum'` and `'chris.profile.<outcome>'` log keys.
- **Cost callout comment** at top of `live-anti-hallucination.test.ts`: "~$0.20 per RUN_LIVE_TESTS=1 invocation (3 × Sonnet 4.6 calls). Dual-gated. Mirrors M009 TEST-31 cost discipline."

</code_context>

<test_strategy>
## Test Strategy

Six test artifacts ship across the 2 plans:

1. **`scripts/synthesize-delta.ts` unit tests (Plan 36-01)** — Existing `scripts/__tests__/synthesize-delta.test.ts` (or sibling) extended with `--profile-bias` flag tests: (a) flag accepted as repeatable; (b) `PROFILE_BIAS_ROTATION` round-robin per `dayIndex`; (c) keyword hint appears in Haiku prompt for biased days; (d) no hint when `--profile-bias` omitted (legacy behavior preserved); (e) VCR cache hash differs between biased and unbiased runs.

2. **HARN sanity gate (Plan 36-01)** — `src/__tests__/fixtures/primed-sanity-m010.test.ts`: (a) m010-30days fixture has ≥12 keyword-classified entries per dimension; (b) m010-5days fixture has <10 per dimension AND ≥1 (proves the synth ran but stayed sparse).

3. **Populated-case integration test (Plan 36-01, PTEST-02)** — `src/memory/profiles/__tests__/integration-m010-30days.test.ts`: real Docker Postgres + `loadPrimedFixture('m010-30days')` + mocked Anthropic SDK + Cycle 1 assertions (all 4 confidence > 0, all 4 last_updated advanced, all 4 substrate_hash non-null, profile_history has 4 new rows).

4. **Two-cycle idempotency test (Plan 36-01, PTEST-03)** — same file as #3; Cycles 2 (identical substrate → no Sonnet calls, prev-state injection verified via mock spy) and 3 (mutated substrate → one new Sonnet call for the mutated dimension, other 3 skip).

5. **Sparse-fixture threshold test (Plan 36-01, PTEST-04)** — `src/memory/profiles/__tests__/integration-m010-5days.test.ts`: load m010-5days → run orchestrator → assert all 4 profiles unchanged from seed; 4× `'chris.profile.threshold.below_minimum'` log entries; zero Sonnet calls.

6. **Live 3-of-3 atomic anti-hallucination test (Plan 36-02, PTEST-05)** — `src/memory/profiles/__tests__/live-anti-hallucination.test.ts`: `describe.skipIf(!RUN_LIVE_TESTS || !ANTHROPIC_API_KEY)`; `beforeAll` loads m010-30days; single `it()` with internal 3-iteration loop; each iteration: (a) spy on `anthropic.messages.create`, (b) invoke `handleReflect(chatId, "Help me think about my next quarter's priorities", "English", [])`, (c) assert spy was called with system prompt containing `## Operational Profile (grounded context — not interpretation)`, (d) assert response text does NOT contain any keyword in `FORBIDDEN_FACTS` constant; (e) failure on any iteration fails the whole test.

**Live test budget:** ~$0.20 per invocation. NOT run in CI; manual operator invocation via `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... npx vitest run src/memory/profiles/__tests__/live-anti-hallucination.test.ts`.

**Fixture commit policy:** Both m010-30days and m010-5days fixtures + their VCR cache files are committed to the repo. They're large (~1-5MB total estimated) but determinism + offline-test-ability outweigh the size concern (matches m009-21days policy).

</test_strategy>

<plan_hints>
## Plan Structure Hint

Recommended plan split for Phase 36 (2 plans, matching the REQUIREMENTS PTEST-01..05 traceability table at REQUIREMENTS.md:98-102):

- **Plan 36-01: `--profile-bias` flag + m010-30days + m010-5days + 4 fixture-driven integration tests (HARD CO-LOC #M10-6 anchor)** — `scripts/synthesize-delta.ts` extension (PTEST-01); HARN sanity gate per dimension (`primed-sanity-m010.test.ts`); populated-case integration test on `m010-30days` (PTEST-02); two-cycle idempotency test (PTEST-03); sparse-fixture threshold test on `m010-5days` (PTEST-04); generated fixture artifacts committed. Satisfies PTEST-01, PTEST-02, PTEST-03, PTEST-04. **~7-8 tasks.** gsd-plan-checker refuses splitting the flag, fixtures, HARN, and integration tests across multiple plans (HARD CO-LOC #M10-6 enforcement).

- **Plan 36-02: Live 3-of-3 atomic anti-hallucination test (PTEST-05)** — `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` (new file); dual-gated `describe.skipIf(...)`; consumes `m010-30days` fixture from Plan 36-01; mirrors M009 TEST-31 / M008 TEST-22 scaffold; FORBIDDEN_FACTS keyword list locked. Satisfies PTEST-05. **~2-3 tasks.** Dual gate `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=...` required for manual operator invocation; CI does not run this test.

**Total: ~9-11 tasks across 2 plans.**

**Plan ordering (strict, per D-02):** 36-01 ships before 36-02 (36-02 imports the `m010-30days` fixture as a committed artifact).

**Pre-work gates:**
- **Before Plan 36-01:** Verify Phase 34's `updateAllOperationalProfiles` orchestrator + Phase 35's `getOperationalProfiles` reader + REFLECT-mode wiring are all green via `npx vitest run src/memory/profiles/__tests__/generators.test.ts src/chris/__tests__/reflect.test.ts` (should match the 1612/0/1 baseline established at Phase 35 close).
- **Before Plan 36-02:** Verify `tests/fixtures/primed/m010-30days/MANIFEST.json` exists and HARN-m010 sanity gate is green. Verify the operator has `ANTHROPIC_API_KEY` available (or proceed knowing the test will skip by default in CI).

**OQ-4 reconfirmation (planner task):** D-09 locks 4-way round-robin rotation. Plan 36-01 Task 2 should run `regenerate-primed --target-days 30 --profile-bias jurisdictional...family --seed 42` once and verify post-generation that per-dimension keyword-grep yields ≥12 entries. If the rotation produces < 12 for any dimension, adjust either (a) `ENTRIES_PER_DAY` (currently 3), (b) target days (currently 30), or (c) rotation strategy (e.g., 2-day blocks per dimension instead of 1-day round-robin). Lock the final tuning in CONTEXT.md addendum if a change is needed during planning.

**M010 milestone close after Plan 36-02:** Once PTEST-05 passes 3-of-3 atomically, M010 is complete. Operator runs `/gsd-complete-milestone` to archive v2.5 artifacts, increment to v2.6 (M011 Psychological Profiles), and update PROJECT.md.

</plan_hints>

---

*Phase: 36-tests*
*Context gathered: 2026-05-13*
