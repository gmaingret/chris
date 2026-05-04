# Testing Patterns

**Analysis Date:** 2026-04-20

## Test Framework

**Runner:** Vitest 4.1.x (`vitest` + `@vitest/coverage-v8` in devDependencies). Config: `vitest.config.ts` at repo root.

**Key config (`vitest.config.ts`):**
```ts
export default defineConfig({
  test: {
    root: 'src',
    environment: 'node',
    globals: false,                     // explicit imports from 'vitest' required
    include: ['**/__tests__/**/*.test.ts'],
    fileParallelism: false,             // Phase 18 WR-01 — serial file execution
  },
});
```

**`fileParallelism: false` is load-bearing.** Multiple suites (`synthetic-fixture`, `live-accountability`, `vague-validator-live`, live-anti-flattery) each delete `pensieve_entries WHERE source='telegram'` as cleanup. `pensieve_entries` has no `chat_id` column to scope deletes by. Under Vitest's default parallel pool, cleanup in one file races and deletes rows written by siblings. Serial file execution eliminates the race. Vitest 4 top-level `fileParallelism: false` replaces the old `poolOptions.forks.singleFork`. Do NOT re-enable parallelism without first introducing a per-file source-tag convention.

**Assertion library:** Vitest built-in `expect`. Imports are explicit (`globals: false`):
```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
```

## Run Commands

**Full Docker-gated run (canonical — always use this):**
```bash
npm test                            # invokes scripts/test.sh
bash scripts/test.sh                # same thing
bash scripts/test.sh path/to/file   # extra args forwarded to vitest
```

This is the rule. MEMORY.md `feedback_always_run_docker_tests` says: **"Always run full Docker tests — never skip integration tests, always start real Postgres."** No exceptions. Even for a single-file change, `bash scripts/test.sh src/episodic/__tests__/consolidate.test.ts` ensures a real database and real migrations.

**Unit-only (no Docker, no DB) — for rare targeted runs during development:**
```bash
npm run test:unit                   # vitest run
npx vitest run path/to/file         # single file, no DB
```
This is ONLY valid for pure-function tests that do not touch the database. Most tests in this repo require Postgres; skip this mode by default.

**Manual live testing against a running Docker Postgres** (documented in `docker-compose.test.yml` header):
```bash
docker compose -f docker-compose.test.yml up -d
DATABASE_URL=postgresql://chris:testpass@localhost:5432/chris_test \
  ANTHROPIC_API_KEY=... npx vitest run src/episodic/__tests__/live-anti-flattery.test.ts
```

## Docker Test Orchestration

**`scripts/test.sh` is the entry point** — called by `npm test`. It:

1. Spins up Postgres via `docker compose -f docker-compose.local.yml up -d postgres`.
   Uses `pgvector/pgvector:pg16` image, `tmpfs` for `/var/lib/postgresql/data` (ephemeral — resets every run).
2. Polls `pg_isready` for up to 30 seconds.
3. Creates the `vector` extension: `CREATE EXTENSION IF NOT EXISTS vector;`.
4. Applies all six migrations in order through `psql -v ON_ERROR_STOP=1`:
   - `src/db/migrations/0000_curved_colonel_america.sql` (baseline)
   - `0001_add_photos_psychology_mode.sql`
   - `0002_decision_archive.sql`
   - `0003_add_decision_epistemic_tag.sql`
   - `0004_decision_trigger_suppressions.sql`
   - `0005_episodic_summaries.sql`
5. Runs `npx vitest run "$@"` with the env vars below set.
6. `trap cleanup EXIT` tears down the container.

**`-v ON_ERROR_STOP=1` is load-bearing.** Without it, psql exits 0 even on SQL errors, defeating `set -euo pipefail`, and vitest runs against a half-migrated schema. Never remove this flag.

**Migration ordering matters.** If you add a migration (e.g. `0006_*.sql`), you MUST add a corresponding `psql` line to `scripts/test.sh` — the script applies them explicitly, not via drizzle-kit.

**Env vars set by `scripts/test.sh`:**
```
DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-test-key}
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN:-test-token}
TELEGRAM_AUTHORIZED_USER_ID=${TELEGRAM_AUTHORIZED_USER_ID:-99999}
```

## Docker Compose Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Production stack (postgres + chris app) for deploy |
| `docker-compose.local.yml` | Local dev + used by `scripts/test.sh` — maps Postgres to port **5433**, tmpfs volume, app container included |
| `docker-compose.test.yml` | Standalone Postgres for manual ad-hoc testing on port **5433**; no app container; uses different user/password (`chris/testpass/chris_test`) |

`scripts/test.sh` uses `docker-compose.local.yml` (not the test compose file) — this is intentional because `.local.yml` matches the deployment schema including the `chris` app service.

## Test File Layout

**Co-located with the module under test**, in a `__tests__/` subdirectory:
```
src/pensieve/store.ts
src/pensieve/__tests__/store.test.ts
src/pensieve/__tests__/dedup.test.ts
src/pensieve/__tests__/integration.test.ts
```

**Shared fixtures live in `src/__tests__/fixtures/`:**
- `src/__tests__/fixtures/chat-ids.ts` — centralized `CHAT_ID_<PURPOSE>` registry (e.g. `CHAT_ID_LIVE_ACCOUNTABILITY = BigInt(99919)`). Rule: every test file that writes chat-scoped rows MUST import its chat ID from here. Never hardcode `BigInt(9991X)` literals or collide with an existing ID. When adding a new test file, allocate the next ID.
- `src/__tests__/fixtures/time.ts` — shared time constants (`DAY_MS = 86_400_000`).

**~80 test files total** across `src/` (as of 2026-04-20), covering bot handlers, engine, modes, pensieve, memory, decisions subsystem, proactive sweep, episodic consolidation, sync adapters (gmail/drive/immich), utils.

**`tsconfig.json` excludes tests from the build:** `"exclude": ["node_modules", "dist", "src/**/__tests__/**", "src/**/*.test.ts"]`.

## Test Structure

**Canonical block header.** Every test file starts with a block comment explaining the suite's purpose, requirement IDs covered, and a `Run:` example:
```ts
/**
 * src/episodic/__tests__/consolidate.test.ts — Phase 21 Plan 04 Task 3
 *
 * Integration tests for `runConsolidate(date)`. Real Postgres + mocked
 * Anthropic SDK + mocked bot.api.sendMessage. Covers CONS-01..CONS-12.
 *
 * Run in isolation:
 *   DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris \
 *     ANTHROPIC_API_KEY=test-key TELEGRAM_BOT_TOKEN=test-token \
 *     TELEGRAM_AUTHORIZED_USER_ID=99999 \
 *     npx vitest run src/episodic/__tests__/consolidate.test.ts
 */
```
Match this for any new test file. It makes failure triage trivial.

**Numbered test coverage list.** Multi-test suites enumerate their cases at the top:
```
 *  Test 1   — CONS-02 entry-count gate: zero entries → no Sonnet call
 *  Test 2   — CONS-03 idempotency (pre-flight SELECT wins)
 *  ...
 *  Test 12  — CONS-01 schema validation: out-of-range importance → failed
```

**Hooks:** `beforeAll` (DB probe, global state setup), `afterAll` (`sql.end()` to release the postgres.js pool), `beforeEach` (per-test reset, e.g. `TRUNCATE` or `vi.clearAllMocks()`), `afterEach` (scoped cleanup).

**Always call `sql.end()` in `afterAll`** for any file that touches the DB — otherwise the postgres.js connection pool holds the connection open and cascades issues into subsequent serial files.

## Mocking

**Framework:** Vitest `vi.*` built-ins. No separate mocking library.

**`vi.hoisted` + `vi.mock` for complex mock graphs.** The canonical pattern from `src/episodic/__tests__/consolidate.test.ts:54-80`:
```ts
const { mockAnthropicParse, mockSendMessage } = vi.hoisted(() => ({
  mockAnthropicParse: vi.fn(),
  mockSendMessage: vi.fn().mockResolvedValue(undefined as unknown as void),
}));

vi.mock('../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../llm/client.js')>();
  return {
    ...orig,
    anthropic: { messages: { parse: mockAnthropicParse, create: vi.fn() } },
  };
});
```
`vi.hoisted` lifts references to hoist-time so `vi.mock` factories (also hoisted) can close over them. Same pattern in `src/decisions/__tests__/synthetic-fixture.test.ts:34-60`.

**Selective mock — keep real modules where possible.** Mock only the boundaries that would (a) cost money (LLM calls), (b) require external network (Google APIs, Immich), or (c) send Telegram messages. Keep the DB **real** via Docker Postgres — it is the integration contract.

**What to mock:**
- `@anthropic-ai/sdk` / `../../llm/client.js` — LLM calls (by default; see live-LLM tests below for exceptions)
- `../../bot/bot.js` `bot.api.sendMessage` — Telegram outbound
- `grammy` — for bot-router tests (use `vi.fn()` on `ctx.reply`, etc.)
- `googleapis` — Gmail/Drive client surfaces
- Immich HTTP fetch surface
- `../../utils/logger.js` — silence noise in unit tests

**What NOT to mock:**
- Postgres — real database via Docker
- Drizzle query builder — exercise the real ORM
- Luxon / timezone math — use real dates
- `setTimeout` / `setInterval` via `vi.useFakeTimers` — **FORBIDDEN** per D-02. Fake timers break postgres.js connection keep-alive. Use `vi.setSystemTime` ONLY when time-travel is needed.

**Fire-and-forget test for non-critical writes.** Pattern from `src/pensieve/__tests__/integration.test.ts`: store succeeds even when a downstream mock throws — asserts that the exception does not propagate and the parent result is unaffected.

## Live-LLM Test Suite (Real API Key)

**Five files currently hit real Anthropic API when `ANTHROPIC_API_KEY` is a real key:**

| File | What it verifies |
|------|------------------|
| `src/llm/__tests__/models-smoke.test.ts` | All three model IDs (Haiku/Sonnet/Opus) respond with `type: 'text'` |
| `src/chris/__tests__/live-integration.test.ts` | TEST-01 refusal handling, behavioral contracts across EN/FR/RU, 3-of-3 reliability |
| `src/chris/__tests__/contradiction-false-positive.test.ts` | TEST-09 contradiction false-positive audit |
| `src/decisions/__tests__/live-accountability.test.ts` | TEST-13 ACCOUNTABILITY mode produces no flattery/condemnation (Haiku judge classifies Sonnet output on two axes, 3-of-3) |
| `src/decisions/__tests__/vague-validator-live.test.ts` | TEST-14 real Haiku vague-prediction validator across EN/FR/RU |
| `src/episodic/__tests__/live-anti-flattery.test.ts` | TEST-22 end-to-end consolidation on an adversarial fixture day; 17 forbidden markers scanned; 3-of-3 |
| `src/rituals/__tests__/live-weekly-review.test.ts` | TEST-31 weekly-review observation against real Sonnet on adversarial week; 40 forbidden markers (17 + 8 + 15) scanned + zero-fallback gate; 3-of-3. **Dual-gated** per D-30-03 — requires `RUN_LIVE_TESTS=1` AND `ANTHROPIC_API_KEY`. |

**Gate pattern — `describe.skipIf`:**
```ts
// Default pattern (TEST-01, TEST-09, TEST-13, TEST-14, TEST-22):
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('Live ...', () => { ... });

// Dual-gated pattern (TEST-31 only — D-30-03 cost discipline; ~$0.45/run):
describe.skipIf(!process.env.RUN_LIVE_TESTS || !process.env.ANTHROPIC_API_KEY)('Live ...', () => { ... });
```

Manual invocation for the dual-gated TEST-31:
```bash
RUN_LIVE_TESTS=1 ANTHROPIC_API_KEY=sk-ant-... \
  bash scripts/test.sh src/rituals/__tests__/live-weekly-review.test.ts
```
Or the older form in `models-smoke.test.ts`:
```ts
const describeSmoke = !process.env.ANTHROPIC_API_KEY ? describe.skip : describe;
```

**3-of-3 pattern.** Live tests run an internal `for (let i = 0; i < 3; i++)` loop inside a single `it()` block (NOT three separate `it()` blocks). This makes "all 3 must pass" an atomic assertion and keeps test count stable when the key is absent. Precedent: `src/decisions/__tests__/live-accountability.test.ts:173`. Timeout: 120_000 ms (3 Sonnet calls × ~6-7s each + DB I/O + cleanup).

**Intent of `temperature: 0` + 3-iteration loop is PINNED BEHAVIOR, not statistical sampling.** With temperature 0, Sonnet/Haiku are near-deterministic; the loop catches rare sampling variance / API-version drift rather than building a distribution. A true statistical test would use temperature 0.3-0.7 with N≥10; this suite does NOT do that.

**Inter-run cleanup inside the loop prevents false-pass short-circuits.** Example: TEST-22 deletes the `episodic_summaries` row before each iteration, otherwise CONS-03's pre-flight SELECT would short-circuit runs 2 and 3 (returning `{ skipped: 'existing' }` without invoking Sonnet).

## Excluded-Suites Mechanism

**Problem:** `scripts/test.sh` defaults `ANTHROPIC_API_KEY=test-key` (truthy). That means `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` does NOT skip — the live suites run with a fake key and 401-loop against the real Anthropic API. The 401-retry cascade triggers a Vitest 4 fork-mode IPC hang under the root-owned `node_modules/@huggingface/transformers` cache EACCES. Full `scripts/test.sh` never completes.

**Operational mitigation: exclude the 5 live-LLM files when running the Docker gate without a real key:**
```bash
bash scripts/test.sh -- \
  --exclude '**/live-integration.test.ts' \
  --exclude '**/live-accountability.test.ts' \
  --exclude '**/vague-validator-live.test.ts' \
  --exclude '**/contradiction-false-positive.test.ts' \
  --exclude '**/live-anti-flattery.test.ts'
```
This is the "excluded-suite" pattern referenced throughout `.planning/phases/22.*` and `.planning/phases/23-test-suite-backfill-summary/*`. Typical result: ~1000 passed / 15 environmental failed in ~28s.

**When adding a new live-LLM test:**
1. Add `describe.skipIf(!process.env.ANTHROPIC_API_KEY)` gate.
2. Add the file path to the excluded-suites list in any new phase plan or in the internal runbook that invokes `scripts/test.sh`.
3. Verify locally with a real API key that the test actually passes (`ANTHROPIC_API_KEY=sk-... npx vitest run <file>`).

**The documented 15 environmental failures** (as of v2.2): 3 × `llm/__tests__/models-smoke.test.ts` (401 with test-key) + 7 × `chris/__tests__/engine-mute.test.ts` + 5 × `chris/__tests__/photos-memory.test.ts`. These are pre-existing and tracked in `.planning/RETROSPECTIVE.md`.

## Fixture Patterns

**Per-file unique source tag for `pensieve_entries` cleanup.** Because `pensieve_entries` has no chat-id column, tests scope cleanup by the `source` column. Two forms:

1. **Per-process dynamic:**
   ```ts
   const TEST_SOURCE = `test-live-integration-${process.pid}`;
   ```
   Used by `src/chris/__tests__/live-integration.test.ts`. Guarantees no cross-file clobber even if parallelism is ever re-enabled.

2. **Per-file static:**
   ```ts
   const FIXTURE_SOURCE = 'synthetic-fixture';
   const FIXTURE_SOURCE = 'live-anti-flattery-fixture';
   ```
   Used by `src/decisions/__tests__/synthetic-fixture.test.ts` and `src/episodic/__tests__/live-anti-flattery.test.ts`.

**FK-safe cleanup order.** When deleting pensieve entries, delete dependent rows first:
```ts
await db.delete(contradictions).where(inArray(contradictions.entryAId, ids));
await db.delete(pensieveEmbeddings).where(inArray(pensieveEmbeddings.entryId, ids));
await db.delete(pensieveEntries).where(eq(pensieveEntries.source, TEST_SOURCE));
await db.delete(conversations).where(eq(conversations.chatId, TEST_CHAT_ID));
```

**Seed helpers co-located with the test file.** Multi-entry fixture days (TEST-22) define `ADVERSARIAL_ENTRIES: Array<{hourLocal, content}>` and a `seedAdversarialDay()` helper inline in the test file. Cleanup helpers (`cleanupFixture`, `cleanupAdversarialSummary`) are also inline. Do not extract to a shared module until the pattern is reused by 3+ files.

**Ground-truth fixtures** for audit/retrieval tests live in `src/pensieve/ground-truth.ts` (type: data).

## Fake Time

**`vi.setSystemTime` ONLY — `vi.useFakeTimers` is FORBIDDEN.** D-02 rule. `vi.useFakeTimers` replaces `setTimeout`/`setInterval` and breaks the postgres.js connection keep-alive timers, causing flakey DB disconnects mid-test.

Pattern from `src/decisions/__tests__/synthetic-fixture.test.ts`:
```ts
vi.setSystemTime(new Date('2026-04-01T10:00:00Z'));
// ... exercise code that calls new Date() ...
vi.setSystemTime(new Date('2026-04-15T10:00:00Z'));
// ... 14 days later ...
vi.useRealTimers();  // DO NOT call vi.useFakeTimers()
```

Live tests run in real wall-clock time — the `runConsolidate` engine derives the calendar key from its `date` argument, not from `Date.now()`, so no time-travel is needed.

## Coverage

**Tool:** `@vitest/coverage-v8` (dev dependency).

**Target:** None enforced in config. Coverage is a diagnostic tool, not a gate. Run manually when needed:
```bash
npx vitest run --coverage
```

## Test Types

**Integration dominates.** Most tests exercise real Postgres + real Drizzle + mocked LLM/Telegram. This is the default and the right choice.

**Pure unit tests** (no DB, no network, no mocks beyond `logger`): `src/utils/__tests__/*`, `src/gmail/__tests__/collapse.test.ts`, `src/immich/__tests__/metadata.test.ts`, `src/chris/__tests__/personality.test.ts`, `src/episodic/__tests__/prompts.test.ts`.

**Live-LLM tests** (gated, hit real Anthropic): the 5-file excluded-suite list above.

**No E2E / no browser / no Telegram client.** The `live-integration.test.ts` drives the engine's `processMessage` entry point directly — it does not round-trip through Grammy's webhook.

## Adversarial Test Scripts

**`scripts/adversarial-100.ts`, `scripts/adversarial-test.ts`, `scripts/test-photo-memory.ts`** are standalone exploratory scripts (not vitest-runnable). Invoked via `tsx scripts/<name>.ts` for manual behavioral testing against a running instance. Not part of the `npm test` gate.

## Primed-Fixture Pipeline

**v2.3 Test Data Infrastructure (Phase 24).** Organic+synthetic test fixtures replace real-calendar-time data-accumulation gates. A milestone that needs ≥ 7 days of episodic summaries, ≥ 200 pensieve entries, or resolved decisions with `resolve_by` spread no longer waits a week of real usage — it loads a primed fixture on demand.

**How it works.** The pipeline has two halves:

- **Organic base** pulled from live prod (Proxmox 192.168.1.50) via `scripts/fetch-prod-data.ts` — a read-only postgres.js dump over SSH tunnel, written as JSONL under `tests/fixtures/prod-snapshot/<ISO8601>/` with a `LATEST` symlink. `source='telegram'` filter on `pensieve_entries` (M008.1); `pensieve_embeddings` INNER-JOIN-scoped to those telegram rows.
- **Synthetic delta** generated by `scripts/synthesize-delta.ts` (per-day Haiku style-transfer, D-02) + `scripts/synthesize-episodic.ts` (sibling-module composition of the REAL `runConsolidate()` engine against a throwaway Docker Postgres on port 5435, D-04). Anthropic outputs are VCR-cached (SHA-256 content-addressable, D-03) so re-runs are byte-identical and free after the first miss.

The fused output lives at `tests/fixtures/primed/<milestone>-<N>days/` with a `MANIFEST.json` pointing back to its organic stamp, plus one JSONL per table.

### How to consume in tests

```typescript
import { beforeAll, describe, it } from 'vitest';
import { loadPrimedFixture } from '../../__tests__/fixtures/load-primed.js';

describe('my milestone tests', () => {
  beforeAll(async () => {
    await loadPrimedFixture('m008-14days');
  });

  it('…', async () => {
    // DB is now pre-populated with the fused organic+synthetic fixture.
  });
});
```

`loadPrimedFixture(name, opts?)` clears every target table in strict reverse-FK order, then bulk-inserts in forward-FK order via `jsonb_populate_recordset`. Repeated calls are idempotent and collision-safe (cleanup precedes insert).

### How to regenerate

```bash
# Full rebuild (fetch + synth-delta + synth-episodic):
npx tsx scripts/regenerate-primed.ts \
  --milestone m008 --target-days 14 --seed 42 --force

# Just the synth delta (if tests/fixtures/prod-snapshot/LATEST is fresh):
npx tsx scripts/synthesize-delta.ts \
  --organic tests/fixtures/prod-snapshot/LATEST \
  --target-days 14 --seed 42 --milestone m008
npx tsx scripts/synthesize-episodic.ts --primed m008-14days --seed 42
```

`regenerate-primed.ts` is the composer — it chains the three producer scripts via `child_process.spawn` with inherited stdio and forwards SIGINT/SIGTERM to the running child. `--force` skips the 24h freshness check and always fetches. `--no-refresh` passes through to `synthesize-delta.ts` only (per ROADMAP success criterion 4 — the composer's own fetch is gated by `--force`, not `--no-refresh`).

### 24h freshness policy

`tests/fixtures/prod-snapshot/LATEST` is auto-refreshed when > 24h old by `synthesize-delta.ts` and `regenerate-primed.ts` (unless `--no-refresh` / non-`--force`). Logic lives in `src/__tests__/fixtures/freshness.ts` (`isSnapshotStale`, `autoRefreshIfStale`).

`loadPrimedFixture` does NOT auto-refresh at test runtime (D-09) — tests should be hermetic. Instead, when the embedded organic snapshot (per MANIFEST `organic_stamp`) is > 24h old, it logs a warn-level diagnostic `load.primed.organic.stale` and proceeds. Passing `{ strictFreshness: true }` upgrades the warn to a hard error (`ChrisError('LOAD_PRIMED_STALE_STRICT')`) for future milestones that require fresh organic.

### VCR cache behavior

All Anthropic outputs (Haiku style-transfer + Sonnet consolidation) are cached under `tests/fixtures/.vcr/<sha256-of-request>.json`. The hash key is a SHA-256 digest over a canonical-stringified form of the full request — any change to prompt, model, or output schema auto-invalidates the entry without manual bookkeeping. Re-runs with unchanged prompts are free.

Clear with:

```bash
rm -rf tests/fixtures/.vcr            # nuke entire cache
# or
npx tsx scripts/regenerate-primed.ts --milestone m008 --force
```

The three runtime directories (`prod-snapshot/`, `primed/`, `.vcr/`) are all gitignored.

### `memories` vs `relational_memory` naming

**Schema reconciliation note.** `REQUIREMENTS.md FETCH-02` and Phase 24 CONTEXT §D-11 refer to a table called `memories`. The actual Drizzle schema (`src/db/schema.ts:134`) defines **`relational_memory`** — the M006 long-term-memory table added in Phase 8. There is NO `memories` table in any migration.

The primed-fixture pipeline uses the real table name throughout (`relational_memory`). The REQ-ID alias `memories` is a documentation leftover predating the M006 schema decision. When auditing fixture code, grep `\bmemories\b` should return zero hits in:

- `scripts/fetch-prod-data.ts`
- `scripts/synthesize-delta.ts`
- `scripts/synthesize-episodic.ts`
- `src/__tests__/fixtures/load-primed.ts`

### Source filter

`pensieve_entries.jsonl` is always scoped to `source='telegram'` — this matches the M008.1 consolidation contract. As of 2026-04-20, prod has 23,992 `immich` entries vs 122 `telegram` entries; without the filter, fixtures are ~200× bloat with zero test signal. Immich/Gmail/Drive fixtures are deferred per `REQUIREMENTS.md §Out of Scope`.

### Sanity gate

`src/__tests__/fixtures/primed-sanity.test.ts` (HARN-03) runs on every `bash scripts/test.sh` invocation and asserts four invariants:

1. ≥ 7 episodic summaries
2. ≥ 200 pensieve entries
3. `UNIQUE(summary_date)` holds — no duplicate days
4. No rows with `source IN ('immich', 'gmail', 'drive')` in `pensieve_entries`

When the fixture is absent (sandbox / CI without prod access), the test `describe.skip`'s with a clear regeneration hint. The sanity test is explicitly NOT in the `scripts/test.sh` excluded-suite list — it runs in the normal gate because it's fast, hermetic, and gracefully skips when the fixture is missing.

### Convention

This pipeline codifies a project convention (DOC-02): **no milestone may gate on real calendar time for data accumulation — use the primed-fixture pipeline instead.** See `.planning/codebase/CONVENTIONS.md §Test Data` for the full statement.

---

*Testing analysis: 2026-04-20*
