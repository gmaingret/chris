---
phase: 35-surfaces
plan: "01"
subsystem: refactor
tags:
  - phase-35
  - surfaces
  - refactor
  - buildSystemPrompt
  - ChrisContextExtras
  - hard-co-loc-m10-4
  - typescript
  - vitest

# Dependency graph
requires:
  - phase: 33-profile-substrate
    provides: getOperationalProfiles reader API (consumed indirectly — Plan 35-02 wires it)
  - phase: 34-inference-engine
    provides: populated profile rows from Sunday 22:00 Paris cron (consumed indirectly — Plan 35-02 wires it)
provides:
  - ChrisContextExtras interface exported from src/chris/personality.ts
  - buildSystemPrompt signature (mode, pensieve?, relational?, extras?: ChrisContextExtras)
  - extras.operationalProfiles slot reserved for Plan 35-02 wiring
  - 8 production call sites migrated to extras-object shape (atomic, single plan)
  - 7 test files migrated (personality + engine direct-call; reflect/coach/psychology/interrogate/produce mocked-import)
  - ACCOUNTABILITY parameter overload semantics preserved verbatim (D-05)
  - HARD CO-LOC #M10-4 satisfied — no partial-refactor red-build leaked to main
affects:
  - phase-35-02
  - phase-35-03
  - phase-36

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional extras-object parameter pattern (replaces positional optional args)"
    - "Slot-reserved no-op (void operationalProfiles) during atomic two-plan refactor"
    - "Atomic signature-refactor pattern within a single plan (HARD CO-LOC discipline)"

key-files:
  created:
    - .planning/phases/35-surfaces/35-01-SUMMARY.md
  modified:
    - src/chris/personality.ts
    - src/chris/modes/journal.ts
    - src/chris/modes/interrogate.ts
    - src/chris/modes/reflect.ts
    - src/chris/modes/coach.ts
    - src/chris/modes/psychology.ts
    - src/chris/modes/produce.ts
    - src/chris/modes/photos.ts
    - src/decisions/resolution.ts
    - src/chris/__tests__/personality.test.ts
    - src/chris/__tests__/reflect.test.ts
    - src/chris/__tests__/coach.test.ts
    - src/chris/__tests__/psychology.test.ts
    - src/chris/__tests__/interrogate.test.ts
    - src/chris/__tests__/produce.test.ts

key-decisions:
  - "Extras destructured with default `extras ?? {}` (D-04 + T-35-01-V8-01 mitigation) so callers passing undefined cannot throw"
  - "operationalProfiles slot reserved via `void operationalProfiles;` no-op in Plan 35-01 — Plan 35-02 will consume it"
  - "ACCOUNTABILITY overload comment block (84-92) and switch-case body (133-148) preserved byte-identical per D-05 + T-35-01-V8-02"
  - "resolution.ts:252-257 migrates positional `rawLang` to `{ language: rawLang }` only — no `declinedTopics` invented (D-06 verified)"
  - "Mocked-test assertion shape: `{ language: undefined, declinedTopics: undefined }` literal (project idiom, mirrors adjacent assertions; no expect.objectContaining)"
  - "engine.test.ts uses ≤3 positional args at every call site — NO migration needed (verified via grep)"
  - "journal.test.ts / photos.test.ts / photos-memory.test.ts do not assert on `mockBuildSystemPrompt.toHaveBeenCalledWith` arg shapes — NO assertion migration needed in those files"

patterns-established:
  - "Pattern: Atomic signature refactor across a closed inventory of call sites (8 production + 7 mocked test files) within a single plan, gated by `npx tsc --noEmit` + `vitest run` + full Docker suite at the closing task"
  - "Pattern: Slot-reserved future-consumption — define the new field, destructure it, mark it intentionally unused (`void`), wire it in the immediately-following plan"

requirements-completed:
  - SURF-01

# Metrics
duration: ~14 min
completed: 2026-05-13
---

# Phase 35 Plan 01: buildSystemPrompt Signature Refactor Summary

**`buildSystemPrompt` now accepts `(mode, pensieve?, relational?, extras?: ChrisContextExtras)` — atomic 8-site production refactor + 7-test-file migration in a single plan, ACCOUNTABILITY overload preserved verbatim, `extras.operationalProfiles` slot reserved for Plan 35-02 wiring.**

## Performance

- **Duration:** ~14 min (02:31:03 → 02:44:55 UTC)
- **Started:** 2026-05-13T02:31:03Z
- **Completed:** 2026-05-13T02:44:55Z
- **Tasks:** 5 (4 code + 1 verification gate)
- **Files modified:** 15 (1 declaration + 8 production callers + 6 test files)

## Accomplishments

- Refactored `buildSystemPrompt` signature in `src/chris/personality.ts`:
  - Added `export interface ChrisContextExtras { language?, declinedTopics?, operationalProfiles? }` (all optional) per D-04
  - Changed 5-positional-arg signature to 4-arg with optional `extras?: ChrisContextExtras`
  - Destructures `extras ?? {}` on entry so the rest of the body uses unchanged locals
  - Preserves the 84-92 ACCOUNTABILITY overload comment block verbatim (D-05)
  - Reserves `operationalProfiles` with `void operationalProfiles;` no-op (Plan 35-02 consumes)
- Migrated all 8 production call sites atomically (D-06 inventory verified pre-work):
  - 7 mode handlers (journal/interrogate/reflect/coach/psychology/produce/photos)
  - `src/decisions/resolution.ts:252-257` ACCOUNTABILITY call site → `{ language: rawLang }` only
- Migrated 7 test files:
  - 2 direct-call: `personality.test.ts` (5 sites in declined-topics + language + ordering blocks) + `engine.test.ts` (no migration needed — all 16 sites use ≤3 args)
  - 5 mocked-import: reflect/coach/psychology/interrogate/produce `toHaveBeenCalledWith` assertions from positional `undefined, undefined` to `{ language: undefined, declinedTopics: undefined }` object
- Full Docker test suite: **1504 passed / 12 skipped / 29 failed** — EXACT MATCH to Plan 34-03 baseline (no regression)
- `npx tsc --noEmit` exits 0
- HARD CO-LOC #M10-4 satisfied — atomic refactor in one plan, no red-build window leaked

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor `buildSystemPrompt` signature + export `ChrisContextExtras`** — `4ea29fc` (refactor)
2. **Task 2: Migrate all 8 production call sites to extras-object shape** — `8e9c5cf` (refactor)
3. **Task 3: Migrate direct-call test files (`personality.test.ts`; `engine.test.ts` needs no migration)** — `46cdfd1` (test)
4. **Task 4: Migrate 5 mocked-import handler tests' `toHaveBeenCalledWith` assertions** — `37c760c` (test)
5. **Task 5: Full Docker test gate (verification-only marker)** — `4510bab` (test, empty)

**Plan metadata commit:** will be added by execute-plan.md harness with SUMMARY.md / REQUIREMENTS.md.

## Files Created/Modified

**Created:**
- `.planning/phases/35-surfaces/35-01-SUMMARY.md` — this file

**Modified — production (8 files):**
- `src/chris/personality.ts` — signature refactor + `ChrisContextExtras` export + destructure + `void operationalProfiles` slot
- `src/chris/modes/journal.ts` — JOURNAL call site: `{ language, declinedTopics }`
- `src/chris/modes/interrogate.ts` — INTERROGATE call site: `{ language, declinedTopics }`
- `src/chris/modes/reflect.ts` — REFLECT call site: `{ language, declinedTopics }` (Plan 35-02 will add operationalProfiles)
- `src/chris/modes/coach.ts` — COACH call site: `{ language, declinedTopics }` (Plan 35-02 will add operationalProfiles)
- `src/chris/modes/psychology.ts` — PSYCHOLOGY call site: `{ language, declinedTopics }` (Plan 35-02 will add operationalProfiles)
- `src/chris/modes/produce.ts` — PRODUCE call site: `{ language, declinedTopics }`
- `src/chris/modes/photos.ts` — JOURNAL persona (used by photos): `{ language, declinedTopics }`
- `src/decisions/resolution.ts` — ACCOUNTABILITY call site: `{ language: rawLang }` (D-05 overload preserved; no declinedTopics in scope, intentional)

**Modified — test (6 files):**
- `src/chris/__tests__/personality.test.ts` — 5 direct-call sites migrated (declined-topics block, language directive block, Known Facts ordering, CONSTITUTIONAL_PREAMBLE prefix)
- `src/chris/__tests__/reflect.test.ts` — REFLECT `toHaveBeenCalledWith` assertion: 4-arg object form
- `src/chris/__tests__/coach.test.ts` — COACH `toHaveBeenCalledWith` assertion: 4-arg object form
- `src/chris/__tests__/psychology.test.ts` — PSYCHOLOGY `toHaveBeenCalledWith` assertion: 4-arg object form
- `src/chris/__tests__/interrogate.test.ts` — INTERROGATE `toHaveBeenCalledWith` assertion: 4-arg object form
- `src/chris/__tests__/produce.test.ts` — PRODUCE `toHaveBeenCalledWith` assertion: 4-arg object form

## Drift Surfaced and Closed

**CONTEXT.md D-06 named only 2 test files affected. RESEARCH.md surfaced 8 mocked-import test files in addition.** Plan 35-01 closed both the named and the surfaced sites:

- Named (D-06): `personality.test.ts` (5 actual migration sites — 31 total mentions; most are 0-3 args and unaffected), `engine.test.ts` (16 mentions, all 0-3 args, no migration needed)
- Surfaced (RESEARCH.md §Summary lines 11-13): 8 mocked-import test files. Of those:
  - 5 have `toHaveBeenCalledWith` assertions that needed migration: reflect, coach, psychology, interrogate, produce
  - 3 do NOT have such assertions (verified via grep before migration):
    - `journal.test.ts` — no `mockBuildSystemPrompt.toHaveBeenCalledWith(...)` call (asserts on `buildPensieveContext` and final `mockCreate.calls[0][0].system[0].text`, both unaffected by the signature change)
    - `photos.test.ts` — stubs `buildSystemPrompt` return value (`mockBuildSystemPrompt.mockReturnValue('You are Chris...')`) but never asserts on call shape
    - `photos-memory.test.ts` — `buildSystemPrompt: vi.fn(() => 'You are Chris...')` inline stub, no call-shape assertion

**Net test-file count actually migrated: 6** (personality.test.ts + 5 mocked) — fewer than the worst-case 10 named in the plan. The 4 unaffected files (engine.test.ts + journal/photos/photos-memory) are documented above so a future reader does not re-investigate.

## Decisions Made

- **`engine.test.ts` requires NO migration.** Every one of its 16 `buildSystemPrompt(...)` calls uses 0-3 positional args; the new optional 4th `extras?` parameter is simply omitted at each call. Verified via `grep -nE "buildSystemPrompt\([^)]*,[^)]*,[^)]*,[^)]+\)" src/chris/__tests__/engine.test.ts` → 0 matches.
- **journal.test.ts, photos.test.ts, photos-memory.test.ts require NO assertion migration.** They mock the function for return-value stubbing but never assert on `toHaveBeenCalledWith` for `mockBuildSystemPrompt`. Verified via grep before touching any file.
- **Mocked-test assertion uses object literal `{ language: undefined, declinedTopics: undefined }`, not `expect.objectContaining`.** Project idiom — adjacent assertions in the same file (e.g., `mockBuildPensieveContext.toHaveBeenCalledWith(MOCK_SEARCH_RESULTS)`) use literal values when stub args are known. Plan 35-02 will update these same assertions to include `operationalProfiles: expect.stringContaining(...)` when the wiring lands.
- **`resolution.ts` call site does NOT pass `declinedTopics`.** D-06 line "no declinedTopics — verify intentional in plan" — verified by reading `resolution.ts:230-260`: the `handleResolution` function does not have a `declinedTopics` reference in scope at that point in the pipeline. Migration carries only `{ language: rawLang }`. ACCOUNTABILITY mode is invoked from a per-decision resolution flow, not a chat session, so the per-session declined-topics state is intentionally absent.

## Deviations from Plan

**None — plan executed exactly as written.**

The plan's `<call_site_inventory>` and `<acceptance_criteria>` were verified verbatim at each task boundary. No Rule 1/2/3 auto-fixes were needed. No Rule 4 architectural decisions arose. The plan's deliberate red-build window across Tasks 1-4 played out exactly as scripted: tsc was red after Task 1 (callers still 5-positional), green after Task 2 (production code uses new shape), and the test suite went red→green as mocked-test files migrated in Task 4.

## Issues Encountered

None. The plan's pre-work gate (re-running `grep -rn "buildSystemPrompt(" src/`) confirmed the 2026-05-13 D-06 inventory matched current main exactly. No new call sites emerged between context-gathering and execution.

## Verification Results

### TypeScript compile
```
npx tsc --noEmit   → exit 0
```

### Plan 35-01 regression gate (VALIDATION.md row 1)
```
npx vitest run src/chris/__tests__/personality.test.ts   → 1 file passed, 45/45 tests
npx vitest run src/chris/__tests__/engine.test.ts        → 1 file passed, 72/72 tests
```

### Mode-handler test files
```
npx vitest run src/chris/__tests__/{reflect,coach,psychology}.test.ts  → 3 files passed, 73/73 tests
npx vitest run src/chris/__tests__/{journal,interrogate,produce,photos,photos-memory}.test.ts  → 5 files passed, 82/82 tests
```

### Full Docker suite (Task 5)
```
bash scripts/test.sh   → 1504 passed / 12 skipped / 29 failed (1545 total)
```

**EXACT MATCH to Plan 34-03 baseline (1504 / 12 / 29).** The 29 failures distribute across 5 pre-existing live-API test files:

| File | Failures | Reason |
|------|----------|--------|
| `src/chris/__tests__/live-integration.test.ts` | 10 | Requires real `ANTHROPIC_API_KEY` (401 from Anthropic SDK) |
| `src/decisions/__tests__/live-accountability.test.ts` | 9 | TEST-13 live ACCOUNTABILITY against real Sonnet — documented pending |
| `src/decisions/__tests__/vague-validator-live.test.ts` | 4 | TEST-14 vague-prediction resistance — documented pending |
| `src/episodic/__tests__/live-anti-flattery.test.ts` | 3 | TEST-22 live anti-flattery — documented pending |
| `src/llm/__tests__/models-smoke.test.ts` | 3 | Live model API smoke test — documented pending |

All 5 are listed in STATE.md "~48 remaining failing tests" / Plan 34-03 baseline / deferred-items.md. **Zero new failures introduced by Plan 35-01.**

### Acceptance criteria verification

All 5 tasks' acceptance criteria pass:

```
# Task 1
grep -c "export interface ChrisContextExtras" src/chris/personality.ts   → 1
grep -c "extras?: ChrisContextExtras" src/chris/personality.ts            → 1
grep -c "const { language, declinedTopics, operationalProfiles } = extras" src/chris/personality.ts  → 1
grep -c "IN-04: ACCOUNTABILITY mode overloads the parameter semantics" src/chris/personality.ts  → 1
grep -c "void operationalProfiles" src/chris/personality.ts               → 1

# Task 2
grep -rn "buildSystemPrompt(" src/chris/modes/ src/decisions/resolution.ts | grep -vE "\\{ language|\\{ language: rawLang"  → 0 lines
grep -c "{ language: rawLang }" src/decisions/resolution.ts               → 1
grep -rn "buildSystemPrompt.*language, declinedTopics)" src/chris/modes/  → 0 lines

# Task 3
grep -cE "buildSystemPrompt\\([^)]*,[^)]*,[^)]*,[^,)]*,[^)]*\\)" personality.test.ts engine.test.ts  → 0 (no 5-arg positional)

# Task 4
grep -rnE "toHaveBeenCalledWith\\([^)]*undefined,\\s*undefined\\s*\\)" mocked test files  → 0 (no stale 5-arg trailers)

# Task 5
git log --oneline -5 | grep -cE "35-01"  → 5 (5 task commits visible)
```

## Threat Model Disposition

Per `<threat_model>` in 35-01-PLAN.md:

| Threat ID | Status |
|-----------|--------|
| T-35-01-V8-01 (Info Disclosure via extras destructure) | **mitigated** — `const { ... } = extras ?? {}` defaults all locals to `undefined`; downstream guards (`if (language)`, `if (declinedTopics && ...)`) handle nullish exactly as before. No new info-leak surface. |
| T-35-01-V8-02 (Tampering with ACCOUNTABILITY overload) | **mitigated** — 84-92 comment block byte-identical; switch-case at 133-148 byte-identical; `resolution.ts` only changes the migration call shape, not the overload mapping. |
| T-35-01-V11-01 (Elevation via missed test migration) | **mitigated** — All 5 mocked-import files with `toHaveBeenCalledWith` assertions migrated; the 3 files without such assertions documented as no-op in this SUMMARY. Acceptance grep returns 0 stale trailers. |
| T-35-01-V7-01 (Repudiation — silent red-build between tasks) | **accepted** — Designed and closed within the 4-task atomic window. Task 5's full Docker gate is the green-state attestation. |

## Threat Flags

(No new security-relevant surface introduced — refactor is mechanical and preserves all trust boundaries.)

## Next Plan Readiness

- `ChrisContextExtras` exported; Plan 35-02 imports it directly.
- `extras.operationalProfiles` slot is unconsumed (no-op `void`) — Plan 35-02 will:
  1. Add `PROFILE_INJECTION_MAP` named constant + `formatProfilesForPrompt(profiles, mode)` to `src/memory/profiles.ts`
  2. Wire REFLECT/COACH/PSYCHOLOGY handlers: `getOperationalProfiles()` → `formatProfilesForPrompt()` → pass via `extras.operationalProfiles`
  3. Update `personality.ts` switch-case for REFLECT/COACH/PSYCHOLOGY to prepend the `## Operational Profile (grounded context — not interpretation)` block to `contextValue` BEFORE `.replace('{pensieveContext}', ...)`
  4. Remove the `void operationalProfiles;` line from `personality.ts` once the local is consumed
  5. Update mocked-test assertions in reflect/coach/psychology to include `operationalProfiles: expect.stringContaining(...)` or similar
- `npx tsc --noEmit` is clean; the 5-positional → 4-with-extras transition is complete.
- HARD CO-LOC #M10-4 closed; Plan 35-02 can ship without re-touching call-site shapes.

## Self-Check

Verifying claims before signoff:

```
# Created file
[ -f .planning/phases/35-surfaces/35-01-SUMMARY.md ]   → FOUND (this file, after write)

# Task commits
git log --all --oneline | grep -c 4ea29fc  → 1 (FOUND)
git log --all --oneline | grep -c 8e9c5cf  → 1 (FOUND)
git log --all --oneline | grep -c 46cdfd1  → 1 (FOUND)
git log --all --oneline | grep -c 37c760c  → 1 (FOUND)
git log --all --oneline | grep -c 4510bab  → 1 (FOUND)
```

**Confirmation (run after SUMMARY commit):**

```
FOUND: 35-01-SUMMARY.md
FOUND: 4ea29fc   (Task 1)
FOUND: 8e9c5cf   (Task 2)
FOUND: 46cdfd1   (Task 3)
FOUND: 37c760c   (Task 4)
FOUND: 4510bab   (Task 5)
FOUND: d877c5d   (SUMMARY commit)
```

## Self-Check: PASSED

All claimed artifacts exist on disk and in git history.

---
*Phase: 35-surfaces*
*Plan: 35-01*
*Completed: 2026-05-13*
