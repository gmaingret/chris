---
phase: 36
slug: tests
status: compliant
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-13
audited: 2026-05-13
---

# Phase 36 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `36-RESEARCH.md` §Validation Architecture (lines 918-957).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x (root: `src`, `fileParallelism: false`, `globals: false`) |
| **Config file** | `vitest.config.ts` (project root) |
| **Canonical run command** | `bash scripts/test.sh <test-file>` (full Docker Postgres — REQUIRED for all PTEST-* tests per MEMORY.md `feedback_always_run_docker_tests`) |
| **Quick run command** | `npx vitest run <test-file>` (unit-only; NOT canonical — does not exercise Docker Postgres) |
| **Full suite command** | `bash scripts/test.sh` (no args) |
| **Estimated runtime** | ~30s per single test file (Docker spin-up); ~15min full suite |

---

## Sampling Rate

- **Per task commit (Plan 36-01):** `bash scripts/test.sh <test-file>` for the single file modified by the task (~30s)
- **Per task commit (Plan 36-02):** `bash scripts/test.sh src/memory/profiles/__tests__/live-anti-hallucination.test.ts` — note: skips by default (CI never sets `RUN_LIVE_TESTS=1`)
- **Per wave merge:** Full profile-test suite `bash scripts/test.sh src/memory/profiles/__tests__/ src/__tests__/fixtures/primed-sanity-m010.test.ts`
- **Phase gate (before `/gsd-verify-work`):** Full `bash scripts/test.sh` suite green. Note: PTEST-05 dual-gate means full suite passes WITHOUT exercising PTEST-05 unless operator sets `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=...` manually. Operator MUST manually run PTEST-05 as the final M010 milestone gate (per CONTEXT.md D-35).
- **Max feedback latency:** 30s per-task / ~5min full Docker / manual PTEST-05 ~1-2min for 3-of-3 atomic

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 36-01-* | 01 | 1 | PTEST-01 | T-36-V5 | `--profile-bias` accepts only the 4 locked Dimension values; rejects others with UsageError | unit | `bash scripts/test.sh scripts/__tests__/synthesize-delta-profile-bias.test.ts` | ✓ exists | ✅ green |
| 36-01-* | 01 | 1 | PTEST-01 | — | Generated m010-30days fixture has ≥12 keyword-classified entries per dimension; m010-5days has <10 per dimension | integration (HARN) | `bash scripts/test.sh src/__tests__/fixtures/primed-sanity-m010.test.ts` | ✓ exists | ✅ green |
| 36-01-* | 01 | 1 | PTEST-02 | — | All 4 profiles populate with confidence > 0, last_updated advances, substrate_hash non-null, profile_history has 4 rows | integration (mocked Anthropic + real Postgres) | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m010-30days.test.ts` | ✓ exists | ✅ green |
| 36-01-* | 01 | 1 | PTEST-03 | — | 3-cycle idempotency: Cycle 1 → 4 calls; Cycle 2 identical → STILL 4 cumulative; Cycle 3 mutated dimension → 5 cumulative; prev-state injection verified via mock SDK spy | integration | same file as PTEST-02 | ✓ exists | ✅ green |
| 36-01-* | 01 | 1 | PTEST-04 | — | Sparse m010-5days → 4× `'chris.profile.threshold.below_minimum'` log entries, 4× `profile_below_threshold` outcome, zero Sonnet calls | integration | `bash scripts/test.sh src/memory/profiles/__tests__/integration-m010-5days.test.ts` | ✓ exists | ✅ green |
| 36-02-* | 02 | 2 | PTEST-05 | T-36-V11 | Live 3-of-3 atomic; REFLECT system prompt contains `## Operational Profile` block; response contains no FORBIDDEN_FACTS keyword; dual-gated | live (real Sonnet 4.6 + real Postgres) | `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... bash scripts/test.sh src/memory/profiles/__tests__/live-anti-hallucination.test.ts` | ✓ exists | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/__tests__/fixtures/primed-sanity-m010.test.ts` — HARN gate per-dimension (≥12 for m010-30days; <10 for m010-5days); uses skip-when-absent pattern per Pitfall P-36-01; 10 tests pass
- [x] `src/memory/profiles/__tests__/integration-m010-30days.test.ts` — covers PTEST-02 + PTEST-03 (three-cycle structure); skip-when-absent pattern; 2 tests pass
- [x] `src/memory/profiles/__tests__/integration-m010-5days.test.ts` — covers PTEST-04; skip-when-absent pattern; 1 test pass
- [x] `src/memory/profiles/__tests__/live-anti-hallucination.test.ts` — covers PTEST-05; three-way dual-gated (RUN_LIVE_TESTS + ANTHROPIC_API_KEY + FIXTURE_PRESENT); 3-of-3 atomic operator-confirmed 2026-05-13T11:30Z
- [x] `src/__tests__/fixtures/seed-profile-rows.ts` — shared helper to re-seed profile_* tables to migration-0012 seed state (Pitfall P-36-02 fix)
- [x] `scripts/__tests__/synthesize-delta-profile-bias.test.ts` — unit tests for `--profile-bias` flag + PROFILE_BIAS_ROTATION (PTEST-01 sub-spec); 15 tests pass
- [x] `src/__tests__/fixtures/chat-ids.ts` — `CHAT_ID_LIVE_ANTI_HALLUCINATION = BigInt(99922)` allocated

**Framework install:** None needed — Vitest already in package.json; postgres container already orchestrated by `scripts/test.sh`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Initial fixture generation (m010-30days + m010-5days) | PTEST-01 enabler | Fixtures are gitignored (Pitfall P-36-01 Option A); operator generates on fresh checkout | `cd /home/claude/chris && npx tsx scripts/regenerate-primed.ts --milestone m010 --target-days 30 --profile-bias jurisdictional --profile-bias capital --profile-bias health --profile-bias family --force --seed 42` (then re-run for `--target-days 5` to create m010-5days). First run hits Anthropic API (~$0.11 for ~30 Haiku calls); subsequent runs use VCR cache. |
| PTEST-05 live anti-hallucination | PTEST-05 (final M010 milestone gate per D-35) | Dual-gated to prevent unbudgeted Anthropic spend in CI; ~$0.10-0.15 per run | After Plan 36-02 ships: `RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... bash scripts/test.sh src/memory/profiles/__tests__/live-anti-hallucination.test.ts`. Verify all 3 atomic iterations pass; expected output: 1 test in 1 file (3 iterations atomic). Cost ~$0.10-0.15 (3 × Sonnet 4.6 calls). |
| Real Telegram `/profile` smoke after first Sunday 22:00 Paris cron fire (2026-05-17) | informal UAT (Phase 35 deferred to Phase 36 / milestone close) | Real Telegram rendering depends on Grammy → Telegram Bot API path; golden snapshot test asserts string output but not on-device rendering | After cron fires 2026-05-17 22:00 Paris: send `/profile` from Greg's Telegram; verify 5 messages arrive (4 dimensions + M011 placeholder); verify FR/RU localization renders correctly; verify staleness qualifier appears when applicable. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (6 test files + 1 helper + 1 chat-id allocation all shipped)
- [x] No watch-mode flags (`bash scripts/test.sh` is one-shot, not watch)
- [x] Feedback latency < 30s per-task / < 5min full Docker
- [x] PTEST-05 dual-gate verified: 3-way describe.skipIf (RUN_LIVE_TESTS + ANTHROPIC_API_KEY + FIXTURE_PRESENT); default-CI skips cleanly in 782ms
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ✓ compliant (audited 2026-05-13 retroactively during v2.5 milestone close; all referenced test files exist and pass per 36-VERIFICATION.md — status: passed, 5/5 success criteria, PTEST-05 live operator-confirmed 11:30 UTC).

---

## Validation Audit 2026-05-13

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 6 per-task verification entries cross-referenced against shipped test files. primed-sanity-m010 (10 tests), integration-m010-30days (2 tests with 3-cycle structure), integration-m010-5days (1 test), live-anti-hallucination (1 dual-gated test, operator-confirmed live 2026-05-13T11:30Z), synthesize-delta-profile-bias (15 unit tests), plus seedProfileRows helper + CHAT_ID_LIVE_ANTI_HALLUCINATION=BigInt(99922) allocation. 3 manual-only items: initial fixture generation (operator-executed 2026-05-13 per Plan 36-01 commit 8bd00ff), PTEST-05 live execution (DONE — 2026-05-13T11:30Z), real Telegram /profile UAT post-2026-05-17 cron fire (naturally future-dated).
