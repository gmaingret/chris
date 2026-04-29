/**
 * src/rituals/__tests__/fixtures/skip-tracking.ts — Phase 28 Plan 01 Task 6
 *
 * Seed helper for skip-tracking integration tests. Creates a ritual row (or
 * finds the existing seed) and inserts ritual_fire_events rows with deterministic
 * sequential firedAt timestamps.
 *
 * Reusable by Plans 28-02, 28-03, 28-04, and Phase 30 TEST-23..30.
 *
 * Self-contained: no test-runner-specific imports. Consumes only Drizzle +
 * the shared DB connection + types.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../../db/connection.js';
import { rituals, ritualFireEvents } from '../../../db/schema.js';
import type { RitualFireOutcome } from '../../types.js';

export interface SeedRitualWithFireEventsOpts {
  /** Ritual name — looked up by name in the rituals table. */
  ritualName: string;
  /** Cadence type of the ritual (used when inserting a fallback fixture row). */
  cadence: 'daily' | 'weekly';
  /** Ordered array of outcome strings to insert as ritualFireEvents rows. */
  outcomes: RitualFireOutcome[];
  /**
   * Baseline date for firedAt timestamps. Each outcome gets
   * `baseline + i * 60_000ms` (1 minute apart). Defaults to 1 hour ago
   * to ensure all events are in the past.
   */
  baseline?: Date;
}

export interface SeedRitualWithFireEventsResult {
  ritualId: string;
  eventIds: string[];
}

/**
 * seedRitualWithFireEvents — insert a deterministic sequence of
 * ritual_fire_events rows for a given ritual.
 *
 * Behavior:
 *   1. Look up the ritual by name. If not found, inserts a sane-default
 *      fixture row (skip_threshold matches the cadence default: daily=3,
 *      weekly=2 per D-28-04).
 *   2. For each outcome in outcomes[], inserts a ritualFireEvents row with
 *      firedAt = baseline + (i * 60_000ms) (deterministic, monotonic).
 *   3. Returns { ritualId, eventIds }.
 *
 * Does NOT modify rituals.skip_count — the skip_count column is a
 * denormalized projection; test code should set it explicitly via a direct
 * UPDATE after calling this helper if the test needs a specific value.
 */
export async function seedRitualWithFireEvents(
  opts: SeedRitualWithFireEventsOpts,
): Promise<SeedRitualWithFireEventsResult> {
  const { ritualName, cadence, outcomes } = opts;
  const baseline = opts.baseline ?? new Date(Date.now() - 3600_000); // 1h ago

  // 1. Find or create the ritual row.
  const [existing] = await db
    .select({ id: rituals.id })
    .from(rituals)
    .where(eq(rituals.name, ritualName))
    .limit(1);

  let ritualId: string;

  if (existing) {
    ritualId = existing.id;
  } else {
    // Fallback fixture — sane defaults matching seed migrations.
    const tomorrow = new Date(baseline.getTime() + 86_400_000);
    const skipThreshold = cadence === 'weekly' ? 2 : 3;
    const fireAt = cadence === 'weekly' ? '20:00' : '21:00';

    const [inserted] = await db
      .insert(rituals)
      .values({
        name: ritualName,
        type: cadence,
        nextRunAt: tomorrow,
        enabled: true,
        config: {
          fire_at: fireAt,
          skip_threshold: skipThreshold,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
        skipCount: 0,
      })
      .returning({ id: rituals.id });

    if (!inserted) {
      throw new Error(`seedRitualWithFireEvents: INSERT into rituals failed for '${ritualName}'`);
    }
    ritualId = inserted.id;
  }

  // 2. Insert ritual_fire_events rows with sequential firedAt timestamps.
  const eventIds: string[] = [];

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i]!;
    const firedAt = new Date(baseline.getTime() + i * 60_000);

    const [event] = await db
      .insert(ritualFireEvents)
      .values({
        ritualId,
        firedAt,
        outcome,
        metadata: { seeded: true, index: i },
      })
      .returning({ id: ritualFireEvents.id });

    if (!event) {
      throw new Error(`seedRitualWithFireEvents: INSERT into ritualFireEvents failed at index ${i}`);
    }
    eventIds.push(event.id);
  }

  return { ritualId, eventIds };
}
