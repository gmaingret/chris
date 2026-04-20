# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15) — see [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)
- ✅ **v2.1 M007 Decision Archive** — Phases 13-19 (shipped 2026-04-18) — see [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md)
- ✅ **v2.2 M008 Episodic Consolidation** — Phases 20-23 + 22.1 (shipped 2026-04-19) — see [milestones/v2.2-ROADMAP.md](milestones/v2.2-ROADMAP.md)
- 🚧 **v2.3 Test Data Infrastructure** *(pre-M009 enabler, single-phase)* — Phase 24 (active, roadmap written 2026-04-20) — see `M008.5_Test_Data_Infrastructure.md` spec + `.planning/REQUIREMENTS.md`

**Pause Gate — M009 Prerequisite:** v2.3 removes the "wait for 7 real episodic summaries" gate by providing the primed-fixture pipeline. After v2.3 ships, M009 planning can start immediately (primed fixture supplies ≥ 7 summaries on demand).

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
- [x] **Phase 18: Synthetic Fixture + Live Suite** — Single `vi.setSystemTime` fixture covering concurrency + collision + stale-context; live Sonnet ACCOUNTABILITY suite (4/2 plans — 2 gap-closure plans) — completed 2026-04-16
- [x] **Phase 19: Proactive Pipeline Restoration** — Gap closure for v2.1 audit: byte-exact restore of `sweep.ts`, channel-aware/escalation helpers, ACCOUNTABILITY prompts from canonical `4c156c3` (lost in worktree merge `5582442`); TEST-12 realignment (4/4 plans) — completed 2026-04-17

See [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md) for full phase detail.

</details>

<details>
<summary>✅ v2.2 Phases 20-23 + 22.1 — SHIPPED 2026-04-19</summary>

- [x] **Phase 20: Schema + Tech Debt** — TECH-DEBT-19-01 drizzle snapshot regeneration + `episodic_summaries` migration 0005 with all three indexes + Zod 3-layer type chain + `config.episodicCron` + test coverage (3/3 plans) — completed 2026-04-18
- [x] **Phase 21: Consolidation Engine** — `runConsolidate` end-to-end: CONSTITUTIONAL_PREAMBLE injection (CONS-04), 4-band rubric + frequency + chain-of-thought (CONS-05), runtime importance floors for real decisions (CONS-06) and contradictions (CONS-07), day-bounded Drizzle sources via Luxon (CONS-08/09), verbatim-quote enforcement (CONS-10), sparse-entry guard (CONS-11), Telegram error notify (CONS-12), pre-flight SELECT + ON CONFLICT idempotency (CONS-03) (4/4 plans, all 12 CONS requirements) — completed 2026-04-18
- [x] **Phase 22: Cron + Retrieval Routing** — Independent DST-safe cron at 23:00 local as peer to proactive sweep (CRON-01/02); `retrieveContext` orchestrator with 5 named RoutingReason literals — recency boundary ≤7d / >7d + verbatim-keyword EN/FR/RU fast-path + high-importance raw descent at importance≥8 (RETR-01/02/03); INTERROGATE date-anchored summary injection via three-tier regex + Haiku fallback gated on 49-keyword heuristic (RETR-04); boundary audit enforces Known Facts + `pensieve_embeddings` never reference `episodic_summaries` (RETR-05/06) (5/5 plans, all 8 RETR/CRON requirements) — completed 2026-04-19
- [x] **Phase 22.1: Wire `retrieveContext` into chat-mode handlers (INSERTED — gap closure)** — Wires JOURNAL/REFLECT/COACH/PSYCHOLOGY/PRODUCE to `retrieveContext` via new `hybridOptions` passthrough + `summaryToSearchResult` adapter export; 15 regression tests (3 per mode × 5 modes) prove routing decision fires; INTERROGATE + `/summary` byte-identical bypass preserved (1/1 plan, 0 new requirements — closes audit tech_debt for RETR-02/03 wiring) — completed 2026-04-19
- [x] **Phase 23: Test Suite + Backfill + `/summary`** — 14-day synthetic fixture with Pearson r > 0.7 (TEST-15/16), routing branches a/b/c/d (TEST-17), DST spring-forward (TEST-18), idempotency (TEST-19), decision-day floor (TEST-20), contradiction dual-position (TEST-21); `scripts/backfill-episodic.ts` operator script with --from/--to + continue-on-error (OPS-01); `/summary [YYYY-MM-DD]` Telegram command with yesterday default + EN/FR/RU localization + Luxon ISO validity gate (CMD-01); TEST-22 live anti-flattery 3-of-3 atomic against real Sonnet on adversarial 2026-02-14 fixture — zero flattery markers across 3 iterations, empirical proof M006 preamble end-to-end functional in consolidation (4/4 plans, all 10 requirements) — completed 2026-04-19

See [milestones/v2.2-ROADMAP.md](milestones/v2.2-ROADMAP.md) for full phase detail.

</details>

### v2.3 Test Data Infrastructure — ACTIVE

- [ ] **Phase 24: Primed-Fixture Pipeline** — Build the organic+synthetic test-data pipeline (fetch from prod → synthesize delta → load into Docker Postgres) so every downstream milestone (M009–M014) can be validated on demand, without real-calendar-time data-accumulation gates.

## Phase Details

### Phase 24: Primed-Fixture Pipeline

**Goal:** An operator can produce a fused organic+synthetic test fixture — anchored in real prod data pulled from Proxmox (192.168.1.50), extended with deterministic synthetic days via Haiku style-transfer + real `runConsolidate()` episodic synthesis — and load it into the Docker Postgres test DB through `loadPrimedFixture(name)`. The pipeline auto-refreshes stale snapshots (> 24h) silently, is seed-reproducible (VCR-cached Anthropic outputs), and is documented in `TESTING.md` with a new project convention banning calendar-time data-accumulation gates in subsequent milestones.

**Depends on:** v2.2 M008 (shipped) — relies on `src/episodic/consolidate.ts` `runConsolidate()`, `src/decisions/resolution.ts` `handleResolution`, and migration 0005 `episodic_summaries` as the integration substrate.

**Requirements:** FETCH-01..05, SYNTH-01..07, HARN-01..03, FRESH-01..03, DOC-01..02 (20 total).

**Success Criteria** (what must be TRUE when phase completes):

1. **Operator can run `npx tsx scripts/fetch-prod-data.ts` and produce a valid snapshot in under 60s.** The script SSHes to Proxmox (192.168.1.50) using existing operator auth, dumps 9 tables (`pensieve_entries` filtered to `source='telegram'` only, `pensieve_embeddings` scoped to those IDs, `episodic_summaries`, `decisions`, `decision_events`, `decision_capture_state`, `contradictions`, `proactive_state`, `memories`) as JSONL with stable ordering under `tests/fixtures/prod-snapshot/<ISO8601>/`, updates the `LATEST` symlink, and exits 0.

2. **Operator can run `npx tsx scripts/synthesize-delta.ts --organic <stamp> --target-days 14 --seed 42 --milestone m009` and produce a primed fixture with ≥ 7 episodic summaries and ≥ 200 pensieve entries.** Pensieve deltas are generated via Haiku style-transfer per synthetic day (few-shot from organic base); episodic summaries are produced by running the real `runConsolidate(date)` against each synthetic day; deterministic generators produce decisions, contradictions, and wellbeing snapshots. Fixture written under `tests/fixtures/primed/<milestone>-<N>days/`.

3. **Re-running `synthesize-delta.ts` with the same `--seed` against the same organic base produces byte-identical non-LLM output** (diff-clean), with Anthropic outputs captured VCR-style on first run and replayed on subsequent runs. `regenerate-primed.ts --force` rebuilds everything from scratch (fetch + synthesize + VCR rebuild) independent of stamp age.

4. **When `tests/fixtures/prod-snapshot/LATEST` is older than 24 hours, `synthesize-delta.ts` and `regenerate-primed.ts` silently auto-refresh the snapshot by invoking `fetch-prod-data.ts` before proceeding** — no warnings, no half-stale runs. `--no-refresh` opt-out is honored for offline/sandbox workflows.

5. **A sanity-check Vitest integration test (`fileParallelism: false`, Docker Postgres) loads an `m008-14days` primed fixture via `loadPrimedFixture(name)` and passes assertions:** ≥ 7 days of summaries exist, ≥ 200 pensieve entries loaded, `UNIQUE(summary_date)` holds, no `source='immich'`/`source='gmail'`/`source='drive'` leakage, and `loadPrimedFixture` clears target tables in FK-safe order before load (idempotent + collision-safe across repeated calls). `TESTING.md` is updated with the primed-fixture pattern and the new convention (*"no milestone may gate on real calendar time for data accumulation"*) is codified in `PROJECT.md` and/or `.planning/codebase/CONVENTIONS.md`.

**Plans:**

- **24-01 — Fetch script + snapshot schema + gitignore + freshness hook**
  - Build `scripts/fetch-prod-data.ts`: SSH to Proxmox, dump 9 tables (`source='telegram'` filter on pensieve_entries, scoped embeddings, episodic, decisions trio, contradictions, proactive_state, memories), emit JSONL with stable sort order to `tests/fixtures/prod-snapshot/<ISO8601>/`, update `LATEST` symlink, exit 0.
  - Add `tests/fixtures/prod-snapshot/` to `.gitignore`.
  - Build the freshness-check helper (`isSnapshotStale(path, ttlHours)`) used by FRESH-01 consumers in plans 24-02 and 24-04.
  - **Requirements covered:** FETCH-01, FETCH-02, FETCH-03, FETCH-04, FETCH-05, FRESH-01.

- **24-02 — Synthetic delta generator (pensieve + decisions + contradictions + wellbeing + VCR)**
  - Build `scripts/synthesize-delta.ts --organic <stamp> --target-days N --seed NN --milestone <name>`: CLI parsing + freshness auto-refresh invocation + per-day Haiku style-transfer (few-shot from randomly sampled organic telegram entries, seed-controlled) producing synthetic pensieve entries with realistic UTC+1/+2 timestamps and `source='telegram'`.
  - Deterministic generators for N synthetic decisions (realistic `resolve_by` spread; optional resolution replies + real `handleResolution` invocation when milestone needs resolved decisions), N pre-written adversarial contradiction pairs (`status='DETECTED'`, `confidence >= 0.75`), and N wellbeing snapshots (1–5 distribution; codes against whatever table exists — M009 may add the schema).
  - VCR-style cache for Anthropic outputs (first run records, subsequent runs replay). `--no-refresh` flag honored.
  - **Requirements covered:** SYNTH-01, SYNTH-02, SYNTH-04, SYNTH-05, SYNTH-06, SYNTH-07, FRESH-02.

- **24-03 — Real-engine episodic synthesis pass**
  - Extend `synthesize-delta.ts` (or introduce a sibling module it calls) to run the real `runConsolidate(date)` from `src/episodic/consolidate.ts` against each synthetic day, writing authentic Sonnet-generated episodic summaries into the fixture output. Costs ~$0.02/day of real Anthropic spend; outputs captured under the VCR cache from plan 24-02 so subsequent runs are free.
  - Verify UNIQUE(summary_date) + `source='telegram'` filter contract hold end-to-end on synthetic input (the engine under test produces the fixture's summaries, not a mock).
  - **Requirements covered:** SYNTH-03.

- **24-04 — Test-harness loader + regenerate script + docs + convention**
  - Build `src/__tests__/fixtures/load-primed.ts` exporting `loadPrimedFixture(name)`: reads a primed fixture directory, clears target tables in FK-safe order (conversations → contradictions → pensieve_embeddings → episodic_summaries → decision_events → decision_capture_state → decisions → pensieve_entries → proactive_state → memories), bulk-inserts in dependency order, idempotent + collision-safe across repeated calls in one suite.
  - Write the sanity-check Vitest integration test under `fileParallelism: false` that loads `m008-14days` and asserts ≥ 7 summaries, ≥ 200 pensieve entries, `UNIQUE(summary_date)` holds, no non-telegram source leakage.
  - Build `scripts/regenerate-primed.ts --milestone <name> --force`: fetch → synthesize → VCR cache rebuild, independent of stamp age. `--no-refresh` honored for the synth step only.
  - Update `.planning/codebase/TESTING.md` with the organic+synthetic primed-fixture pattern, `loadPrimedFixture(name)` usage, and the 24h freshness policy. Add new convention to `PROJECT.md` and/or `.planning/codebase/CONVENTIONS.md`: *"no milestone may gate on real calendar time for data accumulation — use the primed-fixture pipeline instead."*
  - **Requirements covered:** HARN-01, HARN-02, HARN-03, FRESH-03, DOC-01, DOC-02.

---

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
| 20. Schema + Tech Debt             | v2.2      | 3/3   | Complete    | 2026-04-18 |
| 21. Consolidation Engine           | v2.2      | 4/4   | Complete    | 2026-04-18 |
| 22. Cron + Retrieval Routing       | v2.2      | 5/5   | Complete    | 2026-04-19 |
| 22.1. Wire retrieveContext (INSERTED) | v2.2   | 1/1   | Complete    | 2026-04-19 |
| 23. Test Suite + Backfill + /summary | v2.2    | 4/4   | Complete    | 2026-04-19 |
| 24. Primed-Fixture Pipeline        | v2.3      | 3/4   | In progress | —          |
