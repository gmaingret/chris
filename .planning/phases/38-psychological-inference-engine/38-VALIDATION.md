---
phase: 38
slug: psychological-inference-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 38 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run <pattern>` for targeted unit tests; full suite via `bash scripts/test.sh` |
| **Full suite command** | `bash scripts/test.sh` (real Docker postgres + all migrations 0000–0013 + full vitest suite) |
| **Estimated runtime** | ~60–120 seconds (full suite); ~5–10 seconds (targeted unit, no DB) |

---

## Sampling Rate

- **After every task commit:** Run targeted vitest pattern for the file just changed (e.g., `npx vitest run src/memory/__tests__/psychological-profile-prompt.test.ts`) — ~5–10 seconds, no DB.
- **After every plan wave:** Run `bash scripts/test.sh` (includes migration apply + smoke gates + targeted suites against Docker postgres) — ~2–3 minutes.
- **Before `/gsd-verify-work`:** `bash scripts/test.sh` full suite must be green on fresh Docker postgres.
- **Max feedback latency:** 30 seconds for targeted unit; 120 seconds for full suite.

---

## Per-Task Verification Map

> Filled by planner — this draft seeds the structure. Planner replaces with concrete task IDs aligned to 38-01/38-02/38-03 plans.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 38-01-XX | 38-01 | 1 | PGEN-01 | — | `assemblePsychologicalProfilePrompt` returns object where `system` includes `CONSTITUTIONAL_PREAMBLE` + `DO_NOT_INFER_DIRECTIVE` + `PSYCHOLOGICAL_HARD_RULE_EXTENSION` for both 'hexaco' and 'schwartz' | unit + typecheck | `npx tsc --noEmit` + `npx vitest run src/memory/__tests__/psychological-profile-prompt.test.ts` | ❌ W0 | ⬜ pending |
| 38-02-XX | 38-02 | 2 | PGEN-02 | — | `generateHexacoProfile` calls Sonnet once with `zodOutputFormat(HexacoProfileSchemaV4Boundary)`, upserts row with new substrate_hash + word_count + last_updated, writes prev snapshot to `profile_history`, emits `chris.psychological.hexaco.{updated,skipped_below_threshold,error}` log | integration | `bash scripts/test.sh` (psychological-profile-updater.integration.test.ts) | ❌ W0 | ⬜ pending |
| 38-02-XX | 38-02 | 2 | PGEN-03 | — | `generateSchwartzProfile` same shape as PGEN-02 for 10 Schwartz values | integration | `bash scripts/test.sh` | ❌ W0 | ⬜ pending |
| 38-02-XX | 38-02 | 2 | PGEN-06 | — | Three-cycle test: Cycle 1 = 2 Sonnet calls, Cycle 2 (identical substrate) = cumulative 4 (NOT 2 — UNCONDITIONAL FIRE), Cycle 3 (mutated substrate) = cumulative 6; per-cycle `substrate_hash` recorded | integration | `bash scripts/test.sh` (psychological-profile-updater.integration.test.ts) | ❌ W0 | ⬜ pending |
| 38-02-XX | 38-02 | 2 | PGEN-07 | — | Generator passes `prevHistorySnapshot` into prompt; Sonnet self-reports `data_consistency` field; host stores verbatim — no stddev/inter-period math host-side | integration | `bash scripts/test.sh` | ❌ W0 | ⬜ pending |
| 38-03-XX | 38-03 | 3 | PGEN-04 | — | `updateAllPsychologicalProfiles` invokes both generators via `Promise.allSettled`; HEXACO failure does NOT abort Schwartz (mocked failure injection test) | integration | `bash scripts/test.sh` | ❌ W0 | ⬜ pending |
| 38-03-XX | 38-03 | 3 | PGEN-05 | — | 5th cron `'0 9 1 * *'` Europe/Paris registered; `cron.validate` fail-fast at config load; `/health` reports `psychological_profile_cron_registered: true`; 12-month collision-check unit test passes | unit + integration | `npx vitest run src/__tests__/cron-registration.test.ts` + `bash scripts/test.sh` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

> Per `gsd-validate-phase` Nyquist convention. The planner must include these as setup tasks (W0) BEFORE green tests can pass.

- [ ] `src/memory/psychological-profile-prompt.ts` — `assemblePsychologicalProfilePrompt`, `PSYCHOLOGICAL_HARD_RULE_EXTENSION` (Plan 38-01)
- [ ] `src/memory/__tests__/psychological-profile-prompt.test.ts` — structural test (Plan 38-01)
- [ ] `src/memory/profiles/psychological-schemas.ts` — extend Phase 37 v4 schemas with top-level `data_consistency` + `overall_confidence` (RESEARCH Finding 1); add `HexacoProfileSchemaV4Boundary` + `SchwartzProfileSchemaV4Boundary` (Plan 38-02)
- [ ] `src/memory/profiles/hexaco.ts` — `generateHexacoProfile` + `HEXACO_PROFILE_CONFIG` (Plan 38-02)
- [ ] `src/memory/profiles/schwartz.ts` — `generateSchwartzProfile` + `SCHWARTZ_PROFILE_CONFIG` (Plan 38-02)
- [ ] `src/memory/profiles/__tests__/hexaco.test.ts`, `schwartz.test.ts` — per-generator unit tests (Plan 38-02)
- [ ] `src/memory/__tests__/psychological-profile-updater.integration.test.ts` — three-cycle unconditional-fire test (Plan 38-02)
- [ ] `src/memory/psychological-profile-updater.ts` — `updateAllPsychologicalProfiles` orchestrator (Plan 38-03)
- [ ] `src/cron-registration.ts` — extend with `psychologicalProfileUpdate` field + register 5th cron (Plan 38-03)
- [ ] `src/config.ts` — append `psychologicalProfileUpdaterCron: validatedCron('PSYCHOLOGICAL_PROFILE_UPDATER_CRON', '0 9 1 * *')` (Plan 38-03)
- [ ] `src/index.ts` — extend `registerCrons({...})` deps + extend health response with `psychological_profile_cron_registered` (Plan 38-03)
- [ ] `src/__tests__/cron-registration.test.ts` — extend with 12-month collision-check test for `'0 9 1 * *'` vs `'0 22 * * 0'` (Plan 38-03)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First live cron fire on 2026-06-01 09:00 Paris | PGEN-05 | Real cron fire requires production deployment; observable only via `/health` + structured-log monitoring; not testable in CI | After Proxmox deploy, monitor logs at 2026-06-01 09:00 Paris for `chris.psychological.hexaco.updated` + `chris.psychological.schwartz.updated` events |

*Live Sonnet 4.6 milestone-gate test (3-of-3 atomic, dual-gated) is Phase 40 PMT-06, NOT Phase 38.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (full suite); < 30s for targeted vitest pattern
- [ ] `nyquist_compliant: true` set in frontmatter (after planner fills concrete task IDs)

**Approval:** pending (planner must fill concrete task IDs in §Per-Task Verification Map before execute-phase)
