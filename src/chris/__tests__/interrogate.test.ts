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

// ── Mock searchPensieve + getEpisodicSummary ───────────────────────────────
const mockSearchPensieve = vi.fn();
const mockGetEpisodicSummary = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  searchPensieve: mockSearchPensieve,
  getEpisodicSummary: mockGetEpisodicSummary,
}));

// ── Mock date-extraction (Plan 22-03 RETR-04) ──────────────────────────────
const mockExtractQueryDate = vi.fn();
vi.mock('../modes/date-extraction.js', () => ({
  extractQueryDate: mockExtractQueryDate,
}));

// ── Mock context builder ───────────────────────────────────────────────────
const mockBuildMessageHistory = vi.fn();
const mockBuildPensieveContext = vi.fn();
vi.mock('../../memory/context-builder.js', () => ({
  buildMessageHistory: mockBuildMessageHistory,
  buildPensieveContext: mockBuildPensieveContext,
}));

// ── Mock personality ───────────────────────────────────────────────────────
const mockBuildSystemPrompt = vi.fn();
vi.mock('../personality.js', () => ({
  buildSystemPrompt: mockBuildSystemPrompt,
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
const { handleInterrogate } = await import('../modes/interrogate.js');
const { LLMError } = await import('../../utils/errors.js');
const { INTERROGATE_SYSTEM_PROMPT } = await import('../../llm/prompts.js');

// ── Helpers ────────────────────────────────────────────────────────────────
function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const CHAT_ID = 12345n;
const TEST_QUERY = 'Have I ever talked about my childhood?';

const MOCK_SEARCH_RESULTS = [
  {
    entry: {
      id: 'entry-1',
      content: 'I grew up in a small town near the coast',
      createdAt: new Date('2025-01-15'),
      epistemicTag: 'EXPERIENCE',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.87,
  },
  {
    entry: {
      id: 'entry-2',
      content: 'My parents always encouraged me to read',
      createdAt: new Date('2025-02-10'),
      epistemicTag: 'REFLECTION',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.72,
  },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('INTERROGATE_SYSTEM_PROMPT', () => {
  it('enforces citation/provenance instructions (R006)', () => {
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/cite/i);
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/date/i);
  });

  it('enforces no-fabrication instruction (R011)', () => {
    // The prompt contains "Do NOT guess or fabricate" and "NEVER invent details"
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/fabricat/i);
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/never.*invent/i);
  });

  it('enforces uncertainty flagging instruction (R011)', () => {
    // The prompt instructs to flag uncertainty when only weak matches exist
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/uncertain/i);
  });

  it('instructs honest empty-state response', () => {
    expect(INTERROGATE_SYSTEM_PROMPT).toMatch(/don't have any memories/i);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handleInterrogate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchPensieve.mockResolvedValue(MOCK_SEARCH_RESULTS);
    // Plan 22-03 RETR-04: default extractor returns null so existing tests
    // exercise the no-injection path. The new describe block below
    // overrides this per-test for the injection branches.
    mockExtractQueryDate.mockResolvedValue(null);
    mockGetEpisodicSummary.mockResolvedValue(null);
    mockBuildPensieveContext.mockReturnValue(
      '[1] (2025-01-15 | EXPERIENCE | 0.87) "I grew up in a small town near the coast"\n' +
        '[2] (2025-02-10 | REFLECTION | 0.72) "My parents always encouraged me to read"',
    );
    mockBuildMessageHistory.mockResolvedValue([
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ]);
    mockBuildSystemPrompt.mockReturnValue('interpolated system prompt');
    mockCreate.mockResolvedValue(
      makeLLMResponse('Yes, you mentioned growing up near the coast.'),
    );
  });

  it('calls searchPensieve with correct query and limit', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockSearchPensieve).toHaveBeenCalledWith(TEST_QUERY, 10);
  });

  it('passes search results to buildPensieveContext', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockBuildPensieveContext).toHaveBeenCalledWith(MOCK_SEARCH_RESULTS);
  });

  it('builds system prompt with INTERROGATE mode and context', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockBuildSystemPrompt).toHaveBeenCalledWith(
      'INTERROGATE',
      expect.any(String),
      undefined,
      { language: undefined, declinedTopics: undefined },
    );
  });

  it('calls Sonnet with system prompt, history, and current message', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        system: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: 'interpolated system prompt',
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
    const result = await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(result).toBe('Yes, you mentioned growing up near the coast.');
  });

  it('does NOT call storePensieveEntry', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockStorePensieveEntry).not.toHaveBeenCalled();
  });

  it('does NOT call tagEntry', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockTagEntry).not.toHaveBeenCalled();
  });

  it('does NOT call embedAndStore', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockEmbedAndStore).not.toHaveBeenCalled();
  });

  it('handles empty search results gracefully', async () => {
    mockSearchPensieve.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');

    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have any memories about that."),
    );

    const result = await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(result).toBe("I don't have any memories about that.");
    expect(mockBuildPensieveContext).toHaveBeenCalledWith([]);
  });

  it('logs chris.interrogate.empty when no results pass threshold', async () => {
    mockSearchPensieve.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('');
    mockCreate.mockResolvedValue(
      makeLLMResponse("I don't have any memories about that."),
    );

    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        query: TEST_QUERY.slice(0, 50),
      }),
      'chris.interrogate.empty',
    );
  });

  it('logs chris.interrogate.response on success with chatId, resultCount, latencyMs', async () => {
    await handleInterrogate(CHAT_ID, TEST_QUERY);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        resultCount: expect.any(Number),
        latencyMs: expect.any(Number),
      }),
      'chris.interrogate.response',
    );
  });

  it('logs chris.interrogate.error on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleInterrogate(CHAT_ID, TEST_QUERY)).rejects.toThrow();

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        error: 'Sonnet unavailable',
        latencyMs: expect.any(Number),
      }),
      'chris.interrogate.error',
    );
  });

  it('throws LLMError on Sonnet failure', async () => {
    mockCreate.mockRejectedValue(new Error('Sonnet unavailable'));

    await expect(handleInterrogate(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('throws LLMError when response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] });

    await expect(handleInterrogate(CHAT_ID, TEST_QUERY)).rejects.toThrow(LLMError);
  });

  it('re-throws LLMError directly (not double-wrapped)', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'image', source: {} }] });

    try {
      await handleInterrogate(CHAT_ID, TEST_QUERY);
      expect.fail('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as Error).message).toBe('No text block in Sonnet response');
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Plan 22-03 RETR-04: Date-anchored episodic summary injection
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('handleInterrogate — date-anchored summary injection (RETR-04)', () => {
  // Helper: build a complete episodic_summaries row fixture. The real
  // schema row has many fields — only those consumed by formatEpisodicBlock
  // matter to the assertion, but we populate everything for type safety.
  function makeSummary(overrides: Partial<{
    summaryDate: string;
    summary: string;
    importance: number;
    topics: string[];
    emotionalArc: string;
    keyQuotes: string[];
    sourceEntryIds: string[];
  }> = {}) {
    return {
      id: 'summary-fixture',
      summaryDate: '2026-03-30',
      summary: 'Greg spent the day reflecting on a tense conversation about work boundaries.',
      importance: 6,
      topics: ['work', 'boundaries'],
      emotionalArc: 'tense → resolved',
      keyQuotes: [],
      sourceEntryIds: [],
      createdAt: new Date('2026-03-30T23:00:00Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchPensieve.mockResolvedValue([]);
    mockBuildPensieveContext.mockReturnValue('No relevant memories found.');
    mockBuildMessageHistory.mockResolvedValue([]);
    // Identity passthrough: the real prompt assembly happens inside this
    // mock so we can grep the systemPrompt text the engine builds. The
    // ordering test below replaces this with a more realistic build.
    mockBuildSystemPrompt.mockImplementation(
      (_mode: string, pensieveContext?: string) => pensieveContext ?? '',
    );
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'response' }],
    });
  });

  it('injects summary block when queryDate is >7 days old AND summary exists', async () => {
    const oldDate = new Date(Date.now() - 20 * 86_400_000);
    mockExtractQueryDate.mockResolvedValue(oldDate);
    mockGetEpisodicSummary.mockResolvedValue(makeSummary());

    await handleInterrogate(CHAT_ID, 'what was going on three weeks ago');

    // Verify the prompt-context string built by the engine contains the
    // labeled block, importance line, and date — this is what flows into
    // buildSystemPrompt → Sonnet.
    const ctx = mockBuildSystemPrompt.mock.calls[0][1] as string;
    expect(ctx).toContain('## Recent Episode Context (interpretation, not fact)');
    expect(ctx).toContain('Date: 2026-03-30');
    expect(ctx).toContain('Importance: 6/10');
    expect(ctx).toContain('Emotional arc: tense → resolved');
    expect(ctx).toContain('Topics: work, boundaries');
  });

  it('logs chris.interrogate.summary.injected with date + importance when injection occurs', async () => {
    const oldDate = new Date(Date.now() - 20 * 86_400_000);
    mockExtractQueryDate.mockResolvedValue(oldDate);
    mockGetEpisodicSummary.mockResolvedValue(makeSummary({ importance: 9 }));

    await handleInterrogate(CHAT_ID, 'what happened on 2026-03-30');

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHAT_ID.toString(),
        date: '2026-03-30',
        importance: 9,
      }),
      'chris.interrogate.summary.injected',
    );
  });

  it('skips injection AND skips getEpisodicSummary lookup when queryDate is <=7 days old', async () => {
    const recentDate = new Date(Date.now() - 3 * 86_400_000);
    mockExtractQueryDate.mockResolvedValue(recentDate);

    await handleInterrogate(CHAT_ID, 'what happened three days ago');

    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
    const ctx = mockBuildSystemPrompt.mock.calls[0][1] as string;
    expect(ctx).not.toContain('Recent Episode Context');
  });

  it('skips injection AND skips getEpisodicSummary lookup when queryDate is null', async () => {
    mockExtractQueryDate.mockResolvedValue(null);

    await handleInterrogate(CHAT_ID, 'what is my name');

    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
    const ctx = mockBuildSystemPrompt.mock.calls[0][1] as string;
    expect(ctx).not.toContain('Recent Episode Context');
  });

  it('skips injection silently when summary row missing for an old date', async () => {
    const oldDate = new Date(Date.now() - 20 * 86_400_000);
    mockExtractQueryDate.mockResolvedValue(oldDate);
    mockGetEpisodicSummary.mockResolvedValue(null);

    await handleInterrogate(CHAT_ID, 'what happened on 2026-01-01');

    // getEpisodicSummary WAS called (date qualified), but no block injected.
    expect(mockGetEpisodicSummary).toHaveBeenCalledWith(oldDate);
    const ctx = mockBuildSystemPrompt.mock.calls[0][1] as string;
    expect(ctx).not.toContain('Recent Episode Context');
    // No injected log either
    expect(mockLogInfo).not.toHaveBeenCalledWith(
      expect.anything(),
      'chris.interrogate.summary.injected',
    );
  });

  it('boundary: queryDate exactly 7 days old → NO injection (>7 strict, inclusive recent)', async () => {
    // Math.floor((now - oldDate) / 86_400_000) === 7 → ageDays > 7 is false → no injection
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
    mockExtractQueryDate.mockResolvedValue(sevenDaysAgo);

    await handleInterrogate(CHAT_ID, 'what happened a week ago');

    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
  });

  it('prepends episodic block before raw search context in the assembled string (D031 boundary order)', async () => {
    const oldDate = new Date(Date.now() - 20 * 86_400_000);
    mockExtractQueryDate.mockResolvedValue(oldDate);
    mockGetEpisodicSummary.mockResolvedValue(makeSummary());
    // Override the buildPensieveContext stub to emit a recognizable
    // sentinel string so we can grep the order of the two blocks.
    mockBuildPensieveContext.mockReturnValue('RAW_SEARCH_RESULTS_SENTINEL');

    await handleInterrogate(CHAT_ID, 'what was going on three weeks ago');

    const ctx = mockBuildSystemPrompt.mock.calls[0][1] as string;
    const interpretationIdx = ctx.indexOf('Recent Episode Context');
    const rawIdx = ctx.indexOf('RAW_SEARCH_RESULTS_SENTINEL');
    expect(interpretationIdx).toBeGreaterThanOrEqual(0);
    expect(rawIdx).toBeGreaterThan(interpretationIdx);
  });

  it('episodic block appears BEFORE Known Facts in the final system prompt (real buildSystemPrompt)', async () => {
    // Use the real buildSystemPrompt so the Known Facts block from
    // personality.ts is appended for INTERROGATE — then assert
    // ordering. The constitutional preamble + INTERROGATE template
    // contains the {pensieveContext} placeholder; Known Facts is
    // appended AFTER the mode body for INTERROGATE/JOURNAL modes.
    const realPersonality = await vi.importActual<typeof import('../personality.js')>(
      '../personality.js',
    );
    mockBuildSystemPrompt.mockImplementation(realPersonality.buildSystemPrompt);

    const oldDate = new Date(Date.now() - 20 * 86_400_000);
    mockExtractQueryDate.mockResolvedValue(oldDate);
    mockGetEpisodicSummary.mockResolvedValue(makeSummary());

    await handleInterrogate(CHAT_ID, 'what was going on three weeks ago');

    // The real buildSystemPrompt return-value is what gets passed as
    // `system[0].text` to anthropic.messages.create — pull it from there.
    const sentSystem = mockCreate.mock.calls[0][0].system as Array<{
      type: string;
      text: string;
    }>;
    const fullPrompt = sentSystem[0].text;

    const interpretationIdx = fullPrompt.indexOf('Recent Episode Context');
    const knownFactsIdx = fullPrompt.indexOf('Facts about you (Greg)');

    expect(interpretationIdx).toBeGreaterThanOrEqual(0);
    expect(knownFactsIdx).toBeGreaterThanOrEqual(0);
    expect(interpretationIdx).toBeLessThan(knownFactsIdx);
  });
});
