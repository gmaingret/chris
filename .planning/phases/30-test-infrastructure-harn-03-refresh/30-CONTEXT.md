# Phase 30: Test Infrastructure + HARN-03 Refresh — Context

**Gathered:** 2026-04-30
**Status:** Ready for planning
**Mode:** interactive (4 gray areas selected and answered)

<domain>
## Phase Boundary

Phase 30 ships the **integration test phase that proves M009 works end-to-end**. After this phase, the repo has:

1. A 14-day synthetic fixture test (`src/rituals/__tests__/synthetic-fixture.test.ts`) that loads `tests/fixtures/primed/m009-21days/`, mocks 14 days of wallclock time via `vi.setSystemTime`, runs the FULL `processMessage` engine pipeline (NOT bypassing PP#5 — Pitfall 24), and asserts all 7 spec behaviors (TEST-24..30) including the cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` Pitfall-6 regression assertion.

2. A separate cron-registration regression file (`src/rituals/__tests__/cron-registration.test.ts`) per HARD CO-LOCATION #4 — distinct file from the fixture test — that asserts `registerRitualCron()` is invoked from `src/index.ts:main()` with the correct cron expression + Europe/Paris timezone (forces the wiring not to silently de-register).

3. The live anti-flattery test (`src/rituals/__tests__/live-anti-flattery.test.ts` — Phase 29-04 already wrote the file with adversarial week fixture + 17-marker scan + skipIf gate) gets its gate flipped per HARD CO-LOC #6 (TEST-31 owns the live execution; Phase 29 owned the implementation).

4. HARN-03 carry-in: the `tests/fixtures/primed/m009-21days/MANIFEST.json` is regenerated against fresh prod data via `scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force`. The 4 v2.3 sanity invariants flip from 2/4 fail → 4/4 pass (≥7 summaries → ≥21; ≥200 entries easily met). A 5th invariant is added asserting `wellbeing_snapshots` table populated with ≥14 days of data (codifies the new M009 substrate as a fixture invariant). VCR cost model documented in `.planning/codebase/TESTING.md` with new `--reseed-vcr` flag added to `regenerate-primed.ts`.

**In scope (13 requirements: TEST-23..32 + HARN-04..06):**

- **TEST-23** — 14-day synthetic fixture in `src/rituals/__tests__/synthetic-fixture.test.ts` via `vi.setSystemTime` mock-clock + `loadPrimedFixture('m009-21days')`. Tests run through full `processMessage` engine pipeline (NOT bypassing PP#5 — Pitfall 24).
- **TEST-24** — Assertion 1: daily prompts fire on schedule with correct rotation (no consecutive duplicates floor; no-repeat-in-last-6 strong invariant). Property-test pattern.
- **TEST-25** — Assertion 2: voice note responses store correctly as Pensieve entries with `epistemic_tag = RITUAL_RESPONSE` + `metadata.source_subtype = 'ritual_voice_note'`. **Cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` assertion** — proves PP#5 short-circuited engine response (Pitfall 6 regression test).
- **TEST-26** — Assertion 3: skip tracking increments on missed days (`fired_no_response` outcome) but NOT on `system_suppressed` or `window_missed` outcomes.
- **TEST-27** — Assertion 4: adjustment dialogue triggers after 3 consecutive daily skips OR 2 consecutive weekly skips. Cadence-aware threshold honored (Phase 28 substrate).
- **TEST-28** — Assertion 5: wellbeing snapshots store correctly when Greg responds via simulated `callback_query` (via `simulateCallbackQuery` test helper — first use of inline keyboards in test fixtures).
- **TEST-29** — Assertion 6: weekly review fires at week boundary with exactly **one observation** + **one Socratic question**. Both Stage-1 Zod refine AND Stage-2 Haiku judge invoked; templated fallback exercised in at least one fixture week (Phase 29 substrate).
- **TEST-30** — Assertion 7: weekly review references specific episodic summaries AND decisions from the simulated week. Date-grounding post-check passes; no out-of-window references in the observation text.
- **TEST-31** — Live anti-flattery 3-of-3 atomic against real Sonnet (HARD CO-LOC #6 — own plan). Adversarial week fixture (already in tree from Phase 29-04 commit `1a66422`) baits flattery; assert generated observation contains NONE of the 17 forbidden markers from M006 conventions. Default-skipped via `skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)` for cost discipline (D-30-03).
- **TEST-32** — Cron registration regression in `src/rituals/__tests__/cron-registration.test.ts` (HARD CO-LOC #4 — distinct file). Asserts `registerRitualCron()` called in `src/index.ts:main()` with correct cron expression + timezone.
- **HARN-04** — Carry-in #2: run `scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force` against fresh prod. Resulting `tests/fixtures/primed/m009-21days/MANIFEST.json` materialized. HARN-03 sanity invariants flip 2/4 fail → 4/4 pass.
- **HARN-05** — VCR cost model documented in `.planning/codebase/TESTING.md`. Add `--reseed-vcr` flag to `regenerate-primed.ts` that clears VCR cache before re-run; default behavior preserves cache + warns on missing entries.
- **HARN-06** — HARN-03 5th sanity invariant: assert `wellbeing_snapshots` table populated with ≥14 days of synthetic data.

**Out of scope (deferred to v2.5+ or future phases):**
- Multi-week (>14 day) synthetic coverage of skip-tracking and adjustment-dialogue flows — current 14-day window already satisfies SKIP-03 (daily=3, weekly=2) thresholds; longer windows defer to v2.5
- VCR cache rebuild automation in CI — manual `--reseed-vcr` invocation is sufficient for v2.4
- DIFF-2/DIFF-3/DIFF-5 weekly review enhancement coverage in fixture — those features themselves are deferred to v2.5
- Cross-cutting M009 user-acceptance walkthrough document — Phase 28 + 29 already produced post-deploy UAT artifacts; consolidation deferred
- Performance / regression latency benchmarks for `runRitualSweep` — deferred unless real-clock observation surfaces a problem

</domain>

<decisions>
## Implementation Decisions

### Plan split structure (D-30-01)

**D-30-01:** **4 plans** for Phase 30, partitioned by HARD CO-LOC constraints (#4 forces TEST-32 into its own file → its own plan; #6 forces TEST-31 into its own plan) and by substrate dependency (the 14-day fixture must be regenerated BEFORE the synthetic-fixture test can run).

- **Plan 30-01 — HARN fixture refresh (substrate):** Run `scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force` against fresh prod (D-30-02 below). Add `--reseed-vcr` flag to the regenerate script (HARN-05) — when set, clears VCR cache before re-run; default preserves cache + warns on missing entries. Document VCR cost model in `.planning/codebase/TESTING.md` (HARN-05). Update `tests/fixtures/primed/sanity.test.ts` (or wherever the 4 HARN-03 invariants live) to flip thresholds (≥7 summaries → ≥21) AND add the 5th invariant `wellbeing_snapshots ≥ 14 days` (HARN-06). **Requirements: HARN-04, HARN-05, HARN-06.** ~80 LoC + 1 doc.

- **Plan 30-02 — Synthetic fixture test (TEST-23..30, all 7 assertions):** Author `src/rituals/__tests__/synthetic-fixture.test.ts` with one `describe('M009 synthetic fixture (14 days)', ...)` block containing 7 `it()` assertions (TEST-24..30). Uses `vi.setSystemTime` to walk the mock clock day-by-day, loads `m009-21days` primed fixture, runs the FULL `processMessage` engine pipeline for each simulated message. The cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` assertion in TEST-25 is afterAll-style — proves PP#5 short-circuit across the entire fixture week (Pitfall 6 regression test). May need a `simulateCallbackQuery(...)` test helper for TEST-28 (first use of inline keyboards in test fixtures). **Requirements: TEST-23, TEST-24, TEST-25, TEST-26, TEST-27, TEST-28, TEST-29, TEST-30.** ~400 LoC test code + ~50 LoC helper.

- **Plan 30-03 — Cron registration regression (TEST-32, HARD CO-LOC #4):** Author `src/rituals/__tests__/cron-registration.test.ts` as a distinct file from synthetic-fixture.test.ts. Asserts `registerRitualCron()` is invoked from `src/index.ts:main()` with `cron expression = '* * * * *'` (or whatever the canonical sweep cadence is) + `timezone = 'Europe/Paris'`. Static analysis test — does NOT boot the cron, does NOT need the fixture, does NOT need ANTHROPIC_API_KEY. Pattern: read `src/index.ts` source via fs, grep for the registration call site, assert the literal arguments. ~60 LoC.

- **Plan 30-04 — Live anti-flattery gate flip (TEST-31, HARD CO-LOC #6):** Phase 29-04 already shipped `src/rituals/__tests__/live-anti-flattery.test.ts` (or `tests/live/anti-flattery.test.ts` — confirm path during planning) with adversarial week fixture + 17-marker scan + 3-of-3 atomic loop, gated `skipIf(!process.env.ANTHROPIC_API_KEY)`. Plan 30-04 tightens the gate to `skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)` per D-30-03 cost discipline + adds a one-line `// PHASE-30: live execution gate flipped per TEST-31` marker replacing the Phase 29-04 `// PHASE-30: enable in TEST-31` placeholder. Updates `.planning/codebase/TESTING.md` with manual invocation pattern. ~10 LoC + 1 doc paragraph. Smallest plan in Phase 30 by design — Phase 29 did the work; Phase 30 owns the gate.

**Rejected alternatives:**
- **5 plans (split TEST-23..30 into TEST-23..27 daily-side + TEST-28..30 weekly/wellbeing):** Same single test file (`synthetic-fixture.test.ts`) — splitting plans across one file violates "same file = same plan" convention and creates merge ordering issues. Rejected.
- **3 plans (collapse TEST-31 into TEST-23..30):** Violates HARD CO-LOC #6 explicit roadmap requirement. Rejected.

### HARN-04 fixture freshness gate (D-30-02)

**D-30-02:** **Regenerate as Plan 30-01 first task**, with a hard fail-fast assertion in HARN-04 acceptance criteria that `MANIFEST.json` window contains at least one Sunday (TEST-29 weekly-review fire requires Sunday in the simulated 14-day mock window).

- **Mechanism:** Plan 30-01 Task 1 runs `npx tsx scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force`. Task 2 reads the generated `tests/fixtures/primed/m009-21days/MANIFEST.json` and asserts via inline node script: `(a) window_start <= window_end`, `(b) (window_end - window_start) >= 14 days`, `(c) at least one date in [window_start, window_end] is a Sunday (dayOfWeek === 0)`, `(d) wellbeing_snapshots count >= 14`. If any assertion fails, the plan stops — do NOT proceed to subsequent plans. The fail-fast is intentional: TEST-29 will silently never fire weekly-review if no Sunday is present in the simulated window, producing a green-but-meaningless test result.
- **Rationale:** The fixture is regenerated against whatever prod state exists when Phase 30 starts. As long as Phase 28 has been deployed and the system has been running for ≥3 weeks, the natural rolling 21-day window will always contain at least 2-3 Sundays. The fail-fast catches the edge case where the user runs Phase 30 immediately after a clean prod reset (no Sunday data yet).
- **Rejected:** Manual regeneration before `/gsd-execute-phase 30` (slower; relies on user remembering to run the script). Conditional regeneration based on file-mtime (more code; same outcome for a one-shot phase).

### TEST-31 cost discipline (D-30-03)

**D-30-03:** **Tighten the skipIf gate to require BOTH `RUN_LIVE_TESTS=1` AND `ANTHROPIC_API_KEY`** — default test runs skip the live anti-flattery suite (zero API spend per `npm test` invocation). Manual invocation pattern documented in `.planning/codebase/TESTING.md` and referenced from the test file's leading comment.

- **Mechanism:** Plan 30-04 modifies the existing `skipIf(!process.env.ANTHROPIC_API_KEY)` Phase 29-04 wrote to `skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)`. Manual run command:
  ```bash
  RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... \
    npx vitest run src/rituals/__tests__/live-anti-flattery.test.ts
  ```
  (Or via scripts/test.sh if Docker postgres is also needed for any DB-backed assertions.)
- **Rationale:** Mirrors the M008 TEST-22 / D038 pattern (anti-flattery for episodic summarization). Cost ceiling: 3 calls × ~$0.15 = ~$0.45 per manual run, fully under the user's control. Avoids the foot-gun where someone adds `ANTHROPIC_API_KEY` to GitHub Actions secrets (e.g., for migrations or seed scripts) and silently incurs $0.45 on every CI run.
- **Documentation:** Plan 30-04 adds a new section to `.planning/codebase/TESTING.md` under "## Live Tests (manual gate required)" listing both M008 TEST-22 and M009 TEST-31 with the canonical invocation pattern. Add a follow-up todo for 28-POSTDEPLOY-UAT.md (the scheduled remote agent for 2026-05-07): once Phase 28 hits prod, validate that the env-var gate works as expected before the first manual run.
- **Rejected:** Weekly cron via `.github/workflows/anti-flattery-weekly.yml` — adds CI infrastructure scope this phase doesn't need; defer to v2.5 if monthly anti-flattery regression becomes a real concern. Skip-on-API-key-only — too lenient, foot-gun for accidental cost.

### Wave structure / parallelization (D-30-04)

**D-30-04:** **3 waves**: Wave 1 = 30-01 (HARN fixture refresh, substrate). Wave 2 = 30-02 + 30-03 + 30-04 in parallel (worktree isolation handles file conflicts; vitest `fileParallelism: false` already serializes test execution within each worktree's run). 30-04 is default-skip so contributes zero API cost during execute-phase.

- **Mechanism:** Plan frontmatter declares `wave: 1` for 30-01, `wave: 2` for 30-02/03/04. Plan 30-02 and 30-04 share `tests/fixtures/primed/m009-21days/` reads — but reads don't conflict, only writes do. Plan 30-03 modifies only `src/rituals/__tests__/cron-registration.test.ts` (new file). Plan 30-04 modifies only the existing live-anti-flattery test file's skipIf line + `.planning/codebase/TESTING.md`. Plan 30-02 modifies `src/rituals/__tests__/synthetic-fixture.test.ts` (new file) + the optional `simulateCallbackQuery` helper. NO `files_modified` overlap between 30-02/03/04.
- **Rationale:** Phase 28 ran 4-wave fully sequential due to inter-plan dependencies (28-04 extended 28-03's adjustment-dialogue.ts). Phase 30's three Wave-2 plans are genuinely independent — different files, different test contracts, different LLM surfaces (TEST-31 is the only one that touches LLM at runtime, and even then it's default-skip). Parallel saves ~30 min total wall-clock time.
- **Worktree-mode safety:** The orchestrator's intra-wave `files_modified` overlap check will pass cleanly. The post-merge test gate runs once per wave (per execute-phase §5.6) — but as established in Phase 28, full `scripts/test.sh` hangs in this sandbox on live API tests. The same caveat applies here; Phase 30 may need to be executed on the live server (192.168.1.50) where the API key is real, OR continue relying on per-plan executor self-checks + a final regression gate.
- **Rejected:** 3 waves sequential (slower without proportional safety benefit). 4 waves fully sequential (slowest; only justified if 30-03 or 30-04 ever extended a file 30-02 modified, which they don't).

### Open Q1: simulateCallbackQuery helper location and shape (D-30-05)

**D-30-05:** **Plan 30-02 owns the helper** — author `src/rituals/__tests__/fixtures/simulate-callback-query.ts` exporting `simulateCallbackQuery({ userId, callbackData, messageId })` returning a synthetic `CallbackQuery` shape that the wellbeing handler accepts. Mirrors Phase 27's wellbeing test helper pattern (`src/rituals/__tests__/fixtures/wellbeing.ts` if exists — confirm during planning).

- **Rationale:** TEST-28 needs to inject a tap on the inline keyboard (energy=3, mood=4, anxiety=2 OR skip). The wellbeing handler reads `callback_query` data from the Telegram update; in tests we need a way to forge that update without booting the Telegram bot. Phase 27 likely already shipped a forge helper — Plan 30-02 reuses or extends it.
- **Open during planning:** Confirm whether Phase 27 has an existing forge helper. If yes, extend; if no, author. Do NOT spike a separate plan — co-locate with TEST-28 work in 30-02.

### Open Q2: TEST-29 templated fallback exercise mechanism (D-30-06)

**D-30-06:** **Plan 30-02 simulates Stage-1 failure by mocking the Sonnet response** to return a compound question (`{ observation: "...", question: "What surprised you? Or what felt familiar?" }`) on iteration N of the 14-day mock walk. Stage-1 Zod refine throws → retry kicks in → second mock returns the same compound → retry cap=2 reached → templated fallback `"What stood out to you about this week?"` fires + `chris.weekly-review.fallback-fired` log line emitted. Test asserts the fallback log line was emitted AND the user-facing message contains the templated question.

- **Rationale:** REQUIREMENTS.md TEST-29 explicitly says "templated fallback exercised in at least one fixture week". The 14-day fixture only has 2 weeks max — one week tests happy-path Stage-1 + Stage-2; the other tests retry + fallback. Mock manipulation pattern mirrors Phase 29-02's existing weekly-review.test.ts unit tests.
- **Open during planning:** Confirm the mock injection point — `vi.mock('@anthropic-ai/sdk', ...)` already exists somewhere in the test infrastructure; reuse the pattern.

### Claude's Discretion

- Test file LoC estimates (~400 for 30-02, ~60 for 30-03, ~80 for 30-01): planner authoritative; user does not pre-approve LoC.
- Whether to extract `loadPrimedFixture()` test helper from `tests/fixtures/primed/load.ts` (assume it exists from M008/M009 prior phases) or write inline: planner authoritative.
- Specific assertion library calls (`expect(x).toEqual(y)` vs custom matchers): standard vitest patterns, no decision needed.
- Drizzle schema mirroring for any new test-only tables: planner authoritative — none expected for Phase 30.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Test infrastructure
- `.planning/codebase/TESTING.md` — Existing test patterns, `scripts/test.sh` orchestration, `fileParallelism: false` invariant. **Plan 30-01 + 30-04 update this file.**
- `vitest.config.ts` — `root: 'src'`, `fileParallelism: false`, `include: ['**/__tests__/**/*.test.ts']`. Phase 30's tests live under `src/rituals/__tests__/`.
- `scripts/test.sh` — Docker postgres + migration apply + vitest entry point. Phase 30 does NOT modify this script (Phase 28 already extended it for migration 0010 + Phase 29 for 0009).
- `scripts/regenerate-primed.ts` — Phase 30 Plan 30-01 modifies this to add `--reseed-vcr` flag (HARN-05).

### M009 substrate (test targets)
- `src/chris/engine.ts` — `processMessage` pipeline; PP#5 ritual-response detector at engine position 0; `metadata.kind` dispatch added in Phase 28-03. Plan 30-02 exercises this end-to-end.
- `src/rituals/scheduler.ts` — `runRitualSweep` + `dispatchRitualHandler` + `ritualResponseWindowSweep` (28-01) + `shouldFireAdjustmentDialogue` predicate (28-02) + `autoReEnableExpiredMutes` (28-04). Plan 30-02 mocks the clock and walks the sweep day by day.
- `src/rituals/voice-note.ts`, `src/rituals/wellbeing.ts`, `src/rituals/weekly-review.ts`, `src/rituals/adjustment-dialogue.ts` — All 4 ritual handlers exercised in TEST-23..30.
- `src/rituals/types.ts` — `RitualFireOutcome` 12-variant union (Phase 28-01). TEST-26 asserts only `fired_no_response` increments skip_count.
- `src/index.ts` — `registerRitualCron()` invocation site. Plan 30-03 (TEST-32) reads this file and asserts the registration arguments.
- `src/cron-registration.ts` — `RegisterCronsDeps` interface + `ritualConfirmationSweep` 1-min cron (Phase 28-03). Plan 30-03 may also assert this cron is registered.

### Fixture infrastructure
- `tests/fixtures/primed/m009-21days/` — Output of HARN-04 regeneration. Plan 30-02 loads via `loadPrimedFixture('m009-21days')`.
- `tests/fixtures/primed/MANIFEST.md` (or per-fixture MANIFEST.json) — Fixture metadata; Plan 30-01 asserts invariants here.
- `tests/fixtures/primed/sanity.test.ts` (path TBD — confirm during planning) — HARN-03 invariants. Plan 30-01 flips thresholds + adds 5th invariant.
- `tests/live/anti-flattery.test.ts` (or `src/rituals/__tests__/live-anti-flattery.test.ts` — confirm path) — Phase 29-04 commit `1a66422` + `5974273` + `1f39a90`. Plan 30-04 modifies the skipIf gate.

### M006 + M008 conventions (TEST-31 input)
- M006 conventions doc — 17 forbidden flattery markers (path TBD; planner finds during research). Plan 30-04 / TEST-31 imports the marker list deterministically (Phase 29-04 commit `5974273` exported these constants per Rule 1).
- M008 TEST-22 / D038 — Live anti-flattery pattern Plan 30-04 mirrors. Search `.planning/phases/` for "TEST-22" to find the prior plan/summary.

### Project conventions
- `./CLAUDE.md` — Project-level guidelines (always read).
- `.planning/PROJECT.md` — Core value, requirements, evolution rules.
- `.planning/STATE.md` — Current project state.
- `.planning/REQUIREMENTS.md` — Source of truth for TEST-23..32 + HARN-04..06 acceptance text.
- `.planning/ROADMAP.md` — Phase 30 entry with goal + success criteria.
- Phase 28 + 29 SUMMARY.md files — What the M009 features actually shipped (Plan 30-02 must exercise the actual shape, not the planned shape).

</canonical_refs>

<specifics>
## Specific Ideas

- The `mockAnthropicCreate.not.toHaveBeenCalled()` cumulative assertion in TEST-25 is afterAll-style — accumulates across all 7 days of voice-note tests in the fixture. The exact pattern is in Phase 28's `engine-pp5.test.ts:83` (per Phase 29 + 28 verifier reports). Reuse the pattern verbatim.
- The 17 forbidden flattery markers for TEST-31 were exported as constants in Phase 29-04 commit `5974273` per Rule 1 ("export marker constants for live weekly-review test"). Plan 30-04 imports — no re-derivation.
- `vi.setSystemTime` mock-clock walks: pattern is `for (const day of fixtureDays) { vi.setSystemTime(day.startOfDay); await tickRitualSweep(); /* assertions for that day */ }`. Confirm this pattern exists in Phase 26 or 27 voice-note / wellbeing tests during planning.
- Phase 28's adjustment-dialogue 60s confirmation window is exercised in TEST-27 only at the threshold-trigger boundary (not the 60s confirmation window itself — that's a Phase 28 unit test concern). TEST-27 asserts the dialogue FIRES; the inner Haiku/confirmation logic is already covered by Phase 28-03's tests.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-week (>14 day) synthetic coverage** — current 14-day window already satisfies SKIP-03 cadence-aware thresholds; longer windows defer to v2.5
- **VCR cache rebuild automation in CI** — manual `--reseed-vcr` invocation is sufficient for v2.4
- **DIFF-2/DIFF-3/DIFF-5 weekly review enhancement coverage in fixture** — features themselves deferred to v2.5
- **Cross-cutting M009 user-acceptance walkthrough document** — Phase 28 + 29 already produced post-deploy UAT artifacts; consolidation deferred to milestone-completion phase
- **Performance / regression latency benchmarks for `runRitualSweep`** — deferred unless real-clock observation surfaces a problem
- **Weekly anti-flattery cron via `.github/workflows/anti-flattery-weekly.yml`** — D-30-03 rejected for v2.4; reconsider for v2.5 if monthly regression becomes a concern

</deferred>

---

*Phase: 30-test-infrastructure-harn-03-refresh*
*Context gathered: 2026-04-30 via interactive /gsd-discuss-phase 30 (4 gray areas selected and answered)*
