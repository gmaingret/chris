#!/usr/bin/env node
/**
 * scripts/regenerate-primed.ts — Phase 24 Plan 04 (FRESH-03).
 *
 * Composer: runs `scripts/fetch-prod-data.ts` → `scripts/synthesize-delta.ts`
 * → `scripts/synthesize-episodic.ts` sequentially. `--force` skips the
 * freshness check and unconditionally runs fetch first. Without `--force`,
 * fetches only if `tests/fixtures/prod-snapshot/LATEST` is > 24h stale
 * (per Plan 24-01's FRESH-01 contract).
 *
 * Usage:
 *   npx tsx scripts/regenerate-primed.ts --milestone m009 \
 *     [--target-days 14] [--seed 42] [--force] [--no-refresh]
 *
 * Flags:
 *   --milestone     required; label passed through to synth-delta +
 *                   synth-episodic (output dir: tests/fixtures/primed/
 *                   <milestone>-<target-days>days/)
 *   --target-days   int, default 14 — total fused span
 *   --seed          int, default 42 — SYNTH-07 determinism anchor
 *   --force         default false — skip freshness check, always fetch
 *   --no-refresh    default false — pass through to synthesize-delta.ts
 *                   only (FRESH-02; the composer's own fetch step is
 *                   gated by --force, not --no-refresh, per ROADMAP
 *                   success criterion 4)
 *   --help          print usage and exit 0
 *
 * Exits 0 on success, 1 with a typed ChrisError code on the failing step:
 *   REGEN_PRIMED_USAGE — CLI validation failure
 *   REGEN_PRIMED_FETCH_PROD_DATA_FAILED — fetch-prod-data.ts exited non-zero
 *   REGEN_PRIMED_SYNTHESIZE_DELTA_FAILED — synthesize-delta.ts exited non-zero
 *   REGEN_PRIMED_SYNTHESIZE_EPISODIC_FAILED — synthesize-episodic.ts exited non-zero
 *   REGEN_PRIMED_SPAWN_FAILED — underlying spawn() error
 *
 * SIGINT/SIGTERM forwards to the currently-running child so Ctrl-C
 * during a long fetch/synth propagates cleanly.
 *
 * ESM main-guard at the bottom so this file is both an operator CLI
 * (via `npx tsx`) and a testable module (exports parseCliArgs + main).
 *
 * Logger + freshness imports are LAZY (inside main()) so `--help` works
 * without DATABASE_URL — same Rule-1 fix pattern Plans 24-01/02 applied.
 */
import { parseArgs } from 'node:util';
import { spawn, type ChildProcess } from 'node:child_process';
import { ChrisError } from '../src/utils/errors.js';

// ── CLI parsing ─────────────────────────────────────────────────────────

export interface Args {
  milestone: string;
  targetDays: number;
  seed: number;
  force: boolean;
  noRefresh: boolean;
  reseedVcr: boolean; // HARN-05
}

export function parseCliArgs(argv: string[]): Args {
  let values: {
    milestone?: string;
    'target-days'?: string;
    seed?: string;
    force?: boolean;
    'no-refresh'?: boolean;
    'reseed-vcr'?: boolean;
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        milestone: { type: 'string' },
        'target-days': { type: 'string', default: '14' },
        seed: { type: 'string', default: '42' },
        force: { type: 'boolean', default: false },
        'no-refresh': { type: 'boolean', default: false },
        'reseed-vcr': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ChrisError(
      `regenerate-primed: argument parse failed: ${msg}`,
      'REGEN_PRIMED_USAGE',
    );
  }

  if (values.help) {
    printUsage();
    process.exit(0);
  }
  if (!values.milestone) {
    throw new ChrisError(
      'regenerate-primed: --milestone is required',
      'REGEN_PRIMED_USAGE',
    );
  }
  const targetDays = Number(values['target-days']);
  const seed = Number(values.seed);
  if (!Number.isInteger(targetDays) || targetDays < 1) {
    throw new ChrisError(
      'regenerate-primed: --target-days must be a positive integer',
      'REGEN_PRIMED_USAGE',
    );
  }
  if (!Number.isInteger(seed)) {
    throw new ChrisError(
      'regenerate-primed: --seed must be an integer',
      'REGEN_PRIMED_USAGE',
    );
  }
  return {
    milestone: values.milestone,
    targetDays,
    seed,
    force: values.force ?? false,
    noRefresh: values['no-refresh'] ?? false,
    reseedVcr: values['reseed-vcr'] ?? false, // HARN-05
  };
}

function printUsage(): void {
  console.log(
    'Usage: npx tsx scripts/regenerate-primed.ts --milestone <name> [--target-days 14] [--seed 42] [--force] [--no-refresh] [--reseed-vcr]',
  );
  console.log(
    '  Composer: fetch-prod-data.ts → synthesize-delta.ts → synthesize-episodic.ts.',
  );
  console.log(
    '  --force skips the 24h freshness check and always fetches first.',
  );
  console.log(
    '  --no-refresh passes through to synthesize-delta.ts only (FRESH-02).',
  );
  console.log(
    '  --reseed-vcr clears tests/fixtures/.vcr before re-run (HARN-05).',
  );
}

// ── Child-process orchestration ─────────────────────────────────────────

let activeChild: ChildProcess | null = null;

function scriptErrorCode(script: string): string {
  const base = script.replace(/^scripts\//, '').replace(/\.ts$/, '');
  return `REGEN_PRIMED_${base.toUpperCase().replace(/-/g, '_')}_FAILED`;
}

function runScript(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', script, ...args], {
      stdio: 'inherit',
    });
    activeChild = child;
    child.on('exit', (code) => {
      activeChild = null;
      if (code === 0) {
        resolve();
      } else {
        reject(
          new ChrisError(
            `regenerate-primed: ${script} exited with code ${code}`,
            scriptErrorCode(script),
          ),
        );
      }
    });
    child.on('error', (err) => {
      activeChild = null;
      reject(
        new ChrisError(
          `regenerate-primed: failed to spawn ${script}`,
          'REGEN_PRIMED_SPAWN_FAILED',
          err,
        ),
      );
    });
  });
}

// ── Main ────────────────────────────────────────────────────────────────

export async function main(): Promise<void> {
  const sigHandler = (): void => {
    if (activeChild) activeChild.kill('SIGTERM');
    process.exit(130);
  };
  process.on('SIGINT', sigHandler);
  process.on('SIGTERM', sigHandler);

  try {
    const args = parseCliArgs(process.argv.slice(2));

    // Lazy-import to keep --help env-var-free (same pattern as Plans
    // 24-01/02 — src/utils/logger.ts transitively imports src/config.ts
    // which calls required('DATABASE_URL') at module init).
    const { logger } = await import('../src/utils/logger.js');
    const { isSnapshotStale } = await import(
      '../src/__tests__/fixtures/freshness.js'
    );

    // HARN-05: --reseed-vcr wipes the entire VCR cache BEFORE the fetch +
    // synth-delta + synth-episodic chain runs. Plain `rm` of the directory —
    // do NOT manipulate the SDK reference (vcr.ts:46-47 snapshots
    // ORIGINAL_PARSE / ORIGINAL_CREATE at module load; tampering with the
    // SDK property triggers the recursive-self-call infinite loop documented
    // at vcr.ts:38-45). RESEARCH Pitfall 11.
    if (args.reseedVcr) {
      logger.info({}, 'regenerate-primed.vcr.reseed');
      const { rm } = await import('node:fs/promises');
      await rm('tests/fixtures/.vcr', { recursive: true, force: true });
    }

    // Step 1: fetch (force OR stale)
    const latestPath = 'tests/fixtures/prod-snapshot/LATEST';
    const shouldFetch = args.force || (await isSnapshotStale(latestPath, 24));
    if (shouldFetch) {
      logger.info({ force: args.force }, 'regenerate-primed.fetch.start');
      await runScript('scripts/fetch-prod-data.ts', []);
    } else {
      logger.info({}, 'regenerate-primed.fetch.skip.fresh');
    }

    // Step 2: synthesize-delta
    const synthDeltaArgs = [
      '--organic',
      latestPath,
      '--target-days',
      String(args.targetDays),
      '--seed',
      String(args.seed),
      '--milestone',
      args.milestone,
    ];
    if (args.noRefresh) synthDeltaArgs.push('--no-refresh');
    logger.info(
      { args: synthDeltaArgs },
      'regenerate-primed.synth-delta.start',
    );
    await runScript('scripts/synthesize-delta.ts', synthDeltaArgs);

    // Step 3: synthesize-episodic
    const primedName = `${args.milestone}-${args.targetDays}days`;
    logger.info(
      { primed: primedName },
      'regenerate-primed.synth-episodic.start',
    );
    await runScript('scripts/synthesize-episodic.ts', [
      '--primed',
      primedName,
      '--seed',
      String(args.seed),
    ]);

    console.log(
      `regenerate-primed: rebuilt fixture tests/fixtures/primed/${primedName}/ (force=${args.force}, no-refresh=${args.noRefresh})`,
    );
    process.exit(0);
  } catch (err) {
    if (err instanceof ChrisError) {
      console.error(err.message);
    } else {
      console.error('regenerate-primed: unexpected error:', err);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
