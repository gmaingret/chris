# Roadmap: Project Chris

## Milestones

- ✅ **v1.0 Living Memory through Validation** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v2.0 M006 Trustworthy Chris** — Phases 6-12 (shipped 2026-04-15) — see [milestones/v2.0-ROADMAP.md](milestones/v2.0-ROADMAP.md)
- ✅ **v2.1 M007 Decision Archive** — Phases 13-19 (shipped 2026-04-18) — see [milestones/v2.1-ROADMAP.md](milestones/v2.1-ROADMAP.md)
- 📋 **v2.2 / M008 Episodic Consolidation** — planned (pause ≥2 weeks of real M007 use first)

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

### 📋 v2.2 / M008 Episodic Consolidation (Planned)

Next up per the soul-system execution order. Pause ≥2 weeks of real M007 Telegram use before starting, per between-phases pause discipline (PLAN.md line 274-281). Use `/gsd-new-milestone` to begin.

## Progress

| Phase                             | Milestone | Plans | Status       | Completed  |
| --------------------------------- | --------- | ----- | ------------ | ---------- |
| 1. Foundation                     | v1.0      | -     | Complete     | 2026-04-13 |
| 2. Depth                          | v1.0      | -     | Complete     | 2026-04-13 |
| 3. External Sources               | v1.0      | -     | Complete     | 2026-04-13 |
| 4. Proactive Chris                | v1.0      | -     | Complete     | 2026-04-13 |
| 5. Requirement Validation         | v1.0      | -     | Complete     | 2026-04-13 |
| 6. Memory Audit                   | v2.0      | 5/5   | Complete     | 2026-04-13 |
| 7. Foundational Behavioral Fixes  | v2.0      | 4/4   | Complete     | 2026-04-13 |
| 8. Retrieval & Grounding          | v2.0      | 2/2   | Complete     | 2026-04-13 |
| 9. Praise Quarantine              | v2.0      | 2/2   | Complete     | 2026-04-13 |
| 10. Live Validation Suite         | v2.0      | 2/2   | Complete     | 2026-04-14 |
| 11. Identity Grounding            | v2.0      | 3/3   | Complete     | 2026-04-15 |
| 12. Identity rename residuals     | v2.0      | 1/1   | Complete     | 2026-04-15 |
| 13. Schema & Lifecycle Primitives | v2.1      | 5/5   | Complete     | 2026-04-15 |
| 14. Capture Flow                  | v2.1      | 5/5   | Complete     | 2026-04-16 |
| 15. Deadline Trigger & Sweep      | v2.1      | 3/3   | Complete     | 2026-04-16 |
| 16. Resolution + ACCOUNTABILITY   | v2.1      | 5/5   | Complete     | 2026-04-16 |
| 17. `/decisions` & Accuracy Stats | v2.1      | 3/3   | Complete     | 2026-04-16 |
| 18. Synthetic + Live Suite        | v2.1      | 4/2   | Complete     | 2026-04-16 |
| 19. Proactive Pipeline Restoration | v2.1     | 4/4   | Complete     | 2026-04-17 |
