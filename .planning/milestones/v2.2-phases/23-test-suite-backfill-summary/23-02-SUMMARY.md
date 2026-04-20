---
phase: 23-test-suite-backfill-summary
plan: 02
subsystem: operations
tags: [backfill, ops, cli, idempotency, OPS-01, CONS-03, episodic, tsx, parseArgs]

# Dependency graph
requires:
  - phase: 21-consolidation-engine
    provides: "runConsolidate(date) discriminated ConsolidateResult ({ inserted: true; id } | { skipped: 'existing'|'no-entries' } | { failed; error }), CONS-03 idempotency (pre-flight SELECT + ON CONFLICT DO NOTHING) the script relies on without re-implementing, CONS-02 entry-count gate that produces { skipped: 'no-entries' } for empty days. The backfill calls runConsolidate per-day with explicit historical Dates and trusts these contracts unmodified."
  - phase: 23-test-suite-backfill-summary
    provides: "Plan 23-01 synthetic-fixture.test.ts mocked-Sonnet pattern (vi.hoisted + vi.mock against src/llm/client.js + src/bot/bot.js). Plan 23-02 reuses the same pattern verbatim for the backfill integration test, including the ConsolidateResult shape reconciliation Plan 23-01 documented in TEST-19."
provides:
  - "scripts/backfill-episodic.ts (272 lines) — operator script for day-by-day episodic consolidation backfill. CLI: --from YYYY-MM-DD --to YYYY-MM-DD with full validation (both required, regex match, parseable dates, from <= to, not future, span <= 365 days). Iterates ascending in UTC, calls runConsolidate per-day, sleeps 2s between days (INTER_DAY_DELAY_MS, OPS-01 verbatim), structured logger.info/error per day with { date, result, ... }, continue-on-error semantics (single-day failures logged + counted, backfill proceeds — D-22). Exports runBackfill(from, to, opts?) for programmatic test use; opts.delayMs lets tests bypass the 2s sleep. ESM main() guard so the script does not auto-run when imported by tests."
  - "src/episodic/__tests__/backfill.test.ts (359 lines) — 3 it() blocks under describe('OPS-01: scripts/backfill-episodic.ts integration'): (1) first-run happy path with 3-day range + 2 entries/day → 3 inserts + Sonnet called 3× + importances 3/4/5 land unclamped; (2) Phase 23 Success Criterion #2 idempotency proof — second run returns { inserted: 0, skipped: 3, errored: 0 } AND mockAnthropicParse.toHaveBeenCalledTimes(0) (CONS-03 pre-flight SELECT short-circuits before Sonnet); (3) zero-entry day (CONS-02) — middle day with no entries skipped without errored, surrounding days still insert, exactly 2 Sonnet calls, exactly 2 rows."
  - "Excluded-suite Docker gate raised from 973 (Plan 23-01 baseline) to 976 — exactly +3 from this plan, zero regressions against the 15 documented environmental failures (3 models-smoke API-gated + 7 engine-mute + 5 photos-memory)."
affects:
  - "Phase 23 Plan 03 (CMD-01 /summary handler) — independent of OPS-01; can proceed in parallel. The fixture-style mocked-Sonnet pattern from Plan 23-01 + 23-02 remains the model for handler integration tests (D-34 a-e, +5 expected)."
  - "Phase 23 Plan 04 (TEST-22 live anti-flattery) — independent; gated by ANTHROPIC_API_KEY."
  - "M008 operational readiness — Greg's ~5-day historical backlog (2026-04-13 through 2026-04-17) can now be backfilled before M009 weekly review's first run. The script is also the long-term recovery tool if the cron fails for N consecutive days (operator runs --from $lastGoodDate --to $today)."
  - "M009 weekly review (planned) — episodic_summaries rows produced by either the cron (Phase 22) or this backfill are the substrate. M009 will read them via getEpisodicSummariesRange (Phase 22 RETR-01 sibling)."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "node:util parseArgs with strict + allowPositionals=false — validates --from/--to as the only allowed flags. Rejects any positional arg or unknown flag at the parser level (caught and re-wrapped as UsageError for consistent CLI error UX)."
    - "Luxon DateTime for arg validation + iteration — DateTime.fromISO(s, { zone: 'utc' }).isValid catches malformed dates that the regex passes (e.g. '2026-02-31'); .plus({ days: 1 }) for ascending iteration. Same dependency stack as Phase 21 consolidate.ts so no new dep added."
    - "Discriminated ConsolidateResult handling — script branches on `'inserted' in result`, `'skipped' in result`, `'failed' in result` and counts each into BackfillTotals. The 'failed' branch logs and counts as errored WITHOUT re-throwing (D-22 continue-on-error), which is the operational reason backfill exists at all (resumability via CONS-03 idempotency)."
    - "ESM main() guard via `import.meta.url === \\`file://${process.argv[1]}\\`` — script auto-runs when invoked via tsx, stays inert when imported by the integration test. Same convention used by tsx-runnable scripts in the wider Node ecosystem; first introduction in this codebase."
    - "delayMs option on the programmatic entrypoint — runBackfill(from, to, { delayMs: 0 }) bypasses the 2s inter-day sleep in tests. CLI default stays 2000 (OPS-01 verbatim). Keeps test suite fast (732ms) without weakening the production rate-limit contract."
    - "Cleanup scoped to source='backfill-test' in pensieve_entries — same pattern as Plan 23-01 synthetic-fixture's source='synthetic-fixture'. Allows two episodic test files to coexist under vitest fileParallelism: false serial execution without cross-cleanup races. FIXTURE_CHAT_ID=BigInt(99924) keeps decisions/contradictions distinct from synthetic-fixture's 99923."

key-files:
  created:
    - "scripts/backfill-episodic.ts (272 lines) — the operator script. Imports: node:util parseArgs, luxon DateTime, src/episodic/consolidate.runConsolidate, src/utils/logger. Exports: parseCliArgs(argv), iterateDates(from, to), BackfillTotals interface, runBackfill(from, to, opts?). CLI entry: main() runs only when import.meta.url matches process.argv[1] (ESM guard)."
    - "src/episodic/__tests__/backfill.test.ts (359 lines) — 3 it() blocks: first-run happy path (3 inserts + importances 3/4/5), idempotency (Phase 23 SC#2 — 0 new inserts + 0 Sonnet calls), zero-entry day (CONS-02 — middle day skipped, surrounding days insert). Imports: vitest, drizzle-orm (sql, eq, inArray), luxon, src/db/connection (db, sql as pgSql), src/db/schema (pensieveEntries, episodicSummaries), src/episodic/types (EpisodicSummarySonnetOutput type), scripts/backfill-episodic (runBackfill — cross-directory ESM import). Mocks: src/llm/client (anthropic.messages.parse + .create), src/bot/bot (bot.api.sendMessage). FIXTURE_CHAT_ID=BigInt(99924), FIXTURE_DATES=['2026-04-01','2026-04-02','2026-04-03']."
  modified: []

key-decisions:
  - "ConsolidateResult shape carried forward from Plan 23-01: the backfill explicitly handles `'inserted' in result` / `'skipped' in result` / `'failed' in result` and counts each. The 'failed' branch logs and counts as errored without re-throwing, matching the documented Plan 23-01 reconciliation (consolidate.ts L94-98 contract). The plan's example used `{ skipped: true }` pseudocode; the script and its test both assert against the actual discriminated shape."
  - "Future-date check uses UTC (not config.proactiveTimezone) as the boundary — conservative on purpose. A date that is 'past' in Paris might still be 'today' in UTC; rejecting ambiguous boundary cases is preferable to risking a half-complete summary for an in-progress day."
  - "365-day span safety valve (D-19) included as a pragma — historical backfills with no bound are a footgun. Operators with a > 365-day backfill need to split into multiple invocations explicitly. The error message names the limit so the operator immediately knows the next step."
  - "ESM main() guard pattern — the file is dual-purpose (CLI when run directly via tsx, library when imported by tests). The `import.meta.url === \\`file://${process.argv[1]}\\`` check is the standard ESM idiom; first time this codebase needs it because no prior script needed test-importable internals."
  - "delayMs: 0 test-only option on runBackfill — CLI keeps the OPS-01 2000ms default; tests pass 0 to keep the suite fast. The contract that the CLI uses 2000ms is enforced in code (INTER_DAY_DELAY_MS const) and verified in the script's grep gate (must contain '2000' literal). The tests do not assert on the production delay value because doing so would force every test run to wait 4+ seconds; the CLI grep is the contract."
  - "Cross-directory import (test → scripts/) — vitest+esbuild resolves the .ts source at runtime; tsconfig.json excludes src/**/__tests__/** so tsc never type-checks the test file's import. The pattern works because vitest's transformer is independent of the project tsc config. Verified by 3/3 passing tests in 732ms — no module-resolution failures."
  - "Cleanup scope: TRUNCATE episodic_summaries CASCADE + DELETE pensieve_entries WHERE source='backfill-test'. We do NOT TRUNCATE pensieve_entries because vitest's serial execution may have other test files with rows in flight; scoping by source isolates the backfill fixture from the synthetic-fixture's 'synthetic-fixture' source rows."

patterns-established:
  - "Operator script with both CLI and programmatic entrypoints — `export async function runBackfill(...)` for tests; `main()` ESM-guarded for `npx tsx` direct invocation. Reusable for any future operator script that benefits from integration test coverage (recovery tools, migration shims, one-off data fixes)."
  - "Continue-on-error semantics in batch loops — a single-day exception is caught, counted as errored in the aggregate totals, and the loop proceeds. The script's exit code reflects 'did the sweep complete' (always 0 if it visited every date), not 'did every day succeed' (operator inspects per-day logs for that). Matches the resumability-first design of CONS-03 idempotency."
  - "Cross-directory ESM imports between test and scripts/ — vitest+esbuild handles `import { runBackfill } from '../../../scripts/backfill-episodic.js'` even though tsconfig excludes the test file from compilation. Pattern is now proven; future operator scripts can ship with co-located integration tests under src/<feature>/__tests__/."
  - "FIXTURE_CHAT_ID banding — Plan 23-01 used 99923, Plan 23-02 uses 99924. Future test files in the episodic family pick the next free number in the 9992X band; the synthetic-fixture's intentional decision NOT to add to src/__tests__/fixtures/chat-ids.ts is preserved here for the same reason (frontmatter-table revision overhead vs. local-constant simplicity)."

requirements-completed: [OPS-01]

# Metrics
duration: "17m"
completed: "2026-04-19"
---

# Phase 23 Plan 02: Backfill Operator Script Summary

**`scripts/backfill-episodic.ts` operator script with --from/--to CLI flags, 2-second day-by-day rate-limited invocation of Phase 21's runConsolidate, idempotent-by-design via CONS-03 (no checkpoint file), continue-on-error per-day logging, and a 3-block integration test that proves Phase 23 Success Criterion #2 (re-run produces 0 new inserts and 0 Sonnet calls).**

## Performance

- **Duration:** ~17 min wall-time
- **Started:** 2026-04-19T09:03:40Z
- **Completed:** 2026-04-19T09:20:42Z
- **Tasks:** 3 (per plan)
- **Files created:** 2 (scripts/backfill-episodic.ts, src/episodic/__tests__/backfill.test.ts)
- **Files modified:** 0

## Accomplishments

- **scripts/backfill-episodic.ts** ships as an executable operator tool. CLI accepts `--from YYYY-MM-DD --to YYYY-MM-DD` via `node:util` `parseArgs` (strict, no positionals), validates both flags required + regex-matched + parseable dates + from <= to + not in the future + span <= 365 days, exits 1 with a usage message on any failure. Sequentially walks the date range ascending in UTC, calls `runConsolidate(date)` per day, sleeps 2s (`INTER_DAY_DELAY_MS`, OPS-01 verbatim) between invocations, logs each day's outcome via `logger.info`/`logger.error` with structured `{ date, result, ... }` fields. Continue-on-error: a single-day exception is caught, logged, counted as errored, and the loop proceeds (D-22). Exits 0 when the sweep completes (even if every day errored or skipped — a completed sweep is a successful invocation; per-day failures live in the structured log).
- **`runBackfill(from, to, opts?)` programmatic entrypoint** exported for the integration test. Returns `{ total, inserted, skipped, errored }` aggregate counts so tests can assert on aggregate outcomes without parsing log lines. The `opts.delayMs` parameter (default `INTER_DAY_DELAY_MS` = 2000) lets tests pass `delayMs: 0` to bypass the 2s inter-day sleep; the CLI never overrides the default, keeping the OPS-01 2000ms contract enforced in production while keeping the test suite fast (732ms for 3 tests).
- **ESM main() guard** via `import.meta.url === \`file://${process.argv[1]}\`` so the script auto-runs only when invoked directly via `npx tsx scripts/backfill-episodic.ts`; when imported by `src/episodic/__tests__/backfill.test.ts`, the guard is false and `main()` does not execute. First use of this idiom in the codebase; documented in-source for future tsx scripts that want test-importable internals.
- **ConsolidateResult contract reconciliation carried forward from Plan 23-01.** The script handles all three discriminated shapes: `{ inserted: true; id }` increments `inserted`; `{ skipped: 'existing' | 'no-entries' }` increments `skipped` and logs the reason; `{ failed: true; error }` increments `errored` and logs the error WITHOUT re-throwing (resumability is the point — CONS-03 lets the operator re-run with the same range and pick up exactly where failures happened). The plan's pseudocode used `{ skipped: true }` boolean shape; the actual contract per `consolidate.ts` L94-98 is the discriminated string shape, same reconciliation Plan 23-01's TEST-19 documented.
- **Integration test (`src/episodic/__tests__/backfill.test.ts`)** ships with 3 it() blocks under `describe('OPS-01: scripts/backfill-episodic.ts integration')`:
  1. **First-run happy path** — seeds 2 Pensieve entries per day for 3 fixture dates (2026-04-01..03), queues 3 distinct mocked Sonnet outputs with importance 3/4/5, runs `runBackfill('2026-04-01', '2026-04-03', { delayMs: 0 })`, asserts `total: 3, inserted: 3, skipped: 0, errored: 0`, asserts mockAnthropicParse called exactly 3×, asserts 3 rows materialized in `episodic_summaries`, asserts the per-date importances (3/4/5) flow through unclamped (no decision/contradiction → neither CONS-06 nor CONS-07 applies).
  2. **Idempotency (Phase 23 Success Criterion #2)** — re-runs the same range after the first run, asserts `inserted: 0, skipped: 3, errored: 0` AND `mockAnthropicParse.toHaveBeenCalledTimes(0)`. The zero-Sonnet-call assertion is the core proof that CONS-03's pre-flight SELECT (consolidate.ts L216-227) short-circuits before reaching `callSonnetWithRetry`. Row count remains 3 — the first-run rows are unchanged.
  3. **Zero-entry day (CONS-02)** — seeds entries for day 1 and day 3 only, queues exactly 2 mocked Sonnet outputs, runs the same range. Day 2 goes through CONS-02's entry-count gate (consolidate.ts L229-237) and returns `{ skipped: 'no-entries' }`. Asserts `inserted: 2, skipped: 1, errored: 0`, asserts mockAnthropicParse called exactly 2× (no Sonnet call for the empty day), asserts exactly 2 rows in `episodic_summaries` with dates `['2026-04-01', '2026-04-03']`.
- **Targeted vitest run: 3/3 passed / 732ms.** Excluded-suite Docker gate: 976 passed / 15 failed / 991 total / 27.79s = +3 vs the 973 Plan 23-01 baseline, zero regressions. The 15 environmental failures match the documented Plan 23-01 / Phase 22 baseline EXACTLY (3 × `llm/__tests__/models-smoke.test.ts` API-gated + 7 × `chris/__tests__/engine-mute.test.ts` + 5 × `chris/__tests__/photos-memory.test.ts`).

## Task Commits

Each task was committed atomically:

1. **Task 1: scripts/backfill-episodic.ts (OPS-01 operator backfill)** — `9d0771f` (feat)
2. **Task 2: backfill integration test (3 it() blocks)** — `a5f3a2c` (test)
3. **Task 3: Final gate — Docker test run** — verification-only, no commit (mitigation per Plan 23-01 documented pattern; full `bash scripts/test.sh` hung at the documented vitest 4 fork-mode IPC hang under HuggingFace cache EACCES; documented excluded-suite mitigation produced 976 passed / 15 failed = +3 vs baseline)

**Plan metadata commit:** pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS update — final commit below).

## Files Created/Modified

- **`scripts/backfill-episodic.ts`** (NEW, 272 lines) — Operator script. Exports: `parseCliArgs(argv)`, `iterateDates(from, to)`, `BackfillTotals`, `runBackfill(from, to, opts?)`. CLI entrypoint via ESM main() guard. Imports: `node:util` parseArgs, luxon DateTime, `runConsolidate` from `src/episodic/consolidate.js`, `logger` from `src/utils/logger.js`. Constants: `INTER_DAY_DELAY_MS=2000` (OPS-01), `MAX_SPAN_DAYS=365` (D-19 safety valve).
- **`src/episodic/__tests__/backfill.test.ts`** (NEW, 359 lines) — Integration test. 3 it() blocks. Imports: vitest hooks, drizzle-orm (sql, eq, inArray), luxon DateTime, `db` + `sql as pgSql` from `src/db/connection.js`, `pensieveEntries` + `episodicSummaries` from `src/db/schema.js`, `EpisodicSummarySonnetOutput` type from `src/episodic/types.js`, `runBackfill` from `scripts/backfill-episodic.js`. Mocks: `src/llm/client.js` (anthropic.messages.parse + create), `src/bot/bot.js` (bot.api.sendMessage). FIXTURE_CHAT_ID=BigInt(99924), FIXTURE_DATES=['2026-04-01','2026-04-02','2026-04-03'], FIXTURE_TZ='Europe/Paris'. Cleanup: TRUNCATE episodic_summaries CASCADE + DELETE pensieve_entries WHERE source='backfill-test'.

## Decisions Made

- **ConsolidateResult shape reconciliation** carried forward from Plan 23-01 — script handles `'inserted' in result` / `'skipped' in result` / `'failed' in result` discriminated branches; the `'failed'` branch logs and counts WITHOUT re-throwing (D-22 continue-on-error). The plan's `{ skipped: true }` pseudocode is incorrect against `consolidate.ts` L94-98; this plan adopts the actual contract end-to-end.
- **UTC as the future-date boundary** — conservative on purpose. A date that is "past" in Europe/Paris might still be "today" in UTC; the script rejects ambiguous boundary cases rather than risk a half-complete summary for a still-in-progress day.
- **365-day span safety valve** (D-19) — historical backfills with no bound are a footgun. The error message names the limit ("split into multiple invocations") so the operator immediately knows the next step.
- **ESM main() guard pattern** — first use of `import.meta.url === \`file://${process.argv[1]}\`` in this codebase. Enables dual-purpose script (CLI + library) without two source files.
- **`delayMs: 0` test option** — runBackfill takes `opts.delayMs` so tests bypass the 2s sleep; CLI uses the 2000ms default unconditionally (enforced via the `INTER_DAY_DELAY_MS` const + the verify-step grep that requires the literal "2000" in the script source).
- **Cross-directory test→scripts/ ESM import** — proven workable: vitest + esbuild resolves the .ts source at runtime; tsconfig excludes the test file from tsc compilation so the cross-rootDir import is never type-checked. 3/3 passing tests confirm the runtime resolution works.
- **Cleanup scope** — TRUNCATE episodic_summaries CASCADE (file is sole writer in test gate) + scoped DELETE pensieve_entries WHERE source='backfill-test'. Avoids cross-cleanup races with the synthetic-fixture's 'synthetic-fixture' source rows under vitest's serial fileParallelism: false execution.
- **FIXTURE_CHAT_ID = BigInt(99924)** — distinct from Plan 23-01's 99923 (synthetic-fixture). Future episodic test files pick the next free 9992X.

## Deviations from Plan

None — plan executed exactly as written.

The plan's Task 1 narrative explicitly anticipated the ConsolidateResult shape reconciliation ("If the Phase 21 return type for `runConsolidate` differs (e.g., `{ status: 'skipped' | 'inserted' }`), adapt the switch.") so the discriminated-shape handling is not a deviation — it is the documented adaptation path the plan invited. Plan 23-01 already documented the same reconciliation as Rule-1 deviation #1 in its TEST-19; this plan inherits that reconciliation as a key-decision rather than re-logging it.

The plan's Task 2 import-path caveat ("If [tsconfig] doesn't [include scripts/], an alternative is to spawn the CLI via `child_process.spawnSync(...)`") was anticipatory — the cross-directory ESM import via vitest + esbuild works directly without any tsconfig change, so the alternative path was not needed. The targeted test run (3/3 passed in 732ms) confirms the runtime resolution.

**Total deviations:** 0 (zero auto-fixes; zero scope expansions). All design choices are plan-anticipated key-decisions or carried-forward Plan 23-01 reconciliations.

## Issues Encountered

**1. Vitest 4 fork-mode IPC hang under HuggingFace cache EACCES (recurred in the full Docker run).**

Same documented pattern as Plan 22-02/22-03/22-04/22-05/23-01 SUMMARYs. The first `bash scripts/test.sh` run hung after ~340 seconds at the live-integration loop and was terminated by the 540s timeout (FINAL_EXIT=143 = SIGTERM). Applied the documented excluded-suite mitigation:

```bash
DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris \
  ANTHROPIC_API_KEY=test-key TELEGRAM_BOT_TOKEN=test-token \
  TELEGRAM_AUTHORIZED_USER_ID=99999 \
  npx vitest run \
  --exclude '**/live-integration.test.ts' \
  --exclude '**/live-accountability.test.ts' \
  --exclude '**/vague-validator-live.test.ts' \
  --exclude '**/contradiction-false-positive.test.ts'
```

Result: **976 passed / 15 failed / 991 total / 27.79s = +3 vs 973 Plan 23-01 baseline, zero regressions.** The 15 remaining failures match the documented Phase 22 / Plan 23-01 baseline exactly:

- 3 × `llm/__tests__/models-smoke.test.ts` (real Anthropic API calls — 401 with `test-key`)
- 7 × `chris/__tests__/engine-mute.test.ts` (pre-existing engine-mute issues)
- 5 × `chris/__tests__/photos-memory.test.ts` (pre-existing photos-memory issues)

No new regressions introduced by Plan 23-02. The mitigation will be carried forward through Plans 23-03 / 23-04 until the upstream Vitest 4 + @huggingface/transformers EACCES issue is resolved.

## Threat Model

- **T-23-02-01 (T — operator runs backfill against wrong date range) — mitigated by arg validation.** The script rejects future dates, mismatched from > to, malformed strings, and ranges > 365 days. The CLI's `--from`/`--to` flags are explicit (no positional args; no `--yesterday`/`--last-week` shortcuts) so an operator typo on the date string is caught before any DB write happens.
- **T-23-02-02 (T — Anthropic API rate-limit exhaustion during a long backfill) — mitigated by per-day 2-second sleep.** PITFALLS.md #14 documented the risk; OPS-01 specified 2s as the rate-limit-safe floor. The script enforces this via INTER_DAY_DELAY_MS=2000 between days. Greg-scale (~5 days) backfills cost <15s of wall-time; the 365-day safety valve caps worst-case to ~12 minutes of paced API calls.
- **T-23-02-03 (T — second run of the script duplicates summary rows) — mitigated by Phase 21 CONS-03 + asserted by the integration test.** The script does NOT add its own duplicate check — relies entirely on CONS-03's pre-flight SELECT + ON CONFLICT DO NOTHING. The integration test's second `it()` block is the live proof: re-running the same range produces 0 new inserts AND 0 Sonnet calls. If CONS-03 ever regresses, this test fails first.
- **T-23-02-04 (D — single-day error aborts the whole backfill) — mitigated by D-22 continue-on-error.** A `runConsolidate` exception (Anthropic 5xx, transient DB error, schema-validation failure) is caught at the script level, logged with `{ date, error }`, counted as errored in the totals, and the loop proceeds to the next day. Operator inspects per-day logs to see which dates need re-run; CONS-03 idempotency means re-runs are safe.
- **T-23-02-05 (I — log content includes Pensieve entry details) — accepted.** The structured log lines contain `{ date, result, importance?, topics? }` but NOT raw Pensieve entry content. Future-summary IDs are logged on insert. No PII leakage beyond what already lives in the consolidation log lines from `consolidate.ts`'s own `logger.info` calls.
- **T-23-02-06 (T — script imports Phase 21 internals; future Phase 21 refactor breaks the script silently) — mitigated by the integration test.** The test exercises the full runConsolidate→insert path against real Postgres + mocked Anthropic. Any Phase 21 contract drift (return shape, function signature, side-effect changes) surfaces as a test failure on the next Docker gate run.

## Next Phase Readiness

- **Plan 23-02 complete.** OPS-01 satisfied end-to-end. The operator script is shippable; the integration test asserts Phase 23 Success Criterion #2 (idempotent re-run = 0 new inserts).
- **Plan 23-03 (CMD-01 /summary handler) ready.** Independent of OPS-01; expected delta +5 tests (D-34 cases a-e). The fixture-style mocked-Sonnet pattern from Plans 23-01 + 23-02 remains the model.
- **Plan 23-04 (TEST-22 live anti-flattery) ready.** Independent; gated by ANTHROPIC_API_KEY (`describe.skipIf(!process.env.ANTHROPIC_API_KEY)`). Expected delta +1 test (counts when the API key is present).
- **Operational milestone:** Greg's ~5-day backlog (2026-04-13..04-17) can now be backfilled with one invocation: `npx tsx scripts/backfill-episodic.ts --from 2026-04-13 --to 2026-04-17` — Greg-scale wall-time ≈ 8s of paced API calls + per-day Sonnet processing.
- **Test count progression:** Plan 23-01 baseline 973 → Plan 23-02 result 976 (+3 from backfill.test.ts). Phase 23 contractual floor (> 152) cleared by 824. Phase 23 planner-target (≥ 165) cleared by 811.
- **No new tech debt introduced.** Two new files, fully tested (3/3 passing in the targeted run). No new dependencies (parseArgs is `node:util` builtin; luxon and pino are existing deps).

## Self-Check: PASSED

Verified all claims:

- [x] `scripts/backfill-episodic.ts` exists (272 lines, > 80 plan minimum)
- [x] File contains literal `--from` AND `--to` strings (CLI flags) AND `YYYY-MM-DD`
- [x] File contains `parseArgs` (from node:util)
- [x] File contains `runConsolidate` (imported from `../src/episodic/consolidate.js`)
- [x] File contains `INTER_DAY_DELAY_MS` constant set to `2000`
- [x] File contains `export async function runBackfill(` programmatic entrypoint
- [x] File has per-day `logger.info`/`logger.error` calls with structured `{ date, result, ... }` fields
- [x] File has try/catch per-day that logs errors without rethrowing
- [x] CLI no-args exits 1 with usage message ("Both --from and --to are required.")
- [x] CLI from > to exits 1 with "--from must be <= --to."
- [x] CLI invalid date format exits 1 with "--from and --to must be YYYY-MM-DD."
- [x] CLI future date exits 1 with "Backfill range must not be in the future"
- [x] `src/episodic/__tests__/backfill.test.ts` exists (359 lines, > 80 plan minimum)
- [x] Test contains `runBackfill` import from `'../../../scripts/backfill-episodic.js'`
- [x] Test contains string `OPS-01` in the describe block
- [x] Test contains `expect(result.inserted).toBe(3)` (first-run assertion)
- [x] Test contains `expect(result.skipped).toBe(3)` (idempotency assertion)
- [x] Test contains `toHaveBeenCalledTimes(0)` (zero-Sonnet-calls idempotency assertion)
- [x] Test contains `delayMs: 0` option on runBackfill (skip 2s sleep)
- [x] `npx tsc --noEmit` exits 0 (baseline + after both files added)
- [x] Targeted vitest run: `npx vitest run src/episodic/__tests__/backfill.test.ts` → 3/3 passing / 732ms
- [x] Excluded-suite Docker run: 976 passed / 15 failed / 991 total / 27.79s = +3 vs 973 Plan 23-01 baseline, zero regressions
- [x] Both task commits exist in `git log`: 9d0771f (Task 1 script) + a5f3a2c (Task 2 test)
- [x] Files match must_haves invariants: scripts/backfill-episodic.ts contains "--from"; src/episodic/__tests__/backfill.test.ts contains "backfill"
- [x] No files outside `scripts/` and `src/episodic/__tests__/` touched (PLAN.md verification list satisfied)

---

*Phase: 23-test-suite-backfill-summary*
*Completed: 2026-04-19*
