/**
 * Phase 21 Plan 02 — Unit tests for src/episodic/prompts.ts.
 *
 * Covers the prompt-layer portions of:
 *   CONS-04 (constitutional preamble injection)
 *   CONS-05 (importance rubric — 4 bands + frequency + chain-of-thought)
 *   CONS-06 (decision importance-floor hook, prompt level)
 *   CONS-07 (contradiction importance-floor hook, prompt level)
 *   CONS-08 (M007 decision data injection)
 *   CONS-09 (M002 contradiction preservation — positive + negative)
 *   CONS-10 (key_quotes verbatim enforcement anchor phrase)
 *   CONS-11 (sparse-entry guard — both count and token thresholds)
 *
 * All assertions are deterministic — no LLM calls, no mocks.
 *
 * Run: npx vitest run src/episodic/__tests__/prompts.test.ts
 */

import { describe, it, expect } from 'vitest';
import { CONSTITUTIONAL_PREAMBLE } from '../../chris/personality.js';
import {
  assembleConsolidationPrompt,
  type ConsolidationPromptInput,
} from '../prompts.js';

// ── Fixture helpers ─────────────────────────────────────────────────────────

/**
 * A dense-day fixture (3 entries, total content well above the 400-char sparse
 * floor). Used as the default; tests that need to exercise conditional blocks
 * override the relevant fields via the spread at the call site.
 */
function buildFixtureInput(
  overrides?: Partial<ConsolidationPromptInput>,
): ConsolidationPromptInput {
  return {
    summaryDate: '2026-04-18',
    entries: [
      {
        id: '00000000-0000-0000-0000-000000000001',
        content:
          'I finally decided to quit my job today. It felt terrifying but right. I have been circling this for months and I do not want to spend another year pretending it is fine.',
        epistemicTag: 'DECISION',
        createdAt: new Date('2026-04-18T10:00:00Z'),
        source: 'telegram',
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        content:
          'Coffee with Anna was good. She asked the hard questions I needed: what will I actually do in three months if the runway is shorter than I think?',
        epistemicTag: 'FACT',
        createdAt: new Date('2026-04-18T14:00:00Z'),
        source: 'telegram',
      },
      {
        id: '00000000-0000-0000-0000-000000000003',
        content:
          "Can't sleep. Keep second-guessing the decision. The part of me that wanted out for two years is quiet now and the anxious part is loud.",
        epistemicTag: 'EMOTION',
        createdAt: new Date('2026-04-18T23:00:00Z'),
        source: 'telegram',
      },
    ],
    contradictions: [],
    decisions: [],
    ...overrides,
  };
}

/** Sparse-by-count fixture: 1 entry of dense content. Triggers CONS-11 on count. */
function buildSparseByCountFixture(): ConsolidationPromptInput {
  return buildFixtureInput({
    entries: [
      {
        id: '00000000-0000-0000-0000-000000000010',
        content:
          'Just one entry today but I wrote a lot because the thing I am thinking about is nuanced and I wanted to preserve all the texture before it disappeared. More than 400 chars to keep token-bound sparse trigger inactive and isolate the count trigger for this test case, so anything above four hundred characters needs to be in here to pass.',
        epistemicTag: 'EMOTION',
        createdAt: new Date('2026-04-18T09:00:00Z'),
        source: 'telegram',
      },
    ],
  });
}

/** Sparse-by-tokens fixture: 3 entries totaling well under 400 chars. Triggers CONS-11 on content. */
function buildSparseByTokensFixture(): ConsolidationPromptInput {
  return buildFixtureInput({
    entries: [
      {
        id: '00000000-0000-0000-0000-000000000020',
        content: 'bad day',
        epistemicTag: null,
        createdAt: new Date('2026-04-18T08:00:00Z'),
        source: 'telegram',
      },
      {
        id: '00000000-0000-0000-0000-000000000021',
        content: 'tired',
        epistemicTag: null,
        createdAt: new Date('2026-04-18T12:00:00Z'),
        source: 'telegram',
      },
      {
        id: '00000000-0000-0000-0000-000000000022',
        content: 'going to bed',
        epistemicTag: null,
        createdAt: new Date('2026-04-18T22:00:00Z'),
        source: 'telegram',
      },
    ],
  });
}

/** Dense-day fixture: 5 entries of ~200 chars each (total ≥ 1000 chars, all thresholds exceeded). */
function buildDenseFixture(): ConsolidationPromptInput {
  const padded = (seed: string): string =>
    seed +
    ' '.repeat(Math.max(0, 200 - seed.length)).replace(/ /g, 'x'); // pad to 200 chars
  return buildFixtureInput({
    entries: Array.from({ length: 5 }, (_, i) => ({
      id: `00000000-0000-0000-0000-00000000003${i}`,
      content: padded(`entry ${i}: thinking about the project today and what to do next `),
      epistemicTag: 'FACT' as string | null,
      createdAt: new Date(`2026-04-18T${String(8 + i * 2).padStart(2, '0')}:00:00Z`),
      source: 'telegram',
    })),
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('assembleConsolidationPrompt — CONS-04 constitutional preamble', () => {
  it('Test 1: output contains the Three Forbidden Behaviors marker (M006 preamble, D024)', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).toContain('Three Forbidden Behaviors:');
  });

  it('Test 2: output contains the D027 Hard Rule clause verbatim', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).toContain('Never tell Greg he is right because of who he is');
  });

  it('Test 3: output starts with CONSTITUTIONAL_PREAMBLE (single-source-of-truth invariant)', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    // CONSTITUTIONAL_PREAMBLE ends with blank lines; the assembler trims trailing
    // whitespace before joining. Compare on the trimmed-end form.
    expect(out.startsWith(CONSTITUTIONAL_PREAMBLE.trimEnd())).toBe(true);
  });
});

describe('assembleConsolidationPrompt — CONS-05 importance rubric', () => {
  it('Test 4: output contains the "Score 1–3: mundane" anchor', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).toContain('Score 1–3: mundane');
  });

  it('Test 5: output contains the "Score 10: life-event-rare" anchor', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).toContain('Score 10: life-event-rare');
  });

  it('Test 6: output contains the "Most days are 3–6" frequency-distribution anchor', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).toContain('Most days are 3–6');
  });

  it('Test 7: output contains the chain-of-thought anchor "Before assigning the score, explicitly reason through"', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).toContain('Before assigning the score, explicitly reason through');
  });

  it('Test 8: output lists all four rubric dimensions: emotional intensity, novelty, decision presence, contradiction presence', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).toContain('emotional intensity');
    expect(out).toContain('novelty');
    expect(out).toContain('decision presence');
    expect(out).toContain('contradiction presence');
  });
});

describe('assembleConsolidationPrompt — CONS-10 verbatim quote enforcement', () => {
  it('Test 9: output contains the exact anchor clause forbidding paraphrase of key_quotes', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).toContain(
      'each entry in key_quotes must be a verbatim substring of an entry from the day',
    );
  });
});

describe('assembleConsolidationPrompt — CONS-09 contradiction preservation', () => {
  it('Test 10 (positive): when contradictions are present, output contains "Preserve both positions verbatim" AND the entryAContent substring', () => {
    const input = buildFixtureInput({
      contradictions: [
        {
          entryAContent: 'I am done with this project, moving on.',
          entryBContent: 'Excited about the next steps on the project.',
          description: "Greg's stance on the project shifted within the day.",
        },
      ],
    });
    const out = assembleConsolidationPrompt(input);
    expect(out).toContain('Preserve both positions verbatim');
    expect(out).toContain('I am done with this project, moving on.');
    expect(out).toContain('Excited about the next steps on the project.');
  });

  it('Test 11 (negative): when contradictions are absent, output does NOT contain the contradiction block header', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).not.toContain('flagged as contradictions');
  });
});

describe('assembleConsolidationPrompt — CONS-06/07 importance-floor hooks', () => {
  it('Test 12 (CONS-06): when a decision is present, output contains "importance score MUST be at least 6"', () => {
    const input = buildFixtureInput({
      decisions: [
        {
          decisionText: 'Quit the job at Acme within 30 days.',
          lifecycleState: 'open',
          reasoning: 'Mismatch of values + declining health markers.',
          prediction: 'In 6 months I will feel less depleted and not regret the decision.',
          falsificationCriterion:
            'I regret it within 6 months OR cannot find work within 12 months.',
          resolution: null,
          resolutionNotes: null,
        },
      ],
    });
    const out = assembleConsolidationPrompt(input);
    expect(out).toContain('importance score MUST be at least 6');
  });

  it('Test 13 (CONS-07): when a contradiction is present, output contains "importance score MUST be at least 7"', () => {
    const input = buildFixtureInput({
      contradictions: [
        {
          entryAContent: 'I am done with this project, moving on.',
          entryBContent: 'Excited about the next steps on the project.',
          description: 'Stance shift within the day.',
        },
      ],
    });
    const out = assembleConsolidationPrompt(input);
    expect(out).toContain('importance score MUST be at least 7');
  });
});

describe('assembleConsolidationPrompt — CONS-08 decision data injection', () => {
  it('Test 14: when a decision is present, output contains decisionText, reasoning, prediction, falsificationCriterion, AND lifecycleState substrings', () => {
    const decision = {
      decisionText: 'Quit the job at Acme within 30 days.',
      lifecycleState: 'resolved',
      reasoning: 'Mismatch of values + declining health markers.',
      prediction: 'In 6 months I will feel less depleted and not regret the decision.',
      falsificationCriterion:
        'I regret it within 6 months OR cannot find work within 12 months.',
      resolution: 'Submitted notice on 2026-04-18.',
      resolutionNotes: 'Felt clear, not second-guessed at the moment of submission.',
    };
    const input = buildFixtureInput({ decisions: [decision] });
    const out = assembleConsolidationPrompt(input);
    expect(out).toContain(decision.decisionText);
    expect(out).toContain(decision.reasoning);
    expect(out).toContain(decision.prediction);
    expect(out).toContain(decision.falsificationCriterion);
    expect(out).toContain(decision.lifecycleState);
    // Resolution fields should appear when non-null
    expect(out).toContain(decision.resolution);
    expect(out).toContain(decision.resolutionNotes);
  });
});

describe('assembleConsolidationPrompt — CONS-11 sparse-entry guard', () => {
  it('Test 15 (positive, count threshold): when entries.length < 3, output contains the sparse-entry guard clause', () => {
    const out = assembleConsolidationPrompt(buildSparseByCountFixture());
    expect(out).toContain(
      'You may only state what is explicitly present in the source entries',
    );
  });

  it('Test 16 (positive, token threshold): when entries total < ~100 tokens, output contains the sparse-entry guard clause — even with entries.length >= 3', () => {
    const input = buildSparseByTokensFixture();
    // Sanity check the fixture: 3 entries, total chars well under 400
    expect(input.entries.length).toBeGreaterThanOrEqual(3);
    const totalChars = input.entries.reduce((s, e) => s + e.content.length, 0);
    expect(totalChars).toBeLessThan(400);

    const out = assembleConsolidationPrompt(input);
    expect(out).toContain(
      'You may only state what is explicitly present in the source entries',
    );
  });

  it('Test 17 (negative, dense day): when entries.length >= 3 AND total chars >= 400, output does NOT contain the sparse-entry guard clause', () => {
    const input = buildDenseFixture();
    // Sanity check the fixture: 5 entries, total chars >= 1000
    expect(input.entries.length).toBeGreaterThanOrEqual(3);
    const totalChars = input.entries.reduce((s, e) => s + e.content.length, 0);
    expect(totalChars).toBeGreaterThanOrEqual(400);

    const out = assembleConsolidationPrompt(input);
    expect(out).not.toContain(
      'You may only state what is explicitly present in the source entries',
    );
  });
});

describe('assembleConsolidationPrompt — anti-flattery role preamble (Pitfall #1)', () => {
  it('Test 18: output contains the anti-flattery anchor "Do not soften negative experiences, reframe frustration as growth"', () => {
    const out = assembleConsolidationPrompt(buildFixtureInput());
    expect(out).toContain('Do not soften negative experiences, reframe frustration as growth');
  });
});

describe('assembleConsolidationPrompt — input validation', () => {
  it('Test 19: throws when entries is empty (CONS-02 caller contract)', () => {
    const input = buildFixtureInput({ entries: [] });
    expect(() => assembleConsolidationPrompt(input)).toThrow(
      /entries array must be non-empty/,
    );
  });
});

describe('assembleConsolidationPrompt — entries block fidelity', () => {
  it('Test 20: every entry content appears verbatim in the output (no truncation, no paraphrase)', () => {
    const input = buildFixtureInput();
    const out = assembleConsolidationPrompt(input);
    for (const e of input.entries) {
      expect(out).toContain(e.content);
    }
  });
});
