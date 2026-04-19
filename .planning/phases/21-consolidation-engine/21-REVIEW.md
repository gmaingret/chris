---
phase: 21-consolidation-engine
status: findings
files_reviewed: 7
depth: standard
files_reviewed_list:
  - src/chris/personality.ts
  - src/episodic/prompts.ts
  - src/episodic/sources.ts
  - src/episodic/consolidate.ts
  - src/episodic/notify.ts
  - src/episodic/__tests__/prompts.test.ts
  - src/episodic/__tests__/sources.test.ts
  - src/episodic/__tests__/consolidate.test.ts
findings:
  critical: 0
  warning: 2
  info: 6
  total: 8
---

# Phase 21: Code Review Report

**Reviewed:** 2026-04-18
**Depth:** standard
**Files Reviewed:** 7 source + 1 personality (8 total)
**Status:** findings

## Summary

Phase 21 delivers the daily episodic consolidation engine across four plans: SDK bump + preamble export (21-01), pure-function prompt assembler (21-02), day-bounded Drizzle read helpers (21-03), and the `runConsolidate` orchestrator with Telegram error notifier (21-04). Implementation quality is high overall — pure-function boundaries are clean, section builders are well-decomposed, the v3↔v4 zod mirror is thoughtfully localized, idempotency is defended at two layers (pre-flight SELECT + ON CONFLICT), timezone handling uses Luxon consistently, and error surfacing goes through a single `notifyConsolidationError` path per CONS-12.

Two warnings were found: (1) `buildEntriesBlock` in `prompts.ts` uses `getUTCHours()`/`getUTCMinutes()` to render per-entry timestamps, but labels the block as "timestamped in config.proactiveTimezone" — the rendered times will be UTC, not local, producing a semantic mismatch that will mislead Sonnet on time-of-day reasoning (important for CONS-05 "emotional intensity" and for sparse-day timestamps that straddle midnight). (2) The `callSonnetWithRetry` retry strategy retries on ALL errors including deterministically unretryable cases like 401 / 4xx validation failures, wasting rate-limit budget and doubling the time-to-notify on permanent failures; the JSDoc acknowledges this tradeoff explicitly but the decision merits re-examination.

The remaining findings are informational: a documentation-vs-schema drift around the "confidence ≥ 0.75" prompt anchor (no `confidence` column exists on the `contradictions` table; the threshold is enforced at write-time in M002 and the prompt text is inherited documentation); the `consolidate.test.ts` `ZodError` path does not actually exercise the v3 re-validation (the retry makes it a wash); log payload inconsistency between `notify.ts` (full error object) and `consolidate.ts` step-10 catch (error.message only, dropping stack); the `open-draft` post-filter blocks out-of-scope but leaves one odd edge in the `createdToday` flag; the v4 schema mirror has no direct in-repo drift test; and the verification-gate grep `grep -c "assembleConsolidationPrompt"` reports "2" which the 21-02 SUMMARY explains via "recursion-safe export" but actually just counts the function name in its declaration twice due to how the code is written — harmless but misleading.

No critical issues found. No source modifications recommended before Phase 22 cron registration, but WR-01 should be fixed before the 14-day synthetic fixture (TEST-15) is authored because per-entry timestamps feed into the fixture's correctness semantics.

## Warnings

### WR-01: `buildEntriesBlock` renders entry timestamps in UTC but labels them as local timezone

**File:** `src/episodic/prompts.ts:273-283`
**Issue:** The block header reads "Today's Pensieve Entries (verbatim, timestamped in config.proactiveTimezone — ${summaryDate})", but the per-entry timestamp is computed from `e.createdAt.getUTCHours()` / `getUTCMinutes()`. This produces a time-of-day mismatch:
- An entry created at 23:30 Europe/Paris (CEST, UTC+2) is stored as 21:30 UTC.
- `buildEntriesBlock` will print `- [21:30, telegram, tag=EMOTION] …` and the prompt header claims this is Paris local time.
- Sonnet reading the prompt will incorrectly reason about time-of-day (e.g. "Greg was up late" becomes "Greg journaled in the late afternoon").

This is a correctness bug for CONS-05's chain-of-thought requirement (rubric dimension 1 "emotional intensity" — late-night entries carry different weight than afternoon ones) and for CONS-11's sparse-day reasoning (a handful of early-morning entries read differently than evening ones). It is also a correctness bug for any Sonnet-side inference tied to the DST-boundary days (the whole point of Plan 21-03 Test 12).

**Fix:**
```ts
import { DateTime } from 'luxon';
// ...
function buildEntriesBlock(
  entries: ConsolidationPromptInput['entries'],
  summaryDate: string,
  tz: string, // NEW — pass config.proactiveTimezone from the caller
): string {
  const lines: string[] = [
    `## Today's Pensieve Entries (verbatim, timestamped in ${tz} — ${summaryDate})`,
  ];
  for (const e of entries) {
    const local = DateTime.fromJSDate(e.createdAt, { zone: tz });
    const hh = String(local.hour).padStart(2, '0');
    const mm = String(local.minute).padStart(2, '0');
    const tag = e.epistemicTag !== null ? `, tag=${e.epistemicTag}` : '';
    lines.push(`- [${hh}:${mm}, ${e.source}${tag}] ${e.content}`);
  }
  return lines.join('\n');
}
```

Propagate the `tz` through `assembleConsolidationPrompt`'s input (add `tz: string` to `ConsolidationPromptInput`, or pass separately). The caller already has `tz = config.proactiveTimezone` in `runConsolidate` (`consolidate.ts:203`). Add a test case asserting that `buildEntriesBlock` for an entry stored at `tzDate('2026-04-18T23:30:00', 'Europe/Paris')` renders as `[23:30, ...]` not `[21:30, ...]`.

### WR-02: `callSonnetWithRetry` retries on all errors including non-retryable 4xx / 401 failures

**File:** `src/episodic/consolidate.ts:129-183`
**Issue:** The retry wraps `try { first } catch { second }` with no discrimination. The JSDoc at L117-127 explicitly notes this tradeoff ("the simpler 'one retry on any throw' rule"), but the consequences in the failure modes the cron actually sees are:
- **401 Unauthorized (invalid API key):** Will retry, fail again identically, waste ~2s of cron budget, and only then surface via Telegram. Harmless in isolation but doubles the time from cron-tick to user-visible failure.
- **400 Bad Request (schema drift, model deprecated):** Same pattern — both calls fail; the second call cannot succeed because the bug is deterministic.
- **Network timeout:** Retry is legitimate here.
- **Rate limit 429:** Retry is marginally useful (a second request immediately after a rate-limit often fails the same way), but survivable.
- **Zod parse drift (the originally intended retry case):** Retry is legitimate — this was the only case retry was designed for.

The real concern is that `callSonnetWithRetry` does NOT implement any backoff. A burst retry on a rate-limit immediately re-hits the same limit. If the plan's ambition was "retry only structured-output drift," discriminating by error class (AnthropicError with a `status` property of 400 vs 429) is one line of code and considerably more defensible than "retry everything."

**Fix:** Either (a) narrow the retry to its original intent (structured-output drift only), or (b) accept the current behavior and document in the cron's ERROR-log payload that the 2x multiplier is deliberate. Option (a):
```ts
} catch (firstErr) {
  // Only retry on structured-output parse drift. Any non-drift error
  // (rate limit, 4xx, network) propagates immediately — a second call
  // in the same 100ms will fail the same way and just delays notify.
  const isRetryable =
    firstErr instanceof ZodError ||
    (firstErr instanceof Error && /parse|schema/i.test(firstErr.message));
  if (!isRetryable) throw firstErr;
  logger.warn(
    { err: firstErr instanceof Error ? firstErr.message : String(firstErr) },
    'episodic.consolidate.sonnet.retry',
  );
  // ...second attempt
}
```
At minimum, add a `setTimeout(resolve, 500)` before the second call so a rate-limit has a chance to decay, and attach the discrimination rationale to the JSDoc. Update Test 9 (currently asserts 2 calls on a generic `Error('rate limit exceeded')`) to the new narrower semantics.

## Info

### IN-01: `contradictions` table has no `confidence` column; prompt and comments reference one

**File:** `src/episodic/prompts.ts:38,199`; `src/episodic/sources.ts` (implicit, no filter applied)
**Issue:** The prompt section header reads `## Contradictions Flagged Today (M002, confidence ≥ 0.75)` and the `ConsolidationPromptInput` JSDoc says "contradictions is filtered to `confidence >= 0.75` within the day window by the engine." But:
- `src/db/schema.ts:195-204` defines the `contradictions` table with no `confidence` column (it exists on `relational_memory` at L139 — different table).
- `src/episodic/sources.ts::getContradictionsForDay` does not filter on confidence (only on `detectedAt` window + `status = 'DETECTED'`).
- This is correctly documented in an unrelated test file (`synthetic-fixture.test.ts:1039-1083`): "The plan describes 'confidence >= 0.75' but the contradictions table has NO confidence column. The M002 confidence threshold is enforced at WRITE time."

So the invariant holds at the DB layer by construction, but the prompt text and sources.ts comment are misleading to a future maintainer who will look for a filter that doesn't exist.

**Fix:** Either (a) drop the "confidence ≥ 0.75" phrase from the prompt header and JSDoc (replace with "M002-flagged"), or (b) add a grep-assertable comment in `sources.ts::getContradictionsForDay` pointing future readers to the write-time enforcement:
```ts
// NOTE: contradictions table has no `confidence` column. The M002
// confidence ≥ 0.75 threshold is enforced at INSERT time by
// src/pensieve/contradiction-detector.ts (only rows with confidence
// ≥ 0.75 ever get inserted with status='DETECTED'). Reading by
// status='DETECTED' is therefore the correct proxy for the threshold.
```

### IN-02: `consolidate.test.ts` Test 10 does not actually exercise the v3↔v4 drift safety net

**File:** `src/episodic/__tests__/consolidate.test.ts:473-502`
**Issue:** Test 10 is named "retry: first parse fails, retry succeeds" and rejects the first mock with a synthetic `ZodError([...])`. But this ZodError is manufactured in the test — it never touched the v4 schema's internal parser. The test proves the retry wrapper's control flow (first-throws → second-succeeds), but it does NOT prove that the localized v4 schema matches the v3 schema's constraints. If the v4 mirror ever drifts from v3 (e.g. v3 tightens `topics.max(10)` to `.max(5)`), Test 10 would still pass — the test only checks that a thrown error is caught and the retry runs.

The v3 schema acts as the safety net in step 8 (`parseEpisodicSummary`), so drift would eventually surface — but only via Test 12 (out-of-range importance), which is narrow. The v4 mirror comment at `consolidate.ts:70-74` says "Both schemas MUST stay in lock-step" but there's no automated enforcement.

**Fix:** Add a direct equivalence test in a dedicated describe block:
```ts
describe('EpisodicSummarySonnetOutputSchemaV4 drift from v3', () => {
  // Both schemas must reject/accept the same payloads.
  const cases = [
    { input: { summary: 'x'.repeat(50), importance: 0, topics: ['a'], emotional_arc: 'x', key_quotes: [] }, valid: false },
    { input: { summary: 'x'.repeat(50), importance: 11, topics: ['a'], emotional_arc: 'x', key_quotes: [] }, valid: false },
    { input: { summary: 'x'.repeat(49), importance: 5, topics: ['a'], emotional_arc: 'x', key_quotes: [] }, valid: false },
    { input: { summary: 'x'.repeat(50), importance: 5, topics: [], emotional_arc: 'x', key_quotes: [] }, valid: false },
    { input: { summary: 'x'.repeat(50), importance: 5, topics: ['a'], emotional_arc: 'x', key_quotes: [] }, valid: true },
  ];
  for (const c of cases) {
    const v3 = EpisodicSummarySonnetOutputSchema.safeParse(c.input).success;
    const v4 = EpisodicSummarySonnetOutputSchemaV4.safeParse(c.input).success;
    expect(v3).toBe(c.valid);
    expect(v4).toBe(c.valid);
    expect(v3).toBe(v4);
  }
});
```
Keep the test in `consolidate.test.ts` so future `types.ts` edits that are not propagated to the v4 mirror fail CI immediately.

### IN-03: Log payload inconsistency — `notify.ts` passes full `error`, `consolidate.ts` step 10 drops stack

**File:** `src/episodic/consolidate.ts:320-326`; `src/episodic/notify.ts:52-55`
**Issue:** Two error logs for the same failure path, but they carry different payload shapes:
- `consolidate.ts:321` — `err: err instanceof Error ? err.message : String(err)` — only the message string; the stack trace is dropped.
- `notify.ts:53` — `err: error` — the full Error object; pino will serialize `.stack`.

For forensic debugging, the notify.ts log line (which always fires after the consolidate.ts one) has the full stack; the consolidate.ts line doesn't. Minor cosmetic inconsistency, but a future log aggregator that alerts on the `episodic.consolidate.error` topic will miss the stack.

**Fix:** Align to always pass the Error object (pino's default serializers handle both shapes):
```ts
logger.error(
  { err, summaryDate: localDateStr },
  'episodic.consolidate.error',
);
```
(Pino will serialize `err` as `{ message, stack, type }` by default if `err` is an Error; falls back to `String(err)` otherwise.)

### IN-04: `getDecisionsForDay` edge case — `createdAt` null falls through both flags

**File:** `src/episodic/sources.ts:194-209`
**Issue:** `r.createdAt` is typed `Date | null` (schema at `schema.ts:244` has `.defaultNow()` but no `.notNull()`). If a decision row exists with both `createdAt === null` AND `resolvedAt in window`, the `createdToday` flag is correctly `false` (the null-check short-circuits) — good. But such a row CAN still be returned by the WHERE clause: `or(and(gte(createdAt, start), lt(createdAt, end)), and(gte(resolvedAt, start), lt(resolvedAt, end)))`. The first `and(...)` with `createdAt === null` evaluates to `NULL` in SQL (neither true nor false), which OR'd with `true` evaluates to `true`, so the row is correctly included. This is benign — the invariant holds because `defaultNow()` makes a NULL `createdAt` impossible in practice — but the code does not assert the impossibility.

**Fix:** Add a defensive assertion or an explanatory comment:
```ts
// `createdAt` is defaulted at INSERT via `defaultNow()` — a persisted
// decision row can never have createdAt===null in practice. The null
// check in `createdToday` below is belt-and-suspenders against a
// future migration that removes the default.
```
Or tighten the schema in `db/schema.ts:244` to `.notNull()` so the TS type narrows. Low priority — no test will ever exercise this path.

### IN-05: `runConsolidate` step-10 catch logs then invokes notify which logs again — duplicate ERROR line per failure

**File:** `src/episodic/consolidate.ts:318-328`
**Issue:** The top-level catch logs `episodic.consolidate.error`, then calls `notifyConsolidationError(date, err)` which immediately logs `episodic.consolidate.notify_error` (`notify.ts:52`). Every consolidation failure produces two ERROR-level log lines with the same underlying error. This is intentional per CONS-12 ("the ERROR log is the durable record"), but it inflates the ERROR count by 2x, which makes log-volume-based alerting noisy. A future Phase 22/23 step that grafana-alerts on ERROR-rate will see double.

**Fix:** Either collapse to a single log line (notify already logs — consolidate.ts could `logger.info` the outcome and let notify own the ERROR), OR distinguish the topics clearly (current naming does this — `consolidate.error` vs `consolidate.notify_error` — just document the expected 2:1 ERROR-to-failure ratio in a comment above one of the log calls). Low priority, no runtime impact.

### IN-06: `grep -c 'assembleConsolidationPrompt'` returns 2, reported in SUMMARY as "recursion-safe export" — misleading

**File:** `src/episodic/prompts.ts:106`
**Issue:** The 21-02 SUMMARY's verification gate item #4 reads: "`grep -c 'assembleConsolidationPrompt' src/episodic/prompts.ts` ≥ 2 | PASS — returns `2` (declaration + no other usage — the function references itself via recursion-safe export, satisfying ≥2)". But the function does not reference itself; the grep returns 2 because the string `assembleConsolidationPrompt` appears in (a) the JSDoc comment at L92-105 and (b) the `export function` declaration at L106. No "recursion-safe export" exists — the function is non-recursive.

This is a SUMMARY documentation bug, not a source-code bug, and harmless to runtime. Flagging for completeness because the verification claim could mislead a future reader.

**Fix:** Update 21-02 SUMMARY verification table entry #4 to: "returns `2` (1 JSDoc reference + 1 declaration)". No code change.

---

_Reviewed: 2026-04-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
