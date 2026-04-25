---
phase: 24-primed-fixture-pipeline
plan: 02
subsystem: test-infrastructure
tags: [test-infrastructure, synthesis, haiku, vcr, style-transfer, determinism, seeded-rng]
dependency_graph:
  requires:
    - phase: 24-primed-fixture-pipeline
      plan: 01
      provides: seeded PRNG (mulberry32/seededSample), freshness helper (autoRefreshIfStale), prod-snapshot fetch script
  provides:
    - src/__tests__/fixtures/vcr.ts (cachedMessagesParse/cachedMessagesCreate/hashRequest/setVcrDirForTest/VCR_DIR)
    - scripts/synthesize-delta.ts (CLI: organic→synthetic day extension with per-day Haiku + deterministic decisions/contradictions/wellbeing)
    - scripts/__tests__/__fixtures__/synth-delta/organic-tiny/ (committed tiny organic fixture for unit-test replay)
  affects:
    - 24-03 (consumes cachedMessagesParse via sibling-module composition for runConsolidate Sonnet calls; reuses vitest config widen)
    - 24-04 (consumes MANIFEST.json + primed fixture dir layout; loadPrimedFixture reads what synthesize-delta writes)
tech_stack:
  added: []
  patterns:
    - Content-addressable SHA-256 hash keyed VCR cache (canonical JSON stringify with sorted keys at every nesting level)
    - Atomic JSON write via tmp + POSIX rename (Pitfall #8 guard against partial writes)
    - Module-level mutable `let VCR_DIR` with setVcrDirForTest() escape hatch for hermetic test sandboxing
    - Lazy-import pattern (same as Plan 24-01 fetch-prod-data) for env-var-free `--help` entry points
    - Deterministic UUID generator via Mulberry32 (4 × 32-bit draws → UUIDv4 layout) — SYNTH-07 replaces crypto.randomUUID's non-determinism
    - Per-day Haiku style-transfer with temperature=0 + 8-example few-shot (D-02) wired through VCR
    - Deterministic 5-decision spread with RESOLVE_BY_SPREAD_DAYS = [1, 3, 7, 14, 30]
    - Hardcoded 3-pair adversarial contradiction templates (SYNTH-05)
    - to_regclass feature-detect for optional tables (D-05 wellbeing_snapshots)
    - vitest root widened from 'src' to '.' with explicit include patterns (enables scripts/__tests__/ discovery)
key_files:
  created:
    - src/__tests__/fixtures/vcr.ts
    - src/__tests__/fixtures/vcr.test.ts
    - scripts/synthesize-delta.ts
    - scripts/__tests__/synthesize-delta.test.ts
    - scripts/__tests__/__fixtures__/synth-delta/organic-tiny/pensieve_entries.jsonl
    - scripts/__tests__/__fixtures__/synth-delta/organic-tiny/{pensieve_embeddings,decisions,decision_events,contradictions,proactive_state,relational_memory}.jsonl
  modified:
    - vitest.config.ts (root='.' + explicit include for src/**/__tests__/ and scripts/**/__tests__/)
decisions:
  - "VCR hash algorithm locked to SHA-256 over canonical-stringified request with keys sorted at every nesting level — any prompt/model/schema change auto-invalidates the cached entry (D-03)"
  - "cachedMessagesParse returns the serialized response shape (parsed_output + content + usage + etc.) so both Haiku zod path and Sonnet zod path work without special-casing — same wrapper for both model tiers"
  - "Corrupted cache files surface as parse errors — no silent fallback to the network — making cache corruption actionable rather than flaky"
  - "8 few-shot organic entries per synthetic day (middle of RESEARCH's 5–15 band); 3 entries per synthetic day (keeps unit tests fast without losing day-coherence signal)"
  - "Resolution reply synthesis (SYNTH-04) attaches `resolution_reply_plaintext` to decision rows when milestone ends with '-with-resolutions'; Plan 24-04 loader replays these through real handleResolution after bulk-load"
  - "generateSyntheticContradictions gracefully falls back to fresh deterministic UUIDs when the synthetic pensieve pool has <2 rows — contradiction count stays at 3 regardless of span; FK integrity enforced at bulk-insert time in Plan 24-04"
  - "Test fixture `scripts/__tests__/__fixtures__/synth-delta/organic-tiny/` is committed (NOT gitignored) — 5 telegram entries across 2 days keeps the unit-test gate hermetic and independent of the gitignored tests/fixtures/prod-snapshot/ tree"
  - "vitest.config.ts widened from root='src' to root='.' + explicit include patterns — preserves all 79 existing src/**/__tests__/ tests, adds discovery for scripts/**/__tests__/ tests"
requirements_completed: [SYNTH-01, SYNTH-02, SYNTH-04, SYNTH-05, SYNTH-06, SYNTH-07, FRESH-02]
metrics:
  duration: ~80m
  started: 2026-04-20T11:32:13Z
  completed: 2026-04-20T12:52:48Z
  tasks_completed: 2
  tests_added: 34
  files_created: 11
  files_modified: 1
---

# Phase 24 Plan 02: Non-Episodic Synthetic Generator + VCR Cache Summary

**Content-addressable SHA-256 VCR cache wrapping the Anthropic SDK + `scripts/synthesize-delta.ts` CLI that extends an organic prod snapshot with per-day Haiku style-transfer (D-02), deterministic decisions/contradictions/wellbeing generators, and byte-identical reruns under the same seed (SYNTH-07).**

## Performance

- **Duration:** ~80 min
- **Started:** 2026-04-20T11:32:13Z
- **Completed:** 2026-04-20T12:52:48Z
- **Tasks:** 2 (each TDD: RED + GREEN phases committed separately)
- **Files created:** 11 (2 source, 1 test, 1 config updated, 7 organic-tiny fixture files)
- **Files modified:** 1 (vitest.config.ts)

## Accomplishments

- **VCR wrapper (`src/__tests__/fixtures/vcr.ts`)** — Single point of LLM determinism for the entire v2.3 pipeline. `cachedMessagesParse`/`cachedMessagesCreate` layer on top of the existing Anthropic SDK singleton (no changes to `src/llm/client.ts`). Content-addressable hash keying means any prompt/model/schema change auto-invalidates without manual bookkeeping. Atomic writes (tmp + rename) guard against partial-write corruption under interrupt. `setVcrDirForTest()` escape hatch keeps unit tests hermetic. Exported `VCR_DIR`, `hashRequest`, `setVcrDirForTest` for downstream consumers (Plan 24-03 runConsolidate VCR, Plan 24-04 loader diagnostics).
- **`scripts/synthesize-delta.ts`** — 700-line CLI that fuses an organic snapshot with synthetic days via per-day Haiku calls (D-02, temperature=0, 8-example few-shot seeded from `seededSample(organic, 8, seed+d)`). Output: 11 JSONL files + MANIFEST.json under `tests/fixtures/primed/<milestone>-<N>days/`. `episodic_summaries.jsonl` is written empty — Plan 24-03 will fill it via real `runConsolidate` composition.
- **SYNTH-07 byte-identical reruns** — Asserted by automated test: two runs with same seed and same organic base produce byte-identical `pensieve_entries.jsonl`. Deterministic UUID generator (4 × Mulberry32 draws → UUIDv4 layout) replaces non-deterministic `crypto.randomUUID()` at every synthesis site.
- **Deterministic generators** — 5 decisions with `[1, 3, 7, 14, 30]`-day `resolve_by` spread (SYNTH-04); 3 adversarial contradiction pairs with `status='DETECTED'`, `confidence=0.85` (SYNTH-05); wellbeing feature-detects `wellbeing_snapshots` via `SELECT to_regclass('public.wellbeing_snapshots')` and emits `synth.wellbeing.skip` info-log when the table is absent (SYNTH-06, D-05).
- **FRESH-02 plumbing** — `--no-refresh` CLI flag threads through to `autoRefreshIfStale({ noRefresh })`; when set, the 24h auto-refresh short-circuits for sandbox/offline use. Automated test spies on `autoRefreshIfStale` invocation for both directions.
- **vitest config widened** — `root='.'` with explicit includes for `src/**/__tests__/` and `scripts/**/__tests__/`. Enables discovery of `scripts/__tests__/synthesize-delta.test.ts` (the plan's prescribed test path) while preserving all 79 pre-existing `src/**/__tests__/` test files.

## Task Commits

Each task was TDD with separate RED/GREEN commits (following the convention established in prior milestones).

1. **Task 1 RED: Failing VCR tests** — `f9c2def` (test)
2. **Task 1 GREEN: VCR implementation** — `c3c36d9` (feat)
3. **Vitest config widen** — `305a211` (chore)
4. **Task 2 RED: Failing synthesize-delta tests + organic-tiny fixture** — `fdd2d5f` (test)
5. **Task 2 GREEN: synthesize-delta implementation** — `13cd846` (feat)

No final metadata commit yet — will be added when SUMMARY.md + STATE.md updates ship as `docs(24-02): complete plan`.

## Files Created/Modified

- `src/__tests__/fixtures/vcr.ts` — Content-addressable VCR cache wrapping `anthropic.messages.parse`/`.create`. Exports `cachedMessagesParse`, `cachedMessagesCreate`, `hashRequest`, `setVcrDirForTest`, `VCR_DIR`. 142 LOC.
- `src/__tests__/fixtures/vcr.test.ts` — 15 unit tests covering hash stability, differentiation, miss-then-hit, kind differentiation, atomic-write safety, corruption-surfacing behavior. Uses `mkdtemp` sandbox. 311 LOC.
- `scripts/synthesize-delta.ts` — CLI + synthesize() orchestrator + deterministic generators. 657 LOC.
- `scripts/__tests__/synthesize-delta.test.ts` — 19 tests including CLI subprocess gate (--help / no-args exit codes), synthesize() end-to-end with mocked VCR, SYNTH-07 byte-identical replay, generator unit tests. Uses per-run mkdtemp output dir so runs don't pollute `tests/fixtures/primed/`.
- `scripts/__tests__/__fixtures__/synth-delta/organic-tiny/` — 7 JSONL files: 5 telegram entries across 2026-04-15/16 + 6 empty sibling files matching prod-snapshot layout.
- `vitest.config.ts` — root='src' → root='.' with explicit includes; preserves 79 prior tests, adds scripts/**/__tests__/ discovery.

## Decisions Made

### Hash stability is load-bearing for SYNTH-07

The canonical stringifier sorts object keys at every nesting level (not just top level). Tested with `hashRequest({a:1, b:{x:1, y:2}})` vs `hashRequest({b:{y:2, x:1}, a:1})` — same hash. This matters because the Anthropic request includes nested config objects (`output_config.format`) where key order is an implementation detail of the JSON schema emitter; without recursive sorting we'd get false misses every time the SDK shuffles its output.

### Lazy-import mirrors Plan 24-01's fetch-prod-data fix

`scripts/synthesize-delta.ts` top-level imports `seed.ts` (safe: pure PRNG, no config deps) but lazy-imports `vcr.ts`, `freshness.ts`, `llm/client.ts`, `utils/logger.ts` inside `synthesize()`. This keeps `--help` env-var-free. Vitest `vi.mock()` hoisting means test suites still resolve to mocks because mock factories are registered BEFORE any module load, regardless of whether the import is static or dynamic. Zero observable test-behavior change.

### Test fixture location convention

`scripts/__tests__/__fixtures__/synth-delta/organic-tiny/` is committed (NOT gitignored). `.gitignore` explicitly targets `tests/fixtures/prod-snapshot/`, `tests/fixtures/primed/`, and `tests/fixtures/.vcr/` — the runtime-generated pipeline outputs — so the `scripts/__tests__/__fixtures__/` tree falls outside the exclude patterns. This keeps the unit-test gate hermetic: `npx vitest run scripts/__tests__/synthesize-delta.test.ts` on a fresh clone works without any prior `fetch-prod-data.ts` invocation.

### Synthetic contradiction FK fallback

When `synthetic_pensieve.length < 2`, `generateSyntheticContradictions` falls back to deterministic fresh UUIDs for `entry_a_id`/`entry_b_id` instead of crashing. This preserves the "always 3 pairs" invariant (SYNTH-05). In the practical M009 fixture case (target_days ≥ 14 on prod's 4-day organic span → ~30 synthetic pensieve rows), the fallback never fires. Documented inline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] vitest root='src' hid scripts/__tests__/ discovery**

- **Found during:** Task 2 preparation (before writing synthesize-delta.test.ts)
- **Issue:** The plan frontmatter lists `scripts/__tests__/synthesize-delta.test.ts` as an artifact and the acceptance criteria include `npx vitest run scripts/__tests__/synthesize-delta.test.ts`. But the existing `vitest.config.ts` had `root: 'src'` which scoped discovery under `src/**` only — tests at repo-root `scripts/__tests__/` would be silently dropped.
- **Fix:** Widened `root` to `'.'` and set explicit `include: ['src/**/__tests__/**/*.test.ts', 'scripts/**/__tests__/**/*.test.ts']`. Verified: post-change, vitest discovers 81 test files (1 new = vcr.test.ts; synthesize-delta.test.ts was added later); no existing test file was dropped; all 4 prior checks still green.
- **Files modified:** `vitest.config.ts`
- **Verification:** Ran full gate twice — `npx vitest run` picks up both plan 24-02 test files and all pre-existing src/ tests.
- **Committed in:** `305a211` (chore — separate from TDD task commits)

**2. [Rule 1 - Bug] synthesize-delta `--help` failed on DATABASE_URL at module load**

- **Found during:** Task 2 GREEN phase — the --help subprocess test failed because `scripts/synthesize-delta.ts` top-level-imported `src/__tests__/fixtures/vcr.js` → `src/llm/client.js` → `src/config.js` → `required('DATABASE_URL')`.
- **Root cause:** Same eager-config-load bug Plan 24-01 hit (`a8181fa`). ESM imports are non-deferrable; any transitive path to `config.ts` at module init breaks env-var-free `--help`.
- **Fix:** Moved `logger`, `autoRefreshIfStale`, `cachedMessagesParse`, `HAIKU_MODEL` imports inside `synthesize()` as dynamic `import()` calls. The `seed.ts` PRNG imports stay top-level (no config dependency). Vitest `vi.mock()` hoisting handles the lazy imports identically to static imports in test runs — zero observable behavior change.
- **Files modified:** `scripts/synthesize-delta.ts`
- **Verification:** `npx tsx scripts/synthesize-delta.ts --help` exits 0 with usage printed. `(no args)` exits 1 with usage hint. 19/19 unit tests still pass.
- **Committed in:** `13cd846` (Task 2 GREEN commit)

**3. [Rule 1 - Bug] Plan's `output_parsed` field name was `parsed_output` in actual SDK**

- **Found during:** Task 2 GREEN implementation
- **Issue:** The plan's action block referenced `response.output_parsed` but the Anthropic SDK 0.90 (and the existing `src/episodic/consolidate.ts:163,168,176,181` precedent) uses `response.parsed_output`.
- **Fix:** Used `parsed_output` (matching the real SDK surface and in-repo precedent). Added defense-in-depth `HaikuSyntheticDaySchema.safeParse(parsed)` validation against cache-shape drift.
- **Files modified:** `scripts/synthesize-delta.ts`
- **Verification:** tsc clean; 19/19 unit tests pass; type inference works.
- **Committed in:** `13cd846`

**4. [Rule 1 - Bug] Unused `seededShuffle` import flagged nothing in tsc but was noise**

- **Found during:** Post-GREEN cleanup
- **Issue:** The import list named `mulberry32, seededShuffle, seededSample` but `seededShuffle` was never called (only `seededSample` and `mulberry32` are used directly; `seededSample` is defined as a prefix-of-shuffle internally).
- **Fix:** Removed `seededShuffle` from the import list.
- **Files modified:** `scripts/synthesize-delta.ts`
- **Verification:** tsc clean; 19/19 tests pass.
- **Committed in:** `13cd846` (same commit — cleanup was inline)

### No Rule-2 / Rule-4 issues

No missing critical functionality (Rule 2) or architectural-scope escalation (Rule 4) was required. All deviations were scoped-down bug fixes or blocking-resolution widens.

---

**Total deviations:** 4 auto-fixed (1 Rule-3 blocking, 3 Rule-1 bug). Deviations 2 and 3 were direct mechanical fixes against the SDK + in-repo precedent; deviation 1 was infrastructure-widen required by the plan's own artifact list; deviation 4 was dead-code cleanup.
**Impact on plan:** Zero scope drift — all deviations were plan-supporting fixes needed to satisfy the plan's own acceptance criteria.

## Issues Encountered

- **Docker test gate initial run hung** on vitest fork IPC under the pre-existing HuggingFace EACCES tech debt (documented in `.planning/codebase/TESTING.md` L212–227 and STATE.md Known Tech Debt). The canonical operational mitigation — `bash scripts/test.sh --exclude '**/live-integration.test.ts' --exclude '**/live-accountability.test.ts' --exclude '**/vague-validator-live.test.ts' --exclude '**/contradiction-false-positive.test.ts' --exclude '**/live-anti-flattery.test.ts'` — resolved the hang immediately. Second run (mitigation applied): **74 files passed / 3 files failed (77 total) — 1078 tests passed / 15 failed / 74 skipped (1093 total)**. The 3 failing files are all `src/llm/__tests__/models-smoke.test.ts` live-API smokes that require a real `ANTHROPIC_API_KEY` (test.sh injects `test-key`); these failures are pre-existing and orthogonal to Plan 24-02. Net regression introduced by Plan 24-02 on the full-suite docker gate: **0**.

## Verification Results

### Plan-level checks (all 4 pass)

1. **`npx vitest run src/__tests__/fixtures/vcr.test.ts scripts/__tests__/synthesize-delta.test.ts`** — **34/34 passed, 0 failed, ~1.4s** under local Node (no Docker). Under `bash scripts/test.sh` (real Docker Postgres): **34/34 passed, 0 failed, 1.43s**.

2. **`npx tsc --noEmit`** — 0 errors.

3. **SYNTH-07 byte-identical replay** — covered by test `synthesize() end-to-end (mocked VCR) > SYNTH-07: same --seed + same organic base → byte-identical pensieve_entries.jsonl across runs`. Two invocations of `synthesize()` with identical `{ organic, targetDays, seed, milestone, noRefresh }` produce byte-identical `pensieve_entries.jsonl` in separate output dirs.

4. **Schema reconciliation** — `grep -n "FROM memories\|memories_table\|memoriesTable" scripts/synthesize-delta.ts` → **0 matches** (uses `relational_memory` per Plan 24-01 convention).

### Acceptance-criteria grep verification

| Grep target | Count | Expected |
| --- | --- | --- |
| `createHash('sha256')` in vcr.ts | 1 | ≥1 ✓ |
| `await rename(tmp, path)` in vcr.ts | 1 | ≥1 ✓ |
| `hash.slice(0, 8)` in vcr.ts | 4 | ≥1 ✓ |
| `cachedMessagesParse` in synthesize-delta.ts | 3 | ≥1 ✓ |
| `autoRefreshIfStale` in synthesize-delta.ts | 2 | ≥1 ✓ |
| `seededSample` in synthesize-delta.ts | 4 | ≥1 ✓ |
| `to_regclass('public.wellbeing_snapshots')` in synthesize-delta.ts | 1 | ≥1 ✓ |
| `source: 'telegram'` in synthesize-delta.ts | 1 | ≥1 ✓ |
| `Europe/Paris` in synthesize-delta.ts | 4 | ≥1 ✓ |
| `runConsolidate` in synthesize-delta.ts | 0 | 0 ✓ |
| ESM main-guard in synthesize-delta.ts | 1 | ≥1 ✓ |

### CLI direct smoke tests

```
$ npx tsx scripts/synthesize-delta.ts --help
Usage: npx tsx scripts/synthesize-delta.ts --organic <path> ...
Flags: ... --help         print this message and exit 0
exit=0

$ npx tsx scripts/synthesize-delta.ts
synthesize-delta: --organic is required
Usage: ...
exit=1
```

## Artifacts Handed to Downstream Plans

- **Plan 24-03** imports `cachedMessagesParse` via the same VCR surface for the Sonnet-wrapped `runConsolidate` sibling-module composition; reuses the seeded RNG and freshness helper established in Plan 24-01; reads the empty `episodic_summaries.jsonl` placeholder this plan writes and fills it.
- **Plan 24-04** consumes the `tests/fixtures/primed/<milestone>-<N>days/` directory layout written by `synthesize-delta`; uses `MANIFEST.json` for diagnostic output; invokes `handleResolution` on any `resolution_reply_plaintext` payloads attached when `--milestone` ends with `-with-resolutions`.

## Next Plan Readiness

Plan 24-03 (Wave 3 — real-engine episodic synthesis) is unblocked:
- Sibling-module composition surface is available (`cachedMessagesParse` proven under tests).
- Primed-fixture directory conventions are established (MANIFEST.json fields, 11-file layout, empty episodic placeholder).
- Seeded RNG and freshness helpers are battle-tested under two plans' worth of unit tests.

## Known Stubs

- `scripts/synthesize-delta.ts` writes **empty** `episodic_summaries.jsonl` as documented placeholder (plan-intentional — Plan 24-03's scope). MANIFEST.json's `schema_note` + this summary document the intent explicitly.
- `scripts/synthesize-delta.ts` writes **empty** `decision_capture_state.jsonl` (organic snapshot's decision_capture_state is also empty in prod — no stub here, just a faithful pass-through of the empty-organic case).
- `generateSyntheticContradictions` emits a `confidence: 0.85` field that is NOT a column in the current `src/db/schema.ts` contradictions table. Documented in-file; harmless on bulk-insert (extra keys are dropped); intentionally forward-compatible with a potential M009 column addition.

Zero stubs block the plan's goal. Plan 24-03 will replace the episodic_summaries.jsonl placeholder with real runConsolidate output.

## Self-Check: PASSED

Files verified to exist (stat):

- `src/__tests__/fixtures/vcr.ts` → FOUND
- `src/__tests__/fixtures/vcr.test.ts` → FOUND
- `scripts/synthesize-delta.ts` → FOUND
- `scripts/__tests__/synthesize-delta.test.ts` → FOUND
- `scripts/__tests__/__fixtures__/synth-delta/organic-tiny/pensieve_entries.jsonl` → FOUND (5 lines)
- `vitest.config.ts` (modified) → FOUND with `root: '.'` and dual include patterns

Commits verified in `git log --oneline main`:

- `f9c2def` (test RED vcr) → FOUND
- `c3c36d9` (feat GREEN vcr) → FOUND
- `305a211` (chore vitest widen) → FOUND
- `fdd2d5f` (test RED synth-delta) → FOUND
- `13cd846` (feat GREEN synth-delta) → FOUND

---

*Phase: 24-primed-fixture-pipeline*
*Completed: 2026-04-20*
