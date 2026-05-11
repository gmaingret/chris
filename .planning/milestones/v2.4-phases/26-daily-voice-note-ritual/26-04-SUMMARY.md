---
phase: 26-daily-voice-note-ritual
plan: 04
subsystem: bot
tags: [bot, grammy, voice, decline, i18n, telegram, voice-05]

# Dependency graph
requires:
  - phase: 06-multilingual
    provides: getLastUserLanguage() M006 stickiness contract — returns 'English'|'French'|'Russian'|null based on franc detection on user's last text message
  - phase: 26-daily-voice-note-ritual (Plans 26-01 + 26-02)
    provides: independent surface (zero file-overlap) — the voice-decline handler is decoupled from the PP#5 deposit pipeline; only shares Phase 26 milestone framing and the bot.on() registration peer pattern
provides:
  - src/bot/handlers/voice-decline.ts — handleVoiceMessageDecline async handler exporting verbatim D-26-09 EN/FR/RU templated replies with English default for null/unmapped language
  - DECLINE_MESSAGES const (frozen `as const` map: en/fr/ru → templated decline text)
  - LANG_TO_KEY const ('English'|'French'|'Russian' → 'en'|'fr'|'ru' template key map)
  - bot.on('message:voice', handleVoiceMessageDecline as any) registration in src/bot/bot.ts peer to existing message:text + message:document handlers
  - src/bot/handlers/__tests__/voice-decline.test.ts — 7 unit tests asserting EN/FR/RU language selection + null-default + unmapped-default + chatId stringification + side-effect contract (only ctx.reply invoked)
affects: [27 wellbeing snapshot ritual (also uses bot.on filters), 28 mute mechanism (could share decline-style reply pattern), 29 weekly review handler (similar Telegram-reply-only handler shape), v2.5+ voice transcription if/when Whisper is reconsidered]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Polite-decline handler pattern for unsupported Telegram update types: register bot.on('message:<type>'), read getLastUserLanguage for stickiness, reply with templated EN/FR/RU message; no engine-pipeline invocation, no Pensieve write"
    - "Honest-docstring vs grep-guard tension resolution: when an acceptance grep gate forbids a literal token (e.g. processMessage), abstract the token in the docstring (e.g. 'engine-pipeline invocation') instead of dropping the rationale comment. Phase 25 LEARNINGS lesson 7 precedent"
    - "vi.hoisted pattern for vitest mock factories that reference local consts: `const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }))` followed by `vi.mock('mod', () => ({ name: mockFn }))`. Phase 26 commit 117c6dd precedent — replicated here"
    - "DECLINE_MESSAGES `as const` frozen object literal pattern: immutable at module load with literal-string types preserved for keyof typeof DECLINE_MESSAGES indexing"

key-files:
  created:
    - src/bot/handlers/voice-decline.ts
    - src/bot/handlers/__tests__/voice-decline.test.ts
    - .planning/phases/26-daily-voice-note-ritual/deferred-items.md
  modified:
    - src/bot/bot.ts

key-decisions:
  - "Refactored ctx-internal language-to-key mapping from `(lastLang && LANG_TO_KEY[lastLang]) ?? 'en'` to `const mapped = lastLang ? LANG_TO_KEY[lastLang] : undefined; const langKey: keyof typeof DECLINE_MESSAGES = mapped ?? 'en';`. Required to satisfy noUncheckedIndexedAccess + strict mode TS7053 — the && short-circuit on string returns '' (empty string) which doesn't narrow to keyof typeof DECLINE_MESSAGES. Explicit null-coalesce on the mapped const both satisfies the type checker AND remains semantically equivalent to the plan's specified behavior (English default on null OR unmapped)."
  - "Honored honest-docstring vs grep-guard tension: rephrased 'NO processMessage call' to 'NO engine-pipeline invocation' in the file docstring so `grep -c processMessage src/bot/handlers/voice-decline.ts` returns 0 per the plan's verify gate. Rationale preserved (no engine call); the grep guard is the load-bearing acceptance criterion."
  - "Used vi.hoisted for the language tracker mock — required because the original plan-specified `const mockGetLastLang = vi.fn(); vi.mock(...)` triggers vitest's hoisting error 'Cannot access mockGetLastLang before initialization' (vi.mock is hoisted above local consts). The hoist pattern is the Phase 26 Plan 02 commit 117c6dd precedent."

patterns-established:
  - "Polite-decline-handler shape: tiny (~50 LoC) handler module + bot.on() registration + 7-test unit suite mocking only getLastUserLanguage and logger; pure function over a stored M006 language. Reusable for any future unsupported Telegram update type (audio, video_note, sticker, etc.)."
  - "Multi-language Telegram-reply via DECLINE_MESSAGES `as const` map: defines EN/FR/RU strings at module scope, defaults safely to EN, single ctx.reply call. Cleaner than the bot.ts ERROR_FALLBACK Record<string,string> pattern because the keyof typeof typing guarantees exhaustive language coverage."

requirements-completed: [VOICE-05]

# Metrics
duration: 56min
completed: 2026-04-28
---

# Phase 26 Plan 04: Voice Message Polite-Decline Handler Summary

**Telegram message:voice handler replying in EN/FR/RU per M006 stickiness suggesting Android STT keyboard mic icon — no Whisper transcription, no Pensieve write, no engine-pipeline invocation, peer to existing message:text + message:document handlers via bot.on() registration.**

## Performance

- **Duration:** 56 min
- **Started:** 2026-04-28T06:07:42Z
- **Completed:** 2026-04-28T07:04:03Z
- **Tasks:** 4 / 4
- **Files modified:** 4 (3 source + 1 deferred-items log)

## Accomplishments

- Implemented VOICE-05: Greg's literal Telegram voice messages (instead of typing via Android STT keyboard) now receive a templated EN/FR/RU polite-decline reply suggesting the keyboard mic icon — preventing the previous silent-drop behavior.
- Honored OOS-3 anti-feature (no Whisper transcription) at TWO enforcement levels: static grep guard on import patterns (`^import .*(whisper|openai-whisper|whisper-api|@anthropic)` returns 0) AND runtime mock-graph in the unit test (only ctx.reply invoked).
- Honored D-26-09 verbatim wording for all three languages (EN/FR/RU) — matches CONTEXT.md exactly so Greg won't notice mid-test wording changes.
- Reused existing M006 `getLastUserLanguage` stickiness contract — zero new dependencies, no franc invocation on the empty-text voice message.

## Task Commits

1. **Task 1: Author src/bot/handlers/voice-decline.ts handler (D-26-09)** — `7b4c19f` (feat)
2. **Task 2: Register bot.on('message:voice') in src/bot/bot.ts** — `3b2b0d6` (feat)
3. **Task 3: Author voice-decline.test.ts unit tests** — `b0794da` (test)
4. **Task 4: Run full Docker test suite** — no commit (verification-only task)

**Plan metadata commit:** to be added by final-commit step (this SUMMARY + STATE.md + ROADMAP.md + REQUIREMENTS.md updates).

## Files Created/Modified

- `src/bot/handlers/voice-decline.ts` (NEW, ~50 LoC) — handleVoiceMessageDecline handler with DECLINE_MESSAGES + LANG_TO_KEY const maps; reads getLastUserLanguage; defaults to EN on null/unmapped; logs `bot.voice.declined` structured event.
- `src/bot/bot.ts` (MODIFIED, +8 lines) — added handleVoiceMessageDecline import + `bot.on('message:voice', handleVoiceMessageDecline as any)` registration peer to existing message:text + message:document handlers, before bot.catch.
- `src/bot/handlers/__tests__/voice-decline.test.ts` (NEW, ~91 LoC) — 7 unit tests using vi.hoisted mock factory pattern; covers EN/FR/RU/null-default/unmapped-default/chatId-stringification/side-effect-contract.
- `.planning/phases/26-daily-voice-note-ritual/deferred-items.md` (NEW) — logs out-of-scope discoveries (pre-existing live-LLM test failures + Plan 26-03 ordering note).

## Decisions Made

See frontmatter `key-decisions`. Three decisions:

1. **TS7053 fix via explicit null-coalesce on mapped const** — the plan's specified `(lastLang && LANG_TO_KEY[lastLang]) ?? 'en'` triggers a strict-mode type error because `lastLang && ...` short-circuits to `''` when `lastLang === ''`, and `??` doesn't catch that. Refactored to `const mapped = lastLang ? LANG_TO_KEY[lastLang] : undefined; const langKey: keyof typeof DECLINE_MESSAGES = mapped ?? 'en';`. Semantically equivalent (the M006 contract guarantees `getLastUserLanguage` returns 'English'|'French'|'Russian'|null, never ''), but type-checker happy.

2. **Honest-docstring vs grep-guard tension resolution** — Phase 25 LEARNINGS lesson 7 explicitly anticipates this. The plan's verify gate `grep -c processMessage src/bot/handlers/voice-decline.ts # expect: 0` would fail if the docstring uses the literal token. Rephrased "NO processMessage call" to "NO engine-pipeline invocation" — rationale preserved, grep guard satisfied.

3. **vi.hoisted for the mock factory** — the plan's specified test code with `const mockGetLastLang = vi.fn(); vi.mock('../../../chris/language.js', () => ({ getLastUserLanguage: mockGetLastLang }));` errors out at runtime with `Cannot access 'mockGetLastLang' before initialization` because vi.mock() is hoisted above the const. Replicated commit 117c6dd's vi.hoisted pattern: `const { mockGetLastLang } = vi.hoisted(() => ({ mockGetLastLang: vi.fn() }));`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Refactored language-to-key narrowing to satisfy strict-mode TS7053**

- **Found during:** Task 1 (Author handler) — verify gate `npx tsc --noEmit 2>&1 | grep -c voice-decline` returned 1 (expected 0)
- **Issue:** Plan-specified `const langKey = (lastLang && LANG_TO_KEY[lastLang]) ?? 'en';` violated `noUncheckedIndexedAccess` + literal-type narrowing. The expression `lastLang && LANG_TO_KEY[lastLang]` has type `'' | 'en' | 'fr' | 'ru' | undefined` (because `lastLang` is `string | null` so the AND can yield `''`). The `?? 'en'` only covers `null | undefined`, leaving `''` unhandled, so TS refused to use the result as `keyof typeof DECLINE_MESSAGES`.
- **Fix:** Refactored to two-step explicit narrowing: `const mapped = lastLang ? LANG_TO_KEY[lastLang] : undefined; const langKey: keyof typeof DECLINE_MESSAGES = mapped ?? 'en';`. The truthy-check before `LANG_TO_KEY[lastLang]` ensures the index lookup only runs on non-empty strings; the explicit type annotation on `langKey` confirms the narrowed type to TS.
- **Files modified:** src/bot/handlers/voice-decline.ts
- **Verification:** `npx tsc --noEmit | grep voice-decline` returns 0; behavior identical (null/unmapped/non-empty-mapped paths all preserved).
- **Committed in:** `7b4c19f` (Task 1 commit — fix made before commit)

**2. [Rule 1 - Bug] Honored honest-docstring vs grep-guard tension by rephrasing forbidden token in docstring**

- **Found during:** Task 1 — verify gate `grep -c processMessage src/bot/handlers/voice-decline.ts # expect: 0` returned 1
- **Issue:** Plan-specified docstring contained the literal phrase "NO processMessage call (the engine pipeline is for text messages only)" which trips the grep guard designed to confirm the runtime contract. Phase 25 LEARNINGS lesson 7 explicitly flags this tension.
- **Fix:** Rephrased to "NO engine-pipeline invocation (the engine path is for text messages only)" — rationale preserved, no literal token, grep guard satisfied.
- **Files modified:** src/bot/handlers/voice-decline.ts
- **Verification:** `grep -c processMessage src/bot/handlers/voice-decline.ts` returns 0.
- **Committed in:** `7b4c19f` (Task 1 commit)

**3. [Rule 3 - Blocking] vi.hoisted required for mock factory referencing local const**

- **Found during:** Task 3 — first run of voice-decline.test.ts errored with `Cannot access 'mockGetLastLang' before initialization`
- **Issue:** Plan-specified test code uses `const mockGetLastLang = vi.fn();` followed by `vi.mock('../../../chris/language.js', () => ({ getLastUserLanguage: mockGetLastLang }))`. Vitest hoists vi.mock() to the top of the file, so the factory closure runs BEFORE the local const is initialized.
- **Fix:** Replicated commit 117c6dd Plan 26-02 pattern: `const { mockGetLastLang } = vi.hoisted(() => ({ mockGetLastLang: vi.fn() }));`. The `vi.hoisted` callback runs at the same hoist phase as `vi.mock`, so the closure can reference the destructured const.
- **Files modified:** src/bot/handlers/__tests__/voice-decline.test.ts
- **Verification:** `npx vitest run src/bot/handlers/__tests__/voice-decline.test.ts` exits 0 with all 7 tests green.
- **Committed in:** `b0794da` (Task 3 commit — fix made before commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs, 1 Rule 3 blocker)
**Impact on plan:** All three are mechanical TypeScript / vitest infrastructure fixes that didn't change the plan's specified behavior. The verify gates, acceptance criteria, and runtime semantics are all satisfied; just the literal source text varies from the plan's example code. No scope creep; no new surface added beyond the 4 files in `files_modified`.

## Issues Encountered

**`scripts/test.sh` reports 6 failing test files (50 failed tests) — all pre-existing environmental, NONE caused by Plan 26-04.**

The 6 failing files are documented in `.planning/phases/26-daily-voice-note-ritual/deferred-items.md`:

- `live-integration.test.ts` (21 fails), `live-accountability.test.ts` (3 fails), `vague-validator-live.test.ts` (2 fails), `live-anti-flattery.test.ts`, `models-smoke.test.ts` — all fail with `401 invalid x-api-key` from the Anthropic SDK. Test environment lacks a valid live API key; out-of-scope per SCOPE BOUNDARY rule.
- `contradiction-false-positive.test.ts` — fails with `EACCES: permission denied, mkdir node_modules/@huggingface/transformers/.cache`. Filesystem permission issue on the HuggingFace transformers cache directory; out-of-scope.

**Verified non-regression:** Grep proved that ZERO of the 6 failing files reference any Plan 26-04 surface (`voice-decline`, `handleVoiceMessageDecline`, `message:voice`). Voice-decline.test.ts itself is green (7/7) when run in isolation via `npx vitest run src/bot/handlers/__tests__/voice-decline.test.ts`.

**Cross-phase grep gate `system_suppressed in src/rituals/types.ts` returns 0** — expected because Plan 26-03 (Pre-fire suppression) hasn't shipped yet under the user's reversed plan order ("26-04 next, then 26-03, then 26-05"). When Plan 26-03 lands, that gate will pass naturally; not a regression of Plan 26-04.

## Authentication Gates

None encountered during this plan. The auth gates in `live-integration.test.ts` are environmental noise unrelated to Plan 26-04 work.

## Threat Surface Scan

No new security-relevant surface introduced beyond what the plan's threat model already enumerated:

- T-26-04-01..06 are all `mitigate` or `accept` per the plan; no new threats discovered during execution.
- The voice-decline handler is verifiably side-effect-free beyond `ctx.reply` (proven at module-graph level via grep guard AND at runtime level via the mock-graph in voice-decline.test.ts).
- OOS-3 (no Whisper) honored — `grep -E '^import .*(whisper|openai-whisper|whisper-api|@anthropic)' src/bot/handlers/voice-decline.ts` returns 0.

No threat flags to record.

## User Setup Required

None — voice-decline is fully automatic. Greg sends a Telegram voice message → Chris polite-declines in his last text language → Greg sees the message and (presumably) re-sends via the Android STT keyboard. No external service configuration, no env vars, no DB migration, no operator step.

## Next Phase Readiness

**Plan 26-04 deliverables:**
- VOICE-05 fully covered.
- bot.on('message:voice') registered alongside text + document — Greg's literal voice messages no longer silent-dropped.
- 7 unit tests green; OOS-3 (no Whisper) enforced via static grep guard at import level.

**Phase 26 progress (sequential mode after 26-04):**
- Plan 26-01 complete (substrate: migration 0007 + voice-note constants + rotation primitive)
- Plan 26-02 complete (PP#5 + voice handler + mock-chain coverage; HARD CO-LOC #1 + #5)
- **Plan 26-04 complete (this plan; VOICE-05 polite-decline handler)**
- Plan 26-03 next (VOICE-04 pre-fire suppression — ~80 LoC + ~80 LoC test)
- Plan 26-05 last (Phase 26 LEARNINGS retrospective)

After Plan 26-03 lands, the cross-phase grep gate `grep -nE "system_suppressed" src/rituals/types.ts | wc -l` will return 1 and the Phase 26 milestone will be ready for `/gsd-verify-work`.

**No blockers for Plan 26-03 from this plan.** Plan 26-04 modified zero files that 26-03 will touch — fully decoupled (per D-26-04 plan-split rationale).

## Self-Check: PASSED

Verification of all SUMMARY claims:

**Files created:**
- `src/bot/handlers/voice-decline.ts` → FOUND (49 lines)
- `src/bot/handlers/__tests__/voice-decline.test.ts` → FOUND (91 lines)
- `.planning/phases/26-daily-voice-note-ritual/deferred-items.md` → FOUND

**Files modified:**
- `src/bot/bot.ts` → MODIFIED (+8 lines: 1 import + 7 lines of registration block including comment)

**Commit hashes:**
- `7b4c19f` — FOUND in `git log --oneline --all`
- `3b2b0d6` — FOUND in `git log --oneline --all`
- `b0794da` — FOUND in `git log --oneline --all`

**Test status:**
- voice-decline.test.ts: 7/7 green (verified in Task 3 commit AND in isolation post-test.sh)
- Plan 26-04 grep gates: all green (file exists, exports, 7+ it() blocks, language.js mock, no DB/Pensieve/LLM mocks, no forbidden imports, processMessage=0, storePensieveEntry=0, tsc clean)

**Cross-phase static gates (relevant subset for Plan 26-04):**
- `bot.on('message:voice')` in src/bot/bot.ts → 1 (expected ≥1) ✓

---
*Phase: 26-daily-voice-note-ritual*
*Plan: 04 — Voice message polite-decline handler*
*Completed: 2026-04-28*
