---
phase: 14-capture-flow
verified: 2026-04-16T06:30:00Z
status: human_needed
score: 5/5
overrides_applied: 0
human_verification:
  - test: "Send an EN trigger phrase in Telegram and complete a full capture flow"
    expected: "Chris opens capture, asks follow-up questions, archives decision as open with all slots filled"
    why_human: "End-to-end Telegram UX cannot be verified programmatically; conversational feel assessment requires human judgment"
  - test: "Send /decisions suppress 'I'm thinking about' then send that phrase again"
    expected: "Second message does NOT trigger capture; normal engine response instead"
    why_human: "Requires live Telegram bot interaction to verify command + suppression integration"
  - test: "Send an FR or RU trigger phrase and verify capture stays in that language throughout"
    expected: "All Chris questions and acknowledgments are in the triggering language"
    why_human: "Language quality and localization correctness need human evaluation"
  - test: "Say 'never mind' mid-capture"
    expected: "Capture dismissed cleanly with localized acknowledgment; next message routes to normal engine"
    why_human: "UX feel of abort flow requires human judgment"
---

# Phase 14: Capture Flow Verification Report

**Phase Goal:** A structural decision mentioned in any of Greg's three languages becomes a durable, falsifiable `decisions` row without the capture conversation ever feeling like an interrogation.
**Verified:** 2026-04-16T06:30:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Two-phase detection ships atomically: Phase A regex matches EN/FR/RU, Phase B Haiku stakes returns tier, only structural activates capture | VERIFIED | `src/decisions/triggers.ts` exports `detectTriggerPhrase` (4 EN + 4 FR + 4 RU patterns with D-03 parity assertion at import time) and `classifyStakes` (3s timeout, fail-closed to trivial). Both wired in engine.ts PP#1 at line 197-207. |
| 2 | 5-slot capture runs as conversational Haiku extraction; one-message multi-answer consolidated; 3-turn cap + EN/FR/RU abort phrase cleanly dismisses | VERIFIED | `src/decisions/capture.ts` implements greedy Haiku extraction (`CAPTURE_EXTRACTION_PROMPT`), `MAX_TURNS = 3` at line 46, abort check via `isAbortPhrase` in engine.ts PP#0 line 171. `capture-state.ts` exports `isAbortPhrase` covering all three languages. Placeholders "(not specified in capture)" used for unfilled NOT NULL slots (6 occurrences). |
| 3 | Engine pre-processor #0 checks decision_capture_state before mute/refusal/language/mode detection | VERIFIED | engine.ts: `getActiveDecisionCapture(chatId)` at line 165, `detectMuteIntent` at line 217. PP#0 strictly precedes mute detection. Active capture short-circuits all downstream routing. |
| 4 | resolve_by parses NL timeframes with 7/30/90/365-day fallback ladder; vague predictions flagged by Haiku validator that pushes back once before accepting or routing to open-draft | VERIFIED | `src/decisions/resolve-by.ts` has `CLARIFIER_LADDER_DAYS` with exact values (week:7, month:30, threeMonths:90, year:365), `parseResolveBy` with 2s timeout, localized clarifier + default announcement. `src/decisions/vague-validator.ts` has `validateVagueness` with 3s timeout, fail-soft to acceptable, `HEDGE_WORDS` covering EN/FR/RU, `buildVaguePushback` localized. `capture.ts` gates validator via `vague_validator_run` flag. |
| 5 | Greg can suppress trigger phrase via /decisions suppress; suppression persists across restarts; contradiction detection scans decisions.reasoning fire-and-forget | VERIFIED | `src/decisions/suppressions.ts` exports `addSuppression` (trim+lowercase, onConflictDoNothing), `isSuppressed` (case-insensitive substring, per-chatId scoped). `src/bot/handlers/decisions.ts` wires `/decisions suppress <phrase>` with 200-char limit. `bot.ts` registers command at line 27 before message:text at line 63. `capture.ts` calls `detectContradictions` (2 occurrences) in fire-and-forget pattern. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/decisions/triggers.ts` | Phase A regex + Phase B Haiku stakes classifier | VERIFIED | 6970 bytes, exports detectTriggerPhrase + classifyStakes + TriggerMatch + StakesTier |
| `src/decisions/suppressions.ts` | addSuppression + isSuppressed + listSuppressions | VERIFIED | 2353 bytes, 3 exported async functions, Drizzle queries with eq(chatId) |
| `src/decisions/capture.ts` | handleCapture + openCapture + extractor + commit paths | VERIFIED | 19414 bytes, exports handleCapture + openCapture, calls insertDecision for both open and open-draft paths |
| `src/decisions/resolve-by.ts` | Haiku NL parser + clarifier ladder + announced +30d default | VERIFIED | 3880 bytes, exports parseResolveBy + CLARIFIER_LADDER_DAYS + matchClarifierReply + builders |
| `src/decisions/vague-validator.ts` | Hedge-word-primed Haiku judgment | VERIFIED | 3195 bytes, exports validateVagueness + HEDGE_WORDS + buildVaguePushback |
| `src/decisions/capture-state.ts` | Extended with write helpers + abort-phrase detector | VERIFIED | 3825 bytes, exports createCaptureDraft + updateCaptureDraft + clearCapture + isAbortPhrase + CaptureDraft |
| `src/decisions/triggers-fixtures.ts` | EN/FR/RU trigger fixtures with parity | VERIFIED | 3705 bytes, 13 positive phrases (4+4+4+1 abort sets), D-03 parity holds |
| `src/chris/engine.ts` | PP#0 + PP#1 before mute/refusal/language/mode | VERIFIED | PP#0 at line 165, PP#1 at line 197, detectMuteIntent at line 217; all 7 decision imports present |
| `src/bot/handlers/decisions.ts` | /decisions handler with suppress sub-command | VERIFIED | 3566 bytes, exports handleDecisionsCommand, calls addSuppression with BigInt(chatId) |
| `src/bot/bot.ts` | bot.command('decisions') registered before message:text | VERIFIED | Line 27 (decisions) < line 63 (message:text) |
| `src/db/migrations/0004_decision_trigger_suppressions.sql` | DDL for suppressions table | VERIFIED | Contains CREATE TABLE |
| `src/llm/prompts.ts` | 4 Haiku prompt constants | VERIFIED | All 4 exported: STAKES_CLASSIFICATION_PROMPT, CAPTURE_EXTRACTION_PROMPT, VAGUE_VALIDATOR_PROMPT, RESOLVE_BY_PARSER_PROMPT |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| engine.ts | capture.ts | openCapture + handleCapture imports | WIRED | Lines 20, 187, 207 |
| engine.ts | triggers.ts | detectTriggerPhrase + classifyStakes | WIRED | Lines 21, 198, 200 |
| engine.ts | suppressions.ts | isSuppressed precedes regex in PP#1 | WIRED | Line 22, 197 |
| engine.ts | capture-state.ts | getActiveDecisionCapture + clearCapture + isAbortPhrase | WIRED | Lines 15-17, 165, 171, 173 |
| capture.ts | lifecycle.ts or insertDecision | transitionDecision/insertDecision for commits | WIRED | 5 occurrences of transitionDecision/insertDecision |
| capture.ts | contradiction.ts | detectContradictions fire-and-forget | WIRED | 2 occurrences |
| capture.ts | prompts.ts | CAPTURE_EXTRACTION_PROMPT | WIRED | Import and usage confirmed |
| bot/handlers/decisions.ts | suppressions.ts | addSuppression | WIRED | Line 36 |
| bot.ts | handlers/decisions.ts | bot.command('decisions') | WIRED | Line 27 |
| scripts/test.sh | migration 0004 | MIGRATION_4_SQL psql apply | WIRED | 2 occurrences (declaration + apply) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CAP-01 | 01, 02 | Two-phase decision trigger detection | SATISFIED | triggers.ts: Phase A regex (4 EN/FR/RU patterns) + Phase B Haiku classifier with fail-closed; triggers.test.ts GREEN per summary |
| CAP-02 | 04 | Conversational Haiku extraction, one-message multi-answer | SATISFIED | capture.ts: greedy extraction via CAPTURE_EXTRACTION_PROMPT fills multiple slots per reply |
| CAP-03 | 04 | 3-turn follow-up cap + abort phrase | SATISFIED | capture.ts: MAX_TURNS=3; isAbortPhrase covers EN/FR/RU; clearCapture on abort |
| CAP-04 | 04 | open-draft partial-commit status | SATISFIED | capture.ts: open-draft commit path with placeholder NOT-NULL strings |
| CAP-05 | 04 | resolve_by NL timeframes + fallback ladder | SATISFIED | resolve-by.ts: parseResolveBy + CLARIFIER_LADDER_DAYS (7/30/90/365) + +30d default announced |
| CAP-06 | 01, 03, 05 | Per-user trigger suppression via /decisions suppress | SATISFIED | suppressions.ts + bot/handlers/decisions.ts; DB-backed, per-chatId scoped, persists across restarts |
| LIFE-05 | 04 | Contradiction detection on decisions.reasoning | SATISFIED | capture.ts: detectContradictions called fire-and-forget on open commit path |
| SWEEP-03 | 05 | Engine pre-processor #0 before mute/refusal/language/mode | SATISFIED | engine.ts: PP#0 at line 165, detectMuteIntent at line 217 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| REQUIREMENTS.md | various | CAP-02/03/04/05, LIFE-05, SWEEP-03 still marked "Pending" | Info | Traceability table not updated; code is implemented; cosmetic only |

### Human Verification Required

### 1. End-to-end Telegram Capture Flow

**Test:** Send an EN trigger phrase (e.g., "I'm thinking about quitting my job") in Telegram.
**Expected:** Chris opens capture, asks follow-up questions, archives decision as `open` with all slots filled. Conversation should feel natural, not like an interrogation.
**Why human:** Conversational UX quality and anti-interrogation feel cannot be verified programmatically.

### 2. Suppression Persistence

**Test:** Send `/decisions suppress I'm thinking about` then send "I'm thinking about dinner".
**Expected:** Second message does NOT trigger capture; routes to normal engine response.
**Why human:** Requires live Telegram bot interaction.

### 3. Multilingual Capture

**Test:** Send an FR or RU trigger phrase and complete the capture flow.
**Expected:** All Chris questions and acknowledgments stay in the triggering language throughout.
**Why human:** Language quality and localization correctness need human evaluation.

### 4. Abort Flow

**Test:** Say "never mind" mid-capture.
**Expected:** Capture dismissed with localized acknowledgment; next message routes normally.
**Why human:** UX feel of abort requires human judgment.

### Gaps Summary

No code-level gaps found. All 5 roadmap success criteria verified against the codebase. All 8 requirement IDs (CAP-01 through CAP-06, LIFE-05, SWEEP-03) have supporting implementation artifacts that are substantive and wired. The REQUIREMENTS.md traceability table has not been updated to reflect completion (cosmetic issue, not a gap).

Human verification is required for end-to-end Telegram UX testing -- the anti-interrogation feel that is central to the phase goal cannot be assessed programmatically.

---

_Verified: 2026-04-16T06:30:00Z_
_Verifier: Claude (gsd-verifier)_
