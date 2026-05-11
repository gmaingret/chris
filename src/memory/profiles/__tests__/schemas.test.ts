/**
 * src/memory/profiles/__tests__/schemas.test.ts — Phase 33 Plan 33-02 Task 3
 *                                                  (PROF-05)
 *
 * v3 schema parse/reject boundary tests. v4 mirror sanity tests prove the
 * v3/v4 dual schemas stay in lock-step (M009 D-29-02 discipline).
 *
 * No DB. Runs in microseconds.
 */
import { describe, it, expect } from 'vitest';
import {
  JurisdictionalProfileSchemaV3,
  CapitalProfileSchemaV3,
  HealthProfileSchemaV3,
  FamilyProfileSchemaV3,
  JurisdictionalProfileSchemaV4,
  CapitalProfileSchemaV4,
  HealthProfileSchemaV4,
  FamilyProfileSchemaV4,
} from '../schemas.js';

// ── Valid fixtures matching the migration 0012 seed-row jsonb shapes ────

const validJurisdictional = {
  current_country: 'Russia',
  physical_location: 'Saint Petersburg',
  residency_status: [
    { type: 'permanent_residency', value: 'Panama' },
    { type: 'business_residency', value: 'Georgian Individual Entrepreneur' },
  ],
  tax_residency: null,
  active_legal_entities: [
    { name: 'MAINGRET LLC', jurisdiction: 'New Mexico, USA' },
    { name: 'Georgian Individual Entrepreneur', jurisdiction: 'Georgia' },
  ],
  next_planned_move: { destination: 'Batumi, Georgia', from_date: '2026-04-28' },
  planned_move_date: '2026-04-28',
  passport_citizenships: ['French'],
  data_consistency: 0,
};

const validCapital = {
  fi_phase: null,
  fi_target_amount: '$1,500,000',
  estimated_net_worth: null,
  runway_months: null,
  next_sequencing_decision: null,
  income_sources: [
    { source: 'Golfe-Juan rental property (Citya)', kind: 'rental_income' },
  ],
  major_allocation_decisions: [],
  tax_optimization_status: null,
  active_legal_entities: [
    { name: 'MAINGRET LLC', jurisdiction: 'New Mexico, USA' },
  ],
  data_consistency: 0,
};

const validHealth = {
  open_hypotheses: [],
  pending_tests: [],
  active_treatments: [],
  recent_resolved: [],
  case_file_narrative: 'insufficient data',
  wellbeing_trend: {
    energy_30d_mean: null,
    mood_30d_mean: null,
    anxiety_30d_mean: null,
  },
  data_consistency: 0,
};

const validFamily = {
  relationship_status: 'insufficient data',
  partnership_criteria_evolution: [],
  children_plans: 'insufficient data',
  parent_care_responsibilities: { notes: null, dependents: [] },
  active_dating_context: 'insufficient data',
  milestones: [],
  constraints: [],
  data_consistency: 0,
};

// ── v3 happy-path tests ─────────────────────────────────────────────────

describe('v3 schemas — happy path (matches migration 0012 seed shapes)', () => {
  it('JurisdictionalProfileSchemaV3 accepts the seed shape', () => {
    const parsed = JurisdictionalProfileSchemaV3.parse(validJurisdictional);
    expect(parsed.current_country).toBe('Russia');
    expect(parsed.residency_status).toHaveLength(2);
    expect(parsed.data_consistency).toBe(0);
  });

  it('CapitalProfileSchemaV3 accepts the seed shape', () => {
    const parsed = CapitalProfileSchemaV3.parse(validCapital);
    expect(parsed.fi_target_amount).toBe('$1,500,000');
    expect(parsed.income_sources).toHaveLength(1);
  });

  it('HealthProfileSchemaV3 accepts the seed shape', () => {
    const parsed = HealthProfileSchemaV3.parse(validHealth);
    expect(parsed.case_file_narrative).toBe('insufficient data');
    expect(parsed.open_hypotheses).toHaveLength(0);
  });

  it('FamilyProfileSchemaV3 accepts the seed shape', () => {
    const parsed = FamilyProfileSchemaV3.parse(validFamily);
    expect(parsed.relationship_status).toBe('insufficient data');
    expect(parsed.milestones).toHaveLength(0);
  });
});

// ── v3 reject tests ─────────────────────────────────────────────────────

describe('v3 schemas — reject invalid shapes', () => {
  it('rejects out-of-bounds data_consistency (1.5)', () => {
    const result = JurisdictionalProfileSchemaV3.safeParse({
      ...validJurisdictional,
      data_consistency: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative data_consistency (-0.1)', () => {
    const result = JurisdictionalProfileSchemaV3.safeParse({
      ...validJurisdictional,
      data_consistency: -0.1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects wrong type — current_country as number', () => {
    const result = JurisdictionalProfileSchemaV3.safeParse({
      ...validJurisdictional,
      current_country: 123,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown top-level key (.strict() invariant)', () => {
    const result = JurisdictionalProfileSchemaV3.safeParse({
      ...validJurisdictional,
      unexpected_field: 'should be rejected',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required field (capital.income_sources)', () => {
    const { income_sources, ...withoutIncomeSources } = validCapital;
    void income_sources;
    const result = CapitalProfileSchemaV3.safeParse(withoutIncomeSources);
    expect(result.success).toBe(false);
  });

  it('rejects invalid enum in health.open_hypotheses[].status', () => {
    const result = HealthProfileSchemaV3.safeParse({
      ...validHealth,
      open_hypotheses: [
        { name: 'sleep apnea', status: 'maybe', date_opened: '2026-05-01' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

// ── v4 mirror sanity (lock-step with v3) ────────────────────────────────

describe('v4 mirror schemas — accept same valid shapes (lock-step with v3)', () => {
  it('JurisdictionalProfileSchemaV4 accepts the seed shape', () => {
    expect(() => JurisdictionalProfileSchemaV4.parse(validJurisdictional)).not.toThrow();
  });

  it('CapitalProfileSchemaV4 accepts the seed shape', () => {
    expect(() => CapitalProfileSchemaV4.parse(validCapital)).not.toThrow();
  });

  it('HealthProfileSchemaV4 accepts the seed shape', () => {
    expect(() => HealthProfileSchemaV4.parse(validHealth)).not.toThrow();
  });

  it('FamilyProfileSchemaV4 accepts the seed shape', () => {
    expect(() => FamilyProfileSchemaV4.parse(validFamily)).not.toThrow();
  });
});
