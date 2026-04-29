/**
 * src/rituals/__tests__/skip-tracking.integration.test.ts — Phase 28 Plan 01 Task 6
 *
 * Real-DB integration tests covering SKIP-01 (discriminated outcome union;
 * only fired_no_response increments skip_count) and SKIP-02 (append-only
 * ritual_fire_events; rituals.skip_count rebuildable by replay from the most
 * recent reset event).
 *
 * 8 behaviors covered:
 *
 *   1. voice-note fire emit: exactly one ritualFireEvents row with
 *      outcome='fired' exists for the test ritual after fireVoiceNote.
 *   2. voice-note suppression emit: shouldSuppressVoiceNoteFire stub returns
 *      true; calling fireVoiceNote emits outcome='system_suppressed' and does
 *      NOT increment skip_count.
 *   3. voice-note response resets: After recordRitualVoiceResponse (mocked
 *      storePensieveEntry), one outcome='responded' row exists AND
 *      rituals.skip_count is 0 even after pre-seeding skip_count=5.
 *   4. wellbeing skip preserves count: pre-seed skip_count=2; trigger
 *      handleSkip; outcome='wellbeing_skipped' written; skip_count UNCHANGED at 2.
 *   5. wellbeing complete resets count: pre-seed skip_count=3; trigger 3-tap
 *      completion; outcome='wellbeing_completed' written; skip_count=0.
 *   6. ritualResponseWindowSweep emits paired window_missed + fired_no_response:
 *      insert one expired pending row; call helper; assert 2 ritualFireEvents
 *      rows + skip_count=1.
 *   7. ritualResponseWindowSweep idempotent: second call with same consumed row
 *      emits 0; skip_count stays 1.
 *   8. replay invariant (SKIP-02): seed [fired_no_response x3, responded,
 *      fired_no_response x2]; count since most-recent reset = 2.
 *
 * Cumulative afterAll assertion: mockAnthropicCreate.not.toHaveBeenCalled()
 * proves Plan 28-01 changes do NOT introduce LLM calls into the skip-tracking
 * substrate (Pitfall 6 carry-over invariant — T-28-E1 mitigant).
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/rituals/__tests__/skip-tracking.integration.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { and, desc, eq, inArray } from 'drizzle-orm';

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
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));
vi.mock('../../bot/bot.js', () => ({
  bot: { api: { sendMessage: mockSendMessage } },
}));

// ── Mock pensieve/store.js (avoid embeddings + tagger pipeline) ──────────────
// Use a valid UUID literal directly in the factory — vi.mock factories are
// hoisted above module imports and top-level consts, so external consts are
// not yet in scope inside the factory body.
// MOCK_PENSIEVE_UUID is declared below for use in assertions.
vi.mock('../../pensieve/store.js', () => ({
  // Valid UUID format required — ritual_responses.pensieve_entry_id is uuid column.
  storePensieveEntry: vi.fn().mockResolvedValue({ id: '00000000-0000-4000-8000-000000000001' }),
}));
const MOCK_PENSIEVE_UUID = '00000000-0000-4000-8000-000000000001';

// ── Mock fire-and-forget pipeline (prevent pre-existing EACCES hang) ─────────
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: vi.fn().mockResolvedValue(null),
}));

import { db, sql } from '../../db/connection.js';
import {
  pensieveEntries,
  rituals,
  ritualFireEvents,
  ritualPendingResponses,
  ritualResponses,
  wellbeingSnapshots,
} from '../../db/schema.js';
import { RITUAL_OUTCOME, parseRitualConfig } from '../types.js';
import { fireVoiceNote, recordRitualVoiceResponse } from '../voice-note.js';
import { fireWellbeing, handleWellbeingCallback } from '../wellbeing.js';
import { ritualResponseWindowSweep } from '../scheduler.js';
import { seedRitualWithFireEvents } from './fixtures/skip-tracking.js';

// ── Fixture names (unique per handler to avoid inter-test FK collisions) ──────
const VOICE_NOTE_FIXTURE = 'skip-tracking-test-voice-note';
// wellbeing.ts findOpenWellbeingRow() hard-codes ritual name 'daily_wellbeing',
// so wellbeing tests must use the seeded production name.
const WELLBEING_FIXTURE = 'daily_wellbeing';
const SWEEP_FIXTURE = 'skip-tracking-test-sweep';
const REPLAY_FIXTURE = 'skip-tracking-test-replay';

// ── Helper: cleanup all ephemeral rows in FK order ────────────────────────────
// The 'daily_wellbeing' seeded ritual row is left intact (migrations seed it);
// only its child rows (fire events, responses, snapshots, pending) are cleaned.
// Other fixture rituals are fully deleted.
async function cleanupAll(): Promise<void> {
  await db.delete(wellbeingSnapshots);
  await db.delete(ritualFireEvents);
  await db.delete(ritualResponses);
  await db.delete(ritualPendingResponses);
  // Delete test-inserted pensieve entries (Test 2 + Test 3).
  await db.delete(pensieveEntries);
  // Delete only the ephemeral test-created ritual rows (not the seeded ones).
  await db
    .delete(rituals)
    .where(
      inArray(rituals.name, [
        VOICE_NOTE_FIXTURE,
        SWEEP_FIXTURE,
        REPLAY_FIXTURE,
      ]),
    );
}

// ── Mock context builder for wellbeing callbacks ──────────────────────────────
interface MockCtx {
  callbackQuery?: { data: string; message?: { message_id: number } };
  answerCallbackQuery: ReturnType<typeof vi.fn>;
  editMessageReplyMarkup: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
}

function buildMockCtx(callbackData?: string, messageId = 12345): MockCtx {
  return {
    callbackQuery: callbackData
      ? { data: callbackData, message: { message_id: messageId } }
      : undefined,
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    editMessageText: vi.fn().mockResolvedValue(true),
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Phase 28 Plan 01 — skip-tracking substrate (SKIP-01 + SKIP-02)', () => {
  beforeEach(async () => {
    await cleanupAll();
    mockSendMessage.mockReset();
    mockSendMessage.mockResolvedValue({ message_id: 12345 });
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
  });

  afterEach(async () => {
    await cleanupAll();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    // Cumulative Pitfall 6 / T-28-E1 invariant: no LLM calls leaked.
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    await cleanupAll();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  // ── Test 1 — voice-note fire emit ────────────────────────────────────────────
  it('Test 1: fireVoiceNote emits exactly one fired event for the ritual', async () => {
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: VOICE_NOTE_FIXTURE,
        type: 'daily',
        nextRunAt: new Date(Date.now() + 86_400_000),
        enabled: true,
        config: {
          fire_at: '21:00',
          prompt_bag: [0, 1, 2],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();

    const cfg = parseRitualConfig(ritual!.config);
    const outcome = await fireVoiceNote(ritual!, cfg);

    expect(outcome).toBe('fired');

    const events = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, ritual!.id));

    // Exactly 1 row with outcome='fired'.
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome).toBe(RITUAL_OUTCOME.FIRED);
    // metadata contains promptIdx + prompt.
    expect(events[0]!.metadata).toMatchObject({ promptIdx: expect.any(Number), prompt: expect.any(String) });

    // skip_count NOT incremented ('fired' is not a skip event per SKIP-01).
    const [updated] = await db.select().from(rituals).where(eq(rituals.id, ritual!.id));
    expect(updated!.skipCount).toBe(0);
  });

  // ── Test 2 — voice-note suppression emit ─────────────────────────────────────
  it('Test 2: fireVoiceNote under suppression emits system_suppressed; skip_count not incremented', async () => {
    const [ritual] = await db
      .insert(rituals)
      .values({
        name: VOICE_NOTE_FIXTURE,
        type: 'daily',
        nextRunAt: new Date(Date.now() + 86_400_000),
        enabled: true,
        skipCount: 0,
        config: {
          fire_at: '21:00',
          prompt_bag: [0, 1, 2],
          skip_threshold: 3,
          mute_until: null,
          time_zone: 'Europe/Paris',
          prompt_set_version: 'v1',
          schema_version: 1,
        },
      })
      .returning();

    // Seed 5+ JOURNAL pensieve entries to trigger suppression.
    // shouldSuppressVoiceNoteFire counts telegram-source JOURNAL entries for today.
    // We insert directly into the real DB table (imported at top of file)
    // bypassing the mocked storePensieveEntry, which wouldn't write to the DB.
    for (let i = 0; i < 5; i++) {
      await db.insert(pensieveEntries).values({
        source: 'telegram',
        content: `journal entry ${i}`,
        metadata: { mode: 'JOURNAL' },
        epistemicTag: null,
      });
    }

    const cfg = parseRitualConfig(ritual!.config);
    const outcome = await fireVoiceNote(ritual!, cfg);

    expect(outcome).toBe('system_suppressed');

    // Exactly 1 event with outcome='system_suppressed'.
    const events = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, ritual!.id));
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome).toBe(RITUAL_OUTCOME.SYSTEM_SUPPRESSED);
    expect(events[0]!.metadata).toMatchObject({
      reason: 'heavy_deposit_day',
      deposit_threshold: 5,
    });

    // skip_count NOT incremented (system_suppressed is neutral per SKIP-01).
    const [updated] = await db.select().from(rituals).where(eq(rituals.id, ritual!.id));
    expect(updated!.skipCount).toBe(0);

    // Clean up extra pensieve entries.
    await db.delete(pensieveEntries);
  });

  // ── Test 3 — voice-note response resets skip_count ───────────────────────────
  it('Test 3: recordRitualVoiceResponse emits responded event and resets skip_count to 0', async () => {
    // Pre-seed ritual with skip_count=5 to prove the reset works regardless.
    const { ritualId } = await seedRitualWithFireEvents({
      ritualName: VOICE_NOTE_FIXTURE,
      cadence: 'daily',
      outcomes: [],
    });

    // Manually set skip_count=5 to test the reset.
    await db.update(rituals).set({ skipCount: 5 }).where(eq(rituals.id, ritualId));

    // Pre-insert the pensieve entry that the mocked storePensieveEntry will return.
    // ritual_responses.pensieve_entry_id is a UUID FK to pensieve_entries, so the
    // UUID must exist before the ritual_responses INSERT runs.
    await db.insert(pensieveEntries).values({
      id: MOCK_PENSIEVE_UUID,
      source: 'telegram',
      content: 'My voice note response text',
      epistemicTag: 'RITUAL_RESPONSE',
      metadata: { source_subtype: 'ritual_voice_note', ritual_id: ritualId },
    });

    // Insert an open pending row to simulate a prior fire.
    const firedAt = new Date(Date.now() - 3600_000); // 1h ago
    const expiresAt = new Date(Date.now() + 3600_000); // 1h from now (still open)
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId,
        chatId: BigInt(12345678),
        firedAt,
        expiresAt,
        promptText: 'What mattered today?',
      })
      .returning();

    const result = await recordRitualVoiceResponse(
      pending!,
      BigInt(12345678),
      'My voice note response text',
    );

    expect(result.pensieveEntryId).toBe(MOCK_PENSIEVE_UUID);

    // 1 ritual_fire_events row with outcome='responded'.
    const events = await db
      .select()
      .from(ritualFireEvents)
      .where(
        and(
          eq(ritualFireEvents.ritualId, ritualId),
          eq(ritualFireEvents.outcome, RITUAL_OUTCOME.RESPONDED),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toMatchObject({
      pendingResponseId: pending!.id,
      pensieveEntryId: MOCK_PENSIEVE_UUID,
    });

    // skip_count reset to 0 (responded is a reset event per SKIP-01 / D-28-03).
    const [updated] = await db.select().from(rituals).where(eq(rituals.id, ritualId));
    expect(updated!.skipCount).toBe(0);
  });

  // ── Test 4 — wellbeing skip preserves skip_count ─────────────────────────────
  it('Test 4: wellbeing handleSkip emits wellbeing_skipped; skip_count UNCHANGED', async () => {
    // Use the seeded 'daily_wellbeing' ritual (findOpenWellbeingRow hardcodes this name).
    const [ritual] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.name, WELLBEING_FIXTURE))
      .limit(1);
    expect(ritual).toBeDefined();
    const ritualId = ritual!.id;

    // Pre-set skip_count=2 to verify it's not changed by skip.
    await db.update(rituals).set({ skipCount: 2 }).where(eq(rituals.id, ritualId));

    const cfg = parseRitualConfig(ritual!.config);

    // Fire wellbeing to create the open response row (required for handleSkip).
    await fireWellbeing(ritual!, cfg);
    // Clear the 'fired' event so Test 4 only asserts on the skip event.
    await db
      .delete(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, ritualId));

    // Trigger skip callback.
    const skipCtx = buildMockCtx('r:w:skip');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(skipCtx as any, 'r:w:skip');

    // 1 ritual_fire_events row with outcome='wellbeing_skipped'.
    const events = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, ritualId));
    expect(events).toHaveLength(1);
    expect(events[0]!.outcome).toBe(RITUAL_OUTCOME.WELLBEING_SKIPPED);

    // skip_count UNCHANGED at 2 (wellbeing_skipped is neither reset nor increment
    // per SKIP-01 / D-28-02).
    const [updated] = await db.select().from(rituals).where(eq(rituals.id, ritualId));
    expect(updated!.skipCount).toBe(2);
  });

  // ── Test 5 — wellbeing complete resets skip_count ────────────────────────────
  it('Test 5: wellbeing 3-tap completion emits wellbeing_completed; skip_count reset to 0', async () => {
    // Use the seeded 'daily_wellbeing' ritual (findOpenWellbeingRow hardcodes this name).
    const [ritual] = await db
      .select()
      .from(rituals)
      .where(eq(rituals.name, WELLBEING_FIXTURE))
      .limit(1);
    expect(ritual).toBeDefined();
    const ritualId = ritual!.id;

    // Pre-set skip_count=3 to verify reset.
    await db.update(rituals).set({ skipCount: 3 }).where(eq(rituals.id, ritualId));

    const cfg = parseRitualConfig(ritual!.config);

    // Fire wellbeing (inserts open response row + emits 'fired' event).
    await fireWellbeing(ritual!, cfg);

    // 3 taps to complete.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(buildMockCtx('r:w:e:3') as any, 'r:w:e:3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(buildMockCtx('r:w:m:4') as any, 'r:w:m:4');
    const completionCtx = buildMockCtx('r:w:a:2');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handleWellbeingCallback(completionCtx as any, 'r:w:a:2');

    // 'wellbeing_completed' event exists.
    const events = await db
      .select()
      .from(ritualFireEvents)
      .where(
        and(
          eq(ritualFireEvents.ritualId, ritualId),
          eq(ritualFireEvents.outcome, RITUAL_OUTCOME.WELLBEING_COMPLETED),
        ),
      );
    expect(events).toHaveLength(1);

    // skip_count reset to 0 (wellbeing_completed is a reset event per D-28-03).
    const [updated] = await db.select().from(rituals).where(eq(rituals.id, ritualId));
    expect(updated!.skipCount).toBe(0);
  });

  // ── Test 6 — ritualResponseWindowSweep paired emit ───────────────────────────
  it('Test 6: ritualResponseWindowSweep emits window_missed + fired_no_response; skip_count incremented to 1', async () => {
    const { ritualId } = await seedRitualWithFireEvents({
      ritualName: SWEEP_FIXTURE,
      cadence: 'daily',
      outcomes: [],
    });
    await db.update(rituals).set({ skipCount: 0 }).where(eq(rituals.id, ritualId));

    // Insert one expired pending row (expiresAt in the past, consumedAt IS NULL).
    const now = new Date();
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId,
        chatId: BigInt(12345678),
        firedAt: new Date(now.getTime() - 7200_000), // 2h ago
        expiresAt: new Date(now.getTime() - 60_000), // 1 min ago (expired)
        promptText: 'What mattered today?',
      })
      .returning();

    const count = await ritualResponseWindowSweep(now);

    expect(count).toBe(1);

    // 2 ritualFireEvents rows for this ritual — window_missed + fired_no_response.
    const events = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, ritualId));
    expect(events).toHaveLength(2);
    const outcomes = events.map((e) => e.outcome).sort();
    expect(outcomes).toEqual(
      [RITUAL_OUTCOME.FIRED_NO_RESPONSE, RITUAL_OUTCOME.WINDOW_MISSED].sort(),
    );

    // metadata references the pending row ID.
    for (const event of events) {
      expect(event.metadata).toMatchObject({ pendingResponseId: pending!.id });
    }

    // skip_count incremented by 1 (fired_no_response is THE skip-counting event).
    const [updated] = await db.select().from(rituals).where(eq(rituals.id, ritualId));
    expect(updated!.skipCount).toBe(1);

    // The pending row is consumed (consumed_at NOT NULL).
    const [consumedRow] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.id, pending!.id));
    expect(consumedRow!.consumedAt).not.toBeNull();
  });

  // ── Test 7 — ritualResponseWindowSweep idempotency ───────────────────────────
  it('Test 7: second ritualResponseWindowSweep call emits 0 (already consumed); skip_count stays 1', async () => {
    const { ritualId } = await seedRitualWithFireEvents({
      ritualName: SWEEP_FIXTURE,
      cadence: 'daily',
      outcomes: [],
    });
    await db.update(rituals).set({ skipCount: 0 }).where(eq(rituals.id, ritualId));

    const now = new Date();
    await db.insert(ritualPendingResponses).values({
      ritualId,
      chatId: BigInt(12345678),
      firedAt: new Date(now.getTime() - 7200_000),
      expiresAt: new Date(now.getTime() - 60_000),
      promptText: 'What mattered today?',
    });

    // First sweep — processes the expired row.
    const count1 = await ritualResponseWindowSweep(now);
    expect(count1).toBe(1);

    const [afterFirst] = await db.select().from(rituals).where(eq(rituals.id, ritualId));
    expect(afterFirst!.skipCount).toBe(1);

    // Second sweep — same row, already consumed; SELECT returns 0 rows.
    const count2 = await ritualResponseWindowSweep(now);
    expect(count2).toBe(0);

    // skip_count still 1 (no double-increment).
    const [afterSecond] = await db.select().from(rituals).where(eq(rituals.id, ritualId));
    expect(afterSecond!.skipCount).toBe(1);

    // Events still exactly 2 (no duplicates emitted).
    const events = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, ritualId));
    expect(events).toHaveLength(2);
  });

  // ── Test 8 — replay invariant (SKIP-02) ──────────────────────────────────────
  it('Test 8: replay invariant (SKIP-02) — count fired_no_response since most-recent responded = 2', async () => {
    // Seed: [fnr, fnr, fnr, responded, fnr, fnr]
    // The responded event acts as the "reset point". Counting fired_no_response
    // AFTER (newer firedAt than) the responded event should yield 2.
    const { ritualId } = await seedRitualWithFireEvents({
      ritualName: REPLAY_FIXTURE,
      cadence: 'daily',
      outcomes: [
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.RESPONDED,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
        RITUAL_OUTCOME.FIRED_NO_RESPONSE,
      ],
    });

    // Fetch all events ordered by firedAt ASC.
    const events = await db
      .select()
      .from(ritualFireEvents)
      .where(eq(ritualFireEvents.ritualId, ritualId))
      .orderBy(desc(ritualFireEvents.firedAt));

    // Find the most recent 'responded' (or 'wellbeing_completed') reset event.
    const mostRecentReset = events.find(
      (e) =>
        e.outcome === RITUAL_OUTCOME.RESPONDED ||
        e.outcome === RITUAL_OUTCOME.WELLBEING_COMPLETED,
    );
    expect(mostRecentReset).toBeDefined();

    // Count fired_no_response events with firedAt > mostRecentReset.firedAt.
    const skipsSinceReset = events.filter(
      (e) =>
        e.outcome === RITUAL_OUTCOME.FIRED_NO_RESPONSE &&
        e.firedAt > mostRecentReset!.firedAt,
    );

    // Per SKIP-02: the projection rule baseline — 2 skips after the last reset.
    expect(skipsSinceReset).toHaveLength(2);
  });
});
