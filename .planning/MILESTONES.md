# Milestones

## v2.1 M007 Decision Archive (Shipped: 2026-04-18)

**Phases completed:** 7 phases (13–19), 27 plans, 36 tasks
**Timeline:** 2026-04-15 → 2026-04-18 (3 days active work)
**Requirements:** 31 / 31 satisfied
**Git range:** 252 commits since v2.0 (`c20d66e` → `2abc2c9`) — +9,322 / -379 LOC across 49 files
**Audit:** passed (2026-04-18T06:16Z) — 4 / 4 Critical + 30 / 30 Warning code-review findings resolved; 3 Phase 13 Info items documented as intentional deferrals
**Test evidence:** 152 / 152 Docker Postgres proactive + synthetic-fixture tests pass (4.19s)

**Goal:** Capture every structural decision Greg makes with reasoning and a falsifiable forecast, surface the forecast at its resolution date, and run a post-mortem — converting Chris from reflective journal into epistemic accountability tool.

**Key accomplishments:**

- **Phase 13 — Schema & Lifecycle Primitives** — Append-only `decision_events` log, `decisions` projection, and `decision_capture_state` capture session. `transitionDecision(id, fromStatus, toStatus, payload)` is the sole chokepoint for `decisions.status` mutation, using optimistic concurrency (`UPDATE … WHERE id=$id AND status=$expected`) and three distinguishable error classes (`InvalidTransitionError`, `OptimisticConcurrencyError`, `DecisionNotFoundError`). `regenerateDecisionFromEvents(id)` proves the projection is replayable from the event log.
- **Phase 14 — Capture Flow** — Two-phase trigger detection (EN/FR/RU regex + Haiku `trivial`/`moderate`/`structural` stakes classifier) with fail-closed behavior. Conversational 5-slot Haiku extraction (greedy multi-answer consolidation, 3-turn cap, EN/FR/RU abort phrases). `parseResolveBy` natural-language timeframe parser with 7/30/90/365-day fallback ladder. `/decisions suppress <phrase>` persistence with case-insensitive substring match. Engine pre-processors PP#0 and PP#1 wired before mute/refusal/language/mode detection.
- **Phase 15 / 19 — Dual-Channel Sweep** — Fifth SQL-first trigger (`decision-deadline`, priority 2) added to the existing `silence`/`commitment`/`pattern`/`thread` pipeline. Sweep split into independent `reflective_outreach` and `accountability_outreach` channels with per-channel daily caps and serial collision handling. Dated stale-context prompt when fired ≥48h past `resolve_by`. Write-before-send ordering via `upsertAwaitingResolution`. (Phase 19 restored Phase 15/16 artifacts lost in worktree merge `5582442`.)
- **Phase 16 — Resolution, Post-Mortem & ACCOUNTABILITY Mode** — New `ACCOUNTABILITY` mode bypasses the praise quarantine at the prompt level (D025 pattern) and forbids The Hard Rule (D027). `handleResolution` → `classifyOutcome` (Haiku 4-class fail-closed to `ambiguous`) → `handlePostmortem` → `resolved → reviewed` transition, with both replies stored as Pensieve entries linked via `source_ref_id`. ±48h `getTemporalPensieve` context and Popper criterion redisplay.
- **Phase 16 / 19 — Auto-Escalation** — Per-decision escalation tracking via `setEscalationSentAt` / `setEscalationCount` / `clearEscalationKeys`. Single 48h follow-up, silent `due → stale` transition after 2 non-replies, escalation block bypasses daily cap. (Phase 19 restored the escalation helpers and sweep block.)
- **Phase 17 — `/decisions` Command & Accuracy Stats** — 8 sub-commands wired (`open`, `recent`, `stats [30|90|365]`, `suppress`, `suppressions`, `unsuppress`, `reclassify`, dashboard), registered before the generic text handler, pull-only. 2-axis Haiku reasoning classifier (`outcome` × `reasoning`) cached at resolution time with model version string. N≥10 floor with Wilson 95% CI (`z = 1.96`) — no percentage below floor. SQL `FILTER (WHERE …)` rolling 30/90/365-day windows; `unverifiable` surfaced as a separate denominator. Domain-tag breakdown and `/decisions reclassify` preserving originals.
- **Phase 18 — Synthetic Fixture + Live Suite** — Single `vi.setSystemTime` fixture drives capture → deadline → resolution → post-mortem → stats over a simulated 14-day window with zero calendar time (TEST-10). Concurrency race test proves exactly one winner via optimistic concurrency (TEST-11). Channel-separation collision test (TEST-12, realigned in Phase 19-04 to the dual-channel contract). Live Sonnet ACCOUNTABILITY suite asserting absence-of-flattery and absence-of-condemnation (TEST-13, D023/D032 precedent) and Haiku vague-prediction resistance (TEST-14) — both gated on `ANTHROPIC_API_KEY` and deferred to human UAT.

**Deferred / tech debt:**

- **TECH-DEBT-19-01** — `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` missing. drizzle-kit does not backfill snapshots for already-applied entries. Runtime migrator (`scripts/test.sh`) applies `.sql` directly and does not consult the snapshots. Reactivation trigger: next phase that modifies `src/db/schema.ts`.
- **Phase 13 Info deferrals** — 3 items documented `Fix: None required` in `13-REVIEW.md`: hardcoded `localtest123` password in test harness, raw `psql` vs Drizzle migrator in `scripts/test.sh`, hyphenated enum value `open-draft` (locked by D-04).
- **Live-API UAT pending** — TEST-13 (live ACCOUNTABILITY hit/miss/unverifiable × 3-of-3) and TEST-14 (vague-validator adversarial) tests are written and Docker-verified for non-API paths, but 3-of-3 Sonnet / live Haiku execution requires a human run with `ANTHROPIC_API_KEY`. 12 human-UAT items across Phases 14/16/17/18 similarly deferred (Telegram UX feel, tone quality, localization, live API runs).
- **Pre-existing baseline failures out of v2.1 scope** — 45 `engine.test.ts` mock-chain failures introduced by an earlier partial restore of `engine.ts` PP#0 block (proven pre-existing via rollback+rerun in Plan 19-01 evidence); 49 live-LLM env failures requiring `ANTHROPIC_API_KEY` + HuggingFace cache permissions.

**Summary-frontmatter hygiene:** Several plan-level SUMMARY.md files omit the `one_liner:` / `requirements-completed:` frontmatter fields (14-04, 15-01, 15-02, 16-01/02/04, 17-01/02/03, 18-01/03/04). Requirements are nevertheless corroborated as SATISFIED in each phase's VERIFICATION.md with direct code/test evidence. Non-blocking; noted for future audit ergonomics.

---

*Archived: `milestones/v2.1-ROADMAP.md`, `milestones/v2.1-REQUIREMENTS.md`, `milestones/v2.1-MILESTONE-AUDIT.md`, `milestones/v2.1-INTEGRATION-CHECK.md`, `milestones/v2.1-phases/` (phase directories).*

---
