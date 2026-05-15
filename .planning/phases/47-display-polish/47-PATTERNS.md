# Phase 47: Display Polish — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 2 (1 MODIFIED + 1 NEW)
**Analogs found:** 2 / 2 (both targets have a direct in-repo analog — Phase 39 `formatPsychologicalProfileForDisplay` + Phase 39 `profile-psychological.golden.test.ts` are the proven structural mirrors; this phase extends the same file + test pattern with a circumplex iteration order and an additive cross-validation section)

---

## File Classification

| # | New/Modified File | Status | Role | Data Flow | Closest Analog | Match Quality |
|---|-------------------|--------|------|-----------|----------------|---------------|
| 1 | `src/bot/handlers/profile.ts` | MODIFIED | controller (Telegram handler) + utility (pure display formatter) | request-response | self — `formatPsychologicalProfileForDisplay` (:740–819) + `SCHWARTZ_DIM_DISPLAY_LABELS` (:727–738) + `qualifierForPsych` (:704–708) + MSG.psychologicalSections block (:188–257) | exact (sibling-extension within the same file: replace one `Object.entries` iteration + add one sibling pure function + one MSG block extension) |
| 2 | `src/bot/handlers/__tests__/profile-psychological-crossval.golden.test.ts` | NEW | test (golden inline snapshot) | transform-assertion | `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` (Phase 39 PSURF-05 golden snapshot) | exact (identical `vi.setSystemTime` anchor + `MOCK_*` fixtures + `toMatchInlineSnapshot` pattern; mirrors Phase 39 D-25 4-scenarios × FR/RU structure) |

---

## Pattern Assignments

### 1. `src/bot/handlers/profile.ts` (controller + pure display formatter, transform)

**Plan:** 47-01 (DISP-01 + DISP-02 — single atomic plan)
**Analog:** self — existing `formatPsychologicalProfileForDisplay` at `:740–819` and the `SCHWARTZ_DIM_DISPLAY_LABELS` map at `:727–738`.

#### Pattern A — Ordered iteration array (replaces `Object.entries(LABEL_MAP)` for DISP-01)

**Existing exemplar** (HEXACO branch at `:781–795`, alphabetical-by-declaration iteration):

```typescript
case 'hexaco': {
  const d = profile.data as HexacoProfileData;
  for (const [key, label] of Object.entries(HEXACO_DIM_DISPLAY_LABELS) as Array<
    [keyof HexacoProfileData, string]
  >) {
    const dim = d[key];
    if (!dim) continue;                     // D-09 skip null
    if (dim.score === null) continue;       // D-09 skip null score
    if (dim.confidence === 0) continue;     // D-09 skip zero-confidence
    lines.push(
      `${label}: ${dim.score.toFixed(1)} / 5.0 (confidence ${dim.confidence.toFixed(1)} — ${qualifierForPsych(dim.confidence)})`,
    );
  }
  break;
}
```

**NEW pattern for the Schwartz branch** (Phase 47 D-01/D-02/D-03 — iterate an ordered key array, look up label per-key):

```typescript
// Phase 47 D-02 — canonical clockwise circumplex order. Adjacent pairs across
// the 10-element ring form Schwartz's documented oppositions:
//   self_direction ↔ conformity (index 0 ↔ 4)
//   stimulation ↔ security      (index 9 ↔ 5)
//   hedonism ↔ tradition         (index 8 ↔ 3)
//   achievement ↔ benevolence    (index 7 ↔ 2)
//   power ↔ universalism         (index 6 ↔ 1)
// The ring wraps at index 9 → index 0 (stimulation ↔ self_direction completes
// the circle). NOT alphabetical, NOT by-score; the structural pairing IS the
// reader value (DISP-01 requirement).
const SCHWARTZ_CIRCUMPLEX_ORDER: readonly (keyof SchwartzProfileData)[] = [
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
] as const;

// Schwartz branch (replaces existing :796–809 Object.entries iteration)
case 'schwartz': {
  const d = profile.data as SchwartzProfileData;
  // Phase 46 ships per-lang label maps; lookup syntax becomes labelMap[lang][key].
  // Pre-Phase-46 shape (current): label = SCHWARTZ_DIM_DISPLAY_LABELS[key].
  for (const key of SCHWARTZ_CIRCUMPLEX_ORDER) {
    const dim = d[key];
    if (!dim) continue;                     // D-09 skip null (UNCHANGED from Phase 39)
    if (dim.score === null) continue;       // D-09 skip null score
    if (dim.confidence === 0) continue;     // D-09 skip zero-confidence
    const label = SCHWARTZ_DIM_DISPLAY_LABELS[lang][key];   // post-Phase-46
    lines.push(
      MSG.psychologicalSections.scoreLine[lang](label, dim.score, dim.confidence, qualifierFor(dim.confidence, lang)),
    );
  }
  break;
}
```

#### Pattern B — Hardcoded cross-validation rule table (DISP-02)

**Analog**: no existing rule table in the file — closest cousin is the LABEL maps at `:714–738` (module-scope, frozen, typed). The rule table mirrors that shape (module-scope `as const`).

**NEW rule-table shape** (Phase 47 D-06/D-07):

```typescript
// Phase 47 D-07 — cross-validation rule table. NOT Sonnet at /profile-call
// time (D-06 rationale: preserves Phase 39 D-22 reader-never-throw, no LLM
// failure surface for a synchronous read). NOT computed at inference time
// (D-06 rationale: would require either a third Sonnet call or post-hoc rule
// application on persisted state — post-hoc IS what the display-side table
// does, moving it to write-time adds a column without changing the logic;
// deferred to v2.7 if Greg reports observable read latency, see CONTEXT.md
// <deferred>).
//
// Rules encode well-documented HEXACO × Schwartz literature correlations:
//   openness ↔ self_direction/stimulation/universalism (positive)
//   conscientiousness ↔ achievement/security/conformity (positive)
//   honesty_humility ↔ benevolence/universalism (positive); NEG power
//   agreeableness ↔ benevolence/universalism (positive)
//   extraversion ↔ stimulation/hedonism/achievement (positive)
//   emotionality ↔ tradition/security (positive)
type CrossValRule = {
  hexacoDim: keyof HexacoProfileData;
  schwartzDim: keyof SchwartzProfileData;
  direction: 'positive' | 'negative';
  observationKey: 'consistent' | 'uncommon';
};

const CROSS_VALIDATION_RULES: readonly CrossValRule[] = [
  // openness — exploration / change-openness cluster
  { hexacoDim: 'openness',           schwartzDim: 'self_direction', direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'openness',           schwartzDim: 'stimulation',    direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'openness',           schwartzDim: 'universalism',   direction: 'positive', observationKey: 'consistent' },
  // conscientiousness — order / achievement cluster
  { hexacoDim: 'conscientiousness',  schwartzDim: 'achievement',    direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'conscientiousness',  schwartzDim: 'security',       direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'conscientiousness',  schwartzDim: 'conformity',     direction: 'positive', observationKey: 'consistent' },
  // honesty_humility — pro-social / anti-power cluster
  { hexacoDim: 'honesty_humility',   schwartzDim: 'benevolence',    direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'honesty_humility',   schwartzDim: 'universalism',   direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'honesty_humility',   schwartzDim: 'power',          direction: 'negative', observationKey: 'uncommon'   },
  // agreeableness — pro-social cluster
  { hexacoDim: 'agreeableness',      schwartzDim: 'benevolence',    direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'agreeableness',      schwartzDim: 'universalism',   direction: 'positive', observationKey: 'consistent' },
  // extraversion — energetic-engagement cluster
  { hexacoDim: 'extraversion',       schwartzDim: 'stimulation',    direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'extraversion',       schwartzDim: 'hedonism',       direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'extraversion',       schwartzDim: 'achievement',    direction: 'positive', observationKey: 'consistent' },
  // emotionality — safety / tradition cluster
  { hexacoDim: 'emotionality',       schwartzDim: 'tradition',      direction: 'positive', observationKey: 'consistent' },
  { hexacoDim: 'emotionality',       schwartzDim: 'security',       direction: 'positive', observationKey: 'consistent' },
] as const;
```

#### Pattern C — Cross-validation observation computer (DISP-02 helper)

**Analog**: Phase 39 `formatPsychologicalProfileForDisplay` at `:740–819` — pure function, lang-parameterized, returns `string`.

**NEW helper** (Phase 47 D-08/D-09/D-10/D-11/D-14):

```typescript
// Phase 47 — computes cross-validation observations from HEXACO + Schwartz
// profile data. Pure function: no I/O, no logger, deterministic given inputs.
// Returns '' when section should be omitted (D-14 empty-state rule, matches
// Phase 39 WR-06 recommended fix pattern).
//
// Match criterion (D-08):
//   - 'positive' direction: HEXACO score >= 3.5 of 5.0 AND Schwartz score >= 5.0 of 7.0
//   - 'negative' direction: HEXACO score >= 3.5 of 5.0 AND Schwartz score <= 3.0 of 7.0
//   (HEXACO uses 5.0 max scale; Schwartz uses 7.0 max scale per substrate-loader gates.)
// Confidence floor (D-09): both dim confidences >= 0.3 (otherwise silent omit).
// Qualifier on observation line (D-10): MIN(hexaco.confidence, schwartz.confidence)
//   passed through the locale-aware qualifierFor (Phase 46 L10N-05).
export function computeCrossValidationObservations(
  hexaco: ProfileRow<HexacoProfileData> | null,
  schwartz: ProfileRow<SchwartzProfileData> | null,
  lang: Lang,
): string {
  if (hexaco === null || schwartz === null) return '';                   // D-14
  if (hexaco.lastUpdated.getTime() === 0 || schwartz.lastUpdated.getTime() === 0) return '';
  if (hexaco.confidence === 0 || schwartz.confidence === 0) return '';

  const hex = hexaco.data;
  const sch = schwartz.data;
  const observations: string[] = [];

  for (const rule of CROSS_VALIDATION_RULES) {
    const hDim = hex[rule.hexacoDim];
    const sDim = sch[rule.schwartzDim];
    if (!hDim || !sDim) continue;
    if (hDim.score === null || sDim.score === null) continue;
    if (hDim.confidence < 0.3 || sDim.confidence < 0.3) continue;        // D-09 floor

    const hHigh = hDim.score >= 3.5;                                     // D-08 HEXACO threshold
    let schwartzMatch: boolean;
    if (rule.direction === 'positive') {
      schwartzMatch = sDim.score >= 5.0;                                 // D-08 Schwartz HIGH
    } else {
      schwartzMatch = sDim.score <= 3.0;                                 // D-08 Schwartz LOW
    }
    if (!(hHigh && schwartzMatch)) continue;

    const minConf = Math.min(hDim.confidence, sDim.confidence);
    const hLabel = HEXACO_DIM_DISPLAY_LABELS[lang][rule.hexacoDim];      // post-Phase-46
    const sLabel = SCHWARTZ_DIM_DISPLAY_LABELS[lang][rule.schwartzDim];  // post-Phase-46
    const qualifier = qualifierFor(minConf, lang);                       // post-Phase-46 L10N-05

    observations.push(
      MSG.psychologicalSections.crossValidation[rule.observationKey][lang](hLabel, sLabel, qualifier),
    );
  }

  if (observations.length === 0) return '';                              // D-14 empty-state
  const title = MSG.psychologicalSections.crossValidation.sectionTitle[lang];
  return [title, '', ...observations].join('\n');
}
```

#### Pattern D — `MSG.psychologicalSections.crossValidation` block extension (DISP-02 + L10N coordination)

**Analog**: existing `MSG.psychologicalSections.{hexaco,schwartz,attachment}` blocks at `:197–257` (Phase 39 PSURF-04). The Phase 47 extension adds a sibling key `crossValidation` keyed by `{sectionTitle, consistent, uncommon}[lang]`.

```typescript
// Inside MSG.psychologicalSections — append after `attachment` block (D-13 + D-17)
crossValidation: {
  sectionTitle: {
    English: 'Cross-pattern observations',
    French: 'Observations transversales',
    Russian: 'Сквозные наблюдения',
  },
  consistent: {
    English: (hexacoLabel: string, schwartzLabel: string, qualifier: string): string =>
      `high ${hexacoLabel.toLowerCase()} + high ${schwartzLabel.toLowerCase()} -> consistent (${qualifier})`,
    French: (hexacoLabel: string, schwartzLabel: string, qualifier: string): string =>
      `${hexacoLabel.toLowerCase()} élevé + ${schwartzLabel.toLowerCase()} élevé -> cohérent (${qualifier})`,
    Russian: (hexacoLabel: string, schwartzLabel: string, qualifier: string): string =>
      `высокий ${hexacoLabel.toLowerCase()} + высокий ${schwartzLabel.toLowerCase()} -> согласовано (${qualifier})`,
  },
  uncommon: {
    English: (hexacoLabel: string, schwartzLabel: string, qualifier: string): string =>
      `high ${hexacoLabel.toLowerCase()} + low ${schwartzLabel.toLowerCase()} -> uncommon pattern (${qualifier})`,
    French: (hexacoLabel: string, schwartzLabel: string, qualifier: string): string =>
      `${hexacoLabel.toLowerCase()} élevé + ${schwartzLabel.toLowerCase()} faible -> profil inhabituel (${qualifier})`,
    Russian: (hexacoLabel: string, schwartzLabel: string, qualifier: string): string =>
      `высокий ${hexacoLabel.toLowerCase()} + низкий ${schwartzLabel.toLowerCase()} -> необычный паттерн (${qualifier})`,
  },
},
```

**D-17 invariant**: plain ASCII only — `->` not `→`, no `*`, `_`, backticks, `===`, `---`.

#### Pattern E — Handler-side append (DISP-02 wiring)

**Analog**: `handleProfileCommand` at `:822+` already loops over `['hexaco', 'schwartz', 'attachment']` and calls `ctx.reply(formatPsychologicalProfileForDisplay(...))` per Phase 39 D-18. The cross-val section is rendered by ONE additional `ctx.reply(computeCrossValidationObservations(hex, schwartz, lang))` AFTER the 3-reply loop, gated by a truthy check (D-14 empty-string omits the reply entirely).

```typescript
// Pseudo — exact line numbers will land post-Phase-46 (the handler may shift)
const psychProfiles = await getPsychologicalProfiles();
for (const type of ['hexaco', 'schwartz', 'attachment'] as const) {
  await ctx.reply(formatPsychologicalProfileForDisplay(type, psychProfiles[type], lang));
}
const crossVal = computeCrossValidationObservations(psychProfiles.hexaco, psychProfiles.schwartz, lang);
if (crossVal !== '') {
  await ctx.reply(crossVal);                       // D-14: only reply when section non-empty
}
```

**Reply count**: 4 operational + 3 psychological + (0 or 1) cross-val. Cross-val reply only fires when at least one rule matches above floor (D-14).

---

### 2. `src/bot/handlers/__tests__/profile-psychological-crossval.golden.test.ts` (NEW, golden inline-snapshot)

**Plan:** 47-01 (DISP-02 regression net)
**Analog:** `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` (Phase 39 PSURF-05 golden snapshot).

**Structural mirror** (Phase 39 pattern):

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatPsychologicalProfileForDisplay,
  computeCrossValidationObservations,
  SCHWARTZ_CIRCUMPLEX_ORDER,
  CROSS_VALIDATION_RULES,
} from '../profile';
import type { ProfileRow } from '../../../memory/profiles';
import type { HexacoProfileData, SchwartzProfileData } from '../../../memory/profiles/psychological-schemas';

const FIXED_NOW = new Date('2026-05-14T10:00:00.000Z');

beforeEach(() => { vi.setSystemTime(FIXED_NOW); });
afterEach(() => { vi.useRealTimers(); });

// MOCK fixtures: populated HEXACO + populated Schwartz with several rule matches
const MOCK_HEXACO_POPULATED: ProfileRow<HexacoProfileData> = { /* ... */ };
const MOCK_SCHWARTZ_POPULATED: ProfileRow<SchwartzProfileData> = { /* ... */ };

describe('Phase 47 — DISP-01 circumplex order', () => {
  it('renders Schwartz section with opposing values adjacent (EN)', () => {
    const out = formatPsychologicalProfileForDisplay('schwartz', MOCK_SCHWARTZ_POPULATED, 'English');
    expect(out).toMatchInlineSnapshot(`/* ... circumplex-ordered lines ... */`);
  });
  // FR + RU mirror tests
});

describe('Phase 47 — DISP-02 cross-validation observations', () => {
  it('renders cross-val section after both profiles populated (EN)', () => {
    const out = computeCrossValidationObservations(MOCK_HEXACO_POPULATED, MOCK_SCHWARTZ_POPULATED, 'English');
    expect(out).toMatchInlineSnapshot(`/* ... title + observation lines ... */`);
  });
  it('omits section entirely when one profile is null (D-14)', () => {
    expect(computeCrossValidationObservations(null, MOCK_SCHWARTZ_POPULATED, 'English')).toBe('');
    expect(computeCrossValidationObservations(MOCK_HEXACO_POPULATED, null, 'English')).toBe('');
  });
  it('omits section when all dims below confidence floor (D-09)', () => {
    /* fixture with all conf < 0.3 */
    expect(/* ... */).toBe('');
  });
  it('FR + RU snapshots', () => { /* ... */ });
});

describe('Phase 47 — Schwartz circumplex order array invariants', () => {
  it('contains exactly 10 keys, no duplicates', () => {
    expect(SCHWARTZ_CIRCUMPLEX_ORDER).toHaveLength(10);
    expect(new Set(SCHWARTZ_CIRCUMPLEX_ORDER).size).toBe(10);
  });
  it('opposing pairs sit at correct circumplex distance', () => {
    const idx = (k: keyof SchwartzProfileData) => SCHWARTZ_CIRCUMPLEX_ORDER.indexOf(k);
    // adjacent pairs across the 10-element ring (distance 5):
    const opposingPairs: ReadonlyArray<[keyof SchwartzProfileData, keyof SchwartzProfileData]> = [
      ['self_direction', 'conformity'],
      ['stimulation', 'security'],
      ['hedonism', 'tradition'],
      ['achievement', 'benevolence'],
      ['power', 'universalism'],
    ];
    for (const [a, b] of opposingPairs) {
      const distance = Math.abs(idx(a) - idx(b));
      expect(distance === 5 || distance === 5).toBe(true);  // distance 5 of 10-element ring
    }
  });
});

describe('Phase 47 — Cross-validation rule table invariants', () => {
  it('no duplicate (hexacoDim, schwartzDim, direction) triples', () => {
    const triples = CROSS_VALIDATION_RULES.map(r => `${r.hexacoDim}|${r.schwartzDim}|${r.direction}`);
    expect(new Set(triples).size).toBe(triples.length);
  });
  it('every rule references a valid HEXACO dim key', () => {
    const validHexaco: Array<keyof HexacoProfileData> = ['honesty_humility', 'emotionality', 'extraversion', 'agreeableness', 'conscientiousness', 'openness'];
    for (const rule of CROSS_VALIDATION_RULES) expect(validHexaco).toContain(rule.hexacoDim);
  });
  it('every rule references a valid Schwartz dim key', () => {
    const validSchwartz: Array<keyof SchwartzProfileData> = ['self_direction', 'universalism', 'benevolence', 'tradition', 'conformity', 'security', 'power', 'achievement', 'hedonism', 'stimulation'];
    for (const rule of CROSS_VALIDATION_RULES) expect(validSchwartz).toContain(rule.schwartzDim);
  });
});
```

**Match quality**: exact — Phase 39's golden test is the proven structural mirror. Scenario count: 4 (DISP-01 circumplex EN + DISP-02 populated EN + null-profile + below-floor) × 3 languages (EN/FR/RU) + 2 invariant suites (array shape + rule table shape).

---

## Risk Notes

- **Phase 46 dependency (D-16/D-17)**: `qualifierFor(c, lang)`, `HEXACO_DIM_DISPLAY_LABELS[lang][key]`, `SCHWARTZ_DIM_DISPLAY_LABELS[lang][key]`, `MSG.psychologicalSections.scoreLine[lang]` must exist BEFORE Phase 47 starts coding. Plan 47-01's read_first list explicitly names `src/bot/handlers/profile.ts` to be re-read after Phase 46 lands.
- **Substrate constraints**: HEXACO `dim.score` is on 5.0 scale; Schwartz `dim.score` is on 7.0 scale (per `psychological-shared.ts` substrate-loader gates). D-08 thresholds bake in this asymmetry — `hDim.score >= 3.5` for HEXACO, `sDim.score >= 5.0` (positive) or `<= 3.0` (negative) for Schwartz.
- **D-17 invariant**: no parse_mode chars (`*`, `_`, backtick, `===`, `---`). Cross-val observation strings use `->` not `→` for plain ASCII safety.
- **Reader-never-throw (Phase 39 D-22)**: `computeCrossValidationObservations` is pure, no DB / no logger / no Sonnet. Cannot throw on malformed data (defensive guards on every dim access).
- **NOT modified**: `psychological-shared.ts`, `psychological-schemas.ts`, schema files, generators, migrations. Rendering-only phase.

---

## Files NOT Modified (negative invariant)

- `src/memory/profiles/psychological-shared.ts` (substrate)
- `src/memory/profiles/psychological-schemas.ts` (Zod schemas)
- `src/memory/psychological-profile-prompt.ts` (prompt-side)
- All M010/M011 generator files
- All migration files (`drizzle/0001…`)

Modifying any of these is a scope-creep regression per CONTEXT.md §Phase Boundary.
