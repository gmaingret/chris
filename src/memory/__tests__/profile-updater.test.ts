/**
 * src/memory/__tests__/profile-updater.test.ts — Phase 34 Plan 03 (M010 GEN-02)
 *
 * Promise.allSettled isolation tests for `updateAllOperationalProfiles`.
 *
 * The contract under test (D-21 + D-23 + D-34):
 *   - One generator throwing does NOT abort the other 3 (D-21)
 *   - Orchestrator never re-throws; returns Promise<void> (D-23)
 *   - Aggregate cron-complete log fires once with correct per-dimension
 *     outcome counts (D-34)
 *   - Per-dimension generator failure (allSettled `rejected`) is logged as
 *     'chris.profile.profile_generation_failed' with the error message
 *   - Substrate loaded ONCE per fire (D-14)
 *   - No within-fire retry — each generator called EXACTLY ONCE (D-22)
 *
 * Test strategy: mock all 5 collaborator modules (4 generators + shared
 * substrate loader) so the test does not require a Postgres connection. The
 * orchestrator logic is pure dispatch/aggregation; the per-generator
 * behaviors are exercised by the Plan 34-02 test files
 * (generators.sparse.test.ts, generators.two-cycle.test.ts).
 *
 * Mirror of the handler-isolation pattern in
 * src/rituals/__tests__/cron-registration.test.ts:98-117.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks (vi.hoisted so they exist before the module-under-test imports) ────

const { mockLoadProfileSubstrate } = vi.hoisted(() => ({
  mockLoadProfileSubstrate: vi.fn(() =>
    Promise.resolve({
      pensieveEntries: [],
      episodicSummaries: [],
      decisions: [],
      entryCount: 12,
    }),
  ),
}));

const { mockGenerateJurisdictionalProfile } = vi.hoisted(() => ({
  mockGenerateJurisdictionalProfile: vi.fn(() =>
    Promise.reject(new Error('synthetic failure')),
  ),
}));

const { mockGenerateCapitalProfile } = vi.hoisted(() => ({
  mockGenerateCapitalProfile: vi.fn(() =>
    Promise.resolve({
      dimension: 'capital' as const,
      outcome: 'profile_updated' as const,
      entryCount: 15,
      confidence: 0.6,
      durationMs: 100,
    }),
  ),
}));

const { mockGenerateHealthProfile } = vi.hoisted(() => ({
  mockGenerateHealthProfile: vi.fn(() =>
    Promise.resolve({
      dimension: 'health' as const,
      outcome: 'profile_skipped_no_change' as const,
      durationMs: 50,
    }),
  ),
}));

const { mockGenerateFamilyProfile } = vi.hoisted(() => ({
  mockGenerateFamilyProfile: vi.fn(() =>
    Promise.resolve({
      dimension: 'family' as const,
      outcome: 'profile_below_threshold' as const,
      entryCount: 5,
      durationMs: 25,
    }),
  ),
}));

const { loggerInfo, loggerWarn, loggerError } = vi.hoisted(() => ({
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../profiles/shared.js', () => ({
  loadProfileSubstrate: mockLoadProfileSubstrate,
}));

vi.mock('../profiles/jurisdictional.js', () => ({
  generateJurisdictionalProfile: mockGenerateJurisdictionalProfile,
}));

vi.mock('../profiles/capital.js', () => ({
  generateCapitalProfile: mockGenerateCapitalProfile,
}));

vi.mock('../profiles/health.js', () => ({
  generateHealthProfile: mockGenerateHealthProfile,
}));

vi.mock('../profiles/family.js', () => ({
  generateFamilyProfile: mockGenerateFamilyProfile,
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: loggerInfo,
    warn: loggerWarn,
    error: loggerError,
    debug: vi.fn(),
  },
}));

// ── SUT import — AFTER mocks ────────────────────────────────────────────────

import { updateAllOperationalProfiles } from '../profile-updater.js';

// ── Tests ──────────────────────────────────────────────────────────────────

describe('updateAllOperationalProfiles (Phase 34 Plan 03 — GEN-02)', () => {
  beforeEach(() => {
    mockLoadProfileSubstrate.mockClear();
    mockGenerateJurisdictionalProfile.mockClear();
    mockGenerateCapitalProfile.mockClear();
    mockGenerateHealthProfile.mockClear();
    mockGenerateFamilyProfile.mockClear();
    loggerInfo.mockClear();
    loggerWarn.mockClear();
    loggerError.mockClear();
  });

  it('Promise.allSettled isolation — one rejected generator does NOT abort the other 3 (D-21)', async () => {
    // D-23 contract: never re-throws; resolves to undefined.
    await expect(updateAllOperationalProfiles()).resolves.toBeUndefined();

    // All 4 generators were invoked exactly once (D-22 no within-fire retry).
    expect(mockGenerateJurisdictionalProfile).toHaveBeenCalledTimes(1);
    expect(mockGenerateCapitalProfile).toHaveBeenCalledTimes(1);
    expect(mockGenerateHealthProfile).toHaveBeenCalledTimes(1);
    expect(mockGenerateFamilyProfile).toHaveBeenCalledTimes(1);

    // Each generator was called with { substrate } (D-14 substrate-once)
    expect(mockGenerateCapitalProfile).toHaveBeenCalledWith({
      substrate: expect.objectContaining({ entryCount: 12 }),
    });
    expect(mockGenerateHealthProfile).toHaveBeenCalledWith({
      substrate: expect.objectContaining({ entryCount: 12 }),
    });
    expect(mockGenerateFamilyProfile).toHaveBeenCalledWith({
      substrate: expect.objectContaining({ entryCount: 12 }),
    });
  });

  it('aggregate cron-complete log fires ONCE with correct per-dimension outcome counts (D-34)', async () => {
    await updateAllOperationalProfiles();

    // Find the 'chris.profile.cron.complete' call exactly once
    const completeCalls = loggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.profile.cron.complete',
    );
    expect(completeCalls).toHaveLength(1);

    // Verify the per-dimension outcome counts:
    //   - jurisdictional rejected (counts.failed = 1)
    //   - capital → profile_updated (counts.updated = 1)
    //   - health → profile_skipped_no_change (counts.skipped = 1)
    //   - family → profile_below_threshold (counts.belowThreshold = 1)
    const completeArgs = completeCalls[0]![0] as { counts: Record<string, number>; durationMs: number };
    expect(completeArgs.counts).toEqual({
      updated: 1,
      skipped: 1,
      belowThreshold: 1,
      failed: 1,
    });
    expect(typeof completeArgs.durationMs).toBe('number');
    expect(completeArgs.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits 'chris.profile.profile_generation_failed' warn log for the rejected generator (D-21 emergency path)", async () => {
    await updateAllOperationalProfiles();

    // The orchestrator's rejected-branch log uses logger.warn.
    const failedCalls = loggerWarn.mock.calls.filter(
      (c) => c[1] === 'chris.profile.profile_generation_failed',
    );
    expect(failedCalls).toHaveLength(1);

    // The error message from the rejected reason is surfaced verbatim.
    const failedArgs = failedCalls[0]![0] as { err: string };
    expect(failedArgs.err).toBe('synthetic failure');
  });

  it('substrate loaded exactly ONCE per fire (D-14) — not once per generator', async () => {
    await updateAllOperationalProfiles();

    expect(mockLoadProfileSubstrate).toHaveBeenCalledTimes(1);
    // And the cron-start log fired exactly once with substrate sizing.
    const startCalls = loggerInfo.mock.calls.filter(
      (c) => c[1] === 'chris.profile.cron.start',
    );
    expect(startCalls).toHaveLength(1);
    const startArgs = startCalls[0]![0] as {
      entryCount: number;
      episodicCount: number;
      decisionCount: number;
    };
    expect(startArgs.entryCount).toBe(12);
    expect(startArgs.episodicCount).toBe(0);
    expect(startArgs.decisionCount).toBe(0);
  });

  it("outer try/catch logs 'profile.cron.error' (lowercase infra-error) when loadProfileSubstrate itself throws", async () => {
    mockLoadProfileSubstrate.mockRejectedValueOnce(
      new Error('synthetic-db-outage'),
    );

    // Still resolves — never re-throws (D-23).
    await expect(updateAllOperationalProfiles()).resolves.toBeUndefined();

    // None of the 4 generators were invoked (loadProfileSubstrate threw FIRST).
    expect(mockGenerateJurisdictionalProfile).not.toHaveBeenCalled();
    expect(mockGenerateCapitalProfile).not.toHaveBeenCalled();
    expect(mockGenerateHealthProfile).not.toHaveBeenCalled();
    expect(mockGenerateFamilyProfile).not.toHaveBeenCalled();

    // Outer infra-error log fired.
    const errorCalls = loggerError.mock.calls.filter(
      (c) => c[1] === 'profile.cron.error',
    );
    expect(errorCalls).toHaveLength(1);
    const errorArgs = errorCalls[0]![0] as { err: string; durationMs: number };
    expect(errorArgs.err).toBe('synthetic-db-outage');
  });

  it('all 4 generators succeeding produces counts.updated=4 with zero failed', async () => {
    mockGenerateJurisdictionalProfile.mockResolvedValueOnce({
      dimension: 'jurisdictional' as const,
      outcome: 'profile_updated' as const,
      entryCount: 20,
      confidence: 0.7,
      durationMs: 150,
    });
    mockGenerateCapitalProfile.mockResolvedValueOnce({
      dimension: 'capital' as const,
      outcome: 'profile_updated' as const,
      entryCount: 20,
      confidence: 0.7,
      durationMs: 150,
    });
    mockGenerateHealthProfile.mockResolvedValueOnce({
      dimension: 'health' as const,
      outcome: 'profile_updated' as const,
      entryCount: 20,
      confidence: 0.7,
      durationMs: 150,
    });
    mockGenerateFamilyProfile.mockResolvedValueOnce({
      dimension: 'family' as const,
      outcome: 'profile_updated' as const,
      entryCount: 20,
      confidence: 0.7,
      durationMs: 150,
    });

    await updateAllOperationalProfiles();

    const completeCall = loggerInfo.mock.calls.find(
      (c) => c[1] === 'chris.profile.cron.complete',
    );
    expect(completeCall).toBeDefined();
    expect((completeCall![0] as { counts: Record<string, number> }).counts).toEqual({
      updated: 4,
      skipped: 0,
      belowThreshold: 0,
      failed: 0,
    });
    // No warn log when no rejected/failed outcomes.
    expect(loggerWarn).not.toHaveBeenCalled();
  });
});
