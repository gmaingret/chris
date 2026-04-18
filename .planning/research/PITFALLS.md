# Pitfalls Research — M008 Episodic Consolidation

**Domain:** Adding end-of-day episodic summarization to an existing personal AI / second-brain system (Project Chris)
**Researched:** 2026-04-18
**Confidence:** HIGH — all pitfalls grounded in existing system constraints (D004/D006/D018/D023/D024/D027/D031/D032/D033), M007 architecture lessons, and the specific design of the consolidation feature as stated in M008_Episodic_Consolidation.md

---

## Critical Pitfalls

### Pitfall 1: Summary Sycophancy — Flattering Narrative Drift (D024 violation)

**What goes wrong:**
The Sonnet summary prompt, if not given a constitutional preamble, produces summaries that frame the day's events to reflect well on Greg. Mundane days become "a day of steady focus." Bad decisions become "a learning experience." Frustration becomes "productive tension." Over 30–60 days this creates a corpus of episodic memories that systematically portray Greg as wiser, calmer, and more intentional than the raw Pensieve shows. When M009 weekly review and M010+ profile inference read these summaries, they inherit the flattery.

**Why it happens:**
The consolidation prompt asks Sonnet to describe Greg's day. Without constitutional constraint, Sonnet defaults to positive framing. The existing `buildSystemPrompt(mode)` preamble from M006 is wired to the six engine modes and does not automatically apply to out-of-band cron jobs. The consolidation cron runs independently of the engine — it is not a conversational mode and will not inherit the shared preamble unless explicitly passed.

**How to avoid:**
The consolidation prompt must include the full M006 constitutional preamble verbatim, plus an explicit instruction: "Describe what actually happened. Do not soften negative experiences, reframe frustration as growth, or characterize indecision as wisdom. Preserve the emotional register of the raw entries, including anger, anxiety, confusion, and uncertainty, as they were expressed." Validate in the 14-day synthetic fixture: include a day with clearly negative entries (frustration, self-doubt, conflict) and assert that the generated summary does not use positive reframing language. Use a Haiku follow-up classifier on the summary output to detect flattering vocabulary patterns — same pattern as M006's sycophancy test (D023).

**Warning signs:**
- All 14-day fixture summaries describe the day using positive or neutral framing regardless of input valence
- `emotional_arc` field values cluster around "reflective," "focused," "engaged" rather than ever including "frustrated," "anxious," "scattered"
- Summaries for days with recorded contradictions (M002 hooks) do not mention tension or conflict
- Over real use: Greg notices that reading back his episodic summaries makes him feel better than re-reading the raw entries

**Phase to address:**
Schema + Consolidation Engine phase. The constitutional preamble and the anti-flattery instruction must be in the prompt from day one, not retrofitted after summaries accumulate. The 14-day fixture must include adversarial negative-valence days.

---

### Pitfall 2: Verbatim Quote Erasure — Paraphrase Losing Fidelity

**What goes wrong:**
The `key_quotes` field is specified in the schema but if the summary prompt does not strongly enforce verbatim extraction, Sonnet will paraphrase. "I'm terrified I'm wasting my life" becomes "Greg expressed concern about his direction." The quote field becomes a restatement field. When M009 weekly review or INTERROGATE mode uses key_quotes as high-fidelity anchors, it gets interpretation not evidence — exactly the failure mode D031 was designed to prevent.

**Why it happens:**
LLMs default to paraphrase because paraphrase is syntactically more natural in a summarization context. The M008 schema names the field `key_quotes` but a prompt that does not explicitly forbid paraphrase will produce paraphrase with high probability.

**How to avoid:**
The consolidation prompt must instruct: "Extract `key_quotes` as verbatim character-for-character copies of sentences from the source entries. Do not paraphrase, summarize, or clean up grammar. The quote must be findable by exact substring match in the source Pensieve entry text." In the 14-day synthetic fixture: assert that every string in `key_quotes` appears as an exact substring in at least one source Pensieve entry (`source_entry_ids`). This is a deterministic test that requires no LLM judgment.

**Warning signs:**
- No exact substring match between a `key_quotes` value and any source entry text
- Quotes in summaries use third person ("Greg said...") when the original was first person
- Quotes use past tense when the original was present tense
- Fixture passes on a weak string-similarity check but fails on exact substring match

**Phase to address:**
Consolidation Engine phase. The exact-substring-match assertion belongs in the 14-day fixture test suite as a deterministic, non-LLM assertion.

---

### Pitfall 3: Summary Hallucination — Fabricated Plausible Details

**What goes wrong:**
Sonnet infers details not present in the raw entries. If Greg wrote "meeting went badly" with no further elaboration, the summary might read "Greg had a difficult client meeting where expectations were misaligned." The word "client" and "expectations" are invention. Over time, hallucinated details from summaries re-enter the system as episodic memory and are cited in INTERROGATE/REFLECT responses. This is the same failure mode D031 addressed for fact injection, now propagated one tier up.

**Why it happens:**
Sonnet's summarization training rewards completeness. Short, sparse entries get filled in. The model has no explicit boundary between "the entry says" and "I infer from context." Without a hard prohibition, it fills the gap.

**How to avoid:**
The consolidation prompt must include: "You may only state what is explicitly present in the source entries. Do not infer, speculate, or elaborate beyond what Greg wrote. When an entry is sparse, the summary for that entry must be sparse. Write 'Greg noted: [what he wrote]' rather than expanding on what he might have meant." In the 14-day fixture: include deliberately sparse entries ("bad day") and assert the summary does not add specifics not in the source. Use a Haiku follow-up call on sparse-entry summaries to check for fabricated specifics — same pattern as D032 hallucination resistance test.

**Warning signs:**
- Summary mentions proper nouns (people, places, company names) not present in any source entry
- Sparse entries produce summaries with more detail than the entries themselves
- Retrieval in INTERROGATE mode surfaces summary details that Greg does not recognize as things he said
- The `source_entry_ids` array is present but the summary text cannot be traced back to those entries

**Phase to address:**
Consolidation Engine phase. The sparse-entry anti-hallucination test is a required fixture case alongside the happy-path cases.

---

### Pitfall 4: Contradiction Smoothing — Anti-Archive Behavior

**What goes wrong:**
A day in which Greg expressed contradictory positions (e.g., "I'm done with this project" in the morning and "I'm excited about the next steps" in the evening) gets summarized as "Greg reflected on his mixed feelings about the project" or "Greg navigated uncertainty." The contradiction is dissolved into a synthesized narrative. This is one of the three absolute forbidden behaviors from the PRD (Section 12): "Never resolve contradictions on its own. Present both and ask which is true now. Never synthesize an evolutionary story." Applied to summaries: a contradiction within a day must be preserved as a contradiction, not resolved into an arc.

**Why it happens:**
Narrative coherence is a summarization instinct. LLMs are trained on well-structured text and will produce well-structured text unless constrained. A day with contradictory entries is presented to Sonnet as a coherent sequence, and Sonnet finds the narrative bridge.

**How to avoid:**
The consolidation prompt must include: "If the entries for this day contain statements that contradict each other — different positions on the same question at different times — preserve both positions explicitly. Do not synthesize them into a single evolved position. Use the format: 'Greg held contradictory positions on [X]: early in the day he said [Y]; later he said [Z]. These were not reconciled.'" Additionally: check the `contradictions` table for any contradiction records whose `created_at` falls within the day's window; if any exist, the consolidation logic must pass them into the summary prompt as "known contradiction flags" to force preservation. This integrates M002 contradiction detection directly into M008 consolidation.

**Warning signs:**
- Days with M002-flagged contradictions produce summaries that do not mention contradiction
- `emotional_arc` field describes a smooth progression when the raw entries show mood reversal
- Summaries for contradiction-flagged days read as coherent narratives instead of dual-position records
- In real use: REFLECT mode synthesizes a life pattern from summaries that does not match what Greg actually believes

**Phase to address:**
Consolidation Engine phase (contradiction injection from M002). Schema phase must ensure the `episodic_summaries` table can hold contradiction references. Integration test must include a day with both a raw contradiction-flagged pair and verify the summary output contains both positions.

---

### Pitfall 5: Importance Score Compression — Rubric Miscalibration

**What goes wrong:**
The importance scoring rubric (1–10) compresses to 4–6 across almost all days. Mundane days score 4 instead of 2. Significant days score 6 instead of 8. The tails of the distribution (1–3, 8–10) are never populated. This makes retrieval routing unreliable: M009 weekly review and M010+ profile inference cannot distinguish genuinely significant days from merely active ones. Life-event-level days (10) are never flagged, so the signals that should drive profile updates are invisible.

**Why it happens:**
LLM calibration to ordinal scales defaults to safe midpoints unless the rubric actively forces distribution. The prompt gives labels (1–3 mundane, 4–6 notable, 7–9 significant, 10 life-event) but does not enforce frequency expectations. Sonnet will anchor to the middle of a labeled range and rarely deviate.

**How to avoid:**
The importance scoring prompt must include explicit frequency guidance: "Scores of 1–3 should apply to days with purely routine entries and no emotional intensity. Scores of 7–9 should apply to roughly 10–20% of days over a sustained period. Score 10 should be rare — fewer than 5% of days in a year. Before assigning a score, compare this day to the highest-intensity days you have seen in this summary session. Do not anchor to the midpoint. Err toward the extremes when the evidence supports it." In the 14-day fixture: the test fixture must include entries spanning the full range — label the ground-truth importance for each day, run consolidation, and assert Pearson r > 0.7 between model scores and labels (as specified in M008). Critically, the fixture must include at least one day labeled 1–2 and one labeled 9–10 to test the tails specifically.

**Warning signs:**
- All 14-day fixture summaries score 4–6 regardless of input intensity
- The standard deviation of importance scores over 30+ real days is below 1.5
- No importance score ever hits 1, 2, 9, or 10 in production
- The Pearson r test passes at r > 0.7 on a fixture whose ground-truth scores are all clustered at 5–6 (a vacuous fixture)

**Phase to address:**
Consolidation Engine phase. The fixture must be designed with full-range ground-truth labels before writing the test, not after. The rubric must be pre-tested in isolation (run the scoring prompt against synthetic entries before integrating into the cron pipeline).

---

### Pitfall 6: Retrieval Routing Collision — Summary vs Raw Confusion at the 7-Day Boundary

**What goes wrong:**
The routing rule is "last 7 days → raw, older → summary first." A query asking "what exactly did I say about X last Wednesday" is a high-fidelity request. If today is Thursday and last Wednesday is 8 days ago, the router sends it to summary, losing verbatim fidelity. Conversely, a query asking "what's been going on with Y over the past few weeks" — a broad synthesis question — falls in the 7-day window and hits raw entries inefficiently. The boundary is not intelligent; it is temporal.

**Why it happens:**
The boundary is defined by recency alone, which is a proxy for the real criterion (fidelity need vs. synthesis need). A 7-day hard cutoff cannot distinguish "tell me exactly what I said" from "give me the pattern."

**How to avoid:**
Routing must be two-dimensional: recency AND query intent. Add a Haiku classifier step before retrieval: "Is this query asking for verbatim fidelity (what exactly did I say/write/express) or for pattern/synthesis/summary?" Route fidelity queries to raw even for entries older than 7 days; route synthesis queries to summaries even within the 7-day window if summaries exist. The 14-day fixture test must include both query types and assert correct routing. Hard-code the explicit-verbatim keywords as a fast path before the Haiku call ("what exactly," "word for word," "what did I say," "precise quote") to avoid the latency cost for obvious cases.

**Warning signs:**
- A query containing "exactly what I said" routes to summaries
- INTERROGATE mode responses for queries about 2-week-old topics quote summaries instead of raw entries
- Greg notices the system gives paraphrase when he asked for his exact words
- The routing test asserts summary-or-raw but not query-intent alignment

**Phase to address:**
Retrieval Routing phase. The two-dimensional routing logic (recency + intent classification) must be built in this phase, not deferred. The query-intent classifier adds one Haiku call — within budget.

---

### Pitfall 7: High-Importance Raw Entry Inaccessibility

**What goes wrong:**
An entry with importance score 9 or 10 from 45 days ago is only reachable through its episodic summary. The summary preserves the gist but not the verbatim text. When INTERROGATE mode asks "what did I write the day I decided to leave the company," it gets the summary's paraphrase, not the exact words Greg wrote in that moment. For life-event-level entries, verbatim fidelity is precisely what matters most.

**Why it happens:**
The routing rule treats all entries older than 7 days identically, regardless of importance. A day-1 journal entry and a day-1 life-event entry are treated the same once outside the recency window.

**How to avoid:**
The routing logic must check the importance score of any summary before deciding whether to surface raw entries: if `importance >= 8`, always include raw entry retrieval alongside the summary, regardless of age. The `source_entry_ids` field on `episodic_summaries` makes this efficient — a JOIN on the summary's source IDs retrieves the raw entries. The retrieval function signature must accept an `importanceThreshold` parameter and enforce raw descent for high-importance days. The 14-day fixture must include a query against a day labeled importance=9 and assert that raw entries are included in the result set.

**Warning signs:**
- Queries about Greg's most significant decisions return only summary text
- REFLECT/PSYCHOLOGY modes synthesize life patterns from summaries without access to raw emotional intensity
- The importance field in `episodic_summaries` is stored but never consulted by the retrieval layer
- Greg cannot find the exact words he wrote during a major life event

**Phase to address:**
Retrieval Routing phase. The importance-based descent rule must be implemented alongside the recency rule, not as a later enhancement.

---

### Pitfall 8: DST Boundary Producing Double or Zero Consolidations

**What goes wrong:**
On the night a DST transition occurs, the cron schedule (anchored to wall-clock time in `config.proactiveTimezone`) fires either twice (clocks fall back: the same wall-clock hour repeats) or not at all (clocks spring forward: the wall-clock hour disappears). This produces either a duplicate row in `episodic_summaries` for the same `summary_date` or a missing row for that date.

**Why it happens:**
Node.js cron libraries (node-cron, cron) schedule against system time. If the container's timezone is set to a DST-observing zone and the cron expression is "end of day" (e.g., 23:45), spring-forward means 23:45 never exists on the transition night. Fall-back means 23:45 exists twice; the first execution runs, and if not guarded by idempotency, the second creates a duplicate.

**How to avoid:**
Two defenses: (1) idempotency at the database level — `episodic_summaries.summary_date` must have a UNIQUE constraint. Any attempt to insert a second row for the same date will fail with a constraint error, which the cron handler catches and logs without crashing. (2) The cron itself should be scheduled in UTC internally and converted to local timezone only for display — use `UTC+0` for the cron expression and compute the local day boundary in the consolidation function. The 14-day fixture test must simulate a DST transition by advancing the mock clock through a known spring-forward boundary and asserting exactly one row per date with no crash on retry.

**Warning signs:**
- `episodic_summaries` has duplicate rows for the same `summary_date` (no unique constraint)
- The cron silently skips a day with no error logged
- Test suite never advances the mock clock through a DST boundary
- Container timezone is a DST-observing zone without UTC-anchored cron

**Phase to address:**
Schema phase (UNIQUE constraint on `summary_date`). Consolidation Engine phase (UTC-internal scheduling). The DST simulation test case belongs in the 14-day fixture.

---

### Pitfall 9: Late-Arriving Entry Exclusion — Sync Gap at Day Boundary

**What goes wrong:**
The source sync cron (Gmail, Google Drive, Immich) runs every 6 hours. The consolidation cron runs at end-of-day. If Greg's Gmail contains entries from during the day that have not yet synced when consolidation fires, those entries are excluded from the summary. The summary for that day is a partial picture. When M009 weekly review reads this summary, it misses Gmail context from that day.

**Why it happens:**
The consolidation window is defined as "all entries WHERE created_at >= day_start AND created_at < day_end." Entries synced after consolidation fires are outside the window even though they are logically part of the day.

**How to avoid:**
Two options: (1) schedule consolidation with a lag buffer — instead of consolidating "today" at 23:45, consolidate "yesterday" at 06:00 the next morning, after the overnight sync has run. This means summaries are available 6 hours into the next day, not at midnight, which is acceptable for M009 weekly review. (2) If same-day summaries are required, implement a "re-consolidate" trigger: when a source sync adds entries to a date that already has a summary, mark the summary as `stale = true` and queue a re-consolidation. Option 1 is simpler and preferred. The fixture test must include a day where one Pensieve entry has `source = 'gmail'` with a `created_at` 4 hours after the other entries, and assert it is included in the summary.

**Warning signs:**
- Gmail/Drive entries from a given day are never represented in that day's episodic summary
- Summaries for days with heavy external source activity are sparse compared to days with only Telegram input
- The test fixture uses only `source = 'telegram'` entries with no external source entries

**Phase to address:**
Consolidation Engine phase. The lag-buffer scheduling decision must be made at cron design time, not retrofitted. The late-arrival fixture case is a required test scenario.

---

### Pitfall 10: Idempotency Violation — Duplicate Summaries on Retry

**What goes wrong:**
The consolidation cron fails mid-execution (network timeout to Anthropic, container restart, DB deadlock). On retry, the function does not check whether a summary for that date already exists. It runs the full Sonnet call, gets a new summary, and inserts a second row. Now `episodic_summaries` has two rows for the same date with different content. Downstream systems (M009 weekly review, retrieval routing) must decide which row is authoritative — and they may not have logic for this.

**Why it happens:**
Cron job retry logic is written for happy-path recovery ("just run again") without considering that partial execution may have committed a row. If the Sonnet call succeeded but the DB insert failed, re-running generates a new Sonnet call and a new (different) summary for the same date.

**How to avoid:**
Idempotency protocol: (1) UNIQUE constraint on `summary_date` at the DB level (see Pitfall 8 — same constraint serves both purposes). (2) The consolidation function must check for an existing row before calling Sonnet: `SELECT id FROM episodic_summaries WHERE summary_date = $date`. If a row exists and `status = 'complete'`, skip. If `status = 'in_progress'` or no status field, the row was partially written — delete it and regenerate. (3) Add a `status` enum column (`in_progress`, `complete`) to `episodic_summaries` to distinguish committed-but-incomplete rows from clean rows. The fixture test must simulate a mid-run interruption by inserting an `in_progress` row for a date and asserting the retry completes correctly without creating a duplicate.

**Warning signs:**
- Two rows in `episodic_summaries` for the same `summary_date` after a container restart
- No UNIQUE constraint on `summary_date` in the schema
- The consolidation function calls Sonnet before checking for an existing row
- Retry after failure generates a different summary for the same day than the first run

**Phase to address:**
Schema phase (UNIQUE constraint, `status` column). Consolidation Engine phase (check-before-call logic, in-progress row handling).

---

### Pitfall 11: Summary Embeddings Polluting Semantic Search

**What goes wrong:**
If the `episodic_summaries` table's summary text is embedded and stored in `pensieve_embeddings` (or a shared embeddings table), semantic search queries will return both raw entry matches and summary matches for the same underlying content. The summary is a transformation of the raw entries. Having both in the same embedding space means a query about "my anxiety last month" might surface the summary's interpretation ("Greg experienced heightened anxiety") at higher cosine similarity than the raw entry ("I feel like I'm coming apart"), because the summary's normalized language matches the query's normalized language better. The raw emotional signal is displaced by the interpreted signal.

**Why it happens:**
Embedding pipelines are often designed to embed all text in a unified table. When summaries are added as a new text source, the natural instinct is to run them through the same embedding pipeline for consistent retrieval.

**How to avoid:**
Summary embeddings must be stored in a separate namespace from Pensieve entry embeddings, OR the retrieval layer must filter by `source_type` to never mix the two in a single similarity ranking. Preferred approach: do NOT embed summaries at all in the same table. Retrieval routing already handles the tiering decision (raw vs. summary) — semantic search within the raw tier should operate only on raw entries. Summary retrieval should be handled by date-range lookup and importance score, not cosine similarity. The 14-day fixture test must verify that a semantic search query against the raw embeddings does not return summary rows.

**Warning signs:**
- `pensieve_embeddings` contains rows whose `entry_id` references `episodic_summaries` rather than `pensieve_entries`
- A similarity search for a phrase from a raw entry returns the summary paraphrase at higher rank than the original
- INTERROGATE mode cites a summary as if it were a direct Pensieve entry

**Phase to address:**
Schema phase (ensure no shared embedding path for summaries). Retrieval Routing phase (assert embedding queries filter by entry source). This is an architectural boundary that must be established before the first summary is written.

---

### Pitfall 12: Summary Text Promoted to Known Facts

**What goes wrong:**
The "Known Facts About Greg" block (D031) is populated from relational_memory and tagged Pensieve entries. If the implementation mistakenly pulls from `episodic_summaries.summary` text as a source for the facts block, interpreted summaries enter the fact-injection layer. "Greg had a difficult week with work-life balance" (a summary interpretation) becomes a Known Fact injected into every subsequent response. This is not a fact — it is an interpretation — and its presence in the fact block violates the D031 structured-fact-over-prose-dump design.

**Why it happens:**
The "Known Facts" block builder may be extended to incorporate episodic context without distinguishing between raw fact-tagged entries and summary interpretations. Summary text reads like factual prose and is easy to mistake for factual content.

**How to avoid:**
The Known Facts block builder must only query: `pensieve_entries WHERE epistemic_tag IN ('FACT', 'DECISION', 'BELIEF')` and `relational_memory`. It must never query `episodic_summaries.summary`. Episodic context, if needed in the prompt, must be injected as a separate labeled block: "Recent Episode Context (interpretation, not fact):" clearly distinguished from "Known Facts About Greg (verbatim):" The integration test for the Known Facts block must assert that no row sourced from `episodic_summaries` appears in the output.

**Warning signs:**
- The Known Facts block contains sentences that do not match any verbatim Pensieve entry text
- Greg notices the system citing interpretations as facts ("you struggled with work-life balance")
- The known-facts query in the codebase JOINs or UNIONs against `episodic_summaries`

**Phase to address:**
Consolidation Engine phase and Retrieval Routing phase. The Known Facts builder query must be audited when summary data is added to the DB. Add a test asserting no episodic_summaries join in the fact builder.

---

### Pitfall 13: Unbounded API Cost — No Skip for Empty Days

**What goes wrong:**
Greg does not send anything to Chris every day. Days with zero Pensieve entries or only a single trivial entry still trigger the consolidation cron, which sends a Sonnet call with an empty or near-empty context. This call costs money and produces a useless summary ("Greg did not record any entries today"). Over time, this is both a cost leak and a signal-to-noise degradation in the summaries table.

**Why it happens:**
The cron is scheduled unconditionally. The consolidation function is written for the happy-path case and does not check entry count before calling Sonnet.

**How to avoid:**
The consolidation function must implement an entry count gate: `SELECT COUNT(*) FROM pensieve_entries WHERE date_trunc('day', created_at AT TIME ZONE $tz) = $date`. If count is 0, skip entirely and do not insert a row (or insert with `status = 'skipped'` for auditability). If count is below a meaningful threshold (e.g., 1 entry under 50 characters), insert a minimal row with `importance = 1` and a note "No significant entries for this day" without calling Sonnet. The fixture test must include a zero-entry day and assert no Sonnet call is made.

**Warning signs:**
- `episodic_summaries` has rows for dates when Greg was offline or traveling
- Anthropic API logs show consolidation calls with near-empty message bodies
- The consolidation function fetches entries after calling Sonnet rather than before

**Phase to address:**
Consolidation Engine phase. The entry-count gate is the first check in the consolidation function, before any LLM call.

---

### Pitfall 14: Backfill Overwhelming Rate Limits

**What goes wrong:**
When M008 first ships, Greg may have months of historical Pensieve entries with no summaries. A backfill operation to generate summaries for all historical days runs all consolidation calls sequentially (or naively in parallel), exhausting Anthropic's rate limits and causing 429 errors that crash the backfill mid-run.

**Why it happens:**
Backfill is typically written as a one-shot script without rate limiting. The consolidation function is designed for one call per day; the backfill runs it N times for N historical days.

**How to avoid:**
The backfill script must implement: (1) rate limiting with a configurable delay between calls (default: 2 seconds between Sonnet calls, tunable via env var). (2) Checkpoint resumption — the backfill records the last successfully processed date in a checkpoint row, so a mid-run crash can resume from where it left off rather than restart from the beginning. (3) Idempotency — the same UNIQUE constraint that protects the live cron protects the backfill: inserting a day that already has a summary is a no-op or a logged skip. The backfill script is not part of the live cron — it is a one-time administrative command, triggered explicitly, not on startup.

**Warning signs:**
- Backfill script has no sleep/delay between calls
- Backfill script re-runs from day 1 on each restart rather than resuming from a checkpoint
- Running the backfill makes the live system unresponsive due to shared rate-limit exhaustion

**Phase to address:**
Consolidation Engine phase. The backfill script is a required deliverable of M008 (Greg needs historical summaries to feed M009 weekly review). It must be designed with rate limiting and resumption from the start.

---

### Pitfall 15: Mocked LLM in Consolidation Tests — Missing Prompt Drift (D032 violation)

**What goes wrong:**
The 14-day fixture tests mock the Sonnet call, returning pre-written summary strings that pass all assertions trivially. The real consolidation prompt may produce hallucinations, flattery, or verbatim-quote violations when run against actual Sonnet, but the test suite never catches it because the LLM response is hardcoded. This is explicitly the failure mode D032 was written to prevent: "Mocked LLM tests cannot catch these failures because they depend on how the real model interprets the system prompt under adversarial conditions."

**Why it happens:**
Mocking the LLM in tests is faster, cheaper, and deterministic. It is the natural choice for a developer writing a test suite. The architectural decision (D032) to require live integration tests exists precisely because this natural choice is insufficient for prompt-level behavior.

**How to avoid:**
The 14-day fixture tests must use a two-layer approach: (1) Deterministic structural assertions (schema shape, UNIQUE constraint, idempotency, routing logic) use mocked Sonnet — these test the wiring, not the prompt. (2) Prompt-level assertions (anti-flattery, verbatim quotes, no hallucination on sparse entries, contradiction preservation, importance calibration) require at least one live-integration test run against real Sonnet, guarded by `ANTHROPIC_API_KEY` availability. Use the same `skipIf(!process.env.ANTHROPIC_API_KEY)` pattern established in M006/M007. The live test suite must run a minimum of 3 representative days (one mundane, one contradiction-flagged, one sparse entry) against real Sonnet and use a Haiku follow-up classifier to assert absence of anti-patterns — mirroring the D023 pattern.

**Warning signs:**
- All consolidation tests import a `vi.mock('../llm/client')` at the top
- No test file contains `ANTHROPIC_API_KEY` gating
- The 14-day fixture passes but running the actual prompt manually produces flattering or hallucinated summaries
- Test coverage shows 100% branch coverage on consolidation logic but no coverage on prompt output

**Phase to address:**
Test phase. The live integration test suite for consolidation prompt behavior is a required M008 deliverable, not an optional addition.

---

### Pitfall 16: Decisions Not Surfaced in That Day's Summary (M007 Integration)

**What goes wrong:**
Greg captures a decision on day N via the M007 decision archive. The end-of-day consolidation for day N does not check the `decisions` table. The episodic summary for day N does not mention that a structural decision was made. When M009 weekly review reads the summaries for the week, it is unaware that a decision was captured — potentially a significant one. The weekly review will not flag it for accountability follow-up unless it also queries the decisions table separately.

**Why it happens:**
The consolidation function queries only `pensieve_entries`. The M007 decisions live in a separate `decisions` table. The two are not linked at consolidation time unless explicitly joined.

**How to avoid:**
The consolidation function must JOIN against the `decisions` table: `SELECT d.* FROM decisions d WHERE d.captured_at >= $day_start AND d.captured_at < $day_end`. If any decisions were captured that day, inject them into the consolidation prompt as a structured section: "Decisions captured today: [decision text, forecast, resolve_by date]." This ensures the summary's importance score reflects decision presence (as specified in the M008 rubric) and that the summary text records the decision for M009/M010 downstream consumers. The fixture test must include a day with a captured decision and assert (1) the decision appears in the summary, and (2) the importance score is >= 7 for that day.

**Warning signs:**
- A day with a structural decision captured via M007 receives an importance score of 4–5
- The episodic summary for a decision day does not mention any decision
- The consolidation query only touches `pensieve_entries` with no JOIN to `decisions`

**Phase to address:**
Consolidation Engine phase. The M007 JOIN is a core feature of the importance scoring rubric, not an enhancement.

---

### Pitfall 17: Open Decision Marked as Resolved in Summary (M007 State Drift)

**What goes wrong:**
A decision is in `PENDING_RESOLUTION` state in the decisions table. The day's Pensieve entries contain Greg discussing the decision context but not resolving it. The consolidation prompt, without explicit state checking, infers from the discussion that the decision was resolved ("Greg made a final decision about X"). The summary now contains a false resolution. If M009 weekly review or M010 profile inference reads this summary, it believes the decision is closed.

**Why it happens:**
Sonnet infers resolution from discussion language. "I've been thinking hard about X and I know what I need to do" reads as resolution even if no formal resolution was recorded in M007.

**How to avoid:**
The consolidation prompt must be given the explicit decision state: "The following decisions are currently in state OPEN or PENDING_RESOLUTION as of this date: [list]. Do not describe any of these as resolved, decided, or completed in the summary unless a Pensieve entry explicitly contains a resolution statement." The `source_entry_ids` for any actual resolution (M007 `RESOLVE` event) must be present in the day's entries for the summary to describe resolution. Inject the `decision_lifecycle_state` alongside the decision text in the consolidation prompt.

**Warning signs:**
- A decision in `PENDING_RESOLUTION` state in the DB is described as "resolved" or "decided" in a summary
- Summaries for days with active open decisions describe them in past tense
- The consolidation prompt receives decision text without decision state metadata

**Phase to address:**
Consolidation Engine phase. The state injection logic is required alongside the M007 JOIN.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Mock all LLM calls in consolidation tests | Fast, deterministic, cheap test suite | Prompt drift invisible; flattery and hallucination accumulate silently | Never for prompt-level assertions; acceptable for structural/wiring tests |
| Skip constitutional preamble in consolidation prompt | Simpler prompt, fewer tokens | Summaries systematically flatter; downstream profile inference inherits bias | Never |
| Use wall-clock time for cron without UTC anchor | Simple cron expression | DST doubles or drops consolidation; duplicate summary rows | Never in production |
| Embed summaries in the same table as raw entries | Consistent retrieval pipeline | Summary interpretations compete with and displace raw signals in semantic search | Never |
| Skip entry-count gate before Sonnet call | Simpler code path | API cost on empty days; noise in summaries table | Never in production |
| Defer idempotency check (UNIQUE constraint) to "later" | Faster initial implementation | Duplicate summaries on first container restart | Never — the constraint must be in the initial schema migration |
| Omit late-arrival buffer for external source sync | Summaries generated closer to midnight | Gmail/Drive entries from that day excluded from summary | Only acceptable if all entries are Telegram-only (not true for Project Chris) |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| M002 Contradiction Detection | Ignoring `contradictions` table in consolidation | Query `contradictions WHERE created_at WITHIN day_window`; inject flagged pairs into prompt with preservation instruction |
| M007 Decision Archive | Querying only `pensieve_entries`, missing `decisions` table | JOIN `decisions` on `captured_at` date range; inject state-aware decision context into consolidation prompt |
| M007 Decision Lifecycle | Inferring resolution from discussion language | Explicitly pass `lifecycle_state` per decision into prompt; forbid summary from stating resolution unless a `RESOLVE` event exists in that day's entries |
| M006 Constitutional Preamble | Assuming the `buildSystemPrompt(mode)` preamble auto-applies to cron jobs | Consolidation cron runs outside the engine; must explicitly include the preamble text |
| D031 Known Facts Block | Pulling summary text into the fact-injection layer | Known Facts builder query must filter to `pensieve_entries` epistemic tags only; never JOIN episodic_summaries |
| Source Sync Cron | Consolidating before overnight sync completes | Schedule consolidation at day+1 06:00 (lag buffer) or implement stale-flag re-consolidation trigger |
| Backfill | Running all historical days sequentially without rate limiting | Implement delay between calls + checkpoint resumption + idempotency guard |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| No entry-count gate before Sonnet call | Sonnet called for empty days; cost grows with calendar days, not activity | Gate on entry count > 0 (and meaningful length) before calling Sonnet | Day 1 — every zero-activity day costs money |
| GIN index on `topics[]` without partial index | Full index scanned on every summary retrieval | Add partial index: `CREATE INDEX ON episodic_summaries USING GIN(topics) WHERE status = 'complete'` | After ~365 rows (one year of summaries), query planner may not use the index efficiently |
| Summary embeddings in same table as raw entries | Semantic search performance degrades; mixed-tier results pollute ranking | Keep summary semantic retrieval as date-range + importance lookup, not cosine similarity | Immediately visible if embeddings are co-mingled |
| Backfill without rate limiting | 429 errors from Anthropic; live cron fails due to shared rate-limit exhaustion | Configurable inter-call delay in backfill script; exponential backoff on 429 | First time backfill is run against more than ~50 historical days |

---

## "Looks Done But Isn't" Checklist

- [ ] **Idempotency:** UNIQUE constraint on `summary_date` verified in migration — not just in application logic. Run two inserts for same date in test; second must fail with constraint error, not silently succeed.
- [ ] **Constitutional Preamble:** Consolidation prompt contains the verbatim anti-sycophancy preamble from M006. Grep the consolidation prompt builder for the first sentence of the constitutional preamble.
- [ ] **Exact Verbatim Quotes:** Every string in `key_quotes` passes exact substring match against at least one source `pensieve_entries.content`. This is a deterministic test — run it in the fixture suite, not manually.
- [ ] **DST Simulation:** 14-day fixture advances mock clock through a spring-forward or fall-back boundary. Assert exactly one row per date. Assert no crash on retry.
- [ ] **High-Importance Raw Descent:** Retrieval function tested with `importance >= 8` day — assert raw entries included in result, not just summary text.
- [ ] **Decision JOIN:** Consolidation query verified to JOIN `decisions` table. Day-with-decision fixture case exists and asserts decision text in summary output and importance >= 7.
- [ ] **Mocking Boundary:** Test file has two clearly separated sections: (1) structural tests with mocked Sonnet; (2) live integration tests guarded by `ANTHROPIC_API_KEY` with real prompt assertions.
- [ ] **Entry-Count Gate:** Zero-entry day test case exists; asserts Sonnet is never called and no row is inserted.
- [ ] **Summary Not in Known Facts:** Known Facts block builder query audited for absence of any JOIN or UNION against `episodic_summaries`.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Sycophantic summaries accumulated for 30+ days | HIGH | Fix prompt; run backfill with corrected prompt (idempotency guard must DELETE existing rows before re-inserting); add a `prompt_version` column to summaries to track which prompt generated each row and enable targeted re-generation |
| Verbatim quotes degraded to paraphrase across historical summaries | MEDIUM | Add exact-substring assertion to CI; fix prompt; re-run backfill for affected date range only (use `prompt_version` or date range) |
| Duplicate summaries from DST or retry failure | LOW | Add UNIQUE constraint via migration; DELETE duplicate rows keeping the row with `created_at` earliest; re-run consolidation for the affected date if a clean row is missing |
| Summary embeddings co-mingled with raw entry embeddings | HIGH | Delete all rows in `pensieve_embeddings` where `entry_id` references `episodic_summaries`; update embedding pipeline to filter; rebuild affected retrieval tests |
| Historical backfill crashed mid-run | LOW | Checkpoint resumption handles this — resume from last checkpoint; if no checkpoint exists, idempotency guard prevents re-processing already-completed dates |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Summary sycophancy / flattery drift (D024) | Consolidation Engine | Live integration test: negative-valence day fixture, Haiku classifier on output detects no positive reframing |
| Verbatim quote paraphrase | Consolidation Engine | Deterministic: exact substring match in 14-day fixture |
| Summary hallucination (sparse entries) | Consolidation Engine | Live integration test: sparse-entry fixture day, Haiku classifier checks for fabricated specifics |
| Contradiction smoothing | Consolidation Engine | Deterministic: contradiction-flagged day fixture, assert dual-position format in output |
| Importance score compression (4–6 clustering) | Consolidation Engine | Pearson r > 0.7 in 14-day fixture with full-range labels including tails |
| Retrieval routing: fidelity vs synthesis confusion | Retrieval Routing | Query-intent classifier test: assert exact-verbatim query routes to raw, synthesis query routes to summary |
| High-importance raw inaccessibility | Retrieval Routing | Fixture: importance=9 day, assert raw entries in result set |
| DST double/zero consolidation | Schema + Consolidation Engine | DST simulation in mock-clock fixture; UNIQUE constraint migration |
| Late-arriving external source entries | Consolidation Engine | Late-arrival fixture case with `source='gmail'` entry after other entries; assert inclusion |
| Idempotency violation on retry | Schema + Consolidation Engine | In-progress row simulation test; assert single row after retry |
| Summary embeddings polluting semantic search | Schema + Retrieval Routing | Assert no `episodic_summaries` rows in `pensieve_embeddings`; verify retrieval filter |
| Summary text in Known Facts block | Consolidation Engine + Retrieval Routing | Assert Known Facts query has no JOIN to `episodic_summaries`; run live integration test checking fact block content |
| Unbounded API cost on empty days | Consolidation Engine | Zero-entry day test; assert no Sonnet call and no row inserted |
| Backfill rate-limit exhaustion | Consolidation Engine | Backfill script code review: verify rate-limiting delay and checkpoint resumption present before running |
| Mocked LLM missing prompt drift (D032) | Test | Verify test file has live-integration section gated on `ANTHROPIC_API_KEY`; 3-of-3 pattern for prompt assertions |
| M007 decisions absent from summary | Consolidation Engine | Decision-day fixture: assert decision text in summary output and importance >= 7 |
| Open decision marked resolved in summary | Consolidation Engine | Open-decision fixture: assert summary does not use resolution language for PENDING_RESOLUTION decisions |

---

## Sources

- Project Chris architecture constraints: `/home/claude/chris/.planning/PROJECT.md` (D004, D006, D018, D023, D024, D027, D031, D032, D033)
- M008 canonical milestone spec: `/home/claude/chris/M008_Episodic_Consolidation.md`
- PRD two-layer doctrine and forbidden behaviors: `/home/claude/chris/PRD_Project_Chris.md` Section 12
- M007 decision archive schema and lifecycle: PROJECT.md Current State (shipped v2.1 summary)
- Sycophancy defense architecture: D024, D025, D027 from Key Decisions
- Hallucination resistance pattern: D031 (structured facts), D032 (live integration tests required)
- Contradiction preservation mandate: PRD Section 7 and Section 12 forbidden behaviors
- False-positive audit pattern: D006, D033

---
*Pitfalls research for: M008 Episodic Consolidation — adding daily episodic summarization to Project Chris*
*Researched: 2026-04-18*
