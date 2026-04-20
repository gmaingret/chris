/**
 * src/__tests__/fixtures/primed-sanity.test.ts — Phase 24 Plan 04 (HARN-03).
 *
 * Sanity gate for the primed-fixture pipeline: loads the `m008-14days`
 * fixture via `loadPrimedFixture` and asserts the four HARN-03
 * invariants against the Docker Postgres test DB:
 *
 *   1. ≥ 7 episodic summaries
 *   2. ≥ 200 pensieve entries
 *   3. UNIQUE(summary_date) holds — no duplicate days
 *   4. No non-telegram source leakage (immich/gmail/drive absent)
 *
 * When the fixture is absent (e.g. sandbox/CI without prod access, or
 * before an operator has run `scripts/regenerate-primed.ts`), the test
 * describe.skip's with a clear regeneration hint. Otherwise runs in the
 * normal `bash scripts/test.sh` gate — NOT in the excluded-suite list.
 *
 * Fixture expectations (HARN-03 locked constants):
 *   - ≥ 7 synthetic days + organic baseline
 *   - ~10 entries/day × 14 days + organic ≈ 140–200+ entries
 *   - UNIQUE(summary_date) enforced by migration 0005 `episodic_summaries_summary_date_unique`
 *   - source filter: fetch-prod-data.ts scopes pensieve_entries to
 *     source='telegram' (M008.1) — no immich/gmail/drive rows should
 *     appear in a primed fixture
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { sql as drizzleSql } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { episodicSummaries, pensieveEntries } from '../../db/schema.js';
import { loadPrimedFixture } from './load-primed.js';

const FIXTURE_NAME = 'm008-14days';
const FIXTURE_PATH = `tests/fixtures/primed/${FIXTURE_NAME}/MANIFEST.json`;
const FIXTURE_PRESENT = existsSync(FIXTURE_PATH);

const MIN_EPISODIC_SUMMARIES = 7;
const MIN_PENSIEVE_ENTRIES = 200;
const FORBIDDEN_SOURCES = ['immich', 'gmail', 'drive'] as const;

const skipIfAbsent = FIXTURE_PRESENT ? describe : describe.skip;

if (!FIXTURE_PRESENT) {
  // eslint-disable-next-line no-console
  console.log(
    `[primed-sanity] SKIP: ${FIXTURE_PATH} not found. Regenerate with:\n` +
      `  npx tsx scripts/regenerate-primed.ts --milestone m008 --target-days 14 --seed 42 --force`,
  );
}

skipIfAbsent('primed-sanity: m008-14days fixture (HARN-03)', () => {
  beforeAll(async () => {
    await loadPrimedFixture(FIXTURE_NAME);
  });

  it(`has >= ${MIN_EPISODIC_SUMMARIES} episodic summaries`, async () => {
    const [row] = await db
      .select({ n: drizzleSql<number>`count(*)::int` })
      .from(episodicSummaries);
    expect(row?.n ?? 0).toBeGreaterThanOrEqual(MIN_EPISODIC_SUMMARIES);
  });

  it(`has >= ${MIN_PENSIEVE_ENTRIES} pensieve entries`, async () => {
    const [row] = await db
      .select({ n: drizzleSql<number>`count(*)::int` })
      .from(pensieveEntries);
    expect(row?.n ?? 0).toBeGreaterThanOrEqual(MIN_PENSIEVE_ENTRIES);
  });

  it('UNIQUE(summary_date) holds (no duplicate days)', async () => {
    const rows = await db.execute<{ summary_date: string; c: number }>(
      drizzleSql`SELECT summary_date, COUNT(*)::int AS c FROM episodic_summaries GROUP BY summary_date HAVING COUNT(*) > 1`,
    );
    // drizzle-orm execute returns an array-like of rows (different shapes
    // across backends). Normalize to array length for the assertion.
    const count = Array.isArray(rows)
      ? rows.length
      : (rows as { length?: number }).length ?? 0;
    expect(count).toBe(0);
  });

  it('has no non-telegram source leakage (immich/gmail/drive absent)', async () => {
    const forbidden = FORBIDDEN_SOURCES.map((s) => `'${s}'`).join(', ');
    const rows = await db.execute<{ n: number }>(
      drizzleSql.raw(
        `SELECT COUNT(*)::int AS n FROM pensieve_entries WHERE source IN (${forbidden})`,
      ),
    );
    const first = Array.isArray(rows) ? rows[0] : (rows as { 0?: unknown })[0];
    const n = (first as { n?: number } | undefined)?.n ?? 0;
    expect(n).toBe(0);
  });
});
