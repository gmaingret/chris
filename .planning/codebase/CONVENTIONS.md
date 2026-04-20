# Coding Conventions

**Analysis Date:** 2026-04-20

## Language & Module System

**TypeScript strict ESM.** `package.json` sets `"type": "module"`; `tsconfig.json` uses `"module": "ESNext"` with `"moduleResolution": "bundler"` and `"strict": true` plus `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`. Runtime is Node.js 22.

**ESM `.js` suffix on every internal import — no exceptions.** TypeScript sources import their siblings as `.js` so the compiled output loads correctly under Node's ESM resolver. Example from `src/bot/bot.ts`:
```ts
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { handleTextMessage } from '../chris/engine.js';
```
Never write `from './engine'` or `from './engine.ts'` for internal modules. External npm imports (`grammy`, `drizzle-orm`, `luxon`, `pino`, `zod`) keep the bare specifier.

**Barrel file exception.** `src/decisions/index.ts` is the single public surface for the decision archive subsystem — downstream code imports from `../decisions/index.js` (or the directory) rather than reaching into `../decisions/lifecycle.js` etc. No other subsystem uses a barrel.

## Naming Patterns

**Files:** kebab-case for multi-word modules (`capture-state.ts`, `content-hash.ts`, `vague-validator.ts`, `resolve-by.ts`). Single-word modules stay lowercase (`engine.ts`, `store.ts`, `retrieve.ts`). Test files: `__tests__/<module>.test.ts` co-located with the module under test.

**Functions:** `camelCase` verbs. Examples: `processMessage`, `storePensieveEntry`, `detectContradictions`, `runConsolidate`, `dayBoundaryUtc`. Grouped by subsystem prefix when helpful (`handleCapture`, `handleResolution`, `handlePostmortem`).

**Variables & parameters:** `camelCase`. Object keys on DB row types follow Drizzle's schema mapping (camelCase in TS → snake_case in SQL).

**Types & classes:** `PascalCase`. Examples: `ChrisError`, `RetrievalError`, `StorageError`, `DayPensieveEntry`, `UpsertAction`, `EpisodicSummarySonnetOutput`, `PensieveEntryMetadata`.

**Constants:** `SCREAMING_SNAKE_CASE` for exported tunables and prompt IDs. Examples from `src/pensieve/routing.ts`: `RECENCY_BOUNDARY_DAYS`, `HIGH_IMPORTANCE_THRESHOLD`. From `src/llm/prompts.ts`: `JOURNAL_SYSTEM_PROMPT`, `MODE_DETECTION_PROMPT`, `CONTRADICTION_DETECTION_PROMPT`. From `src/llm/client.ts`: `HAIKU_MODEL`, `SONNET_MODEL`, `OPUS_MODEL`.

**Enums from `src/db/schema.ts`** use camelCase `*Enum` export names wrapping snake_case string values: `epistemicTagEnum`, `decisionStatusEnum`, `contradictionStatusEnum`.

**Test-only constants live in `src/__tests__/fixtures/`.** Chat IDs as `CHAT_ID_<PURPOSE>` — see `src/__tests__/fixtures/chat-ids.ts`. Time constants (`DAY_MS`) in `src/__tests__/fixtures/time.ts`.

## Code Style

**No project ESLint or Prettier config.** Only `node_modules/*/eslintrc` files exist — the project enforces style through TypeScript strictness + convention by example. Look at a nearby file in the same subsystem and match it.

**Formatting observed:**
- 2-space indentation.
- Single quotes for strings; template literals for interpolation.
- Trailing commas in multi-line object/array literals and parameter lists.
- Semicolons always.
- Arrow functions for callbacks and short helpers; `export function` or `export async function` for top-level named functions.
- One blank line between top-level declarations; grouped declarations inside a function may share a block with a comment separator.

**Section dividers.** Longer modules use box-drawing comment rules to separate logical sections. Canonical form:
```ts
// ── Public types ────────────────────────────────────────────────────────────
// ── Hoisted mocks ───────────────────────────────────────────────────────────
// ── Haiku judge ─────────────────────────────────────────────────────────────
```
Used across `src/episodic/sources.ts`, `src/decisions/__tests__/live-accountability.test.ts`, `src/decisions/__tests__/synthetic-fixture.test.ts`, `src/pensieve/__tests__/integration.test.ts`. Emulate this for any module >100 lines.

**Numeric separators.** Large numeric literals use `_` for readability: `86_400_000`, `30_000`, `60_000`, `120_000`. See `src/utils/http.ts:9`, `src/__tests__/fixtures/time.ts:15`.

## Import Organization

**Order (observed convention — match it):**
1. Node built-ins (`node:crypto`).
2. External packages (`grammy`, `drizzle-orm`, `luxon`, `pino`, `zod`, `@anthropic-ai/sdk`).
3. Internal modules, ordered roughly by distance: same directory, then parent, then further ancestors.

Example from `src/episodic/consolidate.ts`:
```ts
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as zV4 from 'zod/v4';
import { anthropic, SONNET_MODEL } from '../llm/client.js';
import { config } from '../config.js';
import { db } from '../db/connection.js';
import { episodicSummaries } from '../db/schema.js';
import { logger } from '../utils/logger.js';
import { assembleConsolidationPrompt } from './prompts.js';
```

**No path aliases.** `tsconfig.json` declares none; all internal imports are relative with `.js` suffix.

**No `import type` enforcement observed;** type-only imports use the plain `import` form. Drizzle row types are imported via `typeof pensieveEntries.$inferSelect` rather than a dedicated `type` import.

## Error Handling

**Typed error hierarchy in `src/utils/errors.ts`.** All domain errors extend `ChrisError`, which carries `code` (SCREAMING_SNAKE_CASE string) and optional `cause` (for chained exceptions):
```ts
export class ChrisError extends Error {
  constructor(message: string, public code: string, public cause?: unknown) {
    super(message);
    this.name = 'ChrisError';
  }
}
export class StorageError extends ChrisError {
  constructor(message: string, cause?: unknown) {
    super(message, 'STORAGE_ERROR', cause);
  }
}
```
Subclasses: `RetrievalError`, `StorageError`, `LLMError`, `FileExtractionError`, `OAuthError`, `GmailSyncError`, `ImmichSyncError`, `DriveSyncError`. Always reuse these — do not throw raw `new Error(...)` from domain modules.

**Decision-subsystem errors in `src/decisions/errors.ts`.** State-machine violations use dedicated classes: `InvalidTransitionError`, `OptimisticConcurrencyError`, `DecisionNotFoundError` (re-exported via `src/decisions/index.ts`).

**Wrap-and-rethrow pattern.** `src/pensieve/store.ts` demonstrates the canonical shape:
```ts
try {
  /* db call */
} catch (error) {
  if (error instanceof StorageError) throw error;
  throw new StorageError('Failed to store pensieve entry', error);
}
```
Re-throw known typed errors unchanged; wrap everything else with a domain-specific error and the original as `cause`.

**Fire-and-forget side effects.** Tagging, embeddings, relational memory, and contradiction detection are wrapped `.catch(logger.error)` and never awaited on the reply path. PLAN constraint: "Never block." Match this for any new non-critical write path. See `src/chris/modes/journal.ts`, `src/chris/engine.ts`.

**LLM fail-soft wrappers.** `callLLM` in `src/llm/client.ts` **throws** on SDK errors (rate limit, network, 4xx/5xx). Callers that need fail-soft behavior wrap the call in `Promise.race` with a timeout and a try/catch → fail-soft default. The established examples are `validateVagueness`, `classifyStakes`, `parseResolveBy`, and the capture extractor — copy their shape rather than inventing a new one.

## Logging

**pino (`src/utils/logger.ts`).** Single singleton exported as `logger`. Dev uses `pino-pretty` (colorized); production emits JSON. Level controlled by `LOG_LEVEL` env var (default `info`).

**Structured logs — object first, message second.** Always pass the context object as the first arg, a short message key as the second:
```ts
logger.info({ entryId: entry.id, source }, 'pensieve.store');
logger.info({ contentHash, existingEntryId: existing.id }, 'pensieve.store.dedup');
logger.warn({ err: firstErr instanceof Error ? firstErr.message : String(firstErr) }, 'episodic.consolidate.sonnet.retry');
```

**Message keys are dot-separated `subsystem.event[.variant]`.** Examples: `pensieve.store`, `pensieve.store.dedup`, `pensieve.store.upsert`, `episodic.consolidate.complete`, `episodic.consolidate.sonnet.retry`. Grep by message key finds every log line for a given event.

**No `console.*` in production code.** Scripts may use console; library/application code routes through `logger`.

## Typing Discipline

**Strict mode is non-negotiable.** `strict: true` + `noUncheckedIndexedAccess: true` means array indexing returns `T | undefined`. Expect `array[0]!` non-null assertions after a `.length` guard, or explicit `if (!entry) throw ...` checks (pattern in `src/pensieve/store.ts:38`).

**Drizzle row types via `$inferSelect`.** Avoid re-declaring DB row shapes. Example:
```ts
): Promise<typeof pensieveEntries.$inferSelect> {
```

**Zod for external boundaries.** LLM structured outputs, episodic-summary schemas, and any parsed external payload go through `zod` (v3 for most modules, `zod/v4` at the Anthropic SDK boundary — see `src/episodic/consolidate.ts:33-81` for the documented v3/v4 dual-schema reason). Schema files are named `types.ts` (e.g., `src/episodic/types.ts`, `src/proactive/triggers/types.ts`).

**`unknown` over `any` for caught errors.** The `cause` property on `ChrisError` is typed `unknown`. Narrow at the call site: `error instanceof Error ? error.message : String(error)`.

**TSDoc comments on every exported function and non-trivial type.** The project treats TSDoc as load-bearing documentation, especially for the LLM/DB boundary. Include: a one-sentence summary, behavioral contract (when it throws, idempotency, side effects), and cross-references to tests or requirement IDs (e.g. `CONS-03`, `D-24`, `TEST-22`).

## LLM Tier Discipline

**Three models, three purposes — encoded in `src/config.ts` and `src/llm/client.ts`:**

| Tier | Model ID | Purpose | Typical max_tokens | Temperature |
|------|----------|---------|--------------------|-------------|
| `HAIKU_MODEL` | `claude-haiku-4-5-20251001` | classify / tag / mode-detect / vague-validate / stakes / resolve-by parser | ~100 | 0 |
| `SONNET_MODEL` | `claude-sonnet-4-6` | converse (mode handlers) + episodic consolidation + accountability + proactive winner | 500–2000 | 0 (or small) |
| `OPUS_MODEL` | `claude-opus-4-6` | deep proactive analysis (pattern + thread triggers) | larger | small |

**Never call a Sonnet-class task through `callLLM`.** `callLLM` hardcodes Haiku + `temperature: 0` + `max_tokens: 100` as its defaults (`src/llm/client.ts:23-37`). Sonnet/Opus tasks call `anthropic.messages.create({...})` directly with the appropriate model constant.

**Model IDs are env-overridable** (`HAIKU_MODEL`, `SONNET_MODEL`, `OPUS_MODEL` env vars) so retirements/upgrades do not require a code change.

**Constitutional preamble on every user-facing LLM call.** Compose system prompts through `buildSystemPrompt` from `src/chris/personality.ts` — it prepends `CONSTITUTIONAL_PREAMBLE`. Never hand-concatenate a system prompt that omits the preamble; this is what TEST-22 live-anti-flattery verifies end-to-end.

**Structured outputs via `zodOutputFormat`.** Sonnet calls that produce schema-shaped output use `@anthropic-ai/sdk/helpers/zod` `zodOutputFormat(...)` with a `zod/v4` schema (SDK runtime only accepts v4). See `src/episodic/consolidate.ts:129-183` — retry-once on parse failure, propagate rate-limit/network errors.

## Idempotency Patterns

**Content-hash dedup.** `src/utils/content-hash.ts` exposes `computeContentHash` (SHA-256). Used by `storePensieveEntryDedup` and `storePensieveEntryUpsert` in `src/pensieve/store.ts` — lookup by hash, skip if match, update + drop embeddings if different, insert otherwise.

**JSONB external-ID upsert.** `storePensieveEntryUpsert` keys on `source + metadata->>externalIdField` — the Gmail/Drive/Immich sync pipelines pass the provider's message/file/asset ID. Re-running a sync is a no-op for unchanged rows, a content update for changed rows.

**UNIQUE + pre-flight SELECT + ON CONFLICT DO NOTHING.** The episodic-consolidation pattern (CONS-03):
1. `SELECT WHERE summary_date = $1` — if exists, return `{ skipped: 'existing' }`.
2. Do the expensive Sonnet call + runtime clamping.
3. `INSERT ... ON CONFLICT (summary_date) DO NOTHING` — belt-and-suspenders for the race.

See `src/episodic/consolidate.ts:185-250`. Re-running the backfill script is idempotent per calendar day.

**Entry-count gate (CONS-02).** Before an expensive LLM call, check the input is non-empty. Zero entries for a day → skip the Sonnet call, skip the insert, return `{ skipped: 'no-entries' }`.

**Source-scoped cleanup.** Episodic consolidation and test teardown filter by `source='telegram'` (or a unique per-test source tag) so they do not clobber Gmail/Drive/Immich-sourced rows. `pensieve_entries` has no `chat_id` column — the `source` column is the cleanup discriminator. See M008.1 fix in `src/episodic/sources.ts:91-100` and the test patterns in `src/chris/__tests__/live-integration.test.ts:28`.

## Timezone Handling

**Europe/Paris by default** (`config.proactiveTimezone`), env-override via `PROACTIVE_TIMEZONE`.

**Luxon for all day-boundary work.** The canonical helper is `dayBoundaryUtc(date, tz)` in `src/episodic/sources.ts`:
```ts
const local = DateTime.fromJSDate(date, { zone: tz }).startOf('day');
return {
  start: local.toUTC().toJSDate(),
  end: local.plus({ days: 1 }).toUTC().toJSDate(),
};
```
DST-correct: a spring-forward day spans 23h UTC, fall-back spans 25h. Any new time-window code MUST use this helper (or replicate its shape) rather than `date.setUTCHours(0, 0, 0, 0)` or similar.

**`node-cron` `timezone` option.** Cron jobs pass `{ timezone: config.proactiveTimezone }` so wall-clock-scheduled work (10:00 proactive sweep, 23:00 episodic consolidation) stays pinned across DST. See `src/sync/scheduler.ts`, `src/episodic/cron.ts`.

**No reliance on host timezone.** Never use `new Date().getDay()` or `.getHours()` without a timezone-aware wrapper.

## Function Design

**Size.** Small helpers (5–30 lines) dominate. Complex orchestrators (`runConsolidate`, `processMessage`, `runSweep`) run longer but are heavily commented with numbered orchestration steps and cross-references to requirement IDs.

**Parameters.** Positional for 1–3 parameters with clear intent; named-object for 4+ or when optionality matters. Example of named-object: `storePensieveEntry(content, source, metadata?)` is still positional-with-optional because the three are semantically ordered; `processMessage(chatId, userId, text, { pensieveSource? })` uses a named object for options.

**Return values.** Discriminated unions for orchestrators that have multiple success/skip/fail outcomes. Example from `src/episodic/consolidate.ts:95-98`:
```ts
export type ConsolidateResult =
  | { inserted: true; id: string }
  | { skipped: 'existing' | 'no-entries' }
  | { failed: true; error: unknown };
```
Prefer this over `null`/`undefined` for "nothing happened" cases.

**`async`/`await` everywhere.** No raw `.then()` chains except for intentional fire-and-forget `.catch(logger.error)`.

## Module Design

**Named exports only.** No `export default` observed in `src/**`. Match this.

**One subsystem = one directory.** `src/decisions/`, `src/episodic/`, `src/gmail/`, `src/drive/`, `src/immich/`, `src/pensieve/`, `src/proactive/` each contain their whole world: domain logic, types, helpers, tests (in `__tests__/`). The bot/chris layers import across subsystems through each subsystem's public entry — for `decisions/`, the barrel; for others, the specific module file.

**No direct Drizzle in bot handlers.** Command/message handlers go through helper modules (e.g., `getEpisodicSummary` in `src/pensieve/retrieve.ts`) rather than raw DB queries. Keeps timezone + schema-shape concerns centralized.

**Webhook path is the bot token.** Grammy's webhook is mounted at `/${bot.token}` in `src/index.ts` to prevent unauthenticated update injection. Any future webhook endpoint MUST authenticate similarly — there is no additional auth middleware on the webhook path.

## Comments

**Block-comment headers on non-trivial modules.** The first comment in a file explains the module's role, the requirement IDs it satisfies, and what is out of scope. Canonical example: `src/episodic/consolidate.ts:1-29` and `src/episodic/sources.ts:1-24`.

**Requirement ID cross-references.** Comments cite `CONS-03`, `D-24`, `TEST-22`, `M008.1`, etc. These resolve to entries in `.planning/requirements/` and phase plans. When touching a line referenced by an ID, update the related planning doc in the same commit.

**"Why", not "what".** Inline comments explain non-obvious decisions (dual zod v3/v4 mirror, runtime importance clamping, inter-run cleanup to defeat idempotency in tests). Do not narrate trivial code.

---

*Convention analysis: 2026-04-20*
