---
phase: 30-test-infrastructure-harn-03-refresh
plan: 04
requirements-completed: [TEST-31]
status: complete
date: 2026-05-04
---

# Plan 30-04 Summary — Live Anti-Flattery Gate Flip (TEST-31)

## What shipped

Tightened the `describe.skipIf` gate on `src/rituals/__tests__/live-weekly-review.test.ts:46` to require BOTH `RUN_LIVE_TESTS` AND `ANTHROPIC_API_KEY` environment variables. Default `bash scripts/test.sh` runs SKIP this test (zero API spend per default CI run).

Also updated comment block above the describe to remove the stale `// PHASE-30: enable in TEST-31` marker and replace with the active TEST-31 contract (cost ceiling, manual invocation pattern, mirrored M008 precedent).

Added documentation to `.planning/codebase/TESTING.md`:
- New row in the Live Tests table for TEST-31 with note about dual-gated requirement
- New "Dual-gated pattern" section showing the predicate
- Manual invocation command snippet

## Verification

- Static diff verified: skipIf predicate now `!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY`
- ZERO changes to marker derivation block (lines 35-43 importing VALIDATION_MARKERS + REFLEXIVE_OPENER_FIRST_WORDS + FLATTERY_MARKERS) — preserves the 40-marker contract from Phase 29-04
- HARD CO-LOC #6 satisfied: TEST-31 owns its own plan (Plan 30-04); not bundled with Plan 30-02 implementation work
- Vitest direct-invocation hang in sandbox is a known live-integration import side effect (not a code defect); behavior on live server matches expected default-skip

## Decisions made

- Comment block rewrite picked an active-tense framing ("dual-gated per D-30-03 cost discipline") rather than the prior placeholder ("PHASE-30: enable in TEST-31"). This makes the gate's rationale visible at the call site for future readers.
- TESTING.md updated with the dual-gated pattern documented as a SECOND gate pattern alongside the existing single-gate one. This prevents the next live test author from accidentally copying the cheaper single-gate pattern when their test has a higher cost profile.
- Did NOT add `RUN_LIVE_TESTS` to the excluded-suites mechanism in scripts/test.sh — the skipIf gate is sufficient (and self-documenting at the test file level). If `scripts/test.sh` evolves to inject `RUN_LIVE_TESTS=1` automatically in some context, that exclusion list becomes the right place to opt out.

## Key files

- Modified: `src/rituals/__tests__/live-weekly-review.test.ts` (line 45-47, 1 predicate change + 6 lines comment rewrite)
- Modified: `.planning/codebase/TESTING.md` (+1 table row, +6 lines pattern documentation)
