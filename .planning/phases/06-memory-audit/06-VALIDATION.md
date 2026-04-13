---
phase: 6
slug: memory-audit
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.1.2 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- src/pensieve/__tests__/` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/pensieve/__tests__/`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | RETR-03 | — | N/A | unit | `npm test -- src/pensieve/__tests__/ground-truth.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | RETR-03 | — | N/A | integration | `npm test -- src/pensieve/__tests__/audit.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | RETR-03 | — | N/A | integration | `npm test -- src/pensieve/__tests__/audit.test.ts` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | RETR-03 | — | N/A | unit | `npm test -- src/scripts/__tests__/audit-report.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/pensieve/__tests__/ground-truth.test.ts` — validates GROUND_TRUTH exports, GROUND_TRUTH_MAP completeness, GroundTruthEntry types
- [ ] `src/pensieve/__tests__/audit.test.ts` — validates soft-delete mutation, corrected entry retrieval, dry-run no-op behavior
- [ ] `src/scripts/__tests__/audit-report.test.ts` — validates markdown report format and content

*Existing vitest infrastructure covers framework requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Production dry-run report review | RETR-03 (D-07) | Requires human review of real production data before wet-run approval | Run `audit-pensieve.ts --dry-run` against production, review markdown report, approve wet-run |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
