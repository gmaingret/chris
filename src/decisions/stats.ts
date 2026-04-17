/**
 * Phase 17 Plan 02 — Stats computation layer.
 *
 * Exports:
 *   - wilsonCI: Wilson 95% confidence interval
 *   - fetchStatsData: SQL query for reviewed decisions within a rolling window
 *   - computeAccuracy: N-floor + Wilson CI computation
 *   - fetchStatusCounts: open/due/reviewed/stale counts
 *   - fetchOpenDecisions: open decisions sorted soonest-first
 *   - fetchRecentDecisions: recently resolved/reviewed decisions
 *   - formatDashboard: counts-only dashboard (D-05)
 *   - formatOpenList: compact one-liner list (D-06)
 *   - formatRecentList: compact recent list (D-07)
 *   - formatStatsBlock: full stats block with domain breakdown (D-08)
 *
 * Security: all queries scoped to chatId (T-17-02-02).
 * windowDays must be validated to [30, 90, 365] by caller before use (T-17-02-01).
 */

import { db } from '../db/connection.js';
import { decisions } from '../db/schema.js';
import { eq, and, gte, inArray, asc, desc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// ── Wilson CI (D-15) ───────────────────────────────────────────────────────

/**
 * Compute Wilson 95% confidence interval for a proportion.
 * Both center and margin are divided by denom (Pitfall 1 from RESEARCH.md).
 *
 * Formula: (p + z²/2n ± z·sqrt(p(1-p)/n + z²/4n²)) / (1 + z²/n)
 * where z = 1.96 for 95% CI.
 */
export function wilsonCI(hits: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 0 };
  const z = 1.96;
  const p = hits / n;
  const center = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const denom = 1 + (z * z) / n;
  return {
    lo: Math.max(0, (center - margin) / denom),
    hi: Math.min(1, (center + margin) / denom),
  };
}

// ── SQL types ──────────────────────────────────────────────────────────────

export interface StatsRow {
  accuracyClass: string | null;
  domainTag: string | null;
}

export interface OpenRow {
  decisionText: string;
  resolveBy: Date;
  domainTag: string | null;
}

export interface RecentRow {
  decisionText: string;
  accuracyClass: string | null;
  resolvedAt: Date | null;
}

export interface StatusCounts {
  open: number;
  due: number;
  reviewed: number;
  stale: number;
  openDraft: number;
  withdrawn: number;
  abandoned: number;
}

export interface AccuracyResult {
  belowFloor: boolean;
  n: number;
  hits?: number;
  pct?: number;
  ci?: { lo: number; hi: number };
  unverifiable: number;
}

// ── SQL queries ────────────────────────────────────────────────────────────

const N_FLOOR = 10;

/**
 * Fetch reviewed decisions within the rolling window for accuracy computation.
 * windowDays must be validated to [30, 90, 365] by the caller (T-17-02-01).
 *
 * Defense-in-depth (WR-02): also asserts windowDays is a positive integer <= 3650
 * here, so a future caller that forgets the allowlist check cannot regress
 * `sql.raw(String(windowDays))` into an injection sink.
 */
export async function fetchStatsData(chatId: bigint, windowDays: number): Promise<StatsRow[]> {
  if (!Number.isInteger(windowDays) || windowDays <= 0 || windowDays > 3650) {
    throw new Error(
      `fetchStatsData: windowDays must be a positive integer <= 3650, got ${windowDays}`,
    );
  }
  return db
    .select({
      accuracyClass: decisions.accuracyClass,
      domainTag: decisions.domainTag,
    })
    .from(decisions)
    .where(
      and(
        eq(decisions.chatId, chatId),
        eq(decisions.status, 'reviewed'),
        gte(decisions.resolvedAt, sql`now() - interval '${sql.raw(String(windowDays))} days'`),
      )
    );
}

/**
 * Fetch status counts for all decisions in this chat.
 */
export async function fetchStatusCounts(chatId: bigint): Promise<StatusCounts> {
  const rows = await db
    .select({ status: decisions.status })
    .from(decisions)
    .where(eq(decisions.chatId, chatId));

  const counts: StatusCounts = {
    open: 0, due: 0, reviewed: 0, stale: 0,
    openDraft: 0, withdrawn: 0, abandoned: 0,
  };
  for (const r of rows) {
    if (r.status === 'open-draft') counts.openDraft++;
    else if (r.status === 'open') counts.open++;
    else if (r.status === 'due') counts.due++;
    else if (r.status === 'reviewed') counts.reviewed++;
    else if (r.status === 'stale') counts.stale++;
    else if (r.status === 'withdrawn') counts.withdrawn++;
    else if (r.status === 'abandoned') counts.abandoned++;
  }
  return counts;
}

/**
 * Fetch open/due/open-draft decisions sorted soonest resolve-by first.
 */
export async function fetchOpenDecisions(chatId: bigint): Promise<OpenRow[]> {
  return db
    .select({
      decisionText: decisions.decisionText,
      resolveBy: decisions.resolveBy,
      domainTag: decisions.domainTag,
    })
    .from(decisions)
    .where(
      and(
        eq(decisions.chatId, chatId),
        inArray(decisions.status, ['open', 'open-draft', 'due']),
      )
    )
    .orderBy(asc(decisions.resolveBy));
}

/**
 * Fetch recently resolved/reviewed decisions, newest first.
 */
export async function fetchRecentDecisions(chatId: bigint, limit = 5): Promise<RecentRow[]> {
  return db
    .select({
      decisionText: decisions.decisionText,
      accuracyClass: decisions.accuracyClass,
      resolvedAt: decisions.resolvedAt,
    })
    .from(decisions)
    .where(
      and(
        eq(decisions.chatId, chatId),
        inArray(decisions.status, ['resolved', 'reviewed']),
      )
    )
    .orderBy(desc(decisions.resolvedAt))
    .limit(limit);
}

// ── Accuracy computation ────────────────────────────────────────────────────

/**
 * Compute accuracy from a set of StatsRows.
 *
 * - Excludes `unverifiable/*` and `*\/unknown` from denominator (D-17).
 * - Returns { belowFloor: true } when scorable N < 10 (STAT-03).
 * - Returns Wilson CI bounds as integer percentages when N >= 10.
 */
export function computeAccuracy(rows: StatsRow[]): AccuracyResult {
  const unverifiableRows = rows.filter(
    (r) =>
      r.accuracyClass?.startsWith('unverifiable/') ||
      r.accuracyClass?.endsWith('/unknown'),
  );
  const unverifiable = unverifiableRows.length;

  const scorable = rows.filter(
    (r) =>
      r.accuracyClass !== null &&
      !r.accuracyClass.startsWith('unverifiable/') &&
      !r.accuracyClass.endsWith('/unknown'),
  );
  const n = scorable.length;

  if (n < N_FLOOR) return { belowFloor: true, n, unverifiable };

  const hits = scorable.filter((r) => r.accuracyClass!.startsWith('hit/')).length;
  const pct = Math.round((hits / n) * 100);
  const ci = wilsonCI(hits, n);
  return {
    belowFloor: false,
    n,
    hits,
    pct,
    ci: {
      lo: Math.round(ci.lo * 100),
      hi: Math.round(ci.hi * 100),
    },
    unverifiable,
  };
}

// ── Truncation helper ──────────────────────────────────────────────────────

function truncate(text: string, max = 45): string {
  return text.length <= max ? text : text.slice(0, max - 3) + '...';
}

// ── Date formatting helper ─────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// ── Output formatters ──────────────────────────────────────────────────────

type Lang = 'en' | 'fr' | 'ru';

/**
 * Dashboard (no-args `/decisions`): one bubble with counts + 90-day accuracy (D-05).
 */
export function formatDashboard(
  counts: StatusCounts,
  accuracy90: AccuracyResult,
  lang: Lang,
): string {
  const countLine = (() => {
    switch (lang) {
      case 'fr':
        return `${counts.open} ouvertes · ${counts.due} dues · ${counts.reviewed} révisées · ${counts.stale} périmées`;
      case 'ru':
        return `${counts.open} открытых · ${counts.due} срочных · ${counts.reviewed} проверенных · ${counts.stale} устаревших`;
      default:
        return `${counts.open} open · ${counts.due} due · ${counts.reviewed} reviewed · ${counts.stale} stale`;
    }
  })();

  const accuracyLine = (() => {
    if (accuracy90.belowFloor) {
      switch (lang) {
        case 'fr':
          return `N=${accuracy90.n}, seuil non atteint (besoin de 10 révisées)`;
        case 'ru':
          return `N=${accuracy90.n}, порог не достигнут (нужно 10 проверенных)`;
        default:
          return `N=${accuracy90.n}, threshold not met (need 10 resolved)`;
      }
    }
    switch (lang) {
      case 'fr':
        return `Précision sur 90 jours : ${accuracy90.pct}% [${accuracy90.ci!.lo}-${accuracy90.ci!.hi}% IC]`;
      case 'ru':
        return `Точность за 90 дней: ${accuracy90.pct}% [${accuracy90.ci!.lo}-${accuracy90.ci!.hi}% ДИ]`;
      default:
        return `90-day accuracy: ${accuracy90.pct}% [${accuracy90.ci!.lo}-${accuracy90.ci!.hi}% CI]`;
    }
  })();

  const subCmds = '/decisions open · recent · stats [30|90|365] · suppress <phrase> · suppressions · unsuppress <phrase> · reclassify';

  return [countLine, accuracyLine, '', subCmds].join('\n');
}

/**
 * Open decisions list (`/decisions open`): one-liner per decision (D-06).
 * Rows should already be sorted soonest-first by the caller (fetchOpenDecisions).
 */
export function formatOpenList(rows: OpenRow[], lang: Lang): string {
  if (rows.length === 0) {
    switch (lang) {
      case 'fr': return 'Aucune décision ouverte.';
      case 'ru': return 'Нет открытых решений.';
      default: return 'No open decisions.';
    }
  }
  // Sort soonest-first in case caller passes unsorted rows
  const sorted = [...rows].sort((a, b) => a.resolveBy.getTime() - b.resolveBy.getTime());
  return sorted
    .map((r) => {
      const domain = r.domainTag ? `${r.domainTag}: ` : '';
      return `${domain}${truncate(r.decisionText)} by ${formatDate(r.resolveBy)}`;
    })
    .join('\n');
}

/**
 * Recent decisions list (`/decisions recent`): one-liner per decision (D-07).
 * Rows should already be sorted newest-first by the caller (fetchRecentDecisions).
 */
export function formatRecentList(rows: RecentRow[], lang: Lang): string {
  if (rows.length === 0) {
    switch (lang) {
      case 'fr': return 'Aucune décision récente.';
      case 'ru': return 'Нет недавних решений.';
      default: return 'No recent decisions.';
    }
  }
  return rows
    .map((r) => {
      const cls = r.accuracyClass ?? 'unclassified';
      const date = r.resolvedAt ? ` (${formatDate(r.resolvedAt)})` : '';
      return `${cls} · ${truncate(r.decisionText)}${date}`;
    })
    .join('\n');
}

/**
 * Full stats block (`/decisions stats [window]`): overall + domain breakdown (D-08).
 */
export function formatStatsBlock(rows: StatsRow[], windowDays: number, lang: Lang): string {
  const overall = computeAccuracy(rows);
  const lines: string[] = [];

  // Overall accuracy line
  if (overall.belowFloor) {
    switch (lang) {
      case 'fr':
        lines.push(`Fenêtre ${windowDays} jours : N=${overall.n}, seuil non atteint (besoin de 10)`);
        break;
      case 'ru':
        lines.push(`Окно ${windowDays} дней: N=${overall.n}, порог не достигнут (нужно 10)`);
        break;
      default:
        lines.push(`${windowDays}-day window: N=${overall.n}, threshold not met (need 10 resolved)`);
    }
  } else {
    switch (lang) {
      case 'fr':
        lines.push(`Précision sur ${windowDays} jours : ${overall.pct}% [${overall.ci!.lo}-${overall.ci!.hi}% IC]`);
        break;
      case 'ru':
        lines.push(`Точность за ${windowDays} дней: ${overall.pct}% [${overall.ci!.lo}-${overall.ci!.hi}% ДИ]`);
        break;
      default:
        lines.push(`${windowDays}-day accuracy: ${overall.pct}% [${overall.ci!.lo}-${overall.ci!.hi}% CI]`);
    }
  }

  // Unverifiable line
  const unvLabel = (() => {
    switch (lang) {
      case 'fr': return `Non vérifiables : ${overall.unverifiable} (exclus)`;
      case 'ru': return `Непроверяемых: ${overall.unverifiable} (исключено)`;
      default: return `Unverifiable: ${overall.unverifiable} (excluded)`;
    }
  })();
  lines.push(unvLabel);

  // Domain breakdown
  const domainMap = new Map<string, StatsRow[]>();
  for (const row of rows) {
    const domain = row.domainTag ?? '(no domain)';
    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain)!.push(row);
  }

  if (domainMap.size > 0) {
    lines.push('');
    const byDomainLabel = (() => {
      switch (lang) {
        case 'fr': return 'Par domaine :';
        case 'ru': return 'По домену:';
        default: return 'By domain:';
      }
    })();
    lines.push(byDomainLabel);

    for (const [domain, domainRows] of domainMap) {
      const acc = computeAccuracy(domainRows);
      if (acc.belowFloor) {
        const thresholdLabel = (() => {
          switch (lang) {
            case 'fr': return `N=${acc.n}, seuil non atteint`;
            case 'ru': return `N=${acc.n}, порог не достигнут`;
            default: return `N=${acc.n}, threshold not met`;
          }
        })();
        lines.push(`  ${domain}: ${thresholdLabel}`);
      } else {
        lines.push(
          `  ${domain}: ${acc.hits}/${acc.n} (${acc.pct}%) [${acc.ci!.lo}-${acc.ci!.hi}% CI]`,
        );
      }
    }
  }

  return lines.join('\n');
}
