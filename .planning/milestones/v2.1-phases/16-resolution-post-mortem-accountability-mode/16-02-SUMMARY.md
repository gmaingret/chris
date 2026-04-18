---
phase: 16-resolution-post-mortem-accountability-mode
plan: "02"
subsystem: chris/personality, chris/praise-quarantine, llm/prompts
tags:
  - accountability-mode
  - type-system
  - prompt-infrastructure
  - praise-quarantine
  - wave-1
dependency_graph:
  requires:
    - 16-01
  provides:
    - ACCOUNTABILITY ChrisMode value
    - ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT constant
    - buildSystemPrompt ACCOUNTABILITY case
    - praise quarantine bypass for ACCOUNTABILITY
  affects:
    - src/llm/prompts.ts
    - src/chris/personality.ts
    - src/chris/praise-quarantine.ts
    - src/chris/__tests__/personality.test.ts
    - src/chris/__tests__/praise-quarantine.test.ts
tech_stack:
  added: []
  patterns:
    - ChrisMode union extension pattern (additive, one new member)
    - buildSystemPrompt switch-case with dual placeholder replacement
    - praise quarantine bypass pattern (mode === 'X' short-circuit)
key_files:
  created: []
  modified:
    - src/llm/prompts.ts
    - src/chris/personality.ts
    - src/chris/praise-quarantine.ts
    - src/chris/__tests__/praise-quarantine.test.ts
    - src/chris/__tests__/personality.test.ts
decisions:
  - "ACCOUNTABILITY reuses pensieveContext param for decision context and relationalContext param for temporal Pensieve context — avoids changing buildSystemPrompt signature"
  - "ACCOUNTABILITY bypasses praise quarantine like COACH/PSYCHOLOGY — flattery prevention handled at prompt level (The Hard Rule + flattery prohibitions in the system prompt itself)"
metrics:
  duration_minutes: 8
  completed_date: "2026-04-16"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 5
---

# Phase 16 Plan 02: ACCOUNTABILITY Mode Registration

ACCOUNTABILITY registered as a valid ChrisMode with system prompt, buildSystemPrompt switch case, and praise quarantine bypass — enabling Plans 03-04 to route resolution/post-mortem conversations through a mode that enforces The Hard Rule prohibition at the prompt level.

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Add ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT + extend ChrisMode + buildSystemPrompt | dd19be3 | src/llm/prompts.ts, src/chris/personality.ts |
| 2 | Praise quarantine bypass + ACCOUNTABILITY tests | 016de34 | src/chris/praise-quarantine.ts, src/chris/__tests__/praise-quarantine.test.ts, src/chris/__tests__/personality.test.ts |

## Verification Results

- `npx tsc --noEmit`: PASSED (0 errors)
- `npx vitest run src/chris/__tests__/praise-quarantine.test.ts`: 13/13 tests passed
- `npx vitest run src/chris/__tests__/personality.test.ts`: 45/45 tests passed

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — all placeholder replacements are wired to actual parameters. `{decisionContext}` maps to `pensieveContext` param, `{pensieveContext}` maps to `relationalContext` param. Default fallback strings ("No decision context provided.", "No surrounding context found.") are functional, not stubs.

## Threat Flags

None beyond what the plan's threat model covers (T-16-01, T-16-02). Decision and Pensieve context are injected via placeholder replacement — no raw string concatenation with user input in the system prompt.

## Self-Check: PASSED

Files modified:
- FOUND: src/llm/prompts.ts — contains ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT
- FOUND: src/chris/personality.ts — ChrisMode includes 'ACCOUNTABILITY', buildSystemPrompt has case 'ACCOUNTABILITY'
- FOUND: src/chris/praise-quarantine.ts — bypass condition includes mode === 'ACCOUNTABILITY'
- FOUND: src/chris/__tests__/praise-quarantine.test.ts — contains 'bypasses quarantine for ACCOUNTABILITY mode'
- FOUND: src/chris/__tests__/personality.test.ts — contains describe('ACCOUNTABILITY mode') with 4 test cases

Commits verified:
- dd19be3: feat(16-02): add ACCOUNTABILITY mode — ChrisMode union, system prompt, buildSystemPrompt case
- 016de34: feat(16-02): praise quarantine bypass + ACCOUNTABILITY mode tests
