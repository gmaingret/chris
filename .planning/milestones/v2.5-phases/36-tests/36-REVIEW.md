---
phase: 36-tests
reviewed_at: 2026-05-14
files_reviewed: 6
blocker_count: 4
warning_count: 6
---

# Phase 36: Adversarial Code Review

**Scope:** M010 milestone-gate tests (PTEST-01..05). Plan 36-01 fixture+integration suite + Plan 36-02 live anti-hallucination gate.

**Files reviewed (key_files from SUMMARYs, current state):**
1. `scripts/__tests__/synthesize-delta-profile-bias.test.ts` (350 lines)
2. `src/__tests__/fixtures/seed-profile-rows.ts` (223 lines)
3. `src/__tests__/fixtures/primed-sanity-m010.test.ts` (269 lines)
4. `src/memory/profiles/__tests__/integration-m010-30days.test.ts` (438 lines)
5. `src/memory/profiles/__tests__/integration-m010-5days.test.ts` (236 lines)
6. `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` (228 lines)

Modifications to `scripts/synthesize-delta.ts` (PROFILE_BIAS_* + dimensionHintFor), `scripts/regenerate-primed.ts` (--profile-bias pass-through), `src/__tests__/fixtures/chat-ids.ts`, and `src/memory/profiles.ts` (PROFILE_INJECTION_HEADER export) were inspected in context.

---

## Blocker Issues

### BL-01: Silent-skip pattern hides PTEST-01..05 regression in CI
- **Files:**
  - `src/memory/profiles/__tests__/integration-m010-30days.test.ts:125-137`
  - `src/memory/profiles/__tests__/integration-m010-5days.test.ts:105-120`
  - `src/__tests__/fixtures/primed-sanity-m010.test.ts:156-171, 210-239`
  - `src/memory/profiles/__tests__/live-anti-hallucination.test.ts:76-86, 136`
- **Issue:** All 5 test files use `existsSync(MANIFEST) ? describe : describe.skip` and the `m010-30days/m010-5days` fixtures are **gitignored** (confirmed: `.gitignore:32 → tests/fixtures/primed/`). On any fresh checkout — including CI — the fixtures are absent, `FIXTURE_PRESENT=false`, and the entire describe block silently `describe.skip`s. The test runner reports **"skipped"** rather than **"failed"**, which most CI pipelines treat as green. The Plan 36-01 SUMMARY explicitly verifies the live test "skipped 1 / passed 0" path as a positive outcome (line 138-140: "1 skipped not 1 passed (would mean unbudgeted Anthropic spend)"). That logic is correct for the live LLM test but **wrong for the mocked integration tests** (PTEST-02/03/04) and HARN sanity gate (PTEST-01-HARN) — those have zero cost to run in CI and should fail loud when the fixture is missing.
- **Impact:** The M010 milestone-gate suite (PTEST-01-HARN through PTEST-04) provides **zero regression detection in CI**. Any future commit that breaks `loadProfileSubstrate`, the 4 generators, `updateAllOperationalProfiles`, threshold gating, or substrate-hash idempotency will pass CI as long as the developer doesn't regenerate the fixtures locally. The whole point of the milestone-gate phase is bypassed silently.
- **Fix:** Split the gate: live test (PTEST-05) keeps the existing 3-way `describe.skipIf` (cost-driven). The 4 mocked-SDK tests (`integration-m010-30days`, `integration-m010-5days`, `primed-sanity-m010`) should **fail with a clear error** when fixtures are absent on CI (e.g., when `CI=1` env is set), or commit the fixtures to git (drop the `.gitignore` entry per Pitfall P-36-01 Option B). Recommended: commit the fixtures — the v2.6 PMT-* fixtures (m011-*) follow the same gitignored pattern, multiplying the silent-skip risk.

### BL-02: Cycle 3 mutating INSERT into pensieveEntries is never rolled back
- **File:** `src/memory/profiles/__tests__/integration-m010-30days.test.ts:398-402, 430-437`
- **Issue:** PTEST-03 Cycle 3 INSERTs a new row into `pensieveEntries`:
  ```ts
  await db.insert(pensieveEntries).values({
    content: 'I moved from Saint Petersburg to Tbilisi this week.',
    epistemicTag: 'FACT',
    createdAt: new Date('2026-05-28T12:00:00Z'),
  });
  ```
  This row is NEVER deleted. The `afterAll` hook deletes `profile_history` and reseeds `profile_*` rows, but does **NOT** touch `pensieveEntries`. The inline comment at line 430-437 explicitly acknowledges this and rationalizes "the next file's beforeAll re-runs loadPrimedFixture (which clears pensieve_entries)". This is fragile: if any test file in the same vitest run order touches `pensieveEntries` between this file's `afterAll` and the next `loadPrimedFixture` call, it sees a phantom 2026-05-28 FACT entry that the test did not declare.
- **Impact:** Cross-test leakage. Any sibling test that asserts pensieve row counts, content-hash uniqueness (`null` content_hash + no dedup), or filters by `epistemic_tag='FACT'` AND `createdAt > 2026-05-27` will see the phantom row. Risk magnified by the vitest single-DB-session model (`scripts/test.sh` uses one Docker Postgres across all files). Also: if PTEST-02 ever runs AFTER PTEST-03 (vitest CAN reorder describe blocks under `--shuffle`), its `substrate.entryCount >= 10` and `history.toHaveLength(4)` still hold, but the substrate window now contains 110 entries → different hash → different downstream behavior if tests grow.
- **Fix:** Add explicit cleanup in `afterAll` AND immediately after the Cycle 3 assertions:
  ```ts
  await db.delete(pensieveEntries).where(eq(pensieveEntries.createdAt, new Date('2026-05-28T12:00:00Z')));
  ```
  Or capture the inserted row's id from a `RETURNING id` clause and delete by id. Belt-and-suspenders cleanup, not commentary.

### BL-03: PTEST-05 silently fails when wall-clock advances past 2026-07-18
- **File:** `src/memory/profiles/__tests__/live-anti-hallucination.test.ts:139-165`
- **Issue:** The `beforeAll` calls `updateAllOperationalProfiles()` with no arguments. Inside the orchestrator (`src/memory/profile-updater.ts:68`), this is `loadProfileSubstrate()` with default `now = new Date()` (real wall-clock). The `m010-30days` fixture's pensieve entries span **2026-04-15..2026-05-19** (per Plan 36-01 SUMMARY line 121 + integration-m010-30days.test.ts:237-238). The 60-day rolling substrate window means substrate is non-empty only when wall-clock ≤ 2026-07-18. After that date:
  - `substrate.entryCount = 0 < MIN_ENTRIES_THRESHOLD (10)`
  - All 4 generators return `profile_below_threshold` → profile rows stay at confidence=0
  - `formatProfilesForPrompt('REFLECT', profiles)` returns `''` (line 500: `if (row.confidence === 0) continue`)
  - REFLECT system prompt does NOT contain `PROFILE_INJECTION_HEADER`
  - **Assertion A fails** — but the failure mode looks like a Phase 35 D-08 wiring regression (per the error message at line 200), not a fixture-window expiry.
- **Impact:** The "M010 milestone gate" is calendar-bound. After 2026-07-18, the test fails for a reason completely unrelated to the SUT. Anyone re-running PTEST-05 to validate a v2.5.1 / v2.6 patch will see a misleading "Phase 35 wiring regression" error and waste cycles debugging. Today is 2026-05-14 — the test has ~9 weeks of shelf life.
- **Fix:** Either (a) pin time inside `beforeAll` with `vi.setSystemTime(new Date('2026-05-20T22:00:00Z'))` before calling `updateAllOperationalProfiles()`, then unset in `afterAll`; or (b) bypass the orchestrator and call `loadProfileSubstrate(NOW_C1)` + the 4 generators directly with a pinned `NOW` (same deviation pattern as the integration tests already use); or (c) regenerate the fixture on a rolling cadence keyed to wall-clock (least-favored — invalidates the VCR cache + breaks the deterministic-seed contract).

### BL-04: Prev-state injection assertion uses `.some()` — passes when 3 of 4 dimensions are broken
- **File:** `src/memory/profiles/__tests__/integration-m010-30days.test.ts:358-362`
- **Issue:** The M010-10 prev-state injection regression detector — load-bearing for the "second-fire celebration blindness" pitfall — is asserted as:
  ```ts
  const cycle1Prompts = mockAnthropicParse.mock.calls.map(
    (c) => ((c[0] as { system: Array<{ text: string }> }).system[0]?.text ?? ''),
  );
  const hasPrevState = cycle1Prompts.some((p) => p.includes('CURRENT PROFILE STATE'));
  expect(hasPrevState).toBe(true);
  ```
  Cycle 1 makes 4 Sonnet calls (one per dimension). The assertion requires `CURRENT PROFILE STATE` in **at least one** of the four. If `extractPrevState` returns null for 3 of 4 dimensions (a real regression that M010-10 was designed to catch — e.g., a refactor that breaks `stripMetadataColumns` for health+family+capital but leaves jurisdictional working), this test passes. CONTEXT.md D-20 specifies "previous-state injection was non-null (verified via mock SDK boundary test)" — the intent is to catch silent partial regressions, but `.some()` only proves it works for at least one dim.
- **Impact:** The exact regression pattern this test was designed to catch (M010-10: "first-fire celebration blindness — profile edition") is incompletely defended. A future refactor that breaks 3 of 4 prev-state extractors while leaving 1 working would ship green through this gate.
- **Fix:** Change to `.every()` and split the assertion per-dimension by inspecting the system prompt's `Dimension Focus — <Name>` substring (the same routing key already used by `primeAllDimensionsValid` at line 211-228):
  ```ts
  for (const dim of ['Jurisdictional', 'Capital', 'Health', 'Family']) {
    const promptForDim = cycle1Prompts.find((p) => p.includes(`Dimension Focus — ${dim}`));
    expect(promptForDim, `${dim} dim missing from cycle 1 calls`).toBeDefined();
    expect(promptForDim!, `${dim} dim missing prev-state injection`).toContain('CURRENT PROFILE STATE');
  }
  ```

---

## Warnings

### WR-01: PTEST-02 "last_updated advanced past seed time" assertion is a noop
- **File:** `src/memory/profiles/__tests__/integration-m010-30days.test.ts:329-333`
- **Issue:** The assertion `jRow!.lastUpdated.getTime() > seedTimeFloor` where `seedTimeFloor = new Date('2026-05-01').getTime()` only proves the DB wall-clock is past 2026-05-01. Both the seed-row's `lastUpdated` (set via `NOW()` in `seedProfileRows.ts:105`) AND the post-generation `lastUpdated` are set to wall-clock-real-NOW (typically 2026-05-XX or later). The assertion is trivially true for any modern run; it does NOT prove the value advanced from seed to post-generation.
- **Impact:** False-positive risk — a regression where `lastUpdated` is never updated on profile upsert (e.g., a flattener that drops the field) would NOT be caught here as long as the seed value was set within the same calendar window.
- **Fix:** Capture the seed value explicitly:
  ```ts
  const [jRowSeed] = await db.select().from(profileJurisdictional).limit(1);
  await Promise.all([generateJurisdictionalProfile({ substrate }), ...]);
  const [jRowAfter] = await db.select().from(profileJurisdictional).limit(1);
  expect(jRowAfter.lastUpdated.getTime()).toBeGreaterThan(jRowSeed.lastUpdated.getTime());
  ```

### WR-02: "Three-cycle" test does not actually advance the clock
- **File:** `src/memory/profiles/__tests__/integration-m010-30days.test.ts:337-437`
- **Issue:** The docstring (lines 22-50) describes "+7d" / "+14d" cycle spacing simulating weekly cron fires. The implementation passes `NOW_C1`, `NOW_C2`, `NOW_C3` to `loadProfileSubstrate(...)` but never calls `vi.setSystemTime`. The seed-row's `last_updated = NOW()` (DB clock) uses real wall-clock; the orchestrator if it were used would use real wall-clock; logger timestamps and any internal `Date.now()` checks use real wall-clock. Only the substrate-window boundary moves; nothing else simulates the +7d/+14d advance.
- **Impact:** Test docstrings overstate what's being verified. The actual contract verified is "given different NOW inputs to loadProfileSubstrate, substrate-hash idempotency holds" — narrower than "weekly cron fire idempotency over 3 weeks". A regression that ties cron behavior to `Date.now() % 7d` (unlikely but plausible if M013 adds cron-rate logic) would NOT be caught.
- **Fix:** Either downscale the docstrings to match what's tested, or add `vi.setSystemTime(NOW_C1)` / `vi.setSystemTime(NOW_C2)` / etc. before each cycle to make the simulation honest.

### WR-03: FORBIDDEN_FACTS phrase entries are too specific for n-gram defense
- **File:** `src/memory/profiles/__tests__/live-anti-hallucination.test.ts:104-126`
- **Issue:** Several entries are tightened to multi-word phrases to avoid whitelist collisions (e.g., `moving to portugal`, `having children`, `getting married`). A real hallucination of "Portugal is the destination" or "considering kids" or "engaged to" would NOT trigger the keyword scan. The cited workaround for "vietnam" → "thailand visa" doesn't even keep the original semantic (thailand is no more a hallucination than vietnam — they're both not-in-fixture, but the swap doesn't increase coverage). The "≥12 entries" threshold is hit numerically (17 entries) but the **effective** anti-hallucination surface is narrower than the count implies.
- **Impact:** The 3-of-3 live gate's Assertion B has a non-trivial false-negative rate. The plan acknowledged this with the "Strategy B Haiku post-judge deferred to v2.5.1" caveat, but the test passes through marginally — and any future review will see "17 forbidden facts checked, all clean" without realizing some entries are phrase-narrow.
- **Fix:** Document inline (in the FORBIDDEN_FACTS comment block) which entries are phrase-tightened versus genuine; consider deferring Assertion B until the Haiku post-judge ships, OR add a second sub-assertion that checks for plausible single-token positives that pass the whitelist (e.g., assert response does not contain `\b(diabetes|cancer|adhd)\b` as a regex while explicitly excluding fixture-positive words).

### WR-04: HARN classifier list silently re-defines the "single source of truth" contract
- **File:** `src/__tests__/fixtures/primed-sanity-m010.test.ts:58-72, 91-135`
- **Issue:** D-05 mandates `PROFILE_BIAS_KEYWORDS` is the "single source of truth" for per-dimension keyword classification. The HARN gate imports `PROFILE_BIAS_KEYWORDS` (line 61) only to satisfy an acceptance-check that the import exists (line 66 — `_PROFILE_BIAS_DIMS` is computed and discarded after a shape check). The actual classification list (`HARN_DIM_CLASSIFIERS`, lines 91-135) is a SEPARATE constant defined inline, broader and multilingual. The shape check at line 67 only asserts the 4 dimension keys exist — it does NOT verify any subset/superset relationship between the two lists. A future refactor that adds a 5th dimension to `PROFILE_BIAS_KEYWORDS` would emit a `console.warn` but pass the test; a refactor that REMOVES a keyword from `PROFILE_BIAS_KEYWORDS` would NOT change HARN behavior at all.
- **Impact:** "Single source of truth" is documented but not enforced. The `HARN_DIM_CLASSIFIERS` list is the *actual* gate; `PROFILE_BIAS_KEYWORDS` is decorative. Future drift between the two is invisible.
- **Fix:** Either (a) merge the two constants — derive HARN list from `PROFILE_BIAS_KEYWORDS` plus a documented per-dim multilingual addendum, or (b) drop the "single source of truth" claim from the comments and rename `HARN_DIM_CLASSIFIERS` to reflect that it's the gate's own list. The current state misleads.

### WR-05: `seedProfileRows.unsafe()` calls bypass Drizzle's parameterization
- **File:** `src/__tests__/fixtures/seed-profile-rows.ts:89-217`
- **Issue:** All 4 seed-row inserts use `client.unsafe(<raw SQL>)` with hardcoded literal strings. There is no untrusted input, so this is not a SQL injection vulnerability. However, per the project's "postgres drizzle parameterized in any helpers" guardrail (from the review prompt), this is a code-quality breach. The codebase has the migration shipped at `src/db/migrations/0012_*.sql` as the canonical seed source; duplicating the literal jsonb values here creates a drift surface — any migration-0013+ that updates seed values (e.g., changing `fi_target_amount` from `$1,500,000` to a new figure) silently desynchronizes from this helper.
- **Impact:** Maintainability degradation. A real migration-vs-helper drift will cause integration tests to assert against stale seed values and either false-pass (because both sides are stale) or false-fail (because the migration moved but the test helper didn't). Per the seed-profile-rows.ts comment block at lines 82-86: "Values are VERBATIM from src/db/migrations/0012_operational_profiles.sql lines 132-204" — but no compile-time check enforces this.
- **Fix:** Either (a) port to Drizzle's `db.insert(...).values({...}).onConflictDoUpdate({...})` builder (parameterized + type-checked), or (b) extract the seed jsonb literals into a shared `SEED_ROW_VALUES` constant module that both the migration and the helper read from at build time, or (c) re-run the migration's seed step inside the helper (e.g., truncate + re-import migration-0012 SQL). At minimum, add a runtime SHA check: compute `sha256(<helper-literal>)` and assert it equals `sha256(<migration-extracted-literal>)` to fail loud on drift.

### WR-06: `_PROFILE_BIAS_DIMS` shape check uses `console.warn`, not `expect`
- **File:** `src/__tests__/fixtures/primed-sanity-m010.test.ts:67-72`
- **Issue:** If the `PROFILE_BIAS_KEYWORDS` constant gains/loses a key, this code emits a `console.warn` but does NOT fail the test. The warn happens at module load, NOT inside a test body, so vitest does not propagate it as a failure.
- **Impact:** Schema-drift detection is best-effort visual-grep, not enforced. A future refactor renaming `family` → `relationships` would warn-then-pass silently.
- **Fix:** Move the shape check inside a `describe` block as a real test:
  ```ts
  describe('PROFILE_BIAS_KEYWORDS shape', () => {
    it('has exactly the 4 expected dimension keys', () => {
      expect(_PROFILE_BIAS_DIMS).toEqual(['capital', 'family', 'health', 'jurisdictional']);
    });
  });
  ```

---

## Out-of-Scope Observations (NOT graded)

- **No tests mock the database** — confirmed compliant with the "never mock the database" rule. All integration tests use real Docker Postgres + `loadPrimedFixture`. The only mocks are `anthropic.messages.parse/create` and `logger.*`, both legitimate boundaries.
- **No hardcoded secrets, eval(), shell injection, or dangerous functions** detected in the reviewed files.
- **Test/prod boundary leaks:** `chat-ids.ts:34` allocates `BigInt(99922)` for the live test — namespace-isolated from production chat IDs per the existing convention; no leak.
- **Tolerance bounds:** M010 phase uses exact-match assertions (e.g., `toHaveBeenCalledTimes(4)`, `toHaveLength(4)`) — no fuzzy tolerance like the M011 `±0.8` ratings concern from the prompt. The PTEST-04 `entryCount < 10` boundary is empirically justified (`MIN_ENTRIES_THRESHOLD = 10` in confidence.ts is the SUT's actual constant).

---

*Reviewed: 2026-05-14*
*Reviewer: Claude (gsd-code-reviewer, opus-4.7-1m)*
*Depth: standard*
