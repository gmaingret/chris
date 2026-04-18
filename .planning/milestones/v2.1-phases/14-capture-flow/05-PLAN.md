---
phase: 14-capture-flow
plan: 05
type: execute
wave: 2
depends_on: [02, 03, 04]
files_modified:
  - src/chris/engine.ts
  - src/bot/bot.ts
  - src/bot/handlers/decisions.ts
autonomous: true
requirements: [SWEEP-03, CAP-06]
must_haves:
  truths:
    - "PP#0 (active-capture check) and PP#1 (trigger detection) run at the TOP of engine.ts::processMessage(), BEFORE mute/refusal/language/mode detection"
    - "Active capture short-circuits mute/refusal/language/mode (SWEEP-03 guaranteed)"
    - "Abort phrases evaluated INSIDE PP#0 (D-25) — clears state and falls through"
    - "Suppressed phrases skip Phase A regex entirely (suppression check precedes regex in PP#1)"
    - "Structural stakes → openCapture + return Q1; trivial/moderate → fall through to normal engine"
    - "/decisions suppress <phrase> bot command persists a suppression tied to ctx.chat.id"
    - "Re-trigger mid-capture is ignored; new capture state is not created (D-12)"
  artifacts:
    - path: "src/chris/engine.ts"
      provides: "PP#0 + PP#1 block inserted at top of processMessage() try-block, BEFORE line of detectMuteIntent"
      contains: "getActiveDecisionCapture"
    - path: "src/bot/handlers/decisions.ts"
      provides: "/decisions handler — sub-command dispatcher, suppress wired; unknown sub-commands return localized help"
      exports: ["handleDecisionsCommand"]
    - path: "src/bot/bot.ts"
      provides: "bot.command('decisions', handleDecisionsCommand) registered BEFORE bot.on('message:text')"
      contains: "bot.command('decisions'"
  key_links:
    - from: "src/chris/engine.ts"
      to: "src/decisions/capture.ts"
      via: "openCapture + handleCapture imports"
      pattern: "openCapture|handleCapture"
    - from: "src/chris/engine.ts"
      to: "src/decisions/triggers.ts"
      via: "detectTriggerPhrase + classifyStakes"
      pattern: "detectTriggerPhrase|classifyStakes"
    - from: "src/chris/engine.ts"
      to: "src/decisions/suppressions.ts"
      via: "isSuppressed precedes regex in PP#1"
      pattern: "isSuppressed"
    - from: "src/bot/handlers/decisions.ts"
      to: "src/decisions/suppressions.ts"
      via: "addSuppression called for suppress sub-command"
      pattern: "addSuppression"
---

<objective>
Wire the capture pipeline into `src/chris/engine.ts::processMessage()` as pre-processors #0 (active-capture check) and #1 (trigger detection), both BEFORE existing mute/refusal/language/mode detection. Register the `/decisions suppress <phrase>` bot command.

Purpose: SWEEP-03 requires the capture pre-processor to PRECEDE all other routing — a mid-capture user message saying "not now" must route to capture-abort, NOT to mute detection. This plan delivers that structural guarantee + closes the user-facing surface for CAP-06.
Output: `processMessage()` extended; `bot.command('decisions', ...)` registered; new `src/bot/handlers/decisions.ts`. Turns `engine-capture.test.ts` GREEN and closes the full Phase 14 requirement set.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/14-capture-flow/14-CONTEXT.md
@.planning/phases/14-capture-flow/14-RESEARCH.md
@src/chris/engine.ts
@src/bot/bot.ts
@src/bot/handlers/sync.ts
@src/chris/language.ts
@src/decisions/capture.ts
@src/decisions/capture-state.ts
@src/decisions/triggers.ts
@src/decisions/suppressions.ts
@src/decisions/__tests__/engine-capture.test.ts

<interfaces>
From src/decisions/capture.ts (Plan 04):
```typescript
export async function openCapture(chatId: bigint, triggeringMessage: string, language: 'en'|'fr'|'ru'): Promise<string>;
export async function handleCapture(chatId: bigint, text: string, state: ActiveDecisionCapture): Promise<string>;
```

From src/decisions/capture-state.ts (extended in Plan 04):
```typescript
export async function getActiveDecisionCapture(chatId: bigint): Promise<ActiveDecisionCapture | null>;
export async function clearCapture(chatId: bigint): Promise<void>;
export function isAbortPhrase(text: string, language: 'en'|'fr'|'ru'): boolean;
export interface CaptureDraft { language_at_capture: 'en'|'fr'|'ru'; turn_count: number; /*…*/ }
```

From src/decisions/triggers.ts (Plan 02):
```typescript
export async function classifyStakes(text: string): Promise<'trivial'|'moderate'|'structural'>;
export function detectTriggerPhrase(text: string): TriggerMatch | null;
```

From src/decisions/suppressions.ts (Plan 03):
```typescript
export async function addSuppression(chatId: bigint, phrase: string): Promise<void>;
export async function isSuppressed(text: string, chatId: bigint): Promise<boolean>;
```

From src/bot/bot.ts (existing pattern to mirror):
```typescript
bot.command('sync', handleSyncCommand as any);    // line ~22
bot.on('message:text', handleTextMessage as any); // after all commands
```

From src/chris/engine.ts (existing — insertion point):
```typescript
// processMessage(chatId: bigint, text: string): Promise<string> {
//   try {
//     // ── INSERT PP#0 + PP#1 HERE, ABOVE THE NEXT LINE ──
//     const muteResult = await detectMuteIntent(text);   // ~line 140
//     if (muteResult.muted) { … }
//     …
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Insert PP#0 + PP#1 at the top of engine.ts::processMessage()</name>
  <files>src/chris/engine.ts</files>
  <read_first>
    - src/chris/engine.ts FULL FILE (320 lines — critical to see exact `processMessage` structure, the existing mute/refusal/language/mode chain, saveMessage calls, and imports)
    - src/decisions/capture.ts (Plan 04 — openCapture + handleCapture signatures)
    - src/decisions/capture-state.ts (getActiveDecisionCapture, clearCapture, isAbortPhrase, CaptureDraft)
    - src/decisions/triggers.ts (detectTriggerPhrase + classifyStakes)
    - src/decisions/suppressions.ts (isSuppressed)
    - src/chris/language.ts (detectLanguage — for PP#1 language_at_capture seeding)
    - src/decisions/__tests__/engine-capture.test.ts (test-driven insertion point requirements)
    - .planning/phases/14-capture-flow/14-CONTEXT.md §"Engine pre-processor ordering" (D-24, D-25 exact ordering spec)
    - .planning/phases/14-capture-flow/14-RESEARCH.md §"Engine Pre-processor Insertion Point" (reference snippet)
  </read_first>
  <action>
    **Imports (add at top of `src/chris/engine.ts`, near other `src/decisions/*` imports if any):**
    ```typescript
    import {
      getActiveDecisionCapture,
      clearCapture,
      isAbortPhrase,
      type CaptureDraft,
    } from '../decisions/capture-state.js';
    import { handleCapture, openCapture } from '../decisions/capture.js';
    import { detectTriggerPhrase, classifyStakes } from '../decisions/triggers.js';
    import { isSuppressed } from '../decisions/suppressions.js';
    ```

    **Insert this block at the top of `processMessage()`'s `try` body, IMMEDIATELY BEFORE `const muteResult = await detectMuteIntent(text);`:**

    ```typescript
    // ── PP#0: active decision-capture check (SWEEP-03) ─────────────────
    // Runs BEFORE mute/refusal/language/mode detection (D-24).
    const activeCapture = await getActiveDecisionCapture(chatId);
    if (activeCapture) {
      const draft = activeCapture.draft as CaptureDraft;
      const lang = draft.language_at_capture;

      // D-25: abort-phrase check INSIDE PP#0 (handler entry).
      if (isAbortPhrase(text, lang)) {
        await clearCapture(chatId);
        const ack = abortAcknowledgment(lang);
        await saveMessage(chatId, 'USER', text, 'JOURNAL');
        await saveMessage(chatId, 'ASSISTANT', ack, 'JOURNAL');
        return ack;
      }

      // Phase 14: handle CAPTURING stages; Phase 16 will branch AWAITING_RESOLUTION / AWAITING_POSTMORTEM here.
      if (
        activeCapture.stage === 'DECISION' ||
        activeCapture.stage === 'ALTERNATIVES' ||
        activeCapture.stage === 'REASONING' ||
        activeCapture.stage === 'PREDICTION' ||
        activeCapture.stage === 'FALSIFICATION'
      ) {
        const reply = await handleCapture(chatId, text, activeCapture);
        await saveMessage(chatId, 'USER', text, 'JOURNAL');
        await saveMessage(chatId, 'ASSISTANT', reply, 'JOURNAL');
        return reply;
      }
      // AWAITING_RESOLUTION / AWAITING_POSTMORTEM / DONE → Phase 16 will handle; for now fall through.
    }

    // ── PP#1: decision-trigger detection ───────────────────────────────
    // Suppression check precedes regex (D-17).
    if (!(await isSuppressed(text, chatId))) {
      const triggerMatch = detectTriggerPhrase(text);
      if (triggerMatch) {
        const tier = await classifyStakes(text);  // D-06 fail-closed to 'trivial'
        if (tier === 'structural') {
          // D-22: franc on the exact triggering message; lock into draft.
          const prevLang = getLastUserLanguage(chatId.toString());
          const detected = detectLanguage(text, prevLang);
          const lang: 'en'|'fr'|'ru' = detected === 'fr' ? 'fr' : detected === 'ru' ? 'ru' : 'en';
          const q1 = await openCapture(chatId, text, lang);
          await saveMessage(chatId, 'USER', text, 'JOURNAL');
          await saveMessage(chatId, 'ASSISTANT', q1, 'JOURNAL');
          return q1;
        }
        // trivial / moderate / fail-closed → fall through to normal engine.
      }
    }
    ```

    **Add `abortAcknowledgment(lang)` helper** (inside `engine.ts` near other small helpers, or inline into the PP#0 block):
    ```typescript
    function abortAcknowledgment(lang: 'en'|'fr'|'ru'): string {
      switch (lang) {
        case 'en': return 'Okay — dropping that.';
        case 'fr': return 'Okay — on laisse tomber.';
        case 'ru': return 'Хорошо — отменяю.';
      }
    }
    ```

    Do NOT alter any existing pre-processor code below (mute/refusal/language/mode/response pipeline). Do NOT remove or reorder them.

    `saveMessage(chatId, role, text, mode)` is the existing helper in engine.ts — use the same call shape used by the mute branch (mode='JOURNAL' is fine for capture turns since capture pre-empts mode detection).
  </action>
  <verify>
    <automated>DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/engine-capture.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -cE "(getActiveDecisionCapture|handleCapture|openCapture|detectTriggerPhrase|classifyStakes|isSuppressed|isAbortPhrase)" src/chris/engine.ts` returns ≥7 (all imports referenced).
    - In `src/chris/engine.ts`, the FIRST occurrence of `getActiveDecisionCapture(chatId)` line-number is STRICTLY LESS THAN the first occurrence of `detectMuteIntent(`: `awk '/getActiveDecisionCapture\(chatId\)/{p0=NR} /detectMuteIntent\(/{p1=NR; exit} END{exit !(p0>0 && p0<p1)}' src/chris/engine.ts && echo OK` prints `OK`.
    - `grep -c "isAbortPhrase" src/chris/engine.ts` returns ≥1 (abort inside PP#0 per D-25).
    - `grep -c "'structural'" src/chris/engine.ts` returns ≥1 (only structural activates capture).
    - `grep -c "abortAcknowledgment\|dropping that\|on laisse tomber\|отменяю" src/chris/engine.ts` returns ≥3 (all three languages).
    - `engine-capture.test.ts` exits 0 (all cases GREEN including PP#0-precedes-mute, structural opens capture, suppressed phrase skips regex, re-trigger mid-capture ignored).
    - All Phase 13 regression tests still GREEN.
  </acceptance_criteria>
  <done>engine-capture.test.ts GREEN; PP#0+PP#1 inserted in the correct position; mute/refusal/language/mode detection untouched and still works outside capture; abort-phrase cleanly clears state from inside PP#0.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add /decisions suppress bot command + handler</name>
  <files>src/bot/handlers/decisions.ts, src/bot/bot.ts</files>
  <read_first>
    - src/bot/bot.ts (FULL — existing command registration order + handleTextMessage registration at the bottom)
    - src/bot/handlers/sync.ts (exact shape for a command handler — ctx typing, auth middleware assumption, reply pattern)
    - src/bot/middleware/auth.ts (understand authorization precondition — handler can assume authorized user)
    - src/decisions/suppressions.ts (addSuppression API from Plan 03)
    - src/chris/language.ts (getLastUserLanguage for localized replies)
    - src/decisions/__tests__/suppressions.test.ts (confirm whether command-level tests live here or in a new suite — read to see)
  </read_first>
  <behavior>
    - `bot.command('decisions', handleDecisionsCommand)` registered in `src/bot/bot.ts` IMMEDIATELY AFTER `bot.command('sync', handleSyncCommand)` and BEFORE `bot.on('message:text', ...)`.
    - Handler parses `ctx.message.text` (format: `/decisions <subcommand> [args]`).
    - Phase 14 supports ONLY `suppress <phrase>`. Any other sub-command (`open`, `recent`, `stats`, `reclassify`) replies with "Coming in Phase 17." localized to last user language.
    - `suppress <phrase>`:
      - If `<phrase>` missing or empty after trim → reply with usage: `Usage: /decisions suppress <phrase>` (localized).
      - If `<phrase>` longer than 200 chars → reply with length-limit message (localized).
      - Else call `addSuppression(chatId, phrase)`; reply with localized confirmation echoing the normalized (lowercased) phrase in quotes.
    - Errors from `addSuppression` (throws on empty/oversize — which we should have pre-validated, but safety net) → reply with generic localized error, log the exception.
    - Suppression is scoped to `ctx.chat.id` (T-14-05-02 — never a global suppression).
  </behavior>
  <action>
    **Create `src/bot/handlers/decisions.ts`:**

    ```typescript
    import type { Context } from 'grammy';
    import { addSuppression } from '../../decisions/suppressions.js';
    import { getLastUserLanguage } from '../../chris/language.js';
    import { logger } from '../../observability/logger.js';

    export async function handleDecisionsCommand(ctx: Context): Promise<void> {
      const chatId = ctx.chat?.id;
      if (chatId === undefined) return;
      const chatIdBig = BigInt(chatId);
      const lang = isoLang(getLastUserLanguage(chatId.toString()));

      const raw = ctx.message?.text ?? '';
      // format: "/decisions suppress <phrase>" (Grammy sends full text incl. slash)
      const after = raw.replace(/^\/decisions(?:@\w+)?\s*/i, '').trim();
      if (!after) {
        await ctx.reply(usageMessage(lang));
        return;
      }

      const [sub, ...rest] = after.split(/\s+/);
      const arg = rest.join(' ').trim();

      if (sub.toLowerCase() === 'suppress') {
        if (!arg) { await ctx.reply(usageMessage(lang)); return; }
        if (arg.length > 200) { await ctx.reply(tooLongMessage(lang)); return; }
        try {
          await addSuppression(chatIdBig, arg);
          await ctx.reply(confirmedMessage(lang, arg.trim().toLowerCase()));
        } catch (err) {
          logger.warn({
            error: err instanceof Error ? err.message : String(err),
            chatId,
          }, 'decisions.suppress.error');
          await ctx.reply(genericErrorMessage(lang));
        }
        return;
      }

      if (['open', 'recent', 'stats', 'reclassify'].includes(sub.toLowerCase())) {
        await ctx.reply(phase17Message(lang));
        return;
      }

      await ctx.reply(usageMessage(lang));
    }

    function isoLang(raw: string | null): 'en'|'fr'|'ru' {
      return raw === 'fr' ? 'fr' : raw === 'ru' ? 'ru' : 'en';
    }

    function usageMessage(l: 'en'|'fr'|'ru'): string {
      switch (l) {
        case 'en': return 'Usage: /decisions suppress <phrase>';
        case 'fr': return 'Usage : /decisions suppress <phrase>';
        case 'ru': return 'Использование: /decisions suppress <phrase>';
      }
    }
    function tooLongMessage(l: 'en'|'fr'|'ru'): string {
      switch (l) {
        case 'en': return 'That phrase is too long (200 char max).';
        case 'fr': return 'Cette phrase est trop longue (200 caractères max).';
        case 'ru': return 'Слишком длинная фраза (максимум 200 символов).';
      }
    }
    function confirmedMessage(l: 'en'|'fr'|'ru', phrase: string): string {
      switch (l) {
        case 'en': return `Suppressed "${phrase}". I won't trigger on messages containing it.`;
        case 'fr': return `Supprimée : "${phrase}". Je ne déclencherai plus sur les messages la contenant.`;
        case 'ru': return `Подавил «${phrase}». Больше не буду срабатывать на сообщения с этой фразой.`;
      }
    }
    function phase17Message(l: 'en'|'fr'|'ru'): string {
      switch (l) {
        case 'en': return 'Coming in Phase 17.';
        case 'fr': return 'Arrive en Phase 17.';
        case 'ru': return 'Будет в фазе 17.';
      }
    }
    function genericErrorMessage(l: 'en'|'fr'|'ru'): string {
      switch (l) {
        case 'en': return 'Something went wrong saving that suppression.';
        case 'fr': return 'Erreur en sauvegardant cette suppression.';
        case 'ru': return 'Ошибка при сохранении подавления.';
      }
    }
    ```

    **Edit `src/bot/bot.ts`:**
    - Add import: `import { handleDecisionsCommand } from './handlers/decisions.js';`
    - Add registration IMMEDIATELY AFTER the existing `bot.command('sync', handleSyncCommand as any);` line: `bot.command('decisions', handleDecisionsCommand as any);`
    - Do NOT touch `bot.on('message:text', ...)` or any other existing registration.
  </action>
  <verify>
    <automated>npx tsc --noEmit && DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" npx vitest run src/decisions/__tests__/suppressions.test.ts src/bot/__tests__/ 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "^export async function handleDecisionsCommand" src/bot/handlers/decisions.ts` returns 1.
    - `grep -c "addSuppression" src/bot/handlers/decisions.ts` returns ≥1.
    - `grep -c "BigInt(chatId)\|BigInt(chat\.id)" src/bot/handlers/decisions.ts` returns ≥1 (chat-scoped — T-14-05-02 addresses this).
    - `grep -c "bot.command('decisions'" src/bot/bot.ts` returns 1.
    - In `src/bot/bot.ts`: `bot.command('decisions', ...)` line number is STRICTLY LESS THAN `bot.on('message:text'` line number: `awk '/bot\.command\(.decisions./{p0=NR} /bot\.on\(.message:text./{p1=NR} END{exit !(p0>0 && p0<p1)}' src/bot/bot.ts && echo OK` prints `OK`.
    - `grep -c "length > 200" src/bot/handlers/decisions.ts` returns ≥1 (input validation — T-14-05-01).
    - `grep -c "Phase 17\|Phase 17\|фазе 17" src/bot/handlers/decisions.ts` returns ≥3 (known-future-subcommand response in EN/FR/RU).
    - `npx tsc --noEmit` exits 0 (no type errors).
    - `npm test` exits 0 (full suite including Docker Postgres + migration 0004).
  </acceptance_criteria>
  <done>/decisions suppress <phrase> command registered; handler validates input; writes per-chat suppression; unknown sub-commands return localized Phase-17 stub; full `npm test` GREEN — Phase 14 requirement set closed.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Telegram `/decisions suppress <phrase>` → DB | Arbitrary user text via ctx.message.text; length + non-empty validation at handler entry |
| engine.ts::processMessage → PP#0/PP#1 → capture pipeline | Every message from Telegram flows through this; must not break existing mute/refusal/language/mode flow when no capture is active |
| `/decisions` command surface | Only `suppress` is wired in Phase 14 — other sub-commands must NOT leak internal state or fall through to text handler |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-14-05-01 | Tampering / DoS | /decisions suppress oversized phrase | mitigate | Handler enforces 200-char limit at entry; `addSuppression` also enforces (defense in depth) |
| T-14-05-02 | Privacy (cross-chat leakage) | /decisions suppress scoping | mitigate | Handler passes `BigInt(ctx.chat.id)` to `addSuppression`; never global; scoping test in suppressions.test.ts asserts this |
| T-14-05-03 | Integrity | PP#0 ordering drift over future edits | mitigate | Acceptance criterion line-number assertion (`awk` script) will catch any refactor that accidentally moves PP#0 after mute detection |
| T-14-05-04 | Tampering | Abort-phrase false positive opening capture | mitigate | Per Pitfall 4: abort check is INSIDE PP#0 only — if no capture is active, abort phrases are just normal messages and cannot prevent capture from opening |
| T-14-05-05 | Information Disclosure | Logging `/decisions suppress <phrase>` payload | mitigate | Handler logs only `{chatId, error.message}` on failure; never logs the phrase itself |
| T-14-05-06 | DoS | Trigger→abort→trigger loop | accept | D-25 ensures capture-state cleared on abort; next trigger can re-fire cleanly; rate bounded by Haiku ~3s turnaround; single-user threat model |
</threat_model>

<verification>
- `npm test` exits 0 end-to-end (Docker Postgres + migration 0004 + full Vitest including all Phase 13 + Phase 14 test files).
- `npx tsc --noEmit` exits 0.
- Line-number ordering assertions hold: PP#0 precedes `detectMuteIntent` in engine.ts; `/decisions` command precedes `message:text` in bot.ts.
- engine-capture.test.ts + suppressions.test.ts + capture.test.ts + vague-validator.test.ts + resolve-by.test.ts + triggers.test.ts ALL GREEN.
</verification>

<success_criteria>
- Phase 14 complete: every requirement (CAP-01, CAP-02, CAP-03, CAP-04, CAP-05, CAP-06, LIFE-05, SWEEP-03) satisfied by GREEN test coverage.
- Full `npm test` GREEN including Phase 13 regression.
- User can send an EN/FR/RU trigger phrase → Chris opens capture → answers fill slots → Chris archives with either `open` or `open-draft`.
- User can send `/decisions suppress <phrase>` → future messages containing that phrase skip Phase A regex entirely.
</success_criteria>

<output>
After completion, create `.planning/phases/14-capture-flow/14-05-SUMMARY.md`.
</output>
