import { describe, it, expect, vi, beforeEach } from 'vitest';

// K001: vi.hoisted for shared mock refs
const { mockCreate, mockLogger } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockCreate } },
  OPUS_MODEL: 'claude-opus-4-6',
}));

vi.mock('../../utils/logger.js', () => ({
  logger: mockLogger,
}));

import { runOpusAnalysis } from '../triggers/opus-analysis.js';
import type { OpusAnalysisResult } from '../triggers/opus-analysis.js';
import { createPatternTrigger } from '../triggers/pattern.js';
import { createThreadTrigger } from '../triggers/thread.js';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeOpusResponse(text: string, inputTokens = 500, outputTokens = 200) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

const VALID_RESULT: OpusAnalysisResult = {
  pattern: {
    detected: true,
    description: 'John tends to withdraw when work is stressful',
    evidence: ['mentioned work stress 3 times in Jan', 'went quiet after project deadline'],
    confidence: 0.75,
  },
  thread: {
    detected: true,
    description: 'John mentioned wanting to visit Portland but never followed up',
    evidence: ['mentioned Portland trip on Jan 15', 'no follow-up in 6 weeks'],
    confidence: 0.6,
  },
};

const VALID_JSON = JSON.stringify(VALID_RESULT);

// ── runOpusAnalysis ─────────────────────────────────────────────────────────

describe('runOpusAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed analysis when Opus returns clean JSON', async () => {
    mockCreate.mockResolvedValueOnce(makeOpusResponse(VALID_JSON));

    const result = await runOpusAnalysis('test context');

    expect(result.pattern.detected).toBe(true);
    expect(result.pattern.description).toBe('John tends to withdraw when work is stressful');
    expect(result.pattern.confidence).toBe(0.75);
    expect(result.thread.detected).toBe(true);
    expect(result.thread.confidence).toBe(0.6);
  });

  it('strips markdown fences and parses (K003)', async () => {
    const fenced = '```json\n' + VALID_JSON + '\n```';
    mockCreate.mockResolvedValueOnce(makeOpusResponse(fenced));

    const result = await runOpusAnalysis('test context');

    expect(result.pattern.detected).toBe(true);
    expect(result.thread.detected).toBe(true);
  });

  it('strips fences without json language tag', async () => {
    const fenced = '```\n' + VALID_JSON + '\n```';
    mockCreate.mockResolvedValueOnce(makeOpusResponse(fenced));

    const result = await runOpusAnalysis('test context');

    expect(result.pattern.detected).toBe(true);
  });

  it('returns safe default on API error', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limited'));

    const result = await runOpusAnalysis('test context');

    expect(result.pattern.detected).toBe(false);
    expect(result.thread.detected).toBe(false);
    expect(result.pattern.confidence).toBe(0);
    expect(result.thread.confidence).toBe(0);
  });

  it('returns safe default on malformed JSON', async () => {
    mockCreate.mockResolvedValueOnce(makeOpusResponse('not valid json {{{'));

    const result = await runOpusAnalysis('test context');

    expect(result.pattern.detected).toBe(false);
    expect(result.thread.detected).toBe(false);
  });

  it('returns safe default when response has no text block', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'tool_use', id: 'x', name: 'y', input: {} }],
      usage: { input_tokens: 100, output_tokens: 0 },
    });

    const result = await runOpusAnalysis('test context');

    expect(result.pattern.detected).toBe(false);
    expect(result.thread.detected).toBe(false);
  });

  it('logs token usage on success', async () => {
    mockCreate.mockResolvedValueOnce(makeOpusResponse(VALID_JSON, 800, 300));

    await runOpusAnalysis('test context');

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        inputTokens: 800,
        outputTokens: 300,
        model: 'claude-opus-4-6',
      }),
      'proactive.sweep.opus_usage',
    );
  });

  it('logs error on API failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('timeout'));

    await runOpusAnalysis('test context');

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'timeout' }),
      'proactive.sweep.opus_error',
    );
  });

  it('system prompt contains R011 enforcement language', async () => {
    mockCreate.mockResolvedValueOnce(makeOpusResponse(VALID_JSON));

    await runOpusAnalysis('test context');

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.system).toContain('ONLY report findings that are directly grounded');
    expect(callArgs.system).toContain('Do NOT infer, speculate, or hallucinate');
    expect(callArgs.system).toContain('False negatives are safe');
  });

  it('passes context as user message', async () => {
    mockCreate.mockResolvedValueOnce(makeOpusResponse(VALID_JSON));

    await runOpusAnalysis('my sweep context data');

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.messages[0].content).toBe('my sweep context data');
  });

  it('uses OPUS_MODEL and max_tokens 512', async () => {
    mockCreate.mockResolvedValueOnce(makeOpusResponse(VALID_JSON));

    await runOpusAnalysis('test');

    const callArgs = mockCreate.mock.calls[0]![0];
    expect(callArgs.model).toBe('claude-opus-4-6');
    expect(callArgs.max_tokens).toBe(512);
  });
});

// ── createPatternTrigger ────────────────────────────────────────────────────

describe('createPatternTrigger', () => {
  it('returns triggered when detected and confidence >= 0.5', async () => {
    const analysis: OpusAnalysisResult = {
      pattern: { detected: true, description: 'stress withdrawal', evidence: ['ev1'], confidence: 0.7 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    };

    const result = await createPatternTrigger(analysis).detect();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('pattern');
    expect(result.context).toBe('stress withdrawal');
    expect(result.evidence).toEqual(['ev1']);
  });

  it('returns triggered at exactly 0.5 confidence', async () => {
    const analysis: OpusAnalysisResult = {
      pattern: { detected: true, description: 'x', evidence: [], confidence: 0.5 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    };

    const result = await createPatternTrigger(analysis).detect();
    expect(result.triggered).toBe(true);
  });

  it('returns not-triggered when detected is false', async () => {
    const analysis: OpusAnalysisResult = {
      pattern: { detected: false, description: '', evidence: [], confidence: 0 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    };

    const result = await createPatternTrigger(analysis).detect();
    expect(result.triggered).toBe(false);
  });

  it('returns not-triggered when confidence < 0.5', async () => {
    const analysis: OpusAnalysisResult = {
      pattern: { detected: true, description: 'maybe', evidence: ['weak'], confidence: 0.4 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    };

    const result = await createPatternTrigger(analysis).detect();
    expect(result.triggered).toBe(false);
  });

  it('always returns priority 3', async () => {
    const triggered: OpusAnalysisResult = {
      pattern: { detected: true, description: 'x', evidence: [], confidence: 0.8 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    };
    const notTriggered: OpusAnalysisResult = {
      pattern: { detected: false, description: '', evidence: [], confidence: 0 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    };

    expect((await createPatternTrigger(triggered).detect()).priority).toBe(3);
    expect((await createPatternTrigger(notTriggered).detect()).priority).toBe(3);
  });
});

// ── createThreadTrigger ─────────────────────────────────────────────────────

describe('createThreadTrigger', () => {
  it('returns triggered when detected and confidence >= 0.5', async () => {
    const analysis: OpusAnalysisResult = {
      pattern: { detected: false, description: '', evidence: [], confidence: 0 },
      thread: { detected: true, description: 'Portland trip', evidence: ['mentioned Jan 15'], confidence: 0.65 },
    };

    const result = await createThreadTrigger(analysis).detect();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('thread');
    expect(result.context).toBe('Portland trip');
    expect(result.evidence).toEqual(['mentioned Jan 15']);
  });

  it('returns not-triggered when detected is false', async () => {
    const analysis: OpusAnalysisResult = {
      pattern: { detected: false, description: '', evidence: [], confidence: 0 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    };

    const result = await createThreadTrigger(analysis).detect();
    expect(result.triggered).toBe(false);
  });

  it('returns not-triggered when confidence < 0.5', async () => {
    const analysis: OpusAnalysisResult = {
      pattern: { detected: false, description: '', evidence: [], confidence: 0 },
      thread: { detected: true, description: 'weak thread', evidence: [], confidence: 0.3 },
    };

    const result = await createThreadTrigger(analysis).detect();
    expect(result.triggered).toBe(false);
  });

  it('always returns priority 4', async () => {
    const triggered: OpusAnalysisResult = {
      pattern: { detected: false, description: '', evidence: [], confidence: 0 },
      thread: { detected: true, description: 'x', evidence: [], confidence: 0.8 },
    };
    const notTriggered: OpusAnalysisResult = {
      pattern: { detected: false, description: '', evidence: [], confidence: 0 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    };

    expect((await createThreadTrigger(triggered).detect()).priority).toBe(4);
    expect((await createThreadTrigger(notTriggered).detect()).priority).toBe(4);
  });
});
