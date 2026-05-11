# Phase 27: Daily Wellbeing Snapshot — Discussion Log

**Mode:** `--auto` (Claude auto-picks recommended defaults; gray areas resolved without interactive Q&A)
**Date:** 2026-04-26
**Subagent:** gsd-discuss-phase Phase 27 (parallel batch with Phases 26 + 29)

This log captures the gray areas Claude identified during discuss-phase and the auto-picked recommendations that landed in `27-CONTEXT.md`. Each entry includes the question Claude asked itself, the alternatives considered, the recommendation chosen, and the rationale. This is the audit trail for `--auto` mode — equivalent to the back-and-forth a human Q&A loop would produce.

---

## Locked Inputs (NO discussion — already resolved upstream)

These came in pre-locked from the orchestrator's milestone research + STATE.md spec interpretations. Claude did NOT re-litigate any of them:

1. **Wellbeing fires at 09:00 Europe/Paris, separate from voice note (21:00).** Locked at v2.4 kickoff per D026 + Pitfall 13. STATE.md "Spec interpretations locked" #1.
2. **3-row × 5-button inline keyboard for energy / mood / anxiety, single message.** Locked per Disagreement #3 RESOLVED (keep 3 dimensions, ship as ONE message with 3 rows + 4th row skip).
3. **`bot.on('callback_query:data', handleRitualCallback)` registration in `src/bot/bot.ts`** — first inline-keyboard wiring in codebase. Locked per ARCHITECTURE.md §4.
4. **Per-dimension upsert pattern via `INSERT … ON CONFLICT (snapshot_date) DO UPDATE SET <dim> = EXCLUDED.<dim>`** — race-safe avoid last-write-wins. Locked per WELL-02 spec text.
5. **Partial state in `ritual_responses.metadata` jsonb survives across taps.** Locked per WELL-03 spec text.
6. **Keyboard redraw with current selections HIGHLIGHTED + previous days HIDDEN (anchor-bias defeat).** Locked per Pitfall 11 + Pitfall 13.
7. **Skip button = `adjustment_eligible: false`** (does NOT trigger Phase 28 dialogue, distinct from `fired_no_response`). Locked per WELL-04 spec text.
8. **No `@grammyjs/menu` or `@grammyjs/conversations` plugins.** Locked per OOS-11.
9. **Phase 27 owns the `daily_wellbeing` ritual seed insert.** Locked per Phase 25 Open Q1 RESOLVED (`25-RESEARCH.md:1443`).
10. **Wellbeing variance gate at week-end (TS-5c) is consumed by Phase 29, not Phase 27.** Locked per research SUMMARY.

---

## Gray Area #1 — Migration 0008 file naming + seed insert SQL shape

**Question:** What number should Phase 27's migration take? What's the exact SQL shape for the seed insert? Does it ship as part of Plan 27-02 or a dedicated plan?

**Alternatives considered:**

- **(a) `0007_wellbeing_seed.sql`** — Phase 27 takes the next slot after Phase 25's 0006. Conflicts: Phase 26 sibling (running in parallel) is also writing migration 0007 (voice note seed). Coordination required. Risk: parallel sibling collision.
- **(b) `0008_wellbeing_seed.sql`** — Phase 27 deliberately takes 0008, leaving 0007 for Phase 26 (voice note). Phases ship in numeric order; migrations apply lexicographically; the journal tracks each independently. NO conflict between 26's 0007 and 27's 0008 (independent INSERTs into the same `rituals` table).
- **(c) Combined `0008_wellbeing_and_weekly_seed.sql`** — Phase 27 + 29 share. Conflicts: Phase 29 is parallel sibling; ownership is murky.

**Recommendation chosen: (b) `0008_wellbeing_seed.sql`.** Each phase owns its own migration slot. Coordination with Phase 26 sibling is implicit (alphabetic ordering). See D-27-01 for full rationale.

**Why auto-picked:** Mirrors the v2.2 / v2.3 precedent where each phase that adds DDL or seed data takes its own migration. Single-statement seed inserts have no good reason to be combined across orthogonal rituals.

---

## Gray Area #2 — callback_data shape and redraw mechanism

**Question:** What format should the inline keyboard's `callback_data` strings take? Should the keyboard be redrawn on each tap (edit message in place) or should new messages be sent?

**Alternatives considered:**

- **(a) `wb|<fireRowId>|<dim>|<value>` (ARCHITECTURE.md §4 proposal)** — verbose, includes UUID. ~37 bytes. Within 64-byte cap but burns budget for no reason.
- **(b) `r:w:<dim>:<value>` (compact, namespaced)** — `r:w:e:3` = 7 bytes. Prefix `r:` namespaces future ritual callbacks (Phase 28 `r:adj:`, Phase 29 `r:wr:`). No fireRowId needed because wellbeing is keyed on `snapshot_date`, not a fire UUID.
- **(c) Plain dim+value `e:3`** — even shorter but loses ritual-namespace. Future Phase 28/29 callback_data would have to disambiguate via length-checks or magic strings. Brittle.

**Recommendation chosen: (b) `r:w:<dim>:<value>` + edit-message-in-place via `ctx.editMessageReplyMarkup`.** See D-27-02.

**Why auto-picked:** Prefix-based namespacing scales cleanly to Phases 28/29 future callback types; compact byte payload leaves headroom for future schema extensions; no UUID dependency simplifies the wellbeing lookup (snapshot_date is the natural key per Phase 25 schema).

For redraw mechanism: edit-message-in-place was the obvious choice — research SUMMARY Pitfall 10 explicitly cites "single message, inline edit on each tap" as the friction-minimizing pattern. Sending new messages on each tap clutters the chat (4-5 messages per snapshot).

---

## Gray Area #3 — Skip button positioning + label text

**Question:** Where does the skip button live in the keyboard? What does it say? What outcome does it emit?

**Alternatives considered:**

- **(a) Append `Skip` to the anxiety row (6 buttons in row 3)** — saves vertical space but harder to scan visually, and skip is a meta-action not a value.
- **(b) Dedicated 4th row, full-width `Skip` button** — clean separation, easy to tap, matches the visual hierarchy (3 dimension rows + 1 meta row). 1-button row layout standard in Grammy InlineKeyboard.
- **(c) `/skip` command instead of a button** — requires Greg to type, breaks the tap-only interaction. Rejected immediately.

**Recommendation chosen: (b) 4th row, English-labeled `Skip`, emits `r:w:skip` callback_data.** See D-27-03.

**Why auto-picked:** Standard UX pattern; matches research SUMMARY TS-5a "Skip button — optional skip allowed without triggering adjustment dialogue (`adjustment_eligible: false`)". English label per D-27-08 (system UX labels not localized in v2.4).

For outcome emission: the skip button's outcome string was named `wellbeing_skipped` (vs. `skipped_user` or `user_skip`) for symmetry with `wellbeing_completed`. Phase 28 (which consumes the outcome enum) gets a clear "this is a wellbeing-specific skip" signal that it can filter from the 3-strikes counter.

---

## Gray Area #4 — Anchor-bias defeat (Pitfall 13) implementation

**Question:** Pitfall 13 says "keyboard never shows numbers from yesterday's tap" — but does this also mean yesterday's selections aren't quoted in the message text? What's the concrete implementation surface?

**Alternatives considered:**

- **(a) Hide previous values in the keyboard only** — the message text could still say "yesterday: 4 — how are you today?". Keyboard surface is anchor-bias-clean but the prose anchors anyway.
- **(b) Hide on both surfaces (keyboard + message text)** — two-pronged. Message text is a constant prompt with no historical reference. Keyboard never queries `wellbeing_snapshots`.
- **(c) Add reverse-anchor nudges** ("yesterday felt different — tap blind") — Pitfall 11 mitigation literature suggests this. Adds complexity; conflicts with frictionless-deposit contract.

**Recommendation chosen: (b) two-pronged hide-previous mechanism.** See D-27-04.

**Why auto-picked:** Pitfall 11 cites three anchor surfaces (visible numeric history, contextual narrative, prior tap default-focus). Two-pronged covers all three: keyboard surface defeats #1 + #3 (no history visible, no default focus); message text defeats #2 (no narrative anchor). Both are negative requirements (don't render X) — implementation simplicity.

Reverse-anchor nudges (option c) deferred to v2.5 if Phase 29's variance gate (TS-5c) fires.

---

## Gray Area #5 — Per-dim upsert SQL: nullable columns or completion-gated insert?

**Question:** WELL-02 spec says "INSERT … ON CONFLICT (snapshot_date) DO UPDATE SET <dim> = EXCLUDED.<dim>" — but `wellbeing_snapshots` schema has NOT NULL constraints on energy/mood/anxiety. How do we reconcile partial taps with the constraint?

**Alternatives considered:**

- **(a) Relax NOT NULL constraint via Phase 27 migration** — schema change to allow `(date, 3, NULL, NULL)` row writes. Per-dim upsert works directly against `wellbeing_snapshots`.
- **(b) Stage partial state in `ritual_responses.metadata` jsonb; only write to `wellbeing_snapshots` when all 3 dims captured** — no schema change. WELL-02's "per-dim upsert" is satisfied at the metadata level (jsonb_set merges per-dim atomically). The wellbeing_snapshots write is a single atomic completion-gated insert.
- **(c) Use a sentinel value (0) as null-substitute** — schema change to relax CHECK to `BETWEEN 0 AND 5`. Same drawback as (a) plus the sentinel pollutes downstream queries.

**Recommendation chosen: (b) Completion-gated insert via metadata staging.** See D-27-05.

**Why auto-picked:** Avoids schema churn (Phase 25's wellbeing_snapshots schema is locked per RIT-02 + D034 spirit "all indexes shipped day one — no retrofitting"). The metadata staging pattern is already required by WELL-03 ("Partial state in `ritual_responses.metadata` jsonb"). Completion-gating reduces the wellbeing_snapshots write to a single atomic insert with all values present — the cleanest semantics.

WELL-02's "per-dim upsert" language is satisfied by:
- The metadata-level per-dim merge (`jsonb_set` is atomic per-column at Postgres level).
- The final wellbeing_snapshots insert IS an `ON CONFLICT (snapshot_date) DO UPDATE SET energy=EXCLUDED.energy, mood=EXCLUDED.mood, anxiety=EXCLUDED.anxiety` — preserves the "per-dim" atomicity contract.

---

## Gray Area #6 — Plan split structure (~3 plans estimated by orchestrator)

**Question:** How should Phase 27 be split into plans? The roadmap estimate is ~3.

**Alternatives considered:**

- **(a) 1 monolithic plan** — Everything in one. Code review surface 400+ LOC; mixes routing wiring with stateful handler logic. Hard to scan.
- **(b) 3 plans split at routing/semantics/UAT boundaries (chosen)** — 27-01 callback router infra (no DB writes, pure routing), 27-02 wellbeing handler + seed migration (atomic per D-27-06), 27-03 operator UAT script + behavior tests.
- **(c) 4 plans (separate seed migration from handler)** — Violates D-27-06 atomicity (seed without handler dispatches to throwing skeleton).
- **(d) 2 plans (combine 27-01 + 27-02)** — Bundles routing wiring with stateful handler logic. Same drawback as (a) but smaller scope.

**Recommendation chosen: (b) 3 plans.** See D-27-07.

**Why auto-picked:** Matches the roadmap estimate. Cleaves at natural surface boundaries: pure routing infrastructure (27-01) is independently reviewable + testable without ritual semantics; the meat (27-02) ships migration + handler atomically (D-27-06); the operator UAT closure (27-03) provides hands-on verification.

The order (01 → 02 → 03) is sequential — 27-02 depends on 27-01's `handleRitualCallback` dispatcher being wired; 27-03's operator script depends on 27-02's `fireWellbeing` export.

---

## Gray Area #7 — Localization scope for inline keyboard labels

**Question:** Should the `Skip` button label and the fire prompt text be localized to EN/FR/RU per `franc`?

**Alternatives considered:**

- **(a) English-only for v2.4 (chosen)** — System UX labels stay English. Matches Phase 22's `/summary` precedent (data labels stayed English in v2.2).
- **(b) Full EN/FR/RU localization at fire time** — read `getLastUserLanguage(chatId)`, branch all button text. Adds ~30 LOC; introduces the "what if last message was English but user expected French today" footgun.
- **(c) Greg picks language via env var `WELLBEING_UI_LANGUAGE`** — operator-controlled. Static. Adds config surface for marginal value.

**Recommendation chosen: (a) English only.** See D-27-08.

**Why auto-picked:** M006 EN/FR/RU localization applies to Chris-generated message bodies (mode handlers, error fallbacks, polite voice decline) — not to inline keyboard button labels per existing precedent. If Greg requests French/Russian later, ~5 LOC delta to add. Defer.

---

## Gray Area #8 — Cron-tick alignment for the 09:00 fire

**Question:** Does Phase 27 need to add a third cron tick (at 09:00 Europe/Paris) to fire the wellbeing exactly on time, or does the existing morning 10:00 sweep tick catch it (with up to 60min latency)?

**Alternatives considered:**

- **(a) Existing 10:00 morning tick catches it** — Phase 25 already has 10:00 + 21:00 ticks. The 10:00 tick runs `runRitualSweep` which selects `WHERE next_run_at <= now()` — at 10:00 Paris on day N, the 09:00 next_run_at is 1h in the past, so it fires. Greg gets the message at 10:00 with up to 60min latency from spec.
- **(b) Add a third cron tick at 09:00** — exact-time firing. Adds operational complexity (third cron registration in `registerCrons` helper); Phase 25's design intentionally chose 2 ticks per Disagreement #1.
- **(c) Hourly cron sweep** — Disagreement #1 alternative. Heavier than needed for v2.4.

**Recommendation chosen: (a) 10:00 tick catches it.** See D-27-09.

**Why auto-picked:** Per research SUMMARY Disagreement #1 ("Tradeoff accepted: Non-default `fire_at` settings (e.g., 14:30) would be up to 6h late. M009's three rituals all align with 10:00 or 21:00 ticks."), this latency tradeoff is the accepted M009 design. The wellbeing semantics (morning, before day-narrative-pollution per Pitfall 13) are preserved at 10:00 fire time. Greg can override via `RITUAL_SWEEP_CRON` env var if exact 09:00 timing matters; not in Phase 27 scope.

---

## Gray Area #9 — Test approach (real DB vs mocked)

**Question:** Should Plan 27-03's behavior tests use real Docker Postgres or mocked DB?

**Alternatives considered:**

- **(a) Fully mocked DB** — `vi.mock('../db/connection.ts')`. Fast, no Docker dependency. But would silently pass broken concurrency code (D-27-05's per-dim jsonb_set upsert correctness depends on Postgres-level row-lock semantics).
- **(b) Real Docker Postgres on port 5433 (chosen)** — Uses the running test instance. Telegram API stubbed via minimal Grammy `Context` builder. Per Phase 25 LEARNINGS lesson "Postgres concurrent-update semantics must be tested with REAL postgres, not mocks".
- **(c) Hybrid** — real DB for concurrency tests, mocked for keyboard rendering tests. Adds complexity; planner would have to maintain two test setup paths in one file.

**Recommendation chosen: (b) Real DB integration.** See D-27-10.

**Why auto-picked:** Phase 25 LEARNINGS surfaced this lesson explicitly (real-DB-only for concurrency tests). The same lesson applies to Phase 27's per-dim jsonb_set upsert (which is a SQL-level atomic merge — mocks can't reproduce row-lock + jsonb merge semantics). Telegram API stubbing is straightforward (the handler only uses `editMessageReplyMarkup`, `editMessageText`, `answerCallbackQuery`).

---

## Gray Area #10 — UI-SPEC.md gate (UI hint flagged in roadmap)

**Question:** The roadmap flags Phase 27 as `UI hint: yes`. Should the workflow auto-trigger `/gsd-ui-phase` and produce a UI-SPEC.md design contract?

**Alternatives considered:**

- **(a) Skip UI-SPEC.md** — This is a Telegram inline-keyboard surface, not a web UI. The "design contract" is essentially the 4-row keyboard layout + ASCII `[N]` highlighting + edit-in-place + English labels. All captured in D-27-02 / D-27-03 / D-27-04 / D-27-08.
- **(b) Run `/gsd-ui-phase` to produce UI-SPEC.md** — Adds ceremony for ~15 buttons in a fixed layout. The keyboard is fully spec'd by WELL-01.
- **(c) Run `/gsd-ui-phase` only if a designer-style mockup is wanted** — visual mockups would be Telegram screenshots, not Figma. Defer to ad hoc spawn if needed.

**Recommendation chosen: (a) Skip UI-SPEC.md.** See `27-CONTEXT.md` `<ui_design>` block.

**Why auto-picked:** The keyboard layout is fixed (3 rows × 5 buttons + 1 row × 1 button per WELL-01). Visual rendering is determined by Telegram's client (we don't control fonts, colors, or layout). The "design surface" reduces to text labels (D-27-08) and selection highlighting (D-27-02 chose `[N]` ASCII). UI-SPEC.md ceremony would not surface new constraints. Flag in CONTEXT.md and move on.

---

## Summary

10 gray areas identified, 10 auto-resolved with documented rationale. All resolutions traceable to existing locked decisions (research SUMMARY, STATE.md, Phase 25 CONTEXT/LEARNINGS) or to clean cleavage points in the surface area (e.g., 3-plan split at routing/semantics/UAT boundaries).

Zero open questions for orchestrator. Phase 27 is ready for planning (gsd-plan-phase next).

---

*Discussion mode: --auto*
*Subagent: gsd-discuss-phase Phase 27*
*Generated: 2026-04-26*
