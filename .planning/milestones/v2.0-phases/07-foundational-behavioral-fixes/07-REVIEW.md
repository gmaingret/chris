---
phase: 07-foundational-behavioral-fixes
reviewed: 2026-04-18T06:45:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - src/chris/engine.ts
  - src/chris/language.ts
  - src/chris/refusal.ts
  - src/chris/personality.ts
  - src/chris/modes/coach.ts
  - src/chris/modes/interrogate.ts
  - src/chris/modes/journal.ts
  - src/chris/modes/photos.ts
  - src/chris/modes/produce.ts
  - src/chris/modes/psychology.ts
  - src/chris/modes/reflect.ts
  - src/llm/prompts.ts
  - src/chris/__tests__/engine.test.ts
  - src/chris/__tests__/engine-refusal.test.ts
  - src/chris/__tests__/language.test.ts
  - src/chris/__tests__/coach.test.ts
  - src/chris/__tests__/interrogate.test.ts
  - src/chris/__tests__/personality.test.ts
  - src/chris/__tests__/produce.test.ts
  - src/chris/__tests__/psychology.test.ts
  - src/chris/__tests__/reflect.test.ts
  - src/chris/__tests__/refusal.test.ts
findings:
  critical: 2
  warning: 2
  info: 5
  total: 9
status: issues_found
---

# Phase 7: Code Review Report (fresh standard-depth pass)

**Reviewed:** 2026-04-18
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Phase 7 was shipped 2026-04-13 and the prior `07-REVIEW.md` (iteration 3) closed clean.
This fresh pass reviews the files as they sit on disk today (HEAD `6016926`) after v2.0
and v2.1 work — in particular, v2.1 Phase 14 added a decision-capture pre-processor
(PP#0) at the very top of `processMessage`, and Phase 19 restored the proactive pipeline.
Neither phase updated the Phase 7 unit tests.

The Phase 7 source code itself (refusal detector, language detector, constitutional
preamble, JOURNAL question pressure) is intact, coherent with the PLAN.md D020/D021/D022/
D024/D027 decisions, and its isolated unit tests (`refusal.test.ts`, `personality.test.ts`)
still pass. The live regressions sit in two places:

1. A real behavioral divergence between `detectLanguage(shortText, null)` and its
   Phase-7-era unit test — a deliberate D021 spec drift that was never reconciled in
   either direction.
2. An unmocked db-chain signature mismatch that, on current HEAD, breaks 29/72
   `engine.test.ts` cases plus all 3 `engine-refusal.test.ts` cases. These tests are
   Phase 7's primary orchestration contract.

Both are Critical because they mean Phase 7's own verification surface is no longer
green on `bash scripts/test.sh`. The v2.1 milestone audit's "152 tests pass" claim
refers to a scoped subset (`src/proactive/__tests__/` + one synthetic-fixture file);
the Phase 7 engine tests were not in that subset and the regression went undetected.

Tests were executed via `bash scripts/test.sh` against the full Docker Postgres gate
per project discipline; both failure modes reproduce there identically to a bare
`npx vitest run` call (the mocks short-circuit the DB before Postgres is reached).

## Critical Issues

### CR-01: `detectLanguage('ok', null)` returns `null` but its test asserts `'English'`

**File:** `src/chris/language.ts:29-36`, `src/chris/__tests__/language.test.ts:32-35`

**Issue:** `detectLanguage` was deliberately changed (comment at `language.ts:30-32`
reads: "Defaulting to English here mis-anchors multilingual sessions (e.g. 'Salut'
with no prior)") to return `previousLanguage` unchanged for short messages — which
means `null` when no prior language exists. The unit test still asserts the
old D021-spec behavior:

```ts
it('defaults to English when no previous language and short msg', () => {
  const lang = detectLanguage('ok', null);
  expect(lang).toBe('English');
});
```

Running `bash scripts/test.sh src/chris/__tests__/language.test.ts` produces:
```
AssertionError: expected null to be 'English' // Object.is equality
```

PLAN.md D021 still reads: "Messages below 4 words or 15 characters inherit the
language of the previous user message in the conversation. **Default to English
only if no prior user message exists.**" The implementation no longer honors that
default.

This is Critical because: (a) the test is red on HEAD, (b) the spec and code
disagree so downstream callers cannot know which is authoritative, and (c) the
engine's refusal-path uses `language ?? 'English'` at `engine.ts:271` as its own
fallback — meaning the refusal ack still defaults to English — but the normal
mode-dispatch path at `engine.ts:281` passes `undefined` to the handler, which
then calls `buildSystemPrompt` with `language=undefined` and the model inherits
its language behavior from the mode prompt rather than the Language Directive.
For a short first message like "ok" or "да", the behavior diverges from the
stated PLAN.md contract without anyone having flagged the change.

**Fix:** Pick one source of truth and align the other.

Option A (match the PLAN.md D021 spec — restore English default):
```ts
// src/chris/language.ts:29
export function detectLanguage(text: string, previousLanguage: string | null): string | null {
  const words = text.trim().split(/\s+/);
  if (words.length < 4 || text.trim().length < 15) {
    return previousLanguage ?? 'English';
  }
  // ...franc block unchanged
}
```

Option B (keep current "inherit-or-null" behavior — update PLAN.md + test):
```ts
// src/chris/__tests__/language.test.ts:32-35
it('returns null when no previous language and short msg (so prompts stay un-anchored)', () => {
  const lang = detectLanguage('ok', null);
  expect(lang).toBeNull();
});
```
…and update PLAN.md D021 to read "Return null if no prior user message exists
so the mode prompt's own language rules govern."

Option B is the more defensible runtime behavior (the comment's multilingual
argument is sound), but it MUST be accompanied by a PLAN.md D021 update and the
test rewrite. Leaving both disagreeing is the bug.

### CR-02: 32 engine/engine-refusal tests fail on HEAD — db mock chain missing `.limit()` after `.where()`

**File:** `src/chris/__tests__/engine.test.ts:8-13`, `src/chris/__tests__/engine-refusal.test.ts:10-27`
(both reference the same root cause)

**Issue:** Both test files mock `db.connection` with a select chain of
`select → from → where → orderBy → limit`. v2.1 Phase 14 added a call to
`getActiveDecisionCapture(chatId)` at `engine.ts:168` as the first step of
`processMessage` (PP#0). `getActiveDecisionCapture` in
`src/decisions/capture-state.ts:41-48` chains `select → from → where → limit`
**without `orderBy`**. That's a different shape than the mock:

```ts
// capture-state.ts:41-48 (runtime)
const rows = await db
  .select()
  .from(decisionCaptureState)
  .where(eq(decisionCaptureState.chatId, chatId))
  .limit(1);  // ← called directly on where() result

// engine.test.ts:8-13 (mock)
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockSelectWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
// ← mockSelectWhere returns an object with `orderBy` but no `limit`
```

Running `bash scripts/test.sh src/chris/__tests__/engine.test.ts` on HEAD
produces 29 failures of the form:
```
TypeError: db.select(...).from(...).where(...).limit is not a function
 ❯ getActiveDecisionCapture decisions/capture-state.ts:46:6
 ❯ processMessage chris/engine.ts:168:33
```

Every `processMessage` test is affected: mode routing (JOURNAL / INTERROGATE /
REFLECT / COACH / PSYCHOLOGY / PRODUCE), contradiction surfacing,
`writeRelationalMemory` gating, praise-quarantine gating, saved-message shape.
The same failure hits all 3 `engine-refusal.test.ts` cases for the same reason.

The isolated `refusal.test.ts`, `language.test.ts` (minus CR-01),
`personality.test.ts`, and the five `modes/*.test.ts` files still pass — they
never exercise `processMessage`.

This is Critical because: (a) these are the Phase 7 orchestration contract
tests, (b) they are red on HEAD on a clean `bash scripts/test.sh` run, and
(c) the v2.1 milestone audit's "152 tests PASS" gate is a scoped subset
(`src/proactive/__tests__/` + `src/decisions/__tests__/synthetic-fixture.test.ts`)
that explicitly doesn't include these files, so the regression was masked.
Comparable sibling test files (`engine-mute.test.ts`, `photos-memory.test.ts`)
have the same failure class — confirming this is systemic test-scaffold drift,
not isolated to Phase 7.

Note commit `b0cdc50` ("fix(14): add decision capture mocks to engine-mute,
engine-refusal, photos-memory tests") mentions adding mocks to those three
files — but inspection of `engine-refusal.test.ts` on HEAD shows it does NOT
mock `capture-state.js` / `capture.js` / `triggers.js` / `suppressions.js` /
`resolution.js`. The mock additions must have been dropped or incomplete.

**Fix:** Add the missing `.limit` branch to the select mock AND mock the
decision-capture modules in both test files. Two edits:

1. `src/chris/__tests__/engine.test.ts:8-13` — extend the mock chain so
   `.where()` returns BOTH `{ orderBy, limit }`:
```ts
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
// Support BOTH select→from→where→orderBy→limit AND select→from→where→limit
const mockSelectWhere = vi.fn(() => ({ orderBy: mockOrderBy, limit: mockLimit }));
const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
```

2. Mock the decision-capture imports that `engine.ts` now pulls in so they
   never hit the db layer during unit tests:
```ts
// src/chris/__tests__/engine.test.ts (and engine-refusal.test.ts)
vi.mock('../../decisions/capture-state.js', () => ({
  getActiveDecisionCapture: vi.fn().mockResolvedValue(null),
  clearCapture: vi.fn(),
  isAbortPhrase: vi.fn().mockReturnValue(false),
  coerceValidDraft: vi.fn((d) => d),
}));
vi.mock('../../decisions/capture.js', () => ({
  handleCapture: vi.fn(),
  openCapture: vi.fn(),
}));
vi.mock('../../decisions/resolution.js', () => ({
  handleResolution: vi.fn(),
  handlePostmortem: vi.fn(),
}));
vi.mock('../../decisions/triggers.js', () => ({
  detectTriggerPhrase: vi.fn().mockReturnValue(null),
  classifyStakes: vi.fn().mockResolvedValue('trivial'),
}));
vi.mock('../../decisions/suppressions.js', () => ({
  isSuppressed: vi.fn().mockResolvedValue(false),
}));
```

After these changes, all 29 `engine.test.ts` + 3 `engine-refusal.test.ts`
failures should resolve. `engine-mute.test.ts` and `photos-memory.test.ts`
(outside Phase 7 scope but hitting the same failure) would benefit from the
same treatment.

## Warnings

### WR-01: `userMessageSaved` flag is dead — written to three times, never read

**File:** `src/chris/engine.ts:288,291,322,327`

**Issue:** The local `let userMessageSaved = false` is assigned `true` in three
places (`line 291` for non-PHOTOS/ACCOUNTABILITY branch, `line 322` for PHOTOS
hit, `line 327` for PHOTOS fallback to JOURNAL) and then never consulted. The
function ends at line 424 without a single `if (!userMessageSaved)` guard or
`return userMessageSaved` call.

The variable looks like scaffolding from an earlier draft where the PHOTOS
fallback was perhaps meant to guard a final "save if not yet saved" step. As
currently written it is pure dead code, which hides intent: a future reader
cannot tell whether a missing save path is a latent bug or intentional.

**Fix:** Delete the variable and its three assignments:

```ts
// src/chris/engine.ts:287-292 — remove `let userMessageSaved` and the assignment
if (mode !== 'PHOTOS' && mode !== 'ACCOUNTABILITY') {
  await saveMessage(chatId, 'USER', text, mode);
}

// Lines 315-332 inside the PHOTOS case — remove the `userMessageSaved = true`
// lines at both 322 and 327. The saves themselves stay.
```

If the intent was to guard against double-saves in the PHOTOS fallback (the
fallback at line 326 saves with mode `'JOURNAL'`, and if `mode === 'PHOTOS'`
the outer guard at line 289 already skipped the normal save — so there's no
double-save here), that invariant should be expressed as a comment rather than
an unused variable.

### WR-02: `formatContradictionNotice` is hardcoded English in a three-language system

**File:** `src/chris/personality.ts:174-191`

**Issue:** The function signature accepts `_language?: string` (underscore
signals "received but unused") and emits an English-only notice regardless of
the active conversation language:

```ts
return `💡 I noticed something — back on ${dateStr}, you said "${preview}" ${c.description} Not judging either way — people change, and both can be true at different times. What do you think?`;
```

`engine.ts:375` correctly forwards the detected language (`formatContradictionNotice(filtered, language)`),
so the plumbing is in place — the implementation just ignores it. For a Russian
conversation, the mid-response English break ("back on March 15, 2025, you
said... What do you think?") is jarring and violates the same-language contract
that every mode prompt enforces at `prompts.ts:20/46/119/146/174/203`.

Contradiction surfacing is specifically called out in PLAN.md D006 and is
expected to fire often once v2.0 grounding stabilizes — this means the visible
language-break will be frequent, not edge-case.

This is Warning rather than Critical because the behavior "works" (the notice
renders; the user sees the contradiction), it's just linguistically incoherent.

**Fix:** Either localize the template or explicitly document that contradiction
notices are English-only by contract. Minimal localization:

```ts
const NOTICE_TEMPLATES = {
  English: (date: string, content: string, desc: string) =>
    `💡 I noticed something — back on ${date}, you said "${content}" ${desc} Not judging either way — people change, and both can be true at different times. What do you think?`,
  French: (date: string, content: string, desc: string) =>
    `💡 Je remarque quelque chose — le ${date}, tu as dit « ${content} ». ${desc} Sans jugement — les gens évoluent, et les deux peuvent être vrais à des moments différents. Qu'est-ce que tu en penses ?`,
  Russian: (date: string, content: string, desc: string) =>
    `💡 Я кое-что заметил — ${date} ты сказал: «${content}». ${desc} Без осуждения — люди меняются, и оба варианта могут быть верны в разное время. Что ты об этом думаешь?`,
};

export function formatContradictionNotice(
  contradictions: DetectedContradiction[],
  language?: string,
): string {
  if (contradictions.length === 0) return '';
  const template = NOTICE_TEMPLATES[language as keyof typeof NOTICE_TEMPLATES]
    ?? NOTICE_TEMPLATES.English;
  const notices = contradictions.map((c) => {
    const dateStr = c.entryDate.toLocaleDateString(
      language === 'French' ? 'fr-FR' : language === 'Russian' ? 'ru-RU' : 'en-US',
      { year: 'numeric', month: 'long', day: 'numeric' },
    );
    const preview = c.entryContent.length > 120
      ? c.entryContent.slice(0, 117) + '...'
      : c.entryContent;
    return template(dateStr, preview, c.description);
  });
  return '\n\n---\n' + notices.join('\n\n');
}
```

The `c.description` field still comes back from Haiku in whatever language the
detection prompt emitted — a follow-up could have the detector emit per-language
descriptions too, but that's a deeper change than this fix.

## Info

### IN-01: `buildSystemPrompt` parameter overload for ACCOUNTABILITY is documented but type-unsafe

**File:** `src/chris/personality.ts:78-143`

**Issue:** The JSDoc at lines 78-87 and the in-case comment at lines 128-138
explain that for `mode='ACCOUNTABILITY'`, the `pensieveContext` parameter slot
carries the decision context and the `relationalContext` slot carries the
temporal Pensieve window — an inversion of the normal meaning. This is an
invitation for a future caller to pass arguments in the wrong slot with no type
system to catch it; both slots are `string | undefined`.

**Fix:** Not urgent; comment is explicit. For v2.2+, consider a discriminated-union
overload:
```ts
export function buildSystemPrompt(mode: 'ACCOUNTABILITY', ctx: {
  decisionContext: string;
  pensieveContext: string;
  language?: string;
  declinedTopics?: DeclinedTopic[];
}): string;
export function buildSystemPrompt(
  mode: Exclude<ChrisMode, 'ACCOUNTABILITY'>,
  pensieveContext?: string,
  relationalContext?: string,
  language?: string,
  declinedTopics?: DeclinedTopic[],
): string;
```

### IN-02: Language directive stated twice when active — once in mode prompt, once in personality.ts

**File:** `src/llm/prompts.ts:20,46,119,146,174,203`; `src/chris/personality.ts:152-154`

**Issue:** Every mode prompt bakes in `"ALWAYS respond in the same language Greg
uses."` as a rule. When `language` is non-null, `buildSystemPrompt` ALSO appends
`## Language Directive (MANDATORY)\nRespond in ${language} only. This overrides
any language signals in conversation history.` The combination is deliberately
belt-and-suspenders per LANG-03 but also adds ~30 tokens per prompt cache hit.

**Fix:** None required — this is intentional redundancy per LANG-03 and caching
amortizes the cost. Noting for future prompt-length audits.

### IN-03: `DETECTION_TIMEOUT_MS` and `QUARANTINE_TIMEOUT_MS` are function-scoped magic numbers

**File:** `src/chris/engine.ts:343,365`

**Issue:** Both are `3000` (3 seconds), both are defined inside their function
bodies rather than at module scope alongside `SURFACED_TTL_MS`. They document
themselves via name, but module-level hoisting would make them easier to tune
and compare against PLAN.md D006 ("3-second timeout on contradiction detection").

**Fix:**
```ts
// Top of engine.ts near SURFACED_TTL_MS
const CONTRADICTION_TIMEOUT_MS = 3000;  // PLAN.md D006
const PRAISE_QUARANTINE_TIMEOUT_MS = 3000;
```

### IN-04: PLAN.md D021 disagrees with `detectLanguage` implementation

**File:** `PLAN.md` (D021 row) vs `src/chris/language.ts:29-36`

**Issue:** See CR-01 above for details — flagging separately as an Info-level
documentation cleanup because the discrepancy affects more than the test: any
future contributor reading D021 will expect English default and be surprised by
the runtime.

**Fix:** Bundled with CR-01 fix Option B — update PLAN.md D021 row to match
runtime, or restore the English default to match PLAN.md.

### IN-05: `generateRefusalAcknowledgment` uses `Math.random()` — non-deterministic tests

**File:** `src/chris/refusal.ts:190-193`

**Issue:** Picks an acknowledgment uniformly at random. The three existing
`refusal.test.ts` cases only assert `result.isRefusal === true` so the
randomness doesn't flake tests, but any future "asserts exact acknowledgment
text" test would be flaky. Not a security issue (acknowledgment variety is not
security-sensitive).

**Fix:** None required. If determinism becomes needed later, inject an RNG or
use a round-robin counter keyed on chatId.

---

_Reviewed: 2026-04-18T06:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Test evidence: `bash scripts/test.sh src/chris/__tests__/language.test.ts src/chris/__tests__/engine.test.ts src/chris/__tests__/engine-refusal.test.ts` — 1 + 29 + 3 failures reproduced on Docker Postgres gate._
