/**
 * Absolute-date anchor for LLM prompts.
 *
 * Why: JOURNAL/PROACTIVE prompts historically carried no current-date signal.
 * When the commitment trigger hands Sonnet a stale INTENTION like "le 28 avril
 * je pars à Batumi" with only an age-in-days, the model hallucinates whether
 * the 28th is past or future. Grounding every mode with today's ISO date +
 * weekday in Greg's timezone removes that ambiguity.
 *
 * Paris is the operating timezone (config.proactiveTimezone default). Callers
 * that need a different zone may pass one, but the default matches where Greg
 * actually is.
 */
export interface TodayAnchor {
  iso: string;       // YYYY-MM-DD
  weekday: string;   // English long form, e.g. "Friday"
  timezone: string;  // IANA zone used to compute the anchor
}

export function getTodayInTimezone(
  timezone: string = process.env.PROACTIVE_TIMEZONE || 'Europe/Paris',
  now: Date = new Date(),
): TodayAnchor {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  }).format(now);

  return { iso, weekday, timezone };
}

/**
 * Render the anchor as a one-line prompt prefix.
 * Example: "Today's date: 2026-04-24 (Friday, Europe/Paris)."
 */
export function formatTodayLine(anchor: TodayAnchor = getTodayInTimezone()): string {
  return `Today's date: ${anchor.iso} (${anchor.weekday}, ${anchor.timezone}).`;
}
