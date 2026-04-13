---
phase: 8
slug: retrieval-grounding
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~30 seconds |

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
| 08-01-01 | 01 | 1 | RETR-01 | — | N/A | unit | `npx vitest run src/chris/__tests__/journal.test.ts` | ❌ W0 | ⬜ pending |
| 08-01-02 | 01 | 1 | RETR-02 | — | N/A | unit | `npx vitest run src/chris/__tests__/personality.test.ts` | ✅ | ⬜ pending |
| 08-01-03 | 01 | 1 | RETR-04 | — | N/A | unit | `npx vitest run src/chris/__tests__/journal.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/chris/__tests__/journal.test.ts` — stubs for RETR-01, RETR-04 (JOURNAL hybrid retrieval + hallucination resistance)
- [ ] Verify existing `src/chris/__tests__/personality.test.ts` covers Known Facts injection (RETR-02)

*Journal test file follows existing `interrogate.test.ts` pattern.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Chris reports facts accurately in natural conversation | RETR-04 | Prompt-level behavior only observable against real LLM | Phase 10 live integration tests cover this |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
