---
phase: 14-capture-flow
plan: 04
type: execute
wave: 1
depends_on: [01]
files_modified:
  - src/decisions/capture-state.ts
  - src/decisions/resolve-by.ts
  - src/decisions/vague-validator.ts
  - src/decisions/capture.ts
  - src/decisions/index.ts
autonomous: true
requirements: [CAP-02, CAP-03, CAP-04, CAP-05, LIFE-05]
must_haves:
  truths:
    - "handleCapture(chatId, text, state) drives 5-slot Haiku extraction and commits either open (all slots filled) or open-draft (3-turn cap / second-vague)"
    - "Greedy one-shot Haiku extractor fills multiple slots per reply (CAP-02 C1 mitigation)"
    - "3-turn follow-up cap auto-commits open-draft silently with placeholder NOT-NULL strings"
    - "EN/FR/RU abort phrases dismiss capture cleanly from inside PP#0"
    - "Vague validator fires exactly once (AFTER both PREDICTION + FALSIFICATION filled); second-vague lands open-draft"
    - "resolve_by parses via Haiku; on fail surfaces explicit clarifier; after clarifier fail, silent +30d announced loudly"
    - "language_at_capture is locked to triggering-message language and never updated mid-capture"
    - "LIFE-05 contradiction scan fires exactly once on null→open (never on null→open-draft; never re-fires on open-draft→open promotion)"
    - "Every decisions write goes through transitionDecision() chokepoint (LIFE-03 invariant preserved)"
  artifacts:
    - path: "src/decisions/capture-state.ts"
      provides: "Extended with createCaptureDraft, updateCaptureDraft, clearCapture + isAbortPhrase helper"
      exports: ["getActiveDecisionCapture", "createCaptureDraft", "updateCaptureDraft", "clearCapture", "isAbortPhrase", "CaptureDraft"]
    - path: "src/decisions/resolve-by.ts"
      provides: "Haiku NL timeframe parser + clarifier ladder + announced +30d default"
      exports: ["parseResolveBy", "CLARIFIER_LADDER_DAYS"]
    - path: "src/decisions/vague-validator.ts"
      provides: "Hedge-word-primed Haiku judgment on (prediction, falsification_criterion)"
      exports: ["validateVagueness", "VaguenessVerdict"]
    - path: "src/decisions/capture.ts"
      provides: "handleCapture entry + extractor + commit path + 3-turn cap + abort + LIFE-05 fire-and-forget"
      exports: ["handleCapture", "openCapture"]
  key_links:
    - from: "src/decisions/capture.ts"
      to: "src/decisions/lifecycle.ts::transitionDecision"
      via: "direct call on commit (null→open or null→open-draft)"
      pattern: "transitionDecision\\("
    - from: "src/decisions/capture.ts"
      to: "src/chris/contradiction.ts::detectContradictions"
      via: "void fire-and-forget on null→open only (D-20)"
      pattern: "detectContradictions\\("
    - from: "src/decisions/capture.ts"
      to: "src/llm/prompts.ts::CAPTURE_EXTRACTION_PROMPT"
      via: "Haiku system prompt"
      pattern: "CAPTURE_EXTRACTION_PROMPT"
---

<objective>
Implement the conversational capture layer: Haiku greedy extractor, 3-turn cap, abort handling, `resolve_by` parser with clarifier ladder, vague validator with one-round pushback, and LIFE-05 fire-and-forget contradiction scan on null→open commit.

Purpose: Anti-interrogation discipline (C1) + falsifiability discipline (C2) + partial-commit discipline (CAP-04 `open-draft`) in one coherent handler. All four Haiku calls follow the `detectMode()` fail-soft shape. Every mutation goes through `transitionDecision()`.
Output: `capture.ts` with `handleCapture(chatId, text, state)`; `resolve-by.ts`; `vague-validator.ts`; extended `capture-state.ts` with write helpers + abort-phrase helper. Turns `capture.test.ts`, `resolve-by.test.ts`, and `vague-validator.test.ts` GREEN.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/14-capture-flow/14-CONTEXT.md
@.planning/phases/14-capture-flow/14-RESEARCH.md
@.planning/phases/13-schema-lifecycle-primitives/13-CONTEXT.md
@src/decisions/capture-state.ts
@src/decisions/lifecycle.ts
@src/decisions/errors.ts
@src/chris/contradiction.ts
@src/chris/engine.ts
@src/chris/language.ts
@src/db/schema.ts
@src/llm/prompts.ts
@src/llm/client.ts
@src/decisions/triggers-fixtures.ts
@src/decisions/__tests__/capture.test.ts
@src/decisions/__tests__/resolve-by.test.ts
@src/decisions/__tests__/vague-validator.test.ts

<interfaces>
From src/decisions/lifecycle.ts (Phase 13 chokepoint — MUST be the only path):
```typescript
export async function transitionDecision(
  id: string | null,
  toStatus: DecisionStatus,
  payload: Partial<DecisionFields>,
  fromStatus?: DecisionStatus | null,
): Promise<void>; // throws InvalidTransitionError | OptimisticConcurrencyError
// Legal transitions include: null → 'open-draft', null → 'open', 'open-draft' → 'open'.
// Read exact signature from the file.
```

From src/chris/contradiction.ts (existing — invoke verbatim):
```typescript
export async function detectContradictions(text: string, entryId?: string): Promise<Contradiction[]>;
// Internal 0.75 threshold + 3s timeout already hardcoded.
```

From src/chris/language.ts:
```typescript
export function detectLanguage(text: string, prev: Lang | null): Lang; // returns 'en'|'fr'|'ru' (or 'en' on und)
```

From src/decisions/triggers-fixtures.ts (Plan 01):
```typescript
export const ABORT_PHRASES_EN: string[];
export const ABORT_PHRASES_FR: string[];
export const ABORT_PHRASES_RU: string[];
```

From src/llm/prompts.ts (Plan 01):
```typescript
export const CAPTURE_EXTRACTION_PROMPT: string;
export const VAGUE_VALIDATOR_PROMPT: string;
export const RESOLVE_BY_PARSER_PROMPT: string;
```

CaptureDraft shape (to declare in capture-state.ts):
```typescript
export interface CaptureDraft {
  decision_text?: string;
  alternatives?: string[];
  reasoning?: string;
  prediction?: string;
  falsification_criterion?: string;
  resolve_by?: string;               // ISO string once parsed; natural-lang string before
  resolve_by_clarifier_asked?: boolean;
  language_at_capture: 'en' | 'fr' | 'ru';
  turn_count: number;
  vague_validator_run?: boolean;
  domain_tag?: string;
  triggering_message: string;        // verbatim triggering text, for 3-turn-cap decision_text fallback
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend capture-state.ts with write helpers + abort-phrase detector</name>
  <files>src/decisions/capture-state.ts, src/decisions/index.ts</files>
  <read_first>
    - src/decisions/capture-state.ts (existing `getActiveDecisionCapture` — preserve signature and file structure)
    - src/db/schema.ts (decisionCaptureState shape — chatId bigint PK, stage enum, draft jsonb, decisionId, timestamps)
    - src/decisions/triggers-fixtures.ts (ABORT_PHRASES_EN/FR/RU arrays)
    - src/decisions/__tests__/capture-state.test.ts (Phase 13 tests — MUST still pass after edits)
    - src/decisions/__tests__/capture.test.ts (consumes createCaptureDraft / clearCapture / isAbortPhrase)
  </read_first>
  <action>
    Extend `src/decisions/capture-state.ts` (do NOT remove anything existing):

    Add the `CaptureDraft` interface from the `<interfaces>` block above (export).

    Add helpers:
    ```typescript
    export async function createCaptureDraft(chatId: bigint, initial: CaptureDraft): Promise<void> {
      await db.insert(decisionCaptureState).values({
        chatId,
        stage: 'DECISION',
        draft: initial,
        decisionId: null,
      });
    }

    export async function updateCaptureDraft(
      chatId: bigint,
      patch: Partial<CaptureDraft>,
      nextStage?: DecisionCaptureStage,
    ): Promise<void> {
      const current = await getActiveDecisionCapture(chatId);
      if (!current) throw new Error('capture-state.updateCaptureDraft: no active capture for chatId');
      const merged = { ...(current.draft as CaptureDraft), ...patch };
      await db.update(decisionCaptureState)
        .set({
          draft: merged,
          stage: nextStage ?? current.stage,
          updatedAt: new Date(),
        })
        .where(eq(decisionCaptureState.chatId, chatId));
    }

    export async function clearCapture(chatId: bigint): Promise<void> {
      await db.delete(decisionCaptureState).where(eq(decisionCaptureState.chatId, chatId));
    }
    ```

    Add `isAbortPhrase(text, language)` helper (NOT async — pure string match):
    ```typescript
    import {
      ABORT_PHRASES_EN,
      ABORT_PHRASES_FR,
      ABORT_PHRASES_RU,
    } from './triggers-fixtures.js';

    export function isAbortPhrase(text: string, language: 'en' | 'fr' | 'ru'): boolean {
      const normalized = text.trim().toLowerCase();
      const phrases =
        language === 'en' ? ABORT_PHRASES_EN :
        language === 'fr' ? ABORT_PHRASES_FR :
        ABORT_PHRASES_RU;
      // word-or-prefix match against the trimmed message (per D-04)
      for (const p of phrases) {
        if (normalized === p) return true;
        if (normalized.startsWith(p + ' ')) return true;
        // whole-word boundary inside message (for short messages that embed the abort phrase)
        const re = new RegExp(`(^|\\s)${p.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(\\s|$)`, 'i');
        if (re.test(normalized)) return true;
      }
      return false;
    }
    ```

    Export `{CaptureDraft, createCaptureDraft, updateCaptureDraft, clearCapture, isAbortPhrase}` from `src/decisions/index.ts`.

    Do NOT call `franc` here — that stays in the PP#1 / openCapture path (Plan 05 + this plan's Task 4).
  </action>
  <verify>
    <automated>DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/capture-state.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^export (async function (createCaptureDraft|updateCaptureDraft|clearCapture)|function isAbortPhrase|interface CaptureDraft)" src/decisions/capture-state.ts` returns ≥4.
    - `grep -c "getActiveDecisionCapture" src/decisions/capture-state.ts` returns ≥1 (Phase 13 export still present).
    - `grep -c "ABORT_PHRASES_EN\|ABORT_PHRASES_FR\|ABORT_PHRASES_RU" src/decisions/capture-state.ts` returns ≥3.
    - All Phase 13 `capture-state.test.ts` cases still GREEN.
  </acceptance_criteria>
  <done>capture-state.ts extended; Phase 13 tests still pass; abort detector covers full D-04 phrase set.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement resolve-by.ts (Haiku NL parser + clarifier ladder + announced +30d default)</name>
  <files>src/decisions/resolve-by.ts, src/decisions/index.ts</files>
  <read_first>
    - src/chris/engine.ts::detectMode (fail-soft Haiku shape)
    - src/proactive/mute.ts::parseMuteDuration (closest analog for `+Nd` math)
    - src/decisions/__tests__/resolve-by.test.ts (test-driven API surface)
    - .planning/phases/14-capture-flow/14-CONTEXT.md §"resolve_by natural-language parsing" (D-18, D-19 full text)
    - src/llm/prompts.ts (confirm RESOLVE_BY_PARSER_PROMPT exists)
  </read_first>
  <behavior>
    - `parseResolveBy(naturalText: string): Promise<Date | null>` — calls Haiku with 2s timeout; returns Date or null (null signals caller to surface clarifier).
    - `CLARIFIER_LADDER_DAYS = { week: 7, month: 30, threeMonths: 90, year: 365 } as const` — exported.
    - Clarifier mapping helper `matchClarifierReply(text, language): keyof CLARIFIER_LADDER_DAYS | null` — regex-matches "a week"/"a month"/"three months"/"a year" in EN/FR/RU.
    - `buildResolveByClarifierQuestion(language): string` — EN/FR/RU localized menu.
    - `buildResolveByDefaultAnnouncement(language): string` — EN: "I'll check back in a month — you can change this later.", FR equivalent, RU equivalent.
  </behavior>
  <action>
    Create `src/decisions/resolve-by.ts`:

    ```typescript
    import { anthropic, HAIKU_MODEL } from '../llm/client.js';
    import { RESOLVE_BY_PARSER_PROMPT } from '../llm/prompts.js';
    import { logger } from '../observability/logger.js'; // mirror project logger import

    const RESOLVE_BY_TIMEOUT_MS = 2000;  // D-18

    export const CLARIFIER_LADDER_DAYS = {
      week: 7,
      month: 30,
      threeMonths: 90,
      year: 365,
    } as const;
    export type ClarifierChoice = keyof typeof CLARIFIER_LADDER_DAYS;

    export async function parseResolveBy(naturalText: string): Promise<Date | null> {
      const start = Date.now();
      try {
        const response = await Promise.race([
          anthropic.messages.create({
            model: HAIKU_MODEL,
            max_tokens: 50,
            system: [{ type: 'text', text: RESOLVE_BY_PARSER_PROMPT, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: naturalText }],
          }),
          new Promise<null>((r) => setTimeout(() => r(null), RESOLVE_BY_TIMEOUT_MS)),
        ]);
        if (!response) { logger.warn({ latencyMs: Date.now() - start }, 'decisions.resolve_by.timeout'); return null; }
        const block = response.content.find((b) => b.type === 'text');
        if (!block || block.type !== 'text') return null;
        const parsed = JSON.parse(stripFences((block as {text:string}).text));
        if (!parsed.iso || typeof parsed.iso !== 'string') return null;
        const d = new Date(parsed.iso);
        if (Number.isNaN(d.getTime())) return null;
        return d;
      } catch (error) {
        logger.warn({ error: errMsg(error), latencyMs: Date.now() - start }, 'decisions.resolve_by.error');
        return null;
      }
    }

    export function daysFromNow(days: number): Date {
      return new Date(Date.now() + days * 86_400_000);
    }

    export function matchClarifierReply(text: string, language: 'en'|'fr'|'ru'): ClarifierChoice | null {
      const t = text.trim().toLowerCase();
      // EN
      if (/\b(a |one |1 )?week\b/i.test(t)) return 'week';
      if (/\b(a |one |1 )?month\b/i.test(t) && !/three/i.test(t) && !/3 /.test(t)) return 'month';
      if (/\b(three|3) ?months?\b/i.test(t)) return 'threeMonths';
      if (/\b(a |one |1 )?year\b/i.test(t)) return 'year';
      // FR
      if (/\bsemaine\b/i.test(t)) return 'week';
      if (/\bmois\b/i.test(t) && !/trois/i.test(t) && !/3 /.test(t)) return 'month';
      if (/\btrois ?mois\b|\b3 ?mois\b/i.test(t)) return 'threeMonths';
      if (/\ban(née)?s?\b/i.test(t)) return 'year';
      // RU
      if (/\bнеделю?\b/i.test(t)) return 'week';
      if (/\bмесяц\b/i.test(t) && !/три/i.test(t) && !/3 /.test(t)) return 'month';
      if (/\bтри ?месяца\b|\b3 ?месяца\b/i.test(t)) return 'threeMonths';
      if (/\bгод\b|\bгода\b/i.test(t)) return 'year';
      return null;
    }

    export function buildResolveByClarifierQuestion(language: 'en'|'fr'|'ru'): string {
      switch (language) {
        case 'en': return 'When should I check back — a week, a month, three months, or a year?';
        case 'fr': return 'Quand veux-tu qu\'on revienne dessus — une semaine, un mois, trois mois, ou un an ?';
        case 'ru': return 'Когда мне вернуться к этому — неделю, месяц, три месяца или год?';
      }
    }

    export function buildResolveByDefaultAnnouncement(language: 'en'|'fr'|'ru'): string {
      switch (language) {
        case 'en': return "I'll check back in a month — you can change this later.";
        case 'fr': return 'Je reviens là-dessus dans un mois — tu pourras changer ça plus tard.';
        case 'ru': return 'Я вернусь к этому через месяц — можешь изменить позже.';
      }
    }

    function stripFences(s: string): string {
      return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    }
    function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
    ```

    Export from `src/decisions/index.ts`.
  </action>
  <verify>
    <automated>DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/resolve-by.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^export (async function parseResolveBy|function (matchClarifierReply|buildResolveByClarifierQuestion|buildResolveByDefaultAnnouncement|daysFromNow)|const CLARIFIER_LADDER_DAYS)" src/decisions/resolve-by.ts` returns ≥5.
    - `grep -c "RESOLVE_BY_TIMEOUT_MS.*2000" src/decisions/resolve-by.ts` returns 1 (D-18 2s cap).
    - `grep -c "week: 7\|month: 30\|threeMonths: 90\|year: 365" src/decisions/resolve-by.ts` returns ≥4 (exact ladder).
    - `grep -c "check back in a month\|un mois\|через месяц" src/decisions/resolve-by.ts` returns ≥3 (all three languages announced).
    - `npx vitest run src/decisions/__tests__/resolve-by.test.ts` exits 0 (all cases GREEN).
  </acceptance_criteria>
  <done>resolve-by.test.ts GREEN; Haiku fail-soft to null; clarifier menu localized EN/FR/RU; +30d default announced loudly not silent.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Implement vague-validator.ts (hedge-word-primed Haiku judgment)</name>
  <files>src/decisions/vague-validator.ts, src/decisions/index.ts</files>
  <read_first>
    - src/chris/engine.ts::detectMode (fail-soft shape)
    - src/decisions/__tests__/vague-validator.test.ts (exact API + mock shape)
    - .planning/phases/14-capture-flow/14-CONTEXT.md §"Vague-prediction validator" (D-13, D-14, D-15 full text)
  </read_first>
  <behavior>
    - `validateVagueness({prediction, falsification_criterion, language}): Promise<VaguenessVerdict>`.
    - `VaguenessVerdict = 'acceptable' | 'vague'`.
    - Fail-soft default: `'acceptable'` (per RESEARCH §"Pattern 1 Phase 14 mappings" — don't pushback on error; protects anti-interrogation ethos).
    - 3s hard timeout (match stakes classifier convention).
    - Hedge word prior LIST (exported `HEDGE_WORDS`): `probably, fine, better, somehow, likely, maybe, peut-être, sans doute, probablement, наверное, возможно, скорее всего` — surfaced in the Haiku user-content prefix ("hedge_words_present: <list>") to SEED Haiku judgment per D-13.
    - Pushback question builder `buildVaguePushback(language): string` — EN: "What would make you say this turned out right or wrong?", FR/RU equivalents.
  </behavior>
  <action>
    Create `src/decisions/vague-validator.ts`:

    ```typescript
    import { anthropic, HAIKU_MODEL } from '../llm/client.js';
    import { VAGUE_VALIDATOR_PROMPT } from '../llm/prompts.js';
    import { logger } from '../observability/logger.js';

    const VAGUE_TIMEOUT_MS = 3000;
    export type VaguenessVerdict = 'acceptable' | 'vague';

    export const HEDGE_WORDS = [
      'probably', 'fine', 'better', 'somehow', 'likely', 'maybe',
      'peut-être', 'peut etre', 'sans doute', 'probablement',
      'наверное', 'возможно', 'скорее всего',
    ] as const;

    export interface VaguenessInput {
      prediction: string;
      falsification_criterion: string;
      language: 'en' | 'fr' | 'ru';
    }

    export async function validateVagueness(input: VaguenessInput): Promise<VaguenessVerdict> {
      const start = Date.now();
      const combined = `${input.prediction}\n${input.falsification_criterion}`.toLowerCase();
      const detectedHedges = HEDGE_WORDS.filter((w) => combined.includes(w));
      const userContent = JSON.stringify({
        prediction: input.prediction,
        falsification_criterion: input.falsification_criterion,
        language: input.language,
        hedge_words_present: detectedHedges,
      });
      try {
        const response = await Promise.race([
          anthropic.messages.create({
            model: HAIKU_MODEL,
            max_tokens: 60,
            system: [{ type: 'text', text: VAGUE_VALIDATOR_PROMPT, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: userContent }],
          }),
          new Promise<null>((r) => setTimeout(() => r(null), VAGUE_TIMEOUT_MS)),
        ]);
        if (!response) return 'acceptable';  // fail-soft default
        const block = response.content.find((b) => b.type === 'text');
        if (!block || block.type !== 'text') return 'acceptable';
        const parsed = JSON.parse(stripFences((block as {text:string}).text));
        const verdict: VaguenessVerdict = parsed.verdict === 'vague' ? 'vague' : 'acceptable';
        logger.info({ verdict, hedges: detectedHedges.length, latencyMs: Date.now() - start }, 'decisions.vague.validate');
        return verdict;
      } catch (error) {
        logger.warn({ error: errMsg(error), latencyMs: Date.now() - start }, 'decisions.vague.error');
        return 'acceptable';  // fail-soft
      }
    }

    export function buildVaguePushback(language: 'en'|'fr'|'ru'): string {
      switch (language) {
        case 'en': return 'What would make you say this turned out right or wrong?';
        case 'fr': return 'Qu\'est-ce qui te ferait dire que ça s\'est bien ou mal passé ?';
        case 'ru': return 'Что заставит тебя сказать, что это получилось или не получилось?';
      }
    }

    function stripFences(s: string): string {
      return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    }
    function errMsg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
    ```

    Export from `src/decisions/index.ts`.

    Key discipline (enforced by consumers in capture.ts Task 4, not here): validator runs ONCE per capture, gated by `draft.vague_validator_run` flag. This module is stateless — the gating lives at the call-site.
  </action>
  <verify>
    <automated>DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/vague-validator.test.ts -t "validateVagueness\|hedge"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^export (async function validateVagueness|function buildVaguePushback|const HEDGE_WORDS|type VaguenessVerdict)" src/decisions/vague-validator.ts` returns ≥4.
    - `grep -c "VAGUE_TIMEOUT_MS.*3000" src/decisions/vague-validator.ts` returns 1.
    - `grep -c "return 'acceptable'" src/decisions/vague-validator.ts` returns ≥2 (timeout + exception fail-soft).
    - `grep -c "наверное\|возможно\|peut-être\|sans doute\|probably" src/decisions/vague-validator.ts` returns ≥4 (hedge word coverage across languages).
    - Relevant assertions in `vague-validator.test.ts` about API/default pass.
  </acceptance_criteria>
  <done>validator returns verdict; fail-soft to `acceptable`; hedge words seeded into Haiku input; localized pushback question exported. Full vague-validator.test.ts pass comes after Task 4 lands the state-gating.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Implement capture.ts (handleCapture + openCapture + Haiku extractor + 3-turn cap + LIFE-05)</name>
  <files>src/decisions/capture.ts, src/decisions/index.ts</files>
  <read_first>
    - src/decisions/capture-state.ts (after Task 1 — helpers to consume)
    - src/decisions/lifecycle.ts (exact transitionDecision signature + DecisionStatus enum)
    - src/decisions/errors.ts (InvalidTransitionError, OptimisticConcurrencyError)
    - src/chris/contradiction.ts (detectContradictions signature — understand entryId semantics)
    - src/chris/engine.ts lines 60–120 + 230–290 (Haiku fail-soft + fire-and-forget void pattern + Pensieve write convention)
    - src/chris/language.ts::detectLanguage
    - src/db/schema.ts (decisions + decision_capture_state + pensieve_entries column shapes)
    - src/decisions/__tests__/capture.test.ts (drives full API surface)
    - .planning/phases/14-capture-flow/14-CONTEXT.md (D-09, D-10, D-11, D-12, D-14, D-15, D-20, D-21, D-22, D-23 — ALL load-bearing)
    - .planning/phases/14-capture-flow/14-RESEARCH.md §"Pitfall 5" (NOT NULL + placeholder resolution per A4) and §"Pitfall 1" (LIFE-05 gating on first null→open only)
  </read_first>
  <behavior>
    Two exports:
    1. `openCapture(chatId: bigint, triggeringMessage: string, language: 'en'|'fr'|'ru'): Promise<string>` — called from Plan 05's PP#1. Creates `decision_capture_state` row with `stage='DECISION'`, `draft={language_at_capture: language, turn_count: 0, triggering_message: triggeringMessage}`. Returns the localized Q1 prompt (DECISION stage question).
    2. `handleCapture(chatId: bigint, text: string, state: ActiveDecisionCapture): Promise<string>` — processes one capture turn. Returns Chris's reply.

    handleCapture flow:
    - Read `draft = state.draft as CaptureDraft`; `lang = draft.language_at_capture` (NEVER re-detect — D-22 locked).
    - Increment `turn_count`.
    - Single Haiku greedy extraction: input = `{current_draft, user_reply: text, canonical_slots}`, output = patch of newly-filled slots. Apply patch to draft. (Fail-soft: if Haiku errors, patch = {} and turn proceeds.)
    - Decide next action in this priority:
      a. **resolve_by parsing** — if `draft.resolve_by` is a natural-language string not yet an ISO Date: call `parseResolveBy(draft.resolve_by)`. If returns Date → store ISO string, continue. If returns null and `!draft.resolve_by_clarifier_asked` → set flag, ask `buildResolveByClarifierQuestion(lang)`, save, return. If returns null and `draft.resolve_by_clarifier_asked === true` → try `matchClarifierReply(text, lang)` → if maps → set `resolve_by = daysFromNow(CLARIFIER_LADDER_DAYS[choice]).toISOString()`, continue. Else (unparseable after clarifier) → set `resolve_by = daysFromNow(30).toISOString()`, append `buildResolveByDefaultAnnouncement(lang)` to subsequent reply.
      b. **Vague validator gate** — if `draft.prediction && draft.falsification_criterion && !draft.vague_validator_run`:
         - Call `validateVagueness({prediction, falsification_criterion, language: lang})`.
         - Set `draft.vague_validator_run = true`.
         - If verdict = 'vague' AND this is the FIRST vague (not second): save draft, return `buildVaguePushback(lang)`. On NEXT turn, `vague_validator_run=true` already so we skip re-running; we just accept whatever falsification_criterion user gave. Second-vague landing happens at commit time: commit with `status='open-draft'` per D-15.
      c. **3-turn cap** — if `turn_count >= 3` AND still unfilled required slots → jump to commit-open-draft with placeholders (see commit logic below).
      d. **All required slots filled** (decision_text, reasoning, prediction, falsification_criterion, resolve_by ISO) → commit-open.
      e. **Normal question** — ask next-canonical-unfilled-slot question via `questionForStage(nextStage, lang)`; save draft with advanced stage; return question.

    Commit logic (two paths, BOTH go through transitionDecision):
    - **commit-open**: generate `id = crypto.randomUUID()` (or let `transitionDecision` handle it — match lifecycle.ts signature). Call `transitionDecision(id, 'open', payload, null)` where payload has all filled slots + `language_at_capture` + `domain_tag` (from extractor) + `resolve_by` + `falsification_criterion` + `prediction` + `reasoning` + `decision_text`. Write Pensieve entry via `writePensieveEntry(...)` tagged `DECISION` (see src/chris/engine.ts for the helper — or inline the shape: `INSERT INTO pensieve_entries ... epistemic_tag='DECISION', source_ref_id=<decision_id>`). THEN fire-and-forget contradiction scan (D-20/D-21):
       ```typescript
       void (async () => {
         try {
           await Promise.race([
             detectContradictions(payload.reasoning!, pensieveEntryId),
             new Promise<never[]>((r) => setTimeout(() => r([]), 3000)),
           ]);
           // detected contradictions surface via next normal Chris turn via the existing
           // formatContradictionNotice path — do NOT inject into the capture reply (D-21).
         } catch (e) { logger.warn({ error: errMsg(e) }, 'capture.contradiction.error'); }
       })();
       ```
       Gate: this fire-and-forget ONLY runs when the commit path is `null → open` directly (i.e., `fromStatus === null && toStatus === 'open'`). NEVER on `null → open-draft` and NEVER on `open-draft → open` promotion (per D-20).

       Clear capture state, return localized confirmation reply (e.g. EN: "Got it — I've archived that. I'll check back {resolve_by_pretty}.").

    - **commit-open-draft** (3-turn cap OR second-vague): Fill NOT NULL slots with placeholders (per RESEARCH A4):
       - `decision_text` → `draft.decision_text ?? draft.triggering_message.slice(0, 500)` (never empty; use triggering message as fallback).
       - `reasoning` → `draft.reasoning ?? '(not specified in capture)'`.
       - `prediction` → `draft.prediction ?? '(not specified in capture)'`.
       - `falsification_criterion` → `draft.falsification_criterion ?? '(not specified in capture)'`.
       - `resolve_by` → `draft.resolve_by ?? daysFromNow(30).toISOString()`.
       Call `transitionDecision(id, 'open-draft', payload, null)`. Write Pensieve entry tagged `DECISION` with `source_ref_id=decision_id`. DO NOT fire LIFE-05 contradiction scan (D-20 gates on `status='open'` ONLY). Clear capture state. Return localized silent-commit acknowledgment (brief — "I've saved what we have so far." EN / FR / RU).

    `questionForStage(stage, lang)` — internal helper returning localized question strings for `DECISION | ALTERNATIVES | REASONING | PREDICTION | FALSIFICATION`. Use these EN strings (executor may polish FR/RU):
    - DECISION: "What are you thinking about deciding?"
    - ALTERNATIVES: "What are the alternatives you're considering?"
    - REASONING: "What's pushing you toward one over the others?"
    - PREDICTION: "What do you think will happen if you go with that?"
    - FALSIFICATION: "What would make you say you were wrong?"

    Stage-ordering helper `nextUnfilledStage(draft): DecisionCaptureStage` — iterate canonical order DECISION → ALTERNATIVES → REASONING → PREDICTION → FALSIFICATION, return first one where the corresponding draft slot is still empty. If all filled, return `DONE` (triggers commit-open).

    Abort-phrase handling is NOT in this module — it lives in PP#0 (Plan 05). This module assumes caller has already filtered aborts.

    Security discipline:
    - User `text` goes ONLY into extractor `messages[].content`, NEVER into system prompt (T-14-04-02).
    - Logs never include draft content or user text — only `{chatId, turn_count, stage, slotsFilled count, latencyMs, verdict}` etc. (T-14-04-03).
  </behavior>
  <action>
    Create `src/decisions/capture.ts` implementing the `<behavior>` block above precisely. Use the helpers from Tasks 1–3 and Plan 01's prompt constants.

    Helper: `writePensieveEntry(chatId, text, sourceRefId)` — if an existing helper lives in engine.ts / pensieve.ts, import it. If not, inline a `db.insert(pensieveEntries).values({chatId, rawText: text, epistemicTag: 'DECISION', sourceRefId})` matching the existing pensieve_entries schema (read `src/db/schema.ts` for column names).

    Commit path MUST call `transitionDecision` for both open and open-draft (LIFE-03 invariant — verified by `src/decisions/__tests__/chokepoint-audit.test.ts` which scans for direct mutations of `decisions.status`).

    Export `{handleCapture, openCapture}` from `src/decisions/index.ts`.
  </action>
  <verify>
    <automated>DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/capture.test.ts src/decisions/__tests__/vague-validator.test.ts src/decisions/__tests__/resolve-by.test.ts src/decisions/__tests__/chokepoint-audit.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "^export (async function (handleCapture|openCapture))" src/decisions/capture.ts` returns 2.
    - `grep -c "transitionDecision(" src/decisions/capture.ts` returns ≥2 (both commit paths go through chokepoint).
    - `grep -c "status.*'open-draft'\|'open-draft'" src/decisions/capture.ts` returns ≥2 (3-turn-cap path + second-vague path).
    - `grep -c "void (async" src/decisions/capture.ts` returns ≥1 (fire-and-forget LIFE-05).
    - `grep -c "detectContradictions(" src/decisions/capture.ts` returns ≥1.
    - `grep -c "(not specified in capture)" src/decisions/capture.ts` returns ≥3 (reasoning/prediction/falsification placeholder strings — RESEARCH A4).
    - `grep -c "language_at_capture" src/decisions/capture.ts` returns ≥2 (read from draft, written to decisions row).
    - `grep -cE "turn_count\s*>=\s*3|turn_count >= 3" src/decisions/capture.ts` returns ≥1 (3-turn cap).
    - `grep -c "vague_validator_run" src/decisions/capture.ts` returns ≥2 (gate flag set + checked — Pitfall 6).
    - `grep -c "epistemicTag.*DECISION\|'DECISION'" src/decisions/capture.ts` returns ≥1 (Pensieve entry tagged).
    - No direct mutation of `decisions.status` outside `transitionDecision`: `grep -E "db\.(update|insert).*decisions\b" src/decisions/capture.ts | grep -v decision_capture_state | grep -v decision_events | grep -v decision_trigger_suppressions` returns nothing (only chokepoint-mediated writes).
    - `chokepoint-audit.test.ts` still GREEN.
    - `capture.test.ts`, `vague-validator.test.ts`, `resolve-by.test.ts` ALL GREEN.
  </acceptance_criteria>
  <done>CAP-02, CAP-03, CAP-04, CAP-05, LIFE-05 all satisfied: greedy extractor, 3-turn cap with placeholder, abort-aware state transitions through capture-state helpers, vague validator one-round gate, resolve-by clarifier + +30d announced default, fire-and-forget contradiction scan on null→open only. All four test files (capture, vague-validator, resolve-by, chokepoint-audit) GREEN.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User `text` → Haiku extractor | User-controlled text must stay in `messages[].content`, never interpolated into system prompt |
| User `text` → `decisions.reasoning` / `prediction` / `falsification_criterion` | Raw user text is persisted verbatim (the whole point of the archive) — no sanitization, but Drizzle parameterization prevents SQL injection |
| Draft jsonb → logs | Never log raw draft content — only {chatId, turn_count, stage, slotsFilled count} |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-04-01 | Tampering | transitionDecision bypass | mitigate | Chokepoint-audit CI test scans `src/decisions/**` for direct mutations of `decisions.status`; commit paths in `capture.ts` go through `transitionDecision` only (grep acceptance criterion) |
| T-14-04-02 | Tampering | Prompt injection via user text | mitigate | User text passes to extractor/validator/parser only via `messages[0].content`; all four system prompts are static exports from `src/llm/prompts.ts` |
| T-14-04-03 | Information Disclosure | Log leakage of decision content | mitigate | Logger statements log only structural fields (chatId, turn_count, stage, slotsFilled, latencyMs, verdict); acceptance criterion rejects `text` / `draft` in log payloads |
| T-14-04-04 | DoS | Capture loop trigger→abort→trigger thrash | accept | D-25 ensures abort clears state cleanly; even adversarial loops just rate-limited by Haiku turnaround; low severity per user-single-chat model |
| T-14-04-05 | DoS (capture row leak) | 3-turn cap + capture-state GC | mitigate | 3-turn cap ALWAYS terminates capture state (commit or abort path); Phase 13 24h GC handles any residual rows; placeholder strings prevent NOT NULL insertion failures |
| T-14-04-06 | Integrity | LIFE-05 double-fire on promotion | mitigate | Fire-and-forget gated on `fromStatus === null && toStatus === 'open'` (Pitfall 1); never on open-draft → open promotion |
| T-14-04-07 | Integrity | Vague validator double-fire | mitigate | `draft.vague_validator_run` flag gate (Pitfall 6); test asserts single spy call over two post-FALSIFICATION turns |
</threat_model>

<verification>
- `npx vitest run src/decisions/__tests__/capture.test.ts src/decisions/__tests__/vague-validator.test.ts src/decisions/__tests__/resolve-by.test.ts src/decisions/__tests__/chokepoint-audit.test.ts src/decisions/__tests__/capture-state.test.ts` exits 0.
- All Phase 13 regression tests still GREEN (`npx vitest run src/decisions/__tests__/`).
</verification>

<success_criteria>
Conversational capture engine complete: CAP-02 (greedy multi-slot Haiku extraction), CAP-03 (3-turn cap + abort routing through capture-state), CAP-04 (open-draft commit with placeholders), CAP-05 (Haiku NL resolve-by + clarifier ladder + announced default), LIFE-05 (null→open-only fire-and-forget contradiction scan). Chokepoint-audit still green; all decisions.status mutations go through `transitionDecision()`.
</success_criteria>

<output>
After completion, create `.planning/phases/14-capture-flow/14-04-SUMMARY.md`.
</output>
