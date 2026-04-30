# Phase 30: Test Infrastructure + HARN-03 Refresh — Research

**Researched:** 2026-04-30
**Domain:** Test infrastructure (vitest 4 + Docker postgres + primed-fixture pipeline + mock-clock walking + live-LLM gating)
**Confidence:** HIGH (every claim cited to file:line in this codebase; no external library research required — Phase 30 is internal-only)

## Summary

Phase 30 ships the integration test phase that proves M009 works end-to-end. Four plans split work along HARD CO-LOCATION lines: Plan 30-01 regenerates the `m009-21days` primed fixture (HARN-04..06), Plan 30-02 authors the 14-day synthetic-fixture test asserting all 7 spec behaviors against the real `processMessage` engine pipeline, Plan 30-03 EXTENDS the existing `cron-registration.test.ts` with TEST-32 assertions, and Plan 30-04 flips the gate on the live anti-flattery test Phase 29-04 already shipped.

The codebase is unusually well-prepared for this phase: every analog pattern exists in tree (M008's `synthetic-fixture.test.ts`, the `loadPrimedFixture` loader, the Phase 26 `engine-pp5.test.ts` cumulative-not-called pattern, the wellbeing test's `MockCtx` for callback_query, the Phase 25 spy-based `cron-registration.test.ts`, the Phase 29-04 `live-weekly-review.test.ts` with skipIf gate). The planning task is largely composition of existing patterns — NOT invention.

**Primary recommendation:** Mirror existing patterns verbatim — Plan 30-02's mock-clock walk inherits structure from `src/episodic/__tests__/synthetic-fixture.test.ts:483-595`; the cumulative `not.toHaveBeenCalled()` pattern lives in `src/chris/__tests__/engine-pp5.test.ts:83-92`; the callback_query simulation pattern (`buildMockCtx`) lives in `src/rituals/__tests__/wellbeing.test.ts:77-86`. Plan 30-03 EXTENDS the existing file rather than authoring fresh. Plan 30-04 changes a single skipIf line.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-30-01: 4 plans for Phase 30** — partitioned by HARD CO-LOC constraints (#4 forces TEST-32 own file → own plan; #6 forces TEST-31 own plan) and substrate dependency (14-day fixture must regenerate BEFORE synthetic-fixture test runs).

- **Plan 30-01 — HARN fixture refresh (substrate):** Run `scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force`. Add `--reseed-vcr` flag (HARN-05). Document VCR cost model in `.planning/codebase/TESTING.md`. Update sanity-test thresholds (≥7 → ≥21) AND add 5th invariant `wellbeing_snapshots ≥ 14 days` (HARN-06). Requirements: HARN-04, HARN-05, HARN-06. ~80 LoC + 1 doc.
- **Plan 30-02 — Synthetic fixture test (TEST-23..30, all 7 assertions):** Author `src/rituals/__tests__/synthetic-fixture.test.ts`. ~400 LoC test code + ~50 LoC helper.
- **Plan 30-03 — Cron registration regression (TEST-32, HARD CO-LOC #4):** Author `src/rituals/__tests__/cron-registration.test.ts` as distinct file. Static analysis test. ~60 LoC. **(SEE LANDMINE 1 — file already exists.)**
- **Plan 30-04 — Live anti-flattery gate flip (TEST-31, HARD CO-LOC #6):** Tighten skipIf gate to require BOTH `RUN_LIVE_TESTS` AND `ANTHROPIC_API_KEY`. ~10 LoC + 1 doc paragraph.

**D-30-02: HARN-04 fixture freshness gate** — Regenerate as Plan 30-01 first task. Plan 30-01 Task 2 reads MANIFEST.json and asserts: (a) window_start ≤ window_end; (b) (window_end − window_start) ≥ 14 days; (c) at least one date in window is Sunday; (d) wellbeing_snapshots ≥ 14. Fail-fast if any assertion fails — TEST-29 weekly review will silently never fire if no Sunday is present.

**D-30-03: TEST-31 cost discipline** — Tighten the skipIf gate to require BOTH `RUN_LIVE_TESTS=1` AND `ANTHROPIC_API_KEY`. Manual run pattern: `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... npx vitest run src/rituals/__tests__/live-weekly-review.test.ts`.

**D-30-04: 3 waves** — Wave 1: 30-01 (HARN fixture refresh, substrate). Wave 2: 30-02 + 30-03 + 30-04 in parallel (worktree isolation handles file conflicts; vitest `fileParallelism: false` already serializes test execution).

### Claude's Discretion

- Test file LoC estimates (~400 for 30-02, ~60 for 30-03, ~80 for 30-01) — planner authoritative.
- Whether to extract `loadPrimedFixture()` test helper or write inline — planner authoritative. (NOTE: helper exists at `src/__tests__/fixtures/load-primed.ts:165` — reuse.)
- Specific assertion library calls — standard vitest patterns, no decision needed.
- Drizzle schema mirroring for any new test-only tables — none expected for Phase 30.

### Deferred Ideas (OUT OF SCOPE)

- Multi-week (>14 day) synthetic coverage — current 14-day window already satisfies SKIP-03 thresholds; longer windows defer to v2.5.
- VCR cache rebuild automation in CI — manual `--reseed-vcr` invocation is sufficient for v2.4.
- DIFF-2/DIFF-3/DIFF-5 weekly review enhancement coverage in fixture — features themselves deferred to v2.5.
- Cross-cutting M009 user-acceptance walkthrough document — Phase 28 + 29 already produced post-deploy UAT artifacts; consolidation deferred to milestone-completion phase.
- Performance / regression latency benchmarks for `runRitualSweep` — deferred unless real-clock observation surfaces a problem.
- Weekly anti-flattery cron via `.github/workflows/anti-flattery-weekly.yml` — D-30-03 rejected for v2.4; reconsider for v2.5.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-23 | 14-day synthetic fixture in `src/rituals/__tests__/synthetic-fixture.test.ts` via `vi.setSystemTime` mock-clock + `loadPrimedFixture('m009-21days')`; full `processMessage` pipeline | Pattern: `src/episodic/__tests__/synthetic-fixture.test.ts` (M008 analog, 1100+ LoC). Loader: `src/__tests__/fixtures/load-primed.ts:165`. Engine entry: `src/chris/engine.ts:165`. |
| TEST-24 | Daily prompt rotation (no consecutive dupes; no-repeat-in-last-6 property test) | Property pattern: `src/rituals/__tests__/prompt-rotation-property.test.ts`. Bag mechanism: `src/rituals/voice-note.ts` PROMPTS + prompt_bag in config. |
| TEST-25 | Voice-note Pensieve persistence + cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` (Pitfall 6 regression test) | Verbatim pattern: `src/chris/__tests__/engine-pp5.test.ts:83-98` (afterAll-style cumulative assert). Hoist mock at lines 30-41. |
| TEST-26 | Skip increments only on `fired_no_response`; not on `system_suppressed` / `window_missed` | Outcome union: `src/rituals/types.ts:143-156`. Increment-on-only-fired_no_response policy: types.ts:139. |
| TEST-27 | Adjustment dialogue at cadence-aware threshold (daily=3, weekly=2) | Predicate: `src/rituals/skip-tracking.ts shouldFireAdjustmentDialogue`. Dispatch: `src/rituals/scheduler.ts:214`. Threshold: weekly_review seed config has `skip_threshold: 2` (`src/db/migrations/0009_weekly_review_seed.sql:51`). |
| TEST-28 | Wellbeing via `simulateCallbackQuery` test helper | Pattern resolved (D-30-05): use `buildMockCtx` from `src/rituals/__tests__/wellbeing.test.ts:77-86` — extract to shared helper. |
| TEST-29 | Weekly review exactly 1 obs + 1 Q; Stage-1 + Stage-2 invoked; templated fallback exercised | Mock injection pattern: `src/rituals/__tests__/weekly-review.test.ts:38-76`. Fallback log line: `src/rituals/weekly-review.ts:469` (`'chris.weekly-review.fallback-fired'`). |
| TEST-30 | Weekly review references specific summaries + decisions; date-grounding post-check | Loader: `src/rituals/weekly-review-sources.ts loadWeeklyReviewContext`. Date-grounding: `src/rituals/weekly-review.ts runDateGroundingCheck`. |
| TEST-31 | Live anti-flattery 3-of-3 atomic against real Sonnet (HARD CO-LOC #6 — own plan) | File EXISTS at `src/rituals/__tests__/live-weekly-review.test.ts` (Phase 29-04 scaffold). 40 markers (NOT 17). Plan 30-04 flips one skipIf line at file:46. |
| TEST-32 | Cron registration regression in separate file (HARD CO-LOC #4 — distinct from TEST-23) | File EXISTS at `src/rituals/__tests__/cron-registration.test.ts` (Phase 25 Plan 03 Task 3, 4 tests). Plan 30-03 extends with TEST-32 assertions (timezone literal, ritualConfirmation cron — see Landmine 1). |
| HARN-04 | Run `scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force` against fresh prod | Composer: `scripts/regenerate-primed.ts:180-252`. Note: NO `--milestone m009` fixture currently exists in `tests/fixtures/primed/` (gitignored, will be regenerated). |
| HARN-05 | VCR cost model docs + `--reseed-vcr` flag | Cache: `tests/fixtures/.vcr/<sha256>.json` per `src/__tests__/fixtures/vcr.ts:53`. Hash includes model+prompt+schema (auto-invalidates on change). Plan 30-01 adds `--reseed-vcr` to `scripts/regenerate-primed.ts:58-119` parseCliArgs. |
| HARN-06 | HARN-03 5th invariant (≥14 days `wellbeing_snapshots`) | Sanity test at `src/__tests__/fixtures/primed-sanity.test.ts:51-93`. Plan 30-01 flips `MIN_EPISODIC_SUMMARIES = 7 → 21` (line 37) AND adds 5th `it()` block asserting wellbeing_snapshots count. Loader feature-detects `wellbeing_snapshots` via to_regclass (load-primed.ts:220). |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fixture data generation (Plan 30-01) | Operator script | VCR cache | `scripts/regenerate-primed.ts` is a Node CLI; VCR cache (`tests/fixtures/.vcr/`) memoizes Anthropic outputs. No production runtime involvement. |
| Fixture data loading (Plan 30-02) | Test fixture loader | Postgres | `loadPrimedFixture` (test utility) does FK-safe DELETE+INSERT against the test DB. Not a production code path. |
| Mock-clock walking (Plan 30-02) | Vitest test runtime | Real postgres.js client | `vi.setSystemTime` advances `Date.now()` only — postgres.js connection keep-alive timers stay real (D-02). |
| `processMessage` engine invocation (Plan 30-02) | Backend / DB integration | Mocked Anthropic SDK | Real Drizzle + real postgres + mocked `anthropic.messages.{create,parse}`. Entry: `src/chris/engine.ts processMessage`. |
| Cron registration assertion (Plan 30-03) | Static unit test | Mocked node-cron | `vi.mock('node-cron')` + spy on `cron.schedule`. No DB, no LLM, no Telegram, no Express. |
| Live anti-flattery (Plan 30-04) | Backend + real Anthropic Sonnet | Real DB | Calls `generateWeeklyObservation` directly against `ADVERSARIAL_WEEK_INPUT`; no Telegram round-trip. |

**Why this matters for Phase 30:** All four plans operate at the test-infrastructure tier. There is NO frontend/browser/CDN/SSR involvement. The risk of tier misassignment is low; the actual tier-specific risk is **inappropriate mocking** (e.g., mocking postgres-js, mocking Drizzle, or using `vi.useFakeTimers` instead of `vi.setSystemTime`). The codebase explicitly forbids those patterns at `.planning/codebase/TESTING.md:178` (D-02) — Plans 30-02/30-03 must respect this.

## Standard Stack

### Core (already present — Phase 30 invents nothing)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 4.1.x | Test runner | Project-locked since Phase 18; `vitest.config.ts:25` sets `fileParallelism: false` |
| `@vitest/coverage-v8` | 4.1.x | Coverage tooling | Diagnostic only; no Phase 30 coverage gate |
| zod / zod/v4 | (per package.json) | Schema validation in test fixtures | `src/rituals/types.ts:39` `import { z } from 'zod'` |
| postgres-js | (per package.json) | Postgres client | Real DB integration tests rely on `sql.end()` cleanup discipline (TESTING.md:141) |
| Drizzle ORM | (per package.json) | Query builder | Used directly in test code; not mocked |
| Luxon | (per package.json) | Timezone math | `src/rituals/cadence.ts:88-95` — Sunday = ISO weekday 7 |
| `@anthropic-ai/sdk` | (per package.json) | LLM SDK (mocked in tests) | Mock pattern: `vi.mock('../../llm/client.js', ...)` per `engine-pp5.test.ts:34` |
| `grammy` | (per package.json) | Telegram bot framework (mocked in tests) | Mock pattern: `vi.mock('../../bot/bot.js', ...)` per `wellbeing.test.ts:53` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node-cron` | (per package.json) | Cron scheduling (MOCKED in TEST-32) | Plan 30-03 mocks this via `vi.mock('node-cron', ...)` per existing `cron-registration.test.ts:22` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `vi.setSystemTime` | `vi.useFakeTimers` | **FORBIDDEN** per D-02 (TESTING.md:178). Fake timers replace setTimeout/setInterval and break postgres-js keep-alive. Use `vi.setSystemTime` exclusively. |
| Real Anthropic SDK in Plan 30-02 | Mocked SDK | Mocked is correct for TEST-23..30. Real SDK only in Plan 30-04 (live-weekly-review.test.ts) which is default-skip. |
| Mocked postgres in Plan 30-02 | Real Docker postgres | Real is correct (D-27-10): "Postgres concurrent-update semantics must be tested with REAL postgres, not mocks." Plan 30-02 loads `m009-21days` fixture into real DB. |
| Authoring fresh `cron-registration.test.ts` | Extending existing file | **EXISTS — Plan 30-03 EXTENDS** (see Landmine 1). |

**Installation:** No new dependencies. `npm install` is unchanged.

**Version verification:** Not applicable — Phase 30 adds no dependencies. All frameworks already locked to project versions.

## Architecture Patterns

### System Architecture Diagram

Plan 30-02's data flow (the most architecturally interesting plan):

```
[Operator]
   │ (Wave 1, Plan 30-01)
   ▼
scripts/regenerate-primed.ts ──► fetch-prod-data.ts ──► tests/fixtures/prod-snapshot/<stamp>/
   │                                                          │
   │                                                          ▼
   ├──► synthesize-delta.ts ──► VCR cache (.vcr/<sha256>.json) ──► Anthropic Haiku (style transfer)
   │                                                          │
   │                                                          ▼
   └──► synthesize-episodic.ts ──► throwaway Docker port 5435 ──► Anthropic Sonnet (consolidate)
                                                              │
                                                              ▼
                              tests/fixtures/primed/m009-21days/MANIFEST.json + JSONL files
                                                              │
                                                              │ (Wave 2, Plan 30-02)
                                                              ▼
[npm test → bash scripts/test.sh] ──► Docker postgres port 5433 ──► loadPrimedFixture('m009-21days')
                                                                              │
                                                                              ▼
                                                                  bulk INSERT (FK-safe order)
                                                                              │
                                                                              ▼
                                                       describe block: vi.setSystemTime walks 14 days
                                                                              │
                                                                              ▼
                                          ┌───────────────────────────────────────────────────────┐
                                          │  for each day in fixture window:                      │
                                          │    vi.setSystemTime(day.startOfDay)                   │
                                          │    await runRitualSweep(now)                          │
                                          │    [if voice-note pending] simulate Greg's STT reply: │
                                          │       processMessage(chatId, userId, text)            │
                                          │    [if wellbeing pending]  simulateCallbackQuery(...) │
                                          │    [if Sunday]             expect weekly_review fired │
                                          │  end                                                  │
                                          │                                                       │
                                          │  afterAll:                                            │
                                          │    expect(mockAnthropicCreate).not.toHaveBeenCalled() │
                                          └───────────────────────────────────────────────────────┘
                                                                              │
                                                                              ▼
                                                                    7 assertions (TEST-24..30)
```

### Recommended Project Structure (Plan 30-02 file layout)

```
src/rituals/__tests__/
├── synthetic-fixture.test.ts       # NEW — Plan 30-02 (TEST-23..30)
├── cron-registration.test.ts       # EXTEND (exists; Plan 30-03 adds TEST-32)
├── live-weekly-review.test.ts      # MODIFY (skipIf line; Plan 30-04 TEST-31)
└── fixtures/
    ├── adversarial-week.ts         # exists (Phase 29-04)
    ├── skip-tracking.ts            # exists (Phase 28)
    └── simulate-callback-query.ts  # NEW — Plan 30-02 (extracted from wellbeing.test.ts buildMockCtx)
```

### Pattern 1: vi.hoisted + vi.mock for cumulative not-called assertion

**What:** Hoist mock fns so `vi.mock` factories can capture references; assert in `afterAll` that LLM mock was never called.
**When to use:** TEST-25's cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` (Pitfall 6 regression). The describe block's `afterAll` is the cumulative point.
**Example:**
```typescript
// Source: src/chris/__tests__/engine-pp5.test.ts:30-92
const { mockAnthropicCreate, mockAnthropicParse } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
}));
vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate, parse: mockAnthropicParse },
  },
  HAIKU_MODEL: 'claude-haiku',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));

describe('PP#5 HIT path — Pitfall 6 contract', () => {
  afterAll(async () => {
    expect(mockAnthropicCreate).not.toHaveBeenCalled();  // ← cumulative
    await cleanup();
  });
  // ... it() blocks that send 14 days of voice-note replies
});
```

**Critical detail:** Plan 30-02 must import the LLM-mock-aware modules AFTER `vi.mock` calls (mocks are hoisted; non-hoisted imports are NOT). See `engine-pp5.test.ts:60` — `import { processMessage } from '../engine.js'` happens AFTER `vi.mock` at line 34.

### Pattern 2: vi.setSystemTime mock-clock walking

**What:** Advance `Date.now()` between days to simulate calendar progression without waiting real time.
**When to use:** TEST-23 14-day fixture walk; M008 analog at `src/episodic/__tests__/synthetic-fixture.test.ts` walks 14 calendar days.
**Example:**
```typescript
// Source: src/episodic/__tests__/synthetic-fixture.test.ts:551-558
for (let i = 0; i < 14; i++) {
  const date = fixtureDates[i];
  // ... mock setup for day i ...
  const fireAt = dateAtLocalHour(date, FIXTURE_TZ, 23, 0);
  vi.setSystemTime(fireAt);
  const result = await runConsolidate(tzDate(`${date}T12:00:00`, FIXTURE_TZ));
  // ... per-day assertions
}
```

**Adapted for Plan 30-02 (3 cron ticks per day at 09:00 wellbeing, 21:00 voice note, Sunday 20:00 weekly review):**
```typescript
for (let i = 0; i < 14; i++) {
  const date = fixtureDates[i];

  // 09:00 — wellbeing fires
  vi.setSystemTime(dateAtLocalHour(date, 'Europe/Paris', 9, 0));
  await runRitualSweep(new Date());
  // [optional] simulateCallbackQuery to capture wellbeing snapshot

  // 21:00 — voice note fires
  vi.setSystemTime(dateAtLocalHour(date, 'Europe/Paris', 21, 0));
  await runRitualSweep(new Date());
  // [optional] processMessage with simulated Greg STT reply

  // Sunday only — weekly review at 20:00 (BEFORE voice note tick)
  if (isSunday(date)) {
    vi.setSystemTime(dateAtLocalHour(date, 'Europe/Paris', 20, 0));
    await runRitualSweep(new Date());
  }
}
```

### Pattern 3: simulateCallbackQuery — `buildMockCtx` extraction (resolves D-30-05)

**What:** Forge a Grammy `Context` with a `callbackQuery` field for inline-keyboard tap simulation.
**Where it lives now:** Inline at `src/rituals/__tests__/wellbeing.test.ts:77-86` as `buildMockCtx`. Plan 30-02 extracts to shared module `src/rituals/__tests__/fixtures/simulate-callback-query.ts`.
**Example:**
```typescript
// Source: src/rituals/__tests__/wellbeing.test.ts:70-86
interface MockCtx {
  callbackQuery?: { data: string; message?: { message_id: number } };
  answerCallbackQuery: ReturnType<typeof vi.fn>;
  editMessageReplyMarkup: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
}

function buildMockCtx(callbackData?: string, messageId = 12345): MockCtx {
  return {
    callbackQuery: callbackData
      ? { data: callbackData, message: { message_id: messageId } }
      : undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
  };
}

// Invocation pattern (wellbeing.test.ts:282)
await handleWellbeingCallback(buildMockCtx('r:w:e:3') as any, 'r:w:e:3');
```

**Plan 30-02 extracted shape (proposed):**
```typescript
// src/rituals/__tests__/fixtures/simulate-callback-query.ts
export interface SimulatedCallbackCtx {
  callbackQuery: { data: string; message: { message_id: number } };
  answerCallbackQuery: ReturnType<typeof vi.fn>;
  editMessageReplyMarkup: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
}

export function simulateCallbackQuery(opts: {
  callbackData: string;
  messageId?: number;
}): SimulatedCallbackCtx {
  return {
    callbackQuery: { data: opts.callbackData, message: { message_id: opts.messageId ?? 12345 } },
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
  };
}
```
Then `wellbeing.test.ts buildMockCtx` is replaced by `simulateCallbackQuery` (same shape, exported name). Both files import from shared module — no duplicate definitions.

### Pattern 4: Mocking `anthropic.messages.parse` for templated-fallback exercise (resolves D-30-06)

**What:** Make Sonnet return a compound question on iteration N → Stage-1 Zod refine throws → retry cap=2 → templated fallback fires.
**Where pattern lives:** `src/rituals/__tests__/weekly-review.test.ts:38-76` already has the full mock-injection scaffolding. Specifically `mockAnthropicParse.mockResolvedValueOnce(...)` calls drive the retry loop.
**Example:**
```typescript
// Source: src/rituals/__tests__/weekly-review.test.ts:38-76 (mocking infrastructure)
const { mockAnthropicParse, mockSendMessage, mockLoggerInfo, mockLoggerWarn, mockLoggerError } =
  vi.hoisted(() => ({
    mockAnthropicParse: vi.fn(),
    // ...
  }));
vi.mock('../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../llm/client.js')>();
  return { ...orig, anthropic: { messages: { parse: mockAnthropicParse, create: vi.fn() } } };
});
vi.mock('../../utils/logger.js', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError },
}));
```

**Plan 30-02 application (TEST-29 templated fallback exercise on Week 2):**
```typescript
// Week 1 Sunday — happy path
mockAnthropicParse
  .mockResolvedValueOnce({ parsed_output: { observation: '...', question: 'What stood out to you this week?' } })  // Stage-1 Sonnet
  .mockResolvedValueOnce({ parsed_output: { question_count: 1, questions: ['What stood out to you this week?'] } }) // Stage-2 Haiku judge
  .mockResolvedValueOnce({ parsed_output: { in_window: true } });  // Date-grounding Haiku

// Week 2 Sunday — fallback path: compound question 3× forces fallback
mockAnthropicParse
  .mockResolvedValueOnce({ parsed_output: { observation: '...', question: 'What surprised you? Or what felt familiar?' } }) // attempt 1 — Stage-1 Zod throws
  .mockResolvedValueOnce({ parsed_output: { observation: '...', question: 'What surprised you? Or what felt familiar?' } }) // attempt 2 — Stage-1 throws
  .mockResolvedValueOnce({ parsed_output: { observation: '...', question: 'What surprised you? Or what felt familiar?' } }); // attempt 3 — Stage-1 throws → cap reached

// After Week 2 fires, assert fallback log line emitted
expect(mockLoggerWarn).toHaveBeenCalledWith(
  expect.objectContaining({ attempts: 3 }),
  'chris.weekly-review.fallback-fired'
);
```

**Verified log line:** `src/rituals/weekly-review.ts:469` — `logger.warn({ err: errMsg, attempts: MAX_RETRIES + 1 }, 'chris.weekly-review.fallback-fired');`. `MAX_RETRIES = 2` (line 339), so `attempts === 3` (initial + 2 retries).

### Pattern 5: skipIf gate for live-LLM tests

**What:** `describe.skipIf(predicate)` skips the entire block when env vars are missing.
**Where it lives:** `src/rituals/__tests__/live-weekly-review.test.ts:46`.
**Plan 30-04 modification (single-line change):**
```typescript
// BEFORE (Phase 29-04 scaffold):
describe.skipIf(!process.env.ANTHROPIC_API_KEY)(
  'live-weekly-review (PHASE-30: enable in TEST-31; HARD CO-LOC #6)',
  () => { /* ... */ }
);

// AFTER (Plan 30-04 — D-30-03 cost discipline):
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)(
  'live-weekly-review (HARD CO-LOC #6 — TEST-31)',
  () => { /* ... */ }
);
```
The `// PHASE-30: enable in TEST-31` line-comment marker (lines 4 + 45) gets reworded to `// PHASE-30: live execution gate flipped per TEST-31`.

### Anti-Patterns to Avoid

- **Re-authoring `cron-registration.test.ts` from scratch** — file ALREADY EXISTS. Plan 30-03 extends. See Landmine 1.
- **Using `vi.useFakeTimers`** — FORBIDDEN per D-02 (TESTING.md:178). Breaks postgres-js keep-alive timers. Use `vi.setSystemTime` only.
- **Mocking postgres-js / Drizzle** — FORBIDDEN per D-27-10 + TESTING.md:174-178 ("What NOT to mock: Postgres, Drizzle"). Real DB via Docker is the integration contract.
- **Bypassing PP#5 in TEST-23** — Pitfall 24 violation. Test MUST go through full `processMessage` (engine.ts:165) so the cumulative `not.toHaveBeenCalled()` assertion has meaning.
- **Hardcoding `BigInt(9991X)` chat IDs** — Phase 18 IN-03 convention. Allocate via `src/__tests__/fixtures/chat-ids.ts` (currently lists 99901, 99918, 99919, 99920 — 99921 or 99922 is the next free slot for Plan 30-02).
- **Hardcoding 17 markers in Plan 30-04** — there are **40 markers** (8 + 15 + 17 = 40 per Phase 29-04 SUMMARY line 73 + 46). The "17" in CONTEXT.md predates the D-10 refinement. Plan 30-04 must NOT redeclare; the `live-weekly-review.test.ts` file already imports the three sets via spread.
- **Sunday detection via `dayOfWeek === 0`** — partial pitfall. Codebase uses ISO weekday convention (Sunday = 7) per `src/db/migrations/0009_weekly_review_seed.sql:23-28` and `src/rituals/cadence.ts:88-95`. JS `Date.getDay()` returns 0 for Sunday; Luxon `weekday` returns 7. Plan 30-01 fail-fast assertion must specify which: if using JS `Date`, it's `=== 0`; if Luxon, it's `=== 7`. Recommend using Luxon for consistency with the rest of the rituals module.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FK-safe primed-fixture loading | Custom INSERT loop | `loadPrimedFixture('m009-21days')` from `src/__tests__/fixtures/load-primed.ts:165` | Loader already handles 11 tables in correct order with feature-detection for `wellbeing_snapshots` (line 220) |
| VCR cache | New file-cache wrapper | `cachedMessagesParse` / `cachedMessagesCreate` from `src/__tests__/fixtures/vcr.ts:125-165` | Hash-keyed by canonical request stringify; auto-invalidates on prompt/model changes |
| Cron registration mock | Hand-rolled spy | Existing `vi.hoisted({ scheduleSpy, validateSpy })` pattern at `src/rituals/__tests__/cron-registration.test.ts:17-26` | Already loaded; Plan 30-03 extends |
| Anthropic mock infrastructure | New mock file | `vi.hoisted` + `vi.mock('../../llm/client.js', ...)` per `engine-pp5.test.ts:30-41` and `weekly-review.test.ts:38-76` | Same SDK shape, same import resolution |
| Telegram bot mock | Custom Grammy stub | `vi.mock('../../bot/bot.js', () => ({ bot: { api: { sendMessage: mockSendMessage } } }))` per `wellbeing.test.ts:53-55` | Standardized in 11+ test files |
| Marker source-of-truth for TEST-31 | Re-derived list | Three verbatim imports + spread: `VALIDATION_MARKERS` (8 from `live-integration.test.ts:42`) + `REFLEXIVE_OPENER_FIRST_WORDS` (15 from `praise-quarantine.ts:36`) + `FLATTERY_MARKERS` (17 from `live-anti-flattery.test.ts:94`) = **40 total** | D-10 refined "no redeclaration" — already implemented at `live-weekly-review.test.ts:35-43`. Plan 30-04 changes nothing here. |
| Adversarial week fixture | New seed data | `ADVERSARIAL_WEEK_INPUT` from `src/rituals/__tests__/fixtures/adversarial-week.ts` | Already shipped Phase 29-04, ≥5 bait markers embedded |

**Key insight:** This phase is composition, not invention. Every analog pattern exists. The work is wiring + assertion authorship, not infrastructure design.

## Common Pitfalls

### Pitfall 1: Cron registration test file ALREADY EXISTS — risks duplicate-file conflict
**What goes wrong:** Plan 30-03 attempts to author `src/rituals/__tests__/cron-registration.test.ts` as if it's a new file. It exists (Phase 25 Plan 03 Task 3, 116 LoC, 4 tests).
**Why it happens:** CONTEXT.md describes Plan 30-03 as "Author `src/rituals/__tests__/cron-registration.test.ts` as a distinct file". Distinct from synthetic-fixture, yes — but the file already exists.
**How to avoid:** Plan 30-03 must EXTEND the existing file with new TEST-32 assertions, NOT recreate. The existing file already covers (1) ritual cron at `0 21 * * *` Europe/Paris, (2) proactive cron at `0 10 * * *`, (3) sync=disabled when runSync omitted, (4) handler try/catch isolation. Plan 30-03 adds: TEST-32 assertion on the registration call site (currently the existing file tests the helper `registerCrons` directly; TEST-32 asks for the assertion that `src/index.ts main()` actually CALLS `registerCrons` — a different layer of test).
**Warning signs:** If a planning doc says "create cron-registration.test.ts" without `(extends existing)` annotation, flag it.

### Pitfall 2: Phase 28's `ritualConfirmation` cron is registered via the SAME `registerCrons()` call
**What goes wrong:** Plan 30-03 might assert `registerRitualCron` (single call) when actually 4 crons fire from `registerCrons`: proactive, ritual, ritualConfirmation, episodic.
**Why it happens:** CONTEXT.md text "asserts `registerRitualCron()` called in `src/index.ts:main()`" suggests one call site; reality is `cron-registration.ts:56-160` schedules 4 (or 5 with sync) crons in one helper.
**Verified shape:** `src/index.ts:89-95`:
```typescript
cronStatus = registerCrons({
  config,
  runSweep,
  runRitualSweep,
  runConsolidateYesterday,
  ritualConfirmationSweep, // Phase 28 D-28-06 — 1-minute confirmation sweep
});
```
The 4-cron registration happens inside `registerCrons` at `cron-registration.ts:86-158`. The literal 1-minute cron expression `'* * * * *'` is at line 126 (HARDCODED, not from config). The ritual cron expression comes from `deps.config.ritualSweepCron` at line 105 (default `'0 21 * * *'` per migration seed).
**How to avoid:** TEST-32 asserts: (a) `registerCrons` invoked from `src/index.ts main()`; (b) the call passes `runRitualSweep` AND `ritualConfirmationSweep` (positional + named); (c) when `registerCrons` is called with the real config, `cron.schedule` is invoked at `'0 21 * * *'` AND `'* * * * *'` (the latter for confirmation sweep) AND `'0 10 * * *'` AND `'0 23 * * *'`. The existing 4 tests cover (b) shape; TEST-32 adds the call-site assertion.
**Warning signs:** Plan 30-03 acceptance criteria that mention only `runRitualSweep` and not `ritualConfirmationSweep`.

### Pitfall 3: m009-21days fixture does NOT exist on disk
**What goes wrong:** Plan 30-02 acceptance fails because `loadPrimedFixture('m009-21days')` throws `LOAD_PRIMED_MISSING_DIR`.
**Why it happens:** `tests/fixtures/primed/` is gitignored (`.gitignore` line for `tests/fixtures/primed/`). Currently empty (verified `ls /home/claude/chris/tests/fixtures/primed/` returns empty). Plan 30-01 generates it.
**How to avoid:** Wave 1 (Plan 30-01) MUST run successfully BEFORE Wave 2 starts. The fail-fast assertion (D-30-02) catches missing-Sunday case but only AFTER regeneration finishes — confirm regeneration before kicking off Wave 2.
**Warning signs:** Plan 30-02 acceptance check reports "fixture missing" — re-run Plan 30-01 with `--force --reseed-vcr`.

### Pitfall 4: HARN-03 sanity test is at `src/__tests__/fixtures/primed-sanity.test.ts`, NOT `tests/fixtures/primed/sanity.test.ts`
**What goes wrong:** Plan 30-01 modifies the wrong file or creates a duplicate.
**Why it happens:** CONTEXT.md says "tests/fixtures/primed/sanity.test.ts (path TBD — confirm during planning)" — the actual location is `src/__tests__/fixtures/primed-sanity.test.ts:1-93`. Vitest config (`vitest.config.ts:14-17`) only includes test files under `src/**/__tests__/**` or `scripts/**/__tests__/**` — a test under `tests/fixtures/primed/` would NOT run.
**How to avoid:** Plan 30-01 modifies `src/__tests__/fixtures/primed-sanity.test.ts`:
- Line 33: `const FIXTURE_NAME = 'm008-14days'` → `'m009-21days'`
- Line 37: `const MIN_EPISODIC_SUMMARIES = 7` → `21`
- Line 38: `MIN_PENSIEVE_ENTRIES = 200` (already covered by 21 days × ≥10 entries)
- Add 5th `it()` block: `'has >= 14 wellbeing_snapshots'` (HARN-06)
**Warning signs:** Plan 30-01 references creating new file under `tests/fixtures/primed/`.

### Pitfall 5: vi.mock factories MUST be hoisted; non-hoisted top-level consts are NOT
**What goes wrong:** Plan 30-02 declares `const mockAnthropicCreate = vi.fn()` at top of file but mock factory at line 50 references it → TypeError "Cannot access 'mockAnthropicCreate' before initialization".
**Why it happens:** Vitest hoists `vi.mock()` to the top of the file BEFORE imports. Top-level `const` is NOT hoisted. Use `vi.hoisted(() => ({ ... }))` to lift to hoist time.
**How to avoid:** Pattern from `engine-pp5.test.ts:30-33`:
```typescript
const { mockAnthropicCreate, mockAnthropicParse } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
}));
```
**Warning signs:** "Cannot access X before initialization" runtime error during test boot.

### Pitfall 6: Modules that depend on mocked deps must be imported AFTER vi.mock
**What goes wrong:** Plan 30-02 imports `processMessage` at top of file, before `vi.mock('../../llm/client.js', ...)`. Mock doesn't apply.
**Why it happens:** Imports execute when the file is loaded; `vi.mock` is hoisted but the module-resolution cache locks in the real import the first time.
**How to avoid:** Always order:
```typescript
// 1. vi.hoisted (always first)
const { mockX } = vi.hoisted(() => ({ mockX: vi.fn() }));
// 2. vi.mock factories
vi.mock('../../llm/client.js', () => ({ /* uses mockX */ }));
// 3. AFTER all vi.mock — real imports
import { processMessage } from '../engine.js';
```
Verified pattern: `engine-pp5.test.ts:60-68` (imports come AFTER the mock at lines 34-58).

### Pitfall 7: pensieve_entries cleanup race under file parallelism
**What goes wrong:** Plan 30-02's `synthetic-fixture.test.ts` deletes `pensieve_entries WHERE source='telegram'` at end; sibling test file (e.g., `live-anti-flattery.test.ts` running in parallel) loses its rows.
**Why it happens:** `pensieve_entries` has no `chat_id` column to scope cleanup. `vitest.config.ts:25` sets `fileParallelism: false` to serialize → eliminates race.
**How to avoid:** Two paths: (a) honor `fileParallelism: false` (already configured) and use `source='telegram'` cleanup OR per-process source like `synthetic-fixture-${process.pid}`; (b) prefer a static unique source `m009-synthetic-fixture` per the per-file static convention (TESTING.md:240-247). Plan 30-02 should use static FIXTURE_SOURCE.
**Warning signs:** Random test failures when running tests in parallel pools (NEVER do this); rows missing that another test wrote.

### Pitfall 8: Worktree-mode parallel execution DOES NOT trigger cleanup races
**What goes wrong:** Concern that Wave 2 (30-02 + 30-03 + 30-04) running in parallel worktrees might fight over the test DB.
**Why it doesn't happen:** Each worktree spawns its own `bash scripts/test.sh` which provisions a separate Docker postgres on port 5433 inside its own docker compose project (the compose project name defaults to the worktree dir name). Port 5433 is shared per host though — verify.
**Verified:** `scripts/test.sh:7` uses `DB_URL="postgresql://chris:localtest123@localhost:5433/chris"`. If two worktrees both bind 5433, the second `docker compose up` collides. **CHECK:** Phase 28 ran 4 waves SEQUENTIALLY explicitly because of this.
**How to avoid:** Plan 30-02/30-03/30-04 are SAFE in parallel ONLY if either (a) worktrees use different compose project names and don't both run `bash scripts/test.sh` simultaneously, OR (b) the orchestrator runs the post-merge test gate ONCE per wave. The existing convention from Phase 28 is post-merge serial — confirm with orchestrator before spawning parallel `bash scripts/test.sh` invocations.
**Warning signs:** "Port 5433 already allocated" errors during Wave 2.

### Pitfall 9: Sunday convention mismatch between JS `Date.getDay()` and Luxon `weekday`
**What goes wrong:** Plan 30-01's MANIFEST validation checks `dayOfWeek === 0` (CONTEXT.md hint) but the rest of the codebase uses ISO weekday `=== 7`.
**Why it happens:** JS `Date.prototype.getDay()` returns 0 for Sunday. Luxon `DateTime.weekday` returns 7 for Sunday (ISO). The codebase locks ISO via `RitualConfigSchema.fire_dow` at `src/rituals/types.ts:60` (`z.number().int().min(1).max(7)`).
**How to avoid:** Plan 30-01 fail-fast assertion uses Luxon: `DateTime.fromISO(date, { zone: 'Europe/Paris' }).weekday === 7`. Match the codebase convention. Document the gotcha in the test docstring.
**Warning signs:** `dayOfWeek === 0` literal in Plan 30-01 task 2 acceptance criteria — flag for revision.

### Pitfall 10: `ANTHROPIC_API_KEY=test-key` is truthy and bypasses skipIf
**What goes wrong:** `scripts/test.sh:207` defaults `ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-test-key}"`. The string `'test-key'` is truthy. `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` does NOT skip. The 5 live-LLM suites fire 401 loops against real Anthropic.
**Why it matters for Plan 30-04:** D-30-03 tightens the gate to `RUN_LIVE_TESTS || !ANTHROPIC_API_KEY` — `RUN_LIVE_TESTS` is unset by default, so `!process.env.RUN_LIVE_TESTS` is `true` and the test skips even when `ANTHROPIC_API_KEY=test-key`. **D-30-03 directly mitigates this pitfall.**
**Operational mitigation already in place:** TESTING.md:213-222 documents the 5-file `--exclude` list. After Plan 30-04 ships, `live-weekly-review.test.ts` joins the list (it would NOT need to, because the gate handles the case, but the documentation should reflect both layers of defense).
**How to avoid:** Plan 30-04 docstring on the test file makes the env-var contract explicit. TESTING.md update lists both M008 TEST-22 and M009 TEST-31 patterns. Manual run command:
```bash
RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... \
  npx vitest run src/rituals/__tests__/live-weekly-review.test.ts
```
**Warning signs:** Live test suite firing during `npm test` (CI burning $0.45 per run).

### Pitfall 11: VCR cache infinite-recursion if vcr.ts is imported AFTER SDK property swap
**What goes wrong:** Some other test or script swaps `anthropic.messages.parse = cachedMessagesParse` BEFORE `vcr.ts` snapshots `ORIGINAL_PARSE` → on miss, `cachedMessagesParse` calls `anthropic.messages.parse` which is itself → infinite recursion (6M+ events/sec, no progress).
**Why it matters for Plan 30-01:** HARN-05 documents VCR cost model. The `--reseed-vcr` flag clears the cache before re-run — verify the flag implementation does NOT re-trigger this scenario.
**Verified:** `src/__tests__/fixtures/vcr.ts:46-47` snapshots `ORIGINAL_PARSE` and `ORIGINAL_CREATE` at module load (before any swap). The invariant is documented at lines 38-45: "vcr.ts MUST be imported BEFORE any caller swaps the SDK reference."
**How to avoid:** Plan 30-01's `--reseed-vcr` implementation simply does `rm -rf tests/fixtures/.vcr` before chaining the existing fetch+synth-delta+synth-episodic flow. No SDK manipulation. Add an `--reseed-vcr` argument to the parseArgs at `scripts/regenerate-primed.ts:67-79`, then in main() at line 199-201 add: `if (args.reseedVcr) await rm('tests/fixtures/.vcr', { recursive: true, force: true });`.
**Warning signs:** Test run hangs forever (6M+ vcr.miss log lines/sec) with zero LLM calls visible to provider.

### Pitfall 12: Marker count is 40, not 17
**What goes wrong:** Plan 30-04 asserts "no 17 forbidden flattery markers" — incorrect count. Test passes vacuously.
**Why it happens:** CONTEXT.md inherits the legacy "17 markers from M006 conventions" framing from REQUIREMENTS.md TEST-31:98. Phase 29-04 SUMMARY (line 73) ships **40 markers**: `VALIDATION_MARKERS` (8) + `REFLEXIVE_OPENER_FIRST_WORDS` (15) + `FLATTERY_MARKERS` (17) = 40.
**Verified counts (2026-04-30):**
- `src/chris/__tests__/live-integration.test.ts:42-51` — 8 entries
- `src/chris/praise-quarantine.ts:36-39` — 15 entries
- `src/episodic/__tests__/live-anti-flattery.test.ts:94-112` — 17 entries
- Sum = 40 (per Phase 29-04 SUMMARY line 73)
**How to avoid:** Plan 30-04 makes NO change to marker derivation — Phase 29-04 already shipped the canonical import-and-spread pattern at `live-weekly-review.test.ts:34-43`. Plan 30-04 ONLY flips the skipIf gate.
**Warning signs:** Any plan task that says "add 17 forbidden markers" — flag for revision.

## Code Examples

### Example 1: Plan 30-02 Test-25 cumulative not-called assertion (verbatim adaptation)

```typescript
// Source pattern: src/chris/__tests__/engine-pp5.test.ts:83-92
// Adapted for Plan 30-02 14-day fixture walk:

describe('TEST-25: voice-note Pensieve persistence + cumulative Pitfall 6 regression', () => {
  // Cumulative not-called — proves PP#5 short-circuited every voice-note reply across 14 days
  afterAll(() => {
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('14 simulated days of voice-note replies all persist as RITUAL_RESPONSE without invoking Anthropic', async () => {
    for (let i = 0; i < 14; i++) {
      const date = fixtureDates[i];
      vi.setSystemTime(dateAtLocalHour(date, 'Europe/Paris', 21, 0));

      // Cron tick fires daily voice note → ritual_pending_responses row inserted
      await runRitualSweep(new Date());

      // Greg replies via STT keyboard (1h later)
      vi.setSystemTime(dateAtLocalHour(date, 'Europe/Paris', 22, 0));
      const reply = await processMessage(GREG_CHAT_ID, GREG_USER_ID, `day ${i} reply`);
      expect(reply).toBe(''); // PP#5 silent-skip
    }

    // Per-day expected: 14 RITUAL_RESPONSE entries with source_subtype='ritual_voice_note'
    const entries = await db
      .select()
      .from(pensieveEntries)
      .where(eq(pensieveEntries.epistemicTag, 'RITUAL_RESPONSE'));
    expect(entries.length).toBeGreaterThanOrEqual(14);
    for (const e of entries) {
      expect((e.metadata as any)?.source_subtype).toBe('ritual_voice_note');
    }
  });
});
```

### Example 2: Plan 30-01 `--reseed-vcr` flag wiring

```typescript
// Source: scripts/regenerate-primed.ts:67-79 — adapted to add --reseed-vcr
import { rm } from 'node:fs/promises';

({ values } = parseArgs({
  args: argv,
  options: {
    milestone: { type: 'string' },
    'target-days': { type: 'string', default: '14' },
    seed: { type: 'string', default: '42' },
    force: { type: 'boolean', default: false },
    'no-refresh': { type: 'boolean', default: false },
    'reseed-vcr': { type: 'boolean', default: false },  // ← NEW HARN-05
    help: { type: 'boolean', default: false },
  },
  // ...
}));

return {
  milestone: values.milestone,
  targetDays,
  seed,
  force: values.force ?? false,
  noRefresh: values['no-refresh'] ?? false,
  reseedVcr: values['reseed-vcr'] ?? false,  // ← NEW
};

// In main() at line ~199 (BEFORE step 1 fetch):
if (args.reseedVcr) {
  logger.info({}, 'regenerate-primed.vcr.reseed');
  await rm('tests/fixtures/.vcr', { recursive: true, force: true });
}
```

### Example 3: Plan 30-03 TEST-32 assertion (extending existing test file)

```typescript
// Source: src/rituals/__tests__/cron-registration.test.ts (file already exists; add new it() block)

it('TEST-32: registerCrons invoked from src/index.ts main() with all M009 crons', async () => {
  // Static analysis: grep src/index.ts for the registration call site.
  // This is a regression test: a future refactor that comments out registerCrons,
  // forgets to wire ritualConfirmationSweep, or moves the call to a non-main() path
  // would silently de-register crons in prod. Static check is fast + hermetic.

  const indexSource = await readFile('src/index.ts', 'utf8');

  // (1) registerCrons MUST be invoked from main()
  expect(indexSource).toMatch(/cronStatus\s*=\s*registerCrons\(\{/);

  // (2) all 4 M009 cron handlers must be passed positionally:
  expect(indexSource).toMatch(/runSweep,/);
  expect(indexSource).toMatch(/runRitualSweep,/);
  expect(indexSource).toMatch(/runConsolidateYesterday,/);
  expect(indexSource).toMatch(/ritualConfirmationSweep/);  // Phase 28 D-28-06

  // (3) registerCrons internal: the ritual cron is at '0 21 * * *' Europe/Paris
  //     (covered by existing test at file:45-62 — TEST-32 references not duplicates)
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `vi.useFakeTimers` for time-travel tests | `vi.setSystemTime` exclusively | Phase 18 D-02 (2026-04-13) | Plan 30-02 cannot regress. |
| Hand-rolled Anthropic mock | `vi.hoisted` + `vi.mock('../../llm/client.js', ...)` | Phase 21 (2026-04-19) | Plan 30-02 reuses pattern verbatim. |
| Per-file inline `MockCtx` for callback_query | Shared `simulate-callback-query.ts` helper | Plan 30-02 will EXTRACT (Phase 30) | Reduces drift across rituals tests. |
| Marker re-derivation per test | Three-source-set spread | D-10 refined (2026-04-27) | Plan 30-04 makes zero changes here. |

**Deprecated/outdated:**
- `poolOptions.forks.singleFork` — replaced by Vitest 4 top-level `fileParallelism: false` (`vitest.config.ts:25`). Do NOT re-introduce poolOptions.
- "17 forbidden markers from M006" framing in REQUIREMENTS.md TEST-31 — superseded by 40 markers (Phase 29-04 SUMMARY line 73). Plan 30-04 imports the canonical 40-marker set; do NOT redeclare 17.

## Assumptions Log

> All claims in this research are tagged `[VERIFIED: file:line]` from the codebase. No `[ASSUMED]` claims.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| (none) | All findings cite file:line in this codebase | All sections | n/a |

**Empty table:** Phase 30 is purely internal. Every claim was verified against repository files.

## Open Questions

### D-30-05: simulateCallbackQuery helper location and shape — RESOLVED

**Resolution:** Plan 30-02 OWNS the helper. Phase 27 has `buildMockCtx` inline in `src/rituals/__tests__/wellbeing.test.ts:77-86` (NOT under `fixtures/`). Plan 30-02:
1. Creates new file `src/rituals/__tests__/fixtures/simulate-callback-query.ts` exporting `simulateCallbackQuery({ callbackData, messageId? })`.
2. Refactors `wellbeing.test.ts:77-86` `buildMockCtx` → import from new helper module.
3. Imports the same helper for TEST-28 in `synthetic-fixture.test.ts`.

This keeps the convention "extract once 3+ files use it" (TESTING.md:255-257) — wellbeing + synthetic-fixture = 2 consumers. The third future consumer (when one arises) requires no further extraction. The optional `userId` parameter from CONTEXT.md D-30-05 is not needed; the wellbeing handler reads only `callbackQuery.data` and `callbackQuery.message.message_id` — confirmed by inspecting `src/rituals/wellbeing.ts handleWellbeingCallback`. If TEST-28 needs `userId`, add it then; YAGNI for v1.

### D-30-06: TEST-29 templated fallback exercise mechanism — RESOLVED

**Resolution:** Mock injection pattern is `vi.mock('../../llm/client.js', ...)` with `mockResolvedValueOnce` queue per `src/rituals/__tests__/weekly-review.test.ts:38-76`. The `mockAnthropicParse` shape returns `{ parsed_output: ... }` per Anthropic SDK contract.

**TEST-29 specific mechanism:** Force a compound question (multi-`?` or multi-leading-interrogative) on attempts 1, 2, 3 → Stage-1 Zod refine throws `MultiQuestionError` 3× → retry cap reached → templated fallback fires. Assert via:
1. `mockLoggerWarn` called with object containing `attempts: 3` and message `'chris.weekly-review.fallback-fired'` (verified at `weekly-review.ts:467-470`).
2. `bot.api.sendMessage` called with text containing `TEMPLATED_FALLBACK_EN.question` value.
3. `ritual_responses` row with `metadata.isFallback === true`.

**Critical sequencing:** The fallback path is triggered on the SECOND week of the 14-day fixture (the first week tests happy-path). The `mockResolvedValueOnce` calls must be queued in execution order: Week 1 happy-path consumes 3 calls (Stage-1 + Stage-2 + date-grounding), Week 2 fallback path consumes 3 Stage-1 calls (initial + 2 retries) → 6 total `mockResolvedValueOnce` setup calls per fixture run. Easy to off-by-one. Recommend per-week setup blocks.

### New question (surfaced during research): Does Plan 30-02 need a `BigInt(99921)` chat ID allocation?

**Recommendation:** Yes. Plan 30-02 allocates `CHAT_ID_M009_SYNTHETIC_FIXTURE = BigInt(99921)` in `src/__tests__/fixtures/chat-ids.ts` (the next free slot after 99918, 99919, 99920). All `processMessage` calls in `synthetic-fixture.test.ts` use this ID. Cleanup scoped via `eq(pensieveEntries.source, FIXTURE_SOURCE)` where `FIXTURE_SOURCE = 'm009-synthetic-fixture'`.

### New question: Does Plan 30-02 need to seed any rituals, or does the fixture include them?

**Answer:** The primed fixture writes `rituals` table rows? **No** — `loadPrimedFixture` (verified at `load-primed.ts:265-279`) inserts `relational_memory`, `wellbeing_snapshots`, `proactive_state`, `pensieve_entries`, `decisions`, `decision_capture_state`, `decision_events`, `pensieve_embeddings`, `contradictions`, `episodic_summaries`, `conversations`. **NOT `rituals`**. The `rituals` table rows are seeded by migrations 0007 (voice_note), 0008 (wellbeing), 0009 (weekly_review). These migrations run in `scripts/test.sh:64-68` BEFORE vitest fires.

**Implication for Plan 30-02:** The 3 ritual rows are present in the test DB BEFORE `loadPrimedFixture` runs. Plan 30-02 does NOT seed rituals; it can rely on the migration-seeded rows. However, the `next_run_at` on these rows points to "next real Sunday after migration apply" — Plan 30-02 must reset `next_run_at` to align with the simulated 14-day window's first day. Mirror the `scheduler.test.ts:80-84` pattern for resetting weekly_review's `next_run_at`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + docker-compose | `scripts/test.sh` (Plan 30-02) | ✓ (sandbox + live server) | per system | none — phase blocks without Docker |
| Postgres (via Docker) | Plan 30-02 real-DB tests | ✓ via `docker-compose.local.yml` port 5433 | pgvector/pgvector:pg16 | none |
| Node + npm + tsx | All scripts | ✓ | per package.json | none |
| `tests/fixtures/prod-snapshot/LATEST` | Plan 30-01 fetch step | ✓ (Apr 29 mtime) | n/a | regenerate via `--force` (Plan 30-01 uses this) |
| `tests/fixtures/.vcr/` | Plan 30-01 synth-delta cache | ✓ (Apr 25 mtime) | n/a | `--reseed-vcr` flag rebuilds (cost: real Haiku calls × 14 days × N entries/day ≈ ~$0.10) |
| `tests/fixtures/primed/m009-21days/` | Plan 30-02 input | ✗ — missing | n/a | Plan 30-01 generates as Wave 1 |
| `ANTHROPIC_API_KEY` (real) | Plan 30-04 manual run only | depends on operator | n/a | skipIf gate skips suite when missing |
| SSH access to 192.168.1.50 | `scripts/fetch-prod-data.ts` (called by `regenerate-primed.ts`) | ✓ per MEMORY.md `feedback_live_server_access.md` | n/a | none — Plan 30-01 needs prod data |

**Missing dependencies with no fallback:**
- `tests/fixtures/primed/m009-21days/` is missing — Plan 30-01 generates it. Wave 2 (30-02/03/04) blocked until Wave 1 completes.

**Missing dependencies with fallback:**
- `ANTHROPIC_API_KEY` real key — Plan 30-04 default-skip gates handle absence. Manual run only.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.x + `@vitest/coverage-v8` (per package.json) |
| Config file | `vitest.config.ts` (root='.' since Phase 24 widening) |
| Quick run command | `npx vitest run src/rituals/__tests__/synthetic-fixture.test.ts` (after Wave 1) |
| Full suite command | `bash scripts/test.sh` (Docker postgres + 11 migrations + npx vitest run) |

### Phase Requirements → Test Map (Falsifiable Verification of Each TEST-NN)

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-23 | 14-day fixture walks via `vi.setSystemTime`; full `processMessage` engine pipeline | integration | `bash scripts/test.sh src/rituals/__tests__/synthetic-fixture.test.ts` | ❌ Wave 2 (Plan 30-02) |
| TEST-24 | Daily prompt rotation: no consecutive dupes, no-repeat-in-last-6 | property | inline within synthetic-fixture.test.ts; `npx vitest run -t "TEST-24"` | ❌ Wave 2 |
| TEST-25 | Voice-note Pensieve persistence + cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` | integration + meta-regression | within synthetic-fixture.test.ts; verified by deliberate-regression meta-test (see Falsifiability below) | ❌ Wave 2 |
| TEST-26 | Skip increments only on `fired_no_response` | integration | within synthetic-fixture.test.ts; assert `rituals.skip_count` per outcome | ❌ Wave 2 |
| TEST-27 | Adjustment dialogue at threshold (daily=3, weekly=2) | integration | within synthetic-fixture.test.ts; assert `fireAdjustmentDialogue` invoked | ❌ Wave 2 |
| TEST-28 | Wellbeing via simulated callback_query | integration | within synthetic-fixture.test.ts; uses simulate-callback-query helper | ❌ Wave 2 (helper + test) |
| TEST-29 | Weekly review 1 obs + 1 Q; Stage-1 + Stage-2; templated fallback exercised | integration | within synthetic-fixture.test.ts; assert `mockLoggerWarn` called with `'chris.weekly-review.fallback-fired'` | ❌ Wave 2 |
| TEST-30 | Weekly review references specific summaries + decisions; date-grounding | integration | within synthetic-fixture.test.ts; assert observation text contains substrings from week's summaries | ❌ Wave 2 |
| TEST-31 | Live anti-flattery 3-of-3 atomic | live-LLM | `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-... npx vitest run src/rituals/__tests__/live-weekly-review.test.ts` | ✅ exists; Plan 30-04 flips skipIf |
| TEST-32 | Cron registration regression (separate file) | unit | `npx vitest run src/rituals/__tests__/cron-registration.test.ts` | ✅ exists; Plan 30-03 extends |
| HARN-04 | `m009-21days` fixture regenerated; sanity test 4/4 | substrate | `npx vitest run src/__tests__/fixtures/primed-sanity.test.ts` (after Plan 30-01 regen) | ✅ exists; Plan 30-01 modifies |
| HARN-05 | `--reseed-vcr` flag in regenerate-primed.ts | unit + manual | `npx tsx scripts/regenerate-primed.ts --milestone m009 --target-days 21 --reseed-vcr --force` | n/a (CLI verification) |
| HARN-06 | 5th sanity invariant: wellbeing_snapshots ≥ 14 | substrate | within primed-sanity.test.ts | ✅ exists; Plan 30-01 adds 5th `it()` |

### Falsifiable Verification of Each TEST-NN (the meta-question Phase 30 itself answers)

The crux of Phase 30 is that the assertions must catch real regressions. For each TEST-NN, the falsifiability check is:

| TEST-NN | Regression that test must catch | Falsifiability check |
|---------|----------------------------------|----------------------|
| TEST-25 (Pitfall 6) | A future engine change re-routes ritual replies through the LLM (PP#5 broken) | **Meta-test:** Temporarily remove the `if (pending) { ... return ''; }` block at `engine.ts:177-234`. The synthetic-fixture run MUST fail with `expected mockAnthropicCreate.not.toHaveBeenCalled() but was called 14 times`. Restore. (Optional — document in Plan 30-02 verification block.) |
| TEST-29 (templated fallback) | Stage-1 regex broken so multi-question slips through; or retry cap not enforced; or fallback log line never emitted | Assert `mockLoggerWarn.mock.calls.some(c => c[1] === 'chris.weekly-review.fallback-fired' && c[0].attempts === 3)`. The exact log line is at `weekly-review.ts:469`. If a future change broke the log line text, this regex match fails. |
| TEST-30 (date grounding) | Weekly review observation cites date outside the 7-day window | Assert observation text does NOT contain dates more than 7 days outside `[weekStart, weekEnd]`. Negative test: if `runDateGroundingCheck` becomes a no-op, observations citing far-future dates would slip through. Mock the date-grounding to return `in_window: false` once + assert the retry path fires + final fallback fires. |
| TEST-32 (cron registration) | Future refactor removes `registerCrons()` call from `src/index.ts main()` (e.g., a developer comments it out during debugging and forgets) | Static grep: `expect(indexSource).toMatch(/cronStatus\s*=\s*registerCrons\(/)`. If the call is commented out, removed, or moved to a non-main() path, the regex fails. |
| TEST-31 (live anti-flattery) | CONSTITUTIONAL_PREAMBLE injection broken; weekly review ships sycophantic flattery on first fire | Real Sonnet call against adversarial week; assert `expect(allMarkers).toEqual([])`. 40 markers cover all known flattery surfaces. Falsified if any marker appears in any of 3 iterations. |
| TEST-23 (engine pipeline integration) | Future PP#5 dispatch case (e.g., `kind === 'wellbeing_keyboard'`) doesn't get registered | The `processMessage` invocation in TEST-23 walks all 14 days; if a new dispatch case were added without test coverage, the cumulative `not.toHaveBeenCalled` would still hold (it's voice-note-specific) — but TEST-28's wellbeing flow would break separately. Cross-test coverage is the falsifiability. |

### Sampling Rate

- **Per task commit:** `bash scripts/test.sh src/rituals/__tests__/synthetic-fixture.test.ts` (~30s — single file)
- **Per wave merge:** `bash scripts/test.sh` (Wave 2 — full ritual suite, ~90s)
- **Phase gate:** Full suite green via `bash scripts/test.sh -- --exclude '**/live-*.test.ts'` (excludes 6 live-LLM files now including new live-weekly-review.test.ts) before `/gsd-verify-work`. The 5-file excluded-suite list documented at TESTING.md:213-222 expands to 6 files.

### Wave 0 Gaps

- [ ] `src/rituals/__tests__/synthetic-fixture.test.ts` — covers TEST-23..30 (Plan 30-02)
- [ ] `src/rituals/__tests__/fixtures/simulate-callback-query.ts` — extracted helper (Plan 30-02)
- [ ] `tests/fixtures/primed/m009-21days/` — primed fixture (Plan 30-01)
- [ ] `src/__tests__/fixtures/chat-ids.ts` — add `CHAT_ID_M009_SYNTHETIC_FIXTURE = BigInt(99921)` (Plan 30-02 prerequisite)
- [ ] `scripts/regenerate-primed.ts` `--reseed-vcr` flag (Plan 30-01 task)
- [ ] `src/__tests__/fixtures/primed-sanity.test.ts` — 4 invariant threshold flips + 5th `it()` block (Plan 30-01)

Framework install: none — Vitest already locked in package.json.

## Security Domain

> Required when `security_enforcement` is enabled (absent = enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — phase is internal-only test code; Telegram bot auth is unchanged |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a — no new endpoints |
| V5 Input Validation | yes (indirect) | Test fixture data is not user input but flows through real validators (`RitualConfigSchema.parse`, `WeeklyReviewSchema.parse`). Phase 30 validates via existing schemas, no new validation surface. |
| V6 Cryptography | no | n/a — VCR cache uses SHA-256 hashing of request payloads (verified at `src/__tests__/fixtures/vcr.ts:90-94`) but that's existing infrastructure, not new. |

### Known Threat Patterns for {test infrastructure}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Test code accidentally committing real `ANTHROPIC_API_KEY` to git | Information disclosure | `scripts/test.sh:207` defaults to `'test-key'` placeholder; `.env` files git-ignored. Plan 30-04 docs reinforce: never set `ANTHROPIC_API_KEY` in CI secrets without `RUN_LIVE_TESTS=1` gate (D-30-03). |
| Live test inadvertently running in CI and burning $0.45/run × N CI runs | Resource exhaustion | D-30-03 dual-gate (RUN_LIVE_TESTS AND ANTHROPIC_API_KEY). Default `npm test` skips. |
| Mocking the wrong import path silently allowing real Anthropic calls | Information disclosure (test data leak) | Mock `'../../llm/client.js'` (project's wrapper) NOT `'@anthropic-ai/sdk'` directly — wrapper consolidates the surface. Verified pattern in `engine-pp5.test.ts:34`. |
| Adversarial fixture data triggering production Anthropic moderation flag | Operational risk | `ADVERSARIAL_WEEK_INPUT` is benign emotional-tone bait, not a moderation-flag trigger. Already shipped + verified Phase 29-04. |

## Sources

### Primary (HIGH confidence)

All findings cite repository files at specific line numbers:

- `/home/claude/chris/.planning/phases/30-test-infrastructure-harn-03-refresh/30-CONTEXT.md` — locked decisions D-30-01..06
- `/home/claude/chris/.planning/REQUIREMENTS.md:90-99,84-86` — TEST-23..32, HARN-04..06 acceptance text
- `/home/claude/chris/.planning/codebase/TESTING.md:178,213-222,255-257,295-389` — testing conventions
- `/home/claude/chris/vitest.config.ts:1-27` — root='.' + fileParallelism: false
- `/home/claude/chris/scripts/test.sh:1-211` — Docker test orchestration + 11 migrations + 4 substrate gates
- `/home/claude/chris/scripts/regenerate-primed.ts:1-256` — composer; Plan 30-01 modifies parseCliArgs at line 67-119
- `/home/claude/chris/src/__tests__/fixtures/load-primed.ts:165-282` — loader contract
- `/home/claude/chris/src/__tests__/fixtures/primed-sanity.test.ts:1-93` — HARN-03 sanity invariants
- `/home/claude/chris/src/__tests__/fixtures/vcr.ts:46-165` — VCR cache + ORIGINAL_PARSE/CREATE invariant
- `/home/claude/chris/src/__tests__/fixtures/chat-ids.ts:18-28` — chat-id registry
- `/home/claude/chris/src/index.ts:75-119` — main() registerCrons call site
- `/home/claude/chris/src/cron-registration.ts:30-160` — RegisterCronsDeps + 4-cron registration
- `/home/claude/chris/src/rituals/__tests__/cron-registration.test.ts:1-115` — EXISTING file (4 tests; Plan 30-03 extends)
- `/home/claude/chris/src/rituals/__tests__/live-weekly-review.test.ts:1-101` — EXISTING file (Plan 30-04 flips skipIf at line 46)
- `/home/claude/chris/src/rituals/__tests__/wellbeing.test.ts:70-86,282-345` — buildMockCtx pattern + callback handling
- `/home/claude/chris/src/rituals/__tests__/voice-note-handler.test.ts:25-40` — bot mock pattern
- `/home/claude/chris/src/rituals/__tests__/weekly-review.test.ts:38-76` — Sonnet mock injection for fallback exercise
- `/home/claude/chris/src/rituals/__tests__/scheduler.test.ts:34-85` — runRitualSweep test pattern (mocks fireWeeklyReview)
- `/home/claude/chris/src/rituals/__tests__/fixtures/adversarial-week.ts:1-80` — Phase 29-04 fixture
- `/home/claude/chris/src/rituals/scheduler.ts:85-300` — runRitualSweep flow + adjustment dispatch
- `/home/claude/chris/src/rituals/types.ts:39-156` — RitualConfigSchema + RitualFireOutcome union
- `/home/claude/chris/src/rituals/cadence.ts:88-95` — fire_dow=7 ISO weekday convention (Sunday)
- `/home/claude/chris/src/rituals/weekly-review.ts:339-471` — MAX_RETRIES + TEMPLATED_FALLBACK_EN + log line
- `/home/claude/chris/src/chris/__tests__/engine-pp5.test.ts:30-244` — cumulative not.toHaveBeenCalled pattern
- `/home/claude/chris/src/chris/engine.ts:165-235` — PP#5 dispatch (full processMessage flow)
- `/home/claude/chris/src/chris/__tests__/live-integration.test.ts:42-51` — VALIDATION_MARKERS (8)
- `/home/claude/chris/src/chris/praise-quarantine.ts:36-39` — REFLEXIVE_OPENER_FIRST_WORDS (15)
- `/home/claude/chris/src/episodic/__tests__/live-anti-flattery.test.ts:94-112` — FLATTERY_MARKERS (17)
- `/home/claude/chris/src/episodic/__tests__/synthetic-fixture.test.ts:1-1100+` — M008 14-day mock-clock walk analog
- `/home/claude/chris/src/db/migrations/0009_weekly_review_seed.sql:1-58` — fire_dow=7, skip_threshold=2, fire_at=20:00
- `/home/claude/chris/.planning/phases/29-weekly-review/29-04-SUMMARY.md:1-100` — 40-marker count + scaffold structure
- `/home/claude/chris/.planning/phases/28-skip-tracking-adjustment-dialogue/28-04-SUMMARY.md:1-100` — autoReEnableExpiredMutes + ritualConfirmationSweep
- `/home/claude/chris/.planning/phases/25-ritual-scheduling-foundation-process-gate/25-03-SUMMARY.md` (referenced via STATE.md context, not re-read)

### Secondary (MEDIUM confidence)

- `/home/claude/chris/.planning/STATE.md` — accumulated decisions D-25-02-A..C, D-26-01-A..C, D-27-01-A..B, D-29-02-A..E

### Tertiary (LOW confidence)

(none — every claim verified)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already locked + active in test files; no version research needed
- Architecture (4-plan split): HIGH — explicitly locked in CONTEXT.md D-30-01
- Pitfalls: HIGH — all 12 pitfalls verified against repository code with file:line citations
- Code examples: HIGH — verbatim from existing files, lightly adapted
- D-30-05 + D-30-06 resolutions: HIGH — verified existing patterns at exact line numbers
- The "17 markers" → 40 markers correction: HIGH — verified by counting entries in three source files

**Research date:** 2026-04-30

**Valid until:** 2026-05-30 (30 days — internal codebase, slow-moving). After this point, re-verify line numbers if Phase 30 has not started.

## RESEARCH COMPLETE
