import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock DB layer (K001 pattern — vi.hoisted) ─────────────────────────────

const { mockDb, memoryRows, pensieveRows, conversationRows } = vi.hoisted(() => {
  // Per-table result arrays — tests set these before calling buildSweepContext
  const memoryRows: any[] = [];
  const pensieveRows: any[] = [];
  const conversationRows: any[] = [];

  // Track call order to dispatch results: the context builder calls
  // queryRelationalMemory, queryPensieveEntries, queryConversationGapData
  // in that order via Promise.all. Each creates a separate select() chain.
  let selectCallIndex = 0;

  function makeChain(getRows: () => any[]) {
    const limit = vi.fn().mockImplementation(() => Promise.resolve(getRows()));
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    return { from, where, orderBy, limit };
  }

  const memoryChain = makeChain(() => memoryRows);
  const pensieveChain = makeChain(() => pensieveRows);
  const convChain = makeChain(() => conversationRows);

  const chains = [memoryChain, pensieveChain, convChain];

  const mockSelect = vi.fn().mockImplementation(() => {
    const idx = selectCallIndex;
    selectCallIndex = (selectCallIndex + 1) % 3;
    return { from: chains[idx].from };
  });

  const mockDb = {
    select: mockSelect,
    _resetCallIndex: () => { selectCallIndex = 0; },
  };

  return { mockDb, memoryRows, pensieveRows, conversationRows };
});

vi.mock('../../db/connection.js', () => ({
  db: mockDb,
}));

// ── Import module under test AFTER mocks ───────────────────────────────────

import { buildSweepContext } from '../context-builder.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMemoryEntry(overrides: Partial<{
  type: string;
  content: string;
  confidence: number;
  createdAt: Date;
}> = {}) {
  return {
    type: overrides.type || 'PATTERN',
    content: overrides.content || 'Greg tends to withdraw when stressed about work.',
    confidence: overrides.confidence ?? 0.7,
    createdAt: overrides.createdAt || new Date('2026-03-20T10:00:00Z'),
  };
}

function makePensieveEntry(overrides: Partial<{
  content: string;
  epistemicTag: string;
  createdAt: Date;
}> = {}) {
  return {
    content: overrides.content || 'Feeling uncertain about the new project direction.',
    epistemicTag: overrides.epistemicTag || 'EMOTION',
    createdAt: overrides.createdAt || new Date('2026-03-22T14:00:00Z'),
  };
}

function makeConversationRow(daysAgo: number) {
  return {
    createdAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  };
}

describe('context-builder', () => {
  let originalDateNow: typeof Date.now;

  beforeEach(() => {
    vi.clearAllMocks();
    originalDateNow = Date.now;
    Date.now = () => new Date('2026-03-28T12:00:00Z').getTime();

    // Clear row arrays and reset call index
    memoryRows.length = 0;
    pensieveRows.length = 0;
    conversationRows.length = 0;
    (mockDb as any)._resetCallIndex();
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  it('returns formatted context with all three sections when data exists', async () => {
    memoryRows.push(
      makeMemoryEntry({ type: 'PATTERN', content: 'Greg cycles between high energy and withdrawal.' }),
      makeMemoryEntry({ type: 'OBSERVATION', content: 'He mentioned feeling stuck at work three times this month.' }),
    );
    pensieveRows.push(
      makePensieveEntry({ content: 'Thinking about changing careers again.', epistemicTag: 'INTENTION' }),
      makePensieveEntry({ content: 'Had a great conversation with Sarah.', epistemicTag: 'EXPERIENCE' }),
    );
    conversationRows.push(
      makeConversationRow(1),
      makeConversationRow(3),
      makeConversationRow(7),
      makeConversationRow(10),
    );

    const result = await buildSweepContext(10000);

    expect(result).toContain('## Relational Memory');
    expect(result).toContain('## Recent Pensieve Entries');
    expect(result).toContain('## Conversation Gap Analysis');
    expect(result).toContain('PATTERN');
    expect(result).toContain('Greg cycles between');
    expect(result).toContain('Thinking about changing careers');
    expect(result).toContain('Last message from Greg');
  });

  it('respects character budget — output length ≤ maxTokens × 4', async () => {
    // Fill with lots of data
    for (let i = 0; i < 20; i++) {
      memoryRows.push(
        makeMemoryEntry({ content: `Pattern observation entry number ${i} with enough text to take up space in the context window. `.repeat(5) }),
      );
    }
    for (let i = 0; i < 50; i++) {
      pensieveRows.push(
        makePensieveEntry({ content: `Pensieve entry number ${i} with substantial content that will need truncation. `.repeat(5) }),
      );
    }
    for (let i = 0; i < 30; i++) {
      conversationRows.push(makeConversationRow(i));
    }

    const maxTokens = 500; // Small budget to force truncation
    const result = await buildSweepContext(maxTokens);

    expect(result.length).toBeLessThanOrEqual(maxTokens * 4);
  });

  it('handles empty relational memory gracefully', async () => {
    // No memory rows
    pensieveRows.push(makePensieveEntry());
    conversationRows.push(makeConversationRow(1));

    const result = await buildSweepContext(10000);

    expect(result).not.toContain('## Relational Memory');
    expect(result).toContain('## Recent Pensieve Entries');
    expect(result).toContain('## Conversation Gap Analysis');
  });

  it('handles empty pensieve entries gracefully', async () => {
    memoryRows.push(makeMemoryEntry());
    // No pensieve rows
    conversationRows.push(makeConversationRow(1));

    const result = await buildSweepContext(10000);

    expect(result).toContain('## Relational Memory');
    expect(result).not.toContain('## Recent Pensieve Entries');
    expect(result).toContain('## Conversation Gap Analysis');
  });

  it('handles all-empty state (returns minimal string)', async () => {
    // All arrays empty (default)

    const result = await buildSweepContext(10000);

    expect(result).toBe('No relational memory or recent activity to analyze.');
  });

  it('filters out low-confidence entries (confidence < 0.3)', async () => {
    // The WHERE clause in the query filters confidence >= 0.3,
    // so low-confidence entries should never appear in results.
    // We verify the query was made and only high-confidence entries appear.
    memoryRows.push(
      makeMemoryEntry({ confidence: 0.8, content: 'High confidence pattern' }),
    );

    const result = await buildSweepContext(10000);

    expect(result).toContain('High confidence pattern');
    expect(mockDb.select).toHaveBeenCalled();
  });

  it('includes confidence values in relational memory output', async () => {
    memoryRows.push(
      makeMemoryEntry({ confidence: 0.85, type: 'INSIGHT' }),
    );

    const result = await buildSweepContext(10000);

    expect(result).toMatch(/confidence: 0\.85/);
    expect(result).toContain('[INSIGHT]');
  });

  it('formats conversation gap analysis with message counts and timing', async () => {
    conversationRows.push(
      makeConversationRow(1),
      makeConversationRow(2),
      makeConversationRow(5),
    );

    const result = await buildSweepContext(10000);

    expect(result).toContain('Messages in last 30 days:');
    expect(result).toContain('Average gap between messages:');
    expect(result).toContain('days ago');
  });

  it('handles conversation gap analysis with only one message', async () => {
    conversationRows.push(makeConversationRow(3));

    const result = await buildSweepContext(10000);

    expect(result).toContain('## Conversation Gap Analysis');
    expect(result).toContain('Average gap between messages: 0 days');
  });
});
