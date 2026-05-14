---
phase: 40
slug: psychological-milestone-tests
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
updated: 2026-05-14
---

# Phase 40 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run** | `npx vitest run <pattern>` |
| **Full suite** | `bash scripts/test.sh` |
| **Live test** | `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=… bash scripts/test.sh src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` (~$0.20-0.30 cost; D046 / D-32) |
| **Estimated runtime** | 60-120s full; 10-30s targeted; ~60-180s live PMT-06 |

## Sampling Rate

- Per task: targeted vitest pattern (in-task `<verify><automated>...</automated></verify>`)
- Per wave: `bash scripts/test.sh` (full Docker harness)
- Pre-verify: full suite green
- PMT-06 live: operator-invoked at milestone close ONLY (Plan 40-02 Task 2)

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| 40-01-T1 | 40-01 | 1 | PMT-01 | `scripts/synthesize-delta.ts` has `--psych-profile-bias` boolean flag; `PSYCH_PROFILE_BIAS_KEYWORDS` + `OPENNESS_SIGNAL_PHRASES` constants exported; `psychDimensionHintFor(d, enabled)` helper; per-day Haiku prompt receives signature hint via `psychHint ?? m010Hint` precedence | unit | `bash scripts/test.sh scripts/__tests__/synthesize-delta-psych-profile-bias.test.ts scripts/__tests__/synthesize-delta-profile-bias.test.ts scripts/__tests__/synthesize-delta.test.ts` | ⬜ pending |
| 40-01-T2 | 40-01 | 1 | (infrastructure) | `CHAT_ID_LIVE_PSYCH_ANTI_HALLUCINATION = BigInt(99923)` allocated; `seedPsychProfileRows()` helper extracted from Phase 38 cleanupAll(); SCOPED profile_history wipe (M010 rows preserved); 3 tables reset to migration-0013 cold-start | unit (tsc) | `npx tsc --noEmit -p tsconfig.json 2>&1 \| grep -E 'seed-psych-profile-rows\|chat-ids' \| wc -l` = 0 | ⬜ pending |
| 40-01-T3 | 40-01 | 1 | PMT-02 | `tests/fixtures/primed/m011-30days/MANIFEST.json` + `tests/fixtures/primed/m011-1000words/MANIFEST.json` exist (operator-regenerated, gitignored) | operator-action checkpoint | `ls tests/fixtures/primed/m011-30days/MANIFEST.json tests/fixtures/primed/m011-1000words/MANIFEST.json` | ⬜ W0 |
| 40-01-T4 | 40-01 | 1 | PMT-01 (HARN) + PMT-02 | `m011-30days` wordCount > 5000 AND ≥1 OPENNESS_SIGNAL_PHRASES present; `m011-1000words` wordCount < 5000 AND >= 1; Pitfall §7 / Pitfall 10 PITFALLS.md load-bearing signal-erasure gate | integration (real Postgres) | `bash scripts/test.sh src/__tests__/fixtures/primed-sanity-m011.test.ts` | ⬜ W0 |
| 40-01-T5 | 40-01 | 1 | PMT-03 | Loads m011-1000words → 0 Sonnet calls; both outcomes `'skipped_below_threshold'`; 2× skip-log entries (HEXACO + Schwartz only — attachment not invoked per D-23); 3 profile rows preserved at cold-start; `word_count_at_last_run === 0` (OQ-4 reconciled Option A); zero `profile_history` rows; Pitfall §2 structurally prevented | integration (real Postgres + mocked SDK) | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-1000words.test.ts` | ⬜ W0 |
| 40-01-T6 | 40-01 | 1 | PMT-04 + PMT-05 (same file per D-22) | PMT-04: HEXACO + Schwartz populated, designed signature within ±0.8 tolerance per anchored dim (3 HEXACO HIGH + 5 Schwartz anchored), 2 profile_history rows, 64-hex substrate_hash. PMT-05: Cycle 1=2, Cycle 2=4 cumulative (NOT 2 — INVERSE of M010 PTEST-03; D-24 docblock VERBATIM), Cycle 3=6 cumulative; profile_history scales 2→4→6; all outcomes `'updated'` (no `'skipped_no_change'` enum value exists per Phase 38) | integration (real Postgres + mocked SDK) | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-30days.test.ts` | ⬜ W0 |
| 40-01-T7 | 40-01 | 1 | (regression sweep) | All 6 plan-scope test files green; Phase 37/38/39 tests still green (especially Phase 38's contract-level 3-cycle test in `psychological-profile-updater.integration.test.ts` — defense-in-depth with Plan 40-01 T6 per D-25); OQ-4 reconciliation outcome recorded | operator-action checkpoint | `bash scripts/test.sh` (full suite excluding fork-IPC excludes) | ⬜ W0 |
| 40-02-T1 | 40-02 | 2 | PMT-06 | Three-way `describe.skipIf(!RUN_LIVE_TESTS \|\| !ANTHROPIC_API_KEY \|\| !FIXTURE_PRESENT)` skips cleanly without env vars; 3-of-3 atomic loop; PASS-THROUGH spy (no mockImplementation — T-36-02-V5-01); 5 FORBIDDEN_TRAIT_AUTHORITY_PATTERNS VERBATIM from REQUIREMENTS PMT-06; FORBIDDEN_FACTS inherited from M010 PTEST-05 (RESEARCH Open Q2 subset); BOTH PSYCH_INJECTION_HEADER + HARD_RULE_EXTENSION footer asserted (RESEARCH Open Q5); cost-discipline docblock per D046 | unit (default-skip) | `bash scripts/test.sh src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` skips in <1s | ⬜ W0 |
| 40-02-T2 | 40-02 | 2 | PMT-06 (live) | 3-of-3 atomic green against real Sonnet 4.6; zero trait-authority regex matches; zero FORBIDDEN_FACTS keyword matches; ~$0.20-0.30 actual spend per D-32 | live (operator-invoked) | `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=… bash scripts/test.sh src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` exits 0 | ⬜ W0 (manual) |

## Wave 0 Requirements

- [ ] `scripts/synthesize-delta.ts` extended with `--psych-profile-bias` flag + `PSYCH_PROFILE_BIAS_KEYWORDS` + `OPENNESS_SIGNAL_PHRASES` + `psychDimensionHintFor` (Plan 40-01 T1)
- [ ] `scripts/__tests__/synthesize-delta-psych-profile-bias.test.ts` NEW unit tests covering 6 cases (Plan 40-01 T1)
- [ ] `tests/fixtures/primed/m011-30days/` generated (operator-regenerated; gitignored — Plan 40-01 T3)
- [ ] `tests/fixtures/primed/m011-1000words/` generated (operator-regenerated; gitignored — Plan 40-01 T3)
- [ ] `src/__tests__/fixtures/primed-sanity-m011.test.ts` NEW HARN gate (Plan 40-01 T4)
- [ ] `src/__tests__/fixtures/seed-psych-profile-rows.ts` NEW helper extracted from Phase 38's inline cleanupAll() (Plan 40-01 T2)
- [ ] `src/__tests__/fixtures/chat-ids.ts` MODIFIED — append `CHAT_ID_LIVE_PSYCH_ANTI_HALLUCINATION = BigInt(99923)` (Plan 40-01 T2)
- [ ] `src/memory/profiles/__tests__/integration-m011-1000words.test.ts` NEW PMT-03 (Plan 40-01 T5)
- [ ] `src/memory/profiles/__tests__/integration-m011-30days.test.ts` NEW PMT-04 + PMT-05 same file per D-22 (Plan 40-01 T6)
- [ ] `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` NEW PMT-06 (Plan 40-02 T1)
- [ ] Operator action: regenerate m011-30days + m011-1000words fixtures via `regenerate-primed.ts` (Plan 40-01 T3 — ~$0.10-0.15 spend)
- [ ] Operator action: run PMT-06 with `RUN_LIVE_TESTS=1` for milestone-close gate (Plan 40-02 T2 — ~$0.20-0.30 spend per D046 / D-32)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Operator fixture regeneration | PMT-02 | Anthropic API spend (~$0.10-0.15); operator-invoked once at fresh checkout | Plan 40-01 Task 3 how-to-verify (two `regenerate-primed.ts` invocations + `ls` confirmation) |
| Live 3-of-3 against real Sonnet 4.6 | PMT-06 | Cost discipline (~$0.20-0.30 per D-32); operator-invoked at milestone close | `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=<key> bash scripts/test.sh src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` — expect 3/3 atomic green |
| Full Plan 40-01 regression sweep | (cross-phase regression check) | Confirms Phase 37/38/39 tests still green after Plan 40-01 ships seed-psych-profile-rows helper | Plan 40-01 Task 7 how-to-verify (full `bash scripts/test.sh` + broader profile-test suite + Phase 38 contract test) |

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or W0 dependency
- [x] Sampling continuity OK (per-task → per-wave → pre-verify)
- [x] Wave 0 covers all MISSING references (every test file listed; Plan 40-01 ordering 1→2→3→4→5→6→7 + Plan 40-02 1→2 satisfies the order)
- [x] No watch-mode flags
- [x] Feedback latency < 120s (full); <30s (targeted); ~60-180s live PMT-06
- [x] `nyquist_compliant: true` (every task has `<automated>` verify or W0 dependency; checkpoint tasks have manual gates with explicit resume-signals)
- [x] PMT-06 default-skips cleanly in CI (three-way describe.skipIf gate + .github/scripts/test.sh audit returns 0 hits for RUN_LIVE_TESTS)

**Approval:** ready — planner populated concrete task IDs (40-01-T1..T7 + 40-02-T1..T2); both plans validate clean against frontmatter + structure schemas.
</content>
</invoke>
