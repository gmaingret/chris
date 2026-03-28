---
estimated_steps: 3
estimated_files: 1
skills_used: []
---

# T01: Update R014–R019 to deferred status with schema evidence

**Slice:** S02 — M002 Requirement Validation (R014–R019)
**Milestone:** M005

## Description

M002 "Deep Counsel" features (reflect mode, coach/produce mode, psychology mode, contradiction detection, relational memory) were never implemented. The only M002 artifacts are schema-level preparations in `src/db/schema.ts`. These 6 requirements must be updated from `active` to `deferred` with honest documentation of what exists and what's missing.

## Steps

1. **Update R014 entry** — Change `Status: active` → `Status: deferred`. Set Validation to: `Deferred — not implemented. Schema groundwork: conversationModeEnum includes REFLECT mode (src/db/schema.ts:47). Missing: no reflect mode handler in src/chris/modes/, engine.ts only routes JOURNAL/INTERROGATE, no reflect prompts in src/llm/prompts.ts.` Add to Notes: `Blocked on M002 implementation.`

2. **Update R015–R019 entries** — Same pattern for each:
   - **R015** (coach/produce mode): Cite conversationModeEnum includes COACH and PRODUCE. Missing: no mode handlers, no engine routing, no prompts.
   - **R016** (psychology with Opus): Cite conversationModeEnum includes PSYCHOLOGY. Missing: no mode handler, no Opus integration for this mode, no prompts.
   - **R017** (deep psychological analysis): Same as R016 — depends on psychology mode implementation.
   - **R018** (contradiction detection): Cite contradictions table (schema.ts:118-127), contradictionStatusEnum. Missing: no detection logic, no surfacing UI, no resolution flow.
   - **R019** (relational memory): Cite relationalMemory table (schema.ts:93-103), relationalMemoryTypeEnum. Missing: no memory writer, no observation recorder, no retrieval integration.

3. **Update traceability table** — Find the table rows for R014–R019 near the bottom of REQUIREMENTS.md. Change `active` to `deferred` in the status column for all 6 rows.

## Must-Haves

- [ ] R014 status changed from `active` to `deferred` with schema evidence in Validation
- [ ] R015 status changed from `active` to `deferred` with schema evidence in Validation
- [ ] R016 status changed from `active` to `deferred` with schema evidence in Validation
- [ ] R017 status changed from `active` to `deferred` with schema evidence in Validation
- [ ] R018 status changed from `active` to `deferred` with schema evidence in Validation
- [ ] R019 status changed from `active` to `deferred` with schema evidence in Validation
- [ ] Traceability table updated for all 6 rows

## Verification

- `grep -c 'Status: deferred' .gsd/REQUIREMENTS.md` returns 8 (existing 2 + new 6)
- `grep -c 'Status: active' .gsd/REQUIREMENTS.md` returns 3 (R020, R021, R024)
- `grep 'R014.*deferred' .gsd/REQUIREMENTS.md` matches in traceability table
- `grep 'R019.*deferred' .gsd/REQUIREMENTS.md` matches in traceability table

## Inputs

- `.gsd/REQUIREMENTS.md` — current requirements file with R014–R019 marked as `active` with `unmapped` validation
- `src/db/schema.ts` — schema evidence to cite (conversationModeEnum, relationalMemory table, contradictions table)
- `src/chris/engine.ts` — evidence that only JOURNAL/INTERROGATE are routed
- `src/chris/modes/` — evidence that only journal.ts and interrogate.ts exist

## Expected Output

- `.gsd/REQUIREMENTS.md` — updated with R014–R019 as `deferred`, validation text citing schema evidence, traceability table updated
