import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SendMessage } from '../sync.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../db/connection.js', () => ({
  db: new Proxy({} as any, {
    get: (_target, prop) => (dbMock as any)[prop],
  }),
}));

vi.mock('../../db/schema.js', () => ({
  syncStatus: { source: 'source', id: 'id' },
  pensieveEntries: { id: 'id', source: 'source', metadata: 'metadata', contentHash: 'content_hash' },
  pensieveEmbeddings: { entryId: 'entry_id' },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/errors.js', () => {
  class GmailSyncError extends Error {
    code = 'GMAIL_SYNC_ERROR';
    constructor(message: string, public cause?: unknown) {
      super(message);
    }
  }
  return { GmailSyncError };
});

const mockListThreads = vi.fn();
const mockGetThread = vi.fn();
vi.mock('../client.js', () => ({
  listThreads: (...args: any[]) => mockListThreads(...args),
  getThread: (...args: any[]) => mockGetThread(...args),
}));

const mockCollapseThread = vi.fn();
vi.mock('../collapse.js', () => ({
  collapseThread: (...args: any[]) => mockCollapseThread(...args),
}));

const mockStorePensieveEntryUpsert = vi.fn();
vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntryUpsert: (...args: any[]) => mockStorePensieveEntryUpsert(...args),
}));

const mockEmbedAndStoreChunked = vi.fn();
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStoreChunked: (...args: any[]) => mockEmbedAndStoreChunked(...args),
}));

let mockGmailInstance: any;

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => mockGmailInstance),
  },
  gmail_v1: {},
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockAuthClient() {
  return {} as any;
}

function setupSelectChain(results: (() => any[])[]) {
  let callIdx = 0;
  const selectChain: any = {};
  selectChain.from = vi.fn().mockReturnValue(selectChain);
  selectChain.where = vi.fn().mockReturnValue(selectChain);
  selectChain.limit = vi.fn().mockImplementation(() => {
    const fn = results[Math.min(callIdx, results.length - 1)];
    callIdx++;
    return Promise.resolve(fn());
  });
  dbMock.select.mockReturnValue(selectChain);
}

function setupInsertChain() {
  const chain: any = {};
  chain.values = vi.fn().mockResolvedValue(undefined);
  dbMock.insert.mockReturnValue(chain);
}

function setupUpdateChain() {
  const chain: any = {};
  chain.set = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue(undefined);
  dbMock.update.mockReturnValue(chain);
}

function setupDbForFullSync() {
  setupSelectChain([
    () => [],  // loadSyncStatus → no historyId → full sync
    () => [{ source: 'gmail', errorCount: 0 }],  // subsequent upsert lookups
  ]);
  setupInsertChain();
  setupUpdateChain();
}

function setupDbForIncrementalSync(historyId = '12345') {
  setupSelectChain([
    () => [{ source: 'gmail', lastHistoryId: historyId, errorCount: 0 }],
    () => [{ source: 'gmail', errorCount: 0 }],
  ]);
  setupInsertChain();
  setupUpdateChain();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('sync orchestrator', () => {
  let sendMessage: SendMessage & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage = vi.fn<SendMessage>().mockResolvedValue(undefined);

    mockGmailInstance = {
      users: {
        threads: { list: vi.fn(), get: vi.fn() },
        history: { list: vi.fn() },
        getProfile: vi.fn().mockResolvedValue({ data: { historyId: '99999' } }),
      },
    };

    mockCollapseThread.mockReturnValue({
      text: 'Subject: Test\n\n--- sender (2025-01-01) ---\nHello world',
      subject: 'Test',
      participants: ['sender@example.com'],
    });

    mockStorePensieveEntryUpsert.mockResolvedValue({
      entry: { id: 'entry-1', content: 'collapsed content' },
      action: 'created' as const,
    });

    mockEmbedAndStoreChunked.mockResolvedValue(undefined);
  });

  describe('full sync', () => {
    it('fetches threads from past year with pagination, processes all, updates sync_status', async () => {
      const { syncGmail } = await import('../sync.js');
      setupDbForFullSync();

      mockListThreads
        .mockResolvedValueOnce({
          threads: [{ id: 't1' }, { id: 't2' }],
          nextPageToken: 'page2',
        })
        .mockResolvedValueOnce({
          threads: [{ id: 't3' }],
          nextPageToken: null,
        });

      mockGetThread.mockImplementation((_g: any, id: string) =>
        Promise.resolve({ id, messages: [{ id: `${id}-m1` }] }),
      );

      await syncGmail(createMockAuthClient(), sendMessage);

      // Paginated through 2 pages
      expect(mockListThreads).toHaveBeenCalledTimes(2);
      // All 3 threads processed
      expect(mockGetThread).toHaveBeenCalledTimes(3);
      expect(mockCollapseThread).toHaveBeenCalledTimes(3);
      expect(mockStorePensieveEntryUpsert).toHaveBeenCalledTimes(3);
      // All created → embed all
      expect(mockEmbedAndStoreChunked).toHaveBeenCalledTimes(3);
      // Progress + completion messages sent
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('Gmail sync complete'));
      // Profile fetched for historyId
      expect(mockGmailInstance.users.getProfile).toHaveBeenCalled();
    });

    it('skips embedding for skipped entries', async () => {
      const { syncGmail } = await import('../sync.js');
      setupDbForFullSync();

      mockListThreads.mockResolvedValueOnce({
        threads: [{ id: 't1' }],
        nextPageToken: null,
      });

      mockGetThread.mockResolvedValue({ id: 't1', messages: [] });
      mockStorePensieveEntryUpsert.mockResolvedValue({
        entry: { id: 'entry-1' },
        action: 'skipped' as const,
      });

      await syncGmail(createMockAuthClient(), sendMessage);

      expect(mockEmbedAndStoreChunked).not.toHaveBeenCalled();
    });
  });

  describe('incremental sync', () => {
    it('uses historyId for efficient updates', async () => {
      const { syncGmail } = await import('../sync.js');
      setupDbForIncrementalSync();

      mockGmailInstance.users.history.list.mockResolvedValue({
        data: {
          history: [
            { messagesAdded: [{ message: { threadId: 't1' } }] },
            { messagesAdded: [{ message: { threadId: 't2' } }] },
          ],
          nextPageToken: null,
        },
      });

      mockGetThread.mockImplementation((_g: any, id: string) =>
        Promise.resolve({ id, messages: [] }),
      );

      await syncGmail(createMockAuthClient(), sendMessage);

      expect(mockGmailInstance.users.history.list).toHaveBeenCalledWith(
        expect.objectContaining({ startHistoryId: '12345' }),
      );
      expect(mockListThreads).not.toHaveBeenCalled();
      expect(mockGetThread).toHaveBeenCalledTimes(2);
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('2 changed thread'));
    });

    it('falls back to full sync when history returns 404', async () => {
      const { syncGmail } = await import('../sync.js');
      setupDbForIncrementalSync();

      const error404 = new Error('Not Found') as Error & { code: number };
      error404.code = 404;
      mockGmailInstance.users.history.list.mockRejectedValue(error404);

      mockListThreads.mockResolvedValueOnce({
        threads: [{ id: 't1' }],
        nextPageToken: null,
      });
      mockGetThread.mockResolvedValue({ id: 't1', messages: [] });

      await syncGmail(createMockAuthClient(), sendMessage);

      expect(mockGmailInstance.users.history.list).toHaveBeenCalled();
      expect(mockListThreads).toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('full sync'));
    });
  });

  describe('error resilience', () => {
    it('continues processing when a single thread fails', async () => {
      const { syncGmail } = await import('../sync.js');
      setupDbForFullSync();

      mockListThreads.mockResolvedValueOnce({
        threads: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
        nextPageToken: null,
      });

      mockGetThread
        .mockResolvedValueOnce({ id: 't1', messages: [] })
        .mockRejectedValueOnce(new Error('API timeout'))
        .mockResolvedValueOnce({ id: 't3', messages: [] });

      await syncGmail(createMockAuthClient(), sendMessage);

      expect(mockGetThread).toHaveBeenCalledTimes(3);
      expect(mockCollapseThread).toHaveBeenCalledTimes(2);
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('1 error'));
    });
  });

  describe('progress reporting', () => {
    it('sends batch progress and completion messages', async () => {
      const { syncGmail } = await import('../sync.js');
      setupDbForFullSync();

      mockListThreads.mockResolvedValueOnce({
        threads: [{ id: 't1' }],
        nextPageToken: null,
      });
      mockGetThread.mockResolvedValue({ id: 't1', messages: [] });

      await syncGmail(createMockAuthClient(), sendMessage);

      const calls = sendMessage.mock.calls.map((c: any[]) => c[0] as string);
      expect(calls.some((c: string) => c.includes('batch'))).toBe(true);
      expect(calls.some((c: string) => c.includes('complete'))).toBe(true);
    });
  });
});
