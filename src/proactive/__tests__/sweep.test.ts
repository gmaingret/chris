import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (K001) ──────────────────────────────────────────────────

const {
  mockIsMuted,
  mockHasSentTodayReflective,
  mockSetLastSentReflective,
  mockHasSentTodayAccountability,
  mockSetLastSentAccountability,
  mockSilenceDetect,
  mockCommitmentDetect,
  mockDeadlineDetect,
  mockSendMessage,
  mockCreate,
  mockSaveMessage,
  mockGetRecentHistory,
  mockCountMessagesSince,
  mockBuildSweepContext,
  mockRunOpusAnalysis,
  mockPatternDetect,
  mockThreadDetect,
  mockUpsertAwaitingResolution,
  mockClearCapture,
  mockGetLastUserLanguage,
  mockGetEscalationSentAt,
  mockSetEscalationSentAt,
  mockGetEscalationCount,
  mockSetEscalationCount,
  mockSetEscalationState,
  mockClearEscalationKeys,
  mockTransitionDecision,
  mockDbSelect,
  mockRunRitualSweep,
} = vi.hoisted(() => ({
  mockIsMuted: vi.fn(),
  mockHasSentTodayReflective: vi.fn(),
  mockSetLastSentReflective: vi.fn(),
  mockHasSentTodayAccountability: vi.fn(),
  mockSetLastSentAccountability: vi.fn(),
  mockSilenceDetect: vi.fn(),
  mockCommitmentDetect: vi.fn(),
  mockDeadlineDetect: vi.fn(),
  mockSendMessage: vi.fn(),
  mockCreate: vi.fn(),
  mockSaveMessage: vi.fn(),
  mockGetRecentHistory: vi.fn().mockResolvedValue([]),
  mockCountMessagesSince: vi.fn().mockResolvedValue(1),
  mockBuildSweepContext: vi.fn(),
  mockRunOpusAnalysis: vi.fn(),
  mockPatternDetect: vi.fn(),
  mockThreadDetect: vi.fn(),
  mockUpsertAwaitingResolution: vi.fn(),
  mockClearCapture: vi.fn(),
  mockGetLastUserLanguage: vi.fn(() => 'English'),
  mockGetEscalationSentAt: vi.fn(),
  mockSetEscalationSentAt: vi.fn(),
  mockGetEscalationCount: vi.fn(),
  mockSetEscalationCount: vi.fn(),
  mockSetEscalationState: vi.fn(),
  mockClearEscalationKeys: vi.fn(),
  mockTransitionDecision: vi.fn(),
  mockDbSelect: vi.fn(),
  mockRunRitualSweep: vi.fn(),
}));

// ── Module mocks ───────────────────────────────────────────────────────────

vi.mock('../state.js', () => ({
  isMuted: mockIsMuted,
  hasSentTodayReflective: mockHasSentTodayReflective,
  setLastSentReflective: mockSetLastSentReflective,
  hasSentTodayAccountability: mockHasSentTodayAccountability,
  setLastSentAccountability: mockSetLastSentAccountability,
  getEscalationSentAt: mockGetEscalationSentAt,
  setEscalationSentAt: mockSetEscalationSentAt,
  getEscalationCount: mockGetEscalationCount,
  setEscalationCount: mockSetEscalationCount,
  setEscalationState: mockSetEscalationState,
  clearEscalationKeys: mockClearEscalationKeys,
}));

vi.mock('../../rituals/scheduler.js', () => ({
  runRitualSweep: mockRunRitualSweep,
}));

vi.mock('../triggers/silence.js', () => ({
  createSilenceTrigger: vi.fn(() => ({ detect: mockSilenceDetect })),
}));

vi.mock('../triggers/commitment.js', () => ({
  createCommitmentTrigger: vi.fn(() => ({ detect: mockCommitmentDetect })),
}));

vi.mock('../triggers/deadline.js', () => ({
  createDeadlineTrigger: vi.fn(() => ({ detect: mockDeadlineDetect })),
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
  SONNET_MODEL: 'claude-sonnet-4-6',
}));

vi.mock('../../memory/conversation.js', () => ({
  saveMessage: mockSaveMessage,
  getRecentHistory: mockGetRecentHistory,
  countMessagesSince: mockCountMessagesSince,
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

vi.mock('../../decisions/capture-state.js', () => ({
  upsertAwaitingResolution: mockUpsertAwaitingResolution,
  clearCapture: mockClearCapture,
}));

vi.mock('../../decisions/lifecycle.js', () => ({
  transitionDecision: mockTransitionDecision,
}));

vi.mock('../../db/schema.js', () => ({
  decisionCaptureState: { chatId: 'chatId', decisionId: 'decisionId', stage: 'stage' },
  decisions: { id: 'id' },
}));

vi.mock('../../db/connection.js', () => ({
  db: {
    select: mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../../chris/language.js', () => ({
  getLastUserLanguage: mockGetLastUserLanguage,
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

function mockSilenceFired(context = 'John has been quiet for 3.0 days. His usual rhythm is about 1.0 day between messages.') {
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

function mockCommitmentFired(context = 'John made a commitment 14 days ago: "I want to start running every morning". There\'s been no follow-up.') {
  mockCommitmentDetect.mockResolvedValueOnce({
    triggered: true,
    triggerType: 'commitment',
    priority: 3,
    context,
    evidence: ['Entry aaa-111: 14 days old'],
  });
}

function mockCommitmentNotFired() {
  mockCommitmentDetect.mockResolvedValueOnce({
    triggered: false,
    triggerType: 'commitment',
    priority: 3,
    context: 'No stale commitments found',
  });
}

function mockDeadlineFired(decisionId = 'test-decision-uuid-1234') {
  mockDeadlineDetect.mockResolvedValueOnce({
    triggered: true,
    triggerType: 'decision-deadline',
    priority: 2,
    context: "Your deadline just passed for a prediction you made: 'Project ships by Q1'. Your falsification criterion was: 'Ship date before March 31'.",
    evidence: [
      `Decision ID: ${decisionId}`,
      'Resolve by: 2026-04-01T00:00:00.000Z',
      'Staleness: 24h',
    ],
  });
}

function mockDeadlineNotFired() {
  mockDeadlineDetect.mockResolvedValueOnce({
    triggered: false,
    triggerType: 'decision-deadline',
    priority: 2,
    context: 'No due decisions',
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('proactive sweep', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: not muted, neither channel has sent today
    mockIsMuted.mockResolvedValue(false);
    mockHasSentTodayReflective.mockResolvedValue(false);
    mockSetLastSentReflective.mockResolvedValue(undefined);
    mockHasSentTodayAccountability.mockResolvedValue(false);
    mockSetLastSentAccountability.mockResolvedValue(undefined);
    mockSendMessage.mockResolvedValue(undefined);
    mockSaveMessage.mockResolvedValue(undefined);
    mockGetRecentHistory.mockResolvedValue([]);
    mockCountMessagesSince.mockResolvedValue(1); // default: at least one user message in window (don't skip)
    mockUpsertAwaitingResolution.mockResolvedValue(undefined);
    // Default: deadline trigger doesn't fire
    mockDeadlineDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'decision-deadline',
      priority: 2,
      context: 'No due decisions',
    });
    // Default: neither reflective trigger fires
    mockSilenceDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'silence',
      priority: 1,
      context: 'Current gap within normal range',
    });
    mockCommitmentDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'commitment',
      priority: 3,
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
      priority: 4,
      context: 'No recurring pattern detected',
    });
    mockThreadDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'thread',
      priority: 5,
      context: 'No unresolved thread detected',
    });
    // Default: ritual channel returns no fires (clean DB)
    mockRunRitualSweep.mockResolvedValue([]);
  });

  // ── Global mute gate ────────────────────────────────────────────────────

  it('skips both channels when muted', async () => {
    mockIsMuted.mockResolvedValueOnce(true);

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('muted');
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSilenceDetect).not.toHaveBeenCalled();
    expect(mockCommitmentDetect).not.toHaveBeenCalled();
    expect(mockDeadlineDetect).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ skippedReason: 'muted' }),
      'proactive.sweep.skipped',
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

  // ── No triggers fire ────────────────────────────────────────────────────

  it('skips sweep when no trigger fires', async () => {
    mockSilenceNotFired();
    mockCommitmentNotFired();
    mockDeadlineNotFired();

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('no_trigger');
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('skips sweep with insufficient_data when silence trigger reports insufficient history', async () => {
    mockSilenceInsufficientData();
    mockCommitmentNotFired();
    mockDeadlineNotFired();

    const result = await runSweep();

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('insufficient_data');
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  // ── Accountability channel ──────────────────────────────────────────────

  describe('accountability channel', () => {
    it('sends accountability message when deadline trigger fires', async () => {
      mockDeadlineFired();
      mockSilenceNotFired();
      mockCommitmentNotFired();
      mockLLMResponse('Your prediction deadline passed. What actually happened?');
      mockSendMessage.mockResolvedValueOnce({ message_id: 100 });

      const result = await runSweep();

      expect(result.triggered).toBe(true);
      expect(result.accountabilityResult?.triggered).toBe(true);
      expect(result.accountabilityResult?.triggerType).toBe('decision-deadline');
      expect(mockSendMessage).toHaveBeenCalledWith(
        12345,
        'Your prediction deadline passed. What actually happened?',
      );
      expect(mockSetLastSentAccountability).toHaveBeenCalledTimes(1);
      expect(mockSetLastSentAccountability).toHaveBeenCalledWith(expect.any(Date));
    });

    it('uses ACCOUNTABILITY_SYSTEM_PROMPT, not PROACTIVE_SYSTEM_PROMPT', async () => {
      mockDeadlineFired();
      mockSilenceNotFired();
      mockCommitmentNotFired();
      mockLLMResponse('Checking in on your prediction.');
      mockSendMessage.mockResolvedValueOnce({ message_id: 101 });

      await runSweep();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const callArgs = mockCreate.mock.calls[0]![0];
      const systemText = Array.isArray(callArgs.system) ? callArgs.system[0].text : callArgs.system;
      // ACCOUNTABILITY_SYSTEM_PROMPT contains this distinctive phrase
      expect(systemText).toContain('deadline has now passed');
      // PROACTIVE_SYSTEM_PROMPT would contain this phrase instead
      expect(systemText).not.toContain('close and perceptive friend');
    });

    it('calls upsertAwaitingResolution with decision ID before sendMessage', async () => {
      const decisionId = 'test-decision-uuid-1234';
      mockDeadlineFired(decisionId);
      mockSilenceNotFired();
      mockCommitmentNotFired();
      mockLLMResponse('Checking in on your deadline.');

      const callOrder: string[] = [];
      mockUpsertAwaitingResolution.mockImplementation(async () => {
        callOrder.push('upsertAwaitingResolution');
      });
      mockSendMessage.mockImplementation(async () => {
        callOrder.push('sendMessage');
        return { message_id: 102 };
      });

      await runSweep();

      expect(callOrder.indexOf('upsertAwaitingResolution')).toBeLessThan(
        callOrder.indexOf('sendMessage'),
      );
      expect(mockUpsertAwaitingResolution).toHaveBeenCalledWith(12345n, decisionId);
    });

    it('fires accountability even when reflective already sent today', async () => {
      mockHasSentTodayReflective.mockResolvedValue(true);
      mockHasSentTodayAccountability.mockResolvedValue(false);
      mockDeadlineFired();
      mockLLMResponse('Accountability check-in.');
      mockSendMessage.mockResolvedValueOnce({ message_id: 103 });

      const result = await runSweep();

      expect(result.triggered).toBe(true);
      expect(result.accountabilityResult?.triggered).toBe(true);
      // Reflective channel should be skipped (already sent today)
      expect(result.reflectiveResult).toBeUndefined();
      // Only one LLM call (accountability)
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('skips accountability channel when already sent today', async () => {
      mockHasSentTodayAccountability.mockResolvedValue(true);
      mockDeadlineFired();
      mockSilenceNotFired();
      mockCommitmentNotFired();

      const result = await runSweep();

      // Accountability skipped but no error
      expect(result.accountabilityResult).toBeUndefined();
      // deadline detect should NOT have been called (cap gate before detect)
      expect(mockDeadlineDetect).not.toHaveBeenCalled();
    });
  });

  // ── Reflective channel ──────────────────────────────────────────────────

  describe('reflective channel', () => {
    it('sends reflective message when silence trigger fires', async () => {
      mockDeadlineNotFired();
      mockSilenceFired();
      mockCommitmentNotFired();
      mockLLMResponse('Hey, been thinking about you. Everything good?');
      mockSendMessage.mockResolvedValueOnce({ message_id: 1 });

      const result = await runSweep();

      expect(result.triggered).toBe(true);
      expect(result.reflectiveResult?.triggered).toBe(true);
      expect(result.reflectiveResult?.triggerType).toBe('silence');
      expect(result.message).toBe('Hey, been thinking about you. Everything good?');

      expect(mockSendMessage).toHaveBeenCalledWith(
        12345,
        'Hey, been thinking about you. Everything good?',
      );
      expect(mockSaveMessage).toHaveBeenCalledWith(
        12345n,
        'ASSISTANT',
        'Hey, been thinking about you. Everything good?',
        'JOURNAL',
      );
      expect(mockSetLastSentReflective).toHaveBeenCalledTimes(1);
      expect(mockSetLastSentReflective).toHaveBeenCalledWith(expect.any(Date));
    });

    // Phase 32 #2: skip-when-no-USER-in-window guard
    it('skips reflective channel when no USER message in last 48h (no Sonnet call, no send, no cap update)', async () => {
      mockDeadlineNotFired();
      mockSilenceFired();
      mockCommitmentNotFired();
      mockCountMessagesSince.mockResolvedValueOnce(0);

      const result = await runSweep();

      expect(result.triggered).toBe(false);
      expect(result.reflectiveResult?.triggered).toBe(false);
      // No Sonnet call, no Telegram send, no cap update — the next sweep gets
      // a fresh chance with possibly fresh substrate.
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockSaveMessage).not.toHaveBeenCalled();
      expect(mockSetLastSentReflective).not.toHaveBeenCalled();
      // Guard query was checked with the configured user id and 'USER' role.
      expect(mockCountMessagesSince).toHaveBeenCalledWith(12345n, 'USER', expect.any(Date));
    });

    it('proceeds normally when at least one USER message exists in the window', async () => {
      // Default mock returns 1 — explicit assertion that the guard does not skip.
      mockCountMessagesSince.mockResolvedValueOnce(1);
      mockDeadlineNotFired();
      mockSilenceFired();
      mockCommitmentNotFired();
      mockLLMResponse('Hey, just thinking about your earlier note.');
      mockSendMessage.mockResolvedValueOnce({ message_id: 999 });

      const result = await runSweep();

      expect(result.triggered).toBe(true);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('passes trigger context into reflective system prompt for LLM', async () => {
      const context = 'John has been quiet for 5.0 days. His usual rhythm is about 1.2 days between messages.';
      mockDeadlineNotFired();
      mockSilenceFired(context);
      mockCommitmentNotFired();
      mockLLMResponse('Miss hearing from you, mate.');
      mockSendMessage.mockResolvedValueOnce({ message_id: 2 });

      await runSweep();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-6',
          system: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining(context),
              cache_control: { type: 'ephemeral' },
            }),
          ]),
          messages: expect.arrayContaining([
            expect.objectContaining({ content: context }),
          ]),
        }),
      );

      // System prompt should use PROACTIVE_SYSTEM_PROMPT (not accountability)
      const callArgs = mockCreate.mock.calls[0]![0];
      const systemText = Array.isArray(callArgs.system) ? callArgs.system[0].text : callArgs.system;
      expect(systemText).toContain('close and perceptive friend');
      expect(systemText).not.toContain('{triggerContext}');
    });

    it('fires reflective even when accountability already sent today', async () => {
      mockHasSentTodayAccountability.mockResolvedValue(true);
      mockHasSentTodayReflective.mockResolvedValue(false);
      mockSilenceFired();
      mockCommitmentNotFired();
      mockLLMResponse('Checking in!');
      mockSendMessage.mockResolvedValueOnce({ message_id: 104 });

      const result = await runSweep();

      expect(result.triggered).toBe(true);
      expect(result.reflectiveResult?.triggered).toBe(true);
      expect(result.accountabilityResult).toBeUndefined();
    });

    it('calls setLastSentReflective only after successful send — not before', async () => {
      const callOrder: string[] = [];
      mockDeadlineNotFired();
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
      mockSetLastSentReflective.mockImplementation(async () => {
        callOrder.push('setLastSentReflective');
      });

      await runSweep();

      expect(callOrder).toEqual(['sendMessage', 'saveMessage', 'setLastSentReflective']);
    });

    it('silence wins over commitment when both fire (priority 1 < 3)', async () => {
      mockDeadlineNotFired();
      mockSilenceFired();
      mockCommitmentFired();
      mockLLMResponse('Been a while — how are things?');
      mockSendMessage.mockResolvedValueOnce({ message_id: 10 });

      const result = await runSweep();

      expect(result.triggered).toBe(true);
      expect(result.reflectiveResult?.triggerType).toBe('silence');
    });

    it('commitment fires when silence does not trigger', async () => {
      mockDeadlineNotFired();
      mockSilenceNotFired();
      mockCommitmentFired();
      mockLLMResponse('Remember that running goal you mentioned?');
      mockSendMessage.mockResolvedValueOnce({ message_id: 11 });

      const result = await runSweep();

      expect(result.triggered).toBe(true);
      expect(result.reflectiveResult?.triggerType).toBe('commitment');
    });

    it('commitment context is passed to LLM when commitment is the winner', async () => {
      const commitmentContext = 'John made a commitment 14 days ago: "I want to start running every morning". There\'s been no follow-up.';
      mockDeadlineNotFired();
      mockSilenceNotFired();
      mockCommitmentFired(commitmentContext);
      mockLLMResponse('How is the running going?');
      mockSendMessage.mockResolvedValueOnce({ message_id: 12 });

      await runSweep();

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.arrayContaining([
            expect.objectContaining({
              type: 'text',
              text: expect.stringContaining(commitmentContext),
              cache_control: { type: 'ephemeral' },
            }),
          ]),
          messages: expect.arrayContaining([
            expect.objectContaining({ content: commitmentContext }),
          ]),
        }),
      );
    });
  });

  // ── Channel independence ─────────────────────────────────────────────────

  describe('channel independence', () => {
    it('both channels fire on the same sweep tick', async () => {
      mockDeadlineFired();
      mockSilenceFired();
      mockCommitmentNotFired();
      // Two LLM calls needed (one per channel)
      mockLLMResponse('Accountability: deadline check.');
      mockLLMResponse('Reflective: checking in.');
      mockSendMessage.mockResolvedValue({ message_id: 200 });

      const result = await runSweep();

      expect(result.triggered).toBe(true);
      expect(result.accountabilityResult?.triggered).toBe(true);
      expect(result.reflectiveResult?.triggered).toBe(true);
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });

    it('accountability fires BEFORE reflective (execution order)', async () => {
      const callOrder: string[] = [];
      mockDeadlineFired();
      mockSilenceFired();
      mockCommitmentNotFired();

      // Intercept LLM calls to distinguish them by call order
      mockCreate
        .mockImplementationOnce(async () => {
          callOrder.push('accountability-llm');
          return { content: [{ type: 'text', text: 'Accountability message' }] };
        })
        .mockImplementationOnce(async () => {
          callOrder.push('reflective-llm');
          return { content: [{ type: 'text', text: 'Reflective message' }] };
        });

      mockSendMessage.mockResolvedValue({ message_id: 201 });

      await runSweep();

      expect(callOrder.indexOf('accountability-llm')).toBeLessThan(
        callOrder.indexOf('reflective-llm'),
      );
    });

    it('accountability error does not block reflective channel', async () => {
      mockDeadlineFired();
      mockSilenceFired();
      mockCommitmentNotFired();

      // Accountability LLM fails
      mockCreate.mockRejectedValueOnce(new Error('Accountability LLM failed'));
      // Reflective LLM succeeds
      mockLLMResponse('Reflective message still goes out.');
      mockSendMessage.mockResolvedValueOnce({ message_id: 202 });

      const result = await runSweep();

      // Reflective should still fire
      expect(result.triggered).toBe(true);
      expect(result.reflectiveResult?.triggered).toBe(true);
      // Accountability should not have succeeded
      expect(result.accountabilityResult?.triggered).toBeFalsy();
      // Error logged for accountability
      expect(logger.error).toHaveBeenCalled();
    });

    it('reflective channel is skipped when already sent today, accountability still runs', async () => {
      mockHasSentTodayReflective.mockResolvedValue(true);
      mockHasSentTodayAccountability.mockResolvedValue(false);
      mockDeadlineFired();
      mockLLMResponse('Accountability check-in.');
      mockSendMessage.mockResolvedValueOnce({ message_id: 203 });

      const result = await runSweep();

      expect(result.triggered).toBe(true);
      expect(result.accountabilityResult?.triggered).toBe(true);
      expect(result.reflectiveResult).toBeUndefined();
      // Silence/commitment triggers should not have been called (reflective skipped)
      expect(mockSilenceDetect).not.toHaveBeenCalled();
    });
  });

  // ── Two-phase short-circuit tests (reflective channel) ───────────────────

  it('short-circuits Opus when silence trigger fires (reflective channel)', async () => {
    mockDeadlineNotFired();
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
    mockDeadlineNotFired();
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
    mockDeadlineNotFired();
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
    mockDeadlineNotFired();
    mockSilenceNotFired();
    mockCommitmentNotFired();
    mockBuildSweepContext.mockResolvedValueOnce('## Relational Memory\n- [PATTERN] John often mentions work stress on Mondays');
    mockRunOpusAnalysis.mockResolvedValueOnce({
      pattern: { detected: true, description: 'Monday stress pattern', evidence: ['Work stress mentions'], confidence: 0.8 },
      thread: { detected: false, description: '', evidence: [], confidence: 0 },
    });
    mockPatternDetect.mockResolvedValueOnce({
      triggered: true,
      triggerType: 'pattern',
      priority: 4,
      context: 'Monday stress pattern',
      evidence: ['Work stress mentions'],
    });
    mockLLMResponse('Mondays are rough, huh? How are you holding up?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 23 });

    const result = await runSweep();

    expect(result.triggered).toBe(true);
    expect(result.reflectiveResult?.triggerType).toBe('pattern');
    expect(mockBuildSweepContext).toHaveBeenCalledWith(10000);
    expect(mockRunOpusAnalysis).toHaveBeenCalled();
  });

  it('pattern wins over thread when both Opus triggers fire (priority 4 < 5)', async () => {
    mockDeadlineNotFired();
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
      priority: 4,
      context: 'Recurring pattern',
      evidence: ['evidence1'],
    });
    mockThreadDetect.mockResolvedValueOnce({
      triggered: true,
      triggerType: 'thread',
      priority: 5,
      context: 'Unresolved thread',
      evidence: ['evidence2'],
    });
    mockLLMResponse('Noticed a pattern...');
    mockSendMessage.mockResolvedValueOnce({ message_id: 24 });

    const result = await runSweep();

    expect(result.triggered).toBe(true);
    expect(result.reflectiveResult?.triggerType).toBe('pattern');
  });

  it('handles Opus phase gracefully when context builder throws', async () => {
    mockDeadlineNotFired();
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
    mockDeadlineNotFired();
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
    mockDeadlineNotFired();
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
      priority: 5,
      context: 'Unresolved thread about travel plans',
      evidence: ['thread evidence'],
    });
    mockLLMResponse('Did you ever sort out those travel plans?');
    mockSendMessage.mockResolvedValueOnce({ message_id: 25 });

    const result = await runSweep();

    expect(result.triggered).toBe(true);
    expect(result.reflectiveResult?.triggerType).toBe('thread');
    expect(result.message).toBe('Did you ever sort out those travel plans?');
  });

  it('does not send message when reflective Anthropic throws (wraps in outer catch)', async () => {
    mockDeadlineNotFired();
    mockSilenceFired();
    mockCommitmentNotFired();
    mockCreate.mockRejectedValueOnce(new Error('API rate limit'));

    // Reflective error should propagate (outer catch re-throws)
    await expect(runSweep()).rejects.toThrow('API rate limit');

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockSaveMessage).not.toHaveBeenCalled();
    expect(mockSetLastSentReflective).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      'proactive.sweep.error',
    );
  });

  // ── Ritual channel (RIT-09) ─────────────────────────────────────────────

  describe('ritual channel (RIT-09)', () => {
    it('runs the ritual channel between escalation and reflective', async () => {
      mockDeadlineNotFired();
      mockSilenceNotFired();
      mockCommitmentNotFired();
      mockRunRitualSweep.mockResolvedValueOnce([]);

      await runSweep();

      expect(mockRunRitualSweep).toHaveBeenCalledTimes(1);
      // It is invoked with a Date instance (the cron-tick `now`)
      expect(mockRunRitualSweep).toHaveBeenCalledWith(expect.any(Date));
    });

    it('ritual channel error does NOT block reflective channel', async () => {
      mockDeadlineNotFired();
      // Reflective WOULD have something to do — silence trigger fires.
      mockSilenceFired();
      mockCommitmentNotFired();
      mockLLMResponse('Hey, missing your check-ins.');
      mockSendMessage.mockResolvedValueOnce({ message_id: 999 });

      // Ritual channel throws — must be swallowed by the try/catch.
      mockRunRitualSweep.mockRejectedValueOnce(new Error('synthetic ritual error'));

      const result = await runSweep();

      // Reflective channel STILL ran and sent a message.
      expect(result.reflectiveResult?.triggered).toBe(true);
      expect(mockSendMessage).toHaveBeenCalled();
      expect(mockSetLastSentReflective).toHaveBeenCalled();
      // The thrown error was logged at the ritual-channel catch.
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'rituals.sweep.error',
      );
    });

    it('ritual channel respects global mute gate (does not run when isMuted=true)', async () => {
      mockIsMuted.mockResolvedValueOnce(true);

      await runSweep();

      expect(mockRunRitualSweep).not.toHaveBeenCalled();
    });
  });
});
