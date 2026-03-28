# S01: M001 Requirement Validation (R001–R008, R010–R013)

**Goal:** All 12 M001-era requirements (R001–R008, R010–R013) show `status: validated` with concrete proof evidence in REQUIREMENTS.md.
**Demo:** `grep -c 'validated' .gsd/REQUIREMENTS.md` shows 12 more validated requirements than before; each has specific test names and/or code paths cited.

## Must-Haves

- R001–R008 and R010–R013 all updated to `status: validated` with evidence
- Validation text for each requirement cites specific test file names, test descriptions, and/or source code constructs
- Traceability table updated with validated status and proof column for all 12
- `npx vitest run` still passes (no regressions from any incidental changes)

## Verification

- `grep -c 'Status: validated' .gsd/REQUIREMENTS.md` returns at least 15 (3 existing + 12 new)
- `npx vitest run` passes cleanly
- For each of R001–R008, R010–R013: `grep -A2 "R0XX" .gsd/REQUIREMENTS.md | grep -q "Validation:"` confirms non-empty validation text

## Tasks

- [x] **T01: Update REQUIREMENTS.md with validation evidence for R001–R008, R010–R013** `est:30m`
  - Why: Each requirement needs its status changed from `active` to `validated` and its validation field populated with specific evidence (test names, code paths) from the research doc's evidence map.
  - Files: `.gsd/REQUIREMENTS.md`
  - Do: For each of the 12 requirements: (1) change `Status: active` to `Status: validated`, (2) replace `Validation: unmapped` with a concise evidence string citing specific test files, test descriptions, and code constructs from the evidence map below. Update the traceability table to reflect validated status and proof for all 12. Evidence map is provided in the task plan.
  - Verify: `grep -c 'Status: validated' .gsd/REQUIREMENTS.md` returns ≥15; `npx vitest run` passes
  - Done when: All 12 requirements show validated status with non-empty, specific evidence text; traceability table updated; tests pass

## Files Likely Touched

- `.gsd/REQUIREMENTS.md`
