/**
 * src/cron-registration.ts — Phase 25 Plan 03 Task 3 (D-06 + RIT-11)
 *
 * Per CONTEXT.md D-06 (locked 2026-04-26): all cron registrations live behind
 * one testable function call. Extracted from inline src/index.ts main() so:
 *   (1) the cron-registration unit test (vi.mock node-cron + spy) does not
 *       need to import the entire bot/express/Drizzle init chain,
 *   (2) the registration-status map is the single source of truth that the
 *       /health endpoint reads (RIT-12 part b),
 *   (3) future cron additions (e.g. M013 monthly/quarterly rituals) extend
 *       this helper rather than appending another inline block to main().
 *
 * Each handler is wrapped in try/catch that logs <channel>.cron.error — this
 * is the CRON-01 belt-and-suspenders pattern from src/episodic/cron.ts:21-31.
 * Without it, a thrown handler crashes node-cron's timer.
 */
import cron from 'node-cron';
import { logger } from './utils/logger.js';

// ── Cron registration (M009 Phase 25 D-06 + RIT-11) ───────────────────────

export interface CronRegistrationStatus {
  proactive: 'registered' | 'failed';
  ritual: 'registered' | 'failed';
  episodic: 'registered' | 'failed';
  sync: 'registered' | 'failed' | 'disabled';
}

export interface RegisterCronsDeps {
  config: {
    proactiveSweepCron: string;
    ritualSweepCron: string;
    episodicCron: string;
    syncIntervalCron: string;
    proactiveTimezone: string;
  };
  runSweep: () => Promise<unknown>;
  runRitualSweep: () => Promise<unknown>;
  runConsolidateYesterday: () => Promise<void>;
  /** Optional — sync may be disabled in some envs (e.g. polling-only test runs). */
  runSync?: () => Promise<void>;
}

/**
 * registerCrons — D-06 testability extraction. All cron registrations live
 * behind one function call. Returns the status map for /health to consume
 * (RIT-12 part b).
 *
 * Each registration uses try/catch in the handler so a thrown handler does
 * NOT crash the node-cron timer (CRON-01 belt-and-suspenders pattern from
 * src/episodic/cron.ts:21-31 JSDoc).
 */
export function registerCrons(deps: RegisterCronsDeps): CronRegistrationStatus {
  const status: CronRegistrationStatus = {
    proactive: 'failed',
    ritual: 'failed',
    episodic: 'failed',
    sync: deps.runSync ? 'failed' : 'disabled',
  };

  // Optional sync cron (only if runSync provided)
  if (deps.runSync) {
    cron.schedule(
      deps.config.syncIntervalCron,
      async () => {
        try {
          await deps.runSync!();
        } catch (err) {
          logger.error({ err }, 'sync.cron.error');
        }
      },
      { timezone: deps.config.proactiveTimezone },
    );
    status.sync = 'registered';
    logger.info(
      { cron: deps.config.syncIntervalCron, timezone: deps.config.proactiveTimezone },
      'sync.cron.scheduled',
    );
  }

  // Existing 10:00 Paris proactive sweep (mirrors src/index.ts:73-80)
  cron.schedule(
    deps.config.proactiveSweepCron,
    async () => {
      try {
        await deps.runSweep();
      } catch (err) {
        logger.error({ err }, 'proactive.cron.error');
      }
    },
    { timezone: deps.config.proactiveTimezone },
  );
  status.proactive = 'registered';
  logger.info(
    { cron: deps.config.proactiveSweepCron, timezone: deps.config.proactiveTimezone },
    'proactive.cron.scheduled',
  );

  // NEW 21:00 Paris ritual sweep (RIT-11)
  cron.schedule(
    deps.config.ritualSweepCron,
    async () => {
      try {
        await deps.runRitualSweep();
      } catch (err) {
        logger.error({ err }, 'rituals.cron.error');
      }
    },
    { timezone: deps.config.proactiveTimezone },
  );
  status.ritual = 'registered';
  logger.info(
    { cron: deps.config.ritualSweepCron, timezone: deps.config.proactiveTimezone },
    'rituals.cron.scheduled',
  );

  // Existing 23:00 Paris episodic (mirrors src/index.ts:89-96)
  cron.schedule(
    deps.config.episodicCron,
    async () => {
      try {
        await deps.runConsolidateYesterday();
      } catch (err) {
        logger.error({ err }, 'episodic.cron.error');
      }
    },
    { timezone: deps.config.proactiveTimezone },
  );
  status.episodic = 'registered';
  logger.info(
    { cron: deps.config.episodicCron, timezone: deps.config.proactiveTimezone },
    'episodic.cron.scheduled',
  );

  return status;
}
