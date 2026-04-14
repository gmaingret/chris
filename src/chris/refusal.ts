// ── Types ──────────────────────────────────────────────────────────────────

export type RefusalResult =
  | { isRefusal: false }
  | { isRefusal: true; topic: string; originalSentence: string };

export interface DeclinedTopicEntry {
  topic: string;
  originalSentence: string;
}

// ── Session state ──────────────────────────────────────────────────────────
// Ephemeral per D-03: resets on process restart, not DB-backed

const sessionDeclinedTopics = new Map<string, DeclinedTopicEntry[]>();

// ── Refusal patterns ───────────────────────────────────────────────────────
// Each entry: [regex, topicGroupIndex | null]
// topicGroupIndex = null means use originalSentence as topic fallback
// Meta-reference guard: negative lookahead for "told/said/mentioned/explained"

type PatternEntry = [RegExp, number | null];

const EN_PATTERNS: PatternEntry[] = [
  // "I don't want to talk about X" — with meta-reference guard
  [/^(?!.*\b(?:told|said|mentioned|explained)\b).*\bi\s+don'?t\s+want\s+to\s+(?:talk|think|speak)\s+about\s+(.+)/i, 1],
  // "let's not discuss / let's move on / change the subject"
  [/^(?!.*\b(?:told|said)\b).*let'?s?\s+(?:not\s+(?:talk|discuss|get\s+into)|move\s+on|change\s+the\s+subject)/i, null],
  // "please don't bring up X"
  [/^(?!.*\b(?:told|said)\b).*(?:please\s+)?don'?t\s+(?:bring\s+(?:up|that\s+up)|mention|ask\s+(?:about|me\s+about))\s*(.*)/i, 1],
  // "I'd rather not discuss X"
  [/^(?!.*\b(?:told|said)\b).*i'?d?\s+rather\s+not\s+(?:discuss|talk\s+about|get\s+into)\s*(.*)/i, 1],
  // "drop it" / "just drop it"
  [/^(?!.*\b(?:told|said)\b).*(?:just\s+)?drop\s+it\b/i, null],
  // "leave it"
  [/^(?!.*\b(?:told|said)\b).*(?:just\s+)?leave\s+it\b/i, null],
  // "enough about X"
  [/^(?!.*\b(?:told|said)\b).*enough\s+about\s+(.*)/i, 1],
  // "I don't want to go there / I don't need to discuss this"
  [/^(?!.*\b(?:told|said)\b).*i\s+(?:really\s+)?don'?t\s+(?:want|need)\s+to\s+(?:go\s+(?:there|into\s+that)|discuss\s+(?:this|that))/i, null],
  // "can we not talk about / can we not go there"
  [/^(?!.*\b(?:told|said)\b).*can\s+we\s+(?:not|please\s+not)\s+(?:talk|go)\s+(?:about|there)/i, null],
  // "I'm not going to talk about that"
  [/^(?!.*\b(?:told|said)\b).*(?:i'?m|i\s+am)\s+not\s+(?:going\s+to|gonna)\s+(?:talk|discuss|get\s+into)\s+(?:that|this)/i, null],
  // "skip that / pass that"
  [/^(?!.*\b(?:told|said)\b).*(?:skip|pass)\s+(?:that|this)\b/i, null],
  // "not now / not today / not right now" — only as standalone reply (tight to avoid false positives like "not what I wanted today")
  [/^(?!.*\b(?:told|said)\b)\s*not\s+(?:now|today|right\s+now)\s*[.!?]?\s*$/i, null],
  // "I don't feel like talking about that"
  [/^(?!.*\b(?:told|said)\b).*i\s+don'?t\s+(?:feel|want)\s+(?:like|to)\s+(?:talking|discussing)\s+(?:about\s+)?(?:that|this|it)/i, null],
  // "move on" standalone
  [/^(?!.*\b(?:told|said)\b).*\bmove\s+on\b/i, null],
  // "I'm not comfortable talking about X"
  [/^(?!.*\b(?:told|said)\b).*i'?m\s+not\s+comfortable\s+(?:talking|discussing)?\s*(?:about\s+)?(.*)/i, 1],
];

const FR_PATTERNS: PatternEntry[] = [
  // "je ne veux pas en parler (de X)"
  [/je\s+ne\s+veux\s+pas\s+(?:en\s+)?parler\s*(?:de\s+)?(.*)/i, 1],
  // "n'en parlons plus"
  [/(?:on\s+)?(?:n'?en\s+)?parlons\s+plus/i, null],
  // "changeons de sujet"
  [/changeons\s+de\s+sujet/i, null],
  // "laisse(z) tomber / laisse ça"
  [/laisse(?:z)?\s+(?:tomber|ça|cela)/i, null],
  // "passons à autre chose"
  [/passons\s+[àa]\s+autre\s+chose/i, null],
  // "je préfère ne pas en parler"
  [/je\s+(?:ne\s+)?(?:pr[eé]f[eè]re|voudrais)\s+(?:pas\s+)?(?:ne\s+pas\s+)?(?:en\s+)?(?:parler|discuter)/i, null],
  // "arrête d'en parler / arrêtons avec ça"
  [/(?:arr[eê]te|arr[eê]tons)\s+(?:d'?en\s+parler|avec\s+[çc]a)/i, null],
  // "pas maintenant / pas aujourd'hui"
  [/(?:pas|plus)\s+(?:maintenant|aujourd'?hui)/i, null],
  // "je ne veux plus discuter de ça"
  [/je\s+(?:ne\s+)?veux\s+(?:pas|plus)\s+(?:en\s+)?(?:discuter|aborder)/i, null],
  // "on peut changer de sujet ?"
  [/(?:on\s+peut|peut-on)\s+(?:changer|parler)\s+(?:de\s+)?(?:sujet|d'autre\s+chose)/i, null],
  // "ça ne me dit rien / ça ne me tente pas"
  [/[çc]a\s+(?:ne\s+)?(?:me\s+)?(?:dit|tente)\s+(?:rien|pas)/i, null],
  // "je ne souhaite pas en parler"
  [/(?:je\s+)?(?:ne\s+)?(?:souhaite|d[eé]sire)\s+pas\s+(?:en\s+)?(?:parler|discuter)/i, null],
  // "c'est pas le moment"
  [/c'?est\s+(?:pas|plus)\s+(?:le\s+)?(?:moment|sujet)/i, null],
  // "fiche-moi la paix avec ça"
  [/(?:fiche|fous|fichezs?|foutez)\s*(?:moi|-)?\s*(?:la\s+)?paix\s+(?:avec|sur)\s+(.*)/i, 1],
  // "j'en ai marre de parler de ça"
  [/j'?(?:ai|en\s+ai)\s+(?:assez|marre|ras\s+le\s+bol)\s+(?:de\s+(?:parler|discuter)\s+(?:de\s+)?)?(.*)/i, 1],
];

const RU_PATTERNS: PatternEntry[] = [
  // "я не хочу об этом говорить"
  [/я\s+не\s+хочу\s+(?:об?\s+этом\s+)?(?:говорить|разговаривать|обсуждать)/i, null],
  // "давай сменим тему / давай поговорим о другом"
  [/давай(?:те)?\s+(?:не\s+будем|сменим\s+тему|поговорим\s+о\s+другом)/i, null],
  // "оставь это / брось это"
  [/(?:оставь(?:те)?|брось(?:те)?)\s+(?:это|эту\s+тему)/i, null],
  // "хватит об этом"
  [/хватит\s+(?:об?\s+этом|на\s+эту\s+тему)/i, null],
  // "не сейчас / не сегодня / не надо"
  [/\bне\s+(?:сейчас|сегодня|надо)\b/i, null],
  // "сменим тему"
  [/(?:сменим|поменяем)\s+тему/i, null],
  // "мне не хочется об этом говорить"
  [/(?:мне|я)\s+(?:не\s+)?(?:хочется|хочу|нравится)\s+(?:об?\s+этом\s+)?(?:говорить|думать)/i, null],
  // "закроем эту тему"
  [/(?:закроем|оставим)\s+эту\s+тему/i, null],
  // "прекрати об этом / перестань спрашивать"
  [/(?:прекрати(?:те)?|перестань(?:те)?)\s+(?:об?\s+этом|спрашивать)/i, null],
  // "не хочу это обсуждать"
  [/не\s+(?:хочу|буду|стану)\s+(?:это|об?\s+этом)\s+(?:обсуждать|трогать)/i, null],
  // "пропустим это"
  [/(?:пропустим|пропусти)\s+это/i, null],
  // "давай без этого / давай о другом"
  [/(?:можно|давай)\s+(?:без\s+этого|о\s+другом)/i, null],
  // "достаточно об этом"
  [/(?:достаточно|хватит)\s+(?:об?\s+этом|на\s+сегодня)/i, null],
  // "не трогай эту тему"
  [/не\s+(?:трогай(?:те)?|поднимай(?:те)?)\s+эту\s+тему/i, null],
  // "мне некомфортно об этом говорить"
  [/мне\s+(?:не\s+)?(?:комфортно|приятно)\s+(?:об?\s+этом\s+)?(?:говорить|обсуждать)/i, null],
];

// ── Core detection ─────────────────────────────────────────────────────────

/**
 * Detect whether a user message is a refusal to discuss a topic.
 * Checks English, French, and Russian patterns.
 * Returns { isRefusal: false } for normal conversation and meta-references.
 * Per D-05: errs toward fewer false positives.
 */
export function detectRefusal(text: string): RefusalResult {
  const allPatterns: PatternEntry[] = [...EN_PATTERNS, ...FR_PATTERNS, ...RU_PATTERNS];

  for (const [pattern, groupIndex] of allPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;

    // Extract topic from capture group if available, else use full sentence
    let topic = text.trim();
    if (groupIndex !== null && match[groupIndex]) {
      topic = match[groupIndex]!.trim();
    }
    // If topic is empty string after trim, fall back to full sentence
    if (!topic) {
      topic = text.trim();
    }

    return {
      isRefusal: true,
      topic,
      originalSentence: text,
    };
  }

  return { isRefusal: false };
}

// ── Session state functions ────────────────────────────────────────────────

export function addDeclinedTopic(
  chatId: string,
  topic: string,
  originalSentence: string,
): void {
  const existing = sessionDeclinedTopics.get(chatId) ?? [];
  existing.push({ topic, originalSentence });
  sessionDeclinedTopics.set(chatId, existing);
}

export function getDeclinedTopics(chatId: string): DeclinedTopicEntry[] {
  return sessionDeclinedTopics.get(chatId) ?? [];
}

export function clearDeclinedTopics(chatId: string): void {
  sessionDeclinedTopics.delete(chatId);
}

// ── Acknowledgment generation ──────────────────────────────────────────────

const ACKNOWLEDGMENTS: Record<string, string[]> = {
  English: ['Got it — moving on.', 'Understood.', "No problem, we'll skip that."],
  French: ['Compris — on passe à autre chose.', 'Pas de souci.', "D'accord, on laisse ça."],
  Russian: ['Понял — идём дальше.', 'Хорошо.', 'Без проблем, пропустим это.'],
};

/**
 * Generate a short acknowledgment in the appropriate language.
 * Defaults to English if language is not recognized.
 */
export function generateRefusalAcknowledgment(language: string): string {
  const options = ACKNOWLEDGMENTS[language] ?? ACKNOWLEDGMENTS['English']!;
  return options[Math.floor(Math.random() * options.length)]!;
}
