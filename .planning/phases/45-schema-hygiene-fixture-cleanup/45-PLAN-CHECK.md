# Phase 45 Plan Check — Schema Hygiene & Fixture-Pipeline Cleanup

**Checked:** 2026-05-15
**Plans reviewed:** 45-01, 45-02, 45-03 (sibling agent wrote 45-02 + 45-03)
**Verdict:** ISSUES FOUND — 2 BLOCKERs + 2 WARNINGs

> **POST-CHECK ADDENDUM (2026-05-15 ~02:00 UTC, parent orchestrator):**
> Both BLOCKERs were resolved by races against this check, not by planner revision:
>
> - **B-01 (FIX-06 orphan)** — RESOLVED. The sibling planner agent was still running when this check ran at 01:49; it finished at ~01:53 and wrote Plan 45-04 (FIX-06, Wave C, depends_on [45-02, 45-03], 347 lines, 3 tasks). Verified: `requirements: [FIX-06]` frontmatter; well-formed closing tags. All 10 Phase 45 requirements now covered (SCHEMA-01→45-01, FIX-01..05/07/08→45-02, SCHEMA-02→45-03, FIX-06→45-04).
> - **B-02 (45-03 truncation)** — FALSE ALARM. 45-03-PLAN.md was being written when this checker read it. Final file is 443 lines with proper closing tags (`</output>`, `</success_criteria>`, `</verification>`, full Task 4 integration test) — re-inspected by parent after sibling planner completed. No truncation.
>
> WARNINGs W-01 and W-02 remain valid; W-01 is now resolved by 45-04 existing. W-02 (ROADMAP.md stale migration numbers 0014/0015) is fixed by parent in the same commit batch.
>
> **Effective verdict after addendum:** APPROVED. Proceed to `/gsd-execute-phase 45` (sequenced: Wave A [45-01 ∥ 45-02] → Wave B [45-03] → Wave C [45-04]).

---

## Coverage Matrix (10 requirements → plans)

| Req       | Plan(s)        | Status     |
|-----------|----------------|------------|
| SCHEMA-01 | 45-01          | COVERED    |
| SCHEMA-02 | 45-03          | COVERED *  |
| FIX-01    | 45-02 Task 1   | COVERED    |
| FIX-02a   | 45-02 Task 1   | COVERED    |
| FIX-02b   | 45-02 Task 4   | COVERED    |
| FIX-03    | 45-02 Task 2   | COVERED    |
| FIX-04    | 45-02 Task 2   | COVERED    |
| FIX-05    | 45-02 Task 3   | COVERED    |
| FIX-06    | **NONE**       | **ORPHAN** |
| FIX-07    | 45-02 Task 4   | COVERED    |
| FIX-08    | 45-02 Task 2   | COVERED    |

\* 45-03 is structurally incomplete — see B-02 below.

---

## Blockers

```yaml
- id: B-01
  dimension: requirement_coverage
  severity: blocker
  description: |
    FIX-06 ("M010 operational primed fixtures refreshed against backfilled
    schema") has NO covering plan. The 3 submitted plans declare
    requirements: [SCHEMA-01], [FIX-01,02,03,04,05,07,08], [SCHEMA-02] = 9 of 10.
    ROADMAP Phase 45 success criterion #7 ("M010 operational primed fixtures
    refreshed against the backfilled schema — PMT-06 schema_mismatch warns
    absent on the next milestone-gate run") is unaddressed by any task.
    Multiple references to a "Plan 45-04" exist inside 45-02 + 45-03 + PATTERNS.md
    (e.g. 45-PATTERNS.md table row "Plan 45-04 (Wave C — FIX-06 fixture refresh)";
    45-02 acceptance criteria explicitly say "may require Plan 45-04 fixture
    refresh to fully pass") but no 45-04-PLAN.md exists on disk. CONTEXT D-13
    + D-14 mandate the regen run + commit + PMT-06 local verification.
  plans: ["45-01", "45-02", "45-03"]
  fix_hint: |
    Author Plan 45-04 (Wave C, depends_on: ["45-03", "45-02"]) covering FIX-06.
    Tasks: (a) execute `npx tsx scripts/regenerate-primed.ts --milestone m010
    --force` against post-0016 schema, (b) commit refreshed
    tests/fixtures/primed/m010-*/ artefacts referencing SCHEMA-02 commit SHA
    per D-13, (c) verify PMT-06 anti-hallucination gate locally per D-14.

- id: B-02
  dimension: task_completeness
  severity: blocker
  description: |
    Plan 45-03 (SCHEMA-02) is structurally incomplete / truncated. File ends
    mid-`<automated>` block at line 333 inside Task 3's <verify>. Missing:
    closing </automated>, </verify>, <acceptance_criteria>, <done>, </task>,
    </tasks>, <verification>, <success_criteria>, <output>, and Task 4
    (the integration test). The frontmatter promises
    `src/__tests__/migrations/0016-seed-defaults-backfill.test.ts` in
    must_haves.artifacts with 4 test cases listed in must_haves.truths
    (post-migration shape / ALTER DEFAULT / idempotency / Zod-parse acceptance),
    but no <task> in the body creates that file. Execution against this plan
    will not produce the promised regression test and will likely fail XML
    parsing.
  plan: "45-03"
  fix_hint: |
    Re-emit 45-03 in full. Add Task 4: author 0016 integration test mirroring
    45-01 Task 5 pattern (postgres client, vitest describe/it, 4 cases per
    truths list). Close the file with <verification>, <success_criteria>,
    <output> sections matching 45-01's template.
```

## Warnings

```yaml
- id: W-01
  dimension: scope_sanity_and_downstream_dependency
  severity: warning
  description: |
    Plan 45-02 Task 4 acceptance_criteria line 592 explicitly states the
    primed-sanity-m011 vitest "may require Plan 45-04 fixture refresh to
    fully pass" and 45-02 verification line 624 says HARN test "either passes
    (if Plan 45-04 fixture refresh applied) or fails on the assertion content
    (gated, expected before Plan 45-04)". The plan is structurally green-able
    in isolation only via the "compiles + structural-pass" loophole. Combined
    with B-01 (no 45-04 exists), execution of 45-02 will leave the m010
    fixtures unrefreshed and PMT-06 still emitting schema_mismatch warns at
    milestone-gate time — phase exit criterion #7 unmet.
  plan: "45-02"
  fix_hint: |
    Resolve by addressing B-01 (author 45-04). No edit to 45-02 required
    once 45-04 lands and execution sequencing is Wave A (45-01 || 45-02) →
    Wave B (45-03) → Wave C (45-04).

- id: W-02
  dimension: cross_doc_consistency
  severity: warning
  description: |
    ROADMAP.md Phase 45 success criteria lines 123-124 use stale migration
    numbers ("Migration 0015_phase33_seed_defaults_backfill" and
    "Migration 0014_psychological_check_constraints"). CONTEXT.md D-18
    correctly overrides this — Phase 43 owns 0014 (CONTRACT-03 column
    addition per 43-CONTEXT D-15/D-16), so Phase 45 slots are 0015
    (SCHEMA-01) + 0016 (SCHEMA-02). All three plans correctly follow
    CONTEXT D-18 (45-01 ships 0015, 45-03 ships 0016). This is a docs-only
    drift in ROADMAP, NOT a plan defect, but Greg may want a follow-up
    one-line ROADMAP fix during/after Phase 45 execution.
  file: ".planning/ROADMAP.md:123-124"
  fix_hint: |
    Patch ROADMAP success criteria: "Migration 0015_psychological_check_constraints"
    (was 0014) and "Migration 0016_phase33_seed_defaults_backfill" (was 0015).
    Per CONTEXT D-18 cross-phase coordination note.
```

---

## Dimension Pass/Fail Summary

| Dimension                       | Status |
|---------------------------------|--------|
| 1. Requirement Coverage         | **FAIL** (FIX-06 orphan) |
| 2. Task Completeness            | **FAIL** (45-03 truncated) |
| 3. Dependency Correctness       | PASS (45-01 || 45-02 Wave A; 45-03 depends_on [45-01]; 45-04 absent so Wave C ungated) |
| 4. Key Links Planned            | PASS for present plans (FIX-04 .ssh-known-hosts ↔ fetch-prod-data wired; FIX-05 load-primed ↔ pensieve_embeddings staging cast wired; FIX-07 HARN ↔ substrate calendar-month-window mirrored) |
| 5. Scope Sanity                 | WARNING (45-02 has 4 tasks covering 7 reqs across 12 files — borderline acceptable per CONTEXT D-02 "pure parallel-task plan" rationale; would be cleaner as 2 plans but D-01 chose single phase) |
| 6. Verification Derivation      | PASS for present plans (must_haves truths are user-observable: "schema_mismatch warns absent", "MITM rejected", "wordCount window-filtered to substrate semantics") |
| 7. Context Compliance           | PASS for present plans on the decisions they touch (D-04 ranges, D-05 two-op migration, D-06 silent drop + log, D-07a/b decoupling+path, D-08 readdir glob, D-09/D-10 accept-new + UserKnownHostsFile, D-11/D-12 staging cast + smoke fixture, D-15/D-16 calendar window + MIN_SPEECH_WORDS, D-17 AbortController + exitCode, D-18 0015/0016 sequencing). Compliance for D-13/D-14 (FIX-06) cannot be evaluated since the plan does not exist. |
| 7b. Scope Reduction Detection   | PASS — no "v1", "static for now", "future enhancement" language found in present plans |
| 8. Nyquist Compliance           | SKIPPED (no VALIDATION.md in phase dir; only CONTEXT/PATTERNS/PLAN files present) |
| 9. Cross-Plan Data Contracts    | PASS — 45-02 + 45-03 + 45-01 touch disjoint surfaces; 45-02 + 45-04 (missing) share m010-fixture path but with clean producer/consumer split |
| 10. CLAUDE.md Compliance        | SKIPPED (./CLAUDE.md not present in working dir; only memory references exist; "always run full Docker tests" memory rule honored in all three plans' verification sections) |
| 11. Research Resolution         | SKIPPED (no RESEARCH.md for Phase 45) |
| 12. Pattern Compliance          | PASS — 45-PATTERNS.md analogs referenced in every task's read_first; 0013_psychological_profiles.sql:57/82/100 (CHECK syntax) cited for 45-01; 24-REVIEW BL-06 (staging-CAST) verbatim for 45-02 Task 3; psychological-shared.ts:259-273 (window SQL) verbatim for 45-02 Task 4 |

---

## Recommendation

Returning to planner. 2 blockers must be fixed before execution:

1. **Author Plan 45-04** covering FIX-06 (m010 fixture refresh — Wave C,
   depends_on ["45-03", "45-02"]).
2. **Complete Plan 45-03** — re-emit with closing tags, Task 4 (integration
   test), and complete `<verification>` / `<success_criteria>` / `<output>`
   sections.

Once both addressed, re-verify. Wave DAG D-02 will then hold:
- Wave A: 45-01 || 45-02 (parallel, no deps)
- Wave B: 45-03 (depends_on [45-01])
- Wave C: 45-04 (depends_on [45-03, 45-02])

Migration sequencing confirmed correct: 0014 (Phase 43, external), 0015
(SCHEMA-01, 45-01), 0016 (SCHEMA-02, 45-03), per CONTEXT D-18.
