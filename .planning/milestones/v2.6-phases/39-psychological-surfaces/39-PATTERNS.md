# Phase 39: Psychological Surfaces — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 10 (7 MODIFIED + 2 NEW + 1 UNCHANGED/negative-invariant target)
**Analogs found:** 10 / 10 (all targets have a direct in-repo analog — Phase 35 M010 surfaces shipped 2026-05-13 and Phase 38 M011 inference engine shipped 2026-05-14 are the proven structural mirrors)

---

## File Classification

| # | New/Modified File | Status | Role | Data Flow | Closest Analog | Match Quality |
|---|-------------------|--------|------|-----------|----------------|---------------|
| 1 | `src/memory/profiles.ts` | MODIFIED | model + utility (pure formatter) | transform (in-memory) | self — `PROFILE_INJECTION_MAP` (:87) + `formatProfilesForPrompt` (:446) | exact (sibling extension in same file) |
| 2 | `src/chris/personality.ts` | MODIFIED | service (prompt assembler) | transform (string substitution) | self — `ChrisContextExtras` (:39) + `buildSystemPrompt` REFLECT/COACH/PSYCHOLOGY cases (:145–171) | exact (one-line interface field + symmetric substitution) |
| 3 | `src/chris/modes/reflect.ts` | MODIFIED | controller (mode handler) | request-response | self — operational profile wiring (:11, :75–87) | exact (4-line extension) |
| 4 | `src/chris/modes/psychology.ts` | MODIFIED | controller (mode handler) | request-response | self — operational profile wiring (:11, :76–82) | exact (4-line extension, mirrors reflect.ts) |
| 5 | `src/chris/modes/coach.ts` | UNCHANGED (negative-invariant target) | controller (mode handler) | request-response | self — `:77–86` is the locked surface; D-14 forbids modification | exact (the file IS the assertion target) |
| 6 | `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` | NEW | test (regex sweep) | file-I/O (`readFile` + regex) | `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` (Phase 37 D047 boundary audit) | exact (identical readFile + findHits + per-line regex pattern) |
| 7 | `src/memory/__tests__/profiles.test.ts` | MODIFIED | test (unit) | transform-assertion | self — existing `PROFILE_INJECTION_MAP — shape (D-08)` (:340) + `formatProfilesForPrompt — gates and rendering` (:367) | exact (parallel describe blocks for `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` + `formatPsychologicalProfilesForPrompt`) |
| 8 | `src/chris/__tests__/personality.test.ts` | MODIFIED | test (unit) | transform-assertion | self — `extras.operationalProfiles injection (Phase 35 D-07)` (:235–323) | exact (parallel `describe` for `psychologicalProfiles`; new substitution-order test) |
| 9 | `src/bot/handlers/profile.ts` | MODIFIED | controller (Telegram handler) + utility (pure display formatter) | request-response | self — `formatProfileForDisplay` (:397–586) + `handleProfileCommand` (:607–638) + MSG localization map (:111–369) | exact (sibling pure formatter + 3-reply loop replacing :627) |
| 10 | `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` | NEW | test (golden inline snapshot) | transform-assertion | `src/bot/handlers/__tests__/profile.golden.test.ts` (Phase 35 SURF-04 golden snapshot) | exact (`vi.setSystemTime` anchor + `MOCK_*` fixtures + `toMatchInlineSnapshot`) |

---

## Pattern Assignments

### 1. `src/memory/profiles.ts` (model + utility, transform)

**Plan:** 39-01 (PSURF-01 + PSURF-02)
**Analog:** self — existing operational `PROFILE_INJECTION_MAP` (:87) + `formatProfilesForPrompt` (:446).

**Imports pattern** (existing :18–54, extend with footer import):
```typescript
// Existing imports — keep as-is
import {
  HexacoProfileSchemaV3,
  SchwartzProfileSchemaV3,
  AttachmentProfileSchemaV3,
  type HexacoProfileData,
  type SchwartzProfileData,
  type AttachmentProfileData,
} from './profiles/psychological-schemas.js';
import type { PsychologicalProfileType } from './profiles/psychological-shared.js';

// NEW Phase 39 — Hard Rule footer single-source-of-truth import
import { PSYCHOLOGICAL_HARD_RULE_EXTENSION } from './psychological-profile-prompt.js';
```

**INJECTION_MAP pattern to mirror** (existing :87–91 — operational exemplar):
```typescript
// src/memory/profiles.ts:87 — operational map (LOCKED, do not touch)
export const PROFILE_INJECTION_MAP: Readonly<Record<'REFLECT' | 'COACH' | 'PSYCHOLOGY', readonly Dimension[]>> = {
  REFLECT: ['jurisdictional', 'capital', 'health', 'family'],
  COACH: ['capital', 'family'],
  PSYCHOLOGY: ['health', 'jurisdictional'],
} as const;
```

**NEW sibling map** (Phase 39 D-04 — append after operational map OR after `getPsychologicalProfiles` near :415):
```typescript
// Phase 39 PSURF-01 — DISTINCT from PROFILE_INJECTION_MAP per D-03.
// COACH explicitly absent (key union narrows to REFLECT | PSYCHOLOGY; passing
// 'COACH' is a compile-time error — structural defense against D027 regression).
// 'attachment' NOT in any array (Phase 38 D-23 — generator deferred).
export const PSYCHOLOGICAL_PROFILE_INJECTION_MAP: Readonly<
  Record<'REFLECT' | 'PSYCHOLOGY', readonly PsychologicalProfileType[]>
> = {
  REFLECT: ['hexaco', 'schwartz'],
  PSYCHOLOGY: ['hexaco', 'schwartz'],
} as const;
```

**Formatter early-return pattern to mirror** (existing :446–475 — operational exemplar):
```typescript
// src/memory/profiles.ts:446 — operational formatter (structural mirror)
export function formatProfilesForPrompt(profiles: OperationalProfiles, mode: string): string {
  const scope = (PROFILE_INJECTION_MAP as Record<string, readonly Dimension[]>)[mode];
  if (!scope) return '';

  const sections: string[] = [];
  const now = Date.now();
  for (const dim of scope) {
    const row = profiles[dim];
    if (!row) continue;
    if (row.confidence === 0) continue;
    // ... per-dim renderer + staleness append ...
    sections.push(block);
  }
  if (sections.length === 0) return '';
  return PROFILE_INJECTION_HEADER + '\n\n' + sections.join('\n\n');
}
```

**NEW sibling formatter shape** (Phase 39 D-05/D-06/D-08/D-09 divergences applied):
```typescript
// Phase 39 PSURF-02 — sibling to formatProfilesForPrompt, append after :475.
const PSYCH_INJECTION_HEADER = '## Psychological Profile (inferred — low precision, never use as authority)';

function qualifierFor(c: number): string {                    // D-07 inline qualifier
  if (c >= 0.6) return 'substantial evidence';
  if (c >= 0.3) return 'moderate evidence';
  return 'limited evidence';
}

export function formatPsychologicalProfilesForPrompt(
  profiles: PsychologicalProfiles,
  mode: string,
): string {
  const scope = (PSYCHOLOGICAL_PROFILE_INJECTION_MAP as
    Record<string, readonly PsychologicalProfileType[]>)[mode];
  if (!scope) return '';                                       // D-05.a — mode not in map

  const sections: string[] = [];
  for (const profileType of scope) {
    const row = profiles[profileType];
    if (!row) continue;                                        // D-05.b — null row
    if (row.confidence === 0) continue;                        // D-05.c — zero confidence
    if (row.lastUpdated.getTime() === 0) continue;             // D-05.d — never-fired epoch sentinel
    // Phase 39 DIVERGENCE vs operational: NO staleness check (monthly cron);
    // NO per-dim char cap; NO health-floor gate. Per-dim filter only (D-09).
    const block = renderPsychDimensions(profileType, row);
    if (block) sections.push(block);
  }
  if (sections.length === 0) return '';

  // D-06 + D-11 — Hard Rule footer at BOTTOM (recency-bias attention).
  // PSYCHOLOGICAL_HARD_RULE_EXTENSION imported verbatim from
  // src/memory/psychological-profile-prompt.ts:144 — DO NOT re-declare.
  return [
    PSYCH_INJECTION_HEADER,
    '',
    sections.join('\n\n'),
    '',
    PSYCHOLOGICAL_HARD_RULE_EXTENSION,
  ].join('\n');
}
```

**Per-dim line format pattern** (D-08 locked):
```
HEXACO Openness: 4.2 / 5.0 (confidence 0.6 — moderate evidence)
HEXACO Conscientiousness: 4.5 / 5.0 (confidence 0.5 — moderate evidence)
Schwartz Self-Direction: 4.2 / 5.0 (confidence 0.6 — moderate evidence)
```
Title-case dim names; score `X.X` (1 decimal); confidence `Y.Y` (1 decimal); qualifier from `qualifierFor(c)`.

**ProfileRow extension (RESEARCH Open Q1 — recommended Option A):**
```typescript
// src/memory/profiles.ts:58 — extend ProfileRow<T> with two optional fields.
// Operational rows leave them undefined; readOnePsychologicalProfile populates.
export interface ProfileRow<T> {
  data: T;
  confidence: number;
  lastUpdated: Date;
  schemaVersion: number;
  wordCount?: number;                // Phase 39 — current substrate scan total
  wordCountAtLastRun?: number;       // Phase 39 — snapshot at last cron observation
}
```
Then in `readOnePsychologicalProfile` (existing :371–378), thread the two fields out of the row instead of stripping:
```typescript
return {
  data: parsed.data as T,
  confidence: row.overallConfidence,
  lastUpdated: row.lastUpdated ?? new Date(0),
  schemaVersion: row.schemaVersion,
  wordCount: row.wordCount,                       // NEW
  wordCountAtLastRun: row.wordCountAtLastRun,     // NEW
};
```

---

### 2. `src/chris/personality.ts` (service, transform)

**Plan:** 39-01 (PSURF-03)
**Analog:** self — existing `ChrisContextExtras` (:39) + `buildSystemPrompt` REFLECT/COACH/PSYCHOLOGY cases (:145–171).

**Interface extension pattern** (existing :39–43):
```typescript
// EXISTING — keep as-is, add ONE field
export interface ChrisContextExtras {
  language?: string;
  declinedTopics?: DeclinedTopic[];
  operationalProfiles?: string;
  psychologicalProfiles?: string;   // Phase 39 PSURF-03 (D-10 sibling field, optional)
}
```

**Destructure pattern** (existing :126):
```typescript
// EXISTING line — extend the destructure to include the new field
const { language, declinedTopics, operationalProfiles, psychologicalProfiles } = extras ?? {};
```

**Substitution-order pattern to extend** (existing :145–152 — REFLECT case):
```typescript
// src/chris/personality.ts:145 — EXISTING REFLECT case
case 'REFLECT': {
  const pensieveWithProfile = operationalProfiles
    ? `${operationalProfiles}\n\n${contextValue}`
    : contextValue;
  modeBody = REFLECT_SYSTEM_PROMPT
    .replace('{pensieveContext}', pensieveWithProfile)
    .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
  break;
}
```

**NEW substitution body** (D-11 — psychological → operational → pensieve order; apply to REFLECT + PSYCHOLOGY cases ONLY; COACH case stays unchanged):
```typescript
case 'REFLECT': {
  // D-11 — psychological ABOVE operational ABOVE pensieve.
  // Empty strings (the "" return from formatPsychologicalProfilesForPrompt when
  // below threshold) are filtered out so the block does not introduce orphan
  // blank-line separators.
  const pensieveWithProfile = [psychologicalProfiles, operationalProfiles, contextValue]
    .filter(Boolean)
    .join('\n\n');
  modeBody = REFLECT_SYSTEM_PROMPT
    .replace('{pensieveContext}', pensieveWithProfile)
    .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
  break;
}
case 'COACH': {
  // UNCHANGED — D-14 + D-12 silent-drop. psychologicalProfiles destructured
  // from extras above but intentionally NOT referenced in this case body.
  const pensieveWithProfile = operationalProfiles
    ? `${operationalProfiles}\n\n${contextValue}`
    : contextValue;
  modeBody = COACH_SYSTEM_PROMPT
    .replace('{pensieveContext}', pensieveWithProfile)
    .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
  break;
}
case 'PSYCHOLOGY': {
  // Same shape as REFLECT — psych ABOVE op ABOVE pensieve.
  const pensieveWithProfile = [psychologicalProfiles, operationalProfiles, contextValue]
    .filter(Boolean)
    .join('\n\n');
  modeBody = PSYCHOLOGY_SYSTEM_PROMPT
    .replace('{pensieveContext}', pensieveWithProfile)
    .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
  break;
}
```

**Silent-drop invariant** (existing JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY cases — D-12 + D-15):
No code change needed in those cases. Because they never destructure `psychologicalProfiles` into their body, the field is silently dropped exactly as `operationalProfiles` already is (Phase 35 D-28).

---

### 3. `src/chris/modes/reflect.ts` (controller, request-response)

**Plan:** 39-01 (PSURF-03)
**Analog:** self — existing operational wiring (:11, :75–87).

**Imports pattern** (existing :11):
```typescript
// EXISTING
import { getOperationalProfiles, formatProfilesForPrompt } from '../../memory/profiles.js';
```

**NEW imports** (extend the same line):
```typescript
import {
  getOperationalProfiles,
  formatProfilesForPrompt,
  getPsychologicalProfiles,                       // NEW Phase 39
  formatPsychologicalProfilesForPrompt,           // NEW Phase 39
} from '../../memory/profiles.js';
```

**Wiring pattern to extend** (existing :75–87):
```typescript
// EXISTING — keep verbatim
const profiles = await getOperationalProfiles();
const operationalProfiles = formatProfilesForPrompt(profiles, 'REFLECT');

const history = await buildMessageHistory(chatId);
const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, {
  language,
  declinedTopics,
  operationalProfiles,
});
```

**NEW addition** (D-13 + D-16 sequential awaits; insert between operational block and `buildMessageHistory` call):
```typescript
// NEW Phase 39 PSURF-03 — sequential await (D-16); never-throw reader.
// Order locked per D-13: getPsychologicalProfiles → formatPsychologicalProfilesForPrompt.
const psychProfiles = await getPsychologicalProfiles();
const psychologicalProfiles = formatPsychologicalProfilesForPrompt(psychProfiles, 'REFLECT');

const history = await buildMessageHistory(chatId);
const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, {
  language,
  declinedTopics,
  operationalProfiles,
  psychologicalProfiles,                          // NEW Phase 39
});
```

---

### 4. `src/chris/modes/psychology.ts` (controller, request-response)

**Plan:** 39-01 (PSURF-03)
**Analog:** self — same shape as reflect.ts. Existing wiring at :11, :76–82.

**Pattern:** IDENTICAL to reflect.ts except the mode string. Apply the same import extension and the same insertion of `getPsychologicalProfiles → formatPsychologicalProfilesForPrompt(psychProfiles, 'PSYCHOLOGY')`. The `buildSystemPrompt('PSYCHOLOGY', ..., { ..., psychologicalProfiles })` extras field is added.

**Mirror invariant** (RESEARCH Pitfall 5): reflect.ts and psychology.ts must be byte-identical in their psych-wiring block except for the mode-string argument. Asymmetry is a regression — Plan 39-01's structural test (recommended per RESEARCH Open Q3) should assert both files import `getPsychologicalProfiles` and pass `psychologicalProfiles` in `extras`.

---

### 5. `src/chris/modes/coach.ts` (controller, request-response) — NEGATIVE-INVARIANT TARGET

**Plan:** 39-01 (PSURF-03 + PSURF-05 negative invariant via test #6)
**Analog:** self — the file at its current shipped state is the assertion target.

**No code changes.** The file's current content at :77–86 reads operational profiles and passes them to `buildSystemPrompt('COACH', ...)`. Phase 39 explicitly does NOT add `getPsychologicalProfiles`, `formatPsychologicalProfilesForPrompt`, or any psych vocabulary to this file. D-14 + REQUIREMENTS PSURF-05 lock this.

**Invariant guarded by test #6:** the file source contains zero matches for the regex `\b(psychological|getPsychologicalProfiles|formatPsychologicalProfilesForPrompt|hexaco|schwartz|attachment|HEXACO|SCHWARTZ|ATTACHMENT|PSYCHOLOGICAL_PROFILE_INJECTION_MAP|PSYCHOLOGICAL_HARD_RULE_EXTENSION)\b`.

---

### 6. `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` (test, file-I/O regex sweep) — NEW

**Plan:** 39-01 (PSURF-05 negative invariant)
**Analog:** `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` (Phase 37 PSCH-10 D047 boundary audit).

**Imports pattern** (from analog :32–35):
```typescript
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
```

**Project-root resolution pattern** (from analog :37–45):
```typescript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Depth 4: src/chris/modes/__tests__/ → src/chris/modes → src/chris → src → project root
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');

async function readSource(relPath: string): Promise<string> {
  return readFile(resolve(PROJECT_ROOT, relPath), 'utf8');
}
```

**Per-line hit-scan helper pattern** (from analog :53–71):
```typescript
function findHits(
  contents: string,
  pattern: RegExp,
): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (pattern.test(line)) hits.push({ line: i + 1, text: line.trim() });
  }
  return hits;
}

function formatHits(hits: Array<{ line: number; text: string }>): string {
  return hits.map((h) => `  line ${h.line}: ${h.text}`).join('\n');
}
```

**Regex + assertion pattern** (mirror analog :73–129 with Phase 39 vocabulary; LOUD failure message per RESEARCH Assumption A7):
```typescript
// Word-boundary regex over codebase-specific identifiers (not generic words
// like "profile" or "trait" which legitimately appear in operational coach.ts).
const PSYCH_VOCAB = /\b(psychological|getPsychologicalProfiles|formatPsychologicalProfilesForPrompt|hexaco|schwartz|attachment|HEXACO|SCHWARTZ|ATTACHMENT|PSYCHOLOGICAL_PROFILE_INJECTION_MAP|PSYCHOLOGICAL_HARD_RULE_EXTENSION)\b/;

const COACH_FILE = 'src/chris/modes/coach.ts';

describe('PSURF-05: COACH handler is psychological-profile-isolated (D027 Hard Rule)', () => {
  it(`${COACH_FILE} contains zero psychological-vocabulary references`, async () => {
    const src = await readSource(COACH_FILE);
    const hits = findHits(src, PSYCH_VOCAB);
    expect(
      hits,
      `D027 Hard Rule violation: ${COACH_FILE} references psychological-profile vocabulary at:\n` +
        formatHits(hits) +
        '\n\nCOACH must not inject psychological profiles. Trait → coaching-conclusion is ' +
        'circular reasoning ("you should X because you score high on Y"). See PITFALLS.md §1 ' +
        '(D027 sycophancy injection via profile authority framing). ' +
        'If you need to add coaching that uses psychological data, the right fix is to ' +
        'route through REFLECT or PSYCHOLOGY, not to weaken this boundary.',
    ).toEqual([]);
  });
});
```

**Optional extension** (RESEARCH Wave 0 Gap item — multi-file sweep): the same regex + helper can be extended to assert `getPsychologicalProfiles` import-absence in JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY handler files. Planner picks whether to co-locate in this file or split into `structural-injection.test.ts`.

---

### 7. `src/memory/__tests__/profiles.test.ts` (test, unit) — MODIFIED

**Plan:** 39-01 (PSURF-01 + PSURF-02)
**Analog:** self — existing `PROFILE_INJECTION_MAP — shape (D-08)` describe block (:340–365) + `formatProfilesForPrompt — gates and rendering (D-09..D-13)` describe block (:367–526).

**Map-shape describe-block pattern** (analog :340–365):
```typescript
// EXISTING analog
describe('PROFILE_INJECTION_MAP — shape (D-08)', () => {
  it('REFLECT contains all 4 dimensions in declaration order', async () => {
    const { PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PROFILE_INJECTION_MAP.REFLECT).toEqual(['jurisdictional', 'capital', 'health', 'family']);
  });
  it('JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY are NOT keys in the map (D-28 negative invariant)', async () => {
    const { PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect('JOURNAL' in PROFILE_INJECTION_MAP).toBe(false);
    // ... etc
  });
});
```

**NEW sibling describe block** (mirror exactly, swap names; CRITICAL — assert COACH absence):
```typescript
describe('PSYCHOLOGICAL_PROFILE_INJECTION_MAP — shape (Phase 39 D-04)', () => {
  it('REFLECT equals [hexaco, schwartz]', async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PSYCHOLOGICAL_PROFILE_INJECTION_MAP.REFLECT).toEqual(['hexaco', 'schwartz']);
  });
  it('PSYCHOLOGY equals [hexaco, schwartz]', async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PSYCHOLOGICAL_PROFILE_INJECTION_MAP.PSYCHOLOGY).toEqual(['hexaco', 'schwartz']);
  });
  it('COACH is NOT a key in the map (D-14 negative invariant — D027 Hard Rule)', async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect('COACH' in PSYCHOLOGICAL_PROFILE_INJECTION_MAP).toBe(false);
  });
  it('JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY are NOT keys', async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    for (const m of ['JOURNAL', 'INTERROGATE', 'PRODUCE', 'PHOTOS', 'ACCOUNTABILITY']) {
      expect(m in PSYCHOLOGICAL_PROFILE_INJECTION_MAP).toBe(false);
    }
  });
  it("'attachment' is NOT in any mode's array (Phase 38 D-23 — generator deferred)", async () => {
    const { PSYCHOLOGICAL_PROFILE_INJECTION_MAP } = await import('../profiles.js');
    expect(PSYCHOLOGICAL_PROFILE_INJECTION_MAP.REFLECT).not.toContain('attachment');
    expect(PSYCHOLOGICAL_PROFILE_INJECTION_MAP.PSYCHOLOGY).not.toContain('attachment');
  });
});
```

**Formatter gate-and-rendering pattern to mirror** (analog :367–526):
The analog has these test cases (mirror their shape; substitute psychological scope per D-05):
- empty-return when mode not in map (`JOURNAL`, `INTERROGATE`, `PRODUCE`, `PHOTOS`, `ACCOUNTABILITY`, `COACH`, `UNKNOWN_MODE` → all `""`)
- empty-return when all in-scope profiles null (D-05.b)
- empty-return when all in-scope profiles zero-confidence (D-05.c)
- empty-return when all in-scope profiles never-fired (`lastUpdated.getTime() === 0`) (D-05.d — new branch unique to psych)
- populated REFLECT → renders block with PSYCH_INJECTION_HEADER + per-dim score lines + footer present at bottom
- populated PSYCHOLOGY → same shape (mirror REFLECT case)
- partial-population → renders only populated dims, skips null/zero-conf ones (D-09)
- footer-position invariant → `PSYCHOLOGICAL_HARD_RULE_EXTENSION` substring appears at the END of the returned string (D-11 recency-bias)
- footer-import invariant → the footer text equals the imported constant verbatim (no drift from Phase 38)

**NOTE on time mocking:** the analog uses `vi.useFakeTimers()` at :369. Phase 39 SHOULD NOT mirror this — the psychological formatter has NO staleness check, so no time anchor is needed. Use plain `describe` with no `beforeEach` (avoids the postgres-keepalive break documented in RESEARCH Anti-Patterns).

---

### 8. `src/chris/__tests__/personality.test.ts` (test, unit) — MODIFIED

**Plan:** 39-01 (PSURF-03 + RESEARCH Open Q3 substitution-order test)
**Analog:** self — existing `extras.operationalProfiles injection (Phase 35 D-07)` describe block (:235–323).

**Substitution-order pattern to mirror** (analog :243–253):
```typescript
// EXISTING analog
it('REFLECT: prepends operationalProfiles ABOVE pensieveContext when set', () => {
  const out = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
    operationalProfiles: PROFILE_BLOCK,
  });
  const iProfile = out.indexOf('fake-jurisdictional-block');
  const iPensieve = out.indexOf(PENSIEVE);
  expect(iProfile).toBeGreaterThan(0);
  expect(iPensieve).toBeGreaterThan(iProfile);
});
```

**Silent-drop pattern to mirror** (analog :279–312):
```typescript
// EXISTING analog
it('JOURNAL silently drops extras.operationalProfiles (D-28)', () => {
  const out = buildSystemPrompt('JOURNAL', PENSIEVE, undefined, {
    operationalProfiles: 'should-not-appear-in-journal',
  });
  expect(out).not.toContain('should-not-appear-in-journal');
});
```

**NEW sibling describe block** (Phase 39 D-11 substitution order):
```typescript
describe('extras.psychologicalProfiles injection (Phase 39 D-11)', () => {
  const PSYCH_BLOCK = '## Psychological Profile (inferred — low precision, never use as authority)\n\nfake-hexaco-line';
  const OP_BLOCK = '## Operational Profile (grounded context — not interpretation)\n\nfake-op-line';
  const PENSIEVE = 'PENSIEVE_MARKER';

  // Three-way ordering — locked per D-11: psychological ABOVE operational ABOVE pensieve
  it('REFLECT: psychological → operational → pensieve order (D-11)', () => {
    const out = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
      psychologicalProfiles: PSYCH_BLOCK,
      operationalProfiles: OP_BLOCK,
    });
    const iPsych = out.indexOf('fake-hexaco-line');
    const iOp = out.indexOf('fake-op-line');
    const iPensieve = out.indexOf(PENSIEVE);
    expect(iPsych).toBeGreaterThan(0);
    expect(iOp).toBeGreaterThan(iPsych);
    expect(iPensieve).toBeGreaterThan(iOp);
  });

  it('PSYCHOLOGY: psychological → operational → pensieve order (D-11)', () => {
    // ... same shape as REFLECT
  });

  it('COACH silently drops extras.psychologicalProfiles (D-14 + D-12)', () => {
    const out = buildSystemPrompt('COACH', PENSIEVE, 'REL', {
      operationalProfiles: OP_BLOCK,
      psychologicalProfiles: 'should-not-appear-in-coach',
    });
    expect(out).not.toContain('should-not-appear-in-coach');
    // Operational still renders (COACH retains its existing M010 wiring)
    expect(out).toContain('fake-op-line');
  });

  // Mirror analog silent-drop sweep for JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY
  it('JOURNAL silently drops extras.psychologicalProfiles (D-15)', () => { /* ... */ });
  it('INTERROGATE silently drops extras.psychologicalProfiles (D-15)', () => { /* ... */ });
  it('PRODUCE silently drops extras.psychologicalProfiles (D-15)', () => { /* ... */ });
  it('PHOTOS silently drops extras.psychologicalProfiles (D-15)', () => { /* ... */ });
  it('ACCOUNTABILITY silently drops extras.psychologicalProfiles (D-15)', () => { /* ... */ });

  it('REFLECT: empty psychologicalProfiles string behaves identically to undefined', () => {
    const withEmpty = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
      operationalProfiles: OP_BLOCK,
      psychologicalProfiles: '',
    });
    const withoutField = buildSystemPrompt('REFLECT', PENSIEVE, 'REL', {
      operationalProfiles: OP_BLOCK,
    });
    expect(withEmpty).toBe(withoutField);
  });
});
```

---

### 9. `src/bot/handlers/profile.ts` (controller + utility, request-response) — MODIFIED

**Plan:** 39-02 (PSURF-04 + PSURF-05 — HARD CO-LOC #M11-3)
**Analog:** self — existing `formatProfileForDisplay` (:397–586), `handleProfileCommand` (:607–638), MSG localization map (:111–369).

**Imports pattern** (extend existing :58–62):
```typescript
// EXISTING — extend
import {
  getOperationalProfiles,
  getPsychologicalProfiles,                            // NEW Phase 39
  type ProfileRow,
  type Dimension,
  type PsychologicalProfileType,                       // NEW Phase 39
} from '../../memory/profiles.js';

// NEW Phase 39 — psych data type imports for the formatter signature
import type {
  HexacoProfileData,
  SchwartzProfileData,
  AttachmentProfileData,
} from '../../memory/profiles/psychological-schemas.js';
```

**MSG-localization pattern to mirror** (existing :111–369 — operational MSG map structure):
```typescript
// EXISTING analog (operational sectionTitle shape)
const MSG = {
  sectionTitle: {
    jurisdictional: {
      English: 'Jurisdictional Profile',
      French: 'Profil juridictionnel',
      Russian: 'Юрисдикционный профиль',
    },
    // ...
  },
  insufficientData: {
    English: (dim: Dimension): string =>
      `Chris needs more entries about your ${MSG.dimensionHint[dim].English} before populating this profile.`,
    French: (dim: Dimension): string => /* ... */,
    Russian: (dim: Dimension): string => /* ... */,
  },
  m011Placeholder: {                                   // ← REMOVE in Phase 39
    English: 'Psychological profile: not yet available — see M011.',
    French: 'Profil psychologique : pas encore disponible — voir M011.',
    Russian: 'Психологический профиль: пока недоступен — см. M011.',
  },
  // ...
};
```

**NEW MSG psychological-section keys** (D-20 — machine-translate-quality FR + RU per RESEARCH Pitfall 4 option b; insert into the existing `MSG` object; REMOVE `m011Placeholder` block):
```typescript
// REPLACE m011Placeholder (line 179) with a new psychologicalSections key:
psychologicalSections: {
  hexaco: {
    sectionTitle: { English: 'HEXACO Personality', French: 'Personnalité HEXACO', Russian: 'Личность HEXACO' },
    insufficientData: {
      English: (n: number) => `HEXACO: insufficient data — need ${n} more words.`,
      French: (n: number) => `HEXACO : données insuffisantes — il faut ${n} mots de plus.`,
      Russian: (n: number) => `HEXACO: недостаточно данных — нужно ещё ${n} слов.`,
    },
    neverFired: {
      English: 'HEXACO: not yet inferred (first profile inference runs 1st of month, 09:00 Paris).',
      French: 'HEXACO : pas encore inféré (première inférence le 1er du mois, 09:00 Paris).',
      Russian: 'HEXACO: ещё не выведено (первая инференция 1-го числа месяца, 09:00 Париж).',
    },
  },
  schwartz: { /* same shape as hexaco — sectionTitle + insufficientData + neverFired */ },
  attachment: {
    // D-19: ALWAYS rendered (regardless of activated flag) in M011
    notYetActive: {
      English: 'Attachment: not yet active (gated on D028 activation trigger — 2,000 words relational speech over 60 days).',
      French: "Attachement : pas encore actif (déclencheur D028 — 2 000 mots de parole relationnelle sur 60 jours).",
      Russian: 'Привязанность: пока не активна (триггер D028 — 2 000 слов реляционной речи за 60 дней).',
    },
  },
},
```

**Pure display-formatter pattern to mirror** (existing :397–586 — `formatProfileForDisplay`):
```typescript
// EXISTING analog signature (key shape: dimension + profile + lang → string)
export function formatProfileForDisplay(
  dimension: Dimension,
  profile: ProfileRow<unknown> | null,
  lang: Lang,
): string {
  if (profile === null || profile.confidence === 0) {
    return MSG.insufficientData[lang](dimension);
  }
  // ... populated branch with sectionTitle + per-field second-person lines ...
}
```

**NEW sibling formatter** (D-21 signature; D-19 four-branch state model; switch-case mirrors `formatProfileForDisplay` :412):
```typescript
// Phase 39 PSURF-05 — sibling to formatProfileForDisplay, append after :586.
// Pure function: NO I/O, NO DB. wordCount comes via ProfileRow<T> extension.
// HARD CO-LOC #M11-3: this function ships in the same plan as the golden test.
export function formatPsychologicalProfileForDisplay(
  profileType: 'hexaco' | 'schwartz' | 'attachment',
  profile: ProfileRow<HexacoProfileData> | ProfileRow<SchwartzProfileData> | ProfileRow<AttachmentProfileData> | null,
  lang: Lang,
): string {
  // D-19 branch 1 — Attachment: ALWAYS "not yet active" in M011
  if (profileType === 'attachment') {
    return MSG.psychologicalSections.attachment.notYetActive[lang];
  }

  // D-19 branch 2 — never-fired (last_updated === epoch)
  if (profile === null || profile.lastUpdated.getTime() === 0) {
    return MSG.psychologicalSections[profileType].neverFired[lang];
  }

  // D-19 branch 3 — insufficient data: word_count_at_last_run < 5000
  if (profile.confidence === 0) {
    const wc = profile.wordCountAtLastRun ?? 0;       // Open Q1 + Pitfall 3
    const N = Math.max(0, 5000 - wc);
    return MSG.psychologicalSections[profileType].insufficientData[lang](N);
  }

  // D-19 branch 4 — populated: section title + per-dim score lines
  const title = MSG.psychologicalSections[profileType].sectionTitle[lang];
  const lines: string[] = [title, ''];
  switch (profileType) {
    case 'hexaco': {
      const d = profile.data as HexacoProfileData;
      // Title-case dim names; score X.X / 5.0 (confidence Y.Y — qualifier per D-07)
      // Skip dims with null score or confidence === 0 (D-09)
      for (const [key, label] of [
        ['honesty_humility', 'Honesty-Humility'],
        ['emotionality', 'Emotionality'],
        ['extraversion', 'Extraversion'],
        ['agreeableness', 'Agreeableness'],
        ['conscientiousness', 'Conscientiousness'],
        ['openness', 'Openness'],
      ] as const) {
        const dim = d[key];
        if (!dim || dim.score === null || dim.confidence === 0) continue;
        lines.push(`${label}: ${dim.score.toFixed(1)} / 5.0 (confidence ${dim.confidence.toFixed(1)} — ${qualifierFor(dim.confidence)})`);
      }
      break;
    }
    case 'schwartz': { /* mirror — 10 values alphabetical per RESEARCH Deferred CIRC-01 */ break; }
  }
  return lines.join('\n');
}
```

**Handler reply-loop pattern to mirror** (existing :607–638 — `handleProfileCommand`):
```typescript
// EXISTING analog
export async function handleProfileCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const lang = langOf(getLastUserLanguage(chatId.toString()));
  try {
    const profiles = await getOperationalProfiles();
    const dimensions: Dimension[] = ['jurisdictional', 'capital', 'health', 'family'];
    for (const dim of dimensions) {
      await ctx.reply(formatProfileForDisplay(dim, profiles[dim], lang));
    }
    await ctx.reply(MSG.m011Placeholder[lang]);     // ← line 627 — REPLACE in Phase 39
  } catch (err) {
    logger.warn({ chatId, error: err instanceof Error ? err.message : String(err) }, 'profile.command.error');
    await ctx.reply(MSG.genericError[lang]);
  }
}
```

**NEW handler shape** (D-17 + D-18 — three new replies replacing line 627; sequential awaits per RESEARCH Pattern 6 + Phase 35 D-18):
```typescript
export async function handleProfileCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;
  const lang = langOf(getLastUserLanguage(chatId.toString()));
  try {
    // EXISTING operational loop — keep verbatim
    const profiles = await getOperationalProfiles();
    const dimensions: Dimension[] = ['jurisdictional', 'capital', 'health', 'family'];
    for (const dim of dimensions) {
      await ctx.reply(formatProfileForDisplay(dim, profiles[dim], lang));
    }

    // NEW Phase 39 PSURF-04 — REPLACE line 627 (the MSG.m011Placeholder reply)
    // Sequential await — Telegram does NOT guarantee order under Promise.all
    // (Phase 35 D-18 rationale). Reader is never-throw (Phase 37).
    const psychProfiles = await getPsychologicalProfiles();
    const psychTypes: PsychologicalProfileType[] = ['hexaco', 'schwartz', 'attachment'];
    for (const type of psychTypes) {
      await ctx.reply(formatPsychologicalProfileForDisplay(type, psychProfiles[type], lang));
    }
  } catch (err) {
    logger.warn({ chatId, error: err instanceof Error ? err.message : String(err) }, 'profile.command.error');
    await ctx.reply(MSG.genericError[lang]);
  }
}
```

**Auth/access pattern** (existing — no change): no auth middleware; `/profile` is user-initiated and Telegram chat-routing handles access (existing operational pattern; Phase 39 inherits).

**Error handling pattern** (existing :628–637 — `logger.warn` + `genericError` reply): inherited verbatim. Phase 39 does NOT add per-profile try/catch — `getPsychologicalProfiles` is never-throw (Phase 37), and `formatPsychologicalProfileForDisplay` is pure-string-out (no throw paths).

---

### 10. `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` (test, golden inline-snapshot) — NEW

**Plan:** 39-02 (PSURF-05 — HARD CO-LOC #M11-3)
**Analog:** `src/bot/handlers/__tests__/profile.golden.test.ts` (Phase 35 SURF-04 operational golden).

**Imports pattern** (mirror analog :36–44):
```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { formatPsychologicalProfileForDisplay, type Lang } from '../profile.js';
import type { ProfileRow } from '../../../memory/profiles.js';
import type {
  HexacoProfileData,
  SchwartzProfileData,
  AttachmentProfileData,
} from '../../../memory/profiles/psychological-schemas.js';
```

**Time-anchor pattern** (mirror analog :52–61):
```typescript
// FRESH_DATE = the "now" the formatter sees via Date.now()
// (D-19 never-fired branch uses lastUpdated.getTime() === 0 — independent of FRESH_DATE,
// but the anchor is still needed for deterministic test runs)
// D-02 (Phase 18 onward): vi.setSystemTime ONLY — NEVER vi.useFakeTimers
const FRESH_DATE = new Date('2026-06-15T00:00:00Z');
beforeAll(() => { vi.setSystemTime(FRESH_DATE); });
afterAll(() => { vi.useRealTimers(); });
```

**MOCK_PROFILES fixture pattern** (mirror analog :199–284 with psych shapes):
```typescript
const HEXACO_POPULATED_DATA: HexacoProfileData = {
  honesty_humility: { score: 4.2, confidence: 0.6, last_updated: '2026-06-01T...' },
  emotionality: { score: 3.1, confidence: 0.4, last_updated: '2026-06-01T...' },
  // ... all 6 dims populated for scenario 1
};

const SCHWARTZ_POPULATED_DATA: SchwartzProfileData = {
  self_direction: { score: 4.5, confidence: 0.7, last_updated: '2026-06-01T...' },
  // ... 10 values
};

const SCHWARTZ_MIXED_DATA: SchwartzProfileData = {
  self_direction: { score: 4.5, confidence: 0.7, last_updated: '2026-06-01T...' },
  stimulation: null,                                  // skip-null branch (D-09)
  hedonism: { score: 3.0, confidence: 0, last_updated: null },   // skip-zero-conf branch (D-09)
  // ... so scenario 3 exercises the per-dim filter
};

const MOCK_PSYCH_PROFILES = {
  hexaco: {
    populated: { data: HEXACO_POPULATED_DATA, confidence: 0.6, lastUpdated: new Date('2026-06-01T...'), schemaVersion: 1, wordCount: 8500, wordCountAtLastRun: 8500 } as ProfileRow<HexacoProfileData>,
    insufficient: { data: HEXACO_EMPTY_DATA, confidence: 0, lastUpdated: new Date('2026-06-01T...'), schemaVersion: 1, wordCount: 500, wordCountAtLastRun: 500 } as ProfileRow<HexacoProfileData>,  // → "need 4500 more words"
    neverFired: { data: HEXACO_EMPTY_DATA, confidence: 0, lastUpdated: new Date(0), schemaVersion: 1, wordCount: 0, wordCountAtLastRun: 0 } as ProfileRow<HexacoProfileData>,
    null: null as ProfileRow<HexacoProfileData> | null,
  },
  schwartz: { /* same shape — populated / insufficient / neverFired / null / MIXED for scenario 3 */ },
  attachment: { /* always renders notYetActive — D-19; one populated fixture exists but is ignored by the formatter in M011 */ },
};
```

**Inline-snapshot describe block pattern** (mirror analog :286–494):
```typescript
// Per D-25: describe.each across languages for scenarios 1–3 (but with explicit
// per-language describes works fine — analog uses explicit-describe approach)
describe('formatPsychologicalProfileForDisplay — populated HEXACO (EN)', () => {
  it('renders 6 dim score lines with confidence qualifier per D-07', () => {
    expect(
      formatPsychologicalProfileForDisplay('hexaco', MOCK_PSYCH_PROFILES.hexaco.populated, 'English'),
    ).toMatchInlineSnapshot(/* generated by `npx vitest -u` */);
  });
});

describe('formatPsychologicalProfileForDisplay — insufficient HEXACO (EN)', () => {
  it('renders word-count countdown: "need 4500 more words"', () => {
    expect(
      formatPsychologicalProfileForDisplay('hexaco', MOCK_PSYCH_PROFILES.hexaco.insufficient, 'English'),
    ).toMatchInlineSnapshot(`"HEXACO: insufficient data — need 4500 more words."`);
  });
});

describe('formatPsychologicalProfileForDisplay — Attachment ALWAYS not-yet-active (D-19)', () => {
  it('renders the deferred message regardless of fixture state', () => {
    // Even with a "populated" fixture, Attachment renders the deferred message in M011
    expect(
      formatPsychologicalProfileForDisplay('attachment', MOCK_PSYCH_PROFILES.attachment.populated, 'English'),
    ).toMatchInlineSnapshot(`"Attachment: not yet active (gated on D028 activation trigger — 2,000 words relational speech over 60 days)."`);
  });
});

// 4 scenarios × FR + RU slot reservation per D-24
describe('formatPsychologicalProfileForDisplay — populated HEXACO (FR)', () => {
  it('renders French section title + qualifier (slot reservation for v2.6.1 polish)', () => {
    expect(
      formatPsychologicalProfileForDisplay('hexaco', MOCK_PSYCH_PROFILES.hexaco.populated, 'French'),
    ).toMatchInlineSnapshot(/* FR snapshot */);
  });
});

describe('formatPsychologicalProfileForDisplay — populated HEXACO (RU)', () => {
  it('renders Russian section title + qualifier', () => {
    expect(
      formatPsychologicalProfileForDisplay('hexaco', MOCK_PSYCH_PROFILES.hexaco.populated, 'Russian'),
    ).toMatchInlineSnapshot(/* RU snapshot */);
  });
});
```

**Critical fixture coverage per RESEARCH Pitfall 6:** scenario 3 (mixed) MUST include partial-population in Schwartz so the per-dim filter loop's `null` + `confidence === 0` branches are exercised. Without this, the regression detector for D-09 misses the case where a future refactor accidentally renders skipped dims as `"Self-Direction: null"`.

---

## Shared Patterns

### Authentication / Access Control
**Source:** existing `/profile` handler at `src/bot/handlers/profile.ts:607–638`
**Apply to:** file #9 (`profile.ts`) — no new auth surface introduced. User-initiated `/profile` is Telegram-chat-routed; only Greg's `chatId` receives output. Phase 39 inherits without modification (RESEARCH Security Domain §V4).

```typescript
// EXISTING — no change in Phase 39
const chatId = ctx.chat?.id;
if (chatId === undefined) return;
const lang = langOf(getLastUserLanguage(chatId.toString()));
```

### Error Handling (Telegram handler)
**Source:** `src/bot/handlers/profile.ts:628–637`
**Apply to:** file #9 (`profile.ts`) — the existing outer try/catch wraps both the operational reply loop AND the new psych reply loop. Single `genericError` reply path. No per-profile try/catch needed (reader is never-throw, formatter is pure).

```typescript
// EXISTING — Phase 39 keeps this pattern intact
try {
  // ... 4 operational replies + 3 NEW psych replies ...
} catch (err) {
  logger.warn(
    { chatId, error: err instanceof Error ? err.message : String(err) },
    'profile.command.error',
  );
  await ctx.reply(MSG.genericError[lang]);
}
```

### Error Handling (mode handlers)
**Source:** `src/chris/modes/reflect.ts:124–138` (LLMError catch + logger.warn → re-throw)
**Apply to:** files #3 and #4 (mode handlers) — NO change needed. The new `getPsychologicalProfiles` call is never-throw (Phase 37 3-layer defense at `src/memory/profiles.ts:334–390`), and `formatPsychologicalProfilesForPrompt` is pure. The existing outer try/catch around the Sonnet/Opus call continues to cover the LLM path.

### Hard-Rule Footer (single source of truth)
**Source:** `src/memory/psychological-profile-prompt.ts:144` — `PSYCHOLOGICAL_HARD_RULE_EXTENSION` constant
**Apply to:** file #1 (`profiles.ts`) — `formatPsychologicalProfilesForPrompt` IMPORTS this constant verbatim and appends it at the BOTTOM of the rendered block (D-11 recency-bias). DO NOT redeclare. Phase 38's Plan 38-01 structural test asserts each line is verbatim — any phrasing change there propagates here automatically.

```typescript
// File #1 import — single source of truth across inference (Phase 38) + consumer (Phase 39)
import { PSYCHOLOGICAL_HARD_RULE_EXTENSION } from './psychological-profile-prompt.js';
// ... at end of formatter:
return [PSYCH_INJECTION_HEADER, '', sections.join('\n\n'), '', PSYCHOLOGICAL_HARD_RULE_EXTENSION].join('\n');
```

### Localization (MSG map)
**Source:** `src/bot/handlers/profile.ts:111–369` — operational `MSG` localization map (EN/FR/RU)
**Apply to:** file #9 (`profile.ts`) — extend the existing `MSG` object with a new `psychologicalSections` key; REMOVE the existing `m011Placeholder` key (no longer used). Per RESEARCH Pitfall 4 + Assumption A3: machine-translate-quality FR + RU strings shipped from day 1 (operator-reviewed at `/gsd-verify-work`); avoids snapshot churn at v2.6.1.

### Sequential Awaits (Telegram ordering invariant)
**Source:** `src/bot/handlers/profile.ts:623–627` + Phase 35 D-18 rationale
**Apply to:** file #9 (`profile.ts`) — the 3 new `ctx.reply(formatPsychologicalProfileForDisplay(...))` calls MUST be sequential (`for ... of`), NOT `Promise.all`. Telegram does not guarantee message arrival order under concurrent emit; sequential awaits preserve render order.

### Sequential Awaits (mode handlers)
**Source:** `src/chris/modes/reflect.ts:78–79` (operational reader → formatter)
**Apply to:** files #3 and #4 — the new `getPsychologicalProfiles → formatPsychologicalProfilesForPrompt` calls are sequential awaits, NOT `Promise.all` with the operational reader (D-16). Both readers are sub-50ms single-row reads; parallelism deferred to v2.6.1 if profiling reveals real latency.

### Plain-Text-Only (no parse_mode)
**Source:** `src/bot/handlers/profile.ts:14–16` + D-17 + Phase 35 SURF-05
**Apply to:** file #9 (`profile.ts`) — every `ctx.reply(...)` call takes a single string argument. NO `parse_mode: 'Markdown'` / `'HTML'`. Profile values can contain `*` / `_` characters that would corrupt Markdown rendering. Test-locked: golden snapshot pins plain-text output.

### Second-Person Framing
**Source:** `src/bot/handlers/profile.ts:22–26` (D-20 + M010-07 mitigation)
**Apply to:** file #9 (`profile.ts`) — psychological section titles + insufficient-data messages use second-person consistent with operational. (Note: per-dim score lines themselves like `"HEXACO Openness: 4.2 / 5.0"` are framing-neutral and don't need second-person rephrasing.) Golden snapshot (file #10) is the regression detector against future third-person leaks.

---

## No Analog Found

All 10 files have direct in-repo analogs (Phase 35 + Phase 37 + Phase 38 deliverables). No fallback to RESEARCH.md-only patterns is needed.

| File | Status |
|------|--------|
| (none) | Every Phase 39 file has an exact or sibling-in-same-file analog. |

---

## Metadata

**Analog search scope:**
- `src/memory/profiles.ts` (607 lines — operational + psychological reader implementations; PROFILE_INJECTION_MAP, formatProfilesForPrompt, getPsychologicalProfiles, ProfileRow<T>)
- `src/memory/psychological-profile-prompt.ts` (456 lines — Phase 38 inference-side; PSYCHOLOGICAL_HARD_RULE_EXTENSION at :144)
- `src/chris/personality.ts` (268 lines — ChrisContextExtras, buildSystemPrompt body)
- `src/chris/modes/reflect.ts` (139 lines — operational wiring)
- `src/chris/modes/psychology.ts` (141 lines — operational wiring)
- `src/chris/modes/coach.ts` (138 lines — negative-invariant target)
- `src/bot/handlers/profile.ts` (639 lines — handler + formatProfileForDisplay + MSG map)
- `src/bot/handlers/__tests__/profile.golden.test.ts` (633 lines — Phase 35 inline-snapshot exemplar)
- `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` (130 lines — regex-sweep exemplar)
- `src/memory/__tests__/profiles.test.ts` (527 lines — formatter unit-test exemplar)
- `src/chris/__tests__/personality.test.ts` (324 lines — substitution-order test exemplar)

**Files scanned:** 11 source files + 4 test files = 15 total

**Key cross-cutting invariants identified:**
1. Hard-Rule footer is imported (not duplicated) — single source of truth across inference + consumer layers
2. Negative-invariant tests use `readFile` + per-line regex sweep (no module import — survives bytecode-level changes too)
3. Inline-snapshot tests use `vi.setSystemTime` (never `vi.useFakeTimers` — postgres-keepalive break)
4. Sequential awaits in Telegram handlers (concurrent emit breaks message order)
5. Plain-text replies only (no parse_mode — Greg's content contains `*`/`_`)
6. Pre-rendered prompt-side strings in `ChrisContextExtras` (keeps personality.ts ignorant of profile internals)
7. Mode-handler is the PRIMARY gate; template-level filter is belt-and-suspenders

**Pattern extraction date:** 2026-05-14

---

## PATTERN MAPPING COMPLETE

**Phase:** 39 - Psychological Surfaces
**Files classified:** 10
**Analogs found:** 10 / 10

### Coverage
- Files with exact analog: 10
- Files with role-match analog: 0
- Files with no analog: 0

### Key Patterns Identified
- Sibling-in-same-file extension: `PROFILE_INJECTION_MAP` → `PSYCHOLOGICAL_PROFILE_INJECTION_MAP`; `formatProfilesForPrompt` → `formatPsychologicalProfilesForPrompt`; `formatProfileForDisplay` → `formatPsychologicalProfileForDisplay`; `MSG.m011Placeholder` → `MSG.psychologicalSections.*`
- One-field interface extension: `ChrisContextExtras` gains `psychologicalProfiles?: string`; `ProfileRow<T>` gains `wordCount?: number` + `wordCountAtLastRun?: number`
- Symmetric mode-handler wiring: reflect.ts + psychology.ts get identical ~4-line extensions; coach.ts UNCHANGED and guarded by regex-sweep negative-invariant test
- File-read + per-line regex sweep for structural invariants (mirrors Phase 37 D047 boundary audit)
- Inline-snapshot golden test with `vi.setSystemTime` + inline `MOCK_*` fixtures (mirrors Phase 35 SURF-04)
- Hard-Rule footer imported verbatim from Phase 38 (single source of truth across inference + consumer)

### File Created
`.planning/phases/39-psychological-surfaces/39-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog file:line citations + concrete code excerpts in Plan 39-01 (prompt-side: files 1, 2, 3, 4, 5-target, 6, 7, 8) and Plan 39-02 (display-side HARD CO-LOC #M11-3: files 9, 10). The ProfileRow<T> extension (RESEARCH Open Q1) is a Plan 39-01 prerequisite since both Plan 39-01's prompt-side "across N words" framing (D-06) and Plan 39-02's "need N more words" UX (D-19) consume `wordCountAtLastRun`.
