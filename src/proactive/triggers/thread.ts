/**
 * Unresolved thread trigger — wraps OpusAnalysisResult.thread into
 * a TriggerDetector with priority 5.
 *
 * Priority: 5 (silence=1, deadline=2, commitment=3, pattern=4, thread=5)
 *
 * Fires when Opus detects an unresolved thread with confidence ≥ 0.5.
 */

import type { TriggerDetector, TriggerResult } from './types.js';
import type { OpusAnalysisResult } from './opus-analysis.js';

const THREAD_PRIORITY = 5;
const CONFIDENCE_THRESHOLD = 0.5;

export function createThreadTrigger(
  analysis: OpusAnalysisResult,
): TriggerDetector {
  return {
    async detect(): Promise<TriggerResult> {
      const { thread } = analysis;

      if (thread.detected && thread.confidence >= CONFIDENCE_THRESHOLD) {
        return {
          triggered: true,
          triggerType: 'thread',
          priority: THREAD_PRIORITY,
          context: thread.description,
          evidence: thread.evidence,
        };
      }

      return {
        triggered: false,
        triggerType: 'thread',
        priority: THREAD_PRIORITY,
        context: thread.description || 'No unresolved thread detected',
      };
    },
  };
}
