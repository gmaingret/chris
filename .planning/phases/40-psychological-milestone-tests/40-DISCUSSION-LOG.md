# Phase 40: Psychological Milestone Tests — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.

**Date:** 2026-05-14
**Phase:** 40-psychological-milestone-tests
**Mode:** `--auto` (autonomous; recommended-default selected for every gray area)
**Areas discussed:** Plan split, --psych-profile-bias flag shape, designed personality signature, HARN sanity gate, fixture word-count targets, 3-cycle fixture-driven test scope, live test mode coverage, adversarial regex patterns, cost discipline

---

## Plan split

| Option | Description | Selected |
|--------|-------------|----------|
| 2 plans (mirror Phase 36: fixture+integration / live gate) | Cost-isolation discipline matches Phase 36 PTEST-01..04 / PTEST-05 split | ✓ |
| 3 plans (fixture / mocked-Sonnet integration / live gate) | Maximum atomicity | |
| 1 plan (everything atomic) | Simplest blast radius | |

**Selected:** 2 plans. Mirror Phase 36. Plan 40-01 ships fixture pipeline + 3 mocked-SDK integration tests; Plan 40-02 ships dual-gated live milestone test with $0.20-0.30/run cost callout.

---

## `--psych-profile-bias` flag shape

| Option | Description | Selected |
|--------|-------------|----------|
| Boolean flag (single fixed signature in code) | One signature → no operator-side configuration mistakes; M011 has ONE designed signature (HIGH O/C/H-H + S-D/B/U; LOW Conf/Pow) | ✓ |
| `--psych-profile-bias <signature-name>` (named signature variants) | Multiple fixtures per signature variant; cost: code complexity | |
| Repeatable `--psych-profile-bias <trait>` like M010 | Trait-by-trait biasing | |

**Selected:** Boolean flag.
**Rationale:** Single fixed signature per ARCHITECTURE recommendation. Operator configuration mistakes (typo in signature name) are eliminated. Variants deferred to v2.6.1 if calibration data shows need.

---

## Designed signature

| Option | Description | Selected |
|--------|-------------|----------|
| HIGH Openness + Conscientiousness + Honesty-Humility / HIGH Self-Direction + Benevolence + Universalism / LOW Conformity + Power | 5+ measurable points for ±0.8 tolerance per dim; covers HEXACO + Schwartz; per ARCHITECTURE | ✓ |
| Single-trait extreme signature (e.g., HIGH Openness only) | Easy to detect; insufficient HEXACO/Schwartz coverage | |
| Multi-signature cycle (one per fixture day) | Most realistic but harder to assert signature tolerance | |

**Selected:** Multi-trait composite.
**Rationale:** ARCHITECTURE recommends 5+ trait targets so PMT-04's ±0.8 per-dim tolerance assertion has sufficient signal. Single-trait insufficient for cross-dim coherence. Multi-signature-cycle conflicts with PMT-04 expected-signature assertion (multiple targets).

---

## HARN sanity gate (PMT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| wordCount > 5000 AND ≥1 OPENNESS_SIGNAL_PHRASES present | PMT-01 verbatim; defends Pitfall 7 (Haiku averaging erases signature) | ✓ |
| wordCount > 5000 only | Faster gate; misses signal-erasure class | |
| Full signature-detection in HARN (run Sonnet on fixture before tests) | Expensive; defeats VCR cache | |

**Selected:** wordCount + signal-phrase.
**Rationale:** PMT-01 verbatim. Signal-phrase guard is cheap (substring match); catches the Pitfall 7 failure mode early. Full signature-detection rejected: would require Sonnet calls in HARN, defeats VCR caching.

---

## Fixture word-count targets

| Option | Description | Selected |
|--------|-------------|----------|
| m011-30days = 6,000 words / m011-1000words = ~1,000 words | Above and below 5,000 floor with margins | ✓ |
| 5,500 / 4,500 (near-floor on both sides) | Tightest threshold testing | |
| 12,000 / 500 (extreme margins) | Maximum signal, least cost-efficient | |

**Selected:** 6,000 / 1,000.
**Rationale:** Both fixtures have ~20% margin from the 5,000-word floor — enough room for Haiku-erasure attrition without false-positive HARN failures. Tighter margins risk HARN flakiness; wider margins waste tokens.

---

## Three-cycle fixture-driven test (PMT-05) — vs Phase 38 contract-level

| Option | Description | Selected |
|--------|-------------|----------|
| Belt-and-suspenders — keep both Phase 38 contract + Phase 40 fixture-driven | Generator-level + orchestrator-level coverage; defense in depth | ✓ |
| Phase 40 fixture-driven only — remove Phase 38 contract test | Reduces test count; loses generator-level isolation | |
| Phase 38 contract only — skip PMT-05 fixture-driven | Saves test budget; loses orchestrator + loader coverage | |

**Selected:** Both (belt-and-suspenders).
**Rationale:** Phase 38's test uses inline mocked substrate (catches generator regressions); Phase 40's uses primed fixture (catches orchestrator + loader regressions). Pitfall 1 (D027 hash-skip regression) is the load-bearing risk this defends. Cost of both tests is minimal.

---

## Live test mode coverage (PMT-06)

| Option | Description | Selected |
|--------|-------------|----------|
| REFLECT mode only | Mirrors Phase 36 PTEST-05; cost discipline ($0.20-0.30/run) | ✓ |
| REFLECT + PSYCHOLOGY (both inject-eligible modes) | More thorough; 2× cost ($0.40-0.60) | |
| All inject-eligible modes (REFLECT + PSYCHOLOGY + JOURNAL absence verification) | Maximum coverage; 3× cost | |

**Selected:** REFLECT only.
**Rationale:** PSYCHOLOGY mode-handler injection is unit-tested in Phase 39. Live-LLM assertion adds little marginal signal at 2× cost. Per D046 cost discipline. PSYCHOLOGY variant deferred to v2.6.1 / M013.

---

## Adversarial regex patterns (PMT-06)

| Option | Description | Selected |
|--------|-------------|----------|
| 5 forbidden trait-authority constructions from REQUIREMENTS PMT-06 verbatim | Locked by REQUIREMENTS; covers known D027 violation classes | ✓ |
| Broader catch-all regex (anything matching "your [trait]") | Maximum coverage; high false-positive risk | |
| LLM-judged sycophancy detection | Adaptive but expensive + tautological | |

**Selected:** 5 verbatim patterns.
**Rationale:** REQUIREMENTS PMT-06 locks these. Broader regex catches benign uses ("I want to ask about your openness to relocation"). LLM-judged adds Sonnet call costs. The 5 patterns are the exact D027-violation classes M008/M010 anti-flattery precedent identified.

---

## Cost discipline

| Option | Description | Selected |
|--------|-------------|----------|
| Operator-invoked only; budget callout in test docblock; default-skip via three-way skipIf | D046 verbatim; clean CI runs | ✓ |
| Run on every CI build (cost: $0.20-0.30 per CI run) | Maximum signal; unaffordable for active development | |
| Run only on release branches | Compromise; complicates CI config | |

**Selected:** Operator-invoked.
**Rationale:** D046 locks this. CI default-skip via three-way `describe.skipIf(!RUN_LIVE_TESTS || !ANTHROPIC_API_KEY || !FIXTURE_PRESENT)`. Operator runs PMT-06 once at milestone close (manual `bash scripts/test.sh` with env vars set).

---

## Claude's Discretion

Listed in 40-CONTEXT.md `<decisions>`:
- File-split for m011-1000words vs m011-30days (recommend separate files per Phase 36 D-21 precedent)
- Cycle 3 mutation mechanism (direct `db.insert` vs helper)
- `OPENNESS_SIGNAL_PHRASES` exact word choice
- Multiple adversarial bait prompts per iteration in PMT-06
- Fact-hallucination assertion implementation depth in PMT-06 D-30 class (a)

## Deferred Ideas

Captured in 40-CONTEXT.md `<deferred>`:
- PSYCHOLOGY-mode live test variant (v2.6.1 / M013)
- Multiple adversarial bait prompts (v2.6.1 if brittleness emerges)
- Cross-profile signature consistency check (CROSS-VAL-01 — v2.6.1 / M014)
- Per-message HEXACO/Schwartz inference (OUT-OF-SCOPE per ANTI-features)
- Designed-signature drift detection (v2.6.1 calibration)
- Live-test variants for below-floor fixtures (unnecessary)
- Schema-version cache-bust live test (out of M011 scope)
- PMT-06 cross-language assertion FR + RU (v2.6.1 alongside Phase 39 D-20)
