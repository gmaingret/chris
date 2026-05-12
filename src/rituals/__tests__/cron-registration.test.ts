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
import { readFile } from 'node:fs/promises';

const { scheduleSpy, validateSpy } = vi.hoisted(() => ({
  scheduleSpy: vi.fn(),
  validateSpy: vi.fn(() => true),
}));

const { mockLoggerError } = vi.hoisted(() => ({
  mockLoggerError: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: { schedule: scheduleSpy, validate: validateSpy },
  schedule: scheduleSpy,
  validate: validateSpy,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: mockLoggerError, warn: vi.fn(), debug: vi.fn() },
}));

const baseConfig = {
  // Per-minute cadence (revised 2026-05-05): catches all fire_at times within
  // ≤60s. Was '0 21 * * *' (Phase-25-era). See src/config.ts comment.
  ritualSweepCron: '* * * * *',
  proactiveSweepCron: '0 10 * * *',
  episodicCron: '0 23 * * *',
  syncIntervalCron: '0 */6 * * *',
  proactiveTimezone: 'Europe/Paris',
  // M010 Phase 34 GEN-01 — Sunday 22:00 Paris.
  profileUpdaterCron: '0 22 * * 0',
};

describe('registerCrons', () => {
  beforeEach(() => {
    scheduleSpy.mockClear();
    mockLoggerError.mockClear();
  });

  it('registers the ritual sweep cron at the configured cadence (RIT-11; revised per-minute 2026-05-05)', async () => {
    const { registerCrons } = await import('../../cron-registration.js');

    const status = registerCrons({
      config: baseConfig,
      runSweep: vi.fn(),
      runRitualSweep: vi.fn(),
      runConsolidateYesterday: vi.fn(),
      ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
      runProfileUpdate: vi.fn(),
    });

    expect(scheduleSpy).toHaveBeenCalledWith(
      baseConfig.ritualSweepCron,
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
      ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
      runProfileUpdate: vi.fn(),
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
      ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
      runProfileUpdate: vi.fn(),
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
      ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
      runProfileUpdate: vi.fn(),
    });

    // Find the ritual cron handler from the spy calls
    const ritualCall = scheduleSpy.mock.calls.find((c) => c[0] === baseConfig.ritualSweepCron);
    expect(ritualCall).toBeDefined();
    const ritualHandler = ritualCall![1] as () => Promise<void>;

    // Invoke it directly — should NOT throw (the try/catch swallows)
    await expect(ritualHandler()).resolves.toBeUndefined();
    expect(throwingRunRitualSweep).toHaveBeenCalled();
  });

  // ── M010 Phase 34 GEN-01 — 4th cron registration ─────────────────────────

  it('registers the profile updater cron at Sunday 22:00 Europe/Paris (GEN-01, D-24)', async () => {
    const { registerCrons } = await import('../../cron-registration.js');

    const status = registerCrons({
      config: baseConfig,
      runSweep: vi.fn(),
      runRitualSweep: vi.fn(),
      runConsolidateYesterday: vi.fn(),
      ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
      runProfileUpdate: vi.fn(),
    });

    // Verbatim cron expression + timezone match (CRITICAL ANCHOR — Sunday
    // 22:00 Paris, the 2h gap after weekly_review's 20:00 Paris fire).
    const profileCall = scheduleSpy.mock.calls.find((c) => c[0] === '0 22 * * 0');
    expect(profileCall, 'profile updater cron must register at Sunday 22:00').toBeDefined();
    expect(profileCall![2]).toEqual({ timezone: 'Europe/Paris' });

    expect(status.profileUpdate).toBe('registered');
  });

  it('runProfileUpdate dep is wired into the profile-cron handler (GEN-02)', async () => {
    const { registerCrons } = await import('../../cron-registration.js');

    const runProfileUpdate = vi.fn().mockResolvedValue(undefined);
    registerCrons({
      config: baseConfig,
      runSweep: vi.fn(),
      runRitualSweep: vi.fn(),
      runConsolidateYesterday: vi.fn(),
      ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
      runProfileUpdate,
    });

    const profileCall = scheduleSpy.mock.calls.find((c) => c[0] === '0 22 * * 0');
    expect(profileCall).toBeDefined();
    const profileHandler = profileCall![1] as () => Promise<void>;

    await profileHandler();
    expect(runProfileUpdate).toHaveBeenCalledTimes(1);
  });

  it("profile handler isolates errors — throwing runProfileUpdate does NOT propagate; logs 'profile.cron.error' (CRON-01)", async () => {
    const { registerCrons } = await import('../../cron-registration.js');

    const throwingRunProfileUpdate = vi
      .fn()
      .mockRejectedValue(new Error('synthetic profile-update failure'));
    registerCrons({
      config: baseConfig,
      runSweep: vi.fn(),
      runRitualSweep: vi.fn(),
      runConsolidateYesterday: vi.fn(),
      ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
      runProfileUpdate: throwingRunProfileUpdate,
    });

    const profileCall = scheduleSpy.mock.calls.find((c) => c[0] === '0 22 * * 0');
    expect(profileCall).toBeDefined();
    const profileHandler = profileCall![1] as () => Promise<void>;

    // CRON-01 belt-and-suspenders: handler try/catch swallows the throw.
    await expect(profileHandler()).resolves.toBeUndefined();
    expect(throwingRunProfileUpdate).toHaveBeenCalled();

    // Lowercase infra-error log key per the existing convention at
    // src/cron-registration.ts:73,92,110,131,149.
    const errorCalls = mockLoggerError.mock.calls.filter(
      (c) => c[1] === 'profile.cron.error',
    );
    expect(errorCalls).toHaveLength(1);
  });

  it('TEST-32: registerCrons invoked from src/index.ts main() with all M009 cron handlers (HARD CO-LOC #4)', async () => {
    // Static analysis: read src/index.ts via fs.readFile and assert
    // registerCrons() is invoked from main() with all 4 M009 cron handlers.
    // Regression test for the Pitfall 2 class: a future refactor that comments
    // out registerCrons() during debugging, forgets to wire ritualConfirmationSweep
    // (Phase 28 D-28-06), or moves the call to a non-main() path would silently
    // de-register crons in prod. The existing 4 spy-level tests exercise the
    // helper, not the call site — TEST-32 closes that gap.

    const indexSource = await readFile('src/index.ts', 'utf8');

    // (1) registerCrons MUST be invoked (assigned to cronStatus per index.ts main())
    expect(indexSource, 'src/index.ts must invoke registerCrons').toMatch(
      /cronStatus\s*=\s*registerCrons\(\{/,
    );

    // (2) All 4 M009 cron handlers must be passed (Pitfall 2 — must include
    //     ritualConfirmationSweep, not just runRitualSweep):
    expect(indexSource, 'runSweep handler passed').toMatch(/runSweep,/);
    expect(indexSource, 'runRitualSweep handler passed').toMatch(/runRitualSweep,/);
    expect(indexSource, 'runConsolidateYesterday handler passed').toMatch(
      /runConsolidateYesterday,/,
    );
    expect(
      indexSource,
      'ritualConfirmationSweep handler passed (Phase 28 D-28-06)',
    ).toMatch(/ritualConfirmationSweep/);

    // (3) ritualConfirmation cron expression hardcoded at '* * * * *' in
    //     cron-registration.ts:126 (1-minute confirmation sweep per Phase 28).
    //     If a future refactor parameterizes this, this test must be updated to
    //     assert the new contract; until then, the literal is the contract.
    const cronRegSource = await readFile('src/cron-registration.ts', 'utf8');
    expect(
      cronRegSource,
      'src/cron-registration.ts must register the 1-minute ritualConfirmation cron',
    ).toMatch(/'\* \* \* \* \*'/);
  });
});
