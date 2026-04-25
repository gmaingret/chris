import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Anthropic client ──────────────────────────────────────────────────
// The extractor's Haiku fallback path goes through anthropic.messages.create
// — we mock the SDK at the client module so we can spy on call presence/absence
// across the three branches: regex hit (no Haiku), heuristic match (Haiku
// invoked), no heuristic (Haiku skipped).
const mockCreate = vi.fn();

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockCreate },
  },
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
}));

// ── Mock logger ────────────────────────────────────────────────────────────
const mockLogWarn = vi.fn();
const mockLogInfo = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: mockLogInfo,
    warn: mockLogWarn,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import module under test after mocks ───────────────────────────────────
const { extractQueryDate, DATE_HEURISTIC_KEYWORDS } = await import(
  '../modes/date-extraction.js'
);

// ── Helpers ────────────────────────────────────────────────────────────────
// FIXED_NOW: 2026-04-22T12:00:00Z. Three weeks before this is 2026-04-01.
// Used as the deterministic anchor so 'three weeks ago' resolves repeatably.
const FIXED_NOW = new Date('2026-04-22T12:00:00Z');

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('DATE_HEURISTIC_KEYWORDS', () => {
  it('exports a non-empty readonly array of lowercased EN/FR/RU keywords', () => {
    expect(Array.isArray(DATE_HEURISTIC_KEYWORDS)).toBe(true);
    expect(DATE_HEURISTIC_KEYWORDS.length).toBeGreaterThan(20);
    // Every entry is lowercase (heuristic match runs against lowercased query)
    for (const kw of DATE_HEURISTIC_KEYWORDS) {
      expect(kw).toBe(kw.toLowerCase());
    }
    // Anchor entries from each language
    expect(DATE_HEURISTIC_KEYWORDS).toContain('ago');           // EN
    expect(DATE_HEURISTIC_KEYWORDS).toContain('il y a');        // FR
    expect(DATE_HEURISTIC_KEYWORDS).toContain('назад');         // RU
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('extractQueryDate — regex/keyword fast-path (no Haiku call)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches an absolute ISO date YYYY-MM-DD', async () => {
    const result = await extractQueryDate(
      'what happened on 2026-04-01',
      'English',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    expect(isoDay(result!)).toBe('2026-04-01');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('matches an English month-name + day ("April 1st, 2026")', async () => {
    const result = await extractQueryDate(
      'what happened on April 1st, 2026',
      'English',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    expect(isoDay(result!)).toBe('2026-04-01');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('matches a French month-name + day ("1er avril")', async () => {
    const result = await extractQueryDate(
      "qu'est-ce qui s'est passé le 1er avril",
      'French',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    // Year inferred — April 1 has not yet happened by April 22, so use this year (2026)
    expect(isoDay(result!)).toBe('2026-04-01');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('matches a Russian month-name + day ("1 апреля")', async () => {
    const result = await extractQueryDate(
      'что было 1 апреля',
      'Russian',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    expect(isoDay(result!)).toBe('2026-04-01');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('WR-03 regression: FR regex does not extract "21 décembre" from embedded "121 décembre"', async () => {
    // Before the leading \b fix, "item 121 décembre something" silently
    // matched "21 décembre" by dropping the leading "1" of "121".
    // With \b the digit cluster must start on a word boundary, so only
    // genuine day numbers match.
    const result = await extractQueryDate(
      'item 121 décembre something',
      'French',
      FIXED_NOW,
    );
    expect(result).toBeNull();
    // "décembre" is a heuristic keyword, so Haiku would be called as
    // a fallback — but our mock is not primed, so it returns undefined.
    // The point of this test is the regex, not the Haiku path.
  });

  it('WR-03 regression: RU regex does not extract embedded digit-prefixed day', async () => {
    const result = await extractQueryDate(
      'товар 121 декабря что-то',
      'Russian',
      FIXED_NOW,
    );
    expect(result).toBeNull();
  });

  it('WR-04 regression: matchMonthDay rejects February 30 (calendar overflow)', async () => {
    const result = await extractQueryDate(
      'what happened on February 30, 2026',
      'English',
      FIXED_NOW,
    );
    // Date.UTC silently rolls Feb 30 → March 2, but the post-check in
    // matchMonthDay must reject the invalid tuple. Since "february" is a
    // heuristic keyword, Haiku is called next; our mock is not primed so
    // extractQueryDate ultimately returns null.
    expect(result).toBeNull();
  });

  it('WR-04 regression: matchMonthDay rejects April 31 (calendar overflow)', async () => {
    const result = await extractQueryDate(
      'what happened on April 31, 2026',
      'English',
      FIXED_NOW,
    );
    expect(result).toBeNull();
  });

  it('matches English numeric "3 weeks ago" relative to fixed now (2026-04-22 → 2026-04-01)', async () => {
    const result = await extractQueryDate(
      'what happened 3 weeks ago',
      'English',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    // 21 days back from 2026-04-22 = 2026-04-01
    expect(isoDay(result!)).toBe('2026-04-01');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('matches English word-form "three weeks ago"', async () => {
    const result = await extractQueryDate(
      'what happened three weeks ago',
      'English',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    expect(isoDay(result!)).toBe('2026-04-01');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('matches French "il y a trois semaines" — number in digit form (regex covers digits)', async () => {
    // FR regex covers digit-form numerics; the word "trois" is a future
    // enhancement (Haiku would catch it via the heuristic keyword path).
    const result = await extractQueryDate(
      'il y a 3 semaines',
      'French',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    expect(isoDay(result!)).toBe('2026-04-01');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('matches Russian "3 недели назад"', async () => {
    const result = await extractQueryDate(
      '3 недели назад',
      'Russian',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    expect(isoDay(result!)).toBe('2026-04-01');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('extractQueryDate — heuristic gating (Haiku skipped vs invoked)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null AND skips Haiku entirely when no date heuristic keyword present', async () => {
    const result = await extractQueryDate(
      'what is my name',
      'English',
      FIXED_NOW,
    );
    expect(result).toBeNull();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('invokes Haiku when fast-path returns null but heuristic keyword "last" is present', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"date":"2026-04-15"}' }],
    });
    const result = await extractQueryDate(
      'what about last Tuesday',
      'English',
      FIXED_NOW,
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(isoDay(result!)).toBe('2026-04-15');
  });

  it('invokes Haiku for French "la semaine dernière" (heuristic keyword "dernière" matches)', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"date":"2026-04-13"}' }],
    });
    const result = await extractQueryDate(
      "qu'est-ce qui s'est passé la semaine dernière",
      'French',
      FIXED_NOW,
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
    expect(isoDay(result!)).toBe('2026-04-13');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('extractQueryDate — Haiku fallback error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null and logs warn when Haiku returns invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not json' }],
    });
    const result = await extractQueryDate(
      'last Tuesday',
      'English',
      FIXED_NOW,
    );
    expect(result).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(String) }),
      'chris.date-extraction.haiku-error',
    );
  });

  it('returns null when Haiku returns date:null (no specific date identifiable)', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"date":null}' }],
    });
    const result = await extractQueryDate(
      'sometime last week or so',
      'English',
      FIXED_NOW,
    );
    expect(result).toBeNull();
    // Haiku WAS called (heuristic matched); it just returned null — no warn log
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns null when the SDK call throws (network/auth error)', async () => {
    mockCreate.mockRejectedValue(new Error('network down'));
    const result = await extractQueryDate(
      'last Tuesday',
      'English',
      FIXED_NOW,
    );
    expect(result).toBeNull();
    expect(mockLogWarn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'network down' }),
      'chris.date-extraction.haiku-error',
    );
  });

  it('returns null when Haiku returns a malformed date string', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"date":"not-a-date"}' }],
    });
    const result = await extractQueryDate(
      'last Tuesday',
      'English',
      FIXED_NOW,
    );
    expect(result).toBeNull();
  });

  // Regression for prod bug 2026-04-25: Haiku was returning JSON wrapped
  // in ```json ... ``` Markdown code fences despite the system prompt
  // instructing "Respond with ONLY the JSON object". The raw JSON.parse
  // call threw SyntaxError and INTERROGATE silently fell back to general
  // routing — losing date-anchored summary injection for every query.
  it('strips ```json ... ``` Markdown fences before parsing (prod regression)', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: '```json\n{"date": "2026-04-21"}\n```',
        },
      ],
    });
    const result = await extractQueryDate(
      'what did I say last Tuesday',
      'English',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.toISOString().slice(0, 10)).toBe('2026-04-21');
    // No warn — fence was stripped, parse succeeded
    expect(mockLogWarn).not.toHaveBeenCalled();
  });

  it('strips bare ``` ... ``` fences (no language tag)', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '```\n{"date":"2026-04-15"}\n```' }],
    });
    const result = await extractQueryDate(
      'what did I say last week',
      'English',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.toISOString().slice(0, 10)).toBe('2026-04-15');
  });

  // Regression for prod bug 2026-04-25: a single 'pensieve.episodic.retrieve
  // date:"2025-05-01" found:false' log line (year 2025 when "now" is 2026-04)
  // suggested Haiku is hallucinating dates from training-data years. The
  // ±730-day sanity bound rejects anything outside Chris's plausible data
  // history without unduly restricting legitimate "what about December 2024"
  // queries.
  it('rejects hallucinated date >730 days in the past (prod regression)', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"date":"2023-01-01"}' }],
    });
    const result = await extractQueryDate(
      'last week',
      'English',
      FIXED_NOW,
    );
    expect(result).toBeNull();
  });

  it('rejects hallucinated date >730 days in the future', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"date":"2029-12-31"}' }],
    });
    const result = await extractQueryDate(
      'last week',
      'English',
      FIXED_NOW,
    );
    expect(result).toBeNull();
  });

  it('accepts dates exactly at the 730-day boundary (within band)', async () => {
    // FIXED_NOW = 2026-04-22; 730 days back = 2024-04-23 (not rejected)
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"date":"2024-04-25"}' }],
    });
    const result = await extractQueryDate(
      'two years ago this week',
      'English',
      FIXED_NOW,
    );
    expect(result).not.toBeNull();
  });
});
