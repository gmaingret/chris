/**
 * Phase 45 Plan 03 — SCHEMA-02 / migration 0016 integration tests.
 *
 * Exercises the seed-defaults backfill applied by
 * `src/db/migrations/0016_phase33_seed_defaults_backfill.sql` against a
 * real Docker Postgres (via the migration apply chain in `scripts/test.sh`).
 *
 * Covered cases (4 `it()` blocks under one `describe.sequential`):
 *   1. Backfill effect: cold-start seed rows have all v3-Zod-required
 *      nullable keys after migration applies.
 *   2. DEFAULT change: fresh INSERT into profile_health and profile_family
 *      with no column value gets the new DEFAULT shape (3 nullable keys
 *      for wellbeing_trend, 2 nullable keys for parent_care_responsibilities).
 *   3. v3 Zod `.strict()` parse acceptance: rows post-backfill parse cleanly
 *      via the existing reader API (no schema_mismatch warns).
 *   4. Idempotency: re-applying the migration is a no-op (UPDATE WHERE clause
 *      fails once column is populated; ALTER SET DEFAULT is naturally
 *      idempotent in Postgres).
 *
 * Run: `bash scripts/test.sh src/__tests__/migrations/0016-seed-defaults-backfill.test.ts`
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { sql } from '../../db/connection.js';
import { getOperationalProfiles } from '../../memory/profiles.js';

const MIGRATION_SQL_PATH =
  'src/db/migrations/0016_phase33_seed_defaults_backfill.sql';

// Test-scoped rows we INSERT to verify DEFAULT change. Cleanup deletes by name.
const TEST_HEALTH_ROW_NAME = '__test_0016_health_default__';
const TEST_FAMILY_ROW_NAME = '__test_0016_family_default__';

async function cleanupTestRows(): Promise<void> {
  await sql.unsafe(`DELETE FROM profile_health WHERE name = '${TEST_HEALTH_ROW_NAME}';`);
  await sql.unsafe(`DELETE FROM profile_family WHERE name = '${TEST_FAMILY_ROW_NAME}';`);
}

describe.sequential('Migration 0016 — phase33 seed defaults backfill', () => {
  beforeAll(async () => {
    await cleanupTestRows();
  });

  afterAll(async () => {
    await cleanupTestRows();
    await sql.end();
  });

  it('case 1: cold-start seed rows have all v3-Zod-required nullable keys', async () => {
    // The Phase 33 seed migration inserted rows with name='primary' and
    // substrate_hash=''. Migration 0016 UPDATEs those rows so wellbeing_trend
    // and parent_care_responsibilities contain the required nullable fields.
    const healthRows = await sql.unsafe<
      Array<{ wellbeing_trend: Record<string, unknown> }>
    >(`SELECT wellbeing_trend FROM profile_health WHERE name = 'primary';`);

    expect(healthRows).toHaveLength(1);
    const wt = healthRows[0]!.wellbeing_trend;
    expect(wt).toHaveProperty('energy_30d_mean', null);
    expect(wt).toHaveProperty('mood_30d_mean', null);
    expect(wt).toHaveProperty('anxiety_30d_mean', null);

    const familyRows = await sql.unsafe<
      Array<{ parent_care_responsibilities: Record<string, unknown> }>
    >(
      `SELECT parent_care_responsibilities FROM profile_family WHERE name = 'primary';`,
    );

    expect(familyRows).toHaveLength(1);
    const pcr = familyRows[0]!.parent_care_responsibilities;
    expect(pcr).toHaveProperty('notes', null);
    expect(pcr).toHaveProperty('dependents');
    expect(Array.isArray((pcr as { dependents: unknown }).dependents)).toBe(
      true,
    );
  });

  it('case 2: fresh INSERT with no column value gets the new DEFAULT shape', async () => {
    // Insert minimal rows omitting wellbeing_trend / parent_care_responsibilities.
    // All other columns have NOT NULL DEFAULT clauses so Postgres auto-fills
    // them. The ALTER COLUMN SET DEFAULT in 0016 means wellbeing_trend and
    // parent_care_responsibilities should auto-fill with the populated-
    // nullable-shape default, NOT '{}'::jsonb (the pre-0016 default that
    // caused schema_mismatch warns).
    await sql.unsafe(
      `INSERT INTO profile_health (name) VALUES ('${TEST_HEALTH_ROW_NAME}');`,
    );
    await sql.unsafe(
      `INSERT INTO profile_family (name) VALUES ('${TEST_FAMILY_ROW_NAME}');`,
    );

    const healthDefault = await sql.unsafe<
      Array<{ wellbeing_trend: Record<string, unknown> }>
    >(
      `SELECT wellbeing_trend FROM profile_health WHERE name = '${TEST_HEALTH_ROW_NAME}';`,
    );
    expect(healthDefault).toHaveLength(1);
    expect(healthDefault[0]!.wellbeing_trend).toEqual({
      energy_30d_mean: null,
      mood_30d_mean: null,
      anxiety_30d_mean: null,
    });

    const familyDefault = await sql.unsafe<
      Array<{ parent_care_responsibilities: Record<string, unknown> }>
    >(
      `SELECT parent_care_responsibilities FROM profile_family WHERE name = '${TEST_FAMILY_ROW_NAME}';`,
    );
    expect(familyDefault).toHaveLength(1);
    expect(familyDefault[0]!.parent_care_responsibilities).toEqual({
      notes: null,
      dependents: [],
    });
  });

  it('case 3: v3 Zod strict() parse accepts post-backfill rows via getOperationalProfiles', async () => {
    // The reader API runs v3 .strict() parse. Pre-0016 the cold-start seed
    // rows would emit a schema_mismatch warn for wellbeing_trend (missing
    // energy/mood/anxiety_30d_mean) and parent_care_responsibilities (missing
    // notes/dependents). Post-0016 the parse should succeed without warns.
    const profiles = await getOperationalProfiles();
    expect(profiles).not.toBeNull();
    expect(profiles?.health).not.toBeNull();
    expect(profiles?.family).not.toBeNull();
    // The presence of populated objects (not null) confirms .strict() parse
    // accepted the rows; if .strict() had rejected, getOperationalProfiles
    // returns null for that dimension per its never-throw contract.
  });

  it('case 4: re-applying the migration is idempotent (no state change)', async () => {
    const sqlText = readFileSync(MIGRATION_SQL_PATH, 'utf-8');

    // Snapshot post-first-apply state.
    const beforeHealth = await sql.unsafe<
      Array<{ wellbeing_trend: Record<string, unknown> }>
    >(`SELECT wellbeing_trend FROM profile_health WHERE name = 'primary';`);
    const beforeFamily = await sql.unsafe<
      Array<{ parent_care_responsibilities: Record<string, unknown> }>
    >(
      `SELECT parent_care_responsibilities FROM profile_family WHERE name = 'primary';`,
    );

    // Re-apply migration. The UPDATE WHERE clauses use `col = '{}'::jsonb` so
    // they no-op once the column has been populated. The ALTER SET DEFAULT
    // is naturally idempotent (re-setting same default is a Postgres no-op).
    await sql.unsafe(sqlText);

    const afterHealth = await sql.unsafe<
      Array<{ wellbeing_trend: Record<string, unknown> }>
    >(`SELECT wellbeing_trend FROM profile_health WHERE name = 'primary';`);
    const afterFamily = await sql.unsafe<
      Array<{ parent_care_responsibilities: Record<string, unknown> }>
    >(
      `SELECT parent_care_responsibilities FROM profile_family WHERE name = 'primary';`,
    );

    expect(afterHealth[0]!.wellbeing_trend).toEqual(beforeHealth[0]!.wellbeing_trend);
    expect(afterFamily[0]!.parent_care_responsibilities).toEqual(
      beforeFamily[0]!.parent_care_responsibilities,
    );
  });
});
