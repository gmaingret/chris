---
phase: 25
slug: ritual-scheduling-foundation-process-gate
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-26
---

# Phase 25 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> Source: `25-RESEARCH.md` §11 Test Infrastructure + §12 Pitfall mitigations.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (existing) |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/rituals/__tests__` |
| **Full suite command** | `bash scripts/test.sh` (Docker postgres + full vitest) |
| **Estimated runtime** | quick ~5s; full ~90s (Docker spin-up dominated) |

> **Env-level constraint:** vitest-4 fork-IPC hang under HuggingFace EACCES — `scripts/test.sh` already excludes 5 specific files via the existing mitigation. Phase 25's new `src/rituals/__tests__/` files MUST NOT be added to that exclude list, but they also MUST NOT import `@huggingface/transformers` (none should — Phase 25 has zero LLM surface).

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/rituals/__tests__` (quick)
- **After every plan wave:** Run `bash scripts/test.sh` (full)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~5s for quick; ~90s for full

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 25-01-* | 01 | 1 | RIT-01..06 | — | Migration applies cleanly; tables/enum/indexes present | integration (Docker postgres) | `bash scripts/test.sh` (psql line confirms 6 tables + RITUAL_RESPONSE enum + 3 indexes) | ❌ W0 | ⬜ pending |
| 25-02-* | 02 | 2 | RIT-07 | — | RitualConfig Zod rejects unknown fields, accepts 8 named fields + schema_version | unit | `npx vitest run src/rituals/__tests__/types.test.ts` | ❌ W0 | ⬜ pending |
| 25-02-* | 02 | 2 | RIT-08 | — | computeNextRunAt DST-safe across 2026-03-29 + 2026-10-25; 4 cadences | property test | `npx vitest run src/rituals/__tests__/cadence.test.ts` | ❌ W0 | ⬜ pending |
| 25-02-* | 02 | 2 | RIT-10 | — | Atomic UPDATE…RETURNING idempotency: 2 concurrent invocations → exactly 1 fired-row return | concurrency test (Docker postgres) | `npx vitest run src/rituals/__tests__/idempotency.test.ts` | ❌ W0 | ⬜ pending |
| 25-03-* | 03 | 3 | RIT-09 | — | Ritual channel slot in runSweep between accountability and reflective; per-tick max-1 cap; shares isMuted() | unit + integration | `npx vitest run src/proactive/__tests__/sweep.test.ts` (extends existing) | ⚠ existing file | ⬜ pending |
| 25-03-* | 03 | 3 | RIT-11 | — | `cron.schedule` invoked with `'0 21 * * *'`, `Europe/Paris` for ritual tick at startup | unit (cron mock spy) | `npx vitest run src/__tests__/cron-registration.test.ts` | ❌ W0 | ⬜ pending |
| 25-03-* | 03 | 3 | RIT-12 | — | `cron.validate('garbage')` rejects at config load; `/health` reports `ritual_cron_registered: true` | unit + integration | `npx vitest run src/__tests__/config.test.ts src/__tests__/health.test.ts` | ⚠ partial | ⬜ pending |
| 25-03-* | 03 | 3 | RIT-09 (Pitfall 1) | — | Ritual storms after cron catch-up — per-tick max-1 cap PROVEN by simulating N=10 enabled rituals → 1 fired per tick | property test | `npx vitest run src/rituals/__tests__/scheduler.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/rituals/__tests__/types.test.ts` — stubs for RIT-07 (RitualConfig Zod)
- [ ] `src/rituals/__tests__/cadence.test.ts` — stubs for RIT-08 (computeNextRunAt + DST property tests)
- [ ] `src/rituals/__tests__/idempotency.test.ts` — stubs for RIT-10 (atomic UPDATE concurrency)
- [ ] `src/rituals/__tests__/scheduler.test.ts` — stubs for RIT-09 (per-tick max-1 cap, channel slot)
- [ ] `src/__tests__/cron-registration.test.ts` — stubs for RIT-11 (cron.schedule spy)
- [ ] `src/__tests__/config.test.ts` — extension for RIT-12 (cron.validate fail-fast)
- [ ] `src/__tests__/health.test.ts` — extension for RIT-12 (`ritual_cron_registered` flag)

> Plan 25-01's migration test consumes existing `scripts/test.sh` Docker harness — no new test infra required for that plan.
>
> Existing `src/proactive/__tests__/sweep.test.ts` is extended in Plan 25-03 (ritual channel) — not a new file.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npx tsx scripts/manual-sweep.ts` returns `[]` against clean DB without throwing | RIT-09/10 (success criterion 3) | One-shot CLI invocation against Docker postgres; not part of test suite cadence | After Wave 3 completes: `docker compose -f docker-compose.test.yml up -d`; run migration; `npx tsx scripts/manual-sweep.ts`; expect stdout `[]` and exit 0 |
| `RITUAL_SWEEP_CRON=garbage npm start` fails fast with clear error | RIT-12 (success criterion 2) | Verifies behavior at process boot, not during a vitest run | Set env var, run `npm start`, expect process exit non-zero with stderr containing "invalid RITUAL_SWEEP_CRON" |
| Container `/health` reports `ritual_cron_registered: true` after `docker compose up` | RIT-12 (success criterion 2) | Verifies actual deployed runtime, not unit test | `docker compose up -d`; `curl http://localhost:3000/health \| jq .ritual_cron_registered` → `true` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (7 new test files listed above)
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s (full suite)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
