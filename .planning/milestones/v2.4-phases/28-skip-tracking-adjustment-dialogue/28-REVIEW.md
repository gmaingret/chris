---
phase: 28-skip-tracking-adjustment-dialogue
reviewed_at: 2026-05-14
depth: standard + deep on adjustment-dialogue.ts
files_reviewed: 6
files_reviewed_list:
  - src/rituals/adjustment-dialogue.ts
  - src/rituals/skip-tracking.ts
  - src/rituals/scheduler.ts
  - src/rituals/types.ts
  - src/chris/engine.ts
  - src/chris/refusal.ts
blocker_count: 12
warning_count: 12
status: issues_found
---

# Phase 28: Skip-Tracking + Adjustment Dialogue — Code Review

**Reviewed:** 2026-05-14
**Depth:** standard, plus deep on `src/rituals/adjustment-dialogue.ts`
**Status:** issues_found — LIVE BUG confirmed at line 285. Three defects concatenated into a single message; multiple correctness defects beyond the headline.

## Summary

Phase 28 ships the M009 ritual-trust-loop synthesis layer. The implementation
is **mostly substrate-correct** (atomic-consume races handled, append-only
audit trail wired, predicate gate in scheduler is sound) — but the user-facing
dialogue layer is broken in three independent ways that all fire at once:

1. **Slug-as-display-name** — `ritual.name` is a DB slug like `daily_journal` /
   `weekly_review`. The cadence prefix concatenation produces
   `"daily daily_journal"` / `"weekly weekly_review"`. (BL-02)
2. **Wrongful "isn't working" assertion** in Chris's voice — uses load-bearing
   trust-language to make an unfalsified claim. (BL-01)
3. **EN-only locale leak** for FR/RU user. EVERY user-facing string in the
   module is English-only (8 distinct copy sites). (BL-03)

Beyond the live-bug surface, deeper correctness defects: the
yes/no/refusal/auto_re_enable paths do NOT reset `skip_count` to 0
(BL-06, BL-07, BL-08, WR-05), causing the dialogue to re-fire on the very
next sweep tick. The `mute_until` field is reachable by Haiku via the
whitelist (BL-11) — Greg's reply "let's mute everything" parses as
`{field: 'mute_until', new_value: <date>}` and silently disables ALL ritual
fires. Type-check between Haiku `new_value` and config field is absent
(BL-10) — a stringy `fire_at` mismatch trips `parseRitualConfig` on next
read and the ritual goes `config_invalid` forever.

---

## Blocker Issues

### BL-01: "isn't working" wrongful assertion in Chris's voice (LIVE BUG)

- **File:** `src/rituals/adjustment-dialogue.ts:285`
- **Issue:** Copy reads: `"This ${cadence} ${ritual.name} ritual isn't working — what should change?"`. This is a load-bearing factual claim from Chris that the ritual is **broken** — but the trigger is merely that Greg skipped N consecutive prompts. Greg may have been busy, traveling, depressed, or just chose not to respond. Asserting the ritual "isn't working" gaslights Greg into accepting a system narrative for his own behavior. Trust-bond invariant violated (M006 / CLAUDE.md voice rules).
- **Impact:** User-facing false claim from Chris. Already observed live 2026-05-14 17:00 Paris.
- **Fix:** Rewrite with epistemic humility. Suggested:
  ```typescript
  // EN
  `I notice we've missed the ${ritual.name} prompt a few times. Want to adjust something, or keep it as is?`
  // FR (Greg's primary locale)
  `J'ai remarqué qu'on a sauté le rituel ${displayName} plusieurs fois. Tu veux ajuster quelque chose, ou on garde comme ça ?`
  ```
  The shape moves the claim from "ritual is broken" to "I noticed a pattern" — observation, not diagnosis.

### BL-02: Slug used as display name → "daily daily_journal" doubling (LIVE BUG)

- **File:** `src/rituals/adjustment-dialogue.ts:285` (and `:308`, `:471`, `:733`)
- **Issue:** `ritual.name` is a DB slug per `src/db/migrations/0007_*.sql` (`'daily_voice_note'`, later renamed to `'daily_journal'` per migration 0011), `'daily_wellbeing'`, `'weekly_review'`. The string `${cadence} ${ritual.name}` therefore produces:
  - `daily_journal` → `"daily daily_journal"`
  - `daily_wellbeing` → `"daily daily_wellbeing"`
  - `weekly_review` → `"weekly weekly_review"`
  The cadence is **doubled** and the underscore-separated slug is leaked into the user-facing message. Same defect at line 471 (`auto_pause` message uses no display name at all but logs the slug), and line 733 (`Change ${proposedChange.field} to ${proposedChange.new_value}` leaks `fire_at` / `skip_threshold` slugs).
- **Impact:** Production message reads literally `"This daily daily_journal ritual..."`. Looks broken; reduces user trust.
- **Fix:** Add a `display_name` map (or extend `RitualConfigSchema` with a localized `display_name` field):
  ```typescript
  const RITUAL_DISPLAY_NAMES: Record<string, { en: string; fr: string; ru: string }> = {
    daily_journal: { en: 'evening journal', fr: 'journal du soir', ru: 'вечерний журнал' },
    daily_wellbeing: { en: 'wellbeing check', fr: 'check bien-être', ru: 'проверка состояния' },
    weekly_review: { en: 'weekly review', fr: 'bilan hebdo', ru: 'еженедельный обзор' },
  };
  const displayName = RITUAL_DISPLAY_NAMES[ritual.name]?.[locale] ?? ritual.name;
  // and DROP the cadence prefix — the display name already encodes it
  const messageText = `I noticed we've missed the ${displayName} ...`;
  ```
  Also note CLAUDE.md feedback: **never call the Phase 26 ritual "voice note" anywhere; codebase name is misleading** — even after migration 0011 rename to `daily_journal`, leaking the slug exposes the misnomer.

### BL-03: No FR/RU localization for any user-facing copy (locale-leak)

- **File:** `src/rituals/adjustment-dialogue.ts:151,182,285-286,471,531,547,733`
- **Issue:** Every `bot.api.sendMessage` body and the dialogue prompt itself is hard-coded English. Greg's locale is FR/RU (per project conventions and CLAUDE.md). Eight distinct copy sites are EN-only:
  - L151: `"OK, disabling this ritual..."`
  - L182: `"OK, I'll skip the adjustment dialogue for 7 days..."`
  - L285-286: the dialogue prompt itself
  - L471: `"Pausing this ritual for 30 days — feels like the timing isn't right..."`
  - L531: `"Applied: ${proposedChange.field} = ${proposedChange.new_value}"`
  - L547: `"OK, keeping current config"`
  - L733: `"Change ${proposedChange.field} to ${proposedChange.new_value} — OK?"`
- **Impact:** Chris breaks character every time the adjustment loop fires for a FR/RU-speaking Greg. CLAUDE.md says "FR/RU localization — flag every EN-only user-facing copy line".
- **Fix:** Introduce a small `i18n` lookup keyed by `config.userLanguage` (already exists elsewhere — see `src/chris/refusal.ts:180-184` `ACKNOWLEDGMENTS` map pattern). Apply to all 8 copy sites. Additionally, the Haiku prompt at L54-55 instructs the classifier in English only — Haiku may underclassify non-English replies as `evasive` (see WR-11).

### BL-04: "yes" path skips `skip_count` reset → infinite re-fire loop

- **File:** `src/rituals/adjustment-dialogue.ts:529-535` (`handleConfirmationReply` yes branch)
- **Issue:** When Greg confirms `"yes"` to a patch, `confirmConfigPatch(...)` is called — but it only does jsonb_set + ritual_config_events insert. `rituals.skip_count` is NOT reset. Per CONTEXT.md D-28-03: *"On `responded` event OR on adjustment-dialogue completion (config patch applied OR refusal accepted), reset `skip_count = 0`."* The yes branch is the completion path. Compare with `ritualConfirmationSweep` (line 690-701) which DOES emit RESPONDED + reset skipCount; the user-yes path is asymmetric.
- **Impact:** Dialogue completes successfully → patch applied → skip_count still at threshold → next sweep tick re-fires adjustment dialogue immediately. Same flow plays out, dialogue never closes.
- **Fix:**
  ```typescript
  if (isYes) {
    await confirmConfigPatch(pending.ritualId, proposedChange, 'user');
    await db.update(rituals).set({ skipCount: 0 }).where(eq(rituals.id, pending.ritualId));
    await db.insert(ritualFireEvents).values({
      ritualId: pending.ritualId,
      firedAt: new Date(),
      outcome: RITUAL_OUTCOME.RESPONDED,
      metadata: { confirmationId: pending.id, source: 'user_yes' },
    });
    // ...
  }
  ```

### BL-05: "no" path skips `skip_count` reset → infinite re-fire loop

- **File:** `src/rituals/adjustment-dialogue.ts:536-552` (`handleConfirmationReply` no branch)
- **Issue:** Same shape as BL-04. Greg replies "no" → `ritual_config_events` written with `abort` kind, but no skip_count reset and no `responded` event. Dialogue completes, but skip_count still at threshold.
- **Impact:** Next sweep re-fires the adjustment dialogue. User experience: "I literally just said no — why is Chris asking again?"
- **Fix:** Mirror BL-04 fix on the abort branch. Both completion paths are explicit user engagement and should reset.

### BL-06: Refusal paths skip `skip_count` reset → infinite re-fire loop on re-enable

- **File:** `src/rituals/adjustment-dialogue.ts:125-185` (`routeRefusal`)
- **Issue:** `routeRefusal` (hard_disable and not_now branches) updates `rituals.enabled` / `config.adjustment_mute_until` but does NOT reset `skip_count`. For the `not_now` path: when the 7-day deferral expires, `shouldFireAdjustmentDialogue` re-evaluates against the **still-at-threshold** skip_count → fires the dialogue again on the very next sweep tick. For `hard_disable`: if Greg manually re-enables, the dialogue immediately fires.
- **Impact:** "Not now" doesn't actually defer — it just delays the dialogue 7 days, then resumes the loop with no state reset. Defeats SKIP-06 self-protection.
- **Fix:** Add `skip_count = 0` reset in `routeRefusal`. Refusals ARE dialogue completion per CONTEXT.md D-28-03.

### BL-07: `mute_until` in Haiku-controllable field whitelist → user can globally mute ritual via free-form reply

- **File:** `src/rituals/adjustment-dialogue.ts:193,203` + `0010_adjustment_dialogue.sql`
- **Issue:** `proposed_change.field` enum is `['fire_at', 'fire_dow', 'skip_threshold', 'mute_until']`. `mute_until` semantically **disables ALL ritual fires** (see `scheduler.ts:144` — "config.mute_until is in the future, ritual suppressed"). The CONTEXT.md only intended `adjustment_mute_until` (dialogue-scoped) to be patchable here. Allowing Haiku to set the global `mute_until` means a user reply like "mute it for a year" parses as `{field: 'mute_until', new_value: '2027-05-14...'}` → ritual silently disabled for a year via dialogue.
- **Impact:** Privilege escalation through dialogue. CONTEXT.md T-28-E3 mitigation states "enabled excluded from field whitelist" — but `mute_until` has identical effect (suppresses ALL fires, line 144-159 scheduler). This is the same privilege via a different field name.
- **Fix:** Remove `mute_until` from both schemas (v3 + v4) at L193, L203. Replace with `adjustment_mute_until` if the dialogue-scoped mute should remain Haiku-reachable; otherwise omit entirely (the not-now path already writes `adjustment_mute_until` via `routeRefusal` without Haiku input).

### BL-08: `confirmConfigPatch` writes Haiku output to jsonb without per-field type validation → next sweep crashes ritual permanently

- **File:** `src/rituals/adjustment-dialogue.ts:568-616`
- **Issue:** Haiku's `proposed_change.new_value` is typed `z.union([z.string(), z.number(), z.null()])` — wide-open. `confirmConfigPatch` writes it raw via `jsonb_set` (L586-591). On next sweep tick, `parseRitualConfig(ritual.config)` reads the patched config against `RitualConfigSchema` (types.ts:54-85) which has narrow types per field:
  - `fire_at: z.string()` — Haiku could return `42` (number) → ZodError on next read
  - `fire_dow: z.number().int().min(1).max(7).optional()` — Haiku could return `"Monday"` → ZodError
  - `skip_threshold: z.number().int().min(1).max(10)` — Haiku could return `42` or `"forever"` → ZodError
- **Impact:** Per `scheduler.ts:284-292`, ZodError routes to `outcome: 'config_invalid'`. The ritual silently stops firing forever — and there's no admin alert. Greg ghosted by his own ritual config.
- **Fix:** Pre-validate the patched config before write. Build a candidate config in memory, apply jsonb merge, run `RitualConfigSchema.parse(candidate)`, only commit on success. Per-field type coercion may also be needed (e.g., "21:30" string vs. {hour: 21}).

### BL-09: 60s timeout = "apply" but any non-yes reply = "abort" — semantic mismatch with auto-apply contract

- **File:** `src/rituals/adjustment-dialogue.ts:514,536`
- **Issue:** The confirmation echo at L733 promises: `"OK? (auto-applies in 60s if no reply)"`. So **no reply = YES**. But `handleConfirmationReply` parses replies with `/^(yes|y|ok|confirm|apply|yeah|yep|sure|oui|da)$/i` (line 514) — any non-match (e.g., `"ok please"`, `"уверен"`, `"d'accord"`, `"!"`) routes to the **abort** branch (line 536). So a reply MORE engaged than silence triggers the OPPOSITE outcome.
- **Impact:** Greg types `"d'accord"` (FR for "agreed") — abort fires. Or types `"да"` (RU informal "yes") which IS in regex — works. But `"yes please"` — does NOT match (`$` anchor) — aborts. This is a usability landmine.
- **Fix:** Either (a) default ambiguous-reply to "apply" to match the timeout contract, or (b) loosen the regex to allow trailing context: `/^(yes|y|ok|confirm|apply|yeah|yep|sure|oui|d'accord|да|确定)/i` (drop `$`, allow prefix-match), or (c) require explicit "no" / "non" / "нет" for abort, default everything else to apply.

### BL-10: `auto_re_enable` clears `mute_until` but does NOT reset `skip_count` → dialogue re-fires on first wake-up tick

- **File:** `src/rituals/skip-tracking.ts:286-313` (`autoReEnableExpiredMutes`)
- **Issue:** When the 30-day self-protective mute expires, `autoReEnableExpiredMutes` flips `enabled=true` and clears `mute_until`. But it does NOT touch `skip_count`. The skip_count was at threshold (that's what triggered the auto_pause). So on the very next sweep tick after re-enable, `shouldFireAdjustmentDialogue` returns true → adjustment dialogue fires immediately. Greg gets back from a 30-day rest and the FIRST thing Chris does is fire the same dialogue.
- **Impact:** Defeats the whole point of the 30-day self-protective pause.
- **Fix:** Reset `skipCount: 0` in the same UPDATE at L289-295.

### BL-11: `bot.api.sendMessage` failures silently corrupt state — pending row + DB writes commit, Greg never sees the message

- **File:** `src/rituals/adjustment-dialogue.ts:149-152,180-183,292,469-472,531,547,731-734`
- **Issue:** Every `sendMessage` call is unwrapped — no try/catch. Telegram failures (network, rate-limit, 5xx) throw. In `fireAdjustmentDialogue` (L292), if send fails AFTER the comment claims it's sent-before-pending-insert ordering, it actually IS sequenced correctly (insert happens after). BUT downstream sites have the wrong order:
  - L132-152 (`routeRefusal` hard_disable): UPDATE rituals SET enabled=false runs BEFORE sendMessage at L149. If send fails, ritual is disabled but Greg has no idea.
  - L444-472 (`auto_pause` evasive branch): same — UPDATE + ritualConfigEvents fire, THEN sendMessage. Failure means ritual paused 30 days, Greg unaware.
  - L530-531: `confirmConfigPatch` (jsonb_set + audit write) runs BEFORE sendMessage. Patch applies invisibly to Greg.
  - L547: same for abort.
- **Impact:** State changes commit without user notification. Compounds with BL-04/05/06/10 (no skip_count reset) — Greg may receive a re-fire days later without knowing the prior dialogue actually completed.
- **Fix:** Wrap each sendMessage in try/catch; log structured `chris.adjustment.send_failed`; **either** rollback the prior DB write OR retry the send via outbox pattern. Mirror existing pattern: ritual fire-paths send BEFORE state writes (journal.ts:374 then L378 insert) — apply same ordering everywhere.

### BL-12: `evasive` branch writes unbounded user text into JSONB → trivial storage-DoS

- **File:** `src/rituals/adjustment-dialogue.ts:434`
- **Issue:** `metadata: { ..., greg_text: text }` — `text` is the raw Telegram message, validated only to length ≤ 100,000 chars at engine boundary (`engine.ts:172-174`). A single evasive classification stores up to 100KB in `ritual_responses.metadata.greg_text`. Repeat across N rituals × M evasive replies and the table balloons. Contrast L141 (`user_text: text.slice(0, 200)`) which DOES truncate — inconsistent.
- **Impact:** Storage growth + every JSONB select on `ritual_responses` pulls 100KB blobs. Eventually `hasReachedEvasiveTrigger` (skip-tracking.ts:213) — which scans by `metadata->>'classification'` — slows; query planner may force seq-scan.
- **Fix:** `greg_text: text.slice(0, 200)` to match the convention from L141. Or drop the field entirely (the classification + ritualId + timestamp are enough for the audit trail).

---

## Warnings

### WR-01: `cadence` ternary swallows monthly/quarterly silently

- **File:** `src/rituals/adjustment-dialogue.ts:283`
- **Issue:** `const cadence = ritual.type === 'weekly' ? 'weekly' : 'daily';` — but `ritual.type` is `'daily' | 'weekly' | 'monthly' | 'quarterly'` per types.ts. Monthly + quarterly silently fall through to `'daily'`. M013 forward-compat broken.
- **Fix:** Direct passthrough: `const cadence = ritual.type;`. Then localize via the `RITUAL_DISPLAY_NAMES` map from BL-02.

### WR-02: `HAIKU_MAX_RETRIES = 2` means 2 attempts total, not 2 retries

- **File:** `src/rituals/adjustment-dialogue.ts:51,230`
- **Issue:** `for (let attempt = 0; attempt < HAIKU_MAX_RETRIES; attempt++)` — runs attempts 0 and 1 (twice). JSDoc + log line `chris.adjustment.classify.retry` and CONTEXT.md/SUMMARY both describe "retry-cap-2" suggesting 1 + 2 = 3 attempts. Off-by-one in semantics.
- **Fix:** Rename `HAIKU_MAX_ATTEMPTS = 2` or bump to `3` if the spec intended cap=2 retries (3 total).

### WR-03: `isAdjustmentRefusal` `isHardDisable` flag misclassifies mixed input

- **File:** `src/rituals/adjustment-dialogue.ts:88-95`
- **Issue:** When `detectRefusal` hits on `"drop it"` (e.g., text = "drop it, not now please"), the code then runs `ADJUSTMENT_NOT_NOW_PATTERN.test(text)` against the full original text. If text contains BOTH "drop it" AND "not now" (e.g., user is conflicted), `isNotNow=true` → `isHardDisable=false` → treated as 7-day deferral. But the user said "drop it" → expected hard-disable.
- **Fix:** Use the `general.topic` / specific match group, not the full text. Better: check `general` match patterns directly — if the EN_PATTERNS index that hit was the "drop it" pattern (index 4), force `isHardDisable=true`. Or simpler: when general.isRefusal is true, prefer the hard-disable interpretation unless the matched pattern is the standalone "not now" one.

### WR-04: `isAdjustmentRefusal` `'topic' in general` check is dead code

- **File:** `src/rituals/adjustment-dialogue.ts:92`
- **Issue:** `const topic = 'topic' in general ? general.topic : text.trim();` — but `RefusalResult` (`src/chris/refusal.ts:3-5`) is `{ isRefusal: false } | { isRefusal: true; topic: string; originalSentence: string }`. After `if (general.isRefusal)` guard, TS narrows to the true-variant which ALWAYS has `topic`. The ternary's else-branch is unreachable.
- **Fix:** Drop the `'topic' in general` check: `const topic = general.topic;`.

### WR-05: `pending.firedAt` propagated to `ritualResponses.firedAt` could be 18h stale

- **File:** `src/rituals/adjustment-dialogue.ts:416,428`
- **Issue:** On no_change / evasive branches, the inserted `ritual_responses.firedAt = pending.firedAt` (the original dialogue fire time, up to 18h ago per RESPONSE_WINDOW_HOURS). This timestamp feeds the 14-day rolling window in `hasReachedEvasiveTrigger` (skip-tracking.ts:228). For long-delayed responses near the 14-day boundary, the count could exclude legitimate-recent evasive markers.
- **Fix:** Either consistently use `new Date()` for both firedAt+respondedAt (semantically "when did this exchange complete"), or document the firedAt-anchor invariant in CONTEXT.md.

### WR-06: No transaction around atomic-consume + downstream writes — partial failures

- **File:** `src/rituals/adjustment-dialogue.ts:348-364` (and mirrored in `handleConfirmationReply`, `ritualConfirmationSweep`)
- **Issue:** Atomic-consume succeeds → process crashes / DB connection drops → no `ritual_fire_events` written, no `skip_count` update, no audit trail. The pending row is consumed but the side effects are lost. Drizzle does NOT wrap these in a transaction.
- **Fix:** Wrap `handleAdjustmentReply`, `handleConfirmationReply`, and `ritualConfirmationSweep` body in `db.transaction(async (tx) => { ... })`. Per-row atomicity matters here since each row's downstream writes are several inserts + updates.

### WR-07: `chatId: number` downcasts BigInt — precision loss for groups

- **File:** `src/rituals/adjustment-dialogue.ts:344,491`
- **Issue:** Handler signatures take `chatId: number`. Telegram group chat IDs can be `-1000000000000` (within Number.MAX_SAFE_INTEGER but the BigInt → Number coercion in `engine.ts:205,210` via `Number(chatId)` is fragile. Not currently broken because `telegramAuthorizedUserId` is a single user, but future ops use (admin channel) would silently break.
- **Fix:** Accept `chatId: bigint` end-to-end. Convert to `number` ONLY at `bot.api.sendMessage(Number(chatId), ...)` boundary.

### WR-08: Haiku prompt is English-only — sycophancy/mis-classification risk for FR/RU replies

- **File:** `src/rituals/adjustment-dialogue.ts:54-55`
- **Issue:** `ADJUSTMENT_JUDGE_PROMPT` is English. Haiku is told to classify "the user's reply" — but a FR reply "j'ai pas envie, là, vraiment pas le moment" could be classified as `evasive` due to the EN frame, despite being a clear (refusal-adjacent) deferral. This is exactly the M006 sycophancy risk that CONTEXT.md Pitfall 17 flags. Compounds with BL-03.
- **Fix:** Either (a) instruct Haiku to operate language-agnostically with explicit FR/RU examples, or (b) detect Greg's reply language pre-Haiku and switch the system prompt. The M006 refusal pre-check (L371-375) already handles FR/RU patterns, but Haiku's residual fallthrough is monolingual.

### WR-09: Confirmation message leaks raw config field slugs

- **File:** `src/rituals/adjustment-dialogue.ts:531,547,733`
- **Issue:** `"Change ${proposedChange.field} to ${proposedChange.new_value} — OK?"` displays `fire_at`, `fire_dow`, `skip_threshold`, `mute_until` verbatim. Greg sees `"Change fire_at to 19:30 — OK?"` instead of `"Change journal fire time to 19:30 — OK?"`. Implementation jargon leaking to user.
- **Fix:** Map `proposedChange.field` to a localized human label (mirror the BL-02 fix).

### WR-10: `sql.raw` interpolation in `confirmConfigPatch` jsonb_set path

- **File:** `src/rituals/adjustment-dialogue.ts:589`
- **Issue:** `${sql.raw(\`'{${proposedChange.field}}'\`)}` injects `proposedChange.field` as raw SQL. Currently safe because the field is Zod-enum-validated (one of 4 hard-coded strings). But this is a defense-in-depth gap — if the enum is ever loosened (e.g., adding a fifth field from a config-driven list, or auto-derived from `RitualConfigSchema.keyof()`), this becomes SQL-injectable via the Haiku output. Same pattern at lines 160, 450 — though those use hard-coded strings only.
- **Fix:** Use a parameterized jsonb path. Drizzle supports `sql\`jsonb_set(${rituals.config}, ${[field]}, ...)\`` with array-typed path parameters. Or whitelist at write-time independently of the Zod schema.

### WR-11: `cadence` field exposes monthly/quarterly silently — already noted in WR-01, but also in `metadata.cadence` (L307)

- **File:** `src/rituals/adjustment-dialogue.ts:307`
- **Issue:** `metadata: { kind: 'adjustment_dialogue', cadence, ritualName: ritual.name }` — `cadence` here is the bad ternary from L283. Persisted into JSONB → downstream consumers (Phase 30 audits, reporting) see "daily" for monthly rituals.
- **Fix:** Use `ritual.type` directly here, not the ternary-derived `cadence`.

### WR-12: `confirmConfigPatch` `actor` parameter not surfaced in audit metadata for `system` actor case

- **File:** `src/rituals/adjustment-dialogue.ts:594-604`
- **Issue:** The `confirmConfigPatch` accepts `actor: 'user' | 'auto_apply_on_timeout' | 'system'` but the only `system` case is documented in `routeRefusal`'s "not_now" path (line 167 actor='adjustment_dialogue_refusal' — not 'system', so the 'system' branch is reachable only via direct external call, never from within this file). Dead-ish parameter that creates the impression of more flexibility than exists. Also `patch.source: actor === 'auto_apply_on_timeout' ? 'sweep' : 'reply'` — `'system'` branch labeled `'reply'` is misleading.
- **Fix:** Either widen `source` to `actor === 'auto_apply_on_timeout' ? 'sweep' : actor === 'system' ? 'system' : 'reply'`, or narrow the union to `'user' | 'auto_apply_on_timeout'`.

---

_Reviewed: 2026-05-14_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard + deep on adjustment-dialogue.ts_
