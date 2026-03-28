import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (K001) ──────────────────────────────────────────────────

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockCreate } },
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  SONNET_MODEL: 'claude-sonnet-4-6',
}));

vi.mock('../../config.js', () => ({
  config: {
    anthropicApiKey: 'test-key',
    proactiveTimezone: 'Europe/Paris',
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Import module under test AFTER mocks ───────────────────────────────────

import { detectMuteIntent, parseMuteDuration, generateMuteAcknowledgment } from '../mute.js';
import { logger } from '../../utils/logger.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function mockHaikuResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  });
}

function mockSonnetResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('detectMuteIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies mute intent with days duration', async () => {
    mockHaikuResponse('{"mute": true, "duration": {"days": 7}}');

    const result = await detectMuteIntent('quiet for a week');

    expect(result.muted).toBe(true);
    if (result.muted) {
      expect(result.muteUntil.getTime()).toBeGreaterThan(Date.now());
      expect(result.durationDescription).toMatch(/7 days|1 week/);
    }
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        system: expect.stringContaining('mute'),
      }),
    );
  });

  it('classifies non-mute messages as muted: false', async () => {
    mockHaikuResponse('{"mute": false}');

    const result = await detectMuteIntent('Had a great day at work');

    expect(result.muted).toBe(false);
  });

  it('returns muted: false on Haiku API error (safe default)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API timeout'));

    const result = await detectMuteIntent('quiet for a week');

    expect(result.muted).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'API timeout' }),
      'chris.mute.detect',
    );
  });

  it('handles K003 markdown fence wrapping', async () => {
    mockHaikuResponse('```json\n{"mute": true, "duration": {"days": 3}}\n```');

    const result = await detectMuteIntent('leave me alone for a few days');

    expect(result.muted).toBe(true);
    if (result.muted) {
      expect(result.muteUntil.getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('handles markdown fence without json language tag', async () => {
    mockHaikuResponse('```\n{"mute": true, "duration": {"weeks": 1}}\n```');

    const result = await detectMuteIntent('mute for a week');

    expect(result.muted).toBe(true);
  });

  it('returns muted: false when response has no text block', async () => {
    mockCreate.mockResolvedValueOnce({ content: [] });

    const result = await detectMuteIntent('quiet');

    expect(result.muted).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'No text block in Haiku response' }),
      'chris.mute.detect',
    );
  });

  it('returns muted: false on JSON parse error (safe default)', async () => {
    mockHaikuResponse('Sure, I can help with that!');

    const result = await detectMuteIntent('quiet');

    expect(result.muted).toBe(false);
  });

  it('logs chris.mute.detected with muted: true on success', async () => {
    mockHaikuResponse('{"mute": true, "duration": {"days": 5}}');

    await detectMuteIntent('quiet for 5 days');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        muted: true,
        muteUntil: expect.any(String),
        durationDescription: expect.any(String),
        latencyMs: expect.any(Number),
      }),
      'chris.mute.detected',
    );
  });

  it('logs chris.mute.detected with muted: false for non-mute', async () => {
    mockHaikuResponse('{"mute": false}');

    await detectMuteIntent('had a great day');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ muted: false }),
      'chris.mute.detected',
    );
  });
});

describe('parseMuteDuration', () => {
  it('handles days hint', () => {
    const result = parseMuteDuration({ days: 3 });
    const expectedMs = 3 * 24 * 60 * 60 * 1000;
    const diffMs = result.getTime() - Date.now();
    // Should be approximately 3 days (within 1 second tolerance)
    expect(diffMs).toBeGreaterThan(expectedMs - 1000);
    expect(diffMs).toBeLessThan(expectedMs + 1000);
  });

  it('handles weeks hint', () => {
    const result = parseMuteDuration({ weeks: 2 });
    const expectedMs = 14 * 24 * 60 * 60 * 1000;
    const diffMs = result.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(expectedMs - 1000);
    expect(diffMs).toBeLessThan(expectedMs + 1000);
  });

  it('handles until_weekday hint', () => {
    const result = parseMuteDuration({ until_weekday: 'friday' });
    // Result should be in the future
    expect(result.getTime()).toBeGreaterThan(Date.now());
    // Should be Friday (day 5)
    expect(result.getDay()).toBe(5);
    // Should be within 7 days
    const diffDays = (result.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(0);
    expect(diffDays).toBeLessThanOrEqual(7);
  });

  it('handles "until friday" when today is friday — targets next week', () => {
    // Mock Date to be a Friday
    const friday = new Date('2026-03-27T12:00:00Z'); // March 27, 2026 is a Friday
    vi.setSystemTime(friday);

    const result = parseMuteDuration({ until_weekday: 'friday' });
    // Should be next Friday, 7 days later
    const diffDays = (result.getTime() - friday.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(7, 0);
    expect(result.getDay()).toBe(5);

    vi.useRealTimers();
  });

  it('handles until_date hint', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const dateStr = futureDate.toISOString().split('T')[0];

    const result = parseMuteDuration({ until_date: dateStr });
    expect(result.getTime()).toBeGreaterThan(Date.now());
  });

  it('defaults to 7 days for past until_date', () => {
    const result = parseMuteDuration({ until_date: '2020-01-01' });
    const diffDays = (result.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(7, 0);
  });

  it('defaults to 7 days for unknown weekday', () => {
    const result = parseMuteDuration({ until_weekday: 'blurgsday' });
    const diffDays = (result.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(7, 0);
  });

  it('defaults to 7 days for empty hint', () => {
    const result = parseMuteDuration({});
    const diffDays = (result.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeCloseTo(7, 0);
  });
});

describe('generateMuteAcknowledgment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls Sonnet and returns acknowledgment text', async () => {
    mockSonnetResponse("Sure thing — I'll give you some space. Talk soon.");

    const result = await generateMuteAcknowledgment(
      new Date('2026-04-05T12:00:00Z'),
      'Europe/Paris',
    );

    expect(result).toBe("Sure thing — I'll give you some space. Talk soon.");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
        system: expect.stringContaining('quiet'),
      }),
    );
  });

  it('returns fallback when Sonnet has no text block', async () => {
    mockCreate.mockResolvedValueOnce({ content: [] });

    const result = await generateMuteAcknowledgment(
      new Date('2026-04-05T12:00:00Z'),
      'Europe/Paris',
    );

    expect(result).toMatch(/give you some space/);
  });

  it('formats date in the given timezone', async () => {
    mockSonnetResponse("I'll be here when you're ready.");

    await generateMuteAcknowledgment(
      new Date('2026-04-05T12:00:00Z'),
      'America/New_York',
    );

    // System prompt should contain a formatted date string
    const systemPrompt = mockCreate.mock.calls[0][0].system;
    expect(systemPrompt).toMatch(/April/);
  });
});
