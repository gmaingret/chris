/**
 * src/memory/profiles/family.ts — Phase 34 Plan 02
 *
 * Per-dimension generator for the family operational profile. Structurally
 * identical to jurisdictional.ts; only the schema imports, table, dimension
 * literal, profileTableName, flattenSonnetOutput, and extractPrevState differ.
 *
 * See src/memory/profiles/shared.ts for the full runProfileGenerator flow.
 */
import {
  FamilyProfileSchemaV3,
  FamilyProfileSchemaV4,
  type FamilyProfileData,
} from './schemas.js';
import { profileFamily } from '../../db/schema.js';
import {
  runProfileGenerator,
  stripMetadataColumns,
  type ProfileGeneratorConfig,
  type ProfileGenerationOutcome,
  type ProfileSubstrate,
} from './shared.js';

function flattenFamilyOutput(
  parsed: FamilyProfileData,
): Record<string, unknown> {
  return {
    relationshipStatus: parsed.relationship_status,
    partnershipCriteriaEvolution: parsed.partnership_criteria_evolution,
    childrenPlans: parsed.children_plans,
    parentCareResponsibilities: parsed.parent_care_responsibilities,
    activeDatingContext: parsed.active_dating_context,
    milestones: parsed.milestones,
    constraints: parsed.constraints,
  };
}

function extractFamilyPrevState(
  row: Record<string, unknown> | null,
): unknown | null {
  if (!row) return null;
  return stripMetadataColumns(row);
}

const FAMILY_PROFILE_CONFIG: ProfileGeneratorConfig<FamilyProfileData> = {
  dimension: 'family',
  v3Schema: FamilyProfileSchemaV3,
  v4Schema: FamilyProfileSchemaV4,
  table: profileFamily,
  profileTableName: 'profile_family',
  flattenSonnetOutput: flattenFamilyOutput,
  extractPrevState: extractFamilyPrevState,
};

export async function generateFamilyProfile(
  deps: { substrate: ProfileSubstrate },
): Promise<ProfileGenerationOutcome> {
  return runProfileGenerator(FAMILY_PROFILE_CONFIG, deps.substrate);
}

export { FAMILY_PROFILE_CONFIG };
