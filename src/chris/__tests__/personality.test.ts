import { describe, it, expect } from 'vitest';
import { CONSTITUTIONAL_PREAMBLE, buildSystemPrompt } from '../personality.js';

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
    const prompt = buildSystemPrompt('JOURNAL', undefined, undefined, {
      declinedTopics: [
        { topic: 'my father', originalSentence: "I don't want to talk about my father" },
      ],
    });
    expect(prompt).toMatch(/Declined Topics/);
    expect(prompt).toContain("I don't want to talk about my father");
  });

  it('omits declined topics section when empty array', () => {
    const prompt = buildSystemPrompt('JOURNAL', undefined, undefined, { declinedTopics: [] });
    expect(prompt).not.toMatch(/Declined Topics/);
  });

  it('includes declined topics for all 6 modes (TRUST-04)', () => {
    const modes = ['JOURNAL', 'INTERROGATE', 'REFLECT', 'COACH', 'PSYCHOLOGY', 'PRODUCE'] as const;
    for (const mode of modes) {
      const prompt = buildSystemPrompt(mode, undefined, undefined, {
        declinedTopics: [{ topic: 'test', originalSentence: 'test sentence' }],
      });
      expect(prompt).toMatch(/Declined Topics/);
    }
  });
});

describe('language directive injection (LANG-03)', () => {
  it('includes language directive when language provided', () => {
    const prompt = buildSystemPrompt('JOURNAL', undefined, undefined, { language: 'French' });
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
      const prompt = buildSystemPrompt(mode, undefined, undefined, { language: 'Russian' });
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
    expect(prompt).toContain('## Facts about you (Greg)');
    expect(prompt).toContain('nationality: French');
    expect(prompt).toContain('birth_place: Cagnes-sur-Mer, France');
    expect(prompt).toContain('fi_target: $1,500,000');
  });

  it('INTERROGATE prompt contains Known Facts block', () => {
    const prompt = buildSystemPrompt('INTERROGATE', 'test context');
    expect(prompt).toContain('## Facts about you (Greg)');
    expect(prompt).toContain('nationality: French');
  });

  it('REFLECT prompt does NOT contain Known Facts block', () => {
    const prompt = buildSystemPrompt('REFLECT', 'test context');
    expect(prompt).not.toContain('Facts about you (Greg)');
  });

  it('COACH prompt does NOT contain Known Facts block', () => {
    const prompt = buildSystemPrompt('COACH', 'test context');
    expect(prompt).not.toContain('Facts about you (Greg)');
  });

  it('Known Facts appears BEFORE Language Directive', () => {
    const prompt = buildSystemPrompt('JOURNAL', 'ctx', undefined, { language: 'French' });
    const factsIndex = prompt.indexOf('Facts about you (Greg)');
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

describe('Identity grounding (Phase 11 / RETR-01, RETR-02)', () => {
  const ALL_MODES = ['JOURNAL', 'INTERROGATE', 'REFLECT', 'COACH', 'PSYCHOLOGY', 'PRODUCE', 'PHOTOS'] as const;

  for (const mode of ALL_MODES) {
    it(`${mode} prompt does not contain the string "John"`, () => {
      const prompt = buildSystemPrompt(mode, 'test-context');
      expect(prompt).not.toMatch(/\bJohn\b/);
    });
  }

  it('JOURNAL Known Facts header is "Facts about you (Greg)"', () => {
    const prompt = buildSystemPrompt('JOURNAL', 'test');
    expect(prompt).toContain('## Facts about you (Greg)');
  });

  it('JOURNAL Known Facts block contains the anti-split explanatory sentence', () => {
    const prompt = buildSystemPrompt('JOURNAL', 'test');
    // The explanation MUST tell the model that "Greg" in the facts === the user
    expect(prompt).toMatch(/Greg.*refer.*you|you.*not a third party/i);
  });

  it('CONSTITUTIONAL_PREAMBLE addresses the user as Greg', () => {
    const prompt = buildSystemPrompt('JOURNAL');
    // The preamble's "Your job is to be useful to ___" must be Greg
    expect(prompt).toMatch(/useful to Greg/);
  });
});

describe('CONSTITUTIONAL_PREAMBLE export (Phase 21 CONS-04 dependency)', () => {
  it('is a non-empty string exported from personality.ts', () => {
    expect(typeof CONSTITUTIONAL_PREAMBLE).toBe('string');
    expect(CONSTITUTIONAL_PREAMBLE.length).toBeGreaterThan(100);
  });

  it('contains the Hard Rule clause (D027)', () => {
    expect(CONSTITUTIONAL_PREAMBLE).toContain(
      'Never tell Greg he is right because of who he is',
    );
  });

  it('contains the Three Forbidden Behaviors marker (D024)', () => {
    expect(CONSTITUTIONAL_PREAMBLE).toContain('Three Forbidden Behaviors:');
  });

  it('is the exact prefix of every mode’s system prompt — single source of truth', () => {
    const prompt = buildSystemPrompt('JOURNAL', 'context', undefined, { language: 'English' });
    expect(prompt.startsWith(CONSTITUTIONAL_PREAMBLE)).toBe(true);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 35 Plan 35-02 — extras.operationalProfiles injection (D-07, D-28)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('extras.operationalProfiles injection (Phase 35 D-07)', () => {
  const PROFILE_BLOCK =
    '## Operational Profile (grounded context — not interpretation)\n\nfake-jurisdictional-block';
  const PENSIEVE = 'PENSIEVE_FACTS_MARKER';

  it('REFLECT: prepends operationalProfiles ABOVE pensieveContext when set', () => {
    const out = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
      operationalProfiles: PROFILE_BLOCK,
    });
    expect(out).toContain('fake-jurisdictional-block');
    expect(out).toContain(PENSIEVE);
    const iProfile = out.indexOf('fake-jurisdictional-block');
    const iPensieve = out.indexOf(PENSIEVE);
    expect(iProfile).toBeGreaterThan(0);
    expect(iPensieve).toBeGreaterThan(iProfile);
  });

  it('COACH: prepends operationalProfiles ABOVE pensieveContext when set', () => {
    const out = buildSystemPrompt('COACH', PENSIEVE, 'REL', {
      operationalProfiles: PROFILE_BLOCK,
    });
    expect(out).toContain('fake-jurisdictional-block');
    expect(out).toContain(PENSIEVE);
    const iProfile = out.indexOf('fake-jurisdictional-block');
    const iPensieve = out.indexOf(PENSIEVE);
    expect(iProfile).toBeGreaterThan(0);
    expect(iPensieve).toBeGreaterThan(iProfile);
  });

  it('PSYCHOLOGY: prepends operationalProfiles ABOVE pensieveContext when set', () => {
    const out = buildSystemPrompt('PSYCHOLOGY', PENSIEVE, 'REL', {
      operationalProfiles: PROFILE_BLOCK,
    });
    expect(out).toContain('fake-jurisdictional-block');
    expect(out).toContain(PENSIEVE);
    const iProfile = out.indexOf('fake-jurisdictional-block');
    const iPensieve = out.indexOf(PENSIEVE);
    expect(iProfile).toBeGreaterThan(0);
    expect(iPensieve).toBeGreaterThan(iProfile);
  });

  it('JOURNAL silently drops extras.operationalProfiles (D-28)', () => {
    const out = buildSystemPrompt('JOURNAL', PENSIEVE, undefined, {
      operationalProfiles: 'should-not-appear-in-journal',
    });
    expect(out).not.toContain('should-not-appear-in-journal');
  });

  it('INTERROGATE silently drops extras.operationalProfiles (D-28)', () => {
    const out = buildSystemPrompt('INTERROGATE', PENSIEVE, undefined, {
      operationalProfiles: 'should-not-appear-in-interrogate',
    });
    expect(out).not.toContain('should-not-appear-in-interrogate');
  });

  it('PRODUCE silently drops extras.operationalProfiles (D-28)', () => {
    const out = buildSystemPrompt('PRODUCE', PENSIEVE, undefined, {
      operationalProfiles: 'should-not-appear-in-produce',
    });
    expect(out).not.toContain('should-not-appear-in-produce');
  });

  it('PHOTOS silently drops extras.operationalProfiles (D-28)', () => {
    const out = buildSystemPrompt('PHOTOS', PENSIEVE, undefined, {
      operationalProfiles: 'should-not-appear-in-photos',
    });
    expect(out).not.toContain('should-not-appear-in-photos');
  });

  it('ACCOUNTABILITY silently drops extras.operationalProfiles (D-28)', () => {
    const out = buildSystemPrompt('ACCOUNTABILITY', 'decision-ctx', 'temporal-ctx', {
      operationalProfiles: 'should-not-appear-in-accountability',
    });
    expect(out).not.toContain('should-not-appear-in-accountability');
  });

  it('REFLECT: empty operationalProfiles string behaves identically to undefined (D-12)', () => {
    const withEmpty = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
      operationalProfiles: '',
    });
    const withoutField = buildSystemPrompt('REFLECT', PENSIEVE, 'REL');
    expect(withEmpty).toBe(withoutField);
    // Sanity: empty string must NOT introduce the verbatim header
    expect(withEmpty).not.toContain('## Operational Profile (grounded context — not interpretation)');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 39 Plan 39-01 — extras.psychologicalProfiles injection (D-11, D-14, D-15)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('extras.psychologicalProfiles injection (Phase 39 D-11)', () => {
  const PSYCH_BLOCK =
    '## Psychological Profile (inferred — low precision, never use as authority)\n\nfake-hexaco-line';
  const OP_BLOCK =
    '## Operational Profile (grounded context — not interpretation)\n\nfake-op-line';
  const PENSIEVE = 'PENSIEVE_MARKER';

  it('REFLECT: psychological → operational → pensieve order (D-11)', () => {
    const out = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
      psychologicalProfiles: PSYCH_BLOCK,
      operationalProfiles: OP_BLOCK,
    });
    const iPsych = out.indexOf('fake-hexaco-line');
    const iOp = out.indexOf('fake-op-line');
    const iPensieve = out.indexOf(PENSIEVE);
    expect(iPsych).toBeGreaterThan(-1);
    expect(iOp).toBeGreaterThan(iPsych);
    expect(iPensieve).toBeGreaterThan(iOp);
  });

  it('PSYCHOLOGY: psychological → operational → pensieve order (D-11)', () => {
    const out = buildSystemPrompt('PSYCHOLOGY', PENSIEVE, 'REL', {
      psychologicalProfiles: PSYCH_BLOCK,
      operationalProfiles: OP_BLOCK,
    });
    const iPsych = out.indexOf('fake-hexaco-line');
    const iOp = out.indexOf('fake-op-line');
    const iPensieve = out.indexOf(PENSIEVE);
    expect(iPsych).toBeGreaterThan(-1);
    expect(iOp).toBeGreaterThan(iPsych);
    expect(iPensieve).toBeGreaterThan(iOp);
  });

  it('COACH silently drops extras.psychologicalProfiles (D-14 + D-12)', () => {
    const out = buildSystemPrompt('COACH', PENSIEVE, 'REL', {
      operationalProfiles: OP_BLOCK,
      psychologicalProfiles: 'should-not-appear-in-coach',
    });
    expect(out).not.toContain('should-not-appear-in-coach');
    // Operational still renders for COACH (M010 wiring untouched).
    expect(out).toContain('fake-op-line');
  });

  // Silent-drop sweep for the 5 modes that MUST NOT receive psych injection (D-15).
  for (const mode of ['JOURNAL', 'INTERROGATE', 'PRODUCE', 'PHOTOS', 'ACCOUNTABILITY'] as const) {
    it(`${mode} silently drops extras.psychologicalProfiles (D-15)`, () => {
      const out = buildSystemPrompt(mode, PENSIEVE, 'REL', {
        psychologicalProfiles: 'should-not-appear-in-' + mode.toLowerCase(),
      });
      expect(out).not.toContain('should-not-appear-in-' + mode.toLowerCase());
    });
  }

  it('REFLECT with empty psychologicalProfiles string behaves identically to undefined', () => {
    const withEmpty = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
      operationalProfiles: OP_BLOCK,
      psychologicalProfiles: '',
    });
    const withoutField = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
      operationalProfiles: OP_BLOCK,
    });
    expect(withEmpty).toBe(withoutField);
  });

  it('REFLECT with empty psych + empty op renders pensieve cleanly (no orphan separators)', () => {
    const out = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
      psychologicalProfiles: '',
      operationalProfiles: '',
    });
    expect(out).not.toMatch(/{pensieveContext}\n\n\n/);
    expect(out).toContain(PENSIEVE);
  });
});
