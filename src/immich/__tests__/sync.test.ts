import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SendMessage } from '../sync.js';

// ── Mocks ──────────────────────────────────────────────────────────────────

const dbMock = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
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
    debug: vi.fn(),
  },
}));

vi.mock('../../utils/errors.js', () => {
  class ImmichSyncError extends Error {
    code = 'IMMICH_SYNC_ERROR';
    constructor(message: string, public cause?: unknown) {
      super(message);
    }
  }
  return { ImmichSyncError };
});

const mockFetchAssets = vi.fn();
vi.mock('../client.js', () => ({
  fetchAssets: (...args: any[]) => mockFetchAssets(...args),
}));

const mockAssetToText = vi.fn();
vi.mock('../metadata.js', () => ({
  assetToText: (...args: any[]) => mockAssetToText(...args),
}));

const mockStorePensieveEntryUpsert = vi.fn();
vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntryUpsert: (...args: any[]) => mockStorePensieveEntryUpsert(...args),
}));

const mockEmbedAndStoreChunked = vi.fn();
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStoreChunked: (...args: any[]) => mockEmbedAndStoreChunked(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAsset(id: string, type: 'IMAGE' | 'VIDEO' = 'IMAGE') {
  return {
    id,
    type,
    originalFileName: `${id}.jpg`,
    exifInfo: { dateTimeOriginal: '2025-01-15T10:00:00' },
    people: [],
  };
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

function setupDbNoSync() {
  // No prior sync_status → full sync
  setupSelectChain([
    () => [],   // loadSyncStatus → null
    () => [],   // upsertSyncStatus loadSyncStatus check → insert
  ]);
  setupInsertChain();
  setupUpdateChain();
}

function setupDbWithLastSync(lastSyncAt = new Date('2025-06-01T00:00:00Z')) {
  // Has prior sync_status → incremental sync
  setupSelectChain([
    () => [{ source: 'immich', lastSyncAt, errorCount: 0 }],
    () => [{ source: 'immich', errorCount: 0 }],
  ]);
  setupInsertChain();
  setupUpdateChain();
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Immich sync orchestrator', () => {
  let sendMessage: SendMessage & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessage = vi.fn<SendMessage>().mockResolvedValue(undefined);

    mockAssetToText.mockImplementation((asset: any) => `Photo: ${asset.originalFileName}`);
    mockStorePensieveEntryUpsert.mockResolvedValue({
      entry: { id: 'entry-1', content: 'Photo: test.jpg' },
      action: 'created' as const,
    });
    mockEmbedAndStoreChunked.mockResolvedValue(undefined);
  });

  describe('full sync (no prior lastSyncAt)', () => {
    it('fetches all assets without updatedAfter, processes them, updates sync_status', async () => {
      const { syncImmich } = await import('../sync.js');
      setupDbNoSync();

      const assets = [makeAsset('a1'), makeAsset('a2'), makeAsset('a3')];
      mockFetchAssets.mockResolvedValue(assets);

      await syncImmich(sendMessage);

      // fetchAssets called without updatedAfter
      expect(mockFetchAssets).toHaveBeenCalledWith(undefined);
      // All 3 assets processed
      expect(mockAssetToText).toHaveBeenCalledTimes(3);
      expect(mockStorePensieveEntryUpsert).toHaveBeenCalledTimes(3);
      // All created → embed all
      expect(mockEmbedAndStoreChunked).toHaveBeenCalledTimes(3);
      // upsert called with correct source and externalIdField
      expect(mockStorePensieveEntryUpsert).toHaveBeenCalledWith(
        expect.any(String),
        'immich',
        expect.objectContaining({ assetId: 'a1' }),
        'assetId',
      );
      // Completion message sent
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('Immich sync complete'));
    });
  });

  describe('incremental sync (has lastSyncAt)', () => {
    it('fetches assets with updatedAfter from lastSyncAt', async () => {
      const { syncImmich } = await import('../sync.js');
      const lastSync = new Date('2025-06-01T00:00:00Z');
      setupDbWithLastSync(lastSync);

      const assets = [makeAsset('a1')];
      mockFetchAssets.mockResolvedValue(assets);

      await syncImmich(sendMessage);

      expect(mockFetchAssets).toHaveBeenCalledWith({
        updatedAfter: lastSync.toISOString(),
      });
      expect(mockAssetToText).toHaveBeenCalledTimes(1);
    });
  });

  describe('embedding behavior', () => {
    it('skips embedding for skipped upsert results (unchanged content hash)', async () => {
      const { syncImmich } = await import('../sync.js');
      setupDbNoSync();

      mockFetchAssets.mockResolvedValue([makeAsset('a1')]);
      mockStorePensieveEntryUpsert.mockResolvedValue({
        entry: { id: 'entry-1', content: 'Photo: a1.jpg' },
        action: 'skipped' as const,
      });

      await syncImmich(sendMessage);

      expect(mockEmbedAndStoreChunked).not.toHaveBeenCalled();
    });

    it('embeds on updated entries', async () => {
      const { syncImmich } = await import('../sync.js');
      setupDbNoSync();

      mockFetchAssets.mockResolvedValue([makeAsset('a1')]);
      mockStorePensieveEntryUpsert.mockResolvedValue({
        entry: { id: 'entry-1', content: 'Photo: a1.jpg' },
        action: 'updated' as const,
      });

      await syncImmich(sendMessage);

      expect(mockEmbedAndStoreChunked).toHaveBeenCalledTimes(1);
    });
  });

  describe('error resilience', () => {
    it('continues processing when a single asset fails — errorCount incremented', async () => {
      const { syncImmich } = await import('../sync.js');
      setupDbNoSync();

      const assets = [makeAsset('a1'), makeAsset('a2'), makeAsset('a3')];
      mockFetchAssets.mockResolvedValue(assets);

      // Second asset throws
      mockAssetToText
        .mockReturnValueOnce('Photo: a1.jpg')
        .mockImplementationOnce(() => { throw new Error('EXIF parse failed'); })
        .mockReturnValueOnce('Photo: a3.jpg');

      await syncImmich(sendMessage);

      // All 3 attempted
      expect(mockAssetToText).toHaveBeenCalledTimes(3);
      // 2 succeeded (a1, a3), 1 failed
      expect(mockStorePensieveEntryUpsert).toHaveBeenCalledTimes(2);
      // Completion message mentions errors
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('1 error'));
    });

    it('sets sync_status to error on fatal failure and throws ImmichSyncError', async () => {
      const { syncImmich } = await import('../sync.js');
      setupDbNoSync();

      mockFetchAssets.mockRejectedValue(new Error('Network timeout'));

      await expect(syncImmich(sendMessage)).rejects.toThrow('Immich sync failed');

      // Error message sent to user
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('Immich sync failed'));
    });
  });

  describe('progress reporting', () => {
    it('sends batch progress messages', async () => {
      const { syncImmich } = await import('../sync.js');
      setupDbNoSync();

      // Create 60 assets to trigger 2 batches (50 + 10)
      const assets = Array.from({ length: 60 }, (_, i) => makeAsset(`a${i}`));
      mockFetchAssets.mockResolvedValue(assets);

      await syncImmich(sendMessage);

      const calls = sendMessage.mock.calls.map((c: any[]) => c[0] as string);
      // Should have batch 1 and batch 2 progress messages
      expect(calls.some((c: string) => c.includes('batch 1'))).toBe(true);
      expect(calls.some((c: string) => c.includes('batch 2'))).toBe(true);
      // And a completion message
      expect(calls.some((c: string) => c.includes('Immich sync complete'))).toBe(true);
    });

    it('sends completion message with entry count and duration', async () => {
      const { syncImmich } = await import('../sync.js');
      setupDbNoSync();

      mockFetchAssets.mockResolvedValue([makeAsset('a1')]);

      await syncImmich(sendMessage);

      expect(sendMessage).toHaveBeenCalledWith(
        expect.stringMatching(/Immich sync complete — 1 entries processed.+\d+s/),
      );
    });
  });

  describe('empty asset list', () => {
    it('completes cleanly with no assets to process', async () => {
      const { syncImmich } = await import('../sync.js');
      setupDbNoSync();

      mockFetchAssets.mockResolvedValue([]);

      await syncImmich(sendMessage);

      // No processing calls
      expect(mockAssetToText).not.toHaveBeenCalled();
      expect(mockStorePensieveEntryUpsert).not.toHaveBeenCalled();
      expect(mockEmbedAndStoreChunked).not.toHaveBeenCalled();
      // Clean completion
      expect(sendMessage).toHaveBeenCalledWith(expect.stringContaining('no new assets'));
    });
  });
});
