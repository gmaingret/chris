# Project Research Summary — M008 Episodic Consolidation

**Project:** Project Chris (personal AI Telegram bot, single user Greg)
**Domain:** Tiered memory architecture / personal AI / second-brain
**Researched:** 2026-04-18
**Confidence:** HIGH

## Executive Summary

M008 adds a structured episodic tier between the raw Pensieve store (M001) and future profile inference (M010+). Daily Sonnet consolidation compresses each day's entries into a structured row — importance score 1–10, topics, emotional arc, key quotes, source entry IDs — with recency-routed retrieval: last 7 days stay raw for full fidelity, older periods route to summaries first. The pattern is well-validated by Mem0, HTM-EAR, AWS Bedrock AgentCore, and Park et al. 2023; all converge on the raw/summary tiering boundary and the importance dimensions (emotional intensity, novelty, decision presence, contradiction presence) the M008 spec already names.

The recommended implementation is narrow: **two new direct dependencies** (`zod@^3.24.0` + `@anthropic-ai/sdk@^0.90.0` bump for `messages.parse()` + `zodOutputFormat()`), one new module `src/episodic/`, one new migration `0005_episodic_summaries`, and targeted additions to `src/pensieve/retrieve.ts` and `src/chris/modes/interrogate.ts`. The cron runs as an independent `cron.schedule()` call in `src/index.ts` at 23:00 in `config.proactiveTimezone` — a peer to the proactive sweep, never nested inside it. **TECH-DEBT-19-01 (missing drizzle-kit meta snapshots for migrations 0001/0003) is a mandatory prerequisite to any schema change** and must be resolved before writing migration 0005.

The highest risks are all prompt-level: summary sycophancy (D024), hallucination on sparse entries, contradiction smoothing (D031/PRD §12), and importance score compression toward the midpoint. All four require the M006 constitutional preamble injected explicitly into the consolidation prompt — it does NOT auto-apply to cron jobs that run outside the engine. All four require live integration tests against real Sonnet (D023/D032), not mocked LLM tests. The 14-day synthetic fixture must exercise adversarial cases and assert r > 0.7 importance correlation with full-range ground-truth labels including the tails (1–2 and 9–10 must each appear at least once).

## Key Findings

### Recommended Stack

The existing stack handles M008 with one SDK bump and one new direct dependency. No scheduling library, no NLP library, no third-party LLM helper.

**Core technologies (additions only):**
- `@anthropic-ai/sdk` `^0.80.0` → `^0.90.0` — unlocks `messages.parse()` + `zodOutputFormat()` for zero-parse-failure structured output of the summary schema
- `zod` `^3.24.0` (NOT 4.x) — runtime dep for episodic summary schema; SDK helpers target Zod 3 API
- `luxon` — confirm as direct dep (currently transitive via existing code) for day-boundary UTC arithmetic
- Prompt caching via `cache_control: { type: 'ephemeral' }` on the system prompt block — saves ~90% on system tokens during backfill, free to enable

**Explicitly do NOT add:** `instructor`, `langchain`, `bullmq`/`agenda`/`bull`, `date-fns-tz`, sentiment NLP libraries, Zod 4.x, Anthropic Batch API for the daily cron (Batch API is appropriate only for optional historical backfill of ≥14 days).

### Expected Features

The M008 spec is well-scoped and matches multi-source prior art. No unexpected features surfaced; one implicit clarification (low-activity day handling) is recommended from first principles.

**Must have (M008 core, P1):**
- `episodic_summaries` table: `summary_date DATE UNIQUE`, `summary TEXT`, `importance INTEGER 1–10`, `topics TEXT[]`, `emotional_arc TEXT`, `key_quotes TEXT[]`, `source_entry_ids UUID[]`, `created_at TIMESTAMPTZ`
- UNIQUE index on `summary_date` in initial migration; GIN index on `topics` (M009 weekly aggregation); btree index on `importance` (M010 profile inference)
- Daily consolidation cron at 23:00 `config.proactiveTimezone` — independent `cron.schedule()`, never inside `runSweep`
- Entry-count gate before any Sonnet call (zero entries → no insert, no API cost)
- Importance rubric: anchored scale (1–3 mundane / 4–6 notable / 7–9 significant / 10 life-event) with explicit frequency distribution guidance, chain-of-thought before score, decision-hooks (floors at 6 if a structural decision was captured), contradiction-hooks (floors at 7 if M002 flagged a contradiction)
- Retrieval routing in `src/pensieve/retrieve.ts`: two-dimensional — recency (7-day boundary) AND query intent (verbatim-fidelity → raw always; synthesis → summary first)
- High-importance raw descent: `importance >= 8` always surfaces raw entries alongside summary regardless of age
- 14-day synthetic fixture with full-range ground-truth labels and adversarial cases
- Backfill script with rate limiting (2s delay), checkpoint resumption, idempotency

**Should have (differentiators, ship at launch):**
- Consolidation failure notification via existing `notifyError()` pattern
- `INTERROGATE` mode date-anchored summary context injection for queries about >7-day-old periods

**Defer (M009+ or first real-data validation):**
- `/summary [date]` display command (add after first week of real data)
- `/resummary YYYY-MM-DD` regeneration command (add when first requested)
- `episodic_embeddings` table (M010 if profile inference needs it)
- Traveling-mode timezone override

**Anti-features to reject:** auto-replace summaries on re-run (violates D004 spirit), embedding summary text into `pensieve_embeddings` (pollutes raw-entry semantic search), summary text appearing in Known Facts block (interpretation, not fact — violates D031), weekly summary generated alongside daily (belongs in M009), versioned summaries.

### Architecture Approach

A new `src/episodic/` top-level module mirroring `src/decisions/`. Independent cron in `src/index.ts` alongside the existing proactive-sweep and source-sync crons. Recency routing extends `src/pensieve/retrieve.ts` with two new exports. The engine (`src/chris/engine.ts`) is NOT modified; the only engine-adjacent change is `src/chris/modes/interrogate.ts` for date-anchored summary injection.

**Major components:**
1. **`src/episodic/consolidate.ts`** — `runConsolidate(date)`: entry-count gate → idempotency pre-flight (SELECT) → fetch day's Pensieve entries → fetch M002 contradictions for the day → fetch M007 decisions created/resolved that day with lifecycle_state → Sonnet call with structured Zod output → ON CONFLICT DO NOTHING insert
2. **`src/episodic/prompts.ts`** — system prompt assembling: M006 constitutional preamble + importance rubric with anchors + chain-of-thought instruction + verbatim quote enforcement + contradiction preservation block + M007 lifecycle-state injection block
3. **`src/index.ts`** cron registration — 4-line `cron.schedule()` at 23:00 `config.proactiveTimezone`
4. **`src/pensieve/retrieve.ts`** additions — `getEpisodicSummary(date)`, `getEpisodicSummariesRange(from, to)`, two-dimensional routing in existing query path
5. **`src/chris/modes/interrogate.ts`** — date-extraction (regex/keywords first, Haiku classifier only if regex fails) + summary context injection for queries about >7-day-old periods
6. **`scripts/backfill-episodic.ts`** — operator script, day-by-day sequential, rate-limited

**Files that must NOT be modified (D004 / boundary discipline):**
- `src/pensieve/store.ts` — consolidation never writes to `pensieve_entries`
- `src/proactive/sweep.ts` — consolidation is not a notification channel
- `src/chris/engine.ts` — no new conversational mode
- `src/decisions/` (all files) — read `decisions` table directly via DB query, no decisions module API calls

### Critical Pitfalls

Top 5 of 17 catalogued in PITFALLS.md. The first three are CRITICAL — undetected, they propagate corrupted data upward into M009/M010 with expensive recovery.

1. **Summary sycophancy — CRITICAL (D024)** — The M006 constitutional preamble does NOT auto-apply to cron jobs. The consolidation prompt must include it explicitly. Missing this produces systematically flattering summaries that compound over weeks and corrupt downstream profile inference. Fix at prompt-authoring time in Phase 2.

2. **Verbatim quote erasure + contradiction smoothing — CRITICAL (D031/PRD §12)** — Without explicit instruction, Sonnet paraphrases `key_quotes` and smooths contradictions into coherent narrative arcs. Both violate documented constraints. Prompt must forbid paraphrase for quotes (fixture asserts exact substring match) and inject M002-flagged contradiction pairs with explicit dual-position preservation.

3. **Importance score compression — HIGH** — LLMs anchor to scale midpoints. Rubric must specify expected distribution and require chain-of-thought before scoring. The synthetic fixture must have full-range ground-truth labels with both tails (1–2 and 9–10 each appearing at least once).

4. **Retrieval routing — two dimensions required — HIGH** — The 7-day temporal boundary alone is insufficient. Two override rules must ship in M008 (not deferred): verbatim-fidelity queries always descend to raw regardless of age; `importance >= 8` days always include raw entries alongside summary. These are correctness requirements.

5. **TECH-DEBT-19-01 — build blocker** — Missing drizzle-kit meta snapshots for migrations 0001/0003 mean `drizzle-kit generate` produces a corrupt chain. Must be resolved before Phase 1. No migration 0005 until this is fixed.

## Implications for Roadmap

The 4 researchers proposed slightly different splits (Architecture: 6 phases, Features: 4 phases). Synthesis collapses to **one pre-work item + 4 phases**, driven by hard dependency order.

### Pre-Work: TECH-DEBT-19-01 Resolution

**Rationale:** Cannot write migration 0005 until drizzle-kit meta snapshots for 0001/0003 are regenerated. This is a build blocker, not a planning gate.
**Delivers:** Clean migration lineage; `drizzle-kit generate` works.
**Size:** Small — administrative drizzle-kit commands run against a freshly-migrated Docker Postgres.
**Could be folded into Phase 1 if it's small enough; the planner can decide.**

### Phase 1: Schema + Migration

**Rationale:** All subsequent phases import from `src/db/schema.ts`. Nothing runs until the table exists in Docker.
**Delivers:** `episodic_summaries` table with UNIQUE(summary_date), GIN(topics), btree(importance); migration 0005; `config.ts` `episodicCron` field; Zod schema in `src/episodic/types.ts`.
**Critical constraint:** UNIQUE constraint and GIN/btree indexes must be in the initial migration — not retrofitted later. The architectural boundary that summary text never enters `pensieve_embeddings` is established here.
**Avoids:** Pitfalls 5, 17 (TECH-DEBT-19-01, embedding pollution).

### Phase 2: Consolidation Engine

**Rationale:** The prompt is the highest-risk element of M008. Author, test, and validate it before anything depends on it.
**Delivers:** `src/episodic/consolidate.ts` (runConsolidate, entry-count gate, idempotency pre-flight, Zod parse, ON CONFLICT DO NOTHING insert); `src/episodic/prompts.ts` (constitutional preamble + rubric + chain-of-thought + verbatim quote enforcement + contradiction preservation + M007 lifecycle-state injection).
**M007 read-only integration:** `getDecisionsForDay()` reads `decisions` directly — created AND resolved that day, with `lifecycle_state`.
**M002 read-only integration:** `getContradictionsForDay()` reads `contradictions` for the day window.
**Avoids:** Pitfalls 1, 2, 3, 6, 7, 8 (sycophancy, verbatim erasure, contradiction smoothing, M007 absence, M007 state drift, sparse-entry hallucination).

### Phase 3: Cron Wiring + Retrieval Routing

**Rationale:** Cron wiring needs `runConsolidate` to exist; retrieval routing needs the table to exist. Both depend on Phase 1+2; independent of each other within this phase.
**Delivers:** `src/index.ts` cron registration (4 lines); `getEpisodicSummary` + `getEpisodicSummariesRange` in `src/pensieve/retrieve.ts`; two-dimensional routing (recency + query intent classifier with keyword fast-path); importance ≥ 8 raw descent; `src/chris/modes/interrogate.ts` date-anchored summary context injection.
**Open decision before this phase:** Cron timing — 23:00 same-day (immediate, may miss late Gmail/Drive sync) vs 06:00 next-day (complete summaries, 6-hour delay).
**Avoids:** Pitfalls 4, 9, 10, 11, 12 (DST double-fire, container restart partial state, late-arrival exclusion, retrieval routing failures, query-intent misclassification).

### Phase 4: Test Suite + Backfill Script

**Rationale:** The fixture tests the full pipeline — cannot run until all preceding phases are minimally functional. Backfill script reuses the consolidation function and is the natural place to land it.
**Delivers:** `src/episodic/__tests__/synthetic-fixture.test.ts` (two-layer: mocked-LLM structural tests + live integration tests gated on `ANTHROPIC_API_KEY` per D032); `scripts/backfill-episodic.ts` (rate limiting, checkpoint resumption).
**Required fixture cases:** mundane (importance 1–2), notable, significant (7–9), life-event (10), zero-entry (assert no Sonnet call), decision day (assert importance ≥ 7), contradiction-flagged day (assert dual-position format), sparse entry (assert no hallucinated specifics), negative-valence day (assert no positive reframing), DST spring-forward simulation, idempotency retry, verbatim-fidelity query routing, synthesis query routing, high-importance raw descent.
**Ground-truth importance labels** must be set by Greg before the r > 0.7 test is written — not derived from model output.
**Avoids:** Pitfalls 13, 14, 15, 16 (mocked-LLM blindness, importance label drift, prompt-version regression, backfill rate-limit failure).

## Cross-Cutting Concerns

| Concern | Spans | Resolution Location |
|---------|-------|---------------------|
| Constitutional preamble injection | Stack (prompt caching), Architecture (cron outside engine), Pitfalls (D024) | Phase 2 — explicit include in consolidation prompt |
| D031 structured input/output | Stack (Zod schema), Architecture (structured input block), Pitfalls (hallucination) | Phase 2 — structured entry blocks into prompt; Zod validation on output before insert |
| M007 read-only integration | Features (decision-hooks), Architecture (direct DB query), Pitfalls (decisions absent / state drift) | Phase 2 — direct `decisions` table query with `lifecycle_state` |
| Idempotency (UNIQUE + ON CONFLICT) | Architecture, Features, Pitfalls (DST, retry duplication) | Phase 1 migration + Phase 2 pre-flight SELECT |
| D018/D032 test requirement | Stack (SDK output testing), Features (14-day fixture), Pitfalls (mocked LLM insufficient) | Phase 4 — two-layer mandatory structure |
| TECH-DEBT-19-01 | Stack, Architecture, Pitfalls (build blocker) | Pre-work / Phase 1 |
| Summary text never in Known Facts | Architecture (D031 fact block), Pitfalls (interpretation vs fact) | Phase 2/3 — Known Facts builder query audited; no JOIN to `episodic_summaries` |

## Open Questions for Planning

1. **Cron timing:** 23:00 same-day (immediate summaries, may miss late Gmail sync) vs 06:00 next-day (complete summaries, 6-hour delay). Resolve before Phase 3.
2. **`/summary` display command:** Architecture researcher placed it in M008 Phase 5; Features researcher deferred to M009. Resolve during requirement scoping.
3. **Importance rubric anchor wording:** The exact language for the 1–3 / 4–6 / 7–9 / 10 anchors needs calibration against real Pensieve entries. Review before Phase 4 fixture labels are locked.
4. **Query intent classifier threshold:** When is keyword fast-path sufficient vs Haiku classifier needed? Latency tradeoff. Prototype in Phase 3.
5. **Backfill scope:** Greg has ~5 days of M007 use to backfill. Decide whether backfill ships as part of M008 Phase 4 or is deferred until first real query against >7-day-old data.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | SDK changelog verified; Zod 3 vs 4 constraint confirmed; all existing stack capabilities verified against codebase |
| Features | HIGH | Multi-source validation (Mem0, HTM-EAR, AWS Bedrock, Park et al.). Low-activity day handling from first principles only. |
| Architecture | HIGH | Direct codebase inspection of all integration files (`engine.ts`, `retrieve.ts`, `index.ts`, `decisions/*`, `proactive/*`) |
| Pitfalls | HIGH | All 17 pitfalls grounded in existing D-series constraints and M007 lessons; no speculative pitfalls |

**Overall confidence:** HIGH. The research dimensions converge cleanly on a narrow, well-bounded implementation.
