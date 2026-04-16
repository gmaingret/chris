/**
 * Phase 17 Plan 01 — TDD RED: Unit tests for classifyAccuracy().
 *
 * Tests are intentionally written before the implementation.
 * Run: npx vitest run src/decisions/__tests__/classify-accuracy.test.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
// @ts-expect-error — created by Plan 01 of Phase 17
import { classifyAccuracy } from '../classify-accuracy.js';

// ── Mock Anthropic client ──────────────────────────────────────────────────

const { mockAnthropicCreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate },
  },
  HAIKU_MODEL: 'test-haiku',
  SONNET_MODEL: 'test-sonnet',
  OPUS_MODEL: 'test-opus',
  callLLM: vi.fn().mockResolvedValue('{}'),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('classifyAccuracy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns "sound" when Haiku responds with {"reasoning":"sound"}', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"reasoning":"sound"}' }],
    });

    const result = await classifyAccuracy(
      'hit',
      'I predicted X and my reasoning was correct because I analyzed the market data carefully',
      'The project will be delivered on time',
    );
    expect(result).toBe('sound');
  });

  it('returns "flawed" when Haiku responds with {"reasoning":"flawed"}', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"reasoning":"flawed"}' }],
    });

    const result = await classifyAccuracy(
      'miss',
      'I was wrong because I ignored all the warning signs',
      'The investment will double in value',
    );
    expect(result).toBe('flawed');
  });

  it('returns "unknown" when Haiku times out (Promise.race timeout)', async () => {
    // Simulate a call that never resolves (hangs indefinitely)
    mockAnthropicCreate.mockReturnValue(new Promise(() => {}));

    const result = await classifyAccuracy(
      'hit',
      'I made a correct prediction',
      'This prediction will come true',
    );
    expect(result).toBe('unknown');
  }, 10_000);

  it('returns "unknown" when Haiku returns unparseable JSON', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'this is not valid json at all!!!' }],
    });

    const result = await classifyAccuracy(
      'hit',
      'I made a correct prediction',
      'This will happen',
    );
    expect(result).toBe('unknown');
  });

  it('returns "unknown" when Haiku returns invalid reasoning value', async () => {
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: 'text', text: '{"reasoning":"bad"}' }],
    });

    const result = await classifyAccuracy(
      'miss',
      'I got it wrong',
      'This will succeed',
    );
    expect(result).toBe('unknown');
  });

  it('returns "unknown" when Haiku throws a network error', async () => {
    mockAnthropicCreate.mockRejectedValue(new Error('Network connection failed'));

    const result = await classifyAccuracy(
      'hit',
      'I was right about this one',
      'This will succeed',
    );
    expect(result).toBe('unknown');
  });
});
