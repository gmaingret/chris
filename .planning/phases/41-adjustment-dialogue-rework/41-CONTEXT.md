# Phase 41: Adjustment-Dialogue Rework — Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** `--auto` (all gray areas auto-selected, recommended option chosen for every decision)

<domain>
## Phase Boundary

Eliminate the seven Phase-28-rooted defects in `src/rituals/adjustment-dialogue.ts` (+ `skip-tracking.ts`) that produced the live UX defect at 2026-05-14 17:00 Paris and the cascading every-tick re-fire after threshold:

- Replace the "isn't working" assertion with observational copy (ADJ-01)
- Map ritual slugs to localized display names so `daily daily_journal` / `fire_at` / `skip_threshold` never leak into user-facing copy (ADJ-02)
- Localize the 8 `sendMessage` sites + the Haiku judge prompt for FR/RU using Greg's detected locale (ADJ-03)
- Reset `skip_count = 0` on every yes/no/refusal completion path (ADJ-04 — P0; this is the every-tick re-fire root cause)
- Remove `mute_until` from the Haiku-controllable field whitelist — close the privilege-escalation surface (ADJ-05)
- Per-field type validation in `confirmConfigPatch` so a `{field: 'fire_at', new_value: 42}` Haiku output is rejected at the boundary instead of bricking the ritual via `parseRitualConfig` throw on the next sweep (ADJ-06)
- Ship an integration test that asserts `runRitualSweep` does NOT re-fire `shouldFireAdjustmentDialogue` for the same ritual on the next tick after any completion path (ADJ-07 — regression class around ADJ-04)

**Not in scope** (already routed to other v2.6.1 phases or backlog):
- `tryFireRitualAtomic` clock-resolution race (RACE-01 — Phase 42)
- Non-transactional paired-insert in `ritualResponseWindowSweep` (RACE-02 — Phase 42)
- The 21 EN-only sites in `/profile` (L10N-01 — Phase 46)
- `WEEKLY_REVIEW_HEADER` localization (L10N-02 — Phase 46)
- The shared locale-detection layer build-out for non-adjustment surfaces (Phase 46) — Phase 41 consumes the existing `detectLanguage` / `getLastUserLanguage*` helpers from `src/chris/language.ts` directly. The shared infra build-out is Phase 46's domain.
- Phase 28 WR-class warnings (WR-01 `cadence` monthly/quarterly silent fallthrough, WR-02 HAIKU_MAX_RETRIES off-by-one, WR-05/06/07/08/09/10/11/12) — captured in `<deferred>` for backlog; only WR-08 (Haiku judge prompt EN-only) is folded into Phase 41 because ADJ-03 explicitly names "Haiku judge prompt" in REQUIREMENTS.md.
- BL-09 (60s timeout = apply vs non-yes = abort semantic mismatch), BL-11 (unwrapped sendMessage state-order corruption), BL-12 (unbounded greg_text JSONB DoS) — deferred to v2.7 backlog; not P0, not in the 7 explicit ADJ requirements.

</domain>

<spec_lock>
## Locked Requirements (from REQUIREMENTS.md ADJ-01..07)

All seven ADJ requirements + the six success criteria in ROADMAP.md Phase 41 are **locked**. This phase implements exactly those — no additions, no substitutions. Discussion below is about HOW, not WHAT.

- ADJ-01 — Observational copy
- ADJ-02 — Display-name mapping (4 sites: 285, 308, 471, 733)
- ADJ-03 — FR/RU localization (8 sites + Haiku judge prompt)
- ADJ-04 — `skip_count = 0` reset on every completion path (P0)
- ADJ-05 — Remove `mute_until` from Haiku field whitelist
- ADJ-06 — Per-field type validation in `confirmConfigPatch`
- ADJ-07 — Integration test: no re-fire after completion

</spec_lock>

<decisions>
## Implementation Decisions

### Plan partition (D-41-01)

- **D-41-01:** **Two plans**, partitioned by user-visibility vs internal-correctness so the live-bug surface ships first:
  - **Plan 41-01 — Live-UX + skip_count reset (P0, ships first):** ADJ-01 (observational copy) + ADJ-02 (display-name map) + ADJ-04 (skip_count reset on yes/no/refusal/auto-re-enable). Goal: zero-lag user-facing visibility fix that also closes the every-tick re-fire bug observed on Greg's account.
  - **Plan 41-02 — Security + localization + test gate (closing):** ADJ-03 (FR/RU localization + Haiku prompt) + ADJ-05 (whitelist tighten) + ADJ-06 (per-field type validation) + ADJ-07 (integration test). Closes privilege escalation and ships the regression test.
- **Rationale:** Plan 41-01 needs no shared locale infrastructure (still EN-only but observational + display-name-mapped — strictly better than today). Plan 41-02 layers locale on top once 41-01 is live on Proxmox. The split lets us ship the P0 live-bug fix without waiting for the FR/RU exemplar copy review.
- **Rejected alternative:** A single monolithic plan ships all 7 ADJs together. Reason for rejection: 41-01 alone closes the actively-firing bug on Greg's account today; bundling delays user-visible improvement behind localization sign-off.

### Observational copy phrasing (ADJ-01, D-41-02)

- **D-41-02:** Canonical EN copy: `"I noticed we've missed the ${displayName} a few times. Want to adjust something, or keep it as is?"`
  - Source: Phase 28 REVIEW.md BL-01 suggested fix, EN variant.
  - "missed" is observational about a pattern; "want to adjust" preserves user agency; no diagnostic claim about the ritual.
  - **FR (Plan 41-02):** `"J'ai remarqué qu'on a sauté le rituel ${displayName} plusieurs fois. Tu veux ajuster quelque chose, ou on garde comme ça ?"` (REVIEW.md BL-01 FR variant)
  - **RU (Plan 41-02):** Translate from FR/EN by mirroring `ACKNOWLEDGMENTS` map register at `src/chris/refusal.ts:180-184`. Exemplar will be drafted in Plan 41-02 research step.
- **Coverage:** This is the **fire-side prompt only** (line 285). The seven downstream user-facing sendMessage strings (lines 149-152, 180-183, 469-472, 530-531, 547, 731-734) get parallel observational rewrites — confirmation messages and acknowledgments stay action-affirming, not diagnostic. Plan 41-02 lists each.

### Display-name mapping source of truth (ADJ-02, D-41-03)

- **D-41-03:** **Constant map** in a new `src/rituals/display-names.ts` module, keyed by ritual slug, valued by `{ en, fr, ru }`. No DB column. No DB migration.
- **Schema:**
  ```ts
  export const RITUAL_DISPLAY_NAMES: Record<string, { en: string; fr: string; ru: string }> = {
    daily_journal:   { en: 'evening journal',  fr: 'journal du soir',   ru: 'вечерний журнал' },
    daily_wellbeing: { en: 'wellbeing check',  fr: 'check bien-être',   ru: 'проверка состояния' },
    weekly_review:   { en: 'weekly review',    fr: 'bilan hebdo',       ru: 'еженедельный обзор' },
  };

  export function displayName(slug: string, locale: Lang): string {
    return RITUAL_DISPLAY_NAMES[slug]?.[locale] ?? slug;
  }
  ```
- **Rationale:** Three rituals exist (M013 will add monthly/quarterly later — they get rows here, not in DB). Storing in a TS constant matches the existing `ACKNOWLEDGMENTS` pattern at `refusal.ts:180-184` exactly. A DB column would require a migration + backfill + a Phase 33-style schema_mismatch defense — overkill for three string triplets. Hardcoding the slug fallback (`?? slug`) means an unknown ritual still produces *something* downstream, not a crash.
- **Drop the cadence prefix:** Per Phase 28 REVIEW.md BL-02 fix — the display name already encodes cadence ("evening journal" not "daily evening journal"). The `cadence` ternary at adjustment-dialogue.ts:283 is also fixed to use `ritual.type` directly when persisted to `metadata.cadence` (REVIEW.md WR-01/WR-11).
- **Also fixes the config-field slug leak at line 733:** A parallel `CONFIG_FIELD_LABELS` map (e.g., `fire_at: { en: 'fire time', fr: 'heure de déclenchement', ru: 'время срабатывания' }`) for the four allowed fields, used in `Change ${label} to ${value} — OK?` and the apply/abort echoes (lines 531, 547).

### Locale detection at the adjustment-dialogue boundary (ADJ-03, D-41-04)

- **D-41-04:** Use the **existing language helpers** from `src/chris/language.ts`:
  - At fire-side (`fireAdjustmentDialogue`): no user reply yet — read `getLastUserLanguageFromDb(chatId)` (DB-backed, falls back to detecting on most recent pensieve entry). This is the same pattern Phase 39 / `/profile` will eventually consume.
  - At reply-side (`handleAdjustmentReply` / `handleConfirmationReply`): `detectLanguage(text, previousLanguage)` on Greg's reply, then `setLastUserLanguage(chatIdStr, language)` so subsequent sendMessage calls in the same reply path use the just-detected locale.
- **Locale narrowing:** Use the existing `langOf` helper (referenced in language.ts:104-111) to narrow `string | null` to `Lang = 'en' | 'fr' | 'ru'`. Default to `'en'` on null/unknown — matches `generateRefusalAcknowledgment(language ?? 'English')` pattern at `engine.ts:360`.
- **Haiku judge prompt (ADJ-03 explicit):** Plan 41-02 rewrites `ADJUSTMENT_JUDGE_PROMPT` (line 54-55) to be language-agnostic — instructs Haiku that the reply may be in EN/FR/RU and gives one example per language for `change_requested` / `no_change` / `evasive`. Same prompt for all locales; classification semantics don't change.
- **Rejected alternative:** Build a fresh `i18n` lookup module Phase 41-scoped. Reason for rejection: Phase 46 will consolidate `qualifierFor` and ship the project-wide i18n layer (L10N-05). Phase 41 reuses the existing language helpers + inlines a small per-area string map (mirroring `ACKNOWLEDGMENTS`). Phase 46 may later promote the Phase 41 maps into a shared `src/utils/i18n.ts` — Phase 41 deliberately does NOT prebuild that layer (scope creep guard).

### skip_count reset semantics (ADJ-04, D-41-05)

- **D-41-05:** Reset `rituals.skip_count = 0` at **four distinct completion sites**, mirroring Phase 28 D-28-03's documented intent (which the implementation missed):
  1. `handleConfirmationReply` **yes branch** (line 529-535) — after `confirmConfigPatch`, before sendMessage. Also emit `ritual_fire_events` row with `outcome: RESPONDED`, `metadata.source: 'user_yes'` so `computeSkipCount` replay stays consistent (mirrors `ritualConfirmationSweep` line 690-701 pattern).
  2. `handleConfirmationReply` **no branch** (line 536-552) — after `ritualConfigEvents` abort insert. Also emit `outcome: RESPONDED`, `metadata.source: 'user_no'`.
  3. `routeRefusal` **both branches** (line 130-184) — hard_disable AND not_now both reset skip_count. (REVIEW.md BL-06: refusals ARE completion per D-28-03.)
  4. `autoReEnableExpiredMutes` in `skip-tracking.ts:286-313` (BL-10) — when 30-day mute expires, also reset skipCount in the same UPDATE.
- **Transaction wrapping:** Each reset + audit-log pair runs inside `db.transaction()` (REVIEW.md WR-06). The transaction wraps **only the skip_count reset + ritual_fire_events / ritual_config_events insert** — NOT the sendMessage. sendMessage stays outside; if it throws, the state writes have already committed (mirrors `journal.ts:374` "send-then-write" sequencing inversion documented in BL-11; full BL-11 send-order rework is deferred to v2.7).
- **Test coverage (ADJ-07):** The integration test exercises each of the four sites:
  - Fire adjustment dialogue at `skip_count = threshold` → simulate user yes-reply → assert next `runRitualSweep` tick does NOT re-fire `shouldFireAdjustmentDialogue` (assert `skip_count === 0` AND no new `ritual_fire_events` row with `outcome: 'in_dialogue'`).
  - Same for no-reply, refusal-hard-disable, refusal-not-now, auto-re-enable-after-mute-expiry.

### Haiku field whitelist (ADJ-05, D-41-06)

- **D-41-06:** Remove `'mute_until'` from BOTH zod schemas at adjustment-dialogue.ts:193 (v3) and :203 (v4). New enum: `['fire_at', 'fire_dow', 'skip_threshold']`.
- **Do NOT add `adjustment_mute_until`** to the whitelist as a replacement. Reasoning: `routeRefusal` already writes `adjustment_mute_until` via the "not_now" path WITHOUT Haiku input. There is no user-reachable case where Haiku needs to set adjustment_mute_until directly — the refusal pre-check covers it. Adding it back creates a parallel Haiku-driven path that defeats the refusal-first ordering.
- **Migration impact:** None. Whitelist is enforced at zod parse time; existing config rows with `mute_until` in jsonb are unaffected (only Haiku is blocked from setting it).
- **Side fix (REVIEW.md WR-10 defense-in-depth):** Even though `proposedChange.field` is zod-enum-narrowed before `sql.raw` at line 589, keep the parameterized-path migration deferred to Phase 42 / v2.7 backlog — Phase 41 trusts the enum tightening as sufficient protection. (Captured in `<deferred>` so it's not lost.)

### Per-field type validation in confirmConfigPatch (ADJ-06, D-41-07)

- **D-41-07:** Use the **"parse candidate config before write"** strategy (REVIEW.md BL-08 suggested fix):
  1. Read current `ritual.config` jsonb (already step 1 in confirmConfigPatch).
  2. Build candidate config in memory: `const candidate = { ...cfg, [proposedChange.field]: proposedChange.new_value }`.
  3. `RitualConfigSchema.parse(candidate)` — throws ZodError on type mismatch.
  4. On ZodError: log `chris.adjustment.config_patch.invalid_type` with `{ field, new_value, error }`, send Greg a localized error message (`"That value doesn't look like the right type for ${fieldLabel} — keeping current config."`), insert a `ritual_config_events` row with `kind: 'rejected'`, return without applying. NO crash, NO config_invalid state.
  5. On parse success: proceed to the existing `jsonb_set` UPDATE + audit insert.
- **Rationale:** This is structurally simpler than per-field type switches because `RitualConfigSchema` already encodes the contract (types.ts:54-85). Single parse covers all four fields and any future field additions automatically.
- **Per-field coercion at the Haiku boundary (out of scope for Phase 41):** Haiku might return `"21:30"` string for `fire_at` (valid) or `{hour: 21}` object (invalid). The candidate-parse strategy handles both correctly — `"21:30"` passes the `z.string()` check, `{hour: 21}` fails. No additional coercion needed; Plan 41-02 covers a one-line normalization for the common "fire_at as ISO time string" case if research surfaces a need.

### Integration test scope (ADJ-07, D-41-08)

- **D-41-08:** One Drizzle-backed integration test file: `src/rituals/__tests__/adjustment-dialogue-no-refire.test.ts`. Uses the Docker Postgres pattern (per MEMORY.md "Always run full Docker tests"). Each test case:
  1. Seeds a ritual with `skip_count = threshold` so `shouldFireAdjustmentDialogue` returns true.
  2. Fires adjustment dialogue, captures the pending row.
  3. Drives the completion path (yes / no / refusal-hard / refusal-not-now / auto-re-enable).
  4. Calls `runRitualSweep` directly and asserts NO new `ritual_fire_events` row with `outcome: 'in_dialogue'` for that ritual; asserts `skip_count === 0`; asserts `shouldFireAdjustmentDialogue(ritual)` returns false.
- **Mocking discipline:** Real Drizzle, real Postgres. Mock only the Telegram `bot.api.sendMessage` (existing pattern across rituals tests) and the Haiku `anthropic.messages.parse` (set the mock response per case to drive the classification).
- **Lives in same dir as existing rituals tests** for discoverability: `src/rituals/__tests__/`.

### Claude's Discretion

- Exact wording of the Plan-41-02 FR/RU exemplars beyond the BL-01 EN→FR seed (Plan 41-02 research step drafts them; user reviews at plan time — locale fluency check).
- Whether the `display-names.ts` module also exports a parallel `RITUAL_PROMPT_PRONOUNS` map for future per-ritual second-person grammar tweaks (Plan 41-02 research; absent today).
- Telegram error message wording on the ADJ-06 rejection path (kept short, observational).
- Whether to gate the integration test under `INTEGRATION=1` env var (per Phase 28 testing convention) — Plan 41-02 inspects the convention and matches.

</decisions>

<specifics>
## Specific Ideas

- The phrasing "I notice you've skipped the last 3 — does this ritual still serve you?" appears in REQUIREMENTS.md ADJ-01 as the example observational copy. Phase 28 REVIEW.md BL-01 proposes "I noticed we've missed the ${displayName} a few times. Want to adjust something, or keep it as is?" — Plan 41-01 chooses the BL-01 variant because: (a) "we've" affirms relational framing (M006 voice), (b) "a few times" is softer than counting, (c) "Want to adjust something, or keep it as is?" preserves user agency rather than implying disservice. The exact number ("the last 3") is omitted from the message body since it varies per ritual threshold.
- "evening journal" (not "daily journal") is the canonical EN display name — matches CLAUDE.md feedback `evening_journal_naming`: "never call the Phase 26 ritual 'voice note' anywhere; codebase name is misleading, no audio in feature." Even after the slug rename (migration 0011: voice_note → daily_journal), leaking the slug exposes the misnomer. Display name fixes this for users without a DB rename.
- The `ACKNOWLEDGMENTS` map at `src/chris/refusal.ts:180-184` is the exemplar pattern for Phase 41's display-name map and per-area locale strings.
- Phase 28 D-28-03 ALREADY DECIDED that "reset trigger: on responded event OR on adjustment-dialogue completion (config patch applied OR refusal accepted), reset skip_count = 0." Phase 41 is implementing what Phase 28 decided but the implementation missed — this is fixing a decision-implementation gap, not a new decision.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents (researcher, planner) MUST read these before planning or implementing.**

### Locked requirements (READ FIRST)
- `.planning/REQUIREMENTS.md` §ADJ — Seven ADJ requirements with exact file:line citations
- `.planning/ROADMAP.md` Phase 41 — Goal + 6 success criteria
- `.planning/milestones/v2.6.1-REVIEW-SYNTHESIS.md` §T1 — Adjustment-dialogue cluster theme

### Source of truth for the live bug
- `.planning/milestones/v2.4-phases/28-skip-tracking-adjustment-dialogue/28-REVIEW.md` — 12 BLOCKERs + 12 WARNINGs with exact line citations and suggested fixes. **Phase 41 implements the BL-01..08, BL-10 fixes; BL-09/11/12 are deferred.**
- `.planning/milestones/v2.4-phases/28-skip-tracking-adjustment-dialogue/28-CONTEXT.md` — D-28-03 (skip_count reset on completion) + D-28-05 (Haiku 3-class dialogue mechanism) + D-28-06 (60s confirmation window via `ritual_pending_responses`)
- `.planning/milestones/v2.4-phases/28-skip-tracking-adjustment-dialogue/28-PATTERNS.md` — Phase 28's curated reusable patterns
- `.planning/milestones/v2.4-phases/28-skip-tracking-adjustment-dialogue/28-RESEARCH.md` §Landmines 1, 2, 5, 6 — Discriminated patch envelope + migration 0010 dependency + ritualConfirmationSweep narrowness + PP#5 fall-through

### Project context
- `.planning/PROJECT.md` (symlink to `PLAN.md`) §Key Decisions — Three-tier LLM strategy, never-fabricate, FR/RU support
- `.planning/codebase/CONVENTIONS.md` §LLM Tier Discipline, §Logging, §Idempotency Patterns — Coding contract for Phase 41 changes
- `.planning/codebase/TESTING.md` — Docker Postgres test convention (referenced by ADJ-07)
- `CLAUDE.md` user memory:
  - `feedback_always_run_docker_tests.md` — never skip integration tests
  - `feedback_evening_journal_naming.md` — "evening journal" is canonical EN display name
  - `project_m009_first_fire_pending.md` — recent context: skip-tracking stuck rituals unstuck via catch-up after the lt→lte tryFireRitualAtomic fix

### Source files touched
- `src/rituals/adjustment-dialogue.ts` — All 7 ADJ surface (lines 54-55, 130-184, 193, 203, 283-308, 444-472, 514, 529-547, 568-616, 720-746)
- `src/rituals/skip-tracking.ts:286-313` — `autoReEnableExpiredMutes` skip_count reset (ADJ-04 site #4)
- `src/rituals/types.ts` — `RitualConfigSchema` (line 54-85) — used by ADJ-06 candidate-parse strategy; no schema change here
- `src/chris/refusal.ts:180-184` — `ACKNOWLEDGMENTS` exemplar pattern for ADJ-02/03 maps
- `src/chris/language.ts:29, 51, 66, 86, 104-111` — `detectLanguage`, `getLastUserLanguage`, `getLastUserLanguageFromDb`, `setLastUserLanguage`, `langOf` — consumed for ADJ-03
- `src/chris/engine.ts:70-71, 358-360` — Existing locale wiring exemplar (refusal acknowledgment path)
- `src/rituals/scheduler.ts:442-465` — `runRitualSweep` dispatch (verified by ADJ-07 integration test)
- `src/rituals/display-names.ts` (NEW, Plan 41-01) — Ritual + config-field display-name maps

### Adjacent v2.6.1 phases (sequencing awareness)
- `.planning/ROADMAP.md` Phase 46 — FR/RU localization comprehensive (consumes Phase 41's ADJ-03 patterns; may promote Phase 41 maps to shared i18n in Phase 46)
- `.planning/ROADMAP.md` Phase 42 — Atomicity & race fixes (RACE-01 shares same files but different lines; Phase 41 ships first per "live bug priority")

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`ACKNOWLEDGMENTS` map** (`src/chris/refusal.ts:180-184`) — Canonical `Record<Lang, string[]>` shape; Phase 41 mirrors this exactly for `RITUAL_DISPLAY_NAMES` + `CONFIG_FIELD_LABELS`.
- **`detectLanguage` / `getLastUserLanguageFromDb` / `setLastUserLanguage` / `langOf`** (`src/chris/language.ts`) — Phase 41 reuses these end-to-end; no new locale infrastructure built.
- **`computeSkipCount` + `ritual_fire_events` replay** (Phase 28 D-28-03 / Plan 28-02) — `skip_count` is denormalized projection rebuildable from `ritual_fire_events`. Phase 41's resets must emit corresponding `RESPONDED` fire-events so replay stays consistent (per D-28-03).
- **`db.transaction()` wrapping** (Drizzle-standard) — REVIEW.md WR-06 fix; Phase 41 wraps each completion-path reset + audit insert.
- **`RitualConfigSchema`** (`src/rituals/types.ts:54-85`) — Already encodes per-field types. Phase 41's ADJ-06 candidate-parse strategy reuses it directly.

### Established Patterns
- **`postgres-js String() JSON cast workaround`** (`adjustment-dialogue.ts:589` references `wellbeing.ts:148-150` JSDoc) — Used in `jsonb_set` to defeat postgres-js auto-stringification. Phase 41 changes do NOT alter this pattern.
- **Atomic-consume race-safety** (`adjustment-dialogue.ts:495-510`) — Phase 41 leaves this intact; only the post-consume branches change.
- **Discriminated patch envelope** (RESEARCH Landmine 1) — Phase 41's new `kind: 'rejected'` audit row (ADJ-06) fits this envelope shape: `{kind, field, attempted_new_value, error, source}`.
- **send-before-write at fire-side** (`journal.ts:340` → `adjustment-dialogue.ts:292`) — Phase 41's new completion-path resets invert this (state-then-send) inside a transaction; the inversion was already documented as a BL-11 issue but full rework is deferred. Phase 41 accepts the existing pattern.

### Integration Points
- **`runRitualSweep` dispatch in scheduler.ts:442-465** — Phase 41's ADJ-07 test calls this directly; phase does NOT modify the dispatch logic, only verifies it.
- **`engine.ts` PP#5 routing** — `pending.metadata.kind === 'adjustment_dialogue'` → `handleAdjustmentReply`; `=== 'adjustment_confirmation'` → `handleConfirmationReply`. Phase 41 changes the handler bodies, not the routing.
- **Telegram `bot.api.sendMessage`** — The only Telegram side-effect surface. Phase 41 wraps each call with the new locale + display-name substitutions; does NOT add try/catch (BL-11 deferred).
- **`cron-registration.ts`** — `ritualConfirmationSweep` registered with `'* * * * *'`; Phase 41 does NOT touch cron wiring.

</code_context>

<folded_todos>
## Folded Todos

No pending project-level todos matched Phase 41's scope above the 0.4 relevance threshold. The seven ADJ requirements are themselves the operative todo list, sourced from REQUIREMENTS.md and the Phase 28 REVIEW.md BL-01..08 + BL-10 set.

</folded_todos>

<deferred>
## Deferred Ideas

Captured from Phase 28 REVIEW.md but explicitly NOT in Phase 41 scope:

- **BL-09 (semantic mismatch on confirmation timeout):** 60s timeout = "apply" per the user-facing copy, but any non-yes reply = "abort". `"d'accord"` (FR yes) currently triggers abort. **Routed to:** v2.7 backlog — usability landmine, not a correctness bug. Plan 41-02 may revisit IF locale work surfaces a clean fix; otherwise deferred.
- **BL-11 (unwrapped sendMessage state-order corruption):** sendMessage failures silently corrupt state (UPDATE commits before send). **Routed to:** v2.7 backlog — separate "outbox pattern" rework spanning all ritual handlers.
- **BL-12 (unbounded greg_text JSONB DoS):** Storage growth via 100KB unbounded text in `ritual_responses.metadata.greg_text`. **Routed to:** v2.7 backlog — defense-in-depth, no active exploit.
- **WR-01 / WR-11 (cadence monthly/quarterly silent fallthrough):** `const cadence = ritual.type === 'weekly' ? 'weekly' : 'daily'` swallows M013 cadences. **Folded into Phase 41 incidentally:** Plan 41-01's display-name map drops the cadence prefix entirely (display name encodes cadence), and `metadata.cadence` uses `ritual.type` directly. The forward-compat issue is resolved as a side-effect of the display-name fix.
- **WR-02 (HAIKU_MAX_RETRIES off-by-one):** Loop runs 2 attempts but spec says "retry-cap-2" (3 total). **Routed to:** v2.7 backlog — semantic clarification, not a correctness bug.
- **WR-03 (`isAdjustmentRefusal` `isHardDisable` misclassifies mixed input):** "drop it, not now please" → both flags hit, defaults to `not_now`. **Routed to:** v2.7 backlog — edge case, no live observation.
- **WR-04 (dead `'topic' in general` check):** TS narrowing makes the else branch unreachable. **Routed to:** v2.7 backlog (cleanup, no behavior impact).
- **WR-05 (`pending.firedAt` propagated stale 18h):** Used as anchor in 14-day evasive trigger window. **Routed to:** v2.7 backlog — semantic ambiguity, low practical impact.
- **WR-06 (no transaction around atomic-consume + downstream writes):** **PARTIALLY folded into Phase 41:** Plan 41-01 wraps each completion-path reset + audit insert in `db.transaction()` (per D-41-05 above). The broader sweep-handler transaction wrapping is deferred to Phase 42 (matches RACE theme).
- **WR-07 (`chatId: number` downcasts BigInt):** Future ops break. **Routed to:** v2.7 backlog.
- **WR-09 (confirmation message slug leak — `Change fire_at to 19:30 — OK?`):** **Folded into Phase 41:** Plan 41-01 fixes this via the `CONFIG_FIELD_LABELS` map (D-41-03).
- **WR-10 (`sql.raw` in `confirmConfigPatch` jsonb_set defense-in-depth):** Currently safe via zod enum. **Routed to:** v2.7 backlog — parameterized jsonb path migration.
- **WR-12 (`confirmConfigPatch` `actor: 'system'` dead branch):** Misleading source label. **Routed to:** v2.7 backlog — narrow the union or surface in audit metadata.
- **`WEEKLY_REVIEW_HEADER` localization (L10N-02), Daily journal PROMPTS localization (L10N-04), `/profile` 21 EN sites (L10N-01), FR regex curly-apostrophe fix (L10N-03):** All explicitly **Phase 46** scope.
- **`tryFireRitualAtomic` clock-resolution race + non-transactional paired-insert + wellbeing rapid-tap race + DST-edge wellbeing match + weekly-review write-order race:** All explicitly **Phase 42** scope.

</deferred>

---

## Auto-Mode Decision Log

`[--auto] Selected all gray areas: Plan partition, Observational copy phrasing, Display-name mapping source, Locale detection boundary, skip_count reset sites, Haiku field whitelist, Per-field type validation strategy, Integration test scope.`

`[auto] Plan partition — Q: "One plan or two?" → Selected: "Two plans, P0 user-facing fixes ship first" (recommended default; matches v2.6.1's live-bug priority framing in ROADMAP.md)`
`[auto] Observational copy — Q: "Adopt REQUIREMENTS.md exemplar or REVIEW.md BL-01 variant?" → Selected: "BL-01 variant" (recommended default; more specific, matches M006 relational voice)`
`[auto] Display-name source — Q: "DB column, TS constant map, or both?" → Selected: "TS constant map" (recommended default; matches ACKNOWLEDGMENTS exemplar, no migration overhead)`
`[auto] Locale detection — Q: "Reuse src/chris/language.ts helpers or build new layer in Phase 41?" → Selected: "Reuse existing helpers" (recommended default; Phase 46 owns shared i18n infra)`
`[auto] skip_count reset count — Q: "How many distinct sites?" → Selected: "Four: yes, no, refusal (both branches), auto-re-enable" (recommended default; matches REVIEW.md BL-04/05/06/10 cluster)`
`[auto] mute_until whitelist — Q: "Remove entirely, replace with adjustment_mute_until, or per-actor gating?" → Selected: "Remove entirely" (recommended default; refusal pre-check already covers adjustment_mute_until via not_now path)`
`[auto] Per-field validation strategy — Q: "Per-field switch or candidate-config parse?" → Selected: "Candidate-config parse" (recommended default; RitualConfigSchema is the existing contract)`
`[auto] Integration test placement — Q: "New file or extend existing test?" → Selected: "New file: adjustment-dialogue-no-refire.test.ts in src/rituals/__tests__/" (recommended default; scope-focused, discoverable)`

---

*Phase: 41-adjustment-dialogue-rework*
*Context gathered: 2026-05-14*
*Mode: --auto (single-pass; no commit, no STATE.md update, no auto-advance per parent orchestration constraints)*
