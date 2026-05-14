---
phase: 40-psychological-milestone-tests
reviewed_at: 2026-05-14
files_reviewed: 9
blocker_count: 5
warning_count: 7
---

# Phase 40: Code Review Report

**Reviewed:** 2026-05-14
**Depth:** standard
**Status:** issues_found

## Summary

Reviewed 9 source files spanning the M011 fixture pipeline (`scripts/synthesize-delta.ts`, `scripts/regenerate-primed.ts`), HARN sanity gate, two integration tests, the live PMT-06 anti-hallucination gate, the `seedPsychProfileRows` helper, the bias-keyword unit test, and the `chat-ids` registry.

Plan 40-01's structural defenses (PASS-THROUGH spy, three-way `skipIf`, single-source-of-truth bias constants, scoped `profile_history` wipe, INVERSE-OF-M010 docblock) are present and load-bearing. However, **the M011 sparse-fixture pipeline is broken end-to-end**: the operator regen command produces a directory name that the test files cannot resolve, and even if the directory naming is patched, the substrate gate cannot fail closed because the calendar-month window catches >5,000 organic April words regardless of `--target-days`. The HARN gate likewise reads a global word count that diverges from the per-window substrate count. The three known v2.6.1 tech-debt items all have concrete root causes in `scripts/synthesize-delta.ts` (see §Tech-Debt Root Causes at bottom).

Files reviewed:
- `scripts/synthesize-delta.ts` (modified — Plan 40-01 Task 1)
- `scripts/regenerate-primed.ts` (pass-through pluming)
- `src/__tests__/fixtures/primed-sanity-m011.test.ts` (HARN)
- `src/memory/profiles/__tests__/integration-m011-1000words.test.ts` (PMT-03)
- `src/memory/profiles/__tests__/integration-m011-30days.test.ts` (PMT-04 + PMT-05)
- `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` (PMT-06)
- `src/__tests__/fixtures/seed-psych-profile-rows.ts` (helper)
- `src/__tests__/fixtures/chat-ids.ts` (registry)
- `scripts/__tests__/synthesize-delta-psych-profile-bias.test.ts` (unit)

## Blockers

### BL-01: Sparse-fixture regen command produces wrong output directory (m011-1000words → m011-1000words-5days)
- **File:** `scripts/synthesize-delta.ts:937`
- **Issue:** The output directory is computed as `${opts.milestone}-${opts.targetDays}days`. The operator regen command in `deferred-items.md:27-29` is `--milestone m011-1000words --target-days 5`, which produces directory name `m011-1000words-5days`. But every test file (`primed-sanity-m011.test.ts:164`, `integration-m011-1000words.test.ts:124`, `live-psych-anti-hallucination.test.ts:49` indirectly, `seed-psych-profile-rows.ts` consumers) checks `tests/fixtures/primed/m011-1000words/MANIFEST.json` — no `-5days` suffix. The fixtures currently committed sit at the test-expected path only because somebody manually renamed (the `regenerate-primed.ts:291` `primedName` log also says `m011-1000words-5days`). On fresh operator regen, the test suite cannot find the fixture and defaults to silent skip.
- **Impact:** PMT-03 silently skips on every operator re-run. The "sandbox-skip-clean" pattern hides the failure — `deferred-items.md:59-66` actively documents this as the *intended* path, but the regen instructions don't match the read path. M011-1000words PMT-03 never runs.
- **Fix:** Either (a) change the milestone arg to plain `m011-1000words` and update the output dir to use the milestone-as-is when it ends in non-numeric (drop the `-Ndays` suffix), or (b) update all test FIXTURE_PATH constants to `tests/fixtures/primed/m011-1000words-5days/MANIFEST.json`. Option (b) is the minimal-risk fix:
  ```typescript
  const FIXTURE_NAME = 'm011-1000words-5days'; // matches synthesize-delta.ts:937 naming
  ```
  Also update `deferred-items.md:31-32` and the operator regen log in `regenerate-primed.ts:304`.

### BL-02: Sparse-fixture word-count gate cannot fail closed — synthDaysNeeded clamps to 0
- **File:** `scripts/synthesize-delta.ts:834`
- **Issue:** `synthDaysNeeded = Math.max(0, opts.targetDays - uniqueOrganicDates.length)`. The organic prod-snapshot already carries ~14 days. With `--target-days 5` (m011-1000words), `synthDaysNeeded = max(0, 5 - 14) = 0` → NO synthetic days are emitted → the fixture is just the organic snapshot verbatim. Empirically the committed `m011-1000words/pensieve_entries.jsonl` has 187 entries / 10,640 telegram words (verified by counting). The HARN gate asserts `< 5000` (`primed-sanity-m011.test.ts:188`) — would FAIL when fixtures present.
- **Impact:** It is structurally impossible for `synthesize-delta.ts` to produce a fixture sparser than the organic snapshot. The "sparse fixture" branch of PMT-03 is untestable as designed. The fact that the committed fixture passes review is because fixtures are absent in the sandbox (skip path) — when operator regenerates locally, HARN trips immediately, hiding the actual PMT-03 contract.
- **Fix:** Add an explicit sparse-mode flag (e.g., `--max-pensieve-words N`) that down-samples `organicPensieve` BEFORE fusion. Alternatively: when `opts.targetDays < uniqueOrganicDates.length`, truncate organic to the most-recent `opts.targetDays` worth of dates. Today's clamp-to-zero is the silent foot-gun.

### BL-03: PMT-03 substrate-load assertion contradicts fixture date span — `belowThreshold` will be FALSE on regen
- **File:** `src/memory/profiles/__tests__/integration-m011-1000words.test.ts:147,187-188`
- **Issue:** `NOW = 2026-05-01` → substrate window = previous calendar month = April 2026. The committed m011-1000words fixture has 170 entries / 9,834 words in April 2026 (verified by date histogram). `MIN_SPEECH_WORDS = 5000`. Therefore `loadPsychologicalSubstrate('hexaco', NOW).belowThreshold === false`, not `true`. The test would fail at line 187: `expect(hexacoSubstrate.belowThreshold).toBe(true)`.
- **Impact:** PMT-03 contract assertion (zero Sonnet calls on below-threshold) cannot pass with the current fixture + NOW pairing. Combined with BL-02, the sparse fixture cannot exist at this date anchor.
- **Fix:** Anchor `NOW` outside the fixture's organic span. The organic snapshot in this checkout reaches into April 2026; pick `NOW = 2027-01-01` (or another date whose previous-month window is empty) so the substrate window catches the synthetic emptiness rather than organic April data. Alternative: filter `organicPensieve` by date when building m011-1000words (see BL-02 fix proposal).

### BL-04: PMT-05 Cycle 2 fallback uses Drizzle insert that produces NULL chat_id — pensieve_entries `chat_id` semantics regression
- **File:** `src/memory/profiles/__tests__/integration-m011-30days.test.ts:464-471, 516-523`
- **Issue:** Both fallback INSERTs construct rows with `{ content, epistemicTag, source, createdAt }` only. The `pensieve_entries` schema (`src/db/schema.ts:120-136`) does NOT declare a `chat_id` column (verified) so this is fine at the schema level. HOWEVER, the substrate filter at `psychological-shared.ts:264` does not filter by `chat_id` either. The real correctness issue is different: the Cycle 2 fallback inserts **only fires when `hexacoSub_c2.belowThreshold === true`**. The expected path is "identical substrate" (PGEN-06 UNCONDITIONAL FIRE). When the fixture happens to have May entries (committed fixture has 92 entries / 4,115 words in May 2026), `hexacoSub_c2.belowThreshold === false` → the fallback DOES NOT FIRE → Cycle 2 substrate is *different* from Cycle 1's April window (~9,834 words) and *different* from May identity. The "identical substrate" contract is silently violated, but the call-count assertion still passes because PGEN-06 fires unconditionally — masking the contract slip.
- **Impact:** PMT-05 D-24 INVERSE docblock claims "identical substrate, NOT 2 → 4 cumulative calls". But the substrate is NOT identical between cycles because the calendar window scrolls and captures different fixture entries. The assertion succeeds for the wrong reason; a future refactor that adds hash-skip would also pass (different substrate → different hash → no skip anyway) and the regression detector silently goes dark.
- **Fix:** Either explicitly INSERT the same content into both April + May windows before Cycle 1, OR re-pin both NOW_C1 and NOW_C2 to the same calendar month with one cycle directly mutating the pensieve table between them. Document that the Cycle 2 substrate IS new content (not identical) and adjust the docblock — or make it genuinely identical by inserting AND removing rows between cycles.

### BL-05: HARN gate counts global telegram pensieve, NOT the substrate-window slice — gate is non-load-bearing
- **File:** `src/__tests__/fixtures/primed-sanity-m011.test.ts:89-100`
- **Issue:** `totalTelegramWordCount()` runs `SELECT SUM(...) FROM pensieve_entries WHERE source='telegram' AND deleted_at IS NULL` — NO `created_at` filter. But `loadPsychologicalSubstrate` filters to the previous-calendar-month window in Europe/Paris (`psychological-shared.ts:251-272`). Empirically m011-30days has 16,325 total telegram words but only 9,834 in April 2026 and 4,115 in May 2026. HARN passes (16,325 > 5,000) even if every dated window the integration tests use is below-threshold. The Pitfall §7 signal-phrase check also runs against unfiltered content — phrases retained in June entries would satisfy HARN even though they're invisible to a May-window substrate load.
- **Impact:** HARN's stated load-bearing role ("fails LOUD before integration tests run") is structurally weakened. A fixture can pass HARN and silently fail integration. The Pitfall §7 signal-erasure detection class is degraded.
- **Fix:** Mirror the substrate loader's window:
  ```sql
  WHERE source='telegram' AND deleted_at IS NULL
    AND created_at >= <previousMonthStart>
    AND created_at <= <previousMonthEnd>
  ```
  And drive the HARN test from a pinned NOW that matches each integration test's NOW. Or: run HARN against multiple NOW anchors covering the rolling-window paths each downstream test exercises.

## Warnings

### WR-01: Threshold-gate edge case at exactly `wordCount === 5000`
- **File:** `src/__tests__/fixtures/primed-sanity-m011.test.ts:141, 188`
- **Issue:** HARN m011-30days asserts `> 5000` (strict). HARN m011-1000words asserts `< 5000` (strict). Substrate gate at `psychological-shared.ts:284` is `wordCount < MIN_SPEECH_WORDS` → `5000` is treated as ABOVE threshold. A fixture sitting at exactly 5,000 words fails populated HARN (`5000 > 5000` is false) but is loaded above-threshold by substrate → integration test runs but populated HARN trip-wire is dark. Inverse hole: a 5,000-word fixture passes sparse HARN (`5000 < 5000` is false → assertion FAILS) — but the sparse case at 5,000 is the most dangerous edge.
- **Fix:** Use `>=` for populated and `<` for sparse to align with substrate semantics: `wordCount >= MIN_SPEECH_WORDS` (populated), `wordCount < MIN_SPEECH_WORDS` (sparse). Also extract `MIN_SPEECH_WORDS` (5000) into a shared constant referenced from both files — magic-number duplication today.

### WR-02: Drizzle `db.execute` row extraction is driver-fragile
- **File:** `src/__tests__/fixtures/primed-sanity-m011.test.ts:97-99, 110-111`
- **Issue:** `const first = Array.isArray(rows) ? rows[0] : (rows as { 0?: unknown })[0];` — branches on whether the result is array-shaped. Drizzle node-postgres driver returns `{ rows: T[], ... }` (a result envelope), not a plain array. Both branches use index `[0]`; on the non-array path the cast lies (envelope-keyed `0` is undefined → fallback `?? 0` always fires). Probably masks a NaN-on-failure path silently.
- **Fix:** Use the documented Drizzle pattern — `db.execute<{ word_count: number }>(sql\`...\`)` returns an array of rows on neon/postgres-js drivers; use `.rows` for pg/postgres.js wrappers. Verify by logging the actual return shape in this codebase and pick one accessor.

### WR-03: PMT-05 Cycle 2 fallback insert relies on absent `hexacoSub_c2.belowThreshold` only — schwartz path is not checked
- **File:** `src/memory/profiles/__tests__/integration-m011-30days.test.ts:453, 474-481`
- **Issue:** The fallback fires only when `hexacoSub_c2.belowThreshold === true`. Then both `hexacoSub_c2_v2` and `schwartzSub_c2_v2` are re-loaded, but the trigger predicate only inspects hexaco. If `schwartzSub_c2.belowThreshold === true` while hexaco is false (corpus query is the same — but Schwartz `prevHistorySnapshot` is profile-type-specific; no real divergence today), the fallback won't fire. Even today, the asymmetry is a footgun.
- **Fix:** Trigger when `hexacoSub_c2.belowThreshold || schwartzSub_c2.belowThreshold`. Or simpler: always insert the May-window content and skip the conditional dance.

### WR-04: `synthesize-delta.ts` JSONL-write uses `bigintReplacer` but pensieve fields are never BigInt — dead path; risk of silent data drift if schema adds chat_id later
- **File:** `scripts/synthesize-delta.ts:513-524, 968-971`
- **Issue:** `bigintReplacer` serializes any `bigint` as `.toString()`. None of the current synthesized objects contain BigInt values — all numeric IDs are `string` UUIDs. If a future schema migration adds a `chat_id: bigint` to pensieve and synthesize-delta starts emitting BigInts, those will land in the JSONL as bare strings and `jsonb_populate_recordset(... NULL::pensieve_entries, $1::jsonb)` will reject the row (text into bigint column). Silent type coercion at the JSONL boundary; no test catches it.
- **Fix:** Either declare numeric fields explicitly in a typed serializer or add a runtime check that BigInt-shaped values get an explicit numeric round-trip path via `Number()` where safe.

### WR-05: `cachedMessagesParse` shape coupling — `parsed_output` access is unguarded
- **File:** `scripts/synthesize-delta.ts:882-891`
- **Issue:** `const parsed = (response as unknown as { parsed_output: HaikuSyntheticDay }).parsed_output;` — double-cast through `unknown` masks any shape drift. `safeParse` follows, so the validation is OK at runtime, but the error message at line 889 doesn't include the actual Zod issues. If Haiku returns malformed JSON (Anthropic SDK shape change, or VCR cache mis-record), debugging requires log-by-print to recover.
- **Fix:** Forward `ok.error.issues` into the thrown message:
  ```typescript
  throw new Error(
    `synthesize-delta: Haiku response for ${dayDateStr} failed schema validation: ${JSON.stringify(ok.error.issues)}`,
  );
  ```

### WR-06: Live PMT-06 spy ordering — `spy.mock.calls[0]` always reads the FIRST anthropic call, but `handleReflect` may make multiple
- **File:** `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts:168, 195-198`
- **Issue:** The spy is created fresh per iteration AFTER `beforeAll`'s `updateAllPsychologicalProfiles()`. Inside the iteration body, `handleReflect` may internally call `anthropic.messages.create` multiple times (e.g., date-extraction sub-call, retry path, future tool-use). `spy.mock.calls[0][0].system[0].text` reads the FIRST call only — which may not be the REFLECT system prompt the assertions target. Today `handleReflect` makes one call (line 102 of `reflect.ts`); if future refactors add a pre-flight call, the header/footer assertions silently target the wrong prompt.
- **Fix:** Scan all calls and find the one whose system prompt matches the REFLECT shape:
  ```typescript
  const reflectCall = spy.mock.calls.find(c => /* match REFLECT-mode marker */);
  const systemText = (reflectCall?.[0] as any)?.system?.[0]?.text ?? '';
  ```

### WR-07: Defense-in-depth `if (!process.env.RUN_LIVE_TESTS …) return;` inside `beforeAll` is unreachable in vitest 1.x — gives false sense of safety
- **File:** `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts:123-156`
- **Issue:** When `describe.skipIf(...)` is true (any of the three gates false), vitest skips the entire suite including `beforeAll`. The "Pitfall 6 belt-and-suspenders" early-return only matters if vitest changes semantics, but the FIXTURE_PRESENT variable is captured at module load — if `describe.skipIf` honors only env vars and not the closure constant, the conditional check works. But the same `FIXTURE_PRESENT` is the closure value at line 129; that's not actually independent insurance. The "two-stage gate" is one stage in practice.
- **Fix:** Either remove the early-return (it's no-op insurance) or genuinely re-derive: `if (!existsSync(FIXTURE_PATH)) return;` — re-stat at beforeAll time so fixture-deleted-between-load-and-run cases trip the gate. Today's code only feels safer, doesn't add a new check.

## Tech-Debt Root Causes (v2.6.1 booked items)

**Tech-Debt #1 — Loader word-count gap (m011-30days raw→PG 3x loss):**
- **Root cause:** `src/__tests__/fixtures/primed-sanity-m011.test.ts:89-100` counts global telegram pensieve, but `src/memory/profiles/psychological-shared.ts:259-273` filters by previous-calendar-month window. Verified data: m011-30days raw = 16,325 words; April-window slice = 9,834 words; May-window slice = 4,115; June-window = 2,376. The "3x loss" raw→PG is the calendar-month filter, not a load corruption. See BL-05 for the fix.

**Tech-Debt #2 — m011-1000words contradictions FK violation:**
- **Root cause:** `scripts/synthesize-delta.ts:683-690` (fallback to fresh `deterministicUuid` when `syntheticPensieve.length < 2`) combined with `scripts/synthesize-delta.ts:934` (`fusedContradictions = [...organicContradictions, ...synthContradictions]`). When `synthDaysNeeded === 0` (sparse path; see BL-02), `syntheticPensieve` is empty so `generateSyntheticContradictions` emits 3 rows whose `entry_a_id`/`entry_b_id` reference UUIDs that do not exist in `fusedPensieve`. The fix is a pre-filter at line 934:
  ```typescript
  const pensieveIds = new Set(fusedPensieve.map(p => String(p.id)));
  const fusedContradictions = [...organicContradictions, ...synthContradictions]
    .filter(c => pensieveIds.has(String(c.entry_a_id)) && pensieveIds.has(String(c.entry_b_id)));
  ```
  Today's workaround (empty committed `contradictions.jsonl`) is post-hoc and undocumented.

**Tech-Debt #3 — PMT-01 `--psych-profile-bias` flag + HARN gate:**
- **Root cause (bias prompt):** `scripts/synthesize-delta.ts:584-594` — `phrasesClause` is only appended when `dimensionHint` is also truthy (the if-block at line 588). If `psychEnabled === true` but `dimensionHint` happened to be `undefined` (today impossible because `psychDimensionHintFor(d, true)` always returns; in future if precedence rules change, this becomes a silent regression), the signal phrases are dropped — defeating Pitfall §7 mitigation. Recommend an explicit `if (phrasesClause)` branch independent of `dimensionHint`.
- **Root cause (HARN gate predicate edge case):** `src/__tests__/fixtures/primed-sanity-m011.test.ts:141, 188` strict-inequality predicates `> 5000` / `< 5000` create a 1-word gap at exactly `MIN_SPEECH_WORDS` where HARN and substrate disagree — see WR-01 and the substrate-window divergence in BL-05.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
