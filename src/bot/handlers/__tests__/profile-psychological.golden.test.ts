/**
 * Phase 39 Plan 39-02 — formatPsychologicalProfileForDisplay golden-output snapshot test (PSURF-05).
 *
 * HARD CO-LOC #M11-3: formatter + golden snapshot ship in the same plan as the
 * `/profile` handler 3-reply loop wiring (Task 3). The snapshot is the
 * regression net for the display-framing class — any change to the rendered
 * output requires deliberate `-u` flag + reviewer approval of the inline-
 * snapshot diff.
 *
 * On test failure (rendering changed):
 *   `npx vitest run -u src/bot/handlers/__tests__/profile-psychological.golden.test.ts`
 * to update the inline snapshots. Then REVIEW the diff for:
 *   - third-person leaks ("Greg's...", "His...") — REJECT
 *   - internal field-name leaks ("honesty_humility:", "self_direction:") — REJECT
 *   - parse_mode-flavored characters ("*", "_", backticks, "===", "---") — REJECT
 *   - D-09 regression: "Self-Direction: null" or similar — REJECT
 *
 * Coverage per D-24 (4 scenarios) × D-25 (EN baseline + FR + RU language hook
 * variants):
 *   - Scenario 1: all-populated (HEXACO 6 dims + Schwartz 10 values + Attachment deferred)
 *   - Scenario 2: all-insufficient (all 3 below threshold + null/never-fired branches)
 *   - Scenario 3: mixed (Schwartz partial — D-09 per-dim filter regression detector)
 *   - Scenario 4: FR + RU language hook slots (locks structural shape for v2.6.1 polish)
 *
 * Time anchor: vi.setSystemTime ONLY (D-02 + Phase 18 lesson; vi.useFakeTimers
 * breaks postgres.js keep-alive timers). The display formatter does NOT use
 * Date.now() — its time-dependence is only the lastUpdated.getTime() === 0
 * epoch sentinel comparison (deterministic regardless of system clock). The
 * time anchor is still useful for test-output determinism across machines.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { formatPsychologicalProfileForDisplay, type Lang } from '../profile.js';
import type { ProfileRow } from '../../../memory/profiles.js';
import type {
  HexacoProfileData,
  SchwartzProfileData,
  AttachmentProfileData,
} from '../../../memory/profiles/psychological-schemas.js';

// Ensure Lang is treated as a load-bearing import even if the file later
// adds explicit type annotations on fixture arrays.
type _UnusedLang = Lang;

// ── Fixed time anchor ───────────────────────────────────────────────────────
const FRESH_DATE = new Date('2026-06-15T00:00:00Z');

beforeAll(() => {
  vi.setSystemTime(FRESH_DATE);
});

afterAll(() => {
  vi.useRealTimers();
});

// ── HEXACO fixture data ─────────────────────────────────────────────────────

const HEXACO_FULL_DATA: HexacoProfileData = {
  honesty_humility: { score: 4.2, confidence: 0.6, last_updated: '2026-06-01T00:00:00Z' },
  emotionality: { score: 3.1, confidence: 0.4, last_updated: '2026-06-01T00:00:00Z' },
  extraversion: { score: 3.8, confidence: 0.5, last_updated: '2026-06-01T00:00:00Z' },
  agreeableness: { score: 4.0, confidence: 0.5, last_updated: '2026-06-01T00:00:00Z' },
  conscientiousness: { score: 4.5, confidence: 0.7, last_updated: '2026-06-01T00:00:00Z' },
  openness: { score: 4.3, confidence: 0.6, last_updated: '2026-06-01T00:00:00Z' },
};

const HEXACO_EMPTY_DATA: HexacoProfileData = {
  honesty_humility: null,
  emotionality: null,
  extraversion: null,
  agreeableness: null,
  conscientiousness: null,
  openness: null,
};

// ── Schwartz fixture data ───────────────────────────────────────────────────

const SCHWARTZ_FULL_DATA: SchwartzProfileData = {
  self_direction: { score: 4.5, confidence: 0.7, last_updated: '2026-06-01T00:00:00Z' },
  stimulation: { score: 2.8, confidence: 0.3, last_updated: '2026-06-01T00:00:00Z' },
  hedonism: { score: 3.2, confidence: 0.4, last_updated: '2026-06-01T00:00:00Z' },
  achievement: { score: 4.0, confidence: 0.5, last_updated: '2026-06-01T00:00:00Z' },
  power: { score: 2.5, confidence: 0.35, last_updated: '2026-06-01T00:00:00Z' },
  security: { score: 3.5, confidence: 0.45, last_updated: '2026-06-01T00:00:00Z' },
  conformity: { score: 2.2, confidence: 0.4, last_updated: '2026-06-01T00:00:00Z' },
  tradition: { score: 2.8, confidence: 0.4, last_updated: '2026-06-01T00:00:00Z' },
  benevolence: { score: 4.4, confidence: 0.65, last_updated: '2026-06-01T00:00:00Z' },
  universalism: { score: 4.3, confidence: 0.6, last_updated: '2026-06-01T00:00:00Z' },
};

const SCHWARTZ_EMPTY_DATA: SchwartzProfileData = {
  self_direction: null,
  stimulation: null,
  hedonism: null,
  achievement: null,
  power: null,
  security: null,
  conformity: null,
  tradition: null,
  benevolence: null,
  universalism: null,
};

// D-09 per-dim filter regression detector — partial population deliberately
// exercises BOTH filter branches:
//   - stimulation: null → "skip null" branch
//   - hedonism: { confidence: 0 } → "skip zero-confidence" branch
// If a future refactor disables the filter, the inline snapshot AND the
// explicit not.toContain assertions both fire.
const SCHWARTZ_MIXED_DATA: SchwartzProfileData = {
  self_direction: { score: 4.5, confidence: 0.7, last_updated: '2026-06-01T00:00:00Z' },
  stimulation: null,
  hedonism: { score: 3.0, confidence: 0, last_updated: '2026-06-01T00:00:00Z' },
  achievement: { score: 4.0, confidence: 0.5, last_updated: '2026-06-01T00:00:00Z' },
  power: null,
  security: { score: 3.5, confidence: 0.45, last_updated: '2026-06-01T00:00:00Z' },
  conformity: null,
  tradition: null,
  benevolence: { score: 4.4, confidence: 0.65, last_updated: '2026-06-01T00:00:00Z' },
  universalism: { score: 4.3, confidence: 0.6, last_updated: '2026-06-01T00:00:00Z' },
};

// ── ProfileRow fixtures by state (D-19 four-branch model) ──────────────────

const hexacoPopulated: ProfileRow<HexacoProfileData> = {
  data: HEXACO_FULL_DATA,
  confidence: 0.6,
  lastUpdated: new Date('2026-06-01T00:00:00Z'),
  schemaVersion: 1,
  wordCount: 8500,
  wordCountAtLastRun: 8500,
};

const hexacoInsufficient: ProfileRow<HexacoProfileData> = {
  data: HEXACO_EMPTY_DATA,
  confidence: 0,
  lastUpdated: new Date('2026-06-01T00:00:00Z'),
  schemaVersion: 1,
  wordCount: 500,
  wordCountAtLastRun: 500, // N = 5000 - 500 = 4500
};

const hexacoNeverFired: ProfileRow<HexacoProfileData> = {
  data: HEXACO_EMPTY_DATA,
  confidence: 0,
  lastUpdated: new Date(0), // epoch sentinel — Phase 37 reader coalesce
  schemaVersion: 1,
  wordCount: 0,
  wordCountAtLastRun: 0,
};

const schwartzPopulated: ProfileRow<SchwartzProfileData> = {
  data: SCHWARTZ_FULL_DATA,
  confidence: 0.55,
  lastUpdated: new Date('2026-06-01T00:00:00Z'),
  schemaVersion: 1,
  wordCount: 8500,
  wordCountAtLastRun: 8500,
};

const schwartzInsufficient: ProfileRow<SchwartzProfileData> = {
  data: SCHWARTZ_EMPTY_DATA,
  confidence: 0,
  lastUpdated: new Date('2026-06-01T00:00:00Z'),
  schemaVersion: 1,
  wordCount: 1200,
  wordCountAtLastRun: 1200, // N = 5000 - 1200 = 3800
};

const schwartzMixed: ProfileRow<SchwartzProfileData> = {
  data: SCHWARTZ_MIXED_DATA,
  confidence: 0.45,
  lastUpdated: new Date('2026-06-01T00:00:00Z'),
  schemaVersion: 1,
  wordCount: 6500,
  wordCountAtLastRun: 6500,
};

// ── Scenario 1: all-populated (EN) ──────────────────────────────────────────

describe('formatPsychologicalProfileForDisplay — Scenario 1: all-populated (EN)', () => {
  it('hexaco renders 6 dim score lines with D-07 confidence qualifier', () => {
    expect(
      formatPsychologicalProfileForDisplay('hexaco', hexacoPopulated, 'English'),
    ).toMatchInlineSnapshot(`
      "HEXACO Personality

      Honesty-Humility: 4.2 / 5.0 (confidence 0.6 — substantial evidence)
      Emotionality: 3.1 / 5.0 (confidence 0.4 — moderate evidence)
      Extraversion: 3.8 / 5.0 (confidence 0.5 — moderate evidence)
      Agreeableness: 4.0 / 5.0 (confidence 0.5 — moderate evidence)
      Conscientiousness: 4.5 / 5.0 (confidence 0.7 — substantial evidence)
      Openness: 4.3 / 5.0 (confidence 0.6 — substantial evidence)"
    `);
  });

  it('schwartz renders 10 value score lines (alphabetical per Deferred CIRC-01)', () => {
    expect(
      formatPsychologicalProfileForDisplay('schwartz', schwartzPopulated, 'English'),
    ).toMatchInlineSnapshot(`
      "Schwartz Values

      Self-Direction: 4.5 / 5.0 (confidence 0.7 — substantial evidence)
      Stimulation: 2.8 / 5.0 (confidence 0.3 — moderate evidence)
      Hedonism: 3.2 / 5.0 (confidence 0.4 — moderate evidence)
      Achievement: 4.0 / 5.0 (confidence 0.5 — moderate evidence)
      Power: 2.5 / 5.0 (confidence 0.3 — moderate evidence)
      Security: 3.5 / 5.0 (confidence 0.5 — moderate evidence)
      Conformity: 2.2 / 5.0 (confidence 0.4 — moderate evidence)
      Tradition: 2.8 / 5.0 (confidence 0.4 — moderate evidence)
      Benevolence: 4.4 / 5.0 (confidence 0.7 — substantial evidence)
      Universalism: 4.3 / 5.0 (confidence 0.6 — substantial evidence)"
    `);
  });

  it('attachment ALWAYS renders "not yet active" regardless of fixture (D-19 branch 1)', () => {
    // Even with a null fixture, M011 surface treats attachment as deferred.
    expect(
      formatPsychologicalProfileForDisplay('attachment', null, 'English'),
    ).toMatchInlineSnapshot(`"Attachment: not yet active (gated on D028 activation trigger — 2,000 words relational speech over 60 days)."`);
  });
});

// ── Scenario 2: all-insufficient / never-fired / null (EN) ─────────────────

describe('formatPsychologicalProfileForDisplay — Scenario 2: all-insufficient (EN)', () => {
  it('hexaco insufficient renders "need 4500 more words"', () => {
    expect(
      formatPsychologicalProfileForDisplay('hexaco', hexacoInsufficient, 'English'),
    ).toMatchInlineSnapshot(`"HEXACO: insufficient data — need 4500 more words."`);
  });

  it('schwartz insufficient renders "need 3800 more words"', () => {
    expect(
      formatPsychologicalProfileForDisplay('schwartz', schwartzInsufficient, 'English'),
    ).toMatchInlineSnapshot(`"Schwartz: insufficient data — need 3800 more words."`);
  });

  it('hexaco never-fired (epoch lastUpdated) renders "not yet inferred"', () => {
    expect(
      formatPsychologicalProfileForDisplay('hexaco', hexacoNeverFired, 'English'),
    ).toMatchInlineSnapshot(`"HEXACO: not yet inferred (first profile inference runs 1st of month, 09:00 Paris)."`);
  });

  it('hexaco null profile renders "not yet inferred"', () => {
    expect(
      formatPsychologicalProfileForDisplay('hexaco', null, 'English'),
    ).toMatchInlineSnapshot(`"HEXACO: not yet inferred (first profile inference runs 1st of month, 09:00 Paris)."`);
  });

  it('schwartz null profile renders "not yet inferred"', () => {
    expect(
      formatPsychologicalProfileForDisplay('schwartz', null, 'English'),
    ).toMatchInlineSnapshot(`"Schwartz: not yet inferred (first profile inference runs 1st of month, 09:00 Paris)."`);
  });
});

// ── Scenario 3: mixed (D-09 per-dim filter regression detector) ────────────

describe('formatPsychologicalProfileForDisplay — Scenario 3: mixed (D-09 per-dim filter)', () => {
  it('schwartz mixed: skips stimulation (null) AND hedonism (confidence=0); renders 7 populated dims', () => {
    const out = formatPsychologicalProfileForDisplay('schwartz', schwartzMixed, 'English');
    // Inline snapshot is the primary regression detector.
    expect(out).toMatchInlineSnapshot(`
      "Schwartz Values

      Self-Direction: 4.5 / 5.0 (confidence 0.7 — substantial evidence)
      Achievement: 4.0 / 5.0 (confidence 0.5 — moderate evidence)
      Security: 3.5 / 5.0 (confidence 0.5 — moderate evidence)
      Benevolence: 4.4 / 5.0 (confidence 0.7 — substantial evidence)
      Universalism: 4.3 / 5.0 (confidence 0.6 — substantial evidence)"
    `);
    // Explicit defense-in-depth non-snapshot assertions for D-09 filter:
    expect(out).not.toContain('Stimulation:'); // null filtered
    expect(out).not.toContain('Hedonism:'); // zero-confidence filtered
    expect(out).toContain('Self-Direction:'); // populated retained
    expect(out).toContain('Benevolence:'); // populated retained
  });
});

// ── Scenario 4: FR / RU language hook slots ─────────────────────────────────

describe('formatPsychologicalProfileForDisplay — Scenario 4: FR/RU language hook slots', () => {
  it('hexaco populated (FR) — section title localized; structural snapshot locked', () => {
    const out = formatPsychologicalProfileForDisplay('hexaco', hexacoPopulated, 'French');
    expect(out).toMatchInlineSnapshot(`
      "Personnalité HEXACO

      Honesty-Humility: 4.2 / 5.0 (confidence 0.6 — substantial evidence)
      Emotionality: 3.1 / 5.0 (confidence 0.4 — moderate evidence)
      Extraversion: 3.8 / 5.0 (confidence 0.5 — moderate evidence)
      Agreeableness: 4.0 / 5.0 (confidence 0.5 — moderate evidence)
      Conscientiousness: 4.5 / 5.0 (confidence 0.7 — substantial evidence)
      Openness: 4.3 / 5.0 (confidence 0.6 — substantial evidence)"
    `);
    expect(out).toContain('Personnalité HEXACO'); // FR section title (D-20)
    expect(out).not.toContain('HEXACO Personality'); // no EN leak
  });

  it('hexaco populated (RU) — section title localized; structural snapshot locked', () => {
    const out = formatPsychologicalProfileForDisplay('hexaco', hexacoPopulated, 'Russian');
    expect(out).toMatchInlineSnapshot(`
      "Личность HEXACO

      Honesty-Humility: 4.2 / 5.0 (confidence 0.6 — substantial evidence)
      Emotionality: 3.1 / 5.0 (confidence 0.4 — moderate evidence)
      Extraversion: 3.8 / 5.0 (confidence 0.5 — moderate evidence)
      Agreeableness: 4.0 / 5.0 (confidence 0.5 — moderate evidence)
      Conscientiousness: 4.5 / 5.0 (confidence 0.7 — substantial evidence)
      Openness: 4.3 / 5.0 (confidence 0.6 — substantial evidence)"
    `);
    expect(out).toContain('Личность HEXACO'); // RU section title (D-20)
    expect(out).not.toContain('HEXACO Personality');
  });

  it('hexaco insufficient (FR) — N-word countdown localized', () => {
    const out = formatPsychologicalProfileForDisplay('hexaco', hexacoInsufficient, 'French');
    expect(out).toMatchInlineSnapshot(`"HEXACO : données insuffisantes — il faut 4500 mots de plus."`);
    expect(out).toContain('4500 mots'); // FR "need N more words" structure
  });

  it('hexaco insufficient (RU) — N-word countdown localized', () => {
    const out = formatPsychologicalProfileForDisplay('hexaco', hexacoInsufficient, 'Russian');
    expect(out).toMatchInlineSnapshot(`"HEXACO: недостаточно данных — нужно ещё 4500 слов."`);
    expect(out).toContain('4500 слов'); // RU "need N more words" structure
  });

  it('attachment (FR) — always "pas encore actif"', () => {
    expect(
      formatPsychologicalProfileForDisplay('attachment', null, 'French'),
    ).toMatchInlineSnapshot(`"Attachement : pas encore actif (déclencheur D028 — 2 000 mots de parole relationnelle sur 60 jours)."`);
  });

  it('attachment (RU) — always "пока не активна"', () => {
    expect(
      formatPsychologicalProfileForDisplay('attachment', null, 'Russian'),
    ).toMatchInlineSnapshot(`"Привязанность: пока не активна (триггер D028 — 2 000 слов реляционной речи за 60 дней)."`);
  });
});
