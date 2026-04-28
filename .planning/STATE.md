---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: M009 Ritual Infrastructure + Daily Note + Weekly Review
status: verifying
stopped_at: "Plan 27-01 complete (3 commits: 380a481 dispatcher+stub, 4ba31a1 bot.on registration, 0e1b5b0 7 unit tests). First inline-keyboard surface in codebase. WELL-01/WELL-02 partial; full completion in Plan 27-02."
last_updated: "2026-04-28T11:40:00.000Z"
last_activity: 2026-04-28 — Plan 27-01 complete (callback router infrastructure; 3 commits). Phase 27 in progress (1/3 plans).
progress:
  total_phases: 6
  completed_phases: 2
  total_plans: 15
  completed_plans: 10
  percent: 67
---

# Project State

## Project Reference

See: .planning/PROJECT.md (symlink to /home/claude/chris/PLAN.md, updated 2026-04-26 at v2.4 milestone kickoff).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** v2.4 M009 *(MVP shipping point)* — ritual scheduling infrastructure plus three rituals (daily voice note, daily wellbeing snapshot, weekly review) that complete the frictionless reflection loop. After M009 ships, every M010+ profile milestone consumes the real cadence-driven data this milestone produces.

## Current Position

Phase: **25** COMPLETE; **26 COMPLETE**; **27 IN PROGRESS** (Plan 27-01 done; 27-02 + 27-03 pending). **29 PLANNED**.
Plan: 27-01 complete (3 commits: 380a481 + 4ba31a1 + 0e1b5b0) — first inline-keyboard callback dispatcher in codebase:

  - `src/bot/handlers/ritual-callback.ts` (NEW, ~75 LOC) — prefix-routing dispatcher. Routes `r:w:*` → `handleWellbeingCallback` (handler owns its own ack); silently acks `r:adj:*` (Phase 28 forward-compat), `r:wr:*` (Phase 29 forward-compat), and unknown root prefixes via warn-log per Telegram's 30-second answerCallbackQuery contract. Auth gate via existing `bot.use(auth)` middleware preserved without code change.
  - `src/rituals/wellbeing.ts` (NEW, STUB) — exports `handleWellbeingCallback` signature that throws `'rituals.wellbeing.handleWellbeingCallback: stub — Plan 27-02 fills this'`. Plan 27-02 wholesale-replaces with real `fireWellbeing` + handler. The throwing stub is a safety net; mocked via vi.mock in Plan 27-01 tests so never fires.
  - `src/bot/bot.ts` (MODIFIED, +5 LOC) — added `bot.on('callback_query:data', handleRitualCallback as any)` registration AFTER `bot.on('message:voice')` and BEFORE `bot.catch`. Awk-verified source-order: `auth=22 cb=91 catch=93`.
  - `src/bot/__tests__/ritual-callback.test.ts` (NEW, 7 tests) — covers all 4 dispatch branches: 2 wellbeing routing + 3 unknown ritual prefix + 1 unknown root + 1 missing data. Mocks wellbeing.js so throwing stub never fires; mocks logger to keep test stdout clean. All 7 tests pass first run.
  - 0 deviations from plan. WELL-01 + WELL-02 partial (router shipped; keyboard rendering + DB writes ship in Plan 27-02 atomically with migration 0008 seed insert per D-27-06).
  - Pre-existing full-suite test isolation issue documented in `.planning/phases/27-daily-wellbeing-snapshot/deferred-items.md`. 60/60 rituals + 63/63 bot tests pass in isolation; full-suite cross-contamination is out of Plan 27-01 scope.

Prior context — Plan 26-05 complete (1 commit: 30e9cc9) — scripts/fire-ritual.ts operator wrapper for manual UAT:

  - `scripts/fire-ritual.ts` (NEW, 81 lines) — operator CLI script taking ritual name as positional arg; backdates `next_run_at` to now()-1min via `db.update(rituals).set({ nextRunAt }).where(eq(rituals.name, ritualName)).returning()`; hard-fails (exit 1) on missing argv → "Usage: ..." or zero-row UPDATE → "No ritual found with name '...'"; on success invokes `runRitualSweep()` once and prints `JSON.stringify(results, null, 2)` to stdout; structured `fire-ritual.set_next_run_at` log line emits ritualName + newNextRunAt for audit trail. ESM entry-point guard at file bottom (`if (import.meta.url === \`file://${process.argv[1]}\`)`) prevents auto-execute on import — Phase 25 LEARNINGS lesson 4. ROADMAP §Phase 26 success criterion 1 (`npx tsx scripts/fire-ritual.ts daily_voice_note`) now satisfiable end-to-end against staging.
  - All 8 grep gates pass: `runRitualSweep` import (1), `runRitualSweep` total (4 ≥2), `process.argv[2]` (1), `import.meta.url ===` (1), Usage prefix (1), "No ritual found" (1), `oneMinuteAgo` (3 ≥2), tsc-noEmit-clean (0 errors).
  - 3 smoke tests verified live this session: missing-arg → "Usage: ..." stderr + exit 1 ✓; unknown ritual against real Docker postgres → "No ritual found with name 'nonexistent_ritual_xyz'" stderr + exit 1 ✓; tsc --noEmit → zero errors anywhere ✓.
  - 0 deviations from plan — script was authored by prior agent in untracked state and matched plan spec verbatim on first inspection; this session inspected, verified, smoke-tested, and committed.

Status: Phase 27 IN PROGRESS. Plan 27-01 complete (callback router infrastructure shipped). Next: Plan 27-02 (wellbeing handler + migration 0008 seed — atomic per D-27-06; replaces wellbeing.ts stub wholesale + wires `case 'daily_wellbeing':` in dispatchRitualHandler). Phase 26 still ready for `/gsd-verify-work`. Phase 29 still parallel-eligible (orthogonal to Phase 27).
Progress: [███████░░░] 67%
Last activity: 2026-04-28 — Plan 27-01 complete (callback router infrastructure; 3 commits). First inline-keyboard surface in codebase. WELL-01/WELL-02 partial.

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
| 25 | Ritual Scheduling Foundation | 3 | RIT-01..12 (12) *(PROC-01/02 dropped 2026-04-26 — verified upstream)* |
| 26 | Daily Voice Note Ritual | 4 | VOICE-01..06 (6) |
| 27 | Daily Wellbeing Snapshot | 3 | WELL-01..05 (5) |
| 28 | Skip-Tracking + Adjustment Dialogue | 4 | SKIP-01..07 (7) |
| 29 | Weekly Review | 4 | WEEK-01..09 (9) |
| 30 | Test Infrastructure + HARN-03 Refresh | 3 | TEST-23..32, HARN-04..06 (13) |
| **Total** | | **21** | **52** |

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

### Plan 25-02 implementation decisions (2026-04-26)

- **D-25-02-A: tryFireRitualAtomic null-observation predicate is `isNull(rituals.lastRunAt)` ONLY** (not `or(isNull, sql\`true\`)` as RESEARCH §6 prescribed). The `sql\`true\`` fallback would have failed the RIT-10 exactly-once contract under concurrency because postgres re-evaluates the second UPDATE's WHERE against post-commit row state, and `true` is row-state-independent. Strict `isNull` makes the second UPDATE's WHERE FAIL after the first commits (lastRunAt is no longer null), giving the SQL-level proof. The non-null `lastObserved` case retains `or(isNull, lt)` shape. See 25-02-SUMMARY.md Deviation 1 for full reasoning.
- **D-25-02-B: Pitfall 2/3 grep guards (and TESTING.md D-02 fake-timer guard) require docstrings to NOT name forbidden patterns literally.** Source files describe forbidden patterns abstractly ("manual UTC ms arithmetic", "JS Date wall-clock setters", "fake-timer mocks") so the guard regex itself does not appear in source. Verification regex lives in plan reference. Future plan authors should anticipate this when writing acceptance criteria for file-level grep guards.
- **D-25-02-C: D-09 3-arg `computeNextRunAt(now, cadence, config)` signature confirmed correct.** The 3-arg shape is the right call: cadence sources from `rituals.type` enum column, never denormalized into the jsonb config. RESEARCH.md §4's pseudocode is illustrative; the real signature is what landed.

### Plan 27-01 implementation decisions (2026-04-28)

- **D-27-01-A: Logger module mocked in tests in addition to wellbeing.** Plan's reference test scaffold only mandated `vi.mock` of `'../../rituals/wellbeing.js'`. I additionally mocked `'../../utils/logger.js'` because the dispatcher emits `logger.warn` for the 5 silent-ack branches; the real pino logger would print warn output during test runs and pollute test stdout. Mirrors existing pattern from `src/bot/__tests__/document-handler.test.ts`. No behavioral change — the dispatch logic is unchanged; only test ergonomics improve. Documented in 27-01-SUMMARY.md "Decisions Made".

- **D-27-01-B: Pre-existing full-suite test isolation issue logged to deferred-items.md (out of scope).** `bash scripts/test.sh` reports 29 failed test files / 74 failed tests when run as a full suite. Categorized failures: live-integration suite needs real Anthropic API key (test harness uses `test-key` placeholder; pre-existing), and 8 DB-integration suites pass cleanly when run in isolation but cross-contaminate at the DB level when run together. Verified by `npx vitest run src/rituals/` → 60/60 passed and `npx vitest run src/bot/` → 63/63 passed against the same Docker postgres. Plan 27-01 introduces zero changes that touch these failing modules — pure routing wiring + new STUB + new test file. Per executor SCOPE BOUNDARY rule (only fix issues DIRECTLY caused by current task's changes), this is deferred to a future infra plan to investigate vitest fork isolation + per-suite DB cleanup hooks.

### Plan 26-01 implementation decisions (2026-04-28)

- **D-26-01-A: PP#5 partial index declared in `src/db/schema.ts` via `.where(sql\`...\`)` (not just in migration SQL).** Code_context CONTEXT.md noted this was "cleaner — planner picks"; the call was YES — keeps drizzle-kit snapshot/schema parity tight, mirrors Phase 25 wellbeing_snapshots_snapshot_date_idx + rituals_next_run_at_enabled_idx precedent. Net-effect: `bash scripts/regen-snapshots.sh` reports "No schema changes" against fresh DB without per-run drift; `meta/0007_snapshot.json` already encodes the partial index so future drizzle-kit operations don't propose to add it.
- **D-26-01-B: drizzle-kit auto-generated `0007_*.sql` discarded after producing the meta-snapshot; hand-authored `0007_daily_voice_note_seed.sql` is canonical.** drizzle-kit cannot model INSERT seed rows or DEFAULT-then-DROP-DEFAULT pattern; same hybrid-pattern Phase 25 used for 0006. The auto-generated SQL would have been `ALTER TABLE ... ADD COLUMN ... NOT NULL` (no DEFAULT) — fine on a literally zero-row table but introduces backfill ambiguity if any maintenance/migration adds rows mid-deploy. The DEFAULT-then-DROP-DEFAULT idiom is the safer contract.
- **D-26-01-C: scripts/regen-snapshots.sh cleanup-trap flag renamed `REGEN_PRODUCED_0006` → `REGEN_PRODUCED_ACCEPTANCE`** for future-N safety. Cleanup glob updated `0007*.json` → `0008*.json` (the post-acceptance-gate sequence-counter slot drizzle-kit emits when this script runs after Plan 26-01's 0007 lands). Future plans (Plan 27-01, Plan 28-01, etc.) just flip the suffix +1.

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

### PROC-01/PROC-02 post-update verification (2026-04-26)

GSD updated 1.38.3 → 1.38.5. **PROC-01 verdict: REDUNDANT. PROC-02 verdict: REDUNDANT.**

Evidence:

- **PROC-01** (wire `gsd-verifier` into `/gsd-execute-phase`):
  - `~/.claude/get-shit-done/workflows/execute-phase.md:1338-1376` defines `verify_phase_goal` step that spawns `gsd-verifier` subagent (`subagent_type="gsd-verifier"`, line 1368) and reads VERIFICATION.md status from disk: `grep "^status:" "$PHASE_DIR"/*-VERIFICATION.md | cut -d: -f2 | tr -d ' '` (line 1374-1376).
  - Hard gate via status table (line 1378-1382): only `passed` advances to `update_roadmap`; `gaps_found` triggers `/gsd-plan-phase --gaps` cycle. This is exactly the regression class 1.38.4 changelog described and what PROC-01 was scoped to fix.
- **PROC-02** (SUMMARY.md `requirements-completed` frontmatter):
  - `~/.claude/get-shit-done/templates/summary.md:41`: `requirements-completed: []  # REQUIRED — Copy ALL requirement IDs from this plan's 'requirements' frontmatter field.`
  - `~/.claude/get-shit-done/workflows/execute-plan.md:336`: instructs executor to copy `requirements` array from PLAN.md frontmatter verbatim.
  - `~/.claude/get-shit-done/bin/lib/commands.cjs:463`: `gsd-sdk` parser recognizes `fm['requirements-completed']`.
  - `~/.claude/get-shit-done/workflows/audit-milestone.md:112,116,329`: `gsd-sdk query summary-extract --pick requirements_completed` consumed by milestone audit.

**Recommended Phase 25 scope adjustment:** Drop PROC-01 and PROC-02 from Phase 25's first plan. Phase 25 plan budget shrinks by ~1 task (process-gate plan). Update `.planning/REQUIREMENTS.md` to mark PROC-01/PROC-02 as `[x] (upstream: GSD 1.38.4/1.38.5)` and update `.planning/ROADMAP.md` Phase 25 requirements list (54 → 52 requirements; Phase 25 14 → 12). **Greg decides whether to make those scope edits.**

### Blockers/Concerns

None. Ready to plan Phase 25 — pending todo resolved (verdict above).

## Session Continuity

Last session: 2026-04-28T11:40:00Z
Stopped at: Plan 27-01 complete (3 commits: 380a481 dispatcher+stub, 4ba31a1 bot.on registration, 0e1b5b0 7 unit tests). First inline-keyboard surface in codebase shipped. WELL-01/WELL-02 partial; Plan 27-02 next (wellbeing handler + migration 0008 seed; replaces wellbeing.ts stub wholesale).
Resume file: None

## Known Tech Debt

- **TECH-DEBT-19-01** — RESOLVED in v2.2 Plan 20-01 (2026-04-18, archived).
- **Vitest-4 fork-IPC hang under HuggingFace EACCES** — pre-existing env issue, operational mitigation 5-file excluded-suite in `scripts/test.sh`. Non-blocking; worth addressing in a future fix-up phase.
- **v2.2 Plan 21 WR-02 retry-on-all-errors policy** — documented design choice; M009+ may revisit if error patterns emerge.
- **v2.3 process gaps (process-gate + SUMMARY frontmatter)** — folded into Phase 25 of v2.4 as PROC-01/02.
- **Upstream `gsd-sdk milestone.complete` bug** — file upstream issue; not in M009 scope.
- **process.exit() in non-try/finally scripts** — safe today but worth post-M009 audit.
