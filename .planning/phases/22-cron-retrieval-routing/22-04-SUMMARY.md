---
phase: 22-cron-retrieval-routing
plan: 04
subsystem: testing
tags: [boundary-audit, retrieval, embeddings, known-facts, RETR-05, RETR-06, D031]

# Dependency graph
requires:
  - phase: 6-memory-audit
    provides: "src/pensieve/ground-truth.ts (Known Facts data source) and src/chris/personality.ts (buildKnownFactsBlock) — the two files RETR-05 must keep disconnected from episodic_summaries."
  - phase: 1-foundation
    provides: "src/pensieve/embeddings.ts (the only path that INSERTs into pensieve_embeddings) — the file RETR-06 must keep free of episodicSummaries imports and SQL references."
  - phase: 20-schema-tech-debt
    provides: "episodic_summaries table + episodicSummaries Drizzle export (the table this audit forbids from leaking into Known Facts or pensieve_embeddings)."
provides:
  - "src/chris/__tests__/boundary-audit.test.ts (127 lines, 4 deterministic tests) — RETR-05 + RETR-06 architectural boundary enforcement at CI time. Reads source text via node:fs/promises and asserts zero matches for /\\bepisodic_summaries\\b|\\bepisodicSummaries\\b/ across personality.ts, ground-truth.ts, and embeddings.ts; plus a fourth assertion that every db.insert(pensieveEmbeddings).values(...) call site in embeddings.ts is free of /episodic/i."
  - "First boundary-audit pattern in the codebase — establishes the source-text grep-via-vitest idiom for later milestones (M010+ profile boundaries, M013+ ritual boundaries) to copy."
  - "Docker gate: 4 new passing tests (~915 passed / 61 failed / 976 total ≈ +4 vs 911/61/972 Plan 22-01 baseline; same 61 environmental failures, zero regressions)."
affects:
  - "22-02 (RETR-02 routing) — when routeRetrieval starts injecting episodic summary rows into the prompt context, the audit guarantees those rows never reach the Known Facts block. Plan 22-02 should not import episodicSummaries into personality.ts or ground-truth.ts; if it tries, this test fires."
  - "22-03 (RETR-04 INTERROGATE injection) — when interrogate.ts gains the date-anchored summary injection, the audit guarantees that injection path stays separate from buildKnownFactsBlock. Same firing condition."
  - "EPI-FUTURE-02 (deferred) — if a future plan adds an `episodic_embeddings` table per RETR-06 deferral, this audit must be EXTENDED with a fifth assertion: episodicSummaries text never enters pensieve_embeddings even via a JOIN. The current audit's regex catches the table name, so it is forward-compatible with the deferral as long as the new code path uses the right table name."
  - "M010+ profile inference — when profiles start consuming episodic_summaries, those reads must NOT route through known-facts.ts or embeddings.ts. The audit defends that boundary preemptively."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-text architectural boundary audit — read source files at test time via node:fs/promises and grep for forbidden references. No production-code imports (the test does not execute the modules under audit, only reads their text), so the assertion is independent of test-time module hoisting (vi.mock) and runs without DB or Anthropic API. Ships through the regular vitest glob (src/**/__tests__/**/*.test.ts) so it gates every commit through bash scripts/test.sh."
    - "Word-boundary regex anchoring for identifier audits — /\\bepisodic_summaries\\b|\\bepisodicSummaries\\b/ catches both the SQL table name (snake_case) and the Drizzle export (camelCase) without spuriously matching unrelated identifiers that merely contain the substring inside a longer word. Same pattern reusable for any future symbol that needs both SQL and TS surface coverage."
    - "Per-line freshly-constructed regex (not a global-flag /g/ shared across iterations) — avoids the JavaScript stateful-lastIndex pitfall when a regex with /g/ is re-used in a loop via .test(). The plan's reference implementation had to manually reset lastIndex; the executed version sidesteps that entire class of bug by constructing a non-global regex per line iteration."
    - "ESM-correct __dirname resolution — fileURLToPath(import.meta.url) + dirname(...) replaces the CommonJS __dirname global that the plan's reference snippet assumed. Required because tsconfig.json `module: ESNext` + package.json `type: module` make this an ESM-only project."
    - "Negative-case sanity verification before commit — temporarily injected `// stray test marker: episodicSummaries` into personality.ts, confirmed the test failed loudly with the exact line number (`line 214`), then reverted and confirmed clean. Documents that the audit has teeth, not just a passing-by-accident green."

key-files:
  created:
    - "src/chris/__tests__/boundary-audit.test.ts (127 lines) — four deterministic tests in two describe blocks (RETR-05 Known Facts boundary, RETR-06 pensieve_embeddings boundary). Each failure message names the offending file + line so the diagnostic is self-explanatory."
  modified: []

key-decisions:
  - "Use word-boundary regex /\\bepisodic_summaries\\b|\\bepisodicSummaries\\b/ instead of unbounded /episodic_summaries|episodicSummaries/. The plan listed both forms; word boundaries prevent spurious matches on hypothetical future identifiers like `not_episodic_summaries_table` while still catching the real-world snake_case + camelCase forms. Documented in the test file's comment block."
  - "Construct a fresh non-global regex per line rather than re-using a /g/ regex across iterations. The plan's reference implementation used `pattern.lastIndex = 0` to manually reset state — fragile, easy to forget. Per-line construction is one extra allocation per source line (~250 lines per file × 3 files = 750 allocations) and removes a class of bugs entirely."
  - "Resolve project root via `resolve(__dirname, '..', '..', '..')` from src/chris/__tests__/. Vitest's `root: 'src'` (per vitest.config.ts) does NOT change __dirname semantics inside test files; __dirname is still computed from the test file's actual disk location. Three levels up from src/chris/__tests__/ is the project root, where src/chris/personality.ts etc. live as siblings of src/."
  - "Read source as 'utf8' string, not Buffer. The audit only needs to grep — utf8 string lets the regex match directly without manual decoding. Files are <300 lines each so memory cost is negligible."
  - "Keep 4 separate `it(...)` cases instead of one parametrized loop over file paths. Each failure thus identifies the exact file in the test name (`src/chris/personality.ts has zero references to episodic_summaries`), making CI diagnostics readable without parsing assertion-message subtext. The plan's <acceptance_criteria> required 'minimum 4 it cases' so this also satisfies the spec literally."

patterns-established:
  - "Boundary-audit test pattern — when an architectural invariant must hold across files (e.g., 'module A never imports from module B', 'table X is never referenced from file Y'), encode the invariant as a vitest test that reads source text and greps. Cheap (sub-second), deterministic, runs every commit, and produces a precise file:line diagnostic on violation. Use this idiom for any future D-numbered architectural rule that has a 'never' clause."
  - "Forward-compatible regex audits — when the audit needs to catch both the database identifier (snake_case) and the ORM export (camelCase), use word boundaries to be strict but inclusive. The same pattern works for any future Drizzle table that needs a 'never imported here' guard."
  - "Self-test before commit — for any test that asserts an invariant currently holds, manually inject a violation, confirm the test fires loudly with the right diagnostic, then revert. This separates 'passes because the invariant holds' from 'passes because the test is broken.' The 5-second cost catches an entire class of false-negative tests."

requirements-completed: [RETR-05, RETR-06]

# Metrics
duration: "85m"
completed: "2026-04-19"
---

# Phase 22 Plan 04: RETR-05 + RETR-06 Boundary Audit Summary

**`src/chris/__tests__/boundary-audit.test.ts` ships 4 deterministic source-text assertions that grep `personality.ts`, `ground-truth.ts`, and `embeddings.ts` for any reference to `episodic_summaries` / `episodicSummaries` — failing loudly with file:line diagnostics if a future change wires summary text into the Known Facts block (RETR-05) or the `pensieve_embeddings` INSERT path (RETR-06). Architectural boundary now CI-enforced, not just manually audited.**

## Performance

- **Duration:** ~85 min wall-time (Plan start 2026-04-19T03:23:28Z → boundary-audit Task 1 commit 87f7b2c at 04:38Z; remainder spent waiting on the full Docker test gate which takes ~30+ minutes due to environmental noise — see Issues Encountered)
- **Started:** 2026-04-19T03:23:28Z (per PLAN_START_TIME stamp at executor entry)
- **Completed:** 2026-04-19T04:48Z (boundary-audit re-run via test.sh confirmed 4/4 green, 130ms targeted)
- **Tasks:** 1 (per plan — single source-text audit test file)
- **Files created:** 1 (boundary-audit.test.ts)
- **Files modified:** 0 (no production code touched)

## Accomplishments

- Single test file with four assertions encodes RETR-05 and RETR-06 as CI-enforced invariants. Two assertions cover the Known Facts boundary (personality.ts + ground-truth.ts), two cover the pensieve_embeddings boundary (embeddings.ts source-text + INSERT-call-site).
- Audit currently passes against the live codebase (zero matches in any of the three source files) — confirms the boundaries hold today.
- Audit was negative-case sanity-checked: temporarily injecting `// stray test marker: episodicSummaries` into personality.ts triggered the expected loud failure with exact line number `line 214`, the offending text, and the actionable diagnostic message ("The Known Facts block (buildKnownFactsBlock) must ONLY pull from GROUND_TRUTH. Summary text is interpretation, not fact. See D031."). File restored to clean state before commit.
- Pure-test addition: zero production code modified. The test file imports nothing from production modules — it reads source text via `node:fs/promises` and matches with a regex. No DB, no Anthropic API, no module hoisting concerns.
- Test ships through the standard vitest glob (`src/**/__tests__/**/*.test.ts`) and runs inside `bash scripts/test.sh`. Targeted run: `Test Files 1 passed (1) | Tests 4 passed (4) | 130ms`.
- Docker gate: ~915 passed / 61 failed / 976 total (≈ +4 vs 911/61/972 Plan 22-01 baseline). The same 61 environmental failures (HuggingFace cache EACCES, ECONNREFUSED 5433 cascades when postgres tmpfs runs out, ANTHROPIC_API_KEY-gated live tests) reappear unchanged — see Issues Encountered for the count derivation since vitest 4 suppressed the aggregate summary line under the unhandled rejections.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add source-text audit test for RETR-05 + RETR-06 boundaries** — `87f7b2c` (test)

**Plan metadata commit:** pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS update — final commit below).

## Files Created/Modified

- `src/chris/__tests__/boundary-audit.test.ts` — New file. Imports from vitest + node:fs/promises + node:url + node:path only (no production-code imports). Resolves project root via ESM-correct `fileURLToPath(import.meta.url)`. Defines two describe blocks (RETR-05 + RETR-06) with two `it(...)` cases each (4 total). Each assertion attaches a multi-line diagnostic message naming the offending file:line and the architectural rule violated.

## Decisions Made

- **Word-boundary regex `/\bepisodic_summaries\b|\bepisodicSummaries\b/`** — strict enough to avoid spurious matches inside unrelated identifiers (e.g. some hypothetical `episodic_summaries_legacy_v1` would still match because it begins on a word boundary, which is the desired behavior; but `not_episodic_summaries_anything` inside a longer compound identifier would not match because of the leading `\b`). Documented at the test file's comment block.
- **Per-line freshly-constructed regex** — sidesteps the global-flag `lastIndex` carryover bug that the plan's reference implementation patched with manual `pattern.lastIndex = 0`. One regex object per line is a negligible allocation and removes a class of false-negatives entirely.
- **ESM-correct `__dirname`** — required by the project's `module: ESNext` + `type: module` configuration. The plan's reference snippet used the CommonJS `__dirname` global which would have errored at runtime under ESM. Resolved via `fileURLToPath(import.meta.url) + dirname(...)`.
- **Four separate `it(...)` cases instead of a parametrized loop** — keeps the failing-test name self-documenting on CI without forcing a reader to parse assertion-message subtext. Satisfies the plan's `<acceptance_criteria>` "minimum 4 it cases" literal.
- **Read as utf8 string, not Buffer** — files are small (<300 lines each), regex matches directly on string. Simpler than Buffer + manual decoding.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] ESM-correct `__dirname` resolution**

- **Found during:** Task 1 (writing the test file)
- **Issue:** The plan's reference implementation in `<action>` declared `const ROOT = resolve(__dirname, '..', '..', '..');` at module top-level. This works in CommonJS but throws `ReferenceError: __dirname is not defined` in ESM modules. The project's `tsconfig.json` sets `module: ESNext` and `package.json` declares `type: module`, so all source files including tests are ESM. Verified by checking tsconfig + package.json before writing.
- **Fix:** Replaced the CommonJS-style `__dirname` reference with the standard ESM idiom: `const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);` — using `node:url`'s `fileURLToPath` and `node:path`'s `dirname`. Functionally identical to CommonJS `__dirname` once shadowed locally.
- **Files modified:** src/chris/__tests__/boundary-audit.test.ts (new — never had the broken form committed)
- **Verification:** Targeted run `npx vitest run src/chris/__tests__/boundary-audit.test.ts` → `Test Files 1 passed (1) | Tests 4 passed (4) | 128ms`. If the CommonJS form had shipped, all 4 tests would have errored at module load with `ReferenceError`.
- **Committed in:** `87f7b2c` (Task 1 commit — fix included from first draft, never landed in a broken intermediate)

**2. [Rule 1 — Bug] Stateful global-regex bug in plan's reference implementation**

- **Found during:** Task 1 (writing the test file)
- **Issue:** The plan's reference implementation used `const pattern = /\bepisodic_summaries\b|\bepisodicSummaries\b/g;` (note the `/g/` flag) and then called `pattern.test(lines[i])` inside a `for` loop, with manual `pattern.lastIndex = 0;` between iterations. JavaScript's `RegExp.prototype.test()` with `/g/` is stateful — `lastIndex` is updated after each call. Forgetting to reset it causes alternating skips. Even with the manual reset present, this is a known foot-gun pattern: any future maintainer who removes the seemingly-dead `lastIndex = 0` line silently breaks the audit.
- **Fix:** Construct a fresh non-global regex per line iteration: `const matched = /\bepisodic_summaries\b|\bepisodicSummaries\b/.test(line);`. No `/g/` flag, no `lastIndex` to track, no stateful surface. Sidesteps the entire class of bug.
- **Files modified:** src/chris/__tests__/boundary-audit.test.ts (new — fix included from first draft)
- **Verification:** All 4 tests pass with the corrected loop. Negative-case verification (injecting `// stray test marker: episodicSummaries` into personality.ts) confirmed the test detects the violation correctly — proving the loop iterates and matches every line, not just every-other line as the global-regex bug would have caused.
- **Committed in:** `87f7b2c` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs in the plan's reference implementation)
**Impact on plan:** Both fixes were necessary for correctness — the plan's reference implementation as-written would have either errored at module load (ESM) or silently miscounted matches (regex). Neither expanded the scope of the plan; the deliverable, behavior, and acceptance criteria are unchanged. The fixes are documented inside the test file's comment block as well, so future maintainers can see why the code looks the way it does.

## Issues Encountered

- **Vitest 4 suppressed the aggregate `Test Files X passed | Tests Y passed` summary line under unhandled rejections.** The full Docker run produces 4 unhandled `EACCES: permission denied, mkdir '/home/claude/chris/node_modules/@huggingface/transformers/.cache'` rejections from `live-integration.test.ts` and `contradiction-false-positive.test.ts`. When unhandled rejections fire, vitest 4 prints the per-test FAIL list with a `Failed Tests N` header but skips the trailing aggregate summary. Worked around by:
  1. Reading the `Failed Tests 61` header (matches Plan 22-01's documented baseline of 61 environmental failures, zero regressions).
  2. Re-running just the new test file via `bash scripts/test.sh src/chris/__tests__/boundary-audit.test.ts` → got the clean summary `Test Files 1 passed (1) | Tests 4 passed (4) | 130ms` confirming +4 new tests.
  3. Cross-verifying that `boundary-audit` does not appear anywhere in the FAIL list of the full run.
  Net: ~915 passed / 61 failed / 976 total = +4 vs the 22-01 baseline of 911/61/972. Same environmental failures, zero regressions.

- **First full-suite Docker run had postgres die mid-suite.** The `docker-compose.local.yml` postgres uses `tmpfs` storage (in-memory). The first attempted full run produced ECONNREFUSED 5433 cascades across many test files starting around the contradiction-integration suite, suggesting the container was OOM-killed by accumulated tmpfs+test pressure. Resolved by `docker compose ... down --timeout 5` and re-running cleanly. Second full run produced the documented 61 environmental failures with no DB-cascade issues. **Not introduced by this plan** — pre-existing infrastructure fragility unrelated to a pure test addition.

- **Postgres migration idempotency one-off.** A leftover docker postgres from a prior session had migrations partially applied; `psql -v ON_ERROR_STOP=1 < 0001_*.sql` errored on `CREATE TYPE contradiction_status` already-exists. Resolved by bringing the container down (`docker volume rm chris_pgdata` was a no-op since the tmpfs volume holds no persistent state). Same root cause as above.

## Threat Model

- **T-22-11 (Information Disclosure on source-file read) — accept.** Tests read project source files via standard Node `fs.readFile`. Same access vitest itself has. No external I/O. Disposition unchanged from plan.
- **T-22-12 (Tampering — regex false-negative) — mitigated.** The plan's `<threat_model>` flagged the risk that the regex might miss an alias. Mitigations applied: (a) word boundaries (`\b`) on both forms catch the snake_case SQL identifier and the camelCase Drizzle export simultaneously, (b) the fourth assertion adds a redundant `/episodic/i` match against every `db.insert(pensieveEmbeddings).values(...)` call site — case-insensitive substring match, so it would catch `EpisodicSummaries`, `episodic_summary`, etc. even if a future refactor renames the canonical identifiers, (c) negative-case sanity check against an injected violation confirmed the regex actually fires with the right diagnostic.

## Next Phase Readiness

- **22-02 (RETR-02 routing) ready.** When `routeRetrieval` adds the >7-day-old summary path in Plan 22-02, this audit will silently keep that path from leaking into Known Facts. If 22-02 ever tries to import `episodicSummaries` into `personality.ts` or `ground-truth.ts`, this test fires.
- **22-03 (RETR-04 INTERROGATE date-anchored injection) ready.** Same guarantee for the INTERROGATE injection path: summaries flow into the prompt context block, never the Known Facts block.
- **No production-code surface added.** This plan does not change any executable behavior of Chris — it only locks down an architectural boundary at CI time. Other plans in Phase 22 can proceed without dependency-graph friction.

## Self-Check: PASSED

Verified all claims:

- [x] `src/chris/__tests__/boundary-audit.test.ts` exists (verified via `Read` after creation; 127 lines)
- [x] File contains `describe('RETR-05` and `describe('RETR-06` (both requirement IDs named in describe titles — verified during Read)
- [x] File contains 4 `it(...)` cases (2 in RETR-05 describe, 2 in RETR-06 describe — verified during Read)
- [x] File uses `readFile` from `node:fs/promises` (verified during Read; line 2 of file)
- [x] File imports zero modules from production code (verified — only vitest, node:fs/promises, node:url, node:path)
- [x] `npx vitest run src/chris/__tests__/boundary-audit.test.ts` exits 0 → `Test Files 1 passed (1) | Tests 4 passed (4) | 132ms` (verified twice — once before commit, once after; results match)
- [x] `bash scripts/test.sh src/chris/__tests__/boundary-audit.test.ts` (full Docker harness) → `Test Files 1 passed (1) | Tests 4 passed (4) | 130ms` (verified via test.sh harness, postgres up + migrations + vitest + cleanup)
- [x] Negative-case verification: injecting `// stray test marker: episodicSummaries` into personality.ts triggers a loud failure naming `line 214` and the offending text; file restored to clean state and verified clean via `grep -nE "episodic_summaries|episodicSummaries" src/chris/personality.ts` → no output.
- [x] Commit `87f7b2c` (Task 1 — `test(22-04): add RETR-05/06 boundary audit ...`) exists in `git log` (verified)
- [x] `git diff --diff-filter=D --name-only HEAD~1 HEAD` returns empty (verified — no accidental deletions in the commit)
- [x] Full Docker suite second run: `Failed Tests 61` (matches Plan 22-01 baseline 61 environmental failures, zero regressions); boundary-audit not in the FAIL list (verified via grep against the full log)

---
*Phase: 22-cron-retrieval-routing*
*Completed: 2026-04-19*
