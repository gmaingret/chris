---
phase: 21-consolidation-engine
fixed_at: 2026-04-18T00:00:00Z
review_path: .planning/phases/21-consolidation-engine/21-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 6
status: partial
---

# Phase 21: Code Review Fix Report

**Fixed at:** 2026-04-18
**Source review:** `.planning/phases/21-consolidation-engine/21-REVIEW.md`
**Iteration:** 1

**Summary:**
- In-scope findings (warnings): 2
- Fixed: 2 (WR-01 applied; IN-01 comment added as trivial win)
- Deferred: 1 (WR-02 — documented intentional design choice, tests encode contract)
- Skipped: 5 (IN-02..IN-06 — stylistic / non-trivial)

## Fixed Issues

### WR-01: `buildEntriesBlock` renders entry timestamps in UTC but labels them local

**Files modified:** `src/episodic/prompts.ts`, `src/episodic/consolidate.ts`, `src/episodic/__tests__/prompts.test.ts`
**Commit:** `fa8e7cd`
**Applied fix:**
- Added `tz: string` to `ConsolidationPromptInput` (documented as the IANA tz used to bucket entries into a calendar day).
- `buildEntriesBlock` now receives `tz` and renders each entry's HH:MM via `DateTime.fromJSDate(e.createdAt, { zone: tz })` instead of `getUTCHours()/getUTCMinutes()`.
- Block header now interpolates the tz literal (e.g. `"timestamped in Europe/Paris — 2026-04-18"`) instead of the verbatim string "config.proactiveTimezone".
- Caller `runConsolidate` in `consolidate.ts:246-252` passes the existing `tz = config.proactiveTimezone` local.
- Added Test 21 to `prompts.test.ts` asserting a `2026-04-18T21:30:00Z` entry renders as `[23:30, ...]` under `tz='Europe/Paris'` (CEST +2) — the regression test the reviewer specifically requested.

Verified: 21 prompts tests + 12 consolidate tests pass. Downstream consumers unaffected (fixture default `tz='UTC'` keeps UTC timestamps rendering as-is for existing tests).

This is a fix labeled as **"fixed: requires human verification"** because it changes the prompt content sent to Sonnet — per the prompt body the tz header text changes from the literal `"config.proactiveTimezone"` to the IANA tz string, and the per-entry HH:MM values will shift by the tz offset for any deployment with `tz != UTC`. The fix is semantically correct (the header's tz claim and the displayed time must match), but the exact prompt bytes going to Sonnet are now different — worth the operator confirming the Sonnet output quality at the next cron invocation.

### IN-01: contradictions table has no `confidence` column — documentation drift

**Files modified:** `src/episodic/sources.ts`
**Commit:** `e59d2c0`
**Applied fix:** Added a NOTE block to `getContradictionsForDay`'s JSDoc explaining that the M002 confidence ≥ 0.75 threshold is enforced at INSERT time in `contradiction-detector.ts`, and that filtering by `status='DETECTED'` here is the correct proxy. No code change — pure documentation to prevent a future maintainer from hunting for a non-existent WHERE filter.

## Deferred Issues

### WR-02: `callSonnetWithRetry` retries on all errors including non-retryable 4xx

**File:** `src/episodic/consolidate.ts:129-183`
**Reason:** This is a documented, tested, intentional design choice.

1. The JSDoc at `consolidate.ts:111-127` explicitly discusses and rejects the narrow-retry alternative: *"Discriminating between 'structured-output drift retryable' and 'rate-limit non-retryable' by error class adds fragility against minor SDK version drift; the simpler 'one retry on any throw' rule means a transient rate-limit benefits from a single retry, which is harmless on the 23:00 cron timing budget."*

2. Test 9 in `consolidate.test.ts:440-468` **encodes the contract**: on rate-limit errors, `mockAnthropicParse` is asserted to be called exactly 2 times (`initial + 1 retry`). The reviewer's Option (a) would break this test. The reviewer's own summary acknowledges "the JSDoc acknowledges this tradeoff explicitly."

3. The reviewer's Option (b) ("accept the current behavior and document the 2x multiplier is deliberate") is essentially already satisfied by the existing JSDoc.

**Recommendation:** If the user wants to revisit, the narrow-retry option is a deliberate behavior change — not a bug fix. It would require (a) editing JSDoc to reflect the new policy, (b) rewriting Test 9 around `ZodError` propagation semantics, and (c) re-auditing CONS-12's notify-on-failure latency budget. Deferred pending user judgment.

## Skipped Issues

### IN-02: v3↔v4 schema drift test missing

**File:** `src/episodic/__tests__/consolidate.test.ts`
**Reason:** New test authoring, not a "trivial one-line comment" fix. Non-blocking per reviewer. Out of scope for warning-focused pass.

### IN-03: consolidate.ts vs notify.ts error-payload inconsistency

**File:** `src/episodic/consolidate.ts:320-326` / `src/episodic/notify.ts:52-55`
**Reason:** Behavior change (serializing full Error object vs. `.message` string via pino default serializers). Both log topics are distinguishable; stack-trace payload is already present in the notify log. Non-blocking per reviewer. Out of scope.

### IN-04: `getDecisionsForDay` null-createdAt defensive comment

**File:** `src/episodic/sources.ts:194-209`
**Reason:** Reviewer explicitly said "Low priority — no test will ever exercise this path." Pure commentary. Out of scope.

### IN-05: Duplicate ERROR log per consolidation failure (2:1 ratio)

**File:** `src/episodic/consolidate.ts:318-328`
**Reason:** Reviewer: "intentional per CONS-12... Low priority, no runtime impact." Out of scope.

### IN-06: grep-count claim in 21-02 SUMMARY is misleading

**File:** 21-02 SUMMARY.md
**Reason:** Reviewer: "This is a SUMMARY documentation bug, not a source-code bug, and harmless to runtime." Planning doc, not source. Out of scope for code-review-fix.

---

_Fixed: 2026-04-18_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
