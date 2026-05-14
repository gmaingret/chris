/**
 * src/memory/profiles/hexaco.ts — Phase 38 Plan 38-02 (M011 / PGEN-02)
 *
 * Per-profile generator for the HEXACO Big-Six personality profile.
 * Delegates the 11-step mechanical body to `runPsychologicalProfileGenerator`
 * in `./psychological-shared.js` per D-11/D-12 (Claude's Discretion):
 * extracting the helper avoids per-profileType drift between this file and
 * `./schwartz.js` (HARD CO-LOC #M11-2 — both generators ship in Plan 38-02
 * to prevent the same drift class M010-06 exhibited).
 *
 * Per-profileType variance is captured in HEXACO_PROFILE_CONFIG (D-11):
 *   - profileType: 'hexaco'
 *   - v3SchemaBoundary / v4SchemaBoundary: SDK-boundary schemas from
 *     `./psychological-schemas.js` (Plan 38-02 Task 1 — extended with
 *     top-level `data_consistency` + `overall_confidence` per RESEARCH
 *     Finding 1).
 *   - table: profileHexaco (`src/db/schema.ts`, Phase 37 migration 0013)
 *   - profileTableName: 'profile_hexaco' (for profile_history INSERT)
 *   - flattenSonnetOutput: maps snake_case Sonnet output → camelCase
 *     Drizzle column names for the 6 HEXACO dimensions.
 *
 * Locked decisions honored (38-CONTEXT.md):
 *   - D-11..D-17 — generator-level implementation:
 *     * D-14: 3-outcome discriminated union ('updated' |
 *             'skipped_below_threshold' | 'error') — NO
 *             'skipped_no_change' (PGEN-06 UNCONDITIONAL FIRE).
 *     * D-15: ONE Sonnet call per fire, structured-output for all 6
 *             dimensions in a single response (cross-dimension coherence
 *             preserved by single-call structure).
 *     * D-17: PGEN-06 UNCONDITIONAL FIRE — substrate_hash recorded but
 *             does NOT short-circuit. The runner explicitly DELETES M010's
 *             hash-skip branch.
 *
 *   - D-32, D-33 — schema discipline:
 *     * v4 emits + v3 re-validates at the SDK boundary (Phase 37 v3 base
 *       schemas remain UNCHANGED; Plan 38-02 adds V3Boundary +
 *       V4Boundary as extensions).
 *     * D-33: NO `.refine()` ceiling at the boundary — word-count gating
 *       fires upstream at substrate load (PSCH-08).
 *
 * Critical RESEARCH findings honored (38-RESEARCH.md):
 *   - Finding 1: imports the V4Boundary schema for `zodOutputFormat` and
 *     V3Boundary for the re-validate step.
 *   - Finding 3: substrate.prevHistorySnapshot is threaded directly into
 *     the prompt assembler — NO extractPrevState helper (M010-specific).
 *   - Finding 4: the runner uses discriminated-union narrowing
 *     `if (substrate.belowThreshold)` (Step 1 of the 11-step body) — does
 *     NOT import the M010 entry-count gate from operational confidence.ts.
 *
 * Cross-references:
 *   - Plan 38-01: `assemblePsychologicalProfilePrompt` (built into the
 *     runner's Step 6, not this file).
 *   - Plan 38-03 (next): `psychological-profile-updater.ts` orchestrator
 *     will import `generateHexacoProfile` and call it alongside
 *     `generateSchwartzProfile` via `Promise.allSettled`.
 *
 * NOT in scope here:
 *   - Substrate loading (delegated to `loadPsychologicalSubstrate` —
 *     caller's responsibility; usually invoked by the orchestrator).
 *   - Hash computation (delegated to `computePsychologicalSubstrateHash`
 *     inside the runner).
 *   - Cron registration (Plan 38-03).
 */
import {
  HexacoProfileSchemaV3Boundary,
  HexacoProfileSchemaV4Boundary,
  type HexacoProfileBoundaryData,
  type HexacoProfileData,
} from './psychological-schemas.js';
import { profileHexaco } from '../../db/schema.js';
import {
  runPsychologicalProfileGenerator,
  type PsychologicalProfileGeneratorConfig,
  type PsychologicalProfileGenerationOutcome,
  type PsychologicalSubstrate,
} from './psychological-shared.js';

/**
 * Map the snake_case v3-parsed Sonnet output to the camelCase Drizzle column
 * names for the 6 HEXACO dimensions. The top-level boundary fields
 * (`data_consistency`, `overall_confidence`) are NOT returned — the runner
 * writes them to dedicated row columns (`overallConfidence`) separately.
 */
function flattenHexacoOutput(
  parsed: HexacoProfileBoundaryData,
): Record<string, unknown> {
  return {
    honestyHumility: parsed.honesty_humility,
    emotionality: parsed.emotionality,
    extraversion: parsed.extraversion,
    agreeableness: parsed.agreeableness,
    conscientiousness: parsed.conscientiousness,
    openness: parsed.openness,
  };
}

/**
 * HEXACO generator config (D-11). Consumed by
 * `runPsychologicalProfileGenerator` in `./psychological-shared.js`.
 *
 * Exported so the orchestrator (Plan 38-03) can introspect the config
 * shape for log-payload assembly (`profileTableName`, `profileType`) and
 * for future tests that need to construct ad-hoc test runs without
 * duplicating the field map.
 */
export const HEXACO_PROFILE_CONFIG: PsychologicalProfileGeneratorConfig<HexacoProfileBoundaryData> = {
  profileType: 'hexaco',
  v3SchemaBoundary: HexacoProfileSchemaV3Boundary,
  v4SchemaBoundary: HexacoProfileSchemaV4Boundary,
  table: profileHexaco,
  profileTableName: 'profile_hexaco',
  flattenSonnetOutput: flattenHexacoOutput,
};

/**
 * Generate the HEXACO Big-Six personality profile from the loaded
 * substrate. Returns a discriminated outcome (D-14) — never throws. The
 * orchestrator (Plan 38-03) calls this in parallel with
 * `generateSchwartzProfile` via `Promise.allSettled` for cross-profile
 * isolation (D-21).
 */
export async function generateHexacoProfile(
  deps: { substrate: PsychologicalSubstrate<HexacoProfileData> },
): Promise<PsychologicalProfileGenerationOutcome> {
  return runPsychologicalProfileGenerator(HEXACO_PROFILE_CONFIG, deps.substrate);
}
