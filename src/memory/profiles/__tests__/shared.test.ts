/**
 * src/memory/profiles/__tests__/shared.test.ts — Phase 34 Plan 02 Task 5
 *
 * Real-DB integration tests for `loadProfileSubstrate` + pure-function tests
 * for `computeSubstrateHash`. Mirrors src/rituals/__tests__/weekly-review-sources.test.ts
 * (Docker postgres setup) per 34-PATTERNS.md §`src/memory/profiles/__tests__/shared.test.ts`.
 *
 * Coverage:
 *   - Tag-filter correctness — only FACT/RELATIONSHIP/INTENTION/EXPERIENCE entries
 *     (the 4 substrate-bearing tags) are loaded; other tags filtered out (D-13)
 *   - 60-day rolling window — entries before now-60d are excluded; after-now
 *     excluded (D-13)
 *   - entryCount = pensieveEntries.length (D-20)
 *   - Decisions filter — status='resolved' only; resolved-outside-window excluded
 *   - computeSubstrateHash determinism — same input → same hash (D-15)
 *   - computeSubstrateHash content-insensitivity — different content with same IDs
 *     → SAME hash (Cycle-3 silent-skip gotcha codified; RESEARCH.md residual risk)
 *   - computeSubstrateHash schemaVersion sensitivity — D-16 cache-bust
 *   - deletedAt filter — soft-deleted entries excluded
 *
 * Run via Docker harness:
 *   bash scripts/test.sh src/memory/profiles/__tests__/shared.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, sql as pgSql } from '../../../db/connection.js';
import {
  pensieveEntries,
  episodicSummaries,
  decisions,
} from '../../../db/schema.js';
import {
  loadProfileSubstrate,
  computeSubstrateHash,
  PROFILE_SUBSTRATE_TAGS,
  SUBSTRATE_WINDOW_DAYS,
  type ProfileSubstrate,
} from '../shared.js';

// ── Fixture builder helpers ─────────────────────────────────────────────────

async function cleanupTables() {
  // Use TRUNCATE CASCADE per the canonical project pattern in
  // src/episodic/__tests__/consolidate.test.ts:211-225 — robust against
  // sibling-test leftover rows in ritual_responses, contradictions,
  // decision_events, pensieve_embeddings, etc.
  await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE decision_events CASCADE`);
  await db.execute(sql`TRUNCATE TABLE decisions CASCADE`);
}

const FUTURE_RESOLVE_BY = new Date('2027-12-31T00:00:00Z');

// ── Unit tests for computeSubstrateHash (no DB) ─────────────────────────────

describe('computeSubstrateHash — pure-function determinism (D-15, D-16)', () => {
  // Empty-substrate fixture
  const emptySubstrate: ProfileSubstrate = {
    pensieveEntries: [],
    episodicSummaries: [],
    decisions: [],
    entryCount: 0,
  };

  it('produces a 64-char hex string (SHA-256)', () => {
    const h = computeSubstrateHash(emptySubstrate, { substrate_hash: '', schema_version: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('determinism: same input → same hash on repeated calls', () => {
    const meta = { substrate_hash: '', schema_version: 1 };
    const h1 = computeSubstrateHash(emptySubstrate, meta);
    const h2 = computeSubstrateHash(emptySubstrate, meta);
    expect(h1).toBe(h2);
  });

  it('different pensieveIds set → different hash', () => {
    const subA: ProfileSubstrate = {
      ...emptySubstrate,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pensieveEntries: [{ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' } as any],
      entryCount: 1,
    };
    const subB: ProfileSubstrate = {
      ...emptySubstrate,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pensieveEntries: [{ id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' } as any],
      entryCount: 1,
    };
    const meta = { substrate_hash: '', schema_version: 1 };
    expect(computeSubstrateHash(subA, meta)).not.toBe(computeSubstrateHash(subB, meta));
  });

  it('CONTENT INSENSITIVITY: same pensieveIds with DIFFERENT content → SAME hash (Cycle-3 silent-skip codified; RESEARCH.md residual risk 931-935)', () => {
    const subA: ProfileSubstrate = {
      ...emptySubstrate,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pensieveEntries: [{ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', content: 'original text' } as any],
      entryCount: 1,
    };
    const subB: ProfileSubstrate = {
      ...emptySubstrate,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pensieveEntries: [{ id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', content: 'TOTALLY DIFFERENT TEXT' } as any],
      entryCount: 1,
    };
    const meta = { substrate_hash: '', schema_version: 1 };
    expect(computeSubstrateHash(subA, meta)).toBe(computeSubstrateHash(subB, meta));
  });

  it('different schema_version in prevStateMeta → different hash (D-16 cache-bust)', () => {
    const h1 = computeSubstrateHash(emptySubstrate, { substrate_hash: '', schema_version: 1 });
    const h2 = computeSubstrateHash(emptySubstrate, { substrate_hash: '', schema_version: 2 });
    expect(h1).not.toBe(h2);
  });

  it('order-insensitivity: pensieveEntries returned in different order produce same hash (D-15 sorts pensieveIds)', () => {
    const ids = [
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    ];
    const subA: ProfileSubstrate = {
      ...emptySubstrate,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pensieveEntries: ids.map((id) => ({ id } as any)),
      entryCount: 3,
    };
    const subB: ProfileSubstrate = {
      ...emptySubstrate,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pensieveEntries: [...ids].reverse().map((id) => ({ id } as any)),
      entryCount: 3,
    };
    const meta = { substrate_hash: '', schema_version: 1 };
    expect(computeSubstrateHash(subA, meta)).toBe(computeSubstrateHash(subB, meta));
  });

  it('seed-row substrate_hash="" never matches a real SHA-256 hex (D-18)', () => {
    const h = computeSubstrateHash(emptySubstrate, { substrate_hash: '', schema_version: 1 });
    expect(h).not.toBe('');
    expect(h.length).toBe(64);
  });

  it('PROFILE_SUBSTRATE_TAGS verbatim per D-13', () => {
    expect(PROFILE_SUBSTRATE_TAGS).toEqual(['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE']);
  });

  it('SUBSTRATE_WINDOW_DAYS = 60 per D-13', () => {
    expect(SUBSTRATE_WINDOW_DAYS).toBe(60);
  });
});

// ── Integration tests (real Docker postgres) ────────────────────────────────

describe('loadProfileSubstrate — real-DB substrate loader (D-12, D-13, D-14)', () => {
  // Anchor "now" inside the test for deterministic window boundaries.
  const NOW = new Date('2026-05-12T22:00:00Z');
  const IN_WINDOW = new Date('2026-04-12T12:00:00Z');     // 30 days before NOW
  const OUTSIDE_BEFORE_WINDOW = new Date('2026-02-26T12:00:00Z'); // 75 days before NOW
  const OUTSIDE_AFTER_WINDOW = new Date('2026-05-13T12:00:00Z');  // 1 day after NOW

  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
  });

  beforeEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await cleanupTables();
  });

  it('tag filter: only FACT/RELATIONSHIP/INTENTION/EXPERIENCE entries are loaded (D-13)', async () => {
    // Seed one entry per substrate tag + several non-substrate tags.
    const substrateTags = ['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE'] as const;
    const nonSubstrateTags = ['EMOTION', 'BELIEF', 'PREFERENCE', 'DREAM', 'FEAR', 'VALUE', 'CONTRADICTION', 'OTHER', 'DECISION', 'RITUAL_RESPONSE'] as const;

    for (const tag of substrateTags) {
      await db.insert(pensieveEntries).values({
        content: `substrate entry tagged ${tag}`,
        epistemicTag: tag,
        createdAt: IN_WINDOW,
      });
    }
    for (const tag of nonSubstrateTags) {
      await db.insert(pensieveEntries).values({
        content: `non-substrate entry tagged ${tag}`,
        epistemicTag: tag,
        createdAt: IN_WINDOW,
      });
    }

    const substrate = await loadProfileSubstrate(NOW);

    expect(substrate.pensieveEntries).toHaveLength(4);
    const loadedTags = substrate.pensieveEntries.map((e) => e.epistemicTag).sort();
    expect(loadedTags).toEqual(['EXPERIENCE', 'FACT', 'INTENTION', 'RELATIONSHIP']);
    // No non-substrate tag should have leaked in
    for (const e of substrate.pensieveEntries) {
      expect(['FACT', 'RELATIONSHIP', 'INTENTION', 'EXPERIENCE']).toContain(e.epistemicTag);
    }
  });

  it('60-day rolling window: entries before now-60d excluded; in-window kept', async () => {
    await db.insert(pensieveEntries).values({
      content: 'in-window entry (30 days before NOW)',
      epistemicTag: 'FACT',
      createdAt: IN_WINDOW,
    });
    await db.insert(pensieveEntries).values({
      content: 'outside-before-window entry (75 days before NOW)',
      epistemicTag: 'FACT',
      createdAt: OUTSIDE_BEFORE_WINDOW,
    });
    await db.insert(pensieveEntries).values({
      content: 'outside-after-window entry (1 day after NOW)',
      epistemicTag: 'FACT',
      createdAt: OUTSIDE_AFTER_WINDOW,
    });

    const substrate = await loadProfileSubstrate(NOW);

    expect(substrate.pensieveEntries).toHaveLength(1);
    expect(substrate.pensieveEntries[0]!.content).toContain('in-window');
  });

  it('entryCount = pensieveEntries.length (D-20 — NOT aggregate)', async () => {
    // Seed 7 Pensieve entries + 3 episodic summaries + 2 resolved decisions.
    // entryCount should be 7, NOT 12.
    for (let i = 0; i < 7; i++) {
      await db.insert(pensieveEntries).values({
        content: `pensieve entry ${i}`,
        epistemicTag: 'FACT',
        createdAt: IN_WINDOW,
      });
    }
    for (let i = 0; i < 3; i++) {
      await db.insert(episodicSummaries).values({
        summaryDate: `2026-04-${15 + i}`,
        summary: `episodic summary ${i} — long enough to satisfy schema constraints (50+ chars)`,
        importance: 5,
        topics: ['test'],
        emotionalArc: 'flat',
        keyQuotes: [],
        sourceEntryIds: [],
      });
    }
    for (let i = 0; i < 2; i++) {
      await db.insert(decisions).values({
        decisionText: `decision ${i}`,
        status: 'resolved',
        reasoning: 'r',
        prediction: 'p',
        falsificationCriterion: 'f',
        resolveBy: FUTURE_RESOLVE_BY,
        resolution: 'res',
        resolvedAt: IN_WINDOW,
      });
    }

    const substrate = await loadProfileSubstrate(NOW);

    expect(substrate.pensieveEntries).toHaveLength(7);
    expect(substrate.episodicSummaries).toHaveLength(3);
    expect(substrate.decisions).toHaveLength(2);
    expect(substrate.entryCount).toBe(7); // D-20: Pensieve count only
  });

  it('decisions filter: only resolved decisions in window appear', async () => {
    // 2 resolved in-window
    for (let i = 0; i < 2; i++) {
      await db.insert(decisions).values({
        decisionText: `resolved-in-window-${i}`,
        status: 'resolved',
        reasoning: 'r',
        prediction: 'p',
        falsificationCriterion: 'f',
        resolveBy: FUTURE_RESOLVE_BY,
        resolution: 'res',
        resolvedAt: IN_WINDOW,
      });
    }
    // 1 open in-window (no resolvedAt)
    await db.insert(decisions).values({
      decisionText: 'open-in-window',
      status: 'open',
      reasoning: 'r',
      prediction: 'p',
      falsificationCriterion: 'f',
      resolveBy: FUTURE_RESOLVE_BY,
    });
    // 1 resolved outside window
    await db.insert(decisions).values({
      decisionText: 'resolved-outside-window',
      status: 'resolved',
      reasoning: 'r',
      prediction: 'p',
      falsificationCriterion: 'f',
      resolveBy: FUTURE_RESOLVE_BY,
      resolution: 'res',
      resolvedAt: OUTSIDE_BEFORE_WINDOW,
    });

    const substrate = await loadProfileSubstrate(NOW);

    expect(substrate.decisions).toHaveLength(2);
    expect(substrate.decisions.every((d) => d.status === 'resolved')).toBe(true);
    expect(substrate.decisions.every((d) => d.resolvedAt! >= new Date(NOW.getTime() - SUBSTRATE_WINDOW_DAYS * 24 * 60 * 60 * 1000))).toBe(true);
  });

  it('deletedAt filter: soft-deleted entries excluded from substrate', async () => {
    // 1 active + 1 soft-deleted, both with valid tags + in-window dates
    await db.insert(pensieveEntries).values({
      content: 'active entry',
      epistemicTag: 'FACT',
      createdAt: IN_WINDOW,
    });
    await db.insert(pensieveEntries).values({
      content: 'soft-deleted entry',
      epistemicTag: 'FACT',
      createdAt: IN_WINDOW,
      deletedAt: new Date('2026-05-01T00:00:00Z'),
    });

    const substrate = await loadProfileSubstrate(NOW);

    expect(substrate.pensieveEntries).toHaveLength(1);
    expect(substrate.pensieveEntries[0]!.content).toBe('active entry');
  });

  it('hash determinism on a real-loaded substrate: two consecutive loads of unchanged DB → same hash', async () => {
    // Seed deterministic substrate
    for (let i = 0; i < 3; i++) {
      await db.insert(pensieveEntries).values({
        id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa${i}`,
        content: `entry ${i}`,
        epistemicTag: 'FACT',
        createdAt: IN_WINDOW,
      });
    }

    const sub1 = await loadProfileSubstrate(NOW);
    const sub2 = await loadProfileSubstrate(NOW);

    const meta = { substrate_hash: '', schema_version: 1 };
    expect(computeSubstrateHash(sub1, meta)).toBe(computeSubstrateHash(sub2, meta));
  });
});
