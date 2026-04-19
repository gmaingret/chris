/**
 * src/pensieve/__tests__/routing.test.ts — Phase 22 Plan 02 Task 2
 *
 * Unit tests for `retrieveContext()` (RETR-02 + RETR-03). Mocks the three
 * hot-path dependencies:
 *   - `getEpisodicSummary` and `hybridSearch` from ../retrieve.js
 *   - `db` from ../../db/connection.js (for the high-importance raw descent
 *      `loadEntriesByIds` SELECT)
 *   - `logger` so `pensieve.routing.decision` log assertions are deterministic
 *
 * Plus a NEGATIVE assertion: the Anthropic SDK is mocked at module scope and
 * `anthropic.messages.create` must be called ZERO times across the entire suite
 * — the verbatim-keyword fast-path is pure substring match (RETR-02), no Haiku
 * fallback in M008.
 *
 * Coverage:
 *   - 5 routing reasons: verbatim-keyword, recent (with + without queryDate),
 *     no-summary-fallback, summary-only, high-importance-descent
 *   - Language coverage: EN, FR, RU verbatim-keyword fast-path
 *   - Importance boundary table: 7 → summary-only, 8 → descent (inclusive),
 *     9 → descent, 10 → descent
 *   - Error path: `getEpisodicSummary` throws → 'recent' fallback + warn log
 *   - Decision-log assertion on every non-error branch
 *   - Zero Anthropic SDK calls assertion (afterAll)
 *
 * Run in isolation:
 *   ANTHROPIC_API_KEY=test-key TELEGRAM_BOT_TOKEN=test-token \
 *     TELEGRAM_AUTHORIZED_USER_ID=99999 \
 *     DATABASE_URL=postgresql://chris:localtest123@localhost:5433/chris \
 *     npx vitest run src/pensieve/__tests__/routing.test.ts
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const {
  mockGetEpisodicSummary,
  mockHybridSearch,
  mockAnthropicCreate,
  mockLoadEntriesByIdsRows,
} = vi.hoisted(() => ({
  mockGetEpisodicSummary: vi.fn(),
  mockHybridSearch: vi.fn(),
  // Negative-assertion spy: must never be called by any test in this suite.
  mockAnthropicCreate: vi.fn(),
  // Reference to the row set returned by the mocked db.select chain in
  // loadEntriesByIds. Tests overwrite this between cases.
  mockLoadEntriesByIdsRows: { current: [] as unknown[] },
}));

vi.mock('../retrieve.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../retrieve.js')>();
  return {
    ...actual,
    getEpisodicSummary: mockGetEpisodicSummary,
    hybridSearch: mockHybridSearch,
  };
});

// Mock the db.select chain used by loadEntriesByIds:
//   db.select().from(pensieveEntries).where(...)
// Returns mockLoadEntriesByIdsRows.current.
vi.mock('../../db/connection.js', () => {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  // .from() returns the same chain (so .where() is callable on it).
  chain.from.mockReturnValue(chain);
  // .where() resolves with the current rows reference.
  chain.where.mockImplementation(() => Promise.resolve(mockLoadEntriesByIdsRows.current));
  return {
    db: {
      select: vi.fn(() => chain),
    },
    sql: vi.fn(),
  };
});

// Negative assertion: anthropic.messages.create must be ZERO calls across the
// entire suite. retrieveContext is pure keyword matching for the verbatim
// fast-path — no Haiku fallback in M008.
vi.mock('../../llm/client.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../llm/client.js')>();
  return {
    ...orig,
    anthropic: {
      messages: {
        create: mockAnthropicCreate,
        parse: vi.fn(),
      },
    },
  };
});

// Logger mock — capture info/warn calls per test.
const mockLogInfo = vi.fn();
const mockLogWarn = vi.fn();
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock config so retrieve.js (the actual module behind importOriginal) can
// pull config.proactiveTimezone if it's referenced indirectly.
vi.mock('../../config.js', () => ({
  config: {
    embeddingModel: 'Xenova/bge-m3',
    embeddingDimensions: 1024,
    logLevel: 'info',
    databaseUrl: 'postgres://mock',
    proactiveTimezone: 'Europe/Paris',
    anthropicApiKey: 'test-key',
    haikuModel: 'claude-haiku-4-5',
    sonnetModel: 'claude-sonnet-4-6',
    opusModel: 'claude-opus-4-6',
  },
}));

// ── Imports AFTER mocks ────────────────────────────────────────────────────

const {
  retrieveContext,
  summaryToSearchResult,
  VERBATIM_KEYWORDS,
  HIGH_IMPORTANCE_THRESHOLD,
  RECENCY_BOUNDARY_DAYS,
} = await import('../routing.js');

// ── Fixture helpers ────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-04-19T12:00:00Z').getTime();

function daysAgo(n: number): Date {
  return new Date(FIXED_NOW - n * 86_400_000);
}

function makeSummary(
  importance: number,
  sourceEntryIds: string[] = [],
): {
  id: string;
  summaryDate: string;
  summary: string;
  importance: number;
  topics: string[];
  emotionalArc: string;
  keyQuotes: string[];
  sourceEntryIds: string[];
  createdAt: Date;
} {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    summaryDate: '2026-03-20',
    summary: 'A representative day summary for the routing tests.'.padEnd(120, ' '),
    importance,
    topics: ['testing', 'routing'],
    emotionalArc: 'neutral → curious',
    keyQuotes: [],
    sourceEntryIds,
    createdAt: new Date(FIXED_NOW - 30 * 86_400_000),
  };
}

function makeEntryRow(id: string, content: string): {
  id: string;
  content: string;
  source: string;
  metadata: null;
  epistemicTag: null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: null;
} {
  return {
    id,
    content,
    source: 'telegram',
    metadata: null,
    epistemicTag: null,
    createdAt: new Date(FIXED_NOW - 30 * 86_400_000),
    updatedAt: new Date(FIXED_NOW - 30 * 86_400_000),
    deletedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: hybridSearch returns one synthetic raw result so reason-only
  // assertions don't double-check rawCount unless the test cares.
  mockHybridSearch.mockResolvedValue([
    { entry: makeEntryRow('aaaaaaaa-1111-1111-1111-111111111111', 'sample raw'), score: 0.9 },
  ]);
  mockGetEpisodicSummary.mockResolvedValue(null);
  mockLoadEntriesByIdsRows.current = [];
  // Pin Date.now so queryAge math is deterministic across tests.
  vi.useFakeTimers({ now: FIXED_NOW, toFake: ['Date'] });
});

afterEach(() => {
  // WR-05: reset Date mocks between tests so a future describe block that
  // forgets to re-install fake timers (or depends on real timers for latency
  // assertions) doesn't inherit Date.now() pinned to FIXED_NOW. This is the
  // flaky-boundary class of test bug the Phase 22-02 SUMMARY explicitly
  // called out.
  vi.useRealTimers();
});

// ════════════════════════════════════════════════════════════════════════════

describe('retrieveContext — exported constants', () => {
  it('RECENCY_BOUNDARY_DAYS is 7 (RETR-02)', () => {
    expect(RECENCY_BOUNDARY_DAYS).toBe(7);
  });

  it('HIGH_IMPORTANCE_THRESHOLD is 8 (RETR-03)', () => {
    expect(HIGH_IMPORTANCE_THRESHOLD).toBe(8);
  });

  it('VERBATIM_KEYWORDS includes EN/FR/RU coverage (D020-D021, PITFALLS #6)', () => {
    expect(VERBATIM_KEYWORDS).toContain('exactly');
    expect(VERBATIM_KEYWORDS).toContain('verbatim');
    expect(VERBATIM_KEYWORDS).toContain('what did i say');
    expect(VERBATIM_KEYWORDS).toContain('exact words');
    expect(VERBATIM_KEYWORDS).toContain('word for word');
    expect(VERBATIM_KEYWORDS).toContain('exactement');
    expect(VERBATIM_KEYWORDS).toContain('mot pour mot');
    expect(VERBATIM_KEYWORDS).toContain("qu'ai-je dit");
    expect(VERBATIM_KEYWORDS).toContain('точно');
    expect(VERBATIM_KEYWORDS).toContain('дословно');
    expect(VERBATIM_KEYWORDS).toContain('что я сказал');
  });
});

describe('retrieveContext — verbatim-keyword fast-path (RETR-02 dim 2)', () => {
  it.each([
    ['EN', 'what exactly did I write last month'],
    ['FR', "qu'ai-je dit le 3 mars"],
    ['RU', 'что я сказал в прошлом месяце'],
  ])('routes to verbatim-keyword for %s query — overrides 30-day age', async (_lang, query) => {
    const result = await retrieveContext({
      query,
      queryDate: daysAgo(30),
    });

    expect(result.reason).toBe('verbatim-keyword');
    expect(result.summary).toBeNull();
    expect(result.raw).toHaveLength(1);
    // The summary-fetch path must NOT be taken on the fast-path.
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
    // Decision log is emitted with the right reason.
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'verbatim-keyword' }),
      'pensieve.routing.decision',
    );
  });

  it('verbatim fast-path is case-insensitive', async () => {
    const result = await retrieveContext({
      query: 'WHAT EXACTLY did I commit to?',
      queryDate: daysAgo(60),
    });
    expect(result.reason).toBe('verbatim-keyword');
  });

  it('verbatim fast-path triggers even when queryDate is recent (overrides recency)', async () => {
    const result = await retrieveContext({
      query: 'tell me verbatim what I said',
      queryDate: daysAgo(2),
    });
    expect(result.reason).toBe('verbatim-keyword');
    // Recent queries without verbatim keyword would log reason: 'recent'.
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'verbatim-keyword' }),
      'pensieve.routing.decision',
    );
  });
});

describe('retrieveContext — recency boundary (RETR-02 dim 1)', () => {
  it('queryAge ≤ 7 days returns reason: recent with raw entries only', async () => {
    const result = await retrieveContext({
      query: 'how was monday',
      queryDate: daysAgo(3),
    });

    expect(result.reason).toBe('recent');
    expect(result.summary).toBeNull();
    expect(result.raw).toHaveLength(1);
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
    expect(mockHybridSearch).toHaveBeenCalledWith('how was monday', { limit: 10 });
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'recent', queryAge: 3 }),
      'pensieve.routing.decision',
    );
  });

  it('queryDate undefined degrades safely to recent (no summary fetch)', async () => {
    const result = await retrieveContext({ query: 'open-ended question' });

    expect(result.reason).toBe('recent');
    expect(result.summary).toBeNull();
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'recent', queryAge: null, hasQueryDate: false }),
      'pensieve.routing.decision',
    );
  });

  it('queryAge exactly 7 days is still treated as recent (boundary inclusive)', async () => {
    const result = await retrieveContext({
      query: 'on the boundary',
      queryDate: daysAgo(7),
    });
    expect(result.reason).toBe('recent');
    expect(mockGetEpisodicSummary).not.toHaveBeenCalled();
  });

  it('respects custom rawLimit on the recent branch', async () => {
    await retrieveContext({
      query: 'tighter cap',
      queryDate: daysAgo(1),
      rawLimit: 3,
    });
    expect(mockHybridSearch).toHaveBeenCalledWith('tighter cap', { limit: 3 });
  });
});

describe('retrieveContext — old-query summary path', () => {
  it('queryAge > 7d + no summary → no-summary-fallback with raw populated', async () => {
    mockGetEpisodicSummary.mockResolvedValueOnce(null);
    const result = await retrieveContext({
      query: 'what happened back then',
      queryDate: daysAgo(20),
    });

    expect(result.reason).toBe('no-summary-fallback');
    expect(result.summary).toBeNull();
    expect(result.raw).toHaveLength(1);
    expect(mockGetEpisodicSummary).toHaveBeenCalledTimes(1);
    expect(mockHybridSearch).toHaveBeenCalledWith('what happened back then', { limit: 10 });
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'no-summary-fallback', queryAge: 20 }),
      'pensieve.routing.decision',
    );
  });

  it('queryAge > 7d + importance < 8 → summary-only (raw is empty)', async () => {
    mockGetEpisodicSummary.mockResolvedValueOnce(makeSummary(5));
    const result = await retrieveContext({
      query: 'reflective question about that day',
      queryDate: daysAgo(20),
    });

    expect(result.reason).toBe('summary-only');
    expect(result.summary).not.toBeNull();
    expect(result.summary?.importance).toBe(5);
    expect(result.raw).toEqual([]);
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'summary-only',
        queryAge: 20,
        importance: 5,
        rawCount: 0,
      }),
      'pensieve.routing.decision',
    );
  });
});

describe('retrieveContext — high-importance raw descent (RETR-03)', () => {
  const e1Id = 'aaaaaaa1-1111-1111-1111-111111111111';
  const e2Id = 'bbbbbbb2-2222-2222-2222-222222222222';

  it.each([
    [7, 'summary-only'],
    [8, 'high-importance-descent'],
    [9, 'high-importance-descent'],
    [10, 'high-importance-descent'],
  ])('importance %i → reason %s (boundary inclusive at 8)', async (importance, expectedReason) => {
    const summary = makeSummary(importance, [e1Id, e2Id]);
    mockGetEpisodicSummary.mockResolvedValueOnce(summary);
    // Stub the loadEntriesByIds row set: it returns 2 entries when descent triggers.
    mockLoadEntriesByIdsRows.current = [
      makeEntryRow(e1Id, 'first key entry'),
      makeEntryRow(e2Id, 'second key entry'),
    ];

    const result = await retrieveContext({
      query: 'context for that day',
      queryDate: daysAgo(20),
    });

    expect(result.reason).toBe(expectedReason);
    expect(result.summary?.importance).toBe(importance);
    if (expectedReason === 'high-importance-descent') {
      expect(result.raw).toHaveLength(2);
      // Order is preserved per sourceEntryIds.
      expect(result.raw[0]?.entry.id).toBe(e1Id);
      expect(result.raw[1]?.entry.id).toBe(e2Id);
      expect(result.raw[0]?.score).toBe(1.0);
    } else {
      expect(result.raw).toEqual([]);
    }
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.objectContaining({ reason: expectedReason, queryAge: 20, importance }),
      'pensieve.routing.decision',
    );
  });

  it('high-importance with empty sourceEntryIds returns descent reason and empty raw (no DB call)', async () => {
    const summary = makeSummary(9, []);
    mockGetEpisodicSummary.mockResolvedValueOnce(summary);

    const result = await retrieveContext({
      query: 'edge case',
      queryDate: daysAgo(20),
    });

    expect(result.reason).toBe('high-importance-descent');
    expect(result.raw).toEqual([]);
    expect(result.summary).not.toBeNull();
  });
});

describe('retrieveContext — error path (never throws contract)', () => {
  it('getEpisodicSummary throws → reason: recent (fallback) + pensieve.routing.error log', async () => {
    mockGetEpisodicSummary.mockRejectedValueOnce(new Error('connection reset'));

    const result = await retrieveContext({
      query: 'old question that triggers DB',
      queryDate: daysAgo(20),
    });

    // Fallback path returns 'recent' (raw via hybridSearch) and never throws.
    expect(result.reason).toBe('recent');
    expect(result.raw).toHaveLength(1);
    expect(result.summary).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'connection reset' }),
      'pensieve.routing.error',
    );
  });

  it('hybridSearch throws inside fallback → returns empty raw (still no throw)', async () => {
    mockGetEpisodicSummary.mockRejectedValueOnce(new Error('boom'));
    mockHybridSearch.mockRejectedValueOnce(new Error('also broken'));

    const result = await retrieveContext({
      query: 'pathological case',
      queryDate: daysAgo(20),
    });

    expect(result.reason).toBe('recent');
    expect(result.raw).toEqual([]);
    expect(result.summary).toBeNull();
  });
});

describe('retrieveContext — no Anthropic SDK calls (RETR-02 fast-path is pure)', () => {
  afterAll(() => {
    // Cumulative assertion across the entire suite — the verbatim-keyword
    // fast-path must NEVER call the Haiku/Sonnet API in M008. Future Haiku
    // fallback is deferred to M009+ per REQUIREMENTS RETR-02.
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('runs at least one routing call so the afterAll cumulative assertion is meaningful', async () => {
    await retrieveContext({ query: 'sanity', queryDate: daysAgo(1) });
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 22.1 WR-01 — direct unit tests for summaryToSearchResult and
// hybridOptions passthrough. Previously covered only transitively via the 5
// mode test files; these anchor the contract at the routing layer so future
// drift fails fast here instead of breaking every mode suite.
// ════════════════════════════════════════════════════════════════════════════

describe('summaryToSearchResult (Phase 22.1 WR-01)', () => {
  const baseSummary: typeof import('../../db/schema.js').episodicSummaries.$inferSelect = {
    id: '11111111-1111-1111-1111-111111111111',
    summaryDate: '2026-03-15',
    summary: 'Greg reflected on relocation',
    importance: 5,
    topics: ['relocation', 'batumi'],
    emotionalArc: 'reflective',
    keyQuotes: [],
    sourceEntryIds: [],
    createdAt: new Date('2026-03-15T12:00:00Z'),
  };

  it('wraps the summary with score=1.0 sentinel (survives buildPensieveContext 0.3 threshold)', () => {
    const result = summaryToSearchResult(baseSummary);
    expect(result.score).toBe(1.0);
  });

  it('prepends labeled inline header to content', () => {
    const result = summaryToSearchResult(baseSummary);
    expect(result.entry.content).toContain(
      '[Episode Summary 2026-03-15 | importance=5/10 | topics=relocation, batumi]',
    );
    expect(result.entry.content).toContain('Greg reflected on relocation');
  });

  it('renders topics=none when the summary has no topics', () => {
    const result = summaryToSearchResult({ ...baseSummary, topics: [] });
    expect(result.entry.content).toContain('topics=none');
  });

  it('namespaces the synthetic id with episodic- prefix (spoofing mitigation)', () => {
    const result = summaryToSearchResult(baseSummary);
    expect(result.entry.id).toBe('episodic-11111111-1111-1111-1111-111111111111');
  });

  it('sets createdAt to UTC midnight of summaryDate', () => {
    const result = summaryToSearchResult(baseSummary);
    expect(result.entry.createdAt?.toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('marks source as episodic-summary (distinguishable from raw sources)', () => {
    const result = summaryToSearchResult(baseSummary);
    expect(result.entry.source).toBe('episodic-summary');
  });
});

describe('retrieveContext hybridOptions passthrough (Phase 22.1 WR-01)', () => {
  it('merges hybridOptions into hybridSearch call on the verbatim branch', async () => {
    await retrieveContext({
      query: 'what did I say exactly',
      hybridOptions: { tags: ['BELIEF'], recencyBias: 0.5, limit: 7 },
    });
    expect(mockHybridSearch).toHaveBeenCalledWith(
      'what did I say exactly',
      expect.objectContaining({ tags: ['BELIEF'], recencyBias: 0.5, limit: 7 }),
    );
  });

  it('merges hybridOptions into hybridSearch call on the recent branch', async () => {
    await retrieveContext({
      query: 'standard query',
      queryDate: daysAgo(1),
      hybridOptions: { tags: ['EMOTION'], recencyBias: 0.8, limit: 5 },
    });
    expect(mockHybridSearch).toHaveBeenCalledWith(
      'standard query',
      expect.objectContaining({ tags: ['EMOTION'], recencyBias: 0.8, limit: 5 }),
    );
  });

  it('merges hybridOptions into hybridSearch call on the no-summary-fallback branch', async () => {
    mockGetEpisodicSummary.mockResolvedValueOnce(null);
    await retrieveContext({
      query: 'old query',
      queryDate: daysAgo(20),
      hybridOptions: { tags: ['INTENTION'], limit: 9 },
    });
    expect(mockHybridSearch).toHaveBeenCalledWith(
      'old query',
      expect.objectContaining({ tags: ['INTENTION'], limit: 9 }),
    );
  });

  it('uses rawLimit when hybridOptions.limit is absent', async () => {
    await retrieveContext({
      query: 'q',
      rawLimit: 13,
      hybridOptions: { recencyBias: 0.5 },
    });
    expect(mockHybridSearch).toHaveBeenCalledWith(
      'q',
      expect.objectContaining({ limit: 13, recencyBias: 0.5 }),
    );
  });

  it('lets hybridOptions.limit override rawLimit when both are set', async () => {
    await retrieveContext({
      query: 'q',
      rawLimit: 13,
      hybridOptions: { limit: 7 },
    });
    expect(mockHybridSearch).toHaveBeenCalledWith(
      'q',
      expect.objectContaining({ limit: 7 }),
    );
  });

  it('falls back to default rawLimit=10 when neither rawLimit nor hybridOptions.limit is set', async () => {
    await retrieveContext({ query: 'q' });
    expect(mockHybridSearch).toHaveBeenCalledWith(
      'q',
      expect.objectContaining({ limit: 10 }),
    );
  });
});
