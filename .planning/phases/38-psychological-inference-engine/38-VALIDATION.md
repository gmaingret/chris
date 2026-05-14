---
phase: 38
slug: psychological-inference-engine
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
updated: 2026-05-14
---

# Phase 38 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Filled by planner 2026-05-14 with concrete task IDs.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run <pattern>` for targeted unit tests (~5–10s, no DB); `bash scripts/test.sh <pattern>` for DB-backed runs |
| **Full suite command** | `bash scripts/test.sh` (real Docker postgres on port 5433 + all migrations 0000–0013 + full vitest suite) |
| **Estimated runtime** | ~60–120 seconds (full suite); ~5–10 seconds (targeted unit, no DB); ~30–60 seconds (single integration test, DB-backed) |

---

## Sampling Rate

- **After every task commit:** Run targeted vitest pattern for the file just changed (`npx vitest run <test-file>` for pure unit; `bash scripts/test.sh <test-file>` for DB-backed) — ~5–30 seconds.
- **After every plan wave:** Run `bash scripts/test.sh` (includes migration apply + smoke gates + targeted suites against Docker postgres) — ~60–120 seconds.
- **Before `/gsd-verify-work`:** `bash scripts/test.sh` full suite must be green on fresh Docker postgres.
- **Max feedback latency:** 30 seconds for targeted unit; 120 seconds for full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 38-01-T1 | 38-01 | 1 | PGEN-01 | — | `src/memory/psychological-profile-prompt.ts` exists with `assemblePsychologicalProfilePrompt(profileType, substrate, prevState, wordCount)` returning `{system, user}` where `system` includes (in order) `CONSTITUTIONAL_PREAMBLE`, role preamble, `DO_NOT_INFER_DIRECTIVE` (imported, NOT redeclared), `PSYCHOLOGICAL_HARD_RULE_EXTENSION` (D-07 verbatim 8-line phrasing), word-count framing, per-profileType directive (HEXACO / Schwartz), substrate block, structured-output directive. Pitfall 3 — zero operational tokens | typecheck | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 38-01-T2 | 38-01 | 1 | PGEN-01 | — | `psychological-profile-prompt.test.ts` asserts: CONSTITUTIONAL_PREAMBLE first, DO_NOT_INFER imported from `./profile-prompt.js`, PSYCHOLOGICAL_HARD_RULE_EXTENSION verbatim D-07 phrasing, per-profileType directive present (incl. `r ≈ .31–.41` empirical-limits framing), prevState conditional (null → absent / non-null → `## CURRENT PROFILE STATE` with JSON.stringify rendered), user-string format, narrower union (`@ts-expect-error` for 'attachment'), determinism. Parametrized over `['hexaco', 'schwartz']` via `describe.each`. Pitfall 3 audit | unit (no DB) | `npx vitest run src/memory/__tests__/psychological-profile-prompt.test.ts` | ❌ W0 | ⬜ pending |
| 38-02-T1 | 38-02 | 2 | PGEN-02, PGEN-03, PGEN-07 | — | `psychological-schemas.ts` extended with `HexacoProfileSchemaV4Boundary` + `HexacoProfileSchemaV3Boundary` + `SchwartzProfileSchemaV4Boundary` + `SchwartzProfileSchemaV3Boundary` + matching type aliases (top-level `data_consistency` 0-1 + `overall_confidence` 0-1 per RESEARCH Finding 1); `psychological-shared.ts` exports `PROFILE_TYPE_TO_TABLE_NAME` (was private — Finding 2), `PsychologicalProfileGenerationOutcome` discriminated union (3 cases — no `skipped_no_change` per PGEN-06), `computePsychologicalSubstrateHash(corpus, episodicSummaries, schemaVersion)` (M011-appropriate input — Finding 3 Path A). Phase 37 schemas + loader unchanged | typecheck + Phase 37 regression | `npx tsc --noEmit && npx vitest run src/memory/profiles/__tests__/psychological-schemas.test.ts src/memory/profiles/__tests__/psychological-shared.test.ts src/memory/profiles/__tests__/psych-boundary-audit.test.ts` | ❌ W0 | ⬜ pending |
| 38-02-T2 | 38-02 | 2 | PGEN-02, PGEN-03, PGEN-06, PGEN-07 | — | `hexaco.ts` + `schwartz.ts` exist with identical mechanical shape — `generate<HexacoSchwartz>Profile(deps): Promise<PsychologicalProfileGenerationOutcome>` delegating to `runPsychologicalProfileGenerator(<HEXACO_SCHWARTZ>_PROFILE_CONFIG, deps.substrate)` (helper in `psychological-shared.ts`). 11-step body order: discriminated-union narrow (Finding 4 — `if (substrate.belowThreshold)`) → read currentRow → compute hash → NO hash-skip (Pitfall 1 — DELETED per PGEN-06) → NO `.refine()` (D-33) → build prompt via `assemblePsychologicalProfilePrompt(profileType, view, substrate.prevHistorySnapshot, wordCount)` → `anthropic.messages.parse` with `model: SONNET_MODEL`, `max_tokens: 4000`, `zodOutputFormat(v4Boundary)` → host-inject `last_updated` per dim BEFORE v3 re-validate (Pitfall 7) → `v3SchemaBoundary.parse(...)` → write `profile_history` row → upsert via `name='primary'`. Pitfall 3 audit | typecheck + boundary audit | `npx tsc --noEmit && npx vitest run src/memory/profiles/__tests__/psych-boundary-audit.test.ts` | ❌ W0 | ⬜ pending |
| 38-02-T3a | 38-02 | 2 | PGEN-02 | — | `hexaco.test.ts` unit test against real Docker postgres + mocked Anthropic SDK. Asserts: below-threshold → 0 Sonnet calls + outcome `'skipped_below_threshold'`; above-threshold + valid response → 1 Sonnet call + outcome `'updated'` with `overallConfidence > 0` + 6 dim columns populated + 64-char hex `substrateHash`; prompt content routed (HEXACO directive present); `prevHistorySnapshot` threaded; malformed Sonnet output → outcome `'error'` (no throw); no-hash-skip regression test (2 consecutive identical-substrate fires → cumulative 2 calls); Pitfall 7 mitigation (invalid Sonnet `last_updated` host-injected) | unit + integration (DB) | `bash scripts/test.sh src/memory/profiles/__tests__/hexaco.test.ts` | ❌ W0 | ⬜ pending |
| 38-02-T3b | 38-02 | 2 | PGEN-03 | — | `schwartz.test.ts` mirror of `hexaco.test.ts` with 10-value payload | unit + integration (DB) | `bash scripts/test.sh src/memory/profiles/__tests__/schwartz.test.ts` | ❌ W0 | ⬜ pending |
| 38-02-T3c | 38-02 | 2 | PGEN-04 (partial), PGEN-06, PGEN-07 | — | `psychological-profile-updater.integration.test.ts` — three-cycle UNCONDITIONAL FIRE integration test against real Docker postgres + mocked Anthropic SDK. D-35 docblock verbatim ("INVERSE of M010's PTEST-03..."). Cycle 1: 2 Sonnet calls (1 HEXACO + 1 Schwartz); rows have `overallConfidence > 0`; `profile_history` has 2 rows. Cycle 2 (identical content re-seeded into May per Pitfall 5 window-scroll mitigation): cumulative **4** Sonnet calls (NOT 2 — inverse of M010 PTEST-03); `profile_history` has 4 rows; substrate_hash equal to C1 (content identical) but Sonnet still called. Cycle 3 (5 new entries inserted in June + identical baseline): cumulative 6 calls; `profile_history` has 6 rows; substrate_hash differs from C2. Bonus: Promise.allSettled isolation (HEXACO mock rejects → Schwartz still 'updated'). No `vi.useFakeTimers` (postgres driver clash) | integration (DB) | `bash scripts/test.sh src/memory/__tests__/psychological-profile-updater.integration.test.ts` | ❌ W0 | ⬜ pending |
| 38-03-T1a | 38-03 | 3 | PGEN-04 | — | `src/memory/psychological-profile-updater.ts` exists with `updateAllPsychologicalProfiles(): Promise<void>` body containing: D-18 unconditional-fire rationale comment at top of body (Pitfall 1 mitigation point #1); `const now = new Date()` once at top (RESEARCH Open Q2); two `loadPsychologicalSubstrate` calls in `Promise.all` (one per profile type — D-24); `Promise.allSettled` over `[generateHexacoProfile(...), generateSchwartzProfile(...)]` — attachment EXCLUDED per D-23; discriminated outcome aggregation with 3 cases; aggregate `chris.psychological.cron.start` / `.complete` logs; outer try/catch logs `psychological.profile.cron.error`. Pitfall 3 audit | typecheck + boundary audit | `npx tsc --noEmit && npx vitest run src/memory/profiles/__tests__/psych-boundary-audit.test.ts` | ❌ W0 | ⬜ pending |
| 38-03-T1b | 38-03 | 3 | PGEN-05 | — | `src/config.ts` appends `psychologicalProfileUpdaterCron: validatedCron('PSYCHOLOGICAL_PROFILE_UPDATER_CRON', '0 9 1 * *')` after line 87. `src/cron-registration.ts` extends `CronRegistrationStatus` with `psychologicalProfileUpdate: 'registered' | 'failed'`; extends `RegisterCronsDeps.config` with `psychologicalProfileUpdaterCron: string`; extends `RegisterCronsDeps` with `runPsychologicalProfileUpdate: () => Promise<void>`; initializes status to `'failed'`; adds 5th `cron.schedule` block after line 193 wrapping `runPsychologicalProfileUpdate` in try/catch logging `'psychological.profile.cron.error'`. `src/index.ts` imports `updateAllPsychologicalProfiles`; wires `runPsychologicalProfileUpdate: () => updateAllPsychologicalProfiles()` into `registerCrons({...})` deps; adds `psychological_profile_cron_registered: effectiveCronStatus?.psychologicalProfileUpdate === 'registered'` (snake_case VERBATIM per Pitfall 6) | typecheck | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 38-03-T2a | 38-03 | 3 | PGEN-05 | — | `src/rituals/__tests__/cron-registration.test.ts` extended with 4 new tests: (1) 5th cron registered at `'0 9 1 * *'` Europe/Paris with `status.psychologicalProfileUpdate === 'registered'`; (2) `runPsychologicalProfileUpdate` dep wired into handler — invoking the handler calls the spy once; (3) CRON-01 belt-and-suspenders — throwing `runPsychologicalProfileUpdate` does NOT propagate; logger.error called with `'psychological.profile.cron.error'`; (4) 12-month Luxon collision-check vs `'0 22 * * 0'` Sunday cron — every pair-wise time difference > 1 hour (Pitfall 6 — cron-collision regression detector + D-27) | unit | `npx vitest run src/rituals/__tests__/cron-registration.test.ts` | ❌ W0 | ⬜ pending |
| 38-03-T2b | 38-03 | 3 | PGEN-05 | — | `src/__tests__/config.test.ts` extended with 2 new tests: (1) `process.env.PSYCHOLOGICAL_PROFILE_UPDATER_CRON='not-a-cron-expression'` + `vi.resetModules()` + re-import config → throws `/invalid PSYCHOLOGICAL_PROFILE_UPDATER_CRON expression/`; (2) env unset → `config.psychologicalProfileUpdaterCron === '0 9 1 * *'` | unit | `npx vitest run src/__tests__/config.test.ts` | ❌ W0 | ⬜ pending |

---

## Wave 0 Requirements

> Per `gsd-validate-phase` Nyquist convention. The planner has included these as setup tasks. Each W0 ❌ file above resolves once its plan ships.

- [ ] `src/memory/psychological-profile-prompt.ts` — `assemblePsychologicalProfilePrompt`, `PSYCHOLOGICAL_HARD_RULE_EXTENSION` (Plan 38-01 Task 1)
- [ ] `src/memory/__tests__/psychological-profile-prompt.test.ts` — structural test (Plan 38-01 Task 2)
- [ ] `src/memory/profiles/psychological-schemas.ts` — extend with `HexacoProfileSchemaV4Boundary` + `SchwartzProfileSchemaV4Boundary` + V3 boundary variants per RESEARCH Finding 1 (Plan 38-02 Task 1)
- [ ] `src/memory/profiles/psychological-shared.ts` — export `PROFILE_TYPE_TO_TABLE_NAME` + add `PsychologicalProfileGenerationOutcome` + `computePsychologicalSubstrateHash` + `runPsychologicalProfileGenerator` helper (Plan 38-02 Task 1 + Task 2)
- [ ] `src/memory/profiles/hexaco.ts` — `generateHexacoProfile` + `HEXACO_PROFILE_CONFIG` (Plan 38-02 Task 2)
- [ ] `src/memory/profiles/schwartz.ts` — `generateSchwartzProfile` + `SCHWARTZ_PROFILE_CONFIG` (Plan 38-02 Task 2)
- [ ] `src/memory/profiles/__tests__/hexaco.test.ts` — per-generator unit test against real Docker postgres + mocked Anthropic SDK (Plan 38-02 Task 3)
- [ ] `src/memory/profiles/__tests__/schwartz.test.ts` — mirror of hexaco.test.ts (Plan 38-02 Task 3)
- [ ] `src/memory/__tests__/psychological-profile-updater.integration.test.ts` — three-cycle UNCONDITIONAL FIRE integration test with D-35 docblock verbatim (Plan 38-02 Task 3)
- [ ] `src/memory/psychological-profile-updater.ts` — `updateAllPsychologicalProfiles` orchestrator with D-18 rationale comment (Plan 38-03 Task 1)
- [ ] `src/config.ts` — extend with `psychologicalProfileUpdaterCron: validatedCron('PSYCHOLOGICAL_PROFILE_UPDATER_CRON', '0 9 1 * *')` (Plan 38-03 Task 1)
- [ ] `src/cron-registration.ts` — extend `CronRegistrationStatus` + `RegisterCronsDeps` + register 5th cron with `'psychological.profile.cron.error'` log (Plan 38-03 Task 1)
- [ ] `src/index.ts` — import orchestrator + wire `runPsychologicalProfileUpdate` dep + add `psychological_profile_cron_registered` /health field (Plan 38-03 Task 1)
- [ ] `src/rituals/__tests__/cron-registration.test.ts` — extend with 4 new tests including 12-month Luxon collision-check (Plan 38-03 Task 2)
- [ ] `src/__tests__/config.test.ts` — extend with 2 new tests for PSYCHOLOGICAL_PROFILE_UPDATER_CRON fail-fast + default (Plan 38-03 Task 2)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First live cron fire on 2026-06-01 09:00 Paris | PGEN-05 | Real cron fire requires production deployment; observable only via `/health` + structured-log monitoring; not testable in CI | After Proxmox deploy: `ssh chris@192.168.1.50 'curl -s http://localhost:3000/health \| jq .psychological_profile_cron_registered'` should return `true`. At 2026-06-01 09:00 Paris, monitor: `ssh chris@192.168.1.50 'docker logs chris-chris-1 \| grep "chris.psychological"'` for `chris.psychological.cron.start`, `chris.psychological.hexaco.updated`, `chris.psychological.schwartz.updated`, `chris.psychological.cron.complete` events |
| Cron collision avoidance over multiple months | PGEN-05 | The 12-month Luxon collision-check unit test (Plan 38-03 Task 2) is the regression detector; this manual check is the post-deploy operator audit | After first 3 monthly fires (2026-06, 2026-07, 2026-08), confirm via Proxmox logs that the M011 cron fires at 09:00 Paris while the M010 Sunday 22:00 cron continues firing on its own schedule without missed fires or overlap |

*Live Sonnet 4.6 milestone-gate test (3-of-3 atomic, dual-gated `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=...`) is Phase 40 PMT-06, NOT Phase 38.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (every task in the Per-Task Verification Map has an `Automated Command` column populated)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (each task in each plan has its own automated verify)
- [x] Wave 0 covers all MISSING references (the 15 W0 files above are the complete set of new/modified deliverables)
- [x] No watch-mode flags (`bash scripts/test.sh` is one-shot; `npx vitest run` is non-watch)
- [x] Feedback latency < 120s (full suite); < 30s for targeted vitest pattern
- [x] `nyquist_compliant: true` set in frontmatter (planner filled concrete task IDs)

**Approval:** PLANNED — ready for `/gsd-execute-phase 38`.

---

## Pitfall Mitigation Coverage (cross-reference to RESEARCH.md / PITFALLS.md)

| Pitfall | Mitigation point | Plan | Verifier |
|---------|------------------|------|----------|
| 1 — Hash-skip branch reintroduced | D-18 unconditional-fire rationale comment at top of orchestrator body | 38-03 Task 1 | `grep "Divergence from M010 GEN-07" src/memory/psychological-profile-updater.ts` |
| 1 — Hash-skip branch reintroduced (test-level) | D-35 docblock verbatim + Cycle 2 `toHaveBeenCalledTimes(4)` regression assertion | 38-02 Task 3 | 3-cycle integration test |
| 2 — Schema gap silently caps overall_confidence at 0 | RESEARCH Finding 1 — V4Boundary + V3Boundary schemas with top-level `data_consistency` + `overall_confidence` | 38-02 Task 1 | Cycle 1 assertion `overallConfidence > 0` |
| 3 — D047 boundary contamination | Named imports only; no operational tokens in psychological-* files | 38-01 / 38-02 / 38-03 all tasks | `npx vitest run src/memory/profiles/__tests__/psych-boundary-audit.test.ts` after each task |
| 4 — Substrate loaded once when D-24 says twice | Orchestrator skeleton at Plan 38-03 Task 1 — two `loadPsychologicalSubstrate` calls in `Promise.all` | 38-03 Task 1 | `grep "loadPsychologicalSubstrate" src/memory/psychological-profile-updater.ts` returns >= 2 |
| 5 — Test fixture lives in window that scrolls out | Re-seed identical corpus into relevant previous-month window per cycle (Apr 2026 / May 2026 / June 2026) | 38-02 Task 3 | 3-cycle integration test passes |
| 6 — /health field-name typo | Snake_case `psychological_profile_cron_registered` VERBATIM in src/index.ts; test asserts response shape | 38-03 Task 1 + Task 2 | `grep "psychological_profile_cron_registered:" src/index.ts` returns 1 |
| 6 — Cron collision detection | 12-month Luxon next-fire enumeration unit test | 38-03 Task 2 | `npx vitest run src/rituals/__tests__/cron-registration.test.ts` |
| 7 — `last_updated` v3 strict + v4 lax mismatch | Host-inject `new Date().toISOString()` per dim BEFORE v3 re-validate | 38-02 Task 2 | `hexaco.test.ts` test 6 (invalid Sonnet datetime tolerated) |

All 7 pitfalls have at least one mitigation tied to at least one plan task with at least one automated verify.
