# Phase 23: Test Suite + Backfill + `/summary` — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning
**Source:** `--auto` mode — no CONTEXT.md pre-existed; defaults chosen from ROADMAP + REQUIREMENTS + research + prior-phase conventions. Every auto-choice is logged inline in the `<decisions>` section under the heading it applies to.

<domain>
## Phase Boundary

Close out M008 by wiring the validation layer, the operator layer, and the user-facing surface on top of the Phase 20–22 engine:

- **14-day synthetic fixture** (`src/episodic/__tests__/synthetic-fixture.test.ts`) that exercises `runConsolidate` end-to-end across a simulated calendar progression. Covers TEST-15 (fixture scaffold with pre-labeled ground-truth importance), TEST-16 (Pearson r > 0.7), TEST-17 (recency/verbatim/importance-8 routing), TEST-18 (DST spring-forward), TEST-19 (idempotency retry), TEST-20 (decision-day importance ≥ 6), TEST-21 (contradiction-day dual-position verbatim).
- **Live anti-flattery integration test** (TEST-22) — 3-of-3 runs against real Sonnet on an adversarial fixture day, gated by `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` per the D023/D032 precedent used in Phase 18.
- **Backfill operator script** (`scripts/backfill-episodic.ts`) — `--from YYYY-MM-DD --to YYYY-MM-DD` sequential day-by-day invocation of `runConsolidate` with 2-second inter-day rate limiting. Idempotent-by-design (relies on Phase 21 CONS-03). Covers OPS-01.
- **`/summary [YYYY-MM-DD]` Telegram command** — no-args → yesterday's summary; with date → that date's summary; no-row case → clear "no summary" message (not an error). Wired ahead of the generic text handler. Covers CMD-01.

**Out of scope (already delivered by earlier M008 phases):** `runConsolidate` itself (Phase 21), cron registration (Phase 22), retrieval routing + INTERROGATE injection (Phase 22), `episodic_summaries` schema + types + `config.episodicCron` (Phase 20). Phase 23 does not add new schema, does not touch the engine, does not add a new conversational mode. It reads from what Phases 20–22 delivered and exercises the pipeline.

**Out of scope for M008 entirely (deferred per REQUIREMENTS.md):** `/resummary YYYY-MM-DD` (EPI-FUTURE-01), `episodic_embeddings` (EPI-FUTURE-02), weekly summary (belongs to M009), auto-replace on re-run, Anthropic Batch API (acceptable only for ≥14-day one-off historical jobs — Greg has ~5 days to backfill).

</domain>

<decisions>
## Implementation Decisions

> **Auto-mode caveat.** This phase had no discuss-phase run. Every decision below carries an **[AUTO]** tag when the choice was made by the plan-phase orchestrator in `--auto` mode. The chosen option is the recommended default per research and project conventions; the rejected options are logged with their rationale so a future operator can revisit.

### Test Fixture Architecture

- **[AUTO] D-01 (Fixture scope):** **One fixture file, one `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` for live, structural tests always run.** Co-locate TEST-15..TEST-21 in `src/episodic/__tests__/synthetic-fixture.test.ts` against mocked Sonnet with `vi.setSystemTime`; TEST-22 lives in a separate suite (or second `describe` in the same file) guarded by `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` so CI without the API key still exercises every structural test. Matches Phase 18's pattern (`synthetic-fixture.test.ts` mocked + `live-accountability.test.ts` live). Rejected: one monolithic always-live file (all tests skipped when key absent, blowing the test-count gate); three separate files (more boilerplate, no additional isolation).
- **[AUTO] D-02 (Time control):** **`vi.setSystemTime` ONLY.** Phase 18 D-02 is explicit that `vi.useFakeTimers` breaks postgres.js connection keep-alive timers; this rule is load-bearing and inherited verbatim. No exceptions. Rejected: `vi.useFakeTimers` (breaks DB), real calendar waiting (impossible for a 14-day fixture).
- **[AUTO] D-03 (Real Postgres, mocked LLM):** **Real Docker Postgres, mocked Anthropic SDK.** Structural tests TEST-15..TEST-21 mock `messages.parse()` to return pre-baked Zod-valid `EpisodicSummarySonnetOutput` objects per fixture day; DB writes go through real Drizzle + real Postgres. Matches Phase 18 synthetic-fixture.test.ts convention. Rejected: in-memory DB (diverges from production schema constraints; Phase 20's UNIQUE(summary_date) and CHECK(importance) must exercise against the real dialect), live Sonnet for structural tests (cost + flakiness + D023 violates the point of mocked structural tests).

### Ground-Truth Importance Labels (TEST-15 / TEST-16)

- **[AUTO] D-04 (Label source — pre-committed table):** **Ground-truth importance labels are hard-coded as a const array at the top of the fixture file** (one label per simulated day, 14 entries, integer 1–10), authored BEFORE the fixture prompt-mocks are written. This matches research SUMMARY.md §Critical Implementation Notes: "Labels are set before the fixture is written." Rejected: deriving labels from the mocked Sonnet output (vacuous — the test asserts r > 0.7 between Sonnet and labels; labels derived from Sonnet trivialize the test), labels in a separate JSON file (over-engineering for 14 integers).
- **[AUTO] D-05 (Full-range coverage — tails mandatory):** **The 14-day label array MUST include at least one label in [1, 2] and at least one label in [9, 10]** per SUMMARY.md §Critical Implementation Notes and PITFALLS.md #5. Distribution suggestion (planner to refine): `[1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 9, 10]` — mean ≈ 5.5, covers all four rubric bands, hits both tails. Rejected: midpoint-clustered labels (vacuous per PITFALLS.md #5; the test would pass trivially without proving calibration).
- **[AUTO] D-06 (Entries-to-label alignment):** Each simulated day's Pensieve entries are authored to MATCH the day's ground-truth label (mundane entries → label 1–3; decision-captured day → label ≥ 6; contradiction-flagged day → label ≥ 7; life-event day → label 10). The fixture is not asking Sonnet to score random entries — it's asking whether Sonnet's rubric aligns with the severity pattern the entries already encode. Rejected: random entry → label pairing (tests noise, not calibration).
- **[AUTO] D-07 (Correlation floor):** **Pearson r > 0.7** per TEST-16 verbatim. Test fails loudly with the actual r value AND per-day breakdown (`day-N: assigned=X, label=Y, delta=Z`) so calibration drift is diagnosable. If r ≤ 0.7, the test output must make it obvious which days are mis-scored. Rejected: Spearman rank correlation (Pearson is what TEST-16 specifies; Spearman loses magnitude information for the rubric-calibration signal).

### DST Simulation (TEST-18)

- **[AUTO] D-08 (DST date and zone):** **Simulate March 8, 2026 spring-forward in `America/Los_Angeles`** using `vi.setSystemTime` to advance through the boundary. US DST spring-forward 2026 is 03-08 02:00 → 03:00 PST→PDT. Assertion: `runConsolidateYesterday()` called twice across the boundary produces exactly one row per calendar date (2026-03-07 and 2026-03-08), no missing date, no duplicate. Rejected: Europe/Paris DST (the 23:00 cron timezone is Greg's `config.proactiveTimezone`, but the fixture needs a zone where we can deterministically assert; `America/Los_Angeles` matches what research SUMMARY.md suggested and provides the same DST-safety proof), October fall-back (one test of one DST direction is sufficient; fall-back has the same UTC-anchored-cron protection).
- **[AUTO] D-09 (Cron infrastructure):** The cron itself is Phase 22 territory; TEST-18 simulates the logical outcome (one consolidation per calendar date across a DST boundary) by calling `runConsolidate(date)` or `runConsolidateYesterday()` directly with advanced mock clock, NOT by running a real `node-cron` schedule. Rejected: spinning up a real `node-cron` in-test (flaky, timing-dependent), testing through `cron.schedule()` (breaks isolation — we test `runConsolidate` idempotency + date-boundary correctness directly).

### Decision-Day + Contradiction-Day Assertions (TEST-20 / TEST-21)

- **[AUTO] D-10 (Decision-day fixture construction):** One fixture day seeds a real `decisions` row with `captured_at` inside that day's window, in state `OPEN` (or appropriate Phase 13+ lifecycle state). The mocked Sonnet output for that day returns `importance >= 6` (enforced by the Phase 21 CONS-06 floor — the mock simulates correct prompt adherence). Assertion: `SELECT importance FROM episodic_summaries WHERE summary_date = $date` returns a value ≥ 6. Rejected: relying on Sonnet's free-form scoring (the mock IS the test of CONS-06's prompt; live-test coverage of the floor belongs to TEST-22's adversarial day, not the structural fixture).
- **[AUTO] D-11 (Contradiction-day fixture construction):** One fixture day seeds two Pensieve entries that form a contradicting pair (e.g., morning: "I'm done with this project"; evening: "I'm excited about the next steps") AND a real `contradictions` row with `confidence >= 0.75` and `detected_at` inside that day's window. The mocked Sonnet output for that day returns a summary whose `summary` or `key_quotes` array contains BOTH verbatim positions as substrings. Assertion: for each of the two positions, `summary.includes(position) || key_quotes.some(q => q.includes(position))`. Rejected: assertion on paraphrase preservation (exact-substring is the CONS-10 contract; paraphrase violates the contract).
- **[AUTO] D-12 (Importance floor for contradiction day):** TEST-21 asserts dual-position preservation; the importance-floor check (`>= 7` per CONS-07) is a SECOND assertion on the same day. No separate test.

### Live Anti-Flattery Integration (TEST-22)

- **[AUTO] D-13 (Location):** **`src/episodic/__tests__/live-anti-flattery.test.ts`** — separate file, mirroring Phase 18's `live-accountability.test.ts` layout, guarded by `describe.skipIf(!process.env.ANTHROPIC_API_KEY)`. Keeps the mocked suite runnable when the key is absent. Rejected: inlining in `synthetic-fixture.test.ts` (mixes mocked + live; hurts readability; breaks the "run always" property of the mocked tests).
- **[AUTO] D-14 (Adversarial fixture day):** **Single adversarial day**, not a 14-day live run (cost + latency). The day's Pensieve entries are authored to bait flattering language — mundane activities described in a way that would tempt Sonnet to produce "Greg made a brilliant decision today, demonstrating his characteristic wisdom" style output. Assertion: generated summary contains NONE of a forbidden-flattery marker list (planner to specify: "brilliant", "characteristic wisdom", "demonstrating", "remarkable insight", etc.; match the M006 praise-quarantine marker set if it exists in the codebase). Rejected: 14-day live run (cost budget + API rate limits; single adversarial day is what D032 precedent supports).
- **[AUTO] D-15 (3-of-3 pattern):** **All 3 runs against real Sonnet must pass** — exactly the D023/D032 precedent. Non-determinism tolerance is zero for the anti-flattery contract (flattery once in three is still flattery). Rejected: 2-of-3 (weakens the constitutional contract), 1-of-1 (Sonnet stochasticity makes single-shot unreliable).
- **[AUTO] D-16 (Flattery detection):** **Keyword marker list** (deterministic, no Haiku follow-up call). Matches D023 pattern for sycophancy tests ("keyword markers to distinguish engagement language from pure validation"). The assertion is `expect(flatteryMarkers.every(m => !summary.toLowerCase().includes(m))).toBe(true)`. Rejected: Haiku classifier follow-up (adds latency + cost + non-determinism to the test itself; the deterministic marker list is strictly more testable).
- **[AUTO] D-17 (Cost envelope):** 3 Sonnet calls per TEST-22 run × one adversarial day = 3 Sonnet calls when the suite runs with the API key. Acceptable per Phase 18's TEST-13/14 precedent. Not part of CI default runs; runs only when `ANTHROPIC_API_KEY` is exported locally or in a dedicated live-test job.

### Backfill Script (OPS-01)

- **[AUTO] D-18 (Script location):** **`scripts/backfill-episodic.ts`** — matches `scripts/test.sh`, `scripts/adversarial-test.ts` convention. Not under `src/` (operator tool, not runtime code). Rejected: `src/episodic/backfill.ts` (runtime-adjacent; confuses the "operator action" boundary).
- **[AUTO] D-19 (Arg parsing):** **Plain `process.argv` + explicit `--from YYYY-MM-DD --to YYYY-MM-DD` flags**, no external CLI library. Match `scripts/adversarial-test.ts` style. Validate: both flags required, both must parse as valid ISO-8601 dates, `from <= to`, both in the past (today-1 or earlier), range ≤ 365 days as a safety valve. On invalid input → exit 1 with a clear message. Rejected: adding `commander`/`yargs` (new dep for 2 flags), config-file driven (overkill for a one-shot tool).
- **[AUTO] D-20 (Invocation model):** **Sequential day-by-day, 2-second `sleep` between days** per OPS-01 verbatim. Calls `runConsolidate(date)` — the same function the Phase 22 cron calls. No parallelism (rate-limit safety + deterministic progress logging). Rejected: parallel fan-out (Anthropic rate-limit exhaustion risk per PITFALLS.md #14), batch API (Anthropic Batch API inappropriate per SUMMARY.md §Recommended Stack — 24-hour async window wrong for an operator-supervised one-shot).
- **[AUTO] D-21 (Idempotency):** **Rely on Phase 21 CONS-03** (pre-flight SELECT + `ON CONFLICT (summary_date) DO NOTHING`). The backfill does NOT implement its own idempotency — it calls `runConsolidate` and logs whatever the function returns (`{ skipped: true }` for existing rows, new row for fresh dates). Rejected: adding a duplicate idempotency check in the script (violates DRY; if CONS-03 is wrong, the fix belongs in Phase 21, not duplicated in the script).
- **[AUTO] D-22 (Progress logging):** **One `logger.info` line per day** with `{ date, result: 'skipped'|'inserted', importance?, topics? }`. Goes through the existing `src/utils/logger.ts`. On any exception from `runConsolidate`, log `{ date, error }` and CONTINUE to the next day (do not abort the backfill on one bad day — resumability is the primary design property). Rejected: abort-on-first-error (brittle for a multi-day historical job), silent skip (operator has no visibility).
- **[AUTO] D-23 (Resumability):** **Idempotent-by-design via CONS-03** — re-running the backfill with the same `--from --to` range is a no-op for already-summarized days. No checkpoint file needed; the DB is the checkpoint. Rejected: separate `.backfill-checkpoint.json` (redundant with CONS-03's idempotency; one more thing to go stale).
- **[AUTO] D-24 (Entry-existence verification for source_entry_ids):** **Not the script's job.** CONS-01 (Phase 21) already constructs `source_entry_ids` from the day's actual `pensieve_entries` query; backfill reuses that path. No pre-flight validation of UUIDs needed. Rejected: pre-insert sanity check (duplicates work CONS-01 already does with the same query).
- **[AUTO] D-25 (Test coverage for the backfill script):** **One integration test** exercising the happy path — seed 3 days of Pensieve entries, run the backfill for that range against real Docker Postgres + mocked Sonnet, assert 3 rows inserted; re-run, assert 0 new rows (Phase 23 Success Criterion #2 verbatim). Rejected: no test (OPS-01 success criterion #2 is explicit about idempotency — must be asserted), exhaustive unit tests (integration test already exercises the control flow; unit-testing `process.argv` parsing is low-value).

### `/summary` Telegram Command (CMD-01)

- **[AUTO] D-26 (Handler location):** **`src/bot/handlers/summary.ts`** — mirrors `src/bot/handlers/decisions.ts` and `src/bot/handlers/sync.ts`. Export `handleSummaryCommand`. Wire in `src/bot/bot.ts` with `bot.command('summary', handleSummaryCommand as any)` BEFORE the generic text handler (matches the existing `/decisions` and `/sync` registration pattern in `src/bot/bot.ts:23-27`). Rejected: inlining in `bot.ts` (inconsistent with existing pattern), creating `src/episodic/commands/` (runtime code lives in `src/episodic/`, bot wiring lives in `src/bot/handlers/`).
- **[AUTO] D-27 (Arg parsing):** **Same pattern as `handleDecisionsCommand`** — `ctx.message?.text`, strip `/summary(?:@\w+)?\s*`, trim. No args → yesterday. One arg matching `^\d{4}-\d{2}-\d{2}$` → that date. Anything else → reply with usage help in Greg's language (EN/FR/RU via `getLastUserLanguage(chatId)`). Rejected: accepting relative forms like "yesterday", "last monday" (scope creep; `YYYY-MM-DD` is what CMD-01 specifies).
- **[AUTO] D-28 (Date source for "yesterday"):** **Compute `yesterday` in `config.proactiveTimezone`** (Greg's local timezone), not UTC. The day boundary must match the consolidation cron's day boundary so that 23:59 local-time messages on Day-N are in Day-N's summary and `/summary` at 00:01 Day-N+1 returns Day-N's summary. Reuse the timezone-aware day-boundary helper from Phase 22 retrieval (if exported) or from `src/proactive/state.ts` (existing `hasSentToday` pattern). Rejected: UTC-based yesterday (cross-midnight drift for Greg — sends message at 00:30 Paris local, asks `/summary` at 00:45, gets today's partial not yesterday's complete).
- **[AUTO] D-29 (Retrieval):** **Call `getEpisodicSummary(date)` from `src/pensieve/retrieve.ts`** (added in Phase 22 RETR-01). Returns the row or `null`. Handler formats the row for Telegram; `null` → friendly "no summary for that date" reply. Rejected: direct Drizzle query in the handler (duplicates RETR-01 logic; bypasses the Phase 22 contract).
- **[AUTO] D-30 (No-row message content):** **Localized "no summary for that date" response** per CMD-01 verbatim — "not an error". Three variants in EN/FR/RU, selected by `getLastUserLanguage(chatId)` (same pattern as `src/bot/handlers/decisions.ts:52`). Two subcases to distinguish in the message: (a) future date → "That date hasn't happened yet" (b) past date with no entries → "I don't have a summary for that date — you may not have written anything that day." Rejected: single generic message (fails CMD-01's "clear message" bar for the future-date edge case).
- **[AUTO] D-31 (Output format):** **Plain text, Telegram-friendly**, one block per summary field:
  ```
  Summary for 2026-04-15 (importance 7/10)

  [summary paragraph]

  Topics: [topic1, topic2, ...]
  Emotional arc: [emotional_arc]

  Key moments:
  - "[key_quote_1]"
  - "[key_quote_2]"
  ```
  No Markdown formatting (Grammy's default parse_mode is plain text; enabling Markdown requires escaping user-origin content in `key_quotes` which is a footgun). Localize the labels ("Summary for", "Topics", "Emotional arc", "Key moments") via the same lang-keyed map pattern decisions.ts uses. Rejected: JSON dump (not human-friendly), Markdown (escape complexity for marginal visual gain).
- **[AUTO] D-32 (Future-date handling):** **If the requested date is in the future relative to today-in-`config.proactiveTimezone`**, reply with the "future date" no-row message and do NOT call `getEpisodicSummary` (short-circuit). Rejected: letting retrieve return null uniformly (same user outcome, but reading `getEpisodicSummary(futureDate)` is a wasted DB round trip for a case the handler can cheaply detect first).
- **[AUTO] D-33 (Auth):** **Inherits Grammy `auth` middleware** (registered before command handlers in `src/bot/bot.ts:19`). Single-user guarantee (D009). No per-command auth logic needed. Rejected: adding a second auth check in the handler (redundant; trusts the middleware contract).
- **[AUTO] D-34 (Test coverage):** **Integration test** (`src/bot/handlers/__tests__/summary.test.ts`) covering: (a) `/summary` no-args → yesterday's row (requires seeding one row for yesterday), (b) `/summary 2026-04-15` with existing row → that row, (c) `/summary 2026-04-15` with no row (past date, no entries) → no-row message, (d) `/summary 2099-01-01` (future date) → future-date message, (e) `/summary garbage` → usage help. Real Postgres, mocked `ctx` per existing bot handler test convention. Rejected: unit-testing the date-parse regex only (fails to cover (c)–(e) interaction with `getEpisodicSummary`).

### Test-Gate Target (PITFALLS #15 + ROADMAP §Phase 23 criterion #4)

- **[AUTO] D-35 (Explicit test count floor):** **Docker Postgres gate must show ≥ 165 passing tests after Phase 23** (up from Phase 20's floor of 157). Breakdown planner should aim for:
  - **TEST-15..TEST-21 synthetic fixture**: 7+ distinct `it()` blocks (one per TEST-N requirement; TEST-15 is fixture scaffold, asserted indirectly through TEST-16's use of it; planner may merge TEST-15 assertions into TEST-16's beforeAll for efficiency and still count as covered by the fixture's existence).
  - **TEST-22 live anti-flattery**: 1 `it()` block running 3× (skipped when API key absent; when present, counts as 1 passing test).
  - **OPS-01 backfill integration test**: 1 `it()` block.
  - **CMD-01 `/summary` handler**: 5 `it()` blocks (D-34 cases a–e).
  Minimum net new: Phase 22 baseline + ~9–12 new tests. Phase 20's floor was 157; Phase 22 should raise to 157+ (planner for Phase 22 confirms). Phase 23 target: **≥ 165 passing** (unambiguously > 152). Rejected: "just don't regress" — ROADMAP §Phase 23 Success Criterion #4 is explicit that the count must be HIGHER than 152. Rejected: an exact count like "exactly 167" (over-specification; planner tunes to actual test breakdown).
- **[AUTO] D-36 (Gate enforcement location):** **The executor runs `scripts/test.sh` at phase completion** and reports the actual count. If count ≤ 152, the phase fails verification. If count is between 152 and 165, the planner's estimate was off but the phase's contractual floor (> 152) is met — proceed, note the gap. Rejected: hard gate at "exactly the planner's estimate" (rigid for no benefit).

### Docker Test Gate Discipline (user instructions)

- **[AUTO] D-37 (No skipping Docker tests):** Every plan that touches runtime code (backfill script, `/summary` handler) includes an explicit "run `scripts/test.sh` against real Docker Postgres" verification step. No `vi.mock` of the DB layer. Integration tests spin up the existing `docker-compose.test.yml` per the conventional path. Matches user memory `feedback_always_run_docker_tests.md` and D018. Rejected: any form of DB mocking for integration tests.

### Claude's Discretion

- Exact breakdown of the 14 simulated days' entries (content, timing, tag mix) beyond the label distribution in D-05.
- Exact flattery-marker list for TEST-22 (planner surveys existing M006 praise-quarantine markers and augments).
- Exact localization strings for CMD-01 no-row messages and D-31 field labels in EN/FR/RU.
- Whether the backfill script emits a final summary line (e.g., "backfilled 5 days, skipped 2, errors 0") or only per-day logs. Prefer: emit the summary line for operator UX, but don't assert on it in tests.
- Whether TEST-22's flattery-marker list should include French/Russian markers for a future multilingual adversarial run, or English-only for M008 (prefer English-only per Phase 18 precedent; cross-language live tests are an M009+ concern).
- Exact field ordering in the `/summary` output (D-31 suggests one ordering; UX tweaks are discretionary).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap (hard contracts)
- `.planning/REQUIREMENTS.md` §"Test Coverage" (TEST-15..TEST-22), §"Operations & Backfill" (OPS-01), §"User-Facing Commands" (CMD-01) — all Phase 23 requirements, verbatim.
- `.planning/ROADMAP.md` §"Phase 23" — four success criteria:
  1. 14-day synthetic fixture runs to completion in Docker with zero calendar time; all 8 test cases pass.
  2. Backfill script day-by-day idempotent on re-run (zero new inserts on second run).
  3. `/summary` yesterday / `/summary 2026-04-15` / `/summary` for empty date all behave correctly (clear no-row message, not an error).
  4. Docker Postgres test gate count > 152.
- `.planning/STATE.md` §"Critical Implementation Notes" — Docker test gate progression (Phase 20 floor 157; Phase 23 target > 152 with new fixture tests); tails (1–2 and 9–10) mandatory in ground-truth labels.

### Prior Phase Artifacts (load-bearing contracts Phase 23 consumes)
- `.planning/phases/20-schema-tech-debt/20-CONTEXT.md` — `episodic_summaries` schema shape (EPI-01), three-layer Zod schemas (EPI-03), `config.episodicCron` (EPI-04). Phase 23's backfill and `/summary` handler import `EpisodicSummary` and `parseEpisodicSummary` from `src/episodic/types.ts` — the three-layer Zod design decided in 20-CONTEXT.md D-11.
- `.planning/REQUIREMENTS.md` §"Consolidation Engine" CONS-01..CONS-12 — Phase 21's `runConsolidate` contract. Phase 23 calls this function unchanged from both the synthetic fixture (mocked Sonnet) and the backfill script (real Sonnet, rate-limited). CONS-02 (entry-count gate), CONS-03 (idempotency), CONS-06 (decision floor ≥ 6), CONS-07 (contradiction floor ≥ 7), CONS-10 (verbatim quote enforcement), CONS-11 (sparse-entry guard) — all exercised by specific TEST-N cases below.
- `.planning/REQUIREMENTS.md` §"Retrieval Routing" RETR-01 — Phase 22 exports `getEpisodicSummary(date)` and `getEpisodicSummariesRange(from, to)` from `src/pensieve/retrieve.ts`. CMD-01 `/summary` handler MUST use RETR-01 (not a direct Drizzle query — duplicates contract and bypasses Phase 22's timezone-aware day-boundary handling).
- `.planning/REQUIREMENTS.md` §"Cron / Scheduling" CRON-01..CRON-02 — Phase 22 registers the cron. TEST-18 DST test simulates the logical outcome (one consolidation per calendar date across a DST boundary) without invoking the cron itself.

### Prior-Phase Test Precedents (Phase 18 — same architectural problem)
- `src/decisions/__tests__/synthetic-fixture.test.ts` — Phase 18's 14-day lifecycle fixture. Uses `vi.setSystemTime` (NOT `vi.useFakeTimers`, per its D-02), real Postgres, mocked Anthropic. **Copy the file structure, `vi.hoisted` mock pattern, and lifecycle-management idioms directly.**
- `src/decisions/__tests__/live-accountability.test.ts` — Phase 18's live Sonnet suite. Uses `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` at the top; 3-of-3 loop inside the `it()` block. **Copy this pattern verbatim for TEST-22.**
- `src/decisions/__tests__/vague-validator-live.test.ts` — Another live-test example with the same `skipIf` pattern.
- `src/chris/__tests__/live-integration.test.ts` and `contradiction-false-positive.test.ts` — M006/M002 live-integration precedents (D023/D032 origin).

### Bot Handler Precedents
- `src/bot/bot.ts:23-27` — command registration pattern (`bot.command('sync', ...)`, `bot.command('decisions', ...)`). `/summary` registration goes BEFORE the generic `bot.on('message:text', ...)` handler, matching this order.
- `src/bot/handlers/decisions.ts` — handler structure, chatId extraction, language-aware reply, Grammy Context typing with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` at command registration. **Copy structure for `summary.ts`.**
- `src/bot/handlers/sync.ts` — another handler example; shows the argument-parsing + reply flow.

### Operator Script Precedents
- `scripts/test.sh` — shell-based test runner. Not a model for backfill, but relevant: operator scripts live in `scripts/`, documented inline.
- `scripts/adversarial-test.ts` — TypeScript operator script using `tsx` or direct `node --loader ts-node` invocation. **Model for backfill-episodic.ts**: `process.argv` parsing, `console.log`/`logger` usage, explicit `process.exit(code)` on completion/error.

### Research (directly applicable)
- `.planning/research/SUMMARY.md` §"Phase 4: Test Suite + Backfill Script" — required fixture cases (mundane, notable, significant, life-event, zero-entry, decision day, contradiction day, sparse entry, negative-valence, DST, idempotency, verbatim query, synthesis query, high-importance raw descent). Note: not all 14 need dedicated test blocks; many are assertions within TEST-16's 14-day progression. Live-integration suite is gated on `ANTHROPIC_API_KEY`.
- `.planning/research/SUMMARY.md` §"Critical Implementation Notes" — Ground-truth importance labels full-range; tails mandatory; Docker test gate count must rise.
- `.planning/research/PITFALLS.md` #5 (importance compression — rubric miscalibration), #15 (mocked LLM missing prompt drift — D032 violation), #14 (backfill rate-limit exhaustion) — all three are Phase 23's direct territory.
- `.planning/research/FEATURES.md` §"Backfill strategy" — day-by-day sequential with 100–500ms sleep between days (M008 REQUIREMENTS.md OPS-01 specifies 2s — that figure wins over research default); §"Idempotency and re-runs" — unique-index guard (already landed in Phase 20); re-run skip semantics.

### Project Decisions (PROJECT.md)
- **D001** Three-tier LLM — `runConsolidate` uses Sonnet; `/summary` handler does no LLM work; backfill invokes `runConsolidate` (Sonnet) per-day.
- **D004** Append-only Pensieve — Phase 23 never mutates `pensieve_entries`; backfill inserts only into `episodic_summaries`; `/summary` is read-only.
- **D009** Single authorized Telegram user — `/summary` inherits Grammy auth middleware; no per-handler auth.
- **D016** Build and test locally — backfill is a one-shot operator tool, NOT a boot-time action; `/summary` is a live Grammy handler verified via the bot test harness.
- **D018** No skipped tests — ALL mocked tests run on every Docker gate invocation; live tests (TEST-22) `describe.skipIf(!ANTHROPIC_API_KEY)` per explicit D023/D032 exception, documented in test file header.
- **D019** Production deployment requires explicit user approval — Phase 23 ships to main only after Docker gate ≥ 165 and explicit Greg approval; no Proxmox push in this phase.
- **D023** Live integration tests assert absence of bad behavior, 3-of-3 pattern — TEST-22 mechanism verbatim.
- **D024** Four-layer anti-sycophancy — TEST-22 is the live verification of layer 1 (constitutional preamble via CONS-04) in the consolidation pipeline.
- **D031** Structured facts vs interpretation — `/summary` surfaces episodic summary text to Greg intentionally (he requested it via command); this is interpretation display, NOT fact injection into a response pipeline. Cleanly separated.
- **D032** Hallucination resistance + performative apology → live tests — TEST-22's flattery test is the same architectural slot.

### Existing Code Patterns (reuse, do not reinvent)
- `src/utils/logger.ts` — pino-based structured logger. Backfill uses this, not `console.log`.
- `src/chris/language.ts` `getLastUserLanguage(chatId)` — lang detection used by all current command handlers. `/summary` reuses this for EN/FR/RU message localization.
- `src/proactive/state.ts` `hasSentToday` logic — timezone-aware day-boundary helper. D-28 of CMD-01 reuses the same pattern for "yesterday-in-`config.proactiveTimezone`".
- `src/__tests__/fixtures/chat-ids.ts` — shared test chat IDs (`TEST_CHAT_ID`). Summary handler tests import this.
- `scripts/test.sh` — Docker-backed test run. Final verification gate for Phase 23.

### Telegram / Grammy
- `src/bot/bot.ts` — bot instance, middleware chain, command registration order.
- Grammy type `Context` from `'grammy'` — typed correctly in `decisions.ts`; mirror for `summary.ts`.

### Anthropic SDK (TEST-22 live suite only)
- Anthropic SDK imports already used by `runConsolidate` (Phase 21). TEST-22 does NOT re-wire the SDK; it invokes `runConsolidate(adversarialDate)` and asserts on the INSERTED row's `summary` text — the SDK call happens inside the Phase 21 function, unchanged.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`vi.hoisted` mock pattern** (`src/decisions/__tests__/synthetic-fixture.test.ts:34-60`) — the canonical way to mock Anthropic + dependent modules in this codebase. Phase 23's synthetic fixture MUST use the same shape for the `messages.parse()` mock. Hoisted mock factory returns a mutable `mockAnthropicCreate` so each simulated day can `.mockResolvedValueOnce(...)` a different Sonnet response.
- **`vi.setSystemTime` time-travel pattern** (same file) — days advance via `vi.setSystemTime(new Date('2026-04-01T23:00:00+02:00'))` between `it()` blocks or within a loop; DB stays real, so unique-constraint and query correctness are exercised.
- **`describe.skipIf(!process.env.ANTHROPIC_API_KEY)`** (`src/decisions/__tests__/live-accountability.test.ts:153`) — copy verbatim.
- **`beforeEach` DB cleanup** (Phase 18 patterns across `live-accountability.test.ts`, `synthetic-fixture.test.ts`) — `DELETE FROM episodic_summaries WHERE summary_date >= $fixtureStart` before each test block keeps the fixture isolated without TRUNCATEs that risk locking.
- **`bot.command` registration** (`src/bot/bot.ts:23, 27`) — exact line for `/summary` wiring.
- **Language-aware error map** (`src/bot/bot.ts:11-15` `ERROR_FALLBACK`) — pattern for the no-row localized messages in `/summary`.

### Established Patterns
- **Auto-migration on startup** (D016) — Phase 23 adds NO migrations. All schema is already there.
- **Single-file test per TEST-N requirement bundle** — Phase 18 bundled TEST-10/11/12 into one file; Phase 23 bundles TEST-15..TEST-21 into one file. TEST-22 lives alone per D-13.
- **`scripts/test.sh` is the gate** — any test added to `src/**/__tests__/**/*.test.ts` with a matching `*.test.ts` filename is auto-discovered. No additional vitest config needed.

### Integration Points
- `src/episodic/__tests__/synthetic-fixture.test.ts` — **new file** (Phase 20 created `src/episodic/__tests__/` directory; Phase 23 populates it with the fixture).
- `src/episodic/__tests__/live-anti-flattery.test.ts` — **new file**.
- `scripts/backfill-episodic.ts` — **new file**.
- `src/bot/handlers/summary.ts` — **new file**.
- `src/bot/handlers/__tests__/summary.test.ts` — **new file**.
- `src/bot/bot.ts` — **minor edit** to register the `/summary` command (one line; after existing `/decisions` registration).

### Boundaries (do NOT touch in Phase 23)
- `src/episodic/consolidate.ts` — Phase 21 territory. Phase 23 calls the function, does not modify it.
- `src/episodic/prompts.ts` — Phase 21 territory.
- `src/pensieve/retrieve.ts` — Phase 22 territory. Phase 23 calls `getEpisodicSummary`, does not modify.
- `src/index.ts` cron registration — Phase 22 territory.
- `src/db/schema.ts` — Phase 20 territory. No schema changes in Phase 23.
- `src/chris/engine.ts`, `src/chris/modes/*` — no new mode.
- Any `pensieve_entries` mutation path — forbidden by D004.

</code_context>

<specifics>
## Specific Ideas

- **TEST-15 is NOT a separate `it()` block.** The fixture SCAFFOLD (14 simulated days + their entries + their ground-truth labels) is a `beforeAll` body; TEST-15 is "satisfied" by the fixture's mere existence and the assertion in TEST-16 that uses all 14 days. Logging this so the planner doesn't invent a vacuous `it('TEST-15 exists')` test.
- **The 2-second inter-day sleep in the backfill matches OPS-01 verbatim.** Don't tune it to 1s or 3s. 2s is the spec.
- **The test-count floor (≥ 165) is a planner-estimated target.** The hard ROADMAP contract is "higher than 152." Planner tunes the target as the plan decomposes; executor reports the real count.
- **`/summary` future-date short-circuit is a UX detail, not a correctness issue.** If the planner prefers to let RETR-01 return null uniformly, that's acceptable — the no-row message just needs to handle both past-empty and future-date cases clearly (per CMD-01's "not an error" bar).
- **TEST-22's 3-of-3 runs happen inside a `for (let i = 0; i < 3; i++)` loop** inside a single `it()` block, not as three separate tests. This matches Phase 18's `live-accountability.test.ts:173`. Reduces test-runner overhead and makes the "all 3 must pass" contract an atomic assertion.
- **Do NOT invent new praise-quarantine markers for TEST-22.** Survey the existing M006 marker list (likely in `src/chris/praise-quarantine.ts` or `src/chris/__tests__/live-integration.test.ts`) and reuse. Consistency > completeness.
- **Backfill script failure-mode priority.** Per D-22, continue on per-day errors but log. This is intentional: a historical backfill that aborts on one bad day loses resume state. Idempotency (D-23) means re-runs pick up exactly where failures happened.
- **The synthetic fixture is the highest test-count contributor.** Planner shouldn't artificially split TEST-17 or TEST-20 into multiple `it()` blocks just to pad the count; each TEST-N is one `it()` block unless the test naturally bifurcates (TEST-17 has three routing sub-cases — raw-recency, summary-old, verbatim-always; acceptable to use 3 `it()` blocks under a `describe('TEST-17 recency routing')`).

</specifics>

<deferred>
## Deferred Ideas

- **`/resummary YYYY-MM-DD` Telegram command** — EPI-FUTURE-01 per REQUIREMENTS.md. Not in M008.
- **`/summary this week` / `/summary last month` relative-form parsing** — scope creep. M008 CMD-01 specifies ISO-8601 only.
- **Multilingual flattery markers for TEST-22** — deferred to M009 or later per D-17 scoping note.
- **Backfill checkpoint file** — redundant with CONS-03 idempotency per D-23.
- **Batch-mode backfill via Anthropic Batch API** — inappropriate for Greg-scale (~5 days) per SUMMARY.md §Recommended Stack; revisit only for large historical imports (≥14 days).
- **Markdown formatting in `/summary` output** — escape-complexity not worth marginal visual gain per D-31.
- **TEST-18 fall-back DST simulation** — one direction (spring-forward) is sufficient per D-08.
- **Haiku classifier for TEST-22 flattery detection** — keyword markers are deterministic and sufficient per D-16.
- **Parallel backfill** — rate-limit risk per PITFALLS.md #14.
- **Cron-level test for TEST-18** — the logical outcome is what matters; real node-cron is flaky in tests per D-09.
- **Versioned summaries / audit trail of re-runs** — explicitly out of scope per REQUIREMENTS.md §"Out of Scope".
- **`/summary` rendering in Markdown or HTML mode** — text mode matches decisions.ts precedent.

</deferred>

---

*Phase: 23-test-suite-backfill-summary*
*Context gathered: 2026-04-18 (--auto mode; no discuss-phase run)*
</content>
</invoke>