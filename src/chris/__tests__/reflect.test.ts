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
const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock Anthropic client ──────────────────────────────────────────────────
const mockCreate = vi.fn();

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockCreate },
  },
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  SONNET_MODEL: 'claude-sonnet-4-6',
}));

// ── Mock hybridSearch + getEpisodicSummary + REFLECT_SEARCH_OPTIONS ───────
// Phase 22.1: hybridSearch is still called transitively via retrieveContext
// on raw branches; getEpisodicSummary drives the routing decision for old-
// dated queries.
const mockHybridSearch = vi.fn();
const mockGetEpisodicSummary = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  hybridSearch: mockHybridSearch,
  getEpisodicSummary: mockGetEpisodicSummary,
  REFLECT_SEARCH_OPTIONS: {
    recencyBias: 0.1,
    limit: 15,
  },
}));

// ── Mock extractQueryDate (Phase 22.1) ─────────────────────────────────────
const mockExtractQueryDate = vi.fn();
vi.mock('../modes/date-extraction.js', () => ({
  extractQueryDate: mockExtractQueryDate,
}));

// ── Mock relational memories ───────────────────────────────────────────────
const mockGetRelationalMemories = vi.fn();
vi.mock('../../memory/relational.js', () => ({
  getRelationalMemories: mockGetRelationalMemories,
}));

// ── Mock context builder ───────────────────────────────────────────────────
const mockBuildMessageHistory = vi.fn();
const mockBuildPensieveContext = vi.fn();
const mockBuildRelationalContext = vi.fn();
vi.mock('../../memory/context-builder.js', () => ({
  buildMessageHistory: mockBuildMessageHistory,
  buildPensieveContext: mockBuildPensieveContext,
  buildRelationalContext: mockBuildRelationalContext,
}));

// ── Mock personality ───────────────────────────────────────────────────────
const mockBuildSystemPrompt = vi.fn();
vi.mock('../personality.js', () => ({
  buildSystemPrompt: mockBuildSystemPrompt,
}));

// ── Mock memory/profiles (Phase 35 Plan 35-02 SURF-02 + Phase 39 PSURF-03) ─
// REFLECT is an in-scope mode per PROFILE_INJECTION_MAP + PSYCHOLOGICAL_PROFILE_INJECTION_MAP.
// These mocks let us assert the D-14 + D-13/D-16 call order
// (getOperationalProfiles → formatProfilesForPrompt → getPsychologicalProfiles
// → formatPsychologicalProfilesForPrompt → buildSystemPrompt) and the wire of
// operationalProfiles + psychologicalProfiles into extras without exercising
// the real DB-reading code path.
const mockGetOperationalProfiles = vi.fn();
const mockFormatProfilesForPrompt = vi.fn();
const mockGetPsychologicalProfiles = vi.fn();
const mockFormatPsychologicalProfilesForPrompt = vi.fn();
vi.mock('../../memory/profiles.js', () => ({
  getOperationalProfiles: mockGetOperationalProfiles,
  formatProfilesForPrompt: mockFormatProfilesForPrompt,
  getPsychologicalProfiles: mockGetPsychologicalProfiles,
  formatPsychologicalProfilesForPrompt: mockFormatPsychologicalProfilesForPrompt,
}));

// ── Mock pensieve store (should NOT be called) ─────────────────────────────
const mockStorePensieveEntry = vi.fn();
vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntry: mockStorePensieveEntry,
}));

// ── Mock tagger (should NOT be called) ─────────────────────────────────────
const mockTagEntry = vi.fn();
vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: mockTagEntry,
}));

// ── Mock embeddings (should NOT be called) ─────────────────────────────────
const mockEmbedAndStore = vi.fn();
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: mockEmbedAndStore,
}));

// ── Import module under test after mocks ───────────────────────────────────
const { handleReflect } = await import('../modes/reflect.js');
const { LLMError } = await import('../../utils/errors.js');
const { REFLECT_SYSTEM_PROMPT } = await import('../../llm/prompts.js');
const { REFLECT_SEARCH_OPTIONS } = await import('../../pensieve/retrieve.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;
const TEST_QUERY = 'What are my recurring fears?';

const MOCK_SEARCH_RESULTS = [
  {
    entry: {
      id: 'entry-1',
      content: 'I keep worrying about whether I am good enough',
      createdAt: new Date('2025-01-15'),
      epistemicTag: 'REFLECTION',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.87,
  },
  {
    entry: {
      id: 'entry-2',
      content: 'That fear of rejection came up again today',
      createdAt: new Date('2025-02-10'),
      epistemicTag: 'EXPERIENCE',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.72,
  },
];

const MOCK_RELATIONAL_MEMORIES = [
  {
    id: 'rel-1',
    type: 'PATTERN',
    content: 'John frequently mentions self-doubt around professional performance',
    confidence: 0.85,
    createdAt: new Date('2025-03-01'),
  },
  {
    id: 'rel-2',
    type: 'OBSERVATION',
    content: 'Rejection sensitivity appears across multiple conversations',
    confidence: 0.78,
    createdAt: new Date('2025-03-05'),
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('REFLECT_SYSTEM_PROMPT', () => {
  it('has {relationalContext} placeholder', () => {
    expect(REFLECT_SYSTEM_PROMPT).toContain('{relationalContext}');
  });

  it('enforces citation/provenance instructions', () => {
    expect(REFLECT_SYSTEM_PROMPT).toMatch(/cite|date/i);
    expect(REFLECT_SYSTEM_PROMPT).toMatch(/ground/i);
  });

  it('enforces no-fabrication instruction', () => {
    expect(REFLECT_SYSTEM_PROMPT).toMatch(/never.*invent/i);
  });

  it('has {pensieveContext} placeholder', () => {
    expect(REFLECT_SYSTEM_PROMPT).toContain('{pensieveContext}');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handleReflect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue(MOCK_SEARCH_RESULTS);
    mockGetEpisodicSummary.mockResolvedValue(null);
    mockExtractQueryDate.mockResolvedValue(null);
    mockGetRelationalMemories.mockResolvedValue(MOCK_RELATIONAL_MEMORIES);
    mockBuildPensieveContext.mockReturnValue(
      '[1] (2025-01-15 | REFLECTION | 0.87) "I keep worrying about whether I am good enough"\n' +
        '[2] (2025-02-10 | EXPERIENCE | 0.72) "That fear of rejection came up again today"',
    );
    mockBuildRelationalContext.mockReturnValue(
      '[1] (2025-03-01 | PATTERN | 0.85) "John frequently mentions self-doubt around professional performance"\n' +
        '[2] (2025-03-05 | OBSERVATION | 0.78) "Rejection sensitivity appears across multiple conversations"',
    );
    mockBuildMessageHistory.mockResolvedValue([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ]);
    mockBuildSystemPrompt.mockReturnValue('interpolated reflect system prompt');
    mockGetOperationalProfiles.mockResolvedValue({
      jurisdictional: null,
      capital: null,
      health: null,
      family: null,
    });
    mockFormatProfilesForPrompt.mockReturnValue(
      '## Operational Profile (grounded context — not interpretation)\n\nfake-rendered-profile',
    );
    // Phase 39 PSURF-03 — sane defaults so existing REFLECT tests don't
    // need to set these per-case. Empty-string return means "no psych
    // section to render" per D-05; personality.ts drops it cleanly.
    mockGetPsychologicalProfiles.mockResolvedValue({
      hexaco: null,
      schwartz: null,
      attachment: null,
    });
    mockFormatPsychologicalProfilesForPrompt.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse('I notice a recurring theme of self-doubt in your entries.'),
    );
  });

  it('calls hybridSearch with the user text and REFLECT_SEARCH_OPTIONS (via retrieveContext)', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockHybridSearch).toHaveBeenCalledWith(
      TEST_QUERY,
      expect.objectContaining(REFLECT_SEARCH_OPTIONS),
    );
  });

  it('calls getRelationalMemories with { limit: 20 }', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockGetRelationalMemories).toHaveBeenCalledWith({ limit: 20 });
  });

  it('passes search results to buildPensieveContext', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockBuildPensieveContext).toHaveBeenCalledWith(MOCK_SEARCH_RESULTS);
  });

  it('passes relational memories to buildRelationalContext', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockBuildRelationalContext).toHaveBeenCalledWith(MOCK_RELATIONAL_MEMORIES);
  });

  it('builds system prompt with REFLECT mode, pensieve context, and relational context', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'REFLECT',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ language: undefined, declinedTopics: undefined }),
    );
  });

  it('calls getOperationalProfiles + formatProfilesForPrompt + passes operationalProfiles via extras (Phase 35 SURF-02, D-14)', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);
    expect(mockGetOperationalProfiles).toHaveBeenCalledTimes(1);
    expect(mockFormatProfilesForPrompt).toHaveBeenCalledWith(
      expect.any(Object),
      'REFLECT',
    );
    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'REFLECT',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        operationalProfiles: expect.stringContaining('Operational Profile'),
      }),
    );
  });

  it('calls Sonnet with max_tokens 1500, system prompt, history + current message', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: 'interpolated reflect system prompt',
          }),
        ]),
        messages: [
          { role: 'user', content: 'previous question' },
          { role: 'assistant', content: 'previous answer' },
          { role: 'user', content: TEST_QUERY },
        ],
      }),
    );
  });

  it('returns Sonnet response text', async () => {
    const result = await handleReflect(CHAT_ID, TEST_QUERY);

    expect(result).toBe('I notice a recurring theme of self-doubt in your entries.');
  });

  it('does NOT call storePensieveEntry', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('does NOT call tagEntry', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockTagEntry).not.toHaveBeenCalled();
  });

  it('does NOT call embedAndStore', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });

  it('handles empty search results gracefully', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');

    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have enough conversations to spot patterns yet."),
    );

    const result = await handleReflect(CHAT_ID, TEST_QUERY);

    expect(result).toBe("I don't have enough conversations to spot patterns yet.");
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([]);
  });

  it('handles empty relational memories gracefully', async () => {
    mockGetRelationalMemories.mockResolvedValue([]);
    mockBuildRelationalContext.mockReturnValue('No observations accumulated yet.');

    const result = await handleReflect(CHAT_ID, TEST_QUERY);

    expect(result).toBe('I notice a recurring theme of self-doubt in your entries.');
    expect(mockBuildRelationalContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.reflect.empty when no results pass threshold', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have enough conversations to spot patterns yet."),
    );

    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        query: TEST_QUERY.slice(0, 50),
      }),
      'chris.reflect.empty',
    );
  });

  it('logs chris.reflect.response on success with chatId, resultCount, relationalCount, latencyMs', async () => {
    await handleReflect(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        resultCount: expect.any(Number),
        relationalCount: expect.any(Number),
        latencyMs: expect.any(Number),
      }),
      'chris.reflect.response',
    );
  });

  it('logs chris.reflect.error on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleReflect(CHAT_ID, TEST_QUERY)).rejects.toThrow();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: 'Sonnet unavailable',
        latencyMs: expect.any(Number),
      }),
      'chris.reflect.error',
    );
  });

  it('throws LLMError on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleReflect(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('throws LLMError when response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] });

    await expect(handleReflect(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('re-throws LLMError directly (not double-wrapped)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'image', source: {} }] });

    try {
      await handleReflect(CHAT_ID, TEST_QUERY);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as Error).message).toBe('No text block in Sonnet response');
    }
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
    mockGetRelationalMemories.mockResolvedValue([]);
    mockBuildRelationalContext.mockReturnValue('');
    mockBuildPensieveContext.mockImplementation((results: { entry: { content: string } }[]) =>
      results.map((r) => r.entry.content).join('\n'),
    );
    mockBuildMessageHistory.mockResolvedValue([]);
    mockBuildSystemPrompt.mockReturnValue('interpolated');
    mockCreate.mockResolvedValue(makeLLMResponse('Mocked'));
  });

  it('recent query (queryDate 3d ago) routes to raw via hybridSearch — getEpisodicSummary NOT called', async () => {
    mockExtractQueryDate.mockResolvedValue(new Date(Date.now() - 3 * 86_400_000));
    await handleReflect(CHAT_ID, TEST_QUERY);
    expect(mockHybridSearch).toHaveBeenCalledWith(
      TEST_QUERY,
      expect.objectContaining(REFLECT_SEARCH_OPTIONS),
    );
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
  });

  it('old query (queryDate 30d ago) escalates to summary tier — buildPensieveContext first arg carries the synthetic summary result', async () => {
    mockExtractQueryDate.mockResolvedValue(new Date(Date.now() - 30 * 86_400_000));
    mockGetEpisodicSummary.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      summaryDate: '2026-03-15',
      summary: 'reflective summary content about recurring fears',
      importance: 5,
      topics: ['fear'],
      emotionalArc: 'reflective',
      keyQuotes: [],
      sourceEntryIds: [],
      createdAt: new Date(),
    });
    await handleReflect(CHAT_ID, 'what were my recurring fears on March 15');
    const buildCall = mockBuildPensieveContext.mock.calls[0]![0];
    expect(buildCall[0].entry.content).toContain('[Episode Summary 2026-03-15');
    expect(buildCall[0].entry.content).toContain('reflective summary content');
    expect(buildCall[0].score).toBe(1.0);
    expect(mockGetEpisodicSummary).toHaveBeenCalled();
  });

  it('verbatim keyword query 30d ago overrides recency — getEpisodicSummary NOT called', async () => {
    mockExtractQueryDate.mockResolvedValue(new Date(Date.now() - 30 * 86_400_000));
    await handleReflect(CHAT_ID, 'what exactly did I say about my fears');
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
    expect(mockHybridSearch).toHaveBeenCalled();
  });
});
