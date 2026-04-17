---
phase: 16-resolution-post-mortem-accountability-mode
plan: "05"
subsystem: proactive/sweep
tags: [escalation, sweep, stale-transition, accountability, follow-up]

requires:
  - phase: 16-03
    provides: resolution.ts, clearEscalationKeys dependency target
provides:
  - Per-decision escalation tracking in proactive_state
  - 48h follow-up prompt via ACCOUNTABILITY_FOLLOWUP_PROMPT
  - Silent stale transition after 2 non-replies
  - Escalation bypass of daily accountability cap
affects: [phase-17-decisions-command, phase-18-synthetic-fixture]

tech-stack:
  added: []
  patterns: [escalation-outside-daily-cap, per-decision-keyed-state]

key-files:
  created: []
  modified:
    - src/proactive/state.ts
    - src/proactive/sweep.ts
    - src/proactive/prompts.ts
    - src/proactive/__tests__/sweep-escalation.test.ts
    - src/proactive/__tests__/sweep.test.ts

key-decisions:
  - "Escalation runs outside hasSentTodayAccountability guard — follow-ups are not cold outreach"
  - "Escalation keys keyed per-decision (accountability_sent_{id}, accountability_prompt_count_{id})"

patterns-established:
  - "Per-decision state keys: prefix + decision ID for isolated tracking"
  - "Escalation outside daily cap: follow-up is not new outreach"

requirements-completed: [RES-06]

duration: 15min
completed: 2026-04-16
---

# Plan 16-05: Sweep Escalation Summary

**Per-decision escalation tracking with 48h follow-up, silent stale transition after 2 non-replies, and daily cap bypass**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-16T12:34:00Z
- **Completed:** 2026-04-16T13:10:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Per-decision escalation state helpers (getEscalationSentAt, setEscalationSentAt, getEscalationCount, setEscalationCount, clearEscalationKeys)
- ACCOUNTABILITY_FOLLOWUP_PROMPT with natural follow-up tone ("couple of days ago")
- Escalation block in sweep.ts queries AWAITING_RESOLUTION rows, fires follow-up after 48h, stales after 2 non-replies
- Stale transition clears both capture state and escalation keys
- Escalation bypasses daily accountability cap (runs outside hasSentTodayAccountability guard)

## Task Commits

1. **Task 1: Escalation helpers + follow-up prompt** — `be2d651` (feat)
2. **Task 2: Sweep escalation logic + tests GREEN** — `f0664ef` (feat)

## Files Created/Modified
- `src/proactive/state.ts` — 5 new escalation helper functions keyed per-decision
- `src/proactive/prompts.ts` — ACCOUNTABILITY_FOLLOWUP_PROMPT template
- `src/proactive/sweep.ts` — Escalation block after accountability channel, before reflective
- `src/proactive/__tests__/sweep-escalation.test.ts` — 8 tests covering all escalation paths
- `src/proactive/__tests__/sweep.test.ts` — Added mocks for new DB/lifecycle/state imports

## Decisions Made
- Escalation runs outside daily cap guard — it's a follow-up, not cold outreach
- Per-decision key pattern: `accountability_sent_{id}` and `accountability_prompt_count_{id}`
- Stale transition is silent (no sendMessage) per D-17

## Deviations from Plan
- sweep.test.ts required mock updates for new imports (db, drizzle-orm, lifecycle, capture-state, escalation state functions) — not anticipated in plan but necessary for test compatibility

## Issues Encountered
- Agent hit rate limit during execution; Task 2 completed inline by orchestrator

## Next Phase Readiness
- All Phase 16 plans complete — ready for verification
- RES-06 satisfied: auto-escalation sends follow-up after 48h, stales after 2 non-replies

---
*Phase: 16-resolution-post-mortem-accountability-mode*
*Completed: 2026-04-16*
