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

  it('default RITUAL_SWEEP_CRON is "0 21 * * *" when env unset', async () => {
    delete process.env.RITUAL_SWEEP_CRON;
    const mod = await import('../config.js?reload=' + Date.now());
    expect(mod.config.ritualSweepCron).toBe('0 21 * * *');
  });
});
