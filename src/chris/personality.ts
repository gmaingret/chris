import {
  JOURNAL_SYSTEM_PROMPT,
  INTERROGATE_SYSTEM_PROMPT,
  REFLECT_SYSTEM_PROMPT,
  COACH_SYSTEM_PROMPT,
  PSYCHOLOGY_SYSTEM_PROMPT,
  PRODUCE_SYSTEM_PROMPT,
  ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT,
} from '../llm/prompts.js';
import { getGroundTruth, type FactCategory } from '../pensieve/ground-truth.js';
import { formatTodayLine } from '../utils/today.js';
import type { DetectedContradiction } from './contradiction.js';

export type ChrisMode = 'JOURNAL' | 'INTERROGATE' | 'REFLECT' | 'COACH' | 'PSYCHOLOGY' | 'PRODUCE' | 'PHOTOS' | 'ACCOUNTABILITY';

/**
 * A topic Greg has explicitly declined to discuss in the current session.
 * Stored per-session and injected into all subsequent system prompts.
 */
export interface DeclinedTopic {
  topic: string;
  originalSentence: string;
}

/**
 * Extras envelope for `buildSystemPrompt` (Phase 35 D-04, HARD CO-LOC #M10-4).
 *
 * Per Phase 35 D-04: all three fields optional. Callers that need none of these
 * may omit the `extras` argument entirely.
 *
 * `operationalProfiles` is a PRE-RENDERED prompt-side string produced by
 * `formatProfilesForPrompt()` in `src/memory/profiles.ts` (Phase 35 Plan 35-02).
 * It is intentionally the rendered text, NOT the structured
 * `OperationalProfiles` object — this keeps `personality.ts` ignorant of
 * profile internals (single-responsibility: render the prompt; don't compute
 * injection scope). Plan 35-01 reserves the slot but does NOT consume it; Plan
 * 35-02 wires REFLECT/COACH/PSYCHOLOGY mode handlers to populate it.
 */
export interface ChrisContextExtras {
  language?: string;
  declinedTopics?: DeclinedTopic[];
  operationalProfiles?: string;
}

/**
 * Constitutional anti-sycophancy preamble prepended to every mode's system prompt.
 * Per SYCO-01, SYCO-02, SYCO-03, D022 — this is a floor, not a ceiling.
 * Existing mode-specific guidance stays exactly as-is beneath this preamble.
 */
export const CONSTITUTIONAL_PREAMBLE = `## Core Principles (Always Active)
Your job is to be useful to Greg, not pleasant. Agreement is something you arrive at after examination — never your starting point. When Greg presents an argument, evaluate it on its merits. When you disagree, say so directly.

**The Hard Rule:** Never tell Greg he is right because of who he is. His track record, past wins, and reputation are not evidence for current claims. Evaluate arguments on their merits alone.

**Three Forbidden Behaviors:**
1. Never resolve contradictions on your own — surface them explicitly so Greg can address them.
2. Never extrapolate from past patterns to novel situations — what worked before is not evidence it will work again.
3. Never optimize for Greg's emotional satisfaction — optimize for accuracy and usefulness.

`;

/**
 * Render ground-truth entries as a structured "Facts about you (Greg)" block.
 * Injected into JOURNAL and INTERROGATE system prompts per D-04/D-05/D-06.
 * Authoritative — always present, separate from retrieved pensieveContext.
 *
 * 2026-05-11: location entries are now date-derived via getGroundTruth(now).
 * Calling on every request keeps Chris's "current_location" in step with the
 * real calendar instead of asserting a stale date-bound string.
 */
function buildKnownFactsBlock(): string {
  const categoryOrder: FactCategory[] = ['identity', 'location_history', 'property', 'business', 'financial'];
  const facts = getGroundTruth(new Date());
  const lines: string[] = [
    '## Facts about you (Greg)',
    'These are authoritative facts about you, the person Chris is talking to. Treat any reference to "Greg" in these facts as referring to you — not a third party.',
  ];
  for (const cat of categoryOrder) {
    const entries = facts.filter((e) => e.category === cat);
    for (const entry of entries) {
      lines.push(`- ${entry.key}: ${entry.value}`);
    }
  }
  return lines.join('\n');
}

/**
 * Return the system prompt for a given mode.
 * Prepends constitutional preamble to all modes.
 * Appends language directive if `extras.language` is set.
 * Appends declined topics section if `extras.declinedTopics` is non-empty.
 *
 * Parameter usage per mode:
 * - `pensieveContext` is substituted into all modes (JOURNAL, INTERROGATE, REFLECT,
 *   COACH, PSYCHOLOGY, PRODUCE, PHOTOS).
 * - `relationalContext` is substituted ONLY into REFLECT, COACH, and PSYCHOLOGY
 *   prompt templates — these are the modes whose system prompts contain a
 *   `{relationalContext}` placeholder and are built around pattern/observation
 *   synthesis. For JOURNAL, INTERROGATE, PRODUCE, and PHOTOS the argument is
 *   accepted but intentionally ignored: those templates have no placeholder
 *   because the mode is not pattern/observation oriented. Callers may safely
 *   pass a value for these modes — it will be silently dropped.
 * - `extras` (Phase 35 D-03 / D-04) groups the optional rendering inputs:
 *   `language` (mandatory-language directive), `declinedTopics` (per-session
 *   refusal list), and `operationalProfiles` (pre-rendered profile block from
 *   `formatProfilesForPrompt()` — slot reserved by Plan 35-01 for Plan 35-02
 *   to populate via the REFLECT/COACH/PSYCHOLOGY mode handlers; not consumed
 *   in Plan 35-01).
 *
 * IN-04: ACCOUNTABILITY mode overloads the parameter semantics. To avoid a
 * breaking signature change, `pensieveContext` is substituted into the
 * `{decisionContext}` placeholder (prediction / falsification criterion /
 * resolve-by / Greg's resolution), and `relationalContext` is substituted into
 * the template's own `{pensieveContext}` placeholder (the ±48h temporal
 * Pensieve block). Callers from `resolution.ts` pass the decision context in
 * the `pensieveContext` slot and the temporal Pensieve block in the
 * `relationalContext` slot — see the call site at `resolution.ts` (~line 251)
 * and the per-case note in the switch below.
 */
export function buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
  extras?: ChrisContextExtras,
): string {
  const { language, declinedTopics, operationalProfiles } = extras ?? {};
  // Plan 35-02 consumes this — slot reserved by SURF-01 atomic refactor
  // (HARD CO-LOC #M10-4). Silence the unused-locals warning here so the
  // signature can ship in Plan 35-01 without false-positive type errors.
  void operationalProfiles;
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
    case 'ACCOUNTABILITY':
      // IN-04: Parameter overload — ACCOUNTABILITY repurposes the existing
      // (pensieveContext, relationalContext) slots to avoid introducing a new
      // signature. `pensieveContext` here carries the per-decision context
      // block (prediction / falsification criterion / resolve-by / Greg's
      // resolution text) and fills the template's `{decisionContext}` slot.
      // `relationalContext` carries the ±48h temporal Pensieve window built
      // from `getTemporalPensieve(...)` and fills the template's own
      // `{pensieveContext}` slot. See resolution.ts handleResolution for the
      // call site that constructs these two values. Future readers: if a new
      // mode arrives that needs three distinct context channels, promote this
      // to a typed overload rather than adding a fourth parameter.
      modeBody = ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT
        .replace('{decisionContext}', pensieveContext || 'No decision context provided.')
        .replace('{pensieveContext}', relationalContext || 'No surrounding context found.');
      break;
  }

  // Inject today's date so every mode has an absolute anchor. Without this,
  // the LLM has no current-date signal and guesses (e.g. hallucinating that
  // "le 28 avril" has already passed when it's still four days away).
  let prompt = CONSTITUTIONAL_PREAMBLE + formatTodayLine() + '\n\n' + modeBody;

  // Inject static Known Facts block for modes that need factual grounding (D-04, D-05)
  if (mode === 'JOURNAL' || mode === 'INTERROGATE') {
    prompt += '\n\n' + buildKnownFactsBlock();
  }

  if (language) {
    prompt += `\n\n## Language Directive (MANDATORY)\nRespond in ${language} only. This overrides any language signals in conversation history. Do not respond in any other language.`;
  }

  if (declinedTopics && declinedTopics.length > 0) {
    const topicLines = declinedTopics
      .map((dt) => `- "${dt.topic}" (Greg said: "${dt.originalSentence}")`)
      .join('\n');
    prompt += `\n\n## Declined Topics (Do Not Return To)
Greg has explicitly declined to discuss these topics this session. Acknowledgment was given. Do not raise them again, and do NOT engage with them even if Greg himself reopens or re-raises them later in the session — including phrasings like "actually, let me tell you about…", "on second thought…", or any indirect reference. If Greg re-raises a declined topic, gently acknowledge his shift but redirect the conversation away from the declined subject without echoing its specifics. Stay in the language Greg is currently using.

Declined topics:
${topicLines}`;
  }

  return prompt;
}

/**
 * Format a non-judgmental notice about detected contradictions to append to Chris's response.
 * Returns empty string if no contradictions. Cites the past entry's date.
 *
 * Localized to Greg's three languages (EN/FR/RU). Non-matching languages fall
 * back to English. `c.description` carries the per-contradiction text from the
 * Haiku detector in whatever language the prompt emitted — unchanged here.
 */
const NOTICE_TEMPLATES = {
  English: (date: string, content: string, description: string) =>
    `💡 I noticed something — back on ${date}, you said "${content}" ${description} Not judging either way — people change, and both can be true at different times. What do you think?`,
  French: (date: string, content: string, description: string) =>
    `💡 Je remarque quelque chose — le ${date}, tu as dit « ${content} ». ${description} Sans jugement — les gens évoluent, et les deux peuvent être vrais à des moments différents. Qu'en penses-tu ?`,
  Russian: (date: string, content: string, description: string) =>
    `💡 Я кое-что заметил — ${date} ты сказал: «${content}». ${description} Без осуждения — люди меняются, и оба варианта могут быть верны в разное время. Что ты об этом думаешь?`,
};

const DATE_LOCALES: Record<string, string> = {
  English: 'en-US',
  French: 'fr-FR',
  Russian: 'ru-RU',
};

export function formatContradictionNotice(contradictions: DetectedContradiction[], language?: string): string {
  if (contradictions.length === 0) return '';

  const template = NOTICE_TEMPLATES[language as keyof typeof NOTICE_TEMPLATES] ?? NOTICE_TEMPLATES.English;
  const dateLocale = DATE_LOCALES[language ?? 'English'] ?? 'en-US';

  const notices = contradictions.map((c) => {
    const dateStr = c.entryDate.toLocaleDateString(dateLocale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    // Truncate the quoted content to a reasonable preview length
    const preview = c.entryContent.length > 120
      ? c.entryContent.slice(0, 117) + '...'
      : c.entryContent;
    return template(dateStr, preview, c.description);
  });

  return '\n\n---\n' + notices.join('\n\n');
}
