/**
 * src/__tests__/fixtures/freshness.ts — Phase 24 Plan 01 (FRESH-01, D-06).
 *
 * 24-hour snapshot-freshness check + auto-refresh trigger.
 *
 * Consumers (three of them, per D-06 rationale):
 *   1. scripts/synthesize-delta.ts (Plan 24-02) — auto-refresh before synthesis
 *   2. scripts/regenerate-primed.ts (Plan 24-04) — auto-refresh on --force rebuild
 *   3. src/__tests__/fixtures/load-primed.ts (Plan 24-04) — diagnostic only
 *
 * Contract:
 *   - isSnapshotStale(path, ttlHours = 24): true if path mtime older than TTL.
 *     ENOENT → true (missing == force refresh).
 *   - autoRefreshIfStale(path, opts): spawns `npx tsx scripts/fetch-prod-data.ts`
 *     synchronously when stale, awaits its exit, then returns the input path.
 *     `opts.noRefresh` (FRESH-02) short-circuits regardless of staleness.
 */
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { logger } from '../../utils/logger.js';
import { ChrisError } from '../../utils/errors.js';

export async function isSnapshotStale(path: string, ttlHours = 24): Promise<boolean> {
  try {
    const s = await stat(path);
    const ageMs = Date.now() - s.mtimeMs;
    return ageMs > ttlHours * 60 * 60 * 1000;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw err;
  }
}

export interface AutoRefreshOptions {
  noRefresh?: boolean;
  ttlHours?: number;
}

export async function autoRefreshIfStale(
  latestPath: string,
  opts: AutoRefreshOptions = {},
): Promise<string> {
  const ttl = opts.ttlHours ?? 24;
  if (opts.noRefresh) return latestPath;
  const stale = await isSnapshotStale(latestPath, ttl);
  if (!stale) return latestPath;

  // Compute current age for log (best-effort — missing path == infinite age).
  let ageHours = Infinity;
  try {
    const s = await stat(latestPath);
    ageHours = (Date.now() - s.mtimeMs) / (60 * 60 * 1000);
  } catch {
    /* missing = infinite age */
  }

  logger.info({ ageHours, ttlHours: ttl }, 'freshness.auto-refresh');

  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'scripts/fetch-prod-data.ts'], {
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new ChrisError(
              `fetch-prod-data exited ${code}`,
              'FRESHNESS_REFRESH_FAILED',
            ),
          ),
    );
    child.on('error', (err) =>
      reject(
        new ChrisError(
          'fetch-prod-data spawn failed',
          'FRESHNESS_REFRESH_FAILED',
          err,
        ),
      ),
    );
  });

  return latestPath;
}
