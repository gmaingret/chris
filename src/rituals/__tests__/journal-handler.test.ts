/**
 * src/rituals/__tests__/journal-handler.test.ts — Phase 26 Plan 02 (renamed Phase 31)
 * (VOICE-02 + VOICE-03 + VOICE-01 atomic-consume race)
 *
 * Real-DB integration test for the fireJournal handler + atomic-consume
 * race semantics of recordJournalResponse. Asserts:
 *
 *   1. fireJournal sends a Telegram message with one of the 6 PROMPTS
 *      and inserts ritual_pending_responses with prompt_text matching the
 *      sent prompt (amended D-26-02 — checker B4 fix).
 *   2. fireJournal pops the next index from rituals.config.prompt_bag and
 *      writes the new bag back; with empty bag, refills via shuffled-bag
 *      rotation.
 *   3. Telegram send failure does NOT leave a stale pending row (rolling-
 *      forward correctness — STEP 2 sends BEFORE STEP 3 inserts).
 *   4. recordJournalResponse atomic-consume race: 2 concurrent calls
 *      against the SAME pending row produce EXACTLY 1 fulfilled +
 *      1 rejected with StorageError('ritual.pp5.race_lost'). Per checker
 *      W6 — concrete Promise.allSettled body, not sketched comments.
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/journal-handler.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

// Mock bot.api.sendMessage to avoid real Telegram calls.
// vi.hoisted ensures the mock fn is available when the vi.mock factory runs.
const { mockSendMessage, mockGetLastUserLanguageFromDb } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockGetLastUserLanguageFromDb: vi.fn(),
}));
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));

// Phase 46 L10N-04: fireJournal now calls getLastUserLanguageFromDb to pick
// a locale-appropriate prompt. Mock the language module's cron-context API
// so tests can pin the detected locale without seeding the conversations
// table. Default mock returns null → fireJournal falls back to 'French'
// (Greg's primary locale).
vi.mock('../../chris/language.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../chris/language.js')>();
  return {
    ...actual,
    getLastUserLanguageFromDb: mockGetLastUserLanguageFromDb,
  };
});

import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualResponses,
  ritualFireEvents,
  pensieveEntries,
} from '../../db/schema.js';
import {
  fireJournal,
  recordJournalResponse,
  PROMPTS,
} from '../journal.js';
import { parseRitualConfig } from '../types.js';

const FIXTURE_RITUAL_NAME = 'journal-handler-test-ritual';

async function cleanup(): Promise<void> {
  // Ordered cleanup: child tables first (FK constraints), then rituals fixture.
  // Phase 28 Plan 28-01 extended recordJournalResponse to write ritual_fire_events
  // — add it to cleanup before rituals deletion to satisfy FK constraint.
  await db.delete(ritualResponses);
  await db.delete(ritualFireEvents);
  await db.delete(ritualPendingResponses);
  await db.delete(pensieveEntries);
  await db.delete(rituals).where(eq(rituals.name, FIXTURE_RITUAL_NAME));
}

describe('fireJournal handler (Phase 26 VOICE-02 + VOICE-03)', () => {
  beforeEach(async () => {
    await cleanup();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ message_id: 12345 });
    // Default: no language detected → fireJournal falls back to French
    // (Greg's primary locale). Tests that need a specific locale override
    // this mock in-test before calling fireJournal.
    mockGetLastUserLanguageFromDb.mockReset();
    mockGetLastUserLanguageFromDb.mockResolvedValue(null);
  });

  afterAll(async () => {
    await cleanup();
    // NOTE: do NOT call sql.end() here — pool must stay alive for the
    // sibling concurrency-race describe below. File-level pool close happens
    // in the last describe's afterAll.
  });

  it('sends Telegram message with one of 6 spec prompts (default-French locale) + inserts pending row WITH prompt_text + updates prompt_bag', async () => {
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: {
          fire_at: '21:00',
          prompt_bag: [3, 1, 4],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();
    const cfg = parseRitualConfig(ritual!.config);

    const outcome = await fireJournal(ritual!, cfg);

    expect(outcome).toBe('fired');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const sentPrompt = mockSendMessage.mock.calls[0]![1] as string;
    // Phase 46 L10N-04: PROMPTS is now Record<Lang, readonly string[]>.
    // Default locale (no conversation history) is French. Assert the sent
    // prompt is in the French array — also assert it is NOT in the English
    // array to prove the locale-aware wiring is live.
    expect(PROMPTS.French).toContain(sentPrompt);
    expect(PROMPTS.English).not.toContain(sentPrompt);
    // Pending row with prompt_text (amended D-26-02 — checker B4) — text
    // stored verbatim from the locale-resolved send (longitudinal trail).
    const pending = await db.select().from(ritualPendingResponses);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.ritualId).toBe(ritual!.id);
    expect(pending[0]!.promptText).toBe(sentPrompt);
    expect(pending[0]!.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 17 * 3600 * 1000,
    );
    expect(pending[0]!.expiresAt.getTime()).toBeLessThan(
      Date.now() + 19 * 3600 * 1000,
    );
    // prompt_bag updated (popped index 3, new bag = [1, 4])
    const [updated] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.id, ritual!.id));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((updated!.config as any).prompt_bag).toEqual([1, 4]);
  });

  it('with empty prompt_bag, refills via shuffled-bag rotation and pops first', async () => {
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
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
    const cfg = parseRitualConfig(ritual!.config);

    const outcome = await fireJournal(ritual!, cfg);

    expect(outcome).toBe('fired');
    const [updated] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.id, ritual!.id));
    // After refill (6 indices) + popping 1 = 5 remaining in the bag.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((updated!.config as any).prompt_bag).toHaveLength(5);
  });

  it('Telegram send failure → no pending row inserted (no stale binding)', async () => {
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: {
          fire_at: '21:00',
          prompt_bag: [0],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();
    const cfg = parseRitualConfig(ritual!.config);
    mockSendMessage.mockReset();
    mockSendMessage.mockRejectedValueOnce(new Error('Telegram unreachable'));

    await expect(fireJournal(ritual!, cfg)).rejects.toThrow(
      'Telegram unreachable',
    );
    const pending = await db.select().from(ritualPendingResponses);
    expect(pending).toHaveLength(0);
  });

  // ── Phase 46 L10N-04 — locale-aware prompt selection ─────────────────────

  it('L10N-04 (FR detected): sends a French prompt when getLastUserLanguageFromDb returns French', async () => {
    mockGetLastUserLanguageFromDb.mockResolvedValueOnce('French');
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: {
          fire_at: '21:00',
          prompt_bag: [0],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();
    const cfg = parseRitualConfig(ritual!.config);
    await fireJournal(ritual!, cfg);
    const sentPrompt = mockSendMessage.mock.calls[0]![1] as string;
    expect(PROMPTS.French).toContain(sentPrompt);
    expect(sentPrompt).toBe("Qu'est-ce qui a compté aujourd'hui ?"); // prompt_bag[0]=0
  });

  it('L10N-04 (RU detected): sends a Russian prompt when getLastUserLanguageFromDb returns Russian', async () => {
    mockGetLastUserLanguageFromDb.mockResolvedValueOnce('Russian');
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: {
          fire_at: '21:00',
          prompt_bag: [0],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();
    const cfg = parseRitualConfig(ritual!.config);
    await fireJournal(ritual!, cfg);
    const sentPrompt = mockSendMessage.mock.calls[0]![1] as string;
    expect(PROMPTS.Russian).toContain(sentPrompt);
    expect(sentPrompt).toBe('Что было важным сегодня?'); // prompt_bag[0]=0
  });

  it('L10N-04 (EN detected): sends an English prompt when getLastUserLanguageFromDb returns English', async () => {
    mockGetLastUserLanguageFromDb.mockResolvedValueOnce('English');
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: {
          fire_at: '21:00',
          prompt_bag: [0],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();
    const cfg = parseRitualConfig(ritual!.config);
    await fireJournal(ritual!, cfg);
    const sentPrompt = mockSendMessage.mock.calls[0]![1] as string;
    expect(PROMPTS.English).toContain(sentPrompt);
    expect(sentPrompt).toBe('What mattered today?'); // prompt_bag[0]=0
  });

  it('L10N-04 (null fallback): defaults to French when conversations table has no USER message', async () => {
    // mockGetLastUserLanguageFromDb default is mockResolvedValue(null) per
    // beforeEach. fireJournal calls `langOf(detectedLang ?? 'French')` →
    // resolved lang = 'French'. The first test above already covers this
    // happy path implicitly via PROMPTS.French; this test pins the
    // CONTRACT explicitly so a future regression that flips the fallback
    // to 'English' surfaces as a named failure.
    mockGetLastUserLanguageFromDb.mockResolvedValueOnce(null);
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
        enabled: true,
        config: {
          fire_at: '21:00',
          prompt_bag: [0],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();
    const cfg = parseRitualConfig(ritual!.config);
    await fireJournal(ritual!, cfg);
    const sentPrompt = mockSendMessage.mock.calls[0]![1] as string;
    expect(PROMPTS.French).toContain(sentPrompt);
    expect(sentPrompt).toBe("Qu'est-ce qui a compté aujourd'hui ?"); // FR prompt_bag[0]=0
  });
});

describe('recordJournalResponse atomic consume race (Phase 26 VOICE-01)', () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  it('2 concurrent recordJournalResponse calls on same pending → exactly 1 fulfilled, 1 rejected with ritual.pp5.race_lost (checker W6)', async () => {
    // Seed ritual + pending row.
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: FIXTURE_RITUAL_NAME,
        type: 'daily',
        nextRunAt: new Date(),
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
    const chatId = BigInt(123456);
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual!.id,
        chatId,
        firedAt: new Date(),
        expiresAt: new Date(Date.now() + 18 * 3600 * 1000),
        promptText: 'What mattered today?',
      })
      .returning();

    // Concrete Promise.allSettled body (per checker W6).
    const settled = await Promise.allSettled([
      recordJournalResponse(pending!, chatId, 'reply 1'),
      recordJournalResponse(pending!, chatId, 'reply 2'),
    ]);

    // Exactly 1 fulfilled, 1 rejected.
    const fulfilled = settled.filter((r) => r.status === 'fulfilled');
    const rejected = settled.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The rejection is StorageError('ritual.pp5.race_lost').
    const rej = rejected[0] as PromiseRejectedResult;
    expect(rej.reason).toBeInstanceOf(Error);
    expect((rej.reason as Error).message).toBe('ritual.pp5.race_lost');

    // Exactly 1 Pensieve entry (the winner's deposit).
    const entries = await db.select().from(pensieveEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.epistemicTag).toBe('RITUAL_RESPONSE');

    // Pending row consumed (consumedAt set).
    const [consumed] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.id, pending!.id));
    expect(consumed!.consumedAt).not.toBeNull();

    // Exactly 1 ritual_responses row with prompt_text from the consumed pending.
    const respRows = await db.select().from(ritualResponses);
    expect(respRows).toHaveLength(1);
    expect(respRows[0]!.promptText).toBe('What mattered today?');
  });
});
