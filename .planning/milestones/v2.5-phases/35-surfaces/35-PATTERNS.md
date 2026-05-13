# Phase 35: Surfaces — Pattern Map

**Mapped:** 2026-05-13
**Files analyzed:** 13 (3 new + 10 modified) — see CONTEXT.md §code_context "Integration points"
**Analogs found:** 13 / 13 (all in-codebase)

This document maps every file Phase 35 creates or modifies to its closest existing analog and extracts the concrete code excerpts a plan author can copy. All 32 decisions in `35-CONTEXT.md` are locked; pattern excerpts below match those decisions.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/bot/handlers/profile.ts` (new) | bot handler + pure formatter | request-response | `src/bot/handlers/summary.ts` | exact (role + flow + plain-text + EN/FR/RU MSG map + langOf + `ctx.reply`) |
| `src/bot/handlers/__tests__/profile.test.ts` (new) | integration test (handler) | request-response | `src/bot/handlers/__tests__/summary.test.ts` | exact (`buildCtx` Grammy spy at lines 77-91; date-fixture cleanup not needed but lifecycle/`beforeEach` mirror is) |
| `src/bot/handlers/__tests__/profile.golden.test.ts` (new) | unit test (pure fn, snapshot) | transform | none for `toMatchInlineSnapshot` — closest skeleton is `src/chris/__tests__/reflect.test.ts` describe/it/`expect.toContain` blocks; weekly-review-prompt tests for "snapshot-by-`toContain`-anchors" | role-match (test layout); **introduces project's first `toMatchInlineSnapshot`** — no in-codebase analog |
| `src/chris/personality.ts` (mod) | core prompt-assembly module | transform | self-reference (lines 84-174 is the body being refactored); structurally mirrors `weekly-review-prompt.ts:assembleWeeklyReviewPrompt` for section-by-section assembly | self-reference (refactoring its own internals) |
| `src/chris/modes/reflect.ts` (mod) | mode handler | request-response | self-reference (current shape at lines 74-76); Plan 35-02 inserts `getOperationalProfiles()` + `formatProfilesForPrompt()` per the `getRelationalMemories()` + `buildRelationalContext()` precedent at lines 70-71 | exact (analog is its current sibling line 70-71 pattern) |
| `src/chris/modes/coach.ts` (mod) | mode handler | request-response | identical to reflect.ts (lines 70-76 are the same shape) | exact |
| `src/chris/modes/psychology.ts` (mod) | mode handler | request-response | identical to reflect.ts | exact |
| `src/chris/modes/journal.ts`, `interrogate.ts`, `produce.ts`, `photos.ts` (mod) | mode handler | request-response | self-reference — call-site shape migration only (positional → extras). No injection wiring added. | exact (mechanical) |
| `src/decisions/resolution.ts:252-257` (mod) | accountability orchestrator | request-response | self-reference — ACCOUNTABILITY overload preserved; positional `rawLang` → `{ language: rawLang }` only | exact (mechanical) |
| `src/memory/profiles.ts` (mod — adds exports) | reader-layer module | CRUD + transform | self-reference (`getOperationalProfiles` lives in this file); for pure formatter skeleton see `src/rituals/weekly-review-prompt.ts:assembleWeeklyReviewPrompt`; for `Record<...>` named-constant export see `src/decisions/lifecycle.ts:16` (`LEGAL_TRANSITIONS`) | exact (same file for one export, role-match analog for the formatter) |
| `src/bot/bot.ts:34-35` (mod — 1 new line) | bot wiring | event-driven | `src/bot/bot.ts:32-34` (existing `/summary` registration) | exact |

## Pattern Assignments

### `src/bot/handlers/profile.ts` (new — handler + pure formatter, request-response)

**Analog:** `src/bot/handlers/summary.ts` (220 lines; the closest precedent — Plan 35-03's locked decisions D-16/17/19/23 all cite it by line).

**Module header pattern** (`summary.ts:1-32`) — multi-line block comment with phase reference + requirement IDs + edge cases + security notes. Profile.ts header should cite Phase 35-03, SURF-03/04/05, HARD CO-LOC #M10-5, plus the M010-07 second-person framing imperative.

**Imports** (`summary.ts:34-40`):
```typescript
import type { Context } from 'grammy';
import { DateTime } from 'luxon';
import { getEpisodicSummary } from '../../pensieve/retrieve.js';
import { getLastUserLanguage } from '../../chris/language.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import type { episodicSummaries } from '../../db/schema.js';
```

Adapt for `profile.ts`:
```typescript
import type { Context } from 'grammy';
import { getOperationalProfiles, type ProfileRow } from '../../memory/profiles.js';
import type {
  JurisdictionalProfileData, CapitalProfileData,
  HealthProfileData, FamilyProfileData,
} from '../../memory/profiles/schemas.js';
import { getLastUserLanguage } from '../../chris/language.js';
import { logger } from '../../utils/logger.js';
```

**Lang narrowing helper** (`summary.ts:42-47`) — copy verbatim, profile.ts needs the same `langOf(raw) → 'English' | 'French' | 'Russian'` narrowing because `getLastUserLanguage` returns `string | null`:
```typescript
type Lang = 'English' | 'French' | 'Russian';

function langOf(raw: string | null): Lang {
  if (raw === 'French' || raw === 'Russian' || raw === 'English') return raw;
  return 'English';
}
```

**`MSG` localization-map pattern** (`summary.ts:51-82`) — D-19 locks this shape for profile.ts:
```typescript
// ── Localized message strings ───────────────────────────────────────────────
const MSG = {
  usage: {
    English: 'Use: /summary [YYYY-MM-DD]. No date = yesterday.',
    French: 'Utilisation : /summary [YYYY-MM-DD]. Sans date = hier.',
    Russian: 'Использование: /summary [YYYY-MM-DD]. Без даты — вчера.',
  },
  noRowPast: {
    English: (d: string) => `No summary for ${d}. You may not have written anything that day.`,
    French: (d: string) => `Pas de résumé pour le ${d}. Tu n'as peut-être rien écrit ce jour-là.`,
    Russian: (d: string) => `Нет сводки за ${d}. Возможно, в тот день ты ничего не записал.`,
  },
  // ... labels block: section headers per language, second-person framed (D-20)
  labels: {
    English: { summaryFor: 'Summary for', importance: 'importance', topics: 'Topics', arc: 'Emotional arc', quotes: 'Key moments' },
    French: { summaryFor: 'Résumé du', importance: 'importance', topics: 'Thèmes', arc: 'Arc émotionnel', quotes: 'Moments clés' },
    Russian: { summaryFor: 'Сводка за', importance: 'важность', topics: 'Темы', arc: 'Эмоциональная дуга', quotes: 'Ключевые моменты' },
  },
} as const;
```

For `/profile`, the MSG map needs keys for: section titles per dimension, "insufficient data" / progress-indicator template (D-21), staleness note template (D-22), generic error, M011 placeholder string (D-18). All values are second-person framed (D-20) — verbatim "You're currently in ...", "Your residency status: ...", NEVER "Greg's ...".

**Pure-function formatter** (`summary.ts:86-109`) — `formatSummary(row, lang)` is the closest analog for `formatProfileForDisplay(dimension, profile, lang)`:
```typescript
function formatSummary(row: EpisodicRow, lang: Lang): string {
  const L = MSG.labels[lang];
  const dateStr =
    typeof row.summaryDate === 'string'
      ? row.summaryDate
      : (row.summaryDate as Date).toISOString().slice(0, 10);
  const lines = [
    `${L.summaryFor} ${dateStr} (${L.importance} ${row.importance}/10)`,
    '',
    row.summary,
    '',
    `${L.topics}: ${row.topics.join(', ')}`,
    `${L.arc}: ${row.emotionalArc}`,
  ];
  if (row.keyQuotes.length > 0) {
    lines.push('', `${L.quotes}:`);
    for (const q of row.keyQuotes) {
      lines.push(`- "${q}"`);
    }
  }
  return lines.join('\n');
}
```

**Mirror for `formatProfileForDisplay`** (Plan 35-03 task 1):
- Build a `lines: string[]` array
- Section title row: `"${L.sectionTitle.jurisdictional} (${L.confidence} ${Math.round(profile.confidence * 100)}%)"`
- Blank line separator (D-23 — blank lines only, never `===` or `---` Markdown rules)
- Field rows in second person (`"${L.youAreIn} ${profile.data.current_location}"`)
- Conditional staleness note (D-22): if `Date.now() - profile.lastUpdated.getTime() > 21 * 86_400_000`, push `L.staleNote(formatDate(profile.lastUpdated))`
- Conditional progress-indicator for null/zero-confidence (D-21): if `profile === null` return `L.insufficientData(dimension)`
- `return lines.join('\n')`

**Handler integration pattern** (`summary.ts:157-219`) — `handleSummaryCommand`:
```typescript
export async function handleSummaryCommand(ctx: Context): Promise<void> {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return;

  const lang = langOf(getLastUserLanguage(chatId.toString()));
  // ... parse / branch logic ...

  try {
    const row = await getEpisodicSummary(new Date(`${targetDate}T00:00:00Z`));
    if (row === null) {
      await ctx.reply(MSG.noRowPast[lang](targetDate));
      return;
    }
    await ctx.reply(formatSummary(row, lang));
  } catch (err) {
    logger.warn(
      {
        chatId,
        targetDate,
        error: err instanceof Error ? err.message : String(err),
      },
      'summary.command.error',
    );
    await ctx.reply(MSG.genericError[lang]);
  }
}
```

**Mirror for `handleProfileCommand`** (Plan 35-03 task 2):
1. Get `chatId` + early-return guard.
2. `const lang = langOf(getLastUserLanguage(chatId.toString()))` — D-19.
3. `try { const profiles = await getOperationalProfiles(); for (const dim of ['jurisdictional','capital','health','family']) await ctx.reply(formatProfileForDisplay(dim, profiles[dim], lang)); await ctx.reply(MSG.m011Placeholder[lang]); } catch (err) { logger.warn({...}, 'profile.command.error'); await ctx.reply(MSG.genericError[lang]); }`
4. 5 total `ctx.reply()` calls per D-18 (4 dimensions + M011 placeholder).
5. Plain text — NO `parse_mode` argument (D-17 + SURF-05).

**Logger pattern** (`summary.ts:209-216`) — `logger.warn({ chatId, ..., error: err instanceof Error ? err.message : String(err) }, 'summary.command.error')`. Profile.ts uses message-key `'profile.command.error'` to follow the `subsystem.event` convention from CONVENTIONS.md §Logging.

---

### `src/bot/handlers/__tests__/profile.test.ts` (new — handler integration test, request-response)

**Analog:** `src/bot/handlers/__tests__/summary.test.ts` (261 lines) — exact match for Grammy `Context.reply` spy idiom + handler invocation.

**Header pattern** (`summary.test.ts:1-26`) — multi-line module block comment that names the requirement IDs covered, the D-* decisions, the test cases (a..f), and the cleanup scope. Mirror for profile.test.ts: name SURF-03/04/05 + D-18 (5 replies) + D-19 (EN fallback) + D-31 (handler integration). Profile.test.ts does NOT touch the DB — it mocks `getOperationalProfiles` — so no `cleanup()` helper is needed.

**`buildCtx` Grammy spy helper** (`summary.test.ts:77-91`) — **this is the pattern Plan 35-03 task 2 needs verbatim**:
```typescript
/** Build a duck-typed Grammy Context that captures all ctx.reply calls. */
function buildCtx(
  text: string,
  chatId: number = FIXTURE_CHAT_ID,
): { captured: string[]; ctx: any } {
  const captured: string[] = [];
  const ctx = {
    chat: { id: chatId },
    from: { id: chatId },
    message: { text },
    reply: async (t: string) => {
      captured.push(t);
    },
  };
  return { captured, ctx };
}
```

Use as-is for `/profile`. Test pattern:
```typescript
const { captured, ctx } = buildCtx('/profile');
await handleProfileCommand(ctx);
expect(captured).toHaveLength(5);  // 4 dimensions + M011 placeholder (D-18)
expect(captured[0]).toContain('Jurisdictional');  // section title
expect(captured[4]).toMatch(/M011|psychological/i);  // placeholder
```

**Mock the memory layer with `vi.mock` + `vi.mocked`** — closest analog is `src/episodic/__tests__/cron.test.ts:52-99` (mocks a sibling module + uses `vi.mocked(...).mockResolvedValue(...)`):
```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────
vi.mock('../../../memory/profiles.js', () => ({
  getOperationalProfiles: vi.fn(),
}));

// (Optional but recommended: mock logger to silence warn output and assert keys)
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  },
}));

// ── Import module under test AFTER mocks ───────────────────────────────────
const { handleProfileCommand } = await import('../profile.js');
const profilesModule = await import('../../../memory/profiles.js');

// ── Setup ──────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(profilesModule.getOperationalProfiles).mockResolvedValue({
    jurisdictional: MOCK_PROFILES.jurisdictional.populatedFresh,
    capital: MOCK_PROFILES.capital.populatedFresh,
    health: MOCK_PROFILES.health.populatedFresh,
    family: MOCK_PROFILES.family.populatedFresh,
  });
});
```

The `await import('../profile.js')` AFTER `vi.mock` is the project's canonical Vitest hoisting idiom (see `cron.test.ts:88` and `reflect.test.ts:103`).

**Language-state reset pattern** (`summary.test.ts:140-144, 153-155`) — `clearLanguageState(chatId.toString())` in `afterAll` and `beforeEach`. Plan 35-03 should mirror this so EN-default tests don't leak into FR/RU tests on serial vitest runs:
```typescript
import { clearLanguageState } from '../../../chris/language.js';
// ...
beforeEach(() => {
  vi.clearAllMocks();
  clearLanguageState(FIXTURE_CHAT_ID.toString());
});
afterAll(() => {
  clearLanguageState(FIXTURE_CHAT_ID.toString());
});
```

**Assertion shape** (`summary.test.ts:161-178`) — `expect(captured).toHaveLength(N)` + per-reply `.toContain(...)`. Test order matches D-18: `['jurisdictional', 'capital', 'health', 'family', 'M011-placeholder']`.

---

### `src/bot/handlers/__tests__/profile.golden.test.ts` (new — pure-function snapshot test)

**No in-codebase analog for `toMatchInlineSnapshot`.** Codebase grep confirms zero usage of `toMatchInlineSnapshot` or `toMatchSnapshot` across `src/`, `scripts/`, `tests/`. **Plan 35-03 introduces the project's first snapshot test.** Closest skeletons for test layout:

- **Test-file structure / describe nesting / fixture-import idiom** — `src/rituals/__tests__/weekly-review-prompt.test.ts` (existence implied by `weekly-review-prompt.ts:37` reference) and `src/chris/__tests__/reflect.test.ts:160-177` (mode-prompt describe block + `expect(text).toContain(anchor)` style — close but uses `.toContain`, not snapshots).
- **Inline-fixture pattern** — `src/chris/__tests__/reflect.test.ts:116-156` `MOCK_SEARCH_RESULTS` / `MOCK_RELATIONAL_MEMORIES` — copy this shape for `MOCK_PROFILES` (4 dimensions × 4 cases per D-27).

**Skeleton for Plan 35-03 task 4** (`profile.golden.test.ts`):
```typescript
import { describe, it, expect } from 'vitest';
import { formatProfileForDisplay } from '../profile.js';
import type { ProfileRow } from '../../../memory/profiles.js';
import type {
  JurisdictionalProfileData, CapitalProfileData,
  HealthProfileData, FamilyProfileData,
} from '../../../memory/profiles/schemas.js';

// ── Fixtures ───────────────────────────────────────────────────────────────
// Per D-27: each dimension × 4 cases (null / zero-confidence / populated-fresh /
// populated-stale). Stale = lastUpdated > 21 days ago.
const FRESH_DATE = new Date('2026-05-13T00:00:00Z');  // fixed — golden output is determinate
const STALE_DATE = new Date('2026-04-01T00:00:00Z');  // 42 days before FRESH_DATE

const MOCK_PROFILES = {
  jurisdictional: {
    null: null as ProfileRow<JurisdictionalProfileData> | null,
    zeroConfidence: { data: { /* ... */ }, confidence: 0, lastUpdated: FRESH_DATE, schemaVersion: 1 },
    populatedFresh: { data: { current_location: 'France', residency_status: 'French resident', /* ... */ }, confidence: 0.72, lastUpdated: FRESH_DATE, schemaVersion: 1 },
    populatedStale: { data: { current_location: 'France', /* ... */ }, confidence: 0.72, lastUpdated: STALE_DATE, schemaVersion: 1 },
  },
  // ... capital / health / family ...
} as const;

// ── Tests ──────────────────────────────────────────────────────────────────
describe('formatProfileForDisplay — jurisdictional', () => {
  it('null profile returns localized insufficient-data message (EN)', () => {
    expect(formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.null, 'English'))
      .toMatchInlineSnapshot(`""`);  // <-- vitest -u fills this in
  });

  it('zero-confidence profile returns progress indicator (EN)', () => {
    expect(formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.zeroConfidence, 'English'))
      .toMatchInlineSnapshot(`""`);
  });

  it('populated-fresh profile returns full second-person summary (EN)', () => {
    expect(formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.populatedFresh, 'English'))
      .toMatchInlineSnapshot(`""`);
  });

  it('populated-stale profile appends staleness note (EN)', () => {
    expect(formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.populatedStale, 'English'))
      .toMatchInlineSnapshot(`""`);
  });
});

// Repeat for capital / health / family = 16 cases total (D-27).

// Language-coverage smoke test — 1 dimension × 2 languages (FR / RU) per D-27.
describe('formatProfileForDisplay — language coverage', () => {
  it('FR uses French section labels for populated-fresh jurisdictional', () => {
    const out = formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.populatedFresh, 'French');
    expect(out).toMatch(/Profil juridictionnel|Résidence|Tu es/i);
  });
  it('RU uses Russian section labels for populated-fresh jurisdictional', () => {
    const out = formatProfileForDisplay('jurisdictional', MOCK_PROFILES.jurisdictional.populatedFresh, 'Russian');
    expect(out).toMatch(/Юрисдикционный|резидент|Ты/);
  });
});
```

**Critical: the snapshots are populated by `vitest -u` (update) on first run** — the planner writes empty `toMatchInlineSnapshot(\`""\`)` placeholders; vitest fills them in. Reviewers verify the filled-in snapshot text is second-person framed (no "Greg's ...", no "His ...") — this is the M010-07 golden-output regression gate.

**No `toMatchInlineSnapshot` precedent means**: the planner should add an inline comment explaining the snapshot mechanism (`vitest -u` to update) for the first reviewer who encounters it. Suggest a TSDoc block at the top of `profile.golden.test.ts` documenting the snapshot update workflow.

---

### `src/chris/personality.ts` (modified — signature refactor)

**Analog:** self-reference (the function is being refactored in place; lines 84-174 are the body). For section-by-section prompt assembly, the structural analog is `src/rituals/weekly-review-prompt.ts:assembleWeeklyReviewPrompt` (lines 144-188 — pushes string sections, joins with `\n\n`).

**Current signature** (`personality.ts:94-100`):
```typescript
export function buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): string {
```

**Target signature** (Plan 35-01 task 1):
```typescript
export interface ChrisContextExtras {
  language?: string;
  declinedTopics?: DeclinedTopic[];
  operationalProfiles?: string;  // pre-rendered, NOT the OperationalProfiles object (D-04)
}

export function buildSystemPrompt(
  mode: ChrisMode,
  pensieveContext?: string,
  relationalContext?: string,
  extras: ChrisContextExtras = {},
): string {
  const { language, declinedTopics, operationalProfiles } = extras;
  // ... body uses these locals exactly as before ...
}
```

**Preserved verbatim — DO NOT TOUCH** (`personality.ts:84-92`) — the IN-04 ACCOUNTABILITY overload comment block. D-05 locks this:
```typescript
/**
 * IN-04: ACCOUNTABILITY mode overloads the parameter semantics. To avoid a
 * breaking signature change, `pensieveContext` is substituted into the
 * `{decisionContext}` placeholder (prediction / falsification criterion /
 * resolve-by / Greg's resolution), and `relationalContext` is substituted into
 * the template's own `{pensieveContext}` placeholder (the ±48h temporal
 * Pensieve block). Callers from `resolution.ts` pass the decision context in
 * the `pensieveContext` slot and the temporal Pensieve block in the
 * `relationalContext` slot — see the call site at `resolution.ts` (~line 251)
 * and the per-case note in the switch below.
 */
```

**Operational Profile injection point** (D-07 — prepend block to `contextValue` BEFORE the `.replace('{pensieveContext}', ...)` call, ONLY for REFLECT/COACH/PSYCHOLOGY). Existing precedent at `personality.ts:156-159` (Known Facts post-injection for JOURNAL/INTERROGATE):
```typescript
// Inject static Known Facts block for modes that need factual grounding (D-04, D-05)
if (mode === 'JOURNAL' || mode === 'INTERROGATE') {
  prompt += '\n\n' + buildKnownFactsBlock();
}
```

**Mirror for D-07** — but prepended to `contextValue`, NOT appended to `prompt`, because the operational profile block must sit **above** `{pensieveContext}` per D-07. Suggested implementation inside the switch cases for REFLECT/COACH/PSYCHOLOGY:
```typescript
case 'REFLECT': {
  const profileBlock = operationalProfiles
    ? `## Operational Profile (grounded context — not interpretation)\n${operationalProfiles}\n\n`
    : '';
  modeBody = REFLECT_SYSTEM_PROMPT
    .replace('{pensieveContext}', profileBlock + contextValue)
    .replace('{relationalContext}', relationalContext || 'No observations accumulated yet.');
  break;
}
```

The verbatim header string `'## Operational Profile (grounded context — not interpretation)'` is locked by D-13.

**Language directive** (`personality.ts:161-163`) — unchanged code, but `language` now destructured from `extras`:
```typescript
if (language) {
  prompt += `\n\n## Language Directive (MANDATORY)\nRespond in ${language} only. This overrides any language signals in conversation history. Do not respond in any other language.`;
}
```

**Declined topics block** (`personality.ts:165-174`) — unchanged code, `declinedTopics` now destructured from `extras`.

---

### `src/chris/modes/reflect.ts` / `coach.ts` / `psychology.ts` (mod — Plans 35-01 + 35-02)

**Analog:** self-reference. The 3 in-scope mode handlers have near-identical line shapes (75-76 for reflect/coach, 76-77 for psychology).

**Current call shape** (`reflect.ts:74-76`):
```typescript
// Build conversation history and system prompt with both contexts
const history = await buildMessageHistory(chatId);
const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, language, declinedTopics);
```

**Plan 35-01 target** (call-shape migration only — no injection yet, that's Plan 35-02):
```typescript
const history = await buildMessageHistory(chatId);
const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, {
  language,
  declinedTopics,
});
```

**Plan 35-02 target** (inject `getOperationalProfiles` + `formatProfilesForPrompt` BEFORE `buildSystemPrompt`; analog precedent for the read-then-format-then-pass pattern is the existing `getRelationalMemories` + `buildRelationalContext` block in the same file at lines 69-71):

Existing analog (`reflect.ts:69-72`):
```typescript
// Fetch relational memory observations for deeper synthesis
const relationalMemories = await getRelationalMemories({ limit: 20 });
const relationalContext = buildRelationalContext(relationalMemories);
const relationalCount = relationalMemories.length;
```

Mirror for Plan 35-02 (insert immediately after the relationalContext block):
```typescript
// Phase 35 — inject operational profiles for in-scope modes (D-14)
import { getOperationalProfiles, formatProfilesForPrompt } from '../../memory/profiles.js';
// ...
const profiles = await getOperationalProfiles();
const operationalProfiles = formatProfilesForPrompt(profiles, 'REFLECT');

const systemPrompt = buildSystemPrompt('REFLECT', pensieveContext, relationalContext, {
  language,
  declinedTopics,
  operationalProfiles,
});
```

D-14 locks the call order: `getOperationalProfiles()` → `formatProfilesForPrompt()` → `buildSystemPrompt()`. No caching layer (single-user scale).

---

### `src/chris/modes/journal.ts` / `interrogate.ts` / `produce.ts` / `photos.ts` (mod — Plan 35-01 only, no injection)

**Analog:** self-reference. These 4 out-of-scope modes get the call-shape migration ONLY.

**Current** (`journal.ts:81`):
```typescript
text: buildSystemPrompt('JOURNAL', pensieveContext, undefined, language, declinedTopics),
```

**Plan 35-01 target**:
```typescript
text: buildSystemPrompt('JOURNAL', pensieveContext, undefined, { language, declinedTopics }),
```

`photos.ts:182` is identical shape, same migration. `interrogate.ts:115` + `produce.ts:72` same. **Plan 35-02 adds the negative-injection invariant test** but does NOT add code (no `getOperationalProfiles` call in these handlers — that's the D-28 invariant).

---

### `src/decisions/resolution.ts:252-257` (mod — Plan 35-01 only)

**Analog:** self-reference. ACCOUNTABILITY overload preserved.

**Current** (`resolution.ts:251-257`):
```typescript
// 5. Build system prompt and call Sonnet for acknowledgment
const systemPrompt = buildSystemPrompt(
  'ACCOUNTABILITY',
  decisionContext,
  temporalContext,
  rawLang,
);
```

**Plan 35-01 target** (D-05 — overload semantics preserved, positional `rawLang` becomes `{ language: rawLang }`):
```typescript
const systemPrompt = buildSystemPrompt(
  'ACCOUNTABILITY',
  decisionContext,
  temporalContext,
  { language: rawLang },
);
```

Note: no `declinedTopics` here (per D-06 — verify intentional in plan; the call site does not have a declinedTopics reference in scope).

---

### `src/memory/profiles.ts` (mod — adds `PROFILE_INJECTION_MAP` + `formatProfilesForPrompt`)

**Analog for the named constant**: `src/decisions/lifecycle.ts:11-25` (`LEGAL_TRANSITIONS`) — the canonical `Record<...>` named-constant export with TSDoc + `as const` + Readonly wrapper:
```typescript
/**
 * Legal transitions for `decisions.status` — locked per D-04.
 * Terminal states (reviewed/withdrawn/stale/abandoned) have NO outgoing edges.
 * Any (from, to) pair NOT listed here throws InvalidTransitionError.
 */
export const LEGAL_TRANSITIONS: Readonly<Record<DecisionStatusLiteral, readonly DecisionStatusLiteral[]>> = {
  'open-draft': ['open', 'withdrawn', 'abandoned'],
  'open':       ['due', 'withdrawn'],
  // ...
} as const;
```

**Mirror for `PROFILE_INJECTION_MAP`** (Plan 35-02 task 1) — already locked by D-08 with the verbatim values:
```typescript
type Dimension = 'jurisdictional' | 'capital' | 'health' | 'family';

/**
 * Per-mode subset of profile dimensions to inject into the system prompt.
 * Locked per Phase 35 D-08 + PITFALLS.md M010-08 mitigation:
 *   - REFLECT synthesizes across all 4 dimensions by design
 *   - COACH gets decisions + constraints only — health → topic-drift risk
 *   - PSYCHOLOGY needs clinical + situational grounding only
 * JOURNAL / INTERROGATE / PRODUCE / PHOTOS / ACCOUNTABILITY absent by design
 * (D-28 negative invariant — no injection for these modes).
 */
export const PROFILE_INJECTION_MAP: Readonly<Record<'REFLECT' | 'COACH' | 'PSYCHOLOGY', readonly Dimension[]>> = {
  REFLECT: ['jurisdictional', 'capital', 'health', 'family'],
  COACH: ['capital', 'family'],
  PSYCHOLOGY: ['health', 'jurisdictional'],
} as const;
```

**Analog for `formatProfilesForPrompt`**: pure-function + section-builder skeleton from `src/rituals/weekly-review-prompt.ts:144-188` (`assembleWeeklyReviewPrompt`):
```typescript
export function assembleWeeklyReviewPrompt(
  input: WeeklyReviewPromptInput,
): string {
  const sections: string[] = [];

  // 1. Constitutional preamble
  sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());

  // 2. Role preamble
  sections.push(buildRolePreamble());

  // 3. Date-window block
  sections.push(buildDateWindowBlock(input.weekStart, input.weekEnd, input.tz));

  // 4. Pattern-only directive
  sections.push(buildPatternOnlyDirective());

  // 5. Wellbeing block — CONDITIONAL
  if (input.includeWellbeing && input.wellbeingSnapshots && input.wellbeingSnapshots.length > 0) {
    sections.push(buildWellbeingBlock(input.wellbeingSnapshots));
  }

  // 6. Summaries block
  sections.push(buildSummariesBlock(input.summaries));

  // 7. Resolved decisions block — CONDITIONAL on length > 0
  if (input.resolvedDecisions.length > 0) {
    sections.push(buildResolvedDecisionsBlock(input.resolvedDecisions));
  }

  // 8. Structured-output directive
  sections.push(buildStructuredOutputDirective());

  return sections.join('\n\n');
}
```

**Mirror for `formatProfilesForPrompt`** (Plan 35-02 task 2):
```typescript
/**
 * Pure function — renders the per-mode subset of operational profiles as a
 * prompt-side block. Returns `""` when no in-scope dimensions render (D-12).
 *
 * Gates:
 *   - mode not in PROFILE_INJECTION_MAP → "" (D-12.a)
 *   - all in-scope dimensions null → "" (D-12.b)
 *   - all in-scope dimensions zero-confidence → "" (D-12.c)
 *   - health dimension only renders when confidence >= 0.5 (D-09)
 *   - per-dimension block truncated at 2000 chars + "..." marker (D-11)
 *   - lastUpdated > 21d ago appends staleness note (D-10)
 */
export function formatProfilesForPrompt(
  profiles: OperationalProfiles,
  mode: string,
): string {
  // (a) mode not in map → empty
  const scope = PROFILE_INJECTION_MAP[mode as 'REFLECT' | 'COACH' | 'PSYCHOLOGY'];
  if (!scope) return '';

  const sections: string[] = [];
  const now = Date.now();
  const STALENESS_MS = 21 * 86_400_000;
  const CAP = 2000;

  for (const dim of scope) {
    const row = profiles[dim];
    if (!row) continue;                               // null skip
    if (row.confidence === 0) continue;               // zero-confidence skip
    if (dim === 'health' && row.confidence < 0.5) continue;  // D-09 health gate

    let block = renderDimensionForPrompt(dim, row);   // per-dimension switch
    if (block.length > CAP) block = block.slice(0, CAP - 3) + '...';
    if (now - row.lastUpdated.getTime() > STALENESS_MS) {
      const dateStr = row.lastUpdated.toISOString().slice(0, 10);
      block += `\nNote: profile data from ${dateStr} — may not reflect current state.`;
    }
    sections.push(block);
  }

  if (sections.length === 0) return '';               // (b/c/d) all skipped → empty
  return sections.join('\n\n');
}
```

The `renderDimensionForPrompt(dim, row)` helper is a switch-case over `'jurisdictional' | 'capital' | 'health' | 'family'` rendering snake_case fields from `row.data` — closest existing precedent is `src/pensieve/ground-truth.ts:175-185` (Object.fromEntries pattern) but `formatProfilesForPrompt` is simpler — just stringifies known fields.

---

### `src/bot/bot.ts:34-35` (mod — 1 new line)

**Analog:** `src/bot/bot.ts:32-34` (existing `/summary` registration block).

**Existing** (`bot.ts:32-34`):
```typescript
// /summary command — must be registered before generic text handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.command('summary', handleSummaryCommand as any);
```

**Plan 35-03 target** (insert between line 34 and the generic text handler at line 79):
```typescript
// /summary command — must be registered before generic text handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.command('summary', handleSummaryCommand as any);

// /profile command — must be registered before generic text handler (SURF-03)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
bot.command('profile', handleProfileCommand as any);
```

Plus an import at the top of bot.ts:
```typescript
import { handleProfileCommand } from './handlers/profile.js';
```

---

## Shared Patterns

### Module-header comment block

**Source:** `src/bot/handlers/summary.ts:1-32`, `src/memory/profiles.ts:1-17`, `src/rituals/weekly-review-prompt.ts:1-44`
**Apply to:** `src/bot/handlers/profile.ts`, both new test files
**Pattern:** Multi-line block comment opening every non-trivial module, naming:
- Phase number + plan number + requirement IDs (SURF-03, etc.)
- D-* decisions the file enforces
- What the file does (1-2 sentences)
- What it does NOT do (boundaries)
- Mirror reference (which existing file the structure echoes)

This is project-wide convention per CONVENTIONS.md §Comments line 229.

### ESM `.js` suffix on internal imports

**Source:** CONVENTIONS.md §Language & Module System; every file in `src/`
**Apply to:** all new files in Phase 35
**Pattern:** `import { foo } from '../bar.js'` — never `'./bar'` or `'./bar.ts'`. External npm imports keep the bare specifier. Plan 35-03 must import `getOperationalProfiles` from `'../../memory/profiles.js'`, not `'../../memory/profiles'`.

### Logger structured-call pattern

**Source:** CONVENTIONS.md §Logging; `src/bot/handlers/summary.ts:209-216`
**Apply to:** `src/bot/handlers/profile.ts` error path
**Pattern:** `logger.warn({ chatId, error: err instanceof Error ? err.message : String(err) }, 'subsystem.event.variant')`. Message keys are dot-separated. Profile.ts uses `'profile.command.error'`.

### Lang narrowing (`langOf`)

**Source:** `src/bot/handlers/summary.ts:42-47`
**Apply to:** `src/bot/handlers/profile.ts`
**Pattern:** copy verbatim (4 lines). `getLastUserLanguage(chatId)` returns `string | null`; narrow it to a literal union for MSG-map indexing.

### Vitest mock hoisting + dynamic import

**Source:** `src/episodic/__tests__/cron.test.ts:43-89`, `src/chris/__tests__/reflect.test.ts:1-106`
**Apply to:** `src/bot/handlers/__tests__/profile.test.ts`
**Pattern:**
1. `vi.mock('../../path.js', () => ({...}))` calls at top of file (Vitest hoists them).
2. Optional logger mock to silence output.
3. `const { handlerUnderTest } = await import('../module-under-test.js')` AFTER mocks.
4. Per-test `vi.mocked(module.fn).mockResolvedValue(...)` to override behavior.

### No-`parse_mode` Telegram replies

**Source:** `src/bot/handlers/summary.ts:207` (`ctx.reply(formatSummary(row, lang))` — no second arg); D031 codebase policy
**Apply to:** All 5 `ctx.reply` calls in `handleProfileCommand`
**Pattern:** Plain string only. NEVER `ctx.reply(text, { parse_mode: 'Markdown' })`. D-17 + SURF-05 locks this.

### Second-person framing (M010-07 mitigation)

**Source:** `src/rituals/weekly-review-prompt.ts:192-208` `buildRolePreamble` "REQUIRED: address Greg in second person throughout"
**Apply to:** All `MSG.labels` and `formatProfileForDisplay` output in `src/bot/handlers/profile.ts`
**Pattern:** Verbatim phrasings allowed: "You're currently in...", "Your residency status:", "Your FI target:", "You have N children...". Verbatim phrasings FORBIDDEN: "Greg's...", "His...", "He has...". The golden snapshot test is the regression gate — any third-person leak shows up as a snapshot diff.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/bot/handlers/__tests__/profile.golden.test.ts` (for `toMatchInlineSnapshot` idiom specifically) | unit test (snapshot) | transform | Zero usages of `toMatchInlineSnapshot` or `toMatchSnapshot` across the codebase (verified via grep on `src/`, `scripts/`, `tests/`). Plan 35-03 introduces the project's first snapshot test. Test-file *structure* (describe/it/fixture imports) follows `src/chris/__tests__/reflect.test.ts`; *snapshot assertion mechanic* follows vitest docs. Planner should add a TSDoc comment block at the top of the file explaining the `vitest -u` workflow for first-time reviewers. |

## Metadata

**Analog search scope:** `/home/claude/chris/src/` (production); `/home/claude/chris/.planning/codebase/CONVENTIONS.md` for project-wide conventions
**Files scanned:** 11 (summary.ts, summary.test.ts, personality.ts, reflect.ts, coach.ts, journal.ts, photos.ts, resolution.ts, profiles.ts, bot.ts, weekly-review-prompt.ts, lifecycle.ts, ground-truth.ts, reflect.test.ts, cron.test.ts)
**Pattern extraction date:** 2026-05-13
**Confidence:** HIGH — every excerpt above is from a single in-codebase analog at the line numbers cited; no synthesis from research patterns.

---

## PATTERN MAPPING COMPLETE

**Phase:** 35 - Surfaces
**Files classified:** 13 (3 new + 10 modified)
**Analogs found:** 13 / 13

### Coverage
- Files with exact analog: 12
- Files with role-match analog: 1 (`profile.golden.test.ts` structure follows `reflect.test.ts`, but the `toMatchInlineSnapshot` mechanic itself is a project first)
- Files with no analog: 0

### Key Patterns Identified
- **Grammy `Context.reply` spy via `buildCtx` helper** at `summary.test.ts:77-91` — Plan 35-03 task 2 can copy verbatim
- **`vi.mock` + dynamic `await import` + `vi.mocked(...).mockResolvedValue(...)`** at `episodic/__tests__/cron.test.ts:52-99` — Plan 35-03 mocks `getOperationalProfiles` with this idiom
- **`MSG` localization-map pattern** at `summary.ts:51-82` — Plan 35-03's `/profile` MSG map mirrors this shape
- **`Record<...> as const` named-constant export** at `decisions/lifecycle.ts:16-25` — Plan 35-02's `PROFILE_INJECTION_MAP` mirrors this shape
- **Pure-function section-builder skeleton** at `rituals/weekly-review-prompt.ts:144-188` — Plan 35-02's `formatProfilesForPrompt` mirrors the push-sections-join-with-`\n\n` shape
- **No-`toMatchInlineSnapshot` precedent** — Plan 35-03 introduces the first snapshot test; planner should document the `vitest -u` workflow inline

### File Created
`.planning/phases/35-surfaces/35-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. The planner can now reference these concrete analog excerpts (with file paths + line numbers) when authoring `35-01-PLAN.md`, `35-02-PLAN.md`, and `35-03-PLAN.md`.
