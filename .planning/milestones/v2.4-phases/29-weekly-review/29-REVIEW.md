---
phase: 29-weekly-review
reviewed_at: 2026-05-14
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/rituals/weekly-review.ts
  - src/rituals/weekly-review-prompt.ts
  - src/rituals/weekly-review-sources.ts
  - src/db/migrations/0009_weekly_review_seed.sql
  - src/rituals/scheduler.ts
blocker_count: 3
warning_count: 6
findings:
  critical: 3
  warning: 6
  info: 0
  total: 9
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-05-14
**Depth:** standard
**Files Reviewed:** 5 (5 source + 1 migration; tests not reviewed)
**Status:** issues_found

## Summary

Phase 29 ships the first Sonnet-driven weekly ritual (Sunday 20:00 Paris) plus the templated EN-only fallback. The HARD CO-LOC #2/#3 atomic implementation is structurally sound (Stage-1 regex, Stage-2 Haiku judge, date-grounding post-check, retry-cap-2). However the orchestrator `fireWeeklyReview` has **three Critical defects** that all share the same root cause: write ordering in steps 6→9 of the pipeline puts the `bot.api.sendMessage` call AFTER the success-side bookkeeping (`respondedAt`, Pensieve persist) but BEFORE the `ritualFireEvents` insert, leaving the system in an inconsistent state on Telegram failure. The localization carry-forward (FR/RU templated fallback) is also unresolved as flagged in the task — but a worse, undocumented localization regression also exists: the EN-only `WEEKLY_REVIEW_HEADER` is prepended unconditionally on the SUCCESS path too, so a French observation gets an English header every week.

The first fire on 2026-05-10 successfully exercised the Sonnet path (per the project memory note), so the EN-only templated fallback was NOT exercised in production yet — but the EN-only D031 header WAS exercised (Critical BL-03 below).

## Critical Issues

### BL-01: Telegram send failure orphans ritual_responses + skips ritualFireEvents → silent miss + skip-tracking blind

- **File:** `src/rituals/weekly-review.ts:627-691`
- **Issue:** The orchestrator inserts `ritualResponses` (line 627), persists Pensieve entry (652), sets `respondedAt` on the response row (670), THEN calls `bot.api.sendMessage` (676), THEN inserts `ritualFireEvents` with `outcome='fired'` (681). If `sendMessage` throws (Telegram API down, rate-limited, network blip):
  - `ritual_responses` row exists with `respondedAt` set — the system thinks the user-facing flow completed
  - `pensieve_entries` has the observation (longitudinal recall sees it)
  - `ritual_fire_events` has NO row — Phase 28 SKIP-01 skip-tracking is blind to this miss
  - Greg received nothing, but `next_run_at` was already advanced by `tryFireRitualAtomic` before dispatch — ritual will NOT retry until next Sunday
- **Impact:** First-fire failure mode is a silent weekly miss with corrupt response/event asymmetry. Skip-threshold (2 consecutive 'fired' without 'responded') will not trigger because no `ritualFireEvents` row was emitted. Pensieve back-references point at a `ritual_responses.id` whose `respondedAt` is a lie (system marked complete; user never saw message).
- **Fix:** Move `bot.api.sendMessage` BEFORE `ritualResponses.set(respondedAt)` and BEFORE `ritualFireEvents.insert`. Wrap send in try/catch so failures still emit a `ritual_fire_events` row with a discriminated outcome (e.g., `'fired'` with `metadata.telegram_failed: true`, or add a new outcome variant). Don't set `respondedAt` until the send actually succeeded. Recommended ordering: INSERT ritual_responses (without respondedAt) → Pensieve persist → sendMessage → on success: UPDATE ritual_responses SET respondedAt + INSERT ritualFireEvents → on failure: INSERT ritualFireEvents with failure metadata + log.

### BL-02: `getLastUserLanguageFromDb` returns 'English' for short last messages — Phase 32 fix incomplete

- **File:** `src/rituals/weekly-review.ts:580-583` ; `src/chris/language.ts:29-47` ; `src/chris/language.ts:82-83`
- **Issue:** `fireWeeklyReview` does `const language = detectedLanguage ?? 'French';` (line 583), intending to fall back to French when the DB has no signal. But `getLastUserLanguageFromDb` only returns `null` when the conversations table has zero USER rows for the chatId (language.ts:82). When a row exists but its content is short (< 4 words OR < 15 chars), `detectLanguage(content, null)` returns `'English'` (the `previousLanguage ?? 'English'` branch on line 34) — NOT null. So if Greg's most recent USER message is e.g. `"ok merci"` (2 words, 8 chars, French semantically), the weekly review prompts Sonnet in English. This is the exact regression the Phase 32 follow-up was authored to prevent (per the JSDoc + commit 2026-05-11). The first fire 2026-05-10 happened to land on a long French message so the bug didn't manifest; the second fire (2026-05-17) could regress depending on Greg's last message length.
- **Impact:** Silent EN-language regression for any week where Greg's most recent USER message is short. The Phase 32 fix's stated goal — "prevents the production regression where Sonnet defaulted to English" — is not delivered for the short-message case. Combined with the EN-only fallback (BL-03), the user can receive an English Telegram message with English D031 header on a French chat.
- **Fix:** Either (a) thread the short-message default through: make `getLastUserLanguageFromDb` skip rows where `text.length < 15` and continue scanning, OR (b) change line 583 to detect "no signal" more robustly — e.g., have `getLastUserLanguageFromDb` accept a `defaultIfShort: string | null` parameter, OR (c) at the fireWeeklyReview site, never trust the franc result for short content and read `length < 15` from the row directly. Simplest patch: in `getLastUserLanguageFromDb`, fetch the most recent 5 USER rows and pick the first one with `content.length >= 15`; fall back to null if none qualify.

### BL-03: EN-only `WEEKLY_REVIEW_HEADER` prepended on every fire (success + fallback) — FR/RU users get English D031 marker

- **File:** `src/rituals/weekly-review.ts:68` (constant) ; `src/rituals/weekly-review.ts:621` (render site)
- **Issue:** `WEEKLY_REVIEW_HEADER = 'Observation (interpretation, not fact):'` is hardcoded English and prepended unconditionally to BOTH the success-path observation and the fallback observation: `\`${WEEKLY_REVIEW_HEADER}\n\n${result.observation}\n\n${result.question}\``. A French Greg with a working Sonnet success path receives an English header + French observation + French question. This is a worse localization regression than the templated fallback (BL/WR localization gap) because it ALWAYS fires for FR/RU users, not just on retry-cap exhaustion. **The first weekly_review fire on 2026-05-10 exercised THIS path** — Greg got the English header even though Sonnet produced French body text.
- **Impact:** D031 boundary marker — the entire purpose of which is to frame the prose as interpretation-not-fact for the reader — fails to communicate to a non-English reader. The header is the FIRST thing Greg sees on every Sunday weekly review message. Pitfall 17 mitigation degrades for non-EN users on every fire.
- **Fix:** Localize the header by `language`. Three-string map keyed on the same `language` value computed at line 583. Example:
  ```typescript
  const WEEKLY_REVIEW_HEADER: Record<string, string> = {
    English: 'Observation (interpretation, not fact):',
    French: 'Observation (interprétation, pas un fait) :',
    Russian: 'Наблюдение (интерпретация, а не факт):',
  };
  // ...
  const header = WEEKLY_REVIEW_HEADER[language] ?? WEEKLY_REVIEW_HEADER.English;
  const userFacingMessage = `${header}\n\n${result.observation}\n\n${result.question}`;
  ```
  Update WEEK-04 spec / D031 if needed to reflect that the boundary marker is per-language. Tests in `weekly-review.test.ts:121-127` ("user-facing message starts with WEEKLY_REVIEW_HEADER") must be updated to assert the language-keyed string.

## Warnings

### WR-01: FR/RU templated fallback unresolved (carry-forward) — fallback path ships EN-only

- **File:** `src/rituals/weekly-review.ts:357-360` (`TEMPLATED_FALLBACK_EN`) ; `src/rituals/weekly-review.ts:472` (return site)
- **Issue:** When retry-cap-2 is exhausted, the orchestrator returns `{...TEMPLATED_FALLBACK_EN, isFallback: true}` regardless of detected `language`. The deferral is explicitly documented in the source (lines 343-356) and called out by the task as the v2.4 carry-forward. The 2026-05-10 first fire did not exercise this path (Sonnet succeeded), but a future retry-cap exhaustion against a French/Russian conversation will deliver English text — `"Reflecting on this week. … What stood out to you about this week?"` — sandwiched between (still-EN per BL-03) header and zero French body.
- **Impact:** When the fallback fires for a non-EN user, the entire message body is English — strictly worse than BL-03 because Sonnet has been bypassed entirely. Probability is low but documented Pitfall 14/15 failure modes (adversarial weeks) make this a non-zero rate.
- **Fix:** Add a per-language `TEMPLATED_FALLBACK_FR` + `TEMPLATED_FALLBACK_RU`. Branch on `language` at line 472 in the same way BL-03's fix branches the header. Suggested copy (verify with Greg before locking): FR `{ observation: 'Réflexion sur cette semaine.', question: 'Qu\'est-ce qui t\'a marqué cette semaine ?' }`, RU `{ observation: 'Размышление об этой неделе.', question: 'Что вам запомнилось на этой неделе?' }`. NOTE: the `generateWeeklyObservation` signature accepts `WeeklyReviewPromptInput` which already carries `language` — plumbing exists, only the branch is missing.

### WR-02: Sparse-data short-circuit never emits a Telegram message but still claims `'fired'` — Greg sees nothing on no-data weeks

- **File:** `src/rituals/weekly-review.ts:551-571`
- **Issue:** When `summaries.length === 0 && resolvedDecisions.length === 0`, the orchestrator logs `'rituals.weekly.skipped.no_data'`, inserts a `ritual_fire_events` row with `metadata.reason: 'no_data_short_circuit'`, and returns `'fired'`. No Telegram message is sent and no `ritual_responses` row exists. Skip-tracking is told the fire succeeded so it does NOT count toward the 2-week skip threshold. From Greg's perspective: the weekly review went silent for a week with no signal that anything fired or why.
- **Impact:** First weeks after a quiet stretch (e.g., vacation, illness) produce zero observability for Greg + zero skip-tracking signal. The "fired" outcome here is semantically wrong — nothing was fired.
- **Fix:** Either (a) send a minimal acknowledgement message ("Quiet week — no observation this Sunday."), localized per BL-03's language detection; or (b) emit a distinct outcome like `'fired_no_data'` and document it in the type union so Phase 28 skip-tracking can choose to count or not count. The current "fired" + no-message combo is the worst-of-both-worlds default.

### WR-03: INTERROGATIVE_REGEX has a broken French alternation `qu['e]?est-ce que`

- **File:** `src/rituals/weekly-review.ts:93-94`
- **Issue:** The character class `['e]?` means "optionally one of `'` or `e`", so the regex matches `quest-ce que`, `qu'est-ce que`, AND `queest-ce que`. The intent (per the JSDoc comment on line 89) was clearly an optional apostrophe — likely written as `['']?` or `'?`. The current form also fails to match curly apostrophes (`'`) that French keyboards on macOS often produce. Worse, the regex matches `queest-ce que` (gibberish) which over-counts interrogatives in some edge inputs; AND a naturally-typed French question with curly quotes evades Stage-1 entirely.
- **Impact:** Stage-1 is the cheap defense against FR period-terminated compound questions (Pitfall 14 documented failure mode). The regex weakness reduces Stage-1's recall on real French input — Stage-2 Haiku is still the safety net, but the cost-ordering rationale (cheap Stage-1 first) is partially broken.
- **Fix:** Replace `qu['e]?est-ce que` with `qu['’e]?est-ce que` to match both straight and curly apostrophes, OR drop the `e` from the class entirely: `qu['’]?est-ce que` (no `queest-ce que` false match). Same fix for `qu['e]?est-ce qui`. Add a regression unit test using a curly-apostrophe French question.

### WR-04: `language` value is unvalidated free string flowing into prompt — prompt-injection vector via conversations.content

- **File:** `src/rituals/weekly-review.ts:580-583` ; `src/rituals/weekly-review-prompt.ts:222-227`
- **Issue:** `language` is typed `string` (not `Lang` union) and threaded into `buildLanguageDirective` which builds `"Write the entire output … in ${language}."`. `detectLanguage` always returns one of `'English' | 'French' | 'Russian'` today, but the type signature does not enforce that — a future refactor that adds raw franc codes ("eng") or a malformed DB row could inject arbitrary text into the system prompt. Defense-in-depth: this string is not adversary-controlled today (it's franc output, not raw user text), but the path from `conversations.content` to `language` is "USER message text → franc → string" and the typing makes a future regression silent.
- **Impact:** Low (franc output is safe today), but defense-in-depth for a system prompt boundary. The codebase has `langOf(raw): Lang` (language.ts:116) for exactly this narrowing.
- **Fix:** Use `langOf(detectedLanguage)` at line 583 to narrow + default in one step. Then type `language: Lang` (not `string`) on `WeeklyReviewPromptInput` (weekly-review-prompt.ts:88). The `Lang` import is already in scope in the chris/ module.

### WR-05: `respondedAt` is set even when Sonnet returned a fallback — corrupts longitudinal "did Sonnet succeed?" queries

- **File:** `src/rituals/weekly-review.ts:669-673`
- **Issue:** `respondedAt` is set unconditionally after the Pensieve write. The JSDoc (line 666-668) acknowledges this is a system-completion marker, not a Greg-replied marker — but the field is named for the user-reply semantic and is read that way elsewhere (per the comment, journal.ts uses it for Greg's STT reply via PP#5). Future analysis queries like "weekly reviews where Sonnet failed → fallback shipped" cannot distinguish fallback fires from success fires via `respondedAt`; they have to read `metadata.isFallback` instead. Worse: any future cross-handler aggregation that joins on `respondedAt IS NOT NULL` will silently include weekly review fallback rows it shouldn't.
- **Impact:** Cross-handler semantic drift on a column whose meaning is overloaded. The JSDoc admits the inconsistency.
- **Fix:** Either (a) leave `respondedAt = null` on weekly reviews and use `metadata.firedAt` / `metadata.systemCompletedAt` for the system-completion signal; or (b) add a discriminator column (`responded_by: 'user' | 'system' | null`) to ritualResponses so future queries can disambiguate. Short-term acceptable fix: name the variable differently in the metadata to make the asymmetry surveyable (`metadata.systemCompletedAt`).

### WR-06: Migration 0009 — `prompt_set_version` jsonb field references a version that has no schema-bag mapping

- **File:** `src/db/migrations/0009_weekly_review_seed.sql:54`
- **Issue:** The seed inserts `"prompt_set_version": "v1"` into `rituals.config`. The weekly_review handler does NOT read this field (the prompt is fully assembled at runtime from CONSTITUTIONAL_PREAMBLE + substrate); the migration comment on lines 19-21 even acknowledges this. The field is set to a magic string `"v1"` with no defined contract. If a future phase keys on `prompt_set_version` (e.g., for A/B prompt rotation), the weekly_review row will silently land in the wrong bucket because `"v1"` is unclaimed. Schema requires the field non-empty (`z.string().min(1)`), so it must be set to something — but choosing `"v1"` with no consumer creates a latent magic-string hazard.
- **Impact:** Low today; latent risk for future prompt-version aware handlers. Same migration pattern was used for voice_note (0007) and wellbeing (0008) — needs cross-phase coordination to fix.
- **Fix:** Document the version namespace in `types.ts` (e.g., add a comment listing which handlers use which version strings). Alternatively, set `prompt_set_version: 'weekly_review.v1'` to namespace it, but this requires Schema review across all three M009 migrations. Lowest-risk path: add a code comment in `weekly-review.ts` near the prompt assembly noting the seed's `prompt_set_version` is unused and must remain `"v1"` for back-compat.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
