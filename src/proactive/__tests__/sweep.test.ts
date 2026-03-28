import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (K001) ──────────────────────────────────────────────────

const {
  mockIsMuted,
  mockHasSentToday,
  mockSetLastSent,
  mockSilenceDetect,
  mockCommitmentDetect,
  mockSendMessage,
  mockCreate,
  mockSaveMessage,
  mockBuildSweepContext,
  mockRunOpusAnalysis,
  mockPatternDetect,
  mockThreadDetect,
} = vi.hoisted(() => ({
  mockIsMuted: vi.fn(),
  mockHasSentToday: vi.fn(),
  mockSetLastSent: vi.fn(),
  mockSilenceDetect: vi.fn(),
  mockCommitmentDetect: vi.fn(),
  mockSendMessage: vi.fn(),
  mockCreate: vi.fn(),
  mockSaveMessage: vi.fn(),
  mockBuildSweepContext: vi.fn(),
  mockRunOpusAnalysis: vi.fn(),
  mockPatternDetect: vi.fn(),
  mockThreadDetect: vi.fn(),
}));

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock('../state.js', () => ({
  isMuted: mockIsMuted,
  hasSentToday: mockHasSentToday,
  setLastSent: mockSetLastSent,
}));

vi.mock('../triggers/silence.js', () => ({
  createSilenceTrigger: vi.fn(() => ({ detect: mockSilenceDetect })),
}));

vi.mock('../triggers/commitment.js', () => ({
  createCommitmentTrigger: vi.fn(() => ({ detect: mockCommitmentDetect })),
}));

vi.mock('../../bot/bot.js', () => {
  // K002: Grammy Bot mock must use class syntax
  class MockBot {
    api = { sendMessage: mockSendMessage };
    use = vi.fn();
    on = vi.fn();
    catch = vi.fn();
  }
  return { bot: new MockBot() };
});

vi.mock('../../llm/client.js', () => ({
  anthropic: { messages: { create: mockCreate } },
  SONNET_MODEL: 'claude-sonnet-4-20250514',
}));

vi.mock('../../memory/conversation.js', () => ({
  saveMessage: mockSaveMessage,
}));

vi.mock('../../config.js', () => ({
  config: {
    telegramAuthorizedUserId: 12345,
    proactiveTimezone: 'Europe/Paris',
    proactiveSilenceThresholdMultiplier: 2,
    proactiveSilenceBaselineDays: 14,
    proactiveCommitmentStaleDays: 7,
    proactiveSweepContextMaxTokens: 10000,
  },
}));

vi.mock('../context-builder.js', () => ({
  buildSweepContext: mockBuildSweepContext,
}));

vi.mock('../triggers/opus-analysis.js', () => ({
  runOpusAnalysis: mockRunOpusAnalysis,
}));

vi.mock('../triggers/pattern.js', () => ({
  createPatternTrigger: vi.fn(() => ({ detect: mockPatternDetect })),
}));

vi.mock('../triggers/thread.js', () => ({
  createThreadTrigger: vi.fn(() => ({ detect: mockThreadDetect })),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// ── Import module under test AFTER mocks ───────────────────────────────────

import { runSweep } from '../sweep.js';
import { logger } from '../../utils/logger.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function mockLLMResponse(text: string) {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text }],
  });
}

function mockSilenceFired(context = 'Greg has been quiet for 3.0 days. His usual rhythm is about 1.0 day between messages.') {
  mockSilenceDetect.mockResolvedValueOnce({
    triggered: true,
    triggerType: 'silence',
    priority: 1,
    context,
    evidence: [
      'Current gap: 3.0 days',
      'Average gap: 1.0 day',
      'Threshold: 2× average',
      'History: 15 messages over 17 days',
    ],
  });
}

function mockSilenceNotFired() {
  mockSilenceDetect.mockResolvedValueOnce({
    triggered: false,
    triggerType: 'silence',
    priority: 1,
    context: 'Current gap (0.5 days) within normal range (threshold: 2.0 days)',
  });
}

function mockSilenceInsufficientData() {
  mockSilenceDetect.mockResolvedValueOnce({
    triggered: false,
    triggerType: 'silence',
    priority: 1,
    context: 'Insufficient history',
  });
}

function mockCommitmentFired(context = 'Greg made a commitment 14 days ago: "I want to start running every morning". There\'s been no follow-up.') {
  mockCommitmentDetect.mockResolvedValueOnce({
    triggered: true,
    triggerType: 'commitment',
    priority: 2,
    context,
    evidence: ['Entry aaa-111: 14 days old'],
  });
}

function mockCommitmentNotFired() {
  mockCommitmentDetect.mockResolvedValueOnce({
    triggered: false,
    triggerType: 'commitment',
    priority: 2,
    context: 'No stale commitments found',
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('proactive sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all checks pass through
    mockIsMuted.mockResolvedValue(false);
    mockHasSentToday.mockResolvedValue(false);
    mockSetLastSent.mockResolvedValue(undefined);
    mockSendMessage.mockResolvedValue(undefined);
    mockSaveMessage.mockResolvedValue(undefined);
    // Default: neither trigger fires
    mockSilenceDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'silence',
      priority: 1,
      context: 'Current gap within normal range',
    });
    mockCommitmentDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'commitment',
      priority: 2,
      context: 'No stale commitments found',
    });
    // Phase 2 defaults: Opus phase returns nothing fired
    mockBuildSweepContext.mockResolvedValue('');
    mockRunOpusAnalysis.mockResolvedValue({
      pattern: { detected: false, description: '', evidence: [], confidence: 0 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    });
    mockPatternDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'pattern',
      priority: 3,
      context: 'No recurring pattern detected',
    });
    mockThreadDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'thread',
      priority: 4,
      context: 'No unresolved thread detected',
    });
  });

  // ── Pre-trigger gate tests (unchanged behavior) ─────────────────────────

  it('skips sweep when muted', async () => {
    mockIsMuted.mockResolvedValueOnce(true);

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('muted');
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSilenceDetect).not.toHaveBeenCalled();
    expect(mockCommitmentDetect).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ skippedReason: 'muted' }),
      'proactive.sweep.skipped',
    );
  });

  it('skips sweep when already sent today', async () => {
    mockHasSentToday.mockResolvedValueOnce(true);

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('already_sent_today');
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSilenceDetect).not.toHaveBeenCalled();
    expect(mockCommitmentDetect).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ skippedReason: 'already_sent_today' }),
      'proactive.sweep.skipped',
    );
  });

  it('skips sweep when no trigger fires', async () => {
    mockSilenceNotFired();
    mockCommitmentNotFired();

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('no_trigger');
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('skips sweep with insufficient_data when silence trigger reports insufficient history', async () => {
    mockSilenceInsufficientData();
    mockCommitmentNotFired();

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('insufficient_data');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // ── Single trigger: silence fires ────────────────────────────────────────

  it('sends proactive message when silence trigger fires', async () => {
    mockSilenceFired();
    mockCommitmentNotFired();
    mockLLMResponse('Hey, been thinking about you. Everything good?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 1 });

    const result = await runSweep();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('silence');
    expect(result.message).toBe('Hey, been thinking about you. Everything good?');

    // Verify bot.api.sendMessage called with authorized user ID
    expect(mockSendMessage).toHaveBeenCalledWith(
      12345,
      'Hey, been thinking about you. Everything good?',
    );

    // Verify message saved to conversation as ASSISTANT/JOURNAL
    expect(mockSaveMessage).toHaveBeenCalledWith(
      12345n,
      'ASSISTANT',
      'Hey, been thinking about you. Everything good?',
      'JOURNAL',
    );

    // Verify setLastSent called AFTER send (not before)
    expect(mockSetLastSent).toHaveBeenCalledTimes(1);
    expect(mockSetLastSent).toHaveBeenCalledWith(expect.any(Date));

    // Verify sent log
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'silence' }),
      'proactive.sweep.sent',
    );
  });

  it('passes trigger context into system prompt for LLM', async () => {
    const context = 'Greg has been quiet for 5.0 days. His usual rhythm is about 1.2 days between messages.';
    mockSilenceFired(context);
    mockCommitmentNotFired();
    mockLLMResponse('Miss hearing from you, mate.');
    mockSendMessage.mockResolvedValueOnce({ message_id: 2 });

    await runSweep();

    // Verify Anthropic was called with system prompt containing trigger context
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-sonnet-4-20250514',
        system: expect.stringContaining(context),
        messages: expect.arrayContaining([
          expect.objectContaining({ content: context }),
        ]),
      }),
    );

    // System prompt should NOT contain the placeholder
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).not.toContain('{triggerContext}');
  });

  it('does not send message when Anthropic throws', async () => {
    mockSilenceFired();
    mockCommitmentNotFired();
    mockCreate.mockRejectedValueOnce(new Error('API rate limit'));

    await expect(runSweep()).rejects.toThrow('API rate limit');

    // sendMessage should NOT be called
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSaveMessage).not.toHaveBeenCalled();
    expect(mockSetLastSent).not.toHaveBeenCalled();

    // Error should be logged
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'proactive.sweep.error',
    );
  });

  it('logs proactive.sweep.start on every invocation', async () => {
    mockIsMuted.mockResolvedValueOnce(true);

    await runSweep();

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ timestamp: expect.any(String) }),
      'proactive.sweep.start',
    );
  });

  it('calls setLastSent only after successful send — not before', async () => {
    const callOrder: string[] = [];
    mockSilenceFired();
    mockCommitmentNotFired();
    mockLLMResponse('Checking in!');
    mockSendMessage.mockImplementation(async () => {
      callOrder.push('sendMessage');
      return { message_id: 3 };
    });
    mockSaveMessage.mockImplementation(async () => {
      callOrder.push('saveMessage');
      return {};
    });
    mockSetLastSent.mockImplementation(async () => {
      callOrder.push('setLastSent');
    });

    await runSweep();

    expect(callOrder).toEqual(['sendMessage', 'saveMessage', 'setLastSent']);
  });

  // ── Multi-trigger priority tests ─────────────────────────────────────────

  it('silence wins over commitment when both fire (priority 1 < 2)', async () => {
    mockSilenceFired();
    mockCommitmentFired();
    mockLLMResponse('Been a while — how are things?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 10 });

    const result = await runSweep();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('silence');
    expect(result.message).toBe('Been a while — how are things?');

    // Verify the trigger log shows both fired
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'silence',
        firedCount: 2,
        allFired: ['silence', 'commitment'],
      }),
      'proactive.sweep.trigger',
    );
  });

  it('commitment fires when silence does not trigger', async () => {
    mockSilenceNotFired();
    mockCommitmentFired();
    mockLLMResponse('Remember that running goal you mentioned?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 11 });

    const result = await runSweep();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('commitment');
    expect(result.message).toBe('Remember that running goal you mentioned?');

    // Verify sent log uses commitment triggerType
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: 'commitment' }),
      'proactive.sweep.sent',
    );
  });

  it('neither trigger fires → no_trigger', async () => {
    mockSilenceNotFired();
    mockCommitmentNotFired();

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('no_trigger');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('commitment context is passed to LLM when commitment is the winner', async () => {
    const commitmentContext = 'Greg made a commitment 14 days ago: "I want to start running every morning". There\'s been no follow-up.';
    mockSilenceNotFired();
    mockCommitmentFired(commitmentContext);
    mockLLMResponse('How is the running going?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 12 });

    await runSweep();

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(commitmentContext),
        messages: expect.arrayContaining([
          expect.objectContaining({ content: commitmentContext }),
        ]),
      }),
    );
  });

  // ── Two-phase short-circuit tests ────────────────────────────────────────

  it('short-circuits Opus when silence trigger fires', async () => {
    mockSilenceFired();
    mockCommitmentNotFired();
    mockLLMResponse('Hey, checking in.');
    mockSendMessage.mockResolvedValueOnce({ message_id: 20 });

    await runSweep();

    expect(mockBuildSweepContext).not.toHaveBeenCalled();
    expect(mockRunOpusAnalysis).not.toHaveBeenCalled();
    expect(mockPatternDetect).not.toHaveBeenCalled();
    expect(mockThreadDetect).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sqlTriggersFound: 1 }),
      'proactive.sweep.opus_skipped',
    );
  });

  it('short-circuits Opus when commitment trigger fires', async () => {
    mockSilenceNotFired();
    mockCommitmentFired();
    mockLLMResponse('How is the running?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 21 });

    await runSweep();

    expect(mockBuildSweepContext).not.toHaveBeenCalled();
    expect(mockRunOpusAnalysis).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sqlTriggersFound: 1 }),
      'proactive.sweep.opus_skipped',
    );
  });

  it('short-circuits Opus when both SQL triggers fire', async () => {
    mockSilenceFired();
    mockCommitmentFired();
    mockLLMResponse('Been a while — how are things?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 22 });

    await runSweep();

    expect(mockBuildSweepContext).not.toHaveBeenCalled();
    expect(mockRunOpusAnalysis).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ sqlTriggersFound: 2 }),
      'proactive.sweep.opus_skipped',
    );
  });

  it('calls Opus phase when no SQL trigger fires — pattern trigger fires', async () => {
    mockSilenceNotFired();
    mockCommitmentNotFired();
    mockBuildSweepContext.mockResolvedValueOnce('## Relational Memory\n- [PATTERN] Greg often mentions work stress on Mondays');
    mockRunOpusAnalysis.mockResolvedValueOnce({
      pattern: { detected: true, description: 'Monday stress pattern', evidence: ['Work stress mentions'], confidence: 0.8 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    });
    mockPatternDetect.mockResolvedValueOnce({
      triggered: true,
      triggerType: 'pattern',
      priority: 3,
      context: 'Monday stress pattern',
      evidence: ['Work stress mentions'],
    });
    mockLLMResponse('Mondays are rough, huh? How are you holding up?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 23 });

    const result = await runSweep();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('pattern');
    expect(mockBuildSweepContext).toHaveBeenCalledWith(10000);
    expect(mockRunOpusAnalysis).toHaveBeenCalled();
  });

  it('pattern wins over thread when both Opus triggers fire (priority 3 < 4)', async () => {
    mockSilenceNotFired();
    mockCommitmentNotFired();
    mockBuildSweepContext.mockResolvedValueOnce('context data');
    mockRunOpusAnalysis.mockResolvedValueOnce({
      pattern: { detected: true, description: 'Recurring pattern', evidence: ['evidence1'], confidence: 0.9 },
      thread: { detected: true, description: 'Unresolved thread', evidence: ['evidence2'], confidence: 0.7 },
    });
    mockPatternDetect.mockResolvedValueOnce({
      triggered: true,
      triggerType: 'pattern',
      priority: 3,
      context: 'Recurring pattern',
      evidence: ['evidence1'],
    });
    mockThreadDetect.mockResolvedValueOnce({
      triggered: true,
      triggerType: 'thread',
      priority: 4,
      context: 'Unresolved thread',
      evidence: ['evidence2'],
    });
    mockLLMResponse('Noticed a pattern...');
    mockSendMessage.mockResolvedValueOnce({ message_id: 24 });

    const result = await runSweep();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('pattern');

    // Verify the trigger log shows both fired with pattern winning
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'pattern',
        firedCount: 2,
        allFired: ['pattern', 'thread'],
      }),
      'proactive.sweep.trigger',
    );
  });

  it('handles Opus phase gracefully when context builder throws', async () => {
    mockSilenceNotFired();
    mockCommitmentNotFired();
    mockBuildSweepContext.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('no_trigger');
    expect(mockRunOpusAnalysis).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'proactive.sweep.opus_phase_error',
    );
  });

  it('handles Opus phase gracefully when runOpusAnalysis throws', async () => {
    mockSilenceNotFired();
    mockCommitmentNotFired();
    mockBuildSweepContext.mockResolvedValueOnce('context data');
    mockRunOpusAnalysis.mockRejectedValueOnce(new Error('Opus API timeout'));

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('no_trigger');
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'proactive.sweep.opus_phase_error',
    );
  });

  it('thread trigger fires when pattern does not', async () => {
    mockSilenceNotFired();
    mockCommitmentNotFired();
    mockBuildSweepContext.mockResolvedValueOnce('context data');
    mockRunOpusAnalysis.mockResolvedValueOnce({
      pattern: { detected: false, description: '', evidence: [], confidence: 0 },
      thread: { detected: true, description: 'Unresolved thread about travel plans', evidence: ['thread evidence'], confidence: 0.7 },
    });
    mockThreadDetect.mockResolvedValueOnce({
      triggered: true,
      triggerType: 'thread',
      priority: 4,
      context: 'Unresolved thread about travel plans',
      evidence: ['thread evidence'],
    });
    mockLLMResponse('Did you ever sort out those travel plans?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 25 });

    const result = await runSweep();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('thread');
    expect(result.message).toBe('Did you ever sort out those travel plans?');
  });
});
