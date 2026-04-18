---
phase: 18-synthetic-fixture-live-accountability-integration-suite
reviewed: 2026-04-17T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/decisions/__tests__/synthetic-fixture.test.ts
  - src/decisions/__tests__/live-accountability.test.ts
  - src/decisions/__tests__/vague-validator-live.test.ts
  - src/decisions/vague-validator.ts
  - src/llm/client.ts
  - src/llm/prompts.ts
  - src/pensieve/retrieve.ts
findings:
  critical: 0
  warning: 5
  info: 6
  total: 11
status: issues_found
---

# Phase 18: Code Review Report

**Reviewed:** 2026-04-17
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 18 delivers synthetic fixture tests (TEST-10/11/12), live ACCOUNTABILITY
+ vague-validator tests (TEST-13/14), and restores five prompts plus `callLLM`
and `getTemporalPensieve`. Overall engineering is solid: clock management
follows the D-02 `vi.setSystemTime`-only rule, hoisted mocks respect the real
import graph, live tests gate on `ANTHROPIC_API_KEY` via `describe.skipIf`, and
the restored prompts match canonical text verbatim (no drift).

Five warnings and six info items surfaced. The most impactful are test-isolation
concerns: global `pensieve_entries WHERE source='telegram'` deletes in three
test files cross-contaminate under vitest's default parallel file execution,
and TEST-14 Turn 2 is structurally unable to distinguish "pushback accepted"
from "silent commit" because both paths produce a non-empty string. The
`callLLM` doc comment claims "empty string on failure" but exceptions actually
propagate, creating a doc/behavior mismatch that can silently break fail-soft
contracts in callers who trust the docstring. Everything else is style,
redundancy, or hardening opportunity; no Critical severity issues identified.

## Warnings

### WR-01: Global `pensieve_entries source='telegram'` cleanup races across parallel test files

**Files:**
- `src/decisions/__tests__/synthetic-fixture.test.ts:283`
- `src/decisions/__tests__/live-accountability.test.ts:126-131`
- `src/decisions/__tests__/vague-validator-live.test.ts:112`

**Issue:** `vitest.config.ts` does not set a pool config, so vitest runs test
files in parallel by default. Three Phase 18 test files each delete
`pensieve_entries WHERE source='telegram'` as their global cleanup — this
deletes rows written by any sibling test file running against the same
database. In particular `cleanupIteration` in TEST-13 runs after every
iteration (nine times total), and each call nukes any `telegram` pensieve
rows another suite just inserted but has not yet asserted on. Intermittent
failures are expected as suites are added.

**Fix:** Either (a) tag rows with a per-suite prefix on `source` (e.g.,
`telegram:test10`, `telegram:test13`) and scope deletes by prefix, or
(b) constrain parallelism in vitest config:
```ts
// vitest.config.ts
export default defineConfig({
  test: {
    // ... existing ...
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
```

### WR-02: TEST-14 Turn-2 assertion cannot fail unless `handleCapture` throws

**File:** `src/decisions/__tests__/vague-validator-live.test.ts:166-175`

**Issue:** Turn 2 asserts `turn2Response.length > 0` and
`statuses.some(s => s === 'open' || s === 'open-draft')`. But Turn 1's
pushback also has length > 0, and a decision row is committed by Turn 2
regardless of whether it takes the "second-vague landing" path (`open-draft`)
or the normal commit path (`open`). The OR on both statuses covers every
reachable outcome, so the test proves nothing beyond "the code did not
throw". The intent per D-14 is "exactly one pushback before accepting" —
that invariant is not being asserted.

**Fix:** Assert that Turn 2 response is NOT the pushback string and check
the row count went from 0 → 1 between Turn 1 and Turn 2:
```ts
const preRows = await db.select().from(decisions).where(eq(decisions.chatId, TEST_CHAT_ID));
expect(preRows.length).toBe(0); // no row after Turn 1 pushback
const turn2Response = await handleCapture(TEST_CHAT_ID, "still feels like it'll work out");
expect(turn2Response).not.toBe(buildVaguePushback('en'));
const postRows = await db.select().from(decisions).where(eq(decisions.chatId, TEST_CHAT_ID));
expect(postRows.length).toBe(1); // committed on Turn 2
```

### WR-03: `callLLM` docstring lies about failure semantics

**File:** `src/llm/client.ts:13-30`

**Issue:** Comment states "Returns the first text block content as a string,
or empty string on failure." The implementation has no try/catch — SDK
exceptions (rate limit, 5xx, network) propagate to the caller. Callers who
rely on this contract (e.g., a fail-soft path that does `if (!raw) return
defaultVerdict`) will instead surface an uncaught rejection.
`validateVagueness` gets away with it because it wraps in try/catch, but
any future caller reading the doc will be misled.

**Fix:** Either catch and return `''` to match the documented contract,
or update the docstring to say errors propagate:
```ts
/**
 * Haiku call with system prompt + user content.
 * Returns the first text block, or '' if the response has no text block.
 * Throws on SDK errors (rate limit, network, 4xx/5xx) — callers must handle.
 */
```

### WR-04: `stripFences` only strips balanced fences at absolute string edges

**File:** `src/decisions/vague-validator.ts:76-78`

**Issue:** Regex `/^\`\`\`(?:json)?\s*/i` requires the fence at offset 0 and
`/\`\`\`\s*$/` requires it at the end. If Haiku returns stray prose before or
after the JSON (e.g., "Here's the answer:\n\`\`\`json\n{...}\n\`\`\`\nHope that
helps."), stripping leaves the prose in place, `JSON.parse` throws, and the
validator silently fail-softs to `'acceptable'` — the exact failure mode the
15s timeout bump was designed to prevent. With `temperature=0` this is
unlikely on Haiku, but the fail-soft path eats the signal either way so
regressions won't be noticed.

**Fix:** Extract the first `{...}` span defensively:
```ts
function stripFences(s: string): string {
  const match = s.match(/\{[\s\S]*\}/);
  return match ? match[0] : s.trim();
}
```
and log at `warn` (not `info`) when JSON.parse fails so fail-soft events are
observable.

### WR-05: TEST-10 `afterEach` does not drain `.mockResolvedValueOnce` queues on early failure

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:302-307`

**Issue:** TEST-10 queues four one-shot Sonnet/Haiku responses via
`.mockResolvedValueOnce`. `afterEach` calls `vi.clearAllMocks()` which
resets call history but does NOT drain unused `.mockResolvedValueOnce`
queues (this is the exact footgun noted in TEST-12's `vi.resetAllMocks()`
comment at line 519). If the TEST-10 assertion at day 7 fails, the three
later queued responses leak forward. TEST-11 doesn't touch
`mockAnthropicCreate`, so the leak is currently invisible — but any future
test added between TEST-10 and TEST-11 that hits `mockAnthropicCreate`
will get stale queued values.

**Fix:** Use `vi.resetAllMocks()` in TEST-10's afterEach (same fix TEST-12
already applies):
```ts
afterEach(async () => {
  vi.useRealTimers();
  vi.resetAllMocks();   // was: vi.clearAllMocks()
  await cleanup();
  clearLanguageState(TEST_CHAT_ID.toString());
});
```

## Info

### IN-01: `cleanup()` passes subquery to `inArray` without explicit SQL chunking guard

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:270-275`

Drizzle's `inArray(col, selectBuilder)` produces a correlated subquery and
works fine here, but a reader unfamiliar with Drizzle might think it
materializes IDs in memory. A brief comment saying "correlated subquery, no
round-trip" would save future readers five minutes.

### IN-02: `seedDecision` default `resolveBy` mixes `Date.now()` with `vi.setSystemTime`

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:254`

Default `resolveBy` uses `new Date(Date.now() + DAY_MS)`. Since
`vi.setSystemTime` hooks `Date.now`, this works today, but TEST-10 always
passes explicit `resolveBy`, and TEST-11 seeds `'due'` status without
relying on the default. The default is effectively dead. Either remove the
default (force callers to be explicit) or leave a comment noting
`Date.now()` is clock-mocked.

### IN-03: `TEST_CHAT_ID = 99918/99919/99920` convention unenforced

**Files:** All three `__tests__/*.test.ts` files

Per-file unique chat IDs avoid cleanup collisions, but the numeric
convention (`9991X`) is informal. If a new test file picks an arbitrary ID
that collides with an existing one, intermittent cross-test failures will
result. Consider centralizing test chat IDs in a single
`src/__tests__/fixtures/chat-ids.ts` module.

### IN-04: Live-test `temperature: 0` + 3x loop measures determinism, not robustness

**File:** `src/decisions/__tests__/live-accountability.test.ts:161-262`

All three scenarios loop `i < 3` with `temperature: 0` on both Sonnet and
Haiku. Anthropic's `temperature=0` is near-deterministic but not formally
guaranteed to be bit-reproducible across API versions. If the goal was
statistical sampling (catch flakes), use `temperature: 0.3` for three runs.
If the goal was "pin behavior", one run is enough. The current setup
roughly does both imperfectly. Document intent in a file-level comment.

### IN-05: `DAY_MS` magic number duplicated

**Files:**
- `src/decisions/__tests__/synthetic-fixture.test.ts:228`
- `src/decisions/__tests__/vague-validator-live.test.ts:148`

`86_400_000` and `30 * 86_400_000` appear in multiple files. Extract to a
shared `src/__tests__/fixtures/time.ts` or reuse a constant from a
production module.

### IN-06: `FAKE_DECISION_ID = 'test-decision-uuid-for-test-12'` is not a valid UUID

**File:** `src/decisions/__tests__/synthetic-fixture.test.ts:559`

The ID is never written to a column with `uuid` type in TEST-12 because
`upsertAwaitingResolution` is mocked. Today this is fine. If the mock is
ever removed or tightened (e.g., the function starts validating the string
shape), the test will start failing with a cryptic Postgres error. Using
`crypto.randomUUID()` costs nothing and future-proofs.

---

_Reviewed: 2026-04-17_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
