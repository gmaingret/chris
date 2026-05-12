/**
 * src/__tests__/config.test.ts — Phase 25 Plan 03 Task 4 (RIT-12 part a)
 *
 * Per CONTEXT.md D-03 (locked 2026-04-26): cron.validate fail-fast at module
 * load. RITUAL_SWEEP_CRON=garbage MUST cause `import('../config.js')` to
 * reject with `/invalid RITUAL_SWEEP_CRON/`. Container restart-loops until
 * env fixed.
 *
 * The cache-bust idiom (`'../config.js?reload=' + Date.now()`) forces vitest
 * to re-resolve the module each time so env-var changes are observed at
 * module-load time. Mirrors the dynamic-import pattern in
 * src/episodic/__tests__/cron.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

const ORIGINAL_RITUAL_SWEEP_CRON = process.env.RITUAL_SWEEP_CRON;

describe('config: cron.validate fail-fast (RIT-12)', () => {
  beforeEach(() => {
    delete process.env.RITUAL_SWEEP_CRON;
  });

  afterEach(() => {
    if (ORIGINAL_RITUAL_SWEEP_CRON !== undefined) {
      process.env.RITUAL_SWEEP_CRON = ORIGINAL_RITUAL_SWEEP_CRON;
    } else {
      delete process.env.RITUAL_SWEEP_CRON;
    }
  });

  it('rejects invalid RITUAL_SWEEP_CRON at config load with /invalid RITUAL_SWEEP_CRON/ message', async () => {
    process.env.RITUAL_SWEEP_CRON = 'garbage';
    // Cache-bust: force fresh import (config.ts reads env at module-load time)
    await expect(import('../config.js?reload=' + Date.now())).rejects.toThrow(
      /invalid RITUAL_SWEEP_CRON/,
    );
  });

  it('accepts valid RITUAL_SWEEP_CRON expression at config load', async () => {
    process.env.RITUAL_SWEEP_CRON = '0 21 * * *';
    await expect(import('../config.js?reload=' + Date.now())).resolves.toBeDefined();
  });

  it('default RITUAL_SWEEP_CRON is "* * * * *" when env unset', async () => {
    // Default changed from '0 21 * * *' to '* * * * *' in commit 4d95285
    // (M009 ships rituals at 3 distinct times; single-fire-time default
    // missed daily_wellbeing 09:00 and weekly_review Sun 20:00 by hours).
    delete process.env.RITUAL_SWEEP_CRON;
    const mod = await import('../config.js?reload=' + Date.now());
    expect(mod.config.ritualSweepCron).toBe('* * * * *');
  });
});

/**
 * M010 Phase 34 Plan 03 — profileUpdaterCron env-validation tests.
 *
 * Same validatedCron fail-fast pattern as RITUAL_SWEEP_CRON; the silent-cron
 * incident class (M008 EPI-04) is the same regardless of which cron is
 * misconfigured. Container restart-loops on invalid cron until env is fixed.
 */
describe('config: profileUpdaterCron fail-fast (Phase 34 GEN-01)', () => {
  const ORIGINAL_PROFILE_UPDATER_CRON = process.env.PROFILE_UPDATER_CRON;

  beforeEach(() => {
    delete process.env.PROFILE_UPDATER_CRON;
  });

  afterEach(() => {
    if (ORIGINAL_PROFILE_UPDATER_CRON !== undefined) {
      process.env.PROFILE_UPDATER_CRON = ORIGINAL_PROFILE_UPDATER_CRON;
    } else {
      delete process.env.PROFILE_UPDATER_CRON;
    }
  });

  it('default PROFILE_UPDATER_CRON is "0 22 * * 0" (Sunday 22:00) when env unset', async () => {
    // D-24 timing: 2h gap after weekly_review's Sun 20:00 fire.
    delete process.env.PROFILE_UPDATER_CRON;
    const mod = await import('../config.js?reload=' + Date.now());
    expect(mod.config.profileUpdaterCron).toBe('0 22 * * 0');
  });

  it('accepts valid PROFILE_UPDATER_CRON override at config load', async () => {
    // A 23:00 Sunday override should load cleanly — proves env override path works.
    process.env.PROFILE_UPDATER_CRON = '0 23 * * 0';
    const mod = await import('../config.js?reload=' + Date.now());
    expect(mod.config.profileUpdaterCron).toBe('0 23 * * 0');
  });

  it('rejects invalid PROFILE_UPDATER_CRON at config load with /invalid PROFILE_UPDATER_CRON/ message (D-25)', async () => {
    // Cache-bust: force fresh import (config.ts reads env at module-load time).
    // Silent-bad-cron prevention — node-cron's validate() catches the malformed
    // expression and `validatedCron` re-throws as a config-level error.
    process.env.PROFILE_UPDATER_CRON = 'invalid-expression';
    await expect(import('../config.js?reload=' + Date.now())).rejects.toThrow(
      /invalid PROFILE_UPDATER_CRON/,
    );
  });
});
