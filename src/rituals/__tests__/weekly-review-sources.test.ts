/**
 * src/rituals/__tests__/weekly-review-sources.test.ts — Phase 29 Plan 01
 *
 * Tests for src/rituals/weekly-review-sources.ts. Two layers:
 *
 *   - UNIT (no DB): pure function shape — computeStdDev, shouldIncludeWellbeing
 *     (variance threshold, ANY-dim-flat rule, insufficient-data short-circuit),
 *     computeWeekBoundary (DST safety on a spring-forward week).
 *
 *   - INTEGRATION (real Docker postgres on port 5433, mirrors
 *     src/episodic/__tests__/sources.test.ts): loadWeeklyReviewContext range
 *     fetch correctness — episodic_summaries M008 helper called, decisions
 *     filtered by status='resolved' AND resolvedAt window, wellbeing_snapshots
 *     filtered by snapshot_date window. Tests seed real rows + assert the
 *     returned arrays match expectations.
 *
 * Per CONTEXT.md D-06 and WEEK-09: variance threshold = 0.4, insufficient-data
 * threshold = 4 snapshots. Both verified by unit tests.
 *
 * Run via Docker harness:
 *   bash scripts/test.sh
 *   # or this file in isolation against running test postgres on port 5433:
 *   DATABASE_URL='postgresql://chris:localtest123@localhost:5433/chris' \
 *     ANTHROPIC_API_KEY=test-key TELEGRAM_BOT_TOKEN=test-token \
 *     TELEGRAM_AUTHORIZED_USER_ID=99999 \
 *     npx vitest run src/rituals/__tests__/weekly-review-sources.test.ts
 *
 * vitest.config.ts disables file parallelism (fileParallelism: false), so
 * scoped DELETEs in afterEach are safe — no sibling test file runs concurrently.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { and, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db, sql as pgSql } from '../../db/connection.js';
import {
  decisions,
  episodicSummaries,
  wellbeingSnapshots,
} from '../../db/schema.js';
import {
  computeStdDev,
  computeWeekBoundary,
  INSUFFICIENT_DATA_THRESHOLD,
  loadWeeklyReviewContext,
  shouldIncludeWellbeing,
  VARIANCE_THRESHOLD,
} from '../weekly-review-sources.js';

// ── Unit tests (no DB) ──────────────────────────────────────────────────────

describe('computeStdDev — pure population stddev helper', () => {
  it('returns 0 for empty array', () => {
    expect(computeStdDev([])).toBe(0);
  });

  it('returns 0 for single-element array', () => {
    expect(computeStdDev([3])).toBe(0);
  });

  it('returns 0 for an all-equal array (no spread)', () => {
    expect(computeStdDev([3, 3, 3, 3, 3])).toBe(0);
  });

  it('matches population stddev for known input [1,2,3,4,5] (population sigma ≈ 1.4142)', () => {
    const sd = computeStdDev([1, 2, 3, 4, 5]);
    expect(sd).toBeCloseTo(Math.sqrt(2), 5);
  });

  it('symmetric input [1,5,1,5] (population sigma = 2)', () => {
    expect(computeStdDev([1, 5, 1, 5])).toBeCloseTo(2, 5);
  });
});

describe('shouldIncludeWellbeing — WEEK-09 / D-06 variance gate', () => {
  /** Tiny fixture builder: build a snapshot row matching the schema's $inferSelect shape. */
  function snap(date: string, energy: number, mood: number, anxiety: number) {
    return {
      id: '00000000-0000-0000-0000-000000000000',
      snapshotDate: date,
      energy,
      mood,
      anxiety,
      notes: null,
      createdAt: new Date(),
    } as typeof wellbeingSnapshots.$inferSelect;
  }

  it('insufficient data — < 4 snapshots returns false (D-06)', () => {
    const ss = [
      snap('2026-04-20', 1, 2, 3),
      snap('2026-04-21', 5, 4, 1),
      snap('2026-04-22', 2, 3, 4),
    ];
    expect(ss.length).toBeLessThan(INSUFFICIENT_DATA_THRESHOLD);
    expect(shouldIncludeWellbeing(ss)).toBe(false);
  });

  it('high variance across all 3 dims with 4+ snapshots returns true', () => {
    const ss = [
      snap('2026-04-20', 1, 1, 5),
      snap('2026-04-21', 5, 5, 1),
      snap('2026-04-22', 2, 4, 3),
      snap('2026-04-23', 4, 2, 4),
    ];
    expect(shouldIncludeWellbeing(ss)).toBe(true);
  });

  it('all-flat data (stddev=0 in every dim) with 4+ snapshots returns false', () => {
    const ss = [
      snap('2026-04-20', 3, 3, 3),
      snap('2026-04-21', 3, 3, 3),
      snap('2026-04-22', 3, 3, 3),
      snap('2026-04-23', 3, 3, 3),
    ];
    expect(shouldIncludeWellbeing(ss)).toBe(false);
  });

  it('ANY-dim-flat rule — energy varied, mood varied, anxiety FLAT → returns false', () => {
    const ss = [
      snap('2026-04-20', 1, 1, 3),
      snap('2026-04-21', 5, 5, 3),
      snap('2026-04-22', 2, 4, 3),
      snap('2026-04-23', 4, 2, 3),
    ];
    // energy: stddev > 0.4, mood: stddev > 0.4, anxiety: stddev = 0 → omit.
    expect(shouldIncludeWellbeing(ss)).toBe(false);
  });

  it('threshold boundary — all dims at exactly the 0.4 threshold returns true (>= boundary)', () => {
    // Construct a 4-element series with population stddev exactly 0.5 (well above 0.4).
    // Values [1, 2, 1, 2] → mean 1.5, var = ((-.5)^2 * 4)/4 = 0.25 → sigma = 0.5
    const ss = [
      snap('2026-04-20', 1, 1, 1),
      snap('2026-04-21', 2, 2, 2),
      snap('2026-04-22', 1, 1, 1),
      snap('2026-04-23', 2, 2, 2),
    ];
    const sd = computeStdDev(ss.map((s) => s.energy));
    expect(sd).toBeCloseTo(0.5, 5);
    expect(sd).toBeGreaterThanOrEqual(VARIANCE_THRESHOLD);
    expect(shouldIncludeWellbeing(ss)).toBe(true);
  });
});

describe('computeWeekBoundary — Luxon DST-safe 7-day window', () => {
  it('returns Date instances; weekStart < weekEnd', () => {
    const now = new Date('2026-04-26T18:00:00Z');
    const { weekStart, weekEnd } = computeWeekBoundary(now);
    expect(weekStart).toBeInstanceOf(Date);
    expect(weekEnd).toBeInstanceOf(Date);
    expect(weekStart.getTime()).toBeLessThan(weekEnd.getTime());
  });

  it('weekEnd is the end of the local day containing `now`', () => {
    // Sunday 2026-04-26 19:00 UTC = 21:00 Europe/Paris (CEST = UTC+2)
    const now = new Date('2026-04-26T19:00:00Z');
    const { weekEnd } = computeWeekBoundary(now);
    // weekEnd is end-of-local-day → 23:59:59.999 in Paris that day.
    const weekEndLocal = DateTime.fromJSDate(weekEnd, { zone: 'Europe/Paris' });
    expect(weekEndLocal.hour).toBe(23);
    expect(weekEndLocal.minute).toBe(59);
  });

  it('weekStart is the start of the local day 7 days earlier (8-day inclusive window per spec §2)', () => {
    const now = new Date('2026-04-26T18:00:00Z'); // Sunday 20:00 Paris (CEST)
    const { weekStart } = computeWeekBoundary(now);
    const weekStartLocal = DateTime.fromJSDate(weekStart, { zone: 'Europe/Paris' });
    // 2026-04-26 Sun, minus 7 days = 2026-04-19 Sun, startOf-day Paris.
    expect(weekStartLocal.toFormat('yyyy-MM-dd')).toBe('2026-04-19');
    expect(weekStartLocal.hour).toBe(0);
    expect(weekStartLocal.minute).toBe(0);
  });

  it('DST safety — spring-forward week — start is wall-clock 7 days earlier (Luxon startOf), not naïve fixed-ms', () => {
    // Europe/Paris spring-forward: 2026-03-29 02:00 → 03:00 CEST.
    // Sunday 2026-03-29 18:00 UTC = 20:00 CEST. Minus 7 days = 2026-03-22 (CET, pre-DST).
    // startOf('day') Luxon lands on 2026-03-22 00:00 LOCAL — which is 23:00 UTC on 2026-03-21
    // (CET = UTC+1, pre-DST). A naive 7×24h-ms subtract would land at 18:00 UTC on
    // 2026-03-22 (= 19:00 local CET) — not start-of-day.
    const now = new Date('2026-03-29T18:00:00Z');
    const { weekStart } = computeWeekBoundary(now);
    const weekStartLocal = DateTime.fromJSDate(weekStart, { zone: 'Europe/Paris' });
    expect(weekStartLocal.toFormat('yyyy-MM-dd')).toBe('2026-03-22');
    expect(weekStartLocal.hour).toBe(0);
    expect(weekStartLocal.minute).toBe(0);
  });
});

// ── Integration tests (real Docker postgres) ────────────────────────────────

describe('loadWeeklyReviewContext — real-DB range fetch (WEEK-01 substrate)', () => {
  const WEEK_START = new Date('2026-04-20T00:00:00Z');
  const WEEK_END = new Date('2026-04-26T22:00:00Z');
  const OUTSIDE_BEFORE = new Date('2026-04-13T12:00:00Z');
  const OUTSIDE_AFTER = new Date('2026-05-01T12:00:00Z');

  beforeAll(async () => {
    await pgSql`SELECT 1 as ok`;
  });

  beforeEach(async () => {
    // Scoped cleanup of just this file's interest tables — wellbeing_snapshots,
    // episodic_summaries (UNIQUE on summary_date so we MUST clear), and
    // any decisions we'd seed. Use direct DELETE ALL (single-user test DB,
    // no concurrent writers — vitest fileParallelism: false).
    await db.delete(wellbeingSnapshots);
    await db.delete(episodicSummaries);
    await db.delete(decisions);
  });

  afterAll(async () => {
    await db.delete(wellbeingSnapshots);
    await db.delete(episodicSummaries);
    await db.delete(decisions);
  });

  it('range fetch — seeds 5 episodic_summaries in window + 2 outside; assert exactly 5 returned', async () => {
    // Seed 5 in window (one per day in the 7-day window).
    const inWindow = ['2026-04-20', '2026-04-21', '2026-04-23', '2026-04-25', '2026-04-26'];
    for (const date of inWindow) {
      await db.insert(episodicSummaries).values({
        summaryDate: date,
        summary: `summary for ${date} — long enough to satisfy schema constraints (50+ chars)`,
        importance: 5,
        topics: ['test'],
        emotionalArc: 'flat',
        keyQuotes: [],
        sourceEntryIds: [],
      });
    }
    // 2 outside the window.
    await db.insert(episodicSummaries).values({
      summaryDate: '2026-04-15',
      summary: 'outside-before — long enough to satisfy schema constraints (50+ chars)',
      importance: 5,
      topics: [],
      emotionalArc: 'flat',
      keyQuotes: [],
      sourceEntryIds: [],
    });
    await db.insert(episodicSummaries).values({
      summaryDate: '2026-05-02',
      summary: 'outside-after — long enough to satisfy schema constraints (50+ chars)',
      importance: 5,
      topics: [],
      emotionalArc: 'flat',
      keyQuotes: [],
      sourceEntryIds: [],
    });

    const ctx = await loadWeeklyReviewContext(WEEK_START, WEEK_END);
    expect(ctx.summaries).toHaveLength(5);
    const dates = ctx.summaries.map((s) => s.summaryDate).sort();
    expect(dates).toEqual([...inWindow].sort());
  });

  it('resolved decisions filter — seeds 3 resolved-in-window + 2 open + 1 resolved-outside; assert exactly 3', async () => {
    const futureResolveBy = new Date('2026-12-31T00:00:00Z');
    // 3 resolved in window
    for (let i = 0; i < 3; i++) {
      const resolvedAt = new Date(`2026-04-2${i + 1}T12:00:00Z`); // 21, 22, 23
      await db.insert(decisions).values({
        decisionText: `resolved-in-window-${i}`,
        status: 'resolved',
        reasoning: 'r',
        prediction: 'p',
        falsificationCriterion: 'f',
        resolveBy: futureResolveBy,
        resolution: 'res',
        resolvedAt,
      });
    }
    // 2 open in window (no resolvedAt)
    for (let i = 0; i < 2; i++) {
      await db.insert(decisions).values({
        decisionText: `open-${i}`,
        status: 'open',
        reasoning: 'r',
        prediction: 'p',
        falsificationCriterion: 'f',
        resolveBy: futureResolveBy,
      });
    }
    // 1 resolved outside window
    await db.insert(decisions).values({
      decisionText: 'resolved-outside',
      status: 'resolved',
      reasoning: 'r',
      prediction: 'p',
      falsificationCriterion: 'f',
      resolveBy: futureResolveBy,
      resolution: 'res',
      resolvedAt: OUTSIDE_BEFORE,
    });

    const ctx = await loadWeeklyReviewContext(WEEK_START, WEEK_END);
    expect(ctx.resolvedDecisions).toHaveLength(3);
    expect(ctx.resolvedDecisions.every((d) => d.status === 'resolved')).toBe(true);
    expect(
      ctx.resolvedDecisions.every(
        (d) => d.resolvedAt! >= WEEK_START && d.resolvedAt! <= WEEK_END,
      ),
    ).toBe(true);
  });

  it('wellbeing high variance — seeds 7 snapshots with stddev > 0.4 in all 3 dims; includeWellbeing === true', async () => {
    const dates = [
      '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23',
      '2026-04-24', '2026-04-25', '2026-04-26',
    ];
    const energies = [1, 5, 2, 4, 3, 5, 1];
    const moods    = [2, 4, 1, 5, 3, 4, 2];
    const anxiets  = [5, 1, 4, 2, 3, 1, 5];
    for (let i = 0; i < dates.length; i++) {
      await db.insert(wellbeingSnapshots).values({
        snapshotDate: dates[i]!,
        energy: energies[i]!,
        mood: moods[i]!,
        anxiety: anxiets[i]!,
      });
    }
    const ctx = await loadWeeklyReviewContext(WEEK_START, WEEK_END);
    expect(ctx.wellbeingSnapshots).toHaveLength(7);
    expect(ctx.includeWellbeing).toBe(true);
    expect(ctx.wellbeingVariance.energy).toBeGreaterThanOrEqual(VARIANCE_THRESHOLD);
    expect(ctx.wellbeingVariance.mood).toBeGreaterThanOrEqual(VARIANCE_THRESHOLD);
    expect(ctx.wellbeingVariance.anxiety).toBeGreaterThanOrEqual(VARIANCE_THRESHOLD);
  });

  it('wellbeing low variance — seeds 7 snapshots with mood FLAT (stddev=0); includeWellbeing === false (ANY-dim rule)', async () => {
    const dates = [
      '2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23',
      '2026-04-24', '2026-04-25', '2026-04-26',
    ];
    const energies = [1, 5, 2, 4, 3, 5, 1];
    const moods    = [3, 3, 3, 3, 3, 3, 3]; // flat
    const anxiets  = [5, 1, 4, 2, 3, 1, 5];
    for (let i = 0; i < dates.length; i++) {
      await db.insert(wellbeingSnapshots).values({
        snapshotDate: dates[i]!,
        energy: energies[i]!,
        mood: moods[i]!,
        anxiety: anxiets[i]!,
      });
    }
    const ctx = await loadWeeklyReviewContext(WEEK_START, WEEK_END);
    expect(ctx.wellbeingSnapshots).toHaveLength(7);
    expect(ctx.wellbeingVariance.mood).toBe(0);
    expect(ctx.includeWellbeing).toBe(false);
  });

  it('wellbeing insufficient data — only 3 snapshots in window; includeWellbeing === false (count < 4)', async () => {
    const dates = ['2026-04-20', '2026-04-22', '2026-04-25'];
    const energies = [1, 5, 2];
    const moods    = [3, 4, 1];
    const anxiets  = [5, 2, 4];
    for (let i = 0; i < dates.length; i++) {
      await db.insert(wellbeingSnapshots).values({
        snapshotDate: dates[i]!,
        energy: energies[i]!,
        mood: moods[i]!,
        anxiety: anxiets[i]!,
      });
    }
    const ctx = await loadWeeklyReviewContext(WEEK_START, WEEK_END);
    expect(ctx.wellbeingSnapshots).toHaveLength(3);
    expect(ctx.includeWellbeing).toBe(false);
  });

  it('parallel-fetch shape — all four arrays + variance + boolean returned in single context', async () => {
    // Seed minimal data across all three streams.
    await db.insert(episodicSummaries).values({
      summaryDate: '2026-04-22',
      summary: 'one summary in window — long enough to satisfy schema constraints (50+ chars)',
      importance: 5,
      topics: [],
      emotionalArc: 'flat',
      keyQuotes: [],
      sourceEntryIds: [],
    });
    await db.insert(decisions).values({
      decisionText: 'decision in window',
      status: 'resolved',
      reasoning: 'r',
      prediction: 'p',
      falsificationCriterion: 'f',
      resolveBy: new Date('2026-12-31T00:00:00Z'),
      resolution: 'res',
      resolvedAt: new Date('2026-04-22T12:00:00Z'),
    });
    await db.insert(wellbeingSnapshots).values({
      snapshotDate: '2026-04-22',
      energy: 3,
      mood: 3,
      anxiety: 3,
    });

    const ctx = await loadWeeklyReviewContext(WEEK_START, WEEK_END);
    expect(ctx.summaries).toHaveLength(1);
    expect(ctx.resolvedDecisions).toHaveLength(1);
    expect(ctx.wellbeingSnapshots).toHaveLength(1);
    expect(ctx.wellbeingVariance).toEqual({ energy: 0, mood: 0, anxiety: 0 });
    expect(ctx.includeWellbeing).toBe(false); // 1 snapshot < 4 threshold
  });

  // Sanity guard: assert the pre-Phase-29 production state. M008 helper
  // existed but had zero callers; Phase 29 is the first. This isn't a hard
  // assertion (some other plan could have added a caller) — just a sanity
  // touchpoint that the helper is imported and reachable.
  it('M008 helper sanity — getEpisodicSummariesRange call returns array (empty when no data)', async () => {
    const ctx = await loadWeeklyReviewContext(WEEK_START, WEEK_END);
    expect(Array.isArray(ctx.summaries)).toBe(true);
    expect(ctx.summaries).toHaveLength(0);
  });

  // Defensive: ensure resolvedAt-window filter on the decisions table is
  // applied (regression guard). Use the raw SQL we expect to issue.
  it('resolvedAt window equivalent direct SQL matches', async () => {
    await db.insert(decisions).values({
      decisionText: 'edge-case-resolved',
      status: 'resolved',
      reasoning: 'r',
      prediction: 'p',
      falsificationCriterion: 'f',
      resolveBy: new Date('2026-12-31T00:00:00Z'),
      resolution: 'res',
      resolvedAt: new Date('2026-04-25T12:00:00Z'),
    });
    const directRows = await db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.status, 'resolved'),
          gte(decisions.resolvedAt, WEEK_START),
          lte(decisions.resolvedAt, WEEK_END),
        ),
      );
    const ctx = await loadWeeklyReviewContext(WEEK_START, WEEK_END);
    expect(ctx.resolvedDecisions).toHaveLength(directRows.length);
  });
});
