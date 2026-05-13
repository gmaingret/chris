# Phase 36: Tests — Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 8 (6 new, 2 modified)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/__tests__/fixtures/seed-profile-rows.ts` (NEW) | fixture utility | file-I/O + SQL replay | `src/__tests__/fixtures/load-primed.ts` + `src/db/migrations/0012_operational_profiles.sql` lines 132-204 | role-match (FK-safe loader pattern) + verbatim SQL source |
| `src/__tests__/fixtures/primed-sanity-m010.test.ts` (NEW) | test (HARN gate) | request-response | `src/__tests__/fixtures/primed-sanity.test.ts` | exact (D-34 mandates verbatim scaffold) |
| `src/memory/profiles/__tests__/integration-m010-30days.test.ts` (NEW) | test (integration, 3-cycle) | event-driven (cycles) | `src/memory/profiles/__tests__/generators.two-cycle.test.ts` | exact (D-33 mandates verbatim scaffold; corrected name vs CONTEXT.md "generators.test.ts") |
| `src/memory/profiles/__tests__/integration-m010-5days.test.ts` (NEW) | test (integration, sparse) | request-response | `src/memory/profiles/__tests__/generators.sparse.test.ts` | exact |
| `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` (NEW) | test (live LLM 3-of-3) | request-response | `src/rituals/__tests__/live-weekly-review.test.ts` | exact (D-32 mandates verbatim scaffold) |
| `scripts/__tests__/synthesize-delta.test.ts` (MODIFIED — add cases) | test (unit) | request-response | itself (existing file at the same path) | exact (extend in-place) |
| `scripts/synthesize-delta.ts` (MODIFIED) | CLI tooling | batch transform | itself — additive at lines 149-161 (parseArgs) + 264-276 (Haiku prompt) + 521-527 (per-day call site) | exact (extend in-place) |
| `src/__tests__/fixtures/chat-ids.ts` (MODIFIED) | config (registry) | constant | itself — append new const | exact |

## Pattern Assignments

### `scripts/synthesize-delta.ts` (CLI tooling, batch transform — MODIFY)

**Analog:** itself. Three additive injection points already located by Read.

**Existing parseArgs block** (`scripts/synthesize-delta.ts:140-201`):
```typescript
let raw: {
  organic?: string;
  'target-days'?: string;
  seed?: string;
  milestone?: string;
  'no-refresh'?: boolean;
  help?: boolean;
};
try {
  ({ values: raw } = parseArgs({
    args: argv,
    options: {
      organic: { type: 'string' },
      'target-days': { type: 'string' },
      seed: { type: 'string' },
      milestone: { type: 'string' },
      'no-refresh': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  }));
} catch (err) { /* UsageError */ }
```

**Add (D-03, repeatable flag — Node parseArgs `multiple: true`):**
```typescript
// Inside options block:
'profile-bias': { type: 'string', multiple: true, default: [] as string[] },

// After existing validations (around line 200):
const profileBias = (raw['profile-bias'] ?? []) as string[];
const DIMENSIONS = ['jurisdictional', 'capital', 'health', 'family'] as const;
for (const b of profileBias) {
  if (!DIMENSIONS.includes(b as typeof DIMENSIONS[number])) {
    throw new UsageError(
      `synthesize-delta: --profile-bias must be one of ${DIMENSIONS.join('|')} (got: ${b})`,
    );
  }
}
// Add to returned Args:
return { ..., profileBias: profileBias as Dimension[] };
```

**Verification of `multiple: true` precedent:** Confirmed — Node.js `parseArgs` natively supports `multiple: true` per https://nodejs.org/api/util.html#utilparseargsconfig. No existing usage in the repo, but the API is stable since Node 18.3. Plan 36-01 introduces the precedent.

**Existing Haiku prompt builder** (`scripts/synthesize-delta.ts:264-276`):
```typescript
function buildHaikuSystemPrompt(
  fewShot: readonly Record<string, unknown>[],
  dateIso: string,
  nEntries: number,
): string {
  const bullets = fewShot
    .map((e, i) => `  ${i + 1}. ${JSON.stringify((e as { content: string }).content)}`)
    .join('\n');
  return `You are mimicking Greg's Telegram voice. Below are ${fewShot.length} real entries from Greg; produce ${nEntries} new entries for ${dateIso}... Match tone, sentence length, topic distribution...

Few-shot entries:
${bullets}`;
}
```

**Extend signature with optional `dimensionHint` parameter** (per RESEARCH Pattern 2). Place new constants `PROFILE_BIAS_KEYWORDS` and `PROFILE_BIAS_ROTATION` near `ENTRIES_PER_DAY` (line 76).

**Existing per-day call site** (`scripts/synthesize-delta.ts:521-527`):
```typescript
const synthPensieve: Record<string, unknown>[] = [];
for (let d = 0; d < synthDaysNeeded; d++) {
  const dayDate = synthStart.plus({ days: d });
  const dayDateStr = dayDate.toISODate()!;
  const fewShot = seededSample(organicPensieve, FEW_SHOT_N, opts.seed + d);
  const systemPrompt = buildHaikuSystemPrompt(fewShot, dayDateStr, ENTRIES_PER_DAY);
```

**Modify** (per CONTEXT.md D-09 round-robin + RESEARCH Pattern 2):
```typescript
const biasDim = opts.profileBias && opts.profileBias.length > 0
  ? PROFILE_BIAS_ROTATION[d % PROFILE_BIAS_ROTATION.length]
  : undefined;
const dimensionHint =
  biasDim && opts.profileBias!.includes(biasDim)
    ? PROFILE_BIAS_KEYWORDS[biasDim].join(', ')
    : undefined;
const systemPrompt = buildHaikuSystemPrompt(fewShot, dayDateStr, ENTRIES_PER_DAY, dimensionHint);
```

---

### `src/__tests__/fixtures/seed-profile-rows.ts` (NEW — FK-safe profile re-seed)

**Pitfall P-36-02 context:** `loadPrimedFixture` does NOT touch profile_* tables (verified at `load-primed.ts:175` comment "does NOT touch profile_* tables" + the cleanup list lines 222-241 omits `profile_jurisdictional/capital/health/family`). If a prior test mutated profile rows (e.g., generators.two-cycle.test.ts Cycle 3 INSERT), the seed-row defaults from migration 0012 are lost. `seed-profile-rows.ts` re-applies migration 0012's seed INSERTs idempotently via `ON CONFLICT (name) DO UPDATE SET` so PTEST-04 sees clean "insufficient data" markers.

**Analog #1 — FK-safe idempotent loader shape** (`src/__tests__/fixtures/load-primed.ts:165-282`):
```typescript
// Public API signature pattern + JSDoc shape + ChrisError-throwing guards
export async function loadPrimedFixture(
  name: string,
  opts: LoadPrimedOptions = {},
): Promise<void> {
  // ... feature-detect via to_regclass
  const client: postgres.Sql = opts.dbOverride ?? pgSql;
  // ... cleanup in reverse-FK order
  // ... bulk-insert in forward-FK order using db / client
  logger.info({ name, counts }, 'load.primed.done');
}
```
Mirror this shape for `seedProfileRows()`:
- Take optional `{ dbOverride?: postgres.Sql }`.
- Use `db.execute(sql\`...\`)` or `client.unsafe(...)` for the four INSERTs.
- Log `'fixture.seed_profile_rows.done'` at end.
- Idempotent: callers may invoke once per test file in `beforeEach`/`beforeAll`.

**Analog #2 — verbatim seed values** (`src/db/migrations/0012_operational_profiles.sql:132-204`):
```sql
-- jurisdictional (confidence 0.3 — 4 of ~8 fields seeded from ground-truth):
INSERT INTO "profile_jurisdictional"
    ("name", "schema_version", "substrate_hash", "confidence", "data_consistency",
     "current_country", "physical_location", "residency_status", "tax_residency",
     "active_legal_entities", "next_planned_move", "planned_move_date",
     "passport_citizenships")
VALUES
    ('primary', 1, '', 0.3, 0,
     '"Russia"'::jsonb,
     '"Saint Petersburg"'::jsonb,
     '[{"type": "permanent_residency", "value": "Panama"},
        {"type": "business_residency", "value": "Georgian Individual Entrepreneur"}]'::jsonb,
     'null'::jsonb,
     '[{"name": "MAINGRET LLC", "jurisdiction": "New Mexico, USA"},
        {"name": "Georgian Individual Entrepreneur", "jurisdiction": "Georgia"}]'::jsonb,
     '{"destination": "Batumi, Georgia", "from_date": "2026-04-28"}'::jsonb,
     '"2026-04-28"'::jsonb,
     '["French"]'::jsonb)
ON CONFLICT ("name") DO NOTHING;
```

**Capital seed** (lines 153-170): confidence 0.2, fi_target $1,500,000, MAINGRET LLC + Georgian IE entities.
**Health seed** (lines 174-186): confidence 0, all jsonb arrays empty, `case_file_narrative='insufficient data'`, `wellbeing_trend={}`.
**Family seed** (lines 190-204): confidence 0, `relationship_status="insufficient data"`, `children_plans="insufficient data"`, `active_dating_context="insufficient data"`.

**Helper pattern — change `ON CONFLICT DO NOTHING` → `DO UPDATE SET …`** so that mutated rows from prior tests get RESET to the seed shape (not skipped if a primary row exists). This is critical — the migration's `DO NOTHING` semantics only work for first-time install; the test fixture wants idempotent overwrite-to-seed. Example shape:
```typescript
await client.unsafe(`
  INSERT INTO profile_health (name, schema_version, substrate_hash, confidence, data_consistency,
    open_hypotheses, pending_tests, active_treatments, recent_resolved,
    case_file_narrative, wellbeing_trend)
  VALUES ('primary', 1, '', 0, 0, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    '"insufficient data"'::jsonb, '{}'::jsonb)
  ON CONFLICT (name) DO UPDATE SET
    schema_version = EXCLUDED.schema_version,
    substrate_hash = EXCLUDED.substrate_hash,
    confidence = EXCLUDED.confidence,
    data_consistency = EXCLUDED.data_consistency,
    open_hypotheses = EXCLUDED.open_hypotheses,
    pending_tests = EXCLUDED.pending_tests,
    active_treatments = EXCLUDED.active_treatments,
    recent_resolved = EXCLUDED.recent_resolved,
    case_file_narrative = EXCLUDED.case_file_narrative,
    wellbeing_trend = EXCLUDED.wellbeing_trend,
    last_updated = NOW()
`);
```
Also clear `profile_history` for the polymorphic rows whose snapshots reference these tables (`await db.delete(profileHistory)`).

---

### `src/__tests__/fixtures/primed-sanity-m010.test.ts` (NEW — HARN gate per dimension)

**Analog:** `src/__tests__/fixtures/primed-sanity.test.ts` (D-34 verbatim).

**Scaffold to lift** (lines 55-90):
```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { pensieveEntries } from '../../db/schema.js';
import { loadPrimedFixture } from './load-primed.js';

const FIXTURE_NAME = 'm009-21days';
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);

const MIN_PENSIEVE_ENTRIES = 195;
const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;

if (!FIXTURE_PRESENT) {
  console.log(
    `[primed-sanity] SKIP: ${FIXTURE_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m009 --target-days 21 --seed 42 --force`,
  );
}

skipIfAbsent('primed-sanity: m009-21days fixture (HARN-03 + HARN-06)', () => {
  beforeAll(async () => {
    await loadPrimedFixture(FIXTURE_NAME);
  });
```

**Per-dimension count assertion shape** (lift from lines 104-109):
```typescript
it(`has >= ${MIN_PENSIEVE_ENTRIES} pensieve entries`, async () => {
  const [row] = await db
    .select({ n: drizzleSql<number>`count(*)::int` })
    .from(pensieveEntries);
  expect(row?.n ?? 0).toBeGreaterThanOrEqual(MIN_PENSIEVE_ENTRIES);
});
```

**Plan 36-01 adaptation per D-10/D-11 (keyword grep per dimension):**
```typescript
const MIN_PER_DIMENSION_30DAYS = 12;  // D-10
const MAX_PER_DIMENSION_5DAYS = 10;   // D-13 (must be <10)
const MIN_PER_DIMENSION_5DAYS = 1;    // anti-zero trip-wire (test_strategy item 2.b)

const PROFILE_BIAS_KEYWORDS = {
  jurisdictional: ['current location', 'country', 'residency', /* ... */],
  capital: ['FI target', 'net worth', /* ... */],
  health: ['hypothesis', 'symptom', /* ... */],
  family: ['relationship', 'partner', /* ... */],
} as const;

for (const dim of ['jurisdictional', 'capital', 'health', 'family'] as const) {
  it(`m010-30days: >=${MIN_PER_DIMENSION_30DAYS} entries match ${dim} keywords`, async () => {
    const pattern = PROFILE_BIAS_KEYWORDS[dim].join('|');
    const [row] = await db.execute<{ n: number }>(drizzleSql`
      SELECT COUNT(*)::int AS n FROM pensieve_entries
      WHERE content ~* ${pattern}
    `);
    expect((row as { n: number })?.n ?? 0).toBeGreaterThanOrEqual(MIN_PER_DIMENSION_30DAYS);
  });
}
```

**Two-fixture-in-one-file structure:** Plan 36-01 either uses two separate `describe()` blocks (`describe('m010-30days')` + `describe('m010-5days')`, each with own `beforeAll(loadPrimedFixture)`), or two test files. CONTEXT.md D-34 + research recommend single file with two `describe` blocks. Mirror the m009 scaffold's `skipIfAbsent` pattern for each fixture independently.

---

### `src/memory/profiles/__tests__/integration-m010-30days.test.ts` (NEW — PTEST-02 + PTEST-03)

**Analog:** `src/memory/profiles/__tests__/generators.two-cycle.test.ts` (verbatim per D-33; CORRECTED filename — CONTEXT.md says `generators.test.ts` which does not exist).

**Hoisted-mock + vi.mock setup** (lift verbatim from `generators.two-cycle.test.ts:48-79`):
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

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
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));
```

**Imports AFTER vi.mock** (lift lines 81-96, add `loadPrimedFixture` + `seedProfileRows` + the orchestrator):
```typescript
import { sql } from 'drizzle-orm';
import { db, sql as pgSql } from '../../../db/connection.js';
import { pensieveEntries, profileJurisdictional, profileCapital, profileHealth, profileFamily, profileHistory } from '../../../db/schema.js';
// NEW imports for Plan 36-01:
import { loadPrimedFixture } from '../../../__tests__/fixtures/load-primed.js';
import { seedProfileRows } from '../../../__tests__/fixtures/seed-profile-rows.js';
import { updateAllOperationalProfiles } from '../../profile-updater.js';
```

**Valid response factories** (lift verbatim from `generators.two-cycle.test.ts:114-174`):
```typescript
function validJurisdictionalResponse() {
  return {
    parsed_output: {
      current_country: 'Russia',
      physical_location: 'Saint Petersburg',
      residency_status: [{ type: 'permanent_residency', value: 'Panama' }],
      tax_residency: null,
      active_legal_entities: [{ name: 'MAINGRET LLC', jurisdiction: 'New Mexico, USA' }],
      next_planned_move: { destination: 'Batumi, Georgia', from_date: '2026-04-28' },
      planned_move_date: '2026-04-28',
      passport_citizenships: ['French'],
      data_consistency: 0.4,
    },
  };
}
// + validCapitalResponse, validHealthResponse, validFamilyResponse — verbatim
```

**Dimension-routing mock implementation** (lift verbatim from lines 187-205):
```typescript
function primeAllDimensionsValid() {
  mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
    const systemText = req.system?.[0]?.text ?? '';
    if (systemText.includes('Dimension Focus — Jurisdictional')) return Promise.resolve(validJurisdictionalResponse());
    if (systemText.includes('Dimension Focus — Capital')) return Promise.resolve(validCapitalResponse());
    if (systemText.includes('Dimension Focus — Health')) return Promise.resolve(validHealthResponse());
    if (systemText.includes('Dimension Focus — Family')) return Promise.resolve(validFamilyResponse());
    throw new Error(`primeAllDimensionsValid: unrecognized dimension focus in prompt. First 200 chars: ${systemText.slice(0, 200)}`);
  });
}
```

**3-cycle assertion shape** (lift the cycle pattern from lines 226-352; replace in-test pensieve INSERTs with `loadPrimedFixture('m010-30days')`):
```typescript
describe('PTEST-02 + PTEST-03 — integration m010-30days (3-cycle)', () => {
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
    await loadPrimedFixture('m010-30days');  // amortize fixture load
  });

  beforeEach(async () => {
    await db.delete(profileHistory);
    await seedProfileRows();  // reset profile_* to migration-0012 seed state
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    primeAllDimensionsValid();
  });

  it('PTEST-02 populated case: Cycle 1 → 4 calls + all confidence>0 + 4 history rows', async () => {
    const NOW_C1 = new Date('2026-05-17T22:00:00.000Z');

    const outcomes = await updateAllOperationalProfiles({ now: NOW_C1 });

    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);
    const [jRow, cRow, hRow, fRow] = await Promise.all([
      db.select().from(profileJurisdictional).limit(1),
      db.select().from(profileCapital).limit(1),
      db.select().from(profileHealth).limit(1),
      db.select().from(profileFamily).limit(1),
    ]);
    for (const r of [jRow[0]!, cRow[0]!, hRow[0]!, fRow[0]!]) {
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.substrateHash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.lastUpdated.getTime()).toBeGreaterThan(new Date('2026-05-01').getTime());  // advanced past seed
    }
    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(4);
  });

  it('PTEST-03 three-cycle idempotency (D-19): identical → STILL 4 calls; mutated → 5 calls', async () => {
    const NOW_C1 = new Date('2026-05-17T22:00:00.000Z');
    const NOW_C2 = new Date('2026-05-24T22:00:00.000Z');
    const NOW_C3 = new Date('2026-05-31T22:00:00.000Z');

    // Cycle 1
    await updateAllOperationalProfiles({ now: NOW_C1 });
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);

    // M010-10 verification (D-20): inspect Cycle 1's call args for CURRENT PROFILE STATE block
    const cycle1Call = mockAnthropicParse.mock.calls[0]![0] as { system: Array<{ text: string }> };
    expect(cycle1Call.system[0]!.text).toContain('CURRENT PROFILE STATE');

    // Cycle 2 — identical substrate
    primeAllDimensionsValid();  // would throw if invoked
    await updateAllOperationalProfiles({ now: NOW_C2 });
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);  // NOT 8 — second-fire-blindness detector
    const skipLogCalls = mockLoggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.profile.profile_skipped_no_change',
    );
    expect(skipLogCalls).toHaveLength(4);

    // Cycle 3 — mutate substrate: insert new FACT in jurisdictional domain
    await db.insert(pensieveEntries).values({
      content: 'I moved from Saint Petersburg to Tbilisi this week.',
      epistemicTag: 'FACT',
      createdAt: new Date('2026-05-28T12:00:00Z'),
    });
    primeAllDimensionsValid();
    await updateAllOperationalProfiles({ now: NOW_C3 });
    expect(mockAnthropicParse).toHaveBeenCalledTimes(8);  // 4 + 4 (all dims share substrate now per Phase 34 D-14)
    const historyAfterC3 = await db.select().from(profileHistory);
    expect(historyAfterC3).toHaveLength(8);
  });

  afterAll(async () => {
    await db.delete(profileHistory);
    await seedProfileRows();
  });
});
```

**Note on cycle 3 call count discrepancy** vs CONTEXT.md D-19 ("5 calls"): CONTEXT.md D-19 says "5 cumulative calls (one new call)" but two-cycle.test.ts line 346 asserts 8. This is because Phase 34 D-14 uses a single shared substrate (all 4 dims see same Pensieve set), so mutating ANY entry changes the hash for ALL dims — 4 new calls in C3, not 1. Plan 36-01 inherits this — assert 8, not 5. (CONTEXT.md should be amended via planning addendum if planner sees a path to per-dimension substrate filtering, but per Phase 34 D-14 that's deferred to v2.5.1.)

---

### `src/memory/profiles/__tests__/integration-m010-5days.test.ts` (NEW — PTEST-04)

**Analog:** `src/memory/profiles/__tests__/generators.sparse.test.ts` (closest direct match; inverts expected outcomes from the m010-30days file).

**Scaffold pattern** (lift from `generators.sparse.test.ts:21-102` — same vi.hoisted/vi.mock/imports/cleanupAll/beforeAll setup as the m010-30days file).

**Assertion shape** (lift from lines 104-156, replace seed loop with `loadPrimedFixture('m010-5days')`):
```typescript
describe('PTEST-04 — m010-5days sparse-fixture threshold enforcement', () => {
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
    await loadPrimedFixture('m010-5days');
  });

  beforeEach(async () => {
    await db.delete(profileHistory);
    await seedProfileRows();
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
  });

  it('5-day fixture → all 4 outcomes=profile_below_threshold, NO Sonnet call, 4 skip logs', async () => {
    const allJBefore = await db.select().from(profileJurisdictional);
    const allCBefore = await db.select().from(profileCapital);
    const allHBefore = await db.select().from(profileHealth);
    const allFBefore = await db.select().from(profileFamily);

    const outcomes = await updateAllOperationalProfiles({
      now: new Date('2026-05-17T22:00:00.000Z'),
    });

    // ── 1. NO Sonnet call (D-19; GEN-06; D-22) ────────────────────────────
    expect(mockAnthropicParse).not.toHaveBeenCalled();

    // ── 2. All 4 outcomes profile_below_threshold (CONTEXT.md D-14) ───────
    expect(outcomes.every((o) => o.outcome === 'profile_below_threshold')).toBe(true);

    // ── 3. 4× 'chris.profile.threshold.below_minimum' log key (CONTEXT.md D-22) ─
    const thresholdLogCalls = mockLoggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.profile.threshold.below_minimum',
    );
    expect(thresholdLogCalls).toHaveLength(4);

    // ── 4. Profile rows unchanged from seed (lift before/after diff pattern from sparse test:158-190)
    const allJAfter = await db.select().from(profileJurisdictional);
    const allCAfter = await db.select().from(profileCapital);
    const allHAfter = await db.select().from(profileHealth);
    const allFAfter = await db.select().from(profileFamily);
    for (const [before, after] of [[allJBefore, allJAfter], [allCBefore, allCAfter], [allHBefore, allHAfter], [allFBefore, allFAfter]] as const) {
      const byIdAfter = new Map(after.map((r) => [r.id, r]));
      for (const b of before) {
        const a = byIdAfter.get(b.id);
        expect(a).toBeDefined();
        if (a) {
          expect(a.substrateHash).toBe(b.substrateHash);
          expect(a.confidence).toBe(b.confidence);
        }
      }
    }
  });
});
```

---

### `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` (NEW — PTEST-05, live 3-of-3)

**Analog:** `src/rituals/__tests__/live-weekly-review.test.ts` (D-32 verbatim).

**Cost-callout file header** (lift the docblock shape from `live-weekly-review.test.ts:1-26`):
```typescript
/**
 * src/memory/profiles/__tests__/live-anti-hallucination.test.ts — Phase 36 Plan 36-02 (PTEST-05).
 *
 * Live 3-of-3 atomic anti-hallucination test against real Sonnet. Mirrors
 * M009 TEST-31 / M008 TEST-22. Dual-gated per D-30-03 cost discipline:
 * requires BOTH RUN_LIVE_TESTS AND ANTHROPIC_API_KEY. Default
 * `bash scripts/test.sh` runs SKIP this test (zero API spend).
 *
 * Manual invocation:
 *   RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... \
 *     bash scripts/test.sh src/memory/profiles/__tests__/live-anti-hallucination.test.ts
 *
 * Cost: ~$0.20 per run (3 × Sonnet 4.6 calls × ~$0.067 each).
 */
```

**Dual-gate describe.skipIf** (lift verbatim from line 65):
```typescript
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)(
  'PTEST-05: Live anti-hallucination (3-of-3 against real Sonnet)',
  () => {
    // ...
  },
);
```

**3-of-3 internal loop pattern** (lift verbatim from lines 68-130):
```typescript
it(
  'zero forbidden facts AND profile block present across 3-of-3 iterations',
  async () => {
    const failures: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await handleReflect(
        CHAT_ID_LIVE_ANTI_HALLUCINATION,
        "Help me think about my next quarter's priorities",
        'English',
        [],
      );
      // ... assertions per iteration, push failures
    }
    expect(failures, 'Across 3-of-3 iterations').toEqual([]);
  },
  90_000, // 90s timeout (3 × ~25s per Sonnet call)
);
```

**Mock-spy-with-passthrough pattern** (RESEARCH Pattern 4 — vitest's `vi.spyOn` preserves original implementation by default):
```typescript
import { anthropic } from '../../llm/client.js';

let spy: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  await loadPrimedFixture('m010-30days');
  // Pre-populate profile rows: either run real Sonnet via updateAllOperationalProfiles
  // (cost: ~4 extra Haiku/Sonnet calls) OR commit a pre-populated profile snapshot
  // into seed-profile-rows.ts as a separate "live-prep" fixture (planner decides).
  // CONTEXT.md D-26 expects the m010-30days fixture to already contain the populated
  // profile state at fixture-generation time.
  spy = vi.spyOn(anthropic.messages, 'create');  // PASS-THROUGH — no .mockImplementation()
});
```

**First assertion — system prompt contains profile block** (D-27):
```typescript
const callArgs = spy.mock.calls[spy.mock.calls.length - 1]![0] as {
  system: Array<{ text: string }>;
};
const systemText = callArgs.system[0]!.text;
expect(systemText).toContain('## Operational Profile (grounded context — not interpretation)');
expect(systemText).toMatch(/(current_country|fi_target_amount|jurisdictional|capital)/);
```
**Verified header text:** `src/memory/profiles.ts:211` defines `PROFILE_INJECTION_HEADER = '## Operational Profile (grounded context — not interpretation)'` — assertion above matches verbatim.

**Verified call site:** `src/chris/modes/reflect.ts:90-101` invokes `anthropic.messages.create({ system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }], ... })` — the `system` arg is an array of one cache-controlled text block.

**Second assertion — FORBIDDEN_FACTS keyword scan** (lift the `findFlatteryHits`-style scan pattern from `live-weekly-review.test.ts:113-127` for the iteration-aggregating logic):
```typescript
const FORBIDDEN_FACTS = [
  'moving to Portugal', 'Spain residency', 'Israeli passport', 'British citizenship',
  '$5,000,000', '$10M target', 'early retirement', 'selling the business',
  'diabetes', 'cancer', 'depression diagnosis', 'ADHD medication',
  'children', 'divorced', 'engaged', 'married',
] as const;

const allMarkers = results.flatMap((r, i) => {
  const text = r.toLowerCase();
  return FORBIDDEN_FACTS
    .filter((f) => text.includes(f.toLowerCase()))
    .map((m) => `iter${i + 1}: "${m}"`);
});
expect(allMarkers, 'Across 3-of-3 iterations: forbidden facts').toEqual([]);
```

**Chat ID constant** — see Shared Patterns / chat-ids.

---

### `scripts/__tests__/synthesize-delta.test.ts` (MODIFIED — extend existing file)

**Analog:** the file itself. The existing scaffold (`scripts/__tests__/synthesize-delta.test.ts:25-117`) already mocks `cachedMessagesParse`, `autoRefreshIfStale`, `anthropic`, `logger`, and `postgres`. Plan 36-01 ADDS the following test cases to the existing `describe('synthesize() end-to-end (mocked VCR)')` block or a new `describe('--profile-bias flag (PTEST-01)')` sibling.

**Existing parseArgs test shape to mirror** (lines 118-169):
```typescript
describe('parseCliArgs', () => {
  it('accepts a fully-valid flag set', () => {
    const args = parseCliArgs([
      '--organic', 'tests/fixtures/prod-snapshot/LATEST',
      '--target-days', '14',
      '--seed', '42',
      '--milestone', 'm008',
    ]);
    expect(args.organic).toBe('tests/fixtures/prod-snapshot/LATEST');
    // ...
  });
```

**Add cases per test_strategy item 1.a-e**:
```typescript
describe('--profile-bias flag (PTEST-01)', () => {
  it('accepts --profile-bias as repeatable (single + multiple)', () => {
    const argsSingle = parseCliArgs([
      '--organic', 'x', '--target-days', '5', '--seed', '42', '--milestone', 'm010',
      '--profile-bias', 'jurisdictional',
    ]);
    expect(argsSingle.profileBias).toEqual(['jurisdictional']);

    const argsMulti = parseCliArgs([
      '--organic', 'x', '--target-days', '5', '--seed', '42', '--milestone', 'm010',
      '--profile-bias', 'jurisdictional',
      '--profile-bias', 'capital',
    ]);
    expect(argsMulti.profileBias).toEqual(['jurisdictional', 'capital']);
  });

  it('rejects unknown dimensions', () => {
    expect(() =>
      parseCliArgs([
        '--organic', 'x', '--target-days', '5', '--seed', '42', '--milestone', 'm010',
        '--profile-bias', 'invalid-dim',
      ]),
    ).toThrow(/profile-bias/);
  });

  it('defaults to empty array when omitted (legacy behavior preserved)', () => {
    const args = parseCliArgs([
      '--organic', 'x', '--target-days', '5', '--seed', '42', '--milestone', 'm010',
    ]);
    expect(args.profileBias).toEqual([]);
  });

  it('per-day rotation: jurisdictional → capital → health → family → wrap (D-09)', () => {
    // Test PROFILE_BIAS_ROTATION[d % 4] mapping via exported helper
    expect(dimensionHintFor(0, ['jurisdictional','capital','health','family'])).toContain('current location');
    expect(dimensionHintFor(1, ['jurisdictional','capital','health','family'])).toContain('FI target');
    expect(dimensionHintFor(4, ['jurisdictional','capital','health','family'])).toContain('current location');
  });

  it('keyword hint appears in Haiku prompt for biased day (synthesize end-to-end)', async () => {
    await synthesize({
      organic: ORGANIC_TINY,
      targetDays: 4,
      seed: 42,
      milestone: 'test-bias',
      noRefresh: true,
      outRoot: outDir,
      profileBias: ['jurisdictional'],
    });
    const callArgs = vi.mocked(cachedMessagesParse).mock.calls[0]![0] as {
      system: string;
    };
    expect(callArgs.system).toContain('current location');  // jurisdictional keyword
  });

  it('no hint when --profile-bias omitted (legacy)', async () => {
    await synthesize({ organic: ORGANIC_TINY, targetDays: 4, seed: 42, milestone: 'test-nb', noRefresh: true, outRoot: outDir });
    const callArgs = vi.mocked(cachedMessagesParse).mock.calls[0]![0] as { system: string };
    expect(callArgs.system).not.toContain('Focus today\'s entries on');
  });

  it('VCR cache hash differs between biased and unbiased prompts (D-06)', async () => {
    // Capture cachedMessagesParse call args, hash via hashRequest, assert distinct
  });
});
```

---

### `src/__tests__/fixtures/chat-ids.ts` (MODIFIED — add 1 constant)

**Existing values** (`src/__tests__/fixtures/chat-ids.ts:19-31`):
```typescript
export const CHAT_ID_CHRIS_LIVE = BigInt(99901);
export const CHAT_ID_SYNTHETIC_FIXTURE = BigInt(99918);
export const CHAT_ID_LIVE_ACCOUNTABILITY = BigInt(99919);
export const CHAT_ID_VAGUE_VALIDATOR_LIVE = BigInt(99920);
export const CHAT_ID_M009_SYNTHETIC_FIXTURE = BigInt(99921);
```

**TESTING.md:105 rule:** "every test file that writes chat-scoped rows MUST import its chat ID from here. When adding a new test file, allocate the next ID." Next available numerical slot = `99922`. The pattern-mapping prompt mentions `99936` (a 1000-aligned slot per RESEARCH); but the existing convention is `99921 → 99922` sequential. **Recommend the sequential `99922`** to match the registry's actual numeric convention (which uses sequential per-test IDs, not phase-aligned offsets). The "next 1000-aligned slot" framing from RESEARCH appears to be a misreading of the registry — TESTING.md:105 literally says "allocate the next ID," and the existing IDs are densely packed 99918→99921. Use `99922`. Planner may override to `99936` if there is a separate phase-numbering convention not visible in the file itself.

**Append:**
```typescript
/** Phase 36 PTEST-05 live anti-hallucination (src/memory/profiles/__tests__/live-anti-hallucination.test.ts). */
export const CHAT_ID_LIVE_ANTI_HALLUCINATION = BigInt(99922);
```

---

## Shared Patterns

### Hoisted-mock setup (mockAnthropicParse + mockLogger)

**Source:** `src/memory/profiles/__tests__/generators.two-cycle.test.ts:48-79` and `src/memory/profiles/__tests__/generators.sparse.test.ts:23-55` (identical).
**Apply to:** Both integration tests (`integration-m010-30days.test.ts`, `integration-m010-5days.test.ts`).

```typescript
const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));
vi.mock('../../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../llm/client.js')>();
  return { ...orig, anthropic: { messages: { parse: mockAnthropicParse, create: vi.fn() } } };
});
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError, debug: vi.fn() },
}));
```

Project rule: **`vi.hoisted` is canonical** when `vi.mock` factories must close over mock references (TESTING.md:147-162).

### Logger-spy log-key assertion

**Source:** `src/memory/profiles/__tests__/generators.sparse.test.ts:146-152`.
**Apply to:** `integration-m010-5days.test.ts` (PTEST-04 4× `'chris.profile.threshold.below_minimum'`) AND `integration-m010-30days.test.ts` Cycle 2 (4× `'chris.profile.profile_skipped_no_change'`).

```typescript
const thresholdLogCalls = mockLoggerInfo.mock.calls.filter(
  (c) => c[1] === 'chris.profile.threshold.below_minimum',
);
expect(thresholdLogCalls).toHaveLength(4);
const loggedDimensions = thresholdLogCalls
  .map((c) => (c[0] as { dimension: string }).dimension)
  .sort();
expect(loggedDimensions).toEqual(['capital', 'family', 'health', 'jurisdictional']);
```

Logger convention: project uses `logger.info(context, 'event.key')` — the FIRST positional is the context object (`c[0]`), the SECOND is the log key string (`c[1]`).

### Cleanup (TRUNCATE CASCADE) — used in beforeEach/afterAll

**Source:** `src/memory/profiles/__tests__/generators.two-cycle.test.ts:100-108` and `generators.sparse.test.ts:76-85`.
**Apply to:** Both new integration tests for general non-profile cleanup (loadPrimedFixture already covers most via FK-safe DELETE, but profile_history needs explicit cleanup since loadPrimedFixture does not touch profile_*).

```typescript
async function cleanupAll() {
  await db.delete(profileHistory);
  await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE decision_events CASCADE`);
  await db.execute(sql`TRUNCATE TABLE decisions CASCADE`);
}
```

For Plan 36-01 integration tests, replace the in-test TRUNCATE with `loadPrimedFixture()` (covers everything) + `db.delete(profileHistory)` + `seedProfileRows()` (covers profile_* reset).

### File header (numbered test coverage list + `Run:` example)

**Source:** `.planning/codebase/TESTING.md:114-138` + every existing test file.
**Apply to:** All 4 new test files. Match `/**` JSDoc shape exactly — file path on line 1, phase + plan + task ID, test coverage enumeration, `Run:` block at end.

### Live-test dual-gate

**Source:** `src/rituals/__tests__/live-weekly-review.test.ts:65` (also documented in TESTING.md:196-213).
**Apply to:** `live-anti-hallucination.test.ts` only.

```typescript
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)(
  'PTEST-05: ...',
  () => { /* ... */ },
);
```

CI-safety property: when either env var is absent, the `describe` is entirely skipped (no test count fluctuation, no API calls).

### Mock-spy-with-passthrough (vitest native)

**Source:** vitest docs https://vitest.dev/api/vi.html#vi-spyon — `vi.spyOn(obj, method)` WITHOUT a follow-up `.mockImplementation(...)` preserves the original implementation while recording call args.
**Precedent in this repo:** None — Plan 36-02 introduces the precedent. Closest related pattern is `vi.spyOn(logger, 'info')` used in the generators tests (but those are not "pass-through" because the logger module itself is mocked above the spy).
**Apply to:** `live-anti-hallucination.test.ts` to capture `anthropic.messages.create` args while letting real Sonnet calls execute.

```typescript
import { anthropic } from '../../llm/client.js';
const spy = vi.spyOn(anthropic.messages, 'create');  // pass-through
// ... real call executes; spy.mock.calls[N][0] holds the request object
```

**Critical:** Do NOT pair this with `vi.mock('../../llm/client.js', ...)` — that would replace `anthropic` wholesale and defeat the spy. PTEST-05 spy-only; PTEST-02/03/04 mock-only.

### Test file header docstring

All test files in the project open with the JSDoc shape per TESTING.md:114-138. Lift the per-test enumeration shape:
```
 *  Test 1   — <REQUIREMENT-ID> <one-line description>
 *  Test 2   — <REQUIREMENT-ID> <one-line description>
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| (none) | — | — | All 8 files have direct in-codebase analogs |

The pattern-mapping prompt's #5 ("`vi.spyOn` pass-through pattern — find any precedent or document the pattern") is the ONLY case where NO direct codebase precedent exists. Plan 36-02 documents the vitest-native behavior (spies preserve originals when no `.mockImplementation` is attached) and introduces the precedent. This is the cleanest path; the alternative (hand-rolled wrapper) adds boilerplate without benefit per RESEARCH Pattern 4.

## Metadata

**Analog search scope:**
- `scripts/__tests__/` — synthesize-delta unit-test scaffold
- `src/__tests__/fixtures/` — primed-fixture pipeline (load-primed, primed-sanity, chat-ids)
- `src/memory/profiles/__tests__/` — Phase 34 two-cycle + sparse scaffolds (CORRECTED filenames: `generators.two-cycle.test.ts` and `generators.sparse.test.ts`; CONTEXT.md references `generators.test.ts` which does NOT exist)
- `src/rituals/__tests__/` — M009 live-test dual-gate scaffold (live-weekly-review.test.ts)
- `src/episodic/__tests__/` — M008 live-test 3-of-3 internal-loop precedent (live-anti-flattery.test.ts)
- `src/chris/modes/` — REFLECT handler call-site (reflect.ts: getOperationalProfiles → formatProfilesForPrompt → buildSystemPrompt → anthropic.messages.create)
- `src/memory/profiles.ts` — PROFILE_INJECTION_HEADER text source (line 211)
- `src/db/migrations/0012_operational_profiles.sql` — seed-row INSERT statements (lines 132-204)
- `scripts/synthesize-delta.ts` — parseArgs (lines 149-161), Haiku prompt builder (lines 264-276), per-day call site (lines 521-527)
- `.planning/codebase/TESTING.md` — chat-id convention (line 105), dual-gate pattern (lines 196-213), 3-of-3 pattern (lines 215-219), forbidden `vi.useFakeTimers` (line 178)

**Files scanned:** 14
**Pattern extraction date:** 2026-05-13
