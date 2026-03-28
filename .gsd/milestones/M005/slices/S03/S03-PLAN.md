# S03: M003 + M004 Requirement Validation (R020–R021, R024)

**Goal:** R020, R021, R024 assessed with honest status and evidence; all 21 active requirements formally resolved; REQUIREMENTS.md traceability table and coverage summary finalized.
**Demo:** `grep -c 'Status: active' .gsd/REQUIREMENTS.md` returns 0. `grep -c 'Status: validated' .gsd/REQUIREMENTS.md` returns 15. `grep -c 'Status: deferred' .gsd/REQUIREMENTS.md` returns 11. R024 validation text no longer references "32 tests". Coverage summary shows 15 validated, 11 deferred, 2 out-of-scope.

## Must-Haves

- R020 status changed from `active` to `deferred` with evidence documenting schema groundwork and missing implementation
- R021 status changed from `active` to `deferred` with evidence documenting schema groundwork and missing implementation
- R024 status changed from `active` to `deferred` with stale "32 tests" validation text replaced by accurate deferred note
- Traceability table updated: R020, R021, R024 rows show `deferred` status with proof text
- Coverage summary updated: 0 active, 15 validated, 11 deferred, 2 out-of-scope
- `npx vitest run` still passes (no code changes, regression check only)

## Verification

- `grep -c 'Status: active' .gsd/REQUIREMENTS.md` returns 0
- `grep -c 'Status: validated' .gsd/REQUIREMENTS.md` returns 15
- `grep -c 'Status: deferred' .gsd/REQUIREMENTS.md` returns 11
- `! grep -q '32 tests prove silence detection' .gsd/REQUIREMENTS.md` (stale R024 text removed)
- `grep 'Active requirements:' .gsd/REQUIREMENTS.md | grep -q '0'`
- `npx vitest run` passes all existing tests

## Tasks

- [x] **T01: Update R020, R021, R024 to deferred and finalize REQUIREMENTS.md** `est:20m`
  - Why: These three requirements describe M003/M004 capabilities that were never implemented. R024's validation text is stale (claims 32 tests exist that don't). This task completes the M005 milestone by formally assessing every remaining active requirement.
  - Files: `.gsd/REQUIREMENTS.md`
  - Do: (1) Move R020, R021, R024 from the Active section to the Deferred section with accurate status, validation, and notes. (2) For R020: note schema groundwork (`pensieveEntries.source` varchar + `metadata` JSONB per D013) and list missing pieces (no OAuth, no Gmail API client, no sync orchestrator, no `sync_status` table). (3) For R021: note same schema groundwork and list missing pieces (no Immich API client, no asset sync, no `sync_status` table). Keep existing note "Immich replaces Google Photos". (4) For R024: replace stale validation text ("32 tests prove silence detection...") with honest deferred note (no `proactive_state` table, no sweep orchestrator, no silence detection, no mute logic, 0/109 tests reference proactive behavior). (5) Update traceability table rows for R020, R021, R024 to show `deferred` status with proof text. (6) Update coverage summary: Active=0, Validated=15, Deferred=11 (was 8 + R020, R021, R024), out-of-scope=2. (7) Run `npx vitest run` to confirm no regressions.
  - Verify: `grep -c 'Status: active' .gsd/REQUIREMENTS.md` returns 0 && `grep -c 'Status: deferred' .gsd/REQUIREMENTS.md` returns 11 && `npx vitest run`
  - Done when: Zero active requirements remain, all 28 requirements have terminal status (validated/deferred/out-of-scope), coverage summary is accurate, test suite passes.

## Files Likely Touched

- `.gsd/REQUIREMENTS.md`
