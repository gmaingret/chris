import { describe, it, expect } from 'vitest';
import {
  qualifierFor,
  normalizeForInterrogativeCheck,
  LANG_QUALIFIER_BANDS,
} from '../strings.js';

// Phase 46 Plan 46-01 — unit tests for the shared locale-strings module.
// Two surfaces under test:
//   - qualifierFor(c, lang) → L10N-05 consolidation of byte-identical duplicates
//   - normalizeForInterrogativeCheck(s) → L10N-03 FR regex input boundary

describe('qualifierFor — locale-aware confidence band labels (L10N-05)', () => {
  // English bands — must reproduce the prior byte-identical strings (Phase 35
  // D-07 + Phase 39 CONTEXT.md D-07 — re-banding requires a CONTEXT update).
  it('English: c=0.6 (boundary) → substantial evidence', () => {
    expect(qualifierFor(0.6, 'English')).toBe('substantial evidence');
  });
  it('English: c=0.45 (mid) → moderate evidence', () => {
    expect(qualifierFor(0.45, 'English')).toBe('moderate evidence');
  });
  it('English: c=0.3 (lower boundary) → moderate evidence', () => {
    expect(qualifierFor(0.3, 'English')).toBe('moderate evidence');
  });
  it('English: c=0.29 (just below moderate) → limited evidence', () => {
    expect(qualifierFor(0.29, 'English')).toBe('limited evidence');
  });
  it('English: c=0.1 (low) → limited evidence', () => {
    expect(qualifierFor(0.1, 'English')).toBe('limited evidence');
  });

  // French bands — seed translations; Greg reviews at /gsd-verify-work.
  it('French: c=0.6 → preuves substantielles', () => {
    expect(qualifierFor(0.6, 'French')).toBe('preuves substantielles');
  });
  it('French: c=0.45 → preuves modérées', () => {
    expect(qualifierFor(0.45, 'French')).toBe('preuves modérées');
  });
  it('French: c=0.1 → preuves limitées', () => {
    expect(qualifierFor(0.1, 'French')).toBe('preuves limitées');
  });

  // Russian bands — seed translations; Greg reviews at /gsd-verify-work.
  it('Russian: c=0.6 → существенные данные', () => {
    expect(qualifierFor(0.6, 'Russian')).toBe('существенные данные');
  });
  it('Russian: c=0.45 → умеренные данные', () => {
    expect(qualifierFor(0.45, 'Russian')).toBe('умеренные данные');
  });
  it('Russian: c=0.1 → ограниченные данные', () => {
    expect(qualifierFor(0.1, 'Russian')).toBe('ограниченные данные');
  });

  it('LANG_QUALIFIER_BANDS contains all three locales with three bands each', () => {
    for (const lang of ['English', 'French', 'Russian'] as const) {
      expect(LANG_QUALIFIER_BANDS[lang]).toHaveProperty('substantial');
      expect(LANG_QUALIFIER_BANDS[lang]).toHaveProperty('moderate');
      expect(LANG_QUALIFIER_BANDS[lang]).toHaveProperty('limited');
    }
  });
});

describe('normalizeForInterrogativeCheck — NFC + apostrophe canonicalization (L10N-03)', () => {
  it('U+2019 right single quotation mark (macOS curly apostrophe) → straight U+0027', () => {
    expect(normalizeForInterrogativeCheck('qu’est-ce que')).toBe(
      "qu'est-ce que",
    );
  });

  it('U+2018 left single quotation mark → straight U+0027', () => {
    expect(normalizeForInterrogativeCheck('qu‘est-ce que')).toBe(
      "qu'est-ce que",
    );
  });

  it('U+02BC modifier letter apostrophe → straight U+0027', () => {
    expect(normalizeForInterrogativeCheck('quʼest-ce que')).toBe(
      "qu'est-ce que",
    );
  });

  it('U+2032 prime → straight U+0027', () => {
    expect(normalizeForInterrogativeCheck("qu′est-ce que")).toBe(
      "qu'est-ce que",
    );
  });

  it('idempotent on already-straight apostrophe', () => {
    expect(normalizeForInterrogativeCheck("qu'est-ce que")).toBe(
      "qu'est-ce que",
    );
  });

  it("gibberish 'queest-ce que' is returned unchanged (helper is NOT a syntax validator)", () => {
    // The regex consumer (Plan 46-03 stage1Check + tightened INTERROGATIVE_REGEX)
    // is responsible for rejecting gibberish — the normalizer only canonicalizes
    // apostrophes + NFC composition.
    expect(normalizeForInterrogativeCheck('queest-ce que')).toBe(
      'queest-ce que',
    );
  });

  it('NFC normalization composes decomposed combining acute', () => {
    // 'e' (U+0065) + combining acute (U+0301) → 'é' (U+00E9)
    const decomposed = 'é';
    const composed = 'é';
    expect(normalizeForInterrogativeCheck(decomposed)).toBe(composed);
  });

  it('preserves non-apostrophe characters intact', () => {
    expect(normalizeForInterrogativeCheck('pourquoi pas ?')).toBe('pourquoi pas ?');
    expect(normalizeForInterrogativeCheck('что это такое?')).toBe('что это такое?');
  });
});
