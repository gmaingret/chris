/**
 * src/pensieve/__tests__/retrieve.episodic.test.ts — Phase 22 Plan 01 Task 2
 *
 * Docker-Postgres integration tests for the two episodic-summary read helpers
 * added in `src/pensieve/retrieve.ts` (RETR-01):
 *   - getEpisodicSummary(date)
 *   - getEpisodicSummariesRange(from, to)
 *
 * Sibling unit tests in `retrieve.test.ts` mock the DB / config / logger and
 * cover `searchPensieve`, `hybridSearch`, and the mode-search presets. That
 * file's mocks would conflict with the real-DB inserts here (vi.mock is
 * hoisted), so the integration tests live in this separate file — mirroring
 * the split between `episodic/__tests__/schema.test.ts` (real DB) and the
 * mocked unit tests under each module.
 *
 * Coverage (7 tests):
 *   1. getEpisodicSummary — happy path: returns the row whose summary_date
 *      matches the input Date in config.proactiveTimezone.
 *   2. getEpisodicSummary — returns null when no row exists for the date.
 *   3. getEpisodicSummary — timezone boundary: 22:30Z on day N resolves to
 *      day N+1 in Europe/Paris (CEST UTC+2). Asserts tz conversion is live.
 *   4. getEpisodicSummariesRange — returns rows in inclusive [from, to]
 *      ordered by summary_date ASC.
 *   5. getEpisodicSummariesRange — returns [] when no rows are in range.
 *   6. getEpisodicSummariesRange — boundary inclusivity: rows on the
 *      from-day and to-day are both included.
 *   7. getEpisodicSummariesRange — excludes rows outside the range
 *      (one earlier, one later).
 *
 * Error-path coverage (returns null/[] and logs warn on DB throw) is in the
 * sibling `retrieve.test.ts` file under `describe('episodic helpers — error
 * paths')` because that file already has the mocked-db spy infrastructure.
 *
 * Test environment uses `config.proactiveTimezone = 'Europe/Paris'` (the
 * default per src/config.ts line 40 — `process.env.PROACTIVE_TIMEZONE` is
 * unset in scripts/test.sh, so the default applies).
 *
 * Real Postgres (D018 — no skipped tests). Run via:
 *   bash scripts/test.sh
 *   # or, for this file in isolation against a running Docker DB:
 *   DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris \
 *     ANTHROPIC_API_KEY=test-key TELEGRAM_BOT_TOKEN=test-token \
 *     TELEGRAM_AUTHORIZED_USER_ID=99999 \
 *     npx vitest run src/pensieve/__tests__/retrieve.episodic.test.ts
 *
 * vitest.config.ts has fileParallelism: false, so per-test deletes are safe.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db, sql as pgSql } from '../../db/connection.js';
import { episodicSummaries } from '../../db/schema.js';
import { config } from '../../config.js';
import {
  getEpisodicSummary,
  getEpisodicSummariesRange,
} from '../retrieve.js';

// ── Fixture helpers ─────────────────────────────────────────────────────────

/**
 * Build a summary string with enough body to be realistic. The DB does not
 * enforce length (Zod EpisodicSummaryInsertSchema does at the write layer
 * per CONTEXT.md D-08); we still pad to keep fixtures readable.
 */
function mkSummary(prefix: string): string {
  return `${prefix} — with notes about conversations, tasks, and reflections from the day.`;
}

// ════════════════════════════════════════════════════════════════════════════

describe('getEpisodicSummary — Docker integration', () => {
  beforeAll(async () => {
    // Sanity: table exists (proves migration 0005 applied).
    const probe = await pgSql`SELECT 1 as ok FROM episodic_summaries LIMIT 0`;
    expect(Array.isArray(probe)).toBe(true);
    // Sanity: tz constant matches what the tests assume.
    expect(config.proactiveTimezone).toBe('Europe/Paris');
  });

  beforeEach(async () => {
    await db.delete(episodicSummaries);
  });

  afterAll(async () => {
    await db.delete(episodicSummaries);
  });

  it('returns the row matching summaryDate in config.proactiveTimezone', async () => {
    await db.insert(episodicSummaries).values({
      summaryDate: '2026-04-15',
      summary: mkSummary('Test summary for April 15'),
      importance: 5,
      topics: ['work'],
      emotionalArc: 'focused',
      keyQuotes: [],
      sourceEntryIds: [],
    });

    // Europe/Paris (CEST = UTC+2 in April). 2026-04-15T10:00:00Z = 12:00 Paris,
    // which is squarely inside the 2026-04-15 calendar day.
    const row = await getEpisodicSummary(new Date('2026-04-15T10:00:00Z'));

    expect(row).not.toBeNull();
    expect(row?.summaryDate).toBe('2026-04-15');
    expect(row?.importance).toBe(5);
    expect(row?.topics).toEqual(['work']);
    expect(row?.emotionalArc).toBe('focused');
  });

  it('returns null when no row exists for the date', async () => {
    // Empty table (truncated in beforeEach) — query must return null.
    const row = await getEpisodicSummary(new Date('2026-04-15T10:00:00Z'));
    expect(row).toBeNull();
  });

  it('resolves date using config.proactiveTimezone (Europe/Paris), NOT UTC', async () => {
    // Timezone boundary regression test (T-22-03 mitigation):
    // Insert a row tagged 2026-04-16. Look it up using a Date instant that
    // is still 2026-04-15 in UTC but 2026-04-16 in Paris.
    await db.insert(episodicSummaries).values({
      summaryDate: '2026-04-16',
      summary: mkSummary('April 16 summary — late evening entry from Paris pov'),
      importance: 4,
      topics: ['test'],
      emotionalArc: 'tired',
      keyQuotes: [],
      sourceEntryIds: [],
    });

    // 2026-04-15T22:30:00Z = 2026-04-16 00:30 Paris (CEST, UTC+2).
    // If the helper used UTC instead of config.proactiveTimezone, it would
    // look up '2026-04-15' and find nothing — the assertion below would fail.
    const row = await getEpisodicSummary(new Date('2026-04-15T22:30:00Z'));

    expect(row).not.toBeNull();
    expect(row?.summaryDate).toBe('2026-04-16');
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('getEpisodicSummariesRange — Docker integration', () => {
  beforeAll(async () => {
    expect(config.proactiveTimezone).toBe('Europe/Paris');
  });

  beforeEach(async () => {
    await db.delete(episodicSummaries);
  });

  afterAll(async () => {
    await db.delete(episodicSummaries);
  });

  it('returns rows in the inclusive range, ordered by summaryDate ASC', async () => {
    // Seed four rows; intentionally insert out-of-order so the ASC ordering
    // assertion is meaningful (insertion order != return order).
    for (const d of ['2026-04-20', '2026-04-10', '2026-04-15', '2026-04-12']) {
      await db.insert(episodicSummaries).values({
        summaryDate: d,
        summary: mkSummary(`Summary for ${d}`),
        importance: 3,
        topics: ['daily'],
        emotionalArc: 'neutral',
        keyQuotes: [],
        sourceEntryIds: [],
      });
    }

    // Range covers three of the four rows (10, 12, 15) in Paris tz.
    const rows = await getEpisodicSummariesRange(
      new Date('2026-04-10T10:00:00Z'),
      new Date('2026-04-15T10:00:00Z'),
    );

    expect(rows.map((r) => r.summaryDate)).toEqual([
      '2026-04-10',
      '2026-04-12',
      '2026-04-15',
    ]);
  });

  it('returns [] when no rows are in the range', async () => {
    // Seed a row OUTSIDE the query range to ensure we're not just observing
    // an empty table.
    await db.insert(episodicSummaries).values({
      summaryDate: '2026-05-01',
      summary: mkSummary('Outside-range row'),
      importance: 3,
      topics: ['probe'],
      emotionalArc: 'neutral',
      keyQuotes: [],
      sourceEntryIds: [],
    });

    const rows = await getEpisodicSummariesRange(
      new Date('2026-04-10T10:00:00Z'),
      new Date('2026-04-15T10:00:00Z'),
    );

    expect(rows).toEqual([]);
  });

  it('includes rows on the from-day and to-day boundaries (inclusive)', async () => {
    // Seed rows precisely on both range boundaries plus one in the middle.
    for (const d of ['2026-04-10', '2026-04-12', '2026-04-15']) {
      await db.insert(episodicSummaries).values({
        summaryDate: d,
        summary: mkSummary(`Boundary test ${d}`),
        importance: 5,
        topics: ['boundary'],
        emotionalArc: 'steady',
        keyQuotes: [],
        sourceEntryIds: [],
      });
    }

    const rows = await getEpisodicSummariesRange(
      new Date('2026-04-10T10:00:00Z'),
      new Date('2026-04-15T10:00:00Z'),
    );

    // All three rows must be present — both boundary days included.
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.summaryDate)).toEqual([
      '2026-04-10',
      '2026-04-12',
      '2026-04-15',
    ]);
  });

  it('excludes rows outside the range (earlier and later)', async () => {
    // One row just before the range, one inside, one just after.
    for (const d of ['2026-04-09', '2026-04-12', '2026-04-16']) {
      await db.insert(episodicSummaries).values({
        summaryDate: d,
        summary: mkSummary(`Exclusion probe ${d}`),
        importance: 4,
        topics: ['probe'],
        emotionalArc: 'neutral',
        keyQuotes: [],
        sourceEntryIds: [],
      });
    }

    const rows = await getEpisodicSummariesRange(
      new Date('2026-04-10T10:00:00Z'),
      new Date('2026-04-15T10:00:00Z'),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.summaryDate).toBe('2026-04-12');
  });
});
