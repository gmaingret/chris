---
phase: 28
slug: skip-tracking-adjustment-dialogue
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-29
---

# Phase 28 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Filled by gsd-planner from `28-RESEARCH.md` Validation Architecture section + per-plan `<automated>` task acceptance criteria.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (Node, ESM) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run --reporter=basic <file-pattern>` |
| **Full suite command** | `./scripts/test.sh` (boots Docker postgres, applies migrations, runs full vitest + integration) |
| **Estimated runtime** | quick: ~5s, full: ~90s |

---

## Sampling Rate

- **After every task commit:** Run targeted `pnpm vitest run` for the touched module's `__tests__/` directory
- **After every plan wave:** Run `./scripts/test.sh` (real-postgres integration gate)
- **Before `/gsd-verify-work`:** Full suite must be green; migration 0010 must apply cleanly to fresh Docker postgres
- **Max feedback latency:** 90 seconds (full suite); 5 seconds (per-task quick run)

---

## Per-Task Verification Map

> Filled in by planner once per-plan tasks are authored. Each task in a `*-PLAN.md` file MUST appear here with its automated command. Manual rows allowed only when listed in "Manual-Only Verifications" below.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD     | TBD  | TBD  | TBD         | TBD        | TBD             | TBD       | TBD               | ❌ W0       | ⬜ pending |

---

## Wave 0 Requirements

- [ ] **Migration 0010** — `src/db/migrations/0010_adjustment_dialogue.sql` adds `ritual_pending_responses.metadata jsonb` + index on `(metadata->>'kind', expires_at)` (unblocks Plan 28-03 + 28-04)
- [ ] **Test fixtures** — `src/rituals/__tests__/fixtures/skip-tracking.ts` exporting `seedRitualWithFireEvents(outcomes[])` helper for synthetic skip sequences
- [ ] **Integration test scaffolding** — `src/rituals/__tests__/skip-tracking.integration.test.ts`, `src/rituals/__tests__/adjustment-dialogue.integration.test.ts`, `src/rituals/__tests__/refusal-pre-check.integration.test.ts`
- [ ] **Anti-flattery scaffold extension** (Phase 30 hook) — extend `tests/live/anti-flattery.test.ts` with skipIf-gated `describe.skip("adjustment-dialogue evasive classification")` placeholder so Phase 30 can flip it on without re-architecting

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 60-second confirmation window in production timezone (Europe/Paris) | SKIP-05 | Cron tick cadence is wallclock — `vi.setSystemTime` covers logic but real-clock interaction with Telegram delivery requires post-deploy observation | After deploy, set a daily ritual to high-skip-count via direct DB write, observe adjustment dialogue fires at next sweep, reply "yes", confirm config patch lands in `ritual_config_events` within 60s of reply |
| Live Sonnet/Haiku evasive classification accuracy | SKIP-04 | Real-LLM behavior requires API spend; deferred to Phase 30 TEST-31 anti-flattery extension | Phase 30 will run 3-of-3 atomic test against real Haiku with adversarial evasive replies |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (migration 0010, fixtures, integration test files)
- [ ] No watch-mode flags (vitest run, NOT vitest watch)
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter
- [ ] All 4 success criteria from ROADMAP.md have at least one falsifiable automated test (per-criterion mapping documented in 28-RESEARCH.md Validation Architecture section)

**Approval:** pending
