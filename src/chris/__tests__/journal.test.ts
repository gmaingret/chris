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

// ── Mock hybridSearch ──────────────────────────────────────────────────────
const mockHybridSearch = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  hybridSearch: (...args: unknown[]) => mockHybridSearch(...args),
  JOURNAL_SEARCH_OPTIONS: {
    tags: ['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE'],
    recencyBias: 0.3,
    limit: 10,
  },
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
    mockBuildPensieveContext.mockReturnValue('');
    mockBuildMessageHistory.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeLLMResponse('Mocked journal response'));
  });

  it('calls hybridSearch with user text and JOURNAL_SEARCH_OPTIONS', async () => {
    await handleJournal(CHAT_ID, 'I moved to Batumi');
    expect(mockHybridSearch).toHaveBeenCalledWith('I moved to Batumi', JOURNAL_SEARCH_OPTIONS);
  });

  it('calls buildPensieveContext with hybridSearch results', async () => {
    const fakeResults = [{ entry: { id: '1', content: 'test' }, score: 0.9 }];
    mockHybridSearch.mockResolvedValue(fakeResults);
    await handleJournal(CHAT_ID, 'test message');
    expect(mockBuildPensieveContext).toHaveBeenCalledWith(fakeResults);
  });

  it('passes pensieveContext (not undefined) to buildSystemPrompt via Sonnet call', async () => {
    mockBuildPensieveContext.mockReturnValue('formatted context here');
    await handleJournal(CHAT_ID, 'test');
    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.system).toContain('formatted context here');
    expect(createCall.system).not.toContain('{pensieveContext}');
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
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([]);
  });
});

describe('JOURNAL hallucination resistance (RETR-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockBuildMessageHistory.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeLLMResponse('Mocked response'));
  });

  it('when no results found, system prompt contains fallback text', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    await handleJournal(CHAT_ID, 'Where do I live?');
    const createCall = mockCreate.mock.calls[0][0];
    expect(createCall.system).toContain('No relevant memories found');
  });
});

describe('end-to-end prompt assembly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockBuildMessageHistory.mockResolvedValue([]);
    mockCreate.mockResolvedValue(makeLLMResponse('Mocked response'));
  });

  it('system prompt contains Known Facts block, pensieveContext, and hallucination resistance', async () => {
    mockBuildPensieveContext.mockReturnValue('[1] (2026-04-01 | FACT | 0.85) "Greg lives in Saint Petersburg"');
    await handleJournal(CHAT_ID, 'Where do I live?');
    const createCall = mockCreate.mock.calls[0][0];
    const system = createCall.system;
    // Known Facts block present (from buildKnownFactsBlock)
    expect(system).toContain('Known Facts About Greg');
    // PensieveContext replaced (not literal placeholder)
    expect(system).toContain('Greg lives in Saint Petersburg');
    expect(system).not.toContain('{pensieveContext}');
    // Hallucination resistance present
    expect(system).toContain("I don't have any memories about that");
  });
});
