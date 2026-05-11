---
phase: 29-weekly-review
plan: 02
subsystem: rituals
tags:
  - weekly-review
  - sonnet-generator
  - haiku-judge
  - zod-refine
  - retry-cap
  - templated-fallback
  - pensieve-persist
  - HARD-CO-LOC-2
  - HARD-CO-LOC-3

# Dependency graph
requires:
  - phase: 29-weekly-review/01
    provides: assembleWeeklyReviewPrompt + WEEKLY_REVIEW_HEADER + loadWeeklyReviewContext + computeWeekBoundary (Plan 29-01 substrate)
  - phase: 26-daily-voice-note-ritual/02
    provides: storePensieveEntry epistemicTag parameter (commit 6c7210d, D-26-03) — Plan 29-02 reuses
  - phase: 25-ritual-scheduling-foundation-process-gate
    provides: rituals + ritual_responses + epistemicTagEnum 'RITUAL_RESPONSE' substrate
  - phase: 21-episodic-consolidation (M008)
    provides: episodic_summaries table + getEpisodicSummariesRange (already first-consumed by Plan 29-01)
  - phase: 14-decisions (M007)
    provides: decisions table + status='resolved' + resolvedAt timestamp
provides:
  - generateWeeklyObservation(input) — Sonnet+Stage-1+Stage-2+date-grounding+retry+fallback pipeline
  - fireWeeklyReview(ritual, cfg) — full orchestrator from substrate fetch → Telegram send → Pensieve persist
  - stage1Check(question) — pure-function Stage-1 single-question gate (regex `?` + EN/FR/RU interrogative-leading-word ≤1)
  - WeeklyReviewSchema (v3 with .refine) + WeeklyReviewSchemaV4 (v4 SDK boundary mirror)
  - StageTwoJudgeSchema + DateGroundingSchema (v3+v4) — internal helpers
  - runStage2HaikuJudge + runDateGroundingCheck — exported for direct test access
  - MultiQuestionError + DateOutOfWindowError — discriminated retry-loop classes
  - MAX_RETRIES = 2 (initial + 2 = 3 max LLM-call cycles, Pitfall 15 cap)
  - TEMPLATED_FALLBACK_EN — internal English-only v1 baseline; FR/RU deferred to v2.5
affects:
  - 29-03 (consumes fireWeeklyReview from dispatchRitualHandler switch case)
  - 29-04 (live anti-flattery test scaffolding will exercise generateWeeklyObservation directly)

# Tech tracking
tech-stack:
  added: []   # zero new dependencies — reuses zod, zod/v4, @anthropic-ai/sdk, drizzle, luxon
  patterns:
    - "v3/v4 dual Zod schema at @anthropic-ai/sdk boundary — mirrors src/episodic/consolidate.ts:33-81"
    - "Two-stage single-question enforcement: cheap regex (Stage-1) before Haiku judge (Stage-2) — D-04 cost-ordering"
    - "Discriminated retry-loop error classes (MultiQuestionError, DateOutOfWindowError) carry payload for telemetry without re-calling judge"
    - "English-only templated fallback as v1 baseline; FR/RU deferred to v2.5 (CONTEXT.md Claude's Discretion + W-4 lock)"
    - "Write-before-send: ritual_responses INSERT before bot.api.sendMessage (M007 D-28 pattern)"
    - "Tag override at storePensieveEntry boundary using opts.epistemicTag (Phase 26 D-26-03 reuse — Pensieve auto-tagger bypassed for ritual deposits)"
    - "Constitutional preamble flows through SDK boundary: assembleWeeklyReviewPrompt → fireWeeklyReview → buildSonnetRequest → anthropic.messages.parse system arg — verified by unit test asserting system[0].text starts with '## Core Principles (Always Active)'"

key-files:
  created:
    - src/rituals/__tests__/weekly-review.test.ts (775 LoC — 8 describe blocks, 31 tests, 4 real-DB integration)
  modified:
    - src/rituals/weekly-review.ts (39 LoC → 652 LoC, +613 LoC — Plan 29-01 skeleton replaced with full impl)

key-decisions:
  - "Dispatcher signature: fireWeeklyReview(ritual, cfg): Promise<RitualFireOutcome> — matches Phase 26 fireVoiceNote + Phase 27 fireWellbeing for uniform dispatchRitualHandler switch (D-26-08). The plan's snippet showed `(ritual): Promise<void>` but that would break the dispatcher contract; aligned to existing Phase 26/27 shape"
  - "cfg parameter currently unused in fireWeeklyReview body (no per-fire knobs); accepted for dispatcher uniformity. eslint-disable on the unused-vars rule is documented inline"
  - "Sparse-data short-circuit returns 'fired' (not 'caught_up' or a new outcome); this is consistent with M008 CONS-02 'no-entries' which also short-circuits without claiming a different outcome string. Future Phase 28 may introduce 'fired_no_data' if telemetry distinguishes the case"
  - "respondedAt is set at the end of fireWeeklyReview (after Pensieve write) to mark system completion of the fire flow — distinct from PP#5's Greg-replied semantics in voice-note.ts. The weekly review has no expected reply (the question is rhetorical/Socratic); responseAt=NULL would imply 'never completed' which would be misleading"
  - "Stage-1 + Stage-2 + date-grounding all share the same MAX_RETRIES=2 cap (single budget across all three failure modes per D-05). Worst case = 9 LLM calls per weekly review (3 attempts × 3 calls); typical case = 3 calls (single pass)"
  - "Sonnet system arg uses cache_control: { type: 'ephemeral' } — mirrors src/episodic/consolidate.ts:139; reduces cost on retry-path because the (long) system prompt is cached server-side"
  - "Sonnet max_tokens: 800 — matches CONTEXT.md specifics + 29-RESEARCH §5; observation+question is short. Haiku judge max_tokens: 150 (count+questions array small). Date-grounding max_tokens: 200 (dates_referenced may be longer)"

requirements-completed: [WEEK-02, WEEK-03, WEEK-04, WEEK-05, WEEK-06, WEEK-07, WEEK-08]

# Metrics
duration: 11 min
completed: 2026-04-28
---

# Phase 29 Plan 02: HARD CO-LOC #2 + #3 ATOMIC — Sonnet generator + two-stage single-question enforcement + date-grounding + retry-cap-2 + Pensieve persist + Telegram render

**The load-bearing M009 quality plan: Sonnet observation generator wired through Stage-1 Zod refine (regex `?` + EN/FR/RU interrogative-leading-word ≤1) + Stage-2 Haiku judge ({question_count, questions[]}) + date-grounding Haiku post-check + retry cap=2 + English-only templated fallback + Pensieve persist as RITUAL_RESPONSE — all atomic in a single plan to prevent Pitfall 14 (compound questions) and Pitfall 17 (sycophantic flattery) from regressing on the first weekly review.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-28T18:11:37Z
- **Completed:** 2026-04-28T18:23:24Z
- **Tasks:** 7 (Task 5 SKIPPED — see cross-phase coordination)
- **Files created:** 1 (src/rituals/__tests__/weekly-review.test.ts)
- **Files modified:** 1 (src/rituals/weekly-review.ts — 39 → 652 LoC, +613)
- **Commits:** 5 (Tasks 1, 2, 3, 4, 6+7)
- **Tests:** 31/31 green (8 describe blocks; 4 real-DB integration tests + 27 mocked unit tests)
- **Plan-suite (rituals/__tests__/):** 131/131 tests green across 13 files in 9.22s

## Cross-phase Coordination

**Task 5 (storePensieveEntry signature extension) was SKIPPED.**

Per Task 0 git log inspection, Phase 26 commit `6c7210d` (D-26-03, dated 2026-04-28) already shipped the optional `opts.epistemicTag` parameter on `storePensieveEntry`. Plan 29-02 REUSES this extension verbatim — does not re-extend, does not modify the signature.

Note on parameter naming: the plan brief said `options.epistemic_tag` (snake_case in an `options` object). The actual shipped Phase 26 signature is `opts.epistemicTag` (camelCase in an `opts` object). Plan 29-02's call site in `fireWeeklyReview` uses the actual signature: `{ epistemicTag: 'RITUAL_RESPONSE' }`. The semantics are identical to the plan's intent.

## Accomplishments

### HARD CO-LOC #2 (Pitfall 14 — compound questions): ENFORCED

All five components ship atomically in this plan:
1. **Stage-1 Zod refine** (`stage1Check` + `INTERROGATIVE_REGEX` covering EN+FR+RU + `WeeklyReviewSchema.question.refine(stage1Check)`) — Task 1 commit `9dee2a7`
2. **Stage-2 Haiku judge** (`runStage2HaikuJudge` + `StageTwoJudgeSchema` v3+v4) — Tasks 2-3 commits `7b34a52`, `53135c4`
3. **Date-grounding post-check** (`runDateGroundingCheck` + `DateGroundingSchema` v3+v4) — Task 3 commit `53135c4`
4. **Retry-cap-2 generator** (`generateWeeklyObservation` with MAX_RETRIES=2, MultiQuestionError + DateOutOfWindowError discriminated dispatch) — Task 4 commit `b2fe0b0`
5. **fireWeeklyReview orchestrator** wiring all of the above end-to-end — Tasks 6+7 commit `b75dc0f`

The Pitfall 14 documented failure modes (multi-`?`, French period-terminated multi-question, Russian period-terminated multi-question) are unit-tested at the `stage1Check` level with deterministic regex evaluation. The semantic compound-question case (one `?`, one leading-word, but two questions joined by 'and'/'or') is caught by the Stage-2 Haiku judge.

### HARD CO-LOC #3 (Pitfall 17 — sycophantic flattery): ENFORCED

The CONSTITUTIONAL_PREAMBLE injection mechanism is wired:
- Plan 29-01 already wires the assembler-side: `assembleWeeklyReviewPrompt` imports CONSTITUTIONAL_PREAMBLE and pushes it as section 1.
- Plan 29-02 wires the consumer-side: `fireWeeklyReview` calls `generateWeeklyObservation`, which calls `assembleWeeklyReviewPrompt` and passes the result verbatim as the `system` argument to `anthropic.messages.parse`.
- A unit test in the `CONSTITUTIONAL_PREAMBLE injection at SDK boundary` describe block asserts:
  ```
  mockAnthropicParse.mock.calls[0][0].system[0].text.startsWith('## Core Principles (Always Active)')
  ```
  This is the regression detector — if a future refactor strips the preamble injection at any point in the chain, this test fails.

### Stage-1 Zod refine details (D-03)

`stage1Check(question: string): boolean` returns true when BOTH:
1. `(question.match(/\?/g) ?? []).length === 1` (catches multi-`?` failure mode)
2. `(question.match(INTERROGATIVE_REGEX) ?? []).length <= 1` (catches FR/RU period-terminated compound questions)

The `INTERROGATIVE_REGEX` covers EN (`what|why|how|when|where|which|who`), FR (`qu['e]?est-ce que|qu['e]?est-ce qui|comment|pourquoi|quoi|quand|où|quel|quelle|quels|quelles|qui`), and RU (`почему|что|как|когда|где|кто|какой|какая|какое|какие|зачем`) under flags `g`, `i`, `u`. The locked regex is verbatim from CONTEXT.md D-03.

### Templated fallback English-only baseline (W-4 lock)

The fallback ships English-only as v1 baseline:
```typescript
const TEMPLATED_FALLBACK_EN = {
  observation: 'Reflecting on this week.',
  question: 'What stood out to you about this week?',
} as const;
```

The source comment block explicitly states FR/RU localization is deferred to v2.5 per CONTEXT.md "Claude's Discretion" + W-4 directive. Future v2.5 work will branch by `franc` last-message-language detection. The boundary is documented in code so future-Greg knows the deferral lies here.

### Pensieve persistence (WEEK-08, D-07)

`fireWeeklyReview` writes the observation to `pensieve_entries` with:
- `epistemicTag: 'RITUAL_RESPONSE'` (explicit tag override; bypasses Haiku auto-tagger via D-26-03 mechanism shipped by Phase 26)
- `metadata.kind: 'weekly_review'` (longitudinal recall key)
- `metadata.source_subtype: 'weekly_observation'` (mirrors VOICE-06 `'ritual_voice_note'` pattern)
- `metadata.week_start` / `metadata.week_end` (ISO date strings in proactiveTimezone)
- `metadata.ritual_response_id` (back-reference to ritual_responses row)

The real-DB integration test queries by `metadata->>'kind' = 'weekly_review'` and asserts exactly 1 row exists with the correct epistemic_tag and metadata.

### D031 boundary marker rendering (WEEK-04)

The user-facing message is rendered as:
```
Observation (interpretation, not fact):

${observation}

${question}
```

The header is prepended at Telegram-send time, NOT in the prompt — per 29-RESEARCH §6 explicit reasoning ("mixing the header into the prompt would require Sonnet to render it correctly — extra failure mode"). The integration test asserts the sent Telegram message text starts with `'Observation (interpretation, not fact):'`.

## Task Commits

Each task committed atomically per the plan's commit-checkpoint discipline:

1. **Task 1 (Stage-1 + dual schema):** `9dee2a7` — `feat(29-02): add Stage-1 Zod refine + WeeklyReviewSchema dual schema (D-03 / WEEK-05)`
2. **Task 2 (Stage-2 + Date-grounding schemas):** `7b34a52` — `feat(29-02): add StageTwoJudgeSchema + DateGroundingSchema (D-04 + D-05)`
3. **Task 3 (Haiku judge implementations):** `53135c4` — `feat(29-02): add runStage2HaikuJudge + runDateGroundingCheck (D-04 + D-05)`
4. **Task 4 (retry-cap-2 generator + fallback):** `b2fe0b0` — `feat(29-02): add generateWeeklyObservation retry-cap-2 + EN templated fallback (D-04 / WEEK-06)`
5. **Task 5: SKIPPED** — Phase 26 commit `6c7210d` already shipped storePensieveEntry epistemicTag parameter
6. **Tasks 6+7 (fireWeeklyReview orchestrator + comprehensive tests):** `b75dc0f` — `feat(29-02): add fireWeeklyReview orchestrator + integration tests (WEEK-01/04/08)`

## Files Created/Modified

- **`src/rituals/weekly-review.ts`** (MODIFIED, 39 → 652 LoC). Plan 29-01 left this as a 39-LoC skeleton owning only `WEEKLY_REVIEW_HEADER`. Plan 29-02 fills in: `stage1Check`, `INTERROGATIVE_REGEX`, `WeeklyReviewSchema`+`WeeklyReviewSchemaV4`, `StageTwoJudgeSchema`+v4, `DateGroundingSchema`+v4, `MultiQuestionError`, `DateOutOfWindowError`, `runStage2HaikuJudge`, `runDateGroundingCheck`, `MAX_RETRIES`, `TEMPLATED_FALLBACK_EN`, `buildSonnetRequest`, `generateWeeklyObservation`, and `fireWeeklyReview`.
- **`src/rituals/__tests__/weekly-review.test.ts`** (NEW, 775 LoC). 8 describe blocks; 31 tests total: 9 Stage-1 unit + 1 schema sanity + 4 Stage-2 mocked + 4 Date-grounding mocked + 6 retry-loop mocked + 2 templated fallback + 1 SDK boundary + 4 fireWeeklyReview real-DB integration.

## Decisions Made

- **`fireWeeklyReview` returns `RitualFireOutcome`, not `void`:** The plan brief showed `Promise<void>`, but the existing dispatcher contract (Phase 26 D-26-08) is `(ritual, cfg) → Promise<RitualFireOutcome>`. Aligning to that contract means Plan 29-03's dispatcher case is a one-line `case 'weekly_review': return fireWeeklyReview(ritual, cfg);` — same shape as the existing `daily_voice_note` and `daily_wellbeing` cases. Returning a `RitualFireOutcome` 'fired' is correct semantics for both successful generations AND the sparse-data short-circuit.

- **`cfg` parameter accepted but unused in fireWeeklyReview body:** The weekly review has no per-fire config knobs (the cron's `fire_dow=7` and `fire_at='20:00'` are read by the scheduler before dispatch; nothing else in `RitualConfig` applies to the weekly review's logic at fire time). Accepting `cfg` for dispatcher uniformity is preferable to a special-case signature; an `eslint-disable-next-line` directive documents the intentional non-use.

- **Sparse-data short-circuit returns 'fired' not a new outcome:** The plan brief was silent on the precise outcome for the sparse-data case. Mirroring CONS-02's "no-entries" pattern from M008 (which short-circuits without claiming a different outcome string), the weekly review returns 'fired' on the no-data path. The `rituals.weekly.skipped.no_data` log line is the telemetry channel; if Phase 28 introduces a `'fired_no_data'` outcome, it can be added without a structural change here.

- **`respondedAt` set at end of fire flow (system completion):** The `ritual_responses.respondedAt` column has dual meaning across handlers — voice-note uses it for Greg's STT reply (PP#5 mechanism); weekly review has no expected user reply (the Socratic question is rhetorical). Setting `respondedAt = new Date()` after Pensieve write marks "system completed the fire flow" so longitudinal queries don't confuse "weekly review never completed" with "Greg never replied". The metadata distinguishes the two cases (`isFallback` field).

- **Schema bounds preserved verbatim from CONTEXT.md:** observation 20-800 chars; question 5-300 chars; question_count int 0-10; questions array max 10; dates_referenced array max 20. These are bounded explicitly per threat T-29-02-03 (DoS protection — Haiku output can't expand the retry loop's LLM-call budget through unbounded fields).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Adapted MultiQuestionError construction to match runStage2HaikuJudge's return shape**
- **Found during:** Task 4 (TypeScript compile)
- **Issue:** The plan's snippet for the retry loop wrote `if (stage2.count > 1) throw new MultiQuestionError(stage2);`, but `runStage2HaikuJudge` returns `{ count, questions }` while `MultiQuestionError` expects `{ question_count, questions }`. Direct passthrough produced TS2345 type error.
- **Fix:** Constructed the payload explicitly: `throw new MultiQuestionError({ question_count: stage2.count, questions: stage2.questions });`. The semantics are identical to the plan's intent; the discriminated error class still carries the full Haiku judge result.
- **Files modified:** src/rituals/weekly-review.ts
- **Verification:** `npx tsc --noEmit` reports zero errors; the retry-loop test "Test 4 (Stage-2 Haiku reports count=2 → MultiQuestionError → retry)" exercises the corrected path.
- **Committed in:** `b2fe0b0` (Task 4 commit)

**2. [Rule 3 — Blocking] Reworded comment containing the literal `vi.useFakeTimers` token to satisfy grep guard**
- **Found during:** Task 3 verification gate
- **Issue:** The plan's grep guard `grep -c "vi.useFakeTimers" src/rituals/__tests__/weekly-review.test.ts` expected 0 matches, but the test file's docstring documenting the TESTING.md D-02 prohibition contained the literal token, producing 1 match. This is the same defect class as 29-01 deviation #3 — `grep -c` doesn't strip TS comments.
- **Fix:** Reworded the docstring sentence to express the same intent without the literal token (now reads: "this suite does NOT use the fake-timer API"). The TESTING.md D-02 contract is preserved; only the literal-token avoidance is what changed.
- **Files modified:** src/rituals/__tests__/weekly-review.test.ts
- **Verification:** `grep -c "vi.useFakeTimers" src/rituals/__tests__/weekly-review.test.ts` returns 0.
- **Committed in:** `53135c4` (Task 3 commit)
- **Forward note:** Same `grep -c` flaw as 29-01 #3. Plan 29-04 should use `grep -v '^\s*\*' | grep -v '^\s*//'`-style filter or a more robust gate semantically.

**3. [Rule 1 — Bug] `db.execute(sql\`...\`).rows` doesn't exist on postgres-js driver; switched to typed Drizzle select**
- **Found during:** Task 6 integration test execution
- **Issue:** Initial integration-test query used `await db.execute(sql\`SELECT ... FROM pensieve_entries WHERE ...\`)` then accessed `.rows` to assert length. The `postgres-js` driver returns row arrays directly from `db.execute` (no `.rows` accessor), so the assertion failed with "Target cannot be null or undefined".
- **Fix:** Replaced with the typed Drizzle ORM select: `await db.select().from(pensieveEntries).where(sql\`metadata->>'kind' = 'weekly_review'\`)`. Returns a clean `Array<{...}>` with snake_case-to-camelCase mapping (epistemicTag, metadata, etc.). All assertions on the row's typed fields.
- **Files modified:** src/rituals/__tests__/weekly-review.test.ts
- **Verification:** Real-DB integration test "full happy path" passes with the typed query.
- **Committed in:** `b75dc0f` (Tasks 6+7 commit)

### Auto-skipped (per plan's Task 0 directive)

**Task 5 — storePensieveEntry epistemicTag extension: SKIPPED.** Phase 26 commit `6c7210d` (`feat(26-02): add epistemicTag parameter to storePensieveEntry (D-26-03)`) already shipped the extension. Plan 29-02 imports and reuses verbatim:
```typescript
await storePensieveEntry(observation, 'telegram', metadata, { epistemicTag: 'RITUAL_RESPONSE' });
```

The plan's "options.epistemic_tag" naming was an early draft; the actual Phase 26 signature uses camelCase `opts.epistemicTag`. This is documented in the source comment at the call site.

---

**Total deviations:** 3 auto-fixed (1 Rule 3 cosmetic, 2 Rule 1 type/runtime fixes) + 1 plan-directed skip (Task 5).
**Impact on plan:** All `must_haves` truths from the frontmatter still hold post-fix. None of the deviations changed the user-facing behavior; they only addressed plan-text-vs-actual-source mismatches and grep-gate cosmetics.

## Authentication Gates

None encountered. Tests use mocked `anthropic.messages.parse` so no real Anthropic API key was required at any point. Real Docker postgres on port 5433 was used for integration tests via `bash scripts/test.sh`.

## Issues Encountered

- **Initial integration-test failure ("Target cannot be null or undefined"):** Caused by the postgres-js driver's return shape (row array, not `{ rows }`). Resolved as deviation #3 above. No plan-level impact.
- **DB connection refused on first non-Docker-harness vitest run:** The test file requires real postgres on port 5433. Running via `bash scripts/test.sh src/rituals/__tests__/weekly-review.test.ts` boots the Docker container correctly. Per MEMORY rule "always run full Docker tests, never skip integration tests, always start real postgres" — addressed.

## Threat Model Verification

All threats from the plan's `<threat_model>` block are mitigated as designed:

- **T-29-02-01 (Sycophantic flattery via prompt-injection content):** mitigate — CONSTITUTIONAL_PREAMBLE injection at SDK boundary verified by unit test.
- **T-29-02-02 (Haiku judge LLM poisoning):** mitigate — bounded structured output (StageTwoJudgeSchema with int 0-10 + array max 10).
- **T-29-02-03 (Retry-budget DoS):** mitigate — MAX_RETRIES=2 caps the loop at 3 attempts × 3 calls = 9 LLM calls worst case.
- **T-29-02-04 (Concurrent fire race):** mitigate — Phase 25 substrate `tryFireRitualAtomic` (RIT-10) ensures one of two parallel `dispatchRitualHandler` calls advances next_run_at. Plan 29-02 inherits.
- **T-29-02-05 (Wellbeing data sent to Anthropic):** accept — operates under existing data-processing contract.
- **T-29-02-06 (RITUAL_RESPONSE tag bypass of Haiku auto-tagger):** mitigate — D-07 explicit tag override is internal-only (TypeScript-callable from same-process code). Acceptable for single-user system.

## Self-Check: PASSED

- All key files exist on disk:
  - `src/rituals/weekly-review.ts` — FOUND (652 LoC, 39 → 652)
  - `src/rituals/__tests__/weekly-review.test.ts` — FOUND (775 LoC)
- All 5 task commits exist in git log:
  - `9dee2a7` (Task 1) — FOUND
  - `7b34a52` (Task 2) — FOUND
  - `53135c4` (Task 3) — FOUND
  - `b2fe0b0` (Task 4) — FOUND
  - `b75dc0f` (Tasks 6+7) — FOUND
- All grep gates pass (Task 1: 6/6 + 9 tests; Task 2: 4/4 + 1 test; Task 3: 5/5 + 8 tests; Task 4: 5/5 + 8 tests; Task 6: 5/5 + 4 tests; Task 7: 6/6 + cumulative).
- All 31 tests green: `Test Files 1 passed (1) | Tests 31 passed (31)` in <850ms via Docker harness.
- Full rituals/__tests__/ suite: 131/131 green across 13 files in 9.22s.
- TypeScript clean: `npx tsc --noEmit` reports zero errors attributable to the modified files.

## TDD Gate Compliance

The plan is `type=execute` (not `type=tdd`), so plan-level TDD gate enforcement does not apply. Per-task TDD discipline (Task 1 + Task 3 + Task 4 had `tdd="true"` markers): tests were written and run alongside the implementation in each task commit, with the implementation passing on first run after the test was written. No retroactive test addition.

## Next Phase Readiness

- **Plan 29-03 unblocked.** It can now `import { fireWeeklyReview } from './weekly-review.js'` and add a one-line case to `dispatchRitualHandler`:
  ```typescript
  case 'weekly_review':
    return fireWeeklyReview(ritual, cfg);
  ```
  The Phase 25 substrate (`tryFireRitualAtomic` + cron sweep at 21:00 Paris) will then drive `fireWeeklyReview` once the seed migration `0009_weekly_review_seed.sql` lands.
- **Plan 29-04 unblocked.** The live-test scaffolding can now `import { generateWeeklyObservation } from '../weekly-review.js'` to exercise the full pipeline against real Anthropic with adversarial fixture content.
- **HARD CO-LOC #2 (Pitfall 14): closed in this commit cluster.** Stage-1 + Stage-2 + retry + generator all shipped atomically; splitting any of them across plans is no longer possible.
- **HARD CO-LOC #3 (Pitfall 17): closed in this commit cluster.** SDK-boundary unit test asserts CONSTITUTIONAL_PREAMBLE flows through; regression detector active.

---
*Phase: 29-weekly-review*
*Plan: 02 (HARD CO-LOC #2 + #3 ATOMIC — Sonnet generator + Stage-1 refine + Stage-2 Haiku judge + date-grounding + retry-cap + EN templated fallback + Pensieve persist + Telegram render)*
*Completed: 2026-04-28*
