/**
 * Phase 23 Plan 03 — /summary [YYYY-MM-DD] Telegram command (CMD-01).
 *
 * Usage patterns:
 *   /summary               → yesterday's episodic summary in config.proactiveTimezone
 *   /summary YYYY-MM-DD    → that calendar date's episodic summary
 *   /summary <anything>    → localized usage help (CONTEXT.md D-27)
 *
 * Edge cases:
 *   - Date in the future → "that date hasn't happened yet" (CONTEXT.md D-32 short-circuit
 *     before any DB call so we don't waste a round trip on a case the handler can detect cheaply)
 *   - Date in the past with no row → "no summary for that date — you may not have written
 *     anything" (CMD-01 verbatim "not an error" — D-30)
 *   - DB error / unexpected throw → localized generic error + logger.warn (mirrors
 *     decisions.ts error path)
 *
 * Security / correctness:
 *   - Inherits single-user Grammy auth middleware (D009). No per-handler auth.
 *   - Uses `getEpisodicSummary(date)` from src/pensieve/retrieve.ts (Phase 22 RETR-01) —
 *     NO direct Drizzle query (CONTEXT.md D-29). The retrieval helper handles the
 *     timezone-aware day-boundary mapping.
 *   - Plain text (no parse_mode: 'Markdown') per D-31 — Markdown escape complexity for
 *     user-origin content in key_quotes is a footgun, and the visual gain is marginal.
 *
 * Field-shape note (vs. plan example):
 *   The plan's example formatSummary used snake_case (row.summary_date, row.emotional_arc,
 *   row.key_quotes) per the Zod EpisodicSummary type. The actual return shape of
 *   getEpisodicSummary is the Drizzle row (`typeof episodicSummaries.$inferSelect`)
 *   which uses camelCase keys (summaryDate, emotionalArc, keyQuotes). This file uses
 *   the Drizzle shape — same contract reconciliation Plan 23-01/23-02 documented when
 *   the plan example diverges from the runtime contract.
 */

import type { Context } from 'grammy';
import { DateTime } from 'luxon';
import { getEpisodicSummary } from '../../pensieve/retrieve.js';
import { getLastUserLanguage, langOf, type Lang } from '../../chris/language.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { episodicSummaries } from '../../db/schema.js';

// IN-04: `langOf` + `Lang` come from src/chris/language.ts (shared with
// profile.ts and future M011+ user-facing surfaces). decisions.ts uses a
// different `isoLang` returning `'en'|'fr'|'ru'` and is intentionally NOT
// migrated — its iso-code shape is load-bearing for its switch statements.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ── Localized message strings ───────────────────────────────────────────────
//
// Authored to be short and direct — no flattery, no apology (D024/D027). Patterns
// match the existing decisions.ts language-keyed map for consistency across handlers.

const MSG = {
  usage: {
    English: 'Use: /summary [YYYY-MM-DD]. No date = yesterday.',
    French: 'Utilisation : /summary [YYYY-MM-DD]. Sans date = hier.',
    Russian: 'Использование: /summary [YYYY-MM-DD]. Без даты — вчера.',
  },
  noRowPast: {
    English: (d: string) => `No summary for ${d}. You may not have written anything that day.`,
    French: (d: string) => `Pas de résumé pour le ${d}. Tu n'as peut-être rien écrit ce jour-là.`,
    Russian: (d: string) => `Нет сводки за ${d}. Возможно, в тот день ты ничего не записал.`,
  },
  noRowFuture: {
    English: (d: string) => `${d} hasn't happened yet.`,
    French: (d: string) => `Le ${d} n'est pas encore arrivé.`,
    Russian: (d: string) => `${d} ещё не наступило.`,
  },
  genericError: {
    English: 'I ran into trouble fetching that summary. Try again in a moment.',
    French: "J'ai eu un souci en récupérant ce résumé. Réessaie dans un instant.",
    Russian: 'Возникла проблема с получением этой сводки. Попробуй через мгновение.',
  },
  labels: {
    English: { summaryFor: 'Summary for', importance: 'importance', topics: 'Topics', arc: 'Emotional arc', quotes: 'Key moments' },
    French: { summaryFor: 'Résumé du', importance: 'importance', topics: 'Thèmes', arc: 'Arc émotionnel', quotes: 'Moments clés' },
    Russian: { summaryFor: 'Сводка за', importance: 'важность', topics: 'Темы', arc: 'Эмоциональная дуга', quotes: 'Ключевые моменты' },
  },
} as const;

type EpisodicRow = typeof episodicSummaries.$inferSelect;

function formatSummary(row: EpisodicRow, lang: Lang): string {
  const L = MSG.labels[lang];
  // Drizzle's `date` column type returns string ('YYYY-MM-DD'); guard the unlikely
  // Date case (defensive — same shape interrogate.ts:29 uses without conversion).
  const dateStr =
    typeof row.summaryDate === 'string'
      ? row.summaryDate
      : (row.summaryDate as Date).toISOString().slice(0, 10);
  const lines = [
    `${L.summaryFor} ${dateStr} (${L.importance} ${row.importance}/10)`,
    '',
    row.summary,
    '',
    `${L.topics}: ${row.topics.join(', ')}`,
    `${L.arc}: ${row.emotionalArc}`,
  ];
  if (row.keyQuotes.length > 0) {
    lines.push('', `${L.quotes}:`);
    for (const q of row.keyQuotes) {
      lines.push(`- "${q}"`);
    }
  }
  return lines.join('\n');
}

// ── Date helpers in config.proactiveTimezone ────────────────────────────────
//
// Uses Intl.DateTimeFormat with the 'en-CA' locale because en-CA formats dates
// natively as YYYY-MM-DD — same idiom proactive/state.ts and pensieve/retrieve.ts
// (formatLocalDate) already use. No third-party tz dep needed.

/** Returns YYYY-MM-DD for "today" in the configured IANA timezone. */
function todayInTz(tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

/**
 * Returns YYYY-MM-DD for "yesterday" in the configured IANA timezone.
 *
 * Compute "today" in tz, build a midnight-of-today-UTC anchor, subtract 24h,
 * then reformat in the same tz so DST crossings still resolve correctly through
 * the Intl path (which is the source of truth for tz-aware date arithmetic on
 * Node 22 without adding luxon/date-fns to the bot handler surface).
 */
function yesterdayInTz(tz: string): string {
  const todayIso = todayInTz(tz);
  const todayMidnightUtc = Date.parse(`${todayIso}T00:00:00Z`);
  const yesterdayUtc = todayMidnightUtc - 24 * 60 * 60 * 1000;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(yesterdayUtc));
}

/** Returns true if `YYYY-MM-DD` is strictly after today-in-tz. */
function isFutureDate(isoDate: string, tz: string): boolean {
  // Lexicographic compare works for YYYY-MM-DD because the format is fixed-width.
  return isoDate > todayInTz(tz);
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleSummaryCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  const lang = langOf(getLastUserLanguage(chatId.toString()));
  const raw = ctx.message?.text ?? '';
  // Same regex-strip pattern decisions.ts uses for sub-command parsing.
  const after = raw.replace(/^\/summary(?:@\w+)?\s*/i, '').trim();

  let targetDate: string;

  if (after === '') {
    targetDate = yesterdayInTz(config.proactiveTimezone);
  } else if (ISO_DATE.test(after)) {
    // WR-01: the regex only validates FORMAT, not calendar validity. Inputs
    // like 2026-02-30 / 2026-13-01 / 2026-04-31 / 2026-02-29 (non-leap)
    // pass the regex but silently coerce to a different day via new Date().
    // Mirror the backfill script's validation (scripts/backfill-episodic.ts:98-102)
    // by round-tripping through Luxon — DateTime.fromISO(...).isValid is
    // strict about calendar correctness and returns false for all the
    // overflow cases. On invalid calendar date, send the SAME usage help
    // as the non-ISO garbage branch (per operator UX consistency).
    const probe = DateTime.fromISO(after, { zone: 'utc' });
    if (!probe.isValid) {
      await ctx.reply(MSG.usage[lang]);
      return;
    }
    targetDate = after;
  } else {
    await ctx.reply(MSG.usage[lang]);
    return;
  }

  // D-32 future-date short-circuit — no DB call for an obviously-impossible request.
  if (isFutureDate(targetDate, config.proactiveTimezone)) {
    await ctx.reply(MSG.noRowFuture[lang](targetDate));
    return;
  }

  try {
    // RETR-01 contract — pass a Date constructed at UTC midnight; the helper
    // formats it back to the local YYYY-MM-DD via formatLocalDate(). Constructing
    // at UTC midnight + relying on the helper's tz-aware reformat is the safe
    // path: any local-time Date constructor (`new Date(targetDate)`) would risk
    // an off-by-one when the host's local tz disagrees with proactiveTimezone.
    const row = await getEpisodicSummary(new Date(`${targetDate}T00:00:00Z`));
    if (row === null) {
      await ctx.reply(MSG.noRowPast[lang](targetDate));
      return;
    }
    await ctx.reply(formatSummary(row, lang));
  } catch (err) {
    logger.warn(
      {
        chatId,
        targetDate,
        error: err instanceof Error ? err.message : String(err),
      },
      'summary.command.error',
    );
    await ctx.reply(MSG.genericError[lang]);
  }
}
