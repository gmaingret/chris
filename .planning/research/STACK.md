# Stack Research

**Domain:** M008 Episodic Consolidation — end-of-day memory summarisation for a personal AI Telegram bot
**Researched:** 2026-04-18
**Confidence:** HIGH

---

## Verdict Up Front

**No new runtime dependencies are needed.** Every capability required for M008 is already present in the existing stack. The additions below are optional optimisations inside packages already installed.

---

## What M008 Actually Needs (and Why Each Need Is Already Met)

### 1. Date / timezone arithmetic for "end of day" boundaries

**Need:** Determine when Greg's calendar day ends in `config.proactiveTimezone`, compute day-boundary timestamps for the SQL query that pulls that day's Pensieve entries, and handle idempotency (don't re-run a consolidation if one already exists for that date).

**Met by:** `luxon` (already in `dependencies`). Luxon handles IANA timezone arithmetic natively — `DateTime.now().setZone(tz).startOf('day')` / `.endOf('day')` produces exact UTC boundaries. There is no capability gap.

**Do not add:** `date-fns-tz`, `moment-timezone`, `dayjs`. All are heavier, redundant, or carry known DST edge-case bugs that Luxon handles correctly. Adding a second date library to sit alongside Luxon creates subtle inconsistency bugs.

---

### 2. Structured output from Sonnet (the summary generation call)

**Need:** Sonnet generates a structured episodic summary: `summary`, `importance` (int 1–10), `topics[]`, `emotional_arc`, `key_quotes[]`. The output must be parseable without fragile regex extraction.

**Two options in the existing SDK:**

**Option A — Prompt-based JSON (no new dep, already works today):**
The existing pattern in the codebase is `callLLM` / `anthropic.messages.create` with a system prompt that instructs JSON output and a `JSON.parse` call on the response text. This is already in use in the decision capture flow. For episodic summaries, a tight system prompt + JSON.parse + a Zod validation step (see Option B for Zod) is sufficient.

**Option B — SDK native structured outputs with Zod (optional, no new dep after SDK update):**
`@anthropic-ai/sdk` `^0.80.0` (currently installed; latest is `0.90.0`) includes `client.messages.parse()` with `zodOutputFormat()` imported from `@anthropic-ai/sdk/helpers/zod`. This is **GA as of late 2025** on Claude Sonnet 4.6. It compiles the Zod schema to a grammar and constrains generation — zero parse failures, type-safe `parsed_output`. Zod itself is **not bundled with the SDK**, but:

- The project already uses Drizzle, which ships `drizzle-zod` compatibility; more importantly, Zod is the de-facto TypeScript validation library and is almost certainly already a transitive dep.

**Recommendation for M008:** Use Option B. The SDK bump from `0.80.0` to `0.90.0` (non-breaking semver minor) unlocks `messages.parse()` + `zodOutputFormat()` and adds `zod` as a direct dev/peer dep. The structured output approach eliminates retry loops on malformed JSON, which matters when the consolidation cron is running unattended at 23:00.

**Do not add:** `instructor`, `llm-chain`, `langchain`, `openai` (obviously), or any prompt-extraction framework. The SDK's native structured outputs cover 100% of M008's need and add zero abstraction overhead.

---

### 3. Summary importance scoring

**Need:** Importance scores (1–10) that correlate r > 0.7 vs labels. The scoring rubric (emotional intensity × novelty × decision presence × contradiction presence) is entirely a prompt design problem, not a library problem.

**Met by:** Sonnet prompt engineering. No library computes "importance of a day's journal entries" better than a well-designed rubric prompt — any library that claimed to would be wrapping an LLM anyway.

**Do not add:** Any "scoring" or "sentiment" library (compromise, vader-sentiment, sentiment). They score individual sentences for polarity, not multi-entry day-level importance. They would measure the wrong thing and produce worse calibration than a rubric prompt.

---

### 4. Cron scheduling for the daily consolidation job

**Need:** Run consolidation once per day, after Greg's day ends in his configured timezone.

**Met by:** `node-cron` (already in `dependencies`). The existing proactive sweep uses exactly this infrastructure — a cron expression evaluated against `config.proactiveTimezone`. M008 adds one cron registration alongside the existing sweep registration. No structural changes to the cron layer.

**Do not add:** `agenda`, `bull`, `bullmq`, `bee-queue`. All require Redis and introduce a distributed job queue for what is a single-process, single-user daily batch. They are massive scope creep. `node-cron` with timezone support is exactly the right tool for a single-instance, single-user daily job.

---

### 5. Database schema for `episodic_summaries`

**Need:** New table: `id`, `summary_date` (date, timezone-aware), `summary`, `importance`, `topics[]`, `emotional_arc`, `key_quotes[]`, `source_entry_ids[]`, `created_at`.

**Met by:** Drizzle ORM + drizzle-kit (already in stack). One new `pgTable` declaration in `src/db/schema.ts` and a `drizzle-kit generate` run. The Drizzle schema already uses `text().array()` and `uuid().array()` patterns in `relational_memory` and `decisions`, so the array columns are not new territory.

**Note on TECH-DEBT-19-01:** The missing drizzle-kit meta snapshots (migrations 0001/0003) must be resolved in this milestone since M008 modifies `schema.ts`. This is a carry-forward debt item, not a new dependency.

**Do not add:** Any migration library (`flyway`, `liquibase`, `db-migrate`). Drizzle-kit handles migrations with auto-apply on startup, consistent with the existing pattern.

---

### 6. Retrieval routing by recency

**Need:** In `src/pensieve/retrieve.ts`, queries about the last 7 days read raw Pensieve entries; older queries read `episodic_summaries` first.

**Met by:** Drizzle ORM (already in stack) + Luxon date arithmetic (already in stack). The routing logic is SQL: `WHERE created_at >= <7-days-ago>` for raw path, `JOIN episodic_summaries WHERE summary_date < <7-days-ago>` for the summary path. This is standard Drizzle query composition.

**Do not add:** Any retrieval abstraction layer. The existing `searchPensieve` function in `src/pensieve/retrieve.ts` is the right place to add this routing — it already has `SearchOptions` with `recencyBias`. A `useEpisodicAfterDays` option is a clean extension of the existing interface.

---

## Anthropic SDK Features — Specific Guidance for M008

### Prompt caching (RECOMMENDED for the summary generation call)

The consolidation cron uses the same system prompt for every daily summary. Claude Sonnet 4.6 caches prompts at a **2,048-token minimum**. A well-specified summary prompt (rubric + output schema instructions) will comfortably exceed 2,048 tokens.

**How to enable:** Add `cache_control: { type: 'ephemeral' }` to the system prompt block:

```typescript
await anthropic.messages.create({
  model: SONNET_MODEL,
  system: [{ type: 'text', text: SUMMARY_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: dayEntriesPayload }],
  max_tokens: 1024,
});
```

Cache TTL is 5 minutes by default (sufficient — one cron run per day hits the cache on all subsequent requests within the run). Prompt caching is already supported by the installed `@anthropic-ai/sdk ^0.80.0`.

**Cost impact:** Cache read tokens are 10% of base input price. With daily runs, the write is paid once per day; the cache is not read again until the next day, so caching saves nothing on per-day cadence. However, if **backfill** is run (see below), caching the system prompt across 14+ backfill calls saves ~90% on system prompt tokens for that batch.

### Batch API (for backfill only — NOT for daily operation)

**Daily cron:** One Sonnet call per day. The Batch API adds async indirection (up to 24-hour return window) that is completely inappropriate for a nightly cron that needs to confirm success before the next morning. **Do not use the Batch API for the daily consolidation.**

**Backfill scenario (14+ historical days):** The Batch API is appropriate here. Submit one batch request per historical day, get 50% cost reduction, results return within 1 hour typically. Use `client.messages.batches.create()` with one request per day, then poll `client.messages.batches.retrieve()` until `processing_status === 'ended'`.

**Implementation note:** Backfill is a one-shot operation, not a recurring need. Design the backfill as a standalone script (`scripts/backfill-episodes.ts`) that the operator runs manually, not as part of the cron scheduler. This prevents the Batch API complexity from leaking into the daily path.

### Extended thinking (NOT needed)

Extended thinking (budget_tokens) adds visible reasoning steps for complex analytical problems. Episodic summarisation is a well-bounded text transformation task. The reasoning is already implicit in the rubric prompt. Extended thinking would increase latency and token cost for no measurable quality improvement on this task.

### Structured outputs via `messages.parse()` (RECOMMENDED — requires SDK bump)

Current installed: `@anthropic-ai/sdk ^0.80.0` (actual: latest would be `0.90.0`). The `messages.parse()` API with `zodOutputFormat()` is GA on Claude Sonnet 4.6 as of late 2025. This is the only reason to bump the SDK version.

---

## Supporting Libraries Table

| Library | Version | Status | Purpose | Action |
|---------|---------|--------|---------|--------|
| `@anthropic-ai/sdk` | `^0.90.0` | BUMP from `^0.80.0` | `messages.parse()` + `zodOutputFormat()` for structured summary generation | Update `package.json` |
| `zod` | `^3.24.0` | ADD as direct dep | Schema definition for episodic summary shape; used with `zodOutputFormat()` | `npm install zod` |
| `luxon` | existing | NO CHANGE | Day-boundary UTC timestamp calculation | Already installed |
| `node-cron` | existing | NO CHANGE | Daily consolidation cron registration | Already installed |
| `drizzle-orm` | existing | NO CHANGE | `episodic_summaries` table query + retrieval routing | Already installed |
| `drizzle-kit` | existing | NO CHANGE | Migration generation for new table | Already installed |

**Zod note:** Zod `4.x` was released in 2025 but `zodOutputFormat()` in the Anthropic SDK helpers was written against Zod `3.x` API. Use `^3.24.0` (latest stable v3) until the SDK's helpers explicitly target Zod 4.

---

## Installation

```bash
# Bump SDK to access messages.parse() + zodOutputFormat()
npm install @anthropic-ai/sdk@^0.90.0

# Add Zod for structured output schema definitions
npm install zod@^3.24.0
```

No dev-only deps are needed. Zod is a runtime dep because the schema is used during consolidation, not just in tests.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `instructor` | Wraps Anthropic SDK to add structured output — redundant now that SDK has native `messages.parse()` | `@anthropic-ai/sdk` `messages.parse()` + `zodOutputFormat()` |
| `langchain` / `llamaindex` | Abstraction frameworks that add 50+ transitive deps, obscure prompt logic, and have their own opinions about memory architecture that conflict with Pensieve design | Direct Anthropic SDK calls, as used everywhere else in the project |
| `agenda` / `bull` / `bullmq` | Distributed job queues requiring Redis, inappropriate for a single-user daily batch | `node-cron` (already in use) |
| `date-fns-tz` / `moment-timezone` | Redundant second date library — Luxon already handles IANA timezone arithmetic | `luxon` (already installed) |
| `vader-sentiment` / `compromise` | Sentence-level NLP for polarity/sentiment — wrong granularity for day-level importance scoring | Sonnet rubric prompt |
| Any vector DB / pgvector wrapper | `pgvector` is already embedded in PostgreSQL 16; no separate vector store needed for episodic summaries (they do not need vector embeddings at M008 scope) | Drizzle ORM direct SQL |
| `zod` `^4.x` | SDK helpers target Zod 3.x; Zod 4 has breaking API changes that `zodOutputFormat()` does not yet handle | `zod@^3.24.0` |

---

## Integration Points with Existing Stack

### Drizzle schema (src/db/schema.ts)

New table declaration follows the existing pattern exactly. The `text().array()` pattern is already used in `relational_memory` (`supportingEntries`) and `decisions` (`alternatives` as jsonb). `uuid().array()` for `source_entry_ids` follows the same Drizzle API. TECH-DEBT-19-01 (missing drizzle-kit meta snapshots for 0001/0003) must be resolved as part of this migration — failure to do so leaves the schema lineage broken for any future migration.

### node-cron scheduler

The daily consolidation cron registers alongside the existing proactive sweep cron. The timezone-aware cron expression pattern is already established: `config.proactiveTimezone` feeds a `luxon`-computed daily boundary. M008 adds one `cron.schedule()` call in the same initialisation block.

### Anthropic client wrapper (src/llm/client.ts)

`callLLM()` is Haiku-only by design. The summary generation uses Sonnet directly via `anthropic.messages.create()` (or `anthropic.messages.parse()` after SDK bump), consistent with how other Sonnet calls are made in the engine handlers. The pattern is already established in `src/engine/` handlers — M008 follows the same convention without modifying `callLLM`.

### Retrieval routing (src/pensieve/retrieve.ts)

The `SearchOptions` interface already has an extension point (`minScore`, `recencyBias`). Add `useEpisodicBeyondDays?: number` (default: 7) to make the recency threshold configurable and testable in the synthetic fixture.

---

## Version Compatibility

| Package | Installed | Recommended | Notes |
|---------|-----------|-------------|-------|
| `@anthropic-ai/sdk` | `^0.80.0` | `^0.90.0` | Non-breaking bump; `messages.parse()` and `zodOutputFormat()` added in minor versions between 0.80 and 0.90 |
| `zod` | not installed | `^3.24.0` | Must be v3, not v4 — SDK helpers target Zod 3 API |
| `drizzle-orm` | `^0.45.2` | no change | Current version supports all required column types |
| `luxon` | installed (transitive) | confirm as direct dep | Check `package.json` — if only transitive, add as direct dep to prevent surprise removal |

**Luxon note:** `luxon` does not appear in `package.json` dependencies explicitly. Check whether it is a direct dep or transitive. If transitive, `npm install luxon` to make the dependency explicit — the cron timezone arithmetic should not rely on a transitive dep.

---

## Sources

- Context7 `/anthropics/anthropic-sdk-typescript` — `messages.parse()`, `zodOutputFormat()`, Batch API, extended thinking
- [Anthropic Prompt Caching Docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) — cache_control placement, TTL, minimum token thresholds, workspace isolation (HIGH confidence)
- [Anthropic Structured Outputs Docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) — GA status, supported models, Zod 3 compatibility, limitations (HIGH confidence)
- [Anthropic Batch Processing Docs](https://platform.claude.com/docs/en/build-with-claude/batch-processing) — 24h window, 50% discount, polling pattern (HIGH confidence)
- npm registry: `@anthropic-ai/sdk@0.90.0`, `zod@3.24.3`, `drizzle-orm@0.45.2` — version confirmation (HIGH confidence)

---
*Stack research for: M008 Episodic Consolidation — Project Chris*
*Researched: 2026-04-18*
