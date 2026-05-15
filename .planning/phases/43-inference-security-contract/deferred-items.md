# Phase 43 Deferred Items

Items discovered during Phase 43 execution that are OUT OF SCOPE (pre-existing
defects in unrelated files; not caused by Phase 43 changes).

## DEFERRED-43-01: integration-m011-1000words.test.ts PMT-03 baseline failure

**Discovered:** Plan 43-01 Task 5 (full src/memory/ test gate).
**File:** `src/memory/profiles/__tests__/integration-m011-1000words.test.ts:187`
**Test:** "PMT-03: 1000 words → both generators trip threshold, zero Sonnet, profiles preserved"
**Symptom:** `expect(hexacoSubstrate.belowThreshold).toBe(true)` — receives `false`, expects `true`.

**Status: PRE-EXISTING — NOT CAUSED BY PHASE 43**

Confirmed by checking out the test file from commit `9f8dadc` (the v2.6.1
baseline immediately before Phase 43 began) and running the same test in
isolation against fresh Docker postgres. The test fails identically on the
baseline — Phase 43's INJ-01 / INJ-02 / CONTRACT changes do not touch
`loadPsychologicalSubstrate`, the threshold logic, or the corpus filters
exercised here.

The fixed-time NOW anchor (`new Date('2026-05-01T09:00:00.000Z')`) at line 147
proves this is NOT a calendar-bomb introduced by today's date drift — the test
was already broken when Phase 42 shipped on 2026-05-15.

**Routing:** Surface to milestone audit as a v2.6.1 backlog item (likely a
fixture-seed mismatch — the test seeds 1000-word content but the substrate
loader may be using a different word-count tokenizer than the test expects).
Should be addressed in Phase 45 (Schema Hygiene & Fixture-Pipeline Cleanup)
under the FIX-* requirements bucket, OR by raising a TEST-* item under v2.6.1
stretch (T9 — Test quality).

**Per executor SCOPE BOUNDARY rule:** Phase 43 only auto-fixes issues DIRECTLY
caused by current-task changes. This failure pre-dates Phase 43 and lives in a
test file that does NOT exercise any Phase 43 surface — out of scope.
