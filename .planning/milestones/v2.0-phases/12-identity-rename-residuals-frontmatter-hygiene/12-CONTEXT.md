---
phase: 12
gathered: 2026-04-15
status: Ready for planning
source: user-locked scope (gsd-plan-phase command args)
---

# Phase 12: Identity rename residuals + frontmatter hygiene — Context

<domain>
## Phase Boundary

Closes 3 tech-debt items surfaced by the v2.0 milestone audit (`.planning/v2.0-MILESTONE-AUDIT.md`). These are residuals from Phase 11's identity rename sweep (which was intentionally scoped to 6 user-facing mode templates + `src/proactive/prompts.ts`) plus SUMMARY frontmatter hygiene on Phase 11 plans.

No new features. Mechanical find/replace + YAML frontmatter additions. Must not regress TEST-03 (the Phase 11 gate) or any other live-integration test.
</domain>

<decisions>
## Implementation Decisions — LOCKED

### Task 1: rename `src/proactive/mute.ts:174`

- File: `src/proactive/mute.ts`
- Location: `generateMuteAcknowledgment` Sonnet system prompt (around line 174)
- Change: every occurrence of `John` inside that template must become `Greg`. Concrete strings:
  - `"You are Chris, John's close friend."` → `"You are Chris, Greg's close friend."`
  - `"John has asked you to be quiet for a while."` → `"Greg has asked you to be quiet for a while."`
- Scope: only the multi-line template literal assigned to `system[].text` in `generateMuteAcknowledgment`. Do NOT touch JSDoc, variable names, or file-level comments.
- Severity: L1 user-visible (produces Chris-addressed output to Greg).

### Task 2: rename `src/proactive/triggers/opus-analysis.ts:36`

- File: `src/proactive/triggers/opus-analysis.ts`
- Location: `OPUS_SYSTEM_PROMPT` template literal (begins around line 36)
- Change: `"friendship between Chris and John"` → `"friendship between Chris and Greg"`. If any other `\bJohn\b` tokens exist inside this template literal, rename them to `Greg` too.
- Do NOT modify: variable names, type names, JSDoc, or CONTRADICTION_DETECTION_PROMPT / RELATIONAL_MEMORY_PROMPT in other files (those keep "John" per 11-RESEARCH.md Pitfall 3 — classifier-only, deliberately preserved).
- Severity: L2 internal (JSON-generation prompt, never user-visible).

### Task 3: backfill `requirements-completed:` frontmatter in Phase 11 SUMMARY files

Three SUMMARY files are missing a `requirements-completed:` frontmatter field. Values come directly from the corresponding PLAN.md `requirements:` field (already verified in `11-VERIFICATION.md`):

| File | Add frontmatter line |
|------|----------------------|
| `.planning/phases/11-identity-grounding/11-01-SUMMARY.md` | `requirements-completed: [RETR-01, RETR-02]` |
| `.planning/phases/11-identity-grounding/11-02-SUMMARY.md` | `requirements-completed: [RETR-01, RETR-02, RETR-04]` |
| `.planning/phases/11-identity-grounding/11-03-SUMMARY.md` | `requirements-completed: [TEST-03, RETR-04]` |

Placement: inside the existing `---`-delimited YAML frontmatter block at the top of each file. Match the format used by Phase 06/07/09 backfilled SUMMARY files (single-line YAML array).

### Verification strategy

- After Task 1+2: `grep -n '\bJohn\b' src/proactive/mute.ts src/proactive/triggers/opus-analysis.ts` returns zero hits.
- Project-wide spot-check: `grep -rn '\bJohn\b' src/` — remaining hits must be ONLY in CONTRADICTION_DETECTION_PROMPT + RELATIONAL_MEMORY_PROMPT + JSDoc in sync/*.ts (documented tech debt per audit).
- After Task 3: `grep -l 'requirements-completed' .planning/phases/11-identity-grounding/*-SUMMARY.md` returns all 3 files.
- Full test suite (Docker): 848/848 pass — in particular TEST-03 remains 3-of-3 and no other live case regresses.

### Claude's Discretion

- Single plan or split: single plan is fine — all 3 tasks are trivial and can run in one wave.
- Whether to run the full live-integration suite vs. unit-only post-change: run full Docker suite per project memory (`always_run_docker_tests`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit + verification trail
- `.planning/v2.0-MILESTONE-AUDIT.md` — the tech_debt items being closed (Tech Debt Summary section)
- `.planning/phases/11-identity-grounding/11-VERIFICATION.md` — goal-achievement proof + authoritative REQ-ID → plan mapping
- `.planning/phases/11-identity-grounding/11-RESEARCH.md` — documents Pitfall 3 (why CONTRADICTION/RELATIONAL classifier prompts intentionally keep "John")

### Phase 11 plans (for frontmatter requirement IDs)
- `.planning/phases/11-identity-grounding/11-01-PLAN.md` — `requirements: [RETR-01, RETR-02]`
- `.planning/phases/11-identity-grounding/11-02-PLAN.md` — `requirements: [RETR-01, RETR-02, RETR-04]`
- `.planning/phases/11-identity-grounding/11-03-PLAN.md` — `requirements: [TEST-03, RETR-04]`

### Target source files
- `src/proactive/mute.ts` — Task 1
- `src/proactive/triggers/opus-analysis.ts` — Task 2

### Format reference for `requirements-completed:`
- `.planning/phases/06-memory-audit/06-01-SUMMARY.md` line 39 — example YAML frontmatter placement

</canonical_refs>

<specifics>
## Specific Ideas

All 3 tasks are mechanical. The planner should produce a single PLAN.md with 3 tasks (wave 1) plus a verification task. No research needed — the audit already enumerated the exact file paths, line numbers, and string changes.
</specifics>

<deferred>
## Deferred Ideas

- Renaming "John" inside `CONTRADICTION_DETECTION_PROMPT` and `RELATIONAL_MEMORY_PROMPT` — explicitly preserved per 11-RESEARCH.md Pitfall 3 (classifier-only, no user-visible impact). NOT IN SCOPE.
- JSDoc-only "John" references in `src/memory/sync/*.ts` — cosmetic, documented as acceptable tech debt in the audit. NOT IN SCOPE.
- `src/memory/relational.ts:58` exchange label uses "John:" consistently — by-design per 11-RESEARCH.md (this is a training-stable classifier label). NOT IN SCOPE.

</deferred>

---

*Phase: 12-identity-rename-residuals-frontmatter-hygiene*
*Context gathered: 2026-04-15 — user-locked scope from gsd-plan-phase command*
