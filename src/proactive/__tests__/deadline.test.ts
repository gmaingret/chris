import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock DB layer (K001 pattern — vi.hoisted) ─────────────────────────────

const { mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn().mockResolvedValue([]);
  const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
  return { mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect };
});

vi.mock('../../db/connection.js', () => ({
  db: {
    select: mockSelect,
  },
}));

// ── Mock transitionDecision ────────────────────────────────────────────────

const { mockTransitionDecision } = vi.hoisted(() => {
  const mockTransitionDecision = vi.fn().mockResolvedValue(undefined);
  return { mockTransitionDecision };
});

vi.mock('../../decisions/lifecycle.js', () => ({
  transitionDecision: mockTransitionDecision,
}));

// ── Import errors AFTER mocks (real classes, not mocked) ──────────────────

import {
  OptimisticConcurrencyError,
  InvalidTransitionError,
} from '../../decisions/errors.js';

// ── Import module under test AFTER mocks ───────────────────────────────────

import { createDeadlineTrigger, STALE_CONTEXT_THRESHOLD_MS } from '../triggers/deadline.js';

// ── Helpers ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-04-16T12:00:00Z');

function hoursAgo(hours: number, base = NOW): Date {
  return new Date(base.getTime() - hours * 3600000);
}

function makeDecision(overrides: Partial<{
  id: string;
  prediction: string;
  falsificationCriterion: string;
  resolveBy: Date;
}> = {}) {
  return {
    id: overrides.id ?? 'decision-uuid-1',
    prediction: overrides.prediction ?? 'I will finish the project by Q2',
    falsificationCriterion: overrides.falsificationCriterion ?? 'Project is not finished by June 30',
    resolveBy: overrides.resolveBy ?? hoursAgo(72),
  };
}

describe('deadline trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockLimit.mockResolvedValue([]);
    mockTransitionDecision.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Constant export ────────────────────────────────────────────────────

  it('exports STALE_CONTEXT_THRESHOLD_MS equal to 172800000 (48h)', () => {
    expect(STALE_CONTEXT_THRESHOLD_MS).toBe(172800000);
    expect(STALE_CONTEXT_THRESHOLD_MS).toBe(48 * 60 * 60 * 1000);
  });

  // ── No due decisions ──────────────────────────────────────────────────

  it('returns triggered=false when no decisions are overdue', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();

    expect(result.triggered).toBe(false);
    expect(result.triggerType).toBe('decision-deadline');
    expect(result.priority).toBe(2);
    expect(result.context).toBe('No due decisions');
  });

  // ── Basic trigger ─────────────────────────────────────────────────────

  it('returns triggered=true with priority=2 and triggerType=decision-deadline when a decision is overdue', async () => {
    const decision = makeDecision({ resolveBy: hoursAgo(72) });
    mockLimit.mockResolvedValueOnce([decision]);

    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    expect(result.triggerType).toBe('decision-deadline');
    expect(result.priority).toBe(2);
  });

  // ── transitionDecision called correctly ───────────────────────────────

  it('calls transitionDecision(id, open, due, { actor: sweep }) on the candidate', async () => {
    const decision = makeDecision({ id: 'dec-abc-123' });
    mockLimit.mockResolvedValueOnce([decision]);

    const trigger = createDeadlineTrigger();
    await trigger.detect();

    expect(mockTransitionDecision).toHaveBeenCalledOnce();
    expect(mockTransitionDecision).toHaveBeenCalledWith(
      'dec-abc-123',
      'open',
      'due',
      { actor: 'sweep' },
    );
  });

  // ── Oldest-due selection ──────────────────────────────────────────────

  it('selects the oldest-due decision when multiple are due (limit=1 from DB)', async () => {
    // The DB query has orderBy(asc(resolveBy)).limit(1), so we only ever get 1 row.
    // Here we confirm that only that one decision is transitioned.
    const oldest = makeDecision({ id: 'oldest-dec', resolveBy: hoursAgo(120) });
    mockLimit.mockResolvedValueOnce([oldest]);

    const trigger = createDeadlineTrigger();
    await trigger.detect();

    expect(mockTransitionDecision).toHaveBeenCalledWith(
      'oldest-dec',
      'open',
      'due',
      { actor: 'sweep' },
    );
  });

  // ── OptimisticConcurrencyError retry ──────────────────────────────────

  it('retries once on OptimisticConcurrencyError and calls transitionDecision on the new candidate', async () => {
    const first = makeDecision({ id: 'first-dec', resolveBy: hoursAgo(72) });
    const second = makeDecision({ id: 'second-dec', resolveBy: hoursAgo(48) });

    // First query returns first, retry query returns second
    mockLimit
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([second]);

    // First transitionDecision fails, second succeeds
    mockTransitionDecision
      .mockRejectedValueOnce(new OptimisticConcurrencyError('first-dec', 'open'))
      .mockResolvedValueOnce(undefined);

    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    expect(mockTransitionDecision).toHaveBeenCalledTimes(2);
    expect(mockTransitionDecision).toHaveBeenNthCalledWith(1, 'first-dec', 'open', 'due', { actor: 'sweep' });
    expect(mockTransitionDecision).toHaveBeenNthCalledWith(2, 'second-dec', 'open', 'due', { actor: 'sweep' });
  });

  it('returns triggered=false when OptimisticConcurrencyError occurs and no candidates remain after retry', async () => {
    const first = makeDecision({ id: 'first-dec' });

    mockLimit
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([]); // retry returns empty

    mockTransitionDecision.mockRejectedValueOnce(
      new OptimisticConcurrencyError('first-dec', 'open'),
    );

    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();

    expect(result.triggered).toBe(false);
    expect(result.context).toBe('No due decisions after retry');
    expect(mockTransitionDecision).toHaveBeenCalledOnce();
  });

  // ── InvalidTransitionError skip ───────────────────────────────────────

  it('returns triggered=false with correct context on InvalidTransitionError', async () => {
    const decision = makeDecision();
    mockLimit.mockResolvedValueOnce([decision]);

    mockTransitionDecision.mockRejectedValueOnce(
      new InvalidTransitionError('open', 'due'),
    );

    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();

    expect(result.triggered).toBe(false);
    expect(result.triggerType).toBe('decision-deadline');
    expect(result.priority).toBe(2);
    expect(result.context).toBe('Decision already transitioned');
  });

  // ── Stale context (>48h) ──────────────────────────────────────────────

  it('uses absolute date framing when staleness > 48h', async () => {
    // 72h past deadline = stale
    const resolveBy = hoursAgo(72);
    const decision = makeDecision({
      resolveBy,
      prediction: 'Ship the feature by Q2',
      falsificationCriterion: 'Feature not shipped by June 30',
    });
    mockLimit.mockResolvedValueOnce([decision]);

    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    // Should contain absolute date (YYYY-MM-DD)
    expect(result.context).toMatch(/^On \d{4}-\d{2}-\d{2} you predicted/);
    expect(result.context).toContain('Ship the feature by Q2');
    expect(result.context).toContain('Feature not shipped by June 30');
    expect(result.context).toMatch(/days past your deadline/);
  });

  // ── Fresh context (<=48h) ─────────────────────────────────────────────

  it('uses implicit framing when staleness <= 48h', async () => {
    // Exactly 24h past deadline — fresh
    const resolveBy = hoursAgo(24);
    const decision = makeDecision({
      resolveBy,
      prediction: 'Launch the campaign tomorrow',
      falsificationCriterion: 'Campaign not launched',
    });
    mockLimit.mockResolvedValueOnce([decision]);

    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();

    expect(result.triggered).toBe(true);
    expect(result.context).toMatch(/^Your deadline just passed/);
    expect(result.context).toContain('Launch the campaign tomorrow');
    expect(result.context).toContain('Campaign not launched');
    // Should NOT contain absolute date framing
    expect(result.context).not.toMatch(/^On \d{4}-\d{2}-\d{2}/);
  });

  // ── Falsification criterion verbatim ──────────────────────────────────

  it('always includes the falsification criterion verbatim in context', async () => {
    const criterion = 'Revenue did not increase by 20% within 6 months';
    const decision = makeDecision({
      falsificationCriterion: criterion,
      resolveBy: hoursAgo(24), // fresh
    });
    mockLimit.mockResolvedValueOnce([decision]);

    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();

    expect(result.context).toContain(criterion);
  });

  // ── Evidence array ────────────────────────────────────────────────────

  it('includes evidence array with decision ID, resolve-by, and staleness', async () => {
    const decision = makeDecision({ id: 'ev-test-uuid', resolveBy: hoursAgo(72) });
    mockLimit.mockResolvedValueOnce([decision]);

    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();

    expect(result.evidence).toBeDefined();
    expect(result.evidence!).toHaveLength(3);
    expect(result.evidence![0]).toContain('ev-test-uuid');
    expect(result.evidence![1]).toContain('Resolve by:');
    expect(result.evidence![2]).toContain('Staleness:');
    expect(result.evidence![2]).toContain('h');
  });
});
