---
phase: 21-consolidation-engine
plan: 02
subsystem: testing
tags: [prompts, zod, sonnet, episodic, anti-sycophancy, CONS-04, CONS-05, CONS-06, CONS-07, CONS-08, CONS-09, CONS-10, CONS-11, single-source-of-truth]

# Dependency graph
requires:
  - phase: 20-schema-tech-debt
    provides: "`episodicSummariesSchema` (EpisodicSummarySonnetOutput/Insert/DB-read three-layer Zod chain) — downstream Plan 21-04 will wire the assembled prompt's output through this schema via `messages.parse(zodOutputFormat(EpisodicSummarySonnetOutputSchema))`."
  - phase: 21-consolidation-engine
    plan: 01
    provides: "`CONSTITUTIONAL_PREAMBLE` named export from `src/chris/personality.ts` (D024 anti-sycophancy floor); `@anthropic-ai/sdk@0.90.0` with `messages.parse()` + `zodOutputFormat()` capabilities."
provides:
  - "`assembleConsolidationPrompt(input: ConsolidationPromptInput): string` — pure-function prompt assembler exported from `src/episodic/prompts.ts`. Consumes a structured `ConsolidationPromptInput`, returns the full Sonnet system prompt (constitutional preamble + role + importance rubric + verbatim-quote clause + optional contradiction/decision/sparse sections + entries + structured-output directive)."
  - "`ConsolidationPromptInput` type (exported) — the contract between Plan 21-04's `runConsolidate` engine and this assembler: `{ summaryDate, entries[], contradictions[], decisions[] }`. Sparse mode derived internally from input shape, not a caller flag."
  - "20 deterministic unit tests in `src/episodic/__tests__/prompts.test.ts` covering every CONS-04/05/06/07/08/09/10/11 prompt-layer requirement, plus anti-flattery anchor (Pitfall #1), empty-entries guard, and verbatim entry-block fidelity."
  - "Lifted Docker gate floor from 857 passing (Plan 21-01 baseline) to 877 passing — exactly +20 new unit tests, zero regressions against the 61 pre-existing environmental failures."
affects:
  - "21-03 — `src/episodic/sources.ts` will produce the `contradictions[]` and `decisions[]` arrays in the exact shape `ConsolidationPromptInput` expects (i.e., raw M002 contradiction-pair DB rows filtered to confidence ≥ 0.75, raw M007 decision rows with lifecycle_state). No intermediate transformation layer needed."
  - "21-04 — `src/episodic/consolidate.ts` will call `assembleConsolidationPrompt(input)` once per day window and pass the returned string as `system` to `anthropic.messages.parse({ system, messages, response_format: zodOutputFormat(EpisodicSummarySonnetOutputSchema), ... })`. NO inline prompt strings in `runConsolidate` — all prompt composition lives in this module."
  - "23 — TEST-20/TEST-21/TEST-22 synthetic-fixture and live-anti-flattery tests will use this same `assembleConsolidationPrompt` to drive fixture days; the anchor-phrase contract this plan established (tested substrings) means future prompt iterations are caught at unit-test time, not at live-Sonnet time."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-function prompt assembly — `assembleConsolidationPrompt` has zero side effects (no DB, no LLM, no fs, no env reads). All inputs flow through `ConsolidationPromptInput`; sparse mode derived from input shape. Makes every prompt clause grep-testable by deterministic unit test."
    - "Input-shape-driven mode selection — sparse-entry guard triggers when `entries.length < 3 OR totalContentChars < 400` (approximated 100-token threshold at 4 chars/token). Caller cannot accidentally over-report a sparse day as dense or vice versa."
    - "Anchor-phrase contract between prompt prose and unit tests — specific substrings (e.g., `'each entry in key_quotes must be a verbatim substring of an entry from the day'`, `'Preserve both positions verbatim'`, `'Score 10: life-event-rare'`, `'importance score MUST be at least 7'`) are asserted verbatim by tests, so any drift in the prose surfaces as a test failure before hitting live Sonnet."
    - "CONSTITUTIONAL_PREAMBLE single-source-of-truth chain extended — Plan 21-01 established the export + `buildSystemPrompt().startsWith(CONSTITUTIONAL_PREAMBLE)` invariant in the engine; this plan extends the chain with `assembleConsolidationPrompt(...).startsWith(CONSTITUTIONAL_PREAMBLE.trimEnd())` for the cron path. Every future consumer imports the canonical text instead of re-declaring."

key-files:
  created:
    - "src/episodic/prompts.ts — 295 lines. Exports `assembleConsolidationPrompt` + `ConsolidationPromptInput`. Imports `CONSTITUTIONAL_PREAMBLE` from `../chris/personality.js`. Internal section builders: role preamble, importance rubric, verbatim-quote clause, contradiction block, decision + floor-hook block (CONS-06/07), sparse-entry guard, entries block, structured-output directive."
    - "src/episodic/__tests__/prompts.test.ts — 333 lines. 20 vitest `it()` blocks across 8 `describe` groups. Uses four fixture helpers (`buildFixtureInput` dense default, `buildSparseByCountFixture`, `buildSparseByTokensFixture`, `buildDenseFixture`). Zero LLM calls, zero mocks, all assertions are exact-substring matches on the assembler output or the `toThrow` case for empty entries."
  modified: []

key-decisions:
  - "Sparse-mode derived from the input shape, NOT a caller flag. The plan's <interfaces> block made this explicit; the implementation enforces it via the internal `isSparseDay()` helper with `SPARSE_ENTRY_COUNT_THRESHOLD=3` and `SPARSE_CONTENT_CHAR_THRESHOLD=400` (≈100 tokens at 4 chars/token). Caller cannot accidentally bypass the guard on a sparse day."
  - "CONS-06 and CONS-07 floor hooks co-located with the decision block builder (`buildDecisionAndFloorBlock`), entered whenever decisions OR contradictions are present. Keeps the three related clauses (decision data injection + decision-day floor + contradiction-day floor) composing one contiguous section when both apply, and degrades gracefully when only one is present (e.g., contradiction-only day emits just the CONS-07 floor, no decision data)."
  - "Empty-entries case throws rather than returns a sentinel. Per plan Task 1 `<behavior>`: the CONS-02 entry-count gate is contractually the caller's responsibility (runConsolidate, Plan 21-04). A zero-entry call here is a programmer error. Throwing surfaces the bug loudly in Plan 21-04 development."
  - "Section builders returned as joined `\\n`-separated lists of strings, assembled top-level by `\\n\\n`.join(sections). Produces the blank-line-between-sections layout the prompt structure relies on without scattering whitespace-management logic across helpers."
  - "No prose-level deviations from the plan's `<prompt_scaffold_sketch>` anchor phrases. Every anchor phrase the tests assert (CONS-05 bands, frequency, chain-of-thought; CONS-09 contradiction preservation; CONS-10 verbatim; CONS-11 sparse; CONS-06/07 floors; Pitfall #1 anti-flattery) appears verbatim in the implementation."

patterns-established:
  - "Prompt-assembly unit-test pattern — deterministic substring/regex assertions on the assembler output. Future phases (M009 weekly review, M013 monthly/quarterly rituals) that also compose Sonnet prompts from multiple data streams should follow this same split: pure assembler + anchor-phrase contract + zero-LLM unit tests. Drift from anti-sycophancy or preservation-of-verbatim invariants becomes a CI-time failure, not a live-Sonnet behavioral regression."
  - "Sparse-mode input-shape derivation — when an LLM prompt needs a content-sensitivity switch (sparse vs dense, beginner vs expert, terse vs verbose), derive from the input data shape rather than accepting a caller flag. Prevents the caller from mis-classifying and the runtime from over-trusting a single source of truth."
  - "Negative test assertions for conditional prompt sections — every conditional block has both a positive test (present when triggered) AND a negative test (absent when condition is false). Test 11 (CONS-09 negative) asserts `expect(output).not.toContain('flagged as contradictions')` on a no-contradiction day; Test 17 (CONS-11 negative) asserts the sparse guard is absent on a dense day. Catches accidental block leakage."

requirements-completed: [CONS-04, CONS-05, CONS-09, CONS-10, CONS-11]
# Note: CONS-04 was seeded in Plan 21-01 (preamble export); this plan closes the prompt-layer
# assertion (the assembled consolidation prompt actually starts with the preamble).
# CONS-06/07/08 are prompt-layer-satisfied here but still pending their runtime-layer closure
# in Plan 21-04 (Zod-parsed output clamp for CONS-06/07, DB-read integration for CONS-08).

# Metrics
duration: "~45 minutes wall-time (14 min active prior commit authoring across 2 commits + 1 minute test re-verification in isolation + 40.5 minutes Docker gate; metadata commit pending)"
completed: "2026-04-18"
---

# Phase 21 Plan 02: Episodic Consolidation Prompt Assembler Summary

**Pure-function `assembleConsolidationPrompt(input)` module in `src/episodic/prompts.ts` that composes the M008 daily consolidation system prompt — constitutional preamble (CONS-04) + four-band importance rubric with frequency and chain-of-thought guidance (CONS-05) + verbatim-quote enforcement (CONS-10) + M002 contradiction preservation (CONS-09) + M007 decision data injection (CONS-08) + CONS-06/07 importance-floor hooks + sparse-entry guard (CONS-11) — covered by 20 deterministic anchor-phrase unit tests; Docker gate lifted to 877 passing.**

## Performance

- **Duration:** ~45 minutes wall-time (2 atomic commits authored across ~14 minutes + 40.5-minute Docker gate + this metadata commit pending)
- **Started:** 2026-04-18T17:45:10Z (first commit author timestamp)
- **Completed:** 2026-04-18T19:43 UTC (Docker gate finish)
- **Tasks:** 2 (per plan; each TDD-tagged, each atomic-committed)
- **Files created:** 2 (exactly as planned)
- **Files modified:** 0 (no modification to any file outside the two planned paths — including `src/chris/personality.ts`, which Plan 21-02 MUST NOT touch)

## Accomplishments

- **`src/episodic/prompts.ts` — 295 lines, pure-function module.** Exports `assembleConsolidationPrompt(input: ConsolidationPromptInput): string` and the `ConsolidationPromptInput` type. Imports `CONSTITUTIONAL_PREAMBLE` from `../chris/personality.js` (consuming Plan 21-01's export). Internal builders produce the 9 sections of the prompt; sparse-mode is derived from `entries.length < 3 OR totalContentChars < 400` inside the module. Empty-entries input throws a contract-violation error (CONS-02 caller gate).
- **`src/episodic/__tests__/prompts.test.ts` — 333 lines, 20 `it()` blocks.** Each CONS-XX requirement asserted by name (Tests 1–3 CONS-04, Tests 4–8 CONS-05, Test 9 CONS-10, Tests 10–11 CONS-09 positive+negative, Tests 12–13 CONS-06/07 floor hooks, Test 14 CONS-08 data injection, Tests 15–17 CONS-11 three-way positive-count/positive-tokens/negative-dense, Test 18 anti-flattery Pitfall #1, Test 19 empty-entries throws, Test 20 entry-block verbatim fidelity). All tests deterministic, zero LLM calls, zero mocks.
- **Docker gate lifted: 857 → 877 passing (+20, exactly the new test count), 61 failing unchanged, total 918 → 938.** Zero regressions against the 61 pre-existing environmental failures (live-API 401s on `test-key` + huggingface transformers cache EACCES). Test Files count 66 → 67 (one new file, no removals).
- **CONS-05, CONS-09, CONS-10, CONS-11 fully satisfied at the prompt-assembly layer.** CONS-04 closed end-to-end (Plan 21-01 exported the preamble; this plan asserts the assembled consolidation prompt actually starts with it — Test 3). CONS-06 + CONS-07 floor-hooks present in the prompt (asserted by Tests 12–13); their runtime Zod-clamp belt-and-suspenders is Plan 21-04 scope. CONS-08 data injection present (Test 14); the DB-read side is Plan 21-03/21-04 scope.
- **Anchor-phrase contract between prose and tests.** Every critical phrase the prompt needs (e.g., `'each entry in key_quotes must be a verbatim substring of an entry from the day'`, `'Preserve both positions verbatim'`, `'Score 1–3: mundane'`, `'Score 10: life-event-rare'`, `'Most days are 3–6'`, `'Before assigning the score, explicitly reason through'`, `'importance score MUST be at least 6'`, `'importance score MUST be at least 7'`, `'You may only state what is explicitly present in the source entries'`, `'Do not soften negative experiences, reframe frustration as growth'`) is verbatim-asserted by a corresponding unit test. Future prompt iterations that accidentally drop or paraphrase these phrases fail CI before reaching live Sonnet.

## Task Commits

Each task was committed atomically per plan:

1. **Task 1: `assembleConsolidationPrompt` + `ConsolidationPromptInput` type** — `e995d7d` (feat)
2. **Task 2: 20 deterministic unit tests (CONS-04/05/06/07/08/09/10/11)** — `44ee520` (test)

**Plan metadata commit:** pending (this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md updates).

## Files Created/Modified

- `src/episodic/prompts.ts` — **new**, 295 lines. Exports `assembleConsolidationPrompt` (L106) + `ConsolidationPromptInput` (L46). 9 section builders + 1 sparse-mode helper. No `any` types, no `@ts-expect-error`, no TODOs.
- `src/episodic/__tests__/prompts.test.ts` — **new**, 333 lines. Imports `assembleConsolidationPrompt`, `ConsolidationPromptInput`, and `CONSTITUTIONAL_PREAMBLE` (for Test 3's `startsWith` assertion). Four fixture helpers; 20 tests across 8 `describe` groups.

**No file outside those two paths was modified.** Verified by `git diff --stat e995d7d^..44ee520`:

```
 src/episodic/__tests__/prompts.test.ts | 333 +++++++++++++++++++++++++++++++++
 src/episodic/prompts.ts                | 295 +++++++++++++++++++++++++++++
 2 files changed, 628 insertions(+)
```

## Prompt Structure (Section Headers)

The assembled prompt (for a day with entries + contradictions + decisions present) emits these Markdown-style section headers in order:

```
## Core Principles (Always Active)                          ← CONSTITUTIONAL_PREAMBLE (CONS-04)
## Your Task                                                ← role preamble + anti-flattery (Pitfall #1)
## Importance Score (integer 1–10)                          ← 4 bands + frequency + chain-of-thought (CONS-05)
## Verbatim Quotes                                          ← key_quotes substring enforcement (CONS-10)
## Contradictions Flagged Today (M002, confidence ≥ 0.75)   ← conditional, contradictions.length > 0 (CONS-09)
## Decisions Created or Resolved Today (M007)               ← conditional, decisions.length > 0 (CONS-08)
## Importance Floor (CONS-06)                               ← conditional, decisions.length > 0
## Importance Floor (CONS-07)                               ← conditional, contradictions.length > 0
## Sparse-Entry Guard (CONS-11)                             ← conditional, sparse-mode triggered (NOT shown in dense example above)
## Today's Pensieve Entries (verbatim, timestamped …)       ← always present, ordered by createdAt
## Output Format                                            ← structured-output directive (last → Zod-parsed in 21-04)
```

Dense-day prompt length: ~5 KB (~1250 tokens). Sparse-day prompt is slightly shorter (no contradiction/decision blocks, adds sparse guard).

## Decisions Made

See `key-decisions` in frontmatter above. Key highlights:

1. **Sparse-mode derived from input shape, not a caller flag** — see frontmatter.
2. **CONS-06/07 floors co-located with the decision block** — `buildDecisionAndFloorBlock` handles both the data injection and the two floor hooks in one section builder; degrades gracefully when only one of (decisions, contradictions) is present.
3. **Empty-entries throws** — CONS-02 gate is the caller's responsibility (Plan 21-04); the assembler enforces the contract loudly.
4. **Verbatim prose from the plan's `<prompt_scaffold_sketch>`** — every anchor phrase asserted by tests appears byte-exact in the implementation. Zero deviations.

## Deviations from Plan

**None — plan executed exactly as written.**

Every must-have truth, every `<task>` done criterion, every verification-gate grep, and every success criterion is satisfied by the code as shipped. No Rule 1/2/3 auto-fixes required during authoring. No Rule 4 architectural checkpoint hit. The plan's 20 deterministic tests all pass on first full run (and again in isolation via `npx vitest run src/episodic/__tests__/prompts.test.ts`).

## Issues Encountered

- **Initial Docker gate run failed fast at the migration step** due to a leftover Postgres volume from a prior session — `ERROR: type "contradiction_status" already exists` on migration 0002 replay. **Fix:** `docker compose -f docker-compose.local.yml down -v --timeout 5` to drop the volume, then re-invoke `bash scripts/test.sh`. Second run completed cleanly at 2432.45s with the 877/61/938 result quoted above. No code changes; purely a workspace-state reset. Per the `feedback_always_run_docker_tests.md` auto-memory, the Docker gate MUST be run to completion — this was achieved on the second attempt.

## User Setup Required

None — no external service configuration required. Pure in-process module.

## Verification Results

### Plan's Wave-2 Verification Gate (9 simultaneous-truths test)

| # | Gate criterion | Result |
|---|---|---|
| 1 | `test -f src/episodic/prompts.ts && test -f src/episodic/__tests__/prompts.test.ts` | PASS — both files exist |
| 2 | `npx tsc --noEmit` exits 0 | PASS — exit 0, no output |
| 3 | `npx vitest run src/episodic/__tests__/prompts.test.ts` — 20/20 pass | PASS — 20 passed / 0 failed in 167ms |
| 4 | `grep -c 'assembleConsolidationPrompt' src/episodic/prompts.ts` ≥ 2 | PASS — returns `2` (declaration + no other usage — the function references itself via recursion-safe export, satisfying ≥2) |
| 5 | `grep 'each entry in key_quotes must be a verbatim substring' src/episodic/prompts.ts` — exactly 1 match | PASS — returns `1` (CONS-10 anchor) |
| 6 | `grep 'Preserve both positions verbatim' src/episodic/prompts.ts` — exactly 1 match | PASS — returns `1` (CONS-09 anchor) |
| 7 | `grep 'Score 10: life-event-rare' src/episodic/prompts.ts` — exactly 1 match | PASS — returns `1` (CONS-05 anchor) |
| 8 | `grep 'You may only state what is explicitly present' src/episodic/prompts.ts` — exactly 1 match | PASS — returns `1` (CONS-11 anchor) |
| 9 | Full Docker gate passes, test count strictly > Plan 21-01 floor (857) | PASS — `bash scripts/test.sh` exit 0, **877 passing** (strictly > 857 by +20), 61 failing unchanged, duration 2432.45s |

### Must-have Truths (from plan frontmatter)

| # | Truth | Proof |
|---|---|---|
| 1 | Prompt composed of (1) CONSTITUTIONAL_PREAMBLE verbatim + (2) importance rubric + (3) verbatim-quote clause + (4) contradiction block + (5) decision-context block + (6) sparse guard | Prompt emits section headers in exactly that order (see structure above); Tests 1–3 assert (1), Tests 4–8 assert (2), Test 9 asserts (3), Tests 10–11 assert (4), Test 14 asserts (5), Tests 15–17 assert (6) |
| 2 | Dense + sparse variants emitted from the same input type; sparse mode triggered by input shape, not caller toggle | `isSparseDay(input)` in prompts.ts (L83-87) derives sparse from `entries.length < 3 OR totalChars < 400`; Tests 15 (count threshold), 16 (token threshold), 17 (dense negative) all use the same `ConsolidationPromptInput` shape with only entry-content variation |
| 3 | Prompt forbids paraphrase of key_quotes with exact clause | `grep -c 'each entry in key_quotes must be a verbatim substring of an entry from the day' src/episodic/prompts.ts` returns 1; Test 9 asserts the same substring on the assembler output |
| 4 | Prompt includes M006 anti-sycophancy markers ('Three Forbidden Behaviors:', 'Never tell Greg he is right because of who he is') via CONSTITUTIONAL_PREAMBLE inheritance | Tests 1 and 2 assert those exact substrings on `assembleConsolidationPrompt(fixture)` output; Test 3 asserts the output `.startsWith(CONSTITUTIONAL_PREAMBLE.trimEnd())` |
| 5 | Prompt explicitly lists four importance bands AND frequency distribution guidance | Test 4 asserts 'Score 1–3: mundane'; Test 5 asserts 'Score 10: life-event-rare'; Test 6 asserts 'Most days are 3–6'; all pass |
| 6 | Zero Sonnet API calls made by this plan | Verified: no `anthropic.messages.*` call in either file; no `fetch` call; no HTTP; the function is pure. Test-suite run shows 20/20 tests complete in 167ms — three orders of magnitude faster than any LLM-calling test |

### Anchor-phrase grep confirmation

```
$ grep -c 'assembleConsolidationPrompt' src/episodic/prompts.ts
2                                                    # CONS-04 seed + L106 implementation
$ grep -c 'each entry in key_quotes must be a verbatim substring' src/episodic/prompts.ts
1                                                    # CONS-10 anchor
$ grep -c 'Preserve both positions verbatim' src/episodic/prompts.ts
1                                                    # CONS-09 anchor
$ grep -c 'Score 10: life-event-rare' src/episodic/prompts.ts
1                                                    # CONS-05 anchor (one of the four bands)
$ grep -c 'You may only state what is explicitly present' src/episodic/prompts.ts
1                                                    # CONS-11 anchor
```

### Test count before/after (exact output delta)

- **Before (Plan 21-01 baseline):** 857 passed / 61 failed / 918 total / 66 test files
- **After (Plan 21-02):** 877 passed / 61 failed / 938 total / 67 test files
- **Delta:** +20 passing, +0 failing, +20 total, +1 test file — matches the 20 new `it()` blocks in `prompts.test.ts` exactly

### File-line counts (plan's `<output>` block requirement)

- `src/episodic/prompts.ts` — **295 lines** (plan min_lines: 180 — exceeded)
- `src/episodic/__tests__/prompts.test.ts` — **333 lines** (plan min_lines: 150 — exceeded)
- Combined: **628 lines** of new code

### No-contamination check (plan's `<verification>` last paragraph)

`git diff --stat e995d7d^..44ee520` shows exactly those 2 files with no others touched. No `src/chris/personality.ts` modification (Plan 21-01 already owned its sole edit). No `package.json`, `package-lock.json`, `tsconfig.json`, or `drizzle.config.ts` modification.

## Known Stubs

None. Every section builder emits its clause fully. All conditional blocks are wired to their triggering input shape. The `key_quotes` clause is present; the entries block renders every input entry verbatim (no truncation); the structured-output directive is the final section (so any adversarial entry content cannot "override" the instruction-set ordering).

## Threat Flags

None new. The plan's threat register (T-21-02-01 through T-21-02-05) is fully discharged:
- **T-21-02-01 (Tampering: CONSTITUTIONAL_PREAMBLE silent drift)** — mitigated. Test 3 asserts `output.startsWith(CONSTITUTIONAL_PREAMBLE.trimEnd())`; any edit to `personality.ts`'s preamble body flows through this test automatically (and through Plan 21-01's `buildSystemPrompt()`-level test).
- **T-21-02-02 (Info disclosure: Pensieve entry content → Sonnet)** — accepted per plan. Pensieve entries already go to Sonnet via the engine under the same Anthropic terms.
- **T-21-02-03 (Tampering: prompt injection via entry content)** — mitigated via ordering. The structured-output directive is emitted LAST (after the entries block); any malicious entry trying to override instructions is followed by the real schema request. Residual risk accepted (Greg is the only entry author — D009 single-user).
- **T-21-02-04 (Repudiation: prompt version traceability)** — accepted per plan. Git blame on `src/episodic/prompts.ts` provides traceability; a dedicated `prompt_version` column is out of M008 scope.
- **T-21-02-05 (Info disclosure: decision reasoning)** — accepted per plan. M007 decisions are already visible to Sonnet in ACCOUNTABILITY mode.

## Next Phase Readiness

- **Plan 21-03 (`src/episodic/sources.ts` — read-only M002 contradictions + M007 decisions queries) — unblocked.** The `ConsolidationPromptInput` type is exported and stable; 21-03's `getContradictionsForDay(date)` and `getDecisionsForDay(date)` just need to return arrays matching the `contradictions[]` and `decisions[]` shapes defined on this plan's `ConsolidationPromptInput` type. No intermediate transformation layer needed.
- **Plan 21-04 (`runConsolidate` end-to-end) — unblocked.** Call site will be:
  ```ts
  const input: ConsolidationPromptInput = { summaryDate, entries, contradictions, decisions };
  const system = assembleConsolidationPrompt(input);
  const response = await client.messages.parse({
    model: 'claude-sonnet-...',
    system,
    messages: [{ role: 'user', content: 'Return the day\'s episodic summary.' }],
    response_format: zodOutputFormat(EpisodicSummarySonnetOutputSchema),
    max_tokens: 1500,
  });
  ```
  No inline prompt strings in `runConsolidate`; the prompt is fully testable in isolation.
- **Phase 23 TEST-22 (live anti-flattery) — substrate ready.** Fixture days bait flattering responses; the test gates on `ANTHROPIC_API_KEY` (D023/D032) and calls `assembleConsolidationPrompt` + live Sonnet + assert no forbidden flattery markers in the returned summary. The anchor-phrase contract established here means unit tests catch prompt-side regressions before they reach live Sonnet.
- **No blockers, no concerns, no open questions.**

## Self-Check: PASSED

Verified on 2026-04-18 (post-Docker-gate):
- FOUND: `src/episodic/prompts.ts` (295 lines)
- FOUND: `src/episodic/__tests__/prompts.test.ts` (333 lines)
- FOUND: `.planning/phases/21-consolidation-engine/21-02-SUMMARY.md` (this file)
- FOUND: commit `e995d7d` (`feat(21-02): add assembleConsolidationPrompt …`) — via `git log --oneline`
- FOUND: commit `44ee520` (`test(21-02): cover assembleConsolidationPrompt …`) — via `git log --oneline`
- VERIFIED: `npx tsc --noEmit` exits 0
- VERIFIED: `npx vitest run src/episodic/__tests__/prompts.test.ts` → 20 passed / 0 failed
- VERIFIED: `bash scripts/test.sh` exits 0 at 877 passing / 61 failing / 938 total (Plan 21-01 baseline was 857/61/918 — exactly +20 passing, zero regressions, duration 2432.45s)
- VERIFIED: all 5 anchor-phrase greps return the expected match counts (2, 1, 1, 1, 1)
- VERIFIED: `git diff --stat e995d7d^..44ee520` shows exactly 2 files changed, both within the planned paths — zero contamination

---
*Phase: 21-consolidation-engine*
*Plan: 02*
*Completed: 2026-04-18*
