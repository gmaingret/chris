---
phase: 17
slug: decisions-command-accuracy-stats
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

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
| 17-01-01 | 01 | 1 | STAT-02 | — | classifyAccuracy returns combined string | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 17-01-02 | 01 | 1 | STAT-02 | — | fail-closed to unknown on timeout | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 17-02-01 | 02 | 1 | STAT-03 | — | Wilson CI computation correct | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 17-02-02 | 02 | 1 | STAT-04 | — | SQL FILTER windows correct | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 17-02-03 | 02 | 1 | STAT-03 | — | N<10 shows counts only | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 17-03-01 | 03 | 2 | STAT-01 | — | /decisions returns dashboard | integration | `npx vitest run` | ❌ W0 | ⬜ pending |
| 17-03-02 | 03 | 2 | STAT-05 | — | reclassify preserves originals | integration | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test stubs for classify-accuracy, stats computation, command handlers
- [ ] Shared fixtures for decision test data with Docker Postgres

*Existing infrastructure covers test framework; stubs needed for new modules.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Telegram output fits one bubble | STAT-01 | Visual formatting | Send `/decisions` in test chat, verify single message |
| Localized output | STAT-01 | Language detection | Set user language, verify output language matches |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
