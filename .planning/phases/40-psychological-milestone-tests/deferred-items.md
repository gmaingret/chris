# Phase 40 — Deferred Items

## Plan 40-01 Task 3: m011 fixture regeneration (DEFERRED-FOR-OPERATOR)

**Status:** Deferred from Plan 40-01 execution (sandbox limitation).

**Why deferred:** Plan 40-01 Task 3 requires real Anthropic API calls to
Haiku for synthetic-entry generation. This sandbox has `ANTHROPIC_API_KEY`
set in env but the key returns `401 invalid x-api-key` on any real call
(confirmed pre-existing pattern in Phase 37/38 deferred-items.md — these
sandbox 401s are unrelated to the M011 code path because Plan 40-01 mocks
the SDK in unit + integration tests).

**Spend estimate:** ~$0.10-0.15 combined first run (~30 Haiku calls for
m011-30days + ~5 for m011-1000words; VCR cache makes subsequent runs free).
Per CONTEXT.md D-08.

**Operator regen commands (run locally with valid ANTHROPIC_API_KEY):**

```bash
# Generate m011-30days (~30 Haiku calls, ~$0.10 first run; D-09)
cd /home/claude/chris && npx tsx scripts/regenerate-primed.ts \
  --milestone m011 --target-days 30 \
  --psych-profile-bias --force --seed 42

# Generate m011-1000words (~5 Haiku calls, ~$0.02 first run; D-12)
cd /home/claude/chris && npx tsx scripts/regenerate-primed.ts \
  --milestone m011-1000words --target-days 5 \
  --psych-profile-bias --force --seed 42

# Verify both fixtures present + correct word-count band
ls tests/fixtures/primed/m011-30days/MANIFEST.json \
   tests/fixtures/primed/m011-1000words/MANIFEST.json
wc -l tests/fixtures/primed/m011-30days/pensieve_entries.jsonl \
      tests/fixtures/primed/m011-1000words/pensieve_entries.jsonl
```

Expected: both MANIFEST.json files exist; m011-30days has ~90 entries
(30 days × 3 entries/day, ~6,000 telegram words target per D-10);
m011-1000words has ~15 entries (5 days × 3, ~1,000 words target per D-12).

**Investigation triggers (if HARN gate at Task 4 fails after operator regen):**

- **m011-30days HARN fails on `wordCount > 5000`:** entries too short.
  Increase `ENTRIES_PER_DAY` in `scripts/synthesize-delta.ts` (currently 3),
  or extend `--target-days 32`, re-run, re-confirm via `wc -l`.
- **m011-30days HARN fails on `OPENNESS_SIGNAL_PHRASES` presence
  (Pitfall §7 load-bearing failure mode):** Haiku style-transfer erased
  the designed signature. Tune `PSYCH_PROFILE_BIAS_KEYWORDS` in
  `scripts/synthesize-delta.ts` to add more explicit Openness phrases
  (consider adding literal copies of OPENNESS_SIGNAL_PHRASES candidates
  as keyword nudges). Re-run regen with `--force --reseed-vcr`. If after
  2 tuning iterations signal still doesn't retain, defer to v2.6.1 (hand-
  crafted entries per Pitfall 10 PITFALLS.md:359-365).
- **m011-1000words HARN fails on `wordCount < 5000`:** synth determinism
  drifted up. Reduce `--target-days 4` or trim ENTRIES_PER_DAY for the
  1000words branch.

**Sandbox-skip behavior:** All test files created by Plan 40-01 Tasks 4-6
use the canonical `FIXTURE_PRESENT = existsSync(<MANIFEST.json>)` gate +
`describe.skipIf(!FIXTURE_PRESENT)`. In this sandbox, fixtures are absent
→ all three test files default-skip cleanly with a stdout regen-instruction
log. This is the intended pattern from Phase 36's primed-sanity-m010
tests (P-36-01 mitigation). On a fresh checkout, operator runs the regen
commands above before exercising the full Phase 40 integration suite.

## Plan 40-02 Task 2: live PMT-06 anti-trait-authority test (DEFERRED-FOR-OPERATOR)

**Status:** Deferred — Plan 40-02 ships in Wave 2 (depends_on 40-01),
not in Plan 40-01's scope. Documented here for milestone-close handoff.

**Why deferred:** PMT-06 hits live Anthropic Sonnet 4.6 with 3 iterations
(~$0.20-0.30 per run; D-32 / D046). Same sandbox 401 constraint as Task 3.

**Operator invocation command (run locally at milestone close):**

```bash
cd /home/claude/chris && RUN_LIVE_TESTS=1 \
  ANTHROPIC_API_KEY=<valid_key> \
  bash scripts/test.sh \
    src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts
```

Per CONTEXT.md D-46 / D-45: three-way `describe.skipIf` gates default-skip
the test when RUN_LIVE_TESTS, ANTHROPIC_API_KEY, or fixture is absent.

## Pre-existing live-API test failures (out of scope for Plan 40-01)

While running `bash scripts/test.sh` after Plan 40-01 Tasks 1-6 completed
successfully, the full Docker suite reports a small number of pre-existing
failing test files. **All failing files are pre-existing environment
failures unrelated to Plan 40-01 changes** — they call the real Anthropic
API with `invalid x-api-key` 401 errors:

  - `src/chris/__tests__/live-integration.test.ts`
  - `src/decisions/__tests__/live-accountability.test.ts`
  - `src/decisions/__tests__/vague-validator-live.test.ts`
  - `src/episodic/__tests__/live-anti-flattery.test.ts`
  - `src/llm/__tests__/models-smoke.test.ts`

These tests require a live Anthropic API key (the sandbox does not have
one configured). They are NOT exercised by Plan 40-01's code (the new
unit + integration tests mock the Anthropic SDK via
`vi.mock('../../../llm/client.js', ...)` or
`vi.mock('../../src/__tests__/fixtures/vcr.js', ...)`).

**Scope-boundary justification:** per executor deviation rules, only fixes
directly caused by the current task's changes are in scope. These failures
exist on the base commit (`df1f727 docs(40): create Phase 40 Psychological
Milestone Tests plan`) prior to Plan 40-01 execution; no Plan 40-01 commit
touches the files that fail.

**Plan 40-01 test surface that DOES pass:**
  - `scripts/__tests__/synthesize-delta-psych-profile-bias.test.ts` — 13/13
  - `scripts/__tests__/synthesize-delta-profile-bias.test.ts` — 21/21
    (M010 sibling, legacy parity verified)
  - `scripts/__tests__/synthesize-delta.test.ts` — base test green
  - Test files gated on m011 fixtures: default-skip cleanly when fixtures
    absent (sandbox + fresh-checkout case); operator regenerates locally
    to exercise.
