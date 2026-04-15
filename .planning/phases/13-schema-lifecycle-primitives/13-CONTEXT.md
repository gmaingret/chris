# Phase 13: Schema & Lifecycle Primitives — Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

The database layer structurally encodes the decision lifecycle so that nothing else in M007 can be built on a leaky foundation. Delivers:

- `decisions` projection table, `decision_events` append-only log, `decision_capture_state` capture-FSM table.
- `pgEnum` types: `decision_status` (8 values incl. `open-draft`/`withdrawn`/`stale`/`abandoned`) and `decision_capture_stage`.
- `DECISION` added to `epistemic_tag` enum.
- `transitionDecision(id, toStatus, payload)` chokepoint with optimistic concurrency — the **only** code path that mutates `decisions.status`.
- `regenerateDecisionFromEvents(id)` replay function proving the append-only invariant.
- NOT NULL: `decisions.falsification_criterion`, `decisions.resolve_by`.
- Auto-migration clean against Docker Postgres; unit tests cover every illegal transition + the optimistic-concurrency race.

Out of scope for this phase: trigger detection, capture conversation, deadline sweep, resolution handler, `/decisions` command, stats. Those are Phases 14–18.

</domain>

<decisions>
## Implementation Decisions

### Event log shape
- **D-01:** `decision_events` stores a **full snapshot** of the decision state per event (no diffs, no hybrid). Regeneration = replay events in order; latest event's snapshot = current projection.
  - Rationale: Greg-scale (~100 events/year) makes storage cost irrelevant; removes diff-merge logic from the critical-path.
- **D-02:** An event row is written for **every status transition AND every field change** on `decisions` (literal reading of LIFE-02). Any mutation of the projection row goes through an append first. Projection is never touched without a corresponding event.
- **D-03:** Event columns (at minimum): `id`, `decision_id`, `event_type` (enum: `created` / `status_changed` / `field_updated` / `classified`), `from_status`, `to_status`, `snapshot` (jsonb — full `decisions` row state at this point), `actor` (`capture`/`transition`/`sweep`/`user`/`system`), `created_at`. Final column list: planner's call.

### Legal transition map
- **D-04:** Complete legal transition map for `transitionDecision()`:
  ```
  open-draft → open        (when missing required fields get filled)
  open-draft → withdrawn   (Greg withdraws before completing capture)
  open-draft → abandoned   (capture state GC'd after 24h without completion)
  open       → due         (sweep: resolve_by passed, oldest-due row)
  open       → withdrawn   (Greg withdraws before deadline)
  due        → resolved    (Greg replies to resolution prompt)
  due        → stale       (RES-06: 2 non-replies to resolution prompt)
  due        → withdrawn   (Greg withdraws after deadline surfaced but before resolving)
  resolved   → reviewed    (Greg answers post-mortem follow-up)
  ```
  All other transitions throw `InvalidTransitionError`. Terminal states (`reviewed`/`withdrawn`/`stale`/`abandoned`) have **no outgoing edges** — no retroactive un-review, un-withdraw, un-stale (guards OOS-M007-03 spirit).
- **D-05:** `stale` is reached **only** via the explicit RES-06 auto-escalation path (`due → stale` after 2 non-replies). There is **no** implicit `open → stale` sweep. Long-abandoned `open` rows stay `open` until `due`.
- **D-06:** `withdrawn` is only reachable from `open-draft`, `open`, or `due` — NOT from `resolved`/`reviewed`/`stale`/`abandoned`. Audit integrity preserved.
- **D-07:** `abandoned` and `withdrawn` are **distinct** values with different semantics: `withdrawn` = Greg explicit; `abandoned` = capture never completed + state GC'd. Both terminal. Stats and post-mortems can distinguish them.

### `decisions` column set
- **D-08:** **Single** `reasoning` text column. `reasoning_stated` + `reasoning_suspected` (surfaced by research) is deferred to FUTURE — probably premature before real data.
- **D-09:** `domain_tag` is added as a **nullable text column in Phase 13** (filled by Phase 14 Haiku inference; consumed by Phase 17 stats). Avoids a later migration.
- **D-10:** `resolve_by` is `timestamp with time zone NOT NULL`. Matches existing Drizzle convention; STAT-04's `FILTER (WHERE resolved_at >= now() - interval 'N days')` expects timestamptz.
- **D-11:** `falsification_criterion` is `text NOT NULL` (LIFE-04 — structural, not CHECK-constraint).
- **D-12:** The following fields are added as **nullable columns in Phase 13** so downstream phases don't need migrations:
  - `resolution` (text) + `resolution_notes` (text) — written by Phase 16.
  - `accuracy_class` (text) + `accuracy_classified_at` (timestamptz) + `accuracy_model_version` (varchar) — written by Phase 17. Note: STAT-02 says the classification is cached "on `decision_events` row" — with D-01 full-snapshot events this is automatically true (the `classified` event carries the values); the projection columns are a denormalized mirror for fast `/decisions` reads.
  - `withdrawn_at`, `stale_at`, `abandoned_at` (timestamptz) — denormalized terminal timestamps for fast queries without joining events.
  - `language_at_capture` (varchar 3, `en`/`fr`/`ru`) — captured at decision-creation time from `franc`-detected last-user-language; used by Phase 16 resolution prompt (RES-02) to stay in Greg's capture-time language.

### Replay & error semantics
- **D-13:** Phase 13 **ships** `regenerateDecisionFromEvents(id: string)` function + roundtrip unit test (`regenerate(id)` deep-equals current projection after a representative sequence of transitions). Proves the append-only invariant at code level, not just in prose.
- **D-14:** `transitionDecision()` throws **two distinct error types**:
  - `InvalidTransitionError` — illegal move per D-04 map.
  - `OptimisticConcurrencyError` — `UPDATE ... WHERE id=$id AND status=$expected` affected 0 rows (row changed under us).
  - Phase 15 sweep will retry on concurrency, give up on invalid. Phase 18 TEST-11 asserts the two paths distinguishably.

### `decision_capture_state` (included in Phase 13)
- **D-15:** Table included per ROADMAP success criterion 1. Schema (from ARCHITECTURE.md research §2b):
  ```
  chat_id     bigint  PK
  stage       decision_capture_stage  NOT NULL
  draft       jsonb                   NOT NULL
  decision_id uuid                    NULL  (set when stage=AWAITING_RESOLUTION/POSTMORTEM)
  started_at  timestamptz             DEFAULT now()
  updated_at  timestamptz             DEFAULT now()
  ```
  PK=chat_id enforces ≤1 active capture/resolution flow per chat. Handlers (Phase 14/16) populate it; Phase 13 just creates the table + enum + returns empty helpers (e.g. `getActiveDecisionCapture(chatId)`).
- **D-16:** `decision_capture_stage` enum values: `DECISION`, `ALTERNATIVES`, `REASONING`, `PREDICTION`, `FALSIFICATION`, `AWAITING_RESOLUTION`, `AWAITING_POSTMORTEM`, `DONE`. (Planner may refine; these match research.)

### `DECISION` epistemic tag
- **D-17:** Add `DECISION` to `epistemic_tag` enum in this phase. Phase 14 capture-commit will tag the pensieve summary with `DECISION` so the commitment trigger (`INTENTION`-only) does not double-fire (LIFE-06).

### Claude's Discretion
- Exact Drizzle column ordering and indexing strategy (e.g. index on `decisions.status` + `decisions.resolve_by` for sweep queries) — planner/executor.
- Whether CHECK constraints are added now (e.g. `resolved` → `resolution IS NOT NULL`) or deferred to Phase 16 when the write actually happens. Prefer: defer per-status CHECKs until the phase that writes them, so Phase 13 doesn't block on columns that will always be nullable here.
- Error class file location (`src/decisions/errors.ts` vs inline in `lifecycle.ts`).
- Migration file naming and whether to split schema additions across multiple migrations or one.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` §Lifecycle — LIFE-01..04, LIFE-06 are in-scope for this phase.
- `.planning/ROADMAP.md` §"Phase 13: Schema & Lifecycle Primitives" — success criteria.

### Research (all directly applicable)
- `.planning/research/ARCHITECTURE.md` §2b (capture state table), §2d (state machine — DB + application), §4 (new vs modified components), §5 Phase 1 build order, §6 AP-3 (implicit transitions).
- `.planning/research/SUMMARY.md` §"Critical Pitfalls" C4 (mutable-status trap) and §"Phase 1: Schema + Lifecycle Primitives".
- `.planning/research/PITFALLS.md` — C4, M1 mitigations.
- `.planning/research/STACK.md` — Drizzle 0.45.2 `pgEnum`, Postgres 16 constraints, Vitest 4.1 for tests.

### PRD / Spec
- `M007_Decision_Archive.md` (project root) — the original M007 spec.
- `PRD_Project_Chris.md` (project root) — overall product context.

### Existing code patterns (reuse, do not reinvent)
- `src/db/schema.ts` — existing `pgEnum`/`pgTable` conventions (lines 20–178); all new tables follow the same style.
- `src/db/migrate.ts` — auto-migration entrypoint (D016 auto-migrate-on-startup).
- `src/proactive/triggers/types.ts` — `TriggerResult.triggerType` union will need `'decision-deadline'` added (Phase 15, not this phase; noted so schema work is aware of the eventual shape).
- `contradictions` table (schema.ts:163) — existing pattern for an enum-status row; good reference shape for `decisions`.

### Decisions log (PROJECT.md)
- D004 (Pensieve append-only discipline) — mirrored by `decision_events`.
- D010 (two-phase triggers) — downstream Phase 15 shape; not phase-13 work.
- D016 (Drizzle auto-migrate on startup).
- D018 (Vitest fake timers for synthetic-clock tests).
- D020 (deterministic pre-processors over Haiku where possible) — informs Phase 14, not 13.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`pgEnum` pattern** (schema.ts:20–62): exact template for `decision_status` and `decision_capture_stage`. Follow identical style — single-statement, all values listed.
- **`pgTable` pattern** (schema.ts:66–178): index declarations live in the trailing callback. Timestamps use `withTimezone: true` universally — match this for every new timestamp column.
- **`contradictions` table** (schema.ts:163–172): closest existing shape to `decisions` — enum status column, optional resolution text, detected/resolved timestamps. Use as structural template.
- **`bigint` mode=bigint for chat_id** (conversations.ts: line 116): established pattern for Telegram chat IDs, required for `decision_capture_state.chat_id`.
- **`jsonb` for flexible payload** (proactive_state.ts: line 176): established pattern for `decision_capture_state.draft` and `decision_events.snapshot`.
- **`gen_random_uuid()` default** (schema.ts:69 etc.): standard primary-key default. Use for `decisions.id` and `decision_events.id`.

### Established Patterns
- Auto-migration on startup via `src/db/migrate.ts` (D016). Migrations must be idempotent-safe because they run every boot.
- Drizzle snapshots live in `src/db/migrations/meta/` — do not edit by hand; let `drizzle-kit generate` emit them.
- Docker Postgres is the test target (per user feedback memory "Always run full Docker tests").

### Integration Points
- `src/chris/engine.ts` will later (Phase 14) add a pre-processor reading `decision_capture_state` — Phase 13 must ship a `getActiveDecisionCapture(chatId)` helper that returns `null` cleanly when the table is empty.
- `src/proactive/sweep.ts` will later (Phase 15) call `transitionDecision(id, 'due')` — the chokepoint must be import-ready.
- `src/decisions/` directory does not exist yet — Phase 13 creates it. Likely files: `schema.ts` adds (no new file), `src/decisions/lifecycle.ts`, `src/decisions/errors.ts`, `src/decisions/regenerate.ts` (or fold into lifecycle), `src/decisions/capture-state.ts` (read helpers for the capture-state table).

</code_context>

<specifics>
## Specific Ideas

- **Full-snapshot events over diffs.** User explicitly rejected the diff-only and hybrid options. Reason cited in discussion: Greg-scale makes storage irrelevant; diff-merge logic is load-bearing and error-prone.
- **Replay must actually run in tests.** User chose to ship `regenerateDecisionFromEvents(id)` with a roundtrip assertion in Phase 13 rather than defer to Phase 18. Planner: include this in a dedicated unit test covering at least one full happy-path trajectory (`open-draft → open → due → resolved → reviewed`) AND one side-path (`open → withdrawn`) — each replay must deep-equal the live projection.
- **Two error classes, not one.** Phase 18's TEST-11 (concurrency race) and Phase 15's sweep retry logic both need to programmatically distinguish `InvalidTransitionError` from `OptimisticConcurrencyError`. This is load-bearing for later phases — do not collapse to a single class for "simplicity".
- **`language_at_capture` is Phase-16 infrastructure paid for in Phase 13.** The column exists here but is written by Phase 14's capture-commit. Phase 13 just adds the column definition.
- **No CHECK constraints tied to non-`open` states in this phase.** Reason: Phase 13 never creates a `resolved` row, so a `CHECK (status='resolved' → resolution IS NOT NULL)` constraint can be added in Phase 16 when the write actually lands. Keeps migrations close to the code that exercises them.

</specifics>

<deferred>
## Deferred Ideas

- **`reasoning_stated` + `reasoning_suspected` dual slots** — research-surfaced; user chose single `reasoning` for now. Revisit post-v2.1 with real data.
- **Implicit `open → stale` sweep for long-abandoned decisions** — rejected: stale is explicit-only via RES-06. If needed later, add as a distinct phase.
- **Retroactive withdrawal of resolved decisions** — rejected permanently (OOS-M007-03 spirit).
- **Drift-check utility walking all decisions asserting `regenerate(id) == projection`** — overkill at Greg-scale; user picked the simpler "ship replay + roundtrip test" option. Can be added if integrity bugs surface.

</deferred>

---

*Phase: 13-schema-lifecycle-primitives*
*Context gathered: 2026-04-15*
