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
  class DriveSyncError extends Error {
    code = 'DRIVE_SYNC_ERROR';
    constructor(message: string, public cause?: unknown) {
      super(message);
    }
  }
  return { DriveSyncError };
});

const mockListFiles = vi.fn();
const mockExportFileAsText = vi.fn();
const mockGetStartPageToken = vi.fn();
const mockGetChanges = vi.fn();
vi.mock('../client.js', () => ({
  listFiles: (...args: any[]) => mockListFiles(...args),
  exportFileAsText: (...args: any[]) => mockExportFileAsText(...args),
  getStartPageToken: (...args: any[]) => mockGetStartPageToken(...args),
  getChanges: (...args: any[]) => mockGetChanges(...args),
}));

const mockStorePensieveEntryUpsert = vi.fn();
vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntryUpsert: (...args: any[]) => mockStorePensieveEntryUpsert(...args),
}));

const mockEmbedAndStoreChunked = vi.fn();
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStoreChunked: (...args: any[]) => mockEmbedAndStoreChunked(...args),
}));

let mockDriveInstance: any;

vi.mock('googleapis', () => ({
  google: {
    drive: vi.fn(() => mockDriveInstance),
  },
  drive_v3: {},
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
    const fn = results[Math.min(callIdx, results.length - 1)]!;
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
    () => [],  // loadSyncStatus → no lastHistoryId → full sync
    () => [{ source: 'gdrive', errorCount: 0 }],  // subsequent upsert lookups
  ]);
  setupInsertChain();
  setupUpdateChain();
}

function setupDbForIncrementalSync(startPageToken = 'token-123') {
  setupSelectChain([
    () => [{ source: 'gdrive', lastHistoryId: startPageToken, errorCount: 0 }],
    () => [{ source: 'gdrive', errorCount: 0 }],
  ]);
  setupInsertChain();
  setupUpdateChain();
}

function makeFile(id: string, name?: string) {
  return {
    id,
    name: name ?? `file-${id}.txt`,
    mimeType: 'application/vnd.google-apps.document',
    modifiedTime: '2025-06-15T10:00:00Z',
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Drive sync orchestrator', () => {
  let sendMessage: SendMessage & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage = vi.fn<SendMessage>().mockResolvedValue(undefined);

    mockDriveInstance = {};

    mockExportFileAsText.mockResolvedValue('Hello world content');
    mockGetStartPageToken.mockResolvedValue('new-token-456');

    mockStorePensieveEntryUpsert.mockResolvedValue({
      entry: { id: 'entry-1', content: 'formatted content' },
      action: 'created' as const,
    });

    mockEmbedAndStoreChunked.mockResolvedValue(undefined);
  });

  describe('full sync', () => {
    it('lists files, exports text, upserts entries, embeds, updates sync_status', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForFullSync();

      mockListFiles.mockResolvedValueOnce({
        files: [makeFile('f1', 'Doc A'), makeFile('f2', 'Doc B')],
        nextPageToken: null,
      });

      await syncDrive(createMockAuthClient(), sendMessage);

      expect(mockListFiles).toHaveBeenCalledTimes(1);
      expect(mockExportFileAsText).toHaveBeenCalledTimes(2);
      expect(mockStorePensieveEntryUpsert).toHaveBeenCalledTimes(2);

      // Verify source and metadata shape
      const firstCall = mockStorePensieveEntryUpsert.mock.calls[0]!;
      expect(firstCall[1]).toBe('gdrive');
      expect(firstCall[2]).toMatchObject({ fileId: 'f1', fileName: 'Doc A' });
      expect(firstCall[3]).toBe('fileId');

      // Verify structured text format
      expect(firstCall[0]).toContain('Title: Doc A');
      expect(firstCall[0]).toContain('Type: Google Doc');
      expect(firstCall[0]).toContain('Modified: 2025-06-15');
      expect(firstCall[0]).toContain('Hello world content');

      // All created → embed all
      expect(mockEmbedAndStoreChunked).toHaveBeenCalledTimes(2);

      // Completion message
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('Drive sync complete'));

      // Got new start page token
      expect(mockGetStartPageToken).toHaveBeenCalled();
    });

    it('handles pagination across multiple pages', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForFullSync();

      mockListFiles
        .mockResolvedValueOnce({
          files: [makeFile('f1')],
          nextPageToken: 'page2',
        })
        .mockResolvedValueOnce({
          files: [makeFile('f2')],
          nextPageToken: null,
        });

      await syncDrive(createMockAuthClient(), sendMessage);

      expect(mockListFiles).toHaveBeenCalledTimes(2);
      expect(mockExportFileAsText).toHaveBeenCalledTimes(2);
      expect(mockStorePensieveEntryUpsert).toHaveBeenCalledTimes(2);
    });

    it('skips embedding for skipped (unchanged) entries', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForFullSync();

      mockListFiles.mockResolvedValueOnce({
        files: [makeFile('f1')],
        nextPageToken: null,
      });

      mockStorePensieveEntryUpsert.mockResolvedValue({
        entry: { id: 'entry-1', content: '' },
        action: 'skipped' as const,
      });

      await syncDrive(createMockAuthClient(), sendMessage);

      expect(mockEmbedAndStoreChunked).not.toHaveBeenCalled();
    });

    it('completes successfully with empty file list', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForFullSync();

      mockListFiles.mockResolvedValueOnce({
        files: [],
        nextPageToken: null,
      });

      await syncDrive(createMockAuthClient(), sendMessage);

      expect(mockExportFileAsText).not.toHaveBeenCalled();
      expect(mockStorePensieveEntryUpsert).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Drive sync complete — 0 entries'),
      );
    });
  });

  describe('incremental sync', () => {
    it('uses startPageToken, processes only changed files', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForIncrementalSync();

      mockGetChanges.mockResolvedValue({
        changes: [
          { fileId: 'f1', file: makeFile('f1', 'Changed Doc'), removed: false },
          { fileId: 'f2', file: makeFile('f2', 'Another Doc'), removed: false },
        ],
        newStartPageToken: 'token-new',
      });

      await syncDrive(createMockAuthClient(), sendMessage);

      expect(mockGetChanges).toHaveBeenCalled();
      expect(mockListFiles).not.toHaveBeenCalled();
      expect(mockExportFileAsText).toHaveBeenCalledTimes(2);
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('2 changed file'));
    });

    it('skips removed files in changes', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForIncrementalSync();

      mockGetChanges.mockResolvedValue({
        changes: [
          { fileId: 'f1', file: makeFile('f1'), removed: false },
          { fileId: 'f2', file: null, removed: true },
        ],
        newStartPageToken: 'token-new',
      });

      await syncDrive(createMockAuthClient(), sendMessage);

      // Only the non-removed file processed
      expect(mockExportFileAsText).toHaveBeenCalledTimes(1);
    });

    it('falls back to full sync when Changes API fails', async () => {
      const { syncDrive } = await import('../sync.js');
      const { DriveSyncError } = await import('../../utils/errors.js');
      setupDbForIncrementalSync();

      mockGetChanges.mockRejectedValue(
        new DriveSyncError('Invalid token'),
      );

      mockListFiles.mockResolvedValueOnce({
        files: [makeFile('f1')],
        nextPageToken: null,
      });

      await syncDrive(createMockAuthClient(), sendMessage);

      // Fell back to full sync
      expect(mockGetChanges).toHaveBeenCalled();
      expect(mockListFiles).toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('full sync'));
    });
  });

  describe('error resilience', () => {
    it('continues processing when a single file export fails', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForFullSync();

      mockListFiles.mockResolvedValueOnce({
        files: [makeFile('f1'), makeFile('f2'), makeFile('f3')],
        nextPageToken: null,
      });

      mockExportFileAsText
        .mockResolvedValueOnce('Content 1')
        .mockRejectedValueOnce(new Error('Export timeout'))
        .mockResolvedValueOnce('Content 3');

      await syncDrive(createMockAuthClient(), sendMessage);

      // All 3 attempted, 2 succeeded
      expect(mockExportFileAsText).toHaveBeenCalledTimes(3);
      expect(mockStorePensieveEntryUpsert).toHaveBeenCalledTimes(2);
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('1 error'));
    });

    it('file-level errors are logged with fileId and fileName', async () => {
      const { syncDrive } = await import('../sync.js');
      const { logger: loggerMock } = await import('../../utils/logger.js');
      setupDbForFullSync();

      mockListFiles.mockResolvedValueOnce({
        files: [makeFile('fail-id', 'BadFile.doc')],
        nextPageToken: null,
      });

      mockExportFileAsText.mockRejectedValueOnce(new Error('Access denied'));

      await syncDrive(createMockAuthClient(), sendMessage);

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: 'fail-id',
          fileName: 'BadFile.doc',
          error: 'Access denied',
        }),
        'drive.sync.file.error',
      );
    });

    it('sync-level errors update sync_status and re-throw', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForFullSync();

      mockListFiles.mockRejectedValue(new Error('Network failure'));

      await expect(
        syncDrive(createMockAuthClient(), sendMessage),
      ).rejects.toThrow('Drive sync failed');

      expect(sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Drive sync failed'),
      );
    });
  });

  describe('progress reporting', () => {
    it('sends batch progress and completion messages', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForFullSync();

      mockListFiles.mockResolvedValueOnce({
        files: [makeFile('f1')],
        nextPageToken: null,
      });

      await syncDrive(createMockAuthClient(), sendMessage);

      const calls = sendMessage.mock.calls.map((c: any[]) => c[0] as string);
      expect(calls.some((c: string) => c.includes('batch'))).toBe(true);
      expect(calls.some((c: string) => c.includes('complete'))).toBe(true);
    });
  });

  describe('empty content handling', () => {
    it('skips files with empty exported content', async () => {
      const { syncDrive } = await import('../sync.js');
      setupDbForFullSync();

      mockListFiles.mockResolvedValueOnce({
        files: [makeFile('f1')],
        nextPageToken: null,
      });

      mockExportFileAsText.mockResolvedValueOnce('   ');

      await syncDrive(createMockAuthClient(), sendMessage);

      // Empty content skipped, not stored
      expect(mockStorePensieveEntryUpsert).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledWith(
        expect.stringContaining('Drive sync complete — 0 entries'),
      );
    });
  });
});
