import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../personality.js';

describe('constitutional preamble (SYCO-01)', () => {
  const ALL_MODES = ['JOURNAL', 'INTERROGATE', 'REFLECT', 'COACH', 'PSYCHOLOGY', 'PRODUCE', 'PHOTOS'] as const;

  for (const mode of ALL_MODES) {
    it(`prepends constitutional preamble to ${mode} mode`, () => {
      const prompt = buildSystemPrompt(mode);
      expect(prompt).toMatch(/Core Principles/);
      expect(prompt).toMatch(/useful.*not pleasant/i);
    });
  }
});

describe('The Hard Rule (SYCO-02)', () => {
  it('preamble contains prohibition on appeals to track record', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    expect(prompt).toMatch(/track record/i);
    expect(prompt).toMatch(/never tell.*right because of who he is/i);
  });
});

describe('three forbidden behaviors (SYCO-03)', () => {
  it('preamble contains "never resolve contradictions on your own"', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    expect(prompt).toMatch(/never resolve contradictions/i);
  });

  it('preamble contains "never extrapolate.*novel situations"', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    expect(prompt).toMatch(/never extrapolate/i);
  });

  it('preamble contains "never optimize for.*emotional satisfaction"', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    expect(prompt).toMatch(/never optimize.*emotional satisfaction/i);
  });
});

describe('declined topics injection (TRUST-04)', () => {
  it('includes declined topics section when topics provided', () => {
    const prompt = buildSystemPrompt('JOURNAL', undefined, undefined, undefined, [
      { topic: 'my father', originalSentence: "I don't want to talk about my father" },
    ]);
    expect(prompt).toMatch(/Declined Topics/);
    expect(prompt).toContain("I don't want to talk about my father");
  });

  it('omits declined topics section when empty array', () => {
    const prompt = buildSystemPrompt('JOURNAL', undefined, undefined, undefined, []);
    expect(prompt).not.toMatch(/Declined Topics/);
  });

  it('includes declined topics for all 6 modes (TRUST-04)', () => {
    const modes = ['JOURNAL', 'INTERROGATE', 'REFLECT', 'COACH', 'PSYCHOLOGY', 'PRODUCE'] as const;
    for (const mode of modes) {
      const prompt = buildSystemPrompt(mode, undefined, undefined, undefined, [
        { topic: 'test', originalSentence: 'test sentence' },
      ]);
      expect(prompt).toMatch(/Declined Topics/);
    }
  });
});

describe('language directive injection (LANG-03)', () => {
  it('includes language directive when language provided', () => {
    const prompt = buildSystemPrompt('JOURNAL', undefined, undefined, 'French');
    expect(prompt).toMatch(/French/);
    expect(prompt).toMatch(/MANDATORY|override/i);
  });

  it('omits language directive when no language', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    expect(prompt).not.toMatch(/Language Directive/);
  });

  it('language directive present for all modes', () => {
    const modes = ['JOURNAL', 'INTERROGATE', 'REFLECT', 'COACH', 'PSYCHOLOGY', 'PRODUCE'] as const;
    for (const mode of modes) {
      const prompt = buildSystemPrompt(mode, undefined, undefined, 'Russian');
      expect(prompt).toMatch(/Russian/);
    }
  });
});

describe('JOURNAL question pressure (LANG-04)', () => {
  it('JOURNAL prompt does NOT contain "enriching follow-up questions"', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    expect(prompt).not.toMatch(/enriching follow-up questions/i);
  });

  it('JOURNAL prompt makes questions occasional, not expected', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    // Should contain language indicating questions are optional/occasional
    expect(prompt).toMatch(/occasional|sometimes|rarely|not expected|not every/i);
  });
});

describe('existing mode content preserved (D-02)', () => {
  it('COACH still contains "direct" and "sugarcoat"', () => {
    const prompt = buildSystemPrompt('COACH');
    expect(prompt).toMatch(/direct/i);
    expect(prompt).toMatch(/sugarcoat/i);
  });

  it('INTERROGATE still contains "Memory Entries"', () => {
    const prompt = buildSystemPrompt('INTERROGATE', 'test context');
    expect(prompt).toContain('Memory Entries');
  });

  it('PSYCHOLOGY still contains depth psychology frameworks', () => {
    const prompt = buildSystemPrompt('PSYCHOLOGY');
    expect(prompt).toMatch(/attachment theory/i);
  });
});
