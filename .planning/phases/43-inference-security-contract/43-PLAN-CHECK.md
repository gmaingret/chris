# Phase 43 — Plan Check (Goal-Backward Verification)

**Date:** 2026-05-15
**Plans:** 43-01-PLAN.md (INJ-01 + INJ-02) + 43-02-PLAN.md (CONTRACT-01/02/03)
**Verdict:** PASS WITH WARNINGS — proceed to execution
**Issue counts:** 0 blockers / 3 warnings / 2 info

---

## Verdict Summary

All 5 v2.6.1 Phase 43 requirements (INJ-01, INJ-02, CONTRACT-01, CONTRACT-02, CONTRACT-03) are covered by ≥1 task with concrete files/action/verify/done. Dependency graph is clean (43-02 depends_on ["43-01"]). Migration HARD CO-LOC discipline is explicit (schema.ts + .sql + meta snapshot + journal + test.sh apply line ALL in Plan 02 Task 3). Scope is within budget (5 tasks/plan, ~12-15 files modified per plan including tests). No scope reduction language detected. CONTEXT.md decisions D-01..D-18 are all referenced by at least one task. Plans are ready to execute.

---

## Dimension-by-Dimension

### Dim 1: Requirement Coverage — PASS

| Req | Plan | Task | Action specificity |
|---|---|---|---|
| INJ-01 | 43-01 | T1+T2+T3 | sanitizeSubstrateText helper + 4 call-sites in profile-prompt.ts (Pensieve content, episodic summary, decision question, decision resolution) + epistemicTag allowlist |
| INJ-02 | 43-01 | T1+T4 | LOCAL sanitizeSubstrateText in psychological-profile-prompt.ts + 2 call-sites (corpus content, episodic summary) + epistemicTag allowlist; D-04 boundary respected |
| CONTRACT-01 | 43-02 | T1 | dataConsistency added to BOTH stripMetadataColumns sites (shared.ts:321-337 + profiles.ts:215-231) — D-09 explicit |
| CONTRACT-02 | 43-02 | T2 | substrateHash === '' null-return added to ALL 4 dimensions (jurisdictional/capital/health/family); describe.each parametrized over all 4 (D-11 .every() discipline) |
| CONTRACT-03 | 43-02 | T3+T4 | schema.ts column adds on profile_hexaco + profile_schwartz + profile_attachment + migration 0014 + upsertValues edit + integration test |

### Dim 2: Task Completeness — PASS

All 10 tasks across both plans have <files>, <action>, <verify><automated>, <acceptance_criteria>, <done>. No "MISSING" automated commands. No empty action blocks.

### Dim 3: Dependency Correctness — PASS

- 43-01: depends_on=[] → Wave 1
- 43-02: depends_on=["43-01"] → Wave 2
- No cycles. 43-02 Task 1 (stripMetadataColumns) correctly depends on 43-01's source-file edits being committed first to avoid merge conflicts on shared.ts.

### Dim 4: Key Links Planned — PASS

- 43-01: profile-prompt.ts → shared.ts via `import { sanitizeSubstrateText }` (explicit pattern in key_links)
- 43-01: psychological-profile-prompt.ts has LOCAL declaration (D-04 boundary) — key_links explicitly states this is NOT an import
- 43-02: migration 0014 SQL ↔ schema.ts (Drizzle generate consistency check via regen-snapshots.sh --check-only)
- 43-02: psychological-shared.ts upsertValues key maps to new schema.ts column
- 43-02: _journal.json entry references 0014 SQL filename

### Dim 5: Scope Sanity — PASS

- 43-01: 5 tasks, ~6 files modified (within budget; tests counted)
- 43-02: 5 tasks, ~14 files modified (HARD CO-LOC bundle inflates count but migration adds are mechanical)
- Plan 02 Task 3 is the largest task (schema.ts edits + .sql + meta regen + test.sh edits + verify gate) — acceptable because HARD CO-LOC discipline requires atomicity.

### Dim 6: Verification Derivation — PASS

`must_haves.truths` in both plans are user-observable, not implementation-focused:
- "forged ## CURRENT PROFILE STATE cannot hijack structured-output contract" (user-observable)
- "first-fire-after-deploy no longer shows Sonnet empty fields + anti-drift directive" (user-observable)
- "Sonnet's data_consistency persists in queryable column" (user-observable)

### Dim 7: Context Compliance — PASS

All 18 CONTEXT.md decisions (D-01..D-18) are referenced in plan tasks or acceptance criteria. No deferred ideas (fenced-JSON restructure, CONS-01 math, Anthropic SDK injection-sentinel API) leak into the plans. No scope reduction language detected (no "v1", "static for now", "future enhancement", "placeholder" markers).

**D-15/D-16 migration numbering (critical user instruction):** Plan 02 Task 3 ships `0014_psychological_data_consistency_column` as locked. Cross-checked against Phase 45 CONTEXT.md (lines 12, 84, 145, 169, 180, 205) which explicitly confirms Phase 45 takes 0015+0016 to accommodate Phase 43's 0014 slot. Coordination is clean.

### Dim 7b: Scope Reduction Detection — PASS

Grep for "v1", "v2", "simplified", "static for now", "hardcoded", "future enhancement", "placeholder", "minimal", "stub", "will be wired later" across both PLAN files returns no scope-reduction matches in task action blocks. The only "future" reference is the explicit `## Deferred Ideas` section in CONTEXT.md (correctly out-of-plan).

### Dim 8: Nyquist Compliance — PASS

VALIDATION.md is not separately produced for this phase (phase has RESEARCH.md-equivalent in CONTEXT.md + PATTERNS.md). Each task has an `<automated>` verify command running `bash scripts/test.sh` against real Docker postgres (per D-17). Sampling: every implementation task has automated verify (10/10). No watch-mode flags. No >30s delays. Wave 0 fixture-first pattern: Plan 01 Task 1 creates injection-attacks.ts BEFORE Task 3/Task 4 import it.

### Dim 9: Cross-Plan Data Contracts — PASS

Both plans modify `src/memory/profiles/shared.ts` — but Plan 01 adds `sanitizeSubstrateText` export, Plan 02 edits `stripMetadataColumns` discard list. Different functions in the same file; no conflict. 43-02 depends_on 43-01 sequences the edits correctly.

### Dim 10: CLAUDE.md Compliance — SKIPPED

No `./CLAUDE.md` content found (empty file).

### Dim 11: Research Resolution — N/A

No RESEARCH.md for this phase (CONTEXT.md + PATTERNS.md serve as research artifacts). All 18 decisions in CONTEXT.md `## Implementation Decisions` are LOCKED (no open questions).

### Dim 12: Pattern Compliance — PASS

PATTERNS.md maps all 13 modified/new files to analogs (13/13 match). Each plan task references its analog file in `<read_first>` (e.g., Plan 01 Task 2 reads computeSubstrateHash pattern; Plan 02 Task 3 reads profileJurisdictional CHECK pattern). HARD CO-LOC pattern is explicitly invoked for migration 0014.

---

## Findings

```yaml
issues:
  - dimension: requirement_coverage
    severity: warning
    description: "ROADMAP.md Phase 43 success criterion 5 says 'psychological_profile_history.data_consistency jsonb' but CONTEXT.md D-12/D-13 explicitly REJECTS that storage and chooses real columns on profile_hexaco/schwartz/attachment. Plans implement CONTEXT.md's decision (correct per discussion log line 52 — Option 1 chosen with rationale). ROADMAP cross-reference is stale but not blocking — same kind of stale doc note that CONTEXT.md D-16 already flags for v2.6.1-REQUIREMENTS.md migration numbering."
    plan: null
    fix_hint: "Non-blocking: planner should add a one-line ROADMAP update task (or batch with the REQUIREMENTS.md cross-reference cleanup that Phase 45 already inherited) to reflect the chosen real-column storage. Does NOT block Phase 43 execution since CONTEXT.md decisions are LOCKED and supersede ROADMAP narrative."

  - dimension: task_completeness
    severity: warning
    description: "Plan 02 Task 4 integration-test extension only covers profileHexaco (the existing test file's primary fixture). Task 4 acceptance criteria explicitly notes 'if only hexaco is in scope of this test file's current fixtures, hexaco is sufficient — schwartz + attachment columns are verified by the migration-applies-cleanly gate in Task 3.' Migration-applies-cleanly verifies the COLUMN exists but does NOT verify dataConsistency value flows through the schwartz/attachment upsert path with Sonnet emission > 0. The integration test file currently exercises both profileHexaco AND profileSchwartz (verified by grep), so extending the assertion to profileSchwartz is low-cost."
    plan: "43-02"
    task: 4
    fix_hint: "Add a 4-line assertion against profileSchwartz row (mirror of the profileHexaco block) so CONTRACT-03 persistence is verified on >1 psych table at integration-test level. profile_attachment is not yet wired in production (M011 carry-forward) so deferring its integration coverage is acceptable."

  - dimension: task_completeness
    severity: warning
    description: "Plan 02 Task 5 'full suite' gate notes: 'check by inspecting the test output for schema_mismatch warns on data_consistency — if any appear, surface the issue and add a follow-up task to update psychological-schemas.ts v3 boundary to include data_consistency in .strict() allowed keys.' This is a conditional follow-up dangling at end-of-plan, NOT a pre-execution hard requirement. If the v3 boundary IS .strict() with no data_consistency key, the Sonnet parse will fail at runtime AFTER the column add, not at test time. Worth pre-verifying."
    plan: "43-02"
    task: 5
    fix_hint: "Add a 1-minute pre-execution check: `grep -nE 'data_consistency|\\.strict\\(\\)' src/memory/profiles/psychological-schemas.ts` to confirm whether data_consistency is already a recognized boundary v4 field. If absent in a .strict() schema, surface as a Task 0 schema-update before Task 4 — closes the 'live-fire surprise' risk."

  - dimension: verification_derivation
    severity: info
    description: "Plan 02 Task 2's CONTRACT-02 unit test fixture SEED_ROW_SHAPE contains placeholder jsonb fields ('/* etc */') — executor will need to enumerate per-dimension required fields (jurisdictional: currentCountry/physicalLocation/residencyStatus; capital: fiPhase/...; health: openHypotheses/...; family: ...). The plan's <action> block notes this ('use the existing Phase 33 seed-row pattern from src/db/migrations/0012_operational_profiles.sql lines for inserts') so it's discoverable, but adds executor cognitive load."
    plan: "43-02"
    task: 2
    fix_hint: "Optional: pre-list the 4 dimension-specific seed JSONB shapes in the plan to remove discovery cost during execution. Not a blocker — the migration SQL is the source of truth and is one file away."

  - dimension: scope_sanity
    severity: info
    description: "Plan 01 Task 3 acceptance criteria includes 'Existing structural tests still pass (CONSTITUTIONAL_PREAMBLE first, prevState=null → no ## CURRENT PROFILE STATE, etc. — no regression)' — this overlaps with Plan 02 Task 2's CONTRACT-02 assertion which ALSO asserts 'prevState=null → no ## CURRENT PROFILE STATE'. No conflict (same assertion in different test blocks) but executor should not delete the Task 3 baseline expectation when adding Task 2's new describe.each."
    plan: "43-01,43-02"
    fix_hint: "Note in execution: Plan 02 Task 2 adds NEW tests; do not remove the Plan 01 Task 3 baseline structural assertions. Both must coexist GREEN."
```

---

## Cross-Verification Checks

| Item | Status |
|---|---|
| D-15/D-16: Plans ship 0014_psychological_data_consistency_column (NOT confused with Phase 45's 0015/0016) | PASS — Phase 45 CONTEXT.md confirms coordination |
| sanitizeSubstrateText helper applied at BOTH operational + psychological prompt assemblers | PASS — Plan 01 Tasks 2+3+4 |
| CONTRACT-02 covers ALL 4 operational dimensions (jurisdictional/capital/health/family) | PASS — Plan 02 Task 2 lists all 4 in describe.each |
| D-17 injection-attack fixtures at src/memory/__tests__/fixtures/injection-attacks.ts | PASS — Plan 01 Task 1 (correction: D-07 not D-17; D-17 is Docker test discipline) |
| CONTRACT-03 column added to ALL 3 psych tables (hexaco/schwartz/attachment) | PASS — Plan 02 Task 3 schema.ts + migration SQL |
| No scope creep (no deferred ideas in plans) | PASS — fenced-JSON restructure, CONS-01 math, Anthropic SDK API all absent from plan actions |

---

## Recommendation

**PROCEED TO EXECUTION.** 3 warnings are non-blocking quality observations:
1. ROADMAP success criterion #5 stale (CONTEXT.md decision supersedes; batch with Phase 45's REQUIREMENTS.md cleanup)
2. Plan 02 Task 4 could extend integration assertion to profileSchwartz (low-cost, high-value)
3. Plan 02 Task 5 should pre-verify psychological-schemas.ts v3 boundary includes data_consistency (avoids live-fire surprise)

The 2 info items are executor-orientation aids, not defects.

All 5 v2.6.1 Phase 43 requirements have task coverage with concrete acceptance criteria. Migration HARD CO-LOC discipline is locked. D-04 vocabulary boundary (no shared.ts import from psychological-profile-prompt.ts) is explicitly enforced in acceptance criteria. Live verification path is Sun 2026-05-17 22:00 Paris M010 + M011 cron fires (per project memory).
