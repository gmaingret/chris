# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15) — see [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)
- ✅ **v2.1 M007 Decision Archive** — Phases 13-19 (shipped 2026-04-18) — see [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md)
- ✅ **v2.2 M008 Episodic Consolidation** — Phases 20-23 + 22.1 (shipped 2026-04-19) — see [milestones/v2.2-ROADMAP.md](milestones/v2.2-ROADMAP.md)

**Pause Gate — M009 Prerequisite:** After v2.2 deploy, wait for at least 7 real episodic summaries to accumulate in production before starting M009 (weekly review consumes daily summaries as substrate — running it before real summaries exist produces empty output with no informational value). Operator action post-deploy: `tsx scripts/backfill-episodic.ts --from <M007-deploy-date> --to <yesterday>`.

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
