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
  profileHexaco,
  profileSchwartz,
  profileAttachment,
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
import {
  HexacoProfileSchemaV3,
  SchwartzProfileSchemaV3,
  AttachmentProfileSchemaV3,
  type HexacoProfileData,
  type SchwartzProfileData,
  type AttachmentProfileData,
} from './profiles/psychological-schemas.js';
// Phase 39 PSURF-02 — imported VERBATIM as the load-bearing D027 mitigation
// surface. `formatPsychologicalProfilesForPrompt` appends this constant at the
// BOTTOM of every populated psychological-profile block (D-11 recency-bias).
// Single source of truth across the inference layer (Phase 38) and the
// surface-injection layer (Phase 39); NEVER redeclared. See PITFALLS.md §1.
import { PSYCHOLOGICAL_HARD_RULE_EXTENSION } from './psychological-profile-prompt.js';
import type { z } from 'zod';

// Re-export PsychologicalProfileType so Phase 39+ consumers have a stable
// import path from src/memory/profiles.js (the same module that exports
// getPsychologicalProfiles).
export type { PsychologicalProfileType } from './profiles/psychological-shared.js';
import type { PsychologicalProfileType } from './profiles/psychological-shared.js';

// ── Public types ────────────────────────────────────────────────────────

export interface ProfileRow<T> {
  data: T;
  confidence: number;
  lastUpdated: Date;
  schemaVersion: number;
  // Phase 39 Plan 39-01 (RESEARCH Open Q1 Option A) — populated only for
  // psychological profile rows by readOnePsychologicalProfile. Operational
  // rows leave them undefined. Consumed by Plan 39-02's `/profile` display
  // formatter to render the "need N more words" insufficient-data branch
  // without a second DB read.
  wordCount?: number;
  wordCountAtLastRun?: number;
}

export interface OperationalProfiles {
  jurisdictional: ProfileRow<JurisdictionalProfileData> | null;
  capital: ProfileRow<CapitalProfileData> | null;
  health: ProfileRow<HealthProfileData> | null;
  family: ProfileRow<FamilyProfileData> | null;
}

/**
 * One of the four operational profile dimensions. Exported for Phase 35
 * Plan 35-03's `/profile` handler to import.
 */
export type Dimension = 'jurisdictional' | 'capital' | 'health' | 'family';

/**
 * Per-mode subset of profile dimensions to inject into the system prompt.
 * Locked per Phase 35 D-08 + PITFALLS.md M010-08 mitigation (lines 250-258):
 *   - REFLECT synthesizes across all 4 dimensions by design
 *   - COACH gets decisions + constraints only — health → topic-drift risk (M010-08(b))
 *   - PSYCHOLOGY needs clinical + situational grounding only
 * JOURNAL / INTERROGATE / PRODUCE / PHOTOS / ACCOUNTABILITY absent by design
 * (D-28 negative invariant — no injection for these modes).
 */
export const PROFILE_INJECTION_MAP: Readonly<Record<'REFLECT' | 'COACH' | 'PSYCHOLOGY', readonly Dimension[]>> = {
  REFLECT: ['jurisdictional', 'capital', 'health', 'family'],
  COACH: ['capital', 'family'],
  PSYCHOLOGY: ['health', 'jurisdictional'],
} as const;

/**
 * Phase 39 PSURF-01 — psychological profile injection map.
 *
 * DISTINCT from the operational PROFILE_INJECTION_MAP (D-03) — the two maps
 * have different value types (Dimension[] vs PsychologicalProfileType[]) and
 * merging would force a union type that loses nominal type-safety.
 *
 * COACH is structurally absent from the key union. Adding it would require a
 * type change AND would trigger the negative-invariant test at
 * src/chris/modes/__tests__/coach-psychological-isolation.test.ts. This is the
 * primary D027 Hard Rule defense — trait → coaching-conclusion is circular
 * reasoning per PITFALLS.md §1 (sycophancy injection via profile authority
 * framing). See PROJECT.md D027.
 *
 * 'attachment' is NOT in any mode's array — Phase 38 D-23 deferred the
 * attachment generator to v2.6.1; no data exists to inject in M011.
 */
export const PSYCHOLOGICAL_PROFILE_INJECTION_MAP: Readonly<
  Record<'REFLECT' | 'PSYCHOLOGY', readonly PsychologicalProfileType[]>
> = {
  REFLECT: ['hexaco', 'schwartz'],
  PSYCHOLOGY: ['hexaco', 'schwartz'],
} as const;

// ── Dispatcher: schema_version → Zod schema, per dimension ──────────────
//
// Schema-version dispatcher pattern per PITFALLS.md M010-11. Explicit
// `if (!parser)` check below before `.safeParse` (Pitfall 6) so a future
// row with schema_version=999 returns null, never crashes.

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
  // CONTRACT-01 scope NOTE (Phase 43 / D-09 — deviation from plan):
  // The plan asked to add `dataConsistency: _dataConsistency` to this destructure
  // alongside the shared.ts copy. That edit BROKE the v3 Zod re-validate path:
  // JurisdictionalProfileSchemaV3 / Capital / Health / Family all declare
  // `data_consistency: z.number()...` at top level under `.strict()`, so the
  // reader's safeParse REQUIRES the field. Stripping it produces an "unknown
  // key" rejection that null-routes every read.
  //
  // The CONTRACT-01 *semantic* — "host-computes-not-emits, prevState handed to
  // Sonnet must not leak dataConsistency" — only applies to the prompt-builder
  // path. That path lives in src/memory/profiles/shared.ts:stripMetadataColumns
  // (CONTRACT-01 fully applied there). This reader-side helper feeds the v3
  // schema parse, where data_consistency is a required field — discarding it
  // here is a no-op against the threat model and breaks reads.
  //
  // The `confidence: _confidence` rename below DOES align with the plan-locked
  // pattern (`_` prefix marks intentional discard) — `confidence` is the host-
  // computed final value the reader exposes as ProfileRow.confidence, not part
  // of the parsed data shape.
  const {
    id, name, schemaVersion, substrateHash,
    confidence: _confidence,
    lastUpdated, createdAt,
    ...rest
  } = row;
  void id; void name; void schemaVersion; void substrateHash;
  void _confidence; void lastUpdated; void createdAt;

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

// ── M011 psychological-profile reader — Phase 37 Plan 37-02 Task 3 ──────
//
// PSCH-09 deliverable: typed never-throw reader over the 3 M011 profile
// tables (hexaco, schwartz, attachment). Structural mirror of the M010
// operational reader above, with these locked divergences per
// 37-CONTEXT.md (D-21..D-24):
//
//   - SEPARATE function `getPsychologicalProfiles` (D-21) — does NOT
//     replace getOperationalProfiles. The 8+ existing call sites for the
//     M010 reader keep their canonical type.
//   - DISTINCT log event namespace `chris.psychological.profile.read.*`
//     (D-23) — separate from M010's `chris.profile.read.*` so future log
//     filtering can route psychological-profile errors separately.
//   - 3-LAYER Zod v3 parse defense (D-23): schema_version dispatcher miss
//     → schema_mismatch; safeParse failure → parse_failed; outer throw
//     → unknown_error. Each layer returns null per-profile (Promise.all
//     aggregates 3 nullable results — partial failures don't cascade).
//   - 11-COLUMN metadata strip (Pitfall 7): M011 profile rows have 4 more
//     metadata columns than M010 (substrateHash, overallConfidence,
//     wordCount, wordCountAtLastRun, relationalWordCount, activated +
//     the universal ones). The shared helper stripPsychologicalMetadataColumns
//     destructures all 11; attachment-only columns are harmlessly absent
//     on hexaco/schwartz rows.
//   - `row.lastUpdated ?? new Date(0)` (D-22) — cold-start null
//     (migration 0013 seeds last_updated=NULL) coalesces to epoch so the
//     ProfileRow<T>.lastUpdated: Date contract holds for the never-run
//     case.

export interface PsychologicalProfiles {
  hexaco: ProfileRow<HexacoProfileData> | null;
  schwartz: ProfileRow<SchwartzProfileData> | null;
  attachment: ProfileRow<AttachmentProfileData> | null;
}

// Module-private schema_version → Zod schema dispatcher (D-24). Internal —
// no export. Future schema-version bumps add entries here; readOne handles
// missing-version lookups via the schema_mismatch layer.
const PSYCHOLOGICAL_PROFILE_SCHEMAS: Record<
  PsychologicalProfileType,
  Record<number, z.ZodTypeAny>
> = {
  hexaco: { 1: HexacoProfileSchemaV3 },
  schwartz: { 1: SchwartzProfileSchemaV3 },
  attachment: { 1: AttachmentProfileSchemaV3 },
};

/**
 * Strip the 11 metadata columns from an M011 psychological-profile SELECT
 * row so what remains is the validatable jsonb-field set (matches the v3
 * schema shape per psychological-schemas.ts).
 *
 * The 11 columns stripped (Pitfall 7 — comprehensive enumeration):
 *   - id (uuid PK)
 *   - name (string sentinel = 'primary')
 *   - schemaVersion (number)
 *   - substrateHash (string)
 *   - overallConfidence (number 0-1)
 *   - wordCount (number)
 *   - wordCountAtLastRun (number)
 *   - lastUpdated (nullable timestamp)
 *   - createdAt (timestamp)
 *   - relationalWordCount (attachment-only; harmlessly absent on hexaco/
 *     schwartz rows because destructuring an absent key yields undefined)
 *   - activated (attachment-only; same harmless-absent behavior)
 *
 * Converts remaining Drizzle camelCase keys to snake_case to match the Zod
 * schemas defined in psychological-schemas.ts (per-dimension keys are
 * snake_case: honesty_humility, self_direction, etc.).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stripPsychologicalMetadataColumns(row: Record<string, any>): Record<string, unknown> {
  const {
    id,
    name,
    schemaVersion,
    substrateHash,
    overallConfidence,
    // Phase 43 CONTRACT-03 / D-12: the new dataConsistency column on the 3
    // psychological profile tables (migration 0014) must be discarded here.
    // The per-dim v3/v4 row schemas (HexacoProfileSchemaV3 etc.) are .strict()
    // and do NOT declare data_consistency at the row-shape level (that field
    // lives only on the SDK-boundary variants — V3Boundary / V4Boundary —
    // used by the upsert path, not the reader). Leaving it in `rest` would
    // produce 'Unrecognized key(s) in object: data_consistency' parse errors
    // on every row read post-migration-0014.
    dataConsistency,
    wordCount,
    wordCountAtLastRun,
    lastUpdated,
    createdAt,
    relationalWordCount,
    activated,
    ...rest
  } = row;
  void id; void name; void schemaVersion; void substrateHash;
  void overallConfidence; void dataConsistency;
  void wordCount; void wordCountAtLastRun;
  void lastUpdated; void createdAt;
  void relationalWordCount; void activated;

  // Drizzle returns camelCase; Zod psych-schemas expect snake_case.
  const snakeRest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    const snake = k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    snakeRest[snake] = v;
  }
  return snakeRest;
}

/**
 * Read one psychological profile dimension. Encapsulates the DB SELECT +
 * 3-layer Zod parse defense per D-23. Per-profile null on any failure;
 * NEVER throws.
 *
 * Layer 1 (schema_mismatch): schema_version stored in the row is not in
 *   PSYCHOLOGICAL_PROFILE_SCHEMAS[profileType]. Logs
 *   'chris.psychological.profile.read.schema_mismatch' → returns null.
 *
 * Layer 2 (parse_failed): safeParse against the dispatched schema fails
 *   (corrupted jsonb at read boundary). Logs
 *   'chris.psychological.profile.read.parse_failed' → returns null.
 *
 * Layer 3 (unknown_error): any throw — DB connection dropped, query
 *   timeout, unexpected runtime error. Logs
 *   'chris.psychological.profile.read.unknown_error' → returns null.
 */
async function readOnePsychologicalProfile<T>(
  profileType: PsychologicalProfileType,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
): Promise<ProfileRow<T> | null> {
  try {
    const rows = await db
      .select()
      .from(table)
      .where(eq(table.name, 'primary'))
      .limit(1);
    if (rows.length === 0) return null;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = rows[0]!;

    // Layer 1: schema_version dispatch (D-23 schema_mismatch).
    const parser =
      PSYCHOLOGICAL_PROFILE_SCHEMAS[profileType][row.schemaVersion as number];
    if (!parser) {
      logger.warn(
        { profileType, schemaVersion: row.schemaVersion },
        'chris.psychological.profile.read.schema_mismatch',
      );
      return null;
    }

    // Layer 2: safeParse over the stripped jsonb-field set (D-23 parse_failed).
    const dataToValidate = stripPsychologicalMetadataColumns(row);
    const parsed = parser.safeParse(dataToValidate);
    if (!parsed.success) {
      logger.warn(
        { profileType, error: parsed.error.message },
        'chris.psychological.profile.read.parse_failed',
      );
      return null;
    }

    return {
      data: parsed.data as T,
      confidence: row.overallConfidence,
      // D-22: cold-start null lastUpdated (migration 0013 seed rows) →
      // epoch sentinel so the ProfileRow<T>.lastUpdated: Date contract holds.
      lastUpdated: row.lastUpdated ?? new Date(0),
      schemaVersion: row.schemaVersion,
      // Phase 39 Plan 39-01 (RESEARCH Open Q1 Option A) — thread the
      // psychological-row word-count columns through so Plan 39-02's
      // display formatter can render "need N more words" without a
      // second DB read. Operational rows do NOT thread these (they have
      // no such columns); the fields remain undefined there.
      wordCount: row.wordCount,
      wordCountAtLastRun: row.wordCountAtLastRun,
    };
  } catch (error) {
    // Layer 3: any uncaught throw (D-23 unknown_error).
    logger.warn(
      {
        profileType,
        error: error instanceof Error ? error.message : String(error),
      },
      'chris.psychological.profile.read.unknown_error',
    );
    return null;
  }
}

/**
 * Read all 3 psychological profiles (hexaco, schwartz, attachment) in
 * parallel. Never throws.
 *
 * Return contract (D-22 mirrors M010 D-12):
 *   - Always returns `PsychologicalProfiles` shape
 *   - Each field is `ProfileRow<T>` (parsed seed) OR `null` (DB error,
 *     missing row, schema_mismatch, parse_failed, unknown_error)
 *   - On total DB failure: { hexaco: null, schwartz: null, attachment: null }
 *     — NEVER a single null. Promise.all + per-profile try/catch in
 *     readOnePsychologicalProfile isolates per-profile failures.
 *
 * Phase 38 generators will call this BEFORE invoking the substrate loader
 * so the generator can read the prior profile state and thread it into the
 * Sonnet prompt as the "before" snapshot.
 */
export async function getPsychologicalProfiles(): Promise<PsychologicalProfiles> {
  const [hexaco, schwartz, attachment] = await Promise.all([
    readOnePsychologicalProfile<HexacoProfileData>('hexaco', profileHexaco),
    readOnePsychologicalProfile<SchwartzProfileData>('schwartz', profileSchwartz),
    readOnePsychologicalProfile<AttachmentProfileData>('attachment', profileAttachment),
  ]);
  return { hexaco, schwartz, attachment };
}

// ── formatProfilesForPrompt — Phase 35 Plan 35-02 (SURF-02) ─────────────
//
// Pure function: renders the per-mode subset of operational profiles into a
// prompt-ready block prefixed with the D-13 verbatim header. Returns "" when
// nothing renders (D-12.a..d). No I/O, no DB, no logger calls — testable in
// isolation by passing OperationalProfiles fixtures.

const PER_DIMENSION_CHAR_CAP = 2000;
const STALENESS_MS = 21 * 86_400_000;
const HEALTH_CONFIDENCE_FLOOR = 0.5;
// Exported for Phase 36 Plan 02 PTEST-05 (live anti-hallucination test) which
// asserts this exact header appears in the REFLECT system prompt. Sibling
// tests in src/memory/profiles/__tests__/ may also import to avoid hardcoding
// the verbatim string in two places.
export const PROFILE_INJECTION_HEADER = '## Operational Profile (grounded context — not interpretation)';

/**
 * Format the operational profiles for system-prompt injection in REFLECT,
 * COACH, or PSYCHOLOGY modes. Contract (Plan 35-02 D-08..D-13):
 *
 * - `mode` not in `PROFILE_INJECTION_MAP` → returns "" (D-12.a)
 * - all in-scope dimensions null / zero-confidence → returns "" (D-12.b/c)
 * - health below 0.5 confidence is skipped (D-09); if it was the only candidate
 *   and others are null/zero-confidence → returns "" (D-12.d)
 * - lastUpdated > 21 days ago → appends staleness qualifier (D-10)
 * - per-dimension rendering capped at 2000 chars with "..." marker (D-11)
 * - output starts with the verbatim D-13 header when at least one dimension
 *   renders
 */
export function formatProfilesForPrompt(profiles: OperationalProfiles, mode: string): string {
  const scope = (PROFILE_INJECTION_MAP as Record<string, readonly Dimension[]>)[mode];
  if (!scope) return '';

  const sections: string[] = [];
  const now = Date.now();

  for (const dim of scope) {
    const row = profiles[dim];
    if (!row) continue;
    if (row.confidence === 0) continue;
    if (dim === 'health' && row.confidence < HEALTH_CONFIDENCE_FLOOR) continue;

    // The runtime switch inside renderDimensionForPrompt narrows row.data by
    // `dim`; TS cannot see this correspondence across the for-of union, so we
    // erase it to ProfileRow<unknown> at the call boundary.
    let block = renderDimensionForPrompt(dim, row as ProfileRow<unknown>);
    if (block.length > PER_DIMENSION_CHAR_CAP) {
      block = block.slice(0, PER_DIMENSION_CHAR_CAP - 3) + '...';
    }
    if (now - row.lastUpdated.getTime() > STALENESS_MS) {
      const dateStr = row.lastUpdated.toISOString().slice(0, 10);
      block += `\nNote: profile data from ${dateStr} — may not reflect current state.`;
    }
    sections.push(block);
  }

  if (sections.length === 0) return '';
  return PROFILE_INJECTION_HEADER + '\n\n' + sections.join('\n\n');
}

/**
 * Per-dimension renderer (internal — not exported). Emits a labeled block in
 * second-person, present-tense framing per D-20 (mirrors the /profile
 * display formatter style). Each block begins with a dimension header so
 * scope-order assertions can pattern-match on the dimension name.
 */
function renderDimensionForPrompt<T>(dim: Dimension, row: ProfileRow<T>): string {
  const confPct = Math.round(row.confidence * 100);
  switch (dim) {
    case 'jurisdictional': {
      const d = row.data as JurisdictionalProfileData;
      const lines: string[] = [`### Jurisdictional (confidence ${confPct}%)`];
      if (d.current_country) lines.push(`Current country: ${d.current_country}`);
      if (d.physical_location) lines.push(`Physical location: ${d.physical_location}`);
      if (d.tax_residency) lines.push(`Tax residency: ${d.tax_residency}`);
      if (d.residency_status?.length) {
        const statuses = d.residency_status.map((rs) => `${rs.type}=${rs.value}`).join(', ');
        lines.push(`Residency statuses: ${statuses}`);
      }
      if (d.active_legal_entities?.length) {
        const ents = d.active_legal_entities.map((e) => `${e.name} (${e.jurisdiction})`).join(', ');
        lines.push(`Active legal entities: ${ents}`);
      }
      if (d.next_planned_move?.destination) {
        lines.push(`Next planned move: ${d.next_planned_move.destination}` +
          (d.next_planned_move.from_date ? ` from ${d.next_planned_move.from_date}` : ''));
      } else if (d.planned_move_date) {
        lines.push(`Planned move date: ${d.planned_move_date}`);
      }
      if (d.passport_citizenships?.length) {
        lines.push(`Passport citizenships: ${d.passport_citizenships.join(', ')}`);
      }
      return lines.join('\n');
    }
    case 'capital': {
      const d = row.data as CapitalProfileData;
      const lines: string[] = [`### Capital (confidence ${confPct}%)`];
      if (d.fi_phase) lines.push(`FI phase: ${d.fi_phase}`);
      if (d.fi_target_amount) lines.push(`FI target: ${d.fi_target_amount}`);
      if (d.estimated_net_worth) lines.push(`Estimated net worth: ${d.estimated_net_worth}`);
      if (d.runway_months != null) lines.push(`Runway months: ${d.runway_months}`);
      if (d.next_sequencing_decision) lines.push(`Next sequencing decision: ${d.next_sequencing_decision}`);
      if (d.tax_optimization_status) lines.push(`Tax optimization status: ${d.tax_optimization_status}`);
      if (d.income_sources?.length) {
        const srcs = d.income_sources.map((s) => `${s.source} (${s.kind})`).join(', ');
        lines.push(`Income sources: ${srcs}`);
      }
      if (d.active_legal_entities?.length) {
        const ents = d.active_legal_entities.map((e) => `${e.name} (${e.jurisdiction})`).join(', ');
        lines.push(`Active legal entities: ${ents}`);
      }
      if (d.major_allocation_decisions?.length) {
        const allocs = d.major_allocation_decisions
          .map((a) => `${a.date}: ${a.description}`)
          .join('; ');
        lines.push(`Major allocation decisions: ${allocs}`);
      }
      return lines.join('\n');
    }
    case 'health': {
      const d = row.data as HealthProfileData;
      const lines: string[] = [`### Health (confidence ${confPct}%)`];
      if (d.case_file_narrative) lines.push(`Case-file narrative: ${d.case_file_narrative}`);
      if (d.open_hypotheses?.length) {
        const hyps = d.open_hypotheses
          .map((h) => `${h.name} [${h.status} since ${h.date_opened}]`)
          .join('; ');
        lines.push(`Open hypotheses: ${hyps}`);
      }
      if (d.pending_tests?.length) {
        const tests = d.pending_tests
          .map((t) => `${t.test_name} (${t.status}${t.scheduled_date ? `, scheduled ${t.scheduled_date}` : ''})`)
          .join('; ');
        lines.push(`Pending tests: ${tests}`);
      }
      if (d.active_treatments?.length) {
        const tx = d.active_treatments
          .map((t) => `${t.name} since ${t.started_date}` + (t.purpose ? ` (${t.purpose})` : ''))
          .join('; ');
        lines.push(`Active treatments: ${tx}`);
      }
      if (d.recent_resolved?.length) {
        const res = d.recent_resolved
          .map((r) => `${r.name} resolved ${r.resolved_date}: ${r.resolution}`)
          .join('; ');
        lines.push(`Recent resolved: ${res}`);
      }
      const wb = d.wellbeing_trend;
      if (wb && (wb.energy_30d_mean != null || wb.mood_30d_mean != null || wb.anxiety_30d_mean != null)) {
        const parts: string[] = [];
        if (wb.energy_30d_mean != null) parts.push(`energy=${wb.energy_30d_mean}`);
        if (wb.mood_30d_mean != null) parts.push(`mood=${wb.mood_30d_mean}`);
        if (wb.anxiety_30d_mean != null) parts.push(`anxiety=${wb.anxiety_30d_mean}`);
        lines.push(`Wellbeing 30d trend: ${parts.join(', ')}`);
      }
      return lines.join('\n');
    }
    case 'family': {
      const d = row.data as FamilyProfileData;
      const lines: string[] = [`### Family (confidence ${confPct}%)`];
      if (d.relationship_status) lines.push(`Relationship status: ${d.relationship_status}`);
      if (d.children_plans) lines.push(`Children plans: ${d.children_plans}`);
      if (d.active_dating_context) lines.push(`Active dating context: ${d.active_dating_context}`);
      const pcr = d.parent_care_responsibilities;
      if (pcr && (pcr.notes || pcr.dependents?.length)) {
        const parts: string[] = [];
        if (pcr.notes) parts.push(pcr.notes);
        if (pcr.dependents?.length) parts.push(`dependents=${pcr.dependents.join(', ')}`);
        lines.push(`Parent-care responsibilities: ${parts.join(' | ')}`);
      }
      if (d.partnership_criteria_evolution?.length) {
        const crits = d.partnership_criteria_evolution
          .filter((c) => c.still_active)
          .map((c) => `${c.date_noted}: ${c.text}`)
          .join('; ');
        if (crits) lines.push(`Active partnership criteria: ${crits}`);
      }
      if (d.constraints?.length) {
        const cons = d.constraints.map((c) => `${c.date_noted}: ${c.text}`).join('; ');
        lines.push(`Constraints: ${cons}`);
      }
      if (d.milestones?.length) {
        const ms = d.milestones
          .map((m) => `${m.date} ${m.type}` + (m.notes ? `: ${m.notes}` : ''))
          .join('; ');
        lines.push(`Milestones: ${ms}`);
      }
      return lines.join('\n');
    }
  }
}

// ── formatPsychologicalProfilesForPrompt — Phase 39 Plan 39-01 (PSURF-02) ──
//
// Pure function: renders the per-mode subset of psychological profiles into a
// prompt-ready block with the verbatim header at the top and the imported
// PSYCHOLOGICAL_HARD_RULE_EXTENSION footer at the bottom (D-11 recency-bias).
// Returns "" on any of the four empty-string gates (D-05.a/b/c/d). No I/O,
// no DB, no logger calls — testable in isolation by passing
// PsychologicalProfiles fixtures.
//
// DISTINCT from the operational formatProfilesForPrompt above — different
// scope, different render shape, different footer constant. The two
// formatters intentionally do NOT share helper functions (D-03 sibling-but-
// distinct discipline).

// Verbatim header per D-06 — frames the data as low-precision at injection
// time (first defense surface in the D027 mitigation chain).
const PSYCH_INJECTION_HEADER =
  '## Psychological Profile (inferred — low precision, never use as authority)';

// D-07 qualifier mapping — module-private. The three bands (<0.3 / 0.3-0.59
// / >=0.6) are locked by CONTEXT.md D-07 and exercised by the formatter
// unit tests; future re-banding requires a CONTEXT update + test sync.
function qualifierFor(c: number): string {
  if (c >= 0.6) return 'substantial evidence';
  if (c >= 0.3) return 'moderate evidence';
  return 'limited evidence';
}

// Title-case dim labels per D-08; hyphens preserved (Honesty-Humility,
// Self-Direction). Module-private — these are presentation strings, not a
// shared vocabulary.
const HEXACO_DIM_LABELS: Readonly<Record<keyof HexacoProfileData, string>> = {
  honesty_humility: 'Honesty-Humility',
  emotionality: 'Emotionality',
  extraversion: 'Extraversion',
  agreeableness: 'Agreeableness',
  conscientiousness: 'Conscientiousness',
  openness: 'Openness',
} as const;

const SCHWARTZ_DIM_LABELS: Readonly<Record<keyof SchwartzProfileData, string>> = {
  self_direction: 'Self-Direction',
  stimulation: 'Stimulation',
  hedonism: 'Hedonism',
  achievement: 'Achievement',
  power: 'Power',
  security: 'Security',
  conformity: 'Conformity',
  tradition: 'Tradition',
  benevolence: 'Benevolence',
  universalism: 'Universalism',
} as const;

/**
 * Per-profile-type renderer (internal — not exported). For each populated
 * dim (non-null AND confidence > 0 per D-09) emits one line of the form:
 *
 *   "<DIM_LABEL> <Trait>: X.X / 5.0 (confidence Y.Y — <qualifier>)"
 *
 * Score and confidence are formatted with 1 decimal place per D-08. Returns
 * '' if all dims were filtered out — caller treats this as "no section to
 * render".
 *
 * 'attachment' returns '' (no labels defined; D-04 prevents reaching here via
 * the map, this is defense-in-depth).
 */
function renderPsychDimensions(
  profileType: PsychologicalProfileType,
  row:
    | ProfileRow<HexacoProfileData>
    | ProfileRow<SchwartzProfileData>
    | ProfileRow<AttachmentProfileData>,
): string {
  const lines: string[] = [];

  if (profileType === 'hexaco') {
    const data = row.data as HexacoProfileData;
    for (const key of Object.keys(HEXACO_DIM_LABELS) as Array<keyof HexacoProfileData>) {
      const dim = data[key];
      if (!dim) continue; // D-09 skip null
      if (dim.score == null) continue; // D-09 skip missing score
      if (dim.confidence === 0) continue; // D-09 skip zero-confidence
      lines.push(
        `HEXACO ${HEXACO_DIM_LABELS[key]}: ${dim.score.toFixed(1)} / 5.0 ` +
          `(confidence ${dim.confidence.toFixed(1)} — ${qualifierFor(dim.confidence)})`,
      );
    }
    return lines.join('\n');
  }

  if (profileType === 'schwartz') {
    const data = row.data as SchwartzProfileData;
    for (const key of Object.keys(SCHWARTZ_DIM_LABELS) as Array<keyof SchwartzProfileData>) {
      const dim = data[key];
      if (!dim) continue;
      if (dim.score == null) continue;
      if (dim.confidence === 0) continue;
      lines.push(
        `Schwartz ${SCHWARTZ_DIM_LABELS[key]}: ${dim.score.toFixed(1)} / 5.0 ` +
          `(confidence ${dim.confidence.toFixed(1)} — ${qualifierFor(dim.confidence)})`,
      );
    }
    return lines.join('\n');
  }

  // 'attachment' — no labels defined; D-04 already excludes attachment from
  // every mode's array in PSYCHOLOGICAL_PROFILE_INJECTION_MAP, but this
  // empty-return is defense-in-depth.
  return '';
}

/**
 * Format the psychological profiles for system-prompt injection in REFLECT
 * or PSYCHOLOGY modes. Contract (Phase 39 D-05..D-11):
 *
 *   - `mode` not in PSYCHOLOGICAL_PROFILE_INJECTION_MAP → returns "" (D-05.a)
 *   - all in-scope profiles null → returns "" (D-05.b)
 *   - all in-scope profiles with overall_confidence === 0 → returns "" (D-05.c)
 *   - all in-scope profiles never-fired (lastUpdated epoch === 0) → "" (D-05.d)
 *   - populated → emits PSYCH_INJECTION_HEADER + per-dim lines +
 *     PSYCHOLOGICAL_HARD_RULE_EXTENSION (IMPORTED VERBATIM at the bottom
 *     per D-11 recency-bias attention)
 *
 * The Hard Rule footer is the load-bearing D027 mitigation per PITFALLS.md §1
 * — small wording changes there dramatically change Sonnet's sycophancy
 * resistance. The constant is imported (not redeclared) from
 * `psychological-profile-prompt.ts` for single-source-of-truth discipline
 * across the inference (Phase 38) and consumer (Phase 39) layers.
 */
export function formatPsychologicalProfilesForPrompt(
  profiles: PsychologicalProfiles,
  mode: string,
): string {
  const scope = (PSYCHOLOGICAL_PROFILE_INJECTION_MAP as Record<
    string,
    readonly PsychologicalProfileType[]
  >)[mode];
  if (!scope) return ''; // D-05.a

  const sections: string[] = [];

  for (const profileType of scope) {
    const row = profiles[profileType];
    if (!row) continue; // D-05.b — null row
    if (row.confidence === 0) continue; // D-05.c — zero overall_confidence
    if (row.lastUpdated.getTime() === 0) continue; // D-05.d — never-fired epoch
    const block = renderPsychDimensions(profileType, row);
    if (block.length > 0) sections.push(block);
  }

  if (sections.length === 0) return '';

  // D-06 + D-11 — footer at BOTTOM (recency-bias); IMPORTED VERBATIM from
  // src/memory/psychological-profile-prompt.ts:144 — DO NOT redeclare.
  // PITFALLS.md §1 — this is the load-bearing D027 mitigation surface.
  return [
    PSYCH_INJECTION_HEADER,
    '',
    sections.join('\n\n'),
    '',
    PSYCHOLOGICAL_HARD_RULE_EXTENSION,
  ].join('\n');
}
