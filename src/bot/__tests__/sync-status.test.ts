import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleSyncCommand } from '../../bot/handlers/sync.js';
import { formatRelativeTime, formatSyncStatus } from '../../bot/handlers/sync.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockDbSelect = vi.fn();
const mockFrom = vi.fn();
const mockOrderBy = vi.fn();

vi.mock('../../db/connection.js', () => ({
  db: {
    select: (...args: any[]) => {
      mockDbSelect(...args);
      return {
        from: (...fArgs: any[]) => {
          mockFrom(...fArgs);
          return {
            orderBy: (...oArgs: any[]) => mockOrderBy(...oArgs),
          };
        },
      };
    },
  },
}));

vi.mock('../../db/schema.js', () => ({
  syncStatus: { source: 'source_col' },
}));

vi.mock('../../gmail/oauth.js', () => ({
  loadTokens: vi.fn(),
  generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/o/oauth2/auth?test'),
  exchangeCode: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  hasRequiredScopes: vi.fn().mockReturnValue(true),
  DRIVE_READONLY_SCOPE: 'https://www.googleapis.com/auth/drive.readonly',
}));

vi.mock('../../gmail/sync.js', () => ({ syncGmail: vi.fn() }));
vi.mock('../../drive/sync.js', () => ({ syncDrive: vi.fn() }));
vi.mock('../../immich/sync.js', () => ({ syncImmich: vi.fn() }));
vi.mock('../../config.js', () => ({
  config: { immichApiUrl: 'http://immich:2283', immichApiKey: 'key' },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../utils/errors.js', () => {
  class ChrisError extends Error {
    constructor(message: string, public code: string, public cause?: unknown) { super(message); }
  }
  class OAuthError extends ChrisError {
    constructor(message: string, cause?: unknown) { super(message, 'OAUTH_ERROR', cause); }
  }
  return { OAuthError, ChrisError };
});

// ── Helpers ────────────────────────────────────────────────────────────────

function createCtx(text: string, chatId = 123) {
  return {
    chat: { id: chatId },
    from: { id: 456 },
    message: { text },
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRow(overrides: Partial<{
  source: string;
  lastSyncAt: Date | null;
  entryCount: number;
  errorCount: number;
  status: string;
  lastError: string | null;
}> = {}) {
  return {
    source: 'gmail',
    lastSyncAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
    entryCount: 342,
    errorCount: 0,
    status: 'complete',
    lastError: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('/sync status command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns friendly message when no syncs have run', async () => {
    mockOrderBy.mockResolvedValue([]);

    const ctx = createCtx('/sync status');
    await handleSyncCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('No syncs have run yet'),
    );
  });

  it('returns formatted status for all three sources', async () => {
    mockOrderBy.mockResolvedValue([
      makeRow({ source: 'gdrive', entryCount: 50, status: 'complete' }),
      makeRow({ source: 'gmail', entryCount: 342, status: 'complete' }),
      makeRow({ source: 'immich', entryCount: 1205, errorCount: 3, status: 'complete' }),
    ]);

    const ctx = createCtx('/sync status');
    await handleSyncCommand(ctx);

    const reply = ctx.reply.mock.calls[0][0] as string;
    expect(reply).toContain('📊 Sync Status');
    expect(reply).toContain('📄 Drive');
    expect(reply).toContain('📧 Gmail');
    expect(reply).toContain('📷 Photos');
    expect(reply).toContain('342');
    expect(reply).toContain('1,205');
    expect(reply).toContain('✅');
  });

  it('handles partial data (only some sources)', async () => {
    mockOrderBy.mockResolvedValue([
      makeRow({ source: 'gmail', status: 'complete' }),
    ]);

    const ctx = createCtx('/sync status');
    await handleSyncCommand(ctx);

    const reply = ctx.reply.mock.calls[0][0] as string;
    expect(reply).toContain('📧 Gmail');
    expect(reply).not.toContain('📷 Photos');
    expect(reply).not.toContain('📄 Drive');
  });

  it('shows error state with lastError message', async () => {
    mockOrderBy.mockResolvedValue([
      makeRow({
        source: 'gdrive',
        status: 'error',
        errorCount: 5,
        lastError: 'OAuth token expired',
      }),
    ]);

    const ctx = createCtx('/sync status');
    await handleSyncCommand(ctx);

    const reply = ctx.reply.mock.calls[0][0] as string;
    expect(reply).toContain('⚠️');
    expect(reply).toContain('error');
    expect(reply).toContain('OAuth token expired');
  });

  it('shows syncing status with 🔄 emoji', async () => {
    mockOrderBy.mockResolvedValue([
      makeRow({ source: 'gmail', status: 'syncing' }),
    ]);

    const ctx = createCtx('/sync status');
    await handleSyncCommand(ctx);

    const reply = ctx.reply.mock.calls[0][0] as string;
    expect(reply).toContain('🔄');
  });

  it('shows ⏳ for idle/null status', async () => {
    mockOrderBy.mockResolvedValue([
      makeRow({ source: 'gmail', status: 'idle', lastSyncAt: null }),
    ]);

    const ctx = createCtx('/sync status');
    await handleSyncCommand(ctx);

    const reply = ctx.reply.mock.calls[0][0] as string;
    expect(reply).toContain('⏳');
    expect(reply).toContain('never');
  });

  it('handles DB error gracefully', async () => {
    mockOrderBy.mockRejectedValue(new Error('connection refused'));

    const ctx = createCtx('/sync status');
    await handleSyncCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith('❌ Failed to fetch sync status.');
  });
});

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "never" for null', () => {
    expect(formatRelativeTime(null)).toBe('never');
  });

  it('returns seconds for very recent times', () => {
    const date = new Date(Date.now() - 30_000);
    expect(formatRelativeTime(date)).toBe('30s ago');
  });

  it('returns minutes for times under an hour', () => {
    const date = new Date(Date.now() - 15 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('15m ago');
  });

  it('returns hours for times under a day', () => {
    const date = new Date(Date.now() - 5 * 60 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('5h ago');
  });

  it('returns days for times over 24 hours', () => {
    const date = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(date)).toBe('3d ago');
  });

  it('handles future dates gracefully', () => {
    const date = new Date(Date.now() + 10_000);
    expect(formatRelativeTime(date)).toBe('just now');
  });
});

describe('formatSyncStatus', () => {
  it('handles empty rows', () => {
    const result = formatSyncStatus([]);
    expect(result).toContain('No syncs have run yet');
  });

  it('uses source labels for known sources', () => {
    const result = formatSyncStatus([
      makeRow({ source: 'gmail' }),
      makeRow({ source: 'immich' }),
      makeRow({ source: 'gdrive' }),
    ]);
    expect(result).toContain('📧 Gmail');
    expect(result).toContain('📷 Photos');
    expect(result).toContain('📄 Drive');
  });

  it('handles unknown source name gracefully', () => {
    const result = formatSyncStatus([
      makeRow({ source: 'notion' }),
    ]);
    expect(result).toContain('🔗 notion');
  });

  it('truncates long error messages', () => {
    const longError = 'A'.repeat(200);
    const result = formatSyncStatus([
      makeRow({ source: 'gmail', status: 'error', lastError: longError }),
    ]);
    // Should be truncated to 80 chars
    expect(result).not.toContain(longError);
    expect(result).toContain('A'.repeat(80));
  });

  it('shows "no successful sync" when error row has no lastSyncAt', () => {
    const result = formatSyncStatus([
      makeRow({ source: 'gmail', status: 'error', lastSyncAt: null, lastError: 'fail' }),
    ]);
    expect(result).toContain('no successful sync');
  });
});
