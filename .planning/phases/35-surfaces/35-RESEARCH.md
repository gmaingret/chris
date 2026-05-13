# Phase 35: Surfaces — Research

**Researched:** 2026-05-13
**Domain:** TypeScript / Node 22 / Grammy Telegram bot / vitest / Drizzle ORM — refactor + handler + golden-snapshot
**Confidence:** HIGH (all critical claims verified by codebase grep; locked decisions in CONTEXT.md)

## Summary

Phase 35 is a 3-plan, ~13-task internal refactor + wiring + new-handler effort. There is no new external technology, no new dependency, and no new architectural pattern — everything is established precedent within this codebase. The risk surface is concentrated in three places: (1) the atomic 8-call-site `buildSystemPrompt` signature refactor across production + test code (HARD CO-LOC #M10-4), (2) the negative-injection invariant that 5 mode handlers MUST NOT call `getOperationalProfiles()` (M010-08 mitigation), and (3) the golden-output snapshot test for `formatProfileForDisplay` that prevents the M009 first-Sunday weekly_review UX-regression class (M010-07 mitigation, HARD CO-LOC #M10-5).

All 32 decisions in CONTEXT.md are locked. The OQ-3 call-site inventory was captured 2026-05-13 by the discuss-phase pass; this research pass re-ran the grep and **confirms no drift** — the 8 production call sites + 2 named test files match exactly, plus 8 additional test files import `buildSystemPrompt` via `vi.mock` (signature change does not affect them mechanically but their assertion shapes do).

**Primary recommendation:** Execute exactly as CONTEXT.md prescribes. Plan 35-01 ships first (mechanical atomic refactor); plan-checker MUST refuse parallelization with 35-02. Plan 35-02 wires REFLECT/COACH/PSYCHOLOGY through `PROFILE_INJECTION_MAP` + `formatProfilesForPrompt`. Plan 35-03 introduces `src/bot/handlers/profile.ts` with `handleProfileCommand` + `formatProfileForDisplay` + inline-snapshot golden test in the SAME plan (HARD CO-LOC #M10-5). One landmine surfaced during this research: **8 test files (not 2) reference `buildSystemPrompt`** — 6 via `vi.mock` and 2 via direct call. The 6 mocked files need assertion-shape updates (`expect.objectContaining({ language: ... })`), not call-shape migrations. Document this in Plan 35-01.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All 32 decisions D-01..D-32 in `.planning/phases/35-surfaces/35-CONTEXT.md` are locked. Do not re-research alternatives. The condensed list:

- **Plan structure:** 3 plans matching REQUIREMENTS SURF-01..05 mapping. Plans ship strictly sequentially (35-01 → 35-02 → 35-03); no parallelization (D-01, D-02).
- **Signature:** `buildSystemPrompt(mode, pensieveContext?, relationalContext?, extras?: ChrisContextExtras)` with `ChrisContextExtras = { language?: string; declinedTopics?: DeclinedTopic[]; operationalProfiles?: string }` — all optional (D-03, D-04).
- **ACCOUNTABILITY overload preserved verbatim** — `resolution.ts:252-257` migrates positional `rawLang` → `{ language: rawLang }`; the 84-92 comment block in `personality.ts` stays (D-05).
- **8 call sites** enumerated in CONTEXT.md D-06: 5 mode handlers + photos + resolution + 2 named test files. **Mechanical migration:** positional `(...,language, declinedTopics)` → `(...,{ language, declinedTopics })`.
- **Injection placement:** Operational Profile block is prepended to `contextValue` BEFORE `.replace('{pensieveContext}', …)` in REFLECT/COACH/PSYCHOLOGY cases (D-07).
- **PROFILE_INJECTION_MAP** in `src/memory/profiles.ts`: `REFLECT=['jurisdictional','capital','health','family']`, `COACH=['capital','family']`, `PSYCHOLOGY=['health','jurisdictional']` (D-08).
- **Gates:** health `confidence >= 0.5` floor in any mode (D-09); 21-day staleness qualifier appended inline (D-10); 500-token / 2000-char per-dimension cap in `formatProfilesForPrompt` with `…` truncation marker (D-11); empty-string return when no in-scope dimensions render (D-12).
- **Injection header verbatim:** `## Operational Profile (grounded context — not interpretation)` (D-13).
- **Mode-handler call order:** `getOperationalProfiles()` → `formatProfilesForPrompt(profiles, mode)` → `buildSystemPrompt(mode, ..., { ..., operationalProfiles })`. No cache in v1 (D-14).
- **Mode-handler test coverage:** 3 positive (REFLECT/COACH/PSYCHOLOGY) + 5 negative (JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY) (D-15, D-28).
- **Handler at `src/bot/handlers/profile.ts`**; registered in `src/bot/bot.ts` between `/summary` (line 34) and the generic text handler (line 79) (D-16).
- **Plain text only** — no `parse_mode` (D-17). Output is 4 dimension replies + 1 M011 placeholder reply = 5 `ctx.reply()` calls (D-18). EN/FR/RU localized via `getLastUserLanguage(chatId.toString())` (D-19). Second-person framing (D-20). Actionable progress indicator for zero-confidence (D-21). Staleness note when `last_updated > 21 days ago` (D-22). ASCII section dividers (blank-line separators within reply, no `===` or `---` Markdown lines) (D-23).
- **`formatProfileForDisplay`** in same file as handler (HARD CO-LOC #M10-5); pure function (D-24). Test file at `src/bot/handlers/__tests__/profile.golden.test.ts` (D-25). `toMatchInlineSnapshot` (D-26). Coverage matrix: 4 dimensions × 4 cases (null / zero-confidence / populated-fresh / populated-stale) in English; FR/RU via a single language-coverage smoke test (D-27).
- **Test discipline:** No live LLM in Phase 35 (D-32); regression coverage from existing `personality.test.ts` + `engine.test.ts` (D-29); 3+5+map+formatter unit tests in Plan 35-02 (D-30); inline-snapshot suite + handler integration test in Plan 35-03 (D-31).

### Claude's Discretion

- Inline `MSG` map in `profile.ts` (preferred — consistent with summary.ts) vs. extract `src/bot/handlers/_strings.ts` (defer).
- Section header phrasing for `/profile` (planner finalizes capitalization/percentage format; must remain second-person + golden-test asserted).
- Helper extraction `injectOperationalProfiles(mode)` (default: inline; 3 lines × 3 handlers is below abstraction threshold).
- Per-dimension dimension-config object vs. switch-case (default: switch-case in v1).

### Deferred Ideas (OUT OF SCOPE)

- 1h-TTL `getOperationalProfiles()` cache — v2.5.1 candidate
- `injectOperationalProfiles(mode)` helper extraction — revisit if M011/M012 adds patterns
- Per-dimension display config object — switch-case in v1
- DB-backed language detection in `/profile` — only relevant if proactive `/profile` runs from cron later
- `/profile <dimension>` sub-commands — M013 candidate; ANTI-6 in REQUIREMENTS.md excludes profile-editing sub-commands
- DIFF-3 (user-facing time-series profile history) — M013/M014
- DIFF-4 (per-profile Sonnet-generated narratives) — v2.5.1
- Synthetic m010-30days fixture, `--profile-bias`, two-cycle integration test, sparse-fixture test, live 3-of-3 anti-hallucination test, real-DB profile-populate integration test — all Phase 36 (PTEST-01..05)

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SURF-01 | `buildSystemPrompt` refactor to `(mode, pensieveContext, relationalContext, extras: ChrisContextExtras)` — atomic across all call sites (HARD CO-LOC #M10-4) | OQ-3 reconfirmation (this section, "Call Site Reconfirmation"); existing signature at `src/chris/personality.ts:94-100`; ACCOUNTABILITY overload comment at `personality.ts:84-92` preserved verbatim |
| SURF-02 | REFLECT/COACH/PSYCHOLOGY inject `## Operational Profile (grounded context — not interpretation)` block above `{pensieveContext}`; JOURNAL/INTERROGATE/PRODUCE/PHOTOS do NOT receive injection | `PROFILE_INJECTION_MAP` named constant per D-08 + M010-08 mitigation; injection-above-pensieve precedent in `personality.ts:156-159` (Known Facts block); 3 positive + 5 negative test invariants per D-30 |
| SURF-03 | `/profile` Telegram command returns plain-text summary of all 4 profiles with confidence %; psychological section reads M011 placeholder | `summary.ts` precedent (220 lines); `getLastUserLanguage` reader; 5 separate `ctx.reply()` calls per D-18; bot registration slot between line 34 and line 79 of `bot.ts` |
| SURF-04 | `formatProfileForDisplay(profile)` + golden-output snapshot test on `MOCK_PROFILES` fixture (HARD CO-LOC #M10-5) | `toMatchInlineSnapshot` per D-26; 16-case English matrix + FR/RU smoke test per D-27; M010-07 mitigation (second-person framing) |
| SURF-05 | Plain text output — no `parse_mode` — multi-section layout with ASCII dividers mirroring `summary.ts` | `summary.ts:94-108` formatting precedent; D-17/D-23 lock plain text; D-31 codebase convention |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `buildSystemPrompt` signature + per-mode dispatch | Chris core (`src/chris/personality.ts`) | — | Single source of truth for system-prompt assembly; ignorant of profile internals (consumes pre-rendered string) |
| `PROFILE_INJECTION_MAP` + `formatProfilesForPrompt` | Memory layer (`src/memory/profiles.ts`) | — | Co-located with reader; knows which dimensions render for which mode; renders snake_case JSONB to prompt-style text |
| Mode-handler injection wiring (REFLECT/COACH/PSYCHOLOGY) | Mode handlers (`src/chris/modes/{reflect,coach,psychology}.ts`) | Chris core | Each handler invokes `getOperationalProfiles()` → `formatProfilesForPrompt(profiles, MODE)` → passes to `extras.operationalProfiles` |
| `/profile` command handler | Bot handlers (`src/bot/handlers/profile.ts`) | Memory layer | Telegram-facing surface; reads via `getOperationalProfiles()`; renders for human display (distinct from prompt-side renderer) |
| `formatProfileForDisplay` pure formatter | Bot handlers (`src/bot/handlers/profile.ts`) | — | Co-located with handler per HARD CO-LOC #M10-5; pure function, isolated from I/O, golden-snapshot-tested |
| Bot command registration | Bot core (`src/bot/bot.ts`) | — | One-line `bot.command('profile', ...)` between `/summary` (line 34) and generic text handler (line 79) |

## Standard Stack

### Core (already in project — no additions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Grammy | already in deps | Telegram bot framework | All existing handlers use it; `bot.command()` + `Context.reply` shape locked across `summary.ts` / `decisions.ts` / `sync.ts` |
| vitest | already in deps | Test runner + snapshot system | `toMatchInlineSnapshot` is the project's chosen golden-test idiom; precedent in golden-output test ecosystem (D-26) |
| Drizzle ORM | already in deps | DB query layer (consumed via `getOperationalProfiles()` only — no edits) | Phase 33 substrate; Phase 35 is a pure consumer of `getOperationalProfiles()` |
| Zod v3 + v4 dual | already in deps | Profile schemas (consumed only) | Schemas exist at `src/memory/profiles/schemas.ts`; Phase 35 reads typed shapes, never re-validates |
| franc | already in deps | Language detection (transitively via `getLastUserLanguage`) | Existing language-detection pipeline; Phase 35 calls `getLastUserLanguage(chatId.toString())` — no franc import needed in profile.ts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `toMatchInlineSnapshot` | `toMatchSnapshot` (external `__snapshots__/` file) | Inline keeps expected output visible at the assertion site — any change forces visible review (per Looks-Done-But-Isn't checklist line 427). External snapshots are reviewable but hidden behind a file boundary; inline is the project standard for golden output. |
| `bot.command('profile', ...)` Grammy registration | `bot.hears(/^\/profile/, ...)` regex | Grammy's `command()` handles `@BotName` suffix correctly (`/profile@chrisbot`); `summary` and `decisions` use `command()` — consistency. |
| Inline `MSG` localization map | Shared `src/bot/handlers/_strings.ts` | All existing handlers (summary, decisions, sync) inline their `MSG` map. Centralizing prematurely creates a worse cross-file lookup pattern; defer until at least 4 handlers share a string. |

**Installation:** None — no new dependencies.

**Version verification:** All libraries already pinned in `package.json` from prior phases; no new versions needed.

## Architecture Patterns

### System Architecture Diagram

```
Plan 35-01: buildSystemPrompt refactor (mechanical, atomic, 8 call sites)
┌─────────────────────────────────────────────────────────────────┐
│ src/chris/personality.ts                                        │
│   • signature: (mode, pensieve?, relational?, extras?)          │
│   • ChrisContextExtras exported                                 │
│   • extras.operationalProfiles prepended to {pensieveContext}   │
│   • extras.language → MANDATORY directive (line 161)            │
│   • extras.declinedTopics → declined-topics block (line 165)    │
└──────────────────────────┬──────────────────────────────────────┘
                           │ 8 production sites + 2 named test files migrate
       ┌───────────────────┼───────────────────────────┐
       ▼                   ▼                            ▼
 5 mode handlers      photos.ts            resolution.ts (ACCOUNTABILITY)
 (journal/interr/                                │
  reflect/coach/                                 ▼
  psychology/produce)                  preserves overload semantics
       │                                  language → extras.language only
       │
       │  Plan 35-02: 3 of these 5 (REFLECT/COACH/PSYCHOLOGY) wire in profile injection
       ▼
┌──────────────────────────────────────────────────────────────────┐
│ Per-mode-handler new flow (REFLECT/COACH/PSYCHOLOGY only):       │
│   1. profiles = await getOperationalProfiles()                   │
│   2. opProfiles = formatProfilesForPrompt(profiles, MODE)        │
│   3. buildSystemPrompt(MODE, pensieve, relational,               │
│                         { language, declinedTopics,              │
│                           operationalProfiles: opProfiles })     │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│ src/memory/profiles.ts (Phase 35 ADDS)                           │
│   • PROFILE_INJECTION_MAP — named per-mode constant              │
│   • formatProfilesForPrompt(profiles, mode) — pure function      │
│     ─ Honors mode subset (M010-08)                               │
│     ─ Skips health when confidence < 0.5                         │
│     ─ Appends staleness note when last_updated > 21d             │
│     ─ Caps per-dimension at 2000 chars (… truncation marker)     │
│     ─ Returns "" when no in-scope dimensions render              │
└──────────────────────────────────────────────────────────────────┘

Plan 35-03: /profile command (HARD CO-LOC #M10-5 — same plan)
┌──────────────────────────────────────────────────────────────────┐
│ User sends "/profile" via Telegram                               │
│        │                                                         │
│        ▼                                                         │
│ src/bot/bot.ts:bot.command('profile', handleProfileCommand)      │
│  (registered between line 34 /summary and line 79 generic text)  │
│        │                                                         │
│        ▼                                                         │
│ src/bot/handlers/profile.ts:handleProfileCommand(ctx)            │
│   1. lang = langOf(getLastUserLanguage(chatId.toString()))       │
│   2. profiles = await getOperationalProfiles()                   │
│   3. for dim in ['jurisdictional','capital','health','family']:  │
│        text = formatProfileForDisplay(dim, profiles[dim], lang)  │
│        await ctx.reply(text)            // 4 ctx.reply calls     │
│   4. await ctx.reply(MSG.m011Placeholder[lang])  // 5th reply    │
│        │                                                         │
│        ▼                                                         │
│ formatProfileForDisplay(dimension, profile, lang)  ← pure fn     │
│   ─ null profile        → "Building your X profile — Chris…"     │
│   ─ confidence === 0    → actionable progress indicator          │
│   ─ confidence > 0      → "You're currently in {country}.…"      │
│   ─ last_updated > 21d  → append "Note: profile data from {d}…"  │
│        │                                                         │
│        ▼                                                         │
│ Golden test: src/bot/handlers/__tests__/profile.golden.test.ts   │
│   4 dim × 4 cases (null/zero/fresh/stale) = 16 inline snapshots  │
│   + FR/RU language-coverage smoke test (1 dimension)             │
└──────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

No new directories or files beyond what CONTEXT.md prescribes. The full delta is:

```
src/
├── chris/
│   ├── personality.ts                          ← EDITED (Plan 35-01)
│   │                                              + ChrisContextExtras export
│   │                                              + signature change to extras param
│   ├── modes/
│   │   ├── journal.ts                          ← EDITED (Plan 35-01 only — call shape)
│   │   ├── interrogate.ts                      ← EDITED (Plan 35-01 only — call shape)
│   │   ├── reflect.ts                          ← EDITED (Plan 35-01 + 35-02 injection)
│   │   ├── coach.ts                            ← EDITED (Plan 35-01 + 35-02 injection)
│   │   ├── psychology.ts                       ← EDITED (Plan 35-01 + 35-02 injection)
│   │   ├── produce.ts                          ← EDITED (Plan 35-01 only — call shape)
│   │   └── photos.ts                           ← EDITED (Plan 35-01 only — call shape)
│   └── __tests__/
│       ├── personality.test.ts                 ← EDITED (Plan 35-01 — 31 sites migrate)
│       ├── engine.test.ts                      ← EDITED (Plan 35-01 — 16 sites migrate)
│       ├── reflect.test.ts                     ← EDITED (Plan 35-01 + 35-02 assertion)
│       ├── coach.test.ts                       ← EDITED (Plan 35-01 + 35-02 assertion)
│       ├── psychology.test.ts                  ← EDITED (Plan 35-01 + 35-02 assertion)
│       ├── journal.test.ts                     ← EDITED (Plan 35-02 — negative invariant)
│       ├── interrogate.test.ts                 ← EDITED (Plan 35-01 mock shape + 35-02)
│       ├── produce.test.ts                     ← EDITED (Plan 35-01 mock shape + 35-02)
│       └── photos.test.ts                      ← EDITED (Plan 35-01 mock shape + 35-02)
├── decisions/
│   └── resolution.ts                           ← EDITED (Plan 35-01 — single call site)
├── memory/
│   ├── profiles.ts                             ← EDITED (Plan 35-02)
│   │                                              + PROFILE_INJECTION_MAP export
│   │                                              + formatProfilesForPrompt fn
│   └── profiles/                               ← NO CHANGES (existing subdirectory)
│       └── schemas.ts                          ← READ ONLY
└── bot/
    ├── bot.ts                                  ← EDITED (Plan 35-03 — 1 new line)
    └── handlers/
        ├── profile.ts                          ← CREATED (Plan 35-03)
        │   • handleProfileCommand(ctx)
        │   • formatProfileForDisplay(dim, profile, lang)
        │   • MSG localization map
        └── __tests__/
            ├── profile.golden.test.ts          ← CREATED (Plan 35-03)
            │   • 16 inline snapshots
            │   • FR/RU language coverage smoke test
            └── profile.test.ts                 ← CREATED (Plan 35-03)
                • handler integration: mock getOperationalProfiles + ctx.reply spy
```

### Pattern 1: Mechanical Signature Migration (Plan 35-01)

**What:** Convert every `buildSystemPrompt(..., language, declinedTopics)` positional invocation to `buildSystemPrompt(..., { language, declinedTopics })`.

**When to use:** All 8 production sites + 2 named test files (personality.test.ts has 31 calls, engine.test.ts has 16).

**Example transformation:**

```typescript
// BEFORE (src/chris/modes/reflect.ts:76)
const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, language, declinedTopics);

// AFTER (Plan 35-01 — call shape only, Plan 35-02 adds operationalProfiles)
const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, {
  language,
  declinedTopics,
});
```

```typescript
// BEFORE (src/decisions/resolution.ts:252-257)
const systemPrompt = buildSystemPrompt(
  'ACCOUNTABILITY',
  decisionContext,
  temporalContext,
  rawLang,
);

// AFTER
const systemPrompt = buildSystemPrompt(
  'ACCOUNTABILITY',
  decisionContext,
  temporalContext,
  { language: rawLang },
);
```

```typescript
// BEFORE (src/chris/__tests__/personality.test.ts:43)
const prompt = buildSystemPrompt('JOURNAL', undefined, undefined, undefined, [
  { topic: 'my father', originalSentence: "..." },
]);

// AFTER
const prompt = buildSystemPrompt('JOURNAL', undefined, undefined, {
  declinedTopics: [
    { topic: 'my father', originalSentence: "..." },
  ],
});
```

### Pattern 2: Per-Mode Subset Injection via Named Constant (Plan 35-02)

**What:** Centralize injection scope decisions in `PROFILE_INJECTION_MAP` constant; mode handlers consult the constant.

**When to use:** Any decision about which profile dimensions render for which mode. Never inline per-handler logic (M010-08 mitigation — "Modifying each handler independently without a shared mapping means each developer makes independent injection scope decisions").

**Example:**

```typescript
// src/memory/profiles.ts (new exports — Plan 35-02)
import type { ChrisMode } from '../chris/personality.js';

type Dimension = 'jurisdictional' | 'capital' | 'health' | 'family';

// LOCKED VALUES per D-08 + PITFALLS M010-08 mitigation
export const PROFILE_INJECTION_MAP: Record<'REFLECT' | 'COACH' | 'PSYCHOLOGY', Dimension[]> = {
  REFLECT: ['jurisdictional', 'capital', 'health', 'family'], // full context
  COACH: ['capital', 'family'],                                // decisions + constraints
  PSYCHOLOGY: ['health', 'jurisdictional'],                    // clinical + situational
};

const PER_DIMENSION_CHAR_CAP = 2000;
const STALENESS_DAYS = 21;
const HEALTH_CONFIDENCE_FLOOR = 0.5;

export function formatProfilesForPrompt(
  profiles: OperationalProfiles,
  mode: ChrisMode,
): string {
  // Out-of-scope modes return empty (JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY)
  if (!(mode in PROFILE_INJECTION_MAP)) return '';

  const dimensions = PROFILE_INJECTION_MAP[mode as keyof typeof PROFILE_INJECTION_MAP];
  const blocks: string[] = [];
  const now = Date.now();

  for (const dim of dimensions) {
    const row = profiles[dim];
    if (!row) continue;                              // null on DB error / missing row
    if (row.confidence === 0) continue;              // zero-confidence skip
    if (dim === 'health' && row.confidence < HEALTH_CONFIDENCE_FLOOR) continue; // D-09 gate

    let block = renderDimensionForPrompt(dim, row);  // dimension-specific renderer
    const ageDays = (now - row.lastUpdated.getTime()) / 86_400_000;
    if (ageDays > STALENESS_DAYS) {
      const date = row.lastUpdated.toISOString().slice(0, 10);
      block += `\n\nNote: profile data from ${date} — may not reflect current state.`;
    }
    if (block.length > PER_DIMENSION_CHAR_CAP) {
      block = block.slice(0, PER_DIMENSION_CHAR_CAP - 1) + '…';
    }
    blocks.push(block);
  }

  if (blocks.length === 0) return '';

  return '## Operational Profile (grounded context — not interpretation)\n\n' + blocks.join('\n\n');
}
```

### Pattern 3: Golden-Output Snapshot Test (Plan 35-03)

**What:** `toMatchInlineSnapshot` against a pinned `MOCK_PROFILES` fixture.

**When to use:** Pure-formatter output where any rendering change must be visible at review time.

**Example:**

```typescript
// src/bot/handlers/__tests__/profile.golden.test.ts
import { describe, it, expect } from 'vitest';
import { formatProfileForDisplay } from '../profile.js';
import type { ProfileRow, JurisdictionalProfileData } from '../../../memory/profiles.js';

const FRESH_JURISDICTIONAL: ProfileRow<JurisdictionalProfileData> = {
  data: {
    current_country: 'Georgia',
    physical_location: 'Batumi',
    residency_status: [{ type: 'tax_resident', value: 'France', since: '2020-01-01' }],
    tax_residency: 'France',
    active_legal_entities: [],
    next_planned_move: { destination: 'France (Antibes)', from_date: '2026-05-16' },
    planned_move_date: '2026-05-16',
    passport_citizenships: ['French'],
    data_consistency: 0.8,
  },
  confidence: 0.72,
  lastUpdated: new Date('2026-05-10T22:00:00Z'),  // 3 days old — fresh
  schemaVersion: 1,
};

describe('formatProfileForDisplay — Jurisdictional', () => {
  it('renders populated-fresh profile in English', () => {
    expect(formatProfileForDisplay('jurisdictional', FRESH_JURISDICTIONAL, 'English'))
      .toMatchInlineSnapshot(`
        "Jurisdictional Profile (confidence 72%)

        You're currently in Batumi, Georgia.
        Your tax residency: France.
        Your residency statuses:
        - tax_resident: France (since 2020-01-01)
        Your next planned move: France (Antibes) on 2026-05-16.
        Your citizenships: French."
      `);
  });

  it('renders null profile as actionable progress indicator', () => {
    expect(formatProfileForDisplay('jurisdictional', null, 'English'))
      .toMatchInlineSnapshot(`
        "Jurisdictional Profile

        Chris needs more entries about your location and tax situation before populating this profile."
      `);
  });

  // ... zero-confidence + stale cases per D-27
});
```

### Pattern 4: Handler Integration Test with Grammy Context Spy (Plan 35-03)

**What:** Duck-typed Grammy `Context` with a `reply` spy that captures the array of replies.

**Source precedent:** `src/bot/handlers/__tests__/summary.test.ts:77-91` — direct copy of the `buildCtx` helper pattern.

```typescript
function buildCtx(text: string, chatId = 99_935): { captured: string[]; ctx: any } {
  const captured: string[] = [];
  const ctx = {
    chat: { id: chatId },
    from: { id: chatId },
    message: { text },
    reply: async (t: string) => { captured.push(t); },
  };
  return { captured, ctx };
}

// In the test:
it('emits exactly 5 ctx.reply calls (4 dimensions + M011 placeholder)', async () => {
  mockGetOperationalProfiles.mockResolvedValue(POPULATED_MOCK_PROFILES);
  const { captured, ctx } = buildCtx('/profile');
  await handleProfileCommand(ctx);
  expect(captured).toHaveLength(5);
  expect(captured[0]).toMatch(/Jurisdictional/);
  expect(captured[1]).toMatch(/Capital/);
  expect(captured[2]).toMatch(/Health/);
  expect(captured[3]).toMatch(/Family/);
  expect(captured[4]).toMatch(/Psychological.*not yet available.*M011/);
});
```

### Pattern 5: Negative-Injection Invariant Test (Plan 35-02 + D-28)

**What:** Assert via mocked SDK boundary that `getOperationalProfiles` is NEVER called from JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY handlers.

**Why:** Per M010-08 — health profile in COACH mode causes topic drift; injecting all profiles into all modes is the implementation-easy-but-wrong default. The negative test prevents future drift.

**Example assertion shape:**

```typescript
// In src/chris/__tests__/journal.test.ts (Plan 35-02 add)
const mockGetOperationalProfiles = vi.fn();
vi.mock('../../memory/profiles.js', () => ({
  getOperationalProfiles: mockGetOperationalProfiles,
  // PROFILE_INJECTION_MAP and formatProfilesForPrompt also exported but not needed in mock
}));

// ... after the existing test suite:
it('JOURNAL handler does NOT call getOperationalProfiles (M010-08 negative invariant)', async () => {
  await handleJournal(CHAT_ID, TEST_QUERY);
  expect(mockGetOperationalProfiles).not.toHaveBeenCalled();
});
```

### Anti-Patterns to Avoid

- **Splitting `buildSystemPrompt` refactor across multiple plans.** Partial refactor leaves the build red — TypeScript compilation will fail on un-migrated call sites. HARD CO-LOC #M10-4. The plan-checker MUST refuse this.
- **Splitting `/profile` handler from `formatProfileForDisplay` or the golden test.** HARD CO-LOC #M10-5. Co-location is the M010-07 mitigation — separating handler from formatter from test means a regression could land in one PR without the others updating.
- **Markdown formatting in `/profile` output.** D-17 + D-31 lock plain text. `summary.ts:22-23` documents the exact rationale: "Markdown escape complexity for user-origin content in key_quotes is a footgun, and the visual gain is marginal."
- **Third-person framing in `formatProfileForDisplay`.** Reads as a database export, not a personal profile. M009 29-VERIFICATION.md is the direct precedent ("third-person framing reads as documentation rather than conversation"). Second-person is non-negotiable.
- **JSON.stringify on `getOperationalProfiles()` result.** Greg sees `{"residency": ..., "tax_structure": ...}` instead of prose. The whole point of the formatter is to convert structured data to prose.
- **Health profile injected at any confidence into COACH.** D-09: COACH mode receives `health` only when `confidence >= 0.5`, but D-08's `COACH: ['capital', 'family']` excludes health entirely. Both gates apply (PSYCHOLOGY's health inclusion has the 0.5 floor).
- **Calling `getOperationalProfiles()` inside `formatProfileForDisplay`.** Display formatter is a PURE FUNCTION. Handler does the I/O.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Telegram bot command registration | Custom regex routing | Grammy `bot.command('profile', handler)` | Handles `@BotName` suffix, middleware chain, error capture — same pattern as `/summary`, `/sync`, `/decisions` |
| Language detection per chat | Re-running franc in the handler | `getLastUserLanguage(chatId.toString())` from `src/chris/language.ts` | In-memory cache populated by every text message; `/profile` is user-initiated so cache is always warm |
| Snapshot serialization for Telegram output | String concat + manual `expect(...).toBe('...')` | `toMatchInlineSnapshot` (vitest built-in) | Inline snapshot updates via `-u` flag are visible in code review; raw string comparison drift is invisible |
| Date/staleness arithmetic | Date math by hand | Compare `ms` deltas: `(Date.now() - row.lastUpdated.getTime()) / 86_400_000` | Existing pattern; no luxon needed for simple > 21d comparison; `summary.ts:118-126` uses Intl.DateTimeFormat for tz-aware day arithmetic when needed |
| Per-language date formatting (FR/RU) | Manual format strings | `Intl.DateTimeFormat('fr-FR', { ... })` / `('ru-RU', ...)` | Built-in; precedent in `personality.ts:196-200` `DATE_LOCALES` map |
| Profile read | Re-issuing 4 Drizzle SELECTs | `await getOperationalProfiles()` | Phase 33 substrate; never-throw, per-profile null on DB error; consumed verbatim |
| Confidence percentage formatting | Manual rounding | `Math.round(confidence * 100)` | One-liner; no library needed |
| Grammy Context type for handler | Hand-typed shape | `import type { Context } from 'grammy'` | `summary.ts:34` precedent |

**Key insight:** Phase 35 is an integration phase. Every primitive it needs already exists somewhere in the codebase. The work is connecting them, not inventing them.

## Runtime State Inventory

> Phase 35 is a code-only feature addition. It does NOT rename, refactor, or migrate any data, service, OS-registered state, secret, env var, or build artifact. The 5 categories are explicitly addressed:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no schema changes, no data migration. Phase 35 only READS from existing tables (profile_jurisdictional/capital/health/family populated by Phase 34's Sunday 22:00 Paris cron). No new tables, no new columns, no UPDATE/INSERT/DELETE statements introduced. | None |
| Live service config | None — no cron registrations modified, no Telegram webhooks reconfigured. The `/profile` command is registered at bot startup via `bot.command('profile', ...)` which is part of the deployed code, not external service config. Telegram BotFather's command list (`/setcommands` for the `?` menu) is an OPTIONAL post-deploy operator action — not blocking; Greg can issue `/profile` regardless of menu registration. | Optional: operator may update BotFather `/setcommands` to include `/profile - Show your operational profiles` for menu visibility |
| OS-registered state | None — no new Windows Task Scheduler tasks, no pm2 process names changed, no launchd/systemd units. The pm2 ecosystem.config.js (if any) is not edited. Container restart suffices for deploy. | None |
| Secrets / env vars | None — no new env vars introduced. `/profile` reads from existing config (no ANTHROPIC_API_KEY consumed — no LLM call), uses existing Telegram bot token, queries existing DB connection. | None |
| Build artifacts | None — pure TypeScript code addition compiled by the existing `tsc` step. No new package install, no Docker image base layer change, no Drizzle migration to apply. | None |

**Canonical question answer:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?*

**Nothing.** Phase 35 introduces a new code path (the `/profile` Telegram command + 3 mode-handler additions) but does not modify any persisted state, registered service config, or OS-level resource. A standard Docker rebuild + container restart deploys it cleanly. The first `/profile` invocation works against whatever profile data the Sunday 22:00 Paris cron has populated (first fire scheduled 2026-05-17 22:00 Paris per project_m010_phase34_deployed memory entry).

## Call Site Reconfirmation (OQ-3 — REQUIRED PRE-WORK FOR PLAN 35-01)

Re-ran `grep -rn "buildSystemPrompt(" src/` 2026-05-13 (this research pass). **The 8 production call sites in CONTEXT.md D-06 are CONFIRMED — no drift since the discuss-phase pass earlier today.**

### Production sites (8 — all migrate atomically in Plan 35-01)

| # | File | Line | Current shape | Migration |
|---|------|------|--------------|-----------|
| 1 | `src/chris/personality.ts` | 94 | Declaration: `(mode, pensieveContext?, relationalContext?, language?, declinedTopics?)` | → `(mode, pensieveContext?, relationalContext?, extras?: ChrisContextExtras)` |
| 2 | `src/chris/modes/journal.ts` | 81 | `buildSystemPrompt('JOURNAL', pensieveContext, undefined, language, declinedTopics)` | → `buildSystemPrompt('JOURNAL', pensieveContext, undefined, { language, declinedTopics })` |
| 3 | `src/chris/modes/interrogate.ts` | 115 | `buildSystemPrompt('INTERROGATE', pensieveContext, undefined, language, declinedTopics)` | → `buildSystemPrompt('INTERROGATE', pensieveContext, undefined, { language, declinedTopics })` |
| 4 | `src/chris/modes/reflect.ts` | 76 | `buildSystemPrompt('REFLECT', pensieveContext, relationalContext, language, declinedTopics)` | → Plan 35-01: `buildSystemPrompt('REFLECT', pensieveContext, relationalContext, { language, declinedTopics })`<br>→ Plan 35-02: adds `operationalProfiles: formatProfilesForPrompt(profiles, 'REFLECT')` |
| 5 | `src/chris/modes/coach.ts` | 76 | `buildSystemPrompt('COACH', pensieveContext, relationalContext, language, declinedTopics)` | → Plan 35-01 + 35-02 (mirrors reflect) |
| 6 | `src/chris/modes/psychology.ts` | 77 | `buildSystemPrompt('PSYCHOLOGY', pensieveContext, relationalContext, language, declinedTopics)` | → Plan 35-01 + 35-02 (mirrors reflect) |
| 7 | `src/chris/modes/produce.ts` | 72 | `buildSystemPrompt('PRODUCE', pensieveContext, undefined, language, declinedTopics)` | → `buildSystemPrompt('PRODUCE', pensieveContext, undefined, { language, declinedTopics })` |
| 8 | `src/chris/modes/photos.ts` | 182 | `buildSystemPrompt('JOURNAL', undefined, undefined, language, declinedTopics)` | → `buildSystemPrompt('JOURNAL', undefined, undefined, { language, declinedTopics })` |
| 9 | `src/decisions/resolution.ts` | 252 | `buildSystemPrompt('ACCOUNTABILITY', decisionContext, temporalContext, rawLang)` | → `buildSystemPrompt('ACCOUNTABILITY', decisionContext, temporalContext, { language: rawLang })` |

(CONTEXT.md D-06 calls this "8 call sites" — counting the declaration as one and the 8 invocation sites as 8. The grep result above includes the declaration; the invocation count is 8 across 8 files.)

### Test files — DRIFT FROM CONTEXT.md D-06 (10 production files, not 2)

CONTEXT.md D-06 lists 2 test files: `personality.test.ts` (31 occurrences) and `engine.test.ts` (16 occurrences). **The grep reveals 10 test files reference `buildSystemPrompt`.** The full inventory:

| # | File | Mode of use | Migration scope in Plan 35-01 |
|---|------|------------|-------------------------------|
| 1 | `src/chris/__tests__/personality.test.ts` | **Direct calls** (31 sites) | Mechanical positional → extras migration (e.g., `buildSystemPrompt('JOURNAL', undefined, undefined, undefined, [...])` → `buildSystemPrompt('JOURNAL', undefined, undefined, { declinedTopics: [...] })`) |
| 2 | `src/chris/__tests__/engine.test.ts` | **Direct calls** (16 sites) | Most are simple `buildSystemPrompt('JOURNAL')` / `buildSystemPrompt('REFLECT')` smoke tests — no migration needed because no positional 4th/5th argument is passed. The 1-2 sites that pass language/declinedTopics migrate to extras. |
| 3 | `src/chris/__tests__/reflect.test.ts` | **`vi.mock` mocks `buildSystemPrompt`** + asserts call shape via `mockBuildSystemPrompt.toHaveBeenCalledWith('REFLECT', expect.any(String), expect.any(String), undefined, undefined)` at line 237-242 | **Update assertion shape** to new arity: `toHaveBeenCalledWith('REFLECT', expect.any(String), expect.any(String), expect.objectContaining({ language: undefined, declinedTopics: undefined }))` — OR drop the last-two-args assertion if not load-bearing. Plan 35-02 adds `operationalProfiles` to the assertion for REFLECT/COACH/PSYCHOLOGY. |
| 4 | `src/chris/__tests__/coach.test.ts` | `vi.mock` mocks + asserts call shape at line 243-249 | Same as reflect.test.ts |
| 5 | `src/chris/__tests__/psychology.test.ts` | `vi.mock` mocks + asserts call shape | Same as reflect.test.ts |
| 6 | `src/chris/__tests__/journal.test.ts` | References `buildSystemPrompt` in test description text only (no direct call) — verified via grep at line 113 ("passes pensieveContext... to buildSystemPrompt via Sonnet call") | **No migration needed** — string-text only. Plan 35-02 adds the negative-injection invariant. |
| 7 | `src/chris/__tests__/interrogate.test.ts` | `vi.mock` mocks + integration uses **real** `buildSystemPrompt` at line 485 (`mockBuildSystemPrompt.mockImplementation(realPersonality.buildSystemPrompt)`) | Update mock-call assertions if any are positional 5-arg. The `mockImplementation` line should keep working as-is since the real function's new signature is backward-compatible from the caller perspective (positional 4th+5th args become an undefined extras param). **Verify post-migration.** Plan 35-02 adds negative invariant. |
| 8 | `src/chris/__tests__/produce.test.ts` | `vi.mock` mocks + describe block exists | Update assertion shape if any. Plan 35-02 adds negative invariant. |
| 9 | `src/chris/__tests__/photos.test.ts` | `vi.mock` mocks | Update assertion shape. Plan 35-02 adds negative invariant. |
| 10 | `src/chris/__tests__/photos-memory.test.ts` | `vi.fn(() => 'You are Chris...')` — mock with hardcoded return | **No assertion-shape update needed** — the mock factory doesn't care about arity. |

**Drift mitigation:** Plan 35-01 task list MUST include all 10 test files, not 2. The CONTEXT.md inventory is correct on production sites but undercounts test files. The 8 additional test files are NOT call-shape migrations (they use `vi.mock`); they ARE assertion-shape audits to verify nothing positional-5-arg remains. The simplest gate: after the refactor, run `grep -rn "buildSystemPrompt.*undefined.*undefined.*\(\|buildSystemPrompt.*language.*declinedTopics" src/chris/__tests__/` — any hit indicates a missed assertion.

### Coverage artifacts (`src/coverage/`)

`src/coverage/` contains HTML/JSON instrumentation output from a prior vitest run. These files reference `buildSystemPrompt` via embedded source listings (e.g., `src/coverage/src/chris/personality.ts.html` shows the function declaration in an HTML pre-block).

**Action: do NOT migrate.** Coverage artifacts are generated outputs; they regenerate on the next `npm test -- --coverage` run. Editing them would be tedious and pointless. The `.gitignore` may or may not exclude `src/coverage/`; check before Plan 35-01 starts. If it's tracked, the refactor commit will accumulate large diff noise — recommend adding `src/coverage/` to `.gitignore` as a pre-Plan-35-01 cleanup commit OR leaving the artifacts alone and excluding them from the refactor.

## Common Pitfalls

### Pitfall 1: Partial buildSystemPrompt Migration (HARD CO-LOC #M10-4 violation)

**What goes wrong:** Plan 35-01 migrates some call sites but not others. TypeScript compilation fails on un-migrated sites (signature mismatch). The build is red until every site is migrated.

**Why it happens:** Splitting the refactor into "production code" + "tests" plans, or "modes" + "rest" plans.

**How to avoid:** All 8 production sites + 10 test files migrate in ONE plan (Plan 35-01). The plan-checker MUST refuse any plan structure that splits the refactor.

**Warning signs:** Plan 35-01 has fewer than ~3-4 tasks. Task list omits any of the 8 production files OR the 10 test files. `npx tsc --noEmit` fails after Plan 35-01 completes.

### Pitfall 2: ACCOUNTABILITY Overload Drift

**What goes wrong:** Plan 35-01 refactor "cleans up" the ACCOUNTABILITY parameter overload semantics, breaking `resolution.ts` because the `{decisionContext}` slot is repurposed.

**Why it happens:** The 84-92 comment block in `personality.ts` reads like dead code or a confusing artifact. A well-meaning refactor "tidies" the switch case.

**How to avoid:** D-05 locks ACCOUNTABILITY overload preservation. The 84-92 comment stays VERBATIM. The switch case at `personality.ts:133-148` stays VERBATIM. Only the parameter signature changes (`language?: string` → folded into `extras.language`). `resolution.ts:252-257` migrates positional `rawLang` → `{ language: rawLang }` — same overload semantics.

**Warning signs:** The comment block is shortened. `ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT` substitution order changes. A new `decisionContext` parameter is added to the signature.

### Pitfall 3: declinedTopics Drift in ACCOUNTABILITY

**What goes wrong:** `resolution.ts:252-257` currently does NOT pass `declinedTopics`. Plan 35-01 "fixes" this oversight and starts passing them, changing ACCOUNTABILITY behavior unintentionally.

**Why it happens:** During mechanical migration, the missing 5th arg looks like a forgotten field.

**How to avoid:** D-05 explicitly says ACCOUNTABILITY migrates as `buildSystemPrompt('ACCOUNTABILITY', decisionContext, temporalContext, { language: rawLang })` — only `language` in extras, NOTHING ELSE. The absence of declinedTopics is intentional (the ACCOUNTABILITY system prompt template doesn't use declined topics). CONTEXT.md flags this for plan-time verification.

**Warning signs:** The diff for `resolution.ts:252-257` adds `declinedTopics` to the extras object. The `chris.bot.acknowledgment` log shows the declined-topics block in the system prompt.

### Pitfall 4: Empty-string Optional Arg Confusion

**What goes wrong:** `formatProfilesForPrompt` returns `""` when no in-scope dimensions render. Mode handler passes `operationalProfiles: ""` to extras. The injection-block conditional in `personality.ts` (e.g., `if (extras?.operationalProfiles) prompt += ...`) treats `""` as falsy and correctly omits the block — but a future developer "fixing" this with `if (extras?.operationalProfiles !== undefined)` would inject an empty `## Operational Profile ...` header with no content.

**Why it happens:** TypeScript's empty-string-is-falsy semantics combined with optional-field idioms.

**How to avoid:** Inside `personality.ts`, gate injection with `if (extras?.operationalProfiles)` (truthy check, not undefined check). Add an inline comment: `// Empty-string skip is intentional — formatProfilesForPrompt returns "" when no in-scope dimensions render (D-12)`.

**Warning signs:** Greg sees an `## Operational Profile (grounded context — not interpretation)` header in a REFLECT response that has no profile content below it.

### Pitfall 5: Third-Person Framing in formatProfileForDisplay (M010-07)

**What goes wrong:** `formatProfileForDisplay` renders profile fields as "Greg's tax residency: France" or "His current location: Batumi". Reads as a database export, not a personal profile.

**Why it happens:** JSONB field names are third-person/possessive by structure ("tax_residency"); the simplest rendering is `${row.tax_residency}` which preserves third-person framing.

**How to avoid:** D-20 locks second-person framing. The formatter must emit "You're currently in...", "Your tax residency:", "Your FI target:", "Your residency statuses:". Golden snapshot tests (D-27) catch any third-person regression at PR-review time.

**Warning signs:** Golden snapshots include "Greg's...", "His...", or "John's..." (note: legacy memory module called Greg "John"; if any test fixture has stale "John" strings, the formatter must not propagate).

### Pitfall 6: Bot Registration Ordering (Generic Handler Eats /profile)

**What goes wrong:** `bot.command('profile', handleProfileCommand)` is registered AFTER `bot.on('message:text', handleTextMessage)`. Grammy routes the message to the generic text handler first; `/profile` never fires.

**Why it happens:** Grammy registration order matters for routing. Adding a new command at the bottom of `bot.ts` accidentally puts it after the generic handler.

**How to avoid:** Place the registration between line 34 (`/summary`) and line 79 (`bot.on('message:text', ...)`). Mirror the comment style: `// /profile command — must be registered before generic text handler`. Plan 35-03 task must specify the insertion point.

**Warning signs:** Manual UAT shows `/profile` doesn't fire (engine returns a regular Sonnet response instead). `summary.test.ts` integration test pattern adapted for `profile.test.ts` catches this — but only if the test invokes the registered Bot instance, not just `handleProfileCommand` directly. Recommendation: keep the existing pattern (test the handler directly), and add a smoke test that imports `bot` from `bot.ts` and asserts `bot.command` was called with `'profile'`.

### Pitfall 7: Cyclic Import Risk (profiles.ts ↔ personality.ts)

**What goes wrong:** Plan 35-02 adds `import type { ChrisMode } from '../chris/personality.js'` to `src/memory/profiles.ts` (for `PROFILE_INJECTION_MAP`'s key type). Meanwhile, `src/memory/profile-prompt.ts` already imports `CONSTITUTIONAL_PREAMBLE` from `personality.ts`. If `personality.ts` ever needs to import from `profiles.ts`, the cycle closes.

**Why it happens:** Profile rendering logic naturally wants to live near the profile types, but the type system pulls dependencies in unexpected directions.

**How to avoid (verified by this research):** `personality.ts` does NOT import from `profiles.ts` (grep confirmed: zero hits for `from '../memory/profiles'` in personality.ts). The new direction (`profiles.ts → personality.ts` for `ChrisMode` type only) is **fine** — single-direction import. Use `import type` (type-only import) to make this explicit and prevent any runtime cycle.

**Warning signs:** `npm run build` fails with "Circular dependency detected" warning from Vite/tsc. `npx tsc --noEmit` shows TS errors about types not being resolvable.

**Defense:** Plan 35-02 task spec should require `import type { ChrisMode }` (not bare `import`).

### Pitfall 8: Test Assertion Shape Drift (8 unmigrated test files)

**What goes wrong:** Plan 35-01 migrates `personality.test.ts` + `engine.test.ts` (the 2 named in CONTEXT.md D-06) but leaves 6 mode tests (`reflect/coach/psychology/journal/interrogate/produce/photos/photos-memory.test.ts`) with assertions like `expect(mockBuildSystemPrompt).toHaveBeenCalledWith('REFLECT', expect.any(String), expect.any(String), undefined, undefined)`. These assertions test the OLD positional 5-arg shape. They will still PASS because `expect.any(String)` and `undefined` happily match the new 4-arg shape (positional 4th arg is now an undefined extras object); but they're semantically misleading.

**Why it happens:** D-06 named only 2 test files; the other 8 weren't in scope mentally.

**How to avoid:** Plan 35-01 audits all 10 test files. The mode-handler assertions at line 243-249 of coach.test.ts, line 243-249 of psychology.test.ts (similar), and line 237-242 of reflect.test.ts (existing) should be updated to assert the new shape: `expect.objectContaining({ language: undefined, declinedTopics: undefined })` for Plan 35-01, then `expect.objectContaining({ ..., operationalProfiles: expect.any(String) })` for Plan 35-02's positive-injection tests.

**Warning signs:** Plan 35-01 task list mentions only 2 test files. Post-Plan-35-01 grep for `toHaveBeenCalledWith.*'REFLECT'.*expect\.any.*expect\.any.*undefined.*undefined` returns hits.

### Pitfall 9: FR/RU Translation Gaps for New Strings

**What goes wrong:** The M011-placeholder text, "insufficient data" actionable progress indicator, and staleness note all need EN/FR/RU translations. Some translations get added in EN only, then `/profile` in French shows mixed-language output ("Building your jurisdictional profile — Chris needs ~7 more entries..." in an otherwise French reply).

**Why it happens:** New localized strings often get added in one language during development; FR/RU additions are an afterthought.

**How to avoid:** Plan 35-03's MSG map MUST be complete across EN/FR/RU at the time `profile.ts` is written. The language-coverage smoke test (D-27) asserts FR/RU labels appear in the expected language — but the smoke test only covers section labels, not the M011 placeholder or progress indicator. Plan 35-03 task must explicitly enumerate the strings needing translation: section titles (4 per language × 3 languages = 12), M011 placeholder (3), "insufficient data" / "Chris needs more entries" template (3), staleness note (3 — note the date format also localizes). Reuse existing French/Russian translation set from M009 (`weekly-review.ts` strings) for style consistency.

**Warning signs:** A Russian-language profile section in the inline snapshots is mostly English with one Russian word.

### Pitfall 10: Empty-result `/profile` UX (First Sunday Pre-Fire)

**What goes wrong:** Greg invokes `/profile` BEFORE the Sunday 22:00 Paris cron has populated anything (i.e., before 2026-05-17 22:00 Paris). All 4 dimensions return as the Phase 33 seeded rows: jurisdictional confidence 0.3, capital confidence 0.2, health confidence 0, family confidence 0. The display formatter must handle this mix gracefully.

**Why it happens:** Phase 33 seeded confidence-0 rows for health/family ("insufficient data" markers from migration 0012). Phase 35 ships before Phase 36 — so the formatter renders Phase 33 seed data, not Phase 34 cron-generated rows.

**How to avoid:** The 4-case coverage matrix (D-27) includes zero-confidence and null cases. The zero-confidence case asserts the actionable progress indicator renders. The null case asserts the same. Greg's first-ever `/profile` (pre-Sunday-fire) will show jurisdictional + capital with partial content and health + family with progress indicators — this is correct.

**Warning signs:** Greg's first-ever `/profile` shows a fatal error or empty replies. The handler integration test in Plan 35-03 must exercise the all-zero-confidence and all-null cases.

## Code Examples

Verified patterns drawn directly from existing codebase files:

### Mode-handler integration after Plan 35-02 (reflect.ts diff)

```typescript
// src/chris/modes/reflect.ts — Plan 35-02 additions marked
import { anthropic, SONNET_MODEL } from '../../llm/client.js';
import { REFLECT_SEARCH_OPTIONS } from '../../pensieve/retrieve.js';
import { retrieveContext, summaryToSearchResult } from '../../pensieve/routing.js';
import { extractQueryDate } from './date-extraction.js';
import {
  buildPensieveContext,
  buildRelationalContext,
  buildMessageHistory,
} from '../../memory/context-builder.js';
import { getRelationalMemories } from '../../memory/relational.js';
// NEW (Plan 35-02):
import { getOperationalProfiles, formatProfilesForPrompt } from '../../memory/profiles.js';
import { buildSystemPrompt, type DeclinedTopic } from '../personality.js';
import { LLMError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export async function handleReflect(
  chatId: bigint,
  text: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): Promise<string> {
  // ... existing search + routing + relational fetch ...

  const history = await buildMessageHistory(chatId);

  // NEW (Plan 35-02): fetch + format operational profiles for REFLECT
  const profiles = await getOperationalProfiles();
  const operationalProfiles = formatProfilesForPrompt(profiles, 'REFLECT');

  // CHANGED (Plan 35-01 + Plan 35-02): positional → extras + new operationalProfiles field
  const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, {
    language,
    declinedTopics,
    operationalProfiles,
  });

  // ... existing Sonnet call ...
}
```

### Profile handler skeleton (profile.ts — Plan 35-03)

```typescript
// src/bot/handlers/profile.ts — NEW FILE (Plan 35-03)
import type { Context } from 'grammy';
import { getOperationalProfiles, type OperationalProfiles, type ProfileRow } from '../../memory/profiles.js';
import { getLastUserLanguage } from '../../chris/language.js';
import { logger } from '../../utils/logger.js';
import type {
  JurisdictionalProfileData,
  CapitalProfileData,
  HealthProfileData,
  FamilyProfileData,
} from '../../memory/profiles/schemas.js';

type Lang = 'English' | 'French' | 'Russian';
type Dimension = 'jurisdictional' | 'capital' | 'health' | 'family';

function langOf(raw: string | null): Lang {
  if (raw === 'French' || raw === 'Russian' || raw === 'English') return raw;
  return 'English';
}

const STALENESS_DAYS = 21;

// Localized strings (D-19 + D-27 FR/RU coverage)
const MSG = {
  sectionTitles: {
    English: {
      jurisdictional: 'Jurisdictional Profile',
      capital: 'Capital Profile',
      health: 'Health Profile',
      family: 'Family Profile',
    },
    French: {
      jurisdictional: 'Profil juridictionnel',
      capital: 'Profil capital',
      health: 'Profil santé',
      family: 'Profil familial',
    },
    Russian: {
      jurisdictional: 'Юрисдикционный профиль',
      capital: 'Финансовый профиль',
      health: 'Профиль здоровья',
      family: 'Семейный профиль',
    },
  },
  insufficientData: {
    English: (dim: string) =>
      `Chris needs more entries about your ${dim} before populating this profile.`,
    French: (dim: string) =>
      `Chris a besoin de plus d'entrées sur ton ${dim} avant de populer ce profil.`,
    Russian: (dim: string) =>
      `Крису нужно больше записей о твоём ${dim}, прежде чем заполнить этот профиль.`,
  },
  staleness: {
    English: (date: string) =>
      `Note: profile data from ${date} — may not reflect current situation.`,
    French: (date: string) =>
      `Note : données du profil datant du ${date} — peuvent ne pas refléter la situation actuelle.`,
    Russian: (date: string) =>
      `Примечание: данные профиля от ${date} — могут не отражать текущую ситуацию.`,
  },
  confidenceLabel: { English: 'confidence', French: 'confiance', Russian: 'уверенность' },
  m011Placeholder: {
    English: 'Psychological profile: not yet available — see M011.',
    French: "Profil psychologique : pas encore disponible — voir M011.",
    Russian: 'Психологический профиль: пока недоступен — см. M011.',
  },
  genericError: {
    English: 'I ran into trouble fetching your profiles. Try again in a moment.',
    French: "J'ai eu un souci en récupérant tes profils. Réessaie dans un instant.",
    Russian: 'Возникла проблема с получением твоих профилей. Попробуй через мгновение.',
  },
} as const;

const DATE_LOCALES: Record<Lang, string> = {
  English: 'en-US',
  French: 'fr-FR',
  Russian: 'ru-RU',
};

// ── Pure formatter (golden-tested in profile.golden.test.ts) ────────────

export function formatProfileForDisplay(
  dimension: Dimension,
  profile: ProfileRow<unknown> | null,
  lang: Lang,
): string {
  const title = MSG.sectionTitles[lang][dimension];

  // Null or zero-confidence → actionable progress indicator
  if (!profile || profile.confidence === 0) {
    return `${title}\n\n${MSG.insufficientData[lang](dimension)}`;
  }

  const pct = Math.round(profile.confidence * 100);
  const header = `${title} (${MSG.confidenceLabel[lang]} ${pct}%)`;

  // Per-dimension switch-case rendering (D-138 — Claude's discretion locked default)
  let body: string;
  switch (dimension) {
    case 'jurisdictional':
      body = renderJurisdictional(profile.data as JurisdictionalProfileData, lang);
      break;
    case 'capital':
      body = renderCapital(profile.data as CapitalProfileData, lang);
      break;
    case 'health':
      body = renderHealth(profile.data as HealthProfileData, lang);
      break;
    case 'family':
      body = renderFamily(profile.data as FamilyProfileData, lang);
      break;
  }

  // Staleness note (D-22) — appended after body, localized date
  const ageDays = (Date.now() - profile.lastUpdated.getTime()) / 86_400_000;
  if (ageDays > STALENESS_DAYS) {
    const date = profile.lastUpdated.toLocaleDateString(DATE_LOCALES[lang], {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    body += '\n\n' + MSG.staleness[lang](date);
  }

  return `${header}\n\n${body}`;
}

// ── Handler integration surface ─────────────────────────────────────────

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
    // M011 placeholder reply (D-18)
    await ctx.reply(MSG.m011Placeholder[lang]);
  } catch (err) {
    logger.warn(
      {
        chatId,
        error: err instanceof Error ? err.message : String(err),
      },
      'profile.command.error',
    );
    await ctx.reply(MSG.genericError[lang]);
  }
}
```

### Bot registration insertion (bot.ts diff)

```typescript
// src/bot/bot.ts — Plan 35-03 single-line addition
import { handleSummaryCommand } from './handlers/summary.js';
// NEW:
import { handleProfileCommand } from './handlers/profile.js';
import { handleVoiceMessageDecline } from './handlers/voice-decline.js';

// ...

// /summary command — must be registered before generic text handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.command('summary', handleSummaryCommand as any);

// NEW (Plan 35-03):
// /profile command — must be registered before generic text handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.command('profile', handleProfileCommand as any);

/** Exported for testability — called by bot.on('message:text') */
export async function handleTextMessage(ctx: {
  // ... (unchanged)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| 5 positional args on `buildSystemPrompt` | 3 positional + 1 extras object | Plan 35-01 | Future extensions (e.g., M011 psychological profile injection) add an extras field, not another positional arg. Signature stays at 4 params. |
| "Inject all profiles into all reasoning modes" (intuitive default) | Per-mode subset via `PROFILE_INJECTION_MAP` | Plan 35-02 (M010-08 mitigation) | COACH topic drift averted; PSYCHOLOGY's salience focused on clinical + situational; REFLECT keeps full context |
| JSON.stringify on profile reads for debugging UI | Explicit `formatProfileForDisplay` + golden snapshot | Plan 35-03 (M010-07 mitigation) | M009 first-Sunday third-person framing class avoided structurally; UX regressions visible at PR review |

**Deprecated/outdated:**
- The 5-positional-arg signature for `buildSystemPrompt` (deprecated by Plan 35-01)
- Implicit "all profiles in all modes" thinking (replaced by `PROFILE_INJECTION_MAP`)

## Assumptions Log

> All factual claims about codebase state were verified by grep / Read tool. Few claims rest on assumption.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | M011 placeholder Russian phrasing "Психологический профиль: пока недоступен — см. M011." | Code Examples (MSG.m011Placeholder) | LOW — planner finalizes translations; the locked decision is the EN phrasing only |
| A2 | French phrasing "Profil juridictionnel" for "Jurisdictional Profile" section title | Code Examples | LOW — planner finalizes; M009 weekly-review FR strings provide style reference |
| A3 | "Chris needs more entries about your {dimension}" English template phrasing | Code Examples (MSG.insufficientData) | LOW — locked decision in D-21 is "actionable progress indicator with entry-count gap"; exact wording is planner's discretion under D-138 |
| A4 | The 8 mode-test files (reflect/coach/psychology/journal/interrogate/produce/photos/photos-memory) that import buildSystemPrompt via vi.mock have assertions whose update is purely cosmetic (no behavioral change) | Call Site Reconfirmation + Pitfall 8 | MEDIUM — if a mode-test assertion specifies `expect.any(String)` positionally as the 5th arg, the assertion still passes against the new shape (a 4th `undefined` extras param matches `expect.any(String)`? NO — `expect.any(String)` matches strings, not undefined; so a positional 5-arg assertion FAILS post-refactor). The mitigation is to update the assertions during Plan 35-01. The risk if wrong: Plan 35-01 leaves some test assertions broken, surfacing during the regression-coverage gate (D-29). |
| A5 | Phase 33's seeded jurisdictional row (confidence 0.3) and capital row (confidence 0.2) are non-null in the live DB | Pitfall 10 | LOW — STATE.md confirms "5 profile tables present on Proxmox DB, 4 seed rows confirmed (jurisdictional=0.3, capital=0.2, health=0, family=0)" |

**A4 is the highest-risk assumption.** The plan must explicitly verify assertion compatibility post-refactor by running the mode-handler test files (`vitest run src/chris/__tests__/{reflect,coach,psychology,journal,interrogate,produce,photos,photos-memory}.test.ts`) immediately after the Plan 35-01 atomic refactor commit lands.

## Open Questions

> All M010 open questions are resolved or marked pre-work. No new open questions surfaced during research.

1. **OQ-3 reconfirmation (RESOLVED).** Re-ran grep 2026-05-13; CONTEXT.md D-06's 8 production call sites match. Two test files named (personality.test.ts, engine.test.ts) are correct; 8 additional test files import buildSystemPrompt via vi.mock — Plan 35-01 task list must include all 10 test files. Documented under "Call Site Reconfirmation" above.

2. **Exact M011 placeholder phrasing (planner's discretion under D-19).** What we know: D-18 + D-19 lock the placeholder reply behavior (5th `ctx.reply` per `/profile` invocation, EN/FR/RU); D-19 references "Psychological profile: not yet available — see M011" as the English phrasing. What's unclear: exact FR/RU translations. Recommendation: planner finalizes during Plan 35-03 task expansion; A1/A2 above are starting suggestions.

3. **`MOCK_PROFILES` fixture exact field values (planner's discretion).** What we know: D-27 specifies 4 cases per dimension; the populated-fresh case may borrow from Phase 33 ground-truth seed (jurisdictional confidence 0.3, capital confidence 0.2); populated-stale case is synthesized. What's unclear: exact synthesized values. Recommendation: planner finalizes during Plan 35-03 task expansion.

## Environment Availability

> Phase 35 has zero external runtime dependencies beyond what Phase 33 and Phase 34 already shipped.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | All TypeScript code | ✓ | already running | — |
| PostgreSQL 15+ (via Docker) | `getOperationalProfiles()` consumed in mode handlers + `/profile` | ✓ | production at Proxmox 192.168.1.50; tests via `scripts/test.sh` Docker compose | — |
| Telegram bot token | `bot.command('profile', ...)` runtime | ✓ | already in production env | — |
| Grammy 1.x | Bot command registration | ✓ | already in `package.json` | — |
| vitest 1.x with `toMatchInlineSnapshot` | Golden test | ✓ | already in `devDependencies` | — |
| Anthropic SDK | NOT NEEDED for Phase 35 (no LLM calls — Plan 35-02 mode handler INTEGRATION tests mock the SDK boundary; Plan 35-03 has no LLM calls at all) | ✓ (already pinned but unused in Phase 35) | — | If tests inadvertently hit the live API, scripts/test.sh `.env` provides the real key; `'test-key'` fallback yields 401 (visible failure) |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

**Phase 35 is purely an internal refactor + new handler + new test. No new infrastructure, no new external services, no new env vars.**

## Validation Architecture

> Nyquist sampling enabled (config.json `workflow.nyquist_validation: true`). Phase 35 has clear, fully-automated validation paths — no manual UAT required for the technical gate (Greg's read-out experience after Plan 35-03 is informal UAT, not a gate).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 1.x (latest pinned in `package.json`) |
| Config file | `vitest.config.ts` (project root) — fileParallelism: false serial execution per Phase 33 D-02 |
| Quick run command | `npx vitest run src/chris/__tests__/personality.test.ts src/chris/__tests__/engine.test.ts` (Plan 35-01 gate) |
| Full suite command | `scripts/test.sh` (Docker compose + Postgres + vitest full run) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SURF-01 | buildSystemPrompt accepts ChrisContextExtras across 8 call sites; existing tests pass post-refactor | regression unit | `npx vitest run src/chris/__tests__/personality.test.ts src/chris/__tests__/engine.test.ts` | ✅ (existing — Plan 35-01 migrates in-place) |
| SURF-01 | resolution.ts ACCOUNTABILITY overload preserved | unit | `npx vitest run src/decisions/__tests__/resolution.test.ts` (if exists) | ✅ check `src/decisions/__tests__/` — likely exists per resolution.ts production code; Wave 0 confirms |
| SURF-02 | REFLECT/COACH/PSYCHOLOGY call getOperationalProfiles + pass operationalProfiles to buildSystemPrompt | positive injection unit | `npx vitest run src/chris/__tests__/reflect.test.ts src/chris/__tests__/coach.test.ts src/chris/__tests__/psychology.test.ts` | ✅ (existing — Plan 35-02 extends with new test cases) |
| SURF-02 | JOURNAL/INTERROGATE/PRODUCE/PHOTOS/ACCOUNTABILITY do NOT call getOperationalProfiles | negative injection unit | `npx vitest run src/chris/__tests__/{journal,interrogate,produce,photos}.test.ts src/decisions/__tests__/resolution.test.ts` | ✅ (existing — Plan 35-02 extends with negative invariant) |
| SURF-02 | PROFILE_INJECTION_MAP shape | unit | `npx vitest run src/memory/__tests__/profiles.test.ts` (extend existing) | ✅ (existing — Plan 35-02 extends with PROFILE_INJECTION_MAP assertions) |
| SURF-02 | formatProfilesForPrompt empty string when no in-scope dimensions; staleness qualifier; 500-token cap | unit | `npx vitest run src/memory/__tests__/profiles.test.ts` | ✅ (existing — Plan 35-02 adds formatProfilesForPrompt unit tests) |
| SURF-03 | /profile emits 5 ctx.reply calls (4 dimensions + M011 placeholder) | handler integration | `npx vitest run src/bot/handlers/__tests__/profile.test.ts` | ❌ Wave 0 — Plan 35-03 creates |
| SURF-03 | /profile handles all-null gracefully | handler integration | same file | ❌ Wave 0 — Plan 35-03 creates |
| SURF-04 | formatProfileForDisplay golden snapshot (4 dim × 4 cases) | golden snapshot | `npx vitest run src/bot/handlers/__tests__/profile.golden.test.ts` | ❌ Wave 0 — Plan 35-03 creates |
| SURF-04 | FR/RU language coverage smoke test (1 dimension) | golden snapshot smoke | same file | ❌ Wave 0 — Plan 35-03 creates |
| SURF-05 | Plain text output (no parse_mode argument to ctx.reply) | handler integration | `profile.test.ts` — assert ctx.reply called with single string arg (no second arg) | ❌ Wave 0 — Plan 35-03 creates |

### Sampling Rate

- **Per task commit (Plan 35-01 mechanical refactor):** `npx tsc --noEmit && npx vitest run src/chris/__tests__/personality.test.ts src/chris/__tests__/engine.test.ts` — TypeScript compile + regression unit tests (~15s)
- **Per task commit (Plan 35-02 injection wiring):** `npx vitest run src/memory/__tests__/profiles.test.ts src/chris/__tests__/{reflect,coach,psychology,journal,interrogate,produce,photos}.test.ts` (~30s)
- **Per task commit (Plan 35-03 /profile handler):** `npx vitest run src/bot/handlers/__tests__/profile.test.ts src/bot/handlers/__tests__/profile.golden.test.ts` (~5s)
- **Per wave merge (each of Plan 35-01, 35-02, 35-03):** `scripts/test.sh` full Docker suite (Postgres + all vitest files, ~3-5 min)
- **Phase gate (before `/gsd-verify-work`):** Full `scripts/test.sh` suite green; manual `/profile` smoke from Telegram against the deployed container (informal — not a hard gate)

### Wave 0 Gaps

- [ ] `src/bot/handlers/__tests__/profile.golden.test.ts` — covers SURF-04 (golden snapshots: 4 dim × 4 cases × EN; FR/RU smoke for 1 dim)
- [ ] `src/bot/handlers/__tests__/profile.test.ts` — covers SURF-03 / SURF-05 (handler integration; mock `getOperationalProfiles` + ctx.reply spy)
- [ ] Verify existence of `src/decisions/__tests__/resolution.test.ts` for ACCOUNTABILITY negative-injection invariant; if absent, Plan 35-02 adds a new test file
- [ ] Mode-test extension scaffold per D-30 — extend `src/chris/__tests__/{reflect,coach,psychology}.test.ts` with positive-injection tests; extend `src/chris/__tests__/{journal,interrogate,produce,photos}.test.ts` with negative-injection invariant
- [ ] Profile reader test extension at `src/memory/__tests__/profiles.test.ts` — add PROFILE_INJECTION_MAP shape test + formatProfilesForPrompt unit tests (empty-string, staleness, char cap)

**Framework install:** None needed — vitest already in devDependencies; `npx vitest run` already routine via `scripts/test.sh`.

## Project Constraints (from CLAUDE.md)

> No `./CLAUDE.md` file exists at the repo root (verified by Read tool — file does not exist). Project-level constraints come from `.planning/PROJECT.md` Key Decisions (D004 / D005 / D008 / D031 / D041) and the project's MEMORY.md auto-context:
>
> - **D004 append-only Pensieve:** profiles are projection/inference; `/profile` is read-only (ANTI-6 in REQUIREMENTS.md excludes editing).
> - **D005 fire-and-forget:** mode-handler injection must not block the primary response — `formatProfilesForPrompt` is synchronous after `getOperationalProfiles` resolves; total added latency is ~4ms × 4 DB queries per message.
> - **D008 first-person framing in Chris's voice; second-person to Greg in /profile output.** D-20 locks the formatter's second-person framing.
> - **D031 structured fact injection:** Operational Profile block placed ABOVE `{pensieveContext}` per D-07, labeled as grounded context not interpretation (D-13's header).
> - **D041 primed-fixture pipeline:** Phase 35 testing uses MOCK_PROFILES fixtures, not 30 real calendar days; this aligns Phase 35 with Phase 36's primed-fixture discipline.
>
> From MEMORY.md auto-context:
> - **Always run full Docker tests:** Plan 35-01 / 35-02 / 35-03 task verification must use `scripts/test.sh`, not just unit-test runs.
> - **Live server access:** Proxmox SSH at 192.168.1.50 works from this sandbox — post-deploy `/profile` smoke against the deployed container is feasible.
> - **Test data strategy:** Phase 35 golden tests use MOCK_PROFILES; no real-API calls, no live LLM calls (D-32).
> - **Phase 34 deployed + cron registered:** First Sunday 22:00 Paris fire 2026-05-17. Greg's first realistic `/profile` invocation lands AFTER this; Phase 35 must work BEFORE this too (pre-fire = jurisdictional/capital partially seeded, health/family confidence 0 — Pitfall 10).

## Security Domain

> Phase 35 is internal refactor + new read-only command. No new authentication, no new data persistence, no new external API call.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Inherited from Grammy `auth` middleware (D009 single-user) — no per-handler auth needed |
| V3 Session Management | no | No session state beyond the existing in-memory `getLastUserLanguage` cache |
| V4 Access Control | no | Single-user app; `auth` middleware in `src/bot/middleware/auth.ts` already enforces |
| V5 Input Validation | minimal | `/profile` accepts no user-supplied data beyond the command itself; `getOperationalProfiles` returns Zod-parsed typed shapes (Phase 33 substrate) |
| V6 Cryptography | no | No new crypto; no secrets handled in Phase 35 |
| V7 Error Handling | yes | Handler catches and logs at `profile.command.error` with localized fallback (mirrors summary.ts pattern) |
| V8 Data Protection | yes | Profile data is per-user (single user — Greg); D-17 plain-text rendering avoids accidental Markdown-injection leakage of user-origin profile content into Telegram entities |
| V11 Business Logic | yes | M010-08 mitigation: PROFILE_INJECTION_MAP prevents inappropriate health-profile salience in COACH; PSYCHOLOGY's health gate (confidence ≥ 0.5) prevents speculative-hypothesis injection as grounded fact |

### Known Threat Patterns for {Grammy Telegram bot + Postgres}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Markdown injection via user-origin profile content | Information disclosure | D-17 plain text only; no `parse_mode: 'Markdown'`; user-origin JSONB values (e.g., country names, narrative text) cannot break Telegram entity formatting |
| Third-person framing leaking implementation details (M010-07) | Information disclosure | D-20 second-person framing + golden snapshot test |
| Profile field name leakage in user-facing output | Information disclosure | `formatProfileForDisplay` per-dimension switch-case renders prose, never `JSON.stringify(profile.data)` |
| Stale profile data inappropriately injected as current fact | Repudiation (Chris asserts a fact Greg has retracted) | D-22 staleness qualifier appended when `last_updated > 21 days ago`; M010-08 mitigation |
| Speculative health hypothesis injected as grounded fact | Tampering with user-facing assertions | D-09 health confidence ≥ 0.5 gate; PROFILE_INJECTION_MAP excludes health from COACH |
| Profile read crash silently degrades mode handler | Denial of service (silent) | Phase 33 `getOperationalProfiles` never-throws; returns null per dimension on error; mode handlers gracefully handle null via D-12 empty-string-return contract |

## Sources

### Primary (HIGH confidence — verified by Read tool against current main HEAD)
- `src/chris/personality.ts:84-177` — buildSystemPrompt declaration + ACCOUNTABILITY overload comment + per-mode switch
- `src/memory/profiles.ts:172-180` — getOperationalProfiles never-throw reader (Phase 33 substrate)
- `src/memory/profiles/schemas.ts` — JurisdictionalProfileSchemaV3 + CapitalProfileSchemaV3 + HealthProfileSchemaV3 + FamilyProfileSchemaV3 (snake_case field names verified)
- `src/bot/bot.ts:32-79` — bot command registration ordering; `/summary` at line 34; generic text handler at line 79
- `src/bot/handlers/summary.ts:1-220` — closest handler precedent (MSG localization map, Grammy Context, getLastUserLanguage, plain-text replies, error path)
- `src/bot/handlers/__tests__/summary.test.ts:77-91` — buildCtx Grammy Context spy helper pattern
- `src/chris/__tests__/reflect.test.ts:236-242` — existing buildSystemPrompt assertion shape (5-positional-arg)
- `src/chris/__tests__/coach.test.ts:243-249` — mirror assertion shape; line 106 shows `realBuildSystemPrompt` import pattern
- `src/chris/__tests__/personality.test.ts` — 31 direct call sites (lines 9, 18, 26, ..., 227)
- `src/chris/modes/reflect.ts:1-128` — current REFLECT mode handler structure (Plan 35-02 wires injection here)
- `src/decisions/resolution.ts:240-257` — ACCOUNTABILITY call site; rawLang is the 4th positional arg
- `src/chris/language.ts:51-53` — getLastUserLanguage in-memory cache reader
- `.planning/phases/35-surfaces/35-CONTEXT.md` — all 32 locked decisions D-01..D-32
- `.planning/research/PITFALLS.md` lines 202-273 (M010-07 + M010-08), 401-405 (Performance Traps), 410-415 (UX Pitfalls), 419-433 (Looks-Done-But-Isn't checklist)
- `.planning/research/SUMMARY.md` lines 171-187 (Phase 35 deliverables)
- `.planning/ROADMAP.md` lines 75-89 (Phase 35 success criteria + HARD CO-LOC #M10-4 / #M10-5)
- `.planning/REQUIREMENTS.md` lines 27-33 (SURF-01..05) + lines 93-97 (traceability)
- `.planning/STATE.md` (current project state; Phase 33 + 34 shipped; Phase 35 ready to plan)
- `M010_Operational_Profiles.md` (project root) — original spec ("John" → all code uses "Greg")
- Grep `grep -rn "buildSystemPrompt(" src/` 2026-05-13 — confirms 8 production call sites + 10 test files

### Secondary (MEDIUM confidence — pattern matches existing codebase but extension is new)
- `src/bot/handlers/decisions.ts` — alternative handler precedent with sub-commands (less relevant since `/profile` has no sub-commands)
- `src/chris/__tests__/{coach,psychology}.test.ts:170` — `realBuildSystemPrompt` import + describe block pattern for integration-style assertion

### Tertiary (LOW confidence — not strictly verified)
- Exact French/Russian translations for M011 placeholder, "insufficient data" template, staleness note — drawn from M009 weekly-review FR/RU strings by analogy; planner finalizes during Plan 35-03 task expansion (flagged in Assumptions Log A1/A2/A3)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all libraries already in use; precedent for every pattern lives in the codebase
- Architecture: HIGH — CONTEXT.md locks 32 decisions; this research pass reconfirms the call-site inventory and surfaces 1 minor drift (8 test files using vi.mock vs. 2 named in D-06)
- Pitfalls: HIGH — M010-07/08 mitigations are explicit in PITFALLS.md; locked-decision discipline in CONTEXT.md addresses each; 10 pitfalls catalogued above with mitigations
- Test scaffolding: HIGH — vitest + Grammy Context spy pattern is well-established in `summary.test.ts` and `reflect.test.ts`; existing PROFILE substrate tests at `src/memory/__tests__/profiles.test.ts` extend naturally

**Research date:** 2026-05-13
**Valid until:** 2026-05-27 (14 days — stable code-only phase; risk of drift is low because Phase 34 is already deployed and Phase 36 is downstream, not concurrent)
