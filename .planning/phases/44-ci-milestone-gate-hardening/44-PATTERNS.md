# Phase 44: CI Milestone-Gate Hardening — PATTERNS.md

**Generated:** 2026-05-14
**Phase:** 44-ci-milestone-gate-hardening
**Upstream:** 44-CONTEXT.md (5 locked decisions D-01..D-07; pure test-harness mechanism work)

This phase is purely test-harness mechanism work — no production code is touched, no new file roles are introduced. PATTERNS.md therefore catalogues the existing test-file shape that the inline env-gated check **replaces** (silent skip → loud-on-CI), plus the canonical `RUN_LIVE_TESTS` env-gate the new `REQUIRE_FIXTURES` gate **mirrors**, plus the documentation insertion point in `scripts/test.sh`.

---

## Files in Scope (10 test files + 1 shell script + 1 doc)

All test files share one of two shape families. The shell script gets a comment block only.

### Family A — Single-fixture silent-skip (7 files)

Each file has exactly one `FIXTURE_PATH` / `FIXTURE_PRESENT` / `skipIfAbsent` triple plus an `if (!FIXTURE_PRESENT) { console.log(SKIP hint) }` block. The hardening injects ONE additional gate-test `describe(...)` block per fixture, gated on `REQUIRE_FIXTURES=1 && !FIXTURE_PRESENT`.

| # | File | Fixture name | Current skip pattern lines | Regen-hint console.log lines |
|---|------|---|---|---|
| 1 | `src/__tests__/fixtures/primed-sanity.test.ts` | `m009-21days` | 82 (`skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip`) | 84-90 |
| 2 | `src/rituals/__tests__/synthetic-fixture.test.ts` | `m009-21days` | 164 | 165-171 |
| 3 | `src/memory/profiles/__tests__/integration-m010-30days.test.ts` | `m010-30days` | 137 | 127-135 |
| 4 | `src/memory/profiles/__tests__/integration-m010-5days.test.ts` | `m010-5days` | 120 | 107-119 |
| 5 | `src/memory/profiles/__tests__/integration-m011-30days.test.ts` | `m011-30days` | 225 | 216-223 |
| 6 | `src/memory/profiles/__tests__/integration-m011-1000words.test.ts` | `m011-1000words` (Phase 45 FIX-02 dependency) | 136 | 127-134 |

### Family B — Dual-fixture silent-skip (2 files, 4 fixtures)

Both files declare TWO fixture constants and TWO `skipIfXAbsent` constants. Each gets ITS OWN gate-test block.

| # | File | Fixture A | Fixture B |
|---|------|---|---|
| 7 | `src/__tests__/fixtures/primed-sanity-m010.test.ts` | `M30_NAME = 'm010-30days'` (lines 154-171) | `M5_NAME = 'm010-5days'` (lines 208-239) |
| 8 | `src/__tests__/fixtures/primed-sanity-m011.test.ts` | `M30_NAME = 'm011-30days'` (lines 117-132) | `M1K_NAME = 'm011-1000words'` (lines 164-179) |

### Family C — Three-way `describe.skipIf` live tests (2 files)

Both files combine `FIXTURE_PRESENT` with `RUN_LIVE_TESTS=1 + ANTHROPIC_API_KEY` (cost-budgeted live LLM gates). Per **D-07**, the three-way `describe.skipIf(...)` is **NOT touched**. The gate-test is added with predicate `REQUIRE_FIXTURES=1 && !FIXTURE_PRESENT` — independent of `RUN_LIVE_TESTS` — so CI (which sets `REQUIRE_FIXTURES=1` but NOT `RUN_LIVE_TESTS=1`) still fails loud without making a $0.10-0.30 Anthropic call.

| # | File | `describe.skipIf(...)` line | `FIXTURE_PATH` line |
|---|------|---|---|
| 9 | `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` | 136 | 75 |
| 10 | `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` | 120 | 49 |

> **D-07 sub-constraint:** `live-psych-anti-hallucination.test.ts` has a defense-in-depth `beforeAll` early-return at line 129 (Pitfall 6, belt-and-suspenders against vitest major-version drift). **Do NOT replicate this pattern in the new gate-test.** WR-07 from Phase 40 REVIEW.md noted it as no-op insurance; the gate-test stands alone — it's just one `it(...)` that throws synchronously, no DB / no LLM calls.

---

## Canonical Patterns to Mirror

### P1 — Inline env-gated check (target shape, NEW)

The 4-line shape from CONTEXT.md D-01 is the **single canonical excerpt** that all 10 files inject. Per-file customization is the FIXTURE_PATH string and the regen command. Per **Claude's Discretion** in CONTEXT.md, regen-command strings are **hardcoded per file**, NOT centralized into a `MANIFEST_REGEN_HINTS.ts` lookup (defer until drift emerges across the 8 hint strings).

```ts
// Inject AFTER the existing `if (!FIXTURE_PRESENT) { console.log(SKIP hint) }`
// block and BEFORE the existing `const skipIfAbsent = ... : describe.skip;` line.
// (For Family B files: inject TWICE, once per fixture, scoped to the relevant
//  FIXTURE_PRESENT constant — see file-by-file task list below.)
if (!FIXTURE_PRESENT && process.env.REQUIRE_FIXTURES === '1') {
  // CI hard-fail: emit ONE explicit failing test so CI reports 1 failure
  // (not silent skip). Operators see the fixture path + regen command.
  describe('[CI-GATE] fixture present', () => {
    it(`${FIXTURE_PATH} must exist when REQUIRE_FIXTURES=1`, () => {
      throw new Error(
        `Milestone-gate fixture missing: ${FIXTURE_PATH}. ` +
        `Regenerate via: <per-file regen command from existing console.log hint>`,
      );
    });
  });
}
```

**Why inline, not a helper:** CONTEXT.md D-01 — 10 files share the same 4-line shape; a `describe.requireFixtures(...)` wrapper would need vitest-plugin or import indirection for marginal benefit, and the inline form already matches the codebase idiom.

### P2 — Canonical env-gate naming (existing analog)

The `RUN_LIVE_TESTS=1` env-gate at `src/memory/profiles/__tests__/live-anti-hallucination.test.ts:136` and `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts:120` is the canonical pattern this phase mirrors:

```ts
// Existing canonical analog (D-02 mirrors this):
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY || !FIXTURE_PRESENT)(...)
```

- **Same shape:** `process.env.<UPPER_SNAKE>=== '1'`
- **Same polarity:** opt-in (default disabled = default skip)
- **Same naming:** `<VERB>_<NOUN>` ("run live tests" / "require fixtures")
- **Inverse meaning:** `RUN_LIVE_TESTS=1` = enable live cost; `REQUIRE_FIXTURES=1` = enable hard-fail-on-absent

### P3 — Existing skip-with-hint console.log block (kept verbatim)

Per CONTEXT.md `## Specific Ideas` bullet 3: "console.log SKIP hint stays — operators running locally without the env var continue to see the regen hint they're used to." The 10 existing `if (!FIXTURE_PRESENT) { console.log(...) }` blocks are **preserved verbatim**, including their `eslint-disable-next-line no-console` directives. Only the silence-in-CI behavior changes.

### P4 — `scripts/test.sh` header-comment style (existing analog)

The shell script `scripts/test.sh` uses block comments above each smoke-gate section in the style:

```bash
# Phase 25 (M009 v2.4) — post-migration substrate smoke gate.
# Per HARD CO-LOCATION CONSTRAINT #7 + Pitfall 28: ...
```

The new `REQUIRE_FIXTURES` documentation comment block (D-05) mirrors this style — block comment above the existing migration-application section near line 53 (`echo "📦 Running migrations..."`). The comment is **documentation only** — it does NOT add a new `exit 1` gate at the shell level (the gate is at the vitest level, keeping the contract test-runner-native per CONTEXT.md `## Existing Code Insights` line 140).

### P5 — Decision-index cross-link (existing analog)

`.planning/REQUIREMENTS.md` is the single source of truth for the v2.6.1 requirement set. The `### CI — Test gate hardening (T3, …)` section (lines 32-36) already names the three requirements. Per D-05 bullet 2: **add a single cross-link line** under the CI section pointing at Phase 44 for "where the mechanism is documented." No new `TESTING.md` is created — `scripts/test.sh` header comment is the operator-visible documentation surface.

---

## File-By-File Task Targeting

For each of the 10 test files, the planner can derive the exact injection point from this table:

| # | File | Family | Inject AFTER (existing line ~) | Inject BEFORE (existing line ~) | Regen hint source (verbatim copy from console.log) |
|---|------|---|---|---|---|
| 1 | `src/__tests__/fixtures/primed-sanity.test.ts` | A | line 90 (end of console.log) | line 82 (`const skipIfAbsent`) | lines 86-89 |
| 2 | `src/rituals/__tests__/synthetic-fixture.test.ts` | A | line 171 (end of console.log) | line 164 (`const skipIfAbsent`) | lines 167-170 |
| 3 | `src/memory/profiles/__tests__/integration-m010-30days.test.ts` | A | line 135 (end of console.log) | line 137 (`const skipIfAbsent`) | lines 128-134 |
| 4 | `src/memory/profiles/__tests__/integration-m010-5days.test.ts` | A | line 119 (end of console.log) | line 120 (`const skipIfAbsent`) | lines 109-118 |
| 5 | `src/memory/profiles/__tests__/integration-m011-30days.test.ts` | A | line 223 (end of console.log) | line 225 (`const skipIfAbsent`) | lines 217-222 |
| 6 | `src/memory/profiles/__tests__/integration-m011-1000words.test.ts` | A | line 134 (end of console.log) | line 136 (`const skipIfAbsent`) | lines 128-133 |
| 7a | `src/__tests__/fixtures/primed-sanity-m010.test.ts` (M30) | B | line 169 (end of M30 console.log) | line 171 (`const skipIfM30Absent`) | lines 163-168 |
| 7b | `src/__tests__/fixtures/primed-sanity-m010.test.ts` (M5) | B | line 237 (end of M5 console.log) | line 239 (`const skipIfM5Absent`) | lines 230-236 |
| 8a | `src/__tests__/fixtures/primed-sanity-m011.test.ts` (M30) | B | line 130 (end of M30 console.log) | line 132 (`const skipIfM30Absent`) | lines 124-129 |
| 8b | `src/__tests__/fixtures/primed-sanity-m011.test.ts` (M1K) | B | line 177 (end of M1K console.log) | line 179 (`const skipIfM1KAbsent`) | lines 171-176 |
| 9 | `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` | C | line 86 (end of console.log) | line 136 (`describe.skipIf(...)`) | lines 80-85 |
| 10 | `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` | C | line 60 (end of console.log) | line 120 (`describe.skipIf(...)`) | lines 53-59 |

> Line numbers are reference anchors from current `HEAD` at `commit 72300b4` (2026-05-14). Executor MUST re-read the file before editing — the orchestrator does NOT pin lines. The injection rule is: AFTER the relevant `console.log` block closes, BEFORE the relevant `skipIfAbsent`/`describe.skipIf` line. The injected gate-test references the SAME `FIXTURE_PRESENT` / `FIXTURE_PATH` (or `M30_PRESENT` / `M30_PATH`, etc.) constants that already exist — NO new constants are introduced.

---

## Documentation Targets

### scripts/test.sh — header comment block

Insertion point: between the migration journal check (line ~50) and the migration application echo (line ~53). The comment block (per D-05 bullet 1) MUST document:

- **Env var name:** `REQUIRE_FIXTURES=1`
- **CI semantics:** CI runners set it; local dev does not (default = continue to skip with hint)
- **Affected test files:** the 10 files listed above (or a path glob covering `src/{__tests__/fixtures,rituals/__tests__,memory/profiles/__tests__}/*.test.ts` with milestone-gate scope)
- **Regen command pattern:** `npx tsx scripts/regenerate-primed.ts --milestone <name> --target-days <N>` (with the per-fixture variants the individual test files print on local SKIP)
- **Why not shell-level exit-1:** the gate is vitest-native, single-failure-per-fixture, so CI sees clear test names rather than a shell error

### .planning/REQUIREMENTS.md — cross-link line

Under the existing `### CI — Test gate hardening (T3, 3 BLOCKERs from Phases 30/36/40)` section header (line 32), add a single line BEFORE the bullet list (or below it as a footnote):

```
> **Mechanism:** `REQUIRE_FIXTURES=1` env-gated hard-fail per inline check pattern — see `.planning/phases/44-ci-milestone-gate-hardening/` for design and `scripts/test.sh` header comment for operator UX.
```

No new top-level `TESTING.md` is created (CONTEXT.md D-05 explicit decision — out of scope; project doesn't currently have one).

---

## Anti-Patterns (DO NOT introduce)

Per CONTEXT.md `<deferred>` block + D-01/D-07:

1. **DO NOT** create a `describe.requireFixtures(...)` helper or `tests/helpers/require-fixtures.ts`. Inline form only. (D-01)
2. **DO NOT** centralize the regen-command strings into `tests/fixtures/MANIFEST_REGEN_HINTS.ts`. Hardcode per file. (CONTEXT.md Discretion bullet 2)
3. **DO NOT** add a `beforeAll` early-return defense-in-depth to the new gate-test (the gate-test is one synchronous `throw new Error(...)` — no DB, no LLM, no async). The `live-psych-anti-hallucination.test.ts` `beforeAll` early-return at line 129 is Pitfall-6 insurance for the OUTER `describe.skipIf` block, NOT a pattern to copy. (D-07)
4. **DO NOT** make `scripts/test.sh` set `REQUIRE_FIXTURES=1` itself. The contract is opt-in by the CI runner; the shell script stays neutral. (CONTEXT.md Discretion bullet 4)
5. **DO NOT** convert existing `describe.skip` into `describe.fail` or "fail every test in the suite when missing." A single explicit gate-test is the failure surface. (D-03)
6. **DO NOT** remove or alter the existing `console.log SKIP hint` blocks or the `eslint-disable-next-line no-console` directives — local-dev UX is preserved verbatim. (CONTEXT.md `<specifics>` bullet 3)
7. **DO NOT** touch the three-way `describe.skipIf(...)` predicate in the two live-* files. The new gate-test fires independently from the live-cost gate. (D-07)
8. **DO NOT** add a new shell-level `exit 1` gate in `scripts/test.sh`. Documentation comment only. (CONTEXT.md `## Existing Code Insights` line 140)

---

## Phase 45 Dependency Recap

Per CONTEXT.md D-04: Phase 44 PLAN.md may be drafted in parallel with Phase 45, but Phase 44 **execution** (the code changes) does NOT start until Phase 45 FIX-02 (`synthesize-delta.ts:937` output-dir path fix) is shipped. Otherwise the M011 `m011-1000words` integration test would assert a manifest at `tests/fixtures/primed/m011-1000words/MANIFEST.json` while the operator regen command continues to land it at `tests/fixtures/primed/m011-1000words-5days/MANIFEST.json` → CI red on the first run after the regen contract changes. The PLAN.md MUST surface this dependency in its prerequisites block.

The other 9 files are not affected by Phase 45 — they can be hardened against any pre-Phase-45 fixture state, including absent fixtures. Phase 45 FIX-06 (M010 fixture refresh) is **not** a prerequisite — CI hardening only needs the path-to-look-at to be correct.

---

*Generated as PATTERNS.md substitute by orchestrator (Task tool unavailable in this sandbox; pattern analysis performed inline against PHASE 44 CONTEXT.md decisions D-01..D-07 and direct codebase Reads).*
