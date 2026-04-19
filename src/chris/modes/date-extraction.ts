/**
 * Query-date extraction for INTERROGATE mode (Phase 22 RETR-04).
 *
 * Three-tier priority:
 *   1. Regex fast-path: absolute ISO date (YYYY-MM-DD)
 *   2. Regex fast-path: "N units ago" (EN/FR/RU)
 *   3. Regex fast-path: month-name + day-of-month (EN/FR/RU)
 *   4. Haiku classifier — invoked ONLY when fast-path returns null AND
 *      at least one DATE_HEURISTIC_KEYWORDS entry appears in the query
 *      (gates API cost: queries with no date signal whatsoever skip
 *      the LLM entirely; verified by test assertions).
 *
 * Never throws — returns null on any failure (invalid JSON, malformed
 * date string, SDK exception). Errors are logged at warn under the
 * 'chris.date-extraction.haiku-error' key for diagnostic visibility.
 */

import { anthropic, HAIKU_MODEL } from '../../llm/client.js';
import { logger } from '../../utils/logger.js';

/**
 * Keywords that suggest a date reference is probable. When the regex
 * fast-path returns null, the Haiku classifier is only invoked if at least
 * one of these keywords (lowercased) appears in the query. This gates
 * API cost — queries with no date signal whatsoever skip the LLM entirely.
 * Covers EN/FR/RU per D020-D021 multilingual coverage.
 */
export const DATE_HEURISTIC_KEYWORDS: readonly string[] = [
  // English
  'ago', 'last', 'yesterday', 'week', 'month', 'year',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
  // French
  'hier', 'dernier', 'dernière', 'semaine', 'mois', 'année',
  'il y a',
  'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche',
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
  // Russian
  'назад', 'вчера', 'прошл', 'неделя', 'неделю', 'месяц', 'год',
  'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье',
  'январ', 'феврал', 'март', 'апрел', 'мая', 'июн',
  'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр',
] as const;

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Attempt to extract an ISO date 'YYYY-MM-DD' directly from the query via
 * regex. Returns a Date anchored at 12:00 UTC (noon) or null.
 *
 * Noon-UTC anchor (WR-02): consumers like `getEpisodicSummary` format this
 * Date back to a calendar-day string in `config.proactiveTimezone` via
 * `Intl.DateTimeFormat`. Midnight-UTC anchoring drifts by one day in any
 * negative-offset tz (America/*, UTC−5 to UTC−10) because midnight UTC maps
 * to the prior local day. Noon UTC buys ±12h of tz slack, correctly
 * resolving the same calendar day for every IANA tz on Earth.
 */
function matchIsoDate(text: string): Date | null {
  const m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(iso + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  return d;
}

type RelativeUnit = 'day' | 'week' | 'month' | 'year';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const DAYS_PER_UNIT: Record<RelativeUnit, number> = {
  day: 1, week: 7, month: 30, year: 365,
};

/**
 * Match 'N (days|weeks|months|years) ago' — EN/FR/RU. Returns a Date
 * now-shifted by the right number of days, normalized to UTC midnight,
 * or null when no pattern matches. `now` is injectable for tests.
 *
 * EN supports both digit form ("3 weeks ago") and word form
 * ("three weeks ago"). FR and RU only accept digit form here — word
 * forms in those languages route through the Haiku fallback (the
 * heuristic keywords still trigger the API call).
 */
function matchRelativeAgo(text: string, now: Date): Date | null {
  const q = text.toLowerCase();

  const enNum = q.match(/\b(\d+)\s+(day|week|month|year)s?\s+ago\b/);
  const enWord = q.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|week|month|year)s?\s+ago\b/,
  );
  const frNum = q.match(/il y a\s+(\d+)\s+(jour|semaine|mois|an|année)s?/);
  // Cyrillic suffix character class — `\w` in JavaScript does not match
  // Cyrillic letters by default, so the trailing inflection suffix
  // ("недели", "месяца", "лет") needs an explicit Unicode block.
  const ruNum = q.match(/(\d+)\s+(дн|дней|недел|месяц|год|лет)[\u0400-\u04FF]*\s+назад/);

  let n: number | null = null;
  let unit: RelativeUnit | null = null;

  // Each match arm: groups [1] and [2] are required by the regex shape, so
  // when the outer match is truthy the indexed values are guaranteed
  // strings. The non-null assertions keep noUncheckedIndexedAccess happy.
  if (enNum) {
    n = parseInt(enNum[1]!, 10);
    unit = enNum[2]! as RelativeUnit;
  } else if (enWord) {
    n = NUMBER_WORDS[enWord[1]!] ?? null;
    unit = enWord[2]! as RelativeUnit;
  } else if (frNum) {
    n = parseInt(frNum[1]!, 10);
    const u = frNum[2]!;
    unit = u.startsWith('jour')
      ? 'day'
      : u.startsWith('semaine')
        ? 'week'
        : u === 'mois'
          ? 'month'
          : 'year';
  } else if (ruNum) {
    n = parseInt(ruNum[1]!, 10);
    const u = ruNum[2]!;
    unit = u.startsWith('дн')
      ? 'day'
      : u.startsWith('недел')
        ? 'week'
        : u.startsWith('месяц')
          ? 'month'
          : 'year';
  }

  if (n == null || unit == null) return null;

  const shifted = new Date(now.getTime() - n * DAYS_PER_UNIT[unit] * 86_400_000);
  // Normalize to NOON UTC for consistency with absolute matches. Noon-UTC
  // anchor (WR-02): buys ±12h tz slack so downstream consumers formatting
  // back to config.proactiveTimezone resolve the same calendar day in every
  // IANA tz (midnight-UTC would drift one day in negative-offset zones).
  shifted.setUTCHours(12, 0, 0, 0);
  return shifted;
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  janvier: 0, février: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, août: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11,
  // Russian month-name prefixes (genitive forms vary; prefix-match keeps
  // the regex tractable). 'мая' is a complete word — listed verbatim.
  'январ': 0, 'феврал': 1, 'март': 2, 'апрел': 3, 'мая': 4, 'июн': 5,
  'июл': 6, 'август': 7, 'сентябр': 8, 'октябр': 9, 'ноябр': 10, 'декабр': 11,
};

/**
 * Match EN/FR/RU month-name + day-of-month (e.g., "April 1st", "1er avril",
 * "1 апреля"). Year inference: if the resolved month+day has not yet
 * happened in the current calendar year (i.e., the candidate is in the
 * future), assume current year still — Greg's typical query "what
 * happened on April 1st" sent on April 22 means this April 1, not last.
 * If the candidate is in the future, fall back to prior year.
 *
 * Returns a Date at midnight UTC or null.
 */
function matchMonthDay(text: string, now: Date): Date | null {
  const q = text.toLowerCase();
  // EN: "April 1", "April 1st", "April 1, 2026"
  const en = q.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:\s*st|\s*nd|\s*rd|\s*th)?(?:\s*,\s*(\d{4}))?/,
  );
  // FR: "1 avril", "1er avril", "1 avril 2026"
  const fr = q.match(
    /(\d{1,2})(?:er)?\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)(?:\s+(\d{4}))?/,
  );
  // RU: "1 апреля" (genitive). Prefix-match against the MONTHS keys.
  const ru = q.match(
    /(\d{1,2})\s+(январ|феврал|март|апрел|мая|июн|июл|август|сентябр|октябр|ноябр|декабр)/,
  );

  let monthIdx: number | null = null;
  let day: number | null = null;
  let year: number | null = null;

  if (en) {
    monthIdx = MONTHS[en[1]!] ?? null;
    day = parseInt(en[2]!, 10);
    year = en[3] ? parseInt(en[3], 10) : null;
  } else if (fr) {
    day = parseInt(fr[1]!, 10);
    monthIdx = MONTHS[fr[2]!] ?? null;
    year = fr[3] ? parseInt(fr[3], 10) : null;
  } else if (ru) {
    day = parseInt(ru[1]!, 10);
    monthIdx = MONTHS[ru[2]!] ?? null;
  }

  if (monthIdx == null || day == null) return null;

  if (year == null) {
    const thisYear = now.getUTCFullYear();
    // Noon UTC (WR-02) — same rationale as matchIsoDate / matchRelativeAgo:
    // downstream consumers format back to config.proactiveTimezone, so noon
    // UTC anchors to the correct calendar day in every IANA tz.
    const candidate = new Date(Date.UTC(thisYear, monthIdx, day, 12));
    // If the candidate falls in the future relative to now, the user
    // most likely means last year. (E.g., on Jan 5 a query about
    // "December 30" means last year's Dec 30.) If the candidate is
    // today-or-past, current year is correct.
    year = candidate.getTime() > now.getTime() ? thisYear - 1 : thisYear;
  }
  const d = new Date(Date.UTC(year, monthIdx, day, 12));
  if (isNaN(d.getTime())) return null;
  // WR-04: Date.UTC silently rolls calendar-overflow — Feb 30 → March 2,
  // April 31 → May 1. isNaN does not catch this because the produced Date
  // is valid, just not the date the user typed. Reject any tuple that
  // Date.UTC renormalized to a different (month, day) pair.
  if (d.getUTCMonth() !== monthIdx || d.getUTCDate() !== day) return null;
  return d;
}

function hasDateHeuristic(text: string): boolean {
  const q = text.toLowerCase();
  return DATE_HEURISTIC_KEYWORDS.some((kw) => q.includes(kw));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract a query-about-date from the user's text. Regex/keyword fast-path
 * first (ISO date → N-units-ago → month-name+day). If the fast-path returns
 * null AND at least one DATE_HEURISTIC_KEYWORDS match is present, call
 * Haiku as a fallback classifier. If no heuristic match, return null
 * without any API call (the gating contract that keeps the latency budget
 * intact for "what is my name"-style queries).
 *
 * Returns null on any failure (never throws).
 *
 * `now` is injectable for deterministic tests (default: `new Date()`).
 */
export async function extractQueryDate(
  text: string,
  language?: string,
  now: Date = new Date(),
): Promise<Date | null> {
  // Fast-path 1: ISO date
  const iso = matchIsoDate(text);
  if (iso) return iso;

  // Fast-path 2: relative "N units ago"
  const rel = matchRelativeAgo(text, now);
  if (rel) return rel;

  // Fast-path 3: month-name + day-of-month
  const md = matchMonthDay(text, now);
  if (md) return md;

  // No regex match. Gate Haiku on heuristic keyword presence — queries
  // like "what is my name" skip the LLM entirely.
  if (!hasDateHeuristic(text)) return null;

  try {
    const response = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 64,
      system: `You extract a single calendar date from a user query.
Output JSON only: { "date": "YYYY-MM-DD" } or { "date": null } if no specific date is identifiable.
The current date is ${now.toISOString().slice(0, 10)}.
"Last Tuesday" means the most recent past Tuesday. "Last week" means 7 days ago. "Yesterday" means 1 day ago.
Respond with ONLY the JSON object, no prose.`,
      messages: [{ role: 'user', content: text }],
    });

    const block = response.content.find(
      (b: { type: string }) => b.type === 'text',
    );
    if (!block || block.type !== 'text') return null;

    const parsed = JSON.parse(
      (block as { type: 'text'; text: string }).text.trim(),
    );
    if (typeof parsed.date !== 'string') return null;
    // Noon UTC (WR-02) — consistent with regex fast-paths. See matchIsoDate.
    const d = new Date(parsed.date + 'T12:00:00Z');
    if (isNaN(d.getTime())) return null;
    return d;
  } catch (error) {
    logger.warn(
      {
        text: text.slice(0, 80),
        language,
        error: error instanceof Error ? error.message : String(error),
      },
      'chris.date-extraction.haiku-error',
    );
    return null;
  }
}
