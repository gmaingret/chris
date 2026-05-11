/**
 * Context builder for Opus-powered proactive analysis.
 *
 * Queries relational memory, pensieve entries, and conversations to build
 * a bounded analytical context string for Opus consumption. Enforces a
 * character budget (maxTokens × 4) allocated across four sections:
 *   - Relational Memory (30%)
 *   - Pensieve Entries (30%)
 *   - Conversation Gap Analysis (15%)
 *   - Recent Conversation tail (25%) — verbatim recent messages so the
 *     LLM can SEE what was actually discussed and never frames outreach
 *     as "you've disappeared" when there was a substantive recent exchange.
 *
 * Observability: Logs section sizes and total context length. Returns
 * a fallback string when all data sources are empty.
 */

import { desc, gte, isNull, and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  relationalMemory,
  pensieveEntries,
  conversations,
} from '../db/schema.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const MS_PER_HOUR = 1000 * 60 * 60;
const EMPTY_CONTEXT = 'No relational memory or recent activity to analyze.';

// Recent Conversation section: pull the last RECENT_CONVO_HOURS of messages
// (both sides) so the LLM can read the actual exchange, not just gap stats.
// This is the load-bearing fix for "Chris claims silence after a conversation
// last evening": the model literally cannot know about the evening unless
// the messages are in its prompt.
const RECENT_CONVO_HOURS = 48;
const RECENT_CONVO_MAX_MESSAGES = 20;

/**
 * Truncate a string to `maxChars`, appending "…" if truncated.
 */
function truncateSection(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + '…';
}

/**
 * Format a Date into a readable string like "2026-03-28".
 */
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build a bounded analytical context string for Opus sweep analysis.
 *
 * @param maxTokens - Token budget; character budget = maxTokens × 4
 * @returns Combined context string respecting the character budget
 */
export async function buildSweepContext(maxTokens: number): Promise<string> {
  const charBudget = maxTokens * 4;
  const memoryBudget = Math.floor(charBudget * 0.3);
  const pensieveBudget = Math.floor(charBudget * 0.3);
  const gapBudget = Math.floor(charBudget * 0.15);
  const recentConvoBudget = Math.floor(charBudget * 0.25);

  // Query four data sources in parallel
  const [memoryRows, pensieveRows, conversationRows, recentConvoRows] =
    await Promise.all([
      queryRelationalMemory(),
      queryPensieveEntries(),
      queryConversationGapData(),
      queryRecentConversation(),
    ]);

  // If all empty, return minimal fallback
  if (
    memoryRows.length === 0 &&
    pensieveRows.length === 0 &&
    conversationRows.length === 0 &&
    recentConvoRows.length === 0
  ) {
    return EMPTY_CONTEXT;
  }

  const sections: string[] = [];

  // ── Recent Conversation Section (FIRST so the LLM sees it before gap stats) ──
  const recentConvoSection = buildRecentConversation(
    recentConvoRows,
    recentConvoBudget,
  );
  if (recentConvoSection) {
    sections.push(recentConvoSection);
  }

  // ── Relational Memory Section ──
  if (memoryRows.length > 0) {
    const lines = memoryRows.map(
      (r) =>
        `- [${r.type}] (confidence: ${r.confidence}, ${formatDate(new Date(r.createdAt!))}) ${r.content}`,
    );
    const raw = `## Relational Memory\n\n${lines.join('\n')}`;
    sections.push(truncateSection(raw, memoryBudget));
  }

  // ── Pensieve Entries Section ──
  if (pensieveRows.length > 0) {
    const lines = pensieveRows.map(
      (r) =>
        `- [${r.epistemicTag || 'UNTAGGED'}] (${formatDate(new Date(r.createdAt!))}) ${r.content}`,
    );
    const raw = `## Recent Pensieve Entries\n\n${lines.join('\n')}`;
    sections.push(truncateSection(raw, pensieveBudget));
  }

  // ── Conversation Gap Analysis Section ──
  const gapSection = buildGapAnalysis(conversationRows, gapBudget);
  if (gapSection) {
    sections.push(gapSection);
  }

  // Per-section truncation lets each block fill its share of the budget, but
  // the "\n\n" join separators add ~6 chars of overhead on top. Final-stage
  // truncate enforces the documented contract: total ≤ maxTokens × 4.
  return truncateSection(sections.join('\n\n'), charBudget);
}

// ── Data Queries ─────────────────────────────────────────────────────────

async function queryRelationalMemory() {
  return db
    .select({
      type: relationalMemory.type,
      content: relationalMemory.content,
      confidence: relationalMemory.confidence,
      createdAt: relationalMemory.createdAt,
    })
    .from(relationalMemory)
    .where(
      and(
        inArray(relationalMemory.type, [
          'PATTERN',
          'OBSERVATION',
          'INSIGHT',
          'CONCERN',
        ]),
        gte(relationalMemory.confidence, 0.3),
      ),
    )
    .orderBy(desc(relationalMemory.createdAt))
    .limit(20);
}

async function queryPensieveEntries() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * MS_PER_DAY);

  return db
    .select({
      content: pensieveEntries.content,
      epistemicTag: pensieveEntries.epistemicTag,
      createdAt: pensieveEntries.createdAt,
    })
    .from(pensieveEntries)
    .where(
      and(
        gte(pensieveEntries.createdAt, thirtyDaysAgo),
        isNull(pensieveEntries.deletedAt),
      ),
    )
    .orderBy(desc(pensieveEntries.createdAt))
    .limit(50);
}

async function queryConversationGapData() {
  return db
    .select({
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(eq(conversations.role, 'USER'))
    .orderBy(desc(conversations.createdAt))
    .limit(100);
}

async function queryRecentConversation() {
  const cutoff = new Date(Date.now() - RECENT_CONVO_HOURS * MS_PER_HOUR);
  return db
    .select({
      createdAt: conversations.createdAt,
      role: conversations.role,
      content: conversations.content,
    })
    .from(conversations)
    .where(gte(conversations.createdAt, cutoff))
    .orderBy(desc(conversations.createdAt))
    .limit(RECENT_CONVO_MAX_MESSAGES);
}

// ── Gap Analysis ─────────────────────────────────────────────────────────

function buildGapAnalysis(
  rows: { createdAt: Date | null }[],
  budget: number,
): string | null {
  if (rows.length === 0) return null;

  const timestamps = rows
    .map((r) => new Date(r.createdAt!).getTime())
    .sort((a, b) => b - a); // DESC

  const lastMessageDate = new Date(timestamps[0]!);
  const daysSinceLast = Math.round(
    (Date.now() - timestamps[0]!) / MS_PER_DAY * 10,
  ) / 10;

  // Count messages in last 30 days
  const thirtyDaysAgoMs = Date.now() - 30 * MS_PER_DAY;
  const recentCount = timestamps.filter((t) => t >= thirtyDaysAgoMs).length;

  // Average gap between recent messages
  let avgGapDays = 0;
  if (timestamps.length >= 2) {
    let totalGap = 0;
    for (let i = 0; i < timestamps.length - 1; i++) {
      totalGap += timestamps[i]! - timestamps[i + 1]!;
    }
    avgGapDays =
      Math.round((totalGap / (timestamps.length - 1) / MS_PER_DAY) * 10) / 10;
  }

  const raw = [
    '## Conversation Gap Analysis',
    '',
    `- Last message from Greg: ${formatDate(lastMessageDate)} (${daysSinceLast} days ago)`,
    `- Messages in last 30 days: ${recentCount}`,
    `- Average gap between messages: ${avgGapDays} days`,
    '',
    'NOTE: Gap stats are statistical only. The Recent Conversation section above shows what was actually discussed. If a substantive exchange happened recently, frame outreach as a continuation, NOT as "you disappeared".',
  ].join('\n');

  return truncateSection(raw, budget);
}

// ── Recent Conversation ──────────────────────────────────────────────────

function buildRecentConversation(
  rows: { createdAt: Date | null; role: string; content: string }[],
  budget: number,
): string | null {
  if (rows.length === 0) return null;

  // rows are DESC (newest first); render OLDEST FIRST so the LLM reads
  // the conversation in natural order
  const ordered = [...rows].reverse();

  const lines = ordered.map((r) => {
    const ts = formatTimestamp(new Date(r.createdAt!));
    const speaker = r.role === 'USER' ? 'Greg' : 'Chris';
    return `[${ts}] ${speaker}: ${r.content}`;
  });

  const newestTime = formatTimestamp(new Date(rows[0]!.createdAt!));
  const oldestTime = formatTimestamp(new Date(ordered[0]!.createdAt!));
  const hoursSinceNewest =
    (Date.now() - new Date(rows[0]!.createdAt!).getTime()) / MS_PER_HOUR;

  const header = [
    `## Recent Conversation (last ${RECENT_CONVO_HOURS}h, ${rows.length} messages, ${oldestTime} → ${newestTime})`,
    '',
    `Last message: ${hoursSinceNewest.toFixed(1)}h ago. This is the actual recent exchange — read it before deciding how to open.`,
    '',
  ].join('\n');

  const raw = header + lines.join('\n');
  return truncateSection(raw, budget);
}

function formatTimestamp(d: Date): string {
  // YYYY-MM-DD HH:MM in Europe/Paris (the user's timezone) for natural reading
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}
