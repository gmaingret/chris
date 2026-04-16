# Phase 17: `/decisions` Command & Accuracy Stats - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Greg can pull an honest snapshot of his forecasting performance that is structurally incapable of becoming dashboard sycophancy — small N never produces a percentage, and uncertainty is visually present. Delivers:

- Full `/decisions` Telegram command surface: no-args summary, `open`, `recent`, `stats [30|90|365]`, `suppress <phrase>` (existing), `suppressions` (list), `unsuppress <phrase>` (remove), `reclassify`.
- 2-axis Haiku classification (`outcome` reused from Phase 16's `classifyOutcome()` + new `reasoning` axis: `sound|lucky|flawed`) run at resolution time in `handleResolution()`, cached on the `decisions` row with model version.
- N>=10 floor with Wilson 95% CI for accuracy display. Below floor: counts only, no percentage.
- Rolling 30/90/365-day SQL FILTER windows in a single round-trip. `unverifiable` as separate denominator.
- Domain-tag breakdown in stats output. `/decisions reclassify` re-runs all reviewed decisions' classifications, preserving originals in `decision_events`.
- Pull-only discipline: Chris never pushes stats unprompted.

**Out of scope for Phase 17 (named explicitly to prevent creep):**
- Synthetic-fixture end-to-end + live ACCOUNTABILITY Sonnet suite -> Phase 18.
- Id-based suppression (`suppress id:<uuid>`) -> deferred.
- Per-channel `/mute decisions` -> deferred.
- Charts, graphs, or visualizations (OOS-M007-06).
- Unprompted stat pushes (OOS-M007-05).

</domain>

<decisions>
## Implementation Decisions

### 2-axis Haiku classification (STAT-02)

- **D-01:** Classification timing = **second Haiku call in `handleResolution()`**, immediately after the existing `classifyOutcome()` call. Phase 16's single-axis classifier stays intact (used for post-mortem question selection). A NEW Haiku call adds the reasoning axis for stats.
- **D-02:** Outcome reuse = **reuse the outcome from `classifyOutcome()`**. The reasoning classifier receives the known outcome and determines `sound | lucky | flawed`. One Haiku call, not a full 2-axis re-derivation. Consistent with post-mortem question selection.
- **D-03:** Storage format = **combined string** in `accuracy_class` column (e.g. `"hit/sound"`, `"miss/flawed"`, `"ambiguous/sound"`). Model version string stored in `accuracy_model_version`. Both written to the `decisions` projection row and captured in a `classified` event in `decision_events`.
- **D-04:** Fail-closed to `"<outcome>/unknown"` on Haiku timeout or parse failure. Reasoning = `unknown` does not count toward accuracy stats (treated like `unverifiable` for the reasoning axis).

### Output formatting

- **D-05:** `/decisions` (no args) = **counts-only dashboard**. One-line status counts (`5 open · 2 due · 12 reviewed · 1 stale`), plus 90-day accuracy if N>=10, plus available sub-commands. Fits one Telegram bubble.
- **D-06:** `/decisions open` = **compact one-liner per decision**. Each line: short title (truncated `decision_text`) + resolve_by date + domain tag. Sorted by `resolve_by` ascending (soonest first). No prediction/reasoning shown in list view.
- **D-07:** `/decisions recent` = **compact one-liner per decision** showing the last 5-10 resolved/reviewed decisions. Each line: short title + outcome class + date resolved. Sorted by `resolved_at` descending.
- **D-08:** `/decisions stats [30|90|365]` = **flat text block**. Overall accuracy line with Wilson CI `[low-high%]`, unverifiable count on separate line, then domain-tag breakdown table. Below N=10 per domain: shows `N=<count>, threshold not met`. Default window = 90 days when no arg given.
- **D-09:** All output is **plain text** (OOS-M007-06). No emoji in stat lines. Localized to Greg's language via `getLastUserLanguage()`.

### Reclassify mechanics (STAT-05)

- **D-10:** `/decisions reclassify` = **batch all reviewed decisions** that have a `resolution` value. Runs Haiku 2-axis classification sequentially (not parallel — rate limit discipline). Reports count when done: "Reclassified N decisions."
- **D-11:** Original classifications preserved via **append-only event log**. Reclassify writes a new `classified` event to `decision_events` with the new `accuracy_class` + `accuracy_model_version`. The `decisions` projection row is overwritten with the latest values. Previous classifications remain readable in the event history.
- **D-12:** No version-checking optimization. Reclassifies ALL reviewed decisions regardless of whether `accuracy_model_version` matches the current `HAIKU_MODEL`. Keeps the logic simple; Greg-scale (<=20 decisions) makes optimization unnecessary.

### Suppression management

- **D-13:** Phase 17 adds **`/decisions suppressions`** (lists active suppressed phrases) and **`/decisions unsuppress <phrase>`** (removes a suppression by exact match). Completes the CRUD cycle for phrase-based suppression.
- **D-14:** Id-based suppression (`suppress id:<uuid>`) stays **deferred**. Not needed until Greg accumulates enough decisions that phrase-based suppression is insufficient.

### SQL & computation

- **D-15:** Wilson 95% CI computed in **application code** (not SQL). The formula is simple (`(p + z^2/2n +/- z*sqrt(p*(1-p)/n + z^2/4n^2)) / (1 + z^2/n)` where z=1.96). Single SQL round-trip fetches all resolved decisions in the window; app code computes CI.
- **D-16:** Rolling windows via SQL `FILTER (WHERE resolved_at >= now() - interval 'N days')` as specified in STAT-04. Single query with three FILTER clauses can return 30/90/365 counts in one round-trip, but `/decisions stats` only requests one window at a time (the arg).
- **D-17:** `unverifiable` decisions are excluded from the accuracy denominator but surfaced as an explicit separate count: "Unverifiable: N (excluded)".

### Claude's Discretion

- Exact wording of all localized output strings (EN/FR/RU) — planner drafts, executor can tune.
- Whether `handleResolution()` modification lives in `resolution.ts` directly or a separate `classify-accuracy.ts` utility called from it.
- Whether `/decisions recent` shows 5 or 10 decisions as the default page size.
- Wilson CI display precision (integer % vs one decimal).
- How `decision_text` is truncated for the compact one-liner format (character limit, ellipsis placement).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §Stats (STAT-01 through STAT-05) — all in-scope requirements for this phase.
- `.planning/ROADMAP.md` §"Phase 17: `/decisions` Command & Accuracy Stats" — success criteria 1-5.

### Research
- `.planning/research/PITFALLS.md` §C6 (dashboard sycophancy) — the core anti-pattern this phase prevents.
- `.planning/research/PITFALLS.md` §C2 (vague predictions inflating stats) — N>=10 floor + `unverifiable` exclusion.
- `.planning/research/PITFALLS.md` §M4 (recomputation on read) — classification cached at resolution time, never recomputed.
- `.planning/research/ARCHITECTURE.md` — `/decisions` command placement, stats computation approach.
- `.planning/research/SUMMARY.md` §"Phase 5: /decisions Command + Stats" (if present).

### Prior-phase context (inherits decisions)
- `.planning/phases/13-schema-lifecycle-primitives/13-CONTEXT.md` — locks `decisions` table columns (D-09 `domain_tag`, D-12 `accuracy_class`/`accuracy_classified_at`/`accuracy_model_version`), `decision_events` append-only invariant, `transitionDecision()` chokepoint.
- `.planning/phases/14-capture-flow/14-CONTEXT.md` — locks `domain_tag` population during capture (D-09 of Phase 13, wired in `capture.ts`), `/decisions suppress` handler shape, engine pre-processor ordering.
- `.planning/phases/16-resolution-post-mortem-accountability-mode/16-CONTEXT.md` — locks `classifyOutcome()` (single-axis: hit/miss/ambiguous/unverifiable), `handleResolution()` flow, `handlePostmortem()` flow. Phase 17 extends `handleResolution()` with the reasoning axis classification.

### PRD / Spec
- `M007_Decision_Archive.md` (project root) — the original M007 spec.
- `PRD_Project_Chris.md` (project root) — overall product context.

### Existing code patterns (reuse, do not reinvent)
- `src/bot/handlers/decisions.ts` — existing `/decisions` command handler with `suppress` working and `open`/`recent`/`stats`/`reclassify` stubs returning "Coming in Phase 17." Extend this file.
- `src/decisions/resolution.ts` — `classifyOutcome()` (lines 99-174), `handleResolution()` (lines 195-321). Phase 17 adds a `classifyAccuracy()` call after line 294 (`classifyOutcome`).
- `src/decisions/lifecycle.ts` — `transitionDecision()` chokepoint; reclassify writes a `classified` event.
- `src/decisions/suppressions.ts` — `addSuppression()` already exists. Add `listSuppressions()` and `removeSuppression()`.
- `src/db/schema.ts` — `decisions` table with `accuracyClass`, `accuracyClassifiedAt`, `accuracyModelVersion`, `domainTag` columns already defined.
- `src/chris/language.ts` — `getLastUserLanguage()` for output localization.
- `src/llm/client.ts` — `HAIKU_MODEL` constant for model version string.

### Decisions log (PROJECT.md)
- D001 three-tier LLM — Haiku for reasoning classification.
- D004 append-only Pensieve — `decision_events` append-only invariant reused for reclassify event storage.
- D018 no skipped tests — all tests run against Docker Postgres.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`handleDecisionsCommand()`** (`src/bot/handlers/decisions.ts`): fully structured command router with `suppress` working. Sub-command dispatch already in place — add `open`/`recent`/`stats`/`reclassify`/`suppressions`/`unsuppress` cases.
- **`classifyOutcome()`** (`src/decisions/resolution.ts:99-174`): Haiku classification template with timeout, fail-closed, JSON parse. Reuse this exact pattern for `classifyAccuracy()`.
- **`addSuppression()`** (`src/decisions/suppressions.ts`): DB write pattern. Add `listSuppressions()` and `removeSuppression()` following same style.
- **`decision_events` write pattern** (`src/decisions/lifecycle.ts:41-95`): `transitionDecision()` creates events with full snapshots. Reclassify writes a `classified` event using the same mechanism.
- **`isoLang()` helper** (`src/bot/handlers/decisions.ts:56`): language normalization for output. Already handles EN/FR/RU.

### Established Patterns
- Bot command handlers in `src/bot/handlers/` follow a consistent structure: parse command text, validate, call business logic, format reply, `ctx.reply()`.
- Haiku calls use `HAIKU_MODEL` constant with tight `max_tokens`, JSON schema in system prompt, timeout + fail-default.
- All timestamps use `timestamp('...', { withTimezone: true })`.
- Tests run against Docker Postgres (user feedback: always run full Docker tests).

### Integration Points
- `src/bot/handlers/decisions.ts` — extend with new sub-command handlers.
- `src/decisions/resolution.ts::handleResolution()` — add `classifyAccuracy()` call after existing `classifyOutcome()`.
- `src/decisions/suppressions.ts` — add `listSuppressions()` and `removeSuppression()`.
- `src/decisions/lifecycle.ts` — may need a `writeClassifiedEvent()` helper for reclassify (or extend `transitionDecision()` to support non-transition events).
- New file(s): `src/decisions/stats.ts` (accuracy computation, Wilson CI, SQL queries) and/or `src/decisions/classify-accuracy.ts` (reasoning classifier).

</code_context>

<specifics>
## Specific Ideas

- **Counts-only dashboard for `/decisions` default.** Fits one Telegram bubble. Greg runs `/decisions stats` when he wants depth. No creep toward a "dashboard experience" — this is a pull-only tool.
- **Compact one-liners for `open` and `recent`.** Title + date + tag per line. No prediction/reasoning in list views — that's detail Greg can recall from context. Soonest-first for open, newest-first for recent.
- **Flat text block for stats.** Overall line + domain breakdown. Wilson CI as `[low-high%]`. Below N=10: counts only. Unverifiable explicitly separated. No attempt to make this look like a dashboard.
- **Reuse outcome, classify reasoning separately.** Phase 16's `classifyOutcome()` stays untouched. The 2-axis stats classification is a second Haiku call that takes the known outcome and asks "was the reasoning sound, lucky, or flawed?" Cheaper, faster, consistent.
- **Event log preserves reclassify history.** No new columns, no dual-column scheme. The append-only event log naturally stores every classification ever run. The projection row shows the latest.
- **Batch reclassify, no optimization.** Greg-scale means <=20 Haiku calls. Sequential, not parallel. Simple, predictable.

</specifics>

<deferred>
## Deferred Ideas

- **Id-based suppression** (`/decisions suppress id:<uuid>`) — deferred until Greg accumulates enough decisions that phrase-based suppression is insufficient.
- **Per-channel `/mute decisions`** — deferred; not Phase 17 scope.
- **Charts/sparklines** — permanently rejected (OOS-M007-06).
- **Unprompted stat pushes** — permanently rejected (OOS-M007-05).
- **Domain-specific calibration curves** — deferred to FUTURE-M007-03.
- **Opus pattern detection across misses** — deferred to FUTURE-M007-01 (requires N>=20 resolved).
- **`/decisions promote`** for drafts — deferred; revisit if drafts accumulate.
- **Parallel reclassify** — deferred; sequential is fine at Greg-scale.

</deferred>

---

*Phase: 17-decisions-command-accuracy-stats*
*Context gathered: 2026-04-16*
