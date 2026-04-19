/**
 * src/episodic/__tests__/cron.test.ts — Phase 22 Plan 05 Task 3
 *
 * Unit tests for `runConsolidateYesterday(now?)` covering CRON-02 (DST safety)
 * and the cron-handler error-swallow contract from CRON-01.
 *
 * Coverage (8 tests):
 *   1. Computes yesterday correctly in Europe/Paris (summer UTC+2 / CEST)
 *   2. Computes yesterday at 23:00 Paris local — typical cron fire time
 *   3. CRON-02 spring-forward (2026-03-29 02:00 → 03:00 Paris): two firings
 *      across the boundary produce two distinct yesterday calendar dates,
 *      i.e. exactly one consolidation per calendar date
 *   4. CRON-02 fall-back (2026-10-25 03:00 → 02:00 Paris): two firings across
 *      the boundary produce two distinct yesterday calendar dates
 *   5. Error-swallow: runConsolidate rejects → runConsolidateYesterday returns
 *      normally and logs episodic.cron.error at warn (CRON-01 belt-and-
 *      suspenders contract; the cron handler outer catch in src/index.ts is
 *      the second layer)
 *   6. Info-log invariant: episodic.cron.invoked is logged BEFORE
 *      runConsolidate is called (operators see fire even if consolidation
 *      skipped)
 *
 * The DST-boundary tests do NOT actually spawn node-cron — they call
 * `runConsolidateYesterday` directly at successive mocked timestamps. A live
 * cron-scheduling assertion (i.e. that node-cron's timezone option fires once
 * per local hour:minute across DST) requires node-cron simulation and is out
 * of scope. The combination here (Intl.DateTimeFormat tz-aware date computation
 * + node-cron's documented { timezone } DST handling + Phase 21's CONS-03
 * UNIQUE+SELECT idempotency) is the canonical pattern.
 *
 * Mocks:
 *   - ../consolidate.js → vi.fn() runConsolidate spy
 *   - ../../config.js → freeze proactiveTimezone='Europe/Paris',
 *     episodicCron='0 23 * * *' regardless of env
 *   - logger.info / logger.warn → spies for the log-key assertions
 *
 * Run in isolation:
 *   DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris \
 *     ANTHROPIC_API_KEY=test-key TELEGRAM_BOT_TOKEN=test-token \
 *     TELEGRAM_AUTHORIZED_USER_ID=99999 \
 *     npx vitest run src/episodic/__tests__/cron.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ───────────────────────────────────────────────────────────
//
// vi.mock calls are hoisted by Vitest to the top of the module. The dynamic
// `await import(...)` after the mocks ensures the module under test resolves
// runConsolidate / config from the mocked modules, not the real ones. Same
// pattern used by src/chris/__tests__/date-extraction.test.ts.

vi.mock('../consolidate.js', () => ({
  runConsolidate: vi.fn(),
}));

vi.mock('../../config.js', async () => {
  const actual = await vi.importActual<typeof import('../../config.js')>(
    '../../config.js',
  );
  return {
    ...actual,
    config: {
      ...actual.config,
      proactiveTimezone: 'Europe/Paris',
      episodicCron: '0 23 * * *',
    },
  };
});

// Logger spies — the production logger writes via pino-pretty in non-prod;
// we replace info/warn/error with vi.fn() so we can assert log payloads
// without polluting test output.
const mockLoggerInfo = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

// ── Import module under test after mocks ───────────────────────────────────
const { runConsolidateYesterday } = await import('../cron.js');
const consolidateModule = await import('../consolidate.js');

// ────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: runConsolidate resolves to a "skipped — no entries" result.
  // Tests that need a different behaviour override this in their own setup.
  vi.mocked(consolidateModule.runConsolidate).mockResolvedValue({
    skipped: 'no-entries',
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1-2. Yesterday computation in Europe/Paris
// ════════════════════════════════════════════════════════════════════════════

describe('runConsolidateYesterday — yesterday computation', () => {
  it('computes yesterday in Europe/Paris (summer UTC+2)', async () => {
    // 2026-04-19T23:00:00Z is 2026-04-20 01:00 Paris (CEST/+2).
    // So "today in Paris" is 2026-04-20 and "yesterday" is 2026-04-19.
    await runConsolidateYesterday(new Date('2026-04-19T23:00:00Z'));

    expect(consolidateModule.runConsolidate).toHaveBeenCalledTimes(1);
    const yesterday = vi.mocked(consolidateModule.runConsolidate).mock
      .calls[0]![0];
    expect(yesterday.toISOString().slice(0, 10)).toBe('2026-04-19');
  });

  it('computes yesterday at 23:00 Paris local (typical cron fire time)', async () => {
    // 2026-04-18T21:00:00Z = 2026-04-18 23:00 Paris (CEST/+2). Cron fires here.
    // Today in Paris: 2026-04-18. Yesterday: 2026-04-17.
    await runConsolidateYesterday(new Date('2026-04-18T21:00:00Z'));

    const yesterday = vi.mocked(consolidateModule.runConsolidate).mock
      .calls[0]![0];
    expect(yesterday.toISOString().slice(0, 10)).toBe('2026-04-17');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3-4. DST safety (CRON-02): exactly one consolidation per calendar date
// ════════════════════════════════════════════════════════════════════════════

describe('runConsolidateYesterday — DST safety (CRON-02)', () => {
  it('spring-forward: two successive firings cover two distinct calendar dates', async () => {
    // Europe/Paris spring-forward 2026: Sunday 2026-03-29, 02:00 → 03:00
    // (UTC+1 → UTC+2). Cron fires at 23:00 Paris each night.
    //
    // Night of 2026-03-28 → 23:00 Paris = 22:00 UTC (still CET/+1 before the switch).
    //   Today in Paris: 2026-03-28. Yesterday: 2026-03-27.
    // Night of 2026-03-29 → 23:00 Paris = 21:00 UTC (CEST/+2 after the switch).
    //   Today in Paris: 2026-03-29. Yesterday: 2026-03-28.

    await runConsolidateYesterday(new Date('2026-03-28T22:00:00Z'));
    await runConsolidateYesterday(new Date('2026-03-29T21:00:00Z'));

    expect(consolidateModule.runConsolidate).toHaveBeenCalledTimes(2);
    const d0 = vi
      .mocked(consolidateModule.runConsolidate)
      .mock.calls[0]![0]
      .toISOString()
      .slice(0, 10);
    const d1 = vi
      .mocked(consolidateModule.runConsolidate)
      .mock.calls[1]![0]
      .toISOString()
      .slice(0, 10);
    expect(d0).toBe('2026-03-27');
    expect(d1).toBe('2026-03-28');
    expect(d0).not.toBe(d1); // EXACTLY ONCE per calendar date across spring-forward
  });

  it('fall-back: two successive firings cover two distinct calendar dates', async () => {
    // Europe/Paris fall-back 2026: Sunday 2026-10-25, 03:00 → 02:00
    // (UTC+2 → UTC+1).
    //
    // Night of 2026-10-24 → 23:00 Paris = 21:00 UTC (CEST/+2 before the switch).
    //   Today in Paris: 2026-10-24. Yesterday: 2026-10-23.
    // Night of 2026-10-25 → 23:00 Paris = 22:00 UTC (CET/+1 after the switch).
    //   Today in Paris: 2026-10-25. Yesterday: 2026-10-24.

    await runConsolidateYesterday(new Date('2026-10-24T21:00:00Z'));
    await runConsolidateYesterday(new Date('2026-10-25T22:00:00Z'));

    expect(consolidateModule.runConsolidate).toHaveBeenCalledTimes(2);
    const d0 = vi
      .mocked(consolidateModule.runConsolidate)
      .mock.calls[0]![0]
      .toISOString()
      .slice(0, 10);
    const d1 = vi
      .mocked(consolidateModule.runConsolidate)
      .mock.calls[1]![0]
      .toISOString()
      .slice(0, 10);
    expect(d0).toBe('2026-10-23');
    expect(d1).toBe('2026-10-24');
    expect(d0).not.toBe(d1); // EXACTLY ONCE per calendar date across fall-back
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5-6. Error handling + log invariants
// ════════════════════════════════════════════════════════════════════════════

describe('runConsolidateYesterday — error handling', () => {
  it('swallows errors from runConsolidate and logs warn', async () => {
    vi.mocked(consolidateModule.runConsolidate).mockRejectedValueOnce(
      new Error('boom'),
    );

    // Wrapper must NOT throw — CRON-01 contract: cron must never crash the
    // process. The outer catch in src/index.ts is the second layer; this
    // wrapper-internal catch is the first.
    await expect(
      runConsolidateYesterday(new Date('2026-04-19T21:00:00Z')),
    ).resolves.toBeUndefined();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'boom',
        yesterdayIso: expect.any(String),
      }),
      'episodic.cron.error',
    );
  });

  it('emits episodic.cron.invoked info log before calling runConsolidate', async () => {
    let invokedLoggedBeforeCall = false;
    vi.mocked(consolidateModule.runConsolidate).mockImplementationOnce(
      async () => {
        // At the moment runConsolidate runs, the info log must have already fired
        invokedLoggedBeforeCall = mockLoggerInfo.mock.calls.some(
          ([, key]) => key === 'episodic.cron.invoked',
        );
        return { skipped: 'no-entries' };
      },
    );

    await runConsolidateYesterday(new Date('2026-04-19T21:00:00Z'));

    expect(invokedLoggedBeforeCall).toBe(true);
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        yesterdayIso: expect.any(String),
        timezone: 'Europe/Paris',
      }),
      'episodic.cron.invoked',
    );
  });
});
