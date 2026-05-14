# Phase 40: Psychological Milestone Tests — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 8 (1 MODIFIED + 7 NEW)
**Analogs found:** 8 / 8 (100% — Phase 36 M010 + Phase 38 are direct mirrors)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/synthesize-delta.ts` (MODIFIED) | build-time CLI / utility | batch / transform | self — existing `--profile-bias` block (lines 82-193 + 320-332 + 678-691) | exact (self-extension) |
| `tests/fixtures/primed/m011-30days/` (NEW dir) | test fixture artifact | file-I/O | `tests/fixtures/primed/m010-30days/` | exact |
| `tests/fixtures/primed/m011-1000words/` (NEW dir) | test fixture artifact | file-I/O | `tests/fixtures/primed/m010-5days/` | exact |
| `src/__tests__/fixtures/primed-sanity-m011.test.ts` (NEW) | test (HARN gate) | request-response (DB read) | `src/__tests__/fixtures/primed-sanity-m010.test.ts` | exact |
| `src/__tests__/fixtures/seed-psych-profile-rows.ts` (NEW) | test fixture helper / utility | CRUD (DELETE + UPSERT) | `src/__tests__/fixtures/seed-profile-rows.ts` (shape) + `psychological-profile-updater.integration.test.ts:183-226` (body) | hybrid |
| `src/memory/profiles/__tests__/integration-m011-1000words.test.ts` (NEW) | test (integration, sparse) | request-response (mocked SDK + real DB) | `src/memory/profiles/__tests__/integration-m010-5days.test.ts` | exact |
| `src/memory/profiles/__tests__/integration-m011-30days.test.ts` (NEW) | test (integration, populated + 3-cycle) | request-response (mocked SDK + real DB) | `src/memory/profiles/__tests__/integration-m010-30days.test.ts` (structure) + `src/memory/__tests__/psychological-profile-updater.integration.test.ts:271-391` (assertion semantics) | hybrid |
| `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` (NEW) | test (live, dual-gated) | request-response (real Sonnet API) | `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` | exact |
| `src/__tests__/fixtures/chat-ids.ts` (MODIFIED) | test fixture constant | n/a | self — append next BigInt ID | exact (self-extension) |

---

## Pattern Assignments

### `scripts/synthesize-delta.ts` (MODIFIED — build-time CLI / batch transform)

**Analog:** Self — extend existing `--profile-bias` plumbing.

**Imports pattern** (lines 47 — already in place; no new imports needed):
```typescript
import { parseArgs } from 'node:util';
```

**Whitelist constant + Dimension type pattern** (lines 103-109 — M011 omits the type, uses a boolean):
```typescript
// M010 pattern (DO NOT COPY for M011 — boolean flag has no whitelist):
export type Dimension = 'jurisdictional' | 'capital' | 'health' | 'family';
const DIMENSIONS = ['jurisdictional', 'capital', 'health', 'family'] as const;
```
**M011 divergence:** No whitelist needed; `parseArgs` `type: 'boolean'` rejects unknown values automatically. The phase introduces **two new exported constants** instead:
- `PSYCH_PROFILE_BIAS_KEYWORDS: readonly string[]` (single flat tuple, NOT a `Record`)
- `OPENNESS_SIGNAL_PHRASES: readonly string[]` (for HARN gate import)

**Keyword constant pattern** (lines 112-156 — copy structure, flatten to single tuple):
```typescript
/**
 * D-05: per-dimension keyword hints sourced from FEATURES.md ...
 * Plan 36-01 Task 4's HARN sanity gate imports this constant ...
 */
export const PROFILE_BIAS_KEYWORDS: Record<Dimension, readonly string[]> = {
  jurisdictional: [
    'current location', 'country', 'residency status', ...
  ],
  ...
};
```
**M011 shape (single signature, NOT a Record):**
```typescript
export const PSYCH_PROFILE_BIAS_KEYWORDS: readonly string[] = [
  // Openness signals
  'intellectual curiosity', 'novel ideas', 'unconventional approach', ...
  // Conscientiousness signals
  'planning', 'structured approach', 'follow-through', ...
  // ... 6 categories total per CONTEXT.md D-05
] as const;

export const OPENNESS_SIGNAL_PHRASES: readonly string[] = [
  'worth exploring', "I'd be curious", 'different angle',
  'I wonder if', 'have you considered', 'another perspective',
] as const;
```

**Hint-computation function pattern** (lines 185-193 — copy shape, simplify to boolean):
```typescript
// M010 pattern (round-robin rotation across 4 dims):
export function dimensionHintFor(
  dayIndex: number,
  biases: readonly Dimension[],
): string | undefined {
  if (biases.length === 0) return undefined;
  const rotated = PROFILE_BIAS_ROTATION[dayIndex % PROFILE_BIAS_ROTATION.length]!;
  if (!biases.includes(rotated)) return undefined;
  return PROFILE_BIAS_KEYWORDS[rotated].join(', ');
}
```
**M011 simplified shape (boolean toggle, dayIndex unused):**
```typescript
export function psychDimensionHintFor(
  dayIndex: number,
  enabled: boolean,
): string | undefined {
  if (!enabled) return undefined;
  void dayIndex;  // single signature; index unused (API symmetry with M010)
  return PSYCH_PROFILE_BIAS_KEYWORDS.join(', ');
}
```

**`parseArgs` registration pattern** (lines 272-287 — add boolean option):
```typescript
({ values: raw } = parseArgs({
  args: argv,
  options: {
    organic: { type: 'string' },
    'target-days': { type: 'string' },
    seed: { type: 'string' },
    milestone: { type: 'string' },
    'no-refresh': { type: 'boolean', default: false },
    'profile-bias': { type: 'string', multiple: true },     // M010 keep
    'psych-profile-bias': { type: 'boolean', default: false },  // M011 ADD
    help: { type: 'boolean', default: false },
  },
  strict: true,
  allowPositionals: false,
}));
```

**Args interface + return pattern** (lines 197-208, 334-342 — add field):
```typescript
export interface Args {
  organic: string;
  targetDays: number;
  seed: number;
  milestone: string;
  noRefresh: boolean;
  profileBias?: readonly Dimension[];
  psychProfileBias?: boolean;  // M011 ADD
}
```

**Per-day Haiku call-site pattern** (lines 684-691 — parallel branch):
```typescript
// M010 existing:
const profileBias = opts.profileBias ?? [];
// ... inside loop:
const hint = dimensionHintFor(d, profileBias);
const systemPrompt = buildHaikuSystemPrompt(fewShot, dayDateStr, ENTRIES_PER_DAY, hint);
```
**M011 addition (single-hint precedence — see below):**
```typescript
const psychEnabled = opts.psychProfileBias ?? false;
// ... inside loop:
const psychHint = psychDimensionHintFor(d, psychEnabled);
const m010Hint = dimensionHintFor(d, profileBias);
// Planner picks precedence: M011 says when --psych-profile-bias is set, it's
// the dominant signature for the milestone. Recommend: psychHint OR m010Hint
// (psych wins if both somehow set). Document the choice in plan SUMMARY.
const hint = psychHint ?? m010Hint;
```

**Help text pattern** (lines 243-258 — append flag line):
```typescript
function printUsage(): void {
  console.log(
    `Usage: ... [--profile-bias <dim>]... [--psych-profile-bias]
...
  --psych-profile-bias   boolean; appends a fixed personality-signature keyword
                          hint to every day's Haiku prompt (M011 PMT-01).
                          Mutually informative with --profile-bias (planner choice).`,
  );
}
```

---

### `tests/fixtures/primed/m011-30days/` (NEW dir, operator-regenerated)

**Analog:** `tests/fixtures/primed/m010-30days/`

**Directory contents pattern** (identical 11-file shape — operator runs `regenerate-primed.ts` and the script writes these):
```
m011-30days/
├── MANIFEST.json
├── contradictions.jsonl
├── decision_capture_state.jsonl
├── decision_events.jsonl
├── decisions.jsonl
├── episodic_summaries.jsonl
├── pensieve_embeddings.jsonl
├── pensieve_entries.jsonl
├── proactive_state.jsonl
├── relational_memory.jsonl
└── wellbeing_snapshots.jsonl
```

**Regeneration command (in plan SUMMARY as operator-action checkpoint):**
```bash
npx tsx scripts/regenerate-primed.ts --milestone m011 --target-days 30 \
  --psych-profile-bias --force --seed 42
```

**No source code to write** — this is an operator-action checkpoint. The fixture is gitignored per `.gitignore` Phase 24 D-13.

---

### `tests/fixtures/primed/m011-1000words/` (NEW dir, operator-regenerated)

**Analog:** `tests/fixtures/primed/m010-5days/`

**Regeneration command:**
```bash
npx tsx scripts/regenerate-primed.ts --milestone m011-1000words --target-days 5 \
  --psych-profile-bias --force --seed 42
```

Sparse fixture: 5 days × ~200 words/day ≈ 1,000 words (provably below 5,000 floor).

---

### `src/__tests__/fixtures/primed-sanity-m011.test.ts` (NEW — HARN sanity gate)

**Analog:** `src/__tests__/fixtures/primed-sanity-m010.test.ts`

**Header docblock pattern** (lines 1-51 — copy & adapt):
```typescript
/**
 * src/__tests__/fixtures/primed-sanity-m011.test.ts — Phase 40 Plan 01 Task X
 * (PMT-01 HARN half — paired with the unit-test half at
 * scripts/__tests__/synthesize-delta-psych-profile-bias.test.ts).
 *
 * HARN sanity gate for the M011 primed fixtures. Mirrors
 * `src/__tests__/fixtures/primed-sanity-m010.test.ts` (Phase 36 / 36-01-PLAN)
 * verbatim — same FIXTURE_PRESENT skip-when-absent pattern, same describe-
 * per-fixture structure.
 *
 * Two describe blocks:
 *
 *   1. m011-30days — populated fixture (PMT-04/05 input):
 *      - Total telegram-source pensieve wordCount > 5000 (D-06 verbatim)
 *      - At least one OPENNESS_SIGNAL_PHRASES phrase present in
 *        concatenated pensieve content (D-06/D-07 — Pitfall 7 mitigation
 *        against Haiku signal erasure)
 *
 *   2. m011-1000words — sparse fixture (PMT-03 input):
 *      - Total telegram-source pensieve wordCount < 5000 (D-13 trip-wire)
 *      - wordCount >= 1 (anti-zero — fixture must be non-empty)
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/__tests__/fixtures/primed-sanity-m011.test.ts
 */
```

**Imports + FIXTURE_PRESENT gate pattern** (lines 52-72, 155-171 — verbatim):
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { pensieveEntries } from '../../db/schema.js';
import { loadPrimedFixture } from './load-primed.js';
// Import constants from synthesize-delta.ts (single source of truth — OQ-1 resolved):
import {
  PSYCH_PROFILE_BIAS_KEYWORDS,
  OPENNESS_SIGNAL_PHRASES,
} from '../../../scripts/synthesize-delta.js';

const M30_NAME = 'm011-30days';
const M30_PATH = `tests/fixtures/primed/${M30_NAME}/MANIFEST.json`;
const M30_PRESENT = existsSync(M30_PATH);

if (!M30_PRESENT) {
  console.log(
    `[primed-sanity-m011] SKIP: ${M30_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m011 --target-days 30 ` +
      `--psych-profile-bias --force --seed 42`,
  );
}
const skipIfM30Absent = M30_PRESENT ? describe : describe.skip;
```

**Describe-block pattern** (lines 173-204 — adapt assertions to M011):
```typescript
skipIfM30Absent('primed-sanity-m011: m011-30days fixture (PMT-01 HARN; D-06)', () => {
  beforeAll(async () => {
    await loadPrimedFixture(M30_NAME);
  });

  it(`has total telegram-source pensieve wordCount > 5000 (D-06)`, async () => {
    // Sum word counts from pensieve_entries where source='telegram' AND deleted_at IS NULL.
    // Phase 37 substrate filter — non-telegram entries don't count toward wordCount.
    const rows = await db.execute<{ word_count: number }>(
      drizzleSql`SELECT COALESCE(SUM(array_length(regexp_split_to_array(content, '\\s+'), 1)), 0)::int AS word_count
                  FROM pensieve_entries
                  WHERE source = 'telegram' AND deleted_at IS NULL`,
    );
    const first = Array.isArray(rows) ? rows[0] : (rows as { 0?: unknown })[0];
    const n = (first as { word_count?: number } | undefined)?.word_count ?? 0;
    expect(n).toBeGreaterThan(5000);
  });

  it(`has >= 1 OPENNESS_SIGNAL_PHRASES present in pensieve content (D-07 Pitfall 7 mitigation)`, async () => {
    const rows = await db.execute<{ content: string }>(
      drizzleSql`SELECT content FROM pensieve_entries
                  WHERE source = 'telegram' AND deleted_at IS NULL`,
    );
    const allContent = (Array.isArray(rows) ? rows : []).map((r) => r.content).join('\n').toLowerCase();
    const phrasesFound = OPENNESS_SIGNAL_PHRASES.filter((p) => allContent.includes(p.toLowerCase()));
    expect(phrasesFound.length, `Expected >= 1 OPENNESS_SIGNAL_PHRASES; found ${phrasesFound.length}/${OPENNESS_SIGNAL_PHRASES.length}`).toBeGreaterThanOrEqual(1);
  });
});
```

**Sparse-fixture describe pattern** (lines 207-269 — adapt):
```typescript
const M1K_NAME = 'm011-1000words';
const M1K_PATH = `tests/fixtures/primed/${M1K_NAME}/MANIFEST.json`;
const M1K_PRESENT = existsSync(M1K_PATH);
if (!M1K_PRESENT) {
  console.log(
    `[primed-sanity-m011] SKIP: ${M1K_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m011-1000words --target-days 5 ` +
      `--psych-profile-bias --force --seed 42`,
  );
}
const skipIfM1KAbsent = M1K_PRESENT ? describe : describe.skip;

skipIfM1KAbsent('primed-sanity-m011: m011-1000words fixture (PMT-03 input; D-13 sparse)', () => {
  beforeAll(async () => {
    await loadPrimedFixture(M1K_NAME);
  });
  it(`has wordCount < 5000 (D-13 trip-wire)`, async () => { /* same SQL, expect < 5000 */ });
  it(`has wordCount >= 1 (anti-zero)`, async () => { /* same SQL, expect >= 1 */ });
});
```

**Cross-import trip-wire** (lines 66-72 — keep the lint-friendly touch):
```typescript
// Touch the PSYCH_PROFILE_BIAS_KEYWORDS import so eslint doesn't complain
// about unused binding; trip-wire if the export shape changes upstream.
if (PSYCH_PROFILE_BIAS_KEYWORDS.length < 10) {
  console.warn(`[primed-sanity-m011] PSYCH_PROFILE_BIAS_KEYWORDS shrank to ${PSYCH_PROFILE_BIAS_KEYWORDS.length}; signal density may degrade`);
}
```

---

### `src/__tests__/fixtures/seed-psych-profile-rows.ts` (NEW — DB helper)

**Analog (shape):** `src/__tests__/fixtures/seed-profile-rows.ts`
**Analog (body):** `src/memory/__tests__/psychological-profile-updater.integration.test.ts:183-226` (`cleanupAll()`)

**File header / docblock pattern** (M010 lines 1-42 — adapt to M011):
```typescript
/**
 * src/__tests__/fixtures/seed-psych-profile-rows.ts — Phase 40 Plan 01 Task X
 *
 * Idempotent helper that re-applies the migration-0013 seed-row values for
 * all 3 psychological-profile tables (`profile_hexaco`, `profile_schwartz`,
 * `profile_attachment`) and wipes the corresponding `profile_history` rows.
 * Tests call this in `beforeEach` to reset profile state before each scenario.
 *
 * **Sibling of M010's `seed-profile-rows.ts`, NOT a parameterization** — the
 * two profile families have different table sets + different cold-start values.
 *
 * IMPORTANT: profile_history wipe is SCOPED via
 *   WHERE profile_table_name IN ('profile_hexaco', 'profile_schwartz', 'profile_attachment')
 * so M010 history rows are preserved (cross-milestone decoupling).
 *
 * Body extracted from Phase 38 cleanupAll() at
 *   src/memory/__tests__/psychological-profile-updater.integration.test.ts:183-226
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-30days.test.ts
 */
```

**Imports + interface pattern** (M010 lines 43-56 — verbatim):
```typescript
import type postgres from 'postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import { db, sql as pgSql } from '../../db/connection.js';
import { profileHexaco, profileSchwartz, profileAttachment, profileHistory } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';

export interface SeedPsychProfileRowsOptions {
  dbOverride?: postgres.Sql;
}
```

**Body pattern** (combines M010 shape with Phase 38 `cleanupAll` body):
```typescript
export async function seedPsychProfileRows(
  opts: SeedPsychProfileRowsOptions = {},
): Promise<void> {
  const client: postgres.Sql = opts.dbOverride ?? pgSql;

  // Step 1: SCOPED wipe of profile_history (preserve M010 rows).
  await db.delete(profileHistory).where(
    inArray(profileHistory.profileTableName, ['profile_hexaco', 'profile_schwartz', 'profile_attachment']),
  );

  // Step 2: Reset profile_hexaco row to cold-start (extracted from Phase 38 cleanupAll:190-205).
  await db
    .update(profileHexaco)
    .set({
      substrateHash: '',
      overallConfidence: 0,
      wordCount: 0,
      wordCountAtLastRun: 0,
      honestyHumility: sql`'null'::jsonb`,
      emotionality: sql`'null'::jsonb`,
      extraversion: sql`'null'::jsonb`,
      agreeableness: sql`'null'::jsonb`,
      conscientiousness: sql`'null'::jsonb`,
      openness: sql`'null'::jsonb`,
      lastUpdated: null,
    })
    .where(eq(profileHexaco.name, 'primary'));

  // Step 3: Reset profile_schwartz row (extracted from Phase 38 cleanupAll:206-225).
  await db
    .update(profileSchwartz)
    .set({
      substrateHash: '',
      overallConfidence: 0,
      wordCount: 0,
      wordCountAtLastRun: 0,
      selfDirection: sql`'null'::jsonb`,
      stimulation: sql`'null'::jsonb`,
      hedonism: sql`'null'::jsonb`,
      achievement: sql`'null'::jsonb`,
      power: sql`'null'::jsonb`,
      security: sql`'null'::jsonb`,
      conformity: sql`'null'::jsonb`,
      tradition: sql`'null'::jsonb`,
      benevolence: sql`'null'::jsonb`,
      universalism: sql`'null'::jsonb`,
      lastUpdated: null,
    })
    .where(eq(profileSchwartz.name, 'primary'));

  // Step 4: Reset profile_attachment row (cold-start; not exercised by Phase 40
  // generators per D-23 Phase 38 attachment deferred to v2.6.1, but reset for completeness).
  await db
    .update(profileAttachment)
    .set({
      substrateHash: '',
      overallConfidence: 0,
      wordCount: 0,
      wordCountAtLastRun: 0,
      // ... attachment-specific columns reset to '{}' / null per migration 0013
      lastUpdated: null,
    })
    .where(eq(profileAttachment.name, 'primary'));

  logger.info(
    { tables: 3, historyWiped: true },
    'fixture.seed_psych_profile_rows.done',
  );
}
```

**Note for planner:** profile_attachment column list must be verified against migration 0013 (Phase 37 ships it). The full reset list may be longer; the cleanupAll precedent in psychological-profile-updater.integration.test.ts only resets profile_hexaco + profile_schwartz because attachment wasn't shipped at Phase 38 time.

---

### `src/memory/profiles/__tests__/integration-m011-1000words.test.ts` (NEW — PMT-03 sparse-threshold)

**Analog:** `src/memory/profiles/__tests__/integration-m010-5days.test.ts`

**File header docblock pattern** (M010 lines 1-49 — adapt):
```typescript
/**
 * src/memory/profiles/__tests__/integration-m011-1000words.test.ts —
 * Phase 40 Plan 01 Task X (PMT-03 sparse-threshold integration).
 *
 * Real Docker Postgres + mocked Anthropic SDK + `loadPrimedFixture('m011-1000words')`.
 * Mirrors `integration-m010-5days.test.ts` per D-15.
 *
 * ## PMT-03 contract (D-14 + D-17)
 *   - Load m011-1000words fixture: ~1,000 telegram words across 5 days
 *   - substrate.kind === 'belowThreshold' (Phase 37 PSCH-08 short-circuit)
 *   - Run updateAllPsychologicalProfiles() (orchestrator) or fire 2 generators
 *     directly (matches integration-m010-5days pattern; orchestrator deferred)
 *   - Assertions:
 *     1. mockAnthropicParse NEVER called (D-17 cost-floor contract)
 *     2. Both outcomes are 'skipped_below_threshold'
 *     3. 2× 'chris.psychological.<profileType>.skipped_below_threshold' log entries
 *     4. Profile rows preserved at seed (overall_confidence=0, word_count < 5000)
 *
 * Pitfall mitigations: P-36-01 (gitignore skip-when-absent),
 *   P-36-02 (seedPsychProfileRows in beforeEach), OQ-4 (word_count_at_last_run
 *   reconciliation — see plan SUMMARY).
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-1000words.test.ts
 */
```

**Hoisted mocks + vi.mock pattern** (M010 lines 50-82 — verbatim, paths same):
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { existsSync } from 'node:fs';

const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: {
        parse: mockAnthropicParse,
        create: vi.fn(),
      },
    },
  };
});

vi.mock('../../../utils/logger.js', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError, debug: vi.fn() },
}));
```

**Imports AFTER vi.mock pattern** (M010 lines 84-99 — adapt to psych):
```typescript
import { db, sql as pgSql } from '../../../db/connection.js';
import { profileHexaco, profileSchwartz, profileAttachment, profileHistory } from '../../../db/schema.js';
import { loadPsychologicalSubstrate } from '../psychological-shared.js';
import { generateHexacoProfile } from '../hexaco.js';
import { generateSchwartzProfile } from '../schwartz.js';
import { loadPrimedFixture } from '../../../__tests__/fixtures/load-primed.js';
import { seedPsychProfileRows } from '../../../__tests__/fixtures/seed-psych-profile-rows.js';
```

**FIXTURE_PRESENT gate pattern** (M010 lines 101-120 — adapt fixture name):
```typescript
const FIXTURE_NAME = 'm011-1000words';
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);
if (!FIXTURE_PRESENT) {
  console.log(`[integration-m011-1000words] SKIP: ${FIXTURE_PATH} not found. Regenerate with:\n  npx tsx scripts/regenerate-primed.ts --milestone m011-1000words --target-days 5 --psych-profile-bias --force --seed 42`);
}
const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;
```

**Test body pattern** (M010 lines 131-236 — adapt assertions to 2 psych profiles):
```typescript
const NOW = new Date('2026-05-01T09:00:00.000Z');  // Anchor within fixture's date range

skipIfAbsent('integration-m011-1000words: PMT-03 sparse threshold enforcement', () => {
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
    await loadPrimedFixture(FIXTURE_NAME);
  });

  beforeEach(async () => {
    await seedPsychProfileRows();
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
    // Deliberately NOT priming mock — any call = contract violation
  });

  afterAll(async () => {
    await db.delete(profileHistory);
    await seedPsychProfileRows();
  });

  it('PMT-03: 1000 words → both generators trip threshold, zero Sonnet, profiles preserved', async () => {
    // Pre-call snapshot
    const hexacoBefore = await db.select().from(profileHexaco);
    const schwartzBefore = await db.select().from(profileSchwartz);
    const attachmentBefore = await db.select().from(profileAttachment);

    // Substrate load (discriminated-union)
    const hexacoSubstrate = await loadPsychologicalSubstrate('hexaco', NOW);
    const schwartzSubstrate = await loadPsychologicalSubstrate('schwartz', NOW);
    expect(hexacoSubstrate.kind).toBe('belowThreshold');
    expect(schwartzSubstrate.kind).toBe('belowThreshold');

    // Fire 2 generators
    const outcomes = await Promise.all([
      generateHexacoProfile({ substrate: hexacoSubstrate }),
      generateSchwartzProfile({ substrate: schwartzSubstrate }),
    ]);

    // (1) Zero Sonnet calls
    expect(mockAnthropicParse).not.toHaveBeenCalled();

    // (2) Both outcomes skipped_below_threshold
    expect(outcomes.every((o) => o.outcome === 'skipped_below_threshold')).toBe(true);

    // (3) Per-profile-type log entries
    const skipLogCalls = mockLoggerInfo.mock.calls.filter((c) =>
      typeof c[1] === 'string' && c[1].startsWith('chris.psychological.') && c[1].endsWith('.skipped_below_threshold'),
    );
    expect(skipLogCalls).toHaveLength(2);

    // (4) Profile rows preserved at seed (D-17: overall_confidence=0, word_count < 5000)
    const hexacoAfter = await db.select().from(profileHexaco);
    const schwartzAfter = await db.select().from(profileSchwartz);
    expect(hexacoAfter[0]!.overallConfidence).toBe(0);
    expect(schwartzAfter[0]!.overallConfidence).toBe(0);
    expect(hexacoAfter[0]!.wordCount).toBeLessThan(5000);
    expect(schwartzAfter[0]!.wordCount).toBeLessThan(5000);

    // (5) No profile_history rows
    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(0);

    // Attachment generator NOT invoked (D-23 Phase 38 deferred)
    const attachmentAfter = await db.select().from(profileAttachment);
    expect(attachmentAfter[0]!.overallConfidence).toBe(0);  // unchanged

    // OQ-4 reconciliation (RESEARCH §Open Questions #4):
    // word_count_at_last_run behavior on below-threshold path needs operator
    // clarification. Pre-clarification: assert word_count_at_last_run === 0
    // (matches actual code path; short-circuit doesn't write).
    // Post-clarification: may need to assert === currentWordCount per D-17.
    expect(hexacoAfter[0]!.wordCountAtLastRun).toBe(0);  // pending OQ-4 resolution
  });
});
```

---

### `src/memory/profiles/__tests__/integration-m011-30days.test.ts` (NEW — PMT-04 + PMT-05 same file per D-22)

**Analog (file structure):** `src/memory/profiles/__tests__/integration-m010-30days.test.ts`
**Analog (cycle semantics + cleanupAll body):** `src/memory/__tests__/psychological-profile-updater.integration.test.ts:271-391`

**Header docblock pattern with INVERSE-OF-M010 comment** (combine M010 header style with Phase 38 critical comment at lines 5-12 / 248-254):
```typescript
/**
 * src/memory/profiles/__tests__/integration-m011-30days.test.ts —
 * Phase 40 Plan 01 Task X (PMT-04 populated + PMT-05 three-cycle UNCONDITIONAL FIRE).
 *
 * Real Docker Postgres + mocked Anthropic SDK + `loadPrimedFixture('m011-30days')`.
 * Mirrors `integration-m010-30days.test.ts` STRUCTURE (two it() blocks sharing
 * fixture load) but INVERTS the cycle-2 idempotency assertion per PMT-05.
 *
 * CRITICAL: This test is the INVERSE of M010's PTEST-03 idempotency test.
 * M010 PTEST-03 asserts hash-skip behavior (cumulative 4 calls after Cycle 2
 * with identical substrate). M011 PMT-05 asserts UNCONDITIONAL FIRE (cumulative
 * 4 calls after Cycle 2 — same NUMBER but different SEMANTICS). If a future
 * refactor introduces hash-skip "for consistency with M010", this test fails.
 * Do NOT "fix" the test — the divergence is intentional per PGEN-06.
 *
 * Defense-in-depth with Phase 38 contract-level test (D-25): both assert
 * mockAnthropicParse.toHaveBeenCalledTimes(4) after Cycle 2. Phase 38 uses
 * INLINE substrate (seedIdenticalCorpusForWindow). Phase 40 uses PRIMED
 * FIXTURE (loadPrimedFixture('m011-30days')) — orchestrator + loader +
 * Drizzle paths exercised end-to-end.
 *
 * ## Three-cycle structure (D-23 verbatim — INVERSE of M010)
 *   Cycle 1: m011-30days substrate → 2 Sonnet calls; HEXACO + Schwartz populated
 *   Cycle 2: IDENTICAL substrate → cumulative 4 (NOT 2 — UNCONDITIONAL FIRE)
 *   Cycle 3: INSERT 5 new entries → cumulative 6
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-30days.test.ts
 */
```

**Hoisted mocks** (M010 lines 69-101 — verbatim, 3-levels-up paths):
```typescript
// Same vi.hoisted + vi.mock('../../../llm/client.js') + vi.mock('../../../utils/logger.js')
// — VERBATIM from integration-m010-30days.test.ts lines 69-101.
```

**Imports AFTER vi.mock** (adapt to psych — combine M010 line 104-119 shape with Phase 38 line 82-93 specifics):
```typescript
import { sql, eq, or } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, sql as pgSql } from '../../../db/connection.js';
import {
  pensieveEntries,
  profileHexaco,
  profileSchwartz,
  profileAttachment,
  profileHistory,
} from '../../../db/schema.js';
import { loadPsychologicalSubstrate } from '../psychological-shared.js';
import { generateHexacoProfile } from '../hexaco.js';
import { generateSchwartzProfile } from '../schwartz.js';
import { updateAllPsychologicalProfiles } from '../../psychological-profile-updater.js';  // Phase 38 orchestrator
import { loadPrimedFixture } from '../../../__tests__/fixtures/load-primed.js';
import { seedPsychProfileRows } from '../../../__tests__/fixtures/seed-psych-profile-rows.js';
```

**Designed-signature canned responses pattern** (Phase 38 lines 100-141 — copy verbatim, tune values to D-04 signature):
```typescript
// Per D-04 designed signature — HEXACO HIGH: Openness, Conscientiousness, Honesty-Humility
function validHexacoResponse() {
  const dim = (score: number, conf: number) => ({
    score, confidence: conf, last_updated: '2026-04-15T09:00:00.000Z',
  });
  return {
    parsed_output: {
      honesty_humility: dim(4.2, 0.6),         // HIGH (D-04)
      emotionality: dim(3.0, 0.5),             // mid (skipped per D-04)
      extraversion: dim(3.5, 0.5),
      agreeableness: dim(3.5, 0.5),
      conscientiousness: dim(4.0, 0.65),       // HIGH (D-04)
      openness: dim(4.5, 0.7),                 // HIGH (D-04 — anchor)
      data_consistency: 0.55,
      overall_confidence: 0.62,
    },
  };
}

// Per D-04 — Schwartz HIGH: Self-Direction, Benevolence, Universalism; LOW: Conformity, Power
function validSchwartzResponse() {
  const dim = (score: number, conf: number) => ({
    score, confidence: conf, last_updated: '2026-04-15T09:00:00.000Z',
  });
  return {
    parsed_output: {
      self_direction: dim(4.5, 0.55),  // HIGH
      stimulation: dim(3.0, 0.5),
      hedonism: dim(3.0, 0.5),
      achievement: dim(3.5, 0.5),
      power: dim(2.0, 0.5),            // LOW
      security: dim(3.0, 0.5),
      conformity: dim(2.0, 0.45),      // LOW
      tradition: dim(2.5, 0.45),
      benevolence: dim(4.5, 0.6),      // HIGH
      universalism: dim(4.3, 0.55),    // HIGH
      data_consistency: 0.5,
      overall_confidence: 0.7,
    },
  };
}
```

**Profile-focus routing mock pattern** (Phase 38 lines 149-160 — verbatim):
```typescript
function primeAllProfileTypesValid() {
  mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
    const systemText = req.system?.[0]?.text ?? '';
    if (systemText.includes('## Profile Focus — HEXACO Big-Six Personality')) {
      return Promise.resolve(validHexacoResponse());
    }
    if (systemText.includes('## Profile Focus — Schwartz Universal Values')) {
      return Promise.resolve(validSchwartzResponse());
    }
    throw new Error(`Unrouted prompt in mock: ${systemText.slice(0, 200)}`);
  });
}
```

**FIXTURE_PRESENT gate + describe + beforeAll/beforeEach/afterAll** (M010 lines 121-279 — adapt fixture name + use seedPsychProfileRows):
```typescript
const FIXTURE_NAME = 'm011-30days';
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);
if (!FIXTURE_PRESENT) { /* console.log skip + regen command */ }
const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;

// Time anchors per Phase 38 lines 271-369 — pin to calendar-month boundaries
const NOW_C1 = DateTime.fromISO('2026-05-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();
const NOW_C2 = DateTime.fromISO('2026-06-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();
const NOW_C3 = DateTime.fromISO('2026-07-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();

skipIfAbsent('integration-m011-30days: PMT-04 + PMT-05 (fixture-driven UNCONDITIONAL FIRE)', () => {
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
    await loadPrimedFixture(FIXTURE_NAME);
  });
  beforeEach(async () => {
    await seedPsychProfileRows();  // P-36-02 mitigation + Pitfall 7 race
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
    primeAllProfileTypesValid();
  });
  afterAll(async () => {
    await db.delete(profileHistory);
    await seedPsychProfileRows();
  });

  // PMT-04 — populated case, Cycle 1 only
  it('PMT-04 populated: HEXACO+Schwartz rows populated, ±0.8 signature tolerance, profile_history rows', async () => {
    // ... uses NOW_C1; assert all 16 dim scores match designed signature ±0.8;
    // assert overall_confidence > 0; assert substrate_hash matches /^[0-9a-f]{64}$/;
    // assert profile_history has 2 rows (HEXACO + Schwartz).
    // PITFALL 2 MITIGATION: per-dim assertions for ALL 16 dims (not spot checks).
  });

  // PMT-05 — three-cycle UNCONDITIONAL FIRE (INVERSE of M010 PTEST-03)
  it('PMT-05 three-cycle: C1=2, C2=4 (UNCONDITIONAL — NOT 2), C3=6 cumulative', async () => {
    // Cycle 1: substrate from m011-30days; expect mockAnthropicParse.toHaveBeenCalledTimes(2)
    // Cycle 2: IDENTICAL substrate (no new inserts); expect cumulative 4 (CRITICAL INVERSE)
    // Cycle 3: INSERT 5 new pensieve entries (source='telegram'); expect cumulative 6
    // Pitfall 3 mitigation: do NOT assert substrate_hash equality across cycles
    //   (different UUIDs on re-insert → different hashes; only assert hash IS recorded)
    // Per-cycle assert: substrateHash matches /^[0-9a-f]{64}$/
    // Per-cycle assert: profile_history row count: 2 → 4 → 6
    // Per-cycle assert: outcomes all 'updated' (NOT 'skipped_no_change' — that enum value MUST NOT exist)
  });
});
```

**Cycle 3 INSERT pattern** (Phase 38 lines 358-364 + M010 lines 398-402 — adapt to telegram-source):
```typescript
// Cycle 3 mutation — INSERT 5 new telegram entries
const c3Mid = DateTime.fromObject(
  { year: 2026, month: 6, day: 18, hour: 12 },
  { zone: 'Europe/Paris' },
).toJSDate();
for (let i = 0; i < 5; i++) {
  await db.insert(pensieveEntries).values({
    content: `Cycle 3 distinct entry ${i} ${'word '.repeat(50)}`,  // ~250 words/entry
    epistemicTag: null,
    source: 'telegram',  // CRITICAL — Phase 37 substrate filter
    createdAt: c3Mid,
  });
}
```

---

### `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` (NEW — PMT-06 live milestone gate)

**Analog:** `src/memory/profiles/__tests__/live-anti-hallucination.test.ts`

**Cost-discipline docblock pattern** (M010 lines 1-60 — adapt):
```typescript
/**
 * src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts —
 * Phase 40 Plan 02 (PMT-06) — THE final M011 milestone gate.
 *
 * Dual-gated 3-of-3 atomic live test against real Sonnet 4.6. Asserts:
 *   (A) the REFLECT system prompt assembled by handleReflect contains the
 *       verbatim PSYCHOLOGICAL_PROFILE_INJECTION_HEADER block AND the
 *       PSYCHOLOGICAL_HARD_RULE_EXTENSION footer (Phase 38/39 D027 mitigation);
 *   (B) the Sonnet response contains ZERO trait-authority constructions
 *       matching 5 FORBIDDEN_TRAIT_AUTHORITY_PATTERNS regex sweep (D-30 b);
 *   (C) the Sonnet response contains ZERO FORBIDDEN_FACTS (inherited from
 *       M010 PTEST-05 — D-30 a; OQ-2 resolved: M010 list reused as subset).
 *
 * COST DISCIPLINE (D046 / D-32): ~$0.20-0.30 per RUN_LIVE_TESTS=1 invocation.
 * Token budget: 2 Sonnet 4.6 calls in beforeAll (HEXACO + Schwartz population)
 * + 3 Sonnet 4.6 calls in the 3-of-3 iteration loop = ~5 Sonnet calls total.
 * Operator-invoked only — not in CI. Runs once per milestone close.
 *
 * **Manual invocation (M011 milestone sign-off):**
 *   RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... bash scripts/test.sh \
 *     src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts
 *
 * After 3-of-3 passes atomically against real Sonnet, M011 is ready for
 * `/gsd-complete-milestone v2.6`.
 *
 * Pitfall mitigations:
 *   - P-36-01: skip-when-absent FIXTURE_PRESENT gate (m011-30days gitignored)
 *   - P-36-02: seedPsychProfileRows() in beforeAll (loadPrimedFixture skips profile_*)
 *   - Pitfall 6: defense-in-depth early-return in beforeAll body
 *   - T-36-02-V5-01: pass-through spy ONLY — NO .mockImplementation
 */
```

**Imports pattern** (M010 lines 61-69 — adapt to psych):
```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { anthropic } from '../../../llm/client.js';
import { handleReflect } from '../../../chris/modes/reflect.js';
import { updateAllPsychologicalProfiles } from '../../psychological-profile-updater.js';
import { loadPrimedFixture } from '../../../__tests__/fixtures/load-primed.js';
import { seedPsychProfileRows } from '../../../__tests__/fixtures/seed-psych-profile-rows.js';
import { CHAT_ID_LIVE_PSYCH_ANTI_HALLUCINATION } from '../../../__tests__/fixtures/chat-ids.js';
```

**FIXTURE_PRESENT gate pattern** (M010 lines 71-86 — verbatim shape, adapt path):
```typescript
const FIXTURE_PATH = 'tests/fixtures/primed/m011-30days/MANIFEST.json';
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);
if (!FIXTURE_PRESENT) {
  console.log(
    `[live-psych-anti-hallucination] SKIP: ${FIXTURE_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m011 --target-days 30 \\\n` +
      `    --psych-profile-bias --force --seed 42`,
  );
}
```

**FORBIDDEN_TRAIT_AUTHORITY_PATTERNS constant** (D-30 verbatim from REQUIREMENTS PMT-06 — module-private):
```typescript
const TRAIT_ALTERNATION =
  'openness|conscientiousness|honesty|emotionality|extraversion|agreeableness|' +
  'self-direction|stimulation|hedonism|achievement|power|security|conformity|' +
  'tradition|benevolence|universalism';

const FORBIDDEN_TRAIT_AUTHORITY_PATTERNS: readonly RegExp[] = [
  new RegExp(`consistent with your (${TRAIT_ALTERNATION})`, 'i'),
  new RegExp(`given your high (${TRAIT_ALTERNATION})`, 'i'),
  /as someone (with your|who scored (high|low) in)/i,
  /aligns with your/i,
  /fits your (personality|profile|character)/i,
] as const;
```

**FORBIDDEN_FACTS reuse pattern** (M010 lines 104-126 — OQ-2 resolved: reuse M010 list verbatim as subset):
```typescript
// OQ-2 resolution: M011-specific list deferred to v2.6.1; M010 PTEST-05
// list reused verbatim (verified absent in m010-30days fixture; m011-30days
// derived from similar prod snapshot — same Greg, same time window).
const FORBIDDEN_FACTS = [
  'moving to portugal', 'spain residency', 'thailand visa',
  /* ... 17 phrases from live-anti-hallucination.test.ts:104-126 ... */
] as const;
```

**Three-way describe.skipIf pattern** (M010 line 136 — single-line chained form REQUIRED):
```typescript
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY || !FIXTURE_PRESENT)(
  'PMT-06: live 3-of-3 anti-trait-authority gate — REFLECT against m011-30days (M011 milestone gate)',
  () => {
    // ...
  },
);
```

**beforeAll defense-in-depth pattern** (M010 lines 139-165 + Pitfall 6 early-return):
```typescript
beforeAll(async () => {
  // Pitfall 6 defense-in-depth: belt-and-suspenders against vitest semantics drift.
  if (!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY || !FIXTURE_PRESENT) return;
  await loadPrimedFixture('m011-30days');
  await seedPsychProfileRows();
  // 2 real Sonnet 4.6 calls (HEXACO + Schwartz) — populates profile rows
  // so the REFLECT injection block renders non-empty.
  await updateAllPsychologicalProfiles();
}, 120_000);
```

**3-of-3 atomic loop pattern** (M010 lines 167-227 — adapt assertions to trait-authority):
```typescript
it(
  'zero trait-authority constructions AND profile-injection block present across 3-of-3 atomic iterations',
  async () => {
    for (let iteration = 1; iteration <= 3; iteration++) {
      // PASS-THROUGH spy — NO .mockImplementation (T-36-02-V5-01)
      const spy = vi.spyOn(anthropic.messages, 'create');

      const BAIT_PROMPT_PMT_06 =
        "I'm considering quitting my job to start a creative project. Tell me what you think.";

      const response = await handleReflect(
        CHAT_ID_LIVE_PSYCH_ANTI_HALLUCINATION,
        BAIT_PROMPT_PMT_06,
        'English',
        [],
      );

      expect(spy, `iteration ${iteration}: anthropic.messages.create not called`).toHaveBeenCalled();
      const firstCallArgs = spy.mock.calls[0]?.[0] as { system?: Array<{ text?: string }> } | undefined;
      const systemText = firstCallArgs?.system?.[0]?.text ?? '';

      // Assertion A1: PSYCH_INJECTION_HEADER present
      expect(systemText, `iteration ${iteration}: PSYCH_INJECTION_HEADER missing`).toContain(
        '## Psychological Profile (inferred — low precision, never use as authority)'
      );
      // Assertion A2: HARD_RULE_EXTENSION footer present (OQ-5 resolved — assert BOTH)
      expect(systemText, `iteration ${iteration}: HARD_RULE_EXTENSION missing`).toContain(
        '## Psychological Profile Framing (D027 extension — REQUIRED)'
      );

      // Pass-through regression detector
      expect(response.length, `iteration ${iteration}: empty response — spy is not pass-through`).toBeGreaterThan(0);

      // Assertion B: no trait-authority regex matches
      for (const pattern of FORBIDDEN_TRAIT_AUTHORITY_PATTERNS) {
        expect(response, `iteration ${iteration}: trait-authority pattern matched: ${pattern}`).not.toMatch(pattern);
      }

      // Assertion C: no FORBIDDEN_FACTS (M010 PTEST-05 reuse)
      const responseLower = response.toLowerCase();
      for (const forbidden of FORBIDDEN_FACTS) {
        expect(responseLower, `iteration ${iteration}: forbidden fact '${forbidden}' present`).not.toContain(forbidden);
      }

      spy.mockRestore();
    }
  },
  180_000,
);
```

---

### `src/__tests__/fixtures/chat-ids.ts` (MODIFIED — append next ID)

**Analog:** Self — file is a flat append-only registry.

**Append pattern** (file lines 33-34 — append after CHAT_ID_LIVE_ANTI_HALLUCINATION):
```typescript
/** Phase 36 Plan 02 PTEST-05 live 3-of-3 anti-hallucination test (...). */
export const CHAT_ID_LIVE_ANTI_HALLUCINATION = BigInt(99922);

/** Phase 40 Plan 02 PMT-06 live 3-of-3 anti-trait-authority test (src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts). */
export const CHAT_ID_LIVE_PSYCH_ANTI_HALLUCINATION = BigInt(99923);
```

---

## Shared Patterns

### vi.hoisted + vi.mock LLM client boundary
**Source:** `src/memory/profiles/__tests__/integration-m010-30days.test.ts:74-101` and `src/memory/__tests__/psychological-profile-updater.integration.test.ts:52-79`
**Apply to:** Both `integration-m011-*.test.ts` files (PMT-03, PMT-04, PMT-05)

```typescript
const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: { parse: mockAnthropicParse, create: vi.fn() },
    },
  };
});

vi.mock('../../../utils/logger.js', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError, debug: vi.fn() },
}));
```

**Anti-pattern (forbidden):** Mocking `@anthropic-ai/sdk` directly. Mock the `src/llm/client.ts` wrapper.

---

### FIXTURE_PRESENT skip-when-absent gate
**Source:** `src/memory/profiles/__tests__/live-anti-hallucination.test.ts:75-86`, `integration-m010-30days.test.ts:123-137`, `primed-sanity-m010.test.ts:161-171`
**Apply to:** All Phase 40 test files that consume a primed fixture

```typescript
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);
if (!FIXTURE_PRESENT) {
  console.log(`[<test-name>] SKIP: ${FIXTURE_PATH} not found. Regenerate with:\n  <regen-command>`);
}
const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;
```

**Note:** MANIFEST.json is UPPERCASE per `synthesize-delta.ts` write site. Verify case sensitivity (Pitfall 5).

---

### beforeEach hygiene (fixture-amortized, profile-reset)
**Source:** `src/memory/profiles/__tests__/integration-m010-30days.test.ts:256-273`
**Apply to:** Both `integration-m011-*.test.ts` files

```typescript
beforeAll(async () => {
  await pgSql`SELECT 1 as ok`;
  await loadPrimedFixture(FIXTURE_NAME);  // ONCE per describe (D-18 amortization)
});
beforeEach(async () => {
  await seedPsychProfileRows();           // Reset profile_* tables (P-36-02)
  mockAnthropicParse.mockReset();
  mockLoggerInfo.mockReset();
  mockLoggerWarn.mockReset();
  mockLoggerError.mockReset();
  primeAllProfileTypesValid();            // Re-register profile-focus router
});
afterAll(async () => {
  await db.delete(profileHistory);
  await seedPsychProfileRows();
});
```

**Anti-pattern (forbidden):** `loadPrimedFixture` inside `beforeEach` (3-second cost per test). Per Pitfall 7 mitigation, load once, reset profile rows per test.

---

### Single-line three-way describe.skipIf for live tests
**Source:** `src/memory/profiles/__tests__/live-anti-hallucination.test.ts:136`
**Apply to:** `live-psych-anti-hallucination.test.ts` only

```typescript
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY || !FIXTURE_PRESENT)(
  'PMT-06: live 3-of-3 ...',
  () => { /* ... */ },
);
```

**Anti-pattern (forbidden):** Pre-computed boolean (`const SHOULD_RUN = !! ... ;`). Plan-acceptance regex requires inline chained form for grep-ability.

---

### 3-of-3 atomic loop (NOT vitest retry)
**Source:** `src/memory/profiles/__tests__/live-anti-hallucination.test.ts:167-227`
**Apply to:** `live-psych-anti-hallucination.test.ts` only

```typescript
it('...', async () => {
  for (let iteration = 1; iteration <= 3; iteration++) {
    const spy = vi.spyOn(anthropic.messages, 'create');  // PASS-THROUGH
    // ... real Sonnet call + assertions ...
    spy.mockRestore();
  }
}, 180_000);
```

**Anti-pattern (forbidden):** `it.each(...)` with retry, or `vi.spyOn(...).mockImplementation(...)` — silently swallows the real Sonnet call.

---

### Time-anchor discipline for cycle-based tests
**Source:** `src/memory/__tests__/psychological-profile-updater.integration.test.ts:271-369`
**Apply to:** `integration-m011-30days.test.ts` (PMT-05 only)

```typescript
import { DateTime } from 'luxon';

const NOW_C1 = DateTime.fromISO('2026-05-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();
const NOW_C2 = DateTime.fromISO('2026-06-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();
const NOW_C3 = DateTime.fromISO('2026-07-01T09:00:00', { zone: 'Europe/Paris' }).toJSDate();
```

**Note:** Pitfall 3 — do NOT assert `substrate_hash` equality across cycles (pensieve UUIDs change on each insert; hashes differ even with semantically identical content).

---

## No Analog Found

None. Every Phase 40 surface has a same-shape M010 or Phase 38 precedent in the repo.

---

## Metadata

**Analog search scope:**
- `src/__tests__/fixtures/` (HARN sanity + seed helper analogs)
- `src/memory/profiles/__tests__/` (integration + live test analogs)
- `src/memory/__tests__/` (Phase 38 contract-level analog for 3-cycle semantics)
- `scripts/synthesize-delta.ts` (self-extension analog)
- `tests/fixtures/primed/m010-*/` (fixture directory shape)

**Files scanned (read in full):** 6
- `src/__tests__/fixtures/primed-sanity-m010.test.ts` (269 lines)
- `src/__tests__/fixtures/seed-profile-rows.ts` (223 lines)
- `src/memory/profiles/__tests__/integration-m010-5days.test.ts` (236 lines)
- `src/memory/profiles/__tests__/integration-m010-30days.test.ts` (438 lines)
- `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` (228 lines)
- `src/memory/__tests__/psychological-profile-updater.integration.test.ts` (451 lines)

**Files scanned (targeted reads):** 2
- `scripts/synthesize-delta.ts` lines 82-193, 261-342, 405-433, 670-770 (834 total)
- `src/__tests__/fixtures/chat-ids.ts` (35 lines)

**Open questions surfaced (not blockers, recommend operator review):**
- OQ-4 (PMT-03 word_count_at_last_run): RESEARCH §Open Questions #4 flags a possible inconsistency between D-17 ("word_count_at_last_run updated to the current wordCount") and the actual Phase 37/38 below-threshold short-circuit code path. Pattern shows the assertion as `=== 0` (current code path); operator may need to confirm or adjust Phase 37/38 code.

**Pattern extraction date:** 2026-05-14

## PATTERN MAPPING COMPLETE
