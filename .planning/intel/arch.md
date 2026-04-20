---
updated_at: "2026-04-20T00:00:00Z"
---

## Architecture Overview

Project Chris is a single-user, self-hosted Telegram bot running as a Node.js 22 ESM service in Docker Compose alongside PostgreSQL 16 + pgvector. The architecture is a **layered pensieve** — an append-only verbatim content store paired with semantic retrieval, wrapped in a three-tier LLM pipeline (Haiku classify → Sonnet converse → Opus deep analysis).

Every Telegram text message flows through `chris/engine.processMessage`, which performs mode detection (Haiku) and dispatches to one of seven mode handlers. Writes to `pensieve_entries` are verbatim and never block the reply — tagging, embedding, relational-memory synthesis, and contradiction detection are fire-and-forget. Three independent crons (sync, proactive sweep, episodic consolidation) run alongside the bot. Memory is tiered: raw Pensieve for recent recall, episodic daily summaries for older context, with retrieval routing by recency + importance.

## Key Components

| Component | Path | Responsibility |
|-----------|------|----------------|
| Entry point | `src/index.ts` | Boot migrations, register crons (sync, proactive, episodic), start Express health server + Grammy webhook/polling |
| Config | `src/config.ts` | Centralized env-var loader with required-key enforcement; source of truth for cron schedules, model IDs, timezones |
| Bot router | `src/bot/bot.ts` | Grammy Bot instance, auth middleware, /sync /decisions /summary commands, text/document event handlers |
| Auth | `src/bot/middleware/auth.ts` | Single-user gate — only `TELEGRAM_AUTHORIZED_USER_ID` passes, everything else silently dropped |
| Engine | `src/chris/engine.ts` | Central dispatcher: OAuth-code interception, decision capture flow, mode detection, contradiction surfacing with 24h TTL, refusal/praise-quarantine post-processing |
| Mode handlers | `src/chris/modes/{journal,interrogate,reflect,coach,psychology,produce,photos}.ts` | Seven conversation modes; journal stores to pensieve, others retrieve + reply |
| Personality | `src/chris/personality.ts` | `CONSTITUTIONAL_PREAMBLE`, system-prompt composition, contradiction-notice formatting |
| Pensieve store | `src/pensieve/store.ts` | Verbatim insert (`storePensieveEntry`), dedup and upsert variants with content-hash |
| Embeddings | `src/pensieve/embeddings.ts` | bge-m3 ONNX pipeline (1024-dim), text chunking, store + embed helpers |
| Retrieval | `src/pensieve/retrieve.ts`, `routing.ts` | Hybrid search (vector + temporal + importance), episodic-summary fetch, recency-boundary routing |
| Memory | `src/memory/{conversation,relational,context-builder}.ts` | Turn-level history, relational-memory synthesis, context assembly for modes |
| Decision archive | `src/decisions/` | 14-file subsystem: capture flow, lifecycle state machine (`transitionDecision`), triggers, stakes classification, vague-validator, resolve-by parser, stats + Wilson CI, 2-axis accuracy classifier, regeneration from events |
| Proactive sweep | `src/proactive/sweep.ts` + `triggers/*.ts` | Dual-channel: accountability (deadline → AWAITING_RESOLUTION) + reflective (silence/commitment SQL, then Opus pattern/thread). Priority-based winner selection. Global mute gate |
| Sync | `src/sync/scheduler.ts`, `gmail/*`, `drive/*`, `immich/*` | Every-6h cron: Gmail threads → Drive files → Immich photos. Each source has client + sync + collapse/metadata; feeds into Pensieve with embeddings + tags |
| Episodic consolidation | `src/episodic/` | Daily Sonnet-powered summary of prior calendar day's entries + contradictions + decisions. Three-layer Zod chain. Idempotent via UNIQUE(summary_date) |
| DB layer | `src/db/schema.ts` | 21 Drizzle tables/enums: pensieve_entries, pensieve_embeddings (pgvector 1024-dim), relational_memory, conversations, contradictions, decisions + decision_events + decision_capture_state + decision_trigger_suppressions, proactive_state, sync_status, oauth_tokens, episodic_summaries |
| Migrations | `src/db/migrations/*.sql` | Six hand-audited migrations applied at startup via drizzle-orm/postgres-js/migrator |
| LLM client | `src/llm/client.ts` | Single Anthropic SDK instance, model constants (Haiku 4.5 / Sonnet 4.6 / Opus 4.6), `callLLM` convenience wrapper |
| Prompts | `src/llm/prompts.ts` | 15 named system prompts — one per cognitive task |
| Utils | `src/utils/{logger,errors,http,text,content-hash,file-extract}.ts` | pino logger, typed error hierarchy, retryable HTTP, text helpers, SHA content-hash, PDF/HTML extraction |

## Data Flow

### Inbound text message
```
Telegram update
  → Grammy webhook/polling
  → auth middleware (single-user gate)
  → bot.on('message:text') / handleTextMessage
  → OAuth-code interception? → handle and return
  → processMessage(chatId, userId, text):
      • detect language (franc) — cached for error fallbacks
      • active decision capture? → handleCapture / handleResolution / handlePostmortem
      • detectTriggerPhrase → classifyStakes → openCapture (if warranted & not suppressed)
      • MODE_DETECTION_PROMPT → pick journal | interrogate | reflect | coach | psychology | produce | photos
      • mode handler → LLM call (Haiku or Sonnet) → reply text
      • journal mode: storePensieveEntry (verbatim) → embedAndStore + tagEntry (fire-and-forget)
      • always: saveMessage (conversations), writeRelationalMemory (fire-and-forget), detectContradictions (with 24h surfaced-TTL)
  → ctx.reply(response)
```

### Inbound document
```
message:document → handleDocument
  → download → extractText (pdf-parse / html-to-text / plain)
  → storePensieveEntry → embedAndStore
```

### Sync cron (every 6h)
```
runAllSyncs
  → syncGmail (OAuth + listThreads + collapseThread + store+embed+tag) — OAuthError = skip
  → syncDrive (changes feed + exportFileAsText) → store+embed+tag
  → syncImmich (recent photos + metadata) → store+embed+tag
  → failures notify user via bot.api.sendMessage (swallowed if notify itself fails)
```

### Proactive sweep cron (10:00 Europe/Paris default)
```
runSweep
  → isMuted? → skip both channels
  → ACCOUNTABILITY: createDeadlineTrigger → upsertAwaitingResolution → ACCOUNTABILITY_SYSTEM_PROMPT → Sonnet → send
  → REFLECTIVE phase 1 (parallel SQL): silence(pri 1) + commitment(pri 3)
  → REFLECTIVE phase 2 (only if phase 1 empty): Opus pattern(4) + thread(5)
  → winner by priority → PROACTIVE_SYSTEM_PROMPT → Sonnet → send
  → independent daily caps per channel (hasSentTodayReflective / Accountability)
```

### Episodic consolidation cron (23:00 Europe/Paris default)
```
runConsolidateYesterday → runConsolidate(date):
  → pre-flight SELECT episodic_summaries.summary_date — skip if exists (CONS-03)
  → getPensieveEntriesForDay + getContradictionsForDay + getDecisionsForDay
  → entry-count gate: zero entries → return (no Sonnet call) (CONS-02)
  → assembleConsolidationPrompt → Sonnet w/ zodOutputFormat (EpisodicSummarySonnetOutputSchema)
  → runtime clamp importance: decision-day ≥ 6 (CONS-06), contradiction-day ≥ 7 (CONS-07)
  → INSERT ... ON CONFLICT(summary_date) DO NOTHING (CONS-03)
  → on any failure: notifyConsolidationError via Telegram (CONS-12)
```

## Conventions

- **ESM everywhere.** All internal imports use the `.js` suffix to resolve ESM from TypeScript under `moduleResolution: bundler`.
- **Barrel file.** `src/decisions/index.ts` is the single import surface for the decision archive subsystem to keep downstream imports stable.
- **Fire-and-forget side effects.** Tagging, embeddings, relational memory, and contradiction detection are wrapped in `.catch(logger.error)` and never awaited on the reply path (PLAN constraint: "Never block").
- **Constitutional preamble.** Every LLM call that produces user-facing text prepends `CONSTITUTIONAL_PREAMBLE` from `src/chris/personality.ts`.
- **Three-tier model discipline.** Haiku for classify/tag/mode-detect (temperature 0, max_tokens ~100); Sonnet for converse + consolidation; Opus for deep proactive analysis only.
- **Idempotent consolidation.** UNIQUE(summary_date) + pre-flight SELECT + ON CONFLICT DO NOTHING — re-running the backfill script is a no-op for completed days.
- **Timezone-aware cron.** `node-cron`'s `timezone` option combined with Luxon day-boundary helpers (`dayBoundaryUtc`) gives DST-safe scheduling in Europe/Paris.
- **Tests against real Postgres.** `scripts/test.sh` starts a pgvector/pg16 container, applies all SQL migrations in order, then runs vitest with `fileParallelism: false` (shared `pensieve_entries` cleanup races across files; there is no chatId column to scope cleanup by).
- **Single-user auth.** Grammy middleware silently drops everyone except `TELEGRAM_AUTHORIZED_USER_ID`. No per-handler re-check.
- **Source-scoped cleanup.** Episodic consolidation and test cleanup filter by `source='telegram'` to avoid clobbering Gmail/Drive/Immich-sourced rows (M008.1 fix).
- **Migration ordering matters.** 0000 (baseline) → 0001 (photos/psychology modes) → 0002 (decision archive) → 0003 (decision epistemic tag) → 0004 (decision trigger suppressions) → 0005 (episodic_summaries). test.sh applies all six explicitly.
- **No direct Drizzle in handlers.** Command handlers go through helper modules (e.g. `src/pensieve/retrieve.ts` `getEpisodicSummary`) rather than raw queries, to centralize timezone + schema-shape concerns.
- **Webhook path = bot.token.** The Grammy webhook is mounted at `/${bot.token}` to prevent unauthenticated update injection.
