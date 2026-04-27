# Phase 29: Weekly Review — Context

**Gathered:** 2026-04-26
**Status:** Ready for planning
**Mode:** `--auto` (recommended defaults auto-selected for each gray area)

<domain>
## Phase Boundary

Phase 29 ships the **first Sonnet-driven ritual** in M009 — the Sunday 20:00 Europe/Paris weekly review. After this phase, Greg gets exactly ONE Telegram message every Sunday containing: (a) the D031 boundary marker header `Observation (interpretation, not fact):`, (b) one prose observation drawn from `getEpisodicSummariesRange(weekStart, weekEnd)` (M008's first consumer) plus `decisions WHERE resolved_at BETWEEN weekStart AND weekEnd` (M007 substrate), framed as pattern-only commentary that does NOT re-surface individual decisions, and (c) exactly ONE Socratic question demanding a verdict.

The phase's two HARD CO-LOCATION constraints both bind to a single plan: the **two-stage single-question enforcement** (Zod refine + Haiku judge) and the **explicit `CONSTITUTIONAL_PREAMBLE` injection** in `assembleWeeklyReviewPrompt()` MUST land in the same plan as the weekly-review observation generator. Splitting either creates a Pitfall 14/17 regression on the very first weekly review (Greg sees compound questions or sycophantic flattery).

Phase 29 is **independent of Phases 26 + 27 + 28** — it consumes only the Phase 25 substrate (rituals table + scheduler + 21:00 cron) plus M007 (`decisions`) + M008 (`episodic_summaries`). It can ship in parallel with Phases 26 + 27 after Phase 25 completes.

**In scope (9 requirements: WEEK-01..09):**
- WEEK-01 — Sunday 20:00 Europe/Paris fire; reads `getEpisodicSummariesRange` (M008 first consumer) + `decisions` resolved-this-week
- WEEK-02 — `assembleWeeklyReviewPrompt()` explicit `CONSTITUTIONAL_PREAMBLE` injection (HARD CO-LOC #3)
- WEEK-03 — Sonnet structured output `{ observation, question }` via `messages.parse` + `zodOutputFormat`; strict 7-day window; date-grounding post-check
- WEEK-04 — D031 boundary marker `Observation (interpretation, not fact):` on user-facing message header
- WEEK-05 — Two-stage single-question enforcement: Zod refine (regex `?` count + interrogative-leading-word per EN/FR/RU) + Haiku judge (HARD CO-LOC #2)
- WEEK-06 — Retry cap = 2; templated single-question fallback after cap; `chris.weekly-review.fallback-fired` log
- WEEK-07 — Pattern-only observations (no individual decision re-surfacing — M007 ACCOUNTABILITY handles individual surfacing); DIFF-5 forecast-resolved style deferred to v2.5
- WEEK-08 — Pensieve persist as `RITUAL_RESPONSE` with `metadata.kind = 'weekly_review'`
- WEEK-09 — Wellbeing variance gate: stddev < 0.4 over 7-day window → don't cite wellbeing in observation

**Plus (Phase 25 carry-out, owned by Phase 29):**
- Migration `0009_weekly_review_seed.sql` — INSERT seed row into `rituals` for `weekly_review` (type='weekly', `fire_dow=0`/Sunday, `fire_at='20:00'`, default `RitualConfig`). Per Phase 25 Open Q1 RESOLVED in 25-RESEARCH.md, the weekly review seed row is owned by the consumer phase, not by Phase 25.

**Out of scope (deferred to other phases or v2.5):**
- Live anti-flattery 3-of-3 test (TEST-31) — owned by Phase 30 per HARD CO-LOC #6; Phase 29 ships the test SCAFFOLDING (file path, fixture week, assertion shape) so Phase 30 only has to wire the gating + execute. Implementation lives in Phase 29; live execution lives in Phase 30.
- 14-day synthetic fixture covering weekly-review (TEST-29/30) — owned by Phase 30
- Cron registration regression test (TEST-32) — owned by Phase 30 (Phase 25 already shipped the registration via `registerCrons` helper; Phase 30 adds the regression test in its own file per HARD CO-LOC #4)
- Skip-tracking on weekly review skip (cadence-aware threshold daily=3, weekly=2) — owned by Phase 28
- Adjustment dialogue when weekly review threshold crossed — owned by Phase 28
- DIFF-2 wellbeing trajectory in observation — deferred to v2.5
- DIFF-3 question-style taxonomy — deferred to v2.5
- DIFF-5 forecast-resolved-this-week observation style — deferred to v2.5

</domain>

<decisions>
## Implementation Decisions

### Plan split structure (D-01)

**D-01:** **4 plans** for Phase 29, partitioned by HARD CO-LOCATION constraints #2 and #3 (which force the observation generator + single-question enforcement + CONSTITUTIONAL_PREAMBLE injection into ONE plan) and by surface-area cleavage between (a) data fetch / pure prompt assembler, (b) the LLM-driven generator with both enforcement stages and Pensieve persistence, (c) the dispatcher wire-up + seed migration, and (d) the live-anti-flattery test scaffolding (executed in Phase 30 per HARD CO-LOC #6 but built here so Phase 30 only has to flip the gate).

- **Plan 29-01 (Substrate: data fetch + pure prompt assembler):** `src/rituals/weekly-review-sources.ts` (or co-located in `weekly-review.ts`) exporting `loadWeeklyReviewContext(weekStart, weekEnd)` that returns `{ summaries: EpisodicSummary[], resolvedDecisions: Decision[], wellbeingSnapshots: WellbeingSnapshot[], wellbeingVariance: { energy: number, mood: number, anxiety: number } }` — pure data assembly, no LLM. Calls `getEpisodicSummariesRange(weekStart, weekEnd)` (M008 first consumer) + `db.select().from(decisions).where(...resolvedAt between)` (M007 query) + reads from `wellbeing_snapshots` for the variance gate (WEEK-09). `assembleWeeklyReviewPrompt(input)` pure function in `src/rituals/weekly-review-prompt.ts` (mirrors `src/episodic/prompts.ts` shape) that composes `CONSTITUTIONAL_PREAMBLE` + role preamble + date-window block + pattern-only directive + wellbeing-variance directive (conditional) + summaries block + decisions block + structured-output directive. Pure, no DB, no LLM. **Requirements: WEEK-01 (substrate side: range fetch), WEEK-02 (preamble injection in pure prompt), WEEK-04 (boundary marker constant export), WEEK-09 (variance computation + conditional directive).**
- **Plan 29-02 (Generator + enforcement + persistence — HARD CO-LOC #2 + #3 ATOMIC):** `src/rituals/weekly-review.ts` exporting `generateWeeklyObservation(input)` that (a) calls Sonnet via `anthropic.messages.parse({ output_config: { format: zodOutputFormat(WeeklyReviewSchemaV4) } })` with the assembled prompt + week's substrate; (b) Stage-1 enforcement = Zod `.refine()` on the `question` field for `?` count and interrogative-leading-word heuristic per EN/FR/RU; (c) Stage-2 enforcement = Haiku judge call (`callLLM` wrapper or direct `anthropic.messages.parse` with a `{ question_count, questions[] }` Zod schema) invoked only if Stage-1 passes; (d) date-grounding post-check via Haiku (mirrors Pitfall 16 mitigation); (e) retry cap = 2, then templated single-question fallback `"What stood out to you about this week?"` with `chris.weekly-review.fallback-fired` log line; (f) write to `pensieve_entries` with `epistemic_tag = 'RITUAL_RESPONSE'` + `metadata.kind = 'weekly_review'` (WEEK-08); (g) Telegram send with the D031 header. `fireWeeklyReview(ritual)` orchestrator in same file; called by Phase 25's `dispatchRitualHandler` (Phase 29 wires the dispatch in Plan 29-03). **Requirements: WEEK-02 (CONSTITUTIONAL_PREAMBLE used at Sonnet boundary), WEEK-03, WEEK-04 (header rendering), WEEK-05, WEEK-06, WEEK-07 (prompt-level pattern-only directive enforced), WEEK-08.** **HARD CO-LOC #2 + #3 enforced — splitting any of these triggers Pitfall 14 or 17 regression on first weekly review.**
- **Plan 29-03 (Wire-up: dispatcher + seed migration):** `src/rituals/scheduler.ts` `dispatchRitualHandler` switch extended to route `ritual.name === 'weekly_review'` (or `ritual.type === 'weekly' AND ritual.name === 'weekly_review'` per the planner's choice — see D-08 below) to `fireWeeklyReview`. Migration `0009_weekly_review_seed.sql` INSERTs the seed row: `INSERT INTO rituals (name, type, fire_at, fire_dow, next_run_at, config) VALUES ('weekly_review', 'weekly', '20:00', 0, <next Sunday 20:00 Europe/Paris>, '{"fire_at": "20:00", "fire_dow": 0, "skip_threshold": 2, "mute_until": null, "time_zone": "Europe/Paris", "prompt_set_version": "v1", "schema_version": 1}'::jsonb) ON CONFLICT (name) DO NOTHING`. Drizzle meta-snapshot regenerated via `scripts/regen-snapshots.sh`. `scripts/test.sh` extended with the new psql line confirming the seed row exists post-migration. **Requirements: WEEK-01 (fire side: cron-driven dispatch + seed row), wire-side of WEEK-02..08.**
- **Plan 29-04 (Live anti-flattery test scaffolding — HARD CO-LOC #6 prep for Phase 30):** Authors `src/rituals/__tests__/live-weekly-review.test.ts` skeleton WITHOUT the `ANTHROPIC_API_KEY` gating that Phase 30 will wire (the test file exists, the adversarial fixture week + 17 forbidden-marker scan + 3-of-3 atomic loop are coded, but the test is initially `skipIf(!process.env.ANTHROPIC_API_KEY)` with a `// PHASE-30: enable in TEST-31` marker). Adversarial-week fixture content (rich emotional content baited for flattery: "Greg crushed it this week, demonstrating his characteristic discipline") seeded in fixture file. **Requirements: zero new — supports TEST-31 in Phase 30. Plan output is the test file infrastructure.** Per HARD CO-LOC #6, Phase 30 owns the live execution; Phase 29 owns the implementation that test exercises.

**Rejected alternatives:**
- **3 plans collapsing wire-up into generator:** Bundles seed migration + Drizzle snapshot regeneration with the LLM logic, creating a >12-file plan that's hard to review. Migration lineage discipline (HARD CO-LOC #7 spirit, even though #7 itself was Phase 25's) prefers migrations as their own atomic step.
- **5 plans splitting Stage-1 from Stage-2 enforcement:** VIOLATES HARD CO-LOC #2 — Stage-1 + Stage-2 + observation generator MUST be in ONE plan. Splitting into "Sonnet generator" + "single-question enforcement" + "Haiku judge" is exactly the failure mode Pitfall 14 calls out: "Sonnet ships unconstrained; first weekly review = compound questions in production."
- **Plan 29-04 as separate phase:** Considered making the live-test scaffolding its own Phase 30.5. Rejected because the test FILE is owned by Phase 29 (it tests Phase 29's code); only the live execution gate is owned by Phase 30 per HARD CO-LOC #6 (the test must EXIST in Phase 29's commit so Phase 30 only flips a gate). Co-locating the scaffolding with Phase 29 keeps the test infrastructure with the code under test.

### CONSTITUTIONAL_PREAMBLE injection mechanism (D-02)

**D-02:** **Mirror M008 CONS-04 pattern exactly** — `assembleWeeklyReviewPrompt(input)` is a pure function that imports `CONSTITUTIONAL_PREAMBLE` from `../chris/personality.js` and composes it as section 1 of the assembled string. The assembler returns a single string that the caller passes as the `system` parameter to `anthropic.messages.parse`. NO `buildSystemPrompt` mode-handler indirection (Sonnet-driven cron-context calls don't go through mode handlers).

- **Rationale:** M008 `src/episodic/prompts.ts:115-163` is the canonical pattern for cron-context CONSTITUTIONAL_PREAMBLE injection. M008 D038 (CONS-04) explicitly documents that the preamble does NOT auto-apply outside `buildSystemPrompt`; cron-invoked Sonnet calls MUST inject explicitly. Pitfall 17's full mitigation list cites this exact pattern (`assembleWeeklyReviewPrompt()` pure module composes preamble + weekly review system prompt + week's substrate; cite CONS-04 in the comment).
- **Mechanism:** `import { CONSTITUTIONAL_PREAMBLE } from '../chris/personality.js';` at top of `src/rituals/weekly-review-prompt.ts`. Section 1 of the assembled string: `sections.push(CONSTITUTIONAL_PREAMBLE.trimEnd());`. Subsequent sections add the role preamble (anti-flattery for weekly review specifically), date-window block, pattern-only directive, wellbeing-variance directive (conditional on WEEK-09), summaries block, decisions block, structured-output directive.
- **Test (Plan 29-01 + 29-02):** Unit test asserts `assembleWeeklyReviewPrompt(input)` output STARTS with `'## Core Principles (Always Active)'` (CONSTITUTIONAL_PREAMBLE first line). A boundary-audit grep test asserts `grep -L 'CONSTITUTIONAL_PREAMBLE' src/rituals/weekly-review-prompt.ts` returns zero hits (must be present — Pitfall 17's "warning sign" detection).
- **Rejected:** Reusing `buildSystemPrompt('REFLECT')` from `src/chris/personality.ts`. Rejected because (a) REFLECT is a chat mode, not a Sonnet-driven cron generator; (b) REFLECT injects `pensieveContext` as a `{pensieveContext}` placeholder substitution which doesn't fit the weekly-review's structured substrate (summaries + decisions + variance); (c) reusing REFLECT couples this phase to chat-mode prompt evolution which is undesirable.

### Two-stage single-question enforcement: Stage 1 details (D-03)

**D-03:** **Stage 1 = Zod `.refine()` on the `question` field with TWO checks, both must pass:** (a) `(question.match(/\?/g) ?? []).length === 1` AND (b) interrogative-leading-word count ≤ 1 across union EN/FR/RU regex. The Zod schema is the runtime gate; failures throw and are caught by the retry loop in Plan 29-02.

- **Interrogative-leading-word regex per language** (locked in plan):
  - English: `\b(what|why|how|when|where|which|who)\b` (case-insensitive)
  - French: `\b(qu['e]?est-ce que|qu['e]?est-ce qui|comment|pourquoi|quoi|quand|où|quel|quelle|quels|quelles|qui)\b` (case-insensitive, accent-tolerant via `[ée]` if needed)
  - Russian: `\b(почему|что|как|когда|где|кто|какой|какая|какое|какие|зачем)\b` (case-insensitive)
- **Combined check:** `const interrogativeMatches = (question.match(unionRegex) ?? []).length; if (interrogativeMatches > 1) reject;`. The "≤ 1" threshold (not "= 1") allows for an observation question like "What surprised you this week?" (one interrogative leading word) but rejects "What surprised you and why?" (two).
- **Rationale:** Pitfall 14 explicitly enumerates all three failure modes Stage-1 catches: (1) `?` count > 1 (e.g., "What surprised you? Or what felt familiar?"), (2) French period-terminated questions ("Qu'est-ce qui t'a surpris cette semaine. Et qu'est-ce qui t'a semblé familier."), (3) Russian period-terminated questions. The interrogative-leading-word heuristic catches (2) and (3); the `?` count catches (1). Both checks are O(string-length) regex — trivially fast, no LLM call needed for Stage-1.
- **Tradeoff accepted:** Embedded quoted question ("I noticed you keep asking yourself what matters — what did matter this week?") triggers a false reject (2 question marks). Stage-2 Haiku judge catches the converse case (semantic compound) and the prompt-level instruction tells Sonnet not to embed quoted questions. The retry cap = 2 + templated fallback (D-04) prevents infinite loops on legitimate edge cases.
- **Rejected:** `?` count alone (Pitfall 14 explicit anti-pattern). Token-count check (research SUMMARY interpretation #6 explicitly supersedes this in favor of Zod refine + Haiku judge — see "Spec interpretations locked" #2 in STATE.md).

### Two-stage single-question enforcement: Stage 2 details (D-04)

**D-04:** **Stage 2 = Haiku judge with structured output `{ question_count: number, questions: string[] }` via `anthropic.messages.parse` + `zodOutputFormat`,** invoked only if Stage-1 passes. Reject + retry if `question_count > 1`. Total retry cap = 2 attempts (initial + 2 retries = 3 max LLM call cycles); after cap, fall back to templated single-question observation `"What stood out to you about this week?"` with `chris.weekly-review.fallback-fired` log line.

- **Rationale:** Pitfall 14: "Stage 2 — Haiku judge with structured-output schema `{ question_count: number, questions: string[] }`. Haiku is asked to enumerate the questions in the text. If `question_count > 1`, reject." This catches semantic compound questions Stage 1 missed: e.g., a single-`?` single-interrogative-leading-word question that semantically asks two things ("What did you decide and would you make the same call?").
- **Mechanism (Plan 29-02):** Haiku call uses a Zod v4 schema mirror following the v3/v4 dual pattern from `src/episodic/consolidate.ts:33-81`. System prompt: `"You are a question counter. Given the text below, count how many distinct questions are being asked of the reader. A compound question joined by 'and' or 'or' counts as multiple questions. Output JSON: { question_count: number, questions: string[] }."`. User content: the `question` field from Sonnet's structured output.
- **Cost analysis:** ~$0.0003/Haiku judge call × ~1 call per weekly review (Stage-1 catches most violations) = ~$0.001/week. Retry cap caps spend at $0.003/week worst case. Acceptable.
- **Why retry cap = 2 (not 3):** Pitfall 15 explicitly: "Cap retries at 2 (initial + 2 = 3 attempts max). After cap, fall back to templated single-question observation." Mirrors M008 CONS error policy. Beyond cap, the runtime check is fighting a structural prompt failure — log + fall back, never block the weekly cadence.
- **Templated fallback content:** `"What stood out to you about this week?"` per Pitfall 14 explicit example. Hardcoded single-question shape; no Sonnet involvement; guaranteed to ship something on Sunday. Logged as `chris.weekly-review.fallback-fired` (NOT silent — visibility into how often the prompt is failing).
- **Rejected:** No Stage-2 (Stage-1 only). Rejected per Pitfall 14 (Stage-1 misses semantic compounds — the documented failure mode is "What surprised you this week — and what felt familiar?" which has 1 `?` and 1 leading word but is 2 questions). Cap = unlimited retries. Rejected per Pitfall 15 (multi-question regen loop blocks weekly review entirely; Sonnet API spend ratchets up). Cap = 1 retry. Rejected because adversarial weeks (rich content) can require 2 retries to converge — Pitfall 15's "3 attempts max" budget is the documented tradeoff.

### Date-grounding post-check (D-05)

**D-05:** **Haiku post-check call AFTER successful single-question enforcement** to verify Sonnet's observation does NOT reference dates outside the 7-day window. Reject + retry (counts toward the same retry cap = 2) if `references_outside_window: true`.

- **Rationale:** Pitfall 16 ("Stale / Hallucinated Observation Dates in Weekly Review — HIGH"): "After generating the observation, run a Haiku call: 'Here is the observation: [text]. Here is the allowed date window: [start, end]. Does the observation reference any date outside the window? Output: { references_outside_window: bool, dates_referenced: string[] }.' If yes, regenerate (Pitfall 15's retry cap applies)."
- **Why a post-check, not a prompt-level constraint alone:** The prompt-level constraint ("the current week is YYYY-MM-DD to YYYY-MM-DD; only generate observations about events within this window") is necessary but not sufficient. M008's date-extraction Haiku JSON-fences bug (fixed 2026-04-25 in eedce33) is a precedent that Sonnet's date discipline drifts in cron contexts even with explicit instructions. Post-check is the runtime safety net.
- **Shared retry budget:** The date-grounding rejection counts against the same `retry_count <= 2` budget as single-question rejection. Total LLM-call attempts per weekly review: Sonnet call (1-3) + Haiku judge (1-3, only if Stage-1 passed) + Haiku date-check (1-3, only if Haiku judge passed). Worst case = 9 LLM calls; typical case = 1+1+1 = 3 calls.
- **Templated fallback inherits date-grounding correctness:** The fallback `"What stood out to you about this week?"` references no dates → trivially passes any future date-grounding check.
- **Mechanism (Plan 29-02):** `runDateGroundingCheck(observationText, weekStart, weekEnd)` helper in `src/rituals/weekly-review.ts`. Returns `{ inWindow: boolean, datesReferenced: string[] }`. Logged as `chris.weekly-review.date-grounding.rejected` on miss.
- **Rejected:** No post-check (prompt-level constraint only). Rejected per Pitfall 16 documented failure mode + M008 precedent. Strict-regex post-check (regex for date strings in the observation, validate each is in window). Rejected because date references aren't always ISO-formatted ("Wednesday" / "the day before yesterday" / "two weeks ago"); regex misses semantic date mentions; Haiku catches them.

### Wellbeing variance gate (D-06)

**D-06:** **Per-dimension stddev computation in JS (NOT in SQL) over the 7-day window; if ANY dimension's stddev < 0.4, the prompt-level "wellbeing block" is OMITTED entirely.** The variance gate is enforced at PROMPT-ASSEMBLY time (Plan 29-01) — Sonnet never sees the wellbeing data in low-variance weeks, so the observation cannot cite it.

- **Rationale:** WEEK-09 explicit: "if any dimension's stddev < 0.4 over the 7-day window, weekly review observation does NOT cite wellbeing." Threshold 0.4 chosen to match the spec text. Below 0.4 stddev = numbers were essentially flat (e.g., "your mood was 3 all week"); citing them produces pseudo-observations that erode Greg's trust. The ANY-dimension-flat rule (not ALL-dimensions-flat) is more conservative — if even one dimension is flat, omit the whole wellbeing block to avoid asymmetric coverage ("your mood was variable but your anxiety was a constant 4" = the kind of unfocused observation that breaks the one-observation contract).
- **JS not SQL:** stddev is trivially expressible as `Math.sqrt(variance)` over an array of 7 values; pulling the rows + computing in JS keeps the Drizzle query simple (`SELECT energy, mood, anxiety FROM wellbeing_snapshots WHERE snapshot_date BETWEEN $1 AND $2`). Inline computation is ~5 lines, no migration / extension dependency, no database-side window-function quirks. Mirrors `src/proactive/sweep.ts` style of "do simple aggregations in JS once you've fetched the rows."
- **Edge case — fewer than 4 data points:** If `<4` wellbeing snapshots are present in the 7-day window, stddev computation is statistically meaningless. Treat as "no signal" → omit wellbeing block. Logged as `chris.weekly-review.wellbeing.insufficient-data`.
- **Mechanism (Plan 29-01):** `loadWeeklyReviewContext` returns `{ ..., wellbeingVariance: { energy: number | null, mood: number | null, anxiety: number | null }, includeWellbeing: boolean }`. `assembleWeeklyReviewPrompt` reads `includeWellbeing` and conditionally appends the wellbeing block.
- **No wellbeing block content yet (DIFF-2 deferred):** Even when `includeWellbeing = true`, Phase 29 ships a MINIMAL wellbeing block (just the 7-day series; no trajectory analysis). DIFF-2 ("Wellbeing trajectory in weekly observation — third source for weekly review observation alongside summaries + decisions") is deferred to v2.5; Phase 29 just gates the data, leaves trajectory synthesis to Sonnet's existing pattern recognition.
- **Rejected:** ALL-dimensions-flat rule. Rejected because asymmetric coverage (one flat dim, two variable) is a worse observation than no wellbeing mention at all. Stddev threshold 0.5 or 0.3. Rejected — 0.4 matches spec text exactly. SQL window functions for variance. Rejected for portability + simplicity. Defer WEEK-09 to v2.5. Rejected because it's an explicit WEEK-09 requirement.

### Pensieve persistence: epistemic_tag + metadata shape (D-07)

**D-07:** **Persist the observation as a Pensieve entry with `epistemic_tag = 'RITUAL_RESPONSE'` and `metadata = { kind: 'weekly_review', week_start: 'YYYY-MM-DD', week_end: 'YYYY-MM-DD', source_subtype: 'weekly_observation' }`.** Tag override at storePensieveEntry boundary (NOT through Haiku auto-tagger).

- **Rationale:** WEEK-08 explicit: "weekly review observation persists to Pensieve as `epistemic_tag = RITUAL_RESPONSE` with `metadata.kind = 'weekly_review'` for longitudinal recall." D035 boundary holds: weekly observations are NOT episodic summary text (they're Sonnet-generated commentary ON the summaries), so Pensieve persistence does not violate the "episodic_summaries text never enters Pensieve" invariant.
- **Tag override mechanism:** `storePensieveEntry(text, source, { epistemic_tag: 'RITUAL_RESPONSE', metadata: { kind: 'weekly_review', ... } })` — extending the existing `storePensieveEntry` signature to accept an explicit `epistemic_tag` parameter that bypasses Haiku auto-tagging. This is the same pattern Phase 26 will use for voice notes (HARD CO-LOC #1) — Phase 29's needs ALIGN with Phase 26's needs, but Phase 29 ships first if parallel-eligible. **Cross-phase coordination flag:** if Phase 26 ships first, Phase 29 reuses the existing override; if Phase 29 ships first, Phase 26 reuses what Phase 29 ships. Either way, the change is additive (new optional parameter) and one-way; no API break.
- **Embedding policy:** Embed-and-store is fire-and-forget per D005 (existing Pensieve pattern). Weekly observations are short (~200-400 chars); embedding cost is negligible. They show up in semantic search as RITUAL_RESPONSE entries, which INTERROGATE can filter on (`WHERE epistemic_tag = 'RITUAL_RESPONSE' AND metadata->>'kind' = 'weekly_review'`).
- **Test (Plan 29-02):** Real-DB integration test asserts after `fireWeeklyReview()` (mocked Sonnet returning known structured output), `SELECT * FROM pensieve_entries WHERE metadata->>'kind' = 'weekly_review'` returns exactly 1 row with `epistemic_tag = 'RITUAL_RESPONSE'` and the expected text.
- **Rejected:** Persist into `episodic_summaries` directly. Rejected per D035 (Pensieve authoritative; episodic_summaries is a projection). Persist into `ritual_responses.metadata.observationText` ONLY (no Pensieve write). Rejected per WEEK-08 explicit ("persists to Pensieve as RITUAL_RESPONSE"). Skip embedding. Rejected because longitudinal INTERROGATE recall ("show me past weekly observations") is the documented use case.

### Dispatcher mechanism (D-08)

**D-08:** **`dispatchRitualHandler` in `src/rituals/scheduler.ts` switches on `ritual.name`** (NOT on `ritual.type`), and Plan 29-03 extends the switch with a case for `'weekly_review'`. The seed migration sets `name = 'weekly_review'` and `type = 'weekly'` (per RIT-01: name is UNIQUE, type is the cadence enum).

- **Rationale:** `ritual.type` is the cadence enum (`'daily' | 'weekly' | 'monthly' | 'quarterly'`), shared across many possible rituals at the same cadence (e.g., M013 may add multiple weekly rituals). `ritual.name` is the unique identifier per RIT-01's `UNIQUE (name)` constraint and is the natural key for handler dispatch. Phase 25's skeleton dispatcher throws on every type today; Phases 26/27/29 each replace one branch.
- **Phase 26 will use `name = 'daily_voice_note'`** (or similar — Phase 26 plan owns the choice; Phase 29 reads `ritual.name === 'weekly_review'` regardless of what Phase 26 picks).
- **Phase 27 will use `name = 'daily_wellbeing'`** (or similar — same independence).
- **Wire-up shape (Plan 29-03):**
  ```typescript
  async function dispatchRitualHandler(ritual: typeof rituals.$inferSelect): Promise<void> {
    switch (ritual.name) {
      case 'weekly_review': return fireWeeklyReview(ritual);
      // Phase 26 adds 'daily_voice_note'
      // Phase 27 adds 'daily_wellbeing'
      default:
        throw new Error(`rituals.dispatch: handler not implemented for ${ritual.name} (Phase 25 ships skeleton; Phases 26-29 fill)`);
    }
  }
  ```
- **Coordination with Phase 26 + 27:** They each own one switch case; merging order is independent (no conflicts because each adds a distinct case label). Plan 29-03's diff to scheduler.ts is small (1 case + 1 import).
- **Rejected:** Switch on `ritual.type`. Rejected per cadence-vs-handler distinction above. Subclass-based dispatch. Rejected for over-engineering (3 handlers, switch is fine). Map-based dispatch (`new Map([['weekly_review', fireWeeklyReview], ...])`). Rejected — switch is conventional for static enumeration.

### Migration ordering: 0007/0008 vs 0009 (D-09)

**D-09:** **Migration filename is `0009_weekly_review_seed.sql`.** Phase 26 will own `0007_<voice_note_seed>.sql`, Phase 27 will own `0008_<wellbeing_seed>.sql`. Migrations are append-only and ordered by migration number, but their EFFECTS are independent (each INSERTs a different ritual row); ordering matters only for the meta-snapshot lineage discipline, not for runtime semantics.

- **Rationale:** Phases 26 + 27 + 29 are parallel-eligible after Phase 25 (per ROADMAP). If they all ship to main concurrently, they each need a unique migration number. Ordering 26 → 27 → 29 = 0007 → 0008 → 0009 keeps lineage clean. Each phase's migration is INSERT-only (no schema changes, no risk of conflict with other parallel branches).
- **Cross-phase race:** If Phases 26 and 29 are merged within the same hour, the merge order determines which gets 0007 vs 0008 etc. Resolution per the Phase 25 D-08 pattern: the LATER merge regenerates the meta-snapshot via `scripts/regen-snapshots.sh` clean-slate replay, and the LATER merge's PR includes a `0007_*.sql` rename if needed. The orchestrator (or Greg) coordinates the merge order; planner just specifies `0009_weekly_review_seed.sql` as the assumed slot.
- **Tradeoff accepted:** This requires coordination at merge time. Alternative — single combined seed migration — was considered and rejected because it bundles three independent phase responsibilities into one migration file, violating the per-phase ownership boundary. Per-phase migration files are the right cleavage even with the merge-coordination cost.
- **next_run_at computation in seed:** The seed INSERT computes `next_run_at` as the next Sunday 20:00 Europe/Paris from the migration apply time. For a deterministic SQL expression: `date_trunc('week', now() AT TIME ZONE 'Europe/Paris') + interval '6 days 20 hours' AT TIME ZONE 'Europe/Paris'` (psql `date_trunc('week', ...)` returns Monday; +6 days = Sunday; +20 hours = 20:00). If the migration applies on a Sunday afternoon (after 20:00), `next_run_at` should be NEXT Sunday — add a CASE to handle the same-day-after-fire case. Planner specifies the exact SQL; this CONTEXT.md commits to the deterministic-SQL approach (no application-time JS computation).
- **Rejected:** Application-startup seed (vs migration). Rejected per RIT-01: rituals table is the source of truth from migration time, not from application boot. Hardcoded next_run_at. Rejected because it would be in the past after a few days of the migration sitting unmerged. Combined seed migration. Rejected per per-phase ownership above.

### Live anti-flattery test scaffolding split (D-10)

**D-10:** **Plan 29-04 ships the live test FILE with `skipIf(!process.env.ANTHROPIC_API_KEY)` AND with a `// PHASE-30: enable in TEST-31` marker comment.** The 17 forbidden-marker scan, 3-of-3 atomic loop, adversarial fixture content, and assertion shape are ALL coded in Phase 29; Phase 30 only flips the gate from `skipIf` to active execution + adds the file to the `scripts/test.sh` excluded-suite list (operational handling).

- **Rationale:** HARD CO-LOC #6 ("Pitfall 26 — live weekly-review test MUST be its own plan; bundling it with weekly review impl in Phase 29 either delays the implementation OR ships without the test"): the live EXECUTION is owned by Phase 30. But the IMPLEMENTATION the test exercises is Phase 29's output. The bug Pitfall 26 calls out is "ship implementation without ever wiring the test"; the mitigation is to ship the test file in Phase 29 (so it's visible in code review with the implementation) but defer the live gate to Phase 30 (so Phase 29 doesn't depend on a live Anthropic call to land).
- **17 forbidden-marker list** (sourced from M006 conventions per Pitfall 17): combine `live-integration.test.ts VALIDATION_MARKERS` + `praise-quarantine.ts REFLEXIVE_OPENER_FIRST_WORDS` + `CONSTITUTIONAL_PREAMBLE` Three Forbidden Behaviors. Plan 29-04 imports/copies the same marker list M008's `live-anti-flattery.test.ts` uses (DRY across the two live tests). If Phase 29 ships first, the list is duplicated; v2.5 cleanup folds them into a shared `src/__tests__/forbidden-markers.ts` module.
- **Adversarial-week fixture content:** Hand-authored in Plan 29-04. Spec from Pitfall 17: "rich emotional content designed to bait flattery (a difficult conversation with positive resolution, a hard decision Greg made)." Plan 29-04 writes the fixture content (Greg "crushing it" with "characteristic discipline" framing) as a fixture-input for the live test.
- **Mechanism (Plan 29-04):**
  ```typescript
  describe.skipIf(!process.env.ANTHROPIC_API_KEY)('live-weekly-review (PHASE-30: enable in TEST-31)', () => {
    it('zero forbidden flattery markers across 3-of-3 atomic iterations', async () => {
      // Adversarial fixture week setup
      // Run generateWeeklyObservation 3 times atomically
      // Assert: zero forbidden markers in each output
    });
  });
  ```
- **Rejected:** Phase 30 owns the entire test file. Rejected per HARD CO-LOC #6 (Phase 29 ships impl, Phase 30 ships test file = exactly the "ships without the test" failure mode). Phase 29 enables the live gate (no `skipIf`). Rejected because Phase 29 should not depend on a live Anthropic call to land + Greg's `ANTHROPIC_API_KEY` available at Phase 29 verify-work time.

### Claude's Discretion

- **Exact file names within `src/rituals/`:** `weekly-review.ts` (per ARCHITECTURE.md `src/rituals/` shape), `weekly-review-prompt.ts` vs co-locating prompt assembler in `weekly-review.ts` (planner picks; mirror M008 split where `prompts.ts` was its own file because it was 312 lines).
- **Exact log-event names:** `chris.weekly-review.fallback-fired`, `chris.weekly-review.date-grounding.rejected`, `chris.weekly-review.wellbeing.insufficient-data`, `chris.weekly-review.haiku-judge.rejected`. Planner picks the exact subsystem prefix per existing project convention (some files use `rituals.weekly.*`, some use `chris.weekly-review.*`; planner aligns with whichever pattern is more prevalent in `src/rituals/` and the Phase 25 LEARNINGS.md naming examples).
- **Templated fallback EXACT TEXT in EN/FR/RU:** Per Pitfall 14: "What stood out to you about this week?". Planner provides FR + RU equivalents based on the `franc` language detection pattern (M006 D-04). Phase 29 default = English; if `franc` detection is wired and Greg's last text language is FR/RU, the templated fallback localizes. Planner reads `src/rituals/voice-note.ts` (Phase 26) for any cross-phase localization helpers if Phase 26 has shipped first.
- **Exact Zod schema for Sonnet structured output (`WeeklyReviewSchemaV4`):** `{ observation: string.min(20).max(800), question: string.min(5).max(300).refine(stage1Check) }`. Planner picks exact min/max bounds based on the spec's "one observation + one Socratic question" intent + the M008 `EpisodicSummarySonnetOutputSchema` for precedent on bound choices.
- **Adversarial-week fixture content (Plan 29-04):** Concrete test data designed to bait flattery markers. Planner reads M008's `live-anti-flattery.test.ts` 2026-02-14 fixture for precedent + adapts to weekly-review shape (7 days of summaries + 2-3 resolved decisions + variable wellbeing).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone-level research (the bedrock for Phase 29)
- `.planning/research/SUMMARY.md` — Executive summary; TS-6, TS-7, TS-7a-f weekly review features; **Pitfalls 14 (single-question) + 17 (sycophantic observations) — both HIGH**; HARD CO-LOC #2 + #3 + #6.
- `.planning/research/PITFALLS.md` — Full 29-pitfall taxonomy; Phase 29 specifically defends against Pitfalls 14, 15, 16, 17, 18, 26.
- `.planning/research/ARCHITECTURE.md` §Section 5 (Weekly review handler) — Module location (`src/rituals/weekly-review.ts`), Sonnet call shape, Zod refinement pattern, single-question enforcement, Pensieve persistence.
- `.planning/research/STACK.md` — Per-package version-bump assessment (zero version bumps); Anthropic SDK 0.90 + zodOutputFormat helper documented.
- `.planning/research/FEATURES.md` — TS-6, TS-7..TS-7f are Phase 29's scope.

### Roadmap + requirements
- `.planning/ROADMAP.md` §Phase 29 — Goal, requirements list, HARD CO-LOC #2 + #3, 4 success criteria. **Authoritative scope.**
- `.planning/REQUIREMENTS.md` — WEEK-01..09 verbatim; D031 boundary marker text exact.
- `.planning/STATE.md` — Current position; D030 (weekly review ships in M009 not M013); D031 (boundary marker pattern); D034 (episodic_summaries 8 cols + 3 indexes locked); D035 (Pensieve authoritative — weekly observation as RITUAL_RESPONSE); D036 (retrieveContext two-dim routing — weekly review reads via getEpisodicSummariesRange); "Spec interpretations locked" #2 (single-question = two-stage Zod refine + Haiku judge).

### Project plan + decisions
- `PLAN.md` — Project Chris implementation plan; Key Decisions table (D004 append-only Pensieve, D031 D035 D038 boundary markers, D041 primed-fixture pipeline supersedes calendar-time waits).

### Codebase intel (subset relevant to Phase 29)
- `.planning/codebase/ARCHITECTURE.md` — Layered monolith; "Episodic consolidation subsystem"; Phase 29 is FIRST CONSUMER of `getEpisodicSummariesRange` per M008 substrate.
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict ESM; `.js` suffix imports; SCREAMING_SNAKE_CASE constants; box-drawing section dividers; **§LLM Tier Discipline: Sonnet for generation, Haiku for judge calls**; **§Constitutional preamble on every user-facing LLM call** (CONS-04 / D038 cron-context exception).
- `.planning/codebase/STACK.md` — Anthropic SDK 0.90 patterns; v3/v4 dual Zod schema at SDK boundary.
- `.planning/codebase/TESTING.md` — Existing vitest patterns; primed-fixture pipeline §; live-LLM tests in excluded-suite list (current: 5 files; Phase 29 adds the 6th `live-weekly-review.test.ts`).

### Source files Phase 29 reads or modifies (full paths)
- `src/episodic/sources.ts` — `getEpisodicSummariesRange(weekStart, weekEnd)` exported, zero current callers (Phase 29 is the first consumer per ARCHITECTURE.md).
- `src/decisions/index.ts` — Barrel for M007 decision archive; query for `decisions WHERE resolved_at BETWEEN $start AND $end`.
- `src/episodic/consolidate.ts` — `assembleConsolidationPrompt` pattern (mirror for `assembleWeeklyReviewPrompt`); v3/v4 dual-schema Zod pattern at lines 33-81 (mirror for `WeeklyReviewSchemaV4`); retry-once pattern at lines 129-183 (mirror for retry cap = 2).
- `src/episodic/prompts.ts` — `assembleConsolidationPrompt` exact shape (sections array, conditional blocks, structured-output directive at end). **Mirror.**
- `src/chris/personality.ts` — `CONSTITUTIONAL_PREAMBLE` constant at line 30 (Phase 29 imports + injects explicitly).
- `src/llm/client.ts` — Sonnet model + `messages.parse()` + `helpers/zod`'s `zodOutputFormat` pattern; Haiku model for judge call.
- `src/rituals/scheduler.ts` — `dispatchRitualHandler` switch (Phase 29 adds `'weekly_review'` case in Plan 29-03).
- `src/rituals/types.ts` — `RitualConfigSchema` strict; `RitualFireResult` discriminated union.
- `src/db/schema.ts` — `epistemicTagEnum` includes `RITUAL_RESPONSE` (Phase 25 shipped).
- `src/db/migrations/0006_rituals_wellbeing.sql` — Mirror for 0009 idempotency guards (DO blocks, IF NOT EXISTS).
- `src/db/migrations/` — 0007 will be Phase 26's, 0008 will be Phase 27's (per D-09 ordering); Phase 29's is 0009.
- `src/pensieve/store.ts` — `storePensieveEntry` signature (Phase 29 may extend with explicit `epistemic_tag` parameter per D-07; coordinate with Phase 26).
- `src/episodic/__tests__/live-anti-flattery.test.ts` — Mirror for `src/rituals/__tests__/live-weekly-review.test.ts` (Plan 29-04). Same 3-of-3 atomic shape, same forbidden-marker list source.
- `src/episodic/__tests__/synthetic-fixture.test.ts` — Mirror for vi.setSystemTime mock-clock pattern (Phase 30 uses, Phase 29 references for the live-test design).
- `scripts/regen-snapshots.sh` — Clean-slate iterative replay for migration meta-snapshot regeneration; Plan 29-03 invokes for 0009.
- `scripts/test.sh` — Docker postgres harness; Plan 29-03 adds psql line confirming the seed row exists post-migration.

### Phase 25 carry-out references (Phase 25 substrate Phase 29 consumes)
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-CONTEXT.md` — D-04 (ritual channel daily counter ceiling = 3/day; Sunday accommodates wellbeing 09:00 + voice note 21:00 + weekly review 20:00); D-09 (`computeNextRunAt(now, cadence, config)` 3-arg signature).
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-RESEARCH.md` — Open Q1 RESOLVED (weekly review seed row owned by Phase 29, not Phase 25); §6 cron strategy; §5 weekly review handler module location.
- `.planning/phases/25-ritual-scheduling-foundation-process-gate/25-LEARNINGS.md` — Pattern: "real-postgres for concurrency"; "honest docstrings trigger their own grep guards"; D-04 refinement reasoning; hand-SQL + drizzle-snapshot hybrid for migrations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/episodic/prompts.ts:115-163` `assembleConsolidationPrompt`** — Canonical pattern: `CONSTITUTIONAL_PREAMBLE` is section 1, role preamble section 2, conditional blocks middle, structured-output directive last. Phase 29's `assembleWeeklyReviewPrompt` mirrors this shape verbatim. Don't reinvent.
- **`src/episodic/consolidate.ts:33-81` v3/v4 dual Zod schema pattern** — `EpisodicSummarySonnetOutputSchema` (v3, contract surface) + `EpisodicSummarySonnetOutputSchemaV4` (v4, SDK boundary). Phase 29 ships `WeeklyReviewSchema` (v3) + `WeeklyReviewSchemaV4` (v4). Both kept in lock-step.
- **`src/episodic/consolidate.ts:129-183` `callSonnetWithRetry` retry-once pattern** — Phase 29 extends to retry-cap-2 with templated fallback. Same shape, different cap.
- **`src/episodic/sources.ts:390+` `getEpisodicSummariesRange(from, to)`** — Pure-function range query, never throws, returns empty array on error. Phase 29 calls this for the weekly retrieval window.
- **`src/episodic/__tests__/live-anti-flattery.test.ts`** — Live-LLM 3-of-3 atomic test mirror; forbidden-marker scan against `VALIDATION_MARKERS` const; `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` gating pattern. Plan 29-04 mirror.
- **Phase 25 `src/rituals/scheduler.ts:dispatchRitualHandler`** — Currently throws for every type; Phase 29 adds `case 'weekly_review'` branch in Plan 29-03.
- **`src/chris/personality.ts:30` `CONSTITUTIONAL_PREAMBLE`** — Direct import + inject. Same pattern M008's `assembleConsolidationPrompt` uses.
- **M008 `src/episodic/cron.ts`** — Independent DST-safe cron pattern; Phase 29 inherits the existing 21:00 cron from Phase 25 (no new cron needed; existing tick fires the Sunday 20:00 weekly review because next_run_at SQL-gates correctly).

### Established Patterns
- **`.js` suffix on every internal import** — non-negotiable.
- **Hand-author SQL + drizzle-generated snapshot hybrid** — Phase 25 LEARNINGS pattern; Plan 29-03's seed migration uses the same `DO BEGIN ... EXCEPTION WHEN duplicate_object` idempotency guards as 0006.
- **CONSTITUTIONAL_PREAMBLE explicit injection in cron-context Sonnet calls** — CONS-04 / D038 / Phase 29 inherits.
- **v3/v4 dual Zod schema at the @anthropic-ai/sdk boundary** — `consolidate.ts:33-81` documents the runtime requirement.
- **3-of-3 atomic live-LLM tests for anti-flattery** — M006 D023 + M008 D038 precedent; Phase 29 inherits via Plan 29-04 scaffolding (live execution in Phase 30 per HARD CO-LOC #6).
- **Real-DB tests for transactional behavior** — Phase 25 LEARNINGS: "Postgres concurrent-update semantics must be tested with REAL postgres, not mocks". Plan 29-02's Pensieve persistence test uses real Docker postgres.
- **Tag override at storePensieveEntry boundary, not via Haiku** — D-07 + Phase 26 alignment.

### Integration Points
- **`src/rituals/scheduler.ts` `dispatchRitualHandler`** — Plan 29-03 wires `'weekly_review'` case.
- **`src/db/migrations/0009_weekly_review_seed.sql`** — Plan 29-03 INSERTs the seed row.
- **`src/episodic/sources.ts` `getEpisodicSummariesRange`** — Phase 29 first consumer (was zero callers before).
- **`src/decisions/index.ts`** — Phase 29 imports `decisions` table (or queries via Drizzle directly with the `eq(decisions.status, 'resolved')` predicate — planner picks).
- **`src/db/schema.ts` `pensieveEntries`** — Plan 29-02 writes to with explicit `epistemic_tag = 'RITUAL_RESPONSE'`.
- **`src/chris/personality.ts` `CONSTITUTIONAL_PREAMBLE`** — Plan 29-01 imports + Plan 29-02 indirectly consumes via the assembled prompt.
- **`scripts/test.sh`** — Plan 29-03 adds psql line confirming `weekly_review` row in `rituals` post-migration.
- **Phase 25 substrate** — Phase 29 consumes `rituals` table, `runRitualSweep`, 21:00 cron tick. No edits to Phase 25 code; Plan 29-03's only edit to scheduler.ts is adding one switch case.

</code_context>

<specifics>
## Specific Ideas

- **Migration file name:** `0009_weekly_review_seed.sql` (per D-09).
- **`ritual.name` value:** `'weekly_review'` exactly (matches dispatch case in D-08).
- **`ritual.type` value:** `'weekly'` (cadence enum; matches RIT-01).
- **`fire_at`:** `'20:00'` (one hour earlier than voice note's 21:00 per WEEK-01).
- **`fire_dow`:** `0` (Sunday — JS Sunday=0; configurable per RIT-07; spec convention reads "Sunday" → 0 OR 7 depending on convention; planner picks per `RitualConfigSchema` definition which says `z.number().int().min(1).max(7).optional()` → so use `7` for Sunday OR fix the schema to allow 0. Planner reconciles; D-09 commits to "the Sunday convention used in `RitualConfigSchema` field `fire_dow`" — read `src/rituals/types.ts:47` to confirm; if 1=Mon..7=Sun, use `7`).
- **D031 boundary marker exact text:** `Observation (interpretation, not fact):` — verbatim per WEEK-04.
- **Templated fallback exact text:** `What stood out to you about this week?` — English baseline per Pitfall 14.
- **Wellbeing variance threshold:** `0.4` (stddev) per WEEK-09 explicit.
- **Insufficient-data threshold:** `<4` snapshots in 7-day window → omit wellbeing block (D-06).
- **Retry cap:** 2 (initial + 2 = 3 max attempts) per Pitfall 15.
- **Date-grounding shared retry budget:** Counts against same cap per D-05.
- **Pensieve `epistemic_tag`:** `'RITUAL_RESPONSE'` (Phase 25 shipped enum value).
- **Pensieve `metadata.kind`:** `'weekly_review'` per WEEK-08.
- **Pensieve `metadata.source_subtype`:** `'weekly_observation'` (Phase 29 chosen; mirrors VOICE-06 `'ritual_voice_note'` pattern).
- **Sonnet model:** `SONNET_MODEL` from `src/llm/client.ts` (`claude-sonnet-4-6`).
- **Haiku judge model:** `HAIKU_MODEL` from `src/llm/client.ts` (`claude-haiku-4-5-20251001`).
- **Sonnet max_tokens:** ~800 (matches M008 episodic consolidation budget; observation + question is short).
- **Haiku judge max_tokens:** ~150 (structured output `{ question_count, questions[] }` is small).
- **Live test 3-of-3 atomic:** mirrors M008 TEST-22 exactly (Plan 29-04).
- **17 forbidden-marker list source:** `src/chris/__tests__/live-integration.test.ts VALIDATION_MARKERS` + `src/chris/praise-quarantine.ts REFLEXIVE_OPENER_FIRST_WORDS` + `CONSTITUTIONAL_PREAMBLE` Three Forbidden Behaviors. Plan 29-04 imports or copies.
- **Adversarial fixture content:** Hand-authored 7-day summary set + 2-3 resolved decisions designed to bait flattery (e.g., "Greg crushed it this week, demonstrating his characteristic discipline") per Pitfall 17.

</specifics>

<deferred>
## Deferred Ideas

- **DIFF-2 wellbeing trajectory in observation** — third source for weekly review observation alongside summaries + decisions. Defer to v2.5 once wellbeing variance signal is real-data-validated.
- **DIFF-3 question-style taxonomy** — track which Socratic question styles drive engagement. Defer to v2.5 once enough weekly reviews have been generated.
- **DIFF-5 forecast-resolved-this-week observation style** — M007 ACCOUNTABILITY channel surfaces individual forecasts at resolution; consider weekly aggregation in v2.5.
- **Single-composite wellbeing alternative** — if 3-tap commitment proves too high after 30 real days, ship as config option in v2.5.
- **Embedded-question detection in Stage-1** — current Stage-1 false-rejects observations that quote Greg's own past question ("you keep asking yourself what matters — what did matter this week?" has 2 `?`). Stage-2 Haiku catches the genuinely-compound case. Embedded-question handling = v2.5 if false rejects prove common.
- **EN/FR/RU Stage-1 union regex evolution** — Phase 29 ships the locked regex per D-03; future v2.5 may add (a) more interrogative leading words per language, (b) accent-tolerant matching, (c) Spanish/German/Italian support if Greg's language palette expands.
- **Templated fallback in FR/RU** — Phase 29 ships English baseline; FR + RU templated fallbacks land if Greg's `franc` last-message language was FR/RU. Planner picks exact text.
- **Operator-tunable threshold for wellbeing variance** — 0.4 stddev hardcoded per WEEK-09; future v2.5 may expose as `rituals.config.wellbeing_variance_threshold`.
- **Backfill weekly observations for past weeks** — `scripts/backfill-weekly-review.ts` analog to `scripts/backfill-episodic.ts`. Defer until M010+ wants historical weekly observations for profile inference.

</deferred>

---

*Phase: 29-Weekly Review*
*Context gathered: 2026-04-26*
