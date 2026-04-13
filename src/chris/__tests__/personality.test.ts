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

describe('Known Facts injection (RETR-02)', () => {
  it('JOURNAL prompt contains Known Facts block', () => {
    const prompt = buildSystemPrompt('JOURNAL', 'test context');
    expect(prompt).toContain('## Known Facts About Greg');
    expect(prompt).toContain('nationality: French');
    expect(prompt).toContain('birth_place: Cagnes-sur-Mer, France');
    expect(prompt).toContain('fi_target: $1,500,000');
  });

  it('INTERROGATE prompt contains Known Facts block', () => {
    const prompt = buildSystemPrompt('INTERROGATE', 'test context');
    expect(prompt).toContain('## Known Facts About Greg');
    expect(prompt).toContain('nationality: French');
  });

  it('REFLECT prompt does NOT contain Known Facts block', () => {
    const prompt = buildSystemPrompt('REFLECT', 'test context');
    expect(prompt).not.toContain('Known Facts About Greg');
  });

  it('COACH prompt does NOT contain Known Facts block', () => {
    const prompt = buildSystemPrompt('COACH', 'test context');
    expect(prompt).not.toContain('Known Facts About Greg');
  });

  it('Known Facts appears BEFORE Language Directive', () => {
    const prompt = buildSystemPrompt('JOURNAL', 'ctx', undefined, 'French');
    const factsIndex = prompt.indexOf('Known Facts About Greg');
    const langIndex = prompt.indexOf('Language Directive');
    expect(factsIndex).toBeGreaterThan(-1);
    expect(langIndex).toBeGreaterThan(-1);
    expect(factsIndex).toBeLessThan(langIndex);
  });
});

describe('JOURNAL pensieveContext replacement (RETR-01)', () => {
  it('replaces {pensieveContext} with provided context', () => {
    const prompt = buildSystemPrompt('JOURNAL', 'Here are some memories about cooking');
    expect(prompt).toContain('Here are some memories about cooking');
    expect(prompt).not.toContain('{pensieveContext}');
  });

  it('uses fallback when pensieveContext is undefined', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    expect(prompt).toContain('No relevant memories found');
    expect(prompt).not.toContain('{pensieveContext}');
  });
});

describe('hallucination resistance (RETR-04)', () => {
  it('JOURNAL prompt contains hallucination resistance instruction', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    expect(prompt).toContain("I don't have any memories about that");
  });

  it('INTERROGATE still has hallucination resistance (no duplicate)', () => {
    const prompt = buildSystemPrompt('INTERROGATE', 'test');
    const matches = prompt.match(/I don't have any memories about that/g);
    // INTERROGATE should have exactly one occurrence (from its own prompt template)
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(1);
  });
});
