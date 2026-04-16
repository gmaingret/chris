---
phase: 18-synthetic-fixture-live-accountability-integration-suite
plan: "03"
subsystem: llm/decisions
tags: [gap-closure, exports, imports, callLLM, prompts, retrieve]
dependency_graph:
  requires: []
  provides: [callLLM, VAGUE_VALIDATOR_PROMPT, CAPTURE_EXTRACTION_PROMPT, RESOLVE_BY_PARSER_PROMPT, STAKES_CLASSIFICATION_PROMPT, ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT, getTemporalPensieve]
  affects: [src/decisions/resolution.ts, src/decisions/capture.ts, src/decisions/vague-validator.ts, src/decisions/triggers.ts, src/decisions/resolve-by.ts, src/chris/personality.ts]
tech_stack:
  added: []
  patterns: [never-throw, fail-soft, HAIKU_MODEL wrapper]
key_files:
  created: []
  modified:
    - src/llm/client.ts
    - src/llm/prompts.ts
    - src/pensieve/retrieve.ts
decisions:
  - callLLM wraps HAIKU_MODEL with temperature=0 for deterministic classification tasks
  - getTemporalPensieve follows never-throw pattern matching searchPensieve
  - MUTE_DETECTION_PROMPT already existed in prompts.ts; 5 new prompts appended after it
metrics:
  duration: ~5 minutes
  completed: "2026-04-16T21:11:12Z"
  tasks_completed: 3
  files_modified: 3
---

# Phase 18 Plan 03: Missing Exports Gap Closure Summary

Restored missing function exports and prompt constants that were lost during the Phase 18 worktree merge. Three shared modules updated so all decision source files import cleanly.

## One-liner

callLLM Haiku wrapper + 5 decision-phase prompts + getTemporalPensieve time-window query — all previously lost in the worktree merge, now restored as proper module exports.

## What Was Done

### Task 1: callLLM helper and 5 prompt constants (commit 6cdc3a7)

Added `callLLM(systemPrompt, userContent, maxTokens)` to `src/llm/client.ts`. This is a thin Haiku wrapper with `temperature: 0` that returns the first text block content as a string, or empty string on failure. Used by four decision modules (`vague-validator.ts`, `capture.ts`, `resolve-by.ts`, `triggers.ts`).

Added five prompt constants to `src/llm/prompts.ts`:
- `STAKES_CLASSIFICATION_PROMPT` — trivial/moderate/structural classifier for triggers.ts Phase B
- `CAPTURE_EXTRACTION_PROMPT` — greedy 5-slot extractor for capture.ts
- `RESOLVE_BY_PARSER_PROMPT` — NL timeframe-to-ISO-date parser for resolve-by.ts
- `VAGUE_VALIDATOR_PROMPT` — falsifiability judge with hedge-word seeding for vague-validator.ts
- `ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT` — neutral accountability partner for personality.ts ACCOUNTABILITY mode; contains `{decisionContext}` and `{pensieveContext}` placeholders

### Task 2: getTemporalPensieve (commit 747e5e5)

Added `getTemporalPensieve(centerDate: Date, windowMs: number)` to `src/pensieve/retrieve.ts`. Returns Pensieve entries within `centerDate ± windowMs` ordered chronologically (max 50). Uses `gte` and `lte` from drizzle-orm (added to import line). Follows the never-throw pattern established by `searchPensieve` — returns empty array on any error.

### Task 3: Import verification

Verified all named exports resolve without `Cannot find module` or `does not provide an export named` errors. All six decision source modules' import statements match the exported names.

## Verification Results

```
client.ts exports: { callLLM: 'function', anthropic: 'object', HAIKU_MODEL: 'string' }
prompts.ts exports: { VAGUE_VALIDATOR_PROMPT: 'string', CAPTURE_EXTRACTION_PROMPT: 'string', ... }
retrieve.ts exports: { getTemporalPensieve: 'function', searchPensieve: 'function', hybridSearch: 'function' }
All exports resolve
```

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 6cdc3a7 | feat(18-03): add callLLM helper and 5 missing prompt constants |
| 2 | 747e5e5 | feat(18-03): add getTemporalPensieve to retrieve.ts |
| 3 | (no files changed — verification only) | |

## Deviations from Plan

None — plan executed exactly as written. The database connection error during verification (`Missing required env var: DATABASE_URL`) was expected per the plan's note and is not an import resolution error.

## Known Stubs

None. All exports are complete implementations, not stubs.

## Threat Flags

None. New surface is limited to `callLLM` which is a thin wrapper over the existing Anthropic SDK path already in production.

## Self-Check: PASSED

- src/llm/client.ts modified: FOUND
- src/llm/prompts.ts modified: FOUND
- src/pensieve/retrieve.ts modified: FOUND
- commit 6cdc3a7: FOUND
- commit 747e5e5: FOUND
- export callLLM: VERIFIED (typeof === 'function')
- export getTemporalPensieve: VERIFIED (typeof === 'function')
- all 5 prompts: VERIFIED (all typeof === 'string')
