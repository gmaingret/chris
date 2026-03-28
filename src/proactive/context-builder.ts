/**
 * Context builder for Opus-powered proactive analysis.
 *
 * Queries relational memory, pensieve entries, and conversations to build
 * a bounded analytical context string for Opus consumption. Enforces a
 * character budget (maxTokens × 4) allocated across three sections:
 *   - Relational Memory (40%)
 *   - Pensieve Entries (40%)
 *   - Conversation Gap Analysis (20%)
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
const EMPTY_CONTEXT = 'No relational memory or recent activity to analyze.';

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
  const memoryBudget = Math.floor(charBudget * 0.4);
  const pensieveBudget = Math.floor(charBudget * 0.4);
  const gapBudget = Math.floor(charBudget * 0.2);

  // Query all three data sources in parallel
  const [memoryRows, pensieveRows, conversationRows] = await Promise.all([
    queryRelationalMemory(),
    queryPensieveEntries(),
    queryConversationGapData(),
  ]);

  // If all empty, return minimal fallback
  if (
    memoryRows.length === 0 &&
    pensieveRows.length === 0 &&
    conversationRows.length === 0
  ) {
    return EMPTY_CONTEXT;
  }

  const sections: string[] = [];

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

  return sections.join('\n\n');
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
    `- Last message from John: ${formatDate(lastMessageDate)} (${daysSinceLast} days ago)`,
    `- Messages in last 30 days: ${recentCount}`,
    `- Average gap between messages: ${avgGapDays} days`,
  ].join('\n');

  return truncateSection(raw, budget);
}
