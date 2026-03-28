# S02: M002 Requirement Validation (R014–R019)

**Goal:** R014–R019 updated from `active` to `deferred` with validation text documenting schema groundwork and missing implementation.
**Demo:** `grep -c 'Status: deferred' .gsd/REQUIREMENTS.md` returns 8 (existing R025, R026 + new R014–R019). `grep -c 'Status: active' .gsd/REQUIREMENTS.md` returns 3 (R020, R021, R024 remain for S03).

## Must-Haves

- R014–R019 each changed from `Status: active` to `Status: deferred`
- Each requirement's Validation field cites the schema evidence that exists (enums, tables in `src/db/schema.ts`) and the implementation that's missing (mode handlers, engine routing, prompts, detection logic)
- Traceability table at the bottom of REQUIREMENTS.md updated to reflect `deferred` status for R014–R019
- No code changes — documentation only

## Verification

- `grep -c 'Status: deferred' .gsd/REQUIREMENTS.md` returns 8
- `grep -c 'Status: active' .gsd/REQUIREMENTS.md` returns 3
- `grep 'R014.*deferred' .gsd/REQUIREMENTS.md` matches
- `grep 'R019.*deferred' .gsd/REQUIREMENTS.md` matches

## Tasks

- [x] **T01: Update R014–R019 to deferred status with schema evidence** `est:20m`
  - Why: M002 Deep Counsel features were never implemented — only schema groundwork exists. These requirements cannot be validated and must be honestly marked as deferred with documentation of what exists and what's missing.
  - Files: `.gsd/REQUIREMENTS.md`
  - Do: For each of R014–R019, change `Status: active` to `Status: deferred`. Update each Validation field with evidence: cite `src/db/schema.ts` lines for schema groundwork (conversationModeEnum includes REFLECT/PRODUCE/COACH/PSYCHOLOGY, relationalMemory table, contradictions table), and note missing implementation (no mode handlers in `src/chris/modes/`, engine.ts only routes JOURNAL/INTERROGATE, no prompts in `src/llm/prompts.ts`). Update the traceability table rows for R014–R019 from `active` to `deferred`. Add a Notes field explaining these are blocked on M002 implementation.
  - Verify: `grep -c 'Status: deferred' .gsd/REQUIREMENTS.md` returns 8 and `grep -c 'Status: active' .gsd/REQUIREMENTS.md` returns 3
  - Done when: All 6 requirements show deferred status with schema evidence, traceability table updated, active count drops from 9 to 3

## Files Likely Touched

- `.gsd/REQUIREMENTS.md`
