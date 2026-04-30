/**
 * src/rituals/__tests__/skip-tracking.test.ts — Phase 28 Plan 02 Tasks 1 + 2
 *
 * Combined test file for:
 *   - Task 1: Seed skip_threshold audit (RESEARCH Landmine 4 regression detector)
 *   - Task 2: Unit tests for computeSkipCount + shouldFireAdjustmentDialogue +
 *             cadenceDefaultThreshold (Plans 28-02 SKIP-03)
 *
 * Task 1 uses real-DB (reads seeded rows from migrations 0007/0008/0009).
 * Task 2 tests 1-5 use real-DB (insert/query ritualFireEvents rows via fixture).
 * Task 2 tests 6-12 are pure-function (no DB — pass mock ritual objects directly).
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/skip-tracking.test.ts
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';

// ── Mock Anthropic (cumulative not-called assertion: Pitfall 6 / T-28-E1) ───
const { mockAnthropicCreate, mockAnthropicParse } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
}));
vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate, parse: mockAnthropicParse },
  },
  HAIKU_MODEL: 'claude-haiku',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));

// ── Mock bot.api.sendMessage (avoid real Telegram traffic) ───────────────────
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: vi.fn() } },
}));

// ── Mock pensieve/store.js (avoid embeddings + tagger pipeline) ──────────────
vi.mock('../../pensieve/store.js', () => ({
  storePensieveEntry: vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000001' }),
}));
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: vi.fn().mockResolvedValue(null),
}));

import { db } from '../../db/connection.js';
import { rituals, ritualFireEvents } from '../../db/schema.js';
import { RITUAL_OUTCOME } from '../types.js';
import { computeSkipCount, shouldFireAdjustmentDialogue, cadenceDefaultThreshold } from '../skip-tracking.js';
import { seedRitualWithFireEvents } from './fixtures/skip-tracking.js';

// ── Fixture names for Task 2 integration tests ────────────────────────────────
const SKIP_COUNT_FIXTURE = 'skip-tracking-02-count';
const SKIP_COUNT_FIXTURE2 = 'skip-tracking-02-count2';

async function cleanupTask2Fixtures(): Promise<void> {
  await db.delete(ritualFireEvents).where(
    inArray(ritualFireEvents.ritualId,
      (await db.select({ id: rituals.id }).from(rituals).where(
        inArray(rituals.name, [SKIP_COUNT_FIXTURE, SKIP_COUNT_FIXTURE2])
      )).map(r => r.id)
    )
  );
  await db.delete(rituals).where(
    inArray(rituals.name, [SKIP_COUNT_FIXTURE, SKIP_COUNT_FIXTURE2])
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TASK 1: Seed skip_threshold audit (RESEARCH Landmine 4)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per RESEARCH Landmine 4 — verified 2026-04-29 — ALL seed migrations have
 * correct skip_threshold today. This audit is a regression detector: if someone
 * bumps skip_threshold via a future seed without coordinating with Phase 28's
 * predicate logic, this test catches the drift before runtime mis-firing.
 *
 * Seeds audited:
 *   0007_daily_voice_note_seed.sql  → skip_threshold: 3 (daily default = 3)
 *   0008_wellbeing_seed.sql         → skip_threshold: 3 (daily default = 3)
 *   0009_weekly_review_seed.sql     → skip_threshold: 2 (weekly default = 2)
 *
 * NO migration 0010 is shipped from Plan 28-02 — seeds are already correct.
 */
describe('Phase 28 SKIP-03 — Seed skip_threshold audit (RESEARCH Landmine 4)', () => {
  it('daily_voice_note has skip_threshold = 3 (daily cadence default)', async () => {
    const [row] = await db
      .select({
        skipThreshold: drizzleSql<number>`(${rituals.config}->>'skip_threshold')::int`,
      })
      .from(rituals)
      .where(eq(rituals.name, 'daily_voice_note'))
      .limit(1);

    expect(row).toBeDefined();
    expect(row!.skipThreshold).toBe(3);
  });

  it('daily_wellbeing has skip_threshold = 3 (daily cadence default)', async () => {
    const [row] = await db
      .select({
        skipThreshold: drizzleSql<number>`(${rituals.config}->>'skip_threshold')::int`,
      })
      .from(rituals)
      .where(eq(rituals.name, 'daily_wellbeing'))
      .limit(1);

    expect(row).toBeDefined();
    expect(row!.skipThreshold).toBe(3);
  });

  it('weekly_review has skip_threshold = 2 (weekly cadence default)', async () => {
    const [row] = await db
      .select({
        skipThreshold: drizzleSql<number>`(${rituals.config}->>'skip_threshold')::int`,
      })
      .from(rituals)
      .where(eq(rituals.name, 'weekly_review'))
      .limit(1);

    expect(row).toBeDefined();
    expect(row!.skipThreshold).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TASK 2: Unit tests for computeSkipCount + shouldFireAdjustmentDialogue +
//         cadenceDefaultThreshold
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSkipCount', () => {
  beforeEach(async () => {
    await cleanupTask2Fixtures();
  });

  afterAll(async () => {
    await cleanupTask2Fixtures();
  });

  it('Test 1: returns 0 for a fresh ritual with zero ritualFireEvents rows', async () => {
    const { ritualId } = await seedRitualWithFireEvents({
      ritualName: SKIP_COUNT_FIXTURE,
      cadence: 'daily',
      outcomes: [],
    });
    const count = await computeSkipCount(ritualId);
    expect(count).toBe(0);
  });

  it('Test 2: returns 0 when only "fired" events exist (not fired_no_response)', async () => {
    const { ritualId } = await seedRitualWithFireEvents({
      ritualName: SKIP_COUNT_FIXTURE,
      cadence: 'daily',
      outcomes: [
        RITUAL_OUTCOME.FIRED,
        RITUAL_OUTCOME.FIRED,
        RITUAL_OUTCOME.FIRED,
        RITUAL_OUTCOME.FIRED,
        RITUAL_OUTCOME.FIRED,
      ],
    });
    const count = await computeSkipCount(ritualId);
    expect(count).toBe(0);
  });

  it('Test 3: returns 3 when 3 fired_no_response events exist with no resets', async () => {
    const { ritualId } = await seedRitualWithFireEvents({
      ritualName: SKIP_COUNT_FIXTURE,
      cadence: 'daily',
      outcomes: [
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
      ],
    });
    const count = await computeSkipCount(ritualId);
    expect(count).toBe(3);
  });

  it('Test 4: returns 1 after responded resets the count (only post-reset fired_no_response counts)', async () => {
    // Sequence: fired_no_response, fired_no_response, responded, fired_no_response
    // Expected: count since most-recent 'responded' = 1
    const { ritualId } = await seedRitualWithFireEvents({
      ritualName: SKIP_COUNT_FIXTURE,
      cadence: 'daily',
      outcomes: [
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.RESPONDED,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
      ],
    });
    const count = await computeSkipCount(ritualId);
    expect(count).toBe(1);
  });

  it('Test 5: returns 2 after wellbeing_completed resets the count', async () => {
    // Sequence: fired_no_response x2, wellbeing_completed, fired_no_response x2
    // Expected: count since most-recent 'wellbeing_completed' = 2
    const { ritualId } = await seedRitualWithFireEvents({
      ritualName: SKIP_COUNT_FIXTURE2,
      cadence: 'daily',
      outcomes: [
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.WELLBEING_COMPLETED,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
      ],
    });
    const count = await computeSkipCount(ritualId);
    expect(count).toBe(2);
  });
});

describe('shouldFireAdjustmentDialogue', () => {
  // Tests 6-12 are pure-function (no DB required — mock ritual objects).

  // Helper: build a mock ritual object matching rituals.$inferSelect shape.
  function makeMockRitual(overrides: {
    type?: 'daily' | 'weekly' | 'monthly' | 'quarterly';
    skipCount?: number;
    skipThreshold?: number;
    adjustmentMuteUntil?: string | null;
  }): typeof rituals.$inferSelect {
    const type = overrides.type ?? 'daily';
    const skipThreshold = overrides.skipThreshold ?? (type === 'weekly' ? 2 : 3);
    return {
      id: '00000000-0000-4000-8000-000000000099',
      name: `test-${type}`,
      type,
      lastRunAt: null,
      nextRunAt: new Date(),
      enabled: true,
      config: {
        fire_at: '21:00',
        skip_threshold: skipThreshold,
        mute_until: null,
        adjustment_mute_until: overrides.adjustmentMuteUntil ?? null,
        time_zone: 'Europe/Paris',
        prompt_set_version: 'v1',
        schema_version: 1,
      },
      skipCount: overrides.skipCount ?? 0,
      createdAt: new Date(),
    };
  }

  it('Test 6: returns false when daily ritual skip_count (2) is below threshold (3)', async () => {
    const ritual = makeMockRitual({ type: 'daily', skipCount: 2, skipThreshold: 3 });
    const result = await shouldFireAdjustmentDialogue(ritual);
    expect(result).toBe(false);
  });

  it('Test 7: returns true when daily ritual skip_count (3) equals threshold (3)', async () => {
    const ritual = makeMockRitual({ type: 'daily', skipCount: 3, skipThreshold: 3 });
    const result = await shouldFireAdjustmentDialogue(ritual);
    expect(result).toBe(true);
  });

  it('Test 8: returns true when weekly ritual skip_count (2) equals threshold (2)', async () => {
    const ritual = makeMockRitual({ type: 'weekly', skipCount: 2, skipThreshold: 2 });
    const result = await shouldFireAdjustmentDialogue(ritual);
    expect(result).toBe(true);
  });

  it('Test 9: honors per-ritual override — skip_threshold=5; skip_count=4 → false; skip_count=5 → true', async () => {
    const ritualUnder = makeMockRitual({ type: 'daily', skipCount: 4, skipThreshold: 5 });
    const ritualAt = makeMockRitual({ type: 'daily', skipCount: 5, skipThreshold: 5 });

    expect(await shouldFireAdjustmentDialogue(ritualUnder)).toBe(false);
    expect(await shouldFireAdjustmentDialogue(ritualAt)).toBe(true);
  });

  it('Test 10: returns false when adjustment_mute_until is in the future (D-28-08 7-day deferral)', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // +1 day
    const ritual = makeMockRitual({
      type: 'daily',
      skipCount: 5, // over threshold
      skipThreshold: 3,
      adjustmentMuteUntil: futureDate,
    });
    const result = await shouldFireAdjustmentDialogue(ritual);
    expect(result).toBe(false);
  });

  it('Test 11: returns true when adjustment_mute_until is in the past (mute expired)', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // -1 day
    const ritual = makeMockRitual({
      type: 'daily',
      skipCount: 5, // over threshold
      skipThreshold: 3,
      adjustmentMuteUntil: pastDate,
    });
    const result = await shouldFireAdjustmentDialogue(ritual);
    expect(result).toBe(true);
  });

  it('Test 12: cadenceDefaultThreshold returns 3 for daily, 2 for weekly, 2 for monthly, 1 for quarterly', () => {
    expect(cadenceDefaultThreshold('daily')).toBe(3);
    expect(cadenceDefaultThreshold('weekly')).toBe(2);
    expect(cadenceDefaultThreshold('monthly')).toBe(2);
    expect(cadenceDefaultThreshold('quarterly')).toBe(1);
  });
});

// Cumulative afterAll: assert no LLM calls from skip-tracking tests (T-28-E1)
afterAll(() => {
  expect(mockAnthropicCreate).not.toHaveBeenCalled();
  expect(mockAnthropicParse).not.toHaveBeenCalled();
});
