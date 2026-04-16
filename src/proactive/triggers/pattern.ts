/**
 * Pattern recurrence trigger — wraps OpusAnalysisResult.pattern into
 * a TriggerDetector with priority 3.
 *
 * Fires when Opus detects a recurring pattern with confidence ≥ 0.5.
 */

import type { TriggerDetector, TriggerResult } from './types.js';
import type { OpusAnalysisResult } from './opus-analysis.js';

const PATTERN_PRIORITY = 3;
const CONFIDENCE_THRESHOLD = 0.5;

export function createPatternTrigger(
  analysis: OpusAnalysisResult,
): TriggerDetector {
  return {
    async detect(): Promise<TriggerResult> {
      const { pattern } = analysis;

      if (pattern.detected && pattern.confidence >= CONFIDENCE_THRESHOLD) {
        return {
          triggered: true,
          triggerType: 'pattern',
          priority: PATTERN_PRIORITY,
          context: pattern.description,
          evidence: pattern.evidence,
        };
      }

      return {
        triggered: false,
        triggerType: 'pattern',
        priority: PATTERN_PRIORITY,
        context: pattern.description || 'No recurring pattern detected',
      };
    },
  };
}
