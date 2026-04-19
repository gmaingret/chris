import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db (needed by transitive imports) ─────────────────────────────────
vi.mock('../../db/connection.js', () => ({
  db: {
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn() })) })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn() })),
        })),
      })),
    })),
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Mock Anthropic client ──────────────────────────────────────────────────
const mockCreate = vi.fn();
vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockCreate } },
  SONNET_MODEL: 'claude-sonnet-4-6',
}));

// ── Mock pensieve store ────────────────────────────────────────────────────
vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntry: vi.fn().mockResolvedValue({ id: 'test-entry-id' }),
}));

// ── Mock tagger ────────────────────────────────────────────────────────────
vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: vi.fn(),
}));

// ── Mock embeddings ────────────────────────────────────────────────────────
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: vi.fn(),
}));

// ── Mock hybridSearch + getEpisodicSummary ─────────────────────────────────
// hybridSearch is still called transitively by retrieveContext on raw
// branches; getEpisodicSummary is the routing decision driver for old-dated
// queries (Phase 22.1 wiring).
const mockHybridSearch = vi.fn();
const mockGetEpisodicSummary = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  hybridSearch: (...args: unknown[]) => mockHybridSearch(...args),
  getEpisodicSummary: (...args: unknown[]) => mockGetEpisodicSummary(...args),
  JOURNAL_SEARCH_OPTIONS: {
    tags: ['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE'],
    recencyBias: 0.3,
    limit: 10,
  },
}));

// ── Mock extractQueryDate (Phase 22.1) ─────────────────────────────────────
const mockExtractQueryDate = vi.fn();
vi.mock('../modes/date-extraction.js', () => ({
  extractQueryDate: (...args: unknown[]) => mockExtractQueryDate(...args),
}));

// ── Mock context builder ───────────────────────────────────────────────────
const mockBuildPensieveContext = vi.fn();
const mockBuildMessageHistory = vi.fn();
vi.mock('../../memory/context-builder.js', () => ({
  buildPensieveContext: (...args: unknown[]) => mockBuildPensieveContext(...args),
  buildMessageHistory: (...args: unknown[]) => mockBuildMessageHistory(...args),
}));

// ── Import after mocks ─────────────────────────────────────────────────────
const { handleJournal } = await import('../modes/journal.js');
const { JOURNAL_SEARCH_OPTIONS } = await import('../../pensieve/retrieve.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('JOURNAL hybrid retrieval (RETR-01)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue([]);
    mockGetEpisodicSummary.mockResolvedValue(null);
    mockExtractQueryDate.mockResolvedValue(null);
    mockBuildPensieveContext.mockReturnValue('');
    mockBuildMessageHistory.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeLLMResponse('Mocked journal response'));
  });

  it('calls hybridSearch with user text and JOURNAL_SEARCH_OPTIONS (via retrieveContext)', async () => {
    await handleJournal(CHAT_ID, 'I moved to Batumi');
    expect(mockHybridSearch).toHaveBeenCalledWith(
      'I moved to Batumi',
      expect.objectContaining(JOURNAL_SEARCH_OPTIONS),
    );
  });

  it('calls buildPensieveContext with hybridSearch results', async () => {
    const fakeResults = [{ entry: { id: '1', content: 'test' }, score: 0.9 }];
    mockHybridSearch.mockResolvedValue(fakeResults);
    await handleJournal(CHAT_ID, 'test message');
    expect(mockBuildPensieveContext).toHaveBeenCalledWith(fakeResults, { includeDate: false });
  });

  it('passes pensieveContext (not undefined) to buildSystemPrompt via Sonnet call', async () => {
    mockBuildPensieveContext.mockReturnValue('formatted context here');
    await handleJournal(CHAT_ID, 'test');
    const createCall = mockCreate.mock.calls[0][0];
    const systemText = createCall.system[0].text;
    expect(systemText).toContain('formatted context here');
    expect(systemText).not.toContain('{pensieveContext}');
  });

  it('runs retrieval on every message — no selective triggering (D-10)', async () => {
    await handleJournal(CHAT_ID, 'hello');
    await handleJournal(CHAT_ID, 'how are you');
    expect(mockHybridSearch).toHaveBeenCalledTimes(2);
  });

  it('passes empty-string pensieveContext when hybridSearch returns empty array', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    await handleJournal(CHAT_ID, 'test');
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([], { includeDate: false });
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 22.1 — RETR-02/03 routing wiring regression coverage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('RETR-02/03 routing wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue([]);
    mockGetEpisodicSummary.mockResolvedValue(null);
    mockExtractQueryDate.mockResolvedValue(null);
    // Pass-through: surface synthetic summary content into the system prompt
    // so old-query test can assert on the [Episode Summary marker.
    mockBuildPensieveContext.mockImplementation((results: { entry: { content: string } }[]) =>
      results.map((r) => r.entry.content).join('\n'),
    );
    mockBuildMessageHistory.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeLLMResponse('Mocked'));
  });

  it('recent query (queryDate 3d ago) routes to raw via hybridSearch — getEpisodicSummary NOT called', async () => {
    mockExtractQueryDate.mockResolvedValue(new Date(Date.now() - 3 * 86_400_000));
    await handleJournal(CHAT_ID, 'tell me about my recent thoughts');
    expect(mockHybridSearch).toHaveBeenCalledWith(
      'tell me about my recent thoughts',
      expect.objectContaining(JOURNAL_SEARCH_OPTIONS),
    );
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
  });

  it('old query (queryDate 30d ago) escalates to summary tier — system prompt contains [Episode Summary marker', async () => {
    mockExtractQueryDate.mockResolvedValue(new Date(Date.now() - 30 * 86_400_000));
    mockGetEpisodicSummary.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      summaryDate: '2026-03-15',
      summary: 'Greg moved to Batumi and reflected on relocation',
      importance: 5,
      topics: ['relocation'],
      emotionalArc: 'reflective',
      keyQuotes: [],
      sourceEntryIds: [],
      createdAt: new Date(),
    });
    await handleJournal(CHAT_ID, 'what happened on March 15 last month');
    const createCall = mockCreate.mock.calls[0]![0];
    const systemText = createCall.system[0].text;
    expect(systemText).toContain('[Episode Summary 2026-03-15');
    expect(systemText).toContain('Greg moved to Batumi');
    expect(mockGetEpisodicSummary).toHaveBeenCalled();
  });

  it('verbatim keyword query 30d ago overrides recency — getEpisodicSummary NOT called', async () => {
    mockExtractQueryDate.mockResolvedValue(new Date(Date.now() - 30 * 86_400_000));
    await handleJournal(CHAT_ID, 'what exactly did I say about Batumi');
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
    expect(mockHybridSearch).toHaveBeenCalled();
  });
});

describe('JOURNAL hallucination resistance (RETR-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue([]);
    mockGetEpisodicSummary.mockResolvedValue(null);
    mockExtractQueryDate.mockResolvedValue(null);
    mockBuildPensieveContext.mockReturnValue('');
    mockBuildMessageHistory.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeLLMResponse('Mocked response'));
  });

  it('when no results found, system prompt contains fallback text', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    await handleJournal(CHAT_ID, 'Where do I live?');
    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.system[0].text).toContain('No relevant memories found');
  });
});

describe('end-to-end prompt assembly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue([]);
    mockGetEpisodicSummary.mockResolvedValue(null);
    mockExtractQueryDate.mockResolvedValue(null);
    mockBuildPensieveContext.mockReturnValue('');
    mockBuildMessageHistory.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeLLMResponse('Mocked response'));
  });

  it('system prompt contains Known Facts block, pensieveContext, and hallucination resistance', async () => {
    mockBuildPensieveContext.mockReturnValue('[1] (2026-04-01 | FACT | 0.85) "Greg lives in Saint Petersburg"');
    await handleJournal(CHAT_ID, 'Where do I live?');
    const createCall = mockCreate.mock.calls[0][0];
    const system = createCall.system[0].text;
    // Known Facts block present (from buildKnownFactsBlock)
    expect(system).toContain('Facts about you (Greg)');
    // PensieveContext replaced (not literal placeholder)
    expect(system).toContain('Greg lives in Saint Petersburg');
    expect(system).not.toContain('{pensieveContext}');
    // Hallucination resistance present
    expect(system).toContain("I don't have any memories about that");
  });
});
