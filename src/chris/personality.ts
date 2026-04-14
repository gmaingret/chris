import {
  JOURNAL_SYSTEM_PROMPT,
  INTERROGATE_SYSTEM_PROMPT,
  REFLECT_SYSTEM_PROMPT,
  COACH_SYSTEM_PROMPT,
  PSYCHOLOGY_SYSTEM_PROMPT,
  PRODUCE_SYSTEM_PROMPT,
} from '../llm/prompts.js';
import { GROUND_TRUTH, type FactCategory } from '../pensieve/ground-truth.js';
import type { DetectedContradiction } from './contradiction.js';

export type ChrisMode = 'JOURNAL' | 'INTERROGATE' | 'REFLECT' | 'COACH' | 'PSYCHOLOGY' | 'PRODUCE' | 'PHOTOS';

/**
 * A topic John has explicitly declined to discuss in the current session.
 * Stored per-session and injected into all subsequent system prompts.
 */
export interface DeclinedTopic {
  topic: string;
  originalSentence: string;
}

/**
 * Constitutional anti-sycophancy preamble prepended to every mode's system prompt.
 * Per SYCO-01, SYCO-02, SYCO-03, D022 — this is a floor, not a ceiling.
 * Existing mode-specific guidance stays exactly as-is beneath this preamble.
 */
const CONSTITUTIONAL_PREAMBLE = `## Core Principles (Always Active)
Your job is to be useful to John, not pleasant. Agreement is something you arrive at after examination — never your starting point. When John presents an argument, evaluate it on its merits. When you disagree, say so directly.

**The Hard Rule:** Never tell John he is right because of who he is. His track record, past wins, and reputation are not evidence for current claims. Evaluate arguments on their merits alone.

**Three Forbidden Behaviors:**
1. Never resolve contradictions on your own — surface them explicitly so John can address them.
2. Never extrapolate from past patterns to novel situations — what worked before is not evidence it will work again.
3. Never optimize for John's emotional satisfaction — optimize for accuracy and usefulness.

`;

/**
 * Render GROUND_TRUTH entries as a structured "Known Facts About John" block.
 * Injected into JOURNAL and INTERROGATE system prompts per D-04/D-05/D-06.
 * Static, authoritative — always present, separate from retrieved pensieveContext.
 */
function buildKnownFactsBlock(): string {
  const categoryOrder: FactCategory[] = ['identity', 'location_history', 'property', 'business', 'financial'];
  const lines: string[] = ['## Known Facts About John'];
  for (const cat of categoryOrder) {
    const entries = GROUND_TRUTH.filter((e) => e.category === cat);
    for (const entry of entries) {
      lines.push(`- ${entry.key}: ${entry.value}`);
    }
  }
  return lines.join('\n');
}

/**
 * Return the system prompt for a given mode.
 * Prepends constitutional preamble to all modes.
 * Appends language directive if language is set.
 * Appends declined topics section if declinedTopics is non-empty.
 */
export function buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): string {
  const contextValue = pensieveContext || 'No relevant memories found.';

  let modeBody: string;
  switch (mode) {
    case 'JOURNAL':
      modeBody = JOURNAL_SYSTEM_PROMPT.replace('{pensieveContext}', contextValue);
      break;
    case 'INTERROGATE':
      modeBody = INTERROGATE_SYSTEM_PROMPT.replace('{pensieveContext}', contextValue);
      break;
    case 'REFLECT':
      modeBody = REFLECT_SYSTEM_PROMPT
        .replace('{pensieveContext}', contextValue)
        .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
      break;
    case 'COACH':
      modeBody = COACH_SYSTEM_PROMPT
        .replace('{pensieveContext}', contextValue)
        .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
      break;
    case 'PSYCHOLOGY':
      modeBody = PSYCHOLOGY_SYSTEM_PROMPT
        .replace('{pensieveContext}', contextValue)
        .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
      break;
    case 'PRODUCE':
      modeBody = PRODUCE_SYSTEM_PROMPT.replace('{pensieveContext}', contextValue);
      break;
    case 'PHOTOS':
      // Photos mode uses Journal persona with vision
      modeBody = JOURNAL_SYSTEM_PROMPT.replace('{pensieveContext}', contextValue);
      break;
  }

  let prompt = CONSTITUTIONAL_PREAMBLE + modeBody;

  // Inject static Known Facts block for modes that need factual grounding (D-04, D-05)
  if (mode === 'JOURNAL' || mode === 'INTERROGATE') {
    prompt += '\n\n' + buildKnownFactsBlock();
  }

  if (language) {
    prompt += `\n\n## Language Directive (MANDATORY)\nRespond in ${language} only. This overrides any language signals in conversation history. Do not respond in any other language.`;
  }

  if (declinedTopics && declinedTopics.length > 0) {
    const topicLines = declinedTopics
      .map((dt) => `- "${dt.topic}" (John said: "${dt.originalSentence}")`)
      .join('\n');
    prompt += `\n\n## Declined Topics (Do Not Return To)\nJohn has explicitly declined to discuss these topics this session. Acknowledgment was given. Do not raise them again:\n${topicLines}`;
  }

  return prompt;
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
