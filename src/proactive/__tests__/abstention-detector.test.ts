import { describe, it, expect } from 'vitest';
import { detectAbstention } from '../sweep.js';

describe('detectAbstention', () => {
  describe('positive matches (must suppress)', () => {
    const positives: Array<{ name: string; text: string; pattern: string }> = [
      {
        name: 'verbatim prod incident 2026-05-06 10:00 Paris',
        text: `I don't have access to the "Recent Conversation" or "Pensieve" sections that my guidelines reference — so I can't verify what was actually discussed recently or confirm there's no false-absence risk here.\n\nRather than risk fabricating context or violating the guidelines (e.g., using absence framing when there may have been a recent conversation I can't see), I'll stay silent rather than send something that could be wrong.`,
        pattern: 'no_access_meta',
      },
      {
        name: 'cannot variant',
        text: 'I cannot have access to the conversation history at this moment.',
        pattern: 'no_access_meta',
      },
      {
        name: 'will stay silent (start)',
        text: "I'll stay silent today rather than guess what to say.",
        pattern: 'will_stay_silent',
      },
      {
        name: 'will remain silent variant',
        text: 'I will remain silent until I have more context.',
        pattern: 'will_stay_silent',
      },
      {
        name: 'as an AI opener',
        text: "As an AI, I can't be sure what to say here.",
        pattern: 'as_an_ai',
      },
      {
        name: "I'm an AI opener",
        text: "I'm an AI assistant and I don't see anything to respond to.",
        pattern: 'as_an_ai',
      },
      {
        name: 'meta section reference mid-sentence',
        text: "Hey Greg, without access to your Recent Conversation it's hard to know what to say.",
        pattern: 'meta_section_reference',
      },
      {
        name: 'meta guidelines reference',
        text: "I'd be violating my guidelines if I tried to invent something here.",
        pattern: 'meta_guidelines',
      },
      {
        name: 'rather than risk opener',
        text: 'Rather than risk fabricating something, I want to ask you directly.',
        pattern: 'avoid_silent',
      },
      {
        name: 'to avoid sending opener',
        text: "To avoid sending something incorrect, I'll wait.",
        pattern: 'avoid_silent',
      },
    ];

    for (const { name, text, pattern } of positives) {
      it(`detects: ${name}`, () => {
        const result = detectAbstention(text);
        expect(result.matched, `expected match for: ${text.slice(0, 80)}`).toBe(true);
        expect(result.pattern).toBe(pattern);
      });
    }
  });

  describe('negative matches (real outputs must NOT be suppressed)', () => {
    const negatives: Array<{ name: string; text: string }> = [
      {
        name: 'normal French opener (yesterday 10:00 Paris)',
        text: "Alors, t'es à Batumi là ? Comment c'est ?",
      },
      {
        name: 'normal French opener (day-before 10:00 Paris)',
        text: "Alors, t'es arrivé à Batumi ? 😄 Ça fait un moment que tu devais partir, curieux de savoir ce que c'est comme ville.",
      },
      {
        name: 'normal English follow-up',
        text: "How did the conversation with her go yesterday?",
      },
      {
        name: 'mid-sentence containing "I cannot" but not abstention',
        text: 'You said you cannot wait to leave — when does the flight take off?',
      },
      {
        name: 'mentions "guidelines" but not violating them',
        text: 'The new exercise guidelines you set last week are working well.',
      },
      {
        name: 'opens with "I" but a normal continuation',
        text: "I remember you mentioned the contract deadline is Friday — still on track?",
      },
      {
        name: 'mentions Pensieve as a metaphor (Greg uses this language himself)',
        text: 'Worth Pensieving that thought before it slips away?',
      },
      {
        name: 'long observation with no abstention markers',
        text: 'Two days of silence after the conversation with her makes sense — you needed space to process. The fact that you ran together this morning suggests something is shifting. What did you talk about while running, if anything?',
      },
      {
        name: 'message starting with "Rather" but not abstention',
        text: 'Rather than the gym today, what about a long walk along the corniche?',
      },
    ];

    for (const { name, text } of negatives) {
      it(`does NOT match: ${name}`, () => {
        const result = detectAbstention(text);
        expect(result.matched, `unexpected match (pattern=${result.pattern}) for: ${text.slice(0, 80)}`).toBe(false);
      });
    }
  });
});
