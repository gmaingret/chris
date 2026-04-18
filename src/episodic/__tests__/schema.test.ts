/**
 * Phase 20 Plan 03 — EPI-01 + EPI-02 + D-07 Docker Postgres integration tests.
 *
 * Covers:
 *   1. Happy-path insert — returns id (uuid) + createdAt (Date).
 *   2. UNIQUE(summary_date) violation — second insert on the same summary_date throws.
 *   3. DB CHECK violation — importance=11 throws (matches episodic_summaries_importance_bounds).
 *   4. Index presence — all three EPI-02 indexes land in pg_indexes on migration 0005.
 *
 * Requires: Docker Postgres with migration 0005 applied (via `bash scripts/test.sh`
 * which applies $MIGRATION_5_SQL after 0000..0004).
 *
 * Run: bash scripts/test.sh src/episodic/__tests__/schema.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db, sql } from '../../db/connection.js';
import { episodicSummaries } from '../../db/schema.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Valid uuid literal for source_entry_ids — avoids creating real pensieve rows. */
const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Build a summary string that meets the Zod min(50) floor (and gives DB inserts
 * a realistic payload, though the DB itself does not enforce length — that's
 * the Zod layer per CONTEXT.md D-08).
 */
function mkSummary(prefix = 'A day of focused work'): string {
  return `${prefix} — with notes about conversations, tasks, and reflections from the evening.`;
}

// ════════════════════════════════════════════════════════════════════════════

describe('episodic_summaries schema integration', () => {
  beforeAll(async () => {
    // Verify the table exists (proves migration 0005 applied).
    const result = await sql`SELECT 1 as ok FROM episodic_summaries LIMIT 0`;
    // Result may be [] (LIMIT 0) but the query must not throw — that's the proof.
    expect(Array.isArray(result)).toBe(true);
  });

  beforeEach(async () => {
    // Clean slate per test so UNIQUE(summary_date) from a prior test doesn't
    // poison the next one.
    await db.delete(episodicSummaries);
  });

  afterAll(async () => {
    await db.delete(episodicSummaries);
    await sql.end();
  });

  // ── 1. Happy-path insert ──────────────────────────────────────────────────
  it('inserts a valid row and returns id (uuid) + createdAt (Date)', async () => {
    const inserted = await db
      .insert(episodicSummaries)
      .values({
        summaryDate: '2026-04-15',
        summary: mkSummary(),
        importance: 5,
        topics: ['work', 'family'],
        emotionalArc: 'focused but tired',
        keyQuotes: ['I felt more settled today than I have in weeks.'],
        sourceEntryIds: [UUID_A],
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(inserted[0]!.createdAt).toBeInstanceOf(Date);
    // Round-trip sanity: content fields match what we sent.
    expect(inserted[0]!.importance).toBe(5);
    expect(inserted[0]!.topics).toEqual(['work', 'family']);
    expect(inserted[0]!.summaryDate).toBe('2026-04-15');
  });

  // ── 2. UNIQUE(summary_date) violation ─────────────────────────────────────
  it('rejects a second insert on the same summary_date (UNIQUE violation)', async () => {
    // Seed one row.
    await db.insert(episodicSummaries).values({
      summaryDate: '2026-04-16',
      summary: mkSummary('Day one'),
      importance: 3,
      topics: ['routine'],
      emotionalArc: 'steady',
      keyQuotes: [],
      sourceEntryIds: [UUID_A],
    });

    // Second insert on the SAME summary_date but different content.
    // Capture the error once — Drizzle QueryPromises are not designed to be awaited twice.
    let caughtErr: unknown;
    try {
      await db.insert(episodicSummaries).values({
        summaryDate: '2026-04-16',
        summary: mkSummary('Day two (should fail)'),
        importance: 7,
        topics: ['different'],
        emotionalArc: 'different',
        keyQuotes: [],
        sourceEntryIds: [UUID_B],
      });
    } catch (err) {
      caughtErr = err;
    }

    // The insert must reject — named UNIQUE constraint (D-10) OR Postgres unique_violation code 23505.
    // Drizzle wraps the PostgresError as `DrizzleQueryError`; the pg code + constraint_name
    // live on `.cause` (PostgresError). `.cause.message` contains the constraint name.
    expect(caughtErr).toBeDefined();
    type PgLikeError = {
      code?: string;
      message?: string;
      constraint_name?: string;
      cause?: { code?: string; message?: string; constraint_name?: string };
    };
    const e = caughtErr as PgLikeError;
    const pg = e.cause ?? e;
    expect(pg.code).toBe('23505'); // Postgres unique_violation
    expect(pg.constraint_name).toBe('episodic_summaries_summary_date_unique');
    expect(pg.message ?? '').toContain('episodic_summaries_summary_date_unique');
  });

  // ── 3. CHECK (importance BETWEEN 1 AND 10) violation ──────────────────────
  it('rejects importance=11 (DB CHECK episodic_summaries_importance_bounds)', async () => {
    // Use a distinct summary_date to prove this is a CHECK violation, not UNIQUE.
    // Capture the error once — Drizzle QueryPromises are not designed to be awaited twice.
    let caughtErr: unknown;
    try {
      await db.insert(episodicSummaries).values({
        summaryDate: '2026-04-17',
        summary: mkSummary('Importance out of range'),
        importance: 11,
        topics: ['probe'],
        emotionalArc: 'n/a',
        keyQuotes: [],
        sourceEntryIds: [UUID_A],
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeDefined();
    type PgLikeError = {
      code?: string;
      message?: string;
      constraint_name?: string;
      cause?: { code?: string; message?: string; constraint_name?: string };
    };
    const e = caughtErr as PgLikeError;
    const pg = e.cause ?? e;
    expect(pg.code).toBe('23514'); // Postgres check_violation
    expect(pg.constraint_name).toBe('episodic_summaries_importance_bounds');
    expect(pg.message ?? '').toContain('episodic_summaries_importance_bounds');
  });

  // ── 4. All three EPI-02 indexes exist in pg_indexes ───────────────────────
  it('has all three expected indexes in pg_indexes after migration 0005', async () => {
    // Raw pg_indexes query — authoritative proof the indexes shipped in
    // migration 0005 (non-retrofitted per EPI-02).
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'episodic_summaries'
      ORDER BY indexname
    `;

    const indexNames = rows.map((r) => r.indexname);

    // The three EPI-02 index names per CONTEXT.md D-10 / Plan 20-02 migration 0005 SQL.
    const expected = [
      'episodic_summaries_importance_idx',
      'episodic_summaries_summary_date_unique',
      'episodic_summaries_topics_idx',
    ];
    for (const name of expected) {
      expect(indexNames).toContain(name);
    }
  });
});
