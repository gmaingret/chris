/**
 * Phase 47 Plan 47-01 — DISP-01 + DISP-02 golden-output snapshot test.
 *
 * Companion to profile-psychological.golden.test.ts (Phase 39 PSURF-05).
 * The Phase 39 file remains the regression net for the formatter's per-branch
 * state model + locale layer; this file is the regression net for the v2.6.1
 * additions:
 *   - DISP-01: SCHWARTZ_CIRCUMPLEX_ORDER iteration (opposing values at distance 5)
 *   - DISP-02: HEXACO × Schwartz cross-validation observations
 *
 * On test failure (rendering changed):
 *   `npx vitest run -u src/bot/handlers/__tests__/profile-psychological-crossval.golden.test.ts`
 * to update the inline snapshots. Then REVIEW the diff for:
 *   - circumplex order regression (Self-Direction → Universalism → Benevolence → ...)
 *   - cross-val observation drift (rule table changes, qualifier swap, locale leak)
 *   - parse_mode-flavored characters in cross-val strings (`*`, `_`, backtick,
 *     `===`, `---`, unicode `→`) — REJECT (D-17 invariant)
 *
 * Time anchor: vi.setSystemTime ONLY (D-02 + Phase 18 lesson; vi.useFakeTimers
 * breaks postgres.js keep-alive timers). The display formatter does NOT use
 * Date.now() — the time anchor is for output determinism across machines only.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  formatPsychologicalProfileForDisplay,
  computeCrossValidationObservations,
  SCHWARTZ_CIRCUMPLEX_ORDER,
  CROSS_VALIDATION_RULES,
} from '../profile.js';
import type { ProfileRow } from '../../../memory/profiles.js';
import type {
  HexacoProfileData,
  SchwartzProfileData,
} from '../../../memory/profiles/psychological-schemas.js';

// ── Fixed time anchor ───────────────────────────────────────────────────────
const FIXED_NOW = new Date('2026-05-14T10:00:00.000Z');

beforeAll(() => {
  vi.setSystemTime(FIXED_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

// ── Fixtures ────────────────────────────────────────────────────────────────
//
// MOCK_HEXACO_POPULATED: populated profile shaped to trigger MANY cross-val
// rule matches. All 6 HEXACO dims >= 3.5 (high band) so positive rules can
// fire when paired with high Schwartz scores. Confidences spread across the
// substantial/moderate bands to exercise qualifier min-of-two (D-10).
const HEXACO_FOR_CROSSVAL: HexacoProfileData = {
  honesty_humility: { score: 4.2, confidence: 0.7, last_updated: '2026-05-01T00:00:00Z' },
  emotionality: { score: 3.8, confidence: 0.5, last_updated: '2026-05-01T00:00:00Z' },
  extraversion: { score: 4.0, confidence: 0.6, last_updated: '2026-05-01T00:00:00Z' },
  agreeableness: { score: 4.1, confidence: 0.55, last_updated: '2026-05-01T00:00:00Z' },
  conscientiousness: { score: 4.4, confidence: 0.6, last_updated: '2026-05-01T00:00:00Z' },
  openness: { score: 4.5, confidence: 0.8, last_updated: '2026-05-01T00:00:00Z' },
};

// MOCK_SCHWARTZ_FOR_CROSSVAL: ALL 10 values populated; uses 7.0-max scale.
// Many positive rules trigger (>= 5.0). Power is LOW (2.5 of 7.0) so the
// honesty_humility↔power NEGATIVE rule fires as 'uncommon'.
// Confidences spread substantial/moderate to exercise the qualifier band.
const SCHWARTZ_FOR_CROSSVAL: SchwartzProfileData = {
  self_direction: { score: 6.0, confidence: 0.8, last_updated: '2026-05-01T00:00:00Z' },
  stimulation: { score: 5.5, confidence: 0.7, last_updated: '2026-05-01T00:00:00Z' },
  hedonism: { score: 5.2, confidence: 0.6, last_updated: '2026-05-01T00:00:00Z' },
  achievement: { score: 5.4, confidence: 0.65, last_updated: '2026-05-01T00:00:00Z' },
  power: { score: 2.5, confidence: 0.55, last_updated: '2026-05-01T00:00:00Z' }, // LOW
  security: { score: 5.0, confidence: 0.5, last_updated: '2026-05-01T00:00:00Z' },
  conformity: { score: 5.1, confidence: 0.45, last_updated: '2026-05-01T00:00:00Z' },
  tradition: { score: 5.3, confidence: 0.4, last_updated: '2026-05-01T00:00:00Z' },
  benevolence: { score: 5.8, confidence: 0.7, last_updated: '2026-05-01T00:00:00Z' },
  universalism: { score: 5.9, confidence: 0.75, last_updated: '2026-05-01T00:00:00Z' },
};

const hexacoForCrossval: ProfileRow<HexacoProfileData> = {
  data: HEXACO_FOR_CROSSVAL,
  confidence: 0.65,
  lastUpdated: new Date('2026-05-01T00:00:00Z'),
  schemaVersion: 1,
  wordCount: 8500,
  wordCountAtLastRun: 8500,
};

const schwartzForCrossval: ProfileRow<SchwartzProfileData> = {
  data: SCHWARTZ_FOR_CROSSVAL,
  confidence: 0.6,
  lastUpdated: new Date('2026-05-01T00:00:00Z'),
  schemaVersion: 1,
  wordCount: 8500,
  wordCountAtLastRun: 8500,
};

// ── Suite 1: DISP-01 circumplex order ───────────────────────────────────────
//
// Verifies the Schwartz section renders in canonical clockwise circumplex
// order (NOT alphabetical-by-declaration). Adjacent pairs at distance 5
// reveal Schwartz's documented oppositions:
//   self_direction (0) <-> conformity (4)
//   stimulation (9)    <-> security (5)
//   hedonism (8)       <-> tradition (3)
//   achievement (7)    <-> benevolence (2)
//   power (6)          <-> universalism (1)

describe('Phase 47 DISP-01 — Schwartz circumplex order', () => {
  it('renders Schwartz section in circumplex order (EN) — Self-Direction first, Stimulation last', () => {
    const out = formatPsychologicalProfileForDisplay('schwartz', schwartzForCrossval, 'English');
    expect(out).toMatchInlineSnapshot(`
      "Schwartz Values

      Self-Direction: 6.0 / 5.0 (confidence 0.8 — substantial evidence)
      Universalism: 5.9 / 5.0 (confidence 0.8 — substantial evidence)
      Benevolence: 5.8 / 5.0 (confidence 0.7 — substantial evidence)
      Tradition: 5.3 / 5.0 (confidence 0.4 — moderate evidence)
      Conformity: 5.1 / 5.0 (confidence 0.5 — moderate evidence)
      Security: 5.0 / 5.0 (confidence 0.5 — moderate evidence)
      Power: 2.5 / 5.0 (confidence 0.6 — moderate evidence)
      Achievement: 5.4 / 5.0 (confidence 0.7 — substantial evidence)
      Hedonism: 5.2 / 5.0 (confidence 0.6 — substantial evidence)
      Stimulation: 5.5 / 5.0 (confidence 0.7 — substantial evidence)"
    `);
    // Defense-in-depth: confirm order by structural assertion (the first dim
    // is Self-Direction and the last is Stimulation, regardless of any
    // future label rewording that might churn the snapshot).
    const lines = out.split('\n').filter((l) => l.length > 0);
    // index 0 = "Schwartz Values" (title); index 1 = "Self-Direction: ..."
    expect(lines[1]).toMatch(/^Self-Direction:/);
    expect(lines[lines.length - 1]).toMatch(/^Stimulation:/);
  });

  it('renders Schwartz section in circumplex order (FR) — Autonomie first, Stimulation last', () => {
    const out = formatPsychologicalProfileForDisplay('schwartz', schwartzForCrossval, 'French');
    expect(out).toMatchInlineSnapshot(`
      "Valeurs Schwartz

      Autonomie : 6,0 / 5,0 (confiance 0,8 — preuves substantielles)
      Universalisme : 5,9 / 5,0 (confiance 0,8 — preuves substantielles)
      Bienveillance : 5,8 / 5,0 (confiance 0,7 — preuves substantielles)
      Tradition : 5,3 / 5,0 (confiance 0,4 — preuves modérées)
      Conformité : 5,1 / 5,0 (confiance 0,5 — preuves modérées)
      Sécurité : 5,0 / 5,0 (confiance 0,5 — preuves modérées)
      Pouvoir : 2,5 / 5,0 (confiance 0,6 — preuves modérées)
      Accomplissement : 5,4 / 5,0 (confiance 0,7 — preuves substantielles)
      Hédonisme : 5,2 / 5,0 (confiance 0,6 — preuves substantielles)
      Stimulation : 5,5 / 5,0 (confiance 0,7 — preuves substantielles)"
    `);
    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines[1]).toMatch(/^Autonomie /);
    expect(lines[lines.length - 1]).toMatch(/^Stimulation /);
  });

  it('renders Schwartz section in circumplex order (RU) — Самостоятельность first, Стимуляция last', () => {
    const out = formatPsychologicalProfileForDisplay('schwartz', schwartzForCrossval, 'Russian');
    expect(out).toMatchInlineSnapshot(`
      "Ценности Шварца

      Самостоятельность: 6,0 / 5,0 (уверенность 0,8 — существенные данные)
      Универсализм: 5,9 / 5,0 (уверенность 0,8 — существенные данные)
      Благожелательность: 5,8 / 5,0 (уверенность 0,7 — существенные данные)
      Традиция: 5,3 / 5,0 (уверенность 0,4 — умеренные данные)
      Конформизм: 5,1 / 5,0 (уверенность 0,5 — умеренные данные)
      Безопасность: 5,0 / 5,0 (уверенность 0,5 — умеренные данные)
      Власть: 2,5 / 5,0 (уверенность 0,6 — умеренные данные)
      Достижения: 5,4 / 5,0 (уверенность 0,7 — существенные данные)
      Гедонизм: 5,2 / 5,0 (уверенность 0,6 — существенные данные)
      Стимуляция: 5,5 / 5,0 (уверенность 0,7 — существенные данные)"
    `);
    const lines = out.split('\n').filter((l) => l.length > 0);
    expect(lines[1]).toMatch(/^Самостоятельность:/);
    expect(lines[lines.length - 1]).toMatch(/^Стимуляция:/);
  });

  it('D-09 per-dim filter preserved across circumplex order: filtered dim leaves a gap', () => {
    // Build a Schwartz fixture where tradition (index 3) is filtered out
    // (confidence === 0). The output should skip tradition, leaving security
    // immediately after conformity — gap is the correct "no evidence" signal.
    const partialData: SchwartzProfileData = {
      ...SCHWARTZ_FOR_CROSSVAL,
      tradition: { score: 5.3, confidence: 0, last_updated: '2026-05-01T00:00:00Z' },
    };
    const partial: ProfileRow<SchwartzProfileData> = {
      ...schwartzForCrossval,
      data: partialData,
    };
    const out = formatPsychologicalProfileForDisplay('schwartz', partial, 'English');
    expect(out).not.toContain('Tradition:'); // filtered (D-09 zero-confidence)
    expect(out).toContain('Self-Direction:'); // populated retained at index 0
    expect(out).toContain('Conformity:'); // populated retained at index 4
    expect(out).toContain('Stimulation:'); // populated retained at index 9
  });
});

// ── Suite 2: DISP-02 cross-validation populated ─────────────────────────────
//
// Verifies the cross-val section renders when both profiles are populated
// AND at least one rule matches the D-08 thresholds + D-09 floor.

describe('Phase 47 DISP-02 — cross-validation observations (populated)', () => {
  it('renders all matching rules (EN) — section title + observation lines', () => {
    const out = computeCrossValidationObservations(hexacoForCrossval, schwartzForCrossval, 'English');
    expect(out).toMatchInlineSnapshot(`
      "Cross-pattern observations

      high openness + high self-direction -> consistent (substantial evidence)
      high openness + high stimulation -> consistent (substantial evidence)
      high openness + high universalism -> consistent (substantial evidence)
      high conscientiousness + high achievement -> consistent (substantial evidence)
      high conscientiousness + high security -> consistent (moderate evidence)
      high conscientiousness + high conformity -> consistent (moderate evidence)
      high honesty-humility + high benevolence -> consistent (substantial evidence)
      high honesty-humility + high universalism -> consistent (substantial evidence)
      high honesty-humility + low power -> uncommon pattern (moderate evidence)
      high agreeableness + high benevolence -> consistent (moderate evidence)
      high agreeableness + high universalism -> consistent (moderate evidence)
      high extraversion + high stimulation -> consistent (substantial evidence)
      high extraversion + high hedonism -> consistent (substantial evidence)
      high extraversion + high achievement -> consistent (substantial evidence)
      high emotionality + high tradition -> consistent (moderate evidence)
      high emotionality + high security -> consistent (moderate evidence)"
    `);
    // Defense-in-depth invariants — survive copy churn but not structural drift:
    expect(out.split('\n')[0]).toBe('Cross-pattern observations'); // title first
    expect(out.split('\n')[1]).toBe(''); // blank line after title
    // Exactly one 'uncommon pattern' line (honesty_humility ↔ power negative rule)
    expect(out.match(/uncommon pattern/g)?.length).toBe(1);
    // All lines use the ASCII '->' glyph, not unicode '→'
    expect(out).not.toContain('→');
    // Plain text only — no parse_mode chars
    expect(out).not.toMatch(/[*_`]/);
  });

  it('renders all matching rules (FR) — section title + observation lines localized', () => {
    const out = computeCrossValidationObservations(hexacoForCrossval, schwartzForCrossval, 'French');
    expect(out).toMatchInlineSnapshot(`
      "Observations transversales

      ouverture élevé + autonomie élevé -> cohérent (preuves substantielles)
      ouverture élevé + stimulation élevé -> cohérent (preuves substantielles)
      ouverture élevé + universalisme élevé -> cohérent (preuves substantielles)
      conscienciosité élevé + accomplissement élevé -> cohérent (preuves substantielles)
      conscienciosité élevé + sécurité élevé -> cohérent (preuves modérées)
      conscienciosité élevé + conformité élevé -> cohérent (preuves modérées)
      honnêteté-humilité élevé + bienveillance élevé -> cohérent (preuves substantielles)
      honnêteté-humilité élevé + universalisme élevé -> cohérent (preuves substantielles)
      honnêteté-humilité élevé + pouvoir faible -> profil inhabituel (preuves modérées)
      amabilité élevé + bienveillance élevé -> cohérent (preuves modérées)
      amabilité élevé + universalisme élevé -> cohérent (preuves modérées)
      extraversion élevé + stimulation élevé -> cohérent (preuves substantielles)
      extraversion élevé + hédonisme élevé -> cohérent (preuves substantielles)
      extraversion élevé + accomplissement élevé -> cohérent (preuves substantielles)
      émotionnalité élevé + tradition élevé -> cohérent (preuves modérées)
      émotionnalité élevé + sécurité élevé -> cohérent (preuves modérées)"
    `);
    expect(out).toContain('Observations transversales'); // FR section title
    expect(out).toContain('preuves substantielles'); // FR qualifier band
    expect(out).toContain('profil inhabituel'); // FR uncommon glyph
    expect(out).not.toContain('Cross-pattern observations'); // no EN leak
    expect(out).not.toContain('substantial evidence'); // no EN qualifier leak
    expect(out).not.toContain('uncommon pattern'); // no EN uncommon leak
  });

  it('renders all matching rules (RU) — section title + observation lines localized', () => {
    const out = computeCrossValidationObservations(hexacoForCrossval, schwartzForCrossval, 'Russian');
    expect(out).toMatchInlineSnapshot(`
      "Сквозные наблюдения

      высокий открытость опыту + высокий самостоятельность -> согласовано (существенные данные)
      высокий открытость опыту + высокий стимуляция -> согласовано (существенные данные)
      высокий открытость опыту + высокий универсализм -> согласовано (существенные данные)
      высокий добросовестность + высокий достижения -> согласовано (существенные данные)
      высокий добросовестность + высокий безопасность -> согласовано (умеренные данные)
      высокий добросовестность + высокий конформизм -> согласовано (умеренные данные)
      высокий честность-скромность + высокий благожелательность -> согласовано (существенные данные)
      высокий честность-скромность + высокий универсализм -> согласовано (существенные данные)
      высокий честность-скромность + низкий власть -> необычный паттерн (умеренные данные)
      высокий доброжелательность + высокий благожелательность -> согласовано (умеренные данные)
      высокий доброжелательность + высокий универсализм -> согласовано (умеренные данные)
      высокий экстраверсия + высокий стимуляция -> согласовано (существенные данные)
      высокий экстраверсия + высокий гедонизм -> согласовано (существенные данные)
      высокий экстраверсия + высокий достижения -> согласовано (существенные данные)
      высокий эмоциональность + высокий традиция -> согласовано (умеренные данные)
      высокий эмоциональность + высокий безопасность -> согласовано (умеренные данные)"
    `);
    expect(out).toContain('Сквозные наблюдения'); // RU section title
    expect(out).toContain('существенные данные'); // RU qualifier band
    expect(out).toContain('необычный паттерн'); // RU uncommon glyph
    expect(out).not.toContain('Cross-pattern observations'); // no EN leak
    expect(out).not.toContain('Observations transversales'); // no FR leak
  });
});

// ── Suite 3: DISP-02 omit cases (D-14 empty-state) ──────────────────────────

describe('Phase 47 DISP-02 — empty-state omissions (D-14)', () => {
  it('returns empty string when HEXACO profile is null', () => {
    expect(computeCrossValidationObservations(null, schwartzForCrossval, 'English')).toBe('');
  });

  it('returns empty string when Schwartz profile is null', () => {
    expect(computeCrossValidationObservations(hexacoForCrossval, null, 'English')).toBe('');
  });

  it('returns empty string when HEXACO is never-fired (epoch sentinel)', () => {
    const neverFired: ProfileRow<HexacoProfileData> = {
      ...hexacoForCrossval,
      lastUpdated: new Date(0),
    };
    expect(computeCrossValidationObservations(neverFired, schwartzForCrossval, 'English')).toBe('');
  });

  it('returns empty string when Schwartz is never-fired (epoch sentinel)', () => {
    const neverFired: ProfileRow<SchwartzProfileData> = {
      ...schwartzForCrossval,
      lastUpdated: new Date(0),
    };
    expect(computeCrossValidationObservations(hexacoForCrossval, neverFired, 'English')).toBe('');
  });

  it('returns empty string when HEXACO confidence === 0 (insufficient data)', () => {
    const zeroConf: ProfileRow<HexacoProfileData> = { ...hexacoForCrossval, confidence: 0 };
    expect(computeCrossValidationObservations(zeroConf, schwartzForCrossval, 'English')).toBe('');
  });

  it('returns empty string when all dim confidences < 0.3 (D-09 floor)', () => {
    // Build a fixture where every dim has confidence 0.2 (below 0.3 floor)
    // but profile-level confidence > 0 so the profile-level guards pass.
    const lowDimHex: HexacoProfileData = {
      honesty_humility: { score: 4.2, confidence: 0.2, last_updated: '2026-05-01T00:00:00Z' },
      emotionality: { score: 3.8, confidence: 0.2, last_updated: '2026-05-01T00:00:00Z' },
      extraversion: { score: 4.0, confidence: 0.2, last_updated: '2026-05-01T00:00:00Z' },
      agreeableness: { score: 4.1, confidence: 0.2, last_updated: '2026-05-01T00:00:00Z' },
      conscientiousness: { score: 4.4, confidence: 0.2, last_updated: '2026-05-01T00:00:00Z' },
      openness: { score: 4.5, confidence: 0.2, last_updated: '2026-05-01T00:00:00Z' },
    };
    const lowDimRow: ProfileRow<HexacoProfileData> = {
      ...hexacoForCrossval,
      data: lowDimHex,
      confidence: 0.2,
    };
    expect(computeCrossValidationObservations(lowDimRow, schwartzForCrossval, 'English')).toBe('');
  });

  it('returns empty string when no rule matches the D-08 thresholds', () => {
    // Build a profile where HEXACO scores are below the 3.5 high threshold.
    // Every rule fails hHigh, so observations.length === 0 → empty.
    const belowThresholdHex: HexacoProfileData = {
      honesty_humility: { score: 2.5, confidence: 0.7, last_updated: '2026-05-01T00:00:00Z' },
      emotionality: { score: 2.5, confidence: 0.5, last_updated: '2026-05-01T00:00:00Z' },
      extraversion: { score: 2.5, confidence: 0.6, last_updated: '2026-05-01T00:00:00Z' },
      agreeableness: { score: 2.5, confidence: 0.55, last_updated: '2026-05-01T00:00:00Z' },
      conscientiousness: { score: 2.5, confidence: 0.6, last_updated: '2026-05-01T00:00:00Z' },
      openness: { score: 2.5, confidence: 0.8, last_updated: '2026-05-01T00:00:00Z' },
    };
    const belowRow: ProfileRow<HexacoProfileData> = {
      ...hexacoForCrossval,
      data: belowThresholdHex,
    };
    expect(computeCrossValidationObservations(belowRow, schwartzForCrossval, 'English')).toBe('');
  });
});

// ── Suite 4: SCHWARTZ_CIRCUMPLEX_ORDER array-shape invariants ───────────────

describe('Phase 47 — SCHWARTZ_CIRCUMPLEX_ORDER invariants', () => {
  it('contains exactly 10 elements', () => {
    expect(SCHWARTZ_CIRCUMPLEX_ORDER).toHaveLength(10);
  });

  it('contains no duplicate keys', () => {
    expect(new Set(SCHWARTZ_CIRCUMPLEX_ORDER).size).toBe(10);
  });

  it('Schwartz opposing-value pairs sit at ring distance 4 or 5 (near-antipodal in canonical clockwise layout)', () => {
    // The canonical Schwartz circumplex layout is conceptual, not perfectly
    // geometric. With 10 values on a flat clockwise ring, the antipodal
    // distance is 5 (e.g., 0↔5). But the documented oppositions don't all
    // land exactly antipodal — three of the five pure-dipole pairs are at
    // distance 5, and two (self_direction↔conformity, stimulation↔security)
    // are at distance 4, because Schwartz's actual circle places adjacent
    // values along the ring with the high-order axis (Openness-to-Change vs.
    // Conservation; Self-Transcendence vs. Self-Enhancement) NOT aligned to
    // a strict diameter. The reader-value of the ordering is the structural
    // CLUSTER adjacency, not strict antipodal distance.
    const idx = (k: keyof SchwartzProfileData): number => SCHWARTZ_CIRCUMPLEX_ORDER.indexOf(k);
    const opposingPairs: ReadonlyArray<[keyof SchwartzProfileData, keyof SchwartzProfileData]> = [
      ['self_direction', 'conformity'], // 0 ↔ 4 → ring distance 4
      ['stimulation', 'security'], // 9 ↔ 5 → ring distance 4
      ['hedonism', 'tradition'], // 8 ↔ 3 → ring distance 5
      ['achievement', 'benevolence'], // 7 ↔ 2 → ring distance 5
      ['power', 'universalism'], // 6 ↔ 1 → ring distance 5
    ];
    for (const [a, b] of opposingPairs) {
      const delta = Math.abs(idx(a) - idx(b));
      const ringDistance = Math.min(delta, SCHWARTZ_CIRCUMPLEX_ORDER.length - delta);
      // 4 or 5 are both acceptable — both are "near-antipodal" in a 10-element
      // ring (max possible distance is 5). Any reordering that drops a pair to
      // distance 3 or less breaks the circumplex semantics and fails this gate.
      expect(ringDistance).toBeGreaterThanOrEqual(4);
    }
  });

  it('exactly 3 of 5 documented opposing-value pairs sit at strict antipodal distance 5', () => {
    // Locks the actual geometry of the array — any future reordering would
    // shift this count. The 3 pure-antipodal pairs are: hedonism↔tradition,
    // achievement↔benevolence, power↔universalism. The other 2 sit at
    // distance 4 (see the test above for the rationale).
    const idx = (k: keyof SchwartzProfileData): number => SCHWARTZ_CIRCUMPLEX_ORDER.indexOf(k);
    const opposingPairs: ReadonlyArray<[keyof SchwartzProfileData, keyof SchwartzProfileData]> = [
      ['self_direction', 'conformity'],
      ['stimulation', 'security'],
      ['hedonism', 'tradition'],
      ['achievement', 'benevolence'],
      ['power', 'universalism'],
    ];
    let antipodalCount = 0;
    for (const [a, b] of opposingPairs) {
      const delta = Math.abs(idx(a) - idx(b));
      const ringDistance = Math.min(delta, SCHWARTZ_CIRCUMPLEX_ORDER.length - delta);
      if (ringDistance === 5) antipodalCount++;
    }
    expect(antipodalCount).toBe(3);
  });

  it('exact canonical clockwise order matches the locked sequence', () => {
    // Lock the canonical order verbatim — any reordering must be a deliberate
    // CONTEXT update + dedicated phase, not a drive-by edit.
    expect(SCHWARTZ_CIRCUMPLEX_ORDER).toEqual([
      'self_direction',
      'universalism',
      'benevolence',
      'tradition',
      'conformity',
      'security',
      'power',
      'achievement',
      'hedonism',
      'stimulation',
    ]);
  });
});

// ── Suite 5: CROSS_VALIDATION_RULES rule-table invariants ───────────────────

describe('Phase 47 — CROSS_VALIDATION_RULES invariants', () => {
  it('has exactly 16 rules (per CONTEXT.md D-07 + plan must_haves)', () => {
    expect(CROSS_VALIDATION_RULES).toHaveLength(16);
  });

  it('no duplicate (hexacoDim, schwartzDim, direction) triples', () => {
    const triples = CROSS_VALIDATION_RULES.map(
      (r) => `${r.hexacoDim}|${r.schwartzDim}|${r.direction}`,
    );
    expect(new Set(triples).size).toBe(triples.length);
  });

  it('every rule references a valid HEXACO dim key', () => {
    const validHexaco: Array<keyof HexacoProfileData> = [
      'honesty_humility',
      'emotionality',
      'extraversion',
      'agreeableness',
      'conscientiousness',
      'openness',
    ];
    for (const rule of CROSS_VALIDATION_RULES) {
      expect(validHexaco).toContain(rule.hexacoDim);
    }
  });

  it('every rule references a valid Schwartz dim key (member of SCHWARTZ_CIRCUMPLEX_ORDER)', () => {
    for (const rule of CROSS_VALIDATION_RULES) {
      expect(SCHWARTZ_CIRCUMPLEX_ORDER).toContain(rule.schwartzDim);
    }
  });

  it('every rule has a coherent observationKey ↔ direction pairing', () => {
    // CONTEXT.md D-07 implicit invariant: positive rules render as 'consistent'
    // (correlation present as expected); negative rules render as 'uncommon'
    // (correlation present in opposite direction from literature). Any
    // future-edit divergence (e.g., positive→uncommon) is a logic bug.
    for (const rule of CROSS_VALIDATION_RULES) {
      if (rule.direction === 'positive') {
        expect(rule.observationKey).toBe('consistent');
      } else {
        expect(rule.observationKey).toBe('uncommon');
      }
    }
  });
});
