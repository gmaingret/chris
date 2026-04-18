---
phase: 12-identity-rename-residuals-frontmatter-hygiene
reviewed: 2026-04-18T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/proactive/mute.ts
  - src/proactive/triggers/opus-analysis.ts
findings:
  critical: 0
  warning: 5
  info: 5
  total: 10
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-04-18
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Phase 12 is a mechanical identity-rename cleanup. The in-scope deltas (two `John`→`Greg` substitutions inside prompt templates) are correct: `grep -n -i 'john'` returns zero hits in both files, and the surrounding JSDoc / variable names were appropriately left untouched per the locked context (classifier-only prompts outside this file intentionally preserve "John"). The `MUTE_DETECTION_PROMPT` in `src/llm/prompts.ts` contains no identity references, so no pronoun drift exists there either.

However, a standard-depth read of both files surfaced pre-existing correctness and resilience issues that were not introduced by Phase 12 but are visible in its scope and worth flagging:

- `parseMuteDuration` advertises timezone-aware computation in its JSDoc but uses server-local `Date` math, and silently returns an `Invalid Date` when Haiku emits an unparseable `until_date` string.
- `generateMuteAcknowledgment` has no fail-soft wrapper, unlike its sibling `detectMuteIntent`; a Sonnet outage propagates to the engine caller.
- `runOpusAnalysis` trusts the JSON shape from Opus and bypasses its own `SAFE_DEFAULT` if the model returns valid-JSON-but-wrong-shape.
- Neither Haiku nor Opus calls use a `Promise.race` timeout, despite `src/llm/client.ts` JSDoc explicitly naming that as the established project pattern for fail-soft callers.

Identity rename is clean. The warnings below are latent robustness issues that the review surfaced while verifying the rename — flagged per scope but none block Phase 12 sign-off.

## Warnings

### WR-01: `parseMuteDuration` uses server-local timezone despite JSDoc claim

**File:** `src/proactive/mute.ts:38-81`
**Issue:** The JSDoc on `parseMuteDuration` states "Uses the proactive timezone from config for date computations," but the body uses `new Date()`, `now.getDay()`, and `new Date(hint.until_date + 'T23:59:59')` — all of which operate in the server's local timezone (or UTC when the string has no offset). `config.proactiveTimezone` (`Europe/Paris`) is never consulted. For a server running in UTC processing "don't message me until Friday" at 23:30 UTC on a Thursday, `now.getDay()` returns 4 (Thursday), targetDay=5, daysUntil=1 — which lands correctly. But at 23:30 UTC on Friday (01:30 Saturday in Paris), `now.getDay()` returns 5, targetDay=5, daysUntil becomes 7 — silently muting a full week longer than Greg expected. The `until_date` branch has the same drift: `'2026-04-20T23:59:59'` without an offset is interpreted in server-local time, not Paris time.
**Fix:** Either compute the target date in `config.proactiveTimezone` using `Intl.DateTimeFormat` with `timeZone` (consistent with `generateMuteAcknowledgment`'s existing pattern), or delete the timezone claim from the JSDoc and document that all mute durations are UTC-offset from "now":
```typescript
// Option A: honor the JSDoc
const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.proactiveTimezone,
  year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
}).formatToParts(now);
// ... use parts to derive currentDay in Greg's tz

// Option B: make the JSDoc honest
/** Convert a duration hint into a concrete Date. Durations are UTC deltas
 *  from `new Date()`. Calendar-anchored hints (until_weekday, until_date)
 *  are resolved in the server's local timezone — see TECH-DEBT for
 *  proactiveTimezone-correct resolution. */
```

### WR-02: `until_date` with unparseable string returns `Invalid Date`, downstream throws

**File:** `src/proactive/mute.ts:70-77`
**Issue:** If Haiku emits `{"duration": {"until_date": "2026-13-45"}}` or `"next tuesday"` or any non-ISO string, `new Date(hint.until_date + 'T23:59:59')` produces an `Invalid Date` whose `getTime()` is `NaN`. The guard `target.getTime() <= now.getTime()` evaluates to `false` for NaN comparisons, so the invalid date falls through and is returned. Callers then do `muteUntil.toISOString()` at `mute.ts:132` (logger payload) and pass it to `Intl.DateTimeFormat.format()` at `mute.ts:166`, both of which throw `RangeError: Invalid time value`. Because `detectMuteIntent`'s try/catch is entered *before* `muteUntil.toISOString()` on line 132 (inside the try), the error path triggers and `{ muted: false }` is returned — but the user's actual mute request is silently dropped with only a generic `chris.mute.detect` warn log, and the user message then proceeds to normal processing (contradicts the user's clear mute intent).
**Fix:** Validate `target.getTime()` explicitly before comparing:
```typescript
if (hint.until_date != null) {
  const target = new Date(hint.until_date + 'T23:59:59');
  // If unparseable OR in the past, default to 7 days
  if (Number.isNaN(target.getTime()) || target.getTime() <= now.getTime()) {
    return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return target;
}
```

### WR-03: `generateMuteAcknowledgment` has no fail-soft wrapper

**File:** `src/proactive/mute.ts:157-190`
**Issue:** Unlike `detectMuteIntent`, which wraps the Sonnet call in try/catch and returns a safe default, `generateMuteAcknowledgment` has no error handling. The engine caller at `src/chris/engine.ts:244` awaits this function immediately after the mute has already been persisted. If Sonnet is down, rate-limited, or returns a 5xx, the throw bubbles to the engine, which currently has no catch around the mute path — the user sees a generic error message even though the mute *did* take effect. This contradicts the `callLLM` JSDoc in `src/llm/client.ts:14-22` which names `Promise.race + timeout + try/catch → fail-soft default` as the established pattern for LLM calls that must not block the user.
**Fix:** Wrap the Sonnet call in try/catch with the existing fallback string as the safe default:
```typescript
export async function generateMuteAcknowledgment(
  muteUntil: Date,
  timezone: string,
): Promise<string> {
  const dateStr = new Intl.DateTimeFormat('en-US', { /* ... */ }).format(muteUntil);
  const fallback = `Got it — I'll give you some space until ${dateStr}.`;
  try {
    const response = await anthropic.messages.create({ /* ... */ });
    const textBlock = response.content.find(
      (block: { type: string }) => block.type === 'text',
    );
    if (!textBlock || textBlock.type !== 'text') return fallback;
    return (textBlock as { type: 'text'; text: string }).text.trim();
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'chris.mute.acknowledge',
    );
    return fallback;
  }
}
```

### WR-04: `runOpusAnalysis` bypasses `SAFE_DEFAULT` on malformed-but-valid-JSON

**File:** `src/proactive/triggers/opus-analysis.ts:106`
**Issue:** `const parsed: OpusAnalysisResult = JSON.parse(jsonText)` is a type assertion, not a runtime validation. If Opus returns structurally valid JSON like `{"pattern": {...}}` (missing `thread`) or `{"result": "nothing found"}` (wrong shape entirely), `JSON.parse` succeeds and `parsed` is returned. Downstream in `src/proactive/sweep.ts:364` the caller reads `analysis.thread.detected` — this throws `TypeError: Cannot read properties of undefined (reading 'detected')`, which propagates up because `runOpusAnalysis`'s try/catch is already closed. The whole point of `SAFE_DEFAULT` is to prevent the sweep cycle from crashing on Opus misbehavior; shape drift defeats it.
**Fix:** Validate the shape before returning, or merge with `SAFE_DEFAULT` defensively:
```typescript
const parsed = JSON.parse(jsonText) as Partial<OpusAnalysisResult>;
// Merge with SAFE_DEFAULT so missing sections degrade to "nothing detected"
const result: OpusAnalysisResult = {
  pattern: { ...SAFE_DEFAULT.pattern, ...(parsed.pattern ?? {}) },
  thread: { ...SAFE_DEFAULT.thread, ...(parsed.thread ?? {}) },
};
// Guard confidence range
result.pattern.confidence = Math.max(0, Math.min(1, result.pattern.confidence ?? 0));
result.thread.confidence = Math.max(0, Math.min(1, result.thread.confidence ?? 0));
return result;
```

### WR-05: No request timeout on Haiku / Opus calls — 10-minute default blocks pipeline

**File:** `src/proactive/mute.ts:93-104`, `src/proactive/triggers/opus-analysis.ts:78-89`
**Issue:** Neither call applies a `Promise.race` timeout or passes a `{ signal: AbortSignal.timeout(...) }` option. The Anthropic SDK's default request timeout is 10 minutes. If the Anthropic API hangs, `detectMuteIntent` blocks the entire engine pre-processing chain (every user message awaits it at `engine.ts:241`), and `runOpusAnalysis` blocks the proactive sweep cycle — both for up to 10 minutes. This directly contradicts `src/llm/client.ts:14-22` which documents the required pattern: "callers that need fail-soft behavior must wrap this call in try/catch — see `validateVagueness`, `classifyStakes`, `parseResolveBy`, and the capture extractor for the established pattern (Promise.race with timeout + try/catch → fail-soft default)." Both functions here are fail-soft by design (they already return safe defaults on error) but skip the timeout half of the pattern.
**Fix:** Add `Promise.race` timeouts consistent with the codebase convention. Suggested budgets: 3s for Haiku mute detection (must not delay user response); 30s for Opus (aligned with D006 contradiction timeout proportions):
```typescript
// mute.ts — detectMuteIntent
const MUTE_DETECT_TIMEOUT_MS = 3000;
const response = await Promise.race([
  anthropic.messages.create({ /* ... */ }),
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('mute_detect_timeout')), MUTE_DETECT_TIMEOUT_MS),
  ),
]);

// opus-analysis.ts — runOpusAnalysis
const OPUS_ANALYSIS_TIMEOUT_MS = 30_000;
// same Promise.race pattern
```

## Info

### IN-01: Unused `config` import in `mute.ts`

**File:** `src/proactive/mute.ts:3`
**Issue:** `import { config } from '../config.js'` is imported but never referenced in the file (the timezone passed to `generateMuteAcknowledgment` is a parameter, not a config read). Either the JSDoc's timezone claim on `parseMuteDuration` is meant to be implemented against this import (see WR-01), or the import is vestigial.
**Fix:** Delete the import, or wire `config.proactiveTimezone` into `parseMuteDuration` per WR-01.

### IN-02: `formatDuration` can under-report mute length by up to 12 hours

**File:** `src/proactive/mute.ts:194-202`
**Issue:** `Math.round(diffMs / 86_400_000)` rounds down for any value under `x.5` days. A mute set for 5 days 10 hours reports "5 days" to Greg even though it ends 10 hours later. Not a correctness bug — `muteUntil` is computed correctly — but the user-facing string misreports by up to 12h.
**Fix:** Prefer `Math.ceil` so the displayed duration never promises *less* silence than Greg will actually get:
```typescript
const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
```

### IN-03: `until_weekday` when target equals today jumps a full week

**File:** `src/proactive/mute.ts:60-67`
**Issue:** When Haiku emits `until_weekday: "friday"` and it is currently Friday, `daysUntil = 0`, then `daysUntil += 7` — so "mute until Friday" on a Friday morning mutes for 7 days. For a user saying this on Friday morning, intent is ambiguous (end-of-day Friday vs. next Friday); the current hard-coded "+7" assumes next-week. Minor UX edge case; documenting it is enough.
**Fix:** Either accept the behavior and comment it, or route same-day requests to end-of-day:
```typescript
if (daysUntil < 0) daysUntil += 7;   // strict past-week → next week
// daysUntil === 0 falls through and returns "today" (end of day in parseMuteDuration's return branch)
```
Low priority — Haiku rarely emits weekday hints for same-day requests.

### IN-04: Redundant double type-cast on text blocks

**File:** `src/proactive/mute.ts:115,183,189`; `src/proactive/triggers/opus-analysis.ts:100`
**Issue:** After the type-narrowing check `if (!textBlock || textBlock.type !== 'text') return ...`, TypeScript already narrows `textBlock` to the text-block shape. The subsequent `(textBlock as { type: 'text'; text: string }).text` casts are redundant and hint that the `.find(...)` callback annotation `(block: { type: string }) => block.type === 'text'` is suppressing the narrowing. Using the SDK's `ContentBlock` discriminated union would let TS narrow without the cast.
**Fix:** Type the `find` predicate as a user-defined type guard, or import `TextBlock` from `@anthropic-ai/sdk`:
```typescript
const textBlock = response.content.find(
  (block): block is TextBlock => block.type === 'text',
);
if (!textBlock) return { muted: false };
// textBlock.text is now directly accessible — no cast
```

### IN-05: Opus system prompt could explicitly anchor "Greg" as the subject

**File:** `src/proactive/triggers/opus-analysis.ts:36`
**Issue:** The identity rename from Phase 12 correctly updated `"friendship between Chris and John"` → `"friendship between Chris and Greg"` in the opening sentence. However, subsequent rules refer to patterns/evidence abstractly without re-anchoring to "Greg." If Opus reads only the CRITICAL RULES block (it often weights imperative sections heaviest), it loses the subject. The CONTRADICTION_DETECTION_PROMPT and RELATIONAL_MEMORY_PROMPT deliberately keep "John" per 11-RESEARCH Pitfall 3 (classifier-stable training labels), but `OPUS_SYSTEM_PROMPT` is a generative analysis prompt, not a classifier, and could benefit from a second "Greg" anchor. Cosmetic.
**Fix:** Non-urgent. If a future prompt refinement touches this file, consider: `"...for Greg specifically: recurring patterns..."` or `"Evidence must come from what Greg has told Chris..."` in the rules section.

---

_Reviewed: 2026-04-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
