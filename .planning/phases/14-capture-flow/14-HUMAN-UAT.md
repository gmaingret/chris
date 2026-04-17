---
status: partial
phase: 14-capture-flow
source: [14-VERIFICATION.md]
started: 2026-04-16T06:10:00Z
updated: 2026-04-16T06:10:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end Telegram Capture Flow
expected: Send an EN trigger phrase ("I need to decide...") and complete full 5-slot capture; verify anti-interrogation conversational feel, decision row created with all fields
result: [pending]

### 2. Suppression Persistence
expected: Run `/decisions suppress` with a phrase, then re-send that phrase; confirm no capture triggered
result: [pending]

### 3. Multilingual Capture
expected: Send FR or RU trigger phrase; verify language stays locked throughout capture conversation
result: [pending]

### 4. Abort Flow
expected: Say "never mind" mid-capture; verify clean dismissal and normal routing resumes
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
