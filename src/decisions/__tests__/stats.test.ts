/**
 * Phase 17 Plan 02 — stats.ts test suite.
 *
 * Covers:
 *   - wilsonCI math (pure unit, no DB)
 *   - computeAccuracy: N<10 floor, N>=10 with CI, unverifiable exclusion
 *   - fetchStatsData: SQL window filtering (integration)
 *   - formatDashboard, formatOpenList, formatRecentList, formatStatsBlock
 *
 * Run: npx vitest run src/decisions/__tests__/stats.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { db, sql } from '../../db/connection.js';
import { decisions } from '../../db/schema.js';
import {
  wilsonCI,
  computeAccuracy,
  fetchStatsData,
  fetchStatusCounts,
  fetchOpenDecisions,
  fetchRecentDecisions,
  formatDashboard,
  formatOpenList,
  formatRecentList,
  formatStatsBlock,
  type StatsRow,
  type AccuracyResult,
  type StatusCounts,
  type OpenRow,
  type RecentRow,
} from '../stats.js';

// ── Shared DB lifecycle ────────────────────────────────────────────────────

const TEST_CHAT = 9001n;

async function cleanupDecisions() {
  await db.delete(decisions);
}

beforeAll(async () => {
  const result = await sql`SELECT 1 as ok`;
  expect(result[0]!.ok).toBe(1);
});

afterAll(async () => {
  await sql.end();
});

afterEach(async () => {
  await cleanupDecisions();
});

// ── Helper to insert a minimal decision row ────────────────────────────────

async function insertDecision(overrides: {
  status?: string;
  accuracyClass?: string | null;
  domainTag?: string | null;
  resolvedAt?: Date | null;
  resolveBy?: Date;
  decisionText?: string;
} = {}) {
  const defaults = {
    status: 'reviewed' as const,
    decisionText: 'Test decision',
    reasoning: 'Test reasoning',
    prediction: 'Test prediction',
    falsificationCriterion: 'Test criterion',
    resolveBy: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    chatId: TEST_CHAT,
    resolvedAt: new Date(),
    accuracyClass: null as string | null,
    domainTag: null as string | null,
  };
  const merged = { ...defaults, ...overrides };
  await db.insert(decisions).values({
    status: merged.status as 'reviewed',
    decisionText: merged.decisionText,
    reasoning: merged.reasoning,
    prediction: merged.prediction,
    falsificationCriterion: merged.falsificationCriterion,
    resolveBy: merged.resolveBy,
    chatId: merged.chatId,
    resolvedAt: merged.resolvedAt,
    accuracyClass: merged.accuracyClass,
    domainTag: merged.domainTag,
  });
}

// ── Test 1: wilsonCI(6, 10) — known statistical values ────────────────────

describe('wilsonCI — pure math', () => {
  it('wilsonCI(6, 10) returns lo ~0.30 and hi ~0.85', () => {
    const { lo, hi } = wilsonCI(6, 10);
    expect(lo).toBeGreaterThanOrEqual(0.28);
    expect(lo).toBeLessThanOrEqual(0.35);
    expect(hi).toBeGreaterThanOrEqual(0.82);
    expect(hi).toBeLessThanOrEqual(0.88);
  });

  // Test 2: wilsonCI(0, 10)
  it('wilsonCI(0, 10) returns lo=0 bounded and hi > 0', () => {
    const { lo, hi } = wilsonCI(0, 10);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(0);
  });

  // Test 3: wilsonCI(10, 10)
  it('wilsonCI(10, 10) returns lo > 0 and hi ~1.0', () => {
    const { lo, hi } = wilsonCI(10, 10);
    expect(lo).toBeGreaterThan(0.6);
    expect(hi).toBeLessThanOrEqual(1.0);
    expect(hi).toBeGreaterThan(0.95);
  });
});

// ── Tests 6-9: computeAccuracy ─────────────────────────────────────────────

describe('computeAccuracy', () => {
  // Test 6: N<10 floor
  it('returns { belowFloor: true, n: count } when N<10', () => {
    const rows: StatsRow[] = [
      { accuracyClass: 'hit/sound', domainTag: 'career' },
      { accuracyClass: 'miss/flawed', domainTag: 'health' },
      { accuracyClass: 'hit/sound', domainTag: null },
    ];
    const result = computeAccuracy(rows);
    expect(result.belowFloor).toBe(true);
    expect(result.n).toBe(3);
    expect(result.pct).toBeUndefined();
    expect(result.ci).toBeUndefined();
  });

  // Test 7: N>=10 with CI
  it('returns { belowFloor: false, hits, n, pct, ci } when N>=10', () => {
    const rows: StatsRow[] = Array.from({ length: 10 }, (_, i) => ({
      accuracyClass: i < 6 ? 'hit/sound' : 'miss/flawed',
      domainTag: null,
    }));
    const result = computeAccuracy(rows);
    expect(result.belowFloor).toBe(false);
    expect(result.n).toBe(10);
    expect(result.hits).toBe(6);
    expect(result.pct).toBe(60);
    expect(result.ci).toBeDefined();
    expect(result.ci!.lo).toBeGreaterThan(0);
    expect(result.ci!.hi).toBeLessThanOrEqual(100);
  });

  // Test 8: unverifiable excluded from denominator
  it('excludes unverifiable/* and */unknown from denominator', () => {
    const rows: StatsRow[] = [
      { accuracyClass: 'hit/sound', domainTag: null },
      { accuracyClass: 'hit/sound', domainTag: null },
      { accuracyClass: 'miss/flawed', domainTag: null },
      { accuracyClass: 'unverifiable/unknown', domainTag: null },
      { accuracyClass: 'ambiguous/unknown', domainTag: null },
      { accuracyClass: 'hit/sound', domainTag: null },
      { accuracyClass: 'miss/flawed', domainTag: null },
      { accuracyClass: 'hit/sound', domainTag: null },
      { accuracyClass: 'hit/sound', domainTag: null },
      { accuracyClass: 'hit/sound', domainTag: null },
    ];
    const result = computeAccuracy(rows);
    // Only 8 scorable (2 excluded: unverifiable/unknown and ambiguous/unknown)
    expect(result.n).toBe(8);
    expect(result.belowFloor).toBe(true); // 8 < 10
  });

  // Test 9: unverifiable count surfaced separately
  it('surfaces unverifiable count separately', () => {
    const rows: StatsRow[] = [
      { accuracyClass: 'unverifiable/context', domainTag: null },
      { accuracyClass: 'hit/sound', domainTag: null },
      { accuracyClass: 'ambiguous/unknown', domainTag: null },
    ];
    const result = computeAccuracy(rows);
    expect(result.unverifiable).toBe(2); // unverifiable/context + ambiguous/unknown
  });
});

// ── Tests 4-5: fetchStatsData SQL window ──────────────────────────────────

describe('fetchStatsData — SQL window filtering', () => {
  // Test 4: returns only reviewed decisions within window
  it('returns only reviewed decisions with resolvedAt within window', async () => {
    const withinWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000 + 60000); // 30d ago + 1 min
    const outsideWindow = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100d ago
    await insertDecision({ status: 'reviewed', resolvedAt: withinWindow, accuracyClass: 'hit/sound' });
    await insertDecision({ status: 'reviewed', resolvedAt: outsideWindow, accuracyClass: 'miss/flawed' });

    const rows = await fetchStatsData(TEST_CHAT, 90);
    expect(rows.length).toBe(1);
    expect(rows[0]!.accuracyClass).toBe('hit/sound');
  });

  // Test 5: excludes decisions outside window
  it('excludes decisions whose resolvedAt is outside the window', async () => {
    const outsideWindow = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
    await insertDecision({ status: 'reviewed', resolvedAt: outsideWindow, accuracyClass: 'hit/sound' });

    const rows = await fetchStatsData(TEST_CHAT, 90);
    expect(rows.length).toBe(0);
  });
});

// ── Tests 10-11: formatDashboard ──────────────────────────────────────────

describe('formatDashboard', () => {
  const counts: StatusCounts = { open: 5, due: 2, reviewed: 12, stale: 1, openDraft: 0, withdrawn: 0, abandoned: 0 };

  // Test 10: N>=10 shows accuracy + CI
  it('returns status counts + accuracy line when N>=10', () => {
    const accuracy: AccuracyResult = { belowFloor: false, n: 12, hits: 8, pct: 67, ci: { lo: 40, hi: 87 }, unverifiable: 1 };
    const output = formatDashboard(counts, accuracy, 'en');
    expect(output).toContain('5 open');
    expect(output).toContain('2 due');
    expect(output).toContain('12 reviewed');
    expect(output).toContain('67%');
    expect(output).toContain('40-87%');
    expect(output).toContain('/decisions');
  });

  // Test 11: N<10 shows "threshold not met"
  it('returns status counts + threshold-not-met when N<10', () => {
    const accuracy: AccuracyResult = { belowFloor: true, n: 4, unverifiable: 0 };
    const output = formatDashboard(counts, accuracy, 'en');
    expect(output).toContain('5 open');
    expect(output).toContain('N=4');
    expect(output).not.toContain('%');
    expect(output).toContain('/decisions');
  });
});

// ── Test 12: formatOpenList ────────────────────────────────────────────────

describe('formatOpenList', () => {
  it('returns one-liner per decision sorted by resolveBy ascending', () => {
    const rows: OpenRow[] = [
      { decisionText: 'Run a marathon', resolveBy: new Date('2026-12-01'), domainTag: 'health' },
      { decisionText: 'Switch to Rust', resolveBy: new Date('2026-06-15'), domainTag: 'career' },
    ];
    const output = formatOpenList(rows, 'en');
    const lines = output.split('\n').filter(Boolean);
    // career (sooner deadline) should appear first
    expect(lines[0]).toContain('Switch to Rust');
    expect(lines[0]).toContain('2026-06-15');
    expect(lines[1]).toContain('Run a marathon');
  });
});

// ── Test 13: formatRecentList ──────────────────────────────────────────────

describe('formatRecentList', () => {
  it('returns one-liner per decision sorted by resolvedAt descending, limit 5', () => {
    const rows: RecentRow[] = [
      { decisionText: 'Bet on TypeScript', accuracyClass: 'hit/sound', resolvedAt: new Date('2026-04-10') },
      { decisionText: 'Market timing call', accuracyClass: 'miss/flawed', resolvedAt: new Date('2026-04-05') },
    ];
    const output = formatRecentList(rows, 'en');
    const lines = output.split('\n').filter(Boolean);
    expect(lines[0]).toContain('hit/sound');
    expect(lines[0]).toContain('Bet on TypeScript');
    expect(lines[1]).toContain('miss/flawed');
  });
});

// ── Tests 14-15: formatStatsBlock ─────────────────────────────────────────

describe('formatStatsBlock', () => {
  // Test 14: overall accuracy + unverifiable + domain breakdown
  it('returns overall accuracy + unverifiable count + domain breakdown when N>=10', () => {
    const rows: StatsRow[] = [
      ...Array.from({ length: 6 }, () => ({ accuracyClass: 'hit/sound', domainTag: 'career' })),
      ...Array.from({ length: 4 }, () => ({ accuracyClass: 'miss/flawed', domainTag: 'career' })),
      { accuracyClass: 'unverifiable/context', domainTag: 'health' },
    ];
    const output = formatStatsBlock(rows, 90, 'en');
    expect(output).toContain('90');
    expect(output).toContain('60%');
    expect(output).toContain('Unverifiable: 1');
    expect(output).toContain('career');
  });

  // Test 15: per-domain N<10 shows "threshold not met"
  it('shows N=X, threshold not met for domains below floor', () => {
    const rows: StatsRow[] = [
      { accuracyClass: 'hit/sound', domainTag: 'technical' },
      { accuracyClass: 'miss/flawed', domainTag: 'technical' },
    ];
    const output = formatStatsBlock(rows, 90, 'en');
    expect(output).toContain('technical');
    expect(output).toContain('N=2');
    expect(output).toContain('threshold not met');
  });
});
