/**
 * src/rituals/__tests__/cron-registration.test.ts — Phase 25 Plan 03 Task 3
 *
 * Per CONTEXT.md D-05: spy-based unit test for the cron registration. Mirrors
 * src/episodic/__tests__/cron.test.ts (lines 43-100) — vi.hoisted spy +
 * vi.mock node-cron + dynamic import after mocks.
 *
 * Coverage (4 tests):
 *   1. Ritual cron registered at '0 21 * * *' / Europe/Paris (RIT-11 contract)
 *   2. Proactive cron registration regression (still '0 10 * * *' / Europe/Paris)
 *   3. status.sync === 'disabled' when runSync NOT provided
 *   4. Handler try/catch isolation: throwing runRitualSweep does NOT propagate
 *      from the registered handler invocation (CRON-01 belt-and-suspenders)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { scheduleSpy, validateSpy } = vi.hoisted(() => ({
  scheduleSpy: vi.fn(),
  validateSpy: vi.fn(() => true),
}));

vi.mock('node-cron', () => ({
  default: { schedule: scheduleSpy, validate: validateSpy },
  schedule: scheduleSpy,
  validate: validateSpy,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const baseConfig = {
  ritualSweepCron: '0 21 * * *',
  proactiveSweepCron: '0 10 * * *',
  episodicCron: '0 23 * * *',
  syncIntervalCron: '0 */6 * * *',
  proactiveTimezone: 'Europe/Paris',
};

describe('registerCrons', () => {
  beforeEach(() => {
    scheduleSpy.mockClear();
  });

  it('registers the ritual cron at 21:00 Europe/Paris (RIT-11)', async () => {
    const { registerCrons } = await import('../../cron-registration.js');

    const status = registerCrons({
      config: baseConfig,
      runSweep: vi.fn(),
      runRitualSweep: vi.fn(),
      runConsolidateYesterday: vi.fn(),
      ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
    });

    expect(scheduleSpy).toHaveBeenCalledWith(
      '0 21 * * *',
      expect.any(Function),
      { timezone: 'Europe/Paris' },
    );
    expect(status.ritual).toBe('registered');
  });

  it('registers the proactive cron at 10:00 Europe/Paris (regression)', async () => {
    const { registerCrons } = await import('../../cron-registration.js');

    registerCrons({
      config: baseConfig,
      runSweep: vi.fn(),
      runRitualSweep: vi.fn(),
      runConsolidateYesterday: vi.fn(),
    });

    expect(scheduleSpy).toHaveBeenCalledWith(
      '0 10 * * *',
      expect.any(Function),
      { timezone: 'Europe/Paris' },
    );
  });

  it('returns sync=disabled when runSync not provided', async () => {
    const { registerCrons } = await import('../../cron-registration.js');

    const status = registerCrons({
      config: baseConfig,
      runSweep: vi.fn(),
      runRitualSweep: vi.fn(),
      runConsolidateYesterday: vi.fn(),
      // runSync omitted
    });

    expect(status.sync).toBe('disabled');
  });

  it('handler try/catch isolates errors — calling the registered handler with throwing fn does not propagate', async () => {
    const { registerCrons } = await import('../../cron-registration.js');

    const throwingRunRitualSweep = vi.fn().mockRejectedValue(new Error('synthetic'));
    registerCrons({
      config: baseConfig,
      runSweep: vi.fn(),
      runRitualSweep: throwingRunRitualSweep,
      runConsolidateYesterday: vi.fn(),
    });

    // Find the ritual cron handler from the spy calls
    const ritualCall = scheduleSpy.mock.calls.find((c) => c[0] === '0 21 * * *');
    expect(ritualCall).toBeDefined();
    const ritualHandler = ritualCall![1] as () => Promise<void>;

    // Invoke it directly — should NOT throw (the try/catch swallows)
    await expect(ritualHandler()).resolves.toBeUndefined();
    expect(throwingRunRitualSweep).toHaveBeenCalled();
  });
});
