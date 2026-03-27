import { JOURNAL_SYSTEM_PROMPT } from '../llm/prompts.js';

type ChrisMode = 'JOURNAL' | 'INTERROGATE';

/**
 * Return the system prompt for a given mode.
 * INTERROGATE is a placeholder until S05 implements retrieval-augmented responses.
 */
export function buildSystemPrompt(mode: ChrisMode): string {
  switch (mode) {
    case 'JOURNAL':
      return JOURNAL_SYSTEM_PROMPT;
    case 'INTERROGATE':
      // S05 will replace this with a retrieval-augmented prompt
      return JOURNAL_SYSTEM_PROMPT;
  }
}
