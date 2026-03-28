---
estimated_steps: 4
estimated_files: 1
skills_used: []
---

# T01: Update R020, R021, R024 to deferred and finalize REQUIREMENTS.md

**Slice:** S03 — M003 + M004 Requirement Validation (R020–R021, R024)
**Milestone:** M005

## Description

R020 (Gmail sync), R021 (Immich/Photos sync), and R024 (proactive outreach) describe M003/M004 capabilities that were never implemented. No code, no tests, no OAuth, no sync logic exists. R024's validation text in REQUIREMENTS.md is stale — it references "32 tests" that don't exist in this codebase (0 of 109 tests reference proactive behavior). This task moves all three from `active` to `deferred` with honest evidence, updates the traceability table, and finalizes the coverage summary so that zero active requirements remain.

## Steps

1. **Move R020, R021, R024 from Active to Deferred section.** Remove these three requirement blocks from the `## Active` section. Insert them into the `## Deferred` section (after the existing 8 deferred requirements, before `## Validated`). Change each `Status:` from `active` to `deferred`.

2. **Write accurate validation/notes for each:**
   - **R020** — Validation: `Deferred — not implemented. Schema groundwork: pensieveEntries has source varchar(50) and metadata JSONB columns that could support Gmail entries per D013. Missing: no OAuth implementation, no Gmail API client, no sync orchestrator, no sync_status table, no Gmail-related tests.`
   - **R021** — Validation: `Deferred — not implemented. Schema groundwork: pensieveEntries has source varchar(50) and metadata JSONB columns that could support Immich entries per D014. Missing: no Immich API client, no asset sync logic, no sync_status table, no Immich-related tests.` Keep existing note: "Immich replaces Google Photos (self-hosted). Metadata focus for M003; full image understanding deferred."
   - **R024** — Validation: `Deferred — not implemented. No proactive_state table (D015 not implemented), no sweep orchestrator, no silence detection, no mute logic, no proactive-related code or tests. 0 of 109 tests reference proactive behavior. Prior validation text was stale.` Notes: "Requires M002's relational memory and pattern synthesis."

3. **Update traceability table.** Change the rows for R020, R021, R024:
   - R020: status → `deferred`, proof → the deferred validation text above
   - R021: status → `deferred`, proof → the deferred validation text above
   - R024: status → `deferred`, proof → the deferred validation text above (replacing the "32 tests" text)

4. **Update coverage summary** at the bottom of REQUIREMENTS.md:
   - Active requirements: 0
   - Mapped to slices: 0 (or remove this line)
   - Validated: 15 (R001–R013, R022, R023 — unchanged)
   - Deferred: 11 (R014–R021, R024–R026)
   - Out-of-scope: 2 (R027, R028)
   - Unmapped active requirements: 0

5. Run `npx vitest run` to confirm no regressions (no code was changed, but this is the milestone's contract check).

## Must-Haves

- [ ] R020 moved to deferred with accurate evidence
- [ ] R021 moved to deferred with accurate evidence
- [ ] R024 moved to deferred — stale "32 tests" text replaced with honest assessment
- [ ] Traceability table rows for R020, R021, R024 updated
- [ ] Coverage summary shows 0 active, 15 validated, 11 deferred, 2 out-of-scope
- [ ] `npx vitest run` passes

## Verification

- `grep -c 'Status: active' .gsd/REQUIREMENTS.md` returns 0
- `grep -c 'Status: deferred' .gsd/REQUIREMENTS.md` returns 11
- `grep -c 'Status: validated' .gsd/REQUIREMENTS.md` returns 15
- `! grep -q '32 tests prove silence detection' .gsd/REQUIREMENTS.md` (stale text gone)
- `grep 'Active requirements:' .gsd/REQUIREMENTS.md | grep -q '0'`
- `npx vitest run` — all tests pass

## Inputs

- `.gsd/REQUIREMENTS.md` — current file with R020, R021, R024 as active with stale/unmapped validation

## Expected Output

- `.gsd/REQUIREMENTS.md` — updated with R020, R021, R024 deferred; traceability table corrected; coverage summary finalized
