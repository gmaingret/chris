# Architecture

**Analysis Date:** 2026-04-20

## Pattern Overview

**Overall:** Layered monolith — a single-user self-hosted Node.js 22 ESM service (single long-running process) wrapping a three-tier LLM pipeline (Haiku classify → Sonnet converse → Opus deep analysis) on top of an append-only verbatim Pensieve store with pgvector semantic retrieval. Deployed as one Docker Compose app alongside PostgreSQL 16 + pgvector.

**Key Characteristics:**
- **Single-process, single-user.** No multi-tenancy; `TELEGRAM_AUTHORIZED_USER_ID` is the only identity gate (`src/bot/middleware/auth.ts`). No per-handler re-check.
- **Append-only Pensieve.** Every inbound message/doc is written verbatim before any LLM transformation; tagging, embedding, relational-memory synthesis, and contradiction detection are fire-and-forget `.catch(logger.error)` side-effects, never on the reply path.
- **Three-tier model discipline.** Haiku 4.5 for classify/tag/mode-detect (temp 0, ~100 tokens); Sonnet 4.6 for user-facing converse + episodic consolidation; Opus 4.6 for deep proactive pattern/thread analysis only. All three share one SDK instance in `src/llm/client.ts`.
- **ESM with `.js` suffix imports.** `moduleResolution: bundler` under TypeScript; every internal import uses `.js` extension.
- **Idempotent cron jobs.** Three independent `node-cron` schedulers (sync, proactive sweep, episodic consolidation) registered as peers in `src/index.ts`, each DST-safe via `timezone` option + Luxon day-boundary helpers.
- **Constitutional preamble on every user-facing LLM call.** `CONSTITUTIONAL_PREAMBLE` from `src/chris/personality.ts` is prepended to every user-visible generation.
- **Barrel-file public surface for decisions.** `src/decisions/index.ts` is the single import surface for the 14-file decision-archive subsystem — downstream code never imports submodules directly.

## Layers

**Entry / HTTP layer (`src/index.ts`):**
- Purpose: bootstrap (migrations, cron registration, Express app, Grammy webhook/polling launch)
- Location: `src/index.ts`
- Contains: `createApp()` (Express + `/health` route), `main()`, SIGINT/SIGTERM shutdown
- Depends on: `src/db/migrate.ts`, `src/sync/scheduler.ts`, `src/proactive/sweep.ts`, `src/episodic/cron.ts`, `src/bot/bot.ts`, `src/config.ts`
- Used by: Docker Compose (startup), `docker-compose.yml` healthcheck (`GET /health`)

**Bot / routing layer (`src/bot/`):**
- Purpose: Grammy update dispatcher, auth gate, command handlers, OAuth-code interception, error fallback
- Location: `src/bot/bot.ts` (router), `src/bot/middleware/auth.ts` (gate), `src/bot/handlers/*.ts`
- Contains: single Grammy `Bot` instance, `handleTextMessage`, `/sync` `/decisions` `/summary` commands, `message:document` handler
- Depends on: `src/chris/engine.ts` (engine), `src/bot/handlers/*` (command + document handlers), `src/chris/language.ts` (error fallback localization)
- Used by: `src/index.ts` (boot), `src/proactive/sweep.ts` (outbound `bot.api.sendMessage`), `src/sync/scheduler.ts` (failure notification), `src/episodic/notify.ts` (CONS-12 notification)

**Engine layer (`src/chris/`):**
- Purpose: central message orchestrator — pre-processors (PP#0 decision capture, PP#1 trigger, mute, refusal, language) → mode detection → mode dispatch → post-processors (praise quarantine, contradiction surfacing)
- Location: `src/chris/engine.ts` (422 lines), `src/chris/modes/*.ts`, `src/chris/{personality,contradiction,refusal,language,praise-quarantine}.ts`
- Contains: `processMessage` (main dispatcher), `detectMode` (Haiku), seven mode handlers, contradiction-surface suppression (in-memory 24h TTL keyed by chatId+entryId)
- Depends on: `src/llm/*`, `src/memory/*`, `src/pensieve/*`, `src/decisions/*`, `src/proactive/{mute,state}.ts`
- Used by: `src/bot/bot.ts` (`handleTextMessage`)

**Retrieval / memory layer (`src/pensieve/`, `src/memory/`):**
- Purpose: verbatim write + embed + hybrid retrieve + temporal retrieve + episodic-summary read + relational-memory synthesis
- Location: `src/pensieve/{store,embeddings,retrieve,routing,tagger}.ts`, `src/memory/{conversation,relational,context-builder}.ts`
- Contains: bge-m3 ONNX pipeline (1024-dim), content-hash dedup, vector + temporal + importance hybrid search, recency-boundary routing, conversation turn history, relational observation writes
- Depends on: `src/db/*`, `@huggingface/transformers`, `src/llm/*` (for tagger + relational)
- Used by: mode handlers, sync modules, episodic consolidation, `/summary` command

**Decisions subsystem (`src/decisions/`):**
- Purpose: capture, lifecycle state machine, stakes classification, resolve-by parsing, Wilson-CI stats, 2-axis accuracy classification, event-sourced regeneration
- Location: 14 files under `src/decisions/`, public surface via `src/decisions/index.ts` barrel
- Contains: `transitionDecision` state machine with optimistic concurrency, `detectTriggerPhrase` + `classifyStakes`, capture draft JSONB state, `addSuppression/isSuppressed`, `regenerateDecisionFromEvents`
- Depends on: `src/llm/*`, `src/db/*`
- Used by: `src/chris/engine.ts` (PP#0 capture, PP#1 trigger), `src/bot/handlers/decisions.ts` (dashboard), `src/proactive/sweep.ts` (deadline trigger)

**Proactive layer (`src/proactive/`):**
- Purpose: dual-channel proactive messaging (accountability + reflective), mute management, trigger generators
- Location: `src/proactive/{sweep,state,mute,prompts,context-builder}.ts`, `src/proactive/triggers/{deadline,silence,commitment,pattern,thread,opus-analysis,types}.ts`
- Contains: `runSweep` orchestrator, priority-based winner selection (deadline=0, silence=1, commitment=3, pattern=4, thread=5), independent daily caps per channel, global mute gate, Opus phase-2 pattern/thread analysis (only if phase-1 SQL triggers empty)
- Depends on: `src/bot/bot.ts` (send), `src/llm/*`, `src/db/*`, `src/memory/conversation.ts`
- Used by: `src/index.ts` (cron registration), `src/chris/engine.ts` (mute detection)

**Sync layer (`src/sync/`, `src/gmail/`, `src/drive/`, `src/immich/`):**
- Purpose: every-6h cron pulling external-source content into Pensieve
- Location: `src/sync/scheduler.ts` (orchestrator), `src/{gmail,drive,immich}/{client,sync}.ts`, `src/gmail/{oauth,collapse}.ts`, `src/immich/metadata.ts`
- Contains: Gmail thread collapse + OAuth token storage, Drive changes feed + text export, Immich recent photos + metadata text, each source writes to `pensieve_entries` + embeds + tags
- Depends on: `src/pensieve/*`, `src/db/*`, `googleapis`, `src/utils/http.ts`
- Used by: `src/index.ts` (cron), `src/bot/handlers/sync.ts` (manual trigger + OAuth completion)

**Episodic consolidation (`src/episodic/`):**
- Purpose: daily Sonnet-powered summary of prior calendar day (entries + contradictions + decisions)
- Location: `src/episodic/{consolidate,cron,sources,prompts,notify,types}.ts`
- Contains: `runConsolidate(date)` 10-step pipeline with UNIQUE(summary_date) idempotency, entry-count gate, runtime importance clamps (decision-day ≥ 6, contradiction-day ≥ 7), three-layer Zod chain (Sonnet v4 → Insert v3 → DB-read v3), CONS-12 Telegram error notification
- Depends on: `src/llm/*`, `src/db/*`, `src/bot/bot.ts` (notify), `zod/v4`, `@anthropic-ai/sdk/helpers/zod`
- Used by: `src/index.ts` (cron), `scripts/backfill-episodic.ts` (manual backfill), `src/pensieve/retrieve.ts` (`getEpisodicSummary` used by `/summary` and routing)

**Data layer (`src/db/`):**
- Purpose: schema, migrations, connection singleton
- Location: `src/db/{schema,connection,migrate}.ts`, `src/db/migrations/*.sql`
- Contains: 21 Drizzle tables/enums, six hand-audited SQL migrations applied at startup via `drizzle-orm/postgres-js/migrator`
- Depends on: `postgres`, `drizzle-orm/postgres-js`
- Used by: every module that touches persistent state

**LLM / utils (`src/llm/`, `src/utils/`):**
- Purpose: Anthropic SDK singleton + shared model constants, named system prompts, cross-cutting utilities
- Location: `src/llm/{client,prompts}.ts`, `src/utils/{logger,errors,http,text,content-hash,file-extract}.ts`
- Contains: `callLLM`, `HAIKU_MODEL`/`SONNET_MODEL`/`OPUS_MODEL` constants, 15 named system prompts, pino logger, typed `ChrisError` hierarchy, retryable HTTP, SHA-256 content hash, PDF/HTML extraction
- Depends on: `@anthropic-ai/sdk`, `pino`, `pdf-parse`, `html-to-text`
- Used by: virtually everything

## Data Flow

### Inbound text message (primary hot path)
```
Telegram update
  → Grammy webhook (POST /<bot.token>) OR long-polling
  → src/bot/middleware/auth.ts (single-user gate, silent drop of others)
  → src/bot/bot.ts bot.on('message:text') → handleTextMessage
  → isAwaitingOAuthCode? → src/bot/handlers/sync.ts handleOAuthCode (Google code exchange)
  → processMessage(chatId, userId, text) in src/chris/engine.ts:
      PP#0 — active decision capture? (getActiveDecisionCapture)
          • AWAITING_RESOLUTION → src/decisions/resolution.ts handleResolution
          • AWAITING_POSTMORTEM → src/decisions/resolution.ts handlePostmortem
          • DECISION/ALTERNATIVES/REASONING/PREDICTION/FALSIFICATION → handleCapture
          • Abort-phrase inside capture → clearCapture + ack
      PP#1 — trigger phrase?  (isSuppressed → detectTriggerPhrase → classifyStakes)
          • structural → openCapture (franc lang → draft lock)
      PP#2 — mute intent? (Haiku) → setMuteUntil + ack
      PP#3 — refusal? (regex+heuristic) → addDeclinedTopic + ack
      PP#4 — detectLanguage (franc, with last-lang stickiness)
      detectMode (Haiku, MODE_DETECTION_PROMPT) →
          JOURNAL | INTERROGATE | REFLECT | COACH | PSYCHOLOGY | PRODUCE | PHOTOS
      saveMessage(USER, mode) → conversations
      mode handler (src/chris/modes/*.ts) → LLM call (Haiku for JOURNAL, Sonnet for conversational)
          • JOURNAL: storePensieveEntry (verbatim) → void embedAndStore + void tagEntry
          • PHOTOS: parsePhotoQuery → Immich fetch → Sonnet caption; enriched user msg saved
          • Others: retrieveContext (routing) + buildContext → LLM → reply
      POST: praise-quarantine (JOURNAL/REFLECT/PRODUCE, 3s timeout)
      POST: detectContradictions (JOURNAL/PRODUCE, 3s timeout, 24h surfaced-TTL)
      saveMessage(ASSISTANT, mode)
      void writeRelationalMemory (JOURNAL only, fire-and-forget)
  → ctx.reply(response)    [empty string → silently skip, IN-02]
```

### Inbound document
```
message:document → src/bot/handlers/document.ts handleDocument
  → bot.api.getFile → download
  → src/utils/file-extract.ts extractText (pdf-parse / html-to-text / plain)
  → src/pensieve/store.ts storePensieveEntry (source='telegram')
  → src/pensieve/embeddings.ts embedAndStore (1024-dim bge-m3)
```

### Sync cron (default '0 */6 * * *', SYNC_ENABLED-gated)
```
src/sync/scheduler.ts runAllSyncs
  → syncGmail  — src/gmail/{oauth → client.listThreads → collapse → sync} → store+embed+tag
  → syncDrive  — src/drive/{client.getChanges → exportFileAsText} → store+embed+tag
  → syncImmich — src/immich/{client.fetchRecentPhotos → metadata.assetToText} → store+embed+tag
  → OAuthError? → skip this source silently (re-auth required via /sync oauth)
  → other errors → bot.api.sendMessage (swallow if notify itself fails)
```

### Proactive sweep cron (default '0 10 * * *' Europe/Paris)
```
src/proactive/sweep.ts runSweep
  → isMuted()? → skip both channels
  → ACCOUNTABILITY channel:
       triggers/deadline.ts createDeadlineTrigger →
       capture-state.upsertAwaitingResolution (flip decision.capture_stage) →
       ACCOUNTABILITY_SYSTEM_PROMPT → Sonnet → bot.api.sendMessage
       [daily cap: hasSentTodayAccountability]
  → REFLECTIVE channel (independent cap: hasSentTodayReflective):
       Phase 1 (SQL, parallel): silence(priority 1) + commitment(priority 3)
       Phase 2 (ONLY if Phase 1 empty, Opus): pattern(4) + thread(5) via triggers/opus-analysis.ts
       Winner = lowest priority number
       → PROACTIVE_SYSTEM_PROMPT → Sonnet → bot.api.sendMessage
```

### Episodic consolidation cron (default '0 23 * * *' Europe/Paris)
```
src/episodic/cron.ts runConsolidateYesterday
  → src/episodic/consolidate.ts runConsolidate(yesterday-in-tz):
      1. DateTime.fromJSDate(date, { zone: tz }).toISODate() → YYYY-MM-DD
      2. SELECT episodic_summaries WHERE summary_date = localDateStr  → skip if exists (CONS-03)
      3. getPensieveEntriesForDay (source='telegram' filter, M008.1) → [] → skip (CONS-02)
      4. parallel: getContradictionsForDay + getDecisionsForDay
      5. assembleConsolidationPrompt
      6. anthropic.messages.parse with zodOutputFormat(EpisodicSummarySonnetOutputSchemaV4), 1 retry on parse fail
      7. runtime importance clamp: hasRealDecision → ≥6 (CONS-06), contradictions>0 → ≥7 (CONS-07)
      8. parseEpisodicSummary (v3 Zod re-validate)
      9. INSERT ... ON CONFLICT(summary_date) DO NOTHING
      10. catch → src/episodic/notify.ts notifyConsolidationError (CONS-12) → return {failed}
```

### OAuth callback (Google)
```
GET /oauth2callback?code=... → Google redirect lands in browser (no dedicated HTTP route)
User manually copies code into Telegram →
  src/bot/bot.ts handleTextMessage → isAwaitingOAuthCode(chatId)? → handleOAuthCode →
  src/gmail/oauth.ts exchangeCode → storeTokens → DB oauth_tokens row written
```

## Component Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │                 Telegram Update                     │
                    └─────────────────────────────────────────────────────┘
                                          │
                          webhook POST /<bot.token>  │  long-polling
                                          ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  src/index.ts  (Express + Grammy bootstrap, migrations, 3 cron peers)        │
│    ├── GET /health  ──────────────── docker-compose healthcheck              │
│    ├── POST /<bot.token> ─── webhookCallback(bot) ───┐                       │
│    └── cron peers: sync / proactive / episodic ───┐  │                       │
└──────────────────────────────────────────────────────┼──┼─────────────────────┘
                                                    │  │
                   ┌────────────────────────────────┘  │
                   ▼                                   ▼
         ┌───────────────────┐               ┌──────────────────────┐
         │ src/bot/bot.ts    │               │ cron.schedule(...)   │
         │  + middleware/    │               │  (index.ts)          │
         │    auth.ts (gate) │               └──────────────────────┘
         │  + handlers/      │                   │       │        │
         │    {sync,dec,summ,│         sync      │   proactive    │  episodic
         │     document}.ts  │         (6h)      │   (10:00 Paris)│  (23:00 Paris)
         └────────┬──────────┘                   ▼       ▼        ▼
                  │                     ┌───────────┐ ┌──────┐ ┌─────────────┐
                  │                     │src/sync/  │ │src/  │ │src/episodic/│
                  │                     │scheduler  │ │proact│ │cron →       │
                  │                     │→ gmail/   │ │/sweep│ │ consolidate │
                  │                     │  drive/   │ │→ trig│ │→ sources    │
                  │                     │  immich/  │ │ gers/│ │→ prompts    │
                  │                     └─────┬─────┘ │deadln│ │→ Sonnet     │
                  │                           │       │silnce│ │→ notify     │
                  │                           │       │cmtmnt│ └──────┬──────┘
                  │                           │       │pattrn│        │
                  │                           │       │thread│        │
                  │                           │       │opusAn│        │
                  │                           │       └──┬───┘        │
                  │    OAuth code relay       │          │            │
                  │  ◀─── bot.api.sendMessage ┼──────────┤            │
                  │                           │          │            │
                  ▼                           │          │            │
   ┌──────────────────────────────────────┐   │          │            │
   │   src/chris/engine.ts                │   │          │            │
   │   processMessage()                   │   │          │            │
   │     PP#0 decision-capture            │◀──┼──────────┤            │
   │     PP#1 trigger → capture/stakes    │   │          │            │
   │     PP#2 mute   PP#3 refusal         │   │          │            │
   │     PP#4 language (franc)            │   │          │            │
   │     detectMode (Haiku)               │   │          │            │
   │     ├→ journal  ── pensieve.store    │   │          │            │
   │     ├→ interrogate/reflect/coach/    │   │          │            │
   │     │  psychology/produce            │   │          │            │
   │     └→ photos ── immich.client       │   │          │            │
   │     post: praise-quarantine          │   │          │            │
   │     post: contradiction surface      │   │          │            │
   └───────────┬──────────────────────────┘   │          │            │
               │                              │          │            │
               ▼                              ▼          ▼            ▼
   ┌────────────────────┐ ┌────────────────────┐ ┌──────────────────────┐
   │ src/decisions/     │ │ src/pensieve/      │ │ src/memory/          │
   │ index.ts (barrel)  │ │ store,embed,       │ │ conversation,        │
   │  lifecycle SM,     │ │ retrieve,routing,  │ │ relational,          │
   │  capture-state,    │ │ tagger             │ │ context-builder      │
   │  triggers,         │ │ (bge-m3 ONNX       │ │                      │
   │  stats, regen,     │ │  1024-dim,         │ │                      │
   │  accuracy          │ │  hybrid search)    │ │                      │
   └──────┬─────────────┘ └──────┬─────────────┘ └──────┬───────────────┘
          │                      │                     │
          ▼                      ▼                     ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │   src/db/                                                        │
   │   schema.ts  (21 Drizzle tables/enums)                           │
   │   connection.ts (postgres-js singleton, Drizzle client)          │
   │   migrate.ts + migrations/0000..0005 (startup apply)             │
   │                                                                  │
   │   PostgreSQL 16 + pgvector (Docker Compose service)              │
   │   Tables: pensieve_entries, pensieve_embeddings (vector 1024),   │
   │     relational_memory, conversations, contradictions,            │
   │     decisions + decision_events + decision_capture_state +       │
   │     decision_trigger_suppressions, proactive_state, sync_status, │
   │     oauth_tokens, episodic_summaries                             │
   └──────────────────────────────────────────────────────────────────┘

   Shared infra (every layer above):
     src/llm/client.ts     — single Anthropic SDK; HAIKU/SONNET/OPUS constants
     src/llm/prompts.ts    — 15 named system prompts
     src/utils/logger.ts   — pino
     src/utils/errors.ts   — ChrisError hierarchy (LLMError, OAuthError, ...)
     src/config.ts         — env-var loader, cron schedules, timezones, model IDs
```

## Key Abstractions

**`processMessage(chatId, userId, text)` in `src/chris/engine.ts`:**
- Purpose: the single dispatcher every user text message flows through. All feature pre/post-processors live here.
- Pattern: Pre-processors (ordered, early-return on match) → mode detection → switch dispatch → post-processors.
- Invariants: always saves USER + ASSISTANT to `conversations` before return; never returns undefined (empty string → silent skip in `handleTextMessage`).

**`transitionDecision(decisionId, from, to, ...)` in `src/decisions/lifecycle.ts`:**
- Purpose: state-machine transitions over `decisions.lifecycle_state` with optimistic concurrency.
- Legal transitions: enforced by `LEGAL_TRANSITIONS` constant; illegal raises `InvalidTransitionError`.
- Examples: `open → due → resolved | withdrawn | stale`.

**`storePensieveEntry(content, source, metadata)` in `src/pensieve/store.ts`:**
- Purpose: verbatim write with content-hash; `storePensieveEntryDedup` and `storePensieveEntryUpsert` variants for sync sources.
- Pattern: content-hash (`src/utils/content-hash.ts`) forms natural dedup key; embeddings + tags are fire-and-forget followers.

**`retrieveContext(query, opts)` in `src/pensieve/routing.ts`:**
- Purpose: decides between hybrid vector search and episodic-summary fetch based on recency boundary + importance threshold.
- Pattern: `RECENCY_BOUNDARY_DAYS` default 14; high-importance or within-boundary → raw entries, otherwise → episodic summaries.

**`ChrisMode` enum in `src/chris/personality.ts`:**
- Values: `JOURNAL | INTERROGATE | REFLECT | COACH | PSYCHOLOGY | PRODUCE | PHOTOS | ACCOUNTABILITY`.
- `ACCOUNTABILITY` is never auto-detected — only routed by PP#0 capture state.

**`CONSTITUTIONAL_PREAMBLE` in `src/chris/personality.ts`:**
- Prepended to every user-facing LLM system prompt via `buildSystemPrompt(mode)`.

## Entry Points

**Process boot:**
- Location: `src/index.ts` → `main()`
- Triggers: `node dist/index.js` (production), `tsx watch src/index.ts` (dev)
- Responsibilities: run migrations, register three cron peers, start Express + Grammy (webhook if `WEBHOOK_URL` set, else long-polling)

**HTTP:**
- `GET /health` — `src/index.ts` — Docker healthcheck; 200/503 with per-component status (database mandatory, immich optional)
- `POST /<bot.token>` — `src/index.ts` — Grammy webhook mount (webhook mode only); path is the token to block unauthenticated update injection
- `GET /oauth2callback` — Google's redirect target; no server-side route — user pastes code into Telegram

**Telegram commands:**
- `/sync [status|gmail|drive|photos|oauth <code>]` — `src/bot/handlers/sync.ts`
- `/decisions [open|recent|stats N|suppress|suppressions|unsuppress|reclassify]` — `src/bot/handlers/decisions.ts`
- `/summary [YYYY-MM-DD]` — `src/bot/handlers/summary.ts`

**Telegram events:**
- `message:text` — `src/bot/bot.ts` `handleTextMessage` → `src/chris/engine.ts` `processMessage`
- `message:document` — `src/bot/handlers/document.ts` `handleDocument`

**Cron peers (all registered in `src/index.ts`):**
- Sync every 6h (`0 */6 * * *`) — `src/sync/scheduler.ts` `runAllSyncs`
- Proactive sweep daily 10:00 Europe/Paris — `src/proactive/sweep.ts` `runSweep`
- Episodic consolidation daily 23:00 Europe/Paris — `src/episodic/cron.ts` `runConsolidateYesterday`

**Manual scripts:**
- `scripts/backfill-episodic.ts` — backfill prior days' episodic summaries (idempotent)
- `src/scripts/audit-pensieve*.ts` — ground-truth audit + correction
- `src/scripts/backfill-tags.ts` — tag backfill for pre-tagger entries
- `scripts/adversarial-*.ts`, `scripts/test-photo-memory.ts` — live adversarial regression checks

## Error Handling

**Strategy:** Typed error hierarchy in `src/utils/errors.ts` — `ChrisError` base, specialised subclasses (`LLMError`, `RetrievalError`, `StorageError`, `OAuthError`, `GmailSyncError`, `ImmichSyncError`, `DriveSyncError`, `FileExtractionError`). Errors propagate up to layer boundaries where they're logged (pino) and either rethrown or converted to user-visible fallback replies.

**Patterns:**
- **Reply-path fallback (`src/bot/bot.ts`):** any throw from `processMessage` → localized error string (English/French/Russian) via `getLastUserLanguage`.
- **Fire-and-forget side effects:** tagging, embedding, relational-memory, contradiction detection are wrapped with 3s `Promise.race` timeouts and `.catch(logger.warn)` — never break the reply.
- **OAuthError = skip (not fail):** in `src/sync/scheduler.ts`, an `OAuthError` from a source is logged as "needs re-auth" not a failure notification; other errors notify Greg via `bot.api.sendMessage`.
- **Cron-level try/catch:** each `cron.schedule` callback has its own top-level catch that logs and continues — one cron failure never stops the process.
- **CONS-12 notification:** episodic consolidation failures send a Telegram message via `src/episodic/notify.ts` before returning `{ failed: true, error }`.
- **Optimistic concurrency:** `transitionDecision` raises `OptimisticConcurrencyError` on stale updated-at timestamps; caller retries.

## Cross-Cutting Concerns

**Logging:** `pino` singleton in `src/utils/logger.ts`. Structured JSON lines; every module logs with event-name strings like `chris.engine.process`, `episodic.consolidate.complete`, `sync.gmail.thread`. `pino-pretty` enabled in dev.

**Validation:** `zod` v3 is the general-purpose validator (Drizzle row shapes, episodic summary schemas). `zod/v4` is loaded only inside `src/episodic/consolidate.ts` as a bridge to `@anthropic-ai/sdk/helpers/zod::zodOutputFormat` (which requires v4); a v3 re-validate step (`parseEpisodicSummary`) is the authoritative shape check.

**Authentication:** Grammy middleware `src/bot/middleware/auth.ts` silently drops every `ctx.from.id` except `config.telegramAuthorizedUserId`. No per-handler re-check. Google OAuth tokens live in `oauth_tokens` table; Immich uses an API key in `x-api-key` header. No internal auth between subsystems (single-process).

**Timezone:** `luxon` throughout for DST-safe day boundaries. `node-cron` `timezone` option anchors cron ticks to `config.proactiveTimezone` (default Europe/Paris). `dayBoundaryUtc` helper in `src/episodic/sources.ts` converts local dates to UTC SQL ranges.

**Configuration:** `src/config.ts` — single `config` export, `dotenv/config` loaded at import; required env-vars enforced with explicit throws at boot (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_AUTHORIZED_USER_ID`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, etc.). Cron schedules and model IDs are config fields, not constants.

**Idempotency:** `pensieve_entries` uses content-hash dedup (unique index). `episodic_summaries` uses `UNIQUE(summary_date)` + pre-flight SELECT + `ON CONFLICT DO NOTHING`. `oauth_tokens` is upserted. `sync_status` per-source upsert of cursor (historyId / pageToken / timestamp).

**Fire-and-forget discipline:** A PLAN-level constraint ("never block the reply"). Every post-store side-effect goes through `void fn().catch(logger.error)` or `Promise.race([work, timeout])`.

---

*Architecture analysis: 2026-04-20*
