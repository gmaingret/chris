/**
 * Phase 14 CAP-05 — resolve_by natural-language parser + clarifier ladder.
 *
 * D-18: Haiku NL parser with 2s timeout, fail-soft to null.
 * D-19: Clarifier ladder (week/month/3months/year) + announced +30d default.
 */

import { callLLM } from '../llm/client.js';
import { RESOLVE_BY_PARSER_PROMPT } from '../llm/prompts.js';
import { logger } from '../utils/logger.js';

const RESOLVE_BY_TIMEOUT_MS = 2000;  // D-18

export const CLARIFIER_LADDER_DAYS = {
  week: 7,
  month: 30,
  threeMonths: 90,
  year: 365,
} as const;
export type ClarifierChoice = keyof typeof CLARIFIER_LADDER_DAYS;

/**
 * Parse a natural-language timeframe into an absolute Date via Haiku.
 * Returns null on timeout, parse failure, or unparseable input (signals
 * caller to surface clarifier menu).
 */
export async function parseResolveBy(naturalText: string): Promise<Date | null> {
  const start = Date.now();
  try {
    // Supply today's date as explicit context so Haiku can resolve relative
    // expressions ("next month", "in 3 weeks") against a known anchor rather
    // than its training cutoff (WR-05).
    const userContent = JSON.stringify({
      today: new Date().toISOString().slice(0, 10),
      text: naturalText,
    });
    const raw = await Promise.race([
      callLLM(RESOLVE_BY_PARSER_PROMPT, userContent, 50),
      new Promise<null>((r) => setTimeout(() => r(null), RESOLVE_BY_TIMEOUT_MS)),
    ]);
    if (!raw) {
      logger.warn({ latencyMs: Date.now() - start }, 'decisions.resolve_by.timeout');
      return null;
    }
    const cleaned = stripFences(raw);
    const parsed = JSON.parse(cleaned);
    if (!parsed.iso || typeof parsed.iso !== 'string') return null;
    const d = new Date(parsed.iso);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch (error) {
    logger.warn({ error: errMsg(error), latencyMs: Date.now() - start }, 'decisions.resolve_by.error');
    return null;
  }
}

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}

/**
 * Match a clarifier reply to a ladder choice. Dispatches on `language`
 * so cross-language false-matches (e.g., EN "a month" triggering inside
 * an FR session) are avoided. RU patterns use Cyrillic-aware Unicode
 * boundaries since JS `\b` is ASCII-only and fails to separate Cyrillic
 * letters (e.g., `год` inside `годная`).
 */
export function matchClarifierReply(text: string, language: 'en' | 'fr' | 'ru'): ClarifierChoice | null {
  const t = text.trim().toLowerCase();
  if (language === 'en') {
    if (/\b(three|3) ?months?\b/i.test(t)) return 'threeMonths';
    if (/\b(a |one |1 )?week\b/i.test(t)) return 'week';
    if (/\b(a |one |1 )?month\b/i.test(t)) return 'month';
    if (/\b(a |one |1 )?year\b/i.test(t)) return 'year';
    return null;
  }
  if (language === 'fr') {
    if (/\btrois ?mois\b|\b3 ?mois\b/i.test(t)) return 'threeMonths';
    if (/\bsemaine\b/i.test(t)) return 'week';
    if (/\bmois\b/i.test(t)) return 'month';
    if (/\ban(n[eé]e)?s?\b/i.test(t)) return 'year';
    return null;
  }
  // RU — use Unicode-aware boundaries: non-letter (or start/end) around the token.
  if (/(?:^|[^\p{L}])(?:три ?месяца|3 ?месяца)(?:[^\p{L}]|$)/iu.test(t)) return 'threeMonths';
  if (/(?:^|[^\p{L}])недел[юи]?(?:[^\p{L}]|$)/iu.test(t)) return 'week';
  if (/(?:^|[^\p{L}])месяц(?:[^\p{L}]|$)/iu.test(t)) return 'month';
  if (/(?:^|[^\p{L}])год[а]?(?:[^\p{L}]|$)/iu.test(t)) return 'year';
  return null;
}

export function buildResolveByClarifierQuestion(language: 'en' | 'fr' | 'ru'): string {
  switch (language) {
    case 'en': return 'When should I check back — a week, a month, three months, or a year?';
    case 'fr': return 'Quand veux-tu qu\'on revienne dessus — une semaine, un mois, trois mois, ou un an ?';
    case 'ru': return 'Когда мне вернуться к этому — неделю, месяц, три месяца или год?';
  }
}

export function buildResolveByDefaultAnnouncement(language: 'en' | 'fr' | 'ru'): string {
  switch (language) {
    case 'en': return "I'll check back in a month — you can change this later.";
    case 'fr': return 'Je reviens là-dessus dans un mois — tu pourras changer ça plus tard.';
    case 'ru': return 'Я вернусь к этому через месяц — можешь изменить позже.';
  }
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
}
function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
