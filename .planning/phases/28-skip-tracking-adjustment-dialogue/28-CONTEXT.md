# Phase 28: Skip-Tracking + Adjustment Dialogue — Context

**Gathered:** 2026-04-29
**Status:** Ready for planning
**Mode:** `--auto` (recommended defaults auto-selected for each gray area)

<domain>
## Phase Boundary

Phase 28 is the **synthesis layer** that closes the M009 ritual-trust loop. After Phase 28 ships, when Greg consistently misses a ritual (3 consecutive `fired_no_response` outcomes on a daily ritual; 2 on a weekly), Chris fires a single adjustment dialogue message ("this ritual isn't working — what should change?"), Haiku parses the reply into one of 3 classes (`change_requested` / `no_change` / `evasive`), proposes a config patch on `change_requested`, waits 60 seconds for "yes/no" confirmation, then applies. The system self-protects against becoming the new nag via a 30-day pause after 2 evasive responses within 14 days. M006 refusal handling (Greg saying "drop it / disable / not now") routes to the refusal path inside the dialogue, NOT counted as evasive. All configuration mutations are append-only audited in `ritual_config_events`.

**In scope (7 requirements):**
- SKIP-01 — Discriminated `RitualFireOutcome` union extension: add `responded`, `window_missed`, `fired_no_response`. Only `fired_no_response` increments `skip_count`. `system_suppressed` (Phase 26) and `wellbeing_skipped` (Phase 27) do NOT count.
- SKIP-02 — Append-only `ritual_fire_events` writes from each ritual handler; `rituals.skip_count` is denormalized projection rebuildable by replay (D004 spirit; M007 `decision_events` precedent).
- SKIP-03 — Cadence-aware skip thresholds: daily=3, weekly=2. Per-cadence default at row creation; configurable per-ritual via `rituals.config.skip_threshold` (already in `RitualConfigSchema`).
- SKIP-04 — Adjustment dialogue: Telegram message + Haiku 3-class Zod parse (`change_requested` / `no_change` / `evasive`).
- SKIP-05 — 60s confirmation window for `change_requested` route; auto-apply on "yes" or no-reply; abort on explicit "no" with `ritual_config_events` log.
- SKIP-06 — Self-protective 30-day pause after 2 evasive responses within 14 days; auto-re-enable when `mute_until` expires.
- SKIP-07 — Append-only `ritual_config_events` audit trail; M006 refusal handling honored INSIDE dialogue.

**Out of scope (deferred to Phase 30 or later milestones):**
- 14-day synthetic fixture E2E coverage of skip-tracking flows — Phase 30 TEST-23..30
- Live anti-flattery test for adjustment dialogue Sonnet/Haiku output — could be added to Phase 30 TEST-31 scope as adversarial extension; deferred unless gaps surface
- Monthly / quarterly cadence skip thresholds (M013+ — `RitualConfigSchema.skip_threshold` already supports any int 1-10)
- Multi-message / multi-turn adjustment dialogue (single-turn structured Haiku per spec — D-28-05)

</domain>

<decisions>
## Implementation Decisions

### Plan split structure (D-28-01)

**D-28-01:** **4 plans** for Phase 28, partitioned by surface cleavage and risk profile. Total estimated LoC ~600.

- **Plan 28-01 — Outcome union + ritual_fire_events writes (substrate):** Extend `RitualFireOutcome` in `src/rituals/types.ts` with `responded`, `window_missed`, `fired_no_response`. Wire each ritual handler (`fireVoiceNote`, `fireWellbeing`, `fireWeeklyReview`) to write to `ritual_fire_events` table on every fire attempt with the corresponding outcome. Add a `ritual_response_window_sweep` helper that runs in `runRitualSweep` to detect expired `ritual_pending_responses` rows and emit `window_missed` / `fired_no_response` events. Reqs: SKIP-01, SKIP-02. ~150 LoC.
- **Plan 28-02 — Cadence-aware threshold + skip_count projection (synthesis):** `rituals.skip_count` is rebuilt from `ritual_fire_events` by replay (incremented on each `fired_no_response`, reset on `responded` OR adjustment-dialogue completion). Add `computeSkipCount(ritualId)` helper. Cadence-aware threshold check: daily=3, weekly=2 default; per-ritual override via `rituals.config.skip_threshold`. Add `shouldFireAdjustmentDialogue(ritual)` predicate called in `runRitualSweep` BEFORE the standard handler dispatch. Reqs: SKIP-03. ~120 LoC.
- **Plan 28-03 — Adjustment dialogue + confirmation window (HIGH-LLM-surface):** NEW `src/rituals/adjustment-dialogue.ts` module exporting `fireAdjustmentDialogue(ritual)` + `handleAdjustmentReply(reply, dialogueState)` + `confirmConfigPatch(patch, ritualId)`. Adjustment dialogue is a ritual_pending_response (mirrors voice note wait pattern). PP#5 in `processMessage` is extended to detect adjustment-dialogue responses by `metadata.kind = 'adjustment_dialogue'`. Haiku call with strict Zod parse `{ classification, proposed_change?, confidence }`. 60s confirmation window via deferred-fire mechanism (write `adjustment_pending_confirmations` row with `expires_at = now() + 60s`; ritual sweep tick auto-applies on expiry if no reply). Reqs: SKIP-04, SKIP-05. ~250 LoC. **Highest LLM-surface plan in Phase 28** — Pitfall 14 single-question enforcement does NOT apply (3-class structured output, not free-form), but Pitfall 17 sycophancy risk applies (Sonnet/Haiku could mis-classify "drop it" as evasive); mitigation: M006 refusal pre-check BEFORE Haiku call (Plan 28-04).
- **Plan 28-04 — Self-protective pause + audit trail + M006 refusal (closing):** Track evasive timestamps via `ritual_responses` rows with `metadata.kind = 'adjustment_dialogue_response'` and `metadata.classification = 'evasive'`. Predicate `hasReachedEvasiveTrigger(ritualId)` queries last 14 days; on hit: set `rituals.enabled = false` + `rituals.config.mute_until = now() + 30 days`. Auto-re-enable in `runRitualSweep` when `mute_until` expires. M006 refusal pre-check in `handleAdjustmentReply`: if message text matches refusal patterns (`drop it`, `disable`, `not now` per `src/chris/refusal.ts` existing detector), route to refusal path BEFORE Haiku classification. Refusals NEVER count as evasive. Every config mutation writes to `ritual_config_events` (Phase 25 0006 already shipped the table). Reqs: SKIP-06, SKIP-07. ~80 LoC + integration tests.

**Wave assignment:**
- Wave 1: Plan 28-01 (substrate; no deps)
- Wave 2: Plan 28-02 (depends on 28-01 — needs `fired_no_response` outcome)
- Wave 3: Plan 28-03 (depends on 28-02 — needs `shouldFireAdjustmentDialogue` predicate)
- Wave 4: Plan 28-04 (depends on 28-03 — needs `handleAdjustmentReply` to extend with refusal pre-check)

Sequential execute is the safe path — Plans 28-03 and 28-04 share `src/rituals/adjustment-dialogue.ts` (28-04 extends what 28-03 creates).

### RitualFireOutcome union expansion (D-28-02)

**D-28-02:** Append three new variants to `RitualFireOutcome` in `src/rituals/types.ts`:

- `'responded'` — Greg replied within the response window. Resets skip_count.
- `'window_missed'` — Response window expired without reply on a ritual that DOES have one (voice note, wellbeing). Distinct from `'fired_no_response'` because Phase 28 may need to emit BOTH for an unresponded fire (window_missed = the fact, fired_no_response = the policy classification). Initial implementation may collapse to a single emit.
- `'fired_no_response'` — THE skip-counting outcome. Emitted by `ritual_response_window_sweep` when a `ritual_pending_responses` row's `expires_at` passes with `consumed_at IS NULL`.

**Final union (10 variants):** `fired` | `caught_up` | `muted` | `race_lost` | `in_dialogue` | `config_invalid` | `system_suppressed` | `wellbeing_skipped` | `responded` | `window_missed` | `fired_no_response`. The wellbeing_skipped variant from Phase 27 is preserved (it represents an explicit user choice — distinct from skip).

**Skip-counting rules (SKIP-01):**
- INCREMENTS skip_count: `fired_no_response` ONLY
- DOES NOT increment: `system_suppressed`, `wellbeing_skipped`, `window_missed` alone (without policy classification), `responded`, `caught_up`, `muted`, `race_lost`, `in_dialogue`, `config_invalid`, `fired`

### Skip-count is denormalized; rebuilable by replay (D-28-03)

**D-28-03:** `rituals.skip_count` is a **denormalized projection**, not authoritative. The authoritative source is `ritual_fire_events`. Mirrors M007 `decision_events` precedent (D004 spirit).

- **Increment trigger:** Each new `fired_no_response` event triggers `UPDATE rituals SET skip_count = skip_count + 1 WHERE id = $rid`. Idempotent because each event has its own row; replaying events from scratch reproduces the count.
- **Reset trigger:** On `responded` event OR on adjustment-dialogue completion (config patch applied OR refusal accepted), reset `skip_count = 0`. Reset is a separate `UPDATE`.
- **Rebuild helper:** `computeSkipCount(ritualId)` queries `ritual_fire_events` from the most recent reset event (or ritual creation) and counts `fired_no_response` outcomes since. Useful for audits / disaster recovery / Phase 30 TEST-23..30 fixture rebuilds.
- **Tradeoff accepted:** The denormalized count can drift if writes are non-atomic. Mitigation: increment + skip_count update happen in the SAME transaction as the `ritual_fire_events` insert.

### Cadence-aware thresholds (D-28-04)

**D-28-04:** **Daily=3, Weekly=2.** Set at row creation per cadence type. Per-ritual override via `rituals.config.skip_threshold` (already in RitualConfig schema, already validated 1-10).

- **"Consecutive" interpretation:** Counted in time-order from the most recent reset event (responded OR dialogue completion). An intermediate `responded` resets the count to 0; subsequent `fired_no_response` events restart counting.
- **Default-by-cadence at seed time:** Phase 26 seed migration 0007 should have `skip_threshold: 3` for daily_voice_note. Phase 27 seed migration 0008 should have `skip_threshold: 3` for daily_wellbeing. Phase 29 seed migration 0009 should have `skip_threshold: 2` for weekly_review. **Plan 28-02 includes a verification task that audits each seed row's skip_threshold matches the cadence default; if any are wrong (probably are — Phase 26-29 seed migrations were authored before Phase 28 locked the cadence defaults), Plan 28-02 emits a one-line UPDATE migration 0010 to correct them.**
- **Forward-compat:** Monthly=2 / quarterly=1 defaults documented for M013, but not enforced in Phase 28 (no monthly/quarterly rituals exist).

### Adjustment dialogue mechanism (D-28-05)

**D-28-05:** Single-turn Haiku-classified dialogue. Adjustment dialogue is itself a `ritual_pending_response` row — mirrors voice note's wait pattern.

- **Trigger:** `shouldFireAdjustmentDialogue(ritual)` returns true when `ritual.skip_count >= effective_threshold`. Predicate runs in `runRitualSweep` BEFORE the standard handler dispatch; if true, fire adjustment dialogue INSTEAD of the standard prompt.
- **Telegram message shape:** "This [daily/weekly] [ritual.name] ritual isn't working — what should change? (Reply with what to change, or 'no change' / 'drop it' if you'd prefer to keep skipping or stop entirely.)" The "drop it" hint primes M006 refusal detection; the explicit "no change" affords a quick neutral path.
- **Haiku call:** `messages.parse` + `zodOutputFormat` with strict 3-class Zod schema:
  ```typescript
  z.object({
    classification: z.enum(['change_requested', 'no_change', 'evasive']),
    proposed_change: z.object({
      field: z.enum(['fire_at', 'fire_dow', 'skip_threshold', 'mute_until']),
      new_value: z.union([z.string(), z.number(), z.null()]),
    }).nullable(),
    confidence: z.number().min(0).max(1),
  }).strict();
  ```
- **PP#5 extension:** PP#5 in `src/chris/engine.ts` checks for `metadata.kind = 'adjustment_dialogue'` on the active pending response; on hit, routes to `handleAdjustmentReply` instead of the voice-note deposit handler. The PP#5 short-circuit (zero LLM call from the engine) is preserved.
- **Anti-pattern AVOIDED:** Multi-turn conversation with `@grammyjs/conversations` (OOS-11). Single-turn structured Haiku is sufficient.

### 60-second confirmation window (D-28-06)

**D-28-06:** Use a **deferred-fire mechanism** via `ritual_pending_responses` extension, NOT a JS `setTimeout` (which doesn't survive container restart).

- **Mechanism:** When Haiku returns `change_requested` with a `proposed_change`, Chris echoes "change voice note fire to 19:30 — OK? (auto-applies in 60s if no reply)" and writes a new `ritual_pending_responses` row with `metadata.kind = 'adjustment_confirmation'`, `metadata.proposed_change = {...}`, `expires_at = now() + 60s`. The `runRitualSweep` tick (10:00 + 21:00 Paris) is too coarse for 60s — Plan 28-03 adds a NEW lightweight tick OR shortens the existing accountability sweep cadence to catch confirmations.
- **Decision (locked):** Add a NEW `ritual_confirmation_sweep` helper that runs ONLY when there's at least one `ritual_pending_responses` row with `metadata.kind = 'adjustment_confirmation'` AND `expires_at <= now()`. Triggered from a 1-minute lightweight cron tick (cheaper than running full `runRitualSweep` every minute). Cron expression: `* * * * *` (every minute) but the handler is a no-op if no expired confirmations exist.
- **Greg-replies-yes:** PP#5 detects `kind = 'adjustment_confirmation'` reply, parses yes/no, applies patch (or aborts) within the engine's normal message handling. No deferred-fire dependency.
- **Greg-replies-no:** Abort. Log `chris.adjustment.aborted` event; write to `ritual_config_events` with `change_kind = 'patch_aborted'`.
- **Greg doesn't reply within 60s:** Confirmation sweep tick detects expiry, applies patch, writes `ritual_config_events` with `source = 'auto_apply_on_timeout'`.
- **Tradeoff accepted:** A 1-minute cron tick is more aggressive than M009's existing 10:00 + 21:00 ticks, but it's necessary for the 60s window. Cost is minimal — cron handler is a SQL `SELECT` against the partial index `ritual_pending_responses_chat_id_active_idx`; if no expired confirmations, returns immediately.

### Self-protective 30-day pause (D-28-07)

**D-28-07:** After 2 evasive responses within a 14-day rolling window on the same ritual, ritual auto-pauses for 30 days.

- **Detection:** `hasReachedEvasiveTrigger(ritualId)` queries `ritual_responses` for rows with `metadata.kind = 'adjustment_dialogue_response'` AND `metadata.classification = 'evasive'` AND `created_at >= now() - interval '14 days'`. If count >= 2: trigger pause.
- **Pause action:** `UPDATE rituals SET enabled = false, config = jsonb_set(config, '{mute_until}', to_jsonb(now() + interval '30 days'))`. Two atomic operations: enabled flag + mute_until config field.
- **Auto-re-enable:** `runRitualSweep` checks at the top of each tick: `SELECT id FROM rituals WHERE enabled = false AND (config->>'mute_until')::timestamptz <= now()`. For each: `UPDATE rituals SET enabled = true, config = jsonb_set(config, '{mute_until}', 'null'::jsonb)`. Writes `ritual_config_events` with `change_kind = 'auto_unpause'`.
- **Why 30 days:** Spec interpretation. Long enough that Greg notices the absence and can manually re-engage; short enough that the ritual returns automatically.
- **Manual override:** Greg can manually re-enable at any time (no Chris-side block) — the auto-re-enable cron just provides the automatic path.

### M006 refusal handling inside dialogue (D-28-08)

**D-28-08:** **Pre-check refusal patterns BEFORE the Haiku classification call.** Reuse existing M006 refusal detector from `src/chris/refusal.ts` (or wherever the canonical detector lives — planner verifies during research).

- **Detection patterns (M006 existing):** `drop it`, `disable`, `not now`, `stop`, `pause`, `disable [ritual name]`, etc. Detector uses regex + lemmatization (or existing M006 mechanism — planner reads).
- **Routing:**
  - "drop it" / "disable" → `UPDATE rituals SET enabled = false` (paused indefinitely, no auto-re-enable; Greg must manually re-enable). Write `ritual_config_events` with `change_kind = 'manual_disable'` and `source = 'adjustment_dialogue_refusal'`.
  - "not now" → defer adjustment dialogue for 7 days. Set `rituals.config.adjustment_mute_until = now() + 7 days` (extend RitualConfigSchema with this optional field). Sweep predicate `shouldFireAdjustmentDialogue` honors the mute. Skip-counting continues; the dialogue just won't fire for 7 days.
- **Refusals do NOT count as evasive.** This is the load-bearing invariant for SKIP-06's self-protection: a Greg who refuses politely shouldn't get auto-paused for 30 days.
- **Acceptance criterion:** Verifiable by inserting two synthetic "drop it" responses 7 days apart; confirm `enabled = false` after the FIRST one (immediate disable), NOT after the second one (the evasive-trigger doesn't fire because both were classified as refusals, not evasive).

### `ritual_config_events` audit writes (D-28-09)

**D-28-09:** Every config mutation writes a row to `ritual_config_events` (table already shipped in Phase 25 migration 0006).

- **Write triggers:** auto-apply on `change_requested` confirmation (60s timeout OR explicit yes), abort on explicit no, M006 refusal disable, "not now" 7-day mute, evasive auto-pause (30-day), auto-re-enable from mute_until expiry.
- **Schema (existing in 0006):** `id, ritual_id, change_kind, old_value, new_value, source, source_metadata jsonb, created_at`. Plan 28-04 doesn't modify the schema; it just writes to it.
- **`change_kind` enum values used by Phase 28:** `skip_threshold_change`, `fire_at_change`, `fire_dow_change`, `mute_until_change`, `manual_disable`, `auto_pause`, `auto_unpause`, `patch_aborted`, `auto_apply_on_timeout`. Phase 28 documents these but doesn't add a DB constraint — the column is `text` per Phase 25's migration. Future phases can audit usage.

### Claude's Discretion

- **Naming details** — exact file names within `src/rituals/` (`adjustment-dialogue.ts` is the obvious choice), exact env-var names if any, exact log-event names (`chris.adjustment.fired`, `chris.adjustment.classified`, `chris.adjustment.applied`, `chris.adjustment.aborted`, `chris.adjustment.refused`). Planner picks.
- **PP#5 extension shape** — whether to extend the existing PP#5 detector with a `kind` switch (handler dispatches by `metadata.kind`), OR add a peer pre-processor PP#6 specifically for adjustment-dialogue replies. Recommendation: extend PP#5 (single chokepoint). Planner verifies during research.
- **Confirmation sweep cron** — every-minute (`* * * * *`) is the locked spec. Whether to also gate it on env (e.g., `ADJUSTMENT_SWEEP_ENABLED=true` to allow disabling in test), and exact log-event name.
- **`adjustment_mute_until` schema extension** — whether to add to RitualConfigSchema as an optional 9th field, or store separately. Recommendation: extend RitualConfigSchema (mirror existing pattern; bump `schema_version: z.literal(2)` and ship a one-line migration if needed). Planner verifies if schema_version bump requires a separate migration.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + requirements
- `.planning/ROADMAP.md` §Phase 28 — Goal, requirements list, 4 success criteria. **Authoritative scope.**
- `.planning/REQUIREMENTS.md` — SKIP-01..07 verbatim.
- `.planning/STATE.md` — Spec interpretation #3 (cadence-aware threshold daily=3 weekly=2); D026 separation; D004 append-only Pensieve.

### Milestone-level research (foundational)
- `.planning/research/SUMMARY.md` — TS-8..TS-8g skip-tracking features; Pitfall 17 sycophancy applies to adjustment dialogue Sonnet output.
- `.planning/research/PITFALLS.md` — Pitfall 17 (sycophancy HIGH); Pitfall 14 N/A here (single-question enforcement is for free-form Sonnet output, not 3-class Haiku).

### Phase 25/26/27/29 dependencies
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-CONTEXT.md` — D-04 ritualCount channel-cap = 3/day; D-09 computeNextRunAt 3-arg signature.
- `.planning/phases/26-daily-voice-note-ritual/26-CONTEXT.md` — D-26-02 PP#5 placement at engine position 0; D-26-06 'system_suppressed' literal in RitualFireOutcome (Plan 28-01 extends this union).
- `.planning/phases/27-daily-wellbeing-snapshot/27-CONTEXT.md` — D-27 wellbeing_skipped outcome (does NOT count as fired_no_response per SKIP-01).
- `.planning/phases/29-weekly-review/29-CONTEXT.md` — D-08 dispatchRitualHandler keys on ritual.name; cadence weekly threshold=2.
- `.planning/phases/26-daily-voice-note-ritual/26-02-SUMMARY.md` — PP#5 implementation pattern (mirror for adjustment-dialogue PP#5 extension).

### Codebase intel (subset relevant to Phase 28)
- `.planning/codebase/CONVENTIONS.md` — TS strict ESM, .js suffix, kebab-case, SCREAMING_SNAKE_CASE.
- `.planning/codebase/ARCHITECTURE.md` — engine.ts processMessage shape; cron registration pattern; `runRitualSweep` extension point.

### Source files Phase 28 reads or modifies (full paths)
- `src/rituals/types.ts` — `RitualFireOutcome` union extension (10 variants final per D-28-02); `RitualConfigSchema` extension if `adjustment_mute_until` added.
- `src/rituals/scheduler.ts` — `runRitualSweep` extension: add `ritual_response_window_sweep` helper (Plan 28-01); add `shouldFireAdjustmentDialogue` predicate dispatch (Plan 28-02).
- `src/rituals/voice-note.ts`, `src/rituals/wellbeing.ts`, `src/rituals/weekly-review.ts` — Add `ritual_fire_events` write per fire attempt (Plan 28-01).
- `src/rituals/adjustment-dialogue.ts` — NEW (Plan 28-03 + 28-04).
- `src/chris/engine.ts` — PP#5 extension to detect `kind = 'adjustment_dialogue'` and `kind = 'adjustment_confirmation'` (Plans 28-03 + 28-04).
- `src/chris/refusal.ts` — read-only; reused for M006 refusal detection in adjustment dialogue (D-28-08).
- `src/cron-registration.ts` — add 1-minute confirmation sweep cron (Plan 28-03).
- `src/db/schema.ts` — `ritual_responses.metadata` and `ritual_pending_responses.metadata` (jsonb) — store dialogue-state metadata. NO new columns or tables; everything fits in existing jsonb.
- `src/db/migrations/0010_*.sql` — IF needed: skip_threshold seed correction OR `RitualConfigSchema.schema_version: 2` migration. Planner verifies necessity.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/chris/refusal.ts` M006 refusal detector** — Plan 28-04 reuses verbatim for adjustment dialogue M006 refusal pre-check (D-28-08). Don't reinvent.
- **PP#5 in `src/chris/engine.ts:167-208` (Phase 26)** — Pattern to extend for adjustment-dialogue replies. The atomic-consume + return-empty-string semantics work identically for adjustment replies.
- **`storePensieveEntry` with `epistemicTag` parameter (Phase 26 D-26-03)** — Reused by Plan 28-03 for persisting adjustment-dialogue context if needed (probably NOT — adjustment replies are operational, not memorial).
- **`ritual_pending_responses` table + partial index** (Phase 26 migration 0007) — Reused for adjustment-dialogue state. The `metadata` jsonb column holds `kind: 'adjustment_dialogue' | 'adjustment_confirmation'` and `proposed_change: {...}` payload.
- **`ritual_responses.metadata` jsonb (Phase 25 0006)** — Append-only event log; Plan 28-04 writes evasive-classification rows here.
- **`ritual_config_events` table (Phase 25 0006)** — Append-only audit; already shipped, just needs writes.
- **`registerCrons(deps)` helper (Phase 25 D-06)** — Plan 28-03 adds the 1-minute confirmation sweep registration here.
- **`messages.parse` + `zodOutputFormat` Haiku pattern** — Used heavily in Phase 29 weekly review; Plan 28-03 mirrors for the 3-class classifier.

### Established Patterns
- **PP#5 dispatch by `metadata.kind`** — extend the existing detector to handle multiple `kind` values; single chokepoint per CONS philosophy.
- **Outcome union evolution per phase** — Phase 25 shipped 7 variants; Phase 26 added `'system_suppressed'`; Phase 27 added `'wellbeing_skipped'`; Phase 28 adds `'responded'` + `'window_missed'` + `'fired_no_response'`. Mirror Phase 26's append-only-with-comment style.
- **Atomic UPDATE…RETURNING for state mutations** — M007 D-28 + Phase 25 RIT-10 idempotency precedent. Adjustment dialogue confirmation uses the same pattern: atomic apply-or-fail on the confirmation row.

### Integration Points
- **`runRitualSweep` (`src/rituals/scheduler.ts`)** — Plan 28-01 + 28-02 + 28-03 all extend this. Order matters:
  1. Auto-re-enable expired mutes (D-28-07)
  2. Adjustment confirmation sweep (D-28-06)
  3. Response window sweep (Plan 28-01)
  4. shouldFireAdjustmentDialogue predicate check (Plan 28-02)
  5. Standard handler dispatch (Phase 25/26/27/29)
- **`processMessage` PP#5 (`src/chris/engine.ts`)** — Plans 28-03 + 28-04 extend with `kind` switch. Position 0 chokepoint preserved (no LLM call from PP#5 path).
- **`bot.ts` registrations** — No new `bot.on(...)` handlers; adjustment-dialogue replies flow through existing `bot.on('message:text')` → `processMessage` → PP#5.
- **`registerCrons(deps)`** — Plan 28-03 adds 1-minute confirmation sweep. Mirrors Phase 25 cron registration pattern.

</code_context>

<specifics>
## Specific Ideas

- **Adjustment dialogue Telegram message text:** "This [daily/weekly] [name] ritual isn't working — what should change? Reply with what to change, or 'no change' / 'drop it' if you'd prefer to keep skipping or stop entirely." (Single-string template; planner picks exact phrasing within constraints.)
- **Default `evasive` classification:** If Haiku returns low confidence (<0.7), default to `evasive` (conservative — would rather over-trigger the 30-day pause than under-trigger). Tunable via env if it proves too aggressive in production.
- **Refusal phrases (extend `src/chris/refusal.ts` if needed):** Existing detector likely covers "stop", "disable", "drop". May need to add "not now" specifically if absent. Planner verifies + extends if needed.
- **`adjustment_mute_until` field default:** `null` (not muted). Set to ISO timestamp when "not now" fires.

</specifics>

<deferred>
## Deferred Ideas

- **Multi-turn adjustment dialogue** — Out of scope (OOS-11 anti-feature `@grammyjs/conversations`). Single-turn structured Haiku is the locked design.
- **Live anti-flattery test for adjustment dialogue** — Could be added to Phase 30 TEST-31 scope. Deferred unless real-use surfaces sycophancy gaps.
- **Per-classification confidence thresholds** — Currently default-evasive on low confidence. Could become a config field. Defer unless real-use shows it.
- **Monthly / quarterly cadence skip thresholds** — RitualConfigSchema already supports skip_threshold 1-10; Phase 28 just doesn't ship monthly/quarterly rituals. M013+ owns.
- **Manual `/skip-tracking-stats` command** — Operator could query "show me skip patterns over last 90 days" via INTERROGATE. Defer unless ops need surfaces.
- **`skip_count` reset on manual config change** — When Greg manually edits `rituals.config.fire_at` outside the adjustment dialogue, should skip_count reset? Probably yes (a manual change resets the implicit "this ritual is broken" state). Plan 28-04 includes a small task for this if the planner agrees.

---

*Phase: 28-Skip-Tracking + Adjustment Dialogue*
*Context gathered: 2026-04-29*
</deferred>
