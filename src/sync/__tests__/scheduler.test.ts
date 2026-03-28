import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock references (K001 pattern) ─────────────────────────────────

const mockSchedule = vi.fn();
const mockTaskStop = vi.fn();
const mockSyncGmail = vi.fn();
const mockSyncDrive = vi.fn();
const mockSyncImmich = vi.fn();
const mockGetAuthenticatedClient = vi.fn();
const mockSendMessage = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args: unknown[]) => {
      mockSchedule(...args);
      return { stop: mockTaskStop };
    },
  },
}));

vi.mock('../../gmail/sync.js', () => ({
  syncGmail: (...args: unknown[]) => mockSyncGmail(...args),
}));

vi.mock('../../drive/sync.js', () => ({
  syncDrive: (...args: unknown[]) => mockSyncDrive(...args),
}));

vi.mock('../../immich/sync.js', () => ({
  syncImmich: (...args: unknown[]) => mockSyncImmich(...args),
}));

vi.mock('../../gmail/oauth.js', () => ({
  getAuthenticatedClient: (...args: unknown[]) => mockGetAuthenticatedClient(...args),
}));

vi.mock('../../bot/bot.js', () => ({
  bot: {
    api: {
      sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    },
  },
}));

vi.mock('../../config.js', () => ({
  config: {
    syncIntervalCron: '0 */6 * * *',
    syncEnabled: true,
    telegramAuthorizedUserId: 12345,
    immichApiUrl: 'http://immich:2283',
    immichApiKey: 'test-key',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    error: (...args: unknown[]) => mockLoggerError(...args),
    warn: vi.fn(),
  },
}));

vi.mock('../../utils/errors.js', () => {
  class OAuthError extends Error {
    code = 'OAUTH_ERROR';
    constructor(message: string) {
      super(message);
      this.name = 'OAuthError';
    }
  }
  return { OAuthError };
});

vi.mock('../../db/connection.js', () => ({ db: {} }));
vi.mock('../../db/schema.js', () => ({ syncStatus: {} }));

// ── Import after mocks ─────────────────────────────────────────────────────

import { startScheduler, stopScheduler, runAllSyncs } from '../scheduler.js';
import { config } from '../../config.js';
import { OAuthError } from '../../utils/errors.js';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('sync scheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all syncs succeed
    mockGetAuthenticatedClient.mockResolvedValue({ fake: 'authClient' });
    mockSyncGmail.mockResolvedValue(undefined);
    mockSyncDrive.mockResolvedValue(undefined);
    mockSyncImmich.mockResolvedValue(undefined);
    mockSendMessage.mockResolvedValue(undefined);
  });

  describe('startScheduler', () => {
    it('schedules a cron job with the configured expression', () => {
      startScheduler();
      expect(mockSchedule).toHaveBeenCalledWith(
        config.syncIntervalCron,
        expect.any(Function),
      );
    });
  });

  describe('stopScheduler', () => {
    it('calls task.stop() on the scheduled task', () => {
      startScheduler();
      stopScheduler();
      expect(mockTaskStop).toHaveBeenCalled();
    });

    it('does nothing if no task is scheduled', () => {
      // Should not throw
      stopScheduler();
    });
  });

  describe('runAllSyncs', () => {
    it('calls all three sync functions when auth/config is available', async () => {
      await runAllSyncs();
      expect(mockGetAuthenticatedClient).toHaveBeenCalled();
      expect(mockSyncGmail).toHaveBeenCalledWith(
        { fake: 'authClient' },
        expect.any(Function),
      );
      expect(mockSyncDrive).toHaveBeenCalledWith(
        { fake: 'authClient' },
        expect.any(Function),
      );
      expect(mockSyncImmich).toHaveBeenCalledWith(expect.any(Function));
    });

    it('logs sync.cron.start and sync.cron.complete for each source', async () => {
      await runAllSyncs();
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { source: 'gmail' },
        'sync.cron.start',
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { source: 'gmail' },
        'sync.cron.complete',
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { source: 'drive' },
        'sync.cron.start',
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { source: 'drive' },
        'sync.cron.complete',
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { source: 'immich' },
        'sync.cron.start',
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { source: 'immich' },
        'sync.cron.complete',
      );
    });

    // ── Error isolation ──────────────────────────────────────────────────

    it('Gmail sync failure → notifies Greg, Drive and Immich still run', async () => {
      mockSyncGmail.mockRejectedValue(new Error('Gmail boom'));
      await runAllSyncs();

      // Notification sent
      expect(mockSendMessage).toHaveBeenCalledWith(
        12345,
        '⚠️ Cron sync failed: gmail\nGmail boom',
      );
      // Drive and Immich still ran
      expect(mockSyncDrive).toHaveBeenCalled();
      expect(mockSyncImmich).toHaveBeenCalled();
    });

    it('Drive sync failure → notifies Greg, does not affect other sources', async () => {
      mockSyncDrive.mockRejectedValue(new Error('Drive boom'));
      await runAllSyncs();

      expect(mockSendMessage).toHaveBeenCalledWith(
        12345,
        '⚠️ Cron sync failed: drive\nDrive boom',
      );
      // Gmail and Immich still ran
      expect(mockSyncGmail).toHaveBeenCalled();
      expect(mockSyncImmich).toHaveBeenCalled();
    });

    it('Immich sync failure → notifies Greg', async () => {
      mockSyncImmich.mockRejectedValue(new Error('Immich boom'));
      await runAllSyncs();

      expect(mockSendMessage).toHaveBeenCalledWith(
        12345,
        '⚠️ Cron sync failed: immich\nImmich boom',
      );
    });

    // ── Skip logic ──────────────────────────────────────────────────────

    it('missing OAuth tokens → skips Gmail/Drive with log, no notification', async () => {
      mockGetAuthenticatedClient.mockRejectedValue(
        new OAuthError('No Google OAuth tokens found'),
      );
      await runAllSyncs();

      // Should log skip, not error
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { source: 'gmail', reason: 'No Google OAuth tokens found' },
        'sync.cron.skip',
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        { source: 'drive', reason: 'No Google OAuth tokens found' },
        'sync.cron.skip',
      );
      // Should NOT notify Greg for auth skip
      expect(mockSendMessage).not.toHaveBeenCalled();
      // Immich should still run
      expect(mockSyncImmich).toHaveBeenCalled();
    });

    it('missing Immich config → skips Immich with log', async () => {
      // Override config to remove Immich keys
      const cfg = config as { immichApiUrl: string; immichApiKey: string };
      const origUrl = cfg.immichApiUrl;
      const origKey = cfg.immichApiKey;
      cfg.immichApiUrl = '';
      cfg.immichApiKey = '';

      try {
        await runAllSyncs();

        expect(mockLoggerInfo).toHaveBeenCalledWith(
          { source: 'immich', reason: 'Missing immichApiUrl or immichApiKey' },
          'sync.cron.skip',
        );
        expect(mockSyncImmich).not.toHaveBeenCalled();
        // No notification for config skip
        expect(mockSendMessage).not.toHaveBeenCalled();
      } finally {
        cfg.immichApiUrl = origUrl;
        cfg.immichApiKey = origKey;
      }
    });

    // ── Notification failure ────────────────────────────────────────────

    it('notification failure does not crash scheduler', async () => {
      mockSyncGmail.mockRejectedValue(new Error('Gmail boom'));
      mockSendMessage.mockRejectedValue(new Error('Telegram down'));

      // Should not throw
      await runAllSyncs();

      // Error logged for notification failure
      expect(mockLoggerError).toHaveBeenCalledWith(
        expect.objectContaining({ source: 'gmail' }),
        'sync.cron.notify_error: Failed to send error notification',
      );
      // Drive and Immich still ran
      expect(mockSyncDrive).toHaveBeenCalled();
      expect(mockSyncImmich).toHaveBeenCalled();
    });
  });
});
