---
phase: 14-capture-flow
reviewed: 2026-04-16T12:00:00Z
depth: standard
files_reviewed: 24
files_reviewed_list:
  - src/decisions/triggers.ts
  - src/decisions/suppressions.ts
  - src/decisions/capture-state.ts
  - src/decisions/capture.ts
  - src/decisions/resolve-by.ts
  - src/decisions/vague-validator.ts
  - src/decisions/index.ts
  - src/decisions/triggers-fixtures.ts
  - src/chris/engine.ts
  - src/bot/bot.ts
  - src/bot/handlers/decisions.ts
  - src/llm/client.ts
  - src/llm/prompts.ts
  - src/db/schema.ts
  - scripts/test.sh
  - src/decisions/__tests__/triggers.test.ts
  - src/decisions/__tests__/capture.test.ts
  - src/decisions/__tests__/resolve-by.test.ts
  - src/decisions/__tests__/suppressions.test.ts
  - src/decisions/__tests__/vague-validator.test.ts
  - src/decisions/__tests__/engine-capture.test.ts
  - src/chris/__tests__/engine.test.ts
  - src/db/migrations/0004_decision_trigger_suppressions.sql
  - src/db/migrations/meta/_journal.json
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-04-16T12:00:00Z
**Depth:** standard
**Files Reviewed:** 24
**Status:** issues_found

## Summary

Phase 14 implements a bilingual decision-capture flow: trigger detection (regex + Haiku stakes classifier), multi-turn conversational capture with greedy slot extraction, a vague-prediction validator, resolve-by natural-language parsing with clarifier ladder, per-chat suppression persistence, and engine/bot wiring (PP#0 and PP#1 pre-processors). The migration and schema additions are clean.

Overall the code is well-structured with consistent fail-closed/fail-soft patterns, proper timeout racing, and good separation of concerns. Security posture is solid -- user text stays in `messages[].content` only, logging avoids raw input, and the `/decisions` command handler validates input length. Four warnings and four info-level items follow.

## Warnings

### WR-01: Empty string sent to user when capture state vanishes mid-turn

**File:** `src/decisions/capture.ts:271-274`
**Issue:** `handleCapture` returns `''` when `getActiveDecisionCapture` returns null. The engine at `src/chris/engine.ts:188-189` saves this empty string as the assistant message and sends it via `ctx.reply('')`. Telegram's `sendMessage` API rejects empty text bodies, which would cause an unhandled error in the bot layer (grammy will throw). This can occur if a race condition (two concurrent messages from the same chat) causes the first to clear state before the second enters handleCapture.
**Fix:** Return a safe fallback message or throw an error that the engine can catch:
```typescript
if (!state) {
  logger.warn({ chatId: chatId.toString() }, 'capture.handleCapture.no_state');
  return ''; // Engine should guard against empty replies
}
```
And in the engine, guard the capture reply:
```typescript
const reply = await handleCapture(chatId, text);
if (!reply) {
  // State was cleared concurrently; fall through to normal engine
  break; // or continue to mode detection
}
```

### WR-02: Redundant abort-phrase check in handleCapture is dead code from engine path

**File:** `src/decisions/capture.ts:279-284` and `src/chris/engine.ts:170-176`
**Issue:** The engine's PP#0 (lines 170-176) checks `isAbortPhrase` and handles abort with an acknowledgment *before* calling `handleCapture`. Then `handleCapture` (line 279-284) checks `isAbortPhrase` again internally. From the engine call path, the internal check is unreachable for abort phrases. This creates two divergent abort behaviors: PP#0 returns an acknowledgment string ("Okay -- dropping that.") while handleCapture returns `''` (silent). If handleCapture is ever called from a different entry point, it would silently abort without user feedback.
**Fix:** Either remove the internal abort check from handleCapture (making the engine the single abort handler) or make handleCapture's abort also return an acknowledgment. The current split makes the contract ambiguous:
```typescript
// Option A: handleCapture returns acknowledgment on abort (consistent API)
if (isAbortPhrase(text, lang)) {
  await clearCapture(chatId);
  logger.info({ chatId: chatId.toString() }, 'capture.abort');
  return abortAcknowledgment(lang); // instead of ''
}
```

### WR-03: Stale `@ts-expect-error` in suppressions test

**File:** `src/decisions/__tests__/suppressions.test.ts:24`
**Issue:** The `@ts-expect-error` comment says "Wave 1 creates this module", but `src/decisions/suppressions.ts` now exists and exports `addSuppression` and `isSuppressed`. The directive suppresses a real type-check on the import, meaning any type mismatch between the test's usage and the actual module signatures would be silently ignored.
**Fix:** Remove the `@ts-expect-error` comment:
```typescript
import { addSuppression, isSuppressed } from '../suppressions.js';
```

### WR-04: `matchClarifierReply` language parameter unused -- all patterns checked regardless

**File:** `src/decisions/resolve-by.ts:57-75`
**Issue:** The `language` parameter is declared but never used. All EN, FR, and RU patterns are tested sequentially regardless of the language argument. This means a French user replying "week" (English) would match the EN pattern and resolve successfully, which may be intentional (lenient matching). However, the unused parameter is misleading -- callers might assume it filters to language-specific patterns only. If an EN user types "an" (short word), it would match the FR year pattern `/\ban(n[eé]e)?s?\b/` at line 68, returning `'year'` unexpectedly.
**Fix:** Either remove the `language` parameter (if cross-language matching is intentional) or scope the patterns:
```typescript
// If intentional cross-language matching:
export function matchClarifierReply(text: string): ClarifierChoice | null {
```

## Info

### IN-01: `stripFences` and `errMsg` duplicated across three modules

**File:** `src/decisions/capture.ts:452-455`, `src/decisions/resolve-by.ts:93-96`, `src/decisions/vague-validator.ts:76-79`
**Issue:** `stripFences` is already exported from `src/utils/text.js` (imported by `triggers.ts`). Three modules define identical local copies. `errMsg` is similarly duplicated.
**Fix:** Import from the shared utility module:
```typescript
import { stripFences } from '../utils/text.js';
```
And consider adding `errMsg` to a shared utils module.

### IN-02: Fire-and-forget contradiction scan has no error boundary in production

**File:** `src/decisions/capture.ts:401-408`
**Issue:** The `void` IIFE for contradiction scanning catches errors internally, which is good. However, the `Promise.race` timeout resolves to `never[]` type (`new Promise<never[]>`), which is slightly misleading -- it should be `DetectedContradiction[]` or just `[]`. The type `never[]` technically works (empty array is valid for any array type) but harms readability.
**Fix:**
```typescript
new Promise<DetectedContradiction[]>((r) => setTimeout(() => r([]), 3000)),
```

### IN-03: Test file imports `eq` from drizzle-orm but does not use it

**File:** `src/decisions/__tests__/capture.test.ts:17`
**Issue:** `eq` is imported but never used in the test file. The queries all use `db.select().from(...)` without where clauses.
**Fix:** Remove the unused import:
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
// Remove: import { eq } from 'drizzle-orm';
```

### IN-04: Hardcoded DB credential in test script

**File:** `scripts/test.sh:7`
**Issue:** `DB_URL` contains `localtest123` as the password. While this is a local test-only credential (not production), it establishes a pattern of hardcoded passwords in shell scripts. The credential is scoped to `docker-compose.local.yml` which likely defines the same value, so the risk is minimal.
**Fix:** Consider reading from environment or the compose file:
```bash
DB_URL="${TEST_DATABASE_URL:-postgresql://chris:localtest123@localhost:5433/chris}"
```

---

_Reviewed: 2026-04-16T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
