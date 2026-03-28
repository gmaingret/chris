import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSyncCommand, isAwaitingOAuthCode, handleOAuthCode } from '../../bot/handlers/sync.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockLoadTokens = vi.fn();
const mockGenerateAuthUrl = vi.fn();
const mockExchangeCode = vi.fn();
const mockGetAuthenticatedClient = vi.fn();

const mockSyncImmich = vi.fn();
vi.mock('../../immich/sync.js', () => ({
  syncImmich: (...args: any[]) => mockSyncImmich(...args),
}));

const mockSyncGmail = vi.fn();
vi.mock('../../gmail/sync.js', () => ({
  syncGmail: (...args: any[]) => mockSyncGmail(...args),
}));

const mockSyncDrive = vi.fn();
vi.mock('../../drive/sync.js', () => ({
  syncDrive: (...args: any[]) => mockSyncDrive(...args),
}));

const mockHasRequiredScopes = vi.fn();
vi.mock('../../gmail/oauth.js', () => ({
  loadTokens: (...args: any[]) => mockLoadTokens(...args),
  generateAuthUrl: (...args: any[]) => mockGenerateAuthUrl(...args),
  exchangeCode: (...args: any[]) => mockExchangeCode(...args),
  getAuthenticatedClient: (...args: any[]) => mockGetAuthenticatedClient(...args),
  hasRequiredScopes: (...args: any[]) => mockHasRequiredScopes(...args),
  DRIVE_READONLY_SCOPE: 'https://www.googleapis.com/auth/drive.readonly',
}));

let mockConfig = {
  immichApiUrl: 'http://immich:2283',
  immichApiKey: 'test-api-key',
};
vi.mock('../../config.js', () => ({
  get config() { return mockConfig; },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/errors.js', () => {
  class ChrisError extends Error {
    constructor(message: string, public code: string, public cause?: unknown) {
      super(message);
    }
  }
  class OAuthError extends ChrisError {
    constructor(message: string, cause?: unknown) {
      super(message, 'OAUTH_ERROR', cause);
    }
  }
  return { OAuthError, ChrisError };
});

vi.mock('../../db/connection.js', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock('../../db/schema.js', () => ({
  syncStatus: { source: 'source_col' },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function createCtx(text: string, chatId = 123) {
  return {
    chat: { id: chatId },
    from: { id: 456 },
    message: { text },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('sync command handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateAuthUrl.mockReturnValue('https://accounts.google.com/o/oauth2/auth?test');
    mockSyncGmail.mockResolvedValue(undefined);
    mockSyncDrive.mockResolvedValue(undefined);
    mockGetAuthenticatedClient.mockResolvedValue({});
    mockSyncImmich.mockResolvedValue(undefined);
    mockHasRequiredScopes.mockReturnValue(true);
    mockConfig = {
      immichApiUrl: 'http://immich:2283',
      immichApiKey: 'test-api-key',
    };
  });

  describe('/sync without subcommand', () => {
    it('shows usage help', async () => {
      const ctx = createCtx('/sync');
      await handleSyncCommand(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Usage'),
      );
    });
  });

  describe('/sync with unsupported source', () => {
    it('replies with helpful error', async () => {
      const ctx = createCtx('/sync notion');
      await handleSyncCommand(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Unknown sync source'),
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('notion'),
      );
    });
  });

  describe('/sync gmail — no tokens', () => {
    it('replies with auth URL and sets pending state', async () => {
      mockLoadTokens.mockResolvedValue(null);

      const ctx = createCtx('/sync gmail');
      await handleSyncCommand(ctx);

      expect(mockLoadTokens).toHaveBeenCalledWith('google');
      expect(mockGenerateAuthUrl).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('https://accounts.google.com'),
      );
      // Should now be awaiting code
      expect(isAwaitingOAuthCode(123)).toBe(true);
    });
  });

  describe('/sync gmail — tokens exist', () => {
    it('triggers sync immediately', async () => {
      mockLoadTokens.mockResolvedValue({
        accessToken: 'tok',
        refreshToken: 'ref',
        expiryDate: null,
        scope: null,
      });

      const ctx = createCtx('/sync gmail');
      await handleSyncCommand(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Starting Gmail sync'),
      );
      expect(mockGetAuthenticatedClient).toHaveBeenCalled();
      expect(mockSyncGmail).toHaveBeenCalled();
    });
  });

  describe('/sync gmail — OAuth error', () => {
    it('tells user to re-authorize when OAuth fails', async () => {
      const { OAuthError } = await import('../../utils/errors.js');
      mockLoadTokens.mockResolvedValue({
        accessToken: 'tok',
        refreshToken: 'ref',
        expiryDate: null,
        scope: null,
      });
      mockGetAuthenticatedClient.mockRejectedValue(
        new OAuthError('Token refresh failed'),
      );

      const ctx = createCtx('/sync gmail');
      await handleSyncCommand(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('re-authorize'),
      );
    });
  });

  describe('/sync photos — configured', () => {
    it('replies with starting message and calls syncImmich', async () => {
      const ctx = createCtx('/sync photos');
      await handleSyncCommand(ctx);

      expect(ctx.reply).toHaveBeenCalledWith('📷 Starting photo sync...');
      expect(mockSyncImmich).toHaveBeenCalledWith(expect.any(Function));
    });

    it('passes sendMessage callback that calls ctx.reply', async () => {
      const ctx = createCtx('/sync photos');
      await handleSyncCommand(ctx);

      // Extract the callback passed to syncImmich and invoke it
      const sendMessage = mockSyncImmich.mock.calls[0]![0];
      await sendMessage('progress update');
      expect(ctx.reply).toHaveBeenCalledWith('progress update');
    });
  });

  describe('/sync photos — not configured', () => {
    it('replies with config error when immichApiUrl is empty', async () => {
      mockConfig = { immichApiUrl: '', immichApiKey: 'key' };
      const ctx = createCtx('/sync photos');
      await handleSyncCommand(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Immich is not configured'),
      );
      expect(mockSyncImmich).not.toHaveBeenCalled();
    });

    it('replies with config error when immichApiKey is empty', async () => {
      mockConfig = { immichApiUrl: 'http://immich:2283', immichApiKey: '' };
      const ctx = createCtx('/sync photos');
      await handleSyncCommand(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Immich is not configured'),
      );
      expect(mockSyncImmich).not.toHaveBeenCalled();
    });
  });

  describe('/sync photos — sync error', () => {
    it('logs error but does not crash handler', async () => {
      const { logger } = await import('../../utils/logger.js');
      mockSyncImmich.mockRejectedValue(new Error('Immich unreachable'));

      const ctx = createCtx('/sync photos');
      await handleSyncCommand(ctx);

      // Wait for the fire-and-forget promise to settle
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Immich unreachable' }),
        'immich.sync.error',
      );
      // Handler itself didn't throw
    });
  });

  describe('/sync usage and unknown source include photos and drive', () => {
    it('usage message mentions photos and drive', async () => {
      const ctx = createCtx('/sync');
      await handleSyncCommand(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('photos'),
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('drive'),
      );
    });

    it('unknown source error mentions photos and drive', async () => {
      const ctx = createCtx('/sync notion');
      await handleSyncCommand(ctx);
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('photos'),
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('drive'),
      );
    });
  });

  describe('/sync drive — no tokens', () => {
    it('replies with auth URL and sets pending state', async () => {
      mockLoadTokens.mockResolvedValue(null);

      const ctx = createCtx('/sync drive');
      await handleSyncCommand(ctx);

      expect(mockLoadTokens).toHaveBeenCalledWith('google');
      expect(mockGenerateAuthUrl).toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('https://accounts.google.com'),
      );
      expect(isAwaitingOAuthCode(123)).toBe(true);
    });
  });

  describe('/sync drive — tokens exist with drive scope', () => {
    it('triggers syncDrive immediately', async () => {
      mockLoadTokens.mockResolvedValue({
        accessToken: 'tok',
        refreshToken: 'ref',
        expiryDate: null,
        scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly',
      });
      mockHasRequiredScopes.mockReturnValue(true);

      const ctx = createCtx('/sync drive');
      await handleSyncCommand(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('Starting Drive sync'),
      );
      expect(mockGetAuthenticatedClient).toHaveBeenCalled();
      expect(mockSyncDrive).toHaveBeenCalled();
    });
  });

  describe('/sync drive — tokens exist but missing drive scope', () => {
    it('sends re-auth URL with scope message', async () => {
      mockLoadTokens.mockResolvedValue({
        accessToken: 'tok',
        refreshToken: 'ref',
        expiryDate: null,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      });
      mockHasRequiredScopes.mockReturnValue(false);

      const ctx = createCtx('/sync drive');
      await handleSyncCommand(ctx);

      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('expanded permissions'),
      );
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining('https://accounts.google.com'),
      );
      expect(mockSyncDrive).not.toHaveBeenCalled();
      expect(isAwaitingOAuthCode(123)).toBe(true);
    });
  });

  describe('/sync drive — sync error', () => {
    it('logs error but does not crash handler', async () => {
      const { logger } = await import('../../utils/logger.js');
      mockLoadTokens.mockResolvedValue({
        accessToken: 'tok',
        refreshToken: 'ref',
        expiryDate: null,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
      });
      mockHasRequiredScopes.mockReturnValue(true);
      mockSyncDrive.mockRejectedValue(new Error('Drive API error'));

      const ctx = createCtx('/sync drive');
      await handleSyncCommand(ctx);

      // Wait for the fire-and-forget promise to settle
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Drive API error' }),
        'drive.sync.error',
      );
    });
  });

  describe('OAuth code exchange', () => {
    it('exchanges code and triggers sync', async () => {
      // First set up pending state
      mockLoadTokens.mockResolvedValue(null);
      const ctx1 = createCtx('/sync gmail', 789);
      await handleSyncCommand(ctx1);
      expect(isAwaitingOAuthCode(789)).toBe(true);

      // Then handle the code
      mockExchangeCode.mockResolvedValue(undefined);

      const ctx2 = createCtx('4/auth_code_here', 789);
      await handleOAuthCode(ctx2);

      expect(mockExchangeCode).toHaveBeenCalledWith('4/auth_code_here');
      expect(ctx2.reply).toHaveBeenCalledWith(
        expect.stringContaining('Authenticated'),
      );
      expect(mockSyncGmail).toHaveBeenCalled();
      // Should no longer be awaiting
      expect(isAwaitingOAuthCode(789)).toBe(false);
    });

    it('handles invalid code gracefully', async () => {
      // Set up pending state
      mockLoadTokens.mockResolvedValue(null);
      const ctx1 = createCtx('/sync gmail', 321);
      await handleSyncCommand(ctx1);

      // Code exchange fails
      mockExchangeCode.mockRejectedValue(new Error('Invalid grant'));

      const ctx2 = createCtx('bad_code', 321);
      await handleOAuthCode(ctx2);

      expect(ctx2.reply).toHaveBeenCalledWith(
        expect.stringContaining("didn't work"),
      );
      // Should clear pending state
      expect(isAwaitingOAuthCode(321)).toBe(false);
    });
  });
});
