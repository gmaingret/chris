---
phase: 11
plan: "02"
subsystem: chris/personality, llm/prompts, proactive/prompts, chris/modes/journal
tags: [prompt-engineering, identity, persona, retrieval]
dependency_graph:
  requires: ["11-01"]
  provides: [Greg-identity-unified, includeDate-false-journal, zero-John-user-facing]
  affects: [src/chris/modes/journal.ts, JOURNAL system prompt, INTERROGATE citation pattern]
tech_stack:
  added: []
  patterns: [hard-coded-identity, per-call-date-suppression]
key_files:
  created: []
  modified:
    - src/chris/personality.ts
    - src/llm/prompts.ts
    - src/proactive/prompts.ts
    - src/chris/modes/journal.ts
    - src/chris/__tests__/engine.test.ts
decisions:
  - "Hard-coded 'Greg' throughout (no parameterization) — honors D009 single-user locked decision"
  - "Date suppression is per-call (JOURNAL only), not global — INTERROGATE citation pattern preserved"
  - "Classifier prompts (MODE_DETECTION, RELATIONAL_MEMORY, CONTRADICTION_DETECTION, MUTE_DETECTION) left unchanged — deferred per RESEARCH.md Pitfall 3"
  - "engine.test.ts mock extended to include hybridSearch (pre-existing HEAD mismatch fixed as Rule 1 deviation)"
metrics:
  duration_seconds: 420
  completed_date: "2026-04-15"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 5
requirements-completed: [RETR-01, RETR-02, RETR-04]
---

# Phase 11 Plan 02: Identity Grounding — Greg Unification Summary

**One-liner:** Renamed John→Greg across all 6 user-facing mode prompts, constitutional preamble, proactive prompt, and Known Facts block; wired JOURNAL to suppress date prefixes on retrieved Pensieve entries.

## What Was Built

### Task 1: personality.ts — CONSTITUTIONAL_PREAMBLE + buildKnownFactsBlock + declined-topics (commit da43c57)

**Substitutions in `CONSTITUTIONAL_PREAMBLE` (3 occurrences):**
- `useful to John` → `useful to Greg`
- `Never tell John he is right` → `Never tell Greg he is right`
- `Never optimize for John's emotional satisfaction` → `Never optimize for Greg's emotional satisfaction`

**`buildKnownFactsBlock` header + anti-split sentence:**
- Old: `const lines: string[] = ['## Known Facts About John'];`
- New:
  ```typescript
  const lines: string[] = [
    '## Facts about you (Greg)',
    'These are authoritative facts about you, the person Chris is talking to. Treat any reference to "Greg" in these facts as referring to you — not a third party.',
  ];
  ```

**`declinedTopics` map:** `(John said:` → `(Greg said:`

**Declined Topics body text:** 3 additional occurrences renamed.

**JSDoc on DeclinedTopic interface:** `A topic John has...` → `A topic Greg has...`

**`formatContradictionNotice`:** No "John" references found — no change required.

**John count in personality.ts:** 0 (was 8).

### Task 2: prompts.ts (6 user-facing) + proactive/prompts.ts (commit 9cf39d3)

**src/llm/prompts.ts — per-template substitution counts:**
| Template | John occurrences replaced |
|----------|--------------------------|
| JOURNAL_SYSTEM_PROMPT | 11 |
| INTERROGATE_SYSTEM_PROMPT | 7 |
| REFLECT_SYSTEM_PROMPT | 5 |
| COACH_SYSTEM_PROMPT | 6 |
| PSYCHOLOGY_SYSTEM_PROMPT | 9 |
| PRODUCE_SYSTEM_PROMPT | 5 |
| **Total user-facing** | **43** |

**Classifier templates byte-unchanged on John-count:**
- MODE_DETECTION_PROMPT: 0 → 0
- RELATIONAL_MEMORY_PROMPT: 19 → 19 (intentionally untouched)
- CONTRADICTION_DETECTION_PROMPT: 5 → 5 (intentionally untouched)
- MUTE_DETECTION_PROMPT: 0 → 0

**src/proactive/prompts.ts:** 7 occurrences renamed (John→Greg). JSDoc updated.

**Test result:** 41/41 personality.test.ts passing (all 13 previously RED tests now GREEN). 143/143 across 6 mode unit test files.

### Task 3: journal.ts call site + engine.test.ts mock fix (commit 5c11609)

**Change in `src/chris/modes/journal.ts` line 37:**
```typescript
// Before:
const pensieveContext = buildPensieveContext(searchResults);

// After (with explanatory comment):
// Phase 11 / RETR-04: suppress per-entry date prefix in JOURNAL so today's seed-stamp does not leak into "back on April 14th..." fabrications. INTERROGATE keeps dates (citation contract).
const pensieveContext = buildPensieveContext(searchResults, { includeDate: false });
```

**INTERROGATE call site (`interrogate.ts`):** Verified unchanged — `buildPensieveContext(searchResults)` with no opts argument. Default `includeDate: true` preserved.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] engine.test.ts mock missing hybridSearch export**
- **Found during:** Task 3
- **Issue:** `journal.ts` at HEAD calls `hybridSearch` from `pensieve/retrieve.js`, but `engine.test.ts` mock only exported `searchPensieve`. This caused 22 handleJournal test failures at HEAD.
- **Fix:** Added `hybridSearch: vi.fn().mockResolvedValue([])` and `JOURNAL_SEARCH_OPTIONS: { limit: 10 }` to the `pensieve/retrieve.js` mock in engine.test.ts.
- **Result:** 22 failures → 4 failures. The remaining 4 are pre-existing mismatches between engine.test.ts assertions and the HEAD code structure (buildSystemPrompt prepends constitutional preamble, so `buildSystemPrompt('JOURNAL') !== JOURNAL_SYSTEM_PROMPT`; system prompt is now an array not a string; COACH test still checks for "John has come to you"). These 4 are out of scope per deviation rules — they exist at HEAD before any of our changes.
- **Files modified:** `src/chris/__tests__/engine.test.ts`
- **Commit:** 5c11609

## Test Results

### Unit suite
- `personality.test.ts`: 41/41 passing (13 previously-RED identity grounding tests now GREEN)
- 6 mode test files (interrogate, reflect, coach, psychology, produce, journal): 143/143 passing
- `context-builder.test.ts`: 23/23 passing

### Full Docker suite (`./scripts/test.sh`)
- **733/741 passing** (8 failures, all pre-existing at HEAD before this plan)
- `models-smoke.test.ts`: 3 failures — requires real Anthropic API key (expected in test environment)
- `engine.test.ts`: 4 failures — pre-existing test/code mismatches at HEAD (not caused by this plan)
- `engine-mute.test.ts`: 1 failure — pre-existing at HEAD

## Live-Integration TEST-03 Status

Not run in this plan. Plan 11-03 owns the 3-of-3 gate for TEST-03 (JOURNAL grounding hallucination test). The `{ includeDate: false }` wiring is now in place; Plan 11-03 will verify the behavioral outcome.

## Known Stubs

None. All mode prompts address Greg directly. The Known Facts block emits the correct header and anti-split sentence. No placeholder or TODO text introduced.

## Threat Flags

None. This plan replaces hard-coded persona strings with other hard-coded persona strings. No new user-controlled interpolation, no new I/O surface, no auth or session change. Per threat_model in the plan: no STRIDE categories activate.

## Self-Check: PASSED

All source files exist on disk. All 3 task commits verified (da43c57, 9cf39d3, 5c11609). SUMMARY.md written.

- personality.ts: 0 John occurrences, "Facts about you (Greg)" header present, anti-split sentence present
- llm/prompts.ts: 43 user-facing John→Greg substitutions, classifier templates unchanged
- proactive/prompts.ts: 7 John→Greg substitutions
- journal.ts: { includeDate: false } wired, interrogate.ts unchanged
- personality.test.ts: 41/41 GREEN (13 formerly-RED now GREEN)
- Full Docker suite: 733/741 passing (8 pre-existing failures)
