/**
 * Phase 35 Plan 35-03 — formatProfileForDisplay golden-output snapshot test (SURF-04).
 *
 * **First snapshot test in this codebase.** Reviewer notes:
 *   - On test failure (rendering changed), run
 *     `npx vitest run -u src/bot/handlers/__tests__/profile.golden.test.ts`
 *     to update the inline snapshots in this file. Then REVIEW the diff
 *     carefully: ANY third-person leak ("Greg's...", "His...", "He has...")
 *     or internal field-name leak ("tax_structure:", "fi_phase:") is a
 *     M010-07 regression — REJECT the update.
 *   - The 16 cases cover 4 dimensions × 4 states (null / zero-confidence /
 *     populated-fresh / populated-stale) in English.
 *   - 2 FR + 2 RU smoke tests assert localized labels appear (1 dimension each).
 *
 * Per D-25 + D-26: inline-snapshot keeps the expected output visible at the
 * assertion site so every rendering change forces deliberate reviewer
 * approval (unlike external __snapshots__/ files that are easy to ignore in
 * PR review).
 *
 * Per D-27: each dimension × 4 cases (null / zero-confidence / populated-fresh
 * / populated-stale). Stale = lastUpdated > 21 days ago (D-22 threshold).
 *
 * Deterministic time: `vi.setSystemTime(FRESH_DATE)` in beforeAll fixes
 * `Date.now()` to the fresh fixture date so the staleness check is
 * reproducible. STALE_DATE is 42 days before FRESH_DATE (>21d threshold).
 *
 * D-02 (Phase 18 onward): vi.setSystemTime ONLY — NEVER vi.useFakeTimers. The
 * latter replaces setTimeout/setInterval and breaks postgres.js keep-alive
 * timers. This test does no DB I/O so technically the constraint is moot
 * here, but the convention is uniform across the suite.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { formatProfileForDisplay, type Lang } from '../profile.js';
import type { ProfileRow } from '../../../memory/profiles.js';
import type {
  JurisdictionalProfileData,
  CapitalProfileData,
  HealthProfileData,
  FamilyProfileData,
} from '../../../memory/profiles/schemas.js';

// ── Fixed time anchor ───────────────────────────────────────────────────────
//
// FRESH_DATE is the "now" the formatter sees via Date.now(). STALE_DATE is
// 42 days earlier (>21-day threshold) so populated-stale cases hit the
// staleness branch deterministically.

const FRESH_DATE = new Date('2026-05-13T00:00:00Z');
const STALE_DATE = new Date('2026-04-01T00:00:00Z'); // FRESH_DATE − 42 days

beforeAll(() => {
  vi.setSystemTime(FRESH_DATE);
});

afterAll(() => {
  vi.useRealTimers();
});

// ── Fixtures: 4 dimensions × 4 cases ────────────────────────────────────────
//
// Field values are realistic Phase 33 ground-truth–adjacent shapes; values
// borrowed from src/pensieve/ground-truth.ts where it makes sense and
// synthesized otherwise. NO "Greg" / "His" / third-person framing in any
// fixture string — the formatter must produce second-person output even if
// fed third-person-flavored content (M010-07 mitigation).

const JURIS_FRESH_DATA: JurisdictionalProfileData = {
  current_country: 'Georgia',
  physical_location: 'Tbilisi',
  residency_status: [
    { type: 'tax', value: 'French resident', since: '2020-01-01' },
    { type: 'physical', value: 'Georgia visa-free 1 year', since: '2026-04-15' },
  ],
  tax_residency: 'France',
  active_legal_entities: [
    { name: 'Maingret Consulting SARL', jurisdiction: 'France' },
  ],
  next_planned_move: { destination: 'Portugal', from_date: '2026-09-01' },
  planned_move_date: '2026-09-01',
  passport_citizenships: ['France'],
  data_consistency: 0.85,
};

const CAPITAL_FRESH_DATA: CapitalProfileData = {
  fi_phase: 'accumulation',
  fi_target_amount: 'EUR 1,500,000',
  estimated_net_worth: 'EUR 420,000',
  runway_months: 18,
  next_sequencing_decision: 'rebalance French PEA in Q3',
  income_sources: [
    { source: 'consulting', kind: 'active' },
    { source: 'dividend portfolio', kind: 'passive' },
  ],
  major_allocation_decisions: [
    { description: 'shift 30% to global ETF', date: '2026-02-10' },
  ],
  tax_optimization_status: 'France PFU 30% flat (working)',
  active_legal_entities: [
    { name: 'Maingret Consulting SARL', jurisdiction: 'France' },
  ],
  data_consistency: 0.78,
};

const HEALTH_FRESH_DATA: HealthProfileData = {
  open_hypotheses: [
    { name: 'low energy mornings', status: 'investigating', date_opened: '2026-04-20' },
  ],
  pending_tests: [
    { test_name: 'thyroid panel', scheduled_date: '2026-05-25', status: 'scheduled' },
  ],
  active_treatments: [
    { name: 'magnesium glycinate 400mg', started_date: '2026-04-22', purpose: 'sleep' },
  ],
  recent_resolved: [
    { name: 'shoulder pain', resolved_date: '2026-04-10', resolution: 'PT 4 weeks' },
  ],
  case_file_narrative: 'Energy trending up since magnesium started; sleep quality stable.',
  wellbeing_trend: { energy_30d_mean: 6.4, mood_30d_mean: 7.1, anxiety_30d_mean: 3.2 },
  data_consistency: 0.72,
};

const FAMILY_FRESH_DATA: FamilyProfileData = {
  relationship_status: 'single, dating',
  partnership_criteria_evolution: [
    { text: 'intellectually curious, multilingual', date_noted: '2026-03-15', still_active: true },
    { text: 'wants kids within 3 years', date_noted: '2026-02-01', still_active: true },
    { text: 'open to remote-first', date_noted: '2026-01-20', still_active: false },
  ],
  children_plans: 'wants 2 within 3-5 years',
  parent_care_responsibilities: {
    notes: 'mother lives in France, independent',
    dependents: [],
  },
  active_dating_context: 'Tbilisi local + occasional Paris trips',
  milestones: [
    { type: 'first-date', date: '2026-05-01', notes: 'good signal' },
  ],
  constraints: [
    { text: 'no long-distance >6 months', date_noted: '2026-03-15' },
  ],
  data_consistency: 0.6,
};

// Zero-confidence rows still carry plausibly-shaped data — Phase 33 seed
// pattern is data_consistency=0 with empty arrays + null scalars. These
// rows render via the same insufficient-data branch as null, but we still
// want a typed fixture to exercise the branch.

const JURIS_ZERO_DATA: JurisdictionalProfileData = {
  current_country: null,
  physical_location: null,
  residency_status: [],
  tax_residency: null,
  active_legal_entities: [],
  next_planned_move: { destination: null, from_date: null },
  planned_move_date: null,
  passport_citizenships: [],
  data_consistency: 0,
};

const CAPITAL_ZERO_DATA: CapitalProfileData = {
  fi_phase: null,
  fi_target_amount: null,
  estimated_net_worth: null,
  runway_months: null,
  next_sequencing_decision: null,
  income_sources: [],
  major_allocation_decisions: [],
  tax_optimization_status: null,
  active_legal_entities: [],
  data_consistency: 0,
};

const HEALTH_ZERO_DATA: HealthProfileData = {
  open_hypotheses: [],
  pending_tests: [],
  active_treatments: [],
  recent_resolved: [],
  case_file_narrative: null,
  wellbeing_trend: { energy_30d_mean: null, mood_30d_mean: null, anxiety_30d_mean: null },
  data_consistency: 0,
};

const FAMILY_ZERO_DATA: FamilyProfileData = {
  relationship_status: null,
  partnership_criteria_evolution: [],
  children_plans: null,
  parent_care_responsibilities: { notes: null, dependents: [] },
  active_dating_context: null,
  milestones: [],
  constraints: [],
  data_consistency: 0,
};

const MOCK_PROFILES = {
  jurisdictional: {
    null: null as ProfileRow<JurisdictionalProfileData> | null,
    zeroConfidence: {
      data: JURIS_ZERO_DATA,
      confidence: 0,
      lastUpdated: FRESH_DATE,
      schemaVersion: 1,
    } as ProfileRow<JurisdictionalProfileData>,
    populatedFresh: {
      data: JURIS_FRESH_DATA,
      confidence: 0.72,
      lastUpdated: new Date(FRESH_DATE.getTime() - 3 * 86_400_000), // 3d ago
      schemaVersion: 1,
    } as ProfileRow<JurisdictionalProfileData>,
    populatedStale: {
      data: JURIS_FRESH_DATA,
      confidence: 0.72,
      lastUpdated: STALE_DATE,
      schemaVersion: 1,
    } as ProfileRow<JurisdictionalProfileData>,
  },
  capital: {
    null: null as ProfileRow<CapitalProfileData> | null,
    zeroConfidence: {
      data: CAPITAL_ZERO_DATA,
      confidence: 0,
      lastUpdated: FRESH_DATE,
      schemaVersion: 1,
    } as ProfileRow<CapitalProfileData>,
    populatedFresh: {
      data: CAPITAL_FRESH_DATA,
      confidence: 0.65,
      lastUpdated: new Date(FRESH_DATE.getTime() - 5 * 86_400_000),
      schemaVersion: 1,
    } as ProfileRow<CapitalProfileData>,
    populatedStale: {
      data: CAPITAL_FRESH_DATA,
      confidence: 0.65,
      lastUpdated: STALE_DATE,
      schemaVersion: 1,
    } as ProfileRow<CapitalProfileData>,
  },
  health: {
    null: null as ProfileRow<HealthProfileData> | null,
    zeroConfidence: {
      data: HEALTH_ZERO_DATA,
      confidence: 0,
      lastUpdated: FRESH_DATE,
      schemaVersion: 1,
    } as ProfileRow<HealthProfileData>,
    populatedFresh: {
      data: HEALTH_FRESH_DATA,
      confidence: 0.58,
      lastUpdated: new Date(FRESH_DATE.getTime() - 2 * 86_400_000),
      schemaVersion: 1,
    } as ProfileRow<HealthProfileData>,
    populatedStale: {
      data: HEALTH_FRESH_DATA,
      confidence: 0.58,
      lastUpdated: STALE_DATE,
      schemaVersion: 1,
    } as ProfileRow<HealthProfileData>,
  },
  family: {
    null: null as ProfileRow<FamilyProfileData> | null,
    zeroConfidence: {
      data: FAMILY_ZERO_DATA,
      confidence: 0,
      lastUpdated: FRESH_DATE,
      schemaVersion: 1,
    } as ProfileRow<FamilyProfileData>,
    populatedFresh: {
      data: FAMILY_FRESH_DATA,
      confidence: 0.55,
      lastUpdated: new Date(FRESH_DATE.getTime() - 7 * 86_400_000),
      schemaVersion: 1,
    } as ProfileRow<FamilyProfileData>,
    populatedStale: {
      data: FAMILY_FRESH_DATA,
      confidence: 0.55,
      lastUpdated: STALE_DATE,
      schemaVersion: 1,
    } as ProfileRow<FamilyProfileData>,
  },
};

// ── 16 EN inline snapshots: 4 dimensions × 4 states ─────────────────────────

describe('formatProfileForDisplay — jurisdictional (EN)', () => {
  it('null profile → localized actionable progress indicator', () => {
    expect(
      formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.null, 'English'),
    ).toMatchInlineSnapshot(`"Chris needs more entries about your location and tax situation before populating this profile."`);
  });
  it('zero-confidence profile → progress indicator', () => {
    expect(
      formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.zeroConfidence, 'English'),
    ).toMatchInlineSnapshot(`"Chris needs more entries about your location and tax situation before populating this profile."`);
  });
  it('populated-fresh profile → full second-person summary, no staleness note', () => {
    expect(
      formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.populatedFresh, 'English'),
    ).toMatchInlineSnapshot(`
      "Jurisdictional Profile (confidence 72%)

      You're currently in Tbilisi, Georgia.
      Your tax residency: France.
      Your residency statuses:
      - tax: French resident (since 2020-01-01)
      - physical: Georgia visa-free 1 year (since 2026-04-15)
      Your next planned move: Portugal (from 2026-09-01).
      Your passport citizenships: France.
      Your active legal entities: Maingret Consulting SARL (France)."
    `);
  });
  it('populated-stale profile → full summary + staleness note', () => {
    expect(
      formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.populatedStale, 'English'),
    ).toMatchInlineSnapshot(`
      "Jurisdictional Profile (confidence 72%)

      You're currently in Tbilisi, Georgia.
      Your tax residency: France.
      Your residency statuses:
      - tax: French resident (since 2020-01-01)
      - physical: Georgia visa-free 1 year (since 2026-04-15)
      Your next planned move: Portugal (from 2026-09-01).
      Your passport citizenships: France.
      Your active legal entities: Maingret Consulting SARL (France).

      Note: profile data from 2026-04-01 — may not reflect current situation."
    `);
  });
});

describe('formatProfileForDisplay — capital (EN)', () => {
  it('null profile → localized actionable progress indicator', () => {
    expect(
      formatProfileForDisplay('capital', MOCK_PROFILES.capital.null, 'English'),
    ).toMatchInlineSnapshot(`"Chris needs more entries about your finances before populating this profile."`);
  });
  it('zero-confidence profile → progress indicator', () => {
    expect(
      formatProfileForDisplay('capital', MOCK_PROFILES.capital.zeroConfidence, 'English'),
    ).toMatchInlineSnapshot(`"Chris needs more entries about your finances before populating this profile."`);
  });
  it('populated-fresh profile → full second-person summary, no staleness note', () => {
    expect(
      formatProfileForDisplay('capital', MOCK_PROFILES.capital.populatedFresh, 'English'),
    ).toMatchInlineSnapshot(`
      "Capital Profile (confidence 65%)

      Your FI phase: accumulation.
      Your FI target: EUR 1,500,000.
      Your estimated net worth: EUR 420,000.
      Your runway: 18 months.
      Your next sequencing decision: rebalance French PEA in Q3.
      Your tax-optimization status: France PFU 30% flat (working).
      Your income sources:
      - consulting (active)
      - dividend portfolio (passive)
      Your active legal entities: Maingret Consulting SARL (France).
      Your major allocation decisions:
      - 2026-02-10: shift 30% to global ETF"
    `);
  });
  it('populated-stale profile → full summary + staleness note', () => {
    expect(
      formatProfileForDisplay('capital', MOCK_PROFILES.capital.populatedStale, 'English'),
    ).toMatchInlineSnapshot(`
      "Capital Profile (confidence 65%)

      Your FI phase: accumulation.
      Your FI target: EUR 1,500,000.
      Your estimated net worth: EUR 420,000.
      Your runway: 18 months.
      Your next sequencing decision: rebalance French PEA in Q3.
      Your tax-optimization status: France PFU 30% flat (working).
      Your income sources:
      - consulting (active)
      - dividend portfolio (passive)
      Your active legal entities: Maingret Consulting SARL (France).
      Your major allocation decisions:
      - 2026-02-10: shift 30% to global ETF

      Note: profile data from 2026-04-01 — may not reflect current situation."
    `);
  });
});

describe('formatProfileForDisplay — health (EN)', () => {
  it('null profile → localized actionable progress indicator', () => {
    expect(
      formatProfileForDisplay('health', MOCK_PROFILES.health.null, 'English'),
    ).toMatchInlineSnapshot(`"Chris needs more entries about your wellbeing before populating this profile."`);
  });
  it('zero-confidence profile → progress indicator', () => {
    expect(
      formatProfileForDisplay('health', MOCK_PROFILES.health.zeroConfidence, 'English'),
    ).toMatchInlineSnapshot(`"Chris needs more entries about your wellbeing before populating this profile."`);
  });
  it('populated-fresh profile → full second-person summary, no staleness note', () => {
    expect(
      formatProfileForDisplay('health', MOCK_PROFILES.health.populatedFresh, 'English'),
    ).toMatchInlineSnapshot(`
      "Health Profile (confidence 58%)

      Your case-file narrative: Energy trending up since magnesium started; sleep quality stable.
      Your open hypotheses:
      - low energy mornings [investigating since 2026-04-20]
      Your pending tests:
      - thyroid panel (scheduled 2026-05-25)
      Your active treatments:
      - magnesium glycinate 400mg since 2026-04-22 (sleep)
      Your recently resolved items:
      - shoulder pain resolved 2026-04-10: PT 4 weeks
      Your 30-day wellbeing trend: energy=6.4, mood=7.1, anxiety=3.2"
    `);
  });
  it('populated-stale profile → full summary + staleness note', () => {
    expect(
      formatProfileForDisplay('health', MOCK_PROFILES.health.populatedStale, 'English'),
    ).toMatchInlineSnapshot(`
      "Health Profile (confidence 58%)

      Your case-file narrative: Energy trending up since magnesium started; sleep quality stable.
      Your open hypotheses:
      - low energy mornings [investigating since 2026-04-20]
      Your pending tests:
      - thyroid panel (scheduled 2026-05-25)
      Your active treatments:
      - magnesium glycinate 400mg since 2026-04-22 (sleep)
      Your recently resolved items:
      - shoulder pain resolved 2026-04-10: PT 4 weeks
      Your 30-day wellbeing trend: energy=6.4, mood=7.1, anxiety=3.2

      Note: profile data from 2026-04-01 — may not reflect current situation."
    `);
  });
});

describe('formatProfileForDisplay — family (EN)', () => {
  it('null profile → localized actionable progress indicator', () => {
    expect(
      formatProfileForDisplay('family', MOCK_PROFILES.family.null, 'English'),
    ).toMatchInlineSnapshot(`"Chris needs more entries about your relationships before populating this profile."`);
  });
  it('zero-confidence profile → progress indicator', () => {
    expect(
      formatProfileForDisplay('family', MOCK_PROFILES.family.zeroConfidence, 'English'),
    ).toMatchInlineSnapshot(`"Chris needs more entries about your relationships before populating this profile."`);
  });
  it('populated-fresh profile → full second-person summary, no staleness note', () => {
    expect(
      formatProfileForDisplay('family', MOCK_PROFILES.family.populatedFresh, 'English'),
    ).toMatchInlineSnapshot(`
      "Family Profile (confidence 55%)

      Your relationship status: single, dating.
      Your children plans: wants 2 within 3-5 years.
      Your active dating context: Tbilisi local + occasional Paris trips.
      Your parent-care responsibilities:
      - mother lives in France, independent
      Your active partnership criteria:
      - 2026-03-15: intellectually curious, multilingual
      - 2026-02-01: wants kids within 3 years
      Your constraints:
      - 2026-03-15: no long-distance >6 months
      Your milestones:
      - 2026-05-01 first-date: good signal"
    `);
  });
  it('populated-stale profile → full summary + staleness note', () => {
    expect(
      formatProfileForDisplay('family', MOCK_PROFILES.family.populatedStale, 'English'),
    ).toMatchInlineSnapshot(`
      "Family Profile (confidence 55%)

      Your relationship status: single, dating.
      Your children plans: wants 2 within 3-5 years.
      Your active dating context: Tbilisi local + occasional Paris trips.
      Your parent-care responsibilities:
      - mother lives in France, independent
      Your active partnership criteria:
      - 2026-03-15: intellectually curious, multilingual
      - 2026-02-01: wants kids within 3 years
      Your constraints:
      - 2026-03-15: no long-distance >6 months
      Your milestones:
      - 2026-05-01 first-date: good signal

      Note: profile data from 2026-04-01 — may not reflect current situation."
    `);
  });
});

// ── FR / RU language-coverage smoke tests (D-27) ────────────────────────────
//
// Two languages × one dimension's populated-fresh case = 2 smoke tests.
// These assert localized section labels + 2nd-person framing markers
// (Tu/Ta/Ton/Tes for FR, Ты/Твой/Твоя/Твоё for RU) + negative invariant
// (no English label leak). No full inline snapshots — the smoke test is
// "the section labels appeared in the expected language", which is the
// regression class FR/RU users would notice immediately.

describe('formatProfileForDisplay — language coverage', () => {
  it('FR uses French section labels + 2nd-person framing for populated-fresh jurisdictional', () => {
    const out = formatProfileForDisplay(
      'jurisdictional',
      MOCK_PROFILES.jurisdictional.populatedFresh,
      'French' as Lang,
    );
    expect(out).toContain('Profil juridictionnel');
    expect(out).toContain('confiance');
    expect(out).toMatch(/Tu es|Ta résidence|Ton prochain|Tes/);
    expect(out).not.toContain('Jurisdictional Profile');
    expect(out).not.toContain('You\'re');
    // WR-02: connective glue words must be localized — no English "since" leak
    // inside an otherwise-French section ("depuis" is the localized form).
    // Scoped to the " (since YYYY-MM-DD)" UI pattern to avoid catching the
    // word "since" if it appears in a user-content data field.
    expect(out).toContain('(depuis 2020-01-01)');
    expect(out).not.toMatch(/\(since \d{4}-\d{2}-\d{2}\)/);
    // No third-person leak.
    expect(out).not.toContain('Greg');
    expect(out).not.toMatch(/\bHis\b/);
  });
  it('RU uses Russian section labels + 2nd-person framing for populated-fresh jurisdictional', () => {
    const out = formatProfileForDisplay(
      'jurisdictional',
      MOCK_PROFILES.jurisdictional.populatedFresh,
      'Russian' as Lang,
    );
    expect(out).toContain('Юрисдикционный профиль');
    expect(out).toContain('уверенность');
    expect(out).toMatch(/Ты|Твой|Твоя|Твоё|Твои/);
    expect(out).not.toContain('Jurisdictional Profile');
    expect(out).not.toContain('You\'re');
    // WR-02: connective glue words must be localized — "с" replaces "since".
    // Scoped to UI pattern; user-content data may legitimately contain "since".
    expect(out).toContain('(с 2020-01-01)');
    expect(out).not.toMatch(/\(since \d{4}-\d{2}-\d{2}\)/);
    expect(out).not.toContain('Greg');
    expect(out).not.toMatch(/\bHis\b/);
  });

  // WR-02: health-dimension smoke tests for the "since" connective +
  // wellbeing-axis labels (`energy=`/`mood=`/`anxiety=`). The English
  // forms were leaking verbatim into FR/RU output — these assertions are
  // the regression detector. We don't use full inline snapshots because
  // `case_file_narrative`, `h.status`, `t.purpose`, and `r.resolution`
  // are stored data values (user-content, not UI labels) that remain
  // in the source language they were recorded in; only the connective
  // glue words are within scope of WR-02.
  it('FR health: "depuis" + French wellbeing axis labels, no English leak in connectives', () => {
    const out = formatProfileForDisplay(
      'health',
      MOCK_PROFILES.health.populatedFresh,
      'French' as Lang,
    );
    expect(out).toContain('Profil de santé');
    expect(out).toContain('confiance');
    // open_hypotheses: "[investigating depuis 2026-04-20]" (status is data;
    // only the connective is localized — status word stays untranslated).
    expect(out).toContain('[investigating depuis 2026-04-20]');
    // active_treatments: "magnesium glycinate 400mg depuis 2026-04-22 (sleep)"
    expect(out).toContain('depuis 2026-04-22');
    // wellbeing_trend axes localized:
    expect(out).toContain('énergie=6.4');
    expect(out).toContain('humeur=7.1');
    expect(out).toContain('anxiété=3.2');
    // Negative invariants: no English UI-label leak in the connective
    // positions where they previously appeared. Scoped to UI patterns
    // ("[STATUS since DATE]", "NAME since DATE") so user-content fields
    // (case_file_narrative, resolution text) that legitimately contain
    // the English word "since" as data are not flagged.
    expect(out).not.toMatch(/\[\w+ since \d{4}-\d{2}-\d{2}\]/);
    expect(out).not.toMatch(/ since \d{4}-\d{2}-\d{2}/);
    expect(out).not.toContain('energy=');
    expect(out).not.toContain('mood=');
    expect(out).not.toContain('anxiety=');
  });
  it('RU health: "с" + Russian wellbeing axis labels, no English leak in connectives', () => {
    const out = formatProfileForDisplay(
      'health',
      MOCK_PROFILES.health.populatedFresh,
      'Russian' as Lang,
    );
    expect(out).toContain('Профиль здоровья');
    expect(out).toContain('уверенность');
    expect(out).toContain('[investigating с 2026-04-20]');
    expect(out).toContain('с 2026-04-22');
    expect(out).toContain('энергия=6.4');
    expect(out).toContain('настроение=7.1');
    expect(out).toContain('тревога=3.2');
    expect(out).not.toMatch(/\[\w+ since \d{4}-\d{2}-\d{2}\]/);
    expect(out).not.toMatch(/ since \d{4}-\d{2}-\d{2}/);
    expect(out).not.toContain('energy=');
    expect(out).not.toContain('mood=');
    expect(out).not.toContain('anxiety=');
  });
});
