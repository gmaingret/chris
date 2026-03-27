import { getRecentHistory } from './conversation.js';

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
