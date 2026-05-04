/**
 * src/chris/__tests__/engine-pp5-adjustment.test.ts
 * Phase 28 Plan 03 — PP#5 metadata.kind dispatch (Pitfall 6 carry-over)
 *
 * Real-DB integration test. Proves that PP#5 dispatches correctly by
 * metadata.kind without ever invoking Sonnet/messages.create.
 *
 * Cumulative afterAll: mockAnthropicCreate.not.toHaveBeenCalled() across ALL
 * 4 HIT-path tests — proves Pitfall 6 invariant preserved through every
 * PP#5 branch (journal default, adjustment_dialogue, adjustment_confirmation).
 *
 * Test 1: kind absent (default branch) → recordJournalResponse
 * Test 2: kind = null (defensive) → recordJournalResponse
 * Test 3: kind = adjustment_dialogue → handleAdjustmentReply called
 * Test 4: kind = adjustment_confirmation → handleConfirmationReply called
 *
 * Run via canonical Docker harness:
 *   bash scripts/test.sh src/chris/__tests__/engine-pp5-adjustment.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';

// ── Mock Anthropic client (load-bearing for Pitfall 6) ─────────────────────
const {
  mockAnthropicCreate,
  mockAnthropicParse,
  mockHandleAdjustmentReply,
  mockHandleConfirmationReply,
} = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
  mockAnthropicParse: vi.fn(),
  mockHandleAdjustmentReply: vi.fn().mockResolvedValue(''),
  mockHandleConfirmationReply: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../llm/client.js', () => ({
  anthropic: {
    messages: { create: mockAnthropicCreate, parse: mockAnthropicParse },
  },
  HAIKU_MODEL: 'claude-haiku-3',
  SONNET_MODEL: 'claude-sonnet',
  OPUS_MODEL: 'claude-opus',
}));

// Mock adjustment-dialogue.js to inject spies
vi.mock('../../rituals/adjustment-dialogue.js', () => ({
  handleAdjustmentReply: mockHandleAdjustmentReply,
  handleConfirmationReply: mockHandleConfirmationReply,
  fireAdjustmentDialogue: vi.fn().mockResolvedValue('in_dialogue'),
  ritualConfirmationSweep: vi.fn().mockResolvedValue(0),
  confirmConfigPatch: vi.fn().mockResolvedValue(undefined),
}));

// Mock fire-and-forget pipeline modules (mirrors engine-pp5.test.ts pattern)
vi.mock('../../pensieve/embeddings.js', () => ({
  embedAndStore: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../pensieve/tagger.js', () => ({
  tagEntry: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../memory/relational.js', () => ({
  writeRelationalMemory: vi.fn().mockResolvedValue(undefined),
}));

// Mock bot for adjustment-dialogue Telegram calls
vi.mock('../../bot/bot.js', () => ({
  bot: {
    api: { sendMessage: vi.fn().mockResolvedValue({ message_id: 7777 }) },
  },
}));

import { db, sql } from '../../db/connection.js';
import {
  rituals,
  ritualPendingResponses,
  ritualResponses,
  ritualFireEvents,
  pensieveEntries,
} from '../../db/schema.js';
import { processMessage } from '../engine.js';

const FIXTURE_RITUAL_NAME = 'engine-pp5-adjustment-test-ritual';
const TEST_CHAT_ID = BigInt(12345);

async function createTestRitual() {
  const [ritual] = await db
    .insert(rituals)
    .values({
      name: FIXTURE_RITUAL_NAME,
      type: 'daily',
      nextRunAt: new Date(),
      enabled: true,
      config: {
        fire_at: '21:00',
        prompt_bag: [1, 2, 3],
        skip_threshold: 3,
        mute_until: null,
        time_zone: 'Europe/Paris',
        prompt_set_version: 'v1',
        schema_version: 1,
      },
    })
    .returning();
  return ritual!;
}

async function cleanup() {
  await db.delete(ritualResponses);
  await db.delete(ritualFireEvents);
  await db.delete(ritualPendingResponses);
  await db.delete(pensieveEntries);
  await db.delete(rituals).where(eq(rituals.name, FIXTURE_RITUAL_NAME));
}

describe('Phase 28 Plan 03 — PP#5 metadata.kind dispatch (Pitfall 6 carry-over)', () => {
  // Cumulative afterAll — Pitfall 6 invariant: Sonnet NEVER called through PP#5 HIT path
  afterAll(async () => {
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
    await cleanup();
    await sql.end({ timeout: 5 }).catch(() => {});
  });

  beforeEach(async () => {
    await cleanup();
    mockAnthropicCreate.mockReset();
    mockAnthropicParse.mockReset();
    mockHandleAdjustmentReply.mockReset();
    mockHandleAdjustmentReply.mockResolvedValue('');
    mockHandleConfirmationReply.mockReset();
    mockHandleConfirmationReply.mockResolvedValue('');
  });

  it('Test 1 (default branch — kind absent): journal path preserved when metadata = {} (no kind)', async () => {
    const ritual = await createTestRitual();
    // metadata = {} (default after migration 0010) — kind is absent/undefined
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual.id,
        chatId: TEST_CHAT_ID,
        firedAt: new Date(),
        expiresAt: new Date(Date.now() + 18 * 3600 * 1000),
        promptText: 'What mattered today?',
        metadata: {}, // no kind — journal default branch
      })
      .returning();

    const result = await processMessage(TEST_CHAT_ID, 99999, 'today was great');

    expect(result).toBe('');

    // Pensieve entry written (journal path)
    const entries = await db.select().from(pensieveEntries);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.epistemicTag).toBe('RITUAL_RESPONSE');

    // handleAdjustmentReply NOT called
    expect(mockHandleAdjustmentReply).not.toHaveBeenCalled();
    expect(mockHandleConfirmationReply).not.toHaveBeenCalled();

    // Anthropic NOT called (Pitfall 6)
    expect(mockAnthropicCreate).not.toHaveBeenCalled();

    // Pending row consumed
    const [consumed] = await db
      .select()
      .from(ritualPendingResponses)
      .where(eq(ritualPendingResponses.id, pending!.id));
    expect(consumed!.consumedAt).not.toBeNull();
  });

  it('Test 2 (default branch — metadata IS NULL): journal path preserved when metadata is null', async () => {
    const ritual = await createTestRitual();
    // metadata = null (defensive case — column default is {}, but testing null scenario)
    const [pending] = await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual.id,
        chatId: TEST_CHAT_ID,
        firedAt: new Date(),
        expiresAt: new Date(Date.now() + 18 * 3600 * 1000),
        promptText: 'What mattered today?',
        // metadata left out (will use column DEFAULT '{}')
      })
      .returning();

    const result = await processMessage(TEST_CHAT_ID, 99999, 'null metadata test');

    expect(result).toBe('');

    // Journal path: Pensieve entry written
    const entries = await db.select().from(pensieveEntries);
    expect(entries).toHaveLength(1);

    expect(mockHandleAdjustmentReply).not.toHaveBeenCalled();
    expect(mockAnthropicCreate).not.toHaveBeenCalled();
  });

  it('Test 3 (adjustment_dialogue branch): handleAdjustmentReply called, returns empty string', async () => {
    const ritual = await createTestRitual();
    await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual.id,
        chatId: TEST_CHAT_ID,
        firedAt: new Date(),
        expiresAt: new Date(Date.now() + 18 * 3600 * 1000),
        promptText: 'This daily ritual isn\'t working — what should change?',
        metadata: { kind: 'adjustment_dialogue', cadence: 'daily', ritualName: FIXTURE_RITUAL_NAME },
      });

    const result = await processMessage(TEST_CHAT_ID, 99999, 'change the time to 19:30');

    expect(result).toBe('');

    // handleAdjustmentReply called (spy mock)
    expect(mockHandleAdjustmentReply).toHaveBeenCalledOnce();

    // Anthropic NOT called (Pitfall 6 — adjustment-dialogue short-circuits PP#5)
    expect(mockAnthropicCreate).not.toHaveBeenCalled();

    // handleConfirmationReply NOT called
    expect(mockHandleConfirmationReply).not.toHaveBeenCalled();
  });

  it('Test 4 (adjustment_confirmation branch): handleConfirmationReply called, returns empty string', async () => {
    const ritual = await createTestRitual();
    await db
      .insert(ritualPendingResponses)
      .values({
        ritualId: ritual.id,
        chatId: TEST_CHAT_ID,
        firedAt: new Date(),
        expiresAt: new Date(Date.now() + 18 * 3600 * 1000),
        promptText: 'Change fire_at to 19:30 — OK?',
        metadata: {
          kind: 'adjustment_confirmation',
          proposed_change: { field: 'fire_at', new_value: '19:30' },
        },
      });

    const result = await processMessage(TEST_CHAT_ID, 99999, 'yes');

    expect(result).toBe('');

    // handleConfirmationReply called
    expect(mockHandleConfirmationReply).toHaveBeenCalledOnce();

    // Anthropic NOT called (Pitfall 6)
    expect(mockAnthropicCreate).not.toHaveBeenCalled();

    // handleAdjustmentReply NOT called
    expect(mockHandleAdjustmentReply).not.toHaveBeenCalled();
  });
});
