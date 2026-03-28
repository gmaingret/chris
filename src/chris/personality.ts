import {
  JOURNAL_SYSTEM_PROMPT,
  INTERROGATE_SYSTEM_PROMPT,
  REFLECT_SYSTEM_PROMPT,
  COACH_SYSTEM_PROMPT,
  PSYCHOLOGY_SYSTEM_PROMPT,
  PRODUCE_SYSTEM_PROMPT,
} from '../llm/prompts.js';
import type { DetectedContradiction } from './contradiction.js';

export type ChrisMode = 'JOURNAL' | 'INTERROGATE' | 'REFLECT' | 'COACH' | 'PSYCHOLOGY' | 'PRODUCE' | 'PHOTOS';

/**
 * Return the system prompt for a given mode.
 * For INTERROGATE and REFLECT, interpolates the pensieveContext into the prompt template.
 * For REFLECT, additionally interpolates relationalContext.
 */
export function buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
): string {
  const contextValue = pensieveContext || 'No relevant memories found.';
  switch (mode) {
    case 'JOURNAL':
      return JOURNAL_SYSTEM_PROMPT;
    case 'INTERROGATE':
      return INTERROGATE_SYSTEM_PROMPT.replace('{pensieveContext}', contextValue);
    case 'REFLECT':
      return REFLECT_SYSTEM_PROMPT
        .replace('{pensieveContext}', contextValue)
        .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
    case 'COACH':
      return COACH_SYSTEM_PROMPT
        .replace('{pensieveContext}', contextValue)
        .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
    case 'PSYCHOLOGY':
      return PSYCHOLOGY_SYSTEM_PROMPT
        .replace('{pensieveContext}', contextValue)
        .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
    case 'PRODUCE':
      return PRODUCE_SYSTEM_PROMPT.replace('{pensieveContext}', contextValue);
    case 'PHOTOS':
      return JOURNAL_SYSTEM_PROMPT; // Photos mode uses Journal persona with vision
  }
}

/**
 * Format a non-judgmental notice about detected contradictions to append to Chris's response.
 * Returns empty string if no contradictions. Cites the past entry's date.
 */
export function formatContradictionNotice(contradictions: DetectedContradiction[]): string {
  if (contradictions.length === 0) return '';

  const notices = contradictions.map((c) => {
    const dateStr = c.entryDate.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    // Truncate the quoted content to a reasonable preview length
    const preview = c.entryContent.length > 120
      ? c.entryContent.slice(0, 117) + '...'
      : c.entryContent;
    return `💡 I noticed something — back on ${dateStr}, you said "${preview}" ${c.description} Not judging either way — people change, and both can be true at different times. What do you think?`;
  });

  return '\n\n---\n' + notices.join('\n\n');
}
