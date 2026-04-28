import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────
// Mock the wellbeing module so the throwing stub never fires during tests
// AND so we can assert delegate invocation.
vi.mock('../../rituals/wellbeing.js', () => ({
  handleWellbeingCallback: vi.fn().mockResolvedValue(undefined),
}));

// Mock the logger to silence warn output in test runs.
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Imports under test (after mocks) ──────────────────────────────────────
import { handleRitualCallback } from '../handlers/ritual-callback.js';
import { handleWellbeingCallback } from '../../rituals/wellbeing.js';

// ── Test helpers ───────────────────────────────────────────────────────────
function buildMockCtx(callbackData?: string) {
  return {
    callbackQuery: callbackData !== undefined ? { data: callbackData } : undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// ── Suite ──────────────────────────────────────────────────────────────────
describe('handleRitualCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('wellbeing prefix routing (r:w:*)', () => {
    it('routes r:w:e:3 to handleWellbeingCallback', async () => {
      const ctx = buildMockCtx('r:w:e:3');
      await handleRitualCallback(ctx);
      expect(handleWellbeingCallback).toHaveBeenCalledWith(ctx, 'r:w:e:3');
      // Dispatcher does NOT ack on wellbeing branch — handler owns its ack.
      expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    });

    it('routes r:w:skip to handleWellbeingCallback', async () => {
      const ctx = buildMockCtx('r:w:skip');
      await handleRitualCallback(ctx);
      expect(handleWellbeingCallback).toHaveBeenCalledWith(ctx, 'r:w:skip');
    });
  });

  describe('unknown ritual prefix (r:* but not r:w:*)', () => {
    it('silently acks r:adj:accept (Phase 28 not yet shipped)', async () => {
      const ctx = buildMockCtx('r:adj:accept');
      await handleRitualCallback(ctx);
      expect(handleWellbeingCallback).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    });

    it('silently acks r:wr:ack (Phase 29 not yet shipped)', async () => {
      const ctx = buildMockCtx('r:wr:ack');
      await handleRitualCallback(ctx);
      expect(handleWellbeingCallback).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    });

    it('silently acks r:xyz:foo (unknown ritual prefix)', async () => {
      const ctx = buildMockCtx('r:xyz:foo');
      await handleRitualCallback(ctx);
      expect(handleWellbeingCallback).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('unknown root prefix', () => {
    it('silently acks foo:bar', async () => {
      const ctx = buildMockCtx('foo:bar');
      await handleRitualCallback(ctx);
      expect(handleWellbeingCallback).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('missing/empty callback data', () => {
    it('silently acks when callbackQuery.data is undefined', async () => {
      const ctx = buildMockCtx(undefined);
      await handleRitualCallback(ctx);
      expect(handleWellbeingCallback).not.toHaveBeenCalled();
      expect(ctx.answerCallbackQuery).toHaveBeenCalledTimes(1);
    });
  });
});
