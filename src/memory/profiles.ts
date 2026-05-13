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

// ── formatProfilesForPrompt — Phase 35 Plan 35-02 (SURF-02) ─────────────
//
// Pure function: renders the per-mode subset of operational profiles into a
// prompt-ready block prefixed with the D-13 verbatim header. Returns "" when
// nothing renders (D-12.a..d). No I/O, no DB, no logger calls — testable in
// isolation by passing OperationalProfiles fixtures.

const PER_DIMENSION_CHAR_CAP = 2000;
const STALENESS_MS = 21 * 86_400_000;
const HEALTH_CONFIDENCE_FLOOR = 0.5;
const PROFILE_INJECTION_HEADER = '## Operational Profile (grounded context — not interpretation)';

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
