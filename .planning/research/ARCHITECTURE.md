# Architecture Research

**Domain:** M008 Episodic Consolidation — integration into Project Chris
**Researched:** 2026-04-18
**Confidence:** HIGH (based on direct codebase inspection)

---

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          M008 Integration Points                              │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ src/index.ts — cron wiring                                               │  │
│  │  cron.schedule(proactiveSweepCron, runSweep, tz)   ← existing           │  │
│  │  cron.schedule(episodicCron,       runConsolidate, tz)  ← NEW (M008)    │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│           │                                                                    │
│           ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ src/episodic/consolidate.ts   (NEW MODULE)                               │  │
│  │  runConsolidate(date?)                                                   │  │
│  │   → getEntriesForDay(tz-aware date window)   [reads pensieve_entries]   │  │
│  │   → getDecisionsForDay()                     [reads decisions]          │  │
│  │   → buildConsolidationPrompt()               [Sonnet]                   │  │
│  │   → insertEpisodicSummary()                  [writes episodic_summaries]│  │
│  │   Idempotency: check existing row for date before inserting             │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│           │                                                                    │
│           ▼                                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ PostgreSQL: episodic_summaries table (NEW)                               │  │
│  │  summary_date (date, UNIQUE)                                             │  │
│  │  source_entry_ids (uuid[])                                               │  │
│  │  topics (text[])  ← GIN index                                            │  │
│  │  importance (int 1-10)                                                   │  │
│  │  summary (text), emotional_arc (text), key_quotes (text[])              │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ src/pensieve/retrieve.ts — recency routing additions (MODIFY EXISTING)  │  │
│  │  + getEpisodicSummary(date)         reads episodic_summaries            │  │
│  │  + getEpisodicSummariesRange(from, to)                                  │  │
│  │  hybridSearch() / searchPensieve()  unchanged — still used for < 7d    │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
│                                                                                │
│  ┌─────────────────────────────────────────────────────────────────────────┐  │
│  │ src/bot/handlers/episodic.ts  (NEW)                                      │  │
│  │  /summary [date]   — user-facing command                                │  │
│  └─────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Responsibility | New vs Modified |
|-----------|----------------|-----------------|
| `src/episodic/consolidate.ts` | Pull day's entries, call Sonnet, write summary row, idempotency check | NEW |
| `src/episodic/prompts.ts` | Consolidation system prompt + importance rubric | NEW |
| `src/db/schema.ts` | `episodic_summaries` table definition | MODIFIED |
| `src/db/migrations/0005_episodic_summaries.sql` | Migration for the new table | NEW |
| `src/index.ts` | Register the consolidation cron via `node-cron` | MODIFIED (2 lines) |
| `src/config.ts` | `episodicCron` env var (default `0 23 * * *`) | MODIFIED (1 field) |
| `src/pensieve/retrieve.ts` | Add `getEpisodicSummary`, `getEpisodicSummariesRange` exports | MODIFIED |
| `src/bot/bot.ts` | Register `/summary` command | MODIFIED (2 lines) |
| `src/bot/handlers/episodic.ts` | Handle `/summary [date]` command | NEW |

---

## Recommended Project Structure

```
src/
├── episodic/                    # NEW top-level module — mirrors decisions/ pattern
│   ├── consolidate.ts           # Core: runConsolidate(targetDate?, tz) → void
│   ├── prompts.ts               # CONSOLIDATION_SYSTEM_PROMPT + importance rubric text
│   └── __tests__/
│       └── synthetic-fixture.test.ts   # 14-day fixture, importance correlation, idempotency
├── pensieve/
│   ├── retrieve.ts              # MODIFIED: +getEpisodicSummary, +getEpisodicSummariesRange
│   ├── store.ts                 # unchanged
│   ├── embed.ts                 # unchanged
│   └── tag.ts                   # unchanged
├── bot/
│   ├── handlers/
│   │   ├── episodic.ts          # NEW: handleSummaryCommand
│   │   ├── decisions.ts         # unchanged
│   │   ├── sync.ts              # unchanged
│   │   └── document.ts          # unchanged
│   └── bot.ts                   # MODIFIED: register /summary command
├── db/
│   ├── schema.ts                # MODIFIED: episodic_summaries table
│   └── migrations/
│       └── 0005_episodic_summaries.sql   # NEW
├── index.ts                     # MODIFIED: add episodic cron
└── config.ts                    # MODIFIED: episodicCron field
```

### Structure Rationale

- **`src/episodic/` as a top-level module:** Matches the `src/decisions/` pattern established in M007. It is neither a Pensieve sub-concern (it reads Pensieve but is not part of retrieval) nor a proactive sub-concern (it is a background write job, not a send-to-user trigger). An independent module keeps the consolidation logic self-contained and testable in isolation.
- **Keep retrieval additions in `src/pensieve/retrieve.ts`:** The spec says "recency routing in `src/pensieve/retrieve.ts`". Adding two new exported functions (`getEpisodicSummary`, `getEpisodicSummariesRange`) to the existing file is cheaper than a wrapper module and keeps all Pensieve read surface in one file. A `retrieve-routed.ts` wrapper is unnecessary unless the routing logic grows to require a context object (it does not in M008).
- **`src/bot/handlers/episodic.ts`:** Consistent with `decisions.ts` and `sync.ts`. The bot.ts file stays thin — each command gets its own handler file.

---

## Question-by-Question Design Answers

### Q1 — Cron placement: separate scheduler vs. 5th proactive trigger

**Decision: Separate cron expression in `src/index.ts`, not a trigger inside `runSweep`.**

Rationale from inspecting `sweep.ts` and `index.ts`:

- `runSweep` manages two independent channels (reflective + accountability), each with daily-cap state, escalation loops, and Telegram sends. Adding consolidation to it would require a third channel with no send, no cap, and different failure semantics — it would warp the function contract.
- Consolidation is a write job, not a notification job. It has no user message to send and no trigger logic. It just needs to run once per day at a specific time.
- `src/index.ts` already registers two crons (proactive sweep + source sync) using the identical `cron.schedule(expr, fn, { timezone })` pattern. A third cron for consolidation is 4 lines and fits exactly that pattern.
- The consolidation cron should fire at `0 23 * * *` (11 PM in `proactiveTimezone`) — late enough that the day's entries are complete, before midnight to avoid the next day's window. Make this configurable via `EPISODIC_CRON` env var defaulting to `"0 23 * * *"`.

```typescript
// src/index.ts addition (after the existing proactive cron, ~line 78)
cron.schedule(config.episodicCron, async () => {
  try {
    await runConsolidate();
  } catch (err) {
    logger.error({ err }, 'episodic.cron.error');
  }
}, { timezone: config.proactiveTimezone });
logger.info({ cron: config.episodicCron, timezone: config.proactiveTimezone }, 'episodic.cron.scheduled');
```

### Q2 — Module layout

**Decision: `src/episodic/consolidate.ts` in a new top-level directory.**

- Not `src/pensieve/consolidate.ts`: consolidation writes to a new table and calls the LLM. Pensieve is a read/store/embed module. Placing a Sonnet LLM call inside `src/pensieve/` would break the module's current responsibility boundary (pure storage + retrieval with no synthesis).
- Not `src/proactive/`: the proactive module owns user-facing outreach, daily caps, mute detection, and escalation state. Consolidation has none of those concerns.
- `src/episodic/` mirrors `src/decisions/` in scope: a distinct concern with its own schema objects, its own background job, and its own Telegram command. This is the right precedent.

### Q3 — Recency routing location

**Decision: Add functions directly to `src/pensieve/retrieve.ts`. No wrapper module.**

Current `retrieve.ts` exports: `searchPensieve`, `hybridSearch`, `getTemporalPensieve`, and five search-options constants. The file is 307 lines and has room. Adding two functions keeps all Pensieve read surface co-located.

The routing decision (raw vs. summary) belongs at the call site in mode handlers (e.g., `handleInterrogate`, `handleReflect`), not as a wrapper around retrieve. Mode handlers already choose which search function to call based on mode-specific options. For M008, they will additionally check whether the query is clearly about a date >7 days ago and, if so, call `getEpisodicSummariesRange` instead of or in addition to `hybridSearch`.

The 7-day window is a threshold, not a hard binary: for general queries that don't reference a specific date, raw search continues unchanged. For date-anchored queries about older periods, summaries are the primary source. This logic lives naturally in the context-building step of each relevant mode handler, not in a routing wrapper.

Two new exports for `retrieve.ts`:

```typescript
// Get the summary for a specific local date (returns null if not yet consolidated)
export async function getEpisodicSummary(
  localDate: string,           // 'YYYY-MM-DD' in proactiveTimezone
): Promise<typeof episodicSummaries.$inferSelect | null>

// Get summaries for a date range (for weekly review, profile inference)
export async function getEpisodicSummariesRange(
  from: string,                // 'YYYY-MM-DD' inclusive
  to: string,                  // 'YYYY-MM-DD' inclusive
): Promise<(typeof episodicSummaries.$inferSelect)[]>
```

### Q4 — Schema: `episodic_summaries` table and indexes

```sql
-- src/db/migrations/0005_episodic_summaries.sql
CREATE TABLE episodic_summaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_date    DATE NOT NULL,
  summary         TEXT NOT NULL,
  importance      INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
  topics          TEXT[] NOT NULL DEFAULT '{}',
  emotional_arc   TEXT,
  key_quotes      TEXT[] NOT NULL DEFAULT '{}',
  source_entry_ids UUID[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX episodic_summaries_date_unique
  ON episodic_summaries (summary_date);

CREATE INDEX episodic_summaries_topics_gin
  ON episodic_summaries USING GIN (topics);

CREATE INDEX episodic_summaries_importance_idx
  ON episodic_summaries (importance);
```

**Index rationale:**

| Index | Pattern it serves |
|-------|------------------|
| `UNIQUE (summary_date)` | Idempotency check: `INSERT ... ON CONFLICT DO NOTHING` or pre-flight SELECT. Also the primary lookup path for `/summary 2026-04-15`. |
| `GIN (topics)` | Topic-based queries: "did I think about X this week?" from M009 weekly review and M010+ profile inference. Without GIN, `WHERE 'career' = ANY(topics)` scans the full table. |
| `btree (importance)` | Range queries for high-importance days: "show me all days with importance >= 7 in the last 3 months". Used by M010 profile inference to prioritize context. |
| No GIN on `source_entry_ids` | The traceback query ("what entries fed into the 2026-01-15 summary?") is answered by the unique date index lookup first, then reading `source_entry_ids` from that single row. A GIN on `source_entry_ids` would only help if querying "which summary contains entry X" — a pattern not required by M008 or M009. Skip for now, add in M010 if profile inference needs it. |

**Drizzle schema addition to `src/db/schema.ts`:**

```typescript
export const episodicSummaries = pgTable(
  'episodic_summaries',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    summaryDate: date('summary_date').notNull(),
    summary: text('summary').notNull(),
    importance: integer('importance').notNull(),
    topics: text('topics').array().notNull().default(sql`'{}'`),
    emotionalArc: text('emotional_arc'),
    keyQuotes: text('key_quotes').array().notNull().default(sql`'{}'`),
    sourceEntryIds: uuid('source_entry_ids').array().notNull().default(sql`'{}'`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (table) => [
    unique('episodic_summaries_date_unique').on(table.summaryDate),
    index('episodic_summaries_topics_gin').using('gin', table.topics),
    index('episodic_summaries_importance_idx').on(table.importance),
  ],
);
```

Note: `TECH-DEBT-19-01` (missing drizzle-kit meta snapshots for migrations 0001/0003) is triggered by this schema change. Before writing migration 0005, generate the missing meta snapshots for 0001 and 0003 using `drizzle-kit generate` against the current schema state, or apply them as empty passthrough snapshots. This is a build step, not a code change.

### Q5 — Source entries reference: uuid[] vs join table vs JSONB

**Decision: `UUID[]` text array, as specified in the M008 spec.**

Trade-off analysis:

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| `UUID[] array` | Simple, single row lookup, sufficient for traceback query pattern | No FK enforcement, GIN needed for reverse lookup | Use for M008 |
| Join table `episodic_summary_entries(summary_id, entry_id)` | FK constraints, efficient reverse lookup ("which summary contains entry X") | Extra join for every read, more schema complexity | Defer to M010 if needed |
| `JSONB` | Flexible, could store entry metadata inline | Over-engineering for a list of IDs, slower for array ops | Do not use |

The traceback query pattern ("show all entries that fed into the 2026-01-15 summary") is: SELECT by date (unique index hit) → read `source_entry_ids` → query `pensieve_entries WHERE id = ANY(source_entry_ids)`. This is two queries, both indexed. It does not require a join table.

The reverse query ("which summary contains entry X?") is not required by M008 or M009. If M010 profile inference needs it, add the GIN index on `source_entry_ids` at that point (one migration, no data change).

### Q6 — M007 decisions integration in the consolidation prompt

**Decision: Yes — include resolved/reviewed decisions from the same day as additional context signals for importance scoring.**

The importance rubric explicitly includes "decision presence" as a factor (importance 7–9 range). Consolidation should query:

```sql
SELECT decision_text, prediction, domain_tag, status
FROM decisions
WHERE DATE(resolved_at AT TIME ZONE $tz) = $summary_date
   OR DATE(created_at AT TIME ZONE $tz) = $summary_date
```

This provides two integration points:
1. Decisions *created* that day (DECISION epistemic tag entries may already appear in Pensieve, but the structured decision record has richer metadata including `prediction` and `domain_tag`)
2. Decisions *resolved* that day (resolution outcome is an explicit importance signal — a day Greg resolved a major decision scores at least 7)

The decisions data is injected into the consolidation prompt as a structured block, not as prose. Same principle as D031 (structured fact injection). Example prompt block:

```
## Decisions captured or resolved today
- [CREATED] "Leave current job for freelance" (domain: career, stakes: structural)
- [RESOLVED: correct] "Prediction: revenue >5k/mo in 6mo" — resolved 2025-12-10
```

No write-back to the decisions table. Consolidation is read-only with respect to M007 data (D004 constraint applies).

### Q7 — Engine interaction: background job or user-facing affordance

**Decision: Primarily a background job. The `/summary [date]` command is a thin read-only affordance, not engine integration.**

`processMessage` in `src/chris/engine.ts` does NOT need modification for M008. Consolidation is a pure background cron. The engine's responsibility is handling real-time Telegram messages; consolidation has no message to process.

The user-facing affordance is a bot command, not a mode:
- `/summary` — shows today's summary if consolidated, otherwise "today's summary will be available after 11 PM"
- `/summary 2026-04-15` — shows the summary for a specific past date

This follows the `/decisions` pattern exactly: a command handler (`src/bot/handlers/episodic.ts`) registered in `src/bot/bot.ts`, bypassing `processMessage` entirely.

There is no new engine mode for M008. Future milestones (M009 weekly review, M010 profile inference) will use `getEpisodicSummariesRange` in their context builders, but those are M009+ concerns.

One narrow engine integration that IS needed: when mode handlers construct context for INTERROGATE or REFLECT queries that reference a specific past date (>7 days), they should call `getEpisodicSummary` to include the relevant day's summary in the prompt context. This is a context-builder addition in the individual mode handlers, not a change to `processMessage`'s routing logic. Scope this carefully — only add it to INTERROGATE mode for M008 (the most likely query path for "what happened on X day?"). REFLECT can wait for M009.

### Q8 — Idempotency and late-arriving entry handling

**Idempotency design:**

The `UNIQUE (summary_date)` constraint is the primary guard. `runConsolidate` should:

1. Before calling Sonnet: query `SELECT id FROM episodic_summaries WHERE summary_date = $targetDate LIMIT 1`. If a row exists, log `episodic.consolidate.already_done` and return early. This is the "already consolidated this day" check.
2. After Sonnet: use `INSERT INTO episodic_summaries (...) ON CONFLICT (summary_date) DO NOTHING` for the final insert. This guards against the race where two consolidation runs overlap (e.g., a manual retry while a cron is mid-flight).

The cron fires once per day and the idempotency check is a 1ms SELECT — no Sonnet cost on duplicate runs.

**Late-arriving entry problem (entry created at 23:55 UTC, consolidation ran at 23:00 PT):**

Given `proactiveTimezone: 'Europe/Paris'` and a default cron of `0 23 * * *` (11 PM Paris time), the window is:
- Paris 11 PM = UTC 21:00 (summer) or UTC 22:00 (winter)
- A 23:55 UTC entry arrives *after* consolidation has already run

This is acceptable and by design. The spec says "end-of-day" summaries, not "complete-day" summaries. Late entries simply are not included. The `source_entry_ids` array is an accurate record of what was consolidated, not a claim of completeness.

For the rare case where Greg explicitly wants a late entry included, the `/summary rerun` sub-command (future scope, not M008) could rebuild a day's summary. For M008, document the known limitation: entries arriving in the final hour of the day may not be included in that day's summary. They will appear in the following day's entries if relevant.

The `summary_date` column is a `DATE` type (not timestamptz) representing the calendar date *in `proactiveTimezone`*. The consolidation job must convert UTC timestamps to the local date before querying:

```typescript
// In consolidate.ts
const localDate = DateTime.now().setZone(tz).toISODate(); // e.g., '2026-04-18'
// Query: WHERE created_at >= localDate 00:00:00 tz AND < localDate+1 00:00:00 tz
```

Use `luxon` (already available via project deps or add it) or raw SQL interval math to compute the UTC bounds for a local calendar day. The timezone-aware window is critical — a naive UTC-day window would assign Paris morning entries to the wrong summary.

### Q9 — Suggested build order

```
Phase 1: Schema + migration
  → src/db/schema.ts (add episodic_summaries table)
  → src/db/migrations/0005_episodic_summaries.sql
  → Fix TECH-DEBT-19-01 (drizzle-kit meta snapshots) first
  → Verify migration applies cleanly in Docker test environment

Phase 2: Core consolidation engine
  → src/episodic/prompts.ts (CONSOLIDATION_SYSTEM_PROMPT + importance rubric)
  → src/episodic/consolidate.ts (runConsolidate, getEntriesForDay, idempotency check)
  → Integration: read from decisions table for that day
  → Unit tests against real Docker Postgres with mock LLM (no Anthropic API calls)

Phase 3: Cron wiring + config
  → src/config.ts (episodicCron field)
  → src/index.ts (register cron)
  → Manual trigger path: runConsolidate(specificDate) callable directly for backfill

Phase 4: Retrieval additions
  → src/pensieve/retrieve.ts (getEpisodicSummary, getEpisodicSummariesRange)
  → src/chris/modes/interrogate.ts (inject summary context for date-anchored queries >7d)

Phase 5: User-facing command
  → src/bot/handlers/episodic.ts (handleSummaryCommand)
  → src/bot/bot.ts (register /summary command)

Phase 6: Synthetic fixture test suite
  → src/episodic/__tests__/synthetic-fixture.test.ts
  → 14-day fixture: importance calibration, recency routing, timezone boundary, idempotency retry
```

**Dependency reasoning:**

- Phase 1 must run first: every subsequent phase imports from `src/db/schema.ts`. Until the migration exists, no test or runtime code can touch `episodic_summaries`.
- Phase 2 before Phase 3: the cron wires `runConsolidate` — it must exist first.
- Phase 2 before Phase 4: retrieval additions read from `episodic_summaries`. The table must be populated (or populatable) before testing retrieval.
- Phase 4 before Phase 5: the `/summary` command calls `getEpisodicSummary` from retrieve.ts.
- Phase 6 after all: the fixture test exercises the full pipeline — schema, consolidation, retrieval, timezone math, idempotency. It cannot run until all preceding phases are at least minimally functional.
- The M007 decisions integration (Phase 2, reading decisions for the day) requires no changes to `src/decisions/` — it is a read-only SELECT from the `decisions` table.

### Q10 — Explicit new vs. modified files

**NEW files:**

| File | Purpose |
|------|---------|
| `src/episodic/consolidate.ts` | `runConsolidate(date?, tz)` — the consolidation job |
| `src/episodic/prompts.ts` | `CONSOLIDATION_SYSTEM_PROMPT` with importance rubric |
| `src/episodic/__tests__/synthetic-fixture.test.ts` | 14-day fixture test (D018 compliance) |
| `src/bot/handlers/episodic.ts` | `/summary [date]` command handler |
| `src/db/migrations/0005_episodic_summaries.sql` | Schema migration |

**MODIFIED files:**

| File | Change | Scope |
|------|--------|-------|
| `src/db/schema.ts` | Add `episodic_summaries` table export | ~25 lines added |
| `src/config.ts` | Add `episodicCron` field (env var `EPISODIC_CRON`) | 1 line |
| `src/index.ts` | Register consolidation cron (4 lines) | 4 lines added |
| `src/pensieve/retrieve.ts` | Add `getEpisodicSummary`, `getEpisodicSummariesRange` exports | ~50 lines added |
| `src/chris/modes/interrogate.ts` | Inject summary context for date-anchored queries >7 days | ~20 lines |
| `src/bot/bot.ts` | Register `/summary` command | 2 lines |

**Files that must NOT be modified (D004 + scope discipline):**

| File | Why untouched |
|------|---------------|
| `src/pensieve/store.ts` | D004: append-only Pensieve. Consolidation reads, never writes to pensieve_entries. |
| `src/proactive/sweep.ts` | Consolidation is not a trigger channel. Adding it here would warp the function contract. |
| `src/chris/engine.ts` | No new mode. No engine routing change. Consolidation is background-only for M008. |
| `src/decisions/` (all files) | M007 is complete. Consolidation reads decisions table via direct DB query, not via decisions module API. |

---

## Architectural Patterns

### Pattern 1: Separate Cron per Background Job

**What:** Each background job (proactive sweep, source sync, episodic consolidation) registers its own `cron.schedule()` call in `src/index.ts` with independent error handling.

**When to use:** When jobs have different timing requirements, different failure modes, and different concerns. Never bundle unrelated background work into one cron handler.

**Trade-offs:** More cron lines in `index.ts` (currently 2, will be 3), but each job is independently testable, independently configurable via env var, and independently logged.

### Pattern 2: Idempotent Insert with Pre-flight Check

**What:** Before generating (expensive Sonnet call), check if the row already exists. After generating, use `ON CONFLICT DO NOTHING` for the insert.

**When to use:** Any job that runs on a schedule and writes a unique-keyed row. The pre-flight check saves API cost on duplicate runs; the conflict guard handles races.

```typescript
// Pre-flight (cheap)
const existing = await db
  .select({ id: episodicSummaries.id })
  .from(episodicSummaries)
  .where(eq(episodicSummaries.summaryDate, localDate))
  .limit(1);
if (existing.length > 0) {
  logger.info({ date: localDate }, 'episodic.consolidate.already_done');
  return;
}

// ... generate via Sonnet ...

// Final insert (conflict-safe)
await db.insert(episodicSummaries)
  .values({ summaryDate: localDate, ...parsed })
  .onConflictDoNothing();
```

### Pattern 3: Structured Prompt Input, Structured Prompt Output

**What:** Pass Pensieve entries + decisions as a structured block (not prose) into the consolidation prompt. Parse the Sonnet response as structured JSON (importance, topics[], emotional_arc, key_quotes[], summary). Validate against a Zod schema before inserting.

**When to use:** D031 established this as a constraint. Prose injection → LLM remixing. Structured input → faithful extraction. The same applies in reverse: structured output → no ambiguity in parsing.

**Trade-offs:** Requires a JSON extraction prompt and a Zod parse step. Worth it: a failed parse (importance outside 1-10, missing topics) is detectable and retriable before any data is written.

### Pattern 4: Timezone-Aware Date Window

**What:** When querying "entries for this day," convert the calendar date to UTC bounds using the user's timezone before the SQL WHERE clause.

```typescript
import { DateTime } from 'luxon';

function dayBoundsUtc(localDate: string, tz: string): { from: Date; to: Date } {
  const start = DateTime.fromISO(localDate, { zone: tz }).startOf('day');
  const end = start.plus({ days: 1 });
  return { from: start.toJSDate(), to: end.toJSDate() };
}
```

**When to use:** Any query on `pensieve_entries.created_at` (stored as timestamptz) that needs to respect a local calendar day boundary.

---

## Data Flow

### Consolidation Flow (Background)

```
11 PM Paris time (node-cron)
    ↓
runConsolidate(today)
    ↓
Pre-flight: SELECT FROM episodic_summaries WHERE date = today
    → already exists → log + return (idempotent)
    → not found → continue
    ↓
getEntriesForDay(today, proactiveTimezone)
    → pensieve_entries WHERE created_at IN [00:00:00 Paris, 00:00:00 Paris+1]
    ↓
getDecisionsForDay(today, proactiveTimezone)
    → decisions WHERE DATE(created_at AT TIME ZONE tz) = today
      OR DATE(resolved_at AT TIME ZONE tz) = today
    ↓
buildConsolidationPrompt(entries, decisions)
    ↓
Sonnet API call (max_tokens: 1024)
    ↓
Parse + validate response (Zod: importance, topics, emotional_arc, key_quotes, summary)
    ↓
INSERT INTO episodic_summaries ON CONFLICT DO NOTHING
    ↓
Log: episodic.consolidate.done { date, importance, entryCount, topicCount }
```

### Retrieval Routing Flow (INTERROGATE mode, date-anchored query)

```
User: "What was I thinking about on April 10th?"
    ↓
handleInterrogate(chatId, text, language, declinedTopics)
    ↓
Parse date reference from text (detect "April 10th", "last Tuesday", etc.)
    ↓
Is date > 7 days ago?
    → YES: getEpisodicSummary('2026-04-10')
           → summary found → inject into prompt context as "Episode: April 10"
           → summary not found → fall back to hybridSearch with date range filter
    → NO:  hybridSearch with normal options (unchanged path)
    ↓
Build context block → Sonnet response → return
```

### User-Facing Summary Flow

```
User: /summary 2026-04-15
    ↓
handleSummaryCommand(ctx)
    ↓
Parse date arg (default: today's local date)
    ↓
getEpisodicSummary(localDate)
    ↓
found → format and reply
not found + date is today → "Today's summary will be ready after 11 PM"
not found + date is past → "No summary found for April 15 — that day may have had no entries"
```

---

## Constraint Compliance

| Decision | Constraint | How M008 Respects It |
|----------|-----------|----------------------|
| D004 | Append-only Pensieve, no lossy operations | Consolidation reads `pensieve_entries` and `decisions` but never writes to them. Only writes to `episodic_summaries`. |
| D005 | Fire-and-forget for side effects | Cron error is caught and logged; it never blocks the main bot response. |
| D010 | Two-phase trigger execution (cheap SQL gates Opus) | Not applicable to consolidation (no trigger decision needed), but the idempotency pre-flight SELECT follows the same "cheap check first" spirit. |
| D016 | Build and test locally against Docker Postgres | Migration 0005 must apply cleanly in the Docker test environment before any code runs. TECH-DEBT-19-01 must be resolved first. |
| D018 | No skipped tests | Synthetic 14-day fixture is mandatory per M008 spec. Live API test for consolidation quality is gated on `ANTHROPIC_API_KEY` (same pattern as TEST-13/TEST-14). |
| D031 | Structured fact injection | Consolidation prompt inputs are structured blocks; output is parsed JSON with Zod validation. |

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Consolidation as a Proactive Trigger

**What people do:** Add a consolidation branch inside `runSweep` or make it a 5th trigger in the reflective channel.

**Why it's wrong:** `runSweep` is a notification orchestrator with daily caps, mute checks, and Telegram sends. Consolidation has none of those requirements. Adding it inside sweep pollutes the function with orthogonal concerns and makes it impossible to run consolidation independently (e.g., for backfill).

**Do this instead:** Separate `cron.schedule` in `src/index.ts`. `runConsolidate` and `runSweep` are peers, not nested.

### Anti-Pattern 2: UTC-Day Window for "Today's Entries"

**What people do:** Query `WHERE created_at >= DATE_TRUNC('day', NOW()) AND created_at < DATE_TRUNC('day', NOW()) + INTERVAL '1 day'` without timezone conversion.

**Why it's wrong:** Greg is in Paris (UTC+1/+2). A UTC-day window from midnight UTC to midnight UTC spans two Paris calendar days. A summary generated at 11 PM Paris time would contain entries from two different Paris days.

**Do this instead:** Compute the UTC bounds for midnight-to-midnight Paris time before the query (see Pattern 4 above).

### Anti-Pattern 3: Mutating Pensieve Entries During Consolidation

**What people do:** Tag entries as "consolidated" or update `updatedAt` on entries that were included in a summary.

**Why it's wrong:** Violates D004 (append-only, no lossy operations). The `source_entry_ids` array on the summary row is the complete record of what was consolidated. The Pensieve entries themselves must remain immutable.

**Do this instead:** Track consolidation state in `episodic_summaries.source_entry_ids`. Query "was entry X consolidated?" via: `SELECT id FROM episodic_summaries WHERE $entryId = ANY(source_entry_ids)`.

### Anti-Pattern 4: Prose-Dump Prompt Input

**What people do:** Pass entries as a raw text blob: "Here are today's entries: [full verbatim text of 20 entries concatenated]..."

**Why it's wrong:** Established by D031. Prose context → LLM remixing and confabulation. The model will synthesize connections that don't exist in the raw data.

**Do this instead:** Pass entries as a structured list with metadata (entry_id, epistemic_tag, timestamp, content). The prompt explicitly asks for extraction, not synthesis. Sonnet output is JSON, not prose.

---

## Sources

- Direct inspection of `src/index.ts` (cron registration pattern)
- Direct inspection of `src/proactive/sweep.ts` (dual-channel architecture, trigger pattern)
- Direct inspection of `src/chris/engine.ts` (mode routing, PP#0/PP#1 pre-processors)
- Direct inspection of `src/pensieve/retrieve.ts` (current retrieval API surface)
- Direct inspection of `src/db/schema.ts` (existing table patterns, index conventions)
- Direct inspection of `src/config.ts` (env var pattern for cron configuration)
- M008_Episodic_Consolidation.md (canonical spec)
- `.planning/PROJECT.md` (D004, D005, D010, D016, D018, D031 constraints)

---
*Architecture research for: M008 Episodic Consolidation integration into Project Chris*
*Researched: 2026-04-18*
