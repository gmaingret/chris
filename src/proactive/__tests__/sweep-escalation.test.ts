/**
 * Phase 16 Plan 05 — sweep escalation tests (GREEN).
 * Covers RES-06 48h escalation and stale transition.
 *
 * Run: npx vitest run src/proactive/__tests__/sweep-escalation.test.ts
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// ── Hoisted mocks (must be defined before any imports) ────────────────────

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
  // In-memory store for proactive_state (used by real state.ts functions)
  stateStore,
  // Configurable AWAITING_RESOLUTION rows for escalation queries
  awaitingRows,
  // Configurable decisions rows for follow-up context queries
  decisionRows,
} = vi.hoisted(() => {
  const stateStore = new Map<string, unknown>();
  const awaitingRows: Array<{ chatId: bigint; decisionId: string | null }> = [];
  const decisionRows: Array<Record<string, unknown>> = [];

  return {
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
    stateStore,
    awaitingRows,
    decisionRows,
  };
});

// ── DB mock (in-memory, supports real state.ts read/write) ────────────────
// The db mock must handle:
//   1. proactiveState selects/inserts/deletes (used by real state.ts functions)
//   2. decisionCaptureState selects (used by sweep escalation block)
//   3. decisions selects (used by sweep escalation follow-up context)

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

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../db/connection.js', () => {
  // Drizzle stores the table name in a Symbol
  const DRIZZLE_NAME_SYMBOL = Symbol.for('drizzle:Name');

  function getTableName(table: unknown): string {
    if (table && typeof table === 'object') {
      const sym = (table as Record<symbol, unknown>)[DRIZZLE_NAME_SYMBOL];
      if (typeof sym === 'string') return sym;
    }
    return '';
  }

  const db = {
    select: vi.fn().mockImplementation((_fields?: unknown) => {
      let tableName = '';
      const chain: Record<string, unknown> = {};

      chain.from = vi.fn().mockImplementation((table: unknown) => {
        tableName = getTableName(table);
        return chain;
      });

      chain.where = vi.fn().mockReturnValue(chain);

      chain.orderBy = vi.fn().mockReturnValue(chain);

      chain.limit = vi.fn().mockImplementation((_n: number) => {
        // decisions table (not capture, not events)
        if (tableName === 'decisions') {
          return Promise.resolve(decisionRows);
        }
        // decision_capture_state select: escalation scan uses .orderBy().limit()
        if (tableName === 'decision_capture_state') {
          return Promise.resolve(awaitingRows);
        }
        return Promise.resolve([]);
      });

      // Make the chain directly awaitable (for `await db.select().from(t).where(c)`)
      Object.defineProperty(chain, 'then', {
        get() {
          return (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
            let result: unknown;
            if (tableName === 'decision_capture_state') {
              result = awaitingRows;
            } else if (tableName === 'decisions') {
              result = decisionRows;
            } else {
              // proactive_state selects — return empty (stateStore is used by mocked state helpers)
              result = [];
            }
            return Promise.resolve(result).then(onFulfilled, onRejected);
          };
        },
      });

      return chain;
    }),

    insert: vi.fn().mockImplementation((_table: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.values = vi.fn().mockImplementation((vals: { key?: string; value?: unknown }) => {
        if (vals && typeof vals.key === 'string') {
          stateStore.set(vals.key, vals.value);
        }
        const inner: Record<string, unknown> = {};
        inner.onConflictDoUpdate = vi.fn().mockImplementation((opts: { set?: { value?: unknown } }) => {
          if (vals && typeof vals.key === 'string' && opts?.set?.value !== undefined) {
            stateStore.set(vals.key, opts.set.value);
          }
          return Promise.resolve(undefined);
        });
        return inner;
      });
      return chain;
    }),

    delete: vi.fn().mockImplementation((_table: unknown) => {
      const chain: Record<string, unknown> = {};
      chain.where = vi.fn().mockReturnValue(Promise.resolve(undefined));
      return chain;
    }),
  };

  return { db };
});

// Override state.ts getValue/setValue/deleteKey by hooking into the in-memory stateStore.
// We use importOriginal so real escalation helpers (getEscalationSentAt etc.) are preserved,
// but mock the channel-level helpers to avoid needing full DB setup for them.
vi.mock('../state.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../state.js')>();

  // Override getValue/setValue/deleteKey indirectly by providing real-function wrappers
  // that read/write from stateStore instead of DB. We can't override private helpers,
  // so we re-implement the public escalation API directly here.
  const escalationSentKey = (id: string) => `accountability_sent_${id}`;
  const escalationCountKey = (id: string) => `accountability_prompt_count_${id}`;

  return {
    ...mod,
    // Channel-level mocks
    isMuted: mockIsMuted,
    hasSentTodayAccountability: mockHasSentTodayAccountability,
    setLastSentAccountability: mockSetLastSentAccountability,
    hasSentTodayReflective: mockHasSentTodayReflective,
    setLastSentReflective: mockSetLastSentReflective,
    // Escalation helpers — real implementations backed by in-memory stateStore
    getEscalationSentAt: vi.fn().mockImplementation((decisionId: string) => {
      const val = stateStore.get(escalationSentKey(decisionId));
      return Promise.resolve(val ? new Date(val as string) : null);
    }),
    setEscalationSentAt: vi.fn().mockImplementation((decisionId: string, timestamp: Date) => {
      stateStore.set(escalationSentKey(decisionId), timestamp.toISOString());
      return Promise.resolve();
    }),
    getEscalationCount: vi.fn().mockImplementation((decisionId: string) => {
      const val = stateStore.get(escalationCountKey(decisionId));
      return Promise.resolve(typeof val === 'number' ? val : 0);
    }),
    setEscalationCount: vi.fn().mockImplementation((decisionId: string, count: number) => {
      stateStore.set(escalationCountKey(decisionId), count);
      return Promise.resolve();
    }),
    clearEscalationKeys: vi.fn().mockImplementation((decisionId: string) => {
      stateStore.delete(escalationSentKey(decisionId));
      stateStore.delete(escalationCountKey(decisionId));
      return Promise.resolve();
    }),
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
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    upsertAwaitingResolution: mockUpsertAwaitingResolution,
    clearCapture: mockClearCapture,
  };
});

vi.mock('../../decisions/lifecycle.js', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    transitionDecision: mockTransitionDecision,
  };
});

vi.mock('../../chris/language.js', () => ({
  getLastUserLanguage: mockGetLastUserLanguage,
}));

vi.mock('../triggers/silence.js', () => ({
  createSilenceTrigger: vi.fn(() => ({ detect: vi.fn().mockResolvedValue({ triggered: false, triggerType: 'silence', priority: 1, context: '' }) })),
}));

vi.mock('../triggers/commitment.js', () => ({
  createCommitmentTrigger: vi.fn(() => ({ detect: vi.fn().mockResolvedValue({ triggered: false, triggerType: 'commitment', priority: 3, context: '' }) })),
}));

// ── Import the functions under test AFTER all mocks ───────────────────────

import {
  getEscalationSentAt,
  getEscalationCount,
  setEscalationSentAt,
  setEscalationCount,
} from '../state.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const DECISION_ID = 'test-decision-uuid-escalation';
const CHAT_ID_NUM = 12345;

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

function setupAwaitingRow(): void {
  awaitingRows.length = 0;
  awaitingRows.push({ chatId: BigInt(CHAT_ID_NUM), decisionId: DECISION_ID });
}

function setupDecisionRow(): void {
  decisionRows.length = 0;
  decisionRows.push({
    id: DECISION_ID,
    decisionText: 'Will close Series A by Q3',
    prediction: 'Will close Series A by Q3',
    falsificationCriterion: 'Signed term sheet by 2024-09-30',
    resolveBy: new Date('2024-09-30'),
    status: 'due',
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('sweep escalation', () => {
  afterEach(() => {
    vi.clearAllMocks();
    stateStore.clear();
    awaitingRows.length = 0;
    decisionRows.length = 0;
    // Reset default mock returns
    mockIsMuted.mockResolvedValue(false);
    mockHasSentTodayAccountability.mockResolvedValue(false);
    mockHasSentTodayReflective.mockResolvedValue(false);
    mockDeadlineDetect.mockResolvedValue({ triggered: false });
    mockCreate.mockReset();
  });

  it('records first prompt timestamp in proactive_state', async () => {
    // When sweep fires the first accountability prompt for a decision,
    // it should record escalation timestamp and count=1.
    mockDeadlineDetect.mockResolvedValue({
      triggered: true,
      context: `Decision is overdue.\nDecision ID: ${DECISION_ID}`,
      evidence: [`Decision ID: ${DECISION_ID}`],
    });

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Your deadline was 2 days ago — how did it go?' }],
    });

    // No AWAITING_RESOLUTION row yet (first prompt)
    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // After sweep, escalation timestamp should be set
    const sentAt = await getEscalationSentAt(DECISION_ID);
    expect(sentAt).toBeInstanceOf(Date);

    const count = await getEscalationCount(DECISION_ID);
    expect(count).toBe(1);
  });

  it('fires second prompt after 48h of no reply', async () => {
    // Pre-condition: escalation count=1, sentAt=50h ago
    await setEscalationCount(DECISION_ID, 1);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    // AWAITING_RESOLUTION row exists
    setupAwaitingRow();
    setupDecisionRow();

    mockDeadlineDetect.mockResolvedValue({ triggered: false });

    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'A couple days ago I asked about your decision...' }],
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

    setupAwaitingRow();

    mockDeadlineDetect.mockResolvedValue({ triggered: false });

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

    setupAwaitingRow();

    mockDeadlineDetect.mockResolvedValue({ triggered: false });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // Within 48h window — no second message should be sent
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('second prompt text acknowledges follow-up context', async () => {
    await setEscalationCount(DECISION_ID, 1);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    setupAwaitingRow();
    setupDecisionRow();

    mockDeadlineDetect.mockResolvedValue({ triggered: false });

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
    await setEscalationCount(DECISION_ID, 2);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    setupAwaitingRow();

    mockDeadlineDetect.mockResolvedValue({ triggered: false });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // Transition should have been called
    expect(mockTransitionDecision).toHaveBeenCalled();

    // But NO Telegram message should be sent (silent stale transition)
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it('escalation bypasses daily accountability cap', async () => {
    // Per Pitfall 4: hasSentTodayAccountability=true should NOT block escalation
    mockHasSentTodayAccountability.mockResolvedValue(true); // daily cap is "full"

    await setEscalationCount(DECISION_ID, 1);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    setupAwaitingRow();
    setupDecisionRow();

    mockDeadlineDetect.mockResolvedValue({ triggered: false });

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

    setupAwaitingRow();

    mockDeadlineDetect.mockResolvedValue({ triggered: false });

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // clearCapture must be called to prevent orphaned AWAITING_RESOLUTION row
    expect(mockClearCapture).toHaveBeenCalledWith(BigInt(CHAT_ID_NUM));
  });

  it('WR-01: when stale transition fails (race lost), clearCapture is NOT called', async () => {
    // Scenario: Greg replied to the accountability prompt between the escalation
    // check and the stale transition attempt. handleResolution flipped due→resolved
    // and set AWAITING_POSTMORTEM. The sweep's due→stale transition then fails
    // (InvalidTransitionError / OptimisticConcurrencyError). The fix guarantees
    // clearCapture is NOT called, preserving Greg's AWAITING_POSTMORTEM state.
    await setEscalationCount(DECISION_ID, 2);
    await setEscalationSentAt(DECISION_ID, hoursAgo(50));

    setupAwaitingRow();

    mockDeadlineDetect.mockResolvedValue({ triggered: false });
    // Simulate race: transition throws because decision is already 'resolved'
    mockTransitionDecision.mockRejectedValueOnce(new Error('InvalidTransitionError'));

    const { runSweep } = await import('../sweep.js');
    await runSweep();

    // Transition was attempted
    expect(mockTransitionDecision).toHaveBeenCalledWith(
      DECISION_ID,
      'due',
      'stale',
      expect.objectContaining({ actor: expect.any(String) }),
    );

    // clearCapture must NOT be called — it would wipe Greg's AWAITING_POSTMORTEM state
    expect(mockClearCapture).not.toHaveBeenCalled();
  });
});
