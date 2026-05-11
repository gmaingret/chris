# Phase 30: Test Infrastructure + HARN-03 Refresh — Pattern Map

**Mapped:** 2026-04-29
**Files analyzed:** 9 (1 new test file, 4 modified test/script files, 2 modified docs, 1 new helper, 1 new chat-id constant)
**Analogs found:** 9 / 9 (every new/modified file has a strong in-repo analog — Phase 30 is composition, not invention)

---

## File Classification

### Wave 1 — Plan 30-01 (HARN fixture refresh)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `scripts/regenerate-primed.ts` (MODIFY: add `--reseed-vcr` flag) | operator-script / CLI | batch / file-I/O | self (extending existing CLI) | role-match (extension) |
| `src/__tests__/fixtures/primed-sanity.test.ts` (MODIFY: lines 33, 37; add 5th `it()`) | test (sanity-gate) | request-response (DB read-only) | self (extending existing 4-invariant suite) | role-match (extension) |
| `tests/fixtures/primed/m009-21days/MANIFEST.json` (CREATE: regenerate output) | fixture data artifact | file-I/O (script output) | `tests/fixtures/primed/m008-14days/MANIFEST.json` (M008 prior; missing on disk now per RESEARCH §Pitfall 3 + Environment Availability) | role-match (script-emitted) |
| `.planning/codebase/TESTING.md` (MODIFY: add Live Tests + VCR cost model sections) | doc | n/a | self (existing structure) | exact (in-place add) |

### Wave 2 — Plan 30-02 (synthetic-fixture.test.ts)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/rituals/__tests__/synthetic-fixture.test.ts` (CREATE) | test (real-DB integration + mock-clock walk + cumulative not-called) | event-driven (cron tick walk) + CRUD (DB writes) | **PRIMARY:** `src/episodic/__tests__/synthetic-fixture.test.ts` (M008 14-day analog, 1100+ LoC) — same role + same data flow.<br>**SECONDARY:** `src/chris/__tests__/engine-pp5.test.ts` (Pitfall 6 cumulative not-called pattern). | exact (M008 analog) |
| `src/rituals/__tests__/fixtures/simulate-callback-query.ts` (CREATE) | test helper (Grammy Context forge) | request-response (sync builder) | `src/rituals/__tests__/wellbeing.test.ts:70-86` (`buildMockCtx` — extract verbatim, rename to `simulateCallbackQuery`) | exact (extraction) |
| `src/rituals/__tests__/wellbeing.test.ts` (MODIFY: refactor `buildMockCtx` → import shared `simulateCallbackQuery`) | test (existing suite — refactor only) | n/a (in-place) | self | exact (refactor in place) |
| `src/__tests__/fixtures/chat-ids.ts` (MODIFY: add `CHAT_ID_M009_SYNTHETIC_FIXTURE = BigInt(99921)`) | shared test constant | n/a | self (registry pattern) | exact (registry append) |

### Wave 2 — Plan 30-03 (cron-registration.test.ts EXTENSION)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/rituals/__tests__/cron-registration.test.ts` (MODIFY: ADD TEST-32 it() — file ALREADY EXISTS from Phase 25) | test (static-analysis call-site assertion) | file-I/O (read source via fs) + spy assertions | self (extending existing 4-test suite at lines 17-115) — append new `it()` block reading `src/index.ts` via `readFile` | role-match (extension; new test type — static analysis vs spy-only) |

### Wave 2 — Plan 30-04 (live-weekly-review.test.ts gate flip)

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/rituals/__tests__/live-weekly-review.test.ts` (MODIFY: line 46 skipIf predicate; reword markers on lines 4, 45) | test (live-LLM gate; default-skip) | request-response (real Anthropic) | self (Phase 29-04 scaffold lines 1-80) — single-line predicate change | exact (one-line) |
| `.planning/codebase/TESTING.md` (MODIFY: add manual invocation pattern under Live Tests section) | doc | n/a | self (existing skipIf documentation at lines 195-201) | exact (in-place add) |

---

## Pattern Assignments

### `src/rituals/__tests__/synthetic-fixture.test.ts` (test, mock-clock walk + cumulative not-called)

**Primary analog:** `src/episodic/__tests__/synthetic-fixture.test.ts` (M008 14-day, mock-clock walk against real Postgres).
**Secondary analog:** `src/chris/__tests__/engine-pp5.test.ts` (Pitfall 6 cumulative `not.toHaveBeenCalled()` pattern).
**Tertiary analog:** `src/rituals/__tests__/weekly-review.test.ts` (per-week `mockResolvedValueOnce` queue for TEST-29 templated fallback).

#### File header / docstring pattern

**Source:** `src/episodic/__tests__/synthetic-fixture.test.ts:1-30` (verbatim shape):
```typescript
/**
 * Phase 23 Plan 01 — Episodic Consolidation 14-day synthetic fixture.
 *
 * TEST-15: 14-day synthetic fixture under vi.setSystemTime with pre-labeled ground-truth importance.
 * TEST-16: Pearson r > 0.7 ...
 *
 * Run: npx vitest run src/episodic/__tests__/synthetic-fixture.test.ts
 *
 * D-02 (inherited from Phase 18): vi.setSystemTime ONLY — vi.useFakeTimers is FORBIDDEN ...
 *
 * Architecture:
 *   - Real Docker Postgres (D018): all DB writes go through real Drizzle.
 *   - Mocked Anthropic SDK (D-03): mockAnthropicParse is queued per-test ...
 *   - Mocked bot.api.sendMessage so notifyConsolidationError doesn't try to hit Telegram.
 *   - vi.setSystemTime advances mock clock between days; postgres.js timers stay real.
 */
```
Adapt for Phase 30: enumerate TEST-23 through TEST-30 (7 assertions) + the cumulative Pitfall 6 invariant.

#### Imports pattern

**Source:** `src/episodic/__tests__/synthetic-fixture.test.ts:31-51` + `src/chris/__tests__/engine-pp5.test.ts:23-24`:
```typescript
import {
  describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi,
} from 'vitest';
import { sql, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, sql as pgSql } from '../../db/connection.js';
```

#### Hoisted-mock pattern (resolves Pitfall 5)

**Source:** `src/chris/__tests__/engine-pp5.test.ts:30-41` (verbatim):
```typescript
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
```

For TEST-29 weekly-review fallback exercise, also mock the logger like `weekly-review.test.ts:38-76`:
```typescript
const { mockAnthropicParse, mockSendMessage, mockLoggerInfo, mockLoggerWarn, mockLoggerError } =
  vi.hoisted(() => ({
    mockAnthropicParse: vi.fn(),
    mockSendMessage: vi.fn().mockResolvedValue({ message_id: 12345 }),
    mockLoggerInfo: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockLoggerError: vi.fn(),
  }));

vi.mock('../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../llm/client.js')>();
  return { ...orig, anthropic: { messages: { parse: mockAnthropicParse, create: vi.fn() } } };
});
vi.mock('../../bot/bot.js', () => ({ bot: { api: { sendMessage: mockSendMessage } } }));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError },
}));
```

#### "Imports AFTER vi.mock" pattern (resolves Pitfall 6)

**Source:** `src/chris/__tests__/engine-pp5.test.ts:60-68`:
```typescript
// After all vi.mock() calls — these imports now see the mocked deps:
import { db, sql } from '../../db/connection.js';
import {
  rituals, ritualPendingResponses, ritualResponses, ritualFireEvents, pensieveEntries,
} from '../../db/schema.js';
import { processMessage } from '../engine.js';
```
For Phase 30, additionally: `import { runRitualSweep } from '../scheduler.js';` and `import { loadPrimedFixture } from '../../__tests__/fixtures/load-primed.js';`.

#### Cumulative `mockAnthropicCreate.not.toHaveBeenCalled()` pattern (TEST-25 — load-bearing)

**Source:** `src/chris/__tests__/engine-pp5.test.ts:83-92` (verbatim):
```typescript
describe('PP#5 HIT path (Phase 26 VOICE-01, VOICE-06) — Pitfall 6 contract', () => {
  // afterAll cumulative assertion — the load-bearing invariant.
  // If ANY hit-path test invokes Anthropic, this fails.
  afterAll(async () => {
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    await cleanup();
    // NOTE: do NOT call sql.end() here — pool must stay alive for the
    // sibling MISS-path describe below. File-level pool close happens in the
    // last describe's afterAll (TESTING.md afterAll convention).
  });
  beforeEach(async () => {
    await cleanup();
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
  });
  // ... it() blocks
});
```
For Phase 30 the assertion runs cumulatively across the 14-day fixture walk inside the same describe block — every voice-note simulated reply must short-circuit at PP#5.

#### `vi.setSystemTime` mock-clock walk pattern (TEST-23)

**Source:** `src/episodic/__tests__/synthetic-fixture.test.ts:551-558`:
```typescript
const fireAt = dateAtLocalHour(date, FIXTURE_TZ, 23, 0);
vi.setSystemTime(fireAt);
const result = await runConsolidate(tzDate(`${date}T12:00:00`, FIXTURE_TZ));
```
Adapt for Phase 30 to walk 14 fixture days at 09:00 (wellbeing), 21:00 (voice note), Sunday 20:00 (weekly review). DO NOT use `vi.useFakeTimers` (forbidden per `.planning/codebase/TESTING.md:178` D-02).

#### Cleanup pattern

**Source:** `src/chris/__tests__/engine-pp5.test.ts:72-81` (verbatim):
```typescript
async function cleanup(): Promise<void> {
  // Ordered cleanup: child tables first (FK constraints), then rituals fixture.
  await db.delete(ritualResponses);
  await db.delete(ritualFireEvents);
  await db.delete(ritualPendingResponses);
  await db.delete(pensieveEntries);
  await db.delete(rituals).where(eq(rituals.name, FIXTURE_RITUAL_NAME));
}
```
Phase 30 adds `wellbeingSnapshots` first (FK order — wellbeing_snapshots → ritual_fire_events → ritual_responses; mirrors `wellbeing.test.ts:101-103`).

#### Per-week `mockResolvedValueOnce` queue (TEST-29 templated fallback)

**Source:** `src/rituals/__tests__/weekly-review.test.ts:326-347` + `:370-381`:
```typescript
function mockSonnetSuccess(): void {
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: {
      observation: 'Greg pushed through a hard refactoring stretch this week.',
      question: 'What stood out?',
    },
  });
}
function mockStage2Success(): void {
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: { question_count: 1, questions: ['What stood out?'] },
  });
}
function mockDateGroundingSuccess(): void {
  mockAnthropicParse.mockResolvedValueOnce({
    parsed_output: { references_outside_window: false, dates_referenced: [] },
  });
}
```
Phase 30 Week 1 = happy path (3 calls). Week 2 = 3× compound-question Stage-1 violations (forces fallback at `MAX_RETRIES + 1 = 3` per `weekly-review.ts:467-470`).

#### Fallback log-line assertion (TEST-29)

**Source:** `src/rituals/weekly-review.ts:467-470` (verified):
```typescript
logger.warn(
  { err: errMsg, attempts: MAX_RETRIES + 1 },
  'chris.weekly-review.fallback-fired',
);
```
Assertion shape:
```typescript
expect(mockLoggerWarn).toHaveBeenCalledWith(
  expect.objectContaining({ attempts: 3 }),
  'chris.weekly-review.fallback-fired',
);
```

---

### `src/rituals/__tests__/fixtures/simulate-callback-query.ts` (test helper, extracted)

**Analog:** `src/rituals/__tests__/wellbeing.test.ts:70-86` (verbatim — extract and rename `buildMockCtx` → `simulateCallbackQuery`).

**Source pattern (verbatim):**
```typescript
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
```

**Extracted shape (Plan 30-02 — D-30-05 resolution):**
```typescript
import { vi } from 'vitest';

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

**Convention reference:** `.planning/codebase/TESTING.md:255-257` — "Do not extract to a shared module until the pattern is reused by 3+ files." Phase 30's extraction has 2 consumers (wellbeing + synthetic-fixture); proceeds because RESEARCH §D-30-05 explicitly resolves this exception.

---

### `src/rituals/__tests__/wellbeing.test.ts` (refactor only — replace inline helper)

**Change:** Replace `buildMockCtx` definition at lines 70-86 with `import { simulateCallbackQuery } from './fixtures/simulate-callback-query.js';` and update the ~20 call sites to use new shape `simulateCallbackQuery({ callbackData: 'r:w:e:3' })`.

**Verification:** Search for `buildMockCtx(` call sites. Example call at `wellbeing.test.ts:282`:
```typescript
await handleWellbeingCallback(buildMockCtx('r:w:e:3') as any, 'r:w:e:3');
```
After refactor:
```typescript
await handleWellbeingCallback(simulateCallbackQuery({ callbackData: 'r:w:e:3' }) as any, 'r:w:e:3');
```

---

### `src/__tests__/fixtures/chat-ids.ts` (registry append)

**Analog:** the file itself (lines 19-28 — append next entry after `CHAT_ID_VAGUE_VALIDATOR_LIVE = BigInt(99920)`).

**Source pattern (verbatim — Phase 18 IN-03 convention):**
```typescript
/** Phase 18 TEST-14 live vague-validator (src/decisions/__tests__/vague-validator-live.test.ts). */
export const CHAT_ID_VAGUE_VALIDATOR_LIVE = BigInt(99920);
```

**Plan 30-02 append:**
```typescript
/** Phase 30 TEST-23..30 M009 synthetic fixture (src/rituals/__tests__/synthetic-fixture.test.ts). */
export const CHAT_ID_M009_SYNTHETIC_FIXTURE = BigInt(99921);
```

---

### `src/rituals/__tests__/cron-registration.test.ts` (EXTEND — file already exists)

**Analog:** `src/rituals/__tests__/cron-registration.test.ts:1-115` (Phase 25 — append a 5th `it()` block to the existing `describe('registerCrons', ...)` block).

**Existing file structure (verified):**
- Lines 17-26: `vi.hoisted({ scheduleSpy, validateSpy })` + `vi.mock('node-cron', ...)`.
- Lines 28-30: logger mock.
- Lines 32-38: `baseConfig` constant.
- Lines 40-115: `describe('registerCrons', ...)` with 4 it() blocks.

**Pattern for new TEST-32 it() block (call-site assertion via fs.readFile of `src/index.ts`):**

**Source (cron-registration.test.ts:45-62 — existing it() block at the helper level):**
```typescript
it('registers the ritual cron at 21:00 Europe/Paris (RIT-11)', async () => {
  const { registerCrons } = await import('../../cron-registration.js');
  const status = registerCrons({
    config: baseConfig,
    runSweep: vi.fn(),
    runRitualSweep: vi.fn(),
    runConsolidateYesterday: vi.fn(),
    ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
  });
  expect(scheduleSpy).toHaveBeenCalledWith(
    '0 21 * * *', expect.any(Function), { timezone: 'Europe/Paris' },
  );
  expect(status.ritual).toBe('registered');
});
```

**TEST-32 extends with a CALL-SITE static check (different layer — verifies `src/index.ts main()` actually invokes `registerCrons`):**

**Source for shape (verified at `src/index.ts:89-95`):**
```typescript
cronStatus = registerCrons({
  config,
  runSweep,
  runRitualSweep,
  runConsolidateYesterday,
  ritualConfirmationSweep, // Phase 28 D-28-06 — 1-minute confirmation sweep
});
```

**TEST-32 new it() block to author (RESEARCH §Pitfall 2 — must include `ritualConfirmationSweep`):**
```typescript
import { readFile } from 'node:fs/promises';

it('TEST-32: registerCrons invoked from src/index.ts main() with all M009 cron handlers', async () => {
  const indexSource = await readFile('src/index.ts', 'utf8');

  // (1) registerCrons MUST be invoked
  expect(indexSource).toMatch(/cronStatus\s*=\s*registerCrons\(\{/);

  // (2) all 4 M009 cron handlers must be passed:
  expect(indexSource).toMatch(/runSweep,/);
  expect(indexSource).toMatch(/runRitualSweep,/);
  expect(indexSource).toMatch(/runConsolidateYesterday,/);
  expect(indexSource).toMatch(/ritualConfirmationSweep/);  // Phase 28 D-28-06

  // (3) ritualConfirmation cron expression hardcoded at '* * * * *' in cron-registration.ts:126
  const cronRegSource = await readFile('src/cron-registration.ts', 'utf8');
  expect(cronRegSource).toMatch(/'\* \* \* \* \*'/);
});
```

**Critical anti-pattern to avoid (RESEARCH §Pitfall 1):** Do NOT re-author the file from scratch. Append to the existing describe block.

---

### `src/rituals/__tests__/live-weekly-review.test.ts` (one-line skipIf change)

**Analog:** the file itself (Phase 29-04 scaffold — `:46` is the skipIf line).

**Source pattern (verified at `live-weekly-review.test.ts:45-48`):**
```typescript
// PHASE-30: enable in TEST-31 (flip skipIf, add to scripts/test.sh excluded list).
describe.skipIf(!process.env.ANTHROPIC_API_KEY)(
  'live-weekly-review (PHASE-30: enable in TEST-31; HARD CO-LOC #6)',
  () => {
```

**Plan 30-04 modification (D-30-03 cost discipline — exact one-line edits):**
```typescript
// PHASE-30: live execution gate flipped per TEST-31 (HARD CO-LOC #6).
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)(
  'live-weekly-review (HARD CO-LOC #6 — TEST-31)',
  () => {
```

Also reword line 4 (file header):
```typescript
// BEFORE:  PHASE-30: enable in TEST-31 (HARD CO-LOC #6).
// AFTER:   PHASE-30: live execution gate flipped per TEST-31 (HARD CO-LOC #6).
```

**Critical anti-pattern (RESEARCH §Pitfall 12):** Do NOT redeclare the 17-marker list. The 40-marker (8 + 15 + 17) spread import at lines 35-43 is canonical and stays untouched.

---

### `src/__tests__/fixtures/primed-sanity.test.ts` (HARN-06 — flip thresholds + add 5th invariant)

**Analog:** the file itself (existing 4-invariant suite at lines 51-93).

**Source pattern (verbatim from existing `it()` block at lines 56-61):**
```typescript
it(`has >= ${MIN_EPISODIC_SUMMARIES} episodic summaries`, async () => {
  const [row] = await db
    .select({ n: drizzleSql<number>`count(*)::int` })
    .from(episodicSummaries);
  expect(row?.n ?? 0).toBeGreaterThanOrEqual(MIN_EPISODIC_SUMMARIES);
});
```

**Plan 30-01 changes (verified per RESEARCH §Pitfall 4):**
- **Line 33:** `const FIXTURE_NAME = 'm008-14days'` → `'m009-21days'`
- **Line 37:** `const MIN_EPISODIC_SUMMARIES = 7` → `21`
- **Line 38:** `const MIN_PENSIEVE_ENTRIES = 200` (no change — already met by 21 days)
- **Add 5th invariant** (HARN-06) after the 4th `it()` block at line 92, mirroring the existing pattern but using a feature-detected count of `wellbeing_snapshots`:
```typescript
it('has >= 14 wellbeing_snapshots (HARN-06 — M009 substrate fixture invariant)', async () => {
  // wellbeing_snapshots is feature-detected by load-primed.ts:220 via to_regclass.
  // If the table is absent, treat as failure (HARN-06 requires the table to exist
  // and contain ≥14 days of synthetic data).
  const [row] = await db
    .select({ n: drizzleSql<number>`count(*)::int` })
    .from(wellbeingSnapshots);
  expect(row?.n ?? 0).toBeGreaterThanOrEqual(14);
});
```

Add `wellbeingSnapshots` to the schema import block at line 30:
```typescript
import { episodicSummaries, pensieveEntries, wellbeingSnapshots } from '../../db/schema.js';
```

---

### `scripts/regenerate-primed.ts` (HARN-05 — add `--reseed-vcr` flag)

**Analog:** the file itself (existing `parseArgs` at lines 58-119; `main()` at lines 180-252).

**Existing parseArgs pattern (verbatim from lines 67-79):**
```typescript
({ values } = parseArgs({
  args: argv,
  options: {
    milestone: { type: 'string' },
    'target-days': { type: 'string', default: '14' },
    seed: { type: 'string', default: '42' },
    force: { type: 'boolean', default: false },
    'no-refresh': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
}));
```

**Existing return shape (verbatim from lines 113-119):**
```typescript
return {
  milestone: values.milestone,
  targetDays,
  seed,
  force: values.force ?? false,
  noRefresh: values['no-refresh'] ?? false,
};
```

**Plan 30-01 modification (HARN-05 + RESEARCH §Pitfall 11):**

Add to options object:
```typescript
'reseed-vcr': { type: 'boolean', default: false },  // HARN-05
```

Add to `Args` interface at lines 50-56:
```typescript
export interface Args {
  milestone: string;
  targetDays: number;
  seed: number;
  force: boolean;
  noRefresh: boolean;
  reseedVcr: boolean;  // HARN-05
}
```

Add to return shape:
```typescript
reseedVcr: values['reseed-vcr'] ?? false,
```

Wire into `main()` BEFORE the fetch step (line ~199 — between `parseCliArgs` and the fetch logic):
```typescript
import { rm } from 'node:fs/promises';
// ...
if (args.reseedVcr) {
  logger.info({}, 'regenerate-primed.vcr.reseed');
  await rm('tests/fixtures/.vcr', { recursive: true, force: true });
}
```

VCR cache directory is `tests/fixtures/.vcr` (verified at `src/__tests__/fixtures/vcr.ts:53`: `export let VCR_DIR = 'tests/fixtures/.vcr';`).

Update usage line at `printUsage()` (lines 122-135):
```typescript
console.log(
  'Usage: npx tsx scripts/regenerate-primed.ts --milestone <name> [--target-days 14] [--seed 42] [--force] [--no-refresh] [--reseed-vcr]',
);
console.log('  --reseed-vcr clears tests/fixtures/.vcr before re-run (HARN-05).');
```

---

### `.planning/codebase/TESTING.md` (add Live Tests + VCR cost model sections)

**Analogs (in-file):**
- Existing "Live-LLM Test Suite (Real API Key)" section at lines 182-208.
- Existing "Excluded-Suites Mechanism" at lines 210-230.

**Plan 30-01 additions (HARN-05 — VCR cost model section):**

Add new top-level section after "Fixture Patterns" (line 232+):
```markdown
## VCR Cache Cost Model (HARN-05)

The primed-fixture pipeline uses a deterministic VCR cache at `tests/fixtures/.vcr/<sha256>.json` (`src/__tests__/fixtures/vcr.ts:53`). Cache keys are SHA-256 hashes of the canonical-stringified request payload — model + prompt + schema. Hash auto-invalidates on any of those inputs changing.

**Cost reference (per 14-day fixture regeneration):**
- Style-transfer Haiku calls (synthesize-delta): ~140 entries × $0.001 ≈ **$0.14**
- Episodic-consolidation Sonnet calls (synthesize-episodic): 14 days × $0.005 ≈ **$0.07**
- Total cold-cache: **~$0.21 per regeneration**
- Warm cache: $0.00 (all hits)

**Reseed mechanism (HARN-05):**
```bash
npx tsx scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force --reseed-vcr
```
The `--reseed-vcr` flag wipes `tests/fixtures/.vcr` BEFORE running the fetch + delta + episodic chain. Use only when:
1. Anthropic prompt template changed and you need fresh outputs to populate the cache (rare).
2. Cache directory has corrupted entries (very rare).
3. Auditing cost (clean accounting boundary).

Default (no `--reseed-vcr`): cache preserved; missing entries warn and fall through to live API.

**Pitfall avoided:** `vcr.ts:46-47` snapshots `ORIGINAL_PARSE`/`ORIGINAL_CREATE` at module load — `--reseed-vcr` does NOT manipulate the SDK reference (just clears the file cache), so it cannot trigger the recursive-self-call infinite loop documented at `vcr.ts:38-45`.
```

**Plan 30-04 additions (TEST-31 manual invocation pattern):**

Add to existing "Live-LLM Test Suite" section (line ~208):
```markdown
### Live Tests (manual gate required — RUN_LIVE_TESTS + ANTHROPIC_API_KEY)

Two suites require BOTH `RUN_LIVE_TESTS=1` AND `ANTHROPIC_API_KEY` to run (D-30-03 cost discipline — `RUN_LIVE_TESTS` blocks the `ANTHROPIC_API_KEY=test-key` foot-gun documented at scripts/test.sh:79):

| File | Phase | Cost / run |
|------|-------|------------|
| `src/episodic/__tests__/live-anti-flattery.test.ts` | M008 TEST-22 / D038 | ~$0.45 |
| `src/rituals/__tests__/live-weekly-review.test.ts` | M009 TEST-31 / Phase 30-04 | ~$0.05 |

**Manual invocation pattern:**
```bash
RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... \
  npx vitest run src/rituals/__tests__/live-weekly-review.test.ts
```

The default `npm test` / `bash scripts/test.sh` runs WITHOUT `RUN_LIVE_TESTS=1` set, so these tests skip cleanly even when `ANTHROPIC_API_KEY` is the truthy `test-key` placeholder.
```

---

### `tests/fixtures/primed/m009-21days/MANIFEST.json` (HARN-04 — script-emitted artifact)

**Analog:** structure produced by `scripts/synthesize-episodic.ts` (output of the regenerate-primed pipeline). Read by `loadPrimedFixture` at `src/__tests__/fixtures/load-primed.ts:182-184`:
```typescript
const manifest = JSON.parse(
  await readFile(manifestPath, 'utf8'),
) as PrimedManifest;
```

**Not authored by hand.** Plan 30-01 Task 1 runs `npx tsx scripts/regenerate-primed.ts --milestone m009 --target-days 21 --force` to emit it; Plan 30-01 Task 2 reads it and asserts the D-30-02 fail-fast invariants (window contains ≥1 Sunday using ISO weekday `=== 7` per RESEARCH §Pitfall 9).

---

## Shared Patterns

### Pattern S-1: vi.hoisted + vi.mock for Anthropic SDK

**Source:** `src/chris/__tests__/engine-pp5.test.ts:30-41` (canonical for Plan 30-02 since Plan 30-02 is the ONLY new test file requiring SDK mocks).
**Apply to:** Plan 30-02 (`synthetic-fixture.test.ts`).
**Rationale:** Plan 30-03's `cron-registration.test.ts` already has its own hoisted-mock pattern (lines 17-26 — schedule/validate spies, NOT Anthropic). Plan 30-04's `live-weekly-review.test.ts` does NOT mock — it intentionally hits real Sonnet.

### Pattern S-2: Per-file FIXTURE_SOURCE / FIXTURE_PREFIX cleanup discriminator

**Source:** `.planning/codebase/TESTING.md:232-247` ("Per-file unique source tag for `pensieve_entries` cleanup") + `src/rituals/__tests__/scheduler.test.ts:44` (`const FIXTURE_PREFIX = 'sched-test-';`).
**Apply to:** Plan 30-02 — declare `const FIXTURE_SOURCE = 'm009-synthetic-fixture';` at top of file; cleanup with `eq(pensieveEntries.source, FIXTURE_SOURCE)`. Avoids race with sibling test files that also delete from `pensieve_entries`.

### Pattern S-3: FK-safe cleanup order

**Source:** `src/rituals/__tests__/wellbeing.test.ts:101-103` + `src/__tests__/fixtures/load-primed.ts:222-241` (verified FK order):
```typescript
// FK order: wellbeing_snapshots → ritual_fire_events → ritual_responses
await db.delete(wellbeingSnapshots);
await db.delete(ritualFireEvents);
await db.delete(ritualResponses);
```
**Apply to:** Plan 30-02 cleanup function (extends `engine-pp5.test.ts:72-81` with `wellbeingSnapshots` first since Plan 30-02 exercises wellbeing snapshots in TEST-28).

### Pattern S-4: `sql.end()` in afterAll for DB-touching files

**Source:** `.planning/codebase/TESTING.md:141` ("Always call `sql.end()` in `afterAll`...").
**Reference impl:** `src/rituals/__tests__/scheduler.test.ts:84` (`await sql.end();` in afterAll after restoring weekly_review nextRunAt).
**Apply to:** Plan 30-02 (synthetic-fixture.test.ts) — single afterAll for the LAST top-level describe block.

### Pattern S-5: Sunday detection convention (ISO weekday 7, NOT JS `getDay() === 0`)

**Source:** `src/db/migrations/0009_weekly_review_seed.sql:23-28` + `src/rituals/cadence.ts:88-95` + RESEARCH §Pitfall 9.
**Apply to:**
- Plan 30-01 fail-fast MANIFEST validation (D-30-02 task 2): use Luxon `DateTime.fromISO(date, { zone: 'Europe/Paris' }).weekday === 7`.
- Plan 30-02 mock-clock walk: same Luxon convention to detect Sunday for the weekly_review fire (TEST-29).

### Pattern S-6: `loadPrimedFixture(name)` loader

**Source:** `src/__tests__/fixtures/load-primed.ts:165-168` (signature):
```typescript
export async function loadPrimedFixture(
  name: string,
  opts: LoadPrimedOptions = {},
): Promise<void>
```
**Existing usage:** `src/__tests__/fixtures/primed-sanity.test.ts:53` — `await loadPrimedFixture(FIXTURE_NAME);` inside `beforeAll`.
**Apply to:** Plan 30-02 — same `beforeAll` pattern with `FIXTURE_NAME = 'm009-21days'`. Loader handles 11 tables in correct FK order; feature-detects `wellbeing_snapshots` at line 220 — Plan 30-02 inherits this for free.

### Pattern S-7: Numbered test coverage block in file header

**Source:** `.planning/codebase/TESTING.md:131-137` + visible at every test file (e.g., `src/rituals/__tests__/wellbeing.test.ts:11-35`):
```typescript
/**
 * 8 behaviors covered (Plan 27-03 task 2 <behavior>):
 *
 *   1. fireWellbeing inserts ritual_responses row + sends 4-row keyboard ...
 *   2. No-anchor keyboard output ...
 *   ...
 */
```
**Apply to:** Plan 30-02 file header — enumerate TEST-23 through TEST-30 with one-liner descriptions.

### Pattern S-8: TESTING.md doc structure (in-place section addition)

**Source:** `.planning/codebase/TESTING.md` overall — uses `##` for top-level sections, `###` for sub-sections, fenced code blocks with bash/typescript labels, and inline references like `src/path/file.ts:LINE`.
**Apply to:** Plans 30-01 (VCR cost model) + 30-04 (Live Tests manual gate) — match existing style; do not invent new heading structures.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | Phase 30 is composition. Every file has a strong in-repo analog per RESEARCH §"Don't Hand-Roll" (lines 380-389) and RESEARCH §State of the Art. |

---

## Metadata

**Analog search scope:**
- `src/rituals/__tests__/` (8 test files including `wellbeing.test.ts`, `weekly-review.test.ts`, `scheduler.test.ts`, `cron-registration.test.ts`, `live-weekly-review.test.ts`)
- `src/episodic/__tests__/` (`synthetic-fixture.test.ts` — M008 14-day analog, 1100+ LoC)
- `src/chris/__tests__/` (`engine-pp5.test.ts` — Pitfall 6 cumulative not-called pattern)
- `src/__tests__/fixtures/` (`load-primed.ts`, `chat-ids.ts`, `primed-sanity.test.ts`, `vcr.ts`)
- `src/cron-registration.ts`, `src/index.ts`, `src/rituals/scheduler.ts`, `src/rituals/weekly-review.ts` (production code referenced by assertions)
- `scripts/regenerate-primed.ts` (extension target for HARN-05)
- `.planning/codebase/TESTING.md` (doc patterns)

**Files scanned:** ~14 source files cited by file:line.

**Pattern extraction date:** 2026-04-29.

**Key insight:** This phase is **composition, not invention**. Every analog pattern exists in tree. The work is wiring + assertion authorship, not infrastructure design (RESEARCH line 11). Planner should reference each analog by `file:line` in PLAN action items rather than re-deriving patterns.
