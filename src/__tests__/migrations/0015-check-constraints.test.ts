/**
 * Phase 45 Plan 01 — SCHEMA-01 / migration 0015 integration tests.
 *
 * Exercises the 19 per-dim CHECK constraints added by
 * `src/db/migrations/0015_psychological_check_constraints.sql` against a
 * real Docker Postgres (via the migration apply chain in `scripts/test.sh`).
 *
 * Covered cases (7 `it()` blocks under one `describe.sequential`):
 *   1. out-of-range HEXACO score (>5.0) is rejected with SQLSTATE 23514.
 *   2. out-of-range HEXACO score (<1.0) is rejected with 23514.
 *   3. out-of-range Schwartz score (>7.0) is rejected with 23514.
 *   4. out-of-range confidence (>1.0) is rejected with 23514.
 *   5. in-range HEXACO update succeeds and round-trips.
 *   6. null-literal jsonb update succeeds (preserves 0013 seed default).
 *   7. all 19 per-dim bounds constraints exist (introspection assertion).
 *
 * Each violation case asserts on BOTH `code === '23514'` AND the
 * `constraint_name` to prove the failure is the migration-0015 bounds
 * constraint and not an unrelated DB error.
 *
 * Tests use `sql.unsafe(...)` to craft intentionally-invalid jsonb payloads
 * — Drizzle's typed builder rejects them at the type layer (which is the
 * whole point of the Zod read-time parse; this test only exercises the
 * DB-layer defense-in-depth that catches a NON-Zod-validated UPDATE).
 *
 * Cleanup: each test resets touched dim columns to `'null'::jsonb` so a
 * later test's `<col>'->>'score'` cast does not encounter a populated value
 * from a sibling test.
 *
 * Run: `bash scripts/test.sh src/__tests__/migrations/0015-check-constraints.test.ts`
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from '../../db/connection.js';

// Shape of the PostgresError surfaced by postgres.js — code + constraint_name
// live directly on the thrown object (postgres.js does not wrap into a
// DrizzleQueryError when using `sql.unsafe`). Hoisted to module scope so
// every violation case shares one declaration.
type PgLikeError = {
  code?: string;
  message?: string;
  constraint_name?: string;
  cause?: { code?: string; message?: string; constraint_name?: string };
};

/**
 * Reset the three psychological seed rows' per-dim columns to `'null'::jsonb`
 * so each test starts from a known baseline. The 0013 seed inserts produce
 * rows with `name='primary'` and `substrate_hash=''`; the columns default to
 * `'null'::jsonb` but a prior test may have set them to a populated value.
 */
async function resetPsychSeedRows(): Promise<void> {
  await sql.unsafe(`
    UPDATE profile_hexaco
    SET honesty_humility='null'::jsonb,
        emotionality='null'::jsonb,
        extraversion='null'::jsonb,
        agreeableness='null'::jsonb,
        conscientiousness='null'::jsonb,
        openness='null'::jsonb
    WHERE name='primary';
  `);
  await sql.unsafe(`
    UPDATE profile_schwartz
    SET self_direction='null'::jsonb,
        stimulation='null'::jsonb,
        hedonism='null'::jsonb,
        achievement='null'::jsonb,
        power='null'::jsonb,
        security='null'::jsonb,
        conformity='null'::jsonb,
        tradition='null'::jsonb,
        benevolence='null'::jsonb,
        universalism='null'::jsonb
    WHERE name='primary';
  `);
  await sql.unsafe(`
    UPDATE profile_attachment
    SET anxious='null'::jsonb,
        avoidant='null'::jsonb,
        secure='null'::jsonb
    WHERE name='primary';
  `);
}

// ════════════════════════════════════════════════════════════════════════════

describe.sequential('migration 0015: psychological CHECK constraints', () => {
  beforeAll(async () => {
    // Verify migration 0015 has been applied — assert the constraints exist
    // via information_schema. Stronger than probing for a single named
    // constraint; catches "migration partially applied" lineage breaks.
    const rows = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM information_schema.check_constraints
      WHERE constraint_name LIKE 'profile_hexaco_%_bounds'
         OR constraint_name LIKE 'profile_schwartz_%_bounds'
         OR constraint_name LIKE 'profile_attachment_%_bounds'
    `;
    // 19 from 0015 + 3 overall_confidence (0013) + 3 data_consistency (0014) = 25.
    expect(Number(rows[0]?.count ?? 0)).toBeGreaterThanOrEqual(25);
  });

  beforeEach(async () => {
    await resetPsychSeedRows();
  });

  afterAll(async () => {
    await resetPsychSeedRows();
    await sql.end();
  });

  // ── 1. out-of-range HEXACO score (>5.0) ──────────────────────────────────
  it('rejects out-of-range HEXACO score (>5.0) with SQLSTATE 23514', async () => {
    let caughtErr: unknown;
    try {
      await sql.unsafe(`
        UPDATE profile_hexaco
        SET honesty_humility='{"score":5.5,"confidence":0.8,"last_updated":"2026-05-14T12:00:00Z"}'::jsonb
        WHERE name='primary';
      `);
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const e = caughtErr as PgLikeError;
    const pg = e.cause ?? e;
    expect(pg.code).toBe('23514');
    expect(pg.constraint_name).toBe('profile_hexaco_honesty_humility_bounds');
  });

  // ── 2. out-of-range HEXACO score (<1.0) ──────────────────────────────────
  it('rejects out-of-range HEXACO score (<1.0) with SQLSTATE 23514', async () => {
    let caughtErr: unknown;
    try {
      await sql.unsafe(`
        UPDATE profile_hexaco
        SET emotionality='{"score":0.5,"confidence":0.6,"last_updated":"2026-05-14T12:00:00Z"}'::jsonb
        WHERE name='primary';
      `);
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const e = caughtErr as PgLikeError;
    const pg = e.cause ?? e;
    expect(pg.code).toBe('23514');
    expect(pg.constraint_name).toBe('profile_hexaco_emotionality_bounds');
  });

  // ── 3. out-of-range Schwartz score (>7.0) ────────────────────────────────
  it('rejects out-of-range Schwartz score (>7.0) with SQLSTATE 23514', async () => {
    let caughtErr: unknown;
    try {
      await sql.unsafe(`
        UPDATE profile_schwartz
        SET self_direction='{"score":7.5,"confidence":0.6,"last_updated":"2026-05-14T12:00:00Z"}'::jsonb
        WHERE name='primary';
      `);
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const e = caughtErr as PgLikeError;
    const pg = e.cause ?? e;
    expect(pg.code).toBe('23514');
    expect(pg.constraint_name).toBe('profile_schwartz_self_direction_bounds');
  });

  // ── 4. out-of-range confidence (>1.0) on a per-dim Schwartz column ───────
  it('rejects out-of-range confidence (>1.0) with SQLSTATE 23514', async () => {
    let caughtErr: unknown;
    try {
      await sql.unsafe(`
        UPDATE profile_schwartz
        SET stimulation='{"score":3.0,"confidence":1.5,"last_updated":"2026-05-14T12:00:00Z"}'::jsonb
        WHERE name='primary';
      `);
    } catch (err) {
      caughtErr = err;
    }
    expect(caughtErr).toBeDefined();
    const e = caughtErr as PgLikeError;
    const pg = e.cause ?? e;
    expect(pg.code).toBe('23514');
    expect(pg.constraint_name).toBe('profile_schwartz_stimulation_bounds');
  });

  // ── 5. in-range HEXACO update succeeds + round-trips ─────────────────────
  it('accepts in-range HEXACO update and round-trips the jsonb shape', async () => {
    await sql.unsafe(`
      UPDATE profile_hexaco
      SET extraversion='{"score":4.2,"confidence":0.75,"last_updated":"2026-05-14T12:00:00Z"}'::jsonb
      WHERE name='primary';
    `);
    const rows = await sql<{ extraversion: { score: number; confidence: number } }[]>`
      SELECT extraversion FROM profile_hexaco WHERE name='primary'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.extraversion?.score).toBe(4.2);
    expect(rows[0]?.extraversion?.confidence).toBe(0.75);
  });

  // ── 6. null-literal jsonb still accepted ─────────────────────────────────
  it('accepts null-literal jsonb (preserves 0013 seed-default state)', async () => {
    // First populate the column with a valid payload, then reset to 'null'::jsonb.
    await sql.unsafe(`
      UPDATE profile_hexaco
      SET conscientiousness='{"score":3.0,"confidence":0.5,"last_updated":"2026-05-14T12:00:00Z"}'::jsonb
      WHERE name='primary';
    `);
    // Now write 'null'::jsonb — the OR-branch in the CHECK constraint must
    // allow this (preserves the cold-start "never inferred" state).
    await sql.unsafe(`
      UPDATE profile_hexaco
      SET conscientiousness='null'::jsonb
      WHERE name='primary';
    `);
    const rows = await sql<{ conscientiousness: unknown }[]>`
      SELECT conscientiousness FROM profile_hexaco WHERE name='primary'
    `;
    expect(rows).toHaveLength(1);
    // postgres.js parses 'null'::jsonb as JavaScript `null`.
    expect(rows[0]?.conscientiousness).toBeNull();
  });

  // ── 7. introspection — all 19 per-dim bounds constraints exist ───────────
  it('declares all 19 per-dim bounds constraints (6 HEXACO + 10 Schwartz + 3 attachment)', async () => {
    const rows = await sql<{ constraint_name: string }[]>`
      SELECT constraint_name FROM information_schema.check_constraints
      WHERE (constraint_name LIKE 'profile_hexaco_%_bounds'
          OR constraint_name LIKE 'profile_schwartz_%_bounds'
          OR constraint_name LIKE 'profile_attachment_%_bounds')
        AND constraint_name NOT LIKE '%overall_confidence_bounds'
        AND constraint_name NOT LIKE '%data_consistency_bounds'
      ORDER BY constraint_name
    `;
    expect(rows).toHaveLength(19);

    // Per-dim shape: profile_<table>_<dim>_bounds.
    for (const row of rows) {
      expect(row.constraint_name).toMatch(
        /^profile_(hexaco|schwartz|attachment)_[a-z_]+_bounds$/,
      );
    }

    const names = new Set(rows.map((r) => r.constraint_name));
    // Spot-check one from each table to catch any rename regression.
    expect(names.has('profile_hexaco_honesty_humility_bounds')).toBe(true);
    expect(names.has('profile_schwartz_self_direction_bounds')).toBe(true);
    expect(names.has('profile_attachment_anxious_bounds')).toBe(true);

    // Per-table counts (catches a typo that adds a constraint to the wrong table).
    const hexCount = rows.filter((r) =>
      r.constraint_name.startsWith('profile_hexaco_'),
    ).length;
    const schCount = rows.filter((r) =>
      r.constraint_name.startsWith('profile_schwartz_'),
    ).length;
    const attCount = rows.filter((r) =>
      r.constraint_name.startsWith('profile_attachment_'),
    ).length;
    expect(hexCount).toBe(6);
    expect(schCount).toBe(10);
    expect(attCount).toBe(3);
  });
});
