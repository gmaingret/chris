/**
 * src/memory/profiles/jurisdictional.ts — Phase 34 Plan 02
 *
 * Per-dimension generator for the jurisdictional operational profile.
 * Delegates to `runProfileGenerator` (the extracted shared helper in
 * src/memory/profiles/shared.ts) per Claude's Discretion default in
 * 34-CONTEXT.md (the 4 dimension functions are >80% mechanically identical,
 * so a single helper avoids per-dimension drift).
 *
 * Per-dimension variance captured in JURISDICTIONAL_PROFILE_CONFIG (D-09):
 *   - dimension: 'jurisdictional'
 *   - v3Schema / v4Schema: from src/memory/profiles/schemas.ts (Phase 33)
 *   - table: profileJurisdictional (src/db/schema.ts:536)
 *   - profileTableName: 'profile_jurisdictional' (for profile_history INSERT)
 *   - flattenSonnetOutput: maps snake_case v3 fields → camelCase DB columns
 *   - extractPrevState: maps DB row → prevState for the prompt builder
 *
 * NO retry loop (D-22). NO Stage-2 Haiku judge (CONTEXT.md deferred —
 * weekly-review's Stage-2 is NOT replicated). NO templated fallback.
 * Single Sonnet attempt; failure → 'profile_generation_failed' outcome.
 * Next Sunday's cron is the retry mechanism (D-22).
 */
import {
  JurisdictionalProfileSchemaV3,
  JurisdictionalProfileSchemaV4,
  type JurisdictionalProfileData,
} from './schemas.js';
import { profileJurisdictional } from '../../db/schema.js';
import {
  runProfileGenerator,
  stripMetadataColumns,
  type ProfileGeneratorConfig,
  type ProfileGenerationOutcome,
  type ProfileSubstrate,
} from './shared.js';

/**
 * Map the snake_case v3-parsed Sonnet output to the camelCase Drizzle column
 * names for the profile_jurisdictional table.
 */
function flattenJurisdictionalOutput(
  parsed: JurisdictionalProfileData,
): Record<string, unknown> {
  return {
    currentCountry: parsed.current_country,
    physicalLocation: parsed.physical_location,
    residencyStatus: parsed.residency_status,
    taxResidency: parsed.tax_residency,
    activeLegalEntities: parsed.active_legal_entities,
    nextPlannedMove: parsed.next_planned_move,
    plannedMoveDate: parsed.planned_move_date,
    passportCitizenships: parsed.passport_citizenships,
  };
}

/**
 * Map the camelCase DB row → snake_case jsonb subset for the prompt's
 * previous-state block. Returns null when:
 *   - the row is missing entirely (table never seeded), OR
 *   - row.substrateHash === '' (Phase 33 D-11 seed-row sentinel — first
 *     fire ever; Phase 43 CONTRACT-02 / D-10 M010-03 anti-drift defense).
 *
 * When null is returned, assembleProfilePrompt omits the
 * ## CURRENT PROFILE STATE block entirely (Phase 34 D-07 structural
 * invariant), avoiding the empty-fields + anti-drift directive collision
 * that anchors Sonnet's first-fire output toward the empty seed.
 */
function extractJurisdictionalPrevState(
  row: Record<string, unknown> | null,
): unknown | null {
  if (!row) return null;
  if (row.substrateHash === '') return null;
  return stripMetadataColumns(row);
}

const JURISDICTIONAL_PROFILE_CONFIG: ProfileGeneratorConfig<JurisdictionalProfileData> = {
  dimension: 'jurisdictional',
  v3Schema: JurisdictionalProfileSchemaV3,
  v4Schema: JurisdictionalProfileSchemaV4,
  table: profileJurisdictional,
  profileTableName: 'profile_jurisdictional',
  flattenSonnetOutput: flattenJurisdictionalOutput,
  extractPrevState: extractJurisdictionalPrevState,
};

/**
 * Generate the jurisdictional profile from substrate. Returns a discriminated
 * outcome (D-11) — never throws. The orchestrator (Plan 34-03) calls all 4
 * dimension generators concurrently via Promise.allSettled (D-21).
 */
export async function generateJurisdictionalProfile(
  deps: { substrate: ProfileSubstrate },
): Promise<ProfileGenerationOutcome> {
  return runProfileGenerator(JURISDICTIONAL_PROFILE_CONFIG, deps.substrate);
}

export { JURISDICTIONAL_PROFILE_CONFIG };
