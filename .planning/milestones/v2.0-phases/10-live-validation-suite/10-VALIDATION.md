---
phase: 10
slug: live-validation-suite
status: superseded-by-phase-10
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-13
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

> **M006 note:** superseded by Phase 10 live validation suite (24/24 live + 20 contradiction pairs, 2026-04-14). Wave-0 formalism not promoted; live suite provides behavioral coverage.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.2 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm run test:unit` |
| **Full suite command** | `npm test` |
| **Live integration only** | `ANTHROPIC_API_KEY=... npm test -- src/chris/__tests__/live-integration.test.ts` |
| **Estimated runtime** | ~120 seconds (live tests with API calls) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test:unit`
- **After every plan wave:** Run `ANTHROPIC_API_KEY=... npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | TEST-01 | — | N/A | live integration | `npm test -- live-integration.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | TEST-02 | — | N/A | live integration | `npm test -- live-integration.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | TEST-03 | — | N/A | live integration | `npm test -- live-integration.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-04 | 01 | 1 | TEST-04 | — | N/A | live integration | `npm test -- live-integration.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-05 | 01 | 1 | TEST-05 | — | N/A | live integration | `npm test -- live-integration.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-06 | 01 | 1 | TEST-06 | — | N/A | live integration | `npm test -- live-integration.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-07 | 01 | 1 | TEST-07 | — | N/A | live integration | `npm test -- live-integration.test.ts` | ❌ W0 | ⬜ pending |
| 10-01-08 | 01 | 1 | TEST-08 | — | N/A | live integration | `npm test -- live-integration.test.ts` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 2 | TEST-09 | — | N/A | live integration | `npm test -- contradiction-false-positive.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/chris/__tests__/live-integration.test.ts` — stubs for TEST-01 through TEST-08 (24 live cases)
- [ ] `src/chris/__tests__/contradiction-false-positive.test.ts` — stubs for TEST-09 (20-pair audit)

*Both files are created as part of Phase 10 execution — they ARE the deliverables.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
