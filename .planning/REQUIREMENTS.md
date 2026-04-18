# Requirements: Project Chris — v2.2 M008 Episodic Consolidation

**Defined:** 2026-04-18
**Core Value:** Greg can deposit any memory, thought, or feeling into Chris and later ask questions that Chris answers by searching everything Greg has ever told him — with full fidelity, no data loss, and genuine contextual understanding across English, French, and Russian.

**Milestone goal:** Add a second memory tier above the raw Pensieve store — end-of-day episodic summaries that compress each day's entries into a structured narrative with importance scoring. Foundation for M009 weekly review and M010+ profile inference.

## v2.2 Requirements

Requirements for M008 Episodic Consolidation. Each maps to roadmap phases.

### Pre-Work / Tech Debt

- [x] **TD-01**: TECH-DEBT-19-01 resolved — drizzle-kit meta snapshots for migrations 0001/0003 regenerated so migration 0005 (`episodic_summaries`) writes onto a clean lineage. `drizzle-kit generate` produces no spurious diff after resolution. (Phase 20 Plan 01, 2026-04-18)

### Schema & Storage

- [x] **EPI-01**: New `episodic_summaries` table created via migration 0005 with fields: `id` (uuid pk), `summary_date` (date, NOT NULL), `summary` (text, NOT NULL), `importance` (integer, NOT NULL, CHECK 1–10), `topics` (text[], NOT NULL default '{}'), `emotional_arc` (text, NOT NULL), `key_quotes` (text[], NOT NULL default '{}'), `source_entry_ids` (uuid[], NOT NULL default '{}'), `created_at` (timestamptz, NOT NULL default now()). (Phase 20 Plan 02, 2026-04-18)
- [x] **EPI-02**: Indexes in initial migration: `UNIQUE(summary_date)` (idempotency + DST safety); `GIN(topics)` (M009 weekly aggregation); `btree(importance)` (M010 profile inference + M008 high-importance raw descent). All three indexes must ship in migration 0005, not retrofitted. (Phase 20 Plan 02, 2026-04-18)
- [x] **EPI-03**: Zod schema for `EpisodicSummary` defined in `src/episodic/types.ts` and exported. Used by `messages.parse()` for structured Sonnet output and by Drizzle for runtime validation before insert. (Phase 20 Plan 02, 2026-04-18 — three-layer chain SonnetOutput → Insert → DB-read per CONTEXT.md D-11/D-12/D-13)
- [x] **EPI-04**: `config.episodicCron` field added to `src/config.ts` with default `"0 23 * * *"` (23:00 daily in `config.proactiveTimezone`). Type-validated. Documented as "When the daily episodic consolidation cron fires." (Phase 20 Plan 02, 2026-04-18)

### Consolidation Engine

- [x] **CONS-01**: `runConsolidate(date: Date)` exported from `src/episodic/consolidate.ts`. Fetches the day's Pensieve entries in `config.proactiveTimezone`, fetches M002 contradictions for the day window, fetches M007 decisions created/resolved that day with `lifecycle_state`, calls Sonnet with structured Zod output, inserts row. (Phase 21 Plan 04, 2026-04-18 — 10-step orchestration: normalize date → idempotency SELECT → entry-count gate → parallel sources fetch via Promise.all → assembleConsolidationPrompt → anthropic.messages.parse({ output_config: { format: zodOutputFormat(...) } }) with one retry → runtime importance floors → parseEpisodicSummary re-validation → ON CONFLICT insert; Test 4 happy-path + Test 12 schema-validation cover.)
- [x] **CONS-02**: Entry-count gate before any Sonnet call — zero Pensieve entries for the day produces no Sonnet call, no insert, no API cost. Logged at INFO level. (Phase 21 Plan 04, 2026-04-18 — `if (entries.length === 0)` short-circuit at L224 of consolidate.ts AFTER the pre-flight SELECT but BEFORE the parallel sources fetch and Sonnet call; logs `episodic.consolidate.skip.no-entries`. Test 1 asserts `mockAnthropicParse.toHaveBeenCalledTimes(0)` AND `result === { skipped: 'no-entries' }` AND no row in DB.)
- [x] **CONS-03**: Idempotency guaranteed by pre-flight `SELECT FROM episodic_summaries WHERE summary_date = $1` skip-on-existing AND `INSERT ... ON CONFLICT (summary_date) DO NOTHING` belt-and-suspenders pattern. Re-running consolidation for an already-summarized date is a silent no-op. (Phase 21 Plan 04, 2026-04-18 — pre-flight at L209 returns `{ skipped: 'existing' }` 99% of the time without any Sonnet call; ON CONFLICT at L285–298 catches the residual race window between SELECT and INSERT and returns `{ skipped: 'existing' }` via empty `returning()` array detection. Test 2 covers pre-flight; Test 3 covers retry path; both confirm exactly 1 row persists.)
- [x] **CONS-04**: M006 constitutional preamble explicitly injected into the consolidation system prompt (cron runs outside the engine; preamble does NOT auto-apply). Asserted by a unit test that the assembled prompt contains the preamble's anti-sycophancy clauses (D024). (Phase 21 Plan 01, 2026-04-18 — seed: `CONSTITUTIONAL_PREAMBLE` exported from `src/chris/personality.ts` with 4 covering assertions in `src/chris/__tests__/personality.test.ts`. Phase 21 Plan 02, 2026-04-18 — closed end-to-end: `assembleConsolidationPrompt(input).startsWith(CONSTITUTIONAL_PREAMBLE.trimEnd())` asserted by Test 3 in `src/episodic/__tests__/prompts.test.ts`; Tests 1 & 2 also assert D024 Three Forbidden Behaviors marker and D027 Hard Rule clause appear in the assembled prompt.)
- [x] **CONS-05**: Importance rubric anchored at four bands (1–3 mundane / 4–6 notable / 7–9 significant / 10 life-event-rare) with explicit frequency distribution guidance ("most days are 3–6; 7+ should be uncommon") and chain-of-thought instruction ("explain emotional intensity, novelty, decision presence, contradiction presence before assigning the score"). (Phase 21 Plan 02, 2026-04-18 — `buildImportanceRubric()` in `src/episodic/prompts.ts` emits all four band anchors, frequency guidance, and the chain-of-thought instruction enumerating the four dimensions; Tests 4–8 assert each anchor verbatim.)
- [x] **CONS-06**: Decision floor hook — if any structural-stakes decision was created OR resolved on the consolidation date (per M007 `decisions` table), importance score is floored at 6. Enforced in the prompt and asserted by fixture test. (Phase 21 Plan 02, 2026-04-18 — prompt-layer: `buildDecisionAndFloorBlock()` emits the "importance score MUST be at least 6" clause when `decisions.length > 0`; Test 12 asserts verbatim. Phase 21 Plan 04, 2026-04-18 — runtime closure: `if (hasRealDecision) importance = Math.max(importance, 6)` at L256 of consolidate.ts, where `hasRealDecision = decisions.some(d => (d.createdToday || d.resolvedToday) && REAL_DECISION_STATES.has(d.lifecycleState))` and `REAL_DECISION_STATES = Set(['open','due','resolved','reviewed'])` correctly excludes withdrawn/stale/abandoned/open-draft. Test 5 covers positive (open decision today, importance=3 → row=6); Test 6 covers boundary negative (withdrawn decision today, importance=3 → row=3, NOT clamped).)
- [x] **CONS-07**: Contradiction floor hook — if M002 detected any contradiction (`confidence >= 0.75`) on the consolidation date, importance score is floored at 7. Enforced in the prompt and asserted by fixture test. (Phase 21 Plan 02, 2026-04-18 — prompt-layer: `buildDecisionAndFloorBlock()` emits the "importance score MUST be at least 7" clause when `contradictions.length > 0`; Test 13 asserts verbatim. Phase 21 Plan 04, 2026-04-18 — runtime closure: `if (contradictions.length > 0) importance = Math.max(importance, 7)` at L257 of consolidate.ts. Test 7 covers single floor (1 contradiction + importance=4 → row=7); Test 8 covers combined CONS-06 + CONS-07 (real decision + contradiction + importance=2 → row=7 = max of 6, 7).)
- [x] **CONS-08**: M007 decisions read-only integration — `getDecisionsForDay(date)` queries `decisions` directly (no decisions module API calls); injects each decision's reasoning, forecast, lifecycle_state, and outcome (if resolved) into the consolidation prompt. (Phase 21 Plan 02, 2026-04-18 — prompt-layer: `buildDecisionAndFloorBlock()` renders `decisionText`, `reasoning`, `prediction`, `falsificationCriterion`, `lifecycleState`, and `resolution`/`resolutionNotes` when non-null; Test 14 asserts each substring. Phase 21 Plan 03, 2026-04-18 — DB-read side closed: `getDecisionsForDay(date, tz)` exported from `src/episodic/sources.ts`; queries `decisions` directly via Drizzle, returns rows captured OR resolved that day with `createdToday`/`resolvedToday` flags and full lifecycle data; filters `'open-draft'` per Phase 14 D-15; `grep -c "from '../decisions/" src/episodic/sources.ts` → 0 confirms boundary; Tests 7–11 cover all lifecycle combinations.)
- [x] **CONS-09**: M002 contradictions read-only integration — flagged contradiction pairs injected into the consolidation prompt with explicit "preserve both positions verbatim, do not smooth into resolved arc" instruction (D031, PRD §12). (Phase 21 Plan 02, 2026-04-18 — `buildContradictionBlock()` emits the "Preserve both positions verbatim. Do not smooth them into a single resolved arc." clause verbatim and renders each contradiction's `entryAContent` + `entryBContent` + `description`; Test 10 positive case asserts all three substrings, Test 11 negative case asserts the block is absent when `contradictions.length === 0`. Phase 21 Plan 03, 2026-04-18 — DB-read side closed: `getContradictionsForDay(date, tz)` exported from `src/episodic/sources.ts`; uses `alias(pensieveEntries, 'entry_a')` + `alias(..., 'entry_b')` dual JOIN to fetch both contradicting positions verbatim; status='DETECTED' filter for "flagged" semantics; Tests 5 + 6 assert JOIN content fidelity and status filter.)
- [x] **CONS-10**: `key_quotes` verbatim enforcement — prompt forbids paraphrase ("each entry in key_quotes must be a verbatim substring of an entry from the day"). Asserted in the fixture by exact-substring match against source entries. (Phase 21 Plan 02, 2026-04-18 — `buildVerbatimQuoteClause()` emits the exact anchor phrase; Test 9 asserts verbatim.)
- [x] **CONS-11**: Sparse-entry guard — when the day has fewer than 3 entries OR fewer than 100 total content tokens, the prompt switches to a low-content variant that explicitly forbids inferring specifics not present in the entries. Asserted by fixture test on a 1-entry day (no hallucinated specifics). (Phase 21 Plan 02, 2026-04-18 — `isSparseDay(input)` derives the mode from `entries.length < 3 OR totalContentChars < 400` (≈100 tokens at 4 chars/token); `buildSparseEntryGuard()` emits the "You may only state what is explicitly present in the source entries" clause; Tests 15 (count threshold), 16 (token threshold), 17 (dense negative) cover both trigger conditions + the dense-day absence.)
- [x] **CONS-12**: Failure notification — if Sonnet returns an error or Zod parse fails after retry, the existing `notifyError()` pattern surfaces a Telegram notification to Greg with the date and error class. No silent failures. (Phase 21 Plan 04, 2026-04-18 — `notifyConsolidationError(date, error)` in `src/episodic/notify.ts` mirrors the `src/sync/scheduler.ts::notifyError` pattern: ERROR-level log first (durable record), then `try { bot.api.sendMessage(...) } catch { log }` — never re-throws. Wired at top-level catch in `runConsolidate` (L320). Format: "⚠️ Episodic consolidation failed for YYYY-MM-DD\n{ErrorClass}: {message}" with date in `config.proactiveTimezone`. Test 9 covers Sonnet rate-limit (sendMessage called once with both date + error message); Test 10 covers retry success (no notify on recovery); Test 11 covers notify-itself-throws (still returns failed cleanly, no exception escapes); Test 12 covers schema-validation failure (out-of-range importance → notify + failed).

### Cron / Scheduling

- [ ] **CRON-01**: Independent `cron.schedule(config.episodicCron, runConsolidateYesterday, { timezone: config.proactiveTimezone })` registered in `src/index.ts` alongside the existing proactive sweep and source sync crons. NOT nested inside `runSweep`. Default fires at 23:00 same-day in Greg's configured timezone.
- [ ] **CRON-02**: DST safety — cron uses `node-cron`'s built-in timezone option (UTC-internal arithmetic). Spring-forward (23:00 occurs once) and fall-back (23:00 occurs once) both produce exactly one consolidation per calendar date. Asserted by fixture test simulating the DST transition.

### Retrieval Routing

- [ ] **RETR-01**: `getEpisodicSummary(date: Date)` and `getEpisodicSummariesRange(from: Date, to: Date)` exported from `src/pensieve/retrieve.ts`. Both timezone-aware in `config.proactiveTimezone`.
- [ ] **RETR-02**: Two-dimensional retrieval routing in `retrieveContext` — recency boundary (≤7 days from today → raw entries always; >7 days → summary first) AND query-intent escape (verbatim-fidelity queries detected via keyword fast-path: "exactly", "verbatim", "what did I say", "exact words" + EN/FR/RU equivalents → raw always regardless of age). Routing decision logged for diagnostic visibility.
- [ ] **RETR-03**: High-importance raw descent — when a >7-day-old summary with `importance >= 8` matches the query, the source raw entries (via `source_entry_ids`) are also retrieved and surfaced alongside the summary. Asserted by fixture test on an importance-9 day.
- [ ] **RETR-04**: INTERROGATE mode date-anchored summary injection — when the user asks about a period >7 days ago (e.g., "what was happening 3 weeks ago", "April 1st"), `src/chris/modes/interrogate.ts` injects matching episodic summaries into the context block. Date extraction uses regex/keyword fast-path first, Haiku classifier only as fallback if regex fails.
- [ ] **RETR-05**: Summary text NEVER enters the Known Facts block — D031 separates structured facts from interpretation; episodic summaries are interpretation. Audit during this requirement: grep `src/pensieve/known-facts.ts` (or equivalent) for any JOIN to `episodic_summaries`; assert none exist.
- [ ] **RETR-06**: Summary text NEVER embedded into `pensieve_embeddings` — preserves raw-entry semantic search fidelity. Asserted by inspection: no INSERT into `pensieve_embeddings` references `episodic_summaries`.

### User-Facing Commands

- [ ] **CMD-01**: `/summary [YYYY-MM-DD]` Telegram command implemented in the bot. With no argument, returns yesterday's summary. With a date, returns that date's summary. If no summary exists for the date (zero entries that day OR future date), responds with a clear "no summary for that date" message. Wired before the generic text handler (per M007 pattern).

### Operations & Backfill

- [ ] **OPS-01**: `scripts/backfill-episodic.ts` operator script with `--from YYYY-MM-DD --to YYYY-MM-DD` arguments. Calls `runConsolidate` day-by-day sequentially with 2-second delay between days (rate limiting). Idempotent by design (CONS-03 skips already-summarized days). Logs progress per day. Resumable on crash via the same idempotent skip.

### Test Coverage

- [ ] **TEST-15**: 14-day synthetic fixture in `src/episodic/__tests__/synthetic-fixture.test.ts` using `vi.setSystemTime` to simulate calendar progression. Generates Pensieve entries spanning the full importance range with pre-labeled ground-truth importance scores. Each day's entries include realistic mix of types (FACT, RELATIONSHIP, INTENTION, EMOTION, etc.).
- [ ] **TEST-16**: Importance correlation assertion — Pearson correlation between Sonnet-assigned scores and pre-labeled ground-truth across the 14 days satisfies `r > 0.7`. Test fails loudly with the actual r value and per-day breakdown so calibration drift is diagnosable.
- [ ] **TEST-17**: Recency routing correctness — fixture asserts: ≤7-day query returns raw; >7-day query returns summary; verbatim-fidelity keyword query (e.g., "what exactly did I say") returns raw regardless of age; importance-9 day returns BOTH summary AND raw entries.
- [ ] **TEST-18**: DST simulation — fixture spans a spring-forward boundary (e.g., simulated March 12, 2026 in `America/Los_Angeles`); asserts exactly one consolidation per calendar date; no missing or duplicated rows at the boundary.
- [ ] **TEST-19**: Idempotency retry — calls `runConsolidate(2026-04-15)` twice; asserts the second call is a silent no-op (no Sonnet call, no DB write, returns `{ skipped: true }`).
- [ ] **TEST-20**: Decision-day floor — fixture day with a structural decision created/resolved produces a summary with `importance >= 6` regardless of other content (CONS-06 enforcement).
- [ ] **TEST-21**: Contradiction-day dual-position — fixture day with a flagged M002 contradiction produces a summary that mentions both contradicting positions verbatim (assert both positions appear as substrings in `summary` or `key_quotes`); does NOT collapse into a resolved narrative.
- [ ] **TEST-22**: Live integration — anti-flattery resistance against real Sonnet (3-of-3 runs, gated on `ANTHROPIC_API_KEY` per D023/D032 precedent). Adversarial fixture day designed to bait flattering language ("Greg made a brilliant decision today, demonstrating his characteristic wisdom"); assert generated summary contains none of the forbidden flattery markers.

## Future Requirements

Deferred from M008. Tracked but not in current roadmap.

### Episodic-tier extensions

- **EPI-FUTURE-01**: `/resummary YYYY-MM-DD` command to regenerate a day's summary after a prompt iteration. Add when first requested. Currently the no-auto-replace invariant is a feature, not a bug.
- **EPI-FUTURE-02**: `episodic_embeddings` table (separate from `pensieve_embeddings` per RETR-06). Added in M010 if profile inference needs to semantically search summaries.
- **EPI-FUTURE-03**: Traveling-mode timezone override — temporary `config.proactiveTimezone` switch when Greg is in a different timezone for >2 days. Defer until first travel scenario.
- **EPI-FUTURE-04**: Late-arriving entry recovery — automatic re-consolidation when source-stream entries (Gmail/Drive sync) land >2 hours after the day's consolidation. Currently late entries belong in next day's narrative by design (cron timing decision).

## Out of Scope

Explicitly excluded for M008. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Auto-replace summaries on re-run | Violates D004 append-only spirit. Re-summarization is an explicit operator action via `/resummary` (deferred) or backfill script (which respects existing rows via CONS-03). |
| Embedding summary text into `pensieve_embeddings` | Pollutes raw-entry semantic search by competing with verbatim entries. Summary embeddings, if needed, ship in a separate table (EPI-FUTURE-02). |
| Summary text in Known Facts block | Summaries are interpretation, not fact. D031 separates structured facts from prose. RETR-05 enforces this boundary. |
| Weekly / monthly / quarterly summary generation | Belongs to M009 (weekly review) and M013 (monthly + quarterly rituals) per the soul-system roadmap. M008 is daily-only. |
| Versioned summaries | Single row per `summary_date`. Versioning would require additional infrastructure with no current value. |
| Anthropic Batch API for the daily cron | 24-hour async window is wrong for nightly cron that must confirm success. Batch API is appropriate only for ≥14-day historical backfill, deferred until needed. |
| Whisper voice transcription | Already deferred per PROJECT.md. M008 does not change this. |
| Multi-user support | D009 — Chris serves one user only. M008 does not change this. |
| New conversational mode for episodic content | Episodic content is surfaced through INTERROGATE (RETR-04) and `/summary` (CMD-01). No new mode in `src/chris/engine.ts`. |
| Auto-generated topic taxonomy | Topics are extracted free-form by Sonnet per day. Cross-day taxonomy normalization belongs to M010 profile inference. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TD-01 | Phase 20 | ✅ Complete (Plan 01, 2026-04-18) |
| EPI-01 | Phase 20 | ✅ Complete (Plan 02, 2026-04-18) |
| EPI-02 | Phase 20 | ✅ Complete (Plan 02, 2026-04-18) |
| EPI-03 | Phase 20 | ✅ Complete (Plan 02, 2026-04-18) |
| EPI-04 | Phase 20 | ✅ Complete (Plan 02, 2026-04-18) |
| CONS-01 | Phase 21 | ✅ Complete (Plan 04, 2026-04-18) |
| CONS-02 | Phase 21 | ✅ Complete (Plan 04, 2026-04-18) |
| CONS-03 | Phase 21 | ✅ Complete (Plan 04, 2026-04-18) |
| CONS-04 | Phase 21 | ✅ Complete (Plan 01 seed, 2026-04-18; Plan 02 end-to-end closure, 2026-04-18) |
| CONS-05 | Phase 21 | ✅ Complete (Plan 02, 2026-04-18) |
| CONS-06 | Phase 21 | ✅ Complete (Plan 02 prompt layer, Plan 04 runtime clamp, 2026-04-18) |
| CONS-07 | Phase 21 | ✅ Complete (Plan 02 prompt layer, Plan 04 runtime clamp, 2026-04-18) |
| CONS-08 | Phase 21 | ✅ Complete (Plan 02 prompt layer, Plan 03 DB-read side, 2026-04-18) |
| CONS-09 | Phase 21 | ✅ Complete (Plan 02 prompt layer, Plan 03 DB-read side, 2026-04-18) |
| CONS-10 | Phase 21 | ✅ Complete (Plan 02, 2026-04-18) |
| CONS-11 | Phase 21 | ✅ Complete (Plan 02, 2026-04-18) |
| CONS-12 | Phase 21 | ✅ Complete (Plan 04, 2026-04-18) |
| CRON-01 | Phase 22 | Pending |
| CRON-02 | Phase 22 | Pending |
| RETR-01 | Phase 22 | Pending |
| RETR-02 | Phase 22 | Pending |
| RETR-03 | Phase 22 | Pending |
| RETR-04 | Phase 22 | Pending |
| RETR-05 | Phase 22 | Pending |
| RETR-06 | Phase 22 | Pending |
| CMD-01 | Phase 23 | Pending |
| OPS-01 | Phase 23 | Pending |
| TEST-15 | Phase 23 | Pending |
| TEST-16 | Phase 23 | Pending |
| TEST-17 | Phase 23 | Pending |
| TEST-18 | Phase 23 | Pending |
| TEST-19 | Phase 23 | Pending |
| TEST-20 | Phase 23 | Pending |
| TEST-21 | Phase 23 | Pending |
| TEST-22 | Phase 23 | Pending |
