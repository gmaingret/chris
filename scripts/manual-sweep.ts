#!/usr/bin/env node
/**
 * scripts/manual-sweep.ts — Phase 25 Plan 03 Task 6 (D-07)
 *
 * Operator wrapper around runRitualSweep() so a human (Greg) can dry-run the
 * ritual sweep against the live DB without waiting for the 21:00 Paris cron
 * tick. Mirrors scripts/backfill-episodic.ts:246-285 — same main() shape,
 * same ESM entry-point guard, same exit-code semantics.
 *
 * Usage:
 *   npx tsx scripts/manual-sweep.ts
 *
 * To run against the test postgres on port 5433:
 *   DATABASE_URL='postgresql://chris:localtest123@localhost:5433/chris' \
 *     npx tsx scripts/manual-sweep.ts
 *
 * Behavior:
 *   - Calls runRitualSweep() once against the live DB (uses default DB
 *     connection from src/config.ts).
 *   - Prints the RitualFireResult[] array as pretty-printed JSON to stdout.
 *   - Exits 0 if no rituals fired (clean DB → []) — ROADMAP success
 *     criterion 3.
 *   - Exits 1 on uncaught error (DB connection failure, etc.).
 *   - Hard-fails on missing DB connection (no fallback per D-07).
 *   - No try/finally cleanup — process.exit IS the cleanup (matches the
 *     backfill-episodic.ts pattern noted in STATE.md as "safe as-is").
 */
import { runRitualSweep } from '../src/rituals/scheduler.js';
import { logger } from '../src/utils/logger.js';

async function main(): Promise<void> {
  try {
    const results = await runRitualSweep(new Date());
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'manual-sweep.error');
    console.error('manual-sweep failed:', err);
    process.exit(1);
  }
}

// ESM entry-point guard: only invoke main() when this file is the process
// entry point. Mirrors the same idiom in scripts/backfill-episodic.ts:283.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
