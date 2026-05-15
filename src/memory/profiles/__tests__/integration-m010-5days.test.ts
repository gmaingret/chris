/**
 * src/memory/profiles/__tests__/integration-m010-5days.test.ts —
 * Phase 36 Plan 01 Task 6 (PTEST-04 sparse-fixture threshold enforcement).
 *
 * Real Docker Postgres + mocked Anthropic SDK + `loadPrimedFixture('m010-5days')`.
 * Mirrors generators.sparse.test.ts pattern per D-21 — same vi.hoisted +
 * vi.mock setup, same before/after profile-row equality pattern.
 *
 * Key difference vs the Phase 34 sparse test (`generators.sparse.test.ts`):
 * substrate comes from a primed fixture (5 substrate-tagged entries
 * manually picked from m010-30days; see m010-5days MANIFEST.json for
 * construction notes) instead of in-test pensieve inserts.
 *
 * ## PTEST-04 contract (D-14 + D-22)
 *
 *   - Load m010-5days fixture: 5 substrate-tagged entries (1 each of
 *     FACT / RELATIONSHIP / INTENTION / EXPERIENCE + 1 extra FACT)
 *   - substrate.entryCount = 5 < MIN_ENTRIES_THRESHOLD (10) → threshold gate
 *     short-circuits BEFORE Sonnet
 *   - Run all 4 generators concurrently via Promise.all
 *   - Assertions (D-22 verbatim):
 *     1. mockAnthropicParse NEVER called (D-14 cost-floor contract; T-36-08)
 *     2. All 4 outcomes are `'profile_below_threshold'`
 *     3. 4× `'chris.profile.threshold.below_minimum'` log entries with
 *        dimensions sorted [capital, family, health, jurisdictional]
 *     4. Profile rows byte-equal before/after — substrate_hash + confidence
 *        + lastUpdated all preserved (threshold short-circuit MUST NOT
 *        mutate profile state — anti-drift contract)
 *
 * Pitfall mitigations:
 *
 *   - **P-36-01 (gitignore):** existsSync(MANIFEST) skip-when-absent
 *   - **P-36-02 (loader doesn't seed profile_*):** `seedProfileRows()` in
 *     beforeEach. Critical for the byte-equality check — without it, a
 *     prior test's confidence=0.86 leak would PASS the "byte-equal" gate
 *     trivially (both before and after see the leaked value).
 *
 * ## Why we deliberately don't prime mockAnthropicParse
 *
 * Per D-14: "expect(mockAnthropicParse).not.toHaveBeenCalled()" is the
 * cost-floor contract. If the orchestrator skips threshold gating and
 * calls Sonnet anyway, `mockAnthropicParse` (a fresh `vi.fn()`) returns
 * undefined, the v3 schema validation throws, and the test FAILS with a
 * clear error class. The negative assertion + the throw-on-call work
 * together as belt-and-suspenders.
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/integration-m010-5days.test.ts
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

const FIXTURE_NAME = 'm010-5days';
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);

if (!FIXTURE_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[integration-m010-5days] SKIP: ${FIXTURE_PATH} not found. The m010-5days\n` +
      `  fixture is manually constructed as a 5-entry pick from m010-30days\n` +
      `  (synthesize-delta does not truncate organic input). Regenerate by\n` +
      `  picking 5 substrate-tagged entries from m010-30days/pensieve_entries.jsonl\n` +
      `  (1 each of FACT/RELATIONSHIP/INTENTION/EXPERIENCE + 1 extra FACT).\n` +
      `  See tests/fixtures/primed/m010-5days/MANIFEST.json for the\n` +
      `  full construction note.`,
  );
}

// Phase 44 CI-01: REQUIRE_FIXTURES=1 env-gated hard-fail.
if (!FIXTURE_PRESENT && process.env.REQUIRE_FIXTURES === '1') {
  describe('[CI-GATE] fixture present', () => {
    it(`${FIXTURE_PATH} must exist when REQUIRE_FIXTURES=1`, () => {
      throw new Error(
        `Milestone-gate fixture missing: ${FIXTURE_PATH}. ` +
          `Regenerate via: npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 5 --profile-bias jurisdictional --profile-bias capital --profile-bias health --profile-bias family --seed 42 --no-refresh ` +
          `(NOTE: m010-5days is manually constructed as a 5-entry pick from m010-30days; see tests/fixtures/primed/m010-5days/MANIFEST.json.)`,
      );
    });
  });
}

const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;

// ── NOW anchor — same band as the 30days test for window coverage ──────────
// The 5-day fixture's pensieve entries are all dated 2026-04-15 (picked from
// the earliest-organic-day batch). NOW_C1 anywhere in [2026-04-15, 2026-06-14]
// captures them. Use 2026-05-20 to align with the 30days test's first cycle.

const NOW = new Date('2026-05-20T22:00:00.000Z');

// ── Test suite ──────────────────────────────────────────────────────────────

skipIfAbsent('integration-m010-5days: PTEST-04 sparse threshold enforcement (D-14 + D-22)', () => {
  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
    await loadPrimedFixture(FIXTURE_NAME);
  });

  beforeEach(async () => {
    // P-36-02 mitigation — reset profile rows to seed state before each test
    // so the before/after byte-equality check has a known baseline.
    await seedProfileRows();
    mockAnthropicParse.mockReset();
    mockLoggerInfo.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
    // Deliberately NOT priming mockAnthropicParse — any call here is a
    // contract violation; the unprimed mock returns undefined → v3 schema
    // throws → test fails loud.
  });

  afterAll(async () => {
    // Clean state for downstream test files.
    await db.delete(profileHistory);
    await seedProfileRows();
  });

  it('PTEST-04: 5 entries → all 4 dims trip threshold, zero Sonnet calls, profile rows unchanged', async () => {
    // ── Pre-call snapshot ───────────────────────────────────────────────────
    const allJBefore = await db.select().from(profileJurisdictional);
    const allCBefore = await db.select().from(profileCapital);
    const allHBefore = await db.select().from(profileHealth);
    const allFBefore = await db.select().from(profileFamily);

    // ── Substrate load ─────────────────────────────────────────────────────
    const substrate = await loadProfileSubstrate(NOW);
    // m010-5days has 5 substrate-tagged entries (1 each + 1 extra FACT)
    expect(substrate.entryCount).toBeLessThan(10); // below MIN_ENTRIES_THRESHOLD
    expect(substrate.entryCount).toBeGreaterThanOrEqual(1); // anti-zero

    // ── Fire all 4 generators ──────────────────────────────────────────────
    const outcomes = await Promise.all([
      generateJurisdictionalProfile({ substrate }),
      generateCapitalProfile({ substrate }),
      generateHealthProfile({ substrate }),
      generateFamilyProfile({ substrate }),
    ]);

    // ── 1. NO Sonnet call (D-14 + T-36-08 cost-floor contract) ──────────────
    expect(mockAnthropicParse).not.toHaveBeenCalled();

    // ── 2. All 4 outcomes are profile_below_threshold (D-22) ────────────────
    expect(outcomes.every((o) => o.outcome === 'profile_below_threshold')).toBe(true);

    // ── 3. 4× threshold log entries with sorted dimensions ──────────────────
    const thresholdLogCalls = mockLoggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.profile.threshold.below_minimum',
    );
    expect(thresholdLogCalls).toHaveLength(4);
    const loggedDimensions = thresholdLogCalls
      .map((c) => (c[0] as { dimension: string }).dimension)
      .sort();
    expect(loggedDimensions).toEqual(['capital', 'family', 'health', 'jurisdictional']);

    // ── 4. Profile rows unchanged from seed (anti-drift / no-mutation) ──────
    // Threshold short-circuit MUST NOT mutate profile rows. Compare each
    // row by primary-key id ↔ substrate_hash + confidence + last_updated.
    // (Per generators.sparse.test.ts:158-190 by-id Map pattern.)
    const allJAfter = await db.select().from(profileJurisdictional);
    const allCAfter = await db.select().from(profileCapital);
    const allHAfter = await db.select().from(profileHealth);
    const allFAfter = await db.select().from(profileFamily);

    expect(allJAfter.length).toBe(allJBefore.length);
    expect(allCAfter.length).toBe(allCBefore.length);
    expect(allHAfter.length).toBe(allHBefore.length);
    expect(allFAfter.length).toBe(allFBefore.length);

    const beforeAfterPairs: Array<
      [
        Array<{ id: string; substrateHash: string; confidence: number; lastUpdated: Date }>,
        Array<{ id: string; substrateHash: string; confidence: number; lastUpdated: Date }>,
      ]
    > = [
      [allJBefore, allJAfter],
      [allCBefore, allCAfter],
      [allHBefore, allHAfter],
      [allFBefore, allFAfter],
    ];
    for (const [before, after] of beforeAfterPairs) {
      const byIdAfter = new Map(after.map((r) => [r.id, r]));
      for (const b of before) {
        const a = byIdAfter.get(b.id);
        expect(a).toBeDefined();
        if (a) {
          expect(a.substrateHash).toBe(b.substrateHash);
          expect(a.confidence).toBe(b.confidence);
          expect(a.lastUpdated.getTime()).toBe(b.lastUpdated.getTime());
        }
      }
    }

    // ── 5. No profile_history rows written on threshold-skip path (D-30) ────
    // Belt-and-suspenders against silent partial-mutation regressions.
    const history = await db.select().from(profileHistory);
    expect(history).toHaveLength(0);
  });
});
