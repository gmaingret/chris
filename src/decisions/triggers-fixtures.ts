/**
 * Phase 14 CAP-01 — Shared EN/FR/RU trigger-phrase fixture.
 *
 * D-01: PRD trigger phrase set only (initial ship).
 * D-03: Cardinality CI guard — |EN| == |FR| == |RU| == 4 for positives so
 *   translations stay in lockstep. Research A2 resolution (i): extend FR+RU to 4
 *   phrases each using the structural-decision analog of the EN "I'm not sure
 *   whether" — FR adds "je dois choisir entre", RU adds "мне нужно выбрать между".
 * D-04: Abort-phrase sets are final for Phase 14.
 */

export interface TriggerFixturePhrase {
  /** Full example user message containing the trigger phrase. */
  positive: string;
  /** Canonical lowercased trigger phrase as it appears in regex patterns. */
  trigger_phrase: string;
}

export interface TriggerFixtureNegative {
  text: string;
  reason: 'meta_reference' | 'negation' | 'past_tense_report';
}

// Parity invariant (enforced by src/decisions/__tests__/triggers.test.ts):
//   EN_POSITIVES.length === FR_POSITIVES.length === RU_POSITIVES.length === 4

export const EN_POSITIVES: TriggerFixturePhrase[] = [
  { positive: "I'm thinking about quitting my job", trigger_phrase: "i'm thinking about" },
  { positive: "I need to decide whether to move to Paris", trigger_phrase: "i need to decide" },
  { positive: "I'm weighing leaving versus staying another year", trigger_phrase: "i'm weighing" },
  { positive: "I'm not sure whether I should propose", trigger_phrase: "i'm not sure whether" },
];

export const FR_POSITIVES: TriggerFixturePhrase[] = [
  { positive: 'je réfléchis à quitter mon poste', trigger_phrase: 'je réfléchis à' },
  { positive: 'je dois décider si je pars', trigger_phrase: 'je dois décider' },
  { positive: "j'hésite entre rester ou partir", trigger_phrase: "j'hésite" },
  { positive: 'je dois choisir entre Paris et Lyon', trigger_phrase: 'je dois choisir' },
];

export const RU_POSITIVES: TriggerFixturePhrase[] = [
  { positive: 'я думаю о смене работы', trigger_phrase: 'я думаю о' },
  { positive: 'мне нужно решить переезжать ли', trigger_phrase: 'мне нужно решить' },
  { positive: 'я колеблюсь между двумя вариантами', trigger_phrase: 'я колеблюсь' },
  { positive: 'мне нужно выбрать между Москвой и Питером', trigger_phrase: 'мне нужно выбрать' },
];

export const EN_NEGATIVES: TriggerFixtureNegative[] = [
  { text: "I'm not thinking about dinner", reason: 'negation' },
  { text: "She told me I'm thinking about leaving too much", reason: 'meta_reference' },
  { text: "I said I'm weighing the options yesterday but decided already", reason: 'past_tense_report' },
];

export const FR_NEGATIVES: TriggerFixtureNegative[] = [
  { text: "je n'ai pas dit que je réfléchis à ça", reason: 'negation' },
  { text: "il m'a dit je réfléchis trop", reason: 'meta_reference' },
  { text: "j'ai déjà décidé, j'hésite plus", reason: 'negation' },
];

export const RU_NEGATIVES: TriggerFixtureNegative[] = [
  { text: 'я не думаю о работе сейчас', reason: 'negation' },
  { text: 'она сказала мне нужно решить быстрее', reason: 'meta_reference' },
  { text: 'я уже решил, больше не колеблюсь', reason: 'negation' },
];

// D-04 — abort phrases (case-insensitive match against trimmed full user message).

export const ABORT_PHRASES_EN = ['never mind', 'nevermind', 'stop', 'skip'];
export const ABORT_PHRASES_FR = ['annule', 'laisse tomber', 'oublie'];
export const ABORT_PHRASES_RU = ['отмена', 'забудь', 'пропусти'];
