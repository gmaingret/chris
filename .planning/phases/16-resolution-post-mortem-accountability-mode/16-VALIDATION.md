---
phase: 16
slug: resolution-post-mortem-accountability-mode
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/decisions/__tests__/resolution.test.ts src/chris/__tests__/praise-quarantine.test.ts` |
| **Full suite command** | `npm test` (Docker + PostgreSQL + all migrations) |
| **Estimated runtime** | ~45 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/decisions/__tests__/resolution.test.ts src/chris/__tests__/praise-quarantine.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 0 | RES-02, RES-03, RES-04, RES-06 | — | N/A | unit (stubs) | `npx vitest run src/decisions/__tests__/resolution.test.ts` | ❌ W0 | ⬜ pending |
| 16-01-02 | 01 | 0 | RES-02 | — | N/A | integration (stubs) | `npx vitest run src/decisions/__tests__/engine-resolution.test.ts` | ❌ W0 | ⬜ pending |
| 16-01-03 | 01 | 0 | RES-06 | — | N/A | integration (stubs) | `npx vitest run src/proactive/__tests__/sweep-escalation.test.ts` | ❌ W0 | ⬜ pending |
| 16-02-01 | 02 | 1 | RES-01 | — | Hard Rule forbidden in prompt | unit | `npx vitest run src/chris/__tests__/personality.test.ts` | ✅ (extend) | ⬜ pending |
| 16-02-02 | 02 | 1 | RES-01 | — | Praise quarantine bypassed | unit | `npx vitest run src/chris/__tests__/praise-quarantine.test.ts` | ✅ (extend) | ⬜ pending |
| 16-03-01 | 03 | 1 | RES-03, RES-04 | — | N/A | integration | `npx vitest run src/decisions/__tests__/resolution.test.ts` | ❌ W0 | ⬜ pending |
| 16-03-02 | 03 | 1 | RES-05 | — | N/A | unit | `npx vitest run src/pensieve/__tests__/retrieve.test.ts` | ✅ (extend) | ⬜ pending |
| 16-04-01 | 04 | 2 | RES-02, RES-03 | — | N/A | integration | `npx vitest run src/decisions/__tests__/engine-resolution.test.ts` | ❌ W0 | ⬜ pending |
| 16-05-01 | 05 | 2 | RES-06 | — | N/A | integration | `npx vitest run src/proactive/__tests__/sweep-escalation.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/decisions/__tests__/resolution.test.ts` — stubs for RES-03, RES-04 (handleResolution, handlePostmortem, classifyOutcome)
- [ ] `src/decisions/__tests__/engine-resolution.test.ts` — stubs for RES-02 (PP#0 routing for AWAITING_RESOLUTION/AWAITING_POSTMORTEM)
- [ ] `src/proactive/__tests__/sweep-escalation.test.ts` — stubs for RES-06 (48h escalation, stale transition)

*Existing `praise-quarantine.test.ts`, `personality.test.ts`, and `retrieve.test.ts` need extension, not new files.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Two-part reply displays correctly in Telegram | RES-03 | Telegram rendering cannot be automated | Send resolution reply in test chat, verify acknowledgment + post-mortem question both display |
| Second prompt "feels" natural, not robotic | RES-06 | Subjective language quality | Read second prompt text after 48h escalation fires |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
