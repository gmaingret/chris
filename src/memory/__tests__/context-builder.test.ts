import { describe, it, expect, vi } from 'vitest';

// ── Mock db (needed by conversation.ts transitive import) ──────────────────
const mockLimit = vi.fn();
const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));
const mockReturning = vi.fn();
const mockValues = vi.fn(() => ({ returning: mockReturning }));
const mockInsert = vi.fn(() => ({ values: mockValues }));

vi.mock('../../db/connection.js', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}));

// ── Mock logger ────────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import modules under test ──────────────────────────────────────────────
const { buildPensieveContext, buildMessageHistory } = await import(
  '../context-builder.js'
);

// ── Test fixtures ──────────────────────────────────────────────────────────
import type { SearchResult } from '../../pensieve/retrieve.js';

function makeResult(
  overrides: {
    content?: string;
    createdAt?: Date | null;
    epistemicTag?: string | null;
    score?: number;
    id?: string;
  } = {},
): SearchResult {
  return {
    entry: {
      id: overrides.id ?? 'entry-1',
      content: overrides.content ?? 'Test content',
      createdAt: 'createdAt' in overrides ? overrides.createdAt : new Date('2025-03-15'),
      epistemicTag: 'epistemicTag' in overrides ? overrides.epistemicTag : 'EXPERIENCE',
      source: 'telegram',
      deletedAt: null,
      metadata: null,
    },
    score: overrides.score ?? 0.85,
  } as SearchResult;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('buildPensieveContext', () => {
  it('formats entries with numbered citation blocks', () => {
    const results = [
      makeResult({
        content: 'I grew up by the coast',
        createdAt: new Date('2025-01-15'),
        epistemicTag: 'EXPERIENCE',
        score: 0.87,
      }),
    ];

    const context = buildPensieveContext(results);

    expect(context).toBe(
      '[1] (2025-01-15 | EXPERIENCE | 0.87) "I grew up by the coast"',
    );
  });

  it('formats multiple entries with correct numbering', () => {
    const results = [
      makeResult({ content: 'First entry', score: 0.9 }),
      makeResult({ content: 'Second entry', score: 0.7, id: 'entry-2' }),
    ];

    const context = buildPensieveContext(results);
    const lines = context.split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[1\]/);
    expect(lines[1]).toMatch(/^\[2\]/);
  });

  it('includes date, epistemic tag, and score in each block', () => {
    const results = [
      makeResult({
        createdAt: new Date('2025-06-20'),
        epistemicTag: 'REFLECTION',
        score: 0.65,
      }),
    ];

    const context = buildPensieveContext(results);

    expect(context).toContain('2025-06-20');
    expect(context).toContain('REFLECTION');
    expect(context).toContain('0.65');
  });

  it('filters out results with score < 0.3', () => {
    const results = [
      makeResult({ content: 'Above threshold', score: 0.5 }),
      makeResult({ content: 'Below threshold', score: 0.2, id: 'entry-2' }),
      makeResult({ content: 'Way below', score: 0.1, id: 'entry-3' }),
    ];

    const context = buildPensieveContext(results);

    expect(context).toContain('Above threshold');
    expect(context).not.toContain('Below threshold');
    expect(context).not.toContain('Way below');
  });

  it('returns empty string for empty input array', () => {
    const context = buildPensieveContext([]);

    expect(context).toBe('');
  });

  it('returns empty string when all results are below threshold', () => {
    const results = [
      makeResult({ score: 0.29 }),
      makeResult({ score: 0.1, id: 'entry-2' }),
    ];

    const context = buildPensieveContext(results);

    expect(context).toBe('');
  });

  it('preserves entry order (highest score first as returned by searchPensieve)', () => {
    const results = [
      makeResult({ content: 'Highest', score: 0.95 }),
      makeResult({ content: 'Middle', score: 0.75, id: 'entry-2' }),
      makeResult({ content: 'Lowest passing', score: 0.31, id: 'entry-3' }),
    ];

    const context = buildPensieveContext(results);
    const lines = context.split('\n');

    expect(lines[0]).toContain('Highest');
    expect(lines[1]).toContain('Middle');
    expect(lines[2]).toContain('Lowest passing');
  });

  it('handles entries with null createdAt', () => {
    const results = [makeResult({ createdAt: null, score: 0.5 })];

    const context = buildPensieveContext(results);

    expect(context).toContain('unknown-date');
  });

  it('handles entries with null epistemicTag', () => {
    const results = [makeResult({ epistemicTag: null, score: 0.5 })];

    const context = buildPensieveContext(results);

    expect(context).toContain('UNTAGGED');
  });

  it('includes results with score exactly 0.3 (boundary)', () => {
    const results = [makeResult({ content: 'Boundary entry', score: 0.3 })];

    const context = buildPensieveContext(results);

    expect(context).toContain('Boundary entry');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('buildMessageHistory', () => {
  it('returns empty array when no history exists', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const result = await buildMessageHistory(12345n);

    expect(result).toEqual([]);
  });

  it('maps USER/ASSISTANT roles correctly', async () => {
    // Mock returns DESC order (newest first); getRecentHistory reverses to chronological
    mockLimit.mockResolvedValueOnce([
      { role: 'ASSISTANT', content: 'Hi there' },
      { role: 'USER', content: 'Hello' },
    ]);

    const result = await buildMessageHistory(12345n);

    expect(result).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
  });

  it('merges consecutive same-role messages', async () => {
    // Mock returns DESC order (newest first); getRecentHistory reverses to chronological
    mockLimit.mockResolvedValueOnce([
      { role: 'ASSISTANT', content: 'Response' },
      { role: 'USER', content: 'Second' },
      { role: 'USER', content: 'First' },
    ]);

    const result = await buildMessageHistory(12345n);

    expect(result).toHaveLength(2);
    expect(result[0]!.content).toBe('First\n\nSecond');
    expect(result[1]!.content).toBe('Response');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


describe('buildRelationalContext', async () => {
  const { buildRelationalContext } = await import('../context-builder.js');

  it('returns fallback message for empty array', () => {
    const result = buildRelationalContext([]);
    expect(result).toBe('No observations accumulated yet.');
  });

  it('formats a single observation with date, type, and confidence', () => {
    const result = buildRelationalContext([
      {
        id: 'rm1',
        type: 'PATTERN',
        content: 'Avoids conflict in work situations',
        confidence: 0.85,
        createdAt: new Date('2026-03-15'),
      },
    ]);

    expect(result).toContain('[1]');
    expect(result).toContain('2026-03-15');
    expect(result).toContain('PATTERN');
    expect(result).toContain('0.85');
    expect(result).toContain('Avoids conflict');
  });

  it('formats multiple observations as numbered list', () => {
    const result = buildRelationalContext([
      {
        id: 'rm1', type: 'PATTERN', content: 'First',
        confidence: 0.8, createdAt: new Date('2026-03-10'),
      },
      {
        id: 'rm2', type: 'INSIGHT', content: 'Second',
        confidence: 0.6, createdAt: new Date('2026-03-12'),
      },
    ]);

    expect(result).toContain('[1]');
    expect(result).toContain('[2]');
    expect(result).toContain('PATTERN');
    expect(result).toContain('INSIGHT');
  });

  it('uses default confidence 0.50 when null', () => {
    const result = buildRelationalContext([
      {
        id: 'rm1', type: 'OBSERVATION', content: 'Something',
        confidence: null, createdAt: new Date('2026-03-15'),
      },
    ]);

    expect(result).toContain('0.50');
  });

  it('uses unknown-date when createdAt is null', () => {
    const result = buildRelationalContext([
      {
        id: 'rm1', type: 'CONCERN', content: 'Something',
        confidence: 0.7, createdAt: null,
      },
    ]);

    expect(result).toContain('unknown-date');
  });
});
