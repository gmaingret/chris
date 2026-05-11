---
gsd_state_version: 1.0
milestone: v2.5
milestone_name: M010 Operational Profiles
status: Defining plans
stopped_at: Phase 33 context gathered
last_updated: "2026-05-11T06:06:30.031Z"
last_activity: 2026-05-11 — Roadmap created for v2.5 M010
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 11
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (symlink to /home/claude/chris/PLAN.md, updated 2026-04-26 at v2.4 milestone kickoff).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** Phase 33 — Profile Substrate; defining plans

## Current Position

Phase: 33 — Profile Substrate
Plan: —
Status: Defining plans
Last activity: 2026-05-11 — Roadmap created for v2.5 M010

```
Progress: [░░░░░░░░░░░░░░░░░░░░] 0% (0/11 plans)

Phase 33 (PROF substrate)   ░░  0/2
Phase 34 (GEN engine)       ░░░░  0/4
Phase 35 (SURF surfaces)    ░░░  0/3
Phase 36 (PTEST tests)      ░░  0/2
```

## Shipped Milestones

- **v1.0 Living Memory through Validation** — 2026-04-13 (Phases 1-5)
- **v2.0 M006 Trustworthy Chris** — 2026-04-15 (Phases 6-12, 19 plans, 26/26 requirements)
- **v2.1 M007 Decision Archive** — 2026-04-18 (Phases 13-19, 27 plans, 36 tasks, 31/31 requirements)
- **v2.2 M008 Episodic Consolidation** — 2026-04-19 (5 phases, 17 plans, 35/35 requirements — archived at `.planning/milestones/v2.2-phases/`) + M008.1 inline fix 2026-04-19
- **v2.3 Test Data Infrastructure** — 2026-04-20 / archived 2026-04-25 (Phase 24, 4 plans, 20/20 requirements). Primed-fixture pipeline shipped; D041 convention codified.
- **v2.4 M009 Ritual Infrastructure + Daily Note + Weekly Review** — 2026-05-11 (8 phases: 25-32, 23 plans + Phase 32 inline, 52/52 requirements). First weekly_review fire 2026-05-10 20:00 Paris. Phase 31 terminology cleanup (voice_note → journal). Phase 32 substrate hardening (6 items).

## Active Milestone Plan (v2.5 M010)

| Phase | Name | Plans (est) | Requirements |
|-------|------|-------------|--------------|
| 33 | Profile Substrate | 2 | PROF-01..05 (5) |
| 34 | Inference Engine | 4 | GEN-01..07 (7) |
| 35 | Surfaces | 3 | SURF-01..05 (5) |
| 36 | Tests | 2 | PTEST-01..05 (5) |
| **Total** | | **11** | **22** |

**Phase ordering rationale:**

- Phase 33 first: 7 of 11 pitfall mitigations require schema-phase artifacts; `schema_version`, `substrate_hash`, `profile_history` table, `name='primary'` sentinel — all non-retrofittable. Zero LLM calls, zero user-visible features — pure foundation.
- Phase 34 after Phase 33: generators need the schema to exist; `assembleProfilePrompt` shared builder ships first (HARD CO-LOC #M10-2) before any dimension generator.
- Phase 35 after Phase 34: `buildSystemPrompt` refactor needs at least one populated row to test non-null rendering; mode handlers can't inject profiles that don't exist yet.
- Phase 36 last: fixture generation + integration tests validate the full stack; cannot start until Phase 34 generators and Phase 35 mode wiring are both complete.

**Cron timing:** Sunday 22:00 Paris (4h after weekly_review's 20:00 fire — M010-04 mitigation; 2h gap gives full retry-window buffer under worst-case adversarial weekly review conditions).

## Accumulated Context

### Decisions in force going into v2.5

Full log in PROJECT.md Key Decisions table. Most relevant for M010:

- **D004 append-only Pensieve** — profiles are a projection/inference layer, not authoritative.
- **D005 fire-and-forget** — `updateAllOperationalProfiles()` called from cron; never blocks primary response.
- **D018 no skipped tests** — primed-fixture pipeline (D041) gates M010 testing, not 30 real calendar days.
- **D031 structured fact injection** — profile block placed ABOVE `{pensieveContext}`, labeled as grounded context not interpretation.
- **D035 Pensieve authoritative** — `boundary-audit.test.ts` must not find `episodic_summaries` referenced from `profiles.ts` narrative fields.
- **D041 primed-fixture pipeline** — M010 validates via m010-30days fixture; no real-calendar-time wait.
- **Research conflict resolved** — `Promise.allSettled` wins over sequential `await` loop (error isolation + 4× wall-clock improvement).
- **Research conflict resolved** — Sunday 22:00 Paris cron (not 21:00 from spec default) — 2h gap after weekly_review.
- **Research conflict resolved** — confidence hybrid: Sonnet emits `data_consistency`; host computes final via `computeProfileConfidence(entryCount, data_consistency)`.
- **Research conflict resolved** — `profile_history` table ships in initial migration (PITFALLS/ARCH win over FEATURES DIFF-3 deferral — internal idempotency primitive ≠ user-facing history feature).

### HARD CO-LOCATION CONSTRAINTS (must be honored across phase boundaries)

1. **Phase 33 (M10-1)**: Migration SQL + drizzle meta snapshot + `scripts/test.sh` psql line ship in ONE atomic plan. `schema_version` + `substrate_hash` ship in SAME migration as table creation — never retrofitted.
2. **Phase 34 (M10-2)**: `assembleProfilePrompt` shared builder ships BEFORE any of the 4 dimension generators (per-dimension prompt drift mitigation).
3. **Phase 34 (M10-3)**: Substrate-hash idempotency test (two-cycle / second-fire) ships in the SAME plan as the generator that introduces the hash.
4. **Phase 35 (M10-4)**: `buildSystemPrompt` signature refactor lands atomically across ALL call sites in ONE plan. OQ-3 call-site inventory is pre-work before any code change.
5. **Phase 35 (M10-5)**: `/profile` handler + `formatProfileForDisplay` + golden-output snapshot test land in the SAME plan.
6. **Phase 36 (M10-6)**: `synthesize-delta.ts --profile-bias` flag + m010-30days fixture generation + populated-case test + sparse-case test land in the SAME plan.

### Never-Retrofit Checklist (enforced in Phase 33)

- [ ] `profile_history` table in migration 0012
- [ ] `schema_version INT NOT NULL DEFAULT 1` in all 4 profile tables
- [ ] `substrate_hash TEXT` in all 4 profile tables
- [ ] `name TEXT NOT NULL UNIQUE DEFAULT 'primary'` sentinel in all 4 profile tables
- [ ] `confidence REAL CHECK (confidence >= 0 AND confidence <= 1)` in all 4 profile tables
- [ ] Migration 0012 in `scripts/test.sh` psql apply chain
- [ ] Drizzle meta snapshot regenerated for migration 0012

### Open Questions (resolve during planning)

| ID | Question | Phase | Starting Point |
|----|----------|-------|---------------|
| OQ-1 | Pensieve domain-filtering strategy for `loadProfileSubstrate()` | Phase 34 | Tag-only (FACT/RELATIONSHIP/INTENTION/EXPERIENCE); no keyword/semantic filtering |
| OQ-2 | Confidence calibration Sonnet prompt phrasing | Phase 34 | Draft in Phase 34 planning; validate on sparse vs rich fixtures in Phase 36 |
| OQ-3 | `buildSystemPrompt` call-site inventory | Phase 35 pre-work | Grep `src/` before any code change; document ACCOUNTABILITY overload explicitly |
| OQ-4 | `synthesize-delta.ts --profile-bias` threshold determinism | Phase 36 | Validate 10-entry crossing per domain deterministically in 30-day window |
| OQ-5 | SATURATION constant tuning | Post-ship | SATURATION=50 is first estimate; tune after 4-8 weeks of prod operation |

### v2.4 Carry-Forward Items (NOT in M010 scope — v2.5.1 backlog)

- Synth-pipeline organic+synth fusion (`synthesize-episodic.ts:288` + `synthesize-delta.ts` wellbeing-per-fused-day)
- FR/RU localization of templated weekly_review fallback (currently EN-only per D-29-02-D)
- Phase 28 UAT: 60s confirmation window real-clock observation + 7d+7d evasive trigger spacing test
- `wellbeing.test.ts` Tests 6+7 ORDER BY bug fix (pre-existing test-only false negative; production behavior correct)
- Stale callback prefix comments in `src/bot/handlers/ritual-callback.ts:31-32` (doc noise)
- Forensic investigation of `__drizzle_migrations` row loss (cold trail)
- 2026-05-17 20:00 Paris second weekly_review fire observation (second-person + language fix commit 0626713)

## Deferred Items

Items acknowledged and deferred at v2.4 milestone close on 2026-05-11:

| Category | Item | Status |
|----------|------|--------|
| verification_gap | Phase 28 (28-VERIFICATION.md) | human_needed — 60s confirmation window real-clock UAT + 7d+7d evasive trigger spacing test |
| verification_gap | Phase 29 (29-VERIFICATION.md) | human_needed — UX-level retry awaiting 2026-05-17 20:00 Paris fire |
| verification_gap | Phase 30 (30-VERIFICATION.md) | human_needed — HARN-04/HARN-06 floor restoration blocked on synth-pipeline fusion |

## Session Continuity

Last session: 2026-05-11T06:06:30.020Z
Stopped at: Phase 33 context gathered
Next: `/gsd-plan-phase 33` to define the 2 plans for Phase 33 (Profile Substrate).

Phase 32 was the last completed phase — all 6 substrate-hardening items shipped inline execution. Container HEAD = ef45e1b at v2.4 close. Migration 0011 is the prior migration; Phase 33 Plan 33-01 ships migration 0012.
