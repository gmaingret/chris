---
phase: 30-test-infrastructure-harn-03-refresh
reviewed_at: 2026-05-14
files_reviewed: 8
blocker_count: 3
warning_count: 7
---

# Phase 30 Code Review — Adversarial

**Reviewed:** 2026-05-14
**Depth:** standard
**Status:** issues_found

## Summary

Phase 30 ships fixture-refresh substrate (Plan 30-01), the 14-day synthetic
fixture integration test (30-02), a static cron-registration regression
(30-03), and the live-anti-flattery dual-gate (30-04). The work mostly holds
up, but three blockers exist around fixture-validator brittleness, tautological
test mocks that don't exercise the named behavior, and a silent fixture-data
loss in test cleanup that the docstring explicitly denies.

The HARN gate predicates (relaxed thresholds with TODO(phase-32) markers) are
defensible — Greg's Option A directive is paper-trailed in three places.
But the FIXTURE_PRESENT skip-gate pattern (correctly flagged in the prompt
as a D045 risk) is in both primed-sanity.test.ts AND synthetic-fixture.test.ts
with no CI enforcement that the fixture exists in canonical environments —
the entire M009 milestone-shipping gate can disappear silently from `npm test`
output. This is the highest-severity finding.

## Blockers

### BL-01: validate-primed-manifest.ts rejects legitimate fixtures with synthDaysNeeded=0

- **File:** `scripts/validate-primed-manifest.ts:144-150` (with emission contract at `scripts/synthesize-delta.ts:945-951`)
- **Issue:** The synth-delta emitter explicitly writes `synthetic_date_range: null` when `synthDaysNeeded === 0` (i.e. organic snapshot already covers the full `target_days` window — a valid future state once Phase 32 substrate hardening lands or simply when prod has ≥21 organic days). The validator's check is `if (!Array.isArray(sdr) || sdr.length !== 2)` — when `sdr === null`, `Array.isArray(null)` is `false`, so the validator hard-fails with `"must be a 2-element array; got null"`. The PrimedManifest interface even types the field as `[string, string] | null`, acknowledging null is valid — but the validator doesn't honor that contract.
- **Impact:** Future fixture regenerations with full organic coverage will fail the validation gate spuriously, blocking Phase 32 substrate hardening (the very work the TODO(phase-32) markers reference). Also blocks any milestone with target_days ≤ organic span.
- **Fix:** Treat `sdr === null` as a no-synth-needed signal. Skip the 2-element + ISO-parse + synth-Sunday checks when null; the pensieve-Sunday check at line 209-213 still runs and is sufficient.
  ```ts
  const sdr = manifest.synthetic_date_range;
  if (sdr !== null) {
    if (!Array.isArray(sdr) || sdr.length !== 2) { /* existing check */ }
    // ... existing synth-range parsing
  }
  // Sunday check still runs against pensieve dates regardless
  ```

### BL-02: synthetic-fixture.test.ts cleanup() wipes wellbeing_snapshots organic data despite docstring promise

- **File:** `src/rituals/__tests__/synthetic-fixture.test.ts:184-188`
- **Issue:** The comment block at lines 184-187 explicitly states cleanup "preserves the fixture's organic ... wellbeing_snapshots (those are loaded once in beforeAll)". The very next line (188) is `await db.delete(wellbeingSnapshots)` — a full table wipe with no WHERE clause. The 4 organic wellbeing rows the m009-21days fixture loads via beforeAll get destroyed on the FIRST beforeEach call and are never restored (no reload). Every test after the first runs against an empty wellbeing_snapshots table, despite the fixture-load contract.
- **Impact:** (a) The HARN-06 5th invariant from primed-sanity is silently violated within synthetic-fixture's test scope — the fixture is degraded mid-suite. (b) Any future TEST-N that asserts against organic wellbeing data (e.g. profile-builder reading wellbeing_snapshots history) will see empty state and pass trivially. (c) The lying docstring is a maintenance bomb: a future executor reading "preserves fixture data" will architect cleanup-dependent tests incorrectly. (d) Test ordering becomes load-bearing: TEST-28 happens to insert its own snapshots before asserting, but if it ran first vs last would produce different fixture states for sibling tests.
- **Fix:** Scope the delete to test-deposited rows OR reload organic wellbeing rows in beforeEach. Easiest correct fix:
  ```ts
  // Delete only rows NOT in the original fixture window — preserve organic.
  // Or delete by created_at > fixture_load_time. Or: scope by snapshot_date
  // outside the fixture's known organic date range.
  ```
  Alternatively, delete the false comment and own the truth: "cleanup wipes wellbeing entirely; tests that need organic wellbeing must re-seed in their own beforeEach." Either fix is acceptable; the contradiction is not.

### BL-03: TEST-30 date-grounding assertion is tautological — does not test date-grounding logic

- **File:** `src/rituals/__tests__/synthetic-fixture.test.ts:733-740, 744-749, 790-794`
- **Issue:** The test mocks Sonnet to return a hardcoded observation containing the literal `${WEEKLY_REVIEW_SUNDAY_ISO}` string (line 734: `` `This week (${WEEKLY_REVIEW_SUNDAY_ISO}) you wrestled with...` ``), then mocks the date-grounding Haiku to return `references_outside_window: false`. The post-test assertion at 791-794 asserts the persisted observation `.toContain(WEEKLY_REVIEW_SUNDAY_ISO)` — but the test ITSELF injected that string into the mock. This is a tautology: the test is asserting that string concatenation works, not that date-grounding catches out-of-window references. If the date-grounding logic were entirely deleted from production code, this test would still pass.
- **Impact:** TEST-30's REQUIREMENTS contract ("weekly review references specific episodic summaries AND decisions from the simulated week; date-grounding post-check passes; no out-of-window references in the observation text") is NOT exercised. The plan claims TEST-30 is covered ("the date-grounding mock returned references_outside_window:false proving the post-check ran") — but proving the mock returned a value the test injected is circular. A real regression test would feed an observation containing an OUT-of-window date (e.g. `2025-12-01`) and verify the production path rejects it or triggers fallback.
- **Fix:** Either (a) feed the mocked Sonnet a deliberately out-of-window date, mock date-grounding to return `references_outside_window: true`, and assert the fallback fires; OR (b) acknowledge in the test name/comments that this is a smoke test for the fields-are-wired path and write a separate negative test for the actual grounding behavior; OR (c) move this case to a unit test in `weekly-review.test.ts` where the post-check function can be exercised directly with synthetic inputs.

## Warnings

### WR-01: FIXTURE_PRESENT silent-skip masks M009 milestone gate disappearance

- **File:** `src/rituals/__tests__/synthetic-fixture.test.ts:127, 164-171`; `src/__tests__/fixtures/primed-sanity.test.ts:68, 82-90`
- **Issue:** Both files use `const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip` with a console.log SKIP hint. The synthetic-fixture test IS the M009 milestone-shipping gate (per its own docstring: "the cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` invariant is M009's milestone-shipping gate"). If a CI environment, fresh clone, or post-`git clean` state lacks `tests/fixtures/primed/m009-21days/MANIFEST.json` (which is gitignored per Plan 30-01 Decision 4), the gate silently SKIPS with a console.log that's easily lost in CI noise. `bash scripts/test.sh` reports "0 failures" and the milestone signal is gone.
- **Impact:** A future executor (or a degraded CI run after VCR cache eviction) could ship M009 regressions undetected because the gate was skipped, not failed.
- **Fix:** Promote FIXTURE_PRESENT skip to a HARD-FAIL in CI mode. Pattern:
  ```ts
  if (!FIXTURE_PRESENT && process.env.CI) {
    throw new Error(`M009 milestone gate cannot run: ${FIXTURE_PATH} missing. Regenerate via scripts/regenerate-primed.ts.`);
  }
  ```
  Or add a per-test it.fail() entry that runs always and asserts FIXTURE_PRESENT. The current skip-with-console pattern is exactly the D045 anti-pattern the project explicitly flagged.

### WR-02: synthesize-delta wellbeing schema fix uses fixed-calendar dates unrelated to synthStart

- **File:** `scripts/synthesize-delta.ts:752-767`
- **Issue:** The Phase 30-01 Rule-1 fix correctly updated row shape but hardcoded the date generation as `new Date(Date.UTC(2026, 3, 20 + d))` — April 20 2026 + d days, completely decoupled from the function's actual `synthStart` (which isn't even passed in; the helper only takes `seed` and `days`). When `d ≥ 11`, dates overflow April→May (April has 30 days; `Date.UTC(2026, 3, 30)` = April 30, `Date.UTC(2026, 3, 31)` = May 1). For `days = 14`, you get April 20..May 3, which has zero relation to the actual organic_end + 1 the rest of the script uses for synth dates.
- **Impact:** wellbeing_snapshots dates can be misaligned with the rest of the fixture's synthetic window. For m009-21days the function was called with `days=4` (only 4 synth-fill needed), so the misalignment was masked — output dates were April 20-23, while pensieve synth dates were May 7-10. The HARN-06 invariant counts rows, not date alignment, so primed-sanity passed. But the dates are objectively WRONG: a wellbeing snapshot dated April 20 has no corresponding pensieve activity in the fixture.
- **Fix:** Pass `synthStart` into `generateWellbeingIfTableExists` and align dates to it. Or document loudly that the dates are placeholder and only row count matters. Current behavior is a latent landmine for any Phase 32 test that joins wellbeing.snapshot_date ↔ pensieve.created_at.

### WR-03: to_regclass existence check has dead-code condition

- **File:** `scripts/synthesize-delta.ts:736-738`
- **Issue:** `to_regclass` returns NULL when the table doesn't exist; never `undefined`. The result row is always defined (postgres returns one row). So `(result[0])?.exists !== null && (result[0])?.exists !== undefined` reduces to `exists !== null` — the `!== undefined` clause is dead. More subtly: `result[0]?.exists` could be `undefined` if the COLUMN aliasing fails (e.g. column renamed), but that would be a different bug class. The double-check obscures intent.
- **Impact:** Misleading code; no functional bug currently.
- **Fix:** Simplify to `const exists = (result[0] as { exists: unknown }).exists !== null;`

### WR-04: parkRituals far-future date uses Date.now() at definition, not at call time

- **File:** `src/rituals/__tests__/synthetic-fixture.test.ts:283`
- **Issue:** `parkRituals` is defined inside the describe block and computes `new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)` each call (good — it's inside the function body). BUT the test uses `vi.setSystemTime(...)` which mocks `Date.now()`. So `farFuture` = simulated time + 365 days, NOT real time + 365 days. For tests that don't advance the simulated clock past a year forward, this works. But if `vi.setSystemTime` is invoked with a date and then `parkRituals` runs, the "far future" is anchored to the simulated time. If a subsequent test setSystemTime'd to a date AFTER that anchor (e.g. test resets clock to 2027-06-01 but parked at 2026-04-15+365 = 2027-04-14), parked rituals would un-park.
- **Impact:** In the current test order/dates, this doesn't trigger. But it's a subtle interaction trap if Phase 32 extends the fixture window or re-anchors mock clocks.
- **Fix:** Use an absolute far-future date constant (`new Date('2099-01-01T00:00:00Z')`) or compute from a fixed epoch. The relative-to-mock-clock pattern is fragile.

### WR-05: Per-iteration ritual reset uses `new Date()` which captures mocked clock — but pensieve writes need real time

- **File:** `src/rituals/__tests__/synthetic-fixture.test.ts:312, 412, 624, 664`
- **Issue:** Multiple `nextRunAt: new Date()` updates inside the mock-clock walk. These insert mocked timestamps into postgres. Postgres-side defaults (`DEFAULT NOW()` in some migrations) bypass the mock. Mixing mocked-time application writes with real-time DB defaults creates subtly impossible event orderings (e.g. ritual.nextRunAt = 2026-04-15 but ritual.updated_at = 2026-05-14). This isn't a correctness bug for the test's assertions, but downstream tests that query "events ordered by created_at" might see surprising orderings if reading rows that mix application timestamps with DB defaults.
- **Impact:** Tests pass today; tests querying event ordering on mixed-source timestamps might fail surprisingly later.
- **Fix:** Document the mocked-vs-real-time boundary or use SQL-level `NOW()` for timestamps the test doesn't need to control.

### WR-06: validate-primed-manifest.ts mutable arrays declared with `let`

- **File:** `scripts/validate-primed-manifest.ts:209, 215`
- **Issue:** `let sundays: string[] = []` and `let synthSundays: string[] = []` are never reassigned — only `.push`ed to. Should be `const`.
- **Impact:** Style/lint; no bug.
- **Fix:** `const sundays: string[] = [];` and `const synthSundays: string[] = [];`.

### WR-07: cleanup() in synthetic-fixture deletes pensieveEntries by epistemic_tag but other tests delete unscoped — inconsistent isolation model

- **File:** `src/rituals/__tests__/synthetic-fixture.test.ts:193-195` vs `src/rituals/__tests__/wellbeing.test.ts:82-84`
- **Issue:** synthetic-fixture takes an epistemic_tag scoped delete for pensieveEntries (correct for preserving organic data), but unscoped deletes for wellbeingSnapshots, ritualFireEvents, ritualConfigEvents, ritualResponses, ritualPendingResponses (BL-02 covers the wellbeing one specifically). wellbeing.test.ts also uses unscoped deletes. If both test files run in the same `npm test` invocation against the same DB (which `fileParallelism: false` permits sequentially), one file's cleanup can wipe another's seeded state. The Pitfall 7 mitigation comment at line 53 cites `fileParallelism: false` as the defense — true for parallelism, but NOT for ORDER-DEPENDENCE across sequential files sharing a DB.
- **Impact:** Test order-dependence latent bug. Likely not triggering today because each file's beforeEach re-seeds. But adding a future test file that DOES depend on data persisting across describe blocks would break unpredictably.
- **Fix:** Document the "every test owns full cleanup of its scope; never trust prior state" contract explicitly, OR use per-file chat_id scoping rigorously (the CHAT_ID_M009_SYNTHETIC_FIXTURE constant exists but is `void`'d at line 142 — unused).

---

*Reviewed: 2026-05-14*
*Reviewer: Claude (gsd-code-reviewer)*
*Depth: standard*
