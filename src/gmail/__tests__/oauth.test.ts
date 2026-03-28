import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuthError } from '../../utils/errors.js';

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Mock config ────────────────────────────────────────────────────────────
const mockConfig: Record<string, string> = {};
vi.mock('../../config.js', () => ({
  get config() {
    return mockConfig;
  },
}));

// ── Mock DB — inline all fns inside factory to avoid hoisting issues ──────
const dbMock = {
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  selectFrom: vi.fn(),
  selectWhere: vi.fn(),
  selectLimit: vi.fn(),
};

vi.mock('../../db/connection.js', () => ({
  db: {
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => {
        dbMock.insertValues(...args);
        return { returning: vi.fn() };
      },
    })),
    update: vi.fn(() => ({
      set: (...args: unknown[]) => {
        dbMock.updateSet(...args);
        return {
          where: (...wArgs: unknown[]) => {
            dbMock.updateWhere(...wArgs);
          },
        };
      },
    })),
    select: vi.fn(() => ({
      from: (...args: unknown[]) => {
        dbMock.selectFrom(...args);
        return {
          where: (...wArgs: unknown[]) => {
            dbMock.selectWhere(...wArgs);
            return {
              limit: (...lArgs: unknown[]) => dbMock.selectLimit(...lArgs),
            };
          },
        };
      },
    })),
  },
}));

// ── Mock googleapis ────────────────────────────────────────────────────────
const oauthClientMock = {
  generateAuthUrl: vi.fn(),
  getToken: vi.fn(),
  setCredentials: vi.fn(),
  on: vi.fn(),
};

function MockOAuth2() {
  return oauthClientMock;
}

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: MockOAuth2,
    },
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────
import {
  createOAuth2Client,
  generateAuthUrl,
  exchangeCode,
  storeTokens,
  loadTokens,
  getAuthenticatedClient,
  hasRequiredScopes,
  GOOGLE_SCOPES,
  DRIVE_READONLY_SCOPE,
} from '../oauth.js';

describe('oauth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.googleClientId = 'test-client-id';
    mockConfig.googleClientSecret = 'test-client-secret';
    mockConfig.googleRedirectUri = 'http://localhost:3000/oauth2callback';
  });

  describe('createOAuth2Client', () => {
    it('creates client with config credentials', () => {
      const client = createOAuth2Client();
      expect(client).toBeDefined();
    });

    it('throws OAuthError when credentials are missing', () => {
      mockConfig.googleClientId = '';
      expect(() => createOAuth2Client()).toThrow(OAuthError);
      expect(() => createOAuth2Client()).toThrow('Google OAuth credentials not configured');
    });
  });

  describe('generateAuthUrl', () => {
    it('generates URL with gmail.readonly and drive.readonly scopes and offline access', () => {
      const fakeUrl = 'https://accounts.google.com/o/oauth2/auth?scope=...';
      oauthClientMock.generateAuthUrl.mockReturnValue(fakeUrl);

      const url = generateAuthUrl();

      expect(url).toBe(fakeUrl);
      expect(oauthClientMock.generateAuthUrl).toHaveBeenCalledWith({
        access_type: 'offline',
        scope: [
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/drive.readonly',
        ],
        prompt: 'consent',
      });
    });

    it('GOOGLE_SCOPES includes both gmail and drive scopes', () => {
      expect(GOOGLE_SCOPES).toContain('https://www.googleapis.com/auth/gmail.readonly');
      expect(GOOGLE_SCOPES).toContain(DRIVE_READONLY_SCOPE);
      expect(GOOGLE_SCOPES).toHaveLength(2);
    });
  });

  describe('exchangeCode', () => {
    it('exchanges code for tokens and stores them in DB', async () => {
      const fakeTokens = {
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expiry_date: 1700000000000,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      };
      oauthClientMock.getToken.mockResolvedValue({ tokens: fakeTokens });
      // No existing tokens → insert path
      dbMock.selectLimit.mockResolvedValue([]);

      await exchangeCode('auth-code-789');

      expect(oauthClientMock.getToken).toHaveBeenCalledWith('auth-code-789');
      expect(dbMock.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          accessToken: 'access-123',
        }),
      );
    });

    it('throws OAuthError when code exchange fails', async () => {
      oauthClientMock.getToken.mockRejectedValue(new Error('invalid_grant'));

      await expect(exchangeCode('bad-code')).rejects.toThrow(OAuthError);
      await expect(exchangeCode('bad-code')).rejects.toThrow(
        'Failed to exchange authorization code',
      );
    });
  });

  describe('storeTokens', () => {
    const tokenData = {
      accessToken: 'access-123',
      refreshToken: 'refresh-456' as string | null,
      expiryDate: 1700000000000 as number | null,
      scope: 'https://www.googleapis.com/auth/gmail.readonly' as string | null,
    };

    it('inserts new tokens when none exist for provider', async () => {
      dbMock.selectLimit.mockResolvedValue([]);

      await storeTokens('google', tokenData);

      expect(dbMock.insertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          accessToken: 'access-123',
        }),
      );
    });

    it('updates existing tokens for provider', async () => {
      dbMock.selectLimit.mockResolvedValue([{ id: 'existing-uuid' }]);

      await storeTokens('google', tokenData);

      expect(dbMock.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'access-123',
        }),
      );
    });
  });

  describe('loadTokens', () => {
    it('returns tokens when found', async () => {
      dbMock.selectLimit.mockResolvedValue([
        {
          id: 'uuid-1',
          provider: 'google',
          accessToken: 'access-123',
          refreshToken: 'refresh-456',
          expiryDate: 1700000000000,
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await loadTokens('google');

      expect(result).toEqual({
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiryDate: 1700000000000,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      });
    });

    it('returns null when no tokens found', async () => {
      dbMock.selectLimit.mockResolvedValue([]);

      const result = await loadTokens('google');

      expect(result).toBeNull();
    });
  });

  describe('getAuthenticatedClient', () => {
    it('loads tokens and configures client with refresh callback', async () => {
      dbMock.selectLimit.mockResolvedValue([
        {
          id: 'uuid-1',
          provider: 'google',
          accessToken: 'access-123',
          refreshToken: 'refresh-456',
          expiryDate: 1700000000000,
          scope: 'https://www.googleapis.com/auth/gmail.readonly',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const client = await getAuthenticatedClient();

      expect(client).toBeDefined();
      expect(oauthClientMock.setCredentials).toHaveBeenCalledWith({
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expiry_date: 1700000000000,
        scope: 'https://www.googleapis.com/auth/gmail.readonly',
      });
      expect(oauthClientMock.on).toHaveBeenCalledWith('tokens', expect.any(Function));
    });

    it('throws OAuthError when no tokens stored', async () => {
      dbMock.selectLimit.mockResolvedValue([]);

      await expect(getAuthenticatedClient()).rejects.toThrow(OAuthError);
      await expect(getAuthenticatedClient()).rejects.toThrow(
        'No Google OAuth tokens found',
      );
    });

    it('refresh callback persists new tokens to DB', async () => {
      dbMock.selectLimit
        .mockResolvedValueOnce([
          {
            id: 'uuid-1',
            provider: 'google',
            accessToken: 'access-123',
            refreshToken: 'refresh-456',
            expiryDate: 1700000000000,
            scope: 'https://www.googleapis.com/auth/gmail.readonly',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ])
        // Second call from storeTokens within refresh callback
        .mockResolvedValueOnce([{ id: 'uuid-1' }]);

      await getAuthenticatedClient();

      // Get the refresh callback registered via client.on('tokens', cb)
      const refreshCallback = oauthClientMock.on.mock.calls[0][1];
      expect(refreshCallback).toBeDefined();

      // Simulate token refresh
      await refreshCallback({
        access_token: 'new-access-789',
        expiry_date: 1800000000000,
      });

      // Verify tokens were updated (update path since existing)
      expect(dbMock.updateSet).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: 'new-access-789',
        }),
      );
    });
  });

  describe('hasRequiredScopes', () => {
    it('returns true when all required scopes are present', () => {
      const tokenScope = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly';
      expect(hasRequiredScopes(tokenScope, GOOGLE_SCOPES)).toBe(true);
    });

    it('returns true when token has extra scopes beyond required', () => {
      const tokenScope = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/calendar.readonly';
      expect(hasRequiredScopes(tokenScope, ['https://www.googleapis.com/auth/gmail.readonly'])).toBe(true);
    });

    it('returns false when a required scope is missing', () => {
      const tokenScope = 'https://www.googleapis.com/auth/gmail.readonly';
      expect(hasRequiredScopes(tokenScope, GOOGLE_SCOPES)).toBe(false);
    });

    it('returns false when tokenScope is null', () => {
      expect(hasRequiredScopes(null, GOOGLE_SCOPES)).toBe(false);
    });

    it('returns true for empty required scopes array', () => {
      expect(hasRequiredScopes('anything', [])).toBe(true);
    });
  });
});
