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
const { buildPensieveContext, buildMessageHistory, buildRelationalContext } = await import(
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
      updatedAt: null,
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
    mockLimit.mockResolvedValueOnce([
      { role: 'USER', content: 'Hello' },
      { role: 'ASSISTANT', content: 'Hi there' },
    ]);

    const result = await buildMessageHistory(12345n);

    expect(result).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]);
  });

  it('merges consecutive same-role messages', async () => {
    mockLimit.mockResolvedValueOnce([
      { role: 'USER', content: 'First' },
      { role: 'USER', content: 'Second' },
      { role: 'ASSISTANT', content: 'Response' },
    ]);

    const result = await buildMessageHistory(12345n);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('First\n\nSecond');
    expect(result[1].content).toBe('Response');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import type { RelationalMemory } from '../../memory/relational.js';

function makeRelational(
  overrides: Partial<RelationalMemory> = {},
): RelationalMemory {
  return {
    id: overrides.id ?? 'rel-1',
    type: overrides.type ?? 'PATTERN',
    content: overrides.content ?? 'Greg tends to journal more on Sundays',
    confidence: 'confidence' in overrides ? overrides.confidence ?? null : 0.85,
    createdAt: 'createdAt' in overrides ? overrides.createdAt ?? null : new Date('2025-03-15'),
  };
}

describe('buildRelationalContext', () => {
  it('returns fallback message for empty array', () => {
    const context = buildRelationalContext([]);

    expect(context).toBe('No observations accumulated yet.');
  });

  it('formats a single memory with correct citation format', () => {
    const memories = [
      makeRelational({
        content: 'Greg tends to journal more on Sundays',
        createdAt: new Date('2025-03-15'),
        type: 'PATTERN',
        confidence: 0.85,
      }),
    ];

    const context = buildRelationalContext(memories);

    expect(context).toBe(
      '[1] (2025-03-15 | PATTERN | 0.85) "Greg tends to journal more on Sundays"',
    );
  });

  it('formats multiple memories with incrementing indices', () => {
    const memories = [
      makeRelational({ content: 'First observation', id: 'rel-1' }),
      makeRelational({ content: 'Second observation', id: 'rel-2' }),
      makeRelational({ content: 'Third observation', id: 'rel-3' }),
    ];

    const context = buildRelationalContext(memories);
    const lines = context.split('\n');

    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^\[1\]/);
    expect(lines[1]).toMatch(/^\[2\]/);
    expect(lines[2]).toMatch(/^\[3\]/);
    expect(lines[0]).toContain('First observation');
    expect(lines[2]).toContain('Third observation');
  });

  it('handles null createdAt with unknown-date', () => {
    const memories = [makeRelational({ createdAt: null })];

    const context = buildRelationalContext(memories);

    expect(context).toContain('unknown-date');
  });

  it('includes type and confidence in output', () => {
    const memories = [
      makeRelational({ type: 'OBSERVATION', confidence: 0.72 }),
    ];

    const context = buildRelationalContext(memories);

    expect(context).toContain('OBSERVATION');
    expect(context).toContain('0.72');
  });

  it('handles null confidence with default 0.50', () => {
    const memories = [makeRelational({ confidence: null })];

    const context = buildRelationalContext(memories);

    expect(context).toContain('0.50');
  });
});
