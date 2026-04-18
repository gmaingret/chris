# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15) — see [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)
- ✅ **v2.1 M007 Decision Archive** — Phases 13-19 (shipped 2026-04-18) — see [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md)
- 🔨 **v2.2 M008 Episodic Consolidation** — Phases 20-23 (active)

## Phases

<details>
<summary>✅ v1.0 Phases 1-5 — SHIPPED 2026-04-13</summary>

- [x] **Phase 1: Foundation** — M001 Living Memory — Pensieve, 6-mode engine, Telegram bot
- [x] **Phase 2: Depth** — M002 Deep Counsel — 6-mode auto-detection, contradiction detection, hybrid retrieval
- [x] **Phase 3: External Sources** — M003 Digital Life — Gmail, Immich, Drive, file upload, cron sync
- [x] **Phase 4: Proactive Chris** — M004 — Proactive sweep with silence/commitment/pattern/thread triggers
- [x] **Phase 5: Requirement Validation** — M005 — All 28 v1.0 requirements resolved

</details>

<details>
<summary>✅ v2.0 Phases 6-12 — SHIPPED 2026-04-15</summary>

- [x] **Phase 6: Memory Audit** — Ground truth module + production Pensieve reconciled (5/5 plans)
- [x] **Phase 7: Foundational Behavioral Fixes** — Constitutional preamble, refusal handling, franc language detection (4/4 plans)
- [x] **Phase 8: Retrieval & Grounding** — JOURNAL hybrid retrieval, structured Known Facts injection (2/2 plans)
- [x] **Phase 9: Praise Quarantine** — Haiku post-processor for JOURNAL/REFLECT/PRODUCE (2/2 plans)
- [x] **Phase 10: Live Validation Suite** — 24-case live suite + 20-pair FP audit against real Sonnet (2/2 plans)
- [x] **Phase 11: Identity Grounding** — John→Greg unification, includeDate gating (3/3 plans)
- [x] **Phase 12: Identity rename residuals + frontmatter hygiene** — Tech-debt closure (1/1 plan)

See [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md) for full phase detail.

</details>

<details>
<summary>✅ v2.1 Phases 13-19 — SHIPPED 2026-04-18</summary>

- [x] **Phase 13: Schema & Lifecycle Primitives** — Append-only `decision_events`, `decisions` projection, capture-state table, `transitionDecision()` chokepoint with optimistic concurrency (5/5 plans) — completed 2026-04-15
- [x] **Phase 14: Capture Flow** — Two-phase trigger detection (regex + Haiku stakes), conversational 5-slot extraction, vague-prediction validator, engine PP#0/PP#1 (5/5 plans) — completed 2026-04-16
- [x] **Phase 15: Deadline Trigger & Sweep Integration** — Fifth SQL-first trigger at priority=2, channel separation, dated stale-context prompts (3/3 plans) — completed 2026-04-16
- [x] **Phase 16: Resolution, Post-Mortem & ACCOUNTABILITY Mode** — New ACCOUNTABILITY mode bypassing praise quarantine, Pensieve-first write ordering, ±48h temporal context, auto-escalation after 2 non-replies (5/5 plans) — completed 2026-04-16
- [x] **Phase 17: `/decisions` Command & Accuracy Stats** — Haiku 2-axis classification cached with model version, N≥10 floor, Wilson 95% CI, domain-tag breakdown (3/3 plans) — completed 2026-04-16
- [x] **Phase 18: Synthetic Fixture + Live ACCOUNTABILITY Suite** — End-to-end `vi.setSystemTime` fixture covering concurrency + collision + stale-context; live Sonnet ACCOUNTABILITY suite (4/2 plans — 2 gap-closure plans) — completed 2026-04-16
- [x] **Phase 19: Proactive Pipeline Restoration** — Gap closure for v2.1 audit: byte-exact restore of `sweep.ts`, channel-aware/escalation helpers, ACCOUNTABILITY prompts from canonical `4c156c3` (lost in worktree merge `5582442`); TEST-12 realignment (4/4 plans) — completed 2026-04-17

See [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md) for full phase detail.

</details>

### v2.2 M008 Episodic Consolidation (Active — Phases 20-23)

- [ ] **Phase 20: Schema + Tech Debt** — TECH-DEBT-19-01 drizzle-kit snapshot regeneration + `episodic_summaries` migration 0005 with all indexes + Zod types + config field
- [ ] **Phase 21: Consolidation Engine** — `runConsolidate()` with entry-count gate, idempotency, M006 preamble injection, importance rubric + floor hooks, verbatim quote enforcement, M007/M002 read-only integration, sparse-entry guard, failure notification
- [ ] **Phase 22: Cron + Retrieval Routing** — Independent cron in `src/index.ts`; DST-safe scheduling; two-dimensional retrieval routing; high-importance raw descent; INTERROGATE date-anchored injection; Known Facts and embedding separation audit
- [ ] **Phase 23: Test Suite + Backfill + `/summary`** — 14-day synthetic fixture (8 test cases), live anti-flattery integration test, backfill operator script, `/summary [YYYY-MM-DD]` Telegram command

---

**Pause Gate after Phase 23:** Several days minimum (ideally one week) of real episodic summaries must exist before M009 begins. M009 weekly review needs actual daily summaries as substrate. Do not start M009 until at least 7 real summaries are in `episodic_summaries`.

## Phase Details

### Phase 20: Schema + Tech Debt
**Goal**: The episodic_summaries table exists in Docker with correct indexes, the migration lineage is clean, and downstream phases have type-safe imports to build against.
**Depends on**: Phase 19 (v2.1 complete)
**Requirements**: TD-01, EPI-01, EPI-02, EPI-03, EPI-04
**Success Criteria** (what must be TRUE):
  1. `drizzle-kit generate` runs against a freshly-migrated Docker Postgres and reports "No schema changes, nothing to migrate" — no spurious diff, confirming 0001/0003 snapshots are regenerated and the lineage is clean
  2. Migration 0005 applies cleanly in the Docker test suite: `episodic_summaries` table exists with `UNIQUE(summary_date)`, `GIN(topics)`, and `btree(importance)` — all three indexes present in the initial migration, not retrofitted
  3. `import { EpisodicSummary } from 'src/episodic/types.ts'` compiles without error; `EpisodicSummary.parse({})` throws a Zod validation error (confirming Zod schema is live)
  4. `config.episodicCron` is accessible at runtime with default value `"0 23 * * *"` — type-checked, no TypeScript errors
  5. The 152-test Docker Postgres gate remains green after the schema change
**Plans**: TBD

### Phase 21: Consolidation Engine
**Goal**: Chris can generate a structurally correct, anti-sycophantic, verbatim-grounded episodic summary for any given calendar date, with importance scores calibrated by rubric and floor hooks, and surface Telegram notification on failure.
**Depends on**: Phase 20
**Requirements**: CONS-01, CONS-02, CONS-03, CONS-04, CONS-05, CONS-06, CONS-07, CONS-08, CONS-09, CONS-10, CONS-11, CONS-12
**Success Criteria** (what must be TRUE):
  1. Calling `runConsolidate(date)` on a day with zero Pensieve entries produces no Sonnet API call and no database row — confirmed by log output and DB query
  2. Calling `runConsolidate(date)` twice for the same date with entries present inserts exactly one row: the second call returns `{ skipped: true }` without any Sonnet API call
  3. A unit test verifies the assembled consolidation system prompt contains the M006 constitutional preamble's anti-sycophancy clauses — the preamble is explicitly present, not assumed from engine context
  4. A fixture day containing a structural M007 decision produces a summary with `importance >= 6`; a fixture day containing an M002 contradiction (confidence >= 0.75) produces a summary with `importance >= 7`, and the summary text or key_quotes preserves both contradicting positions verbatim rather than smoothing them into a single narrative
  5. A fixture day with fewer than 3 entries uses the sparse-entry variant prompt and the resulting summary contains no specifics not traceable to the source entries
**Plans**: 4 plans
  - [ ] 21-01-PLAN.md — SDK bump to @anthropic-ai/sdk ^0.90.0 + export CONSTITUTIONAL_PREAMBLE from personality.ts (CONS-04 seed)
  - [ ] 21-02-PLAN.md — Prompt assembler in src/episodic/prompts.ts (CONS-04, 05, 09, 10, 11)
  - [ ] 21-03-PLAN.md — Read-only source queries in src/episodic/sources.ts (CONS-08, CONS-09 data layer)
  - [ ] 21-04-PLAN.md — runConsolidate() end-to-end in src/episodic/consolidate.ts + Telegram error notifier (CONS-01, 02, 03, 06, 07, 12)

### Phase 22: Cron + Retrieval Routing
**Goal**: The daily consolidation fires automatically at 23:00 in Greg's timezone without interfering with the proactive sweep; queries to Chris route to raw entries or episodic summaries based on recency and query intent; INTERROGATE mode injects date-anchored summaries; summary text is provably absent from Known Facts and pensieve_embeddings.
**Depends on**: Phase 21
**Requirements**: CRON-01, CRON-02, RETR-01, RETR-02, RETR-03, RETR-04, RETR-05, RETR-06
**Success Criteria** (what must be TRUE):
  1. The cron is registered as an independent `cron.schedule()` call in `src/index.ts` — grepping the file shows it is not nested inside `runSweep` or any other cron handler
  2. A query about an event from 3 days ago returns raw Pensieve entries; a query about an event from 10 days ago returns the episodic summary for that period; a query containing "what exactly did I say" or equivalent verbatim-fidelity keywords returns raw entries regardless of age
  3. A query against a day with a summary of `importance >= 8` returns both the summary and the underlying raw source entries
  4. An INTERROGATE-mode query mentioning a date or period older than 7 days injects matching episodic summaries into the context block — confirmed by a unit test on `interrogate.ts`
  5. `grep` of `src/pensieve/known-facts.ts` (or equivalent) contains no JOIN or SELECT referencing `episodic_summaries`; `grep` of the insert path for `pensieve_embeddings` contains no reference to `episodic_summaries`
**Plans**: TBD

### Phase 23: Test Suite + Backfill + `/summary`
**Goal**: The consolidation pipeline is validated end-to-end by a deterministic 14-day synthetic fixture; Greg can run a backfill for all days since M007 went live; and Greg can inspect any day's episodic summary via Telegram command.
**Depends on**: Phase 22
**Requirements**: TEST-15, TEST-16, TEST-17, TEST-18, TEST-19, TEST-20, TEST-21, TEST-22, OPS-01, CMD-01
**Success Criteria** (what must be TRUE):
  1. The 14-day synthetic fixture runs to completion in Docker with zero calendar time: all eight test cases pass (importance correlation r > 0.7, recency routing, DST boundary, idempotency retry, decision-day floor, contradiction dual-position, live anti-flattery gated on API key, sparse-entry no-hallucination)
  2. Running `scripts/backfill-episodic.ts --from 2026-04-13 --to 2026-04-17` on a clean database inserts one row per calendar date that had Pensieve entries, skips dates with no entries, and running it a second time produces zero new inserts (idempotent)
  3. Sending `/summary` in Telegram returns yesterday's episodic summary; sending `/summary 2026-04-15` returns that specific date's summary; sending `/summary` for a date with no entries returns a clear "no summary for that date" message — not an error
  4. The Docker Postgres test gate count is higher than 152 (new fixture tests added to the passing suite)
**Plans**: TBD
**UI hint**: yes

---

**Pause Gate — M009 Prerequisite:** After Phase 23 is complete and deployed, wait for at least 7 real episodic summaries to accumulate in production before starting M009. The weekly review (M009) consumes daily summaries as substrate — running it before real summaries exist produces empty output with no informational value.

## Progress

| Phase                              | Milestone | Plans | Status      | Completed |
|------------------------------------|-----------|-------|-------------|-----------|
| 1. Foundation                      | v1.0      | -     | Complete    | 2026-04-13 |
| 2. Depth                           | v1.0      | -     | Complete    | 2026-04-13 |
| 3. External Sources                | v1.0      | -     | Complete    | 2026-04-13 |
| 4. Proactive Chris                 | v1.0      | -     | Complete    | 2026-04-13 |
| 5. Requirement Validation          | v1.0      | -     | Complete    | 2026-04-13 |
| 6. Memory Audit                    | v2.0      | 5/5   | Complete    | 2026-04-13 |
| 7. Foundational Behavioral Fixes   | v2.0      | 4/4   | Complete    | 2026-04-13 |
| 8. Retrieval & Grounding           | v2.0      | 2/2   | Complete    | 2026-04-13 |
| 9. Praise Quarantine               | v2.0      | 2/2   | Complete    | 2026-04-13 |
| 10. Live Validation Suite          | v2.0      | 2/2   | Complete    | 2026-04-14 |
| 11. Identity Grounding             | v2.0      | 3/3   | Complete    | 2026-04-15 |
| 12. Identity rename residuals      | v2.0      | 1/1   | Complete    | 2026-04-15 |
| 13. Schema & Lifecycle Primitives  | v2.1      | 5/5   | Complete    | 2026-04-15 |
| 14. Capture Flow                   | v2.1      | 5/5   | Complete    | 2026-04-16 |
| 15. Deadline Trigger & Sweep       | v2.1      | 3/3   | Complete    | 2026-04-16 |
| 16. Resolution + ACCOUNTABILITY    | v2.1      | 5/5   | Complete    | 2026-04-16 |
| 17. `/decisions` & Accuracy Stats  | v2.1      | 3/3   | Complete    | 2026-04-16 |
| 18. Synthetic + Live Suite         | v2.1      | 4/2   | Complete    | 2026-04-16 |
| 19. Proactive Pipeline Restoration | v2.1      | 4/4   | Complete    | 2026-04-17 |
| 20. Schema + Tech Debt             | v2.2      | 0/TBD | Not started | -          |
| 21. Consolidation Engine           | v2.2      | 0/4   | Planned     | -          |
| 22. Cron + Retrieval Routing       | v2.2      | 0/TBD | Not started | -          |
| 23. Test Suite + Backfill + /summary | v2.2    | 0/TBD | Not started | -          |
