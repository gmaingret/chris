# Phase 19: Proactive Pipeline Restoration — Research

**Researched:** 2026-04-17
**Domain:** Git archaeology + surgical source restoration
**Confidence:** HIGH

## Summary

Phase 19 is a **gap closure phase**, not greenfield work. Commit `5582442` (2026-04-16, "feat(18-01): create synthetic-fixture.test.ts") was a fast-forward merge from a worktree branched off an older commit; it deleted ~48 K lines across source and planning. Commit `e4cb9da` restored most source files (decisions/*, llm/*, migrations 0002-0004, bot handlers, engine wiring) from the pre-merge state (`4c156c3`), but **silently skipped four categories of files**: `src/proactive/{sweep,state,prompts}.ts`, `scripts/test.sh`, the proactive tests (`deadline.test.ts`, `sweep-escalation.test.ts`, and the dual-channel versions of `state.test.ts`/`sweep.test.ts`), and the `decision-deadline` union member in `src/proactive/triggers/types.ts`.

The code needed to close all 5 unsatisfied requirements (SWEEP-01, SWEEP-02, SWEEP-04, RES-02, RES-06) and both broken flows (B: deadline→resolution; E: auto-escalation) exists verbatim in commit `4c156c3` — the direct parent of `5582442`. Because `4c156c3` is the commit whose state Phase 15 and Phase 16 VERIFICATION.md attested as passing, restoring from `4c156c3` mechanically recovers the verified Phase 15/16 state.

**Primary recommendation:** For each target file, `git checkout 4c156c3 -- <path>` (or equivalent `git show 4c156c3:<path> > <path>`) — this is a known-good restoration, not a rewrite. The restored files have been inspected in this research and are compatible with the post-worktree-merge state of all their downstream importers (resolution.ts, engine.ts, capture-state.ts, language.ts). No structural rewrites needed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Channel-aware daily-cap state | Database / Storage (`proactive_state` KV) | — | KV table in Postgres; channel separation is a key-naming convention over existing table |
| Per-decision escalation tracking | Database / Storage (`proactive_state` KV) | — | Keyed by decision ID; survives restarts |
| Deadline trigger detection | Backend / sweep | Database (decisions table SQL query) | SQL-first trigger; priority=2 |
| Accountability prompt generation | Backend / LLM (Sonnet) | Prompts module | `ACCOUNTABILITY_SYSTEM_PROMPT` + `ACCOUNTABILITY_FOLLOWUP_PROMPT` |
| Dual-channel orchestration | Backend / sweep (`runSweep`) | — | Two independent channels; global mute gates both; error in one does not block other |
| Escalation orchestration | Backend / sweep (escalation block) | Database (capture-state table) | Runs OUTSIDE daily cap; driven by `decision_capture_state.stage = 'AWAITING_RESOLUTION'` query |
| Migration snapshot integrity | Build tooling (`drizzle-kit generate`) | Filesystem (migrations/meta/) | Regenerable; only affects future schema diffs |
| Integration test harness | Test infrastructure (`scripts/test.sh`) | Docker Compose | Applies all 5 migrations with `ON_ERROR_STOP=1` |

## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for Phase 19. Constraints are derived from the milestone audit, Phase 15/16 VERIFICATION.md, and the Phase 19 roadmap entry (success criteria 1-7).

**Effective locked decisions:**
- Design is fixed. Research focuses on *mechanism*, not design. Channel separation (D-05), accountability-first execution order (D-05), 48 h escalation cadence (D-18), stale-context dating (D-08) are all locked by Phase 15/16 decisions and are NOT to be re-examined.
- Restoration source: commit `4c156c3` (the parent of `5582442`) for all 4 target files and 4 test files.
- Docker Postgres integration tests must be run in full — per user MEMORY.md: "Always run full Docker tests; never skip integration tests, always start real postgres." This forbids skipping tests or using test stubs for decisions table operations.
- Per-phase commits after each wave (D017); no skipped tests (D018).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SWEEP-01 | `decision-deadline` trigger at priority=2 as fifth SQL-first trigger; extends `TriggerDetector` interface per D-10 two-phase | `src/proactive/triggers/deadline.ts` already exists post-`e4cb9da` (114 lines, 12 tests at `4c156c3`); `types.ts` missing `'decision-deadline'` in union → fix; `sweep.ts` must call `createDeadlineTrigger()` in accountability channel at priority=2 |
| SWEEP-02 | Channel separation: independent daily caps for `reflective_outreach` vs `accountability_outreach`; same-day collisions fire serially | Canonical `state.ts` exports 4 channel-aware helpers: `hasSentTodayReflective`, `setLastSentReflective`, `hasSentTodayAccountability`, `setLastSentAccountability` + legacy fallback on `last_sent` key for reflective channel (D-07 migration safety) |
| SWEEP-04 | Stale-context prompt text: when prompt fires >48h past resolve_by, explicitly dated ("On 2026-04-01 you predicted…") | Already present in `deadline.ts:38-44` (`STALE_CONTEXT_THRESHOLD_MS = 48*60*60*1000`); unreachable today because trigger is never invoked by sweep — restoring sweep.ts unblocks this |
| RES-02 | Resolution prompts surface within 24 h of `resolve_by` passing; cite prediction + criterion in Greg's language | Sweep's accountability channel calls `upsertAwaitingResolution` BEFORE `bot.api.sendMessage` (write-before-send order); `ACCOUNTABILITY_SYSTEM_PROMPT` instructs verbatim quoting; within-24h SLA is a deployment-schedule guarantee (sweep must run ≥1/day) and is a HUMAN verification item per Phase 16 VERIFICATION |
| RES-06 | 48h auto-escalation: 1 follow-up prompt, then 2 non-replies transitions decision to `stale` with no further prompts | Escalation block in canonical `sweep.ts:179+` runs OUTSIDE the daily cap; queries `decision_capture_state.stage='AWAITING_RESOLUTION'`; uses `getEscalationSentAt/Count/setEscalationSentAt/Count/clearEscalationKeys` per-decision keys (format: `accountability_sent_<id>`, `accountability_prompt_count_<id>`); `ACCOUNTABILITY_FOLLOWUP_PROMPT` for follow-up |

## Standard Stack

No new libraries. All restoration uses libraries already in the project.

### Core (already installed; versions verified from package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.45.2 | ORM for Postgres — `db.select/insert/update/delete`, `eq`, `and`, `lte`, `asc` | Already the project ORM; all current proactive code uses it |
| drizzle-kit | ^0.31.10 | Schema diffing + migration generation | Used to regenerate missing meta snapshots; `drizzle-kit generate` is the standard path |
| vitest | ^4.1.2 | Test framework | Already the project test runner |
| @anthropic-ai/sdk | existing | Sonnet LLM calls | `anthropic.messages.create` pattern is reused verbatim from canonical sweep |
| grammY (`bot.api.sendMessage`) | existing | Telegram delivery | Existing pattern in current sweep.ts |
| pino (`logger.info/warn/error`) | existing | Structured logging | Every sweep phase emits `proactive.sweep.*` events; canonical preserves this |

### Installation
No new packages. Verified via `grep package.json`.

## Runtime State Inventory

> This phase involves restoring source files that reference runtime state (Postgres `proactive_state` KV rows and `decision_capture_state` rows). No rename — but state compatibility matters.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data — proactive_state KV** | Existing production rows use only legacy keys: `last_sent`, `mute_until`. After restoration, the sweep will write new keys: `last_sent_reflective`, `last_sent_accountability`, `accountability_sent_<decisionId>`, `accountability_prompt_count_<decisionId>`. Canonical `hasSentTodayReflective` falls back to `last_sent` key (state.ts:103) so existing production state continues to gate reflective outreach; no migration needed. `hasSentTodayAccountability` has no legacy fallback because the channel is new. | None — canonical code handles migration via fallback; no data migration required |
| **Stored data — decision_capture_state** | Existing table already has `AWAITING_RESOLUTION` / `AWAITING_POSTMORTEM` enum values (migration 0002); `upsertAwaitingResolution` and `updateToAwaitingPostmortem` helpers exist in `src/decisions/capture-state.ts` (unchanged by e4cb9da restore). Signature `(chatId: bigint, decisionId: string)` matches canonical sweep caller. | None — contract matches |
| **Live service config** | None. The sweep is invoked by Node.js cron (inside the project), not an external service. | None |
| **OS-registered state** | Production sweep is driven by application-level `node-cron` / systemd — frequency ≥1/day is a HUMAN verification item per Phase 16 VERIFICATION (not a code concern). Research cannot verify deployment schedule. | Flag as HUMAN verification (unchanged from Phase 16) |
| **Secrets/env vars** | None added. `ANTHROPIC_API_KEY`, `DATABASE_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_AUTHORIZED_USER_ID` are existing config. | None |
| **Build artifacts** | `src/db/migrations/meta/0001_snapshot.json` and `0003_snapshot.json` are missing — BUT: canonical commit `4c156c3` ALSO has them missing (verified via `git ls-tree 4c156c3 -- src/db/migrations/meta/`). The `_journal.json` references entries 0001/0003 but Drizzle's runtime migrator only needs the `.sql` files; snapshots are required ONLY for `drizzle-kit generate` to diff future schema changes. Regenerating via `drizzle-kit generate` against a live Postgres is preferred over backfilling from git (which would not help — they were never there for the current schema sequence). | Regenerate via `drizzle-kit generate` (see Migration Snapshot Strategy below); non-blocking for test suite |

**The canonical question:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?*

Answer: **None**. Production `proactive_state` KV rows using legacy `last_sent` key will continue to gate the reflective channel via the documented fallback in `hasSentTodayReflective`. No active decision is in `AWAITING_RESOLUTION` today (because the sweep never surfaces one), so no legacy escalation keys exist in production.

## Known-Good Source Extraction (Git Archaeology)

### Canonical restoration target: commit `4c156c3`

This is the direct parent of the destructive merge `5582442`. Phase 15 VERIFICATION (2026-04-16T08:31:00Z) and Phase 16 VERIFICATION (2026-04-16T11:45:00Z) both ran against this tree state.

**Verification that `4c156c3` is the right target:**
1. `git merge-base 5582442 4c156c3` → `4c156c376eee9ceb693e25ea4cc0e5d3e401e79e` (i.e., `4c156c3` IS the merge base; `5582442` was a fast-forward from its sibling branch, NOT a merge of two diverged branches).
2. `git diff --stat f0664ef..4c156c3 -- src/proactive/{sweep,state,prompts}.ts` → zero changes. All commits between Phase 16-05's last feat commit (`f0664ef`) and `4c156c3` were doc-only.
3. `git show 4c156c3:src/proactive/sweep.ts | wc -l` → 417 lines — matches Phase 16 VERIFICATION's citation of "sweep.ts:179+ escalation block" (Phase 15 cited 311 lines before Phase 16 added ~106 lines for escalation; 311 + 106 ≈ 417).
4. `git show 4c156c3:src/proactive/state.ts | wc -l` → 171 lines — superset of current (91) with channel-aware + escalation helpers.
5. `git show 4c156c3:src/proactive/prompts.ts | wc -l` → 77 lines — superset of current (29) with `ACCOUNTABILITY_SYSTEM_PROMPT` + `ACCOUNTABILITY_FOLLOWUP_PROMPT`.

### Extraction table — which file from which commit

| File | Current state | Canonical source | Restore command | Line count (canonical → current) |
|------|--------------|------------------|-----------------|----------------------------------|
| `src/proactive/sweep.ts` | 186 lines, single-channel, no deadline trigger, no escalation | `4c156c3` | `git show 4c156c3:src/proactive/sweep.ts > src/proactive/sweep.ts` | 417 → 186 (restore +231) |
| `src/proactive/state.ts` | 91 lines, legacy helpers only | `4c156c3` | `git show 4c156c3:src/proactive/state.ts > src/proactive/state.ts` | 171 → 91 (restore +80) |
| `src/proactive/prompts.ts` | 29 lines, only `PROACTIVE_SYSTEM_PROMPT` | `4c156c3` | `git show 4c156c3:src/proactive/prompts.ts > src/proactive/prompts.ts` | 77 → 29 (restore +48) |
| `src/proactive/triggers/types.ts` | Missing `'decision-deadline'` in `triggerType` union | `4c156c3` | `git show 4c156c3:src/proactive/triggers/types.ts > src/proactive/triggers/types.ts` | 19 → 18 lines (1-line fix) |
| `src/proactive/__tests__/deadline.test.ts` | MISSING from tree | `4c156c3` | `git show 4c156c3:src/proactive/__tests__/deadline.test.ts > src/proactive/__tests__/deadline.test.ts` | 290 lines, 12 tests |
| `src/proactive/__tests__/sweep-escalation.test.ts` | MISSING from tree | `4c156c3` | `git show 4c156c3:src/proactive/__tests__/sweep-escalation.test.ts > src/proactive/__tests__/sweep-escalation.test.ts` | 516 lines |
| `src/proactive/__tests__/state.test.ts` | 198 lines (legacy tests only) | `4c156c3` | `git show 4c156c3:src/proactive/__tests__/state.test.ts > src/proactive/__tests__/state.test.ts` | 287 → 198 (restore +89; adds 15 channel/escalation tests) |
| `src/proactive/__tests__/sweep.test.ts` | 649 lines (single-pipeline mock stack) | `4c156c3` | `git show 4c156c3:src/proactive/__tests__/sweep.test.ts > src/proactive/__tests__/sweep.test.ts` | 901 → 649 (full dual-channel test rewrite; current tests will NOT survive restoration — all single-pipeline mocks must be replaced) |
| `scripts/test.sh` | 39 lines, applies only 0000 + 0001 migrations | `4c156c3` | `git show 4c156c3:scripts/test.sh > scripts/test.sh && chmod +x scripts/test.sh` | 60 → 39 (restores application of 0002/0003/0004 + `ON_ERROR_STOP=1`) |

### Alternative commits considered (and rejected)

| Candidate | Status | Why rejected / accepted |
|-----------|--------|-------------------------|
| `b95f2f4` (Phase 15-03 dual-channel sweep only) | Rejected | Does not contain Phase 16-05 escalation block — would leave RES-06 unsatisfied |
| `c397ed1` / `f0664ef` (Phase 16-05 escalation tips) | Functionally equivalent to `4c156c3` for these 3 files — but `4c156c3` is later and has no differing content, so use `4c156c3` as the single coordination point |
| `fbf8a9a` / `be2d651` (state.ts / prompts.ts tips) | Same logic — superseded by `4c156c3` |
| `3eb07fa` (Phase 15 CR-01 deadline.ts guard) | N/A — fixes deadline.ts, but e4cb9da already restored deadline.ts; verify current deadline.ts has the CR-01 guard |
| `43811e3` (perf: cache_control placement) | N/A — pre-Phase 15; patterns retained in canonical sweep |

### Current `deadline.ts` CR-01 fix verification

Phase 15 CR-01 fix (`3eb07fa`) guarded fragile evidence string parsing. Current `src/proactive/triggers/deadline.ts` was restored by `e4cb9da` — verify it contains the guard by inspecting the evidence-string-based decision-ID extraction in restored `sweep.ts`:

The restored sweep.ts (canonical) contains the parsing logic:
```typescript
const evidenceEntry = deadlineResult.evidence?.[0];
if (!evidenceEntry || !evidenceEntry.startsWith('Decision ID: ')) {
  logger.error({ evidence: deadlineResult.evidence }, 'proactive.sweep.accountability.error');
} else {
  const decisionId = evidenceEntry.replace('Decision ID: ', '');
  ...
}
```
This is the same guard pattern introduced by CR-01. No separate action needed — restoring sweep.ts from `4c156c3` includes the fix.

## Target Contracts (exact exports required)

### `src/proactive/state.ts` (171 lines)

Existing exports (preserved verbatim from current 91-line file):
```typescript
export async function getLastSent(): Promise<Date | null>
export async function setLastSent(timestamp: Date): Promise<void>
export async function hasSentToday(timezone: string): Promise<boolean>
export async function getMuteUntil(): Promise<Date | null>
export async function setMuteUntil(until: Date | null): Promise<void>
export async function isMuted(): Promise<boolean>
```

New exports added by restoration:
```typescript
// ── Channel-aware state helpers ────────────────────────────────────────────
export async function hasSentTodayReflective(timezone: string): Promise<boolean>
export async function setLastSentReflective(timestamp: Date): Promise<void>
export async function hasSentTodayAccountability(timezone: string): Promise<boolean>
export async function setLastSentAccountability(timestamp: Date): Promise<void>

// ── Per-decision escalation tracking (RES-06) ────────────────────────────
export async function getEscalationSentAt(decisionId: string): Promise<Date | null>
export async function setEscalationSentAt(decisionId: string, timestamp: Date): Promise<void>
export async function getEscalationCount(decisionId: string): Promise<number>
export async function setEscalationCount(decisionId: string, count: number): Promise<void>
export async function clearEscalationKeys(decisionId: string): Promise<void>
```

**NOTE:** Phase 19 ROADMAP success criterion 1 lists `setEscalationContext` and `getEscalationContext` as required. However, the canonical state.ts at `4c156c3` does NOT export these — Phase 16 VERIFICATION line 51 mentioned them as "bonus" exports, but code inspection of `4c156c3:src/proactive/state.ts` shows they do not exist. The actual `4c156c3:src/proactive/sweep.ts` never calls them either. Treat the ROADMAP mention as an optimistic claim — the running code at `4c156c3` did NOT depend on these, and restoration from `4c156c3` will not include them. If the plan-phase decides to add them for symmetry, they are trivial additions, but they are NOT required to satisfy any Phase 19 success criterion or any requirement in REQUIREMENTS.md. `[VERIFIED: git show 4c156c3:src/proactive/state.ts | grep -c EscalationContext → 0]`

New key constants (internal):
```typescript
const LAST_SENT_REFLECTIVE_KEY = 'last_sent_reflective'
const LAST_SENT_ACCOUNTABILITY_KEY = 'last_sent_accountability'
const escalationSentKey = (decisionId: string) => `accountability_sent_${decisionId}`
const escalationCountKey = (decisionId: string) => `accountability_prompt_count_${decisionId}`
```

### `src/proactive/prompts.ts` (77 lines)

Existing exports (preserved verbatim):
```typescript
export const PROACTIVE_SYSTEM_PROMPT = `...`  // reflective channel (unchanged)
```

New exports added by restoration:
```typescript
export const ACCOUNTABILITY_SYSTEM_PROMPT = `You are Chris. Greg made a prediction with a specific deadline...`  // with {triggerContext} placeholder, flattery guard ("NEVER say: impressive, good job..."), condemnation guard ("NEVER say: I'm disappointed, you failed..."), Hard Rule compliance
export const ACCOUNTABILITY_FOLLOWUP_PROMPT = `You are Chris. A couple of days ago, you asked Greg about a prediction...`  // for 48h escalation; "couple days ago" natural phrasing per D-18
```

### `src/proactive/sweep.ts` (417 lines)

Existing export (preserved with additions):
```typescript
export async function runSweep(): Promise<SweepResult>  // signature unchanged, body rewritten
```

Interface additions:
```typescript
export interface ChannelResult {
  triggered: boolean;
  triggerType?: string;
  message?: string;
}
// Existing SweepResult gains two optional fields:
export interface SweepResult {
  triggered: boolean;
  triggerType?: string;   // unchanged — backward-compat: accountability's type if fired, else reflective's
  message?: string;       // unchanged — backward-compat
  skippedReason?: 'muted' | 'already_sent_today' | 'no_trigger' | 'insufficient_data';
  accountabilityResult?: ChannelResult;  // NEW
  reflectiveResult?: ChannelResult;      // NEW
}
```

Internal helper (not exported):
```typescript
async function runReflectiveChannel(fired, startMs): Promise<ChannelResult>
```

New imports required (all already in project):
```typescript
import { hasSentTodayReflective, setLastSentReflective, hasSentTodayAccountability, setLastSentAccountability, getEscalationSentAt, setEscalationSentAt, getEscalationCount, setEscalationCount, clearEscalationKeys } from './state.js';
import { ACCOUNTABILITY_SYSTEM_PROMPT, ACCOUNTABILITY_FOLLOWUP_PROMPT } from './prompts.js';
import { createDeadlineTrigger } from './triggers/deadline.js';
import { upsertAwaitingResolution, clearCapture } from '../decisions/capture-state.js';
import { getLastUserLanguage } from '../chris/language.js';  // imported in canonical but unused — leave as-is for fidelity
import { transitionDecision } from '../decisions/lifecycle.js';
import { decisionCaptureState, decisions } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
```

### `src/proactive/triggers/types.ts` (19 lines)

One-line fix — add `'decision-deadline'` to the union:
```typescript
// Before (current, 18 lines):
triggerType: 'silence' | 'commitment' | 'pattern' | 'thread';
// After (canonical, 19 lines):
triggerType: 'silence' | 'commitment' | 'pattern' | 'thread' | 'decision-deadline';
```

### Consumer verification (callers that must keep working)

| Consumer | File | Import | Post-restoration behavior |
|----------|------|--------|---------------------------|
| Engine (mute control) | `src/chris/engine.ts:69` | `import { setMuteUntil } from '../proactive/state.js'` | Preserved verbatim in canonical state.ts |
| Resolution handler (cleanup) | `src/decisions/resolution.ts:336,395` | Dynamic: `await import('../proactive/state.js')` + `typeof clearEscalationKeys === 'function'` guard | Guard becomes true on first call post-restoration; escalation keys for resolved decisions get cleaned up (currently silently leaked) |
| Synthetic fixture TEST-12 | `src/decisions/__tests__/synthetic-fixture.test.ts:155-181` | Mocks `createDeadlineTrigger`, `upsertAwaitingResolution` | **WILL BREAK** — see Test Landscape section |
| Sweep tests | `src/proactive/__tests__/sweep.test.ts` | Mocks `isMuted, hasSentToday, setLastSent` (single-channel) | **WILL BREAK** — entire test file must be replaced with canonical 901-line version |
| State tests | `src/proactive/__tests__/state.test.ts` | Tests legacy helpers only | **SURVIVES + EXTENDS** — legacy helpers preserved; canonical version adds 15 new channel/escalation tests |
| live-accountability.test.ts | `src/decisions/__tests__/live-accountability.test.ts` | Imports `upsertAwaitingResolution` directly, bypasses sweep | **UNAFFECTED** |
| vague-validator-live.test.ts | `src/decisions/__tests__/vague-validator-live.test.ts` | Unrelated to sweep | **UNAFFECTED** |

## Architecture Patterns

### System Architecture Diagram — runSweep() after restoration

```
┌─────────────────┐
│  Cron scheduler │  (external to Node — app-level node-cron or systemd timer)
└────────┬────────┘
         │ every N minutes
         v
┌──────────────────────────────────────────────────────────────┐
│  runSweep()                                                   │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  1. isMuted()? ──YES──> return {skipped: 'muted'}       │   │ global mute gates BOTH channels
│  └─────────────┬──────────────────────────────────────────┘   │
│                │ NO                                             │
│                v                                                │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  ACCOUNTABILITY CHANNEL (runs first per D-05)           │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │  hasSentTodayAccountability(tz)?                  │   │   │
│  │  │    ─ YES → skip channel (but not sweep)           │   │   │
│  │  │    ─ NO  → createDeadlineTrigger().detect()       │──┼──┼──> Postgres: decisions WHERE status='open' AND resolve_by<=now ORDER BY resolve_by ASC LIMIT 1
│  │  │             └ if triggered:                       │   │   │  (also: transitionDecision(id, 'open', 'due'))
│  │  │               - build ACCOUNTABILITY_SYSTEM_PROMPT │   │   │
│  │  │               - anthropic.messages.create (Sonnet) │──┼──┼──> Anthropic API
│  │  │               - upsertAwaitingResolution(chatId,   │──┼──┼──> Postgres: decision_capture_state UPSERT
│  │  │                 decisionId) BEFORE send            │   │   │
│  │  │               - bot.api.sendMessage                │──┼──┼──> Telegram
│  │  │               - saveMessage(ASSISTANT, JOURNAL)    │──┼──┼──> Postgres: conversations
│  │  │               - setLastSentAccountability(now)     │──┼──┼──> Postgres: proactive_state[last_sent_accountability]
│  │  │               - setEscalationSentAt(id, now)       │──┼──┼──> Postgres: proactive_state[accountability_sent_<id>]
│  │  │               - setEscalationCount(id, 1)          │──┼──┼──> Postgres: proactive_state[accountability_prompt_count_<id>]
│  │  └──────────────────────────────────────────────────┘   │   │
│  │  try/catch — errors isolated from reflective channel     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  ESCALATION BLOCK (runs ALWAYS — outside daily cap)     │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │  FOR EACH row in decision_capture_state           │──┼──┼──> Postgres: WHERE stage='AWAITING_RESOLUTION'
│  │  │  WHERE stage='AWAITING_RESOLUTION':               │   │   │
│  │  │    sentAt = getEscalationSentAt(decisionId)       │   │   │
│  │  │    count  = getEscalationCount(decisionId)        │   │   │
│  │  │    ─ sentAt == null → bootstrap (set to now, 1)   │   │   │  (first-sweep race; rare)
│  │  │    ─ hours < 48    → wait                          │   │   │
│  │  │    ─ count >= 2    → transitionDecision('stale')   │──┼──┼──> Postgres: decisions.status='stale'
│  │  │                       clearCapture(chatId)          │──┼──┼──> Postgres: decision_capture_state DELETE
│  │  │                       clearEscalationKeys(id)       │──┼──┼──> Postgres: proactive_state DELETE keys
│  │  │    ─ count == 1    → send ACCOUNTABILITY_FOLLOWUP   │──┼──┼──> Anthropic + Telegram + setEscalationCount(2)
│  │  └──────────────────────────────────────────────────┘   │   │
│  │  try/catch — errors isolated from reflective channel     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │  REFLECTIVE CHANNEL (independent per D-05)              │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │  hasSentTodayReflective(tz)?                      │   │   │  (falls back to legacy 'last_sent' key for migration safety)
│  │  │    ─ YES → skip channel                           │   │   │
│  │  │    ─ NO  → Phase 1: silence + commitment parallel │   │   │
│  │  │             ├ if any fired → short-circuit        │   │   │
│  │  │             └ else → Phase 2: pattern + thread    │   │   │  (Opus analysis)
│  │  │           → runReflectiveChannel(fired):          │   │   │
│  │  │              - select lowest-priority winner       │   │   │
│  │  │              - PROACTIVE_SYSTEM_PROMPT + Sonnet    │──┼──┼──> Anthropic
│  │  │              - bot.api.sendMessage                 │──┼──┼──> Telegram
│  │  │              - saveMessage                         │──┼──┼──> Postgres
│  │  │              - setLastSentReflective(now)          │──┼──┼──> Postgres: proactive_state[last_sent_reflective]
│  │  └──────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Return: { triggered, triggerType, message, accountabilityResult, reflectiveResult, skippedReason } │
└──────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (already in place post-restoration)
```
src/
├── proactive/
│   ├── sweep.ts             # orchestrator: dual-channel + escalation
│   ├── state.ts             # KV helpers: legacy + channel-aware + per-decision escalation
│   ├── prompts.ts           # PROACTIVE_SYSTEM_PROMPT + ACCOUNTABILITY_SYSTEM_PROMPT + ACCOUNTABILITY_FOLLOWUP_PROMPT
│   ├── mute.ts              # (unchanged, unrelated)
│   ├── context-builder.ts   # (unchanged, unrelated)
│   ├── triggers/
│   │   ├── types.ts         # TriggerResult / TriggerDetector — +'decision-deadline' union member
│   │   ├── deadline.ts      # (already restored by e4cb9da)
│   │   ├── silence.ts       # (unchanged)
│   │   ├── commitment.ts    # (unchanged)
│   │   ├── pattern.ts       # (unchanged)
│   │   ├── thread.ts        # (unchanged)
│   │   └── opus-analysis.ts # (unchanged)
│   └── __tests__/
│       ├── state.test.ts           # REPLACE with canonical (287 lines, 23 tests)
│       ├── sweep.test.ts           # REPLACE with canonical (901 lines, 29 tests)
│       ├── deadline.test.ts        # ADD from canonical (290 lines, 12 tests)
│       ├── sweep-escalation.test.ts # ADD from canonical (516 lines)
│       ├── mute.test.ts            # (unchanged)
│       ├── silence.test.ts         # (unchanged)
│       ├── commitment.test.ts      # (unchanged)
│       ├── opus-analysis.test.ts   # (unchanged)
│       └── context-builder.test.ts # (unchanged)
```

### Pattern 1: Channel-aware daily-cap with legacy fallback
**What:** Reflective channel checks a NEW key (`last_sent_reflective`) first; if absent, falls back to the legacy `last_sent` key for migration safety (D-07).
**When to use:** When introducing a new channel keyed separately from a pre-existing global cap.
**Example** (from `4c156c3:src/proactive/state.ts:100-110`):
```typescript
export async function hasSentTodayReflective(timezone: string): Promise<boolean> {
  const reflectiveVal = await getValue(LAST_SENT_REFLECTIVE_KEY);
  const val = reflectiveVal ?? (await getValue(LAST_SENT_KEY));  // legacy fallback
  if (val == null) return false;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(new Date(val as string)) === formatter.format(new Date());
}
```
Source: `git show 4c156c3:src/proactive/state.ts`

### Pattern 2: Write-before-send for resolution routing
**What:** The `upsertAwaitingResolution(chatId, decisionId)` call MUST happen BEFORE `bot.api.sendMessage`. If send fails, the state row still exists — but Phase 16's engine PP#0 will route Greg's eventual reply to the handler, which is the correct behavior (Greg's reply closes out the awaiting row).
**When to use:** Whenever sending a message whose reply must be routed based on persistent state.
**Example** (from canonical sweep.ts, accountability channel):
```typescript
await upsertAwaitingResolution(BigInt(config.telegramAuthorizedUserId), decisionId);
await bot.api.sendMessage(config.telegramAuthorizedUserId, messageText);
await saveMessage(...);
await setLastSentAccountability(new Date());
await setEscalationSentAt(decisionId, new Date());
await setEscalationCount(decisionId, 1);
```

### Pattern 3: Escalation state machine via KV counter
**What:** Per-decision escalation tracked as two KV keys per decision. Count=1 after initial prompt, count=2 after first follow-up, transition to `stale` when count≥2 AND 48h elapsed.
**Why counter, not boolean:** Allows future extension (count=3 for second follow-up, etc.) without schema change; allows distinguishing "never prompted" (count=0) from "prompted once" (count=1).
**Example** (from canonical sweep.ts escalation block):
```typescript
const sentAt = await getEscalationSentAt(row.decisionId);
const count = await getEscalationCount(row.decisionId);
if (sentAt === null) { await setEscalationSentAt(row.decisionId, new Date()); await setEscalationCount(row.decisionId, 1); continue; }
const hoursSinceSent = (Date.now() - sentAt.getTime()) / 3_600_000;
if (hoursSinceSent < 48) continue;
if (count >= 2) { transitionDecision('due','stale'); clearCapture(chatId); clearEscalationKeys(id); continue; }
if (count === 1) { /* send follow-up, setEscalationCount(id, 2), setEscalationSentAt(id, now) */ }
```

### Anti-Patterns to Avoid
- **Rewriting instead of restoring:** The code already exists and was verified. Re-derivation introduces risk of subtle behavior drift from the state that Phase 15/16 VERIFICATION validated.
- **Testing against the degraded contract:** TEST-12 currently asserts single-pipeline priority ordering. Keeping this assertion after restoration locks in the regression. The test must be realigned to assert channel separation.
- **Bypass-by-mocking:** The `live-accountability.test.ts` currently calls `upsertAwaitingResolution + handleResolution` directly, skipping sweep entirely. This was a workaround for the sweep gap; the test is still valid (it tests handler-in-isolation) but MUST NOT be the only integration coverage. Sweep-level integration must be re-established.
- **Ignoring `scripts/test.sh` degradation:** If only source files are restored but `scripts/test.sh` still applies only migrations 0000+0001, the decisions table won't exist when sweep tests try to run against Postgres.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| KV state persistence | Custom in-memory cache | Existing `proactiveState` table via drizzle (`getValue/setValue/deleteKey` already in state.ts) | Atomicity + restart safety |
| Day-boundary calculation | Manual timezone math | `Intl.DateTimeFormat('en-CA', { timeZone })` pattern from existing `hasSentToday` | Battle-tested; already the project idiom |
| Decision lifecycle transitions | Direct `UPDATE decisions SET status=...` | `transitionDecision(id, fromStatus, toStatus, {actor})` | Optimistic concurrency + append-only `decision_events` + InvalidTransitionError enforcement — Phase 13's entire point |
| Migration snapshot backfill | Hand-edit JSON | `drizzle-kit generate` against live Postgres | The snapshot format changes across drizzle-kit versions; only the CLI knows what `version: "7"` snapshots should look like for current schema |
| Restoring source from git | Manual copy-paste from GitHub UI | `git show 4c156c3:<path> > <path>` | Preserves exact bytes (whitespace, line endings); no human transcription error |

**Key insight:** Every target in this phase has a known-good canonical version at `4c156c3`. There is no custom code to write — only bytes to copy and one type-union member to add.

## Test Landscape

### Tests currently GREEN (must stay GREEN after restoration)

| File | Status | Post-restoration |
|------|--------|------------------|
| `src/proactive/__tests__/mute.test.ts` | GREEN | UNAFFECTED — tests `detectMuteIntent`/`parseMuteDuration`/`generateMuteAcknowledgment` in mute.ts, independent of state.ts changes |
| `src/proactive/__tests__/silence.test.ts` | GREEN | UNAFFECTED |
| `src/proactive/__tests__/commitment.test.ts` | GREEN | UNAFFECTED |
| `src/proactive/__tests__/opus-analysis.test.ts` | GREEN | UNAFFECTED |
| `src/proactive/__tests__/context-builder.test.ts` | GREEN | UNAFFECTED |
| `src/proactive/__tests__/state.test.ts` (current) | GREEN (tests legacy helpers only) | SURVIVES + EXTENDS — legacy helpers preserved verbatim; canonical file adds 15 channel/escalation tests |
| `src/decisions/__tests__/live-accountability.test.ts` | GREEN (requires ANTHROPIC_API_KEY; skipped in CI) | UNAFFECTED — bypasses sweep, imports `upsertAwaitingResolution + handleResolution` directly |
| `src/decisions/__tests__/vague-validator-live.test.ts` | GREEN (requires API key) | UNAFFECTED |
| All Phase 13 tests (schema, lifecycle, concurrency, regenerate, chokepoint-audit) | GREEN | UNAFFECTED |
| All Phase 14 tests (capture, resolve-by, vague-validator, engine-capture, triggers, suppressions) | GREEN | UNAFFECTED |
| All Phase 16 tests (resolution, engine-resolution, personality) | GREEN | UNAFFECTED — Phase 16 tests pass because resolution.ts's `clearEscalationKeys` call is guarded; post-restoration the guard simply finds the function and runs it, which is still safe |
| All Phase 17 tests (stats, decisions-command, classify-accuracy) | GREEN | UNAFFECTED |

### Tests currently GREEN against DEGRADED contract (WILL BREAK on restoration — must be rewritten)

| File | Current assertion | Post-restoration target assertion |
|------|-------------------|-----------------------------------|
| `src/proactive/__tests__/sweep.test.ts` | Single-pipeline: mocks `isMuted, hasSentToday, setLastSent`; tests priority-ordering across silence/commitment/pattern/thread; 22 tests | Dual-channel: mocks 18 entities including channel-aware state, deadline trigger, upsertAwaitingResolution, escalation state, transitionDecision, db.select; tests accountability channel in isolation, reflective channel in isolation, channel independence (both fire, accountability first, error isolation); 29 tests → **FULL REPLACEMENT with canonical** |
| `src/decisions/__tests__/synthetic-fixture.test.ts` TEST-12 | "deadline and silence triggers both fire; single-pipeline selects highest-priority winner without starvation" — asserts `result.triggerType === 'silence'` and `mockSendMessage` called once | Channel-separation: asserts BOTH channels fire, accountability first; `mockSendMessage` called TWICE (one accountability, one reflective); `result.accountabilityResult.triggered === true` AND `result.reflectiveResult.triggered === true`; `result.accountabilityResult.triggerType === 'decision-deadline'` AND `result.reflectiveResult.triggerType === 'silence'` — **REWRITE test body** |

### Tests currently MISSING (must be ADDED)

| File | Content |
|------|---------|
| `src/proactive/__tests__/deadline.test.ts` (290 lines) | 12 tests covering: open-due decision detection, oldest-first ordering, no-due-decisions path, concurrency (OptimisticConcurrencyError retry, InvalidTransitionError silent-skip), priority assertion (=2), stale-context dating (>48h explicit date; ≤48h implicit "just passed"), transitionDecision call with actor: 'sweep' |
| `src/proactive/__tests__/sweep-escalation.test.ts` (516 lines) | Tests for: 48h elapsed + count=1 → send follow-up + setCount(2); 48h elapsed + count≥2 → transition stale + clearCapture + clearEscalationKeys + no send; <48h → no-op; bootstrapping (sentAt==null on first-sweep race); escalation error isolation from reflective channel; decision not found path |

### TEST-12 realignment (Phase 19 success criterion #6)

Current TEST-12 (at `synthetic-fixture.test.ts:504-553`):
```typescript
it('deadline and silence triggers both fire; single-pipeline selects highest-priority winner without starvation', ...);
// Asserts: result.triggerType === 'silence', mockSendMessage called 1 time
```

Realigned TEST-12 target (derived from Phase 18 PLAN 18-04's "Fix TEST-12 mock mismatch"):
```typescript
it('deadline and silence triggers both fire; channels fire serially without either starving the other', ...);
// Asserts:
//   result.triggered === true
//   result.accountabilityResult.triggered === true
//   result.accountabilityResult.triggerType === 'decision-deadline'
//   result.reflectiveResult.triggered === true
//   result.reflectiveResult.triggerType === 'silence'
//   mockSendMessage called 2 times (accountability message then reflective message)
//   Order check: accountability message is mockSendMessage's first call, reflective is second
//   mockUpsertAwaitingResolution called once with (chatId, decisionId)
//   setLastSentAccountability called once; setLastSentReflective called once
```

Mock stack realignment: add mocks for `hasSentTodayAccountability` (returns false), `setLastSentAccountability`, `hasSentTodayReflective` (returns false), `setLastSentReflective`, `getEscalationSentAt` (null), `setEscalationSentAt`, `getEscalationCount` (0), `setEscalationCount`, `clearEscalationKeys`, `upsertAwaitingResolution`, `transitionDecision`, `clearCapture`. LLM mock must be called TWICE (one accountability, one reflective) — replace `mockResolvedValueOnce` with two `.mockResolvedValueOnce` calls.

## Common Pitfalls

### Pitfall 1: `triggerType` union incomplete → build fails silently in editor, fails loudly in CI
**What goes wrong:** `deadline.ts` produces `TS2322: Type '"decision-deadline"' is not assignable to type '"pattern" | "silence" | "commitment" | "thread"'` — confirmed by running `npx tsc --noEmit` today (2 errors).
**Why it happens:** `e4cb9da` restored deadline.ts but NOT types.ts; current types.ts is pre-Phase-15.
**How to avoid:** Restore types.ts (1-line change) as part of the initial restoration wave — BEFORE restoring sweep.ts, because sweep.ts's type assertions will fail the same way.
**Warning signs:** `npx tsc --noEmit` before any restoration reports 2 errors on deadline.ts lines 51 and 110; after restoring types.ts only, should report 0 errors.

### Pitfall 2: Migration sequence gaps break Postgres tests
**What goes wrong:** `scripts/test.sh` in current state applies only migrations 0000 + 0001. Tests that use `decisions`, `decision_events`, `decision_capture_state`, `decision_trigger_suppressions` tables fail at DB setup with "relation does not exist" — not with sensible "schema mismatch" errors.
**Why it happens:** The worktree merge downgraded `scripts/test.sh` to a version predating Phase 13's migrations 0002-0004.
**How to avoid:** Restore `scripts/test.sh` from `4c156c3` (includes all 5 migrations + `ON_ERROR_STOP=1`). Verify by running `npm test` after restoration.
**Warning signs:** Tests referencing `decisions`/`decision_events` fail at setup with `relation ... does not exist`.

### Pitfall 3: Canonical sweep imports `getLastUserLanguage` but never calls it
**What goes wrong:** `4c156c3:src/proactive/sweep.ts` imports `getLastUserLanguage` from `../chris/language.js` but the function is unused in the file body (confirmed: `grep -n "getLastUserLanguage" 4c156c3:sweep.ts` shows import-only).
**Why it happens:** Phase 15 plan anticipated language-aware prompt composition in sweep, but the actual implementation handed language thread-through to the LLM via `PROACTIVE_SYSTEM_PROMPT`'s "ALWAYS write in the language Greg most recently used" instruction, so the helper was never needed.
**How to avoid:** Leave the import as-is — matches the verified canonical state exactly. TypeScript will NOT error on unused imports (the project does not appear to have `noUnusedLocals` enabled; confirm via `tsconfig.json` sample). If lint warns, suppress with `// eslint-disable-next-line` or drop the import — but document as minor tech debt.
**Warning signs:** If this is "fixed" by removing the import, the restored sweep no longer byte-matches `4c156c3`, which makes future diffing/bisecting harder.

### Pitfall 4: Escalation bootstrap race on first-sweep-after-restoration
**What goes wrong:** If a decision is in `AWAITING_RESOLUTION` when the restored sweep runs for the first time (unlikely in production since sweep has never worked, but possible in test scenarios), the escalation block finds `getEscalationSentAt(id) === null` and records `setEscalationSentAt(id, now); setEscalationCount(id, 1)` — but the INITIAL prompt was never actually sent. The follow-up will then fire 48h later, which Greg will experience as a confusing "I asked you about X" when no initial "X?" was ever sent.
**Why it happens:** The restored code sets both `setEscalationSentAt` AND `setEscalationCount(1)` inside the accountability channel at send-time (after Telegram send succeeds), AND also bootstraps them in the escalation block if null. If the row was written by some other path, bootstrap runs.
**How to avoid:** In production, this is a non-issue — all `AWAITING_RESOLUTION` rows are written by sweep itself, so sweep writes both the state row AND the escalation keys atomically-enough (within the same sweep tick). In tests, ensure test setup that seeds `decision_capture_state` ALSO seeds the escalation keys.
**Warning signs:** Test failures where `escalation.followup.sent` fires 48h after a bootstrapped row.

### Pitfall 5: Dynamic import path resolution in resolution.ts
**What goes wrong:** `resolution.ts` uses `await import('../proactive/state.js')` with a runtime `typeof === 'function'` guard. After restoration, the guard becomes true and `clearEscalationKeys` is called. If the import path is wrong (e.g., `./proactive/state.js` due to path error), the import silently fails, TS doesn't catch it (type is guarded), and escalation keys leak for every resolved decision.
**How to avoid:** The current resolution.ts:336 uses `'../proactive/state.js'` which is correct relative to `src/decisions/`. Verify after restoration by adding a test that resolves a decision and inspects `proactive_state` KV for absence of `accountability_sent_<id>` key.
**Warning signs:** Stale escalation keys accumulate in `proactive_state` over time.

### Pitfall 6: Drizzle `_journal.json` references entries whose snapshots don't exist
**What goes wrong:** `src/db/migrations/meta/_journal.json` (both current and canonical) lists entries for 0000, 0001, 0002, 0003, 0004 — but `meta/` contains only 0000, 0002, 0004 snapshots. Running `drizzle-kit generate` may fail or misbehave because it can't diff against missing 0001 and 0003 snapshots.
**Why it happens:** Migration 0001 was added as a hand-written SQL file (`0001_add_photos_psychology_mode.sql`, 152 bytes — a single enum value addition), never via `drizzle-kit generate`, so no snapshot was produced. Migration 0003 is similarly hand-written (72 bytes, another enum value addition). The `_journal.json` was later updated to reference them, but snapshots were never created.
**How to avoid:** After restoring the three main files, regenerate snapshots as a separate wave. Options:
  - **A (preferred):** Run `npx drizzle-kit generate` against a live Postgres with migrations 0000-0004 applied. This writes fresh snapshots for whatever the current schema state looks like. May produce a new 0005 migration if schema-vs-snapshot has drifted — inspect and discard if spurious.
  - **B (if A fails):** Manually construct snapshots by inspecting the schema + enum values. High risk of version-format drift; avoid.
  - **C (acceptable fallback):** Document the gap; runtime migrator doesn't need the snapshots; defer to next phase where schema changes force regeneration.
**Warning signs:** `drizzle-kit generate` errors or produces nonsense diffs; CI doesn't fail (runtime migrator unaffected).

## Code Examples

### Example 1: Restoring a file byte-exact from a specific commit
```bash
# Restore all 4 source files + 1 type file + 1 script + 4 test files from canonical 4c156c3
CANON=4c156c3
for f in \
  src/proactive/sweep.ts \
  src/proactive/state.ts \
  src/proactive/prompts.ts \
  src/proactive/triggers/types.ts \
  src/proactive/__tests__/state.test.ts \
  src/proactive/__tests__/sweep.test.ts \
  src/proactive/__tests__/deadline.test.ts \
  src/proactive/__tests__/sweep-escalation.test.ts \
  scripts/test.sh \
; do
  git show "$CANON:$f" > "$f"
done
chmod +x scripts/test.sh
# Verify byte-exact
git diff --stat "$CANON" -- \
  src/proactive/sweep.ts src/proactive/state.ts src/proactive/prompts.ts \
  src/proactive/triggers/types.ts scripts/test.sh \
  src/proactive/__tests__/state.test.ts src/proactive/__tests__/sweep.test.ts \
  src/proactive/__tests__/deadline.test.ts src/proactive/__tests__/sweep-escalation.test.ts
# Expected output: empty (no diff vs canonical)
```
Source: standard git archaeology; `git show <commit>:<path>` prints file contents at that revision.

### Example 2: Regenerating missing snapshots
```bash
# 1. Ensure a clean Postgres with migrations applied
bash scripts/test.sh --reporter=verbose --run src/decisions/__tests__/schema.test.ts
# (starts docker-compose postgres, runs all 5 migrations, runs minimal schema test)

# 2. Generate snapshot diff
DATABASE_URL="postgresql://chris:localtest123@localhost:5433/chris" \
  npx drizzle-kit generate --name=snapshot_backfill

# 3. Inspect output:
# - If a NEW migration file appears (e.g., 0005_snapshot_backfill.sql) → delete it; it's spurious drift
# - Two new files should appear: meta/0001_snapshot.json (reconstructed) AND meta/0003_snapshot.json
# - Verify meta/ now has snapshots for all 5 entries in _journal.json
ls src/db/migrations/meta/
# Expected: 0000_snapshot.json  0001_snapshot.json  0002_snapshot.json  0003_snapshot.json  0004_snapshot.json  _journal.json
```
Note: This approach is speculative. Drizzle-kit may not generate snapshots for missing entries on-the-fly; it typically only writes the snapshot for the NEW migration. If this doesn't work, fallback is manual construction or deferred fix.

### Example 3: Canonical escalation block (from `4c156c3:src/proactive/sweep.ts`)
```typescript
// ── ESCALATION: check AWAITING_RESOLUTION rows for 48h non-reply (RES-06) ──
// Runs OUTSIDE the daily cap check — escalation is follow-up, not cold outreach.
try {
  const awaitingRows = await db
    .select({
      chatId: decisionCaptureState.chatId,
      decisionId: decisionCaptureState.decisionId,
    })
    .from(decisionCaptureState)
    .where(eq(decisionCaptureState.stage, 'AWAITING_RESOLUTION'));

  for (const row of awaitingRows) {
    if (!row.decisionId) continue;
    const sentAt = await getEscalationSentAt(row.decisionId);
    const count = await getEscalationCount(row.decisionId);

    if (sentAt === null) {
      await setEscalationSentAt(row.decisionId, new Date());
      await setEscalationCount(row.decisionId, 1);
      continue;
    }
    const hoursSinceSent = (Date.now() - sentAt.getTime()) / 3_600_000;
    if (hoursSinceSent < 48) continue;

    if (count >= 2) {
      try {
        await transitionDecision(row.decisionId, 'due', 'stale', { actor: 'sweep' });
      } catch (err) {
        logger.warn({ err, decisionId: row.decisionId }, 'proactive.sweep.escalation.stale.failed');
      }
      await clearCapture(row.chatId);
      await clearEscalationKeys(row.decisionId);
      logger.info({ decisionId: row.decisionId }, 'proactive.sweep.escalation.stale');
      continue;
    }

    if (count === 1) {
      // 48h passed, first prompt sent, no reply → send follow-up
      const [decision] = await db.select().from(decisions).where(eq(decisions.id, row.decisionId)).limit(1);
      if (!decision) continue;
      const triggerContext = `Prediction: ${decision.prediction || decision.decisionText}\nFalsification criterion: ${decision.falsificationCriterion}\nDeadline: ${decision.resolveBy?.toISOString().slice(0, 10) ?? 'unknown'}`;
      const followUpPrompt = ACCOUNTABILITY_FOLLOWUP_PROMPT.replace('{triggerContext}', triggerContext);
      // ... Sonnet + Telegram + setEscalationCount(2) + setEscalationSentAt(now)
    }
  }
} catch (err) {
  logger.error({ err }, 'proactive.sweep.escalation.error');
}
```
Source: `git show 4c156c3:src/proactive/sweep.ts` lines 159-230 (abbreviated).

## Restoration Ordering Validation

The ROADMAP proposes 4 plans: `state.ts → prompts.ts → sweep.ts → migrations/TEST-12`. Validating this order:

### Dependency graph
```
types.ts (add 'decision-deadline' to union) ─┐
                                              ├─→ sweep.ts can import createDeadlineTrigger without TS errors
deadline.ts (already restored by e4cb9da)  ──┘

state.ts (add channel-aware + escalation exports) ─→ sweep.ts can import all channel/escalation helpers
                                                  └→ resolution.ts dynamic import guard becomes true

prompts.ts (add ACCOUNTABILITY_SYSTEM_PROMPT + ACCOUNTABILITY_FOLLOWUP_PROMPT) ─→ sweep.ts can import and use

capture-state.ts (unchanged — upsertAwaitingResolution, clearCapture already exist) ─→ sweep.ts can import

language.ts (unchanged — getLastUserLanguage exists) ─→ sweep.ts can import (even though unused)

lifecycle.ts (unchanged — transitionDecision exists) ─→ sweep.ts can import

schema.ts (unchanged — decisionCaptureState, decisions tables defined) ─→ sweep.ts can import
connection.ts (unchanged — db exported) ─→ sweep.ts can import
```

### Circular import check
- `sweep.ts` imports from: `state.ts`, `prompts.ts`, `triggers/*`, `capture-state.ts`, `lifecycle.ts`, `language.ts`, `db/*`
- `state.ts` imports from: `db/connection.ts`, `db/schema.ts`, `drizzle-orm`
- `prompts.ts` imports from: (nothing)
- `triggers/deadline.ts` imports from: `db/connection.ts`, `db/schema.ts`, `decisions/lifecycle.ts`, `decisions/errors.ts`, `./types.ts`
- None of the consumed modules (`capture-state.ts`, `lifecycle.ts`, `language.ts`) import from `sweep.ts` or `state.ts` or `prompts.ts`. No cycles.

### Ordering refinement — proposed plan sequence

Based on the dependency graph, the mechanically-safest order is:

1. **Plan 19-01:** Restore `types.ts` (1-line union fix) + `state.ts` (add 10 exports). Verify: `npx tsc --noEmit` → 0 errors; `state.test.ts` (canonical) GREEN against restored state.ts. Commit.
2. **Plan 19-02:** Restore `prompts.ts` (add 2 exports). Verify: `npx tsc --noEmit` → 0 errors; manual grep confirms `ACCOUNTABILITY_SYSTEM_PROMPT` exported. Commit. *(Could be merged into 19-01 since it's a no-dependency leaf, but keeping separate per ROADMAP for atomic per-requirement commits.)*
3. **Plan 19-03:** Restore `sweep.ts` (full dual-channel + escalation). Simultaneously replace `sweep.test.ts` and ADD `deadline.test.ts` + `sweep-escalation.test.ts`. Verify: `npx tsc --noEmit` → 0 errors; all 4 proactive test files GREEN against Docker Postgres. Commit.
4. **Plan 19-04:** Restore `scripts/test.sh` (missing migrations + ON_ERROR_STOP). Realign TEST-12 in `synthetic-fixture.test.ts`. Regenerate snapshots (if feasible). Verify: full `npm test` GREEN. Commit.

**Note:** ROADMAP lists state.ts as 19-01, prompts.ts as 19-02, sweep.ts as 19-03, migrations+TEST-12 as 19-04. The ordering above matches. The additions (types.ts fix, scripts/test.sh restore) can be folded into 19-01 and 19-04 respectively without changing the plan count.

## Migration Snapshot Strategy

**Decision input:** Both Option A (regenerate via drizzle-kit) and Option C (defer) are acceptable. Option B (manual backfill from git history) is ruled out — git history shows these snapshots were DELETED by commit `dd1d1d9` (Mar 28, during migration consolidation) for the OLD schema; they were never re-created for the current migration sequence (0000 → 0001 → 0002 → 0003 → 0004).

**Preferred: Option A — `drizzle-kit generate` against live Postgres**

Steps:
1. Start Docker Postgres via `docker-compose -f docker-compose.local.yml up -d postgres`.
2. Apply all 5 migrations manually: `psql ... < 0000_*.sql && psql ... < 0001_*.sql && ... < 0004_*.sql` (or restore test.sh first and use it).
3. Run `DATABASE_URL=... npx drizzle-kit generate --name=snapshot_backfill`.
4. Inspect output:
   - Expected: New snapshot files `meta/0001_snapshot.json` and `meta/0003_snapshot.json` materialize — OR drizzle-kit writes a new migration because schema has drifted. Document whichever happens.
   - If a new migration file is produced (e.g., `0005_*.sql`), inspect its content. If it's empty or only contains noise (e.g., timestamp metadata), delete both the new migration file and its journal entry. If it contains real schema changes, the schema.ts has drifted from migrations — out of scope for Phase 19, flag to human.

**Risk:** Drizzle-kit's snapshot-backfill behavior for missing entries is not well-documented. If it refuses to create snapshots for already-applied entries and instead tries to generate a new migration, manual intervention may be needed.

**Fallback: Option C — document and defer**

The runtime migrator only needs `.sql` files. CI and production deployment work fine without the snapshots. `drizzle-kit generate` misbehavior only surfaces when someone tries to add a new migration. If Phase 19's restoration scope doesn't include new schema changes, deferring to the next phase that DOES change the schema is acceptable.

**Recommendation:** Attempt Option A; if it fails, log the result and commit Option C as a documented TECH-DEBT entry. The audit YAML frontmatter marks this gap as "PARTIAL" (not "FAIL"), confirming it's not a blocker for flows B and E.

## Test Framework (Validation Architecture)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 |
| Config file | `vitest.config.ts` (existing; repo-wide) |
| Quick run command | `npx vitest run src/proactive/__tests__/` (no DB needed for unit tests against mocked state/sweep) |
| Full suite command | `npm test` (wraps `bash scripts/test.sh` — Docker Postgres + all 5 migrations + full vitest run) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SWEEP-01 | Deadline trigger at priority=2 transitions open→due before send | unit | `npx vitest run src/proactive/__tests__/deadline.test.ts` | ❌ Wave 0 (restore from 4c156c3) |
| SWEEP-01 | Sweep invokes createDeadlineTrigger in accountability channel | unit (mocked) | `npx vitest run src/proactive/__tests__/sweep.test.ts -t 'accountability channel'` | ❌ Wave 0 (replace current with canonical) |
| SWEEP-01 | Engine-level end-to-end: sweep → deadline → accountability prompt reaches Telegram-mock | integration | `npx vitest run src/decisions/__tests__/synthetic-fixture.test.ts -t 'TEST-10'` | ✅ exists; currently passes under degraded single-pipeline; unaffected by restoration since TEST-10 doesn't exercise channel separation |
| SWEEP-02 | Channel-aware state helpers: hasSentTodayAccountability independent of hasSentTodayReflective | unit | `npx vitest run src/proactive/__tests__/state.test.ts -t 'channel'` | ❌ Wave 0 (replace current with canonical) |
| SWEEP-02 | Both channels fire on same-day collision without starvation | integration | `npx vitest run src/decisions/__tests__/synthetic-fixture.test.ts -t 'TEST-12'` | ✅ exists but DEGRADED — TEST-12 must be realigned as part of Plan 19-04 |
| SWEEP-02 | Error isolation: accountability failure does not block reflective | unit (mocked) | `npx vitest run src/proactive/__tests__/sweep.test.ts -t 'error does not block reflective'` | ❌ Wave 0 |
| SWEEP-04 | Stale-context dating (>48h): explicit date prefix "On YYYY-MM-DD" | unit | `npx vitest run src/proactive/__tests__/deadline.test.ts -t 'stale'` | ❌ Wave 0 |
| RES-02 | Sweep calls upsertAwaitingResolution BEFORE sendMessage with correct decisionId | unit (mocked) | `npx vitest run src/proactive/__tests__/sweep.test.ts -t 'upsertAwaitingResolution'` | ❌ Wave 0 |
| RES-02 | End-to-end: deadline fires → AWAITING_RESOLUTION row written → Greg's reply → handleResolution routes | integration | `npx vitest run src/decisions/__tests__/synthetic-fixture.test.ts -t 'TEST-10'` | ✅ exists |
| RES-02 | 24h SLA | manual-only | HUMAN verification (production cron schedule) | n/a (unchanged from Phase 16) |
| RES-06 | 48h + count=1 → follow-up sent + count incremented | unit (mocked clock) | `npx vitest run src/proactive/__tests__/sweep-escalation.test.ts -t 'followup'` | ❌ Wave 0 |
| RES-06 | 48h + count≥2 → transitionDecision('stale') + clearCapture + clearEscalationKeys + no send | unit (mocked clock) | `npx vitest run src/proactive/__tests__/sweep-escalation.test.ts -t 'stale'` | ❌ Wave 0 |
| RES-06 | <48h → no-op | unit | `npx vitest run src/proactive/__tests__/sweep-escalation.test.ts -t 'within 48h'` | ❌ Wave 0 |
| RES-06 | Escalation error isolation from reflective channel | unit | `npx vitest run src/proactive/__tests__/sweep-escalation.test.ts -t 'does not block'` | ❌ Wave 0 |
| Cross-cutting | Phase 15/16 re-verification: all previously-green tests still green | regression | `npm test` | ✅ (Docker-full) |
| Cross-cutting | Milestone audit re-run shows 31/31 requirements | e2e | Manually invoke `/gsd-audit-milestone v2.1` after restoration | ✅ |

### Sampling Rate (Nyquist)
- **Per task commit:** `npx vitest run src/proactive/__tests__/{target}.test.ts` for whichever file changed
- **Per wave merge:** `npm test` (full Docker suite — per user MEMORY.md "always run full Docker tests")
- **Phase gate:** `npm test` GREEN + `/gsd-audit-milestone v2.1` shows `requirements: 31/31`, no FAIL integration checks, flows B + E marked COMPLETE (before `/gsd-verify-work`)

### Wave 0 Gaps
- [x] `src/proactive/__tests__/state.test.ts` — REPLACE with canonical (covers SWEEP-02 state helpers + RES-06 escalation helpers)
- [x] `src/proactive/__tests__/sweep.test.ts` — REPLACE with canonical (covers SWEEP-01 trigger invocation + SWEEP-02 channel independence + RES-02 upsertAwaitingResolution call)
- [x] `src/proactive/__tests__/deadline.test.ts` — ADD from canonical (covers SWEEP-01 trigger behavior + SWEEP-04 stale-context dating)
- [x] `src/proactive/__tests__/sweep-escalation.test.ts` — ADD from canonical (covers RES-06 48h cadence + stale transition)
- [x] `src/decisions/__tests__/synthetic-fixture.test.ts` — REALIGN TEST-12 to channel-separation contract (Plan 19-04)
- [x] `scripts/test.sh` — RESTORE to apply migrations 0002/0003/0004 with `ON_ERROR_STOP=1` (prerequisite for Docker integration tests)
- [x] `src/db/migrations/meta/0001_snapshot.json`, `0003_snapshot.json` — REGENERATE via `drizzle-kit generate` (optional; non-blocking)

Framework install: none needed — vitest already configured.

## Security Domain

Security enforcement check: no `.planning/config.json` security key; defaults to enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Sweep is system-authored; no user auth in restored scope |
| V3 Session Management | no | — |
| V4 Access Control | no | Telegram bot already enforces `TELEGRAM_AUTHORIZED_USER_ID` gate; unchanged by Phase 19 |
| V5 Input Validation | limited | Decision content (prediction, falsificationCriterion) is quoted verbatim into Sonnet system prompt via `.replace('{triggerContext}', ...)`. Risk: prompt-injection if a malicious user supplied a prediction like `"ignore previous instructions and..."`. Mitigation: Greg is the only authorized user (single-tenant), so prompt injection would be self-directed. No new validation needed beyond what exists in Phase 14's capture flow. |
| V6 Cryptography | no | No new crypto surface |
| V8 Data Protection | limited | Decision content flows through Sonnet (Anthropic API) — already covered by Phase 13/14 privacy posture. No new egress introduced. |
| V9 Communications | no | Telegram + Anthropic HTTPS — unchanged. |

### Known Threat Patterns for restoration work

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Restoring an old file overwrites recent security fix | Tampering | Before restoring each file, `git log <commit>..HEAD -- <path>` to verify no post-`4c156c3` commit touched it. For our 4 target files, this returns only `5582442` (the destructive merge), so restoring from `4c156c3` is safe. |
| Regenerated migration snapshots leak schema details | Information Disclosure | Snapshots are JSON describing table/column structure — no user data. Committed to git as source already. No new exposure. |
| Test fixtures hardcode credentials | Information Disclosure | `scripts/test.sh` uses `"${ANTHROPIC_API_KEY:-test-key}"` and `"${TELEGRAM_BOT_TOKEN:-test-token}"` — placeholder defaults, not real secrets. Verified. |
| Dynamic import in resolution.ts allows path traversal | Tampering | Hardcoded string `'../proactive/state.js'` — not user-controlled. Safe. |
| Escalation key format `accountability_sent_<decisionId>` — is decisionId attacker-controlled? | Injection (KV key injection) | decisionId is UUID generated by Postgres (`gen_random_uuid()` default, schema 0002) — not user-controlled. Safe. |

No new threats introduced by restoration. All controls are inherited from existing Phase 13/14/16 implementations.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Single-pipeline sweep (priority-ordered winner across all triggers) | Dual-channel (accountability + reflective, independent caps, serial firing) | Phase 15 (2026-04-16) per D-05 | Decisions at deadline get surfaced even if silence/commitment also fire same day |
| Missing auto-escalation for ACCOUNTABILITY | 48h follow-up + 2-nonreply → stale | Phase 16 (2026-04-16) per D-18 | Greg's forecasts don't rot as open decisions forever |
| Single global `last_sent` key | Channel-separated keys with legacy fallback | Phase 15-02 (2026-04-16) per D-07 | New channel doesn't disrupt existing production |

**Deprecated/outdated:**
- Single-pipeline sweep — superseded by dual-channel architecture. The current (degraded) sweep.ts is the deprecated version; restoration brings it back to current.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `drizzle-kit generate` will successfully regenerate missing `0001_snapshot.json` and `0003_snapshot.json` against a live Postgres with migrations applied | Migration Snapshot Strategy | Medium — if drizzle-kit refuses to generate snapshots for already-applied entries, fallback to Option C (defer). Not a blocker for requirements satisfaction. |
| A2 | The `tsconfig.json` does not have `noUnusedLocals: true`, so canonical sweep.ts's unused `getLastUserLanguage` import won't produce an error | Pitfall 3 | Low — if it does, plan-phase will need to either drop the import or add `// @ts-ignore`. 1-line fix. Can be verified by reading tsconfig.json in plan-phase. |
| A3 | `/gsd-audit-milestone v2.1` will mark requirements as SATISFIED purely on code-inspection evidence (grep for exports + wiring) without requiring live runtime proof | Success criterion #7 | Low — audit methodology is evidence-based + code-inspection. The 5 currently-unsatisfied requirements all have SATISFIED siblings in Phase 13/14/17 proven only via grep. Restoration provides the same kind of evidence. |
| A4 | Canonical sweep.ts's escalation block correctly handles the "first sweep after decision enters AWAITING_RESOLUTION" case where the accountability channel just sent the initial prompt AND the escalation block finds `sentAt==null` — because the accountability channel sets sentAt=now BEFORE the escalation block runs in the same sweep tick | Pitfall 4 | Medium — code inspection shows accountability channel calls `setEscalationSentAt(decisionId, new Date())` inside the same `try` block. On the same sweep tick, the escalation block then reads `sentAt !== null` and `hoursSinceSent === 0 < 48` → no-op. Correct. If TEST-10 passed under degraded sweep (which never writes escalation keys at all), it may not catch a regression here — test the path explicitly. |

**Summary:** 4 assumptions, all LOW-to-MEDIUM risk. None blocks restoration mechanically; worst-case impact is a small adjustment in Plan 19-04 for snapshot regeneration.

## Open Questions (RESOLVED)

1. **RESOLVED: Should `setEscalationContext` / `getEscalationContext` be added despite not existing in canonical?**
   - What we know: ROADMAP success criterion 1 lists them; Phase 16 VERIFICATION line 51 called them "bonus" exports; grep of `4c156c3:src/proactive/state.ts` shows they DO NOT exist.
   - What's unclear: Whether Phase 16 VERIFICATION was inaccurate, or whether these were present in an even later commit that wasn't reached.
   - Recommendation: Do NOT add them in Phase 19. The canonical restoration target does not include them, no consumer imports them, and no requirement mandates them. If a future phase needs them, add then. Document as "not restored because not present in canonical" in Plan 19-01 SUMMARY.

2. **RESOLVED: Is TEST-12's realignment in scope for Phase 19 or Phase 20?**
   - What we know: ROADMAP Plan 19-04 explicitly includes "realign TEST-12 to original channel-separation contract."
   - What's unclear: Whether TEST-12 realignment should write a fresh test from scratch or use any fragment of canonical TEST-12. Checking `git show 4c156c3:src/decisions/__tests__/synthetic-fixture.test.ts` shows canonical TEST-12 already has channel-separation assertions — so realignment = replace-with-canonical.
   - Recommendation: Realign TEST-12 by restoring it from `4c156c3:synthetic-fixture.test.ts`. Note: that commit's version has `578 lines` vs current `22014 bytes`. Verify the rest of synthetic-fixture.test.ts (TEST-10, TEST-11) is byte-identical between current and `4c156c3` — if so, replace the whole file. If not, surgical replacement of the TEST-12 describe block is safer.

3. **RESOLVED: Does `drizzle-kit generate` need a fresh schema-applied Postgres, or will it work against any Postgres?**
   - What we know: drizzle-kit config (`drizzle.config.ts`) reads from `DATABASE_URL` env var; the CLI introspects the running database's schema.
   - What's unclear: Whether drizzle-kit generates snapshots FROM the journal (pure filesystem operation) or FROM the live DB state.
   - Recommendation: Plan-phase should attempt Option A on a fresh Docker Postgres with migrations applied. If that doesn't write the missing snapshots, fallback to Option C.

4. **RESOLVED: Is there a `tsconfig.json` noUnusedLocals setting that would break canonical sweep.ts?**
   - What we know: `npx tsc --noEmit` today reports only 2 errors (both on deadline.ts's `decision-deadline` type), no unused-import errors elsewhere.
   - What's unclear: Whether noUnusedLocals is off globally or on for certain paths.
   - Recommendation: Plan-phase should `grep 'noUnused' tsconfig.json`. If enabled, drop the `getLastUserLanguage` import from sweep.ts during restoration (1-line deviation from canonical).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker + docker-compose | Postgres test harness | must verify on target machine | — | `scripts/test.sh` will fail; all tests that need real DB can't run |
| PostgreSQL 16 + pgvector | decisions/decision_events/decision_capture_state tables | via docker-compose.local.yml | — | none — tests require it |
| Node.js | Runtime | present (project already runs) | project requires (package.json engines not read here; assume existing) | none |
| npm / npx | Vitest + drizzle-kit | present | — | none |
| drizzle-kit (binary) | Snapshot regeneration (19-04) | via `npx drizzle-kit` — uses installed `^0.31.10` | 0.31.10 | Option C: defer snapshot regeneration |
| git CLI | Source file restoration (all 4 plans) | present (project is git repo) | — | none — foundational |
| ANTHROPIC_API_KEY | live-accountability.test.ts, vague-validator-live.test.ts | user env | — | These tests are gated; unaffected by Phase 19 |

**Missing dependencies with no fallback:** None identified on the current machine — the project is already running.

**Missing dependencies with fallback:** None.

**Assumption:** Target machine has the same Docker+Postgres setup that produced Phase 13-18. Phase 19 introduces no new environment requirements.

## Validation Architecture

Nyquist validation enabled (config.json has no `workflow.nyquist_validation` key → treat as enabled).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 |
| Config file | `vitest.config.ts` + `scripts/test.sh` (harness) |
| Quick run command | `npx vitest run <path>` — single file, no DB for fully-mocked tests |
| Full suite command | `npm test` — invokes `bash scripts/test.sh` (Docker Postgres + all 5 migrations + vitest full run) |

### Sampling Rate (Nyquist)
- **Per task commit:** `npx vitest run src/proactive/__tests__/<changed-file>.test.ts` (sub-30-second unit feedback)
- **Per wave merge:** `npm test` (full Docker Postgres suite — per user MEMORY.md: "Always run full Docker tests; never skip integration tests")
- **Phase gate:** `npm test` GREEN + `/gsd-audit-milestone v2.1` reports `requirements: 31/31`, all integration checks PASS, flows B + E = COMPLETE

### Wave 0 Gaps
- [x] `src/proactive/__tests__/deadline.test.ts` — ADD (canonical from `4c156c3`) — covers SWEEP-01, SWEEP-04
- [x] `src/proactive/__tests__/sweep-escalation.test.ts` — ADD (canonical from `4c156c3`) — covers RES-06
- [x] `src/proactive/__tests__/state.test.ts` — REPLACE (canonical from `4c156c3`) — covers SWEEP-02, RES-06 state
- [x] `src/proactive/__tests__/sweep.test.ts` — REPLACE (canonical from `4c156c3`) — covers SWEEP-01/02, RES-02 integration
- [x] `src/decisions/__tests__/synthetic-fixture.test.ts` — REALIGN TEST-12 (channel-separation contract) — covers cross-cutting channel-separation
- [x] `scripts/test.sh` — RESTORE (canonical from `4c156c3`) — prerequisite for decisions-table integration tests
- [x] Framework install: none needed — vitest + drizzle-kit already installed

### Phase Requirements → Test Map (detailed)
See "Phase Requirements → Test Map" table under "Test Framework" section above.

## Risk Callouts

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| R1 | Restoring sweep.ts breaks existing green tests in sweep.test.ts before canonical replacement arrives | HIGH (mechanical certainty — current tests mock single-channel helpers that no longer exist in restored sweep.ts) | Medium — wave 0 test-and-code coupling | Restore sweep.ts AND replace sweep.test.ts atomically in the same plan (Plan 19-03). Do not separate them. |
| R2 | Canonical sweep.ts imports `getLastUserLanguage` (unused) — fails if noUnusedLocals enabled | LOW | Low — 1-line fix | Plan-phase grep tsconfig.json; if enabled, remove the import |
| R3 | `drizzle-kit generate` does not regenerate snapshots for missing journal entries | MEDIUM | Low — audit tolerated as PARTIAL; non-blocking | Fallback to Option C (document and defer) |
| R4 | TEST-10 (14-day lifecycle) currently passes under degraded sweep but may actually BREAK under restored sweep because it exercises sweep more thoroughly (e.g., expects 2 channel calls when code previously made 1) | MEDIUM | Medium — regresses Phase 18's coverage | Phase 18 committed `1b064a2` (sql.end() fix) and `9c8048e` (JSON.parse error handling) after 5582442, meaning TEST-10 was written for DEGRADED sweep. Plan 19-04 must re-run TEST-10 and, if it breaks, diagnose whether it's testing the wrong contract. |
| R5 | TEST-11 (concurrency race) currently passes and is sweep-path-agnostic | LOW | Low | Should be unaffected by restoration. Re-run in Plan 19-04 as regression check. |
| R6 | Resolution.ts dynamic import for `clearEscalationKeys` currently no-ops; after restoration, it becomes active. If there are stale escalation keys in production (there shouldn't be), cleanup behavior may surprise. | LOW | Low | Production has no `AWAITING_RESOLUTION` rows today (sweep never wrote any); no stale keys can exist. Safe. |
| R7 | Phase 15/16 VERIFICATION.md status is "passed" but evidence is stale; re-verification after restoration may surface issues not caught before | MEDIUM | Medium | Plan 19-04's post-restoration `npm test` + `/gsd-audit-milestone v2.1` is the gate. Budget for 1-2 small fix-up items in case code inspection missed something. |
| R8 | scripts/test.sh restoration introduces `-v ON_ERROR_STOP=1` — may surface pre-existing SQL migration issues that were being silently ignored | LOW | Medium | Migrations 0000-0004 have been applied many times in Phase 13-18 development; unlikely to have hidden SQL errors. If it does fail, that's a Phase 13 regression, out of scope for Phase 19 — surface immediately. |
| R9 | Canonical sweep.ts's escalation block performs N DB queries per sweep tick where N = number of AWAITING_RESOLUTION rows. Unbounded for scale. | LOW for Greg's use (single-user, ~20 decisions/year) | Low | Document in SUMMARY; revisit in M013+ if N grows |

## Sources

### Primary (HIGH confidence)
- `git show 4c156c3:<path>` — authoritative source for all 4 restoration targets — `[VERIFIED: git command]`
- `git diff --stat f0664ef..4c156c3 -- src/proactive/{sweep,state,prompts}.ts` — zero-diff confirmation — `[VERIFIED: git command]`
- `git merge-base 5582442 4c156c3` = `4c156c3` — confirms fast-forward merge topology — `[VERIFIED: git command]`
- `npx tsc --noEmit` — confirms 2 current type errors on deadline.ts — `[VERIFIED: compiler]`
- `.planning/phases/15-deadline-trigger-sweep-integration/15-VERIFICATION.md` — phase-local ground truth — `[VERIFIED: file read]`
- `.planning/phases/16-resolution-post-mortem-accountability-mode/16-VERIFICATION.md` — phase-local ground truth — `[VERIFIED: file read]`
- `.planning/v2.1-MILESTONE-AUDIT.md` — integration gap analysis — `[VERIFIED: file read]`
- `.planning/REQUIREMENTS.md` — phase-requirement mapping — `[VERIFIED: file read]`
- `src/decisions/capture-state.ts`, `src/decisions/resolution.ts`, `src/chris/engine.ts` — current downstream importer state — `[VERIFIED: file read]`

### Secondary (MEDIUM confidence)
- drizzle-kit `^0.31.10` snapshot regeneration behavior for missing journal entries — `[ASSUMED: from package.json version; actual behavior requires testing]`

### Tertiary (LOW confidence)
None — all research was performed via direct git archaeology and file inspection against this repo.

## Project Constraints (from CLAUDE.md and user MEMORY.md)

- `./CLAUDE.md` does not exist at the project root — no file-level project directives to honor.
- User MEMORY.md: **"Always run full Docker tests — never skip integration tests, always start real postgres."** This directive applies to Plan 19-04 (and any wave validation in 19-01/02/03 that touches Postgres). It forbids using `--no-integration` flags, `--skip` markers, or calling `vitest run` without `scripts/test.sh`.
- No `.claude/skills/` or `.agents/skills/` directory — no project-specific skill patterns.
- `.planning/config.json` has `workflow._auto_chain_active: false` — the next phase step must be explicitly invoked, not auto-chained.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all are already in use and verified via package.json.
- Architecture: HIGH — restoration target is byte-identical to a known-verified state (`4c156c3`).
- Pitfalls: HIGH for mechanical pitfalls (1, 2, 5 verified via direct inspection); MEDIUM for runtime-timing pitfalls (3, 4, 6 inferred from code reading).
- Test landscape: HIGH — all test files inspected; canonical test file behaviors documented by reading canonical source and comparing to current.

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (30 days — stable scope; restoration target unchanging)

## RESEARCH COMPLETE
