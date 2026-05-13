# Phase 36: Tests - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-13
**Phase:** 36-tests
**Mode:** `--auto` (single-pass, recommended options auto-selected from M010 research pass + Phase 33/34/35 precedents)
**Areas discussed:** Plan split, --profile-bias flag mechanism, fixture generation, HARN sanity gate, two-cycle test scaffold, sparse-fixture test, live anti-hallucination test, anti-hallucination assertion strategy

---

## Plan split structure

| Option | Description | Selected |
|--------|-------------|----------|
| 2 plans matching REQUIREMENTS PTEST-01..05 traceability | 36-01 fixture infra + 4 integration tests (PTEST-01..04); 36-02 live test (PTEST-05) | ✓ |
| 1 mega-plan with all 5 PTEST in one wave | Bloats single plan; couples Docker-Postgres tests with live-API test | |
| 3+ plans (one per fixture, one per test pair) | Over-fragments; HARD CO-LOC #M10-6 mandates fixture+sanity+integration atomic | |

**User's choice (auto):** 2 plans matching REQUIREMENTS table — recommended.
**Notes:** Mirrors Phase 33's 2-plan substrate split rhythm. PTEST-05's dual-gated live runner is naturally isolated from PTEST-01..04's Docker-Postgres testbed.

---

## --profile-bias flag mechanism (OQ-4 from research)

| Option | Description | Selected |
|--------|-------------|----------|
| Repeatable flag (`--profile-bias jurisdictional --profile-bias capital`) with soft keyword hint | Idiomatic parseArgs usage; per-day rotation; Haiku style-transfer prompt receives optional dimension-keyword sentence | ✓ |
| Single comma-separated list (`--profile-bias jurisdictional,capital`) | Less ergonomic; doesn't compose with parseArgs `multiple: true` shape | |
| Hard template substitution (force specific entry types per day) | Defeats Haiku stylistic variability; produces unrealistic entries | |
| No biasing at all (rely on luck) | Per OQ-4: 30 days of unbiased Haiku does not deterministically cross 10-entry threshold per dimension; M010-05 specifically calls this gap out | |

**User's choice (auto):** Repeatable flag with soft keyword hint — recommended per OQ-4 research note.
**Notes:** Soft hint preserves Haiku stylistic variability; per-dimension keyword list `PROFILE_BIAS_KEYWORDS` locked from FEATURES.md §2.1-2.4.

---

## Fixture count

| Option | Description | Selected |
|--------|-------------|----------|
| Single combined fixture with 4-way day rotation | One m010-30days fixture covering all 4 dimensions; 1 HARN run validates all | ✓ |
| 4 separate fixtures (one per dimension) | 4× VCR cache size; 4× HARN runs; doesn't match prod where Greg covers all 4 domains in same week | |
| 2 fixtures (jurisdictional+capital vs health+family) | Awkward middle ground; no clear semantic split | |

**User's choice (auto):** Single combined fixture — recommended.
**Notes:** Matches prod data shape; minimizes VCR cache size; round-robin rotation `jurisdictional → capital → health → family` over 30 days gives ~7-8 days × 3 entries = ~21-24 candidates per dimension (well above 12 threshold with margin).

---

## Dimension classification for HARN gate

| Option | Description | Selected |
|--------|-------------|----------|
| Keyword-grep over Pensieve content at audit time (no schema change) | Uses same `PROFILE_BIAS_KEYWORDS` lists; deferred dimension routing per Phase 34 D-14 | ✓ |
| Add `dimension` column to pensieve_entries schema | Production query change; Phase 33+34 deferred per-dimension substrate views to v2.5.1 | |
| Manual operator audit (no automated gate) | Defeats purpose of HARN gate; production pipeline needs invariant enforcement | |

**User's choice (auto):** Keyword-grep at audit time — recommended.
**Notes:** v1 simplification; production code doesn't need per-dimension routing yet (Phase 34 D-14 keeps shared substrate object).

---

## Two-cycle vs three-cycle test structure

| Option | Description | Selected |
|--------|-------------|----------|
| Three-cycle (Cycle 1 populate + Cycle 2 identical substrate skip + Cycle 3 mutated substrate update) | Covers populate, skip, AND change-detection paths in one test | ✓ |
| Two-cycle (Cycle 1 populate + Cycle 2 identical substrate skip) | Covers M010-10 first-fire-blindness but misses change-detection | |
| Four-cycle (add Cycle 4 with mutated different dimension) | Marginal gain over Cycle 3; longer fixture mutation logic | |

**User's choice (auto):** Three-cycle — recommended per Phase 34 D-36 precedent.
**Notes:** Cycle 3 verifies that a mutation to dimension X causes ONLY dimension X's generator to fire — the other 3 still skip. This is Phase 34 D-17's per-dimension hash comparison validated end-to-end.

---

## Anti-hallucination assertion strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Forbidden-fact keyword list (deterministic, ~12-15 negative keywords) | Mirrors M008 TEST-22's 17 forbidden flattery markers; no extra API cost; deterministic | ✓ |
| Haiku post-judge (semantic, 2nd call per iteration) | More robust to phrasing variation; +$0.05/run; adds second non-deterministic dependency | |
| Embedding-similarity check (response vs profile facts) | Heavier infra; bge-m3 embedding for response + comparison; not justified for v1 | |
| Manual operator review only | Defeats automated gate purpose | |

**User's choice (auto):** Forbidden-fact keyword list for v1; Haiku judge deferred to v2.5.1.
**Notes:** Deterministic CI gate. Mirrors M008 TEST-22 precedent. If keyword list yields false negatives in production, v2.5.1 can add Haiku judge.

---

## Live test mode coverage

| Option | Description | Selected |
|--------|-------------|----------|
| REFLECT only | $0.20/run; matches ROADMAP success #5 verbatim ("fires a REFLECT-mode message") | ✓ |
| REFLECT + COACH + PSYCHOLOGY (all 3 inject-eligible modes) | 3× cost; mode-handler injection is unit-tested in Phase 35 — marginal signal | |
| All 8 modes (sanity test that 5 non-injecting modes don't see profile block) | 8× cost; negative invariants are unit-tested in Phase 35 D-28 | |

**User's choice (auto):** REFLECT only — recommended per ROADMAP success #5 verbatim + cost discipline.
**Notes:** v2.5.1 may extend if behavioral drift surfaces in COACH/PSYCHOLOGY.

---

## REFLECT prompt content for live test

| Option | Description | Selected |
|--------|-------------|----------|
| Tangential prompt ("Help me think about my next quarter's priorities") | Surfaces unsolicited hallucination — the most dangerous failure mode | ✓ |
| Direct recall prompt ("What is my current country?") | Tests recall, not hallucination resistance | |
| Adversarial probe ("Tell me about your move to Portugal") | Asks Sonnet to confabulate a specific false fact; too narrow | |

**User's choice (auto):** Tangential prompt — recommended.
**Notes:** Hallucination is most dangerous when Sonnet volunteers a fact unprompted. Tangential prompts surface this aggressively.

---

## Test runner gate shape

| Option | Description | Selected |
|--------|-------------|----------|
| `describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)` | Dual-gated; manual operator invocation only; CI never runs | ✓ |
| `describe.skipIf(!ANTHROPIC_API_KEY)` only | Single-gated; would run in environments with the key set (executor sandboxes, etc.) — unwanted spend | |
| `it.skipIf(...)` with describe always run | Allows describe block setup even when skipped; M009 precedent prefers `describe.skipIf` | |

**User's choice (auto):** `describe.skipIf` dual-gated — recommended per M009 TEST-31 / M008 TEST-22 precedent.

---

## Fixture-load timing

| Option | Description | Selected |
|--------|-------------|----------|
| `beforeAll` (single load per test file) | Amortizes ~2-3s fixture load; matches PTEST-02/03 sharing fixture | ✓ |
| `beforeEach` (reload per test) | Cleaner state isolation; ~6x slower for two-cycle test; not needed since cycles mutate explicitly | |

**User's choice (auto):** `beforeAll` — recommended.
**Notes:** Two-cycle test mutates between cycles explicitly; doesn't need full DB reset.

---

## File location for integration tests

| Option | Description | Selected |
|--------|-------------|----------|
| `src/memory/profiles/__tests__/integration-m010-30days.test.ts` + `integration-m010-5days.test.ts` (separate files) | Per-fixture file naming; opposite expected outcomes; mirrors M008 *-integration.test.ts convention | ✓ |
| Single combined `integration-m010.test.ts` | Couples populated + sparse tests in one file; harder to isolate failures | |
| Extend Phase 34's `generators.test.ts` | Phase 34's file is mock-data unit tests, not fixture-driven integration | |

**User's choice (auto):** Separate per-fixture files — recommended.

---

## Claude's Discretion

- **VCR cache pinning per-file vs lump:** Operator preference; default lump matches existing `tests/fixtures/.vcr/` pattern.
- **Logger spy mechanism:** `vi.spyOn(logger, 'info')` for PTEST-04 + PTEST-03 outcome assertions; planner picks exact setup.
- **HARN sanity file location:** Sibling `primed-sanity-m010.test.ts` recommended; alternative is inline extension of existing file.
- **REFLECT prompt exact wording for PTEST-05:** "Help me think about my next quarter's priorities" is the seed; planner may refine if it produces too-narrow Sonnet responses.
- **FORBIDDEN_FACTS exact keyword count:** ≥12 minimum; planner finalizes against actual generated fixture content.

## Deferred Ideas

- Haiku post-judge for live anti-hallucination (D-28 Strategy B) — v2.5.1
- Per-dimension live tests for COACH + PSYCHOLOGY — v2.5.1
- Per-field source citations in profile output schema (M010-02 strict mitigation) — v2.5.1 if PTEST-05 surfaces residual hallucination
- `dimension` column on pensieve_entries schema — v2.5.1 if per-dimension routing matters
- `m010-90days` long-horizon fixture for SATURATION calibration — v2.5.1 after empirical M010 operation data
- Multi-profile cross-reference fixtures (DIFF-1) — M013 (needs M011 + M012 mature)
- Snapshot pinning per VCR cache file — operator preference, not in v1 scope
