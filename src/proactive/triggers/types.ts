/**
 * Trigger system types for proactive messaging.
 *
 * Each trigger detector evaluates a specific condition (silence, commitment, etc.)
 * and returns a TriggerResult indicating whether proactive outreach is warranted.
 */

export interface TriggerResult {
  triggered: boolean;
  triggerType: 'silence' | 'commitment' | 'pattern' | 'thread';
  priority: number;
  context: string;
  evidence?: string[];
}

export interface TriggerDetector {
  detect(): Promise<TriggerResult>;
}
