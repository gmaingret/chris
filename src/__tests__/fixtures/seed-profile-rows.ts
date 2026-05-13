/**
 * src/__tests__/fixtures/seed-profile-rows.ts — Phase 36 Plan 01 Task 2
 * (Pitfall P-36-02 mitigation).
 *
 * Idempotent helper that re-applies the migration-0012 seed-row values for
 * all 4 operational-profile tables (`profile_jurisdictional`, `profile_capital`,
 * `profile_health`, `profile_family`) and wipes `profile_history`. Tests
 * call this in `beforeEach` to reset profile state before each scenario.
 *
 * **Why this helper exists (Pitfall P-36-02):**
 *
 * The primed-fixture loader (`src/__tests__/fixtures/load-primed.ts`)
 * clears + re-inserts 10 substrate tables (pensieve_entries, decisions,
 * episodic_summaries, etc.) but DOES NOT touch the 4 `profile_*` tables.
 * The profile tables are seeded by migration 0012 with `confidence=0.3` /
 * `0.2` / `0` / `0` and `substrate_hash=''`. Once a test mutates these
 * (e.g., PTEST-02 fires `updateAllOperationalProfiles()` and writes
 * `confidence > 0` + a 64-hex `substrate_hash`), subsequent tests in the
 * same DB session see the mutated state — `loadPrimedFixture()` does not
 * roll them back.
 *
 * The migration uses `ON CONFLICT (name) DO NOTHING`, which is the wrong
 * shape for this helper: we WANT to overwrite mutable columns on every
 * call so each test starts from the canonical seed state. Hence
 * `ON CONFLICT (name) DO UPDATE SET ...` — mutation-resetting, not
 * mutation-preserving.
 *
 * **Idempotency contract:** calling `seedProfileRows()` twice in a row
 * produces the same end state and writes zero net new profile_history
 * rows (the second call's history wipe undoes the first call's history
 * wipe — and neither call writes any history rows in the first place).
 *
 * **Column scope:** every mutable column is reset to its migration-0012
 * seed value, including jsonb columns. `name` is fixed at `'primary'`
 * (the sentinel from Phase 33 D-04). The `id` column is preserved across
 * UPDATE — only the first INSERT generates a UUID; subsequent UPSERTs
 * leave `id` alone (Postgres `ON CONFLICT DO UPDATE` does not modify the
 * conflict-target columns).
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/integration-m010-30days.test.ts
 */
import type postgres from 'postgres';
import { db, sql as pgSql } from '../../db/connection.js';
import { profileHistory } from '../../db/schema.js';
import { logger } from '../../utils/logger.js';

export interface SeedProfileRowsOptions {
  /**
   * Optional postgres.Sql client override. Mirrors the load-primed.ts
   * dbOverride contract — used by tests that want to route through a
   * specific client (e.g., a transaction wrapper). When omitted, the
   * module-singleton `sql` from `db/connection.js` is used.
   */
  dbOverride?: postgres.Sql;
}

/**
 * Idempotently reset all 4 operational-profile tables to migration-0012
 * seed state and wipe `profile_history`.
 *
 * Steps:
 *   1. DELETE FROM profile_history (so two-cycle / sparse tests start with
 *      a known zero-row history)
 *   2. UPSERT 4 seed rows — one per profile_* table — with ON CONFLICT
 *      (name) DO UPDATE SET <every mutable column>
 *
 * Performance note: each call performs 1 DELETE + 4 INSERT/UPSERT. On a
 * local Docker Postgres this completes in <50ms. Safe to call in every
 * `beforeEach` hook for fixture-driven test suites.
 */
export async function seedProfileRows(
  opts: SeedProfileRowsOptions = {},
): Promise<void> {
  const client: postgres.Sql = opts.dbOverride ?? pgSql;

  // Step 1: wipe profile_history so the two-cycle test starts with zero
  // history rows and can assert exact row counts after each cycle.
  await db.delete(profileHistory);

  // Step 2: re-apply migration-0012 seed-row values to all 4 profile_*
  // tables. Values are VERBATIM from src/db/migrations/0012_operational_profiles.sql
  // lines 132-204. The key difference vs the migration: ON CONFLICT
  // DO UPDATE SET (mutation-resetting) instead of DO NOTHING
  // (mutation-preserving). This is what makes the helper safe to call in
  // beforeEach — any mutation from a prior test gets rolled back to seed.

  // ── profile_jurisdictional (confidence 0.3, 4 of ~8 fields seeded) ─────
  await client.unsafe(
    `INSERT INTO profile_jurisdictional
       (name, schema_version, substrate_hash, confidence, data_consistency,
        current_country, physical_location, residency_status, tax_residency,
        active_legal_entities, next_planned_move, planned_move_date,
        passport_citizenships, last_updated)
     VALUES
       ('primary', 1, '', 0.3, 0,
        '"Russia"'::jsonb,
        '"Saint Petersburg"'::jsonb,
        '[{"type": "permanent_residency", "value": "Panama"}, {"type": "business_residency", "value": "Georgian Individual Entrepreneur"}]'::jsonb,
        'null'::jsonb,
        '[{"name": "MAINGRET LLC", "jurisdiction": "New Mexico, USA"}, {"name": "Georgian Individual Entrepreneur", "jurisdiction": "Georgia"}]'::jsonb,
        '{"destination": "Batumi, Georgia", "from_date": "2026-04-28"}'::jsonb,
        '"2026-04-28"'::jsonb,
        '["French"]'::jsonb,
        NOW())
     ON CONFLICT (name) DO UPDATE SET
       schema_version = EXCLUDED.schema_version,
       substrate_hash = EXCLUDED.substrate_hash,
       confidence = EXCLUDED.confidence,
       data_consistency = EXCLUDED.data_consistency,
       current_country = EXCLUDED.current_country,
       physical_location = EXCLUDED.physical_location,
       residency_status = EXCLUDED.residency_status,
       tax_residency = EXCLUDED.tax_residency,
       active_legal_entities = EXCLUDED.active_legal_entities,
       next_planned_move = EXCLUDED.next_planned_move,
       planned_move_date = EXCLUDED.planned_move_date,
       passport_citizenships = EXCLUDED.passport_citizenships,
       last_updated = EXCLUDED.last_updated`,
  );

  // ── profile_capital (confidence 0.2, fi_target $1.5M + MAINGRET LLC + GIE) ─
  await client.unsafe(
    `INSERT INTO profile_capital
       (name, schema_version, substrate_hash, confidence, data_consistency,
        fi_phase, fi_target_amount, estimated_net_worth, runway_months,
        next_sequencing_decision, income_sources, major_allocation_decisions,
        tax_optimization_status, active_legal_entities, last_updated)
     VALUES
       ('primary', 1, '', 0.2, 0,
        'null'::jsonb,
        '"$1,500,000"'::jsonb,
        'null'::jsonb,
        'null'::jsonb,
        'null'::jsonb,
        '[{"source": "Golfe-Juan rental property (Citya)", "kind": "rental_income"}]'::jsonb,
        '[]'::jsonb,
        'null'::jsonb,
        '[{"name": "MAINGRET LLC", "jurisdiction": "New Mexico, USA"}, {"name": "Georgian Individual Entrepreneur", "jurisdiction": "Georgia"}]'::jsonb,
        NOW())
     ON CONFLICT (name) DO UPDATE SET
       schema_version = EXCLUDED.schema_version,
       substrate_hash = EXCLUDED.substrate_hash,
       confidence = EXCLUDED.confidence,
       data_consistency = EXCLUDED.data_consistency,
       fi_phase = EXCLUDED.fi_phase,
       fi_target_amount = EXCLUDED.fi_target_amount,
       estimated_net_worth = EXCLUDED.estimated_net_worth,
       runway_months = EXCLUDED.runway_months,
       next_sequencing_decision = EXCLUDED.next_sequencing_decision,
       income_sources = EXCLUDED.income_sources,
       major_allocation_decisions = EXCLUDED.major_allocation_decisions,
       tax_optimization_status = EXCLUDED.tax_optimization_status,
       active_legal_entities = EXCLUDED.active_legal_entities,
       last_updated = EXCLUDED.last_updated`,
  );

  // ── profile_health (confidence 0, all "insufficient data") ────────────
  await client.unsafe(
    `INSERT INTO profile_health
       (name, schema_version, substrate_hash, confidence, data_consistency,
        open_hypotheses, pending_tests, active_treatments, recent_resolved,
        case_file_narrative, wellbeing_trend, last_updated)
     VALUES
       ('primary', 1, '', 0, 0,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '"insufficient data"'::jsonb,
        '{}'::jsonb,
        NOW())
     ON CONFLICT (name) DO UPDATE SET
       schema_version = EXCLUDED.schema_version,
       substrate_hash = EXCLUDED.substrate_hash,
       confidence = EXCLUDED.confidence,
       data_consistency = EXCLUDED.data_consistency,
       open_hypotheses = EXCLUDED.open_hypotheses,
       pending_tests = EXCLUDED.pending_tests,
       active_treatments = EXCLUDED.active_treatments,
       recent_resolved = EXCLUDED.recent_resolved,
       case_file_narrative = EXCLUDED.case_file_narrative,
       wellbeing_trend = EXCLUDED.wellbeing_trend,
       last_updated = EXCLUDED.last_updated`,
  );

  // ── profile_family (confidence 0, all "insufficient data") ────────────
  await client.unsafe(
    `INSERT INTO profile_family
       (name, schema_version, substrate_hash, confidence, data_consistency,
        relationship_status, partnership_criteria_evolution, children_plans,
        parent_care_responsibilities, active_dating_context, milestones,
        constraints, last_updated)
     VALUES
       ('primary', 1, '', 0, 0,
        '"insufficient data"'::jsonb,
        '[]'::jsonb,
        '"insufficient data"'::jsonb,
        '{}'::jsonb,
        '"insufficient data"'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        NOW())
     ON CONFLICT (name) DO UPDATE SET
       schema_version = EXCLUDED.schema_version,
       substrate_hash = EXCLUDED.substrate_hash,
       confidence = EXCLUDED.confidence,
       data_consistency = EXCLUDED.data_consistency,
       relationship_status = EXCLUDED.relationship_status,
       partnership_criteria_evolution = EXCLUDED.partnership_criteria_evolution,
       children_plans = EXCLUDED.children_plans,
       parent_care_responsibilities = EXCLUDED.parent_care_responsibilities,
       active_dating_context = EXCLUDED.active_dating_context,
       milestones = EXCLUDED.milestones,
       constraints = EXCLUDED.constraints,
       last_updated = EXCLUDED.last_updated`,
  );

  logger.info(
    { tables: 4, historyWiped: true },
    'fixture.seed_profile_rows.done',
  );
}
