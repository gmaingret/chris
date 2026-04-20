# External Integrations

**Analysis Date:** 2026-04-20

## APIs & External Services

**LLM provider — Anthropic:**
- Service: Anthropic Messages API (`@anthropic-ai/sdk ^0.90.0`).
- Single client instance in `src/llm/client.ts:8-10`; re-exported model-ID constants `HAIKU_MODEL`, `SONNET_MODEL`, `OPUS_MODEL`.
- Auth: `ANTHROPIC_API_KEY` (required, throws at boot if missing — `src/config.ts:10`).
- Model IDs are env-overridable (`HAIKU_MODEL`, `SONNET_MODEL`, `OPUS_MODEL`). Defaults in `src/config.ts:21-23`: `claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-6`.
- Three-tier discipline (per `.planning/intel/arch.md`): Haiku for classify/tag/mode-detect (temperature 0, ~100 tokens via `callLLM` wrapper); Sonnet for conversation + episodic consolidation; Opus for deep proactive pattern/thread analysis only.
- Structured output: `src/episodic/consolidate.ts` imports `zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod` and passes `EpisodicSummarySonnetOutputSchema` to Sonnet.

**Telegram Bot API — Grammy:**
- Service: Telegram Bot API via `grammy ^1.31.0`.
- Bot constructed in `src/bot/bot.ts:18` (`new Bot(config.telegramBotToken)`).
- Auth token: `TELEGRAM_BOT_TOKEN` (required).
- Single-user gate: `TELEGRAM_AUTHORIZED_USER_ID` (required, parsed to int in `src/config.ts:12`). Enforced in `src/bot/middleware/auth.ts` — all other users are silently dropped with no reply.
- Dual delivery modes controlled by `WEBHOOK_URL`:
  - Webhook mode (set): Express mounts `webhookCallback(bot, 'express')` at path `/${bot.token}` (`src/index.ts:102`) and calls `bot.api.setWebhook(...)` at boot. Path equals bot token to prevent spoofing.
  - Polling mode (unset): `bot.start({...})` long-polls; minimal Express health server still listens on `PORT`.
- Commands registered in `src/bot/bot.ts:24-32`: `/sync`, `/decisions`, `/summary`. Event handlers: `message:text` → `handleTextMessage` → `chris/engine.processMessage`; `message:document` → `src/bot/handlers/document.ts` (PDF/HTML/text extraction + Pensieve insert).
- Outbound: cron failures + consolidation errors notify user via `bot.api.sendMessage(...)` (see `src/sync/scheduler.ts`, `src/episodic/notify.ts`).

**Google APIs — Gmail & Drive:**
- Service: Google APIs via `googleapis ^171.4.0`.
- OAuth 2.0 flow in `src/gmail/oauth.ts`:
  - Scopes: `https://www.googleapis.com/auth/gmail.readonly` + `https://www.googleapis.com/auth/drive.readonly` (constants `GMAIL_READONLY_SCOPE`, `DRIVE_READONLY_SCOPE` on lines 9-11).
  - `generateAuthUrl()` requests `access_type: 'offline'` and `prompt: 'consent'` to force refresh token issuance.
  - `exchangeCode(code)` runs from `src/bot/handlers/sync.ts` when the user pastes the code into Telegram after visiting the auth URL. No server-side HTTP route accepts the redirect; `/oauth2callback` exists only as the registered redirect URI (default `http://localhost:3000/oauth2callback`).
  - Tokens persisted in DB via `oauthTokens` table (schema `src/db/schema.ts`); refresh is automatic via the `tokens` event listener attached in `getAuthenticatedClient()` (`src/gmail/oauth.ts:138-149`).
- Credentials: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (optional — absence raises `OAuthError` only when sync is invoked, not at boot).
- Gmail client: `src/gmail/client.ts` — `users.threads.list/get` with `maxResults: 100` pagination; body extraction via `html-to-text`. Wiring: `src/gmail/sync.ts` + `src/gmail/collapse.ts`.
- Drive client: `src/drive/client.ts` — `files.list` filtered to Google Docs / Sheets / text / markdown / csv MIME types; `files.export` for Docs→text/plain and Sheets→text/csv; `files.get({ alt: 'media' })` for plain text. Wiring: `src/drive/sync.ts`.

**Immich (photo library):**
- Service: self-hosted Immich server, reached over plain HTTPS (no SDK).
- Client: `src/immich/client.ts` using `fetchWithTimeout` from `src/utils/http.ts` (30s default timeout, AbortController).
- Auth header: `x-api-key: ${IMMICH_API_KEY}` (see `src/index.ts:38` ping and `src/immich/client.ts`).
- Endpoints hit:
  - `POST /api/search/metadata` — asset pagination with `withExif: true`, `withPeople: true`, `page`, `size: 100`; optional `updatedAfter` for incremental sync.
  - `GET /api/assets/{id}/thumbnail?size=preview` — preview image.
  - `GET /api/server/ping` — invoked by `/health` route for optional Immich availability check.
- Credentials: `IMMICH_API_URL`, `IMMICH_API_KEY` (both optional; absence marks `immich: 'unconfigured'` in health output rather than failing).
- Wiring: `src/immich/sync.ts`, `src/immich/metadata.ts` (reverse-geocoding + person labelling).

## Data Storage

**Primary database:**
- PostgreSQL 16 with the pgvector extension (`vector` type, 1024-dim).
- Production image: `pgvector/pgvector:pg16` (`docker-compose.yml:3`). Persistent named volume `pgdata` mounted at `/var/lib/postgresql/data`.
- Connection: `postgresql://chris:${POSTGRES_PASSWORD}@postgres:5432/chris` injected into the `chris` service (`docker-compose.yml:26`).
- Client: `postgres ^3.4.5` wired to Drizzle in `src/db/connection.ts` (`drizzle(sql, { schema })`).
- Schema: 21 Drizzle tables/enums defined in `src/db/schema.ts` — `pensieve_entries`, `pensieve_embeddings (vector(1024))`, `relational_memory`, `conversations`, `contradictions`, `decisions` + `decision_events` + `decision_capture_state` + `decision_trigger_suppressions`, `proactive_state`, `sync_status`, `oauth_tokens`, `episodic_summaries`.
- Migrations: hand-audited SQL files in `src/db/migrations/0000_*.sql` through `0005_episodic_summaries.sql`, applied at startup via `drizzle-orm/postgres-js/migrator` (called from `src/db/migrate.ts` via `src/index.ts:65`). `scripts/test.sh` applies them explicitly with `psql -v ON_ERROR_STOP=1` before running Vitest.

**Credentials:**
- `DATABASE_URL` (required). In production composed from `POSTGRES_PASSWORD`. In tests the URL is hardcoded: `postgresql://chris:localtest123@localhost:5433/chris` (`scripts/test.sh:7`).

**File storage:**
- None. Uploaded Telegram documents are downloaded, text-extracted (`src/utils/file-extract.ts` — PDF via `pdf-parse`, plain text / markdown / CSV / JSON as UTF-8), and inserted verbatim into `pensieve_entries`. Binary files are not retained.
- Embedding model weights cached on disk inside the container at `node_modules/@huggingface/transformers/.cache/` (preloaded in `Dockerfile` builder stage; carried into the final image via `COPY --from=builder ... node_modules/`).

**Caching:**
- No Redis or external cache. In-process caches:
  - Embedding pipeline singleton in `src/pensieve/embeddings.ts:9-20` (model loads once per process).
  - Session language map in `src/chris/language.ts:15` (ephemeral, resets on restart).

## Authentication & Identity

**End-user auth (Telegram):**
- Single-user bot. `TELEGRAM_AUTHORIZED_USER_ID` gates every update via `src/bot/middleware/auth.ts`. No role system, no per-handler re-check.

**Service auth (Google):**
- OAuth 2.0 offline flow with automatic refresh via the `client.on('tokens', ...)` handler that upserts new `access_token` / `expiry_date` into `oauth_tokens` (`src/gmail/oauth.ts:138-149`).
- Scope check helper `hasRequiredScopes` in `src/gmail/oauth.ts:158-161` for pre-flight gating.

**Service auth (Anthropic, Immich):**
- API-key only. Keys are read once at boot from env into the frozen `config` object.

## Monitoring & Observability

**Logger:**
- `pino ^9.0.0` in `src/utils/logger.ts`. JSON output in production; `pino-pretty` transport enabled when `NODE_ENV !== 'production'`.
- Log level controlled by `LOG_LEVEL` (default `info`).
- No external log sink — logs go to stdout and are collected by Docker.

**Error tracking:**
- None (no Sentry, Rollbar, etc.). Typed error hierarchy in `src/utils/errors.ts` (`OAuthError`, `DriveSyncError`, `ImmichSyncError`, `FileExtractionError`).
- Cron-layer failures surface to the operator via outbound Telegram message (`bot.api.sendMessage` in `src/sync/scheduler.ts` and `src/episodic/notify.ts`).

**Health probe:**
- `GET /health` in `src/index.ts:17-57`. Returns 503 if Postgres `SELECT 1` fails; 200 otherwise. Optional Immich ping (only if `IMMICH_API_URL` + `IMMICH_API_KEY` configured) contributes a `degraded` status without flipping 503.
- Used by docker-compose healthcheck (`docker-compose.yml:30-34`, `curl -f http://localhost:3000/health`).

## CI/CD & Deployment

**Hosting:**
- Self-hosted Proxmox at 192.168.1.50 (documented in `.planning/intel/stack.json`). Accessible over SSH from this sandbox per user memory note.
- Runtime unit: Docker Compose stack from `docker-compose.yml` (two services: `postgres`, `chris`).

**CI pipeline:**
- None detected (no `.github/workflows`, no `.gitlab-ci.yml`, no CircleCI/Jenkins config). Tests are run manually via `npm test` → `scripts/test.sh`.

**Build:**
- Two-stage `Dockerfile`:
  1. `builder` (node:22-slim): `npm ci`, `tsc`, then pre-downloads `Xenova/bge-m3` ONNX weights into the transformers cache (`Dockerfile:17-23`).
  2. `production` (node:22-slim + curl): copies `dist/`, `node_modules/` (incl. model cache), `package.json`, `src/db/migrations/` (not in `dist/`), and `drizzle.config.ts`. `CMD ["node", "dist/index.js"]`.

## Environment Configuration

**Required env vars (throw at boot if missing):**
- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_AUTHORIZED_USER_ID`
- `DATABASE_URL`

**Optional env vars (defaults in `src/config.ts`):**
- Embeddings: `EMBEDDING_MODEL` (`Xenova/bge-m3`), `EMBEDDING_DIMENSIONS` (1024).
- Bot delivery: `WEBHOOK_URL` (empty → polling mode), `PORT` (3000), `MAX_CONTEXT_TOKENS` (80000).
- Logging: `LOG_LEVEL` (info), `NODE_ENV`.
- Models: `HAIKU_MODEL`, `SONNET_MODEL`, `OPUS_MODEL`.
- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (`http://localhost:3000/oauth2callback`).
- Immich: `IMMICH_API_URL`, `IMMICH_API_KEY`.
- Cron: `SYNC_INTERVAL_CRON` (`0 */6 * * *`), `SYNC_ENABLED`, `PROACTIVE_SWEEP_CRON` (`0 10 * * *`), `PROACTIVE_TIMEZONE` (`Europe/Paris`), `EPISODIC_CRON` (`0 23 * * *`).
- Proactive tuning: `PROACTIVE_SILENCE_THRESHOLD_MULTIPLIER` (2), `PROACTIVE_SILENCE_BASELINE_DAYS` (14), `PROACTIVE_COMMITMENT_STALE_DAYS` (7), `PROACTIVE_SWEEP_CONTEXT_MAX_TOKENS` (10000).
- Compose-only: `POSTGRES_PASSWORD` (consumed by docker-compose substitution).

**Secrets location:**
- `.env` file at project root, loaded by `dotenv/config` in `src/config.ts:1` and also mounted into the `chris` container via `env_file: .env` (`docker-compose.yml:24`). Contents not examined here.

## Webhooks & Callbacks

**Incoming:**
- `POST /:telegramBotToken` — Grammy webhook dispatch (webhook mode only). Path equals `bot.token` to prevent unauthenticated update injection (`src/index.ts:102`).
- `GET /oauth2callback` — registered as the Google OAuth redirect URI but **not** bound to an Express route. The user pastes the `code` query param back into Telegram, and `/sync oauth <code>` completes the exchange via `exchangeCode` in `src/gmail/oauth.ts:38-51`.

**Outgoing:**
- `bot.api.setWebhook(${WEBHOOK_URL}/${bot.token})` at boot in webhook mode (`src/index.ts:104`).
- `bot.api.sendMessage(authorizedUserId, text)` for proactive sweeps, sync failure notifications, and episodic consolidation error notifications.

## Cron Schedules

Three cron jobs — all use `node-cron` with the `timezone` option = `config.proactiveTimezone` (default `Europe/Paris`) for DST-safe scheduling:

| Job | Default schedule | Registration | Handler |
|-----|------------------|--------------|---------|
| Sync (Gmail → Drive → Immich, sequential) | `0 */6 * * *` | `src/sync/scheduler.ts` `startScheduler()` (gated by `SYNC_ENABLED`) | `runAllSyncs` |
| Proactive sweep (accountability + reflective) | `0 10 * * *` | `src/index.ts:73-80` | `runSweep` |
| Episodic consolidation | `0 23 * * *` | `src/index.ts:89-96` | `runConsolidateYesterday` |

---

*Integration audit: 2026-04-20*
