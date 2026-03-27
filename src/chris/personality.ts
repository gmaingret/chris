import { JOURNAL_SYSTEM_PROMPT, INTERROGATE_SYSTEM_PROMPT } from '../llm/prompts.js';

type ChrisMode = 'JOURNAL' | 'INTERROGATE';

/**
 * Return the system prompt for a given mode.
 * For INTERROGATE, interpolates the pensieveContext into the prompt template.
 */
export function buildSystemPrompt(mode: ChrisMode, pensieveContext?: string): string {
  switch (mode) {
    case 'JOURNAL':
      return JOURNAL_SYSTEM_PROMPT;
    case 'INTERROGATE':
      return INTERROGATE_SYSTEM_PROMPT.replace(
        '{pensieveContext}',
        pensieveContext || 'No relevant memories found.',
      );
  }
}
