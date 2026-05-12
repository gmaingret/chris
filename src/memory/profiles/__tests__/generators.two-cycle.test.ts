/**
 * src/memory/profiles/__tests__/generators.two-cycle.test.ts — Phase 34 Plan 02 Task 7
 *
 * HARD CO-LOC #M10-3 — this test ships in Plan 34-02 ALONGSIDE the substrate-hash
 * logic. gsd-plan-checker rejects if split across plans. M009 `lt→lte`
 * second-fire-blindness bug (commit c76cb86, 2026-05-10) is the direct
 * precedent class — that bug shipped because the regression test for it
 * was in a different plan than the offending boundary expression. This
 * test exists to prevent the same class of bug in Phase 34.
 *
 * Test architecture: 3 sequential cycles in a single test block. Per
 * TESTING.md D-02 + src/rituals/__tests__/weekly-review.test.ts comment block,
 * the codebase convention is NOT to use vi.useFakeTimers (which clashes with
 * the `postgres` driver's internal setTimeout/setInterval bookkeeping during
 * connection management). Instead, each cycle passes an explicit `now` to
 * `loadProfileSubstrate(now)` to deterministically anchor the 60-day window.
 *
 *   Cycle 1 (T=0, baseline) — seed 12 substrate-tagged Pensieve entries,
 *     prime mockAnthropicParse with 4 valid v3 responses, call all 4
 *     generators. Asserts: 4 Sonnet calls, 4 profile_history rows, all 4
 *     outcomes 'profile_updated', substrate_hash now 64-char hex.
 *
 *   Cycle 2 (T+7d, identical substrate) — DO NOT mutate DB; re-call all 4
 *     generators. Asserts: STILL 4 total Sonnet calls (NOT 8 — hash match
 *     → skip), profile_history STILL 4 rows (no history on skip path),
 *     all 4 outcomes 'profile_skipped_no_change'. This is the
 *     second-fire-blindness regression detector.
 *
 *   Cycle 3 (T+14d, mutated substrate) — CRITICAL — RESEARCH.md residual
 *     risk lines 931-935 + VALIDATION.md row 34-02-03: Cycle 3 INSERTs a
 *     NEW Pensieve entry. Do NOT mutate existing entry text — the
 *     substrate hash is over IDs not content (D-15), so a text-edit on an
 *     existing row hashes identical and silently exercises the skip path
 *     with WRONG SEMANTICS. The test inserts a new UUID, which changes
 *     the ID set for all 4 dimensions. Prime 4 NEW mocks. Asserts: 8
 *     cumulative Sonnet calls (4 from C1 + 0 from C2 + 4 from C3),
 *     profile_history has 8 rows (4 from C1 + 4 from C3), all 4 C3
 *     outcomes 'profile_updated'.
 *
 * Decoupling: this test calls the 4 generators directly (not via the
 * orchestrator from Plan 34-03 — which doesn't exist yet). Plan 34-03's
 * orchestrator test re-runs this scenario via Promise.allSettled with
 * per-dimension error isolation (D-21).
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/generators.two-cycle.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

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
  pensieveEmbeddings,
  episodicSummaries,
  decisions,
  profileJurisdictional,
  profileCapital,
  profileHealth,
  profileFamily,
  profileHistory,
} from '../../../db/schema.js';
import { loadProfileSubstrate, computeSubstrateHash } from '../shared.js';
import { generateJurisdictionalProfile } from '../jurisdictional.js';
import { generateCapitalProfile } from '../capital.js';
import { generateHealthProfile } from '../health.js';
import { generateFamilyProfile } from '../family.js';

// ── Fixture builders ───────────────────────────────────────────────────────

async function cleanupAll() {
  await db.delete(profileHistory);
  await db.delete(pensieveEmbeddings);
  await db.delete(pensieveEntries);
  await db.delete(episodicSummaries);
  await db.delete(decisions);
}

/**
 * Valid v3-shape jurisdictional response (data_consistency=0.4 — well below
 * the 0.5 ceiling so volume-weight refine passes regardless of entryCount).
 */
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
 * Prime the mockAnthropicParse to return a dimension-appropriate response
 * based on the prompt content. The 4 generators are called concurrently via
 * Promise.all so per-call mockResolvedValueOnce ordering is racy — instead
 * we inspect the assembled `system` text for the dimension-focus header
 * and return the matching response shape.
 *
 * Plan 34-01's prompt builder includes `## Dimension Focus — Jurisdictional`
 * (or Capital/Health/Family) in the system string verbatim, so we can route
 * deterministically off that substring.
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
    // Should never happen — fail loudly
    throw new Error(`primeAllDimensionsValid: unrecognized dimension focus in prompt. First 200 chars: ${systemText.slice(0, 200)}`);
  });
}

const FUTURE_RESOLVE_BY = new Date('2027-12-31T00:00:00Z');

describe('HARD CO-LOC #M10-3 — two-cycle substrate-hash idempotency (D-36, GEN-07)', () => {
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
  });

  beforeEach(async () => {
    await cleanupAll();
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
  });

  afterAll(async () => {
    await cleanupAll();
  });

  it('Cycle 1 → 4 calls + 4 history rows; Cycle 2 (identical) → STILL 4 calls; Cycle 3 (INSERT new entry) → 8 calls', async () => {
    // Anchor times for the 3 simulated weekly cron fires. Each is passed
    // explicitly to loadProfileSubstrate(now) — see header comment for why
    // fake timers are not used.
    const NOW_C1 = new Date('2026-05-17T22:00:00.000Z');
    const NOW_C2 = new Date('2026-05-24T22:00:00.000Z'); // +7d
    const NOW_C3 = new Date('2026-05-31T22:00:00.000Z'); // +14d

    // ── CYCLE 1 (T=0, seed substrate) ────────────────────────────────────
    // Seed 12 Pensieve entries (above threshold=10) distributed across all
    // 4 substrate tags. The schema requires non-null id only via default,
    // so we use the default gen_random_uuid(). createdAt set to a day
    // before NOW so they fall inside the 60-day window.
    const seedCreatedAt = new Date('2026-05-10T12:00:00Z');
    for (let i = 0; i < 12; i++) {
      const tag = (['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE'] as const)[i % 4];
      await db.insert(pensieveEntries).values({
        content: `cycle-1 entry ${i} tagged ${tag}`,
        epistemicTag: tag,
        createdAt: seedCreatedAt,
      });
    }

    primeAllDimensionsValid();

    const substrate1 = await loadProfileSubstrate(NOW_C1);
    expect(substrate1.entryCount).toBe(12);

    const outcomes1 = await Promise.all([
      generateJurisdictionalProfile({ substrate: substrate1 }),
      generateCapitalProfile({ substrate: substrate1 }),
      generateHealthProfile({ substrate: substrate1 }),
      generateFamilyProfile({ substrate: substrate1 }),
    ]);

    // Asserts: 4 Sonnet calls
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);
    // All 4 outcomes profile_updated
    expect(outcomes1.every((o) => o.outcome === 'profile_updated')).toBe(true);
    // profile_history has 4 rows (write-before-upsert per D-29, one per dim)
    const historyAfterC1 = await db.select().from(profileHistory);
    expect(historyAfterC1).toHaveLength(4);
    // Each profile row's substrate_hash is now a 64-char hex (NOT the '' seed)
    const [jRow, cRow, hRow, fRow] = await Promise.all([
      db.select().from(profileJurisdictional).limit(1),
      db.select().from(profileCapital).limit(1),
      db.select().from(profileHealth).limit(1),
      db.select().from(profileFamily).limit(1),
    ]);
    expect(jRow[0]!.substrateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cRow[0]!.substrateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hRow[0]!.substrateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(fRow[0]!.substrateHash).toMatch(/^[0-9a-f]{64}$/);

    // ── CYCLE 2 (T+7d, IDENTICAL substrate) ──────────────────────────────
    // Do NOT mutate DB. Substrate is byte-identical (the seed Pensieve
    // entries are still in the 60-day window). Hash WILL match prior fire.

    // We do NOT prime new mocks — if any Sonnet call happens, mockAnthropicParse
    // returns undefined (no further mockResolvedValueOnce) which will throw
    // in the parse step. The skip path SHOULD prevent this.

    const substrate2 = await loadProfileSubstrate(NOW_C2);
    expect(substrate2.entryCount).toBe(12);

    // Compute expected hash and verify it matches what was stored in C1
    const expectedHash = computeSubstrateHash(substrate2, {
      substrate_hash: jRow[0]!.substrateHash,
      schema_version: jRow[0]!.schemaVersion,
    });
    expect(expectedHash).toBe(jRow[0]!.substrateHash);

    const outcomes2 = await Promise.all([
      generateJurisdictionalProfile({ substrate: substrate2 }),
      generateCapitalProfile({ substrate: substrate2 }),
      generateHealthProfile({ substrate: substrate2 }),
      generateFamilyProfile({ substrate: substrate2 }),
    ]);

    // CRITICAL — second-fire-blindness regression check
    // mockAnthropicParse STILL called only 4 times (NOT 8) — hash idempotency
    expect(mockAnthropicParse).toHaveBeenCalledTimes(4);
    // All 4 outcomes are profile_skipped_no_change
    expect(outcomes2.every((o) => o.outcome === 'profile_skipped_no_change')).toBe(true);
    // profile_history STILL 4 rows (no history row on hash-skip path, D-30)
    const historyAfterC2 = await db.select().from(profileHistory);
    expect(historyAfterC2).toHaveLength(4);
    // Skip log key emitted 4 times
    const skipLogCalls = mockLoggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.profile.profile_skipped_no_change',
    );
    expect(skipLogCalls).toHaveLength(4);

    // ── CYCLE 3 (T+14d, INSERT new Pensieve entry) ───────────────────────
    // CRITICAL — RESEARCH.md residual risk lines 931-935 + VALIDATION.md row 34-02-03:
    // Cycle 3 INSERTs a NEW Pensieve entry (new UUID — changes the ID set).
    // Do NOT mutate existing entry text — the substrate hash is over
    // pensieveIds.sort(), so a text edit on an existing row hashes identical
    // and silently exercises the skip path with WRONG SEMANTICS. The test
    // exists to catch the second-fire-blindness regression class.
    await db.insert(pensieveEntries).values({
      content: 'I moved from Saint Petersburg to Tbilisi this week.',
      epistemicTag: 'FACT',
      createdAt: new Date('2026-05-28T12:00:00Z'), // in the 60-day window from C3 NOW
    });

    // Prime 4 NEW mock responses for the C3 regen
    primeAllDimensionsValid();

    const substrate3 = await loadProfileSubstrate(NOW_C3);
    expect(substrate3.entryCount).toBe(13); // 12 + 1 new

    const outcomes3 = await Promise.all([
      generateJurisdictionalProfile({ substrate: substrate3 }),
      generateCapitalProfile({ substrate: substrate3 }),
      generateHealthProfile({ substrate: substrate3 }),
      generateFamilyProfile({ substrate: substrate3 }),
    ]);

    // Cumulative 8 Sonnet calls (4 from C1 + 0 from C2 + 4 from C3)
    expect(mockAnthropicParse).toHaveBeenCalledTimes(8);
    // All 4 C3 outcomes profile_updated
    expect(outcomes3.every((o) => o.outcome === 'profile_updated')).toBe(true);
    // profile_history has 8 rows (4 from C1 + 0 from C2 + 4 from C3)
    const historyAfterC3 = await db.select().from(profileHistory);
    expect(historyAfterC3).toHaveLength(8);
  });
});
