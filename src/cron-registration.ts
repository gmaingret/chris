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
  ritualConfirmation: 'registered' | 'failed';
  episodic: 'registered' | 'failed';
  sync: 'registered' | 'failed' | 'disabled';
  /** M010 Phase 34 GEN-01 — operational profile updater (Sunday 22:00 Paris). */
  profileUpdate: 'registered' | 'failed';
  /** M011 Phase 38 PGEN-05 — psychological profile updater (1st of month, 09:00 Paris). */
  psychologicalProfileUpdate: 'registered' | 'failed';
}

export interface RegisterCronsDeps {
  config: {
    proactiveSweepCron: string;
    ritualSweepCron: string;
    episodicCron: string;
    syncIntervalCron: string;
    proactiveTimezone: string;
    /** M010 Phase 34 GEN-01 — Sunday 22:00 Paris profile updater. */
    profileUpdaterCron: string;
    /** M011 Phase 38 PGEN-05 — 1st of month, 09:00 Paris. */
    psychologicalProfileUpdaterCron: string;
  };
  runSweep: () => Promise<unknown>;
  runRitualSweep: () => Promise<unknown>;
  runConsolidateYesterday: () => Promise<void>;
  /** Phase 28 D-28-06 — 1-minute confirmation sweep handler. */
  ritualConfirmationSweep: () => Promise<number | void>;
  /**
   * M010 Phase 34 GEN-02 — operational profile updater fan-out
   * (`updateAllOperationalProfiles` via Promise.allSettled across the 4
   * dimension generators). Fire-and-forget (Promise<void> per D-23).
   */
  runProfileUpdate: () => Promise<void>;
  /**
   * M011 Phase 38 PGEN-04 — `updateAllPsychologicalProfiles` fan-out
   * via Promise.allSettled across HEXACO + Schwartz generators.
   * Fire-and-forget (Promise<void> per D-25); outcomes observed via
   * discriminated 'chris.psychological.<profileType>.<outcome>' logs.
   * Attachment generator NOT included (deferred to v2.6.1 / ATT-POP-01
   * per D-23 + REQUIREMENTS PGEN-04).
   */
  runPsychologicalProfileUpdate: () => Promise<void>;
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
    ritualConfirmation: 'failed',
    episodic: 'failed',
    sync: deps.runSync ? 'failed' : 'disabled',
    profileUpdate: 'failed',
    psychologicalProfileUpdate: 'failed',
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

  // Phase 28 D-28-06 — 1-minute confirmation sweep (every minute).
  // NARROW helper (NOT runRitualSweep) per RESEARCH Landmine 5: ONLY scans for
  // expired adjustment_confirmation pending rows. Sub-millisecond when no work.
  // CRON-01 try/catch belt-and-suspenders.
  cron.schedule(
    '* * * * *',
    async () => {
      try {
        await deps.ritualConfirmationSweep();
      } catch (err) {
        logger.error({ err }, 'rituals.confirmation_sweep.error');
      }
    },
    { timezone: deps.config.proactiveTimezone },
  );
  status.ritualConfirmation = 'registered';
  logger.info(
    { cron: '* * * * *', timezone: deps.config.proactiveTimezone },
    'rituals.confirmation_sweep.scheduled',
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

  // M010 Phase 34 GEN-01 — Sunday 22:00 Paris operational profile updater.
  // 2h gap after weekly_review (Sunday 20:00) per D-24, mitigating M010-04
  // timing-collision class. CRON-01 try/catch belt-and-suspenders: the
  // orchestrator already has its own outer try/catch + 'profile.cron.error'
  // log, so this is a defense-in-depth wrapper — if some unexpected error
  // escapes the orchestrator's barrier (e.g. node-cron internal callback
  // bug), it still does NOT crash the cron timer.
  cron.schedule(
    deps.config.profileUpdaterCron,
    async () => {
      try {
        await deps.runProfileUpdate();
      } catch (err) {
        logger.error({ err }, 'profile.cron.error');
      }
    },
    { timezone: deps.config.proactiveTimezone },
  );
  status.profileUpdate = 'registered';
  logger.info(
    { cron: deps.config.profileUpdaterCron, timezone: deps.config.proactiveTimezone },
    'profile.cron.scheduled',
  );

  // M011 Phase 38 PGEN-05 — 1st-of-month 09:00 Paris psychological profile updater.
  // UNCONDITIONAL fire monthly per PGEN-06 (inverse of M010 GEN-07 hash-skip
  // idempotency). The orchestrator at src/memory/psychological-profile-updater.ts
  // has its own outer try/catch + 'psychological.profile.cron.error' log,
  // so this is a defense-in-depth wrapper (CRON-01 belt-and-suspenders pattern
  // from src/episodic/cron.ts JSDoc) — if some unexpected error escapes the
  // orchestrator's barrier (e.g. node-cron internal callback bug), it still
  // does NOT crash the cron timer.
  // Day-and-hour collision-avoidance with M010 Sunday 22:00 cron verified at
  // registration time via 12-month Luxon next-fire enumeration unit test
  // (D-27) — see src/rituals/__tests__/cron-registration.test.ts.
  cron.schedule(
    deps.config.psychologicalProfileUpdaterCron,
    async () => {
      try {
        await deps.runPsychologicalProfileUpdate();
      } catch (err) {
        logger.error({ err }, 'psychological.profile.cron.error');
      }
    },
    { timezone: deps.config.proactiveTimezone },
  );
  status.psychologicalProfileUpdate = 'registered';
  logger.info(
    { cron: deps.config.psychologicalProfileUpdaterCron, timezone: deps.config.proactiveTimezone },
    'psychological.profile.cron.scheduled',
  );

  return status;
}
