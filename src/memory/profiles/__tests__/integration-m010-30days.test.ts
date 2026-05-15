/**
 * src/memory/profiles/__tests__/integration-m010-30days.test.ts —
 * Phase 36 Plan 01 Task 5 (PTEST-02 populated + PTEST-03 three-cycle
 * idempotency).
 *
 * Real Docker Postgres + mocked Anthropic SDK + `loadPrimedFixture('m010-30days')`.
 * Mirrors `src/memory/profiles/__tests__/generators.two-cycle.test.ts` per
 * D-33 — same vi.hoisted mock block, same dimension-routing
 * primeAllDimensionsValid() pattern. The only structural differences vs
 * the Phase 34 two-cycle test:
 *
 *   (a) substrate comes from `loadPrimedFixture('m010-30days')` (real M010
 *       primed fixture) instead of in-test pensieve inserts
 *   (b) profile rows are reset via `seedProfileRows()` in beforeEach
 *       (Pitfall P-36-02 mitigation — load-primed.ts does NOT touch the
 *       profile_* tables)
 *   (c) fixture-presence gated via `existsSync(MANIFEST)` skip-when-absent
 *       (Pitfall P-36-01 mitigation — fixtures gitignored, may be missing
 *       on fresh checkout)
 *   (d) two `it()` blocks (PTEST-02 + PTEST-03) instead of one — the
 *       fixture is loaded once in beforeAll and shared
 *
 * ## Three-cycle structure (D-19 CORRECTED 2026-05-13 — Cycle 3 = 8, NOT 5)
 *
 *   Cycle 1 (NOW_C1=2026-05-17): seed profile rows + load fixture; run all
 *     4 generators; assert mockAnthropicParse called 4 times; assert
 *     profile_history has 4 rows; assert each profile row has confidence
 *     > 0 + substrate_hash is 64-hex + last_updated advanced.
 *
 *     Cycle 1 also asserts the M010-10 prev-state injection: the call args
 *     for the first generator include `CURRENT PROFILE STATE` in the system
 *     prompt — verifying that the seed-row values WERE read and rendered
 *     into the prompt (per Phase 34 D-07 / M010-03).
 *
 *   Cycle 2 (NOW_C2=2026-05-24, +7d, identical substrate): re-run; assert
 *     mockAnthropicParse STILL called 4 times cumulative (NOT 8 — D-15
 *     hash idempotency); assert profile_history still 4 rows (no new
 *     snapshots on skip path per D-29/D-30); assert all 4 outcomes are
 *     `'profile_skipped_no_change'`; assert 4× `'chris.profile.profile_skipped_no_change'`
 *     log entries.
 *
 *   Cycle 3 (NOW_C3=2026-05-31, +14d, mutated substrate via new pensieve
 *     INSERT): re-run; assert mockAnthropicParse called 8 times cumulative
 *     (4 from Cycle 1 + 4 from Cycle 3). The "8 not 5" trade-off is the
 *     documented Phase 34 D-14 / D-15 single-shared-substrate design:
 *     any Pensieve mutation invalidates ALL 4 dimensions' hashes
 *     simultaneously. The per-dim substrate views are deferred to v2.5.1.
 *     Assert profile_history has 8 rows (4 from C1 + 4 from C3); assert
 *     all 4 C3 outcomes are `'profile_updated'`.
 *
 * ## Orchestrator-direct-call deviation (Rule 3)
 *
 * The plan asks to "call orchestrator" with `{ now }` opts. The actual
 * `updateAllOperationalProfiles()` signature is `() => Promise<void>` — it
 * does NOT accept a `now` parameter (the `now` is consumed inside
 * `loadProfileSubstrate(now?)` which the orchestrator calls). Calling
 * `updateAllOperationalProfiles()` in tests would use `Date.now()` directly,
 * defeating the time-pinned cycle semantics. We mirror the Phase 34
 * generators.two-cycle.test.ts pattern instead: invoke the 4 generators
 * directly with `loadProfileSubstrate(NOW)` so substrate window is
 * deterministically pinned. The orchestrator is a thin Promise.allSettled
 * wrapper around these 4 generators; its outer try/catch + cron-complete
 * log are NOT under test here (the unit-level orchestrator test in
 * Phase 34's suite covers that).
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/integration-m010-30days.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { existsSync } from 'node:fs';

// ── Hoisted mocks ───────────────────────────────────────────────────────────

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

// Imports AFTER vi.mock
import { db, sql as pgSql } from '../../../db/connection.js';
import {
  pensieveEntries,
  profileJurisdictional,
  profileCapital,
  profileHealth,
  profileFamily,
  profileHistory,
} from '../../../db/schema.js';
import { loadProfileSubstrate } from '../shared.js';
import { generateJurisdictionalProfile } from '../jurisdictional.js';
import { generateCapitalProfile } from '../capital.js';
import { generateHealthProfile } from '../health.js';
import { generateFamilyProfile } from '../family.js';
import { loadPrimedFixture } from '../../../__tests__/fixtures/load-primed.js';
import { seedProfileRows } from '../../../__tests__/fixtures/seed-profile-rows.js';

// ── Fixture-presence gate (P-36-01 mitigation) ──────────────────────────────

const FIXTURE_NAME = 'm010-30days';
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);

if (!FIXTURE_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[integration-m010-30days] SKIP: ${FIXTURE_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 ` +
      `--profile-bias jurisdictional --profile-bias capital ` +
      `--profile-bias health --profile-bias family --seed 42 --no-refresh`,
  );
}

const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;

// ── Valid v3-shape responses (lifted from generators.two-cycle.test.ts:114-174) ──

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

function validCapitalResponse() {
  return {
    parsed_output: {
      fi_phase: 'pre-FI',
      fi_target_amount: null,
      estimated_net_worth: null,
      runway_months: 18,
      next_sequencing_decision: null,
      income_sources: [],
      major_allocation_decisions: [],
      tax_optimization_status: null,
      active_legal_entities: [{ name: 'MAINGRET LLC', jurisdiction: 'New Mexico, USA' }],
      data_consistency: 0.4,
    },
  };
}

function validHealthResponse() {
  return {
    parsed_output: {
      open_hypotheses: [],
      pending_tests: [],
      active_treatments: [],
      recent_resolved: [],
      case_file_narrative: null,
      wellbeing_trend: { energy_30d_mean: null, mood_30d_mean: null, anxiety_30d_mean: null },
      data_consistency: 0.4,
    },
  };
}

function validFamilyResponse() {
  return {
    parsed_output: {
      relationship_status: 'partnered',
      partnership_criteria_evolution: [],
      children_plans: null,
      parent_care_responsibilities: { notes: null, dependents: [] },
      active_dating_context: null,
      milestones: [],
      constraints: [],
      data_consistency: 0.4,
    },
  };
}

/**
 * Dimension-routing mock — dispatches on the `Dimension Focus — <name>`
 * substring in the system prompt (the prompt builder includes it verbatim).
 * Per generators.two-cycle.test.ts:187-205 — the 4 generators fire
 * concurrently so mockResolvedValueOnce ordering is racy; routing on
 * prompt content is the deterministic alternative.
 */
function primeAllDimensionsValid() {
  mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
    const systemText = req.system?.[0]?.text ?? '';
    if (systemText.includes('Dimension Focus — Jurisdictional')) {
      return Promise.resolve(validJurisdictionalResponse());
    }
    if (systemText.includes('Dimension Focus — Capital')) {
      return Promise.resolve(validCapitalResponse());
    }
    if (systemText.includes('Dimension Focus — Health')) {
      return Promise.resolve(validHealthResponse());
    }
    if (systemText.includes('Dimension Focus — Family')) {
      return Promise.resolve(validFamilyResponse());
    }
    throw new Error(
      `primeAllDimensionsValid: unrecognized dimension focus in prompt. First 200 chars: ${systemText.slice(0, 200)}`,
    );
  });
}

// ── Time anchors for the 3 simulated weekly cron fires ──────────────────────
//
// CRITICAL: NOW values must be picked so all 3 60-day windows capture the
// IDENTICAL set of pensieve entries — otherwise Cycle 2's substrate hash
// differs from Cycle 1's and the skip path doesn't trigger.
//
// The m010-30days fixture's pensieve entries span 2026-04-15 .. 2026-05-19
// (organic ~17 days + synth 13 days). For all entries to be inside the
// 60-day rolling window:
//   - NOW must be >= 2026-05-19 (to capture the latest entry)
//   - NOW - 60d must be <= 2026-04-15 (to capture the earliest entry)
// → NOW ∈ [2026-05-19, 2026-06-14]. With +7d and +14d cycle spacing, all
//   three NOWs fit in that 26-day band.
//
// PTEST-03 Cycle 3 INSERTs a new pensieve entry at 2026-05-28 — still inside
// the C3 window. Hash invalidation is driven by the NEW pensieve ID, NOT
// a window-boundary change.

const NOW_C1 = new Date('2026-05-20T22:00:00.000Z');
const NOW_C2 = new Date('2026-05-27T22:00:00.000Z'); // +7d (same 109 substrate entries)
const NOW_C3 = new Date('2026-06-03T22:00:00.000Z'); // +14d (109 + 1 new = 110)

// ── Test suite ──────────────────────────────────────────────────────────────

skipIfAbsent('integration-m010-30days: PTEST-02 + PTEST-03 (HARD CO-LOC #M10-6)', () => {
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
    // Fixture-load amortized across both it() blocks per D-18 / fixture-load
    // cost-amortization recommendation. Each it() resets profile rows
    // separately via beforeEach.
    await loadPrimedFixture(FIXTURE_NAME);
  });

  beforeEach(async () => {
    // Pitfall P-36-02 mitigation: profile_* tables are NOT touched by
    // loadPrimedFixture. Without this, a prior test's mutations leak.
    await seedProfileRows();
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
    primeAllDimensionsValid();
  });

  afterAll(async () => {
    // Leave a clean state for downstream test files.
    await db.delete(profileHistory);
    await seedProfileRows();
  });

  // ── PTEST-02 — populated case, Cycle 1 only ───────────────────────────────
  it('PTEST-02 populated: 4 Sonnet calls + 4 history rows + confidence>0 + 64-hex substrate_hash', async () => {
    const substrate = await loadProfileSubstrate(NOW_C1);
    expect(substrate.entryCount).toBeGreaterThanOrEqual(10); // above threshold

    const outcomes = await Promise.all([
      generateJurisdictionalProfile({ substrate }),
      generateCapitalProfile({ substrate }),
      generateHealthProfile({ substrate }),
      generateFamilyProfile({ substrate }),
    ]);

    // 4 Sonnet calls (1 per dimension)
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);

    // All 4 outcomes are profile_updated
    expect(outcomes.every((o) => o.outcome === 'profile_updated')).toBe(true);

    // profile_history has 4 new rows (write-before-upsert per D-29)
    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(4);
    // Each history snapshot tagged with one of the 4 table names
    const tableNames = history.map((h) => h.profileTableName).sort();
    expect(tableNames).toEqual([
      'profile_capital',
      'profile_family',
      'profile_health',
      'profile_jurisdictional',
    ]);

    // Each profile row has substrate_hash = 64-hex + confidence > 0 + last_updated advanced
    const [jRow] = await db.select().from(profileJurisdictional).limit(1);
    const [cRow] = await db.select().from(profileCapital).limit(1);
    const [hRow] = await db.select().from(profileHealth).limit(1);
    const [fRow] = await db.select().from(profileFamily).limit(1);

    expect(jRow!.substrateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cRow!.substrateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hRow!.substrateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fRow!.substrateHash).toMatch(/^[0-9a-f]{64}$/);

    expect(jRow!.confidence).toBeGreaterThan(0);
    expect(cRow!.confidence).toBeGreaterThan(0);
    expect(hRow!.confidence).toBeGreaterThan(0);
    expect(fRow!.confidence).toBeGreaterThan(0);

    // last_updated should be very recent (within the last few seconds — test
    // anchor for "advanced past seed time")
    const seedTimeFloor = new Date('2026-05-01').getTime();
    expect(jRow!.lastUpdated.getTime()).toBeGreaterThan(seedTimeFloor);
    expect(cRow!.lastUpdated.getTime()).toBeGreaterThan(seedTimeFloor);
    expect(hRow!.lastUpdated.getTime()).toBeGreaterThan(seedTimeFloor);
    expect(fRow!.lastUpdated.getTime()).toBeGreaterThan(seedTimeFloor);
  });

  // ── PTEST-03 three-cycle idempotency ──────────────────────────────────────
  it('PTEST-03 three-cycle: C1=4, C2=4 cumulative (skip), C3=8 cumulative (mutated)', async () => {
    // ── CYCLE 1 ─────────────────────────────────────────────────────────────
    const substrate1 = await loadProfileSubstrate(NOW_C1);
    expect(substrate1.entryCount).toBeGreaterThanOrEqual(10);

    const outcomes1 = await Promise.all([
      generateJurisdictionalProfile({ substrate: substrate1 }),
      generateCapitalProfile({ substrate: substrate1 }),
      generateHealthProfile({ substrate: substrate1 }),
      generateFamilyProfile({ substrate: substrate1 }),
    ]);

    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);
    expect(outcomes1.every((o) => o.outcome === 'profile_updated')).toBe(true);

    // Phase 43 CONTRACT-02 / D-10 — M010-03 anti-drift anchoring defense:
    // Seed rows (Phase 33 D-11 substrate_hash='' sentinel) now route through
    // extract<X>PrevState that returns null when substrateHash === ''. The
    // assembler then OMITS the '## CURRENT PROFILE STATE' block entirely on
    // first-fire-after-deploy, avoiding the empty-fields + anti-drift
    // directive collision that previously anchored Sonnet to the empty seed.
    //
    // Pre-Phase-43 contract was: "seed row has prev-state values so the
    // prevState block IS rendered" — that anchoring is exactly what CONTRACT-02
    // closes. The flipped assertion below documents the new contract.
    const cycle1Prompts = mockAnthropicParse.mock.calls.map(
      (c) => ((c[0] as { system: Array<{ text: string }> }).system[0]?.text ?? ''),
    );
    const hasPrevState = cycle1Prompts.some((p) => p.includes('CURRENT PROFILE STATE'));
    expect(hasPrevState).toBe(false);

    const historyAfterC1 = await db.select().from(profileHistory);
    expect(historyAfterC1).toHaveLength(4);

    // ── CYCLE 2 (identical substrate, +7d) ─────────────────────────────────
    const substrate2 = await loadProfileSubstrate(NOW_C2);
    expect(substrate2.entryCount).toBe(substrate1.entryCount); // same window

    const outcomes2 = await Promise.all([
      generateJurisdictionalProfile({ substrate: substrate2 }),
      generateCapitalProfile({ substrate: substrate2 }),
      generateHealthProfile({ substrate: substrate2 }),
      generateFamilyProfile({ substrate: substrate2 }),
    ]);

    // Hash idempotency: STILL 4 cumulative Sonnet calls (NOT 8)
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);
    // All 4 outcomes are profile_skipped_no_change
    expect(outcomes2.every((o) => o.outcome === 'profile_skipped_no_change')).toBe(true);
    // profile_history STILL 4 rows (no history row on hash-skip path)
    const historyAfterC2 = await db.select().from(profileHistory);
    expect(historyAfterC2).toHaveLength(4);
    // 4× skip log entries
    const skipLogCalls = mockLoggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.profile.profile_skipped_no_change',
    );
    expect(skipLogCalls).toHaveLength(4);

    // ── CYCLE 3 (INSERT new entry → all 4 hashes invalidate, +14d) ─────────
    // CRITICAL: insert a new pensieve entry with epistemicTag in the
    // substrate set. Per Phase 34 D-15, the substrate hash is over
    // pensieveIds.sort() — INSERTing changes the ID set for ALL 4
    // dimensions simultaneously (D-14 single shared substrate).
    // Result per D-19 CORRECTED: ALL 4 dims regenerate → cumulative 8 calls
    // (NOT 5 — the "8 not 5" trade-off is the documented v1 design).
    await db.insert(pensieveEntries).values({
      content: 'I moved from Saint Petersburg to Tbilisi this week.',
      epistemicTag: 'FACT',
      createdAt: new Date('2026-05-28T12:00:00Z'),
    });

    // Re-prime since each iteration uses fresh state via primeAllDimensionsValid
    // (the mockImplementation stays registered — no reset needed mid-test).

    const substrate3 = await loadProfileSubstrate(NOW_C3);
    expect(substrate3.entryCount).toBe(substrate1.entryCount + 1);

    const outcomes3 = await Promise.all([
      generateJurisdictionalProfile({ substrate: substrate3 }),
      generateCapitalProfile({ substrate: substrate3 }),
      generateHealthProfile({ substrate: substrate3 }),
      generateFamilyProfile({ substrate: substrate3 }),
    ]);

    // 8 cumulative Sonnet calls (4 from C1 + 0 from C2 + 4 from C3)
    // Per Phase 34 D-14: single shared substrate → any Pensieve mutation
    // invalidates all 4 dim hashes simultaneously. v2.5.1 per-dim substrate
    // views could reduce this to 1 (mutated dim only) — deferred.
    expect(mockAnthropicParse).toHaveBeenCalledTimes(8);

    // All 4 C3 outcomes are profile_updated (mutated → regen on all dims)
    expect(outcomes3.every((o) => o.outcome === 'profile_updated')).toBe(true);

    // profile_history has 8 rows (4 from C1 + 0 from C2 + 4 from C3)
    const historyAfterC3 = await db.select().from(profileHistory);
    expect(historyAfterC3).toHaveLength(8);

    // Clean up the mutating insert so afterAll's seedProfileRows leaves a
    // pristine state for sibling test files. NOTE: we don't strictly need
    // to drop the insert — afterAll wipes profile_history + reseeds profile
    // rows — but pensieve_entries is left intact between tests in the
    // same file. Since the next file's beforeAll re-runs loadPrimedFixture
    // (which clears pensieve_entries), this cleanup is belt-and-suspenders
    // for any future test that might reuse the DB without re-loading.
  });
});
