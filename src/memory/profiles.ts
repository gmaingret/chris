/**
 * src/memory/profiles.ts — Phase 33 Plan 33-02 Task 5 (PROF-04)
 *
 * Never-throw reader for M010 operational profiles. Returns 4 typed
 * profile rows (jurisdictional + capital + health + family) parsed
 * through Zod v3 at the read boundary; per-profile null on schema
 * mismatch (D-13); never throws on DB-level failure (D-12).
 *
 * Mirrors src/pensieve/retrieve.ts:50-114 (searchPensieve never-throw
 * pattern). 4× parallel SELECTs via Promise.all; each readOneProfile()
 * has its own try/catch so a per-table failure does not abort the
 * other three (Pitfall 5 in 33-RESEARCH.md).
 *
 * Phase 35 mode handlers (REFLECT/COACH/PSYCHOLOGY) will consume this
 * reader to inject the operational profile block above {pensieveContext}
 * — they expect per-profile null on absence, not a thrown exception.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  profileJurisdictional,
  profileCapital,
  profileHealth,
  profileFamily,
} from '../db/schema.js';
import { logger } from '../utils/logger.js';
import {
  JurisdictionalProfileSchemaV3,
  CapitalProfileSchemaV3,
  HealthProfileSchemaV3,
  FamilyProfileSchemaV3,
  type JurisdictionalProfileData,
  type CapitalProfileData,
  type HealthProfileData,
  type FamilyProfileData,
} from './profiles/schemas.js';
import type { z } from 'zod';

// ── Public types ────────────────────────────────────────────────────────

export interface ProfileRow<T> {
  data: T;
  confidence: number;
  lastUpdated: Date;
  schemaVersion: number;
}

export interface OperationalProfiles {
  jurisdictional: ProfileRow<JurisdictionalProfileData> | null;
  capital: ProfileRow<CapitalProfileData> | null;
  health: ProfileRow<HealthProfileData> | null;
  family: ProfileRow<FamilyProfileData> | null;
}

// ── Dispatcher: schema_version → Zod schema, per dimension ──────────────
//
// Schema-version dispatcher pattern per PITFALLS.md M010-11. Explicit
// `if (!parser)` check below before `.safeParse` (Pitfall 6) so a future
// row with schema_version=999 returns null, never crashes.

type Dimension = 'jurisdictional' | 'capital' | 'health' | 'family';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const PROFILE_SCHEMAS: Record<Dimension, Record<number, z.ZodTypeAny>> = {
  jurisdictional: { 1: JurisdictionalProfileSchemaV3 },
  capital: { 1: CapitalProfileSchemaV3 },
  health: { 1: HealthProfileSchemaV3 },
  family: { 1: FamilyProfileSchemaV3 },
};

// ── Per-profile reader (Pitfall 5: per-helper try/catch) ────────────────

/**
 * Read one profile dimension. Encapsulates the DB SELECT + schema_version
 * dispatch + Zod safeParse + per-profile null-on-failure contract.
 *
 * Per Pitfall 5 in 33-RESEARCH.md: this function MUST wrap the entire
 * body in try/catch — DB-level failures (connection drop, query timeout)
 * AND Zod-level failures both produce null without throwing.
 */
async function readOneProfile<T>(
  dimension: Dimension,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
): Promise<ProfileRow<T> | null> {
  try {
    const rows = await db.select().from(table).where(eq(table.name, 'primary')).limit(1);
    if (rows.length === 0) return null;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = rows[0]!;

    // Pitfall 6: explicit undefined check before `.safeParse` access.
    const parser = PROFILE_SCHEMAS[dimension][row.schemaVersion as number];
    if (!parser) {
      logger.warn(
        { dimension, schemaVersion: row.schemaVersion },
        'chris.profile.read.schema_mismatch',
      );
      return null;
    }

    // Pitfall 4: `.safeParse`, never `.parse` — never-throw absolute.
    // Pass the jsonb fields as the value to parse (not the entire row).
    // The reader's Zod schema validates the user-facing jsonb shape only;
    // metadata columns (id, name, schemaVersion, substrateHash, etc.) are
    // outside the schema's scope.
    const dataToValidate = stripMetadataColumns(row);
    const parsed = parser.safeParse(dataToValidate);
    if (!parsed.success) {
      logger.warn(
        { dimension, error: parsed.error.message },
        'chris.profile.read.schema_mismatch',
      );
      return null;
    }

    return {
      data: parsed.data as T,
      confidence: row.confidence,
      lastUpdated: row.lastUpdated,
      schemaVersion: row.schemaVersion,
    };
  } catch (error) {
    logger.warn(
      {
        dimension,
        error: error instanceof Error ? error.message : String(error),
      },
      'chris.profile.read.error',
    );
    return null;
  }
}

/**
 * Strip the table-metadata columns from a SELECT row so what remains is
 * the validatable jsonb-field set (matches the Zod v3 schema shape with
 * `data_consistency` as top-level). Returns an object with snake_case
 * keys to match the Zod schema definitions (FEATURES.md §2.1-2.4).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripMetadataColumns(row: Record<string, any>): Record<string, unknown> {
  const {
    id, name, schemaVersion, substrateHash, confidence,
    lastUpdated, createdAt,
    ...rest
  } = row;
  void id; void name; void schemaVersion; void substrateHash;
  void confidence; void lastUpdated; void createdAt;

  // Drizzle returns camelCase keys; Zod schemas expect snake_case. Convert.
  const snakeRest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    const snake = k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    snakeRest[snake] = v;
  }
  return snakeRest;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Read all 4 operational profiles in parallel. Never throws.
 *
 * Return contract (D-12):
 *   - Always returns `OperationalProfiles` shape
 *   - Each field is `ProfileRow<T>` (parsed seed) OR `null` (DB error,
 *     missing row, schema mismatch)
 *   - On total DB failure: { jurisdictional: null, capital: null,
 *     health: null, family: null } — NEVER a single null
 */
export async function getOperationalProfiles(): Promise<OperationalProfiles> {
  const [jurisdictional, capital, health, family] = await Promise.all([
    readOneProfile<JurisdictionalProfileData>('jurisdictional', profileJurisdictional),
    readOneProfile<CapitalProfileData>('capital', profileCapital),
    readOneProfile<HealthProfileData>('health', profileHealth),
    readOneProfile<FamilyProfileData>('family', profileFamily),
  ]);
  return { jurisdictional, capital, health, family };
}
