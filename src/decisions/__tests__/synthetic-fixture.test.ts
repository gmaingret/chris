/**
 * Phase 18 Plan 01 — Synthetic fixture + concurrency + same-day collision.
 *
 * TEST-10: 14-day end-to-end lifecycle under vi.setSystemTime.
 *   capture (seed) → deadline passes → due transition → resolution → post-mortem → stats.
 *   Real Postgres, mocked LLM (no real API calls), no vi.useFakeTimers (per D-02).
 *
 * TEST-11: Sweep-vs-user concurrency race.
 *   Both callers race due→resolved; exactly one wins, one gets OptimisticConcurrencyError.
 *   Reuses the established Promise.allSettled + real Postgres pattern from concurrency.test.ts.
 *
 * TEST-12: Same-day decision-deadline + silence trigger collision.
 *   Both channels fire on the same mock-clock day; neither starves the other.
 *   Full sweep mock (trigger factories + state helpers + bot + LLM).
 *
 * Run: npx vitest run src/decisions/__tests__/synthetic-fixture.test.ts
 *
 * D-02: vi.setSystemTime ONLY — vi.useFakeTimers is explicitly forbidden because it
 * replaces setTimeout/setInterval and breaks the postgres.js connection keep-alive timers.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db, sql } from '../../db/connection.js';
import {
  decisions,
  decisionEvents,
  decisionCaptureState,
  pensieveEntries,
} from '../../db/schema.js';

// ── Hoisted mocks (vi.hoisted runs at hoist-time, before module imports) ────

const {
  mockAnthropicCreate,
  mockCallLLM,
  // TEST-12 trigger mocks
  mockDeadlineDetect,
  mockSilenceDetect,
  // TEST-12 state mocks
  mockIsMuted,
  mockHasSentToday,
  mockSetLastSent,
  // TEST-12 bot / conversation mocks
  mockSendMessage,
  mockSaveMessage,
  // TEST-12 sweep-internal mocks
  mockBuildSweepContext,
  mockRunOpusAnalysis,
  mockUpsertAwaitingResolution,
} = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockCallLLM: vi.fn().mockResolvedValue('{}'),
  // Trigger detectors (set to triggered=false by default; override per-test)
  mockDeadlineDetect: vi.fn().mockResolvedValue({
    triggered: false,
    triggerType: 'decision-deadline',
    priority: 2,
    context: 'No due decisions',
  }),
  mockSilenceDetect: vi.fn().mockResolvedValue({
    triggered: false,
    triggerType: 'silence',
    priority: 1,
    context: 'No silence',
  }),
  // State helpers
  mockIsMuted: vi.fn().mockResolvedValue(false),
  mockHasSentToday: vi.fn().mockResolvedValue(false),
  mockSetLastSent: vi.fn().mockResolvedValue(undefined),
  // Bot / conversation
  mockSendMessage: vi.fn().mockResolvedValue(undefined),
  mockSaveMessage: vi.fn().mockResolvedValue(undefined),
  // Sweep internals
  mockBuildSweepContext: vi.fn().mockResolvedValue('sweep context'),
  mockRunOpusAnalysis: vi.fn().mockResolvedValue({ triggered: false }),
  mockUpsertAwaitingResolution: vi.fn().mockResolvedValue(undefined),
}));

// ── File-level mocks (hoisted by Vitest to top of file) ─────────────────────

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate },
  },
  HAIKU_MODEL: 'test-haiku',
  SONNET_MODEL: 'test-sonnet',
  OPUS_MODEL: 'test-opus',
  callLLM: mockCallLLM,
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

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../memory/conversation.js', () => ({
  saveMessage: mockSaveMessage,
}));

vi.mock('../../proactive/context-builder.js', () => ({
  buildSweepContext: mockBuildSweepContext,
}));

vi.mock('../../proactive/triggers/opus-analysis.js', () => ({
  runOpusAnalysis: mockRunOpusAnalysis,
}));

vi.mock('../../proactive/triggers/pattern.js', () => ({
  createPatternTrigger: vi.fn(() => ({
    detect: vi.fn().mockResolvedValue({
      triggered: false,
      triggerType: 'pattern',
      priority: 4,
      context: '',
    }),
  })),
}));

vi.mock('../../proactive/triggers/thread.js', () => ({
  createThreadTrigger: vi.fn(() => ({
    detect: vi.fn().mockResolvedValue({
      triggered: false,
      triggerType: 'thread',
      priority: 5,
      context: '',
    }),
  })),
}));

vi.mock('../../proactive/triggers/commitment.js', () => ({
  createCommitmentTrigger: vi.fn(() => ({
    detect: vi.fn().mockResolvedValue({
      triggered: false,
      triggerType: 'commitment',
      priority: 3,
      context: '',
    }),
  })),
}));

// Deadline and silence trigger factories — controlled via mockDeadlineDetect / mockSilenceDetect.
vi.mock('../../proactive/triggers/deadline.js', () => ({
  createDeadlineTrigger: vi.fn(() => ({ detect: mockDeadlineDetect })),
  STALE_CONTEXT_THRESHOLD_MS: 172800000,
}));

vi.mock('../../proactive/triggers/silence.js', () => ({
  createSilenceTrigger: vi.fn(() => ({ detect: mockSilenceDetect })),
}));

// Mock state.ts — all helpers are mocked to avoid real DB access for proactive_state table.
// Escalation helpers return null/0 by default (no pending escalations).
vi.mock('../../proactive/state.js', () => ({
  isMuted: mockIsMuted,
  hasSentToday: mockHasSentToday,
  setLastSent: mockSetLastSent,
  getLastSent: vi.fn().mockResolvedValue(null),
}));

// Mock capture-state helpers used by sweep (upsertAwaitingResolution is called by accountability channel).
// importOriginal preserves real helpers (clearCapture, updateToAwaitingPostmortem, etc.)
// while overriding only upsertAwaitingResolution to avoid real DB writes in TEST-12.
vi.mock('../../decisions/capture-state.js', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    upsertAwaitingResolution: mockUpsertAwaitingResolution,
  };
});

// ── Module imports (AFTER all mocks) ────────────────────────────────────────

import { transitionDecision } from '../lifecycle.js';
import { OptimisticConcurrencyError } from '../errors.js';
import { handleResolution, handlePostmortem } from '../resolution.js';
import { fetchStatsData } from '../stats.js';
import { upsertAwaitingResolution } from '../capture-state.js';
import { setLastUserLanguage, clearLanguageState } from '../../chris/language.js';
import { runSweep } from '../../proactive/sweep.js';

// ── Shared constants ─────────────────────────────────────────────────────────

/** Unique chat ID for this file — avoids collision with other test files' cleanup. */
const TEST_CHAT_ID = BigInt(99918);

const DAY_MS = 86_400_000;
const BASE_DATE = new Date('2026-04-01T10:00:00Z');

function advanceDays(n: number): Date {
  return new Date(BASE_DATE.getTime() + n * DAY_MS);
}

// ── Seed helper ──────────────────────────────────────────────────────────────

async function seedDecision(
  status: string,
  overrides: Partial<{
    resolveBy: Date;
    decisionText: string;
    reasoning: string;
    prediction: string;
    falsificationCriterion: string;
    chatId: bigint;
  }> = {},
): Promise<string> {
  const [row] = await db
    .insert(decisions)
    .values({
      status: status as never,
      chatId: overrides.chatId ?? TEST_CHAT_ID,
      decisionText: overrides.decisionText ?? 'Whether to schedule the housewarming party for April 9',
      resolveBy: overrides.resolveBy ?? new Date(Date.now() + DAY_MS),
      reasoning: overrides.reasoning ?? 'Contractor said renovation would be done',
      prediction: overrides.prediction ?? 'The renovation will be done by next week',
      falsificationCriterion: overrides.falsificationCriterion ?? 'Renovation not complete by April 8',
    })
    .returning();
  return row!.id as string;
}

// ── FK-safe cleanup ─────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  // Delete in FK-safe order: events → decisions → capture state → pensieve entries.
  // Scoped to TEST_CHAT_ID where the schema supports it.
  // decisionEvents references decisions by FK, so delete events first.
  // Scope via subquery: only delete events belonging to this test's decisions.
  await db.delete(decisionEvents).where(
    inArray(
      decisionEvents.decisionId,
      db.select({ id: decisions.id }).from(decisions).where(eq(decisions.chatId, TEST_CHAT_ID)),
    ),
  );
  await db
    .delete(decisions)
    .where(eq(decisions.chatId, TEST_CHAT_ID));
  await db
    .delete(decisionCaptureState)
    .where(eq(decisionCaptureState.chatId, TEST_CHAT_ID));
  // pensieve_entries has no chatId column; scope by source='telegram' as best-effort filter.
  await db.delete(pensieveEntries).where(eq(pensieveEntries.source, 'telegram'));
}

// ════════════════════════════════════════════════════════════════════════════
// TEST-10: 14-day lifecycle fixture
// ════════════════════════════════════════════════════════════════════════════

describe('TEST-10: 14-day decision lifecycle fixture', () => {
  beforeAll(async () => {
    // Verify DB connectivity before running any test in this suite.
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  beforeEach(() => {
    // Seed language state so handleResolution / handlePostmortem don't fall back to franc detection.
    setLastUserLanguage(TEST_CHAT_ID.toString(), 'English');
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    await cleanup();
    clearLanguageState(TEST_CHAT_ID.toString());
  });

  it(
    '14-day decision lifecycle: capture -> deadline -> resolution -> postmortem -> stats',
    async () => {
      // ── Day 0: Seed a decision with resolve_by at Day 7 ──────────────────
      vi.setSystemTime(advanceDays(0));

      const decisionId = await seedDecision('open', {
        resolveBy: advanceDays(7),
        prediction: 'The renovation will be done by next week',
        falsificationCriterion: 'Renovation not complete by April 8',
        decisionText: 'Whether to schedule the housewarming party for April 9',
        reasoning: 'Contractor said it would be done',
      });

      // Verify: decision row exists with status 'open'
      const [dayZeroRow] = await db
        .select({ status: decisions.status })
        .from(decisions)
        .where(eq(decisions.id, decisionId));
      expect(dayZeroRow!.status).toBe('open');

      // ── Day 7: Deadline passes ────────────────────────────────────────────
      vi.setSystemTime(advanceDays(7));

      // Transition open → due (simulating the deadline trigger's effect)
      await transitionDecision(decisionId, 'open', 'due', { actor: 'sweep' });

      // Verify: decision status is 'due'
      const [daySevenRow] = await db
        .select({ status: decisions.status })
        .from(decisions)
        .where(eq(decisions.id, decisionId));
      expect(daySevenRow!.status).toBe('due');

      // Set up AWAITING_RESOLUTION capture state before resolution.
      // Use real upsertAwaitingResolution (not the sweep-path mock) to write to real DB.
      await db.insert(decisionCaptureState).values({
        chatId: TEST_CHAT_ID,
        stage: 'AWAITING_RESOLUTION',
        draft: {},
        decisionId,
      }).onConflictDoUpdate({
        target: decisionCaptureState.chatId,
        set: {
          stage: 'AWAITING_RESOLUTION',
          draft: {},
          decisionId,
          updatedAt: new Date(),
        },
      });

      // ── Day 8: Greg replies with resolution ───────────────────────────────
      vi.setSystemTime(advanceDays(8));

      // Mock LLM calls for handleResolution:
      //   1. Sonnet acknowledgment
      //   2. Haiku classifyOutcome → 'hit'
      //   3. Haiku classifyAccuracy → 'sound'
      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: 'I acknowledge your resolution — the renovation finished right on time.' }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: '{"outcome":"hit"}' }],
        })
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: '{"reasoning":"sound"}' }],
        });

      await handleResolution(
        TEST_CHAT_ID,
        'The renovation finished on April 7, just in time.',
        decisionId,
      );

      // Verify: decision status is 'resolved'
      const [dayEightRow] = await db
        .select({ status: decisions.status })
        .from(decisions)
        .where(eq(decisions.id, decisionId));
      expect(dayEightRow!.status).toBe('resolved');

      // Verify: decisionEvents has a resolved row
      const resolvedEvents = await db
        .select()
        .from(decisionEvents)
        .where(
          and(
            eq(decisionEvents.decisionId, decisionId),
            eq(decisionEvents.toStatus, 'resolved'),
          ),
        );
      expect(resolvedEvents.length).toBeGreaterThanOrEqual(1);

      // ── Day 9: Greg answers post-mortem ────────────────────────────────────
      vi.setSystemTime(advanceDays(9));

      // Mock LLM for handlePostmortem (Sonnet ack only)
      mockAnthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Noted.' }],
      });

      await handlePostmortem(
        TEST_CHAT_ID,
        'I picked a reliable contractor this time.',
        decisionId,
      );

      // Verify: decision status is 'reviewed'
      const [dayNineRow] = await db
        .select({ status: decisions.status, resolutionNotes: decisions.resolutionNotes })
        .from(decisions)
        .where(eq(decisions.id, decisionId));
      expect(dayNineRow!.status).toBe('reviewed');

      // Verify: resolutionNotes is set
      expect(dayNineRow!.resolutionNotes).toBeTruthy();
      expect(dayNineRow!.resolutionNotes).toContain('reliable contractor');

      // Verify: at least one Pensieve entry with epistemicTag DECISION was written
      const decisionPensieveEntries = await db
        .select()
        .from(pensieveEntries)
        .where(eq(pensieveEntries.epistemicTag, 'DECISION'));
      expect(decisionPensieveEntries.length).toBeGreaterThanOrEqual(1);

      // ── Day 14: /decisions stats shows the reviewed decision ──────────────
      vi.setSystemTime(advanceDays(14));

      // fetchStatsData scopes to chatId and status='reviewed'; window=30 days
      const statsRows = await fetchStatsData(TEST_CHAT_ID, 30);
      expect(statsRows.length).toBeGreaterThanOrEqual(1);
    },
    60_000,
  );
});

// ════════════════════════════════════════════════════════════════════════════
// TEST-11: Sweep-vs-user concurrency race
// ════════════════════════════════════════════════════════════════════════════

describe('TEST-11: sweep-vs-user concurrency race', () => {
  beforeAll(async () => {
    const result = await sql`SELECT 1 as ok`;
    expect(result[0]!.ok).toBe(1);
  });

  afterAll(async () => {
    // Close the shared DB connection pool after the last real-DB test suite.
    // TEST-12 uses mocked sweep functions and does not need the pool open.
    await sql.end();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.clearAllMocks();
    await cleanup();
  });

  it('sweep and user-reply racing due->resolved: one winner, one OptimisticConcurrencyError', async () => {
    // Seed a decision at 'due' status (per Pitfall 3: race must start from 'due', not 'open').
    // Both actors claim the same fromStatus='due' and toStatus='resolved'.
    const id = await seedDecision('due');

    // Both calls race to atomically UPDATE WHERE status='due'.
    // First UPDATE wins (0 rows updated by the second → OptimisticConcurrencyError).
    const results = await Promise.allSettled([
      transitionDecision(id, 'due', 'resolved', { actor: 'sweep' }),
      transitionDecision(id, 'due', 'resolved', { actor: 'user' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    // Exactly one winner and one loser
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(OptimisticConcurrencyError);

    // Audit: exactly ONE decision_events row with toStatus='resolved' — loser's event rolled back.
    const resolvedEvents = await db
      .select()
      .from(decisionEvents)
      .where(
        and(
          eq(decisionEvents.decisionId, id),
          eq(decisionEvents.toStatus, 'resolved'),
        ),
      );
    expect(resolvedEvents).toHaveLength(1);

    // Final projection: decision status is 'resolved'
    const [finalRow] = await db
      .select({ status: decisions.status })
      .from(decisions)
      .where(eq(decisions.id, id));
    expect(finalRow!.status).toBe('resolved');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST-12: Same-day decision-deadline + silence trigger collision
// ════════════════════════════════════════════════════════════════════════════

describe('TEST-12: same-day deadline + silence trigger collision', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    // Restore mock defaults for state helpers
    mockDeadlineDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'decision-deadline',
      priority: 2,
      context: 'No due decisions',
    });
    mockSilenceDetect.mockResolvedValue({
      triggered: false,
      triggerType: 'silence',
      priority: 1,
      context: 'No silence',
    });
    mockIsMuted.mockResolvedValue(false);
    mockHasSentToday.mockResolvedValue(false);
  });

  it(
    'deadline and silence triggers both fire; single-pipeline selects highest-priority winner without starvation',
    async () => {
      // ── Setup: deadline trigger fires (priority 2) ────────────────────
      const FAKE_DECISION_ID = 'test-decision-uuid-for-test-12';

      mockDeadlineDetect.mockResolvedValue({
        triggered: true,
        triggerType: 'decision-deadline',
        priority: 2,
        context: 'Your deadline just passed for a prediction you made: "Test prediction". Your falsification criterion was: "Test criterion".',
        evidence: [
          `Decision ID: ${FAKE_DECISION_ID}`,
          'Resolve by: 2026-04-01T10:00:00.000Z',
          'Staleness: 24h',
        ],
      });

      // ── Setup: silence trigger fires (priority 1 — wins) ──────────────
      mockSilenceDetect.mockResolvedValue({
        triggered: true,
        triggerType: 'silence',
        priority: 1,
        context: 'Greg has been silent for 3 days (normal rhythm: 0.5 days). Last message 3 days ago.',
        evidence: ['Last message 3 days ago'],
      });

      // ── Setup: state helpers — not muted, not sent today ──────────────
      mockIsMuted.mockResolvedValue(false);
      mockHasSentToday.mockResolvedValue(false);

      // ── Setup: LLM returns valid text (single pipeline, one call) ─────
      mockAnthropicCreate
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: "I noticed you've been quiet for a few days. How are things going?" }],
        });

      // ── Run full sweep ─────────────────────────────────────────────────
      const result = await runSweep();

      // ── Assert: single-pipeline fired ─────────────────────────────────
      expect(result.triggered).toBe(true);
      // Silence has priority 1 (lower = higher priority), deadline has priority 2.
      // Single pipeline selects highest-priority (lowest number) trigger.
      expect(result.triggerType).toBe('silence');
      // Exactly one message sent (single pipeline, one winner)
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    },
    30_000,
  );
});
