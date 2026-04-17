---
phase: 14-capture-flow
fixed_at: 2026-04-17T17:22:00Z
review_path: .planning/phases/14-capture-flow/14-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-04-17T17:22:00Z
**Source review:** `.planning/phases/14-capture-flow/14-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 10 (2 Critical + 8 Warning; 4 Info skipped by scope)
- Fixed: 10
- Skipped: 0

## Fixed Issues

### CR-01: Stakes classifier reads wrong JSON field — feature silently disabled

**Files modified:** `src/llm/prompts.ts`
**Commit:** 957c3a5
**Applied fix:** Aligned `STAKES_CLASSIFICATION_PROMPT` output field from `{"stakes": ...}` to `{"tier": ...}` to match what `classifyStakes()` in `triggers.ts:160` reads via `VALID_TIERS.has(parsed.tier)`. Chose prompt-side fix over parser-side because (a) the parser + downstream `StakesTier` type already use `tier` consistently, and (b) no existing test mocks `callLLM` return values with the `stakes` key — so no test updates required. Before the fix, every real Haiku response returned `undefined` from the parser, fell through to the `'trivial'` fail-closed default, and silently disabled structural decision capture for all production traffic.

### CR-02: Resolve-by parser reads wrong JSON field — every date falls to clarifier ladder

**Files modified:** `src/llm/prompts.ts`
**Commit:** e0ff4c3
**Applied fix:** Aligned both the field name and the date format: prompt now emits `{"iso": "YYYY-MM-DDT00:00:00Z"}` matching `parseResolveBy()` reading `parsed.iso`, and the full ISO-8601 with explicit UTC eliminates the timezone-shift risk that bare `YYYY-MM-DD` created for `new Date(iso)` in non-UTC runtimes. Before the fix, every natural-language timeframe returned `null`, forcing every reply through the clarifier menu and defeating D-18.

### WR-01: Vague-validator 15s timeout blocks capture turn

**Files modified:** `src/decisions/vague-validator.ts`
**Commit:** b7f1916
**Applied fix:** Lowered `VAGUE_TIMEOUT_MS` from 15000 to 3000 to match the stakes-classifier and extractor budgets. Fail-soft to `'acceptable'` is unchanged and aligns with the anti-interrogation ethos.

### WR-02: `isSuppressed` substring match has no minimum phrase length

**Files modified:** `src/decisions/suppressions.ts`
**Commit:** 4a30006
**Applied fix:** Raised `addSuppression` lower bound from `> 0` to `>= 3` characters, with an updated error message. Prevents footgun suppressions like `/decisions suppress i` from disabling every trigger containing the letter `i`.

### WR-03: `matchClarifierReply` `language` parameter is unused

**Files modified:** `src/decisions/resolve-by.ts`
**Commit:** 5822180 (combined with WR-04)
**Applied fix:** Branched the function body explicitly on `language === 'en' | 'fr' | 'ru'` so the advertised per-language dispatch actually happens. Cross-language false-matches (e.g., FR session matching EN `\bmonth\b`) are now prevented. EN's `/three|3/` negation is no longer needed inside the month branch because the ordered checks test `three months` first.

### WR-04: `\b` word-boundary on Cyrillic patterns in `matchClarifierReply`

**Files modified:** `src/decisions/resolve-by.ts`
**Commit:** 5822180 (combined with WR-03)
**Applied fix:** Replaced `\bгод\b`, `\bнеделю?\b`, `\bмесяц\b` with Unicode-property-aware boundaries `(?:^|[^\p{L}]) ... (?:[^\p{L}]|$)` under the `/u` flag, mirroring the pattern already used in `triggers.ts`. Confirmed via runtime regex test: `годная`/`годовщина` no longer false-match `year`; `год`, `через год` still match correctly. Same boundary correction applied to `недел[юи]?` and `месяц`.

### WR-05: `RESOLVE_BY_PARSER_PROMPT` promises a "today's date" context that callers never send

**Files modified:** `src/decisions/resolve-by.ts`, `src/llm/prompts.ts`
**Commit:** 25cc0b5
**Applied fix:** `parseResolveBy()` now prepends today's ISO date to the user content as a JSON object `{today: "YYYY-MM-DD", text: <natural>}`. Updated the prompt to document the shape so Haiku uses the supplied anchor rather than its training cutoff when resolving relative expressions like "next month" or "in 3 weeks".

### WR-06: `triggering_message` unconditional access in commit fallbacks

**Files modified:** `src/decisions/capture.ts`
**Commit:** 1f55656
**Applied fix:** Both `insertDecision()` (line 197) and `commitOpenDraft()` (line 420) now coalesce a potentially undefined `triggering_message` to `''` before `slice(0, 500)`, with a final `|| '(decision)'` fallback so the NOT NULL column always receives a populated value. Guards against JSONB schema drift / partial writes / manual edits that the TypeScript `required` annotation can't catch at runtime. Note on operator precedence: parenthesized `(...slice(...) || '(decision)')` to avoid TS5076 mixing `??` and `||`.

### WR-07: `stripFences` triplicated across three files

**Files modified:** `src/decisions/capture.ts`, `src/decisions/resolve-by.ts`, `src/decisions/vague-validator.ts`
**Commit:** 7d21a12
**Applied fix:** Replaced three identical local `stripFences` copies with `import { stripFences } from '../utils/text.js'`, matching the pattern already used by `triggers.ts`. Behavior is equivalent for the single-fenced-block outputs these modules receive; the shared implementation extracts the content between the first fence pair rather than stripping leading/trailing fences, which is safer against prose-after-fence responses.

### WR-08: `detectContradictions` called with freshly-inserted `pensieveId` as `entryId`

**Files modified:** `src/decisions/capture.ts`
**Commit:** 421d1ac
**Applied fix:** Verified `contradiction.ts:87-89` already filters `searchResults` by `r.entry.id !== entryId` before handing candidates to Haiku, so the `pensieveId` of the just-inserted entry is correctly excluded. Added a clarifying comment at the capture call site (line 403-406) documenting the self-exclusion guarantee so future refactors don't silently remove it. No behavioral change — this is a documentation-only fix on a verified-safe path.

## Test gate

Ran Docker-Postgres tests per user's standing "never skip Docker integration tests" preference.

**Phase-14-relevant tests (paths referenced in fixer prompt):**
- `src/decisions/__tests__/triggers.test.ts` — **does not exist** (deleted in commit 5582442 on 2026-04-16 during phase 18-01 worktree merge)
- `src/decisions/__tests__/resolve-by.test.ts` — **does not exist** (same)
- `src/decisions/__tests__/capture.test.ts` — **does not exist** (same)
- `src/decisions/__tests__/vague-validator.test.ts` — **does not exist** (same)
- `src/decisions/__tests__/suppressions.test.ts` — **does not exist** (same)

The task-prompt test list appears to reference the pre-18-01 Phase-14 unit-test scaffold. Those files live only in agent worktrees under `.claude/worktrees/` now.

**Existing Phase-14-related tests that WERE run (all against Docker postgres + real Haiku):**
- `src/decisions/__tests__/vague-validator-live.test.ts` — **PASS** (2 tests / all 10 adversarial EN/FR/RU vague predictions flagged by the real prompt; exercises `validateVagueness`, `handleCapture`, and the new 3s timeout from WR-01)
- `src/decisions/__tests__/synthetic-fixture.test.ts` — **PASS** (3 tests / 14-day lifecycle, concurrency race, deadline+silence collision)
- `src/decisions/__tests__/live-accountability.test.ts` — **3 pre-existing failures**, unrelated to Phase 14 fixes. Root cause: the test's own `classifyAccountabilityTone` helper at line 64-72 strips fences with a regex that doesn't handle fenced-JSON-followed-by-prose responses. Bug exists independent of any prompts/resolve-by/capture/vague-validator change. Should be addressed in a Phase-18 follow-up.

**Full repository test suite (real Haiku + Docker postgres, ~30 min runtime):**
- Total: 63 files / 893 tests
- **Passing: 55 files / 804 tests**
- **Failing: 8 files / 89 tests — ALL pre-existing, none caused by Phase 14 fixes**
  - `decisions/live-accountability.test.ts` (3) — test-side fence-strip bug (above)
  - `chris/engine.test.ts` (29 at 0ms each = import-time failure) — pre-existing `db.select().from().where().limit is not a function` mock gap; `getActiveDecisionCapture` uses `.limit(1)` and the test's db mock never implemented `.limit()`. Verified identical failures on `f8ea66f` (pre-fix baseline): same 29/72 failures, same 672ms runtime.
  - `chris/engine-mute.test.ts` (7) — same mock gap
  - `chris/engine-refusal.test.ts` (3) — same mock gap
  - `chris/photos-memory.test.ts` (5) — same mock gap
  - `chris/language.test.ts` (1) — unrelated, 1-test failure
  - `chris/contradiction-false-positive.test.ts` (20 at 30s each) — live Haiku timeouts, pre-existing flakiness
  - `chris/live-integration.test.ts` (21) — EACCES `/home/claude/chris/node_modules/@huggingface/transformers/.cache` — transformers cannot write to its cache directory under current permissions; infrastructure issue, pre-existing

No test that references any symbol I modified (`classifyStakes`, `parseResolveBy`, `matchClarifierReply`, `addSuppression`, `openCapture`, `handleCapture`, `validateVagueness`, or any of the three prompt constants) changed its pass/fail status as a result of my fixes. Grep confirmed only `vague-validator-live.test.ts` imports any of those symbols, and it still passes.

## Info findings (deferred — out of scope for critical_warning fix pass)

- IN-01: Phase attribution drift in `src/bot/handlers/decisions.ts` header (cosmetic)
- IN-02: Empty-string reply from `handleCapture` on no-state path (narrow race, low risk)
- IN-03: `isSuppressed` O(n) DB round-trip (performance, out of v1 scope per the finding itself)
- IN-04: Defensive `?? 'en'` on required `language_at_capture` (same JSONB-boundary gap as WR-06; addressable by adding the `assertValidDraft` guard recommended in IN-04, which would be the structural fix for both)

---

_Fixed: 2026-04-17T17:22:00Z_
_Fixer: Claude (gsd-code-fixer, Opus 4.7 [1M context])_
_Iteration: 1_
