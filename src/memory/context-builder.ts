import { getRecentHistory } from './conversation.js';
import type { SearchResult } from '../pensieve/retrieve.js';
import type { RelationalMemory } from './relational.js';

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

const ROLE_MAP: Record<string, AnthropicMessage['role']> = {
  USER: 'user',
  ASSISTANT: 'assistant',
};

/**
 * Build an Anthropic-compatible messages array from conversation history.
 *
 * Enforces alternating turns: consecutive messages with the same role are
 * merged with a double-newline separator. The Anthropic API rejects
 * consecutive same-role messages.
 */
export async function buildMessageHistory(
  chatId: bigint,
  limit: number = 20,
): Promise<AnthropicMessage[]> {
  const rows = await getRecentHistory(chatId, limit);

  if (rows.length === 0) return [];

  const merged: AnthropicMessage[] = [];

  for (const row of rows) {
    const role = ROLE_MAP[row.role];
    if (!role) continue; // skip unknown roles
    const last = merged[merged.length - 1];

    if (last && last.role === role) {
      // Merge consecutive same-role messages
      last.content += '\n\n' + row.content;
    } else {
      merged.push({ role, content: row.content });
    }
  }

  return merged;
}

/**
 * Build a formatted context string from relational memory observations
 * for the reflect system prompt.
 *
 * Each observation is formatted as a numbered block:
 * `[1] (2025-03-15 | PATTERN | 0.85) "content"`.
 * Returns a fallback message if no observations exist.
 */
export function buildRelationalContext(memories: RelationalMemory[]): string {
  if (memories.length === 0) return 'No observations accumulated yet.';

  return memories
    .map((m, i) => {
      const date = m.createdAt
        ? new Date(m.createdAt).toISOString().slice(0, 10)
        : 'unknown-date';
      const confidence = m.confidence != null ? m.confidence.toFixed(2) : '0.50';
      return `[${i + 1}] (${date} | ${m.type} | ${confidence}) "${m.content}"`;
    })
    .join('\n');
}

/** Minimum cosine similarity score for a search result to be included in context. */
const SIMILARITY_THRESHOLD = 0.3;

/**
 * Build a formatted context string from Pensieve search results for the
 * interrogate system prompt.
 *
 * Filters out results with score < 0.3, then formats each remaining result
 * as a numbered citation block: `[1] (2025-03-15 | EXPERIENCE | 0.87) "content"`.
 * Returns empty string if no results pass the threshold.
 */
export function buildPensieveContext(results: SearchResult[]): string {
  const filtered = results.filter((r) => r.score >= SIMILARITY_THRESHOLD);

  if (filtered.length === 0) return '';

  return filtered
    .map((r, i) => {
      const date = r.entry.createdAt
        ? new Date(r.entry.createdAt).toISOString().slice(0, 10)
        : 'unknown-date';
      const tag = r.entry.epistemicTag ?? 'UNTAGGED';
      const score = r.score.toFixed(2);
      return `[${i + 1}] (${date} | ${tag} | ${score}) "${r.entry.content}"`;
    })
    .join('\n');
}
