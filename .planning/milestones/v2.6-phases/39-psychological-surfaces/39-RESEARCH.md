# Phase 39: Psychological Surfaces — Research

**Researched:** 2026-05-14
**Domain:** User-facing surfaces (system-prompt injection + `/profile` Telegram display) for M011 HEXACO + Schwartz psychological profiles
**Confidence:** HIGH — every claim verified against live codebase inspection (`grep`/`Read` against current `main`)

---

## Summary

Phase 39 is a **pure consumer phase** — the substrate (Phase 37: types + reader) and the inference engine (Phase 38: prompt builder + generators + cron) are already shipped and in production. Phase 39 wires those two upstream phases into the two existing user-facing surfaces that M010 Phase 35 already pioneered:

1. **Prompt-side injection** (Plan 39-01) — adds `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` + `formatPsychologicalProfilesForPrompt` to `src/memory/profiles.ts`, extends `ChrisContextExtras` with `psychologicalProfiles?: string`, prepends the rendered block ABOVE `operationalProfiles` ABOVE `pensieveContext` in REFLECT + PSYCHOLOGY mode templates, wires REFLECT + PSYCHOLOGY mode handlers, and adds a COACH negative-invariant test.
2. **Display-side rendering** (Plan 39-02 — HARD CO-LOC #M11-3) — adds `formatPsychologicalProfileForDisplay` pure function + replaces `MSG.m011Placeholder` at `src/bot/handlers/profile.ts:627` with 3 new `ctx.reply` calls + adds golden-output inline-snapshot test covering 4 scenarios × FR/RU language slots.

The work mirrors the M010 Phase 35 split (35-02 prompt-side + 35-03 display-side) with one fewer plan — Phase 35's Plan 35-01 (`buildSystemPrompt` refactor) is NOT repeated because the `extras: ChrisContextExtras` slot already exists. Phase 39 extends the interface by one field (`psychologicalProfiles?: string` sibling to `operationalProfiles?: string`) without changing the signature.

The single load-bearing risk is **D027 Hard Rule sycophancy via trait-authority framing** (PITFALLS.md §1). The mitigation is the inline Hard Rule footer appended to the rendered system-prompt block — and the footer is `PSYCHOLOGICAL_HARD_RULE_EXTENSION` imported verbatim from `src/memory/psychological-profile-prompt.ts:144` (Phase 38 already shipped this constant for the inference-side prompt; Phase 39 imports it as the consumer-side footer, giving two enforcement points across the inference + consumer boundary).

**Primary recommendation:** Mirror Phase 35-02 / 35-03 verbatim with the locked CONTEXT.md divergences (psychological block prepended ABOVE operational; Hard Rule footer at bottom of psych block; COACH explicitly absent from map; word-count-countdown insufficient-data branch).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Psychological data read (DB) | Memory module (`src/memory/profiles.ts`) | — | `getPsychologicalProfiles()` reader ships in Phase 37 — Phase 39 calls it twice (prompt-side + display-side) |
| Prompt-block rendering | Memory module (`src/memory/profiles.ts`) | — | `formatPsychologicalProfilesForPrompt` is pure (no DB, no I/O); sibling to existing `formatProfilesForPrompt` |
| Hard Rule footer text | Inference layer (`src/memory/psychological-profile-prompt.ts`) | Memory module (re-import for surface footer) | Phase 38 already exports `PSYCHOLOGICAL_HARD_RULE_EXTENSION`; Phase 39 imports verbatim — single source of truth |
| `ChrisContextExtras` interface | Personality layer (`src/chris/personality.ts`) | — | Existing interface at line 39; Phase 39 adds one optional field |
| Prompt-template substitution | Personality layer (`src/chris/personality.ts`) | — | Existing `buildSystemPrompt` body at lines 124-155; Phase 39 extends REFLECT + PSYCHOLOGY cases to prepend the new field |
| Mode-handler injection wiring | Mode handlers (`src/chris/modes/{reflect,psychology}.ts`) | — | Each handler adds 2 lines (reader call + formatter call); COACH explicitly NOT modified |
| `/profile` command Telegram replies | Bot handler (`src/bot/handlers/profile.ts`) | — | Existing handler at lines 607-638; Phase 39 inserts 3 new replies + final wrap-up |
| Display-side formatter | Bot handler (`src/bot/handlers/profile.ts`) | — | Pure function `formatPsychologicalProfileForDisplay`; sibling to existing `formatProfileForDisplay` at line 397 |
| Golden snapshot test | Test layer (`src/bot/handlers/__tests__/`) | — | Inline-snapshot via `toMatchInlineSnapshot`; sibling file to `profile.golden.test.ts` |
| COACH negative-invariant | Test layer (`src/chris/modes/__tests__/`) | — | Source-file regex sweep at module load time; mirrors `psych-boundary-audit.test.ts` pattern |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PSURF-01 | `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` constant exported from `src/memory/profiles.ts`; REFLECT: `['hexaco','schwartz']`, PSYCHOLOGY: `['hexaco','schwartz']`, COACH: `[]` (explicit-absent); DISTINCT from operational `PROFILE_INJECTION_MAP` | §"Standard Stack" / §"Architecture Patterns" — operational map at line 87 is the exemplar; Phase 39 adds sibling constant; type-narrowed to `'REFLECT' \| 'PSYCHOLOGY'` per D-04 |
| PSURF-02 | `formatPsychologicalProfilesForPrompt(profiles, mode)` returns `""` for null/below-threshold/zero-confidence/mode-not-in-map; populated → per-dim score lines + Hard Rule extension footer; footer = `PSYCHOLOGICAL_HARD_RULE_EXTENSION` imported verbatim | §"Code Examples" — operational `formatProfilesForPrompt` at line 446 is the structural mirror; Hard Rule footer at line 144 of `psychological-profile-prompt.ts` is the load-bearing D027 mitigation surface |
| PSURF-03 | `ChrisContextExtras` extended with `psychologicalProfiles?: string`; REFLECT + PSYCHOLOGY handlers wire reader → formatter → buildSystemPrompt; COACH NOT modified (verified by negative-invariant test); JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY silently drop | §"Architecture Patterns" — existing `operationalProfiles` field at line 42 is sibling; substitution body at lines 145-171 already handles REFLECT/COACH/PSYCHOLOGY (Phase 35 D-07); Phase 39 prepends ABOVE operational for REFLECT+PSYCHOLOGY only |
| PSURF-04 | `/profile` command extended with HEXACO + Schwartz + Attachment sections; insufficient-data branch: `"HEXACO: insufficient data — need N more words"` (N = max(0, 5000 - word_count)); Attachment branch: `"Attachment: not yet active (gated on D028..."` | §"Code Examples" — existing `/profile` body at lines 607-638; `MSG.m011Placeholder` at line 627 is the replacement site; existing `formatProfileForDisplay` insufficient-data branch at line 404-406 is the structural mirror |
| PSURF-05 | `formatPsychologicalProfileForDisplay(profileType, profile, lang)` pure function + golden-output inline-snapshot test covering 4 scenarios (all-populated / all-insufficient / mixed / FR+RU slots); HARD CO-LOC #M11-3 — formatter + golden snapshot ship in same plan | §"Code Examples" — existing `profile.golden.test.ts` (633 lines) is the exemplar pattern; `toMatchInlineSnapshot` with fixed `MOCK_PROFILES` fixture + `vi.setSystemTime` time anchor |
</phase_requirements>

## Standard Stack

### Core (zero new dependencies — confirmed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.9.3 | Type system | [VERIFIED: `npx tsc --version`] All Phase 37/38 deliverables compile clean; Phase 39 adds only sibling functions/fields, no new type machinery |
| Node.js | 24.14.1 | Runtime | [VERIFIED: `node --version`] |
| Vitest | ^4.1.2 | Test framework + inline-snapshot | [VERIFIED: `package.json`] `toMatchInlineSnapshot` is the canonical pattern for golden-output tests (M010 Phase 35-03 precedent at `profile.golden.test.ts`) |
| grammy | ^1.31.0 | Telegram bot framework | [VERIFIED: `package.json`] Existing `/profile` handler uses `Context.reply`; Phase 39 adds 3 more replies via the same API |
| zod | ^3.24.0 | Type schemas | [VERIFIED: `package.json`] Phase 37 ships v3 + v4 schemas at `psychological-schemas.ts`; Phase 39 consumes the inferred types (`HexacoProfileData`/`SchwartzProfileData`/`AttachmentProfileData`) |

### Supporting (already wired by Phase 37/38)

| Symbol | File:Line | Purpose | When Used |
|--------|-----------|---------|-----------|
| `getPsychologicalProfiles()` | `src/memory/profiles.ts:408` | Never-throw reader for 3 psych tables | Plan 39-01 mode handlers + Plan 39-02 `/profile` handler |
| `PsychologicalProfiles` interface | `src/memory/profiles.ts:246` | Return shape `{ hexaco, schwartz, attachment }` (each `ProfileRow<T> \| null`) | Both formatters consume this shape |
| `ProfileRow<T>` interface | `src/memory/profiles.ts:58` | `{ data, confidence, lastUpdated, schemaVersion }` | Per-profile row shape used in both formatters |
| `PsychologicalProfileType` | re-exported `src/memory/profiles.ts:53`; defined `src/memory/profiles/psychological-shared.ts:75` | `'hexaco' \| 'schwartz' \| 'attachment'` union | Type values of `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` |
| `HexacoProfileData` / `SchwartzProfileData` / `AttachmentProfileData` | `src/memory/profiles/psychological-schemas.ts:91, 118, 144` | Per-profile-type structured data shape (snake_case keys: `honesty_humility`, `self_direction`, etc., each `{ score, confidence, last_updated } \| null`) | Both formatters narrow `profile.data` to these types |
| `PSYCHOLOGICAL_HARD_RULE_EXTENSION` | `src/memory/psychological-profile-prompt.ts:144` | 8-line D027 trait-authority Hard Rule extension | Plan 39-01 imports verbatim as the inline footer in `formatPsychologicalProfilesForPrompt` |
| `formatProfilesForPrompt` | `src/memory/profiles.ts:446` | Operational analog formatter | Plan 39-01 structural mirror (same shape, M011 divergences per CONTEXT.md D-05/D-06/D-09) |
| `formatProfileForDisplay` | `src/bot/handlers/profile.ts:397` | Operational analog display formatter | Plan 39-02 structural mirror (per-dim branching; populated vs. insufficient-data) |
| `MSG` localization map | `src/bot/handlers/profile.ts:111-369` | EN/FR/RU per-handler-string map | Plan 39-02 extends with `MSG.psychologicalSections.{hexaco,schwartz,attachment}.{en,fr,ru}` keys |
| `langOf` / `Lang` type | `src/chris/language.ts` (re-exported `profile.ts:80`) | `'English' \| 'French' \| 'Russian'` narrowing helper | Plan 39-02 display formatter accepts `lang: Lang` |
| `buildSystemPrompt` | `src/chris/personality.ts:120` | Prompt assembler with `extras: ChrisContextExtras` | Plan 39-01 extends extras consumption inside REFLECT/PSYCHOLOGY cases (lines 145-171) |

**Installation:** zero new dependencies. All work is additive against existing TypeScript modules.

**Version verification:** [VERIFIED: 2026-05-14] All package versions current per `package.json`. No upgrade pressure on any Phase 39 dependency.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline switch-case in `formatPsychologicalProfileForDisplay` | Per-profileType config object (`HEXACO_DISPLAY_CONFIG = { sectionTitle, dimensions, ... }`) | Config object is cleaner if Phase 40+ adds more profile types; switch-case mirrors Phase 35's `formatProfileForDisplay` (line 412 — also switch-case). **Recommend:** switch-case (consistency with M010 sibling; only 3 cases) |
| `for` loop over `['hexaco', 'schwartz', 'attachment']` in `/profile` command | Three inline `await ctx.reply()` calls | Loop matches Phase 35-03 pattern (line 623-625 of `profile.ts` uses `for (const dim of dimensions)` for the operational 4 dimensions). **Recommend:** loop. Per CONTEXT.md Claude's Discretion. |
| Const tuple for D-07 confidence qualifier mapping | Inline switch / if-else | Const tuple `[[0.6, 'substantial'], [0.3, 'moderate'], [0, 'limited']]` is declarative; switch is procedural. **Recommend:** inline private `qualifierFor(c: number): string` function — declarative and locally-scoped per D-07 |

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────┐
                          │ Phase 37 substrate (already shipped)    │
                          │   ┌──────────────────────────────────┐  │
                          │   │ getPsychologicalProfiles()       │  │
                          │   │ → { hexaco, schwartz, attachment │  │
                          │   │    each ProfileRow<T> | null }   │  │
                          │   └──────────────────────────────────┘  │
                          └─────────────────────────────────────────┘
                                            ▲           ▲
                                            │           │
                  ┌─────────────────────────┘           └─────────────────┐
                  │ READ #1                                                │ READ #2
                  │                                                        │
       ┌──────────┴────────────────────────┐         ┌────────────────────┴─────────────────────┐
       │ Plan 39-01: PROMPT-SIDE           │         │ Plan 39-02: DISPLAY-SIDE  (HARD CO-LOC)   │
       │                                   │         │                                            │
       │ src/memory/profiles.ts            │         │ src/bot/handlers/profile.ts                │
       │   PSYCHOLOGICAL_PROFILE_INJECTION │         │   handleProfileCommand(ctx)                │
       │     _MAP = { REFLECT:[h,s],       │         │     1. getPsychologicalProfiles()          │
       │              PSYCHOLOGY:[h,s] }   │         │     2. for each ['hexaco','schwartz',      │
       │                                   │         │           'attachment']:                   │
       │   formatPsychologicalProfilesFor  │         │          ctx.reply(formatPsychologi-      │
       │     Prompt(profiles, mode)        │         │            calProfileForDisplay(           │
       │     → "" OR rendered block        │         │            type, profile, lang))           │
       │       + Hard Rule footer          │         │                                            │
       │       (IMPORTED verbatim from     │         │   formatPsychologicalProfileForDisplay     │
       │        psychological-profile-     │         │     (pure function):                       │
       │        prompt.ts:144)             │         │     - populated → per-dim score lines     │
       │                                   │         │     - insufficient → "need N more words"  │
       └─────────────┬─────────────────────┘         │     - attachment → "not yet active..."    │
                     │                                │     - never-fired → "first inference     │
                     │                                │       runs 1st of month"                  │
                     ▼                                └─────────────────┬──────────────────────────┘
       ┌─────────────────────────────────┐                              │
       │ src/chris/personality.ts        │                              ▼
       │   ChrisContextExtras += {       │            ┌──────────────────────────────────────┐
       │     psychologicalProfiles?:     │            │ src/bot/handlers/__tests__/          │
       │       string                    │            │   profile-psychological.golden       │
       │   }                             │            │     .test.ts (NEW — HARD CO-LOC)     │
       │                                 │            │                                       │
       │   buildSystemPrompt body        │            │   describe.each(['EN','FR','RU'])    │
       │     REFLECT case:               │            │   it: "all-populated"                │
       │       prepend psych THEN op     │            │   it: "all-insufficient"             │
       │       THEN pensieve             │            │   it: "mixed"                        │
       │     PSYCHOLOGY case: same       │            │   toMatchInlineSnapshot()            │
       │     COACH case: unchanged       │            └──────────────────────────────────────┘
       │       (silent drop of psych     │
       │        field — handler doesn't  │
       │        pass it)                 │
       └─────────────┬───────────────────┘
                     │
                     ▼
       ┌─────────────────────────────────┐         ┌─────────────────────────────────────────┐
       │ src/chris/modes/reflect.ts      │         │ src/chris/modes/coach.ts                │
       │   getOperationalProfiles()      │         │   getOperationalProfiles()              │
       │   formatProfilesForPrompt()     │         │   formatProfilesForPrompt()             │
       │ + getPsychologicalProfiles()    │         │   buildSystemPrompt('COACH', ..., {     │
       │ + formatPsychologicalProfilesFor│         │     operationalProfiles })              │
       │     Prompt()                    │         │     ◀──── NO psychologicalProfiles      │
       │   buildSystemPrompt('REFLECT',  │         │           field passed                  │
       │     ..., { operational,         │         │                                          │
       │            psychological })     │         │ (file UNCHANGED — Phase 39 does not     │
       └─────────────────────────────────┘         │  modify this file)                       │
                                                   └─────────────────────────────────────────┘
       ┌─────────────────────────────────┐                              ▲
       │ src/chris/modes/psychology.ts   │                              │
       │ (same shape as reflect.ts)      │         ┌────────────────────┴─────────────────────┐
       └─────────────────────────────────┘         │ src/chris/modes/__tests__/                │
                                                   │   coach-psychological-isolation.test.ts   │
                                                   │     (NEW — Plan 39-01 negative invariant) │
                                                   │                                            │
                                                   │   readFile(coach.ts) + regex sweep         │
                                                   │   asserts zero matches for psych vocab    │
                                                   └────────────────────────────────────────────┘
```

### Recommended Project Structure (additive only — zero new directories)

```
src/
├── memory/
│   ├── profiles.ts                              # MODIFIED (Plan 39-01) — append PSYCHOLOGICAL_PROFILE_INJECTION_MAP
│   │                                            #   + formatPsychologicalProfilesForPrompt after line 599
│   │                                            #   (operational formatter ends ~line 599)
│   └── psychological-profile-prompt.ts          # READ-ONLY — Plan 39-01 imports PSYCHOLOGICAL_HARD_RULE_EXTENSION from line 144
├── chris/
│   ├── personality.ts                           # MODIFIED (Plan 39-01) — extend ChrisContextExtras (line 39)
│   │                                            #   + extend REFLECT/PSYCHOLOGY cases of buildSystemPrompt (lines 145-171)
│   └── modes/
│       ├── reflect.ts                           # MODIFIED (Plan 39-01) — add ~4 lines (lines 75-87)
│       ├── psychology.ts                        # MODIFIED (Plan 39-01) — same shape as reflect.ts
│       ├── coach.ts                             # NOT MODIFIED — D-14 negative invariant target
│       └── __tests__/
│           └── coach-psychological-isolation.test.ts   # NEW (Plan 39-01) — regex sweep
└── bot/
    └── handlers/
        ├── profile.ts                           # MODIFIED (Plan 39-02) — add formatPsychologicalProfileForDisplay
        │                                        #   + replace MSG.m011Placeholder at line 627 with 3 new replies
        └── __tests__/
            └── profile-psychological.golden.test.ts    # NEW (Plan 39-02) — HARD CO-LOC #M11-3 inline snapshots
```

### Pattern 1: Distinct named injection-map constant (PSURF-01)

**What:** A `Readonly<Record<'REFLECT' | 'PSYCHOLOGY', readonly PsychologicalProfileType[]>>` exported from `src/memory/profiles.ts`, alongside (not replacing) the existing `PROFILE_INJECTION_MAP`.

**When to use:** Two parallel injection maps because the operational map's value type is `Dimension[]` and the psychological map's is `PsychologicalProfileType[]` — merging would force a union type and lose nominal type-safety. CONTEXT.md D-03 locks this.

**Why this matters:** TypeScript's narrowing in `formatPsychologicalProfilesForPrompt` depends on the map's value type — passing `'COACH'` as the mode is a compile-time error if the key union is `'REFLECT' | 'PSYCHOLOGY'`, which prevents the D027 sycophancy regression structurally.

**Source:** [VERIFIED: `src/memory/profiles.ts:87`] — operational analog already shipped:
```typescript
// src/memory/profiles.ts:87 (existing)
export const PROFILE_INJECTION_MAP: Readonly<Record<'REFLECT' | 'COACH' | 'PSYCHOLOGY', readonly Dimension[]>> = {
  REFLECT: ['jurisdictional', 'capital', 'health', 'family'],
  COACH: ['capital', 'family'],
  PSYCHOLOGY: ['health', 'jurisdictional'],
} as const;
```

**Phase 39 sibling (locked per D-04):**
```typescript
// src/memory/profiles.ts (NEW — sibling after operational analog or after getPsychologicalProfiles)
export const PSYCHOLOGICAL_PROFILE_INJECTION_MAP: Readonly<
  Record<'REFLECT' | 'PSYCHOLOGY', readonly PsychologicalProfileType[]>
> = {
  REFLECT: ['hexaco', 'schwartz'],
  PSYCHOLOGY: ['hexaco', 'schwartz'],
} as const;
```

Note that `'attachment'` is NOT in any mode's array (D-23 from Phase 38 — attachment generator deferred; no data to inject in M011).

### Pattern 2: Empty-string-OR-fully-rendered-block formatter (PSURF-02)

**What:** `formatPsychologicalProfilesForPrompt(profiles, mode)` returns `""` for any of the four sentinel conditions (D-05); otherwise returns the rendered block + Hard Rule footer.

**When to use:** Pure function in `src/memory/profiles.ts` — same module as `getPsychologicalProfiles()` so consumers have one import path.

**Source:** [VERIFIED: `src/memory/profiles.ts:446-475`] — operational analog signature + early-return pattern:
```typescript
// src/memory/profiles.ts:446 (existing — structural mirror for Phase 39)
export function formatProfilesForPrompt(profiles: OperationalProfiles, mode: string): string {
  const scope = (PROFILE_INJECTION_MAP as Record<string, readonly Dimension[]>)[mode];
  if (!scope) return '';
  // ... per-dim filter loop ...
  if (sections.length === 0) return '';
  return PROFILE_INJECTION_HEADER + '\n\n' + sections.join('\n\n');
}
```

**Phase 39 divergences from operational (per CONTEXT.md):**
- **NO staleness check** (operational checks `now - lastUpdated > 21 days`; psych runs monthly so always recent if fired — D-05 omits this entirely)
- **NO health-floor confidence gate** (operational gates health at 0.5; psych uses simpler "skip dim if confidence === 0 OR score === null" per D-09)
- **NO per-dim char cap** (operational caps at 2000 chars; psych dim scores render compactly per D-08 — `"<DIM> <Trait>: X.X / 5.0 (confidence Y.Y — <qualifier>)"` is ~70 chars per line)
- **Hard Rule footer appended at the BOTTOM** of the rendered block (per D-06 + D-11 — recency-bias attention)

**Skeleton sketch (informational — planner produces the canonical form):**
```typescript
import { PSYCHOLOGICAL_HARD_RULE_EXTENSION } from './psychological-profile-prompt.js';

const PSYCH_INJECTION_HEADER = '## Psychological Profile (inferred — low precision, never use as authority)';

function qualifierFor(c: number): string {
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
  if (!scope) return '';                                                // D-05.a

  const sections: string[] = [];
  for (const profileType of scope) {
    const row = profiles[profileType];
    if (!row) continue;                                                  // D-05.b — null
    if (row.confidence === 0) continue;                                  // D-05.c — zero-confidence
    if (row.lastUpdated.getTime() === 0) continue;                       // D-05.d — never-fired (epoch sentinel)
    // Render per-dim lines (skip null/zero-conf dims per D-09)
    const block = renderPsychDimensions(profileType, row);
    if (block) sections.push(block);
  }
  if (sections.length === 0) return '';
  return [PSYCH_INJECTION_HEADER, '', sections.join('\n\n'), '', PSYCHOLOGICAL_HARD_RULE_EXTENSION].join('\n');
}
```

### Pattern 3: Pre-rendered string in ChrisContextExtras (PSURF-03)

**What:** `psychologicalProfiles?: string` field added to `ChrisContextExtras` interface — a sibling to the existing `operationalProfiles?: string`.

**When to use:** ALWAYS pass the pre-rendered string, never the structured `PsychologicalProfiles` object. Keeps `personality.ts` ignorant of profile internals (single-responsibility: render the prompt; don't compute injection scope).

**Source:** [VERIFIED: `src/chris/personality.ts:39-43`]:
```typescript
// src/chris/personality.ts:39 (existing)
export interface ChrisContextExtras {
  language?: string;
  declinedTopics?: DeclinedTopic[];
  operationalProfiles?: string;
}
```

**Phase 39 extension (one line):**
```typescript
export interface ChrisContextExtras {
  language?: string;
  declinedTopics?: DeclinedTopic[];
  operationalProfiles?: string;
  psychologicalProfiles?: string;   // ← Phase 39 PSURF-03
}
```

### Pattern 4: Template-substitution prepending (PSURF-03)

**What:** Inside `buildSystemPrompt` for REFLECT and PSYCHOLOGY cases (and only those two), prepend `psychologicalProfiles` ABOVE `operationalProfiles` ABOVE `pensieveContext`.

**When to use:** In the three mode cases that already handle `operationalProfiles`-above-pensieve (REFLECT, COACH, PSYCHOLOGY). COACH receives the new field via the interface but the mode handler DOES NOT pass it (silent drop — D-14).

**Source:** [VERIFIED: `src/chris/personality.ts:145-171`] — REFLECT/COACH/PSYCHOLOGY all use the same pattern:
```typescript
// src/chris/personality.ts:145-152 (existing — REFLECT case)
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

**Phase 39 extension (REFLECT + PSYCHOLOGY only):**
```typescript
case 'REFLECT': {
  // D-11 order: psychological → operational → pensieve
  const pensieveWithProfile = [psychologicalProfiles, operationalProfiles, contextValue]
    .filter(Boolean)
    .join('\n\n');
  modeBody = REFLECT_SYSTEM_PROMPT
    .replace('{pensieveContext}', pensieveWithProfile)
    .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
  break;
}
case 'PSYCHOLOGY': { /* same shape */ }
case 'COACH': { /* UNCHANGED — psychologicalProfiles silently dropped at template layer too */ }
```

**Belt-and-suspenders gate:** The mode handler is the PRIMARY gate (D-12) — `coach.ts` doesn't pass `psychologicalProfiles` at all. The template-level gate is secondary; the test surface (D-14) audits both.

### Pattern 5: Sequential reader calls in mode handler (PSURF-03)

**What:** REFLECT + PSYCHOLOGY handlers each gain 2 lines: a `getPsychologicalProfiles()` call and a `formatPsychologicalProfilesForPrompt(profiles, MODE)` call. Sequential `await`, not `Promise.all`.

**When to use:** Both readers are never-throw (Phase 33 + Phase 37); both query single-row `name='primary'` sentinels — sub-50ms wall-clock total. Sequential is simpler to read (D-16 defers parallelism to v2.6.1).

**Source:** [VERIFIED: `src/chris/modes/reflect.ts:75-87`]:
```typescript
// src/chris/modes/reflect.ts:75-87 (existing)
// Phase 35 D-14 — read operational profiles, format for prompt, pass via extras.
const profiles = await getOperationalProfiles();
const operationalProfiles = formatProfilesForPrompt(profiles, 'REFLECT');

const history = await buildMessageHistory(chatId);
const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, {
  language,
  declinedTopics,
  operationalProfiles,
});
```

**Phase 39 addition (~4 lines, plus new import):**
```typescript
import {
  getOperationalProfiles,
  formatProfilesForPrompt,
  getPsychologicalProfiles,                                    // ← NEW
  formatPsychologicalProfilesForPrompt,                        // ← NEW
} from '../../memory/profiles.js';

// (existing operational block) ...
const profiles = await getOperationalProfiles();
const operationalProfiles = formatProfilesForPrompt(profiles, 'REFLECT');

// NEW — Phase 39 PSURF-03
const psychProfiles = await getPsychologicalProfiles();
const psychologicalProfiles = formatPsychologicalProfilesForPrompt(psychProfiles, 'REFLECT');

const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, {
  language,
  declinedTopics,
  operationalProfiles,
  psychologicalProfiles,                                       // ← NEW
});
```

### Pattern 6: `/profile` command per-dimension reply loop (PSURF-04)

**What:** Replace `MSG.m011Placeholder` at line 627 with a `for` loop over `['hexaco', 'schwartz', 'attachment']` emitting one `ctx.reply` per profile type.

**When to use:** Mirrors the existing operational pattern at lines 623-625 (`for (const dim of dimensions) { await ctx.reply(formatProfileForDisplay(dim, profiles[dim], lang)); }`).

**Source:** [VERIFIED: `src/bot/handlers/profile.ts:607-638`]:
```typescript
// src/bot/handlers/profile.ts:607-638 (existing — current /profile body)
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
    await ctx.reply(MSG.m011Placeholder[lang]);                  // ← line 627 — Phase 39 replaces this
  } catch (err) { /* genericError */ }
}
```

**Phase 39 replacement (Plan 39-02):**
```typescript
const psychProfiles = await getPsychologicalProfiles();
const psychTypes: PsychologicalProfileType[] = ['hexaco', 'schwartz', 'attachment'];
for (const type of psychTypes) {
  await ctx.reply(formatPsychologicalProfileForDisplay(type, psychProfiles[type], lang));
}
// (no final wrap-up — the 3 replies replace the single m011Placeholder reply exactly)
```

Sequential awaits keep Telegram message ordering deterministic (per Phase 35 D-18 rationale — `Promise.all` does NOT guarantee arrival order at the client).

### Pattern 7: Insufficient-data branch with word-count countdown (PSURF-04 + D-19)

**What:** `formatPsychologicalProfileForDisplay` returns `"HEXACO: insufficient data — need N more words"` when `overall_confidence === 0` and `word_count < 5000`, with `N = max(0, 5000 - word_count)`.

**Why distinct from operational:** Operational uses "Chris needs more entries about your {dimension}" (entry-count phrasing). Psychological uses word-count countdown because `MIN_SPEECH_WORDS = 5000` from Phase 37 PSCH-08 is the empirically-grounded threshold.

**Source for word_count access:** `getPsychologicalProfiles` returns `ProfileRow<T>` which currently exposes `data`, `confidence`, `lastUpdated`, `schemaVersion`. The `wordCount` column is STRIPPED by `stripPsychologicalMetadataColumns` [VERIFIED: `src/memory/profiles.ts:288-315`] — Phase 37 did NOT thread it through to `ProfileRow<T>`.

**⚠️ IMPORTANT OPEN QUESTION:** The current `ProfileRow<T>` shape does NOT include `wordCount`. The display formatter needs `word_count` to compute `N = 5000 - word_count`. This means either:
1. **(A) Extend `ProfileRow<T>`** to include `wordCount?: number` (additive — operational rows would have `undefined`)
2. **(B) Add a second exported field** to `PsychologicalProfiles` (e.g., `PsychologicalProfilesWithMeta`) for the display reader
3. **(C) Compute a separate `wordCount` SELECT** in the `/profile` handler before rendering

**Recommend (A):** extend `ProfileRow<T>` with `wordCount?: number` as an optional field. The reader at `readOnePsychologicalProfile` strips it (line 305) — flipping that to retain it adds ~3 lines. The operational reader leaves the field `undefined` (existing call sites unaffected). This unblocks the insufficient-data branch with minimal blast radius. The planner should flag this as a Plan 39-02 prerequisite (or push the change into Plan 39-01 if the prompt-side formatter needs word counts too — D-06 says "across N words" implying it does).

**Verification:** The CONTEXT.md D-19 text says `"HEXACO: insufficient data — need N more words" where N = max(0, 5000 - word_count)` and the <specifics> section line 251 says `word_count_at_last_run` from Phase 37 enables this without re-querying. But `wordCount` (not `word_count_at_last_run`) is what the current display needs, and BOTH columns are stripped in line 296-297 of `profiles.ts`. The planner MUST decide whether to thread `wordCount` (current `text.trim().split(/\s+/)…length` snapshot) or `wordCountAtLastRun` (last cron-fire snapshot). For an insufficient-data UX countdown after the first cron fires below threshold, `wordCountAtLastRun` is the right column (that's what triggered the skip).

### Pattern 8: Inline-snapshot golden test (PSURF-05 / HARD CO-LOC #M11-3)

**What:** `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` using `toMatchInlineSnapshot()` with deterministic `vi.setSystemTime` anchor and inline `MOCK_PSYCH_PROFILES` fixtures.

**When to use:** Display formatter changes force a deliberate `npx vitest -u` snapshot update — the diff lands in the PR. M010 SURF-04 pattern.

**Source:** [VERIFIED: `src/bot/handlers/__tests__/profile.golden.test.ts:36-62` for time setup + 199-284 for fixture shape + 286-494 for inline snapshots].

```typescript
// Skeleton (planner produces canonical form):
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { formatPsychologicalProfileForDisplay } from '../profile.js';
import type { ProfileRow } from '../../../memory/profiles.js';
import type {
  HexacoProfileData,
  SchwartzProfileData,
  AttachmentProfileData,
} from '../../../memory/profiles/psychological-schemas.js';

const FIXED_NOW = new Date('2026-06-15T00:00:00Z');
beforeAll(() => vi.setSystemTime(FIXED_NOW));
afterAll(() => vi.useRealTimers());

// 4 scenarios × language slots reserved (per D-24)
//   1. all-populated  (EN)
//   2. all-insufficient  (EN)
//   3. mixed: HEXACO populated + Schwartz below-floor + Attachment deferred  (EN)
//   4. FR + RU language hook slots (scenario 1 fixture re-used)

describe('formatPsychologicalProfileForDisplay — populated HEXACO (EN)', () => {
  it('renders all 6 dim score lines with confidence qualifier per D-07', () => {
    expect(formatPsychologicalProfileForDisplay('hexaco', POPULATED_HEXACO, 'English'))
      .toMatchInlineSnapshot(/* generated by vitest -u */);
  });
});
// ... etc per D-25
```

**Per CONTEXT.md D-25:** Use `describe.each` parametrization across `['English', 'French', 'Russian']` for scenarios 1-3. Scenario 4 explicitly snapshots FR + RU as separate `it` blocks to lock the structural shape so future translation passes don't churn the snapshot.

### Pattern 9: COACH negative-invariant test (PSURF-05 + D-14)

**What:** A vitest test at `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` that reads `coach.ts` as a file and asserts `grep` zero matches for a regex of psych vocabulary tokens.

**Why:** Phase 39 PSURF-05 names this verbatim. The test prevents future "let's also inject in COACH" PRs that would re-introduce the D027 trait-authority circular-reasoning risk.

**Source for shape:** [VERIFIED: `src/memory/profiles/__tests__/psych-boundary-audit.test.ts`] — the existing two-directional D047 boundary audit is the structural mirror:

```typescript
// Sketch (planner produces canonical form):
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = resolve(dirname(__filename), '..', '..', '..', '..');
const COACH_FILE = 'src/chris/modes/coach.ts';

// Word-boundary regex — vocabulary tokens that, if present in coach.ts,
// indicate either active or accidental psychological-profile wiring.
const PSYCH_VOCAB = /\b(psychological|getPsychologicalProfiles|formatPsychologicalProfilesForPrompt|hexaco|schwartz|attachment|HEXACO|SCHWARTZ|ATTACHMENT|PSYCHOLOGICAL_PROFILE_INJECTION_MAP|PSYCHOLOGICAL_HARD_RULE_EXTENSION)\b/;

describe('PSURF-05: COACH handler is psychological-profile-isolated (D027 Hard Rule)', () => {
  it(`${COACH_FILE} contains zero psychological-vocabulary references`, async () => {
    const src = await readFile(resolve(PROJECT_ROOT, COACH_FILE), 'utf8');
    const hits: { line: number; text: string }[] = [];
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (PSYCH_VOCAB.test(line)) hits.push({ line: i + 1, text: line.trim() });
    }
    expect(
      hits,
      `D027 Hard Rule violation: ${COACH_FILE} references psychological-profile vocabulary at:\n` +
        hits.map((h) => `  line ${h.line}: ${h.text}`).join('\n') +
        '\n\nCOACH must not inject psychological profiles. Trait → coaching-conclusion is ' +
        'circular reasoning ("you should X because you score high on Y"). See PITFALLS.md §1.',
    ).toEqual([]);
  });
});
```

**Regex precision notes:**
- The token `'attachment'` is intentionally included (the third profile type) — it would only appear in coach.ts if someone explicitly imported attachment data
- The token `'psychological'` (case-sensitive) catches both lowercase identifier prefix and PascalCase if present
- The capital-`HEXACO` / `SCHWARTZ` / `ATTACHMENT` patterns catch constant-style references
- **Do NOT include** generic words like `'profile'` (operational profiles legitimately appear in coach.ts), `'trait'`, `'personality'` (might appear in legitimate JSDoc unrelated to psych data) — keep the regex narrow to the codebase-specific identifiers

**Failure message phrasing:** LOUD — name the D027 Hard Rule violation explicitly, cite PITFALLS.md §1, explain WHY the test exists. The reviewer reading the test failure should immediately understand the architectural reason.

### Anti-Patterns to Avoid

- **Single merged INJECTION_MAP** — Would force a union value type and lose nominal type-safety. CONTEXT.md D-03 locks the distinct-constants choice.
- **Redeclaring the Hard Rule footer text inside the formatter** — IMPORT from `src/memory/psychological-profile-prompt.ts:144` so the text is single-source-of-truth across inference (Phase 38) + consumer (Phase 39). Any phrasing change must propagate to both call sites or the structural test (Plan 38-01 already asserts each line of `PSYCHOLOGICAL_HARD_RULE_EXTENSION` is verbatim) will fail.
- **Promise.all over the two reader calls** — Sequential is simpler and the wall-clock cost is negligible (~50ms). Premature optimization complicates handler readability for zero user benefit at single-user scale.
- **Promise.all over the three `/profile` `ctx.reply` calls** — Telegram does NOT guarantee message arrival order under concurrent emit. Sequential awaits preserve render order (Phase 35 D-18).
- **Markdown `parse_mode`** — Phase 35 D-17 codebase policy. Profile fields can contain `*`/`_` characters; Markdown parsing would corrupt them. Plain-text only.
- **Third-person framing in `/profile` output** — Phase 35 M010-07 mitigation; the existing operational golden test pins this. Phase 39 display formatter MUST emit second-person consistent with M010 framing.
- **`vi.useFakeTimers`** — D-02 from Phase 18 onward. Replaces postgres-keepalive timers and breaks the suite. Use `vi.setSystemTime` only.
- **Computing wordCount inside the formatter via re-querying the DB** — formatter is pure (no I/O). `wordCount`/`wordCountAtLastRun` MUST come in via the `ProfileRow<T>` shape (see Open Question #1 below).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Psychological profile read | Custom `SELECT` from psych tables | `getPsychologicalProfiles()` from `src/memory/profiles.ts:408` | Already shipped (Phase 37); never-throw + 3-layer Zod parse defense |
| Profile data types | Hand-typed interfaces | Import `HexacoProfileData`/`SchwartzProfileData`/`AttachmentProfileData` from `src/memory/profiles/psychological-schemas.ts` | Single source of truth (Zod-inferred from Phase 37); changes propagate |
| Hard Rule footer text | Hand-written 8-line block in `formatPsychologicalProfilesForPrompt` | Import `PSYCHOLOGICAL_HARD_RULE_EXTENSION` from `psychological-profile-prompt.ts:144` | Phase 38 Plan 38-01's structural test asserts each line verbatim; duplication would drift |
| Section title localization | New per-handler localization scheme | Extend existing `MSG` map (lines 111-369 of `profile.ts`) with new keys | Mirrors operational `MSG.sectionTitle` shape; `MSG.psychologicalSections.hexaco.English/French/Russian` |
| Lang narrowing | Hand-typed string union check | `langOf` + `Lang` from `src/chris/language.ts` (already re-exported from `profile.ts:80`) | Existing pattern; M010 already locked this |
| Inline snapshot test plumbing | New custom snapshot infra | `toMatchInlineSnapshot()` from vitest 4.1.2 (M010 SURF-04 pattern in `profile.golden.test.ts`) | Vitest built-in; deterministic with `vi.setSystemTime` anchor |
| Confidence qualifier mapping | Inline if/else chains scattered across formatters | Single private `qualifierFor(c: number): string` function inside the prompt formatter (D-07) | Localized; one source for `<0.3 / 0.3-0.6 / ≥0.6` thresholds |
| Negative-invariant boundary check | Test that imports COACH and inspects runtime state | File-read + regex sweep (`psych-boundary-audit.test.ts` pattern) | Doesn't depend on coach.ts being importable in test context; <1s runtime; catches `import` statements + code references uniformly |

**Key insight:** Every external surface Phase 39 touches has an existing shipped sibling from M010. The bulk of Phase 39 is "copy the operational shape, append `Psychological` to the names, swap the data shape, append the Hard Rule footer, add the COACH negative-invariant test." Hand-rolling anything new beyond the locked CONTEXT.md decisions is wasted effort and reintroduces drift risk.

## Common Pitfalls

### Pitfall 1: D027 Hard Rule sycophancy via trait-authority framing (LOAD-BEARING)

**What goes wrong:** Sonnet receives "Conscientiousness: 4.5/5.0 (confidence 0.7)" in the system prompt and constructs responses like "Given your strong conscientiousness, your instinct to plan carefully here is sound." This is the exact D027 Hard Rule violation — telling Greg he is right because of who he is, but now with a numeric score anchoring the flattery.

**Why it happens:** The natural prompt-engineering pattern is to inject trait scores as facts. Without explicit framing, Sonnet treats them as authoritative. PITFALLS.md §1 names this as THE primary pitfall this entire phase exists to mitigate.

**How to avoid (Phase 39's load-bearing mitigation):**
1. **Block header** uses epistemic-distance language verbatim: `"## Psychological Profile (inferred — low precision, never use as authority)"`
2. **Per-dim qualifier** (D-07) explicitly downgrades confidence: `"confidence 0.6 — moderate evidence"` not `"confidence 0.6"`
3. **Inline footer** at the BOTTOM of the psych block (D-11 recency-bias) — the verbatim `PSYCHOLOGICAL_HARD_RULE_EXTENSION` from Phase 38, imported not re-declared
4. **COACH is provably absent** from the injection map AND from the handler (D-14 negative-invariant test)

**Warning signs in code review:**
- `formatPsychologicalProfilesForPrompt` references trait scores without confidence qualifier
- Hard Rule footer text is re-typed inside `profiles.ts` instead of imported
- A future PR adds `'COACH'` as a key to `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` — must fail compile (key union narrowed) AND fail test (coach-psychological-isolation regex sweep)

**Warning signs at runtime (Phase 40 PMT-06 lives here):**
- Sonnet emits phrases matching `'consistent with your'`, `'given your [trait]'`, `'as someone with your'`, `'aligns with your'`, `'fits your'` — adversarial Hard-Rule patterns documented in REQUIREMENTS PMT-06

### Pitfall 2: Token-budget creep on REFLECT/PSYCHOLOGY system prompts

**What goes wrong:** The REFLECT system prompt already injects operational profile (~4 dims × up to 2000 chars = up to 8000 chars) + pensieve context (variable). Adding psychological profile (6 HEXACO + 10 Schwartz = 16 lines × ~70 chars = ~1100 chars + 500-char Hard Rule footer = ~1600 chars total) brings the total system prompt above 15-20k chars. PITFALLS.md §5 warns about this token explosion class.

**Why it happens:** Each dim renders compactly per D-08 (`"HEXACO Openness: 4.2 / 5.0 (confidence 0.6 — moderate evidence)"` is ~70 chars), but the cumulative weight matters when REFLECT already injects 4 operational dimensions at up to 2000 chars each.

**How to avoid:**
- Phase 39 does NOT add a per-dim char cap for psych dims (per CONTEXT.md — compact format makes this unneeded)
- D-09: skip individual dims with `null` score OR `confidence === 0` — first cron fire produces a populated profile of only the dims that scored; partial populations don't pad with empty lines
- D-05.c: if ALL dims are zero-confidence, the entire profile is skipped (the block doesn't render at all)
- **Validation:** Add a structural assertion in Plan 39-01's unit tests asserting the rendered block fits inside a reasonable budget (~3000 chars max for fully-populated HEXACO + Schwartz with footer)

**Warning signs:** REFLECT system prompt total length > 20,000 chars under full population. Test against this is cheap — `expect(systemPrompt.length).toBeLessThan(25000)` is a regression detector.

### Pitfall 3: `wordCount` not threaded through `ProfileRow<T>` blocks insufficient-data UX

**What goes wrong:** D-19's insufficient-data branch displays `"HEXACO: insufficient data — need N more words"` where `N = max(0, 5000 - word_count)`. But the current `ProfileRow<T>` shape (`src/memory/profiles.ts:58`) is `{ data, confidence, lastUpdated, schemaVersion }` — `wordCount` is STRIPPED by `stripPsychologicalMetadataColumns` (lines 288-315). The display formatter can't compute N without it.

**Why it happens:** Phase 37 designed the `ProfileRow<T>` to be operational/psychological-agnostic. The strip helper exists to keep the parse boundary clean — but it threw away metadata Phase 39 needs.

**How to avoid:**
- **Option A (recommended):** Extend `ProfileRow<T>` with `wordCount?: number` (optional — operational rows have `undefined`). One-line interface change + one-line `readOnePsychologicalProfile` field-thread.
- **Option B:** A separate `PsychologicalProfilesWithMeta` exported type for the display path only — heavier diff.
- **Option C:** Re-SELECT word_count inside `handleProfileCommand` before the loop — adds a DB roundtrip; planner should reject this.

**Question for Plan 39-02 (or Plan 39-01 if the prompt-side also needs it):** Is the right column `wordCount` (current substrate scan total) or `wordCountAtLastRun` (last fire's word count)? For "need N more words" UX after the first below-threshold cron fire, `wordCountAtLastRun` is correct — that's the count the cron actually observed; the current `wordCount` (recomputed since then) might mislead Greg about progress. The planner should lock this and document why.

**Warning signs:** Plan 39-02's golden snapshot test passes with hardcoded `N = 4500` fixtures but the live `/profile` invocation against a populated row produces `"need NaN more words"` or `"need undefined more words"` — the ProfileRow extension was forgotten.

### Pitfall 4: FR/RU placeholder churn during snapshot updates

**What goes wrong:** Phase 39 ships FR + RU localization "slots reserved" (per CONTEXT.md D-20 + REQUIREMENTS PSURF-05 verbatim). If the placeholder strategy is "use the English copy" (option A), the golden snapshot for FR/RU shows English text — when proper translations land in v2.6.1, every FR/RU snapshot churns.

**Why it happens:** Inline snapshots commit the exact rendered text. A placeholder strategy that doesn't anticipate the future translation produces high-churn.

**How to avoid (D-20 Claude's Discretion):**
- **Option (a) English copy for FR/RU initial release** — simple but high churn at v2.6.1
- **Option (b) Machine-translated quality placeholders** — medium churn (translations near-final from day 1)
- **Option (c) Explicit `"[FR translation pending]"` markers** — low churn but visibly broken UX

**Recommend (b):** machine-translated quality FR/RU strings shipped from day 1. The M010 SURF-04 precedent: `profile.ts:111-369` ships ~250 lines of EN/FR/RU localization in the M10 Phase 35 plan with no placeholders. The FR/RU translations there are operator-reviewed quality, not machine-translated, but the SHAPE of the M11 expansion mirrors that shape. For psych section titles, EN ↔ FR ↔ RU translation is straightforward:

```typescript
psychologicalSections: {
  hexaco: {
    sectionTitle: { English: 'HEXACO Personality', French: 'Personnalité HEXACO', Russian: 'Личность HEXACO' },
    insufficientData: {
      English: (n: number) => `HEXACO: insufficient data — need ${n} more words`,
      French: (n: number) => `HEXACO : données insuffisantes — il faut ${n} mots de plus`,
      Russian: (n: number) => `HEXACO: недостаточно данных — нужно ещё ${n} слов`,
    },
    // ... etc
  },
}
```

The CONTEXT.md D-20 text says "machine-translate-quality EN copy for FR/RU initial release" — this is option (b). The planner should produce native-grammatical FR/RU translations (Greg speaks both), not literal English passthrough. The golden snapshot for FR/RU then locks the structure WITHOUT requiring re-translation in v2.6.1.

### Pitfall 5: Substitution-order drift between mode handlers

**What goes wrong:** The handler at `reflect.ts` extends `extras` with `psychologicalProfiles`, but the handler at `psychology.ts` accidentally omits it (or vice versa). Result: REFLECT mode injects psych data; PSYCHOLOGY mode doesn't (or worse — the psych section ships but the operational section doesn't).

**Why it happens:** Phase 39 modifies two handler files in parallel. They MUST mirror each other exactly except for the mode-string argument.

**How to avoid:**
- **Phase 35 precedent:** Phase 35 Plan 35-02 added an "injection happens for in-scope modes, absent for out-of-scope modes" parametrized handler test (D-15 in 35-CONTEXT.md). Phase 39 should add the same structural test parametrized over REFLECT/PSYCHOLOGY (psych injection present) + COACH/JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY (psych injection absent — verified by inspecting `extras` passed to `buildSystemPrompt`)
- **Structural test:** loop over the 6 mode-handler files and assert `getPsychologicalProfiles` is imported only by `reflect.ts` and `psychology.ts` — same shape as the COACH-isolation test but parameterized over all 8 mode files
- Claude's Discretion item in CONTEXT.md: "Whether to include a structural sanity test asserting the prompt-template substitution order is exactly psychological → operational → pensieve" — RECOMMEND yes. Cheap to write; catches order regressions across both REFLECT and PSYCHOLOGY cases of `buildSystemPrompt`.

### Pitfall 6: Test fixture data validates types but doesn't trigger every formatter branch

**What goes wrong:** Plan 39-02's golden test seeds `MOCK_PSYCH_PROFILES.populated.hexaco.honesty_humility = { score: 4.5, confidence: 0.7, last_updated: '2026-06-01...' }` for all 6 dims. The "skip null/zero-conf dim" branch (D-09) never fires; a regression in that branch goes undetected.

**Why it happens:** Snapshots assert what they snapshot. If the fixture has no `null` dims, the formatter's `null`-skip path is untested.

**How to avoid:**
- Fixture scenario 3 ("mixed" per D-24) MUST include: HEXACO populated (all 6 dims), Schwartz with SOME dims null/zero-conf and others populated (so render-some-skip-others fires), Attachment deferred. The golden snapshot then locks the "render skipped Schwartz dim row absent from output" invariant.
- Plan 39-01's unit tests for `formatPsychologicalProfilesForPrompt` similarly need a partial-population fixture exercising the per-dim filter loop

## Code Examples

Verified patterns from official sources / current codebase:

### Operational `formatProfilesForPrompt` (structural mirror for Plan 39-01)

```typescript
// Source: src/memory/profiles.ts:446-475 (current main; VERIFIED)
export function formatProfilesForPrompt(profiles: OperationalProfiles, mode: string): string {
  const scope = (PROFILE_INJECTION_MAP as Record<string, readonly Dimension[]>)[mode];
  if (!scope) return '';

  const sections: string[] = [];
  const now = Date.now();

  for (const dim of scope) {
    const row = profiles[dim];
    if (!row) continue;
    if (row.confidence === 0) continue;
    if (dim === 'health' && row.confidence < HEALTH_CONFIDENCE_FLOOR) continue;

    let block = renderDimensionForPrompt(dim, row as ProfileRow<unknown>);
    if (block.length > PER_DIMENSION_CHAR_CAP) {
      block = block.slice(0, PER_DIMENSION_CHAR_CAP - 3) + '...';
    }
    if (now - row.lastUpdated.getTime() > STALENESS_MS) {
      const dateStr = row.lastUpdated.toISOString().slice(0, 10);
      block += `\nNote: profile data from ${dateStr} — may not reflect current state.`;
    }
    sections.push(block);
  }

  if (sections.length === 0) return '';
  return PROFILE_INJECTION_HEADER + '\n\n' + sections.join('\n\n');
}
```

### Phase 38 `PSYCHOLOGICAL_HARD_RULE_EXTENSION` constant (imported verbatim by Plan 39-01)

```typescript
// Source: src/memory/psychological-profile-prompt.ts:144-154 (current main; VERIFIED)
export const PSYCHOLOGICAL_HARD_RULE_EXTENSION = [
  '## Psychological Profile Framing (D027 extension — REQUIRED)',
  '',
  'These trait scores describe statistical tendencies inferred from speech patterns,',
  'NOT facts about who Greg is. You MUST NOT:',
  '- Use these scores to tell Greg he is "the kind of person who..."',
  '- Appeal to his trait scores as evidence that his current reasoning is correct',
  '- Construct advice that validates his existing position by citing his personality',
  'The Hard Rule (D027) applies here with additional force: psychological traits are',
  'not evidence. Evaluate every claim on its merits regardless of what the profile says.',
].join('\n');
```

**Plan 39-01 imports this; does NOT re-declare. Phase 38 Plan 38-01's structural test (`psychological-profile-prompt.test.ts`) asserts each line is verbatim — any phrasing change there propagates here automatically.**

### Existing REFLECT mode handler (structural mirror for Phase 39 wiring)

```typescript
// Source: src/chris/modes/reflect.ts:11, 75-87 (current main; VERIFIED)
import { getOperationalProfiles, formatProfilesForPrompt } from '../../memory/profiles.js';
// ...
// Phase 35 D-14 — read operational profiles, format for prompt, pass via extras.
const profiles = await getOperationalProfiles();
const operationalProfiles = formatProfilesForPrompt(profiles, 'REFLECT');

const history = await buildMessageHistory(chatId);
const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, {
  language,
  declinedTopics,
  operationalProfiles,
});
```

### Existing `/profile` command body (structural mirror for Plan 39-02)

```typescript
// Source: src/bot/handlers/profile.ts:607-638 (current main; VERIFIED)
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
    await ctx.reply(MSG.m011Placeholder[lang]);   // ← line 627 — Phase 39 replaces with 3 new replies
  } catch (err) {
    logger.warn(
      { chatId, error: err instanceof Error ? err.message : String(err) },
      'profile.command.error',
    );
    await ctx.reply(MSG.genericError[lang]);
  }
}
```

### Existing `formatProfileForDisplay` insufficient-data branch (structural mirror for Plan 39-02)

```typescript
// Source: src/bot/handlers/profile.ts:397-410 (current main; VERIFIED)
export function formatProfileForDisplay(
  dimension: Dimension,
  profile: ProfileRow<unknown> | null,
  lang: Lang,
): string {
  // D-21: null or zero-confidence → localized actionable progress indicator.
  if (profile === null || profile.confidence === 0) {
    return MSG.insufficientData[lang](dimension);
  }
  const confidencePct = Math.round(profile.confidence * 100);
  const title = `${MSG.sectionTitle[dimension][lang]} (${MSG.confidence[lang]} ${confidencePct}%)`;
  // ...
}
```

### Boundary-audit test (structural mirror for Plan 39-01's COACH negative-invariant test)

```typescript
// Source: src/memory/profiles/__tests__/psych-boundary-audit.test.ts:73-129 (current main; VERIFIED)
const OPERATIONAL_VOCAB = /\b(jurisdictional|capital|health|family)\b/;
const PSYCHOLOGICAL_VOCAB = /\b(hexaco|schwartz|attachment)\b/;

// ... per-line scan with findHits + formatHits helpers, expect(hits).toEqual([])
```

### Existing inline-snapshot golden test (structural mirror for Plan 39-02 HARD CO-LOC #M11-3)

```typescript
// Source: src/bot/handlers/__tests__/profile.golden.test.ts:36-62, 199-284, 286-494 (current main; VERIFIED)
const FRESH_DATE = new Date('2026-05-13T00:00:00Z');
const STALE_DATE = new Date('2026-04-01T00:00:00Z');  // FRESH_DATE − 42 days

beforeAll(() => { vi.setSystemTime(FRESH_DATE); });
afterAll(() => { vi.useRealTimers(); });

const MOCK_PROFILES = {
  jurisdictional: {
    null: null as ProfileRow<JurisdictionalProfileData> | null,
    zeroConfidence: { data: JURIS_ZERO_DATA, confidence: 0, lastUpdated: FRESH_DATE, schemaVersion: 1 } as ProfileRow<...>,
    populatedFresh: { ... },
    populatedStale: { ... },
  },
  // ... 4 dimensions × 4 states
};

describe('formatProfileForDisplay — jurisdictional (EN)', () => {
  it('populated-fresh profile → full second-person summary, no staleness note', () => {
    expect(
      formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.populatedFresh, 'English'),
    ).toMatchInlineSnapshot(`
      "Jurisdictional Profile (confidence 72%)

      You're currently in Tbilisi, Georgia.
      ..."
    `);
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single operational `PROFILE_INJECTION_MAP` for all profile types | Two distinct maps — `PROFILE_INJECTION_MAP` (Dimension[]) + `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` (PsychologicalProfileType[]) | Phase 39 (this phase) | Preserves nominal type-safety; COACH-isolation enforced at compile time |
| `formatProfilesForPrompt` with staleness check | Phase 39 sibling has NO staleness check | Phase 39 (this phase) | Psych profiles run monthly — staleness already encoded in the cadence |
| `formatProfileForDisplay` 4-case state model (null / zero-conf / populated-fresh / populated-stale) | Phase 39 sibling has 4-case model BUT different cases: populated / insufficient-data (word-count countdown) / attachment-deferred / never-fired | Phase 39 (this phase) | Psych UX requires actionable countdowns + deferred Attachment messaging |
| Operational golden snapshot covers 4 dimensions × 4 states = 16 EN + 6 FR/RU smoke tests | Plan 39-02 golden snapshot covers 4 scenarios × 3 languages (EN full + FR/RU slots reserved) | Phase 39 (this phase) | Aligned with REQUIREMENTS PSURF-05 verbatim 4-scenario contract |

**Deprecated/outdated:**
- None — Phase 39 is purely additive; nothing in M010 surfaces deprecates

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The display formatter needs `wordCount` (or `wordCountAtLastRun`) from the psych row to render the insufficient-data N-countdown | Pitfall 3 / Pattern 7 | If the planner instead chooses to omit the countdown (display `"HEXACO: insufficient data"` without the N value), the locked CONTEXT.md D-19 text `"need N more words"` is contradicted — surfaces during planning, blocks Plan 39-02 |
| A2 | `wordCountAtLastRun` (not `wordCount`) is the right column for the countdown — it reflects what the cron observed at skip time, not the current substrate scan | Pitfall 3 | If `wordCount` is used instead, Greg sees a countdown that moves between `/profile` invocations even when no new psych cron has fired — UX confusion |
| A3 | Machine-translate-quality FR + RU psych section translations are within the planner's scope to produce in Plan 39-02 | Pitfall 4 / Pattern 8 | If the planner ships English placeholders for FR/RU and the snapshot locks them, v2.6.1 translation pass will churn all FR/RU snapshots — high diff noise |
| A4 | The 4 fixture scenarios in PSURF-05 (all-populated / all-insufficient / mixed / FR+RU slots) collectively exercise every branch of `formatPsychologicalProfileForDisplay` | Pitfall 6 | If scenario 3 (mixed) doesn't include the "skip null dim within partially-populated profile" case, the per-dim filter loop in the formatter goes untested |
| A5 | `psychology.ts` should receive the same `psychological → operational → pensieve` substitution order as `reflect.ts` | Pattern 4 / Pitfall 5 | Locked by CONTEXT.md D-11; this is just confirming the order applies symmetrically to PSYCHOLOGY (no asymmetry between the two in-scope modes) |
| A6 | Adding `psychologicalProfiles?: string` to `ChrisContextExtras` is a one-line additive change that does NOT break the 8+ existing `buildSystemPrompt` call sites | Pattern 3 | If TypeScript narrows the field as required (forgotten `?:`), 7 of 8 call sites fail to compile — surfaces immediately via `npx tsc --noEmit`, planner-time blocker |
| A7 | The COACH negative-invariant test failure message should cite PITFALLS.md §1 + D027 verbatim, not just say "regression detected" | Pattern 9 | If the message is generic, a future reviewer responding to the test failure may not understand the architectural reason and could be tempted to silence the test rather than revert the offending change |
| A8 | The `for (const type of ['hexaco', 'schwartz', 'attachment'])` loop pattern (CONTEXT.md Claude's Discretion) is the right shape for the `/profile` 3-reply emit, matching the operational 4-dim loop pattern | Pattern 6 | Three inline `await ctx.reply()` calls instead of a loop produces equivalent behavior but diverges stylistically from the existing operational shape — minor; planner chooses |

**If this table is empty:** All claims in this research were verified or cited.

## Open Questions

1. **Should `ProfileRow<T>` be extended with `wordCount?: number` and `wordCountAtLastRun?: number`?**
   - What we know: `getPsychologicalProfiles()` strips these columns at lines 296-297 of `profiles.ts` per `stripPsychologicalMetadataColumns`. They exist in the row from the SELECT but never reach the consumer.
   - What's unclear: Whether to extend `ProfileRow<T>` (clean — operational ignores the optional field; affects both operational and psych consumers but only psych will populate it) OR introduce a parallel `PsychologicalProfileRow<T>` shape (separate but redundant) OR re-query at display time (adds DB roundtrip — rejected).
   - Recommendation: **Extend `ProfileRow<T>` with `wordCount?: number` and `wordCountAtLastRun?: number` as optional fields.** Update `readOnePsychologicalProfile` (line 371-378) to populate them; operational `readOneProfile` (line 153-158) leaves them `undefined`. This unblocks D-19 with minimal blast radius. Belongs in Plan 39-01 or Plan 39-02 — planner's call; recommend Plan 39-01 since the prompt-side block per D-06 also mentions "across N words" which would benefit from the same field.

2. **Should the prompt-side block include word-count framing per D-06?**
   - What we know: D-06 example rendered text is `"HEXACO Openness: 4.2 / 5.0 (confidence 0.6 — moderate evidence across N words)"`.
   - What's unclear: Is `N` the per-profile-type `wordCount`, or per-dim, or the substrate `wordCount` from the most recent cron fire?
   - Recommendation: **Per-profile-type `wordCount` from the row** (HEXACO row's `wordCount` field, same value renders for all 6 HEXACO dim lines). Reuses the same `ProfileRow<T>` field extension from Open Question #1.

3. **Should the structural sanity test for "psychological → operational → pensieve" substitution order be included?**
   - What we know: CONTEXT.md Claude's Discretion item recommends but defers to planner.
   - What's unclear: How exhaustive — REFLECT only, REFLECT + PSYCHOLOGY both, or all 8 modes?
   - Recommendation: **REFLECT + PSYCHOLOGY** (the two in-scope modes). One test per mode that asserts when both `psychologicalProfiles` and `operationalProfiles` are passed, the rendered system prompt has psychological-block-substring BEFORE operational-block-substring BEFORE pensieve-context-substring. Belt-and-suspenders for D-11; ~10 lines of test code; locks the order against future refactors.

4. **Localization wording for the new MSG keys — exact phrasing for FR + RU?**
   - What we know: M010's `MSG.fields.*.{French,Russian}` localization is operator-reviewed quality (lines 211-368 of `profile.ts`); not machine-translated.
   - What's unclear: Whether Plan 39-02 produces operator-reviewed FR/RU strings (delays Plan 39-02 by hours of careful translation work) OR machine-translate-quality strings reviewed at the Plan 39-02 verification stage.
   - Recommendation: **Machine-translate-quality strings reviewed at verification.** Greg speaks FR + RU and reviews the verification. The planner produces strings that are grammatically correct and semantically faithful; final polish happens at `/gsd-verify-work`. This avoids blocking Plan 39-02 on a localization-quality side-quest. Track in Pitfall 4.

5. **Plan ordering — strict 39-01 → 39-02 or parallelizable?**
   - What we know: CONTEXT.md D-02 locks strict sequencing.
   - What's unclear: Whether Plan 39-02 needs any symbols from Plan 39-01 at compile time.
   - Recommendation: **Strict sequencing.** Plan 39-02 may reference the injection-map state for the `/profile` command's "this profile is injected into REFLECT/PSYCHOLOGY" disclosure text (deferred Claude's Discretion item in CONTEXT.md). Even if the planner chooses NOT to include that disclosure, ordering Plan 39-01 first matches Phase 35 hard-sequencing discipline.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All TypeScript execution | ✓ | 24.14.1 | — |
| TypeScript compiler | Phase 39 type checks | ✓ | 5.9.3 | — |
| Vitest | Phase 39 unit + golden + integration tests | ✓ | 4.1.2 | — |
| Docker postgres (via `bash scripts/test.sh`) | Integration tests for handler wiring | ✓ | n/a | — |
| `@anthropic-ai/sdk` | Indirectly used by REFLECT + PSYCHOLOGY mode handlers (not directly by Phase 39 code) | ✓ | ^0.90.0 | — |
| `grammy` | `/profile` Telegram handler (`ctx.reply`) | ✓ | ^1.31.0 | — |
| Phase 37 deliverables | `getPsychologicalProfiles` + types | ✓ | shipped 2026-05-13 | — |
| Phase 38 deliverables | `PSYCHOLOGICAL_HARD_RULE_EXTENSION` constant | ✓ | shipped 2026-05-14 | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

**Live integration testing:** Plan 39-02 golden snapshot test runs offline (vitest + inline fixtures, no DB needed). Plan 39-01 handler-injection structural tests may use `bash scripts/test.sh` for a real postgres setup (per CLAUDE.md memory: always run full Docker tests) but the unit-level coverage of `formatPsychologicalProfilesForPrompt` is pure-function + no DB.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 [VERIFIED: package.json] |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run <path>` |
| Full suite command | `bash scripts/test.sh` (Docker postgres + full vitest run) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PSURF-01 | `PSYCHOLOGICAL_PROFILE_INJECTION_MAP` is distinct constant; REFLECT/PSYCHOLOGY map to ['hexaco','schwartz']; COACH absent | unit | `npx vitest run src/memory/__tests__/profiles.test.ts -t "PSYCHOLOGICAL_PROFILE_INJECTION_MAP"` | ❌ Wave 0 (extend existing) |
| PSURF-02 (empty cases) | `formatPsychologicalProfilesForPrompt` returns `""` for null/below-threshold/zero-conf/mode-not-in-map | unit | `npx vitest run src/memory/__tests__/profiles.test.ts -t "formatPsychologicalProfilesForPrompt empty"` | ❌ Wave 0 (extend existing) |
| PSURF-02 (populated) | `formatPsychologicalProfilesForPrompt` renders block with per-dim score lines + Hard Rule footer present | unit | `npx vitest run src/memory/__tests__/profiles.test.ts -t "formatPsychologicalProfilesForPrompt populated"` | ❌ Wave 0 (extend existing) |
| PSURF-02 (footer verbatim) | Rendered block contains `PSYCHOLOGICAL_HARD_RULE_EXTENSION` substring at the END (recency-bias position) | unit | `npx vitest run src/memory/__tests__/profiles.test.ts -t "Hard Rule footer at bottom"` | ❌ Wave 0 |
| PSURF-03 (ChrisContextExtras) | `psychologicalProfiles?: string` field on interface | unit | `npx tsc --noEmit` (type-level — passes if field present) | ✓ (existing tsc) |
| PSURF-03 (REFLECT wiring) | REFLECT handler calls `getPsychologicalProfiles` + passes formatted block to `buildSystemPrompt` | handler-level integration | `npx vitest run src/chris/modes/__tests__/reflect.test.ts -t "psychological"` | partial — extend existing |
| PSURF-03 (PSYCHOLOGY wiring) | Same shape as REFLECT for PSYCHOLOGY mode | handler-level integration | `npx vitest run src/chris/modes/__tests__/psychology.test.ts -t "psychological"` | partial — extend existing |
| PSURF-03 (COACH NOT modified) | `coach.ts` source file contains zero `\b(psychological\|getPsychologicalProfiles\|hexaco\|schwartz\|...)\b` matches | regex sweep | `npx vitest run src/chris/modes/__tests__/coach-psychological-isolation.test.ts` | ❌ Wave 0 (NEW) |
| PSURF-03 (silent drop) | JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY handlers do NOT import `getPsychologicalProfiles` | regex sweep | `npx vitest run src/chris/modes/__tests__/structural-injection.test.ts` | ❌ Wave 0 (NEW or extend existing handler tests) |
| PSURF-03 (substitution order) | When both `psychologicalProfiles` + `operationalProfiles` passed, psych appears BEFORE operational BEFORE pensieve | unit | `npx vitest run src/chris/__tests__/personality.test.ts -t "substitution order"` | partial — extend existing |
| PSURF-04 (3 replies) | `/profile` command emits 3 ctx.reply calls (HEXACO + Schwartz + Attachment) in addition to the 4 operational | handler-level integration | `npx vitest run src/bot/handlers/__tests__/profile.test.ts -t "psychological sections"` | partial — extend existing |
| PSURF-04 (insufficient branch) | When word_count < 5000, reply contains `"need N more words"` with correct N | handler-level integration | `npx vitest run src/bot/handlers/__tests__/profile.test.ts -t "insufficient"` | partial — extend existing |
| PSURF-04 (attachment branch) | Attachment reply contains `"not yet active (gated on D028..."` regardless of fixture state | handler-level integration | `npx vitest run src/bot/handlers/__tests__/profile.test.ts -t "attachment"` | partial — extend existing |
| PSURF-05 (formatter pure) | `formatPsychologicalProfileForDisplay(profileType, profile, lang)` is a pure function returning string | unit | `npx vitest run src/bot/handlers/__tests__/profile-psychological.golden.test.ts` | ❌ Wave 0 (NEW) |
| PSURF-05 (golden snapshot) | 4 scenarios × FR/RU language slots reserved pass inline-snapshot diff-zero | golden | `npx vitest run src/bot/handlers/__tests__/profile-psychological.golden.test.ts` | ❌ Wave 0 (NEW — HARD CO-LOC #M11-3) |

### Sampling Rate

- **Per task commit:** `npx vitest run <files-just-changed>` — quick (single-file vitest run, ~1-2s per test file, no postgres needed for pure-function tests)
- **Per wave merge:** `bash scripts/test.sh` — full Docker postgres + entire vitest suite (~5-10 minutes; per CLAUDE.md memory MANDATORY)
- **Phase gate:** Full `bash scripts/test.sh` green before `/gsd-verify-work`; 76+ M011-related tests from Phases 37/38 stay green (regression check); 5 pre-existing live-API failures documented in `.planning/phases/38-psychological-inference-engine/deferred-items.md` continue to fail (no Phase 39 regression — these tests don't touch Phase 39 surfaces)

### Wave 0 Gaps

- [ ] `src/bot/handlers/__tests__/profile-psychological.golden.test.ts` — covers PSURF-05; new file; mirrors `profile.golden.test.ts` structure
- [ ] `src/chris/modes/__tests__/coach-psychological-isolation.test.ts` — covers PSURF-03 negative invariant; new file; mirrors `psych-boundary-audit.test.ts` structure
- [ ] Extend `src/memory/__tests__/profiles.test.ts` (if it exists; else create) — covers PSURF-01, PSURF-02 (empty + populated + footer)
- [ ] Extend `src/chris/modes/__tests__/reflect.test.ts` + `psychology.test.ts` — covers PSURF-03 positive wiring
- [ ] (Optional, recommended per Open Question #3) `src/chris/__tests__/personality.test.ts` — extend with substitution-order test for D-11
- [ ] (Optional, recommended) Structural test asserting non-REFLECT/PSYCHOLOGY mode handlers don't import `getPsychologicalProfiles` — could live in `coach-psychological-isolation.test.ts` extended to a multi-file sweep

**Framework install:** Not needed — vitest 4.1.2 already in devDependencies.

## Security Domain

> `security_enforcement` not configured explicitly in `.planning/config.json` — treat as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 39 is internal-only; no new auth surface introduced |
| V3 Session Management | no | No session state introduced; reuses existing Telegram session |
| V4 Access Control | no | `/profile` is unchanged in access-control terms; new replies don't expose new data classes Greg shouldn't see |
| V5 Input Validation | partial — zod | New `formatPsychologicalProfilesForPrompt` receives `PsychologicalProfiles` which is the output of `getPsychologicalProfiles` (already zod-validated at Phase 37 read boundary); no new user input parsed |
| V6 Cryptography | no | No crypto primitives used; substrate hashing is Phase 38's concern, not Phase 39's |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Profile data leakage via Telegram chat history | Information Disclosure | `/profile` is user-initiated by Greg; only Greg's `chatId` receives output (Telegram chat-routing; no broadcast surface). Existing M010 `/profile` shipped 2026-05-13 follows the same pattern; Phase 39 just adds 3 more replies to the same chat |
| Markdown/HTML injection via profile field values | Tampering | D-17 plain-text only (no `parse_mode`) — Telegram renders the strings verbatim, no markup interpretation. Existing operational replies already follow this; Phase 39 inherits |
| Sycophancy → Greg makes decisions on false trait-authority advice | Repudiation / Authority Misuse | **THE PRIMARY THREAT VECTOR.** PITFALLS.md §1 + D027 Hard Rule. Mitigations: epistemic-distance block header (D-06) + per-dim qualifier downgrading (D-07) + verbatim `PSYCHOLOGICAL_HARD_RULE_EXTENSION` footer (D-11) + COACH provably absent (D-14) + Phase 40 PMT-06 live 3-of-3 adversarial test |
| Hard-Rule footer text drift between inference + consumer | Tampering (constant duplication) | Plan 39-01 imports `PSYCHOLOGICAL_HARD_RULE_EXTENSION` verbatim from Phase 38; does NOT re-declare. Phase 38 Plan 38-01's existing structural test asserts each line verbatim — change at the source propagates here |

## Sources

### Primary (HIGH confidence)

- **`src/memory/profiles.ts`** [VERIFIED: read in this research session] — operational + psychological reader implementations (lines 1-415 read); `PROFILE_INJECTION_MAP` at line 87; `formatProfilesForPrompt` at line 446; `getPsychologicalProfiles` at line 408; `stripPsychologicalMetadataColumns` at line 288-315.
- **`src/chris/personality.ts`** [VERIFIED: full read in this research session] — `ChrisContextExtras` at line 39; `buildSystemPrompt` at line 120; REFLECT/COACH/PSYCHOLOGY substitution body at lines 145-171.
- **`src/chris/modes/reflect.ts` + `psychology.ts` + `coach.ts`** [VERIFIED: full read in this research session] — operational profile wiring identical across all 3; Phase 39 mirrors for psych in reflect.ts + psychology.ts only.
- **`src/bot/handlers/profile.ts`** [VERIFIED: full read 1-640 lines in this research session] — existing `/profile` body + `formatProfileForDisplay` + `MSG` localization map + `MSG.m011Placeholder` at line 179, used at line 627.
- **`src/bot/handlers/__tests__/profile.golden.test.ts`** [VERIFIED: full read 1-633 lines in this research session] — exact inline-snapshot pattern Plan 39-02 mirrors.
- **`src/memory/profiles/__tests__/psych-boundary-audit.test.ts`** [VERIFIED: full read in this research session] — exact regex-sweep structural test pattern Plan 39-01's COACH-isolation test mirrors.
- **`src/memory/psychological-profile-prompt.ts:144`** [VERIFIED: read in this research session] — `PSYCHOLOGICAL_HARD_RULE_EXTENSION` constant Plan 39-01 imports verbatim.
- **`src/memory/profiles/psychological-schemas.ts`** [VERIFIED: read in this research session lines 1-120] — `HexacoProfileData` / `SchwartzProfileData` types.
- **`.planning/phases/39-psychological-surfaces/39-CONTEXT.md`** [VERIFIED: full read] — 25 locked decisions D-01..D-25.
- **`.planning/REQUIREMENTS.md`** [VERIFIED: full read] — PSURF-01..05 verbatim requirements text.
- **`.planning/ROADMAP.md`** [VERIFIED: Phase 39 section read lines 115-150] — 5 success criteria + HARD CO-LOC #M11-3.
- **`.planning/research/PITFALLS.md`** [VERIFIED: §1 + §5 read in this research session] — D027 sycophancy injection (§1) is THE load-bearing pitfall this phase mitigates; §5 is the token-budget collision.
- **`.planning/research/SUMMARY.md`** [VERIFIED: lines 1-200 read in this research session] — locked architecture decisions + critical pitfalls prioritization.
- **`.planning/milestones/v2.5-phases/35-surfaces/35-CONTEXT.md`** [VERIFIED: lines 1-140 read in this research session] — DIRECT M010 analog; 35-02 + 35-03 are the Phase 39-01 + 39-02 structural mirrors.
- **`.planning/phases/37-psychological-substrate/37-02-SUMMARY.md`** [VERIFIED: full read in this research session] — what Phase 37 actually shipped: `getPsychologicalProfiles`, `PsychologicalProfileType`, 3-layer Zod defense, types.
- **`.planning/phases/38-psychological-inference-engine/38-01-SUMMARY.md`** [VERIFIED: full read in this research session] — `PSYCHOLOGICAL_HARD_RULE_EXTENSION` shipped; 8-line verbatim D-07 phrasing locked by structural test.
- **`.planning/phases/38-psychological-inference-engine/38-02-SUMMARY.md`** [VERIFIED: full read in this research session] — generators shipped; PGEN-06 unconditional fire locked.
- **`.planning/phases/38-psychological-inference-engine/38-03-SUMMARY.md`** [VERIFIED: full read in this research session] — orchestrator + cron registered; first fire 2026-06-01 09:00 Paris.

### Secondary (MEDIUM confidence)

- **`package.json`** [VERIFIED: read in this research session] — TypeScript 5.7.0 (compiler says 5.9.3 at runtime — slight devDep version drift, not material); vitest 4.1.2; grammy 1.31.0.

### Tertiary (LOW confidence)

- None — all claims are codebase-grounded.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; every symbol used is verified by direct read of current `main` source files.
- Architecture: HIGH — Phase 35 M010 precedent is the proven shape; Phase 37 + Phase 38 already shipped the upstream contract surface; CONTEXT.md locks 25 decisions D-01..D-25.
- Pitfalls: HIGH — PITFALLS.md §1 directly names this phase as the D027 mitigation surface; the inline footer pattern is the lock; the COACH negative-invariant test is the regression detector.
- Open questions: MEDIUM — Open Question #1 (`wordCount` field threading) is real and load-bearing; the planner MUST resolve it before Plan 39-02 implementation. Open Questions #3 + #4 are Claude's-Discretion items with recommended defaults.

**Research date:** 2026-05-14

**Valid until:** 2026-06-14 (30 days for stable substrate; Phase 39 itself is short-cycle so the upstream contracts won't drift)
