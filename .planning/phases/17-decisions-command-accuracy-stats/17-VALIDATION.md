---
phase: 17
slug: decisions-command-accuracy-stats
status: verified
nyquist_compliant: true
wave_0_complete: true
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
| **Full suite command** | `bash scripts/test.sh` (Docker Postgres + sequential file execution) |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test File | Test Count | Status |
|---------|------|------|-------------|-----------|------------|--------|
| 17-01-01 | 01 | 1 | STAT-02 | classify-accuracy.test.ts | 6 | ✅ green |
| 17-01-02 | 01 | 1 | STAT-02 | classify-accuracy.test.ts (timeout, error, parse, invalid) | 4 | ✅ green |
| 17-01-03 | 01 | 1 | STAT-02 | resolution.test.ts (Phase 17 accuracy classification) | 5 | ✅ green |
| 17-02-01 | 02 | 1 | STAT-03 | stats.test.ts (wilsonCI pure math) | 3 | ✅ green |
| 17-02-02 | 02 | 1 | STAT-04 | stats.test.ts (fetchStatsData SQL window filtering) | 2 | ✅ green |
| 17-02-03 | 02 | 1 | STAT-03 | stats.test.ts (computeAccuracy) | 4 | ✅ green |
| 17-02-04 | 02 | 1 | STAT-03/04 | stats.test.ts (formatDashboard, formatOpenList, formatRecentList, formatStatsBlock) | 6 | ✅ green |
| 17-02-05 | 02 | 1 | — | suppressions.test.ts (removeSuppression) | 4 | ✅ green |
| 17-03-01 | 03 | 2 | STAT-01 | decisions-command.test.ts (dashboard, open, recent, suppressions, unsuppress, unknown sub) | 12 | ✅ green |
| 17-03-02 | 03 | 2 | STAT-01/05 | decisions-command.test.ts (stats, reclassify) | 11 | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Total: 74 automated tests across 5 test files, all green when run individually.**

Note: Cross-file concurrent execution against shared Postgres causes FK constraint violations (pre-existing test isolation issue). `scripts/test.sh` runs files sequentially to avoid this.

---

## Test File Summary

| Test File | Tests | Covers |
|-----------|-------|--------|
| classify-accuracy.test.ts | 6 | classifyAccuracy unit tests (sound/flawed/timeout/parse/invalid/error) |
| resolution.test.ts | 21 | handleResolution + handlePostmortem + classifyOutcome + getTemporalPensieve + Phase 17 accuracy wiring |
| stats.test.ts | 15 | Wilson CI math + computeAccuracy + fetchStatsData SQL + all 4 formatters |
| suppressions.test.ts | 9 | addSuppression + isSuppressed + listSuppressions + removeSuppression |
| decisions-command.test.ts | 23 | All /decisions sub-commands (dashboard, open, recent, stats, suppressions, unsuppress, reclassify) |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Telegram output fits one bubble | STAT-01 | Visual formatting | Send `/decisions` in test chat, verify single message |
| Localized output | STAT-01 | Language detection | Set user language, verify output language matches |

---

## Validation Audit 2026-04-16

| Metric | Count |
|--------|-------|
| Requirements mapped | 7 |
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** verified 2026-04-16
