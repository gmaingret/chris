---
phase: 07-foundational-behavioral-fixes
plan: 02
subsystem: prompt-layer
tags: [anti-sycophancy, constitutional-preamble, language-injection, declined-topics, journal-ux]
dependency_graph:
  requires: ["07-01"]
  provides: ["buildSystemPrompt-extended", "constitutional-preamble", "DeclinedTopic-interface"]
  affects: ["07-03", "07-04"]
tech_stack:
  added: []
  patterns:
    - "Constitutional preamble prepended to all 7 mode prompts via buildSystemPrompt()"
    - "Optional language + declinedTopics params propagated through all 7 handlers"
key_files:
  created: []
  modified:
    - src/chris/personality.ts
    - src/llm/prompts.ts
    - src/chris/modes/journal.ts
    - src/chris/modes/interrogate.ts
    - src/chris/modes/reflect.ts
    - src/chris/modes/coach.ts
    - src/chris/modes/psychology.ts
    - src/chris/modes/produce.ts
    - src/chris/modes/photos.ts
    - src/chris/__tests__/engine.test.ts
    - src/chris/__tests__/interrogate.test.ts
    - src/chris/__tests__/reflect.test.ts
    - src/chris/__tests__/coach.test.ts
    - src/chris/__tests__/psychology.test.ts
    - src/chris/__tests__/produce.test.ts
decisions:
  - "D022 confirmed: preamble is additive (floor), existing mode content preserved exactly"
  - "Handler tests updated to assert new 5-arg buildSystemPrompt call signature"
  - "Stale JSDoc comment in prompts.ts (mentions enriching follow-ups) left as cosmetic — no behavior impact"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-13"
  tasks: 2
  files_modified: 15
requirements-completed: [TRUST-04, SYCO-01, SYCO-02, SYCO-03, LANG-03, LANG-04]
---

# Phase 07 Plan 02: Constitutional Preamble + Handler Wiring Summary

**One-liner:** Constitutional anti-sycophancy preamble prepended to all 7 mode prompts via extended `buildSystemPrompt()`, with language and declinedTopics plumbed through all 7 mode handlers.

## What Was Built

### Task 1: Constitutional preamble + buildSystemPrompt extension (TDD)

**personality.ts:**
- Added `DeclinedTopic` interface export (`topic: string`, `originalSentence: string`)
- Added `CONSTITUTIONAL_PREAMBLE` module constant with:
  - "Core Principles (Always Active)" heading
  - "useful to Greg, not pleasant" framing
  - The Hard Rule: no appeals to track record
  - Three Forbidden Behaviors: never resolve contradictions alone, never extrapolate to novel situations, never optimize for emotional satisfaction
- Extended `buildSystemPrompt()` signature with `language?: string` and `declinedTopics?: DeclinedTopic[]`
- Preamble prepended to every mode's output (JOURNAL, INTERROGATE, REFLECT, COACH, PSYCHOLOGY, PRODUCE, PHOTOS)
- Language Directive block appended when `language` param is set (MANDATORY override)
- Declined Topics block appended when `declinedTopics` is non-empty

**prompts.ts:**
- `JOURNAL_SYSTEM_PROMPT`: Replaced "You may ask enriching follow-up questions..." with "Most of the time, simply respond to what John shared — no question needed. Occasionally (not every message) you may ask a clarifying or deepening question..."

All 22 personality tests pass (SYCO-01, SYCO-02, SYCO-03, TRUST-04, LANG-03, LANG-04).

### Task 2: Wire all 7 handlers

All 7 handler files (journal, interrogate, reflect, coach, psychology, produce, photos) updated:
- Import `type DeclinedTopic` from `../personality.js`
- Add `language?: string, declinedTopics?: DeclinedTopic[]` to function signature
- Pass `language` and `declinedTopics` to `buildSystemPrompt()` call

New params are optional so existing callers (engine.ts) continue working without change — Plan 03 wires engine.ts.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `0418c2f` | Constitutional preamble + buildSystemPrompt extension |
| 2 | `ceac1ed` | Wire all 7 handlers to pass language and declinedTopics |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Pre-existing handler tests asserted old buildSystemPrompt arg count**
- **Found during:** Task 2 verification
- **Issue:** 7 existing handler unit tests used `toHaveBeenCalledWith` with 2-3 args matching the old `buildSystemPrompt(mode, pensieve?, relational?)` signature. After extending to 5 params, calling handlers without language/declinedTopics passes `undefined, undefined` as positions 4-5, causing these assertions to fail.
- **Fix:** Updated 6 test files (interrogate, reflect, coach, psychology, produce, engine) to include `undefined, undefined` in expected call args. Also updated engine.test.ts's two outdated assertions about JOURNAL prompt content and buildSystemPrompt return value.
- **Files modified:** src/chris/__tests__/interrogate.test.ts, reflect.test.ts, coach.test.ts, psychology.test.ts, produce.test.ts, engine.test.ts
- **Commits:** included in `ceac1ed`

## Known Stubs

None — all prompt injection is fully wired. The `language` and `declinedTopics` values will be `undefined` until Plan 03 updates engine.ts to detect language and track declined topics, but the handler plumbing is complete and correct.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. User input (declined topic sentences) is injected into system prompts as quoted text within a structured markdown section — mitigated per T-07-02 in plan threat model.

## Self-Check: PASSED

All created/modified files confirmed present. Both task commits verified in git log.
