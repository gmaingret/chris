# Phase 38: Psychological Inference Engine — Pattern Map

**Mapped:** 2026-05-14
**Files analyzed:** 13 (8 NEW, 5 MODIFIED)
**Analogs found:** 13 / 13 — every Phase 38 file mirrors a Phase 34 (M010) or Phase 37 (M011 substrate) predecessor
**Critical schema gap:** Plan 38-02 MUST extend `psychological-schemas.ts` v3+v4 schemas with top-level `data_consistency` + `overall_confidence` (Finding 1 — Phase 37 v4 omits these; M010 v4 has them)

## File Classification

| # | File | Status | Role | Data Flow | Closest Analog | Match Quality |
|---|------|--------|------|-----------|----------------|---------------|
| 1 | `src/memory/psychological-profile-prompt.ts` | NEW | prompt assembler | pure function (substrate + prevState + wordCount → `{system, user}`) | `src/memory/profile-prompt.ts` | exact (M010 sibling fork) |
| 2 | `src/memory/__tests__/psychological-profile-prompt.test.ts` | NEW | structural test | pure assert on assembled prompt strings | `src/memory/__tests__/profile-prompt.test.ts` | exact |
| 3 | `src/memory/profiles/psychological-schemas.ts` | MODIFIED — extend with `data_consistency` + `overall_confidence` top-level fields per Finding 1 | schema/config | Zod v3+v4 dual schemas at SDK boundary | `src/memory/profiles/schemas.ts:67,92,116,149,181,236` | exact pattern, currently missing fields |
| 4 | `src/memory/profiles/hexaco.ts` | NEW | inference generator | substrate → flatten config → delegate to runPsychologicalProfileGenerator | `src/memory/profiles/jurisdictional.ts` | exact (mirror × 1) |
| 5 | `src/memory/profiles/schwartz.ts` | NEW | inference generator | substrate → flatten config → delegate to runPsychologicalProfileGenerator | `src/memory/profiles/jurisdictional.ts` | exact (mirror × 2) |
| 6 | `src/memory/profiles/__tests__/hexaco.test.ts` | NEW | unit test | mock Sonnet → verify upsert payload + history-row write + outcome shape | (none — M010 has no per-dim unit test; closest is `psychological-schemas.test.ts` shape) | partial — may fold into integration test |
| 7 | `src/memory/profiles/__tests__/schwartz.test.ts` | NEW | unit test | same as #6 | same | partial |
| 8 | `src/memory/__tests__/psychological-profile-updater.integration.test.ts` | NEW — three-cycle UNCONDITIONAL-FIRE test (inverse of M010's two-cycle hash-skip) | integration test | Docker postgres + mock Sonnet → 3 cycles → assert cumulative 2/4/6 calls | `src/memory/profiles/__tests__/generators.two-cycle.test.ts` | exact structure, INVERSE Cycle 2 assertion |
| 9 | `src/memory/psychological-profile-updater.ts` | NEW | orchestrator | substrate × 2 → Promise.allSettled → discriminated outcome aggregation → void | `src/memory/profile-updater.ts` | exact (2 generators not 4, no hash-skip semantics) |
| 10 | `src/cron-registration.ts` | MODIFIED — add `psychologicalProfileUpdate` status field + `runPsychologicalProfileUpdate` dep + 5th `cron.schedule` block | cron registration | extend interface + register new cron + log scheduled | self (lines 28-29, 47-52, 73, 178-193) | exact pattern extension |
| 11 | `src/config.ts` | MODIFIED — append `psychologicalProfileUpdaterCron` line | config | `validatedCron` env var fail-fast | self (line 87) | exact (1-line addition) |
| 12 | `src/index.ts` | MODIFIED — import orchestrator + wire `runPsychologicalProfileUpdate` dep + add `psychological_profile_cron_registered` /health field | health endpoint + cron wiring | extend imports + extend registerCrons deps + extend /health JSON | self (lines 14, 72, 103) | exact pattern extension |
| 13 | `src/rituals/__tests__/cron-registration.test.ts` | MODIFIED — add 4 tests for 5th cron registration + 12-month Luxon collision-check | structural test | spy on node-cron schedule + assert call args | self (lines 135-206) | exact pattern extension |

---

## Pattern Assignments

### 1. `src/memory/psychological-profile-prompt.ts` (NEW; Plan 38-01)

**Role:** prompt assembler — pure function
**Data flow:** `(profileType, substrate, prevState, wordCount) → {system, user}` — zero side effects
**Analog:** `src/memory/profile-prompt.ts` (252 lines total)

**Imports pattern** (analog lines 41 + 95-110):
```typescript
import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';
// PSYCH version ADDS:
import { DO_NOT_INFER_DIRECTIVE } from './profile-prompt.js';  // D-06 — one source of truth
import type { PsychologicalProfileType } from './profiles/psychological-shared.js';
```

**Public types pattern** (analog lines 51-93):
```typescript
// Analog line 51 — the union that MUST NOT be extended (D-03 fork rationale):
export type ProfilePromptDimension = 'jurisdictional' | 'capital' | 'health' | 'family';

// Analog line 59:
export type AssembledProfilePrompt = { system: string; user: string };

// Analog lines 75-93 — structural substrate view (psych version drops `decisions`,
// adjusts `epistemicTag: string` → `string | null`, replaces `entryCount` with `wordCount`):
export type ProfileSubstrateView = {
  pensieveEntries: ReadonlyArray<{
    id: string;
    epistemicTag: string;
    content: string;
    createdAt: Date;
  }>;
  episodicSummaries: ReadonlyArray<{ summaryDate: string; summary: string }>;
  decisions: ReadonlyArray<{ id: string; resolvedAt: Date; question: string; resolution: string }>;
  entryCount: number;
};
```

**DO_NOT_INFER_DIRECTIVE constant** (analog lines 107-110) — imported verbatim:
```typescript
export const DO_NOT_INFER_DIRECTIVE = [
  '## Hallucination Floor (MANDATORY)',
  'Do not infer facts from related-but-distinct entries. ...',
].join('\n');
```

**Per-dimension directive Record pattern** (analog lines 124-141):
```typescript
const DIMENSION_DIRECTIVES: Record<ProfilePromptDimension, string> = {
  jurisdictional: ['## Dimension Focus — Jurisdictional', '...'].join('\n'),
  capital: ['## Dimension Focus — Capital', '...'].join('\n'),
  health: ['## Dimension Focus — Health', '...'].join('\n'),
  family: ['## Dimension Focus — Family', '...'].join('\n'),
};
```

**Assembler body pattern — 8 sections in fixed order** (analog lines 175-223):
```typescript
export function assembleProfilePrompt(
  dimension: ProfilePromptDimension,
  substrate: ProfileSubstrateView,
  prevState: unknown | null,
  entryCount: number,
): AssembledProfilePrompt {
  const sections: string[] = [];
  sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());        // 1. CONSTITUTIONAL_PREAMBLE first
  sections.push(buildRolePreamble(dimension));             // 2. Role preamble
  sections.push(DO_NOT_INFER_DIRECTIVE);                   // 3. DO_NOT_INFER_DIRECTIVE
  sections.push(buildVolumeWeightCeilingDirective(entryCount)); // 4. CEILING — REPLACE for psych
  if (prevState !== null) {
    sections.push(buildPreviousStateBlock(prevState));     // 5. Previous state (conditional)
  }
  sections.push(DIMENSION_DIRECTIVES[dimension]);          // 6. Per-dimension directive
  sections.push(buildSubstrateBlock(substrate));           // 7. Substrate block
  sections.push(buildStructuredOutputDirective(dimension)); // 8. Output directive last
  return {
    system: sections.join('\n\n'),
    user: `Generate the operational profile for ${dimension}.`,
  };
}
```

**Previous-state block pattern** (analog lines 294-303) — reuse verbatim with adjusted phrasing per D-09:
```typescript
function buildPreviousStateBlock(prevState: unknown): string {
  return [
    '## CURRENT PROFILE STATE',
    'The current operational profile (from the most recent successful fire) is shown below as JSON. Use this as the baseline.',
    '',
    JSON.stringify(prevState, null, 2),
    '',
    'Update discipline: ...',  // Adjust phrasing per D-09 for slow-moving-trait domain
  ].join('\n');
}
```

**Substrate block pattern** (analog lines 305-349) — adapt: drop `decisions` section, render `corpus` + `episodicSummaries` + `wordCount` only:
```typescript
function buildSubstrateBlock(substrate: ProfileSubstrateView): string {
  const lines: string[] = ['## SUBSTRATE'];
  lines.push('');
  lines.push(`### Pensieve entries (${substrate.pensieveEntries.length})`);
  for (const entry of substrate.pensieveEntries) {
    const date = entry.createdAt.toISOString().slice(0, 10);
    const truncated = entry.content.length > 200 ? entry.content.slice(0, 197) + '...' : entry.content;
    lines.push(`- ${date} [${entry.epistemicTag}] ${truncated}`);
  }
  // ... episodic summaries
  // PSYCH OMITS: ### Resolved decisions (no decisions array)
  return lines.join('\n');
}
```

**Divergences for psychological version:**
1. **File location:** `src/memory/psychological-profile-prompt.ts` (NOT under `profiles/`) — exact mirror of M010 `src/memory/profile-prompt.ts` sibling-level placement (D-04)
2. **Public union:** `PsychologicalProfilePromptType = 'hexaco' | 'schwartz'` (NOT `'jurisdictional'|'capital'|'health'|'family'`); attachment deferred per D-23
3. **DO_NOT_INFER_DIRECTIVE:** IMPORT from `./profile-prompt.js` rather than redeclare (D-06 — one source of truth; D047 boundary still passes because the directive is profile-type-agnostic)
4. **NEW constant `PSYCHOLOGICAL_HARD_RULE_EXTENSION`** (D-07 — locked verbatim phrasing) — inline string constant, not in `personality.ts`. Phase 39 PSURF-02 re-uses this same constant by import. Must appear in BOTH profile-type assembled outputs.
5. **Section 4 — REPLACE `buildVolumeWeightCeilingDirective(entryCount)` with `buildWordCountFraming(wordCount)`** per D-08. Tells Sonnet: "Report `data_consistency` in 0-1; the host code reads this as a combined volume + consistency signal — do NOT emit a `confidence` field directly." Substrate block preamble mentions the actual wordCount (e.g. "6,247 words of Greg's first-person Telegram speech from the previous calendar month").
6. **Profile-type directive Record** (replaces `DIMENSION_DIRECTIVES`) — `PROFILE_TYPE_DIRECTIVES: Record<'hexaco' | 'schwartz', string>` per D-10. HEXACO directive emphasizes cross-dimension coherence (6 dims as one framework). Schwartz directive emphasizes circumplex structure (Self-Direction ↔ Conformity opposing-value tradeoffs). BOTH include the empirical-limits framing "r ≈ .31–.41".
7. **Substrate block — DROP `decisions` section** (M011 substrate is corpus-only per `psychological-shared.ts:36-37`); render `corpus` + `episodicSummaries` + `wordCount` only.
8. **Role preamble:** psychological-trait-inference framing (different task, different discipline language than operational fact-extraction).
9. **NEW section between 3 and 4:** `PSYCHOLOGICAL_HARD_RULE_EXTENSION` injection. Section order becomes (1) CONSTITUTIONAL_PREAMBLE → (2) role preamble → (3) DO_NOT_INFER_DIRECTIVE → (4) PSYCHOLOGICAL_HARD_RULE_EXTENSION → (5) word-count framing → (6) prev state conditional → (7) profile-type directive → (8) substrate block → (9) structured-output directive.

---

### 2. `src/memory/__tests__/psychological-profile-prompt.test.ts` (NEW; Plan 38-01)

**Role:** structural test — pure (no DB, no LLM, no mocks)
**Data flow:** call assembler with fixture → grep system string for anchor substrings
**Analog:** `src/memory/__tests__/profile-prompt.test.ts`

**Imports pattern** (analog lines 21-29):
```typescript
import { describe, it, expect } from 'vitest';
import { CONSTITUTIONAL_PREAMBLE } from '../../chris/personality.js';
import {
  assembleProfilePrompt,
  DO_NOT_INFER_DIRECTIVE,
  type ProfilePromptDimension,
  type ProfileSubstrateView,
  type AssembledProfilePrompt,
} from '../profile-prompt.js';
```

**Parametrized describe-each pattern** (analog lines 33-38, 114):
```typescript
const DIMENSIONS: readonly ProfilePromptDimension[] = [
  'jurisdictional', 'capital', 'health', 'family',
] as const;

describe.each(DIMENSIONS)('dimension=%s', (dimension) => {
  it('CONSTITUTIONAL_PREAMBLE first — system starts with "## Core Principles (Always Active)" (D-04, M010-06)', () => {
    const result: AssembledProfilePrompt = assembleProfilePrompt(dimension, buildFixture(), null, 15);
    expect(result.system.startsWith('## Core Principles (Always Active)')).toBe(true);
  });
});
```

**Sentinel test pattern** (analog lines 101-111):
```typescript
it('sentinel — CONSTITUTIONAL_PREAMBLE imported from personality starts with the M010-06 anchor', () => {
  expect(CONSTITUTIONAL_PREAMBLE.startsWith('## Core Principles (Always Active)')).toBe(true);
});

it('sentinel — DO_NOT_INFER_DIRECTIVE constant is exported and contains "do not infer" (M010-02)', () => {
  expect(typeof DO_NOT_INFER_DIRECTIVE).toBe('string');
  expect(DO_NOT_INFER_DIRECTIVE.toLowerCase()).toContain('do not infer');
});
```

**Fixture builder pattern** (analog lines 49-91):
```typescript
function buildFixture(overrides?: Partial<ProfileSubstrateView>): ProfileSubstrateView {
  return {
    pensieveEntries: [
      { id: 'p1', epistemicTag: 'FACT', content: '...', createdAt: new Date('...') },
      // ...
    ],
    episodicSummaries: [{ summaryDate: '2026-04-15', summary: '...' }],
    decisions: [{ id: 'd1', resolvedAt: new Date('...'), question: '...', resolution: '...' }],
    entryCount: 15,
    ...overrides,
  };
}
```

**Divergences for psychological version:**
1. **Parametrize over `['hexaco', 'schwartz']`** (2-way, not 4-way).
2. **Fixture shape:** `PsychologicalProfileSubstrateView` — `corpus` + `episodicSummaries` + `wordCount` (no decisions). Fixture default `wordCount: 6000` (above 5,000 floor).
3. **Extra assertions per RESEARCH lines 537-547:**
   - `system.includes(PSYCHOLOGICAL_HARD_RULE_EXTENSION)` — present for both profile types (D-07)
   - `system.includes('## Psychological Profile Framing (D027 extension — REQUIRED)')` — Hard Rule extension header anchor
   - `system.includes('## Profile Focus — HEXACO')` for hexaco; `system.includes('## Profile Focus — Schwartz')` for schwartz
   - `system.includes('r ≈ .31–.41')` — empirical-limits framing anchor (D-10)
   - `system.includes('data_consistency')` — host-emit contract anchor (D-08)
   - `prevState=null` → `!system.includes('## CURRENT PROFILE STATE')`
   - `prevState!=null` → `system.includes('## CURRENT PROFILE STATE')` AND `system.includes(JSON.stringify(prevState, null, 2))`
   - `result.user === 'Generate the HEXACO psychological profile for Greg.'` (or `SCHWARTZ`)
4. **Sentinel test:** add `it('sentinel — PSYCHOLOGICAL_HARD_RULE_EXTENSION contains the D027 anchor', () => { expect(PSYCHOLOGICAL_HARD_RULE_EXTENSION).toContain('D027 extension'); });`

---

### 3. `src/memory/profiles/psychological-schemas.ts` (MODIFIED; Plan 38-02 — Finding 1 critical extension)

**Role:** schema/config — Zod v3+v4 dual schemas
**Data flow:** module-level constants consumed by generators (v4 at SDK boundary, v3 at re-validate)
**Analog:** `src/memory/profiles/schemas.ts` (M010 operational schemas)

**CRITICAL GAP — current Phase 37 v4 schemas LACK top-level `data_consistency` + `overall_confidence`:**

Current state at `src/memory/profiles/psychological-schemas.ts:93-100`:
```typescript
export const HexacoProfileSchemaV4 = zV4.object({
  honesty_humility: hexacoSchwartzDimensionSchemaV4,
  emotionality: hexacoSchwartzDimensionSchemaV4,
  extraversion: hexacoSchwartzDimensionSchemaV4,
  agreeableness: hexacoSchwartzDimensionSchemaV4,
  conscientiousness: hexacoSchwartzDimensionSchemaV4,
  openness: hexacoSchwartzDimensionSchemaV4,
});
// ↑ NO data_consistency, NO overall_confidence
```

M010 reference at `src/memory/profiles/schemas.ts:67` (and lines 92, 116, 149, 181, 236):
```typescript
export const JurisdictionalProfileSchemaV4 = zV4.object({
  // ... per-field properties ...
  data_consistency: zV4.number().min(0).max(1),   // ← REQUIRED top-level — host stores Sonnet-emitted value
});
```

**Required Plan 38-02 modification** (add boundary variants — leave originals untouched per Phase 37 invariant):
```typescript
// NEW — append to psychological-schemas.ts after line 131
// SDK-boundary v4 schemas: extend Phase 37 base v4 with the top-level meta fields
// Sonnet must emit per D-08/PGEN-07. The base v4 schemas at lines 93-100/120-131
// stay UNTOUCHED (they describe the row-level jsonb shape used by Phase 39 readers).

export const HexacoProfileSchemaV4Boundary = HexacoProfileSchemaV4.extend({
  data_consistency: zV4.number().min(0).max(1),
  overall_confidence: zV4.number().min(0).max(1),
});

export const SchwartzProfileSchemaV4Boundary = SchwartzProfileSchemaV4.extend({
  data_consistency: zV4.number().min(0).max(1),
  overall_confidence: zV4.number().min(0).max(1),
});

// Matching v3 boundary variants (for v3 re-validate at runtime per M008/M009 discipline):
export const HexacoProfileSchemaV3Boundary = HexacoProfileSchemaV3.extend({
  data_consistency: z.number().min(0).max(1),
  overall_confidence: z.number().min(0).max(1),
}).strict();

export const SchwartzProfileSchemaV3Boundary = SchwartzProfileSchemaV3.extend({
  data_consistency: z.number().min(0).max(1),
  overall_confidence: z.number().min(0).max(1),
}).strict();

export type HexacoProfileDataBoundary = z.infer<typeof HexacoProfileSchemaV3Boundary>;
export type SchwartzProfileDataBoundary = z.infer<typeof SchwartzProfileSchemaV3Boundary>;
```

**Divergences from M010:**
1. **Two-tier schema design (Phase 38 unique):** keep Phase 37 base schemas (`HexacoProfileSchemaV4`) for row-level shape; add `*Boundary` variants for SDK-boundary use. M010 has a single schema per dimension with `data_consistency` baked in at the top level (lines 67, 92, 116, 181, 236).
2. **`overall_confidence` field NEW vs M010:** M010 host-computes `confidence = computeProfileConfidence(entryCount, data_consistency)`. M011 Sonnet emits `overall_confidence` verbatim and host stores it without recomputation per D-08.
3. **NO `.refine()` ceiling:** M010 wraps the v4 in `.refine()` for `data_consistency <= 0.5 when entryCount < 20` at `shared.ts:417-420`. Phase 38 DROPS this per D-33 — 5,000-word floor at `psychological-shared.ts:200` is the upstream gate.

**Decision point for planner:** also resolve the `last_updated` per-dim handling (Pitfall 7). Phase 37 v4 has `last_updated: zV4.string()` (NOT `.datetime()`) at line 56; v3 has `.datetime()`. Either (a) host-inject `last_updated: new Date().toISOString()` after v4 parse but before v3 re-validate, OR (b) tighten v4 to `.datetime()`. RESEARCH Pitfall 7 recommends (a).

---

### 4. `src/memory/profiles/hexaco.ts` (NEW; Plan 38-02)

**Role:** inference generator — substrate → flatten config → delegate
**Data flow:** `deps.substrate` (PsychologicalSubstrate<HexacoProfileData>) → `runPsychologicalProfileGenerator(HEXACO_PROFILE_CONFIG, substrate)` → discriminated outcome
**Analog:** `src/memory/profiles/jurisdictional.ts` (91 lines total — the minimal-dispatch pattern)

**Imports pattern** (analog lines 23-35):
```typescript
import {
  JurisdictionalProfileSchemaV3,
  JurisdictionalProfileSchemaV4,
  type JurisdictionalProfileData,
} from './schemas.js';
import { profileJurisdictional } from '../../db/schema.js';
import {
  runProfileGenerator,
  stripMetadataColumns,
  type ProfileGeneratorConfig,
  type ProfileGenerationOutcome,
  type ProfileSubstrate,
} from './shared.js';
```

**Flatten helper pattern** (analog lines 41-54):
```typescript
function flattenJurisdictionalOutput(parsed: JurisdictionalProfileData): Record<string, unknown> {
  return {
    currentCountry: parsed.current_country,
    physicalLocation: parsed.physical_location,
    residencyStatus: parsed.residency_status,
    taxResidency: parsed.tax_residency,
    activeLegalEntities: parsed.active_legal_entities,
    nextPlannedMove: parsed.next_planned_move,
    plannedMoveDate: parsed.planned_move_date,
    passportCitizenships: parsed.passport_citizenships,
  };
}
```

**Config object pattern** (analog lines 69-77):
```typescript
const JURISDICTIONAL_PROFILE_CONFIG: ProfileGeneratorConfig<JurisdictionalProfileData> = {
  dimension: 'jurisdictional',
  v3Schema: JurisdictionalProfileSchemaV3,
  v4Schema: JurisdictionalProfileSchemaV4,
  table: profileJurisdictional,
  profileTableName: 'profile_jurisdictional',
  flattenSonnetOutput: flattenJurisdictionalOutput,
  extractPrevState: extractJurisdictionalPrevState,
};
```

**Dispatcher pattern** (analog lines 84-88):
```typescript
export async function generateJurisdictionalProfile(
  deps: { substrate: ProfileSubstrate },
): Promise<ProfileGenerationOutcome> {
  return runProfileGenerator(JURISDICTIONAL_PROFILE_CONFIG, deps.substrate);
}

export { JURISDICTIONAL_PROFILE_CONFIG };
```

**Divergences for hexaco.ts (4 specific changes per RESEARCH Finding 3 + 4):**
1. **Discriminated-union narrow** — substrate is `PsychologicalSubstrate<HexacoProfileData>` (Phase 37 type). Body branches on `substrate.belowThreshold` discriminator, NOT `isAboveThreshold(entryCount)`. RESEARCH Finding 4:
   ```typescript
   if (substrate.belowThreshold) {
     logger.info(
       { profileType, wordCount: substrate.wordCount, neededWords: substrate.neededWords, threshold: MIN_SPEECH_WORDS },
       `chris.psychological.${profileType}.skipped_below_threshold`,
     );
     return { profileType, outcome: 'skipped_below_threshold', wordCount: substrate.wordCount, durationMs: Date.now() - startMs };
   }
   // After this point, TypeScript narrows substrate to belowThreshold:false branch
   ```
2. **DELETE hash-skip branch** — M010 `shared.ts:399-409` (the `if (currentRow && currentRow.substrateHash === computedHash) return skip` block) is REMOVED from `runPsychologicalProfileGenerator`. Hash is still computed and stored (`substrate_hash` column), but never short-circuits. UNCONDITIONAL FIRE per PGEN-06. This is **the single most important divergence**.
3. **DROP `.refine()` volume-weight ceiling** — M010 `shared.ts:417-420` is REMOVED. Per D-33, use `HexacoProfileSchemaV4Boundary` directly (no `.refine()` wrapper). The 5,000-word floor at `loadPsychologicalSubstrate` is the only confidence cap.
4. **Sonnet emits `data_consistency` AND `overall_confidence`** — host stores both verbatim (no `computeProfileConfidence` call):
   ```typescript
   // Step 9-10 of runPsychologicalProfileGenerator (replaces M010 host-side compute):
   const sonnetOut = config.v3SchemaBoundary.parse(response.parsed_output);
   const upsertValues = {
     // ...
     substrateHash: computedHash,                    // recorded — NOT used for skip (PGEN-06)
     overallConfidence: sonnetOut.overall_confidence, // host stores Sonnet-emitted value verbatim per D-08
     wordCount: substrate.wordCount,
     wordCountAtLastRun: substrate.wordCount,        // PSCH-08 metadata column
     ...flatEncoded,
     lastUpdated: new Date(),
   };
   ```
5. **No `extractPrevState`** in the config (per RESEARCH line 316): D-19 says prevState comes from `loadPsychologicalSubstrate.prevHistorySnapshot` (a `profile_history` row), not from reading the current `profile_hexaco` row. Generator threads `substrate.prevHistorySnapshot` directly into `assemblePsychologicalProfilePrompt`.
6. **Config object shape:** `PsychologicalProfileGeneratorConfig<HexacoProfileData>` with `profileType: 'hexaco' | 'schwartz'` (not `dimension`), `v3SchemaBoundary`, `v4SchemaBoundary` (the extended variants from Plan 38-02 schema modification).
7. **Flatten helper** maps 6 HEXACO snake_case → camelCase: `honesty_humility → honestyHumility`, `emotionality`, `extraversion`, `agreeableness`, `conscientiousness`, `openness`.

**Sonnet call pattern** (analog `shared.ts:457-480` — mirror VERBATIM with schema swap):
```typescript
const response = await anthropic.messages.parse({
  model: SONNET_MODEL,                                                       // claude-sonnet-4-6 from config
  max_tokens: 4000,                                                          // larger than M010's 2000 — psych has 6+10 dims
  system: [{ type: 'text' as const, text: prompt.system, cache_control: { type: 'ephemeral' as const } }],
  messages: [{ role: 'user' as const, content: prompt.user }],
  output_config: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    format: zodOutputFormat(config.v4SchemaBoundary as unknown as any),     // boundary variant per Finding 1
  },
});
if (response.parsed_output === null || response.parsed_output === undefined) {
  throw new Error(`${config.profileType}.psychological.sonnet: parsed_output is null`);
}
```

**Write-before-upsert pattern** (analog `shared.ts:495-501` — mirror VERBATIM, swap table name):
```typescript
if (currentRow && currentRow.id) {
  await db.insert(profileHistory).values({
    profileTableName: 'profile_hexaco',                                      // or 'profile_schwartz'
    profileId: currentRow.id as string,
    snapshot: currentRow as Record<string, unknown>,
  });
}
```

**Upsert pattern** (analog `shared.ts:514-539` — mirror VERBATIM with jsonb-cast `sql\`...::jsonb\`` encoding; Phase 37 tables use same `notNull().default(sql\`'null'::jsonb\`)` convention per `src/db/schema.ts:672-677`).

---

### 5. `src/memory/profiles/schwartz.ts` (NEW; Plan 38-02)

**Role:** inference generator (mirror of hexaco.ts × 2)
**Data flow:** identical to hexaco.ts
**Analog:** `src/memory/profiles/jurisdictional.ts` (same template)

**Divergences from hexaco.ts (the only per-file variance):**
1. **`SCHWARTZ_PROFILE_CONFIG`** with `profileType: 'schwartz'`, `v3SchemaBoundary: SchwartzProfileSchemaV3Boundary`, `v4SchemaBoundary: SchwartzProfileSchemaV4Boundary`, `table: profileSchwartz`, `profileTableName: 'profile_schwartz'`.
2. **`flattenSchwartzOutput`** maps 10 Schwartz snake_case → camelCase: `self_direction → selfDirection`, `stimulation`, `hedonism`, `achievement`, `power`, `security`, `conformity`, `tradition`, `benevolence`, `universalism`.
3. **Export:** `generateSchwartzProfile` + `SCHWARTZ_PROFILE_CONFIG`.

**Optional helper extraction (Claude's discretion per D-11/D-12):** with only 2 files (vs M010's 4), extraction of `runPsychologicalProfileGenerator(config, substrate)` into `psychological-shared.ts` may be premature. Planner decides. If extracted: same shape as `runProfileGenerator` at `shared.ts:363-565` with 4 divergences listed above + Finding 2 (export `PROFILE_TYPE_TO_TABLE_NAME` from `psychological-shared.ts` so generators can import it for `profile_history` writes) + Finding 3 (separate `computePsychologicalSubstrateHash` without `decisionIds`).

---

### 6 & 7. `src/memory/profiles/__tests__/{hexaco,schwartz}.test.ts` (NEW; Plan 38-02)

**Role:** unit test (mocked Sonnet) — verify upsert payload + history-row write + outcome shape
**Data flow:** mock substrate (above-threshold branch) + mock `anthropic.messages.parse` → call `generate{Hexaco,Schwartz}Profile` → assert DB writes + outcome
**Analog:** `src/memory/profiles/__tests__/generators.two-cycle.test.ts` (structure — single-cycle subset) — there is no per-dimension M010 unit test (M010 collapsed into the two-cycle integration test).

**Hoisted mock pattern** (analog lines 50-79):
```typescript
const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));
vi.mock('../../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../llm/client.js')>();
  return { ...orig, anthropic: { messages: { parse: mockAnthropicParse, create: vi.fn() } } };
});
vi.mock('../../../utils/logger.js', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError, debug: vi.fn() },
}));
```

**Mock response pattern** (analog lines 114-128):
```typescript
function validHexacoResponse() {
  return {
    parsed_output: {
      honesty_humility: { score: 4.2, confidence: 0.6, last_updated: '2026-05-01T09:00:00Z' },
      emotionality: { score: 3.1, confidence: 0.5, last_updated: '2026-05-01T09:00:00Z' },
      extraversion: { score: 3.8, confidence: 0.5, last_updated: '2026-05-01T09:00:00Z' },
      agreeableness: { score: 4.0, confidence: 0.6, last_updated: '2026-05-01T09:00:00Z' },
      conscientiousness: { score: 4.5, confidence: 0.5, last_updated: '2026-05-01T09:00:00Z' },
      openness: { score: 4.3, confidence: 0.7, last_updated: '2026-05-01T09:00:00Z' },
      data_consistency: 0.55,        // Sonnet-emitted (D-08)
      overall_confidence: 0.6,       // Sonnet-emitted (D-08) — host stores verbatim
    },
  };
}
```

**Cleanup pattern** (analog lines 100-108):
```typescript
async function cleanupAll() {
  await db.delete(profileHistory);
  await db.execute(sql`TRUNCATE TABLE pensieve_entries CASCADE`);
  await db.execute(sql`TRUNCATE TABLE episodic_summaries CASCADE`);
  // PSYCH OMITS: decision_events + decisions truncates (M011 substrate is corpus-only)
  // PSYCH ADDS: profile_hexaco / profile_schwartz reset to seed state (do not TRUNCATE — preserve seed row)
}
```

**Divergences for psychological version:**
1. **Single-cycle assertion** (NOT 3-cycle — that's the integration test #8): mock above-threshold substrate, call `generateHexacoProfile`, assert outcome is `{outcome: 'updated', profileType: 'hexaco', overallConfidence: 0.6, wordCount: 6000, durationMs: number}`.
2. **DB assertions:** `profile_hexaco` row's `substrate_hash` is 64-char hex, `overall_confidence === 0.6`, `word_count_at_last_run === 6000`. `profile_history` has 1 new row with `profileTableName === 'profile_hexaco'`.
3. **No `decisions` cleanup** — M011 substrate is corpus-only.
4. **Below-threshold test:** with `substrate = { belowThreshold: true, wordCount: 3000, neededWords: 2000 }`, assert outcome `{outcome: 'skipped_below_threshold', ...}`, NO Sonnet call, NO history row write.
5. **Test name and structure:** `describe('generateHexacoProfile')` with two `it` blocks: (a) "updated outcome on above-threshold substrate + emits chris.psychological.hexaco.updated log", (b) "skipped_below_threshold outcome on below-threshold substrate + emits chris.psychological.hexaco.skipped_below_threshold log".

**Decision point for planner (Claude's discretion per RESEARCH line 155):** the planner may fold these unit tests INTO the integration test #8 to avoid duplication. RESEARCH recommends separate unit test "mirrors `src/memory/__tests__/profile-prompt.test.ts` pattern from M010" — but M010 has no per-dimension unit test. The pattern is partial.

---

### 8. `src/memory/__tests__/psychological-profile-updater.integration.test.ts` (NEW; Plan 38-02)

**Role:** integration test — 3-cycle UNCONDITIONAL-FIRE verification (PMT-05 precursor)
**Data flow:** real Docker postgres + mocked `anthropic.messages.parse` → 3 sequential cycles → assert cumulative Sonnet call count
**Analog:** `src/memory/profiles/__tests__/generators.two-cycle.test.ts` — structure mirrored, **Cycle 2 assertion INVERTED**

**Docblock pattern** (analog lines 1-46) — adapt with explicit D-35 inversion comment:
```typescript
/**
 * src/memory/__tests__/psychological-profile-updater.integration.test.ts — Phase 38 Plan 02
 *
 * HARD CO-LOC #M11-2 — this test ships in Plan 38-02 ALONGSIDE the generators + orchestrator.
 *
 * CRITICAL: This test is the INVERSE of M010's PTEST-03 idempotency test
 * (src/memory/profiles/__tests__/generators.two-cycle.test.ts).
 * M010 PTEST-03 asserts hash-skip behavior (cumulative 4 calls after Cycle 2
 * with identical substrate). M011 PMT-05 asserts UNCONDITIONAL FIRE (cumulative
 * 4 calls after Cycle 2 — same number but different semantics). If a future
 * refactor introduces hash-skip "for consistency with M010", this test fails.
 * Do NOT "fix" the test — the divergence is intentional per PGEN-06.
 */
```

**Hoisted mock pattern** (analog lines 50-79) — identical mock surface.

**Mock routing pattern** (analog lines 187-205) — adapt for 2 profile types via `system` text inspection:
```typescript
function primeAllProfileTypesValid() {
  mockAnthropicParse.mockImplementation((req: { system?: Array<{ text: string }> }) => {
    const systemText = req.system?.[0]?.text ?? '';
    if (systemText.includes('## Profile Focus — HEXACO')) {
      return Promise.resolve(validHexacoResponse());
    }
    if (systemText.includes('## Profile Focus — Schwartz')) {
      return Promise.resolve(validSchwartzResponse());
    }
    throw new Error(`primeAllProfileTypesValid: unrecognized profile focus in prompt. First 200 chars: ${systemText.slice(0, 200)}`);
  });
}
```

**3-cycle structure pattern** (analog lines 226-352):
```typescript
it('Cycle 1 → 2 calls + 2 history rows; Cycle 2 (identical) → cumulative 4 calls (NOT 2); Cycle 3 (INSERT) → cumulative 6 calls', async () => {
  // ── CYCLE 1 ────────────────────────────────────────────────────────────
  // Seed 6,000 telegram words across 30 days of April 2026
  await seedTelegramCorpus({ words: 6000, days: 30, monthStart: '2026-04-01', source: 'telegram' });
  primeAllProfileTypesValid();
  // NOW pinned to 2026-05-01 09:00 Paris (1st of May; reads April substrate)
  await updateAllPsychologicalProfiles();

  expect(mockAnthropicParse).toHaveBeenCalledTimes(2);    // 1 HEXACO + 1 Schwartz
  const hexacoRow = (await db.select().from(profileHexaco).limit(1))[0];
  expect(hexacoRow.overallConfidence).toBeGreaterThan(0);
  expect(hexacoRow.substrateHash).toMatch(/^[0-9a-f]{64}$/);
  const historyC1 = await db.select().from(profileHistory)
    .where(or(eq(profileHistory.profileTableName, 'profile_hexaco'), eq(profileHistory.profileTableName, 'profile_schwartz')));
  expect(historyC1).toHaveLength(2);

  // ── CYCLE 2 (IDENTICAL substrate — INVERSE-OF-IDEMPOTENCY ASSERTION) ───
  // Re-seed identical corpus into May 2026 window (so loadPsychologicalSubstrate
  // at NOW=2026-06-01 reads the same wordCount + same content per Pitfall 5)
  await seedTelegramCorpus({ words: 6000, days: 30, monthStart: '2026-05-01', source: 'telegram' });
  primeAllProfileTypesValid();  // re-prime (prior mocks consumed)
  // NOW pinned to 2026-06-01 09:00 Paris
  await updateAllPsychologicalProfiles();

  // CRITICAL — UNCONDITIONAL FIRE
  expect(mockAnthropicParse).toHaveBeenCalledTimes(4);   // ← NOT 2 — UNCONDITIONAL FIRE per PGEN-06
  const historyC2 = await db.select().from(profileHistory).where(...);
  expect(historyC2).toHaveLength(4);

  // ── CYCLE 3 (MUTATED substrate) ────────────────────────────────────────
  await seedTelegramCorpus({ words: 6000, days: 30, monthStart: '2026-06-01', additionalEntries: 5 });
  primeAllProfileTypesValid();
  // NOW pinned to 2026-07-01 09:00 Paris
  await updateAllPsychologicalProfiles();

  expect(mockAnthropicParse).toHaveBeenCalledTimes(6);
  const historyC3 = await db.select().from(profileHistory).where(...);
  expect(historyC3).toHaveLength(6);
});
```

**Divergences from M010 two-cycle test:**
1. **Inverse-of-idempotency Cycle 2 assertion:** `expect(mockAnthropicParse).toHaveBeenCalledTimes(4)` NOT 2. This is the entire reason the test exists.
2. **THREE cycles, not two:** C1 populate (2 calls) → C2 identical substrate (cumulative 4) → C3 mutated substrate (cumulative 6).
3. **Two profile types, not four:** mock 2 responses per cycle (HEXACO + Schwartz). No `decisions` table cleanup. No `profileCapital`/`profileHealth`/`profileFamily` reads.
4. **Pinned `now` per cycle** (no `vi.useFakeTimers` per analog comment lines 14-19) — pass explicit `now` to `loadPsychologicalSubstrate` or anchor via `process.env.TZ=Europe/Paris` + `Date.now` stub. Phase 37's substrate loader accepts `now: Date = new Date()` arg.
5. **Fixture re-seed per cycle** (Pitfall 5 mitigation): each cycle's substrate window (previous calendar month from NOW) must contain the seeded corpus. Re-seed identical entries into the relevant month window for C1/C2; insert mutated entries for C3.
6. **Bonus 4th `it` block per RESEARCH line 782:** `Promise.allSettled` isolation — one generator throws (HEXACO Sonnet mock rejects); assert Schwartz still completes with `outcome: 'updated'` and HEXACO's outcome is `'error'` (per PGEN-04).

---

### 9. `src/memory/psychological-profile-updater.ts` (NEW; Plan 38-03)

**Role:** orchestrator — fire 2 generators concurrently
**Data flow:** load substrate × 2 (per profile type) → `Promise.allSettled([generateHexacoProfile, generateSchwartzProfile])` → aggregate outcome counts → log → return void
**Analog:** `src/memory/profile-updater.ts` (142 lines total)

**Imports pattern** (analog lines 46-52):
```typescript
import { logger } from '../utils/logger.js';
import { loadProfileSubstrate } from './profiles/shared.js';
import { generateJurisdictionalProfile } from './profiles/jurisdictional.js';
import { generateCapitalProfile } from './profiles/capital.js';
import { generateHealthProfile } from './profiles/health.js';
import { generateFamilyProfile } from './profiles/family.js';
import type { ProfileGenerationOutcome } from './profiles/shared.js';
```

**Orchestrator body pattern** (analog lines 64-142):
```typescript
export async function updateAllOperationalProfiles(): Promise<void> {
  const startMs = Date.now();
  try {
    // 1. Load substrate ONCE (D-14)
    const substrate = await loadProfileSubstrate();

    logger.info(
      { entryCount: substrate.entryCount, episodicCount: substrate.episodicSummaries.length, decisionCount: substrate.decisions.length },
      'chris.profile.cron.start',
    );

    // 2. Promise.allSettled fan-out
    const results = await Promise.allSettled([
      generateJurisdictionalProfile({ substrate }),
      generateCapitalProfile({ substrate }),
      generateHealthProfile({ substrate }),
      generateFamilyProfile({ substrate }),
    ]);

    // 3. Discriminated outcome aggregation
    const counts = { updated: 0, skipped: 0, belowThreshold: 0, failed: 0 };
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const o: ProfileGenerationOutcome = r.value;
        switch (o.outcome) {
          case 'profile_updated': counts.updated += 1; break;
          case 'profile_skipped_no_change': counts.skipped += 1; break;
          case 'profile_below_threshold': counts.belowThreshold += 1; break;
          case 'profile_generation_failed': counts.failed += 1; break;
        }
      } else {
        logger.warn(
          { err: r.reason instanceof Error ? r.reason.message : String(r.reason) },
          'chris.profile.profile_generation_failed',
        );
        counts.failed += 1;
      }
    }

    logger.info({ counts, durationMs: Date.now() - startMs }, 'chris.profile.cron.complete');
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), durationMs: Date.now() - startMs },
      'profile.cron.error',
    );
  }
}
```

**Divergences for psychological version (6 specific changes per RESEARCH line 343):**
1. **INSERT D-18 unconditional-fire rationale comment** at the top of the function body BEFORE substrate load — phrasing locked in D-18 (planner may polish):
   ```typescript
   // Divergence from M010 GEN-07 (operational profile-updater.ts): psychological
   // profiles fire UNCONDITIONALLY on the monthly cron. A skipped month creates
   // a permanent gap in the inter-period consistency time series; trait inference
   // needs a data point every month. substrate_hash is recorded on each fire for
   // audit-trail / forensic-replay only — NOT used for short-circuit.
   ```
2. **Substrate loaded TWICE per fire (D-24)** — one per profile type for the per-type `prevHistorySnapshot`:
   ```typescript
   const now = new Date();
   const [hexacoSubstrate, schwartzSubstrate] = await Promise.all([
     loadPsychologicalSubstrate('hexaco', now),
     loadPsychologicalSubstrate('schwartz', now),
   ]);
   ```
3. **`Promise.allSettled` array is length-2 not length-4** — HEXACO + Schwartz only; attachment EXCLUDED per D-23 + PGEN-04:
   ```typescript
   const results = await Promise.allSettled([
     generateHexacoProfile({ substrate: hexacoSubstrate }),
     generateSchwartzProfile({ substrate: schwartzSubstrate }),
   ]);
   ```
4. **3 outcome cases, not 4** — no `skipped_no_change` because no hash-skip per PGEN-06:
   ```typescript
   const counts = { updated: 0, belowThreshold: 0, error: 0 };
   for (const r of results) {
     if (r.status === 'fulfilled') {
       const o: PsychologicalProfileGenerationOutcome = r.value;
       switch (o.outcome) {
         case 'updated': counts.updated += 1; break;
         case 'skipped_below_threshold': counts.belowThreshold += 1; break;
         case 'error': counts.error += 1; break;
       }
     } else {
       logger.warn({ err: ... }, 'chris.psychological.profile_generation_failed');
       counts.error += 1;
     }
   }
   ```
5. **Aggregate log key:** `'chris.psychological.cron.complete'` (replaces `'chris.profile.cron.complete'`); start log `'chris.psychological.cron.start'`.
6. **Outer try/catch lowercase infra log key:** `'psychological.profile.cron.error'` (mirrors analog line 139 lowercase convention).
7. **wordCount in start log** instead of entryCount + decisionCount:
   ```typescript
   logger.info(
     { wordCount: hexacoSubstrate.wordCount, threshold: MIN_SPEECH_WORDS, belowThreshold: hexacoSubstrate.belowThreshold },
     'chris.psychological.cron.start',
   );
   ```

---

### 10. `src/cron-registration.ts` (MODIFIED; Plan 38-03 — 4 modifications)

**Role:** cron registration — extend existing helper
**Data flow:** dep injection + node-cron schedule + status return
**Analog:** self (existing lines 22-30, 32-55, 66-74, 178-193)

**`CronRegistrationStatus` interface extension** (analog line 22-30):
```typescript
export interface CronRegistrationStatus {
  proactive: 'registered' | 'failed';
  ritual: 'registered' | 'failed';
  ritualConfirmation: 'registered' | 'failed';
  episodic: 'registered' | 'failed';
  sync: 'registered' | 'failed' | 'disabled';
  /** M010 Phase 34 GEN-01 — operational profile updater (Sunday 22:00 Paris). */
  profileUpdate: 'registered' | 'failed';
  // ADD per Phase 38 PGEN-05:
  /** M011 Phase 38 PGEN-05 — psychological profile updater (1st of month 09:00 Paris). */
  psychologicalProfileUpdate: 'registered' | 'failed';
}
```

**`RegisterCronsDeps` interface extension** (analog lines 32-55):
```typescript
export interface RegisterCronsDeps {
  config: {
    proactiveSweepCron: string;
    ritualSweepCron: string;
    episodicCron: string;
    syncIntervalCron: string;
    proactiveTimezone: string;
    /** M010 Phase 34 GEN-01 — Sunday 22:00 Paris profile updater. */
    profileUpdaterCron: string;
    // ADD:
    /** M011 Phase 38 PGEN-05 — 1st-of-month 09:00 Paris psychological profile updater. */
    psychologicalProfileUpdaterCron: string;
  };
  runSweep: () => Promise<unknown>;
  runRitualSweep: () => Promise<unknown>;
  runConsolidateYesterday: () => Promise<void>;
  ritualConfirmationSweep: () => Promise<number | void>;
  runProfileUpdate: () => Promise<void>;
  // ADD:
  /** M011 Phase 38 PGEN-04 — `updateAllPsychologicalProfiles` via Promise.allSettled across HEXACO + Schwartz. */
  runPsychologicalProfileUpdate: () => Promise<void>;
  runSync?: () => Promise<void>;
}
```

**Status initialization extension** (analog lines 66-74):
```typescript
const status: CronRegistrationStatus = {
  proactive: 'failed',
  ritual: 'failed',
  ritualConfirmation: 'failed',
  episodic: 'failed',
  sync: deps.runSync ? 'failed' : 'disabled',
  profileUpdate: 'failed',
  psychologicalProfileUpdate: 'failed',     // ADD
};
```

**5th cron registration block — APPEND AFTER LINE 193** (analog lines 178-193 — mirror exact shape):
```typescript
// M011 Phase 38 PGEN-05 — 1st-of-month 09:00 Paris psychological profile updater.
// UNCONDITIONAL fire monthly per PGEN-06 (inverse of M010 hash-skip idempotency).
// CRON-01 try/catch belt-and-suspenders: the orchestrator already has its own
// outer try/catch + 'psychological.profile.cron.error' log; this is the
// defense-in-depth wrapper if some unexpected error escapes the barrier.
cron.schedule(
  deps.config.psychologicalProfileUpdaterCron,
  async () => {
    try {
      await deps.runPsychologicalProfileUpdate();
    } catch (err) {
      logger.error({ err }, 'psychological.profile.cron.error');
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
status.psychologicalProfileUpdate = 'registered';
logger.info(
  { cron: deps.config.psychologicalProfileUpdaterCron, timezone: deps.config.proactiveTimezone },
  'psychological.profile.cron.scheduled',
);
```

**Divergences from M010 cron registration:**
1. **Cron expression:** `'0 9 1 * *'` (1st of month at 09:00) NOT `'0 22 * * 0'` (Sunday 22:00). LOCKED by REQUIREMENTS PGEN-05.
2. **Log key:** `psychological.profile.cron.scheduled` / `psychological.profile.cron.error` (lowercase infra-error convention with `psychological.` namespace prefix).
3. **No semantic difference in registration shape** — just a 5th `cron.schedule` block with same try/catch belt-and-suspenders pattern.

---

### 11. `src/config.ts` (MODIFIED; Plan 38-03 — 1-line addition)

**Role:** config — append `psychologicalProfileUpdaterCron`
**Data flow:** module-load env var read + `cron.validate` fail-fast
**Analog:** self (line 87)

**Validated cron pattern** (analog lines 20-26 + line 87):
```typescript
function validatedCron(envKey: string, fallback: string): string {
  const expr = process.env[envKey] || fallback;
  if (!validate(expr)) {
    throw new Error(`config: invalid ${envKey} expression "${expr}"`);
  }
  return expr;
}

// ... in the config object:
profileUpdaterCron: validatedCron('PROFILE_UPDATER_CRON', '0 22 * * 0'),  // line 87
```

**Phase 38 addition — append AFTER line 87:**
```typescript
// M011 Phase 38 PGEN-05 — psychological profile updater cron.
// Default '0 9 1 * *' = 1st of month at 09:00 in config.proactiveTimezone.
// UNCONDITIONAL fire per PGEN-06 (inverse of M010 GEN-07 hash-skip idempotency).
// D-28 fail-fast: invalid PSYCHOLOGICAL_PROFILE_UPDATER_CRON throws at
// module load (silent-bad-cron M008 EPI-04 incident class).
psychologicalProfileUpdaterCron: validatedCron('PSYCHOLOGICAL_PROFILE_UPDATER_CRON', '0 9 1 * *'),
```

**Divergences:** none structural — exact 1-line mirror of existing pattern. Different env var name + different default cron expression. No `.env.example` work for this phase (matches M010 convention).

---

### 12. `src/index.ts` (MODIFIED; Plan 38-03 — 3 modifications)

**Role:** health endpoint + cron wiring
**Data flow:** module-load import + createApp /health route + main() registerCrons deps
**Analog:** self (lines 14, 68-72, 94-104)

**Import pattern** (analog line 14):
```typescript
import { updateAllOperationalProfiles } from './memory/profile-updater.js';
// ADD per Phase 38:
import { updateAllPsychologicalProfiles } from './memory/psychological-profile-updater.js';
```

**/health field pattern** (analog lines 68-72):
```typescript
res.status(statusCode).json({
  status: overallStatus,
  checks,
  ritual_cron_registered: effectiveCronStatus?.ritual === 'registered',
  profile_cron_registered: effectiveCronStatus?.profileUpdate === 'registered',
  // ADD per Phase 38 PGEN-05 — VERBATIM snake_case key per REQUIREMENTS:
  psychological_profile_cron_registered: effectiveCronStatus?.psychologicalProfileUpdate === 'registered',
  timestamp: new Date().toISOString(),
});
```

**registerCrons deps pattern** (analog lines 94-104):
```typescript
cronStatus = registerCrons({
  config,
  runSweep,
  runRitualSweep,
  runConsolidateYesterday,
  ritualConfirmationSweep,
  runProfileUpdate: () => updateAllOperationalProfiles(),
  // ADD per Phase 38 PGEN-04:
  runPsychologicalProfileUpdate: () => updateAllPsychologicalProfiles(),
});
```

**Divergences:** none structural — exact mirror of existing pattern. **Verbatim field name `psychological_profile_cron_registered`** (snake_case) per REQUIREMENTS PGEN-05; a typo here silently breaks operator post-deploy verification (Pitfall 6).

---

### 13. `src/rituals/__tests__/cron-registration.test.ts` (MODIFIED; Plan 38-03 — 4 new tests + baseConfig extension)

**Role:** structural test — spy on node-cron schedule
**Data flow:** mock node-cron + invoke registerCrons + assert spy call args
**Analog:** self (existing lines 135-206 — 3 M010 tests for profile updater cron)

**`baseConfig` extension** (analog lines 37-47):
```typescript
const baseConfig = {
  ritualSweepCron: '* * * * *',
  proactiveSweepCron: '0 10 * * *',
  episodicCron: '0 23 * * *',
  syncIntervalCron: '0 */6 * * *',
  proactiveTimezone: 'Europe/Paris',
  profileUpdaterCron: '0 22 * * 0',
  // ADD per Phase 38:
  psychologicalProfileUpdaterCron: '0 9 1 * *',
};
```

**Existing tests — add `runPsychologicalProfileUpdate: vi.fn()` to every `registerCrons({...})` call** to satisfy the extended `RegisterCronsDeps` interface.

**Test 1 — registration assertion** (mirror analog lines 135-154):
```typescript
it('registers the psychological profile updater cron at 1st-of-month 09:00 Europe/Paris (PGEN-05)', async () => {
  const { registerCrons } = await import('../../cron-registration.js');
  const status = registerCrons({
    config: baseConfig,
    runSweep: vi.fn(),
    runRitualSweep: vi.fn(),
    runConsolidateYesterday: vi.fn(),
    ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
    runProfileUpdate: vi.fn(),
    runPsychologicalProfileUpdate: vi.fn(),
  });
  const psychCall = scheduleSpy.mock.calls.find((c) => c[0] === '0 9 1 * *');
  expect(psychCall, 'psych updater cron must register at 1st of month 09:00').toBeDefined();
  expect(psychCall![2]).toEqual({ timezone: 'Europe/Paris' });
  expect(status.psychologicalProfileUpdate).toBe('registered');
});
```

**Test 2 — handler wiring** (mirror analog lines 156-175):
```typescript
it('runPsychologicalProfileUpdate dep is wired into the psych-cron handler (PGEN-04)', async () => {
  const { registerCrons } = await import('../../cron-registration.js');
  const runPsychologicalProfileUpdate = vi.fn().mockResolvedValue(undefined);
  registerCrons({ /* ...baseDeps, */ runPsychologicalProfileUpdate });
  const psychCall = scheduleSpy.mock.calls.find((c) => c[0] === '0 9 1 * *');
  const psychHandler = psychCall![1] as () => Promise<void>;
  await psychHandler();
  expect(runPsychologicalProfileUpdate).toHaveBeenCalledTimes(1);
});
```

**Test 3 — CRON-01 try/catch isolation** (mirror analog lines 177-206):
```typescript
it("psych handler isolates errors — throwing runPsychologicalProfileUpdate does NOT propagate; logs 'psychological.profile.cron.error' (CRON-01)", async () => {
  const { registerCrons } = await import('../../cron-registration.js');
  const throwingRunPsychologicalProfileUpdate = vi.fn().mockRejectedValue(new Error('synthetic psych failure'));
  registerCrons({ /* ...baseDeps, */ runPsychologicalProfileUpdate: throwingRunPsychologicalProfileUpdate });
  const psychCall = scheduleSpy.mock.calls.find((c) => c[0] === '0 9 1 * *');
  const psychHandler = psychCall![1] as () => Promise<void>;
  await expect(psychHandler()).resolves.toBeUndefined();
  const errorCalls = mockLoggerError.mock.calls.filter((c) => c[1] === 'psychological.profile.cron.error');
  expect(errorCalls).toHaveLength(1);
});
```

**Test 4 — 12-month Luxon-based cron collision check (D-27)** — NEW pattern, not in M010:
```typescript
import { DateTime } from 'luxon';

it('M010 + M011 crons do not collide at the same minute over the next 12 months (D-27)', () => {
  const start = DateTime.fromISO('2026-06-01T00:00:00', { zone: 'Europe/Paris' });

  // M011 monthly fires: 1st of each month at 09:00
  const m011Fires: DateTime[] = [];
  for (let i = 0; i < 12; i++) {
    m011Fires.push(start.plus({ months: i }).set({ hour: 9, minute: 0 }));
  }

  // M010 weekly fires: every Sunday at 22:00 over the same 12-month window
  const m010Fires: DateTime[] = [];
  let cursor = start.set({ weekday: 7, hour: 22, minute: 0 }); // first Sunday after start
  while (cursor < start.plus({ months: 12 })) {
    m010Fires.push(cursor);
    cursor = cursor.plus({ weeks: 1 });
  }

  // Assert: no M011 fire falls within the same hour as any M010 fire
  for (const m011 of m011Fires) {
    for (const m010 of m010Fires) {
      const diffMs = Math.abs(m011.toMillis() - m010.toMillis());
      const sameHour = diffMs < 60 * 60 * 1000;
      expect(sameHour, `M011 fire ${m011.toISO()} collides with M010 fire ${m010.toISO()}`).toBe(false);
    }
  }
});
```

**Divergences from M010 cron tests:**
1. **NEW test pattern (collision check)** — Luxon `DateTime` arithmetic, no node-cron API needed. Phase 38 unique. Math is trivial (M011 09:00 vs M010 22:00, 13 hours apart even on Sunday-1st corner case); test serves as regression detector if either expression drifts.
2. **3 of 4 tests** mirror exact M010 test structure with `'0 9 1 * *'` substituted for `'0 22 * * 0'` and `psychological.profile.cron.error` substituted for `profile.cron.error`.
3. **Every existing test** in this file needs `runPsychologicalProfileUpdate: vi.fn()` added to its `registerCrons({...})` call (TypeScript strict-mode requires the field).

---

## Shared Patterns

### Hoisted vitest mocks (Anthropic SDK + logger)

**Source:** `src/memory/profiles/__tests__/generators.two-cycle.test.ts:52-79`
**Apply to:** all integration tests + per-generator unit tests (files #6, #7, #8)

```typescript
const { mockAnthropicParse, mockLoggerInfo, mockLoggerWarn, mockLoggerError } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('../../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../llm/client.js')>();
  return {
    ...orig,
    anthropic: { messages: { parse: mockAnthropicParse, create: vi.fn() } },
  };
});

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));
```

### CRON-01 try/catch belt-and-suspenders

**Source:** `src/cron-registration.ts:78-86, 99-104, 116-123, 138-143, 156-161, 178-186`
**Apply to:** every cron handler — including the new 5th cron in file #10

```typescript
cron.schedule(
  deps.config.<cronExpression>,
  async () => {
    try {
      await deps.<handlerFn>();
    } catch (err) {
      logger.error({ err }, '<namespace>.cron.error');   // lowercase infra-error key
    }
  },
  { timezone: deps.config.proactiveTimezone },
);
status.<statusField> = 'registered';
logger.info(
  { cron: deps.config.<cronExpression>, timezone: deps.config.proactiveTimezone },
  '<namespace>.cron.scheduled',
);
```

### jsonb-NOT-NULL encoding (sql template + explicit jsonb cast)

**Source:** `src/memory/profiles/shared.ts:514-522`
**Apply to:** generator upsert paths (files #4, #5) — Phase 37 profile tables use the same `notNull().default(sql\`'null'::jsonb\`)` convention per `src/db/schema.ts:672-677`

```typescript
const flat = config.flattenSonnetOutput(sonnetOut);
const flatEncoded: Record<string, unknown> = {};
for (const [k, v] of Object.entries(flat)) {
  const serialized = v === undefined ? 'null' : JSON.stringify(v);
  flatEncoded[k] = sql`${serialized}::jsonb`;
}
const upsertValues: Record<string, unknown> = {
  name: 'primary',
  schemaVersion: prevStateMeta.schema_version,
  substrateHash: computedHash,
  // ...
  ...flatEncoded,
  lastUpdated: new Date(),
};
await db
  .insert(config.table)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  .values(upsertValues as any)
  .onConflictDoUpdate({ target: config.table.name, set: upsertValues });
```

### Write-before-upsert (profile_history snapshot)

**Source:** `src/memory/profiles/shared.ts:495-501`
**Apply to:** every generator (files #4, #5) — on the success path BEFORE the upsert
**Phase 38 divergence:** runs on EVERY successful generation (no hash-skip branch), so `profile_history` accumulates a row every fire. M010's two-cycle test asserts 4 cumulative rows after 2 cycles (skip cycle = 0 rows). M011's three-cycle test asserts 2/4/6 cumulative rows (unconditional fire = 2 rows per cycle).

```typescript
if (currentRow && currentRow.id) {
  await db.insert(profileHistory).values({
    profileTableName: config.profileTableName,   // 'profile_hexaco' | 'profile_schwartz'
    profileId: currentRow.id as string,
    snapshot: currentRow as Record<string, unknown>,  // full jsonb (D-30)
  });
}
```

### Sonnet messages.parse + zodOutputFormat + cache_control:ephemeral

**Source:** `src/memory/profiles/shared.ts:457-480`
**Apply to:** generator Sonnet calls (files #4, #5)

```typescript
const response = await anthropic.messages.parse({
  model: SONNET_MODEL,                                  // claude-sonnet-4-6 from config
  max_tokens: 4000,                                     // 4000 for psych vs 2000 for M010 (larger output)
  system: [
    {
      type: 'text' as const,
      text: prompt.system,
      cache_control: { type: 'ephemeral' as const },
    },
  ],
  messages: [{ role: 'user' as const, content: prompt.user }],
  output_config: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    format: zodOutputFormat(config.v4SchemaBoundary as unknown as any),
  },
});
if (response.parsed_output === null || response.parsed_output === undefined) {
  throw new Error(`${config.profileType}.psychological.sonnet: parsed_output is null`);
}
const sonnetOut = config.v3SchemaBoundary.parse(response.parsed_output);   // v3 re-validate
```

### Validated cron + fail-fast

**Source:** `src/config.ts:20-26, 87`
**Apply to:** new cron config entry (file #11)

```typescript
function validatedCron(envKey: string, fallback: string): string {
  const expr = process.env[envKey] || fallback;
  if (!validate(expr)) {
    throw new Error(`config: invalid ${envKey} expression "${expr}"`);
  }
  return expr;
}
// in config object:
<fieldName>: validatedCron('<ENV_VAR_NAME>', '<defaultExpression>'),
```

### Promise.allSettled per-generator error isolation

**Source:** `src/memory/profile-updater.ts:81-86, 94-121`
**Apply to:** orchestrator (file #9)

```typescript
const results = await Promise.allSettled([
  // ... generator calls
]);

const counts = { /* outcomes */ };
for (const r of results) {
  if (r.status === 'fulfilled') {
    const o = r.value;
    switch (o.outcome) {
      // ... cases per discriminated outcome union
    }
  } else {
    // EMERGENCY PATH: generator threw BEFORE returning a discriminated outcome
    logger.warn(
      { err: r.reason instanceof Error ? r.reason.message : String(r.reason) },
      '<namespace>.profile_generation_failed',
    );
    counts.error += 1;
  }
}
```

### Pure-function structural test parametrized over union

**Source:** `src/memory/__tests__/profile-prompt.test.ts:33-38, 113-114`
**Apply to:** prompt builder test (file #2)

```typescript
const PROFILE_TYPES = ['hexaco', 'schwartz'] as const;

describe.each(PROFILE_TYPES)('profileType=%s', (profileType) => {
  it('CONSTITUTIONAL_PREAMBLE first — system starts with the M010-06 anchor', () => {
    const result = assemblePsychologicalProfilePrompt(profileType, buildFixture(), null, 6000);
    expect(result.system.startsWith('## Core Principles (Always Active)')).toBe(true);
  });
  // ... more anchor-substring assertions
});
```

### D047 boundary discipline (psych-boundary-audit.test.ts compliance)

**Source:** `src/memory/profiles/__tests__/psych-boundary-audit.test.ts` (Phase 37 Plan 02 PSCH-10)
**Apply to:** every NEW Phase 38 file under `src/memory/**/psychological-*.ts` OR `src/memory/profiles/{hexaco,schwartz}.ts` — the audit grep MUST stay clean
**Rule:** in psych files, NEVER mention `jurisdictional`, `capital`, `health`, or `family` (operational tokens) — not even in comments. Conversely, operational files MUST NOT mention `hexaco`, `schwartz`, `attachment`, or `psychological`.

**Critical discipline points:**
1. File #1 (`psychological-profile-prompt.ts`) imports ONLY `DO_NOT_INFER_DIRECTIVE` from `profile-prompt.ts` — explicit named import, NEVER `import *` or `import { ... assembleProfilePrompt ...}`.
2. Files #4/#5 import ONLY from `psychological-shared.ts` + `psychological-schemas.ts` + their own profile-type schema. Never from `./shared.js` or `./schemas.js` (M010 operational files).
3. Files #4/#5 must NOT reference `ProfilePromptDimension`, `JurisdictionalProfileData`, or the per-dimension `DIMENSION_DIRECTIVES` token.
4. Comments in psych files describing "the inverse of M010" pattern MUST use the language "M010" / "operational" / "GEN-07" rather than the specific dimension tokens.

---

## No Analog Found

None — every Phase 38 file mirrors an existing Phase 34 (M010) or Phase 37 (M011 substrate) predecessor. The phase is fundamentally a translation of operational-profile infrastructure into the psychological-profile namespace with five locked divergences:

1. UNCONDITIONAL FIRE (no hash-skip branch) — RESEARCH Finding 3 (Path A)
2. Schema boundary extension for `data_consistency` + `overall_confidence` — RESEARCH Finding 1
3. Monthly cron (1st of month 09:00) vs M010 weekly (Sunday 22:00)
4. 2 generators (HEXACO + Schwartz) vs M010 4 generators
5. Three-cycle inverse-of-idempotency integration test vs M010 two-cycle hash-skip test

The closest "new pattern" element is the 12-month Luxon-based cron-collision unit test (Test 4 in file #13) — `DateTime.fromISO().set({weekday, hour}).plus({weeks: 1})` enumeration. Luxon is already in the project (`src/memory/profiles/psychological-shared.ts:46`), so no new dependency, but the test idiom itself is novel to Phase 38.

---

## Metadata

**Analog search scope:** `src/memory/`, `src/memory/profiles/`, `src/memory/__tests__/`, `src/memory/profiles/__tests__/`, `src/cron-registration.ts`, `src/config.ts`, `src/index.ts`, `src/rituals/__tests__/cron-registration.test.ts`
**Files inspected:** `profile-prompt.ts` (252 lines), `profile-updater.ts` (142 lines), `profiles/jurisdictional.ts` (91 lines), `profiles/shared.ts:100-565` (substrate + helper), `profiles/schemas.ts:50-180` (data_consistency proof), `cron-registration.ts` (full), `config.ts:1-90` (validated cron), `index.ts` (full), `__tests__/profile-prompt.test.ts:1-120`, `__tests__/generators.two-cycle.test.ts` (full), `__tests__/cron-registration.test.ts:1-220`, `psychological-schemas.ts` (full — Finding 1 verification), `psychological-shared.ts:1-235` (substrate loader contract)
**Pattern extraction date:** 2026-05-14
**Critical Plan-routing note:** Plan 38-02 MUST extend `psychological-schemas.ts` with boundary variants (Finding 1) — without this extension the Cycle 1 assertion `overallConfidence > 0` (D-34) is unsatisfiable and the entire integration test fails on schema mismatch. The planner should encode this as a MUST-DO in Plan 38-02 with `<read_first>` pointing to `src/memory/profiles/psychological-schemas.ts:93-100,120-131` (gap) and `src/memory/profiles/schemas.ts:67,92,116,149,181,236` (M010 reference) and `<action>` instructing the executor to add the four `*Boundary` variants before any generator implementation begins.
