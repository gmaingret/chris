---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: M009 Ritual Infrastructure + Daily Note + Weekly Review
status: Phase 25 ready to plan
stopped_at: ROADMAP.md written; awaiting /gsd-plan-phase 25
last_updated: "2026-04-26T05:30:00Z"
last_activity: "2026-04-26 — v2.4 ROADMAP.md written. 6 phases (25-30), 54/54 REQ-IDs mapped, all 7 hard co-location constraints honored. Phase 25 includes process-gate carry-in (PROC-01/02); Phase 30 includes HARN-03 fixture refresh carry-in (HARN-04/05/06). Estimated 22 plans across 6 phases."
progress:
  total_phases: 6
  completed_phases: 0
  total_plans: 22
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (symlink to /home/claude/chris/PLAN.md, updated 2026-04-26 at v2.4 milestone kickoff).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** v2.4 M009 *(MVP shipping point)* — ritual scheduling infrastructure plus three rituals (daily voice note, daily wellbeing snapshot, weekly review) that complete the frictionless reflection loop. After M009 ships, every M010+ profile milestone consumes the real cadence-driven data this milestone produces.

## Current Position

Phase: **25** ready to plan
Plan: —
Status: ROADMAP.md written; awaiting `/gsd-plan-phase 25`
Progress: 0 / 22 plans (0%)
Last activity: 2026-04-26 — v2.4 ROADMAP.md written. 6 phases (25-30), 54/54 REQ-IDs mapped, all 7 HARD CO-LOCATION constraints honored. Carry-ins folded: PROC-01/02 → Phase 25; HARN-04/05/06 → Phase 30.

Prior deploy state: v2.3 + date-extraction Haiku JSON-fences fix (eedce33, deployed 42a7eed 2026-04-25) live on Proxmox (192.168.1.50). Daily 23:00 Europe/Paris episodic cron + 6h sync cron + 10:00 proactive sweep cron all healthy. M009 will ADD a second 21:00 evening cron tick (RIT-11) for ritual firing.

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)
- **v2.2 M008 Episodic Consolidation** — 2026-04-19 (5 phases, 17 plans, 35/35 requirements — archived at `.planning/milestones/v2.2-phases/`) + M008.1 inline fix 2026-04-19
- **v2.3 Test Data Infrastructure** — 2026-04-20 / archived 2026-04-25 (Phase 24, 4 plans, 20/20 requirements). Primed-fixture pipeline shipped; D041 convention codified.

## Active Milestone Plan (v2.4)

| Phase | Name | Plans (est) | Requirements |
|-------|------|-------------|--------------|
| 25 | Ritual Scheduling Foundation + Process Gate | 4 | RIT-01..12, PROC-01/02 (14) |
| 26 | Daily Voice Note Ritual | 4 | VOICE-01..06 (6) |
| 27 | Daily Wellbeing Snapshot | 3 | WELL-01..05 (5) |
| 28 | Skip-Tracking + Adjustment Dialogue | 4 | SKIP-01..07 (7) |
| 29 | Weekly Review | 4 | WEEK-01..09 (9) |
| 30 | Test Infrastructure + HARN-03 Refresh | 3 | TEST-23..32, HARN-04..06 (13) |
| **Total** | | **22** | **54** |

**Phase ordering rationale:**
- Phase 25 first (substrate non-negotiable)
- Phases 26 + 27 + 29 parallel-eligible after Phase 25 (orthogonal handler surfaces)
- Phase 28 after Phases 25/26/27 (depends on outcomes from rituals being skipped)
- Phase 30 last (cannot run until 25-29 produce code to test)
- Carry-ins folded into Phase 25 (process gate, tiny + unblocks everything) and Phase 30 (HARN-03 refresh, fits naturally with test-infra phase)

## Accumulated Context

### Decisions in force going into v2.4

Full log in PROJECT.md Key Decisions table. Most relevant for M009:

- **D004 append-only Pensieve** — episodic_summaries is a projection, not authoritative.
- **D005 fire-and-forget** — tagging, embedding, relational memory writes never block primary response.
- **D018 no skipped tests** — primed-fixture pipeline (D041) is the replacement for waiting real calendar days.
- **D026 daily wellbeing snapshot is separate from daily voice note** — informs Phase 27 09:00 fire (separate from Phase 26 21:00 voice note).
- **D029 execution order** — M009 (rituals + daily note + weekly review) ships before profile layer.
- **D030 weekly review ships in M009 not M013** — only depends on M008 episodic summaries + M007 decisions.
- **D034 episodic_summaries 8 columns + 3 indexes locked** — no schema changes from M009; weekly review reads existing schema.
- **D035 Pensieve authoritative** — boundary preservation enforced by `boundary-audit.test.ts`. Weekly observation persists as RITUAL_RESPONSE Pensieve entry (NOT into episodic_summaries).
- **D036 retrieveContext two-dim routing** — recency + query intent; weekly review reads via `getEpisodicSummariesRange` (M008 substrate, first consumer).
- **D040 decimal phases for gap closure** — pattern available if M009 audit reveals wiring gap.
- **D041 (shipped 2026-04-20) — primed-fixture pipeline** — *no milestone may gate on real calendar time for data accumulation; use the primed-fixture pipeline instead.* Codified in PLAN.md §Key Decisions D041 + CONVENTIONS.md §Test Data + TESTING.md §Primed-Fixture Pipeline. SUPERSEDES M009 spec's "1-month real-use pause before M010".

### Spec interpretations locked at v2.4 kickoff (override M009_Ritual_Infrastructure.md text)

1. Wellbeing fires at 09:00 Europe/Paris, **separate** from voice note (21:00) — D026 spirit + Pitfall 13.
2. Single-question enforcement uses **two-stage Zod refine + Haiku judge**, not literal token-count.
3. Skip threshold is **cadence-aware** (daily=3, weekly=2), not uniform 3.
4. Voice message handling: Greg's input modality is **Android STT keyboard**; `bot.on('message:voice')` polite-decline (~10 LOC). No Whisper.
5. Prompt rotation uses **shuffled-bag** (stronger than spec's "no consecutive duplicates" floor).
6. **No 1-month real-use pause before M010** — superseded by D041; M010 validates via primed-fixture pipeline.

### HARD CO-LOCATION CONSTRAINTS (from research/SUMMARY.md — must be honored across phase boundaries)

1. **Phase 26**: PP#5 ritual-response detector co-located with voice note ritual handler (Pitfall 6, CRITICAL).
2. **Phase 29**: Single-question enforcement (two-stage Zod + Haiku) co-located with weekly review observation generator (Pitfall 14, HIGH).
3. **Phase 29**: CONSTITUTIONAL_PREAMBLE injection co-located with weekly review observation generator (Pitfall 17, HIGH).
4. **Phase 30**: Fixture test (TEST-23) and cron-registration test (TEST-32) MUST be two distinct plans, not bundled (Pitfall 23).
5. **Phase 26**: Mock-chain coverage update for PP#5 co-located with PP#5 introduction (Pitfall 24).
6. **Phase 30**: Live weekly-review test (TEST-31) MUST be its own plan, not bundled with weekly review impl in Phase 29 (Pitfall 26).
7. **Phase 25**: Migration 0006 + drizzle meta snapshot + scripts/test.sh psql line MUST be one atomic plan (Pitfall 28).

### Open Items (carried into v2.4)

- **M009 spec carry-in: Process gate** — wire `gsd-verifier` into `/gsd-execute-phase` (PROC-01); update SUMMARY.md template with `requirements-completed` frontmatter (PROC-02). Folded into Phase 25.
- **M009 spec carry-in: HARN-03 fixture refresh** — bump `--target-days 21` against fresh prod data (HARN-04); document VCR cost model + add `--reseed-vcr` flag (HARN-05); add 5th sanity invariant for `wellbeing_snapshots` (HARN-06). Folded into Phase 30.
- **Upstream bug: `gsd-sdk milestone.complete` calls `phasesArchive([], projectDir)` without forwarding the version arg** — always throws. v2.3 close was performed manually. File upstream issue against `get-shit-done-cc`. NOT in M009 scope.
- **12 human-UAT items carried from v2.1/v2.2** (live Telegram feel, ACCOUNTABILITY tone, `/decisions` dashboard format, FR/RU localization). Independent of M009.
- **Env-level vitest-4 fork-IPC hang under HuggingFace EACCES.** 5-file excluded-suite mitigation in `scripts/test.sh` keeps Docker gate green. M009 adds new `src/rituals/__tests__/` suites — confirm they don't trigger the hang during Phase 30.
- **process.exit() in scripts** — same pattern present in `backfill-episodic.ts:264/269/272`, `synthesize-delta.ts:639/642`, `adversarial-test.ts`, `test-photo-memory.ts` — none have try/finally cleanup so safe as-is, but worth a future audit (post-M009).

### Blockers/Concerns

None. Ready to plan Phase 25.

## Session Continuity

Last session: 2026-04-26T05:30:00Z
Stopped at: v2.4 ROADMAP.md written; REQUIREMENTS.md traceability section filled; STATE.md updated with active milestone plan. Next: `/gsd-plan-phase 25`.

## Known Tech Debt

- **TECH-DEBT-19-01** — RESOLVED in v2.2 Plan 20-01 (2026-04-18, archived).
- **Vitest-4 fork-IPC hang under HuggingFace EACCES** — pre-existing env issue, operational mitigation 5-file excluded-suite in `scripts/test.sh`. Non-blocking; worth addressing in a future fix-up phase.
- **v2.2 Plan 21 WR-02 retry-on-all-errors policy** — documented design choice; M009+ may revisit if error patterns emerge.
- **v2.3 process gaps (process-gate + SUMMARY frontmatter)** — folded into Phase 25 of v2.4 as PROC-01/02.
- **Upstream `gsd-sdk milestone.complete` bug** — file upstream issue; not in M009 scope.
- **process.exit() in non-try/finally scripts** — safe today but worth post-M009 audit.
