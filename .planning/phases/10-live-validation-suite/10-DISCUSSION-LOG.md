# Phase 10: Live Validation Suite - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-13
**Phase:** 10-live-validation-suite
**Areas discussed:** Test Infrastructure, Test Data & Seeding, Contradiction Audit Design, Test Execution Strategy
**Mode:** Auto (all decisions auto-selected from recommended defaults)

---

## Test Infrastructure

| Option | Description | Selected |
|--------|-------------|----------|
| Single file `live-integration.test.ts` | All 24 cases in one file, shared setup | ✓ |
| Split by category (8 files) | One file per test category | |
| Split by feature (3 files: refusal, retrieval, behavior) | Group by feature area | |

**User's choice:** [auto] Single file — all cases share same setup pattern
**Notes:** Mirrors existing integration test patterns in the codebase

| Option | Description | Selected |
|--------|-------------|----------|
| `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` | Skip gracefully without key | ✓ |
| Fail loudly if no API key | Force explicit opt-in | |

**User's choice:** [auto] Skip gracefully — matches existing `models-smoke.test.ts` pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Loop 3x within each test | Simplest, matches D023 | ✓ |
| Vitest `retry` option | Framework-level retry | |
| Custom test wrapper | Reusable retry utility | |

**User's choice:** [auto] Loop 3x within test — simplest implementation matching D023 intent

---

## Test Data & Seeding

| Option | Description | Selected |
|--------|-------------|----------|
| In-test DB seeding (beforeAll/beforeEach) | Self-contained, matches existing pattern | ✓ |
| External seed script | Separate setup step | |
| Shared fixture file | JSON/TS fixture imported by tests | |

**User's choice:** [auto] In-test seeding — matches contradiction-integration.test.ts pattern

| Option | Description | Selected |
|--------|-------------|----------|
| Import GROUND_TRUTH directly | Reuse Phase 6 ground truth array | ✓ |
| Duplicate facts in test file | Independent test data | |

**User's choice:** [auto] Import directly — designed for Phase 10 reuse per Phase 6 D-03

| Option | Description | Selected |
|--------|-------------|----------|
| saveMessage() + DB inserts | Reuse conversation memory infrastructure | ✓ |
| In-memory conversation mock | Lighter but less realistic | |

**User's choice:** [auto] saveMessage() + DB inserts — realistic multi-turn simulation

---

## Contradiction Audit Design

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded fixture array (5 categories x 4 pairs) | Deterministic, reviewable | ✓ |
| Dynamically generated pairs | More variety, less control | |
| LLM-generated adversarial pairs | Creative but non-deterministic | |

**User's choice:** [auto] Hardcoded fixtures — deterministic and reviewable, matches spec's 5 categories

| Option | Description | Selected |
|--------|-------------|----------|
| Real Haiku (end-to-end) | Tests actual pipeline | ✓ |
| Mocked Haiku | Faster but misses real behavior | |

**User's choice:** [auto] Real Haiku — consistent with live test philosophy

---

## Test Execution Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Haiku follow-up call for grounding | Separate verification call | ✓ |
| Keyword matching on response | Simpler but brittle | |

**User's choice:** [auto] Haiku follow-up — matches D023 specification

| Option | Description | Selected |
|--------|-------------|----------|
| Keyword markers for sycophancy | Distinguish engagement from validation | ✓ |
| Haiku classification of response | More sophisticated | |

**User's choice:** [auto] Keyword markers — per D023 specification

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-turn with behavior diff | Verify actually-different follow-up | ✓ |
| Single-turn apology detection | Simpler but incomplete | |

**User's choice:** [auto] Multi-turn — verifies behavior change, not just acknowledgment

---

## Claude's Discretion

- Exact test prompts/messages for each of the 24 cases
- Specific refusal phrases per language
- Haiku follow-up prompt wording
- Sycophancy keyword markers
- Adversarial non-contradictory pair content
- API call timeout values
- Whether to use processMessage() or individual handlers

## Deferred Ideas

None — discussion stayed within phase scope
