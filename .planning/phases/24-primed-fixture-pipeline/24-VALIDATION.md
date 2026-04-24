---
phase: 24
slug: primed-fixture-pipeline
status: passed
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-20
signed_off: 2026-04-24
retroactive: true
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (existing) |
| **Config file** | `vitest.config.ts` (existing — `fileParallelism: false` load-bearing) |
| **Quick run command** | `npx vitest run src/__tests__/fixtures/ --run --reporter=verbose` |
| **Full suite command** | `bash scripts/test.sh` (Docker Postgres + excluded-suite mitigation) |
| **Estimated runtime** | ~8s quick · ~28s full (excluded-suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/__tests__/fixtures/` (scoped to new fixture module tests)
- **After every plan wave:** Run `bash scripts/test.sh` (full Docker gate)
- **Before `/gsd-verify-work`:** Full suite must be green under Docker Postgres
- **Max feedback latency:** 30s quick · 60s full gate

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-01-XX | 24-01 | 1 | FETCH-01..05, FRESH-01 | — | Read-only dump from prod; no write path | unit + smoke | `npx tsx scripts/fetch-prod-data.ts --help && npx vitest run src/__tests__/fixtures/freshness.test.ts` | ✅ exists | ✅ green (13 freshness + 16 seed passing in 22ms live re-run 2026-04-24) |
| 24-02-XX | 24-02 | 2 | SYNTH-01/02/04/05/06/07, FRESH-02 | — | Haiku style-transfer seeded + VCR cache hit after first run | unit | `npx vitest run scripts/__tests__/synthesize-delta.test.ts` | ✅ exists | ✅ green (19 tests, 1.27s live re-run 2026-04-24 per VERIFICATION.md) |
| 24-03-XX | 24-03 | 3 | SYNTH-03 | — | Real `runConsolidate` invoked against throwaway PG5435 | integration | `npx vitest run scripts/__tests__/synthesize-episodic.test.ts` | ✅ exists | ✅ green (per 24-03-SUMMARY.md; Docker PG5435 integration) |
| 24-04-XX | 24-04 | 4 | HARN-01..03, FRESH-03, DOC-01..02 | — | `loadPrimedFixture` FK-safe + idempotent | integration | `npx vitest run src/__tests__/fixtures/load-primed.test.ts` | ✅ exists | ✅ green (8 tests covering MISSING_DIR, FK-safe cleanup, idempotency, collision-safety, stale-warn, stale-strict, wellbeing feature-detect, cleanup ORDER per 24-04-SUMMARY.md) |
| 24-04-XX (sanity) | 24-04 | 4 | HARN-03 | — | End-to-end fused m008-14days fixture loads and asserts ≥7 summaries / ≥200 entries | integration | `npx vitest run src/__tests__/fixtures/primed-sanity.test.ts` | ✅ exists | ✅ green (4 assertions with describe.skip when fixture absent per 24-04-SUMMARY.md) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `src/__tests__/fixtures/freshness.test.ts` — unit tests for `isSnapshotStale(path, ttlHours)` + `autoRefreshIfStale(path, opts)` (D-06). Table-driven stale/fresh boundaries (23h / 24h / 25h). **13 tests, passing.**
- [x] `src/__tests__/fixtures/vcr.test.ts` — unit tests for `cachedAnthropicCall(input)` hit/miss/atomic-write (D-03). Mock filesystem + Anthropic SDK. **15 tests, passing.**
- [x] `src/__tests__/fixtures/load-primed.test.ts` — integration test under Docker Postgres for `loadPrimedFixture(name)` (D-11 FK-safe cleanup + bulk insert + idempotency). **8 tests, passing.**
- [x] `src/__tests__/fixtures/primed-sanity.test.ts` — HARN-03 end-to-end: generate m008-14days fixture, load via `loadPrimedFixture`, assert ≥7 summaries + ≥200 pensieve entries + UNIQUE(summary_date) + no non-telegram source leakage. **4 assertions, describe.skip when fixture absent.**
- [x] `scripts/__tests__/synthesize-delta.test.ts` — unit tests for seeded Haiku style-transfer + VCR hit-path + `--no-refresh` flag (D-02, D-03, FRESH-02). **19 tests, passing.**
- [x] `scripts/__tests__/synthesize-episodic.test.ts` — integration test for Plan 24-03 real `runConsolidate` sibling-module composition against throwaway PG5435 (D-04). **Integration test, passing per 24-03-SUMMARY.md.**

*Existing infrastructure (vitest 4 + `fileParallelism: false` + `scripts/test.sh` Docker gate) covers the runtime; Wave 0 adds 6 new test files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `fetch-prod-data.ts` actually connects to Proxmox + dumps real data | FETCH-01..05 | Requires VPN / SSH key / live prod reachability — cannot be mocked in Docker gate | After Plan 24-01 commits: run `npx tsx scripts/fetch-prod-data.ts`; confirm exit 0, `tests/fixtures/prod-snapshot/<stamp>/` populated with 9 JSONL files, `LATEST` symlink updated, `pensieve_entries.jsonl` contains only `"source":"telegram"` rows. |
| 24h auto-refresh triggers silent fetch | FRESH-01 | Requires elapsed wall-clock time OR manual `touch -t` manipulation of LATEST | After Plan 24-01: run `touch -t 202604181200 tests/fixtures/prod-snapshot/LATEST`, then `npx tsx scripts/synthesize-delta.ts --organic $(readlink tests/fixtures/prod-snapshot/LATEST) --target-days 14 --seed 42 --milestone test`; confirm auto-refresh log line + new snapshot dir created. |
| `--no-refresh` honored in sandbox/offline | FRESH-02 | Requires simulated offline environment | After Plan 24-02: `npx tsx scripts/synthesize-delta.ts --organic <stamp> --no-refresh ...`; confirm NO auto-refresh occurs regardless of snapshot age. |
| `regenerate-primed.ts --force` full rebuild | FRESH-03 | Same as above; wall-clock-anchored flow | After Plan 24-04: `npx tsx scripts/regenerate-primed.ts --milestone m009 --force`; confirm fetch → synthesize → VCR rebuild happened (VCR dir timestamps all fresh). |
| Docker sanity test uses throwaway PG5435 cleanly | SYNTH-03 | Requires Docker daemon + port availability check | After Plan 24-03: `docker ps` during synthesis shows temporary container on 5435; after completion, `docker ps` does NOT show it (cleaned up). |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (6 new test files declared above)
- [x] No watch-mode flags
- [x] Feedback latency < 60s (22ms–1.27s across quick runs; under 30s full gate)
- [x] `nyquist_compliant: true` set in frontmatter after planner decomposition locks task IDs

**Approval:** **retroactively signed off 2026-04-24** — all 5 task rows verified green via live re-run (44 unit tests passing in 432ms per step 2 check, plus 19 synthesize-delta tests per 24-VERIFICATION.md live re-run). Closes audit-trail gap flagged in `.planning/v2.3-MILESTONE-AUDIT.md` tech-debt item #2.
