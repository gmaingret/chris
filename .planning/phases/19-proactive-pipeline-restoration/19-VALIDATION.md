---
phase: 19
slug: proactive-pipeline-restoration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for gap closure — restoring Phase 15/16 artifacts lost in commit `5582442`. Since the restoration target is byte-exact from canonical commit `4c156c3`, validation primarily verifies that restored code runs correctly in the current runtime and that Phase 15/16/18 test landscapes are GREEN post-restoration.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (Node + TS) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run --no-coverage src/proactive` |
| **Full suite command** | `bash scripts/test.sh` (starts Docker postgres, applies migrations, runs full vitest suite) |
| **Estimated runtime** | quick ~8–15s; full ~90–180s (includes Docker postgres startup) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --no-coverage src/proactive` (quick)
- **After every plan wave:** Run full `bash scripts/test.sh` (never skip — user preference)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds for quick; full suite is end-of-wave gate

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | SWEEP-02, RES-06 (enabler) | — | Channel-aware state helpers isolate accountability from reflective daily caps | unit | `npx vitest run src/proactive/__tests__/state.test.ts` | ❌ W0 | ⬜ pending |
| 19-01-02 | 01 | 1 | SWEEP-02, RES-06 (enabler) | — | Escalation lifecycle: set → get → clear preserves no stale keys | unit | `npx vitest run src/proactive/__tests__/state.test.ts -t escalation` | ❌ W0 | ⬜ pending |
| 19-01-03 | 01 | 1 | (integration fix) | — | `triggers/types.ts` TriggerResult union includes `'decision-deadline'`; no TS errors on deadline.ts | type-check | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 19-02-01 | 02 | 2 | RES-01 (integration fix for RES-02/06) | — | ACCOUNTABILITY_SYSTEM_PROMPT forbids Hard Rule D027 and praise language; ACCOUNTABILITY_FOLLOWUP_PROMPT uses natural stale-context phrasing | unit + grep | `grep -E 'ACCOUNTABILITY_SYSTEM_PROMPT\|ACCOUNTABILITY_FOLLOWUP_PROMPT' src/proactive/prompts.ts` | ⬜ | ⬜ pending |
| 19-03-01 | 03 | 3 | SWEEP-01, SWEEP-04 | — | `runSweep` invokes `createDeadlineTrigger`; `upsertAwaitingResolution` called on fire | integration | `npx vitest run src/proactive/__tests__/deadline.test.ts` | ❌ W0 | ⬜ pending |
| 19-03-02 | 03 | 3 | SWEEP-02 | — | Dual-channel: accountability_outreach (priority=2) and reflective_outreach fire independently, same-day serially, with separate daily caps | integration | `npx vitest run src/proactive/__tests__/sweep.test.ts -t 'channel separation'` | ✅ | ⬜ pending |
| 19-03-03 | 03 | 3 | RES-02 | — | Deadline trigger → `upsertAwaitingResolution` → `handleResolution` reachable end-to-end | integration | `npx vitest run src/proactive/__tests__/sweep.test.ts -t 'deadline to resolution'` | ✅ | ⬜ pending |
| 19-03-04 | 03 | 3 | RES-06 | — | Escalation block outside daily cap; 48h follow-up fires once; 2 non-replies → stale + clearEscalationKeys | integration | `npx vitest run src/proactive/__tests__/sweep-escalation.test.ts` | ❌ W0 | ⬜ pending |
| 19-03-05 | 03 | 3 | SWEEP-04 | — | Dated stale-context prompt fires when >48h past resolve_by ("On 2026-04-01 you predicted…") | unit | `npx vitest run src/proactive/__tests__/deadline.test.ts -t 'dated stale context'` | ❌ W0 | ⬜ pending |
| 19-04-01 | 04 | 4 | (integration PARTIAL fix) | — | Drizzle migration meta 0001/0003 snapshots present OR documented as permanently deferred with rationale | type-check | `ls src/db/migrations/meta/0001_snapshot.json src/db/migrations/meta/0003_snapshot.json 2>&1` | ⬜ | ⬜ pending |
| 19-04-02 | 04 | 4 | TEST-12 realignment | — | TEST-12 asserts original channel-separation contract (both channels fire, sendMessage called 2x, accountability first) | integration | `npx vitest run src/__tests__/synthetic-fixture.test.ts -t TEST-12` | ✅ | ⬜ pending |
| 19-04-03 | 04 | 4 | (test-infra fix) | — | scripts/test.sh applies all 5 migrations with ON_ERROR_STOP=1 | script | `bash scripts/test.sh` | ✅ | ⬜ pending |
| 19-05-01 | verify | — | (milestone re-audit) | — | `/gsd-audit-milestone v2.1` shows 31/31 satisfied, no FAIL integration checks, Flows B + E COMPLETE | manual+automated | `/gsd-audit-milestone v2.1` | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/proactive/__tests__/deadline.test.ts` — restore from canonical `4c156c3` (tests decision-deadline trigger factory + dated stale-context prompt)
- [ ] `src/proactive/__tests__/sweep-escalation.test.ts` — restore from canonical `4c156c3` (tests 48h follow-up + stale transition + clearEscalationKeys)
- [ ] State tests file (`src/proactive/__tests__/state.test.ts`) — may already exist; verify covers channel-aware + escalation helpers
- [ ] `src/proactive/triggers/types.ts` — add `'decision-deadline'` to `TriggerResult.triggerType` union (enabler, not test but blocks type-check)

*Framework (vitest) already installed. Docker postgres already wired into `scripts/test.sh`.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Sonnet accountability tone quality (no flattery, no condemnation) | RES-01 adjacent | LLM behavior — covered by Phase 18 TEST-13 live suite (D023/D032 pattern) | After restoration, re-run `ANTHROPIC_API_KEY=$KEY npx vitest run --no-coverage src/__tests__/live-accountability.test.ts` |
| Production sweep schedule (cron timing, interval) | operational | Cannot be validated in test env | Confirm production cron job invokes runSweep at expected cadence post-deploy |
| Milestone re-audit passes | v2.1 gap closure exit gate | The audit itself is a manual-but-tool-assisted gate | `/gsd-audit-milestone v2.1` after Phase 19 verification |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (deadline.test.ts, sweep-escalation.test.ts, types.ts union fix)
- [ ] No watch-mode flags (all commands use `vitest run`, not `vitest`)
- [ ] Feedback latency <15s for quick; full suite runs at wave boundaries
- [ ] `nyquist_compliant: true` set in frontmatter after plans produced and Wave 0 dependencies listed in 19-01-PLAN.md

**Approval:** pending
