/**
 * Phase 16 Wave 0 RED scaffold — sweep escalation for overdue decisions.
 * Covers RES-05/RES-06 48h escalation and stale transition.
 *
 * ALL tests are intentionally failing (RED). They import escalation helper
 * functions from src/proactive/state.ts that do not yet exist.
 * Plans 04-05 will turn these GREEN.
 *
 * Run: npx vitest run src/proactive/__tests__/sweep-escalation.test.ts
 */
// @ts-expect-error — Plan 04 adds escalation helpers to src/proactive/state.ts
import {
  getEscalationSentAt,
  getEscalationCount,
  setEscalationSentAt,
  setEscalationCount,
  clearEscalationKeys,
} from '../state.js';

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// ── Mock DB layer ──────────────────────────────────────────────────────────

const {
  mockIsMuted,
  mockHasSentTodayAccountability,
  mockSetLastSentAccountability,
  mockHasSentTodayReflective,
  mockSetLastSentReflective,
  mockDeadlineDetect,
  mockSendMessage,
  mockCreate,
  mockSaveMessage,
  mockBuildSweepContext,
  mockRunOpusAnalysis,
  mockPatternDetect,
  mockThreadDetect,
  mockUpsertAwaitingResolution,
  mockTransitionDecision,
  mockClearCapture,
  mockGetLastUserLanguage,
} = vi.hoisted(() => ({
  mockIsMuted: vi.fn().mockResolvedValue(false),
  mockHasSentTodayAccountability: vi.fn().mockResolvedValue(false),
  mockSetLastSentAccountability: vi.fn().mockResolvedValue(undefined),
  mockHasSentTodayReflective: vi.fn().mockResolvedValue(false),
  mockSetLastSentReflective: vi.fn().mockResolvedValue(undefined),
  mockDeadlineDetect: vi.fn().mockResolvedValue({ triggered: false }),
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockCreate: vi.fn(),
  mockSaveMessage: vi.fn().mockResolvedValue(undefined),
  mockBuildSweepContext: vi.fn().mockResolvedValue(''),
  mockRunOpusAnalysis: vi.fn().mockResolvedValue({ triggered: false }),
  mockPatternDetect: vi.fn().mockResolvedValue({ triggered: false }),
  mockThreadDetect: vi.fn().mockResolvedValue({ triggered: false }),
  mockUpsertAwaitingResolution: vi.fn().mockResolvedValue(undefined),
  mockTransitionDecision: vi.fn().mockResolvedValue(undefined),
  mockClearCapture: vi.fn().mockResolvedValue(undefined),
  mockGetLastUserLanguage: vi.fn().mockResolvedValue('English'),
}));

vi.mock('../state.js', async (importOriginal) => {
  // Spread real module so existing exports are preserved; override what we mock
  const mod: Record<string, unknown> = await importOriginal();
  return {
    ...mod,
    isMuted: mockIsMuted,
    hasSentTodayAccountability: mockHasSentTodayAccountability,
    setLastSentAccountability: mockSetLastSentAccountability,
    hasSentTodayReflective: mockHasSentTodayReflective,
    setLastSentReflective: mockSetLastSentReflective,
  };
});

vi.mock('../triggers/deadline.js', () => ({
  createDeadlineTrigger: vi.fn(() => ({ detect: mockDeadlineDetect })),
  STALE_CONTEXT_THRESHOLD_MS: 172800000,
}));

vi.mock('../../bot/bot.js', () => {
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

vi.mock('../../decisions/capture-state.js', async (importOriginal) => {
  const mod: Record<string, unknown> = await importOriginal();
  return {
    ...mod,
    upsertAwaitingResolution: mockUpsertAwaitingResolution,
    clearCapture: mockClearCapture,
  };
});

vi.mock('../../decisions/lifecycle.js', async (importOriginal) => {
  const mod: Record<string, unknown> = await importOriginal();
  return {
    ...mod,
    transitionDecision: mockTransitionDecision,
  };
});

vi.mock('../../chris/language.js', () => ({
  getLastUserLanguage: mockGetLastUserLanguage,
}));

vi.mock('../triggers/silence.js', () => ({
  createSilenceTrigger: vi.fn(() => ({ detect: vi.fn().mockResolvedValue({ triggered: false }) })),
}));

vi.mock('../triggers/commitment.js', () => ({
  createCommitmentTrigger: vi.fn(() => ({ detect: vi.fn().mockResolvedValue({ triggered: false }) })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const DECISION_ID = 'test-decision-uuid-escalation';
const CHAT_ID_NUM = 12345;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3600_000);
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('sweep escalation', () => {
  beforeAll(async () => {
    // Verify the import itself fails (RED — escalation helpers not yet in state.ts)
    // The import at module top will already cause RED status
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('records first prompt timestamp in proactive_state', async () => {
    // When sweep fires the first accountability prompt for a decision,
    // it should record the escalation timestamp under the decision's key.
    // getEscalationSentAt should return a Date after the sweep fires.

    mockDeadlineDetect.mockResolvedValue({
      triggered: true,
      context: `Decision is overdue.\nDecision ID: ${DECISION_ID}`,
      evidence: [`Decision ID: ${DECISION_ID}`],
    });

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Your deadline was 2 days ago — how did it go?' }],
    });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // After sweep, escalation timestamp should be set
    const sentAt = await getEscalationSentAt(DECISION_ID);
    expect(sentAt).toBeInstanceOf(Date);
  });

  it('fires second prompt after 48h of no reply', async () => {
    // Pre-condition: escalation count=1, sentAt=50h ago
    await setEscalationCount(DECISION_ID, 1);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    mockDeadlineDetect.mockResolvedValue({
      triggered: true,
      context: `Decision overdue.\nDecision ID: ${DECISION_ID}`,
      evidence: [`Decision ID: ${DECISION_ID}`],
    });

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Following up — a couple days ago I asked how your decision went...' }],
    });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // Second message sent to Telegram
    expect(mockSendMessage).toHaveBeenCalledOnce();

    // Escalation count incremented to 2
    const newCount = await getEscalationCount(DECISION_ID);
    expect(newCount).toBe(2);
  });

  it('transitions to stale after 2 non-replies', async () => {
    // Pre-condition: escalation count=2, sentAt=50h ago
    await setEscalationCount(DECISION_ID, 2);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    mockDeadlineDetect.mockResolvedValue({
      triggered: true,
      context: `Decision overdue.\nDecision ID: ${DECISION_ID}`,
      evidence: [`Decision ID: ${DECISION_ID}`],
    });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // Should transition decision to 'stale'
    expect(mockTransitionDecision).toHaveBeenCalledWith(
      DECISION_ID,
      'due',
      'stale',
      expect.objectContaining({ actor: expect.any(String) }),
    );

    // Should clear capture state
    expect(mockClearCapture).toHaveBeenCalledWith(BigInt(CHAT_ID_NUM));
  });

  it('does not fire escalation within 48h window', async () => {
    // Pre-condition: escalation count=1, sentAt=24h ago (still within 48h window)
    await setEscalationCount(DECISION_ID, 1);
    await setEscalationSentAt(DECISION_ID, hoursAgo(24));

    mockDeadlineDetect.mockResolvedValue({
      triggered: true,
      context: `Decision overdue.\nDecision ID: ${DECISION_ID}`,
      evidence: [`Decision ID: ${DECISION_ID}`],
    });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // Within 48h window — no second message should be sent
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('second prompt text acknowledges follow-up context', async () => {
    // The second escalation prompt should not be a robotic repeat.
    // It should acknowledge that this is a follow-up.
    await setEscalationCount(DECISION_ID, 1);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    mockDeadlineDetect.mockResolvedValue({
      triggered: true,
      context: `Decision overdue.\nDecision ID: ${DECISION_ID}`,
      evidence: [`Decision ID: ${DECISION_ID}`],
    });

    let sentText = '';
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'A couple days ago I asked about your decision...' }],
    });
    mockSendMessage.mockImplementation((_chatId: unknown, text: string) => {
      sentText = text;
      return Promise.resolve(undefined);
    });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // Second prompt should acknowledge it is a follow-up
    expect(
      sentText.toLowerCase().includes('couple days') ||
      sentText.toLowerCase().includes('follow') ||
      sentText.toLowerCase().includes('asked') ||
      sentText.toLowerCase().includes('ago'),
    ).toBe(true);
  });

  it('stale transition is silent — no message sent to Telegram', async () => {
    // Per D-17: when a decision goes stale (count=2, 48h elapsed),
    // the sweep should NOT send any message to Telegram.
    // Only the transition happens silently.
    await setEscalationCount(DECISION_ID, 2);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    mockDeadlineDetect.mockResolvedValue({
      triggered: true,
      context: `Decision overdue.\nDecision ID: ${DECISION_ID}`,
      evidence: [`Decision ID: ${DECISION_ID}`],
    });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // Transition should have been called
    expect(mockTransitionDecision).toHaveBeenCalled();

    // But NO Telegram message should be sent (silent stale transition)
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('escalation bypasses daily accountability cap', async () => {
    // Per Pitfall 4: hasSentTodayAccountability=true should NOT block escalation
    // (escalation is time-based, not daily-cap-based)
    mockHasSentTodayAccountability.mockResolvedValue(true); // daily cap is "full"

    await setEscalationCount(DECISION_ID, 1);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    mockDeadlineDetect.mockResolvedValue({
      triggered: true,
      context: `Decision overdue.\nDecision ID: ${DECISION_ID}`,
      evidence: [`Decision ID: ${DECISION_ID}`],
    });

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Following up on your decision from 2 days ago...' }],
    });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // Escalation should fire despite daily cap being reached
    expect(mockSendMessage).toHaveBeenCalledOnce();
  });

  it('clearCapture called on stale transition', async () => {
    // Per Pitfall 5: clearCapture must be called when a decision goes stale,
    // otherwise the AWAITING_RESOLUTION row is orphaned.
    await setEscalationCount(DECISION_ID, 2);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    mockDeadlineDetect.mockResolvedValue({
      triggered: true,
      context: `Decision overdue.\nDecision ID: ${DECISION_ID}`,
      evidence: [`Decision ID: ${DECISION_ID}`],
    });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // clearCapture must be called to prevent orphaned AWAITING_RESOLUTION row
    expect(mockClearCapture).toHaveBeenCalledWith(BigInt(CHAT_ID_NUM));
  });
});
