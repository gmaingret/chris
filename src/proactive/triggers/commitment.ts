/**
 * Commitment staleness trigger for proactive messaging.
 *
 * Queries pensieveEntries for INTENTION entries older than `staleDays`
 * and fires when John has made commitments he hasn't followed up on.
 *
 * Priority: 3 (silence=1, deadline=2, commitment=3, pattern=4, thread=5)
 *
 * Observability: Returns structured TriggerResult with human-readable
 * context describing the stale commitment and its age.
 */

import { and, lt, inArray, isNull, asc } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { pensieveEntries } from '../../db/schema.js';
import type { TriggerResult, TriggerDetector } from './types.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MAX_CONTEXT_LENGTH = 200;
const COMMITMENT_PRIORITY = 3;

/**
 * Truncate text to maxLen characters, appending "…" if truncated.
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

export function createCommitmentTrigger(staleDays: number): TriggerDetector {
  return {
    async detect(): Promise<TriggerResult> {
      const notTriggered = (context: string): TriggerResult => ({
        triggered: false,
        triggerType: 'commitment',
        priority: COMMITMENT_PRIORITY,
        context,
      });

      const cutoff = new Date(Date.now() - staleDays * MS_PER_DAY);

      // Query INTENTION entries older than staleDays, not soft-deleted, oldest first
      const staleEntries = await db
        .select({
          id: pensieveEntries.id,
          content: pensieveEntries.content,
          createdAt: pensieveEntries.createdAt,
        })
        .from(pensieveEntries)
        .where(
          and(
            inArray(pensieveEntries.epistemicTag, ['INTENTION']),
            lt(pensieveEntries.createdAt, cutoff),
            isNull(pensieveEntries.deletedAt),
          ),
        )
        .orderBy(asc(pensieveEntries.createdAt))
        .limit(5);

      if (staleEntries.length === 0) {
        return notTriggered('No stale commitments found');
      }

      // Use the oldest entry (first in ASC order)
      const oldest = staleEntries[0]!;
      const oldestDate = new Date(oldest.createdAt!);
      const ageDays = Math.round(
        (Date.now() - oldestDate.getTime()) / MS_PER_DAY,
      );

      const evidence = staleEntries.map((e) => {
        const age = Math.round(
          (Date.now() - new Date(e.createdAt!).getTime()) / MS_PER_DAY,
        );
        return `Entry ${e.id}: ${age} days old`;
      });

      return {
        triggered: true,
        triggerType: 'commitment',
        priority: COMMITMENT_PRIORITY,
        context: `John made a commitment ${ageDays} days ago: "${truncate(oldest.content, MAX_CONTEXT_LENGTH)}". There's been no follow-up.`,
        evidence,
      };
    },
  };
}
