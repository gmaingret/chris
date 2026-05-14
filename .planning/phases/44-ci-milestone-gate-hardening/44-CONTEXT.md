# Phase 44: CI Milestone-Gate Hardening - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning (gated on Phase 45 FIX-02 landing first)
**Mode:** `--auto` (all gray areas auto-resolved with recommended defaults)

<domain>
## Phase Boundary

Replace the silent-skip pattern (`existsSync(MANIFEST) ? describe : describe.skip` + `console.log SKIP …`) across the M009 / M010 / M011 milestone-gate test files with an environment-gated hard-fail. When `REQUIRE_FIXTURES=1` is set (the CI invocation contract) and a fixture manifest is absent, the affected test suite MUST fail loud with a single explicit failed assertion, not silently skip. Local developers who run `bash scripts/test.sh` without that env var keep the existing skip-with-regen-hint UX.

This phase is pure test-harness mechanism work. No production code is touched. No new fixtures are produced (Phase 45 SCHEMA-02 + FIX-06 owns the m010 fixture refresh; Phase 45 FIX-02 owns the `synthesize-delta.ts:937` path-bug fix that this phase depends on).

</domain>

<decisions>
## Implementation Decisions

### Mechanism — Per-file env-gated check (NOT a shared helper)

- **D-01:** Per-file env-gated check inside each affected test file. Inline pattern, not a new helper. Rationale: 8 affected files share the same 4-line shape; a `describe.requireFixtures(...)` wrapper would need its own infrastructure (vitest-plugin or import indirection) for marginal benefit, and the inline form is already what's in the codebase — this phase replaces what's there, not introduces a new abstraction. The shape:

  ```ts
  const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);
  const REQUIRE_FIXTURES = process.env.REQUIRE_FIXTURES === '1';

  if (!FIXTURE_PRESENT && REQUIRE_FIXTURES) {
    // Hard-fail: emit a single failing test so CI reports 1 failure, not skip.
    describe('[CI-GATE] fixture present', () => {
      it(`${FIXTURE_PATH} must exist when REQUIRE_FIXTURES=1`, () => {
        throw new Error(
          `Milestone-gate fixture missing: ${FIXTURE_PATH}. ` +
          `Regenerate via: npx tsx scripts/regenerate-primed.ts --milestone <name> --target-days <N>`,
        );
      });
    });
  }

  const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;
  ```

  Auto-selected: option (a) "single explicit failing test" over (b) "fail all describe.skip-converted-to-describe tests" or (c) "refuse to start vitest". A single explicit gate-test gives CI a clear, well-named failure that points operators at the fix command; the alternatives over-fire (b) or are harder to wire into vitest's lifecycle (c).

### CI signal — `REQUIRE_FIXTURES=1` (NOT `CI=true`, NOT `GITHUB_ACTIONS`)

- **D-02:** The CI signal is the explicit `REQUIRE_FIXTURES=1` env var set by the CI runner / `scripts/test.sh` in CI mode — NOT `CI=true` (universal but couples test contract to CI provider conventions) and NOT `GITHUB_ACTIONS` (provider-specific; couples to a single CI host). Rationale matches the project's "explicit, narrow contracts" pattern (cf. `RUN_LIVE_TESTS=1` for cost-budgeted live tests at `live-anti-hallucination.test.ts:136`, `live-psych-anti-hallucination.test.ts:120`). The same pattern allows local operators to opt into hard-fail mode (`REQUIRE_FIXTURES=1 bash scripts/test.sh`) when they want to verify CI gate behavior end-to-end before pushing.

### Failure surface — Single explicit failing test per fixture, not a full describe-conversion

- **D-03:** Each affected file emits ONE additional gate test (`describe('[CI-GATE] fixture present', …)`) that throws when `REQUIRE_FIXTURES=1` and the fixture is missing. The existing `skipIfAbsent` block stays — when the fixture IS present, both the gate-test (trivially passes) and the real suite run; when fixture is absent without `REQUIRE_FIXTURES`, both skip; when fixture is absent WITH `REQUIRE_FIXTURES`, gate-test fails (1 failure, clear name) and the real suite skips. CI sees `1 failed | N skipped` instead of `N skipped` → no longer green.

### Phase 45 dependency — Drafted in parallel, plan execution sequenced after Phase 45 ships

- **D-04:** Phase 44 PLAN.md may be drafted in parallel with Phase 45, but Phase 44 execution (the code changes) does NOT start until Phase 45 FIX-02 (`synthesize-delta.ts:937` output-dir path fix) is shipped. Otherwise: hardening M011 milestone-gate CI to require `m011-1000words/MANIFEST.json` while the operator regen command produces `m011-1000words-5days/MANIFEST.json` would turn CI red on the first run after the regen contract changes. Track the dependency in PLAN.md's prerequisites block; do not block the planning step.

### Documentation — `scripts/test.sh` header comment + REQUIREMENTS.md cross-link

- **D-05:** The `REQUIRE_FIXTURES` contract is documented in two places:
  1. A header comment block in `scripts/test.sh` near the existing migration-application section, explaining: env var name, CI semantics (CI runners set it; local dev does not), affected test files, and the regen command operators should run when it trips.
  2. A line in REQUIREMENTS.md / `.planning/decisions-index` cross-referencing this phase. NO standalone `TESTING.md` file is created (the project does not have one; adding one is scope creep — `CLAUDE.md` is the project-level entry point and currently does not exist at repo root). The `scripts/test.sh` comment is the operator-visible documentation surface.

### File coverage — 10 files in scope (M009 ×3, M010 ×4, M011 ×3)

- **D-06:** The hardening lands across these test files. Each gets the same per-file env-gated gate pattern (D-01). The HEXACO-style listing avoids drift:

  **M009 (CI-03):**
  - `src/__tests__/fixtures/primed-sanity.test.ts` (D045 silent-skip, `m009-21days` fixture)
  - `src/rituals/__tests__/synthetic-fixture.test.ts` (M009 milestone-shipping gate, `m009-21days` fixture)

  **M010 (CI-01):**
  - `src/__tests__/fixtures/primed-sanity-m010.test.ts` (2 gates: M30_PRESENT + M5_PRESENT)
  - `src/memory/profiles/__tests__/integration-m010-30days.test.ts` (`m010-30days` fixture)
  - `src/memory/profiles/__tests__/integration-m010-5days.test.ts` (`m010-5days` fixture)
  - `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` (FIXTURE_PRESENT one of three gates — see D-07)

  **M011 (CI-02):**
  - `src/__tests__/fixtures/primed-sanity-m011.test.ts` (2 gates: M30_PRESENT + M1K_PRESENT)
  - `src/memory/profiles/__tests__/integration-m011-30days.test.ts` (`m011-30days` fixture)
  - `src/memory/profiles/__tests__/integration-m011-1000words.test.ts` (`m011-1000words` fixture — path-fix dependency on Phase 45 FIX-02)
  - `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` (FIXTURE_PRESENT one of three gates — see D-07)

### Live anti-hallucination tests — Keep three-way `describe.skipIf`, ADD the gate-test

- **D-07:** The two `live-*-anti-hallucination.test.ts` files combine `FIXTURE_PRESENT` with `RUN_LIVE_TESTS=1 + ANTHROPIC_API_KEY` (cost-budgeted live LLM gates, intentional). The three-way skipIf is NOT touched. The CI-gate addition fires only on the `FIXTURE_PRESENT` leg — i.e., the gate-test predicate is `REQUIRE_FIXTURES=1 && !FIXTURE_PRESENT`, independent of `RUN_LIVE_TESTS`. This means CI (which sets `REQUIRE_FIXTURES=1` but NOT `RUN_LIVE_TESTS=1`) still fails loud on missing fixtures without trying to make a $0.10-0.25 live Anthropic call. Source-of-truth fixture-absence is the signal; the live-cost gate is orthogonal.

### Claude's Discretion

- Exact wording of the failure message (must mention regen command + fixture path; sub-format flexible)
- Whether to centralize the fixture-path → regen-command mapping in a `tests/fixtures/MANIFEST_REGEN_HINTS.ts` lookup or hardcode per-file (default: hardcode — only 8 distinct paths, refactor only if drift emerges)
- Test naming convention for the gate-test (`[CI-GATE] fixture present` is a placeholder)
- Whether `scripts/test.sh` should set `REQUIRE_FIXTURES=1` when it detects CI-environment indicators (`CI=true` env present), or leave it purely to the CI runner config. Default: leave to runner config — `scripts/test.sh` stays neutral, the contract is opt-in.

</decisions>

<specifics>
## Specific Ideas

- The naming `REQUIRE_FIXTURES` mirrors the existing `RUN_LIVE_TESTS` env-gate pattern in `live-anti-hallucination.test.ts:136` — "verb + noun, explicit, opt-in". Operator memorability matters; the convention is "if you want this gate ON, set `<VERB>_<NOUN>=1`".
- The "single explicit failing test" pattern matches what Phase 36 REVIEW.md WR-01 suggested ("Add a per-test it.fail() entry that runs always and asserts FIXTURE_PRESENT"). That review-suggested approach is what we're adopting.
- The console.log SKIP hint stays — operators running locally without the env var continue to see the regen hint they're used to. Only the silence-in-CI behavior changes.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/REQUIREMENTS.md` §CI (CI-01, CI-02, CI-03) — exact requirement contracts including affected file:line citations
- `.planning/ROADMAP.md` "Phase 44: CI Milestone-Gate Hardening" — Goal, Success Criteria, Phase 45 dependency
- `.planning/milestones/v2.6.1-REVIEW-SYNTHESIS.md` §T3 — root-cause analysis of the silent-skip class

### Source code reviews (root-cause + fix prescriptions)
- `.planning/milestones/v2.4-phases/30-test-infrastructure-harn-03-refresh/30-REVIEW.md` §WR-01 — M009 silent-skip pattern + recommended `process.env.CI` style hard-fail (this phase generalizes to `REQUIRE_FIXTURES`)
- `.planning/milestones/v2.5-phases/36-tests/36-REVIEW.md` §BL-01 — M010 silent-skip pattern across 5 files, fix prescription (split live vs mocked)
- `.planning/milestones/v2.6-phases/40-psychological-milestone-tests/40-REVIEW.md` §BL-01 — M011 silent-skip + `synthesize-delta.ts:937` output-dir path bug (Phase 45 FIX-02 dependency)

### Existing patterns (read for parallelism)
- `src/memory/profiles/__tests__/live-anti-hallucination.test.ts:76-86, 136` — canonical `RUN_LIVE_TESTS=1` env-gate pattern this phase mirrors
- `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts:50-156` — same pattern + defense-in-depth `beforeAll` early-return (WR-07 noted as no-op insurance — do NOT introduce that pattern)
- `src/__tests__/fixtures/primed-sanity.test.ts:66-90` — canonical FIXTURE_PRESENT skip-with-hint shape this phase replaces

### CI orchestration
- `scripts/test.sh` — the Docker-postgres-backed integration-test runner. Where `REQUIRE_FIXTURES` contract gets documented (D-05); not modified to set the env var itself (D-07 Discretion)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`existsSync(FIXTURE_PATH)` shape** — Already used in every target file. No new helper needed.
- **`describe.skipIf(<cond>)(...)` pattern from live tests** — Could be repurposed: `describe.skipIf(!REQUIRE_FIXTURES || FIXTURE_PRESENT)('[CI-GATE] …', () => { it('…', () => { throw new Error(...); }); });`. This gives the same single-failing-test outcome with vitest-native semantics rather than an outer `if`. Planner may pick whichever reads cleaner; both pass the same CI signal.
- **Console-log SKIP hint** — Lives at `primed-sanity.test.ts:84-90`, `synthetic-fixture.test.ts:165-172`, plus 8 sibling sites. The hint text + regen command per-fixture is the existing operator UX; preserve verbatim, only ADD the gate-test layer.

### Established Patterns
- **Env-gated opt-in** — `RUN_LIVE_TESTS=1` is the project's existing model for "CI must explicitly enable this to actually run". `REQUIRE_FIXTURES=1` is the same model in inverse polarity: "CI must explicitly enable this to fail-on-absent" (vs the default of skip-on-absent). Both share: opt-in (default disabled), `=1` truthiness, lowercase/snake-case naming.
- **Per-file inline gates** — The codebase consistently inlines fixture-load gates per test file rather than centralizing into a fixture loader. Match this pattern.
- **scripts/test.sh smoke-gates** — Lines 88-329 chain ~10 substrate smoke gates that `exit 1` on failure BEFORE vitest runs. The `REQUIRE_FIXTURES` documentation comment lives in this same section's style but does NOT add a new exit-1 gate (the gate is at the vitest level, not the shell level — keeps the contract test-runner-native).

### Integration Points
- **Phase 45 FIX-02 ↔ this phase's m011-1000words test** — Phase 45 fixes `synthesize-delta.ts:937` so operator regen writes `m011-1000words/MANIFEST.json` (not `m011-1000words-5days/MANIFEST.json`). After Phase 45 ships, the M011 1000words integration test's `FIXTURE_PATH` constant reads `tests/fixtures/primed/m011-1000words/MANIFEST.json` and the hardening here will require that path to exist on CI. If Phase 44 lands BEFORE Phase 45, CI hardening for that one fixture is meaningless (no operator command can produce it at the asserted path). Hence D-04.
- **Phase 45 FIX-06 ↔ M010 fixtures** — Phase 45 also refreshes the M010 operational fixtures against the SCHEMA-02 backfill. The hardening here does NOT require those fixtures to be re-shipped first; it requires only that, when CI runs, fixtures EITHER exist (because some out-of-band process — operator regen + commit, or CI-bundled fixtures — placed them) OR the test fails loud. The decoupling lets Phase 44 ship independently of fixture-refresh logistics.

</code_context>

<deferred>
## Deferred Ideas

- **Commit fixtures to git** (one alternative Phase 36 REVIEW.md BL-01 suggested) — out of scope for v2.6.1. `.gitignore:32` already excludes `tests/fixtures/primed/`. Changing that policy is a separate decision affecting repo size + Anthropic-API-cost trail + VCR cache strategy; would warrant its own discussion. The hard-fail gate accomplishes the BL-01 fix objective without the policy change.
- **Centralized `tests/fixtures/MANIFEST_REGEN_HINTS.ts`** — Discretion item; defer unless drift emerges across the 8 hardcoded hint strings.
- **CI-runner config (where `REQUIRE_FIXTURES=1` actually gets set)** — Project-level CI config is not in this repo's current scope (no `.github/workflows/*.yml` visible from review). The contract is shipped here; the runner that opts in lives wherever the CI pipeline is configured. Document the contract; do not chase the runner.
- **`vitest --shuffle`-safety review** for the gate-test ordering — out of scope; gate-test is independent (no shared state with main suite). If `--shuffle` is ever enabled project-wide, gate-tests still fire in their own describe block first or last, both of which surface the failure clearly.
- **Migrating other fixture-loader tests** outside the M009/M010/M011 milestone-gate set (e.g., any test that uses `existsSync` for other ephemeral fixtures) — explicitly NOT in scope. The three CI requirements scope this to milestone gates only.

</deferred>

---

*Phase: 44-ci-milestone-gate-hardening*
*Context gathered: 2026-05-14 via `gsd-discuss-phase --auto`*
*Depends on Phase 45 (FIX-02) for execution sequencing*
