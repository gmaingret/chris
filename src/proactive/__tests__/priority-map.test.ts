/**
 * Regression test — priority map for the five proactive triggers.
 *
 * Phase 15 declared the canonical priority ordering:
 *   silence=1, deadline=2, commitment=3, pattern=4, thread=5
 *
 * This test asserts the priority value returned by each trigger's `detect()`
 * call matches the declared ordering. The ordering matters because:
 *   - `sweep.ts:runReflectiveChannel` sorts fired triggers by priority (ascending)
 *     to pick the single winner.
 *   - Prior to this test, a byte-exact restore of triggers from an older
 *     canonical commit (4c156c3, pre-renumbering) reintroduced a priority
 *     collision between deadline (2) and commitment (2). This regression
 *     slipped past review because no test asserted the whole priority map.
 *
 * If the priority constants drift again, this test must fail loudly.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Mock DB layer so triggers don't touch real DB during construction ─────
// Triggers invoke two chain shapes against the drizzle builder:
//   silence:               .where(c).orderBy(d)                       → await (array)
//   deadline, commitment:  .where(c).orderBy(d).limit(n)              → await (array)
// We build a reusable chain object where every method returns the same
// chainable-thenable — so any terminal await resolves to `[]` regardless of
// how the caller terminates the chain.

const { mockSelect } = vi.hoisted(() => {
  function makeChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn().mockReturnValue(chain);
    chain.where = vi.fn().mockReturnValue(chain);
    chain.orderBy = vi.fn().mockReturnValue(chain);
    chain.limit = vi.fn().mockReturnValue(chain);
    // Thenable so `await chain` resolves to an empty result set.
    chain.then = (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve([]).then(onFulfilled, onRejected);
    return chain;
  }

  return {
    mockSelect: vi.fn().mockImplementation(() => makeChain()),
  };
});

vi.mock('../../db/connection.js', () => ({
  db: {
    select: mockSelect,
  },
}));

// ── Mock transitionDecision so deadline trigger never actually transitions ─

vi.mock('../../decisions/lifecycle.js', () => ({
  transitionDecision: vi.fn().mockResolvedValue(undefined),
}));

// ── Imports AFTER mocks ───────────────────────────────────────────────────

import { createSilenceTrigger } from '../triggers/silence.js';
import { createCommitmentTrigger } from '../triggers/commitment.js';
import { createDeadlineTrigger } from '../triggers/deadline.js';
import { createPatternTrigger } from '../triggers/pattern.js';
import { createThreadTrigger } from '../triggers/thread.js';
import type { OpusAnalysisResult } from '../triggers/opus-analysis.js';

// ── Helpers ───────────────────────────────────────────────────────────────

const emptyAnalysis: OpusAnalysisResult = {
  pattern: { detected: false, description: '', evidence: [], confidence: 0 },
  thread: { detected: false, description: '', evidence: [], confidence: 0 },
};

// ── Tests ─────────────────────────────────────────────────────────────────

describe('priority map (regression)', () => {
  it('silence trigger returns priority=1', async () => {
    const trigger = createSilenceTrigger(12345n, { thresholdMultiplier: 2, baselineDays: 14 });
    const result = await trigger.detect();
    expect(result.priority).toBe(1);
  });

  it('deadline trigger returns priority=2', async () => {
    const trigger = createDeadlineTrigger();
    const result = await trigger.detect();
    expect(result.priority).toBe(2);
  });

  it('commitment trigger returns priority=3', async () => {
    const trigger = createCommitmentTrigger(7);
    const result = await trigger.detect();
    expect(result.priority).toBe(3);
  });

  it('pattern trigger returns priority=4', async () => {
    const trigger = createPatternTrigger(emptyAnalysis);
    const result = await trigger.detect();
    expect(result.priority).toBe(4);
  });

  it('thread trigger returns priority=5', async () => {
    const trigger = createThreadTrigger(emptyAnalysis);
    const result = await trigger.detect();
    expect(result.priority).toBe(5);
  });

  it('priority map is strictly ascending silence < deadline < commitment < pattern < thread', async () => {
    const silence = await createSilenceTrigger(12345n, { thresholdMultiplier: 2, baselineDays: 14 }).detect();
    const deadline = await createDeadlineTrigger().detect();
    const commitment = await createCommitmentTrigger(7).detect();
    const pattern = await createPatternTrigger(emptyAnalysis).detect();
    const thread = await createThreadTrigger(emptyAnalysis).detect();

    const priorities = [silence.priority, deadline.priority, commitment.priority, pattern.priority, thread.priority];

    // Strictly ascending — no collisions, no reordering
    expect(priorities).toEqual([1, 2, 3, 4, 5]);

    // Deadline and commitment must not collide (the regression this test guards)
    expect(deadline.priority).not.toBe(commitment.priority);

    // All five priorities are unique
    expect(new Set(priorities).size).toBe(5);
  });
});
