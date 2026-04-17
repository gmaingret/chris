---
phase: 15
slug: deadline-trigger-sweep-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- src/proactive/__tests__/deadline.test.ts src/proactive/__tests__/state.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/proactive/__tests__/deadline.test.ts src/proactive/__tests__/state.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | SWEEP-01, SWEEP-04 | — | N/A | unit | `npm test -- src/proactive/__tests__/deadline.test.ts` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 1 | SWEEP-02 | — | N/A | unit | `npm test -- src/proactive/__tests__/state.test.ts` | ❌ W0 | ⬜ pending |
| 15-03-02 | 03 | 2 | SWEEP-01, SWEEP-02, SWEEP-04 | — | N/A | unit | `npm test -- src/proactive/__tests__/sweep.test.ts` | Exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/proactive/triggers/deadline.test.ts` — stubs for SWEEP-01 (deadline trigger detection, priority, transition)
- [ ] `tests/proactive/sweep-channels.test.ts` — stubs for SWEEP-02 (channel separation, independent caps, collision)
- [ ] `tests/proactive/accountability-prompt.test.ts` — stubs for SWEEP-04 (stale-context detection, dated vs. recent framing)
- [ ] `tests/proactive/state-channels.test.ts` — stubs for channel-aware state helpers

*Existing test infrastructure covers framework and fixtures.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Accountability prompt tone is neutral-factual | SWEEP-04 | LLM output varies | Review generated prompt text for flattery/condemnation absence |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
