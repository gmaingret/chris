---
phase: 7
slug: foundational-behavioral-fixes
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.2 |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | TRUST-01 | T-07-01 | Regex patterns avoid catastrophic backtracking | unit | `npm run test:unit -- src/chris/__tests__/refusal.test.ts` | No — W0 | pending |
| 07-01-02 | 01 | 0 | LANG-02 | — | N/A | unit | `npm run test:unit -- src/chris/__tests__/language.test.ts` | No — W0 | pending |
| 07-01-03 | 01 | 0 | SYCO-01, SYCO-02, SYCO-03 | — | N/A | unit | `npm run test:unit -- src/chris/__tests__/personality.test.ts` | No — W0 | pending |
| 07-01-04 | 01 | 0 | TRUST-03 | — | N/A | unit | `npm run test:unit -- src/chris/__tests__/engine-refusal.test.ts` | No — W0 | pending |
| 07-02-01 | 02 | 1 | TRUST-01 | T-07-01 | No ReDoS patterns in regex | unit | `npm run test:unit -- src/chris/__tests__/refusal.test.ts` | No — W0 | pending |
| 07-02-02 | 02 | 1 | TRUST-02 | T-07-02 | Topics stored as strings only | unit | `npm run test:unit -- src/chris/__tests__/refusal.test.ts` | No — W0 | pending |
| 07-02-03 | 02 | 1 | LANG-01, LANG-02 | — | N/A | unit | `npm run test:unit -- src/chris/__tests__/language.test.ts` | No — W0 | pending |
| 07-03-01 | 03 | 1 | SYCO-01, SYCO-02, SYCO-03 | — | N/A | unit | `npm run test:unit -- src/chris/__tests__/personality.test.ts` | No — W0 | pending |
| 07-03-02 | 03 | 1 | TRUST-04, LANG-03 | — | N/A | unit | `npm run test:unit -- src/chris/__tests__/personality.test.ts` | No — W0 | pending |
| 07-04-01 | 04 | 2 | LANG-04 | — | N/A | unit | `npm run test:unit -- src/chris/__tests__/personality.test.ts` | No — W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `src/chris/__tests__/refusal.test.ts` — stubs for TRUST-01, TRUST-02, TRUST-03
- [ ] `src/chris/__tests__/language.test.ts` — stubs for LANG-01, LANG-02
- [ ] `src/chris/__tests__/personality.test.ts` — stubs for SYCO-01, SYCO-02, SYCO-03, TRUST-04, LANG-03, LANG-04
- [ ] `src/chris/__tests__/engine-refusal.test.ts` — stubs for TRUST-03 engine integration
- [ ] `npm install franc` — new dependency

*Existing infrastructure covers test framework (vitest) and Docker integration tests.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Question frequency ~1 in 5 | LANG-04 | LLM output is non-deterministic | Send 10 JOURNAL messages, verify <3 end with questions |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
