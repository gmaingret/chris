/**
 * Decision-deadline trigger for proactive messaging.
 *
 * Queries the decisions table for open decisions whose resolve_by timestamp
 * has passed, selects the oldest-due candidate, transitions it from 'open'
 * to 'due' via the transitionDecision chokepoint, and returns a context
 * string that prompts Greg to review his prediction.
 *
 * Priority: 2 (silence=1, deadline=2, commitment=3, pattern=4, thread=5)
 *
 * Error handling:
 *   - OptimisticConcurrencyError → re-query and retry once with next candidate
 *   - InvalidTransitionError → skip silently (already transitioned)
 *   - Any other error → re-throw (caller handles)
 */

import { and, eq, lte, asc } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { decisions } from '../../db/schema.js';
import { transitionDecision } from '../../decisions/lifecycle.js';
import {
  OptimisticConcurrencyError,
  InvalidTransitionError,
} from '../../decisions/errors.js';
import type { TriggerResult, TriggerDetector } from './types.js';

/** 48 hours in milliseconds — threshold for stale-context framing. */
export const STALE_CONTEXT_THRESHOLD_MS = 48 * 60 * 60 * 1000;

const DEADLINE_PRIORITY = 2;

/** Build the context string for a due decision. */
function buildContext(
  candidate: { prediction: string; falsificationCriterion: string; resolveBy: Date },
  staleness: number,
): string {
  const criterion = candidate.falsificationCriterion;
  if (staleness > STALE_CONTEXT_THRESHOLD_MS) {
    const dateStr = candidate.resolveBy.toISOString().slice(0, 10);
    const daysPast = Math.round(staleness / 86400000);
    return `On ${dateStr} you predicted: '${candidate.prediction}'. It's now ${daysPast} days past your deadline. Your falsification criterion was: '${criterion}'.`;
  }
  return `Your deadline just passed for a prediction you made: '${candidate.prediction}'. Your falsification criterion was: '${criterion}'.`;
}

export function createDeadlineTrigger(): TriggerDetector {
  return {
    async detect(): Promise<TriggerResult> {
      const notTriggered = (context: string): TriggerResult => ({
        triggered: false,
        triggerType: 'decision-deadline',
        priority: DEADLINE_PRIORITY,
        context,
      });

      const now = new Date();

      // SQL-first: find oldest overdue open decision
      const queryDueDecisions = () =>
        db
          .select({
            id: decisions.id,
            prediction: decisions.prediction,
            falsificationCriterion: decisions.falsificationCriterion,
            resolveBy: decisions.resolveBy,
          })
          .from(decisions)
          .where(and(eq(decisions.status, 'open'), lte(decisions.resolveBy, now)))
          .orderBy(asc(decisions.resolveBy))
          .limit(1);

      const rows = await queryDueDecisions();

      if (rows.length === 0) {
        return notTriggered('No due decisions');
      }

      let candidate = rows[0]!;

      try {
        await transitionDecision(candidate.id, 'open', 'due', { actor: 'sweep' });
      } catch (err) {
        if (err instanceof OptimisticConcurrencyError) {
          // Another process already transitioned this one — retry with next candidate
          const retryRows = await queryDueDecisions();
          if (retryRows.length === 0) {
            return notTriggered('No due decisions after retry');
          }
          candidate = retryRows[0]!;
          await transitionDecision(candidate.id, 'open', 'due', { actor: 'sweep' });
        } else if (err instanceof InvalidTransitionError) {
          return notTriggered('Decision already transitioned');
        } else {
          throw err;
        }
      }

      const staleness = now.getTime() - candidate.resolveBy.getTime();
      const context = buildContext(candidate, staleness);

      return {
        triggered: true,
        triggerType: 'decision-deadline',
        priority: DEADLINE_PRIORITY,
        context,
        evidence: [
          `Decision ID: ${candidate.id}`,
          `Resolve by: ${candidate.resolveBy.toISOString()}`,
          `Staleness: ${Math.round(staleness / 3600000)}h`,
        ],
      };
    },
  };
}
