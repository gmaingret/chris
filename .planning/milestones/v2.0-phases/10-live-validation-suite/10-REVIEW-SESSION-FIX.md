---
phase: 10-live-validation-suite
reviewed: 2026-04-14T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/chris/personality.ts
  - src/chris/praise-quarantine.ts
  - src/llm/prompts.ts
  - src/chris/__tests__/praise-quarantine.test.ts
  - src/chris/__tests__/live-integration.test.ts
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 10: Code Review Report (Session Fix)

**Reviewed:** 2026-04-14
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Reviewed the five files changed in this session addressing three stochastic live-integration failures. The changes are generally well-structured: `stripReflexiveOpener` has a clear contract and defensive fallbacks, the INTERROGATE verbatim rule is phrased as a rule about the model's own output (no injection surface expanded), the declined-topic strengthening is additive, and the 90s timeout raises match sibling tests.

The findings below are concentrated in `praise-quarantine.ts`:

1. A real behavior regression for COACH/PSYCHOLOGY: these modes previously returned the response untouched but now run `stripReflexiveOpener`, which can drop a legitimate substantive first sentence that happens to begin with "Beautiful", "Lovely", "Oh", etc. in COACH/PSYCHOLOGY. Given that the mode bypass exists explicitly because those modes handle flattery at the prompt level, reflexively trimming their first sentence weakens the contract the test-case at line 71-85 documents.
2. Ambiguous sentence-boundary logic when `trimmed` contains no terminator (single-sentence reply with no `.!?\n`): the code falls through to "return response", which is the safe fallback but is at odds with the test expectation that a reflexive opener always gets stripped.
3. Two tests ("bypasses Haiku for COACH/PSYCHOLOGY") still assert `result).toBe(original)` with original = "Great question!" — but "Great" is in `REFLEXIVE_OPENER_FIRST_WORDS`, so under the new contract the backstop WILL run and the first sentence will be stripped, leaving an empty string, which triggers the "keep original to avoid empty response" guard and returns original. This passes by accident via a chain of defensive fallbacks rather than by the documented contract. Any future change to the empty-remainder guard will silently break these tests.

No critical issues found. No prompt-injection surface introduced by the new INTERROGATE verbatim rule.

## Warnings

### WR-01: COACH/PSYCHOLOGY bypass now mutates response via `stripReflexiveOpener`

**File:** `src/chris/praise-quarantine.ts:78-80`
**Issue:** The prior contract for COACH/PSYCHOLOGY was "bypass entirely — those mode prompts already forbid flattery at the prompt level" (per the comment at line 77 and SYCO-05). The new code runs `stripReflexiveOpener(response)` before returning. The opener set includes neutral tokens like `Beautiful`, `Lovely`, `Oh`, `Fantastic` that can legitimately appear as the first word of a substantive COACH/PSYCHOLOGY reply (e.g., `"Beautiful rationalization — let me push back on it."` or `"Oh, this is classic intellectualization: you're..."`). These would be silently truncated, weakening rather than preserving the mode-bypass guarantee.

This is not flagged by any test: the two bypass tests (lines 71-85) use `"Great question!"` as originals, which reach the empty-remainder guard and return the original by luck.

**Fix:** Either (a) restore the pure bypass for COACH/PSYCHOLOGY:

```ts
if (mode === 'COACH' || mode === 'PSYCHOLOGY') {
  return response;
}
```

or (b) if the intent is genuinely to backstop all modes, update the comment and the two bypass tests to assert the new mutating contract explicitly — and consider narrowing `REFLEXIVE_OPENER_FIRST_WORDS` to the unambiguously-reflexive tokens (`That`, `That's`, `Wow`, `Amazing`, `Wonderful`, `Brilliant`, `Great`) for the COACH/PSYCHOLOGY path, so a word like `Beautiful` opening a substantive coach critique is preserved.

### WR-02: `stripReflexiveOpener` returns unchanged response when first sentence has no terminator

**File:** `src/chris/praise-quarantine.ts:58-59`
**Issue:** When the reply is a single sentence with no `.`, `!`, `?`, or `\n` (e.g., `"That's amazing"` — no period), the regex `/^[^.!?\n]*[.!?\n]+\s*/` does not match and the function returns the original response. A Haiku model that emits a short one-liner without terminal punctuation will bypass the deterministic backstop. This is the opposite of the test at line 157-167, which passes because the fixture includes a period.

This is a narrow case but directly contradicts the documented purpose ("Catches stochastic misses by the Haiku rewrite").

**Fix:** Treat end-of-string as a sentence terminator:

```ts
const sentenceMatch = trimmed.match(/^[^.!?\n]*([.!?\n]+\s*|$)/);
```

Additionally add a unit test: `stripReflexiveOpener("That's amazing")` should return either `""` → original (current empty-remainder guard) OR the string trimmed. Document which.

### WR-03: Bypass tests for COACH/PSYCHOLOGY pass by accident

**File:** `src/chris/__tests__/praise-quarantine.test.ts:71-85`
**Issue:** Both tests use `original = "Great question!"` and assert `result).toBe(original)`. Under the new code path, `stripReflexiveOpener` runs, detects "Great" as a reflexive opener, matches the regex (ends with `!`), computes `remainder === ""`, hits the empty-remainder guard at line 62, and returns the original. The tests pass, but not because of the documented bypass behavior — they pass because a fallback-of-fallback kicks in. If WR-01 or the empty-remainder guard is ever changed, these tests silently break or silently hide real bugs.

**Fix:** Update the originals to exercise the bypass intent unambiguously:

```ts
const original = "Great question! Here's my honest pushback: that plan has a cash-flow hole.";
// If bypass is truly bypass: expect(result).toBe(original);
// If bypass now strips: expect(result).toBe("Here's my honest pushback: that plan has a cash-flow hole.");
```

Pick one based on the WR-01 resolution and assert it explicitly.

## Info

### IN-01: Opener sets are case-sensitive; lowercase/accented variants slip through

**File:** `src/chris/praise-quarantine.ts:31-39`
**Issue:** `REFLEXIVE_OPENER_FIRST_WORDS` uses capitalized tokens only. A Haiku rewrite that returns `"that's a great one. …"` (lowercase) or any non-English opener (`"Super…"`, `"Génial…"`, `"Замечательно…"` — relevant given the French/Russian TEST-04 cases) will not be caught. Since this is a deterministic backstop meant to survive stochastic misses, consider normalizing case:

```ts
const firstWord = tokens[0] ?? '';
const firstWordNormalized = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
```

Non-English openers are a separate product decision, but worth noting given the multilingual test matrix in `live-integration.test.ts`.

**Fix:** Add a case-insensitive match, or document the English-only scope in the function comment.

### IN-02: `stripFences` + balanced-brace parsing missing on new path

**File:** `src/chris/praise-quarantine.ts:96-107`
**Issue:** The Haiku JSON parse uses `stripFences` + `JSON.parse`. Recent commits `b9d800b` and `8382248` in this repo hardened a similar `haikuJudge` parser to tolerate "markdown fences and trailing text" with balanced JSON-brace extraction. The praise-quarantine path uses the older, stricter parser. Haiku occasionally emits `{"flattery_detected":true,"rewritten":"..."}` followed by a stray sentence; this path warns and returns the original. Not a bug per se — the never-throw contract holds — but the deterministic backstop now masks what used to be observable "Haiku returned garbage" failures, so it's a silent degradation.

**Fix:** Consider reusing whatever hardened parser `haikuJudge` now uses, for consistency.

### IN-03: `firstTwo` built from possibly-punctuated tokens

**File:** `src/chris/praise-quarantine.ts:51-54`
**Issue:** `tokens[0]` is the raw whitespace-split first token, which includes trailing punctuation (`"Wow,"`, `"That's!"`). Single-word matching uses `REFLEXIVE_OPENER_FIRST_WORDS` which contains `That's` with the apostrophe but not `That's,` with trailing comma. An opener `"Wow, what a thought."` splits to `["Wow,", "what", …]`, so `firstWord = "Wow,"` fails the set check. Since the test fixture uses a clean `"That's a fascinating idea. …"`, this is uncovered.

**Fix:** Strip trailing punctuation before set lookup:

```ts
const firstWord = (tokens[0] ?? '').replace(/[,;:!?.]+$/, '');
```

---

Notes on other changes (no findings):

- **`personality.ts:126-135`** — Declined-topics strengthening reads cleanly. The new wording "do NOT engage with them even if John himself reopens or re-raises them later" is a pure addition; the template literal correctly interpolates `topicLines`. No injection concern since `dt.topic` and `dt.originalSentence` originate from the declined-topic store, which is itself populated from user input but scoped to this same prompt — no new surface introduced by the phrasing change.
- **`prompts.ts:52`** — INTERROGATE verbatim rule is phrased as instructions to the model about its own output formatting, not a template substitution. The injection surface is unchanged: `{pensieveContext}` remains the only user-controlled interpolation point, and the new rule tells the model what to do with that content (quote verbatim). An attacker who controls pensieve content could of course still inject instruction-like text there, but that surface predates this change.
- **`live-integration.test.ts:113,130,147`** — Timeout raises from 60_000 to 90_000 ms match sibling 3-iteration Opus tests (e.g., 188, 229, 268, 425, 453, 482, 603, 631, 660). Consistent with the existing convention.

---

_Reviewed: 2026-04-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
