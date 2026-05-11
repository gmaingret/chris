/**
 * src/memory/profiles/schemas.ts — Phase 33 Plan 33-01 Task 1 + Plan 33-02 Task 1
 *                                  (PROF-05 substrate)
 *
 * Zod v3 + v4 dual schemas for the 4 M010 operational profile dimensions.
 * Field names locked against FEATURES.md §2.1-2.4 per Open Question 1 in
 * 33-RESEARCH.md.
 *
 * Schema discipline:
 *   - v3 schemas use .strict() — rejects unknown jsonb keys at read boundary
 *     (defends against future profile-shape drift in stored rows)
 *   - v4 mirrors OMIT .strict() per M009 D-29-02 (SDK doesn't parse
 *     strict-mode JSON Schema; v3 re-validates in the retry loop)
 *   - Both schemas MUST stay in lock-step (M009 D-29-02 discipline)
 *   - data_consistency lives at the top level (matches the SQL column;
 *     simpler for Phase 34 substrate-hash computation)
 */
import { z } from 'zod';
import * as zV4 from 'zod/v4';

// ── 2.1 Jurisdictional ──────────────────────────────────────────────────

export const JurisdictionalProfileSchemaV3 = z
  .object({
    current_country: z.string().nullable(),
    physical_location: z.string().nullable(),
    residency_status: z.array(z.object({
      type: z.string(),
      value: z.string(),
      since: z.string().optional(),
    }).strict()).max(20),
    tax_residency: z.string().nullable(),
    active_legal_entities: z.array(z.object({
      name: z.string(),
      jurisdiction: z.string(),
    }).strict()).max(20),
    next_planned_move: z.object({
      destination: z.string().nullable(),
      from_date: z.string().nullable(),
    }).strict(),
    planned_move_date: z.string().nullable(),
    passport_citizenships: z.array(z.string()).max(10),
    data_consistency: z.number().min(0).max(1),
  })
  .strict();
export type JurisdictionalProfileData = z.infer<typeof JurisdictionalProfileSchemaV3>;

export const JurisdictionalProfileSchemaV4 = zV4.object({
  current_country: zV4.string().nullable(),
  physical_location: zV4.string().nullable(),
  residency_status: zV4.array(zV4.object({
    type: zV4.string(),
    value: zV4.string(),
    since: zV4.string().optional(),
  })).max(20),
  tax_residency: zV4.string().nullable(),
  active_legal_entities: zV4.array(zV4.object({
    name: zV4.string(),
    jurisdiction: zV4.string(),
  })).max(20),
  next_planned_move: zV4.object({
    destination: zV4.string().nullable(),
    from_date: zV4.string().nullable(),
  }),
  planned_move_date: zV4.string().nullable(),
  passport_citizenships: zV4.array(zV4.string()).max(10),
  data_consistency: zV4.number().min(0).max(1),
});

// ── 2.2 Capital ─────────────────────────────────────────────────────────

export const CapitalProfileSchemaV3 = z
  .object({
    fi_phase: z.string().nullable(),
    fi_target_amount: z.string().nullable(),
    estimated_net_worth: z.string().nullable(),
    runway_months: z.number().nullable(),
    next_sequencing_decision: z.string().nullable(),
    income_sources: z.array(z.object({
      source: z.string(),
      kind: z.string(),
    }).strict()).max(20),
    major_allocation_decisions: z.array(z.object({
      description: z.string(),
      date: z.string(),
    }).strict()).max(20),
    tax_optimization_status: z.string().nullable(),
    active_legal_entities: z.array(z.object({
      name: z.string(),
      jurisdiction: z.string(),
    }).strict()).max(20),
    data_consistency: z.number().min(0).max(1),
  })
  .strict();
export type CapitalProfileData = z.infer<typeof CapitalProfileSchemaV3>;

export const CapitalProfileSchemaV4 = zV4.object({
  fi_phase: zV4.string().nullable(),
  fi_target_amount: zV4.string().nullable(),
  estimated_net_worth: zV4.string().nullable(),
  runway_months: zV4.number().nullable(),
  next_sequencing_decision: zV4.string().nullable(),
  income_sources: zV4.array(zV4.object({
    source: zV4.string(),
    kind: zV4.string(),
  })).max(20),
  major_allocation_decisions: zV4.array(zV4.object({
    description: zV4.string(),
    date: zV4.string(),
  })).max(20),
  tax_optimization_status: zV4.string().nullable(),
  active_legal_entities: zV4.array(zV4.object({
    name: zV4.string(),
    jurisdiction: zV4.string(),
  })).max(20),
  data_consistency: zV4.number().min(0).max(1),
});

// ── 2.3 Health (case-file model) ────────────────────────────────────────

export const HealthProfileSchemaV3 = z
  .object({
    open_hypotheses: z.array(z.object({
      name: z.string(),
      status: z.enum(['investigating', 'confirmed', 'ruled_out']),
      date_opened: z.string(),
    }).strict()).max(20),
    pending_tests: z.array(z.object({
      test_name: z.string(),
      scheduled_date: z.string().nullable(),
      status: z.string(),
    }).strict()).max(20),
    active_treatments: z.array(z.object({
      name: z.string(),
      started_date: z.string(),
      purpose: z.string().nullable(),
    }).strict()).max(20),
    recent_resolved: z.array(z.object({
      name: z.string(),
      resolved_date: z.string(),
      resolution: z.string(),
    }).strict()).max(20),
    case_file_narrative: z.string().nullable(),
    wellbeing_trend: z.object({
      energy_30d_mean: z.number().nullable(),
      mood_30d_mean: z.number().nullable(),
      anxiety_30d_mean: z.number().nullable(),
    }).strict(),
    data_consistency: z.number().min(0).max(1),
  })
  .strict();
export type HealthProfileData = z.infer<typeof HealthProfileSchemaV3>;

export const HealthProfileSchemaV4 = zV4.object({
  open_hypotheses: zV4.array(zV4.object({
    name: zV4.string(),
    status: zV4.enum(['investigating', 'confirmed', 'ruled_out']),
    date_opened: zV4.string(),
  })).max(20),
  pending_tests: zV4.array(zV4.object({
    test_name: zV4.string(),
    scheduled_date: zV4.string().nullable(),
    status: zV4.string(),
  })).max(20),
  active_treatments: zV4.array(zV4.object({
    name: zV4.string(),
    started_date: zV4.string(),
    purpose: zV4.string().nullable(),
  })).max(20),
  recent_resolved: zV4.array(zV4.object({
    name: zV4.string(),
    resolved_date: zV4.string(),
    resolution: zV4.string(),
  })).max(20),
  case_file_narrative: zV4.string().nullable(),
  wellbeing_trend: zV4.object({
    energy_30d_mean: zV4.number().nullable(),
    mood_30d_mean: zV4.number().nullable(),
    anxiety_30d_mean: zV4.number().nullable(),
  }),
  data_consistency: zV4.number().min(0).max(1),
});

// ── 2.4 Family ──────────────────────────────────────────────────────────

export const FamilyProfileSchemaV3 = z
  .object({
    relationship_status: z.string().nullable(),
    partnership_criteria_evolution: z.array(z.object({
      text: z.string(),
      date_noted: z.string(),
      still_active: z.boolean(),
    }).strict()).max(30),
    children_plans: z.string().nullable(),
    parent_care_responsibilities: z.object({
      notes: z.string().nullable(),
      dependents: z.array(z.string()).max(10),
    }).strict(),
    active_dating_context: z.string().nullable(),
    milestones: z.array(z.object({
      type: z.string(),
      date: z.string(),
      notes: z.string().nullable(),
    }).strict()).max(50),
    constraints: z.array(z.object({
      text: z.string(),
      date_noted: z.string(),
    }).strict()).max(20),
    data_consistency: z.number().min(0).max(1),
  })
  .strict();
export type FamilyProfileData = z.infer<typeof FamilyProfileSchemaV3>;

export const FamilyProfileSchemaV4 = zV4.object({
  relationship_status: zV4.string().nullable(),
  partnership_criteria_evolution: zV4.array(zV4.object({
    text: zV4.string(),
    date_noted: zV4.string(),
    still_active: zV4.boolean(),
  })).max(30),
  children_plans: zV4.string().nullable(),
  parent_care_responsibilities: zV4.object({
    notes: zV4.string().nullable(),
    dependents: zV4.array(zV4.string()).max(10),
  }),
  active_dating_context: zV4.string().nullable(),
  milestones: zV4.array(zV4.object({
    type: zV4.string(),
    date: zV4.string(),
    notes: zV4.string().nullable(),
  })).max(50),
  constraints: zV4.array(zV4.object({
    text: zV4.string(),
    date_noted: zV4.string(),
  })).max(20),
  data_consistency: zV4.number().min(0).max(1),
});

// ── profile_history snapshot type (full-row per CONTEXT.md discretion) ──

export type ProfileSnapshot = Record<string, unknown>;
