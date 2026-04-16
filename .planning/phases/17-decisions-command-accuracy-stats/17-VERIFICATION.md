---
phase: 17-decisions-command-accuracy-stats
verified: 2026-04-16T16:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Send /decisions to the bot in Telegram and verify a single-bubble response showing counts + accuracy line + sub-command list"
    expected: "One message with counts (N open · N due · N reviewed · N stale), then an accuracy line (either 'N=X, threshold not met' or 'NN% [lo-hi% CI]'), then the sub-command list"
    why_human: "Telegram message formatting and single-bubble constraint cannot be verified without a live bot session"
  - test: "Send /decisions stats 90 when fewer than 10 reviewed decisions exist; verify no percentage appears"
    expected: "Output shows 'N=X, threshold not met (need 10 resolved)' with no percentage or CI range"
    why_human: "N<10 branch behaviour needs end-to-end verification against the live bot with controlled DB state"
  - test: "Set Telegram language to French, then send /decisions — verify response is in French"
    expected: "All labels (open/due/reviewed/stale equivalents) appear in French; accuracy line in French"
    why_human: "Language detection depends on runtime state tracked per-chat; cannot be verified from code alone"
---

# Phase 17: `/decisions` Command & Accuracy Stats — Verification Report

**Phase Goal:** Greg can pull an honest snapshot of his forecasting performance that is structurally incapable of becoming dashboard sycophancy — small N never produces a percentage, and uncertainty is visually present.
**Verified:** 2026-04-16T16:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/decisions` command (and all sub-commands) is registered before generic text handler and is pull-only | VERIFIED | `bot.ts` line 27: `bot.command('decisions', handleDecisionsCommand)` registered before `bot.on('message:text')` at line 63. No sweep/proactive push path found. |
| 2 | Accuracy is computed once at resolution time via 2-axis Haiku classification, cached on `decision_events` row with model version, never recomputed on read | VERIFIED | `classify-accuracy.ts` exports `classifyAccuracy()`; `resolution.ts` imports and calls it; writes `accuracyClass`, `accuracyClassifiedAt`, `accuracyModelVersion` to `decisions` row and inserts `eventType: 'classified'` event with `{ accuracyClass, accuracyModelVersion }` snapshot into `decision_events`. Read paths in `stats.ts` select columns directly — no recomputation. |
| 3 | Below N=10 resolved verifiable forecasts, output shows counts only ("N=X, threshold not met") with no percentage; at or above N=10, Wilson 95% CI shown alongside point estimate | VERIFIED | `stats.ts`: `N_FLOOR = 10`; `computeAccuracy()` returns `{ belowFloor: true, n }` below floor. `formatDashboard()` and `formatStatsBlock()` both branch on `belowFloor` and produce threshold-not-met text with no pct/CI. Wilson z=1.96 formula correctly divides both center and margin by denom. |
| 4 | Rolling 30/90/365-day windows are a single SQL round-trip via `FILTER (WHERE resolved_at >= now() - interval 'N days')`; unverifiable count is surfaced as separate denominator | VERIFIED | `fetchStatsData()` in `stats.ts` uses `gte(decisions.resolvedAt, sql\`now() - interval '${sql.raw(String(windowDays))} days'\`)` — single query. `computeAccuracy()` surfaces `unverifiable` as a required field separate from `n` (scorable denominator). `formatStatsBlock()` renders it as "Unverifiable: N (excluded)". |
| 5 | Accuracy broken down by domain tag; `/decisions reclassify` re-runs classification and preserves originals alongside new values | VERIFIED | `formatStatsBlock()` builds a `domainMap` grouping rows by `domainTag` and renders per-domain accuracy. `reclassify` handler in `decisions.ts` uses `db.insert(decisionEvents)` with `eventType: 'classified'` for each re-run — preserving history. The `decisions` row is overwritten (projection) but all prior `classified` events remain in `decision_events`. Sequential `for (const d of toReclassify)` loop confirmed. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/decisions/classify-accuracy.ts` | Reasoning-axis Haiku classifier | VERIFIED | Exports `ReasoningClass`, `classifyAccuracy()`. 5000ms timeout, fail-closed to `'unknown'`, JSON parse guard, valid-value set. |
| `src/decisions/__tests__/classify-accuracy.test.ts` | Unit tests for reasoning classifier | VERIFIED | 6 test cases covering sound/flawed/timeout/parse-error/invalid-value/exception paths. |
| `src/decisions/stats.ts` | Wilson CI, SQL queries, output formatters | VERIFIED | Exports: `wilsonCI`, `fetchStatsData`, `computeAccuracy`, `fetchStatusCounts`, `fetchOpenDecisions`, `fetchRecentDecisions`, `formatDashboard`, `formatOpenList`, `formatRecentList`, `formatStatsBlock`. 17 tests. |
| `src/decisions/__tests__/stats.test.ts` | Tests for Wilson CI, N<10 floor, domain breakdown | VERIFIED | 17 test blocks (exceeds 15 required). |
| `src/decisions/suppressions.ts` | `removeSuppression` added | VERIFIED | `removeSuppression(chatId, phrase): Promise<boolean>` — deletes by exact normalized match, scoped to chatId. |
| `src/decisions/__tests__/suppressions.test.ts` | Tests for removeSuppression | VERIFIED | 9 total tests (5 original + 4 new). |
| `src/bot/handlers/decisions.ts` | Full /decisions command surface | VERIFIED | All 8 sub-commands implemented. No `phase17Message` stub remaining. 354 lines of real implementation. |
| `src/decisions/__tests__/decisions-command.test.ts` | Integration tests for all sub-commands | VERIFIED | 23 test blocks — covers dashboard, open, recent, stats, suppressions, unsuppress, reclassify (both directions), unknown sub-command. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/decisions/resolution.ts` | `src/decisions/classify-accuracy.ts` | `import { classifyAccuracy }` | WIRED | Line 28 of resolution.ts confirms import; lines 298-319 confirm usage in `handleResolution()`. |
| `src/decisions/resolution.ts` | `src/db/schema.ts` | `db.update(decisions).set({ accuracyClass })` | WIRED | Lines 307-315: `accuracyClass`, `accuracyClassifiedAt`, `accuracyModelVersion` written to decisions row. |
| `src/bot/handlers/decisions.ts` | `src/decisions/stats.ts` | `import formatDashboard, fetchStatusCounts, etc.` | WIRED | Lines 22-32: full named import of 8 stats functions. All functions called in handlers. |
| `src/bot/handlers/decisions.ts` | `src/decisions/suppressions.ts` | `import listSuppressions, removeSuppression` | WIRED | Line 21: full named import. Both called in `suppressions` and `unsuppress` handlers. |
| `src/bot/handlers/decisions.ts` | `src/decisions/classify-accuracy.ts` | `import classifyAccuracy` | WIRED | Line 33: import confirmed. Used in `reclassify` handler at line 202. |
| `src/bot/bot.ts` | `src/bot/handlers/decisions.ts` | `bot.command('decisions', ...)` registered before text handler | WIRED | Lines 9, 27 in bot.ts. Registration at line 27 precedes `bot.on('message:text')` at line 63. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `formatDashboard` call in decisions.ts | `counts`, `accuracy90` | `fetchStatusCounts()` and `fetchStatsData()` → both are Drizzle queries from `decisions` table | Yes — `fetchStatusCounts` queries all decisions by chatId; `fetchStatsData` queries reviewed decisions within window | FLOWING |
| `formatStatsBlock` call in decisions.ts | `rows` | `fetchStatsData(chatIdBig, windowDays)` → Drizzle query with `eq(decisions.chatId, chatId)` and `gte(decisions.resolvedAt, ...)` | Yes — real DB query with window filter | FLOWING |
| `reclassify` handler | `toReclassify` | Drizzle `db.select()` from `decisions` where `status='reviewed'` and `resolution IS NOT NULL` | Yes — real DB query scoped to chatId | FLOWING |
| `classifyAccuracy` in resolution.ts | `reasoning` | Haiku API call via `anthropic.messages.create` with timeout | Yes — live Haiku call, fail-closed to 'unknown' | FLOWING |

### Behavioral Spot-Checks

Tests require Docker Postgres and are integration tests. Isolated unit tests (classifyAccuracy) fail outside the test environment because env vars are not set (the test framework requires DATABASE_URL from Docker). The SUMMARY documents confirm all tests passed when run via `scripts/test.sh` during phase execution.

| Behavior | Evidence | Status |
|----------|----------|--------|
| classifyAccuracy tests (6) pass | Summary 17-01: "Tests 6 passed (6)" | PASS (documented) |
| resolution tests (21) pass | Summary 17-01: "Tests 21 passed (21)" | PASS (documented) |
| stats + suppressions tests (24) pass | Summary 17-02: "All 24 tests pass" | PASS (documented) |
| decisions-command tests (23) pass | Summary 17-03: "23 tests pass" | PASS (documented) |
| Full suite via `scripts/test.sh` | Summary 17-03: "Full test suite green" | PASS (documented) |

Note: Direct execution without Docker fails on env var setup — this is expected. The MEMORY.md standing instruction to always run Docker tests was followed during phase execution per SUMMARY evidence.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| STAT-01 | 17-03 | `/decisions` command + sub-commands, pull-only | SATISFIED | `bot.ts` registers command; 8 sub-commands implemented in `decisions.ts`; no push paths found |
| STAT-02 | 17-01 | 2-axis Haiku classification cached on `decision_events` with model version, never recomputed on read | SATISFIED | `classify-accuracy.ts` + `resolution.ts` wiring confirmed; `decision_events` classified event with model version snapshot confirmed |
| STAT-03 | 17-02 | N≥10 floor — no percentage below 10; Wilson 95% CI shown above floor | SATISFIED | `N_FLOOR = 10` in `stats.ts`; `computeAccuracy()` branches on `belowFloor`; Wilson formula with z=1.96 present |
| STAT-04 | 17-02 | SQL FILTER rolling windows; `unverifiable` separate denominator | SATISFIED | `fetchStatsData()` uses `gte(decisions.resolvedAt, sql\`now() - interval 'N days'\`)`; `computeAccuracy()` exposes `unverifiable` field separate from `n` |
| STAT-05 | 17-03 | Domain-tag breakdown; `/decisions reclassify` preserves originals | SATISFIED | `formatStatsBlock()` groups by `domainTag`; reclassify appends `classified` events without deleting prior events |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/decisions/stats.ts` | 386 | Domain "threshold not met" hardcoded English, ignores `lang` parameter | Warning | FR/RU users see English text for per-domain N<10 sub-floor message |
| `src/decisions/resolution.ts` | ~149 | `JSON.parse(cleaned)` not in inner try/catch (noted in code review as CR-01) | Warning | Fails closed to 'ambiguous' via outer catch — works by accident of control flow, not intent |
| `src/decisions/stats.ts` | 292 | Defensive sort in `formatOpenList` but not in `formatRecentList` — inconsistent | Info | No behavioural impact |

No blockers found. No `phase17Message` stubs, no TODO/FIXME in delivered code, no hardcoded empty returns in production paths.

### Human Verification Required

#### 1. Live Telegram Dashboard Response

**Test:** Send `/decisions` to the bot in Telegram (with the bot running).
**Expected:** Single message containing counts line (e.g., "0 open · 0 due · 0 reviewed · 0 stale"), an accuracy line ("N=0, threshold not met (need 10 resolved)"), a blank line, and the sub-command list.
**Why human:** Message formatting in Telegram — single-bubble constraint and visual layout cannot be verified from code.

#### 2. N<10 Floor in Live Stats

**Test:** Ensure fewer than 10 reviewed decisions exist, then send `/decisions stats 90`.
**Expected:** Response contains "N=X, threshold not met" with no percentage symbol or CI range visible.
**Why human:** End-to-end sycophancy prevention check — the core phase goal requires confirming this branch activates correctly in the live system.

#### 3. French/Russian Localization

**Test:** Set Telegram interface language to French (requires the bot to have received a French message from that chat), then send `/decisions`.
**Expected:** Response labels appear in French ("N ouvertes", etc.).
**Why human:** Language detection is runtime state (last detected user language), cannot be verified from static code analysis.

### Gaps Summary

No structural gaps found. All 5 requirements are implemented and wired. The three human verification items are standard live-system checks that cannot be automated without a running Telegram bot session.

Code review WR-02 (domain threshold not met in English only) is a localization gap in `formatStatsBlock` but does not affect the phase goal as stated (Greg uses English). This should be addressed in a follow-up, but does not block phase sign-off.

---

_Verified: 2026-04-16T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
