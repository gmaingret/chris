---
created: 2026-04-26T13:15:55.182Z
title: Verify PROC-01/PROC-02 still needed post-GSD 1.38.5
area: planning
files:
  - .planning/REQUIREMENTS.md (PROC-01, PROC-02 entries — Process Gate carry-in)
  - .planning/STATE.md (Process gap entries describing v2.3 Phase 24 audit-trail regression)
  - ~/.claude/get-shit-done/workflows/execute-phase.md (where SDK verification fix may have shipped)
  - ~/.claude/agents/gsd-planner.md (likely SUMMARY.md template location)
  - ~/.claude/get-shit-done/templates/ (alternative template location)
---

## Problem

GSD updated 1.38.3 → 1.38.5 on 2026-04-26 during v2.4 M009 milestone kickoff. Two changelog entries are directly relevant to v2.4 carry-ins PROC-01 and PROC-02:

- **1.38.4 changelog:** *"SDK verification checks VERIFICATION.md, not just session exit code — A verify session that wrote `status: gaps_found` to VERIFICATION.md was treated as 'passed' because the session itself didn't crash. The gap-closure retry loop now reads the actual verification status from disk."* This is the same regression class PROC-01 was scoped to fix (wire `gsd-verifier` into `/gsd-execute-phase` so future phases can't ship without VERIFICATION.md status: passed).
- **1.38.5 changelog:** *"SDK executor agents now write SUMMARY.md to `.planning/phases/{phase}/` instead of the project root."* Adjacent to PROC-02's scope (SUMMARY.md template emits `requirements-completed` frontmatter field).

Phase 25 currently includes PROC-01 + PROC-02 as carry-ins (folded into the first plan). If 1.38.5 already ships them, Phase 25 over-budgets by ~1 plan-task and adds redundant test coverage. If only partial coverage shipped, scope should reduce to a regression test.

## Solution

Before `/gsd-discuss-phase 25` or `/gsd-plan-phase 25`, run inline verification:

1. Read `.planning/REQUIREMENTS.md` PROC-01 + PROC-02 entries verbatim.
2. Read `.planning/STATE.md` "Process gap" + "Pre-M009 readiness check" Open Items entries — quote the v2.3 Phase 24 audit-trail symptom.
3. Inspect `~/.claude/get-shit-done/workflows/execute-phase.md` (and any sub-workflows it `@includes`). Determine: does the 1.38.5 `/gsd-execute-phase` workflow read VERIFICATION.md status from disk before marking a phase complete? Cite specific line ranges.
4. Find the SUMMARY.md template the gsd-planner agent uses. Likely locations: `~/.claude/get-shit-done/templates/`, `~/.claude/agents/gsd-planner.md`. Use `grep -rn "requirements.completed\|requirements_completed" ~/.claude/get-shit-done/ ~/.claude/agents/`. Check whether `requirements-completed` frontmatter is now in the template.
5. Render verdicts independently for PROC-01 and PROC-02:
   - **REDUNDANT** — 1.38.5 ships everything; drop the requirement.
   - **PARTIALLY-COVERED** — some scope shipped; reduce Phase 25 to add a regression test confirming the new behavior + close any remaining gap.
   - **STILL-NEEDED** — 1.38.5 didn't address it; keep PROC-01/PROC-02 as planned.
6. Append verdict block to `.planning/STATE.md` "### Open Items" section. Format:
   ```
   ### PROC-01/PROC-02 post-update verification (2026-04-26)
   GSD updated 1.38.3 → 1.38.5. PROC-01 verdict: <verdict>. PROC-02 verdict: <verdict>.
   Evidence: [bullet list of file paths + line ranges + what was found]
   Recommended Phase 25 scope adjustment: <concrete>.
   ```
7. Do NOT modify REQUIREMENTS.md or ROADMAP.md — Greg decides scope changes.

**Context:** Disabled remote routine `trig_01TWeYkXe8J5ANAnoxi2gqQW` was originally going to do this; we determined inline verification is faster and doesn't need a GitHub push.
