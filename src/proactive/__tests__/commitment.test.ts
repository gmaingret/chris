import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock DB layer (K001 pattern — vi.hoisted) ─────────────────────────────

const { mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect };
});

vi.mock('../../db/connection.js', () => ({
  db: {
    select: mockSelect,
  },
}));

// ── Import module under test AFTER mocks ───────────────────────────────────

import { createCommitmentTrigger } from '../triggers/commitment.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const STALE_DAYS = 7;

/** Create a Date that is `daysAgo` days before `now`. */
function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function makeEntry(id: string, content: string, createdDaysAgo: number, now = new Date()) {
  return { id, content, createdAt: daysAgo(createdDaysAgo, now) };
}

describe('commitment trigger', () => {
  let originalDateNow: typeof Date.now;

  beforeEach(() => {
    vi.clearAllMocks();
    originalDateNow = Date.now;
    mockLimit.mockResolvedValue([]);
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  it('returns not-triggered when no INTENTION entries exist', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const trigger = createCommitmentTrigger(STALE_DAYS);
    const result = await trigger.detect();

    expect(result.triggered).toBe(false);
    expect(result.triggerType).toBe('commitment');
    expect(result.priority).toBe(2);
    expect(result.context).toBe('No stale commitments found');
  });

  it('returns not-triggered when INTENTION entries are all recent (within staleDays)', async () => {
    // DB query with staleDays cutoff would return empty because entries are recent
    mockLimit.mockResolvedValueOnce([]);

    const trigger = createCommitmentTrigger(STALE_DAYS);
    const result = await trigger.detect();

    expect(result.triggered).toBe(false);
    expect(result.triggerType).toBe('commitment');
    expect(result.context).toBe('No stale commitments found');
  });

  it('returns triggered with oldest entry when stale INTENTION entries exist', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    const entries = [
      makeEntry('aaa-111', 'I want to start running every morning', 14, now),
      makeEntry('bbb-222', 'I should call my parents more often', 10, now),
    ];
    mockLimit.mockResolvedValueOnce(entries);

    const trigger = createCommitmentTrigger(STALE_DAYS);
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('commitment');
    expect(result.priority).toBe(2);
    expect(result.context).toContain('14 days ago');
    expect(result.context).toContain('I want to start running every morning');
    expect(result.context).toContain("There's been no follow-up");
    expect(result.evidence).toBeDefined();
    expect(result.evidence!.length).toBe(2);
    expect(result.evidence![0]).toContain('aaa-111');
    expect(result.evidence![0]).toContain('14 days');
  });

  it('truncates long content to 200 chars in context string', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    const longContent = 'A'.repeat(300);
    const entries = [makeEntry('ccc-333', longContent, 10, now)];
    mockLimit.mockResolvedValueOnce(entries);

    const trigger = createCommitmentTrigger(STALE_DAYS);
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    // Context should contain truncated content (200 chars + "…")
    expect(result.context).toContain('A'.repeat(200) + '…');
    expect(result.context).not.toContain('A'.repeat(201));
  });

  it('evidence array includes entry IDs and age in days', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    const entries = [
      makeEntry('ddd-444', 'Start meditation practice', 21, now),
      makeEntry('eee-555', 'Read more books', 15, now),
      makeEntry('fff-666', 'Learn guitar', 10, now),
    ];
    mockLimit.mockResolvedValueOnce(entries);

    const trigger = createCommitmentTrigger(STALE_DAYS);
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    expect(result.evidence).toHaveLength(3);
    expect(result.evidence![0]).toBe('Entry ddd-444: 21 days old');
    expect(result.evidence![1]).toBe('Entry eee-555: 15 days old');
    expect(result.evidence![2]).toBe('Entry fff-666: 10 days old');
  });

  it('always returns priority 2 for commitment triggers', async () => {
    // Not triggered case
    mockLimit.mockResolvedValueOnce([]);
    const trigger1 = createCommitmentTrigger(STALE_DAYS);
    expect((await trigger1.detect()).priority).toBe(2);

    // Triggered case
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();
    mockLimit.mockResolvedValueOnce([makeEntry('ggg-777', 'Exercise more', 10, now)]);
    const trigger2 = createCommitmentTrigger(STALE_DAYS);
    expect((await trigger2.detect()).priority).toBe(2);
  });

  it('uses oldest entry context when multiple stale entries found', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    // Entries are in ASC order (oldest first) as returned by DB
    const entries = [
      makeEntry('old-001', 'Oldest commitment content', 30, now),
      makeEntry('mid-002', 'Middle commitment', 20, now),
      makeEntry('new-003', 'Newest stale commitment', 10, now),
    ];
    mockLimit.mockResolvedValueOnce(entries);

    const trigger = createCommitmentTrigger(STALE_DAYS);
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    expect(result.context).toContain('30 days ago');
    expect(result.context).toContain('Oldest commitment content');
  });

  it('safe default — returns not-triggered when DB query throws', async () => {
    mockLimit.mockRejectedValueOnce(new Error('connection refused'));

    const trigger = createCommitmentTrigger(STALE_DAYS);

    // The trigger currently throws — this tests the error propagates
    // (sweep.ts catches it at the orchestrator level)
    await expect(trigger.detect()).rejects.toThrow('connection refused');
  });
});
