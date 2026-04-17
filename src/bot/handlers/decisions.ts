/**
 * Phase 17 Plan 03 — /decisions command handler.
 *
 * Supports all sub-commands:
 *   (no-args) → dashboard with counts + 90-day accuracy
 *   open       → sorted list of open decisions (soonest first)
 *   recent     → newest-first list of recently resolved decisions
 *   stats [30|90|365] → accuracy stats block with Wilson CI
 *   suppress <phrase> → add decision trigger suppression
 *   suppressions  → list active suppressions
 *   unsuppress <phrase> → remove a suppression
 *   reclassify → re-run 2-axis classification on all reviewed decisions
 *
 * Security:
 *   - Stats window validated to [30, 90, 365] allowlist (T-17-03-01)
 *   - All queries scoped to chatId (T-17-03-02)
 *   - Logger never writes phrase text (T-17-03-04, T-14-05-05)
 *   - Reclassify uses sequential for...of, NOT Promise.all (D-12, T-17-03-03)
 */
import type { Context } from 'grammy';
import { addSuppression, listSuppressions, removeSuppression } from '../../decisions/suppressions.js';
import {
  fetchStatusCounts,
  fetchStatsData,
  computeAccuracy,
  fetchOpenDecisions,
  fetchRecentDecisions,
  formatDashboard,
  formatOpenList,
  formatRecentList,
  formatStatsBlock,
} from '../../decisions/stats.js';
import { classifyAccuracy } from '../../decisions/classify-accuracy.js';
import { classifyOutcome } from '../../decisions/resolution.js';
import { db } from '../../db/connection.js';
import { decisions, decisionEvents } from '../../db/schema.js';
import { and, eq, isNotNull } from 'drizzle-orm';
import { HAIKU_MODEL } from '../../llm/client.js';
import { getLastUserLanguage } from '../../chris/language.js';
import { logger } from '../../utils/logger.js';

// WR-04: upper bound on reclassify batch size. Greg-scale (<=20) leaves
// massive headroom; this caps worst-case Haiku spend and wall-clock time.
const MAX_RECLASSIFY_BATCH = 200;

export async function handleDecisionsCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const chatIdBig = BigInt(chatId);
  const lang = isoLang(getLastUserLanguage(chatId.toString()));

  const raw = ctx.message?.text ?? '';
  // format: "/decisions [sub] [arg]" (Grammy sends full text incl. slash)
  const after = raw.replace(/^\/decisions(?:@\w+)?\s*/i, '').trim();

  // ── No-args: dashboard ──────────────────────────────────────────────────
  if (!after) {
    try {
      const counts = await fetchStatusCounts(chatIdBig);
      const statsRows = await fetchStatsData(chatIdBig, 90);
      const accuracy90 = computeAccuracy(statsRows);
      await ctx.reply(formatDashboard(counts, accuracy90, lang));
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), chatId }, 'decisions.dashboard.error');
      await ctx.reply(genericErrorMessage(lang));
    }
    return;
  }

  const [sub, ...rest] = after.split(/\s+/);
  const arg = rest.join(' ').trim();

  // ── suppress <phrase> ───────────────────────────────────────────────────
  if (sub!.toLowerCase() === 'suppress') {
    if (!arg) { await ctx.reply(usageMessage(lang)); return; }
    if (arg.length > 200) { await ctx.reply(tooLongMessage(lang)); return; }
    try {
      await addSuppression(chatIdBig, arg);
      await ctx.reply(confirmedMessage(lang, arg.trim().toLowerCase()));
    } catch (err) {
      logger.warn({
        error: err instanceof Error ? err.message : String(err),
        chatId,
      }, 'decisions.suppress.error');
      await ctx.reply(genericErrorMessage(lang));
    }
    return;
  }

  // ── open ────────────────────────────────────────────────────────────────
  if (sub!.toLowerCase() === 'open') {
    try {
      const rows = await fetchOpenDecisions(chatIdBig);
      if (rows.length === 0) {
        await ctx.reply(noOpenMessage(lang));
        return;
      }
      await ctx.reply(formatOpenList(rows, lang));
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), chatId }, 'decisions.open.error');
      await ctx.reply(genericErrorMessage(lang));
    }
    return;
  }

  // ── recent ──────────────────────────────────────────────────────────────
  if (sub!.toLowerCase() === 'recent') {
    try {
      const rows = await fetchRecentDecisions(chatIdBig, 5);
      if (rows.length === 0) {
        await ctx.reply(noRecentMessage(lang));
        return;
      }
      await ctx.reply(formatRecentList(rows, lang));
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), chatId }, 'decisions.recent.error');
      await ctx.reply(genericErrorMessage(lang));
    }
    return;
  }

  // ── stats [30|90|365] ───────────────────────────────────────────────────
  if (sub!.toLowerCase() === 'stats') {
    const validWindows = [30, 90, 365];
    let windowDays = 90; // D-08: default 90 days
    if (arg) {
      // WR-03: reject trailing garbage ("30abc" -> parseInt returns 30 silently).
      // Also defends against IN-04: `/decisions stats 30 extra junk` where
      // rest.join(' ') smuggles extra tokens into arg.
      if (!/^\d+$/.test(arg)) {
        await ctx.reply(invalidWindowMessage(lang));
        return;
      }
      const parsed = Number(arg);
      if (!Number.isInteger(parsed) || !validWindows.includes(parsed)) {
        await ctx.reply(invalidWindowMessage(lang));
        return;
      }
      windowDays = parsed;
    }
    try {
      const rows = await fetchStatsData(chatIdBig, windowDays);
      await ctx.reply(formatStatsBlock(rows, windowDays, lang));
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), chatId }, 'decisions.stats.error');
      await ctx.reply(genericErrorMessage(lang));
    }
    return;
  }

  // ── suppressions ────────────────────────────────────────────────────────
  if (sub!.toLowerCase() === 'suppressions') {
    try {
      const phrases = await listSuppressions(chatIdBig);
      if (phrases.length === 0) {
        await ctx.reply(noSuppressionsMessage(lang));
        return;
      }
      const lines = phrases.map((p, i) => `${i + 1}. "${p}"`).join('\n');
      await ctx.reply(suppressionsHeaderMessage(lang) + '\n' + lines);
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), chatId }, 'decisions.suppressions.error');
      await ctx.reply(genericErrorMessage(lang));
    }
    return;
  }

  // ── unsuppress <phrase> ─────────────────────────────────────────────────
  if (sub!.toLowerCase() === 'unsuppress') {
    if (!arg) { await ctx.reply(unsuppressUsageMessage(lang)); return; }
    try {
      const removed = await removeSuppression(chatIdBig, arg);
      await ctx.reply(removed
        ? unsuppressedMessage(lang, arg.trim().toLowerCase())
        : unsuppressNotFoundMessage(lang, arg.trim().toLowerCase()));
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), chatId }, 'decisions.unsuppress.error');
      await ctx.reply(genericErrorMessage(lang));
    }
    return;
  }

  // ── reclassify ──────────────────────────────────────────────────────────
  if (sub!.toLowerCase() === 'reclassify') {
    try {
      const toReclassify = await db
        .select({
          id: decisions.id,
          resolution: decisions.resolution,
          prediction: decisions.prediction,
          falsificationCriterion: decisions.falsificationCriterion,
        })
        .from(decisions)
        .where(
          and(
            eq(decisions.chatId, chatIdBig),
            eq(decisions.status, 'reviewed'),
            isNotNull(decisions.resolution),
          )
        );

      if (toReclassify.length === 0) {
        await ctx.reply(noReclassifyMessage(lang));
        return;
      }

      // WR-04: batch cap prevents unbounded Haiku spend if the Greg-scale
      // assumption (<=20 decisions) breaks. 200 leaves headroom but caps
      // worst-case at ~200 * 2 * 5s = 2000s of Haiku calls.
      if (toReclassify.length > MAX_RECLASSIFY_BATCH) {
        await ctx.reply(reclassifyBatchCapMessage(lang, MAX_RECLASSIFY_BATCH, toReclassify.length));
        return;
      }

      // WR-04: send an "in progress" reply so Telegram does not drop the
      // connection on long runs, and Greg has visibility.
      await ctx.reply(reclassifyStartedMessage(lang, toReclassify.length));

      let count = 0;
      // Sequential loop — D-12 mandates no parallel (Pitfall 6)
      for (const d of toReclassify) {
        // Re-run classifyOutcome for the outcome axis
        const outcome = await classifyOutcome(d.resolution!, d.prediction, d.falsificationCriterion);
        // Re-run classifyAccuracy for the reasoning axis
        const reasoning = await classifyAccuracy(outcome, d.resolution!, d.prediction);
        const accuracyClass = `${outcome}/${reasoning}`;

        // WR-04: wrap projection-update + classified-event-insert in a single
        // transaction so the D-11 invariant ("originals preserved via
        // append-only event log") cannot be broken by a partial write.
        await db.transaction(async (tx) => {
          // Update decisions projection row (overwrite with latest — D-11)
          await tx.update(decisions).set({
            accuracyClass,
            accuracyClassifiedAt: new Date(),
            accuracyModelVersion: HAIKU_MODEL,
            updatedAt: new Date(),
          }).where(eq(decisions.id, d.id));

          // Append classified event to decision_events (D-11 — preserves originals)
          // Direct insert, NOT through transitionDecision (Pitfall 3)
          await tx.insert(decisionEvents).values({
            decisionId: d.id,
            eventType: 'classified',
            snapshot: { accuracyClass, accuracyModelVersion: HAIKU_MODEL, reclassifiedAt: new Date().toISOString() },
            actor: 'system',
          });
        });

        count++;
      }

      await ctx.reply(reclassifyDoneMessage(lang, count));
    } catch (err) {
      logger.warn({ error: err instanceof Error ? err.message : String(err), chatId }, 'decisions.reclassify.error');
      await ctx.reply(genericErrorMessage(lang));
    }
    return;
  }

  // ── Unknown sub-command: show updated usage ─────────────────────────────
  await ctx.reply(usageMessage(lang));
}

// ── Language helpers ──────────────────────────────────────────────────────────

function isoLang(raw: string | null): 'en' | 'fr' | 'ru' {
  return raw === 'French' ? 'fr' : raw === 'Russian' ? 'ru' : 'en';
}

function usageMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'Usage: /decisions [open | recent | stats [30|90|365] | suppress <phrase> | suppressions | unsuppress <phrase> | reclassify]';
    case 'fr': return 'Usage : /decisions [open | recent | stats [30|90|365] | suppress <phrase> | suppressions | unsuppress <phrase> | reclassify]';
    case 'ru': return 'Использование: /decisions [open | recent | stats [30|90|365] | suppress <phrase> | suppressions | unsuppress <phrase> | reclassify]';
  }
}

function tooLongMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'That phrase is too long (200 char max).';
    case 'fr': return 'Cette phrase est trop longue (200 caractères max).';
    case 'ru': return 'Слишком длинная фраза (максимум 200 символов).';
  }
}

function confirmedMessage(l: 'en' | 'fr' | 'ru', phrase: string): string {
  switch (l) {
    case 'en': return `Suppressed "${phrase}". I won't trigger on messages containing it.`;
    case 'fr': return `Supprimée : "${phrase}". Je ne déclencherai plus sur les messages la contenant.`;
    case 'ru': return `Подавил «${phrase}». Больше не буду срабатывать на сообщения с этой фразой.`;
  }
}

function genericErrorMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'Something went wrong. Please try again.';
    case 'fr': return 'Une erreur est survenue. Veuillez réessayer.';
    case 'ru': return 'Что-то пошло не так. Попробуйте снова.';
  }
}

function noOpenMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'No open decisions.';
    case 'fr': return 'Aucune decision ouverte.';
    case 'ru': return 'Нет открытых решений.';
  }
}

function noRecentMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'No recent decisions.';
    case 'fr': return 'Aucune decision recente.';
    case 'ru': return 'Нет недавних решений.';
  }
}

function invalidWindowMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'Valid windows: 30, 90, 365';
    case 'fr': return 'Fenetres valides : 30, 90, 365';
    case 'ru': return 'Допустимые окна: 30, 90, 365';
  }
}

function noSuppressionsMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'No active suppressions.';
    case 'fr': return 'Aucune suppression active.';
    case 'ru': return 'Нет активных подавлений.';
  }
}

function suppressionsHeaderMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'Active suppressions:';
    case 'fr': return 'Suppressions actives :';
    case 'ru': return 'Активные подавления:';
  }
}

function unsuppressUsageMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'Usage: /decisions unsuppress <phrase>';
    case 'fr': return 'Usage : /decisions unsuppress <phrase>';
    case 'ru': return 'Использование: /decisions unsuppress <phrase>';
  }
}

function unsuppressedMessage(l: 'en' | 'fr' | 'ru', phrase: string): string {
  switch (l) {
    case 'en': return `Removed suppression: "${phrase}"`;
    case 'fr': return `Suppression supprimée : "${phrase}"`;
    case 'ru': return `Удалено подавление: "${phrase}"`;
  }
}

function unsuppressNotFoundMessage(l: 'en' | 'fr' | 'ru', phrase: string): string {
  switch (l) {
    case 'en': return `Suppression not found: "${phrase}"`;
    case 'fr': return `Suppression introuvable : "${phrase}"`;
    case 'ru': return `Подавление не найдено: "${phrase}"`;
  }
}

function noReclassifyMessage(l: 'en' | 'fr' | 'ru'): string {
  switch (l) {
    case 'en': return 'No reviewed decisions to reclassify.';
    case 'fr': return 'Aucune decision examinee a reclassifier.';
    case 'ru': return 'Нет проверенных решений для переклассификации.';
  }
}

function reclassifyDoneMessage(l: 'en' | 'fr' | 'ru', n: number): string {
  switch (l) {
    case 'en': return `Reclassified ${n} decisions.`;
    case 'fr': return `${n} decisions reclassifiees.`;
    case 'ru': return `Переклассифицировано ${n} решений.`;
  }
}

// WR-04: reclassify batch-cap message (refused to run because queue too large)
function reclassifyBatchCapMessage(l: 'en' | 'fr' | 'ru', cap: number, actual: number): string {
  switch (l) {
    case 'en': return `Refusing to reclassify: ${actual} decisions exceeds the ${cap}-batch cap.`;
    case 'fr': return `Refus de reclassifier : ${actual} decisions depasse la limite de ${cap}.`;
    case 'ru': return `Отказано в переклассификации: ${actual} решений превышает лимит пакета ${cap}.`;
  }
}

// WR-04: reclassify progress reply so Telegram does not drop the connection
function reclassifyStartedMessage(l: 'en' | 'fr' | 'ru', n: number): string {
  switch (l) {
    case 'en': return `Reclassifying ${n} decisions... this may take a minute.`;
    case 'fr': return `Reclassification de ${n} decisions en cours... cela peut prendre une minute.`;
    case 'ru': return `Переклассификация ${n} решений... это может занять минуту.`;
  }
}
