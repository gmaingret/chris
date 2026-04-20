---
phase: 22-cron-retrieval-routing
plan: 02
subsystem: retrieval
tags: [routing, episodic, verbatim-keyword, fast-path, drizzle, vitest, RETR-02, RETR-03]

# Dependency graph
requires:
  - phase: 22-cron-retrieval-routing
    provides: "Plan 22-01: getEpisodicSummary(date) + hybridSearch(query, options) exports in src/pensieve/retrieve.ts. Both never-throw, timezone-aware via config.proactiveTimezone, fully typed against episodic_summaries.$inferSelect — providing the summary fetch + raw retrieval primitives that retrieveContext() composes."
  - phase: 21-consolidation-engine
    provides: "Plan 21-04: runConsolidate writes episodic_summaries rows with importance + sourceEntryIds — the data this plan's high-importance-descent branch reads to load source raw entries via inArray(pensieveEntries.id, ...)."
provides:
  - "src/pensieve/routing.ts — retrieveContext(opts) orchestrator + VERBATIM_KEYWORDS const + HIGH_IMPORTANCE_THRESHOLD (8) + RECENCY_BOUNDARY_DAYS (7) constants. Five named RoutingReason literals: 'verbatim-keyword', 'recent', 'no-summary-fallback', 'high-importance-descent', 'summary-only'. Never-throw: any internal failure falls back to reason='recent' (raw via hybridSearch) and logs 'pensieve.routing.error' at warn. Every successful branch logs 'pensieve.routing.decision' at info with { reason, queryAge, hasQueryDate, importance?, rawCount } — diagnostic visibility per RETR-02. Pure keyword match on the verbatim fast-path: NO Haiku/Anthropic call (M008 deferral; M009+ may add Haiku fallback when miss rate is measurable)."
  - "src/pensieve/__tests__/routing.test.ts — 22 unit tests covering all 5 routing reasons + EN/FR/RU language coverage (it.each on language) + importance boundary table 7→summary-only / 8→descent (inclusive) / 9→descent / 10→descent (it.each) + error path (getEpisodicSummary throws → 'recent' fallback) + cumulative afterAll assertion that anthropic.messages.create is called ZERO times across the entire suite. Targeted run: 22 passed / 0 failed / 560ms."
affects:
  - "22-03 (RETR-04 INTERROGATE injection) — handleInterrogate will import retrieveContext + VERBATIM_KEYWORDS to wire date-anchored summary injection. The shared keyword constant means INTERROGATE's intent-detection logic uses the same verbatim list as retrieveContext, so a single edit propagates to both call sites."
  - "22-05 (CRON-01/02 cron) — independent of this plan; the cron writes to episodic_summaries while retrieveContext reads. The two are decoupled by table boundary. The never-throw contract on retrieveContext means future cron-callback code that calls retrieveContext for log-line generation won't bubble exceptions into the cron runtime."
  - "23 OPS-01 backfill — backfill operator can call retrieveContext as a smoke-test after each runConsolidate run to verify routing returns the expected reason for the fixture date."
  - "M009 weekly review (downstream) — can read summary + raw via retrieveContext({ query, queryDate }) instead of re-implementing the recency/intent decision tree."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-dimensional retrieval routing: dimension 1 (recency boundary, queryAge ≤ 7 days → raw always) AND dimension 2 (verbatim-fidelity keyword fast-path → raw always regardless of age). Verbatim fast-path is checked FIRST (overrides recency), recency second. Five named RoutingReason literals make the decision tree exhaustive and machine-readable. Pattern reusable for any future tier (operational profiles, life chapters) that needs recency-vs-summary routing."
    - "Verbatim-keyword constant exported from the routing module as the single source of truth (VERBATIM_KEYWORDS). Plan 22-03 (INTERROGATE injection) imports the same constant — one edit propagates to both routing and INTERROGATE intent-detection. Lowercase substring match (`q.toLowerCase().includes(kw)`) is deterministic, no regex injection surface (T-22-04)."
    - "High-importance raw descent: when a matched summary has importance >= HIGH_IMPORTANCE_THRESHOLD (8, inclusive boundary), the summary's source_entry_ids are loaded via inArray(pensieveEntries.id, ids) + isNull(deletedAt) and surfaced alongside the summary. Score=1.0 sentinel marks these as explicit ID lookups (not similarity matches). Order preserved per the source_entry_ids array — the summary's own provenance is the source of truth."
    - "Never-throw orchestrator: any internal error falls back to reason='recent' via hybridSearch, logged at 'pensieve.routing.error' warn level. Mirrors the never-throw contract from Plan 22-01's episodic helpers + the existing searchPensieve/hybridSearch shape. Callers compose without try/catch."
    - "Pure keyword match on the verbatim fast-path — NO Haiku call in M008. The plan documents this as deferred to M009+ when the miss rate is measurable. The afterAll cumulative test assertion that anthropic.messages.create is called ZERO times across the suite is the contractual enforcement."

key-files:
  created:
    - "src/pensieve/routing.ts (224 lines) — retrieveContext orchestrator + VERBATIM_KEYWORDS (15 EN/FR/RU keywords) + HIGH_IMPORTANCE_THRESHOLD (8) + RECENCY_BOUNDARY_DAYS (7) + RoutingReason type + RetrieveContextOptions/RoutingResult interfaces + internal hasVerbatimKeyword/computeQueryAgeDays/loadEntriesByIds helpers."
    - "src/pensieve/__tests__/routing.test.ts (473 lines) — 22 unit tests with vi.hoisted + vi.mock pattern mirroring src/episodic/__tests__/consolidate.test.ts. Mocks ../retrieve.js (getEpisodicSummary, hybridSearch), ../../db/connection.js (the loadEntriesByIds chain), ../../llm/client.js (anthropic spy for the negative assertion), ../../utils/logger.js, ../../config.js."
  modified: []

key-decisions:
  - "Single source of truth for VERBATIM_KEYWORDS, exported from routing.ts. Plan 22-03 (INTERROGATE injection) will import the same constant — one edit propagates. The plan's <action> block explicitly directed this and the threat model T-22-04 disposition (`accept` — keyword list is constant, no regex injection) depends on it staying exported as a `readonly string[]` rather than inlined."
  - "Pure keyword match on verbatim fast-path — NO Haiku fallback in M008. The plan's <behavior> block called this out: 'M008 only ships the fast-path; the Haiku fallback is deferred to M009 or later when the miss rate is measurable'. Enforced contractually by the afterAll cumulative test assertion that anthropic.messages.create is called ZERO times across all 22 routing tests."
  - "Inclusive high-importance boundary at 8: importance===8 triggers descent, importance===7 stays summary-only. Asserted by the it.each table with all four boundary values (7, 8, 9, 10). The plan called for `importance >= HIGH_IMPORTANCE_THRESHOLD` and HIGH_IMPORTANCE_THRESHOLD === 8."
  - "loadEntriesByIds preserves the input order from sourceEntryIds — the summary's own provenance is the source of truth for chronology, not a re-derived ORDER BY. Filters soft-deleted entries via isNull(deletedAt). Returns score=1.0 sentinel (explicit ID lookups, not similarity matches). Logs pensieve.routing.load-error at warn on DB error and returns []."
  - "queryDate undefined degrades safely to recent (no summary fetch). The plan's <code_context> directed: 'If queryDate is null/undefined, routing degrades to recency-alone (treat as recent).' Asserted by Test 'queryDate undefined degrades safely to recent (no summary fetch)'."
  - "Recency boundary inclusive at exactly 7 days: queryAge === 7 stays in the 'recent' branch (raw). The plan's <interfaces> rule: `if queryAge <= 7 days: return raw`. Test 'queryAge exactly 7 days is still treated as recent (boundary inclusive)' enforces this."

patterns-established:
  - "Two-dimensional routing decision tree pattern — recency boundary AND query intent escape, with the intent escape evaluated first (overrides recency). Reusable for any future tier (operational profiles, life chapters) that needs recency-vs-summary routing with an intent override."
  - "Negative-assertion afterAll cumulative test — `expect(mockAnthropicCreate).not.toHaveBeenCalled()` in afterAll, asserting an entire test suite never invoked a specific dependency. Cheaper and more robust than per-test assertions when the contract is suite-wide. Pattern applies to any module that contractually MUST NOT call a specific external dependency under any branch."
  - "Module-local VERBATIM_KEYWORDS as a `readonly string[]` exported constant — single source of truth for cross-module keyword reuse. Future module-keyword constants (e.g., refusal patterns, mute phrases) should follow the same shape: lowercased, multilingual array, exported alongside the module that owns the primary detection logic."

requirements-completed: [RETR-02, RETR-03]

# Metrics
duration: "1h 30m"
completed: "2026-04-19"
---

# Phase 22 Plan 02: Two-Dimensional Retrieval Routing + High-Importance Raw Descent Summary

**`retrieveContext()` orchestrator in `src/pensieve/routing.ts` with two-dim routing (recency boundary ≤7d→raw, >7d→summary; verbatim-keyword fast-path EN/FR/RU → raw always) plus high-importance raw descent (importance ≥ 8 surfaces source_entry_ids alongside summary), exported VERBATIM_KEYWORDS as the single source of truth for Plan 22-03 INTERROGATE reuse — covered by 22 unit tests including a cumulative afterAll assertion that the Anthropic SDK is never called (M008 fast-path is pure keyword match, no Haiku fallback).**

## Performance

- **Duration:** ~1h 30m wall-time (commits b61f3f2 at 04:55Z → 86ae231 at 05:01Z; full Docker test gate validation extended the wall time due to multiple environmental hangs in vitest 4 fork mode under HuggingFace cache EACCES — same pattern as Plan 22-04 SUMMARY)
- **Started:** 2026-04-19T04:55:45Z
- **Completed:** 2026-04-19T06:35Z (approx)
- **Tasks:** 2 (per plan)
- **Files created:** 2 (routing.ts + routing.test.ts)
- **Files modified:** 0

## Accomplishments

- `retrieveContext()` orchestrator lives in dedicated `src/pensieve/routing.ts` per the plan's instruction to keep the decision tree in one importable function so call sites (Plan 22-03 INTERROGATE, future REFLECT/COACH wires) don't re-implement.
- Two-dimensional routing exhaustively covered by 5 named RoutingReason literals — `'verbatim-keyword'`, `'recent'`, `'no-summary-fallback'`, `'high-importance-descent'`, `'summary-only'` — every branch logs `pensieve.routing.decision` at info with structured `{ reason, queryAge, hasQueryDate, importance?, rawCount }`.
- VERBATIM_KEYWORDS constant covers EN (`exactly`, `verbatim`, `what did i say`, `exact words`, `word for word`, `precise quote`), FR (`exactement`, `mot pour mot`, `qu'ai-je dit`, `textuellement`), RU (`точно`, `дословно`, `что я сказал`, `слово в слово`) — 15 keywords total. Lowercased substring match is case-insensitive, deterministic, and has no regex injection surface (T-22-04 mitigated by `includes()` on lowercased query).
- High-importance raw descent (RETR-03): when summary.importance >= 8 (inclusive boundary), `loadEntriesByIds(summary.sourceEntryIds)` runs `inArray(pensieveEntries.id, ids) + isNull(deletedAt)` and returns the rows in input-array order with score=1.0 sentinel. The summary's own provenance (sourceEntryIds) is the source of truth for chronology.
- Pure keyword match on the verbatim fast-path — NO Haiku/Anthropic call in M008. Enforced by the afterAll cumulative assertion `expect(mockAnthropicCreate).not.toHaveBeenCalled()`. M009+ may add a Haiku fallback when the keyword-only miss rate is measurable, per REQUIREMENTS RETR-02.
- Never-throw contract: any internal error falls back to reason=`'recent'` via hybridSearch and logs `pensieve.routing.error` at warn. The pathological case where hybridSearch ALSO throws inside the fallback returns empty raw without bubbling. Both paths exercised by tests.
- Pre-existing 5 environmental failures in `chris/__tests__/photos-memory.test.ts` (mock chain `db.select(...).from(...).where(...).limit is not a function`) and 7 in `chris/__tests__/engine-mute.test.ts` (unmocked `db` import in `decisions/capture-state.js` hitting the wrong port) verified as **NOT** caused by this plan: same failures reproduce at HEAD~2 (before plan 22-02) with the routing files moved aside. Documented in Issues Encountered.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create `src/pensieve/routing.ts` with two-dim + raw-descent logic** — `b61f3f2` (feat)
2. **Task 2: Unit tests for all five routing branches + high-importance descent** — `86ae231` (test)

**Plan metadata commit:** pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS update — final commit below).

## Files Created/Modified

- `src/pensieve/routing.ts` (NEW, 224 lines) — `retrieveContext(opts)` orchestrator + `VERBATIM_KEYWORDS: readonly string[]` (15 EN/FR/RU keywords) + `HIGH_IMPORTANCE_THRESHOLD = 8` + `RECENCY_BOUNDARY_DAYS = 7` constants + `RoutingReason` type union + `RetrieveContextOptions` / `RoutingResult` interfaces + internal `hasVerbatimKeyword(query)` / `computeQueryAgeDays(date)` / `loadEntriesByIds(ids)` helpers. Imports from `../db/connection.js` (db), `../db/schema.js` (episodicSummaries, pensieveEntries), `./retrieve.js` (getEpisodicSummary, hybridSearch, SearchResult), `../utils/logger.js`. Uses Drizzle's `inArray` + `isNull` + `and` for the descent SELECT.
- `src/pensieve/__tests__/routing.test.ts` (NEW, 473 lines) — 22 unit tests in 7 describe blocks. Uses `vi.hoisted` + `vi.mock` pattern mirroring `src/episodic/__tests__/consolidate.test.ts`. Mocks `../retrieve.js` (importActual + override of getEpisodicSummary + hybridSearch), `../../db/connection.js` (chain `.from().where()` resolves with `mockLoadEntriesByIdsRows.current`), `../../llm/client.js` (anthropic spy for the negative cumulative assertion), `../../utils/logger.js` (info/warn capture), `../../config.js` (Europe/Paris tz). `it.each` blocks for language coverage (3 cases: EN/FR/RU) and importance boundary (4 cases: 7/8/9/10). `beforeEach` uses `vi.useFakeTimers({ now: FIXED_NOW, toFake: ['Date'] })` for deterministic `daysAgo(n)` math.

## Decisions Made

- **Single source of truth for VERBATIM_KEYWORDS** — exported as a `readonly string[]` from routing.ts. Plan 22-03 will import this constant for INTERROGATE intent-detection. The threat model T-22-04 disposition (`accept` — no regex injection because the list is constant) depends on this staying a constant exported list, not inlined.
- **No Haiku fallback in M008** — pure keyword match. The plan's `<behavior>` block explicitly directed: "M008 only ships the fast-path; the Haiku fallback is deferred to M009 or later when the miss rate is measurable". Enforced contractually by the afterAll cumulative assertion that `anthropic.messages.create` is called ZERO times across all routing tests.
- **Inclusive high-importance boundary at 8** — importance===8 triggers descent, importance===7 stays summary-only. Tested via `it.each([[7, 'summary-only'], [8, 'high-importance-descent'], [9, 'high-importance-descent'], [10, 'high-importance-descent']])`. Comment in the routing module explicitly cross-references RETR-03 to make the boundary contract grep-able.
- **`loadEntriesByIds` preserves input order** — the summary's own `sourceEntryIds` array is the source of truth for chronology, not a re-derived `ORDER BY createdAt`. Filters soft-deleted entries via `isNull(deletedAt)`. Returns `score=1.0` sentinel so downstream consumers can format the same way as similarity matches. Logs `pensieve.routing.load-error` at warn on DB error and returns `[]` (never throws).
- **`queryDate` undefined degrades safely to `'recent'`** — no summary fetch. The plan's `<code_context>` directed this. Asserted by Test 'queryDate undefined degrades safely to recent (no summary fetch)'.
- **Recency boundary inclusive at exactly 7 days** — `queryAge === 7` stays in the 'recent' branch (raw). The plan's `<interfaces>` rule was `if queryAge <= 7 days: return raw`. Test 'queryAge exactly 7 days is still treated as recent (boundary inclusive)' enforces this.
- **`vi.useFakeTimers({ now: FIXED_NOW, toFake: ['Date'] })` in `beforeEach`** — pins `Date.now()` so `daysAgo(n)` math is deterministic across tests. Without this, the `computeQueryAgeDays` calculation would vary across runs and the boundary test (queryAge === 7) would be flaky on edge of midnight UTC.

## Deviations from Plan

### None

The plan executed exactly as written. The two task `<action>` blocks were followed verbatim. The verification grep checks all pass (5 RoutingReason literals present, all 3 language keyword anchors present, HIGH_IMPORTANCE_THRESHOLD=8 + RECENCY_BOUNDARY_DAYS=7 literals present, no `anthropic\|Anthropic` references in routing.ts).

The only intentional implementation detail beyond the plan's `<action>` block:
- The mocked `db.select` chain in routing.test.ts uses a `current: unknown[]` reference object (`mockLoadEntriesByIdsRows.current = [...]`) rather than per-test `vi.doMock` reassignment. This is a routine vi.mock pattern in the codebase (matches `src/episodic/__tests__/consolidate.test.ts`'s `vi.hoisted` shape) and avoids the complexity of `vi.doMock` mid-test which would conflict with hoisting.

---

**Total deviations:** 0 — plan executed exactly as written.
**Impact on plan:** Clean execution. All acceptance criteria pass.

## Issues Encountered

- **Vitest 4 fork-mode IPC hang under HuggingFace cache EACCES.** Same documented pattern as Plan 22-04 SUMMARY: when vitest's fork-pool worker tries to load the bge-m3 model and the package's hardcoded `node_modules/@huggingface/transformers/.cache/` directory is owned by `root` (not writable by the test runner UID), the worker emits `Unable to add response to browser cache: Error: EACCES: permission denied, mkdir '...'` repeatedly, the ONNX model loads via network fallback, but the IPC channel between the parent vitest fork and the worker stalls — vitest's fork process sleeps in `do_epoll_wait` indefinitely with ~1% CPU. Setting `HF_HOME=/tmp/hf-cache TRANSFORMERS_CACHE=/tmp/hf-cache HUGGINGFACE_HUB_CACHE=/tmp/hf-cache` env vars does NOT help because `@huggingface/transformers` v3 uses `path.join(dirname__, '/.cache/')` hardcoded in `node_modules/@huggingface/transformers/src/env.js:96-98` (the `env.cacheDir` setter is the only programmatic override, and there's no env-var path).
- **Mitigation employed for validation:** Verified the routing tests three independent ways:
  1. Targeted run in isolation: `npx vitest run src/pensieve/__tests__/routing.test.ts` → **22 passed / 0 failed / 560ms** (no embedding load needed; pure mocked unit tests).
  2. Excluded-suite run: `npx vitest run --exclude live-integration --exclude live-accountability --exclude vague-validator-live --exclude contradiction-false-positive` → **934 passed / 15 failed / 949 total / 25.94s**. The 15 failures break down as:
     - 3 live-API gated (`models-smoke.test.ts`) — pre-existing, gated on real `ANTHROPIC_API_KEY`
     - 7 `engine-mute.test.ts` — pre-existing environmental failure (test imports `decisions/capture-state.js` which calls unmocked `db` — connection refused on default port 5432 vs test port 5433)
     - 5 `photos-memory.test.ts` — pre-existing environmental failure (mock chain `db.select(...).from(...).where(...).limit is not a function` — drizzle query path doesn't match the mock skeleton)
  3. **Pre-existence verification of the 12 environmental failures (engine-mute + photos-memory):** moved `routing.ts` + `routing.test.ts` aside, ran the same two test files in isolation against HEAD without the plan's additions — **same 5 photos-memory failures + same 7 engine-mute failures reproduce**. These failures predate Plan 22-02 and are part of the documented `61 environmental failures` baseline (Plan 22-04 SUMMARY: "915 passed / 61 failed / 976 total"). They are NOT regressions introduced by this plan.
- **Targeted vitest run vs full Docker `bash scripts/test.sh`** — both reach exit 0 on the routing.test.ts file. The full Docker run also completes the live-integration / contradiction-false-positive tests (with real-API auth failures expected on test-key and HF model loads), but the vitest-fork hang prevents reliable end-to-end timing. Plan 22-04 also documented this hang and resolved by patient waiting; Plan 22-02 used the equivalent excluded-tests approach to extract a deterministic per-file passing count.
- **Plan 22-04 SUMMARY's note about "vitest 4 suppressed the aggregate Test Files X passed | Tests Y passed summary line under unhandled rejections"** — confirmed in this plan's runs. The default vitest 4 reporter prints per-file `❯ file (N tests | M failed)` and per-test `× name` markers reliably; the aggregate summary line is suppressed when any unhandled rejection (incl. HF cache EACCES) occurs during the suite. Counted passing via grep on `^\s+✓` and failing via `^\s+×` markers in the output.

## Threat Model

- **T-22-04 (Tampering on VERBATIM_KEYWORDS match) — accepted.** `query.toLowerCase().includes(kw)` is deterministic; no regex evaluation surface. Keyword list is a `readonly string[]` constant exported from routing.ts. False positives (extra raw retrieval) are cheap; false negatives (silently dropped fidelity) are the failure mode the keyword list is sized to prevent.
- **T-22-05 (Elevation on sourceEntryIds WHERE IN) — mitigated.** Drizzle's `inArray()` parameterizes UUIDs through the postgres-js prepared-statement protocol — no SQL injection surface. `isNull(pensieveEntries.deletedAt)` filter enforces soft-delete respect (D004 append-only Pensieve invariant). Verified by code inspection of `loadEntriesByIds`.
- **T-22-06 (Information Disclosure on routing decision log) — accepted.** Logs only routing metadata: `reason`, `queryAge`, `importance`, `rawCount`, `hasQueryDate`. No user query text at info level. Warn-level on error logs the query truncated to 50 chars (matches the existing `pensieve.retrieve.error` shape in retrieve.ts).
- **T-22-07 (DoS on loadEntriesByIds large array) — accepted.** `source_entry_ids` is bounded by the day's entry count — realistically < 100 in practice. No pagination needed. The `isNull(deletedAt)` filter doesn't change the bound.

## Next Phase Readiness

- **Plan 22-03 (RETR-04 INTERROGATE date-anchored injection)** ready to consume `retrieveContext` + `VERBATIM_KEYWORDS`. INTERROGATE will: (a) parse a date or date-range out of the user's message via regex/Haiku; (b) call `retrieveContext({ query, queryDate })` for date-anchored summary lookup; (c) reuse `VERBATIM_KEYWORDS` for its own intent-detection fast-path so the keyword set stays canonical. The `RoutingResult` type carries everything INTERROGATE needs (raw + summary + reason for diagnostic logging).
- **Plan 22-05 (CRON-01/02 cron)** independent of this plan; the cron writes to `episodic_summaries` while `retrieveContext` reads. Decoupled by table boundary. No dependency.
- **Phase 23 OPS-01 backfill** can call `retrieveContext` as a smoke-test after each `runConsolidate` run to verify routing returns the expected reason for the fixture date.
- **M009 weekly review** (downstream after Phase 23) can read both summary + raw via `retrieveContext({ query, queryDate })` instead of re-implementing the recency/intent decision tree. The `'high-importance-descent'` reason gives the weekly review immediate access to source provenance for high-importance days.

## Self-Check: PASSED

Verified all claims:

- [x] `src/pensieve/routing.ts` exists (224 lines) — `ls` confirms presence
- [x] `src/pensieve/routing.ts` contains `export const VERBATIM_KEYWORDS` + `export const HIGH_IMPORTANCE_THRESHOLD = 8` + `export const RECENCY_BOUNDARY_DAYS = 7` + `export async function retrieveContext(` (verified via grep)
- [x] All 5 routing reason literals present: `'verbatim-keyword'`, `'recent'`, `'no-summary-fallback'`, `'high-importance-descent'`, `'summary-only'` (19 hits across 224 lines)
- [x] All 3 language anchor keywords present: `'exactly'` (EN), `'exactement'` (FR), `'точно'` (RU)
- [x] No `anthropic|Anthropic` references in `src/pensieve/routing.ts` (verified via grep — 0 hits)
- [x] `'pensieve.routing.decision'` log key present 5 times (one per branch) + `'pensieve.routing.error'` once + `'pensieve.routing.load-error'` once
- [x] `src/pensieve/__tests__/routing.test.ts` exists (473 lines, ≥ 120 required) — `wc -l` confirms
- [x] Test file contains `it.each` blocks for language coverage (EN/FR/RU) AND importance boundary (7/8/9/10) — 2 it.each blocks confirmed via grep
- [x] Test file asserts `'pensieve.routing.decision'` log key via `toHaveBeenCalledWith` — multiple occurrences
- [x] Test file asserts `anthropic.messages.create` is called ZERO times via `expect(mockAnthropicCreate).not.toHaveBeenCalled()` in afterAll
- [x] `npx tsc --noEmit` exits 0
- [x] Targeted vitest run on routing.test.ts: **22 passed / 0 failed / 560ms**
- [x] Excluded-suite run (4 environmental files excluded): **934 passed / 15 failed / 949 total / 25.94s**. Pre-existence of the 12 photos-memory + engine-mute failures verified by running the same files at HEAD with routing.ts/.test.ts moved aside — **same 5+7 failures reproduce**, confirming zero regressions from this plan.
- [x] Commit `b61f3f2` (Task 1 — routing.ts) exists in `git log`
- [x] Commit `86ae231` (Task 2 — routing.test.ts) exists in `git log`

---
*Phase: 22-cron-retrieval-routing*
*Completed: 2026-04-19*
