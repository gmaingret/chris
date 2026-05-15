---
phase: 44
plan: 01
subsystem: test-harness
tags: [ci, milestone-gate, fixture-hardening, m009, m010, m011, env-gate, require-fixtures]
status: complete
completed_at: 2026-05-15
duration_minutes: ~25
tasks_total: 12
tasks_complete: 12
commits: 12
requirements: [CI-01, CI-02, CI-03]
dependency_graph:
  requires:
    - "Phase 45 FIX-02 (synthesize-delta.ts:937 output-dir path bug fix; shipped Phase 45-02 commit aa9a01c)"
    - "Phase 45 FIX-02b (test constants aligned to operator output `m011-1000words-5days`; shipped Phase 45-02 commit c9c9eb0)"
  provides:
    - "REQUIRE_FIXTURES=1 env-gated milestone-gate CI hard-fail across M009/M010/M011"
  affects:
    - "scripts/test.sh CI invocation contract"
    - ".planning/REQUIREMENTS.md CI section traceability"
tech_stack:
  added: []
  patterns:
    - "Inline env-gated check (CONTEXT.md D-01) — no helper module, no abstraction"
    - "Single explicit gate-test per fixture (D-03) — CI sees 1 named failure, not silent skip"
    - "Orthogonal to RUN_LIVE_TESTS (D-07) — Family C live-* tests fail loud without paid Anthropic call"
key_files:
  modified:
    - "src/__tests__/fixtures/primed-sanity.test.ts"
    - "src/rituals/__tests__/synthetic-fixture.test.ts"
    - "src/__tests__/fixtures/primed-sanity-m010.test.ts"
    - "src/memory/profiles/__tests__/integration-m010-30days.test.ts"
    - "src/memory/profiles/__tests__/integration-m010-5days.test.ts"
    - "src/memory/profiles/__tests__/live-anti-hallucination.test.ts"
    - "src/__tests__/fixtures/primed-sanity-m011.test.ts"
    - "src/memory/profiles/__tests__/integration-m011-30days.test.ts"
    - "src/memory/profiles/__tests__/integration-m011-1000words.test.ts"
    - "src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts"
    - "scripts/test.sh"
    - ".planning/REQUIREMENTS.md"
  created: []
decisions:
  - "Inline pattern, no helper (D-01) — 10 files share one 4-line shape; abstraction over-engineered"
  - "REQUIRE_FIXTURES=1 env-var name (D-02) — mirrors RUN_LIVE_TESTS=1 polarity-inverted"
  - "Single failing test per fixture (D-03) — CI shows clear name + regen command, no over-fire"
  - "Family B dual-fixture files emit TWO gate-tests with disambiguated names (D-06)"
  - "Family C live-* files: gate-test predicate ORTHOGONAL to RUN_LIVE_TESTS (D-07) — no paid Anthropic call from CI gate"
  - "scripts/test.sh documents the contract but does NOT set REQUIRE_FIXTURES itself (D-05 + Discretion #4)"
  - "REQUIREMENTS.md gains single blockquote cross-link (D-05 bullet 2) — no new TESTING.md"
metrics:
  files_modified: 12
  lines_added: ~210
  lines_removed: 0
  tasks: 12
  commits: 12
---

# Phase 44 Plan 01: REQUIRE_FIXTURES env-gated hard-fail across 10 milestone-gate test files — Summary

REQUIRE_FIXTURES=1 env-gated hard-fail injected across all 10 M009/M010/M011 milestone-gate test files. CI now reports 1 named `[CI-GATE] fixture present` failure per missing fixture (12 gate-tests total — 8 Family A + 4 Family B / dual-fixture); local dev (env unset) preserves byte-identical skip-with-hint UX. Documentation cross-links added to `scripts/test.sh` header and `REQUIREMENTS.md` CI section.

## Commit Timeline (12 atomic per-task commits)

| Task | Commit  | File                                                        | Surface |
| ---- | ------- | ----------------------------------------------------------- | ------- |
| T01  | 463bac6 | src/__tests__/fixtures/primed-sanity.test.ts                | CI-03   |
| T02  | 3027099 | src/rituals/__tests__/synthetic-fixture.test.ts             | CI-03   |
| T03  | 13e09fb | src/__tests__/fixtures/primed-sanity-m010.test.ts (×2)      | CI-01   |
| T04  | a380417 | src/memory/profiles/__tests__/integration-m010-30days.test.ts | CI-01 |
| T05  | d6d6587 | src/memory/profiles/__tests__/integration-m010-5days.test.ts  | CI-01 |
| T06  | 50a07e5 | src/memory/profiles/__tests__/live-anti-hallucination.test.ts | CI-01 |
| T07  | 4cc86f0 | src/__tests__/fixtures/primed-sanity-m011.test.ts (×2)      | CI-02   |
| T08  | 8e1eba7 | src/memory/profiles/__tests__/integration-m011-30days.test.ts | CI-02 |
| T09  | a1495ca | src/memory/profiles/__tests__/integration-m011-1000words.test.ts | CI-02 |
| T10  | c4438a6 | src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts | CI-02 |
| T11  | 64f7ee0 | scripts/test.sh                                             | docs    |
| T12  | fd13d6f | .planning/REQUIREMENTS.md                                   | docs    |

## Goal-Backward Verification (end-to-end)

Phase Goal (ROADMAP §44): *"CI cannot report green when fixtures are absent."*

| Truth | Method | Result |
|-------|--------|--------|
| All 10 test files contain REQUIRE_FIXTURES | `grep -l 'REQUIRE_FIXTURES' <10 files> \| wc -l` | **10/10** |
| 12 gate-test blocks total (8 Family A + 4 Family B) | `grep -c '\[CI-GATE\]'` across 10 files | **12** |
| tsc clean | `npx tsc --noEmit` | **0 errors** in scope |
| Local-dev SKIP UX preserved | `console.log` blocks byte-unchanged | verified |
| Family C orthogonality (no paid Anthropic call) | `awk` bounded scan + describe.skipIf byte check | **no RUN_LIVE_TESTS / ANTHROPIC_API_KEY in either new gate-test block** |
| Vitest exits non-zero when fixture absent + env set | Real vitest invocation w/ m009-21days moved aside, REQUIRE_FIXTURES=1 | **exit=1**, `[CI-GATE] fixture present > tests/fixtures/primed/m009-21days/MANIFEST.json must exist when REQUIRE_FIXTURES=1` surfaced with full regen pointer |
| Local dev (env unset) doesn't surface [CI-GATE] | Same setup, REQUIRE_FIXTURES unset | **0 `[CI-GATE]` test names emitted** |

## Plan-Check Warnings Addressed

- **W-01 (truth #11 math fragility):** documented in this summary that the correct count is **12 gate-test blocks** (8 Family A + 4 Family B), not 8. The "8 fixtures vs 10 files" reconciliation in the plan's truth #11 is mathematically valid for unique fixtures but verification operates on per-file injection count. Future plan iterations should phrase as "12 gate-test blocks (one per `<fixture-name>-PRESENT` constant)" to remove ambiguity.
- **W-02 (T06 awk regex unreadability):** the verification step used T10's cleaner equivalent — `awk '/\[CI-GATE\] fixture present/,/^};?\s*$/'` — to bound-scan both Family C files and confirm orthogonality. The legacy escape-soup pattern in the plan's T06 acceptance criterion was bypassed in favor of the readable form. Both produce identical semantic results.

## Deviations from Plan

**None — plan executed exactly as written.**

Two cosmetic adjustments documented for the audit trail:

1. **T07/T09 M1K path alignment with Phase 45 reality:** the Plan 44-01 text and ROADMAP success criterion phrase Phase 45 FIX-02 as "operator regen lands at `m011-1000words`" — Phase 45 instead shipped as FIX-02a (decoupled `phrasesClause`) + **FIX-02b (test constants aligned to operator output `m011-1000words-5days`)** in commits aa9a01c + c9c9eb0. The on-disk path produced by `synthesize-delta.ts:964` remains `${milestone}-${targetDays}days` = `m011-1000words-5days`. Phase 44 gates inject against the **actual constants present in the test files** (`M1K_NAME = 'm011-1000words-5days'`, `FIXTURE_NAME = 'm011-1000words-5days'`) → operator-regen and CI-gate paths are aligned. Acceptance criterion T07/T09 "grep `m011-1000words-5days` scripts/synthesize-delta.ts returns 0" still passes (the script computes the path from interpolation, no longer hardcoding the bug variant). Phase 45 FIX-02 dependency is satisfied; T07/T09 commits ship as planned.

2. **Family C `awk` orthogonality check used T10's pattern, not T06's:** per Plan-Check W-02 / I-01, T10's `awk '/\[CI-GATE\] fixture present/,/^};?\s*$/'` is semantically equivalent to T06's escape-soup form but readable. Verification used T10's pattern; both Family C gate-tests confirmed zero `RUN_LIVE_TESTS` / `ANTHROPIC_API_KEY` references inside the new block (orthogonality verified).

## Operator-Visible Surface (post-deploy)

**Local dev (no env var):** unchanged. `bash scripts/test.sh` skips milestone-gate suites with the same `[primed-sanity] SKIP: ... Regenerate with: ...` console.log lines printed today.

**CI (REQUIRE_FIXTURES=1):** missing fixtures surface as named vitest failures:

```
FAIL src/__tests__/fixtures/primed-sanity.test.ts > [CI-GATE] fixture present > tests/fixtures/primed/m009-21days/MANIFEST.json must exist when REQUIRE_FIXTURES=1
  Error: Milestone-gate fixture missing: tests/fixtures/primed/m009-21days/MANIFEST.json.
         Regenerate via: npx tsx scripts/regenerate-primed.ts --milestone m009 --target-days 21 --seed 42 --force
```

Exit code: non-zero. CI cannot accidentally pass milestone gates that silently skip when fixtures are absent.

## Self-Check: PASSED

- 12 commits exist in `git log` (verified)
- All 12 modified files present and contain `REQUIRE_FIXTURES` (verified)
- TypeScript compiles clean across all 10 test files (verified `npx tsc --noEmit`)
- Real vitest run with manipulated fixture state shows expected `[CI-GATE]` failure name + regen pointer + exit=1 (verified)
- Local-dev path (env unset) shows zero `[CI-GATE]` names (verified)
- No production source files (anything outside `src/__tests__/`, `src/.../__tests__/`, `scripts/test.sh`, `.planning/`) modified (verified via `git diff --name-only HEAD~12 HEAD`)

---

*Phase 44 Plan 01 shipped 2026-05-15. CI-01 / CI-02 / CI-03 → green. Next: Phase 46 (FR/RU Localization Comprehensive) ready for orchestrator dispatch.*
