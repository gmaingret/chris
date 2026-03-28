import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock DB layer (K001 pattern — vi.hoisted) ─────────────────────────────

const { mockOrderBy, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockOrderBy = vi.fn().mockResolvedValue([]);
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { mockOrderBy, mockWhere, mockFrom, mockSelect };
});

vi.mock('../../db/connection.js', () => ({
  db: {
    select: mockSelect,
  },
}));

// ── Import module under test AFTER mocks ───────────────────────────────────

import { createSilenceTrigger } from '../triggers/silence.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const CHAT_ID = 12345n;
const DEFAULT_CONFIG = { thresholdMultiplier: 2, baselineDays: 14 };

/** Create a Date that is `daysAgo` days before `now`. */
function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Generate an array of mock USER message rows with evenly spaced created_at
 * timestamps, from `startDaysAgo` to `endDaysAgo`, with `count` messages.
 * Returns rows sorted by created_at DESC (newest first) as the query would.
 */
function generateMessageRows(
  count: number,
  startDaysAgo: number,
  endDaysAgo: number,
  now = new Date(),
): { createdAt: Date }[] {
  const rows: { createdAt: Date }[] = [];
  const spanDays = startDaysAgo - endDaysAgo;

  for (let i = 0; i < count; i++) {
    const dayOffset = startDaysAgo - (spanDays * i) / (count - 1);
    rows.push({ createdAt: daysAgo(dayOffset, now) });
  }

  // Sort DESC (newest first) — matches DB query order
  return rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

describe('silence trigger', () => {
  let originalDateNow: typeof Date.now;

  beforeEach(() => {
    vi.clearAllMocks();
    originalDateNow = Date.now;
    // Reset default chain behavior
    mockOrderBy.mockResolvedValue([]);
  });

  afterEach(() => {
    Date.now = originalDateNow;
  });

  it('triggers when current gap exceeds threshold × average (14+ days of daily messages, 3-day silence)', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    // 15 daily messages from day 17 to day 3 → avg gap ~1 day
    // Last message 3 days ago → current gap = 3 days > 2× 1 day
    const rows = generateMessageRows(15, 17, 3, now);
    mockOrderBy.mockResolvedValueOnce(rows);

    const trigger = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('silence');
    expect(result.priority).toBe(1);
    expect(result.context).toMatch(/John has been quiet for/);
    expect(result.context).toMatch(/days/);
    expect(result.context).toMatch(/His usual rhythm is about/);
    expect(result.evidence).toBeDefined();
    expect(result.evidence!.length).toBeGreaterThan(0);
  });

  it('does not trigger when current gap is within normal range', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    // 15 daily messages from day 15 to day 1 → avg gap ~1 day
    // Last message 1 day ago → current gap = 1 day < 2× 1 day
    const rows = generateMessageRows(15, 15, 1, now);
    mockOrderBy.mockResolvedValueOnce(rows);

    const trigger = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    const result = await trigger.detect();

    expect(result.triggered).toBe(false);
    expect(result.triggerType).toBe('silence');
    expect(result.priority).toBe(1);
    expect(result.context).toMatch(/within normal range/);
  });

  it('returns not triggered with "Insufficient history" when only 5 days of history', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    // 5 messages over 5 days — less than 14-day baseline
    const rows = generateMessageRows(5, 5, 0, now);
    mockOrderBy.mockResolvedValueOnce(rows);

    const trigger = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    const result = await trigger.detect();

    expect(result.triggered).toBe(false);
    expect(result.triggerType).toBe('silence');
    expect(result.priority).toBe(1);
    expect(result.context).toBe('Insufficient history');
  });

  it('returns not triggered when only 1 message exists', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    mockOrderBy.mockResolvedValueOnce([{ createdAt: daysAgo(5, now) }]);

    const trigger = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    const result = await trigger.detect();

    expect(result.triggered).toBe(false);
    expect(result.triggerType).toBe('silence');
    expect(result.priority).toBe(1);
    expect(result.context).toBe('Insufficient history');
  });

  it('triggers at edge case — exactly 14 days of history, gap exactly at 2×', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    // 15 messages, exactly 14-day span from day 16 to day 2
    // Average gap = 14 days / 14 gaps = 1 day
    // Last message at day 2 → current gap = 2 days = exactly 2× average
    // Since we check > (strict), exactly 2× should NOT trigger
    // To make it trigger, set gap to just over 2×
    const rows = generateMessageRows(15, 16, 2, now);

    // Override last message to be 2.01 days ago to just exceed threshold
    // Actually let's make a cleaner test: gap clearly exceeds 2x
    // With 15 msgs from day 16 to day 2, avg gap = 1 day, current gap = 2 days
    // 2 > 2*1 is false (not strictly greater), so let's adjust:
    // Use messages from day 16.1 to day 2.1, making current gap = 2.1 days > 2*1 = 2
    const rowsAdjusted = generateMessageRows(15, 16.1, 2.1, now);
    mockOrderBy.mockResolvedValueOnce(rowsAdjusted);

    const trigger = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('silence');
    expect(result.priority).toBe(1);
    expect(result.context).toMatch(/days/);
  });

  it('context string uses human-readable day durations, not hours', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    // 20 messages over 20 days, last message 5 days ago → big gap
    const rows = generateMessageRows(20, 25, 5, now);
    mockOrderBy.mockResolvedValueOnce(rows);

    const trigger = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    // Context should contain "days" not "hours"
    expect(result.context).toMatch(/\d+\.?\d*\s+days?/);
    expect(result.context).not.toMatch(/hours/);
  });

  it('always returns priority 1 for silence triggers', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    // Test triggered case
    const rows1 = generateMessageRows(15, 17, 3, now);
    mockOrderBy.mockResolvedValueOnce(rows1);
    const trigger1 = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    expect((await trigger1.detect()).priority).toBe(1);

    // Test not-triggered case
    const rows2 = generateMessageRows(15, 15, 1, now);
    mockOrderBy.mockResolvedValueOnce(rows2);
    const trigger2 = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    expect((await trigger2.detect()).priority).toBe(1);

    // Test insufficient history case
    mockOrderBy.mockResolvedValueOnce([]);
    const trigger3 = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    expect((await trigger3.detect()).priority).toBe(1);
  });

  it('respects custom baselineDays config', async () => {
    const now = new Date('2026-03-28T12:00:00Z');
    Date.now = () => now.getTime();

    // 10 messages over 10 days — insufficient for default 14, but enough for 7
    const rows = generateMessageRows(10, 13, 3, now);
    mockOrderBy.mockResolvedValueOnce(rows);

    const trigger = createSilenceTrigger(CHAT_ID, {
      thresholdMultiplier: 2,
      baselineDays: 7,
    });
    const result = await trigger.detect();

    // Should NOT return "Insufficient history" since we only need 7 days
    expect(result.context).not.toBe('Insufficient history');
  });

  it('returns not triggered when zero messages exist', async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    const trigger = createSilenceTrigger(CHAT_ID, DEFAULT_CONFIG);
    const result = await trigger.detect();

    expect(result.triggered).toBe(false);
    expect(result.context).toBe('Insufficient history');
  });
});
