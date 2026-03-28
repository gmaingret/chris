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
    totalGapMs += timestamps[i].getTime() - timestamps[i + 1].getTime();
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
      const oldest = timestamps[timestamps.length - 1];
      const newest = timestamps[0];

      // Check that history spans at least baselineDays
      const historySpanMs = newest.getTime() - oldest.getTime();
      const historySpanDays = historySpanMs / (MS_PER_HOUR * HOURS_PER_DAY);

      if (historySpanDays < config.baselineDays) {
        return notTriggered('Insufficient history');
      }

      // Compute average gap and current gap
      const averageGapHours = computeAverageGap(timestamps);
      const currentGapHours =
        (Date.now() - newest.getTime()) / MS_PER_HOUR;

      // Check threshold
      if (currentGapHours > config.thresholdMultiplier * averageGapHours) {
        return {
          triggered: true,
          triggerType: 'silence',
          priority: 1,
          context: `John has been quiet for ${formatDuration(currentGapHours)}. His usual rhythm is about ${formatDuration(averageGapHours)} between messages.`,
          evidence: [
            `Current gap: ${formatDuration(currentGapHours)}`,
            `Average gap: ${formatDuration(averageGapHours)}`,
            `Threshold: ${config.thresholdMultiplier}× average`,
            `History: ${messages.length} messages over ${Math.round(historySpanDays)} days`,
          ],
        };
      }

      return notTriggered(
        `Current gap (${formatDuration(currentGapHours)}) within normal range (threshold: ${formatDuration(config.thresholdMultiplier * averageGapHours)})`,
      );
    },
  };
}
