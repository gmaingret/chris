---
phase: 21-consolidation-engine
plan: 01
subsystem: foundation
tags: [anthropic-sdk, zod, preamble, export, CONS-04, messages-parse, zodOutputFormat]

# Dependency graph
requires:
  - phase: 20-schema-tech-debt
    provides: "zod ^3.24.0 runtime dep, three-layer Zod chain (EpisodicSummarySonnetOutputSchema → Insert → DB-read) awaiting an Anthropic SDK capable of messages.parse() + zodOutputFormat()"
provides:
  - "@anthropic-ai/sdk bumped from 0.80.0 to 0.90.0 — unlocks messages.parse() + zodOutputFormat() from @anthropic-ai/sdk/helpers/zod"
  - "CONSTITUTIONAL_PREAMBLE exported as a named export from src/chris/personality.ts — single source of truth for the anti-sycophancy floor text, importable from any in-process module"
  - "Single-source-of-truth regression test covering D024 Three Forbidden Behaviors marker, D027 Hard Rule clause, and the byte-identity invariant (buildSystemPrompt(...).startsWith(CONSTITUTIONAL_PREAMBLE))"
affects:
  - "21-02 — src/episodic/prompts.ts will import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js' (CONS-04 explicit injection into the cron's system prompt)"
  - "21-04 — src/episodic/consolidate.ts will call client.messages.parse({ response_format: zodOutputFormat(EpisodicSummarySonnetOutputSchema), ... }) for zero-parse-failure structured Sonnet output"
  - "Every future consumer of the anti-sycophancy preamble (M008+ consolidation, M009 weekly review, M013 monthly/quarterly rituals) can now import the canonical text instead of re-declaring it"

# Tech tracking
tech-stack:
  added:
    - "@anthropic-ai/sdk@0.90.0 (bumped from 0.80.0 — minor semver bump, no breaking API changes in existing messages.create() callers)"
  patterns:
    - "Named-export constant for in-process constitutional text — promotes single-source-of-truth, lets downstream unit tests (CONS-04 future assertions) import the exact bytes to grep against"
    - "Surgical lockfile+tarball dependency bump when npm install reify fails due to root-owned node_modules subdirectories (same pattern documented in Plan 20-02 SUMMARY)"

key-files:
  created: []
  modified:
    - "package.json — @anthropic-ai/sdk dependency bumped ^0.80.0 → ^0.90.0"
    - "package-lock.json — root package dep updated + node_modules/@anthropic-ai/sdk block: version 0.80.0→0.90.0, tarball URL, sha512 integrity (sha512-MzZtPabJF1b0FTDl6Z6H5ljphPwACLGP13lu8MTiB8jXaW/YXlpOp+Po2cVou3MPM5+f5toyLnul9whKCy7fBg==)"
    - "src/chris/personality.ts — CONSTITUTIONAL_PREAMBLE declaration changed from `const` to `export const` on line 29 (1 line modified; preamble text byte-identical)"
    - "src/chris/__tests__/personality.test.ts — +1 describe block with 4 new assertions covering the exported symbol; import list extended to pull CONSTITUTIONAL_PREAMBLE"

key-decisions:
  - "Installed SDK 0.90.0 via tarball extraction + surgical lockfile patch (not `npm install @anthropic-ai/sdk@^0.90.0 --save`) because the workspace's root-owned node_modules/@anthropic-ai/ directory blocks npm's reify step with EACCES. Moved the pre-existing root-owned tree to node_modules/@anthropic-ai.bak.v0.80.0 (claude owns node_modules/ so the rename is permitted) and created a fresh claude-owned node_modules/@anthropic-ai/sdk/ populated from the verified tarball (sha512 matched registry exactly). Same environmental constraint and same technique documented in Plan 20-02 SUMMARY §\"Deviations\" for the zod install."
  - "Resolved concrete SDK version is 0.90.0 (the only 0.90.x published at time of bump; npm dist-tag `latest` === 0.90.0). Plan's `^0.90.0` spec is satisfied exactly. The optional zod peer dependency (`^3.25.0 || ^4.0.0`) is already satisfied by the installed zod@3.25.76 from Plan 20-02."
  - "SDK 0.90.0 declares the same transitive runtime dependency as 0.80.0 (`json-schema-to-ts: ^3.1.1`), already resolved at node_modules/json-schema-to-ts@3.1.1. Zero new transitive install needed."
  - "Task 2 edit is literally one word: `const` → `export const`. No whitespace changes, no JSDoc changes, no preamble text changes. `git diff src/chris/personality.ts` is a single-line edit. Engine behavior for all 8 modes (JOURNAL/INTERROGATE/REFLECT/COACH/PSYCHOLOGY/PRODUCE/PHOTOS/ACCOUNTABILITY) is provably unchanged — the existing 41 personality.test.ts assertions continue to pass byte-for-byte."
  - "Task 3 was committed together with Task 2 (not separately) per plan's explicit success criterion: \"Exactly two atomic commits: one for the SDK bump (Task 1), one for the preamble export + test (Tasks 2 + 3).\" The tests pass on first run because Task 2's implementation is already in place — this is expected and matches the TDD fail-fast exception for cases where the test documents an existing invariant rather than driving new behavior (the T-21-01-03 mitigation per threat model). The new assertions will fail loudly if any future edit tampers with the preamble text."

patterns-established:
  - "Single-source-of-truth test for in-process constitutional text — future consumers must import CONSTITUTIONAL_PREAMBLE rather than re-declare; drift is caught by `buildSystemPrompt(...).startsWith(CONSTITUTIONAL_PREAMBLE)` assertion"
  - "Surgical dependency bump via tarball extraction + lockfile patch — applicable whenever root-owned node_modules subdirectories block npm's reify step. Requires claude-owned parent directory; sha512 integrity must be verified against the registry before extraction; bak directory retained for revertibility."

requirements-completed: [CONS-04]

# Metrics
duration: "45m 22s"
completed: "2026-04-18"
---

# Phase 21 Plan 01: Anthropic SDK 0.90 + CONSTITUTIONAL_PREAMBLE Export Summary

**Bumped `@anthropic-ai/sdk` from 0.80.0 to 0.90.0 (unlocks `messages.parse()` + `zodOutputFormat()` via `@anthropic-ai/sdk/helpers/zod`) and promoted `CONSTITUTIONAL_PREAMBLE` in `src/chris/personality.ts` from a file-private constant to a named export — the two foundation pieces every subsequent Phase 21 plan depends on.**

## Performance

- **Duration:** 45m 22s (includes the full Docker test gate at ~40m)
- **Started:** 2026-04-18T16:52:09Z
- **Completed:** 2026-04-18T17:37:31Z
- **Tasks:** 3 (per plan)
- **Files modified:** 4
- **Files created:** 0 (pure wiring plan, as anticipated in the plan's `<objective>`)

## Accomplishments

- `@anthropic-ai/sdk` on-disk version is 0.90.0; `package.json` declares `^0.90.0`; `package-lock.json` pins resolved 0.90.0 with verified sha512 integrity
- `client.messages.parse()` is callable at runtime (probed against a fresh `Anthropic({apiKey})` instance — method exists, 0.80 had only `create/stream/countTokens`)
- `require('@anthropic-ai/sdk/helpers/zod')` returns `{ zodOutputFormat: [Function] }` — Plan 21-04's `runConsolidate` now has the downstream consumer contract for Phase 20's D-11 three-layer Zod chain
- `CONSTITUTIONAL_PREAMBLE` is exported from `src/chris/personality.ts` (byte-identical to the pre-export in-file constant; `git diff` is a single-word change)
- `src/chris/__tests__/personality.test.ts` gains 4 new covering assertions (`CONSTITUTIONAL_PREAMBLE export (Phase 21 CONS-04 dependency)` describe block) — test count in that file rose from 41 to 45 passing
- Full Docker test gate: **857 passed / 61 failed (918 total)** — up from Phase 20 baseline of **853 passed / 61 failed (914 total)** — exactly +4 passing (the 4 new assertions), **zero regressions**, same 61 environmental failures
- CONS-04 requirement satisfied (M006 preamble explicitly importable so the episodic consolidation cron can inject it per `.planning/research/PITFALLS.md` #1)

## Task Commits

Each task was committed atomically. Plan's explicit success criterion: "Exactly two atomic commits: one for the SDK bump (Task 1), one for the preamble export + test (Tasks 2 + 3)."

1. **Task 1: Bump `@anthropic-ai/sdk` to ^0.90.0** — `cbde395` (chore)
2. **Tasks 2 + 3: Export `CONSTITUTIONAL_PREAMBLE` + covering test** — `1202db2` (feat)

**Plan metadata:** pending (last commit of this SUMMARY — see `## Final Commit` below).

## Files Created/Modified

- `package.json` — single-line edit: `"@anthropic-ai/sdk": "^0.80.0"` → `"@anthropic-ai/sdk": "^0.90.0"` (line 16)
- `package-lock.json` — two locations updated: root `packages[""].dependencies["@anthropic-ai/sdk"]` value, and `packages["node_modules/@anthropic-ai/sdk"]` block (version, resolved URL, integrity hash)
- `src/chris/personality.ts` — line 29: `const CONSTITUTIONAL_PREAMBLE = ...` → `export const CONSTITUTIONAL_PREAMBLE = ...`; no other change; preamble text unchanged
- `src/chris/__tests__/personality.test.ts` — import list extended with `CONSTITUTIONAL_PREAMBLE`; new `describe('CONSTITUTIONAL_PREAMBLE export (Phase 21 CONS-04 dependency)', ...)` block appended at end with 4 `it(...)` assertions

## Decisions Made

- **Surgical tarball+lockfile install instead of `npm install --save`** — the workspace has a root-owned `node_modules/@anthropic-ai/` directory (created at build time by a different uid) that blocks npm's reify step. Pattern: move root-owned tree aside (to a `.bak` location), create a claude-owned fresh directory, extract the integrity-verified tarball into it, patch `package.json` + `package-lock.json` manually. This technique is documented in Plan 20-02 SUMMARY for the zod install; this is the second use. Zero net difference from what `npm install --save` would produce on a clean workspace.
- **Tasks 2 and 3 co-committed** — per plan's success criterion. Task 3 is a covering test that asserts invariants already true after Task 2's export. The TDD RED-phase fail-fast exception applies: the test documents an existing invariant (T-21-01-03 drift mitigation), not a new behavior to implement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking fix] Used tarball extraction + lockfile patch for the SDK bump (not `npm install @anthropic-ai/sdk@^0.90.0 --save`)**
- **Found during:** Task 1, before any edit (the plan explicitly anticipated this possible failure mode in `<critical_notes>`: "npm install may fail due to root-owned node_modules subdir. If so, use the surgical tarball+lockfile patch pattern documented in 20-02 SUMMARY.")
- **Issue:** `/home/claude/chris/node_modules/@anthropic-ai/` is owned by root:root (pre-existing workspace state — created at Docker image build time). `npm install` would fail with EACCES at the reify step because it cannot atomically delete/rename root-owned directories as the non-root claude user. No sudo available in this execution environment.
- **Fix:** (a) Downloaded `sdk-0.90.0.tgz` from https://registry.npmjs.org/@anthropic-ai/sdk/-/sdk-0.90.0.tgz. (b) Computed sha512 of the local file and verified it matches the registry's published integrity (`sha512-MzZtPabJF1b0FTDl6Z6H5ljphPwACLGP13lu8MTiB8jXaW/YXlpOp+Po2cVou3MPM5+f5toyLnul9whKCy7fBg==`). (c) Renamed `node_modules/@anthropic-ai/` to `node_modules/@anthropic-ai.bak.v0.80.0/` (the parent `node_modules/` is claude-owned, so the rename is permitted). (d) Created fresh `node_modules/@anthropic-ai/sdk/` directory and extracted the tarball's `package/` contents into it. (e) Patched `package.json` and `package-lock.json` surgically (same end state as an `npm install --save` on a clean workspace).
- **Files modified:** `package.json`, `package-lock.json` (both as intended by Task 1). Node_modules mutation is an environmental side-effect (not tracked by git).
- **Verification:** `node -e "require('@anthropic-ai/sdk/helpers/zod')"` returns `{ zodOutputFormat: [Function] }`. `node -e "new Anthropic({apiKey:'x'}).messages.parse"` returns a function (was undefined on 0.80). `npx tsc --noEmit` exits 0.
- **Committed in:** `cbde395` (Task 1 commit)
- **Justification:** Implementation-technique deviation forced by a pre-existing environmental constraint, not a semantic deviation. Same pattern + same workspace constraint as Plan 20-02's zod install. End state is identical to `npm install --save`. The plan explicitly anticipated and pre-approved this technique.

### Out-of-scope items
None. No `deferred-items.md` entries written.

---

**Total deviations:** 1 auto-fixed (1 blocking-fix — environmental, pre-anticipated)
**Impact on plan:** The deviation is a technique choice; the plan's intended semantic state (dependency bumped, lockfile integrity intact, TSC clean) is achieved exactly. No scope creep.

## Issues Encountered
None. The SDK bump was mechanical; the export was one word; the covering test ran green on first execution. The full Docker test suite's 61 failures are the same 61 environmental-baseline failures catalogued in Plan 20-03 SUMMARY (live-API tests failing on 401 without `ANTHROPIC_API_KEY`, and `@huggingface/transformers` cache `EACCES` on the root-owned cache subdirectory). Zero new failures introduced by this plan.

## Verification Results

### Plan's Wave-1 Verification Gate (5 simultaneous-truths test)

| # | Gate criterion | Result |
|---|---|---|
| 1 | `grep '"@anthropic-ai/sdk": "\^0\.9' package.json` matches exactly one line | PASS — matches 1 line (`"@anthropic-ai/sdk": "^0.90.0",`) |
| 2 | `grep -c '^export const CONSTITUTIONAL_PREAMBLE' src/chris/personality.ts` returns `1` | PASS — returns `1` |
| 3 | `npx tsc --noEmit` exits 0 | PASS — exit 0, no output |
| 4 | `./scripts/test.sh` exits 0 with test count strictly greater than Phase 20 floor | PASS — exit 0, 857 passing (Phase 20 floor: 853); strictly greater by 4 |
| 5 | Engine behavior unchanged — no test regression in `src/chris/__tests__/engine.test.ts` or `src/chris/__tests__/personality.test.ts` | PASS — `personality.test.ts` 41 → 45 (all +4 are new CONSTITUTIONAL_PREAMBLE export tests); `engine.test.ts` count unchanged |

### Must-have Truths (from plan frontmatter)

| # | Truth | Proof |
|---|---|---|
| 1 | `@anthropic-ai/sdk` at ^0.90.0; `messages.parse()` + `zodOutputFormat()` importable at module boundary | `grep` on package.json + runtime probe: `node -e "console.log(new (require('@anthropic-ai/sdk').default)({apiKey:'x'}).messages.parse)"` prints `[Function: ...]`; `require('@anthropic-ai/sdk/helpers/zod').zodOutputFormat` is a function |
| 2 | `CONSTITUTIONAL_PREAMBLE` exported from `src/chris/personality.ts` as a named export — importable without re-declaring the anti-sycophancy clauses | `grep -c "^export const CONSTITUTIONAL_PREAMBLE" src/chris/personality.ts` → 1; test `CONSTITUTIONAL_PREAMBLE export (Phase 21 CONS-04 dependency) > is a non-empty string exported from personality.ts` passes |
| 3 | Exported preamble is byte-identical to the in-engine constant — engine behavior unchanged for JOURNAL/INTERROGATE/REFLECT/COACH/PSYCHOLOGY/PRODUCE/ACCOUNTABILITY | `git diff src/chris/personality.ts` is exactly one line (`const` → `export const`) at line 29, preamble body unchanged; the new test `is the exact prefix of every mode's system prompt — single source of truth` asserts `buildSystemPrompt('JOURNAL', 'context', undefined, 'English').startsWith(CONSTITUTIONAL_PREAMBLE) === true`; all 45 `personality.test.ts` assertions pass including the pre-existing 41 that validate mode-specific content |
| 4 | Full test gate (≥157 after Phase 20) still passes — SDK bump introduces no runtime regression | `bash scripts/test.sh` exits 0 with 857 passing (gate's Phase 20 floor was 853; new count is 857 = 853 + 4 new CONS-04 tests); the 61 pre-existing failures are the same environmental baseline (live-API 401s + huggingface transformers cache EACCES) — zero new failures |

### Resolved `@anthropic-ai/sdk` version in `package-lock.json`
**0.90.0** (exactly — the only 0.90.x published on npm as of the bump; resolved via `npm view @anthropic-ai/sdk versions`). Tarball: `https://registry.npmjs.org/@anthropic-ai/sdk/-/sdk-0.90.0.tgz`. Integrity: `sha512-MzZtPabJF1b0FTDl6Z6H5ljphPwACLGP13lu8MTiB8jXaW/YXlpOp+Po2cVou3MPM5+f5toyLnul9whKCy7fBg==` (registry-verified).

### Test count before/after (per plan's explicit output requirement: "≥+4 delta")
- **Before (Phase 20 baseline):** 853 passed / 61 failed / 914 total
- **After (Phase 21 Plan 01):** 857 passed / 61 failed / 918 total
- **Delta:** +4 passing, +0 failing, +4 total — matches the 4 new assertions in Task 3 exactly
- The +4 specifically corresponds to: (a) `is a non-empty string exported from personality.ts`, (b) `contains the Hard Rule clause (D027)`, (c) `contains the Three Forbidden Behaviors marker (D024)`, (d) `is the exact prefix of every mode's system prompt — single source of truth`

### Grep confirmation of export keyword on `CONSTITUTIONAL_PREAMBLE`
```
$ grep -n "^export const CONSTITUTIONAL_PREAMBLE" src/chris/personality.ts
29:export const CONSTITUTIONAL_PREAMBLE = `## Core Principles (Always Active)
$ grep -c "^export const CONSTITUTIONAL_PREAMBLE" src/chris/personality.ts
1
```
Exactly one occurrence, at line 29 (the previous location of the private constant). Preamble body unchanged.

## Known Stubs
None. Every shipped change is fully wired:
- `@anthropic-ai/sdk@0.90.0` is on disk, loadable at runtime, and pinned in the lockfile — Phase 21 Plan 04 can import `zodResponseFormat`/`zodOutputFormat` directly.
- `CONSTITUTIONAL_PREAMBLE` export is a concrete exported symbol — Phase 21 Plan 02 can `import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js'` with no further enabling work.
- The 4 new personality tests assert live invariants against live code (no skips, no `.todo` placeholders).

## Threat Flags
None. The plan's threat register (T-21-01-01 to T-21-01-03) was fully discharged:
- T-21-01-01 (Tampering: `@anthropic-ai/sdk@0.90.x` npm package) — accepted per plan. npm lockfile `integrity` field captures the sha512 for supply-chain baseline; our local sha512 matched the registry value exactly before extraction.
- T-21-01-02 (Information disclosure: `CONSTITUTIONAL_PREAMBLE` export) — accepted per plan. Preamble text is already in git history and in every system prompt sent to Anthropic; promoting to export changes nothing.
- T-21-01-03 (Tampering: preamble constant drift) — **mitigated**. The single-source-of-truth test (`is the exact prefix of every mode's system prompt`) is live. Any future module that re-declares the preamble text instead of importing from `personality.ts` will fail this assertion.

## Next Phase Readiness
- Plan 21-02 (`src/episodic/prompts.ts`) — unblocked. Can now `import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js'` and inject explicitly into the consolidation system prompt.
- Plan 21-04 (`src/episodic/consolidate.ts`) — unblocked. Can now call `client.messages.parse({ response_format: zodOutputFormat(EpisodicSummarySonnetOutputSchema), ... })` using the three-layer Zod chain shipped in Plan 20-02.
- No new blockers or concerns.

## Self-Check: PASSED

Verified on 2026-04-18T17:37:31Z:
- FOUND: `.planning/phases/21-consolidation-engine/21-01-SUMMARY.md` (this file)
- FOUND: commit `cbde395` (`chore(21-01): bump @anthropic-ai/sdk to ^0.90.0 ...`) — git log
- FOUND: commit `1202db2` (`feat(21-01): export CONSTITUTIONAL_PREAMBLE from personality.ts + cover with single-source-of-truth test (CONS-04)`) — git log
- FOUND: `package.json` contains `"@anthropic-ai/sdk": "^0.90.0"` — grep
- FOUND: `package-lock.json` `node_modules/@anthropic-ai/sdk` block version is `"0.90.0"` — grep
- FOUND: `src/chris/personality.ts` line 29 starts with `export const CONSTITUTIONAL_PREAMBLE` — grep (count=1)
- FOUND: `src/chris/__tests__/personality.test.ts` contains `describe('CONSTITUTIONAL_PREAMBLE export (Phase 21 CONS-04 dependency)'` — grep
- Runtime: `node -e "require('@anthropic-ai/sdk/helpers/zod').zodOutputFormat"` returns `[Function: zodOutputFormat]`
- Runtime: `node -e "typeof new (require('@anthropic-ai/sdk').default)({apiKey:'x'}).messages.parse"` returns `function`
- `npx tsc --noEmit` exits 0 (no output)
- `npx vitest run src/chris/__tests__/personality.test.ts` exits 0 with 45 passing (was 41 pre-plan)
- `bash scripts/test.sh` exit 0 with 857 passed / 61 failed (918 total); Phase 20 baseline was 853/61/914 — zero regressions

---
*Phase: 21-consolidation-engine*
*Plan: 01*
*Completed: 2026-04-18*
