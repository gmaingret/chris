#!/usr/bin/env node
/**
 * scripts/fetch-prod-data.ts — Phase 24 Plan 01 (FETCH-01..05).
 *
 * Operator script: dumps the 9 test-relevant tables from live prod
 * (Proxmox 192.168.1.50) over an SSH-tunneled postgres.js connection,
 * writes JSONL per table to tests/fixtures/prod-snapshot/<ISO8601>/,
 * updates the LATEST symlink, and exits 0.
 *
 * Usage:
 *   PROD_PG_PASSWORD=... npx tsx scripts/fetch-prod-data.ts [--help]
 *
 * Locked decisions (from CONTEXT.md):
 *   D-01: Node + postgres.js client over SSH -L tunnel (NOT pg_dump/psql)
 *   D-03: JSONL per table with stable ORDER BY
 *   D-08: hard-fail on unreachable prod (no fallback to stale LATEST)
 *   D-10: uses existing ~/.ssh/ operator key; no new credentials
 *
 * M008.1 filter: pensieve_entries is restricted to source='telegram'
 * (prod today has 23,992 immich rows vs 122 telegram rows — without
 * this filter the snapshot is ~200x bloat with no test signal).
 *
 * Schema reconciliation: REQ says "memories"; actual Drizzle table is
 * `relational_memory` (schema.ts:134). This script dumps
 * `relational_memory` — the REQ-ID "memories" is an alias.
 *
 * NOTE: The logger + postgres client are lazy-imported inside main()
 * (after --help) because `src/utils/logger.js` eagerly loads
 * `src/config.ts` which requires `DATABASE_URL`. Requiring an env var
 * for `--help` would break the plan's acceptance criterion and any
 * CI linter that smoke-invokes `--help` against scripts. Lazy-loading
 * keeps help responsive while preserving the logger for the real dump.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, symlink, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection } from 'node:net';
import { parseArgs } from 'node:util';

const SNAPSHOT_ROOT = 'tests/fixtures/prod-snapshot';
const SSH_TARGET = 'root@192.168.1.50';
const LOCAL_PORT = 15432;

// Prod DB connection string: postgres-in-docker maps inside the container
// network; the SSH -L 15432:localhost:5432 forward exposes it locally.
// Username/password match the operator's deploy config (see
// deploy/.env.prod on Proxmox). Must be set as env var at invocation time:
//   PROD_PG_PASSWORD=... npx tsx scripts/fetch-prod-data.ts

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  return value;
}

// ── SSH tunnel lifecycle (RESEARCH §Pattern 1) ─────────────────────────

async function probeConnect(port: number): Promise<boolean> {
  return new Promise((res) => {
    const sock = createConnection(port, '127.0.0.1');
    sock.once('connect', () => {
      sock.end();
      res(true);
    });
    sock.once('error', () => res(false));
  });
}

async function openTunnel(
  ChrisErrorCtor: typeof import('../src/utils/errors.js').ChrisError,
): Promise<ChildProcess> {
  const ssh = spawn(
    'ssh',
    [
      '-N',
      '-L',
      `${LOCAL_PORT}:localhost:5432`,
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ServerAliveInterval=30',
      SSH_TARGET,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (ssh.exitCode !== null) {
      throw new ChrisErrorCtor(
        `fetch-prod-data: unable to reach Proxmox at 192.168.1.50 (check VPN, SSH agent, or prod health). Use --no-refresh to force-use stale LATEST snapshot at ${await describeLatest()}.`,
        'FETCH_TUNNEL_ERROR',
      );
    }
    if (await probeConnect(LOCAL_PORT)) return ssh;
    await delay(200);
  }
  ssh.kill('SIGKILL');
  throw new ChrisErrorCtor(
    `fetch-prod-data: unable to reach Proxmox at 192.168.1.50 (check VPN, SSH agent, or prod health). Use --no-refresh to force-use stale LATEST snapshot at ${await describeLatest()}.`,
    'FETCH_TUNNEL_TIMEOUT',
  );
}

async function closeTunnel(ssh: ChildProcess | null): Promise<void> {
  if (!ssh || ssh.exitCode !== null) return;
  ssh.kill('SIGTERM');
  const raced = await Promise.race([
    new Promise<'exit'>((r) => ssh.on('exit', () => r('exit'))),
    delay(2000).then(() => 'timeout' as const),
  ]);
  if (raced === 'timeout') ssh.kill('SIGKILL');
}

async function describeLatest(): Promise<string> {
  const latest = join(SNAPSHOT_ROOT, 'LATEST');
  try {
    const s = await stat(latest);
    return `${latest} (last updated: ${new Date(s.mtimeMs).toISOString()})`;
  } catch {
    return `${latest} (none)`;
  }
}

// ── JSONL table dump (RESEARCH §Pattern 3) ─────────────────────────────

interface TableSpec {
  name: string;
  sql: string;
}

const TABLES: readonly TableSpec[] = [
  // M008.1 filter: source='telegram' only. Prod has 23,992 immich rows
  // vs 122 telegram rows; the filter is the load-bearing signal-to-noise
  // control (without it the snapshot is ~200x bloat).
  {
    name: 'pensieve_entries',
    sql: `SELECT * FROM pensieve_entries WHERE source = 'telegram' ORDER BY id`,
  },
  // Pitfall #2: embeddings must be scoped via INNER JOIN to telegram
  // entry_ids — otherwise the embedding table would reference rows that
  // are not in the snapshot, breaking FK integrity on load (Plan 24-04).
  {
    name: 'pensieve_embeddings',
    sql: `SELECT e.* FROM pensieve_embeddings e INNER JOIN pensieve_entries p ON e.entry_id = p.id WHERE p.source = 'telegram' ORDER BY e.id`,
  },
  {
    name: 'episodic_summaries',
    sql: `SELECT * FROM episodic_summaries ORDER BY summary_date`,
  },
  {
    name: 'decisions',
    sql: `SELECT * FROM decisions ORDER BY created_at, id`,
  },
  {
    name: 'decision_events',
    sql: `SELECT * FROM decision_events ORDER BY decision_id, created_at, sequence_no`,
  },
  {
    name: 'decision_capture_state',
    sql: `SELECT * FROM decision_capture_state ORDER BY chat_id`,
  },
  {
    name: 'contradictions',
    sql: `SELECT * FROM contradictions ORDER BY detected_at, id`,
  },
  {
    name: 'proactive_state',
    sql: `SELECT * FROM proactive_state ORDER BY key`,
  },
  // Schema reconciliation: REQ says "memories", actual table = relational_memory
  // (M006 long-term-memory table; schema.ts:134). This script dumps
  // relational_memory — the REQ-ID "memories" is an alias documented in
  // Plan 24-04's TESTING.md update.
  {
    name: 'relational_memory',
    sql: `SELECT * FROM relational_memory ORDER BY id`,
  },
];

/** Minimal structural type for the pieces of postgres.Sql we use. */
interface PgSqlLike {
  unsafe: (q: string) => {
    cursor: (rows: number) => AsyncIterable<Record<string, unknown>[]>;
  };
}

async function dumpTable(
  client: PgSqlLike,
  spec: TableSpec,
  outDir: string,
  log: { info: (obj: Record<string, unknown>, msg: string) => void },
): Promise<number> {
  const outPath = join(outDir, `${spec.name}.jsonl`);
  const out = createWriteStream(outPath, { encoding: 'utf8' });
  let count = 0;
  for await (const chunk of client.unsafe(spec.sql).cursor(1000)) {
    for (const row of chunk) {
      out.write(JSON.stringify(row, bigintReplacer) + '\n');
      count++;
    }
  }
  await new Promise<void>((r) => out.end(r));
  log.info({ table: spec.name, count }, 'fetch.table.done');
  return count;
}

// ── LATEST symlink atomic update ───────────────────────────────────────

async function updateLatestSymlink(stampDirName: string): Promise<void> {
  const latestPath = join(SNAPSHOT_ROOT, 'LATEST');
  const tmpPath = `${latestPath}.tmp-${process.pid}`;
  // Best-effort clear of leftover tmp symlink from a prior interrupted run.
  try {
    await unlink(tmpPath);
  } catch {
    /* tmp absent is fine */
  }
  // Relative symlink target so the snapshot dir is portable across hosts
  // that mount the repo at different absolute paths.
  await symlink(stampDirName, tmpPath);
  await rename(tmpPath, latestPath);
}

// ── Main ───────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { help: { type: 'boolean', default: false } },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    console.log('Usage: npx tsx scripts/fetch-prod-data.ts');
    console.log(
      '  Dumps 9 tables from prod (Proxmox 192.168.1.50) over SSH tunnel.',
    );
    console.log(
      '  Env: PROD_PG_USER, PROD_PG_PASSWORD, PROD_PG_DATABASE (optional overrides).',
    );
    process.exit(0);
  }

  // Lazy-load the logger, postgres client, and ChrisError AFTER --help:
  // `src/utils/logger.js` eagerly loads `src/config.ts` which requires
  // DATABASE_URL. Operators running `--help` should not need env vars.
  const [{ logger }, { ChrisError }, postgresMod] = await Promise.all([
    import('../src/utils/logger.js'),
    import('../src/utils/errors.js'),
    import('postgres'),
  ]);
  const postgres = postgresMod.default;

  const PROD_PG_USER = process.env.PROD_PG_USER ?? 'chris';
  const PROD_PG_DATABASE = process.env.PROD_PG_DATABASE ?? 'chris';

  // ISO8601 with colons replaced by hyphens for cross-platform ls
  // (e.g. 2026-04-20T14-30-00Z). Strips milliseconds.
  const stamp = new Date()
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/:/g, '-');
  const stampDir = join(SNAPSHOT_ROOT, stamp);
  await mkdir(stampDir, { recursive: true });

  let ssh: ChildProcess | null = null;
  let client: ReturnType<typeof postgres> | null = null;

  const sigHandler = (): void => {
    void closeTunnel(ssh).then(() => process.exit(130));
  };
  process.on('SIGINT', sigHandler);
  process.on('SIGTERM', sigHandler);

  try {
    ssh = await openTunnel(ChrisError);

    const password = process.env.PROD_PG_PASSWORD;
    if (!password) {
      throw new ChrisError(
        'fetch-prod-data: PROD_PG_PASSWORD env var required (operator must provide prod Postgres password).',
        'FETCH_MISSING_CREDS',
      );
    }

    client = postgres({
      host: '127.0.0.1',
      port: LOCAL_PORT,
      user: PROD_PG_USER,
      password,
      database: PROD_PG_DATABASE,
      ssl: false,
      // Belt-and-suspenders per RESEARCH §Anti-patterns "D004 append-only":
      // even though the queries are all SELECT, declare the transaction
      // read-only so a future refactor cannot accidentally write to prod.
      connection: { default_transaction_read_only: true },
    });

    let total = 0;
    for (const spec of TABLES) {
      total += await dumpTable(client as unknown as PgSqlLike, spec, stampDir, logger);
    }

    await updateLatestSymlink(stamp);
    // Operator UX line — plain console.log, not structured log (precedent:
    // backfill-episodic.ts:261).
    console.log(
      `fetch-prod-data: wrote ${total} rows across ${TABLES.length} tables to ${stampDir}/`,
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof ChrisError) {
      console.error(err.message);
    } else {
      console.error('fetch-prod-data: unexpected error:', err);
    }
    process.exit(1);
  } finally {
    if (client) await client.end({ timeout: 5 });
    await closeTunnel(ssh);
  }
}

// ESM guard — import.meta.url is a file:// URL; process.argv[1] is a plain
// path. When this file is imported (future freshness helper or test), the
// guard is false and main() does not run.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
