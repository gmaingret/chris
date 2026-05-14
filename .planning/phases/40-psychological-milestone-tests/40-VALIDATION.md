---
phase: 40
slug: psychological-milestone-tests
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 40 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run** | `npx vitest run <pattern>` |
| **Full suite** | `bash scripts/test.sh` |
| **Live test** | `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=… bash scripts/test.sh src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` (~$0.20-0.30 cost; D046) |
| **Estimated runtime** | 60-120s full; 10-30s targeted; ~30s live PMT-06 |

## Sampling Rate

- Per task: targeted vitest pattern
- Per wave: `bash scripts/test.sh`
- Pre-verify: full suite green
- PMT-06 live: operator-invoked at milestone close ONLY

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|--------|
| 40-01-XX | 40-01 | 1 | PMT-01 | `scripts/synthesize-delta.ts` has `--psych-profile-bias` boolean flag; PSYCH_PROFILE_BIAS_KEYWORDS constant locked; per-day Haiku prompt receives signature hint | unit | `npx vitest run scripts/__tests__/synthesize-delta.test.ts` | ⬜ pending |
| 40-01-XX | 40-01 | 1 | PMT-02 | `m011-30days` fixture exists (wordCount ≥ 6000, ≥1 OPENNESS_SIGNAL_PHRASES); `m011-1000words` fixture exists (wordCount < 5000) | integration | `npx vitest run src/__tests__/fixtures/primed-sanity-m011.test.ts` | ⬜ W0 |
| 40-01-XX | 40-01 | 1 | PMT-03 | Loads m011-1000words → 0 Sonnet calls; 3 profile rows still confidence=0; word_count_at_last_run updated (or assertion reconciled per RESEARCH Open Q4); skipped_below_threshold outcome | integration | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-1000words.test.ts` | ⬜ W0 |
| 40-01-XX | 40-01 | 1 | PMT-04 | Loads m011-30days → HEXACO + Schwartz populated; signature within ±0.8 tolerance per dim (5+ dims checked); profile_history rows for both | integration | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-30days.test.ts` | ⬜ W0 |
| 40-01-XX | 40-01 | 1 | PMT-05 | 3-cycle fixture-driven: Cycle 1=2, Cycle 2=4 (NOT 2 — INVERSE), Cycle 3=6 cumulative Sonnet calls; profile_history scales 2→4→6; D-24 inverse-of-M010 docblock present | integration | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m011-30days.test.ts` (same file as PMT-04) | ⬜ W0 |
| 40-02-XX | 40-02 | 2 | PMT-06 | Three-way describe.skipIf (`!RUN_LIVE_TESTS \|\| !ANTHROPIC_API_KEY \|\| !FIXTURE_PRESENT`) — skips cleanly without env vars; 3-of-3 atomic loop; adversarial regex sweep finds zero matches; cost-discipline docblock per D046 | unit + live (operator) | (CI) `npx vitest run src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` skips in <1s; (operator) `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=… bash scripts/test.sh src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` exits 0 | ⬜ W0 |

## Wave 0 Requirements

- [ ] `scripts/synthesize-delta.ts` extended with `--psych-profile-bias` flag + PSYCH_PROFILE_BIAS_KEYWORDS + OPENNESS_SIGNAL_PHRASES (Plan 40-01)
- [ ] `tests/fixtures/primed/m011-30days/` generated + committed (Plan 40-01)
- [ ] `tests/fixtures/primed/m011-1000words/` generated + committed (Plan 40-01)
- [ ] `src/__tests__/fixtures/primed-sanity-m011.test.ts` NEW (Plan 40-01)
- [ ] `src/__tests__/fixtures/seed-psych-profile-rows.ts` NEW (Plan 40-01 helper — extracted from Phase 38's inline cleanupAll())
- [ ] `src/memory/profiles/__tests__/integration-m011-1000words.test.ts` NEW (Plan 40-01)
- [ ] `src/memory/profiles/__tests__/integration-m011-30days.test.ts` NEW (Plan 40-01 — PMT-04 + PMT-05 same file)
- [ ] `src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` NEW (Plan 40-02)

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live 3-of-3 against real Sonnet 4.6 | PMT-06 | Cost discipline ($0.20-0.30); operator-invoked at milestone close | `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=<key> bash scripts/test.sh src/memory/profiles/__tests__/live-psych-anti-hallucination.test.ts` — expect 3/3 atomic green |

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or W0 dependency
- [ ] Sampling continuity OK
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (full); <30s (targeted)
- [ ] `nyquist_compliant: true` set in frontmatter
- [ ] PMT-06 default-skips cleanly in CI (no env vars)

**Approval:** pending — planner fills concrete task IDs.
