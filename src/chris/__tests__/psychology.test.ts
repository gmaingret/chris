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
  OPUS_MODEL: 'claude-opus-4-6',
}));

// ── Mock hybridSearch + getEpisodicSummary + PSYCHOLOGY_SEARCH_OPTIONS ────
// Phase 22.1: hybridSearch still called transitively via retrieveContext on
// raw branches; getEpisodicSummary drives old-dated query routing.
const mockHybridSearch = vi.fn();
const mockGetEpisodicSummary = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  hybridSearch: mockHybridSearch,
  getEpisodicSummary: mockGetEpisodicSummary,
  PSYCHOLOGY_SEARCH_OPTIONS: {
    recencyBias: 0.2,
    limit: 15,
    tags: ['EMOTION', 'FEAR', 'BELIEF', 'DREAM'],
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
// PSYCHOLOGY is in-scope per both PROFILE_INJECTION_MAP and
// PSYCHOLOGICAL_PROFILE_INJECTION_MAP — mocks the full D-14 + D-13/D-16 chain.
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
const { handlePsychology } = await import('../modes/psychology.js');
const { LLMError } = await import('../../utils/errors.js');
const { PSYCHOLOGY_SYSTEM_PROMPT } = await import('../../llm/prompts.js');
const { PSYCHOLOGY_SEARCH_OPTIONS } = await import('../../pensieve/retrieve.js');
const { buildSystemPrompt: realBuildSystemPrompt } = await import('../personality.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;
const TEST_QUERY = 'Why do I always self-sabotage when things are going well?';

const MOCK_SEARCH_RESULTS = [
  {
    entry: {
      id: 'entry-1',
      content: 'I feel terrified when good things happen — like I\'m waiting for the other shoe to drop',
      createdAt: new Date('2025-01-15'),
      epistemicTag: 'EMOTION',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.91,
  },
  {
    entry: {
      id: 'entry-2',
      content: 'I had a dream where I was climbing a mountain and kept letting go of the rope on purpose',
      createdAt: new Date('2025-02-10'),
      epistemicTag: 'DREAM',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.76,
  },
];

const MOCK_RELATIONAL_MEMORIES = [
  {
    id: 'rel-1',
    type: 'PATTERN',
    content: 'John reports anxiety spikes immediately after positive events or achievements',
    confidence: 0.88,
    createdAt: new Date('2025-03-01'),
  },
  {
    id: 'rel-2',
    type: 'INSIGHT',
    content: 'Self-sabotage pattern may be linked to early experiences where success was followed by loss',
    confidence: 0.72,
    createdAt: new Date('2025-03-05'),
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('PSYCHOLOGY_SYSTEM_PROMPT', () => {
  it('has {pensieveContext} placeholder', () => {
    expect(PSYCHOLOGY_SYSTEM_PROMPT).toContain('{pensieveContext}');
  });

  it('has {relationalContext} placeholder', () => {
    expect(PSYCHOLOGY_SYSTEM_PROMPT).toContain('{relationalContext}');
  });
});

describe('buildSystemPrompt interpolates for PSYCHOLOGY', () => {
  it('replaces {pensieveContext} and {relationalContext} placeholders', () => {
    const result = PSYCHOLOGY_SYSTEM_PROMPT
      .replace('{pensieveContext}', 'some pensieve data')
      .replace('{relationalContext}', 'some relational data');

    expect(result).toContain('some pensieve data');
    expect(result).toContain('some relational data');
    expect(result).not.toContain('{pensieveContext}');
    expect(result).not.toContain('{relationalContext}');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handlePsychology', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue(MOCK_SEARCH_RESULTS);
    mockGetEpisodicSummary.mockResolvedValue(null);
    mockExtractQueryDate.mockResolvedValue(null);
    mockGetRelationalMemories.mockResolvedValue(MOCK_RELATIONAL_MEMORIES);
    mockBuildPensieveContext.mockReturnValue(
      '[1] (2025-01-15 | EMOTION | 0.91) "I feel terrified when good things happen — like I\'m waiting for the other shoe to drop"\n' +
        '[2] (2025-02-10 | DREAM | 0.76) "I had a dream where I was climbing a mountain and kept letting go of the rope on purpose"',
    );
    mockBuildRelationalContext.mockReturnValue(
      '[1] (2025-03-01 | PATTERN | 0.88) "John reports anxiety spikes immediately after positive events or achievements"\n' +
        '[2] (2025-03-05 | INSIGHT | 0.72) "Self-sabotage pattern may be linked to early experiences where success was followed by loss"',
    );
    mockBuildMessageHistory.mockResolvedValue([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ]);
    mockBuildSystemPrompt.mockReturnValue('interpolated psychology system prompt');
    mockGetOperationalProfiles.mockResolvedValue({
      jurisdictional: null,
      capital: null,
      health: null,
      family: null,
    });
    mockFormatProfilesForPrompt.mockReturnValue(
      '## Operational Profile (grounded context — not interpretation)\n\nfake-rendered-profile',
    );
    // Phase 39 PSURF-03 — sane defaults so existing PSYCHOLOGY tests don't
    // need per-case setup. Empty-string return == "no psych section to
    // render" per D-05; personality.ts drops it cleanly via .filter(Boolean).
    mockGetPsychologicalProfiles.mockResolvedValue({
      hexaco: null,
      schwartz: null,
      attachment: null,
    });
    mockFormatPsychologicalProfilesForPrompt.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse('This pattern of self-sabotage when things go well looks like a classic fear of success rooted in anxious attachment...'),
    );
  });

  it('calls hybridSearch with the user text and PSYCHOLOGY_SEARCH_OPTIONS (via retrieveContext)', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockHybridSearch).toHaveBeenCalledWith(
      TEST_QUERY,
      expect.objectContaining(PSYCHOLOGY_SEARCH_OPTIONS),
    );
  });

  it('calls getRelationalMemories with { limit: 20 }', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockGetRelationalMemories).toHaveBeenCalledWith({ limit: 20 });
  });

  it('passes search results to buildPensieveContext', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockBuildPensieveContext).toHaveBeenCalledWith(MOCK_SEARCH_RESULTS);
  });

  it('passes relational memories to buildRelationalContext', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockBuildRelationalContext).toHaveBeenCalledWith(MOCK_RELATIONAL_MEMORIES);
  });

  it('builds system prompt with PSYCHOLOGY mode, pensieve context, and relational context', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'PSYCHOLOGY',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ language: undefined, declinedTopics: undefined }),
    );
  });

  it('calls getOperationalProfiles + formatProfilesForPrompt + passes operationalProfiles via extras (Phase 35 SURF-02, D-14)', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);
    expect(mockGetOperationalProfiles).toHaveBeenCalledTimes(1);
    expect(mockFormatProfilesForPrompt).toHaveBeenCalledWith(
      expect.any(Object),
      'PSYCHOLOGY',
    );
    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'PSYCHOLOGY',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        operationalProfiles: expect.stringContaining('Operational Profile'),
      }),
    );
  });

  it('calls Opus with max_tokens 2500, system prompt, history + current message', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-6',
        max_tokens: 2500,
        system: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: 'interpolated psychology system prompt',
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

  it('returns Opus response text', async () => {
    const result = await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(result).toBe('This pattern of self-sabotage when things go well looks like a classic fear of success rooted in anxious attachment...');
  });

  it('does NOT call storePensieveEntry', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('does NOT call tagEntry', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockTagEntry).not.toHaveBeenCalled();
  });

  it('does NOT call embedAndStore', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });

  it('handles empty search results gracefully', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');

    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have enough of your history to do a meaningful psychological analysis on this yet."),
    );

    const result = await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(result).toBe("I don't have enough of your history to do a meaningful psychological analysis on this yet.");
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.psychology.empty when search results are empty', async () => {
    mockHybridSearch.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have enough of your history yet."),
    );

    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        query: TEST_QUERY.slice(0, 50),
      }),
      'chris.psychology.empty',
    );
  });

  it('handles empty relational memories gracefully', async () => {
    mockGetRelationalMemories.mockResolvedValue([]);
    mockBuildRelationalContext.mockReturnValue('No observations accumulated yet.');

    const result = await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(result).toBe('This pattern of self-sabotage when things go well looks like a classic fear of success rooted in anxious attachment...');
    expect(mockBuildRelationalContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.psychology.response on success with chatId, resultCount, relationalCount, latencyMs', async () => {
    await handlePsychology(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        resultCount: expect.any(Number),
        relationalCount: expect.any(Number),
        latencyMs: expect.any(Number),
      }),
      'chris.psychology.response',
    );
  });

  it('logs chris.psychology.error on Opus failure', async () => {
    mockCreate.mockRejectedValue(new Error('Opus unavailable'));

    await expect(handlePsychology(CHAT_ID, TEST_QUERY)).rejects.toThrow();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: 'Opus unavailable',
        latencyMs: expect.any(Number),
      }),
      'chris.psychology.error',
    );
  });

  it('throws LLMError on Opus failure', async () => {
    mockCreate.mockRejectedValue(new Error('Opus unavailable'));

    await expect(handlePsychology(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('throws LLMError when response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] });

    await expect(handlePsychology(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('re-throws LLMError directly (not double-wrapped)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'image', source: {} }] });

    try {
      await handlePsychology(CHAT_ID, TEST_QUERY);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as Error).message).toBe('No text block in Opus response');
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
    await handlePsychology(CHAT_ID, TEST_QUERY);
    expect(mockHybridSearch).toHaveBeenCalledWith(
      TEST_QUERY,
      expect.objectContaining(PSYCHOLOGY_SEARCH_OPTIONS),
    );
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
  });

  it('old query (queryDate 30d ago) escalates to summary tier — buildPensieveContext first arg carries synthetic summary result', async () => {
    mockExtractQueryDate.mockResolvedValue(new Date(Date.now() - 30 * 86_400_000));
    mockGetEpisodicSummary.mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      summaryDate: '2026-03-15',
      summary: 'psychology summary content about self-sabotage patterns',
      importance: 5,
      topics: ['self-sabotage'],
      emotionalArc: 'anxious',
      keyQuotes: [],
      sourceEntryIds: [],
      createdAt: new Date(),
    });
    await handlePsychology(CHAT_ID, 'what did I feel on March 15 about success');
    const buildCall = mockBuildPensieveContext.mock.calls[0]![0];
    expect(buildCall[0].entry.content).toContain('[Episode Summary 2026-03-15');
    expect(buildCall[0].entry.content).toContain('psychology summary content');
    expect(buildCall[0].score).toBe(1.0);
    expect(mockGetEpisodicSummary).toHaveBeenCalled();
  });

  it('verbatim keyword query 30d ago overrides recency — getEpisodicSummary NOT called', async () => {
    mockExtractQueryDate.mockResolvedValue(new Date(Date.now() - 30 * 86_400_000));
    await handlePsychology(CHAT_ID, 'what exactly did I feel about my fears');
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
    expect(mockHybridSearch).toHaveBeenCalled();
  });
});
