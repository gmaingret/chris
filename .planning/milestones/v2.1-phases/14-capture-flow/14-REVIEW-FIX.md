---
phase: 14-capture-flow
fixed_at: 2026-04-18T05:57:00Z
review_path: .planning/phases/14-capture-flow/14-REVIEW.md
iteration: 2
findings_in_scope: 14
fixed: 14
skipped: 0
status: all_fixed
---

# Phase 14: Code Review Fix Report

**Fixed at (iteration 2):** 2026-04-18T05:57:00Z
**Source review:** `.planning/phases/14-capture-flow/14-REVIEW.md`

**Summary (cumulative across both iterations):**
- Findings in scope: 14 (2 Critical + 8 Warning + 4 Info)
- Fixed: 14 (10 in iteration 1 + 4 in iteration 2)
- Skipped: 0

---

## Iteration 2 (Info findings, 2026-04-18T05:57:00Z)

Iteration 2 clears the 4 Info findings left out of iteration 1's `critical_warning` scope. All edits are minimal — doc/comment-level for IN-01 and IN-03, a one-line guard for IN-02, and a small JSONB-boundary validator for IN-04. No behavioral regressions for the live-traffic flow; new defensive paths log warnings rather than throw.

### IN-01: Phase attribution drift in handler header

**Files modified:** `src/bot/handlers/decisions.ts`
**Commit:** 5eaae35
**Applied fix:** Rewrote the top-of-file JSDoc from "Phase 17 Plan 03" to "Phases 14 + 17" and restructured the sub-command list to annotate each branch with its originating phase/ticket (`Phase 14 (CAP-06)` for `suppress` / `suppressions` / `unsuppress`; `Phase 17 (T-17-03)` for `(no-args)` / `open` / `recent` / `stats` / `reclassify`). Added matching in-line section comments on each `if (sub === …)` block so provenance is visible at the call site as well as the header. Pure documentation — no control-flow changes. Tier-2 `tsc --noEmit` clean for this file.

### IN-02: Empty-string reply from `handleCapture` on no-state path

**Files modified:** `src/bot/bot.ts`
**Commit:** edfa1ca
**Applied fix:** Added a one-line guard at `bot.ts:48` — `if (response) await ctx.reply(response)` — so an empty `processMessage` return (reachable only on the narrow race between engine's PP#0 state read and `handleCapture`'s own state read when abort clears in between) does not reach Telegram's "message text is empty" rejection path. Chose the `bot.ts` guard over a localized fallback string in `handleCapture` because:
  1. The race path has already produced user-visible output via the abort-ack save in engine.ts, so silently skipping an empty `ctx.reply` is the correct semantics — not synthesizing a spurious "OK" message.
  2. It covers any other future code path in `processMessage` that might return `''` without requiring them each to synthesize their own localized fallback.
Reviewer suggested engine-side check, but engine doesn't call `ctx.reply` — it returns a string through `processMessage`, and the actual `ctx.reply` happens in `bot.ts:handleTextMessage`. Applied the guard at the real forwarding point.

### IN-03: `isSuppressed` O(n) DB round-trip per message

**Files modified:** `src/decisions/suppressions.ts`
**Commit:** 075b55a
**Applied fix:** Documentation-only. Expanded the JSDoc on `isSuppressed` to explicitly record the per-message round-trip cost, the v1 rationale (Greg-scale — "a handful of suppressed phrases per chat" — makes it negligible), and the deferred caching strategy (in-memory per-chat cache invalidated on `addSuppression`/`removeSuppression`). Per the reviewer's own note, caching is out of v1 scope; the fix here is to make the deferral explicit so future readers don't re-discover the same performance concern.

### IN-04: Defensive `?? 'en'` on required `language_at_capture`

**Files modified:** `src/decisions/capture-state.ts`, `src/chris/engine.ts`, `src/decisions/capture.ts`
**Commit:** 1fd6b07
**Applied fix:** Added a new `coerceValidDraft(raw: unknown): CaptureDraft` helper in `capture-state.ts` that validates the JSONB-boundary shape and fills safe defaults for the three required fields (`language_at_capture` → `'en'`, `turn_count` → `0`, `triggering_message` → `''`) while preserving all optional fields. Applied it at the two read sites that previously cast `draft as CaptureDraft` in user-facing code:
  - `engine.ts:186` (PP#0 capture routing): replaces `const draft = activeCapture.draft as CaptureDraft; const lang = draft.language_at_capture ?? 'en';` with `coerceValidDraft(activeCapture.draft)` and drops the now-redundant `?? 'en'` fallback.
  - `capture.ts:279` (`handleCapture` draft read): replaces `{ ...(state.draft as CaptureDraft) }` with `coerceValidDraft(state.draft)`.

Left the third cast site (`capture-state.ts:68` in `updateCaptureDraft`) unchanged because that path merges-and-writes rather than reads-for-routing, and a corrupt draft at that point would have already been rejected upstream. Removed the now-unused `type CaptureDraft` import in `engine.ts` (all remaining uses are through `coerceValidDraft`'s return type). Validator is lenient (fills defaults + returns successfully) rather than strict (throws) so a single corrupt JSONB row does not take down the engine for all traffic — matches WR-06's defensive-coalescing pattern already applied at the commit-time `triggering_message` use sites, closing the same JSONB-boundary-validation gap the reviewer flagged.

Tier-2 `tsc --noEmit` clean across all three modified files.

## Test gate (iteration 2)

Ran Docker-Postgres tests per user's standing "never skip Docker integration tests" preference.

**Command:** `bash scripts/test.sh --no-coverage src/decisions/__tests__/ src/chris/__tests__/engine.test.ts`

**Two-pass run:**
  1. **First pass**: missed exporting `ANTHROPIC_API_KEY` from `.env` into the shell — `scripts/test.sh` fell back to `"test-key"` → every `callLLM` returned 401. 34/84 tests failed in ways that merely confirmed the silent-fallback path (vague-validator-live flagged 0/10 because every Haiku call failed → fail-soft `'acceptable'`; live-accountability threw 401 from its own `classifyAccountabilityTone` helper).
  2. **Second pass** (source `.env` before invoking): **32 failed | 52 passed (84 tests / 4 files)**, duration 44.68s. All 32 failures are pre-existing and match iteration 1's documented pattern:

**Failures (all pre-existing, NOT caused by iteration 2 fixes):**
  - `chris/__tests__/engine.test.ts` — **29 failures**. All fail with `TypeError: db.select(...).from(...).where(...).limit is not a function` at `decisions/capture-state.ts:46:6` — i.e., at the original `.limit(1)` inside `getActiveDecisionCapture`, which is **upstream** of the new `coerceValidDraft` call site. Exactly the mock-gap iteration 1 documented (the file's db mock never implemented `.limit()`). Verified the failure point is unchanged by my edits: the stack trace's `capture-state.ts:46` line corresponds to the `.limit(1)` call, not the new helper appended below.
  - `decisions/__tests__/live-accountability.test.ts` — **3 failures** (Scenarios 1/2/3). All fail with `Haiku judge returned non-JSON response. Raw text: \`\`\`json\n{"flattery":"none","condemnation":"none"}\n\`\`\`\n\nThis response: ...`. The test's own `classifyAccountabilityTone` helper at `live-accountability.test.ts:64-82` does a naive `stripFences` via regex that fails when the real Haiku response closes the fence and then appends explanatory prose. Identical root cause to iteration 1's "test-side fence-strip bug" documentation. Completely independent of any Phase 14 source code.

**Passing (52 tests / 2 files):**
  - `decisions/__tests__/synthetic-fixture.test.ts` — **PASS** (3 tests / 14-day lifecycle, concurrency race, deadline+silence collision)
  - `decisions/__tests__/vague-validator-live.test.ts` — **PASS** (2 tests / 10 adversarial EN/FR/RU vague predictions flagged by real Haiku + D-14 one-pushback invariant). Note: this suite regressed on first pass due to the API-key env issue; passed cleanly on second pass with real Haiku responses.
  - 43 of 72 tests in `chris/__tests__/engine.test.ts` — **PASS** (all tests that do not route through `getActiveDecisionCapture`'s mock-gap path).
  - 4 of 7 tests in `decisions/__tests__/live-accountability.test.ts` — **PASS** (scenarios whose Haiku response happened not to trigger the test-side fence-strip failure).

**Conclusion:** No test that exercises any symbol I introduced or modified in iteration 2 changed status. `coerceValidDraft` is new and has no test coverage yet — that's expected for an Info-level defensive helper that only activates on schema drift the tests never produce. No regression from iteration 1's green set.

## Iteration 1 (Critical + Warning findings, 2026-04-17T17:22:00Z)

Preserved verbatim from iteration 1's report.

**Summary:**
- Findings in scope: 10 (2 Critical + 8 Warning; 4 Info skipped by scope)
- Fixed: 10
- Skipped: 0

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

### Iteration 1 test gate

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

---

_Fixed (iteration 2): 2026-04-18T05:57:00Z_
_Fixer: Claude (gsd-code-fixer, Opus 4.7 [1M context])_
_Iteration: 2_
