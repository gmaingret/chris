---
phase: 11
plan: "01"
subsystem: memory/context-builder, chris/personality
tags: [prompt-engineering, retrieval, identity, tdd]
dependency_graph:
  requires: []
  provides: [PensieveContextOptions, includeDate-flag, Greg-test-contract]
  affects: [src/chris/modes/journal.ts (Wave 2 consumer)]
tech_stack:
  added: []
  patterns: [typed-options-object, TDD red-green]
key_files:
  created: []
  modified:
    - src/memory/context-builder.ts
    - src/memory/__tests__/context-builder.test.ts
    - src/chris/__tests__/personality.test.ts
decisions:
  - "PensieveContextOptions.includeDate defaults true for INTERROGATE backward compat; JOURNAL passes false"
  - "personality.test.ts intentionally left RED — Wave 2 turns green by renaming John→Greg in prompts"
metrics:
  duration_seconds: 108
  completed_date: "2026-04-15"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 11 Plan 01: Identity Grounding Infrastructure Summary

**One-liner:** PensieveContextOptions { includeDate } plumbing + pre-staged Greg test contract that Wave 2 must satisfy.

## What Was Built

This plan is pure infrastructure — no user-facing strings changed. It de-risks the Wave 2 identity rename by locking the test surface first so Wave 2 is graded by a fixed rubric.

### New PensieveContextOptions Interface

Added to `src/memory/context-builder.ts`:

```typescript
export interface PensieveContextOptions {
  /** Include the (YYYY-MM-DD | ...) date prefix on each entry. Default true. */
  includeDate?: boolean;
}

export function buildPensieveContext(
  results: SearchResult[],
  opts: PensieveContextOptions = {},
): string
```

**Semantics:**
- `includeDate` defaults `true` — INTERROGATE's citation format `(2026-04-14 | FACT | 0.87)` is unchanged.
- `includeDate: false` emits `(FACT | 0.87)` — no date, no double-pipe, no `unknown-date`. JOURNAL will call with this in Wave 2 to suppress fabricated prior-mention claims tied to entry creation timestamps.
- Filtering by `SIMILARITY_THRESHOLD` (0.3) is unchanged in both branches.
- `null` createdAt: when `includeDate=false`, no `unknown-date` appears (date branch never entered).

### Tests Added (context-builder.test.ts)

New describe block: `'buildPensieveContext { includeDate } option (Phase 11 / RETR-01)'`

| Test | Status |
|------|--------|
| default (no opts) emits date-prefixed entries — backward compatible | GREEN |
| opts.includeDate=true emits date-prefixed entries | GREEN |
| opts.includeDate=false omits the YYYY-MM-DD date prefix | GREEN |
| opts.includeDate=false still respects SIMILARITY_THRESHOLD filter | GREEN |
| opts.includeDate=false with null createdAt does not emit unknown-date | GREEN |

All 18 pre-existing tests still pass. Total: 23/23.

### Pre-staged Wave 2 Test Contract (personality.test.ts)

**Intentionally RED** — these tests define the exact strings Wave 2 must produce:

**Updated in `Known Facts injection (RETR-02)`:**
- `expect(prompt).toContain('## Facts about you (Greg)')` — 4 assertions (replaced from `'## Known Facts About John'`)
- `prompt.indexOf('Facts about you (Greg)')` — 2 occurrences in the ordering test

**New describe block `'Identity grounding (Phase 11 / RETR-01, RETR-02)'`:**

| Test | Fails because (current) | Wave 2 fix |
|------|------------------------|------------|
| JOURNAL prompt does not contain "John" | prompts.ts has ~35 "John" | rename all mode prompts |
| INTERROGATE prompt does not contain "John" | same | same |
| REFLECT prompt does not contain "John" | same | same |
| COACH prompt does not contain "John" | same | same |
| PSYCHOLOGY prompt does not contain "John" | same | same |
| PRODUCE prompt does not contain "John" | same | same |
| PHOTOS prompt does not contain "John" | same | same |
| JOURNAL Known Facts header is "Facts about you (Greg)" | header says "Known Facts About John" | rename buildKnownFactsBlock header |
| JOURNAL Known Facts block contains anti-split explanatory sentence | no such sentence exists | add sentence: "Greg in these facts refers to you — not a third party" |
| CONSTITUTIONAL_PREAMBLE addresses the user as Greg | preamble says "useful to John" | rename preamble |

13 tests intentionally RED, 28 tests GREEN. This is the correct contract handoff to Wave 2.

## Wave 2 Exact Strings Required

Wave 2 must produce these strings for the pre-staged tests to go green:

1. `## Facts about you (Greg)` — `buildKnownFactsBlock` header
2. A sentence matching `/Greg.*refer.*you|you.*not a third party/i` — anti-split explanatory sentence in Known Facts block
3. `useful to Greg` — in `CONSTITUTIONAL_PREAMBLE`
4. Zero occurrences of `\bJohn\b` in any mode prompt output from `buildSystemPrompt`

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This plan is infrastructure only; no UI rendering paths or data sources involved.

## Threat Flags

None. Per threat_model: no new input surfaces, no auth paths, no data egress. The `includeDate` boolean is controlled exclusively by trusted call-site code.

## Self-Check: PASSED

All files exist. Both task commits verified (bf9b7da, 9fa34cd). SUMMARY.md written.
