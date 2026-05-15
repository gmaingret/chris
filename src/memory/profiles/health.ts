/**
 * src/memory/profiles/health.ts — Phase 34 Plan 02
 *
 * Per-dimension generator for the health operational profile. Structurally
 * identical to jurisdictional.ts; only the schema imports, table, dimension
 * literal, profileTableName, flattenSonnetOutput, and extractPrevState differ.
 *
 * See src/memory/profiles/shared.ts for the full runProfileGenerator flow.
 */
import {
  HealthProfileSchemaV3,
  HealthProfileSchemaV4,
  type HealthProfileData,
} from './schemas.js';
import { profileHealth } from '../../db/schema.js';
import {
  runProfileGenerator,
  stripMetadataColumns,
  type ProfileGeneratorConfig,
  type ProfileGenerationOutcome,
  type ProfileSubstrate,
} from './shared.js';

function flattenHealthOutput(
  parsed: HealthProfileData,
): Record<string, unknown> {
  return {
    openHypotheses: parsed.open_hypotheses,
    pendingTests: parsed.pending_tests,
    activeTreatments: parsed.active_treatments,
    recentResolved: parsed.recent_resolved,
    caseFileNarrative: parsed.case_file_narrative,
    wellbeingTrend: parsed.wellbeing_trend,
  };
}

/**
 * Map the camelCase DB row → snake_case jsonb subset for the prompt's
 * previous-state block. Returns null when the row is missing or carries the
 * Phase 33 D-11 seed-row sentinel (substrateHash === ''). Phase 43
 * CONTRACT-02 / D-10 — M010-03 anti-drift defense.
 */
function extractHealthPrevState(
  row: Record<string, unknown> | null,
): unknown | null {
  if (!row) return null;
  if (row.substrateHash === '') return null;
  return stripMetadataColumns(row);
}

const HEALTH_PROFILE_CONFIG: ProfileGeneratorConfig<HealthProfileData> = {
  dimension: 'health',
  v3Schema: HealthProfileSchemaV3,
  v4Schema: HealthProfileSchemaV4,
  table: profileHealth,
  profileTableName: 'profile_health',
  flattenSonnetOutput: flattenHealthOutput,
  extractPrevState: extractHealthPrevState,
};

export async function generateHealthProfile(
  deps: { substrate: ProfileSubstrate },
): Promise<ProfileGenerationOutcome> {
  return runProfileGenerator(HEALTH_PROFILE_CONFIG, deps.substrate);
}

export { HEALTH_PROFILE_CONFIG };
