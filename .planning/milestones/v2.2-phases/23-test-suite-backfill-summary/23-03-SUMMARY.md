---
phase: 23-test-suite-backfill-summary
plan: 03
subsystem: bot
tags: [grammy, telegram, command-handler, episodic, retrieval, RETR-01, CMD-01, i18n, intl-datetimeformat, vitest]

# Dependency graph
requires:
  - phase: 22-cron-retrieval-routing
    provides: "getEpisodicSummary(date) RETR-01 retrieval helper from src/pensieve/retrieve.ts. The /summary handler is a pure consumer — it constructs a UTC-midnight Date from the requested YYYY-MM-DD string and passes it through getEpisodicSummary, which performs the timezone-aware day-boundary mapping (formatLocalDate(date, config.proactiveTimezone)) and returns the Drizzle row or null. No direct Drizzle query that would bypass RETR-01 (CONTEXT.md D-29 enforced)."
  - phase: 20-schema-tech-debt
    provides: "episodic_summaries table + Drizzle row shape (episodicSummaries.\\$inferSelect with camelCase summaryDate / emotionalArc / keyQuotes). The handler's formatSummary uses the Drizzle camelCase shape, NOT the snake_case Zod EpisodicSummary type the plan example used — same contract reconciliation Plan 23-01 (TEST-19 ConsolidateResult shape) and Plan 23-02 (discriminated handling) introduced when plan example diverges from runtime."
  - phase: 14-decision-capture-flow
    provides: "src/bot/handlers/decisions.ts language-keyed message-map idiom (langOf + per-message MSG[lang]) + ctx.message.text → /command(?:@\\w+)?\\s* regex strip + chatId-scoped logger.warn error path. /summary handler mirrors this shape verbatim per CONTEXT.md D-26 (handler location) and D-27 (arg parsing pattern)."
  - phase: 4-proactive-chris
    provides: "src/proactive/state.ts Intl.DateTimeFormat with 'en-CA' locale + IANA timeZone idiom for tz-aware day-key computation (hasSentToday). The handler's yesterdayInTz / todayInTz helpers reuse the exact same Intl idiom — no third-party tz dep, no luxon import in the bot handler surface."
  - phase: 1-foundation
    provides: "src/chris/language.ts getLastUserLanguage(chatId) — in-process franc-driven session language map (English | French | Russian | null). Handler uses null → English fallback; tests clearLanguageState beforeEach + afterAll so the in-process Map does not leak across files under vitest fileParallelism: false serial execution."

provides:
  - "src/bot/handlers/summary.ts (205 lines) — handleSummaryCommand Grammy handler exporting the /summary [YYYY-MM-DD] surface. Parses (a) no-args → yesterday-in-config.proactiveTimezone, (b) ISO YYYY-MM-DD → that date, (c) anything else → localized usage help. Future-date short-circuit before any DB call (D-32) replies with the localized 'hasn't happened yet' message. Past-date null row returns the localized 'no summary for that date' message (D-30, NOT an error per CMD-01 verbatim). Uses getEpisodicSummary (RETR-01) — no Drizzle bypass (D-29). Plain text reply, no parse_mode (D-31). Three-language localization (EN/FR/RU) for usage / noRowPast / noRowFuture / genericError / field-labels via the same lang-keyed map idiom decisions.ts uses."
  - "src/bot/bot.ts edit (5 lines added) — handleSummaryCommand import on line 10, bot.command('summary', ...) registration on line 32. Preserves the existing ordering discipline (D-26): all three bot.command(...) calls (sync at L24, decisions at L28, summary at L32) precede the bot.on('message:text', ...) registration at L74."
  - "src/bot/handlers/__tests__/summary.test.ts (236 lines) — 5 it() blocks under describe('CMD-01: /summary handler') covering all D-34 input cases: (a) no-args/yesterday/row-exists, (b) explicit-date/row-exists, (c) past-date/no-row, (d) future-date, (e) garbage-input/usage-help. Real Docker Postgres + duck-typed Grammy Context (captures ctx.reply calls into an array). Cleanup is scoped to 4 fixture dates (no TRUNCATE) so the file cannot collide with synthetic-fixture (Plan 23-01) or backfill (Plan 23-02) rows under serial execution. clearLanguageState beforeEach + afterAll keeps the in-process franc map clean."
  - "Excluded-suite Docker gate raised from 976 (Plan 23-02 baseline) to 981 — exactly +5 from this plan, zero regressions against the 15 documented environmental failures (3 models-smoke API-gated + 7 engine-mute + 5 photos-memory). The +5 matches D-34 cases a-e exactly."

affects:
  - "Phase 23 Plan 04 (TEST-22 live anti-flattery) — independent of CMD-01; gated by ANTHROPIC_API_KEY. Last remaining plan in Phase 23. Expected delta: +1 test (counts when API key present)."
  - "M008 user-facing surface — Greg can now interact directly with the consolidation pipeline via /summary. This is the operator-loop feedback signal: reading daily summaries is how Greg will first notice if the consolidation prompt is over/undershooting on importance, smoothing contradictions, or flattening emotional content. Combined with Plan 23-02's backfill (~5 days of historical summaries already in production after operator runs the backfill), Greg can immediately interrogate Chris's day-level interpretations."
  - "M009 weekly review (planned) — /summary is the daily-tier read surface; M009 will add a weekly-tier read surface (/weekly?) that reads via getEpisodicSummariesRange (Phase 22 RETR-01 sibling). The localization, language-keyed message map, and ordering-before-text-handler discipline established here are the model for the M009 command."

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bot handler ↔ retrieval contract surface: handler accepts a YYYY-MM-DD string from user input, constructs new Date('YYYY-MM-DDT00:00:00Z') (UTC midnight), and passes it to getEpisodicSummary. Phase 22's helper performs the tz-aware reformat back to the local date key before the WHERE clause. Constructing at UTC midnight + relying on the helper's tz-aware reformat is the safe path — any local-time Date constructor (`new Date(targetDate)`) would risk an off-by-one when the host's local tz disagrees with proactiveTimezone."
    - "Future-date short-circuit (D-32) via lexicographic YYYY-MM-DD compare against todayInTz(config.proactiveTimezone). The fixed-width ISO format makes string comparison sound; no Date arithmetic needed for the comparison itself. Skips a wasted DB round-trip for an obviously-impossible request, consistent with the plan's pseudocode."
    - "yesterdayInTz / todayInTz Intl.DateTimeFormat 'en-CA' idiom — locally duplicated rather than imported from src/pensieve/retrieve.ts (formatLocalDate is not exported) or src/proactive/state.ts (its formatter is inlined per-helper, not exported). The duplication is intentional because the bot handler surface should not import from the pensieve retrieval internals; the helper is small, well-documented, and identical in behavior to the proven Phase 22 / Phase 4 implementations."
    - "Drizzle camelCase row shape over Zod snake_case type at the handler boundary — `typeof episodicSummaries.\\$inferSelect` is what getEpisodicSummary actually returns, so formatSummary reads row.summaryDate / row.emotionalArc / row.keyQuotes (NOT the snake_case row.summary_date / row.emotional_arc / row.key_quotes the plan example showed). Same reconciliation Plan 23-01 (TEST-19) and Plan 23-02 (ConsolidateResult discriminated shape) documented when the plan's pseudocode diverges from the runtime contract."
    - "Duck-typed Grammy Context for handler integration tests — buildCtx(text) returns { captured: string[]; ctx: any } with chat.id, from.id, message.text, and a reply callback that pushes to captured. The handler's `as any` cast at the registration site (matching decisions.ts L268 pattern) means this duck-typing works without elaborate type assertions in tests."
    - "Scoped cleanup pattern — `inArray(episodicSummaries.summaryDate, [yesterdayIso, '2026-04-15', '2026-04-16', '2099-01-01'])` instead of TRUNCATE TABLE. Plan 23-01 used TRUNCATE because synthetic-fixture is the sole writer in its block; Plan 23-02 used TRUNCATE for the same reason (under serial execution). This file CAN run alongside other writers in principle (vitest may evolve), and scoping by date is collision-safe even if fileParallelism: false changes."

key-files:
  created:
    - "src/bot/handlers/summary.ts (205 lines) — Grammy command handler. Imports: grammy Context type, getEpisodicSummary from ../../pensieve/retrieve.js, getLastUserLanguage from ../../chris/language.js, config from ../../config.js, logger from ../../utils/logger.js, episodicSummaries TYPE-ONLY from ../../db/schema.js (for the EpisodicRow alias). Exports: handleSummaryCommand(ctx: Context): Promise<void>. Internal helpers: langOf, formatSummary, todayInTz, yesterdayInTz, isFutureDate. ISO_DATE = /^\\d{4}-\\d{2}-\\d{2}$/."
    - "src/bot/handlers/__tests__/summary.test.ts (236 lines) — 5 it() blocks under describe('CMD-01: /summary handler'). Imports: vitest hooks, drizzle-orm inArray, db + sql as pgSql from ../../../db/connection.js, episodicSummaries from ../../../db/schema.js, handleSummaryCommand from ../summary.js, config from ../../../config.js, clearLanguageState from ../../../chris/language.js. FIXTURE_CHAT_ID = 99925 (next free 9992X after 99923 / 99924). Fixture dates: yesterdayIsoForTest() (computed identically to handler's yesterdayInTz), '2026-04-15', '2026-04-16', '2099-01-01'."
  modified:
    - "src/bot/bot.ts — 2 edits (5 lines added net). Edit 1: import { handleSummaryCommand } from './handlers/summary.js' on L10 alongside existing handler imports. Edit 2: bot.command('summary', handleSummaryCommand as any) on L32 immediately after the /decisions registration (L28), preserving the ordering invariant (all bot.command(...) precede bot.on('message:text', ...) at L74)."

key-decisions:
  - "Drizzle camelCase row shape vs. plan's snake_case Zod EpisodicSummary type — the plan example used row.summary_date / row.emotional_arc / row.key_quotes per the Zod EpisodicSummary type defined in src/episodic/types.ts, but the actual return type of getEpisodicSummary is the narrower Drizzle row (`typeof episodicSummaries.\\$inferSelect`) which uses camelCase keys. The handler's formatSummary uses the camelCase Drizzle shape, matching what src/chris/modes/interrogate.ts:29 already does (summary.summaryDate / summary.emotionalArc). Plan invited this adaptation explicitly: 'If the return type is a narrower Drizzle row shape rather than the Zod-inferred type, adapt the formatSummary function's field access — confirm by reading both.' Not a deviation — the plan's Task 1 narrative pre-authorized this reconciliation."
  - "yesterdayInTz / todayInTz / isFutureDate helpers locally inlined rather than imported from pensieve/retrieve.ts or proactive/state.ts — neither file exports a reusable helper (formatLocalDate is module-private; hasSentToday's formatter is inlined). Duplicating the well-proven Intl.DateTimeFormat 'en-CA' idiom (~30 lines total) is preferable to coupling the bot handler surface to pensieve retrieval internals. The helpers are documented with the same source-of-truth Intl rationale Phase 22 used. Future refactor (M009 weekly handler) could lift these into a shared src/utils/tz-dates.ts module if a third caller appears."
  - "Future-date short-circuit (D-32) BEFORE the try/catch around getEpisodicSummary — keeps the future-date branch simple (one ctx.reply, no DB round-trip) and unambiguously distinguishes it from the past-empty branch (which IS a DB query that returns null). The plan's CONTEXT.md D-32 explicitly accepts the alternative ('letting retrieve return null uniformly is acceptable, but reading getEpisodicSummary(futureDate) is a wasted DB round trip for a case the handler can cheaply detect first') — chose the cheap-detect path."
  - "Scoped cleanup via inArray(summaryDate, [yesterdayIso, 2026-04-15, 2026-04-16, 2099-01-01]) — explicitly avoids TRUNCATE TABLE so this file cannot collide with synthetic-fixture (Plan 23-01) or backfill (Plan 23-02) rows. Plan 23-01 / 23-02 each chose TRUNCATE because they were the sole writer in their describe block; this file is the third episodic-tier writer and the scoped path is the safer composition. Cleanup runs beforeEach (so each test starts empty) AND afterEach + afterAll (so failures don't leak rows to subsequent files)."
  - "FIXTURE_CHAT_ID = 99925 (number, not BigInt) — the handler reads ctx.chat.id as number-or-undefined and only converts to string for getLastUserLanguage. No BigInt needed at the bot-handler boundary because Telegram's user IDs fit in JS Number range and the upstream Grammy Context types use number. Plan 23-01 used BigInt(99923) and Plan 23-02 used BigInt(99924) because those tests directly insert into pensieveEntries.chatId (bigint column). This test never touches a chatId-keyed DB column — episodic_summaries has no chat_id (single-user per D009)."
  - "clearLanguageState in beforeEach + afterAll — getLastUserLanguage(chatId) reads from an in-process Map in src/chris/language.ts that persists across test files under vitest fileParallelism: false. Without explicit reset, a prior test file that called setLastUserLanguage(99925, 'French') would change which localized message branch this file's tests assert on. Defensive reset keeps each test deterministic on the English fallback branch."
  - "Test assertions are permissive across EN/FR/RU phrasings (case (c) regex /no summary|pas de résumé|нет сводки/, case (d) /hasn't happened|n'est pas encore|ещё не наступило/, case (e) /yyyy-mm-dd|utilisation|использование|use:/) — defensively allows future tests to switch language inheritance without rewriting these regexes. The 'NOT an error' assertion in case (c) (regex /error|échec|ошибка/ negated) is the load-bearing CMD-01 verbatim contract; making the positive-side regexes permissive doesn't weaken it."

patterns-established:
  - "/command Telegram handler with localized message map + future-date short-circuit + RETR-01 consumer pattern — the M009 weekly review handler (when it arrives) can copy this file's structure verbatim for /weekly [YYYY-MM-DD], swapping getEpisodicSummary for getEpisodicSummariesRange and yesterdayInTz for the start-of-last-week computation. The 5-case D-34 input matrix (no-args / explicit-date / past-empty / future / garbage) is the right test surface for any future date-anchored read command."
  - "Handler integration test pattern with duck-typed Grammy Context + scoped cleanup + clearLanguageState reset — proven in 5/5 passing tests at 663ms targeted run. Replaces the heavier vi.mock-based pattern in src/bot/__tests__/sync-handler.test.ts where a 7-mock prologue is needed because sync touches Gmail/Drive/Immich SDKs. For pure-DB-read handlers (decisions, summary, future M009 weekly), the buildCtx/captured/scoped-cleanup pattern is lighter and more direct."
  - "Bot.ts ordering invariant — all bot.command(...) registrations MUST precede bot.on('message:text', ...). New commands always slot in immediately after the last existing /command registration. Verified per-plan via grep: bot.command lines (24, 28, 32) all < first bot.on('message:text') line (74) in src/bot/bot.ts. Future bot commands (M009 /weekly, etc.) follow the same insertion rule."

requirements-completed: [CMD-01]

# Metrics
duration: "26m"
completed: "2026-04-19"
---

# Phase 23 Plan 03: /summary [YYYY-MM-DD] Telegram Command Summary

**`/summary [YYYY-MM-DD]` Telegram command (CMD-01) — `src/bot/handlers/summary.ts` mirrors decisions.ts shape, no-args defaults to yesterday-in-`config.proactiveTimezone`, explicit ISO date hits Phase 22's `getEpisodicSummary` (no Drizzle bypass per D-29), future dates short-circuit before any DB call (D-32), null-row replies are clear "no summary" messages NOT errors (D-30 / CMD-01 verbatim), three-language localization (EN/FR/RU) for all reply branches, registered before the generic text handler (D-26), proven by 5 integration `it()` blocks against real Docker Postgres covering all D-34 cases a-e.**

## Performance

- **Duration:** ~26 min wall-time
- **Started:** 2026-04-19T09:31:36Z
- **Completed:** 2026-04-19T09:57:12Z
- **Tasks:** 4 (per plan)
- **Files created:** 2 (src/bot/handlers/summary.ts, src/bot/handlers/__tests__/summary.test.ts)
- **Files modified:** 1 (src/bot/bot.ts — 5 lines added)

## Accomplishments

- **`src/bot/handlers/summary.ts` ships the `/summary` command surface.** `handleSummaryCommand(ctx)` parses `/summary` (no-args → yesterday in `config.proactiveTimezone`) and `/summary YYYY-MM-DD` (exact ISO regex) — anything else replies with a localized usage-help string. Future-date short-circuit (D-32) replies with the localized "hasn't happened yet" message BEFORE any DB call. Past dates retrieve via `getEpisodicSummary(date)` (Phase 22 RETR-01) — NO direct Drizzle query that would bypass the contract (D-29). Null-row replies are clear "no summary for that date" messages (D-30 — NOT an error, per CMD-01 verbatim). Plain text reply, no `parse_mode: 'Markdown'` (D-31). Try/catch around the DB call routes any unexpected exception through `logger.warn` + a localized generic-error reply, mirroring the `decisions.ts` error path verbatim.
- **Three-language localization (English / French / Russian) for every reply branch** — usage help, noRowPast, noRowFuture, genericError, and the field-label map (`summaryFor`, `importance`, `topics`, `arc`, `quotes`). Selection via `getLastUserLanguage(chatId)` with English fallback when the in-process franc Map has no entry for the chat — same pattern `decisions.ts` uses.
- **`src/bot/bot.ts` updated with 5 lines** — `import { handleSummaryCommand }` on L10 alongside existing handler imports, and `bot.command('summary', handleSummaryCommand as any)` on L32 immediately after the `/decisions` registration. The ordering invariant (all `bot.command(...)` calls precede `bot.on('message:text', ...)`) holds: command registrations are at L24 / L28 / L32; the text handler registration is at L74. All four lines confirmed via grep.
- **`src/bot/handlers/__tests__/summary.test.ts` ships 5 `it()` blocks under `describe('CMD-01: /summary handler')`** covering every D-34 input case against real Docker Postgres + a duck-typed Grammy Context object:
  1. `/summary` (no-args) → yesterday-row → header contains date + "5/10" + "Topics: test, fixture" + "Emotional arc: flat" + "Key moments" + the verbatim quote.
  2. `/summary 2026-04-15` (explicit date with seeded row) → header contains "2026-04-15" + "8/10" + "Topics: test, fixture".
  3. `/summary 2026-04-16` (past date no row) → reply contains "no summary" / "pas de résumé" / "нет сводки" + the requested date AND does NOT contain "error" / "échec" / "ошибка" (CMD-01 verbatim "not an error").
  4. `/summary 2099-01-01` (future date) → reply contains the localized "hasn't happened yet" phrase + the requested date.
  5. `/summary not-a-date` → reply contains the localized usage-help phrase ("YYYY-MM-DD" or "Use:" or "Utilisation" or "Использование").
- **Targeted vitest run: 5/5 passed in 663ms.** Excluded-suite Docker gate: **981 passed / 15 failed / 996 total / 28.32s = +5 vs the 976 Plan 23-02 baseline, zero regressions.** The 15 environmental failures match the documented Plan 22 / Plan 23-01 / Plan 23-02 baseline exactly:
  - 3 × `llm/__tests__/models-smoke.test.ts` (real Anthropic API calls — 401 with `test-key`)
  - 7 × `chris/__tests__/engine-mute.test.ts` (pre-existing engine-mute issues)
  - 5 × `chris/__tests__/photos-memory.test.ts` (pre-existing photos-memory issues)

## Task Commits

Each task was committed atomically:

1. **Task 1: src/bot/handlers/summary.ts (CMD-01 handler)** — `38b99f5` (feat)
2. **Task 2: register /summary in bot.ts before generic text handler** — `a99d658` (feat)
3. **Task 3: 5-block integration test (D-34 cases a-e)** — `5134e6f` (test)
4. **Task 4: Final gate — tsc + scripts/test.sh + ordering verification** — verification-only, no commit (mitigation per Plans 23-01 / 23-02 documented pattern; full `bash scripts/test.sh` hung at the documented vitest 4 fork-mode IPC hang in `live-integration.test.ts`'s 401 retry loop against real Anthropic API; documented excluded-suite mitigation produced 981 passed / 15 failed = +5 vs baseline)

**Plan metadata commit:** pending (this SUMMARY + STATE/ROADMAP/REQUIREMENTS update — final commit below).

## Files Created/Modified

- **`src/bot/handlers/summary.ts`** (NEW, 205 lines) — Grammy `/summary` handler. Exports: `handleSummaryCommand(ctx: Context): Promise<void>`. Internal helpers: `langOf` (English fallback for null lang), `formatSummary` (camelCase Drizzle row → plain-text Telegram message), `todayInTz` / `yesterdayInTz` (Intl.DateTimeFormat 'en-CA' + IANA timeZone idiom), `isFutureDate` (lexicographic YYYY-MM-DD compare). Constants: `ISO_DATE = /^\d{4}-\d{2}-\d{2}$/`, `MSG = { usage, noRowPast, noRowFuture, genericError, labels }` keyed by `'English' | 'French' | 'Russian'`. Imports: `grammy` Context type, `getEpisodicSummary` from `../../pensieve/retrieve.js`, `getLastUserLanguage` from `../../chris/language.js`, `config` from `../../config.js`, `logger` from `../../utils/logger.js`, `episodicSummaries` TYPE-ONLY from `../../db/schema.js` (for the EpisodicRow alias).
- **`src/bot/bot.ts`** (MODIFIED, +5 lines net) — added `import { handleSummaryCommand } from './handlers/summary.js'` on L10 alongside existing handler imports; added `bot.command('summary', handleSummaryCommand as any)` on L32 immediately after the `/decisions` registration. Preserves ordering invariant: command registrations at L24 (sync) / L28 (decisions) / L32 (summary); text handler at L74.
- **`src/bot/handlers/__tests__/summary.test.ts`** (NEW, 236 lines) — 5 it() blocks. Imports: vitest hooks, drizzle-orm inArray, `db` + `sql as pgSql` from `../../../db/connection.js`, `episodicSummaries` from `../../../db/schema.js`, `handleSummaryCommand` from `../summary.js`, `config` from `../../../config.js`, `clearLanguageState` from `../../../chris/language.js`. Helpers: `yesterdayIsoForTest()` (mirrors handler's tz-aware idiom exactly), `buildCtx(text, chatId?)` (duck-typed Grammy Context with captured: string[]), `seedSummary(date, importance)`, `cleanup()` (scoped inArray on 4 fixture dates). FIXTURE_CHAT_ID = 99925; PAST_DATE_WITH_ROW = '2026-04-15'; PAST_DATE_NO_ROW = '2026-04-16'; FUTURE_DATE = '2099-01-01'.

## Decisions Made

- **Drizzle camelCase row shape over Zod snake_case at the handler boundary** — the plan example used `row.summary_date` / `row.emotional_arc` / `row.key_quotes` per the Zod `EpisodicSummary` type, but `getEpisodicSummary` returns the Drizzle `episodicSummaries.$inferSelect` row which uses camelCase (`summaryDate` / `emotionalArc` / `keyQuotes`). The handler uses the camelCase shape, matching `src/chris/modes/interrogate.ts:29` which has been doing the same since Phase 22-03. The plan invited this adaptation explicitly ("confirm by reading both"); not logged as a deviation because Task 1's narrative pre-authorized it.
- **Helpers locally inlined rather than imported from pensieve/retrieve.ts (private formatLocalDate) or proactive/state.ts (per-helper inlined formatter)** — neither file exports a reusable helper. Duplicating the well-proven `Intl.DateTimeFormat` `'en-CA'` idiom (~30 lines total) is preferable to coupling the bot handler surface to pensieve retrieval internals. Future refactor could lift these into `src/utils/tz-dates.ts` if M009's weekly handler becomes a third caller.
- **Future-date short-circuit BEFORE the try/catch around `getEpisodicSummary`** — keeps the future-date branch simple (one ctx.reply, no DB round-trip) and unambiguously distinguishes it from the past-empty branch (which IS a DB query). CONTEXT.md D-32 explicitly accepted either path; chose the cheap-detect path.
- **Scoped cleanup via `inArray(summaryDate, [...])`, NOT TRUNCATE TABLE** — Plans 23-01 / 23-02 used TRUNCATE because each was the sole writer in its describe block. This file is the third episodic-tier writer and the scoped path is the safer composition under vitest's serial execution (and resilient if `fileParallelism: false` ever flips).
- **FIXTURE_CHAT_ID = 99925 (number, not BigInt)** — handler reads `ctx.chat.id` as number-or-undefined and only stringifies for `getLastUserLanguage`. No BigInt needed at the bot-handler boundary; episodic_summaries has no chat_id column (single-user per D009). Plans 23-01 (BigInt 99923) and 23-02 (BigInt 99924) used BigInt because they directly inserted into `pensieveEntries.chatId` (bigint column).
- **`clearLanguageState` in `beforeEach` + `afterAll`** — `getLastUserLanguage(chatId)` reads from an in-process Map that persists across test files under `fileParallelism: false`. Without explicit reset, a prior file calling `setLastUserLanguage(99925, 'French')` would change which localized branch this file's tests assert on. Defensive reset keeps every test deterministic on the English fallback branch.
- **Permissive cross-localization regexes in case (c) (`/no summary|pas de résumé|нет сводки/`), case (d) (`/hasn't happened|n'est pas encore|ещё не наступило/`), and case (e) (`/yyyy-mm-dd|utilisation|использование|use:/`)** — defensively allows future tests (or other test files in serial execution) to switch language inheritance without rewriting these regexes. The load-bearing CMD-01 verbatim contract — case (c)'s "NOT an error" — is the negated-regex assertion `/error|échec|ошибка/`, which keeps its strict semantics.

## Deviations from Plan

None — plan executed exactly as written.

The plan's Task 1 narrative explicitly anticipated the Drizzle camelCase row shape vs. Zod snake_case adaptation ("If the return type is a narrower Drizzle row shape rather than the Zod-inferred type, adapt the formatSummary function's field access — the DB row uses snake_case column names while the Zod EpisodicSummary type uses snake_case as well per Plan 20-02. Confirm by reading both."). Reading both surfaces revealed the Drizzle row uses **camelCase** (because Drizzle `$inferSelect` translates snake_case columns to camelCase TS keys via the field mapper), and the camelCase usage matches the existing `src/chris/modes/interrogate.ts:29` pattern shipped in Phase 22-03. Adopting camelCase is the documented adaptation path the plan invited — not a deviation.

The plan's Task 3 narrative anticipated possible cleanup-collision concerns ("The cleanup function must scope to the fixture dates; do NOT wipe the whole `episodic_summaries` table"). Implementation followed verbatim — `cleanup()` uses `inArray(summaryDate, [yesterdayIso, '2026-04-15', '2026-04-16', '2099-01-01'])`. Not a deviation; explicit plan compliance.

**Total deviations:** 0 (zero auto-fixes; zero scope expansions). All design choices are plan-anticipated key-decisions or carried-forward Plans 23-01 / 23-02 reconciliations.

## Issues Encountered

**1. Vitest 4 fork-mode IPC hang in `live-integration.test.ts` (recurred in the full Docker run).**

Same documented pattern as Plans 22-02 / 22-03 / 22-04 / 22-05 / 23-01 / 23-02 SUMMARYs. The first `bash scripts/test.sh` ran cleanly through migrations + most non-live test files but then hung in `live-integration.test.ts`'s 401-retry loops against real Anthropic API (the `test-key` env var produces `401 invalid x-api-key` and the test enters a continuous re-mute / re-mode-detect loop). After ~18 minutes of no test-summary output, the run was terminated and the documented excluded-suite mitigation applied:

```bash
DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris \
  ANTHROPIC_API_KEY=test-key TELEGRAM_BOT_TOKEN=test-token \
  TELEGRAM_AUTHORIZED_USER_ID=99999 \
  npx vitest run \
  --exclude '**/live-integration.test.ts' \
  --exclude '**/live-accountability.test.ts' \
  --exclude '**/vague-validator-live.test.ts' \
  --exclude '**/contradiction-false-positive.test.ts'
```

Result: **981 passed / 15 failed / 996 total / 28.32s = +5 vs 976 Plan 23-02 baseline, zero regressions.** The 15 remaining failures match the documented Phase 22 / Plans 23-01 / 23-02 baseline exactly:

- 3 × `llm/__tests__/models-smoke.test.ts` (real Anthropic API calls — 401 with `test-key`)
- 7 × `chris/__tests__/engine-mute.test.ts` (pre-existing engine-mute issues)
- 5 × `chris/__tests__/photos-memory.test.ts` (pre-existing photos-memory issues)

No new regressions introduced by Plan 23-03. The mitigation will be carried forward through Plan 23-04 until the upstream Vitest 4 + @huggingface/transformers EACCES issue is resolved.

## Threat Model

- **T-23-03-01 (T — user submits a malformed date that bypasses the regex and hits the DB) — mitigated by the strict `^\d{4}-\d{2}-\d{2}$` ISO_DATE regex.** Anything that doesn't exactly match the fixed-width 10-char ISO format falls into the "garbage input" branch and replies with usage help. The regex is anchored at both ends; no leading/trailing whitespace, no extra tokens, no `2026-2-3` short forms, no `2026-04-15foo` smuggled tokens. The `after` string is also `.trim()`-ed before regex test.
- **T-23-03-02 (T — operator runs `/summary` for a future date in a different host tz) — mitigated by `isFutureDate(targetDate, config.proactiveTimezone)`.** The boundary check uses `config.proactiveTimezone` (Greg's local tz, Europe/Paris by default) for both "today" and the comparison, so the future-date message fires consistently regardless of where the bot host is physically located. Lexicographic compare on YYYY-MM-DD works because the format is fixed-width.
- **T-23-03-03 (T — empty episodic_summaries row leaks user-origin content via Markdown injection) — mitigated by D-31 plain-text reply.** No `parse_mode: 'Markdown'` or `'HTML'` anywhere in the handler. `formatSummary` joins lines with `\n` and renders quotes with literal `"..."` wrappers — Telegram treats the entire reply as plain text, so user-origin content in `key_quotes` cannot smuggle Markdown formatting or `[link](attacker.com)` payloads. (Single-user system per D009 limits the threat surface anyway, but the defensive choice still matters for future multi-user evolution.)
- **T-23-03-04 (T — handler bypasses RETR-01 and queries Drizzle directly) — mitigated by D-29 enforcement and code review surface.** The handler imports ONLY `getEpisodicSummary` from `pensieve/retrieve.js`; no `db.select` / `episodicSummaries` table reference exists in the handler body. Phase 22's RETR-01 helper performs the timezone-aware day-boundary mapping; bypassing it would risk an off-by-one when the host's local tz disagrees with `proactiveTimezone`. Verified by grep: zero `db\.select\|episodicSummaries\.summaryDate` in `src/bot/handlers/summary.ts`.
- **T-23-03-05 (I — handler error path leaks DB error details to the user) — mitigated by the generic-error message branch.** The try/catch routes any unexpected exception through `logger.warn` (which captures `chatId`, `targetDate`, and the error message — no user-content), and replies to the user with the localized `genericError` string ("I ran into trouble fetching that summary. Try again in a moment.") — no DB error specifics, no stack traces, no schema names. Same pattern as `decisions.ts:67` (`'decisions.dashboard.error'`).
- **T-23-03-06 (I — single-user authorization bypass) — mitigated by Grammy `auth` middleware (D009).** The handler does not perform per-message auth checks; it inherits the auth middleware registered at `src/bot/bot.ts:19` (`bot.use(auth)`), which silently drops messages from any user_id ≠ `config.telegramAuthorizedUserId`. No defensive duplicate auth in the handler (would be redundant; would risk the auth contract drifting in two places).

## Threat Flags

None. The /summary handler reads from an existing single-user table via an existing retrieval contract; no new endpoints, no new schema, no new trust boundaries.

## Next Phase Readiness

- **Plan 23-03 complete.** CMD-01 satisfied end-to-end. The /summary command is shippable; the integration tests assert all D-34 cases against real Postgres.
- **Plan 23-04 (TEST-22 live anti-flattery) ready.** Independent of CMD-01; gated by `ANTHROPIC_API_KEY` (`describe.skipIf(!process.env.ANTHROPIC_API_KEY)`). Expected delta +1 test (counts when the API key is present). Last remaining plan in Phase 23.
- **Operational milestone:** Greg can now interact directly with the consolidation pipeline via `/summary` — the M008 user-facing feature. Combined with Plan 23-02's backfill (run once for ~5 days of historical summaries), Greg can immediately interrogate Chris's day-level interpretations and start the operator-loop feedback signal that surfaces consolidation-prompt drift.
- **Test count progression:** Plan 23-02 baseline 976 → Plan 23-03 result 981 (+5 from summary.test.ts). Phase 23 contractual floor (> 152) cleared by 829. Phase 23 planner-target (≥ 165) cleared by 816. 9 of 10 Phase 23 requirements closed (TEST-15..TEST-21 + OPS-01 + CMD-01); only TEST-22 remains.
- **No new tech debt introduced.** Two new files + one 5-line edit. No new dependencies (Intl.DateTimeFormat is Node 22 native; everything else was already imported elsewhere). No new schema. No new external surface.

## Self-Check: PASSED

Verified all claims:

- [x] `src/bot/handlers/summary.ts` exists (205 lines, > 80 plan minimum)
- [x] File contains `handleSummaryCommand` export
- [x] File imports `getEpisodicSummary` from `'../../pensieve/retrieve.js'`
- [x] File imports `getLastUserLanguage` from `'../../chris/language.js'`
- [x] File imports `config` from `'../../config.js'`
- [x] File imports `logger` from `'../../utils/logger.js'`
- [x] File contains `ISO_DATE` regex matching `YYYY-MM-DD` exactly (`/^\d{4}-\d{2}-\d{2}$/`)
- [x] File contains `yesterdayInTz(tz)` and `todayInTz(tz)` helpers using `Intl.DateTimeFormat` with `'en-CA'` locale
- [x] File contains `isFutureDate(iso, tz)` helper
- [x] File contains localized message strings for English/French/Russian for: usage, noRowPast, noRowFuture, genericError, and field labels
- [x] Uses `ctx.reply(plainText)` only — NO `parse_mode: 'Markdown'` anywhere (grep confirmed)
- [x] Wraps `getEpisodicSummary` in try/catch; error branch calls `logger.warn` + replies with genericError string
- [x] `src/bot/bot.ts` contains `import { handleSummaryCommand } from './handlers/summary.js'` on L10
- [x] `src/bot/bot.ts` contains `bot.command('summary', handleSummaryCommand as any)` on L32
- [x] All `bot.command(...)` lines (24 sync, 28 decisions, 32 summary) precede the `bot.on('message:text', ...)` registration on L74 (ordering invariant)
- [x] `bot.command('sync', ...)` and `bot.command('decisions', ...)` registrations unchanged
- [x] `src/bot/handlers/__tests__/summary.test.ts` exists (236 lines, > 120 plan minimum)
- [x] Test contains exactly 5 `it(` blocks
- [x] Test contains string `CMD-01` in the describe block
- [x] Test contains `expect(captured).toHaveLength(1)` for every case
- [x] Test (a) seeds a row for "yesterday" via `yesterdayIsoForTest()` and asserts the reply contains the date + `5/10`
- [x] Test (b) seeds a row for `2026-04-15` and asserts the reply contains `'8/10'` importance
- [x] Test (c) asserts the reply contains the requested date string AND does NOT contain `error|échec|ошибка`
- [x] Test (d) uses future date `2099-01-01` and asserts the reply matches `/hasn't happened|n'est pas encore|ещё не наступило/`
- [x] Test (e) uses non-date string `'not-a-date'` and asserts the reply is usage help (`/yyyy-mm-dd|utilisation|использование|use:/`)
- [x] `npx tsc --noEmit` exits 0 (verified twice: after summary.ts, after bot.ts edit, after summary.test.ts)
- [x] Targeted vitest run: `npx vitest run src/bot/handlers/__tests__/summary.test.ts` → 5/5 passing / 663ms
- [x] Excluded-suite Docker run: 981 passed / 15 failed / 996 total / 28.32s = +5 vs 976 Plan 23-02 baseline, zero regressions
- [x] Three task commits exist in `git log`: 38b99f5 (Task 1 handler) + a99d658 (Task 2 bot.ts) + 5134e6f (Task 3 test)
- [x] Files match must_haves invariants (handler exports handleSummaryCommand; bot.ts contains bot.command('summary'; test file contains handleSummaryCommand)
- [x] No files outside the three listed in files_modified touched (verified via git diff)

---

*Phase: 23-test-suite-backfill-summary*
*Completed: 2026-04-19*
