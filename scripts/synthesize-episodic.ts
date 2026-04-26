#!/usr/bin/env node
/**
 * scripts/synthesize-episodic.ts — Phase 24 Plan 03 (SYNTH-03).
 *
 * Real-engine episodic synthesis. Given a primed fixture directory
 * produced by Plan 24-02 (synthesize-delta.ts), spin up a throwaway
 * Docker Postgres on port 5435 (distinct from the regen-snapshots.sh
 * port per RESEARCH §Pitfall 5), apply all 6
 * migrations, load the fixture's organic+synthetic rows, and invoke
 * the REAL runConsolidate(date) from src/episodic/consolidate.ts
 * against each synthetic day. Sonnet calls routed through the VCR
 * wrapper from Plan 24-02 so re-runs are free.
 *
 * Locked decisions:
 *   D-04 (RESEARCH-corrected): throwaway Postgres on port 5435
 *   CONTEXT §Pitfall 4: sibling-module composition (Pattern 2 Option 3)
 *     — NO production code modification, NO ESM-loader monkey-patch.
 *     Only a property assignment on the already-imported anthropic
 *     singleton, executed BEFORE dynamic-importing consolidate.ts.
 *
 * Usage:
 *   npx tsx scripts/synthesize-episodic.ts \
 *     --primed m008-14days --seed 42 [--db-port 5435]
 *
 * This script is a SIBLING of scripts/synthesize-delta.ts (Plan 24-02);
 * it is NOT an --episodic flag extension of that script. Rationale in
 * the plan 24-03-PLAN.md <objective> section.
 */
import { parseArgs } from 'node:util';
import {
  readFile,
  writeFile,
  mkdir,
  rm,
  stat,
  rename,
} from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { execSync } from 'node:child_process';
import { join, resolve as resolvePath } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DateTime } from 'luxon';
import type postgres from 'postgres';
import { ChrisError } from '../src/utils/errors.js';

const COMPOSE_FILE = 'docker-compose.local.yml';
const MIGRATIONS: readonly string[] = [
  'src/db/migrations/0000_curved_colonel_america.sql',
  'src/db/migrations/0001_add_photos_psychology_mode.sql',
  'src/db/migrations/0002_decision_archive.sql',
  'src/db/migrations/0003_add_decision_epistemic_tag.sql',
  'src/db/migrations/0004_decision_trigger_suppressions.sql',
  'src/db/migrations/0005_episodic_summaries.sql',
];
const DEFAULT_DB_PORT = 5435; // D-04-corrected: distinct from regen-snapshots.sh (Pitfall 5)

// ── CLI parsing ─────────────────────────────────────────────────────────

export interface Args {
  primed: string;
  seed: number;
  dbPort: number;
}

export function parseCliArgs(argv: string[]): Args {
  let values: {
    primed?: string;
    seed?: string;
    'db-port'?: string;
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        primed: { type: 'string' },
        seed: { type: 'string' },
        'db-port': { type: 'string' },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ChrisError(
      `synthesize-episodic: argument parse failed: ${msg}`,
      'SYNTH_EPISODIC_USAGE',
    );
  }

  if (values.help) {
    printUsage();
    process.exit(0);
  }
  if (!values.primed || !values.seed) {
    throw new ChrisError(
      'synthesize-episodic: --primed and --seed are required',
      'SYNTH_EPISODIC_USAGE',
    );
  }
  const seed = Number(values.seed);
  if (!Number.isInteger(seed)) {
    throw new ChrisError(
      'synthesize-episodic: --seed must be int',
      'SYNTH_EPISODIC_USAGE',
    );
  }
  const dbPort = values['db-port']
    ? Number(values['db-port'])
    : DEFAULT_DB_PORT;
  if (!Number.isInteger(dbPort) || dbPort < 1 || dbPort > 65535) {
    throw new ChrisError(
      'synthesize-episodic: --db-port must be int in [1, 65535]',
      'SYNTH_EPISODIC_USAGE',
    );
  }
  return { primed: values.primed, seed, dbPort };
}

function printUsage(): void {
  console.log(
    'Usage: npx tsx scripts/synthesize-episodic.ts --primed <name> --seed <int> [--db-port 5435]',
  );
  console.log(
    '  Real-engine episodic synthesis: runConsolidate(day) per synthetic day.',
  );
  console.log(
    '  Throwaway Docker Postgres on port 5435 (NOT the regen-snapshots.sh port).',
  );
}

// ── JSONL I/O ───────────────────────────────────────────────────────────

async function loadJsonl<T>(path: string): Promise<T[]> {
  const exists = await stat(path)
    .then(() => true)
    .catch(() => false);
  if (!exists) return [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const out: T[] = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed) out.push(JSON.parse(trimmed) as T);
  }
  return out;
}

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

async function writeJsonl<T>(
  path: string,
  rows: readonly T[],
): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  const out = createWriteStream(tmp, { encoding: 'utf8' });
  for (const row of rows) out.write(JSON.stringify(row, bigintReplacer) + '\n');
  await new Promise<void>((resolve, reject) => {
    out.on('error', reject);
    out.end(resolve);
  });
  // Atomic rename
  await rename(tmp, path);
}

// ── Docker lifecycle ────────────────────────────────────────────────────

interface DockerState {
  projectName: string;
  overridePath: string;
  dbPort: number;
}

async function upDocker(dbPort: number): Promise<DockerState> {
  const projectName = `chris-synth-${process.pid}`;
  const overridePath = `.tmp/docker-compose.synth-episodic.${process.pid}.override.yml`;
  await mkdir('.tmp', { recursive: true });
  // Compose-spec note: list-typed fields like `ports` merge ADDITIVELY
  // across overlaid compose files unless the override uses the `!override`
  // modifier (compose-spec 1.28+). Without it, the throwaway container
  // exposes BOTH the base file's "5433:5432" AND this override's port,
  // colliding with chris-postgres-1 on 5433. Found via prod operator UAT
  // 2026-04-25 — see RETROSPECTIVE §v2.3 post-close.
  await writeFile(
    overridePath,
    `services:\n  postgres:\n    ports: !override\n      - "${dbPort}:5432"\n`,
    'utf8',
  );
  try {
    execSync(
      `docker compose -p ${projectName} -f ${COMPOSE_FILE} -f ${overridePath} up -d postgres`,
      { stdio: 'inherit' },
    );
  } catch (err) {
    throw new ChrisError(
      `synthesize-episodic: docker compose up failed (port ${dbPort} may be in use; check with \`docker ps\`)`,
      'SYNTH_EPISODIC_DOCKER_UP_FAILED',
      err,
    );
  }
  // Wait up to 30s for postgres to become ready
  const deadline = Date.now() + 30_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      execSync(
        `docker compose -p ${projectName} -f ${COMPOSE_FILE} -f ${overridePath} exec -T postgres pg_isready -U chris -d chris -q`,
        { stdio: 'ignore' },
      );
      ready = true;
      break;
    } catch {
      await delay(1000);
    }
  }
  if (!ready) {
    throw new ChrisError(
      'synthesize-episodic: postgres not ready after 30s',
      'SYNTH_EPISODIC_DOCKER_UP_FAILED',
    );
  }
  // Apply pgvector extension
  execSync(
    `docker compose -p ${projectName} -f ${COMPOSE_FILE} -f ${overridePath} exec -T postgres psql -U chris -d chris -v ON_ERROR_STOP=1 -q -c "CREATE EXTENSION IF NOT EXISTS vector;"`,
    { stdio: 'inherit' },
  );
  return { projectName, overridePath, dbPort };
}

async function applyMigrations(state: DockerState): Promise<void> {
  for (const mig of MIGRATIONS) {
    try {
      execSync(
        `docker compose -p ${state.projectName} -f ${COMPOSE_FILE} -f ${state.overridePath} exec -T postgres psql -U chris -d chris -v ON_ERROR_STOP=1 -q < ${mig}`,
        { stdio: 'inherit', shell: '/bin/bash' },
      );
    } catch (err) {
      throw new ChrisError(
        `synthesize-episodic: migration failed — ${mig}`,
        'SYNTH_EPISODIC_MIGRATIONS_FAILED',
        err,
      );
    }
  }
}

async function downDocker(state: DockerState | null): Promise<void> {
  if (!state) return;
  try {
    execSync(
      `docker compose -p ${state.projectName} -f ${COMPOSE_FILE} -f ${state.overridePath} down --volumes --timeout 5`,
      { stdio: 'inherit' },
    );
  } catch {
    /* best-effort */
  }
  try {
    await rm(state.overridePath, { force: true });
  } catch {
    /* noop */
  }
}

// ── Fixture load ────────────────────────────────────────────────────────

export interface DbOverrideOpts {
  dbOverride?: postgres.Sql | null;
}

/**
 * Bulk-load a primed fixture's JSONL files into postgres in FK-safe
 * forward order. Uses `jsonb_populate_recordset` so JSONL keys that
 * are snake_case already map to the DB columns directly. ON CONFLICT
 * DO NOTHING keeps this idempotent so the test suite can call it
 * repeatedly without smashing existing rows (cleanup runs first in
 * the test's beforeEach).
 *
 * Skips `episodic_summaries.jsonl` — it is the empty placeholder Plan
 * 24-02 writes and the output path that `dumpEpisodicSummaries`
 * overwrites after `runSiblingConsolidation`.
 */
export async function loadFixtureIntoDb(
  opts: { fixtureDir: string } & DbOverrideOpts,
): Promise<void> {
  let client: postgres.Sql;
  if (opts.dbOverride) {
    client = opts.dbOverride;
  } else {
    const conn = await import('../src/db/connection.js');
    client = conn.sql;
  }

  // FK-safe forward order: parents → children
  const relMem = await loadJsonl<Record<string, unknown>>(
    join(opts.fixtureDir, 'relational_memory.jsonl'),
  );
  const proactive = await loadJsonl<Record<string, unknown>>(
    join(opts.fixtureDir, 'proactive_state.jsonl'),
  );
  const pens = await loadJsonl<Record<string, unknown>>(
    join(opts.fixtureDir, 'pensieve_entries.jsonl'),
  );
  const dec = await loadJsonl<Record<string, unknown>>(
    join(opts.fixtureDir, 'decisions.jsonl'),
  );
  const decCapState = await loadJsonl<Record<string, unknown>>(
    join(opts.fixtureDir, 'decision_capture_state.jsonl'),
  );
  const decEv = await loadJsonl<Record<string, unknown>>(
    join(opts.fixtureDir, 'decision_events.jsonl'),
  );
  const embs = await loadJsonl<Record<string, unknown>>(
    join(opts.fixtureDir, 'pensieve_embeddings.jsonl'),
  );
  const contras = await loadJsonl<Record<string, unknown>>(
    join(opts.fixtureDir, 'contradictions.jsonl'),
  );

  try {
    if (relMem.length) {
      await client`INSERT INTO relational_memory SELECT * FROM jsonb_populate_recordset(NULL::relational_memory, ${JSON.stringify(relMem)}::jsonb) ON CONFLICT DO NOTHING`;
    }
    if (proactive.length) {
      await client`INSERT INTO proactive_state SELECT * FROM jsonb_populate_recordset(NULL::proactive_state, ${JSON.stringify(proactive)}::jsonb) ON CONFLICT DO NOTHING`;
    }
    if (pens.length) {
      await client`INSERT INTO pensieve_entries SELECT * FROM jsonb_populate_recordset(NULL::pensieve_entries, ${JSON.stringify(pens)}::jsonb) ON CONFLICT DO NOTHING`;
    }
    if (dec.length) {
      await client`INSERT INTO decisions SELECT * FROM jsonb_populate_recordset(NULL::decisions, ${JSON.stringify(dec)}::jsonb) ON CONFLICT DO NOTHING`;
    }
    if (decCapState.length) {
      await client`INSERT INTO decision_capture_state SELECT * FROM jsonb_populate_recordset(NULL::decision_capture_state, ${JSON.stringify(decCapState)}::jsonb) ON CONFLICT DO NOTHING`;
    }
    if (decEv.length) {
      await client`INSERT INTO decision_events SELECT * FROM jsonb_populate_recordset(NULL::decision_events, ${JSON.stringify(decEv)}::jsonb) ON CONFLICT DO NOTHING`;
    }
    if (embs.length) {
      await client`INSERT INTO pensieve_embeddings SELECT * FROM jsonb_populate_recordset(NULL::pensieve_embeddings, ${JSON.stringify(embs)}::jsonb) ON CONFLICT DO NOTHING`;
    }
    if (contras.length) {
      await client`INSERT INTO contradictions SELECT * FROM jsonb_populate_recordset(NULL::contradictions, ${JSON.stringify(contras)}::jsonb) ON CONFLICT DO NOTHING`;
    }
  } catch (err) {
    throw new ChrisError(
      'synthesize-episodic: fixture bulk-load failed',
      'SYNTH_EPISODIC_LOAD_FAILED',
      err,
    );
  }

  const { logger } = await import('../src/utils/logger.js');
  logger.info(
    {
      fixtureDir: opts.fixtureDir,
      pens: pens.length,
      dec: dec.length,
      contras: contras.length,
    },
    'synth.episodic.load.done',
  );
}

// ── Sibling-composition runConsolidate loop ─────────────────────────────

/**
 * Run `runConsolidate(date)` for each synthetic day in the fixture's
 * MANIFEST.synthetic_date_range. `consolidateMod` is injected by the
 * operator-invocation main() path (after the singleton-swap sequence);
 * tests can omit it, in which case this function dynamic-imports
 * consolidate.ts directly — the test's `vi.mock('../../src/llm/client.js')`
 * hoisting is the contract that routes the Sonnet call through the mock.
 */
export async function runSiblingConsolidation(
  opts: {
    fixtureDir: string;
    consolidateMod?: typeof import('../src/episodic/consolidate.js');
  } & DbOverrideOpts,
): Promise<void> {
  const manifestPath = join(opts.fixtureDir, 'MANIFEST.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    synthetic_date_range: [string, string] | null;
  };
  const { logger } = await import('../src/utils/logger.js');
  if (!manifest.synthetic_date_range) {
    logger.info({ fixtureDir: opts.fixtureDir }, 'synth.episodic.no-days');
    return;
  }

  // Sibling-composition: if consolidateMod not pre-injected (normal operator
  // path), dynamic-import it now. Caller (main()) is responsible for having
  // set DATABASE_URL and the anthropic.messages.parse override BEFORE this
  // import. Tests skip the override (vi.mock hoisting handles the mock swap
  // at module-registry time).
  const mod =
    opts.consolidateMod ?? (await import('../src/episodic/consolidate.js'));

  const [startStr, endStr] = manifest.synthetic_date_range;
  const start = DateTime.fromISO(startStr, { zone: 'Europe/Paris' });
  const end = DateTime.fromISO(endStr, { zone: 'Europe/Paris' });
  let cursor = start;
  while (cursor <= end) {
    // Midday UTC yields correct Paris-local day (RESEARCH §Plan 24-03 note).
    const jsDate = new Date(`${cursor.toISODate()}T12:00:00Z`);
    try {
      const result = await mod.runConsolidate(jsDate);
      logger.info(
        { date: cursor.toISODate(), result },
        'synth.episodic.day.done',
      );
    } catch (err) {
      // Continue-on-error (mirrors scripts/backfill-episodic.ts policy)
      logger.error(
        { date: cursor.toISODate(), err },
        'synth.episodic.day.error',
      );
    }
    cursor = cursor.plus({ days: 1 });
    // Rate limit (match backfill-episodic.ts 2s delay — avoids hammering
    // Anthropic when VCR cache is cold). No delay in tests: we use
    // short-circuited vi.mock() for the anthropic client so there is no real
    // network, BUT the Vitest default test timeout (5s) can still exceed if
    // we leave the 2s real delay between 2 days. Keep a small heuristic:
    // if the consolidate call returned in <50ms it's a mock; skip the delay.
    // Simpler: env flag that tests set (VITEST=true) — vitest exports this.
    if (!process.env.VITEST) {
      await delay(2000);
    }
  }
}

// ── Episodic summaries dump ─────────────────────────────────────────────

export async function dumpEpisodicSummaries(
  opts: { fixtureDir: string } & DbOverrideOpts,
): Promise<void> {
  const client =
    opts.dbOverride ?? (await import('../src/db/connection.js')).sql;
  const rows = await client`
    SELECT id, summary_date, summary, importance, topics,
           emotional_arc, key_quotes, source_entry_ids, created_at
    FROM episodic_summaries
    ORDER BY summary_date ASC
  `;
  // Convert Date objects to ISO strings (postgres.js returns Date for
  // date/timestamp columns; JSONL consumers expect strings).
  const normalized = rows.map((r) => {
    const out: Record<string, unknown> = { ...r };
    if (r.summary_date instanceof Date) {
      out.summary_date = DateTime.fromJSDate(r.summary_date, {
        zone: 'UTC',
      }).toISODate();
    }
    if (r.created_at instanceof Date) {
      out.created_at = r.created_at.toISOString();
    }
    return out;
  });
  await writeJsonl(
    join(opts.fixtureDir, 'episodic_summaries.jsonl'),
    normalized,
  );
  const { logger } = await import('../src/utils/logger.js');
  logger.info(
    { fixtureDir: opts.fixtureDir, count: normalized.length },
    'synth.episodic.dump.done',
  );
}

// ── Main (operator invocation path) ─────────────────────────────────────

export async function main(): Promise<void> {
  let state: DockerState | null = null;
  const sigHandler = (): void => {
    void downDocker(state).then(() => process.exit(130));
  };
  process.on('SIGINT', sigHandler);
  process.on('SIGTERM', sigHandler);

  try {
    const args = parseCliArgs(process.argv.slice(2));
    const fixtureDir = resolvePath('tests/fixtures/primed', args.primed);
    const manifestExists = await stat(join(fixtureDir, 'MANIFEST.json'))
      .then(() => true)
      .catch(() => false);
    if (!manifestExists) {
      throw new ChrisError(
        `synthesize-episodic: MANIFEST.json not found at ${fixtureDir} (did Plan 24-02's synthesize-delta.ts run first?)`,
        'SYNTH_EPISODIC_NO_MANIFEST',
      );
    }

    state = await upDocker(args.dbPort);
    await applyMigrations(state);

    // ── Sibling-composition singleton-swap phase ─────────────────────
    // CRITICAL ORDER: env vars first, THEN anthropic singleton swap,
    // THEN dynamic import of consolidate.ts. Changing this order breaks
    // the no-production-code-mod contract.
    process.env.DATABASE_URL = `postgresql://chris:localtest123@localhost:${args.dbPort}/chris`;
    process.env.ANTHROPIC_API_KEY ??= 'test-key';
    process.env.TELEGRAM_BOT_TOKEN ??= 'test-token';
    process.env.TELEGRAM_AUTHORIZED_USER_ID ??= '99999';

    const llm = await import('../src/llm/client.js');
    const vcr = await import('../src/__tests__/fixtures/vcr.js');
    // eslint-disable-next-line prettier/prettier
    llm.anthropic.messages.parse = vcr.cachedMessagesParse as typeof llm.anthropic.messages.parse;
    // ── End sibling-composition phase ─────────────────────────────────

    const consolidateMod = await import('../src/episodic/consolidate.js');

    await loadFixtureIntoDb({ fixtureDir });
    await runSiblingConsolidation({ fixtureDir, consolidateMod });
    await dumpEpisodicSummaries({ fixtureDir });

    // Count output for operator line
    const out = await loadJsonl<{ summary_date: string }>(
      join(fixtureDir, 'episodic_summaries.jsonl'),
    );
    console.log(
      `synthesize-episodic: consolidated ${out.length} days; wrote ${out.length} episodic summaries to tests/fixtures/primed/${args.primed}/episodic_summaries.jsonl (seed=${args.seed}, db-port=${args.dbPort})`,
    );
    // NOTE: do NOT call process.exit() inside try/catch — it terminates
    // Node synchronously and skips the `finally` block, so downDocker()
    // never runs and the throwaway container is leaked. Set exitCode
    // instead and let the event loop drain naturally; finally fires first,
    // then Node exits with the set code. Found via prod operator UAT
    // 2026-04-26 — see RETROSPECTIVE §v2.3 post-close.
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof ChrisError) console.error(err.message);
    else console.error('synthesize-episodic: unexpected error:', err);
    process.exitCode = 1;
  } finally {
    await downDocker(state);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
