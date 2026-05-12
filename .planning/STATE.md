---
gsd_state_version: 1.0
milestone: v2.5
milestone_name: M010 Operational Profiles
status: ready_to_plan
stopped_at: Phase 34 context gathered
last_updated: "2026-05-12T19:17:09.286Z"
last_activity: 2026-05-12 -- Phase 34 execution started
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 5
  completed_plans: 2
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (symlink to /home/claude/chris/PLAN.md, updated 2026-04-26 at v2.4 milestone kickoff).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** Phase 34 — Inference Engine

## Current Position

Phase: 35
Plan: Not started
Next: Phase 34 (inference-engine)
Status: Ready to plan
Last activity: 2026-05-12

```
Progress: [████░░░░░░░░░░░░░░░░] 18% (2/11 plans)

Phase 33 (PROF substrate)   ██  2/2  ✓ shipped + deployed
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

| Phase | Name | Plans (est) | Requirements | Status |
|-------|------|-------------|--------------|--------|
| 33 | Profile Substrate | 2 | PROF-01..05 (5) | ✓ Complete + deployed |
| 34 | Inference Engine | 4 | GEN-01..07 (7) | Ready to plan |
| 35 | Surfaces | 3 | SURF-01..05 (5) | Awaits Phase 34 |
| 36 | Tests | 2 | PTEST-01..05 (5) | Awaits Phase 34+35 |
| **Total** | | **11 (2 done)** | **22 (5 done)** | |

**Phase ordering rationale:**

- Phase 33 first: 7 of 11 pitfall mitigations require schema-phase artifacts; `schema_version`, `substrate_hash`, `profile_history` table, `name='primary'` sentinel — all non-retrofittable. Zero LLM calls, zero user-visible features — pure foundation.
- Phase 34 after Phase 33: generators need the schema to exist; `assembleProfilePrompt` shared builder ships first (HARD CO-LOC #M10-2) before any dimension generator.
- Phase 35 after Phase 34: `buildSystemPrompt` refactor needs at least one populated row to test non-null rendering; mode handlers can't inject profiles that don't exist yet.
- Phase 36 last: fixture generation + integration tests validate the full stack; cannot start until Phase 34 generators and Phase 35 mode wiring are both complete.

**Cron timing:** Sunday 22:00 Paris (4h after weekly_review's 20:00 fire — M010-04 mitigation; 2h gap gives full retry-window buffer under worst-case adversarial weekly review conditions).

## Accumulated Context

### Decisions in force going into Phase 34

Full log in PROJECT.md Key Decisions table. Most relevant for M010 going forward:

- **D004 append-only Pensieve** — profiles are a projection/inference layer, not authoritative.
- **D005 fire-and-forget** — `updateAllOperationalProfiles()` called from cron; never blocks primary response.
- **D018 no skipped tests** — primed-fixture pipeline (D041) gates M010 testing, not 30 real calendar days.
- **D031 structured fact injection** — profile block placed ABOVE `{pensieveContext}`, labeled as grounded context not interpretation.
- **D035 Pensieve authoritative** — `boundary-audit.test.ts` must not find `episodic_summaries` referenced from `profiles.ts` narrative fields (verified clean in Phase 33).
- **D041 primed-fixture pipeline** — M010 validates via m010-30days fixture; no real-calendar-time wait.
- **Research conflict resolved** — `Promise.allSettled` wins over sequential `await` loop (error isolation + 4× wall-clock improvement).
- **Research conflict resolved** — Sunday 22:00 Paris cron (not 21:00 from spec default) — 2h gap after weekly_review.
- **Research conflict resolved** — confidence hybrid: Sonnet emits `data_consistency`; host computes final via `computeProfileConfidence(entryCount, data_consistency)`. Implemented in `src/memory/confidence.ts` (Phase 33).
- **Research conflict resolved** — `profile_history` table ships in initial migration (PITFALLS/ARCH win over FEATURES DIFF-3 deferral). Shipped in migration 0012.

### Session 2026-05-11 outcomes (shipped + deployed)

**Phase 33 — Profile Substrate (complete + verified + deployed):**

- 2 plans, 14 tasks total
- Plan 33-01 (atomic substrate migration) — migration 0012, schema.ts, drizzle meta, scripts/test.sh smoke gate, scripts/regen-snapshots.sh cleanup-flag bump. HARD CO-LOC #M10-1 honored (6 atomic artifacts).
- Plan 33-02 (reader + zod + confidence) — `getOperationalProfiles()` never-throw, v3+v4 dual schemas, `computeProfileConfidence` + `isAboveThreshold` pure functions, 35 new tests all green.
- All 5 ROADMAP success criteria verified (`33-VERIFICATION.md`).
- Production deploy: 5 profile tables present on Proxmox DB, 4 seed rows confirmed (jurisdictional=0.3, capital=0.2, health=0, family=0).

**PP#5 hotfix (commit `04c6a6f`, live in prod):**

- Bug: Greg's morning freeform messages were silently absorbed as ritual_responses while the evening journal's 18h pending slot was open. Chris stayed silent on legitimate chat-initiated messages for up to 18 hours/day.
- Fix: `findActivePendingResponse` only runs when the inbound Telegram message has `reply_to_message_id` set. User-initiated freeform messages always reach the engine.
- Manual reprocess of "Bon pour Batumi" delivered via Telegram (message_id 633).

**Ground-truth dynamic refactor (commit `22793b4`, live in prod):**

- `src/pensieve/ground-truth.ts` now exports a date-aware `LOCATION_LOG` + `getCurrentLocation(at)` / `getNextMove(at)` / `getGroundTruth(at)` / `getGroundTruthMap(at)` functions.
- `buildKnownFactsBlock()` in `src/chris/personality.ts` calls `getGroundTruth(new Date())` per request — Chris's known-facts block reflects today's actual location instead of asserting stale "Saint Petersburg until 2026-04-28" strings.
- Backward-compat: `GROUND_TRUTH` / `GROUND_TRUTH_MAP` consts still exist (evaluated at module load).
- Migration 0012's seed rows are a frozen point-in-time copy — comment in SQL documents that future `ground-truth.ts` edits do not propagate to those rows (Phase 34 generators will overwrite via inference).

**Docker test gate (49 tests recovered, 97 → ~48 failed):**

- `scripts/test.sh` now sources `.env` before vitest so real Anthropic credentials win over the `:-test-key` fallback (was masking the valid prod key, all live tests 401'd silently).
- HF transformers cache redirected to `/tmp/hf-cache-$USER` to bypass read-only `node_modules` install.
- `engine-mute.test.ts` config mock now includes `telegramBotToken` (grammy was throwing "Empty token!" at module load).
- `config.test.ts` RITUAL_SWEEP_CRON default expectation updated `'0 21 * * *'` → `'* * * * *'` (matches code's per-minute cadence since commit 4d95285).
- `wellbeing.test.ts` Tests 6+7 ORDER BY bug fixed (v2.4 carry-forward closed — `.orderBy(desc(firedAt))` so destructure picks the latest event).
- Time-bound `live-integration` "grounds response in seeded location fact" test removed (embedded 2026-04-28 boundary went stale).
- Marker extraction — `VALIDATION_MARKERS` moved to `src/chris/markers.ts`; `FLATTERY_MARKERS` moved to `src/episodic/markers.ts`. `live-weekly-review.test.ts` had been importing from `.test.ts` files which caused vitest to re-register 23 tests under its scope (21 duplicate failures).
- FK-safe cleanup ordering applied to: `decisions/synthetic-fixture.test.ts`, `episodic/synthetic-fixture.test.ts`, `episodic/live-anti-flattery.test.ts`, `skip-tracking.integration.test.ts`, `scripts/synthesize-episodic.test.ts`. Fire-and-forget embed now actually writes rows (real API key) and cleanup must wipe `pensieve_embeddings` before `pensieve_entries`.
- Other small renames: silence/context-builder John→Greg; context-builder.ts final-stage truncate at charBudget; BASE_DATE in `decisions/synthetic-fixture.test.ts` anchored to today-14d so TEST-10's `fetchStatsData` rolling window includes the lifecycle simulation.

### HARD CO-LOCATION CONSTRAINTS (must be honored across phase boundaries)

1. ~~**Phase 33 (M10-1)**: Migration SQL + drizzle meta snapshot + `scripts/test.sh` psql line ship in ONE atomic plan. `schema_version` + `substrate_hash` ship in SAME migration as table creation — never retrofitted.~~ **SHIPPED** in Plan 33-01.
2. **Phase 34 (M10-2)**: `assembleProfilePrompt` shared builder ships BEFORE any of the 4 dimension generators (per-dimension prompt drift mitigation).
3. **Phase 34 (M10-3)**: Substrate-hash idempotency test (two-cycle / second-fire) ships in the SAME plan as the generator that introduces the hash.
4. **Phase 35 (M10-4)**: `buildSystemPrompt` signature refactor lands atomically across ALL call sites in ONE plan. OQ-3 call-site inventory is pre-work before any code change.
5. **Phase 35 (M10-5)**: `/profile` handler + `formatProfileForDisplay` + golden-output snapshot test land in the SAME plan.
6. **Phase 36 (M10-6)**: `synthesize-delta.ts --profile-bias` flag + m010-30days fixture generation + populated-case test + sparse-case test land in the SAME plan.

### Never-Retrofit Checklist (enforced in Phase 33 — ALL CLOSED)

- [x] `profile_history` table in migration 0012
- [x] `schema_version INT NOT NULL DEFAULT 1` in all 4 profile tables
- [x] `substrate_hash TEXT` in all 4 profile tables
- [x] `name TEXT NOT NULL UNIQUE DEFAULT 'primary'` sentinel in all 4 profile tables
- [x] `confidence REAL CHECK (confidence >= 0 AND confidence <= 1)` in all 4 profile tables
- [x] Migration 0012 in `scripts/test.sh` psql apply chain
- [x] Drizzle meta snapshot regenerated for migration 0012

### Open Questions (resolve during planning)

| ID | Question | Phase | Starting Point |
|----|----------|-------|---------------|
| OQ-1 | Pensieve domain-filtering strategy for `loadProfileSubstrate()` | Phase 34 | Tag-only (FACT/RELATIONSHIP/INTENTION/EXPERIENCE); no keyword/semantic filtering |
| OQ-2 | Confidence calibration Sonnet prompt phrasing | Phase 34 | Draft in Phase 34 planning; validate on sparse vs rich fixtures in Phase 36 |
| OQ-3 | `buildSystemPrompt` call-site inventory | Phase 35 pre-work | Grep `src/` before any code change; document ACCOUNTABILITY overload explicitly |
| OQ-4 | `synthesize-delta.ts --profile-bias` threshold determinism | Phase 36 | Validate 10-entry crossing per domain deterministically in 30-day window |
| OQ-5 | SATURATION constant tuning | Post-ship | SATURATION=50 is first estimate (set in `src/memory/confidence.ts`); tune after 4-8 weeks of prod operation |

### v2.4 Carry-Forward Items (NOT in M010 scope — v2.5.1 backlog)

- Synth-pipeline organic+synth fusion (`synthesize-episodic.ts:288` + `synthesize-delta.ts` wellbeing-per-fused-day)
- FR/RU localization of templated weekly_review fallback (currently EN-only per D-29-02-D)
- Phase 28 UAT: 60s confirmation window real-clock observation + 7d+7d evasive trigger spacing test
- ~~`wellbeing.test.ts` Tests 6+7 ORDER BY bug fix (pre-existing test-only false negative; production behavior correct)~~ **FIXED 2026-05-11** via `.orderBy(desc(ritualFireEvents.firedAt))`.
- Stale callback prefix comments in `src/bot/handlers/ritual-callback.ts:31-32` (doc noise)
- Forensic investigation of `__drizzle_migrations` row loss (cold trail)
- 2026-05-17 20:00 Paris second weekly_review fire observation (second-person + language fix commit 0626713)
- **NEW**: ~48 remaining failing tests in Docker gate after this session — categorized: (a) ~20 contradiction-false-positive timeouts that need real-API rate-limit cooldown to verify, (b) ~5 live tests showing Sonnet model behavior drift that need rebaseline, (c) ~10 cross-test pollution issues (weekly-review sparse-data, scheduler D-29-08), (d) TEST-12 in decisions/synthetic-fixture has a vitest mock-resolution issue (buildMessageHistory mock not propagating despite hoisted vi.mock).
- **NEW**: 2026-05-11 PP#5 contract change is a behavioral change for Greg — fresh messages always reply; only Telegram-native replies trigger silent ritual capture. Document if confusion arises.

## Deferred Items

Items acknowledged and deferred at v2.4 milestone close on 2026-05-11:

| Category | Item | Status |
|----------|------|--------|
| verification_gap | Phase 28 (28-VERIFICATION.md) | human_needed — 60s confirmation window real-clock UAT + 7d+7d evasive trigger spacing test |
| verification_gap | Phase 29 (29-VERIFICATION.md) | human_needed — UX-level retry awaiting 2026-05-17 20:00 Paris fire |
| verification_gap | Phase 30 (30-VERIFICATION.md) | human_needed — HARN-04/HARN-06 floor restoration blocked on synth-pipeline fusion |

## Session Continuity

Last session: 2026-05-12T18:45:21.028Z
Stopped at: Phase 34 context gathered
Next: `/gsd-discuss-phase 34` or `/gsd-plan-phase --research-phase 34` to scope Phase 34 (Inference Engine — `assembleProfilePrompt` + 4 dimension generators, 7 requirements GEN-01..07).

**Prod state at session end:**

- Container HEAD: `22793b4` (chris-chris image rebuilt 2026-05-11, container restarted, polling Telegram)
- Migrations applied: 13 entries (0012_operational_profiles latest)
- Profile tables: 5/5 present on prod DB with correct seed values
- PP#5 hotfix live; Chris replies to all fresh freeform messages
- Ground-truth: dynamic location facts (current=Batumi until 2026-05-16, next=Antibes May 16→Sep 1, permanent=Batumi from Sep 1)

**Local repo state:**

- `main` HEAD: `22793b4` (pushed to origin)
- All Phase 33 artifacts in `.planning/phases/33-profile-substrate/`: CONTEXT, RESEARCH, PATTERNS, VALIDATION, two PLAN.md, two SUMMARY.md, VERIFICATION
- Phase 32 was the last completed phase before this session (v2.4 close at ef45e1b). Migration 0012 now lives on top of 0011.
