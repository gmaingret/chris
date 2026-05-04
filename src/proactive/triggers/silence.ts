/**
 * Silence detection trigger for proactive messaging.
 *
 * Queries the conversations table for USER messages, computes an average
 * messaging rhythm from `baselineDays`+ days of history, and fires when
 * the current silence gap exceeds `thresholdMultiplier × averageGap`.
 *
 * Observability: Returns structured TriggerResult with human-readable
 * context string describing silence duration and normal rhythm.
 */

import { eq, and, desc } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { conversations } from '../../db/schema.js';
import type { TriggerResult, TriggerDetector } from './types.js';

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 1000 * 60 * 60;

// Absolute floor: never claim "silence" for a normal overnight or same-day
// gap, regardless of how dense daytime conversation makes the rolling
// average. 36h means a real calendar day must pass without a USER message
// before the silence trigger can fire.
const ABSOLUTE_FLOOR_HOURS = 36;

// Compute the average gap over the last 7 days only — the all-history
// average is dominated by long-ago dense-conversation bursts that depress
// the threshold below normal sleep gaps.
const RECENT_WINDOW_DAYS = 7;

interface SilenceConfig {
  thresholdMultiplier: number;
  baselineDays: number;
}

/**
 * Format hours into a human-readable duration string using days.
 * Examples: "0.5 days", "1.0 day", "3.2 days"
 */
function formatDuration(hours: number): string {
  const days = hours / HOURS_PER_DAY;
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} ${rounded === 1.0 ? 'day' : 'days'}`;
}

/**
 * Compute the average gap (in hours) between consecutive timestamps.
 * Assumes timestamps are sorted descending (newest first).
 */
function computeAverageGap(timestamps: Date[]): number {
  if (timestamps.length < 2) return 0;

  let totalGapMs = 0;
  for (let i = 0; i < timestamps.length - 1; i++) {
    totalGapMs += timestamps[i]!.getTime() - timestamps[i + 1]!.getTime();
  }

  return totalGapMs / (timestamps.length - 1) / MS_PER_HOUR;
}

export function createSilenceTrigger(
  chatId: bigint,
  config: SilenceConfig,
): TriggerDetector {
  return {
    async detect(): Promise<TriggerResult> {
      const notTriggered = (context: string): TriggerResult => ({
        triggered: false,
        triggerType: 'silence',
        priority: 1,
        context,
      });

      // Query USER messages ordered by created_at DESC
      const messages = await db
        .select({ createdAt: conversations.createdAt })
        .from(conversations)
        .where(
          and(
            eq(conversations.chatId, chatId),
            eq(conversations.role, 'USER'),
          ),
        )
        .orderBy(desc(conversations.createdAt));

      // Need at least 2 messages to compute gaps
      if (messages.length < 2) {
        return notTriggered('Insufficient history');
      }

      const timestamps = messages.map((m) => new Date(m.createdAt!));
      const oldest = timestamps[timestamps.length - 1]!;
      const newest = timestamps[0]!;

      // Check that history spans at least baselineDays
      const historySpanMs = newest.getTime() - oldest.getTime();
      const historySpanDays = historySpanMs / (MS_PER_HOUR * HOURS_PER_DAY);

      if (historySpanDays < config.baselineDays) {
        return notTriggered('Insufficient history');
      }

      // Compute average gap over the last RECENT_WINDOW_DAYS only (more
      // representative of current rhythm). Fall back to all-history average
      // when the recent window is too sparse to support a meaningful average.
      const recentCutoffMs =
        Date.now() - RECENT_WINDOW_DAYS * HOURS_PER_DAY * MS_PER_HOUR;
      const recentTimestamps = timestamps.filter(
        (t) => t.getTime() >= recentCutoffMs,
      );
      const usingRecentWindow = recentTimestamps.length >= 2;
      const averageGapHours = usingRecentWindow
        ? computeAverageGap(recentTimestamps)
        : computeAverageGap(timestamps);

      const currentGapHours =
        (Date.now() - newest.getTime()) / MS_PER_HOUR;

      // Effective threshold is the LARGER of (a) absolute 36h floor and
      // (b) configured multiplier × recent average. This ensures normal
      // overnight gaps never count as silence, while genuine multi-day
      // absences still fire.
      const dynamicThreshold = config.thresholdMultiplier * averageGapHours;
      const effectiveThreshold = Math.max(
        ABSOLUTE_FLOOR_HOURS,
        dynamicThreshold,
      );

      if (currentGapHours > effectiveThreshold) {
        return {
          triggered: true,
          triggerType: 'silence',
          priority: 1,
          context: `Greg has been quiet for ${formatDuration(currentGapHours)}. His usual rhythm is about ${formatDuration(averageGapHours)} between messages.`,
          evidence: [
            `Current gap: ${formatDuration(currentGapHours)}`,
            `Recent avg gap (${RECENT_WINDOW_DAYS}d window, ${recentTimestamps.length} msgs): ${formatDuration(averageGapHours)}${usingRecentWindow ? '' : ' (fell back to all-history — recent window sparse)'}`,
            `Dynamic threshold: ${formatDuration(dynamicThreshold)} (${config.thresholdMultiplier}× recent avg)`,
            `Effective threshold: ${formatDuration(effectiveThreshold)} (max of ${ABSOLUTE_FLOOR_HOURS}h floor and dynamic)`,
            `History: ${messages.length} messages over ${Math.round(historySpanDays)} days`,
          ],
        };
      }

      return notTriggered(
        `Current gap (${formatDuration(currentGapHours)}) within normal range (effective threshold: ${formatDuration(effectiveThreshold)} = max of ${ABSOLUTE_FLOOR_HOURS}h floor and ${formatDuration(dynamicThreshold)} dynamic)`,
      );
    },
  };
}
