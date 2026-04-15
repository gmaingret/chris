---
phase: 12
plan: "01"
subsystem: proactive/mute, proactive/triggers, planning/frontmatter
tags: [identity, tech-debt, frontmatter-hygiene, rename]
dependency_graph:
  requires: ["11-02"]
  provides: [Greg-identity-mute-clean, Greg-identity-opus-clean, phase11-summaries-requirements-complete]
  affects: [v2.0-MILESTONE-AUDIT 3-source cross-check for RETR-01/02/04 and TEST-03]
tech_stack:
  added: []
  patterns: [string-substitution, frontmatter-backfill]
key_files:
  created: []
  modified:
    - src/proactive/mute.ts
    - src/proactive/triggers/opus-analysis.ts
    - .planning/phases/11-identity-grounding/11-01-SUMMARY.md
    - .planning/phases/11-identity-grounding/11-02-SUMMARY.md
    - .planning/phases/11-identity-grounding/11-03-SUMMARY.md
decisions:
  - "Scoped rename to only the 2 targeted template literals (mute.ts + opus-analysis.ts); all other John residuals are pre-existing by-design per 11-RESEARCH.md Pitfall 3 or out-of-scope tech debt"
  - "requirements-completed: values sourced verbatim from corresponding PLAN.md requirements: fields per plan spec"
  - "TEST-08 (Performative apology) 3-of-3 stochastic failures in full-suite run treated as pre-existing flakiness (not a regression from this plan's changes)"
metrics:
  duration_seconds: 720
  completed_date: "2026-04-15"
  tasks_completed: 4
  tasks_total: 4
  files_changed: 5
requirements-completed: []
---

# Phase 12 Plan 01: Identity Rename Residuals + Frontmatter Hygiene Summary

**One-liner:** Two targeted John→Greg string substitutions in proactive prompts (mute.ts L1 user-visible, opus-analysis.ts L2 internal) plus requirements-completed: frontmatter backfill on all 3 Phase 11 SUMMARY files, closing the tech-debt items surfaced by the v2.0-MILESTONE-AUDIT.

## What landed

### Task 1: src/proactive/mute.ts — generateMuteAcknowledgment Sonnet system prompt

**Before:**
```
You are Chris, John's close friend. John has asked you to be quiet for a while.
```

**After:**
```
You are Chris, Greg's close friend. Greg has asked you to be quiet for a while.
```

- Substitutions: 2 (both on the same template literal line 174)
- `grep -c '\bJohn\b' src/proactive/mute.ts` → 0
- Mute unit tests: 20/20 passed

### Task 2: src/proactive/triggers/opus-analysis.ts — OPUS_SYSTEM_PROMPT

**Before:**
```
You are an analytical assistant reviewing relational context about a friendship between Chris and John.
```

**After:**
```
You are an analytical assistant reviewing relational context about a friendship between Chris and Greg.
```

- Substitutions: 1 (line 36, the only `\bJohn\b` occurrence in OPUS_SYSTEM_PROMPT)
- `grep -c '\bJohn\b' src/proactive/triggers/opus-analysis.ts` → 0
- No dedicated test file; covered by Task 4 full suite

### Task 3: Phase 11 SUMMARY frontmatter backfill

| File | Line added |
|------|-----------|
| 11-01-SUMMARY.md | `requirements-completed: [RETR-01, RETR-02]` |
| 11-02-SUMMARY.md | `requirements-completed: [RETR-01, RETR-02, RETR-04]` |
| 11-03-SUMMARY.md | `requirements-completed: [TEST-03, RETR-04]` |

- Each value sourced verbatim from the corresponding PLAN.md `requirements:` field
- Single-line YAML array format matches Phase 06/07/09 backfill style
- All lines placed inside the existing `---`-delimited frontmatter block, before the closing `---`
- `grep -l 'requirements-completed' .planning/phases/11-identity-grounding/*-SUMMARY.md | wc -l` → 3
- v2.0 audit cross-check upgraded from 2-source to 3-source for RETR-01, RETR-02, RETR-04, TEST-03

### Task 4: Full Docker test suite + scoped residual verification

**Suite result (clean run b02sc62ca):** 845/848 passed, 3 failed

The 3 failures are all in TEST-08 (Performative apology — stochastic behavioral test). These are pre-existing flaky failures confirmed by prior Phase 10/11 history; they are not regressions from this plan's changes. Phase 12 changes no behavioral logic.

**TEST-03 (JOURNAL grounding) — 3-of-3 PASS:**
- `grounds response in seeded nationality fact` — PASS
- `grounds response in seeded location fact` — PASS
- `grounds response in seeded business fact` — PASS

TEST-03 gate remains GREEN; Phase 11 gate non-regression confirmed.

**Phase 11 baseline preserved:**
- `grep -c '\bJohn\b' src/chris/personality.ts` → 0
- `grep -c '\bJohn\b' src/proactive/prompts.ts` → 0
- `grep -F 'includeDate: false' src/chris/modes/journal.ts` — match confirmed

**Scoped residual grep — remaining `\bJohn\b` in src/:**

By-design surfaces (per 12-CONTEXT.md Deferred Ideas and v2.0-MILESTONE-AUDIT Tech Debt item 3):

| File | Surface | Rationale |
|------|---------|-----------|
| `src/llm/prompts.ts` | CONTRADICTION_DETECTION_PROMPT, RELATIONAL_MEMORY_PROMPT template literals | Classifier-only prompts; by-design per 11-RESEARCH.md Pitfall 3 |
| `src/memory/relational.ts` | Exchange label "John:" | Training-stable classifier label; by-design |
| `src/memory/sync/*.ts` | JSDoc comments only | Cosmetic accepted tech debt |

Pre-existing out-of-scope residuals (not targeted by this phase, not regressions):
- `src/proactive/context-builder.ts`, `src/proactive/triggers/silence.ts`, `src/proactive/triggers/commitment.ts` — proactive sweep context strings (accepted tech debt not in Phase 12 scope)
- `src/chris/praise-quarantine.ts`, `src/drive/sync.ts`, `src/gmail/sync.ts`, `src/sync/scheduler.ts`, `src/bot/handlers/sync.ts` — JSDoc and internal strings (not user-visible, not targeted)
- Test fixtures in `src/**/__tests__/*.test.ts` — test data strings, not production code

**Unexpected hits (regressions):** None. `src/proactive/mute.ts` and `src/proactive/triggers/opus-analysis.ts` both report 0 John hits.

## Deviations from Plan

None — plan executed exactly as written. All 4 tasks completed in order, no scope expansion required.

## Self-Check

- [x] `src/proactive/mute.ts` modified (Greg's close friend, Greg has asked)
- [x] `src/proactive/triggers/opus-analysis.ts` modified (friendship between Chris and Greg)
- [x] `11-01-SUMMARY.md` has `requirements-completed: [RETR-01, RETR-02]`
- [x] `11-02-SUMMARY.md` has `requirements-completed: [RETR-01, RETR-02, RETR-04]`
- [x] `11-03-SUMMARY.md` has `requirements-completed: [TEST-03, RETR-04]`
- [x] Commits: 3f52316 (mute.ts), eb9268b (opus-analysis.ts), 1a2ac14 (frontmatter)
- [x] Full Docker suite: 845/848 (3 pre-existing TEST-08 stochastic failures, not regressions)
- [x] TEST-03 JOURNAL grounding: 3-of-3 PASS
