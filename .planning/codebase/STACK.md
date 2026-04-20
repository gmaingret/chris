# Technology Stack

**Analysis Date:** 2026-04-20

## Languages

**Primary:**
- TypeScript 5.7 — all application code under `src/` (ESM, strict mode, `noUncheckedIndexedAccess`). See `tsconfig.json`.

**Secondary:**
- JavaScript — Dockerfile inline scripts only (e.g. bge-m3 pre-download in `Dockerfile` lines 17-23).
- SQL — hand-audited migrations in `src/db/migrations/0000_*.sql` through `0005_episodic_summaries.sql` applied via drizzle-orm migrator at startup and explicitly by `scripts/test.sh`.

## Runtime

**Environment:**
- Node.js 22 (ESM, `"type": "module"` in `package.json`). Enforced by `node:22-slim` base image in `Dockerfile`.
- Module resolution: `"moduleResolution": "bundler"` with `.js` suffix on internal imports (see `tsconfig.json` line 5; convention documented in `.planning/intel/arch.md`).
- Target: ES2022 (`tsconfig.json` line 3).

**Package Manager:**
- npm — `package-lock.json` committed at project root, `npm ci` used in `Dockerfile` line 8.
- No workspaces, no monorepo.

## Frameworks

**Core application:**
- **Grammy 1.31** — Telegram bot framework. Used in `src/bot/bot.ts` (Bot instance + command routing), `src/bot/handlers/*`, and `src/index.ts` (`webhookCallback` mount).
- **Express 4.21** — HTTP host for health probe + Grammy webhook. Used only in `src/index.ts` `createApp()`.
- **Drizzle ORM 0.45.2** — PostgreSQL data layer. Schema in `src/db/schema.ts` (21 tables/enums); connection in `src/db/connection.ts` uses `drizzle-orm/postgres-js` driver with the `postgres` npm package.
- **node-cron 4.2** — three independent schedulers registered in `src/index.ts` (proactive, episodic) and `src/sync/scheduler.ts` (sync). All use the `timezone` option set to `config.proactiveTimezone` (default `Europe/Paris`).

**Testing:**
- **Vitest 4.1** + `@vitest/coverage-v8 4.1` — test runner. Config at `vitest.config.ts` with `fileParallelism: false` (intentional — shared `pensieve_entries` cleanup races, see vitest.config.ts lines 7-16). Tests live in `src/**/__tests__/*.test.ts`.
- `scripts/test.sh` is the canonical entry: boots `docker-compose.local.yml` postgres on port 5433, applies all six migration SQL files explicitly via `psql -v ON_ERROR_STOP=1`, then runs `npx vitest run`.

**Build / Dev:**
- **TypeScript 5.7** — `npm run build` → `tsc` → `dist/` (declaration + source maps on).
- **tsx 4.19** — `npm run dev` (`tsx watch src/index.ts`) and ad-hoc ops scripts like `scripts/backfill-episodic.ts`.
- **drizzle-kit 0.31** — migration tooling. Scripts: `db:generate`, `db:migrate`, `db:push`. Config at `drizzle.config.ts` (dialect `postgresql`, schema `./src/db/schema.ts`, out `./src/db/migrations`).

## Key Dependencies

**LLM & ML:**
- `@anthropic-ai/sdk ^0.90.0` — sole Anthropic client, instantiated once in `src/llm/client.ts`. Sub-path import `@anthropic-ai/sdk/helpers/zod` used in `src/episodic/consolidate.ts` for structured-output validation.
- `@huggingface/transformers ^3.3.0` — local ONNX inference for embeddings. Singleton pipeline in `src/pensieve/embeddings.ts:9-20`. Model `Xenova/bge-m3` pre-downloaded into the Docker image at build time (`Dockerfile` lines 17-23).

**Database:**
- `postgres ^3.4.5` — low-level PG client (`postgres-js`) wired to Drizzle in `src/db/connection.ts:6-7`.
- `drizzle-orm ^0.45.2` — used across `src/pensieve/*`, `src/memory/*`, `src/decisions/*`, `src/proactive/*`, `src/sync/*`, `src/episodic/*`.
- pgvector — loaded as PostgreSQL extension (`CREATE EXTENSION IF NOT EXISTS vector;` in `scripts/test.sh` line 43); Drizzle column `vector(1024)` for `pensieve_embeddings.embedding`.

**Content extraction:**
- `pdf-parse ^2.4.5` — used in `src/utils/file-extract.ts` for uploaded PDF documents.
- `html-to-text ^9.0.5` — used in `src/gmail/client.ts` (body extraction from Gmail threads) and `src/utils/file-extract.ts`.

**Utilities:**
- `luxon ^3.7.2` — timezone-aware date math (day boundaries, cron scheduling). Used in episodic, pensieve retrieval/routing, proactive, decisions resolve-by, backfill script.
- `franc ^6.2.0` — EN/FR/RU language detection (`src/chris/language.ts`, restricted to `eng/fra/rus`).
- `zod ^3.24.0` — schema validation. `src/episodic/types.ts` imports `from 'zod'` (v3), while `src/episodic/consolidate.ts` imports `zod/v4` sub-path to satisfy the SDK's `zodOutputFormat` helper (three-layer Sonnet-output → Insert → DB-read chain).
- `pino ^9.0.0` + `pino-pretty ^13.0.0` — structured JSON logger in `src/utils/logger.ts`; `pino-pretty` transport enabled only when `NODE_ENV !== 'production'`.
- `dotenv ^16.4.0` — loaded via side-effect import in `src/config.ts:1` (`import 'dotenv/config'`).
- `uuid ^11.0.0` — declared but not directly imported in `src/`; Drizzle's `uuid()` column uses DB-side `gen_random_uuid()`. Likely transitive or vestigial.

**Google:**
- `googleapis ^171.4.0` — used in `src/gmail/client.ts`, `src/gmail/oauth.ts` (OAuth2 client + token refresh listener), `src/drive/client.ts` (Drive v3 Changes/Files).

## Configuration

**Environment:**
- Single source of truth: `src/config.ts`. Required keys enforced at boot via `required()` helper (throws on missing): `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_AUTHORIZED_USER_ID`, `DATABASE_URL`.
- Optional keys with defaults: `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `WEBHOOK_URL`, `MAX_CONTEXT_TOKENS`, `LOG_LEVEL`, `HAIKU_MODEL`, `SONNET_MODEL`, `OPUS_MODEL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `IMMICH_API_URL`, `IMMICH_API_KEY`, `SYNC_INTERVAL_CRON`, `SYNC_ENABLED`, `PROACTIVE_SWEEP_CRON`, `PROACTIVE_TIMEZONE`, `PROACTIVE_SILENCE_THRESHOLD_MULTIPLIER`, `PROACTIVE_SILENCE_BASELINE_DAYS`, `PROACTIVE_COMMITMENT_STALE_DAYS`, `PROACTIVE_SWEEP_CONTEXT_MAX_TOKENS`, `EPISODIC_CRON`, `PORT`, `NODE_ENV`.
- `.env` file is the runtime carrier; loaded by `dotenv/config` and also passed to the `chris` compose service via `env_file: .env` (`docker-compose.yml` line 24). Contents not read here.

**Build:**
- `tsconfig.json` — strict + `noUncheckedIndexedAccess` + `noImplicitReturns` + `noFallthroughCasesInSwitch`. Excludes `src/**/__tests__/**` and `src/**/*.test.ts` from production compile.
- `vitest.config.ts` — `root: 'src'`, `environment: 'node'`, `fileParallelism: false`.
- `drizzle.config.ts` — points at `src/db/schema.ts` and `src/db/migrations/`.

## Platform Requirements

**Development:**
- Docker + Docker Compose (for Postgres+pgvector; either via `docker-compose.local.yml` mapped to host port 5433, or the test-only `docker-compose.test.yml`).
- Node 22 installed locally when running tests or `npm run dev` outside Docker.

**Production:**
- Docker Compose on a self-hosted Proxmox LXC/VM at 192.168.1.50.
- Two services: `postgres` (image `pgvector/pgvector:pg16`, named volume `pgdata`) + `chris` (built from local `Dockerfile`, two-stage build that pre-caches the bge-m3 ONNX model into `node_modules/@huggingface/transformers/.cache/`).
- App container exposes port 3000 with docker-compose healthcheck (`curl -f http://localhost:3000/health`).

**LLM tier discipline (from `src/config.ts` defaults):**
- Haiku: `claude-haiku-4-5-20251001` — classify / tag / mode-detect (temp 0, max_tokens ~100 per `callLLM` in `src/llm/client.ts`).
- Sonnet: `claude-sonnet-4-6` — converse + episodic consolidation.
- Opus: `claude-opus-4-6` — deep proactive analysis (pattern/thread triggers in `src/proactive/triggers/*`).

---

*Stack analysis: 2026-04-20*
