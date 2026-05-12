/**
 * src/memory/profiles/__tests__/generators.sparse.test.ts — Phase 34 Plan 02 Task 6
 *
 * GEN-06 threshold short-circuit test. Seeds 5 substrate-tagged Pensieve
 * entries (BELOW the MIN_ENTRIES_THRESHOLD=10 floor), calls each of the 4
 * generators, and verifies:
 *
 *   1. mockAnthropicParse NOT called (D-19 — threshold check BEFORE Sonnet)
 *   2. Each generator returns outcome='profile_below_threshold'
 *   3. Each generator logs 'chris.profile.threshold.below_minimum' verbatim
 *      (REQUIREMENTS GEN-06 names this exact key)
 *   4. Profile rows unchanged from Phase 33 seed (substrate_hash='' preserved)
 *
 * Real Docker Postgres + mocked Anthropic SDK + mocked logger (so we can
 * assert on the log key). Mirrors src/rituals/__tests__/weekly-review.test.ts
 * mock setup pattern.
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/generators.sparse.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// ── Hoisted mocks (must be vi.hoisted so vi.mock factories can see them) ───

const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

// Mock anthropic SDK at the client export. ESM partial-spread so SONNET_MODEL
// and other constants keep their real values.
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

// Mock the logger so we can assert on log key emission.
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

// Imports AFTER vi.mock so the modules under test see the mocked deps.
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
} from '../../../db/schema.js';
import { loadProfileSubstrate } from '../shared.js';
import { generateJurisdictionalProfile } from '../jurisdictional.js';
import { generateCapitalProfile } from '../capital.js';
import { generateHealthProfile } from '../health.js';
import { generateFamilyProfile } from '../family.js';

const NOW = new Date('2026-05-12T22:00:00Z');
const IN_WINDOW = new Date('2026-04-22T12:00:00Z'); // 20 days before NOW

async function cleanupAll() {
  await db.delete(pensieveEmbeddings);
  await db.delete(pensieveEntries);
  await db.delete(episodicSummaries);
  await db.delete(decisions);
}

describe('GEN-06 threshold short-circuit (sparse 5-entry fixture)', () => {
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

  it('5 entries (below threshold=10) → all 4 generators return profile_below_threshold, NO Sonnet call', async () => {
    // Seed exactly 5 entries — one per substrate tag + one extra FACT.
    // entryCount = 5 < MIN_ENTRIES_THRESHOLD (10) → threshold gate triggers.
    const tags = ['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE', 'FACT'] as const;
    for (let i = 0; i < tags.length; i++) {
      await db.insert(pensieveEntries).values({
        content: `sparse entry ${i} tagged ${tags[i]}`,
        epistemicTag: tags[i],
        createdAt: IN_WINDOW,
      });
    }

    // Capture pre-call profile row state (from Phase 33 seed migration 0012)
    const allJBefore = await db.select().from(profileJurisdictional);
    const allCBefore = await db.select().from(profileCapital);
    const allHBefore = await db.select().from(profileHealth);
    const allFBefore = await db.select().from(profileFamily);

    const substrate = await loadProfileSubstrate(NOW);
    expect(substrate.entryCount).toBe(5);

    const outcomes = await Promise.all([
      generateJurisdictionalProfile({ substrate }),
      generateCapitalProfile({ substrate }),
      generateHealthProfile({ substrate }),
      generateFamilyProfile({ substrate }),
    ]);

    // ── 1. NO Sonnet call (D-19; GEN-06) ────────────────────────────────────
    expect(mockAnthropicParse).not.toHaveBeenCalled();

    // ── 2. All 4 outcomes are profile_below_threshold ───────────────────────
    expect(outcomes.every((o) => o.outcome === 'profile_below_threshold')).toBe(true);
    for (const o of outcomes) {
      if (o.outcome === 'profile_below_threshold') {
        expect(o.entryCount).toBe(5);
      }
    }
    const dimensions = outcomes.map((o) => o.dimension).sort();
    expect(dimensions).toEqual(['capital', 'family', 'health', 'jurisdictional']);

    // ── 3. Verbatim log key 'chris.profile.threshold.below_minimum' × 4 ─────
    const thresholdLogCalls = mockLoggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.profile.threshold.below_minimum',
    );
    expect(thresholdLogCalls).toHaveLength(4);
    // Confirm each call carries the right dimension + entryCount context
    const loggedDimensions = thresholdLogCalls.map((c) => (c[0] as { dimension: string }).dimension).sort();
    expect(loggedDimensions).toEqual(['capital', 'family', 'health', 'jurisdictional']);
    for (const call of thresholdLogCalls) {
      const ctx = call[0] as { entryCount: number };
      expect(ctx.entryCount).toBe(5);
    }

    // ── 4. Profile rows unchanged from Phase 33 seed (substrate_hash='') ───
    //     The seed migration 0012 may or may not have populated these tables
    //     in the test environment. Whatever was there before MUST still be
    //     there after; no rows mutated.
    const allJAfter = await db.select().from(profileJurisdictional);
    const allCAfter = await db.select().from(profileCapital);
    const allHAfter = await db.select().from(profileHealth);
    const allFAfter = await db.select().from(profileFamily);
    expect(allJAfter.length).toBe(allJBefore.length);
    expect(allCAfter.length).toBe(allCBefore.length);
    expect(allHAfter.length).toBe(allHBefore.length);
    expect(allFAfter.length).toBe(allFBefore.length);
    for (const row of [...allJAfter, ...allCAfter, ...allHAfter, ...allFAfter]) {
      // Seed row contract: substrate_hash starts empty until first successful regen
      expect(row.substrateHash).toBe('');
    }
  });

  it('0 entries (empty substrate) → all 4 generators return profile_below_threshold, NO Sonnet call', async () => {
    // No seeding at all — entryCount=0 < 10 → threshold gate triggers
    const substrate = await loadProfileSubstrate(NOW);
    expect(substrate.entryCount).toBe(0);

    const outcomes = await Promise.all([
      generateJurisdictionalProfile({ substrate }),
      generateCapitalProfile({ substrate }),
      generateHealthProfile({ substrate }),
      generateFamilyProfile({ substrate }),
    ]);

    expect(mockAnthropicParse).not.toHaveBeenCalled();
    expect(outcomes.every((o) => o.outcome === 'profile_below_threshold')).toBe(true);
    for (const o of outcomes) {
      if (o.outcome === 'profile_below_threshold') {
        expect(o.entryCount).toBe(0);
      }
    }
  });
});
