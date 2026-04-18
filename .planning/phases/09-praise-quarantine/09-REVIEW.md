---
phase: 09-praise-quarantine
reviewed: 2026-04-18T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/chris/praise-quarantine.ts
  - src/chris/engine.ts
  - src/chris/__tests__/praise-quarantine.test.ts
  - src/chris/__tests__/engine.test.ts
findings:
  critical: 0
  warning: 3
  info: 6
  total: 9
status: issues_found
---

# Phase 09: Code Review Report (fresh standard-depth, post v2.1)

**Reviewed:** 2026-04-18T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Fresh review after the v2.1 addition of ACCOUNTABILITY to the bypass list and the two previous fix iterations (WR-01 empty-rewritten guard, IN-01 `stripFences` extraction, IN-02 regression tests). The three-mode bypass (`COACH | PSYCHOLOGY | ACCOUNTABILITY`) is consistently applied at the function boundary and honors the COACH/PSYCHOLOGY precedent as a belt-and-suspenders defense — ACCOUNTABILITY never reaches the main mode switch (PP#0/PP#1 route it pre-engine), but the guard at `praise-quarantine.ts:82` still correctly no-ops if any caller ever passes it, which matches how COACH/PSYCHOLOGY are protected.

The two previously flagged info items are resolved: `stripFences` now lives in `src/utils/text.ts` and is imported by both modules; `praise-quarantine.test.ts:117-133` explicitly locks in the empty-string and whitespace-only fallback behavior.

Three warnings surfaced on this pass, all clustered around the fail-closed invariant and prompt hygiene:

1. **WR-01 (fail-closed deviation):** the catch branch at `praise-quarantine.ts:121` returns `stripReflexiveOpener(response)`, not `response`. The docstring at line 76 says "any Haiku failure returns the original response," and the task brief explicitly restates this invariant ("if Haiku fails or times out, do NOT rewrite — return original response"). The current behavior rewrites on failure via the deterministic backstop. Either the docstring/invariant is stale or the behavior needs to loop back. Test at `praise-quarantine.test.ts:157-167` explicitly pins the current (non-fail-closed) behavior, so this is a deliberate choice that was never reconciled with the stated contract.
2. **WR-02 (stale identity in prompt):** the Haiku system prompt at line 16 still references "what John said" after the v2.0 Phase 11 John→Greg unification (PLAN.md D-11 identity grounding). The model's instruction set is inconsistent with how the rest of the system talks about the user.
3. **WR-03 (Haiku output truncation risk):** `max_tokens: 1500` on the rewrite call with no length guard on the input response. A long response that needs to fit inside 1500 output tokens can be silently truncated by Haiku, and the current code accepts any non-empty rewritten string, shipping a truncated response to the user.

Timeout boundaries: the 3s `Promise.race` at `engine.ts:343-349` is the only timeout protection. `quarantinePraise` has no intrinsic timeout, and the `Promise.race` does not abort the underlying Haiku request — the SDK call continues to completion, burning tokens after the engine has already moved on. This is noted as info, not a warning, because the user still gets a response within 3s.

## Warnings

### WR-01: Fail-closed invariant violated on Haiku error path

**File:** `src/chris/praise-quarantine.ts:116-122`
**Issue:** The function's docstring at line 76 states the never-throw contract as "any Haiku failure returns the original response." The task-level invariant (TRUST-09, D025) is the same: on failure, do not rewrite. However, the catch branch returns `stripReflexiveOpener(response)`, which DOES rewrite — it strips the leading reflexive sentence deterministically even when Haiku never executed successfully. The happy path at line 115 also post-processes the Haiku output with the same backstop, which is correct (backstop on Haiku's output). The error path applies the backstop to the ORIGINAL response, which silently becomes a non-Haiku-authored rewrite. The test at `praise-quarantine.test.ts:157-167` pins this behavior, so it is a deliberate design choice — but the docstring and the decision-log framing do not reflect it.

Two-path fix:
- **If the backstop-on-error is intentional** (which the test suggests): update the docstring to "on Haiku failure, returns a deterministically-stripped version of the original response — a deterministic backstop, not a rewrite." Update D025 context in PLAN.md to match. This is the lower-risk path given the test codifies it.
- **If the stated fail-closed invariant is intended** (strict reading of the brief): change line 121 to `return response;` and update the pinning test at `praise-quarantine.test.ts:157-167` to match.

**Fix (strict fail-closed interpretation):**
```typescript
} catch (error) {
  logger.warn(
    { error: error instanceof Error ? error.message : String(error) },
    'chris.praise_quarantine.error',
  );
  return response; // strict fail-closed — no rewrite on Haiku failure
}
```

**Fix (docstring-alignment interpretation):**
```typescript
/**
 * Post-process a Chris response to strip reflexive opening flattery via Haiku,
 * with a deterministic backstop on both the happy path (Haiku output may still
 * contain a reflexive opener) and the error path (Haiku failed, fall back to
 * the regex backstop on the original response).
 *
 * COACH / PSYCHOLOGY / ACCOUNTABILITY bypass entirely — those mode prompts
 * already forbid flattery at the prompt level.
 *
 * Never-throw contract: any Haiku failure returns a deterministically-stripped
 * version of the original response, not the verbatim original.
 */
```

### WR-02: Stale "John" reference in Haiku prompt after v2.0 identity unification

**File:** `src/chris/praise-quarantine.ts:16`
**Issue:** Line 16 of the `PRAISE_QUARANTINE_PROMPT` reads "rather than substantively engage with the content" preceded by "react warmly to or characterize what John said". Per PLAN.md D-11 and v2.0 Phase 11 (John→Greg unification), the user is Greg, not John. The rest of the system talks to/about Greg. Leaving "John" in a Haiku prompt that runs on every JOURNAL/REFLECT/PRODUCE response is:
1. An identity-grounding drift the other modes don't have
2. A minor prompt-cache invalidation risk if Haiku's cross-call behavior keys on names
3. A documentation lie — the comment and code no longer reflect the user's name

**Fix:**
```typescript
- Any opening sentence whose primary function is to react warmly to or characterize what John said, rather than substantively engage with the content.
+ Any opening sentence whose primary function is to react warmly to or characterize what Greg said, rather than substantively engage with the content.
```

### WR-03: No guard against Haiku output truncation for long responses

**File:** `src/chris/praise-quarantine.ts:89, 114`
**Issue:** `max_tokens: 1500` caps Haiku's output. The input response has no size limit at this boundary — a Sonnet response approaching the engine's 100,000-character cap (see `engine.ts:159-161`) will force Haiku to truncate its `rewritten` field. The current acceptance test at line 114 is `parsed.rewritten && parsed.rewritten.trim().length > 0`, which passes any non-empty string including a truncated one. The user then receives a response that is silently shorter than Sonnet generated, cut mid-sentence, with the Haiku JSON wrapper stripping the last token mid-word.

This is a fail-open failure mode: Haiku succeeded, the JSON parsed, but the output is corrupted. The backstop in `stripReflexiveOpener` only touches the first sentence and won't detect a truncated tail.

**Fix:** Add a length-based sanity check — if the rewritten response is materially shorter than the original minus the typical opener length (~80 chars), treat it as a Haiku failure and return the backstop-processed original:
```typescript
const afterHaiku = parsed.rewritten && parsed.rewritten.trim().length > 0
  ? parsed.rewritten
  : response;

// Truncation guard: if Haiku emitted a rewrite that's more than ~100 chars
// shorter than the original minus a typical opener, suspect truncation and
// fall back to the deterministic backstop on the original. The opener strip
// should remove at most ~80-100 chars in practice.
const TRUNCATION_SLACK = 150;
const looksTruncated =
  parsed.flattery_detected &&
  afterHaiku.length + TRUNCATION_SLACK < response.length;
if (looksTruncated) {
  logger.warn(
    { originalLen: response.length, rewrittenLen: afterHaiku.length },
    'chris.praise_quarantine.suspected_truncation',
  );
  return stripReflexiveOpener(response);
}
return stripReflexiveOpener(afterHaiku);
```

Alternative (simpler, more conservative): bump `max_tokens` to match the engine's input cap in tokens (~25k for 100k chars at 4 chars/token). The cost is negligible because Haiku only emits as many tokens as needed.

## Info

### IN-01: Haiku request is not aborted when engine-level timeout fires

**File:** `src/chris/engine.ts:343-349`
**Issue:** The `Promise.race` between `quarantinePraise(response, mode)` and a 3s `setTimeout` resolves to the original response on timeout, but the underlying `anthropic.messages.create` call inside `quarantinePraise` continues to completion. The SDK accepts an `AbortSignal` which would cut the request off cleanly. Current behavior: the user gets their response in ≤3s (correct), but Anthropic is still billed for the completion, and the late-arriving result is discarded.

**Fix:** Pass an `AbortController.signal` into the Haiku call so a timeout actually cancels the request:
```typescript
// In quarantinePraise:
export async function quarantinePraise(
  response: string,
  mode: ChrisMode,
  signal?: AbortSignal,
): Promise<string> {
  // ...
  const result = await anthropic.messages.create(
    { model: HAIKU_MODEL, max_tokens: 1500, /* ... */ },
    { signal },
  );
}

// In engine.ts:
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), QUARANTINE_TIMEOUT_MS);
try {
  response = await quarantinePraise(response, mode, controller.signal);
} finally {
  clearTimeout(timeoutId);
}
```
Not flagged as a warning because correctness is preserved — this is a cost/hygiene improvement, and performance issues are out of v1 scope.

### IN-02: No intrinsic timeout inside `quarantinePraise`

**File:** `src/chris/praise-quarantine.ts:86-115`
**Issue:** The 3s timeout lives at the engine call site (`engine.ts:343-349`). Any caller that invokes `quarantinePraise` directly without wrapping it in `Promise.race` gets no timeout protection — the Anthropic SDK's default timeout is 10 minutes. There is currently only one call site, so this is a defense-in-depth suggestion, not an active bug.

**Fix:** Consider moving the 3s timeout into `quarantinePraise` itself (via the `AbortSignal` fix in IN-01), so the never-throw / bounded-latency contract is owned by the module rather than the caller.

### IN-03: Engine `try/catch` around quarantine is defensive against a promise that cannot reject

**File:** `src/chris/engine.ts:342-359`
**Issue:** `quarantinePraise` catches its own errors internally and never throws; the `Promise.race` against a `setTimeout`-backed resolver also cannot reject (the timeout uses `resolve`, not `reject`). Therefore the engine's `try/catch` block at 342-359 can never enter the catch branch under the current implementation. This is not a bug — it is forward-looking defense — but it makes the `chris.engine.praise_quarantine.error` log line effectively dead, and the `passes through original on quarantine error` test at `engine.test.ts:1157-1169` only works because the test mocks `quarantinePraise` to reject, a state the real module cannot produce.

**Fix:** Either (a) drop the outer try/catch and rely on `quarantinePraise`'s internal never-throw contract, documenting that the contract is the load-bearing invariant, or (b) keep it and add a comment explaining that it guards against future contract violations.

### IN-04: Missing log on bypass path

**File:** `src/chris/praise-quarantine.ts:82-84`
**Issue:** When mode is `COACH | PSYCHOLOGY | ACCOUNTABILITY`, the function returns without emitting any log. In production, there is no way to verify from logs whether bypass is actually firing for the bypass modes vs. whether the function simply wasn't called — both appear identical. This matters for the v2.1 ACCOUNTABILITY addition because it is the newest member of the bypass set and the most likely to regress.

**Fix:** Add a single debug log:
```typescript
if (mode === 'COACH' || mode === 'PSYCHOLOGY' || mode === 'ACCOUNTABILITY') {
  logger.debug({ mode }, 'chris.praise_quarantine.bypass');
  return response;
}
```

### IN-05: `parsed.rewritten` is not schema-validated

**File:** `src/chris/praise-quarantine.ts:102-111`
**Issue:** `JSON.parse(cleaned)` is assigned to a typed local `parsed: { flattery_detected: boolean; rewritten: string }`, but TypeScript's assertion does not validate the shape at runtime. Haiku could return `{"flattery_detected": "true", "rewritten": 42}` (wrong types) or `{"ok": true}` (wrong keys) — both would parse successfully, and the truthiness check at line 114 would coincidentally handle the second case but not the first. A non-string `rewritten` (e.g., number or object) would propagate downstream and crash in `stripReflexiveOpener` when `.trimStart()` is called.

**Fix:** Add minimal runtime validation after parse:
```typescript
try {
  parsed = JSON.parse(cleaned);
} catch {
  /* ... */
}
if (typeof parsed?.rewritten !== 'string' || typeof parsed?.flattery_detected !== 'boolean') {
  logger.warn({}, 'chris.praise_quarantine.schema_mismatch');
  return response;
}
```

### IN-06: Module-level `__resetSurfacedContradictionsForTests` splits the import block

**File:** `src/chris/engine.ts:63-66`
**Issue:** The test-only reset helper is defined between `filterAlreadySurfaced`/`markSurfaced` (lines 48-60) and the rest of the imports (lines 66-75). This is harmless but breaks the convention of putting all imports at the top of the file, which affects readability and makes the file's import graph harder to scan. Also, `import type { ChrisMode } from './personality.js';` at line 66 appears below function definitions.

**Fix:** Move the `import type { ChrisMode }` import up to the import block (lines 1-24) and relocate `__resetSurfacedContradictionsForTests` to the end of the file alongside other test-only exports, or group it with the `surfacedContradictions` helpers under a clearly-marked test-only section.

---

_Reviewed: 2026-04-18T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
