---
phase: 26-daily-voice-note-ritual
reviewed_at: 2026-05-14
files_reviewed: 7
blocker_count: 4
warning_count: 6
---

# Phase 26 Code Review — Daily Journal Ritual (formerly daily_voice_note)

**Reviewer:** Claude (gsd-code-reviewer)
**Depth:** standard
**Status:** issues_found

## Scope

Reviewed CURRENT state of the source files originally shipped under Phase 26 plans 26-01..26-05 (renamed voice_note → journal in Phase 31). Files reviewed:

1. `src/rituals/journal.ts` (was `voice-note.ts` — renamed by commit `9dbae99`)
2. `src/bot/handlers/voice-decline.ts`
3. `src/db/migrations/0007_daily_voice_note_seed.sql`
4. `src/db/migrations/0011_rename_daily_voice_note_to_journal.sql`
5. `scripts/fire-ritual.ts`
6. `src/chris/engine.ts` (PP#5 block lines 178–253)
7. `src/pensieve/store.ts` (epistemicTag addition, lines 30–65)

Phase 26 originally shipped at commit `c91a38a` (cadence-anchoring fix). Several listed issues were introduced/already-present at Phase 26 ship and were patched later (Phase 28, Phase 31, Phase 32, 2026-05-11 hotfix); per scoping rules I review what shipped under Phase 26 and call out the live bugs in the inherited codebase that were created by that phase.

---

## BLOCKER Issues

### BL-01: VOICE-04 pre-fire suppression is structurally inert — `metadata.mode = 'JOURNAL'` is never written

- **File:** `src/rituals/journal.ts:281` (predicate); cross-referenced against `src/chris/modes/journal.ts:29-31` (the supposed writer)
- **Issue:** `shouldSuppressJournalFire` counts Pensieve entries with `WHERE source = 'telegram' AND metadata->>'mode' = 'JOURNAL'`. But `handleJournalMode` (`src/chris/modes/journal.ts:29`) calls `storePensieveEntry(text, 'telegram', { telegramChatId: Number(chatId) })` — it does NOT set `metadata.mode = 'JOURNAL'`. A grep across `src/chris/modes/` finds zero writers that put `mode: 'JOURNAL'` into Pensieve metadata. CONTEXT.md D-26-05's premise ("the Pensieve writer puts `mode: 'JOURNAL'` into metadata") is FALSE in the actual code path. The integration test in `voice-note-suppression.test.ts` only passes because it seeds rows by hand with `metadata.mode = 'JOURNAL'`, which doesn't reflect any production write path.
- **Impact:** VOICE-04 is effectively DEAD CODE in production. The suppression branch will NEVER trigger no matter how many journal entries Greg makes today. Pitfall 9 (heavy-deposit-day redundancy) is unmitigated despite the plan claiming it is.
- **Fix:** Either (a) extend `handleJournalMode` to set `metadata.mode = 'JOURNAL'` on the `storePensieveEntry` call so the suppression predicate matches what's written, or (b) reformulate `shouldSuppressJournalFire` to count by an actually-written signal (e.g., `epistemic_tag = 'INTROSPECTION'` count, or join through `conversations` where `mode = 'JOURNAL'` already exists). Option (a) is the safer/minimal-blast-radius fix.

### BL-02: PP#5 hijacks any user-initiated message inside the 18-hour response window (original Phase 26 contract was unsafe)

- **File:** `src/chris/engine.ts:192-195` (current); originally `src/chris/engine.ts` at commit `3ef989a` did `const pending = await findActivePendingResponse(chatIdStrPP5, new Date())` with NO reply-to-message gate
- **Issue:** As shipped in Phase 26 (commit `3ef989a`), PP#5 fires on EVERY incoming user text within `RESPONSE_WINDOW_HOURS = 18`. There is no check that the user actually intended this message as a reply to the ritual prompt. So if Greg gets a journal prompt at 21:00, then at 22:30 messages Chris something unrelated ("what's a good book on X?"), Chris silently captures it as a journal response and returns the empty string — defeating the user's intent and emitting no chat response. The 2026-05-11 hotfix retrofitted a `replyToMessageId` gate (line 193: `opts?.replyToMessageId !== undefined`) precisely because this bug surfaced in production. CONTEXT.md D-26-02 design called for the state-table lookup as the load-bearing invariant but did not specify any user-intent disambiguation — the design itself shipped with this flaw.
- **Impact:** Catastrophic UX: legitimate Greg-initiated conversations get swallowed silently within the 18h window after every journal fire (which is most of every day). Pitfall 6's mitigation overshoots into Pitfall-6-inverse: Chris fails to respond to messages Greg actually wanted a reply to.
- **Fix:** The 2026-05-11 hotfix is the right shape — gate PP#5 on an explicit Telegram reply (`replyToMessageId !== undefined`) AND ideally also verify the reply targets the Chris-sent prompt message id. Phase 26 should have shipped this gate at minimum.

### BL-03: VOICE-03 no-consecutive-duplicate invariant is unenforced at cycle boundary (~17% back-to-back duplicate rate)

- **File:** Original `src/rituals/voice-note.ts:301` at commit `c91a38a` (current `src/rituals/journal.ts:362-363` — already patched in Phase 32 commit `803b2f9`)
- **Issue:** Phase 26 shipped `const lastIdx = bag.length === 0 ? undefined : bag[bag.length - 1];`. This is wrong on two counts: (1) when `bag.length === 0` (the cycle-boundary refill case — the EXACT case where the no-consecutive-duplicate guard is supposed to fire), `lastIdx` is undefined and the guard inside `chooseNextPromptIndex` becomes a no-op. (2) When the bag is non-empty, `bag[bag.length - 1]` is the LAST not-yet-used index in the CURRENT bag (i.e., a future fire), not the just-fired (past) index. Either way, the no-consecutive-duplicate invariant claimed by VOICE-03 is not actually enforced at cycle boundaries — empirically the system produces back-to-back duplicates ~1/6 (~17%) of cycle transitions. The Phase 32 fix commit `803b2f9` explicitly documents this: "the no-consecutive-duplicate guard had no signal — producing a back-to-back duplicate ~1/PROMPTS.length (~17%) of the time".
- **Impact:** VOICE-03 acceptance criterion ("zero consecutive duplicates") is not actually met in production despite the property test claiming green. The property test only ran one continuous loop with `Math.random` and the loop's lastIdx tracking is separate from how the real handler reads/writes state across cron ticks — the test does not reproduce the cross-tick state plumbing that the production handler relies on.
- **Fix:** Persist the prior fired index in `cfg.last_fired_prompt_idx` and read it on the next fire (the Phase 32 fix). The property test should also be reshaped to simulate the cross-tick read/write cycle, not just the in-process loop.

### BL-04: `shouldSuppressJournalFire` and the suppression branch use INCONSISTENT timezones — count window can mis-align with advancement window

- **File:** `src/rituals/journal.ts:273` uses `config.proactiveTimezone` (env-var-derived module constant). `src/rituals/journal.ts:327` uses `cfg.time_zone` (per-ritual config field).
- **Issue:** The suppression count uses the env timezone (`config.proactiveTimezone`); the next_run_at advancement to "tomorrow's end-of-day" uses the per-ritual config timezone (`cfg.time_zone`). The migration 0007 seed sets `time_zone = 'Europe/Paris'` and `proactiveTimezone` defaults to `Europe/Paris`, so today these match — but the system explicitly supports per-ritual `time_zone` (RitualConfigSchema requires it). Any deployment where these two timezones differ (e.g., a future global-deploy, or operator-edited rituals.config), the suppression decision counts deposits over one local day and advances the ritual to a different local-day's 21:00 — potentially advancing to today's still-future 21:00 (defeating the "skip today entirely" semantic the cadence-anchoring fix was meant to solve), or skipping two days.
- **Impact:** Latent correctness bug. Only invisible because the two values happen to match in the production deployment. A future config change OR an operator using `scripts/fire-ritual.ts daily_journal` with a non-Paris `cfg.time_zone` would silently produce wrong-day behavior.
- **Fix:** Pick ONE source of truth — the per-ritual `cfg.time_zone` is the more correct (it's what the user-configured fire_at is interpreted against). Change line 273 to `dayBoundaryUtc(now, cfg.time_zone)`. This requires `shouldSuppressJournalFire` to take `cfg` as a parameter rather than reading the module-scope `config`.

---

## WARNING Issues

### WR-01: `fireJournal` STEP 4 config write-back clobbers any concurrent config update

- **File:** `src/rituals/journal.ts:390-398`
- **Issue:** STEP 4 does `db.update(rituals).set({ config: updatedCfg }).where(eq(rituals.id, ritual.id))` where `updatedCfg = { ...cfg, prompt_bag: newBag, last_fired_prompt_idx: promptIdx }`. The `cfg` is a stale snapshot captured by the scheduler at the start of dispatch (`parseRitualConfig(ritual.config)` in scheduler.ts:140). Any concurrent write to `rituals.config` between scheduler STEP 2 and journal STEP 4 (e.g., adjustment_mute_until update from an in-flight adjustment dialogue, Phase 28 mute_until updates, future operator config edits via the planned tooling) gets silently clobbered.
- **Impact:** Lost writes for any config field other than prompt_bag/last_fired_prompt_idx. The collision window is short (typically <100ms within a single sweep tick), but the operator-config-edit path is unbounded.
- **Fix:** Use a jsonb merge or scoped update: `db.update(rituals).set({ config: sql\`config || ${JSON.stringify({prompt_bag: newBag, last_fired_prompt_idx: promptIdx})}::jsonb\` })`. Or read-modify-write inside a transaction with row locking.

### WR-02: Telegram-send-then-INSERT race leaves Pitfall 6 unenforceable on DB failure

- **File:** `src/rituals/journal.ts:374-385`
- **Issue:** STEP 2 (`bot.api.sendMessage`) runs BEFORE STEP 3 (insert `ritual_pending_responses` row). The plan rationale says this is intentional ("If this throws, no pending row is inserted, so PP#5 won't have a stale binding"). But the inverse race is unhandled: if `sendMessage` succeeds and the INSERT fails (DB outage, deadlock, transient connection drop), Greg sees the prompt but PP#5 has no pending row. When Greg replies, the engine routes the message through the normal pipeline → Chris responds → Pitfall 6 manifests AND the response is mis-tagged.
- **Impact:** Pitfall 6 reproduces under any post-send DB error. Low probability per fire, but the consequence (Chris breaking the silent-deposit contract) is exactly what HARD CO-LOC #1 was supposed to prevent.
- **Fix:** Either insert pending row FIRST (with a "sent_at" column to indicate Telegram confirmation, plus a sweep to clean pending-but-never-sent rows), OR wrap send + insert in a saga pattern with retry on insert. The two-phase commit problem with Telegram is hard, but logging a structured `error: 'pp5.binding_lost'` event on insert-after-send failure would at least surface the regression.

### WR-03: PROMPTS are English-only and sent to Greg without language detection (violates FR/RU localization guardrail)

- **File:** `src/rituals/journal.ts:51-58, 369, 374`
- **Issue:** All 6 prompts are English literals. `fireJournal` line 374 calls `bot.api.sendMessage(Number(chatId), prompt)` with the English string — no consultation of `getLastUserLanguage(chatIdStr)` or any localization layer. The voice-decline handler (Plan 26-04) was correctly built EN/FR/RU per D-26-09, but the main ritual prompt path was not. The project guard rail (per task statement) requires FR/RU localization for user-facing copy; CONTEXT.md VOICE-02 didn't spec FR/RU prompts but that doesn't override the project-wide constraint.
- **Impact:** When Greg is in a French or Russian conversation thread, the daily prompt suddenly switches him to English — a UX regression vs. M006 multilingual stickiness.
- **Fix:** Either (a) translate the PROMPTS array into FR/RU triplets and select by `getLastUserLanguage(chatIdStr)` at fire time, or (b) explicitly document English-only-by-design in the spec (which CONTEXT.md does not). At minimum, log the language-mismatch as a known-deferred item rather than silent.

### WR-04: `incrementRitualDailyCount` is called on `system_suppressed` outcome — suppressed fires consume the 3/day channel slot

- **File:** `src/rituals/scheduler.ts:252` (always called after `dispatchRitualHandler` returns regardless of outcome)
- **Issue:** When fireJournal returns `'system_suppressed'`, the scheduler still calls `incrementRitualDailyCount`, consuming a channel-cap slot. The VOICE-04 design says "do NOT increment skip_count" but says nothing about the channel-cap counter. On a high-deposit day, the journal ritual self-suppresses but still eats 1 of 3 daily channel slots — leaving only 2 for wellbeing/weekly-review/etc.
- **Impact:** Channel-cap budget is wasted on no-op suppressed fires, which could starve later-scheduled rituals on heavy-journal days. Operationally minor today (Phase 26 has only 1 ritual) but compounds as Phases 27/29 ship.
- **Fix:** In `runRitualSweep` STEP 6 success path, only call `incrementRitualDailyCount` when `outcome !== 'system_suppressed'` (and probably also skip on `'in_dialogue'`). The semantic intent is "this ritual consumed proactive-channel attention", which a system-suppressed fire by definition did NOT.

### WR-05: Pre-existing `engine-mute.test.ts` ECONNREFUSED failures were silently "fixed" by adding mocks, hiding a real config drift

- **File:** `src/chris/__tests__/engine-mute.test.ts` (Plan 26-02 added 5 decision-capture mocks)
- **Issue:** Plan 26-01 SUMMARY recorded 7 pre-existing ECONNREFUSED failures in `engine-mute.test.ts` (real DB connection attempts hitting `::1:5432`). Plan 26-02 added mocks for `decisions/{capture-state,capture,resolution,triggers,suppressions}.js` to make the tests green. This is a Pitfall-24-class regression masking: the tests now pass not because the engine code is correct under mute conditions, but because the decision-capture module never executes in the test. If the engine's mute path ever depends on decision-capture state (or a future refactor introduces such a dependency), the test will provide false coverage.
- **Impact:** False test coverage. Future refactors of the mute path could silently break against real DB integration while engine-mute.test.ts stays green.
- **Fix:** Either reframe engine-mute.test.ts as a unit-level test with explicit "no DB integration" charter, or supply a real DB harness like engine-pp5.test.ts does. The current state is the worst of both worlds.

### WR-06: `fire-ritual.ts` operator script has no dry-run flag and side-effects on first arg parse

- **File:** `scripts/fire-ritual.ts:42-58`
- **Issue:** Running `npx tsx scripts/fire-ritual.ts daily_journal` mutates `rituals.next_run_at` BEFORE doing anything else. There is no `--dry-run` flag. Operator typos that PASS the WHERE filter (e.g., during staging a developer accidentally types `weekly_review` when meaning to test journal) silently backdate a different ritual and trigger a sweep. The hard-fail-on-zero-rows guard protects against typos that DON'T match a real ritual, but does nothing for typos that match an unintended one.
- **Impact:** Low — single-trusted-operator system, single user. But the script is documented in ROADMAP as the manual UAT entry point, so guardrails matter.
- **Fix:** Add `--dry-run` flag that prints "would fire ritual <name> at <next_run_at>" without mutating. Optional: read confirmation from stdin before mutating in non-`--yes` mode.

---

## Out-of-scope notes

- Performance issues skipped per v1 review scope (the COUNT query in `shouldSuppressJournalFire` is O(today's pensieve entries) but bounded by daily cap; not a correctness issue).
- The migration 0007 idempotency guards, partial index declaration, and DEFAULT-then-DROP-DEFAULT pattern are correct.
- Drizzle queries use parameterized inputs throughout — no SQL injection surface found in Phase 26 code.
- The `voice-decline.ts` handler is well-localized (EN/FR/RU) and has no analogous concatenation bug to `adjustment-dialogue.ts:285`. The DECLINE_MESSAGES templates use complete sentences, not slug+name composition.
- `recordJournalResponse` race-loss handling is correctly atomic via `WHERE consumed_at IS NULL RETURNING`.
- Adversarial check for the `adjustment-dialogue.ts:285` pattern (cadence+name slug concatenation in user-visible strings) found NO occurrences in Phase 26 code — neither the PROMPTS array, nor `voice-decline.ts` templates, nor `rituals.journal.fired/suppressed` log lines mix ritual.name or ritual.type into user-facing text.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
