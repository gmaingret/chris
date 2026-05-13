# Phase 36: Tests - Research

**Researched:** 2026-05-13
**Domain:** Vitest integration testing + primed-fixture pipeline extension (`--profile-bias`) + live-Sonnet anti-hallucination 3-of-3 atomic
**Confidence:** HIGH (CONTEXT.md decisions are locked; all in-codebase scaffolds verified by direct read; only OQ-4 determinism math has a flagged-risk finding)

## Summary

Phase 36 is the M010-closing test phase. It extends `scripts/synthesize-delta.ts` with a repeatable `--profile-bias <dimension>` flag (locked D-03..D-05), generates two new primed fixtures (`m010-30days` and `m010-5days`, D-07/D-12), and ships five tests (PTEST-01..05) across two plans matching the REQUIREMENTS traceability table.

Plan 36-01 (~7-8 tasks) implements the bias flag and ships four fixture-driven integration tests with mocked Anthropic SDK + real Docker Postgres. Plan 36-02 (~2-3 tasks) ships one live 3-of-3 atomic anti-hallucination test against real Sonnet 4.6, dual-gated by `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=...`. Plan 36-01 lifts Phase 34's `generators.two-cycle.test.ts` scaffold verbatim for PTEST-03 and Phase 24's `primed-sanity.test.ts` for the HARN gate. Plan 36-02 lifts M009's `live-weekly-review.test.ts` dual-gate + 3-of-3 atomic loop verbatim.

**Primary recommendation:** Proceed with the locked CONTEXT.md decisions, but treat OQ-4 (per-dimension entry-count determinism) as the single highest-risk planning concern — see the OQ-4 reconfirmation section below. Math suggests the default configuration is tight against the ≥12 threshold; Plan 36-01 Task 2 should empirically verify the count and fall back to one of three tuning options if any dimension falls below 12.

**Plan-level CRITICAL FINDING:** CONTEXT.md test_strategy and D-26 both state "fixtures + VCR cache are committed to the repo." This contradicts `.gitignore` lines 23-25 which gitignore `tests/fixtures/primed/` and `tests/fixtures/.vcr/`. Plan 36-01 cannot commit the fixtures unless `.gitignore` is amended. Two viable paths exist — see Pitfall P-36-01 below for the recommended resolution.

## User Constraints (from CONTEXT.md)

### Locked Decisions

All 35 decisions D-01..D-35 are LOCKED via the `--auto` flag during `/gsd-discuss-phase 36`. Verbatim from `.planning/phases/36-tests/36-CONTEXT.md`:

- **D-01:** 2 plans matching REQUIREMENTS traceability table — Plan 36-01 ships PTEST-01..04 atomically (HARD CO-LOC #M10-6); Plan 36-02 ships PTEST-05.
- **D-02:** Strict plan ordering. 36-01 ships before 36-02 (36-02 imports the `m010-30days` fixture as a committed artifact — see Pitfall P-36-01 for gitignore implication).
- **D-03:** Flag shape `--profile-bias <dimension>` (single-value, repeatable). `dimension ∈ { jurisdictional, capital, health, family }`. Repeatable via parseArgs `{ type: 'string', multiple: true, default: [] }`. Legacy unbiased behavior preserved when flag omitted.
- **D-04:** Bias mechanism is soft keyword hint appended to Haiku style-transfer system prompt, not hard template substitution. Haiku CHOOSES whether to incorporate the hint.
- **D-05:** Per-dimension keyword lists locked in `PROFILE_BIAS_KEYWORDS: Record<Dimension, readonly string[]>`. Sourced from FEATURES.md §2.1-2.4 + M010 spec language. Exact word lists verbatim in CONTEXT.md D-05.
- **D-06:** VCR cache invalidation is automatic via the bias-keyword string changing the Haiku prompt hash. Operator regenerates via `npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 --profile-bias <each-of-4> --force --seed 42`.
- **D-07:** Fixture name `m010-30days`, target_days=30, dir `tests/fixtures/primed/m010-30days/`, seed=42.
- **D-08:** Single combined fixture with 4-way rotation, NOT 4 separate fixtures.
- **D-09:** Day-to-dimension rotation: round-robin starting jurisdictional → capital → health → family → repeat. Day 0 = jurisdictional; day mod 4 maps to dimension. Locked in `PROFILE_BIAS_ROTATION` constant.
- **D-10:** HARN sanity gate threshold = ≥12 tag-filtered entries per profile dimension via keyword-grep audit (NOT tag inspection per D-11). Gate runs in new file `src/__tests__/fixtures/primed-sanity-m010.test.ts`.
- **D-11:** Dimension classification for HARN = keyword grep over Pensieve content; NO `dimension` column added to schema (v1 simplification per Phase 34 D-14).
- **D-12:** Fixture `m010-5days` at target_days=5, identical seed, same rotation. Same dir convention.
- **D-13:** Sparse-fixture HARN: per-dimension counts ALL < 10. Explicit anti-inflation trip-wire.
- **D-14:** m010-5days expected: all 4 generators log `'chris.profile.threshold.below_minimum'`; all return `{ outcome: 'profile_below_threshold' }`; `expect(mockAnthropicParse).not.toHaveBeenCalled()`.
- **D-15:** Test file `src/memory/profiles/__tests__/integration-m010-30days.test.ts` (new). Mirrors Phase 34 `generators.two-cycle.test.ts`.
- **D-16:** Mock SDK boundary, real Docker Postgres. `vi.mock('@anthropic-ai/sdk', ...)` returns canned Zod-validated profile shapes per dimension.
- **D-17:** PTEST-02 asserts: all 4 confidence > 0, all 4 last_updated advanced, all 4 substrate_hash non-null, profile_history has 4 new rows.
- **D-18:** PTEST-02 + PTEST-03 share file (fixture loading is ~2-3s; splitting duplicates cost).
- **D-19:** Three-cycle structure: Cycle 1 baseline (4 Sonnet calls); Cycle 2 identical substrate (STILL 4 calls — second-fire-blindness regression detector); Cycle 3 mutated substrate (5 cumulative calls).
- **D-20:** Cycle 2 also asserts previous-state injection per PITFALLS M010-10 lines 313-323 verbatim.
- **D-21:** Test file `src/memory/profiles/__tests__/integration-m010-5days.test.ts` (new, separate file).
- **D-22:** PTEST-04 asserts: 4× `'chris.profile.threshold.below_minimum'`; zero Sonnet calls; 4× `'profile_below_threshold'` outcomes.
- **D-23:** Test file `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` (new). Dual-gate: `describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)`.
- **D-24:** REFLECT mode ONLY (not all 3 inject-eligible modes). Cost discipline.
- **D-25:** 3-of-3 atomic loop — single `it()` block with internal `for (let i = 1; i <= 3; i++)` mirroring `live-weekly-review.test.ts:69-89`.
- **D-26:** `m010-30days` fixture loaded once in `beforeAll` (not per-iteration).
- **D-27:** First assertion: system prompt contains `## Operational Profile (grounded context — not interpretation)` block AND at least one rendered dimension field. Mock spy + pass-through pattern (see "Mock spy on real Anthropic call" section below for the implementation pattern).
- **D-28:** Second assertion: Sonnet response does NOT match any `FORBIDDEN_FACTS` keyword. Forbidden-fact keyword list (≥12 entries) approach (Strategy A); Haiku judge deferred to v2.5.1.
- **D-29:** Forbidden-fact keyword list locked in `FORBIDDEN_FACTS` constant. Sourced from facts NOT in the m010-30days fixture's profile data. Concrete enumeration of fixture-contradicting keywords drafted in CONTEXT.md D-29. Planner refines after Plan 36-01 generates the fixture.
- **D-30:** Cost budget ~$0.20/run (CONTEXT.md). My refined estimate (Sonnet 4.6 = $3/$15 per million tokens): $0.10-0.15/run for 3 REFLECT calls. Conservatively budget $0.25/run.
- **D-31:** REFLECT user-message prompt is deliberately tangential: "Help me think about my next quarter's priorities."
- **D-32:** Use M009 / M008 live-test scaffold verbatim from `src/rituals/__tests__/live-weekly-review.test.ts:1-100` and `src/episodic/__tests__/live-anti-flattery.test.ts:1-300`.
- **D-33:** Use Phase 34 `generators.two-cycle.test.ts` scaffold verbatim for PTEST-03.
- **D-34:** Use Phase 24 `primed-sanity.test.ts` scaffold for m010 HARN gates.
- **D-35:** All 5 PTEST tests passing is the M010 milestone-gate. PTEST-05 is the final gate.

### Claude's Discretion

- Test runner shape: recommend `describe.skipIf(...)` (consistency with M009 + M006).
- VCR cache pinning: planner choice; lump pattern is fine.
- Logger spy mechanism: `vi.spyOn(logger, 'info')` — exact mock setup per planner.
- Fixture-load timing: recommended `beforeAll` for fixture load + per-cycle `db.update(...)` for state mutations.
- HARN sanity file location: recommended (b) sibling file `primed-sanity-m010.test.ts` to avoid M009/M010 coupling.

### Deferred Ideas (OUT OF SCOPE)

- Haiku post-judge for live anti-hallucination (Strategy B); v2.5.1 candidate.
- Per-dimension live tests for COACH + PSYCHOLOGY; v2.5.1 if behavioral drift surfaces.
- Per-field source citations in profile output (DIFF-2 / M010-02); v2.5.1.
- Tag-by-dimension column on pensieve_entries (v2.5.1 if production fidelity needs it).
- Snapshot pinning per VCR cache file (operator preference).
- `m010-90days` long-horizon fixture for SATURATION calibration; v2.5.1.
- Multi-profile cross-reference fixtures (DIFF-1); M013 candidate.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PTEST-01 | `tests/fixtures/primed/m010-30days/` covering all 4 dimensions with ≥12 per dimension; `synthesize-delta.ts --profile-bias` flag | OQ-4 reconfirmation flags the count as TIGHT — see § OQ-4 below; injection point in `synthesize-delta.ts:264-276` (buildHaikuSystemPrompt) is straightforward additive change [VERIFIED: direct read of scripts/synthesize-delta.ts] |
| PTEST-02 | Real-DB integration test loading m010-30days, asserts all 4 profiles populate with confidence > 0, last_updated advances, substrate_hash non-null | Phase 34's `generators.two-cycle.test.ts` provides verbatim scaffold (cleanupAll, primeAllDimensionsValid, FUTURE_RESOLVE_BY constant) [VERIFIED: file read] |
| PTEST-03 | Two-cycle integration: Week 1 substrate A populates; Week 2 substrate A → identical hash → no second Sonnet call; Week 2 substrate B → update fires | Phase 34's two-cycle test is the same 3-cycle structure (Cycle 1 / Cycle 2 identical / Cycle 3 mutated); explicit `mockAnthropicParse.toHaveBeenCalledTimes(N)` assertions at lines 262, 307, 346 [VERIFIED] |
| PTEST-04 | Sparse-fixture test — m010-5days → all 4 profiles return "insufficient data" + confidence=0 + skip log line | Phase 34's `generators.sparse.test.ts` provides the asserting-shape blueprint (already validates the `'chris.profile.threshold.below_minimum'` log key at line 147) [VERIFIED] |
| PTEST-05 | Live 3-of-3 atomic anti-hallucination against real Sonnet; dual-gated; ~$0.20/run; mirrors M009 TEST-31 | M009 TEST-31 (`live-weekly-review.test.ts:65-130`) is the verbatim scaffold: `describe.skipIf(!RUN_LIVE_TESTS || !ANTHROPIC_API_KEY)`, single `it()` with internal `for (let i = 0; i < 3; i++)` loop, 90s timeout [VERIFIED] |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `--profile-bias` CLI flag parsing | Build / CLI tooling | — | `parseArgs` already used in `synthesize-delta.ts`; flag is additive |
| Bias keyword hint composition | Build / CLI tooling | — | Per-day dimensionHint string built at fixture-generation time, NOT runtime |
| VCR cache hash key derivation | Test infrastructure | — | `src/__tests__/fixtures/vcr.ts:92 hashRequest()` consumes the full request including the bias-augmented prompt → automatic invalidation |
| Fixture artifact (JSONL files) | Test fixtures (filesystem) | — | `tests/fixtures/primed/m010-*days/` — gitignored per `.gitignore:24` (see Pitfall P-36-01) |
| HARN sanity assertions | Test layer | — | `src/__tests__/fixtures/primed-sanity-m010.test.ts` runs in normal Docker gate (per-dimension keyword grep over loaded fixture content) |
| Mocked Anthropic + real Postgres integration tests | Test layer | DB | `vi.mock('../../../llm/client.js', ...)` per Phase 34 scaffold; real Docker Postgres via `loadPrimedFixture` |
| Live REFLECT → Sonnet boundary capture | Test layer | LLM | Spy on `anthropic.messages.create` while preserving real call execution (mock-spy-with-passthrough pattern) |
| Forbidden-fact assertion | Test layer (pure JS) | — | String matching over response text; no LLM calls |
| Milestone-close gate | Test layer (PTEST-05 outcome) | — | Operator runs `/gsd-complete-milestone` after PTEST-05 passes |

## Standard Stack

### Core (already in repo; no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vitest` | 4.1.x | Test runner | Project standard per CLAUDE-discoverable `package.json`; per `.planning/codebase/TESTING.md:7` [VERIFIED: TESTING.md] |
| `drizzle-orm` | (already pinned) | Real Postgres queries in integration tests | Standard repo pattern [VERIFIED: imported across all profile tests] |
| `@anthropic-ai/sdk` | (already pinned) | Live Sonnet call in PTEST-05 | Standard repo pattern [VERIFIED] |
| `postgres` | (already pinned) | Real Docker Postgres driver | Project standard [VERIFIED] |
| `zod` v3 + `zod/v4` | (already pinned) | Validate canned mock responses in PTEST-02/03 + the Haiku VCR cache parse | Phase 34 dual-schema pattern [VERIFIED: schemas.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `loadPrimedFixture` | local helper (`src/__tests__/fixtures/load-primed.ts`) | Seeds Docker Postgres from JSONL fixture | PTEST-02/03/04 — loads m010-30days or m010-5days [VERIFIED] |
| `cachedMessagesParse` | local helper (`src/__tests__/fixtures/vcr.ts`) | Wraps Haiku call with content-addressable cache | Plan 36-01 fixture regeneration only; production tests use mocked SDK [VERIFIED] |
| `mulberry32` + `seededSample` | local helper (`src/__tests__/fixtures/seed.ts`) | Deterministic PRNG for fixture composition | Already used in synthesize-delta.ts:58-61 [VERIFIED] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mock SDK + real Postgres in PTEST-02/03 | All-mocked unit tests | Real-DB catches Drizzle column-name + JSONB serialization bugs that mocks miss — Phase 33 D-04/D-11 patterns require real Postgres validation |
| Single combined fixture (D-08) | Per-dimension fixtures | Per-dimension fixtures triple VCR cache size + triple HARN setup cost with no marginal correctness signal |
| Forbidden-fact keyword list (D-28 Strategy A) | Haiku post-judge (D-28 Strategy B) | Keyword list is deterministic + free; Haiku judge is semantic but doubles cost and adds non-determinism — deferred to v2.5.1 |

**Installation:** None — Phase 36 introduces zero new dependencies.

**Version verification:** N/A — no new packages.

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────┐
                        │  Phase 36 — Plan 36-01 surface       │
                        └─────────────────────────────────────┘

  Operator (manual one-time):
  npx tsx scripts/regenerate-primed.ts                     ┌──> Anthropic Haiku
    --milestone m010 --target-days 30 --force --seed 42    │    (only on cache miss)
    --profile-bias jurisdictional --profile-bias capital   │
    --profile-bias health --profile-bias family            │
            │                                              │
            ▼                                              │
  scripts/synthesize-delta.ts                              │
    │   PROFILE_BIAS_KEYWORDS (D-05)                       │
    │   PROFILE_BIAS_ROTATION (D-09)                       │
    │   dimensionHintFor(dayIndex, biases) → appended to   │
    │     buildHaikuSystemPrompt                           │
    │                                                      │
    │   cachedMessagesParse({ system: prompt+hint, ... })  │
    │   ────────────────────────────────────────────────►──┤
    │   ◄─cached response (deterministic byte-stable)──────┘
    │
    ▼
  tests/fixtures/primed/m010-30days/{MANIFEST.json,*.jsonl}
  tests/fixtures/primed/m010-5days/{MANIFEST.json,*.jsonl}
  tests/fixtures/.vcr/<sha256>.json                        ◄── ALL gitignored (P-36-01)

                        ┌─────────────────────────────────────┐
                        │  Phase 36 — Plan 36-01 test runtime  │
                        └─────────────────────────────────────┘

  bash scripts/test.sh src/__tests__/fixtures/primed-sanity-m010.test.ts
    │
    ▼
  loadPrimedFixture('m010-30days')                  ┌── Docker Postgres (port 5433)
    │   1. cleanup all tables FK-reverse-order      │     all tables seeded from
    │   2. bulk-insert JSONL via                   ─┤     m010-30days JSONL files
    │      jsonb_populate_recordset                 │
    │   3. NOTE: does NOT touch profile_* tables ───┘     (Phase 33 seed rows
    │                                                       PRESERVED from migration)
    │
    ▼
  primed-sanity-m010.test.ts                       ┌── per-dimension keyword grep
    │   assert ≥12 jurisdictional entries          │     against PROFILE_BIAS_KEYWORDS
    │   assert ≥12 capital entries                ─┤     (D-11)
    │   assert ≥12 health entries                   │
    │   assert ≥12 family entries                   │
    │   (m010-5days variant: assert <10 each)       │
    │
    ▼
  integration-m010-30days.test.ts (PTEST-02 + PTEST-03)
    │   vi.mock anthropic.messages.parse            ┌── 4 generators called per cycle
    │   call updateAllOperationalProfiles()        ─┤     (orchestrator from Phase 34)
    │   Cycle 1: 4 calls + 4 history rows           │     real upsert to profile_*
    │   Cycle 2: STILL 4 calls (D-19 idempotency)   │     real history INSERT
    │   Cycle 3: 5 cumulative calls (1 mutation)    │
    │
    ▼
  integration-m010-5days.test.ts (PTEST-04)
    │   threshold gate → no Sonnet calls
    │   4 outcomes = 'profile_below_threshold'

                        ┌─────────────────────────────────────┐
                        │  Phase 36 — Plan 36-02 live test     │
                        └─────────────────────────────────────┘

  RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... \
  bash scripts/test.sh src/memory/profiles/__tests__/live-anti-hallucination.test.ts
    │
    ▼  describe.skipIf(!RUN_LIVE_TESTS || !ANTHROPIC_API_KEY)
  beforeAll → loadPrimedFixture('m010-30days')
  beforeAll → updateAllOperationalProfiles()  ── populates profile_* with real Sonnet
                                                  (one-time cost amortized over 3 iter)
    │                                              ALTERNATIVE: load fixture pre-populated
    │                                              profile rows via separate JSONL files
    │                                              (NOT in current loadPrimedFixture scope)
    ▼
  it() { for (let i = 1; i <= 3; i++) {
    spy on anthropic.messages.create (preserves real call) ─┐
    handleReflect(chatId, "Help me think about my next      │
       quarter's priorities", "English", [])               ─┤
                                                            │
    inspect spy.mock.calls[i-1][0].system[0].text          ─┤
    assert contains "## Operational Profile..."             │
    assert contains at least one profile field              │
                                                            │
    extract response.content[0].text                        │
    assert no FORBIDDEN_FACTS keyword appears  ─────────────┘
  } }
```

### Recommended Project Structure (no new dirs; existing layout)

```
scripts/
├── synthesize-delta.ts          # EXTEND with --profile-bias flag (Plan 36-01 Task 1)
└── regenerate-primed.ts         # EXTEND pass-through args (Plan 36-01 Task 1)

src/
├── __tests__/fixtures/
│   ├── primed-sanity.test.ts            # EXISTING — m009 sanity gate
│   └── primed-sanity-m010.test.ts       # NEW — Plan 36-01 (D-34)
└── memory/profiles/__tests__/
    ├── generators.sparse.test.ts            # EXISTING — Phase 34 threshold
    ├── generators.two-cycle.test.ts         # EXISTING — Phase 34 two-cycle scaffold
    ├── integration-m010-30days.test.ts      # NEW — Plan 36-01 (PTEST-02 + PTEST-03)
    ├── integration-m010-5days.test.ts       # NEW — Plan 36-01 (PTEST-04)
    └── live-anti-hallucination.test.ts      # NEW — Plan 36-02 (PTEST-05)

tests/fixtures/primed/             # GITIGNORED (see Pitfall P-36-01)
├── m009-21days/                   # EXISTING
├── m010-30days/                   # NEW — generated by Plan 36-01 Task 2
└── m010-5days/                    # NEW — generated by Plan 36-01 Task 2

tests/fixtures/.vcr/               # GITIGNORED — new entries on Plan 36-01 first regen run
```

### Pattern 1: Repeatable CLI flag via `parseArgs` (Plan 36-01 Task 1)

**What:** Extending `synthesize-delta.ts` with a repeatable string flag.
**When to use:** Plan 36-01 Task 1.
**Example:**
```typescript
// Source: VERIFIED extension to scripts/synthesize-delta.ts:152-161
options: {
  organic: { type: 'string' },
  'target-days': { type: 'string' },
  seed: { type: 'string' },
  milestone: { type: 'string' },
  'no-refresh': { type: 'boolean', default: false },
  help: { type: 'boolean', default: false },
  // NEW: repeatable per-dimension bias
  'profile-bias': { type: 'string', multiple: true, default: [] as string[] },
}
```
Then parsing into `Args.profileBias: Dimension[]` with runtime validation `dim ∈ { 'jurisdictional', 'capital', 'health', 'family' }`.

### Pattern 2: Soft keyword hint injection (Plan 36-01 Task 1)

**What:** Append a per-day dimension hint to the existing Haiku style-transfer system prompt without disturbing the existing few-shot voice instructions.
**Where:** `scripts/synthesize-delta.ts:264-276` (`buildHaikuSystemPrompt`).
**Example:**
```typescript
// Source: VERIFIED architectural pattern
function buildHaikuSystemPrompt(
  fewShot: readonly Record<string, unknown>[],
  dateIso: string,
  nEntries: number,
  dimensionHint?: string,  // NEW — optional per-day bias keyword sentence
): string {
  const bullets = fewShot.map(...).join('\n');
  const hintLine = dimensionHint
    ? `\n\nFor today's entries specifically, include at least one mention related to: ${dimensionHint}. Distribute naturally; do not force every entry to mention this.`
    : '';
  return `You are mimicking Greg's Telegram voice. ... ${hintLine}\n\nFew-shot entries:\n${bullets}`;
}

// Caller (synthesize-delta.ts:521-527) modification:
const bias = PROFILE_BIAS_ROTATION[d % PROFILE_BIAS_ROTATION.length]; // when biases provided
const dimensionHint = biases.length > 0 && biases.includes(bias)
  ? PROFILE_BIAS_KEYWORDS[bias].join(', ')
  : undefined;
const systemPrompt = buildHaikuSystemPrompt(fewShot, dayDateStr, ENTRIES_PER_DAY, dimensionHint);
```

### Pattern 3: VCR cache automatic invalidation (D-06 — no manual bookkeeping needed)

**What:** Changing the bias keyword changes the Haiku prompt's full text, which changes the SHA-256 hash that VCR uses as a cache key. Old cache entries become irrelevant; new cache entries are created on the first regen run.
**Where:** `src/__tests__/fixtures/vcr.ts:92` (`hashRequest` function).
**Example:**
```typescript
// Source: VERIFIED at vcr.ts:88-94
export function hashRequest(request: unknown): string {
  return createHash('sha256').update(canonicalStringify(request)).digest('hex');
}
// canonicalStringify includes the ENTIRE request — model, system text, messages, output_config.
// Any change to system text (which includes the bias hint) auto-invalidates.
```
**Verification:** Plan 36-01 Task 1's unit test asserts the cache hash differs between biased and unbiased runs (test_strategy item 1.e in CONTEXT.md).

### Pattern 4: Mock-spy-with-passthrough for PTEST-05 (Plan 36-02)

**What:** Capture the args of `anthropic.messages.create` while letting the real call execute, so we can both inspect the system prompt AND get Sonnet's real response back.
**When to use:** PTEST-05 only.
**Recommended:** `vi.spyOn(anthropic.messages, 'create')` — when called without `.mockImplementation(...)`, vitest's spyOn preserves the original implementation by default, so the real call goes through. Spies capture all call args via `.mock.calls[N][0]`.
**Example:**
```typescript
// Source: [CITED: vitest spy docs https://vitest.dev/api/vi.html#vi-spyon]
import { anthropic } from '../../llm/client.js';

// In beforeAll or inside the it() loop:
const spy = vi.spyOn(anthropic.messages, 'create');

const response = await handleReflect(chatId, "Help me think about my next quarter's priorities", "English", []);

// spy.mock.calls[0][0] is the request object passed to messages.create
const callArgs = spy.mock.calls[spy.mock.calls.length - 1][0];
const systemText = (callArgs.system as Array<{ text: string }>)[0].text;
expect(systemText).toContain('## Operational Profile (grounded context — not interpretation)');
expect(systemText).toMatch(/(current_country|fi_target_amount|jurisdictional|capital)/);
```
**Alternative (rejected):** Hand-rolled wrapper function. More boilerplate, no benefit.
**Caveat:** `vi.spyOn` MUST be set up AFTER any `vi.mock('../../llm/client.js', ...)` factory. In PTEST-05 we do NOT mock the anthropic module — only spy on it.

### Pattern 5: 3-of-3 atomic loop with internal failure aggregation (Plan 36-02)

**What:** Single `it()` block with internal `for (let i = 0; i < 3; i++)`; aggregate failures across iterations; single hard assertion at the end.
**Where:** Verbatim scaffold from `src/rituals/__tests__/live-weekly-review.test.ts:65-130`.
**Example:**
```typescript
// Source: VERIFIED at live-weekly-review.test.ts:65-130
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)(
  'PTEST-05: Live anti-hallucination (3-of-3 against real Sonnet)',
  () => {
    let spy: ReturnType<typeof vi.spyOn>;
    beforeAll(async () => {
      await loadPrimedFixture('m010-30days');
      // Populate profile rows via mocked-orchestrator OR fresh-Sonnet call
      // (see Open Question OQ-36-01 below).
      spy = vi.spyOn(anthropic.messages, 'create');
    });

    it('zero forbidden facts AND profile block present across 3-of-3 iterations',
      async () => {
        const failures: string[] = [];
        for (let i = 1; i <= 3; i++) {
          const response = await handleReflect(/* ... */);
          const callArgs = spy.mock.calls[spy.mock.calls.length - 1][0];
          // Assertion 1: system prompt block presence
          // Assertion 2: scan response for FORBIDDEN_FACTS
          // Aggregate via `failures.push(...)` per-iteration
        }
        expect(failures, `Across 3-of-3 iterations`).toEqual([]);
      },
      90_000, // 90s timeout (3 × ~25s per Sonnet call + retry buffer)
    );
  }
);
```

### Anti-Patterns to Avoid

- **Use `vi.useFakeTimers`:** FORBIDDEN per `.planning/codebase/TESTING.md:178` D-02. Use `vi.setSystemTime` only; profile generators use explicit `now` param (see Phase 34's two-cycle test header comment).
- **Re-mock the SDK in PTEST-05 (defeats the test):** PTEST-05 must let the real call execute. Only `vi.spyOn` (capture args, default passthrough), never `vi.mock(...)`.
- **Commit the fixture without amending `.gitignore`:** See Pitfall P-36-01 below.
- **Run PTEST-05 in CI:** Dual-gate via `RUN_LIVE_TESTS` ensures CI without that env var skips. Confirm CI does not accidentally set it.
- **Use 4 separate fixtures for the 4 dimensions:** Per D-08, single combined fixture is locked.
- **Add a `dimension` column to `pensieve_entries` schema:** Per D-11, v1 uses keyword-grep at HARN audit time. Schema change is a v2.5.1 candidate only if needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bulk-load JSONL into Docker Postgres | Custom `db.insert(...)` loop | `loadPrimedFixture('m010-30days')` | Already handles FK-safe cleanup + idempotent bulk-insert via `jsonb_populate_recordset` [VERIFIED: load-primed.ts] |
| Content-addressable LLM-call caching | New caching module | `cachedMessagesParse` from `src/__tests__/fixtures/vcr.ts` | Canonical SHA-256 + atomic file writes already implemented; manipulating it would risk vcr.ts:46-47's recursive-self-call infinite loop [VERIFIED: vcr.ts] |
| Deterministic PRNG | New random module | `mulberry32` + `seededSample` from `src/__tests__/fixtures/seed.ts` | Already imported by synthesize-delta.ts; same seed gives byte-identical output across machines |
| Anthropic SDK mock-spy-with-passthrough | Custom wrapper | `vi.spyOn(anthropic.messages, 'create')` | vitest's spyOn preserves original implementation when called without `.mockImplementation(...)` |
| Dual-gate skip mechanism | Manual `if (process.env...) return;` | `describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)(...)` | M009 TEST-31 + M008 TEST-22 precedent; preserves test-count stability when gate fails |

**Key insight:** Plan 36-01 + 36-02 introduce ZERO new infrastructure. Every primitive (fixture loader, VCR cache, deterministic PRNG, mock-spy, dual-gate) already exists. The phase is exclusively composition + 4 new test files + 1 CLI flag extension.

## Runtime State Inventory

> Phase 36 is a test-only phase. No production code paths are modified beyond the additive `--profile-bias` flag in `synthesize-delta.ts`. Runtime state inventory below catalogs the categories anyway for completeness — most are explicit "Nothing found."

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None. m010-30days + m010-5days are FILESYSTEM artifacts only. Docker Postgres is reset per test run (per TESTING.md:60 `tmpfs` for `/var/lib/postgresql/data`). | None. |
| Live service config | None. No production services touched. The Phase 34 weekly cron at Sunday 22:00 Paris is registered but is NOT exercised by Phase 36 tests. | None. |
| OS-registered state | None. Phase 36 introduces no new cron jobs, no new pm2 processes, no new systemd units. | None. |
| Secrets/env vars | New env var convention: `RUN_LIVE_TESTS=1` (already a M009 TEST-31 / M008 TEST-22 convention; not Phase 36-introduced). PTEST-05 reads `process.env.ANTHROPIC_API_KEY` (already a project convention). | None — no new secrets to provision. |
| Build artifacts / installed packages | None. Zero new npm dependencies. | None. |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — **Answer: Nothing.** This is a pure test-additive phase.

## OQ-4 Reconfirmation (CRITICAL — flagged for planner)

**Question:** Does 4-way round-robin rotation over 30 days × 3 entries/day deterministically produce ≥12 keyword-classifiable entries per dimension?

**Quantitative analysis** (against `m009-21days` empirical baseline):

Empirical baseline measurement (`m009-21days/pensieve_entries.jsonl`, 199 organic + 12 synth = 211 total entries, no `--profile-bias` applied):
- jurisdictional keyword matches: 7
- capital keyword matches: 1
- health keyword matches: 1
- family keyword matches: 1

This empirically confirms PITFALLS M010-05 — the unbiased synth pipeline does NOT cover all 4 dimensions adequately. The `--profile-bias` mechanism is genuinely necessary.

**Projected m010-30days budget** (organic ~17 unique dates per `.planning/codebase/TESTING.md:319`, target_days=30):
- `synth_days_needed = max(0, 30 - 17) = 13`
- `ENTRIES_PER_DAY = 3` (locked at scripts/synthesize-delta.ts:76)
- Total synth entries = 13 × 3 = **39**
- 4-way rotation: each dimension gets ~3.25 synth days → ~9.75 synth entries per dimension
- Plus organic baseline (per m009 measurement): 1-7 per dimension
- **Total per dimension: ~10-15** — TIGHT margin against ≥12 threshold

**Risk classification:** If Haiku ignores the soft hint ≥40% of the time (plausible — D-04 explicitly accepts "Haiku CHOOSES whether to incorporate the hint"), per-dimension counts drop to ~6-7 — **below threshold**.

**Recommended planning action:** Plan 36-01 Task 2 should run regenerate-primed once and **immediately verify** per-dimension keyword grep counts BEFORE locking the fixture. If any dimension is < 12, apply one of three tuning options (in increasing order of disruption):

| Option | Change | Per-dim count (theory) | Cost |
|--------|--------|----------------------|------|
| A | Increase `ENTRIES_PER_DAY` from 3 to 4 (constant at synthesize-delta.ts:76) | ~13 + organic = ~18 | +30% Haiku tokens; minor |
| B | Change `--target-days 30` to `--target-days 35` | ~14 + organic = ~19 | +40% Haiku calls (5 more days); minor |
| C | Change `PROFILE_BIAS_ROTATION` from 1-day round-robin (D-09) to 2-day blocks per dimension (deviates from D-09) | ~6 synth-days per dim × 3 = ~18 + organic | None; but requires D-09 amendment |

**Plan author's recommendation:** Use Option B (`--target-days 35`). It's the smallest disruption: doesn't change any locked constant, doesn't deviate from D-09, doesn't touch synthesize-delta.ts beyond the bias flag. CONTEXT.md D-07 names the fixture `m010-30days` — Option B would rename to `m010-35days`. If renaming the fixture conflicts with the locked name in D-07, fall back to Option A (which preserves the fixture name).

**Determinism note:** Same `--seed 42` produces byte-identical output across runs IF the VCR cache is populated. Different `--target-days` values produce DIFFERENT synth-day count → DIFFERENT cache keys → DIFFERENT outputs (NOT a determinism bug; it's the intended cache-key behavior per D-06).

**Confidence:** HIGH that the projected counts are accurate. MEDIUM that any single tuning option will land ≥12 per dimension — the precise effectiveness of Haiku's soft-hint compliance is unknown until empirical measurement.

## Forbidden-Facts list construction (PTEST-05, D-29)

**Strategy:** The FORBIDDEN_FACTS list MUST be derived from facts NOT present in `m010-30days` profile data. Since Plan 36-02 ships AFTER Plan 36-01 has generated the fixture AND populated the profile rows via Plan 36-01 PTEST-02 (or a one-time Sonnet call in PTEST-05's `beforeAll`), the planner can inspect the actual profile content at Plan 36-02 task-expansion time.

**Seed-row baseline (locked at migration 0012):** Even before any Sonnet call, the Phase 33 seed rows define the SHAPE of fact-space:

- **Jurisdictional:** seed has `current_country: "Russia"`, `physical_location: "Saint Petersburg"`, `residency_status: ["Panama permanent_residency", "Georgian business_residency"]`, `active_legal_entities: ["MAINGRET LLC (New Mexico, USA)", "Georgian Individual Entrepreneur"]`, `next_planned_move: "Batumi, Georgia (2026-04-28)"`, `passport_citizenships: ["French"]` [VERIFIED: migrations/0012_operational_profiles.sql:137-148]
- **Capital:** seed has `fi_target_amount: "$1,500,000"`, `income_sources: ["Golfe-Juan rental property (Citya), rental_income"]` [VERIFIED: migration lines 159-169]
- **Health:** seed has `case_file_narrative: "insufficient data"`; all other fields empty
- **Family:** seed has `relationship_status: "insufficient data"`; all other fields empty

**FORBIDDEN_FACTS candidates** (≥12 required per D-29, mirroring M008 TEST-22's 17-marker pattern):

| Dim | Forbidden keyword | Why it's adversarial |
|-----|-------------------|----------------------|
| Jurisdictional | "moving to Portugal" | Not in fixture; contradicts Batumi/Georgia plan |
| Jurisdictional | "Spain residency" | Not in fixture |
| Jurisdictional | "Russian passport" | Greg has French (per seed) |
| Jurisdictional | "Israeli citizenship" | Not in fixture |
| Jurisdictional | "British citizenship" | Not in fixture |
| Jurisdictional | "moving back to France" | Contradicts Batumi plan |
| Capital | "$5,000,000" | Not the FI target |
| Capital | "$10M target" | Not the FI target |
| Capital | "early retirement next year" | Speculative |
| Capital | "selling MAINGRET" | No such decision in fixture |
| Health | "diabetes" | No health facts in seed |
| Health | "cancer" | No health facts in seed |
| Health | "depression diagnosis" | No health facts in seed |
| Health | "ADHD medication" | No health facts in seed |
| Family | "you have children" | Family seed = insufficient data |
| Family | "you are divorced" | Family seed = insufficient data |
| Family | "you are engaged" | Family seed = insufficient data |
| Family | "you are married" | Family seed = insufficient data |

**Recommendation:** Plan 36-02 ships ~16 forbidden keywords (matching M008 TEST-22's 17-marker density). Planner refines this list AFTER Plan 36-01 PTEST-02 populates the profile rows and the actual Sonnet-emitted facts can be inspected. The list should NOT contain facts that ARE in the fixture (e.g., "Russia", "Saint Petersburg", "Batumi", "French", "MAINGRET", "$1,500,000" must NOT be in the forbidden list — they're legitimate references).

**Implementation note:** Use case-insensitive substring matching (`response.toLowerCase().includes(keyword.toLowerCase())`). Mirror the M008 `findFlatteryHits` pattern but lighter-weight (no per-word boundary tokenization needed; PTEST-05 is detecting specific phrase substrings).

## VCR Cache Cost (PTEST-01 first regen)

**Math** (mirroring `.planning/codebase/TESTING.md:272-283`):

- m010-30days first regen: ~13 synth days × 1 Haiku call/day = **13 Haiku calls** × ~$0.001 = **~$0.013**
- Plus episodic synth (~13 days × 1 Sonnet call/day = 13 calls × ~$0.005) = **~$0.065**
- **Total cold-cache m010-30days regen: ~$0.08**
- m010-5days first regen: ~5 synth days → ~5 Haiku calls (~$0.005) + ~5 Sonnet calls (~$0.025) = **~$0.030**
- Warm cache (subsequent runs): **$0.00** (all hits)
- **Combined first-time fixture generation cost: ~$0.11**

This is well under PTEST-05's live-test budget; one-time cost.

## PTEST-05 Cost Refinement

**CONTEXT.md D-30 estimate:** ~$0.20/run (3 × Sonnet 4.6 × ~$0.067 each).

**Refined estimate using actual Sonnet 4.6 pricing** ($3 input / $15 output per million tokens) [CITED: Anthropic pricing — see Sources]:
- REFLECT system prompt with profile injection: ~5-8K tokens
- Response: ~500-1500 tokens
- Per call cost: (0.005-0.008 × $3) + (0.001 × $15) = $0.015-0.024 + $0.015 = **$0.030-$0.040 per call**
- 3 iterations: **~$0.09-$0.12/run**

**Conservative budget:** **$0.25/run** (covers worst-case 8K system + 2K response).

**Confidence:** HIGH that the budget is well within the ~$0.20 CONTEXT.md estimate.

## Common Pitfalls

### Pitfall P-36-01: Fixture commit policy contradicts `.gitignore`

**What goes wrong:** CONTEXT.md test_strategy ("Both m010-30days and m010-5days fixtures + their VCR cache files are committed to the repo") cannot be honored because `.gitignore` lines 23-25 explicitly gitignore `tests/fixtures/prod-snapshot/`, `tests/fixtures/primed/`, and `tests/fixtures/.vcr/`. If Plan 36-01 attempts `git add tests/fixtures/primed/m010-30days/`, git will silently ignore the path and the fixture will never be committed.

**Why it happens:** The gitignore was added during Phase 24 (primed-fixture pipeline introduction) and was a deliberate decision — fixtures are regenerable, byte-identical given the VCR cache, and ~2.6MB each. CONTEXT.md was written without re-checking the gitignore.

**How to avoid:** Two options.

**Option A (preserve gitignore — RECOMMENDED):** Plan 36-02's `beforeAll` regenerates the fixture if absent: `if (!existsSync('tests/fixtures/primed/m010-30days/MANIFEST.json')) { console.log('...regenerate via npx tsx scripts/regenerate-primed.ts...') ; describe.skip(...) }`. This mirrors the existing `primed-sanity.test.ts:82-90` pattern. Operator runs the regeneration command once on a fresh checkout. The VCR cache is also gitignored, so the first run hits the live Anthropic API (cost ~$0.11 — see § VCR Cache Cost section above).

**Option B (commit the fixture — DISRUPTIVE):** Plan 36-01 amends `.gitignore` to negate-ignore `m010-30days` + `m010-5days`: `!tests/fixtures/primed/m010-30days/` and `!tests/fixtures/primed/m010-5days/`. Then `git add` will work. But: the VCR cache files (`tests/fixtures/.vcr/*.json`) are content-addressable and would also need committing; they grow with each new prompt-template change. Cost: ~5-8MB committed binary churn.

**Recommendation:** Option A. Mirrors the `primed-sanity.test.ts` precedent (it `describe.skip`'s when m009-21days is absent). Aligns with the gitignore intent (fixtures are regenerable, not source-of-truth). Avoids the long-term repo-bloat of committed VCR caches.

**Warning signs:**
- Plan 36-01 commit log shows `tests/fixtures/primed/m010-30days/MANIFEST.json` added with zero file-content (gitignore swallowed it silently).
- Plan 36-02 PTEST-05 fails on a fresh CI run with `LOAD_PRIMED_MISSING_DIR` error.
- A future operator can't reproduce the test results because the fixture is missing.

### Pitfall P-36-02: `loadPrimedFixture` does NOT clear or seed `profile_*` tables

**What goes wrong:** PTEST-02/03/04 load m010-30days via `loadPrimedFixture('m010-30days')`. The loader cleans + re-inserts 10 tables (relational_memory, pensieve_entries, decisions, episodic_summaries, etc.) but **does NOT touch `profile_jurisdictional`, `profile_capital`, `profile_health`, `profile_family`, or `profile_history`** [VERIFIED: load-primed.ts:222-280].

This means: the Phase 33 seed rows (from migration 0012) **persist** between test runs. PTEST-02's Cycle 1 starts with `substrate_hash = ''` (Phase 33 D-18 seed value) — that's correct, intentional behavior. BUT: across test FILES, if `integration-m010-30days.test.ts` runs after `integration-m010-5days.test.ts` (or vice versa), one test's upsert leaves a hash like `a3c2...64hex` in the profile row, and the next test starts with that hash instead of the seed `''`.

**Why it happens:** Phase 24's loader was built before Phase 33; it doesn't know about the profile tables. The two-cycle and sparse tests in Phase 34 work around this by calling `cleanupAll()` (Phase 34 test pattern) which uses `TRUNCATE TABLE pensieve_entries CASCADE` — but profile tables are NOT in any FK chain from pensieve_entries, so CASCADE doesn't reach them.

**How to avoid:** Plan 36-01 Tasks 3-5 must explicitly reset the profile tables to seed-row state in `beforeEach`. Two viable patterns:

1. **Truncate + re-seed via migration re-apply** (heavy): re-run the migration's INSERT statements in `beforeEach`. Mirrors Phase 33's `seed.test.ts` if it exists. Cost: ~50ms per test.
2. **Targeted UPDATE back to seed values** (lighter, but brittle if seed migration changes): `UPDATE profile_jurisdictional SET substrate_hash='', confidence=0.3, ...` per dimension. Mirrors Phase 34 `generators.two-cycle.test.ts:100-108`'s `cleanupAll()` extension.

**Recommended:** Pattern 1 (re-seed via migration replay). Plan 36-01 Task 3 creates a `seedProfileRows()` helper in a shared location (e.g., `src/__tests__/fixtures/seed-profile-rows.ts`) that idempotently re-inserts the seed rows via `ON CONFLICT (name) DO UPDATE SET ...`. PTEST-02/03/04 + the HARN sanity test all call it in `beforeEach`.

**Warning signs:**
- PTEST-02 passes in isolation but fails when run after PTEST-04 (or vice versa).
- `substrate_hash` is not `''` in Cycle 1 — was the seed reset to D-18 default?
- `profile_history` accumulates rows across test files.

### Pitfall P-36-03: Mulberry32 seed-42 determinism across different target_days

**What goes wrong:** Phase 24 used `--seed 42` for `m009-21days`. Plan 36-01 will use `--seed 42` for `m010-30days` AND `m010-5days`. Operators might assume "same seed → same output" but the seed seeds `mulberry32(seed + d)` per-day (synthesize-delta.ts:526), so day index 0 in m009-21days IS the same as day 0 in m010-30days for the few-shot sample BUT the total number of synth days differs.

**Why it happens:** `synthDaysNeeded = max(0, opts.targetDays - uniqueOrganicDates.length)` produces different counts for target_days=21 vs 30 vs 5. Even with identical organic data and seed=42, the synth slice of m010-30days is NOT a superset of m009-21days's synth slice. They're independent runs that happen to share the first few day-seeds.

**How to avoid:** Document the per-fixture seed-day-index correspondence in the MANIFEST. Plan 36-01 Task 2's verification should NOT assume `m010-30days[0..12] == m009-21days[0..12]` for synth content — those are different runs with overlapping early-day seeds.

**Warning signs:** Operator regenerates m010-30days expecting m009 content to appear; doesn't.

### Pitfall P-36-04: HARN sanity gate keyword-grep false positives

**What goes wrong:** Per D-11, the dimension classifier is keyword grep against PROFILE_BIAS_KEYWORDS. But a single Pensieve entry could match multiple dimensions (e.g., "Considered moving to Georgia to optimize tax residency for my MAINGRET LLC" matches BOTH jurisdictional ('moving', 'tax', 'residency') AND capital ('MAINGRET LLC')). The HARN gate counts this entry against both dimensions, inflating per-dimension counts and potentially passing the ≥12 threshold falsely.

**Why it happens:** Bias keywords overlap intentionally (per D-05) because Greg's real entries do — a tax-decision entry is BOTH jurisdictional and capital. The keyword lists are NUDGES for Haiku, not strict per-dimension classifiers.

**How to avoid:** Two strategies — planner choice:

1. **Accept double-counting** (recommended for v1). Doc the HARN gate as "≥12 entries that PROBABLY reference each dimension"; treat it as a coverage signal, not a precision claim. Mirrors how Phase 24 sanity gates work.
2. **Mutual-exclusion classification.** Assign each entry to ONE dimension based on highest keyword density. More precise but adds complexity; deferred to v2.5.1.

**Recommended:** Strategy 1. Plan 36-01 Task 3 documents this in the test file header. The empirical risk is low — Haiku generated under bias is reasonably topical per day, and a 30-day fixture has enough entries that even with 30-50% double-counting, true per-dimension coverage exceeds 12.

**Warning signs:** HARN gate passes for all 4 dimensions; PTEST-02 still fails for one dimension because Sonnet's confidence stays at 0 due to thin per-dimension substrate.

### Pitfall P-36-05: PTEST-05 fixture-load race vs Sonnet population

**What goes wrong:** PTEST-05's `beforeAll` loads m010-30days via `loadPrimedFixture`, but the profile_* tables don't get touched (Pitfall P-36-02). So when `handleReflect` calls `getOperationalProfiles()`, the reader returns the Phase 33 SEED rows — which have confidence=0 for health/family (so they're skipped per Phase 35 D-09), and confidence ~0.2-0.3 for jurisdictional/capital. The injection happens, but with WEAK profile data, not the rich substrate the fixture provides.

**Why it happens:** The fixture only loads the SUBSTRATE (pensieve_entries, episodic_summaries, decisions). To get populated profile rows, the orchestrator (`updateAllOperationalProfiles`) must fire AFTER fixture load AND BEFORE the REFLECT calls.

**How to avoid:** Plan 36-02's `beforeAll` runs the orchestrator with a real (cached) Sonnet call:
```typescript
beforeAll(async () => {
  await loadPrimedFixture('m010-30days');
  // CRITICAL: populate profile rows from substrate BEFORE REFLECT runs
  await updateAllOperationalProfiles();
});
```

This adds 4 Sonnet calls to the cost (~$0.04 amortized over 3 iterations = $0.013/run additional). The calls hit real Sonnet on first run; on subsequent runs they're VCR-cached IF the orchestrator wraps Sonnet via `cachedMessagesParse`.

**ALTERNATIVE (no cost):** Plan 36-01 Task 6 commits a `profile_*-seed-populated.sql` snapshot that PTEST-05 applies in `beforeAll`. Cleaner — but requires Plan 36-01 to capture and stabilize the profile content. Tradeoff: any Sonnet behavior change invalidates the snapshot.

**Recommended:** Run-the-orchestrator pattern. Simpler; the cost is trivial. Plan 36-02 Task 2 commits the additional `beforeAll` step.

**Warning signs:** PTEST-05's first assertion passes (block is present) but the block contains only `current_country: "Russia"` + `fi_target_amount: "$1,500,000"` (seed values), not the fixture-derived facts. Operator misreads this as success when actually the fixture isn't being exercised.

### Pitfall P-36-06: HARN sanity test ordering vs fixture loading

**What goes wrong:** `primed-sanity-m010.test.ts` has TWO test groups (m010-30days and m010-5days) but only one DB. Whichever loads SECOND wipes the first's data. If the m010-30days HARN assertions run BEFORE the load completes (Vitest scheduling), they fail.

**Why it happens:** Vitest runs test files serially per `fileParallelism: false` (TESTING.md:18) but WITHIN a file, `describe` blocks share state. Each `loadPrimedFixture` call wipes ALL tables (load-primed.ts:222-241), so the second `describe`'s `beforeAll` wipes the first's data.

**How to avoid:** EITHER one file per fixture (`primed-sanity-m010-30days.test.ts` + `primed-sanity-m010-5days.test.ts`) OR a single file with sequential describe blocks each re-loading their fixture in their own beforeAll. The second pattern works because each describe.beforeAll runs before its block's tests.

**Recommended:** Single file `primed-sanity-m010.test.ts` with two sequential describe blocks, each with its own `beforeAll` loading its fixture. Mirrors the m009 single-file pattern with explicit per-block fixture loads.

**Warning signs:** Sanity test for m010-5days passes when run in isolation but fails (zero entries) when run after m010-30days.

## Code Examples

Verified patterns from existing in-codebase sources.

### Repeatable CLI flag parsing (Plan 36-01 Task 1)

```typescript
// Source: VERIFIED — extends scripts/synthesize-delta.ts:148-161
({ values: raw } = parseArgs({
  args: argv,
  options: {
    organic: { type: 'string' },
    'target-days': { type: 'string' },
    seed: { type: 'string' },
    milestone: { type: 'string' },
    'no-refresh': { type: 'boolean', default: false },
    'profile-bias': { type: 'string', multiple: true, default: [] as string[] },  // NEW
    help: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
}));

// Validate each bias value
const VALID_DIMS = ['jurisdictional', 'capital', 'health', 'family'] as const;
type Dimension = typeof VALID_DIMS[number];
const profileBias = (raw['profile-bias'] ?? []) as string[];
for (const b of profileBias) {
  if (!VALID_DIMS.includes(b as Dimension)) {
    throw new UsageError(`synthesize-delta: --profile-bias must be one of ${VALID_DIMS.join('|')}, got ${b}`);
  }
}
```

### Two-cycle integration test scaffold (Plan 36-01 PTEST-03)

```typescript
// Source: VERIFIED — copy/adapt from src/memory/profiles/__tests__/generators.two-cycle.test.ts:48-220
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

const { mockAnthropicParse, mockLoggerInfo } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

vi.mock('../../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../llm/client.js')>();
  return {
    ...orig,
    anthropic: { messages: { parse: mockAnthropicParse, create: vi.fn() } },
  };
});

vi.mock('../../../utils/logger.js', () => ({
  logger: { info: mockLoggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadPrimedFixture } from '../../../__tests__/fixtures/load-primed.js';
import { updateAllOperationalProfiles } from '../../profile-updater.js';
import { db } from '../../../db/connection.js';
import { profileJurisdictional, profileCapital, profileHealth, profileFamily, profileHistory } from '../../../db/schema.js';
import { eq } from 'drizzle-orm';
// ... primeAllDimensionsValid helper from generators.two-cycle.test.ts:187-205

describe('PTEST-02 + PTEST-03 — m010-30days integration (populated + two-cycle)', () => {
  beforeAll(async () => {
    await loadPrimedFixture('m010-30days');
  });

  beforeEach(async () => {
    // Re-seed profile_* tables to Phase 33 seed state — Pitfall P-36-02 fix
    await seedProfileRows();  // helper from src/__tests__/fixtures/seed-profile-rows.ts
    mockAnthropicParse.mockReset();
    primeAllDimensionsValid();
  });

  it('PTEST-02 populated case: all 4 profiles update, history=4', async () => {
    await updateAllOperationalProfiles();
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);
    // ... assertions per D-17
  });

  it('PTEST-03 two-cycle: identical substrate → no new calls', async () => {
    await updateAllOperationalProfiles();  // Cycle 1
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);
    await updateAllOperationalProfiles();  // Cycle 2 — identical substrate
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);  // STILL 4, not 8
    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(4);  // No new history row on skip path
  });
});
```

### Live anti-hallucination test (Plan 36-02 PTEST-05)

```typescript
// Source: VERIFIED — extends src/rituals/__tests__/live-weekly-review.test.ts:65-130
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { loadPrimedFixture } from '../../../__tests__/fixtures/load-primed.js';
import { updateAllOperationalProfiles } from '../../profile-updater.js';
import { handleReflect } from '../../../chris/modes/reflect.js';
import { anthropic } from '../../../llm/client.js';

const FORBIDDEN_FACTS = [
  // Jurisdictional negatives (planner refines after Plan 36-01 generates fixture)
  'moving to portugal', 'spain residency', 'russian passport', 'israeli citizenship',
  // Capital negatives
  '$5,000,000', '$10m target', 'early retirement',
  // Health negatives
  'diabetes', 'cancer', 'depression diagnosis', 'adhd medication',
  // Family negatives
  'you have children', 'you are divorced', 'you are engaged', 'you are married',
  // ≥12 total per D-29
] as const;

const TEST_CHAT_ID = BigInt(99936);  // allocate next in src/__tests__/fixtures/chat-ids.ts

describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)(
  'PTEST-05: Live anti-hallucination (3-of-3 against real Sonnet)',
  () => {
    let spy: ReturnType<typeof vi.spyOn>;

    beforeAll(async () => {
      await loadPrimedFixture('m010-30days');
      // Pitfall P-36-05: populate profile rows BEFORE REFLECT runs
      await updateAllOperationalProfiles();
      spy = vi.spyOn(anthropic.messages, 'create');
    });

    afterAll(() => {
      spy?.mockRestore();
    });

    it(
      'profile block present AND zero forbidden facts across 3-of-3 iterations',
      async () => {
        const failures: string[] = [];

        for (let i = 1; i <= 3; i++) {
          const callsBeforeIter = spy.mock.calls.length;
          const responseText = await handleReflect(
            TEST_CHAT_ID,
            "Help me think about my next quarter's priorities",
            "English",
            [],
          );

          // Assert 1: REFLECT system prompt contains profile block
          const callArgs = spy.mock.calls[spy.mock.calls.length - 1][0];
          const systemText = (callArgs.system as Array<{ text: string }>)[0]?.text ?? '';
          if (!systemText.includes('## Operational Profile (grounded context — not interpretation)')) {
            failures.push(`Iter ${i}: missing profile block header in system prompt`);
          }
          if (!/(Russia|Saint Petersburg|MAINGRET|1,500,000|French)/i.test(systemText)) {
            failures.push(`Iter ${i}: profile block has no fixture-derived facts`);
          }

          // Assert 2: response does NOT contain forbidden facts
          const respLower = responseText.toLowerCase();
          for (const forbidden of FORBIDDEN_FACTS) {
            if (respLower.includes(forbidden)) {
              failures.push(`Iter ${i}: response contains forbidden fact "${forbidden}"`);
            }
          }
        }

        expect(failures, 'Across 3-of-3 iterations').toEqual([]);
      },
      90_000,  // 90s — 3 Sonnet calls × ~25s each + buffer
    );
  },
);
```

### HARN sanity test for m010 (Plan 36-01)

```typescript
// Source: VERIFIED — mirrors src/__tests__/fixtures/primed-sanity.test.ts:92-149
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { pensieveEntries } from '../../db/schema.js';
import { loadPrimedFixture } from './load-primed.js';

// PROFILE_BIAS_KEYWORDS from D-05 — re-imported from synthesize-delta.ts OR duplicated here
const KEYWORDS_BY_DIM = {
  jurisdictional: ['country', 'residency', 'tax', 'legal entity', 'visa', 'passport', 'move', 'location'],
  capital: ['FI target', 'net worth', 'business income', 'savings', 'capital', 'money goal'],
  health: ['hypothesis', 'pending test', 'symptom', 'medication', 'doctor', 'lab result'],
  family: ['relationship', 'family criteria', 'partner', 'family planning', 'child'],
} as const;

const MIN_PER_DIM_30 = 12;
const MAX_PER_DIM_5 = 9;  // strict <10 per D-13

const F30 = 'm010-30days';
const F5 = 'm010-5days';
const F30_PRESENT = existsSync(`tests/fixtures/primed/${F30}/MANIFEST.json`);
const F5_PRESENT = existsSync(`tests/fixtures/primed/${F5}/MANIFEST.json`);

async function countByDim(content: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [dim, keywords] of Object.entries(KEYWORDS_BY_DIM)) {
    out[dim] = content.filter((c) =>
      keywords.some((k) => c.toLowerCase().includes(k.toLowerCase()))
    ).length;
  }
  return out;
}

(F30_PRESENT ? describe : describe.skip)(`primed-sanity-m010: ${F30}`, () => {
  beforeAll(async () => { await loadPrimedFixture(F30); });

  it(`has ≥${MIN_PER_DIM_30} keyword-classified entries per dimension`, async () => {
    const rows = await db.select({ content: pensieveEntries.content }).from(pensieveEntries);
    const counts = await countByDim(rows.map(r => r.content ?? ''));
    for (const dim of Object.keys(KEYWORDS_BY_DIM)) {
      expect(counts[dim], `${dim} per-dim count`).toBeGreaterThanOrEqual(MIN_PER_DIM_30);
    }
  });
});

(F5_PRESENT ? describe : describe.skip)(`primed-sanity-m010: ${F5}`, () => {
  beforeAll(async () => { await loadPrimedFixture(F5); });

  it(`has <10 keyword-classified entries per dimension (anti-inflation trip-wire)`, async () => {
    const rows = await db.select({ content: pensieveEntries.content }).from(pensieveEntries);
    const counts = await countByDim(rows.map(r => r.content ?? ''));
    for (const dim of Object.keys(KEYWORDS_BY_DIM)) {
      expect(counts[dim], `${dim} per-dim count`).toBeLessThanOrEqual(MAX_PER_DIM_5);
    }
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Synth pipeline matches organic topic distribution (M008/M009) | Optional per-day domain biasing via `--profile-bias` | Plan 36-01 (Phase 36) | M010-05 mitigation; first time the synth pipeline can be steered toward specific subject matter |
| Single primed fixture per milestone | Two primed fixtures per milestone (populated + sparse) | Plan 36-01 | Symmetric coverage of "what happens when threshold met" vs "what happens when threshold missed" |
| Mock-only unit tests for orchestrator (Phase 34) | Real-DB integration via loadPrimedFixture (Phase 36) | Plan 36-01 | Catches Drizzle JSONB serialization + write-before-upsert edge cases that mocks miss |
| Manual fixture-coverage measurement | HARN sanity gate per-dimension keyword grep | Plan 36-01 | Catches synth-pipeline regressions BEFORE integration tests run; gate runs in normal Docker suite |
| (None — first live anti-hallucination test for profiles) | Live 3-of-3 atomic against real Sonnet, dual-gated | Plan 36-02 | M010 milestone-close signal (D-35); cost-disciplined manual operator invocation |

**Deprecated/outdated:**
- None — Phase 36 is purely additive.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The unbiased synth pipeline produces <2 capital/health/family keyword matches per dimension in m009-21days | OQ-4 reconfirmation | Measured empirically via direct fixture content read — VERIFIED, not assumed |
| A2 | Haiku's compliance rate with soft keyword hints is ≥50% | OQ-4 reconfirmation | If hint compliance is <40%, target_days=30 fails the ≥12 threshold; mitigation is in OQ-4 section (3 tuning options) — **[ASSUMED]** |
| A3 | Sonnet 4.6 pricing remains $3/$15 per million tokens through Phase 36 execution | PTEST-05 cost refinement | Cost differs from $0.10-0.15/run estimate; immaterial if within ~2x — **[CITED: Anthropic pricing docs]** |
| A4 | `loadPrimedFixture` does NOT touch profile_* tables | Pitfall P-36-02 | If it does (Phase 33 added a profile-table cleanup hook somewhere), Pitfall P-36-02 disappears — VERIFIED by direct read of load-primed.ts |
| A5 | `vi.spyOn` preserves the original implementation when no `.mockImplementation()` is supplied | Pattern 4 | If spyOn replaces with a no-op by default, PTEST-05 breaks; well-established vitest behavior — **[CITED: vitest docs]** |
| A6 | CI does NOT accidentally set `RUN_LIVE_TESTS=1` | Pitfall section | If set, CI burns $0.20+/run on every CI run and may exceed Anthropic rate limits — **[ASSUMED — operator should verify CI env]** |
| A7 | Per-dimension keyword-grep accepts double-counting (an entry can match multiple dimensions) | Pitfall P-36-04 | Acceptance is fine for v1; if precision matters, Strategy 2 (mutual exclusion) needed — **[ASSUMED — recommend Strategy 1]** |
| A8 | The Phase 33 seed-row content is the canonical source of truth for FORBIDDEN_FACTS construction | FORBIDDEN_FACTS section | If seed rows change between Phase 33 and Phase 36 execution, the forbidden list is brittle — VERIFIED current seed content at migration 0012:132-204 |
| A9 | `tests/fixtures/primed/` is gitignored | Pitfall P-36-01 | VERIFIED via direct gitignore read |
| A10 | The 2.6MB m009-21days fixture size is representative of m010-30days size | VCR cost section | Different organic snapshot + different bias produces different size; ~3-5MB plausible — **[ASSUMED — minor, no decision hinges on it]** |
| A11 | `cachedMessagesParse` is wired into `synthesize-delta.ts` (not raw `anthropic.messages.parse`) | VCR cost section | VERIFIED at synthesize-delta.ts:542-544 |

**Three claims tagged `[ASSUMED]` requiring user confirmation:** A2 (Haiku compliance rate — empirically verified at Plan 36-01 Task 2), A6 (CI env var hygiene — operator check), A7 (keyword-grep precision — v1 acceptable). The other claims are either VERIFIED via tool/file read or CITED from authoritative sources.

## Open Questions

1. **OQ-36-01: How does PTEST-05 populate profile rows from substrate?**
   - What we know: Fixture load (`loadPrimedFixture`) seeds substrate but not profile rows. Profile rows start at Phase 33 seed values (jurisdictional confidence=0.3, capital=0.2, health=0, family=0).
   - What's unclear: Whether PTEST-05 should (a) run the real orchestrator in `beforeAll` (live Sonnet, ~$0.04 amortized) or (b) commit a pre-populated profile-state snapshot.
   - **Recommendation:** Option (a) — run orchestrator. Simpler, no fixture churn, costs ~$0.04 (negligible). Documented in Pitfall P-36-05.

2. **OQ-36-02: Should Plan 36-01 amend `.gitignore` to commit fixtures?**
   - What we know: CONTEXT.md test_strategy asserts committed; `.gitignore` excludes the dir.
   - **Recommendation:** Do NOT amend (Option A in P-36-01). Mirror primed-sanity.test.ts's skip-when-absent pattern. Operators regenerate via documented command. Avoids ~5-8MB of binary churn per Phase 36 + later phases.

3. **OQ-36-03: Test ordering of PTEST-02 + PTEST-03 within the shared file**
   - What we know: D-18 locks them in the same file. PTEST-03's three-cycle structure already covers PTEST-02 (Cycle 1 == PTEST-02's assertion shape).
   - **Recommendation:** Merge PTEST-02 + PTEST-03 into a single `it()` block as the three-cycle test, with explicit comments marking which assertions belong to PTEST-02 vs PTEST-03 traceability. Mirrors Phase 34's two-cycle test which is a single `it()`.

4. **OQ-36-04: Should profile-row reset be a shared helper or per-test boilerplate?**
   - What we know: Pitfall P-36-02 requires re-seeding profile rows in `beforeEach`. Phase 34's existing tests use ad-hoc cleanup.
   - **Recommendation:** Create `src/__tests__/fixtures/seed-profile-rows.ts` exporting `seedProfileRows(): Promise<void>` that idempotently re-INSERTs the migration-0012 seed rows. Plan 36-01 Task 3 ships this helper.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | All PTEST-01..04 tests + sanity gate | ✓ | Per project standard (TESTING.md:55-59) | None — repo standard |
| Node 18+ | All tests | ✓ | (project standard) | None |
| Anthropic API key (real, paid) | PTEST-05 dual-gate AND first regen of m010 fixtures | ✗ (sandbox default) | — | PTEST-05 skips when `ANTHROPIC_API_KEY` absent; fixture regen warned via existing pattern |
| Live Anthropic Sonnet 4.6 + Haiku 4.5 endpoints | PTEST-05 (Sonnet) + fixture regen (Haiku) | ✓ when key present | (configurable via env) | None |
| `tests/fixtures/prod-snapshot/LATEST` (organic baseline) | Plan 36-01 first regen | ✓ if `scripts/fetch-prod-data.ts` has been run | — | Operator runs `npx tsx scripts/regenerate-primed.ts --milestone m010 --force` (composer auto-fetches) |
| SSH access to prod (192.168.1.50) | Initial fetch-prod-data run if LATEST is stale | ✓ per MEMORY.md `feedback_live_server_access` | — | Manual prod-data dump |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**
- ANTHROPIC_API_KEY for CI: PTEST-05 dual-gate skips. Fixture regen for m010-30days requires a one-time real-API run by an operator with the key.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x [VERIFIED: TESTING.md:7] |
| Config file | `vitest.config.ts` at repo root (`root: 'src'`, `fileParallelism: false`, `globals: false`) [VERIFIED: TESTING.md:9-20] |
| Quick run command | `npx vitest run <test-file>` (unit-only, no Docker) — **NOT canonical** per MEMORY.md `feedback_always_run_docker_tests` |
| Canonical run command | `bash scripts/test.sh <test-file>` (full Docker Postgres) — required for ALL PTEST-* tests |
| Full suite command | `bash scripts/test.sh` (no args; runs everything) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PTEST-01 | `--profile-bias` flag accepted as repeatable; PROFILE_BIAS_KEYWORDS appended to Haiku prompt for biased days; cache hash differs vs unbiased; m010-30days fixture generated with ≥12/dim | unit + fixture-gen | `bash scripts/test.sh src/__tests__/fixtures/primed-sanity-m010.test.ts` + manual `npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 --profile-bias ... --force --seed 42` | ❌ Wave 0: extend `scripts/__tests__/synthesize-delta.test.ts` (or sibling) AND create `src/__tests__/fixtures/primed-sanity-m010.test.ts` |
| PTEST-02 | Load m010-30days; orchestrator runs; all 4 profiles populate confidence>0; last_updated advances; substrate_hash non-null; profile_history has 4 new rows | integration (mocked Anthropic, real Docker Postgres) | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m010-30days.test.ts` | ❌ Wave 0: create new file |
| PTEST-03 | Two-cycle idempotency: Cycle 1 → 4 calls; Cycle 2 identical → STILL 4 calls; Cycle 3 mutated dim → 5 cumulative calls; prev-state injection verified | integration (mocked Anthropic, real Docker Postgres) | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m010-30days.test.ts` (same file as PTEST-02) | ❌ Wave 0: same file as PTEST-02 |
| PTEST-04 | Sparse fixture m010-5days → all 4 generators log `'chris.profile.threshold.below_minimum'`; 4× `profile_below_threshold` outcomes; zero Sonnet calls | integration (mocked Anthropic, real Docker Postgres) | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m010-5days.test.ts` | ❌ Wave 0: create new file |
| PTEST-05 | Live 3-of-3 atomic anti-hallucination; REFLECT system prompt contains profile block; response contains no FORBIDDEN_FACTS keyword; dual-gated | live (real Sonnet 4.6, real Docker Postgres) | `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... bash scripts/test.sh src/memory/profiles/__tests__/live-anti-hallucination.test.ts` | ❌ Wave 0: create new file |

### Sampling Rate

- **Per task commit:** Run only the in-scope test file via `bash scripts/test.sh src/memory/profiles/__tests__/<test-file>` — fast (~30s per single test file with Docker spin-up).
- **Per wave merge:** Run full profile-test suite: `bash scripts/test.sh src/memory/profiles/__tests__/ src/__tests__/fixtures/primed-sanity-m010.test.ts`.
- **Phase gate:** Full suite green before `/gsd-verify-work`. Note: PTEST-05 dual-gate means full suite passes WITHOUT exercising PTEST-05 unless `RUN_LIVE_TESTS=1` is set. Operator MUST manually run PTEST-05 with key as the final M010 milestone gate (D-35).

### Wave 0 Gaps

- [ ] `src/__tests__/fixtures/primed-sanity-m010.test.ts` — HARN gate per-dimension (≥12 for m010-30days; <10 for m010-5days)
- [ ] `src/memory/profiles/__tests__/integration-m010-30days.test.ts` — covers PTEST-02 + PTEST-03 (three-cycle structure)
- [ ] `src/memory/profiles/__tests__/integration-m010-5days.test.ts` — covers PTEST-04
- [ ] `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` — covers PTEST-05
- [ ] `src/__tests__/fixtures/seed-profile-rows.ts` — shared helper to re-seed profile_* tables to migration-0012 seed state (Pitfall P-36-02 fix)
- [ ] `scripts/__tests__/synthesize-delta-profile-bias.test.ts` — unit tests for `--profile-bias` flag + PROFILE_BIAS_ROTATION (PTEST-01 sub-spec)
- [ ] `src/__tests__/fixtures/chat-ids.ts` — allocate `CHAT_ID_LIVE_ANTI_HALLUCINATION = BigInt(99936)` (next available per TESTING.md:105 convention)

Framework install: not needed (Vitest already in package.json).

## Project Constraints (from CLAUDE.md and project conventions)

**No `./CLAUDE.md` at repo root.** Project-level constraints come from:

- **`.planning/PROJECT.md` Key Decisions:**
  - **D004 (append-only Pensieve):** Tests must not mutate or delete Pensieve rows in a way that breaks the append-only invariant — N/A for Phase 36 (TRUNCATE in beforeEach is fine; not a deletion).
  - **D005 (never-throw):** PTEST tests should not exercise paths where a thrown error escapes the public API. Phase 33 reader's never-throw is already verified by Phase 33 tests; Phase 36 doesn't re-test this.
  - **D008 (first-person Chris):** PTEST-05's response assertions could augment FORBIDDEN_FACTS with third-person markers ("Greg's profile", "His current_country") IF the planner judges this a useful regression class. Out of scope for v1 per D-29 locked list. Plan 36-02 may add this if budget permits.
  - **D041 (primed-fixture pipeline supersedes calendar wait):** Phase 36 is the proof point — m010-30days + m010-5days operationalize this. No calendar-wait gating allowed.

- **`.planning/codebase/CONVENTIONS.md`:** No new violations introduced. All tests are co-located in `__tests__/` subdirectories per the standard layout (TESTING.md:96-103).

- **`.planning/codebase/TESTING.md`:**
  - **`vi.useFakeTimers` is FORBIDDEN** (TESTING.md:178). Use `vi.setSystemTime` only (Phase 34's two-cycle test uses explicit `now` param instead — even safer).
  - **`bash scripts/test.sh` is canonical** (TESTING.md:31-38) — never bypass to direct `npx vitest run` for Docker-DB tests.
  - **3-of-3 atomic pattern with internal loop** (TESTING.md:215-219) — PTEST-05 must follow this exactly. NOT three separate `it()` blocks.
  - **Inline-snapshot reviewer discipline** (TESTING.md:348-358) — only relevant if PTEST-05 ever switches to snapshot assertions (it doesn't in v1).

- **MEMORY.md:**
  - **`feedback_always_run_docker_tests`:** All Phase 36 tests use `bash scripts/test.sh`, not direct vitest. Confirmed in test command structure above.
  - **`feedback_live_server_access`:** Prod SSH (192.168.1.50) is available for initial `fetch-prod-data.ts` step in Plan 36-01 Task 2.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 36 is test-only; no auth surfaces touched |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | partial | `--profile-bias <dim>` value MUST be validated against the locked Dimension enum (jurisdictional/capital/health/family). Other values throw `UsageError`. Mitigation: explicit `VALID_DIMS.includes(b)` check at parse time. |
| V6 Cryptography | no | VCR cache uses SHA-256 (already shipped Phase 24); no new crypto |

### Known Threat Patterns for Phase 36 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Operator runs PTEST-05 with `RUN_LIVE_TESTS=1` accidentally on every CI build → unbudgeted Anthropic spend | DoS (cost-DoS) | Dual-gate `describe.skipIf(!RUN_LIVE_TESTS || !ANTHROPIC_API_KEY)` — CI never sets RUN_LIVE_TESTS; operator must explicitly opt in. Cost callout in test-file header. Pre-flight checklist in Plan 36-02 README. |
| Forbidden-fact keyword list contains a fact that IS in the fixture → false-positive failure on a legitimate Sonnet response | Repudiation (false alarm undermines test trust) | Pitfall P-36-04's keyword-grep awareness; D-29 explicitly tells planner to refine after Plan 36-01 generates the fixture. List must NOT contain "Russia", "MAINGRET", "$1,500,000", "Batumi", "French". |
| Fixture regen pulls fresh prod data and accidentally commits PII to git | Information Disclosure | `tests/fixtures/prod-snapshot/` is gitignored (line 23). Fixture content under `tests/fixtures/primed/` is also gitignored (line 24). Pitfall P-36-01 confirms — recommend NOT amending gitignore (Option A). |
| Live Sonnet response in PTEST-05 contains real PII that gets logged or stored | Information Disclosure | PTEST-05 only stores response text in test-local variables, never persisted. No logging of Sonnet response content (only call counts + iteration index). |
| `--profile-bias` flag with malicious value injects into VCR cache key, polluting other tests' cache | Tampering | Mitigated by `VALID_DIMS` enum validation at parse time; non-enum values throw `UsageError`. Even if a value slipped through, the cache key is hashed — no path-traversal risk. |

## Sources

### Primary (HIGH confidence)

- **In-codebase reads (VERIFIED via Read tool):**
  - `.planning/phases/36-tests/36-CONTEXT.md` (all 35 decisions, test_strategy, plan_hints)
  - `.planning/REQUIREMENTS.md` (PTEST-01..05 contract at lines 35-41; traceability at 98-102)
  - `.planning/codebase/TESTING.md` (canonical patterns for live tests, dual-gate, fixtures)
  - `.planning/research/PITFALLS.md` (M010-05 lines 105-110, M010-10 lines 303-333, Looks-Done-But-Isn't 419-433)
  - `.planning/research/SUMMARY.md` (Phase 36 section lines 191-210; OQ-4 line 209)
  - `scripts/synthesize-delta.ts` (full 670-line file; injection point at lines 264-276; constants at 72-80)
  - `scripts/regenerate-primed.ts` (full 275-line file; pass-through pattern at lines 229-244)
  - `src/__tests__/fixtures/primed-sanity.test.ts` (HARN scaffold for m009-21days)
  - `src/__tests__/fixtures/load-primed.ts` (full loader; confirms profile_* tables NOT touched)
  - `src/__tests__/fixtures/vcr.ts` (cache hash mechanism at line 92; ORIGINAL_PARSE snapshot at 46-47)
  - `src/memory/profiles/__tests__/generators.two-cycle.test.ts` (verbatim two-cycle scaffold for PTEST-03)
  - `src/memory/profiles/__tests__/generators.sparse.test.ts` (verbatim sparse scaffold pattern for PTEST-04)
  - `src/memory/profiles/shared.ts` (`runProfileGenerator` orchestrator body; substrate_hash logic)
  - `src/rituals/__tests__/live-weekly-review.test.ts` (M009 TEST-31 — verbatim live-test scaffold for PTEST-05)
  - `src/episodic/__tests__/live-anti-flattery.test.ts` (M008 TEST-22 — alternate live-test reference)
  - `src/db/migrations/0012_operational_profiles.sql` (seed-row content for FORBIDDEN_FACTS construction)
  - `src/chris/modes/reflect.ts` (REFLECT handler — confirms call order getOperationalProfiles → formatProfilesForPrompt → buildSystemPrompt)
  - `src/memory/profiles.ts` (PROFILE_INJECTION_MAP at line 70; formatProfilesForPrompt at line 226)
  - `src/config.ts` (Sonnet 4.6 model id `claude-sonnet-4-6`; Haiku 4.5 model id)
  - `.gitignore` (CRITICAL — lines 23-25 gitignore fixtures + VCR; contradicts CONTEXT.md test_strategy)
  - `.planning/phases/35-surfaces/35-02-SUMMARY.md` (PROFILE_INJECTION_MAP shipped + verbatim D-13 header in formatProfilesForPrompt)
  - Empirical fixture analysis: counted per-dimension keyword matches in `tests/fixtures/primed/m009-21days/pensieve_entries.jsonl` (199 entries; baseline for OQ-4 reconfirmation)

### Secondary (MEDIUM confidence)

- [Anthropic API pricing — Claude Sonnet 4.6 — Anthropic platform docs](https://platform.claude.com/docs/en/about-claude/pricing) — $3 input / $15 output per million tokens
- [Anthropic Claude API Pricing 2026 breakdown — CloudZero](https://www.cloudzero.com/blog/claude-api-pricing/) — cross-confirms Sonnet 4.6 pricing

### Tertiary (LOW confidence — referenced for vitest spy-with-passthrough idiom)

- [Vitest vi.spyOn API docs](https://vitest.dev/api/vi.html#vi-spyon) — standard vitest behavior: spyOn preserves original implementation when no `.mockImplementation()` is supplied; flagged LOW because docs are checked from training knowledge and not verified in this session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all scaffolds verified by direct file read
- Architecture: HIGH — extension points and patterns confirmed via direct read of synthesize-delta.ts, vcr.ts, load-primed.ts, generators.two-cycle.test.ts, live-weekly-review.test.ts
- Pitfalls: HIGH — P-36-01 (gitignore contradiction) and P-36-02 (loadPrimedFixture doesn't touch profile tables) are both VERIFIED by direct file read; P-36-04 and P-36-05 are reasoned-through risks
- OQ-4 math: MEDIUM-HIGH for the analysis, MEDIUM for Haiku-compliance assumption A2
- FORBIDDEN_FACTS construction: HIGH for fixture-contradicting candidates from seed rows; planner refines after Plan 36-01 generates the fixture
- PTEST-05 cost: HIGH per Anthropic pricing; refined estimate $0.10-0.15/run (under CONTEXT.md's $0.20)

**Research date:** 2026-05-13
**Valid until:** 2026-06-12 (30 days for stable Phase-36 scope; valid only while Phase 34/35 substrate is unchanged)

---

*Phase: 36-tests*
*Research completed: 2026-05-13*
*Confidence: HIGH*
