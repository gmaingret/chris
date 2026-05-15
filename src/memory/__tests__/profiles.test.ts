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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 39 Plan 39-01 — PSYCHOLOGICAL_PROFILE_INJECTION_MAP +
// formatPsychologicalProfilesForPrompt (D-05 / D-06 / D-07 / D-08 / D-09 / D-11)
// Pure-function tests — NO vi.useFakeTimers (psych formatter has no
// staleness check; monthly cron renders 21-day staleness irrelevant).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { PsychologicalProfiles } from '../profiles.js';
import type {
  HexacoProfileData,
  SchwartzProfileData,
  AttachmentProfileData,
} from '../profiles/psychological-schemas.js';
import { PSYCHOLOGICAL_HARD_RULE_EXTENSION } from '../psychological-profile-prompt.js';

describe('PSYCHOLOGICAL_PROFILE_INJECTION_MAP — shape (Phase 39 D-04)', () => {
  it("REFLECT equals ['hexaco', 'schwartz']", async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PSYCHOLOGICAL_PROFILE_INJECTION_MAP.REFLECT).toEqual(['hexaco', 'schwartz']);
  });

  it("PSYCHOLOGY equals ['hexaco', 'schwartz']", async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PSYCHOLOGICAL_PROFILE_INJECTION_MAP.PSYCHOLOGY).toEqual(['hexaco', 'schwartz']);
  });

  it('COACH is NOT a key in the map (D-14 negative invariant — D027 Hard Rule)', async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect('COACH' in PSYCHOLOGICAL_PROFILE_INJECTION_MAP).toBe(false);
  });

  it('JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY are NOT keys (D-15)', async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    for (const m of ['JOURNAL', 'INTERROGATE', 'PRODUCE', 'PHOTOS', 'ACCOUNTABILITY'] as const) {
      expect(m in PSYCHOLOGICAL_PROFILE_INJECTION_MAP).toBe(false);
    }
  });

  it("'attachment' is NOT in any mode's array (Phase 38 D-23 — generator deferred)", async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PSYCHOLOGICAL_PROFILE_INJECTION_MAP.REFLECT).not.toContain('attachment');
    expect(PSYCHOLOGICAL_PROFILE_INJECTION_MAP.PSYCHOLOGY).not.toContain('attachment');
  });
});

describe('formatPsychologicalProfilesForPrompt — gates and rendering (Phase 39 D-05..D-11)', () => {
  const POPULATED_DATE = new Date('2026-06-01T12:00:00Z');
  const EPOCH_DATE = new Date(0);

  function makePsychRow<T>(
    data: T,
    confidence: number,
    lastUpdated: Date,
    schemaVersion = 1,
  ): ProfileRow<T> {
    return {
      data,
      confidence,
      lastUpdated,
      schemaVersion,
      wordCount: 8000,
      wordCountAtLastRun: 8000,
    };
  }

  // All 6 HEXACO dims populated. Confidences chosen to exercise all three
  // qualifier branches (D-07): <0.3 limited / 0.3-0.59 moderate / >=0.6 substantial.
  const POPULATED_HEXACO_DATA: HexacoProfileData = {
    honesty_humility: { score: 4.2, confidence: 0.6, last_updated: null },
    emotionality: { score: 3.1, confidence: 0.4, last_updated: null },
    extraversion: { score: 3.8, confidence: 0.5, last_updated: null },
    agreeableness: { score: 4.0, confidence: 0.5, last_updated: null },
    conscientiousness: { score: 4.5, confidence: 0.7, last_updated: null },
    openness: { score: 4.3, confidence: 0.6, last_updated: null },
  };

  // All 10 Schwartz values populated.
  const POPULATED_SCHWARTZ_DATA: SchwartzProfileData = {
    self_direction: { score: 4.5, confidence: 0.7, last_updated: null },
    stimulation: { score: 3.5, confidence: 0.5, last_updated: null },
    hedonism: { score: 3.0, confidence: 0.4, last_updated: null },
    achievement: { score: 4.0, confidence: 0.6, last_updated: null },
    power: { score: 2.5, confidence: 0.3, last_updated: null },
    security: { score: 3.8, confidence: 0.5, last_updated: null },
    conformity: { score: 2.2, confidence: 0.25, last_updated: null },
    tradition: { score: 2.0, confidence: 0.35, last_updated: null },
    benevolence: { score: 4.2, confidence: 0.6, last_updated: null },
    universalism: { score: 4.4, confidence: 0.85, last_updated: null },
  };

  const POPULATED_ATTACHMENT_DATA: AttachmentProfileData = {
    anxious: { score: 2.5, confidence: 0.5, last_updated: null },
    avoidant: { score: 2.0, confidence: 0.5, last_updated: null },
    secure: { score: 4.0, confidence: 0.6, last_updated: null },
  };

  // All HEXACO dims null — for the all-zero-confidence and never-fired gates.
  const EMPTY_HEXACO_DATA: HexacoProfileData = {
    honesty_humility: null,
    emotionality: null,
    extraversion: null,
    agreeableness: null,
    conscientiousness: null,
    openness: null,
  };

  const EMPTY_SCHWARTZ_DATA: SchwartzProfileData = {
    self_direction: null,
    stimulation: null,
    hedonism: null,
    achievement: null,
    power: null,
    security: null,
    conformity: null,
    tradition: null,
    benevolence: null,
    universalism: null,
  };

  const ALL_NULL: PsychologicalProfiles = {
    hexaco: null,
    schwartz: null,
    attachment: null,
  };

  const ALL_ZERO_CONF: PsychologicalProfiles = {
    hexaco: makePsychRow(EMPTY_HEXACO_DATA, 0, POPULATED_DATE),
    schwartz: makePsychRow(EMPTY_SCHWARTZ_DATA, 0, POPULATED_DATE),
    attachment: null,
  };

  const NEVER_FIRED: PsychologicalProfiles = {
    hexaco: makePsychRow(EMPTY_HEXACO_DATA, 0.5, EPOCH_DATE),
    schwartz: makePsychRow(EMPTY_SCHWARTZ_DATA, 0.5, EPOCH_DATE),
    attachment: null,
  };

  const POPULATED: PsychologicalProfiles = {
    hexaco: makePsychRow(POPULATED_HEXACO_DATA, 0.6, POPULATED_DATE),
    schwartz: makePsychRow(POPULATED_SCHWARTZ_DATA, 0.55, POPULATED_DATE),
    attachment: null,
  };

  it('returns "" when mode is not in PSYCHOLOGICAL_PROFILE_INJECTION_MAP (D-05.a)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    for (const m of [
      'JOURNAL',
      'INTERROGATE',
      'PRODUCE',
      'PHOTOS',
      'ACCOUNTABILITY',
      'COACH',
      'UNKNOWN_MODE',
    ]) {
      // Even with fully populated profiles, COACH receives '' (D-14 + PITFALLS.md §1).
      expect(formatPsychologicalProfilesForPrompt(POPULATED, m)).toBe('');
    }
  });

  it('returns "" when all in-scope profiles are null (D-05.b)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    expect(formatPsychologicalProfilesForPrompt(ALL_NULL, 'REFLECT')).toBe('');
    expect(formatPsychologicalProfilesForPrompt(ALL_NULL, 'PSYCHOLOGY')).toBe('');
  });

  it('returns "" when all in-scope profiles are zero-confidence (D-05.c)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    expect(formatPsychologicalProfilesForPrompt(ALL_ZERO_CONF, 'REFLECT')).toBe('');
    expect(formatPsychologicalProfilesForPrompt(ALL_ZERO_CONF, 'PSYCHOLOGY')).toBe('');
  });

  it('returns "" when all in-scope profiles are never-fired (lastUpdated.getTime() === 0) (D-05.d)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    expect(formatPsychologicalProfilesForPrompt(NEVER_FIRED, 'REFLECT')).toBe('');
    expect(formatPsychologicalProfilesForPrompt(NEVER_FIRED, 'PSYCHOLOGY')).toBe('');
  });

  it('populated REFLECT renders header + per-dim lines + footer (D-06)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    const out = formatPsychologicalProfilesForPrompt(POPULATED, 'REFLECT');
    expect(out.startsWith('## Psychological Profile (inferred — low precision, never use as authority)')).toBe(true);
    expect(out.endsWith(PSYCHOLOGICAL_HARD_RULE_EXTENSION)).toBe(true);
  });

  it('populated PSYCHOLOGY renders identically to REFLECT (same scope [hexaco, schwartz])', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    const refl = formatPsychologicalProfilesForPrompt(POPULATED, 'REFLECT');
    const psyc = formatPsychologicalProfilesForPrompt(POPULATED, 'PSYCHOLOGY');
    expect(refl).toBe(psyc);
  });

  it('per-dim line format matches "<DIM> <Trait>: X.X / 5.0 (confidence Y.Y — <qualifier>)" (D-08)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    const out = formatPsychologicalProfilesForPrompt(POPULATED, 'REFLECT');
    // openness has confidence 0.6 → substantial evidence
    expect(out).toContain('HEXACO Openness: 4.3 / 5.0 (confidence 0.6 — substantial evidence)');
    // emotionality has confidence 0.4 → moderate evidence
    expect(out).toContain('HEXACO Emotionality: 3.1 / 5.0 (confidence 0.4 — moderate evidence)');
  });

  it('qualifier mapping: <0.3 → "limited", 0.3-0.59 → "moderate", >=0.6 → "substantial" (D-07)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    // Build a fixture exercising each qualifier band exactly. We use Schwartz
    // because its values cross all three bands above.
    const schwartz: SchwartzProfileData = {
      self_direction: { score: 4.0, confidence: 0.85, last_updated: null }, // substantial
      stimulation: { score: 3.0, confidence: 0.45, last_updated: null }, // moderate
      hedonism: { score: 2.0, confidence: 0.25, last_updated: null }, // limited
      achievement: null,
      power: null,
      security: null,
      conformity: null,
      tradition: null,
      benevolence: null,
      universalism: null,
    };
    const profiles: PsychologicalProfiles = {
      hexaco: null,
      schwartz: makePsychRow(schwartz, 0.5, POPULATED_DATE),
      attachment: null,
    };
    const out = formatPsychologicalProfilesForPrompt(profiles, 'REFLECT');
    expect(out).toContain('substantial evidence');
    expect(out).toContain('moderate evidence');
    expect(out).toContain('limited evidence');
  });

  it('partial-population: skip dims with null score OR confidence === 0 (D-09)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    const hexaco: HexacoProfileData = {
      honesty_humility: null, // skipped — null dim
      emotionality: { score: 3.0, confidence: 0, last_updated: null }, // skipped — zero confidence
      extraversion: { score: 3.8, confidence: 0.5, last_updated: null },
      agreeableness: { score: 4.0, confidence: 0.5, last_updated: null },
      conscientiousness: { score: 4.5, confidence: 0.7, last_updated: null },
      openness: { score: 4.3, confidence: 0.6, last_updated: null },
    };
    const profiles: PsychologicalProfiles = {
      hexaco: makePsychRow(hexaco, 0.6, POPULATED_DATE),
      schwartz: null,
      attachment: null,
    };
    const out = formatPsychologicalProfilesForPrompt(profiles, 'REFLECT');
    expect(out).not.toContain('Honesty-Humility');
    expect(out).not.toContain('Emotionality');
    expect(out).toContain('Extraversion');
    expect(out).toContain('Agreeableness');
    expect(out).toContain('Conscientiousness');
    expect(out).toContain('Openness');
  });

  it('footer is appended at the BOTTOM of populated block (D-11 recency-bias)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    const out = formatPsychologicalProfilesForPrompt(POPULATED, 'REFLECT');
    const iFooter = out.lastIndexOf(PSYCHOLOGICAL_HARD_RULE_EXTENSION);
    expect(iFooter).toBeGreaterThan(out.lastIndexOf('HEXACO '));
    expect(iFooter).toBeGreaterThan(out.lastIndexOf('Schwartz '));
  });

  it('footer text equals imported PSYCHOLOGICAL_HARD_RULE_EXTENSION verbatim (single source of truth)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    const out = formatPsychologicalProfilesForPrompt(POPULATED, 'REFLECT');
    expect(out.includes(PSYCHOLOGICAL_HARD_RULE_EXTENSION)).toBe(true);
  });

  it('Schwartz dims use Title Case with hyphenation preserved (D-08)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    const out = formatPsychologicalProfilesForPrompt(POPULATED, 'REFLECT');
    expect(out).toContain('Schwartz Self-Direction:');
  });

  it('attachment is never rendered even when in profiles object (D-04 — not in any mode\'s array)', async () => {
    const { formatPsychologicalProfilesForPrompt } = await import('../profiles.js');
    const profiles: PsychologicalProfiles = {
      hexaco: makePsychRow(POPULATED_HEXACO_DATA, 0.6, POPULATED_DATE),
      schwartz: makePsychRow(POPULATED_SCHWARTZ_DATA, 0.55, POPULATED_DATE),
      attachment: makePsychRow(POPULATED_ATTACHMENT_DATA, 0.5, POPULATED_DATE),
    };
    const outReflect = formatPsychologicalProfilesForPrompt(profiles, 'REFLECT');
    const outPsych = formatPsychologicalProfilesForPrompt(profiles, 'PSYCHOLOGY');
    expect(outReflect).not.toContain('Attachment');
    expect(outPsych).not.toContain('Attachment');
  });
});

// CONTRACT-01 / D-09 regression — Phase 34 BL-02 closure
//
// stripMetadataColumns in src/memory/profiles/shared.ts MUST discard both
// `confidence` AND `dataConsistency` from the snake-cased prevState object
// handed to the prompt builder so neither host-computed field leaks back to
// Sonnet via the rendered '## CURRENT PROFILE STATE' block.
//
// Plan-deviation note (Rule 1 fix): The plan asked to apply the same edit to
// the symmetry copy in src/memory/profiles.ts. That edit was reverted because
// the reader-side helper feeds the v3 Zod parse, and JurisdictionalProfileSchemaV3
// (+ Capital/Health/Family v3) all declare `data_consistency` as a required
// top-level field under `.strict()` — stripping it null-routes every read.
// The CONTRACT-01 *semantic* (no prevState leak to Sonnet) only applies to
// the prompt-builder path, which routes through shared.ts. The reader-side
// strip is retained as-is; `confidence` is still discarded there because it
// is exposed as ProfileRow.confidence at the row level (not in .data).
describe('CONTRACT-01: shared.ts stripMetadataColumns discards dataConsistency (D-09)', () => {
  // NOTE: substrateHash must be a real SHA-256 hex (not '') because the
  // Phase 43 CONTRACT-02 change makes extract<X>PrevState return null for
  // substrateHash === '' (Phase 33 D-11 seed sentinel). The CONTRACT-01
  // strip assertion only meaningfully applies on post-first-fire rows.
  const POPULATED_HASH = 'a'.repeat(64);

  it('shared.ts strip via JURISDICTIONAL_PROFILE_CONFIG.extractPrevState: snake-cased output omits data_consistency + confidence', async () => {
    const { JURISDICTIONAL_PROFILE_CONFIG } = await import('../profiles/jurisdictional.js');
    const rowWithBothMeta = {
      ...jurisdictionalRow,
      substrateHash: POPULATED_HASH,
      confidence: 0.42,
      dataConsistency: 0.55,
    };
    const stripped = JURISDICTIONAL_PROFILE_CONFIG.extractPrevState(rowWithBothMeta);
    expect(stripped).not.toBeNull();
    const obj = stripped as Record<string, unknown>;
    expect('confidence' in obj).toBe(false);
    expect('data_consistency' in obj).toBe(false);
    // Sanity — the actual jsonb fields ARE present in snake_case
    expect('current_country' in obj).toBe(true);
  });

  it('shared.ts strip via CAPITAL_PROFILE_CONFIG.extractPrevState: omits data_consistency + confidence', async () => {
    const { CAPITAL_PROFILE_CONFIG } = await import('../profiles/capital.js');
    const rowWithBothMeta = {
      ...capitalRow,
      substrateHash: POPULATED_HASH,
      confidence: 0.42,
      dataConsistency: 0.65,
    };
    const stripped = CAPITAL_PROFILE_CONFIG.extractPrevState(rowWithBothMeta);
    expect(stripped).not.toBeNull();
    const obj = stripped as Record<string, unknown>;
    expect('confidence' in obj).toBe(false);
    expect('data_consistency' in obj).toBe(false);
    expect('fi_phase' in obj).toBe(true);
  });

  it('shared.ts strip applied to health + family per-dimension configs', async () => {
    const { HEALTH_PROFILE_CONFIG } = await import('../profiles/health.js');
    const { FAMILY_PROFILE_CONFIG } = await import('../profiles/family.js');

    for (const [config, row] of [
      [HEALTH_PROFILE_CONFIG, { ...healthRow, substrateHash: POPULATED_HASH, confidence: 0.5, dataConsistency: 0.7 }],
      [FAMILY_PROFILE_CONFIG, { ...familyRow, substrateHash: POPULATED_HASH, confidence: 0.4, dataConsistency: 0.6 }],
    ] as const) {
      const stripped = config.extractPrevState(row);
      expect(stripped).not.toBeNull();
      const obj = stripped as Record<string, unknown>;
      expect('confidence' in obj).toBe(false);
      expect('data_consistency' in obj).toBe(false);
    }
  });

  it('profiles.ts reader strip (UNCHANGED for v3 Zod parse compatibility): data_consistency retained at parse-time, then stripped by ProfileRow.data shape', async () => {
    // Documentation regression: assert that the reader CAN parse a row with
    // both confidence and dataConsistency set (proving the v3 schema is
    // honored). The .data field's exposed shape is governed by the v3 schema
    // which still includes data_consistency (Plan 43-02 deliberately does
    // NOT change the reader contract).
    const rowWithMeta = {
      ...jurisdictionalRow,
      confidence: 0.42,
      dataConsistency: 0.55,
    };
    mockLimit
      .mockResolvedValueOnce([rowWithMeta])
      .mockResolvedValueOnce([capitalRow])
      .mockResolvedValueOnce([healthRow])
      .mockResolvedValueOnce([familyRow]);

    const result = await getOperationalProfiles();
    expect(result.jurisdictional).not.toBeNull();
    // confidence is exposed at the ProfileRow level (not in .data)
    expect(result.jurisdictional!.confidence).toBe(0.42);
  });
});
