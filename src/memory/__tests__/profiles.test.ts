/**
 * src/memory/__tests__/profiles.test.ts — Phase 33 Plan 33-02 Task 4
 *                                          (PROF-04 never-throw contract)
 *
 * Mocked-DB integration tests for getOperationalProfiles(). The never-throw
 * contract (D-12) is absolute: per-profile null on parse mismatch (D-13);
 * { jurisdictional: null, capital: null, health: null, family: null } on
 * DB-level failure.
 *
 * Run in isolation:
 *   npx vitest run src/memory/__tests__/profiles.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────
// Drizzle's chain is `db.select().from(table).where(...).limit(n)`. To mock
// it we replace each step with a vi.fn() returning the next. The final
// `.limit()` returns a Promise<rows[]>.

const { mockSelect, mockFrom, mockWhere, mockLimit, mockLogWarn } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockLimit: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('../../db/connection.js', () => ({
  db: { select: mockSelect },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: mockLogWarn,
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Import AFTER mocks so the module resolves against the mocks.
let getOperationalProfiles: typeof import('../profiles.js')['getOperationalProfiles'];

beforeEach(async () => {
  vi.clearAllMocks();
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockWhere.mockReturnValue({ limit: mockLimit });
  // Re-import per test so module state is fresh
  const mod = await import('../profiles.js');
  getOperationalProfiles = mod.getOperationalProfiles;
});

// ── Fixtures: rows shaped as if SELECTed from migration 0012 seeded tables ─

const jurisdictionalRow = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'primary',
  schemaVersion: 1,
  substrateHash: '',
  confidence: 0.3,
  dataConsistency: 0,
  currentCountry: 'Russia',
  physicalLocation: 'Saint Petersburg',
  residencyStatus: [
    { type: 'permanent_residency', value: 'Panama' },
    { type: 'business_residency', value: 'Georgian Individual Entrepreneur' },
  ],
  taxResidency: null,
  activeLegalEntities: [{ name: 'MAINGRET LLC', jurisdiction: 'New Mexico, USA' }],
  nextPlannedMove: { destination: 'Batumi, Georgia', from_date: '2026-04-28' },
  plannedMoveDate: '2026-04-28',
  passportCitizenships: ['French'],
  lastUpdated: new Date('2026-05-11T00:00:00Z'),
  createdAt: new Date('2026-05-11T00:00:00Z'),
};

const capitalRow = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'primary',
  schemaVersion: 1,
  substrateHash: '',
  confidence: 0.2,
  dataConsistency: 0,
  fiPhase: null,
  fiTargetAmount: '$1,500,000',
  estimatedNetWorth: null,
  runwayMonths: null,
  nextSequencingDecision: null,
  incomeSources: [{ source: 'Golfe-Juan rental', kind: 'rental_income' }],
  majorAllocationDecisions: [],
  taxOptimizationStatus: null,
  activeLegalEntities: [{ name: 'MAINGRET LLC', jurisdiction: 'New Mexico, USA' }],
  lastUpdated: new Date('2026-05-11T00:00:00Z'),
  createdAt: new Date('2026-05-11T00:00:00Z'),
};

const healthRow = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'primary',
  schemaVersion: 1,
  substrateHash: '',
  confidence: 0,
  dataConsistency: 0,
  openHypotheses: [],
  pendingTests: [],
  activeTreatments: [],
  recentResolved: [],
  caseFileNarrative: 'insufficient data',
  wellbeingTrend: { energy_30d_mean: null, mood_30d_mean: null, anxiety_30d_mean: null },
  lastUpdated: new Date('2026-05-11T00:00:00Z'),
  createdAt: new Date('2026-05-11T00:00:00Z'),
};

const familyRow = {
  id: '44444444-4444-4444-4444-444444444444',
  name: 'primary',
  schemaVersion: 1,
  substrateHash: '',
  confidence: 0,
  dataConsistency: 0,
  relationshipStatus: 'insufficient data',
  partnershipCriteriaEvolution: [],
  childrenPlans: 'insufficient data',
  parentCareResponsibilities: { notes: null, dependents: [] },
  activeDatingContext: 'insufficient data',
  milestones: [],
  constraints: [],
  lastUpdated: new Date('2026-05-11T00:00:00Z'),
  createdAt: new Date('2026-05-11T00:00:00Z'),
};

// ── Tests ────────────────────────────────────────────────────────────────

describe('getOperationalProfiles — happy path', () => {
  it('returns 4 parsed profiles when all 4 SELECTs return valid seeded rows', async () => {
    mockLimit
      .mockResolvedValueOnce([jurisdictionalRow])
      .mockResolvedValueOnce([capitalRow])
      .mockResolvedValueOnce([healthRow])
      .mockResolvedValueOnce([familyRow]);

    const result = await getOperationalProfiles();

    expect(result.jurisdictional).not.toBeNull();
    expect(result.capital).not.toBeNull();
    expect(result.health).not.toBeNull();
    expect(result.family).not.toBeNull();
    expect(result.jurisdictional!.confidence).toBe(0.3);
    expect(result.capital!.confidence).toBe(0.2);
    expect(result.health!.confidence).toBe(0);
    expect(result.family!.confidence).toBe(0);
    expect(mockLogWarn).not.toHaveBeenCalled();
  });
});

describe('getOperationalProfiles — empty DB', () => {
  it('returns 4 nulls when no profile rows exist (mockLimit resolves [])', async () => {
    mockLimit.mockResolvedValue([]);
    const result = await getOperationalProfiles();
    expect(result.jurisdictional).toBeNull();
    expect(result.capital).toBeNull();
    expect(result.health).toBeNull();
    expect(result.family).toBeNull();
    // No DB error; logger.warn should NOT fire for empty result
    expect(mockLogWarn).not.toHaveBeenCalled();
  });
});

describe('getOperationalProfiles — never-throw on DB error (D-12)', () => {
  it('returns { all null } and logs warn when ALL 4 SELECTs throw', async () => {
    mockLimit.mockRejectedValue(new Error('connection refused'));
    const result = await getOperationalProfiles();
    expect(result).toEqual({
      jurisdictional: null,
      capital: null,
      health: null,
      family: null,
    });
    // 4 warns expected (one per per-profile try/catch — Pitfall 5)
    expect(mockLogWarn).toHaveBeenCalledTimes(4);
    const warnTags = mockLogWarn.mock.calls.map((c) => c[1]);
    for (const tag of warnTags) {
      expect(tag).toBe('chris.profile.read.error');
    }
  });

  it('partial failure: 3 succeed + 1 throws → 3 parsed + 1 null', async () => {
    mockLimit
      .mockResolvedValueOnce([jurisdictionalRow])
      .mockResolvedValueOnce([capitalRow])
      .mockRejectedValueOnce(new Error('health table timeout'))
      .mockResolvedValueOnce([familyRow]);

    const result = await getOperationalProfiles();
    expect(result.jurisdictional).not.toBeNull();
    expect(result.capital).not.toBeNull();
    expect(result.health).toBeNull();
    expect(result.family).not.toBeNull();
    expect(mockLogWarn).toHaveBeenCalledTimes(1);
    expect(mockLogWarn.mock.calls[0][1]).toBe('chris.profile.read.error');
  });
});

describe('getOperationalProfiles — schema mismatch (D-13)', () => {
  it('schema_version=999 returns null for that profile + warn schema_mismatch (NEVER throws — Pitfall 6)', async () => {
    const futureSchemaRow = { ...jurisdictionalRow, schemaVersion: 999 };
    mockLimit
      .mockResolvedValueOnce([futureSchemaRow])
      .mockResolvedValueOnce([capitalRow])
      .mockResolvedValueOnce([healthRow])
      .mockResolvedValueOnce([familyRow]);

    const result = await getOperationalProfiles();
    expect(result.jurisdictional).toBeNull();
    expect(result.capital).not.toBeNull();
    expect(result.health).not.toBeNull();
    expect(result.family).not.toBeNull();
    expect(mockLogWarn).toHaveBeenCalled();
    const warnCalls = mockLogWarn.mock.calls.filter((c) => c[1] === 'chris.profile.read.schema_mismatch');
    expect(warnCalls.length).toBe(1);
  });

  it('invalid jsonb shape (currentCountry as number) returns null + warn schema_mismatch', async () => {
    const malformedRow = { ...jurisdictionalRow, currentCountry: 123 };
    mockLimit
      .mockResolvedValueOnce([malformedRow])
      .mockResolvedValueOnce([capitalRow])
      .mockResolvedValueOnce([healthRow])
      .mockResolvedValueOnce([familyRow]);

    const result = await getOperationalProfiles();
    expect(result.jurisdictional).toBeNull();
    expect(result.capital).not.toBeNull();
    const warnCalls = mockLogWarn.mock.calls.filter((c) => c[1] === 'chris.profile.read.schema_mismatch');
    expect(warnCalls.length).toBeGreaterThanOrEqual(1);
  });
});
