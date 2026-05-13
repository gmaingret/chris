/**
 * Phase 37 Plan 37-02 Task 6 (PSCH-07 + PSCH-08)
 *
 * Real Docker Postgres integration tests for loadPsychologicalSubstrate.
 * No mocked db.select chain (per RESEARCH.md OQ-5 recommendation: tag-filter
 * + RITUAL_RESPONSE + Luxon-boundary correctness requires the actual SQL
 * engine to verify the SQL is built right).
 *
 * Coverage:
 *   - Source-filter correctness (PSCH-07; Pitfall 3 mitigation): SQL WHERE
 *     source='telegram' AND epistemic_tag != 'RITUAL_RESPONSE' provably
 *     excludes Gmail rows and prompted-ritual-response rows.
 *   - Below-threshold branch (PSCH-08): 4800-word substrate returns
 *     { belowThreshold: true, wordCount: 4800, neededWords: 200 }.
 *   - Above-threshold branch (PSCH-08): 5200-word substrate returns
 *     { belowThreshold: false, corpus, episodicSummaries, wordCount: 5200,
 *       prevHistorySnapshot: null }.
 *   - Word-count accuracy (PSCH-08; Pitfall 2 mitigation): inline whitespace
 *     split counts words, NOT tokens. Russian-text 4500-word fixture stays
 *     below threshold (would be ~10000 tokens under cl100k_base — would
 *     incorrectly cross gate if using countTokens).
 *   - Calendar-month boundary (DST-safe): Luxon Europe/Paris boundaries
 *     correctly include May rows and exclude April-end + June-start rows.
 *   - prevHistorySnapshot lookup: profile_history row with
 *     profileTableName='profile_hexaco' surfaces in above-threshold branch.
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/psychological-shared.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, sql as pgSql } from '../../../db/connection.js';
import {
  pensieveEntries,
  episodicSummaries,
  profileHistory,
} from '../../../db/schema.js';
import { loadPsychologicalSubstrate } from '../psychological-shared.js';

// ── Test fixtures ───────────────────────────────────────────────────────

// Anchor a deterministic NOW. Previous calendar month (Europe/Paris) is May
// 2026 (Paris in CEST = UTC+2 throughout May). Verified via Luxon:
//   windowStart = 2026-04-30T22:00:00Z UTC
//   windowEnd   = 2026-05-31T21:59:59.999Z UTC
const PINNED_NOW = new Date('2026-06-15T12:00:00Z');

// A clearly in-window May-2026 timestamp in Paris (mid-month).
const IN_WINDOW_MAY = new Date('2026-05-15T10:00:00Z');

// Boundary timestamps for the calendar-month test:
//   2026-05-01 00:00 Paris (CEST) = 2026-04-30T22:00:00Z UTC — INCLUDED
//   2026-05-31 23:59 Paris (CEST) = 2026-05-31T21:59:00Z UTC — INCLUDED
//   2026-04-30 23:59 Paris (CEST) = 2026-04-30T21:59:00Z UTC — EXCLUDED
//   2026-06-01 00:00 Paris (CEST) = 2026-05-31T22:00:00Z UTC — EXCLUDED
const MAY_START_PARIS = new Date('2026-04-30T22:00:00Z');
const MAY_END_PARIS = new Date('2026-05-31T21:59:00Z');
const APRIL_END_PARIS = new Date('2026-04-30T21:59:00Z');
const JUNE_START_PARIS = new Date('2026-05-31T22:00:00Z');

async function cleanupTables() {
  // M011 substrate loader reads pensieve_entries, episodic_summaries, AND
  // profile_history. All three must be truncated between tests.
  await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE profile_history CASCADE`);
}

beforeAll(async () => {
  await pgSql`SELECT 1 as ok`;
});

beforeEach(async () => {
  await cleanupTables();
});

afterAll(async () => {
  await cleanupTables();
});

// ── Source-filter correctness (PSCH-07; Pitfall 3 mitigation) ───────────

describe('loadPsychologicalSubstrate — source filter correctness (PSCH-07; Pitfall 3 mitigation)', () => {
  it('returns only telegram + non-RITUAL_RESPONSE rows; excludes gmail + RITUAL_RESPONSE', async () => {
    // Each row carries 6000 words so any single row crosses the 5000 gate
    // — the assertion below is therefore that the corpus contains ONLY the
    // telegram-non-RITUAL row, not all three.
    const sixThousandWords = ('word '.repeat(6000)).trim();

    // (a) source=telegram, epistemic_tag=null — should be INCLUDED
    await db.insert(pensieveEntries).values({
      content: sixThousandWords,
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    // (b) source=gmail, epistemic_tag=null — should be EXCLUDED (source filter)
    await db.insert(pensieveEntries).values({
      content: sixThousandWords,
      epistemicTag: null,
      source: 'gmail',
      createdAt: IN_WINDOW_MAY,
    });

    // (c) source=telegram, epistemic_tag='RITUAL_RESPONSE' — should be
    //     EXCLUDED (prompted-response filter)
    await db.insert(pensieveEntries).values({
      content: sixThousandWords,
      epistemicTag: 'RITUAL_RESPONSE',
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);

    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return; // type-narrow for TS
    expect(substrate.corpus).toHaveLength(1);
    expect(substrate.corpus[0]!.source).toBe('telegram');
    expect(substrate.corpus[0]!.epistemicTag).not.toBe('RITUAL_RESPONSE');
  });

  it('telegram + epistemic_tag=FACT (non-RITUAL) included (non-null tag accepted)', async () => {
    const sixThousandWords = ('word '.repeat(6000)).trim();
    await db.insert(pensieveEntries).values({
      content: sixThousandWords,
      epistemicTag: 'FACT',
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    expect(substrate.corpus).toHaveLength(1);
    expect(substrate.corpus[0]!.epistemicTag).toBe('FACT');
  });
});

// ── Below-threshold branch (PSCH-08) ────────────────────────────────────

describe('loadPsychologicalSubstrate — below-threshold branch (PSCH-08)', () => {
  it('4800 telegram words → belowThreshold:true, wordCount:4800, neededWords:200', async () => {
    const fourEightHundred = ('word '.repeat(4800)).trim();
    await db.insert(pensieveEntries).values({
      content: fourEightHundred,
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);

    expect(substrate.belowThreshold).toBe(true);
    if (!substrate.belowThreshold) return;
    expect(substrate.wordCount).toBe(4800);
    expect(substrate.neededWords).toBe(200);
  });

  it('zero rows → belowThreshold:true, wordCount:0, neededWords:5000', async () => {
    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(true);
    if (!substrate.belowThreshold) return;
    expect(substrate.wordCount).toBe(0);
    expect(substrate.neededWords).toBe(5000);
  });
});

// ── Above-threshold branch (PSCH-08) ────────────────────────────────────

describe('loadPsychologicalSubstrate — above-threshold branch (PSCH-08)', () => {
  it('5200 telegram words → belowThreshold:false, corpus populated, prevHistorySnapshot null', async () => {
    const fiveTwoHundred = ('word '.repeat(5200)).trim();
    await db.insert(pensieveEntries).values({
      content: fiveTwoHundred,
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);

    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    expect(substrate.wordCount).toBe(5200);
    expect(substrate.corpus.length).toBeGreaterThan(0);
    expect(substrate.prevHistorySnapshot).toBeNull();
    // episodicSummaries array always present even if empty
    expect(Array.isArray(substrate.episodicSummaries)).toBe(true);
  });

  it('wordCount === MIN_SPEECH_WORDS (5000) → above-threshold (lt→lte semantics; M009 lesson)', async () => {
    const exactlyFiveK = ('word '.repeat(5000)).trim();
    await db.insert(pensieveEntries).values({
      content: exactlyFiveK,
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);

    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    expect(substrate.wordCount).toBe(5000);
  });
});

// ── Word-count accuracy (PSCH-08; Pitfall 2 mitigation) ─────────────────

describe('loadPsychologicalSubstrate — word-count accuracy (PSCH-08; Pitfall 2 mitigation)', () => {
  it('English 5001-word row → wordCount 5001 exactly (whitespace-split)', async () => {
    const content5001 = ('word '.repeat(5001)).trim();
    await db.insert(pensieveEntries).values({
      content: content5001,
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    expect(substrate.wordCount).toBe(5001);
  });

  it('Russian 4500-word row → wordCount 4500, belowThreshold:true (NOT biased by token inflation)', async () => {
    // Cyrillic 'слово' counts as 1 word here (whitespace-delimited). Under
    // cl100k_base it would count as ~2-3 tokens — using messages.countTokens
    // would incorrectly push this 4500-word substrate above the 5000-word
    // gate. The whitespace-based gate is Cyrillic-fair.
    const russian4500 = ('слово '.repeat(4500)).trim();
    await db.insert(pensieveEntries).values({
      content: russian4500,
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(true);
    if (!substrate.belowThreshold) return;
    expect(substrate.wordCount).toBe(4500);
    expect(substrate.neededWords).toBe(500);
  });

  it('multiple rows summed correctly (3000 + 2200 = 5200 → above)', async () => {
    await db.insert(pensieveEntries).values({
      content: ('word '.repeat(3000)).trim(),
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });
    await db.insert(pensieveEntries).values({
      content: ('word '.repeat(2200)).trim(),
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    expect(substrate.wordCount).toBe(5200);
    expect(substrate.corpus).toHaveLength(2);
  });
});

// ── Calendar-month boundary (Luxon DST-safe) ────────────────────────────

describe('loadPsychologicalSubstrate — calendar-month boundary (Luxon Europe/Paris, DST-safe)', () => {
  it('includes May 1 00:00 Paris and May 31 23:59 Paris; excludes April 30 23:59 Paris and June 1 00:00 Paris', async () => {
    // Each row carries 3000 words → two rows in window = 6000 words (above);
    // one row in window = 3000 words (below).
    const threeKWords = ('word '.repeat(3000)).trim();

    // INCLUDED
    await db.insert(pensieveEntries).values({
      content: threeKWords,
      epistemicTag: null,
      source: 'telegram',
      createdAt: MAY_START_PARIS,
    });
    await db.insert(pensieveEntries).values({
      content: threeKWords,
      epistemicTag: null,
      source: 'telegram',
      createdAt: MAY_END_PARIS,
    });

    // EXCLUDED
    await db.insert(pensieveEntries).values({
      content: threeKWords,
      epistemicTag: null,
      source: 'telegram',
      createdAt: APRIL_END_PARIS,
    });
    await db.insert(pensieveEntries).values({
      content: threeKWords,
      epistemicTag: null,
      source: 'telegram',
      createdAt: JUNE_START_PARIS,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    expect(substrate.corpus).toHaveLength(2);
    // Both in-window rows present
    const dates = substrate.corpus.map((r) => r.createdAt?.toISOString()).sort();
    expect(dates).toEqual([
      MAY_START_PARIS.toISOString(),
      MAY_END_PARIS.toISOString(),
    ]);
  });
});

// ── prevHistorySnapshot lookup ──────────────────────────────────────────

describe('loadPsychologicalSubstrate — prevHistorySnapshot lookup', () => {
  it('returns most recent profile_history snapshot for matching profileTableName', async () => {
    // Push above the threshold so we reach the above-threshold branch.
    const fiveTwoHundred = ('word '.repeat(5200)).trim();
    await db.insert(pensieveEntries).values({
      content: fiveTwoHundred,
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    // Insert two history rows for profile_hexaco — older + newer; loader
    // must return the newer one (orderBy desc(recordedAt) limit 1).
    await db.insert(profileHistory).values({
      profileTableName: 'profile_hexaco',
      profileId: '11111111-1111-1111-1111-111111111111',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshot: { stage: 'older' } as any,
      recordedAt: new Date('2026-04-01T00:00:00Z'),
    });
    await db.insert(profileHistory).values({
      profileTableName: 'profile_hexaco',
      profileId: '11111111-1111-1111-1111-111111111111',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshot: { stage: 'newer' } as any,
      recordedAt: new Date('2026-05-15T00:00:00Z'),
    });

    // Insert an unrelated row for profile_schwartz to confirm filter
    // narrows on profileTableName.
    await db.insert(profileHistory).values({
      profileTableName: 'profile_schwartz',
      profileId: '22222222-2222-2222-2222-222222222222',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      snapshot: { stage: 'schwartz-noise' } as any,
      recordedAt: new Date('2026-06-01T00:00:00Z'),
    });

    type HistorySnapshot = { stage: string };
    const substrate = await loadPsychologicalSubstrate<HistorySnapshot>(
      'hexaco',
      PINNED_NOW,
    );

    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    expect(substrate.prevHistorySnapshot).toEqual({ stage: 'newer' });
  });

  it('returns null when no profile_history row exists for profile type', async () => {
    const fiveTwoHundred = ('word '.repeat(5200)).trim();
    await db.insert(pensieveEntries).values({
      content: fiveTwoHundred,
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(false);
    if (substrate.belowThreshold) return;
    expect(substrate.prevHistorySnapshot).toBeNull();
  });
});

// ── Deleted-at filter ────────────────────────────────────────────────────

describe('loadPsychologicalSubstrate — soft-deleted entries excluded', () => {
  it('rows with deletedAt set are not counted', async () => {
    const fiveTwoHundred = ('word '.repeat(5200)).trim();
    // Soft-deleted: large content, BUT deletedAt set → excluded.
    await db.insert(pensieveEntries).values({
      content: fiveTwoHundred,
      epistemicTag: null,
      source: 'telegram',
      createdAt: IN_WINDOW_MAY,
      deletedAt: new Date('2026-05-20T00:00:00Z'),
    });

    const substrate = await loadPsychologicalSubstrate('hexaco', PINNED_NOW);
    expect(substrate.belowThreshold).toBe(true);
    if (!substrate.belowThreshold) return;
    expect(substrate.wordCount).toBe(0);
  });
});
