---
status: partial
phase: 17-decisions-command-accuracy-stats
source: [17-VERIFICATION.md]
started: 2026-04-16T16:00:00Z
updated: 2026-04-16T16:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live Telegram dashboard
expected: `/decisions` returns single-bubble output with status counts + 90-day accuracy (or threshold-not-met if N<10)
result: [pending]

### 2. N<10 floor live confirmation
expected: No percentage appears when fewer than 10 reviewed decisions exist — counts only with "N=<count>, threshold not met"
result: [pending]

### 3. French/Russian localization
expected: Output language matches detected user language via `getLastUserLanguage()`
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
