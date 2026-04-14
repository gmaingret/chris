---
phase: 9
slug: praise-quarantine
status: superseded-by-phase-10
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

> **M006 note:** superseded by Phase 10 live validation suite (24/24 live + 20 contradiction pairs, 2026-04-14). Wave-0 formalism not promoted; live suite provides behavioral coverage.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
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
| 09-01-01 | 01 | 1 | SYCO-04 | — | N/A | unit | `npx vitest run tests/praise-quarantine.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | SYCO-05 | — | N/A | unit | `npx vitest run tests/praise-quarantine.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | SYCO-04 | — | N/A | integration | `npx vitest run tests/engine.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/praise-quarantine.test.ts` — stubs for SYCO-04, SYCO-05
- [ ] Haiku API mock setup in test file

*Existing vitest infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Haiku rewrite quality | SYCO-04 | LLM output is non-deterministic; unit tests verify the call happens, not output quality | Send messages to Chris in JOURNAL/REFLECT/PRODUCE modes and verify responses don't open with reflexive praise |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
