---
phase: 18
slug: synthetic-fixture-live-accountability-integration-suite
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.1.2 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~30 seconds (unit), ~120 seconds (live with API calls) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 18-01-01 | 01 | 1 | TEST-10 | — | N/A | integration | `npx vitest run tests/decisions/synthetic-lifecycle.test.ts` | ❌ W0 | ⬜ pending |
| 18-02-01 | 02 | 1 | TEST-11 | — | N/A | integration | `npx vitest run tests/decisions/concurrency-race.test.ts` | ❌ W0 | ⬜ pending |
| 18-02-02 | 02 | 1 | TEST-12 | — | N/A | integration | `npx vitest run tests/decisions/collision.test.ts` | ❌ W0 | ⬜ pending |
| 18-03-01 | 03 | 2 | TEST-13 | — | N/A | live | `npx vitest run tests/decisions/accountability-live.test.ts` | ❌ W0 | ⬜ pending |
| 18-03-02 | 03 | 2 | TEST-14 | — | N/A | live | `npx vitest run tests/decisions/vague-resistance-live.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing infrastructure covers all phase requirements. vitest and @anthropic-ai/sdk already installed. Test patterns established in prior phases (deadline.test.ts, resolution.test.ts, live-integration.test.ts, vague-validator.test.ts).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Sonnet ACCOUNTABILITY tone | TEST-13 | Requires real API call to Sonnet | Run live test suite with ANTHROPIC_API_KEY set |
| Haiku validator vague-prediction resistance | TEST-14 | Requires real API call to Haiku | Run live test suite with ANTHROPIC_API_KEY set |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
