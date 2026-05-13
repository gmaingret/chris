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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 35 Plan 35-02 — PROFILE_INJECTION_MAP + formatProfilesForPrompt
// Pure-function tests (D-08 / D-09 / D-10 / D-11 / D-12 / D-13)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { afterEach } from 'vitest';
import type {
  ProfileRow,
  OperationalProfiles,
} from '../profiles.js';
import type {
  JurisdictionalProfileData,
  CapitalProfileData,
  HealthProfileData,
  FamilyProfileData,
} from '../profiles/schemas.js';

const NOW = new Date('2026-05-13T12:00:00Z');
const STALE_DATE = new Date('2026-04-01T12:00:00Z'); // 42 days before NOW
const FRESH_DATE = new Date('2026-04-29T12:00:00Z'); // 14 days before NOW

function makeRow<T>(data: T, confidence: number, lastUpdated: Date = FRESH_DATE): ProfileRow<T> {
  return { data, confidence, lastUpdated, schemaVersion: 1 };
}

function jurisdictionalData(overrides: Partial<JurisdictionalProfileData> = {}): JurisdictionalProfileData {
  return {
    current_country: 'France',
    physical_location: 'Antibes',
    residency_status: [],
    tax_residency: 'France',
    active_legal_entities: [],
    next_planned_move: { destination: null, from_date: null },
    planned_move_date: null,
    passport_citizenships: ['French'],
    data_consistency: 0.8,
    ...overrides,
  };
}

function capitalData(overrides: Partial<CapitalProfileData> = {}): CapitalProfileData {
  return {
    fi_phase: 'accumulation',
    fi_target_amount: '$1,500,000',
    estimated_net_worth: '$900,000',
    runway_months: 36,
    next_sequencing_decision: 'evaluate-rental-income',
    income_sources: [],
    major_allocation_decisions: [],
    tax_optimization_status: null,
    active_legal_entities: [],
    data_consistency: 0.8,
    ...overrides,
  };
}

function healthData(overrides: Partial<HealthProfileData> = {}): HealthProfileData {
  return {
    open_hypotheses: [],
    pending_tests: [],
    active_treatments: [],
    recent_resolved: [],
    case_file_narrative: 'Stable',
    wellbeing_trend: { energy_30d_mean: 7, mood_30d_mean: 7, anxiety_30d_mean: 3 },
    data_consistency: 0.8,
    ...overrides,
  };
}

function familyData(overrides: Partial<FamilyProfileData> = {}): FamilyProfileData {
  return {
    relationship_status: 'partnered',
    partnership_criteria_evolution: [],
    children_plans: 'undecided',
    parent_care_responsibilities: { notes: null, dependents: [] },
    active_dating_context: null,
    milestones: [],
    constraints: [],
    data_consistency: 0.8,
    ...overrides,
  };
}

function freshProfiles(overrides: Partial<OperationalProfiles> = {}): OperationalProfiles {
  return {
    jurisdictional: makeRow(jurisdictionalData(), 0.7),
    capital: makeRow(capitalData(), 0.7),
    health: makeRow(healthData(), 0.7),
    family: makeRow(familyData(), 0.7),
    ...overrides,
  };
}

const ALL_NULL_PROFILES: OperationalProfiles = {
  jurisdictional: null,
  capital: null,
  health: null,
  family: null,
};

describe('PROFILE_INJECTION_MAP — shape (D-08)', () => {
  it('REFLECT contains all 4 dimensions in declaration order', async () => {
    const { PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PROFILE_INJECTION_MAP.REFLECT).toEqual(['jurisdictional', 'capital', 'health', 'family']);
    expect(PROFILE_INJECTION_MAP.REFLECT.length).toBe(4);
  });

  it("COACH equals ['capital', 'family'] (M010-08(b) — no health to avoid topic drift)", async () => {
    const { PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PROFILE_INJECTION_MAP.COACH).toEqual(['capital', 'family']);
  });

  it("PSYCHOLOGY equals ['health', 'jurisdictional']", async () => {
    const { PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PROFILE_INJECTION_MAP.PSYCHOLOGY).toEqual(['health', 'jurisdictional']);
  });

  it('JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY are NOT keys in the map (D-28 negative invariant)', async () => {
    const { PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect('JOURNAL' in PROFILE_INJECTION_MAP).toBe(false);
    expect('INTERROGATE' in PROFILE_INJECTION_MAP).toBe(false);
    expect('PRODUCE' in PROFILE_INJECTION_MAP).toBe(false);
    expect('PHOTOS' in PROFILE_INJECTION_MAP).toBe(false);
    expect('ACCOUNTABILITY' in PROFILE_INJECTION_MAP).toBe(false);
  });
});

describe('formatProfilesForPrompt — gates and rendering (D-09..D-13)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns empty string when mode is not in PROFILE_INJECTION_MAP (D-12.a)', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    const profiles = freshProfiles();
    expect(formatProfilesForPrompt(profiles, 'JOURNAL')).toBe('');
    expect(formatProfilesForPrompt(profiles, 'INTERROGATE')).toBe('');
    expect(formatProfilesForPrompt(profiles, 'PRODUCE')).toBe('');
    expect(formatProfilesForPrompt(profiles, 'PHOTOS')).toBe('');
    expect(formatProfilesForPrompt(profiles, 'ACCOUNTABILITY')).toBe('');
    expect(formatProfilesForPrompt(profiles, 'UNKNOWN_MODE')).toBe('');
  });

  it('returns empty string when all in-scope dimensions are null (D-12.b)', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    expect(formatProfilesForPrompt(ALL_NULL_PROFILES, 'REFLECT')).toBe('');
    expect(formatProfilesForPrompt(ALL_NULL_PROFILES, 'COACH')).toBe('');
    expect(formatProfilesForPrompt(ALL_NULL_PROFILES, 'PSYCHOLOGY')).toBe('');
  });

  it('returns empty string when all in-scope dimensions are zero-confidence (D-12.c)', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    const profiles: OperationalProfiles = {
      jurisdictional: makeRow(jurisdictionalData(), 0),
      capital: makeRow(capitalData(), 0),
      health: makeRow(healthData(), 0),
      family: makeRow(familyData(), 0),
    };
    expect(formatProfilesForPrompt(profiles, 'REFLECT')).toBe('');
  });

  it('PSYCHOLOGY returns empty when only health-low-conf + jurisdictional-null (D-12.d)', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    const profiles: OperationalProfiles = {
      jurisdictional: null,
      capital: makeRow(capitalData(), 0.7), // not in PSYCHOLOGY scope
      health: makeRow(healthData(), 0.3), // below 0.5 gate
      family: makeRow(familyData(), 0.7), // not in PSYCHOLOGY scope
    };
    expect(formatProfilesForPrompt(profiles, 'PSYCHOLOGY')).toBe('');
  });

  it('PSYCHOLOGY: health below 0.5 is skipped, jurisdictional renders → header present, health absent (D-09)', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    const profiles: OperationalProfiles = {
      jurisdictional: makeRow(jurisdictionalData({ current_country: 'TestlandFR' }), 0.7),
      capital: null,
      health: makeRow(healthData({ case_file_narrative: 'CONFIDENTIAL_HEALTH_MARKER' }), 0.3),
      family: null,
    };
    const out = formatProfilesForPrompt(profiles, 'PSYCHOLOGY');
    expect(out).not.toBe('');
    expect(out.startsWith('## Operational Profile (grounded context — not interpretation)')).toBe(true);
    expect(out).toContain('TestlandFR');
    expect(out).not.toContain('CONFIDENTIAL_HEALTH_MARKER');
  });

  it('appends staleness qualifier when lastUpdated > 21 days ago (D-10)', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    const profiles: OperationalProfiles = {
      jurisdictional: makeRow(jurisdictionalData(), 0.7, STALE_DATE), // 42 days old
      capital: null,
      health: null,
      family: null,
    };
    const out = formatProfilesForPrompt(profiles, 'REFLECT');
    expect(out).toContain('Note: profile data from 2026-04-01 — may not reflect current state.');
  });

  it('does NOT append staleness qualifier when lastUpdated ≤ 21 days ago', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    const profiles: OperationalProfiles = {
      jurisdictional: makeRow(jurisdictionalData(), 0.7, FRESH_DATE), // 14 days old
      capital: null,
      health: null,
      family: null,
    };
    const out = formatProfilesForPrompt(profiles, 'REFLECT');
    expect(out).not.toContain('Note: profile data from');
  });

  it('truncates a per-dimension block exceeding 2000 chars with ... marker (D-11)', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    // Force a > 2000-char render: long narrative on health.case_file_narrative
    // (we use REFLECT — health is in scope at confidence 0.7)
    const longString = 'X'.repeat(5000);
    const profiles: OperationalProfiles = {
      jurisdictional: null,
      capital: null,
      health: makeRow(
        healthData({ case_file_narrative: longString }),
        0.7,
        FRESH_DATE,
      ),
      family: null,
    };
    const out = formatProfilesForPrompt(profiles, 'REFLECT');
    // Header + (capped health block) → total length is bounded; per-dimension
    // block (after header strip) must end with '...' and be ≤ 2000 chars.
    const HEADER = '## Operational Profile (grounded context — not interpretation)\n\n';
    expect(out.startsWith(HEADER)).toBe(true);
    const body = out.slice(HEADER.length);
    expect(body.length).toBeLessThanOrEqual(2000);
    expect(body.endsWith('...')).toBe(true);
  });

  it('REFLECT renders all 4 dimensions in declaration order (jurisdictional, capital, health, family)', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    const profiles: OperationalProfiles = {
      jurisdictional: makeRow(jurisdictionalData({ current_country: 'MARKER_JURISDICTIONAL' }), 0.7),
      capital: makeRow(capitalData({ fi_target_amount: 'MARKER_CAPITAL' }), 0.7),
      health: makeRow(healthData({ case_file_narrative: 'MARKER_HEALTH' }), 0.7),
      family: makeRow(familyData({ relationship_status: 'MARKER_FAMILY' }), 0.7),
    };
    const out = formatProfilesForPrompt(profiles, 'REFLECT');
    const iJur = out.indexOf('MARKER_JURISDICTIONAL');
    const iCap = out.indexOf('MARKER_CAPITAL');
    const iHea = out.indexOf('MARKER_HEALTH');
    const iFam = out.indexOf('MARKER_FAMILY');
    expect(iJur).toBeGreaterThan(0);
    expect(iCap).toBeGreaterThan(iJur);
    expect(iHea).toBeGreaterThan(iCap);
    expect(iFam).toBeGreaterThan(iHea);
  });

  it('COACH renders ONLY capital + family (no health, no jurisdictional)', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    const profiles: OperationalProfiles = {
      jurisdictional: makeRow(jurisdictionalData({ current_country: 'MARKER_JURISDICTIONAL_VALUE' }), 0.7),
      capital: makeRow(capitalData({ fi_target_amount: 'MARKER_CAPITAL_VALUE' }), 0.7),
      health: makeRow(healthData({ case_file_narrative: 'MARKER_HEALTH_VALUE' }), 0.7),
      family: makeRow(familyData({ relationship_status: 'MARKER_FAMILY_VALUE' }), 0.7),
    };
    const out = formatProfilesForPrompt(profiles, 'COACH');
    expect(out).toContain('MARKER_CAPITAL_VALUE');
    expect(out).toContain('MARKER_FAMILY_VALUE');
    expect(out).not.toContain('MARKER_HEALTH_VALUE');
    expect(out).not.toContain('MARKER_JURISDICTIONAL_VALUE');
  });

  it('emits the verbatim D-13 header when at least one dimension renders', async () => {
    const { formatProfilesForPrompt } = await import('../profiles.js');
    const profiles: OperationalProfiles = {
      jurisdictional: makeRow(jurisdictionalData(), 0.7),
      capital: null,
      health: null,
      family: null,
    };
    const out = formatProfilesForPrompt(profiles, 'REFLECT');
    expect(out.startsWith('## Operational Profile (grounded context — not interpretation)')).toBe(true);
  });
});
