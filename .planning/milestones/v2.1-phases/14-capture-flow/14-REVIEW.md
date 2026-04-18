---
phase: 14-capture-flow
reviewed: 2026-04-17T15:02:43Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/decisions/triggers.ts
  - src/decisions/triggers-fixtures.ts
  - src/decisions/capture.ts
  - src/decisions/resolve-by.ts
  - src/decisions/vague-validator.ts
  - src/decisions/capture-state.ts
  - src/decisions/suppressions.ts
  - src/bot/handlers/decisions.ts
  - src/bot/bot.ts
  - src/chris/engine.ts
  - src/llm/client.ts
  - src/llm/prompts.ts
  - src/db/migrations/0004_decision_trigger_suppressions.sql
findings:
  critical: 2
  warning: 8
  info: 4
  total: 14
status: issues_found
---

# Phase 14: Capture Flow — Code Review Report

**Reviewed:** 2026-04-17T15:02:43Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Phase 14 lays down a thoughtful, well-decomposed capture pipeline — bilingual regex triggers, fail-closed Haiku stakes gating, greedy slot extraction, NL timeframe parsing with clarifier ladder, vague-prediction validator, and per-chat suppressions. Structure, language threading, abort handling, and D-20 contradiction-scan gating are correct. State transitions through `capture-state.ts` are clean, and the PP#0 / PP#1 ordering in `engine.ts` matches D-24.

However, two production-blocking field-name contract mismatches between `prompts.ts` and the Haiku-response parsers would cause the entire feature to silently fail-closed in production: the stakes classifier and the resolve-by parser read keys that the prompts do not emit. Both paths have fail-soft defaults, so the bot would never crash — it would simply never fire structural capture, and every natural-language date would cascade into the clarifier ladder. Unit tests that mock `callLLM` with the "correct" fixture would pass; live Haiku traffic would not.

Secondary concerns: the 15-second vague-validator timeout is inconsistent with the 2–3s budgets elsewhere and noticeably degrades the "not an interrogation" feel; the `isSuppressed` substring match has no minimum length, letting a 2–3 char suppression silently disable all triggers; and `matchClarifierReply` accepts but never uses its `language` parameter. No security issues found — no SQL injection risk (all Drizzle), no secret leakage, no user-text logging.

## Critical Issues

### CR-01: Stakes classifier reads wrong JSON field — feature silently disabled

**File:** `src/decisions/triggers.ts:160` (parser) + `src/llm/prompts.ts:322` (prompt)
**Issue:** `STAKES_CLASSIFICATION_PROMPT` instructs Haiku to return `{"stakes": "trivial"|"moderate"|"structural"}`, but `classifyStakes()` reads `parsed.tier`. Since `parsed.tier` is always `undefined`, `VALID_TIERS.has(undefined)` is false and the function always returns `'trivial'` via the fallback. With D-06 fail-closed semantics, **no message will ever reach the `structural` branch in `engine.ts:220`**, so capture never opens for real traffic. Unit tests that mock the call with `{"tier": "structural"}` directly will pass, masking the defect.
**Fix:** Align the prompt and parser. Either change the prompt to emit `tier`:
```ts
// prompts.ts
export const STAKES_CLASSIFICATION_PROMPT = `...
Return a JSON object with exactly one field:
{"tier": "trivial" | "moderate" | "structural"}
...`;
```
or change the parser to read `stakes`:
```ts
// triggers.ts
const tier: StakesTier = VALID_TIERS.has(parsed.stakes)
  ? (parsed.stakes as StakesTier)
  : 'trivial';
```
Add a contract test that exercises a real Haiku call (or a mock of its actual response schema) end-to-end so field drift is caught.

### CR-02: Resolve-by parser reads wrong JSON field — every date falls to clarifier ladder

**File:** `src/decisions/resolve-by.ts:40-41` (parser) + `src/llm/prompts.ts:351` (prompt)
**Issue:** `RESOLVE_BY_PARSER_PROMPT` says `Return a JSON object: {"date": "YYYY-MM-DD"} or {"date": null}`, but `parseResolveBy()` reads `parsed.iso`. `parsed.iso` is always `undefined`, so the function always returns `null`, triggering `resolve_by_clarifier_pending = true` in `capture.ts:332` on every single timeframe. Users who answer "next month" will be forced through the clarifier menu every time, defeating D-18. Compounding issue: the prompt specifies `YYYY-MM-DD` (bare date) but the code does `new Date(parsed.iso)` expecting an ISO datetime — a bare date string parses as UTC midnight and can shift the day in non-UTC timezones.
**Fix:** Align names and format:
```ts
// prompts.ts — use iso + full ISO-8601
Return a JSON object: {"iso": "YYYY-MM-DDT00:00:00Z"} or {"iso": null} if unparseable.
```
Or in `resolve-by.ts`, read `parsed.date` and construct the Date with an explicit timezone policy. Add a contract test with a faithful Haiku-response fixture.

## Warnings

### WR-01: Vague-validator 15s timeout blocks capture turn

**File:** `src/decisions/vague-validator.ts:13`
**Issue:** `VAGUE_TIMEOUT_MS = 15000` is 5× the stakes-classifier budget (3s) and 7.5× the resolve-by budget (2s). It runs synchronously inside `handleCapture()` before the next question is sent, so a slow Haiku could make Greg wait 15 seconds between questions — the exact "interrogation feel" the phase goal prohibits.
**Fix:** Lower to 3000ms to match stakes and extractor budgets. Fail-soft to `'acceptable'` already aligns with the anti-interrogation ethos.

### WR-02: `isSuppressed` substring match has no minimum phrase length

**File:** `src/decisions/suppressions.ts:21-35`
**Issue:** `addSuppression` enforces a 200-char upper bound but only an "non-empty after trimming" lower bound. A user who runs `/decisions suppress i` would disable every trigger containing the letter "i" (all of them). The docstring advertises "case-insensitive substring" as intentional, but combined with no floor this is effectively a footgun.
**Fix:** Enforce a minimum length (e.g. 3 chars) and consider whole-word matching in `isSuppressed`:
```ts
if (normalized.length < 3) {
  throw new Error('suppression phrase must be at least 3 characters');
}
```

### WR-03: `matchClarifierReply` `language` parameter is unused

**File:** `src/decisions/resolve-by.ts:57`
**Issue:** The function signature takes `language: 'en' | 'fr' | 'ru'` but the body checks all three languages' regexes regardless. The signature advertises per-language dispatch that doesn't happen, making future refactors fragile. Cross-language false-matches are mostly prevented by disjoint scripts (EN/RU), but EN and FR share Latin — e.g., "a month" in an FR session still matches the EN `\bmonth\b` pattern.
**Fix:** Branch on `language` explicitly, or remove the parameter:
```ts
export function matchClarifierReply(text: string, language: 'en' | 'fr' | 'ru'): ClarifierChoice | null {
  const t = text.trim().toLowerCase();
  if (language === 'en') { /* EN checks only */ }
  else if (language === 'fr') { /* FR checks only */ }
  else { /* RU checks only */ }
  return null;
}
```

### WR-04: `\b` word-boundary on Cyrillic patterns in `matchClarifierReply`

**File:** `src/decisions/resolve-by.ts:70-73`
**Issue:** `/\bгод\b|\bгода\b/i` — JavaScript regex `\b` is ASCII-only, so "word boundary" fails to separate Cyrillic. `годная`, `годен`, `годовщина` all contain `год` and could false-match. This mirrors the `\b` concern that was correctly addressed in `triggers.ts` (where FR/RU patterns removed `\b`) but was not applied here. Same issue for `\bнеделю?\b`, `\bмесяц\b`.
**Fix:** Replace `\b` with a Cyrillic-aware boundary using Unicode property escapes:
```ts
if (/(?:^|[^\p{L}])(год(?:а)?)(?:[^\p{L}]|$)/iu.test(t)) return 'year';
```

### WR-05: `RESOLVE_BY_PARSER_PROMPT` promises a "today's date" context that callers never send

**File:** `src/decisions/resolve-by.ts:31` + `src/llm/prompts.ts:347-353`
**Issue:** The prompt text reads "Today's date will be included in the user message context", but `parseResolveBy()` passes only the raw `naturalText` to `callLLM`. Haiku has no reference date, so relative expressions like "next month" or "in 3 weeks" are computed against whatever Haiku assumes the date is — likely its training cutoff or an arbitrary anchor. Combined with CR-02, this compounds the unreliability of the NL path.
**Fix:** Prepend the current date to the user content:
```ts
const userContent = JSON.stringify({
  today: new Date().toISOString().slice(0, 10),
  text: naturalText,
});
await callLLM(RESOLVE_BY_PARSER_PROMPT, userContent, 50);
```
Update the prompt to consume the JSON shape explicitly.

### WR-06: `triggering_message` unconditional access in commit fallbacks

**File:** `src/decisions/capture.ts:197, 418`
**Issue:** `draft.triggering_message.slice(0, 500)` assumes the field is non-null. `CaptureDraft` declares it required, and `openCapture` sets it, but DB-loaded drafts are cast via `current.draft as CaptureDraft` in `capture-state.ts:68` — no runtime validation. If the JSONB column is missing the key (schema drift, partial write, manual edit), a `TypeError: Cannot read properties of undefined (reading 'slice')` would break commit and surface as a generic engine error.
**Fix:** Defensive fallback at the use sites:
```ts
decisionText: draft.decision_text ?? (draft.triggering_message ?? '').slice(0, 500) || '(decision)',
```
Or add a runtime guard at the JSONB boundary in `getActiveDecisionCapture`.

### WR-07: `stripFences` triplicated across three files

**File:** `src/decisions/capture.ts:452`, `src/decisions/resolve-by.ts:93`, `src/decisions/vague-validator.ts:76`
**Issue:** Identical local definitions of `stripFences` appear in three files, even though `src/utils/text.ts:7` exports one. `triggers.ts` correctly imports the shared utility. Duplication is a maintenance hazard — a future change to fence handling (e.g., supporting different code-fence languages) will leave copies stale. Capture.ts also separately imports nothing for fences, silently shadowing `stripFences` from `text.ts` if one were added.
**Fix:** Replace each local definition with `import { stripFences } from '../utils/text.js'`.

### WR-08: `detectContradictions` called with freshly-inserted `pensieveId` as `entryId`

**File:** `src/decisions/capture.ts:404`
**Issue:** `detectContradictions(draft.reasoning!, pensieveId)` — the second param is the pensieve entry ID of the entry *just created by this capture*. Reading `contradiction.ts:59`, the signature is `detectContradictions(text, entryId?)`. If `hybridSearch` does not exclude `entryId` from candidates, the newly-inserted entry could match itself and produce a spurious self-contradiction notice. Behavior needs verification.
**Fix:** Confirm `hybridSearch` filters by `entryId != self`. If not, either pass `undefined` or add an explicit exclusion. Add a unit test that captures a decision with non-trivial reasoning and asserts no contradiction notice surfaces against the just-created entry.

## Info

### IN-01: Phase attribution drift in handler header

**File:** `src/bot/handlers/decisions.ts:1-19`
**Issue:** File header reads "Phase 17 Plan 03" but `suppress` / `unsuppress` / `suppressions` sub-commands are Phase 14 scope (CAP-06). Only `reclassify` is genuinely Phase 17. Mixed-phase files should annotate per-section origin or drop the top-level phase tag.
**Fix:** Update header to "Phases 14 + 17" and annotate each sub-command block with its originating phase/ticket.

### IN-02: Empty-string reply from `handleCapture` on no-state path

**File:** `src/decisions/capture.ts:271-274`
**Issue:** `handleCapture` returns `''` when `getActiveDecisionCapture` returns null, and the engine (line 206) would forward `''` to `ctx.reply`. Telegram rejects empty text with `Bad Request: message text is empty`. Reachable only in a narrow race between abort and handler entry; normal flow protects via PP#0. Low risk but worth guarding.
**Fix:** In engine, check before forwarding: `if (reply) await ctx.reply(reply)`. Or return a localized fallback string from `handleCapture`.

### IN-03: `isSuppressed` O(n) DB round-trip per message

**File:** `src/decisions/suppressions.ts:43-53`
**Issue:** Every inbound message hits the DB to list all suppression phrases. For Greg's personal bot this is fine; performance issues are out of v1 scope but worth a TODO for future caching.
**Fix:** Cache per-chat suppression list in memory with invalidation on `addSuppression` / `removeSuppression`. Defer.

### IN-04: Defensive `?? 'en'` on required `language_at_capture`

**File:** `src/chris/engine.ts:187`
**Issue:** `draft.language_at_capture ?? 'en'` — the field is typed non-optional, so the fallback is unreachable under TypeScript's contract. Harmless but signals that the author did not trust the type — a soft smell pointing at the same JSONB-boundary-validation gap as WR-06.
**Fix:** Add runtime validation when loading JSONB in `capture-state.ts`:
```ts
function assertValidDraft(d: unknown): asserts d is CaptureDraft { /* shape check */ }
```

---

_Reviewed: 2026-04-17T15:02:43Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
