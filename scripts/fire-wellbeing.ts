#!/usr/bin/env node
/**
 * scripts/fire-wellbeing.ts — Phase 27 Plan 03 operator UAT script
 *
 * Operator wrapper around fireWellbeing() so Greg can dry-fire the wellbeing
 * keyboard against the live DB without waiting for the 09:00 morning fire.
 * Mirrors scripts/manual-sweep.ts (Phase 25 D-07) — same main() shape, same
 * ESM entry-point guard, same exit-code semantics.
 *
 * Usage:
 *   npx tsx scripts/fire-wellbeing.ts
 *
 * To run against the test postgres on port 5433:
 *   DATABASE_URL='postgresql://chris:localtest123@localhost:5433/chris' \
 *     npx tsx scripts/fire-wellbeing.ts
 *
 * Behavior:
 *   - Looks up the seeded daily_wellbeing ritual row.
 *   - Calls fireWellbeing(ritual, cfg) — sends inline keyboard via Telegram.
 *   - Operator then taps buttons in real Telegram to complete the snapshot.
 *   - Exits 0 on send success.
 *   - Exits 1 on missing seed (migration 0008 not applied) or send failure.
 *   - Hard-fails on missing DB connection (no fallback per D-07).
 *
 * Note: this script triggers the same code path runRitualSweep would —
 * fireWellbeing inserts a ritual_responses row + sends the keyboard. Tapping
 * buttons in real Telegram exercises the full handleWellbeingCallback chain.
 *
 * Signature note (deviation from plan reference): live fireWellbeing has
 * signature `(ritual, cfg) => Promise<RitualFireOutcome>` per Phase 26 D-26-08
 * dispatcher contract — see Plan 27-02 SUMMARY Deviation 1. cfg is derived
 * via parseRitualConfig(ritual.config) (mirrors scripts/fire-ritual.ts +
 * scheduler.ts dispatcher precedent).
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/connection.js';
import { rituals } from '../src/db/schema.js';
import { fireWellbeing } from '../src/rituals/wellbeing.js';
import { parseRitualConfig } from '../src/rituals/types.js';
import { logger } from '../src/utils/logger.js';

async function main(): Promise<void> {
  try {
    const [ritual] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.name, 'daily_wellbeing'))
      .limit(1);

    if (!ritual) {
      console.error(
        'No daily_wellbeing ritual seeded. Run migrations first (bash scripts/test.sh applies 0008).',
      );
      process.exit(1);
    }

    const cfg = parseRitualConfig(ritual.config);
    const outcome = await fireWellbeing(ritual, cfg);
    console.log(
      `Fired daily_wellbeing (ritualId=${ritual.id}, outcome=${outcome}) — check Telegram for the keyboard.`,
    );
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'fire-wellbeing.error');
    console.error('fire-wellbeing failed:', err);
    process.exit(1);
  }
}

// ESM entry-point guard: only invoke main() when this file is the process
// entry point. Mirrors scripts/manual-sweep.ts pattern.
if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
