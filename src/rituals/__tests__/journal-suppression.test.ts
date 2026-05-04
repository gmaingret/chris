/**
 * src/rituals/__tests__/voice-note-suppression.test.ts — Phase 26 Plan 03
 * (VOICE-04 — pre-fire suppression on heavy-deposit days; D-26-04 + D-26-05 + D-26-06)
 *
 * Real-DB integration test for the pre-fire suppression layer added in Plan
 * 26-03. Asserts both helper-direct semantics (shouldSuppressVoiceNoteFire)
 * and runRitualSweep integration (full fire-vs-suppress branching at 21:00
 * Paris).
 *
 * Coverage:
 *
 *   shouldSuppressVoiceNoteFire helper (D-26-05 query mechanism):
 *     1. ≥5 telegram JOURNAL Pensieve entries today  → returns true
 *     2. <5 telegram JOURNAL Pensieve entries today  → returns false
 *     3. Yesterday's entries don't count (dayBoundaryUtc respects local Paris day)
 *     4. Non-telegram source entries don't count
 *     5. Non-JOURNAL mode entries don't count
 *
 *   runRitualSweep integration (D-26-06 outcome semantics):
 *     6. ≥5 entries today → outcome='system_suppressed', no Telegram send,
 *        no pending row inserted, next_run_at advanced to tomorrow,
 *        skip_count NOT incremented
 *     7. <5 entries today → outcome='fired' (normal fire path), Telegram sent,
 *        pending row inserted
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/voice-note-suppression.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

// Mock bot.api.sendMessage to avoid real Telegram calls.
// vi.hoisted ensures the mock fn is available when the vi.mock factory runs
// (factories hoist above all imports — matches voice-note-handler.test.ts).
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));

import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualResponses,
  pensieveEntries,
  proactiveState,
} from '../../db/schema.js';
import { runRitualSweep } from '../scheduler.js';
import {
  shouldSuppressVoiceNoteFire,
  RITUAL_SUPPRESS_DEPOSIT_THRESHOLD,
} from '../voice-note.js';

const COUNTER_KEY = 'ritual_daily_count';
const RITUAL_NAME = 'daily_voice_note';

async function cleanup(): Promise<void> {
  // Ordered cleanup: child tables first (FK constraints), then state + rituals
  // + pensieve. proactive_state daily-counter reset so hasReachedRitualDailyCap
  // returns false at every test entry.
  await db.delete(ritualResponses);
  await db.delete(ritualPendingResponses);
  await db.delete(rituals);
  await db.delete(pensieveEntries);
  await db.delete(proactiveState).where(eq(proactiveState.key, COUNTER_KEY));
}

async function seedRitual(): Promise<typeof rituals.$inferSelect> {
  const [row] = await db
    .insert(rituals)
    .values({
      name: RITUAL_NAME,
      type: 'daily',
      // due now — runRitualSweep will pick it up
      nextRunAt: new Date(Date.now() - 60 * 1000),
      enabled: true,
      config: {
        fire_at: '21:00',
        prompt_bag: [],
        skip_threshold: 3,
        mute_until: null,
        time_zone: 'Europe/Paris',
        prompt_set_version: 'v1',
        schema_version: 1,
      },
    })
    .returning();
  return row!;
}

async function seedJournalEntry(
  date: Date,
): Promise<typeof pensieveEntries.$inferSelect> {
  const [row] = await db
    .insert(pensieveEntries)
    .values({
      content: 'journal entry',
      source: 'telegram',
      metadata: { mode: 'JOURNAL' },
      createdAt: date,
    })
    .returning();
  return row!;
}

describe('shouldSuppressVoiceNoteFire helper (Phase 26 VOICE-04 — D-26-05)', () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    // NOTE: do NOT call sql.end() here — pool must stay alive for the sibling
    // sweep-integration describe below. File-level pool close happens in the
    // last describe's afterAll (matches voice-note-handler.test.ts pattern).
  });

  it('returns true when >=5 telegram JOURNAL entries exist today', async () => {
    const now = new Date();
    for (let i = 0; i < RITUAL_SUPPRESS_DEPOSIT_THRESHOLD; i++) {
      await seedJournalEntry(now);
    }
    expect(await shouldSuppressVoiceNoteFire(now)).toBe(true);
  });

  it('returns false when <5 telegram JOURNAL entries today', async () => {
    const now = new Date();
    for (let i = 0; i < RITUAL_SUPPRESS_DEPOSIT_THRESHOLD - 1; i++) {
      await seedJournalEntry(now);
    }
    expect(await shouldSuppressVoiceNoteFire(now)).toBe(false);
  });

  it('does NOT count entries from yesterday (dayBoundaryUtc respects local Paris day)', async () => {
    const now = new Date();
    // 25 hours ago — guaranteed to land in the prior local-Paris day even
    // across DST (24h margin would risk fall-back-day false-positives).
    const yesterday = new Date(now.getTime() - 25 * 3600 * 1000);
    for (let i = 0; i < 10; i++) {
      await seedJournalEntry(yesterday);
    }
    expect(await shouldSuppressVoiceNoteFire(now)).toBe(false);
  });

  it('does NOT count non-telegram source entries (e.g., gmail)', async () => {
    const now = new Date();
    for (let i = 0; i < 10; i++) {
      await db.insert(pensieveEntries).values({
        content: 'gmail entry',
        source: 'gmail',
        metadata: { mode: 'JOURNAL' },
        createdAt: now,
      });
    }
    expect(await shouldSuppressVoiceNoteFire(now)).toBe(false);
  });

  it('does NOT count entries without metadata.mode = JOURNAL (e.g., REFLECT)', async () => {
    const now = new Date();
    for (let i = 0; i < 10; i++) {
      await db.insert(pensieveEntries).values({
        content: 'reflect entry',
        source: 'telegram',
        metadata: { mode: 'REFLECT' },
        createdAt: now,
      });
    }
    expect(await shouldSuppressVoiceNoteFire(now)).toBe(false);
  });
});

describe('runRitualSweep + daily_voice_note suppression integration (Phase 26 VOICE-04 — D-26-04 + D-26-06)', () => {
  beforeEach(async () => {
    await cleanup();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ message_id: 12345 });
  });

  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  it('skips fire when >=5 JOURNAL entries today (system_suppressed outcome, no skip_count touch — D-26-06)', async () => {
    const ritual = await seedRitual();
    const now = new Date();
    for (let i = 0; i < RITUAL_SUPPRESS_DEPOSIT_THRESHOLD; i++) {
      await seedJournalEntry(now);
    }

    const results = await runRitualSweep();

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('system_suppressed');
    expect(results[0]!.fired).toBe(false);
    // No Telegram send — handler short-circuited BEFORE bot.api.sendMessage.
    expect(mockSendMessage).not.toHaveBeenCalled();

    // No pending row inserted (suppression branch returns BEFORE step 3).
    const pending = await db.select().from(ritualPendingResponses);
    expect(pending).toHaveLength(0);

    // next_run_at advanced to tomorrow's 21:00 Paris (>12h in the future).
    // Note: scheduler's STEP 5 atomic UPDATE already advanced it once via
    // computeNextRunAt; the suppression branch re-advances inside the handler
    // — both calls land on the same target instant for the daily cadence,
    // so the assertion holds.
    const [updatedRitual] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.id, ritual.id));
    expect(updatedRitual!.nextRunAt.getTime()).toBeGreaterThan(
      Date.now() + 12 * 3600 * 1000,
    );

    // skip_count NOT incremented (D-26-06 — Phase 28 owns skip_count).
    expect(updatedRitual!.skipCount).toBe(0);
  });

  it('fires normally when <5 JOURNAL entries today (suppression false → fired)', async () => {
    await seedRitual();
    const now = new Date();
    for (let i = 0; i < RITUAL_SUPPRESS_DEPOSIT_THRESHOLD - 1; i++) {
      await seedJournalEntry(now);
    }

    const results = await runRitualSweep();

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('fired');
    expect(results[0]!.fired).toBe(true);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);

    const pending = await db.select().from(ritualPendingResponses);
    expect(pending).toHaveLength(1);
  });
});
