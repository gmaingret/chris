import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock config ────────────────────────────────────────────────────────────
vi.mock('../../config.js', () => ({
  config: {
    embeddingModel: 'Xenova/bge-m3',
    embeddingDimensions: 1024,
    logLevel: 'info',
    databaseUrl: 'postgres://mock',
    // RETR-01 episodic helpers convert Date inputs in this tz before querying.
    proactiveTimezone: 'Europe/Paris',
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
  },
}));

// ── Mock embedText ─────────────────────────────────────────────────────────
const FAKE_QUERY_VECTOR = Array.from({ length: 1024 }, (_, i) => i / 1024);
const mockEmbedText = vi.fn<(text: string) => Promise<number[] | null>>().mockResolvedValue(FAKE_QUERY_VECTOR);

vi.mock('../embeddings.js', () => ({
  embedText: (text: string) => mockEmbedText(text),
}));

// ── Mock DB ────────────────────────────────────────────────────────────────
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockInnerJoin = vi.fn(() => ({ where: mockWhere }));
const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('../../db/connection.js', () => ({
  db: { select: (...args: unknown[]) => mockSelect(...(args as [])) },
}));

// ── Import module under test after mocks ───────────────────────────────────
const { searchPensieve, hybridSearch, getEpisodicSummary, getEpisodicSummariesRange, REFLECT_SEARCH_OPTIONS, COACH_SEARCH_OPTIONS, PSYCHOLOGY_SEARCH_OPTIONS, PRODUCE_SEARCH_OPTIONS, CONTRADICTION_SEARCH_OPTIONS, JOURNAL_SEARCH_OPTIONS } = await import('../retrieve.js');
import type { SearchOptions, SearchResult } from '../retrieve.js';
import { JOURNAL_SYSTEM_PROMPT } from '../../llm/prompts.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(id: string, content: string, createdAt: Date, epistemicTag: string | null = null) {
  return {
    id,
    content,
    epistemicTag,
    source: 'telegram',
    metadata: null,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  };
}

describe('searchPensieve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockResolvedValue(FAKE_QUERY_VECTOR);
  });

  it('returns entries ranked by descending similarity score (R003)', async () => {
    const closer = makeEntry('aaa', 'relevant entry', new Date('2024-01-01'));
    const farther = makeEntry('bbb', 'less relevant entry', new Date('2024-06-01'));

    mockLimit.mockResolvedValueOnce([
      { entry: closer, distance: 0.1 },
      { entry: farther, distance: 0.4 },
    ]);

    const results = await searchPensieve('topic');

    expect(results).toHaveLength(2);
    expect(results[0]!.entry.id).toBe('aaa');
    expect(results[0]!.score).toBeCloseTo(0.9); // 1 - 0.1
    expect(results[1]!.entry.id).toBe('bbb');
    expect(results[1]!.score).toBeCloseTo(0.6); // 1 - 0.4
    // First result has higher similarity
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('respects the limit parameter', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('query', 3);

    // Over-fetches by 3x for chunk dedup, then trims to requested limit
    expect(mockLimit).toHaveBeenCalledWith(9);
  });

  it('defaults limit to 5', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('query');

    // Over-fetches by 3x for chunk dedup
    expect(mockLimit).toHaveBeenCalledWith(15);
  });

  it('passes French query text through to embedText for multilingual support (R010)', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('Je me souviens de mon enfance à Paris');

    expect(mockEmbedText).toHaveBeenCalledWith('Je me souviens de mon enfance à Paris');
  });

  it('passes Russian query text through to embedText for multilingual support (R010)', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('Я помню свое детство в Москве');

    expect(mockEmbedText).toHaveBeenCalledWith('Я помню свое детство в Москве');
  });

  it('ranks old but more relevant entries above recent less relevant ones — temporal neutrality (R012)', async () => {
    const oldRelevant = makeEntry('old', 'highly relevant old entry', new Date('2020-01-01'));
    const recentIrrelevant = makeEntry('new', 'less relevant recent entry', new Date('2025-12-01'));

    // Cosine distance: lower = more similar. Old entry is closer (0.05) than recent (0.7).
    mockLimit.mockResolvedValueOnce([
      { entry: oldRelevant, distance: 0.05 },
      { entry: recentIrrelevant, distance: 0.7 },
    ]);

    const results = await searchPensieve('relevant topic');

    expect(results[0]!.entry.id).toBe('old');
    expect(results[1]!.entry.id).toBe('new');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('returns empty array when DB returns no rows', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const results = await searchPensieve('obscure query');

    expect(results).toEqual([]);
  });

  it('returns empty array and logs warning when embedText returns null', async () => {
    mockEmbedText.mockResolvedValueOnce(null);

    const results = await searchPensieve('some query');

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'some query' }),
      'pensieve.retrieve.error',
    );
  });

  it('returns empty array and logs error when DB query throws', async () => {
    mockLimit.mockRejectedValueOnce(new Error('connection reset'));

    const results = await searchPensieve('some query');

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'connection reset' }),
      'pensieve.retrieve.error',
    );
  });

  it('filters deleted entries via WHERE clause (deletedAt IS NULL)', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve('test');

    // The where() call should have been invoked — meaning the filter is in the chain
    expect(mockWhere).toHaveBeenCalled();
    // Verify the full chain: select → from → innerJoin → where → orderBy → limit
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockInnerJoin).toHaveBeenCalled();
    expect(mockOrderBy).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalled();
  });

  it('logs pensieve.retrieve with truncated query, resultCount, and latencyMs on success', async () => {
    mockLimit.mockResolvedValueOnce([
      { entry: makeEntry('aaa', 'content', new Date()), distance: 0.2 },
    ]);

    await searchPensieve('test query');

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'test query',
        resultCount: 1,
        latencyMs: expect.any(Number),
      }),
      'pensieve.retrieve',
    );
  });

  it('truncates long query text to 50 chars in logs', async () => {
    const longQuery = 'a'.repeat(100);
    mockLimit.mockResolvedValueOnce([]);

    await searchPensieve(longQuery);

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'a'.repeat(50),
      }),
      'pensieve.retrieve',
    );
  });

  it('deduplicates multiple chunks from same entry — retrieval dedup', async () => {
    const entry = makeEntry('same-entry', 'document content', new Date('2024-01-01'));

    // Two embedding rows for the same entry (different chunks)
    mockLimit.mockResolvedValueOnce([
      { entry, distance: 0.3 }, // chunk 0
      { entry, distance: 0.1 }, // chunk 1 (better match)
    ]);

    const results = await searchPensieve('query');

    // Should return only one result for the entry — the best-scoring chunk
    expect(results).toHaveLength(1);
    expect(results[0]!.entry.id).toBe('same-entry');
    expect(results[0]!.score).toBeCloseTo(0.9); // 1 - 0.1 (best)
  });

  it('deduplicates across entries — keeps best chunk per entry — retrieval dedup', async () => {
    const entryA = makeEntry('entry-a', 'doc A', new Date('2024-01-01'));
    const entryB = makeEntry('entry-b', 'doc B', new Date('2024-02-01'));

    mockLimit.mockResolvedValueOnce([
      { entry: entryA, distance: 0.05 },
      { entry: entryA, distance: 0.2 },  // worse chunk of A
      { entry: entryB, distance: 0.15 },
      { entry: entryB, distance: 0.3 },  // worse chunk of B
    ]);

    const results = await searchPensieve('query');

    expect(results).toHaveLength(2);
    expect(results[0]!.entry.id).toBe('entry-a');
    expect(results[0]!.score).toBeCloseTo(0.95); // 1 - 0.05
    expect(results[1]!.entry.id).toBe('entry-b');
    expect(results[1]!.score).toBeCloseTo(0.85); // 1 - 0.15
  });
});
describe('hybridSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEmbedText.mockResolvedValue(FAKE_QUERY_VECTOR);
  });

  it('default options (no tags, recencyBias 0) returns same ranking as pure cosine', async () => {
    const entry1 = makeEntry('aaa', 'close match', new Date());
    const entry2 = makeEntry('bbb', 'far match', new Date());

    mockLimit.mockResolvedValueOnce([
      { entry: entry1, distance: 0.1 },
      { entry: entry2, distance: 0.4 },
    ]);

    const results = await hybridSearch('topic');

    expect(results).toHaveLength(2);
    expect(results[0]!.entry.id).toBe('aaa');
    expect(results[0]!.score).toBeCloseTo(0.9); // 1 - 0.1
    expect(results[1]!.entry.id).toBe('bbb');
    expect(results[1]!.score).toBeCloseTo(0.6); // 1 - 0.4
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('filters by epistemic tags when tags option is provided', async () => {
    const emotionEntry = makeEntry('em1', 'feeling sad', new Date(), 'EMOTION');

    mockLimit.mockResolvedValueOnce([
      { entry: emotionEntry, distance: 0.2 },
    ]);

    const results = await hybridSearch('feelings', { tags: ['EMOTION'] });

    expect(results).toHaveLength(1);
    expect(results[0]!.entry.epistemicTag).toBe('EMOTION');
    // Verify that where was called (with the tag filter via and())
    expect(mockWhere).toHaveBeenCalled();
  });

  it('recencyBias > 0 ranks recent entries higher when cosine distances are equal', async () => {
    const now = Date.now();
    const recentDate = new Date(now - 1000 * 60 * 60 * 24 * 7);   // 7 days ago
    const oldDate = new Date(now - 1000 * 60 * 60 * 24 * 365);     // 365 days ago

    const recentEntry = makeEntry('recent', 'recent entry', recentDate);
    const oldEntry = makeEntry('old', 'old entry', oldDate);

    // Same cosine distance
    mockLimit.mockResolvedValueOnce([
      { entry: recentEntry, distance: 0.2 },
      { entry: oldEntry, distance: 0.2 },
    ]);

    const results = await hybridSearch('topic', { recencyBias: 0.5 });

    expect(results).toHaveLength(2);
    // Recent entry should rank higher after temporal weighting
    expect(results[0]!.entry.id).toBe('recent');
    expect(results[1]!.entry.id).toBe('old');
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it('minScore filters out entries with blended score below threshold', async () => {
    const entry1 = makeEntry('good', 'relevant', new Date());
    const entry2 = makeEntry('bad', 'irrelevant', new Date());

    mockLimit.mockResolvedValueOnce([
      { entry: entry1, distance: 0.1 },  // score ≈ 0.9
      { entry: entry2, distance: 0.8 },  // score ≈ 0.2
    ]);

    const results = await hybridSearch('topic', { minScore: 0.5 });

    expect(results).toHaveLength(1);
    expect(results[0]!.entry.id).toBe('good');
    expect(results[0]!.score).toBeGreaterThanOrEqual(0.5);
  });

  it('limit option restricts number of returned results', async () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      ({ entry: makeEntry(`e${i}`, `entry ${i}`, new Date()), distance: 0.1 + i * 0.05 }),
    );
    mockLimit.mockResolvedValueOnce(entries);

    const results = await hybridSearch('topic', { limit: 3 });

    expect(results).toHaveLength(3);
  });

  it('returns empty array and logs warning when DB query throws', async () => {
    mockLimit.mockRejectedValueOnce(new Error('connection timeout'));

    const results = await hybridSearch('some query');

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'connection timeout' }),
      'pensieve.hybrid-retrieve.error',
    );
  });

  it('returns empty array and logs warning when embedText returns null', async () => {
    mockEmbedText.mockResolvedValueOnce(null);

    const results = await hybridSearch('some query');

    expect(results).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'some query' }),
      'pensieve.hybrid-retrieve.error',
    );
  });

  it('logs pensieve.hybrid-retrieve with options summary on success', async () => {
    mockLimit.mockResolvedValueOnce([
      { entry: makeEntry('aaa', 'content', new Date()), distance: 0.2 },
    ]);

    await hybridSearch('test query', { tags: ['FEAR'], recencyBias: 0.3 });

    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'test query',
        resultCount: 1,
        latencyMs: expect.any(Number),
        tags: ['FEAR'],
        recencyBias: 0.3,
      }),
      'pensieve.hybrid-retrieve',
    );
  });

  it('uses larger SQL limit to allow for minScore post-filtering', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await hybridSearch('query', { limit: 5 });

    // SQL limit should be Math.max(5 * 2, 20) = 20
    expect(mockLimit).toHaveBeenCalledWith(20);
  });

  it('defaults limit to 5 when not specified', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await hybridSearch('query');

    // SQL limit: Math.max(5 * 2, 20) = 20
    expect(mockLimit).toHaveBeenCalledWith(20);
  });
});

// ── Mode search presets tests ──────────────────────────────────────────────

describe('mode search presets', () => {
  it('REFLECT_SEARCH_OPTIONS has low recencyBias and broad limit', () => {
    expect(REFLECT_SEARCH_OPTIONS.recencyBias).toBe(0.1);
    expect(REFLECT_SEARCH_OPTIONS.limit).toBe(15);
    expect(REFLECT_SEARCH_OPTIONS.tags).toBeUndefined();
  });

  it('COACH_SEARCH_OPTIONS focuses on beliefs, intentions, values with high recency', () => {
    expect(COACH_SEARCH_OPTIONS.recencyBias).toBe(0.5);
    expect(COACH_SEARCH_OPTIONS.limit).toBe(10);
    expect(COACH_SEARCH_OPTIONS.tags).toContain('BELIEF');
    expect(COACH_SEARCH_OPTIONS.tags).toContain('INTENTION');
    expect(COACH_SEARCH_OPTIONS.tags).toContain('VALUE');
  });

  it('PSYCHOLOGY_SEARCH_OPTIONS includes emotional and depth tags across time', () => {
    expect(PSYCHOLOGY_SEARCH_OPTIONS.recencyBias).toBe(0.2);
    expect(PSYCHOLOGY_SEARCH_OPTIONS.limit).toBe(15);
    expect(PSYCHOLOGY_SEARCH_OPTIONS.tags).toContain('EMOTION');
    expect(PSYCHOLOGY_SEARCH_OPTIONS.tags).toContain('FEAR');
    expect(PSYCHOLOGY_SEARCH_OPTIONS.tags).toContain('BELIEF');
    expect(PSYCHOLOGY_SEARCH_OPTIONS.tags).toContain('DREAM');
  });

  it('PRODUCE_SEARCH_OPTIONS uses moderate recency for decision grounding', () => {
    expect(PRODUCE_SEARCH_OPTIONS.recencyBias).toBe(0.3);
    expect(PRODUCE_SEARCH_OPTIONS.limit).toBe(10);
    expect(PRODUCE_SEARCH_OPTIONS.tags).toBeUndefined();
  });

  it('CONTRADICTION_SEARCH_OPTIONS uses zero recencyBias, broad limit, belief tags, and minScore', () => {
    expect(CONTRADICTION_SEARCH_OPTIONS.recencyBias).toBe(0);
    expect(CONTRADICTION_SEARCH_OPTIONS.limit).toBe(20);
    expect(CONTRADICTION_SEARCH_OPTIONS.tags).toContain('BELIEF');
    expect(CONTRADICTION_SEARCH_OPTIONS.tags).toContain('INTENTION');
    expect(CONTRADICTION_SEARCH_OPTIONS.tags).toContain('VALUE');
    expect(CONTRADICTION_SEARCH_OPTIONS.minScore).toBe(0.4);
  });

  it('all presets satisfy the SearchOptions type (compile-time proof)', () => {
    // TypeScript compilation is the real proof — this runtime check
    // just documents the contract for readability
    const presets: SearchOptions[] = [
      REFLECT_SEARCH_OPTIONS,
      COACH_SEARCH_OPTIONS,
      PSYCHOLOGY_SEARCH_OPTIONS,
      PRODUCE_SEARCH_OPTIONS,
      CONTRADICTION_SEARCH_OPTIONS,
    ];
    expect(presets).toHaveLength(5);
    for (const preset of presets) {
      expect(preset).toHaveProperty('recencyBias');
      expect(preset).toHaveProperty('limit');
    }
  });

  it('buildPensieveContext accepts SearchResult[] type contract', async () => {
    // Dynamic import to avoid transitive module mock conflicts
    const { buildPensieveContext } = await import('../../memory/context-builder.js');
    // Type-level verification: buildPensieveContext accepts SearchResult[]
    // This test proves the type contract holds — if SearchResult changes
    // incompatibly, this file won't compile
    const mockResults: SearchResult[] = [];
    const result = buildPensieveContext(mockResults);
    expect(typeof result).toBe('string');
  });
});

// ── JOURNAL_SEARCH_OPTIONS preset tests (RETR-01) ─────────────────────────

describe('JOURNAL_SEARCH_OPTIONS preset', () => {
  it('uses fact-type tags', () => {
    expect(JOURNAL_SEARCH_OPTIONS.tags).toEqual(['FACT', 'RELATIONSHIP', 'PREFERENCE', 'VALUE']);
  });

  it('has moderate recency bias', () => {
    expect(JOURNAL_SEARCH_OPTIONS.recencyBias).toBe(0.3);
  });

  it('limits to 10 results', () => {
    expect(JOURNAL_SEARCH_OPTIONS.limit).toBe(10);
  });

  it('has no minimum score threshold', () => {
    expect(JOURNAL_SEARCH_OPTIONS.minScore).toBeUndefined();
  });
});

// ── JOURNAL_SYSTEM_PROMPT tests (RETR-01, RETR-04) ────────────────────────

describe('JOURNAL_SYSTEM_PROMPT', () => {
  it('contains pensieveContext placeholder', () => {
    expect(JOURNAL_SYSTEM_PROMPT).toContain('{pensieveContext}');
  });

  it('contains hallucination resistance instruction', () => {
    expect(JOURNAL_SYSTEM_PROMPT).toContain("I don't have any memories about that");
  });
});

// ── Episodic helpers — error paths (RETR-01) ──────────────────────────────
//
// Happy-path + timezone-boundary + range coverage for getEpisodicSummary /
// getEpisodicSummariesRange lives in `retrieve.episodic.test.ts` (Docker-
// Postgres integration). Here we exercise the never-throw contract: the
// helpers must return null / [] and log `pensieve.episodic.error` on any
// DB failure. Forcing the mocked `db.select()` to throw is the cleanest way
// to drive that path without wiring a closed-connection scenario.

describe('episodic helpers — error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getEpisodicSummary returns null and logs pensieve.episodic.error on DB throw', async () => {
    mockSelect.mockImplementationOnce(() => {
      throw new Error('connection reset');
    });

    const row = await getEpisodicSummary(new Date('2026-04-15T10:00:00Z'));

    expect(row).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        date: expect.any(String),
        error: 'connection reset',
      }),
      'pensieve.episodic.error',
    );
  });

  it('getEpisodicSummariesRange returns [] and logs pensieve.episodic.error on DB throw', async () => {
    mockSelect.mockImplementationOnce(() => {
      throw new Error('query timed out');
    });

    const rows = await getEpisodicSummariesRange(
      new Date('2026-04-10T10:00:00Z'),
      new Date('2026-04-15T10:00:00Z'),
    );

    expect(rows).toEqual([]);
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        from: expect.any(String),
        to: expect.any(String),
        error: 'query timed out',
      }),
      'pensieve.episodic.error',
    );
  });

  it('formatLocalDate routes Date through config.proactiveTimezone (observable in error log)', async () => {
    // Force a throw so the warn log fires with the formatted localDate.
    // 2026-04-15T22:30:00Z = 2026-04-16 00:30 in Europe/Paris (CEST).
    // The log payload's `date` field proves the helper used the tz, not UTC.
    mockSelect.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    await getEpisodicSummary(new Date('2026-04-15T22:30:00Z'));

    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        date: '2026-04-16',
        error: 'boom',
      }),
      'pensieve.episodic.error',
    );
  });
});
