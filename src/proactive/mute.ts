import { anthropic, HAIKU_MODEL, SONNET_MODEL } from '../llm/client.js';
import { MUTE_DETECTION_PROMPT } from '../llm/prompts.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type MuteClassification =
  | { muted: false }
  | { muted: true; muteUntil: Date; durationDescription: string };

interface DurationHint {
  days?: number;
  weeks?: number;
  until_weekday?: string;
  until_date?: string;
}

interface HaikuMuteResponse {
  mute: boolean;
  duration?: DurationHint;
}

// ── Weekday mapping ────────────────────────────────────────────────────────

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// ── Duration parser ────────────────────────────────────────────────────────

/**
 * Convert a structured duration hint from Haiku into a concrete Date.
 * Uses the proactive timezone from config for date computations.
 */
export function parseMuteDuration(hint: DurationHint): Date {
  const now = new Date();

  if (hint.days != null && hint.days > 0) {
    return new Date(now.getTime() + hint.days * 24 * 60 * 60 * 1000);
  }

  if (hint.weeks != null && hint.weeks > 0) {
    return new Date(now.getTime() + hint.weeks * 7 * 24 * 60 * 60 * 1000);
  }

  if (hint.until_weekday != null) {
    const targetDay = WEEKDAYS[hint.until_weekday.toLowerCase()];
    if (targetDay == null) {
      // Unknown weekday — default to 7 days
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    const currentDay = now.getDay();
    let daysUntil = targetDay - currentDay;
    // If the weekday is today or already passed this week, target next week
    if (daysUntil <= 0) {
      daysUntil += 7;
    }

    return new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
  }

  if (hint.until_date != null) {
    const target = new Date(hint.until_date + 'T23:59:59');
    // If the date is in the past, default to 7 days
    if (target.getTime() <= now.getTime()) {
      return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    }
    return target;
  }

  // No recognizable duration — default to 7 days
  return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
}

// ── Mute intent detection ──────────────────────────────────────────────────

/**
 * Classify whether a message is a mute request using Haiku.
 * Returns { muted: false } on any error (safe default — message proceeds
 * to normal processing).
 */
export async function detectMuteIntent(text: string): Promise<MuteClassification> {
  const start = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 150,
      system: MUTE_DETECTION_PROMPT,
      messages: [{ role: 'user', content: text }],
    });

    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn({ error: 'No text block in Haiku response' }, 'chris.mute.detect');
      return { muted: false };
    }

    // K003: Strip markdown fences before parsing
    let jsonText = (textBlock as { type: 'text'; text: string }).text.trim();
    const fenceMatch = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();

    const parsed: HaikuMuteResponse = JSON.parse(jsonText);

    if (!parsed.mute) {
      const latencyMs = Date.now() - start;
      logger.info({ muted: false, latencyMs }, 'chris.mute.detected');
      return { muted: false };
    }

    const muteUntil = parseMuteDuration(parsed.duration ?? {});
    const durationDescription = formatDuration(muteUntil);

    const latencyMs = Date.now() - start;
    logger.info(
      { muted: true, muteUntil: muteUntil.toISOString(), durationDescription, latencyMs },
      'chris.mute.detected',
    );

    return { muted: true, muteUntil, durationDescription };
  } catch (error) {
    const latencyMs = Date.now() - start;
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        latencyMs,
      },
      'chris.mute.detect',
    );
    // Safe default — message proceeds to normal processing
    return { muted: false };
  }
}

// ── Acknowledgment generation ──────────────────────────────────────────────

/**
 * Generate a natural acknowledgment from Chris about being quiet until a date.
 * Uses Sonnet for Chris's natural voice.
 */
export async function generateMuteAcknowledgment(
  muteUntil: Date,
  timezone: string,
): Promise<string> {
  const dateStr = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(muteUntil);

  const response = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 200,
    system: `You are Chris, Greg's close friend. Greg has asked you to be quiet for a while. Acknowledge this naturally and warmly in 1-2 sentences. You'll be quiet until ${dateStr}. Don't be robotic or formal — just be a friend who respects boundaries. Don't repeat the exact date back mechanically.`,
    messages: [{ role: 'user', content: `Be quiet until ${dateStr}.` }],
  });

  const textBlock = response.content.find(
    (block: { type: string }) => block.type === 'text',
  );
  if (!textBlock || textBlock.type !== 'text') {
    // Fallback acknowledgment if Sonnet response is empty
    return `Got it — I'll give you some space until ${dateStr}.`;
  }

  return (textBlock as { type: 'text'; text: string }).text.trim();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(until: Date): string {
  const diffMs = until.getTime() - Date.now();
  const days = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 1) return '1 day';
  if (days < 7) return `${days} days`;
  const weeks = Math.round(days / 7);
  if (weeks === 1) return '1 week';
  return `${weeks} weeks`;
}
