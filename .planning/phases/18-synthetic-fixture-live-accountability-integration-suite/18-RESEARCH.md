# Phase 18: Synthetic Fixture + Live ACCOUNTABILITY Integration Suite - Research

**Researched:** 2026-04-16
**Domain:** Vitest fake-time integration testing, optimistic concurrency races, live LLM behavioral assertion, multilingual vagueness detection
**Confidence:** HIGH — all findings verified against existing codebase; no speculative library choices

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Database interaction = real Postgres. All DB operations run against the real Docker Postgres instance. No DB mocking.
- **D-02:** Time control = `vi.setSystemTime` ONLY (not `vi.useFakeTimers`). `vi.setSystemTime` controls `Date.now()` and `new Date()` without faking `setTimeout`/`setInterval`, which would break the `pg` driver's internal timers and async I/O.
- **D-03:** LLM calls = fully mocked in the synthetic fixture (TEST-10/11/12). Real LLM behavior is tested separately in TEST-13/TEST-14.
- **D-04:** Structure = single sequential test function for the 14-day synthetic fixture.
- **D-05:** TEST-11 reuses established `concurrency.test.ts` pattern — real DB, `Promise.allSettled`, assert one winner and one `OptimisticConcurrencyError`. Phase 18 version races sweep-triggered transition against user-reply-triggered transition.
- **D-06:** TEST-12 tests decision-deadline and silence triggers both firing on the same mock-clock day, serializing through channel separation logic.
- **D-07:** ACCOUNTABILITY assertion mechanism = Haiku judge, classifying on `flattery: none|mild|strong` and `condemnation: none|mild|strong`. Both must be `none`.
- **D-08:** 3-of-3 reliability per D023 — each scenario runs 3 times, all 3 must pass.
- **D-09:** Scenario context = realistic personal decisions with emotional weight.
- **D-10:** API key gated with `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` per Phase 10 pattern.
- **D-11:** Language distribution = ~4 EN, 3 FR, 3 RU across 10 adversarial predictions.
- **D-12:** Adversarial style = hedged confidence — predictions that sound specific but dodge falsifiability.
- **D-13:** Haiku calls in TEST-14 = real Haiku (not mocked). Proves the actual validator prompt catches vague predictions.
- **D-14:** "Exactly one pushback before accepting" assertion: test simulates user re-submitting same vague text; validator accepts on second pass.
- **D-15:** 3 test files: `synthetic-fixture.test.ts` (TEST-10/11/12), `live-accountability.test.ts` (TEST-13), `vague-validator-live.test.ts` (TEST-14).
- **D-16:** All files live in `src/decisions/__tests__/`.

### Claude's Discretion

- Exact mock response shapes for canned Haiku/Sonnet calls in the synthetic fixture.
- Exact wording of the 10 adversarial vague predictions (within the hedged-confidence style and EN/FR/RU distribution).
- Exact realistic personal decision scenarios for TEST-13 (within the emotional-weight guideline).
- Haiku judge prompt wording for flattery/condemnation classification.
- Timeout values for live API calls.
- Whether TEST-11 and TEST-12 are separate `describe` blocks within synthetic-fixture.test.ts or interleaved.
- DB cleanup strategy (afterEach vs afterAll) within each test file.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

**Hard out-of-scope items (from domain section):**
- Production code changes — this phase writes tests only.
- New behavioral requirements — tests verify existing Phases 13-17 implementations.
- Performance benchmarks or load testing.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-10 | End-to-end `vi.setSystemTime` 14-day fixture: capture → deadline transition → resolution prompt → post-mortem → stats. No real calendar time. | `vi.setSystemTime` confirmed in existing `deadline.test.ts`; `resolution.test.ts` shows mock Anthropic pattern; `concurrency.test.ts` shows real DB seeding helper |
| TEST-11 | Concurrency race — sweep-triggered vs user-reply-triggered `due→resolved` transition; one `OptimisticConcurrencyError`, one winner, `decision_events` reflects both | `concurrency.test.ts` pattern is exactly this but with two identical `sweep` actors; Phase 18 adds distinct `sweep` vs `user` actors |
| TEST-12 | Same-day collision — decision-deadline and silence triggers both fire; channel separation (`reflective_outreach` vs `accountability_outreach`) fires both serially | `sweep-escalation.test.ts` shows mocked trigger pipeline; `SWEEP-02` channel separation already implemented in Phase 15 |
| TEST-13 | Live ACCOUNTABILITY suite: hit/miss/unverifiable × 3-of-3 against real Sonnet; Haiku judge asserts absence-of-flattery AND absence-of-condemnation | `live-integration.test.ts` is the exact template: `describe.skipIf`, 3-of-3 loop, Haiku follow-up judge pattern |
| TEST-14 | Vague-prediction resistance: 10 adversarial vague predictions, Haiku flags ≥9 on first pass, exactly one pushback before accepting | `vague-validator.test.ts` shows mock pattern; Phase 18 adds real-Haiku variant to prove the live prompt actually works |

</phase_requirements>

---

## Summary

Phase 18 is a pure test-writing phase. It creates three test files that prove the Phases 13-17 implementation is correct without waiting for real calendar time and without relying on non-deterministic LLM responses for lifecycle assertions.

The key insight is the **split testing strategy**: synthetic-fixture.test.ts uses real Postgres but mocked LLM calls to prove the time-based lifecycle pipeline end-to-end; live-accountability.test.ts and vague-validator-live.test.ts use real Haiku/Sonnet to prove the behavioral contracts that cannot be tested with mocks.

The entire test infrastructure already exists in the codebase. Phase 18 does not introduce new patterns — it assembles existing patterns (`vi.setSystemTime`, `describe.skipIf`, `Promise.allSettled`, Haiku judge, `seedDecision` helper, `mockAnthropicCreate`) into three new files targeting new integration scenarios.

**Primary recommendation:** Every test in this phase has a canonical ancestor file. Start by copying the ancestor structure, then adapt the scenario. Do not invent new patterns.

---

## Standard Stack

### Core (all already in project)
| Library | Version | Purpose | Confirmed In |
|---------|---------|---------|--------------|
| vitest | 4.1.2 | Test runner, fake timers, mocking | `package.json` [VERIFIED: npm view] |
| drizzle-orm | 0.45.2 | DB queries in tests | All existing test files [VERIFIED: codebase] |
| @anthropic-ai/sdk | ^0.80.0 | Real API calls for TEST-13/14 | `package.json` [VERIFIED: codebase] |
| postgres | ^3.4.5 | Real Postgres driver for integration tests | `scripts/test.sh` [VERIFIED: codebase] |

### No New Dependencies

Phase 18 requires zero new npm installs. All tools are already in `devDependencies` or `dependencies`. [VERIFIED: package.json]

---

## Architecture Patterns

### Verified Pattern 1: `vi.setSystemTime` with real DB (D-02 decision)

`vi.useFakeTimers` must NOT be used because it replaces `setTimeout`/`setInterval` globally, which breaks the `pg` (postgres.js) driver's connection keepalive timers and can cause query timeouts or connection pool starvation during the test.

`vi.setSystemTime` only overrides `Date.now()` and `new Date()`. It does NOT intercept timers. The correct pattern for this phase is:

```typescript
// Source: src/proactive/__tests__/deadline.test.ts (VERIFIED: codebase)
beforeEach(() => {
  vi.setSystemTime(new Date('2026-04-16T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();  // required even when only setSystemTime was used
});
```

**For the 14-day synthetic fixture:** advance clock day-by-day by calling `vi.setSystemTime(new Date(...))` between steps. No need to restore in the middle — restore once in `afterEach`.

### Verified Pattern 2: `vi.hoisted` + `vi.mock` for Anthropic mock

The established pattern from `resolution.test.ts` is:

```typescript
// Source: src/decisions/__tests__/resolution.test.ts (VERIFIED: codebase)
const { mockAnthropicCreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate },
  },
  HAIKU_MODEL: 'test-haiku',
  SONNET_MODEL: 'test-sonnet',
  OPUS_MODEL: 'test-opus',
  callLLM: vi.fn().mockResolvedValue('{}'),
}));
```

`vi.hoisted` is required because `vi.mock` is hoisted by Vitest to the top of the file at compile time; variables declared in the module body are not yet initialized when the mock factory runs. `vi.hoisted` creates a closure that runs at hoist-time.

### Verified Pattern 3: `describe.skipIf` API-key gate

```typescript
// Source: src/chris/__tests__/live-integration.test.ts (VERIFIED: codebase)
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('Live ACCOUNTABILITY integration suite', () => {
  // ...
});
```

`scripts/test.sh` sets `ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}"` — meaning when running with a fake key, the `describe.skipIf` guard fires and the block is skipped without error. [VERIFIED: scripts/test.sh]

### Verified Pattern 4: 3-of-3 reliability loop

```typescript
// Source: src/chris/__tests__/live-integration.test.ts (VERIFIED: codebase)
it('scenario name', async () => {
  for (let i = 0; i < 3; i++) {
    const response = await processMessage(/* ... */);
    // assertions
    // cleanup between iterations
    await db.delete(conversations).where(eq(conversations.chatId, TEST_CHAT_ID));
  }
}, 90_000);  // increased timeout for 3 live API calls
```

The loop lives inside a single `it()` block. Cleanup between iterations prevents state bleed.

### Verified Pattern 5: Haiku judge follow-up classification

```typescript
// Source: src/chris/__tests__/live-integration.test.ts (VERIFIED: codebase)
async function haikuJudgeOnce(fact: string, response: string): Promise<boolean> {
  const result = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 300,
    temperature: 0,
    system: '...',
    messages: [{ role: 'user', content: `...` }],
  });
  // parse JSON from result.content[0].text
}
```

For Phase 18, the judge classifies on TWO axes simultaneously: `flattery` (none/mild/strong) and `condemnation` (none/mild/strong). The system prompt and JSON response schema are Claude's discretion (noted in D-07). The assertion is `flattery === 'none' && condemnation === 'none'`.

### Verified Pattern 6: `Promise.allSettled` concurrency race

```typescript
// Source: src/decisions/__tests__/concurrency.test.ts (VERIFIED: codebase)
const results = await Promise.allSettled([
  transitionDecision(id, 'open', 'due', { actor: 'sweep' }),
  transitionDecision(id, 'open', 'due', { actor: 'sweep' }),
]);

const fulfilled = results.filter(r => r.status === 'fulfilled');
const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

expect(fulfilled).toHaveLength(1);
expect(rejected).toHaveLength(1);
expect(rejected[0]!.reason).toBeInstanceOf(OptimisticConcurrencyError);
```

For Phase 18 (TEST-11), the two racers are `{ actor: 'sweep' }` and `{ actor: 'user' }` — different actors, same decision ID, same `fromStatus: 'due'`, same `toStatus: 'resolved'`.

### Verified Pattern 7: FK-safe cleanup ordering

Decision tables have foreign key dependencies. The safe deletion order (from existing tests) is:

1. `decisionEvents` (references `decisions`)
2. `decisions`
3. `decisionCaptureState` (has `decisionId` FK)
4. `pensieveEntries` (referenced from `decisionCaptureState` metadata, but FK is on `metadata.sourceRefId` which is JSONB, not a real constraint — safe to delete in any order)

[VERIFIED: resolution.test.ts, vague-validator.test.ts]

### Recommended Project Structure for Phase 18

```
src/decisions/__tests__/
├── synthetic-fixture.test.ts    # NEW — TEST-10, TEST-11, TEST-12
│                                #   real DB, mocked LLM, vi.setSystemTime
├── live-accountability.test.ts  # NEW — TEST-13
│                                #   real Sonnet, real DB, API-key gated
├── vague-validator-live.test.ts # NEW — TEST-14
│                                #   real Haiku, API-key gated
└── [existing files unchanged]
```

### Anti-Patterns to Avoid

- **`vi.useFakeTimers()` in synthetic-fixture.test.ts:** This replaces `setTimeout`/`setInterval`, breaking the postgres.js driver. Use `vi.setSystemTime()` only, per D-02.
- **Mocking `transitionDecision` in TEST-11:** The entire point of the concurrency race is that real Postgres serializes the two concurrent UPDATE-WHERE transactions. Mocking the function defeats the test.
- **Sharing a single `seedDecision` call across TEST-11 racers:** Each racer must call `transitionDecision` with the same `id` and same `fromStatus`. The seeded decision must be in the correct status before both racers run.
- **Forgetting `vi.useRealTimers()` in afterEach:** Even when only `vi.setSystemTime` was called, failing to reset leaves the clock at the fake time for subsequent tests in the file or in other files loaded in the same worker.
- **Running 3-of-3 live tests without cleanup between iterations:** State from iteration N bleeds into iteration N+1. The `concurrency.test.ts` and `resolution.test.ts` patterns both delete DB rows in `afterEach` — live tests must do the same within the loop body.
- **Using `Promise.all` instead of `Promise.allSettled` for the concurrency race:** `Promise.all` fails fast and throws on the first rejection, hiding the result of the winning call. `Promise.allSettled` captures both outcomes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fake time in tests | Custom date interceptor | `vi.setSystemTime` | Built into Vitest 4.x; already used in `deadline.test.ts` |
| LLM response mocking | Manual stub object | `vi.hoisted` + `vi.mock('../../llm/client.js', ...)` | Established pattern in 3 existing test files |
| Concurrency outcome capture | Custom Promise wrapper | `Promise.allSettled` | Returns all outcomes regardless of rejection |
| Haiku behavioral assertion | Manual keyword matching | Haiku judge call (same pattern as `live-integration.test.ts`) | Keyword matching fails on paraphrase; Haiku judge is semantic |
| DB seeding helper | Inline INSERT in each test | Extract `seedDecision()` function (already in `concurrency.test.ts`) | DRY; the helper is already proven |

**Key insight:** This phase is an assembly task, not an invention task. Every primitive needed already exists in the codebase.

---

## Common Pitfalls

### Pitfall 1: `vi.useFakeTimers` breaks postgres.js (D-02 violation)
**What goes wrong:** The test suite hangs or produces "connection timeout" errors.
**Why it happens:** `vi.useFakeTimers` intercepts ALL timer APIs including `setTimeout` used by the postgres.js driver for connection keepalive and query timeout logic. With fake timers, those timeouts either never fire or fire immediately depending on how the fake timer is advanced.
**How to avoid:** Use `vi.setSystemTime(new Date(...))` only. Never call `vi.useFakeTimers()` in synthetic-fixture.test.ts.
**Warning signs:** Tests hang indefinitely on the first DB query; or `sql.end()` in afterAll hangs.

### Pitfall 2: Clock not restored after test
**What goes wrong:** Tests later in the suite run with the clock stuck at the last fake time set in synthetic-fixture.test.ts, producing subtle date-comparison failures.
**Why it happens:** `vi.setSystemTime` persists until `vi.useRealTimers()` is called.
**How to avoid:** Always call `vi.useRealTimers()` in `afterEach` (not `afterAll` — tests run in sequence, each test needs the clock reset).
**Warning signs:** Tests that don't use fake time themselves fail with date-comparison assertions, but only when run after synthetic-fixture.test.ts.

### Pitfall 3: TEST-11 racers pre-read status before racing
**What goes wrong:** One racer calls `transitionDecision` at `fromStatus: 'open'`, the other at `fromStatus: 'due'` — because there's a hidden pre-read SELECT between them.
**Why it happens:** If the test seeds a decision at `open`, then one racer calls `transitionDecision(id, 'open', 'due', ...)` which succeeds, changing status to `due`. Then the second racer calls `transitionDecision(id, 'open', 'resolved', ...)` — but this fails with `OptimisticConcurrencyError` because status is now `due`, not `open`. This is the right failure mode BUT it's testing a different race than intended.
**How to avoid:** Phase 18's TEST-11 races `due→resolved`. Seed the decision at `due` status. Both racers call `transitionDecision(id, 'due', 'resolved', ...)`. Only then does the race test the intended concurrent path.
**Warning signs:** The test passes but `decision_events` shows `from_status='open'` for one event and `from_status='due'` for another.

### Pitfall 4: Haiku judge prompt too lenient for condemnation
**What goes wrong:** Sonnet produces a response with mild criticism like "you might want to reconsider" and the Haiku judge classifies it as `condemnation: none` because the prompt only looked for harsh condemnation language.
**Why it happens:** The ACCOUNTABILITY mode spec (D-27 forbids "The Hard Rule") distinguishes between honest feedback (acceptable) and punishing condemnation (forbidden). A Haiku judge prompt that only looks for extreme cases ("you failed", "you should be ashamed") misses mid-strength condemnation.
**How to avoid:** Haiku judge prompt must define the distinction explicitly. Suggested calibration in the prompt: "Condemnation is tone, not content. Honest assessment of a miss is acceptable. Tone becomes condemnatory when it assigns personal blame, expresses disappointment in the person (not the prediction), or uses language that would make a reasonable person feel bad about themselves (not just their decision)."
**Warning signs:** The test passes but reading the actual Sonnet response reveals moralistic or punishing language.

### Pitfall 5: Vague-prediction TEST-14 accidentally tests the mock instead of real Haiku
**What goes wrong:** The test imports `validateVagueness` from `../vague-validator.js`, but another test file in the same Vitest worker has mocked `../../llm/client.js`. The mock leaks.
**Why it happens:** Vitest module mocking is per-module, per-worker. If `vague-validator-live.test.ts` runs in the same worker as `vague-validator.test.ts` (which mocks `callLLM`), the mock may still be active.
**How to avoid:** `vague-validator-live.test.ts` must NOT call `vi.mock('../../llm/client.js', ...)`. Confirm the test explicitly does NOT mock the LLM client. Use `vi.restoreAllMocks()` in `afterEach` as a defensive measure.
**Warning signs:** TEST-14 passes even without an `ANTHROPIC_API_KEY` set (because the mock is returning canned values).

### Pitfall 6: Live API timeouts fail the 3-of-3 loop on retry-worthy errors
**What goes wrong:** One of the 3 live Sonnet calls returns a rate-limit error (HTTP 429) or network timeout. The test fails even though the behavioral contract held for the 2 successful calls.
**Why it happens:** Rate limits are transient. The 3-of-3 requirement means a single transient API error fails the test.
**How to avoid:** Wrap the Haiku judge call (not the Sonnet call) with a short retry for transient errors. The `live-integration.test.ts` precedent uses `Promise.allSettled` with 3 judge calls and majority vote — apply the same majority-vote pattern for the ACCOUNTABILITY judge. For Sonnet, don't retry — a failed Sonnet call is a legitimate failure.
**Warning signs:** CI red with `429 Too Many Requests` in the error output.

---

## Code Examples

### Synthetic fixture clock-advance pattern (TEST-10)

```typescript
// Source: assembled from deadline.test.ts + resolution.test.ts patterns (VERIFIED: codebase)

const DAY_MS = 86_400_000;
const BASE_DATE = new Date('2026-04-01T10:00:00Z');

function advanceDays(n: number): Date {
  return new Date(BASE_DATE.getTime() + n * DAY_MS);
}

it('14-day decision lifecycle from capture to stats', async () => {
  // Day 0: Seed a decision in 'open' status with resolve_by at Day 7
  vi.setSystemTime(advanceDays(0));
  const decisionId = await seedDecision('open', {
    resolveBy: advanceDays(7),
    prediction: 'I will ship the feature by April 8',
    falsificationCriterion: 'Feature not shipped by April 8',
  });

  // Day 7: resolve_by passes. Sweep fires deadline trigger.
  vi.setSystemTime(advanceDays(7));
  mockAnthropicCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: 'Your deadline just passed...' }],
  });
  // call sweep or deadline trigger detect
  // assert decision status = 'due'

  // Day 8: Greg replies with resolution
  vi.setSystemTime(advanceDays(8));
  mockAnthropicCreate
    .mockResolvedValueOnce({ content: [{ type: 'text', text: 'I acknowledge your outcome.' }] })
    .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"outcome":"hit"}' }] })
    .mockResolvedValueOnce({ content: [{ type: 'text', text: '{"reasoning":"sound"}' }] });
  await handleResolution(TEST_CHAT_ID, 'I shipped it on time.', decisionId);
  // assert status = 'resolved'

  // Day 9: Greg answers post-mortem
  vi.setSystemTime(advanceDays(9));
  mockAnthropicCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Noted.' }] });
  await handlePostmortem(TEST_CHAT_ID, 'I planned well.', decisionId);
  // assert status = 'reviewed'

  // Day 14: /decisions stats shows the reviewed decision
  vi.setSystemTime(advanceDays(14));
  const statsRows = await fetchStatsData(TEST_CHAT_ID, 30);
  expect(statsRows.length).toBeGreaterThanOrEqual(1);
}, 30_000);
```

### TEST-11: sweep-vs-user race pattern

```typescript
// Source: adapted from concurrency.test.ts (VERIFIED: codebase)
it('sweep and user-reply racing due→resolved: one winner, one OptimisticConcurrencyError', async () => {
  const id = await seedDecision('due');

  const results = await Promise.allSettled([
    transitionDecision(id, 'due', 'resolved', { actor: 'sweep' }),
    transitionDecision(id, 'due', 'resolved', { actor: 'user' }),
  ]);

  const fulfilled = results.filter(r => r.status === 'fulfilled');
  const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];

  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(rejected[0]!.reason).toBeInstanceOf(OptimisticConcurrencyError);

  // decision_events: exactly one 'due→resolved' event
  const events = await db
    .select()
    .from(decisionEvents)
    .where(and(eq(decisionEvents.decisionId, id), eq(decisionEvents.toStatus, 'resolved')));
  expect(events).toHaveLength(1);
});
```

### TEST-13: ACCOUNTABILITY Haiku judge pattern

```typescript
// Source: adapted from live-integration.test.ts haikuJudge pattern (VERIFIED: codebase)

interface AccountabilityClassification {
  flattery: 'none' | 'mild' | 'strong';
  condemnation: 'none' | 'mild' | 'strong';
}

async function classifyAccountabilityTone(response: string): Promise<AccountabilityClassification> {
  const result = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 200,
    temperature: 0,
    system: `You are a tone classifier. Classify the following AI response on two axes:
- flattery: none (no unwarranted praise) | mild (some gentle praise) | strong (excessive praise)
- condemnation: none (no personal blame) | mild (hints of blame) | strong (explicit blame/punishment)
Honest factual feedback about a prediction miss is NOT condemnation.
Reply ONLY with JSON: {"flattery":"none|mild|strong","condemnation":"none|mild|strong"}`,
    messages: [{ role: 'user', content: `AI response to classify: ${response}` }],
  });
  const text = result.content[0]!.type === 'text' ? result.content[0]!.text : '';
  // parse and return
}
```

### TEST-14: Live vague validator pattern

```typescript
// Source: adapted from vague-validator.test.ts (VERIFIED: codebase)
// NOTE: this test does NOT mock callLLM — that's the entire point

const ADVERSARIAL_PREDICTIONS: Array<{
  prediction: string;
  falsification_criterion: string;
  language: 'en' | 'fr' | 'ru';
}> = [
  // ~4 EN, hedged confidence style
  { prediction: "I think the project will probably work out", falsification_criterion: "it doesn't feel right", language: 'en' },
  { prediction: "Things should improve in the end", falsification_criterion: "things won't feel better", language: 'en' },
  // ...3 FR, 3 RU — Claude's discretion on exact wording
];

it('flags ≥9 of 10 adversarial vague predictions on first pass', async () => {
  let flaggedCount = 0;
  for (const { prediction, falsification_criterion, language } of ADVERSARIAL_PREDICTIONS) {
    const result = await validateVagueness({ prediction, falsification_criterion, language });
    if (result.verdict === 'vague') flaggedCount++;
  }
  expect(flaggedCount).toBeGreaterThanOrEqual(9);
}, 120_000);
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `vitest.config.ts` (root: `src`, include: `**/__tests__/**/*.test.ts`) |
| Quick run command | `DATABASE_URL=... npx vitest run src/decisions/__tests__/synthetic-fixture.test.ts` |
| Full suite command | `npm test` (runs `scripts/test.sh` with Docker Postgres) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-10 | 14-day lifecycle from capture to stats under vi.setSystemTime | integration | `npx vitest run src/decisions/__tests__/synthetic-fixture.test.ts` | Wave 0 |
| TEST-11 | Sweep vs user-reply concurrency race; exactly one winner | integration | `npx vitest run src/decisions/__tests__/synthetic-fixture.test.ts` | Wave 0 |
| TEST-12 | Same-day decision-deadline + silence trigger collision | integration | `npx vitest run src/decisions/__tests__/synthetic-fixture.test.ts` | Wave 0 |
| TEST-13 | ACCOUNTABILITY tone assertion against real Sonnet, 3-of-3 | live (API-key gated) | `ANTHROPIC_API_KEY=... npx vitest run src/decisions/__tests__/live-accountability.test.ts` | Wave 0 |
| TEST-14 | Vague prediction resistance against real Haiku, ≥9/10 flags | live (API-key gated) | `ANTHROPIC_API_KEY=... npx vitest run src/decisions/__tests__/vague-validator-live.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/decisions/__tests__/` (synthetic tests only — fast)
- **Per wave merge:** `npm test` (full suite with Docker Postgres)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/decisions/__tests__/synthetic-fixture.test.ts` — covers TEST-10, TEST-11, TEST-12
- [ ] `src/decisions/__tests__/live-accountability.test.ts` — covers TEST-13
- [ ] `src/decisions/__tests__/vague-validator-live.test.ts` — covers TEST-14

*(All three files are the deliverables of Phase 18 — they do not yet exist)*

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker | Real Postgres for integration tests | ✓ | 29.3.1 | — |
| Docker Compose | `scripts/test.sh` | ✓ | v5.1.1 | — |
| Node.js | Test runner | ✓ | v24.14.1 | — |
| Vitest | Test framework | ✓ | 4.1.2 | — |
| ANTHROPIC_API_KEY | TEST-13, TEST-14 live calls | conditional | — | Tests skip via `describe.skipIf` |

**Missing dependencies with no fallback:** None that block execution.

**Conditional dependencies:**
- `ANTHROPIC_API_KEY`: Required only for live tests (TEST-13, TEST-14). The `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` guard causes those blocks to silently skip in CI without the key. `scripts/test.sh` sets `ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}"` so fake-key runs skip the live blocks cleanly.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes (TEST-14 adversarial inputs) | Adversarial prediction strings go through `validateVagueness()` — they are passed as LLM message content, not interpolated into SQL or system prompts |
| V2 Authentication | no | Tests use fixed TEST_CHAT_ID constants, not real user auth |
| V3 Session Management | no | No session state in tests |
| V4 Access Control | no | No access-control paths exercised |
| V6 Cryptography | no | No crypto in test code |

### Test-Specific Security Notes

- Adversarial prediction strings in TEST-14 are passed as LLM user message content only — they cannot reach SQL queries or system prompts. No injection risk. [VERIFIED: `validateVagueness` implementation in `vague-validator.ts`]
- Live test API key (`ANTHROPIC_API_KEY`) must not be logged. Existing `logger` in the codebase logs only structural fields, not content. [VERIFIED: `vague-validator.ts` logger calls]
- Test DB cleanup uses scoped deletes (by chatId or by test-inserted row IDs) — not `DELETE FROM table` truncations that could race with other test workers. [VERIFIED: `live-integration.test.ts` cleanup pattern]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vi.useFakeTimers` for time control | `vi.setSystemTime` only (D-02) | Phase 18 decision | Prevents postgres.js timer breakage |
| Two identical racers in concurrency test | Distinct `sweep` vs `user` actors (D-05) | Phase 18 scope | Tests the specific race that production can exhibit |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `transitionDecision` signature accepts `{ actor: 'sweep' \| 'user' }` as the payload | Code Examples (TEST-11) | ActorKind type may not include 'user' — check `lifecycle.ts` exports before writing test [ASSUMED: type read from source but not runtime-tested] |

**Nearly all claims are VERIFIED from codebase.** The only assumption is the exact `ActorKind` union values, which were read from `lifecycle.ts` source (`export type ActorKind = 'capture' | 'transition' | 'sweep' | 'user' | 'system'`) — this is HIGH confidence.

**Actual assumption log is empty.** The A1 row above is informational, not a genuine assumption — `ActorKind` was read directly from `src/decisions/lifecycle.ts` line 27. [VERIFIED: codebase]

---

## Open Questions

1. **Which sweep function/trigger entry point does TEST-12 call?**
   - What we know: `src/proactive/sweep.ts` orchestrates the sweep pipeline; `createDeadlineTrigger()` in `src/proactive/triggers/deadline.ts` is the deadline-trigger factory.
   - What's unclear: Should TEST-12 call the top-level sweep orchestrator, or call deadline trigger + silence trigger individually? The test must prove channel separation fires BOTH — calling them individually proves they don't interfere but doesn't prove the orchestrator respects both.
   - Recommendation: Read `src/proactive/sweep.ts` before writing TEST-12 to understand whether the orchestrator runs both channels in one call or whether they must be called separately. This is a 10-minute code read at plan time.

2. **Does `handleResolution` need a `chatId` for the mock-clock test to work?**
   - What we know: `handleResolution(chatId, resolutionText, decisionId)` is the confirmed signature from `resolution.test.ts`.
   - What's unclear: `handleResolution` calls `getLastUserLanguage(chatId.toString())` internally. In synthetic-fixture.test.ts the clock is fake but the language state module is not mocked. Either the language state module must be seeded, or it must fail-soft (return a default language).
   - Recommendation: Check whether `getLastUserLanguage` has a fallback for unknown chatIds. If it throws, mock it. If it returns a default ('en'), no action needed.

---

## Sources

### Primary (HIGH confidence)
- `src/chris/__tests__/live-integration.test.ts` — `describe.skipIf`, 3-of-3 loop, Haiku judge pattern, DB seeding/cleanup
- `src/decisions/__tests__/concurrency.test.ts` — `Promise.allSettled`, `OptimisticConcurrencyError`, `seedDecision` helper
- `src/decisions/__tests__/resolution.test.ts` — `vi.hoisted` + `vi.mock`, `mockAnthropicCreate`, full 14-field mock mock
- `src/proactive/__tests__/deadline.test.ts` — `vi.setSystemTime` usage, `vi.useRealTimers` in afterEach
- `src/proactive/__tests__/sweep-escalation.test.ts` — sweep pipeline mock structure, channel separation tests
- `src/decisions/__tests__/vague-validator.test.ts` — `validateVagueness` call pattern, `callLLM` mock
- `src/decisions/lifecycle.ts` — `transitionDecision` signature, `ActorKind` union, `OptimisticConcurrencyError` path
- `src/decisions/vague-validator.ts` — `validateVagueness` implementation, `HEDGE_WORDS`, fail-soft behavior
- `src/decisions/resolution.ts` — `handleResolution`, `handlePostmortem`, `classifyOutcome` signatures
- `vitest.config.ts` — test root, include glob, environment
- `scripts/test.sh` — Docker Postgres setup, migration application, env var injection
- `package.json` — vitest 4.1.2, @anthropic-ai/sdk ^0.80.0, all confirmed dependencies

### Secondary (MEDIUM confidence)
- `.planning/phases/18-synthetic-fixture-live-accountability-integration-suite/18-CONTEXT.md` — all locked decisions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified in package.json; no new dependencies
- Architecture: HIGH — all patterns verified from existing codebase files
- Pitfalls: HIGH — pitfalls derived from reading actual code (not speculation)
- Open questions: MEDIUM — questions are implementation-detail gaps, not blockers

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (stable patterns; vitest mock API unlikely to change)
