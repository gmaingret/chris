---
phase: 11
slug: identity-grounding
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-14
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `./scripts/test.sh src/memory/__tests__/context-builder.test.ts src/chris/__tests__/personality.test.ts` |
| **Full suite command** | `./scripts/test.sh` (unit + Docker integration) |
| **Estimated runtime** | ~30s unit, ~90s live integration (per TEST-03 run) |

User memory requires Docker postgres for all integration tests; never skip.

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full unit suite via `./scripts/test.sh`
- **Before `/gsd-verify-work`:** TEST-03 must pass 3-of-3 consecutive runs (Plan 11-03)
- **Max feedback latency:** 30s (unit), 90s (live)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 11-01 | 1 | RETR-02 | — | N/A | unit | `./scripts/test.sh src/memory/__tests__/context-builder.test.ts` | ❌ W0 (creates) | ⬜ pending |
| 11-01-02 | 11-01 | 1 | RETR-01 | — | N/A | unit (pre-staged RED) | `./scripts/test.sh src/chris/__tests__/personality.test.ts` | ❌ W0 (creates) | ⬜ pending |
| 11-02-01 | 11-02 | 2 | RETR-01 | — | N/A | unit | `./scripts/test.sh src/chris/__tests__/personality.test.ts` | ✅ (11-01-02) | ⬜ pending |
| 11-02-02 | 11-02 | 2 | RETR-01, RETR-04 | — | N/A | grep | `grep -c "John" src/llm/prompts.ts src/chris/personality.ts src/proactive/prompts.ts` returns `0` | ✅ | ⬜ pending |
| 11-02-03 | 11-02 | 2 | RETR-02, RETR-04 | — | N/A | unit + grep | `grep "includeDate: false" src/chris/modes/journal.ts` matches; `./scripts/test.sh` unit suite green | ✅ | ⬜ pending |
| 11-03-01 | 11-03 | 3 | TEST-03 | — | N/A | live integration | `./scripts/test.sh -t "TEST-03"` × 3 consecutive runs | ✅ | ⬜ pending |
| 11-03-02 | 11-03 | 3 | TEST-03 | — | N/A | human checkpoint | review 11-TEST-03-RUNS.md; 3-of-3 pass | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 coverage delivered by Plan 11-01:

- [x] `src/memory/__tests__/context-builder.test.ts` — created by 11-01-01 (includeDate option tests)
- [x] `src/chris/__tests__/personality.test.ts` — created by 11-01-02 (intentionally RED until 11-02 lands)
- [x] `src/chris/__tests__/live-integration.test.ts` — TEST-03 gate already exists at lines 418–503 (verified present; no creation needed)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 3-of-3 consecutive clean runs | TEST-03 | Non-determinism across LLM calls | Plan 11-03 Task 1 runs `./scripts/test.sh -t "TEST-03"` three times back-to-back; record results in 11-TEST-03-RUNS.md; all three must pass |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (Plan 11-01 creates both unit test files)
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-04-14
