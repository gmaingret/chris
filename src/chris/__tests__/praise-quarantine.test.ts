import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Anthropic client ──────────────────────────────────────────────────
vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: vi.fn() },
  },
  HAIKU_MODEL: 'claude-haiku-4-5-20251001',
  SONNET_MODEL: 'claude-sonnet-4-6',
  OPUS_MODEL: 'claude-opus-4-6',
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

// ── Import mocked modules to access their vi.fn() instances ───────────────
import { anthropic } from '../../llm/client.js';
import { logger } from '../../utils/logger.js';

// ── Import the module under test ───────────────────────────────────────────
import { quarantinePraise } from '../praise-quarantine.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeHaikuResponse(payload: object) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}

const mockCreate = anthropic.messages.create as ReturnType<typeof vi.fn>;
const mockLogWarn = logger.warn as ReturnType<typeof vi.fn>;

// ── Tests ──────────────────────────────────────────────────────────────────

describe('quarantinePraise', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rewrites response when flattery detected in JOURNAL mode', async () => {
    const original = 'Great question! Let me think about that.';
    const rewritten = 'Let me think about that.';
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse({ flattery_detected: true, rewritten }),
    );

    const result = await quarantinePraise(original, 'JOURNAL');

    expect(result).toBe(rewritten);
  });

  it('returns original when no flattery detected', async () => {
    const original = 'Here is my analysis of the situation.';
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse({ flattery_detected: false, rewritten: original }),
    );

    const result = await quarantinePraise(original, 'JOURNAL');

    expect(result).toBe(original);
  });

  it('bypasses Haiku for COACH mode', async () => {
    const original = 'Great question!';
    const result = await quarantinePraise(original, 'COACH');

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result).toBe(original);
  });

  it('bypasses Haiku for PSYCHOLOGY mode', async () => {
    const original = 'Great question!';
    const result = await quarantinePraise(original, 'PSYCHOLOGY');

    expect(mockCreate).not.toHaveBeenCalled();
    expect(result).toBe(original);
  });

  it('calls Haiku for JOURNAL mode', async () => {
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse({ flattery_detected: false, rewritten: 'Some text.' }),
    );

    await quarantinePraise('Some text.', 'JOURNAL');

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('calls Haiku for REFLECT mode', async () => {
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse({ flattery_detected: false, rewritten: 'Some text.' }),
    );

    await quarantinePraise('Some text.', 'REFLECT');

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('calls Haiku for PRODUCE mode', async () => {
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse({ flattery_detected: false, rewritten: 'Some text.' }),
    );

    await quarantinePraise('Some text.', 'PRODUCE');

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('returns original when Haiku returns empty rewritten string', async () => {
    const original = 'Here is my thought without any reflexive opener.';
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse({ flattery_detected: true, rewritten: '' }),
    );
    const result = await quarantinePraise(original, 'JOURNAL');
    expect(result).toBe(original);
  });

  it('returns original when Haiku returns whitespace-only rewritten string', async () => {
    const original = 'Here is my thought without any reflexive opener.';
    mockCreate.mockResolvedValueOnce(
      makeHaikuResponse({ flattery_detected: true, rewritten: '   \n  ' }),
    );
    const result = await quarantinePraise(original, 'JOURNAL');
    expect(result).toBe(original);
  });

  it('returns original on malformed JSON from Haiku', async () => {
    const original = 'Here is my thought without any reflexive opener.';
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'not json' }],
    });

    const result = await quarantinePraise(original, 'JOURNAL');

    expect(result).toBe(original);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('returns original when Haiku throws error', async () => {
    const original = 'Here is my thought without any reflexive opener.';
    mockCreate.mockRejectedValueOnce(new Error('API timeout'));

    const result = await quarantinePraise(original, 'JOURNAL');

    expect(result).toBe(original);
    expect(mockLogWarn).toHaveBeenCalled();
  });

  it('deterministic strip removes reflexive opener even when Haiku fails to', async () => {
    // Backstop: even if Haiku misses "That's …", the deterministic post-process
    // strips the leading reflexive sentence so first-word praise checks pass.
    const original = "That's a fascinating idea. Let me push back on the financial side though — the math is shaky.";
    mockCreate.mockRejectedValueOnce(new Error('API timeout'));

    const result = await quarantinePraise(original, 'JOURNAL');

    expect(result.startsWith("That's")).toBe(false);
    expect(result).toContain('the math is shaky');
  });
});
