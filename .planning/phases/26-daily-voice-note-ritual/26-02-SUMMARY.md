---
phase: 26-daily-voice-note-ritual
plan: 02
subsystem: rituals + chris-engine + pensieve
tags: [pp5, voice-note, ritual-response, hard-co-loc-1, hard-co-loc-5, pitfall-6, pitfall-24, engine, pensieve, deposit-only, atomic-consume]

# Dependency graph
requires:
  - phase: 26-daily-voice-note-ritual
    plan: 01
    provides: src/rituals/voice-note.ts substrate (PROMPTS, PROMPT_SET_VERSION, RESPONSE_WINDOW_HOURS, RITUAL_SUPPRESS_DEPOSIT_THRESHOLD, chooseNextPromptIndex pure rotation), migration 0007 (daily_voice_note seed + ritual_pending_responses.prompt_text NOT NULL column + PP#5 partial index), test.sh substrate gate
  - phase: 25-ritual-scheduling-foundation-process-gate
    provides: dispatchRitualHandler skeleton (Plan 26-02 REPLACES it), parseRitualConfig + RitualFireOutcome union, hasReachedRitualDailyCap channel cap, idempotency.ts atomic UPDATE pattern reference
provides:
  - Wired dispatchRitualHandler in src/rituals/scheduler.ts (D-26-08 name-keyed switch) — case 'daily_voice_note' returns fireVoiceNote(ritual, cfg)
  - fireVoiceNote handler in src/rituals/voice-note.ts — sends Telegram message, inserts ritual_pending_responses row with prompt_text (amended D-26-02), updates rituals.config.prompt_bag
  - findActivePendingResponse + recordRitualVoiceResponse PP#5 helpers in src/rituals/voice-note.ts — atomic-consume mutual exclusion, Pensieve write with epistemicTag='RITUAL_RESPONSE' (D-26-03 bypass auto-tagger), ritual_responses link row with prompt_text from consumed pending row
  - PP#5 ritual-response detector at top of processMessage in src/chris/engine.ts (D-26-02 placement) — runs BEFORE PP#0; on hit returns '' (IN-02 silent-skip via bot.ts:54); race_lost branch preserves cumulative Anthropic-not-called invariant
  - storePensieveEntry signature extended with optional opts.epistemicTag parameter (D-26-03) — additive, backward-compatible
  - Mock-chain coverage update across engine.test.ts + engine-mute.test.ts + engine-refusal.test.ts (HARD CO-LOC #5 / D-26-07) — vi.mock('../../rituals/voice-note.js') with default findActivePendingResponse → null
  - engine-mute.test.ts ALSO gains previously-missing decision-capture/capture/resolution/triggers/suppressions mocks — fixes 7 pre-existing ECONNREFUSED failures (Plan 26-01 SUMMARY noted as Plan 26-02's responsibility)
  - engine-pp5.test.ts real-DB integration test with HIT-path afterAll cumulative invariant (Pitfall 6 contract) + concrete MISS-path tests (no-pending + expired-pending; per checker W5)
  - voice-note-handler.test.ts real-DB integration test for fireVoiceNote + concrete Promise.allSettled atomic-consume race (per checker W6)
affects: [26-03 pre-fire suppression — extends fireVoiceNote with shouldSuppressVoiceNoteFire pre-check, 26-04 polite-decline voice handler — uses PP#5 detector and same deposit pipeline, 26-05 scripts/fire-ritual.ts operator wrapper — invokes fireVoiceNote directly, 28 skip tracking — Phase 28 enriches RitualFireOutcome union]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PP#N pre-processor block convention extended: PP#5 lands at the absolute top of processMessage's try block, BEFORE PP#0 active-decision-capture (D-26-02). Each PP#N is a self-contained block that either short-circuits (return '') or falls through to the next stage. PP#5's race-loss branch returns '' silently — preserves cumulative Anthropic-not-called invariant for engine-pp5.test.ts."
    - "Atomic UPDATE...RETURNING with state-tracking column for mutual exclusion: ritual_pending_responses.consumed_at IS NULL guard on UPDATE means concurrent PP#5 invocations serialize at the row level (Postgres MVCC). The losing invocation gets zero rows back; recordRitualVoiceResponse throws StorageError('ritual.pp5.race_lost'); engine catches and returns '' silently. Pattern reusable for future deposit-once-deposit-only flows in M010+."
    - "Field-threading via RETURNING: amended D-26-02 thread prompt_text from ritual_pending_responses through the consume UPDATE's RETURNING clause back into ritual_responses INSERT. Avoids the empty-string placeholder anti-pattern (checker B4 fix) — ritual_responses.prompt_text always reflects the actual prompt sent at fire-time, not a sentinel value."
    - "epistemicTag pre-tag write path on storePensieveEntry (D-26-03): explicit tag bypasses Haiku auto-tagger (src/pensieve/tagger.ts which only updates entries with epistemic_tag IS NULL). Pattern enables ingest paths that already know the tag (RITUAL_RESPONSE, future structured-content paths) to skip the LLM round-trip + classification ambiguity."
    - "vi.hoisted() for vi.mock factory variables: vi.mock factories are hoisted to top-of-file BEFORE all imports and BEFORE module-body const initialization. Top-level mock fns referenced inside vi.mock factories must be wrapped in vi.hoisted({ ... }) destructuring to be available when the factory runs. Without this, the test fails with ReferenceError: Cannot access 'mockX' before initialization. Pattern documented across engine-pp5.test.ts + voice-note-handler.test.ts."
    - "Per-describe afterAll only closes sql pool in the last describe of a file: vitest serializes describe blocks within a file but each describe gets its own afterAll. Calling sql.end() in a non-final describe's afterAll kills the pool for sibling describes (CONNECTION_ENDED localhost:5433). Pattern: only the file-trailing describe's afterAll calls sql.end(); intermediate describes only do data cleanup."

key-files:
  created:
    - src/chris/__tests__/engine-pp5.test.ts
    - src/rituals/__tests__/voice-note-handler.test.ts
  modified:
    - src/pensieve/store.ts (epistemicTag parameter added)
    - src/rituals/voice-note.ts (3 new exports: findActivePendingResponse, recordRitualVoiceResponse, fireVoiceNote)
    - src/rituals/scheduler.ts (dispatchRitualHandler replaced with name-keyed switch returning RitualFireOutcome)
    - src/chris/engine.ts (PP#5 block inserted at top of processMessage try-block)
    - src/chris/__tests__/engine.test.ts (vi.mock for voice-note + default mockResolvedValue(null) in 2 beforeEach blocks)
    - src/chris/__tests__/engine-mute.test.ts (vi.mock for voice-note + decision-capture/capture/resolution/triggers/suppressions mocks added; fixes pre-existing 7 ECONNREFUSED failures)
    - src/chris/__tests__/engine-refusal.test.ts (vi.mock for voice-note + default in 2 beforeEach blocks)
    - src/pensieve/__tests__/store.test.ts (toHaveBeenCalledWith expectations include epistemicTag: null after additive parameter)

key-decisions:
  - "engine-mute.test.ts decision-capture mock chain: Plan 26-01 SUMMARY explicitly assigned ownership of fixing the 7 pre-existing engine-mute ECONNREFUSED ::1:5432 failures to Plan 26-02 mock-chain coverage update. Honored: added vi.mock for ../../decisions/{capture-state,capture,resolution,triggers,suppressions}.js alongside the new voice-note mock. All 5 engine-mute tests now pass (was 0/5 before Plan 26-02)."
  - "MISS-path describe in engine-pp5.test.ts mocks embeddings + tagger + relational-memory modules: when PP#5 falls through, processMessage routes to the JOURNAL pipeline which calls embedAndStore (HuggingFace transformers — pre-existing EACCES baseline in this env), tagEntry (Anthropic — Pitfall 6 contract violated for MISS path), and writeRelationalMemory. Mocking these three modules at the test file's top keeps the MISS-path describe focused on PP#5's fall-through behavior (no Pensieve RITUAL_RESPONSE write, no consume mark on expired rows) without hanging on baseline failures. The HIT-path describe's cumulative invariant remains intact because the HIT path returns BEFORE these modules are touched."
  - "Per-describe afterAll cleans data, last describe's afterAll closes the sql pool: discovered when first run produced CONNECTION_ENDED localhost:5433 in the second describe block — the first describe's sql.end() killed the pool. Convention codified: intermediate describes call cleanup() only; file-final describe calls cleanup() + sql.end({ timeout: 5 }).catch(() => {}). Applied to both engine-pp5.test.ts and voice-note-handler.test.ts."
  - "vi.hoisted() pattern enforced for module-top mock fns: first run failed with ReferenceError because mockAnthropicCreate / mockSendMessage were declared as top-level const after the vi.mock factory's hoist point. Fixed by wrapping the mock fn declarations in vi.hoisted({ ... }) destructuring. Pattern matches engine-mute.test.ts existing precedent and is the documented vitest contract for non-trivial mock chains."

patterns-established:
  - "PP#N block placement contract: each new pre-processor (PP#0 active-decision-capture, PP#1 trigger-detection, PP#5 ritual-response) lands at a specific position in processMessage's try-block defined by the relevant DECISIONS file. Position 0 = highest-priority short-circuit (PP#5 — runs BEFORE all other PPs because ritual responses must NEVER trigger LLM calls). Future Plans 26-04 (polite-decline voice) reuse the same PP#5 entry point — they share the pending-row lookup."
  - "HARD CO-LOC #1 (PP#5 + handler) + HARD CO-LOC #5 (mock-chain coverage update) atomic enforcement: Plan 26-02 lands all four core deliverables (PP#5 detector, fireVoiceNote handler, epistemicTag parameter, 3-file mock-chain update) in the same plan. Splitting any of them reproduces Pitfall 6 (Chris responds to ritual voice notes) or Pitfall 24 (Phase 14 v2.1 mock-chain regression class). Pattern reusable for any future plan that adds a new module-import to engine.ts (the import touches every processMessage test file's mock chain)."
  - "Threading state via RETURNING for clean denormalization: ritual_pending_responses.prompt_text → consume RETURNING → ritual_responses.prompt_text. The longitudinal trail (ritual_id → fired_at → responded_at → pensieve_entry_id → prompt_text) is built up across 3 inserts/updates without round-trips to re-read the original prompt. Pattern reusable for future flows where state must persist across the fire→consume gap."

requirements-completed: [VOICE-01, VOICE-02, VOICE-03, VOICE-06]

# Metrics
duration: 52m
completed: 2026-04-28
---

# Phase 26 Plan 2: HARD CO-LOC #1 + #5 ATOMIC — PP#5 ritual-response detector + voice-note handler + mock-chain coverage update Summary

**Highest-risk plan in M009 lands atomically: PP#5 detector at top of `processMessage`, `fireVoiceNote` handler dispatched via name-keyed switch, `storePensieveEntry` extended with `epistemicTag` parameter, and mock-chain coverage update across 3 engine test files. Cumulative `expect(mockAnthropicCreate).not.toHaveBeenCalled()` afterAll invariant in `engine-pp5.test.ts` empirically proves Pitfall 6 mitigation; `Promise.allSettled` race test in `voice-note-handler.test.ts` empirically proves atomic-consume mutual exclusion via `UPDATE ... WHERE consumed_at IS NULL RETURNING`.**

## Performance

- **Duration:** ~52 minutes (start 2026-04-28T05:09:28Z, last commit ~05:34, SUMMARY 06:01)
- **Tasks:** 7/7 complete
- **Files modified:** 9 (2 created, 7 modified)
- **Tests added:** 7 new tests across 2 new test files (3 in engine-pp5.test.ts + 4 in voice-note-handler.test.ts)
- **Tests verified green:** 11 test files / 120 tests passed in scoped Docker harness run (engine.test.ts: 72/72, engine-mute.test.ts: 5/5 — was 0/5 before Plan 26-02, engine-refusal.test.ts: 5/5, engine-pp5.test.ts: 3/3, voice-note-handler.test.ts: 4/4, voice-note.test.ts + prompt-rotation-property.test.ts: 13/13 substrate, scheduler.test.ts + idempotency.test.ts: Phase 25 still green, store.test.ts + integration.test.ts: pensieve still green)

## Accomplishments

- **Pitfall 6 mitigation empirically proven.** The `engine-pp5.test.ts` HIT-path describe's `afterAll(() => expect(mockAnthropicCreate).not.toHaveBeenCalled())` is the load-bearing regression contract. Any future change that allows PP#5 to invoke an LLM call before short-circuiting (or that breaks the short-circuit entirely) trips this assertion. Empirically: ritual response → empty string return → zero LLM calls → Pensieve entry tagged RITUAL_RESPONSE with source_subtype 'ritual_voice_note' + ritual_responses link row populated with prompt_text from consumed pending row.
- **Pitfall 24 mitigation honored via HARD CO-LOC #5.** The same plan that introduces PP#5 (which touches `engine.ts` and pulls in the new voice-note module) ships the mock-chain coverage update for `engine.test.ts` + `engine-mute.test.ts` + `engine-refusal.test.ts`. Default `findActivePendingResponse → null` keeps the existing PP#0..PP#4 + mode-detect tests exercising their original code paths without the new PP#5 codepath spuriously failing or being skipped.
- **HARD CO-LOC #1 honored: PP#5 detector + voice-note handler ship in the same plan.** Splitting them = guaranteed Chris-responds-to-rituals regression for the gap window. Both arrive together: handler in `src/rituals/voice-note.ts` STEP B (action), detector in `src/chris/engine.ts` STEP B (action), wired via `src/rituals/scheduler.ts` STEP B (action).
- **Amended D-26-02 prompt_text threading end-to-end.** `fireVoiceNote` writes `PROMPTS[promptIdx]` to `ritual_pending_responses.prompt_text`. `recordRitualVoiceResponse` reads `prompt_text` back via the atomic-consume UPDATE's RETURNING clause. `ritual_responses.prompt_text` is populated from the returned value. Zero empty-string assignments, zero NOT NULL violations (checker B4 fix verified by grep + test assertion).
- **Atomic-consume race semantics empirically proven.** Concrete `Promise.allSettled` body in `voice-note-handler.test.ts` (per checker W6) asserts: 2 concurrent `recordRitualVoiceResponse` calls on the same pending row → exactly 1 fulfilled + 1 rejected with `Error('ritual.pp5.race_lost')`, exactly 1 Pensieve entry, exactly 1 `ritual_responses` row with prompt_text from consumed pending. Postgres MVCC + `UPDATE ... WHERE consumed_at IS NULL RETURNING` is the lock; the test exercises the real lock against real Docker postgres.
- **Pre-existing engine-mute.test.ts failures FIXED as side effect of mock-chain update.** Plan 26-01 SUMMARY documented 7 `ECONNREFUSED ::1:5432` failures in `engine-mute.test.ts` because that file lacked decision-capture mocks. Plan 26-02 added them alongside the voice-note mock. Confirmed via Docker harness: engine-mute.test.ts now passes 5/5.
- **`storePensieveEntry` epistemicTag parameter additive — zero existing call-site changes required.** All 4+ call sites (`src/chris/modes/journal.ts:29`, plus 3 in tests) continue to work. The new parameter is the 4th, optional. Only `recordRitualVoiceResponse` passes it. Auto-tagger at `src/pensieve/tagger.ts` continues to skip pre-tagged entries (verified by its WHERE predicate `epistemic_tag IS NULL`).
- **`dispatchRitualHandler` name-keyed (D-26-08), not type-keyed.** Future Phases 27 (wellbeing) and 29 (weekly review) extend the switch with `case 'daily_wellbeing'` / `case 'weekly_review'`. Type-keying would have been ambiguous because multiple rituals share a cadence (`daily` covers both voice note and wellbeing). Default-case throw uses `${ritual.name}` — no `${ritual.type}` references remain.

## Task Commits

Each task committed atomically:

1. **Task 1: Add epistemicTag parameter to storePensieveEntry (D-26-03)** — `6c7210d` (feat) + 1 deviation auto-fix to existing store.test.ts (Rule 3 — additive parameter expectations).
2. **Task 2: Implement findActivePendingResponse + recordRitualVoiceResponse + fireVoiceNote (amended D-26-02)** — `3da9af3` (feat).
3. **Task 3: Wire dispatchRitualHandler to fireVoiceNote (D-26-08 name-keyed)** — `aaf793a` (feat).
4. **Task 4: Insert PP#5 ritual-response detector at processMessage entry (D-26-02)** — `3ef989a` (feat).
5. **Task 5: Mock-chain coverage update across 3 engine test files (HARD CO-LOC #5 / D-26-07)** — `0290017` (test).
6. **Task 6: engine-pp5.test.ts real-DB integration test (Pitfall 6 contract)** — `a2950c3` (test).
7. **Task 7: voice-note-handler.test.ts real-DB integration test (concurrency race + handler invariants)** — `9860c5f` (test).
8. **Test fixes (vi.hoisted + sql.end scoping + MISS-path mocks)** — `117c6dd` (fix).

## Files Created/Modified

### Created

- `src/chris/__tests__/engine-pp5.test.ts` — 216 lines. Real-DB integration with HIT-path describe (afterAll cumulative `not.toHaveBeenCalled()` Anthropic invariant — load-bearing Pitfall 6 contract) + MISS-path describe (no-pending fall-through + expired-pending fall-through, per checker W5). Mocks Anthropic client + embeddings + tagger + relational-memory at module top via `vi.hoisted()`. Real Docker postgres on port 5433.
- `src/rituals/__tests__/voice-note-handler.test.ts` — 256 lines. Real-DB integration with `fireVoiceNote` describe (prompt selection from PROMPTS, pending row insert with prompt_text, prompt_bag pop+writeback, empty-bag refill, Telegram-send-failure → no stale pending row) + atomic-consume race describe (concrete `Promise.allSettled([call1, call2])` body asserting exactly 1 fulfilled + 1 rejected with `Error('ritual.pp5.race_lost')`, per checker W6). Mocks `bot.api.sendMessage` at module top.

### Modified

- `src/pensieve/store.ts` — `storePensieveEntry` signature extended with optional 4th parameter `opts?: { epistemicTag?: typeof epistemicTagEnum.enumValues[number] }`. Function passes `opts?.epistemicTag ?? null` to `db.insert(pensieveEntries).values({ epistemicTag })`. Imports `epistemicTagEnum` from schema. JSDoc explains the bypass-auto-tagger semantics.
- `src/rituals/voice-note.ts` — Module imports extended (`drizzle-orm`, `db`, schema tables, `logger`, `StorageError`, `storePensieveEntry`, types, `bot`). Three new exports: `findActivePendingResponse` (PP#5 hot-path query backed by partial index), `recordRitualVoiceResponse` (3-step atomic-consume → Pensieve write → ritual_responses link insert flow with `prompt_text` threaded via RETURNING), `fireVoiceNote` (handler — pop next prompt via `chooseNextPromptIndex`, send via `bot.api.sendMessage`, insert pending row with `prompt_text`, update `rituals.config.prompt_bag`).
- `src/rituals/scheduler.ts` — `dispatchRitualHandler` Phase 25 throwing skeleton REPLACED with name-keyed switch returning `RitualFireOutcome`. New imports: `fireVoiceNote` from voice-note.js, plus `RitualFireOutcome` + `RitualConfig` types. `runRitualSweep` STEP 6 now passes `ritualConfig` and consumes returned `outcome` (sets `fired: outcome === 'fired'` in the result). Default-case throw uses `${ritual.name}` (no `${ritual.type}` references remain).
- `src/chris/engine.ts` — New import: `findActivePendingResponse, recordRitualVoiceResponse` from `'../rituals/voice-note.js'`. PP#5 block inserted at the absolute top of `processMessage`'s try block, BEFORE PP#0 (line 175 vs PP#0 at line 212). On hit: writes Pensieve as RITUAL_RESPONSE, returns `''` (IN-02 silent-skip). On race-loss: returns `''` silently. On other deposit errors: falls through (deposit-as-JOURNAL safer than losing). Variable name `chatIdStrPP5` avoids collision with `chatIdStr` declared later in `processMessage` (~line 264).
- `src/chris/__tests__/engine.test.ts` — `vi.mock('../../rituals/voice-note.js')` at module top with `mockFindActivePendingResponse + mockRecordRitualVoiceResponse` factories. Default `mockFindActivePendingResponse.mockResolvedValue(null)` added to beforeEach in 2 describe blocks (`processMessage (engine)` + `praise quarantine integration`). 72/72 tests still pass.
- `src/chris/__tests__/engine-mute.test.ts` — `vi.mock` for voice-note added with vi.hoisted-style fns. Plus 5 new vi.mock blocks for `decisions/{capture-state,capture,resolution,triggers,suppressions}.js` — fixes 7 pre-existing ECONNREFUSED failures (Plan 26-01 SUMMARY assigned this fix to Plan 26-02). 5/5 tests now pass (was 0/5).
- `src/chris/__tests__/engine-refusal.test.ts` — `vi.mock` for voice-note added with vi.hoisted destructuring. Default `mockFindActivePendingResponse.mockResolvedValue(null)` in beforeEach (replace_all — applies to both refusal + language-detection describe blocks). 5/5 tests pass.
- `src/pensieve/__tests__/store.test.ts` — Pre-existing tests' `toHaveBeenCalledWith` expectations updated to include `epistemicTag: null` (Rule 3 deviation — additive parameter forces existing tests to acknowledge the new field). 4/4 tests pass.

## Decisions Made

See key-decisions in frontmatter for the four implementation decisions captured during execution. Headlines:

1. **engine-mute.test.ts decision-capture mock chain added in Plan 26-02** — Plan 26-01 SUMMARY explicitly assigned this fix to Plan 26-02's mock-chain coverage update.
2. **engine-pp5.test.ts MISS-path mocks embeddings + tagger + relational-memory** — keeps MISS-path tests focused on PP#5 fall-through without hanging on HuggingFace EACCES baseline.
3. **Per-describe afterAll cleans data, last describe's afterAll closes the sql pool** — pool close in non-final describe kills the pool for sibling describes.
4. **vi.hoisted() pattern enforced for module-top mock fns** — vi.mock factories run BEFORE module-body const initialization.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] store.test.ts toHaveBeenCalledWith expectations needed epistemicTag: null**

- **Found during:** Task 1 verification (`npx vitest run src/pensieve/__tests__/store.test.ts` failed 2/4 tests)
- **Issue:** The additive `epistemicTag` parameter caused `db.insert(pensieveEntries).values({ ..., epistemicTag: null })` to include the new field. Two pre-existing `expect(mockValues).toHaveBeenCalledWith({ ... })` assertions used exact-match objects without `epistemicTag`, so they failed (expected vs received: missing `epistemicTag: null` field).
- **Fix:** Added `epistemicTag: null` to both existing `toHaveBeenCalledWith` expectations.
- **Files modified:** `src/pensieve/__tests__/store.test.ts`
- **Verification:** All 4 store tests pass after fix.
- **Committed in:** `6c7210d` (Task 1 commit).

**2. [Rule 1 - Bug] vi.hoisted() needed for top-level mock fns referenced in vi.mock factories**

- **Found during:** First Docker harness run after Tasks 6 + 7 commits
- **Issue:** `engine-pp5.test.ts` and `voice-note-handler.test.ts` declared `mockAnthropicCreate`, `mockAnthropicParse`, `mockSendMessage` as top-level `const`s referenced inside `vi.mock(...)` factories. vi.mock is hoisted ABOVE all imports and BEFORE module-body const initialization, causing `ReferenceError: Cannot access 'mockAnthropicCreate' before initialization` when the test loaded engine.ts (which imports llm/client.js, triggering the vi.mock factory).
- **Fix:** Wrapped the top-level mock fns in `vi.hoisted({ ... })` destructuring (matches `engine-mute.test.ts` existing precedent).
- **Files modified:** `src/chris/__tests__/engine-pp5.test.ts`, `src/rituals/__tests__/voice-note-handler.test.ts`
- **Verification:** Both test files load + execute cleanly after fix.
- **Committed in:** `117c6dd` (test fix commit).

**3. [Rule 1 - Bug] sql.end() in non-final describe killed pool for sibling describes**

- **Found during:** First Docker harness run for engine-pp5.test.ts + voice-note-handler.test.ts (both files have 2 describe blocks)
- **Issue:** Both files originally had `afterAll(async () => { ... await sql.end(); })` in EACH describe block. The first describe's afterAll closed the pool; the second describe's beforeEach `cleanup()` then failed with `CONNECTION_ENDED localhost:5433`.
- **Fix:** Only the file-final describe's afterAll calls `sql.end({ timeout: 5 }).catch(() => {})`. Intermediate describes only do data cleanup.
- **Files modified:** `src/chris/__tests__/engine-pp5.test.ts`, `src/rituals/__tests__/voice-note-handler.test.ts`
- **Verification:** Both files now pass all describe blocks cleanly.
- **Committed in:** `117c6dd` (test fix commit).

**4. [Rule 3 - Blocking] engine-pp5.test.ts MISS-path needed embeddings + tagger + relational-memory mocks**

- **Found during:** First Docker harness run for engine-pp5.test.ts (MISS-path tests timed out at 5s)
- **Issue:** MISS-path tests rely on `mockAnthropicCreate.mockRejectedValue(new Error('test-pipeline-stop'))` to short-circuit the pipeline AFTER PP#5 falls through. But `detectMode` catches errors and defaults to JOURNAL. JOURNAL handler then calls `embedAndStore` (HuggingFace transformers — pre-existing EACCES baseline that hangs the test) before the Anthropic rejection bubbles up.
- **Fix:** Added `vi.mock('../../pensieve/embeddings.js'`, `vi.mock('../../pensieve/tagger.js'`, `vi.mock('../../memory/relational.js'` at the test file's top with no-op resolved mocks. The HIT-path describe's cumulative invariant remains intact because HIT path returns BEFORE these modules are touched.
- **Files modified:** `src/chris/__tests__/engine-pp5.test.ts`
- **Verification:** All 3 engine-pp5 tests pass (HIT path: 1/1 with afterAll invariant green; MISS path: 2/2).
- **Committed in:** `117c6dd` (test fix commit).

**5. [Rule 2 - Missing Critical] engine-mute.test.ts decision-capture mocks (HARD CO-LOC #5 scope)**

- **Found during:** Pre-existing — Plan 26-01 SUMMARY explicitly assigned to Plan 26-02
- **Issue:** `engine-mute.test.ts` lacked vi.mock blocks for `decisions/{capture-state,capture,resolution,triggers,suppressions}.js`. With Plan 26-02's PP#5 import landing in engine.ts, the missing decision-capture mocks would have caused EVERY engine-mute test to fail (PP#0 calls `getActiveDecisionCapture` which hits real DB → `ECONNREFUSED ::1:5432`). Pre-existing failures from earlier phases were 7; without this fix, Plan 26-02 would have added 0 net regressions (already failing) but would have masked the underlying issue.
- **Fix:** Added the 5 missing vi.mock blocks alongside the new voice-note mock (HARD CO-LOC #5 scope per D-26-07 — "engine.test.ts + engine-mute.test.ts + engine-refusal.test.ts" updated atomically).
- **Files modified:** `src/chris/__tests__/engine-mute.test.ts`
- **Verification:** 5/5 engine-mute tests pass (was 0/5).
- **Committed in:** `0290017` (Task 5 commit).

---

**Total deviations:** 5 auto-fixed (1 bug per deviation 1, 2 bugs in deviation 2-3 / test infrastructure, 1 blocking issue in deviation 4, 1 missing-critical pre-existing issue in deviation 5). Zero Rule 4 (architectural) escalations needed. All deviations stayed within the file scope listed in Plan 26-02's `<files>` blocks.

## Issues Encountered

### Pre-existing baseline test failures (NOT caused by Plan 26-02)

The full `bash scripts/test.sh` run still hits the ~57 pre-existing baseline failures documented in Plan 26-01 SUMMARY. Breakdown:

- **`src/chris/__tests__/contradiction-false-positive.test.ts`** — HuggingFace transformers EACCES (env-level baseline; 20 tests).
- **`src/chris/__tests__/live-integration.test.ts`** — Anthropic 401 (test-key not real) (24 tests, 21 fail when ANTHROPIC_API_KEY is unset).
- **`src/decisions/__tests__/live-accountability.test.ts` + `vague-validator-live.test.ts` + `live-anti-flattery.test.ts` + `models-smoke.test.ts`** — same Anthropic 401 cause.

**Net impact of Plan 26-02 on baseline failures:**
- engine-mute.test.ts moved from 0/5 → 5/5 (Plan 26-02 FIXED 7 ECONNREFUSED failures via decision-capture mock chain — confirmed in scoped Docker run above).
- engine.test.ts + engine-refusal.test.ts: unchanged (mock-chain update is silent — default null mocks make new code path inert in pre-existing tests).
- 2 new test files added: engine-pp5.test.ts (3 tests) + voice-note-handler.test.ts (4 tests) — all green.

### Plan grep verification quirks (not actionable)

- `grep -c "ritual.pp5.race_lost" src/rituals/voice-note.ts` returned 2 instead of plan's expected 1 — one occurrence is in the docstring (`Throws StorageError('ritual.pp5.race_lost') on race-loss ...`) and one in the `throw new StorageError('ritual.pp5.race_lost')` line. The expected behavior holds (error string surfaced); the docstring count is incidental.
- `grep -c "Promise.allSettled" src/rituals/__tests__/voice-note-handler.test.ts` returned 3 instead of plan's expected 1 — 1 in module docstring, 1 in inline comment, 1 in actual call. The contract grep is the call itself; comment occurrences are documentation.

## User Setup Required

None — no external service configuration required. Plan 26-02 is fully autonomous; the new tests run against the canonical Docker harness on port 5433 and use mocked Anthropic + mocked Telegram bot.

## Note on Plan Restructure

Per checker B3 (referenced in 26-02-PLAN.md objective): the `scripts/fire-ritual.ts` operator wrapper was moved to NEW Plan 26-05 (was Task 8 in the original 9-task version of Plan 26-02). Plan 26-02 ships 7 tasks; Plan 26-05 will ship the operator wrapper in a future wave.

## Threat Flags

No new threat surface beyond what Plan 26-02's `<threat_model>` documented. T-26-02-01..06 mitigations verified at implementation:
- T-26-02-02 (atomic consume mutual exclusion): empirically proven via voice-note-handler.test.ts Promise.allSettled test.
- T-26-02-04 (epistemicTag privilege escalation): only `recordRitualVoiceResponse` passes the parameter; existing 4 call sites unchanged.
- T-26-02-06 (repudiation / longitudinal trail): ritual_responses link row populated with prompt_text from consumed pending row, providing the full ritual_id → fired_at → responded_at → pensieve_entry_id → prompt_text audit chain.

## Next Phase Readiness

- **Plan 26-03 (pre-fire suppression — VOICE-04)** is fully unblocked. It can extend `fireVoiceNote` with a `shouldSuppressVoiceNoteFire` pre-check (early return with new `'system_suppressed'` outcome before the prompt-bag pop / Telegram send / pending insert sequence). The `RitualFireOutcome` union extension to add `'system_suppressed'` was DEFERRED from Plan 26-02 (the plan's must_haves anticipated it but Task 2's `fireVoiceNote` doesn't emit it yet — Plan 26-03 adds the literal AND the emission together, which is structurally cleaner than appending to the union without a producer).
- **Plan 26-04 (polite-decline voice handler — VOICE-05)** can leverage the same PP#5 detector and deposit-only contract.
- **Plan 26-05 (scripts/fire-ritual.ts operator wrapper)** can directly call `fireVoiceNote(ritual, cfg)` for manual fire testing.
- **Phase 27 (wellbeing snapshot ritual)** can extend `dispatchRitualHandler` with `case 'daily_wellbeing': return fireWellbeing(ritual, cfg)` — same name-keyed pattern.

## TDD Gate Compliance

Plan 26-02 is `type: execute` (not `type: tdd`) per its frontmatter. Tests in Tasks 5-7 follow the green-bar increment pattern (write tests + run + see green) rather than RED → GREEN → REFACTOR gate sequence. No gate compliance check applies.

## Self-Check: PASSED

All 9 claimed files exist on disk and all 8 commits are present in `git log --all`:

- Files verified: `src/pensieve/store.ts`, `src/rituals/voice-note.ts`, `src/rituals/scheduler.ts`, `src/chris/engine.ts`, `src/chris/__tests__/engine.test.ts`, `src/chris/__tests__/engine-mute.test.ts`, `src/chris/__tests__/engine-refusal.test.ts`, `src/chris/__tests__/engine-pp5.test.ts`, `src/rituals/__tests__/voice-note-handler.test.ts`, `src/pensieve/__tests__/store.test.ts`.
- Commits verified: `6c7210d` (Task 1), `3da9af3` (Task 2), `aaf793a` (Task 3), `3ef989a` (Task 4), `0290017` (Task 5), `a2950c3` (Task 6), `9860c5f` (Task 7), `117c6dd` (test fixes).

---
*Phase: 26-daily-voice-note-ritual*
*Completed: 2026-04-28*
