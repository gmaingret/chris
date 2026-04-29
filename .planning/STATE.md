---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: M009 Ritual Infrastructure + Daily Note + Weekly Review
status: executing
stopped_at: "Plan 29-03 complete (3 task commits: 7dc35c9, 2fbdadb, 45d9995). Migration 0009_weekly_review_seed.sql + drizzle meta lineage + scripts/test.sh seed-row gate + dispatchRitualHandler 'weekly_review' case + 2 new scheduler.test.ts tests. WEEK-01 fire-side substrate verifiably met. Full pipeline (cron tick → runRitualSweep → tryFireRitualAtomic → dispatchRitualHandler → fireWeeklyReview) is now invocable. Next on Phase 29: Plan 29-04 (live anti-flattery test scaffolding for Phase 30 TEST-31)."
last_updated: "2026-04-29T00:34:49.588Z"
last_activity: "2026-04-29 — Plan 29-03 complete (3 task commits). Migration 0009 seeds weekly_review at next Sunday 20:00 Paris; dispatcher routes weekly_review → fireWeeklyReview; scheduler.test.ts 10/10 (full rituals/__tests__/ 133/133); WEEK-01 terminates."
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 15
  completed_plans: 14
  percent: 93
---

# Project State

## Project Reference

See: .planning/PROJECT.md (symlink to /home/claude/chris/PLAN.md, updated 2026-04-26 at v2.4 milestone kickoff).

**Core value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian. Memory is tiered: raw Pensieve for recent fidelity, episodic daily summaries for older context.

**Current focus:** v2.4 M009 *(MVP shipping point)* — ritual scheduling infrastructure plus three rituals (daily voice note, daily wellbeing snapshot, weekly review) that complete the frictionless reflection loop. After M009 ships, every M010+ profile milestone consumes the real cadence-driven data this milestone produces.

## Current Position

Phase: **25** COMPLETE; **26 COMPLETE**; **27 IN PROGRESS** (Plans 27-01 + 27-02 done; 27-03 pending). **29 IN PROGRESS** (Plans 29-01 + 29-02 + 29-03 done; 29-04 pending).
Plan: 29-02 complete (5 task commits + 1 docs commit: 9dee2a7 + 7b34a52 + 53135c4 + b2fe0b0 + b75dc0f + 8e4f56d) — HARD CO-LOC #2 + #3 ATOMIC plan:

  - `src/rituals/weekly-review.ts` (39 → 652 LoC, +613) — Plan 29-01's skeleton replaced with full impl: `stage1Check` + `INTERROGATIVE_REGEX` (EN+FR+RU per D-03) + `WeeklyReviewSchema` (v3 with .refine) + `WeeklyReviewSchemaV4` (v4 SDK boundary mirror) + `StageTwoJudgeSchema` v3+v4 + `DateGroundingSchema` v3+v4 + `MultiQuestionError` + `DateOutOfWindowError` + `runStage2HaikuJudge` (D-04 Haiku question-counter) + `runDateGroundingCheck` (D-05 Haiku date-window auditor) + `MAX_RETRIES = 2` + `TEMPLATED_FALLBACK_EN` (English-only v1; FR/RU deferred to v2.5 per W-4 lock) + `generateWeeklyObservation` retry-loop + `fireWeeklyReview(ritual, cfg) → Promise<RitualFireOutcome>` orchestrator (substrate fetch → sparse-data guard → generation w/retry+fallback → D031 header render → ritual_responses write → Pensieve persist `epistemicTag: 'RITUAL_RESPONSE'` → Telegram send).
  - `src/rituals/__tests__/weekly-review.test.ts` (NEW, 775 LoC) — 8 describe blocks; 31 tests: 9 Stage-1 unit + 1 schema sanity + 4 Stage-2 mocked + 4 Date-grounding mocked + 6 retry-loop mocked + 2 templated fallback + 1 SDK-boundary CONSTITUTIONAL_PREAMBLE assertion + 4 fireWeeklyReview real-DB integration. All real-DB tests use `test-29-02-` source discriminator for fixture isolation per D041.
  - **HARD CO-LOC #2 (Pitfall 14): closed.** Stage-1 + Stage-2 + retry + generator all in same plan-scope commits. Documented Pitfall 14 failure modes (multi-`?`, FR period-terminated multi-question, RU period-terminated multi-question) deterministically caught by `stage1Check` regex.
  - **HARD CO-LOC #3 (Pitfall 17): closed.** Unit test asserts `mockAnthropicParse.mock.calls[0][0].system[0].text.startsWith('## Core Principles (Always Active)')` — regression detector active. CONSTITUTIONAL_PREAMBLE flows through assembleWeeklyReviewPrompt → fireWeeklyReview → buildSonnetRequest → anthropic.messages.parse system arg verbatim.
  - Task 5 SKIPPED — Phase 26 commit `6c7210d` already shipped `storePensieveEntry opts.epistemicTag` parameter (cross-phase coordination per D-07; Plan 29-02 reuses verbatim with camelCase signature, NOT plan brief's snake_case `options.epistemic_tag`).
  - 3 deviations auto-fixed: (1) Rule 1 — `MultiQuestionError` constructor reshaped from `{count, questions}` → `{question_count, questions}` to match retry-loop semantics (TS2345 type fix); (2) Rule 3 cosmetic — reworded `vi.useFakeTimers` literal-token in test file docstring to satisfy grep guard (same defect class as 29-01 #3); (3) Rule 1 — replaced broken `db.execute(sql\`...\`).rows` accessor with typed Drizzle select (postgres-js driver returns row arrays, not `{rows}`).
  - Verification: `npx tsc --noEmit` exits 0 attributable to modified files; `bash scripts/test.sh src/rituals/__tests__/weekly-review.test.ts` reports 31/31 green in <850ms; full rituals suite 131/131 across 13 files in 9.22s.
  - All 7 plan requirements (WEEK-02..WEEK-08) terminate. WEEK-09 already terminated in Plan 29-01. Phase 29 needs Plan 29-03 (migration 0009 seed + dispatcher case wire-up + scripts/test.sh psql line) and Plan 29-04 (live anti-flattery test scaffolding for Phase 30 TEST-31) before phase verification.

Prior context — Plan 27-02 complete (3 commits: bdc924a + 2d451f3 + 3fff9a1) — wellbeing handler + seed migration ATOMIC per D-27-06:

  - `src/db/migrations/0008_wellbeing_seed.sql` (NEW) — single idempotent INSERT seeding `daily_wellbeing` ritual at next 09:00 Europe/Paris (CASE date math sidesteps catch-up ceiling on first sweep tick). RitualConfigSchema-conformant 6-of-8 field config (omits optional fire_dow + prompt_bag for daily-no-bag ritual). ON CONFLICT (name) DO NOTHING idempotent re-apply.
  - `src/db/migrations/meta/0008_snapshot.json` (NEW) — cloned from 0007 (pure-DML migration → no schema delta → schema content byte-identical) with re-chained id/prevId. `_journal.json` extended with `idx:8 tag:0008_wellbeing_seed`.
  - `src/rituals/wellbeing.ts` (REPLACED — STUB → ~330 LOC real). Exports `fireWellbeing(ritual, cfg) → Promise<RitualFireOutcome>` (initial-fire: insert ritual_responses with empty partial, send 4-row keyboard via bot.api.sendMessage, persist message_id via jsonb_set, return 'fired') + `handleWellbeingCallback(ctx, data) → Promise<void>` (parseCallbackData server-side validates dim ∈ {e,m,a} + value ∈ [1,5]; findOpenWellbeingRow filters responded_at IS NULL + fired_at::date = today; per-tap merge via atomic jsonb_set; completion-gated wellbeing_snapshots upsert when isComplete(partial) — single atomic write, all 3 NOT NULL cols populated; skip writes adjustment_eligible:false + emits 'wellbeing_skipped' outcome distinct from fired_no_response).
  - `src/rituals/scheduler.ts` (MODIFIED, +3 LOC) — added `import { fireWellbeing } from './wellbeing.js';` + `case 'daily_wellbeing': return fireWellbeing(ritual, cfg);` branch alongside Phase 26's `daily_voice_note`. Only `// case 'weekly_review'` comment remains as Phase 29 placeholder.
  - `scripts/test.sh` (MODIFIED) — applies migration 0008 + asserts `SELECT count(*) FROM rituals WHERE name = 'daily_wellbeing' = 1` BEFORE vitest fires. Failure exits with `❌ MIGRATION 0008: daily_wellbeing seed missing` (mirrors Phase 25 6|1|3 + Phase 26 voice-note seed gate shape).
  - `scripts/regen-snapshots.sh` (MODIFIED) — declared MIGRATION_8 const + applied in acceptance gate chain + bumped acceptance-check cleanup names from 0008 to 0009 (next sequence after 0008). Acceptance gate prints "No schema changes, nothing to migrate" — confirms 0008 is pure DML.
  - 2 deviations (both Rule 3 auto-fix-blocking): (1) `fireWellbeing` signature conformed to live (ritual, cfg) → Promise<RitualFireOutcome> per Phase 26 D-26-08 dispatcher contract (plan was authored against pre-Phase-26 1-arg void-returning shape). (2) hand-cloned 0008_snapshot.json from 0007 because pure-DML migration produces no new snapshot from drizzle-kit regen (acceptance gate "No schema changes"); journal-snapshot 1:1 invariant preserved.
  - All 5 WELL requirements (WELL-01..05) terminate in this plan. Anchor-bias defeat (D-27-04) two-pronged enforced: (prong 1) module reads ZERO data from wellbeing_snapshots — verified by negative grep `! grep -E "select.*wellbeingSnapshots|from.*wellbeingSnapshots" src/rituals/wellbeing.ts`; (prong 2) constant prompt 'Wellbeing snapshot — tap energy, mood, anxiety:' has no historical numeric reference.
  - Verification: `npx tsc --noEmit` exits 0; `npx vitest run src/rituals/ src/bot/` reports 15/15 files / 123/123 tests passing in isolation; `npx tsx scripts/manual-sweep.ts` against test DB seeded with 0008 returns `[]` cleanly without throwing; live DB verifies `next_run_at = 2026-04-29 07:00:00+00` (UTC = 09:00 Europe/Paris CEST in April).
  - Pre-existing full-suite test isolation issues (113 fails) continue to surface in `bash scripts/test.sh` but are NOT caused by this plan — categories match Plan 27-01's deferred-items.md (live-integration 401 + HuggingFace EACCES + DB cross-contamination). Substrate gates (0006 + 0007 + 0008) all passed (test.sh exited 0; gates exit 1 on failure).

Prior context — Plan 27-01 complete (3 commits: 380a481 + 4ba31a1 + 0e1b5b0) — first inline-keyboard callback dispatcher in codebase. Routes r:w:* → handleWellbeingCallback (now real after Plan 27-02); silently acks unknown prefixes per Telegram's 30s contract.

Status: Phases 27 + 29 IN PROGRESS in parallel. **Phase 29:** Plans 29-01 + 29-02 + 29-03 complete (substrate + HARD CO-LOC #2+#3 ATOMIC generator + wire-up). Next: Plan 29-04 (live anti-flattery test scaffolding for Phase 30 TEST-31). **Phase 27:** Plans 27-01 + 27-02 complete; Plan 27-03 next (UAT script + integration tests). Phase 26 still ready for `/gsd-verify-work`.
Progress: [█████████░] 93%
Last activity: 2026-04-29 — Plan 29-03 complete (3 task commits: 7dc35c9, 2fbdadb, 45d9995). Migration 0009 seeds weekly_review at next Sunday 20:00 Paris; dispatcher routes weekly_review → fireWeeklyReview; scheduler.test.ts 10/10 (full rituals/__tests__/ 133/133); WEEK-01 terminates. WEEK-01..09 all terminate (Phase 29 plan-side complete; verifier next).

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

### Plan 29-02 implementation decisions (2026-04-28)

- **D-29-02-A: `fireWeeklyReview` returns `RitualFireOutcome`, not `void`.** Plan brief showed `Promise<void>` but the dispatcher contract (Phase 26 D-26-08) is `(ritual, cfg) → Promise<RitualFireOutcome>`. Aligning to the existing contract means Plan 29-03's dispatcher case is a one-line `case 'weekly_review': return fireWeeklyReview(ritual, cfg);` — same shape as `daily_voice_note` and `daily_wellbeing`. Returning `'fired'` is correct semantics for both successful generations AND the sparse-data short-circuit (mirrors M008 CONS-02 "no-entries" pattern).
- **D-29-02-B: `cfg` parameter accepted but unused in `fireWeeklyReview` body.** Weekly review has no per-fire config knobs (cron's `fire_dow=7` and `fire_at='20:00'` are read by scheduler before dispatch). Accepting `cfg` for dispatcher uniformity is preferable to a special-case signature; an `eslint-disable-next-line` directive documents the intentional non-use.
- **D-29-02-C: `respondedAt` set at end of fire flow, not on user reply.** `ritual_responses.respondedAt` has dual meaning across handlers — voice-note uses it for Greg's STT reply (PP#5 mechanism); weekly review has no expected user reply (Socratic question is rhetorical). Setting `respondedAt = new Date()` after Pensieve write marks "system completed the fire flow" so longitudinal queries don't confuse "weekly review never completed" with "Greg never replied". Metadata `isFallback` field distinguishes the two completion classes.
- **D-29-02-D: Templated fallback ships English-only as v1 baseline.** FR/RU localization explicitly DEFERRED to v2.5 per CONTEXT.md "Claude's Discretion" + W-4 directive. Source comment block cites the deferral so future-Greg knows the boundary lies here. When Greg's `franc` last-message-language detection is wired (Phase 26 substrate available), v2.5 will branch by language at the fallback site.
- **D-29-02-E: Cross-phase coordination on `storePensieveEntry` epistemicTag.** Phase 26 commit `6c7210d` shipped the optional `opts.epistemicTag` parameter ahead of Phase 29; Plan 29-02 reused verbatim. Note: plan brief said `options.epistemic_tag` (snake_case in `options`); shipped Phase 26 signature is `opts.epistemicTag` (camelCase in `opts`). Plan 29-02 calls `storePensieveEntry(observation, 'telegram', metadata, { epistemicTag: 'RITUAL_RESPONSE' })`. Semantics identical to plan's intent.

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

Last session: 2026-04-29T00:34:32.132Z
Stopped at: Plan 29-02 complete (5 task commits + 1 docs commit: 9dee2a7, 7b34a52, 53135c4, b2fe0b0, b75dc0f, 8e4f56d). HARD CO-LOC #2 + #3 ATOMIC plan terminated. Next on Phase 29: Plan 29-03 (migration 0009 seed + dispatcher wire-up + scripts/test.sh psql line). Plan 29-04 (live anti-flattery test scaffolding for Phase 30 TEST-31) parallel-eligible after 29-03.
Resume file: None

## Known Tech Debt

- **TECH-DEBT-19-01** — RESOLVED in v2.2 Plan 20-01 (2026-04-18, archived).
- **Vitest-4 fork-IPC hang under HuggingFace EACCES** — pre-existing env issue, operational mitigation 5-file excluded-suite in `scripts/test.sh`. Non-blocking; worth addressing in a future fix-up phase.
- **v2.2 Plan 21 WR-02 retry-on-all-errors policy** — documented design choice; M009+ may revisit if error patterns emerge.
- **v2.3 process gaps (process-gate + SUMMARY frontmatter)** — folded into Phase 25 of v2.4 as PROC-01/02.
- **Upstream `gsd-sdk milestone.complete` bug** — file upstream issue; not in M009 scope.
- **process.exit() in non-try/finally scripts** — safe today but worth post-M009 audit.
