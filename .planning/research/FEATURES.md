# Feature Research — M008 Episodic Consolidation

**Domain:** End-of-day episodic memory consolidation for a personal AI journal (single user, Telegram bot)
**Researched:** 2026-04-18
**Confidence:** HIGH (architecture questions); MEDIUM (rubric calibration and emotional arc representation); LOW where only training data available

---

## Answers to the Nine Research Questions

### 1. What does "good" episodic summarization look like?

**Length range.** Production systems (Mem0, Memoria, Second Me) converge on summaries that stay below 300 words for a single day. For Chris, the right target is 100–200 words of prose narrative plus structured fields — enough to feed M009 weekly review in one context injection, short enough to stay non-trivial even on light days. A single Sonnet call with a structured output prompt will naturally produce this range.

**Structure.** The evidence points to a hybrid: a short narrative paragraph (2–4 sentences) that reads as a coherent story, plus structured fields (topics, emotional arc, key quotes, importance score). This is what the M008 spec already requires. The narrative paragraph is the human-readable anchor that M009 weekly review and Interrogate mode can reference directly. The structured fields are the machine-readable index that retrieval routing queries.

**Key quote preservation.** This is a differentiator worth doing right. The AWS Bedrock episodic strategy, Mindsera, and the hippocampus-inspired dual-memory work all preserve verbatim fragments from raw entries when they are unusually evocative, emotional, or decision-critical. The correct rule: preserve a quote verbatim if it (a) carries emotional weight not reproducible by paraphrase, (b) is a decision commitment in first person, or (c) contains a specific name, place, date, or number. Limit to 1–3 quotes per day. Key quote extraction is a small addition to the Sonnet consolidation prompt.

**Low-activity days (single entry or zero entries).** This is the most underspecified area in the prior art — no system in the research directly addresses it. The correct pattern, derived from first principles and the "never fabricate" rule, is:

- **Zero entries:** Skip consolidation entirely. Do not insert a summary row for the day. The absence of a row is itself information. The retrieval layer must handle a date gap gracefully (return "no summary found for that date" not an error).
- **Single entry / very short day (< 50 words total):** Generate a minimal summary with a deliberate cap (50 words or less narrative, no padding). Set importance = 1 unless the single entry triggers a higher score on the rubric. Record topics and emotional arc from the one entry. Do not pad with speculative commentary.

---

### 2. Importance scoring rubric

**Dimensions used in practice.** The research converges on four dimensions for personal memory systems: emotional intensity, novelty, decision presence, and contradiction presence. These are exactly what the M008 spec specifies and are validated by:
- Park et al. 2023 Generative Agents: combined recency + importance + relevance scoring
- HTM-EAR: importance weight (0.75) + usage frequency (0.25) for memory management
- Mindsera: Plutchik emotion intensity + topic novelty signals
- LLM-as-judge calibration literature: explicit anchored rubrics prevent score compression

**Calibration to prevent all-5s.** LLMs exhibit strong central-tendency bias when asked to score on a numeric scale without explicit anchors. The fix is well-established: provide labeled anchor examples in the prompt for at least three scale points (low, mid, high). For M008:

```
Score 1–3 (mundane): Normal daily logistics. No decision, no strong emotion, no new information.
  Example: "Had lunch at the usual place, took a walk, worked on email."

Score 4–6 (notable): Moderate emotional content, mild novelty, or a preference update.
  Example: "Frustrated meeting with X; decided to change approach to project Y."

Score 7–9 (significant): Strong emotion, structural decision with forecast, surfaced contradiction,
  or materially new information about self/life trajectory.
  Example: "Realized the pattern with job anxiety goes back to the incident at 22."

Score 10 (life-event): Once-a-year or rarer. Irreversible threshold crossing.
  Example: "Accepted the offer. Moving to Lisbon in six weeks."
```

**Chain-of-thought before score.** The prompt must require reasoning first ("What is the highest-intensity element in today's entries? Is there a decision with a resolve_by date? Is there an unresolved contradiction?") before stating the score. This reduces central-tendency bias measurably (source: Kinde LLM-as-judge calibration, GoDaddy LLM scoring bias research).

**Dependency on existing systems:** Decision presence check hooks into `decisions` table (M007) — query for decisions created on the same day. Contradiction presence hooks into `contradictions` table (M002) — query for contradictions detected on the same day. Both are available as SQL queries at consolidation time.

---

### 3. Recency-routed retrieval patterns

**The "last 7 days raw, older summaries" spec is consistent with prior art.** Multiple production systems validate this boundary:

- Mem0's hierarchical approach: keep recent messages intact, summarize older segments (their example: last 10 messages raw, older summaries). Days-based rather than message-based for Chris is the right adaptation for a journal use case.
- HTM-EAR: L1 (working memory with recent entries) vs L2 (archival summaries), with queries hitting L1 first and falling back to L2 only when L1 fails the similarity threshold.
- The AWS Bedrock episodic strategy: "within-session" vs "cross-session" is the same raw/summary split in session terms.

**7 days is the right boundary for Chris.** Rationale: Greg's proactive sweep uses a 14-day silence baseline. The 7-day raw window ensures that anything in the current week is always retrieved with full fidelity, matching user expectation. After 7 days, summaries are good enough for conversational context and significantly cheaper to inject.

**Routing implementation.** The existing `hybridSearch` and `getTemporalPensieve` in `src/pensieve/retrieve.ts` handle raw entry queries. M008 adds a parallel `searchEpisodicSummaries(query, cutoffDate)` function. The routing logic in retrieve.ts should be:

```
if (query date range intersects last 7 days) → hybridSearch against pensieve_entries
if (query date range is older than 7 days) → searchEpisodicSummaries first,
  descend to pensieve_entries only if summary contains explicit "see raw entry" flag
  or if query is an Interrogate-mode request for verbatim content
```

The 7-day boundary should be computed in `config.proactiveTimezone` (Greg's local timezone), not UTC, to avoid cross-midnight boundary mismatches.

---

### 4. Topic extraction

**Open-ended with soft clustering is the right pattern.** Fixed taxonomies fail for personal journals because they impose structure that the user's life does not fit. Pure open-ended extraction produces inconsistent topic labels that are hard to aggregate. The right hybrid:

- Ask Sonnet to extract 2–5 short topic labels in free-form lowercase English (e.g., "work frustration", "paris apartment", "running", "relationship with father").
- Store as `text[]` in the schema — already in the M008 spec.
- At retrieval time, treat topics as soft signals for filtering (similarity match, not exact match).
- M009 weekly review aggregates topics across 7 daily summaries to surface the week's dominant themes.

**What to avoid:** Forcing topics into a fixed taxonomy at write time. Taxonomies are better applied at read time (M010+ operational profiles) when the aggregation layer is available.

---

### 5. Emotional arc representation

**Single-line narrative is the right choice for M008.** The evidence from Mindsera (Plutchik emotion bubbles), the cognitive neuroscience literature (valence trajectory), and AWS Bedrock (situation/intent/reflection) all converge on: for daily granularity, a short narrative arc is more useful than a numeric trajectory because:

1. A single day rarely has enough temporal resolution to make a valence trajectory meaningful.
2. Named-emotion tags (Plutchik: joy, trust, fear, surprise, sadness, disgust, anger, anticipation) are useful for aggregation but the M008 schema stores them as free-text `emotional_arc`, which can be a Plutchik label if the day warrants it.

**Recommended prompt instruction:** "Describe the emotional arc of the day in one sentence. Use the dominant emotion at the start of the day, how it shifted, and where it landed. If the day was emotionally flat, say so directly."

**Examples:**
- "Started frustrated (work blocks), shifted to relief after the call with X, ended calm."
- "Consistently anxious throughout — low-grade background fear about the visa."
- "Flat and productive. No notable emotional events."

**Complexity:** Small — it is a single prompt instruction, not a separate classification call.

---

### 6. Idempotency and re-runs

**Pattern: skip on existing row, explicit `/resummary YYYY-MM-DD` for replace.** The research strongly supports a skip-first idempotency model:

- The "at-least-once" cron delivery guarantee (Google Cloud Scheduler docs, AWS EventBridge) means every cron-triggered pipeline must handle duplicate execution gracefully.
- The existing proactive sweep uses `hasSentToday()` as an idempotency gate (see `src/proactive/state.ts`). M008 should follow the same pattern.
- The automatic memory consolidation literature (openclaw-auto-dream, idempotent pipelines) recommends overwriting the entire partition on re-run — but for append-only systems like Chris (D004), the correct translation is: insert is guarded by a unique index on `summary_date`, retry returns the existing row.

**Concrete implementation:**
```sql
CREATE UNIQUE INDEX episodic_summaries_summary_date_unique ON episodic_summaries (summary_date);
```

The consolidation function:
1. Check if a row for `summary_date` already exists.
2. If yes → return existing row, log `episodic.consolidation.skip`.
3. If no → run Sonnet, insert, return new row.

**Re-run for correction:** Provide an explicit `/resummary YYYY-MM-DD` command (or `force: true` flag in the consolidation function) that deletes the existing row and re-runs. This is a conscious choice to override, not automatic. Never auto-replace — if Sonnet had an unusually bad day, an auto-replace could silently degrade a good summary.

**Complexity:** Small — unique index + guard query.

---

### 7. Timezone boundary handling for "end of day"

**The problem.** Greg's timezone is `Europe/Paris` (CET/CEST, UTC+1/UTC+2). The pensieve_entries table stores all timestamps as `timestamptz` (UTC). The consolidation cron must define "today's entries" as entries whose `created_at` falls within the wall-clock day in `Europe/Paris`, not in UTC.

**DST transitions.** Paris observes DST (last Sunday of March and October). On DST spring-forward night, the day is 23 hours long. On fall-back night, the day is 25 hours long. The standard advice (confirmed by Red Hat, AWS EventBridge, inventivehq cron guide) is: never schedule at 1–3 AM during DST transition windows. Schedule consolidation at a safe time like 10 PM or 11 PM local time.

**Safe pattern for Chris:**
- Cron expression: `0 22 * * *` (10 PM) with `timezone: config.proactiveTimezone` — matches the existing proactive sweep pattern in `src/index.ts` (line 78: `{ timezone: config.proactiveTimezone }`).
- At execution time, compute the day boundary using `Intl.DateTimeFormat` to get the wall-clock date in `Europe/Paris` (same approach already used in `src/proactive/state.ts` lines 54–65 for `hasSentToday`).
- Query: `WHERE created_at >= <start_of_day_UTC> AND created_at < <end_of_day_UTC>` where start/end are computed from `Europe/Paris` midnight boundaries in UTC.
- If Greg sends a message at 11:50 PM and consolidation runs at 10 PM, that message is not yet in the day's summary. This is acceptable — 10 PM is a reasonable "end of day" for journaling purposes. A next-day backfill pass (see below) catches any late entries.

**Traveling users (future consideration, not M008).** If Greg is in a different timezone, the consolidation boundary might be wrong. For M008, this is not a problem — `config.proactiveTimezone` is Greg's configured home timezone and he is a single user. A "traveling mode" timezone override is a potential M010 operational profile feature, not M008.

**Complexity:** Small — follow the existing `state.ts` pattern exactly. The timezone conversion code already exists.

---

### 8. Backfill strategy

**Day-by-day sequential is the right pattern.** Rationale:

- A "one big batch" backfill risks: (a) exhausting Sonnet rate limits, (b) inserting records out of order (problematic if M009 weekly review runs concurrently), (c) making it hard to resume after an interruption.
- "Deferred indefinitely" leaves the retrieval routing broken for historical queries until the backfill runs.
- Day-by-day with a configurable `--from YYYY-MM-DD --to YYYY-MM-DD` flag and a brief sleep between days (100–500ms) is the correct implementation pattern from idempotent pipeline literature.

**Concrete backfill implementation:**
```
node scripts/backfill-episodic.ts --from 2026-01-01 --to 2026-04-17
```
The script:
1. Enumerates all calendar dates in the range with at least one Pensieve entry.
2. For each date, calls the same `consolidateDay(date)` function that the cron uses.
3. Skips dates that already have a summary row (idempotent, inherits the unique index guard).
4. Logs progress: `[N/Total] YYYY-MM-DD: importance=X, topics=[...]`.
5. Brief sleep between days to avoid Sonnet rate-limit bursts.

**For Chris specifically:** Greg has been using Chris since v1.0 (2026-04-13 ship). There are approximately 5 days of history as of M008 implementation. The backfill is trivial — 5 sequential consolidation calls at implementation time. The script should exist anyway for resilience against future cron failures.

**Complexity:** Small — mostly reuse of the consolidation function with a date-range loop.

---

### 9. Table stakes vs differentiators vs anti-features

See the structured sections below.

---

## Feature Landscape

### Table Stakes (Greg Expects These)

Features that M008 must have for the episodic tier to be functional. Missing any of these means M009 weekly review cannot run and retrieval is broken.

| Feature | Why Expected | Complexity | Dependencies |
|---------|--------------|------------|--------------|
| `episodic_summaries` table with date-partitioned rows | Without the storage layer, nothing else works. Schema is already specified in M008 spec. | SMALL | Drizzle schema extension; new migration; TECH-DEBT-19-01 (drizzle-kit meta snapshots) must be addressed when modifying `schema.ts` |
| Daily consolidation cron (end-of-day, timezone-aware) | The whole feature is cadence-driven. Without the cron, summaries only exist if triggered manually. | SMALL | `node-cron` already used in `src/sync/scheduler.ts`; `config.proactiveTimezone` already set; follow `src/index.ts:78` pattern for timezone |
| Importance score 1–10 with anchored rubric | M009 weekly review and M010+ profile inference both need an importance signal to weight days. A rubric that produces all-5s is worthless. | SMALL | Sonnet consolidation prompt; decision presence check via `decisions` table (M007); contradiction presence check via `contradictions` table (M002) |
| Retrieval routing: raw (≤7 days) vs summaries (>7 days) | This is the core performance contract of M008. Without routing, retrieval over older data degrades as Pensieve grows. | MEDIUM | Modifies `src/pensieve/retrieve.ts`; new `searchEpisodicSummaries` function; 7-day boundary in `config.proactiveTimezone` |
| Idempotency via unique index on `summary_date` | Cron delivers at-least-once. Without idempotency, a crashed job produces duplicate summaries. | SMALL | Unique index in migration; guard query in consolidation function |
| Skip (not error) on zero-entry days | Absence of entries is data, not an error. The retrieval layer must handle date gaps gracefully. | SMALL | Consolidation function: count entries before running Sonnet; if zero, return early with no insert |
| Topics as `text[]` stored on each summary row | M009 weekly review needs topics to produce "week's dominant themes". | SMALL | Sonnet prompt instruction; Drizzle `text('topics').array()` column |
| Emotional arc as single-sentence `text` field | Used by M009 weekly review for weekly emotional pattern synthesis. | SMALL | Sonnet prompt instruction |
| Key quotes as `text[]` (1–3 per day) | Prevents loss of evocative or decision-critical verbatim text in the compression step. | SMALL | Sonnet prompt instruction with explicit quote selection criteria |
| Source entry IDs as `uuid[]` | Provenance — allows descending from summary to raw entry in Interrogate mode. Required by D004 (append-only, no data loss). | SMALL | `source_entry_ids uuid[]` column; populated from the day's entry query |
| Synthetic 14-day fixture test | Every M008 milestone requires a synthetic test at the appropriate cadence. Required by the sequencing rule in PROJECT.md. | MEDIUM | `vi.setSystemTime` clock mock; 14 varied fixture days; assertions: importance correlation r>0.7, routing correctness, idempotency, timezone boundary |

### Differentiators (Make M008 Better Than Baseline)

Features beyond the structural minimum that make the episodic tier genuinely useful for Greg.

| Feature | Value Proposition | Complexity | Dependencies |
|---------|-------------------|------------|--------------|
| Decision-hooks in importance scoring | A day containing a captured decision automatically floors importance at 6. This directly surfaces the M007 decision archive in the importance signal. Greg's most important days are decision days. | SMALL | Query `decisions` table for `created_at` on the consolidation date; no new logic, just an additional scoring condition in the prompt |
| Contradiction-hooks in importance scoring | A day on which a contradiction was detected floors importance at 7. Contradictions are by definition notable. | SMALL | Query `contradictions` table for `detected_at` on the consolidation date; same pattern as decision-hooks |
| Chain-of-thought before score in Sonnet prompt | Forces reasoning before the score is assigned. Measurably reduces central-tendency (all-5s) bias. | SMALL | Prompt engineering only; no schema or code change |
| Named anchor examples in importance rubric | Provides labeled examples for score 1–3, 4–6, 7–9, 10. Prevents score compression without needing a calibration dataset. | SMALL | Prompt engineering only |
| `/resummary YYYY-MM-DD` command | Allows Greg to trigger re-consolidation of a specific day (e.g., after adding retrospective entries). Critical for an append-only system where memory is deposited retrospectively. | MEDIUM | New Telegram command handler; `force: true` flag in consolidation function; delete + re-insert path |
| Backfill script (`scripts/backfill-episodic.ts`) | Fills historical summaries from before M008 was deployed. Without it, the first weeks of data have no episodic tier. | SMALL | Reuse consolidation function; `--from --to` date range flags; idempotent (skips existing rows) |
| Consolidation failure notification via Telegram | If consolidation fails (Sonnet API error, DB write failure), Greg gets a Telegram notification. Follows the existing pattern in `src/sync/scheduler.ts:notifyError()`. | SMALL | Reuse existing `notifyError` function |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Better Approach |
|---------|---------------|-----------------|-----------------|
| Auto-replace summaries on re-run | "Keeps summaries fresh if more entries arrive" | Violates D004 (append-only mindset); silently overwrites potentially good summaries with bad ones; Sonnet non-determinism means re-runs produce different output, not necessarily better. | Explicit `/resummary YYYY-MM-DD` command for intentional regeneration only. |
| Embedding the summary text (adding summary to pensieve_embeddings) | "Makes summaries searchable by semantic similarity" | Summaries are not raw memory — they are compressed representations. Mixing them into the same embedding index as raw entries pollutes the fidelity of semantic search. The vector space should represent Greg's actual words, not summaries of them. | Keep episodic summaries in their own table. Route routing logic (raw vs summary) by date, not by cosine. When M009+ needs summary-level semantic search, add a separate `episodic_embeddings` table. This is intentionally deferred beyond M008. |
| Versioned summaries (keep all re-runs) | "Audit trail of how summaries changed" | Complexity far exceeds value for a single-user personal journal. Re-run summaries for the same day differ only due to Sonnet non-determinism, not because the underlying data changed. | Single row per date, explicit replace on `/resummary`. If Greg needs to see what changed, the Pensieve raw entries are always preserved. |
| Weekly summary generated at the same time as daily summary | "More efficient to generate both at once" | Conflates two distinct abstraction levels. Weekly summaries depend on all 7 daily summaries being complete — generating them simultaneously with the last daily summary is fragile (race condition if any of the 7 days failed). | Weekly summaries belong in M009. Daily consolidation (M008) generates only daily summaries. |
| Importance scoring by a separate Haiku classifier call | "Cheaper than Sonnet for just a number" | Haiku lacks sufficient context window reasoning for importance judgment — it needs the full day's entries plus rubric anchors plus chain-of-thought. The importance score is generated in the same Sonnet call as the summary, not as a separate call. | Include importance as a required output field in the Sonnet consolidation prompt's structured output schema. One call, not two. |
| Real-time (per-message) mini-summaries | "Capture context while it's fresh" | Dramatically increases Sonnet API cost (call per message vs call per day). The Pensieve raw store already preserves everything — the episodic tier is a batch compression layer, not a real-time annotation layer. | Keep consolidation batch at end of day. The raw Pensieve is the real-time layer. |
| User-facing summary display in the bot | "Let Greg read today's summary" | Not an M008 requirement. Adds a display command and formatting logic that belongs in M009 ritual infrastructure. M008 is a data layer, not a user-facing feature. | Add to M009 as part of daily ritual UI. M008 only writes; M009 reads. |

---

## Feature Dependencies

```
[M007 decisions table]
    └──feeds──> [importance scoring (decision-hooks)]

[M002 contradictions table]
    └──feeds──> [importance scoring (contradiction-hooks)]

[pensieve_entries (M001)]
    └──feeds──> [daily consolidation cron]
                    └──produces──> [episodic_summaries table]
                                       └──feeds──> [recency routing in retrieve.ts]
                                       └──feeds──> [M009 weekly review]
                                       └──feeds──> [M010+ profile inference]

[config.proactiveTimezone (M004)]
    └──used by──> [day boundary computation]
    └──used by──> [consolidation cron scheduling]

[src/proactive/state.ts hasSentToday() pattern (M004)]
    └──pattern reused by──> [idempotency gate in consolidation function]

[src/sync/scheduler.ts notifyError() pattern (M003)]
    └──pattern reused by──> [consolidation failure notification]

[node-cron (already in package.json)]
    └──used by──> [consolidation cron, same as proactive sweep cron]

[synthetic fixture test (14-day clock mock)]
    └──requires──> [all above components complete before test suite runs]
```

### Dependency Notes

- **importance scoring requires M007 decisions table:** Without M007, decision-hooks cannot fire. M008 follows M007 in the milestone sequence so this dependency is satisfied. The hook should degrade gracefully (no decision rows = no boost, not an error).
- **importance scoring requires M002 contradictions table:** M002 is shipped. The contradiction query is a simple `SELECT COUNT(*) WHERE detected_at BETWEEN day_start AND day_end`.
- **retrieval routing requires episodic_summaries table:** M008 creates this table. The routing logic in `retrieve.ts` can be added in the same milestone.
- **M009 requires at least a few real days of M008 summaries:** Per PROJECT.md pause requirement. M009 should not start until there are 3–5 real summaries to validate the pipeline end-to-end.

---

## MVP Definition

### Launch With (M008 Core)

- [x] `episodic_summaries` schema + migration (date, summary, importance 1–10, topics[], emotional_arc, key_quotes[], source_entry_ids[], created_at)
- [x] Unique index on `summary_date` (idempotency)
- [x] Consolidation function `consolidateDay(date: Date)`: query entries, run Sonnet, insert row, return idempotently
- [x] Daily cron at 10 PM `config.proactiveTimezone` using existing `node-cron` + timezone pattern
- [x] Importance rubric with anchors (1–3/4–6/7–9/10), chain-of-thought, decision-hooks, contradiction-hooks
- [x] Skip (no insert) on zero-entry days
- [x] Retrieval routing in `retrieve.ts`: ≤7 days → raw entries, >7 days → summaries first
- [x] Synthetic 14-day fixture test (r>0.7 correlation, routing correctness, idempotency, timezone boundary)
- [x] Backfill script (`scripts/backfill-episodic.ts`) with `--from --to` date range
- [x] Consolidation failure notification via existing `notifyError` pattern

### Add After Real-Data Validation (v2.2.1 or M009 prep)

- [ ] `/resummary YYYY-MM-DD` Telegram command — add once Greg has used the system long enough to want to correct a summary (trigger: first time Greg manually wants to regenerate a summary)
- [ ] `searchEpisodicSummaries` semantic search function — add when M009 weekly review needs to query across summaries by topic (trigger: M009 implementation start)

### Future Consideration (M010+)

- [ ] Separate `episodic_embeddings` table for semantic search across summaries (trigger: M010 operational profile inference needs to query "what kind of days were in the last month")
- [ ] Timezone override for traveling (trigger: Greg reports consolidation boundaries are wrong when traveling)
- [ ] Summary confidence/quality score (trigger: if `/resummary` is invoked frequently, indicating systematic quality issues)

---

## Feature Prioritization Matrix

| Feature | Greg Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| `episodic_summaries` schema + migration | HIGH | LOW | P1 |
| Daily consolidation cron (timezone-aware) | HIGH | LOW | P1 |
| Importance rubric with anchors + hooks | HIGH | LOW | P1 |
| Retrieval routing (raw vs summaries) | HIGH | MEDIUM | P1 |
| Idempotency (unique index + guard) | HIGH | LOW | P1 |
| Skip on zero-entry days | MEDIUM | LOW | P1 |
| Synthetic 14-day fixture test | HIGH (required by sequencing rule) | MEDIUM | P1 |
| Backfill script | MEDIUM | LOW | P1 |
| Key quote preservation | MEDIUM | LOW | P1 |
| Decision-hooks in scoring | HIGH | LOW | P1 |
| Contradiction-hooks in scoring | MEDIUM | LOW | P1 |
| Chain-of-thought in rubric prompt | HIGH | LOW | P1 |
| `/resummary YYYY-MM-DD` command | MEDIUM | MEDIUM | P2 |
| Consolidation failure notification | MEDIUM | LOW | P2 |
| Episodic semantic search (separate embeddings) | LOW (M010 need) | MEDIUM | P3 |
| Versioned summaries | LOW | HIGH | P3 (anti-feature) |

---

## Existing Systems M008 Builds On

| Existing System | How M008 Uses It |
|----------------|------------------|
| `pensieve_entries` (M001) | Source of entries for consolidation; `source_entry_ids[]` back-references these |
| `pensieve_entries.epistemic_tag` (M001) | Could weight EMOTION/DECISION tags higher in importance rubric |
| `contradictions` table (M002) | Contradiction-hook: count contradictions detected on the same day to boost importance |
| `config.proactiveTimezone` (M004) | All day-boundary computations use this; cron scheduling uses this |
| `hasSentToday()` pattern in `src/proactive/state.ts` (M004) | Idempotency gate pattern to reuse |
| `notifyError()` in `src/sync/scheduler.ts` (M003) | Error notification pattern to reuse |
| `node-cron` with timezone option in `src/index.ts:78` (M004) | Cron scheduling pattern to follow exactly |
| `decisions` table (M007) | Decision-hook: count decisions created on the same day to floor importance |
| Drizzle ORM + drizzle-kit (M001) | Schema extension; note TECH-DEBT-19-01 (missing meta snapshots for migrations 0001/0003) is triggered by any schema.ts modification |
| Three-tier LLM (D001) | Consolidation uses Sonnet (not Haiku) — too much reasoning for Haiku, not worth Opus for daily summaries |

---

## Confidence Assessment

| Area | Confidence | Reason |
|------|------------|--------|
| Table schema | HIGH | Directly specified in M008 spec; consistent with all prior art |
| Importance rubric dimensions | HIGH | Multi-source validation (Park et al., HTM-EAR, Mindsera, AWS Bedrock) |
| Rubric calibration (anchors + CoT) | HIGH | Well-documented in LLM-as-judge literature; GoDaddy, Kinde calibration guides |
| Retrieval routing (7-day boundary) | HIGH | Consistent across Mem0, HTM-EAR, AWS Bedrock patterns |
| Idempotency pattern (unique index) | HIGH | Standard distributed systems pattern; matches existing proactive sweep |
| Timezone handling (use existing pattern) | HIGH | `src/proactive/state.ts` already does this correctly |
| Emotional arc (single-sentence narrative) | MEDIUM | Mindsera does this; AWS Bedrock does structured arc; exact format for Chris is a design choice |
| Topic extraction (free-form labels) | MEDIUM | Multiple systems use this; exact prompt wording needs iteration |
| Backfill strategy (day-by-day) | MEDIUM | Derived from idempotent pipeline literature; no direct personal AI backfill examples found |
| Low-activity day handling | LOW | No direct prior art found; recommendation derived from first principles + "never fabricate" rule |

---

## Sources

- Mem0 Memory Types documentation: https://docs.mem0.ai/core-concepts/memory-types
- Mem0 LLM Chat History Summarization Guide: https://mem0.ai/blog/llm-chat-history-summarization-guide-2025
- HTM-EAR: Importance-Preserving Tiered Memory with Hybrid Routing: https://arxiv.org/html/2603.10032
- AWS Bedrock AgentCore Episodic Memory Strategy: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/episodic-memory-strategy.html
- Mindsera 2.0 AI Journaling Features: https://www.mindsera.com/articles/introducing-mindsera-2-0
- Kinde LLM-as-Judge Calibration: https://www.kinde.com/learn/ai-for-software-engineering/best-practice/llm-as-a-judge-done-right-calibrating-guarding-debiasing-your-evaluators/
- GoDaddy LLM Score Calibration: https://www.godaddy.com/resources/news/calibrating-scores-of-llm-as-a-judge
- Automatic memory consolidation (openclaw-auto-dream): https://github.com/LeoYeAI/openclaw-auto-dream
- Idempotent Pipelines: Build Once, Run Safely Forever: https://dev.to/alexmercedcoder/idempotent-pipelines-build-once-run-safely-forever-2o2o
- How cron handles DST (Healthchecks.io): https://blog.healthchecks.io/2021/10/how-debian-cron-handles-dst-transitions/
- AI-native Memory 2.0 — Second Me: https://arxiv.org/html/2503.08102v1
- Park et al. 2023 Generative Agents (recency + importance + relevance retrieval score): https://arxiv.org/html/2512.23343v1
- Memoria scalable agentic memory framework: https://arxiv.org/html/2512.12686v1
- MemMachine ground-truth-preserving memory: https://arxiv.org/html/2604.04853

---

*Feature research for: M008 Episodic Consolidation, Project Chris*
*Researched: 2026-04-18*
