import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock db ────────────────────────────────────────────────────────────────
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockSelect = vi.fn();
const mockSelectFrom = vi.fn();
const mockSelectWhere = vi.fn();
const mockSelectLimit = vi.fn();
const mockUpdate = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn();

let selectLimitResult: unknown[] = [];

vi.mock('../../db/connection.js', () => ({
  db: {
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return { values: (...vArgs: unknown[]) => { mockValues(...vArgs); return Promise.resolve(); } };
    },
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...fArgs: unknown[]) => {
          mockSelectFrom(...fArgs);
          return {
            where: (...wArgs: unknown[]) => {
              mockSelectWhere(...wArgs);
              return {
                limit: (...lArgs: unknown[]) => {
                  mockSelectLimit(...lArgs);
                  return Promise.resolve(selectLimitResult);
                },
              };
            },
          };
        },
      };
    },
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return {
        set: (...sArgs: unknown[]) => {
          mockUpdateSet(...sArgs);
          return {
            where: (...wArgs: unknown[]) => {
              mockUpdateWhere(...wArgs);
              return Promise.resolve();
            },
          };
        },
      };
    },
    $with: vi.fn(() => ({ as: vi.fn() })),
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────
const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();
const mockLogDebug = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: (...args: unknown[]) => mockLogWarn(...args),
    error: vi.fn(),
    debug: (...args: unknown[]) => mockLogDebug(...args),
  },
}));

// ── Mock Anthropic client ──────────────────────────────────────────────────
const mockCreate = vi.fn();

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockCreate },
  },
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
}));

// ── Mock hybridSearch ──────────────────────────────────────────────────────
const mockHybridSearch = vi.fn();
vi.mock('../../pensieve/retrieve.js', () => ({
  hybridSearch: mockHybridSearch,
  CONTRADICTION_SEARCH_OPTIONS: {
    recencyBias: 0,
    limit: 20,
    tags: ['BELIEF', 'INTENTION', 'VALUE'],
    minScore: 0.4,
  },
}));

// ── Import module under test after mocks ───────────────────────────────────
const { detectContradictions, getUnresolvedContradictions, resolveContradiction, CONFIDENCE_THRESHOLD } =
  await import('../contradiction.js');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeLLMResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

const MOCK_CANDIDATES = [
  {
    entry: {
      id: 'entry-old-1',
      content: "I'll never go back to corporate work",
      createdAt: new Date('2025-01-10'),
      epistemicTag: 'INTENTION',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.88,
  },
  {
    entry: {
      id: 'entry-old-2',
      content: 'I value work-life balance above salary',
      createdAt: new Date('2025-02-05'),
      epistemicTag: 'VALUE',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.75,
  },
  {
    entry: {
      id: 'entry-old-3',
      content: 'I had a great lunch today',
      createdAt: new Date('2025-03-01'),
      epistemicTag: 'EXPERIENCE',
      source: 'telegram',
      deletedAt: null,
    },
    score: 0.50,
  },
];

const NEW_TEXT = "I'm really excited about this corporate offer — the salary is incredible and I think it's the right move.";

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('CONFIDENCE_THRESHOLD', () => {
  it('is 0.75', () => {
    expect(CONFIDENCE_THRESHOLD).toBe(0.75);
  });
});

describe('detectContradictions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHybridSearch.mockResolvedValue(MOCK_CANDIDATES);
    // Default: dedup check returns no existing contradictions
    selectLimitResult = [];
  });

  // ── 1. Full detection flow ─────────────────────────────────────────────

  it('detects contradiction: search → Haiku → store → return', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          contradictions: [
            { entryIndex: 1, description: 'Previously said never corporate, now excited about corporate offer', confidence: 0.92 },
          ],
        }),
      ),
    );

    const results = await detectContradictions(NEW_TEXT, 'entry-new-1');

    // Verify hybridSearch was called
    expect(mockHybridSearch).toHaveBeenCalledWith(NEW_TEXT, expect.objectContaining({ limit: 20 }));

    // Verify Haiku was called
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
      }),
    );

    // Verify DB insert was called (stored the contradiction)
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        entryAId: 'entry-new-1',
        entryBId: 'entry-old-1',
        description: 'Previously said never corporate, now excited about corporate offer',
        status: 'DETECTED',
      }),
    );

    // Verify return value
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      entryId: 'entry-old-1',
      entryContent: "I'll never go back to corporate work",
      description: 'Previously said never corporate, now excited about corporate offer',
      confidence: 0.92,
    });
    expect(results[0]!.entryDate).toBeInstanceOf(Date);
  });

  // ── 2. No contradiction ────────────────────────────────────────────────

  it('returns empty when Haiku finds no contradictions', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ contradictions: [] })),
    );

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // ── 3. False positive rejection (below threshold) ──────────────────────

  it('filters out results below confidence threshold 0.75', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          contradictions: [
            { entryIndex: 1, description: 'Possible contradiction', confidence: 0.60 },
            { entryIndex: 2, description: 'Another weak one', confidence: 0.74 },
          ],
        }),
      ),
    );

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('keeps results at exactly 0.75 confidence', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          contradictions: [
            { entryIndex: 1, description: 'Borderline contradiction', confidence: 0.75 },
          ],
        }),
      ),
    );

    const results = await detectContradictions(NEW_TEXT, 'entry-new-1');

    expect(results).toHaveLength(1);
    expect(results[0]!.confidence).toBe(0.75);
  });

  // ── 4. Short message skip ──────────────────────────────────────────────

  it('skips detection for text shorter than 10 characters', async () => {
    const results = await detectContradictions('Hi');

    expect(results).toEqual([]);
    expect(mockHybridSearch).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'message_too_short' }),
      'contradiction.detect.skip',
    );
  });

  // ── 5. Never-throw on API error ────────────────────────────────────────

  it('returns empty array when Haiku throws an error', async () => {
    mockCreate.mockRejectedValue(new Error('API rate limited'));

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'API rate limited',
      }),
      'contradiction.detect.error',
    );
  });

  // ── 6. Never-throw on parse error ──────────────────────────────────────

  it('returns empty array when Haiku returns unparseable text', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse('This is not JSON at all, sorry!'),
    );

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'parse', error: 'Unparseable Haiku response' }),
      'contradiction.detect.error',
    );
  });

  // ── 7. K003 fence stripping ────────────────────────────────────────────

  it('strips markdown code fences before parsing (K003)', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        '```json\n{"contradictions": [{"entryIndex": 1, "description": "Corporate contradiction", "confidence": 0.90}]}\n```',
      ),
    );

    const results = await detectContradictions(NEW_TEXT, 'entry-new-1');

    expect(results).toHaveLength(1);
    expect(results[0]!.confidence).toBe(0.90);
  });

  // ── 8. Deduplication ───────────────────────────────────────────────────

  it('skips storing when contradiction already exists in DB', async () => {
    // Dedup check returns an existing row
    selectLimitResult = [{ id: 'existing-contradiction-id' }];

    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          contradictions: [
            { entryIndex: 1, description: 'Already stored contradiction', confidence: 0.95 },
          ],
        }),
      ),
    );

    const results = await detectContradictions(NEW_TEXT, 'entry-new-1');

    expect(results).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'already_stored' }),
      'contradiction.detect.skip',
    );
  });

  // ── 9. No search results ───────────────────────────────────────────────

  it('returns empty when hybridSearch returns no candidates', async () => {
    mockHybridSearch.mockResolvedValue([]);

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockLogDebug).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'no_candidates' }),
      'contradiction.detect.skip',
    );
  });

  // ── 10. Invalid entryIndex from Haiku ──────────────────────────────────

  it('ignores invalid entryIndex values from Haiku', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          contradictions: [
            { entryIndex: 99, description: 'Bad index', confidence: 0.90 },
          ],
        }),
      ),
    );

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toEqual([]);
  });

  // ── 11. hybridSearch error (never-throw through search) ────────────────

  it('returns empty array when hybridSearch throws', async () => {
    mockHybridSearch.mockRejectedValue(new Error('DB connection failed'));

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'DB connection failed' }),
      'contradiction.detect.error',
    );
  });

  // ── 12. No text block in Haiku response ────────────────────────────────

  it('returns empty when Haiku response has no text block', async () => {
    mockCreate.mockResolvedValue({ content: [] });

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'llm', error: 'No text block in Haiku response' }),
      'contradiction.detect.error',
    );
  });

  // ── 13. Logging: info on detection ─────────────────────────────────────

  it('logs contradiction.detect with count and latency on success', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ contradictions: [] })),
    );

    await detectContradictions(NEW_TEXT);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        detectedCount: 0,
        latencyMs: expect.any(Number),
      }),
      'contradiction.detect',
    );
  });

  // ── 14. Invalid response structure ─────────────────────────────────────

  it('returns empty when Haiku returns invalid JSON structure', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(JSON.stringify({ result: 'no contradictions field' })),
    );

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'parse', error: 'Invalid response structure' }),
      'contradiction.detect.error',
    );
  });

  // ── 15. Without entryId — no store, no dedup ───────────────────────────

  it('skips DB store and dedup when entryId is not provided', async () => {
    mockCreate.mockResolvedValue(
      makeLLMResponse(
        JSON.stringify({
          contradictions: [
            { entryIndex: 1, description: 'Some contradiction', confidence: 0.85 },
          ],
        }),
      ),
    );

    const results = await detectContradictions(NEW_TEXT);

    expect(results).toHaveLength(1);
    // No dedup select
    expect(mockSelect).not.toHaveBeenCalled();
    // No insert
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('resolveContradiction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the contradiction with resolution and RESOLVED status', async () => {
    await resolveContradiction('contradiction-1', 'I changed my mind about corporate', 'RESOLVED');

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'RESOLVED',
        resolution: 'I changed my mind about corporate',
        resolvedAt: expect.any(Date),
      }),
    );
  });

  it('supports ACCEPTED status', async () => {
    await resolveContradiction('contradiction-2', 'Both are true for me', 'ACCEPTED');

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ACCEPTED',
        resolution: 'Both are true for me',
      }),
    );
  });

  it('defaults to RESOLVED status', async () => {
    await resolveContradiction('contradiction-3', 'Resolved it');

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'RESOLVED',
      }),
    );
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('detectContradictions — no candidates path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty and logs skip when hybridSearch returns results that all get filtered', async () => {
    // hybridSearch returns results but all have the same entryId as the new entry
    mockHybridSearch.mockResolvedValue([
      { entry: { id: 'same-entry', content: 'test', createdAt: new Date() }, score: 0.9 },
    ]);

    const result = await detectContradictions('Some new text that is long enough', 'same-entry');

    expect(result).toEqual([]);
  });
});
