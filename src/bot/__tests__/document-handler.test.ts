import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (K001) ──────────────────────────────────────────────────
const {
  mockExtractText,
  mockStorePensieveEntryDedup,
  mockEmbedAndStoreChunked,
  mockChunkText,
  mockLogInfo,
  mockLogError,
} = vi.hoisted(() => ({
  mockExtractText: vi.fn(),
  mockStorePensieveEntryDedup: vi.fn(),
  mockEmbedAndStoreChunked: vi.fn(),
  mockChunkText: vi.fn(),
  mockLogInfo: vi.fn(),
  mockLogError: vi.fn(),
}));

// ── Mocks ──────────────────────────────────────────────────────────────────
vi.mock('../../config.js', () => ({
  config: { telegramBotToken: 'test-bot-token' },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLogInfo,
    error: mockLogError,
    warn: vi.fn(),
  },
}));

vi.mock('../../utils/file-extract.js', () => ({
  extractText: mockExtractText,
}));

vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntryDedup: mockStorePensieveEntryDedup,
}));

vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStoreChunked: mockEmbedAndStoreChunked,
  chunkText: mockChunkText,
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Import after mocks ────────────────────────────────────────────────────
const { handleDocument } = await import('../handlers/document.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function createMockCtx(overrides?: Partial<{
  file_name: string;
  mime_type: string;
  file_path: string;
}>) {
  return {
    chat: { id: 12345 },
    from: { id: 67890 },
    message: {
      document: {
        file_id: 'test-file-id',
        file_name: overrides?.file_name ?? 'report.pdf',
        mime_type: overrides?.mime_type ?? 'application/pdf',
      },
    },
    getFile: vi.fn().mockResolvedValue({
      file_path: overrides?.file_path ?? 'documents/file_0.pdf',
    }),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('document handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads file, extracts text, stores with dedup, embeds, and replies', async () => {
    const ctx = createMockCtx();
    const pdfText = 'This is extracted PDF text about machine learning.';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });
    mockExtractText.mockResolvedValueOnce({ text: pdfText, pageCount: 5 });
    mockStorePensieveEntryDedup.mockResolvedValueOnce({
      id: 'entry-123',
      content: pdfText,
    });
    mockEmbedAndStoreChunked.mockResolvedValueOnce(undefined);
    mockChunkText.mockReturnValueOnce(['chunk1']);

    await handleDocument(ctx);

    // Verify file download URL construction
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/file/bottest-bot-token/documents/file_0.pdf',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // Verify extraction called with buffer and MIME type
    expect(mockExtractText).toHaveBeenCalledWith(
      expect.any(Buffer),
      'application/pdf',
    );

    // Verify store uses dedup and source 'telegram_file'
    expect(mockStorePensieveEntryDedup).toHaveBeenCalledWith(
      pdfText,
      'telegram_file',
      expect.objectContaining({
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        telegramFileId: 'test-file-id',
        telegramChatId: 12345,
        pageCount: 5,
      }),
    );

    // Verify chunked embedding
    expect(mockEmbedAndStoreChunked).toHaveBeenCalledWith('entry-123', pdfText);

    // Verify confirmation reply includes file name
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('report.pdf'),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('5 pages'),
    );

    // Verify observability log
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'report.pdf',
        mimeType: 'application/pdf',
        extractedLength: pdfText.length,
        entryId: 'entry-123',
      }),
      'bot.document',
    );
  });

  it('handles plain text files', async () => {
    const ctx = createMockCtx({ file_name: 'notes.txt', mime_type: 'text/plain' });
    const textContent = 'My plain text notes';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(50)),
    });
    mockExtractText.mockResolvedValueOnce({ text: textContent });
    mockStorePensieveEntryDedup.mockResolvedValueOnce({
      id: 'entry-456',
      content: textContent,
    });
    mockEmbedAndStoreChunked.mockResolvedValueOnce(undefined);
    mockChunkText.mockReturnValueOnce(['chunk1']);

    await handleDocument(ctx);

    expect(mockStorePensieveEntryDedup).toHaveBeenCalledWith(
      textContent,
      'telegram_file',
      expect.objectContaining({ fileName: 'notes.txt', mimeType: 'text/plain' }),
    );
    // No page count for text files
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('notes.txt'),
    );
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.not.stringContaining('pages'),
    );
  });

  it('replies with error and does not store when extraction fails', async () => {
    const ctx = createMockCtx();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });
    mockExtractText.mockRejectedValueOnce(new Error('corrupt PDF'));

    await handleDocument(ctx);

    // No store or embed calls
    expect(mockStorePensieveEntryDedup).not.toHaveBeenCalled();
    expect(mockEmbedAndStoreChunked).not.toHaveBeenCalled();

    // Error reply to user
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('trouble reading'),
    );

    // Error logged
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'report.pdf' }),
      'bot.document.error',
    );
  });

  it('replies with error when extracted text is empty', async () => {
    const ctx = createMockCtx();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });
    mockExtractText.mockResolvedValueOnce({ text: '   ', pageCount: 1 });

    await handleDocument(ctx);

    expect(mockStorePensieveEntryDedup).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("couldn't find any text"),
    );
  });

  it('replies with error when Telegram provides no file_path', async () => {
    const ctx = createMockCtx();
    ctx.getFile = vi.fn().mockResolvedValue({});

    await handleDocument(ctx);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStorePensieveEntryDedup).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining("couldn't download"),
    );
  });

  it('uses storePensieveEntryDedup not plain storePensieveEntry', async () => {
    const ctx = createMockCtx();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
    });
    mockExtractText.mockResolvedValueOnce({ text: 'content', pageCount: 1 });
    mockStorePensieveEntryDedup.mockResolvedValueOnce({
      id: 'entry-789',
      content: 'content',
    });
    mockEmbedAndStoreChunked.mockResolvedValueOnce(undefined);
    mockChunkText.mockReturnValueOnce(['chunk1']);

    await handleDocument(ctx);

    // storePensieveEntryDedup must have been called (not the plain version)
    expect(mockStorePensieveEntryDedup).toHaveBeenCalledTimes(1);
    expect(mockStorePensieveEntryDedup).toHaveBeenCalledWith(
      'content',
      'telegram_file',
      expect.any(Object),
    );
  });

  it('handles file download HTTP error', async () => {
    const ctx = createMockCtx();

    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    await handleDocument(ctx);

    expect(mockStorePensieveEntryDedup).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('trouble reading'),
    );
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'report.pdf' }),
      'bot.document.error',
    );
  });
});
