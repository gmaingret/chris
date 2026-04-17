---
phase: 16-resolution-post-mortem-accountability-mode
verified: 2026-04-16T11:45:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Send a resolution reply to an accountability prompt on a real 'due' decision. Verify the response is neutral (no flattery for a hit, no condemnation for a miss) and ends with the class-specific post-mortem question."
    expected: "One paragraph neutral acknowledgment citing the original prediction verbatim, followed by the appropriate post-mortem question (hit: 'What did you see that others missed?', miss: 'What would you do differently?', etc.) in Greg's language."
    why_human: "Prompt content and tone quality cannot be verified programmatically — requires real Sonnet call and human judgement about flattery/condemnation absence."
  - test: "Wait or simulate 48h+ after a first accountability prompt with no reply. Verify exactly one follow-up message is sent with natural 'couple days ago' phrasing, not a robotic repeat."
    expected: "Second message references having asked before, 1-2 sentences, neutral tone."
    why_human: "Message content and tone quality require human judgment; clock simulation requires vi.setSystemTime integration test (Phase 18)."
  - test: "Verify the sweep fires the first resolution prompt within 24h of resolve_by passing (SC2 'within 24h' guarantee)."
    expected: "Sweep run frequency is at least once per 24h so that the deadline trigger (which fires on resolveBy <= now) catches all due decisions within 24h of the deadline."
    why_human: "This depends on the deployed cron schedule, not on code logic. Code is correct (fires on resolveBy <= now immediately); the guarantee requires the sweep to run at minimum daily."
---

# Phase 16: Resolution, Post-Mortem & ACCOUNTABILITY Mode — Verification Report

**Phase Goal:** A resolution reply produces a neutral, Pensieve-grounded post-mortem that neither flatters a hit nor condemns a miss — or M007 inverts M006.
**Verified:** 2026-04-16T11:45:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ACCOUNTABILITY mode exists with system prompt that bypasses praise quarantine and forbids The Hard Rule | VERIFIED | `ChrisMode` union includes `'ACCOUNTABILITY'` (personality.ts:13); `case 'ACCOUNTABILITY':` in `buildSystemPrompt` (personality.ts:117); praise-quarantine.ts:82 adds `mode === 'ACCOUNTABILITY'` to bypass; prompts.ts:473 contains "The Hard Rule is explicitly forbidden" |
| 2 | Resolution prompts surface within 24h of resolve_by, cite original prediction + falsification criterion in Greg's language, route through pre-processor on AWAITING_RESOLUTION | VERIFIED (code) / HUMAN (schedule) | deadline.ts:68 queries `resolveBy <= now` immediately; engine.ts:173 routes AWAITING_RESOLUTION to handleResolution before abort-phrase check; resolution.ts:195+ detects language via `getLastUserLanguage`; 24h guarantee depends on sweep schedule (human item) |
| 3 | After resolution, exactly one Haiku-classified post-mortem fires; resolution_notes stored; resolved→reviewed; both replies become Pensieve entries with source_ref_id | VERIFIED | resolution.ts exports `classifyOutcome` (Haiku, fail-closed to 'ambiguous'); `handleResolution` calls `updateToAwaitingPostmortem` then `classifyOutcome`; `handlePostmortem` stores `resolutionNotes` (line 344), calls `transitionDecision('resolved','reviewed')`, writes Pensieve entry with `sourceRefId: decisionId` |
| 4 | Post-mortem context includes ±48h Pensieve entries and passively re-displays Popper criterion | VERIFIED | `getTemporalPensieve(centerDate, 48 * 3_600_000)` in retrieve.ts:253; called in handleResolution at line 218; decision context string built with `falsificationCriterion` verbatim; ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT instructs "Quote the original prediction and falsification criterion verbatim" |
| 5 | Auto-escalation sends one second prompt after 48h of silence; two non-replies transitions to stale with no further prompts | VERIFIED | sweep.ts:179+ escalation block outside daily cap; count=1+48h sends follow-up via `ACCOUNTABILITY_FOLLOWUP_PROMPT`; count>=2+48h calls `transitionDecision('due','stale')` + `clearCapture` + `clearEscalationKeys`; no `sendMessage` on stale path |

**Score:** 5/5 truths verified (one truth has a human-only sub-item on sweep schedule)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/decisions/resolution.ts` | handleResolution, handlePostmortem, classifyOutcome | VERIFIED | All three functions exported; substantive implementation with full lifecycle flow |
| `src/pensieve/retrieve.ts` | getTemporalPensieve helper | VERIFIED | Exists at line 253; accepts centerDate + windowMs; filters isNull(deletedAt) |
| `src/decisions/capture-state.ts` | updateToAwaitingPostmortem helper | VERIFIED | Exists at line 112; sets stage='AWAITING_POSTMORTEM' |
| `src/chris/personality.ts` | ACCOUNTABILITY in ChrisMode + buildSystemPrompt case | VERIFIED | ChrisMode union line 13; case 'ACCOUNTABILITY' line 117 |
| `src/llm/prompts.ts` | ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT constant | VERIFIED | Exported at line 459; contains Hard Rule prohibition and both placeholders |
| `src/chris/praise-quarantine.ts` | Bypass for ACCOUNTABILITY mode | VERIFIED | Line 82 adds `mode === 'ACCOUNTABILITY'` to COACH/PSYCHOLOGY bypass |
| `src/chris/engine.ts` | PP#0 AWAITING_RESOLUTION/AWAITING_POSTMORTEM routing | VERIFIED | Lines 173/179 route before abort-phrase check; imports handleResolution/handlePostmortem |
| `src/proactive/state.ts` | getEscalationSentAt, setEscalationSentAt, getEscalationCount, setEscalationCount, clearEscalationKeys | VERIFIED | All 5 required exports found (plus setEscalationContext/getEscalationContext as bonus) |
| `src/proactive/prompts.ts` | ACCOUNTABILITY_FOLLOWUP_PROMPT | VERIFIED | Exported at line 45; contains "couple" natural follow-up language (D-18) |
| `src/proactive/sweep.ts` | Escalation block outside daily cap | VERIFIED | Lines 179+ outside `hasSentTodayAccountability` guard; queries AWAITING_RESOLUTION rows; count-based branching |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/chris/personality.ts` | `src/llm/prompts.ts` | import ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT | VERIFIED | personality.ts:8 imports it |
| `src/chris/engine.ts` | `src/decisions/resolution.ts` | import handleResolution, handlePostmortem | VERIFIED | engine.ts:21 |
| `src/decisions/resolution.ts` | `src/decisions/lifecycle.ts` | transitionDecision('due','resolved') and ('resolved','reviewed') | VERIFIED | resolution.ts:18 import; lines 263 and 350 call sites |
| `src/decisions/resolution.ts` | `src/pensieve/retrieve.ts` | getTemporalPensieve() | VERIFIED | resolution.ts:24 import; line 218 call site |
| `src/decisions/resolution.ts` | `src/decisions/capture-state.ts` | updateToAwaitingPostmortem and clearCapture | VERIFIED | resolution.ts:21-22 imports; lines 287 and 346 call sites |
| `src/proactive/sweep.ts` | `src/proactive/state.ts` | getEscalationSentAt/getEscalationCount for 48h checks | VERIFIED | sweep.ts:35,37 imports; lines 193-194 call sites |
| `src/proactive/sweep.ts` | `src/decisions/lifecycle.ts` | transitionDecision('due','stale') | VERIFIED | sweep.ts:45 import (clearCapture); line 214 stale transition |
| `src/proactive/sweep.ts` | `src/decisions/capture-state.ts` | clearCapture on stale transition | VERIFIED | sweep.ts:45 import; line 219 call site |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `resolution.ts:handleResolution` | `decision` (prediction, criterion) | `db.select().from(decisions).where(eq(decisions.id, decisionId))` | Yes — real DB query | FLOWING |
| `resolution.ts:handleResolution` | `temporalEntries` | `getTemporalPensieve(centerDate, 48 * 3_600_000)` → DB select with gte/lte on createdAt | Yes | FLOWING |
| `resolution.ts:classifyOutcome` | `outcome` | Haiku API call + JSON parse with fail-closed fallback | Yes (+ graceful failure) | FLOWING |
| `sweep.ts escalation` | `awaitingRows` | `db.select().from(decisionCaptureState).where(eq(stage,'AWAITING_RESOLUTION'))` | Yes | FLOWING |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RES-01 | 16-02 | ACCOUNTABILITY mode bypasses praise quarantine + Hard Rule explicitly forbidden | SATISFIED | personality.ts ChrisMode union, buildSystemPrompt case, praise-quarantine bypass, prompts.ts Hard Rule prohibition |
| RES-02 | 16-03, 16-04 | Resolution prompts surface within 24h of resolve_by; cite prediction + criterion in user's language | SATISFIED (code) | deadline.ts fires on resolveBy<=now; handleResolution uses getLastUserLanguage; sweep SC depends on schedule (human) |
| RES-03 | 16-03, 16-04 | Pre-processor routes AWAITING_RESOLUTION to resolution handler | SATISFIED | engine.ts PP#0 lines 173-180 before abort-phrase check |
| RES-04 | 16-03 | Single Haiku-classified post-mortem; resolution_notes stored; resolved→reviewed; Pensieve entries with source_ref_id | SATISFIED | classifyOutcome + handlePostmortem + sourceRefId in writePensieveEntry |
| RES-05 | 16-03 | ±48h Pensieve context + Popper criterion re-display | SATISFIED | getTemporalPensieve(48h window) + ACCOUNTABILITY_RESOLUTION_SYSTEM_PROMPT instructs verbatim quote |
| RES-06 | 16-05 | 48h auto-escalation; 2 non-replies → stale; no further prompts | SATISFIED | sweep.ts escalation block; count-based branching; silent stale; clearEscalationKeys |

All 6 phase requirement IDs (RES-01 through RES-06) are accounted for across plans 16-02 through 16-05. No orphaned requirements.

### Anti-Patterns Found

No blockers found. Spot-checks on resolution.ts, sweep.ts, engine.ts showed no TODO/FIXME/placeholder comments in production paths, no empty return stubs, no hardcoded static data in handlers.

One notable pattern: `clearEscalationKeys` in `handleResolution` is called via a dynamic import guard (fire-and-forget, guarded for Plan 05 availability per the summary). This resolved correctly once Plan 05 shipped — the guard is now a no-op overhead but not a stub.

### Human Verification Required

#### 1. Neutral Tone of Resolution Response

**Test:** With a real 'due' decision in the DB, send a resolution reply (e.g. "Yes, it happened exactly as I predicted"). Read the response.
**Expected:** One paragraph, neutral-factual tone. For a hit: no "you were right", "great call", or any flattery. For a miss: no "you were wrong", "you failed", or character attribution. Ends with the class-specific post-mortem question in Greg's language.
**Why human:** Tone quality and Hard Rule compliance cannot be verified by grep or test assertions — requires reading the actual Sonnet output.

#### 2. Follow-Up Prompt Natural Language

**Test:** Simulate or wait 48h+ after a first accountability prompt with no reply. Read the second message sent to Telegram.
**Expected:** 1-2 sentences. References having asked before ("A couple days ago I asked about..."). Not a robotic repeat of the original prompt. Same neutral tone.
**Why human:** Sonnet output quality and naturalness require human judgment.

#### 3. Sweep Schedule Guarantees 24h Surfacing

**Test:** Confirm the production sweep cron schedule fires at minimum once per 24h.
**Expected:** Deadline trigger fires on `resolveBy <= now` (immediate detection in code); guarantee of "within 24h" requires sweep frequency >= 1/day.
**Why human:** Runtime/deployment configuration, not verifiable from source code.

### Gaps Summary

No gaps found. All 5 roadmap success criteria are implemented and wired. The three human verification items are quality/tone checks and one deployment configuration check — none represent missing code.

---

_Verified: 2026-04-16T11:45:00Z_
_Verifier: Claude (gsd-verifier)_
