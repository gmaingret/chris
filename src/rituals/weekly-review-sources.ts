/**
 * src/rituals/weekly-review-sources.ts — Phase 29 Plan 01
 *
 * Data-fetch + variance-computation helpers for the Sunday weekly review.
 * Pure data layer: no LLM calls, no Telegram, no prompt assembly.
 *
 * Satisfies (substrate side):
 *   - WEEK-01 — `loadWeeklyReviewContext(weekStart, weekEnd)` calls
 *     `getEpisodicSummariesRange` (M008 first production consumer) +
 *     resolved-decisions query (M007) + wellbeing_snapshots query
 *   - WEEK-09 — wellbeing variance gate: per-dim stddev computed in JS over
 *     the 7-day window; ANY dim < 0.4 → omit; <4 snapshots → omit (D-06)
 *
 * NOT in scope here:
 *   - Sonnet observation generation (Plan 29-02)
 *   - Stage-1 / Stage-2 single-question enforcement (Plan 29-02)
 *   - Pensieve persistence (Plan 29-02)
 *   - Cron-driven dispatch + seed migration (Plan 29-03)
 *
 * Mirror: src/episodic/sources.ts — same Drizzle direct-access shape, same
 * Luxon DST-safe day-boundary computation idiom (lines 60-83 dayBoundaryUtc).
 *
 * Tests: src/rituals/__tests__/weekly-review-sources.test.ts (Plan 29-01).
 *   - Unit tests for stddev / shouldIncludeWellbeing / computeWeekBoundary
 *   - Real-DB integration tests for loadWeeklyReviewContext (Docker postgres)
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import {
  decisions,
  episodicSummaries,
  wellbeingSnapshots,
} from '../db/schema.js';
import { getEpisodicSummariesRange } from '../pensieve/retrieve.js';
import { logger } from '../utils/logger.js';

// ── Public types ────────────────────────────────────────────────────────────

/**
 * Output of `loadWeeklyReviewContext` — the structured substrate Plan 29-02
 * passes to `assembleWeeklyReviewPrompt`. All four arrays (summaries,
 * resolvedDecisions, wellbeingSnapshots) are ordered by their date column
 * ascending. The variance object is the per-dim stddev across the window
 * (informational; the includeWellbeing boolean is the binding gate).
 */
export type WeeklyReviewContext = {
  summaries: (typeof episodicSummaries.$inferSelect)[];
  resolvedDecisions: (typeof decisions.$inferSelect)[];
  wellbeingSnapshots: (typeof wellbeingSnapshots.$inferSelect)[];
  wellbeingVariance: { energy: number; mood: number; anxiety: number };
  includeWellbeing: boolean;
};

// ── Constants (WEEK-09 / D-06) ──────────────────────────────────────────────

/**
 * Per-dim stddev threshold below which the wellbeing block is omitted from
 * the prompt. Spec: REQUIREMENTS.md WEEK-09 verbatim 0.4 — below this, the
 * 7-day series is statistically flat and citing it produces pseudo-
 * observations that erode trust (CONTEXT.md D-06 rationale).
 */
export const VARIANCE_THRESHOLD = 0.4;

/**
 * Minimum number of snapshots required for the variance gate to be evaluated
 * at all. With <4 data points stddev is statistically meaningless; we treat
 * "no signal" as "omit wellbeing" (D-06 conservative default; logged at
 * info-level so we can monitor real-week occurrence).
 */
export const INSUFFICIENT_DATA_THRESHOLD = 4;

// ── Date helpers ────────────────────────────────────────────────────────────

/**
 * Format a JS Date as a 'YYYY-MM-DD' calendar-date string in the given IANA
 * timezone. Mirrors the private helper in src/pensieve/retrieve.ts (also
 * used by getEpisodicSummariesRange for boundary keying); duplicated here
 * because that helper is not exported. en-CA locale yields ISO-style
 * 'YYYY-MM-DD' format on every Node 22 host regardless of locale env.
 */
function formatLocalDate(date: Date, tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(date);
}

/**
 * Compute the wall-clock-stable 7-day window ending at `now` (the Sunday
 * fire instant). Returns JS Dates representing the UTC instants
 * corresponding to `start-of-day(now - 7 days)` and `end-of-day(now)` in
 * `config.proactiveTimezone`.
 *
 * Uses Luxon for DST safety (mirrors src/episodic/sources.ts:dayBoundaryUtc
 * idiom). On a spring-forward week the UTC span is 7×24h-1h; on fall-back
 * 7×24h+1h; never the naïve fixed-millisecond-multiplier approach. Pitfall 2/3 mitigation.
 *
 * Window semantics: INCLUSIVE on both bounds. Both `weekStart` and
 * `weekEnd` are intended to be passed directly to
 * `getEpisodicSummariesRange(start, end)` whose WHERE clause is
 * `gte(start) AND lte(end)`.
 */
export function computeWeekBoundary(now: Date): {
  weekStart: Date;
  weekEnd: Date;
} {
  const local = DateTime.fromJSDate(now, { zone: config.proactiveTimezone });
  const weekEnd = local.endOf('day');
  // Spec: weekStart = startOf-day(now - 7 days). With endOf-day(now) as the
  // upper bound, the window contains 8 calendar days inclusive — covering
  // the prior 7 full days plus today (the Sunday fire day). This matches
  // 29-RESEARCH.md §2 verbatim and 29-PLAN Task 3 implementation snippet.
  const weekStart = local.minus({ days: 7 }).startOf('day');
  return {
    weekStart: weekStart.toUTC().toJSDate(),
    weekEnd: weekEnd.toUTC().toJSDate(),
  };
}

// ── Pure-function variance helpers (WEEK-09 / D-06) ─────────────────────────

/**
 * Population standard deviation of a numeric array. Returns 0 for arrays of
 * length < 2 (the convention used by the variance gate caller — fewer than
 * 2 points yields no spread; the INSUFFICIENT_DATA_THRESHOLD gate further
 * upstream catches the truly-low count case). Pure function, no I/O.
 */
export function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Per-spec WEEK-09 variance gate (D-06 ANY-dim-flat rule). Returns true when
 * the wellbeing block SHOULD be rendered into the prompt:
 *   - snapshots.length >= INSUFFICIENT_DATA_THRESHOLD (>= 4)
 *   - AND every per-dim stddev (energy, mood, anxiety) >= VARIANCE_THRESHOLD
 *
 * Returns false when ANY of the above fail. Logged at info level on failure
 * so real-week occurrence can be monitored.
 *
 * The ANY-dim-flat rule (vs ALL-dim-flat) is more conservative on purpose:
 * asymmetric coverage ("your mood was variable but your anxiety was a flat
 * 4") produces unfocused observations that break the one-observation
 * contract. Better to omit entirely.
 */
export function shouldIncludeWellbeing(
  snapshots: (typeof wellbeingSnapshots.$inferSelect)[],
): boolean {
  if (snapshots.length < INSUFFICIENT_DATA_THRESHOLD) {
    logger.info(
      { count: snapshots.length, threshold: INSUFFICIENT_DATA_THRESHOLD },
      'chris.weekly-review.wellbeing.insufficient-data',
    );
    return false;
  }
  const energySd = computeStdDev(snapshots.map((s) => s.energy));
  const moodSd = computeStdDev(snapshots.map((s) => s.mood));
  const anxietySd = computeStdDev(snapshots.map((s) => s.anxiety));
  const ok =
    energySd >= VARIANCE_THRESHOLD &&
    moodSd >= VARIANCE_THRESHOLD &&
    anxietySd >= VARIANCE_THRESHOLD;
  if (!ok) {
    logger.info(
      {
        count: snapshots.length,
        energySd,
        moodSd,
        anxietySd,
        threshold: VARIANCE_THRESHOLD,
      },
      'chris.weekly-review.wellbeing.variance-gate-failed',
    );
  }
  return ok;
}

// ── Data fetch (WEEK-01 substrate) ──────────────────────────────────────────

/**
 * Parallel-fetch the three substrate streams for one weekly review:
 *   - episodic_summaries via getEpisodicSummariesRange (M008 — Phase 29
 *     is the first production consumer of this M008 helper)
 *   - decisions WHERE status='resolved' AND resolvedAt BETWEEN [start, end]
 *     (M007)
 *   - wellbeing_snapshots WHERE snapshot_date BETWEEN [start, end] in
 *     config.proactiveTimezone
 *
 * Computes per-dim wellbeing variance + the includeWellbeing gate. Returns
 * a single WeeklyReviewContext object that Plan 29-02 maps directly into a
 * `WeeklyReviewPromptInput` for `assembleWeeklyReviewPrompt`.
 *
 * `weekStart` and `weekEnd` are JS Dates (typically the output of
 * `computeWeekBoundary(now)`); they are passed verbatim to
 * `getEpisodicSummariesRange` and to the resolvedAt range filter on the
 * decisions table. For the wellbeing query, the dates are converted to
 * 'YYYY-MM-DD' calendar strings in `config.proactiveTimezone` because
 * `wellbeing_snapshots.snapshot_date` is a `date` column (not timestamptz).
 *
 * Throws on DB error — the caller (Plan 29-02 fireWeeklyReview) catches
 * and routes to the existing notify-error path. Mirrors the contract of
 * src/episodic/sources.ts (which also throws; getEpisodicSummariesRange
 * itself absorbs its own errors and returns []).
 */
export async function loadWeeklyReviewContext(
  weekStart: Date,
  weekEnd: Date,
): Promise<WeeklyReviewContext> {
  const wellbeingStartStr = formatLocalDate(weekStart, config.proactiveTimezone);
  const wellbeingEndStr = formatLocalDate(weekEnd, config.proactiveTimezone);

  const [summaries, resolvedDecisions, snapshots] = await Promise.all([
    getEpisodicSummariesRange(weekStart, weekEnd),
    db
      .select()
      .from(decisions)
      .where(
        and(
          eq(decisions.status, 'resolved'),
          gte(decisions.resolvedAt, weekStart),
          lte(decisions.resolvedAt, weekEnd),
        ),
      )
      .orderBy(asc(decisions.resolvedAt)),
    db
      .select()
      .from(wellbeingSnapshots)
      .where(
        and(
          gte(wellbeingSnapshots.snapshotDate, wellbeingStartStr),
          lte(wellbeingSnapshots.snapshotDate, wellbeingEndStr),
        ),
      )
      .orderBy(asc(wellbeingSnapshots.snapshotDate)),
  ]);

  const wellbeingVariance = {
    energy: computeStdDev(snapshots.map((s) => s.energy)),
    mood: computeStdDev(snapshots.map((s) => s.mood)),
    anxiety: computeStdDev(snapshots.map((s) => s.anxiety)),
  };
  const includeWellbeing = shouldIncludeWellbeing(snapshots);

  return {
    summaries,
    resolvedDecisions,
    wellbeingSnapshots: snapshots,
    wellbeingVariance,
    includeWellbeing,
  };
}
