#!/usr/bin/env node
/**
 * scripts/fire-ritual.ts — Phase 26 Plan 05 (operator UAT)
 *
 * Manually fire a ritual by name. Used for staging UAT (ROADMAP §Phase 26
 * success criterion 1: "operator can `npx tsx scripts/fire-ritual.ts
 * daily_journal`").
 *
 * Sets the named ritual's next_run_at to now() - 1 minute (so the sweep
 * picks it up), runs runRitualSweep once, prints the result, exits 0 on
 * success or 1 on error.
 *
 * Mirrors scripts/manual-sweep.ts pattern with a name-filter argument.
 * ESM entry-point guard per Phase 25 LEARNINGS lesson 4 — comparing
 * import.meta.url against `file://${process.argv[1]}` ensures main() runs
 * only when this file is the process entry point. When imported (e.g. by
 * a future test), the guard is false and main() is not invoked.
 *
 * Usage:
 *   npx tsx scripts/fire-ritual.ts <ritual_name>
 *
 * Examples:
 *   npx tsx scripts/fire-ritual.ts daily_journal
 *   DATABASE_URL='postgresql://chris:localtest123@localhost:5433/chris' \
 *     npx tsx scripts/fire-ritual.ts daily_journal
 *
 * Behavior:
 *   - Hard-fails (exit 1) if ritual_name argument missing.
 *   - Hard-fails (exit 1) if no ritual exists with the given name.
 *   - Hard-fails (exit 1) on any DB connection / handler error.
 *   - On success, prints the RitualFireResult[] array as pretty JSON and
 *     exits 0.
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/connection.js';
import { rituals } from '../src/db/schema.js';
import { runRitualSweep } from '../src/rituals/scheduler.js';
import { logger } from '../src/utils/logger.js';

async function main(): Promise<void> {
  const ritualName = process.argv[2];
  if (!ritualName) {
    console.error('Usage: npx tsx scripts/fire-ritual.ts <ritual_name>');
    console.error('Example: npx tsx scripts/fire-ritual.ts daily_journal');
    process.exit(1);
  }

  // Set next_run_at to now() - 1 minute so the sweep picks up this ritual on
  // the next runRitualSweep() call below. The 1-minute backdate is comfortably
  // past `now` regardless of clock skew between the script and the DB.
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
  const updated = await db
    .update(rituals)
    .set({ nextRunAt: oneMinuteAgo })
    .where(eq(rituals.name, ritualName))
    .returning();

  if (updated.length === 0) {
    console.error(`No ritual found with name '${ritualName}'`);
    process.exit(1);
  }

  logger.info(
    { ritualName, newNextRunAt: oneMinuteAgo.toISOString() },
    'fire-ritual.set_next_run_at',
  );

  const results = await runRitualSweep();
  console.log(JSON.stringify(results, null, 2));
}

// ESM entry-point guard (Phase 25 LEARNINGS lesson 4). Without this guard,
// importing this module from a test would auto-execute main() and trigger DB
// writes + a real ritual sweep as side effects. The canonical pattern lives
// at scripts/backfill-episodic.ts:283 and scripts/manual-sweep.ts:45.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, 'fire-ritual.error');
    process.exit(1);
  });
}
