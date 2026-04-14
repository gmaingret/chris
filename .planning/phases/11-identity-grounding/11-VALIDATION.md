---
phase: 11
slug: identity-grounding
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| **Quick run command** | `pnpm test -- --run src/chris/__tests__/personality.test.ts src/memory/__tests__/context-builder.test.ts` |
| **Full suite command** | `pnpm test -- --run` (unit) + `pnpm test:live` (TEST-03 gate) |
| **Estimated runtime** | ~30s unit, ~90s live integration |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full unit suite
- **Before `/gsd-verify-work`:** TEST-03 must pass 3-of-3 consecutive runs
- **Max feedback latency:** 30s (unit), 90s (live)

---

## Per-Task Verification Map

Populated by planner during PLAN.md creation. Each task must have an automated verify command or be backed by a Wave 0 test stub.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | RETR-01/02/04, TEST-03 | — | N/A | unit+integration | TBD | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/chris/__tests__/personality.test.ts` — unit tests for buildKnownFactsBlock header + CONSTITUTIONAL_PREAMBLE identity
- [ ] `src/memory/__tests__/context-builder.test.ts` — unit tests for buildPensieveContext `{ includeDate }` option
- [ ] `src/chris/__tests__/live-integration.test.ts` — TEST-03 JOURNAL grounding gate (already exists at lines 418–503, verify + harden if needed)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 3-of-3 consecutive clean runs | TEST-03 | Non-determinism across LLM calls | Run `pnpm test:live -- --run -t "TEST-03"` three times back-to-back, all must pass |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
