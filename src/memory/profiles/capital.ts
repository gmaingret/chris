/**
 * src/memory/profiles/capital.ts — Phase 34 Plan 02
 *
 * Per-dimension generator for the capital operational profile. Structurally
 * identical to jurisdictional.ts; only the schema imports, table, dimension
 * literal, profileTableName, flattenSonnetOutput, and extractPrevState differ.
 *
 * See src/memory/profiles/shared.ts for the full runProfileGenerator flow.
 */
import {
  CapitalProfileSchemaV3,
  CapitalProfileSchemaV4,
  type CapitalProfileData,
} from './schemas.js';
import { profileCapital } from '../../db/schema.js';
import {
  runProfileGenerator,
  stripMetadataColumns,
  type ProfileGeneratorConfig,
  type ProfileGenerationOutcome,
  type ProfileSubstrate,
} from './shared.js';

function flattenCapitalOutput(
  parsed: CapitalProfileData,
): Record<string, unknown> {
  return {
    fiPhase: parsed.fi_phase,
    fiTargetAmount: parsed.fi_target_amount,
    estimatedNetWorth: parsed.estimated_net_worth,
    runwayMonths: parsed.runway_months,
    nextSequencingDecision: parsed.next_sequencing_decision,
    incomeSources: parsed.income_sources,
    majorAllocationDecisions: parsed.major_allocation_decisions,
    taxOptimizationStatus: parsed.tax_optimization_status,
    activeLegalEntities: parsed.active_legal_entities,
  };
}

function extractCapitalPrevState(
  row: Record<string, unknown> | null,
): unknown | null {
  if (!row) return null;
  return stripMetadataColumns(row);
}

const CAPITAL_PROFILE_CONFIG: ProfileGeneratorConfig<CapitalProfileData> = {
  dimension: 'capital',
  v3Schema: CapitalProfileSchemaV3,
  v4Schema: CapitalProfileSchemaV4,
  table: profileCapital,
  profileTableName: 'profile_capital',
  flattenSonnetOutput: flattenCapitalOutput,
  extractPrevState: extractCapitalPrevState,
};

export async function generateCapitalProfile(
  deps: { substrate: ProfileSubstrate },
): Promise<ProfileGenerationOutcome> {
  return runProfileGenerator(CAPITAL_PROFILE_CONFIG, deps.substrate);
}

export { CAPITAL_PROFILE_CONFIG };
