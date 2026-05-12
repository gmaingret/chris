---
phase: 34
slug: inference-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-12
---

# Phase 34 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `34-RESEARCH.md` § Validation Architecture (lines 148–188).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (project standard, configured at `vitest.config.ts`) |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `bash scripts/test.sh <test-file-path>` (single file, ~5–15s after Docker postgres warm) |
| **Full suite command** | `bash scripts/test.sh` (Docker postgres on 5433 + full vitest run) |
| **Estimated runtime** | Per-file: 5–15s; full suite: ~3–5min (1412 tests target) |

---

## Sampling Rate

- **After every task commit:** Run `bash scripts/test.sh <affected-test-file>` for the touched test file
- **After every plan wave:** Run `bash scripts/test.sh src/memory/` + `bash scripts/test.sh src/rituals/__tests__/cron-registration.test.ts` + config test (~30s)
- **Before `/gsd-verify-work`:** Full Docker suite green — per CLAUDE.md `feedback_always_run_docker_tests.md` ("Always run full Docker tests; never skip integration tests")
- **Max feedback latency:** 30 seconds per wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 34-01-01 | 01 | 1 | GEN-04 | M010-06 | `DO_NOT_INFER_DIRECTIVE` constant ships with explicit "do-not-infer" phrasing — Sonnet cannot derive facts from related-but-distinct entries | structural (pure-function) | `bash scripts/test.sh src/memory/__tests__/profile-prompt.test.ts` | ❌ W0 | ⬜ pending |
| 34-01-02 | 01 | 1 | GEN-04 | M010-06 | `assembleProfilePrompt` output starts with `## Core Principles (Always Active)` (CONSTITUTIONAL_PREAMBLE) for all 4 dimensions | structural (parametrized over dimensions) | `bash scripts/test.sh src/memory/__tests__/profile-prompt.test.ts` | ❌ W0 | ⬜ pending |
| 34-01-03 | 01 | 1 | GEN-04 | M010-03 | Previous-state injection present when prevState non-null; absent when prevState null | structural | `bash scripts/test.sh src/memory/__tests__/profile-prompt.test.ts` | ❌ W0 | ⬜ pending |
| 34-01-04 | 01 | 1 | GEN-04 | M010-01 | Volume-weight ceiling phrasing references `data_consistency` field (not `confidence`) | structural | `bash scripts/test.sh src/memory/__tests__/profile-prompt.test.ts` | ❌ W0 | ⬜ pending |
| 34-02-01 | 02 | 2 | GEN-03 | M010-02 | `loadProfileSubstrate` filters Pensieve entries by tag union (FACT/RELATIONSHIP/INTENTION/EXPERIENCE) — verifies `inArray` clause hits correct enum values | integration (real Docker Postgres) | `bash scripts/test.sh src/memory/profiles/__tests__/shared.test.ts` | ❌ W0 | ⬜ pending |
| 34-02-02 | 02 | 2 | GEN-06 | M010-04 | `entryCount < 10` short-circuits before Sonnet call; logs `chris.profile.threshold.below_minimum` verbatim | integration (sparse fixture, `expect(mockAnthropicParse).not.toHaveBeenCalled()`) | `bash scripts/test.sh src/memory/profiles/__tests__/generators.sparse.test.ts` | ❌ W0 | ⬜ pending |
| 34-02-03 | 02 | 2 | GEN-07 | M010-09 + M010-10 | Two-cycle hash idempotency: Cycle 1 (4 Sonnet calls) → +7d identical substrate (still 4 total) → +14d mutated substrate via NEW Pensieve entry (5+ calls). Cycle 3 mutation MUST be an INSERT (new ID), not text edit on existing row | integration (real Docker Postgres + mocked Sonnet + `vi.setSystemTime`) | `bash scripts/test.sh src/memory/profiles/__tests__/generators.two-cycle.test.ts` | ❌ W0 (HARD CO-LOC #M10-3) | ⬜ pending |
| 34-02-04 | 02 | 2 | GEN-07 | M010-09 | `profile_history` row count = 4 after Cycle 1, still 4 after Cycle 2 (no row on skip), 5+ after Cycle 3 (one update wrote a snapshot) | integration row-count assertion (same test as 34-02-03) | `bash scripts/test.sh src/memory/profiles/__tests__/generators.two-cycle.test.ts` | ❌ W0 | ⬜ pending |
| 34-02-05 | 02 | 2 | GEN-03 (overlay) | M010-01 | Volume-weight ceiling Zod `.refine()` rejects `data_consistency > 0.5 && entryCount < 20` — closure-captured per-fire, NOT a module-level constant | unit (inline test in generator file or `schemas.refine.test.ts`) | `bash scripts/test.sh src/memory/profiles/__tests__/refine.test.ts` | ❌ W0 | ⬜ pending |
| 34-03-01 | 03 | 3 | GEN-02 | M010-04 | `updateAllOperationalProfiles` Promise.allSettled isolates per-generator failure: one simulated throw, other three complete; each outcome logged discriminately | integration (mocked Sonnet, one generator throws) | `bash scripts/test.sh src/memory/__tests__/profile-updater.test.ts` | ❌ W0 | ⬜ pending |
| 34-03-02 | 03 | 3 | GEN-01 | M010-04 | Cron schedule called with `'0 22 * * 0'` and `Europe/Paris` timezone; `CronRegistrationStatus.profileUpdate === 'registered'` after register | unit (`vi.mock('node-cron')` + schedule spy) | `bash scripts/test.sh src/rituals/__tests__/cron-registration.test.ts` | ✓ existing — EXTEND | ⬜ pending |
| 34-03-03 | 03 | 3 | GEN-01 | M010-04 | `/health` endpoint reports `profile_cron_registered: true` after successful registration | unit (createApp with injected cronStatus or extension to existing health test) | `bash scripts/test.sh src/__tests__/index.health.test.ts` | partial — EXTEND existing | ⬜ pending |
| 34-03-04 | 03 | 3 | GEN-01 | M010-04 | Config fail-fast on invalid `profileUpdaterCron` env value (env-var cache-bust pattern) | unit | `bash scripts/test.sh src/__tests__/config.test.ts` | ✓ existing — EXTEND | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity check:** No 3 consecutive tasks lack automated verification. Every row above has an `Automated Command`.

---

## Wave 0 Requirements

Wave 0 = test scaffolding to be created before/with implementation:

- [ ] `src/memory/__tests__/profile-prompt.test.ts` — covers GEN-04 (Plan 34-01, 4 task-level assertions)
- [ ] `src/memory/profiles/__tests__/shared.test.ts` — covers GEN-03 substrate loader (Plan 34-02)
- [ ] `src/memory/profiles/__tests__/generators.sparse.test.ts` — covers GEN-06 threshold (Plan 34-02)
- [ ] `src/memory/profiles/__tests__/generators.two-cycle.test.ts` — covers GEN-07 hash idempotency + history (Plan 34-02, HARD CO-LOC #M10-3 anchor)
- [ ] `src/memory/profiles/__tests__/refine.test.ts` — covers volume-weight ceiling Zod refine (Plan 34-02 overlay; M010-01)
- [ ] `src/memory/__tests__/profile-updater.test.ts` — covers GEN-02 orchestrator + Promise.allSettled isolation (Plan 34-03)
- [ ] Extension to `src/rituals/__tests__/cron-registration.test.ts` — covers GEN-01 cron registration
- [ ] Extension to `src/__tests__/config.test.ts` — covers GEN-01 config fail-fast

No framework install needed (vitest already configured at project root). Docker Postgres test-DB already running on port 5433.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Sonnet anti-hallucination (3-of-3 atomic) | GEN-03 quality | Cost discipline per D-30-03; ~$0.20/run; dual-gated by `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=…` | Deferred to Phase 36 PTEST-05 — explicitly OUT of Phase 34 scope (CONTEXT.md D-40) |
| First-fire production verification on Proxmox | full GEN-01..07 | Production cron fire is not test-reproducible — must observe Sunday 22:00 Paris fire from `chris-chris-1` container | After deploy: `ssh chris@192.168.1.50 'docker logs chris-chris-1 | grep chris.profile'` on first Sunday post-deploy ≥ 22:00 Paris; expect 4× `profile_*` log lines |

All other Phase 34 behaviors have automated verification above.

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies (13/13 rows above mapped)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (8 test files / extensions enumerated)
- [ ] No watch-mode flags (all `bash scripts/test.sh` invocations are one-shot)
- [ ] Feedback latency < 30s per wave
- [ ] `nyquist_compliant: true` set in frontmatter (pending PLAN.md task generation — flip after gsd-planner returns)

**Approval:** pending — flip `nyquist_compliant: true` after gsd-planner produces PLAN.md files with `<automated>` blocks honoring every row in the verification map.
