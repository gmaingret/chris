# Codebase Structure

**Analysis Date:** 2026-04-20

## Directory Layout

```
chris/
├── src/
│   ├── index.ts                        # Process entry: migrations, crons, Express, Grammy launch
│   ├── config.ts                       # Centralized env-var loader; source of truth for cron/model/tz
│   │
│   ├── bot/                            # Grammy router, auth gate, command + document handlers
│   │   ├── bot.ts                      # Bot instance, `handleTextMessage`, command registration
│   │   ├── middleware/
│   │   │   └── auth.ts                 # Single-user gate (TELEGRAM_AUTHORIZED_USER_ID)
│   │   ├── handlers/
│   │   │   ├── sync.ts                 # /sync command, OAuth-code intake, status formatter
│   │   │   ├── decisions.ts            # /decisions dashboard + stats + suppress/reclassify
│   │   │   ├── summary.ts              # /summary [YYYY-MM-DD] episodic fetch
│   │   │   ├── document.ts             # message:document → file-extract → pensieve
│   │   │   └── __tests__/              # per-handler vitest specs
│   │   └── __tests__/                  # bot-integration + boundary-audit
│   │
│   ├── chris/                          # Engine + conversation modes (the heart)
│   │   ├── engine.ts                   # processMessage: PP#0..4 → detectMode → dispatch → post
│   │   ├── personality.ts              # CONSTITUTIONAL_PREAMBLE, buildSystemPrompt, ChrisMode type
│   │   ├── contradiction.ts            # detectContradictions vs past pensieve (Sonnet), resolve
│   │   ├── refusal.ts                  # detectRefusal regex+heuristic, declined-topics ledger
│   │   ├── language.ts                 # franc-based detection with last-lang stickiness
│   │   ├── praise-quarantine.ts        # SYCO-04 post-processor on JOURNAL/REFLECT/PRODUCE
│   │   ├── modes/                      # Seven conversation handlers + date-extraction helper
│   │   │   ├── journal.ts              # Verbatim store + Haiku reflection (default mode)
│   │   │   ├── interrogate.ts          # Retrieve context + Sonnet probe
│   │   │   ├── reflect.ts              # Retrieve context + Sonnet synthesis
│   │   │   ├── coach.ts                # Sonnet coaching (action-oriented)
│   │   │   ├── psychology.ts           # Sonnet psychological reframe
│   │   │   ├── produce.ts              # Sonnet creative/output-oriented
│   │   │   ├── photos.ts               # Immich fetch + Sonnet caption (vision)
│   │   │   └── date-extraction.ts      # Luxon + Haiku for "photos from last Tuesday"
│   │   └── __tests__/                  # engine.test + engine-mute + engine-refusal + contradiction
│   │
│   ├── decisions/                      # Decision archive — 14-file subsystem, barrel export
│   │   ├── index.ts                    # Barrel — the only import surface downstream uses
│   │   ├── lifecycle.ts                # transitionDecision state machine + LEGAL_TRANSITIONS
│   │   ├── errors.ts                   # InvalidTransitionError, OptimisticConcurrencyError, NotFound
│   │   ├── capture.ts                  # Five-stage capture flow (DECISION..FALSIFICATION)
│   │   ├── capture-state.ts            # JSONB draft CRUD, coerceValidDraft, abort-phrase check
│   │   ├── resolution.ts               # handleResolution + handlePostmortem + classifyOutcome
│   │   ├── triggers.ts                 # detectTriggerPhrase regex + classifyStakes (Haiku)
│   │   ├── triggers-fixtures.ts        # ABORT_PHRASES_{EN,FR,RU} literals
│   │   ├── suppressions.ts             # addSuppression / isSuppressed (trigger denylist)
│   │   ├── resolve-by.ts               # parseResolveBy (Haiku), CLARIFIER_LADDER_DAYS
│   │   ├── vague-validator.ts          # HEDGE_WORDS + validateVagueness (push-back on mush)
│   │   ├── classify-accuracy.ts        # 2-axis classifier (outcome × confidence)
│   │   ├── stats.ts                    # wilsonCI + dashboard + open/recent lists
│   │   ├── regenerate.ts               # Event-sourced decision state regeneration
│   │   └── __tests__/                  # one spec per module, + integration suites
│   │
│   ├── pensieve/                       # Append-only verbatim store + retrieval
│   │   ├── store.ts                    # storePensieveEntry + *Dedup + *Upsert variants
│   │   ├── embeddings.ts               # bge-m3 ONNX 1024-dim, chunkText, embedAndStore
│   │   ├── retrieve.ts                 # searchPensieve, getTemporalPensieve, hybridSearch, getEpisodicSummary
│   │   ├── routing.ts                  # retrieveContext (recency-boundary + importance gate)
│   │   ├── tagger.ts                   # VALID_TAGS + tagEntry (Haiku multi-label)
│   │   ├── ground-truth.ts             # Frozen test fixture for audit-pensieve scripts
│   │   └── __tests__/                  # embeddings, chunked, dedup, ground-truth, integration
│   │
│   ├── memory/                         # Non-Pensieve memory stores
│   │   ├── conversation.ts             # saveMessage + getRecentHistory on `conversations` table
│   │   ├── relational.ts               # writeRelationalMemory (Sonnet-synthesized observations)
│   │   ├── context-builder.ts          # buildMessageHistory + buildRelationalContext + buildPensieveContext
│   │   └── __tests__/
│   │
│   ├── proactive/                      # Outbound proactive messaging (cron-driven)
│   │   ├── sweep.ts                    # runSweep: dual-channel orchestrator (accountability + reflective)
│   │   ├── state.ts                    # proactive_state CRUD: mute, daily-caps per channel, escalation keys
│   │   ├── mute.ts                     # detectMuteIntent (Haiku) + parseMuteDuration + ack
│   │   ├── prompts.ts                  # PROACTIVE_SYSTEM_PROMPT + ACCOUNTABILITY_{SYSTEM,FOLLOWUP}_PROMPT
│   │   ├── context-builder.ts          # buildSweepContext — pulls recent activity for sweep prompts
│   │   ├── triggers/                   # Priority-ranked trigger generators (lower number wins)
│   │   │   ├── types.ts                # Trigger discriminated union + priority constants
│   │   │   ├── deadline.ts             # priority 0 — decisions due today (→ AWAITING_RESOLUTION)
│   │   │   ├── silence.ts              # priority 1 — SQL: no messages >N days
│   │   │   ├── commitment.ts           # priority 3 — SQL: open decisions past resolve-by grace
│   │   │   ├── pattern.ts              # priority 4 — Opus-driven recurring pattern detection
│   │   │   ├── thread.ts               # priority 5 — Opus-driven loose-thread identification
│   │   │   └── opus-analysis.ts        # runOpusAnalysis — shared Opus call for pattern+thread
│   │   └── __tests__/                  # sweep, deadline, silence, commitment, mute, state specs
│   │
│   ├── sync/                           # External-source sync cron orchestrator
│   │   ├── scheduler.ts                # runAllSyncs + startScheduler/stopScheduler (node-cron)
│   │   └── __tests__/
│   │
│   ├── gmail/                          # Gmail integration
│   │   ├── oauth.ts                    # createOAuth2Client, generateAuthUrl, exchangeCode, storeTokens
│   │   ├── client.ts                   # listThreads, getThread, extractMessageBody (googleapis)
│   │   ├── collapse.ts                 # stripQuotedReplies + collapseThread into single text blob
│   │   ├── sync.ts                     # syncGmail — threads → collapse → pensieve store+embed+tag
│   │   └── __tests__/
│   │
│   ├── drive/                          # Google Drive integration
│   │   ├── client.ts                   # listFiles, exportFileAsText, getChanges, getStartPageToken
│   │   ├── sync.ts                     # syncDrive — changes feed → text export → pensieve
│   │   └── __tests__/
│   │
│   ├── immich/                         # Immich photo library integration
│   │   ├── client.ts                   # fetchAssets, fetchRecentPhotos, fetchAssetThumbnail
│   │   ├── metadata.ts                 # assetToText — serialize metadata for pensieve
│   │   ├── sync.ts                     # syncImmich + loadSyncStatus/upsertSyncStatus (cursor)
│   │   └── __tests__/
│   │
│   ├── episodic/                       # Daily consolidation (Phase 21)
│   │   ├── consolidate.ts              # runConsolidate(date) — 10-step pipeline, CONS-01..12
│   │   ├── cron.ts                     # runConsolidateYesterday (tz-aware wrapper)
│   │   ├── sources.ts                  # dayBoundaryUtc + getPensieveEntriesForDay / Contradictions / Decisions
│   │   ├── prompts.ts                  # assembleConsolidationPrompt (pure function)
│   │   ├── notify.ts                   # notifyConsolidationError (CONS-12) via bot.api.sendMessage
│   │   ├── types.ts                    # EpisodicSummarySonnetOutputSchema + Insert + DB-read Zod chain
│   │   └── __tests__/                  # consolidate + cron + sources + prompts
│   │
│   ├── db/                             # Data layer
│   │   ├── schema.ts                   # 21 Drizzle tables/enums (340 lines)
│   │   ├── connection.ts               # postgres-js singleton + Drizzle client (`db`, `sql`)
│   │   ├── migrate.ts                  # runMigrations (drizzle-orm/postgres-js/migrator)
│   │   └── migrations/
│   │       ├── 0000_curved_colonel_america.sql      # baseline (pensieve, embeddings, conversations, relational, oauth, sync_status, contradictions, proactive_state)
│   │       ├── 0001_add_photos_psychology_mode.sql  # mode enum additions
│   │       ├── 0002_decision_archive.sql            # decisions + decision_events + decision_capture_state
│   │       ├── 0003_add_decision_epistemic_tag.sql  # epistemic tag enum on decisions
│   │       ├── 0004_decision_trigger_suppressions.sql
│   │       ├── 0005_episodic_summaries.sql          # UNIQUE(summary_date)
│   │       └── meta/                                # Drizzle-kit snapshots (do not hand-edit)
│   │
│   ├── llm/                            # Anthropic SDK + named prompts
│   │   ├── client.ts                   # anthropic singleton, callLLM, HAIKU/SONNET/OPUS constants
│   │   ├── prompts.ts                  # 15 named system prompts (JOURNAL, INTERROGATE, MODE_DETECTION, ...)
│   │   └── __tests__/
│   │
│   ├── utils/                          # Cross-cutting helpers (no internal deps)
│   │   ├── logger.ts                   # pino singleton
│   │   ├── errors.ts                   # ChrisError hierarchy
│   │   ├── http.ts                     # fetchWithTimeout, withRetry, RetryableHttpError
│   │   ├── text.ts                     # stripFences (for LLM JSON outputs in ```code blocks)
│   │   ├── content-hash.ts             # SHA-256 computeContentHash (dedup key)
│   │   ├── file-extract.ts             # PDF (pdf-parse) + HTML (html-to-text) + plain extraction
│   │   └── __tests__/
│   │
│   ├── scripts/                        # Dev/ops scripts compiled with the main tsconfig
│   │   ├── audit-pensieve.ts           # Ground-truth audit against src/pensieve/ground-truth.ts
│   │   ├── audit-pensieve-production.ts # Wrapper targeting production DB
│   │   ├── backfill-tags.ts            # Re-run tagger over pre-tagger rows
│   │   ├── seed-audit-data.ts          # Seed ground-truth rows for audit tests
│   │   └── __tests__/
│   │
│   └── __tests__/                      # Cross-cutting test fixtures only
│       └── fixtures/
│           ├── chat-ids.ts             # Reserved test chatIds
│           └── time.ts                 # DateTime helpers for date-locked tests
│
├── scripts/                            # Top-level ops scripts (tsx + shell)
│   ├── test.sh                         # Docker postgres up, migrations applied 0000..0005, vitest run
│   ├── backfill-episodic.ts            # Manual episodic backfill (idempotent)
│   ├── adversarial-100.ts              # 100-prompt adversarial regression (live Anthropic)
│   ├── adversarial-test.ts             # Smaller adversarial sweep
│   ├── test-photo-memory.ts            # Photos-mode live smoke test
│   └── regen-snapshots.sh              # Drizzle-kit snapshot regeneration helper
│
├── .planning/                          # GSD planning artefacts (this file lives here)
│   ├── codebase/                       # ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, ...
│   ├── intel/                          # Pre-computed arch.md + files.json + apis.json
│   ├── state/                          # Current state snapshots
│   └── config.json
│
├── Dockerfile                          # Multi-stage Node 22 ESM build
├── docker-compose.yml                  # Prod: chris + postgres (pgvector/pg16)
├── docker-compose.local.yml            # Local dev overrides
├── docker-compose.test.yml             # Test-only pgvector container (see scripts/test.sh)
├── drizzle.config.ts                   # drizzle-kit config (schema + migrations paths)
├── vitest.config.ts                    # fileParallelism: false (shared pensieve_entries cleanup)
├── tsconfig.json                       # ESM + moduleResolution: bundler
├── package.json
└── PLAN.md / PRD_Project_Chris.md / M00{6..14}_*.md   # Product + milestone specs
```

## Directory Purposes

**`src/bot/`:**
- Purpose: Telegram-facing adapter layer — Grammy router, auth middleware, command handlers
- Contains: the bot singleton, four command handlers (`sync`, `decisions`, `summary`, `document`), the auth middleware, `handleTextMessage`
- Key files: `src/bot/bot.ts` (router), `src/bot/middleware/auth.ts` (single-user gate), `src/bot/handlers/sync.ts` (OAuth-code relay lives here)

**`src/chris/`:**
- Purpose: the engine — central `processMessage` dispatcher + seven conversation modes + personality/contradiction/refusal/language/praise-quarantine post-processors
- Contains: `engine.ts` (422 lines, the main hot path), `personality.ts` (constitutional preamble + ChrisMode type), `contradiction.ts` (LLM-based contradiction detection against past pensieve), seven mode handlers
- Key files: `src/chris/engine.ts`, `src/chris/personality.ts`, `src/chris/modes/journal.ts` (default mode)

**`src/decisions/`:**
- Purpose: decision-archive subsystem — capture → lifecycle → resolution → stats → accuracy-classification → event-sourced regeneration
- Contains: 14 source files split by concern; `index.ts` barrel is the single import surface (PLAN constraint: downstream must not deep-import submodules)
- Key files: `src/decisions/index.ts` (barrel), `src/decisions/lifecycle.ts` (state machine), `src/decisions/capture.ts` (five-stage flow), `src/decisions/triggers.ts` (phrase detection + stakes)
- Cross-concerns: state machine invariants enforced in `lifecycle.ts`; all draft mutations go through `capture-state.ts` to centralize JSONB coercion

**`src/pensieve/`:**
- Purpose: append-only verbatim content store + embeddings (bge-m3 ONNX 1024-dim) + hybrid retrieval + tagging
- Contains: store/embed/retrieve/routing/tagger + a frozen ground-truth fixture for audit scripts
- Key files: `src/pensieve/store.ts` (storePensieveEntry + dedup/upsert variants), `src/pensieve/routing.ts` (retrieveContext — recency-boundary gate), `src/pensieve/embeddings.ts` (ONNX pipeline singleton)

**`src/memory/`:**
- Purpose: non-Pensieve memory — conversation turns, relational observations, context assembly
- Contains: `conversation.ts` (conversations table CRUD), `relational.ts` (Sonnet-synthesized observations), `context-builder.ts` (merges history + relational + pensieve into mode prompts)
- Key files: `src/memory/context-builder.ts` — the pre-LLM context assembler used by retrieval modes

**`src/proactive/`:**
- Purpose: outbound proactive messaging (cron-driven) — dual channels with priority-ranked triggers
- Contains: `sweep.ts` (orchestrator), `state.ts` (proactive_state table CRUD for mute + daily caps), trigger generators at priorities 0/1/3/4/5
- Key files: `src/proactive/sweep.ts` (runSweep), `src/proactive/triggers/deadline.ts` (only accountability trigger; priority 0)
- Note: `ACCOUNTABILITY` channel fires first regardless; `REFLECTIVE` channel runs Phase 1 SQL triggers, only invokes expensive Opus pattern/thread (Phase 2) if Phase 1 empty

**`src/sync/`:**
- Purpose: sync cron orchestrator — sequential Gmail → Drive → Immich every 6h
- Contains: `scheduler.ts` only (start/stop + runAllSyncs); source-specific logic lives in sibling dirs
- Key files: `src/sync/scheduler.ts`

**`src/gmail/` / `src/drive/` / `src/immich/`:**
- Purpose: one dir per external source, each with `client.ts` (raw API) + `sync.ts` (pull → pensieve pipeline)
- Special cases: `src/gmail/oauth.ts` (shared by Drive — both use Google OAuth with combined scopes), `src/gmail/collapse.ts` (thread-to-text reducer), `src/immich/metadata.ts` (asset metadata → text)

**`src/episodic/`:**
- Purpose: daily Sonnet-consolidated summary of the prior calendar day (Phase 21)
- Contains: 10-step `runConsolidate`, cron wrapper, day-bounded source readers, pure-function prompt assembler, three-layer Zod chain, Telegram error notifier
- Key files: `src/episodic/consolidate.ts` (332 lines, CONS-01..12), `src/episodic/types.ts` (v3 + v4 Zod mirror chain)

**`src/db/`:**
- Purpose: data layer — schema, migrations, connection singleton
- Contains: 21 Drizzle tables + enums in `schema.ts`, 6 hand-audited SQL migrations in `migrations/`, startup `runMigrations` in `migrate.ts`
- Key files: `src/db/schema.ts` (340 lines), `src/db/connection.ts` (exports `db` and `sql`), `src/db/migrations/0005_episodic_summaries.sql` (most recent)

**`src/llm/`:**
- Purpose: single Anthropic SDK boundary + all named system prompts in one place
- Contains: `client.ts` (singleton + model constants + `callLLM` wrapper), `prompts.ts` (15 named prompts)
- Key files: `src/llm/client.ts`, `src/llm/prompts.ts`

**`src/utils/`:**
- Purpose: cross-cutting helpers that have no internal project dependencies
- Contains: logger, error hierarchy, retryable HTTP, text stripping, SHA-256, PDF/HTML extraction
- Key files: `src/utils/errors.ts` (`ChrisError` base class — every sync source throws a subclass)

**`src/scripts/`:**
- Purpose: dev/ops scripts compiled with the main tsconfig (project-internal tooling)
- Contains: pensieve auditors (ground-truth diff + correction), tag backfiller, seed-audit-data
- Note: differs from top-level `scripts/` which is for top-level shell + tsx one-shots

**`scripts/` (top-level):**
- Purpose: operations + test orchestration entry points
- Contains: `test.sh` (docker up + migrations + vitest), `backfill-episodic.ts` (manual episodic backfill), adversarial sweeps, `test-photo-memory.ts`, `regen-snapshots.sh`
- Note: `scripts/test.sh` is the canonical test command — never run `vitest` directly (migrations and shared cleanup assume the full pipeline)

**`src/**/__tests__/`:**
- Purpose: vitest specs co-located with the module under test (one `__tests__/` per src dir)
- 78 test files total across the repo
- Naming: `<module>.test.ts` alongside `<module>.ts`; integration suites live at `<dir>/__tests__/integration.test.ts`
- Shared fixtures in `src/__tests__/fixtures/{chat-ids,time}.ts`

**`.planning/`:**
- Purpose: GSD planning artefacts — codebase maps (this file), intel caches, state snapshots
- Contains: `codebase/` (mapper output), `intel/` (pre-computed), `state/` (snapshots), `config.json`

## Key File Locations

**Entry Points:**
- `src/index.ts`: process boot (migrations, 3 cron peers, Express + Grammy start, SIGINT/SIGTERM shutdown)
- `src/bot/bot.ts`: Grammy router + `handleTextMessage` — the sync boundary between Telegram and the engine

**Configuration:**
- `src/config.ts`: single `config` export, `dotenv/config` at import, required-key enforcement
- `drizzle.config.ts`: drizzle-kit paths for migrations generation
- `vitest.config.ts`: `fileParallelism: false` (mandatory — pensieve cleanup races)
- `tsconfig.json`: ESM + `moduleResolution: bundler`
- `docker-compose.yml`: prod stack (chris + pgvector/pg16)
- `docker-compose.test.yml`: test-only postgres bring-up (used by `scripts/test.sh`)
- `.env`: env-var file (never committed; `.env.example` is the contract)

**Core Logic:**
- `src/chris/engine.ts`: the single message dispatcher (`processMessage`)
- `src/decisions/index.ts`: decision-archive barrel (only import surface)
- `src/pensieve/store.ts`: verbatim Pensieve writes
- `src/pensieve/routing.ts`: retrieval decisioning (hybrid vs episodic)
- `src/proactive/sweep.ts`: proactive cron orchestrator
- `src/episodic/consolidate.ts`: daily consolidation pipeline
- `src/sync/scheduler.ts`: sync cron orchestrator
- `src/db/schema.ts`: 21 Drizzle tables (source of truth for DB shape)

**Testing:**
- `scripts/test.sh`: canonical test runner (starts docker postgres, applies all 6 migrations, runs vitest)
- `src/**/__tests__/*.test.ts`: co-located vitest specs
- `src/__tests__/fixtures/`: shared test fixtures

## Naming Conventions

**Files:**
- Source: kebab-case `.ts` (`capture-state.ts`, `resolve-by.ts`, `praise-quarantine.ts`)
- Tests: `<module>.test.ts` beside the module under test in sibling `__tests__/`
- Migrations: `NNNN_<slug>.sql` (snake_case slug, zero-padded prefix from drizzle-kit)
- SQL fixtures / data files: kebab-case `.sql` / `.ts`

**Directories:**
- kebab-case plural for subsystem dirs: `decisions/`, `modes/`, `handlers/`, `migrations/`, `triggers/`
- `__tests__/` for co-located tests (Jest convention, enforced by vitest config)

**Symbols:**
- Types/enums: `PascalCase` (`ChrisMode`, `ConsolidateResult`, `InvalidTransitionError`)
- Functions: `camelCase` (`processMessage`, `runConsolidate`, `detectTriggerPhrase`)
- Constants: `SCREAMING_SNAKE_CASE` (`HAIKU_MODEL`, `CONSTITUTIONAL_PREAMBLE`, `LEGAL_TRANSITIONS`, `SURFACED_TTL_MS`)
- Drizzle tables: `camelCase` exports mapping to `snake_case` SQL identifiers (`pensieveEntries` → `pensieve_entries`)

**Internal imports:** all `.js` suffix (`import { foo } from './bar.js'`) under TypeScript `moduleResolution: bundler`.

## Where to Add New Code

**New conversation mode:**
- Handler: `src/chris/modes/<mode>.ts` exporting `handle<Mode>`
- Register in: `src/chris/engine.ts` (add to `VALID_MODES`, switch dispatch)
- Prompt: add `<MODE>_SYSTEM_PROMPT` to `src/llm/prompts.ts` and `MODE_DETECTION_PROMPT`'s enum
- Type: extend `ChrisMode` in `src/chris/personality.ts`
- Enum migration: new `conversationModeEnum` value in `src/db/schema.ts` + a numbered `src/db/migrations/NNNN_add_<mode>_mode.sql`
- Tests: `src/chris/modes/__tests__/<mode>.test.ts`

**New Telegram command:**
- Handler: `src/bot/handlers/<cmd>.ts` exporting `handle<Cmd>Command`
- Register in: `src/bot/bot.ts` via `bot.command(...)` (MUST be before `bot.on('message:text')`)
- Tests: `src/bot/handlers/__tests__/<cmd>.test.ts`
- Update `.planning/intel/apis.json` if you want it discoverable by mappers

**New external sync source:**
- New dir: `src/<source>/` with `client.ts` (raw API wrapper) + `sync.ts` (pull → pensieve)
- Wire into: `src/sync/scheduler.ts` `runAllSyncs` (sequential, after existing sources)
- OAuth: if Google-family, reuse `src/gmail/oauth.ts` (add scope constant); otherwise add `<source>/oauth.ts`
- DB cursor: add to `sync_status` table (per-source rows keyed by source name)
- Error type: add `<Source>SyncError` to `src/utils/errors.ts`
- Tests: `src/<source>/__tests__/`

**New proactive trigger:**
- New file: `src/proactive/triggers/<trigger>.ts` exporting `create<Trigger>Trigger`
- Import + call in: `src/proactive/sweep.ts`
- Priority: add constant to `src/proactive/triggers/types.ts`; lower number wins
- Opus-backed? → pattern/thread use shared `src/proactive/triggers/opus-analysis.ts`; SQL-backed trigger reads DB directly
- Tests: `src/proactive/__tests__/<trigger>.test.ts`

**New DB table/column:**
- Schema: add to `src/db/schema.ts`
- Migration: `npm run db:generate` — drizzle-kit writes `src/db/migrations/NNNN_<slug>.sql`
- Audit: open the generated SQL and sanity-check (all 6 current migrations are hand-audited)
- `scripts/test.sh` — if the migration needs explicit ordering, the script applies them by filename
- Test container is torn down between runs

**New LLM prompt:**
- Constant: `src/llm/prompts.ts` — add `<NAME>_PROMPT` in SCREAMING_SNAKE_CASE
- If user-facing generation, ensure the caller prepends `CONSTITUTIONAL_PREAMBLE` via `buildSystemPrompt`
- Choose model at call site: `HAIKU_MODEL` (classify/tag, temp 0, ~100 tokens) / `SONNET_MODEL` (converse + consolidation) / `OPUS_MODEL` (deep proactive only)

**Shared utility:**
- Location: `src/utils/<helper>.ts` — MUST have no internal project imports (utils is a leaf layer)
- Export: named only (no default exports anywhere in the repo)
- Tests: `src/utils/__tests__/<helper>.test.ts`

**Cross-cutting test fixture:**
- Location: `src/__tests__/fixtures/<name>.ts`
- Example: `chat-ids.ts` (reserved chatIds for test isolation), `time.ts` (frozen DateTime helpers)

**One-shot ops script:**
- Prefer top-level `scripts/<name>.ts` (run via `tsx scripts/<name>.ts`) for end-user ops
- Prefer `src/scripts/<name>.ts` for project-internal tooling that imports `src/` modules and shares tsconfig

## Special Directories

**`src/**/__tests__/`:**
- Purpose: vitest specs, co-located per module
- Generated: No
- Committed: Yes
- Run via: `scripts/test.sh` (NOT bare `vitest` — tests assume docker postgres is up and migrations applied)

**`src/db/migrations/`:**
- Purpose: ordered SQL migration files, applied at startup via `runMigrations`
- Generated: semi — `drizzle-kit generate` writes initial SQL, then hand-audited
- Committed: Yes, including `meta/` snapshot directory (do not hand-edit `meta/`)
- Ordering matters: `scripts/test.sh` applies `0000 → 0001 → 0002 → 0003 → 0004 → 0005` explicitly

**`src/pensieve/ground-truth.ts`:**
- Purpose: frozen fixture for the pensieve-audit scripts
- Generated: No — hand-maintained
- Committed: Yes
- Used by: `src/scripts/audit-pensieve*.ts`

**`src/coverage/`:**
- Purpose: vitest-v8 coverage output
- Generated: Yes (by `vitest --coverage`)
- Committed: No (should be gitignored)

**`src/node_modules/`:**
- Purpose: stray vitest cache (`.vite/vitest/...`) — not a real nested package
- Generated: Yes
- Committed: No

**`dist/`:**
- Purpose: TypeScript compiled output (entry: `dist/index.js`)
- Generated: Yes (`npm run build` / `tsc`)
- Committed: No

**`.planning/`:**
- Purpose: GSD planning artefacts (codebase maps, intel caches, state snapshots)
- Generated: Yes (by GSD commands)
- Committed: Yes — this is how planning state survives across sessions

**`tmp/`, `.tmp/`, `.bg-shell/`:**
- Purpose: scratch directories for dev
- Committed: No (gitignored)

---

*Structure analysis: 2026-04-20*
