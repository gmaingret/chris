---
phase: 24
slug: primed-fixture-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-20
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
| 24-01-XX | 24-01 | 1 | FETCH-01..05, FRESH-01 | — | Read-only dump from prod; no write path | unit + smoke | `npx tsx scripts/fetch-prod-data.ts --help && npx vitest run src/__tests__/fixtures/freshness.test.ts` | ❌ W0 | ⬜ pending |
| 24-02-XX | 24-02 | 2 | SYNTH-01/02/04/05/06/07, FRESH-02 | — | Haiku style-transfer seeded + VCR cache hit after first run | unit | `npx vitest run scripts/__tests__/synthesize-delta.test.ts` | ❌ W0 | ⬜ pending |
| 24-03-XX | 24-03 | 3 | SYNTH-03 | — | Real `runConsolidate` invoked against throwaway PG5435 | integration | `npx vitest run scripts/__tests__/synthesize-episodic.test.ts` | ❌ W0 | ⬜ pending |
| 24-04-XX | 24-04 | 4 | HARN-01..03, FRESH-03, DOC-01..02 | — | `loadPrimedFixture` FK-safe + idempotent | integration | `npx vitest run src/__tests__/fixtures/load-primed.test.ts` | ❌ W0 | ⬜ pending |
| 24-04-XX (sanity) | 24-04 | 4 | HARN-03 | — | End-to-end fused m008-14days fixture loads and asserts ≥7 summaries / ≥200 entries | integration | `npx vitest run src/__tests__/fixtures/primed-sanity.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/fixtures/freshness.test.ts` — unit tests for `isSnapshotStale(path, ttlHours)` + `autoRefreshIfStale(path, opts)` (D-06). Table-driven stale/fresh boundaries (23h / 24h / 25h).
- [ ] `src/__tests__/fixtures/vcr.test.ts` — unit tests for `cachedAnthropicCall(input)` hit/miss/atomic-write (D-03). Mock filesystem + Anthropic SDK.
- [ ] `src/__tests__/fixtures/load-primed.test.ts` — integration test under Docker Postgres for `loadPrimedFixture(name)` (D-11 FK-safe cleanup + bulk insert + idempotency).
- [ ] `src/__tests__/fixtures/primed-sanity.test.ts` — HARN-03 end-to-end: generate m008-14days fixture, load via `loadPrimedFixture`, assert ≥7 summaries + ≥200 pensieve entries + UNIQUE(summary_date) + no non-telegram source leakage.
- [ ] `scripts/__tests__/synthesize-delta.test.ts` — unit tests for seeded Haiku style-transfer + VCR hit-path + `--no-refresh` flag (D-02, D-03, FRESH-02).
- [ ] `scripts/__tests__/synthesize-episodic.test.ts` — integration test for Plan 24-03 real `runConsolidate` sibling-module composition against throwaway PG5435 (D-04).

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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (6 new test files declared above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter after planner decomposition locks task IDs

**Approval:** pending (planner fills task IDs; gsd-plan-checker signs off)
